import * as React from "react";
import { createPortal } from "react-dom";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowRight, ArrowUp, X } from "lucide-react";
import { useAuth, type PermKey } from "@/hooks/use-auth";
import { ALAN_TEMAS, responderAlan, type AlanTema } from "@/lib/alan";

const FOTO = "/alan-asistente.webp";
// Pantallas con botones fijos abajo (Cobrar, Guardar): ahí la burbuja los taparía.
const SIN_BURBUJA = /^\/(cash-register|settings|fichaje-kiosco|fichar)(\/|$)/;
const ATAJOS = 4;

type Mensaje = { de: "yo" | "alan"; texto: string; tema?: AlanTema };

// La conversación se conserva al cambiar de pantalla (hasta recargar), separada por cuenta.
let historial: { cuenta: string; mensajes: Mensaje[] } = { cuenta: "", mensajes: [] };

export function AlanAssistant() {
  const { profile, user, permissions, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [abierto, setAbierto] = React.useState(false);

  if (loading || !user || SIN_BURBUJA.test(pathname) || typeof document === "undefined") return null;

  const dueno = !profile?.role || profile.role === "owner" || profile.role === "admin_general";
  const puede = (permiso: PermKey) => dueno || permissions[permiso] === true;

  return createPortal(
    <>
      {!abierto && (
        // "no-invert": en modo claro Alan se ve con sus colores.
        <button
          type="button"
          onClick={() => setAbierto(true)}
          aria-label="Abrir a Alan, tu asistente"
          className="no-invert fixed bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] right-3 z-30 h-14 w-14 overflow-hidden rounded-full border border-violet-400/70 bg-white shadow-[0_0_24px_-6px_rgba(139,92,246,0.9),0_10px_24px_-10px_rgba(0,0,0,0.8)] transition active:scale-95 lg:bottom-6 lg:right-6"
        >
          <img src={FOTO} alt="" className="h-full w-full object-cover" />
        </button>
      )}
      {abierto && <Chat cuenta={user.id} puede={puede} onClose={() => setAbierto(false)} />}
    </>,
    document.body,
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
  const [mensajes, setMensajes] = React.useState<Mensaje[]>(() => (historial.cuenta === cuenta ? historial.mensajes : []));
  const [texto, setTexto] = React.useState("");
  const finRef = React.useRef<HTMLDivElement>(null);
  const atajos = ALAN_TEMAS.filter((t) => puede(t.permiso)).slice(0, ATAJOS);

  React.useEffect(() => {
    historial = { cuenta, mensajes };
    if (mensajes.length) finRef.current?.scrollIntoView({ block: "end" });
  }, [cuenta, mensajes, area?.height]);

  React.useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onClose]);

  function preguntar(pregunta: string) {
    const limpia = pregunta.trim();
    if (!limpia) return;
    const r = responderAlan(limpia, puede);
    setMensajes((m) => [...m, { de: "yo", texto: limpia }, { de: "alan", texto: r.texto, tema: r.tema }]);
    setTexto("");
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
        aria-label="Alan, asistente"
        className="flex h-[88%] w-full max-w-md flex-col overflow-hidden rounded-[28px] border border-violet-400/45 bg-[#08070f] text-white shadow-[0_0_0_1px_rgba(139,92,246,0.3),0_30px_90px_-20px_rgba(0,0,0,0.9),0_0_60px_-18px_rgba(139,92,246,0.55)] [background-image:radial-gradient(120%_45%_at_85%_0%,rgba(79,125,255,0.20),transparent_60%),radial-gradient(110%_50%_at_0%_100%,rgba(139,92,246,0.22),transparent_62%)] sm:h-[620px] sm:max-h-[88%]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <img src={FOTO} alt="" className="h-12 w-12 shrink-0 rounded-full border border-violet-400/60 bg-white object-cover" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold">Alan</span>
              <span className="text-xs font-semibold text-white/60">Asistente</span>
            </div>
            <div className="text-sm text-white/60">Clippr</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
          {mensajes.length === 0 && (
            <div className="pt-4">
              <div className="text-2xl font-bold tracking-tight">Lo resolvemos juntos.</div>
              <div className="mt-1 text-sm text-white/65">Contame qué querés hacer en Clippr.</div>
            </div>
          )}
          {mensajes.map((m, i) =>
            m.de === "yo" ? (
              <div key={i} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-gradient-to-r from-sky-500 to-violet-500 px-3.5 py-2 text-sm font-medium">
                {m.texto}
              </div>
            ) : (
              <div key={i} className="w-fit max-w-[90%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-sm leading-relaxed">
                {m.texto}
                {m.tema && (
                  <button
                    type="button"
                    onClick={() => {
                      const { to, search } = m.tema!.destino;
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

        <form
          className="m-3 flex items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.04] py-1.5 pl-4 pr-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            preguntar(texto);
          }}
        >
          {/* text-base (16px): con letra más chica el iPhone hace zoom al escribir. */}
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Preguntale a Alan..."
            enterKeyHint="send"
            maxLength={200}
            className="h-11 min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/40"
          />
          <button type="submit" disabled={!texto.trim()} aria-label="Enviar" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-r from-sky-400 to-violet-500 disabled:opacity-40">
            <ArrowUp className="h-5 w-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
