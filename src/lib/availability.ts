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

// Normaliza el horario PROPIO de un profesional (`_employeeSchedules[empId]`).
// A diferencia de normalizeSchedule (horario del NEGOCIO, que siempre debe
// devolver los 7 días con algún fallback razonable — un negocio siempre tiene
// que tener alguna hora), acá un día ausente o mal cargado NUNCA se fabrica:
// significa "este profesional no tiene horario propio ESE día", y
// resolveDaySchedule debe heredar el horario real del negocio para ese día
// en vez de un 11:00-20:00 inventado que puede no tener nada que ver con el
// negocio real. Bug real que esto corrige: un profesional con horario propio
// PARCIAL (ej. solo cargó un descanso un día puntual) quedaba con el resto
// de la semana silenciosamente reemplazado por ese horario de relleno en la
// reserva pública — mientras la Agenda, que nunca hacía este relleno, sí lo
// mostraba libre. Días individuales inválidos se descartan uno por uno, sin
// tirar el resto del horario configurado.
export function normalizeEmployeeSchedule(value: unknown): ScheduleMap | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, any>;
  const next: Partial<Record<DayKey, DaySchedule>> = {};
  for (const key of DAY_KEYS) {
    const day = source[key];
    if (!day || typeof day !== "object") continue;
    if (typeof day.start !== "string" || typeof day.end !== "string") continue;
    next[key] = {
      enabled: day.enabled !== false,
      start: day.start,
      end: day.end,
      breakStart: typeof day.breakStart === "string" ? day.breakStart : undefined,
      breakEnd: typeof day.breakEnd === "string" ? day.breakEnd : undefined,
    };
  }
  return Object.keys(next).length > 0 ? (next as ScheduleMap) : null;
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

