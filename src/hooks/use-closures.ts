import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Closure = {
  id: string;
  business_id: string;
  branch_id: string | null;
  start_date: string;
  end_date: string;
  reason: string | null;
  created_by_name: string | null;
  created_at: string;
};

// branch_id null = negocio sin sucursales configuradas todavía (mismo
// criterio "filtro aditivo" que el resto de la fundación multi-sucursal) —
// nunca se mezclan cierres de una sucursal con otra.
export function useClosures(businessId: string | null, branchId: string | null) {
  return useQuery({
    queryKey: ["closures", businessId, branchId],
    queryFn: async (): Promise<Closure[]> => {
      let q = supabase
        .from("closures" as any)
        .select("*")
        .eq("business_id", businessId!)
        .order("start_date", { ascending: false });
      q = branchId ? q.eq("branch_id", branchId) : q.is("branch_id", null);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Closure[];
    },
    enabled: !!businessId,
    staleTime: 15_000,
  });
}

// Turnos ya agendados dentro del rango — para avisar antes de confirmar un
// cierre nuevo (nunca se cancelan solos, solo informa la cantidad).
export async function countAppointmentsInRange(
  businessId: string,
  branchId: string | null,
  startDate: string,
  endDate: string,
): Promise<number> {
  let q = supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .neq("status", "cancelled")
    .gte("starts_at", `${startDate}T00:00:00`)
    .lte("starts_at", `${endDate}T23:59:59`);
  if (branchId) q = q.eq("branch_id", branchId);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export function useCreateClosure(businessId: string | null, branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { start_date: string; end_date: string; reason: string | null; created_by_name: string | null }) => {
      const { error } = await supabase.from("closures" as any).insert({
        business_id: businessId,
        branch_id: branchId,
        start_date: input.start_date,
        end_date: input.end_date,
        reason: input.reason,
        created_by_name: input.created_by_name,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["closures", businessId, branchId] }),
  });
}

export function useUpdateClosure(businessId: string | null, branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; start_date: string; end_date: string; reason: string | null }) => {
      const { error } = await supabase
        .from("closures" as any)
        .update({ start_date: input.start_date, end_date: input.end_date, reason: input.reason })
        .eq("id", input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["closures", businessId, branchId] }),
  });
}

export function useDeleteClosure(businessId: string | null, branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("closures" as any).delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["closures", businessId, branchId] }),
  });
}
