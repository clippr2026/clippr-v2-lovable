// Detalle del mes del Asesor IA: las estadísticas que se abren con "Ver detalles" en cada
// tarjeta del Rendimiento mensual (facturación, gastos, pago a profesionales, ventas, ticket
// promedio y clientes). Se piden recién cuando se abre el módulo, así la pantalla principal
// no carga más datos de los necesarios.
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { monthBounds, type MonthlyPerformance } from "@/lib/monthly-performance";

const AR_TZ = "America/Argentina/Buenos_Aires";
const IN_CHUNK = 150;

export type DetailPayment = {
  id: string;
  total: number | null;
  amount: number | null;
  original_amount: number | null;
  discount: number | null;
  promotion_name: string | null;
  service_name: string | null;
  items: unknown;
  tip_amount: number | null;
  status: string | null;
  method: string | null;
  payment_method: string | null;
  employee_id: string | null;
  client_id: string | null;
  client_name: string | null;
  created_at: string;
  appointment_id: string | null;
};
export type DetailExpense = {
  id: string;
  name: string | null;
  amount: number | null;
  type: string | null;
  category: string | null;
  date: string | null;
  funds_source: string | null;
  payment_method: string | null;
};
export type DetailCommission = {
  id: string;
  sale_id: string | null;
  professional_id: string | null;
  amount: number | null;
  paid_amount: number | null;
  pending_amount: number | null;
  settlement_run_id: string | null;
  amount_services: number | null;
  amount_products: number | null;
};
export type DetailAdvance = {
  id: string;
  professional_id: string | null;
  amount: number | null;
  note: string | null;
  funds_source: string | null;
};
export type DetailAppt = {
  id: string;
  status: string;
  starts_at: string;
  employee_id: string | null;
};
export type MonthlyDetailRaw = {
  payments: DetailPayment[];
  expenses: DetailExpense[];
  commissions: DetailCommission[];
  advances: DetailAdvance[];
  appts: DetailAppt[];
};

export async function fetchMonthlyDetailRaw(
  businessId: string,
  branchId: string | null,
  monthKey: string,
): Promise<MonthlyDetailRaw> {
  const { start, end, firstDay, lastDay } = monthBounds(monthKey);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

  const payments = await fetchAllRows<DetailPayment>((from, to) => {
    let q = supabase
      .from("payments")
      .select(
        "id,total,amount,original_amount,discount,promotion_name,service_name,items,tip_amount,status,method,payment_method,employee_id,client_id,client_name,created_at,appointment_id",
      )
      .eq("business_id", businessId)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("id", { ascending: true });
    if (branchFilter) q = q.or(branchFilter);
    return q.range(from, to) as any;
  });

  const expenses = await fetchAllRows<DetailExpense>((from, to) => {
    let q = supabase
      .from("expenses")
      .select("id,name,amount,type,category,date,funds_source,payment_method")
      .eq("business_id", businessId)
      .gte("date", firstDay)
      .lte("date", lastDay)
      .order("id", { ascending: true });
    if (branchFilter) q = q.or(branchFilter);
    return q.range(from, to) as any;
  });

  const saleIds = payments.filter((p) => p.status !== "anulado" && p.status !== "reembolsado").map((p) => p.id);
  const commissions: DetailCommission[] = [];
  for (let i = 0; i < saleIds.length; i += IN_CHUNK) {
    const { data } = await supabase
      .from("commission_records")
      .select("id,sale_id,professional_id,amount,paid_amount,pending_amount,settlement_run_id,amount_services,amount_products")
      .eq("business_id", businessId)
      .in("sale_id", saleIds.slice(i, i + IN_CHUNK));
    commissions.push(...((data ?? []) as any[]));
  }

  let advances: DetailAdvance[] = [];
  try {
    advances = await fetchAllRows<DetailAdvance>((from, to) =>
      supabase
        .from("professional_advances" as any)
        .select("id,professional_id,amount,note,funds_source")
        .eq("business_id", businessId)
        .gte("advanced_at", startIso)
        .lte("advanced_at", endIso)
        .order("id", { ascending: true })
        .range(from, to) as any,
    );
  } catch {
    advances = [];
  }

  let appts: DetailAppt[] = [];
  try {
    appts = await fetchAllRows<DetailAppt>((from, to) => {
      let q = supabase
        .from("appointments")
        .select("id,status,starts_at,employee_id")
        .eq("business_id", businessId)
        .gte("starts_at", startIso)
        .lte("starts_at", endIso)
        .order("id", { ascending: true });
      if (branchFilter) q = q.or(branchFilter);
      return q.range(from, to) as any;
    });
  } catch {
    appts = [];
  }

  return { payments, expenses, commissions, advances, appts };
}

