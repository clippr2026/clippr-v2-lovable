import { describe, expect, it } from "vitest";
import { evaluarDecisiones, type DecisionesInput } from "./decisiones-negocio";

const base: DecisionesInput = {
  ocupacion: 47,
  profesionales: [
    { name: "Alan", used: 56, capacity: 100 },
    { name: "Franco", used: 35, capacity: 100 },
  ],
  seFueronPorLugarFranjas: [],
  masPedido: null,
  franjaConMasCasos: null,
};
const get = (d: ReturnType<typeof evaluarDecisiones>, k: string) => d.find((x) => x.clave === k)!;
const casos = (n: number, dow = 4, hour = 18) => Array.from({ length: n }, () => ({ dow, hour }));
const franja = (dow: number, hour: number, agendado: number, atendido = 0) => ({ dow, hour, disponible: 600, agendado, atendido });

describe("¿Conviene contratar?", () => {
  it("el título es ¿Conviene contratar?", () => {
    expect(get(evaluarDecisiones(base), "contratar").titulo).toBe("¿Conviene contratar?");
  });
  it("sin clientes que se fueron: No, con la ocupación y el porqué", () => {
    const c = get(evaluarDecisiones(base), "contratar");
    expect(c.respuesta).toBe("No");
    expect(c.detalle).toBe("No, porque la ocupación es 47% y no hay clientes que se hayan ido por falta de lugar.");
  });
  it("con 3 o más clientes que se fueron concentrados en días: Sí, para esos días", () => {
    const c = get(
      evaluarDecisiones({ ...base, seFueronPorLugarFranjas: [...casos(2, 4, 18), ...casos(1, 5, 19)], franjas: [franja(4, 18, 540), franja(5, 19, 100)] }),
      "contratar",
    );
    expect(c.respuesta).toBe("Sí");
    expect(c.detalle).toContain("Sí, porque la ocupación es 47% y se fueron 3 clientes por falta de lugar, sobre todo jueves");
    expect(c.detalle).toContain("Conviene contratar para jueves");
  });
  it("recomienda contratar para varios días: jueves, viernes y sábado", () => {
    const c = get(evaluarDecisiones({ ...base, seFueronPorLugarFranjas: [...casos(2, 4, 18), ...casos(2, 5, 19), ...casos(2, 6, 17)] }), "contratar");
    expect(c.respuesta).toBe("Sí");
    expect(c.detalle).toContain("jueves, viernes y sábado");
  });
  it("3 clientes sin repetirse en el mismo día u horario: Cerca", () => {
    const c = get(evaluarDecisiones({ ...base, seFueronPorLugarFranjas: [{ dow: 1, hour: 12 }, { dow: 3, hour: 15 }, { dow: 5, hour: 19 }] }), "contratar");
    expect(c.respuesta).toBe("Cerca");
  });
  it("1 o 2 clientes sin franja fuerte: No, con la cantidad", () => {
    const c = get(evaluarDecisiones({ ...base, seFueronPorLugarFranjas: [{ dow: 4, hour: 18 }] }), "contratar");
    expect(c.respuesta).toBe("No");
    expect(c.detalle).toContain("solo se fue 1 cliente por falta de lugar");
  });
  it("muchos días llenos pero sin clientes que se vayan: Cerca", () => {
    const c = get(
      evaluarDecisiones({
        ...base,
        profesionales: [
          { name: "Alan", used: 60, capacity: 100, daysWorked: 20, daysFull: 10 },
          { name: "Franco", used: 56, capacity: 100, daysWorked: 20, daysFull: 8 },
        ],
      }),
      "contratar",
    );
    expect(c.respuesta).toBe("Cerca");
  });
  it("nunca dice que había lugar cuando un cliente se fue por falta de lugar", () => {
    const d = evaluarDecisiones({ ...base, seFueronPorLugarFranjas: casos(3), franjas: [franja(4, 18, 300, 200)] });
    expect(get(d, "contratar").detalle).not.toContain("había lugar");
  });
});

describe("¿Entender los horarios?", () => {
  it("la primera hora llena: abrir antes ese día", () => {
    const h = get(
      evaluarDecisiones({ ...base, franjas: [franja(5, 11, 560), franja(5, 12, 100), franja(5, 19, 100)] }),
      "horarios",
    );
    expect(h.respuesta).toBe("Abrir antes");
    expect(h.detalle).toContain("Abrir antes el viernes");
  });
  it("la última hora llena o clientes que se fueron después del cierre: cerrar más tarde", () => {
    const h = get(
      evaluarDecisiones({ ...base, seFueronPorLugarFranjas: [{ dow: 6, hour: 21 }], franjas: [franja(6, 11, 100), franja(6, 20, 100)] }),
      "horarios",
    );
    expect(h.respuesta).toBe("Cerrar más tarde");
    expect(h.detalle).toContain("Cerrar más tarde el sábado");
  });
  it("si hace falta las dos cosas, ampliar el horario", () => {
    const h = get(
      evaluarDecisiones({ ...base, franjas: [franja(5, 11, 560), franja(5, 20, 560), franja(6, 11, 100), franja(6, 20, 560)] }),
      "horarios",
    );
    expect(h.respuesta).toBe("Ampliar horario");
  });
  it("sin señales no hace falta cambiar el horario", () => {
    const h = get(evaluarDecisiones({ ...base, franjas: [franja(5, 11, 100), franja(5, 20, 100)] }), "horarios");
    expect(h.respuesta).toBe("No");
    expect(h.detalle).toContain("No hace falta abrir antes ni cerrar más tarde");
  });
});

describe("¿Subir precios?", () => {
  it("hay demanda y ningún cliente se fue por el precio: Sí, con la ocupación", () => {
    const p = get(evaluarDecisiones({ ...base, seFueronPorLugarFranjas: [...casos(2, 4, 18), ...casos(1, 5, 19)], seFueronPorPrecio: 0 }), "precios");
    expect(p.respuesta).toBe("Sí");
    expect(p.detalle).toContain("la ocupación es 47%");
    expect(p.detalle).toContain("no hay clientes que se hayan ido por el precio");
  });
  it("hay demanda pero clientes se fueron por el precio: con cuidado", () => {
    const p = get(evaluarDecisiones({ ...base, seFueronPorLugarFranjas: casos(3), seFueronPorPrecio: 1 }), "precios");
    expect(p.respuesta).toBe("Con cuidado");
    expect(p.detalle).toContain("1 cliente se fue por el precio");
  });
  it("sin demanda: No, con la ocupación", () => {
    const p = get(evaluarDecisiones(base), "precios");
    expect(p.respuesta).toBe("No");
    expect(p.detalle).toContain("la ocupación es 47%");
  });
  it("un profesional lleno muchos días: Sí, a ese profesional", () => {
    const p = get(
      evaluarDecisiones({
        ...base,
        profesionales: [
          { name: "Alan", used: 60, capacity: 100, daysWorked: 20, daysFull: 9 },
          { name: "Franco", used: 30, capacity: 100, daysWorked: 20, daysFull: 1 },
        ],
      }),
      "precios",
    );
    expect(p.respuesta).toBe("Sí, a Alan");
    expect(p.detalle).toContain("Alan tuvo la agenda llena 9 de 20 días");
    expect(p.detalle).toContain("Con el resto todavía no.");
  });
  it("con pocos días trabajados no se fía de la proporción de días llenos", () => {
    const p = get(evaluarDecisiones({ ...base, profesionales: [{ name: "Alan", used: 60, capacity: 100, daysWorked: 4, daysFull: 4 }] }), "precios");
    expect(p.respuesta).toBe("No");
  });
});
