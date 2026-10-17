// Search params de la ruta /cash-register (?appointmentId=...&clientName=...
// etc., con los que Agenda/Mi Agenda enlazan a "Cobrar turno") — extraído
// de cash-register.tsx para poder testearlo sin importar toda la página.

export type CashRegisterSearch = {
  depositAppointmentId?: string;
  depositAmount?: string;
  clientName?: string;
  serviceName?: string;
  employeeId?: string;
  appointmentId?: string;
  finalAmount?: string;
  depositPaid?: string;
  totalPrice?: string;
  chargeStep?: string;
  // Fecha (YYYY-MM-DD) de una jornada pendiente de cierre — llega desde el
  // aviso "Caja vencida" de Inicio ("Ver cierre pendiente") para abrir
  // directo la pestaña Cierres con esa fecha ya seleccionada y su vista
  // previa calculada, sin que el usuario tenga que buscarla a mano.
  pendingDate?: string;
};

// Una URL como .../cash-register?appointmentId=null&clientName=null&...
// (los literales "null"/"undefined" como texto, no el valor JS) llegan acá
// como string truthy — `"null" ?? null` no los limpia porque `??` solo
// actúa sobre null/undefined reales. Sin este filtro, la pestaña arranca
// en "nueva" y se arma un pendingCharge de mentira (cliente "null",
// servicio "null", monto NaN) salteando directo al paso 4 en vez de
// mostrar Resumen.
export function cleanSearchParam(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return undefined;
  return trimmed;
}

// Objeto de búsqueda completamente vacío — usado para "limpiar la URL" al
// salir de una venta ligada a un turno (cobrada, cancelada, o al tocar
// "Nueva venta" de nuevo). Las 10 claves tienen que estar SIEMPRE
// presentes (aunque en undefined): TanStack Router narrowea el tipo de
// `search` contra las keys de validateSearch, un objeto parcial no
// compila.
export const EMPTY_CASH_REGISTER_SEARCH: Required<CashRegisterSearch> = {
  depositAppointmentId: undefined as unknown as string,
  depositAmount: undefined as unknown as string,
  clientName: undefined as unknown as string,
  serviceName: undefined as unknown as string,
  employeeId: undefined as unknown as string,
  appointmentId: undefined as unknown as string,
  finalAmount: undefined as unknown as string,
  depositPaid: undefined as unknown as string,
  totalPrice: undefined as unknown as string,
  chargeStep: undefined as unknown as string,
  pendingDate: undefined as unknown as string,
};

export type SearchPendingCharge = {
  id: string;
  client_name: string | null;
  service_name: string | null;
  service_price: number | null;
  employee_id: string | null;
  starts_at: string;
  notes: null;
  status: "confirmed";
};

// Causa raíz del bug "Nueva venta conserva el cliente/turno anterior": este
// turno "virtual" se arma PURAMENTE a partir de los query params de la URL
// (?appointmentId=...&clientName=...), nunca de un estado que se limpie
// solo al cambiar de pestaña — mientras esos params sigan en la URL, esta
// función sigue devolviendo el turno viejo en cada recálculo, así sea la
// Nueva venta número 10 de la sesión. El fix real vive en cash-register.tsx
// (clearChargeSearchParams, llamado en cada punto de salida de "nueva"),
// pero la garantía que importa — "sin appointmentId en la URL, no hay
// pendingCharge" — se prueba acá.
export function resolvePendingChargeFromSearch(
  search: CashRegisterSearch,
): SearchPendingCharge | null {
  if (!search.appointmentId) return null;

  const totalFromSearch = Number(search.finalAmount ?? search.totalPrice ?? 0);
  return {
    id: search.appointmentId,
    client_name: search.clientName ?? null,
    service_name: search.serviceName ?? null,
    service_price: Number.isFinite(totalFromSearch) && totalFromSearch > 0 ? totalFromSearch : null,
    employee_id: search.employeeId ?? null,
    starts_at: new Date().toISOString(),
    notes: null,
    status: "confirmed",
  };
}
