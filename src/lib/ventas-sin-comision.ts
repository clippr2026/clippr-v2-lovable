import { supabase } from "@/integrations/supabase/client";

// Ventas de un profesional que no dejaron ninguna fila de comisión ni de propina
// (comisión $0) y ventas anuladas/reembolsadas. Las listas de Movimientos
// (Mi Panel y Caja > Liquidaciones) las muestran para que ningún día quede
// "sin servicios" aunque haya habido ventas. Las que ya tienen comisión o
// propina se ven por su propia fila, así que acá se dejan afuera.
export async function fetchVentasSinComision(
  businessId: string,
  employeeId: string,
  sinceIso: string | null = null,
): Promise<any[]> {
  let q = supabase
    .from("payments" as any)
    .select(
      "id,client_name,service_name,total,amount,method,payment_method,created_at,discount,original_amount,tip_amount,items,observations,status,promotion_name,promotion_id",
    )
    .eq("business_id", businessId)
    .eq("employee_id", employeeId)
    .in("status", ["cobrado", "anulado", "reembolsado"])
    .order("created_at", { ascending: false })
    .limit(300);
  if (sinceIso) q = q.gt("created_at", sinceIso);
  const { data } = await q;
  const pays = (data ?? []) as any[];
  const ids = pays.map((p) => p.id);
  const conRegistro = new Set<string>();
  if (ids.length > 0) {
    const [{ data: cr }, { data: tr }] = await Promise.all([
      supabase.from("commission_records" as any).select("sale_id").in("sale_id", ids),
      supabase.from("tip_records" as any).select("sale_id").in("sale_id", ids),
    ]);
    ((cr ?? []) as any[]).forEach((r) => conRegistro.add(r.sale_id));
    ((tr ?? []) as any[]).forEach((r) => conRegistro.add(r.sale_id));
  }
  return pays
    .filter((p) => p.status !== "cobrado" || !conRegistro.has(p.id))
    .map((p) => ({
      id: `sin-comision-${p.id}`,
      sale_id: p.id,
      professional_id: employeeId,
      amount: 0,
      pending_amount: 0,
      created_at: p.created_at,
      sale: p,
      __anulada: p.status !== "cobrado",
    }));
}
