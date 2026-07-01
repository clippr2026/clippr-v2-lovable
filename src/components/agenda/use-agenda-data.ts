import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
// Tipos y resolución de prioridad de horarios viven en el motor compartido
// (`@/lib/availability`) para que la Agenda y la reserva online usen EXACTAMENTE
// la misma lógica. Acá se reexportan para no romper imports existentes.
import {
  type DayKey,
  type DaySchedule,
  type ScheduleMap,
  type SpecialDateMap,
  type EmployeeSpecialDateMap,
  DAY_KEYS,
  toDateKey,
  parseScheduleTime,
  normalizeDaySchedule,
  resolveDaySchedule,
  checkDaySchedule,
} from "@/lib/availability";

/**
 * Datos de la Agenda. Carga turnos (appointments) del rango visible,
 * más empleados, servicios y clientes del business para los pickers.
 *
 * Mantiene los nombres de columnas usados por la app vanilla (app.js):
 *   appointments: id, business_id, client_id, client_name, service_name,
 *     service_price, starts_at, ends_at?, duration_min?, status, employee_id,
 *     notes,    
 *     created_by_name, created_by_role, updated_at
 *   En edición manual del turno se usan solamente: pending | confirmed.
 *   Los otros estados quedan reservados para flujos internos de caja/cancelación.
 */

export type ApptStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show"
  | "charged"
  | "blocked";

export type Appointment = {
  id: string;
  business_id: string;
  client_id: string | null;
  client_name: string | null;
  service_name: string | null;
  service_price: number | null;
  starts_at: string;
  ends_at: string | null;
  duration_min: number | null;
  status: ApptStatus;
  employee_id: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_by_role: string | null;
  updated_at: string | null;
  deposit_status?: string | null;
  deposit_amount?: number | null;
  deposit_paid?: number | null;
};

export type Employee = { id: string; full_name: string; name?: string; avatar_url?: string | null; is_active?: boolean | null };
export type Service = {
  id: string;
  name: string;
  price: number;
  duration: number | null;
};
export type Client = {
  id: string;
  name?: string | null;
  full_name?: string | null;
  phone: string | null;
  email?: string | null;
  birth_date?: string | null;
};

// Reexport de tipos y resolución compartidos (definidos en @/lib/availability).
export { DAY_KEYS, toDateKey, parseScheduleTime, normalizeDaySchedule, resolveDaySchedule, checkDaySchedule };
export type { DayKey, DaySchedule, ScheduleMap, SpecialDateMap, EmployeeSpecialDateMap };

// (toDateKey y normalizeDaySchedule se importan de @/lib/availability)

// (resolveDaySchedule y checkDaySchedule se importan de @/lib/availability)

function isSameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function minutesToScheduleTime(minutes: number) {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function getAppointmentEnd(appt: Appointment) {
  if (appt.ends_at) return new Date(appt.ends_at);

  const start = new Date(appt.starts_at);
  return new Date(start.getTime() + Number(appt.duration_min ?? 30) * 60000);
}

// Rango visible de la Agenda para un día.
// Regla segura para la vista:
// 1) Si Configuración → Horarios tiene un rango semanal para el negocio, la
//    agenda usa EXACTAMENTE ese rango. Ej.: 11:00–20:00 ⇒ no muestra 09/10.
// 2) Si no hay horario semanal del negocio para ese día, recién ahí usa horarios
//    individuales/especiales de profesionales.
// 3) Si tampoco hay rango pero existen turnos reales, muestra el rango de esos
//    turnos para que la agenda nunca quede en blanco.
export function getVisibleRange(
  businessSchedule: ScheduleMap | null,
  employeeSchedules: Record<string, ScheduleMap>,
  businessSpecial: SpecialDateMap,
  employeeSpecial: EmployeeSpecialDateMap,
  employees: { id: string; is_active?: boolean }[],
  date: Date,
  appointments: Appointment[] = [],
): { start: string; end: string } | null {
  const isValidRange = (day: DaySchedule | null | undefined) => {
    if (!day || day.enabled === false) return false;
    const start = Math.round(parseScheduleTime(day.start) * 60);
    const end = Math.round(parseScheduleTime(day.end) * 60);
    return Number.isFinite(start) && Number.isFinite(end) && end > start;
  };

  const dayKey = DAY_KEYS[date.getDay()];

  // IMPORTANTE: usar el horario semanal del negocio como fuente principal de
  // la grilla. No lo expandimos con descansos, bloqueos ni horarios viejos.
  // Esto evita el bug donde la agenda se achicaba a 09:00–14:00 o quedaba vacía.
  const weeklyBusinessDay = businessSchedule?.[dayKey] ?? null;
  if (isValidRange(weeklyBusinessDay)) {
    return {
      start: weeklyBusinessDay!.start,
      end: weeklyBusinessDay!.end,
    };
  }

  let coreOpen: number | null = null;
  let coreClose: number | null = null;

  // Fallback: horarios efectivos de profesionales activos.
  for (const emp of employees) {
    if (emp.is_active === false) continue;
    const day = resolveDaySchedule(
      businessSchedule,
      employeeSchedules,
      businessSpecial,
      employeeSpecial,
      emp.id,
      date,
    );
    if (!isValidRange(day)) continue;
    const open = Math.round(parseScheduleTime(day!.start) * 60);
    const close = Math.round(parseScheduleTime(day!.end) * 60);
    coreOpen = coreOpen === null ? open : Math.min(coreOpen, open);
    coreClose = coreClose === null ? close : Math.max(coreClose, close);
  }

  // Último fallback: turnos reales del día. Así, aunque el horario esté mal
  // cargado o cerrado por error, la agenda no desaparece.
  let apptStart: number | null = null;
  let apptEnd: number | null = null;
  for (const appt of appointments) {
    if (appt.status === "cancelled") continue;
    if (!isSameLocalDay(new Date(appt.starts_at), date)) continue;
    const start = new Date(appt.starts_at);
    const end = getAppointmentEnd(appt);
    const sMin = start.getHours() * 60 + start.getMinutes();
    const eMin = end.getHours() * 60 + end.getMinutes();
    apptStart = apptStart === null ? sMin : Math.min(apptStart, sMin);
    apptEnd = apptEnd === null ? eMin : Math.max(apptEnd, eMin);
  }

  const starts = [coreOpen, apptStart].filter((v): v is number => v !== null);
  const ends = [coreClose, apptEnd].filter((v): v is number => v !== null);
  if (!starts.length || !ends.length) return null;

  return {
    start: minutesToScheduleTime(Math.min(...starts)),
    end: minutesToScheduleTime(Math.max(...ends)),
  };
}

export function getScheduleForDate(
  schedule: ScheduleMap | null,
  date: Date,
  appointments: Appointment[] = [],
): DaySchedule | null {
  if (!schedule) return null;

  const baseDay = schedule[DAY_KEYS[date.getDay()]] ?? null;
  if (!baseDay) return null;

  const dayAppointments = appointments.filter((appt) => {
    if (appt.status === "cancelled") return false;
    return isSameLocalDay(new Date(appt.starts_at), date);
  });

  if (!dayAppointments.length) return baseDay;

  const configuredStartMin = Math.round(parseScheduleTime(baseDay.start) * 60);
  const configuredEndMin = Math.round(parseScheduleTime(baseDay.end) * 60);

  let visualStartMin = configuredStartMin;
  let visualEndMin = configuredEndMin;

  for (const appt of dayAppointments) {
    const apptStart = new Date(appt.starts_at);
    const apptEnd = getAppointmentEnd(appt);

    const apptStartMin = apptStart.getHours() * 60 + apptStart.getMinutes();
    const apptEndMin = apptEnd.getHours() * 60 + apptEnd.getMinutes();

    visualStartMin = Math.min(visualStartMin, apptStartMin);
    visualEndMin = Math.max(visualEndMin, apptEndMin);
  }

  return {
    ...baseDay,
    start: minutesToScheduleTime(visualStartMin),
    end: minutesToScheduleTime(visualEndMin),
  };
}

export function checkSchedule(
  schedule: ScheduleMap | null,
  startsAt: Date,
  durationMin: number,
): string | null {
  if (!schedule) return null;
  return checkDaySchedule(schedule[DAY_KEYS[startsAt.getDay()]] ?? null, startsAt, durationMin);
}

function normalizeSchedule(value: unknown): ScheduleMap | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, any>;
  const required: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  const normalized = {} as ScheduleMap;
  for (const key of required) {
    const day = source[key];
    if (!day || typeof day !== "object") return null;
    normalized[key] = {
      enabled: day.enabled !== false,
      start: typeof day.start === "string" ? day.start : "00:00",
      end: typeof day.end === "string" ? day.end : "00:00",
      breakStart: typeof day.breakStart === "string" ? day.breakStart : undefined,
      breakEnd: typeof day.breakEnd === "string" ? day.breakEnd : undefined,
    };
  }

  return normalized;
}


