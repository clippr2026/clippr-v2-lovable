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

// Estados de payments que NUNCA deben contarse como ingreso válido ni
// como dinero disponible en Caja/Cierre — una venta anulada o reembolsada
// sigue existiendo (para trazabilidad en el historial), pero no aportó
// (o dejó de aportar) plata real. Bug real (26/10/2026): varios lugares
// de Caja solo excluían 'pendiente'/'parcial' y se olvidaban de estos dos,
// así que una venta anulada seguía sumando en Ingresos/Dinero en cuenta/
// Movimientos como si siguiera cobrada. Centralizado acá para que no
// vuelva a pasar en un quinto lugar nuevo — cualquier cálculo de Caja que
// sume payments.total/amount tiene que pasar por este chequeo.
export function isVoidedPaymentStatus(status: string | null | undefined): boolean {
  return status === "anulado" || status === "reembolsado";
}

// Un pago NUNCA debe sumar en Caja si está pendiente/parcial (su plata real
// sale de payment_collections, no de total/amount) o si está anulado/
// reembolsado (no aportó plata real). Úsalo en vez de repetir la lista de
// estados a mano en cada cálculo nuevo.
export function isCountableCajaPayment(status: string | null | undefined): boolean {
  return status !== "pendiente" && status !== "parcial" && !isVoidedPaymentStatus(status);
}

// Color de una fila "pago" en el historial unificado de Caja. Una venta
// anulada/reembolsada siempre va en gris (trazabilidad, nunca como ingreso
// activo). Un pago normal con monto negativo (ajuste de un día ya cerrado,
// ver void_payment_authorized/correct_payment_authorized — 26/10/2026)
// tiene que ir en rojo con signo "-", nunca en verde con "+" como si fuera
// plata entrando — antes de esto, cualquier ajuste negativo se mostraba
// igual que un cobro normal.
export type PagoRowColor = "verde" | "rojo" | "gris";

export function pagoRowColor(
  status: string | null | undefined,
  amount: number,
): PagoRowColor {
  if (isVoidedPaymentStatus(status)) return "gris";
  return amount < 0 ? "rojo" : "verde";
}

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
  // payments.id real del cobro padre — un producto no tiene id propio
  // (es una línea DENTRO de un payment), pero hace falta para poder abrir
  // el detalle de ESE cobro al clickear la fila (ver onRowClick,
  // CierreMovimientosDetalleList).
  id: string | null;
  hora: unknown;
  cliente: unknown;
  profesional: unknown;
  usuario: unknown;
  nombre: string | null;
  cantidad: number;
  monto: number;
  // Medio de pago del cobro padre (un producto no tiene medio propio —
  // se cobró junto con lo demás en esa misma venta) — para poder filtrar
  // productos por medio de pago igual que servicios, sin reinterpretar
  // nada: mismo valor que cobrosSnapshot[].metodo/splits de esa venta.
  metodo: string | null;
  splits: PaymentSplitRaw[] | null;
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
        id: (p as any).id ?? null,
        hora: (p as any).hora,
        cliente: (p as any).cliente,
        profesional: (p as any).profesional,
        usuario: (p as any).usuario,
        nombre: it.nombre ?? null,
        cantidad: Number(it.cantidad ?? 1),
        monto: Number(it.monto ?? 0),
        metodo: (p as any).metodo ?? null,
        splits: Array.isArray((p as any).splits) ? ((p as any).splits as PaymentSplitRaw[]) : null,
      })),
  );
  return { servicios, productos };
}

