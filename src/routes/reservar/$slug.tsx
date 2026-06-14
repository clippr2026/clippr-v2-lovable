import { createFileRoute, Link } from "@tanstack/react-router";
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  MapPin,
  Scissors,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/reservar/$slug")({
  head: () => ({
    meta: [
      { title: "Reservar turno — Clippr" },
      { name: "description", content: "Reservá tu turno online en Clippr." },
    ],
  }),
  component: PublicBookingPage,
});

type Business = {
  id: string;
  name: string;
  slug?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  instagram?: string | null;
  logo_url?: string | null;
  avatar_url?: string | null;
  cover_url?: string | null;
  accent_color?: string | null;
};

type Employee = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  is_active?: boolean | null;
  role?: string | null;
};

type Service = {
  id: string;
  name: string;
  price: number | null;
  duration_min?: number | null;
  duration?: number | null;
  is_active?: boolean | null;
};

type Appointment = {
  id: string;
  employee_id: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_min: number | null;
  status: string | null;
};

type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
type DaySchedule = {
  enabled: boolean;
  start: string;
  end: string;
  breakStart?: string;
  breakEnd?: string;
};
type ScheduleMap = Record<DayKey, DaySchedule>;
type BookingStep = "services" | "professional" | "datetime" | "details" | "done";
type ClientFields = Record<"nombre" | "telefono" | "email" | "fecha_nacimiento" | "notas", boolean>;
type LandingColors = { primary?: string; secondary?: string; accent?: string; buttonText?: string };
type LandingTheme = "dark" | "light";

const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DEFAULT_SCHEDULE: ScheduleMap = {
  sun: { enabled: false, start: "11:00", end: "20:00" },
  mon: { enabled: true, start: "11:00", end: "20:00" },
  tue: { enabled: true, start: "11:00", end: "20:00" },
  wed: { enabled: true, start: "11:00", end: "20:00" },
  thu: { enabled: true, start: "11:00", end: "20:00" },
  fri: { enabled: true, start: "11:00", end: "20:00" },
  sat: { enabled: true, start: "11:00", end: "20:00" },
};
const DEFAULT_CLIENT_FIELDS: ClientFields = {
  nombre: true,
  telefono: true,
  email: true,
  fecha_nacimiento: false,
  notas: true,
};

function parseTime(value: string) {
  const [h = "0", m = "0"] = String(value || "0:00").split(":");
  return Number(h) * 60 + Number(m);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatMoney(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDay(date: Date) {
  return date.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "long" });
}

function formatShortDay(date: Date) {
  return date.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function formatTime(date: Date) {
  return date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function normalizeBooleanMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key.trim().length > 0)
      .map(([key, next]) => [key, next !== false]),
  );
}

function extractPublicVisibility(schedule: unknown) {
  if (!schedule || typeof schedule !== "object") {
    return { services: {}, employees: {} } as { services: Record<string, boolean>; employees: Record<string, boolean> };
  }
  const source = schedule as Record<string, unknown>;
  const visibility = (source._publicVisibility ?? {}) as Record<string, unknown>;
  return {
    services: normalizeBooleanMap(visibility.services ?? source._serviceReservable),
    employees: normalizeBooleanMap(visibility.employees ?? source._employeeOnline),
  };
}

function extractClientFields(schedule: unknown): ClientFields {
  if (!schedule || typeof schedule !== "object") return DEFAULT_CLIENT_FIELDS;
  const clientes = (schedule as Record<string, any>)._clientes;
  const fields = clientes && typeof clientes === "object" ? clientes.fields : null;
  if (!fields || typeof fields !== "object") return DEFAULT_CLIENT_FIELDS;
  return {
    nombre: true,
    telefono: true,
    email: fields.email !== false,
    fecha_nacimiento: fields.fecha_nacimiento === true,
    notas: fields.notas === true,
  };
}

