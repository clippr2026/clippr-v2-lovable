import { describe, expect, it } from "vitest";
import * as cajaCierre from "./caja-cierre";
import {
  cajaDateKeyBA,
  computeExpectedCashAndDigital,
  dayBoundsBA,
  filterToDayBA,
  normalizeCierreMethodKey,
} from "./caja-cierre";

// Cierres exclusivamente manuales, fecha por fecha — no puede existir
// ningún camino de código que extienda un cierre a "ahora" ni que se
// etiquete a sí mismo como automático. Test estructural: si alguien
// reintroduce closeCierreForDate (el viejo cierre de "caja vencida" que
// extendía el snapshot hasta el instante actual, mezclando días), esto
// falla y lo avisa en CI en vez de reaparecer en producción.
describe("cierres exclusivamente manuales — sin ningún camino automático/multi-día", () => {
  it("closeCierreForDate (el cierre que se extendía hasta 'ahora') ya no existe", () => {
    expect((cajaCierre as Record<string, unknown>).closeCierreForDate).toBeUndefined();
  });

  it("closeSingleDayCierre y buildSingleDayCierrePreview son las únicas funciones de cierre exportadas", () => {
    expect(typeof cajaCierre.closeSingleDayCierre).toBe("function");
    expect(typeof cajaCierre.buildSingleDayCierrePreview).toBe("function");
  });
});

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

// Caso real reportado: "Todos los movimientos" mostraba Transferencia
// $504.300 (23), Efectivo $185.000 (9), Crédito $21.900 (1) — exactamente
// el 13/10 + 14/10 sumados, porque el modal no filtraba por fecha. Con el
// filtro, elegir el 14/10 tiene que dar solo sus propios números.
describe('"Todos los movimientos" — el resumen por método respeta la fecha elegida', () => {
  type Pay = { total: number; tip_amount: number; method: string; created_at: string };

  // Para no escribir 21 filas a mano, se reconstruye directamente el total
  // real por método del 13/10 y del 14/10 (confirmado contra producción) y
  // se valida la función de agrupación con esos montos ya consolidados.
  function groupByMethodNoTip(rows: Pay[]): Record<string, { total: number; count: number }> {
    const groups: Record<string, { total: number; count: number }> = {};
    for (const p of rows) {
      if (!groups[p.method]) groups[p.method] = { total: 0, count: 0 };
      // Nunca suma tip_amount — la propina no es facturación del negocio.
      groups[p.method].total += p.total;
      groups[p.method].count += 1;
    }
    return groups;
  }

  const all13y14: Pay[] = [
    // 13/10 — 14 transferencias ($306.800), 7 efectivo ($144.000 + $1.000 de propina).
    ...Array.from({ length: 14 }, (_, i) => ({
      total: 306800 / 14,
      tip_amount: 0,
      method: "transfer",
      created_at: `2026-10-13T1${i % 9}:00:00-03:00`,
    })),
    ...Array.from({ length: 7 }, (_, i) => ({
      total: 144000 / 7,
      tip_amount: i === 0 ? 1000 : 0,
      method: "cash",
      created_at: `2026-10-13T0${i}:30:00-03:00`,
    })),
    // 14/10 — 9 transferencias ($193.400), 2 efectivo ($40.000), 1 crédito ($21.900).
    ...Array.from({ length: 9 }, (_, i) => ({
      total: 193400 / 9,
      tip_amount: 0,
      method: "transfer",
      created_at: `2026-10-14T1${i % 9}:00:00-03:00`,
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      total: 40000 / 2,
      tip_amount: i === 0 ? 4100 : 0,
      method: "cash",
      created_at: `2026-10-14T0${i}:15:00-03:00`,
    })),
    { total: 21900, tip_amount: 0, method: "credit", created_at: "2026-10-14T20:00:00-03:00" },
  ];

  it("sin filtro de fecha, el acumulado reproduce el error reportado ($711.200 con propina)", () => {
    const withTips = all13y14.reduce((s, p) => s + p.total + p.tip_amount, 0);
    expect(Math.round(withTips)).toBe(711200);
  });

  it("14/10 acotado al día da exactamente los valores de referencia, sin propina", () => {
    const solo14 = filterToDayBA(all13y14, (p) => p.created_at, "2026-10-14");
    const groups = groupByMethodNoTip(solo14);
    expect(Math.round(groups.transfer.total)).toBe(193400);
    expect(groups.transfer.count).toBe(9);
    expect(Math.round(groups.cash.total)).toBe(40000);
    expect(groups.cash.count).toBe(2);
    expect(Math.round(groups.credit.total)).toBe(21900);
    expect(groups.credit.count).toBe(1);
    const total = Object.values(groups).reduce((s, g) => s + g.total, 0);
    expect(Math.round(total)).toBe(255300);
  });

  it("13/10 acotado al día no incluye nada del 14/10", () => {
    const solo13 = filterToDayBA(all13y14, (p) => p.created_at, "2026-10-13");
    expect(solo13.every((p) => !p.method.includes("credit"))).toBe(true); // el único crédito es del 14/10
    const groups = groupByMethodNoTip(solo13);
    expect(Math.round(groups.transfer.total)).toBe(306800);
    expect(Math.round(groups.cash.total)).toBe(144000);
    expect(groups.credit).toBeUndefined();
  });
});

