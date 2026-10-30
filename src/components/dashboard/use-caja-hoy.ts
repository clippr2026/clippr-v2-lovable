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
// (cashExpected/bankExpected/movements/pendingCierre/pendingCierres/
// registerMovement/refresh), para no tener que tocar esa pantalla.
//
// Ya NO expone un cierre de un clic ("closeVencida") — toda caja vencida
// se cierra desde Caja > Cierres, que exige ver la vista previa (cobros,
// efectivo, gastos) antes de poder confirmar. Este hook solo avisa, nunca
// cierra nada por sí mismo.
export function useCajaHoy(businessId: string | null, branchId: string | null) {
  const summary = useCajaSummary(businessId, branchId);

  // movements/registerMovement: Inicio no los usa hoy, pero se mantienen en
  // la forma pública del hook por si algún consumidor futuro los necesita
  // (mismo criterio — useCashMovements, no un fetch propio).
  const { movements, registerMovement } = useCashMovements(
    businessId,
    branchId,
    summary.rangeStartDate,
  );

  return {
    loading: summary.loading,
    cashExpected: summary.cashExpected,
    bankExpected: summary.bankExpected,
    movements,
    pendingCierre: summary.pendingCierre,
    pendingCierres: summary.pendingCierres,
    pendingCierresLoading: summary.pendingCierresLoading,
    cajaCerradaHoy: summary.cajaCerradaHoy,
    registerMovement,
    refresh: summary.refresh,
    // "Ingresos"/"Gastos"/"Utilidad" de CajaHoyCard (Inicio) — EXACTAMENTE
    // los mismos valores que Caja > Resumen (revHoy/totalGastosHoy de
    // useCajaSummary ya están acotados al día de HOY en huso Buenos Aires,
    // sin importar el backlog pendiente). Antes CajaHoyCard los sacaba de
    // useDashboardData, una query completamente separada — dos cálculos
    // distintos para la misma jornada, que es justo lo que no puede pasar.
    revHoy: summary.revHoy,
    cobros: summary.cobros,
    totalGastosHoy: summary.totalGastosHoy,
    // "Efectivo del día"/"Dinero en cuenta del día" — estrictamente hoy,
    // separado de cashExpected/bankExpected (acumulado de jornadas
    // pendientes, sección aparte "Saldos acumulados").
    todayCashExpected: summary.todayCashExpected,
    todayDigitalExpected: summary.todayDigitalExpected,
    todayAdvancesOut: summary.todayAdvancesOut,
    todayExpectedFull: summary.todayExpectedFull,
  };
}
