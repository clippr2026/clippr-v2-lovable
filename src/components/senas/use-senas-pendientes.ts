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
  const [items, setItems] = React.useState<SenaPendiente[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    if (!businessId) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { data, error } = await (supabase.from("appointment_deposits" as any) as any)
      .select("id,appointment_id,amount,method,proof_uploaded_at,appointments:appointment_id(client_name,service_name,starts_at)")
      .eq("business_id", businessId)
      .eq("status", "review")
      .order("proof_uploaded_at", { ascending: true });
    if (!error) {
      setItems(
        ((data ?? []) as any[]).map((r) => ({
          id: r.id,
          appointment_id: r.appointment_id,
          amount: Number(r.amount) || 0,
          method: r.method ?? null,
          proof_uploaded_at: r.proof_uploaded_at ?? null,
          client_name: r.appointments?.client_name ?? null,
          service_name: r.appointments?.service_name ?? null,
          starts_at: r.appointments?.starts_at ?? null,
        })),
      );
    }
    setLoading(false);
  }, [businessId]);

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
