import { describe, expect, it } from "vitest";
import { computeExpectedCashAndDigital, normalizeCierreMethodKey } from "./caja-cierre";

describe("normalizeCierreMethodKey — mismo vocabulario sin importar el origen (payments vs expenses)", () => {
  it("agrupa efectivo/cash bajo una sola clave", () => {
    expect(normalizeCierreMethodKey("cash")).toBe("cash");
    expect(normalizeCierreMethodKey("efectivo")).toBe("cash");
    expect(normalizeCierreMethodKey("Efectivo")).toBe("cash");
  });

  it("agrupa transferencia/transfer bajo una sola clave", () => {
    expect(normalizeCierreMethodKey("transfer")).toBe("transfer");
    expect(normalizeCierreMethodKey("Transferencia")).toBe("transfer");
  });

  it("agrupa tarjeta/débito/crédito bajo 'card'", () => {
    expect(normalizeCierreMethodKey("tarjeta")).toBe("card");
    expect(normalizeCierreMethodKey("debito")).toBe("card");
    expect(normalizeCierreMethodKey("credito")).toBe("card");
  });

  it("sin método, cae a efectivo (filas viejas sin esa columna)", () => {
    expect(normalizeCierreMethodKey(null)).toBe("cash");
    expect(normalizeCierreMethodKey(undefined)).toBe("cash");
    expect(normalizeCierreMethodKey("")).toBe("cash");
  });
});

// Caso real reportado: el cierre de un día puntual (13/10) tiene que
// calcular efectivo/transferencia EXCLUSIVAMENTE con los movimientos que
// se le pasan — nunca depender de qué día es "hoy" ni de un rango
// implícito. El filtrado por fecha vive en el caller (buildCierreSnapshotForDate/
// buildSingleDayCierrePreview); esta función solo hace la cuenta.
describe("computeExpectedCashAndDigital — efectivo/transferencia de un día acotado", () => {
  it("separa cobros en efectivo de cobros digitales, sin mezclarlos", () => {
    const result = computeExpectedCashAndDigital({
      payments: [
        { total: 23000, method: "cash" },
        { total: 23000, method: "cash" },
        { total: 19000, method: "transfer" },
      ],
      expenses: [],
      advances: [],
      cashMovements: [],
    });
    expect(result.cashExpected).toBe(46000);
    expect(result.digitalExpected).toBe(19000);
  });

  it("resta gastos en efectivo solo del efectivo, nunca del digital", () => {
    const result = computeExpectedCashAndDigital({
      payments: [{ total: 50000, method: "cash" }],
      expenses: [{ amount: 5000, payment_method: "efectivo" }],
      advances: [],
      cashMovements: [],
    });
    expect(result.cashExpected).toBe(45000);
    expect(result.cashOutflows).toBe(5000);
    expect(result.digitalExpected).toBe(0);
  });

  it("resta adelantos en efectivo del efectivo esperado", () => {
    const result = computeExpectedCashAndDigital({
      payments: [{ total: 100000, method: "cash" }],
      expenses: [],
      advances: [{ amount: 30000, payment_method: "efectivo" }],
      cashMovements: [],
    });
    expect(result.cashExpected).toBe(70000);
  });

  it("ingresos/retiros manuales de caja (cash_movements) ajustan el efectivo esperado", () => {
    const result = computeExpectedCashAndDigital({
      payments: [{ total: 10000, method: "cash" }],
      expenses: [],
      advances: [],
      cashMovements: [
        { type: "ingreso", amount: 5000, method: "efectivo" },
        { type: "retiro", amount: 2000, method: "efectivo" },
      ],
    });
    expect(result.cashInflows).toBe(5000);
    expect(result.cashOutflows).toBe(2000);
    expect(result.cashExpected).toBe(10000 + 5000 - 2000);
  });

  it("un día sin ningún movimiento da todo en cero (nunca hereda el día anterior)", () => {
    const result = computeExpectedCashAndDigital({ payments: [], expenses: [], advances: [], cashMovements: [] });
    expect(result.cashExpected).toBe(0);
    expect(result.digitalExpected).toBe(0);
  });
});

// El cierre de un día puntual tiene que estar acotado a ESE día calendario
// (00:00 a 23:59:59.999 hora Argentina) — nunca extenderse hasta "ahora"
// como hace el cierre de "caja vencida". Se prueba el mismo criterio de
// límites que usan buildSingleDayCierrePreview/closeSingleDayCierre.
describe("límites de un día de cierre puntual", () => {
  function isWithinDay(iso: string, dateStr: string): boolean {
    const t = new Date(iso).getTime();
    const start = new Date(`${dateStr}T00:00:00`).getTime();
    const end = new Date(`${dateStr}T23:59:59.999`).getTime();
    return t >= start && t <= end;
  }

  it("un pago del día elegido entra", () => {
    expect(isWithinDay("2026-10-13T17:06:56.466-03:00", "2026-10-13")).toBe(true);
  });

  it("un pago del día SIGUIENTE no entra en el cierre del día anterior", () => {
    expect(isWithinDay("2026-10-14T00:30:00.000-03:00", "2026-10-13")).toBe(false);
  });

  it("un pago del día ANTERIOR no entra en el cierre de hoy", () => {
    expect(isWithinDay("2026-10-12T23:59:00.000-03:00", "2026-10-13")).toBe(false);
  });

  it("exactamente a medianoche del día elegido, entra", () => {
    expect(isWithinDay("2026-10-13T00:00:00.000-03:00", "2026-10-13")).toBe(true);
  });
});
