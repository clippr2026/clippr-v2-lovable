import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  isNewThisMonth: boolean;
  vipTag: ClientVipTag;
  rating: number;
  history: ClientPayment[];
};

export type ClientStatus = "vip" | "nuevo" | "activo" | "inactivo" | "perdido";

const ACTIVE_DAYS = 45;
const LOST_FROM_DAYS = 76;

function isCurrentMonth(date: string | null | undefined): boolean {
  if (!date) return false;
  const value = new Date(date);
  const now = new Date();
  return (
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth()
  );
}

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
  isNewThisMonth: boolean,
): ClientStatus {
  if (isNewThisMonth) return "nuevo";
  if (vipTag === "vip") return "vip";
  if (lastVisitDays === null) return "perdido";
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
    const firstVisitDate = history[history.length - 1]?.date ?? null;
    // Nuevo = primera visita dentro del mes vigente, aunque haya vuelto más veces en el mismo mes.
    const isNewThisMonth = isCurrentMonth(firstVisitDate);
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
      isNewThisMonth,
      vipTag,
      status: computeStatus(visits, lastVisit.days, vipTag, isNewThisMonth),
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

// ─────────────────────────────────────────────────────────────────────────────
// Paginated + server-side searched list (uses the trigram indexes via ILIKE).
// Only the requested page of clients is enriched, so we never load every client
// (and their full payment history) just to open the module.
// ─────────────────────────────────────────────────────────────────────────────

export type ClientListRow = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  created_at: string;
  visits: number;
  spent: number;
  lastVisit: string | null;
  lastVisitDays: number | null;
  status: ClientStatus;
  vipTag: ClientVipTag;
};

export type ClientsPage = { rows: ClientListRow[]; total: number };

function rowFromHistory(
  c: { id: string; full_name: string | null; phone: string | null; email: string | null; created_at: string },
  history: ClientPayment[],
): ClientListRow {
  const visits = history.length;
  const spent = history.reduce((s, p) => s + p.amount, 0);
  const last = history[0]?.date ?? null;
  const firstVisitDate = history[history.length - 1]?.date ?? null;
  const isNewThisMonth = isCurrentMonth(firstVisitDate);
  const lastVisit = formatLastVisit(last);
  const vipTag = computeVipTag(history);
  return {
    id: c.id,
    name: c.full_name ?? "Sin nombre",
    phone: c.phone,
    email: c.email,
    created_at: c.created_at,
    visits,
    spent,
    lastVisit: lastVisit.label,
    lastVisitDays: lastVisit.days,
    vipTag,
    status: computeStatus(visits, lastVisit.days, vipTag, isNewThisMonth),
  };
}

const PAGE_SIZE = 30;

