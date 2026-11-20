import { describe, expect, it } from "vitest";
import { simularPrecio, type SimuladorInput } from "./simulador-precios";

const base: SimuladorInput = {
  precioActual: 21900, aumento: 1000, ventas30: 258, comision: 0.5, ocupacionAtendida: 47, seFueronPorPrecio: 0,
};

describe("simulador de precios", () => {
  it("facturación adicional = ventas × aumento, si nadie se va", () => {
    expect(simularPrecio(base).facturacionAdicional).toBe(258_000);
  });
  it("la ganancia usa la comisión real, no un porcentaje fijo", () => {
    const r50 = simularPrecio({ ...base, comision: 0.5 });
    const r40 = simularPrecio({ ...base, comision: 0.4 });
    expect(r50.gananciaAdicional).toBe(129_000);
    expect(r40.gananciaAdicional).toBe(154_800);
    expect(r50.comisionReal).toBe(true);
  });
  it("sin comisiones registradas usa una referencia y lo marca", () => {
    const r = simularPrecio({ ...base, comision: null });
    expect(r.comisionReal).toBe(false);
    expect(r.gananciaAdicional).toBe(Math.round(258_000 * 0.45));
  });
  it("punto de equilibrio: ventas que se pueden perder antes de que no convenga", () => {
    const r = simularPrecio(base);
    // 258 × 21.900 / 22.900 = 246,7 → sostener 247 → se pueden perder 11
    expect(r.puntoEquilibrio).toBe(11);
    expect(r.puntoEquilibrioPct).toBeCloseTo(4.3, 0);
  });
  it("riesgo bajo con aumento chico y sin rechazos por precio", () => {
    expect(simularPrecio(base).riesgo).toBe("Bajo");
  });
  it("clientes que se fueron por el precio suben el riesgo", () => {
    expect(simularPrecio({ ...base, seFueronPorPrecio: 1 }).riesgo).toBe("Medio");
    expect(simularPrecio({ ...base, aumento: 3000, seFueronPorPrecio: 3 }).riesgo).toBe("Alto");
  });
  it("un aumento grande es riesgo alto aunque la demanda sea alta", () => {
    expect(simularPrecio({ ...base, aumento: 8000, ocupacionAtendida: 85 }).riesgo).toBe("Alto");
  });
  it("con pocas ventas lo avisa y no da riesgo bajo por casualidad", () => {
    const r = simularPrecio({ ...base, ventas30: 4, aumento: 3000 });
    expect(r.pocosDatos).toBe(true);
    expect(r.factores).toContain("pocas ventas para estimar");
    expect(r.riesgo).not.toBe("Bajo");
  });
});
