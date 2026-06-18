import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Clientes reales desde Supabase.
 * Las métricas salen de payments: visitas, gasto, última visita, rating e historial.
 */

export type ClientPayment = {
  id: string;
  date: string;
  service: string;
  amount: number;
};

export type ClientAppointment = {
  id: string;
  date: string;
  service: string;
  status: string;
};

export type ClientFavoriteService = {
  service: string;
  count: number;
  amount: number;
};

export type ClientVipTag = "vip" | "ex_vip" | null;

export type Client = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  birth_date?: string | null;
  created_at: string;
  visits: number;
  spent: number;
  spentLast12Months: number;
  favoriteServices: ClientFavoriteService[];
  nextAppointment?: ClientAppointment | null;
  lastVisit?: string | null;
  lastVisitDays?: number | null;
  status: ClientStatus;
  vipTag: ClientVipTag;
  rating: number;
  history: ClientPayment[];
};

export type ClientStatus = "vip" | "nuevo" | "activo" | "inactivo" | "perdido";

const ACTIVE_DAYS = 45;
const LOST_FROM_DAYS = 76;

function diffDaysBetween(a: string, b: string): number {
  const start = new Date(`${a}T00:00:00`).getTime();
  const end = new Date(`${b}T00:00:00`).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function getUniqueVisitDays(history: ClientPayment[]): string[] {
  const days = history.reduce<string[]>((acc, p) => {
    const day = p.date?.slice(0, 10);
    if (day) acc.push(day);
    return acc;
  }, []);

  return Array.from(new Set(days)).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
}

function isVipSequence(days: string[]): boolean {
  if (days.length < 4) return false;
  return days.every((day, index) => index === 0 || diffDaysBetween(days[index - 1], day) <= 15);
}

function computeVipTag(history: ClientPayment[]): ClientVipTag {
  const visitDays = getUniqueVisitDays(history);
  if (visitDays.length < 4) return null;

  const currentWindow = visitDays.slice(-4);
  if (isVipSequence(currentWindow)) return "vip";

  for (let i = 0; i <= visitDays.length - 4; i += 1) {
    if (isVipSequence(visitDays.slice(i, i + 4))) return "ex_vip";
  }

  return null;
}

function computeStatus(
  visits: number,
  lastVisitDays: number | null,
  vipTag: ClientVipTag,
): ClientStatus {
  if (visits <= 1) return "nuevo";
  if (vipTag === "vip") return "vip";
  if (lastVisitDays === null) return "nuevo";
  if (lastVisitDays <= ACTIVE_DAYS) return "activo";
  if (lastVisitDays < LOST_FROM_DAYS) return "inactivo";
  return "perdido";
}

function computeRating(visits: number, spent: number, lastVisitDays: number | null): number {
  let score = 0;

  if (visits >= 1) score += 1;
  if (visits >= 3) score += 1;
  if (visits >= 6) score += 1;
  if (spent >= 50000) score += 1;
  if (spent >= 120000 || (lastVisitDays !== null && lastVisitDays <= 30 && visits >= 3)) score += 1;

  return Math.max(0, Math.min(5, score));
}

function formatLastVisit(date: string | null): { label: string | null; days: number | null } {
  if (!date) return { label: null, days: null };

  const diffMs = Date.now() - new Date(date).getTime();
  const days = Math.max(0, Math.floor(diffMs / 86_400_000));

  if (days === 0) return { label: "hoy", days };
  if (days === 1) return { label: "ayer", days };
  if (days < 7) return { label: `hace ${days} días`, days };
  if (days < 30) return { label: `hace ${Math.round(days / 7)} sem.`, days };
  return { label: `hace ${Math.round(days / 30)} meses`, days };
}

async function loadClients(businessId: string): Promise<Client[]> {
  const { data: rawClients, error } = await supabase
    .from("clients")
    .select("id,full_name,phone,email,notes,birth_date,created_at")
    .eq("business_id", businessId)
    .order("full_name");

  if (error) throw new Error("Error cargando clientes: " + error.message);
  if (!rawClients?.length) return [];

  const [
    { data: payments, error: paymentsError },
    { data: appointments, error: appointmentsError },
  ] = await Promise.all([
    supabase
      .from("payments")
      .select("id,client_name,service_name,total,amount,created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false }),
    supabase
      .from("appointments")
      .select("id,client_id,client_name,service_name,starts_at,status")
      .eq("business_id", businessId)
      .gte("starts_at", new Date().toISOString())
      .neq("status", "cancelled")
      .order("starts_at", { ascending: true }),
  ]);

  if (paymentsError)
    throw new Error("Error cargando historial de clientes: " + paymentsError.message);
  if (appointmentsError)
    throw new Error("Error cargando próximos turnos de clientes: " + appointmentsError.message);

  const paymentsByName = new Map<string, ClientPayment[]>();

  (payments ?? []).forEach((p) => {
    const key = (p.client_name ?? "").trim().toLowerCase();
    if (!key) return;

    if (!paymentsByName.has(key)) paymentsByName.set(key, []);
    paymentsByName.get(key)!.push({
      id: p.id,
      date: p.created_at,
      service: p.service_name || "Servicio",
      amount: Number(p.total ?? p.amount ?? 0),
    });
  });

  const appointmentsByClientId = new Map<string, ClientAppointment>();
  const appointmentsByName = new Map<string, ClientAppointment>();

  (appointments ?? []).forEach((a) => {
    const item: ClientAppointment = {
      id: a.id,
      date: a.starts_at,
      service: a.service_name || "Servicio",
      status: a.status || "pending",
    };
    if (a.client_id && !appointmentsByClientId.has(a.client_id)) {
      appointmentsByClientId.set(a.client_id, item);
    }
    const key = (a.client_name ?? "").trim().toLowerCase();
    if (key && !appointmentsByName.has(key)) {
      appointmentsByName.set(key, item);
    }
  });

  return rawClients.map((c) => {
    const name = c.full_name ?? "Sin nombre";
    const history = paymentsByName.get(name.trim().toLowerCase()) ?? [];
    const visits = history.length;
    const spent = history.reduce((sum, p) => sum + p.amount, 0);
    const last12Cutoff = new Date();
    last12Cutoff.setMonth(last12Cutoff.getMonth() - 12);
    const spentLast12Months = history
      .filter((p) => new Date(p.date).getTime() >= last12Cutoff.getTime())
      .reduce((sum, p) => sum + p.amount, 0);

    const favoriteServiceMap = new Map<string, { count: number; amount: number }>();
    history.forEach((p) => {
      const service = p.service || "Servicio";
      const current = favoriteServiceMap.get(service) ?? { count: 0, amount: 0 };
      favoriteServiceMap.set(service, {
        count: current.count + 1,
        amount: current.amount + p.amount,
      });
    });
    const favoriteServices = Array.from(favoriteServiceMap.entries())
      .map(([service, values]) => ({ service, ...values }))
      .sort((a, b) => b.count - a.count || b.amount - a.amount)
      .slice(0, 3);

    const nextAppointment =
      appointmentsByClientId.get(c.id) ?? appointmentsByName.get(name.trim().toLowerCase()) ?? null;
    const last = history[0]?.date ?? null;
    const lastVisit = formatLastVisit(last);
    const vipTag = computeVipTag(history);

    return {
      id: c.id,
      name,
      phone: c.phone,
      email: c.email,
      notes: c.notes,
      birth_date: c.birth_date,
      created_at: c.created_at,
      visits,
      spent,
      spentLast12Months,
      favoriteServices,
      nextAppointment,
      lastVisit: lastVisit.label,
      lastVisitDays: lastVisit.days,
      vipTag,
      status: computeStatus(visits, lastVisit.days, vipTag),
      rating: computeRating(visits, spent, lastVisit.days),
      history,
    };
  });
}

export function useClientsData(businessId: string | null) {
  return useQuery({
    queryKey: ["clients", businessId],
    queryFn: () => loadClients(businessId!),
    enabled: !!businessId,
    staleTime: 0,
  });
}

export type NewClientInput = {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  birth_date?: string;
};

async function saveClient(businessId: string, input: NewClientInput): Promise<void> {
  const { error } = await supabase.from("clients").insert({
    business_id: businessId,
    full_name: input.name.trim(),
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    notes: input.notes?.trim() || null,
    birth_date: input.birth_date || null,
  });
  if (error) throw new Error("Error al guardar cliente: " + error.message);
}

export function useSaveClient(businessId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewClientInput) => {
      if (!businessId) throw new Error("Sin negocio asignado");
      return saveClient(businessId, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients", businessId] });
      qc.refetchQueries({ queryKey: ["clients", businessId] });
    },
  });
}

async function deleteClient(businessId: string, clientId: string): Promise<void> {
  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("business_id", businessId)
    .eq("id", clientId);
  if (error) throw new Error("Error al eliminar cliente: " + error.message);
}

export function useDeleteClient(businessId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => {
      if (!businessId) throw new Error("Sin negocio asignado");
      return deleteClient(businessId, clientId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients", businessId] });
      qc.refetchQueries({ queryKey: ["clients", businessId] });
    },
  });
}

async function updateClientNotes(
  businessId: string,
  clientId: string,
  notes: string,
): Promise<void> {
  const { error } = await supabase
    .from("clients")
    .update({ notes: notes.trim() || null })
    .eq("business_id", businessId)
    .eq("id", clientId);
  if (error) throw new Error("Error al guardar nota: " + error.message);
}

export function useUpdateClientNotes(businessId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, notes }: { clientId: string; notes: string }) => {
      if (!businessId) throw new Error("Sin negocio asignado");
      return updateClientNotes(businessId, clientId, notes);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients", businessId] });
      qc.refetchQueries({ queryKey: ["clients", businessId] });
    },
  });
}