// "Efectivo contado"/"Saldo real en cuenta" (CierreCajaBtn/
// CerrarDiaAnteriorCard) aceptan "150.000" o "150000,50" — separador de
// miles con punto, decimales con coma, como el resto de los inputs de
// money de la app. Input vacío o no numérico → 0, nunca NaN.
export function parseMoneyInput(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", ".")) || 0;
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

export type PaymentSplitRaw = { method?: string | null; amount?: number | null };

export type MethodAmount = { monto: number; propina: number };

// Distribuye UN cobro entre los medios de pago que realmente lo
// cobraron — nunca lo atribuye entero a un solo método si el cliente pagó
// con varios (payments.splits). La propina (sin medio propio en payments)
// se reparte en la MISMA proporción que el monto entre esos medios, así
// la suma de todas las fracciones devueltas da exactamente
// monto + propina, siempre — ninguna rama de este cálculo puede duplicar
// ni perder el importe de la venta.
//
// Si splits no suma lo mismo que `monto` (dato mal cargado — ej. un
// pago múltiple cuyos montos no cerraban), se reparte igual en esa misma
// proporción (splitsSum sigue siendo la base), nunca se "corrige" el
// total: la diferencia real queda disponible aparte (ver
// buildConciliacionAlertas) para que se pueda identificar qué venta la
// generó en vez de taparla en silencio.
export function distributeCobroByMethod(
  monto: number,
  propina: number,
  method: string | null | undefined,
  splits: PaymentSplitRaw[] | null | undefined,
): Record<string, MethodAmount> {
  const result: Record<string, MethodAmount> = {};
  const add = (rawMethod: string | null | undefined, m: number, p: number) => {
    const key = normalizeCierreMethodKey(rawMethod);
    if (!result[key]) result[key] = { monto: 0, propina: 0 };
    result[key].monto += m;
    result[key].propina += p;
  };
  const validSplits = (splits ?? []).filter((s) => Number(s?.amount ?? 0) > 0);
  const splitsSum = validSplits.reduce((s, x) => s + Number(x.amount ?? 0), 0);
  if (validSplits.length > 0 && splitsSum > 0) {
    for (const s of validSplits) {
      const frac = Number(s.amount ?? 0) / splitsSum;
      add(s.method, monto * frac, propina * frac);
    }
  } else {
    add(method, monto, propina);
  }
  return result;
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
  // TODAS las jornadas con actividad sin cerrar, ya resueltas acá mismo
  // (ver findAllPendingCierres, llamado en paralelo con la consulta de
  // sesión abierta) — el caller (useCajaSummary) las reutiliza para el
  // aviso "Tenés N cajas pendientes" en vez de volver a pedir lo mismo
  // una segunda vez (antes se llamaba a findAllPendingCierres DOS veces
  // por cada carga: una acá adentro como fallback, otra en el caller).
  allPendingCierres: PendingCierre[];
};

export async function cajaOpenRangeStartDate(
  businessId: string | null,
  branchId: string | null,
): Promise<OpenCajaPeriod> {
  // "Hoy" es siempre el día calendario de Buenos Aires — nunca el huso
  // horario local del dispositivo/proceso que ejecuta esto. Un admin que
  // abre Clippr desde otro huso horario (o un proceso de servidor en UTC)
  // no puede hacer que la jornada de hoy pase a "pendiente" antes o
  // después de medianoche ART (ver sección "COMPORTAMIENTO AUTOMÁTICO"
  // del pedido: la transición ocurre a las 00:00 hora de Buenos Aires,
  // siempre).
  const today = cajaDateKeyBA();
  const todayStart = (allPendingCierres: PendingCierre[] = []): OpenCajaPeriod => ({
    startAt: dayBoundsBA(today).start,
    rangeStartDate: today,
    pendingCierre: null,
    openSessionId: null,
    allPendingCierres,
  });
  if (!businessId) return todayStart();

  // ¿Hay una cash_session EXPLÍCITAMENTE abierta (reapertura)? Y, en
  // paralelo (nunca en secuencia — es la misma consulta pesada que antes
  // se repetía), ¿qué jornadas anteriores tienen actividad sin cerrar?
  // Se piden juntas porque el resultado de la segunda hace falta sin
  // importar cuál sea el de la primera (con sesión explícita abierta
  // igual puede haber backlog más viejo sin cerrar).
  let sessionQuery = supabase
    .from("cash_sessions" as any)
    .select("id,opened_at")
    .eq("business_id", businessId)
    .eq("status", "open");
  if (branchId) sessionQuery = sessionQuery.eq("branch_id", branchId);

  const [{ data: openSession }, allPending] = await Promise.all([
    sessionQuery.order("opened_at", { ascending: false }).limit(1).maybeSingle(),
    findAllPendingCierres(businessId, branchId),
  ]);

  if ((openSession as any)?.opened_at) {
    const startAt = new Date((openSession as any).opened_at as string);
    const dateKey = cajaDateKeyBA(startAt);
    return {
      startAt,
      rangeStartDate: dateKey,
      pendingCierre: dateKey < today ? { date: dateKey, cierreId: null } : null,
      openSessionId: (openSession as any).id as string,
      allPendingCierres: allPending,
    };
  }

  // Sin sesión explícita: ¿quedó ALGUNA jornada anterior sin cerrar y con
  // actividad real? (operación implícita, nadie reabrió nada a mano —
  // nunca cierra nada sola, solo detecta el backlog). Antes esto solo
  // miraba "ayer" — con varias jornadas pendientes no consecutivas (ej.
  // 18/09, 19/09, 16/10, 17/10, cada una separada por días ya cerrados en
  // el medio) eso dejaba cashExpected/bankExpected contando solo la más
  // reciente, mientras el aviso "Tenés N cajas pendientes" (que sí usa
  // findAllPendingCierres) ya mostraba las 4 — cálculo real pero
  // incompleto, no un número inventado. Tomar la más VIEJA de todas: un
  // backlog se cierra de a uno empezando siempre por el más antiguo, y
  // así cashExpected/bankExpected/paymentsToday quedan acotados a TODO el
  // período realmente abierto, nunca a un solo día salteando el resto.
  if (allPending.length > 0) {
    const oldest = allPending[0];
    return {
      startAt: dayBoundsBA(oldest.date).start,
      rangeStartDate: oldest.date,
      pendingCierre: oldest,
      openSessionId: null,
      allPendingCierres: allPending,
    };
  }

  // Caso normal: hoy, desde medianoche — sin sesión, sin backlog.
  return todayStart(allPending);
}

// Núcleo puro de findAllPendingCierres — separado para poder testearlo sin
// tocar Supabase. `candidateDatesAsc` son días estrictamente anteriores a
// hoy, de más antiguo a más reciente; un día queda "pendiente" si tuvo
// actividad real Y no tiene un cierre con estado 'cerrada'/'reabierta'
// guardado (ver isCajaCerradaRow/isCajaReabiertaRow — un cierre reabierto
// sigue siendo un cierre que existe, no vuelve a quedar "pendiente").
export function pendingDatesFromActivity(
  candidateDatesAsc: string[],
  closedDates: Set<string>,
  activeDates: Set<string>,
): PendingCierre[] {
  return candidateDatesAsc
    .filter((date) => activeDates.has(date) && !closedDates.has(date))
    .map((date) => ({ date, cierreId: null }));
}

// A diferencia de cajaOpenRangeStartDate (que solo mira "ayer", para
// decidir desde cuándo arranca el período operativo de hoy), esto escanea varios
// días atrás y devuelve TODAS las jornadas con actividad real que todavía
// no tienen un cierre guardado — para el aviso "Tenés N cajas pendientes"
// (ver sección 2 del pedido: una caja vencida no tapa a otra más vieja).
// 30 días de lookback alcanza sobradamente cualquier backlog real; una
// jornada más vieja que eso sigue siendo cerrable a mano desde "Cerrar un
// día anterior", que no tiene ese límite.
// Único "¿tuvo actividad?" para un rango de días candidatos, en 2
// consultas (payments + expenses) en vez de 1 por día. Antes esto llamaba
// a buildCierreSnapshotForDate (4 a 6 queries: payments, expenses,
// employees, profiles, appointments pendientes, business_settings) UNA
// VEZ POR CADA DÍA candidato — con un backlog de hasta 30 días eso eran
// hasta ~180 consultas en paralelo, casi todas pidiendo exactamente lo
// mismo (los mismos employees/profiles/business_settings del negocio, 30
// veces) solo para terminar leyendo `payments.length > 0 || expenses.length
// > 0`. Esa repetición — no el volumen real de datos — era la causa de
// los ~5s que tardaba en aparecer el aviso "Cajas pendientes" en Inicio.
// Acá solo se necesita esa única pregunta sí/no por día, nunca el detalle
// completo del cierre (eso sigue viviendo en buildCierreSnapshotForDate,
// para cuando el usuario realmente abre la vista previa de un cierre).
async function datesWithActivity(
  businessId: string,
  branchId: string | null,
  dates: string[],
): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const sorted = [...dates].sort();
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];
  const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

  let payQuery = supabase
    .from("payments")
    .select("created_at")
    .eq("business_id", businessId)
    .gte("created_at", dayBoundsBA(oldest).start.toISOString())
    .lte("created_at", dayBoundsBA(newest).end.toISOString())
    // Mismo criterio que buildCierreSnapshotForDate: un pago anulado no
    // cuenta como actividad real de esa jornada.
    .not("status", "in", "(anulado,reembolsado)");
  if (branchFilter) payQuery = payQuery.or(branchFilter);

  let expQuery = supabase
    .from("expenses")
    .select("date")
    .eq("business_id", businessId)
    .gte("date", oldest)
    .lte("date", newest);
  if (branchFilter) expQuery = expQuery.or(branchFilter);

  const [payRes, expRes] = await Promise.all([payQuery, expQuery]);
  const active = new Set<string>();
  for (const row of (payRes.data ?? []) as { created_at: string | null }[]) {
    // cajaDateKeyBA, no cajaDateKey: un pago hecho después de medianoche
    // BA pero antes de medianoche del huso local/UTC tiene que contar
    // para el día de Buenos Aires que de verdad fue, nunca para el día
    // calendario de otro huso horario.
    if (row.created_at) active.add(cajaDateKeyBA(new Date(row.created_at)));
  }
  for (const row of (expRes.data ?? []) as { date: string | null }[]) {
    if (row.date) active.add(String(row.date));
  }
  return active;
}

