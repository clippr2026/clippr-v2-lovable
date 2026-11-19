// ════════════════════════════════════════════════════════════════════════════
//  useAdvisorAnalytics
//  ----------------------------------------------------------------------------
//  Fuente única de datos reales para la pestaña "Análisis" del Asesor IA
//  (Salud del negocio, Radiografía del local, Historial mensual). Una sola
//  tanda de consultas en paralelo (Promise.all), sin datos inventados: si no
//  hay historial suficiente, los campos quedan en null/0 y la UI debe mostrar
//  un estado vacío en vez de un número.
//
//  No se usa acá el hook de clientes por separado: ya lo consumen
//  useAiRecommendations/useLabData con la misma queryKey, así que React Query
//  reutiliza la misma respuesta en caché en vez de duplicar la consulta.
// ════════════════════════════════════════════════════════════════════════════

import * as React from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useClientsData } from "@/hooks/use-clients-data";
import { cajaDateKeyBA } from "@/lib/caja-cierre";
import { comparableUptoDay, loadMonthlyPerformance, shiftMonth, type MonthlyPerformance } from "@/lib/monthly-performance";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { computeHealthScore, computeRetention, type HealthScore, type VisitDay } from "@/lib/health-score";
import { countRecovery, type RecoveryCounts } from "@/lib/client-recovery";
import {
  computeCapacity,
  parseCapacityContext,
  slotMinutesForEmployee,
  type CapacityContext,
  type BlockInterval,
} from "@/lib/agenda-capacity";

const DONE_STATUSES = ["completed", "charged"];
const MONTHS_OF_HISTORY = 6;
// Cuántos meses se pueden elegir en el selector del Asesor (el actual + los 5 anteriores).
export const ADVISOR_MONTHS_SELECTABLE = MONTHS_OF_HISTORY;
const MIN_DAYS_TO_JUDGE = 7;
// Debajo de este % de la facturación en productos, el Radar lo marca como oportunidad (valor a ajustar con el negocio).
const PRODUCT_TARGET_PCT = 5;

export type AdvisorMonthSnapshot = {
  monthKey: string; // "2026-06"
  monthLabel: string; // "Junio 2026"
  revenue: number;
  expenses: number;
  profit: number;
  clientsServed: number;
  ticket: number;
  occupancy: number;
  cancellations: number;
  // Turnos en que el cliente no vino ("No asistió").
  noShows: number;
  doneCount: number;
  // Turnos sin ocupar en los días que se trabajó (capacidad − turnos usados).
  freeSlots: number;
  // ¿Sirve de base para comparar el mes siguiente? Solo deja de servir el mes de arranque.
  representative: boolean;
  // Mes de arranque del negocio (la primera venta fue pasados los primeros días del mes).
  partialStart: boolean;
  startDate: string | null;
  // Capacidad total del período (turnos que entran en los horarios) y turnos usados.
  totalSlots: number;
  usedSlots: number;
  // Ocupación de cada profesional activo: servicios vendidos contra SU capacidad.
  employeeLoad: Array<{ id: string; name: string; used: number; capacity: number }>;
  // Fechas trabajadas del período por día de la semana (0 = domingo): los días cerrados no figuran.
  openDatesByDow: Record<number, number>;
  // Horas del día en que el local atiende.
  openHours: number[];
  hasData: boolean;
};

export type RadiografiaItem = {
  key: string;
  label: string;
  value: string;
  // Dato que acompaña al valor principal (porcentaje, cantidad o monto).
  detail?: string;
  tone: "good" | "warn" | "bad" | "neutral";
};

export type RadarItem = {
  key: string;
  tone: "ok" | "warn" | "alert" | "bad";
  label: string;
};

export type AdvisorAnalytics = {
  loading: boolean;
  // Cantidad de datos reales analizados (para la presentación del Asesor).
  dataCounts: { payments: number; appts: number; clients: number };
  hasAnyData: boolean;
  current: AdvisorMonthSnapshot | null;
  previous: AdvisorMonthSnapshot | null;
  // Puntaje 0-100 (null si todavía no hay datos suficientes) y su detalle por indicador.
  health: number | null;
  healthScore: HealthScore | null;
  // Clientes para recuperar con la definición única (la misma del módulo Clientes).
  recovery: RecoveryCounts;
  history: AdvisorMonthSnapshot[];
  radiografia: RadiografiaItem[];
  radar: RadarItem[];
  freeSlotsMonth: number;
  // Lo que se facturaría de más si la ocupación llegara al 75% (turnos que faltan × ticket).
  potentialAt75: number;
  slotsTo75: number;
  // Venta de productos: % de la facturación y % de las ventas que llevan algún producto.
  productSharePct: number | null;
  productAttachPct: number | null;
  // Mes que está analizando "Salud del negocio" y la Radiografía. Con menos de 7 días del
  // mes en curso es el último mes completo (3 días no alcanzan para juzgar la salud).
  analysisMonthLabel: string;
  analysisNote: string | null;
  // Texto de la comparación: "vs mes anterior" o "vs el mismo período del mes anterior".
  vsLabel: string;
  // Mes en curso (si está en curso): facturación del mismo período del mes anterior.
  mtd: { monthKey: string; currentRevenue: number | null; previousRevenue: number | null; upToDay: number } | null;
};

type RawPayment = {
  id: string;
  total: number | null;
  amount: number | null;
  service_name: string | null;
  client_name: string | null;
  client_id: string | null;
  created_at: string;
  // Detalle ítem por ítem de la venta (servicio o producto de catálogo).
  items?: Array<{ name?: string | null; amount?: number | null; qty?: number | null; is_catalog?: boolean }> | null;
  employee_id?: string | null;
};

