import * as React from "react";
import { Rocket, Zap, Heart } from "lucide-react";

const BENEFITS = [
  {
    icon: Rocket,
    color: "oklch(0.62 0.24 292)",
    title: "Tu app en tu pantalla de inicio.",
    text: "Más visibilidad, más reservas.",
  },
  {
    icon: Zap,
    color: "oklch(0.7 0.16 220)",
    title: "Menos pasos, más reservas.",
    text: "Reservar nunca fue tan fácil.",
  },
  {
    icon: Heart,
    color: "oklch(0.68 0.22 8)",
    title: "Clientes que vuelven, más comodidad.",
    text: "Una experiencia que los hace volver.",
  },
];

export const BenefitsList = React.forwardRef<HTMLDivElement>(function BenefitsList(_props, ref) {
  return (
    <div ref={ref} className="flex flex-col gap-5">
      {BENEFITS.map((b) => (
        <div key={b.title} className="s7-benefit flex items-start gap-4">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2"
            style={{ borderColor: b.color, color: b.color }}
          >
            <b.icon className="h-5 w-5" />
          </span>
          <div>
            <div className="text-base font-semibold text-white">{b.title}</div>
            <div className="mt-0.5 text-sm text-white/55">{b.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
});
