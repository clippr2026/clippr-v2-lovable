import * as React from "react";
import { cn } from "@/lib/utils";

const BIG_STATS = [
  { label: "Ingresos (mes)", target: 5640000, prefix: "$", trend: "▲ 32% vs mes anterior", up: true },
  { label: "Gastos (mes)", target: 1280000, prefix: "$", trend: "▼ 12% vs mes anterior", up: false },
  {
    label: "Utilidad (mes)",
    target: 4360000,
    prefix: "$",
    trend: "▲ 41% vs mes anterior",
    up: true,
    // El dato más importante del resumen — mismo tamaño y estilo que las
    // otras dos, con un glow violeta muy sutil de más para que destaque.
    highlight: true,
  },
];

const SMALL_STATS = [
  { label: "Ocupación", target: 82, suffix: "%", trend: "▲ 6% vs mes anterior", up: true },
  { label: "Clientes nuevos", target: 156, suffix: "", trend: "▲ 15% vs mes anterior", up: true },
  { label: "Clientes rechazados", target: 23, suffix: "", trend: "▼ 8% vs mes anterior", up: false },
];

// Cada tarjeta lleva su propio contador (.s6-counter, data-target) para
// que Section6 los anime hasta su valor final.
export const StatsGrid = React.forwardRef<HTMLDivElement>(function StatsGrid(_props, ref) {
  return (
    <div ref={ref} className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {BIG_STATS.map((s) => (
          <div
            key={s.label}
            className="s6-card rounded-2xl border border-white/10 bg-white/[0.03] p-2.5 sm:p-4"
            style={
              s.highlight
                ? {
                    boxShadow:
                      "0 0 0 1px oklch(0.66 0.24 292 / 0.35), 0 0 22px -6px oklch(0.66 0.24 292 / 0.45)",
                  }
                : undefined
            }
          >
            <div className="truncate text-[11px] text-white/50 sm:text-xs">{s.label}</div>
            <div className="mt-1 truncate font-display text-sm font-semibold text-white sm:text-2xl lg:text-3xl">
              {s.prefix}
              <span className="s6-counter" data-target={s.target}>
                0
              </span>
            </div>
            <div
              className="mt-1.5 text-[10px] font-medium sm:text-xs"
              style={{ color: s.up ? "oklch(0.72 0.19 155)" : "oklch(0.68 0.2 25)" }}
            >
              {s.trend}
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {SMALL_STATS.map((s) => (
          <div key={s.label} className="s6-card rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
            <div className="text-[11px] text-white/50">{s.label}</div>
            <div className="mt-1 font-display text-xl font-semibold text-white sm:text-2xl">
              <span className="s6-counter" data-target={s.target}>
                0
              </span>
              {s.suffix}
            </div>
            <div
              className={cn("mt-1 text-[10px] font-medium")}
              style={{ color: s.up ? "oklch(0.72 0.19 155)" : "oklch(0.68 0.2 25)" }}
            >
              {s.trend}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
