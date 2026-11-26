import { describe, expect, it } from "vitest";
import { avisoEnEspera, chatVigente, consultaVisible } from "./clippi-vigencia";
import { responderClippi } from "./clippi";

const H = 60 * 60 * 1000;
const clippi = [{ de: "yo" }, { de: "clippi" }];
const conAsesor = [...clippi, { de: "asesor" }];

describe("cuánto dura el chat de Clippi", () => {
  it("solo con Clippi dura una hora", () => {
    expect(chatVigente({ fecha: 0, mensajes: clippi }, H - 1)).toBe(true);
    expect(chatVigente({ fecha: 0, mensajes: clippi }, H)).toBe(false);
  });

  it("esperando al asesor no se borra", () => {
    expect(chatVigente({ fecha: 0, mensajes: clippi, esperando: true }, 500 * H)).toBe(true);
    // También si volvió a escribir después de una respuesta.
    expect(chatVigente({ fecha: 0, mensajes: conAsesor, esperando: true }, 500 * H)).toBe(true);
  });

  it("la respuesta del asesor queda 12 horas", () => {
    expect(chatVigente({ fecha: 0, mensajes: conAsesor }, 12 * H - 1)).toBe(true);
    expect(chatVigente({ fecha: 0, mensajes: conAsesor }, 12 * H)).toBe(false);
  });

  it("la consulta contestada y vencida deja de mostrarse", () => {
    expect(consultaVisible({ estado: "respondida", sin_leer: 0 }, [])).toBe(false);
    expect(consultaVisible({ estado: "respondida", sin_leer: 0 }, conAsesor)).toBe(true);
    expect(consultaVisible({ estado: "respondida", sin_leer: 1 }, [])).toBe(true);
    expect(consultaVisible({ estado: "abierta", sin_leer: 0 }, [])).toBe(true);
    expect(consultaVisible({ estado: "cerrada", sin_leer: 0 }, conAsesor)).toBe(false);
  });
});

describe("un solo chat mientras se espera al asesor", () => {
  const pregunta = (texto: string) => responderClippi(texto, () => true);

  it("Clippi sigue contestando lo que sabe", () => {
    expect(avisoEnEspera(pregunta("agendar un turno"), true)).toBeNull();
  });

  it("lo que no sabe queda sumado a la consulta", () => {
    expect(avisoEnEspera(pregunta("quiero hablar con alguien"), true)).toContain("Se lo sumé a tu consulta");
    expect(avisoEnEspera(pregunta("zzzz qwerty"), true)).toContain("Se lo sumé a tu consulta");
    expect(avisoEnEspera(pregunta("zzzz qwerty"), false)).toContain("No pude enviar");
  });
});
