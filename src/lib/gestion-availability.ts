import { supabase } from "@/integrations/supabase/client";
import {
  addMinutes,
  buildSlots,
  DEFAULT_TIMEZONE,
  normalizeDaySchedule,
  normalizeEmployeeSchedule,
  normalizeSchedule,
  startOfDay,
  toDateKey,
  type Appointment,
  type EmployeeSpecialDateMap,
  type ScheduleMap,
  type SpecialDateMap,
} from "./availability";

export type RescheduleDay = { date: Date; slots: Date[] };

type Closure = { branch_id: string | null; start_date: string; end_date: string };

/**
 * Horarios libres para reprogramar un turno: misma lógica que la reserva online
 * (buildSlots) con las mismas fuentes públicas. El turno que se mueve no cuenta
 * como ocupado. Respeta anticipación mínima/máxima y días cerrados.
 */
export async function loadRescheduleDays(opts: {
  businessId: string;
  branchId: string | null;
  employeeId: string;
  appointmentId: string;
  durationMin: number;
  timeZone?: string | null;
  minAdvance: number;
  maxAdvance: number;
}): Promise<RescheduleDay[]> {
  const { businessId, branchId, employeeId, appointmentId } = opts;
  const timeZone = opts.timeZone || DEFAULT_TIMEZONE;
  const maxDays = Math.max(1, opts.maxAdvance || 10);
  const start = startOfDay(new Date()).toISOString();
  const end = addMinutes(startOfDay(new Date()), (maxDays + 1) * 24 * 60).toISOString();

  const branchPromise = branchId
    ? (supabase.from("public_booking_branch_settings" as any) as any)
        .select("schedule")
        .eq("business_id", businessId)
        .eq("branch_id", branchId)
        .maybeSingle()
    : Promise.resolve({ data: null });

  const [settingsRes, branchRes, apptRes, closuresRes] = await Promise.all([
    supabase.from("public_booking_settings").select("schedule").eq("business_id", businessId).maybeSingle(),
    branchPromise,
    supabase
      .from("public_booking_appointments")
      .select("id,employee_id,starts_at,ends_at,duration_min,status")
      .eq("business_id", businessId)
      .gte("starts_at", start)
      .lte("starts_at", end),
    (supabase.from("public_booking_closures" as any) as any)
      .select("branch_id,start_date,end_date")
      .eq("business_id", businessId),
  ]);

  const raw = ((settingsRes.data as any)?.schedule ?? null) as Record<string, any> | null;
  const branchSchedule = (branchRes as any)?.data?.schedule ?? null;

  const employeeSchedules: Record<string, ScheduleMap> = {};
  for (const [id, value] of Object.entries((raw?._employeeSchedules ?? {}) as Record<string, unknown>)) {
    const n = normalizeEmployeeSchedule(value);
    if (n) employeeSchedules[id] = n;
  }
  const businessSpecial: SpecialDateMap = {};
  for (const [key, value] of Object.entries((raw?._specialDates ?? {}) as Record<string, unknown>)) {
    const n = normalizeDaySchedule(value);
    if (n) businessSpecial[key] = n;
  }
  const employeeSpecial: EmployeeSpecialDateMap = {};
  for (const [id, byDate] of Object.entries((raw?._employeeSpecialDates ?? {}) as Record<string, Record<string, unknown>>)) {
    if (!byDate || typeof byDate !== "object") continue;
    const map: SpecialDateMap = {};
    for (const [key, value] of Object.entries(byDate)) {
      const n = normalizeDaySchedule(value);
      if (n) map[key] = n;
    }
    if (Object.keys(map).length) employeeSpecial[id] = map;
  }

  const appointments = ((apptRes.data ?? []) as Appointment[]).filter((a) => a.id !== appointmentId);
  const closures = (Array.isArray(closuresRes.data) ? closuresRes.data : []) as Closure[];

  const days = buildSlots(
    normalizeSchedule(branchSchedule),
    appointments,
    [{ id: employeeId }],
    employeeId,
    opts.durationMin,
    maxDays,
    employeeSchedules,
    businessSpecial,
    employeeSpecial,
    timeZone,
    opts.minAdvance,
  );

  return days
    .filter((day) => {
      const key = toDateKey(day.date);
      return !closures.some(
        (c) => (c.branch_id == null || c.branch_id === branchId) && c.start_date <= key && key <= c.end_date,
      );
    })
    .map((day) => ({ date: day.date, slots: day.slots.map((s) => s.time) }))
    .filter((day) => day.slots.length > 0);
}
