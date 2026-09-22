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
  // Descansos combinados (negocio + profesional) cuando ambos aplican al
  // mismo día. `breakStart`/`breakEnd` quedan con el primero de la lista
  // por compatibilidad con consumidores que solo conocen un descanso.
  breaks?: Array<{ start: string; end: string }>;
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

// Zona horaria por defecto cuando el negocio no tiene una configurada
// (`businesses.timezone` es nullable). Coincide con el default de esa
// columna en la base — no es un hardcode de un negocio puntual, es el
// fallback de la plataforma.
export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

export function parseTime(value: string) {
  const [h = "0", m = "0"] = String(value || "0:00").split(":");
  return Number(h) * 60 + Number(m);
}

// Versión estricta: exige "H:MM"/"HH:MM" válido (0-23h, 0-59m). Devuelve
// `null` en vez de inventar un horario (medianoche) cuando el dato está mal
// cargado — así un typo de configuración nunca fabrica disponibilidad.
const STRICT_TIME_RE = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
export function parseTimeStrict(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const match = STRICT_TIME_RE.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTimeString(totalMinutes: number): string {
  const clamped = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
// Zona horaria del negocio. Los horarios configurados ("abre 11:00") son hora
// local DEL NEGOCIO, no del dispositivo de quien está mirando la página — sin
// esto, un visitante con el reloj/huso del dispositivo distinto al del local
// ve horarios corridos (mismo tipo de bug ya parchado en professionals.tsx,
// cash-register.tsx y dashboard.tsx para Argentina; acá se generaliza a
// cualquier zona horaria por negocio).
// ───────────────────────────────────────────────────────────────────────────

// Offset (en minutos) de `timeZone` respecto de UTC en el instante `date`.
// Positivo = zona adelantada a UTC, negativo = atrasada (Argentina = -180).
export function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(date).reduce((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {} as Record<string, string>);
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return (asUtc - date.getTime()) / 60_000;
  } catch {
    return 0; // timezone inválida/no soportada → tratar como UTC en vez de romper
  }
}

// Día calendario ("hoy", "hoy+N") en la zona horaria del negocio, devuelto
// como Date a medianoche LOCAL DEL NAVEGADOR pero con año/mes/día que
// coinciden con el calendario del negocio. Sirve solo como "portador" de
// fecha calendario para resolveDaySchedule/toDateKey (que leen
// getFullYear/getMonth/getDate/getDay) — nunca como instante absoluto.
export function zonedCalendarDate(instant: Date, timeZone: string, dayOffset = 0): Date {
  let y: number;
  let m: number;
  let d: number;
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = dtf.formatToParts(instant).reduce((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {} as Record<string, string>);
    y = Number(parts.year);
    m = Number(parts.month) - 1;
    d = Number(parts.day);
  } catch {
    y = instant.getFullYear();
    m = instant.getMonth();
    d = instant.getDate();
  }
  const carrier = new Date(y, m, d);
  if (dayOffset) carrier.setDate(carrier.getDate() + dayOffset);
  return carrier;
}

// Instante absoluto real para "HH:MM hora local del negocio" en el día
// calendario de `calendarDate` (portador devuelto por zonedCalendarDate).
export function zonedTimeToInstant(calendarDate: Date, minutesFromMidnight: number, timeZone: string): Date {
  const y = calendarDate.getFullYear();
  const m = calendarDate.getMonth();
  const d = calendarDate.getDate();
  const hh = Math.floor(minutesFromMidnight / 60);
  const mm = minutesFromMidnight % 60;
  const guess = Date.UTC(y, m, d, hh, mm, 0);
  const offsetMin = getTimeZoneOffsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offsetMin * 60_000);
}

// ───────────────────────────────────────────────────────────────────────────
// Resolución de horarios (fuente única para Agenda y reserva). Disponibilidad
// real = horario del NEGOCIO ∩ horario del PROFESIONAL para ese día, cada uno
// resuelto con su propia prioridad (especial de la fecha → semanal):
//   - Si el negocio está cerrado ese día (semanal o especial), cierra a
//     todos, sin importar el horario propio del profesional.
//   - Si el profesional no tiene NINGÚN horario propio configurado (ni
//     especial para esa fecha ni semanal), hereda 100% el horario del
//     negocio.
//   - Si el profesional sí tiene horario propio, el resultado es la
//     INTERSECCIÓN de ambas ventanas (nunca más amplio que ninguna de las
//     dos) y la unión de los descansos de ambos.
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

// Especial de la fecha (si existe) → si no, semanal. Resolución de UNA sola
// entidad (negocio o profesional); la intersección de ambas pasa por
// resolveDaySchedule.
export function resolveSingleDay(schedule: ScheduleMap | null, special: SpecialDateMap, date: Date): DaySchedule | null {
  const key = toDateKey(date);
  if (special[key]) return special[key];
  return scheduleForWeekday(schedule, date);
}

const CLOSED_DAY: DaySchedule = { enabled: false, start: "00:00", end: "00:00" };

