import * as React from "react";
import { HandCoins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { dayBoundsBA } from "@/lib/caja-cierre";
import { SenasPendientesModal } from "./senas-pendientes-modal";
import { useSenasPendientes } from "./use-senas-pendientes";

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;

/**
 * Tarjeta "Señas" de Caja: lo recibido y devuelto hoy (una seña cuenta como recibida el día en que se
 * aprueba, sin importar qué día transfirió el cliente) y las señas que esperan revisión, de cualquier fecha de turno.
 */
export function SenasCajaCard({
  businessId,
  branchId,
  onChanged,
}: {
  businessId: string | null | undefined;
  branchId: string | null | undefined;
  onChanged?: () => void;
}) {
  const pend = useSenasPendientes(businessId);
  const [open, setOpen] = React.useState(false);
  const [day, setDay] = React.useState({ received: 0, receivedCount: 0, refunded: 0 });

  const loadDay = React.useCallback(async () => {
    if (!businessId) return;
    const todayBA = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
    const { start, end } = dayBoundsBA(todayBA);
    let q = (supabase.from("cash_movements" as any) as any)
      .select("amount,type,deposit_event")
      .eq("business_id", businessId)
      .not("deposit_id", "is", null)
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString());
    if (branchId) q = q.or(`branch_id.eq.${branchId},branch_id.is.null`);
    const { data, error } = await q;
    if (error) return;
    let received = 0;
    let receivedCount = 0;
    let refunded = 0;
    for (const m of (data ?? []) as Array<{ amount: number; deposit_event: string }>) {
      if (m.deposit_event === "received") {
        received += Number(m.amount) || 0;
        receivedCount += 1;
      } else if (m.deposit_event === "refund") {
        refunded += Number(m.amount) || 0;
      }
    }
    setDay({ received, receivedCount, refunded });
  }, [businessId, branchId]);

  React.useEffect(() => {
    void loadDay();
  }, [loadDay]);

  const pendTotal = pend.items.reduce((s, i) => s + i.amount, 0);
  const handleChanged = () => {
    void pend.refresh();
    void loadDay();
    onChanged?.();
  };

  return (
    <>
      <div
        className="space-y-2.5 rounded-2xl p-3.5"
        style={{
          background: "linear-gradient(180deg, rgba(139,92,246,0.10), rgba(255,255,255,0.02))",
          boxShadow: "inset 0 0 0 1px rgba(167,139,250,0.3)",
        }}
      >
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-200/80">
          <HandCoins className="h-4 w-4" /> Señas
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-white/55">Recibidas</div>
            <div className="text-xl font-bold tabular-nums text-white">{money(day.received)}</div>
            <div className="text-[11px] text-white/45">
              {day.receivedCount} {day.receivedCount === 1 ? "seña" : "señas"}
            </div>
          </div>
          <div>
            <div className="text-xs text-white/55">Reembolsos</div>
            <div className="text-xl font-bold tabular-nums text-white">{money(day.refunded)}</div>
          </div>
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
            {pend.items.length} {pend.items.length === 1 ? "seña" : "señas"}
            {pend.items.length > 0 ? ` · ${money(pendTotal)}` : ""}
          </span>
        </button>
      </div>
      <SenasPendientesModal open={open} onClose={() => setOpen(false)} items={pend.items} loading={pend.loading} onChanged={handleChanged} />
    </>
  );
}
