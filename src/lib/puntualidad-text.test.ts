import { describe, expect, it } from "vitest";
import { puntualidadMessage } from "./puntualidad-text";

describe("puntualidadMessage: avisos de la base con la palabra vieja", () => {
  it("traduce el aviso que bloquea el cierre de caja", () => {
    expect(puntualidadMessage("No se puede cerrar: presentismo sin confirmar para Melany, Pipo")).toBe(
      "No se puede cerrar: puntualidad sin confirmar para Melany, Pipo",
    );
  });

  it("traduce el aviso del inicio del sistema y los de autorización", () => {
    expect(
      puntualidadMessage("El sistema de presentismo aplica desde el 2026-10-29, no se puede confirmar una jornada anterior."),
    ).toBe("El sistema de puntualidad aplica desde el 2026-10-29, no se puede confirmar una jornada anterior.");
    expect(puntualidadMessage("No autorizado para confirmar presentismo en este negocio")).toBe(
      "No autorizado para confirmar puntualidad en este negocio",
    );
    expect(puntualidadMessage("Un profesional no puede confirmar su propio presentismo")).toBe(
      "Un profesional no puede confirmar su propia puntualidad",
    );
  });

  it("no toca mensajes sin esa palabra y tolera vacíos", () => {
    expect(puntualidadMessage("No se pudo guardar el cierre.")).toBe("No se pudo guardar el cierre.");
    expect(puntualidadMessage(undefined)).toBe("");
    expect(puntualidadMessage(null)).toBe("");
  });
});
