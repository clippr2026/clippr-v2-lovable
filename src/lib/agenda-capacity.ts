// Capacidad real de la agenda: cuántos turnos puede atender cada profesional según SU
// horario (días que trabaja, hora de entrada y salida, descanso) y cuánto dura lo que
// atiende. Reemplaza el supuesto fijo de "8 turnos por día por profesional".
//
//   · Un profesional de 11:00 a 20:00 con 1 h de descanso y turnos de 1 h → 8 turnos.
//   · El mismo horario SIN descanso marcado → 9 turnos.
//   · Con servicios de 40 min → más turnos (480 min / 40 = 12).
//
// Usa el mismo motor de horarios que la Agenda y la reserva pública (resolveDaySchedule),
// así respeta el horario del negocio, el propio de cada profesional, los horarios
// especiales por fecha y los descansos.
import {
  normalizeDaySchedule,
  normalizeEmployeeSchedule,
  normalizeSchedule,
  parseTimeStrict,
  resolveDaySchedule,
  type DaySchedule,
  type EmployeeSpecialDateMap,
  type ScheduleMap,
  type SpecialDateMap,
} from "@/lib/availability";
import { resolveServicePricing, type EmployeeServiceOverrideMap } from "@/lib/service-pricing";

export type CapacityContext = {
  businessSchedule: ScheduleMap | null;
  employeeSchedules: Record<string, ScheduleMap>;
  businessSpecial: SpecialDateMap;
  employeeSpecial: EmployeeSpecialDateMap;
  serviceOverrides: EmployeeServiceOverrideMap;
};

// Duración que se asume si no hay ningún dato de servicios para un profesional.
export const DEFAULT_SLOT_MINUTES = 60;

// Arma el contexto a partir del JSON `business_settings.schedule` (el mismo que lee la
// Agenda: horario del negocio + `_employeeSchedules` + `_specialDates` +
// `_employeeSpecialDates` + `_employeeServiceOverrides`).
export function parseCapacityContext(rawSchedule: unknown): CapacityContext {
  const raw = (rawSchedule && typeof rawSchedule === "object" ? rawSchedule : {}) as Record<string, unknown>;
  const businessSchedule = rawSchedule && typeof rawSchedule === "object" ? normalizeSchedule(raw) : null;

  const employeeSchedules: Record<string, ScheduleMap> = {};
  const rawEmp = (raw._employeeSchedules && typeof raw._employeeSchedules === "object" ? raw._employeeSchedules : {}) as Record<string, unknown>;
  for (const [id, value] of Object.entries(rawEmp)) {
    const ns = normalizeEmployeeSchedule(value);
    if (ns) employeeSchedules[id] = ns;
  }

  const businessSpecial: SpecialDateMap = {};
  const rawBizSpecial = (raw._specialDates && typeof raw._specialDates === "object" ? raw._specialDates : {}) as Record<string, unknown>;
  for (const [dateKey, value] of Object.entries(rawBizSpecial)) {
    const nd = normalizeDaySchedule(value);
    if (nd) businessSpecial[dateKey] = nd;
  }

  const employeeSpecial: EmployeeSpecialDateMap = {};
  const rawEmpSpecial = (raw._employeeSpecialDates && typeof raw._employeeSpecialDates === "object"
    ? raw._employeeSpecialDates
    : {}) as Record<string, Record<string, unknown>>;
  for (const [empId, byDate] of Object.entries(rawEmpSpecial)) {
    if (!byDate || typeof byDate !== "object") continue;
    const map: SpecialDateMap = {};
    for (const [dateKey, value] of Object.entries(byDate)) {
      const nd = normalizeDaySchedule(value);
      if (nd) map[dateKey] = nd;
    }
    if (Object.keys(map).length) employeeSpecial[empId] = map;
  }

  const serviceOverrides = (raw._employeeServiceOverrides && typeof raw._employeeServiceOverrides === "object"
    ? raw._employeeServiceOverrides
    : {}) as EmployeeServiceOverrideMap;

  return { businessSchedule, employeeSchedules, businessSpecial, employeeSpecial, serviceOverrides };
}

// Bloqueo de agenda de un profesional (minutos desde las 00:00 de ese día). No es ni ocupado
// ni libre: ese tiempo se saca de la capacidad, porque el profesional no estaba disponible.
export type BlockInterval = { employeeId: string; dateKey: string; startMin: number; endMin: number };

function cutInterval(intervals: Array<[number, number]>, s: number, e: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [a, b] of intervals) {
    if (e <= a || s >= b) {
      out.push([a, b]);
      continue;
    }
    if (s > a) out.push([a, s]);
    if (e < b) out.push([e, b]);
  }
  return out;
}

