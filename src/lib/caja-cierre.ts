import { supabase } from "@/integrations/supabase/client";

// Helpers de "Cierre de caja" (caja_cierres) — compartidos entre Caja
// (src/routes/cash-register.tsx, históricamente donde vivía todo esto) e
// Inicio (tarjeta "Caja de hoy" / "Caja vencida"). Movidos acá para que
// ambas pantallas usen exactamente la misma lógica, sin duplicarla.

export type CierreMetodoDetalle = {
  ingresos: number;
  gastos: number;
  utilidad: number;
};

export type CajaEvento = {
  tipo?: string | null;
  fecha_hora?: string | null;
  hora?: string | null;
  usuario?: string | null;
  observacion?: string | null;
  motivo?: string | null;
  [key: string]: unknown;
};

export function cajaEventosArray(value: unknown): CajaEvento[] {
  return Array.isArray(value) ? (value as CajaEvento[]) : [];
}

export function appendCajaEvento(
  prevEventos: unknown,
  evento: CajaEvento,
): CajaEvento[] {
  return [...cajaEventosArray(prevEventos), evento];
}

export function cleanCajaEventosForDisplay(events: CajaEvento[]): CajaEvento[] {
  const cleaned: CajaEvento[] = [];

  for (const event of events) {
    const previous = cleaned[cleaned.length - 1];
    const sameAsPrevious =
      previous &&
      previous.tipo === event.tipo &&
      previous.hora === event.hora &&
      previous.usuario === event.usuario &&
      (previous.observacion ?? null) === (event.observacion ?? null) &&
      (previous.motivo ?? null) === (event.motivo ?? null);

    if (!sameAsPrevious) cleaned.push(event);
  }

  return cleaned;
}

export function isCajaCerradaRow(cierre: any) {
  return String(cierre?.estado ?? "").toLowerCase() === "cerrada";
}

export function isCajaReabiertaRow(cierre: any) {
  return String(cierre?.estado ?? "").toLowerCase() === "reabierta";
}

export function cajaDateKey(date = new Date()) {
  return date.toLocaleDateString("sv-SE");
}

export function cajaTimeLabel(date = new Date()) {
  return (
    date.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + "hs"
  );
}

