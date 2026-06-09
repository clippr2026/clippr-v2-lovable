import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const MANUAL_PENDING_KEY = "clippr_pending_manual_charges";

type LocalManualPendingCharge = {
  id: string;
  business_id: string;
  employee_id: string | null;
  client_name: string | null;
  service_name: string | null;
  service_price: number | null;
  starts_at: string;
  notes?: string | null;
  status?: string | null;
};

function readLocalManualPendingCharges(businessId: string): LocalManualPendingCharge[] {
  if (typeof window === "undefined") return [];
  try {
    const rows = JSON.parse(window.localStorage.getItem(MANUAL_PENDING_KEY) || "[]") as LocalManualPendingCharge[];
    return rows.filter((item) => item.business_id === businessId);
  } catch {
    return [];
  }
}


export type Service = {
  id: string;
  name: string;
  price: number;
  duration?: number | null;
  category?: string | null;
  is_active?: boolean;
  stock?: number | null;
  is_catalog?: boolean; // true = producto del catálogo
};

export type Employee = {
  id: string;
  name: string;
  commission_pct: number | null;
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
  payment_method?: string | null;
  client_name: string | null;
  service_name: string | null;
  created_at: string;
  employee_id: string | null;
  employee_name?: string | null;
  appointment_id: string | null;
  charged_by?: string | null;
  charge_type?: "auto" | "manual" | "caja" | string | null;
  status?: string | null;
  observations?: string | null;
};

export type PendingCharge = {
  id: string;
  client_name: string | null;
  service_name: string | null;
  service_price: number | null;
  employee_id: string | null;
  starts_at: string;
  notes?: string | null;
  status?: string | null;
};

export type Expense = {
  id: string;
  name?: string | null;
  amount: number | null;
  type?: string | null;
  category: string | null;
  payment_method: string | null;
  date?: string | null;
  note?: string | null;
  created_at?: string | null;
  user_id?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  created_by?: string | null;
};

export type ApprovalMode = "auto" | "manual";
export type PaymentMethodsConfig = {
  efectivo: boolean;
  transferencia: boolean;
  tarjeta: boolean;
  mp: boolean;
  cuentaDni: boolean;
};

