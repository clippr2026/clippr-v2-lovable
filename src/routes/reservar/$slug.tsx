import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Award,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  Heart,
  Loader2,
  MapPin,
  Scissors,
  Sparkles,
  Star,
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
  accent_color?: string | null;
};

type Employee = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  is_active?: boolean | null;
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

type BookingStep = "service" | "professional" | "datetime" | "details" | "done";

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
  return date.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function formatTime(date: Date) {
  return date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
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
  serviceDuration: number,
  daysAhead = 7,
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

    for (let minute = open; minute + serviceDuration <= close; minute += 30) {
      if (breakStart !== null && breakEnd !== null && minute < breakEnd && minute + serviceDuration > breakStart) {
        continue;
      }
      const slotStart = new Date(date);
      slotStart.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
      const slotEnd = addMinutes(slotStart, serviceDuration);
      if (slotStart < addMinutes(now, 60)) continue;

      const available = pool.find((employee) => {
        return !appointments.some((appt) => {
          if (appt.status === "cancelled" || appt.status === "blocked") return false;
          if (appt.employee_id !== employee.id) return false;
          const apptStart = new Date(appt.starts_at);
          const apptEnd = appt.ends_at
            ? new Date(appt.ends_at)
            : addMinutes(apptStart, Number(appt.duration_min ?? serviceDuration));
          return overlaps(slotStart, slotEnd, apptStart, apptEnd);
        });
      });

      if (available) {
        daySlots.push({ time: slotStart, employeeId: available.id });
      }
    }

    result.push({ date, slots: daySlots.slice(0, 8) });
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

  const [step, setStep] = React.useState<BookingStep>("service");
  const [selectedServiceId, setSelectedServiceId] = React.useState<string>("");
  const [selectedEmployeeId, setSelectedEmployeeId] = React.useState<string | "any">("any");
  const [selectedSlot, setSelectedSlot] = React.useState<{ time: Date; employeeId: string } | null>(null);
  const [clientName, setClientName] = React.useState("");
  const [clientPhone, setClientPhone] = React.useState("");
  const [clientEmail, setClientEmail] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const selectedService = services.find((service) => service.id === selectedServiceId) ?? null;
  const selectedEmployee = employees.find((employee) => employee.id === selectedSlot?.employeeId || employee.id === selectedEmployeeId) ?? null;
  const serviceDuration = Number(selectedService?.duration_min ?? selectedService?.duration ?? 30) || 30;
  const slots = React.useMemo(
    () => buildSlots(schedule, appointments, employees, selectedEmployeeId, serviceDuration, 8),
    [schedule, appointments, employees, selectedEmployeeId, serviceDuration],
  );

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const businessQuery = supabase
          .from("public_booking_businesses")
          .select("id,name,slug,address,phone,email,instagram,logo_url,accent_color");

        const isUuidSlug = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
        const { data: businessData, error: businessError } = await (isUuidSlug
          ? businessQuery.eq("id", slug).maybeSingle()
          : businessQuery.eq("slug", slug).maybeSingle());

        if (businessError) throw new Error(businessError.message);
        if (!businessData) {
          if (!cancelled) setBusiness(null);
          return;
        }

        const businessId = businessData.id as string;
        const start = startOfDay(new Date()).toISOString();
        const end = addMinutes(startOfDay(new Date()), 10 * 24 * 60).toISOString();
        const [employeesRes, servicesRes, appointmentsRes] = await Promise.all([
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

        ]);

        if (employeesRes.error) throw new Error(employeesRes.error.message);
        if (servicesRes.error) throw new Error(servicesRes.error.message);
        if (appointmentsRes.error) throw new Error(appointmentsRes.error.message);

        if (!cancelled) {
          setBusiness(businessData as Business);
          setEmployees(((employeesRes.data ?? []) as Employee[]).filter((employee) => employee.is_active !== false));
          setServices(((servicesRes.data ?? []) as Service[]).filter((service) => service.is_active !== false));
          setAppointments((appointmentsRes.data ?? []) as Appointment[]);
          setSchedule(DEFAULT_SCHEDULE);
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

  async function submitBooking() {
    if (!business || !selectedService || !selectedSlot) return;
    if (!clientName.trim()) return toast.error("Ingresá tu nombre.");
    if (!clientPhone.trim()) return toast.error("Ingresá tu teléfono.");

    setSubmitting(true);
    try {
      const start = selectedSlot.time;
      const { error: bookingError } = await supabase.rpc("create_public_booking", {
        p_business_id: business.id,
        p_service_id: selectedService.id,
        p_employee_id: selectedSlot.employeeId,
        p_starts_at: start.toISOString(),
        p_client_name: clientName.trim(),
        p_client_phone: clientPhone.trim(),
        p_client_email: clientEmail.trim() || null,
        p_notes: notes.trim() || null,
      });
      if (bookingError) throw new Error(bookingError.message);

      setStep("done");
      toast.success("Turno reservado correctamente");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-dvh bg-[#09090f] text-white grid place-items-center px-4">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-amber-300" />
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

  return (
    <main className="min-h-dvh bg-[#09090f] text-white">
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.28),transparent_34%),radial-gradient(circle_at_top_right,rgba(124,58,237,0.22),transparent_32%)]" />
        <div className="relative mx-auto max-w-6xl px-4 py-6 sm:py-10">
          <div className="h-40 rounded-[2rem] border border-white/10 bg-gradient-to-br from-zinc-800 via-zinc-950 to-amber-950/50 shadow-2xl sm:h-56" />
          <div className="-mt-12 flex flex-col gap-4 px-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between sm:px-8">
            <div className="flex items-end gap-4">
              <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-3xl border-4 border-[#09090f] bg-white text-3xl font-bold text-zinc-950 shadow-xl">
                {business.logo_url ? <img src={business.logo_url} alt={business.name} className="h-full w-full object-cover" /> : business.name.slice(0, 1)}
              </div>
              <div className="pb-2">
                <p className="text-xs uppercase tracking-[0.3em] text-amber-200/80">Reservas online</p>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{business.name}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white/70">
                  {business.address ? <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" /> {business.address}</span> : null}
                  <span className="inline-flex items-center gap-1"><Star className="h-4 w-4 fill-amber-300 text-amber-300" /> 4.9</span>
                  <span className="inline-flex items-center gap-1"><Heart className="h-4 w-4 text-rose-300" /> Favorito de 2.000 clientes</span>
                </div>
              </div>
            </div>
            <Button className="rounded-2xl bg-amber-400 px-6 py-6 text-base font-bold text-zinc-950 hover:bg-amber-300" onClick={() => document.getElementById("booking-flow")?.scrollIntoView({ behavior: "smooth" })}>
              Reservar ahora
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_390px]">
        <div className="space-y-6">
          <Card className="border-white/10 bg-white/[0.04] text-white shadow-xl">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-white/50">Equipo</p>
                  <h2 className="text-2xl font-semibold">Elegí tu profesional</h2>
                </div>
                <Sparkles className="h-6 w-6 text-amber-300" />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {employees.map((employee, index) => (
                  <button
                    key={employee.id}
                    type="button"
                    onClick={() => {
                      setSelectedEmployeeId(employee.id);
                      setStep("datetime");
                    }}
                    className={cn(
                      "rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:border-amber-300/60 hover:bg-white/[0.07]",
                      selectedEmployeeId === employee.id ? "border-amber-300/70 bg-amber-300/10" : "border-white/10 bg-white/[0.03]",
                    )}
                  >
                    <div className="flex gap-3">
                      <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/10 text-lg font-semibold">
                        {employee.avatar_url ? <img src={employee.avatar_url} alt={employee.full_name} className="h-full w-full object-cover" /> : employee.full_name.slice(0, 1)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{employee.full_name}</h3>
                          {index === 0 ? <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-[11px] text-amber-200">Top</span> : null}
                        </div>
                        <p className="mt-1 text-sm text-white/60">💬 Últimos turnos para hoy</p>
                        <p className="mt-2 text-xs text-white/45">🏆 Profesional destacado de junio</p>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-white/70">
                          <span>⭐ 4.9</span>
                          <span>❤️ 523 favoritos</span>
                          <span>✂ 295 citas</span>
                          <span>👥 164 clientes</span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.04] text-white shadow-xl">
            <CardContent className="p-5 sm:p-6">
              <h2 className="text-2xl font-semibold">Mis mejores trabajos</h2>
              <p className="mt-1 text-sm text-white/55">Hasta 3 fotos destacadas por profesional.</p>
              <div className="mt-5 grid grid-cols-3 gap-3">
                {["Fade limpio", "Barba marcada", "Corte premium"].map((item, index) => (
                  <div key={item} className="aspect-[4/5] rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-800 to-zinc-950 p-3 shadow-inner">
                    <div className="grid h-full place-items-end rounded-2xl bg-white/[0.03] p-3 text-left text-xs text-white/70">
                      <span>{index + 1}. {item}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.04] text-white shadow-xl">
            <CardContent className="p-5 sm:p-6">
              <h2 className="text-2xl font-semibold">Servicios</h2>
              <div className="mt-4 divide-y divide-white/10">
                {services.slice(0, 6).map((service) => (
                  <button
                    type="button"
                    key={service.id}
                    onClick={() => {
                      setSelectedServiceId(service.id);
                      setStep("professional");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-4 py-4 text-left transition hover:text-amber-200",
                      selectedServiceId === service.id && "text-amber-200",
                    )}
                  >
                    <div>
                      <p className="font-medium">{service.name}</p>
                      <p className="text-sm text-white/50">{Number(service.duration_min ?? service.duration ?? 30)} min</p>
                    </div>
                    <p className="font-semibold">{formatMoney(service.price)}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <aside id="booking-flow" className="lg:sticky lg:top-6 lg:self-start">
          <Card className="border-white/10 bg-white/[0.06] text-white shadow-2xl backdrop-blur-xl">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-white/50">Reserva online</p>
                  <h2 className="text-2xl font-semibold">Sacá tu turno</h2>
                </div>
                <CalendarDays className="h-6 w-6 text-amber-300" />
              </div>

              {step !== "service" && step !== "done" ? (
                <button type="button" onClick={() => setStep(step === "professional" ? "service" : step === "datetime" ? "professional" : "datetime")} className="mt-4 inline-flex items-center gap-1 text-sm text-white/55 hover:text-white">
                  <ChevronLeft className="h-4 w-4" /> Volver
                </button>
              ) : null}

              {step === "service" ? (
                <div className="mt-5 space-y-3">
                  <p className="text-sm text-white/60">1. Elegí un servicio</p>
                  {services.map((service) => (
                    <button key={service.id} type="button" onClick={() => { setSelectedServiceId(service.id); setStep("professional"); }} className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left hover:border-amber-300/60">
                      <span className="font-medium">{service.name}</span>
                      <span className="text-sm text-white/60">{formatMoney(service.price)}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {step === "professional" ? (
                <div className="mt-5 space-y-3">
                  <p className="text-sm text-white/60">2. Elegí profesional</p>
                  <button type="button" onClick={() => { setSelectedEmployeeId("any"); setStep("datetime"); }} className="w-full rounded-2xl border border-amber-300/40 bg-amber-300/10 p-4 text-left hover:bg-amber-300/15">
                    <p className="font-medium">Cualquiera disponible</p>
                    <p className="text-sm text-white/55">Clippr asigna el primer horario libre.</p>
                  </button>
                  {employees.map((employee) => (
                    <button key={employee.id} type="button" onClick={() => { setSelectedEmployeeId(employee.id); setStep("datetime"); }} className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left hover:border-amber-300/60">
                      {employee.full_name}
                    </button>
                  ))}
                </div>
              ) : null}

              {step === "datetime" ? (
                <div className="mt-5 space-y-4">
                  <p className="text-sm text-white/60">3. Próximos horarios disponibles</p>
                  {slots.every((day) => day.slots.length === 0) ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/60">No hay horarios disponibles en los próximos días.</div>
                  ) : null}
                  {slots.map((day) => day.slots.length ? (
                    <div key={day.date.toISOString()}>
                      <p className="mb-2 text-sm font-medium text-white/75">{formatDay(day.date)}</p>
                      <div className="grid grid-cols-3 gap-2">
                        {day.slots.map((slot) => (
                          <button key={`${slot.employeeId}-${slot.time.toISOString()}`} type="button" onClick={() => { setSelectedSlot(slot); setStep("details"); }} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm hover:border-amber-300/70 hover:bg-amber-300/10">
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
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
                    <p className="font-medium text-white">{selectedService?.name}</p>
                    <p>{selectedEmployee?.full_name} · {selectedSlot ? `${formatDay(selectedSlot.time)} ${formatTime(selectedSlot.time)}` : ""}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="clientName">Nombre</Label>
                    <Input id="clientName" value={clientName} onChange={(event) => setClientName(event.target.value)} className="border-white/10 bg-white/[0.04] text-white" placeholder="Tu nombre" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="clientPhone">Teléfono</Label>
                    <Input id="clientPhone" value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} className="border-white/10 bg-white/[0.04] text-white" placeholder="11 1234-5678" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="clientEmail">Email opcional</Label>
                    <Input id="clientEmail" value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} className="border-white/10 bg-white/[0.04] text-white" placeholder="tu@email.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notes">Observación opcional</Label>
                    <Textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} className="border-white/10 bg-white/[0.04] text-white" placeholder="Ej: fade bajo, barba marcada..." />
                  </div>
                  <Button disabled={submitting} onClick={submitBooking} className="w-full rounded-2xl bg-amber-400 py-6 font-bold text-zinc-950 hover:bg-amber-300">
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Confirmar turno
                  </Button>
                </div>
              ) : null}

              {step === "done" ? (
                <div className="mt-6 text-center">
                  <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-300" />
                  <h3 className="mt-4 text-2xl font-semibold">Turno reservado</h3>
                  <p className="mt-2 text-sm text-white/60">Te esperamos en {business.name}.</p>
                  <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left text-sm text-white/70">
                    <p className="font-medium text-white">{selectedService?.name}</p>
                    <p>{selectedEmployee?.full_name}</p>
                    <p>{selectedSlot ? `${formatDay(selectedSlot.time)} · ${formatTime(selectedSlot.time)}` : null}</p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-10">
        <div className="grid gap-3 rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 text-sm text-white/65 sm:grid-cols-4">
          <span className="inline-flex items-center gap-2"><Award className="h-4 w-4 text-amber-300" /> Profesional destacado</span>
          <span className="inline-flex items-center gap-2"><Scissors className="h-4 w-4 text-amber-300" /> Citas completadas</span>
          <span className="inline-flex items-center gap-2"><UsersRound className="h-4 w-4 text-amber-300" /> Clientes atendidos</span>
          <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4 text-amber-300" /> Disponibilidad real</span>
        </div>
      </section>
    </main>
  );
}
