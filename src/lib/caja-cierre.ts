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

// Cantidad de servicios/productos de un cierre a partir de
// cobros_snapshot[].items (ver buildCierreSnapshotForDate). Un cobro sin
// items (cierre guardado antes de este enriquecimiento) cuenta como 1
// servicio — nunca se inventa un producto que no se sabe si existió.
export function countServiciosYProductos(
  cobrosSnapshot: Array<{ items?: Array<{ esProducto?: boolean }> | null }> | null | undefined,
): { servicios: number; productos: number } {
  let servicios = 0;
  let productos = 0;
  for (const p of cobrosSnapshot ?? []) {
    const items = Array.isArray(p?.items) ? p.items : null;
    if (items && items.length > 0) {
      servicios += items.filter((it) => !it?.esProducto).length;
      productos += items.filter((it) => it?.esProducto).length;
    } else {
      servicios += 1;
    }
  }
  return { servicios, productos };
}

// Fila de producto "aplanada" a nivel de ítem (ver splitServiciosYProductos)
// — un mismo cobro con 1 servicio + 2 productos aporta 1 fila a
// "servicios" (el cobro entero, con su monto real) y 2 filas a
// "productos" (una por ítem, con el monto de ESE ítem, nunca el del
// cobro completo — evita que "Productos" duplique el ingreso ya contado
// en "Servicios").
export type CajaCobroSnapshot = {
  id?: string | null;
  items?: Array<{ nombre?: string | null; cantidad?: number; monto?: number; esProducto?: boolean }> | null;
  [key: string]: unknown;
};

export type CajaProductoRow = {
  key: string;
  hora: unknown;
  cliente: unknown;
  profesional: unknown;
  usuario: unknown;
  nombre: string | null;
  cantidad: number;
  monto: number;
};

// Clasifica cobros_snapshot en "Servicios" (filtro Historial → Detalle →
// Servicios: el cobro completo, un cobro con items vacíos cuenta como 1
// servicio) y "Productos" (filtro → Productos: un ítem marcado
// esProducto, a nivel de línea). Un cobro mixto (servicio + producto)
// aparece en AMBAS listas — eso es intencional y no duplica ingresos: el
// total de la caja siempre se suma una sola vez, iterando cobros_snapshot
// directamente, nunca estas dos listas derivadas.
export function splitServiciosYProductos(
  cobrosSnapshot: CajaCobroSnapshot[] | null | undefined,
): { servicios: CajaCobroSnapshot[]; productos: CajaProductoRow[] } {
  const cobros = cobrosSnapshot ?? [];
  const servicios = cobros.filter((p) => {
    const items = Array.isArray(p.items) ? p.items : [];
    return items.length === 0 || items.some((it) => !it?.esProducto);
  });
  const productos: CajaProductoRow[] = cobros.flatMap((p, pIdx) =>
    (Array.isArray(p.items) ? p.items : [])
      .filter((it) => it?.esProducto)
      .map((it, idx) => ({
        key: `${p.id ?? pIdx}-${idx}`,
        hora: (p as any).hora,
        cliente: (p as any).cliente,
        profesional: (p as any).profesional,
        usuario: (p as any).usuario,
        nombre: it.nombre ?? null,
        cantidad: Number(it.cantidad ?? 1),
        monto: Number(it.monto ?? 0),
      })),
  );
  return { servicios, productos };
}

export function cajaDateKey(date = new Date()) {
  return date.toLocaleDateString("sv-SE");
}

const BUENOS_AIRES_TZ = "America/Argentina/Buenos_Aires";

