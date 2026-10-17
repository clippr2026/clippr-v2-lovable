import { describe, expect, it } from "vitest";
import { getVisibleRange } from "./use-agenda-data";
import type { ScheduleMap, EmployeeSpecialDateMap } from "@/lib/availability";

const FRIDAY = new Date("2026-10-16T12:00:00");
const FRIDAY_KEY = "2026-10-16";

const BUSINESS_SCHEDULE: ScheduleMap = {
  sun: { enabled: false, start: "11:00", end: "20:00" },
  mon: { enabled: true, start: "11:00", end: "20:00" },
  tue: { enabled: true, start: "11:00", end: "20:00" },
  wed: { enabled: true, start: "11:00", end: "20:00" },
  thu: { enabled: true, start: "11:00", end: "20:00" },
  fri: { enabled: true, start: "11:00", end: "20:00" },
  sat: { enabled: true, start: "11:00", end: "20:00" },
};

const EMPLOYEES = [{ id: "alejandro", is_active: true }];

describe("getVisibleRange — la grilla se expande (nunca se achica) para mostrar una excepción puntual", () => {
  it("sin ninguna excepción, el rango visible es exactamente el del negocio", () => {
    const range = getVisibleRange(BUSINESS_SCHEDULE, {}, {}, {}, EMPLOYEES, FRIDAY, []);
    expect(range).toEqual({ start: "11:00", end: "20:00" });
  });

  it("un profesional habilitado de 10:00 a 19:00 (antes de que abra el negocio) hace que la grilla arranque a las 10:00", () => {
    const employeeSpecial: EmployeeSpecialDateMap = {
      alejandro: { [FRIDAY_KEY]: { enabled: true, start: "10:00", end: "19:00" } },
    };
    const range = getVisibleRange(BUSINESS_SCHEDULE, {}, {}, employeeSpecial, EMPLOYEES, FRIDAY, []);
    expect(range?.start).toBe("10:00");
    // El cierre del negocio (20:00) sigue siendo más tarde que el del
    // profesional (19:00) — la grilla nunca se achica, solo se expande.
    expect(range?.end).toBe("20:00");
  });

  it("un profesional habilitado hasta las 23:00 (después de que cierra el negocio) hace que la grilla llegue hasta las 23:00", () => {
    const employeeSpecial: EmployeeSpecialDateMap = {
      alejandro: { [FRIDAY_KEY]: { enabled: true, start: "11:00", end: "23:00" } },
    };
    const range = getVisibleRange(BUSINESS_SCHEDULE, {}, {}, employeeSpecial, EMPLOYEES, FRIDAY, []);
    expect(range?.start).toBe("11:00");
    expect(range?.end).toBe("23:00");
  });

  it("la excepción de OTRA fecha no afecta el rango visible del día consultado", () => {
    const employeeSpecial: EmployeeSpecialDateMap = {
      alejandro: { "2026-10-17": { enabled: true, start: "08:00", end: "23:00" } },
    };
    const range = getVisibleRange(BUSINESS_SCHEDULE, {}, {}, employeeSpecial, EMPLOYEES, FRIDAY, []);
    expect(range).toEqual({ start: "11:00", end: "20:00" });
  });

  it("una excepción deshabilitada (franco puntual) no expande la grilla", () => {
    const employeeSpecial: EmployeeSpecialDateMap = {
      alejandro: { [FRIDAY_KEY]: { enabled: false, start: "08:00", end: "23:00" } },
    };
    const range = getVisibleRange(BUSINESS_SCHEDULE, {}, {}, employeeSpecial, EMPLOYEES, FRIDAY, []);
    expect(range).toEqual({ start: "11:00", end: "20:00" });
  });

  it("un profesional inactivo con excepción puntual no expande la grilla", () => {
    const employeeSpecial: EmployeeSpecialDateMap = {
      alejandro: { [FRIDAY_KEY]: { enabled: true, start: "08:00", end: "23:00" } },
    };
    const inactiveEmployees = [{ id: "alejandro", is_active: false }];
    const range = getVisibleRange(BUSINESS_SCHEDULE, {}, {}, employeeSpecial, inactiveEmployees, FRIDAY, []);
    expect(range).toEqual({ start: "11:00", end: "20:00" });
  });
});
