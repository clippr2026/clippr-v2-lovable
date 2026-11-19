import { describe, expect, it } from "vitest";
import { ocupacionLocal, OCUPACION_EJEMPLO } from "./ocupacion";

describe("ocupación agendada y atendida", () => {
  it("el ejemplo de la ayuda: 8 h disponibles, 4 agendadas y 8 atendidas → 50% y 100%", () => {
    const r = ocupacionLocal([{ disponible: 480, agendado: 240, atendido: 480 }]);
    expect(r.agendada).toBe(50);
    expect(r.atendida).toBe(100);
    expect(OCUPACION_EJEMPLO).toContain("50% agendada y 100% atendida");
  });
  it("atender de más no pasa de 100%", () => {
    expect(ocupacionLocal([{ disponible: 480, agendado: 600, atendido: 900 }])).toMatchObject({ agendada: 100, atendida: 100 });
  });
  it("el tope se aplica por profesional antes de sumar: lo que sobra de uno no tapa los huecos de otro", () => {
    const r = ocupacionLocal([
      { disponible: 480, agendado: 480, atendido: 960 }, // atendió el doble
      { disponible: 480, agendado: 0, atendido: 0 }, // vacío
    ]);
    expect(r.atendida).toBe(50); // sin tope por profesional daría 100%
    expect(r.agendada).toBe(50);
  });
  it("sin horario disponible no hay porcentaje", () => {
    expect(ocupacionLocal([{ disponible: 0, agendado: 30, atendido: 30 }])).toMatchObject({ agendada: null, atendida: null });
    expect(ocupacionLocal([])).toMatchObject({ agendada: null, atendida: null });
  });
  it("lo atendido sin turno cuenta aunque no haya reservas", () => {
    expect(ocupacionLocal([{ disponible: 480, agendado: 0, atendido: 240 }])).toMatchObject({ agendada: 0, atendida: 50 });
  });
});
