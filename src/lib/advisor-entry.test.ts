import { describe, expect, it } from "vitest";
import { buildEntryRecommendation } from "./advisor-entry";

const base = { occupancy: 80, diaTranquilo: null, diaRentable: null };

describe("Asesor IA — recomendación principal de entrada", () => {
  it("prioriza a los clientes que vinieron una sola vez, con la cantidad real y el listado correspondiente", () => {
    const r = buildEntryRecommendation({ ...base, grupoCounts: { una_visita: 12, perdido: 40 } });
    expect(r.title).toBe("Hoy empezaría por los clientes que vinieron una sola vez.");
    expect(r.body).toContain("Hay 12 clientes que hicieron su primera visita hace más de 30 días y todavía no volvieron");
    expect(r.action).toEqual({ kind: "clientes", grupo: "una_visita", label: "Ver clientes" });
  });

  it("con un solo cliente usa el singular", () => {
    const r = buildEntryRecommendation({ ...base, grupoCounts: { una_visita: 1 } });
    expect(r.body).toContain("Hay 1 cliente que hizo su primera visita");
    expect(r.body).toContain("todavía no volvió");
  });

  it("sin clientes de una visita, sigue con los perdidos", () => {
    const r = buildEntryRecommendation({ ...base, grupoCounts: { perdido: 5 } });
    expect(r.action).toEqual({ kind: "clientes", grupo: "perdido", label: "Ver clientes" });
  });

  it("sin clientes para recuperar y con agenda floja, propone llenar el día más tranquilo", () => {
    const r = buildEntryRecommendation({
      grupoCounts: {},
      occupancy: 47,
      diaTranquilo: { dia: "martes", promedio: 183000 },
      diaRentable: { dia: "viernes", promedio: 890490 },
    });
    expect(r.title).toBe("Hoy empezaría por llenar el martes.");
    expect(r.body).toContain("$183.000");
    expect(r.body).toContain("$890.490 del viernes");
    expect(r.action).toEqual({ kind: "agenda", label: "Ver agenda" });
  });

  it("si no hay nada urgente, no inventa una acción", () => {
    const r = buildEntryRecommendation({ ...base, grupoCounts: {} });
    expect(r.action).toBeNull();
  });
});
