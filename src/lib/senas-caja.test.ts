import { describe, expect, it } from "vitest";
import { computeExpectedCashAndDigital, distributeCobroByMethod, receivedDistribution } from "./caja-cierre";
import { applyDepositToSplits } from "@/components/cash-register/register-payment";

const empty = { expenses: [], advances: [], cashMovements: [] };

describe("Seña ya pagada: se registra como un medio de pago y no vuelve a contar como plata recibida", () => {
  it("sin splits: seña + el resto con el medio elegido (la venta sigue siendo el total)", () => {
    const s = applyDepositToSplits(25000, 7500, "cash");
    expect(s).toEqual([{ method: "sena", amount: 7500 }, { method: "cash", amount: 17500 }]);
    expect(s.reduce((a, x) => a + x.amount, 0)).toBe(25000);
  });

  it("seña igual o mayor al total: todo queda como seña, sin otro medio", () => {
    expect(applyDepositToSplits(25000, 30000, "cash")).toEqual([{ method: "sena", amount: 25000 }]);
  });

  it("con pago múltiple ya cargado, la seña se resta del medio de mayor monto y todo sigue sumando el total", () => {
    const s = applyDepositToSplits(25000, 7500, "cash", [
      { method: "cash", amount: 15000 },
      { method: "transfer", amount: 10000 },
    ]);
    expect(s.find((x) => x.method === "sena")?.amount).toBe(7500);
    expect(s.find((x) => x.method === "cash")?.amount).toBe(7500);
    expect(s.find((x) => x.method === "transfer")?.amount).toBe(10000);
    expect(s.reduce((a, x) => a + x.amount, 0)).toBe(25000);
  });

  it("sin seña no cambia nada", () => {
    expect(applyDepositToSplits(25000, 0, "cash")).toEqual([]);
    const own = [{ method: "cash" as const, amount: 25000 }];
    expect(applyDepositToSplits(25000, 0, "cash", own)).toBe(own);
  });

  it("caja: la parte de seña no suma al efectivo/cuenta esperados (ya entró el día de la seña)", () => {
    const r = computeExpectedCashAndDigital({
      ...empty,
      payments: [{ total: 25000, method: "cash", splits: [{ method: "sena", amount: 7500 }, { method: "cash", amount: 17500 }] }],
    });
    expect(r.cashExpected).toBe(17500);
    expect(r.digitalExpected).toBe(0);
  });

  it("caja: la propina entera entra por el medio real del cobro, nunca se pierde la parte de la seña", () => {
    const r = computeExpectedCashAndDigital({
      ...empty,
      payments: [{ total: 25000, tip_amount: 1000, method: "cash", splits: [{ method: "sena", amount: 7500 }, { method: "cash", amount: 17500 }] }],
    });
    expect(r.cashExpected).toBeCloseTo(18500, 5);
  });

  it("caja: seña recibida por transferencia el día anterior + resto en efectivo hoy = cada medio recibe lo suyo", () => {
    // Día de la seña: ingreso manual en cuenta.
    const dia1 = computeExpectedCashAndDigital({ ...empty, payments: [], cashMovements: [{ type: "ingreso", amount: 7500, method: "cuenta" }] });
    expect(dia1.digitalExpected).toBe(7500);
    expect(dia1.cashExpected).toBe(0);
    // Día del servicio: solo entra en efectivo lo que faltaba.
    const dia2 = computeExpectedCashAndDigital({
      ...empty,
      payments: [{ total: 25000, method: "cash", splits: [{ method: "sena", amount: 7500 }, { method: "cash", amount: 17500 }] }],
    });
    expect(dia2.cashExpected).toBe(17500);
    expect(dia2.digitalExpected).toBe(0);
  });

  it("devolución: el retiro por el mismo medio de la seña la saca de caja", () => {
    const r = computeExpectedCashAndDigital({
      ...empty,
      payments: [],
      cashMovements: [
        { type: "ingreso", amount: 7500, method: "efectivo" },
        { type: "retiro", amount: 7500, method: "efectivo" },
      ],
    });
    expect(r.cashExpected).toBe(0);
  });

  it("la facturación por método sigue mostrando la seña como parte de la venta, y 'recibido' no", () => {
    const dist = distributeCobroByMethod(25000, 0, "cash", [{ method: "sena", amount: 7500 }, { method: "cash", amount: 17500 }]);
    expect(dist.sena.monto).toBeCloseTo(7500, 5);
    const rec = receivedDistribution(dist, "cash");
    expect(rec.sena).toBeUndefined();
    expect(rec.cash.monto).toBeCloseTo(17500, 5);
  });
});
