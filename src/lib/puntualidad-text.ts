// "Puntualidad" es el nombre visible de lo que internamente (tablas, funciones
// SQL, variables) se sigue llamando "presentismo" — no se renombra nada de eso.
// Algunos avisos nacen en la base de datos con la palabra vieja (por ejemplo
// "No se puede cerrar: presentismo sin confirmar para ..."); como cambiarlos
// exige una migración, se traducen acá, justo antes de mostrarlos.
export function puntualidadMessage(message: string | null | undefined): string {
  if (!message) return "";
  return message
    .replace(/su propio presentismo/g, "su propia puntualidad")
    .replace(/presentismo sin confirmar/g, "puntualidad sin confirmar")
    .replace(/el presentismo pendiente/g, "la puntualidad pendiente")
    .replace(/presentismo/gi, (w) => (w[0] === "P" ? "Puntualidad" : "puntualidad"));
}
