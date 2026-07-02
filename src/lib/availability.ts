// ───────────────────────────────────────────────────────────────────────────
// Motor de disponibilidad de Clippr (fuente única de verdad).
//
// Extraído de la página pública de reservas para que reservar Y la gestión de
// turnos (reprogramar) usen EXACTAMENTE la misma lógica: horarios laborales,
// descansos, turnos ocupados, duración del servicio y lead time. Sin lógica
// paralela: ambos importan de acá.
// ───────────────────────────────────────────────────────────────────────────

export type Appointment = {
  id: string;
  employee_id: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_min: number | null;
  status: string | null;
};

export type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
export type DaySchedule = {
  enabled: boolean;
  start: string;
  end: string;
  breakStart?: string;
  breakEnd?: string;
};
export type ScheduleMap = Record<DayKey, DaySchedule>;

export const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const DEFAULT_SCHEDULE: ScheduleMap = {
  sun: { enabled: false, start: "11:00", end: "20:00" },
  mon: { enabled: true, start: "11:00", end: "20:00" },
  tue: { enabled: true, start: "11:00", end: "20:00" },
  wed: { enabled: true, start: "11:00", end: "20:00" },
  thu: { enabled: true, start: "11:00", end: "20:00" },
  fri: { enabled: true, start: "11:00", end: "20:00" },
  sat: { enabled: true, start: "11:00", end: "20:00" },
};

export function parseTime(value: string) {
  const [h = "0", m = "0"] = String(value || "0:00").split(":");
  return Number(h) * 60 + Number(m);
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

export function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

export function normalizeSchedule(value: unknown): ScheduleMap {
  if (!value || typeof value !== "object") return DEFAULT_SCHEDULE;
  const source = value as Record<string, any>;
  const next = { ...DEFAULT_SCHEDULE };
  for (const key of DAY_KEYS) {
    const day = source[key];
    if (day && typeof day === "object") {
      next[key] = {
        enabled: day.enabled !== false,
        start: typeof day.start === "string" ? day.start : next[key].start,
        end: typeof day.end === "string" ? day.end : next[key].end,
        breakStart: typeof day.breakStart === "string" ? day.breakStart : undefined,
        breakEnd: typeof day.breakEnd === "string" ? day.breakEnd : undefined,
      };
    }
  }
  return next;
}

// ───────────────────────────────────────────────────────────────────────────
// Resolución de prioridad de horarios (fuente única para Agenda y reserva).
//   Prioridad por (profesional, fecha):
//     1. Horario especial del profesional para esa fecha.
//     2. Horario semanal del profesional.
//     3. Horario especial del negocio para esa fecha.
//     4. Horario semanal del negocio.
//   Además: si el negocio tiene un especial CERRADO esa fecha, cierra a todos.
// ───────────────────────────────────────────────────────────────────────────

// Mapas de horarios especiales por fecha (clave "YYYY-MM-DD").
export type SpecialDateMap = Record<string, DaySchedule>;
export type EmployeeSpecialDateMap = Record<string, SpecialDateMap>;

// Fecha local → "YYYY-MM-DD" (sin desfase de zona horaria).
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Hora "HH:MM" → horas decimales (8.5 = 08:30). Para validar/comparar ventanas.
export function parseScheduleTime(value: string) {
  const [hh, mm = "0"] = String(value || "0:00").split(":");
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h)) return 0;
  return h + (Number.isFinite(m) ? m / 60 : 0);
}

// Normaliza un DaySchedule suelto (usado para horarios especiales por fecha).
export function normalizeDaySchedule(value: unknown): DaySchedule | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  return {
    enabled: d.enabled !== false,
    start: typeof d.start === "string" ? d.start : "00:00",
    end: typeof d.end === "string" ? d.end : "00:00",
    breakStart: typeof d.breakStart === "string" ? d.breakStart : undefined,
    breakEnd: typeof d.breakEnd === "string" ? d.breakEnd : undefined,
  };
}

// Horario semanal configurado para el día de la semana de `date`.
function scheduleForWeekday(schedule: ScheduleMap | null, date: Date): DaySchedule | null {
  if (!schedule) return null;
  return schedule[DAY_KEYS[date.getDay()]] ?? null;
}

