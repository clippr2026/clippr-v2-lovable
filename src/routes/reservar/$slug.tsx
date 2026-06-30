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
  Gift,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Scissors,
  ShieldCheck,
  ShoppingBag,
  Star,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  type Appointment,
  type DayKey,
  type DaySchedule,
  type ScheduleMap,
  type SpecialDateMap,
  type EmployeeSpecialDateMap,
  DAY_KEYS,
  DEFAULT_SCHEDULE,
  parseTime,
  addMinutes,
  startOfDay,
  overlaps,
  normalizeSchedule,
  normalizeDaySchedule,
  buildSlots,
} from "@/lib/availability";
import clipprMark from "@/assets/clippr-mark.png";

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

type BookingStep = "services" | "professional" | "datetime" | "products" | "details" | "done";
type RecommendedProduct = { id: string; name: string; price: number; offer: string; image?: string; description?: string };
type ClientFields = Record<"nombre" | "telefono" | "email" | "fecha_nacimiento" | "notas", boolean>;
type LandingColors = { primary?: string; secondary?: string; accent?: string; buttonText?: string };
type LandingTheme = "dark" | "light";

const DEFAULT_CLIENT_FIELDS: ClientFields = {
  nombre: true,
  telefono: true,
  email: true,
  fecha_nacimiento: false,
  notas: true,
};

