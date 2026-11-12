import * as React from "react";
import { createPortal } from "react-dom";
import { Plus, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import { DarkCalendar } from "@/components/agenda/dark-calendar";
import { toDateKey, type SpecialDateMap, type DaySchedule } from "@/components/agenda/use-agenda-data";
import { Toggle } from "@/components/settings/shared";

const timeCls =
  "h-10 rounded-lg bg-white/5 ring-1 ring-white/10 px-2.5 text-sm focus:outline-none focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50";

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
  // Switch independiente: el descanso no tiene que estar siempre habilitado.
  // Cuando está apagado, breakStart/breakEnd se preservan en el estado local
  // (para no perder lo tipeado si el usuario reactiva el switch) pero NO se
  // persisten — ver buildSpecialDay.
  breakEnabled: boolean;
  breakStart: string;
  breakEnd: string;
};

// Construye el DaySchedule canónico desde el estado del formulario. Es la MISMA
// forma que persiste Configuración → Equipo → Horario especial:
//   { enabled, start, end, breakStart?, breakEnd? }
// Si no hay descanso (switch apagado o campos incompletos), no se incluyen
// breakStart/breakEnd — su ausencia es la señal de "sin descanso" en todo el
// motor de disponibilidad (@/lib/availability).
export function buildSpecialDay(state: SpecialFormState, allowBreak: boolean): DaySchedule {
  if (!state.available) return { enabled: false, start: "00:00", end: "00:00" };
  const hasBreak = allowBreak && state.breakEnabled && !!state.breakStart && !!state.breakEnd;
  return {
    enabled: true,
    start: state.start,
    end: state.end,
    breakStart: hasBreak ? state.breakStart : undefined,
    breakEnd: hasBreak ? state.breakEnd : undefined,
  };
}

