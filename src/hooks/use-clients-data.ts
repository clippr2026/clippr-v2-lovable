import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Portado de loadClients() / saveNewClient() de app.js.
 * Misma tabla `clients`, mismos campos, mismo filtro por business_id.
 */

export type Client = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  birth_date?: string | null;
  created_at: string;
  // Computed from appointments/payments
  visits: number;
  spent: number;
  lastVisit?: string | null;
  status: ClientStatus;
  rating: number;
};

export type ClientStatus = "vip" | "nuevo" | "activo" | "inactivo" | "perdido";

function computeStatus(visits: number, lastVisitDays: number | null): ClientStatus {
  if (visits === 0 || lastVisitDays === null) return "nuevo";
  if (visits >= 8 && lastVisitDays <= 45) return "vip";
  if (lastVisitDays <= 45) return "activo";
  if (lastVisitDays <= 90) return "inactivo";
  return "perdido";
}

function computeRating(visits: number, spent: number): number {
  if (visits >= 10 || spent >= 80000) return 5;
  if (visits >= 6 || spent >= 40000) return 4;
  if (visits >= 3 || spent >= 15000) return 3;
  if (visits >= 1) return 2;
  return 0;
}

async function loadClients(businessId: string): Promise<Client[]> {
  // Fetch clients
  const { data: rawClients, error } = await supabase
    .from("clients")
    .select("id,full_name,phone,email,notes,birth_date,created_at")
    .eq("business_id", businessId)
    .order("full_name");

  if (error) throw new Error("Error cargando clientes: " + error.message);
  if (!rawClients?.length) return [];

  // Fetch payments per client for stats (last 12 months)
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);

  const { data: payments } = await supabase
    .from("payments")
    .select("client_name,total,created_at")
    .eq("business_id", businessId)
    .gte("created_at", since.toISOString());

  const paymentsByName = new Map<string, { total: number; dates: string[] }>();
  (payments ?? []).forEach((p) => {
    const key = (p.client_name ?? "").trim().toLowerCase();
    if (!key) return;
    if (!paymentsByName.has(key)) paymentsByName.set(key, { total: 0, dates: [] });
    const entry = paymentsByName.get(key)!;
    entry.total += Number(p.total ?? 0);
    entry.dates.push(p.created_at);
  });

  const now = Date.now();

  return rawClients.map((c) => {
    const key = (c.full_name ?? "").trim().toLowerCase();
    const stats = paymentsByName.get(key);
    const visits = stats?.dates.length ?? 0;
    const spent = stats?.total ?? 0;

    let lastVisitDays: number | null = null;
    let lastVisitStr: string | null = null;
    if (stats?.dates.length) {
      const latest = stats.dates.reduce((a, b) => (a > b ? a : b));
      const diffMs = now - new Date(latest).getTime();
      lastVisitDays = Math.floor(diffMs / 86_400_000);
      if (lastVisitDays === 0) lastVisitStr = "hoy";
      else if (lastVisitDays === 1) lastVisitStr = "ayer";
      else if (lastVisitDays < 7) lastVisitStr = `hace ${lastVisitDays} días`;
      else if (lastVisitDays < 30) lastVisitStr = `hace ${Math.round(lastVisitDays / 7)} sem.`;
      else lastVisitStr = `hace ${Math.round(lastVisitDays / 30)} meses`;
    }

    return {
      id: c.id,
      name: c.full_name ?? "Sin nombre",
      phone: c.phone,
      email: c.email,
      notes: c.notes,
      birth_date: c.birth_date,
      created_at: c.created_at,
      visits,
      spent,
      lastVisit: lastVisitStr,
      status: computeStatus(visits, lastVisitDays),
      rating: computeRating(visits, spent),
    };
  });
}

export function useClientsData(businessId: string | null) {
  return useQuery({
    queryKey: ["clients", businessId],
    queryFn: () => loadClients(businessId!),
    enabled: !!businessId,
    staleTime: 30_000,
  });
}

// ── Save new client (portado de saveNewClient() en app.js) ────────────────

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
    },
  });
}
