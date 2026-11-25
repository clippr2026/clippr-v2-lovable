// Panel del dueño de la plataforma Clippr. Quién puede ver las consultas lo controla la base.
import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowUp, Check, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { bandeja, cerrarConsulta, esPedidoDeAsesor, mensajesDe, responder, type ConsultaBandeja, type ConsultaEstado, type ConsultaMensaje } from "@/lib/soporte";

export const Route = createFileRoute("/clippr")({
  head: () => ({ meta: [{ title: "Clippr — Panel" }] }),
  component: PanelClippr,
});

const REVISAR_MS = 15_000;
const ESTADOS: Record<ConsultaEstado, { texto: string; clase: string }> = {
  abierta: { texto: "Sin responder", clase: "bg-amber-400/15 text-amber-200 ring-amber-300/30" },
  respondida: { texto: "Respondida", clase: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30" },
  cerrada: { texto: "Cerrada", clase: "bg-white/5 text-white/55 ring-white/10" },
};
const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Trae un dato al entrar y lo vuelve a pedir cada tanto mientras la pantalla está visible.
function useActualizado<T>(pedir: () => Promise<T>) {
  const [dato, setDato] = React.useState<T | null>(null);
  const [error, setError] = React.useState(false);
  const recargar = React.useCallback(
    () => pedir().then((d) => { setDato(d); setError(false); }).catch(() => setError(true)),
    [pedir],
  );
  React.useEffect(() => {
    void recargar();
    const reloj = window.setInterval(() => document.visibilityState === "visible" && void recargar(), REVISAR_MS);
    return () => window.clearInterval(reloj);
  }, [recargar]);
  return { dato, error, recargar };
}

function PanelClippr() {
  const { loading, session, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const esPlataforma = profile?.role === "plataforma";

  React.useEffect(() => {
    if (loading) return;
    if (!session) navigate({ to: "/login", replace: true });
    else if (profile && !esPlataforma) navigate({ to: "/dashboard", replace: true });
  }, [loading, session, profile, esPlataforma, navigate]);

  if (loading || !session || !esPlataforma) return <div className="min-h-dvh bg-background" />;

  return (
    <div className="min-h-dvh w-full">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-black">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
          <img src="/clippr-powered-logo.webp" alt="" className="h-8 w-8 rounded-xl object-cover" />
          <span className="font-display text-base font-semibold text-white">Clippr · Panel</span>
          <button type="button" onClick={() => void signOut()} className="ml-auto flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-2 text-sm text-white/80 ring-1 ring-white/10">
            <LogOut className="h-4 w-4" /> Salir
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-3 py-4">
        <Consultas />
      </main>
    </div>
  );
}

function Consultas() {
  const { dato, error, recargar } = useActualizado<ConsultaBandeja[]>(bandeja);
  const [abierta, setAbierta] = React.useState<string | null>(null);
  const elegida = dato?.find((c) => c.id === abierta);

  if (elegida) return <Conversacion consulta={elegida} volver={() => { setAbierta(null); void recargar(); }} />;

  const pendientes = dato?.filter((c) => c.estado === "abierta").length ?? 0;
  return (
    <section>
      <h1 className="font-display text-2xl font-semibold text-white">Consultas</h1>
      <p className="mt-1 text-sm text-white/60">{pendientes ? `${pendientes} sin responder` : "No hay consultas sin responder"}</p>
      {error && <p className="mt-3 text-sm text-rose-300">No se pudieron cargar las consultas.</p>}
      {!dato && !error && <p className="mt-3 text-sm text-white/60">Cargando…</p>}
      {dato?.length === 0 && <p className="mt-6 text-center text-sm text-white/60">Todavía no hay consultas.</p>}
      <div className="mt-4 space-y-2">
        {dato?.map((c) => (
          <button key={c.id} type="button" onClick={() => setAbierta(c.id)} className="block w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-base font-semibold text-white">{c.negocio || "Local sin nombre"}</span>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${ESTADOS[c.estado].clase}`}>{ESTADOS[c.estado].texto}</span>
            </div>
            <div className="mt-0.5 truncate text-sm text-white/70">{c.ultimo ?? "—"}</div>
            <div className="mt-0.5 truncate text-xs text-white/45">{[c.usuario || c.email, cuando(c.actualizada_en)].join(" · ")}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function Conversacion({ consulta, volver }: { consulta: ConsultaBandeja; volver: () => void }) {
  const pedir = React.useCallback(() => mensajesDe(consulta.id), [consulta.id]);
  const { dato, error, recargar } = useActualizado<ConsultaMensaje[]>(pedir);
  const [texto, setTexto] = React.useState("");
  const [ocupado, setOcupado] = React.useState(false);
  const [fallo, setFallo] = React.useState("");

  async function hacer(accion: () => Promise<void>, despues: () => void) {
    setOcupado(true);
    setFallo("");
    try {
      await accion();
      despues();
    } catch {
      setFallo("No se pudo completar. Probá de nuevo.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="space-y-3">
      <button type="button" onClick={volver} className="flex items-center gap-1.5 text-sm font-semibold text-violet-300">
        <ArrowLeft className="h-4 w-4" /> Consultas
      </button>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="text-base font-semibold text-white">{consulta.negocio || "Local sin nombre"}</div>
        <div className="break-words text-sm text-white/60">{[consulta.usuario, consulta.email].filter(Boolean).join(" · ")}</div>
        {/* Sucursal y equipo. Las consultas más viejas guardaban la dirección de la pantalla: no se muestra. */}
        {consulta.pantalla && !consulta.pantalla.startsWith("/") && <div className="mt-0.5 text-xs text-white/45">{consulta.pantalla}</div>}
      </div>
      {error && <p className="text-sm text-rose-300">No se pudo cargar la conversación.</p>}
      {dato?.map((m) => (
        <div key={m.id} className={`w-fit max-w-[88%] whitespace-pre-line break-words rounded-2xl px-3.5 py-2.5 text-sm text-white ${m.autor === "asesor" ? "ml-auto bg-gradient-to-r from-sky-500 to-violet-500" : "border border-white/10 bg-white/[0.06]"}`}>
          <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-white/60">
            {m.autor === "asesor" ? "Vos" : m.autor === "clippi" && !esPedidoDeAsesor(m.texto) ? "Clippi" : "Cliente"} · {cuando(m.creado_en)}
          </span>
          {m.texto}
        </div>
      ))}
      {fallo && <p className="text-sm text-rose-300">{fallo}</p>}
      {consulta.estado !== "cerrada" ? (
        <>
          <form
            className="flex items-end gap-2 rounded-2xl border border-white/15 bg-white/[0.04] py-1.5 pl-3 pr-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!texto.trim()) return;
              void hacer(() => responder(consulta.id, texto.trim()), () => { setTexto(""); void recargar(); });
            }}
          >
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={2000} placeholder="Escribí tu respuesta…" className="min-w-0 flex-1 resize-none bg-transparent py-1.5 text-base text-white outline-none placeholder:text-white/40" />
            <button type="submit" disabled={ocupado || !texto.trim()} aria-label="Responder" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-white disabled:opacity-40">
              <ArrowUp className="h-5 w-5" />
            </button>
          </form>
          <button type="button" disabled={ocupado} onClick={() => void hacer(() => cerrarConsulta(consulta.id), volver)} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 py-3 text-sm font-semibold text-white/80">
            <Check className="h-4 w-4" /> Cerrar consulta
          </button>
        </>
      ) : (
        <p className="text-center text-sm text-white/50">Consulta cerrada.</p>
      )}
    </section>
  );
}
