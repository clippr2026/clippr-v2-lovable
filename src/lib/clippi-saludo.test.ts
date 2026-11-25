import { describe, expect, it } from "vitest";
import { responderClippi } from "./clippi";
import { nombreDePila, saludar } from "./clippi-saludo";

describe("saludo de Clippi", () => {
  it("saluda por el nombre de pila", () => {
    expect(nombreDePila("alan Pérez", "x@correo.com")).toBe("Alan");
    expect(saludar(responderClippi("hola", () => true).texto, "Alan")).toMatch(/^¡Hola Alan! Soy Clippi/);
  });

  it("sin un nombre cargado saluda sin nombre", () => {
    expect(nombreDePila("pepito", "pepito@correo.com")).toBe("");
    expect(nombreDePila("Usuario", null)).toBe("");
    expect(nombreDePila("local123", "x@correo.com")).toBe("");
    expect(saludar("¡Hola! Soy Clippi.", "")).toBe("¡Hola! Soy Clippi.");
  });

  it("muestra en qué puede ayudar", () => {
    const { texto } = responderClippi("buenas", () => true);
    for (const tema of ["Agenda", "Caja", "Clientes", "Equipo", "página de reservas"]) expect(texto).toContain(tema);
  });
});
