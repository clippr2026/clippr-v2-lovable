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
  // Fecha SOLO para mostrar (ver 20261028170000_professional_advances_display_date.sql)
  // — null/ausente = mostrar advanced_at, como siempre. advanced_at sigue
  // siendo la única fecha real para Caja/conciliación/período de
  // liquidación; esto nunca reemplaza esa fuente, solo lo que se renderiza.
  display_date?: string | null;
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

// "Venta anulada" (ver 20261026020000_void_adjustment_settlement_tracking.sql)
// — una venta cuya comisión ya estaba pagada en una liquidación cerrada se
// anuló: queda una fila en commission_adjustment_queue, pendiente hasta que
// prepare_settlement_run la absorbe de verdad en una liquidación nueva
// (recién ahí pasa a "compensado", con appliedSettlementRunId/At). Todos los
// datos de la venta original se traen ya resueltos (join hecho por el
// caller) — este tipo nunca vuelve a tocar la base para mostrar el detalle.
export type HistorialVentaAnuladaRow = {
  id: string; // commission_adjustment_queue.id
  saleId: string;
  saleCreatedAt: string | null;
  clientName: string | null;
  serviceName: string | null;
  saleTotal: number;
  method: string | null;
  commissionPct: number | null; // null = sin % histórico guardado → mostrar "—", nunca inventar uno
  commissionAmount: number; // importe REAL ya pagado al profesional, nunca recalculado desde un %
  // "deduccion" (default, filas de antes de 20261026020000 también caen
  // acá) = se descuenta de la próxima liquidación. "credito" = venta
  // restablecida cuya deducción ya estaba compensada en una liquidación
  // cerrada — a favor del profesional, se SUMA en la próxima liquidación
  // (ver restore_payment_authorized/prepare_settlement_run).
  kind: "deduccion" | "credito";
  reason: string | null;
  performedByName: string | null;
  authorizedByName: string | null;
  voidedAt: string; // commission_adjustment_queue.created_at
  professionalId: string;
  professionalName: string | null;
  originalSettlementRunNumber: number | null; // liquidación donde se pagó la comisión originalmente
  appliedSettlementRunId: string | null; // null = Pendiente; con valor = Compensado
  appliedSettlementRunNumber: number | null;
  appliedAt: string | null;
};

export type MovimientoVentaAnulada = {
  kind: "venta_anulada";
  movementNumber: null;
  at: string;
  data: HistorialVentaAnuladaRow;
};

// Presentismo de UNA jornada confirmada (ver migración de presentismo,
// tabla attendance_confirmations) — un único movimiento diario por
// profesional, nunca uno por venta (el descuento/ajuste ya es neto de esa
// jornada completa, no se reparte entre los servicios de ese día). Se
// muestra SIEMPRE que esté confirmada, incluso con discountAmountApplied
// en $0 ("A tiempo", para que quede visible la hora de llegada) — solo
// deja de aparecer en Movimientos (pasa a Historial) una vez que
// settlementRunId ya no es null.
export type HistorialPresentismoRow = {
  id: string;
  professionalId: string;
  date: string;
  status: "a_tiempo" | "tarde" | "ausente";
  expectedStartAt: string | null;
  effectiveClockInAt: string | null;
  lateMinutes: number;
  // Positivo = descuento (resta del total a pagar); negativo = ajuste a
  // favor autorizado (suma); 0 = sin impacto económico (ej. "A tiempo").
  discountAmountApplied: number;
  penaltyOverridden: boolean;
  confirmedByName: string;
  confirmedAt: string;
  settlementRunId: string | null;
};

export type MovimientoPresentismo = {
  kind: "presentismo";
  movementNumber: null;
  at: string;
  data: HistorialPresentismoRow;
};

