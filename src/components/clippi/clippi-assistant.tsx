import * as React from "react";
import { createPortal } from "react-dom";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowRight, ArrowUp, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth, type PermKey } from "@/hooks/use-auth";
import { alPedirClippi, dentroDePantalla, guardarBurbuja, leerBurbuja, seArrastro, sobreBasurero, type Punto } from "@/lib/clippi-burbuja";
import { nombreDePila, saludar } from "@/lib/clippi-saludo";
// Solo los tipos: las preguntas y respuestas se descargan recién al abrir el chat.
import type { ClippiRespuesta, ClippiTema } from "@/lib/clippi";
import {
  PIDE_ASESOR, PIDE_TRAS_PROBAR, describirEquipo, escribirAsesor, marcarLeida, miConsulta, pedirAsesor, type MiConsulta,
} from "@/lib/soporte";

const FOTO = "/clippi-v3.webp";
// Pantallas con botones fijos abajo (Cobrar, Guardar): ahí la burbuja los taparía.
const SIN_BURBUJA = /^\/(cash-register|settings|fichaje-kiosco|fichar)(\/|$)/;
const ATAJOS = 4;
// Pausa mínima con "Consultando…" para que la respuesta no aparezca de golpe.
const PAUSA_MS = 700;
// Cada cuánto se buscan respuestas del asesor: con el chat abierto y con la burbuja sola.
const REVISAR_CHAT_MS = 15_000;
const REVISAR_BURBUJA_MS = 60_000;
const cargarMotor = () => import("@/lib/clippi");

type Mensaje = {
  de: "yo" | "clippi" | "asesor";
  texto: string;
  tema?: ClippiTema;
  sugerencias?: ClippiTema[];
  derivar?: ClippiRespuesta["derivar"];
  /** Id de la respuesta del asesor, para no repetirla. */
  respuestaId?: number;
};

// La conversación se guarda en el dispositivo, separada por cuenta: sigue ahí al cambiar de
// pantalla, recargar o cerrar la app. Se borra sola a los 7 días sin usar el chat.
const MAXIMO_MENSAJES = 40;
const VENCE_MS = 7 * 24 * 60 * 60 * 1000;
const claveChat = (cuenta: string) => `clippr_clippi_chat_${cuenta}`;
// Respaldo en memoria por si el almacenamiento no está disponible.
const memoria = new Map<string, Mensaje[]>();

function leerChat(cuenta: string): Mensaje[] {
  const enMemoria = memoria.get(cuenta);
  if (enMemoria) return enMemoria;
  try {
    const guardado = JSON.parse(localStorage.getItem(claveChat(cuenta)) ?? "null") as { fecha: number; mensajes: Mensaje[] } | null;
    return guardado && Date.now() - guardado.fecha < VENCE_MS && Array.isArray(guardado.mensajes) ? guardado.mensajes : [];
  } catch {
    return [];
  }
}

function guardarChat(cuenta: string, mensajes: Mensaje[]) {
  memoria.set(cuenta, mensajes);
  try {
    // De cada opción sugerida solo hace falta lo que se muestra, no sus preguntas.
    const livianos = mensajes.map((m) => ({
      ...m,
      tema: m.tema && { ...m.tema, preguntas: [] },
      sugerencias: m.sugerencias?.map((t) => ({ ...t, preguntas: [] })),
    }));
    localStorage.setItem(claveChat(cuenta), JSON.stringify({ fecha: Date.now(), mensajes: livianos }));
  } catch {
    // Sin almacenamiento: la conversación dura hasta recargar.
  }
}

// Clippi es solo para el dueño y el administrador general.
export const usaClippi = (rol?: string | null) => !rol || rol === "owner" || rol === "admin_general";

