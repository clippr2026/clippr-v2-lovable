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
import { loadMonthlyPerformance, shiftMonth, type MonthlyPerformance } from "@/lib/monthly-performance";
import { fetchAllRows } from "@/lib/supabase-paginate";
import {
  computeCapacity,
  parseCapacityContext,
  slotMinutesForEmployee,
  type CapacityContext,
} from "@/lib/agenda-capacity";

const DONE_STATUSES = ["completed", "charged"];
const MONTHS_OF_HISTORY = 6;
// Cuántos meses se pueden elegir en el selector del Asesor (el actual + los 5 anteriores).
export const ADVISOR_MONTHS_SELECTABLE = MONTHS_OF_HISTORY;
const MIN_DAYS_TO_JUDGE = 7;

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
  employeeLoad: Array<{ name: string; used: number; capacity: number }>;
  hasData: boolean;
};

export type RadiografiaItem = {
  key: string;
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "neutral";
};

export type RadarItem = {
  key: string;
  tone: "ok" | "warn" | "alert" | "bad";
  label: string;
};

export type AdvisorAnalytics = {
  loading: boolean;
  hasAnyData: boolean;
  current: AdvisorMonthSnapshot | null;
  previous: AdvisorMonthSnapshot | null;
  health: number | null;
  history: AdvisorMonthSnapshot[];
  radiografia: RadiografiaItem[];
  radar: RadarItem[];
  freeSlotsMonth: number;
  // Lo que se facturaría de más si la ocupación llegara al 75% (turnos que faltan × ticket).
  potentialAt75: number;
  slotsTo75: number;
  productSharePct: number | null;
  // Mes que está analizando "Salud del negocio" y la Radiografía. Con menos de 7 días del
  // mes en curso es el último mes completo (3 días no alcanzan para juzgar la salud).
  analysisMonthLabel: string;
  analysisNote: string | null;
  // Texto de la comparación: "vs mes anterior" o "vs el mismo período del mes anterior".
  vsLabel: string;
  // Mes en curso (si está en curso): facturación del mismo período del mes anterior.
  mtd: { monthKey: string; previousRevenue: number | null; upToDay: number } | null;
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
};

type RawExpense = { amount: number | null; date: string | null };
type RawEmployee = { id: string; full_name: string; is_active?: boolean | null };
type RawCatalogItem = { id: string; name: string; price: number | null; duration_min: number | null };

// El mes de un movimiento se decide en hora de Argentina, nunca en la del dispositivo
// (un cobro de las 23:30 del último día del mes no puede caer en el mes siguiente).
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

