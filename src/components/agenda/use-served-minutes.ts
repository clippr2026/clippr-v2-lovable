import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Servicio = { name: string; duration_min?: number | null };
type Turno = { id: string; starts_at: string; ends_at?: string | null; duration_min?: number | null; status: string };

const DURACION_POR_DEFECTO = 30;

// Minutos de servicios atendidos y cobrados en un día, por profesional (con turno o por orden de llegada). Cada servicio
// vale su duración del catálogo; si el cobro viene de un turno, la del turno; si no se conoce, 30 minutos (el mismo
// valor que usa la Agenda para un turno sin duración).
export function useServedMinutesByEmployee(
  businessId: string | null | undefined,
  branchId: string | null | undefined,
  dateKey: string,
  services: Servicio[],
  appointments: Turno[],
) {
  // Se vuelve a pedir cuando se cobra un turno del día (cambia la cantidad de cobrados).
  const cobradosHoy = appointments.filter((a) => a.status === "charged" && a.starts_at.slice(0, 10) === dateKey).length;
  return useQuery({
    queryKey: ["agenda-minutos-atendidos", businessId, branchId ?? null, dateKey, cobradosHoy],
    enabled: !!businessId,
    staleTime: 10_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      let q = supabase
        .from("payments")
        .select("employee_id,items,service_name,appointment_id")
        .eq("business_id", businessId!)
        .gte("created_at", `${dateKey}T00:00:00-03:00`)
        .lte("created_at", `${dateKey}T23:59:59.999-03:00`)
        .not("status", "in", "(anulado,reembolsado)");
      if (branchId) q = q.or(`branch_id.eq.${branchId},branch_id.is.null`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const duracion = new Map<string, number>();
      for (const s of services) if (s.duration_min && s.duration_min > 0) duracion.set(s.name.trim().toLowerCase(), s.duration_min);
      const turnos = new Map(appointments.map((a) => [a.id, a]));
      const minutos = new Map<string, number>();
      for (const p of (data ?? []) as Array<{ employee_id: string | null; items: unknown; service_name: string | null; appointment_id: string | null }>) {
        if (!p.employee_id) continue;
        const items = Array.isArray(p.items) ? (p.items as Array<{ name?: string; qty?: number; is_catalog?: boolean }>).filter((it) => it && !it.is_catalog) : [];
        const lineas = items.length > 0 ? items.map((it) => ({ name: String(it.name ?? ""), qty: Number(it.qty ?? 1) > 0 ? Number(it.qty ?? 1) : 1 })) : [{ name: p.service_name ?? "", qty: 1 }];
        const turno = p.appointment_id ? turnos.get(p.appointment_id) : undefined;
        const duracionTurno = turno
          ? turno.ends_at
            ? Math.max(0, Math.round((new Date(turno.ends_at).getTime() - new Date(turno.starts_at).getTime()) / 60_000))
            : Number(turno.duration_min ?? 0)
          : 0;
        let total = 0;
        for (const l of lineas) total += (duracion.get(l.name.trim().toLowerCase()) ?? (lineas.length === 1 && duracionTurno > 0 ? duracionTurno : DURACION_POR_DEFECTO)) * l.qty;
        minutos.set(p.employee_id, (minutos.get(p.employee_id) ?? 0) + total);
      }
      return minutos;
    },
  });
}
