import * as React from "react";
import { cn } from "@/lib/utils";

const DAYS = [
  { d: "LUN", n: "13" },
  { d: "MAR", n: "14" },
  { d: "MIÉ", n: "15" },
  { d: "JUE", n: "16" },
  { d: "VIE", n: "17" },
];

export function DatePicker({ selected }: { selected?: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-white/80 sm:text-sm">Elegí un día</div>
      <div className="mt-2 grid grid-cols-5 gap-1.5 sm:mt-3 sm:gap-2">
        {DAYS.map((day) => {
          const active = day.n === selected;
          return (
            <button
              key={day.n}
              type="button"
              tabIndex={-1}
              className={cn(
                "relative flex flex-col items-center gap-0.5 overflow-hidden rounded-xl bg-white/[0.03] py-2 ring-1 transition-colors duration-500 ease-out sm:py-2.5",
                active ? "text-white ring-transparent" : "text-white/60 ring-white/10",
              )}
            >
              {/* Fondo con gradiente en una capa aparte, siempre montada,
                  transicionando opacidad — un <button> no puede pasar
                  suavemente de "sin fondo" a "fondo con gradiente"
                  (background no interpola), así que en vez de eso se hace
                  un crossfade de opacidad entre "sin capa" y "capa
                  encendida". Mismo patrón que el anillo de
                  ProfessionalPicker. */}
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-0 transition-opacity duration-500 ease-out",
                  active ? "opacity-100" : "opacity-0",
                )}
                style={{
                  background: "linear-gradient(135deg, oklch(0.62 0.24 292), oklch(0.46 0.24 296))",
                  boxShadow: "0 0 16px -4px oklch(0.6 0.24 292 / 0.65)",
                }}
              />
              {/* relative z-10 en los dos: sin esto, con esta capa de
                  fondo absoluta + transición de opacidad de por medio,
                  Chromium a veces deja de pintar el número del día (el
                  span más grande, "14") aunque el orden en el DOM y todos
                  los estilos computados digan que debería verse — probado
                  con captura, no supuesto. Forzar el stacking explícito
                  (no depender del orden natural) lo resuelve. */}
              <span className="relative z-10 text-[10px] font-semibold uppercase tracking-wide opacity-80">
                {day.d}
              </span>
              <span className="relative z-10 text-sm font-bold">{day.n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