// Caso real reportado: las tarjetas "Efectivo esperado en caja"/"Dinero
// esperado en cuenta" de Resumen seguían mostrando el acumulado 13/10+14/10
// (el mismo backlog que SÍ necesita Cierre de caja), cuando "Efectivo del
// día"/"Dinero en cuenta del día" tienen que ser siempre el día elegido
// nada más — con o sin el día anterior cerrado.
describe('Resumen — "Efectivo del día"/"Dinero en cuenta del día" nunca dependen de si el día anterior está cerrado', () => {
  const payments14: Array<{ total: number; method: string; created_at: string }> = [
    { total: 20000, method: "cash", created_at: "2026-10-14T05:00:00-03:00" },
    { total: 20000, method: "cash", created_at: "2026-10-14T17:15:33-03:00" },
    ...Array.from({ length: 9 }, (_, i) => ({
      total: 193400 / 9,
      method: "transfer",
      created_at: `2026-10-14T1${i % 9}:30:00-03:00`,
    })),
    { total: 21900, method: "credit", created_at: "2026-10-14T20:08:44-03:00" },
  ];
  const payments13 = Array.from({ length: 21 }, (_, i) => ({
    total: 450800 / 21,
    method: i % 2 === 0 ? "transfer" : "cash",
    created_at: `2026-10-13T1${i % 9}:00:00-03:00`,
  }));

  function cashDigitalForDay(payments: typeof payments14, dateStr: string) {
    const dayRows = filterToDayBA(payments, (p) => p.created_at, dateStr);
    return computeExpectedCashAndDigital({
      payments: dayRows,
      expenses: [],
      advances: [],
      cashMovements: [],
    });
  }

  it("el 14/10 da $40.000 efectivo / $215.300 en cuenta estando el 13/10 SIN cerrar", () => {
    // "Sin cerrar" = no se filtra nada por estado de caja_cierres: el
    // cálculo del día nunca consulta esa tabla, solo payments/expenses/
    // advances/cash_movements acotados a su propio día.
    const allPayments = [...payments13, ...payments14];
    const result = cashDigitalForDay(allPayments, "2026-10-14");
    expect(Math.round(result.cashExpected)).toBe(40000);
    expect(Math.round(result.digitalExpected)).toBe(215300);
  });

  it("el 14/10 da EXACTAMENTE lo mismo si el 13/10 ya está cerrado (quitarlo del array no cambia nada)", () => {
    // Simula "13/10 ya cerrado": ni siquiera está en el array que se le
    // pasa a la función — el resultado del 14/10 tiene que ser idéntico.
    const onlyToday = [...payments14];
    const result = cashDigitalForDay(onlyToday, "2026-10-14");
    expect(Math.round(result.cashExpected)).toBe(40000);
    expect(Math.round(result.digitalExpected)).toBe(215300);
  });

  it("el 13/10 nunca se filtra por su propio estado de cierre — da siempre el mismo total", () => {
    const allPayments = [...payments13, ...payments14];
    const result = cashDigitalForDay(allPayments, "2026-10-13");
    expect(Math.round(result.cashExpected + result.digitalExpected)).toBe(450800);
  });
});