export function useAgendaData(rangeStart: Date, rangeEnd: Date) {
  const { businessId } = useAuth();
  const [loading, setLoading] = React.useState(true);
  const [appointments, setAppointments] = React.useState<Appointment[]>([]);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [services, setServices] = React.useState<Service[]>([]);
  const [clients, setClients] = React.useState<Client[]>([]);
  const [schedule, setSchedule] = React.useState<ScheduleMap | null>(null);
  // Horario individual por profesional, guardado en business_settings.schedule
  // bajo la clave `_employeeSchedules[employeeId]`. Mapa id → ScheduleMap.
  const [employeeSchedules, setEmployeeSchedules] = React.useState<Record<string, ScheduleMap>>({});
  // Horarios especiales por fecha (override puntual).
  const [businessSpecialDates, setBusinessSpecialDates] = React.useState<SpecialDateMap>({});
  const [employeeSpecialDates, setEmployeeSpecialDates] = React.useState<EmployeeSpecialDateMap>({});
  const [realtimeStatus, setRealtimeStatus] = React.useState<"connecting" | "connected" | "disconnected">("connecting");

  const startIso = rangeStart.toISOString();
  const endIso = rangeEnd.toISOString();

  // Recuerda para qué combinación de negocio + rango visible ya se mostró el
  // loader de pantalla completa. Así, el loader SOLO aparece quando:
  //   1) se entra a la Agenda por primera vez,
  //   2) cambia el día/semana/mes (rango visible),
  //   3) cambia el negocio activo.
  // Cualquier otro refetch (realtime, auto-refresh de sesión, mutaciones del
  // propio usuario) siempre entra en modo silencioso y nunca vuelve a mostrar
  // el loader ni desmonta la vista.
  const loadedKeyRef = React.useRef<string | null>(null);

  const load = React.useCallback(async (options?: { silent?: boolean }) => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    if (!options?.silent) setLoading(true);

    const [aRes, eRes, sRes, cRes, bsRes] = await Promise.allSettled([
      supabase
        .from("appointments")
        .select(
          "id,business_id,client_id,client_name,service_name,service_price,starts_at,ends_at,duration_min,status,employee_id,notes,created_by_name,created_by_role,updated_at",
        )
        .eq("business_id", businessId)
        .gte("starts_at", startIso)
        .lte("starts_at", endIso)
        .order("starts_at"),
      supabase
        .from("employees")
        .select("id,full_name,avatar_url,is_active")
        .eq("business_id", businessId)
        .order("full_name", { ascending: true }),
      supabase
        .from("price_catalog")
        .select("id,name,price,duration_min,active,category")
        .eq("business_id", businessId)
        .not("duration_min", "is", null)
        .order("name"),
      supabase
        .from("clients")
        .select("id,full_name,phone,email,birth_date")
        .eq("business_id", businessId)
        .order("full_name"),
      supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);

    const loadedSchedule =
      bsRes.status === "fulfilled" && !bsRes.value.error
        ? normalizeSchedule(bsRes.value.data?.schedule)
        : null;
    setSchedule(loadedSchedule);

    // Horarios por profesional: viven en la MISMA JSONB que el horario del
    // negocio (clave `_employeeSchedules`), que normalizeSchedule descarta.
    // Los extraigo del crudo y normalizo cada uno con el mismo validador.
    const rawSchedule =
      bsRes.status === "fulfilled" && !bsRes.value.error
        ? ((bsRes.value.data?.schedule ?? null) as Record<string, unknown> | null)
        : null;
    const serviceImageMap =
      rawSchedule && typeof rawSchedule._catalogImages === "object" && rawSchedule._catalogImages
        ? (rawSchedule._catalogImages as Record<string, string>)
        : {};
    const rawEmployeeSchedules =
      rawSchedule && typeof rawSchedule._employeeSchedules === "object" && rawSchedule._employeeSchedules
        ? (rawSchedule._employeeSchedules as Record<string, unknown>)
        : {};
    const normalizedEmployeeSchedules: Record<string, ScheduleMap> = {};
    for (const [empId, value] of Object.entries(rawEmployeeSchedules)) {
      const ns = normalizeSchedule(value);
      if (ns) normalizedEmployeeSchedules[empId] = ns;
    }
    setEmployeeSchedules(normalizedEmployeeSchedules);

    // Horarios especiales por fecha del negocio (`_specialDates`) y por
    // profesional (`_employeeSpecialDates[empId]`).
    const rawBizSpecial =
      rawSchedule && typeof rawSchedule._specialDates === "object" && rawSchedule._specialDates
        ? (rawSchedule._specialDates as Record<string, unknown>)
        : {};
    const normalizedBizSpecial: SpecialDateMap = {};
    for (const [dateKey, value] of Object.entries(rawBizSpecial)) {
      const nd = normalizeDaySchedule(value);
      if (nd) normalizedBizSpecial[dateKey] = nd;
    }
    setBusinessSpecialDates(normalizedBizSpecial);

    const rawEmpSpecial =
      rawSchedule && typeof rawSchedule._employeeSpecialDates === "object" && rawSchedule._employeeSpecialDates
        ? (rawSchedule._employeeSpecialDates as Record<string, Record<string, unknown>>)
        : {};
    const normalizedEmpSpecial: EmployeeSpecialDateMap = {};
    for (const [empId, byDate] of Object.entries(rawEmpSpecial)) {
      if (!byDate || typeof byDate !== "object") continue;
      const map: SpecialDateMap = {};
      for (const [dateKey, value] of Object.entries(byDate)) {
        const nd = normalizeDaySchedule(value);
        if (nd) map[dateKey] = nd;
      }
      if (Object.keys(map).length) normalizedEmpSpecial[empId] = map;
    }
    setEmployeeSpecialDates(normalizedEmpSpecial);

    setAppointments(
      aRes.status === "fulfilled" && !aRes.value.error
        ? ((aRes.value.data ?? []) as Appointment[])
        : [],
    );
    setEmployees(
      eRes.status === "fulfilled" && !eRes.value.error
        ? ((eRes.value.data ?? []) as Employee[])
        : [],
    );
    const svc =
      sRes.status === "fulfilled" && !sRes.value.error
        ? ((sRes.value.data ?? []) as unknown as (Service & { active?: boolean | null; duration_min?: number | null })[])
        : [];
    setServices(
      svc
        .filter((s) => s.active !== false && s.duration_min != null)
        .map((s) => ({
          id: s.id,
          name: s.name,
          price: Number(s.price) || 0,
          duration: Number(s.duration_min) || 30,
          image_url: serviceImageMap[s.id] ?? null,
        })),
    );
    setClients(
      cRes.status === "fulfilled" && !cRes.value.error
        ? ((cRes.value.data ?? []) as Client[])
        : [],
    );
    setLoading(false);
  }, [businessId, startIso, endIso]);

  // Narrow reloads used by realtime so a single appointment change does NOT
  // refetch employees, services, clients and schedule on every event.
  const loadAppointments = React.useCallback(async () => {
    if (!businessId) return;
    const { data, error } = await supabase
      .from("appointments")
      .select(
        "id,business_id,client_id,client_name,service_name,service_price,starts_at,ends_at,duration_min,status,employee_id,notes,created_by_name,created_by_role,updated_at",
      )
      .eq("business_id", businessId)
      .gte("starts_at", startIso)
      .lte("starts_at", endIso)
      .order("starts_at");
    if (!error) setAppointments((data ?? []) as Appointment[]);
  }, [businessId, startIso, endIso]);

  const loadServices = React.useCallback(async () => {
    if (!businessId) return;
    const [{ data, error }, settingsRes] = await Promise.all([
      supabase
        .from("price_catalog")
        .select("id,name,price,duration_min,active,category")
        .eq("business_id", businessId)
        .not("duration_min", "is", null)
        .order("name"),
      supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);
    if (error) return;
    const rawSchedule = (settingsRes.data?.schedule ?? {}) as Record<string, unknown>;
    const serviceImageMap = (rawSchedule._catalogImages ?? {}) as Record<string, string>;
    const svc = (data ?? []) as unknown as (Service & { active?: boolean | null; duration_min?: number | null })[];
    setServices(
      svc
        .filter((s) => s.active !== false && s.duration_min != null)
        .map((s) => ({
          id: s.id,
          name: s.name,
          price: Number(s.price) || 0,
          duration: Number(s.duration_min) || 30,
          image_url: serviceImageMap[s.id] ?? null,
        })),
    );
  }, [businessId]);

  React.useEffect(() => {
    const rangeKey = `${businessId ?? ""}|${startIso}|${endIso}`;
    const isGenuineRangeChange = loadedKeyRef.current !== rangeKey;
    loadedKeyRef.current = rangeKey;
    load({ silent: !isGenuineRangeChange });
  }, [load]);

  React.useEffect(() => {
    if (!businessId) {
      setRealtimeStatus("disconnected");
      return;
    }

    setRealtimeStatus("connecting");

    const channel = supabase
      .channel(`agenda-realtime-${businessId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `business_id=eq.${businessId}`,
        },
        () => {
          loadAppointments();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "price_catalog",
          filter: `business_id=eq.${businessId}`,
        },
        () => {
          loadServices();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRealtimeStatus("connected");
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRealtimeStatus("disconnected");
        }
      });

    const handleOnline = () => setRealtimeStatus("connected");
    const handleOffline = () => setRealtimeStatus("disconnected");
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      supabase.removeChannel(channel);
    };
  }, [businessId, loadAppointments, loadServices]);

  return {
    loading,
    businessId,
    appointments,
    employees,
    services,
    clients,
    schedule,
    employeeSchedules,
    businessSpecialDates,
    employeeSpecialDates,
    realtimeStatus,
    refresh: () => load({ silent: true }),
  };
}

// ---------------------------------------------------------------------------
// Mutaciones (portadas de app.js: saveAppointment / cancelAppointment / reschedule)
// ---------------------------------------------------------------------------

export type SaveAppointmentInput = {
  id?: string | null;
  business_id: string;
  client_id?: string | null;
  client_name: string;
  client_phone?: string | null;
  client_email?: string | null;
  employee_id: string | null;
  service_name: string;
  service_price: number;
  starts_at: string; // ISO
  duration_min: number;
  status?: ApptStatus;
  notes?: string | null;
  deposit_amount?: number | null;
  deposit_paid?: number | null;
  deposit_status?: string | null;
  created_by_name?: string | null;
  created_by_role?: string | null;
};

export async function saveAppointment(input: SaveAppointmentInput) {
  const ends = new Date(
    new Date(input.starts_at).getTime() + input.duration_min * 60_000,
  ).toISOString();

  const payload: Record<string, unknown> = {
    business_id: input.business_id,
    client_id: input.client_id ?? null,
    client_name: input.client_name,
    employee_id: input.employee_id,
    service_name: input.service_name,
    service_price: input.service_price,
    starts_at: input.starts_at,
    ends_at: ends,
    duration_min: input.duration_min,
    status: input.status ?? "pending",
    notes: input.notes ?? null,
    updated_at: new Date().toISOString(),
  };
  if (!input.id) {
    payload.created_by_name = input.created_by_name ?? null;
    payload.created_by_role = input.created_by_role ?? null;
  }

  const q = input.id
    ? supabase.from("appointments").update(payload).eq("id", input.id).select()
    : supabase.from("appointments").insert(payload).select();
  const { data, error } = await q;
  if (error) {
    // La exclusion constraint de Postgres rechaza turnos solapados para el mismo
    // profesional. Devolvemos un mensaje claro en vez del error crudo.
    const code = (error as { code?: string }).code;
    if (code === "23P01" || /appointments_no_overlap|exclusion|overlap/i.test(error.message)) {
      throw new Error("Ese horario ya no está disponible");
    }
    throw new Error(error.message);
  }
  return data?.[0];
}

export async function setAppointmentStatus(id: string, status: ApptStatus) {
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("appointments").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}


export async function markAppointmentDeposit(id: string, currentNotes?: string | null) {
  const hasDeposit = /se(ñ|n)a/i.test(currentNotes || "");
  const nextNotes = hasDeposit
    ? (currentNotes || "")
        .split(/\n+/)
        .filter((line) => !/se(ñ|n)a/i.test(line))
        .join("\n")
        .trim() || null
    : [currentNotes, "Seña paga"].filter(Boolean).join("\n");

  const { error } = await supabase
    .from("appointments")
    .update({
      notes: nextNotes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function cancelAppointment(
  id: string,
  by: { userId?: string | null; name?: string | null; role?: string | null },
) {
  const { error } = await supabase
    .from("appointments")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function rescheduleAppointment(
  id: string,
  startsAt: string,
  durationMin: number,
) {
  const ends = new Date(
    new Date(startsAt).getTime() + durationMin * 60_000,
  ).toISOString();
  const { error } = await supabase
    .from("appointments")
    .update({
      starts_at: startsAt,
      ends_at: ends,
      duration_min: durationMin,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Checks if a professional already has an appointment overlapping the given
 * time slot. Returns the conflicting appointment if found, null otherwise.
 *
 * Overlap condition: existingStart < newEnd && existingEnd > newStart
 * (i.e. any non-zero intersection).
 *
 * @param employeeId   - professional to check
 * @param startsAt     - ISO string of the new appointment start
 * @param durationMin  - duration in minutes
 * @param excludeId    - appointment ID to exclude (used when editing)
 */
export async function checkOverlap(
  employeeId: string,
  startsAt: string,
  durationMin: number,
  excludeId?: string | null,
): Promise<{ id: string; client_name: string | null; starts_at: string; status?: ApptStatus | null; service_name?: string | null } | null> {
  const newStart = new Date(startsAt);
  const newEnd   = new Date(newStart.getTime() + durationMin * 60_000);

  // Query appointments for this professional that could overlap.
  // We fetch a ±2 hour window to keep the query tight, then filter precisely.
  const windowStart = new Date(newStart.getTime() - 2 * 60 * 60_000).toISOString();
  const windowEnd   = new Date(newEnd.getTime()   + 2 * 60 * 60_000).toISOString();

  const { data, error } = await supabase
    .from("appointments")
    .select("id,client_name,service_name,starts_at,ends_at,duration_min,status")
    .eq("employee_id", employeeId)
    .neq("status", "cancelled")
    .neq("status", "blocked")
    .gte("starts_at", windowStart)
    .lte("starts_at", windowEnd);

  if (error || !data) return null;

  for (const appt of data) {
    if (excludeId && appt.id === excludeId) continue;
    const existStart = new Date(appt.starts_at);
    const existEnd   = appt.ends_at
      ? new Date(appt.ends_at)
      : new Date(existStart.getTime() + Number(appt.duration_min ?? 30) * 60_000);

    // True overlap: they share any time (touching endpoints don't count)
    if (existStart < newEnd && existEnd > newStart) {
      return { id: appt.id, client_name: appt.client_name, starts_at: appt.starts_at, status: appt.status as ApptStatus, service_name: (appt as any).service_name ?? null };
    }
  }

  return null;
}