export function useCajaData() {
  const { businessId, profile } = useAuth();
  const [loading, setLoading] = React.useState(true);
  const [approvalMode, setApprovalModeState] = React.useState<ApprovalMode>("auto");
  const [approvalModeEnabled, setApprovalModeEnabled] = React.useState(false);
  const [paymentMethods, setPaymentMethods] = React.useState<PaymentMethodsConfig>({
    efectivo: true, transferencia: true, tarjeta: true, mp: true, cuentaDni: false,
  });
  const [services, setServices] = React.useState<Service[]>([]);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [clients, setClients] = React.useState<ClientLite[]>([]);
  const [paymentsToday, setPaymentsToday] = React.useState<Payment[]>([]);
  const [expensesToday, setExpensesToday] = React.useState<Expense[]>([]);
  const [cashSessionId, setCashSessionId] = React.useState<string | null>(null);
  const [pendingCount, setPendingCount] = React.useState(0);
  const [pendingAmount, setPendingAmount] = React.useState(0);
  const [pendingCharges, setPendingCharges] = React.useState<PendingCharge[]>([]);

  const load = React.useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const dateStr = new Date().toISOString().slice(0, 10);

    const [svcRes, empRes, payRes, expRes, sessRes, bsRes, cliRes, pendingChargeRes] = await Promise.allSettled([
      supabase
        .from("price_catalog")
        .select("id,name,price,duration_min,category,active,stock")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("category")
        .order("name"),
      supabase
        .from("employees")
        .select("id,full_name,is_active,commission_pct")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("full_name", { ascending: true }),
      supabase
        .from("payments")
        .select("id,total,amount,method,payment_method,client_name,service_name,created_at,employee_id,appointment_id,charged_by,charge_type,status,charged_at,observations")
        .eq("business_id", businessId)
        .gte("created_at", today.toISOString())
        .lte("created_at", todayEnd.toISOString())
        .order("created_at", { ascending: false }),
      supabase
        .from("expenses")
        .select("id,name,amount,type,category,payment_method,date,note,created_at,user_id,user_name,user_email,created_by")
        .eq("business_id", businessId)
        .eq("date", dateStr)
        .order("created_at", { ascending: false }),
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
        .select("approval_mode,schedule")
        .eq("business_id", businessId)
        .maybeSingle(),
      supabase
        .from("clients")
        .select("id,full_name,phone,email,birth_date")
        .eq("business_id", businessId)
        .order("full_name"),
      supabase
        .from("appointments")
        .select("id,client_name,service_name,service_price,employee_id,starts_at,notes,status")
        .eq("business_id", businessId)
        .eq("status", "pending_payment")
        .order("starts_at", { ascending: true }),
    ]);

    // Services — separate services (has duration_min) from catalog products
    const svcRaw = svcRes.status === "fulfilled" && !svcRes.value.error ? (svcRes.value.data ?? []) : [];
    setServices(
      (svcRaw as Array<{ id: string; name: string; price: number; duration_min: number | null; category: string | null; active: boolean | null; stock: number | null }>)
        .map((r) => ({
          id: r.id,
          name: r.name,
          price: Number(r.price ?? 0),
          duration: r.duration_min,
          category: r.category,
          is_active: r.active !== false,
          stock: r.stock,
          is_catalog: r.duration_min == null, // no duration = catalog product
        })),
    );

    // Employees with commission
    setEmployees(
      empRes.status === "fulfilled" && !empRes.value.error
        ? ((empRes.value.data ?? []) as Array<{ id: string; full_name: string | null; commission_pct: number | null }>)
            .map((r) => ({ id: r.id, name: r.full_name ?? "Sin nombre", commission_pct: r.commission_pct ?? null }))
        : []
    );

    // Clients
    setClients(
      cliRes.status === "fulfilled" && !cliRes.value.error
        ? ((cliRes.value.data ?? []) as Array<{ id: string; full_name?: string | null; phone: string | null; email?: string | null; birth_date?: string | null }>)
            .map((r) => ({ id: r.id, name: r.full_name ?? "Sin nombre", phone: r.phone, email: r.email, birth_date: r.birth_date }))
        : []
    );

    const pendingFromDb =
      pendingChargeRes.status === "fulfilled" && !pendingChargeRes.value.error
        ? ((pendingChargeRes.value.data ?? []) as PendingCharge[]).filter((appointment) =>
            appointment.status === "pending_payment" ||
            String(appointment.notes ?? "").includes("[PENDIENTE_CAJA]")
          )
        : [];

    const pendingFromLocal = readLocalManualPendingCharges(businessId).map((item) => ({
      id: item.id,
      client_name: item.client_name,
      service_name: item.service_name,
      service_price: item.service_price,
      employee_id: item.employee_id,
      starts_at: item.starts_at,
      notes: item.notes,
      status: "pending_payment",
    }));

    const pendingMap = new Map<string, PendingCharge>();
    [...pendingFromLocal, ...pendingFromDb].forEach((item) => pendingMap.set(item.id, item));
    const pendingFromProfessionals = Array.from(pendingMap.values());

    setPendingCharges(pendingFromProfessionals);

    setPaymentsToday(payRes.status === "fulfilled" && !payRes.value.error ? ((payRes.value.data ?? []) as Payment[]) : []);
    setExpensesToday(expRes.status === "fulfilled" && !expRes.value.error ? ((expRes.value.data ?? []) as Expense[]) : []);
    setCashSessionId(sessRes.status === "fulfilled" && !sessRes.value.error ? (sessRes.value.data?.id ?? null) : null);

    // Approval mode + payment methods from schedule._caja
    if (bsRes.status === "fulfilled" && !bsRes.value.error && bsRes.value.data) {
      const row = bsRes.value.data;
      const mode = row.approval_mode;
      setApprovalModeState(mode === "manual" ? "manual" : "auto");
      const schedule = (row.schedule ?? {}) as Record<string, unknown>;
      const caja = (schedule._caja ?? {}) as Record<string, unknown>;
      setApprovalModeEnabled(caja.approvalModeEnabled === true);
      if (caja.methods && typeof caja.methods === "object") {
        const m = caja.methods as Record<string, boolean>;
        setPaymentMethods({
          efectivo: m.efectivo !== false,
          transferencia: m.transferencia !== false,
          tarjeta: m.tarjeta !== false,
          mp: m.mp !== false,
          cuentaDni: m.cuentaDni === true,
        });
      }
    }

    // Pending charges sent from professional panel to Caja
    setPendingCount(pendingFromProfessionals.length);
    setPendingAmount(pendingFromProfessionals.reduce((s, a) => s + Number(a.service_price ?? 0), 0));

    setLoading(false);
  }, [businessId]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    const refreshPending = () => load();
    window.addEventListener("clippr:manual-pending-updated", refreshPending);
    window.addEventListener("storage", refreshPending);
    return () => {
      window.removeEventListener("clippr:manual-pending-updated", refreshPending);
      window.removeEventListener("storage", refreshPending);
    };
  }, [load]);

  // Listen for caja settings updates (from Configuración → Caja)
  React.useEffect(() => {
    const refresh = () => load();
    window.addEventListener("clippr:caja-settings-updated", refresh);
    return () => window.removeEventListener("clippr:caja-settings-updated", refresh);
  }, [load]);

  const setApprovalMode = React.useCallback(async (m: ApprovalMode) => {
    setApprovalModeState(m);
    if (!businessId) return;
    try {
      const { data: existingRow } = await supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle();

      const { error } = await supabase.from("business_settings")
        .upsert(
          {
            business_id: businessId,
            approval_mode: m,
            schedule: existingRow?.schedule ?? {},
          },
          { onConflict: "business_id" },
        );

      if (error) throw error;
      window.dispatchEvent(new CustomEvent("clippr:caja-settings-updated"));
    } catch (e) {
      console.warn("[caja] setApprovalMode failed:", (e as Error).message);
    }
  }, [businessId]);

  const revHoy = paymentsToday.reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
  const cobros = paymentsToday.length;
  const ticket = cobros > 0 ? Math.round(revHoy / cobros) : 0;
  const totalGastos = expensesToday.reduce((s, e) => s + Number(e.amount ?? 0), 0);

  return {
    loading, businessId, profileId: profile?.id ?? null,
    approvalMode, setApprovalMode, approvalModeEnabled,
    paymentMethods,
    services, employees, clients,
    paymentsToday, expensesToday, cashSessionId,
    revHoy, cobros, ticket, totalGastos,
    pendingCount, pendingAmount, pendingCharges,
    refresh: load,
  };
}
