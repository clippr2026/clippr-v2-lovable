import { describe, expect, it } from "vitest";
import { computeCommissionAmount, resolveServiceCommission } from "@/lib/service-pricing";

const map = {
  "*": { s1: { enabled: true, mode: "percent" as const, value: "40" } },
  e1: { s1: { enabled: true, mode: "percent" as const, value: "60" } },
};

describe("comisión del servicio", () => {
  it("el profesional con comisión propia en el servicio usa la suya", () => {
    expect(resolveServiceCommission("s1", "e1", map)?.value).toBe("60");
  });
  it("sin comisión propia usa la del servicio", () => {
    expect(resolveServiceCommission("s1", "e2", map)?.value).toBe("40");
  });
  it("servicio sin comisión propia ni del servicio no genera comisión (ya no se usa el % general)", () => {
    expect(resolveServiceCommission("s2", "e2", map)).toBeNull();
    const r = computeCommissionAmount([{ serviceId: "s2", amount: 1000 } as any], "e2", map, { commissionPct: 50 });
    expect(r.pctAmount).toBe(0);
  });
  it("calcula con la del servicio", () => {
    const r = computeCommissionAmount([{ serviceId: "s1", amount: 1000 } as any], "e2", map, { commissionPct: 50 });
    expect(r.pctAmount).toBe(400);
  });
  it("'No genera comisión' en un servicio da $0, aunque haya comisión del servicio y general", () => {
    const m = { ...map, e2: { s1: { enabled: true, mode: "fixed" as const, value: "0", noCommission: true } } };
    const r = computeCommissionAmount([{ serviceId: "s1", amount: 1000 } as any], "e2", m, { commissionPct: 50 });
    expect(r.pctAmount + r.fixedAmount).toBe(0);
  });
});
