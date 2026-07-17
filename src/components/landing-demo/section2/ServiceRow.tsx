import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "../lib/motion";
import type { DemoStep } from "./useDemoSequence";

const SERVICES = [
  { name: "Corte", duration: "30 min", price: "$17.000" },
  { name: "Corte + Barba", duration: "45 min", price: "$22.000" },
  { name: "Barba", duration: "15 min", price: "$10.000" },
  { name: "Color", duration: "120 min", price: "$50.000" },
];
const SELECTED_SERVICE = "Corte";

// Antes se mostraba un único servicio ya elegido de entrada; ahora el
// Paso 1 se cuenta igual que los demás: los 4 servicios aparecen sin
// elegir, una pausa breve, y recién ahí "Corte" se selecciona (borde +
// glow + check + escala — mismo lenguaje visual que ya usan
// Profesional/Día/Horario). El Paso 2 no arranca hasta que esta
// selección termina (HOLD_SERVICE en useDemoSequence.ts ya deja margen
// de sobra para pausa + animación).
export function ServiceRow({ demoStep }: { demoStep: DemoStep }) {
  const [selected, setSelected] = React.useState<string | undefined>(() =>
    prefersReducedMotion() ? SELECTED_SERVICE : undefined,
  );

  React.useEffect(() => {
    if (prefersReducedMotion()) {
      setSelected(SELECTED_SERVICE);
      return;
    }
    if (demoStep === 1) {
      // Pausa breve con los 4 en estado normal antes de que "Corte" se
      // seleccione — a diferencia del resto (que dispara la transición
      // en el frame siguiente), acá el vacío inicial es a propósito: es
      // lo que deja ver que "todavía nadie eligió nada".
      setSelected(undefined);
      const t = setTimeout(() => setSelected(SELECTED_SERVICE), 400);
      return () => clearTimeout(t);
    }
  }, [demoStep]);

  return (
    <div>
      <div className="text-xs font-medium text-white/80 sm:text-sm">Elegí un servicio</div>
      <div className="mt-2 grid grid-cols-4 gap-1.5 sm:mt-3 sm:gap-2">
        {SERVICES.map((service) => {
          const active = service.name === selected;
          return (
            <div
              key={service.name}
              className="relative flex h-[74px] flex-col items-center justify-center gap-1 rounded-xl bg-white/[0.03] px-1 text-center sm:h-24"
              style={{
                transform: active ? "scale(1.04)" : "scale(1)",
                boxShadow: active
                  ? "inset 0 0 0 1.5px oklch(0.62 0.24 292), 0 0 16px -4px oklch(0.6 0.24 292 / 0.6)"
                  : "inset 0 0 0 0px oklch(0.62 0.24 292 / 0), 0 0 0px oklch(0.6 0.24 292 / 0)",
                transition: "transform 500ms ease-out, box-shadow 500ms ease-out",
              }}
            >
              <span
                className={cn(
                  "text-sm font-bold leading-tight transition-colors duration-500 ease-out lg:text-base",
                  active ? "text-white" : "text-white/60",
                )}
              >
                {service.name}
              </span>
              <span
                className={cn(
                  "text-[9px] leading-tight transition-colors duration-500 ease-out",
                  active ? "text-white/70" : "text-white/40",
                )}
              >
                {service.duration} · {service.price}
              </span>
              {/* Check siempre montado, transicionando opacidad+escala:
                  mismo patrón que el resto del demo (nunca condicionado
                  a "active && <div>") para que entre/salga suave. */}
              <div
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 shrink-0 place-items-center rounded-full transition-all duration-500 ease-out"
                style={{
                  background: "oklch(0.5 0.2 292)",
                  opacity: active ? 1 : 0,
                  transform: active ? "scale(1)" : "scale(0.5)",
                }}
              >
                <Check className="h-3 w-3 text-white" strokeWidth={3} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
