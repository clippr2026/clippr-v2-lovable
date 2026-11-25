/** Nombre de pila para saludar. Vacío si la cuenta no tiene un nombre cargado (solo el correo o un genérico). */
export function nombreDePila(completo?: string | null, correo?: string | null): string {
  const limpio = (completo ?? "").trim();
  if (!limpio || limpio === "Usuario" || limpio === correo?.split("@")[0]) return "";
  const primero = limpio.split(/\s+/)[0];
  return /^\p{L}{2,20}$/u.test(primero) ? primero[0].toUpperCase() + primero.slice(1) : "";
}

export const saludar = (texto: string, nombre: string) => (nombre ? texto.replace(/^¡Hola!/, `¡Hola ${nombre}!`) : texto);
