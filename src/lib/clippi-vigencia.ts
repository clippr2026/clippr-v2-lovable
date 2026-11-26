// Cuánto dura la conversación guardada en el dispositivo, contado desde el último mensaje:
// · hablando solo con Clippi: 1 hora;
// · esperando que conteste un asesor: no se borra;
// · cuando el asesor contestó y nadie volvió a escribir: 12 horas, y se da por cerrada.

const HORA = 60 * 60 * 1000;
export const DURA_CLIPPI_MS = HORA;
export const DURA_ASESOR_MS = 12 * HORA;

export type ChatGuardado<M> = { fecha: number; mensajes: M[]; esperando?: boolean };

export function chatVigente(chat: ChatGuardado<{ de: string }>, ahora: number): boolean {
  if (chat.esperando) return true;
  const dura = chat.mensajes.some((m) => m.de === "asesor") ? DURA_ASESOR_MS : DURA_CLIPPI_MS;
  return ahora - chat.fecha < dura;
}

/**
 * Si en el chat se muestra la consulta con el asesor. Una ya contestada deja de mostrarse cuando
 * su respuesta ya no está en la conversación (venció o se borró).
 */
export function consultaVisible(
  consulta: { estado: string; sin_leer: number } | null,
  mensajes: { de: string }[],
): boolean {
  if (!consulta || consulta.estado === "cerrada") return false;
  return consulta.estado === "abierta" || consulta.sin_leer > 0 || mensajes.some((m) => m.de === "asesor");
}

/**
 * Con una consulta sin contestar: lo que dice Clippi cuando no tiene una respuesta propia (en vez
 * de volver a ofrecer un asesor). `null` si puede contestar.
 */
export function avisoEnEspera(
  r: { tema?: unknown; sugerencias?: unknown; derivar?: string },
  enviado: boolean,
): string | null {
  const sabe = r.derivar !== "asesor" && Boolean(r.tema || r.sugerencias);
  if (sabe) return null;
  return enviado ? "Se lo sumé a tu consulta. El asesor te responde por este chat." : "No pude enviar el mensaje al asesor. Probá de nuevo.";
}