async function loadAdvisorAnalytics(businessId: string): Promise<{
  payments: RawPayment[];
  appts: RawAppt[];
  expenses: RawExpense[];
  employees: RawEmployee[];
  catalog: RawCatalogItem[];
  schedule: unknown;
}> {
  const sinceDate = `${shiftMonth(cajaDateKeyBA().slice(0, 7), -MONTHS_OF_HISTORY)}-01`;
  const sinceIso = new Date(`${sinceDate}T00:00:00-03:00`).toISOString();

  // Cobros: sin anulados/reembolsados (la caja tampoco los cuenta) y paginados — una
  // consulta sin .range() corta en silencio a las 1.000 filas.
  const paymentsPromise = fetchAllRows<RawPayment>(
    (from, to) =>
      supabase
        .from("payments")
        .select("id,total,amount,service_name,client_name,client_id,created_at,items,employee_id")
        .eq("business_id", businessId)
        .gte("created_at", sinceIso)
        .not("status", "in", "(anulado,reembolsado)")
        .order("id", { ascending: true })
        .range(from, to) as any,
  ).then(
    (data) => ({ data, error: null as { message: string } | null }),
    (error: Error) => ({ data: [] as RawPayment[], error: { message: error.message } }),
  );
  const apptsPromise = (async () => {
    try {
      return {
        data: await fetchAllRows<RawAppt>(
          (from, to) =>
            supabase
              .from("appointments")
              .select("id,status,starts_at,service_name,service_price,employee_id,recurring_series_id")
              .eq("business_id", businessId)
              .gte("starts_at", sinceIso)
              .order("id", { ascending: true })
              .range(from, to) as any,
        ),
        error: null as { message: string } | null,
      };
    } catch (e) {
      // recurring_series_id puede no existir todavía (columna nueva) — reintenta sin ella.
      try {
        return {
          data: await fetchAllRows<RawAppt>(
            (from, to) =>
              supabase
                .from("appointments")
                .select("id,status,starts_at,service_name,service_price,employee_id")
                .eq("business_id", businessId)
                .gte("starts_at", sinceIso)
                .order("id", { ascending: true })
                .range(from, to) as any,
          ),
          error: null as { message: string } | null,
        };
      } catch (e2) {
        return { data: [] as RawAppt[], error: { message: (e2 as Error).message } };
      }
    }
  })();
  const expensesPromise = fetchAllRows<RawExpense & { id: string }>(
    (from, to) =>
      supabase
        .from("expenses")
        .select("id,amount,date")
        .eq("business_id", businessId)
        .gte("date", sinceDate)
        .order("id", { ascending: true })
        .range(from, to) as any,
  ).then(
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
    supabase.from("employees").select("id,full_name,is_active").eq("business_id", businessId),
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
  const doneCount = monthAppts.filter((a) => DONE_STATUSES.includes(a.status)).length;
  // Ocupación: no cuenta turnos generados por una recurrencia ("Repetir
  // turno") que todavía no ocurrieron ni se cobraron — son compromisos
  // futuros, no ocupación real de la agenda actual. Un turno de la misma
  // serie que ya pasó/se cobró sí cuenta, igual que cualquier otro.
  const now = Date.now();
  const usable = monthAppts.filter((a) => {
    if (["cancelled", "blocked"].includes(a.status)) return false;
    const isFutureRecurring = Boolean(a.recurring_series_id) && new Date(a.starts_at).getTime() > now && !DONE_STATUSES.includes(a.status);
    return !isFutureRecurring;
  }).length;
  // Capacidad REAL: para cada profesional activo, los turnos que entran en SU horario
  // (días que trabaja, entrada, salida y descanso) según cuánto dura lo que atiende —
  // 11 a 20 con 1 h de descanso y turnos de 1 h son 8; sin descanso, 9; con servicios de
  // 40 min, más. Solo hasta el día de corte (el mes en curso no cuenta días que no llegaron).
  // Lo usado son los servicios realmente vendidos en el período (los cobros sin turno
  // también ocupan agenda), o los turnos si fuera mayor.
  const activeEmployees = capacityData.employees.filter((e) => e.is_active !== false);
  const soldByEmployee = new Map<string, Array<{ name: string; qty: number }>>();
  const usedByEmployee = new Map<string, number>();
  let servicesSold = 0;
  for (const p of monthPayments) {
    const lines = Array.isArray(p.items) ? p.items.filter((it) => it && !it.is_catalog) : [];
    const entries = lines.length > 0
      ? lines.map((it) => ({ name: String(it.name ?? "").trim(), qty: Number(it.qty ?? 1) > 0 ? Number(it.qty ?? 1) : 1 }))
      : [{ name: (p.service_name ?? "").trim(), qty: 1 }];
    const qtyTotal = entries.reduce((s, e) => s + e.qty, 0);
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
  const { totalSlots } = computeCapacity({
    ctx: capacityData.ctx,
    employeeIds: activeEmployees.map((e) => e.id),
    monthKey,
    cutoffDay,
    slotMinutesByEmployee,
  });
  const employeeLoad = activeEmployees.map((e) => ({
    name: e.full_name,
    used: usedByEmployee.get(e.id) ?? 0,
    capacity: computeCapacity({
      ctx: capacityData.ctx,
      employeeIds: [e.id],
      monthKey,
      cutoffDay,
      slotMinutesByEmployee,
    }).totalSlots,
  }));
  const used = Math.max(usable, servicesSold);
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
    doneCount,
    freeSlots,
    representative: perf ? perf.representative : true,
    partialStart: perf ? perf.partialStart : false,
    startDate: perf ? perf.startDate : null,
    totalSlots,
    usedSlots: used,
    employeeLoad,
    hasData: monthPayments.length > 0 || monthAppts.length > 0,
  };
}

function useAdvisorAnalyticsQuery(businessId: string | null | undefined) {
  return useQuery({
    queryKey: ["advisor-analytics", businessId],
    queryFn: () => loadAdvisorAnalytics(businessId!),
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
  const clientsQuery = useClientsData(businessId ?? null);
  const dataQuery = useAdvisorAnalyticsQuery(businessId);

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
  const samePeriodQuery = useQuery({
    queryKey: ["monthly-performance", businessId, activeBranchId, monthKeys[1], todayDay],
    queryFn: () => loadMonthlyPerformance(businessId!, activeBranchId, monthKeys[1], todayDay),
    enabled: !!businessId,
    staleTime: 60_000,
  });
  const prevFullQuery = useQuery({
    queryKey: ["monthly-performance", businessId, activeBranchId, prevKey, "mes-completo"],
    queryFn: () => loadMonthlyPerformance(businessId!, activeBranchId, prevKey),
    enabled: !!businessId && !isCurrentMonth,
    staleTime: 60_000,
  });
  const comparisonPerf = isCurrentMonth ? samePeriodQuery.data : prevFullQuery.data;
  const perfSignature = `${perfQueries.map((q) => `${q.status}:${q.dataUpdatedAt}`).join("|")}#${samePeriodQuery.dataUpdatedAt}#${prevFullQuery.dataUpdatedAt}#${selectedKey}`;

  return React.useMemo(() => {
    const data = dataQuery.data;
    const clients = clientsQuery.data ?? [];
    const loading =
      dataQuery.isLoading ||
      clientsQuery.isLoading ||
      perfQueries.some((q) => q.isLoading) ||
      samePeriodQuery.isLoading ||
      (!isCurrentMonth && prevFullQuery.isLoading);
    const perfByMonth = new Map<string, MonthlyPerformance>();
    perfQueries.forEach((q, i) => {
      if (q.data) perfByMonth.set(monthKeys[i], q.data);
    });

    if (!data) {
      return {
        loading,
        hasAnyData: false,
        current: null,
        previous: null,
        health: null,
        history: [],
        radiografia: [],
        radar: [],
        freeSlotsMonth: 0,
        potentialAt75: 0,
        slotsTo75: 0,
        productSharePct: null,
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
          isCurrentMonth ? todayDay : undefined,
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

    // ── Puntaje de salud (0-100): ocupación + crecimiento + cancelaciones +
    // ticket + venta de productos. Todo derivado de datos reales del mes
    // actual vs el anterior. Si no hay datos suficientes, health queda null.
    let health: number | null = null;
    if (current && current.hasData) {
      const occupancyScore = Math.round(clampPct(current.occupancy) * 0.25);
      const growthPct = previous?.hasData ? (pctDelta(current.revenue, previous.revenue) ?? 0) : 0;
      const growthScore = Math.round(saturate01(Math.max(0, growthPct), 25) * 25);
      const cancelRate =
        current.doneCount + current.cancellations > 0
          ? current.cancellations / (current.doneCount + current.cancellations)
          : 0;
      const cancelScore = Math.round((1 - clampPct(cancelRate * 100) / 100) * 20);
      const ticketPct = previous?.hasData ? (pctDelta(current.ticket, previous.ticket) ?? 0) : 0;
      const ticketScore = Math.round(saturate01(Math.max(0, ticketPct), 20) * 15);
      // Sin mes comparable (p. ej. el primero tras el mes de arranque) crecimiento y ticket no se
      // pueden medir: el puntaje se calcula con lo que sí se mide (ocupación, cancelaciones y la
      // base fija = 60 puntos) y se lleva a escala de 100, para no topar esos meses en 60.
      const hasComparison = Boolean(previous?.hasData);
      health = hasComparison
        ? Math.max(0, Math.min(100, occupancyScore + growthScore + cancelScore + ticketScore + 15))
        : Math.max(0, Math.min(100, Math.round(((occupancyScore + cancelScore + 15) / 60) * 100)));
    }

    // ── Radiografía del local ──────────────────────────────────────────────
    const inactiveClients = clients.filter(
      (c) => c.visits >= 1 && (c.lastVisitDays ?? 0) >= 45,
    ).length;
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
    let productSharePct: number | null = null;
    if (productNames.size > 0) {
      const payersThisMonth = new Set(
        payments
          .filter((p) => monthKeyOf(p.created_at) === analysisKey)
          .map((p) => p.client_id || p.client_name)
          .filter(Boolean),
      );
      const buyersThisMonth = new Set(
        payments
          .filter(
            (p) =>
              monthKeyOf(p.created_at) === analysisKey &&
              (productNames.has((p.service_name ?? "").trim().toLowerCase()) ||
                (Array.isArray(p.items) && p.items.some((it) => it?.is_catalog))),
          )
          .map((p) => p.client_id || p.client_name)
          .filter(Boolean),
      );
      productSharePct =
        payersThisMonth.size > 0 ? Math.round((buyersThisMonth.size / payersThisMonth.size) * 100) : 0;
    }

    const freeSlotsMonth = current ? current.freeSlots : 0;
    // Turnos que faltan para llegar al 75% de ocupación × ticket promedio. Si ya se supera
    // el 75%, no hay "potencial" que mostrar.
    const slotsTo75 = current ? Math.max(0, Math.ceil(current.totalSlots * 0.75) - current.usedSlots) : 0;
    const potentialAt75 = current ? slotsTo75 * current.ticket : 0;

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
        tone: topEmployee ? "good" : "neutral",
      },
      {
        key: "prof-bottom",
        label: "Profesional con menor ocupación",
        value: bottomEmployee ? bottomEmployee.name : "—",
        tone: bottomEmployee ? "warn" : "neutral",
      },
      {
        key: "servicio-top",
        label: "Servicio más vendido",
        value: topSoldService ? topSoldService[0] : "—",
        tone: topSoldService ? "neutral" : "neutral",
      },
      {
        key: "servicio-rentable",
        label: "Servicio más rentable",
        value: topProfitService ? topProfitService[0] : "—",
        tone: topProfitService ? "good" : "neutral",
      },
      {
        key: "productos",
        label: "Venta de productos",
        value: productSharePct != null ? `${productSharePct}%` : "—",
        tone: productSharePct == null ? "neutral" : productSharePct >= 15 ? "good" : "bad",
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
    if (previous?.hasData && current) {
      const profitPct = pctDelta(current.profit, previous.profit);
      if (profitPct != null) {
        radar.push({
          key: "utilidad",
          tone: profitPct >= 0 ? "ok" : "bad",
          label: `Utilidad ${profitPct >= 0 ? "creciendo" : "cayendo"} (${profitPct >= 0 ? "+" : ""}${profitPct}% ${vsLabel})`,
        });
      }
      const clientsPct = pctDelta(current.clientsServed, previous.clientsServed);
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
    if (productSharePct != null && productSharePct < 15) {
      radar.push({ key: "productos", tone: "bad", label: `Venta de productos baja (${productSharePct}%)` });
    }
    if (freeSlotsMonth > 0 && current) {
      radar.push({
        key: "turnos",
        tone: "warn",
        label: `${freeSlotsMonth} turnos sin ocupar en los días trabajados`,
      });
    }

    return {
      loading,
      hasAnyData,
      current,
      previous,
      health,
      history,
      radiografia,
      radar,
      freeSlotsMonth,
      potentialAt75,
      slotsTo75,
      productSharePct,
      analysisMonthLabel: monthLabelOf(analysisKey),
      analysisNote,
      vsLabel,
      mtd:
        history[0]?.hasData
          ? {
              monthKey: monthKeys[0],
              upToDay: todayDay,
              previousRevenue:
                samePeriodQuery.data && samePeriodQuery.data.representative ? samePeriodQuery.data.facturacion : null,
            }
          : null,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataQuery.data, dataQuery.isLoading, clientsQuery.data, clientsQuery.isLoading, monthKeys, perfSignature]);
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

// Curva de retornos decrecientes: sube rápido al principio y se satura,
// para que un +200% puntual no rompa la escala del puntaje.
function saturate01(value: number, half: number): number {
  if (value <= 0) return 0;
  return value / (value + half);
}
