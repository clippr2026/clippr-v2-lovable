import { supabase } from "@/integrations/supabase/client";
import {
  DAY_KEYS,
  DEFAULT_TIMEZONE,
  normalizeSchedule,
  parseTimeStrict,
  zonedTimeToInstant,
} from "@/lib/availability";

// Ventana [00:00, 24:00) del día calendario `date` (YYYY-MM-DD) en hora de
// Buenos Aires.
export function dayWindowBA(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y, (m ?? 1) - 1, d ?? 1);
  const start = zonedTimeToInstant(day, 0, DEFAULT_TIMEZONE);
  return { day, start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function horaBA(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { timeZone: DEFAULT_TIMEZONE, hour: "2-digit", minute: "2-digit" });
}

// Cierre del local ese día de la semana — hora de salida que se sugiere (editable).
export async function fetchBusinessClosingTime(businessId: string, date: string): Promise<string> {
  const { data } = await supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle();
  const sched = normalizeSchedule((data?.schedule ?? {}) as Record<string, unknown>);
  const closing = sched[DAY_KEYS[dayWindowBA(date).day.getDay()]]?.end;
  return closing && parseTimeStrict(closing) !== null ? closing : "20:00";
}

// Guarda la salida de una jornada que quedó abierta, marcada como cargada al
// cerrar la caja y con quién la cargó (nunca como una fichada del profesional).
export async function saveSessionExit(args: {
  sessionId: string;
  clockInAt: string;
  date: string;
  hhmm: string;
  editedBy: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const minutes = parseTimeStrict(args.hhmm);
  if (minutes === null) return { ok: false, error: "Ingresá una hora de salida válida" };
  const out = zonedTimeToInstant(dayWindowBA(args.date).day, minutes, DEFAULT_TIMEZONE);
  if (out.getTime() <= new Date(args.clockInAt).getTime()) {
    return { ok: false, error: `La salida tiene que ser posterior a la entrada (${horaBA(args.clockInAt)}).` };
  }
  const { error } = await supabase
    .from("work_sessions" as any)
    .update({
      clock_out_at: out.toISOString(),
      edited_by: args.editedBy,
      edited_at: new Date().toISOString(),
      edit_reason: "Salida cargada al cerrar la caja",
    })
    .eq("id", args.sessionId);
  if (error) return { ok: false, error: "No se pudo guardar la salida: " + error.message };
  return { ok: true };
}

// Entrada cargada a mano (ej. "Editar" en Revisar cierre, sin fichaje real): no
// existe la jornada, así que se crea ya con su salida. Queda marcada como
// manual y con quién la cargó.
export async function saveManualSession(args: {
  businessId: string;
  branchId: string;
  employeeId: string;
  clockInAt: string;
  date: string;
  hhmm: string;
  editedBy: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const minutes = parseTimeStrict(args.hhmm);
  if (minutes === null) return { ok: false, error: "Ingresá una hora de salida válida" };
  const out = zonedTimeToInstant(dayWindowBA(args.date).day, minutes, DEFAULT_TIMEZONE);
  if (out.getTime() <= new Date(args.clockInAt).getTime()) {
    return { ok: false, error: `La salida tiene que ser posterior a la entrada (${horaBA(args.clockInAt)}).` };
  }
  const now = new Date().toISOString();
  const { error } = await supabase.from("work_sessions" as any).insert({
    business_id: args.businessId,
    branch_id: args.branchId,
    employee_id: args.employeeId,
    clock_in_at: args.clockInAt,
    clock_out_at: out.toISOString(),
    source: "manual",
    edited_by: args.editedBy,
    edited_at: now,
    edit_reason: "Entrada y salida cargadas al cerrar la caja",
  });
  if (error) return { ok: false, error: "No se pudo guardar la salida: " + error.message };
  return { ok: true };
}
