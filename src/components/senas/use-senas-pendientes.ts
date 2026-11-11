import * as React from "react";
import { supabase } from "@/integrations/supabase/client";

export type SenaPendiente = {
  id: string;
  appointment_id: string;
  amount: number;
  method: string | null;
  proof_uploaded_at: string | null;
  client_name: string | null;
  service_name: string | null;
  starts_at: string | null;
};

/**
 * Señas con comprobante enviado que esperan revisión (cualquier fecha de turno). Se actualiza solo
 * cada 30 segundos y al volver a la pestaña; `refresh` fuerza la recarga (ej. tras aprobar/rechazar).
 */
export function useSenasPendientes(businessId: string | null | undefined) {
  return useSenasPorEstado(businessId, "review");
}

/**
 * Reembolsos por revisar: señas de turnos cancelados dentro del plazo de la política de cancelación
 * (la app sugiere reembolsar). Se resuelven desde el turno, en Agenda.
 */
export function useReembolsosPorRevisar(businessId: string | null | undefined) {
  return useSenasPorEstado(businessId, "to_decide");
}

function useSenasPorEstado(businessId: string | null | undefined, estado: "review" | "to_decide") {
  const [items, setItems] = React.useState<SenaPendiente[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    if (!businessId) {
      setItems([]);
      setLoading(false);
      return;
    }
    let q = (supabase.from("appointment_deposits" as any) as any)
      .select("id,appointment_id,amount,paid_amount,method,proof_uploaded_at,appointments:appointment_id(client_name,service_name,starts_at)")
      .eq("business_id", businessId)
      .eq("status", estado)
      .order("proof_uploaded_at", { ascending: true });
    if (estado === "to_decide") q = q.eq("suggested_action", "refund");
    const { data, error } = await q;
    if (!error) {
      setItems(
        ((data ?? []) as any[]).map((r) => ({
          id: r.id,
          appointment_id: r.appointment_id,
          amount: Number(estado === "to_decide" ? (r.paid_amount ?? r.amount) : r.amount) || 0,
          method: r.method ?? null,
          proof_uploaded_at: r.proof_uploaded_at ?? null,
          client_name: r.appointments?.client_name ?? null,
          service_name: r.appointments?.service_name ?? null,
          starts_at: r.appointments?.starts_at ?? null,
        })),
      );
    }
    setLoading(false);
  }, [businessId, estado]);

  React.useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { items, loading, refresh };
}
