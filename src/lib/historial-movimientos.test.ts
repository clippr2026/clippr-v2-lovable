import { describe, expect, it } from "vitest";
import { dayBoundsBA } from "./caja-cierre";
import {
  buildHistorialMovimientos,
  computeLiquidacionSummary,
  isWithinCutoff,
  mergePendingSaleIds,
  resolveVentaDate,
  withOperativeDates,
  type HistorialAdvanceRow,
  type HistorialPaymentRow,
  type HistorialVentaAnuladaRow,
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

// "Venta anulada" (ver 20261026020000_void_adjustment_settlement_tracking.sql)
// — caso de referencia real: venta #1CB24B (26/10/2026), anulada con la
// comisión ya liquidada. Pendiente hasta que prepare_settlement_run la
// compensa de verdad en una liquidación nueva.
describe("buildHistorialMovimientos — 'Venta anulada' (commission_adjustment_queue)", () => {
  function makeVentaAnulada(overrides: Partial<HistorialVentaAnuladaRow>): HistorialVentaAnuladaRow {
    return {
      id: "caq-1",
      saleId: "92eb4bb2-68c6-4e2f-9a42-b024471cb24b",
      saleCreatedAt: "2026-10-26T03:04:00.391Z",
      clientName: "sin turno",
      serviceName: "Corte en cabello corto",
      saleTotal: 21900,
      method: "transfer",
      commissionPct: null,
      commissionAmount: 9000,
      reason: "segundo ciclo",
      performedByName: "Operador",
      authorizedByName: "Admin",
      voidedAt: "2026-10-26T17:18:22.772Z",
      professionalId: "8f1f393e-84db-4907-9ad7-b30c55636dd3",
      professionalName: "Franco",
      originalSettlementRunNumber: 116,
      appliedSettlementRunId: null,
      appliedSettlementRunNumber: null,
      appliedAt: null,
      kind: "deduccion",
      ...overrides,
    };
  }

  it("una venta anulada pendiente aparece como item propio, nunca mezclada con un adelanto", () => {
    const items = buildHistorialMovimientos([], [], [], [makeVentaAnulada({})]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("venta_anulada");
    if (items[0].kind === "venta_anulada") {
      expect(items[0].data.commissionAmount).toBe(9000);
      expect(items[0].data.appliedSettlementRunId).toBeNull();
    }
  });

  it("un crédito por restablecimiento (kind: 'credito') conserva su kind propio, distinto de una deducción pendiente", () => {
    const items = buildHistorialMovimientos([], [], [], [
      makeVentaAnulada({ id: "caq-credito", kind: "credito", reason: "Venta restablecida (su deducción ya estaba compensada) — vuelta a pedir" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("venta_anulada");
    if (items[0].kind === "venta_anulada") {
      expect(items[0].data.kind).toBe("credito");
      expect(items[0].data.commissionAmount).toBe(9000);
    }
  });

  it("se ordena junto con pagos/adelantos/ajustes por fecha, sin un tratamiento especial", () => {
    const advances: HistorialAdvanceRow[] = [
      {
        id: "adv-1",
        amount: 5000,
        payment_method: "efectivo",
        note: null,
        advanced_at: "2026-10-26T10:00:00.000Z",
        registered_by_name: "Admin",
        movement_number: 50,
      },
    ];
    const items = buildHistorialMovimientos(
      [],
      advances,
      [],
      [makeVentaAnulada({ voidedAt: "2026-10-26T17:18:22.772Z" })],
    );
    expect(items.map((i) => i.kind)).toEqual(["venta_anulada", "adelanto"]);
  });

  it("compensada: trae el número y la fecha de la liquidación que la absorbió", () => {
    const items = buildHistorialMovimientos(
      [],
      [],
      [],
      [
        makeVentaAnulada({
          appliedSettlementRunId: "run-116-uuid",
          appliedSettlementRunNumber: 116,
          appliedAt: "2026-10-26T18:00:00.000Z",
        }),
      ],
    );
    if (items[0].kind === "venta_anulada") {
      expect(items[0].data.appliedSettlementRunId).toBe("run-116-uuid");
      expect(items[0].data.appliedSettlementRunNumber).toBe(116);
    }
  });

  it("sin % de comisión histórico (commissionPct null) — nunca se inventa uno, el consumidor debe mostrar '—'", () => {
    const items = buildHistorialMovimientos([], [], [], [makeVentaAnulada({ commissionPct: null })]);
    if (items[0].kind === "venta_anulada") {
      expect(items[0].data.commissionPct).toBeNull();
    }
  });

  it("varias ventas anuladas (ciclos repetidos de anular/restablecer) no se mezclan entre sí", () => {
    const items = buildHistorialMovimientos(
      [],
      [],
      [],
      [
        makeVentaAnulada({ id: "caq-1", voidedAt: "2026-10-26T03:04:31.000Z", commissionAmount: 9000 }),
        makeVentaAnulada({ id: "caq-2", voidedAt: "2026-10-26T17:18:22.000Z", commissionAmount: 9000 }),
      ],
    );
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => (i.kind === "venta_anulada" ? i.data.id : null)))).toEqual(
      new Set(["caq-1", "caq-2"]),
    );
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

// Segunda causa raíz encontrada (misma auditoría, 20/10/2026): resolveVentaDate
// arregló la PANTALLA, pero el CÁLCULO (computeLiquidacionSummary y el corte
// "Hasta" de prepare_settlement_run) seguía comparando contra
// commission_records.created_at/tip_records.created_at — withOperativeDates
// es el fix para ese lado: reemplaza created_at por la fecha real del
// payment ANTES de que la fila llegue a cualquier cálculo o filtro de corte.
describe("withOperativeDates — el CÁLCULO de Liquidaciones usa la fecha real del payment, no la de la fila de comisión/propina", () => {
  it("con el sale_id presente en el mapa, reemplaza created_at por la fecha del payment", () => {
    const rows = [{ sale_id: "sale-1", created_at: "2026-10-21T00:03:06.129Z", amount: 31996 }];
    const result = withOperativeDates(rows, {
      "sale-1": { created_at: "2026-10-18T00:03:06.129Z", status: "cobrado" },
    });
    expect(result[0].created_at).toBe("2026-10-18T00:03:06.129Z");
  });

  it("sin el sale_id en el mapa (payment no encontrado), conserva created_at original", () => {
    const rows = [{ sale_id: "sale-2", created_at: "2026-10-13T10:00:00.000Z", amount: 1000 }];
    expect(withOperativeDates(rows, {})[0].created_at).toBe("2026-10-13T10:00:00.000Z");
  });

  it("sin sale_id en la fila, conserva created_at original", () => {
    const rows = [{ created_at: "2026-10-13T10:00:00.000Z", amount: 1000 } as { created_at: string }];
    expect(
      withOperativeDates(rows, { x: { created_at: "y", status: "cobrado" } })[0].created_at,
    ).toBe("2026-10-13T10:00:00.000Z");
  });

  it("no muta el array/objetos originales (devuelve copias nuevas)", () => {
    const original = { sale_id: "sale-1", created_at: "2026-10-21T00:03:06.129Z" };
    const rows = [original];
    const result = withOperativeDates(rows, {
      "sale-1": { created_at: "2026-10-18T00:03:06.129Z", status: "cobrado" },
    });
    expect(original.created_at).toBe("2026-10-21T00:03:06.129Z");
    expect(result[0]).not.toBe(original);
  });

  it("funciona igual para varias filas de distintas ventas/profesionales/sucursales a la vez — sin casos especiales por id", () => {
    const rows = [
      { sale_id: "a", created_at: "2026-10-01T00:00:00.000Z" },
      { sale_id: "b", created_at: "2026-10-02T00:00:00.000Z" },
    ];
    const result = withOperativeDates(rows, {
      a: { created_at: "2026-09-30T23:00:00.000Z", status: "cobrado" },
      b: { created_at: "2026-10-05T00:00:00.000Z", status: "cobrado" },
    });
    expect(result.map((r) => r.created_at)).toEqual([
      "2026-09-30T23:00:00.000Z",
      "2026-10-05T00:00:00.000Z",
    ]);
  });
});

// Caso real reproducido punta a punta: Alan Chauque (Franco), Global +
// Corte, $31.996 de comisión. Fecha operativa corregida de 20/10 21:03 ART
// a 17/10 21:03 ART — payments.created_at pasa a ser "2026-10-18T00:03:06
// Z" (17/10 21:03 ART = 18/10 00:03 UTC), pero commission_records.created_at
// se queda, a propósito, en el valor viejo ("2026-10-21T00:03:06Z" — la fila
// se creó ahí, nunca se corrige). Antes del fix, un corte "Hasta 17/10"
// excluía esta comisión; "Hasta 20/10" sí la incluía — la misma plata
// aparecía o desaparecía según qué día eligiera quien liquida.
describe("Caso real: corte 'Hasta 17/10' vs 'Hasta 20/10' con una fecha operativa corregida (Alan Chauque, $31.996)", () => {
  const rawCommission: LiquidacionPendingRow = {
    professional_id: "franco",
    settlement_run_id: null,
    pending_amount: 31996,
    created_at: "2026-10-21T00:03:06.129Z", // commission_records.created_at — nunca se corrige
  };
  const paymentCreatedAtBySaleId = {
    "sale-alan-chauque": { created_at: "2026-10-18T00:03:06.129Z", status: "cobrado" },
  }; // payments.created_at — SÍ corregido (17/10 21:03 ART)

  it("SIN resolver la fecha operativa (bug viejo): el corte del 17/10 excluye la comisión, el del 20/10 la incluye", () => {
    const cutoff17 = dayBoundsBA("2026-10-17").end;
    const cutoff20 = dayBoundsBA("2026-10-20").end;
    expect(isWithinCutoff(rawCommission.created_at, cutoff17)).toBe(false);
    expect(isWithinCutoff(rawCommission.created_at, cutoff20)).toBe(true);
  });

  it("CON la fecha operativa resuelta (fix): el corte del 17/10 YA incluye la comisión, igual que el del 20/10", () => {
    const resolved = withOperativeDates(
      [{ ...rawCommission, sale_id: "sale-alan-chauque" }],
      paymentCreatedAtBySaleId,
    );
    const cutoff17 = dayBoundsBA("2026-10-17").end;
    const cutoff20 = dayBoundsBA("2026-10-20").end;
    expect(isWithinCutoff(resolved[0].created_at, cutoff17)).toBe(true);
    expect(isWithinCutoff(resolved[0].created_at, cutoff20)).toBe(true);
  });

  it("computeLiquidacionSummary ya incluye los $31.996 como comisión nueva al resolver la fecha operativa", () => {
    const resolved = withOperativeDates(
      [{ ...rawCommission, sale_id: "sale-alan-chauque" }],
      paymentCreatedAtBySaleId,
    );
    const summary = computeLiquidacionSummary("franco", resolved, [], [], []);
    expect(summary.newCommissions).toBe(31996);
  });
});

// Horarios cercanos a medianoche: una venta cobrada tarde en el día
// (21:00-23:59 ART) cae 3 horas más tarde en UTC — si algo comparara fechas
// en UTC o con el huso LOCAL del navegador en vez de dayBoundsBA (huso
// Argentina explícito), una venta de las 23:50 ART del 17/10 podía quedar
// fuera del corte "Hasta 17/10" o, al revés, una del 00:10 ART del 18/10
// colarse adentro.
describe("Horarios cercanos a medianoche — el corte 'Hasta' respeta el día calendario de Argentina, no el de UTC", () => {
  it("una venta a las 23:50 ART del día del corte entra en 'Hasta ese día'", () => {
    // 23:50 ART del 17/10 = 18/10 02:50 UTC (ART = UTC-3)
    const saleAt2350ARTon17 = "2026-10-18T02:50:00.000Z";
    const cutoff17 = dayBoundsBA("2026-10-17").end;
    expect(isWithinCutoff(saleAt2350ARTon17, cutoff17)).toBe(true);
    // Si se comparara con "<=  2026-10-17T23:59:59.999Z" (corte mal armado
    // en UTC en vez de ART), esta misma venta quedaría afuera — documenta
    // justamente el bug que corrige dayBoundsBA/isWithinCutoff.
    expect(new Date(saleAt2350ARTon17).getTime() <= new Date("2026-10-17T23:59:59.999Z").getTime()).toBe(false);
  });

  it("una venta a las 00:10 ART del día SIGUIENTE al corte NO entra", () => {
    // 00:10 ART del 18/10 = 03:10 UTC del 18/10
    const saleAt0010ARTon18 = "2026-10-18T03:10:00.000Z";
    const cutoff17 = dayBoundsBA("2026-10-17").end;
    expect(isWithinCutoff(saleAt0010ARTon18, cutoff17)).toBe(false);
  });

  it("una venta exactamente a las 23:59:59.999 ART del día del corte entra (límite inclusive)", () => {
    const cutoff17 = dayBoundsBA("2026-10-17").end;
    expect(isWithinCutoff(cutoff17.toISOString(), cutoff17)).toBe(true);
  });
});

// "Movimientos ya liquidados" y "liquidaciones parciales": una comisión con
// settlement_run_id asignado nunca vuelve a contar como nueva sin importar
// qué fecha operativa resuelta tenga — el filtro por settlement_run_id va
// SIEMPRE antes que cualquier comparación de fecha.
describe("Movimientos ya liquidados y liquidaciones parciales — withOperativeDates nunca hace que algo se cuente dos veces", () => {
  it("una comisión con fecha corregida pero YA liquidada (settlement_run_id) no vuelve a contar como nueva", () => {
    const commissions: LiquidacionPendingRow[] = withOperativeDates(
      [
        {
          professional_id: "franco",
          settlement_run_id: "run-ya-liquidado",
          pending_amount: 31996,
          created_at: "2026-10-21T00:03:06.129Z",
          sale_id: "sale-alan-chauque",
        } as LiquidacionPendingRow & { sale_id: string },
      ],
      { "sale-alan-chauque": { created_at: "2026-10-18T00:03:06.129Z", status: "cobrado" } },
    );
    const summary = computeLiquidacionSummary("franco", commissions, [], [], []);
    expect(summary.newCommissions).toBe(0);
  });

  it("liquidación parcial: el saldo pendiente de la liquidación anterior se arrastra junto con la comisión nueva de fecha corregida", () => {
    const runs: LiquidacionRunSummaryRow[] = [
      { professional_id: "franco", prepared_at: "2026-10-10T00:00:00.000Z", total_to_settle: 100000, amount_paid: 40000 },
    ];
    const commissions = withOperativeDates(
      [
        {
          professional_id: "franco",
          settlement_run_id: null,
          pending_amount: 31996,
          created_at: "2026-10-21T00:03:06.129Z",
          sale_id: "sale-alan-chauque",
        } as LiquidacionPendingRow & { sale_id: string },
      ],
      { "sale-alan-chauque": { created_at: "2026-10-18T00:03:06.129Z", status: "cobrado" } }, // 17/10, posterior al período anterior (10/10)
    );
    const summary = computeLiquidacionSummary("franco", commissions, [], runs, []);
    expect(summary.previousBalance).toBe(60000); // 100000 - 40000, deuda parcial anterior
    expect(summary.newCommissions).toBe(31996);
    expect(summary.totalToPay).toBe(91996);
  });
});

// "Profesionales diferentes al que tenía originalmente el turno": el cobro
// se liquida siempre a quien quedó asignado en commission_records.
// professional_id al momento de cobrar (lo que el cajero eligió en Caja),
// nunca a quien tenía el turno originalmente en la Agenda — esa asignación
// no vive en estas estructuras, así que no hay nada que "reconciliar": el
// filtro por professional_id ya aísla correctamente a cada profesional.
describe("Profesional asignado al cobrar (no el de la agenda original) — aislamiento correcto por professional_id", () => {
  it("una venta cobrada a nombre de Franco nunca aparece en el resumen de Alan, aunque el turno fuera de la agenda de Alan", () => {
    const commissions = withOperativeDates(
      [
        {
          professional_id: "franco", // quien se eligió al cobrar
          settlement_run_id: null,
          pending_amount: 31996,
          created_at: "2026-10-21T00:03:06.129Z",
          sale_id: "sale-alan-chauque",
        } as LiquidacionPendingRow & { sale_id: string },
      ],
      { "sale-alan-chauque": { created_at: "2026-10-18T00:03:06.129Z", status: "cobrado" } },
    );
    const summaryFranco = computeLiquidacionSummary("franco", commissions, [], [], []);
    const summaryAlan = computeLiquidacionSummary("alan", commissions, [], [], []);
    expect(summaryFranco.newCommissions).toBe(31996);
    expect(summaryAlan.newCommissions).toBe(0);
  });
});

// "Nuevos profesionales y sucursales": ningún id hardcodeado en
// withOperativeDates/computeLiquidacionSummary — un profesional creado hoy,
// sin ninguna liquidación previa ni historial, calcula igual que cualquier
// otro.
describe("Nuevos profesionales/sucursales — mismo cálculo sin historial previo", () => {
  it("un profesional recién creado, con una sola venta de fecha corregida, liquida correctamente desde cero", () => {
    const brandNewProfessionalId = "prof-nuevo-2026-10-20";
    const commissions = withOperativeDates(
      [
        {
          professional_id: brandNewProfessionalId,
          settlement_run_id: null,
          pending_amount: 15000,
          created_at: "2026-10-21T00:03:06.129Z",
          sale_id: "sale-nueva",
        } as LiquidacionPendingRow & { sale_id: string },
      ],
      { "sale-nueva": { created_at: "2026-10-18T00:03:06.129Z", status: "cobrado" } },
    );
    const summary = computeLiquidacionSummary(brandNewProfessionalId, commissions, [], [], []);
    expect(summary.previousBalance).toBe(0);
    expect(summary.newCommissions).toBe(15000);
    expect(summary.totalToPay).toBe(15000);
  });
});

// Caso real reportado (producción, 24/10/2026): Daniel, venta $21.900,
// comisión potencial $9.000 (45% sobre $20.000, precio con tope — no
// $21.900), cliente pagó $1.000. El sistema mostraba $8.589
// (pending_amount completo, incluyendo los $8.589 TODAVÍA NO cobrados)
// como si fuera la comisión disponible, en vez de los $410,96 realmente
// habilitados por ese cobro puntual (9000 × 1000/21900). Causa raíz:
// sumNewPending (vía computeLiquidacionSummary) sumaba pending_amount de
// CUALQUIER commission_records sin liquidar, sin saber que una venta
// pendiente/parcial reparte su habilitación por cobro real
// (commission_collection_events), nunca de una sola vez al crearse.
describe("Caso real: comisión de pago parcial (Daniel, $21.900 → $1.000 cobrado, 24/10/2026)", () => {
  const pendingCommission: LiquidacionPendingRow = {
    professional_id: "daniel",
    settlement_run_id: null,
    pending_amount: 8589.04, // 9000 - 410.96 — TODAVÍA NO cobrado
    created_at: "2026-10-24T04:31:11.479Z",
    sale_id: "sale-daniel-parcial",
    payment_status: "parcial", // payments.status de la venta original
  };

  it("sumNewPending NUNCA cuenta el pending_amount de una venta pendiente/parcial", () => {
    const summary = computeLiquidacionSummary("daniel", [pendingCommission], [], [], []);
    expect(summary.newCommissions).toBe(0);
  });

  it("lo realmente habilitado (evento de cobro, $410.96) SÍ cuenta, aunque pending_amount de la fila padre sea $8.589", () => {
    const recoveredEvent = {
      professional_id: "daniel",
      settlement_run_id: null,
      amount: 410.96,
      collected_at: "2026-10-24T04:31:11.479Z",
    };
    const summary = computeLiquidacionSummary(
      "daniel",
      [pendingCommission],
      [],
      [],
      [],
      [recoveredEvent],
    );
    expect(summary.newCommissions).toBe(410.96);
  });

  it("una venta 100% pendiente (status='pendiente', $0 cobrado, sin ningún evento) nunca aporta nada — ni su pending_amount completo ni nada por error", () => {
    const fullyPending: LiquidacionPendingRow = {
      professional_id: "daniel",
      settlement_run_id: null,
      pending_amount: 9000,
      created_at: "2026-10-24T05:00:00.000Z",
      sale_id: "sale-daniel-pendiente-total",
      payment_status: "pendiente",
    };
    const summary = computeLiquidacionSummary("daniel", [fullyPending], [], [], []);
    expect(summary.newCommissions).toBe(0);
  });

  it("una vez liquidado el evento recuperado (settlement_run_id asignado), no se cuenta de nuevo en la próxima liquidación", () => {
    const alreadySettledEvent = {
      professional_id: "daniel",
      settlement_run_id: "run-ya-liquidado",
      amount: 410.96,
      collected_at: "2026-10-24T04:31:11.479Z",
    };
    const summary = computeLiquidacionSummary(
      "daniel",
      [pendingCommission],
      [],
      [],
      [],
      [alreadySettledEvent],
    );
    expect(summary.newCommissions).toBe(0);
  });

  it("una venta cobrada normal (status='cobrado') sigue sumando su pending_amount completo, sin cambios", () => {
    const normalCommission: LiquidacionPendingRow = {
      professional_id: "daniel",
      settlement_run_id: null,
      pending_amount: 9000,
      created_at: "2026-10-23T16:44:38.237Z",
      sale_id: "sale-pato-orellana",
      payment_status: "cobrado",
    };
    const summary = computeLiquidacionSummary("daniel", [normalCommission], [], [], []);
    expect(summary.newCommissions).toBe(9000);
  });

  it("dos cobros parciales de la MISMA venta en dos eventos distintos se suman sin duplicar", () => {
    const events = [
      { professional_id: "daniel", settlement_run_id: null, amount: 410.96, collected_at: "2026-10-24T04:31:11.479Z" },
      { professional_id: "daniel", settlement_run_id: null, amount: 822.0, collected_at: "2026-10-26T10:00:00.000Z" },
    ];
    const summary = computeLiquidacionSummary("daniel", [pendingCommission], [], [], [], events);
    expect(summary.newCommissions).toBeCloseTo(1232.96, 2);
  });

  it("un evento de OTRO profesional nunca se mezcla con el total de Daniel", () => {
    const events = [
      { professional_id: "daniel", settlement_run_id: null, amount: 410.96, collected_at: "2026-10-24T04:31:11.479Z" },
      { professional_id: "alan", settlement_run_id: null, amount: 999, collected_at: "2026-10-24T04:31:11.479Z" },
    ];
    const summary = computeLiquidacionSummary("daniel", [pendingCommission], [], [], [], events);
    expect(summary.newCommissions).toBe(410.96);
  });
});
