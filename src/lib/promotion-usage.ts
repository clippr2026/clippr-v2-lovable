import { supabase } from "@/integrations/supabase/client";
import type { Promotion } from "@/lib/service-pricing";

// Único punto de escritura del contador de usos de una promoción
// (business_settings.schedule._promotions[].usageCount/usedByClient).
// Antes vivía inline solo en reservar/$slug.tsx (reserva pública); ahora
// también lo llama registerPayment() (Caja, cualquiera de sus puntos de
// entrada) — así "cuándo se consume un uso" queda en un solo lugar sin
// importar el canal. Best-effort (igual que el resto de los upserts de
// business_settings en esta app): si falla, no aborta el cobro/reserva ya
// confirmado, solo deja de reflejarse el contador.
export async function incrementPromotionUsage(
  businessId: string,
  promotionId: string,
  clientKeys: string[],
): Promise<void> {
  try {
    const { data: bsRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    const existingSchedule = (bsRow?.schedule ?? {}) as Record<string, unknown>;
    const existingPromotions = Array.isArray(existingSchedule._promotions)
      ? (existingSchedule._promotions as Promotion[])
      : [];
    const updatedPromotions = existingPromotions.map((p) => {
      if (p.id !== promotionId) return p;
      const nextUsedByClient = { ...p.usedByClient };
      for (const key of clientKeys) {
        nextUsedByClient[key] = (nextUsedByClient[key] ?? 0) + 1;
      }
      return { ...p, usageCount: p.usageCount + 1, usedByClient: nextUsedByClient };
    });
    await supabase
      .from("business_settings")
      .upsert(
        { business_id: businessId, schedule: { ...existingSchedule, _promotions: updatedPromotions } },
        { onConflict: "business_id" },
      );
  } catch (usageError) {
    console.warn("No se pudo actualizar el contador de usos de la promoción:", (usageError as Error).message);
  }
}
