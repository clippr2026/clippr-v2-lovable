import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Guarda de regresión: la funcionalidad "No atendidos" (botón/contador en
// Agenda, resumen en el cierre de Caja, analítica de demanda en Asesor IA)
// fue eliminada por completo. Estos tests evitan que vuelva a reaparecer
// sin querer en un refactor futuro — no vuelven a implementar la feature.

const repoRoot = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

describe("Agenda — estados visibles tras eliminar 'No atendidos'", () => {
  it("STATUS_FILTERS mantiene exactamente los 5 estados pedidos, en este orden", () => {
    const src = read("src/routes/agenda.tsx");
    const match = src.match(/STATUS_FILTERS:[^=]*=\s*\[([\s\S]*?)\];/);
    expect(match).not.toBeNull();
    const keys = [...match![1].matchAll(/\["(\w+)",\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(keys).toEqual([
      ["pending", "Por confirmar"],
      ["confirmed", "Confirmados"],
      ["charged", "Cobrados"],
      ["cancelled", "Cancelados"],
      ["no_show", "No asistió"],
    ]);
  });

  it("ApptStatus no incluye ningún valor de 'no atendido' / rechazado", () => {
    const src = read("src/components/agenda/use-agenda-data.ts");
    const match = src.match(/export type ApptStatus =\s*([\s\S]*?);/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toMatch(/no_atendido|rejected/i);
  });

  it("agenda.tsx no referencia el botón/modal de 'Clientes no atendidos'", () => {
    const src = read("src/routes/agenda.tsx");
    expect(src).not.toMatch(/RejectedClientsButton|RejectedClientCaptureModal|rejectOpen|rejectAt/);
  });
});

describe("Caja — el cierre ya no agrega el resumen de 'Clientes no atendidos'", () => {
  it("session-actions.ts no consulta rejected_clients ni agrega esa línea a la observación", () => {
    const src = read("src/components/cash-register/session-actions.ts");
    expect(src).not.toMatch(/rejected_clients|getRejectedCloseSummary|Clientes no atendidos/);
  });
});

describe("Asesor IA — la analítica de demanda basada en 'No atendidos' fue retirada", () => {
  it("advisor.tsx no importa ni usa los hooks/lib de rejected-analytics", () => {
    const src = read("src/routes/advisor.tsx");
    expect(src).not.toMatch(/use-rejected-analytics|rejected-analytics|useRejectedAnalytics|TIER_EMOJI|buildDemandRecommendations/);
    expect(src).not.toMatch(/No atendidos hoy|Registrar cliente no atendido/);
  });
});

describe("Archivos huérfanos de la feature eliminados del repo", () => {
  it.each([
    "src/components/agenda/rejected-clients.tsx",
    "src/hooks/use-rejected-clients.ts",
    "src/hooks/use-rejected-analytics.ts",
    "src/lib/rejected-analytics.ts",
  ])("%s ya no existe", (rel) => {
    expect(fs.existsSync(path.join(repoRoot, rel))).toBe(false);
  });
});