export async function findAllPendingCierres(
  businessId: string | null,
  branchId: string | null,
  opts: { lookbackDays?: number } = {},
): Promise<PendingCierre[]> {
  if (!businessId) return [];
  const lookbackDays = opts.lookbackDays ?? 30;
  // "Hoy" y los días candidatos siempre en huso Buenos Aires — mismo
  // motivo que cajaOpenRangeStartDate: la jornada actual nunca puede
  // quedar marcada "pendiente" por culpa del huso horario del dispositivo/
  // proceso que ejecuta esto, nunca el de BA explícito.
  const today = cajaDateKeyBA();
  const candidateDatesAsc: string[] = [];
  for (let i = lookbackDays; i >= 1; i--) {
    candidateDatesAsc.push(cajaDateKeyBA(new Date(Date.now() - i * 24 * 60 * 60 * 1000)));
  }

  let cierresQuery = supabase
    .from("caja_cierres" as any)
    .select("fecha,estado")
    .eq("business_id", businessId)
    .in("fecha", candidateDatesAsc)
    .neq("fecha", today);
  if (branchId) cierresQuery = cierresQuery.eq("branch_id", branchId);
  const { data: cierresRows } = await cierresQuery;
  const closedDates = new Set(
    ((cierresRows ?? []) as any[])
      .filter((row) => isCajaCerradaRow(row) || isCajaReabiertaRow(row))
      .map((row) => String(row.fecha)),
  );

  const openCandidates = candidateDatesAsc.filter((date) => !closedDates.has(date));
  if (openCandidates.length === 0) return [];

  const activeDates = await datesWithActivity(businessId, branchId, openCandidates);

  return pendingDatesFromActivity(candidateDatesAsc, closedDates, activeDates);
}

