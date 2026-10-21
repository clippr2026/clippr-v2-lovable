// Historial de movimientos — timeline único de pagos de liquidación
// (agrupados por Movimiento #, un pago múltiple con varios métodos es UN
// solo item), adelantos, ajustes y deducciones, ordenado por fecha.
// Compartido por Caja > Liquidaciones > Movimientos (cash-register.tsx) y
// Panel del profesional > Movimientos (professionals.tsx) para no duplicar
// el criterio de agrupación ni la presentación en los dos lugares.
import { isPaymentFull } from "@/components/liquidaciones/movimiento-format";

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

// Único criterio para "¿este movimiento entra en un período que termina en
// `cutoffAt`?" — usado tanto por la tabla de Movimientos como por las
// tarjetas-resumen de Caja > Liquidaciones, para que nunca queden
// desincronizadas (antes Movimientos no filtraba por corte en absoluto:
// un adelanto fechado DESPUÉS del corte elegido aparecía igual en la
// lista, aunque ya no se descontara del Total a pagar). Se filtra por la
// fecha REAL del movimiento (dateIso: advanced_at/paid_at/cutoff_date),
// nunca por created_at — createdAt es cuándo se tipeó el registro, no
// cuándo ocurrió el movimiento.
export function isWithinCutoff(dateIso: string | null | undefined, cutoffAt: Date): boolean {
  if (!dateIso) return false;
  const t = new Date(dateIso).getTime();
  return Number.isFinite(t) && t <= cutoffAt.getTime();
}

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
      isFull: isPaymentFull(balanceAfter),
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
  // Inicio real del período que cubrió ese run — para poder mostrar el
  // rango real ("Del DD/MM al DD/MM") de la liquidación anterior en vez de
  // un texto genérico. Opcional: filas más viejas de settlement_runs
  // pueden no traerlo seleccionado desde donde se arma `runs`.
  period_start_at?: string | null;
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
  // "Del DD/MM al DD/MM" — rango real del período que generó
  // previousBalance (el de latestRun), para la tarjeta "Comisiones
  // pendientes". null si no hay latestRun o no tiene period_start_at.
  previousPeriodLabel: string | null;
};

function fmtDayMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

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
  // Rango real del período que cubrió latestRun (no el período actual que
  // se está por liquidar) — "Del DD/MM al DD/MM". Sin period_start_at
  // (primera liquidación de ese profesional) no hay "desde" real: se omite
  // en vez de inventar una fecha.
  const previousPeriodLabel: string | null =
    latestRun && latestRun.prepared_at
      ? latestRun.period_start_at
        ? `Del ${fmtDayMonth(latestRun.period_start_at)} al ${fmtDayMonth(latestRun.prepared_at)}`
        : `Hasta ${fmtDayMonth(latestRun.prepared_at)}`
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
    previousPeriodLabel,
    totalToPay: Math.max(previousBalance + newCommissions + newTips - pendingAdvances, 0),
  };
}

// ── Ventas pendientes (fetchPendingVentasForProfessional) ──────────────────
// Esa consulta armaba la lista de "ventas pendientes" de un profesional
// leyendo SOLO commission_records — una venta con propina pero comisión $0
// (producto sin comisión activa, servicio sin % configurado) nunca generó
// fila ahí (ver register_sale: el insert a commission_records es
// condicional a p_commission_amount > 0), así que esa venta quedaba
// invisible en el detalle aunque su propina sí sumara bien en el total de
// Liquidaciones (ese total sale de tip_records directo, nunca de esta
// lista). mergePendingSaleIds une ambas fuentes por sale_id.
export type PendingSaleRow = {
  id: string;
  professional_id: string;
  amount: number;
  pending_amount: number;
  commission_pct: number | null;
  sale_date: string;
  created_at: string;
  sale_id: string;
};

// Una venta con comisión Y propina aparece una sola vez (gana la fila de
// comisión, igual que siempre). Una venta SOLO con propina se agrega como
// fila sintética (amount/pending_amount en 0, commission_pct null) — basta
// para que <VentaRow> (unified-row.tsx) la renderice, porque esa fila lee
// la propina de `sale.tip_amount` (el payment en vivo), nunca de esta fila.
export function mergePendingSaleIds(
  commissionRows: PendingSaleRow[],
  tipRows: PendingSaleRow[],
): PendingSaleRow[] {
  const saleIdsWithCommission = new Set(commissionRows.map((c) => c.sale_id));
  const tipOnlyRows: PendingSaleRow[] = tipRows
    .filter((t) => !saleIdsWithCommission.has(t.sale_id))
    .map((t) => ({
      id: t.id,
      professional_id: t.professional_id,
      amount: 0,
      pending_amount: 0,
      commission_pct: null,
      sale_date: t.sale_date,
      created_at: t.created_at,
      sale_id: t.sale_id,
    }));
  return [...commissionRows, ...tipOnlyRows];
}

// ── Fecha real de una venta en Liquidaciones/Movimientos ───────────────────
// Caso real (producción, 20/10/2026): se corrigió la fecha operativa de un
// cobro (payments.charged_at/created_at) para que coincida con el día real
// en que se prestó el servicio, pero Caja > Liquidaciones y Panel del
// profesional > Movimientos seguían mostrando la fecha vieja. Causa: las
// tres pantallas que renderizan una venta (VentaRow en unified-row.tsx,
// cash-register.tsx y professionals.tsx) leían commission_records.created_at
// — el momento en que se creó la FILA de comisión, congelado para siempre al
// cobrar — en vez de payments.created_at (== charged_at), que es la fecha
// operativa real y la que se corrige cuando hace falta. Única fuente de
// verdad ahora: siempre preferir la fecha del payment real (`sale`); solo si
// no se pudo traer (dato faltante) cae a la de la fila de comisión, para no
// mostrar "—" de la nada.
export function resolveVentaDate(c: { created_at?: string | null; sale?: { created_at?: string | null } | null }): string | null {
  return c.sale?.created_at ?? c.created_at ?? null;
}

// ── Fecha operativa para RESUMEN y CORTE ("Hasta") de Liquidaciones ────────
// Mismo problema de fondo que resolveVentaDate, pero del lado del CÁLCULO en
// vez de la pantalla: computeLiquidacionSummary (sumNewPending) y el corte
// "Hasta" elegido en Caja > Liquidaciones (cash-register.tsx) comparaban
// contra commission_records.created_at/tip_records.created_at — la fecha
// vieja seguía EXCLUYENDO o INCLUYENDO mal una comisión aunque la pantalla
// ya mostrara la fecha corregida (caso real: Alan Chauque, 20/10 -> 17/10,
// $31.996 quedaba afuera del corte "Hasta 17/10" porque su created_at
// seguía en 21/10 UTC). withOperativeDates reemplaza created_at por la
// fecha real del payment vinculado (sale_id) ANTES de que la fila llegue a
// computeLiquidacionSummary o a cualquier filtro de corte — así ningún
// consumidor necesita saber que existe esta corrección, ni acordarse de
// aplicarla cada vez.
export function withOperativeDates<T extends { sale_id?: string | null; created_at: string }>(
  rows: T[],
  paymentCreatedAtBySaleId: Record<string, string | null | undefined>,
): T[] {
  return rows.map((row) => {
    const operativeAt = row.sale_id ? paymentCreatedAtBySaleId[row.sale_id] : null;
    return operativeAt ? { ...row, created_at: operativeAt } : row;
  });
}
