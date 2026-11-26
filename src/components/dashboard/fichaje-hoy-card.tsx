import * as React from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { ClipboardCheck, Clock, QrCode, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useFichajeHoy } from "@/components/dashboard/use-fichaje-hoy";
import { FichajeQrModal } from "@/components/dashboard/fichaje-qr-modal";
import type { FichajeHoyPersona } from "@/lib/fichaje";
import { EVENTO_VER_ASISTENCIA } from "@/components/dashboard/modulos-carousel";

type BranchOption = { id: string; name: string };

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

// Mismo criterio que clockIn (lib/fichaje): sin tolerancia, antes o justo a horario es "A tiempo".
function puntualidad(p: FichajeHoyPersona): "A tiempo" | "Tarde" | null {
  if (!p.expectedStartAt) return null;
  const diff = Math.round((new Date(p.clockInAt).getTime() - new Date(p.expectedStartAt).getTime()) / 60000);
  return diff <= 0 ? "A tiempo" : "Tarde";
}

// "Por fichar: Melany, Pipo, Franco y 3 más"
export function lineaPorFichar(pendientes: string[], total: number): string {
  if (total === 0) return "Nadie tiene jornada programada hoy";
  if (pendientes.length === 0) return "Todos ficharon";
  const nombres = pendientes.slice(0, 3);
  const resto = pendientes.length - nombres.length;
  return `Por fichar: ${nombres.join(", ")}${resto > 0 ? ` y ${resto} más` : ""}`;
}

export function FichajeHoyCard({
  fichaje,
  branchId,
  activeBranches,
  branchesLoading,
}: {
  fichaje: ReturnType<typeof useFichajeHoy>;
  branchId: string | null;
  activeBranches: BranchOption[];
  branchesLoading: boolean;
}) {
  const { setActiveBranchId } = useAuth();
  const [qrOpen, setQrOpen] = React.useState(false);
  const [listOpen, setListOpen] = React.useState(false);
  const branchName = activeBranches.find((b) => b.id === branchId)?.name ?? "";
  // Solo sucursales activas; con 0 o 1 no hay nada para elegir.
  const needsPicker = activeBranches.length >= 2;
  const summary = fichaje.summary;

  const aviso = branchesLoading
    ? null
    : activeBranches.length === 0
      ? "No hay sucursales activas. Activá una en Configuración → Sucursales para poder fichar."
      : needsPicker && !branchId
        ? "Elegí una sucursal."
        : null;
  const cargando = !aviso && (branchesLoading || fichaje.loading || !summary || !branchId);

  // Tarjeta "Fichaje" del carrusel: abre la asistencia del día; si todavía no se puede (sin sucursal o sin datos),
  // lleva a la configuración de fichaje.
  const navigate = useNavigate();
  const puedeVer = Boolean(summary && branchId);
  React.useEffect(() => {
    const ver = () => {
      if (puedeVer) setListOpen(true);
      else void navigate({ to: "/settings", search: { section: "tardanza" } });
    };
    window.addEventListener(EVENTO_VER_ASISTENCIA, ver);
    return () => window.removeEventListener(EVENTO_VER_ASISTENCIA, ver);
  }, [puedeVer, navigate]);

  // "glass": mismo borde iluminado que Caja de hoy y Próximos turnos.
  return (
    <div className="glass rounded-2xl p-4 ring-1 ring-white/5 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 text-lg font-semibold text-white">
          <Clock className="h-5 w-5 text-violet-300" />
          Fichaje de hoy
        </div>
        {needsPicker && !branchId && (
          <select
            value=""
            onChange={(e) => setActiveBranchId(e.target.value)}
            className="h-9 min-w-0 appearance-none rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-white outline-none"
          >
            <option value="" disabled>
              Sucursal
            </option>
            {activeBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {aviso ? (
        <div className="mt-3 text-sm text-white/60">{aviso}</div>
      ) : cargando || !summary || !branchId ? (
        // Misma altura que la tarjeta cargada, para que al llegar los datos no se mueva nada.
        <div role="status" aria-label="Cargando fichaje" className="mt-1.5 animate-pulse">
          <div className="h-7 w-40 rounded bg-white/10" />
          <div className="mt-0.5 h-6 w-64 max-w-full rounded bg-white/[0.07]" />
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <div className="h-11 rounded-2xl bg-white/[0.06]" />
            <div className="h-11 rounded-2xl bg-white/[0.06]" />
          </div>
        </div>
      ) : (
        <>
          <div className="mt-1.5 text-2xl font-bold leading-7 tracking-tight text-white">
            {summary.fichados} de {summary.total} ficharon
          </div>
          <div className="mt-0.5 truncate text-base leading-6 text-white/75">{lineaPorFichar(summary.pendientesNames, summary.total)}</div>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setListOpen(true)}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-violet-200 to-violet-300 text-base font-semibold text-violet-950 shadow-[0_6px_18px_-6px_rgba(196,181,253,.7),inset_0_1px_0_rgba(255,255,255,.5)] ring-1 ring-violet-100/60 transition active:scale-[0.97]"
            >
              <ClipboardCheck className="h-5 w-5" /> Ver asistencia
            </button>
            <button
              type="button"
              onClick={() => setQrOpen(true)}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-violet-200 to-violet-300 text-base font-semibold text-violet-950 shadow-[0_6px_18px_-6px_rgba(196,181,253,.7),inset_0_1px_0_rgba(255,255,255,.5)] ring-1 ring-violet-100/60 transition active:scale-[0.97]"
            >
              <QrCode className="h-5 w-5" /> Mostrar QR
            </button>
          </div>
        </>
      )}

      {listOpen && summary &&
        createPortal(
          <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center" onClick={() => setListOpen(false)}>
            <div
              className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-3xl border border-violet-400/30 bg-[#0b0914] text-white sm:rounded-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                <div className="min-w-0">
                  <div className="text-lg font-semibold">Asistencia de hoy</div>
                  {/* Fecha en su propio renglón, completa y en blanco para que se lea bien. */}
                  <div className="mt-0.5 text-base font-medium text-white/90 first-letter:uppercase">
                    {new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
                  </div>
                  {branchName && <div className="truncate text-sm text-white/60">{branchName}</div>}
                </div>
                <button type="button" onClick={() => setListOpen(false)} aria-label="Cerrar" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 space-y-2 overflow-y-auto px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {summary.roster.length === 0 && <div className="py-8 text-center text-white/60">Nadie tiene jornada programada hoy.</div>}
                {summary.roster.map((r) => {
                  const s = r.session;
                  const p = s ? puntualidad(s) : null;
                  const estado = !s ? "Por fichar" : p ?? (s.clockOutAt ? "Terminó" : "En curso");
                  const cls = !s
                    ? "bg-amber-400/15 text-amber-200 ring-amber-300/30"
                    : p === "Tarde"
                      ? "bg-rose-400/15 text-rose-200 ring-rose-300/30"
                      : "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30";
                  return (
                    <div key={r.id} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-base font-semibold">{r.name}</span>
                        <span className={`shrink-0 rounded-full px-3 py-0.5 text-sm font-semibold ring-1 ${cls}`}>{estado}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-white/70">
                        <span>
                          Entrada <span className="tabular-nums text-white">{s ? hora(s.clockInAt) : "—"}</span>
                        </span>
                        <span>
                          Salida <span className="tabular-nums text-white">{s?.clockOutAt ? hora(s.clockOutAt) : "—"}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {qrOpen && summary && branchId && (
        <FichajeQrModal branchName={branchName} code={summary.code} branchId={branchId} onClose={() => setQrOpen(false)} />
      )}
    </div>
  );
}
