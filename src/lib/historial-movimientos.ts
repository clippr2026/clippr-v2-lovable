// Historial de movimientos — timeline único de pagos de liquidación
// (agrupados por Movimiento #, un pago múltiple con varios métodos es UN
// solo item), adelantos, ajustes y deducciones, ordenado por fecha.
// Compartido por Caja > Liquidaciones > Movimientos (cash-register.tsx) y
// Panel del profesional > Movimientos (professionals.tsx) para no duplicar
// el criterio de agrupación ni la presentación en los dos lugares.

export type HistorialPaymentRow = {
  id: string;
  settlement_run_id: string;
  amount: number;
  payment_method: string | null;
  note: string | null;
  balance_before: number;
  balance_after: number;
  paid_by_name: string;
  paid_at: string;
  movement_number: number | null;
};

export type HistorialAdvanceRow = {
  id: string;
  amount: number;
  payment_method: string | null;
  note: string | null;
  advanced_at: string;
  registered_by_name: string;
  movement_number: number | null;
};

// Subset de SettlementRun con lo necesario para derivar sus movimientos de
// Ajuste/Deducción (ver 20260803010000_ajuste_deduccion_movements.sql —
// cada run pide, como mucho, un movement_number para su ajuste y otro para
// su deducción, asignados al prepararse).
export type HistorialRunRow = {
  id: string;
  professional_name: string | null;
  prepared_at: string;
  prepared_by_name: string;
  adjustments: number;
  adjustment_items: { amount: number; reason: string }[] | null;
  adjustment_movement_number: number | null;
  deductions: number;
  deduction_items: { amount: number; reason: string }[] | null;
  deduction_movement_number: number | null;
};

export type MovimientoPago = {
  kind: "pago";
  movementNumber: number | null;
  at: string;
  settlementRunId: string;
  splits: HistorialPaymentRow[];
  totalAmount: number;
  balanceAfter: number;
  isFull: boolean;
};

export type MovimientoAdelanto = {
  kind: "adelanto";
  movementNumber: number | null;
  at: string;
  data: HistorialAdvanceRow;
};

export type MovimientoAjuste = {
  kind: "ajuste";
  movementNumber: number | null;
  at: string;
  runId: string;
  amount: number;
  items: { amount: number; reason: string }[];
  professionalName: string | null;
  preparedByName: string;
};

export type MovimientoDeduccion = {
  kind: "deduccion";
  movementNumber: number | null;
  at: string;
  runId: string;
  amount: number;
  items: { amount: number; reason: string }[];
  professionalName: string | null;
  preparedByName: string;
};

export type MovimientoItem = MovimientoPago | MovimientoAdelanto | MovimientoAjuste | MovimientoDeduccion;

// Agrupa por movement_number (splits de un mismo pago múltiple comparten
// número). Pagos históricos sin movement_number (no backfillearon todavía)
// caen cada uno en su propio grupo por id, para no mezclarlos entre sí.
export function buildHistorialMovimientos(
  payments: HistorialPaymentRow[],
  advances: HistorialAdvanceRow[],
  runs: HistorialRunRow[] = [],
): MovimientoItem[] {
  const groups = new Map<string, HistorialPaymentRow[]>();
  for (const p of payments) {
    const key = p.movement_number != null ? `mn:${p.movement_number}` : `id:${p.id}`;
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }

  const pagoItems: MovimientoPago[] = Array.from(groups.values()).map((splits) => {
    const sorted = [...splits].sort((a, b) => String(a.paid_at ?? "").localeCompare(String(b.paid_at ?? "")));
    const last = sorted[sorted.length - 1];
    const totalAmount = sorted.reduce((sum, s) => sum + Number(s.amount ?? 0), 0);
    const balanceAfter = Number(last.balance_after ?? 0);
    return {
      kind: "pago",
      movementNumber: last.movement_number,
      at: last.paid_at,
      settlementRunId: last.settlement_run_id,
      splits: sorted,
      totalAmount,
      balanceAfter,
      isFull: balanceAfter <= 0,
    };
  });

  const adelantoItems: MovimientoAdelanto[] = advances.map((a) => ({
    kind: "adelanto",
    movementNumber: a.movement_number,
    at: a.advanced_at,
    data: a,
  }));

  const ajusteItems: MovimientoAjuste[] = runs
    .filter((r) => r.adjustment_movement_number != null)
    .map((r) => ({
      kind: "ajuste",
      movementNumber: r.adjustment_movement_number,
      at: r.prepared_at,
      runId: r.id,
      amount: Number(r.adjustments ?? 0),
      items: r.adjustment_items ?? [],
      professionalName: r.professional_name,
      preparedByName: r.prepared_by_name,
    }));

  const deduccionItems: MovimientoDeduccion[] = runs
    .filter((r) => r.deduction_movement_number != null)
    .map((r) => ({
      kind: "deduccion",
      movementNumber: r.deduction_movement_number,
      at: r.prepared_at,
      runId: r.id,
      amount: Number(r.deductions ?? 0),
      items: r.deduction_items ?? [],
      professionalName: r.professional_name,
      preparedByName: r.prepared_by_name,
    }));

  return [...pagoItems, ...adelantoItems, ...ajusteItems, ...deduccionItems].sort((a, b) =>
    String(b.at ?? "").localeCompare(String(a.at ?? "")),
  );
}

