import { describe, expect, it } from "vitest";
import { CLIPPI_TEMAS, normalizar, responderClippi } from "./clippi";
import { CLIPPI_FRASES } from "./clippi-frases";

const todo = () => true;
const tema = (q: string) => {
  const r = responderClippi(q, todo);
  return r.tema?.id ?? `sugiere:${r.sugerencias?.map((s) => s.id).join(",") ?? ""}`;
};

// Preguntas escritas como las haría una persona, distintas de las guardadas.
const CASOS: [string, string][] = [
  ["Algo anda mal", "problema"],
  ["hola!", "hola"],
  ["muchas gracias", "gracias"],
  ["no me deja cobrar", "no-puedo-cobrar"],
  ["¿Cómo muevo un turno a otro día?", "turno-mover"],
  ["Mañana no abro, qué hago?", "dia-cerrado"],
  ["como cargo un gasto", "gasto"],
  ["Entró un barbero nuevo, cómo lo agrego?", "equipo-agregar"],
  ["como oculto la caja a un empleado, que no vean la caja", "equipo-permisos"],
  ["Quiero subir el precio del corte", "precio"],
  ["¿Cómo cambio la foto de portada?", "portada"],
  ["¿Dónde está el link para mis clientes?", "link"],
  ["quiero cancelar el turno de un cliente", "turno-cancelar"],
  ["como cierro caja", "cerrar-caja"],
  ["cerré la caja sin querer, puedo reabrirla?", "reabrir"],
  ["cobré mal un monto", "corregir-cobro"],
  ["necesito anular una venta", "anular"],
  ["como le pago las comisiones a los barberos", "liquidar"],
  ["un barbero me pide un adelanto", "adelanto"],
  ["me olvidé la contraseña", "clave"],
  ["no me llegan las notificaciones", "avisos"],
  ["como pongo la app en modo oscuro", "modo-claro"],
  ["quiero pedir señas", "senas"],
  ["como hago una promo", "promo"],
  ["quien fichó hoy", "asistencia"],
  ["quiero ver clientes que dejaron de venir", "cliente-recuperar"],
  ["agregar otra sucursal", "sucursal"],
  ["quiero hablar con una persona", "persona"],
  ["la caja no cierra", "cerrar-caja"],
  ["como borro un turno", "turno-cancelar"],
  ["quiero agregar un cliente", "cliente-crear"],
  ["no aparece un barbero en la web", "equipo-online"],
  ["el cliente no vino", "turno-no-asistio"],
  ["quiero cerrar el local el lunes", "dia-cerrado"],
  ["cuanto sale clippr", "plan"],
  ["como saco el qr", "asistencia"],
  ["un cliente quiere pagar mitad efectivo mitad transferencia", "venta"],
  ["hola como estas", "hola"],
];

describe("responderClippi", () => {
  it("reconoce cada tema por su título y por sus preguntas", () => {
    for (const t of CLIPPI_TEMAS) {
      for (const q of [t.titulo, ...t.preguntas]) expect([q, tema(q)]).toEqual([q, t.id]);
    }
  });
  it("entiende preguntas escritas de otra forma", () => {
    expect(CASOS.map(([q]) => [q, tema(q)])).toEqual(CASOS);
  });
  it("conoce al menos 150 respuestas y 1000 formas de preguntar", () => {
    const frases = CLIPPI_TEMAS.flatMap((t) => t.preguntas);
    expect(CLIPPI_TEMAS.length).toBeGreaterThanOrEqual(150);
    expect(frases.length).toBeGreaterThanOrEqual(1000);
  });
  it("ninguna pregunta está en dos temas y no hay frases para temas inexistentes", () => {
    const todas = CLIPPI_TEMAS.flatMap((t) => [...new Set([t.titulo, ...t.preguntas].map(normalizar))]);
    expect(todas.filter((q, i) => todas.indexOf(q) !== i)).toEqual([]);
    const ids = new Set(CLIPPI_TEMAS.map((t) => t.id));
    expect(Object.keys(CLIPPI_FRASES).filter((id) => !ids.has(id))).toEqual([]);
  });
  it("tolera errores de tipeo", () => {
    expect(tema("como cancelo un turmo")).toBe("turno-cancelar");
    expect(tema("quiero anluar una venta")).toBe("anular");
  });
  it("no repite identificadores", () => {
    expect(new Set(CLIPPI_TEMAS.map((t) => t.id)).size).toBe(CLIPPI_TEMAS.length);
  });
  it("no lleva a pantallas sin permiso", () => {
    const r = responderClippi("como cierro la caja", (p) => p !== "caja");
    expect(r.tema).toBeUndefined();
    expect(r.texto).toContain("no tiene acceso");
  });
  it("avisa cuando no sabe", () => {
    const r = responderClippi("xyz qwerty", todo);
    expect(r.tema).toBeUndefined();
    expect(r.sugerencias).toBeUndefined();
  });
});
