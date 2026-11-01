import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeCommissionAmount } from "./service-pricing";

const src = fs.readFileSync(path.resolve(__dirname, "../../src/routes/cash-register.tsx"), "utf8");

describe("Corregir cobro: el Monto no se edita, depende del medio de pago", () => {
  it("el monto se muestra de solo lectura y el total sale de Monto − Descuento", () => {
    expect(src).toContain("Monto (según el medio)");
    expect(src).toContain("const correctFinalTotal = Math.max(0, correctMonto - correctDiscountNum)");
    expect(src).toContain("const newTotal = correctFinalTotal;");
    // ya no hay un input editable para el monto
    expect(src).not.toMatch(/value=\{correctTotal\}/);
  });

  it("pasar a Efectivo usa el precio en efectivo del catálogo; salir de Efectivo vuelve al de lista", () => {
    expect(src).toContain('if (correctMethod === "cash") return correctPrices?.cash ?? correctOriginalGross;');
    expect(src).toContain('if (method === "cash") {');
    expect(src).toContain("r.effectivePrice ?? r.price");
  });

  it("Revisar cierre: un adelanto de otro profesional no aparece al filtrar por profesional", () => {
    expect(src).toContain("if (profesionalFiltro !== \"todos\" && a.profesional !== profesionalFiltro) continue;");
    expect(src).toContain("adelantosVisibles.map((a) => (");
  });

  it("la comisión se recalcula con la regla del cobro (tope = precio en efectivo), no por proporción", () => {
    expect(src).toContain("computeCommissionAmount(");
    expect(src).not.toContain("Math.round((newTotal * commissionRecord.commission_pct) / 100)");
    // Caso real 01/11/2026: servicio de $21.900 con precio en efectivo $20.000 y 45% de comisión.
    const map = { prof: { svc: { mode: "percent" as const, value: "45" } } };
    const calc = (discountAmount: number) =>
      computeCommissionAmount(
        [{ amount: 21900, qty: 1, serviceId: "svc", effectivePrice: 20000, discountAmount }],
        "prof",
        map,
        { commissionPct: 0 },
      ).pctAmount;
    expect(calc(0)).toBe(9000);
    // $900 menos (cobró $21.000): sigue por encima del precio en efectivo → no baja.
    expect(calc(900)).toBe(9000);
    // Cobrar $19.000 (por debajo del precio en efectivo) → baja con lo realmente cobrado.
    expect(calc(2900)).toBe(Math.round(19000 * 0.45));
  });
});

