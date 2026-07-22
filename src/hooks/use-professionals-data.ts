import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Portado de cjLoadProfesionales / cjVerPagosProf / cjVerProduccion (app.js)
 * Tablas: employees, payments, professional_payouts, appointments
 */

export type Professional = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  role_label?: string | null;
  commission_pct: number;
  commission_fixed?: number | null;
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
  created_at?: string | null;
};

export type ProfSale = {
  id: string;
  client_name: string | null;
  service_name: string | null;
  total: number;
  created_at: string;
  method: string | null;
  // Pago múltiple (ej. Efectivo + Transferencia): lista de métodos usados,
  // sin importes por método — eso queda para el detalle de la venta, no
  // para el listado de Historial de ventas. null/vacío = un solo método,
  // usar `method` en su lugar.
  splits: { method: string; amount: number }[] | null;
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
  // audit fields
  charge_origin: string | null;
  charged_by: string | null;
  payment_method: string | null;
};

// ── Professionals list ─────────────────────────────────────────────────────
export function useProfessionals(businessId: string | null) {
  return useQuery({
    queryKey: ["professionals", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id,full_name,avatar_url,role_label,commission_pct,commission_fixed,is_active")
        .eq("business_id", businessId!)
        .order("full_name", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Professional[];
    },
    enabled: !!businessId,
    staleTime: 60_000,
  });
}

// ── Stats for one professional in date range ──────────────────────────────
// `pendiente` es la cuenta corriente real (comisión generada - pagada, sin
// importar rango) — fuente: commission_records, la misma que usa Caja >
// Liquidaciones. `comision`/`ventasCount` sí se filtran por rango (lo que
// generó en ese período), pero nunca alteran el pendiente total.
// Nota: como en Caja > Liquidaciones, esto solo contempla commission_pct —
// un profesional con comisión fija (commission_fixed) sin % configurado no
// genera filas en commission_records y va a mostrar comisión/pendiente $0.
export function useProfStats(
  businessId: string | null,
  empId: string | null,
  from: string,
  to: string
) {
  return useQuery({
    queryKey: ["prof-stats", businessId, empId, from, to],
    queryFn: async (): Promise<ProfStats> => {
      if (!from || !to || isNaN(new Date(from).getTime()) || isNaN(new Date(to).getTime())) {
        return { facturacion: 0, comision: 0, pagado: 0, pendiente: 0, ventasCount: 0 };
      }
      const fromISO = from + "T00:00:00";
      const toISO = to + "T23:59:59";

      const [{ data: pays }, { data: commissions }, { data: settlements }, { data: legacyPayouts }] =
        await Promise.all([
          supabase
            .from("payments")
            .select("total,amount")
            .eq("business_id", businessId!)
            .eq("employee_id", empId!)
            .gte("created_at", fromISO)
            .lte("created_at", toISO),
          supabase
            .from("commission_records" as any)
            .select("amount,paid_amount,pending_amount,sale_date")
            .eq("business_id", businessId!)
            .eq("professional_id", empId!),
          supabase
            .from("professional_settlements" as any)
            .select("amount_paid,paid_at")
            .eq("business_id", businessId!)
            .eq("professional_id", empId!)
            .gte("paid_at", fromISO)
            .lte("paid_at", toISO),
          supabase
            .from("professional_payouts")
            .select("amount,date")
            .eq("business_id", businessId!)
            .eq("employee_id", empId!)
            .gte("date", from)
            .lte("date", to),
        ]);

      const facturacion = (pays ?? []).reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
      const allCommissions = (commissions ?? []) as Array<{ amount: number; pending_amount: number; sale_date: string }>;
      const pendiente = allCommissions.reduce((s, c) => s + Number(c.pending_amount ?? 0), 0);
      const comision = allCommissions
        .filter((c) => c.sale_date >= from && c.sale_date <= to)
        .reduce((s, c) => s + Number(c.amount ?? 0), 0);
      const pagado =
        (settlements ?? []).reduce((s: number, p: any) => s + Number(p.amount_paid ?? 0), 0) +
        (legacyPayouts ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);

      return {
        facturacion,
        comision,
        pagado,
        pendiente,
        ventasCount: (pays ?? []).length,
      };
    },
    enabled: !!businessId && !!empId,
    staleTime: 30_000,
  });
}

// ── Payment history (all time) ────────────────────────────────────────────
// Combina professional_settlements (pagos nuevos, con saldo anterior/
// posterior) + professional_payouts (pagos de antes de existir la cuenta
// corriente — esos no tienen saldo anterior/posterior, ver balanceBefore/
// balanceAfter en null).
export function useProfPayments(
  businessId: string | null,
  empId: string | null,
  from?: string,
  to?: string,
) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["prof-payments", businessId, empId, from ?? null, to ?? null],
    queryFn: async (): Promise<ProfPayment[]> => {
      let settlementsQuery = supabase
        .from("professional_settlements" as any)
        .select(
          "id,amount_paid,already_paid_before,commission_total_in_range,pending_after,payment_method,note,paid_by_name,paid_at",
        )
        .eq("business_id", businessId!)
        .eq("professional_id", empId!);
      let payoutsQuery = supabase
        .from("professional_payouts")
        .select("id,amount,date,method,note,created_by,created_at")
        .eq("business_id", businessId!)
        .eq("employee_id", empId!);

      if (from) {
        settlementsQuery = settlementsQuery.gte("paid_at", `${from}T00:00:00`);
        payoutsQuery = payoutsQuery.gte("date", from);
      }
      if (to) {
        settlementsQuery = settlementsQuery.lte("paid_at", `${to}T23:59:59.999`);
        payoutsQuery = payoutsQuery.lte("date", to);
      }

      const [{ data: settlements, error: settlementsError }, { data: payouts, error: payoutsError }] =
        await Promise.all([
          settlementsQuery.order("paid_at", { ascending: false }),
          payoutsQuery.order("date", { ascending: false }),
        ]);
      if (settlementsError) throw new Error(settlementsError.message);
      if (payoutsError) throw new Error(payoutsError.message);

      const fromSettlements = ((settlements ?? []) as any[]).map((s) => ({
        id: s.id,
        amount: Number(s.amount_paid ?? 0),
        date: String(s.paid_at ?? "").slice(0, 10),
        method: s.payment_method,
        note: s.note,
        created_by: s.paid_by_name,
        created_at: s.paid_at,
      }));
      const fromPayouts = ((payouts ?? []) as any[]).map((p) => ({
        id: p.id,
        amount: Number(p.amount ?? 0),
        date: p.date,
        method: p.method,
        note: p.note,
        created_by: p.created_by,
        created_at: p.created_at,
      }));

      return [...fromSettlements, ...fromPayouts].sort((a, b) =>
        String(b.created_at ?? b.date ?? "").localeCompare(String(a.created_at ?? a.date ?? "")),
      ) as ProfPayment[];
    },
    enabled: !!businessId && !!empId,
    staleTime: 30_000,
  });

  // Realtime: cuando se registra un pago (p.ej. desde Caja → Liquidaciones),
  // refrescar el historial de pagos y los stats al instante, sin recargar
  // la página ni cambiar de pestaña. Sin filtro server-side para no
  // depender de REPLICA IDENTITY FULL; RLS acota las filas igual.
  React.useEffect(() => {
    if (!businessId || !empId) return;
    const channel = supabase
      .channel(`prof-payouts-${empId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "professional_settlements" },
        () => {
          qc.invalidateQueries({ queryKey: ["prof-payments", businessId, empId] });
          qc.invalidateQueries({ queryKey: ["prof-stats", businessId, empId] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "commission_records" },
        () => {
          qc.invalidateQueries({ queryKey: ["prof-stats", businessId, empId] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [businessId, empId, qc]);

  return query;
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
      // "splits" (métodos de pago múltiple) puede no existir todavía como
      // columna en `payments` — a diferencia de un UPDATE, un SELECT con una
      // columna inexistente tira error duro (PGRST 42703) en vez de fallar
      // en silencio, así que un reintento sin "splits" evita romper todo
      // Historial de ventas / Rendimiento si la columna no está.
      let data: any[] | null;
      let error: { code?: string; message: string } | null;
      ({ data, error } = await supabase
        .from("payments")
        .select("id,client_name,service_name,total,amount,method,payment_method,splits,created_at")
        .eq("business_id", businessId!)
        .eq("employee_id", empId!)
        .gte("created_at", from + "T00:00:00")
        .lte("created_at", to + "T23:59:59")
        .order("created_at", { ascending: false }));
      if (error?.code === "42703") {
        ({ data, error } = await supabase
          .from("payments")
          .select("id,client_name,service_name,total,amount,method,payment_method,created_at")
          .eq("business_id", businessId!)
          .eq("employee_id", empId!)
          .gte("created_at", from + "T00:00:00")
          .lte("created_at", to + "T23:59:59")
          .order("created_at", { ascending: false }));
      }
      if (error) throw new Error(error.message);
      return (data ?? []).map((p) => ({
        id: p.id,
        client_name: p.client_name,
        service_name: p.service_name,
        total: Number(p.total ?? p.amount ?? 0),
        method: (p.method ?? p.payment_method ?? null) as string | null,
        splits: ((p as { splits?: unknown }).splits ?? null) as { method: string; amount: number }[] | null,
        created_at: p.created_at,
      }));
    },
    enabled: !!businessId && !!empId,
    staleTime: 30_000,
  });
}

// ── Today's appointments for one professional ─────────────────────────────
export function useProfTurnos(
  businessId: string | null,
  empId: string | null,
  from?: string,
  to?: string,
) {
  const today = new Date().toISOString().slice(0, 10);
  const validFrom = from || today;
  const validTo = to || today;

  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["prof-turnos", businessId, empId, validFrom, validTo],
    queryFn: async (): Promise<ProfTurno[]> => {
      // Expand query range by 1 day on each side to avoid losing appointments
      // near midnight due to UTC offset (e.g. AR is UTC-3, so a 22:00 local
      // appointment is stored as T01:00:00Z the next day).
      const fromDate = new Date(validFrom + "T00:00:00");
      fromDate.setDate(fromDate.getDate() - 1);
      const toDate = new Date(validTo + "T23:59:59");
      toDate.setDate(toDate.getDate() + 1);

      // Sin .neq("status", "cancelled") a propósito: professionals.tsx separa
      // activeTurnos (agenda) de cancelledTurnos (contador "Cancelados" +
      // modal de detalle) a partir de este mismo array — filtrar acá los
      // turnos cancelados los dejaba afuera del fetch por completo, así que
      // el contador de Cancelados quedaba en 0 para siempre sin importar
      // cuántos se cancelaran ni cuántas veces se refetcheara.
      const { data, error } = await supabase
        .from("appointments")
        .select("id,client_name,service_name,service_price,starts_at,ends_at,status,notes,employee_id")
        .eq("business_id", businessId!)
        .eq("employee_id", empId!)
        .gte("starts_at", fromDate.toISOString())
        .lte("starts_at", toDate.toISOString())
        .order("starts_at", { ascending: true });
      if (error) throw new Error(error.message);

      // Filter locally using local date string to avoid any UTC mismatch
      return (data ?? [])
        .filter((row) => {
          // Convert the UTC ISO timestamp to local YYYY-MM-DD for comparison
          const localDate = new Date(row.starts_at).toLocaleDateString("sv-SE"); // "sv-SE" gives YYYY-MM-DD
          return localDate >= validFrom && localDate <= validTo;
        })
        .map((row) => ({
          id: row.id,
          client_name: row.client_name,
          service_name: row.service_name,
          service_price: row.service_price,
          starts_at: row.starts_at,
          ends_at: row.ends_at,
          status: row.status,
          notes: row.notes,
          charge_origin: null,
          charged_by: null,
          payment_method: null,
        })) as ProfTurno[];
    },
    enabled: !!businessId && !!empId,
    staleTime: 30_000,
  });

  // Realtime: re-fetch cuando cambia cualquier appointment del negocio
  React.useEffect(() => {
    if (!businessId || !empId) return;
    const channel = supabase
      .channel(`prof-turnos-${empId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `business_id=eq.${businessId}` },
        () => { qc.invalidateQueries({ queryKey: ["prof-turnos", businessId, empId] }); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [businessId, empId, qc]);

  return query;
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
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) throw new Error("Sesión inválida — volvé a iniciar sesión");

      // Transaccional en el server: aplica el pago contra las comisiones
      // pendientes más viejas primero (commission_records) y crea el
      // registro de liquidación con los snapshots — misma función que usa
      // Caja > Liquidaciones, así el saldo nunca se desincroniza entre
      // las dos pantallas.
      const { error } = await supabase.rpc("register_settlement_payment" as any, {
        p_business_id: businessId,
        p_professional_id: input.empId,
        p_amount: input.amount,
        p_payment_method: input.method || null,
        p_note: input.note?.trim() || null,
        p_paid_by: user.id,
        p_paid_by_name: input.createdBy ?? "Profesionales",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["prof-payments", businessId, vars.empId] });
      qc.invalidateQueries({ queryKey: ["prof-stats"] });
    },
  });
}

