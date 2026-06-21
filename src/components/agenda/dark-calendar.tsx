import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * DarkCalendar — calendario mensual oscuro, propio y liviano para Clippr.
 * - Sin librerías nuevas, sin datepicker nativo.
 * - Solo grilla mensual (42 celdas fijas, semana arranca lunes).
 * - Fondo grafito, bordes glass suaves, día seleccionado con glow violeta/azul.
 * - Pensado para móvil: sin animaciones pesadas ni blur excesivo.
 */

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

// Paleta coherente con --primary (azul-violeta) del tema.
const VIOLET = "oklch(0.66 0.22 265)";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function DarkCalendar({
  value,
  onSelect,
}: {
  value: Date;
  onSelect: (date: Date) => void;
}) {
  const [viewMonth, setViewMonth] = React.useState(
    () => new Date(value.getFullYear(), value.getMonth(), 1),
  );

  const today = React.useMemo(() => startOfDay(new Date()), []);

  // 42 celdas (6 semanas), lunes primero. Cálculo único memoizado por mes.
  const cells = React.useMemo(() => {
    const y = viewMonth.getFullYear();
    const m = viewMonth.getMonth();
    const offset = (new Date(y, m, 1).getDay() + 6) % 7; // días del mes anterior antes del 1
    const start = new Date(y, m, 1 - offset);
    return Array.from({ length: 42 }, (_, i) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
    );
  }, [viewMonth]);

  const monthLabel = cap(
    viewMonth.toLocaleDateString("es-AR", { month: "long", year: "numeric" }),
  );

  const shiftMonth = (delta: number) =>
    setViewMonth((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1));

  const goToday = () => {
    setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    onSelect(today);
  };

  return (
    <div
      className="w-[280px] rounded-2xl p-3 select-none"
      style={{
        background:
          "linear-gradient(180deg, oklch(0.2 0.04 285 / 0.97), oklch(0.12 0.03 280 / 0.98))",
        border: "1px solid oklch(1 0 0 / 0.1)",
        boxShadow:
          "inset 0 1px 0 oklch(1 0 0 / 0.07), 0 20px 52px -26px oklch(0 0 0 / 0.9)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      {/* Encabezado: mes anterior · mes · mes siguiente */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Mes anterior"
          className="h-7 w-7 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.07] transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-white/90 capitalize">{monthLabel}</span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Mes siguiente"
          className="h-7 w-7 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.07] transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Cabecera de días */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="h-6 flex items-center justify-center text-[10px] font-medium uppercase tracking-wide text-white/35">
            {d}
          </div>
        ))}
      </div>

      {/* Grilla mensual */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === viewMonth.getMonth();
          const selected = sameDay(d, value);
          const isToday = sameDay(d, today);
          return (
            <button
              type="button"
              key={i}
              onClick={() => onSelect(startOfDay(d))}
              className={[
                "h-9 rounded-lg text-sm flex items-center justify-center transition-colors",
                selected
                  ? "font-semibold text-white"
                  : inMonth
                    ? "text-white/85 hover:bg-[oklch(0.66_0.22_265_/_0.18)]"
                    : "text-white/25 hover:bg-white/[0.04]",
              ].join(" ")}
              style={
                selected
                  ? {
                      background: "oklch(0.66 0.22 265 / 0.22)",
                      boxShadow: `inset 0 0 0 1.5px ${VIOLET}, 0 0 14px oklch(0.66 0.22 265 / 0.55)`,
                    }
                  : isToday
                    ? { boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.18)" }
                    : undefined
              }
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      {/* Botón Hoy */}
      <button
        type="button"
        onClick={goToday}
        className="mt-2 w-full h-8 rounded-lg text-xs font-semibold text-white/85 hover:text-white transition-colors"
        style={{ background: "oklch(0.66 0.22 265 / 0.12)", boxShadow: "inset 0 0 0 1px oklch(0.66 0.22 265 / 0.35)" }}
      >
        Hoy
      </button>
    </div>
  );
}
