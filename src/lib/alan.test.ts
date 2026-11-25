import { describe, expect, it } from "vitest";
import { ALAN_TEMAS, responderAlan } from "./alan";

const todo = () => true;
const tema = (q: string) => responderAlan(q, todo).tema?.id;

describe("responderAlan", () => {
  it("reconoce cada atajo por su título", () => {
    for (const t of ALAN_TEMAS) expect(tema(t.titulo)).toBe(t.id);
  });
  it("entiende preguntas escritas, con o sin tildes", () => {
    expect(tema("¿Cómo agrego un TURNO?")).toBe("turno");
    expect(tema("quiero cerrar caja")).toBe("cierres");
    expect(tema("cuanto le tengo que pagar de comisión")).toBe("liquidaciones");
    expect(tema("revisar señas")).toBe("reservas");
  });
  it("no lleva a pantallas sin permiso", () => {
    const r = responderAlan("cobrar", (p) => p !== "caja");
    expect(r.tema).toBeUndefined();
    expect(r.texto).toContain("no tiene acceso");
  });
  it("avisa cuando no sabe", () => {
    expect(responderAlan("xyz", todo).tema).toBeUndefined();
  });
});
