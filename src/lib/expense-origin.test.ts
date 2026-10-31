import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeExpectedCashAndDigital } from "./caja-cierre";
import {
  EXPENSE_KINDS,
  expenseAffectsCaja,
  expenseKindLabel,
  expenseOriginLabel,
} from "./expense-origin";

const readSrc = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf8");

// Un día con $100.000 cobrados en efectivo y $200.000 por transferencia.
const compute = (
  expenses: Array<{ amount: number; payment_method: string | null; funds_source?: string | null }>,
) =>
  computeExpectedCashAndDigital({
    payments: [
      { total: 100000, method: "cash" },
      { total: 200000, method: "transfer" },
    ],
    expenses,
    advances: [],
    cashMovements: [],
  });

describe("Origen del dinero de un gasto: cómo entra en efectivo y dinero en cuenta", () => {
  it("1) gasto de Caja del día en efectivo: baja el efectivo, no la cuenta", () => {
    const r = compute([{ amount: 10000, payment_method: "efectivo", funds_source: "caja" }]);
    expect(r.cashExpected).toBe(90000);
    expect(r.digitalExpected).toBe(200000);
  });

  it("2) gasto de Caja del día por transferencia: baja la cuenta, no el efectivo", () => {
    const r = compute([{ amount: 10000, payment_method: "transferencia", funds_source: "caja" }]);
    expect(r.digitalExpected).toBe(190000);
    expect(r.cashExpected).toBe(100000);
  });

  it("3) $900.000 de alquiler con Otros fondos: no baja ningún saldo, con cualquier medio", () => {
    for (const method of ["efectivo", "transferencia"]) {
      const r = compute([{ amount: 900000, payment_method: method, funds_source: "otros" }]);
      expect(r.cashExpected).toBe(100000);
      expect(r.digitalExpected).toBe(200000);
      expect(r.cashExpenses).toBe(0);
      expect(r.digitalExpenses).toBe(0);
    }
  });

  it("4) mezcla: solo los gastos de Caja del día cuentan en el cierre", () => {
    const r = compute([
      { amount: 5000, payment_method: "efectivo", funds_source: "caja" },
      { amount: 900000, payment_method: "efectivo", funds_source: "otros" },
      { amount: 7000, payment_method: "transferencia", funds_source: "caja" },
    ]);
    expect(r.cashExpected).toBe(95000);
    expect(r.digitalExpected).toBe(193000);
  });

  it("5) gastos históricos (sin origen) se tratan como Caja del día, igual que siempre", () => {
    const r = compute([
      { amount: 4000, payment_method: "efectivo", funds_source: null },
      { amount: 6000, payment_method: "débito" },
    ]);
    expect(r.cashExpected).toBe(96000);
    expect(r.digitalExpected).toBe(194000);
  });

  it("6) un gasto de Otros fondos sigue sumando UNA vez en los totales de gastos (reportes)", () => {
    const gastos = [
      { amount: 900000, funds_source: "otros" },
      { amount: 10000, funds_source: "caja" },
      { amount: 500, funds_source: null },
    ];
    // Reportes/Inicio suman todas las filas de expenses una sola vez.
    expect(gastos.reduce((s, g) => s + g.amount, 0)).toBe(910500);
    // La caja solo descuenta las que salen de ella.
    expect(gastos.filter((g) => expenseAffectsCaja(g.funds_source)).reduce((s, g) => s + g.amount, 0)).toBe(10500);
  });
});

describe("Gastos: tipos, etiquetas y formulario", () => {
  it("ofrece exactamente Fijo / Variable / Ocasional", () => {
    expect(EXPENSE_KINDS.map((k) => k.label)).toEqual(["Fijo", "Variable", "Ocasional"]);
  });

  it("etiquetas: tipo nuevo, categoría histórica y origen", () => {
    expect(expenseKindLabel("fijo")).toBe("Fijo");
    expect(expenseKindLabel(null, "Insumos")).toBe("Insumos");
    expect(expenseKindLabel("marketing")).toBe("Marketing");
    expect(expenseKindLabel(null, null)).toBe("—");
    expect(expenseOriginLabel("otros")).toBe("Otros fondos");
    expect(expenseOriginLabel("caja")).toBe("Caja del día");
    expect(expenseOriginLabel(null)).toBe("Caja del día (anterior)");
  });

  it("el formulario guarda tipo, nombre, origen y medio, en el orden pedido, sin las categorías viejas", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    const form = src.slice(src.indexOf("function NuevoGastoTab("), src.indexOf("function ApprovalMode("));
    expect(form).toContain("type: form.kind");
    expect(form).toContain("funds_source: form.source");
    expect(form).toContain("name,");
    expect(form).not.toContain("GCATEGORIES");
    const order = ["¿Qué tipo de gasto es?", "Nombre del gasto", ">Monto<", "¿De dónde sale la plata?", "¿Con qué medio se pagó?", "Nota (opcional)", "Registrar gasto"].map(
      (t) => form.indexOf(t),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("Movimientos y el detalle del cierre muestran nombre, tipo y origen; hay filtro por origen", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toContain("expenseKindLabel(e.type, e.category)");
    expect(src).toContain("Gastos: Otros fondos");
    expect(src).toContain("expenseKindLabel(g.tipo, g.categoria)");
  });

  it("las consultas de gastos traen funds_source (saldos, cierre y Movimientos coinciden)", () => {
    for (const f of ["src/lib/caja-cierre.ts", "src/hooks/use-caja-summary.ts", "src/components/cash-register/use-caja-data.ts"]) {
      expect(readSrc(f)).toContain("payment_method,funds_source,date");
    }
  });
});
