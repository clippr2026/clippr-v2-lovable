import { describe, expect, it } from "vitest";
import {
  computeMonthlyPerformance,
  monthBounds,
  monthLabel,
  shiftMonth,
  variationPct,
  type MonthlyRawData,
} from "@/lib/monthly-performance";

const pay = (over: Partial<MonthlyRawData["payments"][number]> & { id: string }): MonthlyRawData["payments"][number] => ({
  total: 20000,
  amount: null,
  tip_amount: 0,
  status: "cobrado",
  method: "efectivo",
  payment_method: null,
  splits: null,
  employee_id: "emp-a",
  client_id: null,
  client_name: "Cliente",
  created_at: "2026-10-10T15:00:00Z",
  ...over,
});

const base = (over: Partial<MonthlyRawData> = {}): MonthlyRawData => ({
  payments: [],
  collections: [],
  collectionPayments: [],
  expenses: [],
  commissions: [],
  attendance: [],
  consumos: [],
  employees: [
    { id: "emp-a", full_name: "Alan" },
    { id: "emp-b", full_name: "Pipo" },
  ],
  ...over,
});

describe("Rendimiento mensual", () => {
  it("la facturación cuenta solo lo cobrado: pendientes y anuladas quedan afuera, los cobros de pendientes suman", () => {
    const perf = computeMonthlyPerformance(
      "2026-10",
      base({
        payments: [
          pay({ id: "p1", total: 20000 }),
          pay({ id: "p2", total: 25000, method: "transferencia" }),
          pay({ id: "p3", total: 20000, status: "pendiente" }),
          pay({ id: "p4", total: 21900, status: "anulado" }),
        ],
        collections: [{ id: "c1", payment_id: "p9", amount: 15000, method: "transferencia" }],
        collectionPayments: [{ id: "p9", employee_id: "emp-b" }],
      }),
    );
    expect(perf.facturacion).toBe(20000 + 25000 + 15000);
    expect(perf.ventas).toBe(2);
    expect(perf.pendienteDeCobro).toBe(20000);
    // el cobro de una venta de otro mes se le atribuye al profesional de esa venta
    expect(perf.profesionales.find((p) => p.id === "emp-b")?.facturacion).toBe(15000);
  });

  it("la ganancia resta TODOS los gastos (caja y fondos externos) y separa cuánto fue externo", () => {
    const perf = computeMonthlyPerformance(
      "2026-10",
      base({
        payments: [pay({ id: "p1", total: 100000 })],
        expenses: [
          { id: "e1", amount: 30000, type: "variable", funds_source: "otros" },
          { id: "e2", amount: 10000, type: "fijo", funds_source: "caja" },
          { id: "e3", amount: 5000, type: "variable", funds_source: null },
        ],
      }),
    );
    expect(perf.gastosTotal).toBe(45000);
    expect(perf.gastosExternos).toBe(30000);
    expect(perf.gastosCaja).toBe(15000);
    expect(perf.ganancia).toBe(55000);
    expect(perf.margen).toBeCloseTo(55, 5);
    expect(perf.gastosPorTipo[0]).toEqual({ tipo: "Variable", total: 35000 });
  });

  it("lo que se le paga a los profesionales (comisiones) se descuenta de la ganancia", () => {
    const perf = computeMonthlyPerformance(
      "2026-10",
      base({
        payments: [pay({ id: "p1", total: 20000 }), pay({ id: "p2", total: 20000, status: "pendiente" })],
        commissions: [
          { sale_id: "p1", professional_id: "emp-a", amount: 9000 },
          { sale_id: "p2", professional_id: "emp-a", amount: 9000 },
        ],
        expenses: [{ id: "e1", amount: 2000, type: "variable", funds_source: "otros" }],
      }),
    );
    // solo cuenta la comisión de la venta cobrada, no la de la pendiente
    expect(perf.comisiones).toBe(9000);
    expect(perf.pagoProfesionales).toBe(9000);
    // 20.000 de facturación − 2.000 de gastos − 9.000 de comisiones
    expect(perf.ganancia).toBe(9000);
  });

  it("los medios de pago reparten una venta con pago múltiple entre sus medios", () => {
    const perf = computeMonthlyPerformance(
      "2026-10",
      base({
        payments: [
          pay({
            id: "p1",
            total: 30000,
            splits: [
              { method: "efectivo", amount: 10000 },
              { method: "transferencia", amount: 20000 },
            ],
          }),
        ],
      }),
    );
    const cash = perf.metodos.find((m) => m.key === "cash")?.monto ?? 0;
    const transfer = perf.metodos.find((m) => m.key === "transfer")?.monto ?? 0;
    expect(Math.round(cash)).toBe(10000);
    expect(Math.round(transfer)).toBe(20000);
  });

  it("puntualidad: cuenta tardes, ausencias y el descuento aplicado por profesional", () => {
    const perf = computeMonthlyPerformance(
      "2026-10",
      base({
        payments: [pay({ id: "p1" })],
        attendance: [
          { employee_id: "emp-a", status: "tarde", discount_amount_applied: 1000 },
          { employee_id: "emp-a", status: "ausente", discount_amount_applied: 5000 },
          { employee_id: "emp-a", status: "a_tiempo", discount_amount_applied: 0 },
        ],
      }),
    );
    const alan = perf.profesionales.find((p) => p.id === "emp-a")!;
    expect(alan.tardes).toBe(1);
    expect(alan.ausencias).toBe(1);
    expect(alan.descuentoPuntualidad).toBe(6000);
  });

  it("los productos que un profesional retira a cuenta (adelanto de inventario) suman como ingreso del mes", () => {
    const perf = computeMonthlyPerformance(
      "2026-10",
      base({
        payments: [pay({ id: "p1", total: 100000 })],
        consumos: [
          { id: "a1", amount: 3500, professional_id: "emp-a" },
          { id: "a2", amount: 1500, professional_id: "emp-b" },
        ],
        expenses: [{ id: "e1", amount: 20000, type: "variable", funds_source: "otros" }],
      }),
    );
    expect(perf.consumosProfesionales).toBe(5000);
    expect(perf.consumosCount).toBe(2);
    // la facturación = cobrado + consumos de profesionales; el cobrado queda aparte
    expect(perf.cobrado).toBe(100000);
    expect(perf.facturacion).toBe(105000);
    expect(perf.ganancia).toBe(105000 - 20000);
  });

  it("los retiros de stock se identifican por la nota 'Retiro de stock:' del adelanto", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
    expect(read("src/routes/cash-register.tsx")).toContain("`Retiro de stock: ${item.name");
    expect(read("src/lib/monthly-performance.ts")).toContain('.ilike("note", "Retiro de stock:%")');
  });

  it("el descuento de puntualidad baja lo que se le paga al profesional y un ajuste a favor lo sube", () => {
    const perf = computeMonthlyPerformance(
      "2026-10",
      base({
        payments: [pay({ id: "p1", total: 100000 })],
        commissions: [{ sale_id: "p1", professional_id: "emp-a", amount: 40000 }],
        attendance: [
          { employee_id: "emp-a", status: "tarde", discount_amount_applied: 1000 },
          { employee_id: "emp-a", status: "ausente", discount_amount_applied: 5000 },
          { employee_id: "emp-a", status: "tarde", discount_amount_applied: -500 },
        ],
      }),
    );
    expect(perf.descuentoPuntualidad).toBe(5500);
    expect(perf.pagoProfesionales).toBe(34500);
    expect(perf.ganancia).toBe(100000 - 34500);
  });

  it("un mes sin ventas ni gastos queda marcado sin datos", () => {
    expect(computeMonthlyPerformance("2026-10", base()).hasData).toBe(false);
  });

  it("helpers de mes: límites en hora de Argentina, etiqueta y desplazamiento", () => {
    const { start, end, firstDay, lastDay } = monthBounds("2026-10");
    expect(firstDay).toBe("2026-10-01");
    expect(lastDay).toBe("2026-10-31");
    expect(start.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-01T02:59:59.999Z");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthLabel("2026-10")).toBe("Octubre 2026");
    expect(variationPct(150, 100)).toBe(50);
    expect(variationPct(10, 0)).toBeNull();
  });

  it("está montado en Asesor IA → Análisis → Evolución del negocio (sin pestaña propia) y exporta con el diálogo de impresión", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
    const advisor = read("src/routes/advisor.tsx");
    expect(advisor).not.toContain('key: "rendimiento"');
    expect(advisor).toContain("<RendimientoMensual />");
    expect(advisor.indexOf("<RendimientoMensual />")).toBeGreaterThan(advisor.indexOf("EVOLUCIÓN DEL NEGOCIO"));
    expect(advisor.indexOf("<RendimientoMensual />")).toBeLessThan(advisor.indexOf("RADIOGRAFÍA DEL LOCAL"));
    expect(read("src/lib/monthly-performance-pdf.ts")).toContain("win.print()");
  });
});
