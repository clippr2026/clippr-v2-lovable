import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCashMovements, type CashMovement, type ProfessionalAdvance } from "@/hooks/use-cash-movements";
import {
  cajaOpenRangeStartDate,
  cajaDateKey,
  cajaDateKeyBA,
  filterToDayBA,
  computeExpectedCashAndDigital,
  getDigitalCarryForward,
  type PendingCierre,
  type ExpectedCashDigital,
} from "@/lib/caja-cierre";
import type { Payment, Expense, HistorialEvento, PaymentCollectionRow } from "@/components/cash-register/use-caja-data";
import { fetchAllRows, type PageResult } from "@/lib/supabase-paginate";

// Mismo criterio que pagedSettled en use-caja-data.ts, pero sin el
// envoltorio {status,value} — este archivo lee payRes.data/payRes.error
// directo (Promise.all con query builders planos), nunca
// Promise.allSettled. Nunca "rechaza": un error de paginación queda en
// `error`, igual que un error de Supabase en cualquier otra query acá.
async function pagedResult<T>(
  queryPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  try {
    const data = await fetchAllRows(queryPage);
    return { data, error: null };
  } catch (e) {
    return { data: null, error: { message: (e as Error).message } };
  }
}

// Fuente única de "Ingresos" / "Efectivo esperado en caja" / "Dinero
// esperado en cuenta" / "Últimos ingresos" (el array de payments del
// período abierto) — reemplaza las DOS queries independientes que
// convivían hasta ahora:
//   - loadDashboard (use-dashboard-data.ts) calculaba su propio revHoy
//   - useCajaHoy (use-caja-hoy.ts) calculaba cashExpected/digitalExpected
//     con otra query de payments separada
//   - useCajaData (use-caja-data.ts) calculaba un TERCER paymentsToday,
//     el que terminaba mostrando Caja — y era el que corría más riesgo de
//     quedar en $0 por todo lo operativo que carga alrededor (pendientes,
//     profesionales, configuraciones, realtime).
// Inicio (vía useCajaHoy, que ahora delega acá) y Caja (Facturación)
// consumen este mismo hook para estos 4 valores — revHoy/cobros salen de
// la MISMA paymentsToday que alimenta cashExpected/digitalExpected, nunca
// de una tercera consulta.

// Última lista de pendientes conocida por negocio+sucursal, en memoria
// (nunca persistida — se pierde al recargar la página a propósito, para
// no mostrar nunca un dato financiero viejo como si fuera definitivo).
// Solo sirve para no repintar el esqueleto de carga al volver a montar el
// hook DENTRO de la misma sesión de la SPA (ej. navegar Inicio → Caja →
// Inicio) — se pinta de entrada y se corrige solo, en silencio, en cuanto
// termina el fetch real (realtime/focus ya se encargan de mantenerlo al
// día mientras tanto).
const pendingCierresCache = new Map<string, PendingCierre[]>();
function pendingCierresCacheKey(businessId: string | null, branchId: string | null) {
  return `${businessId ?? ""}:${branchId ?? ""}`;
}