// ── Resumen de liquidación de un profesional ────────────────────────────────
// "Comisiones generadas" / "Adelantos" / "Total a pagar" — mismos 3 números
// que arriba de Caja > Liquidaciones, ahora compartidos con Panel del
// profesional > Movimientos (antes esa pantalla no mostraba este resumen en
// absoluto). Misma fórmula exacta que cash-register.tsx (rows useMemo):
// "nuevo" = sin settlement_run_id, posterior a la última liquidación
// preparada (periodStartAt) y con saldo pendiente real > 0 — nunca un corte
// manual, Panel del profesional no tiene selector de "Liquidar hasta" (eso
// es exclusivo del flujo de preparar liquidación en Caja).

export type LiquidacionPendingRow = {
  professional_id: string;
  settlement_run_id: string | null;
  pending_amount: number;
  created_at: string;
};

export type LiquidacionRunSummaryRow = {
  professional_id: string;
  prepared_at: string;
  total_to_settle: number;
  amount_paid: number;
};

export type LiquidacionAdvanceSummaryRow = {
  professional_id: string;
  settlement_run_id: string | null;
  amount: number;
};

export type LiquidacionSummary = {
  previousBalance: number;
  newCommissions: number;
  newTips: number;
  pendingAdvances: number;
  periodStart: string | null;
  periodStartAt: string | null;
  latestRun: LiquidacionRunSummaryRow | null;
  // max(previousBalance + newCommissions + newTips - pendingAdvances, 0) —
  // mismo "Total a pagar" que la tarjeta de Caja.
  totalToPay: number;
};

export function computeLiquidacionSummary(
  professionalId: string,
  commissions: LiquidacionPendingRow[],
  tips: LiquidacionPendingRow[],
  runs: LiquidacionRunSummaryRow[],
  advances: LiquidacionAdvanceSummaryRow[],
): LiquidacionSummary {
  const employeeRuns = runs
    .filter((r) => String(r.professional_id) === String(professionalId))
    .sort((a, b) => String(b.prepared_at ?? "").localeCompare(String(a.prepared_at ?? "")));
  const latestRun = employeeRuns[0] ?? null;
  const previousBalance = latestRun
    ? Math.max(Number(latestRun.total_to_settle) - Number(latestRun.amount_paid), 0)
    : 0;
  const periodStartAt: string | null = latestRun?.prepared_at ?? null;
  const periodStart: string | null = periodStartAt
    ? new Date(periodStartAt).toLocaleDateString("sv-SE")
    : null;

  const sumNewPending = (rows: LiquidacionPendingRow[]) =>
    rows
      .filter(
        (r) =>
          String(r.professional_id) === String(professionalId) &&
          !r.settlement_run_id &&
          (!periodStartAt || String(r.created_at ?? "") > periodStartAt) &&
          Number(r.pending_amount ?? 0) > 0,
      )
      .reduce((sum, r) => sum + Number(r.pending_amount ?? 0), 0);

  const newCommissions = sumNewPending(commissions);
  const newTips = sumNewPending(tips);

  const pendingAdvances = advances
    .filter((a) => String(a.professional_id) === String(professionalId) && !a.settlement_run_id)
    .reduce((sum, a) => sum + Number(a.amount ?? 0), 0);

  return {
    previousBalance,
    newCommissions,
    newTips,
    pendingAdvances,
    periodStart,
    periodStartAt,
    latestRun,
    totalToPay: Math.max(previousBalance + newCommissions + newTips - pendingAdvances, 0),
  };
}
