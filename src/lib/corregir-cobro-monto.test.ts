import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
});
