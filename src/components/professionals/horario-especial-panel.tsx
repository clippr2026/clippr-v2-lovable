import * as React from "react";
import { createPortal } from "react-dom";
import { CalendarClock, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SpecialDayEditor } from "@/components/settings/special-hours-editor";
import {
  parseTime,
  resolveDaySchedule,
  resolveSingleDay,
  toDateKey,
  type DaySchedule,
  type EmployeeSpecialDateMap,
  type ScheduleMap,
  type SpecialDateMap,
} from "@/lib/availability";

// "Horario especial" del Panel Profesional — mismo editor (SpecialDayEditor),
// misma precarga, misma confirmación de "el local está cerrado en ese
// horario" y misma persistencia (business_settings.schedule
// ._employeeSpecialDates) que la Agenda general. Acá el profesional solo
// puede crear/editar/quitar horarios especiales PARA SÍ MISMO: el editor
// recibe una única opción de profesional (él). Como la Agenda lee de la misma
// clave, lo que se guarda acá se ve solo en las dos agendas.

function parseDateKeyLocal(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function labelForDate(key: string) {
  return parseDateKeyLocal(key).toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit" });
}

function describeDay(day: DaySchedule) {
  if (day.enabled === false) return "No disponible";
  const base = `${day.start} a ${day.end}`;
  return day.breakStart && day.breakEnd ? `${base} · descanso ${day.breakStart}–${day.breakEnd}` : base;
}

// Persiste (o, con `day === null`, quita) el DaySchedule de (profesional,
// fecha). Misma lectura-modificación-escritura que la Agenda.
async function persistEmployeeSpecialDay(
  businessId: string,
  employeeId: string,
  dateKey: string,
  day: DaySchedule | null,
) {
  const { data: row } = await supabase
    .from("business_settings")
    .select("schedule")
    .eq("business_id", businessId)
    .maybeSingle();
  const sched = (row?.schedule ?? {}) as Record<string, any>;
  const empSpecial = (sched._employeeSpecialDates ?? {}) as Record<string, Record<string, unknown>>;
  const forEmp = { ...((empSpecial[employeeId] ?? {}) as Record<string, unknown>) };
  if (day) forEmp[dateKey] = day;
  else delete forEmp[dateKey];
  const next = { ...sched, _employeeSpecialDates: { ...empSpecial, [employeeId]: forEmp } };
  const { error } = await supabase
    .from("business_settings")
    .upsert({ business_id: businessId, schedule: next }, { onConflict: "business_id" });
  if (error) throw error;
}

type EditorState = { dateKey: string; value: DaySchedule; saving: boolean };

export function HorarioEspecialPanel({
  businessId,
  employeeId,
  employeeName,
  schedule,
  employeeSchedules,
  businessSpecialDates,
  employeeSpecialDates,
  onChanged,
  className,
  shortLabelOnMobile = false,
}: {
  businessId: string | null;
  employeeId: string | null;
  employeeName: string;
  schedule: ScheduleMap | null;
  employeeSchedules: Record<string, ScheduleMap>;
  businessSpecialDates: SpecialDateMap;
  employeeSpecialDates: EmployeeSpecialDateMap;
  onChanged?: () => void;
  className?: string;
  // En celular el botón muestra solo "Horario" (la fila de acciones es angosta).
  shortLabelOnMobile?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const todayKey = toDateKey(new Date());
  const [pickedKey, setPickedKey] = React.useState(todayKey);
  const [editor, setEditor] = React.useState<EditorState | null>(null);
  const [overrideConfirm, setOverrideConfirm] = React.useState<DaySchedule | null>(null);
  const [removingKey, setRemovingKey] = React.useState<string | null>(null);

  const own = React.useMemo(
    () =>
      Object.entries(employeeId ? employeeSpecialDates[employeeId] ?? {} : {})
        .filter(([key]) => key >= todayKey)
        .sort(([a], [b]) => a.localeCompare(b)),
    [employeeId, employeeSpecialDates, todayKey],
  );

  if (!businessId || !employeeId) return null;

  // Misma precarga que la Agenda: el horario PROPIO del profesional (especial
  // → semanal); si no tiene nada, el del negocio como sugerencia inicial.
  const buildValue = (dateKey: string): DaySchedule => {
    const date = parseDateKeyLocal(dateKey);
    const day = resolveDaySchedule(schedule, employeeSchedules ?? {}, businessSpecialDates ?? {}, employeeSpecialDates ?? {}, employeeId, date);
    const empOwn = resolveSingleDay(employeeSchedules[employeeId] ?? null, employeeSpecialDates?.[employeeId] ?? {}, date);
    const bizOwn = resolveSingleDay(schedule, businessSpecialDates ?? {}, date);
    const base = empOwn ?? bizOwn ?? day;
    return {
      enabled: day?.enabled !== false,
      start: base?.start ?? "11:00",
      end: base?.end ?? "20:00",
      breakStart: base?.breakStart || undefined,
      breakEnd: base?.breakEnd || undefined,
    };
  };

  const openEditor = (dateKey: string) => {
    if (dateKey < todayKey) {
      toast.error("No podés editar un horario que ya pasó.");
      return;
    }
    setEditor({ dateKey, value: buildValue(dateKey), saving: false });
  };

  const save = async (day: DaySchedule, confirmedOverride = false) => {
    if (!editor) return;
    // Igual que en la Agenda: si queda disponible fuera del horario del
    // negocio (o el negocio cierra ese día), se pide confirmación primero.
    if (day.enabled && !confirmedOverride) {
      const date = parseDateKeyLocal(editor.dateKey);
      const bizDay = resolveSingleDay(schedule, businessSpecialDates ?? {}, date);
      const bizClosed = !bizDay || bizDay.enabled === false;
      const outOfBizHours =
        !bizClosed && bizDay != null && (parseTime(day.start) < parseTime(bizDay.start) || parseTime(day.end) > parseTime(bizDay.end));
      if (bizClosed || outOfBizHours) {
        setOverrideConfirm(day);
        return;
      }
    }
    setOverrideConfirm(null);
    setEditor((s) => (s ? { ...s, saving: true } : s));
    try {
      await persistEmployeeSpecialDay(businessId, employeeId, editor.dateKey, day);
      toast.success("Horario especial guardado.");
      setEditor(null);
      onChanged?.();
    } catch {
      toast.error("No se pudo guardar el horario especial. Probá de nuevo.");
      setEditor((s) => (s ? { ...s, saving: false } : s));
    }
  };

  const remove = async (dateKey: string) => {
    setRemovingKey(dateKey);
    try {
      await persistEmployeeSpecialDay(businessId, employeeId, dateKey, null);
      toast.success("Horario especial quitado.");
      onChanged?.();
    } catch {
      toast.error("No se pudo quitar el horario especial. Probá de nuevo.");
    } finally {
      setRemovingKey(null);
    }
  };

  const overlay = (children: React.ReactNode, z: string, onClose: () => void) =>
    typeof document === "undefined"
      ? null
      : createPortal(
          <div className={`fixed inset-0 ${z} flex items-center justify-center bg-black/60 backdrop-blur-sm p-4`} onClick={onClose}>
            <div
              className="w-full max-w-sm max-h-[85dvh] overflow-y-auto rounded-2xl bg-[#15161c] ring-1 ring-white/10 p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </div>
          </div>,
          document.body,
        );

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setPickedKey(todayKey);
          setOpen(true);
        }}
        className={
          className ??
          "inline-flex h-9 items-center gap-1 sm:gap-1.5 whitespace-nowrap rounded-xl bg-white/5 px-2.5 sm:px-3 text-xs font-semibold text-foreground ring-1 ring-white/10 transition hover:bg-white/10"
        }
      >
        <CalendarClock className="h-4 w-4 shrink-0 text-violet-300" />
        {shortLabelOnMobile ? (
          <>
            <span className="sm:hidden">Horario</span>
            <span className="hidden sm:inline">Horario especial</span>
          </>
        ) : (
          "Horario especial"
        )}
      </button>

      {open && !editor
        ? overlay(
            <>
              <div className="text-lg font-semibold">Horario especial</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Cambiá tu horario para un día puntual. Se ve en tu agenda y en la Agenda general.
              </p>

              <label className="mt-4 block text-xs font-medium text-muted-foreground">Día</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="date"
                  min={todayKey}
                  value={pickedKey}
                  onChange={(e) => setPickedKey(e.target.value)}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-violet-300/40"
                />
                <button
                  type="button"
                  disabled={!pickedKey}
                  onClick={() => pickedKey && openEditor(pickedKey)}
                  className="h-11 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Elegir
                </button>
              </div>

              <div className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-white/40">Tus horarios especiales</div>
              {own.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Todavía no tenés horarios especiales cargados.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {own.map(([key, day]) => (
                    <li key={key} className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium capitalize">{labelForDate(key)}</div>
                        <div className="truncate text-xs text-muted-foreground">{describeDay(day)}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditor(key)}
                          aria-label="Editar"
                          className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-muted-foreground ring-1 ring-white/10 hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={removingKey === key}
                          onClick={() => remove(key)}
                          aria-label="Quitar"
                          className="grid h-8 w-8 place-items-center rounded-lg bg-rose-500/10 text-rose-300 ring-1 ring-rose-400/25 hover:bg-rose-500/20 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-5 h-11 w-full rounded-xl bg-white/5 text-sm text-muted-foreground ring-1 ring-white/10 hover:text-foreground"
              >
                Cerrar
              </button>
            </>,
            "z-[120]",
            () => setOpen(false),
          )
        : null}

      {editor ? (
        <SpecialDayEditor
          date={parseDateKeyLocal(editor.dateKey)}
          value={editor.value}
          allowBreak
          closedLabel="No disponible"
          saving={editor.saving}
          professionals={[{ id: employeeId, full_name: employeeName }]}
          selectedEmployeeId={employeeId}
          onSelectEmployee={() => {}}
          onSave={save}
          onCancel={() => {
            setOverrideConfirm(null);
            setEditor(null);
          }}
        />
      ) : null}

      {overrideConfirm && editor
        ? overlay(
            <>
              <div className="text-lg font-semibold">El local está cerrado en ese horario</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {employeeName} quedaría disponible de {overrideConfirm.start} a {overrideConfirm.end}, un horario en el que el
                negocio está cerrado (o tiene un horario distinto) ese día. ¿Querés habilitarlo igual?
              </p>
              <div className="mt-5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOverrideConfirm(null)}
                  className="h-11 flex-1 rounded-xl bg-white/5 px-4 text-sm text-muted-foreground ring-1 ring-white/10 hover:text-foreground"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => save(overrideConfirm, true)}
                  className="h-11 flex-1 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 text-sm font-semibold text-white"
                >
                  Habilitar igual
                </button>
              </div>
            </>,
            "z-[130]",
            () => setOverrideConfirm(null),
          )
        : null}
    </>
  );
}
