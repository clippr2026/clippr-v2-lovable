import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  findPendingCierre,
  closeCierreForDate,
  cajaOpenRangeStartDate,
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
  // Todo lo cobrado hoy que NO es efectivo (transferencia, tarjeta, MP, QR,
  // etc.) — a diferencia de cashExpected, nunca se ajusta por
  // ingresar/retirar efectivo (esos movimientos son solo del cajón físico).
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

    const [payRes, movRes] = await Promise.all([
      payQuery.order("created_at", { ascending: false }),
      movQuery.order("created_at", { ascending: false }),
    ]);

    const isCashMethod = (m: string | null | undefined) => {
      const raw = String(m ?? "").trim().toLowerCase();
      return raw === "cash" || raw === "efectivo";
    };
    const payments = (payRes.data ?? []) as any[];
    const cashPayments = payments
      .filter((p) => isCashMethod(p.method ?? p.payment_method))
      .reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
    const nonCashPayments = payments
      .filter((p) => !isCashMethod(p.method ?? p.payment_method))
      .reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);

    const movs = ((movRes.data ?? []) as any[]) as CashMovement[];
    const ingresos = movs.filter((m) => m.type === "ingreso").reduce((s, m) => s + Number(m.amount), 0);
    const retiros = movs.filter((m) => m.type === "retiro").reduce((s, m) => s + Number(m.amount), 0);

    setCashExpected(cashPayments + ingresos - retiros);
    setBankExpected(nonCashPayments);
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
