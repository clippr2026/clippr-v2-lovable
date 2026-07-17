import * as React from "react";
import { gsap } from "gsap";
import { Check } from "lucide-react";
import { prefersReducedMotion } from "../lib/motion";

function formatPrice(n: number) {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

// Reemplaza a la tarjeta "+18% Ticket promedio": en vez de una métrica
// abstracta, muestra la cuenta real — turno normal vs. turno con Clippr,
// cada una con su propio "recibo" (ítems con check + total propio) — el
// total de la derecha es el protagonista a propósito (tamaño y glow muy
// por encima del de la izquierda): es el número que tiene que quedar en
// la cabeza. "added" es el mismo booleano que ProductsMockup (ver
// useUpsellDemo en SectionUpsell): cuando la Cera Mate se agrega ahí,
// esta tarjeta reacciona en el mismo instante, no en un timer aparte.
//
// 30% de descuento sobre $25.000 = $17.500 (no $17.000, ese es el precio
// del corte) — sumado al corte de $17.000 dan los $34.500 del total.
export const ComparisonCard = React.forwardRef<HTMLDivElement, { added: boolean }>(
  function ComparisonCard({ added }, ref) {
    const totalRef = React.useRef<HTMLDivElement>(null);
    const prevAdded = React.useRef(added);

    React.useEffect(() => {
      const el = totalRef.current;
      if (!el) return;

      if (prefersReducedMotion()) {
        el.textContent = formatPrice(added ? 34500 : 17000);
        prevAdded.current = added;
        return;
      }

      if (added && !prevAdded.current) {
        // Contador ascendente 17.000 → 34.500 en 0.4s: el salto tiene que
        // sentirse (no ser un simple cambio de texto) para que el
        // aumento quede grabado.
        const counter = { value: 17000 };
        gsap.to(counter, {
          value: 34500,
          duration: 0.4,
          ease: "power2.out",
          onUpdate: () => {
            el.textContent = formatPrice(counter.value);
          },
        });
      } else if (!added) {
        // Vuelta al inicio del loop: reset directo, sin contar hacia
        // abajo — el "impacto" es solo en la subida.
        el.textContent = formatPrice(17000);
      }
      prevAdded.current = added;
    }, [added]);

    return (
      <div
        ref={ref}
        className="s-up-metric relative mt-4 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] px-5 py-4 sm:mt-5 sm:px-8 sm:py-7"
      >
        {/* Glow sesgado a la derecha, detrás de la columna "Turno con
            Clippr" — el ojo tiene que ir ahí primero. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(65% 90% at 80% 35%, oklch(0.58 0.26 292 / 0.4), transparent 65%)",
          }}
        />

        <div className="relative grid grid-cols-2 gap-3 sm:gap-6">
          {/* Turno normal — recibo chico, sin glow, a propósito apagado
              al lado del de la derecha. */}
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-white/40 sm:text-xs">
              Turno normal
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-2 text-sm text-white/70 sm:text-base">
              <span className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 shrink-0 text-white/35" strokeWidth={3} />
                Corte
              </span>
              <span>$17.000</span>
            </div>
            <div className="mt-3 border-t border-white/10 pt-2.5">
              <div className="text-[10px] font-medium uppercase tracking-wide text-white/35">Total</div>
              <div className="mt-0.5 font-display text-lg font-semibold text-white/70 sm:text-xl">
                $17.000
              </div>
            </div>
          </div>

          {/* Turno con Clippr — el recibo "protagonista". */}
          <div>
            <div
              className="text-[11px] font-semibold uppercase tracking-wide sm:text-xs"
              style={{ color: "oklch(0.75 0.2 292)" }}
            >
              Turno con Clippr
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-2 text-sm text-white/85 sm:text-base">
              <span className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "oklch(0.7 0.2 292)" }} strokeWidth={3} />
                Corte
              </span>
              <span>$17.000</span>
            </div>
            {/* Siempre montada (nunca "added && <div>", ver el resto de
                la landing) para no mover el layout — pero acá sí arranca
                invisible de verdad (opacity 0, no un "fantasma" al 30%):
                el pedido es que la línea "aparezca" con fade + slide,
                no que esté siempre ahí atenuada. */}
            {/* grid, no flex justify-between: "Cera Mate" + el badge no
                entran en una sola línea en esta columna angosta —
                probado, el badge terminaba partiéndose en "30%"/"OFF".
                Con grid-cols-[1fr_auto], el precio queda clavado arriba
                a la derecha en su propia columna y el nombre+badge
                pueden envolver a una segunda línea sin arrastrarlo. */}
            <div
              className="mt-1.5 grid grid-cols-[1fr_auto] items-start gap-x-2"
              style={{
                opacity: added ? 1 : 0,
                transform: added ? "translateY(0px)" : "translateY(6px)",
                transition: "opacity 450ms ease-out, transform 450ms ease-out",
              }}
            >
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-white/85 sm:text-base">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "oklch(0.7 0.2 292)" }} strokeWidth={3} />
                  Cera Mate
                </span>
                <span
                  className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white sm:text-[9px]"
                  style={{ background: "linear-gradient(135deg, oklch(0.62 0.24 292), oklch(0.46 0.24 296))" }}
                >
                  30% off
                </span>
              </span>
              <span className="shrink-0 whitespace-nowrap text-sm text-white/85 sm:text-base">$17.500</span>
            </div>
            <div className="mt-3 border-t border-white/10 pt-2.5">
              <div className="text-[10px] font-medium uppercase tracking-wide text-white/40">Total</div>
              {/* ~25% más grande que el total de "Turno normal" (text-lg
                  → text-3xl, más aún en sm/lg) y con glow violeta bien
                  presente: es el número que tiene que quedar. */}
              <div
                ref={totalRef}
                className="mt-0.5 font-display text-3xl font-bold text-white sm:text-4xl lg:text-[2.75rem]"
                style={{ textShadow: "0 0 42px oklch(0.62 0.26 292 / 0.85)" }}
              >
                $17.000
              </div>
            </div>
          </div>
        </div>

        <div className="relative mt-3 flex flex-col gap-1 border-t border-white/10 pt-3 sm:mt-5 sm:pt-4">
          <div className="text-base font-bold sm:text-xl" style={{ color: "oklch(0.74 0.2 292)" }}>
            + $17.500 en el mismo cliente
          </div>
          <div className="text-xs font-medium text-white/60 sm:text-base">
            Vendé más sin conseguir más clientes.
          </div>
        </div>
      </div>
    );
  },
);
