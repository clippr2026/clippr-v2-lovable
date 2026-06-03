import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Portado de cjLoadProfesionales / cjVerPagosProf / cjVerProduccion (app.js)
 * Tablas: employees, payments, professional_payouts, appointments
 */

export type Professional = {
  id: string;
  full_name: string;
  commission_pct: number;
  is_active: boolean;
};

export type ProfStats = {
  facturacion: number;
  comision: number;
  pagado: number;
  pendiente: number;
  ventasCount: number;
};

export type ProfPayment = {
  id: string;
  amount: number;
  date: string;
  method: string | null;
  note: string | null;
  created_by: string | null;
};

export type ProfSale = {
  id: string;
  client_name: string | null;
  service_name: string | null;
  total: number;
  created_at: string;
  method: string | null;
};

export type ProfTurno = {
  id: string;
  client_name: string | null;
  service_name: string | null;
  service_price: number | null;
  starts_at: string;
  ends_at: string | null;
  status: string;
  notes: string | null;
};

// ── Professionals list ─────────────────────────────────────────────────────
export function useProfessionals(businessId: string | null) {
  return useQuery({
    queryKey: ["professionals", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id,full_name,commission_pct,is_active")
        .eq("business_id", businessId!)
        .order("full_name", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).filter((e) => e.is_active !== false) as Professional[];
    },
    enabled: !!businessId,
    staleTime: 60_000,
  });
}

// ── Stats for one professional in date range ──────────────────────────────
export function useProfStats(
  businessId: string | null,
  empId: string | null,
  from: string,
  to: string
) {
  return useQuery({
    queryKey: ["prof-stats", businessId, empId, from, to],
    queryFn: async (): Promise<ProfStats> => {
      // Guard against invalid dates
      if (!from || !to || isNaN(new Date(from).getTime()) || isNaN(new Date(to).getTime())) {
        return { facturacion: 0, comision: 0, pagado: 0, pendiente: 0, ventasCount: 0 };
      }
      const fromISO = from + "T00:00:00";
      const toISO = to + "T23:59:59";

      const [{ data: pays }, { data: payouts }] = await Promise.all([
        supabase
          .from("payments")
          .select("total,amount")
          .eq("business_id", businessId!)
          .eq("employee_id", empId!)
          .gte("created_at", fromISO)
          .lte("created_at", toISO),
        supabase
          .from("professional_payouts")
          .select("amount")
          .eq("business_id", businessId!)
          .eq("employee_id", empId!)
          .gte("date", from)
          .lte("date", to),
      ]);

      // Need commission_pct for this employee
      const { data: emp } = await supabase
        .from("employees")
        .select("commission_pct")
        .eq("id", empId!)
        .maybeSingle();

      const commPct = Number(emp?.commission_pct ?? 0) / 100;
      const facturacion = (pays ?? []).reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
      const comision = Math.round(facturacion * commPct);
      const pagado = (payouts ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);

      return {
        facturacion,
        comision,
        pagado,
        pendiente: Math.max(0, comision - pagado),
        ventasCount: (pays ?? []).length,
      };
    },
    enabled: !!businessId && !!empId,
    staleTime: 30_000,
  });
}

// ── Payment history (all time) ────────────────────────────────────────────
export function useProfPayments(
  businessId: string | null,
  empId: string | null,
  from?: string,
  to?: string,
) {
  return useQuery({
    queryKey: ["prof-payments", businessId, empId, from ?? null, to ?? null],
    queryFn: async (): Promise<ProfPayment[]> => {
      let query = supabase
        .from("professional_payouts")
        .select("id,amount,date,method,note,created_by")
        .eq("business_id", businessId!)
        .eq("employee_id", empId!);

      if (from) query = query.gte("date", from);
      if (to) query = query.lte("date", to);

      const { data, error } = await query.order("date", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ProfPayment[];
    },
    enabled: !!businessId && !!empId,
    staleTime: 30_000,
  });
}

// ── Sales history in date range ───────────────────────────────────────────
export function useProfSales(
  businessId: string | null,
  empId: string | null,
  from: string,
  to: string
) {
  return useQuery({
    queryKey: ["prof-sales", businessId, empId, from, to],
    queryFn: async (): Promise<ProfSale[]> => {
      if (!from || !to || isNaN(new Date(from).getTime()) || isNaN(new Date(to).getTime())) return [];
      const { data, error } = await supabase
        .from("payments")
        .select("id,client_name,service_name,total,amount,method,payment_method,created_at")
        .eq("business_id", businessId!)
        .eq("employee_id", empId!)
        .gte("created_at", from + "T00:00:00")
        .lte("created_at", to + "T23:59:59")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((p) => ({
        id: p.id,
        client_name: p.client_name,
        service_name: p.service_name,
        total: Number(p.total ?? p.amount ?? 0),
        method: (p.method ?? p.payment_method ?? null) as string | null,
        created_at: p.created_at,
      }));
    },
    enabled: !!businessId && !!empId,
    staleTime: 30_000,
  });
}

// ── Today's appointments for one professional ─────────────────────────────
export function useProfTurnos(businessId: string | null, empId: string | null) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  return useQuery({
    queryKey: ["prof-turnos", businessId, empId, today.toISOString().slice(0, 10)],
    queryFn: async (): Promise<ProfTurno[]> => {
      const { data, error } = await supabase
        .from("appointments")
        .select("id,client_name,service_name,service_price,starts_at,ends_at,status,notes")
        .eq("business_id", businessId!)
        .eq("employee_id", empId!)
        .gte("starts_at", today.toISOString())
        .lte("starts_at", todayEnd.toISOString())
        .order("starts_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as ProfTurno[];
    },
    enabled: !!businessId && !!empId,
    staleTime: 30_000,
  });
}

// ── Register payment ──────────────────────────────────────────────────────
export type NewPayoutInput = {
  empId: string;
  amount: number;
  method: string;
  note?: string;
  createdBy?: string;
};

export function useRegisterPayout(businessId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewPayoutInput) => {
      if (!businessId) throw new Error("Sin negocio");
      const { error } = await supabase.from("professional_payouts").insert({
        business_id: businessId,
        employee_id: input.empId,
        amount: input.amount,
        date: new Date().toISOString().slice(0, 10),
        method: input.method || null,
        note: input.note?.trim() || null,
        created_by: input.createdBy ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["prof-payments", businessId, vars.empId] });
      qc.invalidateQueries({ queryKey: ["prof-stats"] });
    },
  });
}
