import { describe, expect, it } from "vitest";
import { computeHealthScore, computeRetention, type HealthInput } from "./health-score";

const base: HealthInput = {
  facturacion: 6_000_000, margen: 30, gastosTotal: 2_000_000, gastosFijosCargados: 3,
  ocupacion: 60, totalSlots: 600,
  retencionGrupo: 100, retencionVolvieron: 60,
  crecimientoPct: 5, ticketPct: 1,
  turnosHechos: 200, turnosCancelados: 15, turnosNoAsistio: 10,
};
const get = (s: ReturnType<typeof computeHealthScore>, k: string) => s.indicators.find((x) => x.key === k)!;

describe("puntaje de salud", () => {
  it("suma exactamente 100 con todos los máximos", () => {
    const s = computeHealthScore({ ...base, margen: 40, ocupacion: 80, retencionVolvieron: 90, crecimientoPct: 20, ticketPct: 8, turnosCancelados: 0, turnosNoAsistio: 0 });
    expect(s.total).toBe(100);
    expect(s.available).toBe(100);
    expect(s.provisional).toBe(false);
    expect(s.partial).toBe(false);
  });
  it("no regala puntos: un negocio sin resultados da 0", () => {
    const s = computeHealthScore({ ...base, margen: -5, ocupacion: 0, retencionVolvieron: 10, crecimientoPct: -30, ticketPct: -20, turnosCancelados: 60, turnosNoAsistio: 60 });
    expect(s.total).toBe(0);
  });
  it("sin gastos fijos cargados la rentabilidad es provisional, se calcula con lo registrado y no se penaliza", () => {
    const con = computeHealthScore(base);
    const sin = computeHealthScore({ ...base, gastosFijosCargados: 0 });
    expect(get(sin, "rentabilidad").state).toBe("provisional");
    expect(get(sin, "rentabilidad").warning).toMatch(/provisional/i);
    expect(get(sin, "rentabilidad").pts).toBe(get(con, "rentabilidad").pts); // mismos puntos: ni tope ni estimación
    expect(sin.total).toBe(con.total);
    expect(sin.provisional).toBe(true);
  });
  it("la confirmación 'gastos del mes completos' saca el estado provisional", () => {
    const s = computeHealthScore({ ...base, gastosFijosCargados: 0, gastosConfirmados: true });
    expect(get(s, "rentabilidad").state).toBe("calculado");
    expect(s.provisional).toBe(false);
  });
  it("al registrar gastos el margen baja y los puntos se recalculan", () => {
    const antes = get(computeHealthScore({ ...base, margen: 64, gastosFijosCargados: 0 }), "rentabilidad");
    const despues = get(computeHealthScore({ ...base, margen: 30, gastosFijosCargados: 2 }), "rentabilidad");
    expect(antes.pts).toBe(25);
    expect(despues.pts).toBeLessThan(25);
    expect(despues.state).toBe("calculado");
  });
  it("lo que no se puede medir queda como insuficiente y el puntaje se reparte sobre el resto", () => {
    const s = computeHealthScore({ ...base, retencionGrupo: 12, crecimientoPct: null, ticketPct: null });
    expect(get(s, "retencion").state).toBe("insuficiente");
    expect(get(s, "retencion").pts).toBeNull();
    expect(get(s, "crecimiento").state).toBe("insuficiente");
    expect(s.available).toBe(60);
    expect(s.partial).toBe(true);
    expect(s.total).not.toBeNull();
  });
  it("con muy pocos indicadores medibles no da puntaje", () => {
    const s = computeHealthScore({ ...base, ocupacion: null, totalSlots: 0, retencionGrupo: 5, crecimientoPct: null, ticketPct: null, turnosHechos: 2, turnosCancelados: 0, turnosNoAsistio: 0 });
    expect(s.total).toBeNull();
  });
  it("cada indicador explica por qué obtuvo esos puntos y qué hacer", () => {
    for (const x of computeHealthScore(base).indicators) {
      expect(x.why.length).toBeGreaterThan(10);
      expect(x.tip.length).toBeGreaterThan(10);
    }
  });
});

describe("retención", () => {
  it("cuenta quién vino hace 45 a 75 días y volvió en los últimos 45", () => {
    const v = [
      { clientKey: "a", dayKey: "2026-09-15" }, { clientKey: "a", dayKey: "2026-10-20" },
      { clientKey: "b", dayKey: "2026-09-20" },
      { clientKey: "c", dayKey: "2026-11-01" }, // reciente: no está en el grupo
      { clientKey: "d", dayKey: "2026-08-01" }, // muy viejo: fuera del grupo
    ];
    expect(computeRetention(v, "2026-11-16")).toEqual({ grupo: 2, volvieron: 1 });
  });
});
