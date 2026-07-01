import * as React from "react";
import { Plus, X, Pencil, XCircle } from "lucide-react";
import { toast } from "sonner";
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

function toMin(time: string): number {
  const [h, m] = String(time || "0:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Estado de edición de un horario especial (una fecha).
export type SpecialFormState = {
  available: boolean;
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
};

// Construye el DaySchedule canónico desde el estado del formulario. Es la MISMA
// forma que persiste Configuración → Equipo → Horario especial:
//   { enabled, start, end, breakStart?, breakEnd? }
// Si no hay descanso, no se incluyen breakStart/breakEnd.
export function buildSpecialDay(state: SpecialFormState, allowBreak: boolean): DaySchedule {
  if (!state.available) return { enabled: false, start: "00:00", end: "00:00" };
  return {
    enabled: true,
    start: state.start,
    end: state.end,
    breakStart: allowBreak && state.breakStart ? state.breakStart : undefined,
    breakEnd: allowBreak && state.breakEnd ? state.breakEnd : undefined,
  };
}

// Inicializa el estado del formulario desde un DaySchedule existente
// (precarga: disponible + desde/hasta + descanso actual si lo hay).
export function specialStateFromDay(day: DaySchedule | null | undefined): SpecialFormState {
  return {
    available: day?.enabled !== false,
    start: day?.start || "09:00",
    end: day?.end || "15:00",
    breakStart: day?.breakStart || "",
    breakEnd: day?.breakEnd || "",
  };
}

// Campos compartidos del editor de horario especial (toggle Disponible/No
// disponible + desde/hasta + descanso). ÚNICA fuente de verdad de la UI; la usan
// tanto Configuración (lista por negocio/profesional) como la Agenda (una fecha).
function SpecialDayFields({
  state,
  onChange,
  allowBreak = false,
  closedLabel = "Cerrado",
}: {
  state: SpecialFormState;
  onChange: (patch: Partial<SpecialFormState>) => void;
  allowBreak?: boolean;
  closedLabel?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ available: !state.available })}
          className={cn(
            "h-5 w-9 rounded-full relative transition-colors shrink-0",
            state.available ? "bg-primary" : "bg-white/15",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
              state.available ? "left-[18px]" : "left-0.5",
            )}
          />
        </button>
        <span className="text-sm">{state.available ? "Disponible" : closedLabel}</span>
      </div>

      {state.available && (
        <div className="space-y-3">
          {/* Fila 1 — Disponible: desde / hasta */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">Disponible:</span>
            <input
              type="time"
              value={state.start}
              onChange={(e) => onChange({ start: e.target.value })}
              className={timeCls}
            />
            <span className="text-muted-foreground text-xs">a</span>
            <input
              type="time"
              value={state.end}
              onChange={(e) => onChange({ end: e.target.value })}
              className={timeCls}
            />
          </div>

          {/* Fila 2 — Descanso: desde / hasta */}
          {allowBreak && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">Descanso:</span>
              <input
                type="time"
                value={state.breakStart}
                onChange={(e) => onChange({ breakStart: e.target.value })}
                className={timeCls}
              />
              <span className="text-muted-foreground text-xs">-</span>
              <input
                type="time"
                value={state.breakEnd}
                onChange={(e) => onChange({ breakEnd: e.target.value })}
                className={timeCls}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Valida desde/hasta y descanso. Devuelve un mensaje de error o null.
function validateSpecial(state: SpecialFormState, allowBreak: boolean): string | null {
  if (!state.available) return null;
  if (toMin(state.end) <= toMin(state.start)) {
    return "La hora de fin debe ser posterior a la de inicio.";
  }
  if (allowBreak && state.breakStart && state.breakEnd && toMin(state.breakEnd) <= toMin(state.breakStart)) {
    return "El descanso hasta debe ser posterior al descanso desde.";
  }
  return null;
}

/**
 * Editor de UNA fecha (modal autocontenido). Reutiliza EXACTAMENTE los mismos
 * campos que Configuración. La fecha es fija (no hay calendario); se precarga con
 * `value` (horario resuelto del día, incluido el descanso actual). Al guardar,
 * entrega un DaySchedule listo para persistir en `_employeeSpecialDates`.
 */
export function SpecialDayEditor({
  date,
  value,
  allowBreak = false,
  closedLabel = "Cerrado",
  saving = false,
  professionals,
  selectedEmployeeId,
  onSelectEmployee,
  onBlock,
  onSave,
  onCancel,
}: {
  date: Date;
  value: DaySchedule;
  allowBreak?: boolean;
  closedLabel?: string;
  saving?: boolean;
  professionals?: { id: string; full_name?: string | null; name?: string | null }[];
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (employeeId: string) => void;
  onBlock?: () => void;
  onSave: (day: DaySchedule) => void;
  onCancel: () => void;
}) {
  const [state, setState] = React.useState<SpecialFormState>(() => specialStateFromDay(value));
  const patch = (p: Partial<SpecialFormState>) => setState((s) => ({ ...s, ...p }));

  const handleSave = () => {
    const err = validateSpecial(state, allowBreak);
    if (err) {
      toast.error(err);
      return;
    }
    onSave(buildSpecialDay(state, allowBreak));
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={() => !saving && onCancel()}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[#15161c] ring-1 ring-white/10 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-lg font-semibold">Horario especial</div>
        <p className="text-sm text-muted-foreground mt-1 capitalize">
          {date.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit" })}
        </p>

        {professionals && professionals.length > 0 && (
          <label className="mt-4 block space-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
              Profesional
            </span>
            <select
              value={selectedEmployeeId ?? ""}
              onChange={(event) => onSelectEmployee?.(event.target.value)}
              disabled={saving}
              className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition focus:border-violet-300/45 disabled:opacity-50"
            >
              <option value="">Seleccionar profesional</option>
              {professionals.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.full_name ?? employee.name ?? "Sin nombre"}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-4">
          <SpecialDayFields state={state} onChange={patch} allowBreak={allowBreak} closedLabel={closedLabel} />
        </div>

        {onBlock && (
          <button
            type="button"
            onClick={onBlock}
            disabled={saving}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 text-sm font-semibold text-amber-200 transition hover:bg-amber-300/15 disabled:opacity-50"
          >
            <XCircle className="h-4 w-4" />
            Bloquear horario
          </button>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-4 py-2.5 text-sm disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-xl bg-white/5 ring-1 ring-white/10 px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Editor de horarios especiales por fecha (lista). Reutilizable para el negocio y
 * para cada profesional. Mantiene su propio estado de edición y notifica cambios
 * al padre vía onChange con el mapa completo `{ "YYYY-MM-DD": DaySchedule }`.
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
  const [form, setForm] = React.useState<SpecialFormState>(() => specialStateFromDay(null));

  const entries = React.useMemo(
    () => Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
    [value],
  );

  const patchForm = (patch: Partial<SpecialFormState>) => setForm((f) => ({ ...f, ...patch }));

  const resetForm = () => setForm(specialStateFromDay(null));

  const loadIntoForm = (key: string) => {
    setDate(keyToDate(key));
    setForm(specialStateFromDay(value[key]));
    setOpen(true);
  };

  const add = () => {
    const err = validateSpecial(form, allowBreak);
    if (err) {
      toast.error(err);
      return;
    }
    const key = toDateKey(date);
    onChange({ ...value, [key]: buildSpecialDay(form, allowBreak) });
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

          <SpecialDayFields state={form} onChange={patchForm} allowBreak={allowBreak} closedLabel={closedLabel} />

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
