import { supabase } from "@/integrations/supabase/client";

export const NOMBRE_CLIENTE_GENERICO = "Sin agendar";

/**
 * Ficha genérica del local para ventas de personas que no se agendaron (no pide nombre ni teléfono).
 * Si todavía no existe, la crea. Sus ventas cuentan en la caja, pero la ficha no aparece en Clientes.
 */
export async function obtenerClienteGenerico(businessId: string, branchId?: string | null): Promise<string> {
  const sb = supabase as any;
  const { data: existente, error } = await sb
    .from("clients")
    .select("id")
    .eq("business_id", businessId)
    .eq("es_generico", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("No se pudo buscar la ficha de Sin agendar: " + error.message);
  if (existente?.id) return existente.id as string;
  const { data: creada, error: errCrear } = await sb
    .from("clients")
    .insert({ business_id: businessId, branch_id: branchId ?? null, full_name: NOMBRE_CLIENTE_GENERICO, es_generico: true })
    .select("id")
    .single();
  if (errCrear) throw new Error("No se pudo crear la ficha de Sin agendar: " + errCrear.message);
  return creada.id as string;
}
