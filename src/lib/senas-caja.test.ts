import { describe, it, expect } from "vitest";
import { computeExpectedCashAndDigital } from "./caja-cierre";
import { saleIngreso, senasIngresosDesdeMovimientos } from "./senas-contable";

const base = { payments: [], expenses: [], advances: [] };

describe("Dinero en cuenta con señas (etapa 2)", () => {
  it("una seña acreditada el mismo día suma a la cuenta", () => {
    const r = computeExpectedCashAndDigital({
      ...base,
      cashMovements: [
        { type: "ingreso", amount: 100000, method: "cuenta", deposit_id: "d1", credited_at: "2026-11-09T15:00:00Z", created_at: "2026-11-09T16:00:00Z" },
      ],
    });
    expect(r.digitalExpected).toBe(100000);
  });

  it("una seña acreditada el domingo y aprobada el lunes no suma a la cuenta del lunes", () => {
    const r = computeExpectedCashAndDigital({
      ...base,
      cashMovements: [
        { type: "ingreso", amount: 100000, method: "cuenta", deposit_id: "d1", credited_at: "2026-11-08T15:00:00Z", created_at: "2026-11-09T15:00:00Z" },
      ],
    });
    expect(r.digitalExpected).toBe(0);
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
