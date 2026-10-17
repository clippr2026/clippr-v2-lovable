import { describe, expect, it } from "vitest";
import { resolveDaySchedule, type ScheduleMap, type EmployeeSpecialDateMap, type SpecialDateMap } from "./availability";

// Fecha fija de prueba — un viernes cualquiera.
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

describe("resolveDaySchedule — horario semanal recurrente sigue intersectado con el negocio", () => {
  it("el horario semanal del profesional nunca supera el del negocio", () => {
    const empSchedule: ScheduleMap = { ...BUSINESS_SCHEDULE, fri: { enabled: true, start: "08:00", end: "23:00" } };
    const result = resolveDaySchedule(BUSINESS_SCHEDULE, { pipo: empSchedule }, {}, {}, "pipo", FRIDAY);
    expect(result?.start).toBe("11:00");
    expect(result?.end).toBe("20:00");
  });

  it("negocio cerrado ese día → el profesional también queda cerrado, sin excepción puntual", () => {
    const businessClosedFriday: ScheduleMap = { ...BUSINESS_SCHEDULE, fri: { enabled: false, start: "11:00", end: "20:00" } };
    const result = resolveDaySchedule(businessClosedFriday, {}, {}, {}, "pipo", FRIDAY);
    expect(result?.enabled).toBe(false);
  });
});

describe("resolveDaySchedule — excepción puntual de 'Horario especial' SÍ puede superar el horario del negocio", () => {
  it("negocio cerrado ese día, pero el profesional tiene una excepción puntual habilitada ese día exacto", () => {
    const businessClosedFriday: ScheduleMap = { ...BUSINESS_SCHEDULE, fri: { enabled: false, start: "11:00", end: "20:00" } };
    const employeeSpecial: EmployeeSpecialDateMap = {
      pipo: { [FRIDAY_KEY]: { enabled: true, start: "22:00", end: "23:30" } },
    };
    const result = resolveDaySchedule(businessClosedFriday, {}, {}, employeeSpecial, "pipo", FRIDAY);
    expect(result?.enabled).toBe(true);
    expect(result?.start).toBe("22:00");
    expect(result?.end).toBe("23:30");
  });

  it("negocio abierto 11:00-20:00, pero la excepción puntual del profesional empieza antes y termina después", () => {
    const employeeSpecial: EmployeeSpecialDateMap = {
      pipo: { [FRIDAY_KEY]: { enabled: true, start: "08:00", end: "23:00" } },
    };
    const result = resolveDaySchedule(BUSINESS_SCHEDULE, {}, {}, employeeSpecial, "pipo", FRIDAY);
    expect(result?.start).toBe("08:00");
    expect(result?.end).toBe("23:00");
  });

  it("la excepción puntual respeta su propio descanso, no el del negocio", () => {
    const businessWithBreak: ScheduleMap = {
      ...BUSINESS_SCHEDULE,
      fri: { enabled: true, start: "11:00", end: "20:00", breakStart: "13:00", breakEnd: "14:00" },
    };
    const employeeSpecial: EmployeeSpecialDateMap = {
      pipo: { [FRIDAY_KEY]: { enabled: true, start: "11:00", end: "20:00", breakStart: "16:00", breakEnd: "17:00" } },
    };
    const result = resolveDaySchedule(businessWithBreak, {}, {}, employeeSpecial, "pipo", FRIDAY);
    expect(result?.breakStart).toBe("16:00");
    expect(result?.breakEnd).toBe("17:00");
  });

  it("una excepción puntual deshabilitada (día de franco puntual) sigue cerrando al profesional, nunca lo abre de más", () => {
    const employeeSpecial: EmployeeSpecialDateMap = {
      pipo: { [FRIDAY_KEY]: { enabled: false, start: "11:00", end: "20:00" } },
    };
    const result = resolveDaySchedule(BUSINESS_SCHEDULE, {}, {}, employeeSpecial, "pipo", FRIDAY);
    expect(result?.enabled).toBe(false);
  });

  it("la excepción puntual es solo para ESE profesional — otro profesional sin excepción sigue intersectado con el negocio", () => {
    const businessClosedFriday: ScheduleMap = { ...BUSINESS_SCHEDULE, fri: { enabled: false, start: "11:00", end: "20:00" } };
    const employeeSpecial: EmployeeSpecialDateMap = {
      pipo: { [FRIDAY_KEY]: { enabled: true, start: "22:00", end: "23:30" } },
    };
    const otro = resolveDaySchedule(businessClosedFriday, {}, {}, employeeSpecial, "alan", FRIDAY);
    expect(otro?.enabled).toBe(false);
  });

  it("la excepción puntual es solo para ESA fecha — otro día sigue intersectado con el negocio normalmente", () => {
    const employeeSpecial: EmployeeSpecialDateMap = {
      pipo: { [FRIDAY_KEY]: { enabled: true, start: "22:00", end: "23:30" } },
    };
    const otroDia = new Date("2026-10-17T12:00:00"); // sábado, sin excepción
    const result = resolveDaySchedule(BUSINESS_SCHEDULE, {}, {}, employeeSpecial, "pipo", otroDia);
    expect(result?.start).toBe("11:00");
    expect(result?.end).toBe("20:00");
  });
});