// Inicializa el estado del formulario desde un DaySchedule existente
// (precarga: disponible + desde/hasta + descanso actual si lo hay).
export function specialStateFromDay(day: DaySchedule | null | undefined): SpecialFormState {
  return {
    available: day?.enabled !== false,
    start: day?.start || "09:00",
    end: day?.end || "15:00",
    breakEnabled: Boolean(day?.breakStart && day?.breakEnd),
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
      <div className="flex items-center gap-2.5 py-0.5">
        <Toggle on={state.available} onChange={(v) => onChange({ available: v })} />
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

          {/* Fila 2 — Descanso: switch independiente + desde / hasta.
              El descanso no tiene que estar siempre habilitado; con el
              switch apagado no hay descanso ese día y los campos quedan
              ocultos. */}
          {allowBreak && (
            <div className="space-y-2 border-t border-white/5 pt-3">
              <div className="flex items-center gap-2.5 py-0.5">
                <Toggle on={state.breakEnabled} onChange={(v) => onChange({ breakEnabled: v })} />
                <span className="text-sm">Descanso</span>
              </div>
              {state.breakEnabled && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="w-20 shrink-0 text-xs text-muted-foreground">Desde/hasta:</span>
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
      )}
    </div>
  );
}

// Versión "tarjetas" del editor de una fecha (Agenda / Mi Panel): el horario disponible y el
// descanso van en tarjetas separadas, con "Desde ... hasta ...".
const CARD_GLOW =
  "[background-image:radial-gradient(110%_90%_at_100%_0%,rgba(79,125,255,0.16),transparent_62%),radial-gradient(90%_80%_at_0%_100%,rgba(139,92,246,0.12),transparent_65%)]";

function SpecialDayCards({
  state,
  onChange,
  allowBreak,
  closedLabel,
}: {
  state: SpecialFormState;
  onChange: (patch: Partial<SpecialFormState>) => void;
  allowBreak: boolean;
  closedLabel: string;
}) {
  return (
    <>
      <div className={"mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 " + CARD_GLOW}>
        <div className="flex items-center gap-2.5 py-0.5">
          <Toggle on={state.available} onChange={(v) => onChange({ available: v })} />
          <span className="text-sm font-semibold">{state.available ? "Horario disponible" : closedLabel}</span>
        </div>
        {state.available && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">Desde</span>
            <input type="time" value={state.start} onChange={(e) => onChange({ start: e.target.value })} className={timeCls} />
            <span className="text-xs text-muted-foreground">hasta</span>
            <input type="time" value={state.end} onChange={(e) => onChange({ end: e.target.value })} className={timeCls} />
          </div>
        )}
      </div>

      {allowBreak && state.available && (
        <div className={"mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 " + CARD_GLOW}>
          <div className="flex items-center gap-2.5 py-0.5">
            <Toggle on={state.breakEnabled} onChange={(v) => onChange({ breakEnabled: v })} />
            <span className="text-sm font-semibold">Descanso</span>
          </div>
          {state.breakEnabled && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="w-12 shrink-0 text-xs text-muted-foreground">Desde</span>
              <input type="time" value={state.breakStart} onChange={(e) => onChange({ breakStart: e.target.value })} className={timeCls} />
              <span className="text-xs text-muted-foreground">hasta</span>
              <input type="time" value={state.breakEnd} onChange={(e) => onChange({ breakEnd: e.target.value })} className={timeCls} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Valida desde/hasta y descanso. Devuelve un mensaje de error o null.
function validateSpecial(state: SpecialFormState, allowBreak: boolean): string | null {
  if (!state.available) return null;
  if (toMin(state.end) <= toMin(state.start)) {
    return "La hora de fin debe ser posterior a la de inicio.";
  }
  if (allowBreak && state.breakEnabled) {
    if (!state.breakStart || !state.breakEnd) {
      return "Completá el horario de descanso o desactivá el interruptor.";
    }
    if (toMin(state.breakEnd) <= toMin(state.breakStart)) {
      return "El descanso hasta debe ser posterior al descanso desde.";
    }
  }
  return null;
}

/**
 * ¿Algún turno agendado queda fuera del horario nuevo? Devuelve el aviso (o null si no hay problema).
 * Los cancelados y los bloqueos no cuentan: solo turnos reales.
 */
export function findScheduleConflict(
  day: DaySchedule,
  turnos: Array<{ starts_at: string; ends_at?: string | null; status: string; client_name?: string | null }>,
): string | null {
  const reales = turnos.filter((t) => !["cancelled", "blocked"].includes(t.status));
  if (reales.length === 0) return null;
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const fuera = reales.filter((t) => {
    if (!day.enabled) return true;
    const a = new Date(t.starts_at);
    const b = t.ends_at ? new Date(t.ends_at) : new Date(a.getTime() + 30 * 60_000);
    const aMin = a.getHours() * 60 + a.getMinutes();
    const bMin = b.getHours() * 60 + b.getMinutes() || 24 * 60;
    return aMin < toMin(day.start) || bMin > toMin(day.end);
  });
  if (fuera.length === 0) return null;
  fuera.sort((x, y) => new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime());
  const lista = fuera
    .slice(0, 3)
    .map((t) => `${hhmm(new Date(t.starts_at))}${t.client_name ? ` (${t.client_name})` : ""}`)
    .join(", ");
  return `Ya hay ${fuera.length === 1 ? "un turno agendado" : `${fuera.length} turnos agendados`} fuera del nuevo horario: ${lista}${fuera.length > 3 ? "…" : ""}. Reprogramá o cancelá ${fuera.length === 1 ? "el turno" : "los turnos"} antes de cambiar el horario.`;
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
  onBlocks,
  editBlock,
  checkConflict,
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
  /** Si se pasa, el editor muestra el interruptor "Bloquear horas" (uno o varios tramos del mismo día). Devuelve true si se guardó. */
  onBlocks?: (ranges: { start: string; end: string }[], label: string) => Promise<boolean>;
  /** Si se pasa, el editor abre con "Bloquear horas" activado y con los datos de ese bloqueo (se actualiza en vez de crear uno nuevo). */
  editBlock?: { start: string; end: string; label: string } | null;
  /** Se llama antes de guardar: si devuelve un texto, no se guarda y se muestra ese aviso. */
  checkConflict?: (day: DaySchedule) => string | null;
  onSave: (day: DaySchedule) => void;
  onCancel: () => void;
}) {
  const [state, setState] = React.useState<SpecialFormState>(() => specialStateFromDay(value));
  const patch = (p: Partial<SpecialFormState>) => setState((s) => ({ ...s, ...p }));

  const [blockOn, setBlockOn] = React.useState(Boolean(editBlock));
  const [blocks, setBlocks] = React.useState<{ start: string; end: string }[]>(editBlock ? [{ start: editBlock.start, end: editBlock.end }] : []);
  const [blockLabel, setBlockLabel] = React.useState(editBlock?.label ?? "");
  const [busy, setBusy] = React.useState(false);

  const plusHour = (time: string) => {
    const m = Math.min(23 * 60 + 59, toMin(time) + 60);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };
  const toggleBlock = (on: boolean) => {
    setBlockOn(on);
    if (on && blocks.length === 0) {
      const start = state.breakStart && toMin(state.breakEnd) > toMin(state.breakStart) ? state.breakStart : state.start || "11:00";
      const end = state.breakStart && toMin(state.breakEnd) > toMin(state.breakStart) ? state.breakEnd : plusHour(start);
      setBlocks([{ start, end }]);
    }
  };
  const addBlock = () =>
    setBlocks((list) => {
      const last = list[list.length - 1];
      const start = last?.end || state.start || "11:00";
      return [...list, { start, end: plusHour(start) }];
    });
  const patchBlock = (i: number, p: Partial<{ start: string; end: string }>) =>
    setBlocks((list) => list.map((b, idx) => (idx === i ? { ...b, ...p } : b)));

  const handleSave = async () => {
    const err = validateSpecial(state, allowBreak);
    if (err) {
      toast.error(err);
      return;
    }
    const aviso = checkConflict?.(buildSpecialDay(state, allowBreak)) ?? null;
    if (aviso) {
      toast.error(aviso, { duration: 9000 });
      return;
    }
    if (onBlocks && blockOn) {
      for (const b of blocks) {
        if (!b.start || !b.end || toMin(b.end) <= toMin(b.start)) {
          toast.error("En cada bloqueo, la hora hasta debe ser posterior a la hora desde.");
          return;
        }
      }
      const sorted = [...blocks].sort((a, b) => toMin(a.start) - toMin(b.start));
      for (let i = 1; i < sorted.length; i++) {
        if (toMin(sorted[i].start) < toMin(sorted[i - 1].end)) {
          toast.error("Los horarios bloqueados no pueden superponerse.");
          return;
        }
      }
      setBusy(true);
      const ok = await onBlocks(blocks, blockLabel.trim());
      setBusy(false);
      if (!ok) return;
      // Ya quedaron guardados: si el guardado del horario pide confirmación, no se vuelven a crear.
      if (!editBlock) {
        setBlockOn(false);
        setBlocks([]);
      }
    }
    onSave(buildSpecialDay(state, allowBreak));
  };

  if (typeof document === "undefined") return null;

  // createPortal a document.body: este editor se abre tanto desde la Agenda
  // (dentro de <AppShell>, que envuelve la página en un <div className="relative
  // z-10">) como desde Configuración → Equipo. Sin portal, ese wrapper crea su
  // propio stacking context y este modal queda atrapado compitiendo solo
  // contra sus hermanos ahí adentro, nunca contra la barra inferior de
  // navegación (fixed, z-40, pero hermana de <main> en el árbol raíz) — sin
  // importar el z-index que tenga.
  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-3"
      onClick={() => !saving && onCancel()}
    >
      <div
        className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-[28px] border border-violet-400/45 bg-[#08070f] p-5 shadow-[0_0_0_1px_rgba(139,92,246,0.35),0_30px_90px_-20px_rgba(0,0,0,0.9),0_0_60px_-18px_rgba(139,92,246,0.55)] [background-image:radial-gradient(120%_45%_at_85%_0%,rgba(79,125,255,0.20),transparent_60%),radial-gradient(110%_50%_at_0%_100%,rgba(139,92,246,0.22),transparent_62%)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-display text-[22px] font-semibold leading-tight tracking-tight">Horario especial</div>
        <p className="mt-1 text-sm capitalize text-white/60">
          {date.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit" })}
        </p>

        {professionals && professionals.length > 0 && (
          <label className="mt-4 block space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 [background-image:radial-gradient(110%_90%_at_100%_0%,rgba(79,125,255,0.16),transparent_62%),radial-gradient(90%_80%_at_0%_100%,rgba(139,92,246,0.12),transparent_65%)]">
            <span className="text-sm font-semibold text-white">
              Profesional
            </span>
            <select
              value={selectedEmployeeId ?? ""}
              onChange={(event) => onSelectEmployee?.(event.target.value)}
              disabled={saving}
              className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition focus:border-violet-300/45 disabled:opacity-50"
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

        <SpecialDayCards state={state} onChange={patch} allowBreak={allowBreak} closedLabel={closedLabel} />

        {/* Bloquear horas: interruptor con uno o varios tramos "desde / hasta" del mismo día. */}
        {onBlocks && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 [background-image:radial-gradient(110%_90%_at_100%_0%,rgba(79,125,255,0.16),transparent_62%),radial-gradient(90%_80%_at_0%_100%,rgba(139,92,246,0.12),transparent_65%)]">
            <div className="flex items-center gap-2.5 py-0.5">
              <Toggle on={blockOn} onChange={toggleBlock} />
              <span className="text-sm">Bloquear horas</span>
            </div>
            {blockOn && (
              <div className="mt-3 space-y-3">
                <label className="block text-sm font-semibold">
                  Motivo (opcional)
                  <input
                    value={blockLabel}
                    onChange={(e) => setBlockLabel(e.target.value)}
                    placeholder="Ej: Almuerzo, trámite"
                    className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none focus:border-violet-300/45"
                  />
                </label>
                {blocks.map((b, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="w-14 shrink-0 text-xs text-muted-foreground">Desde</span>
                    <input type="time" value={b.start} onChange={(e) => patchBlock(i, { start: e.target.value })} className={timeCls} />
                    <span className="text-muted-foreground text-xs">hasta</span>
                    <input type="time" value={b.end} onChange={(e) => patchBlock(i, { end: e.target.value })} className={timeCls} />
                    {blocks.length > 1 && (
                      <button
                        type="button"
                        aria-label="Quitar este horario"
                        onClick={() => setBlocks((list) => list.filter((_, idx) => idx !== i))}
                        className="grid h-8 w-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
                {!editBlock && (
                <button
                  type="button"
                  onClick={addBlock}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.04] text-sm font-medium text-white/85 transition hover:bg-white/[0.08]"
                >
                  <Plus className="h-4 w-4" />
                  Agregar otro horario
                </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || busy}
            className="h-11 flex-1 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-4 text-sm shadow-lg shadow-violet-500/30 ring-1 ring-white/25 disabled:opacity-50"
          >
            {saving || busy ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="h-11 rounded-full bg-white/5 ring-1 ring-white/15 px-5 text-sm text-white/80 hover:text-white disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