// Snapshot financiero de UN día calendario [dateStr 00:00, dateStr
// 23:59:59.999] — nunca se extiende a otro día. Se usa tanto para armar el
// registro de un cierre manual (ver closeSingleDayCierre/
// buildSingleDayCierrePreview) como para detectar si un día tuvo actividad
// (findAllPendingCierres/cajaOpenRangeStartDate) — mismo formato exacto en
// los dos casos, para que el detalle del historial funcione igual sea cual
// sea el origen del cierre.
export async function buildCierreSnapshotForDate(
  businessId: string,
  dateStr: string,
  branchId?: string | null,
) {
  // Límites del día SIEMPRE en huso horario de Buenos Aires, explícito —
  // nunca el huso local del dispositivo/proceso que ejecuta esto (mismo
  // criterio que dayBoundsBA/filterToDayBA en el resto de este archivo).
  // Antes usaba `new Date(dateStr+"T00:00:00")`, que interpreta en el
  // huso LOCAL: en un navegador configurado fuera de Argentina (o en
  // cualquier ejecución server-side) corría el riesgo real de mezclar
  // movimientos de la jornada siguiente/anterior.
  const { start: dayStart, end: dayEnd } = dayBoundsBA(dateStr);
  // buildCierreSnapshotForDate siempre se llama con UN solo día calendario
  // (ver comentario de CierreCajaBtn: "SIEMPRE cierra exactamente ese
  // único día... nunca se extiende a ningún otro día") — endDateStr es
  // literalmente dateStr, nunca hace falta derivarlo de dayEnd.
  const endDateStr = dateStr;

  // branch_id = null nunca se excluye (.or en vez de .eq) — mismo criterio
  // que use-caja-data.ts: un cobro/gasto real con branch_id null (fila
  // vieja o nacida antes de que activeBranchId resolviera) no puede faltar
  // del cierre del día.
  const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

  let payQuery = supabase
    .from("payments")
    .select(
      "id,total,amount,method,payment_method,splits,client_name,service_name,created_at,employee_id,charged_by,charge_type,items,original_amount,discount,discount_type,discount_value,promotion_name,tip,tip_amount,status",
    )
    .eq("business_id", businessId)
    .gte("created_at", dayStart.toISOString())
    .lte("created_at", dayEnd.toISOString())
    // Un pago anulado (ej. cobro eliminado con trazabilidad, nunca
    // DELETE físico) no puede seguir contándose en el cierre ni aparecer
    // en "Ver detalles" — status solo vale "cobrado" para prácticamente
    // todas las filas históricas, "anulado"/"reembolsado" son los únicos
    // casos reales que hay que excluir de lo que de verdad entró a caja.
    .not("status", "in", "(anulado,reembolsado)");
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

  // Ventas anuladas/reembolsadas del mismo día — SOLO para mostrarlas en
  // el detalle de "Revisar cierre" (identificadas, nunca mezcladas con
  // `payments` de arriba, que a propósito las excluye de todo cálculo de
  // ingresos). Caso real (26/10/2026): Franco anuló dos ventas ($21.900 y
  // $19.000) y no había ningún lugar en Caja para verlas — "Ingresos"
  // seguía bien calculado, pero quedaban invisibles. Una sola fila por
  // payments.id (el status ACTUAL, "anulado" o "reembolsado") — anular,
  // restablecer y volver a anular la misma venta nunca duplica esta fila,
  // porque es el mismo id de siempre, no un evento del historial.
  let anuladosQuery = supabase
    .from("payments")
    .select(
      "id,total,amount,method,payment_method,splits,client_name,service_name,created_at,employee_id,charged_by,items,original_amount,status",
    )
    .eq("business_id", businessId)
    .gte("created_at", dayStart.toISOString())
    .lte("created_at", dayEnd.toISOString())
    .in("status", ["anulado", "reembolsado"]);
  if (branchFilter) anuladosQuery = anuladosQuery.or(branchFilter);

  const [payRes, expRes, employeesRes, profilesRes, anuladosRes] = await Promise.allSettled([
    payQuery,
    expQuery,
    employeesQuery,
    profilesQuery,
    anuladosQuery,
  ]);

  const payments =
    payRes.status === "fulfilled" && !payRes.value.error ? ((payRes.value.data ?? []) as any[]) : [];
  const expenses =
    expRes.status === "fulfilled" && !expRes.value.error ? ((expRes.value.data ?? []) as any[]) : [];
  const anulados =
    anuladosRes.status === "fulfilled" && !anuladosRes.value.error ? ((anuladosRes.value.data ?? []) as any[]) : [];
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
  // conciliacionAlertas: ventas cuyo splits no suma lo mismo que `monto` —
  // dato mal cargado, nunca "corregido" en silencio (ver
  // distributeCobroByMethod). Se juntan acá para que buildSingleDayCierrePreview
  // las exponga tal cual en la conciliación.
  const conciliacionAlertas: Array<{
    paymentId: string | null;
    cliente: string | null;
    hora: string | null;
    monto: number;
    splitsSum: number;
    diferencia: number;
  }> = [];
  for (const p of payments) {
    const monto = Number(p.total ?? p.amount ?? 0);
    const propina = Number(p.tip_amount ?? p.tip ?? 0);
    const rawSplits = Array.isArray((p as any).splits) ? ((p as any).splits as PaymentSplitRaw[]) : null;
    const dist = distributeCobroByMethod(monto, propina, p.method ?? p.payment_method, rawSplits);
    for (const [key, amt] of Object.entries(dist)) {
      if (!detalleMetodos[key]) detalleMetodos[key] = { ingresos: 0, gastos: 0, utilidad: 0 };
      if (!detalleMetodosRecibido[key]) detalleMetodosRecibido[key] = { ingresos: 0, gastos: 0, utilidad: 0 };
      detalleMetodos[key].ingresos += amt.monto;
      // La propina usa el MISMO reparto que el cobro — payments no guarda
      // un medio separado para ella, y es el medio por el que realmente
      // entró (ver distributeCobroByMethod).
      detalleMetodosRecibido[key].ingresos += amt.monto + amt.propina;
    }
    if (rawSplits && rawSplits.length > 0) {
      // Misma base que distributeCobroByMethod (solo splits positivos,
      // nunca negativos/cero) — y `|| 0` en vez de `?? 0` para que un
      // monto corrupto (no numérico, ej. jsonb mal cargado) nunca
      // contamine la suma con NaN: `Math.abs(NaN - x) >= 1` da false
      // siempre, lo que apagaría la alerta justo en el peor caso (el dato
      // más roto, el que más necesita quedar señalado).
      const splitsSum = rawSplits
        .filter((x) => (Number(x?.amount ?? 0) || 0) > 0)
        .reduce((s, x) => s + (Number(x?.amount ?? 0) || 0), 0);
      if (Math.abs(splitsSum - monto) >= 1) {
        conciliacionAlertas.push({
          paymentId: p.id ?? null,
          cliente: p.client_name ?? null,
          hora: p.created_at
            ? new Date(p.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
            : null,
          monto,
          splitsSum,
          diferencia: splitsSum - monto,
        });
      }
    }
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
      // Desglose real de pago múltiple (payments.splits) — null/[] = pagó
      // con un solo medio (metodo de arriba alcanza). Con splits, la fila
      // sigue siendo UNA sola venta (nunca se duplica en la lista), pero
      // el detalle puede mostrar "Efectivo $X + Transferencia $Y".
      splits: Array.isArray((p as any).splits) && (p as any).splits.length > 0 ? (p as any).splits : null,
    };
  });

  // Mismo mapeo que cobrosSnapshot, pero para `anulados` (arriba) — nunca
  // entra en totalCobrado/detalleMetodos/detalleMetodosRecibido ni en
  // ningún otro cálculo de este archivo, a propósito: existe solo para
  // que CierreMovimientosDetalleList pueda MOSTRARLAS, identificadas con
  // su propio tag, sin volver a tocar ningún total ya correcto.
  const cobrosAnuladosSnapshot = anulados.map((p) => {
    const monto = Number(p.total ?? p.amount ?? 0);
    const precioLista = p.original_amount != null ? Number(p.original_amount) : monto;
    return {
      id: p.id,
      fecha_hora: p.created_at ?? null,
      hora: p.created_at
        ? new Date(p.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
        : null,
      cliente: p.client_name ?? null,
      profesional: employeeNameById.get(p.employee_id) ?? null,
      servicio: p.service_name ?? null,
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
      usuario: resolveUsuario(p.charged_by),
      splits: Array.isArray((p as any).splits) && (p as any).splits.length > 0 ? (p as any).splits : null,
      anulado: true as const,
      estado: p.status as "anulado" | "reembolsado",
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
    cobrosAnuladosSnapshot,
    gastosSnapshot,
    cantidadCobros: payments.length,
    hadActivity: payments.length > 0 || expenses.length > 0,
    pendientesCount: pendientesDetalle.length,
    pendientesMonto,
    pendientesDetalle,
    conciliacionAlertas,
  };
}

// Adelanto a un profesional listado en el detalle de un cierre: quién, cuánto, con
// qué origen (caja = entra en el cierre; externo = no) y medio de pago.
export type CierreAdelantoDetalle = {
  id: string;
  advancedAt: string;
  profesional: string;
  monto: number;
  origen: "caja" | "externo" | null;
  medio: string | null;
  nota: string | null;
};

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
  // Desglose de CADA término de la fórmula (cobros/gastos/adelantos/
  // retiros manuales, por separado) — la Conciliación los muestra uno por
  // uno para poder identificar cuál explica una diferencia, en vez de
  // solo el resultado final (cashExpected/digitalExpected ya los suman,
  // se mantienen para no romper a quien ya los usa).
  cashFromPayments: number;
  cashExpenses: number;
  cashAdvancesOut: number;
  cashRetirosManual: number;
  digitalFromPayments: number;
  digitalExpenses: number;
  digitalAdvancesOut: number;
  digitalInflows: number;
  digitalRetirosManual: number;
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
    // Pago múltiple (payments.splits) — cuando está presente, el cobro se
    // reparte proporcionalmente entre cada medio real (ver
    // distributeCobroByMethod) en vez de caer entero en `method`, que en
    // un pago múltiple puede no reflejar ningún medio real usado.
    splits?: PaymentSplitRaw[] | null;
    // Pago pendiente/parcial (ver 20261023010000_pending_payments_schema.sql)
    // — una venta con status 'pendiente'/'parcial' NUNCA aporta plata acá
    // por su total/amount, sin importar cuánto diga collected_amount: toda
    // la plata que efectivamente entró (al vender Y cualquier cobro
    // posterior) se cuenta exclusivamente a través de `collections`
    // (payment_collections, parámetro nuevo más abajo), fechada el día
    // real en que entró — nunca el día de la venta. Así una venta pendiente
    // nunca "aparenta" estar cobrada completa acá, y un cobro posterior de
    // una venta de otro día no desaparece de la caja del día en que
    // realmente se cobró.
    status?: string | null;
  }>;
  expenses: Array<{ amount?: number | null; payment_method?: string | null; method?: string | null }>;
  // funds_source: 'caja' (sale de los fondos del negocio) | 'externo' (otro
  // bolsillo/cuenta: NO toca la caja) | null/undefined (adelanto histórico,
  // anterior al origen: se trata como siempre, como de la caja).
  advances: Array<{ amount?: number | null; payment_method?: string | null; funds_source?: string | null }>;
  // method: "efectivo" (cajón físico) | "cuenta" (digital) — filas viejas,
  // de antes de que cash_movements tuviera esta columna, no traen method;
  // se tratan como "efectivo" (mismo comportamiento que tenían).
  cashMovements: Array<{ type: "ingreso" | "retiro"; amount: number | null; method?: string | null }>;
  // Cobros de pagos pendientes (payment_collections) del mismo período —
  // ya filtrados por el caller a la ventana que corresponda (collected_at,
  // nunca la fecha de la venta). amount puede ser negativo (reversión, ver
  // reverse_payment_collection) — se suma tal cual, restando correctamente.
  // Opcional (default []) para no romper ningún caller existente.
  collections?: Array<{ amount?: number | null; method?: string | null }>;
}): ExpectedCashDigital {
  const { payments, expenses, advances, cashMovements, collections = [] } = params;
  const isCash = (m: string | null | undefined) => normalizeCierreMethodKey(m) === "cash";
  const isCashMovement = (m: { method?: string | null }) => !m.method || isCash(m.method);

  // Efectivo vs digital por pago, repartido con la MISMA lógica que el
  // desglose por método (distributeCobroByMethod) — un pago múltiple
  // nunca cae entero de un lado solo porque `method` diga una cosa
  // distinta de sus splits reales.
  let cashPayments = 0;
  let digitalPayments = 0;
  for (const p of payments) {
    // pendiente/parcial: cero acá — toda su plata (la cobrada al vender Y
    // cualquier cobro posterior) se cuenta vía `collections`, más abajo,
    // fechada el día real del cobro. 'cobrado'/undefined (filas de antes de
    // este concepto) siguen su comportamiento de siempre. anulado/
    // reembolsado: tampoco aportan plata real (ver isCountableCajaPayment).
    if (!isCountableCajaPayment(p.status)) continue;
    const monto = Number(p.total ?? p.amount ?? 0);
    const propina = Number(p.tip_amount ?? p.tip ?? 0);
    const dist = distributeCobroByMethod(monto, propina, p.method ?? p.payment_method, p.splits);
    for (const [key, amt] of Object.entries(dist)) {
      if (key === "cash") cashPayments += amt.monto + amt.propina;
      else digitalPayments += amt.monto + amt.propina;
    }
  }
  for (const c of collections) {
    const amount = Number(c.amount ?? 0);
    if (normalizeCierreMethodKey(c.method) === "cash") cashPayments += amount;
    else digitalPayments += amount;
  }

  const cashExpenses = expenses
    .filter((e) => isCash(e.payment_method ?? e.method))
    .reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const digitalExpenses = expenses
    .filter((e) => !isCash(e.payment_method ?? e.method))
    .reduce((s, e) => s + Number(e.amount ?? 0), 0);

  // Un adelanto de FONDOS EXTERNOS es un adelanto al profesional (baja su Total a
  // pagar) pero no plata de la caja: no entra en el efectivo ni en el dinero en
  // cuenta esperados, ni en las salidas del cierre.
  const cajaAdvances = advances.filter((a) => a.funds_source !== "externo");
  const cashAdvances = cajaAdvances
    .filter((a) => isCash(a.payment_method))
    .reduce((s, a) => s + Number(a.amount ?? 0), 0);
  const digitalAdvances = cajaAdvances
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
    cashFromPayments: cashPayments,
    cashExpenses,
    cashAdvancesOut: cashAdvances,
    cashRetirosManual: retirosCajaEfectivo,
    digitalFromPayments: digitalPayments,
    digitalExpenses,
    digitalAdvancesOut: digitalAdvances,
    digitalInflows: ingresosCajaDigital,
    digitalRetirosManual: retirosCajaDigital,
  };
}

