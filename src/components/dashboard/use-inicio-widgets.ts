import * as React from "react";
import { supabase } from "@/integrations/supabase/client";

// "Próximos turnos" y "Actividad reciente" de Inicio — igual que
// useCajaHoy, independientes del rango de fechas que el usuario elija
// para el resto de Inicio (useDashboardData): siempre "de ahora en
// adelante" / "lo último que pasó", nunca atados a un rango arbitrario.

export type ProximoTurno = {
  id: string;
  client_name: string | null;
  service_name: string | null;
  starts_at: string;
  employee_id: string | null;
};

export type ActividadItem =
  | { kind: "cobro"; id: string; at: string; client_name: string | null; service_name: string | null; total: number }
  | { kind: "turno"; id: string; at: string; client_name: string | null; service_name: string | null; starts_at: string };

const VENTANA_DIAS_PROXIMOS = 7;
const LIMITE_PROXIMOS = 6;
const LIMITE_ACTIVIDAD = 8;

export function useInicioWidgets(businessId: string | null, branchId: string | null) {
  const [loading, setLoading] = React.useState(true);
  const [proximosTurnos, setProximosTurnos] = React.useState<ProximoTurno[]>([]);
  const [actividad, setActividad] = React.useState<ActividadItem[]>([]);

  const load = React.useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const now = new Date();
    const windowEnd = new Date(now.getTime() + VENTANA_DIAS_PROXIMOS * 24 * 60 * 60 * 1000);
    const recentSince = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    let proximosQuery = supabase
      .from("appointments")
      .select("id,client_name,service_name,starts_at,employee_id,status")
      .eq("business_id", businessId)
      .gte("starts_at", now.toISOString())
      .lte("starts_at", windowEnd.toISOString())
      .not("status", "in", "(cancelled,blocked)");
    if (branchId) proximosQuery = proximosQuery.eq("branch_id", branchId);

    let paymentsQuery = supabase
      .from("payments")
      .select("id,total,amount,client_name,service_name,created_at")
      .eq("business_id", businessId)
      .gte("created_at", recentSince.toISOString());
    if (branchId) paymentsQuery = paymentsQuery.eq("branch_id", branchId);

    let apptActivityQuery = supabase
      .from("appointments")
      .select("id,client_name,service_name,starts_at,created_at,updated_at")
      .eq("business_id", businessId)
      .gte("created_at", recentSince.toISOString());
    if (branchId) apptActivityQuery = apptActivityQuery.eq("branch_id", branchId);

    const [proximosRes, paymentsRes, apptActivityRes] = await Promise.all([
      proximosQuery.order("starts_at", { ascending: true }).limit(LIMITE_PROXIMOS),
      paymentsQuery.order("created_at", { ascending: false }).limit(LIMITE_ACTIVIDAD),
      apptActivityQuery.order("created_at", { ascending: false }).limit(LIMITE_ACTIVIDAD),
    ]);

    setProximosTurnos(((proximosRes.data ?? []) as any[]) as ProximoTurno[]);

    const cobros: ActividadItem[] = ((paymentsRes.data ?? []) as any[]).map((p) => ({
      kind: "cobro",
      id: p.id,
      at: p.created_at,
      client_name: p.client_name ?? null,
      service_name: p.service_name ?? null,
      total: Number(p.total ?? p.amount ?? 0),
    }));
    const turnos: ActividadItem[] = ((apptActivityRes.data ?? []) as any[]).map((a) => ({
      kind: "turno",
      id: a.id,
      at: a.created_at,
      client_name: a.client_name ?? null,
      service_name: a.service_name ?? null,
      starts_at: a.starts_at,
    }));
    const merged = [...cobros, ...turnos]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, LIMITE_ACTIVIDAD);
    setActividad(merged);

    setLoading(false);
  }, [businessId, branchId]);

  React.useEffect(() => {
    load();
  }, [load]);

  return { loading, proximosTurnos, actividad, refresh: load };
}
