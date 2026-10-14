import { describe, expect, it } from "vitest";
import {
  buildHistorialMovimientos,
  computeLiquidacionSummary,
  isWithinCutoff,
  type HistorialAdvanceRow,
  type HistorialPaymentRow,
  type LiquidacionAdvanceSummaryRow,
  type LiquidacionPendingRow,
  type LiquidacionRunSummaryRow,
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
