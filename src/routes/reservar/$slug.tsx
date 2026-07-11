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
  Info,
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
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AcquisitionSourceField } from "@/components/acquisition-source-field";
import { acquisitionChannelRequiresText } from "@/lib/acquisition-channels";
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
import { ClipprLoader } from "@/components/ui/clippr-loader";
import { ServiceImage } from "@/components/ui/service-image";
import {
  resolveServicePricing,
  getServiceRange,
  formatServiceRangeLabel,
  isPromotionCurrentlyValid,
  isPromotionApplicable,
  applyPromotionDiscount,
  formatPromotionConditions,
  normalizeClientKeys,
  hasClientReachedPerClientLimit,
  getPromotionUsesRemaining,
  backfillPromotionVigencia,
  type EmployeeServiceOverrideMap,
  type Promotion,
} from "@/lib/service-pricing";

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

type CatalogImageOffset = { image_offset_x: number; image_offset_y: number };

type Service = {
  id: string;
  name: string;
  price: number | null;
  duration_min?: number | null;
  duration?: number | null;
  is_active?: boolean | null;
  image_url?: string | null;
  image_position?: string | null;
  image_offset?: CatalogImageOffset | null;
  category?: string | null;
};

type BookingStep = "services" | "promo" | "professional" | "datetime" | "products" | "details" | "done";
type RecommendedProduct = { id: string; name: string; price: number; offer: string; image?: string; image_position?: string; description?: string };
type ClientFields = Record<"nombre" | "telefono" | "email" | "fecha_nacimiento" | "notas", boolean>;
type LandingColors = { primary?: string; secondary?: string; accent?: string; buttonText?: string };
type LandingTheme = "dark" | "light";

