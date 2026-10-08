import * as React from "react";
import { supabase } from "@/integrations/supabase/client";

// Fuente única de cash_movements (Ingresar/Retirar dinero) +
// professional_advances para el período de caja abierto — reemplaza el
// fetch que antes vivía duplicado en use-caja-hoy.ts (Inicio) y
// CierreCajaBtn (cash-register.tsx), ambos alimentando
// computeExpectedCashAndDigital con los mismos datos por separado.

export type CashMovement = {
  id: string;
  type: "ingreso" | "retiro";
  amount: number;
  method: "efectivo" | "cuenta";
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type ProfessionalAdvance = {
  amount: number;
  payment_method: string | null;
};

export function useCashMovements(
  businessId: string | null,
  branchId: string | null,
  rangeStartDate: string,
) {
  const [movements, setMovements] = React.useState<CashMovement[]>([]);
  const [advances, setAdvances] = React.useState<ProfessionalAdvance[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async (): Promise<{
    movements: CashMovement[];
    advances: ProfessionalAdvance[];
  }> => {
    if (!businessId) {
      setMovements([]);
      setAdvances([]);
      setLoading(false);
      return { movements: [], advances: [] };
    }
    setLoading(true);

    const dayStart = new Date(`${rangeStartDate}T00:00:00`).toISOString();
    const dayEnd = new Date().toISOString();
    const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

    let movQuery = supabase
      .from("cash_movements" as any)
      .select("id,type,amount,method,note,created_by,created_at")
      .eq("business_id", businessId)
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd);
    if (branchFilter) movQuery = movQuery.or(branchFilter);

    // professional_advances no tiene branch_id (ver uso en cash-register.tsx
    // ProfesionalesTab) y puede no existir todavía en algunas bases — la
    // tabla es nueva, falla en silencio si todavía no corrió esa migración.
    const advQuery = supabase
      .from("professional_advances" as any)
      .select("amount,payment_method")
      .eq("business_id", businessId)
      .gte("advanced_at", dayStart)
      .lte("advanced_at", dayEnd);

    const [movRes, advRes] = await Promise.allSettled([
      movQuery.order("created_at", { ascending: false }),
      advQuery,
    ]);

    const freshMovements =
      movRes.status === "fulfilled" && !movRes.value.error ? ((movRes.value.data ?? []) as CashMovement[]) : [];
    const freshAdvances =
      advRes.status === "fulfilled" && !advRes.value.error ? ((advRes.value.data ?? []) as ProfessionalAdvance[]) : [];
    setMovements(freshMovements);
    setAdvances(freshAdvances);
    setLoading(false);
    return { movements: freshMovements, advances: freshAdvances };
  }, [businessId, branchId, rangeStartDate]);

  React.useEffect(() => {
    load();
  }, [load]);

  const registerMovement = React.useCallback(
    async (
      type: "ingreso" | "retiro",
      amount: number,
      note: string,
      method: "efectivo" | "cuenta",
      createdBy: string | null,
    ) => {
      if (!businessId) return;
      const { error } = await supabase.from("cash_movements" as any).insert({
        business_id: businessId,
        branch_id: branchId,
        type,
        amount,
        method,
        note: note.trim() || null,
        created_by: createdBy,
      });
      if (error) throw new Error(error.message);
      await load();
    },
    [businessId, branchId, load],
  );

  return { movements, advances, loading, refresh: load, registerMovement };
}
