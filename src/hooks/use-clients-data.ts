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
  acquisitionSource?: string | null;
  acquisitionSourceCustom?: string | null;
  acquisitionCapturedAt?: string | null;
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
    .select(
      "id,full_name,phone,email,notes,birth_date,created_at,acquisition_source,acquisition_source_custom,acquisition_captured_at",
    )
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
      acquisitionSource: c.acquisition_source,
      acquisitionSourceCustom: c.acquisition_source_custom,
      acquisitionCapturedAt: c.acquisition_captured_at,
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
export type ClientSort = "nombre" | "recientes" | "gasto";

const PAGE_SIZE = 30;

type RpcClientRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  visits: number | string;
  spent: number | string;
  last_visit: string | null;
  last_visit_days: number | null;
  status: ClientStatus;
  vip_tag: ClientVipTag;
  total_count: number | string;
};

function rpcToListRow(r: RpcClientRow): ClientListRow {
  return {
    id: r.id,
    name: r.full_name ?? "Sin nombre",
    phone: r.phone,
    email: r.email,
    created_at: r.created_at,
    visits: Number(r.visits ?? 0),
    spent: Number(r.spent ?? 0),
    lastVisit: formatLastVisit(r.last_visit).label,
    lastVisitDays: r.last_visit_days ?? null,
    status: r.status,
    vipTag: r.vip_tag ?? null,
  };
}

async function loadClientsPage(
  businessId: string,
  opts: { search: string; pageParam: number; sort: ClientSort; status?: ClientStatus | null },
): Promise<ClientsPage> {
  const { data, error } = await supabase.rpc("clippr_clients_list", {
    p_business_id: businessId,
    p_search: opts.search.trim().replace(/[%\\]/g, ""),
    p_sort: opts.sort,
    p_status: opts.status ?? null,
    p_limit: PAGE_SIZE,
    p_offset: opts.pageParam * PAGE_SIZE,
  });
  if (error) throw new Error("Error cargando clientes: " + error.message);
  const rows = (data ?? []) as RpcClientRow[];
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { rows: rows.map(rpcToListRow), total };
}

export function useClientsPage(
  businessId: string | null,
  search: string,
  sort: ClientSort,
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

/** One-shot fetch of clients in a given segment (for the "ver todos" modal). */
export async function fetchClientsByStatus(
  businessId: string,
  status: ClientStatus,
  limit = 200,
): Promise<ClientListRow[]> {
  const { data, error } = await supabase.rpc("clippr_clients_list", {
    p_business_id: businessId,
    p_search: "",
    p_sort: "gasto",
    p_status: status,
    p_limit: limit,
    p_offset: 0,
  });
  if (error) return [];
  return ((data ?? []) as RpcClientRow[]).map(rpcToListRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// Segment counts (VIP/Nuevo/Activo/Inactivo/Perdido) computed server-side by the
// clippr_clients_segment_counts RPC. No longer reads every client on the client.
// ─────────────────────────────────────────────────────────────────────────────

export type SegmentSummary = { counts: Record<ClientStatus, number> };

async function loadSegmentSummary(businessId: string): Promise<SegmentSummary> {
  const { data, error } = await supabase.rpc("clippr_clients_segment_counts", {
    p_business_id: businessId,
  });
  if (error) throw new Error("Error cargando resumen de clientes: " + error.message);
  const counts: Record<ClientStatus, number> = { vip: 0, nuevo: 0, activo: 0, inactivo: 0, perdido: 0 };
  ((data ?? []) as Array<{ status: ClientStatus; count: number | string }>).forEach((r) => {
    if (r.status in counts) counts[r.status] = Number(r.count);
  });
  return { counts };
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
    .select(
      "id,full_name,phone,email,notes,birth_date,created_at,acquisition_source,acquisition_source_custom,acquisition_captured_at",
    )
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
    acquisitionSource: c.acquisition_source,
    acquisitionSourceCustom: c.acquisition_source_custom,
    acquisitionCapturedAt: c.acquisition_captured_at,
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
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  acquisitionSource?: string | null;
  acquisitionCustom?: string | null;
};

// El email es el identificador único del cliente: nunca deben existir dos
// clientes con el mismo email dentro de un mismo negocio. Si ya existe uno
// con ese email, no se crea otro — se completa el origen solo si todavía no
// lo tenía guardado (un origen ya guardado nunca se pisa).
async function saveClient(businessId: string, input: NewClientInput): Promise<void> {
  const email = input.email.trim();
  const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();

  const { data: existing, error: lookupError } = await supabase
    .from("clients")
    .select("id, acquisition_source")
    .eq("business_id", businessId)
    .ilike("email", email)
    .maybeSingle();
  if (lookupError) throw new Error("Error al buscar cliente: " + lookupError.message);

  if (existing) {
    if (!existing.acquisition_source && input.acquisitionSource) {
      const { error } = await supabase
        .from("clients")
        .update({
          acquisition_source: input.acquisitionSource,
          acquisition_source_custom: input.acquisitionCustom?.trim() || null,
          acquisition_captured_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (error) throw new Error("Error al guardar cliente: " + error.message);
    }
    return;
  }

  const { error } = await supabase.from("clients").insert({
    business_id: businessId,
    full_name: fullName,
    phone: input.phone.trim() || null,
    email,
    acquisition_source: input.acquisitionSource || null,
    acquisition_source_custom: input.acquisitionCustom?.trim() || null,
    acquisition_captured_at: input.acquisitionSource ? new Date().toISOString() : null,
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
