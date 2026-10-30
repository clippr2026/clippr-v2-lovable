import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeExpectedCashAndDigital } from "./caja-cierre";
import { advanceAffectsCaja, advanceMethodLabel, advanceOriginLabel } from "./advance-origin";

const readSrc = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf8");

// Un día con $100.000 cobrados en efectivo y $200.000 por transferencia.
const BASE = {
  payments: [
    { total: 100000, method: "cash" },
    { total: 200000, method: "transfer" },
  ],
  expenses: [],
  cashMovements: [],
};

const compute = (advances: Array<{ amount: number; payment_method: string; funds_source?: string | null }>) =>
  computeExpectedCashAndDigital({ ...BASE, advances });

describe("Origen del adelanto: cómo entra en el efectivo y el dinero en cuenta esperados", () => {
  it("1) $10.000 en efectivo desde Caja del negocio: descuenta del efectivo, no de la cuenta", () => {
    const r = compute([{ amount: 10000, payment_method: "efectivo", funds_source: "caja" }]);
    expect(r.cashExpected).toBe(90000);
    expect(r.cashAdvancesOut).toBe(10000);
    expect(r.digitalExpected).toBe(200000);
    expect(r.digitalAdvancesOut).toBe(0);
  });

  it("2) $10.000 por transferencia desde Caja del negocio: descuenta de la cuenta, no del efectivo", () => {
    const r = compute([{ amount: 10000, payment_method: "transferencia", funds_source: "caja" }]);
    expect(r.digitalExpected).toBe(190000);
    expect(r.digitalAdvancesOut).toBe(10000);
    expect(r.cashExpected).toBe(100000);
    expect(r.cashAdvancesOut).toBe(0);
  });

  it("3) $10.000 desde Fondos externos: no toca ningún saldo ni las salidas del cierre, con cualquier medio", () => {
    for (const method of ["efectivo", "transferencia"]) {
      const r = compute([{ amount: 10000, payment_method: method, funds_source: "externo" }]);
      expect(r.cashExpected).toBe(100000);
      expect(r.digitalExpected).toBe(200000);
      expect(r.cashAdvancesOut).toBe(0);
      expect(r.digitalAdvancesOut).toBe(0);
      expect(r.cashOutflows).toBe(0);
      expect(r.digitalOutflows).toBe(0);
    }
  });

  it("4) cierre con adelantos de distintos medios y orígenes: cada uno cuenta una sola vez en su saldo", () => {
    const r = compute([
      { amount: 10000, payment_method: "efectivo", funds_source: "caja" },
      { amount: 10000, payment_method: "transferencia", funds_source: "caja" },
      { amount: 10000, payment_method: "efectivo", funds_source: "externo" },
    ]);
    expect(r.cashAdvancesOut).toBe(10000);
    expect(r.digitalAdvancesOut).toBe(10000);
    expect(r.cashExpected).toBe(90000);
    expect(r.digitalExpected).toBe(190000);
    // el total que sale de la caja es 20.000, no 30.000 (el externo no cuenta)
    expect(r.cashOutflows + r.digitalOutflows).toBe(20000);
  });

  it("un adelanto histórico (sin origen) se sigue tratando exactamente como siempre: sale de la caja", () => {
    const r = compute([
      { amount: 10000, payment_method: "efectivo" },
      { amount: 5000, payment_method: "transferencia", funds_source: null },
    ]);
    expect(r.cashExpected).toBe(90000);
    expect(r.digitalExpected).toBe(195000);
  });

  it("un gasto no se mezcla: los adelantos de fondos externos no alteran los gastos ni los retiros manuales", () => {
    const r = computeExpectedCashAndDigital({
      ...BASE,
      expenses: [{ amount: 5000, payment_method: "efectivo" }],
      cashMovements: [{ type: "retiro", amount: 2000, method: "efectivo" }],
      advances: [{ amount: 10000, payment_method: "efectivo", funds_source: "externo" }],
    });
    expect(r.cashExpected).toBe(100000 - 5000 - 2000);
    expect(r.cashOutflows).toBe(7000);
  });
});

describe("Origen del adelanto: textos y reglas de pantalla", () => {
  it("etiquetas de origen y medio", () => {
    expect(advanceOriginLabel("caja")).toBe("Caja del negocio");
    expect(advanceOriginLabel("externo")).toBe("Fondos externos");
    expect(advanceOriginLabel(null)).toBe("Anterior (sin origen)");
    expect(advanceMethodLabel("efectivo")).toBe("Efectivo");
    expect(advanceMethodLabel("transferencia")).toBe("Transferencia");
    expect(advanceMethodLabel(null)).toBe("—");
  });

  it("solo los de fondos externos no afectan la caja", () => {
    expect(advanceAffectsCaja("caja")).toBe(true);
    expect(advanceAffectsCaja(null)).toBe(true);
    expect(advanceAffectsCaja(undefined)).toBe(true);
    expect(advanceAffectsCaja("externo")).toBe(false);
  });

  it("el formulario pide el origen (Caja del negocio por defecto) y lo manda al backend", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/Origen del adelanto/);
    expect(src).toMatch(/source: "caja",\s*\n\s*\}\);/);
    expect(src).toMatch(/p_funds_source: adelantoForm\.source/);
  });

  it("el retiro de stock a cuenta de adelanto no mueve plata de la caja (origen externo)", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/p_funds_source: "externo"/);
  });

  it("Movimientos de caja lista el adelanto de la caja como egreso y excluye los de fondos externos", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/kind: "adelanto",\s*\n\s*ts:/);
    expect(src).toMatch(/\.filter\(\s*\n?\s*\(a\) => advanceAffectsCaja\(a\.funds_source\)/);
  });

  it("el cierre de un día anterior ya no filtra los adelantos por sucursal (la tabla no tiene sucursal)", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    const start = src.indexOf('.from("professional_advances" as any)');
    const bloque = src.slice(start, start + 700);
    expect(bloque).not.toMatch(/advQuery = advQuery\.or\(branchFilter\)/);
    expect(bloque).toMatch(/select\("\*"\)/);
  });

  it("las consultas de adelantos usan select('*') para no fallar si la columna del origen todavía no existe", () => {
    expect(readSrc("src/hooks/use-cash-movements.ts")).toMatch(/professional_advances[\s\S]{0,80}\.select\("\*"\)/);
  });
});
