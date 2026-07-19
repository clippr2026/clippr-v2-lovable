import { supabase } from "@/integrations/supabase/client";

// ─── HISTORIAL DE COBROS / CANCELACIONES ────────────────────────────────────
// Eventos persistidos en appointments.cobro_events (JSONB array en Supabase).
// localStorage actúa únicamente como caché para la sesión actual.
// NUNCA se recalcula desde payment_status ni desde el modo de cobro actual.
//
// Módulo compartido: antes vivía solo en professionals.tsx, pero cancelAppointment
// (use-agenda-data.ts) necesita escribir acá para que "Cancelado por X" se vea
// también en la Agenda web/Mi Agenda web, no solo en el flujo de Mi Agenda mobile
// que originalmente lo escribía.

const HISTORIAL_LS_KEY = "clippr_cobros_historial_v2";

export type HistorialEvento = {
  ts: string;        // ISO timestamp completo — fuente de verdad
  time: string;      // HH:MM — display
  // Nombre visible de la persona (nunca username/email crudo). Cuando
  // role === "cliente", este campo se ignora en el display — "Cancelado
  // por cliente" no debe mostrar el nombre del cliente.
  user: string;
  role: "profesional" | "recepcion" | "cliente" | "sistema";
  action: "Envió a caja" | "Cobró" | "Canceló" | "Anuló cobro" | "Reembolsó" | "Rechazó";
};

// Texto de atribución ("Cancelado por Alan" / "Cancelado por cliente"),
// centralizado acá para que Agenda web, Mi Agenda y el modal de cancelados
// lo rendericen exactamente igual — nunca el nombre del cliente cuando fue
// él quien canceló, siempre el nombre visible en cualquier otro caso.
export function attributionLabel(ev: Pick<HistorialEvento, "user" | "role">): string {
  return ev.role === "cliente" ? "cliente" : ev.user;
}

// ── Lectura: Supabase primero, localStorage como cache ────────────────────────
function readHistorialLS(appointmentId: string): HistorialEvento[] {
  if (typeof window === "undefined") return [];
  try {
    const all = JSON.parse(window.localStorage.getItem(HISTORIAL_LS_KEY) || "{}") as Record<string, HistorialEvento[]>;
    return all[appointmentId] ?? [];
  } catch { return []; }
}

function writeHistorialLS(appointmentId: string, events: HistorialEvento[]) {
  if (typeof window === "undefined") return;
  try {
    const all = JSON.parse(window.localStorage.getItem(HISTORIAL_LS_KEY) || "{}") as Record<string, HistorialEvento[]>;
    all[appointmentId] = events;
    window.localStorage.setItem(HISTORIAL_LS_KEY, JSON.stringify(all));
  } catch { /* silently fail */ }
}

// Lee los eventos del turno. Cache local tiene prioridad en misma sesión.
export function readHistorialCobro(appointmentId: string): HistorialEvento[] {
  return readHistorialLS(appointmentId).sort((a, b) => {
    const at = a.ts ? new Date(a.ts).getTime() : 0;
    const bt = b.ts ? new Date(b.ts).getTime() : 0;
    return at - bt;
  });
}

// Agrega un evento — escribe a localStorage inmediatamente y persiste a Supabase.
// NUNCA modifica eventos anteriores.
export async function appendHistorialCobro(
  appointmentId: string,
  evento: Omit<HistorialEvento, "ts">
) {
  const full: HistorialEvento = { ...evento, ts: new Date().toISOString() };

  // 1. Leer estado local actual
  const prev = readHistorialLS(appointmentId);

  // Deduplicar: no agregar si ya existe el mismo (action + time iguales)
  if (prev.some(e => e.time === full.time && e.action === full.action)) return;

  const next = [...prev, full];

  // 2. Escribir a localStorage de inmediato (UI reactiva sin esperar red)
  writeHistorialLS(appointmentId, next);

  // 3. Persistir a Supabase (cobro_events es columna JSONB en appointments)
  try {
    await supabase
      .from("appointments")
      .update({ cobro_events: next } as Record<string, unknown>)
      .eq("id", appointmentId);
  } catch {
    // Columna puede no existir aún — el localStorage tiene los datos seguros
  }
}

// Cuando se carga la vista, sincronizar Supabase → localStorage para cada turno
// Esto cubre el caso de que otro dispositivo haya escrito eventos
export async function syncHistorialFromDB(appointmentIds: string[]): Promise<void> {
  if (!appointmentIds.length) return;
  try {
    const { data } = await supabase
      .from("appointments")
      .select("id, cobro_events")
      .in("id", appointmentIds);

    for (const row of data ?? []) {
      const dbEvents = row.cobro_events as HistorialEvento[] | null;
      if (!dbEvents?.length) continue;
      const local = readHistorialLS(row.id);
      // Merge: usar el que tenga más eventos
      if (dbEvents.length > local.length) {
        writeHistorialLS(row.id, dbEvents);
      }
    }
  } catch { /* red no disponible — local sigue siendo válido */ }
}
