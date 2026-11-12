import * as React from "react";
import { createPortal } from "react-dom";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { SpecialDayEditor, findScheduleConflict } from "@/components/settings/special-hours-editor";
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

// Bloqueo puntual de horas del profesional: mismo registro que "Bloquear horas" de la Agenda
// (un turno con estado "blocked" a su nombre), así la Agenda y la capacidad lo respetan.
type BlockState = { dateKey: string; startH: string; startM: string; endH: string; endM: string; label: string; saving: boolean };

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];
const selectClass = "h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none focus:border-violet-300/45";

export function HorarioEspecialPanel({
  businessId,
  employeeId,
  employeeName,
  schedule,
  employeeSchedules,
  businessSpecialDates,
  employeeSpecialDates,
  dateKey,
  onChanged,
  className,
  shortLabelOnMobile = false,
  fillOnMobile = false,
  existingTurnos = [],
}: {
  businessId: string | null;
  employeeId: string | null;
  employeeName: string;
  schedule: ScheduleMap | null;
  employeeSchedules: Record<string, ScheduleMap>;
  businessSpecialDates: SpecialDateMap;
  employeeSpecialDates: EmployeeSpecialDateMap;
  // Día que el profesional tiene abierto en su agenda: "Horario" abre el
  // editor de ESE día, igual que tocar un casillero en la Agenda general.
  dateKey: string;
  onChanged?: () => void;
  className?: string;
  // En celular el botón muestra solo "Horario" (la fila de acciones es angosta).
  shortLabelOnMobile?: boolean;
  // En celular el botón se reparte el ancho de la fila con sus vecinos.
  fillOnMobile?: boolean;
  /** Turnos del profesional (para avisar si el nuevo horario deja turnos afuera). */
  existingTurnos?: Array<{ starts_at: string; ends_at?: string | null; status: string; client_name?: string | null }>;
}) {
  const todayKey = toDateKey(new Date());
  const [editor, setEditor] = React.useState<EditorState | null>(null);
  const [overrideConfirm, setOverrideConfirm] = React.useState<DaySchedule | null>(null);
  const [block, setBlock] = React.useState<BlockState | null>(null);
  const { activeBranchId, profile } = useAuth();

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

  // "Bloquear horas" dentro del editor: uno o varios tramos del día abierto.
  const saveBlocks = async (ranges: { start: string; end: string }[], label: string) => {
    if (!editor) return false;
    const rows = [];
    for (const r of ranges) {
      const startsAt = new Date(`${editor.dateKey}T${r.start}:00`);
      const endsAt = new Date(`${editor.dateKey}T${r.end}:00`);
      if (startsAt.getTime() < Date.now()) {
        toast.error("No podés bloquear horarios que ya pasaron.");
        return false;
      }
      rows.push({
        business_id: businessId,
        branch_id: activeBranchId,
        client_id: null,
        client_name: label || "Horario bloqueado",
        employee_id: employeeId,
        service_name: "Bloqueo de horario",
        service_price: 0,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        duration_min: Math.max(15, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000)),
        status: "blocked",
        notes: label ? `Horario bloqueado: ${label}` : "Horario bloqueado desde el Panel Profesional",
        created_by_name: profile?.full_name ?? null,
        created_by_role: profile?.role ?? null,
        updated_at: new Date().toISOString(),
      });
    }
    const { error } = await supabase.from("appointments").insert(rows as any);
    if (error) {
      toast.error("No se pudo bloquear el horario. Probá de nuevo.");
      return false;
    }
    return true;
  };

  // (Anterior) "Bloquear horas": acción independiente del switch Descanso. Si Descanso tiene un rango
  // válido, arranca con ese; si no, desde el inicio del horario del día (1 hora).
  const openBlock = (breakStart: string, breakEnd: string) => {
    if (!editor) return;
    const hasRange = Boolean(breakStart && breakEnd && breakEnd > breakStart && breakStart !== "00:00");
    const start = hasRange ? breakStart : editor.value.start || "11:00";
    const [sh, sm] = start.split(":");
    let endH: string;
    let endM: string;
    if (hasRange) {
      [endH, endM] = breakEnd.split(":");
    } else {
      endH = String(Math.min(23, Number(sh) + 1)).padStart(2, "0");
      endM = sm;
    }
    const nearest = (m: string) => MINUTES.reduce((a, b) => (Math.abs(Number(b) - Number(m)) < Math.abs(Number(a) - Number(m)) ? b : a));
    setBlock({ dateKey: editor.dateKey, startH: sh, startM: nearest(sm), endH, endM: nearest(endM), label: "", saving: false });
  };

  const saveBlock = async () => {
    if (!block) return;
    const startsAt = new Date(`${block.dateKey}T${block.startH}:${block.startM}:00`);
    const endsAt = new Date(`${block.dateKey}T${block.endH}:${block.endM}:00`);
    if (endsAt.getTime() <= startsAt.getTime()) {
      toast.error("La hora de fin debe ser posterior a la hora de inicio.");
      return;
    }
    if (startsAt.getTime() < Date.now()) {
      toast.error("No podés bloquear horarios que ya pasaron.");
      return;
    }
    setBlock((b) => (b ? { ...b, saving: true } : b));
    const label = block.label.trim();
    const durationMin = Math.max(15, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000));
    const { error } = await supabase.from("appointments").insert({
      business_id: businessId,
      branch_id: activeBranchId,
      client_id: null,
      client_name: label || "Horario bloqueado",
      employee_id: employeeId,
      service_name: "Bloqueo de horario",
      service_price: 0,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      duration_min: durationMin,
      status: "blocked",
      notes: label ? `Horario bloqueado: ${label}` : "Horario bloqueado desde el Panel Profesional",
      created_by_name: profile?.full_name ?? null,
      created_by_role: profile?.role ?? null,
      updated_at: new Date().toISOString(),
    } as any);
    if (error) {
      toast.error("No se pudo bloquear el horario. Probá de nuevo.");
      setBlock((b) => (b ? { ...b, saving: false } : b));
      return;
    }
    toast.success("Horario bloqueado");
    setBlock(null);
    setEditor(null);
    onChanged?.();
  };

  const overlay = (children: React.ReactNode, z: string, onClose: () => void) =>
    typeof document === "undefined"
      ? null
      : createPortal(
          <div className={`fixed inset-0 ${z} flex items-center justify-center bg-black/75 p-3`} onClick={onClose}>
            <div
              className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-[28px] border border-violet-400/45 bg-[#08070f] p-5 shadow-[0_0_0_1px_rgba(139,92,246,0.35),0_30px_90px_-20px_rgba(0,0,0,0.9),0_0_60px_-18px_rgba(139,92,246,0.55)] [background-image:radial-gradient(120%_45%_at_85%_0%,rgba(79,125,255,0.20),transparent_60%),radial-gradient(110%_50%_at_0%_100%,rgba(139,92,246,0.22),transparent_62%)]"
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
        onClick={() => openEditor(dateKey)}
        className={
          className ??
          "inline-flex h-11 sm:h-9 items-center gap-1 sm:gap-1.5 whitespace-nowrap rounded-[10px] border border-white/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.07))] px-2.5 sm:px-3 text-sm sm:text-xs font-semibold text-foreground shadow-[0_4px_12px_-2px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:bg-white/15 active:translate-y-px" +
          (fillOnMobile ? " flex-1 justify-center sm:flex-none" : "")
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

      {editor ? (
        <SpecialDayEditor
          date={parseDateKeyLocal(editor.dateKey)}
          value={editor.value}
          allowBreak
          closedLabel="No disponible"
          saving={editor.saving}
          // Sin selector de profesional: el horario es siempre del profesional
          // que tiene la sesión abierta.
          onBlocks={saveBlocks}
          checkConflict={(day) =>
            findScheduleConflict(day, existingTurnos.filter((t) => toDateKey(new Date(t.starts_at)) === editor.dateKey))
          }
          onSave={save}
          onCancel={() => {
            setOverrideConfirm(null);
            setEditor(null);
          }}
        />
      ) : null}

      {block
        ? overlay(
            <>
              <div className="text-lg font-semibold">Bloquear horas</div>
              <p className="mt-1 text-sm capitalize text-muted-foreground">{labelForDate(block.dateKey)}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Ese tramo no se va a poder reservar y no cuenta como disponible en tu agenda.
              </p>
              <label className="mt-4 block text-sm font-semibold">
                Motivo (opcional)
                <input
                  value={block.label}
                  onChange={(e) => setBlock((b) => (b ? { ...b, label: e.target.value } : b))}
                  placeholder="Ej: Almuerzo, trámite"
                  className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none focus:border-violet-300/45"
                />
              </label>
              <div className="mt-4 grid grid-cols-[auto_1fr_1fr] items-center gap-2 text-sm">
                <span className="text-muted-foreground">Desde</span>
                <select value={block.startH} onChange={(e) => setBlock((b) => (b ? { ...b, startH: e.target.value } : b))} className={selectClass}>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <select value={block.startM} onChange={(e) => setBlock((b) => (b ? { ...b, startM: e.target.value } : b))} className={selectClass}>
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <span className="text-muted-foreground">Hasta</span>
                <select value={block.endH} onChange={(e) => setBlock((b) => (b ? { ...b, endH: e.target.value } : b))} className={selectClass}>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <select value={block.endM} onChange={(e) => setBlock((b) => (b ? { ...b, endM: e.target.value } : b))} className={selectClass}>
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="mt-5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBlock(null)}
                  disabled={block.saving}
                  className="h-11 flex-1 rounded-full bg-white/5 px-4 text-sm text-muted-foreground ring-1 ring-white/10 hover:text-foreground disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={saveBlock}
                  disabled={block.saving}
                  className="h-11 flex-1 rounded-full bg-amber-500 px-4 text-sm font-semibold text-[#1a1300] shadow-md shadow-amber-500/25 disabled:opacity-50"
                >
                  {block.saving ? "Guardando…" : "Guardar bloqueo"}
                </button>
              </div>
            </>,
            "z-[140]",
            () => setBlock(null),
          )
        : null}

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
                  className="h-11 flex-1 rounded-full bg-white/5 px-4 text-sm text-muted-foreground ring-1 ring-white/10 hover:text-foreground"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => save(overrideConfirm, true)}
                  className="h-11 flex-1 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 px-4 text-sm font-semibold text-white"
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
