import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRejectedRange, localDateISO } from "@/hooks/use-rejected-clients";
import { summarizeRejected, type RejectedAnalytics } from "@/lib/rejected-analytics";

/** Mapa id→precio del catálogo (para la facturación potencial perdida). */
function usePriceCatalog(businessId: string | null | undefined) {
  return useQuery({
    queryKey: ["price-catalog-min", businessId],
    enabled: !!businessId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase
        .from("price_catalog")
        .select("id,price")
        .eq("business_id", businessId!);
      if (error) throw error;
      const m = new Map<string, number>();
      (data ?? []).forEach((r: { id: string; price: number | null }) => m.set(r.id, r.price ?? 0));
      return m;
    },
  });
}

/**
 * Analítica de demanda no atendida (clientes rechazados).
 * Trae ~6 meses de registros + precios y devuelve todas las métricas.
 * Consumido por el Dashboard y el Asesor IA.
 */
export function useRejectedAnalytics(businessId: string | null | undefined): {
  analytics: RejectedAnalytics;
  isLoading: boolean;
  error: unknown;
} {
  const now = React.useMemo(() => new Date(), []);
  const fromISO = React.useMemo(() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    return localDateISO(d);
  }, [now]);
  const toISO = localDateISO(now);

  const rangeQ = useRejectedRange(businessId, fromISO, toISO);
  const priceQ = usePriceCatalog(businessId);

  const analytics = React.useMemo(
    () => summarizeRejected(rangeQ.data ?? [], { now, priceById: priceQ.data ?? new Map() }),
    [rangeQ.data, priceQ.data, now],
  );

  return {
    analytics,
    isLoading: rangeQ.isLoading || priceQ.isLoading,
    error: rangeQ.error ?? priceQ.error,
  };
}