export function ClippiAssistant() {
  const { profile, user, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [abierto, setAbierto] = React.useState(false);

  const dueno = usaClippi(profile?.role);
  const cuenta = user?.id;

  const [burbuja, setBurbuja] = React.useState(() => leerBurbuja(cuenta ?? ""));
  React.useEffect(() => setBurbuja(leerBurbuja(cuenta ?? "")), [cuenta]);
  const cambiarBurbuja = React.useCallback(
    (cambio: Partial<typeof burbuja>) => {
      const nueva = { ...leerBurbuja(cuenta ?? ""), ...cambio };
      guardarBurbuja(cuenta ?? "", nueva);
      setBurbuja(nueva);
    },
    [cuenta],
  );
  // Desde Configuración: abre el chat y, si estaba en el basurero, vuelve la burbuja.
  React.useEffect(
    () =>
      alPedirClippi(() => {
        cambiarBurbuja({ guardada: false });
        setAbierto(true);
      }),
    [cambiarBurbuja],
  );

  // Punto rojo en la burbuja cuando el asesor respondió.
  const [sinLeer, setSinLeer] = React.useState(0);
  const revisar = Boolean(user) && dueno && !abierto;
  React.useEffect(() => {
    if (!revisar) return;
    let vigente = true;
    const mirar = () => miConsulta().then((c) => vigente && setSinLeer(c?.sin_leer ?? 0)).catch(() => {});
    void mirar();
    const reloj = window.setInterval(() => document.visibilityState === "visible" && void mirar(), REVISAR_BURBUJA_MS);
    return () => {
      vigente = false;
      window.clearInterval(reloj);
    };
  }, [revisar]);

  if (loading || !user || !dueno || typeof document === "undefined") return null;

  // Dueño y administrador general ven todas las pantallas.
  const puede = () => true;

  return createPortal(
    <>
      {!abierto && !burbuja.guardada && !SIN_BURBUJA.test(pathname) && (
        <BurbujaClippi
          posicion={burbuja.posicion}
          sinLeer={sinLeer}
          onAbrir={() => setAbierto(true)}
          onMover={(posicion) => cambiarBurbuja({ posicion })}
          onGuardar={() => {
            // Vuelve a aparecer en su lugar de siempre, no encima de la X.
            cambiarBurbuja({ guardada: true, posicion: null });
            toast("Ocultaste a Clippi. Lo encontrás en Configuración.");
          }}
        />
      )}
      {abierto && <Chat cuenta={user.id} puede={puede} onClose={() => setAbierto(false)} />}
    </>,
    document.body,
  );
}

/** La cara de Clippi flotando: un toque abre el chat; arrastrando se mueve o se oculta sobre la X. */
export function BurbujaClippi({
  posicion,
  sinLeer,
  onAbrir,
  onMover,
  onGuardar,
}: {
  posicion: Punto | null;
  sinLeer: number;
  onAbrir: () => void;
  onMover: (p: Punto) => void;
  onGuardar: () => void;
}) {
  const gesto = React.useRef<{ id: number; dedo: Punto; esquina: Punto; movido: boolean } | null>(null);
  const fueArrastre = React.useRef(false);
  const basurero = React.useRef<HTMLDivElement>(null);
  const [arrastre, setArrastre] = React.useState<{ en: Punto; sobre: boolean } | null>(null);

  // Al girar el teléfono o cambiar el tamaño, se vuelve a acomodar dentro de la pantalla.
  const [, setMedida] = React.useState(0);
  React.useEffect(() => {
    const medir = () => setMedida((n) => n + 1);
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  function ubicar(e: React.PointerEvent) {
    const g = gesto.current!;
    const en = dentroDePantalla(
      { x: g.esquina.x + e.clientX - g.dedo.x, y: g.esquina.y + e.clientY - g.dedo.y },
      window.innerWidth,
      window.innerHeight,
    );
    const caja = basurero.current?.getBoundingClientRect();
    return { en, sobre: Boolean(caja) && sobreBasurero(en, { x: caja!.x + caja!.width / 2, y: caja!.y + caja!.height / 2 }) };
  }

  const lugar = arrastre?.en ?? (posicion && dentroDePantalla(posicion, window.innerWidth, window.innerHeight));

  return (
    <>
      {arrastre && (
        <div aria-hidden className="no-invert pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+6.5rem)] z-[10010] flex flex-col items-center gap-1.5">
          <div
            ref={basurero}
            className={`grid h-16 w-16 place-items-center rounded-full border-2 text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)] backdrop-blur-[3px] transition ${arrastre.sobre ? "scale-125 border-white bg-rose-500/70" : "border-white/70 bg-slate-400/30"}`}
          >
            <X className="h-8 w-8 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]" />
          </div>
          <span className="rounded-full bg-black/50 px-3 py-0.5 text-xs font-semibold text-white">Ocultar</span>
        </div>
      )}
      {/* "no-invert": en modo claro Clippi se ve con sus colores. "touch-none": arrastrar no mueve la pantalla. */}
      <button
        type="button"
        onPointerDown={(e) => {
          if (e.button !== 0 || gesto.current) return;
          const caja = e.currentTarget.getBoundingClientRect();
          gesto.current = { id: e.pointerId, dedo: { x: e.clientX, y: e.clientY }, esquina: { x: caja.x, y: caja.y }, movido: false };
          fueArrastre.current = false;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const g = gesto.current;
          if (!g || g.id !== e.pointerId) return;
          if (!g.movido && !seArrastro(g.dedo, { x: e.clientX, y: e.clientY })) return;
          g.movido = true;
          fueArrastre.current = true;
          setArrastre(ubicar(e));
        }}
        onPointerUp={(e) => {
          const g = gesto.current;
          if (!g || g.id !== e.pointerId) return;
          if (g.movido) {
            const { en, sobre } = ubicar(e);
            if (sobre) onGuardar();
            else onMover(en);
          }
          gesto.current = null;
          setArrastre(null);
        }}
        onPointerCancel={() => {
          gesto.current = null;
          setArrastre(null);
        }}
        // Soltar después de arrastrar también dispara un "click": ahí no se abre el chat.
        onClick={(e) => {
          if (e.detail === 0 || !fueArrastre.current) onAbrir();
        }}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={sinLeer ? "Abrir a Clippi: tenés una respuesta del asesor" : "Abrir a Clippi, tu asistente"}
        style={lugar ? { left: lugar.x, top: lugar.y, right: "auto", bottom: "auto" } : undefined}
        className={`no-invert fixed bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] right-3 h-14 w-14 touch-none select-none rounded-full border border-violet-400/70 bg-white shadow-[0_0_24px_-6px_rgba(139,92,246,0.9),0_10px_24px_-10px_rgba(0,0,0,0.8)] [-webkit-touch-callout:none] lg:bottom-6 lg:right-6 ${arrastre ? (arrastre.sobre ? "z-[10011] scale-75 opacity-30" : "z-[10011] scale-105") : "z-30 transition-transform active:scale-95"}`}
      >
        <img src={FOTO} alt="" draggable={false} className="pointer-events-none h-full w-full rounded-full object-cover" />
        {sinLeer > 0 && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-4 w-4 rounded-full border-2 border-black bg-rose-500" />}
      </button>
    </>
  );
}

// Alto visible real: en iPhone el teclado tapa la parte de abajo y la ventana tiene que achicarse.
function useAreaVisible() {
  const [area, setArea] = React.useState<{ top: number; height: number } | null>(null);
  React.useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const medir = () => setArea({ top: vv.offsetTop, height: vv.height });
    medir();
    vv.addEventListener("resize", medir);
    vv.addEventListener("scroll", medir);
    return () => {
      vv.removeEventListener("resize", medir);
      vv.removeEventListener("scroll", medir);
    };
  }, []);
  return area;
}

function Chat({ cuenta, puede, onClose }: { cuenta: string; puede: (p: PermKey) => boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const area = useAreaVisible();
  const { branches, activeBranchId, profile } = useAuth();
  const nombre = nombreDePila(profile?.full_name, profile?.email);
  const [mensajes, setMensajes] = React.useState<Mensaje[]>(() => leerChat(cuenta));
  const [texto, setTexto] = React.useState("");
  const finRef = React.useRef<HTMLDivElement>(null);
  const [temas, setTemas] = React.useState<ClippiTema[]>([]);
  const [consultando, setConsultando] = React.useState(false);
  // Consulta con un asesor sin cerrar: mientras exista, lo que se escribe le llega a él.
  const [consulta, setConsulta] = React.useState<MiConsulta | null>(null);
  // El chat siempre abre con Clippi. Pasa a ser con el asesor al pedirlo, al llegar una respuesta
  // suya o al tocar "Ir al asesor", y dura hasta cerrarlo.
  const [modoAsesor, elegirAsesor] = React.useState(false);
  const conAsesor = Boolean(consulta && consulta.estado !== "cerrada") && modoAsesor;
  React.useEffect(() => {
    // Si falla, se reintenta al preguntar.
    cargarMotor().then((m) => setTemas(m.CLIPPI_TEMAS)).catch(() => {});
  }, []);
  // Si la última respuesta ofrece opciones, los atajos generales no se muestran.
  const atajos =
    consultando || conAsesor || mensajes.at(-1)?.sugerencias || mensajes.at(-1)?.derivar ? [] : temas.filter((t) => !t.permiso || puede(t.permiso)).slice(0, ATAJOS);

  React.useEffect(() => {
    if (mensajes.length) finRef.current?.scrollIntoView({ block: "end" });
  }, [mensajes, consultando, area?.height]);

  React.useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onClose]);

  // Se guarda en el momento: si se cierra el chat mientras consulta, la respuesta no se pierde.
  function agregar(mensaje: Mensaje) {
    const todos = [...leerChat(cuenta), mensaje].slice(-MAXIMO_MENSAJES);
    guardarChat(cuenta, todos);
    setMensajes(todos);
  }

  const traerRespuestas = React.useCallback(async () => {
    const c = await miConsulta();
    setConsulta(c);
    if (!c) return;
    const actuales = leerChat(cuenta);
    // Solo las nuevas. Con el chat recién borrado, únicamente las que todavía no se leyeron.
    const ultima = Math.max(0, ...actuales.map((m) => m.respuestaId ?? 0));
    const pendientes = ultima ? c.respuestas.filter((r) => r.id > ultima) : c.respuestas.slice(c.respuestas.length - c.sin_leer);
    if (pendientes.length) {
      const todos = [...actuales, ...pendientes.map((r) => ({ de: "asesor" as const, texto: r.texto, respuestaId: r.id }))].slice(-MAXIMO_MENSAJES);
      guardarChat(cuenta, todos);
      setMensajes(todos);
      elegirAsesor(true);
    }
    if (c.sin_leer > 0) await marcarLeida(c.id);
  }, [cuenta]);

  React.useEffect(() => {
    const mirar = () => void traerRespuestas().catch(() => {});
    mirar();
    const reloj = window.setInterval(() => document.visibilityState === "visible" && mirar(), REVISAR_CHAT_MS);
    return () => window.clearInterval(reloj);
  }, [traerRespuestas]);

  async function hablarConAsesor(pedido: string) {
    if (consultando) return;
    const yaAbierta = Boolean(consulta && consulta.estado !== "cerrada");
    const previos = leerChat(cuenta).map((m) => ({ autor: m.de === "yo" ? ("usuario" as const) : ("clippi" as const), texto: m.texto }));
    const confirmacion = "Listo, le pasé tu consulta a un asesor.";
    agregar({ de: "yo", texto: pedido });
    setConsultando(true);
    try {
      const sucursal = branches.find((b) => b.id === activeBranchId)?.name;
      const instalada =
        window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
      const equipo = describirEquipo(navigator.userAgent, instalada, navigator.maxTouchPoints > 1);
      const id = await pedirAsesor(
        [
          ...previos,
          // Si todavía no había escrito nada, el pedido es su único mensaje.
          { autor: previos.some((m) => m.autor === "usuario") ? "clippi" : "usuario", texto: pedido },
          { autor: "clippi", texto: confirmacion },
        ],
        [sucursal, equipo].filter(Boolean).join(" · "),
      );
      // Con una consulta ya abierta la base no vuelve a copiar el chat: se avisa con un mensaje.
      if (yaAbierta) await escribirAsesor(id, pedido);
      elegirAsesor(true);
      agregar({ de: "clippi", texto: confirmacion });
      await traerRespuestas().catch(() => {});
    } catch (e) {
      const limite = (e as Error).message.includes("limite");
      agregar({ de: "clippi", texto: limite ? "Ya enviaste varias consultas hoy. Probá de nuevo mañana." : "No pude enviar la consulta. Probá de nuevo en un rato." });
    } finally {
      setConsultando(false);
    }
  }

  function resuelto() {
    agregar({ de: "yo", texto: "Sí, se resolvió" });
    agregar({ de: "clippi", texto: "¡Genial! Acá estoy si necesitás otra cosa." });
  }

  function borrarChat() {
    guardarChat(cuenta, []);
    setMensajes([]);
    elegirAsesor(false);
  }

  async function preguntar(pregunta: string) {
    const limpia = pregunta.trim();
    if (!limpia || consultando) return;
    setTexto("");
    if (conAsesor && consulta) {
      setConsultando(true);
      try {
        await escribirAsesor(consulta.id, limpia);
        agregar({ de: "yo", texto: limpia });
      } catch {
        setTexto(limpia);
        agregar({ de: "clippi", texto: "No pude enviar el mensaje al asesor. Probá de nuevo." });
        await traerRespuestas().catch(() => {});
      } finally {
        setConsultando(false);
      }
      return;
    }
    agregar({ de: "yo", texto: limpia });
    setConsultando(true);
    try {
      const [motor] = await Promise.all([cargarMotor(), new Promise((listo) => setTimeout(listo, PAUSA_MS))]);
      const r = motor.responderClippi(limpia, puede);
      setTemas(motor.CLIPPI_TEMAS);
      agregar({ de: "clippi", texto: r.tema?.id === "hola" ? saludar(r.texto, nombre) : r.texto, tema: r.tema, sugerencias: r.sugerencias, derivar: r.derivar });
    } catch {
      agregar({ de: "clippi", texto: "No pude consultar. Revisá tu conexión y recargá la página." });
    } finally {
      setConsultando(false);
    }
  }

  return (
    <div
      className="no-invert fixed inset-x-0 top-0 z-[10020] flex h-dvh items-end justify-center bg-black/70 sm:items-center"
      style={area ? { top: area.top, height: area.height } : undefined}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Clippi, asistente"
        className="flex h-[88%] w-full max-w-md flex-col overflow-hidden rounded-[28px] border border-violet-400/45 bg-[#08070f] text-white shadow-[0_0_0_1px_rgba(139,92,246,0.3),0_30px_90px_-20px_rgba(0,0,0,0.9),0_0_60px_-18px_rgba(139,92,246,0.55)] [background-image:radial-gradient(120%_45%_at_85%_0%,rgba(79,125,255,0.20),transparent_60%),radial-gradient(110%_50%_at_0%_100%,rgba(139,92,246,0.22),transparent_62%)] sm:h-[620px] sm:max-h-[88%]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <img src={FOTO} alt="" className="h-12 w-12 shrink-0 rounded-full border border-violet-400/60 bg-white object-cover" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold">Clippi</span>
              <span className="text-xs font-semibold text-white/60">Asistente</span>
            </div>
            <div className="text-sm text-white/60">Clippr</div>
          </div>
          {mensajes.length > 0 && !consultando && (
            <button type="button" onClick={borrarChat} aria-label="Borrar conversación" title="Borrar conversación" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
              <Trash2 className="h-5 w-5 text-white/70" />
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
          {mensajes.length === 0 && (
            <div className="pt-4">
              <div className="text-2xl font-bold tracking-tight">{saludar("¡Hola!", nombre)} Lo resolvemos juntos.</div>
              <div className="mt-1 text-sm text-white/65">Puedo ayudarte con turnos, caja, clientes, tu equipo y tu página de reservas.</div>
            </div>
          )}
          {mensajes.map((m, i) =>
            m.de === "yo" ? (
              <div key={i} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-gradient-to-r from-sky-500 to-violet-500 px-3.5 py-2 text-sm font-medium">
                {m.texto}
              </div>
            ) : (
              <div key={i} className="w-fit max-w-[90%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line">
                {m.de === "asesor" && <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-emerald-300">Asesor</span>}
                {m.texto}
                {m.sugerencias && (
                  <div className="mt-2.5 flex flex-col items-start gap-2">
                    {m.sugerencias.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => preguntar(s.titulo)}
                        className="rounded-full border border-violet-400/70 bg-violet-500/20 px-4 py-2 text-left text-sm font-semibold"
                      >
                        {s.titulo}
                      </button>
                    ))}
                  </div>
                )}
                {m.tema?.destino && (
                  <button
                    type="button"
                    onClick={() => {
                      const { to, search } = m.tema!.destino!;
                      onClose();
                      void navigate({ to, search } as never);
                    }}
                    className="mt-2.5 flex items-center gap-1.5 rounded-full border border-violet-400/70 bg-violet-500/20 px-4 py-2 text-sm font-semibold"
                  >
                    {m.tema.boton} <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            ),
          )}
          {/* Opciones solo debajo de la última respuesta. */}
          {!consultando && !conAsesor && mensajes.at(-1)?.derivar === "resolvio" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-full text-sm font-semibold">¿Se resolvió?</span>
              <button type="button" onClick={resuelto} className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold">Sí</button>
              <button type="button" onClick={() => void hablarConAsesor(PIDE_TRAS_PROBAR)} className="rounded-full border border-violet-400/70 bg-violet-500/20 px-5 py-2.5 text-sm font-semibold">No, hablar con un asesor</button>
            </div>
          )}
          {!consultando && !conAsesor && mensajes.at(-1)?.de === "clippi" && !mensajes.at(-1)?.derivar && (
            <button type="button" onClick={() => void hablarConAsesor(PIDE_ASESOR)} className="block text-sm font-semibold text-violet-300 underline underline-offset-4">
              ¿No te sirvió? Hablar con un asesor
            </button>
          )}
          {!consultando && !conAsesor && mensajes.at(-1)?.derivar === "asesor" && (
            <button type="button" onClick={() => void hablarConAsesor(PIDE_ASESOR)} className="rounded-full border border-violet-400/70 bg-violet-500/20 px-5 py-2.5 text-sm font-semibold">
              Hablar con un asesor
            </button>
          )}
          {consultando && (
            <div role="status" className="flex w-fit items-center gap-2.5 rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white/70">
              <span aria-hidden className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-300" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </span>
              Consultando…
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {atajos.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => preguntar(t.titulo)}
                className="flex items-center gap-1.5 rounded-2xl border border-white/15 bg-white/[0.03] px-3.5 py-2.5 text-sm font-semibold transition active:scale-95"
              >
                {t.titulo} <ArrowRight className="h-4 w-4 text-white/60" />
              </button>
            ))}
          </div>
          <div ref={finRef} />
        </div>

        {consulta && consulta.estado !== "cerrada" && (
          <div className="mx-3 flex items-center justify-between gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs">
            <span className="font-semibold text-emerald-200">{conAsesor ? "Estás escribiéndole a un asesor" : "Tenés una consulta con un asesor"}</span>
            <button type="button" onClick={() => elegirAsesor(!conAsesor)} className="shrink-0 font-semibold underline">
              {conAsesor ? "Volver con Clippi" : "Ir al asesor"}
            </button>
          </div>
        )}

        <form
          className="mx-3 mb-1.5 mt-3 flex items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.04] py-1.5 pl-4 pr-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            preguntar(texto);
          }}
        >
          {/* text-base (16px): con letra más chica el iPhone hace zoom al escribir. */}
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={!conAsesor ? "Preguntale a Clippi..." : consulta?.respuestas.length ? "Escribile al asesor..." : "Sumá un detalle (opcional)..."}
            enterKeyHint="send"
            maxLength={conAsesor ? 1000 : 200}
            className="h-11 min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/40"
          />
          <button type="submit" disabled={!texto.trim() || consultando} aria-label="Enviar" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-r from-sky-400 to-violet-500 disabled:opacity-40">
            <ArrowUp className="h-5 w-5" />
          </button>
        </form>
        <p className="pb-2 text-center text-xs text-white/50">Clippi puede contener errores.</p>
      </div>
    </div>
  );
}
