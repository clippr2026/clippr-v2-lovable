import * as React from "react";
import { Plus, X, Pencil } from "lucide-react";
import { DarkCalendar } from "@/components/agenda/dark-calendar";
import { toDateKey, type SpecialDateMap, type DaySchedule } from "@/components/agenda/use-agenda-data";
import { cn } from "@/lib/utils";

const timeCls =
  "rounded-lg bg-white/5 ring-1 ring-white/10 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50";

// "YYYY-MM-DD" → Date local (mediodía para evitar saltos por zona horaria).
function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

// "YYYY-MM-DD" → "DD/MM".
function keyToLabel(key: string): string {
  const [, m, d] = key.split("-");
  return `${d}/${m}`;
}

/**
 * Editor de horarios especiales por fecha. Reutilizable para el negocio y para
 * cada profesional. Mantiene su propio estado de edición y notifica cambios al
 * padre vía onChange con el mapa completo `{ "YYYY-MM-DD": DaySchedule }`.
 */
export function SpecialHoursEditor({
  value,
  onChange,
  allowBreak = false,
  closedLabel = "Cerrado",
  title = "Horario especial",
  description,
}: {
  value: SpecialDateMap;
  onChange: (next: SpecialDateMap) => void;
  allowBreak?: boolean;
  closedLabel?: string;
  title?: string;
  description?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState<Date>(() => new Date());
  const [available, setAvailable] = React.useState(true);
  const [start, setStart] = React.useState("09:00");
  const [end, setEnd] = React.useState("15:00");
  const [breakStart, setBreakStart] = React.useState("");
  const [breakEnd, setBreakEnd] = React.useState("");

  const entries = React.useMemo(
    () => Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
    [value],
  );

  const resetForm = () => {
    setAvailable(true);
    setStart("09:00");
    setEnd("15:00");
    setBreakStart("");
    setBreakEnd("");
  };

  const loadIntoForm = (key: string) => {
    const d = value[key];
    setDate(keyToDate(key));
    setAvailable(d.enabled !== false);
    setStart(d.start || "09:00");
    setEnd(d.end || "15:00");
    setBreakStart(d.breakStart || "");
    setBreakEnd(d.breakEnd || "");
    setOpen(true);
  };

  const add = () => {
    const key = toDateKey(date);
    const day: DaySchedule = available
      ? {
          enabled: true,
          start,
          end,
          breakStart: allowBreak && breakStart ? breakStart : undefined,
          breakEnd: allowBreak && breakEnd ? breakEnd : undefined,
        }
      : { enabled: false, start: "00:00", end: "00:00" };
    onChange({ ...value, [key]: day });
    setOpen(false);
    resetForm();
  };

  const removeKey = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  return (
    <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{title}</div>
          {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => {
              resetForm();
              setDate(new Date());
              setOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 ring-1 ring-white/10 px-2.5 py-1.5 text-xs hover:bg-white/10"
          >
            <Plus className="h-3.5 w-3.5" /> Habilitar horario especial
          </button>
        )}
      </div>

      {entries.length > 0 && (
        <div className="divide-y divide-white/5">
          {entries.map(([key, d]) => (
            <div key={key} className="flex items-center justify-between gap-3 py-2">
              <button
                type="button"
                onClick={() => loadIntoForm(key)}
                className="flex items-center gap-2 text-sm hover:text-primary"
              >
                <Pencil className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{keyToLabel(key)}</span>
                <span className="text-muted-foreground">
                  {d.enabled === false
                    ? closedLabel
                    : `${d.start} – ${d.end}${d.breakStart && d.breakEnd ? ` · descanso ${d.breakStart}-${d.breakEnd}` : ""}`}
                </span>
              </button>
              <button
                type="button"
                onClick={() => removeKey(key)}
                className="text-muted-foreground hover:text-red-400"
                aria-label="Quitar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="rounded-lg bg-black/20 ring-1 ring-white/10 p-3 space-y-3">
          <DarkCalendar value={date} onSelect={setDate} />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAvailable((v) => !v)}
              className={cn(
                "h-5 w-9 rounded-full relative transition-colors shrink-0",
                available ? "bg-primary" : "bg-white/15",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                  available ? "left-[18px]" : "left-0.5",
                )}
              />
            </button>
            <span className="text-sm">{available ? "Disponible" : closedLabel}</span>
          </div>

          {available && (
            <div className="flex items-center gap-2 flex-wrap">
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={timeCls} />
              <span className="text-muted-foreground text-xs">a</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={timeCls} />
              {allowBreak && (
                <>
                  <span className="text-xs text-muted-foreground ml-2">Descanso:</span>
                  <input type="time" value={breakStart} onChange={(e) => setBreakStart(e.target.value)} className={timeCls} />
                  <span className="text-muted-foreground text-xs">-</span>
                  <input type="time" value={breakEnd} onChange={(e) => setBreakEnd(e.target.value)} className={timeCls} />
                </>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={add}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-3 py-1.5 text-xs"
            >
              Guardar fecha
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
              className="rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