export type CajaSummary = {
  loading: boolean;
  // Aviso "Tenés N cajas pendientes" — deliberadamente INDEPENDIENTE de
  // `loading`: antes pendingCierres solo se confirmaba al final de TODO
  // el pipeline (pagos + gastos + movimientos + carry-forward +
  // historial de turnos), así que el aviso tardaba tanto como la parte
  // más lenta del panel de Facturación aunque la detección de pendientes
  // en sí ya hubiera terminado hace rato. Ahora se resuelve apenas
  // termina cajaOpenRangeStartDate (rápido, ver caja-cierre.ts), sin
  // esperar al resto.
  pendingCierresLoading: boolean;
  paymentsToday: Payment[];
  expensesToday: Expense[];
  // Cobros de pendientes de HOY (payment_collections, por collected_at) —
  // separados de paymentsToday a propósito: no son una venta nueva, son
  // dinero que entró hoy por una venta de cualquier fecha. Ver "Cobro de
  // pendiente" en Últimos ingresos/Revisar cierre.
  collectionsToday: PaymentCollectionRow[];
  revHoy: number;
  cobros: number;
  totalGastosHoy: number;
  cashExpected: number;
  cashOutflows: number;
  cashInflows: number;
  digitalExpected: number;
  digitalOutflows: number;
  // digitalExpected + carry-forward del último cierre — "Dinero esperado en
  // cuenta" no se resetea cada cierre como el efectivo (ver
  // getDigitalCarryForward en caja-cierre.ts).
  bankExpected: number;
  // "Efectivo del día"/"Dinero en cuenta del día" — SOLO hoy, nunca el
  // acumulado de jornadas pendientes (eso es cashExpected/bankExpected,
  // sección "Saldos acumulados"). Mismo criterio que revHoy/totalGastosHoy.
  todayCashExpected: number;
  todayDigitalExpected: number;
  // Desglose completo de hoy (cobros/ingresos manuales/gastos/retiros/
  // adelantos, efectivo y digital por separado) — mismos 9 campos que ya
  // usa la Conciliación de "Revisar cierre", para que un saldo negativo en
  // Inicio/Caja nunca quede sin explicación: "por qué da esto" es siempre
  // un clic, nunca hay que adivinar ni auditar la base a mano. Única
  // fuente (computeExpectedCashAndDigital), igual que todayCashExpected/
  // todayDigitalExpected — nunca un segundo cálculo aparte.
  todayExpectedFull: ExpectedCashDigital;
  pendingCierre: PendingCierre | null;
  // TODAS las jornadas con actividad sin cerrar (no solo la más vieja, que
  // es la única que pendingCierre reporta porque es la que define desde
  // cuándo arranca el período operativo de hoy) — para el aviso "Tenés N
  // cajas pendientes" (ver findAllPendingCierres en caja-cierre.ts).
  pendingCierres: PendingCierre[];
  rangeStartDate: string;
  refresh: (reason?: string) => Promise<void>;
};

