import { describe, expect, it } from "vitest";
import { classifyRecovery, countRecovery, esParaRecuperar } from "./client-recovery";

describe("clientes para recuperar", () => {
  it("clasifica según el estado del módulo Clientes", () => {
    expect(classifyRecovery({ status: "inactivo", visits: 3, lastVisitDays: 50 })).toBe("inactivo");
    expect(classifyRecovery({ status: "perdido", visits: 4, lastVisitDays: 90 })).toBe("recuperable");
    expect(classifyRecovery({ status: "perdido", visits: 1, lastVisitDays: 70 })).toBe("no_volvio");
    expect(classifyRecovery({ status: "perdido", visits: 5, lastVisitDays: 200 })).toBe("archivado");
  });
  it("no cuenta activos, VIP, nuevos ni gente sin visitas", () => {
    expect(classifyRecovery({ status: "activo", visits: 3, lastVisitDays: 47 })).toBeNull();
    expect(classifyRecovery({ status: "vip", visits: 9, lastVisitDays: 60 })).toBeNull();
    expect(classifyRecovery({ status: "nuevo", visits: 1, lastVisitDays: 10 })).toBeNull();
    expect(classifyRecovery({ status: "inactivo", visits: 0, lastVisitDays: null })).toBeNull();
  });
  it("un cliente con turno reservado (activo en la base) no se cuenta aunque pasen más de 45 días", () => {
    expect(esParaRecuperar({ status: "activo", visits: 2, lastVisitDays: 52 })).toBe(false);
  });
  it("cuenta por grupo y deja afuera lo archivado del total a recuperar", () => {
    const c = countRecovery([
      { status: "inactivo", visits: 2, lastVisitDays: 50 },
      { status: "inactivo", visits: 1, lastVisitDays: 55 },
      { status: "perdido", visits: 3, lastVisitDays: 100 },
      { status: "perdido", visits: 1, lastVisitDays: 100 },
      { status: "perdido", visits: 6, lastVisitDays: 400 },
    ]);
    expect(c).toMatchObject({ inactivo: 2, recuperable: 1, no_volvio: 1, archivado: 1, paraRecuperar: 4 });
  });
});
