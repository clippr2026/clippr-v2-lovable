import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
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
  normalizeEmployeeSchedule,
  resolveDaySchedule,
  resolveSingleDay,
  checkDaySchedule,
  parseTime,
} from "@/lib/availability";
import {
  type EmployeeServiceOverrideMap,
  type Promotion,
  backfillPromotionVigencia,
} from "@/lib/service-pricing";
import { appendHistorialCobro } from "@/lib/cobro-historial";

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
  created_at: string | null;
  updated_at: string | null;
  deposit_status?: string | null;
  cancel_reason?: string | null;
  deposit_amount?: number | null;
  deposit_paid?: number | null;
  // Promoción PREVISTA al agendar — solo informativa, nunca consume uso/
  // límite (eso pasa recién al confirmar el cobro en Caja). El snapshot
  // congela nombre/tipo/valor por si la promo se edita o borra después.
  promotion_id?: string | null;
  promotion_snapshot?: { name: string; discountType: string; discountValue: string } | null;
  recurring_series_id?: string | null;
};

export type Employee = { id: string; full_name: string; name?: string; avatar_url?: string | null; is_active?: boolean | null };
export type Service = {
  id: string;
  name: string;
  price: number;
  duration: number | null;
  image_url?: string | null;
  image_position?: string | null;
  // % "Precio en efectivo" (Configuración → Servicios) — misma fuente que
  // resolveServicePricing usa en Página Pública/Caja. Ver service-pricing.ts.
  cash_discount?: number | null;
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
export { DAY_KEYS, toDateKey, parseScheduleTime, normalizeDaySchedule, resolveDaySchedule, resolveSingleDay, checkDaySchedule, parseTime };
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
  const dateKey = toDateKey(date);

  // Excepciones puntuales de "Horario especial" (por profesional, para ESTA
  // fecha exacta) que superan el horario semanal del negocio — ver
  // resolveDaySchedule, que ya las respeta para disponibilidad. Sin esto, un
  // profesional habilitado por ejemplo de 10:00 a 19:00 en un negocio que
  // abre a las 11:00 queda disponible pero invisible: la grilla ni siquiera
  // dibuja la fila de las 10:00.
  let specialOpen: number | null = null;
  let specialClose: number | null = null;
  for (const emp of employees) {
    if (emp.is_active === false) continue;
    const override = employeeSpecial[emp.id]?.[dateKey];
    if (!override || override.enabled === false) continue;
    if (!isValidRange(override)) continue;
    const open = Math.round(parseScheduleTime(override.start) * 60);
    const close = Math.round(parseScheduleTime(override.end) * 60);
    specialOpen = specialOpen === null ? open : Math.min(specialOpen, open);
    specialClose = specialClose === null ? close : Math.max(specialClose, close);
  }

  // IMPORTANTE: usar el horario semanal del negocio como fuente principal de
  // la grilla. No lo expandimos con descansos, bloqueos ni horarios viejos.
  // Esto evita el bug donde la agenda se achicaba a 09:00–14:00 o quedaba vacía.
  // Sí se expande (nunca se achica) con excepciones puntuales por profesional.
  const weeklyBusinessDay = businessSchedule?.[dayKey] ?? null;
  if (isValidRange(weeklyBusinessDay)) {
    const bizOpen = Math.round(parseScheduleTime(weeklyBusinessDay!.start) * 60);
    const bizClose = Math.round(parseScheduleTime(weeklyBusinessDay!.end) * 60);
    return {
      start: minutesToScheduleTime(specialOpen === null ? bizOpen : Math.min(bizOpen, specialOpen)),
      end: minutesToScheduleTime(specialClose === null ? bizClose : Math.max(bizClose, specialClose)),
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

// Horario del NEGOCIO (top-level `schedule`) únicamente — exige los 7 días
// completos, si falta uno se trata como "sin cargar" (null). El horario
// propio de cada profesional usa normalizeEmployeeSchedule (importado del
// motor compartido), NO esta función — ver comentario donde se usa más abajo.
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
  const { businessId, activeBranchId } = useAuth();
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
  // Modo de aprobación de cobros por profesional (configurado en Equipo →
  // Editar profesional). Solo lectura acá — Agenda nunca lo edita.
  const [employeeApprovalEnabled, setEmployeeApprovalEnabled] = React.useState<Record<string, boolean>>({});
  const [employeeApprovalMode, setEmployeeApprovalMode] = React.useState<Record<string, "auto" | "manual">>({});
  // Precio/duración personalizados por profesional-servicio (configurados en
  // Equipo → Editar profesional → Comisiones). Único mapa que consume el
  // resolver compartido `resolveServicePricing` — ver src/lib/service-pricing.ts.
  const [employeeServiceOverrides, setEmployeeServiceOverrides] =
    React.useState<EmployeeServiceOverrideMap>({});
  // Promociones de la sucursal (Configuración → Promociones) — misma fuente
  // (`_promotions` dentro de branch_settings.schedule, NUNCA business_settings,
  // que es un espejo viejo sin actualizar) y mismo criterio de vigencia/
  // aplicabilidad que ya usa la Página Pública. Acá se exponen SIN filtrar
  // por vigencia: el diálogo de turno decide qué mostrar según servicio/
  // profesional elegidos en cada momento.
  const [promotions, setPromotions] = React.useState<Promotion[]>([]);
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

    // Multi-sucursal (fundación): branch_id se suma al .eq("business_id",
    // ...) de siempre, nunca lo reemplaza. Con activeBranchId en null
    // (negocio recién migrado, sin sucursal resuelta todavía) el filtro
    // no se aplica — mismo comportamiento que antes de esta migración.
    //
    // IMPORTANTE: el filtro nunca excluye branch_id NULL (.or(...) en vez
    // de .eq(...)). Un registro viejo (de antes de esta fundación) o
    // nacido en la ventana en que activeBranchId todavía no había resuelto
    // NO puede quedar invisible acá — eso dejaría turnos/clientes reales
    // que sí cuentan para disponibilidad (checkOverlap, que nunca filtró
    // por sucursal) pero desaparecen de la lista. branch_id = null se
    // trata como "visible en cualquier sucursal", igual que la intención
    // original de la migración (20260930010000: "branch_id... nunca un
    // límite nuevo").
    const branchFilter = activeBranchId ? `branch_id.eq.${activeBranchId},branch_id.is.null` : null;

    let apptQuery = supabase
      .from("appointments")
      .select(
        "id,business_id,client_id,client_name,service_name,service_price,starts_at,ends_at,duration_min,status,employee_id,notes,created_by_name,created_by_role,created_at,updated_at,promotion_id,promotion_snapshot,recurring_series_id,deposit_status,deposit_amount,cancel_reason",
      )
      .eq("business_id", businessId)
      .gte("starts_at", startIso)
      .lte("starts_at", endIso);
    if (branchFilter) apptQuery = apptQuery.or(branchFilter);
    apptQuery = apptQuery.order("starts_at");

    let empQuery = supabase
      .from("employees")
      .select("id,full_name,avatar_url,is_active")
      .eq("business_id", businessId);
    if (branchFilter) empQuery = empQuery.or(branchFilter);
    empQuery = empQuery.order("full_name", { ascending: true });

    let svcQuery = supabase
      .from("price_catalog")
      .select("id,name,price,duration_min,active,category,cash_discount")
      .eq("business_id", businessId)
      .not("duration_min", "is", null);
    if (branchFilter) svcQuery = svcQuery.or(branchFilter);
    svcQuery = svcQuery.order("name");

    let clientsQuery = supabase
      .from("clients")
      .select("id,full_name,phone,email,birth_date")
      .eq("business_id", businessId);
    if (branchFilter) clientsQuery = clientsQuery.or(branchFilter);
    clientsQuery = clientsQuery.order("full_name");

    const [aRes, eRes, sRes, cRes, bsRes, brsRes] = await Promise.allSettled([
      apptQuery,
      empQuery,
      svcQuery,
      clientsQuery,
      supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle(),
      // Promociones (`_promotions`): viven en branch_settings, NO en
      // business_settings — misma fuente que Configuración → Promociones
      // (promotions-section.tsx) y la reserva pública (reservar/$slug.tsx).
      // business_settings._promotions es un espejo viejo que ya no se
      // actualiza desde la migración a sucursales: leer de ahí mostraba
      // promociones desactualizadas o directamente ausentes apenas se
      // editaba/creaba una promo desde Configuración.
      activeBranchId
        ? supabase
            .from("branch_settings" as any)
            .select("schedule")
            .eq("business_id", businessId)
            .eq("branch_id", activeBranchId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
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
    const serviceImagePositionMap =
      rawSchedule && typeof rawSchedule._catalogImagePositions === "object" && rawSchedule._catalogImagePositions
        ? (rawSchedule._catalogImagePositions as Record<string, string>)
        : {};
    const rawEmployeeSchedules =
      rawSchedule && typeof rawSchedule._employeeSchedules === "object" && rawSchedule._employeeSchedules
        ? (rawSchedule._employeeSchedules as Record<string, unknown>)
        : {};
    // Horario propio de cada profesional: usa el mismo normalizador que la
    // reserva pública (normalizeEmployeeSchedule, en el motor compartido) —
    // antes esta pantalla tenía su propia versión "todo o nada" (un solo día
    // mal cargado tiraba el horario entero de la semana), distinta de la que
    // usaba la Página Pública. Única fuente de verdad para las dos.
    const normalizedEmployeeSchedules: Record<string, ScheduleMap> = {};
    for (const [empId, value] of Object.entries(rawEmployeeSchedules)) {
      const ns = normalizeEmployeeSchedule(value);
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

    setEmployeeApprovalEnabled(
      (rawSchedule?._employeeApprovalEnabled as Record<string, boolean>) ?? {},
    );
    setEmployeeApprovalMode(
      (rawSchedule?._employeeApprovalMode as Record<string, "auto" | "manual">) ?? {},
    );
    setEmployeeServiceOverrides(
      (rawSchedule?._employeeServiceOverrides as EmployeeServiceOverrideMap) ?? {},
    );
    const rawBranchSchedule =
      brsRes.status === "fulfilled" && !(brsRes.value as any).error
        ? (((brsRes.value as any).data?.schedule ?? null) as Record<string, unknown> | null)
        : null;
    setPromotions(
      Array.isArray(rawBranchSchedule?._promotions)
        ? (rawBranchSchedule!._promotions as Promotion[]).map(backfillPromotionVigencia)
        : [],
    );

    if (aRes.status === "fulfilled" && aRes.value.error) {
      // created_at puede no existir todavía en algunos negocios (columna
      // agregada por migración — ver 20260926040000_appointments_created_at)
      // — reintenta sin ella para no perder TODOS los turnos del día por un
      // campo secundario. Best-effort: si esto también falla, se mantiene
      // el comportamiento previo (appointments vacío).
      const retry = await supabase
        .from("appointments")
        .select(
          "id,business_id,client_id,client_name,service_name,service_price,starts_at,ends_at,duration_min,status,employee_id,notes,created_by_name,created_by_role,updated_at,promotion_id,promotion_snapshot,deposit_status,deposit_amount,cancel_reason",
        )
        .eq("business_id", businessId)
        .gte("starts_at", startIso)
        .lte("starts_at", endIso)
        .order("starts_at");
      setAppointments(!retry.error ? ((retry.data ?? []) as Appointment[]) : []);
    } else {
      setAppointments(
        aRes.status === "fulfilled" && !aRes.value.error
          ? ((aRes.value.data ?? []) as Appointment[])
          : [],
      );
    }
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
          image_position: serviceImagePositionMap[s.id] ?? "50% 50%",
          cash_discount: s.cash_discount ?? null,
        })),
    );
    setClients(
      cRes.status === "fulfilled" && !cRes.value.error
        ? ((cRes.value.data ?? []) as Client[])
        : [],
    );
    setLoading(false);

    // Fire-and-forget: completa series "sin fecha de finalización" que se
    // estén por quedar sin turnos generados. Nunca bloquea el render de la
    // Agenda ni muestra error al usuario (best-effort silencioso — ver
    // comentario en topUpRecurringSeries).
    topUpRecurringSeries(businessId, loadedSchedule, normalizedEmployeeSchedules, normalizedBizSpecial, normalizedEmpSpecial).catch(() => {});
  }, [businessId, activeBranchId, startIso, endIso]);

  // Narrow reloads used by realtime so a single appointment change does NOT
  // refetch employees, services, clients and schedule on every event. Mismo
  // filtro por sucursal que `load` (branch_id = activa O null, nunca
  // .eq puro) — antes no filtraba por sucursal en absoluto acá, así que un
  // evento realtime podía traer de vuelta turnos de otra sucursal que
  // `load` sí había excluido, o viceversa esconder recién creados: la
  // inconsistencia entre las dos queries era justamente lo que hacía
  // "parpadear" turnos reales al cargar.
  const loadAppointments = React.useCallback(async () => {
    if (!businessId) return;
    const branchFilter = activeBranchId ? `branch_id.eq.${activeBranchId},branch_id.is.null` : null;
    let apptQuery = supabase
      .from("appointments")
      .select(
        "id,business_id,client_id,client_name,service_name,service_price,starts_at,ends_at,duration_min,status,employee_id,notes,created_by_name,created_by_role,created_at,updated_at,promotion_id,promotion_snapshot,recurring_series_id,deposit_status,deposit_amount,cancel_reason",
      )
      .eq("business_id", businessId)
      .gte("starts_at", startIso)
      .lte("starts_at", endIso);
    if (branchFilter) apptQuery = apptQuery.or(branchFilter);
    const { data, error } = await apptQuery.order("starts_at");
    if (!error) {
      setAppointments((data ?? []) as Appointment[]);
      return;
    }
    // created_at puede no existir todavía (ver comentario en `load` más
    // arriba) — reintenta sin ella para que los reloads de realtime sigan
    // funcionando en vez de quedarse pegados con datos viejos.
    let retryQuery = supabase
      .from("appointments")
      .select(
        "id,business_id,client_id,client_name,service_name,service_price,starts_at,ends_at,duration_min,status,employee_id,notes,created_by_name,created_by_role,updated_at,promotion_id,promotion_snapshot,deposit_status,deposit_amount,cancel_reason",
      )
      .eq("business_id", businessId)
      .gte("starts_at", startIso)
      .lte("starts_at", endIso);
    if (branchFilter) retryQuery = retryQuery.or(branchFilter);
    const retry = await retryQuery.order("starts_at");
    if (!retry.error) setAppointments((retry.data ?? []) as Appointment[]);
  }, [businessId, activeBranchId, startIso, endIso]);

  const loadServices = React.useCallback(async () => {
    if (!businessId) return;
    let loadServicesQuery = supabase
      .from("price_catalog")
      .select("id,name,price,duration_min,active,category,cash_discount")
      .eq("business_id", businessId)
      .not("duration_min", "is", null);
    if (activeBranchId) loadServicesQuery = loadServicesQuery.or(`branch_id.eq.${activeBranchId},branch_id.is.null`);
    loadServicesQuery = loadServicesQuery.order("name");

    const [{ data, error }, settingsRes] = await Promise.all([
      loadServicesQuery,
      supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);
    if (error) return;
    const rawSchedule = (settingsRes.data?.schedule ?? {}) as Record<string, unknown>;
    const serviceImageMap = (rawSchedule._catalogImages ?? {}) as Record<string, string>;
    const serviceImagePositionMap = (rawSchedule._catalogImagePositions ?? {}) as Record<string, string>;
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
          image_position: serviceImagePositionMap[s.id] ?? "50% 50%",
          cash_discount: s.cash_discount ?? null,
        })),
    );
  }, [businessId, activeBranchId]);

  React.useEffect(() => {
    const rangeKey = `${businessId ?? ""}|${activeBranchId ?? ""}|${startIso}|${endIso}`;
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
      .on(
        // _employeeServiceOverrides (precio/efectivo por profesional,
        // Configuración → Equipo) vive en business_settings.schedule, no en
        // price_catalog — sin esto, la vista previa de Agenda quedaba con
        // el override viejo hasta recargar la página aunque price_catalog
        // sí se actualizaba solo. load({silent:true}) relee TODO lo que
        // vive en esa misma fila (horarios, excepciones, overrides), igual
        // criterio que el resto de la app para cambios en business_settings.
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "business_settings",
          filter: `business_id=eq.${businessId}`,
        },
        () => {
          load({ silent: true });
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
  }, [businessId, loadAppointments, loadServices, load]);

  return {
    loading,
    businessId,
    activeBranchId,
    appointments,
    employees,
    services,
    clients,
    schedule,
    employeeSchedules,
    businessSpecialDates,
    employeeSpecialDates,
    employeeApprovalEnabled,
    employeeApprovalMode,
    employeeServiceOverrides,
    promotions,
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
  // Sucursal activa al crear el turno — nunca se toca en un update (un
  // turno no cambia de sucursal por sí solo al editarlo).
  branch_id?: string | null;
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
  // Promoción prevista (o null explícito para quitarla al editar). Siempre
  // se escribe el par completo — nunca solo el id — así el turno conserva
  // qué promo vio la recepción aunque la promo real cambie/desaparezca después.
  promotion_id?: string | null;
  promotion_snapshot?: { name: string; discountType: string; discountValue: string } | null;
  // Vincula este turno a una serie de "Repetir turno" (recurring_series).
  // Solo se pasa al CREAR turnos generados desde una recurrencia — nunca se
  // sobreescribe en un update salvo que el caller lo pida explícitamente.
  recurring_series_id?: string | null;
  // Solo al CREAR desde la Agenda (recepción o un profesional): manda el correo de confirmación al
  // cliente. Por defecto no manda nada: las series repetidas, los turnos regenerados y las
  // ediciones nunca disparan correos, así el cliente recibe uno solo por turno.
  notifyClient?: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Correo de confirmación al cliente cuando se agenda un turno desde la Agenda. No bloquea nada: el
// turno ya está guardado; si el cliente no tiene email, o el envío falla, solo se avisa.
async function sendAgendaConfirmationEmail(input: SaveAppointmentInput, saved: Record<string, any> | undefined) {
  try {
    if (!saved?.id) return;
    if (input.status && input.status !== "pending" && input.status !== "confirmed") return;

    let storedEmail = "";
    let phone = (input.client_phone ?? "").trim();
    if (input.client_id) {
      const { data: client } = await supabase.from("clients").select("email,phone").eq("id", input.client_id).maybeSingle();
      storedEmail = ((client?.email as string | null) ?? "").trim();
      phone = phone || ((client?.phone as string | null) ?? "").trim();
    }
    const email = (input.client_email ?? "").trim() || storedEmail;
    if (!EMAIL_RE.test(email)) return;

    const { data: biz } = await supabase.from("businesses").select("timezone").eq("id", input.business_id).maybeSingle();
    const timeZone = ((biz?.timezone as string | null) ?? "") || "America/Argentina/Buenos_Aires";
    let professional = "Sin preferencia";
    if (input.employee_id) {
      const { data: emp } = await supabase.from("employees").select("full_name").eq("id", input.employee_id).maybeSingle();
      professional = ((emp?.full_name as string | null) ?? "").trim() || professional;
    }

    const start = new Date(input.starts_at);
    const { error } = await supabase.functions.invoke("send-booking-email", {
      body: {
        type: "confirmation",
        businessId: input.business_id,
        to: email,
        booking: {
          services: input.service_name,
          professional,
          clientName: input.client_name,
          clientPhone: phone || null,
          clientEmail: email,
          appointmentId: saved.id,
          manageToken: (saved.manage_token as string | null) ?? null,
          date: start.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone }),
          time: start.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone }),
          total: Number(input.service_price) || 0,
          startIso: input.starts_at,
          durationMin: input.duration_min,
        },
      },
    });
    if (error) throw error;
    toast.success(`Confirmación enviada a ${email}`);
  } catch (e) {
    console.error("send-booking-email (agenda)", e);
    toast.error("El turno se guardó, pero no se pudo enviar el correo de confirmación.");
  }
}

