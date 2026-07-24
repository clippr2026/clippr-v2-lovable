import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type MultiSplit = { method: string; amount: string };

export type PaymentSplitOption = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

// Mismo componente de "Pago múltiple" en las dos pantallas que lo usan
// (Caja > Nueva venta y Caja > Liquidaciones > Pagar) — antes vivía como
// JSX suelto adentro del flujo de Nueva venta; se extrajo acá para que
// Liquidaciones lo reutilice tal cual, sin una segunda versión parecida
// pero distinta que con el tiempo termine divergiendo.
//
// `allowPartial` es la única diferencia real de comportamiento entre los
// dos usos: una venta nueva tiene que cobrarse completa (el resumen exige
// que sume exacto), pero un pago de liquidación puede ser parcial (el
// resumen muestra Total a pagar/Total ingresado/Restante y solo exige no
// pasarse del total).
export function MultiMethodPaymentSplit({
  splits,
  onChange,
  paymentOptions,
  total,
  allowPartial = false,
  className,
}: {
  splits: MultiSplit[];
  onChange: (splits: MultiSplit[]) => void;
  paymentOptions: readonly PaymentSplitOption[];
  total: number;
  allowPartial?: boolean;
  className?: string;
}) {
  const splitsTotal = splits.reduce((s, sp) => s + Number(sp.amount || 0), 0);
  const splitsRemaining = total - splitsTotal;

  function addSplit() {
    const available = paymentOptions.filter((o) => !splits.some((s) => s.method === o.id));
    if (available.length === 0) return;
    onChange([...splits, { method: available[0].id, amount: "" }]);
  }
  function removeSplit(idx: number) {
    onChange(splits.filter((_, i) => i !== idx));
  }
  function updateSplit(idx: number, key: "method" | "amount", val: string) {
    onChange(splits.map((s, i) => (i === idx ? { ...s, [key]: val } : s)));
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-blue-300/25 bg-[linear-gradient(135deg,rgba(37,99,235,0.14),rgba(8,11,20,0.96),rgba(2,4,12,0.98))] p-3 shadow-[0_0_40px_rgba(96,165,250,0.12),0_18px_55px_-34px_rgba(0,0,0,1)] space-y-2",
        splits.length >= 3 &&
          "max-h-[200px] overflow-y-auto overscroll-contain pr-1.5 [scrollbar-width:thin] [scrollbar-color:rgba(96,165,250,0.40)_transparent]",
        className,
      )}
    >
      <p className="text-[11px] tracking-[0.18em] text-muted-foreground/70">PAGO MÚLTIPLE</p>
      {/* Método, monto y eliminar bien juntos en una sola fila — el monto
          tiene ancho fijo propio (w-28) y se lee completo, alineado a la
          derecha. */}
      {splits.map((sp, idx) => {
        return (
          <div key={idx} className="grid grid-cols-[1fr_auto_auto] gap-1.5 items-center">
            <select
              value={sp.method}
              onChange={(e) => updateSplit(idx, "method", e.target.value)}
              className="h-9 min-w-0 rounded-xl border border-blue-300/25 bg-black/45 px-2.5 text-sm font-semibold text-white outline-none focus:border-blue-300/55 focus:ring-2 focus:ring-blue-400/15"
            >
              {paymentOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              value={sp.amount}
              onChange={(e) => updateSplit(idx, "amount", e.target.value)}
              inputMode="numeric"
              placeholder="Monto"
              className="h-9 w-28 rounded-xl border border-blue-300/25 bg-black/45 px-2 text-right text-sm font-bold tabular-nums text-white outline-none placeholder:text-white/35 focus:border-blue-300/55 focus:ring-2 focus:ring-blue-400/15"
            />
            <button
              onClick={() => removeSplit(idx)}
              disabled={splits.length <= 1}
              className="h-9 w-9 shrink-0 rounded-xl border border-white/10 bg-black/35 grid place-items-center text-muted-foreground hover:border-rose-300/35 hover:text-rose-300 disabled:opacity-30 transition-colors"
              type="button"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        );
      })}
      <button
        onClick={addSplit}
        disabled={splits.length >= paymentOptions.length}
        className="inline-flex items-center gap-2 rounded-xl border border-blue-300/20 bg-blue-400/10 px-3 py-1.5 text-xs font-semibold text-blue-100 hover:bg-blue-400/15 disabled:opacity-30 transition-colors"
        type="button"
      >
        <Plus className="size-3.5" /> Agregar método de pago
      </button>

      {allowPartial ? (
        <div className="space-y-1 rounded-xl border border-blue-300/20 bg-black/35 px-3 py-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total final</span>
            <span className="font-semibold text-white">${total.toLocaleString("es-AR")}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Monto del pago</span>
            <span className="font-semibold text-white">${splitsTotal.toLocaleString("es-AR")}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Saldo pendiente</span>
            <span
              className={cn(
                "font-semibold",
                splitsRemaining === 0
                  ? "text-emerald-300"
                  : splitsRemaining > 0
                    ? "text-blue-200"
                    : "text-rose-300",
              )}
            >
              {splitsRemaining < 0
                ? `Sobra $${Math.abs(splitsRemaining).toLocaleString("es-AR")}`
                : `$${splitsRemaining.toLocaleString("es-AR")}`}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between text-sm rounded-xl border border-blue-300/20 bg-black/35 px-3 py-2">
          <span className="text-muted-foreground">Total cargado: ${splitsTotal.toLocaleString("es-AR")}</span>
          <span
            className={cn(
              "font-semibold",
              splitsRemaining === 0 ? "text-emerald-300" : splitsRemaining > 0 ? "text-blue-200" : "text-rose-300",
            )}
          >
            {splitsRemaining === 0
              ? "Completo ✓"
              : splitsRemaining > 0
                ? `Falta $${splitsRemaining.toLocaleString("es-AR")}`
                : `Sobra $${Math.abs(splitsRemaining).toLocaleString("es-AR")}`}
          </span>
        </div>
      )}
    </div>
  );
}
