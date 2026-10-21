import { describe, expect, it } from "vitest";
import {
  buildHistorialMovimientos,
  computeLiquidacionSummary,
  isWithinCutoff,
  mergePendingSaleIds,
  resolveVentaDate,
  type HistorialAdvanceRow,
  type HistorialPaymentRow,
  type LiquidacionAdvanceSummaryRow,
  type LiquidacionPendingRow,
  type LiquidacionRunSummaryRow,
  type PendingSaleRow,
} from "./historial-movimientos";

// Caso real que reportó el negocio: liquidando a Pipo del 03/10 al 10/10
// 23:59, un adelanto del 13/10 (posterior al corte) no debe aparecer ni en
// Movimientos ni descontarse del Total a pagar — sin importar el
// profesional ni el período elegido.
describe("isWithinCutoff — filtro único de corte para Movimientos y tarjetas-resumen", () => {
  const cutoff = new Date("2026-10-10T23:59:59.999-03:00");

  it("un adelanto ANTES del corte entra", () => {
    expect(isWithinCutoff("2026-10-10T15:05:00.000-03:00", cutoff)).toBe(true);
  });

  it("un adelanto DESPUÉS del corte queda afuera (el caso reportado)", () => {
    expect(isWithinCutoff("2026-10-13T18:59:00.000-03:00", cutoff)).toBe(false);
  });

  it("exactamente en el límite del corte entra", () => {
    expect(isWithinCutoff("2026-10-10T23:59:59.999-03:00", cutoff)).toBe(true);
  });

  it("un solo milisegundo después del corte queda afuera", () => {
    expect(isWithinCutoff("2026-10-11T00:00:00.000-03:00", cutoff)).toBe(false);
  });

  it("sin fecha, queda afuera (nunca se asume dentro del período)", () => {
    expect(isWithinCutoff(null, cutoff)).toBe(false);
    expect(isWithinCutoff(undefined, cutoff)).toBe(false);
  });

  it("funciona igual para cualquier profesional/período — no depende de nombres fijos", () => {
    const futureCutoff = new Date("2099-01-01T00:00:00.000-03:00");
    expect(isWithinCutoff("2026-10-13T18:59:00.000-03:00", futureCutoff)).toBe(true);
  });
});

describe("buildHistorialMovimientos — Movimientos respeta el corte elegido", () => {
  function makeAdvance(overrides: Partial<HistorialAdvanceRow>): HistorialAdvanceRow {
    return {
      id: "adv-1",
      amount: 50000,
      payment_method: "transferencia",
      note: null,
      advanced_at: "2026-10-05T12:00:00.000Z",
      registered_by_name: "Alan",
      movement_number: 100,
      ...overrides,
    };
  }

  it("un adelanto posterior al corte, si ya se excluyó antes de pasar acá, no aparece en el timeline", () => {
    // Replica exactamente lo que hace cash-register.tsx: filtrar con
    // isWithinCutoff ANTES de llamar a buildHistorialMovimientos — la
    // función en sí no filtra, solo ordena/agrupa lo que recibe.
    const cutoff = new Date("2026-10-10T23:59:59.999-03:00");
    const advances = [
      makeAdvance({ id: "adv-dentro", amount: 134370, advanced_at: "2026-10-10T18:05:46.897Z" }),
      makeAdvance({ id: "adv-fuera", amount: 50000, advanced_at: "2026-10-13T21:59:00.000Z" }),
    ].filter((a) => isWithinCutoff(a.advanced_at, cutoff));

    const items = buildHistorialMovimientos([], advances, []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "adelanto", data: { id: "adv-dentro", amount: 134370 } });
  });

  it("sin filtro previo, el adelanto posterior SÍ aparecería (confirma que el filtro vive en el caller)", () => {
    const advances = [
      makeAdvance({ id: "adv-dentro", advanced_at: "2026-10-10T18:05:46.897Z" }),
      makeAdvance({ id: "adv-fuera", advanced_at: "2026-10-13T21:59:00.000Z" }),
    ];
    const items = buildHistorialMovimientos([], advances, []);
    expect(items).toHaveLength(2);
  });

  it("agrupa pagos múltiples por movement_number, sin que el corte los duplique", () => {
    const payments: HistorialPaymentRow[] = [
      {
        id: "p1",
        settlement_run_id: "run-1",
        amount: 10000,
        payment_method: "cash",
        note: null,
        balance_before: 20000,
        balance_after: 10000,
        paid_by_name: "Recepcionista",
        paid_at: "2026-10-05T10:00:00.000Z",
        movement_number: 200,
      },
      {
        id: "p2",
        settlement_run_id: "run-1",
        amount: 10000,
        payment_method: "transfer",
        note: null,
        balance_before: 10000,
        balance_after: 0,
        paid_by_name: "Recepcionista",
        paid_at: "2026-10-05T10:00:01.000Z",
        movement_number: 200,
      },
    ];
    const items = buildHistorialMovimientos(payments, [], []);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("pago");
    if (items[0].kind === "pago") expect(items[0].totalAmount).toBe(20000);
  });
});

