import { describe, expect, it } from "vitest";
import { fechasDelPatron, repartir, turnosReprogramables } from "./reprogramar-serie";
import type { RepeatConfig } from "./recurring-schedule";

// Miércoles 25/11/2026 a las 12:00 (hora local).
const miercoles = new Date(2026, 10, 25, 12, 0);
const limite = new Date(2026, 11, 31, 23, 59);
const sabados: RepeatConfig = { weekdays: [6], everyWeeks: 1, endMode: "none", count: 4, until: "" };
const dia = (f: Date) => `${f.getDate()}/${f.getMonth() + 1} ${f.getHours()}:${String(f.getMinutes()).padStart(2, "0")}`;
const base = { hora: "16:00", ahora: miercoles, proximoActual: new Date(2026, 10, 27, 16, 0), limite, yaUsados: 0 };

describe("fechasDelPatron", () => {
  it("de viernes a sábado rige desde este mismo sábado", () => {
    expect(fechasDelPatron({ ...base, repeat: sabados }).slice(0, 3).map(dia)).toEqual(["28/11 16:00", "5/12 16:00", "12/12 16:00"]);
  });
  it("si la hora de hoy ya pasó, arranca en la semana siguiente", () => {
    const fechas = fechasDelPatron({ ...base, hora: "10:00", repeat: { ...sabados, weekdays: [3] } });
    expect(dia(fechas[0])).toBe("2/12 10:00");
  });
  it("si la hora de hoy no pasó, incluye hoy", () => {
    expect(dia(fechasDelPatron({ ...base, repeat: { ...sabados, weekdays: [3] } })[0])).toBe("25/11 16:00");
  });
  it("quincenal: respeta la semana del próximo turno", () => {
    const fechas = fechasDelPatron({ ...base, proximoActual: new Date(2026, 11, 4, 16, 0), repeat: { ...sabados, everyWeeks: 2 } });
    expect(fechas.slice(0, 2).map(dia)).toEqual(["5/12 16:00", "19/12 16:00"]);
  });
  it("con cantidad fija descuenta los turnos ya usados", () => {
    expect(fechasDelPatron({ ...base, repeat: { ...sabados, endMode: "count", count: 5 }, yaUsados: 3 })).toHaveLength(2);
    expect(fechasDelPatron({ ...base, repeat: { ...sabados, endMode: "count", count: 3 }, yaUsados: 3 })).toEqual([]);
  });
  it("con fecha de fin ya alcanzada no genera nada", () => {
    expect(fechasDelPatron({ ...base, repeat: { ...sabados, endMode: "until", until: "2026-11-26" } })).toEqual([]);
  });
});

describe("turnosReprogramables y repartir", () => {
  const t = (id: string, d: number, status = "pending") => ({ id, status, starts_at: new Date(2026, 10, d, 16, 0).toISOString() });
  it("solo mueve futuros reservados o confirmados, en orden", () => {
    const lista = [t("b", 27, "confirmed"), t("pasado", 20), t("cobrado", 28, "charged"), t("cancelado", 29, "cancelled"), t("a", 26)];
    expect(turnosReprogramables(lista, miercoles).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("mueve, crea los que faltan y marca los que sobran", () => {
    const f = [new Date(2026, 10, 28), new Date(2026, 11, 5), new Date(2026, 11, 12)];
    const r = repartir([t("a", 27)], f);
    expect(r.mover.map((m) => m.turno.id)).toEqual(["a"]);
    expect(r.crear).toHaveLength(2);
    expect(repartir([t("a", 26), t("b", 27)], f.slice(0, 1)).sobran.map((x) => x.id)).toEqual(["b"]);
  });
});