function extractCatalogImageOffsets(schedule: unknown): Record<string, CatalogImageOffset> {
  if (!schedule || typeof schedule !== "object") return {};
  const offsets = (schedule as Record<string, unknown>)._catalogImageOffsets;
  if (!offsets || typeof offsets !== "object") return {};
  const map: Record<string, CatalogImageOffset> = {};
  for (const [id, value] of Object.entries(offsets as Record<string, unknown>)) {
    if (!id.trim() || !value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const x = Number(row.image_offset_x);
    const y = Number(row.image_offset_y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      map[id] = { image_offset_x: x, image_offset_y: y };
    }
  }
  return map;
}

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
  // Misma fuente de verdad que Configuración → Catálogo: el recorte de la
  // imagen se lee de business_settings.schedule._catalogImagePositions, no
  // se recalcula ni se recentra acá.
  const positions = ((schedule as Record<string, any>)._catalogImagePositions ?? {}) as Record<string, unknown>;
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
        image_position: typeof positions[id] === "string" ? (positions[id] as string) : "50% 50%",
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
  // Precio/duración personalizados por profesional-servicio, resueltos con
  // el mismo `resolveServicePricing` que usan Agenda/Mi Agenda/Caja — ver
  // src/lib/service-pricing.ts. Único lugar donde la reserva pública calcula
  // precio: nada más en este archivo debe leer service.price directo una vez
  // que hay un profesional elegido.
  const [employeeServiceOverrides, setEmployeeServiceOverrides] =
    React.useState<EmployeeServiceOverrideMap>({});
  // Promociones vigentes (Configuración → Promociones), administradas por
  // completo desde ese único lugar — acá solo se leen y se aplican, nunca
  // se recalcula el descuento con otra lógica.
  const [promotions, setPromotions] = React.useState<Promotion[]>([]);
  const [clientFields, setClientFields] = React.useState<ClientFields>(DEFAULT_CLIENT_FIELDS);
  // Intervalo de turnos y anticipación máxima configurados en Configuración →
  // Horarios (business_settings.schedule._settings). Los defaults acá abajo
  // son solo el fallback antes de que responda la primera consulta.
  const [reservationSettings, setReservationSettings] = React.useState<{
    interval: number;
    maxAdvance: number;
  }>({ interval: 30, maxAdvance: 10 });
  const [recommendedProducts, setRecommendedProducts] = React.useState<RecommendedProduct[]>([]);
  const [selectedProductIds, setSelectedProductIds] = React.useState<string[]>([]);

  const [step, setStep] = React.useState<BookingStep>("services");
  const [selectedServiceIds, setSelectedServiceIds] = React.useState<string[]>([]);
  // Pestaña activa del paso "Servicios": null = "Todos", siempre primera y
  // seleccionada por defecto.
  const [activeServiceCategory, setActiveServiceCategory] = React.useState<string | null>(null);
  // Paso "¿Tenés algún beneficio?": "none" = sin beneficio, "code" = ingresó
  // un código, o el id de una promoción listada por nombre.
  const [promoChoice, setPromoChoice] = React.useState<"none" | "code" | string>("none");
  const [enteredPromoCode, setEnteredPromoCode] = React.useState("");
  const [promoCodeError, setPromoCodeError] = React.useState("");
  const [appliedPromotion, setAppliedPromotion] = React.useState<Promotion | null>(null);
  const [infoModalPromo, setInfoModalPromo] = React.useState<Promotion | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = React.useState<string | "any">("any");
  const [professionalLocked, setProfessionalLocked] = React.useState(false);
  const [selectedSlot, setSelectedSlot] = React.useState<{ time: Date; employeeId: string } | null>(null);
  const [clientFirstName, setClientFirstName] = React.useState("");
  const [clientLastName, setClientLastName] = React.useState("");
  const clientName = `${clientFirstName.trim()} ${clientLastName.trim()}`.trim();
  const [clientPhone, setClientPhone] = React.useState("");
  const [clientEmail, setClientEmail] = React.useState("");
  const [clientBirthDate, setClientBirthDate] = React.useState("");
  const [acquisitionSource, setAcquisitionSource] = React.useState("");
  const [acquisitionCustom, setAcquisitionCustom] = React.useState("");
  // Si el email ya tiene un canal guardado, no se vuelve a preguntar. Por
  // default se pregunta (fail-open): cubre el caso de negocios sin campo de
  // email habilitado, donde no hay forma de deduplicar por email.
  const [sourceAlreadyKnown, setSourceAlreadyKnown] = React.useState(false);
  const [landingColors, setLandingColors] = React.useState<LandingColors>({});
  const [landingTheme, setLandingTheme] = React.useState<LandingTheme>("dark");
  // Tema real del negocio, resuelto únicamente desde business_settings.schedule._branding.theme.
  // Se usa solo para el fondo del loader inicial y evita un flash de color incorrecto.
  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark" | null>(null);
  const [confirmedBooking, setConfirmedBooking] = React.useState<{
    services: string;
    professional: string;
    date: string;
    time: string;
    duration: number;
    total: number;
    originalTotal: number;
    promotionName?: string;
    clientName: string;
    clientPhone: string;
    clientEmail?: string;
    products?: { name: string; price: number }[];
  } | null>(null);

  // Si el cliente ya reservó antes y su email ya tiene un canal de origen
  // guardado, no volvemos a mostrarle la pregunta "¿Cómo nos conociste?".
  React.useEffect(() => {
    const email = clientEmail.trim();
    if (!business?.id || !email || !email.includes("@")) {
      setSourceAlreadyKnown(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc("clippr_client_has_acquisition_source", {
        p_business_id: business.id,
        p_email: email,
      });
      if (!cancelled && !error) setSourceAlreadyKnown(Boolean(data));
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [business?.id, clientEmail]);

  const selectedServices = React.useMemo(
    () => selectedServiceIds.map((id) => services.find((service) => service.id === id)).filter(Boolean) as Service[],
    [selectedServiceIds, services],
  );
  const serviceCategories = React.useMemo(
    () =>
      Array.from(new Set(services.map((service) => service.category?.trim() || "Otro"))).sort((a, b) =>
        a.localeCompare(b, "es"),
      ),
    [services],
  );
  const visibleStepServices = activeServiceCategory
    ? services.filter((service) => (service.category?.trim() || "Otro") === activeServiceCategory)
    : services;
  const selectedEmployee = employees.find((employee) => employee.id === selectedSlot?.employeeId || employee.id === selectedEmployeeId) ?? null;
  // Profesional ya decidido para el cálculo de precio/duración: el del turno
  // elegido si ya se seleccionó horario, si no el elegido en el paso
  // "profesional" (salvo que sea "any" — "sin preferencia" usa el estándar,
  // ya que todavía no se sabe qué profesional va a tomar el turno).
  const pricingEmployeeId =
    selectedSlot?.employeeId ?? (selectedEmployeeId !== "any" ? selectedEmployeeId : null);
  // Promociones vigentes ahora mismo (activa, dentro de vigencia, día/hora
  // habilitado, cupo total no agotado) — se recalcula en cada render, es
  // barato y evita depender de un reloj propio.
  const validPromotions = React.useMemo(
    () => promotions.filter((p) => isPromotionCurrentlyValid(p, new Date())),
    [promotions],
  );
  const namedPromotions = validPromotions.filter((p) => !p.requiresCode);
  const hasCodePromotions = validPromotions.some((p) => p.requiresCode);
  const totalDuration =
    selectedServices.reduce((sum, service) => {
      const resolved = resolveServicePricing(
        { id: service.id, price: service.price, duration_min: service.duration_min ?? service.duration },
        pricingEmployeeId,
        employeeServiceOverrides,
      );
      return sum + resolved.duration_min;
    }, 0) || 30;
  // Precio con el override de Fase 1 ya resuelto pero SIN el descuento de
  // la promoción — se usa para mostrar el "tachado" cuando corresponde.
  const originalTotalPrice = selectedServices.reduce((sum, service) => {
    const resolved = resolveServicePricing(
      { id: service.id, price: service.price, duration_min: service.duration_min ?? service.duration },
      pricingEmployeeId,
      employeeServiceOverrides,
    );
    return sum + resolved.price;
  }, 0);
  const totalPrice = selectedServices.reduce((sum, service) => {
    const resolved = resolveServicePricing(
      { id: service.id, price: service.price, duration_min: service.duration_min ?? service.duration },
      pricingEmployeeId,
      employeeServiceOverrides,
    );
    const applies =
      appliedPromotion &&
      isPromotionApplicable(appliedPromotion, {
        serviceId: service.id,
        employeeId: pricingEmployeeId,
        category: service.category ?? null,
      });
    return sum + applyPromotionDiscount(resolved.price, applies ? appliedPromotion : null);
  }, 0);
  const promoSavings = originalTotalPrice - totalPrice;
  const selectedProducts = React.useMemo(
    () => selectedProductIds.map((id) => recommendedProducts.find((p) => p.id === id)).filter(Boolean) as RecommendedProduct[],
    [selectedProductIds, recommendedProducts],
  );
  const productsTotal = selectedProducts.reduce((sum, p) => sum + productFinalPrice(p), 0);
  const grandTotal = totalPrice + productsTotal;
  const originalGrandTotal = originalTotalPrice + productsTotal;
  const slots = React.useMemo(
    () =>
      buildSlots(
        schedule,
        appointments,
        employees,
        selectedEmployeeId,
        totalDuration,
        Math.max(1, reservationSettings.maxAdvance || 10),
        employeeSchedules,
        businessSpecial,
        employeeSpecial,
        reservationSettings.interval || 30,
      ),
    [
      schedule,
      appointments,
      employees,
      selectedEmployeeId,
      totalDuration,
      employeeSchedules,
      businessSpecial,
      employeeSpecial,
      reservationSettings.maxAdvance,
      reservationSettings.interval,
    ],
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

        const settingsPromise = supabase
          .from("public_booking_settings")
          .select("schedule")
          .eq("business_id", businessId)
          .maybeSingle();

        // El tema real (_branding.theme) se resuelve apenas responde esta consulta,
        // sin esperar a empleados/servicios/turnos. Así el loader nunca queda mostrando
        // un tema adivinado mientras el resto de los datos sigue en camino.
        settingsPromise
          .then((settingsRes) => {
            if (cancelled) return;
            const earlySchedule = settingsRes.error ? null : ((settingsRes.data as any)?.schedule ?? null);
            const earlyBranding =
              earlySchedule && typeof earlySchedule === "object" ? ((earlySchedule as Record<string, any>)._branding ?? {}) : {};
            setResolvedTheme(earlyBranding.theme === "light" ? "light" : "dark");
          }, () => {});

        // La ventana de turnos ocupados debe cubrir TODA la anticipación máxima
        // configurada (Configuración → Horarios → _settings.maxAdvance), no un
        // valor fijo — si no, los días más allá de ese valor fijo se muestran
        // como libres aunque tengan turnos reales.
        const settingsResForRange = await settingsPromise;
        const scheduleForRange = settingsResForRange.error ? null : ((settingsResForRange.data as any)?.schedule ?? null);
        const rawSettingsForRange =
          scheduleForRange && typeof scheduleForRange === "object"
            ? ((scheduleForRange as Record<string, any>)._settings ?? {})
            : {};
        const maxAdvanceDays = Math.max(1, Number(rawSettingsForRange.maxAdvance) || 10);

        const start = startOfDay(new Date()).toISOString();
        const end = addMinutes(startOfDay(new Date()), maxAdvanceDays * 24 * 60).toISOString();

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
          settingsPromise,
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
        const serviceImageMap =
          settingsSchedule && typeof settingsSchedule === "object"
            ? (((settingsSchedule as Record<string, unknown>)._catalogImages ?? {}) as Record<string, string>)
            : {};
        const serviceImagePositionMap =
          settingsSchedule && typeof settingsSchedule === "object"
            ? (((settingsSchedule as Record<string, unknown>)._catalogImagePositions ?? {}) as Record<string, string>)
            : {};
        const serviceImageOffsetMap = extractCatalogImageOffsets(settingsSchedule);
        // La vista public_booking_services no tiene columna `category` y
        // price_catalog no es legible por el rol anónimo — la categoría se
        // lee espejada desde business_settings.schedule._serviceCategories,
        // igual que las imágenes.
        const serviceCategoriesMap =
          settingsSchedule &&
          typeof settingsSchedule === "object" &&
          (settingsSchedule as Record<string, unknown>)._serviceCategories &&
          typeof (settingsSchedule as Record<string, unknown>)._serviceCategories === "object"
            ? ((settingsSchedule as Record<string, unknown>)._serviceCategories as Record<string, string>)
            : {};
        const visibleServices = ((servicesRes.error ? [] : (servicesRes.data ?? [])) as Service[])
          .filter((service) => service.is_active !== false)
          .filter((service) => visibility.services[service.id] !== false)
          .map((service) => ({
            ...service,
            image_url: serviceImageMap[service.id] ?? null,
            image_position: serviceImagePositionMap[service.id] ?? "50% 50%",
            image_offset: serviceImageOffsetMap[service.id] ?? null,
            category: serviceCategoriesMap[service.id] ?? null,
          }));

        if (!cancelled) {
          setBusiness(businessData as Business);
          setEmployees(visibleEmployees);
          setServices(visibleServices);
          setAppointments((appointmentsRes.error ? [] : (appointmentsRes.data ?? [])) as Appointment[]);
          setSchedule(normalizeSchedule(settingsSchedule));

          // Intervalo de turnos y anticipación máxima: siempre desde lo
          // configurado en el negocio, nunca un valor fijo.
          const rawReservationSettings =
            settingsSchedule && typeof settingsSchedule === "object"
              ? ((settingsSchedule as Record<string, any>)._settings ?? {})
              : {};
          setReservationSettings({
            interval: Number(rawReservationSettings.interval) || 30,
            maxAdvance: Math.max(1, Number(rawReservationSettings.maxAdvance) || 10),
          });

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

          const rawServiceOverrides =
            rawSchedule &&
            typeof rawSchedule._employeeServiceOverrides === "object" &&
            rawSchedule._employeeServiceOverrides
              ? (rawSchedule._employeeServiceOverrides as EmployeeServiceOverrideMap)
              : {};
          setEmployeeServiceOverrides(rawServiceOverrides);

          const rawPromotions =
            rawSchedule && Array.isArray(rawSchedule._promotions)
              ? (rawSchedule._promotions as Promotion[])
              : [];
          setPromotions(rawPromotions.map(backfillPromotionVigencia));

          setClientFields(extractClientFields(settingsSchedule));
          setRecommendedProducts(normalizeRecommendedProducts(settingsSchedule));
          setLandingColors((branding.colors && typeof branding.colors === "object" ? branding.colors : {}) as LandingColors);
          const resolvedLandingTheme: LandingTheme = branding.theme === "light" ? "light" : "dark";
          setLandingTheme(resolvedLandingTheme);
          setResolvedTheme(resolvedLandingTheme);

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
    setStep(validPromotions.length > 0 ? "promo" : "professional");
  }

  // Confirma la elección del paso "¿Tenés algún beneficio?": valida el
  // código si corresponde y determina appliedPromotion para el resto del
  // flujo. No filtra profesionales/servicios — si la promo no aplica a lo
  // elegido más adelante, simplemente no se descuenta ahí.
  function confirmPromoChoice() {
    setPromoCodeError("");
    if (promoChoice === "none") {
      setAppliedPromotion(null);
      setStep("professional");
      return;
    }
    if (promoChoice === "code") {
      const entered = enteredPromoCode.trim().toUpperCase();
      if (!entered) {
        setPromoCodeError("Ingresá un código.");
        return;
      }
      const match = validPromotions.find(
        (p) => p.requiresCode && p.code === entered,
      );
      if (!match) {
        setPromoCodeError("Ese código no es válido o ya no está vigente.");
        return;
      }
      setAppliedPromotion(match);
      setStep("professional");
      return;
    }
    const promo = validPromotions.find((p) => p.id === promoChoice) ?? null;
    setAppliedPromotion(promo);
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
    if (!clientFirstName.trim()) return toast.error("Ingresá tu nombre.");
    if (!clientLastName.trim()) return toast.error("Ingresá tu apellido.");
    if (!clientPhone.trim()) return toast.error("Ingresá tu teléfono.");
    if (!clientEmail.trim()) return toast.error("Ingresá tu email.");
    if (clientFields.fecha_nacimiento && !clientBirthDate) return toast.error("Ingresá tu fecha de nacimiento.");
    if (!sourceAlreadyKnown && !acquisitionSource) return toast.error("Contanos cómo nos conociste.");
    if (!sourceAlreadyKnown && acquisitionChannelRequiresText(acquisitionSource) && !acquisitionCustom.trim())
      return toast.error("Contanos dónde nos conociste.");

    // Límite por cliente: recién acá se conocen teléfono/email. Si esta
    // promo es "una vez por cliente" y este cliente ya la usó, se descarta
    // solo para esta reserva (la reserva sigue, sin el descuento) — no
    // bloquea el turno en sí.
    const clientKeys = normalizeClientKeys(clientPhone, clientEmail);
    let effectivePromotion = appliedPromotion;
    if (effectivePromotion && hasClientReachedPerClientLimit(effectivePromotion, clientKeys)) {
      toast.error("Esa promoción ya la usaste antes. Vamos a confirmar la reserva sin el descuento.");
      effectivePromotion = null;
      setAppliedPromotion(null);
    }

    // Recalculado local (no el memo reactivo `totalPrice`) porque
    // `effectivePromotion` puede diferir de `appliedPromotion` recién acá,
    // por el chequeo de límite por cliente de arriba.
    function resolveServicesTotal(promo: Promotion | null): number {
      return selectedServices.reduce((sum, service) => {
        const resolved = resolveServicePricing(
          { id: service.id, price: service.price, duration_min: service.duration_min ?? service.duration },
          selectedSlot!.employeeId,
          employeeServiceOverrides,
        );
        const applies =
          promo &&
          isPromotionApplicable(promo, {
            serviceId: service.id,
            employeeId: selectedSlot!.employeeId,
            category: service.category ?? null,
          });
        return sum + applyPromotionDiscount(resolved.price, applies ? promo : null);
      }, 0);
    }
    const finalServicesPrice = resolveServicesTotal(effectivePromotion);
    const originalServicesPrice = resolveServicesTotal(null);

    const serviceName = selectedServices.map((service) => service.name).join(" + ");
    const serviceList = selectedServices
      .map((service) => {
        const resolved = resolveServicePricing(
          { id: service.id, price: service.price, duration_min: service.duration_min ?? service.duration },
          selectedSlot.employeeId,
          employeeServiceOverrides,
        );
        return `${service.name} (${formatMoney(resolved.price)})`;
      })
      .join("\n- ");
    const addedProducts = selectedProducts.map((p) => ({ name: p.name, price: productFinalPrice(p), image: p.image || "" }));
    const productList = addedProducts.map((p) => `${p.name} (${formatMoney(p.price)})${p.image ? ` [img:${p.image}]` : ""}`).join("\n- ");
    const promoNote =
      effectivePromotion && finalServicesPrice < originalServicesPrice
        ? `Promoción aplicada: ${effectivePromotion.name} (-${formatMoney(originalServicesPrice - finalServicesPrice)})`
        : null;
    const publicNotes = [
      clientEmail.trim() ? `Email: ${clientEmail.trim()}` : null,
      clientBirthDate ? `Fecha de nacimiento: ${clientBirthDate}` : null,
      selectedServices.length > 1 ? `Servicios seleccionados:\n- ${serviceList}` : null,
      addedProducts.length ? `Productos agregados:\n- ${productList}` : null,
      promoNote,
      "Origen: reserva online",
    ].filter(Boolean).join("\n\n");

    const confirmationSnapshot = {
      services: selectedServices.map((service) => service.name).join(" + "),
      professional: selectedEmployee?.full_name ?? "Sin preferencia",
      date: formatDay(selectedSlot.time),
      time: formatTime(selectedSlot.time),
      duration: totalDuration,
      total: finalServicesPrice + productsTotal,
      originalTotal: originalServicesPrice + productsTotal,
      promotionName: promoNote ? effectivePromotion!.name : undefined,
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
        p_acquisition_source: !sourceAlreadyKnown && acquisitionSource ? acquisitionSource : null,
        p_acquisition_source_custom: !sourceAlreadyKnown && acquisitionChannelRequiresText(acquisitionSource) ? acquisitionCustom.trim() : null,
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

      // El RPC create_public_booking_public_v3 (no versionado en este repo)
      // calcula precio/duración del lado del servidor a partir del precio
      // estándar de price_catalog, sin conocer los overrides por
      // profesional ni las promociones. Si el profesional elegido tiene un
      // override para algún servicio, o se aplicó una promoción,
      // corregimos acá con un UPDATE normal — mismo mecanismo que usa el
      // resto de la app — para que el turno creado quede con el
      // precio/duración reales. Si las políticas RLS no permiten que un
      // cliente público actualice la fila que el propio RPC acaba de crear,
      // este update va a fallar en silencio (solo un warning en consola) y
      // el turno queda con el precio estándar del RPC — haría falta un
      // ajuste de RLS/RPC del lado de Supabase para cerrar ese caso.
      const hasEmployeeOverride = selectedServices.some((service) => {
        const resolved = resolveServicePricing(
          { id: service.id, price: service.price, duration_min: service.duration_min ?? service.duration },
          selectedSlot.employeeId,
          employeeServiceOverrides,
        );
        return resolved.priceOverridden || resolved.durationOverridden;
      });
      const needsPriceCorrection =
        hasEmployeeOverride || finalServicesPrice !== originalServicesPrice;
      if (needsPriceCorrection && confirmationSnapshot.appointmentId) {
        const { error: overrideUpdateError } = await supabase
          .from("appointments")
          .update({
            service_price: finalServicesPrice,
            duration_min: totalDuration,
            ends_at: end.toISOString(),
            notes: publicNotes || null,
          })
          .eq("id", confirmationSnapshot.appointmentId);
        if (overrideUpdateError) {
          console.warn(
            "No se pudo aplicar el precio/duración/promoción del turno de reserva pública (posible restricción de RLS):",
            overrideUpdateError.message,
          );
        }
      }

      // Incremento best-effort del contador de usos de la promo (mismo
      // read-modify-write que el resto de business_settings.schedule en
      // esta app — riesgo de concurrencia ya documentado y aceptado en el
      // plan, no bloqueante para el volumen de un negocio de barbería).
      if (promoNote && effectivePromotion) {
        try {
          const { data: bsRow } = await supabase
            .from("business_settings")
            .select("schedule")
            .eq("business_id", business.id)
            .maybeSingle();
          const existingSchedule = (bsRow?.schedule ?? {}) as Record<string, unknown>;
          const existingPromotions = Array.isArray(existingSchedule._promotions)
            ? (existingSchedule._promotions as Promotion[])
            : [];
          const updatedPromotions = existingPromotions.map((p) => {
            if (p.id !== effectivePromotion!.id) return p;
            const nextUsedByClient = { ...p.usedByClient };
            for (const key of clientKeys) {
              nextUsedByClient[key] = (nextUsedByClient[key] ?? 0) + 1;
            }
            return { ...p, usageCount: p.usageCount + 1, usedByClient: nextUsedByClient };
          });
          await supabase
            .from("business_settings")
            .upsert(
              { business_id: business.id, schedule: { ...existingSchedule, _promotions: updatedPromotions } },
              { onConflict: "business_id" },
            );
        } catch (usageError) {
          console.warn("No se pudo actualizar el contador de usos de la promoción:", usageError);
        }
      }

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
    if (resolvedTheme === null) return null;
    return <ClipprLoader fullScreen size="lg" background={resolvedTheme} />;
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
  const hasPromoStep = validPromotions.length > 0;
  const promoOffset = hasPromoStep ? 1 : 0;
  const totalSteps = 4 + (hasProducts ? 1 : 0) + promoOffset;
  const stepIndex =
    step === "services" ? 1 :
    step === "promo" ? 2 :
    step === "professional" ? 1 + promoOffset + 1 :
    step === "datetime" ? 1 + promoOffset + 2 :
    step === "products" ? 1 + promoOffset + 3 :
    step === "details" ? 1 + promoOffset + (hasProducts ? 4 : 3) :
    totalSteps;
  const professionalOptionCount = employees.length + 1;

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
      <section
        className={cn(
          "relative w-full overflow-hidden border-b",
          isLight ? "border-white/10 bg-black" : "border-gray-200 bg-white",
        )}
      >
        <div className="relative flex w-full items-center justify-center px-4 py-0.5 sm:py-1">
          <div className="inline-flex items-center justify-center gap-3">
            <span
              className="text-[10px] font-medium sm:text-[11px]"
              style={
                isLight
                  ? { color: "rgba(255,255,255,0.62)", WebkitTextFillColor: "rgba(255,255,255,0.62)" }
                  : { color: "#4B5563", WebkitTextFillColor: "#4B5563" }
              }
            >
              Impulsado por
            </span>
            <img
              src="/clippr-powered-logo.webp"
              alt="Clippr"
              loading="eager"
              decoding="async"
              className="h-7 w-7 rounded-lg object-contain sm:h-8 sm:w-8"
            />
            <span
              className="text-base font-bold tracking-tight sm:text-lg"
              style={
                isLight
                  ? { color: "#ffffff", WebkitTextFillColor: "#ffffff" }
                  : { color: "#111827", WebkitTextFillColor: "#111827" }
              }
            >
              Clippr
            </span>
          </div>
        </div>
      </section>

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
                      {step === "promo" && "¿Tenés algún beneficio?"}
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
                    if (step === "promo") setStep("services");
                    if (step === "professional") setStep(hasPromoStep ? "promo" : "services");
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
                  {serviceCategories.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <button
                        type="button"
                        onClick={() => setActiveServiceCategory(null)}
                        className="shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition"
                        style={
                          activeServiceCategory === null
                            ? { background: accent, color: accentButtonText }
                            : { background: "rgba(255,255,255,0.06)", color: "inherit" }
                        }
                      >
                        Todos
                      </button>
                      {serviceCategories.map((category) => (
                        <button
                          key={category}
                          type="button"
                          onClick={() => setActiveServiceCategory(category)}
                          className="shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition"
                          style={
                            activeServiceCategory === category
                              ? { background: accent, color: accentButtonText }
                              : { background: "rgba(255,255,255,0.06)", color: "inherit" }
                          }
                        >
                          {category}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02]">
                    {visibleStepServices.map((service) => {
                      const checked = selectedServiceIds.includes(service.id);
                      // Mismo resolver que el resto de la app: rango de
                      // duración y precio entre los profesionales visibles
                      // para este servicio. "30 min · $20.000" si no hay
                      // variación, "30–60 min · Desde $20.000" si la hay —
                      // ver formatServiceRangeLabel en src/lib/service-pricing.ts.
                      const range = getServiceRange(
                        { id: service.id, price: service.price, duration_min: service.duration_min ?? service.duration },
                        employees.map((e) => e.id),
                        employeeServiceOverrides,
                      );
                      return (
                        <button key={service.id} type="button" onClick={() => toggleService(service.id)} className="flex w-full items-center justify-between gap-4 p-4 text-left transition hover:bg-white/[0.04]">
                          <span className="flex min-w-0 items-center gap-3">
                            <ServiceImage
                              src={service.image_url}
                              alt={service.name}
                              position={service.image_position}
                              className="h-20 w-20 rounded-xl bg-white/[0.06] ring-1 ring-white/10"
                              fallback={<Scissors className="h-4 w-4 text-white/30" />}
                            />
                            <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border", checked ? "border-transparent text-white" : "border-white/20")} style={checked ? { background: accent } : undefined}>
                              {checked ? <CheckCircle2 className="h-4 w-4" /> : null}
                            </span>
                            <span>
                              <span className="block font-medium">{service.name}</span>
                              <span className="text-sm text-white/50">{formatServiceRangeLabel(range, formatMoney)}</span>
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <Button onClick={nextFromServices} className="w-full rounded-2xl py-6 font-bold text-white hover:brightness-110" style={{ background: accent, color: accentButtonText }}>
                    Continuar
                  </Button>
                </div>
              ) : null}

              {step === "promo" ? (
                <div className="mt-5 space-y-3">
                  <button
                    type="button"
                    onClick={() => setPromoChoice("none")}
                    className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-left transition hover:bg-white/[0.04]"
                  >
                    <span
                      className={cn(
                        "grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                        promoChoice === "none" ? "border-transparent" : "border-white/25",
                      )}
                      style={promoChoice === "none" ? { background: accent } : undefined}
                    >
                      {promoChoice === "none" && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                    </span>
                    <span className="font-medium">Sin beneficio</span>
                  </button>

                  {namedPromotions.map((promo) => {
                    const remaining = getPromotionUsesRemaining(promo);
                    return (
                      <div
                        key={promo.id}
                        className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-4"
                      >
                        <button
                          type="button"
                          onClick={() => setPromoChoice(promo.id)}
                          className="flex flex-1 items-center gap-3 text-left"
                        >
                          <span
                            className={cn(
                              "grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                              promoChoice === promo.id ? "border-transparent" : "border-white/25",
                            )}
                            style={promoChoice === promo.id ? { background: accent } : undefined}
                          >
                            {promoChoice === promo.id && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{promo.name}</span>
                            {remaining != null && (
                              <span className="block text-xs text-white/50">
                                {remaining} disponibles
                              </span>
                            )}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setInfoModalPromo(promo)}
                          className="shrink-0 rounded-full p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
                        >
                          <Info className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}

                  {hasCodePromotions && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                      <button
                        type="button"
                        onClick={() => setPromoChoice("code")}
                        className="flex w-full items-center gap-3 text-left"
                      >
                        <span
                          className={cn(
                            "grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                            promoChoice === "code" ? "border-transparent" : "border-white/25",
                          )}
                          style={promoChoice === "code" ? { background: accent } : undefined}
                        >
                          {promoChoice === "code" && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                          )}
                        </span>
                        <span className="font-medium">Tengo un código de descuento</span>
                      </button>
                      {promoChoice === "code" && (
                        <div className="mt-3">
                          <Label className="text-xs text-white/60">Código de descuento</Label>
                          <Input
                            value={enteredPromoCode}
                            onChange={(e) => {
                              setEnteredPromoCode(e.target.value.toUpperCase());
                              setPromoCodeError("");
                            }}
                            placeholder="UADE20"
                            className="mt-1.5 uppercase"
                          />
                          {promoCodeError && (
                            <p className="mt-1.5 text-xs text-rose-400">{promoCodeError}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <Button
                    onClick={confirmPromoChoice}
                    className="w-full rounded-2xl py-6 font-bold text-white hover:brightness-110"
                    style={{ background: accent, color: accentButtonText }}
                  >
                    Continuar
                  </Button>
                </div>
              ) : null}

              {infoModalPromo ? (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
                  onClick={() => setInfoModalPromo(null)}
                >
                  <div
                    className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-3xl border border-white/10 bg-zinc-950"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-start justify-between gap-3 p-5 pb-0">
                      <h3 className="text-lg font-semibold">{infoModalPromo.name}</h3>
                      <button
                        type="button"
                        onClick={() => setInfoModalPromo(null)}
                        className="shrink-0 rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="overflow-y-auto p-5 pt-3">
                      {infoModalPromo.imageUrl && (
                        <img
                          src={infoModalPromo.imageUrl}
                          alt={infoModalPromo.name}
                          className="h-40 w-full rounded-2xl object-cover"
                        />
                      )}
                      {infoModalPromo.description && (
                        <p className="mt-3 text-sm text-white/70">{infoModalPromo.description}</p>
                      )}
                      <p className="mt-3 text-xs text-white/50">
                        {formatPromotionConditions(infoModalPromo, formatMoney)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {step === "professional" ? (
                <div
                  className={cn(
                    "mt-5 grid gap-3",
                    professionalOptionCount <= 3 && "grid-cols-1",
                    professionalOptionCount >= 4 && professionalOptionCount <= 6 && "grid-cols-2 sm:grid-cols-3",
                    professionalOptionCount >= 7 && professionalOptionCount <= 12 && "grid-cols-3 sm:grid-cols-4",
                    professionalOptionCount >= 13 && "grid-cols-3 sm:grid-cols-6",
                    professionalOptionCount >= 19 && "max-h-[58vh] overflow-y-auto pr-1",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => { setSelectedEmployeeId("any"); setSelectedSlot(null); setStep("datetime"); }}
                    className={cn(
                      "flex min-w-0 flex-col items-center justify-center gap-2 rounded-3xl border border-white/10 bg-white/[0.03] text-center transition hover:border-white/30 hover:bg-white/[0.055]",
                      professionalOptionCount >= 7 ? "min-h-[116px] p-3" : "min-h-[128px] p-4",
                    )}
                  >
                    <span
                      className={cn(
                        "grid shrink-0 place-items-center rounded-2xl",
                        professionalOptionCount >= 7 ? "h-10 w-10" : "h-12 w-12",
                      )}
                      style={{ background: `${accent}22`, color: accent }}
                    >
                      <UsersRound className={cn(professionalOptionCount >= 7 ? "h-5 w-5" : "h-6 w-6")} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">Sin preferencia</span>
                      <span className="block truncate text-xs text-white/55">Disponible</span>
                    </span>
                  </button>

                  {employees.map((employee) => {
                    // Precio y duración reales para ESTE profesional (mismo
                    // resolver que el resto de la app), para que el cliente
                    // vea de entrada si le conviene uno u otro.
                    const employeeTotals = selectedServices.reduce(
                      (acc, service) => {
                        const resolved = resolveServicePricing(
                          { id: service.id, price: service.price, duration_min: service.duration_min ?? service.duration },
                          employee.id,
                          employeeServiceOverrides,
                        );
                        const applies =
                          appliedPromotion &&
                          isPromotionApplicable(appliedPromotion, {
                            serviceId: service.id,
                            employeeId: employee.id,
                            category: service.category ?? null,
                          });
                        const finalPrice = applyPromotionDiscount(
                          resolved.price,
                          applies ? appliedPromotion : null,
                        );
                        return {
                          price: acc.price + finalPrice,
                          originalPrice: acc.originalPrice + resolved.price,
                          duration: acc.duration + resolved.duration_min,
                        };
                      },
                      { price: 0, originalPrice: 0, duration: 0 },
                    );
                    return (
                      <button
                        key={employee.id}
                        type="button"
                        onClick={() => { setSelectedEmployeeId(employee.id); setSelectedSlot(null); setStep("datetime"); }}
                        className={cn(
                          "flex min-w-0 flex-col items-center justify-center gap-2 rounded-3xl border border-white/10 bg-white/[0.03] text-center transition hover:border-white/30 hover:bg-white/[0.055]",
                          professionalOptionCount >= 7 ? "min-h-[116px] p-3" : "min-h-[128px] p-4",
                        )}
                      >
                        <span
                          className={cn(
                            "grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/10",
                            professionalOptionCount >= 7 ? "h-11 w-11" : "h-12 w-12",
                          )}
                        >
                          {employee.avatar_url ? (
                            <img loading="lazy" decoding="async" src={employee.avatar_url} alt={employee.full_name} className="h-full w-full object-cover" />
                          ) : (
                            <UserRound className={cn(professionalOptionCount >= 7 ? "h-5 w-5" : "h-6 w-6")} />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{employee.full_name}</span>
                          <span className="block truncate text-xs text-white/55">{employee.role?.trim() || "Profesional"}</span>
                          {selectedServices.length > 0 && (
                            <span className="block truncate text-xs text-white/70">
                              {employeeTotals.duration} min ·{" "}
                              {employeeTotals.price < employeeTotals.originalPrice ? (
                                <>
                                  <span className="line-through text-white/40">
                                    {formatMoney(employeeTotals.originalPrice)}
                                  </span>{" "}
                                  {formatMoney(employeeTotals.price)}
                                </>
                              ) : (
                                formatMoney(employeeTotals.price)
                              )}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
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
                          max={formatInputDate(addMinutes(new Date(), (Math.max(1, reservationSettings.maxAdvance) - 1) * 24 * 60))}
                          value={selectedDay ? formatInputDate(selectedDay.date) : ""}
                          onChange={(event) => {
                            const index = availableDays.findIndex((day) => formatInputDate(day.date) === event.target.value);
                            if (index >= 0) {
                              setSelectedDayIndex(index);
                              setSelectedSlot(null);
                              setShowDatePicker(false);
                              return;
                            }
                            // No hay slots ese día específico: puede ser porque el
                            // negocio está cerrado / sin cupo (día dentro del rango
                            // permitido), o porque la fecha está fuera del rango de
                            // anticipación configurado. Distinguimos ambos casos en
                            // vez de mostrar siempre el mismo mensaje genérico.
                            const withinConfiguredRange = slots.some(
                              (day) => formatInputDate(day.date) === event.target.value,
                            );
                            toast.error(
                              withinConfiguredRange
                                ? "Ese día no tiene horarios disponibles."
                                : "Esa fecha está fuera del rango de anticipación permitido para reservar.",
                            );
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

                          {/* Imagen grande — misma posición guardada en Configuración → Catálogo, sin recentrar */}
                          <ServiceImage
                            src={product.image}
                            alt={product.name}
                            position={product.image_position}
                            className="aspect-[1/1] w-full rounded-xl bg-white/[0.04]"
                            fallback={<ShoppingBag className="h-12 w-12 text-white/30" />}
                          />

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
                    <div className="space-y-2"><Label htmlFor="clientFirstName">Nombre *</Label><Input id="clientFirstName" value={clientFirstName} onChange={(event) => setClientFirstName(event.target.value)} className="border-white/10 bg-white/[0.04] text-white" placeholder="Tu nombre" /></div>
                    <div className="space-y-2"><Label htmlFor="clientLastName">Apellido *</Label><Input id="clientLastName" value={clientLastName} onChange={(event) => setClientLastName(event.target.value)} className="border-white/10 bg-white/[0.04] text-white" placeholder="Tu apellido" /></div>
                    <div className="space-y-2"><Label htmlFor="clientPhone">Teléfono *</Label><Input id="clientPhone" value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} className="border-white/10 bg-white/[0.04] text-white" placeholder="11 1234-5678" /></div>
                    <div className="space-y-2"><Label htmlFor="clientEmail">Email *</Label><Input id="clientEmail" type="email" value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} className="border-white/10 bg-white/[0.04] text-white" placeholder="tu@email.com" /></div>
                    {clientFields.fecha_nacimiento ? <div className="space-y-2"><Label htmlFor="clientBirthDate">Fecha de nacimiento *</Label><Input id="clientBirthDate" type="date" value={clientBirthDate} onChange={(event) => setClientBirthDate(event.target.value)} className="border-white/10 bg-white/[0.04] text-white" /></div> : null}
                  </div>
                  {!sourceAlreadyKnown ? (
                    <AcquisitionSourceField
                      value={acquisitionSource}
                      onChange={setAcquisitionSource}
                      customValue={acquisitionCustom}
                      onCustomChange={setAcquisitionCustom}
                      showLabel
                      otroBelow
                      triggerClassName="border-white/10 bg-white/[0.04] text-white"
                      inputClassName="border-white/10 bg-white/[0.04] text-white"
                    />
                  ) : null}
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
                        <div className="text-right">
                          {confirmedBooking &&
                          confirmedBooking.originalTotal > confirmedBooking.total ? (
                            <>
                              <span className={cn("mr-2 text-base line-through", isLight ? "text-slate-400" : "text-white/40")}>
                                {formatMoney(confirmedBooking.originalTotal)}
                              </span>
                              <span className={cn("text-3xl font-black tracking-tight", isLight ? "text-slate-950" : "text-white")}>
                                {formatMoney(confirmedBooking.total)}
                              </span>
                              <p className={cn("mt-0.5 text-xs font-semibold", isLight ? "text-emerald-600" : "text-emerald-400")}>
                                Ahorrás {formatMoney(confirmedBooking.originalTotal - confirmedBooking.total)}
                              </p>
                            </>
                          ) : (
                            <span className={cn("text-3xl font-black tracking-tight", isLight ? "text-slate-950" : "text-white")}>
                              {formatMoney(confirmedBooking?.total ?? grandTotal)}
                            </span>
                          )}
                        </div>
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
                {appliedPromotion ? (
                  <div className="border-t border-white/10 pt-4">
                    <p className="text-white/40">Beneficio</p>
                    <p className="mt-1 font-medium text-white">{appliedPromotion.name}</p>
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-t border-white/10 pt-4">
                  <span>Total</span>
                  {promoSavings > 0 ? (
                    <span className="text-right">
                      <span className="mr-2 text-sm text-white/40 line-through">{formatMoney(originalGrandTotal)}</span>
                      <span className="text-lg font-semibold text-white">{formatMoney(grandTotal)}</span>
                      <span className="block text-xs font-semibold text-emerald-400">Ahorrás {formatMoney(promoSavings)}</span>
                    </span>
                  ) : (
                    <span className="text-lg font-semibold text-white">{formatMoney(grandTotal)}</span>
                  )}
                </div>
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
