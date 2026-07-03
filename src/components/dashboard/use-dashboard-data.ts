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
  service_price?: number | null;
  id: string;
  client_name?: string | null;
  service_name?: string | null;
  starts_at: string;
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
  gastosByDay: number[];
  doneByDay: number[];
  tickByDay: number[];
  occByDay: number[];
  topServices: Array<{ name: string; rev: number; count: number; pct: number }>;
  topCatalog: Array<{ name: string; rev: number; count: number; pct: number }>;
  totSvc: number;
  hoursLabels: string[];
  hoursValues: number[];
  hoursGastosValues: number[];
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

  const [apptRes, payRes, payYestRes, empRes, sessRes, expRes, catalogRes] = await Promise.allSettled([
    supabase
      .from("appointments")
      .select(
        "id,client_name,client_id,service_name,service_price,starts_at,status,employee_id,created_by_name,created_by_role,updated_at",
      )
      .eq("business_id", businessId)
      .gte("starts_at", today.toISOString())
      .lte("starts_at", todayEnd.toISOString())
      .order("starts_at", { ascending: true }),
    supabase
      .from("payments")
      .select("id,total,method,created_at,appointment_id,client_name,service_name,items")
      .eq("business_id", businessId)
      .gte("created_at", today.toISOString())
      .lte("created_at", todayEnd.toISOString())
      .order("created_at", { ascending: false }),
    supabase
      .from("payments")
      .select("id,total,created_at,appointment_id")
      .eq("business_id", businessId)
      .gte("created_at", yesterday.toISOString())
      .lte("created_at", yesterdayEnd.toISOString()),
    supabase.from("employees").select("*").eq("business_id", businessId).order("full_name", { ascending: true }),
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
      .select("id,amount,category,payment_method,date,created_at")
      .eq("business_id", businessId)
      .gte("date", expenseFrom)
      .lte("date", expenseTo),
    supabase
      .from("price_catalog")
      .select("name,duration_min,active")
      .eq("business_id", businessId)
      .eq("active", true),
  ]);

  type Appt = {
    id: string;
    status: string;
    starts_at: string;
    service_name?: string;
    client_name?: string;
    service_price?: number | null;
      };
  type Pay = { id: string; total: number; created_at: string; appointment_id?: string; service_name?: string; client_name?: string; items?: unknown };
  type Emp = { id: string };
  type Exp = { amount: number; date?: string | null; created_at?: string | null };
  type CatalogRow = { name: string | null; duration_min: number | null; active?: boolean | null };

  // Log any query errors to console for debugging
  [apptRes, payRes, payYestRes, empRes, sessRes, expRes].forEach((r, i) => {
    const names = ["appointments","payments","payments(ayer)","employees","cash_sessions","expenses","price_catalog"];
    if (r.status === "fulfilled" && r.value.error) {
      console.error(`[Dashboard] ${names[i]} error:`, r.value.error.message, r.value.error);
    }
  });

  const todayAppts =
    apptRes.status === "fulfilled" ? ((apptRes.value.data as Appt[]) ?? []) : [];
  let payments = payRes.status === "fulfilled" ? ((payRes.value.data as Pay[]) ?? []) : [];
  const paymentsYest =
    payYestRes.status === "fulfilled" ? ((payYestRes.value.data as Pay[]) ?? []) : [];
  const employees = empRes.status === "fulfilled" ? ((empRes.value.data as Emp[]) ?? []) : [];
  const session = sessRes.status === "fulfilled" ? (sessRes.value.data as { id: string } | null) : null;
  const gastosHoy = expRes.status === "fulfilled" ? ((expRes.value.data as Exp[]) ?? []) : [];
  const catalogRows = catalogRes.status === "fulfilled" ? ((catalogRes.value.data as CatalogRow[]) ?? []) : [];

  // Si hay caja abierta, mantener SIEMPRE el rango seleccionado.
  // Antes esta query reemplazaba `payments` por todos los pagos de la sesión abierta,
  // sin filtrar por fecha, y el Dashboard mostraba acumulado histórico.
  // Dashboard = rango del calendario, no total de caja/sesión.
  if (session && payments.length > 0) {
    const { data: sp, error: spError } = await supabase
      .from("payments")
      .select("id,total,method,created_at,appointment_id,client_name,service_name,items")
      .eq("business_id", businessId)
      .eq("session_id", session.id)
      .gte("created_at", today.toISOString())
      .lte("created_at", todayEnd.toISOString())
      .order("created_at", { ascending: false });

    if (spError) {
      console.error("[Dashboard] session payments error:", spError.message, spError);
    } else {
      payments = (sp as Pay[]) ?? [];
    }
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
      .eq("business_id", businessId)
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
  // Build day array from ACTUAL selected range (not hardcoded 7 days)
  // Build exact day list from range.from to range.to inclusive, no extra day
  const spanDays = Math.min(
    Math.floor((todayEnd.getTime() - today.getTime()) / 86_400_000) + 1,
    90
  );
  const days7 = Array.from({ length: Math.max(spanDays, 1) }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
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

  const todayKey = today.toLocaleDateString("sv-SE");
  const fallbackExpenseHour = new Date().getHours();
  const hoursGastosValues = Array.from({ length: 24 }, (_, h) =>
    gastosHoy
      .filter((g) => {
        if (g.created_at) {
          const created = new Date(g.created_at);
          return created.getHours() === h && localDate(g.created_at) === todayKey;
        }
        return (g.date === todayKey) && h === fallbackExpenseHour;
      })
      .reduce((s, g) => s + Number(g.amount || 0), 0),
  );

  // Desglose real por origen:
  // - Servicios = ítems creados en Configuración → Servicios (price_catalog.duration_min != null)
  // - Catálogo = ítems creados en Configuración → Catálogo (price_catalog.duration_min == null)
  // - Todos = ambos grupos combinados
  const normalizeName = (value?: string | null) => (value ?? "").trim().toLowerCase();

  const serviceCatalog = catalogRows
    .filter((row) => row.name && row.duration_min !== null && row.duration_min !== undefined)
    .map((row) => ({
      key: normalizeName(row.name),
      displayName: String(row.name).trim(),
      kind: "service" as const,
    }))
    .filter((row) => row.key.length > 0);

  const productCatalog = catalogRows
    .filter((row) => row.name && (row.duration_min === null || row.duration_min === undefined))
    .map((row) => ({
      key: normalizeName(row.name),
      displayName: String(row.name).trim(),
      kind: "catalog" as const,
    }))
    .filter((row) => row.key.length > 0);

  const knownItems = [...serviceCatalog, ...productCatalog].sort(
    (a, b) => b.key.length - a.key.length,
  );

  const serviceMap: Record<string, { name: string; count: number; rev: number }> = {};
  const catalogMap: Record<string, { name: string; count: number; rev: number }> = {};

  const addBreakdownItem = (
    kind: "service" | "catalog",
    displayName: string,
    amount: number,
    countShare = 1,
  ) => {
    if (!displayName || amount <= 0) return;
    const key = normalizeName(displayName);
    const target = kind === "service" ? serviceMap : catalogMap;
    if (!target[key]) target[key] = { name: displayName, count: 0, rev: 0 };
    target[key].count += countShare;
    target[key].rev += amount;
  };

  const matchKnownItems = (raw: string) => {
    const normalized = normalizeName(raw);
    if (!normalized) return [];
    const matches: typeof knownItems = [];
    let remaining = ` ${normalized} `;
    for (const item of knownItems) {
      const needle = item.key;
      if (!needle) continue;
      if (remaining.includes(needle)) {
        matches.push(item);
        remaining = remaining.split(needle).join(" ");
      }
    }
    return matches;
  };

  const lineAmount = (line: Record<string, unknown>, fallback: number) => {
    const qty = Number(line.qty ?? line.quantity ?? 1);
    const direct = Number(line.total ?? line.amount ?? line.subtotal);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const price = Number(line.price ?? line.unit_price);
    if (Number.isFinite(price) && price > 0) return price * (Number.isFinite(qty) && qty > 0 ? qty : 1);
    return fallback;
  };

  payments.forEach((payment) => {
    const appt = todayAppts.find((a) => a.id === payment.appointment_id);
    const paymentTotal = Number(payment.total || 0);
    if (paymentTotal <= 0) return;

    // Preferir items jsonb si existe, porque ahí están las líneas reales de venta.
    if (Array.isArray(payment.items) && payment.items.length > 0) {
      for (const rawLine of payment.items as Record<string, unknown>[]) {
        const lineName = String(
          rawLine.name ?? rawLine.service_name ?? rawLine.product_name ?? rawLine.title ?? "",
        ).trim();
        const matches = matchKnownItems(lineName);
        if (matches.length === 0) continue;

        const amount = lineAmount(rawLine, paymentTotal / Math.max(1, payment.items.length));
        const share = amount / matches.length;
        for (const match of matches) addBreakdownItem(match.kind, match.displayName, share);
      }
      return;
    }

    // Fallback: service_name del turno/pago. Si viene mezclado Servicio + Catálogo,
    // separa por nombres reales configurados. Si hay service_price del turno,
    // asigna ese importe al servicio y el resto al catálogo.
    const rawName = appt?.service_name || payment.service_name || "";
    const matches = matchKnownItems(rawName);
    if (matches.length === 0) return;

    const serviceMatches = matches.filter((match) => match.kind === "service");
    const catalogMatches = matches.filter((match) => match.kind === "catalog");
    const apptServicePrice = Number(appt?.service_price ?? 0);

    if (serviceMatches.length > 0 && catalogMatches.length > 0 && apptServicePrice > 0) {
      const servicesTotal = Math.min(apptServicePrice, paymentTotal);
      const catalogTotal = Math.max(0, paymentTotal - servicesTotal);

      serviceMatches.forEach((match) =>
        addBreakdownItem(match.kind, match.displayName, servicesTotal / serviceMatches.length),
      );
      catalogMatches.forEach((match) =>
        addBreakdownItem(match.kind, match.displayName, catalogTotal / catalogMatches.length),
      );
      return;
    }

    const share = paymentTotal / matches.length;
    matches.forEach((match) => addBreakdownItem(match.kind, match.displayName, share));
  });

  const makeTopItems = (map: Record<string, { name: string; count: number; rev: number }>) => {
    const entries = Object.values(map).sort((a, b) => b.rev - a.rev).slice(0, 6);
    const total = entries.reduce((sum, item) => sum + item.rev, 0);
    return entries.map((item) => ({
      name: item.name,
      rev: item.rev,
      count: Math.round(item.count),
      pct: total > 0 ? Math.round((item.rev / total) * 100) : 0,
    }));
  };

  const topServices = makeTopItems(serviceMap);
  const topCatalog = makeTopItems(catalogMap);
  const totSvc = [...topServices, ...topCatalog].reduce((sum, item) => sum + item.rev, 0);

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
    gastosByDay: days7.map((ds) =>
      gastosHoy
        .filter((g) => (g.date ? g.date === ds : g.created_at ? localDate(g.created_at) === ds : false))
        .reduce((s, g) => s + Number(g.amount || 0), 0),
    ),
    doneByDay,
    tickByDay,
    occByDay,
    topServices,
    topCatalog,
    totSvc,
    hoursLabels,
    hoursValues,
    hoursGastosValues,
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
        b.starts_at.localeCompare(a.starts_at),
      )
      .slice(0, 6)
      .map((a) => ({
        id: a.id,
        client_name: a.client_name,
        service_name: a.service_name,
        service_price: a.service_price ?? null,
        starts_at: a.starts_at,
      })),
  };
}

export function useDashboardData(
  businessId: string | null,
  range?: { from: Date; to: Date } | null,
) {
  // null range = invalid dates → disable query, return zeros
  const rangeValid = range !== null && range !== undefined;
  const from = range?.from ?? (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
  const to = range?.to ?? (() => { const d = new Date(); d.setHours(23,59,59,999); return d; })();
  const key = `${from.toISOString().slice(0,10)}_${to.toISOString().slice(0,10)}`;
  return useQuery({
    queryKey: ["dashboard", businessId, key],
    queryFn: () => loadDashboard(businessId!, { from, to }),
    enabled: !!businessId && rangeValid,
    staleTime: 30_000,
  });
}

export const pctDelta = (now: number, prev: number) =>
  prev ? Math.round(((now - prev) / prev) * 100) : null;

export const fmtAR = (n: number) => "$" + Math.round(n).toLocaleString("es-AR");
