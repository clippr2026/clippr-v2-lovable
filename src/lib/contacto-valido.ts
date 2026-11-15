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
  return valor.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor.trim());
}

/** Nombre o apellido real: de 2 a 40 caracteres, con al menos 2 letras y sin números ni símbolos raros. */
export function nombreValido(valor: string): boolean {
  const v = valor.trim();
  return v.length >= 2 && v.length <= 40 && /^[\p{L}][\p{L}\s'.-]*$/u.test(v) && (v.match(/\p{L}/gu)?.length ?? 0) >= 2;
}

/**
 * Link de WhatsApp para un teléfono cargado a mano. WhatsApp necesita el código de país: a los números argentinos
 * sin código (10 dígitos, con 0 o 9 adelante) se les agrega 549. Devuelve null si no hay un número usable.
 */
export function whatsappHref(telefono: string | null | undefined): string | null {
  const crudo = (telefono ?? "").trim();
  let d = crudo.replace(/\D/g, "");
  if (d.length < 8) return null;
  if (crudo.startsWith("+")) {
    // Con código de país explícito: solo se completa el 9 de los celulares argentinos (+54 11… → 54 9 11…).
    if (d.startsWith("54") && !d.startsWith("549")) d = "549" + d.slice(2);
    return `https://wa.me/${d}`;
  }
  d = d.replace(/^0+/, "");
  if (d.startsWith("549") && d.length >= 12) return `https://wa.me/${d}`;
  if (d.startsWith("54") && d.length >= 12) return `https://wa.me/549${d.slice(2)}`;
  if (d.startsWith("9") && d.length === 11) return `https://wa.me/54${d}`;
  if (d.length === 10) return `https://wa.me/549${d}`;
  return `https://wa.me/${d}`;
}
