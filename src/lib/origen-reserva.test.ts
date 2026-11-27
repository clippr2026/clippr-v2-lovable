import { describe, expect, it } from "vitest";
import { textoReservaCreada } from "./origen-reserva";

describe("textoReservaCreada", () => {
  it("distingue la reserva hecha desde la web", () => {
    expect(textoReservaCreada("public", "Reserva online")).toBe("Reserva creada online");
  });
  it("muestra quién la cargó en el local", () => {
    expect(textoReservaCreada("owner", "Alan")).toBe("Reserva creada por el local · Alan");
  });
  it("sin autor se toma como del local", () => {
    expect(textoReservaCreada(null, null)).toBe("Reserva creada por el local");
  });
});