export type MovimientoItem =
  | MovimientoPago
  | MovimientoAdelanto
  | MovimientoAjuste
  | MovimientoDeduccion
  | MovimientoVentaAnulada
  | MovimientoPresentismo;

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
  ventasAnuladas: HistorialVentaAnuladaRow[] = [],
  presentismo: HistorialPresentismoRow[] = [],
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
    // display_date (si existe) manda para MOSTRAR — nunca para el corte
    // de período, eso lo siguen resolviendo isWithinCutoff/prepare_settlement_run
    // directo sobre advanced_at, nunca sobre este campo derivado.
    at: a.display_date ?? a.advanced_at,
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

  const ventaAnuladaItems: MovimientoVentaAnulada[] = ventasAnuladas.map((v) => ({
    kind: "venta_anulada",
    movementNumber: null,
    at: v.voidedAt,
    data: v,
  }));

  const presentismoItems: MovimientoPresentismo[] = presentismo.map((p) => ({
    kind: "presentismo",
    movementNumber: null,
    at: p.effectiveClockInAt ?? `${p.date}T12:00:00`,
    data: p,
  }));

  return [
    ...pagoItems,
    ...adelantoItems,
    ...ajusteItems,
    ...deduccionItems,
    ...ventaAnuladaItems,
    ...presentismoItems,
  ].sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
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
  sale_id?: string | null;
  // Status de payments (el de la VENTA, no el de esta fila de comisión/
  // propina) — ver 20261023010000_pending_payments_schema.sql. Lo agrega
  // withOperativeDates/resolveOperativeDates (ya resuelven el sale_id de
  // cada fila para la fecha operativa real; de paso traen esto). Bug real
  // (24/10/2026, reporte de comisión de Daniel): sin esto, una venta
  // pendiente/parcial contaba TODO su pending_amount como "nuevo
  // disponible" apenas se creaba la fila — antes de Fase 0 eso era
  // correcto (pending_amount siempre reflejaba la comisión completa, sin
  // cobro parcial posible), ahora pending_amount de una venta parcial
  // incluye la porción TODAVÍA NO COBRADA, que nunca debe contarse como
  // disponible.
  payment_status?: string | null;
};

