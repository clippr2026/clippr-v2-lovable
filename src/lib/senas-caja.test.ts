import { describe, it, expect } from "vitest";
import { computeExpectedCashAndDigital } from "./caja-cierre";

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
