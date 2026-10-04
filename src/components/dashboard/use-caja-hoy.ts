import * as React from "react";
import { closeCierreForDate } from "@/lib/caja-cierre";
import { useCashMovements } from "@/hooks/use-cash-movements";
import { useCajaSummary } from "@/hooks/use-caja-summary";

// Tarjeta "Caja de hoy" / "Caja vencida" de Inicio. Independiente del rango
// de fechas que elija el usuario en el resto de Inicio (useDashboardData)
// — "efectivo esperado" y "caja vencida" son siempre sobre HOY, no sobre un
// rango arbitrario.
//
// Wrapper fino sobre useCajaSummary (src/hooks/use-caja-summary.ts) — ANTES
// este hook tenía su PROPIA query de payments/expenses, separada de la que
// usaba Caja (use-caja-data.ts) para los mismos tres números. Ahora Inicio
// y Caja > Facturación consumen exactamente el mismo cálculo; este archivo
// solo mantiene la forma pública que ya esperaba dashboard.tsx
// (cashExpected/bankExpected/movements/pendingCierre/registerMovement/
// closeVencida/refresh), para no tener que tocar esa pantalla.
export function useCajaHoy(businessId: string | null, branchId: string | null) {
  const summary = useCajaSummary(businessId, branchId);

  // movements/registerMovement: Inicio no los usa hoy, pero se mantienen en
  // la forma pública del hook por si algún consumidor futuro los necesita
  // (mismo criterio — useCashMovements, no un fetch propio).
  const { movements, refresh: refreshMovements, registerMovement } = useCashMovements(
    businessId,
    branchId,
    summary.rangeStartDate,
  );

  const closeVencida = React.useCallback(
    async (closedBy: string) => {
      if (!businessId || !summary.pendingCierre) return;
      await closeCierreForDate({
        businessId,
        branchId,
        dateStr: summary.pendingCierre.date,
        closedBy,
        mode: "manual",
      });
      // closeCierreForDate ya dispara "clippr:caja-cierre-guardado", que
      // useCajaSummary escucha y por sí solo dispara su propia recarga —
      // este refresh() explícito solo evita depender del timing de ese
      // evento para la propia Inicio (misma garantía que antes).
      await Promise.all([summary.refresh("closeVencida"), refreshMovements()]);
    },
    [businessId, branchId, summary.pendingCierre, summary.refresh, refreshMovements],
  );

  return {
    loading: summary.loading,
    cashExpected: summary.cashExpected,
    bankExpected: summary.bankExpected,
    movements,
    pendingCierre: summary.pendingCierre,
    registerMovement,
    closeVencida,
    refresh: summary.refresh,
  };
}