// Una porción de comisión/propina HABILITADA por un cobro puntual
// (commission_collection_events/tip_collection_events — ver
// 20261023010000_pending_payments_schema.sql), para una venta que nació
// pendiente/parcial. Es la fuente real de "cuánto hay disponible ahora"
// para esas ventas — nunca su pending_amount (ver LiquidacionPendingRow).
export type LiquidacionRecoveredRow = {
  professional_id: string;
  settlement_run_id: string | null;
  amount: number;
  collected_at: string;
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

// Mismo subset que usa prepare_settlement_run para absorber presentismo
// (ver migración 20261029090000): solo lo necesario para sumar el neto
// pendiente, nunca el detalle completo (eso vive en
// HistorialPresentismoRow, para Movimientos).
export type LiquidacionPresentismoSummaryRow = {
  professional_id: string;
  settlement_run_id: string | null;
  date: string;
  discount_amount_applied: number;
};

export type LiquidacionSummary = {
  previousBalance: number;
  newCommissions: number;
  newTips: number;
  pendingAdvances: number;
  // "Venta anulada" pendiente (commission_adjustment_queue, ver
  // 20261026020000) — deducciones (comisión ya pagada de una venta
  // anulada) y créditos (venta restablecida cuya deducción ya estaba
  // compensada) todavía sin aplicar a ninguna liquidación. Concepto
  // propio, nunca mezclado con "Adelantos" (son tablas y motivos
  // distintos) — ver sumPendingAdjustmentQueue.
  pendingDeductions: number;
  pendingCredits: number;
  // Neto de presentismo todavía sin liquidar (positivo = descuento,
  // negativo = ajuste a favor) — mismo criterio que prepare_settlement_run
  // (ventana por la fecha de la JORNADA, nunca por cuándo se confirmó).
  pendingPresentismoAdjustment: number;
  periodStart: string | null;
  periodStartAt: string | null;
  latestRun: LiquidacionRunSummaryRow | null;
  // max(previousBalance + newCommissions + newTips + pendingCredits
  //     - pendingAdvances - pendingDeductions, 0) — mismo "Total a pagar"
  // en todas las pantallas (Caja y Panel del profesional).
  totalToPay: number;
  // "Del DD/MM al DD/MM" — rango real del período que generó
  // previousBalance (el de latestRun), para la tarjeta "Comisiones
  // pendientes". null si no hay latestRun o no tiene period_start_at.
  previousPeriodLabel: string | null;
};

// "Venta anulada" pendiente de compensar — misma fórmula en TODAS las
// pantallas que muestran o calculan un total a pagar (computeLiquidacionSummary
// abajo, y el cálculo del modal "Preparar liquidación" en cash-register.tsx,
// que además filtra por el corte "Liquidar hasta" elegido). kind='deduccion'
// resta (comisión ya pagada de una venta que se anuló); kind='credito' suma
// (venta restablecida cuya deducción ya estaba compensada en una liquidación
// cerrada). Solo cuenta lo que TODAVÍA no se aplicó a ninguna liquidación
// (appliedSettlementRunId == null) — lo ya aplicado vive en esa liquidación,
// nunca se vuelve a contar acá.
export function sumPendingAdjustmentQueue(
  rows: HistorialVentaAnuladaRow[],
  professionalId: string,
): { pendingDeductions: number; pendingCredits: number } {
  let pendingDeductions = 0;
  let pendingCredits = 0;
  for (const r of rows) {
    if (String(r.professionalId) !== String(professionalId)) continue;
    if (r.appliedSettlementRunId) continue;
    if (r.kind === "credito") pendingCredits += Number(r.commissionAmount ?? 0);
    else pendingDeductions += Number(r.commissionAmount ?? 0);
  }
  return { pendingDeductions, pendingCredits };
}

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
  // Eventos de cobro de pendientes, sin liquidar todavía — opcionales
  // (default []) para no romper ningún caller que todavía no los pasa.
  // Ver LiquidacionRecoveredRow.
  commissionEvents: LiquidacionRecoveredRow[] = [],
  tipEvents: LiquidacionRecoveredRow[] = [],
  // "Venta anulada" pendiente (commission_adjustment_queue) — opcional
  // (default []) por la misma razón que commissionEvents/tipEvents.
  ventasAnuladas: HistorialVentaAnuladaRow[] = [],
  // Presentismo pendiente — opcional (default []), misma razón.
  presentismo: LiquidacionPresentismoSummaryRow[] = [],
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

  // pendiente/parcial: su pending_amount incluye plata TODAVÍA NO COBRADA
  // — nunca cuenta acá. Lo que sí está disponible de esas ventas entra por
  // sumRecovered (commission_collection_events/tip_collection_events),
  // abajo — eventos reales de cobro, cada uno con su propia fecha.
  const sumNewPending = (rows: LiquidacionPendingRow[]) =>
    rows
      .filter(
        (r) =>
          String(r.professional_id) === String(professionalId) &&
          !r.settlement_run_id &&
          (!periodStartAt || String(r.created_at ?? "") > periodStartAt) &&
          Number(r.pending_amount ?? 0) > 0 &&
          r.payment_status !== "pendiente" &&
          r.payment_status !== "parcial",
      )
      .reduce((sum, r) => sum + Number(r.pending_amount ?? 0), 0);

  const sumRecovered = (rows: LiquidacionRecoveredRow[]) =>
    rows
      .filter(
        (r) =>
          String(r.professional_id) === String(professionalId) &&
          !r.settlement_run_id &&
          (!periodStartAt || String(r.collected_at ?? "") > periodStartAt),
      )
      .reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

  const newCommissions = sumNewPending(commissions) + sumRecovered(commissionEvents);
  const newTips = sumNewPending(tips) + sumRecovered(tipEvents);

  const pendingAdvances = advances
    .filter((a) => String(a.professional_id) === String(professionalId) && !a.settlement_run_id)
    .reduce((sum, a) => sum + Number(a.amount ?? 0), 0);

  const { pendingDeductions, pendingCredits } = sumPendingAdjustmentQueue(ventasAnuladas, professionalId);

  // Ventana por la fecha de la JORNADA (ac.date), igual criterio que
  // prepare_settlement_run — nunca por cuándo se confirmó (confirmedAt).
  const pendingPresentismoAdjustment = presentismo
    .filter(
      (p) =>
        String(p.professional_id) === String(professionalId) &&
        !p.settlement_run_id &&
        (!periodStart || String(p.date ?? "") > periodStart),
    )
    .reduce((sum, p) => sum + Number(p.discount_amount_applied ?? 0), 0);

  return {
    previousBalance,
    newCommissions,
    newTips,
    pendingAdvances,
    pendingDeductions,
    pendingCredits,
    pendingPresentismoAdjustment,
    periodStart,
    periodStartAt,
    latestRun,
    previousPeriodLabel,
    totalToPay: Math.max(
      previousBalance +
        newCommissions +
        newTips +
        pendingCredits -
        pendingAdvances -
        pendingDeductions -
        pendingPresentismoAdjustment,
      0,
    ),
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
export function resolveVentaDate(c: {
  created_at?: string | null;
  sale?: { created_at?: string | null } | null;
  // Fila sintética de un cobro puntual contra una venta pendiente/parcial
  // (ver syntheticRecoveredRows en cash-register.tsx/use-professionals-data.ts)
  // — acá created_at es la fecha REAL del cobro (collected_at), a propósito
  // distinta de sale.created_at (la fecha de la venta original, de
  // cualquier día anterior). Para estas filas sale.created_at NUNCA debe
  // ganarle a created_at — haría que un cobro de hoy de una venta de hace
  // tres semanas se ordene/posicione como si hubiera pasado hace tres
  // semanas, perdiendo el sentido entero de "Pago pendiente recuperado".
  __recovered?: boolean;
}): string | null {
  if (c.__recovered) return c.created_at ?? c.sale?.created_at ?? null;
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
export function withOperativeDates<
  T extends { sale_id?: string | null; created_at: string; payment_status?: string | null },
>(
  rows: T[],
  paymentInfoBySaleId: Record<string, { created_at: string | null; status: string | null } | undefined>,
): T[] {
  return rows.map((row) => {
    const info = row.sale_id ? paymentInfoBySaleId[row.sale_id] : undefined;
    if (!info) return row;
    return {
      ...row,
      created_at: info.created_at ?? row.created_at,
      payment_status: info.status ?? null,
    };
  });
}
