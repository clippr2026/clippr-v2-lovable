import { describe, expect, it } from "vitest";
import { usaDisenoOscuro } from "./diseno-oscuro";

describe("usaDisenoOscuro", () => {
  it("se aplica en la app de gestión", () => {
    for (const ruta of ["/agenda", "/cash-register", "/clients", "/professionals", "/advisor", "/settings", "/clippr"]) {
      expect(usaDisenoOscuro(ruta), ruta).toBe(true);
    }
  });
  it("no toca Inicio ni las páginas públicas y de ingreso", () => {
    for (const ruta of ["/", "/dashboard", "/negocio/auro", "/reservar/auro", "/login", "/auro-stylo", "/bolsa-de-trabajo"]) {
      expect(usaDisenoOscuro(ruta), ruta).toBe(false);
    }
  });
});