function normalizeSchedule(value: unknown): ScheduleMap {
  if (!value || typeof value !== "object") return DEFAULT_SCHEDULE;
  const source = value as Record<string, any>;
  const next = { ...DEFAULT_SCHEDULE };
  for (const key of DAY_KEYS) {
    const day = source[key];
    if (day && typeof day === "object") {
      next[key] = {
        enabled: day.enabled !== false,
        start: typeof day.start === "string" ? day.start : next[key].start,
        end: typeof day.end === "string" ? day.end : next[key].end,
        breakStart: typeof day.breakStart === "string" ? day.breakStart : undefined,
        breakEnd: typeof day.breakEnd === "string" ? day.breakEnd : undefined,
      };
    }
  }
  return next;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

function buildSlots(
  schedule: ScheduleMap,
  appointments: Appointment[],
  employees: Employee[],
  selectedEmployeeId: string | "any" | null,
  duration: number,
  daysAhead = 10,
) {
  const now = new Date();
  const result: Array<{ date: Date; slots: Array<{ time: Date; employeeId: string }> }> = [];
  const pool = selectedEmployeeId && selectedEmployeeId !== "any"
    ? employees.filter((employee) => employee.id === selectedEmployeeId)
    : employees;

  for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
    const date = startOfDay(addMinutes(now, dayOffset * 24 * 60));
    const daySchedule = schedule[DAY_KEYS[date.getDay()]];
    if (!daySchedule?.enabled || pool.length === 0) continue;

    const open = parseTime(daySchedule.start);
    const close = parseTime(daySchedule.end);
    const breakStart = daySchedule.breakStart ? parseTime(daySchedule.breakStart) : null;
    const breakEnd = daySchedule.breakEnd ? parseTime(daySchedule.breakEnd) : null;
    const daySlots: Array<{ time: Date; employeeId: string }> = [];

    for (let minute = open; minute + duration <= close; minute += 30) {
      if (breakStart !== null && breakEnd !== null && minute < breakEnd && minute + duration > breakStart) continue;
      const slotStart = new Date(date);
      slotStart.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
      const slotEnd = addMinutes(slotStart, duration);
      if (slotStart < addMinutes(now, 60)) continue;

      const available = pool.find((employee) => !appointments.some((appt) => {
        if (appt.status === "cancelled") return false;
        if (appt.employee_id !== employee.id) return false;
        const apptStart = new Date(appt.starts_at);
        const apptEnd = appt.ends_at ? new Date(appt.ends_at) : addMinutes(apptStart, Number(appt.duration_min ?? duration));
        return overlaps(slotStart, slotEnd, apptStart, apptEnd);
      }));

      if (available) daySlots.push({ time: slotStart, employeeId: available.id });
    }

    result.push({ date, slots: daySlots.slice(0, 10) });
  }

  return result;
}

