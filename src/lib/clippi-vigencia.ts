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

/** Lo que dice Clippi al derivar la consulta. */
export const DERIVADO = "Listo, le pasé tu consulta a un asesor.";

/**
 * Si el chat está derivado a un asesor: la consulta sigue sin cerrar y la conversación lo muestra
 * (dice que se derivó o ya hay una respuesta). Sin conversación guardada, alcanza con que esté sin
 * contestar. Una consulta que el chat no muestra no calla a Clippi.
 */
export function consultaVisible(
  consulta: { estado: string; sin_leer: number } | null,
  mensajes: { de: string; texto?: string }[],
): boolean {
  if (!consulta || consulta.estado === "cerrada") return false;
  if (consulta.sin_leer > 0) return true;
  if (mensajes.length === 0) return consulta.estado === "abierta";
  return mensajes.some((m) => m.de === "asesor" || (m.de === "clippi" && m.texto === DERIVADO));
}
