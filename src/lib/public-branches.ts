import { supabase } from "@/integrations/supabase/client";

// Sucursales que NO se muestran en la página pública (turnos / reservar):
// siguen activas y funcionando adentro de la app, solo se ocultan para el
// público. Vive en business_settings.schedule._publicHiddenBranches, que la
// página pública ya lee (public_booking_settings), como _branding o
// _publicSiteStatus.
const KEY = "_publicHiddenBranches";

export function hiddenPublicBranchIds(schedule: unknown): string[] {
  const raw = (schedule as Record<string, unknown> | null | undefined)?.[KEY];
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

export async function getHiddenPublicBranchIds(businessId: string): Promise<string[]> {
  const { data } = await supabase
    .from("business_settings")
    .select("schedule")
    .eq("business_id", businessId)
    .maybeSingle();
  return hiddenPublicBranchIds(data?.schedule);
}

export async function setBranchPublicVisible(businessId: string, branchId: string, visible: boolean): Promise<void> {
  const { data: row } = await supabase
    .from("business_settings")
    .select("schedule")
    .eq("business_id", businessId)
    .maybeSingle();
  const schedule = (row?.schedule ?? {}) as Record<string, unknown>;
  const hidden = new Set(hiddenPublicBranchIds(schedule));
  if (visible) hidden.delete(branchId);
  else hidden.add(branchId);
  const { error } = await supabase
    .from("business_settings")
    .upsert({ business_id: businessId, schedule: { ...schedule, [KEY]: [...hidden] } }, { onConflict: "business_id" });
  if (error) throw error;
}