async function loadClientsPage(
  businessId: string,
  opts: { search: string; pageParam: number; sort: "nombre" | "recientes" },
): Promise<ClientsPage> {
  const from = opts.pageParam * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let q = supabase
    .from("clients")
    .select("id,full_name,phone,email,created_at", { count: "exact" })
    .eq("business_id", businessId);

  const search = opts.search.trim();
  if (search) {
    const s = search.replace(/[%,()]/g, " ").trim();
    // ILIKE across name/phone/email — accelerated by the pg_trgm GIN indexes.
    q = q.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`);
  }

  q = opts.sort === "recientes"
    ? q.order("created_at", { ascending: false })
    : q.order("full_name", { ascending: true });

  const { data: rawClients, error, count } = await q.range(from, to);
  if (error) throw new Error("Error cargando clientes: " + error.message);
  const rows = rawClients ?? [];
  if (!rows.length) return { rows: [], total: count ?? 0 };

  // Enrich ONLY this page's clients with their payment history (matched by name).
  const names = Array.from(new Set(rows.map((c) => c.full_name).filter(Boolean))) as string[];
  const { data: payments } = await supabase
    .from("payments")
    .select("id,client_name,service_name,total,amount,created_at")
    .eq("business_id", businessId)
    .in("client_name", names)
    .order("created_at", { ascending: false });

  const byName = new Map<string, ClientPayment[]>();
  (payments ?? []).forEach((p) => {
    const key = (p.client_name ?? "").trim().toLowerCase();
    if (!key) return;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push({
      id: p.id,
      date: p.created_at,
      service: p.service_name || "Servicio",
      amount: Number(p.total ?? p.amount ?? 0),
    });
  });

  return {
    rows: rows.map((c) => rowFromHistory(c, byName.get((c.full_name ?? "").trim().toLowerCase()) ?? [])),
    total: count ?? rows.length,
  };
}

export function useClientsPage(
  businessId: string | null,
  search: string,
  sort: "nombre" | "recientes",
) {
  return useInfiniteQuery({
    queryKey: ["clients-page", businessId, search, sort],
    enabled: !!businessId,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => loadClientsPage(businessId!, { search, pageParam: pageParam as number, sort }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((n, p) => n + p.rows.length, 0);
      return loaded < lastPage.total ? pages.length : undefined;
    },
    staleTime: 30_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight segment summary for the top stat cards (VIP/Nuevos/…) and the
// "ver todos" groups. Loads minimal columns for ALL clients + minimal payment
// columns to compute status, without building the full rich Client objects.
// ─────────────────────────────────────────────────────────────────────────────

export type SegmentSummary = {
  counts: Record<ClientStatus, number>;
  byStatus: Record<ClientStatus, ClientListRow[]>;
};

async function loadSegmentSummary(businessId: string): Promise<SegmentSummary> {
  const [{ data: clients, error: cErr }, { data: payments, error: pErr }] = await Promise.all([
    supabase.from("clients").select("id,full_name,phone,email,created_at").eq("business_id", businessId),
    supabase.from("payments").select("client_name,total,amount,created_at").eq("business_id", businessId).order("created_at", { ascending: false }),
  ]);
  if (cErr) throw new Error("Error cargando resumen de clientes: " + cErr.message);
  if (pErr) throw new Error("Error cargando resumen de pagos: " + pErr.message);

  const byName = new Map<string, ClientPayment[]>();
  (payments ?? []).forEach((p) => {
    const key = (p.client_name ?? "").trim().toLowerCase();
    if (!key) return;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push({ id: "", date: p.created_at, service: "", amount: Number(p.total ?? p.amount ?? 0) });
  });

  const counts: Record<ClientStatus, number> = { vip: 0, nuevo: 0, activo: 0, inactivo: 0, perdido: 0 };
  const byStatus: Record<ClientStatus, ClientListRow[]> = { vip: [], nuevo: [], activo: [], inactivo: [], perdido: [] };

  (clients ?? []).forEach((c) => {
    const row = rowFromHistory(c, byName.get((c.full_name ?? "").trim().toLowerCase()) ?? []);
    counts[row.status] += 1;
    byStatus[row.status].push(row);
  });

  return { counts, byStatus };
}

export function useClientSegmentSummary(businessId: string | null) {
  return useQuery({
    queryKey: ["clients-summary", businessId],
    queryFn: () => loadSegmentSummary(businessId!),
    enabled: !!businessId,
    staleTime: 30_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// On-demand full enrichment for the selected client (detail panel).
// ─────────────────────────────────────────────────────────────────────────────

async function loadClientDetail(businessId: string, clientId: string): Promise<Client | null> {
  const { data: c, error } = await supabase
    .from("clients")
    .select("id,full_name,phone,email,notes,birth_date,created_at")
    .eq("business_id", businessId)
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error("Error cargando cliente: " + error.message);
  if (!c) return null;

  const name = c.full_name ?? "Sin nombre";
  const [{ data: payments }, { data: appointments }] = await Promise.all([
    supabase.from("payments").select("id,client_name,service_name,total,amount,created_at")
      .eq("business_id", businessId).eq("client_name", name).order("created_at", { ascending: false }),
    supabase.from("appointments").select("id,client_id,client_name,service_name,starts_at,status")
      .eq("business_id", businessId).eq("client_id", clientId)
      .gte("starts_at", new Date().toISOString()).neq("status", "cancelled")
      .order("starts_at", { ascending: true }).limit(1),
  ]);

  const history: ClientPayment[] = (payments ?? []).map((p) => ({
    id: p.id, date: p.created_at, service: p.service_name || "Servicio", amount: Number(p.total ?? p.amount ?? 0),
  }));
  const visits = history.length;
  const spent = history.reduce((s, p) => s + p.amount, 0);
  const last12Cutoff = new Date(); last12Cutoff.setMonth(last12Cutoff.getMonth() - 12);
  const spentLast12Months = history.filter((p) => new Date(p.date).getTime() >= last12Cutoff.getTime()).reduce((s, p) => s + p.amount, 0);
  const favMap = new Map<string, { count: number; amount: number }>();
  history.forEach((p) => {
    const cur = favMap.get(p.service) ?? { count: 0, amount: 0 };
    favMap.set(p.service, { count: cur.count + 1, amount: cur.amount + p.amount });
  });
  const favoriteServices = Array.from(favMap.entries()).map(([service, v]) => ({ service, ...v }))
    .sort((a, b) => b.count - a.count || b.amount - a.amount).slice(0, 3);
  const appt = appointments?.[0];
  const nextAppointment = appt ? { id: appt.id, date: appt.starts_at, service: appt.service_name || "Servicio", status: appt.status || "pending" } : null;
  const lastDate = history[0]?.date ?? null;
  const firstVisitDate = history[history.length - 1]?.date ?? null;
  const isNewThisMonth = isCurrentMonth(firstVisitDate);
  const lastVisit = formatLastVisit(lastDate);
  const vipTag = computeVipTag(history);

  return {
    id: c.id, name, phone: c.phone, email: c.email, notes: c.notes, birth_date: c.birth_date, created_at: c.created_at,
    visits, spent, spentLast12Months, favoriteServices, nextAppointment,
    lastVisit: lastVisit.label, lastVisitDays: lastVisit.days, isNewThisMonth, vipTag,
    status: computeStatus(visits, lastVisit.days, vipTag, isNewThisMonth),
    rating: computeRating(visits, spent, lastVisit.days), history,
  };
}

export function useClientDetail(businessId: string | null, clientId: string | null) {
  return useQuery({
    queryKey: ["client-detail", businessId, clientId],
    queryFn: () => loadClientDetail(businessId!, clientId!),
    enabled: !!businessId && !!clientId,
    staleTime: 15_000,
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
      qc.invalidateQueries({ queryKey: ["clients-page", businessId] });
      qc.invalidateQueries({ queryKey: ["clients-summary", businessId] });
      qc.invalidateQueries({ queryKey: ["client-detail", businessId] });
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
      qc.invalidateQueries({ queryKey: ["clients-page", businessId] });
      qc.invalidateQueries({ queryKey: ["clients-summary", businessId] });
      qc.invalidateQueries({ queryKey: ["client-detail", businessId] });
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
      qc.invalidateQueries({ queryKey: ["clients-page", businessId] });
      qc.invalidateQueries({ queryKey: ["clients-summary", businessId] });
      qc.invalidateQueries({ queryKey: ["client-detail", businessId] });
    },
  });
}