type RawAppt = {
  id: string;
  status: string;
  starts_at: string;
  service_name: string | null;
  service_price: number | null;
  employee_id: string | null;
  recurring_series_id?: string | null;
  ends_at?: string | null;
};

type RawExpense = { amount: number | null; date: string | null };
type RawEmployee = { id: string; full_name: string; is_active?: boolean | null };
type RawCatalogItem = { id: string; name: string; price: number | null; duration_min: number | null };

// El mes de un movimiento se decide en hora de Argentina, nunca en la del dispositivo
// (un cobro de las 23:30 del último día del mes no puede caer en el mes siguiente).
function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

function monthKeyOf(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).slice(0, 7);
}

function monthLabelOf(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function pctDelta(now: number, prev: number): number | null {
  if (prev <= 0) return now > 0 ? 100 : null;
  return Math.round(((now - prev) / prev) * 100);
}

async function loadAdvisorAnalytics(businessId: string, branchId: string | null): Promise<{
  payments: RawPayment[];
  appts: RawAppt[];
  expenses: RawExpense[];
  employees: RawEmployee[];
  catalog: RawCatalogItem[];
  schedule: unknown;
}> {
  const sinceDate = `${shiftMonth(cajaDateKeyBA().slice(0, 7), -MONTHS_OF_HISTORY)}-01`;
  const sinceIso = new Date(`${sinceDate}T00:00:00-03:00`).toISOString();
  // branch_id = null nunca se excluye (mismo criterio que Caja y el Rendimiento mensual).
  const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

  // Cobros: sin anulados/reembolsados (la caja tampoco los cuenta) y paginados — una
  // consulta sin .range() corta en silencio a las 1.000 filas.
  const paymentsPromise = fetchAllRows<RawPayment>((from, to) => {
    let q = supabase
      .from("payments")
      .select("id,total,amount,service_name,client_name,client_id,created_at,items,employee_id")
      .eq("business_id", businessId)
      .gte("created_at", sinceIso)
      .not("status", "in", "(anulado,reembolsado)")
      .order("id", { ascending: true });
    if (branchFilter) q = q.or(branchFilter);
    return q.range(from, to) as any;
  }).then(
    (data) => ({ data, error: null as { message: string } | null }),
    (error: Error) => ({ data: [] as RawPayment[], error: { message: error.message } }),
  );
  const apptsPromise = (async () => {
    try {
      return {
        data: await fetchAllRows<RawAppt>((from, to) => {
          let q = supabase
            .from("appointments")
            .select("id,status,starts_at,ends_at,service_name,service_price,employee_id,recurring_series_id")
            .eq("business_id", businessId)
            .gte("starts_at", sinceIso)
            .order("id", { ascending: true });
          if (branchFilter) q = q.or(branchFilter);
          return q.range(from, to) as any;
        }),
        error: null as { message: string } | null,
      };
    } catch (e) {
      // recurring_series_id puede no existir todavía (columna nueva) — reintenta sin ella.
      try {
        return {
          data: await fetchAllRows<RawAppt>((from, to) => {
            let q = supabase
              .from("appointments")
              .select("id,status,starts_at,ends_at,service_name,service_price,employee_id")
              .eq("business_id", businessId)
              .gte("starts_at", sinceIso)
              .order("id", { ascending: true });
            if (branchFilter) q = q.or(branchFilter);
            return q.range(from, to) as any;
          }),
          error: null as { message: string } | null,
        };
      } catch (e2) {
        return { data: [] as RawAppt[], error: { message: (e2 as Error).message } };
      }
    }
  })();
  const expensesPromise = fetchAllRows<RawExpense & { id: string }>((from, to) => {
    let q = supabase
      .from("expenses")
      .select("id,amount,date")
      .eq("business_id", businessId)
      .gte("date", sinceDate)
      .order("id", { ascending: true });
    if (branchFilter) q = q.or(branchFilter);
    return q.range(from, to) as any;
  }).then(
    (data) => ({ data, error: null as { message: string } | null }),
    (error: Error) => ({ data: [] as RawExpense[], error: { message: error.message } }),
  );

  const scheduleRes = await supabase
    .from("business_settings")
    .select("schedule")
    .eq("business_id", businessId)
    .maybeSingle();

  const [payRes, apptRes, expRes, empRes, catRes] = await Promise.all([
    paymentsPromise,
    apptsPromise,
    expensesPromise,
    // Solo los profesionales de la sucursal elegida (los sin sucursal asignada no se excluyen).
    (() => {
      let q = supabase.from("employees").select("id,full_name,is_active").eq("business_id", businessId);
      if (branchFilter) q = q.or(branchFilter);
      return q;
    })(),
    supabase
      .from("price_catalog")
      .select("id,name,price,duration_min")
      .eq("business_id", businessId)
      .eq("active", true),
  ]);

  return {
    payments: payRes.error ? [] : ((payRes.data ?? []) as RawPayment[]),
    appts: apptRes.error ? [] : ((apptRes.data ?? []) as RawAppt[]),
    expenses: expRes.error ? [] : ((expRes.data ?? []) as RawExpense[]),
    employees: empRes.error ? [] : ((empRes.data ?? []) as RawEmployee[]),
    catalog: catRes.error ? [] : ((catRes.data ?? []) as RawCatalogItem[]),
    schedule: scheduleRes.error ? null : ((scheduleRes.data as any)?.schedule ?? null),
  };
}

type CapacityData = { employees: RawEmployee[]; catalog: RawCatalogItem[]; ctx: CapacityContext };

function buildMonthSnapshot(
  monthKey: string,
  payments: RawPayment[],
  appts: RawAppt[],
  expenses: RawExpense[],
  capacityData: CapacityData,
  perf: MonthlyPerformance | undefined,
  uptoDay?: number,
): AdvisorMonthSnapshot {
  // Día de corte: el mes en curso solo llega hasta hoy; un mes cerrado, hasta su último día.
  const todayKeyBA = cajaDateKeyBA();
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  // En el mes en curso la ocupación se mide con días COMPLETOS (hasta ayer): hoy todavía no
  // terminó, y contar toda su agenda como vacía bajaba el porcentaje (a la madrugada, por ejemplo).
  const todayDayBA = Number(todayKeyBA.slice(8, 10));
  const cutoffDay =
    uptoDay ?? (monthKey === todayKeyBA.slice(0, 7) ? Math.max(1, todayDayBA - 1) : daysInMonth);
  const dayOf = (iso: string) =>
    Number(new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).slice(8, 10));

  const monthPayments = payments.filter((p) => monthKeyOf(p.created_at) === monthKey && dayOf(p.created_at) <= cutoffDay);
  const monthAppts = appts.filter((a) => monthKeyOf(a.starts_at) === monthKey && dayOf(a.starts_at) <= cutoffDay);
  const monthExpenses = expenses.filter(
    (e) => e.date && e.date.slice(0, 7) === monthKey && Number(e.date.slice(8, 10)) <= cutoffDay,
  );

  // Facturación, gastos, ganancia, clientes y ticket salen del mismo cálculo que el
  // Rendimiento mensual (por mes del servicio, sin anuladas, con todos los gastos y
  // el pago a profesionales), así ninguna parte del Asesor muestra otro número.
  const revenue = perf ? perf.facturacion : monthPayments.reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
  const expensesTotal = perf ? perf.gastosTotal : monthExpenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const clientsServed = perf
    ? perf.clientes
    : new Set(monthPayments.map((p) => p.client_id || p.client_name?.trim().toLowerCase()).filter(Boolean)).size;
  const ticket = perf ? perf.ticket : monthPayments.length > 0 ? Math.round(revenue / monthPayments.length) : 0;

  const cancellations = monthAppts.filter((a) => a.status === "cancelled").length;
  const noShows = monthAppts.filter((a) => a.status === "no_show").length;
  const doneCount = monthAppts.filter((a) => DONE_STATUSES.includes(a.status)).length;
  // Bloqueos de agenda (horarios que el profesional no estaba disponible): se restan de la capacidad.
  const baParts = (iso: string) => {
    const s = new Date(iso).toLocaleString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });
    return { dateKey: s.slice(0, 10), min: Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)) };
  };
  const blocks: BlockInterval[] = [];
  for (const a of appts) {
    if (a.status !== "blocked" || !a.employee_id || !a.ends_at) continue;
    const s = baParts(a.starts_at);
    const e = baParts(a.ends_at);
    blocks.push({ employeeId: a.employee_id, dateKey: s.dateKey, startMin: s.min, endMin: e.dateKey === s.dateKey ? e.min : 1440 });
  }
  // Capacidad REAL: para cada profesional activo, los turnos que entran en SU horario
  // (días que trabaja, entrada, salida y descanso) según cuánto dura lo que atiende —
  // 11 a 20 con 1 h de descanso y turnos de 1 h son 8; sin descanso, 9; con servicios de
  // 40 min, más. Solo hasta el día de corte (el mes en curso no cuenta días que no llegaron).
  // Lo usado son los servicios realmente cobrados en el período (con turno o por orden de
  // llegada): un turno agendado que nunca se cobró no ocupó la silla. Los bloqueos de agenda
  // se restan de la capacidad.
  const activeEmployees = capacityData.employees.filter((e) => e.is_active !== false);
  const activeIds = new Set(activeEmployees.map((e) => e.id));
  const soldByEmployee = new Map<string, Array<{ name: string; qty: number }>>();
  const usedByEmployee = new Map<string, number>();
  let servicesSold = 0;
  for (const p of monthPayments) {
    const lines = Array.isArray(p.items) ? p.items.filter((it) => it && !it.is_catalog) : [];
    const entries = lines.length > 0
      ? lines.map((it) => ({ name: String(it.name ?? "").trim(), qty: Number(it.qty ?? 1) > 0 ? Number(it.qty ?? 1) : 1 }))
      : [{ name: (p.service_name ?? "").trim(), qty: 1 }];
    const qtyTotal = entries.reduce((s, e) => s + e.qty, 0);
    // Solo cuenta lo vendido por los profesionales que están en la capacidad (activos y de esta sucursal):
    // lo de profesionales dados de baja o sin profesional inflaba la ocupación.
    if (!p.employee_id || !activeIds.has(p.employee_id)) continue;
    servicesSold += qtyTotal;
    if (p.employee_id) {
      const list = soldByEmployee.get(p.employee_id) ?? [];
      list.push(...entries.filter((e) => e.name));
      soldByEmployee.set(p.employee_id, list);
      usedByEmployee.set(p.employee_id, (usedByEmployee.get(p.employee_id) ?? 0) + qtyTotal);
    }
  }
  const slotMinutesByEmployee: Record<string, number> = {};
  for (const e of activeEmployees) {
    slotMinutesByEmployee[e.id] = slotMinutesForEmployee(
      e.id,
      soldByEmployee.get(e.id) ?? [],
      capacityData.catalog,
      capacityData.ctx.serviceOverrides,
    );
  }
  // En el mes de arranque la agenda cuenta desde el día en que el negocio empezó.
  const fromDay = perf?.startDate && perf.startDate.slice(0, 7) === monthKey ? Number(perf.startDate.slice(8, 10)) : 1;
  const { totalSlots, openDatesByDow, openHours } = computeCapacity({
    ctx: capacityData.ctx,
    employeeIds: activeEmployees.map((e) => e.id),
    monthKey,
    cutoffDay,
    fromDay,
    blocks,
    slotMinutesByEmployee,
  });
  const employeeLoad = activeEmployees.map((e) => ({
    id: e.id,
    name: e.full_name,
    used: usedByEmployee.get(e.id) ?? 0,
    capacity: computeCapacity({
      ctx: capacityData.ctx,
      employeeIds: [e.id],
      monthKey,
      cutoffDay,
      fromDay,
      blocks,
      slotMinutesByEmployee,
    }).totalSlots,
  }));
  const used = servicesSold;
  const occupancy = totalSlots > 0 ? Math.min(100, Math.round((used / totalSlots) * 100)) : 0;
  const freeSlots = Math.max(0, totalSlots - used);

  return {
    monthKey,
    monthLabel: monthLabelOf(monthKey),
    revenue,
    expenses: expensesTotal,
    profit: perf ? perf.ganancia : revenue - expensesTotal,
    clientsServed,
    ticket,
    occupancy,
    cancellations,
    noShows,
    doneCount,
    freeSlots,
    representative: perf ? perf.representative : true,
    partialStart: perf ? perf.partialStart : false,
    startDate: perf ? perf.startDate : null,
    totalSlots,
    usedSlots: used,
    employeeLoad,
    openDatesByDow,
    openHours,
    hasData: monthPayments.length > 0 || monthAppts.length > 0,
  };
}

