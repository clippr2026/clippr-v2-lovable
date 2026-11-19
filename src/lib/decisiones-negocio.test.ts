import { describe, expect, it } from "vitest";
import { evaluarDecisiones } from "./decisiones-negocio";

const base = {
  ocupacion: 47,
  profesionales: [
    { name: "Alan", used: 56, capacity: 100 },
    { name: "Franco", used: 35, capacity: 100 },
  ],
  seFueronPorLugar: 1,
  masPedido: null,
  franjaConMasCasos: { dia: "miércoles", hora: 19 },
};
const get = (d: ReturnType<typeof evaluarDecisiones>, k: string) => d.find((x) => x.clave === k)!;

describe("decisiones del negocio", () => {
  it("con la agenda al 47% no hay que contratar ni subir precios todavía", () => {
    const d = evaluarDecisiones(base);
    expect(get(d, "contratar").estado).toBe("no");
    expect(get(d, "precios").estado).toBe("no");
  });
  it("con 80% o más: sí a contratar y sí a subir precios", () => {
    const d = evaluarDecisiones({ ...base, ocupacion: 85 });
    expect(get(d, "contratar").estado).toBe("si");
    expect(get(d, "precios").estado).toBe("si");
  });
  it("entre 65% y 79% con clientes que se fueron por lugar: contratar está cerca", () => {
    const d = evaluarDecisiones({ ...base, ocupacion: 72, seFueronPorLugar: 5 });
    expect(get(d, "contratar").estado).toBe("cerca");
    expect(get(d, "precios").estado).toBe("cerca");
  });
  it("entre 65% y 79% sin clientes que se van por lugar: todavía no contratar", () => {
    expect(get(evaluarDecisiones({ ...base, ocupacion: 72, seFueronPorLugar: 1 }), "contratar").estado).toBe("no");
  });
  it("un profesional al 80% con clientes que lo piden: subir el precio de ese profesional", () => {
    const d = evaluarDecisiones({
      ...base,
      ocupacion: 60,
      profesionales: [{ name: "Alan", used: 90, capacity: 100 }, { name: "Franco", used: 30, capacity: 100 }],
      masPedido: { name: "Alan", n: 4 },
    });
    expect(get(d, "precios").estado).toBe("si");
    expect(get(d, "precios").respuesta).toBe("Sí, a Alan");
    expect(get(d, "precios").detalle).toContain("Alan está al 90%");
    expect(get(d, "precios").detalle).toContain("4 clientes lo pidieron");
    expect(get(d, "precios").detalle).toContain("Con el resto todavía no");
  });
  it("un profesional al 80% o más recomienda subir su precio aunque el local tenga lugar, sin que lo hayan pedido", () => {
    const d = evaluarDecisiones({ ...base, ocupacion: 55, profesionales: [{ name: "Alan", used: 82, capacity: 100 }, { name: "Franco", used: 30, capacity: 100 }] });
    expect(get(d, "precios").respuesta).toBe("Sí, a Alan");
    expect(get(evaluarDecisiones({ ...base, ocupacion: 55, profesionales: [{ name: "Alan", used: 82, capacity: 100 }, { name: "Franco", used: 30, capacity: 100 }] }), "contratar").estado).toBe("no");
  });
  it("un profesional lleno en muchos días pide subir su precio aunque el promedio del mes sea bajo", () => {
    const d = evaluarDecisiones({
      ...base,
      ocupacion: 55,
      profesionales: [
        { name: "Alan", used: 60, capacity: 100, daysWorked: 20, daysFull: 9 },
        { name: "Franco", used: 30, capacity: 100, daysWorked: 20, daysFull: 1 },
      ],
    });
    expect(get(d, "precios").respuesta).toBe("Sí, a Alan");
    expect(get(d, "precios").detalle).toContain("Alan tuvo la agenda llena 9 de 20 días");
    expect(get(d, "precios").detalle).toContain("promedio del mes 60%");
  });
  it("si muchos días del local estuvieron llenos, contratar es sí aunque el promedio sea bajo", () => {
    const d = evaluarDecisiones({
      ...base,
      ocupacion: 58,
      profesionales: [
        { name: "Alan", used: 60, capacity: 100, daysWorked: 20, daysFull: 10 },
        { name: "Franco", used: 56, capacity: 100, daysWorked: 20, daysFull: 8 },
      ],
    });
    expect(get(d, "contratar").estado).toBe("si");
    expect(get(d, "contratar").detalle).toContain("18 de 40");
  });
  it("con pocos días trabajados no se fía de la proporción de días llenos", () => {
    const d = evaluarDecisiones({ ...base, ocupacion: 55, profesionales: [{ name: "Alan", used: 60, capacity: 100, daysWorked: 4, daysFull: 4 }] });
    expect(get(d, "precios").estado).toBe("no");
  });
  it("horarios: marca el desparejo entre profesionales y la franja con más casos", () => {
    const h = get(evaluarDecisiones(base), "horarios");
    expect(h.detalle).toContain("Franco está al 35% y Alan al 56%");
    expect(h.detalle).toContain("miércoles de 19 a 20 hs");
  });
  it("sin horarios cargados no inventa una respuesta", () => {
    const d = evaluarDecisiones({ ...base, ocupacion: null });
    expect(get(d, "contratar").respuesta).toBe("Sin datos");
    expect(get(d, "precios").respuesta).toBe("Sin datos");
  });
});
