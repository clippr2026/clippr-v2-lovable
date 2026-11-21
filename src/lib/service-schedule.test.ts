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

import { buildSlots, DEFAULT_SCHEDULE } from "@/lib/availability";

describe("buildSlots con restricción de servicio", () => {
  it("solo ofrece horarios dentro de los días y horas del servicio", () => {
    const open = Object.fromEntries(
      Object.keys(DEFAULT_SCHEDULE).map((k) => [k, { enabled: true, start: "11:00", end: "20:00" }]),
    ) as typeof DEFAULT_SCHEDULE;
    const cfg = normalizeServiceScheduleConfig({
      _serviceSchedules: { s1: { tue: { enabled: true, start: "14:00", end: "18:00" } } },
    });
    // Los demás días no están en la ventana: quedan sin restricción por día ausente, así que se apagan explícito.
    const win = cfg.service.s1;
    for (const k of ["mon", "wed", "thu", "fri", "sat", "sun"] as const) win[k] = { enabled: false, start: "11:00", end: "20:00" };
    const restrict = buildServiceRestriction(cfg, ["s1"])!;
    const days = buildSlots(open, [], [{ id: "e1" }], "e1", 60, 14, {}, {}, {}, "America/Argentina/Buenos_Aires", 0, restrict);
    const all = days.flatMap((d) => d.slots);
    expect(all.length).toBeGreaterThan(0);
    for (const slot of all) {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(slot.time);
      const get = (t: string) => parts.find((p) => p.type === t)!.value;
      expect(get("weekday")).toBe("Tue");
      const mins = Number(get("hour")) * 60 + Number(get("minute"));
      expect(mins).toBeGreaterThanOrEqual(14 * 60);
      expect(mins + 60).toBeLessThanOrEqual(18 * 60);
    }
  });
});