function useAdvisorAnalyticsQuery(businessId: string | null | undefined, branchId: string | null | undefined) {
  return useQuery({
    queryKey: ["advisor-analytics", businessId, branchId ?? null],
    queryFn: () => loadAdvisorAnalytics(businessId!, branchId ?? null),
    enabled: !!businessId,
    staleTime: 60_000,
  });
}

// `selectedMonthKey`: el mes que se está mirando ("2026-10"). Todo el análisis (ocupación,
// salud, radiografía) sigue ese mes; sin él, el mes en curso. Tiene que estar dentro de
// los últimos MONTHS_OF_HISTORY meses.
export function useAdvisorAnalytics(
  businessId: string | null | undefined,
  selectedMonthKey?: string,
): AdvisorAnalytics {
  const { activeBranchId } = useAuth();
  const clientsQuery = useClientsData(businessId ?? null, { staleTime: 60_000 });
  const dataQuery = useAdvisorAnalyticsQuery(businessId, activeBranchId);

  // Los 6 meses de historial, en hora de Argentina (el más reciente primero).
  const currentMonth = cajaDateKeyBA().slice(0, 7);
  const monthKeys = React.useMemo(
    () => Array.from({ length: MONTHS_OF_HISTORY }, (_, i) => shiftMonth(currentMonth, -i)),
    [currentMonth],
  );
  // Misma consulta (y misma caché) que el Rendimiento mensual.
  const perfQueries = useQueries({
    queries: monthKeys.map((mk) => ({
      queryKey: ["monthly-performance", businessId, activeBranchId, mk, "mes-completo"],
      queryFn: () => loadMonthlyPerformance(businessId!, activeBranchId, mk),
      enabled: !!businessId,
      staleTime: 60_000,
    })),
  });
  // Mes que se analiza: el elegido (por defecto el mes en curso).
  const todayDay = Number(cajaDateKeyBA().slice(8, 10));
  const selectedKey = selectedMonthKey && monthKeys.includes(selectedMonthKey) ? selectedMonthKey : monthKeys[0];
  const analysisIdx = monthKeys.indexOf(selectedKey);
  const isCurrentMonth = analysisIdx === 0;
  const prevKey = shiftMonth(selectedKey, -1);
  // Mes en curso: se compara contra el MISMO período del mes anterior (del 1 al día de hoy);
  // 3 días contra un mes entero daría siempre "-98%". Un mes cerrado, contra el mes anterior
  // completo. (La del mes en curso también la usan los informes mensuales.)
  const compDay = comparableUptoDay(todayDay);
  const samePeriodQuery = useQuery({
    queryKey: ["monthly-performance", businessId, activeBranchId, monthKeys[1], compDay],
    queryFn: () => loadMonthlyPerformance(businessId!, activeBranchId, monthKeys[1], compDay ?? undefined),
    enabled: !!businessId && compDay != null,
    staleTime: 60_000,
  });
  // El mes en curso hasta ayer: contra esto se compara el mes anterior hasta el mismo día (días completos).
  const currentComparableQuery = useQuery({
    queryKey: ["monthly-performance", businessId, activeBranchId, monthKeys[0], compDay],
    queryFn: () => loadMonthlyPerformance(businessId!, activeBranchId, monthKeys[0], compDay ?? undefined),
    enabled: !!businessId && compDay != null && isCurrentMonth,
    staleTime: 60_000,
  });
  const prevFullQuery = useQuery({
    queryKey: ["monthly-performance", businessId, activeBranchId, prevKey, "mes-completo"],
    queryFn: () => loadMonthlyPerformance(businessId!, activeBranchId, prevKey),
    enabled: !!businessId && !isCurrentMonth,
    staleTime: 60_000,
  });
  const comparisonPerf = isCurrentMonth ? samePeriodQuery.data : prevFullQuery.data;
  const perfSignature = `${perfQueries.map((q) => `${q.status}:${q.dataUpdatedAt}`).join("|")}#${samePeriodQuery.dataUpdatedAt}#${currentComparableQuery.dataUpdatedAt}#${prevFullQuery.dataUpdatedAt}#${selectedKey}`;

  return React.useMemo(() => {
    const data = dataQuery.data;
    const clients = clientsQuery.data ?? [];
    const loading =
      dataQuery.isLoading ||
      clientsQuery.isLoading ||
      perfQueries.some((q) => q.isLoading) ||
      samePeriodQuery.isLoading ||
      currentComparableQuery.isLoading ||
      (!isCurrentMonth && prevFullQuery.isLoading);
    const perfByMonth = new Map<string, MonthlyPerformance>();
    perfQueries.forEach((q, i) => {
      if (q.data) perfByMonth.set(monthKeys[i], q.data);
    });

    if (!data) {
      return {
        loading,
        dataCounts: { payments: 0, appts: 0, clients: 0 },
        hasAnyData: false,
        current: null,
        previous: null,
        health: null,
        healthScore: null,
        recovery: { inactivo: 0, recuperable: 0, no_volvio: 0, archivado: 0, paraRecuperar: 0 },
        history: [],
        radiografia: [],
        radar: [],
        freeSlotsMonth: 0,
        potentialAt75: 0,
        slotsTo75: 0,
        productSharePct: null,
        productAttachPct: null,
        analysisMonthLabel: monthLabelOf(selectedKey),
        analysisNote: null,
        vsLabel: "vs mes anterior",
        mtd: null,
      };
    }

    const { payments, appts, expenses, employees, catalog, schedule } = data;
    const capacityData: CapacityData = { employees, catalog, ctx: parseCapacityContext(schedule) };

    const history = monthKeys.map((mk) =>
      buildMonthSnapshot(mk, payments, appts, expenses, capacityData, perfByMonth.get(mk)),
    );
    const analysisKey = selectedKey;
    const current = history[analysisIdx] ?? null;
    // Contra qué se compara: el mismo período del mes anterior (mes en curso) o el mes
    // anterior completo (mes cerrado).
    // Si el mes anterior fue el de arranque del negocio (empezó a usar la app pasado el día 5),
    // no se usa como base: no hay comparación en vez de una comparación engañosa.
    const comparisonSparse = Boolean(comparisonPerf && comparisonPerf.hasData && !comparisonPerf.representative);
    const previous = comparisonSparse
      ? null
      : buildMonthSnapshot(
          prevKey,
          payments,
          appts,
          expenses,
          capacityData,
          comparisonPerf,
          isCurrentMonth ? (compDay ?? undefined) : undefined,
        );
    const vsLabel = isCurrentMonth ? "vs el mismo período del mes anterior" : "vs mes anterior";
    const notes: string[] = [];
    if (isCurrentMonth && todayDay < MIN_DAYS_TO_JUDGE) {
      notes.push(`Mes en curso: lleva ${todayDay} ${todayDay === 1 ? "día" : "días"}, así que los indicadores todavía son provisorios.`);
    }
    const arranque = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "mitad de mes");
    if (current && current.hasData && current.partialStart) {
      notes.push(
        `Primer mes de uso: el negocio arrancó el ${arranque(current.startDate)}, así que ${monthLabelOf(analysisKey)} está incompleto.`,
      );
    }
    if (comparisonSparse && comparisonPerf) {
      notes.push(
        `No se compara con ${monthLabelOf(prevKey)} porque fue el mes de arranque (el negocio empezó el ${arranque(comparisonPerf.startDate)}) y está incompleto.`,
      );
    }
    const analysisNote = notes.length > 0 ? notes.join(" ") : null;
    const hasAnyData = history.some((h) => h.hasData);

    // ── Puntaje de salud (0-100): seis indicadores (ver src/lib/health-score.ts), todos con datos reales y contra
    // períodos equivalentes (días completos). Lo que no se puede medir queda como "datos insuficientes" y lo que
    // depende de datos por registrar (gastos fijos) como "provisional": nunca se estima ni se penaliza.
    const currentPerf = perfByMonth.get(analysisKey);
    const currentComparable = isCurrentMonth ? currentComparableQuery.data : currentPerf;
    const base = comparisonSparse || !comparisonPerf || !comparisonPerf.hasData ? null : comparisonPerf;
    const growthPct =
      currentComparable && base && base.facturacion > 0
        ? ((currentComparable.facturacion - base.facturacion) / base.facturacion) * 100
        : null;
    const ticketPct =
      currentComparable && base && base.ticket > 0 ? ((currentComparable.ticket - base.ticket) / base.ticket) * 100 : null;

    // Retención: clientes vistos hace 45 a 75 días que volvieron. Solo clientes reales (sin la ficha "Sin agendar").
    const validIds = new Set(clients.map((c) => c.id));
    const validNames = new Set(clients.map((c) => c.name.trim().toLowerCase()));
    const visitDays: VisitDay[] = [];
    for (const p of payments) {
      const nameKey = (p.client_name ?? "").trim().toLowerCase();
      const clientKey = p.client_id && validIds.has(p.client_id) ? p.client_id : validNames.has(nameKey) ? nameKey : null;
      if (!clientKey) continue;
      visitDays.push({ clientKey, dayKey: new Date(p.created_at).toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }) });
    }
    const [ay, am] = analysisKey.split("-").map(Number);
    const lastDayOfAnalysis = new Date(ay, am, 0).getDate();
    const cutDay = isCurrentMonth ? (compDay ?? 0) : lastDayOfAnalysis;
    const retCut = cutDay > 0 ? `${analysisKey}-${String(cutDay).padStart(2, "0")}` : `${shiftMonth(analysisKey, -1)}-28`;
    const retencion = computeRetention(visitDays, retCut);

    const healthScore: HealthScore | null =
      current && current.hasData && currentPerf
        ? computeHealthScore({
            facturacion: currentPerf.facturacion,
            margen: currentPerf.margen,
            gastosTotal: currentPerf.gastosTotal,
            gastosFijosCargados: currentPerf.gastosPorTipo.some((g) => g.tipo === "Fijo" && g.total > 0) ? 1 : 0,
            ocupacion: current.totalSlots > 0 ? current.occupancy : null,
            totalSlots: current.totalSlots,
            retencionGrupo: retencion.grupo,
            retencionVolvieron: retencion.volvieron,
            crecimientoPct: growthPct,
            ticketPct,
            turnosHechos: current.doneCount,
            turnosCancelados: current.cancellations,
            turnosNoAsistio: current.noShows,
          })
        : null;
    const health = healthScore?.total ?? null;

    // ── Radiografía del local ──────────────────────────────────────────────
    // Definición única (la del módulo Clientes): inactivos + perdidos recuperables + los que no volvieron. Quien ya
    // tiene un turno reservado figura como activo y no se cuenta.
    const recovery = countRecovery(clients);
    const inactiveClients = recovery.paraRecuperar;
    const vipCount = clients.filter((c) => c.vipTag === "vip").length;

    // Ocupación de cada profesional: servicios realmente vendidos ÷ SU capacidad (horario,
    // descanso y duración de sus servicios). Antes se contaban solo los turnos de la Agenda,
    // y los cobros sin turno no figuraban.
    const employeesRanked = (current?.employeeLoad ?? [])
      .filter((e) => e.capacity > 0 && e.used > 0)
      .map((e) => ({ name: e.name, count: e.used / e.capacity }))
      .sort((a, b) => b.count - a.count);
    const topEmployee = employeesRanked[0] ?? null;
    const bottomEmployee = employeesRanked.length > 1 ? employeesRanked[employeesRanked.length - 1] : null;

    const serviceUsage = new Map<string, { count: number; revenue: number }>();
    payments
      .filter((p) => monthKeyOf(p.created_at) === analysisKey)
      .forEach((p) => {
        // Por ítem de la venta (no por el texto del cobro, que mezcla combos como
        // "Corte + Barba" o "Corte / Cepita"): cuenta cada servicio una vez y su monto.
        const lines = Array.isArray(p.items) ? p.items.filter((it) => it && !it.is_catalog) : [];
        if (lines.length > 0) {
          for (const it of lines) {
            const name = String(it.name ?? "").trim() || "Servicio";
            const entry = serviceUsage.get(name) ?? { count: 0, revenue: 0 };
            entry.count += Number(it.qty ?? 1) > 0 ? Number(it.qty ?? 1) : 1;
            entry.revenue += Number(it.amount ?? 0);
            serviceUsage.set(name, entry);
          }
          return;
        }
        const name = (p.service_name ?? "").trim() || "Servicio";
        const entry = serviceUsage.get(name) ?? { count: 0, revenue: 0 };
        entry.count += 1;
        entry.revenue += Number(p.total ?? p.amount ?? 0);
        serviceUsage.set(name, entry);
      });
    const servicesSorted = Array.from(serviceUsage.entries());
    const topSoldService = servicesSorted.length > 0
      ? servicesSorted.sort((a, b) => b[1].count - a[1].count)[0]
      : null;
    const topProfitService = servicesSorted.length > 0
      ? servicesSorted.sort((a, b) => b[1].revenue - a[1].revenue)[0]
      : null;

    const products = catalog.filter((c) => c.duration_min == null);
    const productNames = new Set(products.map((p) => p.name.trim().toLowerCase()));
    // Venta de productos: % de la facturación del mes que vino de productos, y % de las ventas que llevan algún
    // producto. (Antes era "% de clientes que compraron", que se leía como porcentaje de la facturación.)
    let productSharePct: number | null = null;
    let productRevenue = 0;
    let productAttachPct: number | null = null;
    if (productNames.size > 0) {
      let prodRev = 0;
      let totRev = 0;
      let withProd = 0;
      let nPays = 0;
      for (const p of payments) {
        if (monthKeyOf(p.created_at) !== analysisKey) continue;
        nPays += 1;
        const total = Number(p.total ?? p.amount ?? 0);
        totRev += total;
        const items = Array.isArray(p.items) ? p.items : [];
        let prod = items.filter((it) => it?.is_catalog).reduce((sum, it) => sum + Number(it.amount ?? 0), 0);
        if (prod === 0 && productNames.has((p.service_name ?? "").trim().toLowerCase())) prod = total;
        if (prod > 0) withProd += 1;
        prodRev += prod;
      }
      productRevenue = prodRev;
      productSharePct = totRev > 0 ? Math.round((prodRev / totRev) * 1000) / 10 : null;
      productAttachPct = nPays > 0 ? Math.round((withProd / nPays) * 100) : null;
    }

    const freeSlotsMonth = current ? current.freeSlots : 0;
    // Turnos que faltan para llegar al 75% de ocupación × ticket promedio. Si ya se supera
    // el 75%, no hay "potencial" que mostrar.
    const slotsTo75 = current ? Math.max(0, Math.ceil(current.totalSlots * 0.75) - current.usedSlots) : 0;
    const potentialAt75 = current ? slotsTo75 * current.ticket : 0;

    // Día más tranquilo: entre los días de la semana que el local abre (según los horarios), el que menos factura
    // por jornada. Lo cobrado un día cerrado (una seña, una venta suelta) no cuenta ni hace que ese día califique.
    const openDatesByDow = current?.openDatesByDow ?? {};
    const ingresoPorDow = new Map<number, number>();
    for (const p of payments) {
      if (monthKeyOf(p.created_at) !== analysisKey) continue;
      const fecha = new Date(p.created_at).toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });
      const dow = new Date(`${fecha}T12:00:00`).getDay();
      ingresoPorDow.set(dow, (ingresoPorDow.get(dow) ?? 0) + Number(p.total ?? p.amount ?? 0));
    }
    const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    const diasPromedio = Object.entries(openDatesByDow)
      .filter(([, fechas]) => fechas > 0)
      .map(([dow, fechas]) => ({ dow: Number(dow), avg: (ingresoPorDow.get(Number(dow)) ?? 0) / fechas }));
    const diaTranquilo = diasPromedio.length >= 2 ? diasPromedio.reduce((m, v) => (v.avg < m.avg ? v : m)) : null;
    const diaRentable = diasPromedio.length >= 2 ? diasPromedio.reduce((m, v) => (v.avg > m.avg ? v : m)) : null;

    // Horario más y menos pedido: turnos atendidos por hora de inicio en el mes analizado.
    const turnosPorHora = new Map<number, number>();
    const gastoPorCliente = new Map<string, { name: string; total: number; visitas: number }>();
    const ingresoPorProfesional = new Map<string, number>();
    const idsClientes = new Set(clients.map((c) => c.id));
    for (const p of payments) {
      if (monthKeyOf(p.created_at) !== analysisKey) continue;
      const monto = Number(p.total ?? p.amount ?? 0);
      const nombre = (p.client_name ?? "").trim();
      const claveCliente = p.client_id ?? nombre.toLowerCase();
      // Ventas por orden de llegada (sin ficha ni nombre real, "sin turno"): no son un cliente.
      // La ficha genérica ("Sin agendar") no está entre los clientes: sus ventas tampoco cuentan como un cliente.
      const anonimo =
        nombre === "" ||
        nombre.toLowerCase() === "sin turno" ||
        (!!p.client_id && !idsClientes.has(p.client_id));
      if (claveCliente && !anonimo) {
        const e = gastoPorCliente.get(claveCliente) ?? { name: nombre || "Cliente", total: 0, visitas: 0 };
        e.total += monto;
        e.visitas += 1;
        gastoPorCliente.set(claveCliente, e);
      }
      if (p.employee_id) ingresoPorProfesional.set(p.employee_id, (ingresoPorProfesional.get(p.employee_id) ?? 0) + monto);
    }
    // Por hora de INICIO de los turnos atendidos del mes (no por la hora del cobro): un turno de las 11 que termina a las
    // 12:15 cuenta a las 11.
    for (const a of data.appts) {
      if (!DONE_STATUSES.includes(a.status) || monthKeyOf(a.starts_at) !== analysisKey) continue;
      const hora = Number(
        new Date(a.starts_at).toLocaleString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).slice(11, 13),
      );
      turnosPorHora.set(hora, (turnosPorHora.get(hora) ?? 0) + 1);
    }
    // Solo cuentan las horas en que el local atiende (según los horarios): un cobro cargado fuera de horario no
    // define ningún horario "pedido".
    const horasAbiertas = current?.openHours ?? [];
    let horaTop: { hora: number; n: number } | null = null;
    let horaBottom: { hora: number; n: number } | null = null;
    if (horasAbiertas.length >= 2) {
      for (const h of horasAbiertas) {
        const n = turnosPorHora.get(h) ?? 0;
        if (!horaTop || n > horaTop.n) horaTop = { hora: h, n };
        if (!horaBottom || n < horaBottom.n) horaBottom = { hora: h, n };
      }
    }
    const franja = (h: number) => `${h} a ${h + 1} h`;
    const clienteTop = [...gastoPorCliente.values()].sort((a, b) => b.total - a.total)[0] ?? null;
    const empleadoNombres = new Map(data.employees.map((e) => [e.id, e.full_name]));
    const profesionalTop =
      [...ingresoPorProfesional.entries()]
        .filter(([id]) => empleadoNombres.has(id))
        .sort((a, b) => b[1] - a[1])[0] ?? null;
    const nuevosCount = clients.filter((c) => c.grupo === "nuevo").length;
    const turnosCancelados = (current?.cancellations ?? 0) + (current?.noShows ?? 0);
    const turnosTotales = turnosCancelados + (current?.doneCount ?? 0);

    const radiografia: RadiografiaItem[] = [
      {
        key: "recuperar",
        label: "Clientes para recuperar",
        value: String(inactiveClients),
        tone: inactiveClients > 0 ? "warn" : "good",
      },
      {
        key: "turnos-vacios",
        label: "Turnos vacíos en los días trabajados",
        value: String(freeSlotsMonth),
        tone: freeSlotsMonth > 0 ? "warn" : "good",
      },
      {
        key: "prof-top",
        label: "Profesional con mayor ocupación",
        value: topEmployee ? topEmployee.name : "—",
        detail: topEmployee ? `${Math.round(topEmployee.count * 100)}% de ocupación` : undefined,
        tone: topEmployee ? "good" : "neutral",
      },
      {
        key: "prof-bottom",
        label: "Profesional con menor ocupación",
        value: bottomEmployee ? bottomEmployee.name : "—",
        detail: bottomEmployee ? `${Math.round(bottomEmployee.count * 100)}% de ocupación` : undefined,
        tone: bottomEmployee ? "warn" : "neutral",
      },
      {
        key: "servicio-top",
        label: "Servicio más vendido",
        value: topSoldService ? topSoldService[0] : "—",
        detail: topSoldService ? `${topSoldService[1].count} ventas` : undefined,
        tone: topSoldService ? "neutral" : "neutral",
      },
      {
        key: "servicio-rentable",
        label: "Servicio más rentable",
        value: topProfitService ? topProfitService[0] : "—",
        detail: topProfitService ? `${fmtMoney(topProfitService[1].revenue)} facturados` : undefined,
        tone: topProfitService ? "good" : "neutral",
      },
      {
        key: "dia-rentable",
        label: "Día más rentable",
        value: diaRentable ? DIAS_SEMANA[diaRentable.dow] : "—",
        detail: diaRentable ? `${fmtMoney(diaRentable.avg)} por día` : undefined,
        tone: diaRentable ? "good" : "neutral",
      },
      {
        key: "dia-tranquilo",
        label: "Día más tranquilo",
        value: diaTranquilo ? DIAS_SEMANA[diaTranquilo.dow] : "—",
        detail: diaTranquilo ? `${fmtMoney(diaTranquilo.avg)} por día` : undefined,
        tone: diaTranquilo ? "warn" : "neutral",
      },
      {
        key: "hora-top",
        label: "Horario más pedido",
        value: horaTop ? franja(horaTop.hora) : "—",
        detail: horaTop ? `${horaTop.n} turnos en el mes` : undefined,
        tone: horaTop ? "good" : "neutral",
      },
      {
        key: "hora-bottom",
        label: "Horario menos pedido",
        value: horaBottom ? franja(horaBottom.hora) : "—",
        detail: horaBottom ? `${horaBottom.n} turnos en el mes` : undefined,
        tone: horaBottom ? "warn" : "neutral",
      },
      {
        key: "prof-factura",
        label: "Profesional que más facturó",
        value: profesionalTop ? (empleadoNombres.get(profesionalTop[0]) ?? "—") : "—",
        detail: profesionalTop ? `${fmtMoney(profesionalTop[1])} en el mes` : undefined,
        tone: profesionalTop ? "good" : "neutral",
      },
      {
        key: "cliente-top",
        label: "Cliente que más gastó",
        value: clienteTop ? clienteTop.name : "—",
        detail: clienteTop ? `${fmtMoney(clienteTop.total)} · ${clienteTop.visitas} visita${clienteTop.visitas === 1 ? "" : "s"}` : undefined,
        tone: clienteTop ? "good" : "neutral",
      },
      {
        key: "clientes-nuevos",
        label: "Clientes nuevos (últimos 30 días)",
        value: String(nuevosCount),
        tone: nuevosCount > 0 ? "good" : "neutral",
      },
      {
        key: "cancelaciones",
        label: "Cancelaciones y no asistencias",
        value: String(turnosCancelados),
        detail: turnosTotales > 0 ? `${Math.round((turnosCancelados / turnosTotales) * 100)}% de los turnos` : undefined,
        tone: turnosCancelados === 0 ? "good" : turnosTotales > 0 && turnosCancelados / turnosTotales >= 0.15 ? "bad" : "warn",
      },
      {
        key: "productos",
        label: "Venta de productos",
        value: productSharePct != null ? fmtMoney(productRevenue) : "—",
        detail: productSharePct != null ? `${String(productSharePct).replace(".", ",")}% de la facturación` : undefined,
        tone: productSharePct == null ? "neutral" : productSharePct >= PRODUCT_TARGET_PCT ? "good" : "warn",
      },
      {
        key: "vip",
        label: "Clientes VIP",
        value: String(vipCount),
        tone: vipCount > 0 ? "good" : "neutral",
      },
    ];

    // ── Radar del local (bullets dinámicos) ────────────────────────────────
    const radar: RadarItem[] = [];
    // Contra el período equivalente (días completos), igual que el puntaje.
    const rentabilidadProvisional = healthScore?.indicators.find((x) => x.key === "rentabilidad")?.state === "provisional";
    if (base && currentComparable) {
      const profitPct = pctDelta(currentComparable.ganancia, base.ganancia);
      if (profitPct != null) {
        radar.push({
          key: "utilidad",
          tone: profitPct >= 0 ? "ok" : "bad",
          label: `Ganancia ${profitPct >= 0 ? "creciendo" : "cayendo"} (${profitPct >= 0 ? "+" : ""}${profitPct}% ${vsLabel})${rentabilidadProvisional ? " · provisional: faltan gastos del mes" : ""}`,
        });
      }
      const clientsPct = pctDelta(currentComparable.clientes, base.clientes);
      if (clientsPct != null) {
        radar.push({
          key: "clientes",
          tone: clientsPct >= 0 ? "ok" : "warn",
          label: `Clientes atendidos ${clientsPct >= 0 ? "creciendo" : "bajando"} (${clientsPct >= 0 ? "+" : ""}${clientsPct}% ${vsLabel})`,
        });
      }
    }
    if (inactiveClients > 0) {
      radar.push({
        key: "inactivos",
        tone: "alert",
        label: `${inactiveClients} clientes para recuperar`,
      });
    }
    return {
      loading,
      dataCounts: { payments: payments.length, appts: appts.length, clients: clients.length },
      hasAnyData,
      current,
      previous,
      health,
      healthScore,
      recovery,
      history,
      radiografia,
      radar,
      freeSlotsMonth,
      potentialAt75,
      slotsTo75,
      productSharePct,
      productAttachPct,
      analysisMonthLabel: monthLabelOf(analysisKey),
      analysisNote,
      vsLabel,
      mtd:
        history[0]?.hasData
          ? {
              monthKey: monthKeys[0],
              upToDay: compDay ?? 0,
              currentRevenue: currentComparableQuery.data ? currentComparableQuery.data.facturacion : null,
              previousRevenue:
                samePeriodQuery.data && samePeriodQuery.data.representative ? samePeriodQuery.data.facturacion : null,
            }
          : null,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataQuery.data, dataQuery.isLoading, clientsQuery.data, clientsQuery.isLoading, monthKeys, perfSignature]);
}