// Tramos (minutos desde las 00:00) en que se atiende un día ya resuelto: horario − descansos − bloqueos.
export function dayWorkIntervals(day: DaySchedule | null, blocks: ReadonlyArray<{ startMin: number; endMin: number }> = []): Array<[number, number]> {
  if (!day || day.enabled === false) return [];
  const open = parseTimeStrict(day.start);
  const close = parseTimeStrict(day.end);
  if (open === null || close === null || close <= open) return [];
  const breaks =
    day.breaks && day.breaks.length > 0
      ? day.breaks
      : day.breakStart && day.breakEnd
        ? [{ start: day.breakStart, end: day.breakEnd }]
        : [];
  let intervals: Array<[number, number]> = [[open, close]];
  for (const b of breaks) {
    const bs = parseTimeStrict(b.start);
    const be = parseTimeStrict(b.end);
    if (bs === null || be === null || be <= bs) continue;
    intervals = cutInterval(intervals, bs, be);
  }
  for (const bl of blocks) {
    if (bl.endMin > bl.startMin) intervals = cutInterval(intervals, bl.startMin, bl.endMin);
  }
  return intervals;
}

// Minutos efectivos de atención de un día ya resuelto: horario − descansos − bloqueos.
export function dayWorkMinutes(day: DaySchedule | null, blocks: ReadonlyArray<{ startMin: number; endMin: number }> = []): number {
  return Math.max(0, dayWorkIntervals(day, blocks).reduce((s, [a, b]) => s + (b - a), 0));
}

export type SoldServiceLine = { name: string; qty: number };
export type CatalogService = { id: string; name: string; price: number | null; duration_min: number | null };