// ── Mis liquidaciones (Panel del profesional) ─────────────────────────────
// Lee las mismas tablas que Caja > Liquidaciones (settlement_runs /
// settlement_payments) — el profesional y el administrador siempre ven
// los mismos importes, porque es la misma fuente de datos.
export type SettlementRun = {
  id: string;
  run_number: number;
  cutoff_date: string;
  period_start: string | null;
  previous_settlement_run_id: string | null;
  previous_balance: number;
  new_commissions: number;
  adjustments: number;
  deductions: number;
  adjustment_items: { amount: number; reason: string }[];
  deduction_items: { amount: number; reason: string }[];
  total_to_settle: number;
  amount_paid: number;
  service_count: number;
  status: "pendiente" | "parcial" | "pagada" | "observada";
  prepared_by_name: string;
  prepared_at: string;
  professional_confirmed_at: string | null;
  professional_observation: string | null;
  professional_observed_at: string | null;
};

export function useProfSettlementRuns(businessId: string | null, empId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["prof-settlement-runs", businessId, empId],
    queryFn: async (): Promise<SettlementRun[]> => {
      const { data, error } = await supabase
        .from("settlement_runs" as any)
        .select(
          "id,run_number,cutoff_date,period_start,previous_settlement_run_id,previous_balance,new_commissions,adjustments,deductions,adjustment_items,deduction_items,total_to_settle,amount_paid,service_count,status,prepared_by_name,prepared_at,professional_confirmed_at,professional_observation,professional_observed_at",
        )
        .eq("business_id", businessId!)
        .eq("professional_id", empId!)
        .order("cutoff_date", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as SettlementRun[];
    },
    enabled: !!businessId && !!empId,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (!businessId || !empId) return;
    const channel = supabase
      .channel(`prof-settlement-runs-${empId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "settlement_runs", filter: `professional_id=eq.${empId}` },
        () => qc.invalidateQueries({ queryKey: ["prof-settlement-runs", businessId, empId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId, empId, qc]);

  return query;
}

export function useProfSettlementRunPayments(businessId: string | null, empId: string | null) {
  return useQuery({
    queryKey: ["prof-settlement-run-payments", businessId, empId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settlement_payments" as any)
        .select("id,settlement_run_id,amount,payment_method,note,balance_before,balance_after,paid_by_name,paid_at")
        .eq("business_id", businessId!)
        .eq("professional_id", empId!)
        .order("paid_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{
        id: string;
        settlement_run_id: string;
        amount: number;
        payment_method: string | null;
        note: string | null;
        balance_before: number;
        balance_after: number;
        paid_by_name: string;
        paid_at: string;
      }>;
    },
    enabled: !!businessId && !!empId,
    staleTime: 30_000,
  });
}

// Servicios incluidos en una liquidación puntual (para "Ver servicios
// incluidos" dentro de Mis liquidaciones).
export async function fetchSettlementRunServices(settlementRunId: string) {
  const { data: commissionRows, error } = await supabase
    .from("commission_records" as any)
    .select("id,amount,commission_pct,sale_date,sale_id")
    .eq("settlement_run_id", settlementRunId)
    .order("sale_date", { ascending: true });
  if (error) throw new Error(error.message);
  const saleIds = (commissionRows ?? []).map((c: any) => c.sale_id).filter(Boolean);
  let paymentsById: Record<string, any> = {};
  if (saleIds.length > 0) {
    const { data: pays, error: payError } = await supabase
      .from("payments" as any)
      .select("id,client_name,service_name,total,amount,method,payment_method")
      .in("id", saleIds);
    if (payError) throw new Error(payError.message);
    paymentsById = Object.fromEntries((pays ?? []).map((p: any) => [p.id, p]));
  }
  return (commissionRows ?? []).map((c: any) => ({ ...c, sale: paymentsById[c.sale_id] ?? null }));
}

export function useConfirmSettlementRun(businessId: string | null, empId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settlementRunId: string) => {
      const { error } = await supabase.rpc("confirm_settlement_run" as any, {
        p_settlement_run_id: settlementRunId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prof-settlement-runs", businessId, empId] });
    },
  });
}

export function useObserveSettlementRun(businessId: string | null, empId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { settlementRunId: string; observation: string }) => {
      const { error } = await supabase.rpc("observe_settlement_run" as any, {
        p_settlement_run_id: input.settlementRunId,
        p_observation: input.observation,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prof-settlement-runs", businessId, empId] });
    },
  });
}
