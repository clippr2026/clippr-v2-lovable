import { supabase } from "@/integrations/supabase/client";

// "Registrar su jornada (inicio y cierre)" de una recepcionista — opcional y
// apagado por defecto (Equipo → Accesos). Vive en business_settings.schedule
// ._jornadaRecepcion como { [email en minúscula]: true }: la clave es el mail
// del acceso porque existe desde que se invita a la persona, antes de que
// tenga usuario. Solo guarda el horario de la recepcionista (work_sessions a
// nombre de su usuario): no bloquea ni habilita nada para nadie más y no
// genera ningún descuento.
const KEY = "_jornadaRecepcion";

export function jornadaEmailKey(email: string | null | undefined) {
  return String(email ?? "").trim().toLowerCase();
}

export async function getJornadaRecepcionMap(businessId: string): Promise<Record<string, boolean>> {
  const { data } = await supabase
    .from("business_settings")
    .select("schedule")
    .eq("business_id", businessId)
    .maybeSingle();
  const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
  return ((schedule[KEY] ?? {}) as Record<string, boolean>) || {};
}

export async function setJornadaRecepcion(businessId: string, email: string, enabled: boolean): Promise<void> {
  const key = jornadaEmailKey(email);
  if (!key) return;
  const { data: row } = await supabase
    .from("business_settings")
    .select("schedule")
    .eq("business_id", businessId)
    .maybeSingle();
  const schedule = (row?.schedule ?? {}) as Record<string, unknown>;
  const map = { ...((schedule[KEY] ?? {}) as Record<string, boolean>) };
  if (enabled) map[key] = true;
  else delete map[key];
  const { error } = await supabase
    .from("business_settings")
    .upsert({ business_id: businessId, schedule: { ...schedule, [KEY]: map } }, { onConflict: "business_id" });
  if (error) throw error;
}
