import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCashMovements } from "@/hooks/use-cash-movements";
import {
  cajaOpenRangeStartDate,
  cajaDateKey,
  computeExpectedCashAndDigital,
  getDigitalCarryForward,
  type PendingCierre,
} from "@/lib/caja-cierre";
import type { Payment, Expense, HistorialEvento } from "@/components/cash-register/use-caja-data";

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

export type CajaSummary = {
  loading: boolean;
  paymentsToday: Payment[];
  expensesToday: Expense[];
  revHoy: number;
  cobros: number;
  cashExpected: number;
  cashOutflows: number;
  digitalExpected: number;
  digitalOutflows: number;
  // digitalExpected + carry-forward del último cierre — "Dinero esperado en
  // cuenta" no se resetea cada cierre como el efectivo (ver
  // getDigitalCarryForward en caja-cierre.ts).
  bankExpected: number;
  pendingCierre: PendingCierre | null;
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
  const [rangeStartDate, setRangeStartDate] = React.useState(cajaDateKey());
  const [cashExpected, setCashExpected] = React.useState(0);
  const [cashOutflows, setCashOutflows] = React.useState(0);
  const [digitalExpected, setDigitalExpected] = React.useState(0);
  const [digitalOutflows, setDigitalOutflows] = React.useState(0);
  const [bankExpected, setBankExpected] = React.useState(0);

  // cash_movements + professional_advances del período abierto — misma
  // fuente que ya usa Caja (CierreCajaBtn) para Ingresar/Retirar dinero.
  const { movements, advances } = useCashMovements(businessId, branchId, rangeStartDate);
  // Leído por runLoad vía ref (no por closure/deps) — mismo motivo que
  // liveKeyRef: si movements/advances cambiaran deps de runLoad, cada
  // cambio recrearía requestReload y con él TODOS los efectos que dependen
  // de su identidad (realtime, BroadcastChannel, CustomEvent), resuscribiendo
  // el canal de Supabase sin necesidad en cada movimiento registrado.
  const movementsRef = React.useRef({ movements, advances });
  movementsRef.current = { movements, advances };

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
      return;
    }
    const keyMatches = () =>
      liveKeyRef.current.businessId === businessId && liveKeyRef.current.branchId === branchId;

    if (!hasLoadedRef.current) setLoading(true);

    // Única fuente del período vigente: cash_sessions (ver
    // cajaOpenRangeStartDate en caja-cierre.ts) — nunca caja_cierres.estado.
    // startAt es el instante exacto (no medianoche) si hubo una reapertura,
    // para no recontar pagos que ya quedaron en el cierre anterior.
    const period = await cajaOpenRangeStartDate(businessId, branchId).catch((e) => {
      console.error("[CajaSummary] cajaOpenRangeStartDate error:", e);
      const today = cajaDateKey();
      return { startAt: new Date(`${today}T00:00:00`), rangeStartDate: today, pendingCierre: null, openSessionId: null };
    });
    if (!keyMatches()) {
      console.log("[CajaSummary] discarded after cajaOpenRangeStartDate (key changed)");
      return;
    }

    const pending = period.pendingCierre;
    const newRangeStartDate = period.rangeStartDate;
    const dayStart = period.startAt;
    const dayEnd = new Date(); // hasta ahora, nunca un fin de "hoy" fijo

    // branch_id = null nunca se excluye (.or en vez de .eq) — mismo criterio
    // que use-caja-data.ts/use-dashboard-data.ts: una fila real (vieja, o
    // nacida antes de que activeBranchId resolviera) no puede faltar acá
    // solo porque quedó con branch_id null.
    const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

    let payQuery = supabase
      .from("payments")
      .select(
        "id,business_id,total,amount,method,payment_method,client_name,service_name,created_at,employee_id,appointment_id,charged_by,charge_type,status,charged_at,observations,discount,original_amount,tip_amount,items,receipt_path",
      )
      .eq("business_id", businessId)
      .gte("created_at", dayStart.toISOString())
      .lte("created_at", dayEnd.toISOString());
    if (branchFilter) payQuery = payQuery.or(branchFilter);
    payQuery = payQuery.order("created_at", { ascending: false });

    let expQuery = supabase
      .from("expenses")
      .select(
        "id,name,amount,type,category,payment_method,date,note,created_at,user_id,user_name,user_email,created_by",
      )
      .eq("business_id", businessId)
      .gte("date", newRangeStartDate)
      .lte("date", cajaDateKey());
    if (branchFilter) expQuery = expQuery.or(branchFilter);
    expQuery = expQuery.order("created_at", { ascending: false });

    const [payRes, expRes, carryForward] = await Promise.all([
      payQuery,
      expQuery,
      getDigitalCarryForward(businessId, branchId),
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

    const paymentsRaw = (payRes.error ? [] : (payRes.data ?? [])) as Payment[];
    const expensesList = (expRes.error ? [] : (expRes.data ?? [])) as Expense[];

    // `payments` no tiene cobro_events (esa columna vive en `appointments`)
    // — se trae acá aparte, solo para los appointment_id presentes en el
    // período, igual que hace use-caja-data.ts, para que "Últimos ingresos"
    // muestre "Envió a caja"/"Cobró" con el usuario real.
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
    if (!keyMatches()) return;

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
      advances: movementsRef.current.advances,
      cashMovements: movementsRef.current.movements,
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
    setPendingCierre(pending);
    setRangeStartDate(newRangeStartDate);
    setCashExpected(expected.cashExpected);
    setCashOutflows(expected.cashOutflows);
    setDigitalExpected(expected.digitalExpected);
    setDigitalOutflows(expected.digitalOutflows);
    setBankExpected(expected.digitalExpected + carryForward);

    hasLoadedRef.current = true;
    setLoading(false);
    // Deps vacías a propósito — runLoad lee liveKeyRef.current/movementsRef.current
    // al entrar (igual que use-caja-data.ts), nunca cierra sobre
    // businessId/branchId ni sobre movements/advances. Mantiene esta
    // identidad estable, así requestReload (y los efectos que dependen de
    // ella: realtime, BroadcastChannel, CustomEvent) no se recrean en cada
    // cambio de movimiento.
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
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId, requestReload]);

  const revHoy = paymentsToday.reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
  const cobros = paymentsToday.length;

  return {
    loading,
    paymentsToday,
    expensesToday,
    revHoy,
    cobros,
    cashExpected,
    cashOutflows,
    digitalExpected,
    digitalOutflows,
    bankExpected,
    pendingCierre,
    rangeStartDate,
    refresh: (reason?: string) => requestReload(reason ?? "manual refresh() call"),
  };
}
