import * as React from "react";
import { TrendingUp, Banknote, Bot } from "lucide-react";

const BENEFITS = [
  { icon: TrendingUp, color: "oklch(0.62 0.24 292)", text: "Más ticket promedio" },
  { icon: Banknote, color: "oklch(0.72 0.19 155)", text: "Más facturación con los mismos clientes" },
  { icon: Bot, color: "oklch(0.7 0.16 220)", text: "Recomendaciones automáticas" },
];

export const BenefitsList = React.forwardRef<HTMLDivElement>(function BenefitsList(_props, ref) {
  return (
    <div ref={ref} className="flex flex-col gap-4">
      {BENEFITS.map((b) => (
        <div key={b.text} className="s-up-benefit flex items-center gap-3.5">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border-2"
            style={{ borderColor: b.color, color: b.color }}
          >
            <b.icon className="h-5 w-5" />
          </span>
          <div className="text-base font-semibold text-white sm:text-lg">{b.text}</div>
        </div>
      ))}
    </div>
  );
});
