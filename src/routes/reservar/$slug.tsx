import { createFileRoute, Link } from "@tanstack/react-router";
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
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
type BookingStep = "services" | "professional" | "datetime" | "details" | "confirm" | "done";
type ClientFields = Record<"nombre" | "telefono" | "email" | "fecha_nacimiento" | "notas", boolean>;
type LandingColors = { primary?: string; secondary?: string; accent?: string };

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

function extractBranding(schedule: unknown): { colors?: LandingColors | null; address?: string | null; phone?: string | null; email?: string | null; instagram?: string | null } {
  if (!schedule || typeof schedule !== "object") return {};
  const branding = (schedule as Record<string, any>)._branding;
  return branding && typeof branding === "object" ? branding : {};
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
  const [colors, setColors] = React.useState<LandingColors>({});

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
        const [employeesRes, servicesRes, appointmentsRes, settingsRes] = await Promise.all([
          supabase
            .from("public_booking_employees")
            .select("id,full_name,avatar_url,is_active")
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

        if (employeesRes.error) throw new Error(employeesRes.error.message);
        if (servicesRes.error) throw new Error(servicesRes.error.message);
        if (appointmentsRes.error) throw new Error(appointmentsRes.error.message);

        const settingsSchedule = settingsRes.error ? null : ((settingsRes.data as any)?.schedule ?? null);
        const branding = extractBranding(settingsSchedule);
        const visibility = extractPublicVisibility(settingsSchedule);
        const visibleEmployees = ((employeesRes.data ?? []) as Employee[])
          .filter((employee) => employee.is_active !== false)
          .filter((employee) => visibility.employees[employee.id] !== false);
        const visibleServices = ((servicesRes.data ?? []) as Service[])
          .filter((service) => service.is_active !== false)
          .filter((service) => visibility.services[service.id] !== false);

        if (!cancelled) {
          setBusiness({
            ...(businessData as Business),
            address: branding.address || (businessData as Business).address,
            phone: branding.phone || (businessData as Business).phone,
            email: branding.email || (businessData as Business).email,
            instagram: branding.instagram || (businessData as Business).instagram,
          } as Business);
          setColors((branding.colors && typeof branding.colors === "object" ? branding.colors : {}) as LandingColors);
          setEmployees(visibleEmployees);
          setServices(visibleServices);
          setAppointments((appointmentsRes.data ?? []) as Appointment[]);
          setSchedule(normalizeSchedule(settingsSchedule));
          setClientFields(extractClientFields(settingsSchedule));

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

    setSubmitting(true);
    try {
      const start = selectedSlot.time;
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
        if (selectedServices.length > 1) throw new Error(v2Result.error.message);
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
        if (fallback.error) throw new Error(fallback.error.message);
      }

      setStep("done");
      toast.success("Turno reservado correctamente");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const cPrimary = colors.primary || business?.accent_color || "#d6b66a";
  const cSecondary = colors.secondary || "#7c3aed";
  const cAccent = colors.accent || cPrimary;
  const accent = cAccent;

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

  const stepIndex = step === "services" ? 1 : step === "professional" ? 2 : step === "datetime" ? 3 : step === "details" ? 4 : step === "confirm" ? 5 : 5;

  return (
    <main className="min-h-dvh bg-[#08070c] text-white" style={{ ["--accent" as any]: accent, ["--c-primary" as any]: cPrimary, ["--c-secondary" as any]: cSecondary, ["--c-accent" as any]: cAccent }}>
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0" style={{ background: "radial-gradient(circle at top left, color-mix(in oklch, var(--c-primary) 22%, transparent), transparent 36%), radial-gradient(circle at top right, color-mix(in oklch, var(--c-secondary) 20%, transparent), transparent 36%)" }} />
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
          <Card className="border-white/10 bg-white/[0.04] text-white shadow-xl">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-white/50">Paso {stepIndex} de 5</p>
                  <h2 className="text-2xl font-semibold">
                    {step === "services" && "Elegí tus servicios"}
                    {step === "professional" && "Elegí profesional"}
                    {step === "datetime" && "Elegí día y horario"}
                    {step === "details" && "Tus datos"}
                    {step === "confirm" && "Confirmá tu reserva"}
                    {step === "done" && "Reserva confirmada"}
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-white/60">{stepIndex}/5</div>
              </div>

              {step !== "services" && step !== "done" ? (
                <button
                  type="button"
                  onClick={() => {
                    if (step === "professional") setStep("services");
                    if (step === "datetime") setStep(professionalLocked ? "services" : "professional");
                    if (step === "details") setStep("datetime");
                    if (step === "confirm") setStep("details");
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
                            <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border", checked ? "border-transparent text-zinc-950" : "border-white/20")} style={checked ? { background: accent } : undefined}>
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
                  <Button onClick={nextFromServices} className="w-full rounded-2xl py-6 font-bold text-zinc-950 hover:brightness-110" style={{ background: accent }}>
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
                <div className="mt-5 space-y-5">
                  {slots.every((day) => day.slots.length === 0) ? <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/60">No hay horarios disponibles en los próximos días.</p> : null}
                  {slots.map((day) => day.slots.length ? (
                    <div key={day.date.toISOString()}>
                      <p className="mb-2 text-sm font-semibold text-white/75 capitalize">{formatShortDay(day.date)}</p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {day.slots.map((slot) => (
                          <button key={`${slot.employeeId}-${slot.time.toISOString()}`} type="button" onClick={() => { setSelectedSlot(slot); setStep("details"); }} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm hover:border-white/30" style={selectedSlot?.time.toISOString() === slot.time.toISOString() ? { borderColor: accent, color: accent } : undefined}>
                            {formatTime(slot.time)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null)}
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
                  <Button onClick={() => setStep("confirm")} className="w-full rounded-2xl py-6 font-bold text-zinc-950 hover:brightness-110" style={{ background: accent }}>Continuar</Button>
                </div>
              ) : null}

              {step === "confirm" ? (
                <div className="mt-5 space-y-4">
                  <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
                    <p className="font-semibold text-white">Resumen</p>
                    <p className="mt-3">Servicios: {selectedServices.map((service) => service.name).join(" + ")}</p>
                    <p>Profesional: {selectedEmployee?.full_name ?? "Sin preferencia"}</p>
                    <p>Horario: {selectedSlot ? `${formatDay(selectedSlot.time)} · ${formatTime(selectedSlot.time)}` : "-"}</p>
                    <p>Duración: {totalDuration} min</p>
                    <p>Total estimado: {formatMoney(totalPrice)}</p>
                  </div>
                  <Button disabled={submitting} onClick={submitBooking} className="w-full rounded-2xl py-6 font-bold text-zinc-950 hover:brightness-110" style={{ background: accent }}>
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Confirmar reserva
                  </Button>
                </div>
              ) : null}

              {step === "done" ? (
                <div className="mt-6 text-center">
                  <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-300" />
                  <h3 className="mt-4 text-2xl font-semibold">Turno reservado</h3>
                  <p className="mt-2 text-sm text-white/60">El turno ya quedó registrado en la agenda de {business.name}.</p>
                  <Link to="/negocio/$slug" params={{ slug }} className="mt-6 inline-flex rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold hover:bg-white/5">Volver al perfil</Link>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card className="border-white/10 bg-white/[0.06] text-white shadow-2xl backdrop-blur-xl">
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
