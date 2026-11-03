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

const DONE_STATUSES = ["completed", "charged"];
const MONTHS_OF_HISTORY = 6;

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
  productSharePct: number | null;
};

type RawPayment = {
  id: string;
  total: number | null;
  amount: number | null;
  service_name: string | null;
  client_name: string | null;
  client_id: string | null;
  created_at: string;
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
type RawEmployee = { id: string; full_name: string };
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
}> {
  const sinceDate = `${shiftMonth(cajaDateKeyBA().slice(0, 7), -MONTHS_OF_HISTORY)}-01`;
  const sinceIso = new Date(`${sinceDate}T00:00:00-03:00`).toISOString();

  // Cobros: sin anulados/reembolsados (la caja tampoco los cuenta) y paginados — una
  // consulta sin .range() corta en silencio a las 1.000 filas.
  const paymentsPromise = fetchAllRows<RawPayment>(
    (from, to) =>
      supabase
        .from("payments")
        .select("id,total,amount,service_name,client_name,client_id,created_at")
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

  const [payRes, apptRes, expRes, empRes, catRes] = await Promise.all([
    paymentsPromise,
    apptsPromise,
    expensesPromise,
    supabase.from("employees").select("id,full_name").eq("business_id", businessId),
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
  };
}

function buildMonthSnapshot(
  monthKey: string,
  payments: RawPayment[],
  appts: RawAppt[],
  expenses: RawExpense[],
  employeeCount: number,
  perf: MonthlyPerformance | undefined,
): AdvisorMonthSnapshot {
  const monthPayments = payments.filter((p) => monthKeyOf(p.created_at) === monthKey);
  const monthAppts = appts.filter((a) => monthKeyOf(a.starts_at) === monthKey);
  const monthExpenses = expenses.filter((e) => e.date && e.date.slice(0, 7) === monthKey);

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
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const totalSlots = Math.max(employeeCount, 1) * daysInMonth * 8; // 8 turnos/día por profesional, mismo criterio que el Dashboard
  const occupancy = totalSlots > 0 ? Math.min(100, Math.round((usable / totalSlots) * 100)) : 0;

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

export function useAdvisorAnalytics(businessId: string | null | undefined): AdvisorAnalytics {
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
      queryKey: ["monthly-performance", businessId, activeBranchId, mk],
      queryFn: () => loadMonthlyPerformance(businessId!, activeBranchId, mk),
      enabled: !!businessId,
      staleTime: 60_000,
    })),
  });
  const perfSignature = perfQueries.map((q) => `${q.status}:${q.dataUpdatedAt}`).join("|");

  return React.useMemo(() => {
    const data = dataQuery.data;
    const clients = clientsQuery.data ?? [];
    const loading = dataQuery.isLoading || clientsQuery.isLoading || perfQueries.some((q) => q.isLoading);
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
        productSharePct: null,
      };
    }

    const { payments, appts, expenses, employees, catalog } = data;
    const now = new Date();

    const history = monthKeys.map((mk) =>
      buildMonthSnapshot(mk, payments, appts, expenses, employees.length, perfByMonth.get(mk)),
    );
    const current = history[0] ?? null;
    const previous = history[1] ?? null;
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
      health = Math.max(0, Math.min(100, occupancyScore + growthScore + cancelScore + ticketScore + 15));
    }

    // ── Radiografía del local ──────────────────────────────────────────────
    const inactiveClients = clients.filter(
      (c) => c.visits >= 1 && (c.lastVisitDays ?? 0) >= 45,
    ).length;
    const vipCount = clients.filter((c) => c.vipTag === "vip").length;

    const currentMonthAppts = appts.filter((a) => monthKeyOf(a.starts_at) === monthKeys[0]);
    const doneThisMonth = currentMonthAppts.filter((a) => DONE_STATUSES.includes(a.status));
    const byEmployee = new Map<string, number>();
    doneThisMonth.forEach((a) => {
      if (!a.employee_id) return;
      byEmployee.set(a.employee_id, (byEmployee.get(a.employee_id) ?? 0) + 1);
    });
    const employeesRanked = employees
      .map((e) => ({ name: e.full_name, count: byEmployee.get(e.id) ?? 0 }))
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count);
    const topEmployee = employeesRanked[0] ?? null;
    const bottomEmployee = employeesRanked.length > 1 ? employeesRanked[employeesRanked.length - 1] : null;

    const serviceUsage = new Map<string, { count: number; revenue: number }>();
    payments
      .filter((p) => monthKeyOf(p.created_at) === monthKeys[0])
      .forEach((p) => {
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
          .filter((p) => monthKeyOf(p.created_at) === monthKeys[0])
          .map((p) => p.client_id || p.client_name)
          .filter(Boolean),
      );
      const buyersThisMonth = new Set(
        payments
          .filter(
            (p) =>
              monthKeyOf(p.created_at) === monthKeys[0] &&
              productNames.has((p.service_name ?? "").trim().toLowerCase()),
          )
          .map((p) => p.client_id || p.client_name)
          .filter(Boolean),
      );
      productSharePct =
        payersThisMonth.size > 0 ? Math.round((buyersThisMonth.size / payersThisMonth.size) * 100) : 0;
    }

    const freeSlotsMonth = current
      ? Math.max(0, Math.max(employees.length, 1) * new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() * 8 - current.doneCount)
      : 0;

    const radiografia: RadiografiaItem[] = [
      {
        key: "recuperar",
        label: "Clientes para recuperar",
        value: String(inactiveClients),
        tone: inactiveClients > 0 ? "warn" : "good",
      },
      {
        key: "turnos-vacios",
        label: "Turnos vacíos este mes",
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
          label: `Utilidad ${profitPct >= 0 ? "creciendo" : "cayendo"} (${profitPct >= 0 ? "+" : ""}${profitPct}% vs mes anterior)`,
        });
      }
      const clientsPct = pctDelta(current.clientsServed, previous.clientsServed);
      if (clientsPct != null) {
        radar.push({
          key: "clientes",
          tone: clientsPct >= 0 ? "ok" : "warn",
          label: `Clientes atendidos ${clientsPct >= 0 ? "creciendo" : "bajando"} (${clientsPct >= 0 ? "+" : ""}${clientsPct}%)`,
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
        label: `${freeSlotsMonth} turnos disponibles sin ocupar este mes`,
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
      productSharePct,
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
