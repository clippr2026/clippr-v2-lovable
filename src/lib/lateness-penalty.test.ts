import { describe, expect, it } from "vitest";
import {
  allocateProportional,
  computeLatenessPenalty,
  hasCatalogItems,
  latenessMinutes,
  pickLatenessRule,
  serviceCommissionOf,
  servicePenalty,
  type LatenessRuleLike,
} from "./lateness-penalty";

// Reglas del negocio: 11:01 a 11:14 -> 5 puntos; 11:15 en adelante -> 10.
const RULES: LatenessRuleLike[] = [
  { min_minutes: 1, discount_type: "percent", discount_value: 5 },
  { min_minutes: 15, discount_type: "percent", discount_value: 10 },
];

// Horario programado 11:00 (hora de Buenos Aires, -03:00) y una entrada a la
// hora indicada.
const expected = "2026-10-29T11:00:00-03:00";
const at = (hhmmss: string) => `2026-10-29T${hhmmss}-03:00`;

// Un corte de $20.000 con la comisión habitual del 45% = $9.000.
const CORTE = [{ commission: 9000, pct: 45 }];

function netCommission(arrival: string, services = CORTE) {
  const late = latenessMinutes(expected, at(arrival));
  const r = computeLatenessPenalty({ lateMinutes: late, rules: RULES, services });
  const gross = services.reduce((s, x) => s + x.commission, 0);
  return { late, penalty: r.total, net: gross - r.total, points: r.points };
}

describe("penalización por tardanza en puntos porcentuales", () => {
  it("11:00 o antes: comisión normal del 45% ($9.000)", () => {
    expect(netCommission("11:00:00")).toMatchObject({ late: 0, penalty: 0, net: 9000, points: 0 });
    expect(netCommission("10:45:00")).toMatchObject({ late: 0, penalty: 0, net: 9000 });
  });

  it("11:01: 5 puntos -> 40% ($8.000, descuento $1.000 y no el 5% de la comisión)", () => {
    expect(netCommission("11:01:00")).toMatchObject({ late: 1, penalty: 1000, net: 8000, points: 5 });
  });

  it("11:14: sigue en el tramo de 5 puntos -> 40% ($8.000)", () => {
    expect(netCommission("11:14:00")).toMatchObject({ late: 14, penalty: 1000, net: 8000, points: 5 });
  });

  it("11:15: 10 puntos -> 35% ($7.000)", () => {
    expect(netCommission("11:15:00")).toMatchObject({ late: 15, penalty: 2000, net: 7000, points: 10 });
  });

  it("11:30: 10 puntos -> 35% ($7.000)", () => {
    expect(netCommission("11:30:00")).toMatchObject({ late: 30, penalty: 2000, net: 7000, points: 10 });
  });

  it("los segundos no adelantan el tramo: 11:00:59 es 11:00 y 11:14:59 sigue siendo 14 min", () => {
    expect(latenessMinutes(expected, at("11:00:59"))).toBe(0);
    expect(latenessMinutes(expected, at("11:14:59"))).toBe(14);
    expect(netCommission("11:14:59")).toMatchObject({ penalty: 1000, points: 5 });
    expect(netCommission("11:00:59")).toMatchObject({ penalty: 0 });
  });

  it("la regla de la tasa propia: con el 50% y 10 puntos se cobra el 40%", () => {
    // Corte de $20.000 al 50% = $10.000 de comisión.
    const r = netCommission("11:30:00", [{ commission: 10000, pct: 50 }]);
    expect(r).toMatchObject({ penalty: 2000, net: 8000 }); // 8.000 sobre 20.000 = 40%
  });

  it("aplica a todos los servicios de la jornada y suma un único ajuste total", () => {
    // $20.000 (45% = 9.000) y $15.000 (45% = 6.750) a las 11:30.
    const services = [
      { commission: 9000, pct: 45 },
      { commission: 6750, pct: 45 },
    ];
    const r = computeLatenessPenalty({ lateMinutes: 30, rules: RULES, services });
    expect(r.total).toBe(3500); // 10 puntos de $35.000
    expect(r.perService).toEqual([2000, 1500]);
    expect(r.perService.reduce((s, x) => s + x, 0)).toBe(r.total);
  });

  it("un servicio con comisión especial o fija (sin tasa) no se penaliza y se informa", () => {
    const services = [
      { commission: 9000, pct: 45 },
      { commission: 5000, pct: null },
    ];
    const r = computeLatenessPenalty({ lateMinutes: 30, rules: RULES, services });
    expect(r.total).toBe(2000);
    expect(r.perService).toEqual([2000, 0]);
    expect(r.excludedServices).toBe(1);
  });

  it("nunca resta más que la propia comisión del servicio", () => {
    // Tasa del 5% con una regla de 10 puntos: la comisión no pasa a negativa.
    expect(servicePenalty(1000, 5, 10)).toBe(1000);
    const r = computeLatenessPenalty({ lateMinutes: 30, rules: RULES, services: [{ commission: 1000, pct: 5 }] });
    expect(r.total).toBe(1000);
  });

  it("una regla de importe fijo se mantiene fija, sin convertirla en porcentaje", () => {
    const fixed: LatenessRuleLike[] = [{ min_minutes: 1, discount_type: "fixed", discount_value: 3000 }];
    const r = computeLatenessPenalty({ lateMinutes: 5, rules: fixed, services: CORTE });
    expect(r.total).toBe(3000);
    expect(r.points).toBe(0);
    // y con tope: nunca más que la comisión de servicios del día
    const capped = computeLatenessPenalty({ lateMinutes: 5, rules: fixed, services: [{ commission: 2000, pct: 45 }] });
    expect(capped.total).toBe(2000);
  });

  it("la propina nunca entra: la base es solo la comisión de servicios", () => {
    // Un cobro de $20.000 con $2.000 de propina sigue teniendo $9.000 de comisión de servicios.
    expect(computeLatenessPenalty({ lateMinutes: 30, rules: RULES, services: CORTE }).total).toBe(2000);
  });

  it("sin regla alcanzada no hay penalización", () => {
    expect(pickLatenessRule(RULES, 0)).toBeNull();
    expect(pickLatenessRule(RULES, 1)?.discount_value).toBe(5);
    expect(pickLatenessRule(RULES, 14)?.discount_value).toBe(5);
    expect(pickLatenessRule(RULES, 15)?.discount_value).toBe(10);
  });

  it("allocateProportional suma exacto aun con redondeos", () => {
    const parts = allocateProportional(10, [1, 1, 1]);
    expect(parts.reduce((s, x) => s + x, 0)).toBe(10);
    expect(allocateProportional(0, [5, 5])).toEqual([0, 0]);
  });
});

