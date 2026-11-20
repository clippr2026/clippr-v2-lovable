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

import { mesBaseValido, proyectarMes } from "./simulador-precios";

describe("proyección del próximo mes", () => {
  it("mismas ventas del mes anterior: sin aumento vs con aumento, y escenarios con pérdida de clientes", () => {
    const p = proyectarMes({ precioActual: 20000, aumento: 1000, ventasBase: 100, comision: 0.5 });
    expect(p.sinAumento).toEqual({ ventas: 100, facturacion: 2_000_000 });
    expect(p.escenarios[0]).toMatchObject({ perdidaPct: 0, ventas: 100, difFacturacion: 100_000, difGanancia: 50_000 });
    // perdiendo 5%: 95 × 21.000 = 1.995.000 → -5.000 contra no subir
    expect(p.escenarios[1].difFacturacion).toBe(-5_000);
    expect(p.escenarios[2].difFacturacion).toBeLessThan(0);
  });
  it("no se compara contra diciembre (mes de alta demanda)", () => {
    expect(mesBaseValido("2026-12")).toBe(false);
    expect(mesBaseValido("2026-11")).toBe(true);
    expect(mesBaseValido("2027-01")).toBe(true);
  });
});

describe("sin aumento", () => {
  it("con aumento $0 no hay riesgo, aunque se hayan ido clientes por el precio", () => {
    const r = simularPrecio({ precioActual: 21900, aumento: 0, ventas30: 258, comision: 0.5, ocupacionAtendida: 47, seFueronPorPrecio: 2 });
    expect(r.riesgo).toBe("Sin aumento");
    expect(r.facturacionAdicional).toBe(0);
  });
});
