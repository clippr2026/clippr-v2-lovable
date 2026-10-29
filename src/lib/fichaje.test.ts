import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { findMatchingRule, type LatenessRule } from "./fichaje";

const repoRoot = path.resolve(__dirname, "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

function rule(min_minutes: number, discount_value: number, discount_type: "percent" | "fixed" = "percent"): LatenessRule {
  return { id: `rule-${min_minutes}`, branch_id: "b1", min_minutes, max_minutes: null, discount_type, discount_value };
}

// Ejemplo real del pedido: entrada 11:00. "Desde 1 minuto: 5%. Desde 15
// minutos: 10%." Los descuentos NO son acumulativos (a los 15 minutos
// corresponde 10%, no 15%) y no hace falta configurar un límite superior —
// la regla de min_minutes más alto ya alcanzado gana siempre.
describe("findMatchingRule — umbral más alto alcanzado, sin rango [min,max]", () => {
  const rules = [rule(1, 5), rule(15, 10)];

  it("0 minutos tarde (11:00 en punto) — ninguna regla aplica (a tiempo, se filtra antes de llamar a esto)", () => {
    expect(findMatchingRule(rules, 0)).toBeNull();
  });

  it("1 minuto tarde (11:01) — regla de 5%", () => {
    expect(findMatchingRule(rules, 1)?.discount_value).toBe(5);
  });

  it("14 minutos tarde (11:14) — todavía 5%, no llegó a la de 15", () => {
    expect(findMatchingRule(rules, 14)?.discount_value).toBe(5);
  });

  it("15 minutos tarde (11:15) — pasa a 10%, nunca 5%+10%=15%", () => {
    expect(findMatchingRule(rules, 15)?.discount_value).toBe(10);
  });

  it("30 minutos tarde — sigue en 10% (la regla de 15 no tiene techo, no hace falta configurar uno)", () => {
    expect(findMatchingRule(rules, 30)?.discount_value).toBe(10);
  });

  it("100 minutos tarde — con reglas reales hoy en producción (0-15:5%, 16-20:10%, sin regla para 21+) esto daba $0; con el modelo de umbral sigue dando la de 15 min", () => {
    const prodRules = [rule(0, 5), rule(16, 10)];
    expect(findMatchingRule(prodRules, 100)?.discount_value).toBe(10);
  });

  it("sin ninguna regla configurada: null, nunca un % inventado", () => {
    expect(findMatchingRule([], 45)).toBeNull();
  });

  it("max_minutes no afecta el resultado aunque esté seteado (compatibilidad con filas viejas)", () => {
    const withMax: LatenessRule = { ...rule(1, 5), max_minutes: 15 };
    const withMax2: LatenessRule = { ...rule(16, 10), max_minutes: 20 };
    expect(findMatchingRule([withMax, withMax2], 25)?.discount_value).toBe(10);
  });
});

// Reconstruye el escenario completo del pedido para dejar explícito el
// vínculo entre minutos tarde y % aplicado, igual que el ejemplo del
// enunciado (comisión $50.000, 5 min tarde, regla 5% -> -$2.500 -> $47.500).
describe("Ejemplo del pedido: comisión de servicios $50.000, 5 min tarde, regla 5%", () => {
  it("descuento = 5% de $50.000 = $2.500, total ajustado $47.500", () => {
    const rules = [rule(1, 5), rule(15, 10)];
    const applicable = findMatchingRule(rules, 5)!;
    const servicesCommission = 50000;
    const discount = Math.round((servicesCommission * applicable.discount_value) / 100);
    expect(discount).toBe(2500);
    expect(servicesCommission - discount).toBe(47500);
  });
});

describe("clockIn — sin tolerancia de minutos, sin congelar el descuento contra $0", () => {
  const src = readSrc("src/lib/fichaje.ts");

  it("no queda ningún TOLERANCE_MINUTES hardcodeado", () => {
    expect(src).not.toMatch(/TOLERANCE_MINUTES/);
  });

  it("lateMinutes se calcula sin restar ninguna tolerancia", () => {
    expect(src).toMatch(
      /const lateMinutes = expected \? Math\.max\(0, Math\.round\(\(now\.getTime\(\) - expected\.getTime\(\)\) \/ 60000\)\) : 0;/,
    );
  });

  it("clockIn ya no llama a ningún cálculo de descuento (se mueve a confirm_attendance, RPC de presentismo)", () => {
    const fnMatch = src.match(/export async function clockIn\([\s\S]*?\n}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).not.toMatch(/applyLatenessDiscount/);
  });

  it("ya no existe el bug employee_id/professional_id (la función que lo tenía se eliminó, no se parchó un código muerto)", () => {
    expect(src).not.toMatch(/getCommissionAvailableToday/);
  });
});
