import { describe, expect, it } from "vitest";
import { buildServiceRestriction, intersectDay, normalizeServiceScheduleConfig } from "@/lib/service-schedule";

const day = { enabled: true, start: "11:00", end: "20:00" };

describe("intersectDay", () => {
  it("sin ventana deja el día igual", () => {
    expect(intersectDay(day, undefined)).toEqual(day);
  });
  it("recorta al horario del servicio", () => {
    expect(intersectDay(day, { enabled: true, start: "14:00", end: "18:00" })).toMatchObject({ start: "14:00", end: "18:00" });
  });
  it("no amplía el horario general", () => {
    expect(intersectDay(day, { enabled: true, start: "09:00", end: "22:00" })).toMatchObject({ start: "11:00", end: "20:00" });
  });
  it("día apagado o sin coincidencia = null", () => {
    expect(intersectDay(day, { enabled: false, start: "14:00", end: "18:00" })).toBeNull();
    expect(intersectDay(day, { enabled: true, start: "06:00", end: "10:00" })).toBeNull();
  });
});

describe("buildServiceRestriction", () => {
  const cfg = normalizeServiceScheduleConfig({
    _serviceSchedules: { s1: { tue: { enabled: true, start: "14:00", end: "18:00" }, mon: { enabled: false, start: "11:00", end: "20:00" } } },
    _serviceEmployeeSchedules: { s1: { e1: { tue: { enabled: true, start: "15:00", end: "20:00" } } } },
  });
  it("sin configuración no restringe", () => {
    expect(buildServiceRestriction(cfg, ["otro"])).toBeUndefined();
  });
  it("aplica servicio y profesional", () => {
    const r = buildServiceRestriction(cfg, ["s1"])!;
    expect(r("e2", "tue", day)).toMatchObject({ start: "14:00", end: "18:00" });
    expect(r("e1", "tue", day)).toMatchObject({ start: "15:00", end: "18:00" });
    expect(r("e1", "mon", day)).toBeNull();
    expect(r("e1", "wed", day)).toEqual(day);
  });
});
