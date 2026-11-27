// Quién creó un turno: el cliente desde la página web, o alguien del local.
const ROLES_ONLINE = new Set(["public", "online", "cliente", "client"]);

export function textoReservaCreada(rol: string | null | undefined, nombre: string | null | undefined): string {
  if (ROLES_ONLINE.has((rol ?? "").trim().toLowerCase())) return "Reserva creada online";
  const quien = (nombre ?? "").trim();
  // Los turnos que genera una recurrencia no guardan autor: son del local.
  return quien ? `Reserva creada por el local · ${quien}` : "Reserva creada por el local";
}