export function useCajaSummary(businessId: string | null, branchId: string | null): CajaSummary {
  const { branchesLoading } = useAuth();

  const liveKeyRef = React.useRef<{ businessId: string | null; branchId: string | null }>({
    businessId,
    branchId,
  });
  liveKeyRef.current = { businessId, branchId };

  const [loading, setLoading] = React.useState(true);
  const [paymentsToday, setPaymentsToday] = React.useState<Payment[]>([]);
  const [expensesToday, setExpensesToday] = React.useState<Expense[]>([]);
  const [pendingCierre, setPendingCierre] = React.useState<PendingCierre | null>(null);
  const [pendingCierres, setPendingCierres] = React.useState<PendingCierre[]>(
    () => pendingCierresCache.get(pendingCierresCacheKey(businessId, branchId)) ?? [],
  );
  // Si ya había un valor en caché para este negocio+sucursal, no hace
  // falta mostrar el esqueleto de nuevo — se repinta con el valor viejo
  // (nunca como definitivo: el fetch real ya está en camino y lo corrige
  // solo) mientras se confirma en segundo plano.
  const [pendingCierresLoading, setPendingCierresLoading] = React.useState(
    () => !pendingCierresCache.has(pendingCierresCacheKey(businessId, branchId)),
  );
  const [rangeStartDate, setRangeStartDate] = React.useState(cajaDateKey());
  const [cashExpected, setCashExpected] = React.useState(0);
  const [cashOutflows, setCashOutflows] = React.useState(0);
  const [cashInflows, setCashInflows] = React.useState(0);
  const [digitalExpected, setDigitalExpected] = React.useState(0);
  const [digitalOutflows, setDigitalOutflows] = React.useState(0);
  const [bankExpected, setBankExpected] = React.useState(0);
  // Crudos del período abierto (puede abarcar varias jornadas pendientes)
  // — se guardan para poder derivar, más abajo, "Efectivo del día"/"Dinero
  // en cuenta del día" acotados a estrictamente HOY, sin una segunda
  // consulta aparte (mismo criterio que paymentsToday/expensesToday).
  const [movementsForPeriod, setMovementsForPeriod] = React.useState<CashMovement[]>([]);
  const [advancesForPeriod, setAdvancesForPeriod] = React.useState<ProfessionalAdvance[]>([]);
  // Cobros de pagos pendientes (payment_collections) del período abierto —
  // mismo criterio que movementsForPeriod/advancesForPeriod: crudo acá,
  // "estrictamente hoy" se deriva más abajo sin una segunda consulta.
  const [collectionsForPeriod, setCollectionsForPeriod] = React.useState<PaymentCollectionRow[]>([]);

  // cash_movements + professional_advances del período abierto — misma
  // fuente que ya usa Caja (CierreCajaBtn) para Ingresar/Retirar dinero.
  // Esta instancia de useCashMovements es independiente de la que usa
  // MovimientosUnificados/FacturacionPanel en cash-register.tsx (esa vive
  // en el componente, esta acá adentro del hook) — registerMovement() de
  // UNA no actualiza el `movements`/`advances` reactivo de la OTRA. Por
  // eso runLoad no lee ese estado reactivo ni un ref con su último valor:
  // llama a refreshMovementsRef.current() (el `refresh` de ESTA instancia)
  // explícitamente antes de calcular expected, así siempre tiene el dato
  // recién pedido a Supabase sin importar qué otra instancia disparó el
  // insert. Sin esto, Ingresar/Retirar dinero actualizaba la lista de
  // movimientos pero "Efectivo esperado en caja"/"Dinero esperado en
  // cuenta" quedaban con el valor viejo hasta el próximo trigger no
  // relacionado (realtime, cambio de pestaña).
  const { refresh: refreshMovements } = useCashMovements(businessId, branchId, rangeStartDate);
  const refreshMovementsRef = React.useRef(refreshMovements);
  refreshMovementsRef.current = refreshMovements;

  const hasLoadedRef = React.useRef(false);

  // Single-flight + 1 recarga pendiente — mismo esquema que use-caja-data.ts
  // (ver ese archivo para el motivo completo): con múltiples disparadores
  // (mount, cambio de sucursal, realtime, BroadcastChannel, eventos de
  // gasto/cierre guardado) nunca puede haber más de un fetch en vuelo, y
  // nunca más de una recarga encolada detrás de ese fetch.
  const inFlightRef = React.useRef(false);
  const reloadRequestedRef = React.useRef(false);
  const reloadReasonRef = React.useRef("");
  const chainRef = React.useRef<Promise<void>>(Promise.resolve());

  const runLoad = React.useCallback(async (_reason: string = "unknown") => {
    const { businessId, branchId } = liveKeyRef.current;
    // eslint-disable-next-line no-console
    console.log(`[CajaSummary] runLoad start reason=${_reason} businessId=${businessId} branchId=${branchId}`);
    if (!businessId) {
      setLoading(false);
      setPendingCierresLoading(false);
      return;
    }
    const keyMatches = () =>
      liveKeyRef.current.businessId === businessId && liveKeyRef.current.branchId === branchId;

    if (!hasLoadedRef.current) setLoading(true);
    setPendingCierresLoading(true);

    // Única fuente del período vigente: cash_sessions (ver
    // cajaOpenRangeStartDate en caja-cierre.ts) — nunca caja_cierres.estado.
    // startAt es el instante exacto (no medianoche) si hubo una reapertura,
    // para no recontar pagos que ya quedaron en el cierre anterior.
    const period = await cajaOpenRangeStartDate(businessId, branchId).catch((e) => {
      console.error("[CajaSummary] cajaOpenRangeStartDate error:", e);
      const today = cajaDateKey();
      return {
        startAt: new Date(`${today}T00:00:00`),
        rangeStartDate: today,
        pendingCierre: null,
        openSessionId: null,
        allPendingCierres: [] as PendingCierre[],
      };
    });
    if (!keyMatches()) {
      console.log("[CajaSummary] discarded after cajaOpenRangeStartDate (key changed)");
      return;
    }

    const pending = period.pendingCierre;
    const newRangeStartDate = period.rangeStartDate;
    const dayStart = period.startAt;
    const dayEnd = new Date(); // hasta ahora, nunca un fin de "hoy" fijo

    // Comprometer el aviso de pendientes YA — sin esperar al resto del
    // pipeline (pagos/gastos/movimientos/carry-forward, más abajo), que
    // puede tardar mucho más con negocios con historial grande. Esto es
    // lo que antes hacía que el aviso "Tenés N cajas pendientes" tardara
    // tanto como la parte más lenta de todo Facturación.
    setPendingCierre(pending);
    setPendingCierres(period.allPendingCierres);
    setPendingCierresLoading(false);
    pendingCierresCache.set(pendingCierresCacheKey(businessId, branchId), period.allPendingCierres);

    // branch_id = null nunca se excluye (.or en vez de .eq) — mismo criterio
    // que use-caja-data.ts/use-dashboard-data.ts: una fila real (vieja, o
    // nacida antes de que activeBranchId resolviera) no puede faltar acá
    // solo porque quedó con branch_id null.
    const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

    let payQuery = supabase
      .from("payments")
      .select(
        "id,business_id,total,amount,method,payment_method,splits,client_name,service_name,created_at,employee_id,appointment_id,charged_by,charge_type,status,collected_amount,charged_at,observations,discount,original_amount,tip_amount,items,receipt_path",
      )
      .eq("business_id", businessId)
      .gte("created_at", dayStart.toISOString())
      .lte("created_at", dayEnd.toISOString());
    if (branchFilter) payQuery = payQuery.or(branchFilter);
    // order("id") desempata created_at iguales — paginación determinística
    // (fetchAllRows/pagedResult, ver abajo), sin cambiar el orden visible.
    payQuery = payQuery.order("created_at", { ascending: false }).order("id", { ascending: true });

    // Cobros de pagos pendientes (payment_collections) del mismo período —
    // por collected_at (fecha REAL del cobro), nunca por la fecha de la
    // venta original. Es lo que hace que un pendiente cobrado hoy (de
    // cualquier día anterior) aparezca en la caja de HOY, y que una venta
    // pendiente/parcial nunca "aparente" estar cobrada completa (ver
    // computeExpectedCashAndDigital, que ahora ignora total/amount de
    // cualquier payments.status en pendiente/parcial y usa esto en su
    // lugar).
    let collQuery = supabase
      .from("payment_collections")
      .select("id,payment_id,amount,method,branch_id,collected_at,payments(client_name,service_name,employee_id)")
      .eq("business_id", businessId)
      .gte("collected_at", dayStart.toISOString())
      .lte("collected_at", dayEnd.toISOString());
    if (branchFilter) collQuery = collQuery.or(branchFilter);
    collQuery = collQuery.order("collected_at", { ascending: false });

    let expQuery = supabase
      .from("expenses")
      .select(
        "id,name,amount,type,category,payment_method,date,note,created_at,user_id,user_name,user_email,created_by",
      )
      .eq("business_id", businessId)
      .gte("date", newRangeStartDate)
      .lte("date", cajaDateKey());
    if (branchFilter) expQuery = expQuery.or(branchFilter);
    expQuery = expQuery.order("created_at", { ascending: false }).order("id", { ascending: true });

    // findAllPendingCierres ya NO se vuelve a pedir acá — period.allPendingCierres
    // (comprometido arriba, apenas resolvió cajaOpenRangeStartDate) es el
    // mismo dato; pedirlo de nuevo era la "repetición de consultas" que
    // duplicaba esta query pesada en cada carga.
    //
    // payQuery/expQuery paginadas (fetchAllRows, mismo helper que ya
    // protege Liquidaciones/Caja) — sin perder filas en negocios con
    // backlog largo + mucho volumen. Todas arrancan YA (sin `await`
    // todavía); payRes se espera primero y SOLO para poder lanzar el
    // lookup de cobro_events apenas se conocen los appointment_id de hoy,
    // en paralelo con expenses/carryForward/movimientos (que ya vienen en
    // vuelo desde acá) — nunca como una cola serial después de esperar
    // TODO lo demás.
    const payResultPromise = pagedResult<Payment>((from, to) => payQuery.range(from, to));
    const expResultPromise = pagedResult<Expense>((from, to) => expQuery.range(from, to));
    // any acá: el embed payments(...) hace que postgrest-js infiera
    // `payments` como array (cardinalidad no detectable desde un .select()
    // armado como string) aunque en runtime, por la FK payment_id → id
    // (muchos-a-uno), sea siempre 0 o 1 fila — se normaliza a objeto único
    // (o null) más abajo, al construir collectionsList.
    const collResultPromise = pagedResult<any>((from, to) => collQuery.range(from, to));
    const carryForwardPromise = getDigitalCarryForward(businessId, branchId);
    const freshMovementsPromise = refreshMovementsRef.current();

    const payRes = await payResultPromise;
    if (!keyMatches()) {
      console.log("[CajaSummary] discarded after payQuery (key changed)");
      return;
    }
    const paymentsRaw = (payRes.error ? [] : (payRes.data ?? [])) as Payment[];

    // `payments` no tiene cobro_events (esa columna vive en `appointments`)
    // — se trae acá aparte, solo para los appointment_id presentes en el
    // período, igual que hace use-caja-data.ts, para que "Últimos ingresos"
    // muestre "Envió a caja"/"Cobró" con el usuario real.
    const paymentApptIds = Array.from(
      new Set(paymentsRaw.map((p) => p.appointment_id).filter((id): id is string => !!id)),
    );
    const apptHistPromise = paymentApptIds.length > 0
      ? supabase.from("appointments").select("id,cobro_events").eq("business_id", businessId).in("id", paymentApptIds)
      : Promise.resolve({ data: [] as Array<{ id: string; cobro_events: unknown }> });

    const [expRes, collRes, carryForward, freshMovements, apptHistResult] = await Promise.all([
      expResultPromise,
      collResultPromise,
      carryForwardPromise,
      freshMovementsPromise,
      apptHistPromise,
    ]);
    console.log(
      `[CajaSummary] payQuery rango=[${dayStart.toISOString()} .. ${dayEnd.toISOString()}] branchFilter=${branchFilter} ` +
        `-> rows=${payRes.data?.length ?? 0} error=${payRes.error?.message ?? "none"} | ` +
        `expenses rows=${expRes.data?.length ?? 0} error=${expRes.error?.message ?? "none"} carryForward=${carryForward}`,
    );
    if (!keyMatches()) {
      console.log("[CajaSummary] discarded after payQuery/expQuery (key changed)");
      return;
    }

    const expensesList = (expRes.error ? [] : (expRes.data ?? [])) as Expense[];
    const collectionsList: PaymentCollectionRow[] = (collRes.error ? [] : (collRes.data ?? [])).map(
      (row: Record<string, unknown>) => ({
        id: String(row.id),
        payment_id: String(row.payment_id),
        amount: Number(row.amount ?? 0),
        method: (row.method as string | null) ?? null,
        branch_id: (row.branch_id as string | null) ?? null,
        collected_at: String(row.collected_at),
        payments: Array.isArray(row.payments) ? (row.payments[0] ?? null) : (row.payments as PaymentCollectionRow["payments"]) ?? null,
      }),
    );

    const apptHistMap: Record<string, HistorialEvento[]> = {};
    for (const row of apptHistResult.data ?? []) {
      const events = (Array.isArray(row.cobro_events) ? row.cobro_events : []) as HistorialEvento[];
      if (events.length) apptHistMap[row.id as string] = events;
    }

    const PAY_HIST_MARKER = "[[HIST]]";
    const paymentsEnriched: Payment[] = paymentsRaw.map((p) => {
      let events: HistorialEvento[] = [];
      const rawObs = String(p.observations ?? "");
      if (rawObs.startsWith(PAY_HIST_MARKER)) {
        try {
          events = JSON.parse(rawObs.slice(PAY_HIST_MARKER.length));
        } catch {
          events = [];
        }
      } else if (p.appointment_id && apptHistMap[p.appointment_id]) {
        events = apptHistMap[p.appointment_id];
      }
      const sendEvent = events.find((e) => e.action === "Envió a caja");
      return { ...p, cobro_events: events, sort_ts: sendEvent?.ts ?? p.created_at };
    });
    paymentsEnriched.sort((a, b) => (b.sort_ts ?? "").localeCompare(a.sort_ts ?? ""));

    const expected = computeExpectedCashAndDigital({
      payments: paymentsEnriched,
      expenses: expensesList,
      advances: freshMovements.advances,
      cashMovements: freshMovements.movements,
      collections: collectionsList,
    });

    if (!keyMatches()) {
      console.log("[CajaSummary] discarded right before commit (key changed)");
      return;
    }

    console.log(
      `[CajaSummary] COMMIT paymentsToday=${paymentsEnriched.length} revHoy=${paymentsEnriched.reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0)} ` +
        `cashExpected=${expected.cashExpected} digitalExpected=${expected.digitalExpected} carryForward=${carryForward}`,
    );
    setPaymentsToday(paymentsEnriched);
    setExpensesToday(expensesList);
    setRangeStartDate(newRangeStartDate);
    setCashExpected(expected.cashExpected);
    setCashOutflows(expected.cashOutflows);
    setCashInflows(expected.cashInflows);
    setDigitalExpected(expected.digitalExpected);
    setDigitalOutflows(expected.digitalOutflows);
    setBankExpected(expected.digitalExpected + carryForward);
    setMovementsForPeriod(freshMovements.movements);
    setAdvancesForPeriod(freshMovements.advances);
    setCollectionsForPeriod(collectionsList);

    hasLoadedRef.current = true;
    setLoading(false);
    // Deps vacías a propósito — runLoad lee liveKeyRef.current/
    // refreshMovementsRef.current al entrar (igual que use-caja-data.ts),
    // nunca cierra sobre businessId/branchId ni sobre refreshMovements.
    // Mantiene esta identidad estable, así requestReload (y los efectos que
    // dependen de ella: realtime, BroadcastChannel, CustomEvent) no se
    // recrean en cada cambio de movimiento.
  }, []);

  const requestReload = React.useCallback(
    (reason: string): Promise<void> => {
      if (inFlightRef.current) {
        reloadRequestedRef.current = true;
        reloadReasonRef.current = reason;
        return chainRef.current;
      }
      inFlightRef.current = true;
      const run: Promise<void> = runLoad(reason)
        .catch((e) => {
          console.error("[CajaSummary] runLoad error:", (e as Error)?.message ?? e);
        })
        .then((): Promise<void> | void => {
          inFlightRef.current = false;
          if (reloadRequestedRef.current) {
            reloadRequestedRef.current = false;
            const nextReason = reloadReasonRef.current;
            reloadReasonRef.current = "";
            return requestReload(`queued: ${nextReason}`);
          }
        });
      chainRef.current = run;
      return run;
    },
    [runLoad],
  );

  // Montaje inicial / cambio real de negocio o sucursal — espera a que
  // branchesLoading esté resuelto, mismo motivo que use-caja-data.ts: null
  // mientras se resuelve la sucursal real no es "sin sucursal".
  React.useEffect(() => {
    console.log(`[CajaSummary] mount effect businessId=${businessId} branchId=${branchId} branchesLoading=${branchesLoading}`);
    if (!businessId) return;
    if (branchesLoading) return;
    void requestReload("mount / businessId o sucursal cambió");
  }, [businessId, branchId, branchesLoading, requestReload]);

  // Un gasto o un cierre guardado cambian directamente estos números
  // (egresos, carry-forward, rango) — en Caja y en Inicio (closeVencida usa
  // el mismo closeCierreForDate que dispara este evento).
  React.useEffect(() => {
    const onChanged = () => void requestReload("custom event: clippr:gasto-guardado o clippr:caja-cierre-guardado");
    window.addEventListener("clippr:gasto-guardado", onChanged);
    window.addEventListener("clippr:caja-cierre-guardado", onChanged);
    return () => {
      window.removeEventListener("clippr:gasto-guardado", onChanged);
      window.removeEventListener("clippr:caja-cierre-guardado", onChanged);
    };
  }, [requestReload]);

  // Mismas señales same-tab/cross-tab que ya usa useCajaData para
  // pendientes — un cobro nuevo pasa por ahí (enviar/cobrar/rechazar).
  React.useEffect(() => {
    const onManualPending = () => void requestReload("custom event: clippr:manual-pending-updated");
    window.addEventListener("clippr:manual-pending-updated", onManualPending);
    return () => window.removeEventListener("clippr:manual-pending-updated", onManualPending);
  }, [requestReload]);

  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel("clippr-caja-pendientes");
    bc.onmessage = () => void requestReload("BroadcastChannel (otra pestaña)");
    return () => bc.close();
  }, [requestReload]);

  // Realtime: igual que use-caja-data.ts — un cobro de turno actualiza
  // appointments.cobro_events/status, así que una venta cobrada en otro
  // dispositivo llega acá aunque esa pestaña nunca llame a refresh().
  React.useEffect(() => {
    if (!businessId) return;
    const channel = supabase
      .channel(`caja-summary-${businessId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `business_id=eq.${businessId}` },
        () => void requestReload("realtime appointments"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "business_settings", filter: `business_id=eq.${businessId}` },
        () => void requestReload("realtime business_settings"),
      )
      .on(
        // Si otro dispositivo confirma (o reabre) un cierre, el aviso
        // "Caja vencida"/pendingCierres de ESTE dispositivo tiene que
        // actualizarse solo — el CustomEvent que dispara closeSingleDayCierre
        // es same-tab, no cruza dispositivos; esto es lo que sí cruza.
        "postgres_changes",
        { event: "*", schema: "public", table: "caja_cierres", filter: `business_id=eq.${businessId}` },
        () => void requestReload("realtime caja_cierres"),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId, requestReload]);

  // Red de seguridad además de Realtime: si la conexión se cortó un
  // instante o la pestaña estuvo en background, volver a ella siempre
  // refresca — nunca deja el aviso de caja pendiente desactualizado
  // esperando a que Realtime reconecte solo (ver sección 6 del pedido).
  React.useEffect(() => {
    function onFocus() {
      void requestReload("window focus (red de seguridad de Realtime)");
    }
    function onVisibility() {
      if (document.visibilityState === "visible") onFocus();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [requestReload]);

  // "Ingresos"/"Gastos" son una métrica DIARIA — se muestran como "lo que
  // facturó HOY", nunca como el acumulado desde el último cierre (eso es
  // cashExpected/digitalExpected, que a propósito sigue usando
  // paymentsToday/expensesToday completos, backlog incluido, calculados
  // arriba con computeExpectedCashAndDigital). Si el 13/10 quedó sin
  // cerrar, paymentsToday puede traer también pagos del 13/10 — p
  // ara estos dos números se acotan explícitamente al día calendario de
  // HOY en huso horario de Buenos Aires, sin importar cuánto backlog haya.
  const todayKeyBA = cajaDateKeyBA();
  const paymentsStrictlyToday = filterToDayBA(paymentsToday, (p) => p.created_at, todayKeyBA);
  const expensesStrictlyToday = expensesToday.filter((e) => e.date === todayKeyBA);
  // Cobros de pendientes de HOY (por collected_at, no por la fecha de la
  // venta) — un pendiente/parcial de cualquier día anterior cobrado hoy
  // cuenta como ingreso de HOY; la venta pendiente en sí nunca aporta su
  // total/amount acá (ver computeExpectedCashAndDigital).
  const collectionsStrictlyToday = filterToDayBA(collectionsForPeriod, (c) => c.collected_at, todayKeyBA);
  const revHoy =
    paymentsStrictlyToday.reduce(
      (s, p) => s + (p.status === "pendiente" || p.status === "parcial" ? 0 : Number(p.total ?? p.amount ?? 0)),
      0,
    ) + collectionsStrictlyToday.reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const cobros = paymentsStrictlyToday.length;
  const totalGastosHoy = expensesStrictlyToday.reduce((s, e) => s + Number(e.amount ?? 0), 0);

  // "Efectivo del día"/"Dinero en cuenta del día" — a diferencia de
  // cashExpected/digitalExpected (acumulado de TODO el backlog pendiente,
  // sección "Saldos acumulados"), esto es el movimiento neto de efectivo/
  // cuenta de HOY exclusivamente: mismos ingresos/retiros manuales y
  // adelantos que ya usa computeExpectedCashAndDigital, pero acotados al
  // día calendario de hoy en huso Buenos Aires. Nunca se mezclan: un cierre
  // pendiente de una jornada anterior no puede inflar "hoy".
  const movementsStrictlyToday = filterToDayBA(movementsForPeriod, (m) => m.created_at, todayKeyBA);
  const advancesStrictlyToday = filterToDayBA(advancesForPeriod, (a) => a.advanced_at, todayKeyBA);
  const todayExpected = computeExpectedCashAndDigital({
    payments: paymentsStrictlyToday,
    expenses: expensesStrictlyToday,
    advances: advancesStrictlyToday,
    cashMovements: movementsStrictlyToday,
    collections: collectionsStrictlyToday,
  });

  return {
    loading,
    paymentsToday,
    expensesToday,
    collectionsToday: collectionsStrictlyToday,
    revHoy,
    cobros,
    totalGastosHoy,
    cashExpected,
    cashOutflows,
    cashInflows,
    digitalExpected,
    digitalOutflows,
    bankExpected,
    todayCashExpected: todayExpected.cashExpected,
    todayDigitalExpected: todayExpected.digitalExpected,
    todayExpectedFull: todayExpected,
    pendingCierre,
    pendingCierres,
    pendingCierresLoading,
    rangeStartDate,
    refresh: (reason?: string) => requestReload(reason ?? "manual refresh() call"),
  };
}
