import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Datos de la Agenda. Carga turnos (appointments) del rango visible,
 * más empleados, servicios y clientes del business para los pickers.
 *
 * Mantiene los nombres de columnas usados por la app vanilla (app.js):
 *   appointments: id, business_id, client_id, client_name, service_name,
 *     service_price, starts_at, ends_at?, duration_min?, status, employee_id,
 *     notes,    
 *     created_by_name, created_by_role, updated_at
 *   status ∈ pending | confirmed | completed | cancelled | charged | blocked
 */

export type ApptStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "charged"
  | "blocked";

export type Appointment = {
  id: string;
  business_id: string;
  client_id: string | null;
  client_name: string | null;
  service_name: string | null;
  service_price: number | null;
  starts_at: string;
  ends_at: string | null;
  duration_min: number | null;
  status: ApptStatus;
  employee_id: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_by_role: string | null;
  updated_at: string | null;
};

export type Employee = { id: string; full_name: string; name?: string; avatar_url?: string | null };
export type Service = {
  id: string;
  name: string;
  price: number;
  duration: number | null;
};
export type Client = {
  id: string;
  name?: string | null;
  full_name?: string | null;
  phone: string | null;
  email?: string | null;
  birth_date?: string | null;
};

export function useAgendaData(rangeStart: Date, rangeEnd: Date) {
  const { businessId } = useAuth();
  const [loading, setLoading] = React.useState(true);
  const [appointments, setAppointments] = React.useState<Appointment[]>([]);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [services, setServices] = React.useState<Service[]>([]);
  const [clients, setClients] = React.useState<Client[]>([]);
  const [scheduleOpen, setScheduleOpen] = React.useState<number>(8);
  const [scheduleClose, setScheduleClose] = React.useState<number>(22);

  const startIso = rangeStart.toISOString();
  const endIso = rangeEnd.toISOString();

  const load = React.useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const [aRes, eRes, sRes, cRes, bsRes] = await Promise.allSettled([
      supabase
        .from("appointments")
        .select(
          "id,business_id,client_id,client_name,service_name,service_price,starts_at,ends_at,duration_min,status,employee_id,notes,created_by_name,created_by_role,updated_at",
        )
        .eq("business_id", businessId)
        .gte("starts_at", startIso)
        .lte("starts_at", endIso)
        .order("starts_at"),
      supabase
        .from("employees")
        .select("id,full_name")
        .eq("business_id", businessId)
        .order("full_name", { ascending: true }),
      supabase
        .from("services")
        .select("id,name,price,duration_min,is_active")
        .eq("business_id", businessId)
        .order("name"),
      supabase
        .from("clients")
        .select("id,full_name,name,phone,email,birth_date")
        .eq("business_id", businessId)
        .order("full_name"),
      supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);

    // Parse schedule hours. Supports both simple shape
    // { open_hour: 11, close_hour: 20 } and weekly shape
    // { mon: { enabled: true, start: "11:00", end: "20:00" }, ... }
    if (bsRes.status === "fulfilled" && !bsRes.value.error) {
      const sched = bsRes.value.data?.schedule;
      if (sched && typeof sched === "object") {
        const schedule = sched as Record<string, any>;
        let open = typeof schedule.open_hour === "number" ? schedule.open_hour : undefined;
        let close = typeof schedule.close_hour === "number" ? schedule.close_hour : undefined;

        if (open === undefined || close === undefined) {
          const enabledDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
            .map((key) => schedule[key])
            .filter((day) => day && day.enabled !== false && day.start && day.end);

          const toHour = (value: string, fallback: number) => {
            const [hh, mm = "0"] = String(value).split(":");
            const h = Number(hh);
            const m = Number(mm);
            if (!Number.isFinite(h)) return fallback;
            return h + (Number.isFinite(m) ? m / 60 : 0);
          };

          if (enabledDays.length) {
            open = Math.floor(Math.min(...enabledDays.map((day) => toHour(day.start, 8))));
            close = Math.ceil(Math.max(...enabledDays.map((day) => toHour(day.end, 22))));
          }
        }

        if (open !== undefined) setScheduleOpen(Math.max(0, Math.min(23, open)));
        if (close !== undefined) setScheduleClose(Math.max(1, Math.min(24, close)));
      }
    }

    setAppointments(
      aRes.status === "fulfilled" && !aRes.value.error
        ? ((aRes.value.data ?? []) as Appointment[])
        : [],
    );
    setEmployees(
      eRes.status === "fulfilled" && !eRes.value.error
        ? ((eRes.value.data ?? []) as Employee[])
        : [],
    );
    const svc =
      sRes.status === "fulfilled" && !sRes.value.error
        ? ((sRes.value.data ?? []) as (Service & { is_active?: boolean })[])
        : [];
    setServices(svc.filter((s) => s.is_active !== false));
    setClients(
      cRes.status === "fulfilled" && !cRes.value.error
        ? ((cRes.value.data ?? []) as Client[])
        : [],
    );
    setLoading(false);
  }, [businessId, startIso, endIso]);

  React.useEffect(() => {
    load();
  }, [load]);

  return {
    loading,
    businessId,
    appointments,
    employees,
    services,
    clients,
    scheduleOpen,
    scheduleClose,
    refresh: load,
  };
}