// Intersección de dos ventanas horarias + unión de sus descansos. Si alguna
// ventana es inválida (horas mal cargadas) o la intersección queda vacía,
// el día se trata como cerrado — nunca se inventa un horario por default.
function intersectDaySchedule(a: DaySchedule, b: DaySchedule): DaySchedule {
  const aOpen = parseTimeStrict(a.start);
  const aClose = parseTimeStrict(a.end);
  const bOpen = parseTimeStrict(b.start);
  const bClose = parseTimeStrict(b.end);
  if (aOpen === null || aClose === null || bOpen === null || bClose === null) {
    return CLOSED_DAY;
  }
  const open = Math.max(aOpen, bOpen);
  const close = Math.min(aClose, bClose);
  if (open >= close) return CLOSED_DAY;

  const breaks: Array<{ start: string; end: string }> = [];
  if (a.breakStart && a.breakEnd) breaks.push({ start: a.breakStart, end: a.breakEnd });
  if (b.breakStart && b.breakEnd) breaks.push({ start: b.breakStart, end: b.breakEnd });

  return {
    enabled: true,
    start: minutesToTimeString(open),
    end: minutesToTimeString(close),
    breakStart: breaks[0]?.start,
    breakEnd: breaks[0]?.end,
    breaks,
  };
}

export function resolveDaySchedule(
  businessSchedule: ScheduleMap | null,
  employeeSchedules: Record<string, ScheduleMap>,
  businessSpecial: SpecialDateMap,
  employeeSpecial: EmployeeSpecialDateMap,
  employeeId: string | null | undefined,
  date: Date,
): DaySchedule | null {
  const bizDay = resolveSingleDay(businessSchedule, businessSpecial, date);
  if (!bizDay || bizDay.enabled === false) {
    return bizDay ? { ...bizDay, enabled: false } : null; // negocio cerrado ese día → todos
  }

  if (!employeeId) return bizDay;

  const empDay = resolveSingleDay(employeeSchedules[employeeId] ?? null, employeeSpecial[employeeId] ?? {}, date);
  if (!empDay) return bizDay; // profesional sin horario propio configurado → hereda el del negocio
  if (empDay.enabled === false) return { ...empDay, enabled: false };

  return intersectDaySchedule(bizDay, empDay);
}

// Todos los descansos configurados para un DaySchedule ya resuelto (soporta
// tanto el campo legado breakStart/breakEnd como el `breaks[]` combinado que
// devuelve resolveDaySchedule cuando negocio y profesional tienen descansos
// distintos).
function dayBreaks(day: DaySchedule): Array<{ start: string; end: string }> {
  if (day.breaks && day.breaks.length > 0) return day.breaks;
  if (day.breakStart && day.breakEnd) return [{ start: day.breakStart, end: day.breakEnd }];
  return [];
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
  for (const brk of dayBreaks(day)) {
    const breakStart = parseScheduleTime(brk.start);
    const breakEnd = parseScheduleTime(brk.end);
    if (breakEnd > breakStart && slotStart < breakEnd && slotEnd > breakStart) {
      return "El horario seleccionado cae dentro del descanso configurado.";
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Generación de slots reservables. Resuelve la disponibilidad POR PROFESIONAL Y
// FECHA con la misma prioridad que la Agenda (horario especial del profesional →
// semanal del profesional → especial del negocio → semanal del negocio,
// siempre intersectado contra el horario del negocio — ver resolveDaySchedule),
// respeta descansos y descarta los horarios ya ocupados por turnos reales. Así
// la reserva online ofrece exactamente lo mismo que muestra la Agenda interna.
//
// Todos los horarios configurados ("abre 11:00") son hora local DEL NEGOCIO:
// `timeZone` (IANA, ej. "America/Argentina/Buenos_Aires") ancla ese cálculo a
// la zona horaria real del negocio en vez de la del dispositivo de quien
// reserva — ver zonedCalendarDate/zonedTimeToInstant más arriba.
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
  timeZone: string = DEFAULT_TIMEZONE,
) {
  const now = new Date();
  const step = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 30;
  const result: Array<{ date: Date; slots: Array<{ time: Date; employeeId: string }> }> = [];
  const pool =
    selectedEmployeeId && selectedEmployeeId !== "any"
      ? employees.filter((employee) => employee.id === selectedEmployeeId)
      : employees;

  for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
    const date = zonedCalendarDate(now, timeZone, dayOffset);
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

      const open = parseTimeStrict(day.start);
      const close = parseTimeStrict(day.end);
      if (open === null || close === null) continue; // horario mal cargado → sin disponibilidad, no se inventa

      const breaks = dayBreaks(day)
        .map((brk) => ({ start: parseTimeStrict(brk.start), end: parseTimeStrict(brk.end) }))
        .filter((brk): brk is { start: number; end: number } => brk.start !== null && brk.end !== null && brk.end > brk.start);

      for (let minute = open; minute + duration <= close; minute += step) {
        const inBreak = breaks.some((brk) => minute < brk.end && minute + duration > brk.start);
        if (inBreak) continue;

        const slotStart = zonedTimeToInstant(date, minute, timeZone);
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