export type ConciliacionAlerta = {
  paymentId: string | null;
  cliente: string | null;
  hora: string | null;
  monto: number;
  splitsSum: number;
  diferencia: number;
};

export type ConciliacionLado = {
  cobros: number;
  ingresosManuales: number;
  gastos: number;
  retirosManuales: number;
  adelantos: number;
  esperado: number;
};

export type Conciliacion = {
  // Por cada medio de pago activo: lo cobrado (venta + propina, ya
  // repartido real entre medios si hubo pago múltiple) menos los gastos
  // pagados por ese mismo medio — tiene que coincidir con el "Resumen de
  // caja" por medio de pago, porque sale de la MISMA fuente
  // (detalleMetodosRecibido), nunca de un cálculo aparte.
  porMetodo: Record<string, { cobrado: number; gastos: number; neto: number }>;
  // Cada término de la fórmula de "esperado", efectivo y digital por
  // separado — para poder señalar cuál explica una diferencia (ej. un
  // retiro manual más grande de lo esperado) en vez de solo ver el total.
  efectivo: ConciliacionLado;
  digital: ConciliacionLado;
  // Ventas con pago múltiple cuyos splits no suman el total cobrado —
  // dato mal cargado, identificado explícitamente (nunca corregido en
  // silencio, ver distributeCobroByMethod).
  alertas: ConciliacionAlerta[];
};

