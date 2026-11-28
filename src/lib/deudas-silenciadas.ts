import { supabase } from "@/integrations/supabase/client";

// «No avisar más»: queda guardado para todo el local (tabla debt_notice_mutes), una fila por venta con saldo.
const tabla = () => (supabase as any).from("debt_notice_mutes");

export async function leerSilenciadas(businessId: string): Promise<Set<string>> {
  const { data, error } = await tabla()
    .select("payment_id")
    .eq("business_id", businessId)
    .order("muted_at", { ascending: false })
    .limit(1000);
  // Si no se puede leer, se avisa de más antes que ocultar una deuda.
  if (error) return new Set();
  return new Set(((data ?? []) as { payment_id: string }[]).map((f) => f.payment_id));
}

export async function silenciarDeuda(businessId: string, ids: string[], silenciar = true): Promise<void> {
  const { error } = silenciar
    ? await tabla().upsert(
        ids.map((payment_id) => ({ payment_id, business_id: businessId })),
        { onConflict: "payment_id", ignoreDuplicates: true },
      )
    : await tabla().delete().eq("business_id", businessId).in("payment_id", ids);
  if (error) throw new Error(error.message);
}
