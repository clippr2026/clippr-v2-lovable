import { describe, expect, it } from "vitest";
import { TAMANO_BURBUJA, dentroDePantalla, seArrastro, sobreBasurero } from "./clippi-burbuja";

describe("burbuja de Clippi", () => {
  it("un toque con el dedo apenas movido no cuenta como arrastre", () => {
    expect(seArrastro({ x: 100, y: 100 }, { x: 104, y: 103 })).toBe(false);
    expect(seArrastro({ x: 100, y: 100 }, { x: 130, y: 100 })).toBe(true);
  });

  it("no se puede sacar de la pantalla", () => {
    expect(dentroDePantalla({ x: -200, y: -50 }, 390, 800)).toEqual({ x: 8, y: 8 });
    expect(dentroDePantalla({ x: 900, y: 2000 }, 390, 800)).toEqual({ x: 390 - TAMANO_BURBUJA - 8, y: 800 - TAMANO_BURBUJA - 8 });
    expect(dentroDePantalla({ x: 120, y: 300 }, 390, 800)).toEqual({ x: 120, y: 300 });
  });

  it("se guarda solo si se suelta sobre el basurero", () => {
    const centro = { x: 195, y: 700 };
    expect(sobreBasurero({ x: 167, y: 672 }, centro)).toBe(true);
    expect(sobreBasurero({ x: 320, y: 672 }, centro)).toBe(false);
  });
});
