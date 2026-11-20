import { describe, expect, it } from "vitest";
import { evaluarDecisiones, type DecisionesInput } from "./decisiones-negocio";

const profes = [
  { name: "Alan", used: 56, capacity: 100 },
  { name: "Franco", used: 35, capacity: 100 },
];
const base: DecisionesInput = {
  ocupacion: 47,
  profesionales: profes,
  seFueronPorLugarFranjas: [],
  masPedido: null,
  franjaConMasCasos: { dia: "jueves", hora: 18 },
};
const get = (d: ReturnType<typeof evaluarDecisiones>, k: string) => d.find((x) => x.clave === k)!;
// jueves = 4. Franja de 18 a 19 hs con 600 minutos disponibles en el mes.
const franjaJueves18 = (agendado: number, atendido: number) => ({ dow: 4, hour: 18, disponible: 600, agendado, atendido });
const casos = (n: number, dow = 4, hour = 18) => Array.from({ length: n }, () => ({ dow, hour }));

describe("¿Necesitás más capacidad de atención?", () => {
  it("el título cambió", () => {
    expect(get(evaluarDecisiones(base), "contratar").titulo).toBe("¿Necesitás más capacidad de atención?");
  });
  it("con la agenda al 47% en el mes pero una franja llena donde se fueron clientes: reforzar esa franja, no descartar", () => {
    const d = evaluarDecisiones({ ...base, seFueronPorLugarFranjas: casos(3), franjas: [franjaJueves18(540, 300)] });
    const c = get(d, "contratar");
    expect(c.estado).toBe("si");
    expect(c.respuesta).toBe("Reforzá una franja");
    expect(c.detalle).toContain("jueves de 18 a 19 hs");
    expect(c.detalle).toContain("90% agendada y 50% atendida");
    expect(c.detalle).toContain("no hace falta sumar a alguien fijo");
  });
  it("lo atendido (clientes sin turno) también hace que una franja cuente como llena", () => {
    const c = get(evaluarDecisiones({ ...base, seFueronPorLugarFranjas: casos(2), franjas: [franjaJueves18(100, 540)] }), "contratar");
    expect(c.estado).toBe("si");
    expect(c.detalle).toContain("90% atendida");
  });
  it("si se repite en varias franjas llenas: sumar capacidad", () => {
    const d = evaluarDecisiones({
      ...base,
      seFueronPorLugarFranjas: [...casos(2, 4, 18), ...casos(2, 3, 19), ...casos(2, 5, 17)],
      franjas: [franjaJueves18(560, 0), { dow: 3, hour: 19, disponible: 600, agendado: 560, atendido: 0 }, { dow: 5, hour: 17, disponible: 600, agendado: 560, atendido: 0 }],
    });
    expect(get(d, "contratar").respuesta).toBe("Sí, sumar capacidad");
  });
  it("clientes que se fueron en una franja con tiempo libre: revisar los horarios, no contratar", () => {
    const c = get(evaluarDecisiones({ ...base, seFueronPorLugarFranjas: casos(3), franjas: [franjaJueves18(150, 90)] }), "contratar");
    expect(c.estado).toBe("info");
    expect(c.respuesta).toBe("Revisá horarios");
    expect(c.detalle).toContain("Había tiempo libre");
  });
  it("con pocos clientes que se fueron avisa que son pocos datos", () => {
    expect(get(evaluarDecisiones({ ...base, seFueronPorLugarFranjas: casos(1) }), "contratar").respuesta).toBe("Pocos datos");
  });
  it("muchos días llenos sin clientes que se fueron: cerca, sin un porcentaje fijo", () => {
    const d = evaluarDecisiones({
      ...base,
      profesionales: [
        { name: "Alan", used: 60, capacity: 100, daysWorked: 20, daysFull: 10 },
        { name: "Franco", used: 56, capacity: 100, daysWorked: 20, daysFull: 8 },
      ],
    });
    expect(get(d, "contratar").estado).toBe("cerca");
  });
  it("la ocupación alta del mes por sí sola ya no decide", () => {
    const d = evaluarDecisiones({ ...base, ocupacion: 92 });
    expect(get(d, "contratar").estado).toBe("no");
    expect(get(d, "precios").estado).toBe("no");
  });
});

describe("¿Subir precios?", () => {
  it("un profesional lleno muchos días pide subir su precio aunque el promedio del mes sea bajo", () => {
    const d = evaluarDecisiones({
      ...base,
      ocupacion: 55,
      profesionales: [
        { name: "Alan", used: 60, capacity: 100, daysWorked: 20, daysFull: 9 },
        { name: "Franco", used: 30, capacity: 100, daysWorked: 20, daysFull: 1 },
      ],
      masPedido: { name: "Alan", n: 4 },
    });
    const p = get(d, "precios");
    expect(p.respuesta).toBe("Sí, a Alan");
    expect(p.detalle).toContain("Alan tuvo la agenda llena 9 de 20 días");
    expect(p.detalle).toContain("4 clientes lo pidieron");
    expect(p.detalle).toContain("Con el resto todavía no");
  });
  it("franjas llenas con clientes que se fueron: probar en horarios pico", () => {
    const p = get(evaluarDecisiones({ ...base, seFueronPorLugarFranjas: casos(2), franjas: [franjaJueves18(540, 0)] }), "precios");
    expect(p.respuesta).toBe("Probá en horarios pico");
    expect(p.detalle).toContain("jueves de 18 a 19 hs");
  });
  it("sin horarios llenos con clientes que se van: todavía no", () => {
    expect(get(evaluarDecisiones(base), "precios").respuesta).toBe("Todavía no");
  });
  it("clientes que se van por el precio: se avisa y, si son 3 o más, un sí pasa a con cuidado", () => {
    const sub = { ...base, profesionales: [{ name: "Alan", used: 60, capacity: 100, daysWorked: 20, daysFull: 9 }] };
    const uno = get(evaluarDecisiones({ ...sub, seFueronPorPrecio: 1 }), "precios");
    expect(uno.estado).toBe("si");
    expect(uno.detalle).toContain("1 cliente se fue por el precio");
    const tres = get(evaluarDecisiones({ ...sub, seFueronPorPrecio: 3 }), "precios");
    expect(tres.estado).toBe("cerca");
    expect(tres.respuesta).toBe("Con cuidado");
  });
  it("con pocos días trabajados no se fía de la proporción de días llenos", () => {
    const d = evaluarDecisiones({ ...base, profesionales: [{ name: "Alan", used: 60, capacity: 100, daysWorked: 4, daysFull: 4 }] });
    expect(get(d, "precios").estado).toBe("no");
  });
});

describe("Entender los horarios", () => {
  it("marca el desparejo entre profesionales y la franja con más casos", () => {
    const h = get(evaluarDecisiones(base), "horarios");
    expect(h.detalle).toContain("Franco está al 35% y Alan al 56%");
    expect(h.detalle).toContain("jueves de 18 a 19 hs");
  });
});