// ---------------------------------------------------------------------------
// Mutaciones (portadas de app.js: saveAppointment / cancelAppointment / reschedule)
// ---------------------------------------------------------------------------

export type SaveAppointmentInput = {
  id?: string | null;
  business_id: string;
  client_id?: string | null;
  client_name: string;
  employee_id: string | null;
  service_name: string;
  service_price: number;
  starts_at: string; // ISO
  duration_min: number;
  status?: ApptStatus;
  notes?: string | null;
  created_by_name?: string | null;
  created_by_role?: string | null;
};

export async function saveAppointment(input: SaveAppointmentInput) {
  const ends = new Date(
    new Date(input.starts_at).getTime() + input.duration_min * 60_000,
  ).toISOString();

  const payload: Record<string, unknown> = {
    business_id: input.business_id,
    client_id: input.client_id ?? null,
    client_name: input.client_name,
    employee_id: input.employee_id,
    service_name: input.service_name,
    service_price: input.service_price,
    starts_at: input.starts_at,
    ends_at: ends,
    duration_min: input.duration_min,
    status: input.status ?? "pending",
    notes: input.notes ?? null,
    updated_at: new Date().toISOString(),
  };
  if (!input.id) {
    payload.created_by_name = input.created_by_name ?? null;
    payload.created_by_role = input.created_by_role ?? null;
  }

  const q = input.id
    ? supabase.from("appointments").update(payload).eq("id", input.id).select()
    : supabase.from("appointments").insert(payload).select();
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data?.[0];
}

export async function setAppointmentStatus(id: string, status: ApptStatus) {
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("appointments").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}


export async function markAppointmentDeposit(id: string, currentNotes?: string | null) {
  const hasDeposit = /se(ñ|n)a/i.test(currentNotes || "");
  const nextNotes = hasDeposit
    ? currentNotes || ""
    : [currentNotes, "Seña paga"].filter(Boolean).join("\n");

  const { error } = await supabase
    .from("appointments")
    .update({
      notes: nextNotes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function cancelAppointment(
  id: string,
  by: { userId?: string | null; name?: string | null; role?: string | null },
) {
  const { error } = await supabase
    .from("appointments")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function rescheduleAppointment(
  id: string,
  startsAt: string,
  durationMin: number,
) {
  const ends = new Date(
    new Date(startsAt).getTime() + durationMin * 60_000,
  ).toISOString();
  const { error } = await supabase
    .from("appointments")
    .update({
      starts_at: startsAt,
      ends_at: ends,
      duration_min: durationMin,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
