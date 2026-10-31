import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeExpectedCashAndDigital } from "@/lib/caja-cierre";

const repoRoot = path.resolve(__dirname, "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const base = {
  payments: [{ total: 100000, method: "cash" }, { total: 50000, method: "transfer" }],
  expenses: [],
  advances: [],
  cashMovements: [],
};

describe("Pagos de liquidación con origen caja — descuentan del efectivo/cuenta esperados", () => {
  it("sin pagos de caja el esperado no cambia (histórico y externos no se pasan)", () => {
    const r = computeExpectedCashAndDigital(base);
    expect(r.cashExpected).toBe(100000);
    expect(r.digitalExpected).toBe(50000);
    expect(r.cashSettlementOut).toBe(0);
  });

  it("un pago en efectivo baja el efectivo, uno por transferencia baja la cuenta", () => {
    const r = computeExpectedCashAndDigital({
      ...base,
      settlementOutflows: [
        { amount: 30000, payment_method: "cash" },
        { amount: 10000, payment_method: "transfer" },
      ],
    });
    expect(r.cashExpected).toBe(70000);
    expect(r.digitalExpected).toBe(40000);
    expect(r.cashOutflows).toBe(30000);
    expect(r.digitalOutflows).toBe(10000);
    expect(r.cashSettlementOut).toBe(30000);
    expect(r.digitalSettlementOut).toBe(10000);
  });

  it("no se mezcla con adelantos: cada uno suma una sola vez", () => {
    const r = computeExpectedCashAndDigital({
      ...base,
      advances: [{ amount: 5000, payment_method: "efectivo", funds_source: "caja" }],
      settlementOutflows: [{ amount: 20000, payment_method: "cash" }],
    });
    expect(r.cashExpected).toBe(75000);
    expect(r.cashAdvancesOut).toBe(5000);
    expect(r.cashSettlementOut).toBe(20000);
  });
});

describe("Pagar una liquidación — origen y bloqueos en pantalla", () => {
  const src = readSrc("src/routes/cash-register.tsx");

  it("el origen arranca en Fondos externos y viaja al RPC", () => {
    expect(src).toMatch(/useState<AdvanceFundsSource \| "">\("externo"\)/);
    expect(src).toMatch(/p_funds_source: liquidarFunds \|\| "externo"/);
  });

  it("con la caja cerrada, 'Caja del día' está bloqueado y Pagar no deja avanzar", () => {
    expect(src).toMatch(/disabled=\{opt\.value === "caja" && cajaCerrada\}/);
    expect(src).toMatch(/liquidarFunds === "caja" && cajaCerrada/);
  });

  it("si el monto supera lo que hay en la caja, muestra que no hay ese dinero", () => {
    expect(src).toMatch(/No hay ese dinero en la caja: efectivo disponible/);
    expect(src).toMatch(/No hay ese dinero en la caja: dinero en cuenta disponible/);
  });

  it("los pagos de caja se cargan aparte de los adelantos (nunca dentro de professional_advances)", () => {
    const hook = readSrc("src/hooks/use-cash-movements.ts");
    expect(hook).toMatch(/from\("settlement_payments"/);
    expect(hook).toMatch(/\.eq\("funds_source", "caja"\)/);
    const summary = readSrc("src/hooks/use-caja-summary.ts");
    expect(summary.match(/settlementOutflows/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
