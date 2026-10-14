import { describe, expect, it } from "vitest";
import {
  applyPromotionDiscount,
  backfillPromotionVigencia,
  hasClientReachedPerClientLimit,
  hasPromotionReachedLimit,
  isPromotionApplicable,
  isPromotionCurrentlyValid,
  normalizeClientKeys,
  resolvePromotionBadgeLabel,
  type Promotion,
} from "./service-pricing";

// Base genérica reutilizable en todos los casos — representa cualquier
// promo futura, no una hardcodeada por nombre (Promo UADE/Amigos son solo
// los IDs reales usados para las pruebas de regresión, no casos especiales
// en el código).
function makePromotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: "promo-1",
    name: "Promo genérica",
    imageUrl: null,
    description: "",
    active: true,
    discountType: "fixed",
    discountValue: "1000",
    requiresCode: false,
    code: "",
    serviceIds: ["service-1"],
    categoryNames: [],
    employeeIds: ["employee-1"],
    hasVigencia: false,
    startDate: "",
    endDate: "",
    days: {
      mon: { enabled: true, start: "", end: "" },
      tue: { enabled: true, start: "", end: "" },
      wed: { enabled: true, start: "", end: "" },
      thu: { enabled: true, start: "", end: "" },
      fri: { enabled: true, start: "", end: "" },
      sat: { enabled: true, start: "", end: "" },
      sun: { enabled: true, start: "", end: "" },
    },
    maxUsesTotal: null,
    maxUsesPerClient: null,
    usageCount: 0,
    usedByClient: {},
    ...overrides,
  };
}

describe("resolvePromotionBadgeLabel — badge de Agenda, cualquier promo/profesional", () => {
  it("sin promotion_id no muestra nada (turno normal)", () => {
    expect(resolvePromotionBadgeLabel(null, null)).toBeNull();
    expect(resolvePromotionBadgeLabel(undefined, undefined)).toBeNull();
  });

  it("con promotion_id y snapshot muestra el nombre real, no 'Promo' genérico", () => {
    expect(resolvePromotionBadgeLabel("promo-uade", { name: "Promo UADE" })).toBe("Promo UADE");
    expect(resolvePromotionBadgeLabel("promo-amigos", { name: "Promo AMIGOS" })).toBe("Promo AMIGOS");
  });

  it("funciona igual para cualquier promoción futura, sin lógica especial por nombre", () => {
    expect(resolvePromotionBadgeLabel("promo-x", { name: "2x1 Verano 2027" })).toBe("2x1 Verano 2027");
  });

  it("turno viejo con promotion_id pero sin snapshot cae a 'Promo' en vez de romper", () => {
    expect(resolvePromotionBadgeLabel("promo-old", null)).toBe("Promo");
    expect(resolvePromotionBadgeLabel("promo-old", { name: "" })).toBe("Promo");
  });

  it("no depende del profesional — misma función para todos (Pipo incluido)", () => {
    // La función no recibe employeeId en absoluto: no hay forma de que el
    // resultado varíe según quién sea el profesional.
    const forAnyEmployee = resolvePromotionBadgeLabel("promo-1", { name: "Promo UADE" });
    expect(forAnyEmployee).toBe("Promo UADE");
  });
});

describe("isPromotionCurrentlyValid", () => {
  it("activa + sin vigencia configurada = siempre válida", () => {
    const promo = makePromotion({ hasVigencia: false, active: true });
    expect(isPromotionCurrentlyValid(promo, new Date("2026-01-15T10:00:00"))).toBe(true);
  });

  it("inactiva nunca es válida, sin importar vigencia", () => {
    const promo = makePromotion({ active: false });
    expect(isPromotionCurrentlyValid(promo, new Date())).toBe(false);
  });

  it("respeta startDate/endDate cuando hasVigencia=true", () => {
    const promo = makePromotion({ hasVigencia: true, startDate: "2026-06-01", endDate: "2026-06-30" });
    expect(isPromotionCurrentlyValid(promo, new Date("2026-05-15T10:00:00"))).toBe(false);
    expect(isPromotionCurrentlyValid(promo, new Date("2026-06-15T10:00:00"))).toBe(true);
    expect(isPromotionCurrentlyValid(promo, new Date("2026-07-01T10:00:00"))).toBe(false);
  });

  it("respeta cupo total agotado", () => {
    const promo = makePromotion({ maxUsesTotal: 5, usageCount: 5 });
    expect(hasPromotionReachedLimit(promo)).toBe(true);
    expect(isPromotionCurrentlyValid(promo, new Date())).toBe(false);
  });
});

