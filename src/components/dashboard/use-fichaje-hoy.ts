import * as React from "react";
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

  return { loading, summary, refresh: load };
}
