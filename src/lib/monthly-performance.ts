// Rendimiento mensual del negocio — Asesor IA → Rendimiento.
//
// Misma regla que Caja: una venta pendiente/parcial NO suma su total (solo lo
// que se cobró, vía payment_collections), una anulada/reembolsada nunca suma,
// y los gastos cuentan TODOS (Caja del día y Fondos externos), porque la
// ganancia del mes es plata que realmente se gastó. Lo que se le paga a los
// profesionales (comisiones de las ventas cobradas, neto de los descuentos o
// ajustes de puntualidad) también se descuenta de la ganancia. Los productos
// que un profesional retira del inventario "a cuenta" (adelanto con nota
// "Retiro de stock: …") son un ingreso del mes en que se retiran — la plata
// entra recién cuando se le descuenta en la liquidación, pero la venta es del mes.
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabase-paginate";
import {
  dayBoundsBA,
  distributeCobroByMethod,
  isCountableCajaPayment,
  type PaymentSplitRaw,
} from "@/lib/caja-cierre";

export type MonthlyPaymentRow = {
  id: string;
  total: number | null;
  amount: number | null;
  tip_amount: number | null;
  status: string | null;
  method: string | null;
  payment_method: string | null;
  splits: PaymentSplitRaw[] | null;
  employee_id: string | null;
  client_id: string | null;
  client_name: string | null;
  created_at: string;
};
export type MonthlyCollectionRow = {
  id: string;
  payment_id: string | null;
  amount: number | null;
  method: string | null;
};
export type MonthlyExpenseRow = {
  id: string;
  amount: number | null;
  type: string | null;
  funds_source: string | null;
};
export type MonthlyConsumoRow = { id: string; amount: number | null; professional_id: string | null };
export type MonthlyCommissionRow = { sale_id: string | null; professional_id: string | null; amount: number | null };
export type MonthlyAttendanceRow = {
  employee_id: string | null;
  status: string | null;
  discount_amount_applied: number | null;
};

export type MonthlyRawData = {
  payments: MonthlyPaymentRow[];
  collections: MonthlyCollectionRow[];
  // Pagos a los que pertenece un cobro del mes pero que son de otro mes
  // (para saber de qué profesional es esa plata).
  collectionPayments: { id: string; employee_id: string | null }[];
  expenses: MonthlyExpenseRow[];
  commissions: MonthlyCommissionRow[];
  attendance: MonthlyAttendanceRow[];
  // Productos retirados del inventario por un profesional, anotados como adelanto.
  consumos: MonthlyConsumoRow[];
  employees: { id: string; full_name: string | null }[];
};

export type MonthlyProfessional = {
  id: string;
  name: string;
  facturacion: number;
  ventas: number;
  comision: number;
  tardes: number;
  ausencias: number;
  descuentoPuntualidad: number;
};

export type MonthlyPerformance = {
  monthKey: string;
  // Facturación = lo cobrado + los consumos de profesionales. Las propinas NO entran
  // (son plata del cliente para el profesional, igual que en el total cobrado de Caja).
  facturacion: number;
  // Solo lo efectivamente cobrado (ventas cobradas + cobros de pendientes).
  cobrado: number;
  ventas: number;
  ticket: number;
  clientes: number;
  propinas: number;
  gastosTotal: number;
  gastosCaja: number;
  gastosExternos: number;
  gastosPorTipo: { tipo: string; total: number }[];
  // Productos que los profesionales retiraron "a cuenta" (se les descuenta al liquidar).
  consumosProfesionales: number;
  consumosCount: number;
  // Ganancia = facturación (cobrado + consumos) − gastos − pago a profesionales.
  ganancia: number;
  margen: number | null;
  comisiones: number;
  // Descuento de puntualidad aplicado (positivo = se le descontó; negativo = ajuste a favor).
  descuentoPuntualidad: number;
  // Lo que se le paga a los profesionales por el mes: comisiones − descuento de puntualidad.
  pagoProfesionales: number;
  metodos: { key: string; monto: number }[];
  profesionales: MonthlyProfessional[];
  pendienteDeCobro: number;
  hasData: boolean;
};

export function monthBounds(monthKey: string): { start: Date; end: Date; firstDay: string; lastDay: string } {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDay = `${monthKey}-01`;
  const lastDay = `${monthKey}-${String(lastDayNum).padStart(2, "0")}`;
  return { start: dayBoundsBA(firstDay).start, end: dayBoundsBA(lastDay).end, firstDay, lastDay };
}