describe("isPromotionApplicable — servicio/profesional, sin IDs fijos", () => {
  it("aplica si el servicio y el profesional están incluidos", () => {
    const promo = makePromotion({ serviceIds: ["svc-corte"], employeeIds: ["emp-pipo"] });
    expect(isPromotionApplicable(promo, { serviceId: "svc-corte", employeeId: "emp-pipo", category: null })).toBe(true);
  });

  it("no aplica si el servicio no está incluido (ni por categoría)", () => {
    const promo = makePromotion({ serviceIds: ["svc-corte"], categoryNames: [], employeeIds: ["emp-pipo"] });
    expect(isPromotionApplicable(promo, { serviceId: "svc-barba", employeeId: "emp-pipo", category: "Barba" })).toBe(false);
  });

  it("aplica por categoría cuando el servicio puntual no está en serviceIds", () => {
    const promo = makePromotion({ serviceIds: [], categoryNames: ["Cortes"], employeeIds: ["emp-pipo"] });
    expect(isPromotionApplicable(promo, { serviceId: "svc-nuevo", employeeId: "emp-pipo", category: "Cortes" })).toBe(true);
  });

  it("no aplica si el profesional elegido no está en employeeIds (ningún profesional recibe trato especial)", () => {
    const promo = makePromotion({ serviceIds: ["svc-corte"], employeeIds: ["emp-daniel"] });
    expect(isPromotionApplicable(promo, { serviceId: "svc-corte", employeeId: "emp-pipo", category: null })).toBe(false);
    expect(isPromotionApplicable(promo, { serviceId: "svc-corte", employeeId: "emp-daniel", category: null })).toBe(true);
  });
});

describe("applyPromotionDiscount", () => {
  it("descuento fijo resta el valor exacto", () => {
    const promo = makePromotion({ discountType: "fixed", discountValue: "2900" });
    expect(applyPromotionDiscount(21900, promo)).toBe(19000);
  });

  it("descuento porcentual calcula sobre el precio base", () => {
    const promo = makePromotion({ discountType: "percent", discountValue: "10" });
    expect(applyPromotionDiscount(20000, promo)).toBe(18000);
  });

  it("nunca resulta en precio negativo", () => {
    const promo = makePromotion({ discountType: "fixed", discountValue: "999999" });
    expect(applyPromotionDiscount(5000, promo)).toBe(0);
  });

  it("sin promo, devuelve el precio sin tocar", () => {
    expect(applyPromotionDiscount(15000, null)).toBe(15000);
  });
});

describe("límite por cliente — Promo Amigos (dos clientes, dos turnos)", () => {
  it("dos claves (teléfono + mail) se generan igual para cualquier cliente", () => {
    const keys = normalizeClientKeys("11 5999-0000", "Cliente@Mail.com");
    expect(keys).toContain("phone:1159990000");
    expect(keys).toContain("email:cliente@mail.com");
  });

  it("cada cliente de Promo Amigos consume su propio cupo, no comparten contador", () => {
    const promo = makePromotion({
      maxUsesPerClient: 1,
      usedByClient: { "phone:1159990001": 1 },
    });
    const joaquin = normalizeClientKeys("1159990001", "");
    const lautaro = normalizeClientKeys("1159990002", "");
    expect(hasClientReachedPerClientLimit(promo, joaquin)).toBe(true);
    expect(hasClientReachedPerClientLimit(promo, lautaro)).toBe(false);
  });
});

describe("backfillPromotionVigencia — promos creadas antes del switch Vigencia", () => {
  it("promo vieja sin hasVigencia pero con fechas se marca como vigencia real", () => {
    const old = makePromotion({ startDate: "2026-01-01" });
    delete (old as Record<string, unknown>).hasVigencia;
    const result = backfillPromotionVigencia(old);
    expect(result.hasVigencia).toBe(true);
  });

  it("promo vieja sin fechas/días restringidos se marca como siempre vigente", () => {
    const old = makePromotion({});
    delete (old as Record<string, unknown>).hasVigencia;
    const result = backfillPromotionVigencia(old);
    expect(result.hasVigencia).toBe(false);
  });

  it("promo que ya tiene hasVigencia explícito no se toca", () => {
    const promo = makePromotion({ hasVigencia: true });
    expect(backfillPromotionVigencia(promo)).toBe(promo);
  });
});
