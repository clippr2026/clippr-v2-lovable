import { describe, expect, it } from "vitest";
import { runRecommendationEngine, type EngineClient, type EngineInput } from "@/lib/ai-recommendation-engine";

const NOW = new Date("2026-11-17T15:00:00Z");
const cli = (id: string, over: Partial<EngineClient> = {}): EngineClient => ({
  id, name: `Cliente ${id}`, phone: null, visits: 3, spent: 60000, lastVisit: null, lastVisitDays: 10, status: "activo", history: [], ...over,
});
const employees = [
  { id: "a", full_name: "Alan" },
  { id: "f", full_name: "Franco" },
  { id: "m", full_name: "Melany" },
  { id: "p", full_name: "Pipo" },
  { id: "j", full_name: "Alejandro" },
  { id: "d", full_name: "Daniel" },
];
const run = (extra: Omit<EngineInput, "services">) => runRecommendationEngine({ now: NOW, services: [{ id: "s", name: "Corte", price: 20000 }], ...extra });
const find = (r: ReturnType<typeof run>, key: string) => r.recommendations.find((x) => x.key === key);

describe("Gerente IA: profesional con baja ocupación", () => {
  // Datos reales de noviembre (respaldo del 17/11): Alan hace pocos turnos pero trabaja pocas horas (54%).
  const load = [
    { id: "a", name: "Alan", used: 33, capacity: 61 },
    { id: "f", name: "Franco", used: 48, capacity: 129 }, // 37%: el verdadero más bajo
    { id: "m", name: "Melany", used: 44, capacity: 88 },
    { id: "p", name: "Pipo", used: 50, capacity: 99 },
    { id: "j", name: "Alejandro", used: 48, capacity: 87 },
    { id: "d", name: "Daniel", used: 68, capacity: 140 },
  ];
  it("se mide contra la capacidad de cada uno: marca a Franco, no a Alan", () => {
    const r = run({ clients: [cli("1")], appts: [], employees, employeeLoad: load });
    const rec = find(r, "prof-baja-ocupacion");
    expect(rec?.title).toContain("Franco");
    expect(rec?.title).not.toContain("Alan");
  });
  it("sin información de capacidad no adivina: no emite la recomendación", () => {
    const r = run({ clients: [cli("1")], appts: [], employees });
    expect(find(r, "prof-baja-ocupacion")).toBeUndefined();
  });
  it("si todos rinden parecido, no hay recomendación", () => {
    const parejo = load.map((e) => ({ ...e, used: Math.round(e.capacity * 0.5) }));
    expect(find(run({ clients: [cli("1")], appts: [], employees, employeeLoad: parejo }), "prof-baja-ocupacion")).toBeUndefined();
  });
});

describe("Gerente IA: clientes para recuperar (definición única)", () => {
  it("cuenta inactivos y perdidos recuperables; no cuenta activos con turno reservado aunque pasen 45 días", () => {
    const clients = [
      cli("1", { status: "inactivo", lastVisitDays: 50 }),
      cli("2", { status: "inactivo", lastVisitDays: 55 }),
      cli("3", { status: "perdido", lastVisitDays: 100, visits: 4 }),
      cli("4", { status: "activo", lastVisitDays: 52 }), // tiene turno reservado
      cli("5", { status: "perdido", lastVisitDays: 400, visits: 5 }), // archivado
    ];
    const r = run({ clients, appts: [], employees });
    expect(r.metrics.inactiveCount).toBe(3);
  });
  it("sin estado usa la regla anterior (45 a 179 días)", () => {
    const clients = [cli("1", { status: null, lastVisitDays: 60 }), cli("2", { status: null, lastVisitDays: 10 }), cli("3", { status: null, lastVisitDays: 300 })];
    expect(run({ clients, appts: [], employees }).metrics.inactiveCount).toBe(1);
  });
});

describe("Gerente IA: cancelaciones y no asistencias", () => {
  it("las faltas ('No asistió') cuentan igual que una cancelación", () => {
    const day = (n: number) => new Date(NOW.getTime() - n * 864e5).toISOString();
    const appts = [
      { id: "1", client_name: "A", service_name: "Corte", service_price: 20000, starts_at: day(3), status: "cancelled", employee_id: "a" },
      { id: "2", client_name: "B", service_name: "Corte", service_price: 20000, starts_at: day(4), status: "no_show", employee_id: "a" },
      { id: "3", client_name: "C", service_name: "Corte", service_price: 20000, starts_at: day(5), status: "no_show", employee_id: "f" },
    ];
    const r = run({ clients: [cli("1")], appts, employees });
    expect(r.metrics.cancellationsCurrent).toBe(3);
  });
});
