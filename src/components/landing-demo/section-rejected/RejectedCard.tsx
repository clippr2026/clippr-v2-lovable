import * as React from "react";
import { Check } from "lucide-react";

const REJECTED_COLOR = "oklch(0.66 0.24 292)";

const BENEFITS = [
  "Estimar ingresos potenciales perdidos.",
  "Detectar cuándo ampliar horarios.",
  "Saber cuándo incorporar profesionales.",
  "Recomendar aumentos de precio según la demanda.",
];

// Tarjeta chica y premium — no el modal real de la app, una pieza propia
// de la landing. Violeta (no el amarillo/naranja del estado "Rechazados"
// de Section5): esta sección usa el mismo lenguaje visual que el resto de
// Clippr en vez de tener una identidad de color separada.
export const RejectedCard = React.forwardRef<HTMLDivElement>(function RejectedCard(_props, ref) {
  return (
    <div
      ref={ref}
      className="w-full rounded-[2rem] border p-6 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:p-7 lg:p-8"
      style={{
        borderColor: `color-mix(in oklch, ${REJECTED_COLOR} 25%, transparent)`,
        background: `linear-gradient(160deg, color-mix(in oklch, ${REJECTED_COLOR} 7%, #0a0a0f), #08070d 55%)`,
      }}
    >
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide"
        style={{
          color: REJECTED_COLOR,
          borderColor: `color-mix(in oklch, ${REJECTED_COLOR} 45%, transparent)`,
          background: `color-mix(in oklch, ${REJECTED_COLOR} 12%, transparent)`,
        }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: REJECTED_COLOR }} />
        Clientes rechazados
      </span>

      <h3 className="mt-4 text-xl font-bold text-white lg:text-2xl">
        ¿Qué pasa cuando rechazás un cliente?
      </h3>
      <p className="mt-2 text-sm text-white/70 lg:text-base">
        Cada cliente que no consigue turno queda registrado.
      </p>
      <p className="mt-3 text-sm font-medium text-white/85 lg:text-base">
        Clippr utiliza esa información para:
      </p>

      <ul className="mt-3 flex flex-col gap-2.5">
        {BENEFITS.map((b) => (
          <li
            key={b}
            className="s5r-benefit flex items-start gap-2.5 text-sm text-white/85 lg:text-base"
          >
            <span
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full"
              style={{ background: `color-mix(in oklch, ${REJECTED_COLOR} 22%, transparent)` }}
            >
              <Check className="h-3 w-3" style={{ color: REJECTED_COLOR }} />
            </span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
});
