import { describe, expect, it } from "vitest";
import { contrastRatio, contrastText, legibleAccent, publicButtonStyle } from "./public-button";

// Colores de acento de todo tipo: oscuros, claros, saturados y neutros.
const ACCENTS = [
  "#000000", "#0b0818", "#1e1b4b", "#312e81", "#4c1d95", "#7c3aed", "#a78bfa", "#c4b5fd", "#ffffff",
  "#111827", "#6b7280", "#d1d5db", "#dc2626", "#f97316", "#facc15", "#fde047", "#22c55e", "#86efac",
  "#0ea5e9", "#7dd3fc", "#ec4899", "#f9a8d4", "#78350f", "#d6b66a", "#fef3c7",
];

describe("public-button: el texto siempre se lee, con cualquier color", () => {
  it("contrastText elige la letra con mejor contraste sobre cualquier fondo", () => {
    for (const bg of ACCENTS) {
      const t = contrastText(bg);
      expect(contrastRatio(t, bg)!).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("el botón nunca deja letras que no se lean sobre su color (aunque el negocio elija mal el texto)", () => {
    for (const bg of ACCENTS) {
      for (const choice of ["#ffffff", "#000000", "#111827"]) {
        const style = publicButtonStyle(bg, choice);
        expect(contrastRatio(String(style.color), bg)!).toBeGreaterThanOrEqual(2);
        expect(style.WebkitTextFillColor).toBe(style.color);
      }
    }
  });

  it("un violeta medio con letra blanca queda en blanco (no pasa a letra oscura)", () => {
    expect(publicButtonStyle("#a78bfa", "#ffffff").color).toBe("#ffffff");
    expect(publicButtonStyle("#7c3aed", "#ffffff").color).toBe("#ffffff");
  });

  it("blanco sobre un color muy claro (amarillo, pastel) pasa a letra oscura; oscuro sobre oscuro pasa a blanco", () => {
    expect(publicButtonStyle("#facc15", "#ffffff").color).toBe("#0b0818");
    expect(publicButtonStyle("#fde047", "#ffffff").color).toBe("#0b0818");
    expect(publicButtonStyle("#1e1b4b", "#111827").color).toBe("#ffffff");
    expect(publicButtonStyle("#000000", "#000000").color).toBe("#ffffff");
  });

  it("si el texto elegido ya se lee, se respeta", () => {
    expect(publicButtonStyle("#7c3aed", "#ffffff").color).toBe("#ffffff");
    expect(publicButtonStyle("#fde047", "#111827").color).toBe("#111827");
  });

  it("legibleAccent: el acento usado como texto cumple contraste 4.5 en tema claro y oscuro", () => {
    for (const a of ACCENTS) {
      expect(contrastRatio(legibleAccent(a, true), "#ffffff")!).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(legibleAccent(a, false), "#0b0818")!).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("legibleAccent no toca un color que ya se lee, y tolera valores que no son hex", () => {
    expect(legibleAccent("#7c3aed", true)).toBe("#7c3aed");
    expect(legibleAccent("var(--c-accent)", true)).toBe("var(--c-accent)");
  });
});

import { accentFill } from "./public-button";
describe("accentFill", () => {
  it("el relleno liso también garantiza letra legible con cualquier color", () => {
    for (const bg of ACCENTS) {
      for (const choice of ["#ffffff", "#000000"]) {
        const st = accentFill(bg, choice);
        expect(contrastRatio(String(st.color), bg)!).toBeGreaterThanOrEqual(2);
        expect(st.WebkitTextFillColor).toBe(st.color);
      }
    }
  });
});
