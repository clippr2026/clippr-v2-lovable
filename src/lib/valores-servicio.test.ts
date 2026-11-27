import { describe, expect, it } from "vitest";
import { valoresVigentes } from "./valores-servicio";

const catalogo = [
  { id: "viejo", name: "Corte", price: 100, duration_min: 30, active: false },
  { id: "s1", name: "Corte", price: 25000, duration_min: 40, active: true },
];

describe("valoresVigentes", () => {
  it("toma el precio y la duración actuales del catálogo", () => {
    expect(valoresVigentes(catalogo, " corte ", null, {})).toEqual({ price: 25000, duration_min: 40 });
  });
  it("respeta lo propio del profesional", () => {
    const overrides = { alan: { s1: { useStandardPrice: false, price: "27000", useStandardDuration: false, duration_min: "60" } } } as never;
    expect(valoresVigentes(catalogo, "Corte", "alan", overrides)).toEqual({ price: 27000, duration_min: 60 });
  });
  it("sin coincidencia devuelve null", () => {
    expect(valoresVigentes(catalogo, "Barba", null, {})).toBeNull();
  });
});