export function resolveDaySchedule(
  businessSchedule: ScheduleMap | null,
  employeeSchedules: Record<string, ScheduleMap>,
  businessSpecial: SpecialDateMap,
  employeeSpecial: EmployeeSpecialDateMap,
  employeeId: string | null | undefined,
  date: Date,
): DaySchedule | null {
  const key = toDateKey(date);

  const bizSpecial = businessSpecial[key];
  if (bizSpecial && bizSpecial.enabled === false) {
    return { ...bizSpecial, enabled: false }; // negocio cerrado ese día → todos
  }

  // 1. especial del profesional
  if (employeeId && employeeSpecial[employeeId]?.[key]) {
    return employeeSpecial[employeeId][key];
  }
  // 2. semanal normal del profesional (incluso si está libre ese día)
  if (employeeId && employeeSchedules[employeeId]) {
    const d = scheduleForWeekday(employeeSchedules[employeeId], date);
    if (d) return d;
  }
  // 3. especial del negocio (abierto)
  if (bizSpecial) return bizSpecial;
  // 4. semanal normal del negocio
  return scheduleForWeekday(businessSchedule, date);
}

// Valida un slot contra un DaySchedule concreto (apertura/cierre + descanso).
export function checkDaySchedule(
  day: DaySchedule | null,
  startsAt: Date,
  durationMin: number,
): string | null {
  if (!day) return null;
  if (!day.enabled) {
    return "El horario seleccionado está fuera del horario laboral configurado.";
  }
  const slotStart = startsAt.getHours() + startsAt.getMinutes() / 60;
  const slotEnd = slotStart + (durationMin || 30) / 60;
  const open = parseScheduleTime(day.start);
  const close = parseScheduleTime(day.end);
  if (slotStart < open || slotEnd > close) {
    return "El horario seleccionado está fuera del horario laboral configurado.";
  }
  if (day.breakStart && day.breakEnd) {
    const breakStart = parseScheduleTime(day.breakStart);
    const breakEnd = parseScheduleTime(day.breakEnd);
    if (breakEnd > breakStart && slotStart < breakEnd && slotEnd > breakStart) {
      return "El horario seleccionado cae dentro del descanso configurado.";
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Generación de slots reservables. Resuelve la disponibilidad POR PROFESIONAL Y
// FECHA con la misma prioridad que la Agenda (horario especial del profesional →
// semanal del profesional → especial del negocio → semanal del negocio), respeta
// descansos y descarta los horarios ya ocupados por turnos reales. Así la reserva
// online ofrece exactamente lo mismo que muestra la Agenda interna.
// ───────────────────────────────────────────────────────────────────────────
export function buildSlots<T extends { id: string }>(
  businessSchedule: ScheduleMap,
  appointments: Appointment[],
  employees: T[],
  selectedEmployeeId: string | "any" | null,
  duration: number,
  daysAhead = 10,
  employeeSchedules: Record<string, ScheduleMap> = {},
  businessSpecial: SpecialDateMap = {},
  employeeSpecial: EmployeeSpecialDateMap = {},
  intervalMinutes = 30,
) {
  const now = new Date();
  const step = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 30;
  const result: Array<{ date: Date; slots: Array<{ time: Date; employeeId: string }> }> = [];
  const pool =
    selectedEmployeeId && selectedEmployeeId !== "any"
      ? employees.filter((employee) => employee.id === selectedEmployeeId)
      : employees;

  for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
    const date = startOfDay(addMinutes(now, dayOffset * 24 * 60));
    if (pool.length === 0) {
      result.push({ date, slots: [] });
      continue;
    }

    // time(ms) → primer profesional libre y disponible en ese horario.
    const slotMap = new Map<number, string>();

    for (const employee of pool) {
      const day = resolveDaySchedule(
        businessSchedule,
        employeeSchedules,
        businessSpecial,
        employeeSpecial,
        employee.id,
        date,
      );
      if (!day || !day.enabled) continue;

      const open = parseTime(day.start);
      const close = parseTime(day.end);
      const breakStart = day.breakStart ? parseTime(day.breakStart) : null;
      const breakEnd = day.breakEnd ? parseTime(day.breakEnd) : null;

      for (let minute = open; minute + duration <= close; minute += step) {
        if (breakStart !== null && breakEnd !== null && minute < breakEnd && minute + duration > breakStart) continue;
        const slotStart = new Date(date);
        slotStart.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
        if (slotStart < addMinutes(now, 60)) continue;
        const key = slotStart.getTime();
        if (slotMap.has(key)) continue; // ya hay un profesional para ese horario

        const slotEnd = addMinutes(slotStart, duration);
        const busy = appointments.some((appt) => {
          if (appt.status === "cancelled") return false;
          if (appt.employee_id !== employee.id) return false;
          const apptStart = new Date(appt.starts_at);
          const apptEnd = appt.ends_at
            ? new Date(appt.ends_at)
            : addMinutes(apptStart, Number(appt.duration_min ?? duration));
          return overlaps(slotStart, slotEnd, apptStart, apptEnd);
        });
        if (!busy) slotMap.set(key, employee.id);
      }
    }

    const daySlots = [...slotMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, employeeId]) => ({ time: new Date(time), employeeId }));

    result.push({ date, slots: daySlots.slice(0, 10) });
  }

  return result;
}