describe("computeLiquidacionSummary — Total a pagar = Comisiones + Propinas − Adelantos", () => {
  it("un adelanto pendiente (nunca liquidado) se descuenta sin importar su antigüedad", () => {
    const advances: LiquidacionAdvanceSummaryRow[] = [
      { professional_id: "pipo", settlement_run_id: null, amount: 134370 },
    ];
    const commissions: LiquidacionPendingRow[] = [
      { professional_id: "pipo", settlement_run_id: null, pending_amount: 200000, created_at: "2026-10-05T10:00:00.000Z" },
    ];
    const summary = computeLiquidacionSummary("pipo", commissions, [], [], advances);
    expect(summary.pendingAdvances).toBe(134370);
    expect(summary.newCommissions).toBe(200000);
    // totalToPay nunca baja de 0 (Math.max) — con comisión suficiente, el
    // adelanto se refleja en la resta real, no en el piso.
    expect(summary.totalToPay).toBe(200000 + 0 - 134370);
  });

  it("si el adelanto supera lo generado, Total a pagar nunca es negativo", () => {
    const advances: LiquidacionAdvanceSummaryRow[] = [
      { professional_id: "pipo", settlement_run_id: null, amount: 134370 },
    ];
    const commissions: LiquidacionPendingRow[] = [
      { professional_id: "pipo", settlement_run_id: null, pending_amount: 10000, created_at: "2026-10-05T10:00:00.000Z" },
    ];
    const summary = computeLiquidacionSummary("pipo", commissions, [], [], advances);
    expect(summary.totalToPay).toBe(0);
  });

  it("un adelanto ya asociado a una liquidación (settlement_run_id) no se vuelve a descontar", () => {
    const advances: LiquidacionAdvanceSummaryRow[] = [
      { professional_id: "pipo", settlement_run_id: "run-ya-pagado", amount: 50000 },
    ];
    const summary = computeLiquidacionSummary("pipo", [], [], [], advances);
    expect(summary.pendingAdvances).toBe(0);
  });

  it("la regla funciona igual para cualquier profesional, no solo Pipo", () => {
    const advances: LiquidacionAdvanceSummaryRow[] = [
      { professional_id: "daniel", settlement_run_id: null, amount: 8000 },
      { professional_id: "pipo", settlement_run_id: null, amount: 134370 },
    ];
    const summaryDaniel = computeLiquidacionSummary("daniel", [], [], [], advances);
    const summaryPipo = computeLiquidacionSummary("pipo", [], [], [], advances);
    expect(summaryDaniel.pendingAdvances).toBe(8000);
    expect(summaryPipo.pendingAdvances).toBe(134370);
  });

  it("comisiones/propinas anteriores al inicio real del período (periodStartAt) no se cuentan dos veces", () => {
    const runs: LiquidacionRunSummaryRow[] = [
      { professional_id: "pipo", prepared_at: "2026-10-03T00:00:00.000Z", total_to_settle: 50000, amount_paid: 50000 },
    ];
    const commissions: LiquidacionPendingRow[] = [
      // Generada ANTES de la última liquidación preparada — ya debería estar cubierta por esa run, no es "nueva".
      { professional_id: "pipo", settlement_run_id: null, pending_amount: 9999, created_at: "2026-10-01T00:00:00.000Z" },
      // Generada DESPUÉS — sí es nueva.
      { professional_id: "pipo", settlement_run_id: null, pending_amount: 5000, created_at: "2026-10-05T00:00:00.000Z" },
    ];
    const summary = computeLiquidacionSummary("pipo", commissions, [], runs, []);
    expect(summary.newCommissions).toBe(5000);
  });
});