// ───────────────────────────── cálculo ─────────────────────────────

export type ShareRow = { label: string; value: number; count?: number; extra?: number };
export type DayRow = {
  label: string;
  total: number;
  ventas: number;
  dias: number;
  promedio: number;
  ticket: number;
  // Barberos que vendieron ese día de la semana (promedio por jornada) y lo que le toca a cada
  // uno: lo que factura y lo que gana (su comisión) en una jornada de ese día.
  barberos: number;
  facturaPorBarbero: number;
  ganaPorBarbero: number;
};
export type QuincenaRow = { label: string; total: number; ventas: number; dias: number; promedio: number; ticket: number };
export type DateRow = { date: string; total: number; ventas: number };

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const arDateKey = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: AR_TZ });
const arHour = (iso: string) =>
  Number(new Date(iso).toLocaleTimeString("sv-SE", { timeZone: AR_TZ, hour12: false }).slice(0, 2));
const weekdayOf = (dateKey: string) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getDay();
};
const payTotal = (p: DetailPayment) => Number(p.total ?? p.amount ?? 0);
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const clientKey = (p: Pick<DetailPayment, "client_id" | "client_name">) => p.client_id || norm(p.client_name) || "";

type Line = { name: string; qty: number; amount: number; isProduct: boolean };

// Líneas de una venta con su monto repartido para que sumen EXACTAMENTE el total cobrado
// (el descuento o la promo ya vienen aplicados).
function linesOf(p: DetailPayment): Line[] {
  const total = payTotal(p);
  const raw = Array.isArray(p.items) ? (p.items as any[]).filter((it) => it && typeof it === "object") : [];
  if (raw.length === 0) {
    return [{ name: (p.service_name ?? "").trim() || "Servicio", qty: 1, amount: total, isProduct: false }];
  }
  const lines = raw.map((it) => ({
    name: String(it.name ?? "").trim() || "Servicio",
    qty: Number(it.qty ?? 1) > 0 ? Number(it.qty ?? 1) : 1,
    amount: Math.max(0, Number(it.amount ?? 0)),
    isProduct: Boolean(it.is_catalog),
  }));
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  const factor = sum > 0 ? total / sum : 0;
  return lines.map((l) => ({ ...l, amount: sum > 0 ? l.amount * factor : total / lines.length }));
}

function groupRows(map: Map<string, { value: number; count: number; extra?: number }>): ShareRow[] {
  return [...map.entries()]
    .map(([label, v]) => ({ label, value: v.value, count: v.count, extra: v.extra }))
    .sort((a, b) => b.value - a.value);
}

const median = (arr: number[]) => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const quantile = (arr: number[], q: number) => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export type DetailClient = { id: string; name: string; created_at: string; status: string; vipTag: string | null };

