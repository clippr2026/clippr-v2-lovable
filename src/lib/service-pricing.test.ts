import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveServicePricing, type EmployeeServiceOverrideMap } from "./service-pricing";

const repoRoot = path.resolve(__dirname, "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

// Bug real en producción: Agenda mostraba "Precio de lista" y "Precio en
// efectivo" contradictorios para el mismo turno (Maxi Olivera — Corte en
// cabello corto con Alan: Lista $21.900 / Efectivo $23.000, un "descuento"
// que da MÁS caro que el precio de lista). Causa raíz: "Precio de lista"
// salía de appointments.service_price (congelado al crear el turno, antes
// de que Alan tuviera su propio override) mientras "Precio en efectivo" ya
// se resolvía en vivo contra el override vigente — dos fuentes distintas
// para el mismo turno. Esto reproduce el caso real con datos de producción
// y prueba que, resolviendo AMBOS con resolveServicePricing sobre el mismo
// precio de catálogo (lo que exige el pedido: "una única fuente de
// precios"), las dos cifras quedan siempre coherentes entre sí.
describe("resolveServicePricing — Lista y Efectivo nunca pueden contradecirse (caso real: Alan / Corte en cabello corto)", () => {
  const overridesMap: EmployeeServiceOverrideMap = {
    alan: {
      "corte-corto": {
        enabled: true,
        useStandardPrice: false,
        price: "25000",
        useStandardDuration: false,
        duration_min: "60",
        useStandardEffectivePrice: false,
        effectivePrice: "23000",
      },
    },
  };

  it("con el override vigente de Alan, Lista y Efectivo salen coherentes ($25.000 / $23.000), sin importar qué precio tenía el turno congelado", () => {
    const resolved = resolveServicePricing(
      { id: "corte-corto", price: 21900, duration_min: 40, cash_discount: 8.67 },
      "alan",
      overridesMap,
    );
    expect(resolved.price).toBe(25000);
    expect(resolved.effectivePrice).toBe(23000);
    // La garantía central del fix: el efectivo nunca puede superar la lista.
    expect(resolved.effectivePrice).toBeLessThanOrEqual(resolved.price);
  });

  it("sin override (otro profesional), Lista y Efectivo salen del precio estándar del catálogo, también coherentes", () => {
    const resolved = resolveServicePricing(
      { id: "corte-corto", price: 21900, duration_min: 40, cash_discount: 8.67579908675799 },
      "otro-profesional",
      overridesMap,
    );
    expect(resolved.price).toBe(21900);
    expect(resolved.effectivePrice).toBe(20000);
    expect(resolved.effectivePrice).toBeLessThanOrEqual(resolved.price);
  });

  it("sin profesional asignado, resuelve igual al estándar (nunca rompe por employeeId null)", () => {
    const resolved = resolveServicePricing(
      { id: "corte-corto", price: 21900, duration_min: 40, cash_discount: 8.67579908675799 },
      null,
      overridesMap,
    );
    expect(resolved.price).toBe(21900);
  });
});

// Única fuente de precios (sección 3 del pedido): Agenda (vista previa de
// un turno) y Caja (servicesForEmployee, al cobrar) tienen que llamar a
// resolveServicePricing con el MISMO precio de catálogo como base — nunca
// el congelado en el turno. Tests estructurales: si alguien vuelve a leer
// appointment.service_price/serviceTotal como base de la resolución en
// vivo, esto lo avisa en vez de reaparecer en producción.
describe("Agenda — la vista previa de un turno resuelve el precio en vivo, igual que Caja", () => {
  it("el precio de lista/efectivo EN VIVO usa matchedCatalogService.price (el catálogo actual), nunca appointment.service_price/serviceTotal", () => {
    const src = readSrc("src/routes/agenda.tsx");
    const fnMatch = src.match(/const liveResolved =\s*\n([\s\S]*?);\n {2}const listPrice/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/price:\s*matchedCatalogService\.price/);
    expect(fnMatch![1]).not.toMatch(/price:\s*serviceTotal/);
  });

  it("un turno ya cobrado (status === 'charged') nunca recalcula en vivo — conserva el precio congelado", () => {
    const src = readSrc("src/routes/agenda.tsx");
    expect(src).toMatch(/const isAlreadyCharged = appointment\.status === "charged";/);
    expect(src).toMatch(/!isAlreadyCharged && matchedCatalogService/);
  });

  it("la promoción se aplica sobre el precio de lista del catálogo (promoBasePrice), igual que Caja (rawServicePriceById) — nunca sobre el Precio en efectivo ni el congelado", () => {
    const src = readSrc("src/routes/agenda.tsx");
    const fnMatch = src.match(/const promoBasePrice =\s*\n([\s\S]*?);\n {2}const promoFinalPrice/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/matchedCatalogService\.price/);
  });

  it("use-agenda-data.ts escucha postgres_changes de business_settings — un override por profesional se refleja sin recargar la página", () => {
    const src = readSrc("src/components/agenda/use-agenda-data.ts");
    expect(src).toMatch(/table:\s*"business_settings"/);
  });
});
