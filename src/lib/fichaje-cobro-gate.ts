import { supabase } from "@/integrations/supabase/client";
import { getScheduledProfessionalsForDate } from "@/lib/presentismo";

function todayKey(date = new Date()) {
  return date.toLocaleDateString("sv-SE");
}

// Un profesional programado para hoy no puede cobrar servicios hasta que
// ficha su entrada — el bloqueo vale para todos: él mismo, el dueño y la
// recepción cuando cobran en su nombre. Si no está programado hoy (o la
// consulta falla) no se bloquea. Tampoco se exige al administrador general ni
// al dueño cuando además atienden como barberos: no ficha su propia jornada: nunca se frena una venta por un dato que no
// se pudo confirmar.
async function isAdminGeneralBarber(businessId: string, employeeId: string): Promise<boolean> {
  const { data: tm } = await supabase
    .from("team_members")
    .select("id")
    .eq("business_id", businessId)
    .eq("professional_id", employeeId)
    .in("role", ["admin_general", "owner"])
    .limit(1)
    .maybeSingle();
  if (tm) return true;
  const { data: prof } = await supabase
    .from("profiles")
    .select("id")
    .eq("business_id", businessId)
    .eq("employee_id", employeeId)
    .in("role", ["admin_general", "owner"])
    .limit(1)
    .maybeSingle();
  return Boolean(prof);
}

export async function assertProfessionalClockedIn(
  businessId: string,
  branchId: string | null,
  employeeId: string,
): Promise<void> {
  if (await isAdminGeneralBarber(businessId, employeeId)) return;

  const today = todayKey();
  const dayStart = new Date(`${today}T00:00:00`).toISOString();
  const { data: session } = await supabase
    .from("work_sessions" as any)
    .select("id")
    .eq("employee_id", employeeId)
    .gte("clock_in_at", dayStart)
    .limit(1)
    .maybeSingle();
  if (session) return;

  if (!branchId) return;
  let scheduled = false;
  try {
    const list = await getScheduledProfessionalsForDate(businessId, branchId, today);
    scheduled = list.some((p) => p.employeeId === employeeId);
  } catch {
    return;
  }
  if (!scheduled) return;

  const { data: emp } = await supabase.from("employees").select("full_name").eq("id", employeeId).maybeSingle();
  const name = (emp as { full_name?: string | null } | null)?.full_name ?? "El profesional";
  throw new Error(`${name} todavía no fichó su jornada. Tiene que fichar la entrada para poder cobrar sus servicios.`);
}
