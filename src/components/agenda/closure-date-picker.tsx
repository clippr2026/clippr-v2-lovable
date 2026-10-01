import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;
// Fecha local (YYYY-MM-DD): nunca toISOString() acá, que convierte a UTC y
// puede adelantar la fecha un día en timezones detrás de UTC (ej. Argentina).
function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromISO(s: string) { return new Date(s + "T12:00:00"); }
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

// Calendario dedicado para "Días cerrados" — a diferencia del
// DateRangePicker genérico (usado en reportes, donde solo tiene sentido
// elegir hasta hoy), acá es al revés: un cierre siempre es a futuro.
// Sin presets (Hoy/Ayer/Esta semana no aplican acá), fechas pasadas
// deshabilitadas, calendario siempre visible (no dropdown — ya vive
// dentro de un formulario que el usuario abrió a propósito).
//
// Interacción: primer click en un día = selecciona ESE día solo (from=to,
// ya queda guardable). Un segundo click en OTRO día extiende el rango
// hacia ese lado. Un tercer click arranca una selección nueva. Nunca hace
// falta un paso de "confirmar" aparte.
export function ClosureDatePicker({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}) {
  const [viewMonth, setViewMonth] = React.useState(() => {
    const d = fromISO(from);
    return { month: d.getMonth(), year: d.getFullYear() };
  });

  const today = toISO(startOfDay(new Date()));

  function handleSelectDay(d: string) {
    const isSingleDay = from === to;
    if (!isSingleDay || d === from) {
      // Sin selección previa usable, o se tocó el mismo día ya elegido:
      // arranca una selección nueva de un solo día.
      onChange({ from: d, to: d });
    } else {
      const [a, b] = from <= d ? [from, d] : [d, from];
      onChange({ from: a, to: b });
    }
  }

  function prevMonth() {
    setViewMonth(({ month, year }) => {
      const candidate = month === 0 ? { month: 11, year: year - 1 } : { month: month - 1, year };
      const todayDate = startOfDay(new Date());
      const currentMonth = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
      const candidateMonth = new Date(candidate.year, candidate.month, 1);
      return candidateMonth < currentMonth ? { month, year } : candidate;
    });
  }
  function nextMonth() {
    setViewMonth(({ month, year }) => (month === 11 ? { month: 0, year: year + 1 } : { month: month + 1, year }));
  }

  const todayDate = startOfDay(new Date());
  const currentMonthDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
  const candidatePrevMonth = viewMonth.month === 0
    ? new Date(viewMonth.year - 1, 11, 1)
    : new Date(viewMonth.year, viewMonth.month - 1, 1);
  const prevMonthDisabled = candidatePrevMonth < currentMonthDate;
  const monthLabel = new Date(viewMonth.year, viewMonth.month, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });

  const firstDow = (new Date(viewMonth.year, viewMonth.month, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
  const cells: (string | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toISO(new Date(viewMonth.year, viewMonth.month, d)));
  while (cells.length % 7 !== 0) cells.push(null);

  function inRange(d: string) {
    return d > from && d < to;
  }
  function isEdge(d: string) {
    return d === from || d === to;
  }

  const displayFrom = fromISO(from).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
  const displayTo = fromISO(to).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/8 overflow-hidden">
      {/* Desde / Hasta */}
      <div className="grid grid-cols-2 divide-x divide-white/8 border-b border-white/8">
        <div className="px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Desde</div>
          <div className="text-sm font-semibold text-white/90">{displayFrom}</div>
        </div>
        <div className="px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Hasta</div>
          <div className="text-sm font-semibold text-white/90">{displayTo}</div>
        </div>
      </div>

      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={prevMonth}
            disabled={prevMonthDisabled}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-white/40 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-white/40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs font-semibold capitalize text-white/90">{monthLabel}</span>
          <button
            type="button"
            onClick={nextMonth}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-white/40 transition hover:bg-white/[0.07] hover:text-white"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-px mb-1.5">
          {["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"].map((l) => (
            <div key={l} className="text-center text-[10px] uppercase tracking-wider py-1 text-white/30">{l}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px">
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="h-8" />;
            // Un cierre que editás puede haber arrancado en el pasado (ya en
            // curso) — ese día sigue dibujándose como seleccionado aunque ya
            // no se pueda tocar (no se puede extender un cierre hacia atrás).
            const disabled = d < today;
            const edge = isEdge(d);
            const inR = inRange(d);
            const isToday = d === today;
            const fromEdge = d === from;
            const toEdge = d === to;
            return (
              <button
                key={d}
                type="button"
                disabled={disabled}
                aria-disabled={disabled}
                onClick={() => !disabled && handleSelectDay(d)}
                className={cn(
                  "h-8 w-full text-xs font-medium transition-all relative",
                  disabled && !edge && !inR
                    ? "cursor-not-allowed rounded-lg opacity-25"
                    : disabled
                      ? "cursor-not-allowed rounded-lg"
                      : edge
                        ? "rounded-lg z-10"
                        : inR
                          ? "rounded-none"
                          : "rounded-lg hover:bg-white/[0.06]",
                )}
                style={{
                  background: edge
                    ? "linear-gradient(135deg, oklch(0.65 0.24 25), oklch(0.65 0.22 10))"
                    : inR
                      ? "oklch(0.65 0.24 25 / 0.18)"
                      : disabled
                        ? "transparent"
                        : undefined,
                  color: edge
                    ? "#fff"
                    : inR
                      ? "rgba(255,255,255,0.9)"
                      : disabled
                        ? "rgba(255,255,255,0.18)"
                        : isToday
                          ? "oklch(0.72 0.22 25)"
                          : "rgba(255,255,255,0.8)",
                  boxShadow: !disabled && isToday && !edge ? "inset 0 0 0 1px oklch(0.65 0.24 25 / 0.5)" : undefined,
                  borderRadius: fromEdge && !toEdge ? "8px 0 0 8px" : toEdge && !fromEdge ? "0 8px 8px 0" : edge ? "8px" : inR ? "0" : "8px",
                }}
              >
                {new Date(d + "T12:00:00").getDate()}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-3 pb-3 text-center text-[10px] text-white/25">
        Tocá un día para un cierre de una fecha, o dos días para un rango
      </div>
    </div>
  );
}
