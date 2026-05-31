import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Portado de loadDashboard() de app.js (líneas 5989-6219).
 * Mismas queries, mismos filtros, mismos cálculos.
 */

export type RecentPayment = {
  id: string;
  total: number;
  created_at: string;
  client_name?: string;
  service_name?: string;
};

export type RecentCancellation = {
  id: string;
  client_name?: string | null;
  service_name?: string | null;
  starts_at: string;
  cancelled_at?: string | null;
  cancelled_by_name?: string | null;
};

export type DashboardData = {
  revHoy: number;
  revAyer: number;
  cobros: number;
  completedCount: number;
  compAyer: number;
  ticket: number;
  ticketAyer: number;
  occ: number;
  usedSlots: number;
  totalSlots: number;
  totalGastos: number;
  gastosCount: number;
  utilidad: number;
  clientsCount: number;
  days7: string[];
  revByDay: number[];
  doneByDay: number[];
  tickByDay: number[];
  occByDay: number[];
  topServices: Array<{ name: string; rev: number; count: number; pct: number }>;
  totSvc: number;
  hoursLabels: string[];
  hoursValues: number[];
  recentPayments: RecentPayment[];
  recentCancellations: RecentCancellation[];
};

const localDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString("sv-SE");
  } catch {
    return iso?.slice(0, 10) || "";
  }
};