/**
 * Avisa por correo al cliente que su turno cambió de horario (desde la Agenda).
 * Solo si el horario realmente cambió y el nuevo es a futuro; la función de
 * correo manda al email que el cliente tiene guardado y no hace nada si no tiene.
 */
export async function notifyRescheduleEmail(
  appointmentId: string,
  businessId: string,
  previousStartsAt: string | null | undefined,
  newStartsAt: string,
  // Nombre del profesional anterior, solo si el turno cambió de profesional.
  previousProfessional?: string | null,
) {
  try {
    if (!previousStartsAt) return;
    const before = new Date(previousStartsAt).getTime();
    const after = new Date(newStartsAt).getTime();
    if (Number.isNaN(before) || Number.isNaN(after) || after <= Date.now()) return;
    // Se avisa si cambió el horario o el profesional.
    if (before === after && !previousProfessional) return;
    const { data, error } = await supabase.functions.invoke("send-booking-email", {
      body: { type: "reschedule", businessId, booking: { appointmentId, previousStartIso: previousStartsAt, previousProfessional: previousProfessional ?? null } },
    });
    if (error) throw error;
    if (data && typeof data === "object" && !(data as Record<string, unknown>).skipped) {
      toast.success("Le avisamos al cliente del nuevo horario");
    }
  } catch (e) {
    console.error("send-booking-email (reprogramación)", e);
    toast.error("El turno se movió, pero no se pudo enviar el aviso al cliente.");
  }
}

