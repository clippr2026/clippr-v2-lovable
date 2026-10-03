import * as React from "react";
import { supabase } from "@/integrations/supabase/client";

// "Pendiente de liquidar" — mismo criterio de deuda real que usa
// ProfesionalesTab (Liquidaciones) en cash-register.tsx: suma de
// commission_records.pending_amount por profesional, sin importar si la
// comisión ya quedó bloqueada dentro de una liquidación preparada. Se
// extrajo a un hook compartido para que el resumen de Caja y Liquidaciones
// nunca muestren números distintos.

export type PendingCommissionRow = {
  employeeId: string;
  name: string;
  pending: number;
};

export function usePendingCommissions(
  businessId: string | null,
  employees: Array<{ id: string; name?: string | null }>,
) {
  const [commissions, setCommissions] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    if (!businessId) {
      setCommissions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("commission_records" as any)
      .select("professional_id,pending_amount")
      .eq("business_id", businessId)
      .gt("pending_amount", 0);
    if (!error) setCommissions(data ?? []);
    setLoading(false);
  }, [businessId]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    if (!businessId) return;
    const channel = supabase
      .channel(`pending-commissions-${businessId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "commission_records", filter: `business_id=eq.${businessId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId, load]);

  const rows: PendingCommissionRow[] = React.useMemo(() => {
    const byEmployee = new Map<string, number>();
    for (const c of commissions as any[]) {
      const id = String(c.professional_id);
      byEmployee.set(id, (byEmployee.get(id) ?? 0) + Number(c.pending_amount ?? 0));
    }
    return employees
      .map((e) => ({
        employeeId: String(e.id),
        name: e.name ?? "Profesional",
        pending: byEmployee.get(String(e.id)) ?? 0,
      }))
      .filter((r) => r.pending > 0)
      .sort((a, b) => b.pending - a.pending);
  }, [commissions, employees]);

  const total = rows.reduce((s, r) => s + r.pending, 0);

  return { loading, rows, total, refresh: load };
}