export function cajaHoraDisplay(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "—") return "—";
  const direct = raw.match(/^(\d{1,2}):(\d{2})/);
  if (direct) return `${direct[1].padStart(2, "0")}:${direct[2]}hs`;

  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const min = ampm[2];
    const suffix = ampm[3].toLowerCase();
    if (suffix.includes("p") && h < 12) h += 12;
    if (suffix.includes("a") && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${min}hs`;
  }

  return raw.replace(/\s*a\.\s*m\.?/i, "hs").replace(/\s*p\.\s*m\.?/i, "hs");
}

export function cajaEventTimeToMinutes(value?: string | null) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function sortCajaEventos(events: CajaEvento[]) {
  return [...events].sort((a, b) => {
    const at = String(a.fecha_hora ?? "");
    const bt = String(b.fecha_hora ?? "");
    if (at && bt) return at.localeCompare(bt);
    return cajaEventTimeToMinutes(a.hora) - cajaEventTimeToMinutes(b.hora);
  });
}

export function getCajaLastEvent(cierre: any, tipo?: string) {
  const events = sortCajaEventos(cajaEventosArray(cierre?.eventos));
  const filtered = tipo ? events.filter((event) => event.tipo === tipo) : events;
  return filtered[filtered.length - 1] ?? null;
}

export function getCajaFirstEvent(cierre: any, tipo?: string) {
  const events = sortCajaEventos(cajaEventosArray(cierre?.eventos));
  return (tipo ? events.find((event) => event.tipo === tipo) : events[0]) ?? null;
}

// payments.method/expenses.payment_method usan vocabularios distintos
// ("cash" vs "efectivo", etc.) — normaliza ambos a la misma clave canónica
// antes de agrupar, para no duplicar filas del mismo método en el desglose.
export function normalizeCierreMethodKey(method: string | null | undefined): string {
  const raw = String(method || "").trim().toLowerCase();
  if (!raw) return "cash";
  const stripped = raw.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (stripped === "cash" || stripped === "efectivo") return "cash";
  if (stripped === "transfer" || stripped === "transferencia") return "transfer";
  if (
    stripped === "card" ||
    stripped === "tarjeta" ||
    stripped === "debito" ||
    stripped === "credito"
  )
    return "card";
  if (stripped === "mp" || stripped === "mercado pago" || stripped === "mercadopago")
    return "mp";
  if (stripped === "qr") return "qr";
  if (stripped === "cuenta") return "cuenta";
  return raw;
}

export type PendingCierre = { date: string; cierreId: string | null };

// Período de caja vigente: desde cuándo hay que contar payments/
// cash_movements, y si corresponde a un backlog sin cerrar ("caja
// vencida"). ÚNICA fuente de verdad: cash_sessions (status='open'), nunca
// caja_cierres — esa tabla es historial puro, inmutable una vez cerrada.
//
// Por qué esto reemplaza al viejo esquema (caja_cierres.estado
// 'cerrada'/'reabierta'): "reabrir caja" mutaba en el lugar la MISMA fila
// de caja_cierres, sin tocar su `fecha` — una caja vencida de hace varios
// días podía quedar "reabierta" para siempre con la fecha vieja, y
// Ingresos terminaba sumando varios días juntos cada vez que se volvía a
// abrir. Ahora reabrir SIEMPRE crea una fila nueva en cash_sessions con
// opened_at = now() (ver reopenCashSession en session-actions.ts), y
// caja_cierres.estado nunca vuelve a 'reabierta' — queda como snapshot
// histórico inmutable, reopened_at/reopened_by son auditoría, no estado.
export type OpenCajaPeriod = {
  // Instante EXACTO desde el que cuentan los pagos/movimientos de este
  // período — el opened_at real de la cash_session abierta si la hay
  // (incluye el caso "reabierta hoy mismo", para no volver a contar lo
  // que ya quedó en el snapshot del cierre anterior), o la medianoche de
  // rangeStartDate en caso contrario (operación implícita, sin reapertura
  // de por medio — mismo comportamiento de siempre para el día a día).
  startAt: Date;
  // Fecha (YYYY-MM-DD) de este período — cajaDateKey(startAt). Es la
  // fecha que corresponde escribir/leer en caja_cierres.fecha al cerrar.
  rangeStartDate: string;
  // null = hoy, sin backlog (muestra "Caja de hoy" normal). No-null =
  // viene de un día anterior sin cerrar (dispara el banner "Caja
  // vencida"). Una reapertura del mismo día NO es "vencida".
  pendingCierre: PendingCierre | null;
  // Id de la cash_session abierta actualmente (para poder cerrarla al
  // hacer "Cerrar caja") — null si es operación implícita, sin sesión.
  openSessionId: string | null;
};

export async function cajaOpenRangeStartDate(
  businessId: string | null,
  branchId: string | null,
): Promise<OpenCajaPeriod> {
  const today = cajaDateKey();
  const todayStart = () => ({
    startAt: new Date(`${today}T00:00:00`),
    rangeStartDate: today,
    pendingCierre: null,
    openSessionId: null,
  });
  if (!businessId) return todayStart();

  // 1. ¿Hay una cash_session EXPLÍCITAMENTE abierta (reapertura)? Es la
  // única fuente de "desde cuándo" cuando hubo una reapertura real —
  // nunca se infiere de caja_cierres.
  let sessionQuery = supabase
    .from("cash_sessions" as any)
    .select("id,opened_at")
    .eq("business_id", businessId)
    .eq("status", "open");
  if (branchId) sessionQuery = sessionQuery.eq("branch_id", branchId);
  const { data: openSession } = await sessionQuery
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if ((openSession as any)?.opened_at) {
    const startAt = new Date((openSession as any).opened_at as string);
    const dateKey = cajaDateKey(startAt);
    return {
      startAt,
      rangeStartDate: dateKey,
      pendingCierre: dateKey < today ? { date: dateKey, cierreId: null } : null,
      openSessionId: (openSession as any).id as string,
    };
  }

  // 2. Sin sesión explícita: ¿ayer quedó sin cerrar y con actividad real?
  // (operación implícita, nadie reabrió nada a mano — mismo criterio de
  // siempre, nunca cierra nada sola, solo detecta el backlog).
  const yesterday = cajaDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  let yesterdayQuery = supabase
    .from("caja_cierres" as any)
    .select("id,estado")
    .eq("business_id", businessId)
    .eq("fecha", yesterday);
  if (branchId) yesterdayQuery = yesterdayQuery.eq("branch_id", branchId);
  const { data: yesterdayCierre } = await yesterdayQuery.maybeSingle();
  if (!isCajaCerradaRow(yesterdayCierre)) {
    const snapshot = await buildCierreSnapshotForDate(businessId, yesterday, branchId);
    if (snapshot.hadActivity) {
      return {
        startAt: new Date(`${yesterday}T00:00:00`),
        rangeStartDate: yesterday,
        pendingCierre: { date: yesterday, cierreId: (yesterdayCierre as any)?.id ?? null },
        openSessionId: null,
      };
    }
  }

  // 3. Caso normal: hoy, desde medianoche — sin sesión, sin backlog.
  return todayStart();
}

// Wrapper de conveniencia para el único consumidor que solo necesita el
// backlog (banner "Caja vencida"), no el período completo.
export async function findPendingCierre(
  businessId: string | null,
  branchId: string | null,
): Promise<PendingCierre | null> {
  const period = await cajaOpenRangeStartDate(businessId, branchId);
  return period.pendingCierre;
}

// Snapshot financiero de un rango [dateStr 00:00, endDate] — por defecto un
// solo día calendario (si no se pasa endDate, termina a las 23:59:59.999 de
// ESE MISMO dateStr), pero admite un endDate posterior para abarcar varios
// días: es lo que necesita cerrar una "Caja vencida" que viene acumulando
// movimientos desde un día anterior hasta el momento real del cierre (ver
// closeCierreForDate). Se usa tanto para armar el registro de un cierre
// (automático o de "Caja vencida") como para detectar si un día tuvo
// actividad (findPendingCierre) — mismo formato exacto que un cierre
// manual, para que el detalle del historial funcione igual sea cual sea el
// tipo de cierre.
export async function buildCierreSnapshotForDate(
  businessId: string,
  dateStr: string,
  branchId?: string | null,
  endDate?: Date,
) {
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = endDate ?? new Date(`${dateStr}T23:59:59.999`);
  const endDateStr = cajaDateKey(dayEnd);

  // branch_id = null nunca se excluye (.or en vez de .eq) — mismo criterio
  // que use-caja-data.ts: un cobro/gasto real con branch_id null (fila
  // vieja o nacida antes de que activeBranchId resolviera) no puede faltar
  // del cierre del día.
  const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

  let payQuery = supabase
    .from("payments")
    .select(
      "id,total,amount,method,payment_method,client_name,service_name,created_at,employee_id,charged_by,charge_type",
    )
    .eq("business_id", businessId)
    .gte("created_at", dayStart.toISOString())
    .lte("created_at", dayEnd.toISOString());
  if (branchFilter) payQuery = payQuery.or(branchFilter);

  // expenses.date es solo fecha (sin hora) — con endDate > dateStr (caja
  // vencida que cruzó medianoche) el rango cubre todos los días
  // intermedios, no solo el de apertura.
  let expQuery = supabase
    .from("expenses")
    .select("id,name,amount,type,category,payment_method,date,note,created_at,user_name,created_by")
    .eq("business_id", businessId)
    .gte("date", dateStr)
    .lte("date", endDateStr);
  if (branchFilter) expQuery = expQuery.or(branchFilter);

  const [payRes, expRes] = await Promise.allSettled([payQuery, expQuery]);

  const payments =
    payRes.status === "fulfilled" && !payRes.value.error ? ((payRes.value.data ?? []) as any[]) : [];
  const expenses =
    expRes.status === "fulfilled" && !expRes.value.error ? ((expRes.value.data ?? []) as any[]) : [];

  const totalCobrado = payments.reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
  const totalGastos = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const utilidad = totalCobrado - totalGastos;

  const detalleMetodos: Record<string, CierreMetodoDetalle> = {};
  const ensure = (method: string | null | undefined) => {
    const key = normalizeCierreMethodKey(method);
    if (!detalleMetodos[key]) detalleMetodos[key] = { ingresos: 0, gastos: 0, utilidad: 0 };
    return detalleMetodos[key];
  };
  for (const p of payments) {
    ensure(p.method ?? p.payment_method).ingresos += Number(p.total ?? p.amount ?? 0);
  }
  for (const e of expenses) {
    ensure(e.payment_method ?? e.method).gastos += Number(e.amount ?? 0);
  }
  Object.values(detalleMetodos).forEach((row) => {
    row.utilidad = row.ingresos - row.gastos;
  });

  const cobrosSnapshot = payments.map((p) => ({
    id: p.id,
    hora: p.created_at
      ? new Date(p.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
      : null,
    cliente: p.client_name ?? null,
    profesional: p.employee_name ?? p.professional_name ?? null,
    servicio: p.service_name ?? null,
    metodo: p.method ?? p.payment_method ?? null,
    monto: Number(p.total ?? p.amount ?? 0),
    usuario: p.charged_by ?? p.created_by ?? null,
  }));

  const gastosSnapshot = expenses.map((e) => ({
    id: e.id,
    hora: e.created_at
      ? new Date(e.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
      : null,
    nombre: e.name ?? e.concept ?? e.category ?? "Gasto",
    tipo: e.type ?? e.category ?? null,
    metodo: e.payment_method ?? e.method ?? null,
    monto: Number(e.amount ?? 0),
    nota: e.note ?? null,
    usuario: e.user_name ?? e.created_by ?? null,
  }));

  // Pendientes no tienen una fecha de "creado ese día" reconstruible con
  // precisión (no hay columna de fecha en la cola de Pendientes, ver
  // useCajaData) — este snapshot es del estado ACTUAL al momento del
  // cierre, no una reconstrucción histórica exacta de cómo estaba a
  // medianoche.
  let apptQuery = supabase
    .from("appointments")
    .select("id,client_name,service_name,service_price,starts_at,notes,status")
    .eq("business_id", businessId)
    .ilike("notes", "%[PENDIENTE_CAJA]%")
    .not("status", "in", "(charged,cancelled,blocked)");
  if (branchFilter) apptQuery = apptQuery.or(branchFilter);

  const [apptRes, bsRes] = await Promise.allSettled([
    apptQuery,
    supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle(),
  ]);
  const pendingAppts = apptRes.status === "fulfilled" && !apptRes.value.error ? ((apptRes.value.data ?? []) as any[]) : [];
  const bsSchedule = (bsRes.status === "fulfilled" && !bsRes.value.error ? (bsRes.value.data?.schedule ?? {}) : {}) as Record<string, unknown>;
  const walkInPending = (Array.isArray(bsSchedule._pendingWalkInSales) ? (bsSchedule._pendingWalkInSales as any[]) : [])
    .filter((w) => w.status !== "rechazado");

  const pendientesDetalle = [
    ...pendingAppts.map((a) => ({
      id: a.id,
      cliente: a.client_name ?? null,
      servicio: a.service_name ?? null,
      monto: Number(a.service_price ?? 0),
      hora_envio: a.starts_at ? new Date(a.starts_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : null,
    })),
    ...walkInPending.map((w) => ({
      id: w.id,
      cliente: w.client_name ?? null,
      servicio: w.service_name ?? null,
      monto: Number(w.service_price ?? 0),
      hora_envio: w.starts_at ? new Date(w.starts_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : null,
    })),
  ];
  const pendientesMonto = pendientesDetalle.reduce((s, p) => s + p.monto, 0);

  return {
    totalCobrado,
    totalGastos,
    utilidad,
    detalleMetodos,
    cobrosSnapshot,
    gastosSnapshot,
    cantidadCobros: payments.length,
    hadActivity: payments.length > 0 || expenses.length > 0,
    pendientesCount: pendientesDetalle.length,
    pendientesMonto,
    pendientesDetalle,
  };
}

export type ExpectedCashDigital = {
  cashExpected: number;
  cashOutflows: number;
  digitalExpected: number;
  digitalOutflows: number;
};

// "Efectivo esperado en caja" / "Dinero esperado en cuenta" — una sola
// fuente de verdad para Inicio (CajaHoyCard) y Cierre de caja, para que
// nunca muestren números distintos. Efectivo = cobros en efectivo + lo
// ingresado a mano (cash_movements) − gastos/adelantos pagados en efectivo
// − lo retirado a mano. Digital = cobros no-efectivo − gastos/adelantos
// pagados por métodos no-efectivo. Las comisiones pendientes de liquidar
// NUNCA entran acá: solo salen de caja cuando efectivamente se pagan (como
// "adelanto" o gasto), no mientras siguen pendientes.
export function computeExpectedCashAndDigital(params: {
  payments: Array<{
    total?: number | null;
    amount?: number | null;
    method?: string | null;
    payment_method?: string | null;
  }>;
  expenses: Array<{ amount?: number | null; payment_method?: string | null; method?: string | null }>;
  advances: Array<{ amount?: number | null; payment_method?: string | null }>;
  // method: "efectivo" (cajón físico) | "cuenta" (digital) — filas viejas,
  // de antes de que cash_movements tuviera esta columna, no traen method;
  // se tratan como "efectivo" (mismo comportamiento que tenían).
  cashMovements: Array<{ type: "ingreso" | "retiro"; amount: number | null; method?: string | null }>;
}): ExpectedCashDigital {
  const { payments, expenses, advances, cashMovements } = params;
  const isCash = (m: string | null | undefined) => normalizeCierreMethodKey(m) === "cash";
  const isCashMovement = (m: { method?: string | null }) => !m.method || isCash(m.method);

  const cashPayments = payments
    .filter((p) => isCash(p.method ?? p.payment_method))
    .reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
  const digitalPayments = payments
    .filter((p) => !isCash(p.method ?? p.payment_method))
    .reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);

  const cashExpenses = expenses
    .filter((e) => isCash(e.payment_method ?? e.method))
    .reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const digitalExpenses = expenses
    .filter((e) => !isCash(e.payment_method ?? e.method))
    .reduce((s, e) => s + Number(e.amount ?? 0), 0);

  const cashAdvances = advances
    .filter((a) => isCash(a.payment_method))
    .reduce((s, a) => s + Number(a.amount ?? 0), 0);
  const digitalAdvances = advances
    .filter((a) => !isCash(a.payment_method))
    .reduce((s, a) => s + Number(a.amount ?? 0), 0);

  const ingresosCajaEfectivo = cashMovements
    .filter((m) => m.type === "ingreso" && isCashMovement(m))
    .reduce((s, m) => s + Number(m.amount ?? 0), 0);
  const retirosCajaEfectivo = cashMovements
    .filter((m) => m.type === "retiro" && isCashMovement(m))
    .reduce((s, m) => s + Number(m.amount ?? 0), 0);
  const ingresosCajaDigital = cashMovements
    .filter((m) => m.type === "ingreso" && !isCashMovement(m))
    .reduce((s, m) => s + Number(m.amount ?? 0), 0);
  const retirosCajaDigital = cashMovements
    .filter((m) => m.type === "retiro" && !isCashMovement(m))
    .reduce((s, m) => s + Number(m.amount ?? 0), 0);

  const cashOutflows = cashExpenses + cashAdvances + retirosCajaEfectivo;
  const digitalOutflows = digitalExpenses + digitalAdvances + retirosCajaDigital;

  return {
    cashExpected: cashPayments + ingresosCajaEfectivo - cashOutflows,
    cashOutflows,
    digitalExpected: digitalPayments + ingresosCajaDigital - digitalOutflows,
    digitalOutflows,
  };
}

// "Dinero en cuenta" no se resetea en cada cierre — a diferencia del
// efectivo (que se cuenta físico y arranca de nuevo), el saldo esperado de
// HOY arranca de lo que quedó registrado en el último cierre ya cerrado
// (su dinero_cuenta_real si el usuario lo cargó, o su _esperado si no) y
// desde ahí se le suma el movimiento digital del período actual
// (computeExpectedCashAndDigital().digitalExpected). Sin cierres previos,
// arranca en 0.
export async function getDigitalCarryForward(
  businessId: string | null,
  branchId: string | null,
): Promise<number> {
  if (!businessId) return 0;
  let query = supabase
    .from("caja_cierres" as any)
    .select("dinero_cuenta_real,dinero_cuenta_esperado")
    .eq("business_id", businessId)
    .eq("estado", "cerrada");
  if (branchId) query = query.eq("branch_id", branchId);
  const { data, error } = await query
    .order("fecha", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return 0;
  const row = data as any;
  return Number(row.dinero_cuenta_real ?? row.dinero_cuenta_esperado ?? 0);
}

// "Caja abierta desde" — fecha + hora de apertura de la fila de
// caja_cierres más reciente (abierta o no), para el acceso directo a
// "Cerrar caja" desde Facturación. Mismo criterio de "apertura real" que
// usa CierresTab (excluye "reapertura" del pool de candidatos — una
// reapertura nunca pisa la hora de apertura original del día).
export async function getCajaAbiertaDesde(
  businessId: string | null,
  branchId: string | null,
): Promise<{ fecha: string; hora: string } | null> {
  if (!businessId) return null;
  // Misma fuente que el rango de pagos/movimientos (cajaOpenRangeStartDate)
  // — "caja abierta desde" tiene que decir exactamente desde cuándo se
  // están contando los números que se ven al lado, nunca un dato leído por
  // separado de caja_cierres (esa tabla es historial, no el período vigente).
  const period = await cajaOpenRangeStartDate(businessId, branchId);
  return {
    fecha: period.rangeStartDate,
    hora: cajaTimeLabel(period.startAt),
  };
}

// Cierra explícitamente un día puntual (hoy o un día vencido) — acción
// siempre disparada por un click real del usuario, nunca sola.
export async function closeCierreForDate({
  businessId,
  branchId,
  dateStr,
  closedBy,
  mode,
}: {
  businessId: string;
  branchId: string | null;
  dateStr: string;
  closedBy: string;
  mode: "manual" | "automatico";
}) {
  let existingQuery = supabase
    .from("caja_cierres" as any)
    .select("id,eventos,estado")
    .eq("business_id", businessId)
    .eq("fecha", dateStr);
  if (branchId) existingQuery = existingQuery.eq("branch_id", branchId);
  const { data: existingCierre, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) throw existingError;

  // "Ya está cerrada" se decide por el ÚLTIMO evento, no por `estado` —
  // estado se queda en 'cerrada' para siempre una vez cerrada (nunca
  // vuelve a 'reabierta'), así que un segundo cierre del mismo `dateStr`
  // (cerrar → reabrir → cobrar → cerrar, mismo día) tiene que poder
  // agregar su propio evento de cierre a la misma fila.
  const existingEvents = cajaEventosArray((existingCierre as any)?.eventos);
  const lastExistingEvent = existingEvents[existingEvents.length - 1];
  if (lastExistingEvent?.tipo === "cierre") {
    return { closed: false, alreadyClosed: true };
  }

  // endDate = "ahora", nunca el fin del día de apertura: una caja vencida
  // sigue acumulando movimientos (de ese día y de los que pasaron después,
  // ver cajaOpenRangeStartDate) hasta este mismo instante del cierre — el
  // snapshot tiene que incluir todo eso, no solo lo que pasó el día que se
  // abrió.
  const now = new Date();
  const snapshot = await buildCierreSnapshotForDate(businessId, dateStr, branchId, now);
  const evento: CajaEvento = {
    tipo: "cierre",
    modo: mode,
    fecha_hora: now.toISOString(),
    hora: mode === "automatico" ? "00:00hs" : cajaTimeLabel(now),
    usuario: closedBy,
    observacion: mode === "automatico" ? "Cierre automático de fin de día." : "Cierre de caja vencida.",
    pendientes_count: snapshot.pendientesCount,
    pendientes_monto: snapshot.pendientesMonto,
    pendientes_detalle: snapshot.pendientesDetalle,
  };
  const payload = {
    business_id: businessId,
    branch_id: branchId,
    fecha: dateStr,
    hora_cierre: evento.hora,
    usuario_nombre: closedBy,
    closed_by: closedBy,
    tipo_cierre: mode,
    estado: "cerrada",
    observacion: evento.observacion,
    total_cobrado: snapshot.totalCobrado,
    total_gastos: snapshot.totalGastos,
    utilidad: snapshot.utilidad,
    cantidad_cobros: snapshot.cantidadCobros,
    detalle_metodos_pago: snapshot.detalleMetodos,
    cobros_snapshot: snapshot.cobrosSnapshot,
    gastos_snapshot: snapshot.gastosSnapshot,
    eventos: appendCajaEvento((existingCierre as any)?.eventos, evento),
    updated_at: now.toISOString(),
  };

  // Sin .neq("estado","cerrada") acá a propósito — mismo motivo que
  // CierreCajaBtn.confirmar() en cash-register.tsx: esa guarda bloquearía
  // cualquier segundo cierre del mismo dateStr. El chequeo real ya se hizo
  // arriba, mirando el último evento.
  const query = (existingCierre as any)?.id
    ? supabase
        .from("caja_cierres" as any)
        .update(payload)
        .eq("id", (existingCierre as any).id)
        .eq("business_id", businessId)
        .select("id")
        .maybeSingle()
    : supabase.from("caja_cierres" as any).insert(payload).select("id").maybeSingle();

  const { data: saved, error: saveError } = await query;
  if (saveError) throw saveError;
  if (saved?.id) {
    // Cerrar también la cash_session vigente (si la hay) — caja_cierres
    // queda como snapshot, pero el período operativo real vive en
    // cash_sessions; sin esto, una sesión abierta por una reapertura
    // seguiría devolviendo su mismo opened_at viejo como "período actual"
    // después de este cierre.
    await closeOpenCajaSession(businessId, branchId);
    window.dispatchEvent(new CustomEvent("clippr:caja-cierre-guardado"));
    return { closed: true };
  }

  return { closed: false };
}

// Cierra (status='closed', closed_at=now()) la cash_session abierta de
// este negocio/sucursal, si la hay — best-effort, nunca rompe el cierre
// de caja_cierres si esto falla (ej. tabla sin la migración de índice
// único todavía, o sin sesión explícita abierta, que es el caso normal
// del día a día sin reapertura de por medio). Exportada: también la usa
// CierreCajaBtn.confirmar() (cash-register.tsx) en el cierre manual de hoy.
export async function closeOpenCajaSession(businessId: string, branchId: string | null): Promise<void> {
  try {
    let q = supabase
      .from("cash_sessions" as any)
      .select("id")
      .eq("business_id", businessId)
      .eq("status", "open");
    if (branchId) q = q.eq("branch_id", branchId);
    const { data: openSession } = await q.order("opened_at", { ascending: false }).limit(1).maybeSingle();
    if ((openSession as any)?.id) {
      await supabase
        .from("cash_sessions" as any)
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("id", (openSession as any).id);
    }
  } catch {
    /* best-effort — caja_cierres ya quedó guardado, que es lo que importa */
  }
}
