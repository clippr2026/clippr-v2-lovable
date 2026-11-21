import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { SelectClippr } from "@/components/ui/select-clippr";
import { cn } from "@/lib/utils";

export type MultiSplit = { method: string; amount: string };

export type PaymentSplitOption = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

// Tope de dígitos para cualquier campo de monto de esta pantalla (acá y en
// "Monto recibido" de Pago simple, cash-register.tsx) — 9 dígitos = hasta
// $999.999.999, muy por encima de cualquier cobro real, solo para que no
// se pueda escribir un número interminable que rompa el layout o el
// cálculo. Nunca se guarda con puntos, siempre dígitos crudos.
const MAX_AMOUNT_DIGITS = 9;

function formatThousands(digits: string) {
  const n = Number(digits);
  return digits && Number.isFinite(n) ? n.toLocaleString("es-AR") : "";
}

function sanitizeAmountInput(raw: string) {
  return raw.replace(/\D/g, "").slice(0, MAX_AMOUNT_DIGITS);
}

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
// pasarse del total). El wording "Restante/Pago completo ✓/Sobra" del
// branch !allowPartial es específico de Nueva Venta — el branch
// allowPartial (Liquidaciones) no se tocó.
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
  // Liquidaciones (allowPartial) usa el estilo Clippr, igual que su "Pago simple"; Nueva venta queda como estaba.
  const clippr = allowPartial;
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
        clippr
          ? "space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 [background-image:radial-gradient(110%_90%_at_100%_0%,rgba(79,125,255,.16),transparent_62%),radial-gradient(90%_80%_at_0%_100%,rgba(139,92,246,.12),transparent_65%)]"
          : "rounded-2xl border border-blue-300/25 bg-[linear-gradient(135deg,rgba(37,99,235,0.14),rgba(8,11,20,0.96),rgba(2,4,12,0.98))] p-2.5 shadow-[0_0_40px_rgba(96,165,250,0.12),0_18px_55px_-34px_rgba(0,0,0,1)] space-y-1.5",
        className,
      )}
    >

      {/* max-h/overflow SOLO en las filas — antes envolvía también el
          botón "Agregar método de pago" y el renglón de estado, así que
          con pocas filas (que no llegan a llenar los 200px) quedaba un
          hueco vacío scrolleable antes de llegar a verlos. Ahora esos dos
          siempre están inmediatamente después de las filas, sin scroll de
          por medio. */}
      <div
        className={cn(
          "space-y-1.5",
          splits.length >= 3 &&
            "max-h-[168px] overflow-y-auto overscroll-contain pr-1.5 [scrollbar-width:thin] [scrollbar-color:rgba(96,165,250,0.40)_transparent]",
        )}
      >
        {/* Método, monto y eliminar bien juntos en una sola fila. El
            select usa el ancho que sobra (1fr) — monto y eliminar se
            angostaron un poco (112px→92px, 36px→32px) para que nombres
            largos como "Transferencia" entren completos sin cortarse. */}
        {splits.map((sp, idx) => {
          return (
            <div key={idx} className={cn("grid items-center", clippr ? (splits.length > 1 ? "grid-cols-[1fr_120px_48px] gap-2" : "grid-cols-[1fr_1fr] gap-2") : "grid-cols-[1fr_92px_32px] gap-1")}>
              <SelectClippr
                pill={!clippr}
                opciones={paymentOptions.map((o) => ({ id: o.id, label: o.label }))}
                valor={sp.method}
                onChange={(v) => updateSplit(idx, "method", v)}
              />
              <input
                value={formatThousands(sp.amount)}
                onChange={(e) => updateSplit(idx, "amount", sanitizeAmountInput(e.target.value))}
                inputMode="numeric"
                placeholder="Monto"
                className={cn(
                  "w-full min-w-0 text-right tabular-nums text-white outline-none placeholder:text-white/35",
                  clippr
                    ? "h-12 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-lg font-semibold focus:border-violet-400/50"
                    : "h-9 rounded-xl border border-blue-300/25 bg-black/45 px-2 text-sm font-bold focus:border-blue-300/55 focus:ring-2 focus:ring-blue-400/15",
                )}
              />
              {(!clippr || splits.length > 1) && (
              <button
                onClick={() => removeSplit(idx)}
                disabled={splits.length <= 1}
                className={cn(
                  "shrink-0 grid place-items-center text-muted-foreground hover:border-rose-300/35 hover:text-rose-300 disabled:opacity-30 transition-colors",
                  clippr
                    ? "h-12 w-12 rounded-full border border-white/10 bg-white/[0.04]"
                    : "h-9 w-8 rounded-xl border border-white/10 bg-black/35",
                )}
                type="button"
              >
                <Trash2 className="size-3.5" />
              </button>
              )}
            </div>
          );
        })}
      </div>
      {allowPartial ? (
        <>
          <button
            onClick={addSplit}
            disabled={splits.length >= paymentOptions.length}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-violet-400/40 bg-violet-500/15 px-5 text-sm font-semibold text-violet-100 hover:bg-violet-500/25 disabled:opacity-30 transition-colors"
            type="button"
          >
            <Plus className="size-4" /> Agregar otro método de pago
          </button>
          {/* Un solo renglón dinámico — Total final y Monto del pago ya se
              muestran en el resumen de arriba del modal, no hace falta
              repetirlos acá. */}
          <div className="px-1 text-base font-semibold">
            {splitsRemaining === 0 ? (
              <span className="font-bold text-emerald-300">Liquidación completa</span>
            ) : splitsRemaining > 0 ? (
              <span className="text-rose-300">Saldo pendiente: ${splitsRemaining.toLocaleString("es-AR")}</span>
            ) : (
              <span className="text-rose-300">
                Sobra ${Math.abs(splitsRemaining).toLocaleString("es-AR")} — no puede superar el total
              </span>
            )}
          </div>
        </>
      ) : (
        // Botón + estado en una sola fila compacta — antes eran dos
        // bloques apilados ("+ Agregar método de pago" arriba, estado
        // abajo en su propia fila). "Otro método" (antes "Agregar método
        // de pago") para que entre cómodo junto al estado en móvil. Nunca
        // "Vuelto": con varios métodos combinados el excedente no
        // necesariamente es efectivo que se le devuelve al cliente en
        // mano — "Vuelto" es específico de Pago simple en efectivo.
        <div className="flex items-center justify-between gap-2 rounded-full border border-blue-300/20 bg-black/35 py-1.5 pl-2.5 pr-4">
          <button
            onClick={addSplit}
            disabled={splits.length >= paymentOptions.length}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-blue-300/20 bg-blue-400/10 px-3.5 text-sm font-semibold text-blue-100 hover:bg-blue-400/15 disabled:opacity-30 transition-colors"
            type="button"
          >
            <Plus className="size-4" /> Otro método
          </button>
          {splitsTotal === 0 ? null : splitsRemaining === 0 ? (
            <span className="whitespace-nowrap text-base font-semibold text-emerald-300">Pago completo ✓</span>
          ) : splitsRemaining > 0 ? (
            <span className="whitespace-nowrap text-base font-semibold text-blue-200">
              Restante ${splitsRemaining.toLocaleString("es-AR")}
            </span>
          ) : (
            <span className="whitespace-nowrap text-base font-semibold text-rose-300">
              Sobra ${Math.abs(splitsRemaining).toLocaleString("es-AR")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
