import { describe, it, expect } from "vitest";
import { computeExpectedCashAndDigital } from "./caja-cierre";
import { saleIngreso, senaMovimientoInfo, senasIngresosDesdeMovimientos, senasOtroDiaAviso } from "./senas-contable";

const base = { payments: [], expenses: [], advances: [] };

describe("Dinero en cuenta con señas: suman el día en que se aprueban", () => {
  it("una seña acreditada el mismo día suma a la cuenta", () => {
    const r = computeExpectedCashAndDigital({
      ...base,
      cashMovements: [
        { type: "ingreso", amount: 100000, method: "cuenta", deposit_id: "d1", credited_at: "2026-11-09T15:00:00Z", created_at: "2026-11-09T16:00:00Z" },
      ],
    });
    expect(r.digitalExpected).toBe(100000);
  });

  it("una seña transferida el domingo y aprobada el lunes suma a la cuenta del lunes", () => {
    const r = computeExpectedCashAndDigital({
      ...base,
      cashMovements: [
        { type: "ingreso", amount: 100000, method: "cuenta", deposit_id: "d1", credited_at: "2026-11-08T15:00:00Z", created_at: "2026-11-09T15:00:00Z" },
      ],
    });
    expect(r.digitalExpected).toBe(100000);
  });

  it("movimientos manuales sin seña no cambian", () => {
    const r = computeExpectedCashAndDigital({
      ...base,
      cashMovements: [{ type: "ingreso", amount: 5000, method: "cuenta" }, { type: "retiro", amount: 2000, method: "efectivo" }],
    });
    expect(r.digitalExpected).toBe(5000);
    expect(r.cashExpected).toBe(-2000);
  });
});

describe("Ingresos con señas (etapa 3)", () => {
  // Ejemplo acordado: servicio de $100.000 con seña de $50.000.
  const senaAprobada = { type: "ingreso", amount: 50000, deposit_id: "d1" };
  const venta = { total: 100000, splits: [{ method: "sena", amount: 50000 }, { method: "cash", amount: 50000 }] };

  it("el día de la aprobación la seña cuenta como ingreso", () => {
    expect(senasIngresosDesdeMovimientos([senaAprobada]).neto).toBe(50000);
  });

  it("al cobrar el turno solo cuenta el saldo restante", () => {
    expect(saleIngreso(venta)).toBe(50000);
  });

  it("seña + venta nunca superan el valor del servicio (no se duplica)", () => {
    expect(senasIngresosDesdeMovimientos([senaAprobada]).neto + saleIngreso(venta)).toBe(100000);
  });

  it("aprobada y cobrada el mismo día: el ingreso del día es el valor del servicio", () => {
    const mismoDia = senasIngresosDesdeMovimientos([senaAprobada]).neto + saleIngreso(venta);
    expect(mismoDia).toBe(100000);
  });

  it("una devolución resta el día en que se devuelve, una sola vez", () => {
    const r = senasIngresosDesdeMovimientos([{ type: "retiro", amount: 50000, deposit_id: "d1" }]);
    expect(r).toEqual({ aprobadas: 0, devueltas: 50000, neto: -50000 });
  });

  it("los ingresos y retiros manuales (sin seña) no son ingresos de señas", () => {
    expect(senasIngresosDesdeMovimientos([{ type: "ingreso", amount: 8000 }, { type: "retiro", amount: 3000, deposit_id: null }]).neto).toBe(0);
  });

  it("una venta sin seña cuenta completa, igual que antes", () => {
    expect(saleIngreso({ total: 30000, splits: [{ method: "cash", amount: 30000 }] })).toBe(30000);
    expect(saleIngreso({ total: 30000, splits: null })).toBe(30000);
  });
});

describe("Señas en la tarjeta y en el detalle del cierre (etapa 4)", () => {
  // Lunes 9/11/2026 (hora de Buenos Aires).
  const hoy = "2026-11-09";
  const deHoy = { tipo: "ingreso" as const, monto: 40000, depositId: "d1", acreditadaEn: "2026-11-09T14:00:00Z", creadoEn: "2026-11-09T15:00:00Z" };
  const delDomingo = { tipo: "ingreso" as const, monto: 60000, depositId: "d2", acreditadaEn: "2026-11-08T20:00:00Z", creadoEn: "2026-11-09T15:30:00Z" };
  const devolucion = { tipo: "retiro" as const, monto: 10000, depositId: "d3", acreditadaEn: "2026-11-09T16:00:00Z", creadoEn: "2026-11-09T16:00:00Z" };
  const manual = { tipo: "ingreso" as const, monto: 5000 };

  it("etiqueta 'Seña de hoy' la acreditada y aprobada hoy", () => {
    expect(senaMovimientoInfo(deHoy, hoy)).toEqual({ devolucion: false, otroDia: false, etiqueta: "Seña de hoy" });
  });

  it("etiqueta 'Seña del domingo' la acreditada el domingo y aprobada el lunes, (se avisa en el cierre)", () => {
    expect(senaMovimientoInfo(delDomingo, hoy)).toEqual({ devolucion: false, otroDia: true, etiqueta: "Seña del domingo" });
  });

  it("en un cierre de un día pasado no dice 'de hoy'", () => {
    expect(senaMovimientoInfo(deHoy, "2026-11-12")?.etiqueta).toBe("Seña del día");
  });

  it("con más de una semana de diferencia usa la fecha, no el día de la semana", () => {
    const vieja = { ...delDomingo, acreditadaEn: "2026-10-28T20:00:00Z" };
    expect(senaMovimientoInfo(vieja, hoy)?.etiqueta).toBe("Seña del 28/10");
  });

  it("un movimiento manual no es una seña", () => {
    expect(senaMovimientoInfo(manual, hoy)).toBeNull();
  });

  it("aviso del cierre: agrupa por día las señas transferidas otro día", () => {
    const otraDelDomingo = { ...delDomingo, depositId: "d4", monto: 20000 };
    const delSabado = { ...delDomingo, depositId: "d5", monto: 15000, acreditadaEn: "2026-11-07T20:00:00Z" };
    expect(senasOtroDiaAviso([deHoy, delDomingo, otraDelDomingo, delSabado, devolucion, manual])).toEqual([
      { texto: "1 seña del sábado", cantidad: 1, monto: 15000 },
      { texto: "2 señas del domingo", cantidad: 2, monto: 80000 },
    ]);
  });

  it("sin señas de otro día no hay aviso", () => {
    expect(senasOtroDiaAviso([deHoy, devolucion, manual])).toEqual([]);
  });
});
