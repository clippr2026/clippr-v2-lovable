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

export function buildSlots<T extends { id: string }>(
  schedule: ScheduleMap,
  appointments: Appointment[],
  employees: T[],
  selectedEmployeeId: string | "any" | null,
  duration: number,
  daysAhead = 10,
) {
  const now = new Date();
  const result: Array<{ date: Date; slots: Array<{ time: Date; employeeId: string }> }> = [];
  const pool = selectedEmployeeId && selectedEmployeeId !== "any"
    ? employees.filter((employee) => employee.id === selectedEmployeeId)
    : employees;

  for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
    const date = startOfDay(addMinutes(now, dayOffset * 24 * 60));
    const daySchedule = schedule[DAY_KEYS[date.getDay()]];
    if (!daySchedule?.enabled || pool.length === 0) continue;

    const open = parseTime(daySchedule.start);
    const close = parseTime(daySchedule.end);
    const breakStart = daySchedule.breakStart ? parseTime(daySchedule.breakStart) : null;
    const breakEnd = daySchedule.breakEnd ? parseTime(daySchedule.breakEnd) : null;
    const daySlots: Array<{ time: Date; employeeId: string }> = [];

    for (let minute = open; minute + duration <= close; minute += 30) {
      if (breakStart !== null && breakEnd !== null && minute < breakEnd && minute + duration > breakStart) continue;
      const slotStart = new Date(date);
      slotStart.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
      const slotEnd = addMinutes(slotStart, duration);
      if (slotStart < addMinutes(now, 60)) continue;

      const available = pool.find((employee) => !appointments.some((appt) => {
        if (appt.status === "cancelled") return false;
        if (appt.employee_id !== employee.id) return false;
        const apptStart = new Date(appt.starts_at);
        const apptEnd = appt.ends_at ? new Date(appt.ends_at) : addMinutes(apptStart, Number(appt.duration_min ?? duration));
        return overlaps(slotStart, slotEnd, apptStart, apptEnd);
      }));

      if (available) daySlots.push({ time: slotStart, employeeId: available.id });
    }

    result.push({ date, slots: daySlots.slice(0, 10) });
  }

  return result;
}