// Fecha YYYY-MM-DD de un instante en huso horario de Buenos Aires,
// explícito — a diferencia de cajaDateKey (que usa el huso horario LOCAL
// del entorno donde corre el código), esto da el mismo resultado sin
// importar si el proceso corre en el navegador del usuario o en un
// servidor con otro huso horario. Argentina no tiene horario de verano
// desde 2009 (-03:00 fijo), así que un offset fijo es seguro.
export function cajaDateKeyBA(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUENOS_AIRES_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Límites [00:00:00.000, 23:59:59.999] de un día calendario de Buenos
// Aires, como instantes reales (Date/timestamptz) — nunca se parsea
// "YYYY-MM-DDTHH:mm:ss" sin offset (eso lo interpreta el huso horario
// LOCAL del proceso, no el de Buenos Aires).
export function dayBoundsBA(dateStr: string): { start: Date; end: Date } {
  return {
    start: new Date(`${dateStr}T00:00:00.000-03:00`),
    end: new Date(`${dateStr}T23:59:59.999-03:00`),
  };
}

// Acota filas con un timestamp (ej. payments.created_at) a UN solo día
// calendario de Buenos Aires — "Ingresos"/"Gastos" son una métrica DIARIA,
// nunca el saldo acumulado desde el último cierre (ESE es el rol de
// cashExpected/digitalExpected vía computeExpectedCashAndDigital, que a
// propósito NO pasa por este filtro: el efectivo/cuenta pendiente de
// cierre tiene que seguir incluyendo todo el backlog sin cerrar).
export function filterToDayBA<T>(
  rows: T[],
  getIso: (row: T) => string | null | undefined,
  dateStr: string = cajaDateKeyBA(),
): T[] {
  const { start, end } = dayBoundsBA(dateStr);
  const startMs = start.getTime();
  const endMs = end.getTime();
  return rows.filter((row) => {
    const iso = getIso(row);
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= startMs && t <= endMs;
  });
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

// Snapshot financiero de UN día calendario [dateStr 00:00, dateStr
// 23:59:59.999] — nunca se extiende a otro día. Se usa tanto para armar el
// registro de un cierre manual (ver closeSingleDayCierre/
// buildSingleDayCierrePreview) como para detectar si un día tuvo actividad
// (findPendingCierre) — mismo formato exacto en los dos casos, para que el
// detalle del historial funcione igual sea cual sea el origen del cierre.
export async function buildCierreSnapshotForDate(
  businessId: string,
  dateStr: string,
  branchId?: string | null,
) {
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999`);
  const endDateStr = cajaDateKey(dayEnd);

  // branch_id = null nunca se excluye (.or en vez de .eq) — mismo criterio
  // que use-caja-data.ts: un cobro/gasto real con branch_id null (fila
  // vieja o nacida antes de que activeBranchId resolviera) no puede faltar
  // del cierre del día.
  const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

  let payQuery = supabase
    .from("payments")
    .select(
      "id,total,amount,method,payment_method,client_name,service_name,created_at,employee_id,charged_by,charge_type,items,original_amount,discount,discount_type,discount_value,promotion_name,tip,tip_amount",
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

  // Nombres reales para "profesional" y "usuario que cobró" — nunca un
  // UUID crudo en el detalle de un cierre. employees.id → nombre del
  // profesional; profiles.id (lo que guarda payments.charged_by/
  // expenses.created_by) → nombre de quien hizo el movimiento.
  const employeesQuery = supabase.from("employees").select("id,full_name").eq("business_id", businessId);
  const profilesQuery = supabase.from("profiles").select("id,full_name").eq("business_id", businessId);

  const [payRes, expRes, employeesRes, profilesRes] = await Promise.allSettled([
    payQuery,
    expQuery,
    employeesQuery,
    profilesQuery,
  ]);

  const payments =
    payRes.status === "fulfilled" && !payRes.value.error ? ((payRes.value.data ?? []) as any[]) : [];
  const expenses =
    expRes.status === "fulfilled" && !expRes.value.error ? ((expRes.value.data ?? []) as any[]) : [];
  const employeeNameById = new Map<string, string>(
    (employeesRes.status === "fulfilled" && !employeesRes.value.error
      ? ((employeesRes.value.data ?? []) as any[])
      : []
    ).map((e) => [e.id, e.full_name as string]),
  );
  const profileNameById = new Map<string, string>(
    (profilesRes.status === "fulfilled" && !profilesRes.value.error
      ? ((profilesRes.value.data ?? []) as any[])
      : []
    ).map((p) => [p.id, p.full_name as string]),
  );
  const resolveUsuario = (rawId: string | null | undefined) => {
    if (!rawId) return null;
    return profileNameById.get(rawId) ?? rawId;
  };

  // totalCobrado: pura facturación por servicios/productos, SIN propina —
  // la propina es plata del profesional, nunca del negocio (mismo
  // criterio que registerPayment/closeoutByMethod). totalPropinas/
  // totalRecibido son los que sí la incluyen, para "dinero realmente
  // recibido" (efectivo esperado, dinero en cuenta esperado, Resumen del
  // cierre) sin mezclarla con "Ingresos"/facturación.
  const totalCobrado = payments.reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
  const totalPropinas = payments.reduce((s, p) => s + Number(p.tip_amount ?? p.tip ?? 0), 0);
  const totalRecibido = totalCobrado + totalPropinas;
  const totalGastos = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const utilidad = totalCobrado - totalGastos;

  const detalleMetodos: Record<string, CierreMetodoDetalle> = {};
  // detalleMetodosRecibido: mismo agrupamiento por método, pero suma
  // cobro + propina — "money actually received by that method", para las
  // tarjetas de Efectivo/Transferencia/Débito/Crédito/QR del detalle del
  // cierre. detalleMetodos (sin propina) sigue siendo el que usan los
  // reportes de facturación/Ingresos, sin tocarlo.
  const detalleMetodosRecibido: Record<string, CierreMetodoDetalle> = {};
  const ensure = (method: string | null | undefined) => {
    const key = normalizeCierreMethodKey(method);
    if (!detalleMetodos[key]) detalleMetodos[key] = { ingresos: 0, gastos: 0, utilidad: 0 };
    return detalleMetodos[key];
  };
  const ensureRecibido = (method: string | null | undefined) => {
    const key = normalizeCierreMethodKey(method);
    if (!detalleMetodosRecibido[key]) detalleMetodosRecibido[key] = { ingresos: 0, gastos: 0, utilidad: 0 };
    return detalleMetodosRecibido[key];
  };
  for (const p of payments) {
    const monto = Number(p.total ?? p.amount ?? 0);
    const propina = Number(p.tip_amount ?? p.tip ?? 0);
    ensure(p.method ?? p.payment_method).ingresos += monto;
    // La propina usa el MISMO método que el cobro — payments no guarda un
    // medio separado para ella, y es el medio por el que realmente entró.
    ensureRecibido(p.method ?? p.payment_method).ingresos += monto + propina;
  }
  for (const e of expenses) {
    ensure(e.payment_method ?? e.method).gastos += Number(e.amount ?? 0);
    ensureRecibido(e.payment_method ?? e.method).gastos += Number(e.amount ?? 0);
  }
  Object.values(detalleMetodos).forEach((row) => {
    row.utilidad = row.ingresos - row.gastos;
  });
  Object.values(detalleMetodosRecibido).forEach((row) => {
    row.utilidad = row.ingresos - row.gastos;
  });

  const cobrosSnapshot = payments.map((p) => {
    const monto = Number(p.total ?? p.amount ?? 0);
    // precio_lista: original_amount (precio de lista antes de promo/
    // descuento) cuando existe; si no, el monto cobrado es también el
    // precio de lista (no hubo descuento que reconstruir).
    const precioLista = p.original_amount != null ? Number(p.original_amount) : monto;
    const descuento = Math.max(0, precioLista - monto);
    return {
      id: p.id,
      fecha_hora: p.created_at ?? null,
      hora: p.created_at
        ? new Date(p.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
        : null,
      cliente: p.client_name ?? null,
      profesional: employeeNameById.get(p.employee_id) ?? null,
      servicio: p.service_name ?? null,
      // Varios servicios/productos en un mismo cobro (payments.items) se
      // listan acá individualmente — el cobro sigue contándose una sola
      // vez en "monto" (nunca se suma items[].amount aparte de total).
      items: Array.isArray(p.items)
        ? p.items.map((it: any) => ({
            nombre: it?.name ?? null,
            cantidad: Number(it?.qty ?? 1),
            monto: Number(it?.amount ?? 0),
            esProducto: Boolean(it?.is_catalog),
          }))
        : [],
      metodo: p.method ?? p.payment_method ?? null,
      monto,
      precio_lista: precioLista,
      descuento,
      promocion: p.promotion_name ?? null,
      propina: Number(p.tip_amount ?? p.tip ?? 0),
      usuario: resolveUsuario(p.charged_by),
    };
  });

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
    usuario: e.user_name ?? resolveUsuario(e.created_by) ?? null,
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
    totalPropinas,
    totalRecibido,
    totalGastos,
    utilidad,
    detalleMetodos,
    detalleMetodosRecibido,
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
  // Ingresos manuales en efectivo (cash_movements tipo "ingreso") del
  // período — ya estaba sumado dentro de cashExpected, pero no se exponía
  // por separado; el modal de Cierre de caja lo necesita para mostrar
  // "Ingresos de efectivo" junto a "Salidas de efectivo" sin recalcular
  // nada nuevo.
  cashInflows: number;
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
    // Propina del cobro — plata real que entra a la caja/cuenta junto con
    // el cobro, por el MISMO medio (payments no guarda un medio aparte
    // para la propina). Nunca forma parte de total/amount (eso sigue
    // siendo pura facturación, ver registerPayment) — pero el efectivo/
    // cuenta esperados SÍ tienen que incluirla, o un cliente que paga
    // $20.000 + $2.000 de propina en efectivo deja $22.000 reales en el
    // cajón que "efectivo esperado" nunca contaba, apareciendo como un
    // "sobrante" ficticio al hacer el recuento físico.
    tip?: number | null;
    tip_amount?: number | null;
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
  // Cobro + propina, nunca por separado — así ningún llamador puede sumar
  // una sin la otra ni duplicarla contándola dos veces en el mismo total.
  const receivedAmount = (p: { total?: number | null; amount?: number | null; tip?: number | null; tip_amount?: number | null }) =>
    Number(p.total ?? p.amount ?? 0) + Number(p.tip_amount ?? p.tip ?? 0);

  const cashPayments = payments
    .filter((p) => isCash(p.method ?? p.payment_method))
    .reduce((s, p) => s + receivedAmount(p), 0);
  const digitalPayments = payments
    .filter((p) => !isCash(p.method ?? p.payment_method))
    .reduce((s, p) => s + receivedAmount(p), 0);

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
    cashInflows: ingresosCajaEfectivo,
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

export type CajaMovimientoManual = {
  id: string;
  tipo: "ingreso" | "retiro";
  hora: string | null;
  monto: number;
  metodo: string | null;
  nota: string | null;
  usuario: string | null;
};

// Retiros/ingresos manuales de caja (cash_movements) de UN día calendario
// — a diferencia de expenses (gastos con concepto/categoría), esto es
// dinero que se sacó o se metió a mano al cajón/cuenta sin un gasto
// asociado. Nunca se guardó dentro de cobros_snapshot/gastos_snapshot de
// ningún cierre (ni los viejos ni los nuevos) — "Ver detalles" siempre lo
// lee en vivo, acotado al mismo día exacto que el resto del detalle.
export async function buildCajaMovimientosManualesForDate(
  businessId: string,
  branchId: string | null,
  dateStr: string,
): Promise<CajaMovimientoManual[]> {
  const { start, end } = dayBoundsBA(dateStr);
  const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

  let movQuery = supabase
    .from("cash_movements" as any)
    .select("id,type,amount,method,note,created_by,created_at")
    .eq("business_id", businessId)
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());
  if (branchFilter) movQuery = movQuery.or(branchFilter);

  const [movRes, profilesRes] = await Promise.allSettled([
    movQuery,
    supabase.from("profiles").select("id,full_name").eq("business_id", businessId),
  ]);
  const rows = movRes.status === "fulfilled" && !movRes.value.error ? ((movRes.value.data ?? []) as any[]) : [];
  const profileNameById = new Map<string, string>(
    (profilesRes.status === "fulfilled" && !profilesRes.value.error
      ? ((profilesRes.value.data ?? []) as any[])
      : []
    ).map((p) => [p.id, p.full_name as string]),
  );

  return rows.map((m) => ({
    id: m.id,
    tipo: m.type,
    hora: m.created_at
      ? new Date(m.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
      : null,
    monto: Number(m.amount ?? 0),
    metodo: m.method ?? null,
    nota: m.note ?? null,
    usuario: m.created_by ? profileNameById.get(m.created_by) ?? m.created_by : null,
  }));
}

// Vista previa (solo lectura) de lo que incluiría el cierre de UN día
// pasado puntual, acotado exactamente a ese día calendario (00:00 a
// 23:59:59.999 hora Argentina) — nunca "hasta ahora" como
// buildCierreSnapshotForDate recibe por defecto cuando closeCierreForDate
// lo llama para una caja vencida. Pensada para el selector "Cerrar un día
// anterior": el usuario elige una fecha, ve ingresos/efectivo/
// transferencia/gastos/total esperado de ESE día exclusivamente, y recién
// después decide confirmar con closeSingleDayCierre.
export async function buildSingleDayCierrePreview(
  businessId: string,
  branchId: string | null,
  dateStr: string,
) {
  const snapshot = await buildCierreSnapshotForDate(businessId, dateStr, branchId);
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999`);
  const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

  // Adelantos (professional_advances.advanced_at) y movimientos manuales de
  // caja (cash_movements.created_at) del mismo día — necesarios para
  // "Efectivo esperado en caja" / "Dinero esperado en cuenta", misma
  // fórmula que usa el cierre de hoy (computeExpectedCashAndDigital).
  let advQuery = supabase
    .from("professional_advances" as any)
    .select("amount,payment_method,advanced_at")
    .eq("business_id", businessId)
    .gte("advanced_at", dayStart.toISOString())
    .lte("advanced_at", dayEnd.toISOString());
  if (branchFilter) advQuery = advQuery.or(branchFilter);

  let movQuery = supabase
    .from("cash_movements" as any)
    .select("type,amount,method,created_at")
    .eq("business_id", businessId)
    .gte("created_at", dayStart.toISOString())
    .lte("created_at", dayEnd.toISOString());
  if (branchFilter) movQuery = movQuery.or(branchFilter);

  const [advRes, movRes] = await Promise.all([advQuery, movQuery]);
  const advances = ((advRes.data ?? []) as any[]).map((a) => ({
    amount: a.amount,
    payment_method: a.payment_method,
  }));
  const cashMovements = ((movRes.data ?? []) as any[]).map((m) => ({
    type: m.type,
    amount: m.amount,
    method: m.method,
  }));

  const expected = computeExpectedCashAndDigital({
    payments: snapshot.cobrosSnapshot.map((c) => ({ total: c.monto, method: c.metodo, tip: c.propina })),
    expenses: snapshot.gastosSnapshot.map((g) => ({ amount: g.monto, payment_method: g.metodo })),
    advances,
    cashMovements,
  });

  return { snapshot, expected };
}

// Cierra un día PASADO puntual, acotado exactamente a ese día — a
// diferencia de closeCierreForDate (pensado para "caja vencida": un
// backlog sin cortes intermedios que siempre se extiende hasta "ahora"),
// esto nunca mezcla movimientos de otro día, ni antes ni después. Permite
// cerrar el 13/10 sin tocar el 14/10 aunque ninguno de los dos tenga
// todavía una fila en caja_cierres. No toca cash_sessions: esa tabla
// representa el período EN CURSO, nunca un día que ya pasó.
export async function closeSingleDayCierre({
  businessId,
  branchId,
  dateStr,
  closedBy,
  observacion,
  efectivoContado,
  saldoReal,
  tipoCierre = "manual",
}: {
  businessId: string;
  branchId: string | null;
  dateStr: string;
  closedBy: string;
  // Conteo físico/real opcional (mismos campos que el cierre de "hoy" de
  // siempre) — si no se pasan, quedan null y la fila no registra
  // diferencia/ajuste (no se puede inventar un conteo que nadie hizo).
  observacion?: string | null;
  efectivoContado?: number | null;
  saldoReal?: number | null;
  // "historico_regularizado": cierre de un día pasado que nunca se cerró
  // en su momento y se registra ahora, retroactivamente, a partir de los
  // movimientos reales ya existentes — se distingue de "manual" (cerrado
  // el mismo día/poco después, por quien estaba operando la caja) para
  // que el Historial nunca lo confunda con una apertura/cierre real.
  tipoCierre?: "manual" | "historico_regularizado";
}) {
  let existingQuery = supabase
    .from("caja_cierres" as any)
    .select("id,eventos,estado")
    .eq("business_id", businessId)
    .eq("fecha", dateStr);
  if (branchId) existingQuery = existingQuery.eq("branch_id", branchId);
  const { data: existingCierre, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) throw existingError;

  // Mismo criterio que closeCierreForDate: "ya cerrado" se decide por el
  // ÚLTIMO evento, nunca se pisa un cierre que ya existe para ese día —
  // satisface "no permitir cerrar dos veces la misma fecha y sucursal".
  const existingEvents = cajaEventosArray((existingCierre as any)?.eventos);
  const lastExistingEvent = existingEvents[existingEvents.length - 1];
  if (lastExistingEvent?.tipo === "cierre") {
    return { closed: false, alreadyClosed: true };
  }

  const now = new Date();
  // Reutiliza el mismo cálculo (snapshot + efectivo/cuenta esperados) que
  // la vista previa — nunca una segunda fuente de verdad para "qué incluye
  // este cierre". Ya acotado exactamente a dateStr (00:00 a 23:59:59.999
  // hora Buenos Aires), sin extenderse a ningún otro día.
  const { snapshot, expected } = await buildSingleDayCierrePreview(businessId, branchId, dateStr);

  const diferencia = efectivoContado != null ? efectivoContado - expected.cashExpected : null;
  const ajusteCuenta = saldoReal != null ? saldoReal - expected.digitalExpected : null;

  // "efectivo_esperado" y "diferencia" no son columnas reales de
  // caja_cierres (solo efectivo_contado/dinero_cuenta_* lo son) — viajan
  // dentro del propio evento jsonb, mismo criterio que pendientes_count/
  // pendientes_monto/pendientes_detalle, para no inventar columnas que no
  // existen ni arriesgar un ALTER TABLE a ciegas.
  const esRegularizacion = tipoCierre === "historico_regularizado";
  const observacionDefault = esRegularizacion
    ? `Histórico regularizado: cierre del ${dateStr} registrado retroactivamente el ${cajaDateKeyBA(now)} a partir de los movimientos reales de ese día. No hubo apertura ni recuento de efectivo documentados en su momento.`
    : `Cierre manual del ${dateStr}, acotado a ese día.`;
  const evento: CajaEvento = {
    tipo: "cierre",
    modo: esRegularizacion ? "historico_regularizado" : "manual",
    fecha_hora: now.toISOString(),
    hora: cajaTimeLabel(now),
    usuario: closedBy,
    observacion: observacion?.trim() || observacionDefault,
    efectivo_esperado: expected.cashExpected,
    diferencia,
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
    tipo_cierre: tipoCierre,
    estado: "cerrada",
    observacion: evento.observacion,
    total_cobrado: snapshot.totalCobrado,
    total_gastos: snapshot.totalGastos,
    utilidad: snapshot.utilidad,
    cantidad_cobros: snapshot.cantidadCobros,
    detalle_metodos_pago: snapshot.detalleMetodos,
    cobros_snapshot: snapshot.cobrosSnapshot,
    gastos_snapshot: snapshot.gastosSnapshot,
    efectivo_contado: efectivoContado ?? null,
    dinero_cuenta_esperado: expected.digitalExpected,
    dinero_cuenta_real: saldoReal ?? null,
    dinero_cuenta_ajuste: ajusteCuenta,
    eventos: appendCajaEvento((existingCierre as any)?.eventos, evento),
    updated_at: now.toISOString(),
  };

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
    // Solo si se está cerrando el día de HOY (huso Buenos Aires) tiene
    // sentido cerrar también la cash_session en curso — cerrar un día
    // pasado (backlog) nunca debe tocar la sesión de hoy, que sigue
    // abierta y acumulando sus propios movimientos por separado.
    if (dateStr === cajaDateKeyBA()) {
      await closeOpenCajaSession(businessId, branchId);
    }
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