async function loadDashboard(
  businessId: string,
  range: { from: Date; to: Date },
): Promise<DashboardData> {
  const today = new Date(range.from);
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(range.to);
  todayEnd.setHours(23, 59, 59, 999);
  // Período "anterior" del mismo tamaño para calcular deltas
  const spanMs = todayEnd.getTime() - today.getTime();
  const yesterday = new Date(today.getTime() - spanMs - 1);
  const yesterdayEnd = new Date(today.getTime() - 1);
  const expenseFrom = today.toISOString().slice(0, 10);
  const expenseTo = todayEnd.toISOString().slice(0, 10);

  const [apptRes, payRes, payYestRes, empRes, sessRes, expRes] = await Promise.allSettled([
    supabase
      .from("appointments")
      .select(
        "id,client_name,client_id,service_name,service_price,starts_at,status,employee_id,cancelled_by,cancelled_by_name,cancelled_by_role,cancelled_at,created_by_name,created_by_role,updated_at",
      )
      .eq("business_id", businessId)
      .gte("starts_at", today.toISOString())
      .lte("starts_at", todayEnd.toISOString())
      .order("starts_at"),
    supabase
      .from("payments")
      .select("id,total,method,created_at,appointment_id,client_name,service_name")
      .gte("created_at", today.toISOString())
      .lte("created_at", todayEnd.toISOString())
      .order("created_at", { ascending: false }),
    supabase
      .from("payments")
      .select("id,total,created_at,appointment_id")
      .gte("created_at", yesterday.toISOString())
      .lte("created_at", yesterdayEnd.toISOString()),
    supabase.from("employees").select("*").eq("business_id", businessId).order("sort_order"),
    supabase
      .from("cash_sessions")
      .select("id")
      .eq("business_id", businessId)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("expenses")
      .select("id,amount,category,payment_method")
      .eq("business_id", businessId)
      .gte("date", expenseFrom)
      .lte("date", expenseTo),
  ]);

  type Appt = {
    id: string;
    status: string;
    starts_at: string;
    service_name?: string;
    client_name?: string;
    cancelled_at?: string | null;
    cancelled_by_name?: string | null;
  };
  type Pay = { id: string; total: number; created_at: string; appointment_id?: string; service_name?: string; client_name?: string };
  type Emp = { id: string };
  type Exp = { amount: number };

  const todayAppts =
    apptRes.status === "fulfilled" ? ((apptRes.value.data as Appt[]) ?? []) : [];
  let payments = payRes.status === "fulfilled" ? ((payRes.value.data as Pay[]) ?? []) : [];
  const paymentsYest =
    payYestRes.status === "fulfilled" ? ((payYestRes.value.data as Pay[]) ?? []) : [];
  const employees = empRes.status === "fulfilled" ? ((empRes.value.data as Emp[]) ?? []) : [];
  const session = sessRes.status === "fulfilled" ? (sessRes.value.data as { id: string } | null) : null;
  const gastosHoy = expRes.status === "fulfilled" ? ((expRes.value.data as Exp[]) ?? []) : [];

  // Si hay caja abierta, filtrar payments por session_id (igual que app.js)
  if (session && payments.length > 0) {
    const { data: sp } = await supabase
      .from("payments")
      .select("id,total,method,created_at,appointment_id,client_name,service_name")
      .eq("session_id", session.id)
      .order("created_at", { ascending: false });
    if (sp?.length) payments = sp as Pay[];
  }

  const totalGastos = gastosHoy.reduce((s, g) => s + Number(g.amount || 0), 0);
  const revHoy = payments.reduce((s, p) => s + Number(p.total || 0), 0);
  const revAyer = paymentsYest.reduce((s, p) => s + Number(p.total || 0), 0);
  const cobros = payments.length;
  const completed = todayAppts.filter((a) => ["completed", "charged"].includes(a.status));
  const compAyer = paymentsYest.length;
  const totalReal = todayAppts.filter((a) => !["cancelled", "blocked"].includes(a.status));
  const ticket = cobros > 0 ? Math.round(revHoy / cobros) : 0;
  const ticketAyer = compAyer > 0 ? Math.round(revAyer / compAyer) : 0;
  const totalSlots = Math.max(employees.length, 1) * 24;
  const usedSlots = totalReal.length;
  const occ = Math.round((usedSlots / totalSlots) * 100);
  const utilidad = revHoy - totalGastos;

  // Serie 7 días para sparklines
  const w7start = new Date(today);
  w7start.setDate(today.getDate() - 6);
  const [w7payR, w7apptR] = await Promise.all([
    supabase
      .from("payments")
      .select("total,created_at")
      .gte("created_at", w7start.toISOString())
      .lte("created_at", todayEnd.toISOString()),
    supabase
      .from("appointments")
      .select("status,starts_at")
      .eq("business_id", businessId)
      .gte("starts_at", w7start.toISOString())
      .lte("starts_at", todayEnd.toISOString()),
  ]);
  const w7pay = (w7payR.data as Pay[]) || [];
  const w7appt = (w7apptR.data as Appt[]) || [];
  const days7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(w7start);
    d.setDate(w7start.getDate() + i);
    return d.toLocaleDateString("sv-SE");
  });
  const revByDay = days7.map((ds) =>
    w7pay.filter((p) => localDate(p.created_at) === ds).reduce((s, p) => s + Number(p.total || 0), 0),
  );
  const doneByDay = days7.map(
    (ds) =>
      w7appt.filter(
        (a) => ["completed", "charged"].includes(a.status) && localDate(a.starts_at) === ds,
      ).length,
  );
  const tickByDay = days7.map((_, i) => {
    const r = revByDay[i];
    const d = doneByDay[i];
    return d > 0 ? Math.round(r / d) : 0;
  });
  const occByDay = days7.map((ds) => {
    const u = w7appt.filter(
      (a) => !["cancelled", "blocked"].includes(a.status) && localDate(a.starts_at) === ds,
    ).length;
    return Math.round((u / totalSlots) * 100);
  });

  // Hora-por-hora del día actual
  const hoursLabels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0") + ":00");
  const hoursValues = Array.from({ length: 24 }, (_, h) =>
    payments
      .filter((p) => new Date(p.created_at).getHours() === h)
      .reduce((s, p) => s + Number(p.total || 0), 0),
  );

  // Top servicios
  const svcMap: Record<string, { count: number; rev: number }> = {};
  payments.forEach((p) => {
    const appt = todayAppts.find((a) => a.id === p.appointment_id);
    const n = appt?.service_name || p.service_name || "Otros";
    if (!svcMap[n]) svcMap[n] = { count: 0, rev: 0 };
    svcMap[n].count++;
    svcMap[n].rev += Number(p.total || 0);
  });
  const svcs = Object.entries(svcMap).sort((a, b) => b[1].rev - a[1].rev).slice(0, 6);
  const totSvc = svcs.reduce((s, [, v]) => s + v.rev, 0);
  const topServices = svcs.map(([name, d]) => ({
    name,
    rev: d.rev,
    count: d.count,
    pct: totSvc > 0 ? Math.round((d.rev / totSvc) * 100) : 0,
  }));

  return {
    revHoy,
    revAyer,
    cobros,
    completedCount: completed.length,
    compAyer,
    ticket,
    ticketAyer,
    occ,
    usedSlots,
    totalSlots,
    totalGastos,
    gastosCount: gastosHoy.length,
    utilidad,
    clientsCount: new Set(
      payments.map((p) => (p.client_name ?? "").trim().toLowerCase()).filter(Boolean),
    ).size,
    days7,
    revByDay,
    doneByDay,
    tickByDay,
    occByDay,
    topServices,
    totSvc,
    hoursLabels,
    hoursValues,
    recentPayments: payments.slice(0, 6).map((p) => ({
      id: p.id,
      total: Number(p.total || 0),
      created_at: p.created_at,
      client_name: p.client_name,
      service_name: p.service_name,
    })),
    recentCancellations: todayAppts
      .filter((a) => a.status === "cancelled")
      .sort((a, b) =>
        (b.cancelled_at || b.starts_at).localeCompare(a.cancelled_at || a.starts_at),
      )
      .slice(0, 6)
      .map((a) => ({
        id: a.id,
        client_name: a.client_name,
        service_name: a.service_name,
        starts_at: a.starts_at,
        cancelled_at: a.cancelled_at,
        cancelled_by_name: a.cancelled_by_name,
      })),
  };
}

export function useDashboardData(
  businessId: string | null,
  range?: { from: Date; to: Date },
) {
  const from = range?.from ?? (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
  const to = range?.to ?? (() => { const d = new Date(); d.setHours(23,59,59,999); return d; })();
  const key = `${from.toISOString().slice(0,10)}_${to.toISOString().slice(0,10)}`;
  return useQuery({
    queryKey: ["dashboard", businessId, key],
    queryFn: () => loadDashboard(businessId!, { from, to }),
    enabled: !!businessId,
    staleTime: 30_000,
  });
}

export const pctDelta = (now: number, prev: number) =>
  prev ? Math.round(((now - prev) / prev) * 100) : null;

export const fmtAR = (n: number) => "$" + Math.round(n).toLocaleString("es-AR");