export function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const month = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("es-AR", { month: "long", timeZone: "UTC" });
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${y}`;
}

const EXPENSE_TYPE_LABEL: Record<string, string> = {
  fijo: "Fijo",
  variable: "Variable",
  ocasional: "Ocasional",
};

export function computeMonthlyPerformance(monthKey: string, raw: MonthlyRawData): MonthlyPerformance {
  const countable = raw.payments.filter((p) => isCountableCajaPayment(p.status));
  const pendientes = raw.payments.filter((p) => p.status === "pendiente" || p.status === "parcial");

  const paymentTotal = (p: MonthlyPaymentRow) => Number(p.total ?? p.amount ?? 0);
  const cobradoPagos = countable.reduce((s, p) => s + paymentTotal(p), 0);
  const cobradoCobranzas = raw.collections.reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const cobrado = cobradoPagos + cobradoCobranzas;
  const ventas = countable.length;
  const ticket = ventas > 0 ? Math.round(cobradoPagos / ventas) : 0;
  const propinas = countable.reduce((s, p) => s + Number(p.tip_amount ?? 0), 0);

  const clientesSet = new Set<string>();
  for (const p of countable) {
    const key = p.client_id || p.client_name?.trim().toLowerCase();
    if (key) clientesSet.add(String(key));
  }

  // Gastos: todos suman; se separa cuánto salió de la caja y cuánto de Fondos externos.
  let gastosTotal = 0;
  let gastosExternos = 0;
  const porTipo = new Map<string, number>();
  for (const e of raw.expenses) {
    const amount = Number(e.amount ?? 0);
    gastosTotal += amount;
    if (e.funds_source === "otros") gastosExternos += amount;
    const tipo = EXPENSE_TYPE_LABEL[String(e.type ?? "")] ?? "Sin clasificar";
    porTipo.set(tipo, (porTipo.get(tipo) ?? 0) + amount);
  }
  const gastosCaja = gastosTotal - gastosExternos;

  // Medios de pago: mismo reparto que el cierre (splits → un monto por medio).
  const metodosMap = new Map<string, number>();
  for (const p of countable) {
    const dist = distributeCobroByMethod(
      paymentTotal(p),
      0,
      p.method ?? p.payment_method,
      Array.isArray(p.splits) ? p.splits : null,
    );
    for (const [key, v] of Object.entries(dist)) metodosMap.set(key, (metodosMap.get(key) ?? 0) + v.monto);
  }
  for (const c of raw.collections) {
    const dist = distributeCobroByMethod(Number(c.amount ?? 0), 0, c.method, null);
    for (const [key, v] of Object.entries(dist)) metodosMap.set(key, (metodosMap.get(key) ?? 0) + v.monto);
  }

  // Por profesional.
  const nombre = new Map(raw.employees.map((e) => [e.id, e.full_name || "Profesional"]));
  const pagoEmpleado = new Map<string, string | null>();
  for (const p of raw.payments) pagoEmpleado.set(p.id, p.employee_id);
  for (const p of raw.collectionPayments) if (!pagoEmpleado.has(p.id)) pagoEmpleado.set(p.id, p.employee_id);

  const pro = new Map<string, MonthlyProfessional>();
  const proOf = (id: string): MonthlyProfessional => {
    let row = pro.get(id);
    if (!row) {
      row = {
        id,
        name: nombre.get(id) ?? "Profesional",
        facturacion: 0,
        ventas: 0,
        comision: 0,
        tardes: 0,
        ausencias: 0,
        descuentoPuntualidad: 0,
      };
      pro.set(id, row);
    }
    return row;
  };
  for (const p of countable) {
    if (!p.employee_id) continue;
    const r = proOf(p.employee_id);
    r.facturacion += paymentTotal(p);
    r.ventas += 1;
  }
  for (const c of raw.collections) {
    const empId = c.payment_id ? pagoEmpleado.get(c.payment_id) : null;
    if (empId) proOf(empId).facturacion += Number(c.amount ?? 0);
  }

  // Comisión: solo de las ventas cobradas del mes (la misma base que la facturación).
  const countableIds = new Set(countable.map((p) => p.id));
  let comisiones = 0;
  for (const c of raw.commissions) {
    if (!c.sale_id || !countableIds.has(c.sale_id) || !c.professional_id) continue;
    const amount = Number(c.amount ?? 0);
    comisiones += amount;
    proOf(c.professional_id).comision += amount;
  }
  for (const a of raw.attendance) {
    if (!a.employee_id) continue;
    const r = proOf(a.employee_id);
    if (a.status === "tarde") r.tardes += 1;
    if (a.status === "ausente") r.ausencias += 1;
    r.descuentoPuntualidad += Number(a.discount_amount_applied ?? 0);
  }

  const descuentoPuntualidad = raw.attendance.reduce((s, a) => s + Number(a.discount_amount_applied ?? 0), 0);
  const pagoProfesionales = comisiones - descuentoPuntualidad;
  const consumosProfesionales = raw.consumos.reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const facturacion = cobrado + consumosProfesionales;
  const ganancia = facturacion - gastosTotal - pagoProfesionales;
  const margen = facturacion > 0 ? (ganancia / facturacion) * 100 : null;

  const pendienteDeCobro = pendientes.reduce((s, p) => s + paymentTotal(p), 0);

  return {
    monthKey,
    facturacion,
    cobrado,
    ventas,
    ticket,
    clientes: clientesSet.size,
    propinas,
    gastosTotal,
    gastosCaja,
    gastosExternos,
    gastosPorTipo: [...porTipo.entries()].map(([tipo, total]) => ({ tipo, total })).sort((a, b) => b.total - a.total),
    ganancia,
    margen,
    comisiones,
    descuentoPuntualidad,
    pagoProfesionales,
    consumosProfesionales,
    consumosCount: raw.consumos.length,
    metodos: [...metodosMap.entries()].map(([key, monto]) => ({ key, monto })).sort((a, b) => b.monto - a.monto),
    profesionales: [...pro.values()].sort((a, b) => b.facturacion - a.facturacion),
    pendienteDeCobro,
    hasData: ventas > 0 || cobradoCobranzas > 0 || gastosTotal > 0 || consumosProfesionales > 0,
  };
}

// Variación porcentual contra el mes anterior (null si no hay base para comparar).
export function variationPct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

const IN_CHUNK = 150;

export async function fetchMonthlyRawData(
  businessId: string,
  branchId: string | null,
  monthKey: string,
): Promise<MonthlyRawData> {
  const { start, end, firstDay, lastDay } = monthBounds(monthKey);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  // branch_id = null nunca se excluye (mismo criterio que Caja).
  const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

  const payments = await fetchAllRows<MonthlyPaymentRow>((from, to) => {
    let q = supabase
      .from("payments")
      .select("id,total,amount,tip_amount,status,method,payment_method,splits,employee_id,client_id,client_name,created_at")
      .eq("business_id", businessId)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .not("status", "in", "(anulado,reembolsado)")
      .order("id", { ascending: true });
    if (branchFilter) q = q.or(branchFilter);
    return q.range(from, to) as any;
  });

  const collections = await fetchAllRows<MonthlyCollectionRow>((from, to) => {
    let q = supabase
      .from("payment_collections")
      .select("id,payment_id,amount,method")
      .eq("business_id", businessId)
      .gte("collected_at", startIso)
      .lte("collected_at", endIso)
      .order("id", { ascending: true });
    if (branchFilter) q = q.or(branchFilter);
    return q.range(from, to) as any;
  });

  const expenses = await fetchAllRows<MonthlyExpenseRow>((from, to) => {
    let q = supabase
      .from("expenses")
      .select("id,amount,type,funds_source")
      .eq("business_id", businessId)
      .gte("date", firstDay)
      .lte("date", lastDay)
      .order("id", { ascending: true });
    if (branchFilter) q = q.or(branchFilter);
    return q.range(from, to) as any;
  });

  const monthPaymentIds = new Set(payments.map((p) => p.id));
  const missingIds = [
    ...new Set(collections.map((c) => c.payment_id).filter((id): id is string => !!id && !monthPaymentIds.has(id))),
  ];
  const collectionPayments: { id: string; employee_id: string | null }[] = [];
  for (let i = 0; i < missingIds.length; i += IN_CHUNK) {
    const { data } = await supabase
      .from("payments")
      .select("id,employee_id")
      .eq("business_id", businessId)
      .in("id", missingIds.slice(i, i + IN_CHUNK));
    collectionPayments.push(...((data ?? []) as any[]));
  }

  // Comisiones de las ventas cobradas del mes.
  const countableIds = payments.filter((p) => isCountableCajaPayment(p.status)).map((p) => p.id);
  const commissions: MonthlyCommissionRow[] = [];
  for (let i = 0; i < countableIds.length; i += IN_CHUNK) {
    const { data } = await supabase
      .from("commission_records" as any)
      .select("sale_id,professional_id,amount")
      .eq("business_id", businessId)
      .in("sale_id", countableIds.slice(i, i + IN_CHUNK));
    commissions.push(...((data ?? []) as any[]));
  }

  // Puntualidad y nombres: si estas tablas no existen/fallan, el resto igual se muestra.
  let attendance: MonthlyAttendanceRow[] = [];
  try {
    attendance = await fetchAllRows<MonthlyAttendanceRow>((from, to) =>
      supabase
        .from("attendance_confirmations" as any)
        .select("employee_id,status,discount_amount_applied")
        .eq("business_id", businessId)
        .gte("date", firstDay)
        .lte("date", lastDay)
        .order("id", { ascending: true })
        .range(from, to) as any,
    );
  } catch {
    attendance = [];
  }

  // Retiros de stock a cuenta del profesional (Inventario → "Anotar como adelanto").
  let consumos: MonthlyConsumoRow[] = [];
  try {
    consumos = await fetchAllRows<MonthlyConsumoRow>((from, to) =>
      supabase
        .from("professional_advances" as any)
        .select("id,amount,professional_id")
        .eq("business_id", businessId)
        .gte("advanced_at", startIso)
        .lte("advanced_at", endIso)
        .ilike("note", "Retiro de stock:%")
        .order("id", { ascending: true })
        .range(from, to) as any,
    );
  } catch {
    consumos = [];
  }

  const { data: employees } = await supabase.from("employees").select("id,full_name").eq("business_id", businessId);

  return {
    payments,
    collections,
    collectionPayments,
    expenses,
    commissions,
    attendance,
    consumos,
    employees: (employees ?? []) as any[],
  };
}
