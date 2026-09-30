import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadCajaSession } from "@/components/cash-register/session-actions";
import {
  type EmployeeServiceOverrideMap,
  type EmployeeCommissionMap,
  type Promotion,
  backfillPromotionVigencia,
} from "@/lib/service-pricing";
import { applyCatalogOrder, extractCatalogOrderMap } from "@/lib/catalog-order";

const MANUAL_PENDING_KEY = "clippr_pending_manual_charges";

// Aviso instantáneo entre pestañas/ventanas del MISMO navegador (no
// reemplaza al canal realtime de Supabase, que es el que cruza entre
// dispositivos distintos — este es un refuerzo que no depende de la red ni
// de que la tabla tenga Realtime habilitado en el proyecto de Supabase).
// Se llama después de enviar/cobrar/rechazar un pendiente para que
// cualquier otra pestaña de Caja abierta en la misma máquina se actualice
// al instante, sin esperar el round-trip de Supabase Realtime.
const CAJA_BROADCAST_CHANNEL = "clippr-caja-pendientes";
// Instancia única a nivel de módulo, nunca cerrada explícitamente — crear
// un BroadcastChannel y llamar postMessage() + close() en el mismo tick
// (como hacía la versión anterior) corre el riesgo real de cerrar el canal
// antes de que el mensaje llegue a otras pestañas, según el navegador.
let cajaBroadcastChannel: BroadcastChannel | null = null;
function getCajaBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!cajaBroadcastChannel) {
    try {
      cajaBroadcastChannel = new BroadcastChannel(CAJA_BROADCAST_CHANNEL);
    } catch {
      return null;
    }
  }
  return cajaBroadcastChannel;
}
export function notifyCajaPendientesChanged() {
  try {
    getCajaBroadcastChannel()?.postMessage("changed");
  } catch {
    // Safari en modo privado, etc. — el canal realtime sigue cubriendo esto.
  }
}

export type ClientLiteResult = {
  id: string;
  name: string;
  phone: string | null;
  email?: string | null;
  birth_date?: string | null;
};

/**
 * Server-side client search for the Caja cobro picker. Replaces loading every
 * client up front: searches by name/phone/email with ILIKE (accelerated by the
 * pg_trgm indexes) and returns only the top matches.
 */
