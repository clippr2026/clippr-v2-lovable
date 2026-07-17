import * as React from "react";
import { ChevronDown, TrendingUp } from "lucide-react";

const PAYMENT_METHODS = [
  { label: "Efectivo", amount: "$288.000", pct: 60, color: "oklch(0.72 0.19 155)" },
  { label: "Transferencia", amount: "$144.000", pct: 30, color: "oklch(0.65 0.18 250)" },
  { label: "Tarjeta", amount: "$48.000", pct: 10, color: "oklch(0.75 0.16 60)" },
];

// La tarjeta "Caja de hoy" del storyboard. La facturación y las filas de
// métodos de pago llevan sus propias clases (s4-*) para que Section4 las
// pueda animar (contador numérico, entrada progresiva).
export const CashCard = React.forwardRef<HTMLDivElement>(function CashCard(_props, ref) {
  return (
    <div
      ref={ref}
      className="w-full rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:p-6 lg:p-7 xl:p-8"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white lg:text-xl">Caja de hoy</h3>
        <div className="flex items-center gap-1 rounded-full bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-white/70">
          Hoy <ChevronDown className="h-3.5 w-3.5" />
        </div>
      </div>

      <div className="mt-5 rounded-2xl bg-white/[0.03] p-4 lg:p-5">
        <div className="text-xs text-white/50">Facturación HOY</div>
        <div className="mt-1 flex items-baseline gap-1 font-display text-4xl font-semibold text-white lg:text-5xl">
          <span className="text-white/50 text-2xl lg:text-3xl">$</span>
          <span className="s4-revenue" data-target="480000">
            0
          </span>
        </div>
        <div
          className="s4-delta mt-2 flex items-center gap-1 text-sm font-semibold"
          style={{ color: "oklch(0.72 0.19 155)" }}
        >
          <TrendingUp className="h-4 w-4" /> 28% vs ayer
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white/[0.03] p-4">
          <div className="text-xs text-white/50">Cobros</div>
          <div className="mt-1 font-display text-2xl font-semibold text-white">
            <span className="s4-count" data-target="24">
              0
            </span>
          </div>
        </div>
        <div className="rounded-2xl bg-white/[0.03] p-4">
          <div className="text-xs text-white/50">Ticket promedio</div>
          <div className="mt-1 font-display text-2xl font-semibold text-white">
            $<span className="s4-count" data-target="20000">
              0
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="text-sm font-medium text-white/80">Métodos de pago</div>
        <div className="mt-3 flex flex-col gap-2.5">
          {PAYMENT_METHODS.map((m) => (
            <div key={m.label} className="s4-payment-row flex flex-col gap-1.5 text-sm">
              <div className="flex items-center gap-2.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: m.color }}
                />
                <span className="flex-1 text-white/75">{m.label}</span>
                <span className="font-semibold text-white">{m.amount}</span>
                <span className="w-10 shrink-0 text-right text-xs" style={{ color: m.color }}>
                  <span className="s4-pct" data-target={m.pct}>
                    0
                  </span>
                  %
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="s4-bar-fill h-full rounded-full"
                  data-target={m.pct}
                  style={{ width: "0%", background: m.color }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
