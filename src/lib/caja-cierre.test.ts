import { describe, expect, it } from "vitest";
import {
  cajaDateKeyBA,
  computeExpectedCashAndDigital,
  dayBoundsBA,
  filterToDayBA,
  normalizeCierreMethodKey,
} from "./caja-cierre";

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

describe("cajaDateKeyBA / dayBoundsBA — huso horario de Buenos Aires explícito", () => {
  it("da la fecha de Buenos Aires aunque el instante UTC ya sea el día siguiente", () => {
    // 2026-10-14T02:00:00Z = 2026-10-13 23:00 en Buenos Aires (UTC-3).
    const lateNightUTC = new Date("2026-10-14T02:00:00.000Z");
    expect(cajaDateKeyBA(lateNightUTC)).toBe("2026-10-13");
  });

  it("dayBoundsBA da exactamente 24hs menos 1ms", () => {
    const { start, end } = dayBoundsBA("2026-10-13");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
  });
});

// Caso real reportado: Caja mostraba $706.100 de "Ingresos" el 14/10
// porque sumaba también el 13/10 (sin cerrar) — "Ingresos"/"Gastos" tienen
// que acotarse al día, mientras que el efectivo/cuenta esperados siguen
// siendo el acumulado completo (backlog incluido), que es un concepto
// distinto.
describe("filterToDayBA — separa Ingresos del día de lo acumulado sin cerrar (caso real 13/10 + 14/10)", () => {
  const paymentsAcumulados = [
    // 13/10: $450.800 (21 cobros reales, acá resumidos en 2 líneas para el test)
    { total: 306800, created_at: "2026-10-13T16:06:06.000-03:00" },
    { total: 144000, created_at: "2026-10-13T19:58:54.000-03:00" },
    // 14/10: $255.300
    { total: 193400, created_at: "2026-10-14T15:00:00.000-03:00" },
    { total: 61900, created_at: "2026-10-14T20:08:44.000-03:00" },
  ];

  it("el acumulado completo (sin filtrar) es $706.100 — lo que efectivo/cuenta esperados deben seguir mostrando", () => {
    const totalAcumulado = paymentsAcumulados.reduce((s, p) => s + p.total, 0);
    expect(totalAcumulado).toBe(706100);
  });

  it("Ingresos del 14/10 (acotado al día) es solo $255.300, no $706.100", () => {
    const soloHoy = filterToDayBA(paymentsAcumulados, (p) => p.created_at, "2026-10-14");
    const total = soloHoy.reduce((s, p) => s + p.total, 0);
    expect(total).toBe(255300);
  });

  it("Ingresos del 13/10 (acotado al día) es $450.800, sin arrastrar nada del 14/10", () => {
    const solo13 = filterToDayBA(paymentsAcumulados, (p) => p.created_at, "2026-10-13");
    const total = solo13.reduce((s, p) => s + p.total, 0);
    expect(total).toBe(450800);
  });

  it("los dos días sumados dan el acumulado — no se pierde ni se duplica nada", () => {
    const solo13 = filterToDayBA(paymentsAcumulados, (p) => p.created_at, "2026-10-13");
    const solo14 = filterToDayBA(paymentsAcumulados, (p) => p.created_at, "2026-10-14");
    const suma = [...solo13, ...solo14].reduce((s, p) => s + p.total, 0);
    expect(suma).toBe(706100);
    expect(solo13.length + solo14.length).toBe(paymentsAcumulados.length);
  });
});