export async function searchClientsLite(
  businessId: string,
  query: string,
  limit = 8,
): Promise<ClientLiteResult[]> {
  const s = query.trim().replace(/[%,()]/g, " ").trim();
  if (!s) return [];
  const { data, error } = await supabase
    .from("clients")
    .select("id,full_name,phone,email,birth_date")
    .eq("business_id", businessId)
    .or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`)
    .order("full_name")
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id,
    name: (r as { full_name?: string | null }).full_name ?? "Sin nombre",
    phone: r.phone,
    email: r.email,
    birth_date: r.birth_date,
  }));
}

type LocalManualPendingCharge = {
  id: string;
  business_id: string;
  employee_id: string | null;
  client_name: string | null;
  service_name: string | null;
  service_price: number | null;
  starts_at: string;
  notes?: string | null;
  status?: string | null;
};

function readLocalManualPendingCharges(businessId: string): LocalManualPendingCharge[] {
  if (typeof window === "undefined") return [];
  try {
    const rows = JSON.parse(window.localStorage.getItem(MANUAL_PENDING_KEY) || "[]") as LocalManualPendingCharge[];
    return rows.filter((item) => item.business_id === businessId);
  } catch {
    return [];
  }
}

export type Service = {
  id: string;
  name: string;
  price: number;
  duration?: number | null;
  category?: string | null;
  is_active?: boolean;
  stock?: number | null;
  is_catalog?: boolean;
  image?: string | null;
  image_position?: string | null;
  // % de descuento por pago en efectivo (Configuración → Servicios →
  // "Precio en efectivo") — mismo criterio que resolveServicePricing.
  cash_discount?: number | null;
  // Precio en efectivo ya resuelto (resolveServicePricing.effectivePrice,
  // con el override del profesional si corresponde) — null = no tiene
  // precio en efectivo configurado. No lo completa este hook: cada
  // NuevaVentaTab lo calcula localmente (necesita el profesional elegido
  // en el carrito, que es estado propio de esa pantalla, no de la carga
  // de datos general de Caja).
  cashPrice?: number | null;
};

export type Employee = {
  id: string;
  name: string;
  commission_pct: number | null;
  commission_fixed: number | null;
  avatar_url?: string | null;
};

export type ClientLite = {
  id: string;
  name: string;
  phone: string | null;
  email?: string | null;
  birth_date?: string | null;
};

export type HistorialEvento = { time: string; user: string; action: string; ts?: string };

export type Payment = {
  id: string;
  business_id?: string | null;
  total: number | null;
  amount: number | null;
  method: string | null;
  payment_method?: string | null;
  client_name: string | null;
  service_name: string | null;
  created_at: string;
  employee_id: string | null;
  employee_name?: string | null;
  appointment_id: string | null;
  charged_by?: string | null;
  charge_type?: "auto" | "manual" | "caja" | string | null;
  status?: string | null;
  observations?: string | null;
  // Descuento aplicado ($) y precio de lista previo, mismas columnas que
  // escribe registerPayment (register-payment.ts) — discount, no
  // discount_amount (esa columna no existe en payments). Propina: nunca
  // sumada dentro de total/amount, columna aparte.
  discount?: number | null;
  original_amount?: number | null;
  tip_amount?: number | null;
  // Ítems de la venta (registerPayment los guarda siempre) — id/nombre/
  // monto YA multiplicado por cantidad/qty/is_catalog. Detalle de venta
  // lo usa para un retiro de stock pagado (producto/cantidad/precio
  // unitario/total), sin depender de parsear service_name como texto.
  items?: Array<{
    id: string | null;
    name: string;
    amount: number;
    qty: number;
    is_catalog: boolean;
  }> | null;
  // Historial completo ("Envió a caja"/"Cobró"/"Rechazó", con el usuario
  // real de cada acción) — para turnos sale de appointments.cobro_events
  // (traído acá con una consulta aparte, ver load()); para ventas de
  // mostrador sin turno, del marcador [[HIST]] en observations. Resuelto
  // acá, en la capa de datos compartida, para que ningún consumidor tenga
  // que reconstruirlo por su cuenta desde un cache local que puede no
  // tener el evento (ej. "Envió a caja" escrito desde el dispositivo del
  // profesional, nunca sincronizado en el dispositivo de Caja).
  cobro_events?: HistorialEvento[];
  // Instante ISO real de "Envió a caja" si existe, si no `created_at` —
  // para ordenar por cuándo se originó la venta, no por cuándo se cobró
  // (cobrar un pendiente no debe correrlo de lugar en las listas).
  sort_ts?: string;
};

export type PendingCharge = {
  id: string;
  client_name: string | null;
  service_name: string | null;
  service_price: number | null;
  employee_id: string | null;
  starts_at: string;
  notes?: string | null;
  status?: string | null;
  // Quién y cuándo lo envió a caja ("Alan → Envió a caja") — viene ya
  // resuelto acá (de appointments.cobro_events para turnos, o del propio
  // registro para ventas de mostrador sin turno) para no depender de un
  // historial local por dispositivo que puede no tener el evento.
  events?: { time: string; user: string; action: string }[];
  // Timestamp real de cuándo se envió (ISO) — para ordenar Pendientes por
  // más reciente primero, no por nombre/cliente ni por la fecha del turno.
  sentAt?: string;
  // Promoción PREVISTA al agendar (Agenda/Mi Agenda) — solo para
  // preseleccionar en el cobro; Caja decide si se mantiene, cambia o quita.
  promotion_id?: string | null;
  promotion_snapshot?: { name: string; discountType: string; discountValue: string } | null;
};

export type Expense = {
  id: string;
  name?: string | null;
  amount: number | null;
  type?: string | null;
  category: string | null;
  payment_method: string | null;
  date?: string | null;
  note?: string | null;
  created_at?: string | null;
  user_id?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  created_by?: string | null;
};

export type ApprovalMode = "auto" | "manual";
export type PaymentMethodsConfig = {
  efectivo: boolean;
  transferencia: boolean;
  tarjeta: boolean;
  mp: boolean;
  cuentaDni: boolean;
};

/** Estado posible de la jornada de caja */
export type CajaStatus =
  | "open"         // sesión abierta → operar normalmente
  | "closed_today" // cerrada manualmente el mismo día, antes de las 00:00 → mostrar "Reabrir caja"
  | "closed"       // cerrada y ya pasó la medianoche → mostrar "Abrir caja"
  | "no_session";  // nunca se abrió hoy → mostrar "Abrir caja"

function computeCajaStatus(params: {
  sessionId: string | null;
  sessionStatus: string | null;   // "open" | "closed"
  closedAt: string | null;        // ISO string when closed
}): CajaStatus {
  const { sessionId, sessionStatus, closedAt } = params;

  if (!sessionId || sessionStatus !== "closed") {
    if (!sessionId) return "no_session";
    return "open";
  }

  // Session is closed — was it closed today?
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const closedDate = closedAt ? closedAt.slice(0, 10) : null;

  if (closedDate === todayStr) {
    return "closed_today"; // same calendar day → can reopen
  }
  return "closed"; // different day
}

// Cache en memoria, a nivel de módulo (no useState/useRef: tiene que
// sobrevivir a que este hook se desmonte y vuelva a montar, ej. salir de
// Caja y volver) — el último snapshot completo de datos por negocio.
// Al volver a montar, si hay un snapshot de ESTE MISMO negocio, se
// hidrata sincrónicamente antes de lanzar la carga real (ver load() más
// abajo), así la pantalla muestra los últimos valores conocidos al
// instante en vez de otra vez $0/loading — la carga real sigue
// corriendo de fondo y termina reemplazando estos valores sin parpadeo
// (mismo mecanismo que ya usa hasLoadedRef para los refrescos silenciosos
// dentro de un mismo montaje). Nunca se sirve el cache de OTRO negocio —
// el chequeo `cached.businessId === businessId` de abajo lo garantiza.
type CajaDataCache = {
  businessId: string;
  // Multi-sucursal (fundación): el cache tiene que distinguir sucursal,
  // no solo negocio — si no, cambiar de sucursal mostraría por un
  // instante los datos de la OTRA sucursal (cache hit por businessId)
  // antes de que la carga real (ya filtrada por branch_id) los reemplace.
  branchId: string | null;
  services: Service[];
  employees: Employee[];
  promotions: Promotion[];
  paymentsToday: Payment[];
  expensesToday: Expense[];
  cashSessionId: string | null;
  cajaStatus: CajaStatus;
  pendingCount: number;
  pendingAmount: number;
  pendingCharges: PendingCharge[];
  pendingCountPrevious: number;
  pendingAmountPrevious: number;
  pendingChargesPrevious: PendingCharge[];
  employeeServiceOverrides: EmployeeServiceOverrideMap;
  employeeCommissions: EmployeeCommissionMap;
  approvalMode: ApprovalMode;
  approvalModeEnabled: boolean;
  paymentMethods: PaymentMethodsConfig;
};
let cajaDataCache: CajaDataCache | null = null;

export function useCajaData() {
  const { businessId, profile, activeBranchId } = useAuth();
  const [loading, setLoading] = React.useState(true);
  const [approvalMode, setApprovalModeState] = React.useState<ApprovalMode>("auto");
  const [approvalModeEnabled, setApprovalModeEnabled] = React.useState(false);
  const [paymentMethods, setPaymentMethods] = React.useState<PaymentMethodsConfig>({
    efectivo: true, transferencia: true, tarjeta: true, mp: true, cuentaDni: false,
  });
  const [services, setServices] = React.useState<Service[]>([]);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  // Promociones del negocio — misma fuente/criterio que Agenda y la Página
  // Pública (business_settings.schedule._promotions). El checkout de Caja
  // decide qué mostrar según servicio/profesional según isPromotionCurrentlyValid
  // + isPromotionApplicable, nunca filtrado acá.
  const [promotions, setPromotions] = React.useState<Promotion[]>([]);
  const [paymentsToday, setPaymentsToday] = React.useState<Payment[]>([]);
  const [expensesToday, setExpensesToday] = React.useState<Expense[]>([]);
  const [cashSessionId, setCashSessionId] = React.useState<string | null>(null);
  const [cajaStatus, setCajaStatus] = React.useState<CajaStatus>("no_session");
  const [pendingCount, setPendingCount] = React.useState(0);
  const [pendingAmount, setPendingAmount] = React.useState(0);
  const [pendingCharges, setPendingCharges] = React.useState<PendingCharge[]>([]);
  // Pendientes que ya existían ANTES del último cierre de caja — se separan
  // de pendingCharges para que un pendiente de un día anterior no se mezcle
  // con los de hoy en la vista principal (pedido explícito), pero sin
  // perderlo: sigue siendo cobrable/rechazable desde acá.
  const [pendingCountPrevious, setPendingCountPrevious] = React.useState(0);
  const [pendingAmountPrevious, setPendingAmountPrevious] = React.useState(0);
  const [pendingChargesPrevious, setPendingChargesPrevious] = React.useState<PendingCharge[]>([]);
  // Precio personalizado por profesional-servicio (Equipo → Editar
  // profesional → Comisiones). Único mapa que consume el resolver
  // compartido `resolveServicePricing` — ver src/lib/service-pricing.ts.
  const [employeeServiceOverrides, setEmployeeServiceOverrides] =
    React.useState<EmployeeServiceOverrideMap>({});
  // Comisión por servicio (Equipo → [profesional] → Servicios → "%
  // comisión"/"Monto fijo" por cada uno) — mapa SEPARADO del de arriba (ese
  // es precio/duración, este es comisión). Ya se guardaba pero nada lo leía
  // al cobrar: registerPayment() solo miraba employees.commission_pct/
  // commission_fixed (general), así que un profesional con comisión
  // configurada por servicio nunca generaba fila en commission_records.
  const [employeeCommissions, setEmployeeCommissions] =
    React.useState<EmployeeCommissionMap>({});
  // Numera cada llamada a load() para poder descartar respuestas que
  // lleguen desordenadas (ver el chequeo más abajo, después del
  // Promise.allSettled) — importante porque el canal realtime puede
  // disparar varios load() seguidos en poco tiempo.
  const loadSeqRef = React.useRef(0);
  // Revalidación silenciosa: "loading" (que dispara las pantallas
  // "Cargando…") solo se prende para la carga inicial. Los refrescos
  // posteriores — realtime, BroadcastChannel, o el refresh() manual tras
  // enviar/cobrar/rechazar — mantienen los datos anteriores visibles hasta
  // que los nuevos están listos, sin parpadeo.
  const hasLoadedRef = React.useRef(false);
  const loadedBusinessIdRef = React.useRef<string | null>(null);

  // TEMPORAL — logging para encontrar qué dispara cada load() en
  // producción (pedido explícito: identificar la causa exacta antes de
  // tocar nada más). Sacar una vez confirmado cuál es el disparador real.
  const load = React.useCallback(async (reason: string = "unknown") => {
    // eslint-disable-next-line no-console
    console.log(`[Caja refresh] ${reason} @ ${new Date().toISOString()}`);
    if (!businessId) { setLoading(false); return; }
    if (loadedBusinessIdRef.current !== businessId) {
      loadedBusinessIdRef.current = businessId;
      hasLoadedRef.current = false;
      // Volver a Caja (o el primer montaje de este componente en la
      // sesión) con un cache de ESTE negocio Y ESTA sucursal disponible:
      // hidratar todo de una — nunca el de otro negocio/sucursal, evita
      // mostrar datos viejos ajenos aunque sea por un instante.
      if (cajaDataCache && cajaDataCache.businessId === businessId && cajaDataCache.branchId === activeBranchId) {
        const cached = cajaDataCache;
        setServices(cached.services);
        setEmployees(cached.employees);
        setPromotions(cached.promotions);
        setPaymentsToday(cached.paymentsToday);
        setExpensesToday(cached.expensesToday);
        setCashSessionId(cached.cashSessionId);
        setCajaStatus(cached.cajaStatus);
        setPendingCount(cached.pendingCount);
        setPendingAmount(cached.pendingAmount);
        setPendingCharges(cached.pendingCharges);
        setPendingCountPrevious(cached.pendingCountPrevious);
        setPendingAmountPrevious(cached.pendingAmountPrevious);
        setPendingChargesPrevious(cached.pendingChargesPrevious);
        setEmployeeServiceOverrides(cached.employeeServiceOverrides);
        setEmployeeCommissions(cached.employeeCommissions);
        setApprovalModeState(cached.approvalMode);
        setApprovalModeEnabled(cached.approvalModeEnabled);
        setPaymentMethods(cached.paymentMethods);
        hasLoadedRef.current = true;
      }
    }
    const mySeq = ++loadSeqRef.current;
    if (!hasLoadedRef.current) setLoading(true);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const dateStr = new Date().toISOString().slice(0, 10);

    // Arranca ya, en paralelo con el Promise.allSettled de abajo — antes
    // se esperaba (await) recién DESPUÉS de que todo ese batch terminara,
    // una consulta más completamente en serie sin necesidad (no depende
    // de ningún resultado del batch, ni el batch depende de ella). Se
    // resuelve más abajo, justo donde antes estaba el await.
    const sessionPromise = loadCajaSession(businessId);

    // Multi-sucursal (fundación): branch_id es un filtro de aplicación, se
    // suma al .eq("business_id", ...) de siempre — nunca lo reemplaza.
    // Con activeBranchId en null (negocio recién migrado, sin sucursal
    // resuelta todavía) el filtro simplemente no se aplica, mismo
    // comportamiento que antes de esta migración.
    let svcQuery = supabase
      .from("price_catalog")
      .select("id,name,price,duration_min,category,active,stock,cash_discount")
      .eq("business_id", businessId)
      .eq("active", true);
    if (activeBranchId) svcQuery = svcQuery.eq("branch_id", activeBranchId);

    // Sin .eq("is_active", true): esa columna nunca se edita desde ningún
    // lugar de la app (Equipo no tiene un toggle para ella — ver el
    // comentario de toggleOnline en equipo-section.tsx; "Acepta reservas
    // en línea" es un campo totalmente distinto, guardado en
    // business_settings). Filtrar por acá dejaba afuera de "Nueva venta"
    // a cualquier profesional cuyo is_active fuera false/null por algún
    // motivo ajeno al negocio, aunque apareciera normal en Equipo/Agenda
    // — ninguna otra consulta de employees del proyecto filtra por esto.
    let empQuery = supabase
      .from("employees")
      .select("id,full_name,avatar_url,is_active,commission_pct,commission_fixed")
      .eq("business_id", businessId);
    if (activeBranchId) empQuery = empQuery.eq("branch_id", activeBranchId);

    let payQuery = supabase
      .from("payments")
      // business_id: hace falta acá (no solo el .eq de abajo) para poder
      // eliminar el cobro desde el detalle sin otra consulta. discount/
      // original_amount/tip_amount: el modal de detalle ("Últimos
      // ingresos" → tocar una fila) los necesita para mostrar el
      // desglose Servicio/Descuento/Propina/Total cobrado — antes no se
      // pedían acá, así que esas filas quedaban siempre en null aunque
      // el pago sí los tuviera guardados en la base. items: el detalle
      // de "Retirar stock → Pagar ahora" lo necesita para separar
      // cantidad/precio unitario/total sin parsear service_name (que
      // puede traer "Cepita x2" como texto).
      .select("id,business_id,total,amount,method,payment_method,client_name,service_name,created_at,employee_id,appointment_id,charged_by,charge_type,status,charged_at,observations,discount,original_amount,tip_amount,items")
      .eq("business_id", businessId)
      .gte("created_at", today.toISOString())
      .lte("created_at", todayEnd.toISOString());
    if (activeBranchId) payQuery = payQuery.eq("branch_id", activeBranchId);
    payQuery = payQuery.order("created_at", { ascending: false });

    let expQuery = supabase
      .from("expenses")
      .select("id,name,amount,type,category,payment_method,date,note,created_at,user_id,user_name,user_email,created_by")
      .eq("business_id", businessId)
      .eq("date", dateStr);
    if (activeBranchId) expQuery = expQuery.eq("branch_id", activeBranchId);
    expQuery = expQuery.order("created_at", { ascending: false });

    // "pending_payment" NUNCA es un valor válido de appointments.status —
    // la restricción "appointments_status_check" de Supabase no lo admite
    // (solo pending/confirmed/completed/cancelled/no_show/charged/blocked),
    // así que filtrar por ese status acá dejaba esta consulta en cero
    // filas SIEMPRE: ningún turno "enviado a caja" podía llegar a existir
    // con ese status. El marcador "[PENDIENTE_CAJA]" en las notas es la
    // única señal real de "enviado, todavía no cobrado".
    let pendingQuery = supabase
      .from("appointments")
      .select("id,client_name,service_name,service_price,employee_id,starts_at,notes,status,cobro_events,promotion_id,promotion_snapshot")
      .eq("business_id", businessId);
    if (activeBranchId) pendingQuery = pendingQuery.eq("branch_id", activeBranchId);
    pendingQuery = pendingQuery
      .ilike("notes", "%[PENDIENTE_CAJA]%")
      .not("status", "in", "(charged,cancelled,blocked)")
      .order("starts_at", { ascending: true });

    const [svcRes, empRes, payRes, expRes, sessRes, bsRes, cliRes, pendingChargeRes, cierresRes] = await Promise.allSettled([
      svcQuery.order("category").order("name"),
      empQuery.order("full_name", { ascending: true }),
      payQuery,
      expQuery,
      // Session loaded via loadCajaSession (handles both cash_sessions table and fallback)
      Promise.resolve({ data: null, error: null }),
      supabase
        .from("business_settings")
        .select("approval_mode,schedule")
        .eq("business_id", businessId)
        .maybeSingle(),
      // Clients are searched on demand in the cobro picker (server-side ILIKE),
      // so we no longer load every client here.
      Promise.resolve({ data: null, error: null }),
      pendingQuery,
      // Últimos cierres — para saber desde cuándo son los Pendientes "de
      // hoy" (ver lastCierreAt más abajo). Trae varias filas, no solo la
      // última, porque una fila de caja_cierres es por día pero puede tener
      // más de un evento "cierre" adentro (cerrar/reabrir/cerrar de nuevo).
      supabase
        .from("caja_cierres" as any)
        .select("fecha,eventos")
        .eq("business_id", businessId)
        .order("fecha", { ascending: false })
        .limit(5),
    ]);

    // Con el canal realtime (INSERT/UPDATE/DELETE sobre appointments y
    // business_settings) disparando load() en cadena — varios envíos/
    // cobros/rechazos seguidos, cada uno dispara su propio load() — nada
    // garantiza que las respuestas lleguen en el mismo orden en que salieron
    // las llamadas. Sin este chequeo, una respuesta VIEJA que tarda más en
    // volver podía pisar el estado ya actualizado por una llamada más
    // nueva que respondió antes — eso hacía que un envío recién llegado
    // apareciera "en el medio" o con datos de un instante anterior. Si ya
    // se lanzó un load() más nuevo mientras este esperaba, esta respuesta
    // se descarta entera (ningún setState de acá abajo corre).
    if (loadSeqRef.current !== mySeq) return;

    // Services
    const svcRawUnordered = svcRes.status === "fulfilled" && !svcRes.value.error ? (svcRes.value.data ?? []) : [];
    // Orden manual (drag&drop) definido en Configuración → Servicios/Catálogo:
    // se aplica acá para que "Nueva venta" liste los ítems en el mismo orden.
    const svcRaw = (() => {
      const bsData = bsRes.status === "fulfilled" && !bsRes.value.error ? bsRes.value.data : null;
      const schedule = (bsData?.schedule ?? {}) as Record<string, unknown>;
      const serviceOrder = extractCatalogOrderMap(schedule, "service");
      const catalogOrder = extractCatalogOrderMap(schedule, "catalog");
      const rows = svcRawUnordered as Array<{ id: string; category: string | null; duration_min: number | null }>;
      const services = rows.filter((r) => r.duration_min != null);
      const products = rows.filter((r) => r.duration_min == null);
      return [
        ...applyCatalogOrder(services, serviceOrder, "Servicios"),
        ...applyCatalogOrder(products, catalogOrder, "Productos"),
      ];
    })();
    // Imagen del ítem (servicios y catálogo comparten el mismo mapa) desde business_settings.schedule._catalogImages
    const catalogImages: Record<string, string> = (() => {
      const bsData = bsRes.status === "fulfilled" && !bsRes.value.error ? bsRes.value.data : null;
      const schedule = (bsData?.schedule ?? {}) as Record<string, unknown>;
      const imgs = (schedule._catalogImages ?? {}) as Record<string, unknown>;
      const map: Record<string, string> = {};
      for (const [k, v] of Object.entries(imgs)) {
        if (k.trim() && typeof v === "string" && v) map[k] = v;
      }
      return map;
    })();
    // Posición de recorte guardada para cada imagen (servicios y catálogo comparten el mismo mapa)
    const catalogImagePositions: Record<string, string> = (() => {
      const bsData = bsRes.status === "fulfilled" && !bsRes.value.error ? bsRes.value.data : null;
      const schedule = (bsData?.schedule ?? {}) as Record<string, unknown>;
      const positions = (schedule._catalogImagePositions ?? {}) as Record<string, unknown>;
      const map: Record<string, string> = {};
      for (const [k, v] of Object.entries(positions)) {
        if (k.trim() && typeof v === "string" && v.trim()) map[k] = v;
      }
      return map;
    })();
    setServices(
      (svcRaw as Array<{ id: string; name: string; price: number; duration_min: number | null; category: string | null; active: boolean | null; stock: number | null; cash_discount: number | null }>)
        .map((r) => ({
          id: r.id,
          name: r.name,
          price: Number(r.price ?? 0),
          duration: r.duration_min,
          category: r.category,
          is_active: r.active !== false,
          stock: r.stock,
          is_catalog: r.duration_min == null,
          image: catalogImages[r.id] ?? null,
          image_position: catalogImagePositions[r.id] ?? null,
          cash_discount: r.cash_discount,
        })),
    );

    // Employees
    setEmployees(
      empRes.status === "fulfilled" && !empRes.value.error
        ? ((empRes.value.data ?? []) as Array<{ id: string; full_name: string | null; avatar_url?: string | null; commission_pct: number | null; commission_fixed: number | null }>)
            .map((r) => ({ id: r.id, name: r.full_name ?? "Sin nombre", commission_pct: r.commission_pct ?? null, commission_fixed: r.commission_fixed ?? null, avatar_url: r.avatar_url ?? null }))
        : []
    );

    // Session status — se lanzó en paralelo con el batch de arriba (ver
    // sessionPromise), acá solo se espera a que termine.
    const sessionData = await sessionPromise;
    const sessionId = sessionData.sessionId;
    const sessionStatus = sessionData.status;
    const closedAt = sessionData.closedAt;

    // Always expose sessionId so we can close even if caja was loaded as "open"
    setCashSessionId(sessionId);

    const status = computeCajaStatus({
      sessionId,
      sessionStatus: sessionStatus === "no_session" ? null : sessionStatus,
      closedAt,
    });
    setCajaStatus(status);

    // Payments — se completa cobro_events/sort_ts abajo (ver enrichPayments).
    const paymentsRaw = payRes.status === "fulfilled" && !payRes.value.error ? ((payRes.value.data ?? []) as Payment[]) : [];

    // `payments` no tiene cobro_events (esa columna vive en `appointments`),
    // así que se trae acá aparte, solo para los appointment_id presentes
    // hoy — sin esto, "Últimos ingresos"/"Historial completo" mostraban
    // solo "Cobró" (con el nombre genérico "Recepción") porque reconstruían
    // el historial desde un cache local por dispositivo que podía no tener
    // el "Envió a caja" que escribió el profesional en otro aparato.
    const paymentApptIds = Array.from(
      new Set(paymentsRaw.map((p) => p.appointment_id).filter((id): id is string => !!id)),
    );
    const apptHistMap: Record<string, HistorialEvento[]> = {};
    if (paymentApptIds.length > 0) {
      const { data: apptHistRows } = await supabase
        .from("appointments")
        .select("id,cobro_events")
        .eq("business_id", businessId)
        .in("id", paymentApptIds);
      for (const row of apptHistRows ?? []) {
        const events = (Array.isArray(row.cobro_events) ? row.cobro_events : []) as HistorialEvento[];
        if (events.length) apptHistMap[row.id as string] = events;
      }
    }
    const PAY_HIST_MARKER = "[[HIST]]";
    const paymentsEnriched: Payment[] = paymentsRaw.map((p) => {
      let events: HistorialEvento[] = [];
      const rawObs = String(p.observations ?? "");
      if (rawObs.startsWith(PAY_HIST_MARKER)) {
        try { events = JSON.parse(rawObs.slice(PAY_HIST_MARKER.length)); } catch { events = []; }
      } else if (p.appointment_id && apptHistMap[p.appointment_id]) {
        events = apptHistMap[p.appointment_id];
      }
      const sendEvent = events.find((e) => e.action === "Envió a caja");
      return { ...p, cobro_events: events, sort_ts: sendEvent?.ts ?? p.created_at };
    });
    // Orden por sort_ts (momento real de envío/creación) — nunca por cuándo
    // se cobró: cobrar o rechazar un pendiente no debe correrlo de lugar.
    paymentsEnriched.sort((a, b) => (b.sort_ts ?? "").localeCompare(a.sort_ts ?? ""));
    setPaymentsToday(paymentsEnriched);
    setExpensesToday(expRes.status === "fulfilled" && !expRes.value.error ? ((expRes.value.data ?? []) as Expense[]) : []);

    // Pending charges — el query ya filtra por el marcador en notas; este
    // segundo chequeo es solo defensivo (por si algún día se relaja el
    // .ilike/.not de la consulta). "events"/"sentAt" salen acá de
    // appointments.cobro_events (no de un historial local por dispositivo,
    // que puede no tener el evento si Caja está en otro aparato) para poder
    // mostrar "Alan → Envió a caja" y ordenar por fecha real de envío.
    const pendingFromDb: PendingCharge[] = (
      pendingChargeRes.status === "fulfilled" && !pendingChargeRes.value.error
        ? ((pendingChargeRes.value.data ?? []) as Array<PendingCharge & { cobro_events?: unknown }>)
        : []
    )
      .filter((a) => String(a.notes ?? "").includes("[PENDIENTE_CAJA]"))
      .map((a) => {
        const allEvents = (Array.isArray(a.cobro_events) ? a.cobro_events : []) as { time: string; user: string; action: string; ts?: string }[];
        // El turno puede haber sido enviado, rechazado y reenviado — puede
        // haber más de un "Envió a caja" en el historial. Sin este .reduce
        // (por ts, más reciente gana) un .find() se quedaba con el PRIMERO
        // (el más viejo), mostrando y ordenando por un envío que ya no es
        // el vigente.
        const sendEvents = allEvents.filter((e) => e.action === "Envió a caja");
        const sendEvent = sendEvents.reduce<typeof sendEvents[number] | undefined>(
          (latest, e) => (!latest || (e.ts ?? "") > (latest.ts ?? "") ? e : latest),
          undefined,
        );
        return {
          ...a,
          events: sendEvent ? [sendEvent] : [],
          sentAt: sendEvent?.ts ?? a.starts_at,
        };
      });

    const pendingFromLocal = readLocalManualPendingCharges(businessId).map((item) => ({
      id: item.id,
      client_name: item.client_name,
      service_name: item.service_name,
      service_price: item.service_price,
      employee_id: item.employee_id,
      starts_at: item.starts_at,
      notes: item.notes,
      status: "pending_payment",
      sentAt: item.starts_at,
    }));

    // Settings (schedule se parsea acá arriba porque también trae las
    // ventas de mostrador enviadas sin turno — ver pendingFromWalkIn).
    const bsSchedule: Record<string, unknown> =
      bsRes.status === "fulfilled" && !bsRes.value.error && bsRes.value.data
        ? ((bsRes.value.data.schedule ?? {}) as Record<string, unknown>)
        : {};
    setPromotions(
      Array.isArray(bsSchedule._promotions)
        ? (bsSchedule._promotions as Promotion[]).map(backfillPromotionVigencia)
        : [],
    );

    // Venta de mostrador enviada a Caja en modo "Enviar" sin partir de un
    // turno: no existe un appointment de por medio (no debe ocuparse un
    // horario en la agenda), así que se guarda acá, en el mismo JSONB de
    // settings que ya usan _employeeServiceOverrides/_catalogImages. Las
    // rechazadas se quedan visibles en Pendientes (status:"rechazado", con
    // su evento "Rechazó") como registro histórico pendiente de revisión —
    // pedido explícito: no deben desaparecer solas, sin acción disponible.
    const pendingFromWalkIn: PendingCharge[] = (
      Array.isArray(bsSchedule._pendingWalkInSales) ? (bsSchedule._pendingWalkInSales as Array<Record<string, unknown>>) : []
    )
      .map((w) => ({
        id: String(w.id ?? ""),
        client_name: (w.client_name as string | null) ?? null,
        service_name: (w.service_name as string | null) ?? null,
        service_price: (w.service_price as number | null) ?? null,
        employee_id: (w.employee_id as string | null) ?? null,
        starts_at: String(w.starts_at ?? new Date().toISOString()),
        notes: null,
        status: (w.status as string | undefined) ?? "pending",
        events: (Array.isArray(w.events) ? w.events : []) as { time: string; user: string; action: string }[],
        sentAt: String(w.starts_at ?? new Date().toISOString()),
      })).filter((w) => w.id);

    const pendingMap = new Map<string, PendingCharge>();
    [...pendingFromLocal, ...pendingFromDb, ...pendingFromWalkIn].forEach((item) => pendingMap.set(item.id, item));
    // Más nuevo primero — por el timestamp real de envío a caja, no por
    // nombre/cliente ni por la fecha original del turno.
    const allPending = Array.from(pendingMap.values()).sort(
      (a, b) => new Date(b.sentAt ?? b.starts_at).getTime() - new Date(a.sentAt ?? a.starts_at).getTime(),
    );

    // Último cierre real — el más reciente evento "tipo:cierre" dentro de
    // las últimas filas de caja_cierres (una fila es por día, pero puede
    // tener más de un evento de cierre si se reabrió y se volvió a cerrar).
    // Los pendientes enviados DESPUÉS de ese momento son "de hoy"; los de
    // antes son "de días anteriores" — separados en pendingChargesPrevious,
    // sin perderlos ni sacarlos de la cola de cobro/rechazo.
    const lastCierreAt = ((): number => {
      const rows = cierresRes.status === "fulfilled" && !cierresRes.value.error ? ((cierresRes.value.data ?? []) as Array<{ eventos: unknown }>) : [];
      let latest = 0;
      for (const row of rows) {
        const eventos = Array.isArray(row.eventos) ? (row.eventos as Array<{ tipo?: string; fecha_hora?: string }>) : [];
        for (const ev of eventos) {
          if (ev.tipo !== "cierre" || !ev.fecha_hora) continue;
          const t = new Date(ev.fecha_hora).getTime();
          if (t > latest) latest = t;
        }
      }
      return latest;
    })();

    const pendingToday = lastCierreAt
      ? allPending.filter((p) => new Date(p.sentAt ?? p.starts_at).getTime() > lastCierreAt)
      : allPending;
    const pendingPrevious = lastCierreAt
      ? allPending.filter((p) => new Date(p.sentAt ?? p.starts_at).getTime() <= lastCierreAt)
      : [];

    setPendingCharges(pendingToday);
    setPendingCount(pendingToday.length);
    setPendingAmount(pendingToday.reduce((s, a) => s + Number(a.service_price ?? 0), 0));
    setPendingChargesPrevious(pendingPrevious);
    setPendingCountPrevious(pendingPrevious.length);
    setPendingAmountPrevious(pendingPrevious.reduce((s, a) => s + Number(a.service_price ?? 0), 0));

    // Settings
    if (bsRes.status === "fulfilled" && !bsRes.value.error && bsRes.value.data) {
      const row = bsRes.value.data;
      const mode = row.approval_mode;
      setApprovalModeState(mode === "manual" ? "manual" : "auto");
      const caja = (bsSchedule._caja ?? {}) as Record<string, unknown>;
      setApprovalModeEnabled(caja.approvalModeEnabled === true);
      setEmployeeServiceOverrides(
        (bsSchedule._employeeServiceOverrides as EmployeeServiceOverrideMap) ?? {},
      );
      setEmployeeCommissions(
        (bsSchedule._employeeCommissions as EmployeeCommissionMap) ?? {},
      );
      if (caja.methods && typeof caja.methods === "object") {
        const m = caja.methods as Record<string, boolean>;
        setPaymentMethods({
          efectivo: m.efectivo !== false,
          transferencia: m.transferencia !== false,
          tarjeta: m.tarjeta !== false,
          mp: m.mp !== false,
          cuentaDni: m.cuentaDni === true,
        });
      }
    }

    hasLoadedRef.current = true;
    setLoading(false);
  }, [businessId, activeBranchId]);

  React.useEffect(() => { load("component mount / businessId o sucursal cambió"); }, [load]);

  // Mantiene cajaDataCache al día con el estado actual — cualquier cambio
  // (carga real terminada, realtime, refresh() manual) queda disponible
  // para la próxima vez que este hook se monte con el mismo negocio. Solo
  // después del primer load real (hasLoadedRef): nunca cachea el estado
  // default/vacío de antes de la primera carga.
  React.useEffect(() => {
    if (!businessId || !hasLoadedRef.current) return;
    cajaDataCache = {
      businessId,
      branchId: activeBranchId,
      services, employees, promotions, paymentsToday, expensesToday,
      cashSessionId, cajaStatus,
      pendingCount, pendingAmount, pendingCharges,
      pendingCountPrevious, pendingAmountPrevious, pendingChargesPrevious,
      employeeServiceOverrides, employeeCommissions,
      approvalMode, approvalModeEnabled, paymentMethods,
    };
  }, [
    businessId, activeBranchId, services, employees, promotions, paymentsToday, expensesToday,
    cashSessionId, cajaStatus,
    pendingCount, pendingAmount, pendingCharges,
    pendingCountPrevious, pendingAmountPrevious, pendingChargesPrevious,
    employeeServiceOverrides, employeeCommissions,
    approvalMode, approvalModeEnabled, paymentMethods,
  ]);

  React.useEffect(() => {
    const onManualPending = () => load("custom event: clippr:manual-pending-updated");
    const onStorage = () => load("custom event: storage");
    window.addEventListener("clippr:manual-pending-updated", onManualPending);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("clippr:manual-pending-updated", onManualPending);
      window.removeEventListener("storage", onStorage);
    };
  }, [load]);

  React.useEffect(() => {
    const refresh = () => load("custom event: clippr:caja-settings-updated");
    window.addEventListener("clippr:caja-settings-updated", refresh);
    return () => window.removeEventListener("clippr:caja-settings-updated", refresh);
  }, [load]);

  // Ver notifyCajaPendientesChanged() más arriba — refresco instantáneo
  // entre pestañas del mismo navegador, sin depender de la red.
  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(CAJA_BROADCAST_CHANNEL);
    bc.onmessage = () => load("BroadcastChannel (otra pestaña)");
    return () => bc.close();
  }, [load]);

  // Realtime: la cola de Pendientes depende de otro dispositivo (el
  // profesional envía desde su celular, Caja mira desde otro aparato) — sin
  // esto, Caja solo se enteraba de un envío nuevo si recargaba la página a
  // mano, porque el resto de los listeners de acá arriba son solo
  // same-tab/same-browser (CustomEvent, storage).
  React.useEffect(() => {
    if (!businessId) return;
    const channel = supabase
      .channel(`caja-pendientes-${businessId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `business_id=eq.${businessId}` },
        (payload) => load(`realtime appointments ${payload.eventType} id=${(payload.new as { id?: string } | null)?.id ?? (payload.old as { id?: string } | null)?.id ?? "?"}`),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "business_settings", filter: `business_id=eq.${businessId}` },
        (payload) => load(`realtime business_settings ${payload.eventType}`),
      )
      .subscribe((status) => {
        // eslint-disable-next-line no-console
        console.log(`[Caja refresh] canal realtime status: ${status}`);
      });
    return () => { supabase.removeChannel(channel); };
  }, [businessId, load]);

  // Auto-close at midnight if session is still open
  React.useEffect(() => {
    if (!businessId) return;

    const scheduleAutoClose = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setDate(midnight.getDate() + 1);
      midnight.setHours(0, 0, 10, 0); // 00:00:10 next day
      const msUntilMidnight = midnight.getTime() - now.getTime();

      const timer = setTimeout(async () => {
        // Re-fetch to get latest open session
        const { data: openSess } = await supabase
          .from("cash_sessions")
          .select("id,status,business_id")
          .eq("business_id", businessId)
          .eq("status", "open")
          .limit(1)
          .maybeSingle();

        if (openSess?.id) {
          await supabase.from("cash_sessions").update({
            status: "closed",
            closed_at: new Date().toISOString(),
            close_type: "cierre_automatico",
          }).eq("id", openSess.id);

          // Log event
          try {
            await supabase.from("cash_session_events").insert({
              business_id: businessId,
              session_id: openSess.id,
              action_type: "cierre_automatico",
              user_id: null,
              observation: "Cierre automático al finalizar la jornada",
              occurred_at: new Date().toISOString(),
            });
          } catch { /* ignore */ }
        }

        load();
      }, msUntilMidnight);

      return timer;
    };

    const timer = scheduleAutoClose();
    return () => clearTimeout(timer);
  }, [businessId, load]);

  const setApprovalMode = React.useCallback(async (m: ApprovalMode) => {
    setApprovalModeState(m);
    if (!businessId) return;
    try {
      const { data: existingRow } = await supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle();

      const { error } = await supabase.from("business_settings")
        .upsert(
          { business_id: businessId, approval_mode: m, schedule: existingRow?.schedule ?? {} },
          { onConflict: "business_id" },
        );

      if (error) throw error;
      window.dispatchEvent(new CustomEvent("clippr:caja-settings-updated"));
    } catch (e) {
      console.warn("[caja] setApprovalMode failed:", (e as Error).message);
    }
  }, [businessId]);

  const revHoy = paymentsToday.reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
  const cobros = paymentsToday.length;
  const ticket = cobros > 0 ? Math.round(revHoy / cobros) : 0;
  const totalGastos = expensesToday.reduce((s, e) => s + Number(e.amount ?? 0), 0);

  return {
    loading, businessId, profileId: profile?.id ?? null,
    approvalMode, setApprovalMode, approvalModeEnabled,
    paymentMethods,
    services, employees, promotions,
    paymentsToday, expensesToday, cashSessionId,
    cajaStatus,
    revHoy, cobros, ticket, totalGastos,
    pendingCount, pendingAmount, pendingCharges,
    pendingCountPrevious, pendingAmountPrevious, pendingChargesPrevious,
    employeeServiceOverrides,
    employeeCommissions,
    refresh: (reason?: string) => load(reason ?? "manual refresh() call"),
  };
}
