import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ── Motivos de rechazo ──────────────────────────────────────────────────────
export const REJECT_REASONS = [
  { key: "sin_turnos", label: "No había turnos disponibles" },
  { key: "no_espero", label: "No quiso esperar" },
  { key: "profesional", label: "Quería un profesional específico" },
  { key: "fuera_horario", label: "Llegó fuera del horario" },
  { key: "otro", label: "Otro" },
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number]["key"];

export function reasonLabel(key: string): string {
  return REJECT_REASONS.find((r) => r.key === key)?.label ?? "Otro";
}

// ── Tipos ───────────────────────────────────────────────────────────────────
export type RejectedClient = {
  id: string;
  business_id: string;
  created_at: string;
  rejected_date: string;
  rejected_time: string;
  weekday: number;
  service_id: string | null;
  service_name: string | null;
  reason: string;
  requested_employee_id: string | null;
  requested_employee_name: string | null;
  occupancy_pct: number | null;
  working_professionals: number | null;
  day_appointments: number | null;
  recorded_by: string | null;
};

export type NewRejectedClient = {
  service_id: string | null;
  service_name: string | null;
  reason: RejectReason;
  requested_employee_id: string | null;
  requested_employee_name: string | null;
  occupancy_pct: number | null;
  working_professionals: number | null;
  day_appointments: number | null;
  /** Momento del rechazo. Por defecto, ahora. */
  at?: Date;
};

// ── Helpers de fecha/hora locales (sin UTC, para no desfasar el día) ─────────
export function localDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

async function resolveInsertBusinessId(providedBusinessId: string): Promise<string> {
  // Siempre intentamos confirmar el negocio contra el usuario autenticado.
  // Esto evita enviar un business_id viejo/incorrecto y chocar con RLS.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.id) return providedBusinessId;

  const { data, error } = await supabase
    .from("team_members")
    .select("business_id")
    .eq("auth_user_id", user.id)
    .limit(1);

  if (error) {
    console.warn("[rejected_clients] No se pudo validar business_id contra team_members:", error.message);
    return providedBusinessId;
  }

  const resolvedBusinessId = data?.[0]?.business_id as string | null | undefined;
  return resolvedBusinessId || providedBusinessId;
}

/** Rechazos de un día puntual (para el indicador + historial). */
export function useRejectedByDay(businessId: string | null | undefined, dateISO: string) {
  return useQuery({
    queryKey: ["rejected-clients", "day", businessId, dateISO],
    enabled: !!businessId,
    staleTime: 15_000,
    queryFn: async (): Promise<RejectedClient[]> => {
      const { data, error } = await supabase
        .from("rejected_clients")
        .select("*")
        .eq("business_id", businessId!)
        .eq("rejected_date", dateISO)
        .order("rejected_time", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RejectedClient[];
    },
  });
}

/** Rechazos en un rango (para Dashboard / Asesor IA — Fase 2 y 3). */
export function useRejectedRange(
  businessId: string | null | undefined,
  fromISO: string,
  toISO: string,
) {
  return useQuery({
    queryKey: ["rejected-clients", "range", businessId, fromISO, toISO],
    enabled: !!businessId,
    staleTime: 30_000,
    queryFn: async (): Promise<RejectedClient[]> => {
      const { data, error } = await supabase
        .from("rejected_clients")
        .select("*")
        .eq("business_id", businessId!)
        .gte("rejected_date", fromISO)
        .lte("rejected_date", toISO)
        .order("rejected_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RejectedClient[];
    },
  });
}

/** Registrar un cliente rechazado. Los errores se propagan (sin fallback silencioso). */
export function useInsertRejectedClient(businessId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewRejectedClient): Promise<RejectedClient> => {
      if (!businessId) throw new Error("No hay un negocio activo.");
      const when = input.at ?? new Date();

      // Usuario que registró: parte local del email (no PII del cliente).
      let recordedBy: string | null = null;
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        recordedBy = user?.email ? user.email.split("@")[0] : null;
      } catch {
        /* sin email disponible */
      }

      const resolvedBusinessId = await resolveInsertBusinessId(businessId);

      const row = {
        business_id: resolvedBusinessId,
        rejected_date: localDateISO(when),
        rejected_time: localTime(when),
        weekday: when.getDay(),
        service_id: input.service_id,
        service_name: input.service_name,
        reason: input.reason,
        requested_employee_id: input.requested_employee_id,
        requested_employee_name: input.requested_employee_name,
        occupancy_pct: input.occupancy_pct,
        working_professionals: input.working_professionals,
        day_appointments: input.day_appointments,
        recorded_by: recordedBy,
      };

      console.info("[rejected_clients] insert payload", row);

      // Importante: no encadenar .select().single() después del insert.
      // Con RLS, el INSERT puede estar permitido pero el RETURNING/SELECT posterior
      // puede devolver 403. Para esta acción alcanza con guardar y luego invalidar queries.
      const { error } = await supabase.from("rejected_clients").insert(row);
      if (error) {
        console.error("[rejected_clients] insert error", error);
        throw new Error(error.message || "No se pudo registrar el cliente rechazado.");
      }

      return {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        ...row,
      } as RejectedClient;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rejected-clients"] });
    },
  });
}
