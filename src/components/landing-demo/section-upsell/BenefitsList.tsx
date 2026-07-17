import * as React from "react";
import { TrendingUp, Banknote, Bot } from "lucide-react";

const BENEFITS = [
  { icon: TrendingUp, color: "oklch(0.62 0.24 292)", text: "Más ticket promedio" },
  { icon: Banknote, color: "oklch(0.72 0.19 155)", text: "Más facturación con los mismos clientes" },
  { icon: Bot, color: "oklch(0.7 0.16 220)", text: "Recomendaciones automáticas" },
];

// Mobile/tablet: grilla 2 columnas, iconos y texto más chicos, mucho menos
// alto que la pila vertical original — la idea es que funcionen como una
// vista rápida, no como una lista larga. Desktop (lg+) sin cambios: pila
// vertical, iconos/texto a su tamaño de siempre.
export const BenefitsList = React.forwardRef<HTMLDivElement>(function BenefitsList(_props, ref) {
  return (
    <div ref={ref} className="grid grid-cols-2 gap-x-3 gap-y-2.5 lg:flex lg:flex-col lg:gap-4">
      {BENEFITS.map((b) => (
        <div key={b.text} className="s-up-benefit flex items-center gap-2 lg:gap-3.5">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-2 lg:h-10 lg:w-10 lg:rounded-xl"
            style={{ borderColor: b.color, color: b.color }}
          >
            <b.icon className="h-4 w-4 lg:h-5 lg:w-5" />
          </span>
          <div className="text-xs font-semibold leading-tight text-white lg:text-lg">{b.text}</div>
        </div>
      ))}
    </div>
  );
});
