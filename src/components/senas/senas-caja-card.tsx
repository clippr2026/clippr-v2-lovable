import * as React from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ChevronRight, HandCoins, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SenasPendientesModal } from "./senas-pendientes-modal";
import { useReembolsosPorRevisar, useSenasPendientes, type SenaPendiente } from "./use-senas-pendientes";

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
const BA = "America/Argentina/Buenos_Aires";
const dayKeyBA = (iso: string | Date) => new Date(iso).toLocaleDateString("en-CA", { timeZone: BA });
const fmtTurno = (iso: string | null) =>
  iso
    ? `${new Date(iso).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: BA }).replace(".", "")} · ${new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: BA })} hs`
    : "—";

/** Señas ya aprobadas que entran en una caja futura (se aprobaron con la caja de hoy ya cerrada). */
function useSenasProximaCaja(businessId: string | null | undefined, branchId: string | null | undefined, tick: number) {
  const [rows, setRows] = React.useState<Array<{ id: string; amount: number; created_at: string }>>([]);
  React.useEffect(() => {
    if (!businessId) return setRows([]);
    let cancelled = false;
    let q = (supabase.from("cash_movements" as any) as any)
      .select("id,amount,created_at")
      .eq("business_id", businessId)
      .not("deposit_id", "is", null)
      .gt("created_at", new Date().toISOString())
      .order("created_at", { ascending: true });
    if (branchId) q = q.eq("branch_id", branchId);
    void q.then(({ data, error }: any) => {
      if (!cancelled && !error) setRows(((data ?? []) as any[]).map((r) => ({ id: r.id, amount: Number(r.amount) || 0, created_at: r.created_at })));
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, branchId, tick]);
  return rows;
}

function ReembolsosModal({ open, onClose, items }: { open: boolean; onClose: () => void; items: SenaPendiente[] }) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-end bg-black/70 backdrop-blur-sm sm:place-items-center" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-[oklch(0.11_0.04_275)] p-4 shadow-2xl ring-1 ring-white/10 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Reembolsos</h3>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-xs text-white/55">
          Turnos con seña cancelados dentro del plazo de la política de cancelación. Tocá uno para ir al turno y reembolsar.
        </p>
        {items.length === 0 ? (
          <div className="rounded-xl bg-white/[0.04] px-3 py-4 text-center text-sm text-white/60 ring-1 ring-white/10">No hay reembolsos por revisar.</div>
        ) : (
          <div className="space-y-1.5">
            {items.map((it) => (
              <Link
                key={it.id}
                to="/agenda"
                search={{ date: it.starts_at ? dayKeyBA(it.starts_at) : undefined, turno: it.appointment_id }}
                onClick={onClose}
                className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5 text-sm ring-1 ring-white/10 transition hover:bg-white/[0.08]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-white">{it.client_name ?? "Cliente"}</span>
                  <span className="block truncate text-[11px] text-white/55">
                    {it.service_name ?? "Turno"} · {fmtTurno(it.starts_at)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 font-semibold tabular-nums text-amber-200">
                  {money(it.amount)} <ChevronRight className="h-4 w-4 text-white/40" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Tarjeta "Señas" de Caja e Inicio: las señas que esperan revisión, de cualquier fecha de turno.
 * Lo ya aprobado se ve en Ingresos / Dinero en banco y los reembolsos en Gastos.
 */
export function SenasCajaCard({
  businessId,
  branchId,
  onChanged,
  hideWhenDisabled = false,
}: {
  businessId: string | null | undefined;
  branchId: string | null | undefined;
  onChanged?: () => void;
  /** Inicio: si las señas están desactivadas y no hay nada por revisar, la tarjeta no se muestra. */
  hideWhenDisabled?: boolean;
}) {
  const pend = useSenasPendientes(businessId);
  const reemb = useReembolsosPorRevisar(businessId);
  const [tick, setTick] = React.useState(0);
  const proxima = useSenasProximaCaja(businessId, branchId, tick);
  const [open, setOpen] = React.useState(false);
  const [openReemb, setOpenReemb] = React.useState(false);
  // null = todavía no se sabe (no se muestra hasta saberlo, para que no parpadee).
  const [enabled, setEnabled] = React.useState<boolean | null>(hideWhenDisabled ? null : true);

  React.useEffect(() => {
    if (!hideWhenDisabled || !businessId) return;
    let cancelled = false;
    void supabase
      .from("business_settings")
      .select("senas_config")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setEnabled(Boolean(((data as any)?.senas_config ?? {}).enabled));
      });
    return () => {
      cancelled = true;
    };
  }, [hideWhenDisabled, businessId]);

  const pendTotal = pend.items.reduce((s, i) => s + i.amount, 0);
  const reembTotal = reemb.items.reduce((s, i) => s + i.amount, 0);
  const handleChanged = () => {
    void pend.refresh();
    setTick((t) => t + 1);
    onChanged?.();
  };

  if (hideWhenDisabled && (enabled === null || (!enabled && pend.items.length === 0 && reemb.items.length === 0))) return null;

  return (
    <>
      <div
        className="senas-neon-card space-y-2.5 rounded-2xl p-3.5"
        style={{
          background: "linear-gradient(180deg, rgba(139,92,246,0.14), rgba(255,255,255,0.02))",
          boxShadow: "inset 0 0 0 1px rgba(167,139,250,0.45), 0 0 28px -10px rgba(139,92,246,0.7)",
        }}
      >
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-200/80">
          <HandCoins className="h-4 w-4" /> Señas
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-11 w-full items-center justify-between rounded-xl px-3.5 text-sm font-semibold transition hover:brightness-125"
          style={
            pend.items.length > 0
              ? { background: "rgba(251,191,36,0.14)", color: "#fcd34d", boxShadow: "inset 0 0 0 1.5px rgba(251,191,36,0.6), 0 0 18px rgba(251,191,36,0.22)" }
              : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.7)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" }
          }
        >
          <span>Por revisar</span>
          <span className="tabular-nums">
            {pend.items.length}
            {pend.items.length > 0 ? ` · ${money(pendTotal)}` : ""}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setOpenReemb(true)}
          className="flex h-11 w-full items-center justify-between rounded-xl px-3.5 text-sm font-semibold transition hover:brightness-125"
          style={
            reemb.items.length > 0
              ? { background: "rgba(251,191,36,0.14)", color: "#fcd34d", boxShadow: "inset 0 0 0 1.5px rgba(251,191,36,0.6), 0 0 18px rgba(251,191,36,0.22)" }
              : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.7)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" }
          }
        >
          <span>Reembolsos</span>
          <span className="tabular-nums">
            {reemb.items.length}
            {reemb.items.length > 0 ? ` · ${money(reembTotal)}` : ""}
          </span>
        </button>
        {proxima.length > 0 && (
          <div className="rounded-xl bg-sky-400/10 px-3 py-2 text-xs leading-snug text-sky-100 ring-1 ring-sky-300/30">
            {proxima.length === 1 ? "Hay 1 seña aprobada" : `Hay ${proxima.length} señas aprobadas`} después del cierre (
            {money(proxima.reduce((s, r) => s + r.amount, 0))}): {proxima.length === 1 ? "entra" : "entran"} en la caja del{" "}
            <strong>{new Date(proxima[0].created_at).toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: BA })}</strong>.
          </div>
        )}
      </div>
      <ReembolsosModal open={openReemb} onClose={() => setOpenReemb(false)} items={reemb.items} />
      <SenasPendientesModal open={open} onClose={() => setOpen(false)} items={pend.items} loading={pend.loading} onChanged={handleChanged} />
    </>
  );
}