export type MonthlyDetail = {
  ventasCount: number;
  // Facturación
  facturacion: {
    ventasServicios: number;
    ventasProductos: number;
    consumos: number;
    total: number;
    porServicio: ShareRow[];
    porProfesional: ShareRow[];
    porPromo: ShareRow[]; // value = facturado, count = ventas, extra = descuento otorgado
    sinPromo: { ventas: number; facturado: number };
    descuentoTotal: number;
    porDiaSemana: DayRow[];
    mejorDia: DayRow | null;
    peorDia: DayRow | null;
    porQuincena: QuincenaRow[];
    porFranja: ShareRow[];
    propinas: number;
  };
  // Gastos
  gastos: {
    total: number;
    cantidad: number;
    porTipo: ShareRow[];
    porOrigen: ShareRow[];
    porMedio: ShareRow[];
    porCategoria: ShareRow[];
    porSemana: ShareRow[];
    mayores: Array<{ name: string; amount: number; date: string; type: string }>;
    promedioPorDia: number;
    porcentajeDeFacturacion: number | null;
    diaMayorGasto: { date: string; total: number } | null;
  };
  // Pago a profesionales
  profesionales: {
    filas: Array<{
      id: string;
      name: string;
      facturacion: number;
      comision: number;
      comisionPct: number | null;
      puntualidad: number;
      tardes: number;
      ausencias: number;
      pagoNeto: number;
      adelantos: number;
      consumos: number;
      saldo: number;
      propinas: number;
    }>;
    comisionTotal: number;
    comisionServicios: number;
    comisionProductos: number;
    incluidaEnLiquidacion: number;
    sinLiquidar: number;
    puntualidadTotal: number;
    tardes: number;
    ausencias: number;
    adelantosTotal: number;
    adelantosPorOrigen: ShareRow[];
    consumosTotal: number;
    consumosPorProducto: ShareRow[];
    propinasTotal: number;
    comisionSobreFacturacion: number | null;
  };
  // Ventas
  ventas: {
    total: number;
    anuladas: { count: number; monto: number };
    sinCobrar: { count: number; monto: number };
    conTurno: number;
    sinTurno: number;
    combos: number;
    conProducto: number;
    porServicio: ShareRow[];
    porProfesional: ShareRow[];
    porDiaSemana: DayRow[];
    porFranja: ShareRow[];
    promedioPorDia: number;
    diasConVentas: number;
    mejorDia: DayRow | null;
  };
  // Ticket promedio
  ticket: {
    promedio: number;
    mediana: number;
    maximo: number;
    minimo: number;
    q1: number;
    q3: number;
    porProfesional: ShareRow[];
    porDiaSemana: DayRow[];
    porMedio: ShareRow[];
    conPromo: { ventas: number; ticket: number };
    sinPromo: { ventas: number; ticket: number };
    conTurno: { ventas: number; ticket: number };
    sinTurno: { ventas: number; ticket: number };
    unServicio: { ventas: number; ticket: number };
    combo: { ventas: number; ticket: number };
  };
  // Clientes
  clientes: {
    atendidos: number;
    nuevos: number;
    recurrentes: number;
    sinFicha: number;
    vip: number;
    porEstado: ShareRow[];
    frecuencia: ShareRow[];
    topClientes: Array<{ name: string; visitas: number; gasto: number }>;
    turnos: {
      agendados: number;
      cobrados: number;
      cancelados: number;
      noAsistieron: number;
      pendientes: number;
      tasaCancelacion: number | null;
      tasaNoAsistencia: number | null;
    };
    ventasSinTurno: number;
  };
};

const avg = (sum: number, n: number) => (n > 0 ? sum / n : 0);

function byWeekday(payments: DetailPayment[], comBySale: Map<string, number> = new Map()): DayRow[] {
  const acc = WEEKDAYS.map((label) => ({
    label,
    total: 0,
    ventas: 0,
    comision: 0,
    fechas: new Set<string>(),
    barberosPorFecha: new Map<string, Set<string>>(),
  }));
  for (const p of payments) {
    const key = arDateKey(p.created_at);
    const d = weekdayOf(key);
    acc[d].total += payTotal(p);
    acc[d].ventas += 1;
    acc[d].comision += comBySale.get(p.id) ?? 0;
    acc[d].fechas.add(key);
    if (p.employee_id) {
      const set = acc[d].barberosPorFecha.get(key) ?? new Set<string>();
      set.add(p.employee_id);
      acc[d].barberosPorFecha.set(key, set);
    }
  }
  // Lunes primero, domingo al final.
  return [1, 2, 3, 4, 5, 6, 0]
    .map((d) => acc[d])
    .map((a) => {
      const barberDays = [...a.barberosPorFecha.values()].reduce((s, set) => s + set.size, 0);
      return {
        label: a.label,
        total: a.total,
        ventas: a.ventas,
        dias: a.fechas.size,
        promedio: avg(a.total, a.fechas.size),
        ticket: avg(a.total, a.ventas),
        barberos: avg(barberDays, a.fechas.size),
        facturaPorBarbero: avg(a.total, barberDays),
        ganaPorBarbero: avg(a.comision, barberDays),
      };
    });
}