function formatMoney(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Oferta de productos recomendados. Los valores se guardan en
// business_settings.schedule._bookingProducts (Configuración → Catálogo).
function offerPct(offer: string | null | undefined): number {
  const n = Number(offer);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function productFinalPrice(product: RecommendedProduct): number {
  const pct = offerPct(product.offer);
  const base = Number(product.price) || 0;
  return pct > 0 ? Math.round(base - (base * pct) / 100) : base;
}

function offerBadge(offer: string | null | undefined): string {
  const pct = offerPct(offer);
  if (pct > 0) return `🔥 ${pct}% OFF`;
  if (offer === "special") return "🔥 Oferta exclusiva";
  return "⭐ Recomendado";
}

function normalizeRecommendedProducts(schedule: unknown): RecommendedProduct[] {
  if (!schedule || typeof schedule !== "object") return [];
  const bp = (schedule as Record<string, any>)._bookingProducts;
  const list = bp && typeof bp === "object" ? bp.recommended : null;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const v = (item ?? {}) as Record<string, unknown>;
      const id = typeof v.id === "string" ? v.id : "";
      const name = typeof v.name === "string" ? v.name : "";
      if (!id || !name) return null;
      return {
        id,
        name,
        price: Number(v.price) || 0,
        offer: typeof v.offer === "string" ? v.offer : "none",
        image: typeof v.image === "string" ? v.image : "",
        description: typeof v.description === "string" ? v.description : "",
      } as RecommendedProduct;
    })
    .filter(Boolean)
    .slice(0, 3) as RecommendedProduct[];
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

function formatInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function PublicBookingPage() {
  const { slug } = Route.useParams();
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [business, setBusiness] = React.useState<Business | null>(null);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [services, setServices] = React.useState<Service[]>([]);
  const [appointments, setAppointments] = React.useState<Appointment[]>([]);
  const [schedule, setSchedule] = React.useState<ScheduleMap>(DEFAULT_SCHEDULE);
  const [employeeSchedules, setEmployeeSchedules] = React.useState<Record<string, ScheduleMap>>({});
  const [businessSpecial, setBusinessSpecial] = React.useState<SpecialDateMap>({});
  const [employeeSpecial, setEmployeeSpecial] = React.useState<EmployeeSpecialDateMap>({});
  const [clientFields, setClientFields] = React.useState<ClientFields>(DEFAULT_CLIENT_FIELDS);
  const [recommendedProducts, setRecommendedProducts] = React.useState<RecommendedProduct[]>([]);
  const [selectedProductIds, setSelectedProductIds] = React.useState<string[]>([]);

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
    products?: { name: string; price: number }[];
  } | null>(null);

  const selectedServices = React.useMemo(
    () => selectedServiceIds.map((id) => services.find((service) => service.id === id)).filter(Boolean) as Service[],
    [selectedServiceIds, services],
  );
  const selectedEmployee = employees.find((employee) => employee.id === selectedSlot?.employeeId || employee.id === selectedEmployeeId) ?? null;
  const totalDuration = selectedServices.reduce((sum, service) => sum + (Number(service.duration_min ?? service.duration ?? 30) || 30), 0) || 30;
  const totalPrice = selectedServices.reduce((sum, service) => sum + Number(service.price ?? 0), 0);
  const selectedProducts = React.useMemo(
    () => selectedProductIds.map((id) => recommendedProducts.find((p) => p.id === id)).filter(Boolean) as RecommendedProduct[],
    [selectedProductIds, recommendedProducts],
  );
  const productsTotal = selectedProducts.reduce((sum, p) => sum + productFinalPrice(p), 0);
  const grandTotal = totalPrice + productsTotal;
  const slots = React.useMemo(
    () =>
      buildSlots(
        schedule,
        appointments,
        employees,
        selectedEmployeeId,
        totalDuration,
        10,
        employeeSchedules,
        businessSpecial,
        employeeSpecial,
      ),
    [schedule, appointments, employees, selectedEmployeeId, totalDuration, employeeSchedules, businessSpecial, employeeSpecial],
  );
  const availableDays = React.useMemo(() => slots.filter((day) => day.slots.length > 0), [slots]);
  const [selectedDayIndex, setSelectedDayIndex] = React.useState(0);
  const [showDatePicker, setShowDatePicker] = React.useState(false);
  const selectedDay = availableDays[selectedDayIndex] ?? availableDays[0] ?? null;

  const selectedSlotRef = React.useRef<typeof selectedSlot>(null);
  React.useEffect(() => {
    selectedSlotRef.current = selectedSlot;
  }, [selectedSlot]);


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
        const employeeRoles =
          settingsSchedule &&
          typeof settingsSchedule === "object" &&
          (settingsSchedule as Record<string, unknown>)._employeeRoles &&
          typeof (settingsSchedule as Record<string, unknown>)._employeeRoles === "object"
            ? ((settingsSchedule as Record<string, unknown>)._employeeRoles as Record<string, string>)
            : {};
        const visibleEmployees = ((employeesRes.error ? [] : (employeesRes.data ?? [])) as Employee[])
          .filter((employee) => employee.is_active !== false)
          .filter((employee) => visibility.employees[employee.id] !== false)
          .map((employee) => ({
            ...employee,
            role: employee.role?.trim() || employeeRoles[employee.id]?.trim() || null,
          }));
        const visibleServices = ((servicesRes.error ? [] : (servicesRes.data ?? [])) as Service[])
          .filter((service) => service.is_active !== false)
          .filter((service) => visibility.services[service.id] !== false);

        if (!cancelled) {
          setBusiness(businessData as Business);
          setEmployees(visibleEmployees);
          setServices(visibleServices);
          setAppointments((appointmentsRes.error ? [] : (appointmentsRes.data ?? [])) as Appointment[]);
          setSchedule(normalizeSchedule(settingsSchedule));

          // Horarios individuales de profesionales y horarios especiales (negocio
          // y profesional). Misma estructura que usa la Agenda; así la reserva
          // online resuelve disponibilidad con idéntica prioridad.
          const rawSchedule =
            settingsSchedule && typeof settingsSchedule === "object"
              ? (settingsSchedule as Record<string, any>)
              : null;

          const rawEmpScheds =
            rawSchedule && typeof rawSchedule._employeeSchedules === "object" && rawSchedule._employeeSchedules
              ? (rawSchedule._employeeSchedules as Record<string, unknown>)
              : {};
          const empScheds: Record<string, ScheduleMap> = {};
          for (const [empId, value] of Object.entries(rawEmpScheds)) {
            if (value && typeof value === "object") empScheds[empId] = normalizeSchedule(value);
          }
          setEmployeeSchedules(empScheds);

          const rawBizSpecial =
            rawSchedule && typeof rawSchedule._specialDates === "object" && rawSchedule._specialDates
              ? (rawSchedule._specialDates as Record<string, unknown>)
              : {};
          const bizSpecial: SpecialDateMap = {};
          for (const [dateKey, value] of Object.entries(rawBizSpecial)) {
            const nd = normalizeDaySchedule(value);
            if (nd) bizSpecial[dateKey] = nd;
          }
          setBusinessSpecial(bizSpecial);

          const rawEmpSpecial =
            rawSchedule && typeof rawSchedule._employeeSpecialDates === "object" && rawSchedule._employeeSpecialDates
              ? (rawSchedule._employeeSpecialDates as Record<string, Record<string, unknown>>)
              : {};
          const empSpecial: EmployeeSpecialDateMap = {};
          for (const [empId, byDate] of Object.entries(rawEmpSpecial)) {
            if (!byDate || typeof byDate !== "object") continue;
            const map: SpecialDateMap = {};
            for (const [dateKey, value] of Object.entries(byDate)) {
              const nd = normalizeDaySchedule(value);
              if (nd) map[dateKey] = nd;
            }
            if (Object.keys(map).length) empSpecial[empId] = map;
          }
          setEmployeeSpecial(empSpecial);

          setClientFields(extractClientFields(settingsSchedule));
          setRecommendedProducts(normalizeRecommendedProducts(settingsSchedule));
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
            setProfessionalLocked(false);
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
    setStep("professional");
  }

  // Tras elegir el horario: si hay productos recomendados, mostramos el paso
  // opcional "Completá tu visita"; si no, vamos directo a los datos.
  function selectSlot(slot: { time: Date; employeeId: string }) {
    setSelectedSlot(slot);
    setStep(recommendedProducts.length > 0 ? "products" : "details");
  }

  function toggleProduct(productId: string) {
    setSelectedProductIds((current) =>
      current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId],
    );
  }

  // Re-lee la disponibilidad real desde la base (misma ventana que la carga
  // inicial). Se usa tras crear un turno y, sobre todo, cuando otro cliente
  // tomó el horario primero: así el slot ocupado desaparece de inmediato.
  const refreshAppointments = React.useCallback(async () => {
    if (!business?.id) return;
    const start = startOfDay(new Date()).toISOString();
    const end = addMinutes(startOfDay(new Date()), 14 * 24 * 60).toISOString();
    const res = await supabase
      .from("public_booking_appointments")
      .select("id,employee_id,starts_at,ends_at,duration_min,status")
      .eq("business_id", business.id)
      .gte("starts_at", start)
      .lte("starts_at", end);
    if (!res.error) setAppointments((res.data ?? []) as Appointment[]);
  }, [business?.id]);


  // Realtime público: si otro cliente reserva/cancela desde otra pestaña o dispositivo,
  // actualiza los horarios visibles sin recargar la página.
  React.useEffect(() => {
    if (!business?.id) return;

    const channel = supabase
      .channel(`public-booking-appointments-${business.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `business_id=eq.${business.id}`,
        },
        (payload) => {
          const row = ((payload.new && Object.keys(payload.new).length > 0 ? payload.new : payload.old) ?? {}) as {
            employee_id?: string | null;
            starts_at?: string | null;
            status?: string | null;
          };

          // Si el cliente ya eligió un horario y ese profesional cambió, lo libero para evitar
          // que intente confirmar un turno que otro acaba de tomar.
          const selected = selectedSlotRef.current;
          if (selected && row.employee_id === selected.employeeId) {
            setSelectedSlot(null);
          }

          void refreshAppointments();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [business?.id, refreshAppointments]);

  async function submitBooking() {
    if (!business || selectedServices.length === 0 || !selectedSlot) return;
    if (!clientName.trim()) return toast.error("Ingresá tu nombre.");
    if (!clientPhone.trim()) return toast.error("Ingresá tu teléfono.");
    if (clientFields.email && !clientEmail.trim()) return toast.error("Ingresá tu email.");
    if (clientFields.fecha_nacimiento && !clientBirthDate) return toast.error("Ingresá tu fecha de nacimiento.");

    const serviceName = selectedServices.map((service) => service.name).join(" + ");
    const serviceList = selectedServices.map((service) => `${service.name} (${formatMoney(service.price)})`).join("\n- ");
    const addedProducts = selectedProducts.map((p) => ({ name: p.name, price: productFinalPrice(p) }));
    const productList = addedProducts.map((p) => `${p.name} (${formatMoney(p.price)})`).join("\n- ");
    const publicNotes = [
      notes.trim() ? `Notas del cliente: ${notes.trim()}` : null,
      clientEmail.trim() ? `Email: ${clientEmail.trim()}` : null,
      clientBirthDate ? `Fecha de nacimiento: ${clientBirthDate}` : null,
      selectedServices.length > 1 ? `Servicios seleccionados:\n- ${serviceList}` : null,
      addedProducts.length ? `Productos agregados:\n- ${productList}` : null,
      "Origen: reserva online",
    ].filter(Boolean).join("\n\n");

    const confirmationSnapshot = {
      services: selectedServices.map((service) => service.name).join(" + "),
      professional: selectedEmployee?.full_name ?? "Sin preferencia",
      date: formatDay(selectedSlot.time),
      time: formatTime(selectedSlot.time),
      duration: totalDuration,
      total: grandTotal,
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim(),
      clientEmail: clientEmail.trim() || undefined,
      products: addedProducts,
      startIso: selectedSlot.time.toISOString(),
      appointmentId: undefined as string | undefined,
      manageToken: undefined as string | undefined,
    };

    setSubmitting(true);
    try {
      const start = selectedSlot.time;
      const end = addMinutes(start, totalDuration);

      const alreadyTaken = appointments.some((appt) => {
        if (appt.status === "cancelled") return false;
        if (appt.employee_id !== selectedSlot.employeeId) return false;
        const apptStart = new Date(appt.starts_at);
        const apptEnd = appt.ends_at ? new Date(appt.ends_at) : addMinutes(apptStart, Number(appt.duration_min ?? totalDuration));
        return overlaps(start, end, apptStart, apptEnd);
      });
      if (alreadyTaken) {
        toast.error("Ese horario ya fue reservado. Elegí otro turno disponible.");
        setSelectedSlot(null);
        setStep("datetime");
        return;
      }

      const bookingResult = await supabase.rpc("create_public_booking_public_v3", {
        p_business_id: business.id,
        // Se envía como texto para evitar el 400 que PostgREST daba con arrays uuid[].
        p_service_ids: selectedServiceIds.join(","),
        p_employee_id: selectedSlot.employeeId,
        p_starts_at: start.toISOString(),
        p_client_name: clientName.trim(),
        p_client_phone: clientPhone.trim(),
        p_client_email: clientEmail.trim() || null,
        p_client_birth_date: clientBirthDate || null,
        p_notes: publicNotes || null,
      } as any);

      if (bookingResult.error) {
        console.error("Public booking RPC error", bookingResult.error);
        const err = bookingResult.error as any;
        // Conflicto de horario: la exclusion constraint (o el chequeo del RPC)
        // rechazó el turno porque el profesional ya tiene algo en ese rango.
        const isConflict =
          err?.code === "23P01" ||
          /appointments_no_overlap|exclusion|overlap|solap|ocupad|ya no est|no disponible|disponible/i.test(
            String(err?.message ?? ""),
          );
        if (isConflict) {
          await refreshAppointments();
          toast.error("Ese horario ya no está disponible. Elegí otro turno.");
          setSelectedSlot(null);
          setStep("datetime");
          return;
        }
        const rpcMessage = err?.message;
        throw new Error(rpcMessage || "No se pudo guardar la reserva. Aplicá la migración create_public_booking_public_v3 en Supabase.");
      }

      const returnedBooking = Array.isArray(bookingResult.data) ? bookingResult.data[0] : bookingResult.data;
      confirmationSnapshot.appointmentId = returnedBooking?.id ?? returnedBooking?.appointment_id ?? undefined;
      confirmationSnapshot.manageToken = returnedBooking?.manage_token ?? returnedBooking?.manageToken ?? undefined;

      setAppointments((current) => [
        ...current,
        {
          id: `local-${Date.now()}`,
          employee_id: selectedSlot.employeeId,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          duration_min: totalDuration,
          status: "pending",
        },
      ]);
      setConfirmedBooking(confirmationSnapshot);
      setStep("done");
      toast.success("Turno reservado correctamente");
      // Reconciliar disponibilidad con la base (además del append optimista).
      void refreshAppointments();

      // Correo de confirmación (no bloquea la reserva: si el envío falla,
      // el turno igual queda confirmado).
      if (confirmationSnapshot.clientEmail) {
        void supabase.functions
          .invoke("send-booking-email", {
            body: {
              type: "confirmation",
              businessId: business.id,
              to: confirmationSnapshot.clientEmail,
              booking: {
                services: confirmationSnapshot.services,
                professional: confirmationSnapshot.professional,
                clientName: confirmationSnapshot.clientName,
                clientPhone: confirmationSnapshot.clientPhone,
                clientEmail: confirmationSnapshot.clientEmail,
                appointmentId: confirmationSnapshot.appointmentId,
                manageToken: confirmationSnapshot.manageToken,
                date: confirmationSnapshot.date,
                time: confirmationSnapshot.time,
                total: confirmationSnapshot.total,
                startIso: confirmationSnapshot.startIso,
                durationMin: confirmationSnapshot.duration,
              },
            },
          })
          .catch((emailError) => console.error("send-booking-email", emailError));
      }
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

  const hasProducts = recommendedProducts.length > 0;
  const totalSteps = hasProducts ? 5 : 4;
  const stepIndex =
    step === "services" ? 1 :
    step === "professional" ? 2 :
    step === "datetime" ? 3 :
    step === "products" ? 4 :
    step === "details" ? (hasProducts ? 5 : 4) :
    totalSteps;

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
        .public-booking .booking-shell { border-radius: 2rem; box-shadow: 0 24px 80px rgba(0,0,0,.22); }
        .public-booking .slot-button { position: relative; overflow: hidden; }
        .public-booking .slot-button:before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--accent); opacity: .85; }
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
        {business.cover_url ? <img loading="lazy" decoding="async" src={business.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20 blur-sm" /> : null}
        <div className="relative mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-2 sm:py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/negocio/$slug" params={{ slug }} className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10 bg-white text-base font-bold text-zinc-950">
              {business.avatar_url || business.logo_url ? <img loading="lazy" decoding="async" src={business.avatar_url || business.logo_url || ""} alt={business.name} className="h-full w-full object-cover" /> : business.name.slice(0, 1)}
            </Link>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.28em]" style={{ color: accent }}>Reserva online</p>
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{business.name}</h1>
              {business.address ? <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-white/55"><MapPin className="h-3.5 w-3.5 shrink-0" />{business.address}</p> : null}
            </div>
          </div>

          <div className="hidden shrink-0 items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] font-medium text-white/60 backdrop-blur sm:inline-flex">
            <span>Impulsado por</span>
            <img
              src="/clippr-powered-logo.webp"
              alt="Clippr"
              loading="lazy"
              decoding="async"
              className="h-5 w-5 rounded-md object-cover ring-1 ring-white/10"
            />
            <span className="font-semibold text-white/80">Clippr</span>
          </div>
        </div>
      </section>

      <div className="mx-auto mt-3 flex max-w-5xl justify-center px-4 sm:hidden">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/55">
          <span>Impulsado por</span>
          <img src="/clippr-powered-logo.webp" alt="Clippr" className="h-5 w-5 rounded-md object-cover" />
          <span className="font-semibold text-white/75">Clippr</span>
        </div>
      </div>

      <section className={cn("mx-auto grid max-w-5xl gap-6 px-4 py-6 lg:items-start", step === "done" ? "lg:grid-cols-1" : "lg:grid-cols-[1fr_330px]")}>
        <div className="space-y-6">
          <Card className="booking-card booking-shell border-white/10 bg-white/[0.04] text-white shadow-xl">
            <CardContent className="p-5 sm:p-6">
              {step !== "done" ? (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-white/50">Paso {stepIndex} de {totalSteps}</p>
                    <h2 className="text-2xl font-semibold">
                      {step === "services" && "Elegí tus servicios"}
                      {step === "professional" && "Elegí profesional"}
                      {step === "datetime" && "Elegí día y horario"}
                      {step === "products" && "Productos recomendados"}
                      {step === "details" && "Tus datos"}
                    </h2>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-white/60">{stepIndex}/{totalSteps}</div>
                </div>
              ) : null}

              {step !== "services" && step !== "done" ? (
                <button
                  type="button"
                  onClick={() => {
                    if (step === "professional") setStep("services");
                    if (step === "datetime") setStep("professional");
                    if (step === "products") setStep("datetime");
                    if (step === "details") setStep(recommendedProducts.length > 0 ? "products" : "datetime");
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
                <div
                  className={cn(
                    "mt-5 grid gap-3",
                    employees.length <= 6 && "grid-cols-1",
                    employees.length >= 7 && employees.length <= 8 && "grid-cols-2",
                    employees.length >= 9 && "grid-cols-3",
                    employees.length >= 19 && "max-h-[58vh] overflow-y-auto pr-1",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => { setSelectedEmployeeId("any"); setSelectedSlot(null); setStep("datetime"); }}
                    className={cn(
                      "flex min-w-0 items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.03] text-left transition hover:border-white/30",
                      employees.length >= 7 ? "p-3" : "p-4",
                    )}
                  >
                    <span className={cn("grid shrink-0 place-items-center rounded-2xl", employees.length >= 7 ? "h-10 w-10" : "h-12 w-12")} style={{ background: `${accent}22`, color: accent }}>
                      <UsersRound className={cn(employees.length >= 7 ? "h-5 w-5" : "h-6 w-6")} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">Sin preferencia</span>
                      <span className="block truncate text-xs text-white/55 sm:text-sm">Cualquier profesional disponible.</span>
                    </span>
                  </button>

                  {employees.map((employee) => (
                    <button
                      key={employee.id}
                      type="button"
                      onClick={() => { setSelectedEmployeeId(employee.id); setSelectedSlot(null); setStep("datetime"); }}
                      className={cn(
                        "flex min-w-0 items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.03] text-left transition hover:border-white/30",
                        employees.length >= 7 ? "p-3" : "p-4",
                      )}
                    >
                      <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/10", employees.length >= 7 ? "h-10 w-10" : "h-12 w-12")}>
                        {employee.avatar_url ? (
                          <img loading="lazy" decoding="async" src={employee.avatar_url} alt={employee.full_name} className="h-full w-full object-cover" />
                        ) : (
                          <UserRound className={cn(employees.length >= 7 ? "h-5 w-5" : "h-6 w-6")} />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{employee.full_name}</span>
                        <span className="block truncate text-xs text-white/55 sm:text-sm">{employee.role?.trim() || "Profesional"}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {step === "datetime" ? (
                <div className="mt-5 space-y-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={() => { setSelectedSlot(null); setStep("professional"); }}
                      className="group inline-flex w-max items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5 pr-4 text-left transition hover:border-white/25 hover:bg-white/[0.08]"
                      title="Cambiar profesional"
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/10">
                        {selectedEmployee?.avatar_url ? <img loading="lazy" decoding="async" src={selectedEmployee.avatar_url} alt={selectedEmployee.full_name} className="h-full w-full object-cover" /> : <UserRound className="h-5 w-5" />}
                      </span>
                      <span>
                        <span className="block text-base font-semibold">{selectedEmployee?.full_name ?? "Sin preferencia"}</span>
                        <span className="block text-xs text-white/45 group-hover:text-white/65">Tocá para cambiar</span>
                      </span>
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowDatePicker((value) => !value)}
                        className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] transition hover:border-white/25 hover:bg-white/[0.08]"
                        title="Abrir calendario"
                      >
                        <CalendarDays className="h-5 w-5" />
                      </button>
                      {showDatePicker ? (
                        <input
                          type="date"
                          className="absolute right-0 top-12 z-20 rounded-2xl border border-white/10 bg-white p-3 text-sm text-zinc-950 shadow-2xl"
                          min={formatInputDate(new Date())}
                          value={selectedDay ? formatInputDate(selectedDay.date) : ""}
                          onChange={(event) => {
                            const index = availableDays.findIndex((day) => formatInputDate(day.date) === event.target.value);
                            if (index >= 0) {
                              setSelectedDayIndex(index);
                              setSelectedSlot(null);
                              setShowDatePicker(false);
                            } else {
                              toast.error("Ese día no tiene horarios disponibles.");
                            }
                          }}
                        />
                      ) : null}
                    </div>
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
                            onClick={() => { selectSlot(slot); }}
                            className="slot-button flex w-full items-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 pl-7 text-left text-base font-semibold transition hover:border-white/25 hover:bg-white/[0.08] sm:px-6 sm:py-4 sm:pl-8"
                          >
                            {formatTime(slot.time)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {step === "products" ? (
                <div className="mt-3">
                  {/* Encabezado */}
                  <div className="text-center">
                    <span
                      className="mx-auto grid h-10 w-10 place-items-center rounded-2xl"
                      style={{ background: `color-mix(in oklch, ${accent} 16%, transparent)`, color: accent }}
                    >
                      <ShoppingBag className="h-5 w-5" />
                    </span>
                    <h3 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Tentate con estos productos</h3>
                    <p className="mt-1 text-sm text-white/55 sm:text-base">Sumalos a tu turno y retiralos en el local.</p>
                  </div>

                  {/* Píldora de oferta */}
                  <div className="mt-3 flex justify-center">
                    <span
                      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"
                      style={{ background: `color-mix(in oklch, ${accent} 12%, transparent)`, color: accent }}
                    >
                      <Gift className="h-4 w-4" /> Oferta exclusiva por reservar tu turno online
                    </span>
                  </div>

                  {/* Tarjetas */}
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {recommendedProducts.map((product) => {
                      const added = selectedProductIds.includes(product.id);
                      const pct = offerPct(product.offer);
                      const finalPrice = productFinalPrice(product);
                      const description = product.description;
                      return (
                        <div
                          key={product.id}
                          className={cn(
                            "relative flex flex-col rounded-3xl border p-2.5 transition",
                            added ? "border-transparent bg-white/[0.06]" : "border-white/10 bg-white/[0.03]",
                          )}
                          style={added ? { boxShadow: `0 0 0 1.5px ${accent}` } : undefined}
                        >
                          {/* Badge circular */}
                          <div className="absolute left-2.5 top-2.5 z-10">
                            {pct > 0 ? (
                              <span className="grid h-12 w-12 place-items-center rounded-full bg-red-500 !text-white shadow-lg shadow-red-500/30">
                                <span
                                  className="text-center text-[10px] font-black uppercase leading-none !text-white"
                                  style={{ color: "#fff" }}
                                >
                                  {pct}%
                                  <br />
                                  OFF
                                </span>
                              </span>
                            ) : (
                              <span
                                className="grid h-12 w-12 place-items-center rounded-full text-white shadow-lg"
                                style={{ background: `linear-gradient(135deg, ${cPrimary}, ${cSecondary})` }}
                              >
                                <span className="flex flex-col items-center leading-none">
                                  <Star className="h-4 w-4 fill-current" />
                                  <span className="mt-0.5 text-[7px] font-bold tracking-wide">RECOMENDADO</span>
                                </span>
                              </span>
                            )}
                          </div>

                          {/* Imagen grande */}
                          <div className="grid aspect-[1/1] w-full place-items-center overflow-hidden rounded-2xl bg-white/[0.04]">
                            {product.image ? (
                              <img
                                loading="lazy"
                                decoding="async"
                                src={product.image}
                                alt={product.name}
                                className="h-full w-full object-contain p-2"
                              />
                            ) : (
                              <ShoppingBag className="h-12 w-12 text-white/30" />
                            )}
                          </div>

                          {/* Cuerpo */}
                          <div className="mt-2 flex flex-1 flex-col px-1">
                            <p className="font-semibold leading-tight">{product.name}</p>
                            {description ? (
                              <p className="mt-1 line-clamp-2 text-xs leading-snug text-white/50">{description}</p>
                            ) : null}
                            <div className="mt-1.5 flex flex-1 items-end">
                              <div className="flex items-baseline gap-2">
                                {pct > 0 ? (
                                  <span className="text-sm text-white/40 line-through">{formatMoney(product.price)}</span>
                                ) : null}
                                <span className={cn("text-lg font-bold", pct > 0 ? "text-red-400" : "text-white")}>
                                  {formatMoney(finalPrice)}
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => toggleProduct(product.id)}
                              className={cn(
                                "mt-2.5 w-full rounded-2xl py-2.5 text-sm font-bold transition hover:brightness-110",
                                added ? "bg-emerald-500 text-white" : "text-white",
                              )}
                              style={added ? undefined : { background: accent, color: accentButtonText }}
                            >
                              {added ? "✓ Agregado" : "+ Agregar"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Mensaje opcional */}
                  <div className="mt-4 flex justify-center">
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60">
                      <ShieldCheck className="h-4 w-4" style={{ color: accent }} />
                      Es totalmente opcional. Podés continuar sin agregar productos.
                    </span>
                  </div>

                  {/* Botones */}
                  <div className="mt-3 flex gap-3">
                    <Button
                      onClick={() => { setSelectedProductIds([]); setStep("details"); }}
                      className="flex-1 rounded-2xl border border-white/10 bg-white/[0.04] py-4 font-semibold text-white hover:bg-white/[0.08]"
                    >
                      Omitir
                    </Button>
                    <Button
                      onClick={() => setStep("details")}
                      className="flex-1 rounded-2xl py-4 font-bold text-white hover:brightness-110"
                      style={{ background: accent, color: accentButtonText }}
                    >
                      Continuar
                    </Button>
                  </div>
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
                <div
                  className={cn(
                    "relative mt-6 overflow-hidden rounded-[2rem] border p-6 shadow-2xl sm:p-10",
                    isLight
                      ? "border-slate-200 bg-white text-slate-950 shadow-slate-200/60"
                      : "border-white/10 bg-[#070711] text-white shadow-black/50",
                  )}
                >
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-64"
                    style={{
                      background: isLight
                        ? "radial-gradient(60% 100% at 50% 0%, color-mix(in oklch, var(--c-primary) 12%, transparent), transparent 70%)"
                        : "radial-gradient(60% 100% at 50% 0%, rgba(124,58,237,.18), transparent 70%)",
                    }}
                  />

                  <div className="relative mx-auto max-w-2xl">
                    {/* Encabezado */}
                    <div className="text-center">
                      <div
                        className={cn(
                          "mx-auto inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold",
                          isLight ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
                        )}
                      >
                        <CheckCircle2 className="h-4 w-4" /> Reserva confirmada
                      </div>
                      <h3 className={cn("mt-5 text-4xl font-bold tracking-tight sm:text-5xl", isLight ? "text-slate-950" : "text-white")}>
                        ¡Turno confirmado!
                      </h3>
                      <p className={cn("mx-auto mt-3 max-w-md text-sm leading-relaxed sm:text-base", isLight ? "text-slate-500" : "text-white/60")}>
                        Tu reserva fue registrada correctamente. Revisá los detalles de tu turno a continuación.
                      </p>

                      <div
                        className={cn(
                          "mx-auto mt-6 max-w-md rounded-2xl border px-5 py-4",
                          isLight ? "border-slate-200 bg-slate-50/60" : "border-white/[0.08] bg-white/[0.02]",
                        )}
                      >
                        <div className="flex flex-col items-center text-center">
                          <span
                            className={cn(
                              "mb-3 grid h-10 w-10 place-items-center rounded-full",
                              isLight ? "bg-white text-slate-500 ring-1 ring-slate-200/80" : "bg-white/[0.06] text-white/70 ring-1 ring-white/10",
                            )}
                          >
                            <Mail className="h-5 w-5" />
                          </span>
                          <p className={cn("text-sm font-medium", isLight ? "text-slate-700" : "text-white/80")}>
                            Te enviamos la confirmación a tu correo electrónico.
                          </p>
                          <p className={cn("mt-1 text-xs leading-relaxed sm:text-sm", isLight ? "text-slate-500" : "text-white/55")}>
                            Desde allí podrás consultar todos los detalles de tu reserva.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Datos del turno */}
                    <div className={cn("mt-8 rounded-[1.5rem] border p-4 sm:p-5", isLight ? "border-slate-200 bg-slate-50/70" : "border-white/[0.08] bg-white/[0.03]")}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {[
                          { label: "Servicio", value: confirmedBooking?.services || selectedServices.map((service) => service.name).join(" + "), icon: Scissors },
                          { label: "Profesional", value: confirmedBooking?.professional || selectedEmployee?.full_name || "Sin preferencia", icon: UserRound },
                          { label: "Cliente", value: confirmedBooking?.clientName || clientName, icon: UsersRound },
                          { label: "Teléfono", value: confirmedBooking?.clientPhone || clientPhone, icon: Phone },
                          { label: "Fecha", value: confirmedBooking?.date || (selectedSlot ? formatDay(selectedSlot.time) : "-"), icon: CalendarDays },
                          { label: "Horario", value: confirmedBooking?.time || (selectedSlot ? formatTime(selectedSlot.time) : "-"), icon: Clock3 },
                        ].map((item) => (
                          <div key={item.label} className={cn("rounded-2xl border p-4", isLight ? "border-slate-200 bg-white" : "border-white/[0.06] bg-black/20")}>
                            <div className="flex items-center gap-3">
                              <span
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
                                style={{ background: `linear-gradient(135deg, ${cPrimary}, ${cSecondary})` }}
                              >
                                {React.createElement(item.icon, { className: "h-[18px] w-[18px]" })}
                              </span>
                              <div className="min-w-0">
                                <p className={cn("text-[0.7rem] font-medium uppercase tracking-wide", isLight ? "text-slate-400" : "text-white/40")}>{item.label}</p>
                                <p className={cn("mt-0.5 break-words text-sm font-semibold", isLight ? "text-slate-900" : "text-white")}>{item.value}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {(confirmedBooking?.clientEmail || clientEmail) ? (
                        <div className={cn("mt-3 rounded-2xl border p-4", isLight ? "border-slate-200 bg-white" : "border-white/[0.06] bg-black/20")}>
                          <div className="flex items-center gap-3">
                            <span
                              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
                              style={{ background: `linear-gradient(135deg, ${cPrimary}, ${cSecondary})` }}
                            >
                              <Mail className="h-[18px] w-[18px]" />
                            </span>
                            <div className="min-w-0">
                              <p className={cn("text-[0.7rem] font-medium uppercase tracking-wide", isLight ? "text-slate-400" : "text-white/40")}>Email</p>
                              <p className={cn("mt-0.5 break-words text-sm font-semibold", isLight ? "text-slate-900" : "text-white")}>{confirmedBooking?.clientEmail || clientEmail}</p>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {confirmedBooking?.products && confirmedBooking.products.length > 0 ? (
                        <div className={cn("mt-3 rounded-2xl border p-4", isLight ? "border-slate-200 bg-white" : "border-white/[0.06] bg-black/20")}>
                          <p className={cn("text-[0.7rem] font-medium uppercase tracking-wide", isLight ? "text-slate-400" : "text-white/40")}>Productos agregados</p>
                          <div className="mt-2 space-y-1.5">
                            {confirmedBooking.products.map((product, index) => (
                              <div key={`${product.name}-${index}`} className="flex items-center justify-between gap-3">
                                <span className={cn("min-w-0 truncate text-sm font-medium", isLight ? "text-slate-900" : "text-white")}>{product.name}</span>
                                <span className={cn("shrink-0 text-sm font-semibold", isLight ? "text-slate-900" : "text-white")}>{formatMoney(product.price)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div
                        className={cn(
                          "mt-3 flex items-center justify-between rounded-2xl px-5 py-4",
                          isLight ? "text-slate-950" : "text-white",
                        )}
                        style={{ background: `linear-gradient(135deg, color-mix(in oklch, ${cPrimary} 14%, transparent), color-mix(in oklch, ${cSecondary} 14%, transparent))` }}
                      >
                        <span className={cn("text-sm font-medium", isLight ? "text-slate-600" : "text-white/70")}>Total</span>
                        <span className={cn("text-3xl font-black tracking-tight", isLight ? "text-slate-950" : "text-white")}>{formatMoney(confirmedBooking?.total ?? grandTotal)}</span>
                      </div>
                    </div>

                    {/* Acción */}
                    <div className="mt-7 flex justify-center">
                      <Link
                        to="/negocio/$slug"
                        params={{ slug }}
                        className={cn(
                          "inline-flex rounded-2xl border px-7 py-3 text-sm font-bold transition hover:scale-[1.01]",
                          isLight ? "border-slate-200 bg-white text-slate-950 shadow-lg shadow-slate-200/60 hover:bg-slate-50" : "border-white/10 bg-white/[0.08] text-white hover:bg-white/[0.12]",
                        )}
                      >
                        Volver al perfil
                      </Link>
                    </div>

                    {/* Firma Clippr */}
                    <div className={cn("mt-9 flex items-center justify-center gap-2 border-t pt-6", isLight ? "border-slate-200" : "border-white/[0.08]")}>
                      <img loading="lazy" decoding="async" src={clipprMark} alt="" className="h-4 w-4 object-contain opacity-90" />
                      <span className={cn("text-xs font-medium tracking-wide", isLight ? "text-slate-400" : "text-white/40")}>Reservá fácil con Clippr</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {step !== "done" ? (
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card className="booking-card border-white/10 bg-white/[0.06] text-white shadow-2xl backdrop-blur-xl">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center gap-2"><CalendarDays className="h-5 w-5" style={{ color: accent }} /><h2 className="text-lg font-semibold">Tu reserva</h2></div>
              <div className="mt-5 space-y-4 text-sm text-white/65">
                <div><p className="text-white/40">Servicios</p><p className="mt-1 font-medium text-white">{selectedServices.length ? selectedServices.map((s) => s.name).join(" + ") : "Sin seleccionar"}</p></div>
                <div><p className="text-white/40">Profesional</p><p className="mt-1 font-medium text-white">{selectedEmployee?.full_name || (selectedEmployeeId === "any" ? "Sin preferencia" : "Sin seleccionar")}</p></div>
                <div><p className="text-white/40">Horario</p><p className="mt-1 font-medium text-white">{selectedSlot ? `${formatShortDay(selectedSlot.time)} · ${formatTime(selectedSlot.time)}` : "Sin seleccionar"}</p></div>
                {selectedProducts.length ? (
                  <div className="border-t border-white/10 pt-4">
                    <p className="text-white/40">Productos</p>
                    <div className="mt-1 space-y-1">
                      {selectedProducts.map((product) => (
                        <div key={product.id} className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate font-medium text-white">{product.name}</span>
                          <span className="shrink-0 font-medium text-white">{formatMoney(productFinalPrice(product))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-t border-white/10 pt-4"><span>Total</span><span className="text-lg font-semibold text-white">{formatMoney(grandTotal)}</span></div>
                <div className="flex items-center justify-between"><span>Duración</span><span className="font-semibold text-white">{totalDuration} min</span></div>
              </div>
            </CardContent>
          </Card>
        </aside>
        ) : null}
      </section>
    </main>
  );
}
