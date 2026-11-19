import { describe, expect, it } from "vitest";
import {
  computeHabitualRetention,
  computeHealthScore,
  computeNewClientRetention,
  pointsHabituales,
  pointsNuevos,
  pointsOcupacion,
  pointsRentabilidad,
  type HealthInput,
} from "./health-score";

const base: HealthInput = {
  periodoLabel: "Noviembre 2026",
  periodoCerrado: false,
  hayActividad: true,
  facturacion: 6_000_000,
  gastos: 800_000,
  pagoProfesionales: 3_100_000,
  ganancia: 2_100_000,
  margen: 35,
  turnosRealizados: 800,
  turnosDisponibles: 1_000,
  ocupacionAgendada: 60,
  turnosCancelados: 10,
  turnosNoAsistio: 5,
  nuevosElegibles: 100,
  nuevosVolvieron: 70,
  nuevosDesde: "01/08",
  nuevosHasta: "29/10",
  habituales: 100,
  habitualesAlDia: 85,
};
const get = (s: ReturnType<typeof computeHealthScore>, k: string) => s.indicators.find((x) => x.key === k)!;

describe("puntaje de salud — escalas", () => {
  it("rentabilidad: 0 con 0% o menos, 25 con 20% y 45 con 35% o más, gradual entre medio", () => {
    expect(pointsRentabilidad(-10)).toBe(0);
    expect(pointsRentabilidad(0)).toBe(0);
    expect(pointsRentabilidad(10)).toBeCloseTo(12.5);
    expect(pointsRentabilidad(20)).toBeCloseTo(25);
    expect(pointsRentabilidad(27.5)).toBeCloseTo(35);
    expect(pointsRentabilidad(35)).toBeCloseTo(45);
    expect(pointsRentabilidad(60)).toBeCloseTo(45);
  });
  it("nuevos que vuelven: 0 con 20%, 10 con 45%, 20 con 70% o más", () => {
    expect(pointsNuevos(10)).toBe(0);
    expect(pointsNuevos(45)).toBeCloseTo(10);
    expect(pointsNuevos(70)).toBeCloseTo(20);
    expect(pointsNuevos(95)).toBeCloseTo(20);
  });
  it("habituales al día: 0 con 40%, 5 con 62,5%, 10 con 85% o más", () => {
    expect(pointsHabituales(30)).toBe(0);
    expect(pointsHabituales(62.5)).toBeCloseTo(5);
    expect(pointsHabituales(85)).toBeCloseTo(10);
  });
  it("ocupación: 0 con 20%, 15 con 50%, 25 con 80% o más", () => {
    expect(pointsOcupacion(10)).toBe(0);
    expect(pointsOcupacion(35)).toBeCloseTo(7.5);
    expect(pointsOcupacion(50)).toBeCloseTo(15);
    expect(pointsOcupacion(65)).toBeCloseTo(20);
    expect(pointsOcupacion(80)).toBeCloseTo(25);
    expect(pointsOcupacion(100)).toBeCloseTo(25);
  });
});

describe("puntaje de salud — total", () => {
  it("con todos los máximos suma exactamente 100", () => {
    const s = computeHealthScore(base);
    expect(get(s, "rentabilidad").pts).toBe(45);
    expect(get(s, "retencion").pts).toBe(30);
    expect(get(s, "ocupacion").pts).toBe(25);
    expect(s.total).toBe(100);
    expect(s.available).toBe(100);
    expect(s.partial).toBe(false);
  });
  it("el total es la suma de los puntos que se ven en las tarjetas (sin desajuste por redondeo)", () => {
    const s = computeHealthScore({ ...base, margen: 22.4, nuevosVolvieron: 53, habitualesAlDia: 71, turnosRealizados: 533 });
    const visibles = s.indicators.reduce((acc, x) => acc + (x.pts ?? 0), 0);
    expect(s.total).toBe(visibles);
    for (const x of s.indicators) expect(Number.isInteger(x.pts)).toBe(true);
  });
  it("un negocio sin resultados da 0", () => {
    const s = computeHealthScore({ ...base, margen: -5, ganancia: -300_000, turnosRealizados: 0, nuevosVolvieron: 0, habitualesAlDia: 0 });
    expect(s.total).toBe(0);
  });
  it("sin actividad no hay puntaje", () => {
    const s = computeHealthScore({ ...base, hayActividad: false });
    expect(s.total).toBeNull();
    expect(s.scaled).toBeNull();
  });
  it("período cerrado con pérdida operativa pide atención; el período en curso no", () => {
    expect(computeHealthScore({ ...base, periodoCerrado: true, margen: -3, ganancia: -100_000 }).requiereAtencion).toBe(true);
    expect(computeHealthScore({ ...base, periodoCerrado: false, margen: -3, ganancia: -100_000 }).requiereAtencion).toBe(false);
    expect(computeHealthScore({ ...base, periodoCerrado: true }).requiereAtencion).toBe(false);
  });
});

