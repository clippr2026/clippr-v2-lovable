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

// Minutos efectivos de atención de un día ya resuelto: horario − descansos.
export function dayWorkMinutes(day: DaySchedule | null): number {
  if (!day || day.enabled === false) return 0;
  const open = parseTimeStrict(day.start);
  const close = parseTimeStrict(day.end);
  if (open === null || close === null || close <= open) return 0;
  const breaks =
    day.breaks && day.breaks.length > 0
      ? day.breaks
      : day.breakStart && day.breakEnd
        ? [{ start: day.breakStart, end: day.breakEnd }]
        : [];
  let minutes = close - open;
  for (const b of breaks) {
    const bs = parseTimeStrict(b.start);
    const be = parseTimeStrict(b.end);
    if (bs === null || be === null || be <= bs) continue;
    const overlap = Math.min(be, close) - Math.max(bs, open);
    if (overlap > 0) minutes -= overlap;
  }
  return Math.max(0, minutes);
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

export type CapacityInput = {
  ctx: CapacityContext;
  employeeIds: string[];
  monthKey: string; // "2026-10"
  cutoffDay: number; // cuenta los días 1..cutoffDay
  // Minutos por turno de cada profesional (ver slotMinutesForEmployee).
  slotMinutesByEmployee: Record<string, number>;
};

export type CapacityResult = { totalSlots: number; workedDays: number };

// Capacidad total: para cada profesional y cada día 1..cutoffDay, turnos = minutos de
// atención ÷ minutos por turno (hacia abajo).
export function computeCapacity({ ctx, employeeIds, monthKey, cutoffDay, slotMinutesByEmployee }: CapacityInput): CapacityResult {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const until = Math.min(Math.max(cutoffDay, 0), lastDay);
  let totalSlots = 0;
  const workedDates = new Set<number>();
  for (const empId of employeeIds) {
    const slot = Math.max(10, slotMinutesByEmployee[empId] ?? DEFAULT_SLOT_MINUTES);
    for (let d = 1; d <= until; d += 1) {
      // Mediodía local: el día de la semana coincide con la fecha del calendario.
      const date = new Date(y, m - 1, d, 12, 0, 0);
      const day = resolveDaySchedule(ctx.businessSchedule, ctx.employeeSchedules, ctx.businessSpecial, ctx.employeeSpecial, empId, date);
      const minutes = dayWorkMinutes(day);
      if (minutes <= 0) continue;
      workedDates.add(d);
      totalSlots += Math.floor(minutes / slot);
    }
  }
  return { totalSlots, workedDays: workedDates.size };
}
