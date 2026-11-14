// Validación de los datos de contacto de quien reserva. Evita datos de relleno ("." o "H"), que después se
// cruzan entre clientes distintos (por ejemplo al contar faltas para pedir seña).

/** Deja solo lo que puede llevar un teléfono: números, espacios, + ( ) y guiones. */
export function limpiarTelefono(valor: string): string {
  return valor.replace(/[^0-9+()\s-]/g, "");
}

/** Teléfono válido: entre 8 y 15 números (sin contar espacios, + ni guiones). */
export function telefonoValido(valor: string): boolean {
  const digitos = valor.replace(/\D/g, "");
  return digitos.length >= 8 && digitos.length <= 15;
}

/** Correo válido: algo@dominio.ext, sin espacios. */
export function emailValido(valor: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor.trim());
}