describe("puntaje de salud — resultado parcial", () => {
  it("si faltan datos de los nuevos, el tramo no suma ni resta y se informa cuántos puntos se evaluaron", () => {
    const s = computeHealthScore({ ...base, nuevosElegibles: 4, nuevosVolvieron: 1 });
    expect(get(s, "retencion").state).toBe("parcial");
    expect(get(s, "retencion").evaluable).toBe(10);
    expect(get(s, "retencion").pts).toBe(10);
    expect(s.available).toBe(80);
    expect(s.partial).toBe(true);
    expect(s.total).toBe(80);
    expect(s.scaled).toBe(100);
  });
  it("sin horarios cargados la ocupación queda sin evaluar", () => {
    const s = computeHealthScore({ ...base, turnosDisponibles: 0 });
    expect(get(s, "ocupacion").state).toBe("insuficiente");
    expect(get(s, "ocupacion").pts).toBeNull();
    expect(s.available).toBe(75);
  });
  it("con muy pocos puntos evaluables no da puntaje", () => {
    const s = computeHealthScore({ ...base, facturacion: 0, margen: null, ganancia: null, turnosDisponibles: 0, nuevosElegibles: 2, habituales: 2 });
    expect(s.total).toBeNull();
  });
  it("cada indicador informa período, datos usados y el máximo", () => {
    const s = computeHealthScore({ ...base, margen: 12, ganancia: 700_000, turnosRealizados: 400 });
    for (const x of s.indicators) {
      expect(x.period.length).toBeGreaterThan(0);
      expect(x.datos.length).toBeGreaterThan(0);
    }
    expect(get(s, "rentabilidad").escala).toBe("45 puntos con 35% de margen o más.");
    expect(get(s, "ocupacion").escala).toBe("25 puntos con 80% de ocupación o más.");
    expect(get(s, "retencion").escala).toMatch(/20 puntos con 70% o más.*10 puntos con 85% o más/);
    expect(get(s, "ocupacion").datos.join(" ")).toMatch(/Turnos realizados: 400.*Turnos disponibles: 1\.000/);
    expect(get(s, "ocupacion").datos.join(" ")).toMatch(/Cancelaciones: 10/);
  });
});

describe("retención", () => {
  const dia = (d: string) => `${d}T15:00:00-03:00`;
  it("nuevos: solo primeras visitas con 45 días completos para volver; volvió = otro día dentro de 45 días", () => {
    const clients = [
      { visits: 2, firstVisitAt: dia("2026-08-10"), secondVisitAt: dia("2026-09-01") }, // volvió a los 22 días
      { visits: 2, firstVisitAt: dia("2026-08-10"), secondVisitAt: dia("2026-10-20") }, // volvió, pero pasados los 45 días
      { visits: 1, firstVisitAt: dia("2026-08-12"), secondVisitAt: null }, // no volvió
      { visits: 1, firstVisitAt: dia("2026-10-25"), secondVisitAt: null }, // todavía no tuvo 45 días: no cuenta
      { visits: 3, firstVisitAt: dia("2026-03-01"), secondVisitAt: dia("2026-03-20") }, // muy vieja: no cuenta
    ];
    const r = computeNewClientRetention(clients, "2026-11-18");
    expect(r.elegibles).toBe(3);
    expect(r.volvieron).toBe(1);
    expect(r.hasta).toBe("04/10");
  });
  it("un segundo cobro el mismo día no cuenta como volver", () => {
    const r = computeNewClientRetention(
      [{ visits: 2, firstVisitAt: dia("2026-08-10"), secondVisitAt: dia("2026-08-10") }],
      "2026-11-18",
    );
    expect(r.volvieron).toBe(0);
  });
  it("habituales: 3 visitas o más; al día si no figuran como Perdidos", () => {
    const r = computeHabitualRetention([
      { visits: 5, grupo: "quincenal" },
      { visits: 8, grupo: "perdido" },
      { visits: 3, grupo: "mensual" },
      { visits: 2, grupo: "perdido" },
      { visits: 1, grupo: "nuevo" },
    ]);
    expect(r).toEqual({ habituales: 3, alDia: 2 });
  });
});
