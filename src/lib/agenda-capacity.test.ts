import { describe, expect, it } from "vitest";
import {
  computeCapacity,
  dayWorkMinutes,
  parseCapacityContext,
  slotMinutesForEmployee,
} from "@/lib/agenda-capacity";

const day = (over: Record<string, unknown> = {}) => ({ enabled: true, start: "11:00", end: "20:00", ...over });
const week = (overrides: Record<string, unknown> = {}) => ({
  sun: day({ enabled: false }),
  mon: day(),
  tue: day(),
  wed: day(),
  thu: day(),
  fri: day(),
  sat: day(),
  ...overrides,
});

describe("Capacidad real de la agenda", () => {
  it("11 a 20 con 1 h de descanso son 8 turnos de 1 h; sin descanso marcado son 9", () => {
    const conDescanso = dayWorkMinutes({ enabled: true, start: "11:00", end: "20:00", breakStart: "13:00", breakEnd: "14:00" });
    const sinDescanso = dayWorkMinutes({ enabled: true, start: "11:00", end: "20:00" });
    expect(conDescanso).toBe(480);
    expect(sinDescanso).toBe(540);
    expect(Math.floor(conDescanso / 60)).toBe(8);
    expect(Math.floor(sinDescanso / 60)).toBe(9);
    // con servicios de 40 min entran más turnos
    expect(Math.floor(conDescanso / 40)).toBe(12);
  });

  it("un día cerrado o con horario inválido no suma minutos", () => {
    expect(dayWorkMinutes({ enabled: false, start: "11:00", end: "20:00" })).toBe(0);
    expect(dayWorkMinutes({ enabled: true, start: "20:00", end: "11:00" })).toBe(0);
    expect(dayWorkMinutes(null)).toBe(0);
  });

  it("la capacidad respeta los días que trabaja cada profesional y su descanso", () => {
    const ctx = parseCapacityContext({
      ...week({ mon: day({ breakStart: "13:00", breakEnd: "14:00" }) }),
      _employeeSchedules: {
        // Pipo: sin descanso marcado y no trabaja los sábados
        pipo: week({ sat: day({ enabled: false }) }),
      },
    });
    // 01/11/2026 es domingo → 1..7 = dom, lun, mar, mié, jue, vie, sáb
    const alan = computeCapacity({ ctx, employeeIds: ["alan"], monthKey: "2026-11", cutoffDay: 7, slotMinutesByEmployee: { alan: 60 } });
    // Alan hereda el horario del negocio: lunes con descanso (8) + 5 días sin descanso (9×5), domingo cerrado
    expect(alan.totalSlots).toBe(8 + 9 * 5);
    const pipo = computeCapacity({ ctx, employeeIds: ["pipo"], monthKey: "2026-11", cutoffDay: 7, slotMinutesByEmployee: { pipo: 60 } });
    // Pipo: lun a vie sin descanso (9 × 5), sábado y domingo no trabaja
    expect(pipo.totalSlots).toBe(9 * 5);
  });

  it("solo cuenta hasta el día de corte: el mes en curso no suma días que todavía no llegaron", () => {
    const ctx = parseCapacityContext(week());
    const tres = computeCapacity({ ctx, employeeIds: ["a"], monthKey: "2026-11", cutoffDay: 3, slotMinutesByEmployee: { a: 60 } });
    // dom (cerrado) + lun + mar
    expect(tres.totalSlots).toBe(9 * 2);
  });

  it("el horario especial de una fecha pisa al semanal", () => {
    const ctx = parseCapacityContext({
      ...week(),
      _employeeSpecialDates: { a: { "2026-11-02": { enabled: false, start: "11:00", end: "20:00" } } },
    });
    const r = computeCapacity({ ctx, employeeIds: ["a"], monthKey: "2026-11", cutoffDay: 3, slotMinutesByEmployee: { a: 60 } });
    // lunes 02/11 cerrado por horario especial → solo el martes
    expect(r.totalSlots).toBe(9);
  });

  it("la duración del turno sale de lo que el profesional realmente atendió (con su duración propia si la tiene)", () => {
    const catalog = [
      { id: "s1", name: "Corte", price: 20000, duration_min: 60 },
      { id: "s2", name: "Barba", price: 8000, duration_min: 20 },
    ];
    // 1 corte y 1 barba → promedio 40
    expect(slotMinutesForEmployee("a", [{ name: "Corte", qty: 1 }, { name: "Barba", qty: 1 }], catalog, {})).toBe(40);
    // sin datos: el servicio más común del catálogo; sin catálogo: 60
    expect(slotMinutesForEmployee("a", [], catalog, {})).toBeGreaterThan(0);
    expect(slotMinutesForEmployee("a", [], [], {})).toBe(60);
    // duración propia del profesional para ese servicio
    const overrides = {
      a: { s1: { useStandardDuration: false, duration_min: "40", useStandardPrice: true, price: "" } },
    } as any;
    expect(slotMinutesForEmployee("a", [{ name: "Corte", qty: 2 }], catalog, overrides)).toBe(40);
  });
});