// Auditoría de propinas (19-20/10/2026) — casos que reproducen las causas
// raíz encontradas: propina sin comisión, propina ya liquidada, y propina
// anulada por el trigger de 20261019030000 (pending_amount en 0).
describe("computeLiquidacionSummary — propinas", () => {
  it("una propina se suma aunque la comisión de esa venta sea $0 (producto sin comisión activa)", () => {
    const tips: LiquidacionPendingRow[] = [
      { professional_id: "melany", settlement_run_id: null, pending_amount: 3000, created_at: "2026-10-13T10:00:00.000Z" },
    ];
    // Sin fila en commission_records (register_sale no inserta comisión
    // cuando el monto es $0) — newCommissions queda en 0, newTips no.
    const summary = computeLiquidacionSummary("melany", [], tips, [], []);
    expect(summary.newCommissions).toBe(0);
    expect(summary.newTips).toBe(3000);
    expect(summary.totalToPay).toBe(3000);
  });

  it("una propina ya incluida en una liquidación (settlement_run_id) no se vuelve a contar en el período siguiente", () => {
    const tips: LiquidacionPendingRow[] = [
      { professional_id: "melany", settlement_run_id: "run-ya-liquidado", pending_amount: 3000, created_at: "2026-10-13T10:00:00.000Z" },
    ];
    const summary = computeLiquidacionSummary("melany", [], tips, [], []);
    expect(summary.newTips).toBe(0);
  });

  it("una propina con pending_amount en 0 (anulada/reembolsada vía trigger de void) no cuenta como pendiente", () => {
    const tips: LiquidacionPendingRow[] = [
      { professional_id: "melany", settlement_run_id: null, pending_amount: 0, created_at: "2026-10-13T10:00:00.000Z" },
    ];
    const summary = computeLiquidacionSummary("melany", [], tips, [], []);
    expect(summary.newTips).toBe(0);
  });

  it("comisión y propina de la misma venta se suman por separado, nunca mezcladas", () => {
    const commissions: LiquidacionPendingRow[] = [
      { professional_id: "melany", settlement_run_id: null, pending_amount: 9000, created_at: "2026-10-13T10:00:00.000Z" },
    ];
    const tips: LiquidacionPendingRow[] = [
      { professional_id: "melany", settlement_run_id: null, pending_amount: 3000, created_at: "2026-10-13T10:00:00.000Z" },
    ];
    const summary = computeLiquidacionSummary("melany", commissions, tips, [], []);
    expect(summary.newCommissions).toBe(9000);
    expect(summary.newTips).toBe(3000);
    expect(summary.totalToPay).toBe(12000);
  });
});

// Confirma que la fórmula es GLOBAL — no depende de ningún business_id/
// professional_id puntual. Usa IDs genéricos de un negocio/profesional
// inventados para este test, nunca los de un negocio real, para probar que
// el cálculo funciona igual para cualquier barbería/profesional nuevo que
// use Clippr, no solo para los que ya existen hoy.
describe("Ciclo de vida completo de una propina — negocio/profesional genérico nuevo", () => {
  const professionalId = "prof-test-001";

  it("1) recién cobrada, la propina aparece como pendiente", () => {
    const tips: LiquidacionPendingRow[] = [
      { professional_id: professionalId, settlement_run_id: null, pending_amount: 1500, created_at: "2026-11-01T12:00:00.000Z" },
    ];
    const summary = computeLiquidacionSummary(professionalId, [], tips, [], []);
    expect(summary.newTips).toBe(1500);
    expect(summary.totalToPay).toBe(1500);
  });

  it("2) una vez liquidada (settlement_run_id asignado por prepare_settlement_run), deja de contar como pendiente", () => {
    const tips: LiquidacionPendingRow[] = [
      { professional_id: professionalId, settlement_run_id: "run-test-001", pending_amount: 1500, created_at: "2026-11-01T12:00:00.000Z" },
    ];
    const runs: LiquidacionRunSummaryRow[] = [
      { professional_id: professionalId, prepared_at: "2026-11-01T13:00:00.000Z", total_to_settle: 1500, amount_paid: 1500, period_start_at: null },
    ];
    const summary = computeLiquidacionSummary(professionalId, [], tips, runs, []);
    expect(summary.newTips).toBe(0);
  });

  it("3) una propina NUEVA del mismo profesional, posterior al corte ya liquidado, sí vuelve a contar — nunca se pierde ni se duplica con la anterior", () => {
    const tips: LiquidacionPendingRow[] = [
      { professional_id: professionalId, settlement_run_id: "run-test-001", pending_amount: 1500, created_at: "2026-11-01T12:00:00.000Z" },
      { professional_id: professionalId, settlement_run_id: null, pending_amount: 800, created_at: "2026-11-02T09:00:00.000Z" },
    ];
    const runs: LiquidacionRunSummaryRow[] = [
      { professional_id: professionalId, prepared_at: "2026-11-01T13:00:00.000Z", total_to_settle: 1500, amount_paid: 1500, period_start_at: null },
    ];
    const summary = computeLiquidacionSummary(professionalId, [], tips, runs, []);
    expect(summary.newTips).toBe(800);
  });

  it("4) la fórmula no depende de un business_id/professional_id fijo — otro profesional, mismos montos, mismo resultado", () => {
    const otherProfessionalId = "prof-test-002";
    const tips: LiquidacionPendingRow[] = [
      { professional_id: otherProfessionalId, settlement_run_id: null, pending_amount: 1500, created_at: "2026-11-01T12:00:00.000Z" },
    ];
    const summary = computeLiquidacionSummary(otherProfessionalId, [], tips, [], []);
    expect(summary.newTips).toBe(1500);
  });
});

