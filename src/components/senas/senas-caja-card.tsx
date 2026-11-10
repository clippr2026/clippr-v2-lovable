import * as React from "react";
import { HandCoins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SenasPendientesModal } from "./senas-pendientes-modal";
import { useSenasPendientes } from "./use-senas-pendientes";

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;

/**
 * Tarjeta "Señas" de Caja e Inicio: las señas que esperan revisión, de cualquier fecha de turno.
 * Lo ya aprobado se ve en Ingresos / Dinero en banco y los reembolsos en Gastos.
 */
export function SenasCajaCard({
  businessId,
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
  const [open, setOpen] = React.useState(false);
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
  const handleChanged = () => {
    void pend.refresh();
    onChanged?.();
  };

  if (hideWhenDisabled && (enabled === null || (!enabled && pend.items.length === 0))) return null;

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
