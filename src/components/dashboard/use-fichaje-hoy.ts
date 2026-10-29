import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { getTodayFichajeSummary, type FichajeHoySummary } from "@/lib/fichaje";

// Tarjeta "Fichaje de jornada" de Inicio — respeta la sucursal activa
// global, igual que useCajaHoy/useInicioWidgets.
export function useFichajeHoy(businessId: string | null, branchId: string | null) {
  const [loading, setLoading] = React.useState(true);
  const [summary, setSummary] = React.useState<FichajeHoySummary | null>(null);

  const load = React.useCallback(async () => {
    if (!businessId || !branchId) {
      setSummary(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await getTodayFichajeSummary(businessId, branchId);
      setSummary(result);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [businessId, branchId]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Realtime: un fichaje registrado desde OTRO dispositivo (kiosco, panel
  // del propio profesional) tiene que verse acá sin recargar la página —
  // antes solo se refrescaba al montar. Mismo patrón que
  // use-professionals-data.ts (sin filtro server-side, RLS ya acota las
  // filas igual).
  React.useEffect(() => {
    if (!businessId || !branchId) return;
    const channel = supabase
      .channel(`fichaje-hoy-${businessId}-${branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_sessions" }, () => {
        load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId, branchId, load]);

  return { loading, summary, refresh: load };
}