describe("mergePendingSaleIds — ventas pendientes con propina sin comisión (fetchPendingVentasForProfessional)", () => {
  function row(overrides: Partial<PendingSaleRow>): PendingSaleRow {
    return {
      id: "id-1",
      professional_id: "melany",
      amount: 0,
      pending_amount: 0,
      commission_pct: null,
      sale_date: "2026-10-13",
      created_at: "2026-10-13T10:00:00.000Z",
      sale_id: "sale-1",
      ...overrides,
    };
  }

  it("una venta con comisión Y propina aparece una sola vez (gana la fila de comisión)", () => {
    const commissionRows = [row({ id: "c1", sale_id: "sale-1", amount: 9000, pending_amount: 9000, commission_pct: 45 })];
    const tipRows = [row({ id: "t1", sale_id: "sale-1", amount: 3000, pending_amount: 3000 })];
    const merged = mergePendingSaleIds(commissionRows, tipRows);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(commissionRows[0]);
  });

  it("una venta solo con propina (comisión $0, sin fila en commission_records) se agrega como fila sintética", () => {
    const commissionRows: PendingSaleRow[] = [];
    const tipRows = [row({ id: "t1", sale_id: "sale-2", amount: 3000, pending_amount: 3000 })];
    const merged = mergePendingSaleIds(commissionRows, tipRows);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ sale_id: "sale-2", amount: 0, pending_amount: 0, commission_pct: null });
  });

  it("una venta solo con comisión (sin propina) no cambia", () => {
    const commissionRows = [row({ id: "c1", sale_id: "sale-3", amount: 9000, pending_amount: 9000 })];
    const merged = mergePendingSaleIds(commissionRows, []);
    expect(merged).toEqual(commissionRows);
  });

  it("una venta ya liquidada (ausente de ambas listas, settlement_run_id no null se filtra ANTES de llegar acá) no aparece", () => {
    // mergePendingSaleIds no filtra por settlement_run_id — eso ya lo hace
    // el .is("settlement_run_id", null) de la query. Simula el caso donde
    // ninguna de las dos listas trae esa venta.
    const merged = mergePendingSaleIds([], []);
    expect(merged).toHaveLength(0);
  });
});

// Caso real que reportó el negocio (20/10/2026): se corrigió a mano la
// fecha operativa de un cobro (payments.charged_at/created_at, 20/10 ->
// 17/10) pero Caja > Liquidaciones y Panel del profesional > Movimientos
// seguían mostrando la fecha vieja — porque leían
// commission_records.created_at (congelado al cobrar, nunca se corrige)
// en vez de la fecha real del payment.
describe("resolveVentaDate — Caja > Liquidaciones muestra la fecha real del payment, no la de la fila de comisión", () => {
  it("con sale.created_at disponible, prioriza esa fecha sobre la de la comisión", () => {
    const c = {
      created_at: "2026-10-21T00:03:06.129Z", // commission_records.created_at, vieja (no se corrige)
      sale: { created_at: "2026-10-18T00:03:06.129Z" }, // payments.created_at, YA corregida
    };
    expect(resolveVentaDate(c)).toBe("2026-10-18T00:03:06.129Z");
  });

  it("sin sale (o sin sale.created_at), cae a commission_records.created_at", () => {
    expect(resolveVentaDate({ created_at: "2026-10-13T10:00:00.000Z", sale: null })).toBe(
      "2026-10-13T10:00:00.000Z",
    );
    expect(resolveVentaDate({ created_at: "2026-10-13T10:00:00.000Z", sale: {} })).toBe(
      "2026-10-13T10:00:00.000Z",
    );
  });

  it("sin ninguna fecha disponible, devuelve null (nunca inventa una fecha)", () => {
    expect(resolveVentaDate({})).toBeNull();
  });

  it("funciona igual para cualquier profesional/sucursal — es una función pura sin casos especiales por id", () => {
    const c = {
      created_at: "2026-10-05T12:00:00.000Z",
      sale: { created_at: "2026-10-02T12:00:00.000Z" },
    };
    expect(resolveVentaDate(c)).toBe("2026-10-02T12:00:00.000Z");
  });
});
