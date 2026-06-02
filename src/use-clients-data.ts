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
  lastVisit?: string | null;
  lastVisitDays?: number | null;
  status: ClientStatus;
  rating: number;
  history: ClientPayment[];
};

export type ClientStatus = "vip" | "nuevo" | "activo" | "inactivo" | "perdido";

function computeStatus(visits: number, spent: number, lastVisitDays: number | null): ClientStatus {
  if (visits === 0 || lastVisitDays === null) return "nuevo";
  if ((visits >= 8 || spent >= 100000) && lastVisitDays <= 60) return "vip";
  if (lastVisitDays <= 60) return "activo";
  if (lastVisitDays <= 90) return "inactivo";
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

  const { data: payments, error: paymentsError } = await supabase
    .from("payments")
    .select("id,client_name,service_name,total,amount,created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (paymentsError)
    throw new Error("Error cargando historial de clientes: " + paymentsError.message);

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

  return rawClients.map((c) => {
    const name = c.full_name ?? "Sin nombre";
    const history = paymentsByName.get(name.trim().toLowerCase()) ?? [];
    const visits = history.length;
    const spent = history.reduce((sum, p) => sum + p.amount, 0);
    const last = history[0]?.date ?? null;
    const lastVisit = formatLastVisit(last);

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
      lastVisit: lastVisit.label,
      lastVisitDays: lastVisit.days,
      status: computeStatus(visits, spent, lastVisit.days),
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
    staleTime: 30_000,
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
    onSuccess: (_result, variables) => {
      qc.setQueryData<Client[]>(["clients", businessId], (current) =>
        (current ?? []).map((client) =>
          client.id === variables.clientId
            ? { ...client, notes: variables.notes.trim() || null }
            : client,
        ),
      );
      qc.invalidateQueries({ queryKey: ["clients", businessId] });
    },
  });
}