// Duración típica de un turno de un profesional: promedio ponderado de lo que realmente
// atendió (cada servicio con su duración, incluida la propia del profesional si la tiene
// configurada). Si no hay datos, el servicio más común del catálogo, y si no, 60 min.
export function slotMinutesForEmployee(
  employeeId: string,
  sold: SoldServiceLine[],
  catalog: CatalogService[],
  overrides: EmployeeServiceOverrideMap,
): number {
  const byName = new Map<string, CatalogService>();
  for (const c of catalog) if (c.duration_min != null) byName.set(c.name.trim().toLowerCase(), c);

  let minutes = 0;
  let qty = 0;
  for (const line of sold) {
    const svc = byName.get(line.name.trim().toLowerCase());
    if (!svc) continue;
    const q = Number.isFinite(line.qty) && line.qty > 0 ? line.qty : 1;
    const dur = resolveServicePricing(
      { id: svc.id, price: svc.price, duration_min: svc.duration_min },
      employeeId,
      overrides,
    ).duration_min;
    if (!Number.isFinite(dur) || dur <= 0) continue;
    minutes += dur * q;
    qty += q;
  }
  if (qty > 0) return Math.max(10, Math.round(minutes / qty));

  const durations = catalog.map((c) => c.duration_min).filter((d): d is number => d != null && d > 0);
  if (durations.length > 0) {
    const counts = new Map<number, number>();
    for (const d of durations) counts.set(d, (counts.get(d) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return DEFAULT_SLOT_MINUTES;
}

// Minutos de servicios realizados por un profesional: cada servicio con su duración (la propia del profesional si la
// tiene configurada). Si el servicio no está en el catálogo, se usa la duración típica del profesional (`fallback`).
export function soldMinutesForEmployee(
  employeeId: string,
  sold: SoldServiceLine[],
  catalog: CatalogService[],
  overrides: EmployeeServiceOverrideMap,
  fallback: number,
): number {
  const byName = new Map<string, CatalogService>();
  for (const c of catalog) if (c.duration_min != null) byName.set(c.name.trim().toLowerCase(), c);
  let minutes = 0;
  for (const line of sold) {
    const q = Number.isFinite(line.qty) && line.qty > 0 ? line.qty : 1;
    const svc = byName.get(line.name.trim().toLowerCase());
    const dur = svc
      ? resolveServicePricing({ id: svc.id, price: svc.price, duration_min: svc.duration_min }, employeeId, overrides).duration_min
      : fallback;
    minutes += (Number.isFinite(dur) && dur > 0 ? dur : fallback) * q;
  }
  return minutes;
}

export type CapacityInput = {
  ctx: CapacityContext;
  employeeIds: string[];
  monthKey: string; // "2026-10"
  cutoffDay: number; // cuenta los días fromDay..cutoffDay
  // Primer día que cuenta (default 1): en el mes de arranque, el día en que el negocio empezó.
  fromDay?: number;
  // Bloqueos de agenda: se restan de la capacidad de cada profesional.
  blocks?: BlockInterval[];
  // Minutos por turno de cada profesional (ver slotMinutesForEmployee).
  slotMinutesByEmployee: Record<string, number>;
};

// openDatesByDow: cuántas fechas del período se trabajó, por día de la semana (0 = domingo). Un día de la
// semana sin fechas es un día que el local está cerrado.
export type CapacityResult = {
  totalSlots: number;
  workedDays: number;
  openDatesByDow: Record<number, number>;
  // Horas del día (0-23) en que algún profesional atiende, según los horarios (sin contar descansos).
  openHours: number[];
  // Minutos en que los profesionales estaban disponibles para atender (sin descansos, cierres ni bloqueos).
  availableMinutes: number;
};

// Capacidad total: para cada profesional y cada día 1..cutoffDay, turnos = minutos de
// atención ÷ minutos por turno (hacia abajo).
export function computeCapacity({ ctx, employeeIds, monthKey, cutoffDay, fromDay, blocks = [], slotMinutesByEmployee }: CapacityInput): CapacityResult {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const until = Math.min(Math.max(cutoffDay, 0), lastDay);
  let totalSlots = 0;
  const workedDates = new Set<number>();
  const openHours = new Set<number>();
  let availableMinutes = 0;
  for (const empId of employeeIds) {
    const slot = Math.max(10, slotMinutesByEmployee[empId] ?? DEFAULT_SLOT_MINUTES);
    for (let d = Math.max(1, fromDay ?? 1); d <= until; d += 1) {
      // Mediodía local: el día de la semana coincide con la fecha del calendario.
      const date = new Date(y, m - 1, d, 12, 0, 0);
      const day = resolveDaySchedule(ctx.businessSchedule, ctx.employeeSchedules, ctx.businessSpecial, ctx.employeeSpecial, empId, date);
      const dateKey = `${monthKey}-${String(d).padStart(2, "0")}`;
      const dayBlocks = blocks.filter((b) => b.employeeId === empId && b.dateKey === dateKey);
      const minutes = dayWorkMinutes(day, dayBlocks);
      if (minutes <= 0) continue;
      workedDates.add(d);
      availableMinutes += minutes;
      const desde = day ? parseTimeStrict(day.start) : null;
      const hasta = day ? parseTimeStrict(day.end) : null;
      if (desde != null && hasta != null) {
        for (let h = Math.floor(desde / 60); h * 60 < hasta && h < 24; h += 1) openHours.add(h);
      }
      totalSlots += Math.floor(minutes / slot);
    }
  }
  const openDatesByDow: Record<number, number> = {};
  for (const d of workedDates) {
    const dow = new Date(y, m - 1, d, 12, 0, 0).getDay();
    openDatesByDow[dow] = (openDatesByDow[dow] ?? 0) + 1;
  }
  return { totalSlots, workedDays: workedDates.size, openDatesByDow, openHours: [...openHours].sort((a, b) => a - b), availableMinutes };
}

// Turnos disponibles de UN profesional en cada día trabajado del período (misma cuenta que computeCapacity, día por día).
export function dailySlotsForEmployee(
  { ctx, monthKey, cutoffDay, fromDay, blocks = [], slotMinutesByEmployee }: Omit<CapacityInput, "employeeIds">,
  empId: string,
): Array<{ dateKey: string; slots: number; minutes: number; intervals: Array<[number, number]> }> {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const until = Math.min(Math.max(cutoffDay, 0), lastDay);
  const slot = Math.max(10, slotMinutesByEmployee[empId] ?? DEFAULT_SLOT_MINUTES);
  const out: Array<{ dateKey: string; slots: number; minutes: number; intervals: Array<[number, number]> }> = [];
  for (let d = Math.max(1, fromDay ?? 1); d <= until; d += 1) {
    const date = new Date(y, m - 1, d, 12, 0, 0);
    const day = resolveDaySchedule(ctx.businessSchedule, ctx.employeeSchedules, ctx.businessSpecial, ctx.employeeSpecial, empId, date);
    const dateKey = `${monthKey}-${String(d).padStart(2, "0")}`;
    const dayBlocks = blocks.filter((b) => b.employeeId === empId && b.dateKey === dateKey);
    const intervals = dayWorkIntervals(day, dayBlocks);
    const minutes = Math.max(0, intervals.reduce((acc, [a, b]) => acc + (b - a), 0));
    if (minutes <= 0) continue;
    out.push({ dateKey, slots: Math.floor(minutes / slot), minutes, intervals });
  }
  return out;
}