describe("el catálogo no lleva descuento por puntualidad", () => {
  it("una venta solo de catálogo no aporta base (amount_services = 0)", () => {
    expect(serviceCommissionOf({ amount: 500, amount_services: 0, hasCatalogItems: true })).toBe(0);
  });

  it("una venta de servicio + catálogo ya desglosada solo cuenta la parte de servicios", () => {
    expect(serviceCommissionOf({ amount: 9500, amount_services: 9000, hasCatalogItems: true })).toBe(9000);
  });

  it("servicio + catálogo SIN desglose (registro viejo): se excluye, no se puede separar", () => {
    expect(serviceCommissionOf({ amount: 8550, amount_services: null, hasCatalogItems: true })).toBe(0);
  });

  it("solo servicios sin desglose: cuenta la comisión completa", () => {
    expect(serviceCommissionOf({ amount: 9000, amount_services: null, hasCatalogItems: false })).toBe(9000);
  });

  it("un día con un servicio y una venta de catálogo penaliza solo el servicio", () => {
    const services = [
      { commission: serviceCommissionOf({ amount: 9000, amount_services: 9000 }), pct: 45 },
      { commission: serviceCommissionOf({ amount: 500, amount_services: 0, hasCatalogItems: true }), pct: 45 },
    ];
    const r = computeLatenessPenalty({ lateMinutes: 30, rules: RULES, services });
    expect(r.total).toBe(2000);
    expect(r.perService).toEqual([2000, 0]);
  });

  it("hasCatalogItems detecta productos en los ítems de la venta", () => {
    expect(hasCatalogItems([{ name: "Corte" }, { name: "Coca", is_catalog: true }])).toBe(true);
    expect(hasCatalogItems([{ name: "Corte", is_catalog: false }])).toBe(false);
    expect(hasCatalogItems(null)).toBe(false);
    expect(hasCatalogItems([])).toBe(false);
  });
});
