import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  findPendingCierre,
  closeCierreForDate,
  cajaOpenRangeStartDate,
  computeExpectedCashAndDigital,
  getDigitalCarryForward,
  cajaDateKey,
  type PendingCierre,
} from "@/lib/caja-cierre";
import { useCashMovements } from "@/hooks/use-cash-movements";

// Tarjeta "Caja de hoy" / "Caja vencida" de Inicio. Independiente del rango
// de fechas que elija el usuario en el resto de Inicio (useDashboardData)
// — "efectivo esperado" y "caja vencida" son siempre sobre HOY, no sobre un
// rango arbitrario.

export function useCajaHoy(businessId: string | null, branchId: string | null) {
  const [loading, setLoading] = React.useState(true);
  const [cashExpected, setCashExpected] = React.useState(0);
  // "Dinero esperado en cuenta": cobros digitales (transferencia, débito,
  // crédito, QR) + ingresos manuales en cuenta, menos gastos/adelantos/
  // salidas manuales por esos mismos métodos, ARRASTRANDO el saldo del
  // último cierre (getDigitalCarryForward) — a diferencia del efectivo,
  // la cuenta no se resetea cada cierre (ver caja-cierre.ts).
  const [bankExpected, setBankExpected] = React.useState(0);
  const [pendingCierre, setPendingCierre] = React.useState<PendingCierre | null>(null);
  const [rangeStartDate, setRangeStartDate] = React.useState(cajaDateKey());

  // cash_movements + professional_advances del período abierto — misma
  // fuente que usa Caja (Facturación/Cierre de caja), ver use-cash-movements.ts.
  const { movements, advances, refresh: refreshMovements, registerMovement } = useCashMovements(
    businessId,
    branchId,
    rangeStartDate,
  );

  const load = React.useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // Si hay una caja vencida (abierta desde un día anterior, todavía sin
    // cerrar explícitamente), el rango de ESTA tarjeta arranca en SU fecha
    // de apertura, no en "hoy" — una caja no se resetea sola al cruzar la
    // medianoche, sigue siendo la misma hasta que el usuario la cierre
    // (closeVencida más abajo). Se resuelve ANTES de armar payQuery porque
    // el rango depende de este resultado.
    const pending = await findPendingCierre(businessId, branchId).catch(() => null);
    const newRangeStartDate = cajaOpenRangeStartDate(pending);
    const dayStart = new Date(`${newRangeStartDate}T00:00:00`).toISOString();
    const dayEnd = new Date().toISOString();
    const rangeEndDateOnly = cajaDateKey(new Date(dayEnd));

    // branch_id = null nunca se excluye (.or en vez de .eq): ver mismo
    // criterio y motivo documentado en use-caja-data.ts.
    const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

    let payQuery = supabase
      .from("payments")
      .select("id,total,amount,method,payment_method,created_at")
      .eq("business_id", businessId)
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd);
    if (branchFilter) payQuery = payQuery.or(branchFilter);

    let expQuery = supabase
      .from("expenses")
      .select("id,amount,payment_method,type,date")
      .eq("business_id", businessId)
      .gte("date", newRangeStartDate)
      .lte("date", rangeEndDateOnly);
    if (branchFilter) expQuery = expQuery.or(branchFilter);

    const [payRes, expRes, carryForward] = await Promise.all([
      payQuery.order("created_at", { ascending: false }),
      expQuery.order("date", { ascending: false }),
      getDigitalCarryForward(businessId, branchId),
    ]);

    const payments = (payRes.data ?? []) as any[];
    const expenses = (expRes.data ?? []) as any[];

    const expected = computeExpectedCashAndDigital({
      payments,
      expenses,
      advances,
      cashMovements: movements,
    });

    setCashExpected(expected.cashExpected);
    setBankExpected(expected.digitalExpected + carryForward);
    setPendingCierre(pending);
    setRangeStartDate(newRangeStartDate);
    setLoading(false);
  }, [businessId, branchId, advances, movements]);

  React.useEffect(() => {
    load();
  }, [load]);

  const closeVencida = React.useCallback(
    async (closedBy: string) => {
      if (!businessId || !pendingCierre) return;
      await closeCierreForDate({
        businessId,
        branchId,
        dateStr: pendingCierre.date,
        closedBy,
        mode: "manual",
      });
      await Promise.all([load(), refreshMovements()]);
    },
    [businessId, branchId, pendingCierre, load, refreshMovements],
  );

  return {
    loading,
    cashExpected,
    bankExpected,
    movements,
    pendingCierre,
    registerMovement,
    closeVencida,
    refresh: load,
  };
}
