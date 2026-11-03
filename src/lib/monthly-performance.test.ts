import { describe, expect, it } from "vitest";
import {
  computeMonthlyPerformance,
  monthBounds,
  monthLabel,
  shiftMonth,
  truncateRawToDay,
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
  it("la facturación cuenta por el mes del servicio: una venta pendiente entra completa y su cobro posterior no se suma otra vez", () => {
    const perf = computeMonthlyPerformance(
      "2026-10",
      base({
        payments: [
          pay({ id: "p1", total: 20000 }),
          pay({ id: "p2", total: 25000, method: "transferencia" }),
          pay({ id: "p3", total: 20000, status: "pendiente", employee_id: "emp-b" }),
          pay({ id: "p4", total: 21900, status: "anulado" }),
        ],
        // se cobraron 8.000 de la venta pendiente (en noviembre, da igual): no suman de nuevo
        collections: [
          { id: "c1", payment_id: "p3", amount: 8000, method: "transferencia" },
          // un cobro de una venta de OTRO mes no cuenta en este
          { id: "c2", payment_id: "p-de-septiembre", amount: 99999, method: "efectivo" },
        ],
      }),
    );
    expect(perf.facturacion).toBe(20000 + 25000 + 20000);
    expect(perf.ventas).toBe(3);
    expect(perf.cobrado).toBe(20000 + 25000 + 8000);
    expect(perf.pendienteDeCobro).toBe(12000);
    // a cada profesional le corresponde la venta completa
    expect(perf.profesionales.find((p) => p.id === "emp-b")?.facturacion).toBe(20000);
    // los medios de pago suman la facturación de ventas, con lo no cobrado aparte
    expect(perf.metodos.reduce((s, m) => s + m.monto, 0)).toBeCloseTo(65000, 5);
    expect(perf.metodos.find((m) => m.key === "sin_cobrar")?.monto).toBe(12000);
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

  it("lo que se le paga a los profesionales (comisiones de las ventas del mes) se descuenta de la ganancia", () => {
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
    // cuentan las comisiones de las dos ventas del mes (la pendiente también)
    expect(perf.comisiones).toBe(18000);
    expect(perf.pagoProfesionales).toBe(18000);
    // 40.000 de facturación − 2.000 de gastos − 18.000 de comisiones
    expect(perf.ganancia).toBe(20000);
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

  it("clientes atendidos: cada venta 'sin turno' es una visita anónima y no se junta con otras; un cliente repetido cuenta una vez", () => {
    const perf = computeMonthlyPerformance(
      "2026-10",
      base({
        payments: [
          pay({ id: "p1", client_name: "sin turno" }),
          pay({ id: "p2", client_name: "Sin turno" }),
          pay({ id: "p3", client_name: "" }),
          pay({ id: "p4", client_name: "Matias Besares" }),
          pay({ id: "p5", client_name: "matias besares" }),
          pay({ id: "p6", client_id: "cli-1", client_name: "Otro" }),
          pay({ id: "p7", client_id: "cli-1", client_name: "Otro (editado)" }),
        ],
      }),
    );
    // 3 anónimos + Matias (una vez) + cli-1 (una vez)
    expect(perf.clientes).toBe(5);
  });

  it("el potencial de ocupación se calcula hasta el 75% real (turnos que faltan × ticket) y el ranking sale de las ventas de cada profesional", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
    const hook = read("src/hooks/use-advisor-analytics.ts");
    expect(hook).toContain("Math.ceil(current.totalSlots * 0.75) - current.usedSlots");
    expect(hook).toContain("employeeLoad");
    expect(hook).not.toContain("0.21");
    const advisor = read("src/routes/advisor.tsx");
    expect(advisor).not.toContain("0.21");
    expect(advisor).toContain("analytics.potentialAt75");
  });

  it("truncateRawToDay recorta el mes a los días 1..N en hora de Argentina para comparar el mes en curso contra el mismo período", () => {
    const raw = base({
      payments: [
        pay({ id: "p1", total: 10000, created_at: "2026-10-01T15:00:00Z" }),
        pay({ id: "p2", total: 20000, created_at: "2026-10-03T15:00:00Z" }),
        // 02:30 UTC del 04/10 = 23:30 del 03/10 en Argentina: todavía es día 3
        pay({ id: "p3", total: 30000, created_at: "2026-10-04T02:30:00Z" }),
        pay({ id: "p4", total: 40000, created_at: "2026-10-04T15:00:00Z" }),
        pay({ id: "p5", total: 50000, created_at: "2026-10-20T15:00:00Z", status: "pendiente" }),
      ],
      collections: [
        { id: "c1", payment_id: "p5", amount: 1000, method: "efectivo" },
        { id: "c2", payment_id: "p1", amount: 500, method: "efectivo" },
      ],
      expenses: [
        { id: "e1", amount: 100, type: "fijo", funds_source: "otros", date: "2026-10-03" },
        { id: "e2", amount: 200, type: "fijo", funds_source: "otros", date: "2026-10-04" },
      ],
      commissions: [
        { sale_id: "p2", professional_id: "emp-a", amount: 9000 },
        { sale_id: "p4", professional_id: "emp-a", amount: 9000 },
      ],
      attendance: [
        { employee_id: "emp-a", status: "tarde", discount_amount_applied: 1000, date: "2026-10-02" },
        { employee_id: "emp-a", status: "tarde", discount_amount_applied: 1000, date: "2026-10-09" },
      ],
      consumos: [
        { id: "k1", amount: 3000, professional_id: "emp-a", advanced_at: "2026-10-03T12:00:00Z" },
        { id: "k2", amount: 4000, professional_id: "emp-a", advanced_at: "2026-10-15T12:00:00Z" },
      ],
    });
    const t = truncateRawToDay(raw, 3);
    expect(t.payments.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(t.collections.map((c) => c.id)).toEqual(["c2"]);
    expect(t.expenses.map((e) => e.id)).toEqual(["e1"]);
    expect(t.commissions.map((c) => c.sale_id)).toEqual(["p2"]);
    expect(t.attendance).toHaveLength(1);
    expect(t.consumos.map((c) => c.id)).toEqual(["k1"]);
    const perf = computeMonthlyPerformance("2026-10", t);
    expect(perf.facturacion).toBe(10000 + 20000 + 30000 + 3000);
  });

  it("Evolución del negocio va primero y Salud del negocio segundo; con menos de 7 días se analiza el último mes completo", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
    const advisor = read("src/routes/advisor.tsx");
    expect(advisor.indexOf("EVOLUCIÓN DEL NEGOCIO")).toBeLessThan(advisor.indexOf("SALUD DEL NEGOCIO"));
    const hook = read("src/hooks/use-advisor-analytics.ts");
    expect(hook).toContain("MIN_DAYS_TO_JUDGE = 7");
    expect(hook).toContain("vs el mismo período del mes anterior");
    // el mes elegido en Evolución del negocio manda sobre ocupación, salud y radiografía
    expect(advisor).toContain("useAdvisorAnalytics(businessId, selectedMonthKey)");
    expect(advisor).toContain("onMonthKeyChange={setSelectedMonthKey}");
    expect(hook).toContain("selectedMonthKey");
  });

  it("está montado en Asesor IA → Análisis → Evolución del negocio (sin pestaña propia) y exporta con el diálogo de impresión", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
    const advisor = read("src/routes/advisor.tsx");
    expect(advisor).not.toContain('key: "rendimiento"');
    expect(advisor).toContain("<RendimientoMensual");
    expect(advisor.indexOf("<RendimientoMensual")).toBeGreaterThan(advisor.indexOf("EVOLUCIÓN DEL NEGOCIO"));
    expect(advisor.indexOf("<RendimientoMensual")).toBeLessThan(advisor.indexOf("RADIOGRAFÍA DEL LOCAL"));
    expect(read("src/lib/monthly-performance-pdf.ts")).toContain("win.print()");
  });
});