// Inversa de zonedTimeToInstant: minutos transcurridos entre la medianoche
// local (hora del negocio) del día calendario `originDate` y el instante
// `instant`. Sirve para proyectar turnos/bloqueos reales (instantes
// absolutos) al mismo espacio "minutos del día" en el que viven horario y
// descansos, para poder recortar huecos libres reales contra ellos.
export function minutesSinceLocalMidnight(instant: Date, originDate: Date, timeZone: string): number {
  const midnight = zonedTimeToInstant(originDate, 0, timeZone);
  return Math.round((instant.getTime() - midnight.getTime()) / 60_000);
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

// Intersección de la ventana horaria (negocio ∩ profesional) — el profesional
// nunca puede trabajar fuera del horario del negocio — pero el descanso sale
// ÚNICAMENTE de `override` (el horario del profesional: especial de la fecha
// si existe, si no el semanal recurrente). Un profesional + día = como máximo
// UN descanso recurrente activo: si el profesional tiene su propio horario
// configurado ese día, SU descanso (o la ausencia de descanso) manda, nunca
// se SUMA al descanso del negocio. Antes esta función unía ambos descansos —
// eso hacía que, por ejemplo, cambiar el descanso de un profesional de
// 12:00-13:00 a 13:00-14:00 dejara los DOS bloques visibles en la Agenda (el
// del negocio seguía uniéndose), y que apagar un descanso no lo sacara si el
// negocio tenía uno heredado. Si alguna ventana es inválida o la intersección
// queda vacía, el día se trata como cerrado — nunca se inventa un horario.
function applyBreakOverride(bizDay: DaySchedule, override: DaySchedule): DaySchedule {
  const bizOpen = parseTimeStrict(bizDay.start);
  const bizClose = parseTimeStrict(bizDay.end);
  const ovOpen = parseTimeStrict(override.start);
  const ovClose = parseTimeStrict(override.end);
  if (bizOpen === null || bizClose === null || ovOpen === null || ovClose === null) {
    return CLOSED_DAY;
  }
  const open = Math.max(bizOpen, ovOpen);
  const close = Math.min(bizClose, ovClose);
  if (open >= close) return CLOSED_DAY;

  const hasBreak = Boolean(override.breakStart && override.breakEnd);
  return {
    enabled: true,
    start: minutesToTimeString(open),
    end: minutesToTimeString(close),
    breakStart: hasBreak ? override.breakStart : undefined,
    breakEnd: hasBreak ? override.breakEnd : undefined,
    breaks: hasBreak ? [{ start: override.breakStart!, end: override.breakEnd! }] : [],
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

  // Horario propio del profesional para este día (especial de la fecha
  // exacta → si no, semanal recurrente — misma prioridad que resolveSingleDay).
  const empDay = resolveSingleDay(employeeSchedules[employeeId] ?? null, employeeSpecial[employeeId] ?? {}, date);
  if (!empDay) return bizDay; // profesional sin horario propio configurado → hereda el del negocio
  if (empDay.enabled === false) return { ...empDay, enabled: false };

  return applyBreakOverride(bizDay, empDay);
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

// Combina descansos + turnos/bloqueos reales (proyectados a minutos del día)
// en una lista de intervalos ocupados sin superposiciones, recortada a
// [open, close]. Base para calcular los huecos libres reales del día.
function mergeBusyIntervals(
  intervals: Array<{ start: number; end: number }>,
  open: number,
  close: number,
): Array<{ start: number; end: number }> {
  const clipped = intervals
    .map((iv) => ({ start: Math.max(iv.start, open), end: Math.min(iv.end, close) }))
    .filter((iv) => iv.end > iv.start)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of clipped) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

// Huecos libres reales de [open, close] una vez descontados los intervalos
// ocupados (ya fusionados y ordenados).
function freeBlocksOf(
  busy: Array<{ start: number; end: number }>,
  open: number,
  close: number,
): Array<{ start: number; end: number }> {
  const blocks: Array<{ start: number; end: number }> = [];
  let cursor = open;
  for (const iv of busy) {
    if (iv.start > cursor) blocks.push({ start: cursor, end: iv.start });
    cursor = Math.max(cursor, iv.end);
  }
  if (cursor < close) blocks.push({ start: cursor, end: close });
  return blocks;
}

// Candidatos de un hueco libre: la duración del servicio se aplica desde
// el inicio del bloque (hacia adelante) y, cuando corresponde, también desde
// el final (hacia atrás) — nunca en pasos arbitrarios. Cada candidato nace de
// un punto lógico real de la agenda: el inicio/final del bloque siempre es el
// límite de un turno, descanso, bloqueo o el horario laboral, nunca un
// desplazamiento fijo tipo "cada 30 minutos".
//
// `allowBackward` se apaga únicamente para el caso trivial de un día 100%
// libre (el único bloque va de apertura a cierre, sin ningún turno/descanso/
// bloqueo real ese día): ahí generar también la cadena hacia atrás produciría
// una segunda grilla en otra fase (ej. 11:20, 12:00, 12:40... para un
// servicio de 40 min en 11:00-20:00) sin que exista ningún evento real que
// la justifique. En cuanto el día tiene al menos un evento real, cada hueco
// que resulta de él (incluido el que llega hasta el cierre) sí aprovecha
// ambos extremos — ver el caso de ejemplo documentado en buildSlots.
function blockCandidates(block: { start: number; end: number }, duration: number, allowBackward: boolean): number[] {
  if (block.end - block.start < duration) return [];
  const candidates = new Set<number>();
  for (let t = block.start; t + duration <= block.end; t += duration) candidates.add(t);
  if (allowBackward) {
    for (let t = block.end - duration; t >= block.start; t -= duration) candidates.add(t);
  }
  return [...candidates].sort((a, b) => a - b);
}

// ───────────────────────────────────────────────────────────────────────────
// Generación de slots reservables. Resuelve la disponibilidad POR PROFESIONAL Y
// FECHA con la misma prioridad que la Agenda (horario especial del profesional →
// semanal del profesional → especial del negocio → semanal del negocio,
// siempre intersectado contra el horario del negocio — ver resolveDaySchedule),
// respeta descansos y descarta los horarios ya ocupados por turnos/bloqueos
// reales. Así la reserva online ofrece exactamente lo mismo que muestra la
// Agenda interna.
//
// La disponibilidad se calcula sobre los huecos libres REALES del día (ver
// mergeBusyIntervals/freeBlocksOf) y no sobre un paso fijo tipo "cada N
// minutos": eso aprovecha al máximo cada hueco (ver blockCandidates) en vez de
// dejar sin ofrecer un horario que sí entra completo antes del cierre o de un
// turno/descanso/bloqueo siguiente.
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
  timeZone: string = DEFAULT_TIMEZONE,
) {
  const now = new Date();
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

      const breakIntervals = dayBreaks(day)
        .map((brk) => ({ start: parseTimeStrict(brk.start), end: parseTimeStrict(brk.end) }))
        .filter((brk): brk is { start: number; end: number } => brk.start !== null && brk.end !== null && brk.end > brk.start);

      // Turnos/bloqueos reales de este profesional, proyectados a minutos del
      // día calendario que se está evaluando (mismo espacio que open/close).
      const apptIntervals = appointments
        .filter((appt) => appt.status !== "cancelled" && appt.employee_id === employee.id)
        .map((appt) => {
          const apptStart = new Date(appt.starts_at);
          const apptEnd = appt.ends_at
            ? new Date(appt.ends_at)
            : addMinutes(apptStart, Number(appt.duration_min ?? duration));
          return {
            start: minutesSinceLocalMidnight(apptStart, date, timeZone),
            end: minutesSinceLocalMidnight(apptEnd, date, timeZone),
          };
        });

      const busy = mergeBusyIntervals([...breakIntervals, ...apptIntervals], open, close);
      const freeBlocks = freeBlocksOf(busy, open, close);
      // Día sin ningún evento real (ni descanso, ni turno, ni bloqueo): un
      // único hueco de apertura a cierre. Ver nota en blockCandidates.
      const isCleanDay = busy.length === 0;

      for (const block of freeBlocks) {
        for (const minute of blockCandidates(block, duration, !isCleanDay)) {
          const slotStart = zonedTimeToInstant(date, minute, timeZone);
          if (slotStart < addMinutes(now, 60)) continue;
          const key = slotStart.getTime();
          if (slotMap.has(key)) continue; // ya hay un profesional para ese horario
          slotMap.set(key, employee.id);
        }
      }
    }

    // Sin límite fijo de cantidad: con huecos aprovechados al máximo (adelante
    // + atrás) un día puede tener legítimamente más de 10 horarios válidos
    // (ver ejemplo del bloque 12:20-20:00 en el comentario de arriba); cortar
    // a los primeros 10 cronológicos escondería justamente las horas de la
    // tarde/noche que este cálculo existe para recuperar.
    const daySlots = [...slotMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, employeeId]) => ({ time: new Date(time), employeeId }));

    result.push({ date, slots: daySlots });
  }

  return result;
}
