// Historial de movimientos — timeline único de pagos de liquidación
// (agrupados por Movimiento #, un pago múltiple con varios métodos es UN
// solo item) y adelantos, ordenado por fecha. Compartido por Caja >
// Liquidaciones (cash-register.tsx) y Panel del profesional > Mis
// liquidaciones (professionals.tsx) para no duplicar el criterio de
// agrupación en los dos lugares.

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

export type MovimientoItem = MovimientoPago | MovimientoAdelanto;

// Agrupa por movement_number (splits de un mismo pago múltiple comparten
// número). Pagos históricos sin movement_number (no backfillearon todavía)
// caen cada uno en su propio grupo por id, para no mezclarlos entre sí.
export function buildHistorialMovimientos(
  payments: HistorialPaymentRow[],
  advances: HistorialAdvanceRow[],
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

  return [...pagoItems, ...adelantoItems].sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
}
