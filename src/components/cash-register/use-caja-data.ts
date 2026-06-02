import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Portado de loadDashboard + loadSettings de app.js
 * Tablas: services, employees, payments, expenses, cash_sessions, business_settings
 */

export type Service = {
  id: string;
  name: string;
  price: number;
  duration?: number | null;
  category?: string | null;
  is_active?: boolean;
  stock?: number | null;
};

export type Employee = {
  id: string;
  name: string;
  
};

export type ClientLite = {
  id: string;
  name: string;
  phone: string | null;
  email?: string | null;
  birth_date?: string | null;
};

export type Payment = {
  id: string;
  total: number | null;
  amount: number | null;
  method: string | null;
  client_name: string | null;
  service_name: string | null;
  created_at: string;
  employee_id: string | null;
  appointment_id: string | null;
};

export type Expense = {
  id: string;
  amount: number | null;
  category: string | null;
  payment_method: string | null;
};

export type ApprovalMode = "auto" | "manual" | "disabled";
export type PaymentMethodsConfig = { efectivo: boolean; transferencia: boolean; tarjeta: boolean; mp: boolean; cuentaDni: boolean };

export function useCajaData() {
  const { businessId, profile } = useAuth();
  const [loading, setLoading] = React.useState(true);
  const [approvalMode, setApprovalModeState] = React.useState<ApprovalMode>("auto");
  const [services, setServices] = React.useState<Service[]>([]);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [clients, setClients] = React.useState<ClientLite[]>([]);
  const [paymentsToday, setPaymentsToday] = React.useState<Payment[]>([]);
  const [expensesToday, setExpensesToday] = React.useState<Expense[]>([]);
  const [cashSessionId, setCashSessionId] = React.useState<string | null>(null);
  const [pendingCount, setPendingCount] = React.useState(0);
  const [pendingAmount, setPendingAmount] = React.useState(0);
  const [paymentMethods, setPaymentMethods] = React.useState<PaymentMethodsConfig>({
    efectivo: true,
    transferencia: true,
    tarjeta: true,
    mp: true,
    cuentaDni: false,
  });

  const load = React.useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    if (typeof window !== "undefined") {
      try {
        const saved = window.localStorage.getItem(`clippr_payment_methods_${businessId}`);
        if (saved) {
          setPaymentMethods((defaults) => ({ ...defaults, ...JSON.parse(saved) }));
        }
      } catch {
        // mantener defaults
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const dateStr = new Date().toISOString().slice(0, 10);

    const [svcRes, empRes, payRes, expRes, sessRes, bsRes, cliRes] = await Promise.allSettled([
      supabase
        .from("price_catalog")
        .select("id,name,price,duration_min,category,active,stock")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("category")
        .order("name"),
      supabase
        .from("employees")
        .select("id,full_name,is_active")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("full_name", { ascending: true }),
      supabase
        .from("payments")
        .select("id,total,amount,method,client_name,service_name,created_at,employee_id,appointment_id")
        .gte("created_at", today.toISOString())
        .lte("created_at", todayEnd.toISOString())
        .order("created_at", { ascending: false }),
      supabase
        .from("expenses")
        .select("id,amount,category,payment_method")
        .eq("business_id", businessId)
        .eq("date", dateStr),
      supabase
        .from("cash_sessions")
        .select("id")
        .eq("business_id", businessId)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("business_settings")
        .select("approval_mode")
        .eq("business_id", businessId)
        .maybeSingle(),
      supabase
        .from("clients")
        .select("id,name,phone,email,birth_date")
        .eq("business_id", businessId)
        .order("name"),
    ]);

    const svcRaw =
      svcRes.status === "fulfilled" && !svcRes.value.error
        ? (svcRes.value.data ?? [])
        : [];
    setServices(
      (svcRaw as Array<{ id: string; name: string; price: number; duration_min: number | null; category: string | null; active: boolean | null; stock: number | null }>).map((r) => ({
        id: r.id,
        name: r.name,
        price: Number(r.price ?? 0),
        duration: r.duration_min,
        category: r.category,
        is_active: r.active !== false,
        stock: r.stock,
      })),
    );
    setEmployees(
      empRes.status === "fulfilled" && !empRes.value.error
        ? ((empRes.value.data ?? []) as Array<{ id: string; full_name: string | null; is_active?: boolean | null }>).map((r) => ({
            id: r.id,
            name: r.full_name ?? "Sin nombre",
          }))
        : []
    );
    setClients(
      cliRes.status === "fulfilled" && !cliRes.value.error
        ? ((cliRes.value.data ?? []) as ClientLite[])
        : []
    );
    setPaymentsToday(
      payRes.status === "fulfilled" && !payRes.value.error
        ? ((payRes.value.data ?? []) as Payment[])
        : []
    );
    setExpensesToday(
      expRes.status === "fulfilled" && !expRes.value.error
        ? ((expRes.value.data ?? []) as Expense[])
        : []
    );
    setCashSessionId(
      sessRes.status === "fulfilled" && !sessRes.value.error
        ? (sessRes.value.data?.id ?? null)
        : null
    );

    // Turnos del día pendientes de cobro (no cobrados / no cancelados)
    try {
      const { data: appts } = await supabase
        .from("appointments")
        .select("id,status,service_price")
        .eq("business_id", businessId)
        .gte("starts_at", today.toISOString())
        .lte("starts_at", todayEnd.toISOString());
      const pend = (appts ?? []).filter(
        (a: { status: string }) =>
          !["charged", "cancelled", "blocked"].includes(a.status),
      );
      setPendingCount(pend.length);
      setPendingAmount(
        pend.reduce((s, a: { service_price: number | null }) => s + Number(a.service_price ?? 0), 0),
      );
    } catch {
      setPendingCount(0);
      setPendingAmount(0);
    }

    const mode =
      bsRes.status === "fulfilled" && !bsRes.value.error
        ? bsRes.value.data?.approval_mode
        : null;
    if (mode === "manual" || mode === "auto" || mode === "disabled")
      setApprovalModeState(mode as ApprovalMode);

    setLoading(false);
  }, [businessId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const setApprovalMode = React.useCallback(
    async (m: ApprovalMode) => {
      setApprovalModeState(m);
      if (!businessId) return;
      try {
        await supabase
          .from("business_settings")
          .upsert(
            { business_id: businessId, approval_mode: m },
            { onConflict: "business_id" }
          );
      } catch (e) {
        console.warn("[caja] setApprovalMode failed:", (e as Error).message);
      }
    },
    [businessId]
  );

  // KPIs (portados de loadDashboard / updateCajaKpis)
  const revHoy = paymentsToday.reduce(
    (s, p) => s + Number(p.total ?? p.amount ?? 0),
    0
  );
  const cobros = paymentsToday.length;
  const ticket = cobros > 0 ? Math.round(revHoy / cobros) : 0;
  const totalGastos = expensesToday.reduce(
    (s, e) => s + Number(e.amount ?? 0),
    0
  );

  return {
    loading,
    businessId,
    profileId: profile?.id ?? null,
    approvalMode,
    setApprovalMode,
    services,
    employees,
    clients,
    paymentsToday,
    expensesToday,
    cashSessionId,
    revHoy,
    cobros,
    ticket,
    totalGastos,
    pendingCount,
    pendingAmount,
    paymentMethods,
    refresh: load,
  };
}