export async function saveAppointment(input: SaveAppointmentInput) {
  // Único punto real de creación de turnos (Agenda, Mi Agenda, cualquier
  // otro punto de entrada pasan todos por acá) — validar acá, no solo en el
  // click del menú, para que no se puedan crear turnos retroactivos por otra
  // vía. Solo aplica a turnos NUEVOS (!input.id): editar o cambiar el estado
  // de un turno ya existente que quedó en el pasado (confirmar, cobrar, no
  // asistió, etc.) tiene que seguir funcionando siempre.
  if (!input.id && new Date(input.starts_at).getTime() < Date.now()) {
    throw new Error("No podés crear turnos en horarios que ya pasaron.");
  }

  // Cierres (Fase 5): bloquea turnos NUEVOS en un rango cerrado de la
  // sucursal — nunca afecta turnos ya existentes (confirmar, cobrar,
  // reprogramar), solo la creación. branch_id null = cierre general del
  // negocio (sin sucursales configuradas); si no, tiene que coincidir
  // exactamente con la sucursal del turno, nunca "se filtra" a otra.
  if (!input.id) {
    const dateOnly = new Date(input.starts_at).toLocaleDateString("sv-SE");
    const { data: closureRows } = await supabase
      .from("closures" as any)
      .select("branch_id")
      .eq("business_id", input.business_id)
      .lte("start_date", dateOnly)
      .gte("end_date", dateOnly);
    const blocked = ((closureRows ?? []) as { branch_id: string | null }[]).some(
      (c) => (c.branch_id ?? null) === (input.branch_id ?? null),
    );
    if (blocked) {
      throw new Error("El negocio está cerrado ese día. No se pueden agendar turnos nuevos.");
    }
  }

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
    promotion_id: input.promotion_id ?? null,
    promotion_snapshot: input.promotion_snapshot ?? null,
    recurring_series_id: input.recurring_series_id ?? null,
    updated_at: new Date().toISOString(),
  };
  if (!input.id) {
    payload.created_by_name = input.created_by_name ?? null;
    payload.created_by_role = input.created_by_role ?? null;
    payload.branch_id = input.branch_id ?? null;
  }

  let previousStartsAt: string | null = null;
  let previousProfessional: string | null = null;
  if (input.id) {
    const { data: prev } = await supabase.from("appointments").select("starts_at,employee_id").eq("id", input.id).maybeSingle();
    previousStartsAt = (prev?.starts_at as string | undefined) ?? null;
    // Si cambió de profesional, el correo dice quién era antes.
    const prevEmployeeId = (prev?.employee_id as string | null | undefined) ?? null;
    if (prevEmployeeId && input.employee_id && prevEmployeeId !== input.employee_id) {
      const { data: emp } = await supabase.from("employees").select("full_name").eq("id", prevEmployeeId).maybeSingle();
      previousProfessional = ((emp?.full_name as string | null | undefined) ?? "").trim() || null;
    }
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
  const created = data?.[0];
  if (!input.id && input.notifyClient && created) void sendAgendaConfirmationEmail(input, created as Record<string, any>);
  if (input.id && created && input.status !== "blocked" && input.status !== "cancelled") {
    void notifyRescheduleEmail(input.id, input.business_id, previousStartsAt, input.starts_at, previousProfessional);
  }
  return created;
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
  by: { userId?: string | null; name?: string | null; role?: string | null; reason?: string | null },
) {
  const { error } = await supabase
    .from("appointments")
    .update({
      status: "cancelled",
      cancel_reason: by.reason?.trim() || null,
      cancelled_at: new Date().toISOString(),
      cancelled_by_name: by.name ?? null,
      cancelled_by_role: by.role ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Deja registro de QUIÉN canceló (nombre visible, nunca username/email
  // crudo — eso es responsabilidad del caller: `by.name` debe venir ya
  // resuelto, ej. profile.full_name) para que "Cancelado por X" se pueda
  // mostrar tanto en Mi Agenda como en la Agenda general — antes esto se
  // escribía a mano solo desde Mi Agenda (professionals.tsx), así que la
  // Agenda web nunca tenía este dato.
  if (by.name) {
    try {
      await appendHistorialCobro(id, {
        time: new Date().toTimeString().slice(0, 5),
        user: by.name,
        role: by.role === "profesional" || by.role === "cliente" ? by.role : "recepcion",
        action: "Canceló",
        reason: by.reason?.trim() || undefined,
      });
    } catch {
      // No bloquear la cancelación (ya confirmada arriba) si esto falla.
    }
  }

  void notifyCancellationEmail(id, by.reason);
}

// Avisa al cliente por correo que su turno fue cancelado desde el local (Agenda o Mi Panel). Solo en
// turnos normales: no en series recurrentes, no en turnos con seña (esos tienen su propio aviso) ni
// cuando se cancela por comprobante rechazado (el cliente ya fue derivado al local).
async function notifyCancellationEmail(appointmentId: string, reason?: string | null) {
  try {
    if ((reason ?? "").trim().toLowerCase() === "comprobante rechazado") return;
    const { data: appt } = await supabase
      .from("appointments")
      .select("business_id,recurring_series_id,starts_at")
      .eq("id", appointmentId)
      .maybeSingle();
    if (!appt || appt.recurring_series_id) return;
    if (new Date(appt.starts_at as string).getTime() <= Date.now()) return;
    const { data: dep } = await (supabase.from("appointment_deposits" as any) as any)
      .select("id")
      .eq("appointment_id", appointmentId)
      .maybeSingle();
    if (dep?.id) return;
    const { data, error } = await supabase.functions.invoke("send-booking-email", {
      body: { type: "cancellation", businessId: appt.business_id, booking: { appointmentId } },
    });
    if (error) throw error;
    if (data && typeof data === "object" && !(data as Record<string, unknown>).skipped) {
      toast.success("Le avisamos al cliente de la cancelación");
    }
  } catch (e) {
    console.error("send-booking-email (cancelación)", e);
  }
}

// "Este y los siguientes" al editar un turno de una recurrencia — propaga
// SOLO los campos de contenido (servicio, precio, duración, profesional,
// notas) a los demás turnos de la misma serie con fecha >= la de este
// turno. Nunca toca el patrón de días/horario (eso es "Editar recurrencia"
// desde la ficha del cliente) ni turnos pasados/cobrados/ya cancelados —
// cada uno conserva su propio starts_at.
export async function applyToFollowingInSeries(
  seriesId: string,
  fromStartsAtIso: string,
  excludeId: string,
  patch: {
    service_name: string;
    service_price: number;
    duration_min: number;
    employee_id: string | null;
    notes: string | null;
  },
) {
  const { error } = await supabase
    .from("appointments")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("recurring_series_id", seriesId)
    .gte("starts_at", fromStartsAtIso)
    .neq("id", excludeId)
    .not("status", "in", "(charged,cancelled)");
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

function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// Días de anticipación con que se puede agendar (Configuración → Horarios → Reservas).
// Si hay varias sucursales se toma el mayor; sin configuración, 30.
export async function getMaxAdvanceDays(businessId: string): Promise<number> {
  const { data } = await supabase.from("branch_settings" as any).select("schedule").eq("business_id", businessId);
  let max = 0;
  for (const row of (data ?? []) as Array<{ schedule?: Record<string, any> | null }>) {
    const v = Number(row.schedule?._settings?.maxAdvance);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max || 30;
}

// Agenda los turnos de las series recurrentes DENTRO del límite de anticipación de reservas
// (Configuración → Horarios) y, a medida que pasan los días y se libera lugar, va agendando los
// siguientes. Los turnos nacen "Por confirmar": el cliente recibe 2 horas antes un correo para
// confirmar asistencia.
//
// Best-effort y silencioso a propósito: corre solo (fire-and-forget) cada vez que carga la
// Agenda — no hay a quién preguntarle si una fecha puntual choca con otro turno, así que esa
// fecha simplemente se saltea (una ocurrencia menos esa semana) en vez de bloquear el resto.
//
// Usar `last_generated_until` como ancla local para contar "cada N semanas" es equivalente a
// contar desde la fecha original de la serie: siempre es una fecha que SÍ se generó (fase 0 del
// ciclo de every_weeks), así que reiniciar el conteo ahí preserva el patrón.
export async function topUpRecurringSeries(
  businessId: string,
  schedule: ScheduleMap | null,
  employeeSchedules: Record<string, ScheduleMap>,
  businessSpecialDates: SpecialDateMap,
  employeeSpecialDates: EmployeeSpecialDateMap,
): Promise<void> {
  const maxAdvance = await getMaxAdvanceDays(businessId);
  const windowEnd = addCalendarDays(new Date(), maxAdvance);
  windowEnd.setHours(23, 59, 59, 0);
  const windowEndIso = windowEnd.toISOString().slice(0, 10);

  const { data: seriesRows, error } = await supabase
    .from("recurring_series" as any)
    .select("*")
    .eq("business_id", businessId)
    .eq("status", "active");
  if (error || !seriesRows?.length) return;

  for (const s of seriesRows as any[]) {
    try {
      if (s.last_generated_until && String(s.last_generated_until) >= windowEndIso) continue;
      const weekdays: number[] = Array.isArray(s.weekdays) ? s.weekdays : [];
      if (!weekdays.length) continue;
      const everyWeeks = Math.max(1, Number(s.every_weeks) || 1);
      const [h, m] = String(s.start_time || "09:00").split(":").map((x: string) => Number(x) || 0);
      const durationMin = Number(s.duration_min) || 30;

      // Series con cantidad fija: no se generan más turnos que los pedidos.
      let remaining = Infinity;
      if (s.end_mode === "count") {
        const { count: existing } = await supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("recurring_series_id", s.id);
        remaining = Math.max(0, (Number(s.end_count) || 0) - (existing ?? 0));
        if (remaining === 0) continue;
      }
      const endUntil = s.end_mode === "until" && s.end_until ? new Date(`${s.end_until}T23:59:59`) : null;

      const anchor = s.last_generated_until ? new Date(`${s.last_generated_until}T00:00:00`) : new Date();
      const spanDays = Math.ceil((windowEnd.getTime() - anchor.getTime()) / 86_400_000);

      const candidates: Date[] = [];
      for (let i = 1; i <= spanDays; i++) {
        if (Math.floor(i / 7) % everyWeeks !== 0) continue;
        const day = addCalendarDays(anchor, i);
        if (!weekdays.includes(day.getDay())) continue;
        day.setHours(h, m, 0, 0);
        if (day.getTime() <= Date.now() || day > windowEnd) continue;
        if (endUntil && day > endUntil) break;
        candidates.push(day);
      }

      let created = 0;
      for (const date of candidates) {
        if (created >= remaining) break;
        try {
          if (s.employee_id) {
            const day = resolveDaySchedule(schedule, employeeSchedules, businessSpecialDates, employeeSpecialDates, s.employee_id, date);
            if (checkDaySchedule(day, date, durationMin)) continue;
            const conflict = await checkOverlap(s.employee_id, date.toISOString(), durationMin, null);
            if (conflict) continue;
          }
          await saveAppointment({
            business_id: businessId,
            client_id: s.client_id ?? null,
            client_name: s.client_name,
            employee_id: s.employee_id ?? null,
            service_name: s.service_name,
            service_price: Number(s.service_price) || 0,
            duration_min: durationMin,
            starts_at: date.toISOString(),
            status: "pending",
            recurring_series_id: s.id,
          });
          created++;
        } catch {
          // Una fecha puntual que falla (choque, etc.) no debe frenar el
          // resto — se saltea, sin UI a quién preguntarle.
        }
      }

      const lastCandidate = candidates[candidates.length - 1];
      if (lastCandidate) {
        await supabase
          .from("recurring_series" as any)
          .update({ last_generated_until: lastCandidate.toISOString().slice(0, 10), updated_at: new Date().toISOString() })
          .eq("id", s.id);
      }
    } catch {
      // Una serie con error no debe frenar el top-up del resto.
    }
  }
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
