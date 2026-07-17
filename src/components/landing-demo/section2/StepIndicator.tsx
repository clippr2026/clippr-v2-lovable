import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { n: 1, label: "Servicio" },
  { n: 2, label: "Profesional" },
  { n: 3, label: "Día" },
  { n: 4, label: "Horario" },
];

// Tres estados por paso, no dos: completado (n < active, tilde, relleno
// sólido) — activo (n === active, número, relleno con glow) — pendiente
// (n > active, solo el anillo). Todo transiciona suave (mismas
// propiedades, solo cambian color/relleno) para que el avance del demo de
// BookingCard se sienta continuo, no un corte entre estados.
export const StepIndicator = React.forwardRef<HTMLDivElement, { active?: number; hidden?: boolean }>(
  function StepIndicator({ active = 1, hidden = false }, ref) {
    return (
      <div
        ref={ref}
        // opacity, no unmount condicional desde afuera: sacar este bloque
        // del DOM (como se hacía antes) le colapsaba el alto al contenedor
        // — en mobile eso es una sola columna en flujo normal, así que la
        // tarjeta de abajo (y todo lo que sigue en la página) pegaba un
        // salto hacia arriba en el instante en que aparece "Turno
        // confirmado". Con opacity el espacio queda reservado siempre.
        className={cn("flex items-start transition-opacity duration-300", hidden ? "opacity-0" : "opacity-100")}
        aria-hidden={hidden}
      >
        {STEPS.map((step, i) => {
          const completed = step.n < active;
          const isActive = step.n === active;
          return (
            <React.Fragment key={step.n}>
              <div className="s2-step flex flex-col items-center gap-2">
                <div
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-all duration-500 ease-out sm:h-9 sm:w-9",
                    isActive && "text-white shadow-[0_0_18px_-2px_oklch(0.6_0.24_292/0.75)]",
                    completed && "text-white",
                    !isActive && !completed && "border-[1.5px] text-white/80",
                  )}
                  style={
                    isActive
                      ? { background: "linear-gradient(135deg, oklch(0.62 0.24 292), oklch(0.46 0.24 296))" }
                      : completed
                        ? { background: "oklch(0.5 0.2 292)" }
                        : { borderColor: "oklch(0.55 0.22 292 / 0.65)" }
                  }
                >
                  {completed ? <Check className="h-4 w-4" strokeWidth={3} /> : step.n}
                </div>
                <span className="whitespace-nowrap text-[11px] font-medium text-white/55 sm:text-xs">
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className="mt-4 h-px w-10 shrink-0 transition-colors duration-500 ease-out sm:mt-[18px] sm:w-16"
                  style={{ background: step.n < active ? "oklch(0.55 0.22 292 / 0.7)" : "oklch(0.5 0.15 292 / 0.4)" }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  },
);