function PublicBookingPage() {
  const { slug } = Route.useParams();
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [business, setBusiness] = React.useState<Business | null>(null);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [services, setServices] = React.useState<Service[]>([]);
  const [appointments, setAppointments] = React.useState<Appointment[]>([]);
  const [schedule, setSchedule] = React.useState<ScheduleMap>(DEFAULT_SCHEDULE);
  const [clientFields, setClientFields] = React.useState<ClientFields>(DEFAULT_CLIENT_FIELDS);

  const [step, setStep] = React.useState<BookingStep>("services");
  const [selectedServiceIds, setSelectedServiceIds] = React.useState<string[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = React.useState<string | "any">("any");
  const [professionalLocked, setProfessionalLocked] = React.useState(false);
  const [selectedSlot, setSelectedSlot] = React.useState<{ time: Date; employeeId: string } | null>(null);
  const [clientName, setClientName] = React.useState("");
  const [clientPhone, setClientPhone] = React.useState("");
  const [clientEmail, setClientEmail] = React.useState("");
  const [clientBirthDate, setClientBirthDate] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [landingColors, setLandingColors] = React.useState<LandingColors>({});
  const [landingTheme, setLandingTheme] = React.useState<LandingTheme>("dark");
  const [confirmedBooking, setConfirmedBooking] = React.useState<{
    services: string;
    professional: string;
    date: string;
    time: string;
    duration: number;
    total: number;
    clientName: string;
    clientPhone: string;
    clientEmail?: string;
  } | null>(null);

  const selectedServices = React.useMemo(
    () => selectedServiceIds.map((id) => services.find((service) => service.id === id)).filter(Boolean) as Service[],
    [selectedServiceIds, services],
  );
  const selectedEmployee = employees.find((employee) => employee.id === selectedSlot?.employeeId || employee.id === selectedEmployeeId) ?? null;
  const totalDuration = selectedServices.reduce((sum, service) => sum + (Number(service.duration_min ?? service.duration ?? 30) || 30), 0) || 30;
  const totalPrice = selectedServices.reduce((sum, service) => sum + Number(service.price ?? 0), 0);
  const slots = React.useMemo(
    () => buildSlots(schedule, appointments, employees, selectedEmployeeId, totalDuration, 10),
    [schedule, appointments, employees, selectedEmployeeId, totalDuration],
  );
  const availableDays = React.useMemo(() => slots.filter((day) => day.slots.length > 0), [slots]);
  const [selectedDayIndex, setSelectedDayIndex] = React.useState(0);
  const selectedDay = availableDays[selectedDayIndex] ?? availableDays[0] ?? null;

  React.useEffect(() => {
    setSelectedDayIndex(0);
  }, [selectedEmployeeId, selectedServiceIds.join(","), totalDuration]);

  React.useEffect(() => {
    if (selectedDayIndex > 0 && selectedDayIndex >= availableDays.length) setSelectedDayIndex(0);
  }, [availableDays.length, selectedDayIndex]);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const businessQuery = supabase
          .from("public_booking_businesses")
          .select("id,name,slug,address,phone,email,instagram,logo_url,avatar_url,cover_url,accent_color");
        const { data: businessData, error: businessError } = await (isUuid(slug)
          ? businessQuery.eq("id", slug).maybeSingle()
          : businessQuery.eq("slug", slug).maybeSingle());

        if (businessError) throw new Error(businessError.message);
        if (!businessData) {
          if (!cancelled) setBusiness(null);
          return;
        }

        const businessId = businessData.id as string;
        const start = startOfDay(new Date()).toISOString();
        const end = addMinutes(startOfDay(new Date()), 14 * 24 * 60).toISOString();
        const [employeesWithRoleRes, servicesRes, appointmentsRes, settingsRes] = await Promise.all([
          supabase
            .from("public_booking_employees")
            .select("id,full_name,avatar_url,is_active,role")
            .eq("business_id", businessId)
            .order("full_name", { ascending: true }),
          supabase
            .from("public_booking_services")
            .select("id,name,price,duration_min,is_active")
            .eq("business_id", businessId)
            .order("name", { ascending: true }),
          supabase
            .from("public_booking_appointments")
            .select("id,employee_id,starts_at,ends_at,duration_min,status")
            .eq("business_id", businessId)
            .gte("starts_at", start)
            .lte("starts_at", end),
          supabase
            .from("public_booking_settings")
            .select("schedule")
            .eq("business_id", businessId)
            .maybeSingle(),
        ]);

        // Algunas bases todavía tienen la vista public_booking_employees sin la columna role.
        // Si pedimos role y Supabase devuelve 400, hacemos fallback sin role para que la reserva no caiga.
        const employeesRes = employeesWithRoleRes.error
          ? await supabase
              .from("public_booking_employees")
              .select("id,full_name,avatar_url,is_active")
              .eq("business_id", businessId)
              .order("full_name", { ascending: true })
          : employeesWithRoleRes;

        // La reserva pública no debe mostrar "Página no encontrada" si falla una vista secundaria.
        console.warn("Public booking secondary data", {
          employeesError: employeesRes.error?.message,
          servicesError: servicesRes.error?.message,
          appointmentsError: appointmentsRes.error?.message,
          settingsError: settingsRes.error?.message,
        });

        const settingsSchedule = settingsRes.error ? null : ((settingsRes.data as any)?.schedule ?? null);
        const branding = settingsSchedule && typeof settingsSchedule === "object" ? ((settingsSchedule as Record<string, any>)._branding ?? {}) : {};
        const visibility = extractPublicVisibility(settingsSchedule);
        const visibleEmployees = ((employeesRes.error ? [] : (employeesRes.data ?? [])) as Employee[])
          .filter((employee) => employee.is_active !== false)
          .filter((employee) => visibility.employees[employee.id] !== false);
        const visibleServices = ((servicesRes.error ? [] : (servicesRes.data ?? [])) as Service[])
          .filter((service) => service.is_active !== false)
          .filter((service) => visibility.services[service.id] !== false);

        if (!cancelled) {
          setBusiness(businessData as Business);
          setEmployees(visibleEmployees);
          setServices(visibleServices);
          setAppointments((appointmentsRes.error ? [] : (appointmentsRes.data ?? [])) as Appointment[]);
          setSchedule(normalizeSchedule(settingsSchedule));
          setClientFields(extractClientFields(settingsSchedule));
          setLandingColors((branding.colors && typeof branding.colors === "object" ? branding.colors : {}) as LandingColors);
          setLandingTheme(branding.theme === "light" ? "light" : "dark");

          const params = new URLSearchParams(window.location.search);
          const serviceId = params.get("service");
          const professionalId = params.get("professional");
          if (serviceId && visibleServices.some((service) => service.id === serviceId)) {
            setSelectedServiceIds([serviceId]);
            setStep(professionalId ? "datetime" : "professional");
          }
          if (professionalId && visibleEmployees.some((employee) => employee.id === professionalId)) {
            setSelectedEmployeeId(professionalId);
            setProfessionalLocked(true);
            if (serviceId) setStep("datetime");
          }
        }
      } catch (error) {
        toast.error((error as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  function toggleService(serviceId: string) {
    setSelectedSlot(null);
    setSelectedServiceIds((current) =>
      current.includes(serviceId) ? current.filter((id) => id !== serviceId) : [...current, serviceId],
    );
  }

  function nextFromServices() {
    if (selectedServiceIds.length === 0) return toast.error("Elegí al menos un servicio.");
    setStep(professionalLocked ? "datetime" : "professional");
  }

  async function submitBooking() {
    if (!business || selectedServices.length === 0 || !selectedSlot) return;
    if (!clientName.trim()) return toast.error("Ingresá tu nombre.");
    if (!clientPhone.trim()) return toast.error("Ingresá tu teléfono.");
    if (clientFields.email && !clientEmail.trim()) return toast.error("Ingresá tu email.");
    if (clientFields.fecha_nacimiento && !clientBirthDate) return toast.error("Ingresá tu fecha de nacimiento.");

    const serviceName = selectedServices.map((service) => service.name).join(" + ");
    const serviceList = selectedServices.map((service) => `${service.name} (${formatMoney(service.price)})`).join("\n- ");
    const publicNotes = [
      notes.trim() ? `Notas del cliente: ${notes.trim()}` : null,
      clientEmail.trim() ? `Email: ${clientEmail.trim()}` : null,
      clientBirthDate ? `Fecha de nacimiento: ${clientBirthDate}` : null,
      selectedServices.length > 1 ? `Servicios seleccionados:\n- ${serviceList}` : null,
      "Origen: reserva online",
    ].filter(Boolean).join("\n\n");

    const confirmationSnapshot = {
      services: selectedServices.map((service) => service.name).join(" + "),
      professional: selectedEmployee?.full_name ?? "Sin preferencia",
      date: formatDay(selectedSlot.time),
      time: formatTime(selectedSlot.time),
      duration: totalDuration,
      total: totalPrice,
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim(),
      clientEmail: clientEmail.trim() || undefined,
    };

    setSubmitting(true);
    try {
      const start = selectedSlot.time;
      const directInsertBooking = async () => {
        const { error } = await supabase.from("appointments").insert({
          business_id: business.id,
          client_id: null,
          client_name: clientName.trim(),
          employee_id: selectedSlot.employeeId,
          service_name: serviceName,
          service_price: totalPrice,
          starts_at: start.toISOString(),
          ends_at: addMinutes(start, totalDuration).toISOString(),
          duration_min: totalDuration,
          status: "pending",
          notes: publicNotes || null,
          created_by_name: "Reserva online",
          created_by_role: "public",
          updated_at: new Date().toISOString(),
        } as any);
        if (error) throw error;
      };

      const v2Result = await supabase.rpc("create_public_booking_v2", {
        p_business_id: business.id,
        p_service_ids: selectedServiceIds,
        p_employee_id: selectedSlot.employeeId,
        p_starts_at: start.toISOString(),
        p_client_name: clientName.trim(),
        p_client_phone: clientPhone.trim(),
        p_client_email: clientEmail.trim() || null,
        p_client_birth_date: clientBirthDate || null,
        p_notes: publicNotes || null,
      } as any);

      if (v2Result.error) {
        let fallbackError = v2Result.error;
        if (selectedServices.length === 1) {
          const fallback = await supabase.rpc("create_public_booking", {
            p_business_id: business.id,
            p_service_id: selectedServiceIds[0],
            p_employee_id: selectedSlot.employeeId,
            p_starts_at: start.toISOString(),
            p_client_name: clientName.trim(),
            p_client_phone: clientPhone.trim(),
            p_client_email: clientEmail.trim() || null,
            p_notes: publicNotes || null,
          } as any);
          if (!fallback.error) fallbackError = null as any;
          else fallbackError = fallback.error;
        }
        if (fallbackError) {
          try {
            await directInsertBooking();
          } catch (insertError) {
            const directMessage = (insertError as Error)?.message;
            const rpcMessage = (fallbackError as any)?.message;
            throw new Error(directMessage || rpcMessage || "No se pudo crear la reserva.");
          }
        }
      }

      setConfirmedBooking(confirmationSnapshot);
      setStep("done");
      toast.success("Turno reservado correctamente");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const cPrimary = landingColors.primary || landingColors.secondary || business?.accent_color || "#7c3aed";
  const cSecondary = cPrimary;
  const accent = landingColors.accent || business?.accent_color || "#d6b66a";
  const isLight = landingTheme === "light";
  const accentButtonText = landingColors.buttonText || "#ffffff";

  if (loading) {
    return (
      <main className="min-h-dvh bg-[#09090f] text-white grid place-items-center px-4">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl">
          <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: accent }} />
          <p className="mt-4 text-sm text-white/60">Cargando reservas...</p>
        </div>
      </main>
    );
  }

  if (!business) {
    return (
      <main className="min-h-dvh bg-[#09090f] text-white grid place-items-center px-4">
        <Card className="max-w-md border-white/10 bg-white/[0.04] text-white">
          <CardContent className="p-8 text-center">
            <h1 className="text-2xl font-semibold">Página no encontrada</h1>
            <p className="mt-2 text-sm text-white/60">No encontramos este local en Clippr.</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const stepIndex = step === "services" ? 1 : step === "professional" ? 2 : step === "datetime" ? 3 : step === "details" ? 4 : 4;

  return (
    <main
      data-theme={landingTheme}
      className="public-booking min-h-dvh"
      style={{
        ["--accent" as any]: accent,
        ["--c-primary" as any]: cPrimary,
        ["--c-secondary" as any]: cSecondary,
        ["--page-bg" as any]: isLight ? "#f6f7fb" : "#08070c",
        ["--card-bg" as any]: isLight ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.06)",
        ["--text" as any]: isLight ? "#111827" : "#ffffff",
        ["--muted" as any]: isLight ? "rgba(17,24,39,0.62)" : "rgba(255,255,255,0.62)",
        ["--border" as any]: isLight ? "rgba(15,23,42,0.10)" : "rgba(255,255,255,0.10)",
      }}
    >
      <style>{`
        .public-booking { background: var(--page-bg); color: var(--text); }
        .public-booking .booking-card { background: var(--card-bg) !important; border-color: var(--border) !important; color: var(--text) !important; }
        .public-booking[data-theme="light"] [class*="text-white"] { color: var(--text) !important; }
        .public-booking[data-theme="light"] [class*="text-white/"] { color: var(--muted) !important; }
        .public-booking[data-theme="light"] [class*="border-white"] { border-color: var(--border) !important; }
        .public-booking[data-theme="light"] [class*="bg-white/"] { background-color: rgba(255,255,255,0.72) !important; }
      `}</style>
      {submitting ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-md">
          <div className="rounded-3xl border border-white/10 bg-[#09090f] p-8 text-center text-white shadow-2xl">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 via-violet-500 to-fuchsia-500 text-2xl font-black text-white">C</div>
            <Loader2 className="mx-auto mt-5 h-7 w-7 animate-spin" style={{ color: accent }} />
            <p className="mt-4 text-sm text-white/65">Confirmando tu turno...</p>
          </div>
        </div>
      ) : null}
      <section className="relative overflow-hidden border-b border-white/10">
        <div
          className="absolute inset-0"
          style={{
            background:
              isLight ? "radial-gradient(circle at top left, color-mix(in oklch, var(--c-primary) 36%, transparent), transparent 42%), radial-gradient(circle at top right, color-mix(in oklch, var(--c-secondary) 32%, transparent), transparent 42%)" : "radial-gradient(circle at top left, color-mix(in oklch, var(--c-primary) 22%, transparent), transparent 34%), radial-gradient(circle at top right, color-mix(in oklch, var(--c-secondary) 20%, transparent), transparent 34%)",
          }}
        />
        {business.cover_url ? <img src={business.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20 blur-sm" /> : null}
        <div className="relative mx-auto flex max-w-5xl items-center gap-4 px-4 py-8 sm:py-10">
          <Link to="/negocio/$slug" params={{ slug }} className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-white text-xl font-bold text-zinc-950">
            {business.avatar_url || business.logo_url ? <img src={business.avatar_url || business.logo_url || ""} alt={business.name} className="h-full w-full object-cover" /> : business.name.slice(0, 1)}
          </Link>
          <div>
            <p className="text-xs uppercase tracking-[0.3em]" style={{ color: accent }}>Reserva online</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{business.name}</h1>
            {business.address ? <p className="mt-2 flex items-center gap-1 text-sm text-white/60"><MapPin className="h-4 w-4" />{business.address}</p> : null}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-4 py-6 lg:grid-cols-[1fr_330px] lg:items-start">
        <div className="space-y-6">
          <Card className="booking-card border-white/10 bg-white/[0.04] text-white shadow-xl">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-white/50">Paso {stepIndex} de 4</p>
                  <h2 className="text-2xl font-semibold">
                    {step === "services" && "Elegí tus servicios"}
                    {step === "professional" && "Elegí profesional"}
                    {step === "datetime" && "Elegí día y horario"}
                    {step === "details" && "Tus datos"}
                    {step === "done" && "Reserva confirmada"}
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-white/60">{stepIndex}/4</div>
              </div>

              {step !== "services" && step !== "done" ? (
                <button
                  type="button"
                  onClick={() => {
                    if (step === "professional") setStep("services");
                    if (step === "datetime") setStep(professionalLocked ? "services" : "professional");
                    if (step === "details") setStep("datetime");
                  }}
                  className="mt-5 inline-flex items-center gap-1 text-sm text-white/55 hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" /> Volver
                </button>
              ) : null}

              {step === "services" ? (
                <div className="mt-5 space-y-4">
                  <p className="text-sm text-white/60">Podés seleccionar uno o varios servicios.</p>
                  <div className="divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02]">
                    {services.map((service) => {
                      const checked = selectedServiceIds.includes(service.id);
                      return (
                        <button key={service.id} type="button" onClick={() => toggleService(service.id)} className="flex w-full items-center justify-between gap-4 p-4 text-left transition hover:bg-white/[0.04]">
                          <span className="flex min-w-0 items-center gap-3">
                            <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border", checked ? "border-transparent text-white" : "border-white/20")} style={checked ? { background: accent } : undefined}>
                              {checked ? <CheckCircle2 className="h-4 w-4" /> : null}
                            </span>
                            <span>
                              <span className="block font-medium">{service.name}</span>
                              <span className="text-sm text-white/50">{Number(service.duration_min ?? service.duration ?? 30)} min</span>
                            </span>
                          </span>
                          <span className="font-semibold">{formatMoney(service.price)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <Button onClick={nextFromServices} className="w-full rounded-2xl py-6 font-bold text-white hover:brightness-110" style={{ background: accent, color: accentButtonText }}>
                    Continuar
                  </Button>
                </div>
              ) : null}

              {step === "professional" ? (
                <div className="mt-5 space-y-3">
                  <button type="button" onClick={() => { setSelectedEmployeeId("any"); setSelectedSlot(null); setStep("datetime"); }} className="flex w-full items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4 text-left hover:border-white/30">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: `${accent}22`, color: accent }}><UsersRound className="h-6 w-6" /></span>
                    <span><span className="block font-semibold">Sin preferencia</span><span className="text-sm text-white/55">Te asignamos cualquier profesional disponible.</span></span>
                  </button>
                  {employees.map((employee) => (
                    <button key={employee.id} type="button" onClick={() => { setSelectedEmployeeId(employee.id); setSelectedSlot(null); setStep("datetime"); }} className="flex w-full items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4 text-left hover:border-white/30">
                      <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/10">
                        {employee.avatar_url ? <img src={employee.avatar_url} alt={employee.full_name} className="h-full w-full object-cover" /> : <UserRound className="h-6 w-6" />}
                      </span>
                      <span><span className="block font-semibold">{employee.full_name}</span><span className="text-sm text-white/55">{employee.role || "Profesional"}</span></span>
                    </button>
                  ))}
                </div>
              ) : null}

              {step === "datetime" ? (
                <div className="mt-5 space-y-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="inline-flex w-max items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] p-1.5 pr-4">
                      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10">
                        {selectedEmployee?.avatar_url ? <img src={selectedEmployee.avatar_url} alt={selectedEmployee.full_name} className="h-full w-full object-cover" /> : <UserRound className="h-5 w-5" />}
                      </span>
                      <span className="text-base font-semibold">{selectedEmployee?.full_name ?? "Sin preferencia"}</span>
                    </div>
                    <button type="button" className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.04]">
                      <CalendarDays className="h-5 w-5" />
                    </button>
                  </div>

                  <div>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">Seleccioná una fecha</h3>
                      <div className="hidden items-center gap-2 sm:flex">
                        <button type="button" onClick={() => setSelectedDayIndex((index) => Math.max(0, index - 1))} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.08]" aria-label="Fecha anterior"><ChevronLeft className="h-5 w-5" /></button>
                        <button type="button" onClick={() => setSelectedDayIndex((index) => Math.min(Math.max(availableDays.length - 1, 0), index + 1))} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.08]" aria-label="Fecha siguiente"><ChevronRight className="h-5 w-5" /></button>
                      </div>
                    </div>

                    {availableDays.length === 0 ? (
                      <p className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/60">No hay horarios disponibles en los próximos días.</p>
                    ) : (
                      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
                        {availableDays.map((day, index) => {
                          const active = index === selectedDayIndex;
                          const weekday = day.date.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");
                          const month = day.date.toLocaleDateString("es-AR", { month: "short" }).replace(".", "");
                          return (
                            <button
                              key={day.date.toISOString()}
                              type="button"
                              onClick={() => setSelectedDayIndex(index)}
                              className={cn(
                                "flex min-w-[72px] flex-col items-center rounded-2xl border px-4 py-3 text-center transition",
                                active ? "border-transparent text-white shadow-lg" : "border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]",
                              )}
                              style={active ? { background: accent } : undefined}
                            >
                              <span className="text-sm capitalize leading-none">{weekday}</span>
                              <span className="mt-1.5 text-2xl font-bold leading-none">{day.date.getDate()}</span>
                              <span className="mt-1.5 text-sm lowercase leading-none">{month}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {selectedDay ? (
                    <div>
                      <h3 className="mb-3 text-xl font-semibold tracking-tight sm:text-2xl">Elegí una hora</h3>
                      <div className="space-y-3">
                        {selectedDay.slots.map((slot) => (
                          <button
                            key={`${slot.employeeId}-${slot.time.toISOString()}`}
                            type="button"
                            onClick={() => { setSelectedSlot(slot); setStep("details"); }}
                            className="flex w-full items-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-left text-base font-semibold transition hover:border-white/25 hover:bg-white/[0.08] sm:px-6 sm:py-4"
                          >
                            {formatTime(slot.time)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {step === "details" ? (
                <div className="mt-5 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2"><Label htmlFor="clientName">Nombre *</Label><Input id="clientName" value={clientName} onChange={(event) => setClientName(event.target.value)} className="border-white/10 bg-white/[0.04] text-white" placeholder="Tu nombre" /></div>
                    <div className="space-y-2"><Label htmlFor="clientPhone">Teléfono *</Label><Input id="clientPhone" value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} className="border-white/10 bg-white/[0.04] text-white" placeholder="11 1234-5678" /></div>
                    {clientFields.email ? <div className="space-y-2"><Label htmlFor="clientEmail">Email *</Label><Input id="clientEmail" type="email" value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} className="border-white/10 bg-white/[0.04] text-white" placeholder="tu@email.com" /></div> : null}
                    {clientFields.fecha_nacimiento ? <div className="space-y-2"><Label htmlFor="clientBirthDate">Fecha de nacimiento *</Label><Input id="clientBirthDate" type="date" value={clientBirthDate} onChange={(event) => setClientBirthDate(event.target.value)} className="border-white/10 bg-white/[0.04] text-white" /></div> : null}
                  </div>
                  {clientFields.notas ? <div className="space-y-2"><Label htmlFor="notes">Notas</Label><Textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} className="border-white/10 bg-white/[0.04] text-white" placeholder="Ej: corte bajo, barba marcada..." /></div> : null}
                  <Button disabled={submitting} onClick={submitBooking} className="w-full rounded-2xl py-6 font-bold text-white hover:brightness-110" style={{ background: accent, color: accentButtonText }}>
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Confirmar reserva
                  </Button>
                </div>
              ) : null}

              {step === "done" ? (
                <div className="mt-6 text-center">
                  <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 via-violet-500 to-fuchsia-500 text-2xl font-black text-white shadow-2xl">C</div>
                  <CheckCircle2 className="mx-auto mt-5 h-14 w-14" style={{ color: accent }} />
                  <h3 className="mt-4 text-2xl font-semibold">Turno confirmado</h3>
                  <p className="mt-2 text-sm text-white/60">El turno ya quedó registrado en la agenda de {business.name}.</p>

                  <div className="mx-auto mt-6 max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-left text-sm text-white/70">
                    <p className="font-semibold text-white">Datos de la reserva</p>
                    <div className="mt-4 space-y-2">
                      <p><span className="text-white/45">Cliente:</span> <span className="font-medium text-white">{confirmedBooking?.clientName || clientName}</span></p>
                      <p><span className="text-white/45">Teléfono:</span> <span className="font-medium text-white">{confirmedBooking?.clientPhone || clientPhone}</span></p>
                      {confirmedBooking?.clientEmail || clientEmail ? <p><span className="text-white/45">Email:</span> <span className="font-medium text-white">{confirmedBooking?.clientEmail || clientEmail}</span></p> : null}
                      <p><span className="text-white/45">Servicios:</span> <span className="font-medium text-white">{confirmedBooking?.services || selectedServices.map((service) => service.name).join(" + ")}</span></p>
                      <p><span className="text-white/45">Profesional:</span> <span className="font-medium text-white">{confirmedBooking?.professional || selectedEmployee?.full_name || "Sin preferencia"}</span></p>
                      <p><span className="text-white/45">Fecha:</span> <span className="font-medium text-white">{confirmedBooking?.date || (selectedSlot ? formatDay(selectedSlot.time) : "-")}</span></p>
                      <p><span className="text-white/45">Horario:</span> <span className="font-medium text-white">{confirmedBooking?.time || (selectedSlot ? formatTime(selectedSlot.time) : "-")}</span></p>
                      <p><span className="text-white/45">Duración:</span> <span className="font-medium text-white">{confirmedBooking?.duration ?? totalDuration} min</span></p>
                      <p><span className="text-white/45">Total:</span> <span className="font-semibold text-white">{formatMoney(confirmedBooking?.total ?? totalPrice)}</span></p>
                    </div>
                  </div>

                  <Link to="/negocio/$slug" params={{ slug }} className="mt-6 inline-flex rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold hover:bg-white/5">Volver al perfil</Link>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card className="booking-card border-white/10 bg-white/[0.06] text-white shadow-2xl backdrop-blur-xl">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center gap-2"><CalendarDays className="h-5 w-5" style={{ color: accent }} /><h2 className="text-lg font-semibold">Tu reserva</h2></div>
              <div className="mt-5 space-y-4 text-sm text-white/65">
                <div><p className="text-white/40">Servicios</p><p className="mt-1 font-medium text-white">{selectedServices.length ? selectedServices.map((s) => s.name).join(" + ") : "Sin seleccionar"}</p></div>
                <div><p className="text-white/40">Profesional</p><p className="mt-1 font-medium text-white">{selectedEmployee?.full_name || (selectedEmployeeId === "any" ? "Sin preferencia" : "Sin seleccionar")}</p></div>
                <div><p className="text-white/40">Horario</p><p className="mt-1 font-medium text-white">{selectedSlot ? `${formatShortDay(selectedSlot.time)} · ${formatTime(selectedSlot.time)}` : "Sin seleccionar"}</p></div>
                <div className="flex items-center justify-between border-t border-white/10 pt-4"><span>Total</span><span className="text-lg font-semibold text-white">{formatMoney(totalPrice)}</span></div>
                <div className="flex items-center justify-between"><span>Duración</span><span className="font-semibold text-white">{totalDuration} min</span></div>
              </div>
            </CardContent>
          </Card>
        </aside>
      </section>
    </main>
  );
}