// Arma la Conciliación a partir de piezas YA calculadas (snapshot +
// expected + manualMovements) — nunca vuelve a sumar nada por su cuenta,
// para que un desacuerdo entre "Resumen de caja" y "Conciliación" sea
// literalmente imposible (misma fuente, dos presentaciones).
export function buildConciliacion(
  detalleMetodosRecibido: Record<string, CierreMetodoDetalle>,
  expected: ExpectedCashDigital,
  manualMovements: { ingresosEfectivo: number; retirosEfectivo: number; ingresosDigital: number; retirosDigital: number },
  conciliacionAlertas: ConciliacionAlerta[],
): Conciliacion {
  const porMetodo: Conciliacion["porMetodo"] = {};
  for (const [key, v] of Object.entries(detalleMetodosRecibido)) {
    porMetodo[key] = { cobrado: v.ingresos, gastos: v.gastos, neto: v.ingresos - v.gastos };
  }
  // Un solo armador para efectivo/digital — evita mantener dos bloques
  // calcados a mano (ver cashFromPayments/digitalFromPayments etc. en
  // ExpectedCashDigital) que podrían desviarse si mañana se agrega un
  // término nuevo a la fórmula de un solo lado y no del otro.
  const buildLado = (prefix: "cash" | "digital", ingresosManuales: number, retirosManuales: number): ConciliacionLado => ({
    cobros: expected[`${prefix}FromPayments`],
    ingresosManuales,
    gastos: expected[`${prefix}Expenses`],
    retirosManuales,
    adelantos: expected[`${prefix}AdvancesOut`],
    esperado: expected[`${prefix}Expected`],
  });
  return {
    porMetodo,
    efectivo: buildLado("cash", manualMovements.ingresosEfectivo, manualMovements.retirosEfectivo),
    digital: buildLado("digital", manualMovements.ingresosDigital, manualMovements.retirosDigital),
    alertas: conciliacionAlertas,
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
  const { start: dayStart, end: dayEnd } = dayBoundsBA(dateStr);
  const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

  // Adelantos (professional_advances.advanced_at) del mismo día —
  // necesarios para "Efectivo esperado en caja" / "Dinero esperado en
  // cuenta", misma fórmula que usa el cierre de hoy
  // (computeExpectedCashAndDigital).
  let advQuery = supabase
    .from("professional_advances" as any)
    .select("*")
    .eq("business_id", businessId)
    .gte("advanced_at", dayStart.toISOString())
    .lte("advanced_at", dayEnd.toISOString());
  // professional_advances NO tiene branch_id: filtrar por sucursal acá hacía
  // fallar la consulta en silencio y los adelantos no entraban en el cierre de
  // un día anterior. Los adelantos son del negocio, como en el cierre de hoy
  // (useCashMovements).

  // snapshot, movimientosManuales y advances en paralelo (una sola tanda
  // de red, ninguna depende de otra) — buildCajaMovimientosManualesForDate
  // ya aplica dayBoundsBA(dateStr) por su cuenta y trae la lista COMPLETA
  // (id/hora/usuario/nota), no solo los totales: antes esta función hacía
  // su propia query de cash_movements aparte (solo type/amount/method),
  // duplicando la consulta y dejando afuera los datos que "Revisar cierre"
  // necesita para poder listar cada retiro/ingreso sin salir de la
  // pantalla (ver CierreRevisionDetalle).
  const [snapshot, movimientosManuales, advRes] = await Promise.all([
    buildCierreSnapshotForDate(businessId, dateStr, branchId),
    buildCajaMovimientosManualesForDate(businessId, branchId, dateStr),
    advQuery,
  ]);

  const advRows = (advRes.data ?? []) as any[];
  const advances = advRows.map((a) => ({
    amount: a.amount,
    payment_method: a.payment_method,
    funds_source: a.funds_source ?? null,
  }));
  // Detalle de cada adelanto del día (con el nombre del profesional) para
  // mostrarlo en el cierre: los de la caja se suman al esperado, los de fondos
  // externos solo se listan como "no incluidos".
  const advProfIds = [...new Set(advRows.map((a) => a.professional_id).filter(Boolean))] as string[];
  const advNameById = new Map<string, string>();
  if (advProfIds.length > 0) {
    const { data: advEmps } = await supabase.from("employees").select("id,full_name").in("id", advProfIds);
    for (const e of (advEmps ?? []) as any[]) advNameById.set(e.id, e.full_name ?? "—");
  }
  const adelantosDetalle: CierreAdelantoDetalle[] = advRows
    .map((a) => ({
      id: String(a.id),
      advancedAt: String(a.advanced_at),
      profesional: advNameById.get(a.professional_id) ?? "—",
      monto: Number(a.amount ?? 0),
      origen: (a.funds_source ?? null) as CierreAdelantoDetalle["origen"],
      medio: a.payment_method ?? null,
      nota: a.note ?? null,
    }))
    .sort((x, y) => x.advancedAt.localeCompare(y.advancedAt));
  const cashMovements = movimientosManuales.map((m) => ({
    type: m.tipo,
    amount: m.monto,
    // "cuenta" es el único valor no-efectivo que usa cash_movements.method
    // (ver CajaMovimientoManual) — normalizeCierreMethodKey lo deja tal
    // cual, isCash() de computeExpectedCashAndDigital ya lo trata como
    // "no efectivo" sin necesitar ningún mapeo especial acá.
    method: m.metodo,
  }));

  const expected = computeExpectedCashAndDigital({
    payments: snapshot.cobrosSnapshot.map((c) => ({
      total: c.monto,
      method: c.metodo,
      tip: c.propina,
      splits: c.splits as PaymentSplitRaw[] | null,
    })),
    expenses: snapshot.gastosSnapshot.map((g) => ({ amount: g.monto, payment_method: g.metodo })),
    advances,
    cashMovements,
  });

  // Ingresos/retiros manuales (cash_movements), efectivo y digital por
  // separado — antes solo se exponía el total neto de efectivo
  // (manualMovements.ingresos/retiros); la Conciliación necesita los 4
  // números por separado para mostrar cada término de la fórmula.
  const manualMovements = {
    ingresos: cashMovements.filter((m) => m.type === "ingreso" && (!m.method || normalizeCierreMethodKey(m.method) === "cash")).reduce((s, m) => s + Number(m.amount ?? 0), 0),
    retiros: cashMovements.filter((m) => m.type === "retiro" && (!m.method || normalizeCierreMethodKey(m.method) === "cash")).reduce((s, m) => s + Number(m.amount ?? 0), 0),
    ingresosDigital: cashMovements.filter((m) => m.type === "ingreso" && m.method && normalizeCierreMethodKey(m.method) !== "cash").reduce((s, m) => s + Number(m.amount ?? 0), 0),
    retirosDigital: cashMovements.filter((m) => m.type === "retiro" && m.method && normalizeCierreMethodKey(m.method) !== "cash").reduce((s, m) => s + Number(m.amount ?? 0), 0),
  };

  const conciliacion = buildConciliacion(
    snapshot.detalleMetodosRecibido,
    expected,
    {
      ingresosEfectivo: manualMovements.ingresos,
      retirosEfectivo: manualMovements.retiros,
      ingresosDigital: manualMovements.ingresosDigital,
      retirosDigital: manualMovements.retirosDigital,
    },
    snapshot.conciliacionAlertas,
  );

  return { snapshot, expected, manualMovements, movimientosManuales, adelantosDetalle, conciliacion };
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

  // presentismo_snapshot NO se arma acá — lo completa el trigger SQL
  // check_attendance_confirmed_before_close, en el mismo instante en que
  // valida que el presentismo esté confirmado (misma transacción que este
  // INSERT/UPDATE). Armarlo acá, en un fetch aparte antes de guardar, deja
  // una ventana de carrera entre leer attendance_confirmations y guardar
  // caja_cierres — moverlo al trigger la elimina del todo: lo que queda
  // congelado es exactamente lo vigente en el instante real de la
  // escritura, nunca una lectura de un momento antes.

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

  // Dos confirmaciones simultáneas de la MISMA fecha (dos usuarios, o un
  // doble clic) no se resuelven leyendo primero y escribiendo después —
  // entre el SELECT de existingCierre (arriba) y este INSERT/UPDATE pasó
  // buildSingleDayCierrePreview, varias queries de por medio: tiempo de
  // sobra para que la otra confirmación ya haya terminado. La base de
  // datos es quien decide cuál gana:
  //   - INSERT: si la otra ya insertó, la unique constraint (business_id,
  //     branch_id, fecha) — NULLS NOT DISTINCT — rechaza esta con 23505.
  //   - UPDATE: .neq("estado", "cerrada") hace que, si la otra ya cerró
  //     esa fila un instante antes, esta UPDATE no afecte ninguna fila
  //     (en vez de pisar silenciosamente un cierre que ya quedó guardado).
  // Cualquiera de los dos casos es "alreadyClosed" para el que perdió la
  // carrera, nunca un error ni un segundo cierre.
  const query = (existingCierre as any)?.id
    ? supabase
        .from("caja_cierres" as any)
        .update(payload)
        .eq("id", (existingCierre as any).id)
        .eq("business_id", businessId)
        .neq("estado", "cerrada")
        .select("id")
        .maybeSingle()
    : supabase.from("caja_cierres" as any).insert(payload).select("id").maybeSingle();

  const { data: saved, error: saveError } = await query;
  if (saveError) {
    if ((saveError as { code?: string }).code === "23505") {
      return { closed: false, alreadyClosed: true };
    }
    throw saveError;
  }
  if (!saved?.id && (existingCierre as any)?.id) {
    // UPDATE sin filas afectadas: otra confirmación cerró esta fila entre
    // nuestro SELECT y este UPDATE.
    return { closed: false, alreadyClosed: true };
  }
  if (saved?.id) {
    // Trazabilidad inversa (attendance_confirmations.caja_cierre_id =
    // "esta confirmación quedó incluida en este cierre") la completa un
    // trigger SQL (set_attendance_caja_cierre_id, security definer) sobre
    // caja_cierres — attendance_confirmations no tiene policy de UPDATE
    // para el cliente a propósito (todo cambio pasa por confirm_attendance,
    // nunca un UPDATE directo), así que esto nunca se hace desde acá.
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
