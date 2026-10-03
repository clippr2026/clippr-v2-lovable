import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  findPendingCierre,
  closeCierreForDate,
  cajaOpenRangeStartDate,
  computeExpectedCashAndDigital,
  cajaDateKey,
  type PendingCierre,
} from "@/lib/caja-cierre";

// Tarjeta "Caja de hoy" / "Caja vencida" de Inicio. Independiente del rango
// de fechas que elija el usuario en el resto de Inicio (useDashboardData)
// — "efectivo esperado" y "caja vencida" son siempre sobre HOY, no sobre un
// rango arbitrario.

export type CashMovement = {
  id: string;
  type: "ingreso" | "retiro";
  amount: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export function useCajaHoy(businessId: string | null, branchId: string | null) {
  const [loading, setLoading] = React.useState(true);
  const [cashExpected, setCashExpected] = React.useState(0);
  // "Dinero esperado en cuenta": cobros digitales (transferencia, débito,
  // crédito, QR) menos gastos/adelantos pagados por esos mismos métodos —
  // nunca se ajusta por ingresar/retirar efectivo (eso es solo el cajón
  // físico).
  const [bankExpected, setBankExpected] = React.useState(0);
  const [movements, setMovements] = React.useState<CashMovement[]>([]);
  const [pendingCierre, setPendingCierre] = React.useState<PendingCierre | null>(null);

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
    // (closeVencida más abajo). Se resuelve ANTES de armar payQuery/movQuery
    // porque el rango depende de este resultado.
    const pending = await findPendingCierre(businessId, branchId).catch(() => null);
    const rangeStartDate = cajaOpenRangeStartDate(pending);
    const dayStart = new Date(`${rangeStartDate}T00:00:00`).toISOString();
    const dayEnd = new Date().toISOString();

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

    let movQuery = supabase
      .from("cash_movements" as any)
      .select("id,type,amount,note,created_by,created_at")
      .eq("business_id", businessId)
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd);
    if (branchFilter) movQuery = movQuery.or(branchFilter);

    const rangeStartDateOnly = rangeStartDate;
    const rangeEndDateOnly = cajaDateKey(new Date(dayEnd));
    let expQuery = supabase
      .from("expenses")
      .select("id,amount,payment_method,type,date")
      .eq("business_id", businessId)
      .gte("date", rangeStartDateOnly)
      .lte("date", rangeEndDateOnly);
    if (branchFilter) expQuery = expQuery.or(branchFilter);

    // professional_advances no tiene branch_id (ver uso en cash-register.tsx)
    // y puede no existir todavía en algunas bases — falla en silencio.
    const advQuery = supabase
      .from("professional_advances" as any)
      .select("id,amount,payment_method,advanced_at")
      .eq("business_id", businessId)
      .gte("advanced_at", dayStart)
      .lte("advanced_at", dayEnd);

    const [payRes, movRes, expRes, advRes] = await Promise.allSettled([
      payQuery.order("created_at", { ascending: false }),
      movQuery.order("created_at", { ascending: false }),
      expQuery.order("date", { ascending: false }),
      advQuery.order("advanced_at", { ascending: false }),
    ]);

    const dataOf = (res: PromiseSettledResult<any>) =>
      res.status === "fulfilled" && !res.value?.error ? ((res.value.data ?? []) as any[]) : [];

    const payments = dataOf(payRes);
    const expenses = dataOf(expRes);
    const advances = dataOf(advRes);
    const movs = dataOf(movRes) as CashMovement[];

    const expected = computeExpectedCashAndDigital({
      payments,
      expenses,
      advances,
      cashMovements: movs,
    });

    setCashExpected(expected.cashExpected);
    setBankExpected(expected.digitalExpected);
    setMovements(movs);
    setPendingCierre(pending);
    setLoading(false);
  }, [businessId, branchId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const registerMovement = React.useCallback(
    async (type: "ingreso" | "retiro", amount: number, note: string, createdBy: string | null) => {
      if (!businessId) return;
      const { error } = await supabase.from("cash_movements" as any).insert({
        business_id: businessId,
        branch_id: branchId,
        type,
        amount,
        note: note.trim() || null,
        created_by: createdBy,
      });
      if (error) throw new Error(error.message);
      await load();
    },
    [businessId, branchId, load],
  );

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
      await load();
    },
    [businessId, branchId, pendingCierre, load],
  );

  return { loading, cashExpected, bankExpected, movements, pendingCierre, registerMovement, closeVencida, refresh: load };
}