function pickBestWorst(rows: DayRow[]): { best: DayRow | null; worst: DayRow | null } {
  const active = rows.filter((r) => r.dias > 0);
  if (active.length === 0) return { best: null, worst: null };
  const sorted = [...active].sort((a, b) => b.promedio - a.promedio);
  return { best: sorted[0], worst: sorted.length > 1 ? sorted[sorted.length - 1] : null };
}

export function computeMonthlyDetail(
  monthKey: string,
  raw: MonthlyDetailRaw,
  perf: MonthlyPerformance,
  clients: DetailClient[],
): MonthlyDetail {
  const voided = raw.payments.filter((p) => p.status === "anulado" || p.status === "reembolsado");
  const sales = raw.payments.filter((p) => p.status !== "anulado" && p.status !== "reembolsado");
  const pending = sales.filter((p) => p.status === "pendiente" || p.status === "parcial");
  const total = sales.reduce((s, p) => s + payTotal(p), 0);

  // ── Servicios / productos ──
  const svc = new Map<string, { value: number; count: number }>();
  let ventasServicios = 0;
  let ventasProductos = 0;
  for (const p of sales) {
    for (const l of linesOf(p)) {
      if (l.isProduct) {
        ventasProductos += l.amount;
        continue;
      }
      ventasServicios += l.amount;
      const cur = svc.get(l.name) ?? { value: 0, count: 0 };
      cur.value += l.amount;
      cur.count += l.qty;
      svc.set(l.name, cur);
    }
  }

  const nameOf = new Map(perf.profesionales.map((p) => [p.id, p.name]));
  const proName = (id: string | null) => (id ? nameOf.get(id) ?? "Profesional" : "Sin profesional");

  const porProf = new Map<string, { value: number; count: number }>();
  for (const p of sales) {
    const k = proName(p.employee_id);
    const cur = porProf.get(k) ?? { value: 0, count: 0 };
    cur.value += payTotal(p);
    cur.count += 1;
    porProf.set(k, cur);
  }

  // ── Promos ──
  const promos = new Map<string, { value: number; count: number; extra: number }>();
  let sinPromo = { ventas: 0, facturado: 0 };
  let descuentoTotal = 0;
  const discountOf = (p: DetailPayment) => {
    const fromOriginal = Number(p.original_amount ?? 0) - payTotal(p);
    return Math.max(0, fromOriginal > 0 ? fromOriginal : Number(p.discount ?? 0));
  };
  for (const p of sales) {
    const name = (p.promotion_name ?? "").trim();
    const disc = discountOf(p);
    descuentoTotal += disc;
    if (!name) {
      sinPromo = { ventas: sinPromo.ventas + 1, facturado: sinPromo.facturado + payTotal(p) };
      continue;
    }
    // "Promo AMIGOS" y "Promo Amigos" son la misma promo.
    const key = name.replace(/\s+/g, " ").toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    const cur = promos.get(key) ?? { value: 0, count: 0, extra: 0 };
    cur.value += payTotal(p);
    cur.count += 1;
    cur.extra += disc;
    promos.set(key, cur);
  }

  // ── Días / fechas / franjas ──
  const comBySale = new Map<string, number>();
  for (const c of raw.commissions) {
    if (c.sale_id) comBySale.set(c.sale_id, (comBySale.get(c.sale_id) ?? 0) + Number(c.amount ?? 0));
  }
  const dias = byWeekday(sales, comBySale);
  const { best, worst } = pickBestWorst(dias);
  const fechasMap = new Map<string, DateRow>();
  for (const p of sales) {
    const key = arDateKey(p.created_at);
    const cur = fechasMap.get(key) ?? { date: key, total: 0, ventas: 0 };
    cur.total += payTotal(p);
    cur.ventas += 1;
    fechasMap.set(key, cur);
  }
  const porFecha = [...fechasMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const lastDayNum = new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0).getDate();
  const porQuincena: QuincenaRow[] = [
    { label: "Del 1 al 15", from: 1, to: 15 },
    { label: `Del 16 al ${lastDayNum}`, from: 16, to: lastDayNum },
  ].map((q) => {
    const rows = porFecha.filter((r) => {
      const day = Number(r.date.slice(8, 10));
      return day >= q.from && day <= q.to;
    });
    const tot = rows.reduce((s, r) => s + r.total, 0);
    const vts = rows.reduce((s, r) => s + r.ventas, 0);
    return { label: q.label, total: tot, ventas: vts, dias: rows.length, promedio: avg(tot, rows.length), ticket: avg(tot, vts) };
  });
  const FRANJAS = ["Mañana (antes de las 13)", "Tarde (13 a 18)", "Noche (desde las 18)"];
  const franjaOf = (p: DetailPayment) => {
    const h = arHour(p.created_at);
    return h < 13 ? FRANJAS[0] : h < 18 ? FRANJAS[1] : FRANJAS[2];
  };
  const franjas = new Map<string, { value: number; count: number }>();
  for (const p of sales) {
    const k = franjaOf(p);
    const cur = franjas.get(k) ?? { value: 0, count: 0 };
    cur.value += payTotal(p);
    cur.count += 1;
    franjas.set(k, cur);
  }
  const porFranja = [...franjas.entries()]
    .map(([label, v]) => ({ label, value: v.value, count: v.count }))
    .sort((a, b) => FRANJAS.indexOf(a.label) - FRANJAS.indexOf(b.label));
  const propinas = sales.reduce((s, p) => s + Number(p.tip_amount ?? 0), 0);

  // ── Gastos ──
  const typeLabel: Record<string, string> = { fijo: "Fijo", variable: "Variable", ocasional: "Ocasional" };
  const gTipo = new Map<string, { value: number; count: number }>();
  const gOrigen = new Map<string, { value: number; count: number }>();
  const gMedio = new Map<string, { value: number; count: number }>();
  const gCat = new Map<string, { value: number; count: number }>();
  const gSemana = new Map<string, { value: number; count: number }>();
  const gDia = new Map<string, number>();
  const add = (m: Map<string, { value: number; count: number }>, k: string, v: number) => {
    const cur = m.get(k) ?? { value: 0, count: 0 };
    cur.value += v;
    cur.count += 1;
    m.set(k, cur);
  };
  let gastosTotal = 0;
  for (const e of raw.expenses) {
    const amount = Number(e.amount ?? 0);
    gastosTotal += amount;
    add(gTipo, typeLabel[e.type ?? ""] ?? "Sin tipo", amount);
    add(gOrigen, e.funds_source === "otros" ? "Fondos externos" : "Caja del día", amount);
    const med = norm(e.payment_method);
    add(gMedio, med.startsWith("efect") ? "Efectivo" : med ? "Transferencia / cuenta" : "Sin medio", amount);
    if ((e.category ?? "").trim()) add(gCat, (e.category ?? "").trim(), amount);
    const day = Number((e.date ?? "").slice(8, 10)) || 1;
    add(gSemana, `Semana ${Math.min(5, Math.ceil(day / 7))} (días ${(Math.ceil(day / 7) - 1) * 7 + 1} al ${Math.min(Math.ceil(day / 7) * 7, 31)})`, amount);
    if (e.date) gDia.set(e.date, (gDia.get(e.date) ?? 0) + amount);
  }
  const mayorDia = [...gDia.entries()].sort((a, b) => b[1] - a[1])[0];
  const daysInMonth = new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0).getDate();

  // ── Profesionales ──
  const comPorPro = new Map<string, { com: number; svc: number; prod: number }>();
  let comisionTotal = 0;
  let liquidada = 0;
  let comServ = 0;
  let comProd = 0;
  const saleIds = new Set(sales.map((p) => p.id));
  for (const c of raw.commissions) {
    if (!c.sale_id || !saleIds.has(c.sale_id) || !c.professional_id) continue;
    const a = Number(c.amount ?? 0);
    comisionTotal += a;
    if (c.settlement_run_id) liquidada += a;
    comServ += Number(c.amount_services ?? 0);
    comProd += Number(c.amount_products ?? 0);
    const cur = comPorPro.get(c.professional_id) ?? { com: 0, svc: 0, prod: 0 };
    cur.com += a;
    comPorPro.set(c.professional_id, cur);
  }
  const isStock = (a: DetailAdvance) => (a.note ?? "").startsWith("Retiro de stock:");
  const advByPro = new Map<string, { adel: number; cons: number }>();
  const advOrigen = new Map<string, { value: number; count: number }>();
  const stockProducts = new Map<string, { value: number; count: number }>();
  let adelantosTotal = 0;
  let consumosTotal = 0;
  for (const a of raw.advances) {
    const amount = Number(a.amount ?? 0);
    const cur = advByPro.get(a.professional_id ?? "") ?? { adel: 0, cons: 0 };
    if (isStock(a)) {
      consumosTotal += amount;
      cur.cons += amount;
      const prod = (a.note ?? "").replace("Retiro de stock:", "").replace(/\s*[x×]\s*\d+.*$/i, "").trim() || "Producto";
      add(stockProducts, prod, amount);
    } else {
      adelantosTotal += amount;
      cur.adel += amount;
      add(advOrigen, a.funds_source === "externo" ? "Fondos externos" : a.funds_source === "caja" ? "Caja del día" : "Sin origen registrado", amount);
    }
    advByPro.set(a.professional_id ?? "", cur);
  }
  const tipByPro = new Map<string, number>();
  for (const p of sales) {
    if (p.employee_id) tipByPro.set(p.employee_id, (tipByPro.get(p.employee_id) ?? 0) + Number(p.tip_amount ?? 0));
  }
  const filas = perf.profesionales
    .map((pr) => {
      const com = comPorPro.get(pr.id)?.com ?? pr.comision;
      const adv = advByPro.get(pr.id) ?? { adel: 0, cons: 0 };
      const pagoNeto = com - pr.descuentoPuntualidad;
      return {
        id: pr.id,
        name: pr.name,
        facturacion: pr.facturacion,
        comision: com,
        comisionPct: pr.facturacion > 0 ? (com / pr.facturacion) * 100 : null,
        puntualidad: pr.descuentoPuntualidad,
        tardes: pr.tardes,
        ausencias: pr.ausencias,
        pagoNeto,
        adelantos: adv.adel,
        consumos: adv.cons,
        saldo: pagoNeto - adv.adel - adv.cons,
        propinas: tipByPro.get(pr.id) ?? 0,
      };
    })
    .sort((a, b) => b.facturacion - a.facturacion);

  // ── Ticket ──
  const ticketsOf = (list: DetailPayment[]) => list.map(payTotal);
  const allTickets = ticketsOf(sales);
  const tk = (list: DetailPayment[]) => ({ ventas: list.length, ticket: avg(list.reduce((s, p) => s + payTotal(p), 0), list.length) });
  // Combo: más de un servicio en la venta, o un servicio armado como combo ("Corte + Barba").
  const comboOf = (p: DetailPayment) => {
    const svcLines = linesOf(p).filter((l) => !l.isProduct);
    return svcLines.reduce((s, l) => s + l.qty, 0) > 1 || svcLines.some((l) => l.name.includes("+"));
  };
  const tkProf = new Map<string, { value: number; count: number }>();
  const tkMedio = new Map<string, { value: number; count: number }>();
  for (const p of sales) {
    add(tkProf, proName(p.employee_id), payTotal(p));
    add(tkMedio, norm(p.method ?? p.payment_method) || "otro", payTotal(p));
  }
  const toTicketRows = (m: Map<string, { value: number; count: number }>): ShareRow[] =>
    [...m.entries()]
      .map(([label, v]) => ({ label, value: avg(v.value, v.count), count: v.count }))
      .sort((a, b) => b.value - a.value);

  // ── Clientes ──
  const byId = new Map(clients.map((c) => [c.id, c]));
  const byName = new Map(clients.map((c) => [norm(c.name), c]));
  const served = new Map<string, { name: string; visitas: number; gasto: number; client?: DetailClient }>();
  for (const p of sales) {
    const key = clientKey(p);
    if (!key) continue;
    const cur = served.get(key) ?? {
      name: (p.client_name ?? "").trim() || "Cliente",
      visitas: 0,
      gasto: 0,
      client: (p.client_id ? byId.get(p.client_id) : undefined) ?? byName.get(norm(p.client_name)),
    };
    cur.visitas += 1;
    cur.gasto += payTotal(p);
    served.set(key, cur);
  }
  const monthPrefix = monthKey;
  let nuevos = 0;
  let sinFicha = 0;
  let vip = 0;
  const estado = new Map<string, { value: number; count: number }>();
  const estadoLabel: Record<string, string> = {
    vip: "VIP",
    nuevo: "Nuevo",
    activo: "Activo",
    inactivo: "Inactivo",
    perdido: "Perdido",
  };
  for (const s of served.values()) {
    if (!s.client) {
      sinFicha += 1;
      continue;
    }
    if (arDateKey(s.client.created_at).startsWith(monthPrefix)) nuevos += 1;
    if (s.client.vipTag === "vip") vip += 1;
    add(estado, estadoLabel[s.client.status] ?? s.client.status, 1);
  }
  const atendidos = served.size;
  const frec = new Map<string, { value: number; count: number }>();
  for (const s of served.values()) {
    const k = s.visitas >= 3 ? "3 o más visitas" : s.visitas === 2 ? "2 visitas" : "1 visita";
    add(frec, k, 1);
  }
  const appts = raw.appts.filter((a) => a.status !== "blocked");
  const countStatus = (...st: string[]) => appts.filter((a) => st.includes(a.status)).length;
  const agendados = appts.length;
  const cancelados = countStatus("cancelled");
  const noAsistieron = countStatus("no_show");

  const mejor = pickBestWorst(dias);
  const sinTurnoCount = sales.filter((p) => !p.appointment_id).length;
  const conProducto = sales.filter((p) => linesOf(p).some((l) => l.isProduct)).length;

  return {
    ventasCount: sales.length,
    facturacion: {
      ventasServicios,
      ventasProductos,
      consumos: perf.consumosProfesionales,
      total: perf.facturacion,
      porServicio: groupRows(svc),
      porProfesional: groupRows(porProf),
      porPromo: groupRows(promos),
      sinPromo,
      descuentoTotal,
      porDiaSemana: dias,
      mejorDia: best,
      peorDia: worst,
      porQuincena,
      porFranja,
      propinas,
    },
    gastos: {
      total: gastosTotal,
      cantidad: raw.expenses.length,
      porTipo: groupRows(gTipo),
      porOrigen: groupRows(gOrigen),
      porMedio: groupRows(gMedio),
      porCategoria: groupRows(gCat),
      porSemana: [...gSemana.entries()]
        .map(([label, v]) => ({ label, value: v.value, count: v.count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      mayores: [...raw.expenses]
        .sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0))
        .slice(0, 5)
        .map((e) => ({
          name: (e.name ?? "").trim() || "Gasto",
          amount: Number(e.amount ?? 0),
          date: e.date ?? "",
          type: typeLabel[e.type ?? ""] ?? "Sin tipo",
        })),
      promedioPorDia: gastosTotal / daysInMonth,
      porcentajeDeFacturacion: perf.facturacion > 0 ? (gastosTotal / perf.facturacion) * 100 : null,
      diaMayorGasto: mayorDia ? { date: mayorDia[0], total: mayorDia[1] } : null,
    },
    profesionales: {
      filas,
      comisionTotal,
      comisionServicios: comServ,
      comisionProductos: comProd,
      incluidaEnLiquidacion: liquidada,
      sinLiquidar: comisionTotal - liquidada,
      puntualidadTotal: perf.descuentoPuntualidad,
      tardes: perf.profesionales.reduce((s, p) => s + p.tardes, 0),
      ausencias: perf.profesionales.reduce((s, p) => s + p.ausencias, 0),
      adelantosTotal,
      adelantosPorOrigen: groupRows(advOrigen),
      consumosTotal,
      consumosPorProducto: groupRows(stockProducts),
      propinasTotal: propinas,
      comisionSobreFacturacion: perf.facturacion > 0 ? (comisionTotal / perf.facturacion) * 100 : null,
    },
    ventas: {
      total: sales.length,
      anuladas: { count: voided.length, monto: voided.reduce((s, p) => s + payTotal(p), 0) },
      sinCobrar: { count: pending.length, monto: perf.pendienteDeCobro },
      conTurno: sales.length - sinTurnoCount,
      sinTurno: sinTurnoCount,
      combos: sales.filter(comboOf).length,
      conProducto,
      porServicio: groupRows(svc).map((r) => ({ ...r, value: r.count ?? 0, extra: r.value })),
      porProfesional: groupRows(porProf).map((r) => ({ ...r, value: r.count ?? 0, extra: r.value })).sort((a, b) => b.value - a.value),
      porDiaSemana: dias,
      porFranja: porFranja.map((r) => ({ ...r, value: r.count ?? 0, extra: r.value })),
      promedioPorDia: avg(sales.length, fechasMap.size),
      diasConVentas: fechasMap.size,
      mejorDia: [...dias].filter((d) => d.dias > 0).sort((a, b) => b.ventas / b.dias - a.ventas / a.dias)[0] ?? mejor.best,
    },
    ticket: {
      promedio: avg(total, sales.length),
      mediana: median(allTickets),
      maximo: allTickets.length ? Math.max(...allTickets) : 0,
      minimo: allTickets.length ? Math.min(...allTickets) : 0,
      q1: quantile(allTickets, 0.25),
      q3: quantile(allTickets, 0.75),
      porProfesional: toTicketRows(tkProf),
      porDiaSemana: dias,
      porMedio: toTicketRows(tkMedio),
      conPromo: tk(sales.filter((p) => (p.promotion_name ?? "").trim())),
      sinPromo: tk(sales.filter((p) => !(p.promotion_name ?? "").trim())),
      conTurno: tk(sales.filter((p) => p.appointment_id)),
      sinTurno: tk(sales.filter((p) => !p.appointment_id)),
      unServicio: tk(sales.filter((p) => !comboOf(p))),
      combo: tk(sales.filter(comboOf)),
    },
    clientes: {
      atendidos,
      nuevos,
      recurrentes: Math.max(0, atendidos - sinFicha - nuevos),
      sinFicha,
      vip,
      porEstado: groupRows(estado),
      frecuencia: [...frec.entries()]
        .map(([label, v]) => ({ label, value: v.value, count: v.count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      topClientes: [...served.values()]
        .sort((a, b) => b.gasto - a.gasto)
        .slice(0, 5)
        .map((s) => ({ name: s.name, visitas: s.visitas, gasto: s.gasto })),
      turnos: {
        agendados,
        cobrados: countStatus("charged", "completed"),
        cancelados,
        noAsistieron,
        pendientes: countStatus("pending", "confirmed"),
        tasaCancelacion: agendados > 0 ? (cancelados / agendados) * 100 : null,
        tasaNoAsistencia: agendados > 0 ? (noAsistieron / agendados) * 100 : null,
      },
      ventasSinTurno: sinTurnoCount,
    },
  };
}
