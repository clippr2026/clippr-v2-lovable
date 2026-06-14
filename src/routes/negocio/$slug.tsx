import { createFileRoute, Link } from "@tanstack/react-router";
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Info,
  Instagram,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/negocio/$slug")({
  head: () => ({
    meta: [
      { title: "Perfil del negocio — Clippr" },
      { name: "description", content: "Conocé el local, sus servicios y reservá tu turno online." },
    ],
  }),
  component: PublicProfilePage,
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
  avatar_url?: string | null;
  cover_url?: string | null;
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
  is_active?: boolean | null;
};

type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
type DaySchedule = { enabled: boolean; start: string; end: string };
type ScheduleMap = Record<DayKey, DaySchedule>;
type LandingColors = { primary?: string; secondary?: string; accent?: string };
type LandingTheme = "dark" | "light";
type PublicBranding = {
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  instagram?: string | null;
  website?: string | null;
  description?: string | null;
  profile_note?: string | null;
  portfolio_urls?: string[] | null;
  colors?: LandingColors | null;
  theme?: LandingTheme | null;
};

const DISPLAY_DAYS: { key: DayKey; label: string; short: string }[] = [
  { key: "mon", label: "Lunes", short: "lunes" },
  { key: "tue", label: "Martes", short: "martes" },
  { key: "wed", label: "Miércoles", short: "miércoles" },
  { key: "thu", label: "Jueves", short: "jueves" },
  { key: "fri", label: "Viernes", short: "viernes" },
  { key: "sat", label: "Sábado", short: "sábado" },
  { key: "sun", label: "Domingo", short: "domingo" },
];

const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function extractBranding(schedule: unknown): PublicBranding {
  if (!schedule || typeof schedule !== "object") return {};
  const branding = (schedule as Record<string, any>)._branding;
  return branding && typeof branding === "object" ? branding : {};
}

function normalizePortfolio(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((url): url is string => typeof url === "string" && url.trim().length > 0).slice(0, 3)
    : [];
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

function normalizeSchedule(value: unknown): ScheduleMap | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, any>;
  let found = false;
  const next = {} as ScheduleMap;
  for (const key of DAY_KEYS) {
    const day = source[key];
    if (day && typeof day === "object") {
      found = true;
      next[key] = {
        enabled: day.enabled !== false,
        start: typeof day.start === "string" ? day.start : "09:00",
        end: typeof day.end === "string" ? day.end : "20:00",
      };
    } else {
      next[key] = { enabled: false, start: "09:00", end: "20:00" };
    }
  }
  return found ? next : null;
}

function getTodayKey(): DayKey {
  const jsDay = new Date().getDay();
  return DAY_KEYS[jsDay] ?? "mon";
}

function minutesFromTime(value: string) {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function getTodayStatus(schedule: ScheduleMap | null) {
  if (!schedule) return "Consultá disponibilidad al reservar";
  const todayKey = getTodayKey();
  const today = schedule[todayKey];
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (today?.enabled) {
    const start = minutesFromTime(today.start);
    const end = minutesFromTime(today.end);
    if (currentMinutes < start) return `Cerrado · Abre hoy a las ${today.start}`;
    if (currentMinutes <= end) return `Abierto · Cierra hoy a las ${today.end}`;
  }

  for (let offset = 1; offset <= 7; offset += 1) {
    const key = DAY_KEYS[(DAY_KEYS.indexOf(todayKey) + offset) % DAY_KEYS.length];
    const next = schedule[key];
    if (next?.enabled) {
      const label = offset === 1 ? "mañana" : DISPLAY_DAYS.find((day) => day.key === key)?.short ?? "próximo día";
      return `Cerrado · Abre ${label} a las ${next.start}`;
    }
  }
  return "Cerrado";
}

function mapsUrl(address?: string | null) {
  if (!address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function cleanInstagram(value?: string | null) {
  return value?.replace(/^@/, "").trim() ?? "";
}

function FiveStars({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-1" aria-label="5 estrellas">
      {Array.from({ length: 5 }).map((_, index) => (
        <Star key={index} className={compact ? "h-3.5 w-3.5 fill-current" : "h-4 w-4 fill-current"} />
      ))}
    </div>
  );
}

// Tarjeta oscura con un glow de color muy sutil detrás (estilo Stripe/Linear/Raycast).
// No cambia el fondo de la tarjeta; sólo agrega luz difusa con los colores configurados.
function GlowCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-1 rounded-[2rem] opacity-[0.10] blur-2xl"
        style={{
          background:
            "radial-gradient(60% 70% at 18% 0%, var(--c-primary), transparent 70%), radial-gradient(55% 70% at 100% 100%, var(--c-secondary), transparent 70%)",
        }}
      />
      <div className={"public-card relative rounded-3xl border shadow-xl " + className}>
        {children}
      </div>
    </div>
  );
}

function PublicProfilePage() {
  const { slug } = Route.useParams();

  const [loading, setLoading] = React.useState(true);
  const [business, setBusiness] = React.useState<Business | null>(null);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [services, setServices] = React.useState<Service[]>([]);
  const [schedule, setSchedule] = React.useState<ScheduleMap | null>(null);
  const [portfolioUrls, setPortfolioUrls] = React.useState<string[]>([]);
  const [description, setDescription] = React.useState<string>("");
  const [profileNote, setProfileNote] = React.useState<string>("");
  const [colors, setColors] = React.useState<LandingColors>({});
  const [theme, setTheme] = React.useState<LandingTheme>("dark");
  const [selectedPortfolioIndex, setSelectedPortfolioIndex] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const businessQuery = supabase
          .from("public_booking_businesses")
          .select("id,name,slug,address,phone,email,instagram,logo_url,accent_color,avatar_url,cover_url");

        const { data: businessData, error: businessError } = await (isUuid(slug)
          ? businessQuery.eq("id", slug).maybeSingle()
          : businessQuery.eq("slug", slug).maybeSingle());

        if (businessError) throw new Error(businessError.message);
        if (!businessData) {
          if (!cancelled) setBusiness(null);
          return;
        }

        const businessId = businessData.id as string;

        const [employeesWithRoleRes, servicesRes] = await Promise.all([
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
        ]);

        // Algunas bases todavía tienen la vista public_booking_employees sin la columna role.
        // Si pedimos role y Supabase devuelve error, hacemos fallback sin role para no ocultar profesionales.
        const employeesRes = employeesWithRoleRes.error
          ? await supabase
              .from("public_booking_employees")
              .select("id,full_name,avatar_url,is_active")
              .eq("business_id", businessId)
              .order("full_name", { ascending: true })
          : employeesWithRoleRes;

        let settingsSchedule: unknown = null;
        const publicSettingsRes = await supabase
          .from("public_booking_settings")
          .select("schedule")
          .eq("business_id", businessId)
          .maybeSingle();
        if (!publicSettingsRes.error) {
          settingsSchedule = (publicSettingsRes.data as any)?.schedule ?? null;
        } else {
          const fallbackSettingsRes = await supabase
            .from("business_settings")
            .select("schedule")
            .eq("business_id", businessId)
            .maybeSingle();
          if (!fallbackSettingsRes.error) settingsSchedule = (fallbackSettingsRes.data as any)?.schedule ?? null;
        }

        // La página pública no debe caer completa si una vista secundaria falla.
        // Primero mostramos el negocio y degradamos servicios/equipo con elegancia.
        console.warn("Public profile secondary data", {
          employeesError: employeesRes.error?.message,
          servicesError: servicesRes.error?.message,
        });

        const branding = extractBranding(settingsSchedule);
        const mergedBusiness = {
          ...(businessData as Business),
          address: branding.address || (businessData as Business).address,
          phone: branding.phone || (businessData as Business).phone,
          email: branding.email || (businessData as Business).email,
          instagram: branding.instagram || (businessData as Business).instagram,
        };

        const visibility = extractPublicVisibility(settingsSchedule);

        if (!cancelled) {
          setBusiness(mergedBusiness as Business);
          const employeeRoles =
            settingsSchedule && typeof settingsSchedule === "object" && (settingsSchedule as Record<string, unknown>)._employeeRoles &&
            typeof (settingsSchedule as Record<string, unknown>)._employeeRoles === "object"
              ? ((settingsSchedule as Record<string, unknown>)._employeeRoles as Record<string, string>)
              : {};
          setEmployees(
            (employeesRes.error ? [] : ((employeesRes.data ?? []) as Employee[]))
              .filter((employee) => employee.is_active !== false)
              .map((employee) => ({ ...employee, role: employee.role ?? employeeRoles[employee.id] ?? null })),
          );
          setServices(
            (servicesRes.error ? [] : ((servicesRes.data ?? []) as Service[]))
              .filter((service) => service.is_active !== false)
              .filter((service) => visibility.services[service.id] !== false),
          );
          setSchedule(normalizeSchedule(settingsSchedule));
          setPortfolioUrls(normalizePortfolio(branding.portfolio_urls));
          setDescription(typeof branding.description === "string" ? branding.description.trim() : "");
          setProfileNote(typeof branding.profile_note === "string" ? branding.profile_note.trim().slice(0, 80) : "");
          setColors((branding.colors && typeof branding.colors === "object" ? branding.colors : {}) as LandingColors);
          setTheme(branding.theme === "light" ? "light" : "dark");
        }
      } catch {
        if (!cancelled) setBusiness(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const cPrimary = colors.primary || business?.accent_color || "#d6b66a";
  const cSecondary = colors.secondary || "#7c3aed";
  const cAccent = colors.accent || cPrimary;
  const accent = cAccent; // acciones principales: botones, estados e indicadores
  const isLight = theme === "light";
  const portfolio = portfolioUrls;
  const selectedPortfolio = selectedPortfolioIndex !== null ? portfolio[selectedPortfolioIndex] : null;
  const openPortfolio = (index: number) => setSelectedPortfolioIndex(index);
  const closePortfolio = () => setSelectedPortfolioIndex(null);
  const showPrevPortfolio = () => {
    if (!portfolio.length) return;
    setSelectedPortfolioIndex((current) => {
      const index = current ?? 0;
      return (index - 1 + portfolio.length) % portfolio.length;
    });
  };
  const showNextPortfolio = () => {
    if (!portfolio.length) return;
    setSelectedPortfolioIndex((current) => {
      const index = current ?? 0;
      return (index + 1) % portfolio.length;
    });
  };

  if (loading) {
    return (
      <main className="min-h-dvh bg-[#08070c] text-white grid place-items-center px-4">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl">
          <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: accent }} />
          <p className="mt-4 text-sm text-white/60">Cargando perfil...</p>
        </div>
      </main>
    );
  }

  if (!business) {
    return (
      <main className="min-h-dvh bg-[#08070c] text-white grid place-items-center px-4">
        <Card className="max-w-md border-white/10 bg-white/[0.04] text-white">
          <CardContent className="p-8 text-center">
            <h1 className="text-2xl font-semibold">Página no encontrada</h1>
            <p className="mt-2 text-sm text-white/60">No encontramos este local en Clippr.</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const reservarTo = { to: "/reservar/$slug" as const, params: { slug } };
  const bookingHref = (query?: Record<string, string>) => {
    const params = query ? `?${new URLSearchParams(query).toString()}` : "";
    return `/reservar/${encodeURIComponent(slug)}${params}`;
  };
  const mapLink = mapsUrl(business.address);
  const instagram = cleanInstagram(business.instagram);
  const todayStatus = getTodayStatus(schedule);
  const todayKey = getTodayKey();
  const isOpen = todayStatus.startsWith("Abierto");

  return (
    <main
      data-theme={theme}
      className="public-landing min-h-dvh pb-24 sm:pb-10"
      style={{
        ["--accent" as any]: accent,
        ["--c-primary" as any]: cPrimary,
        ["--c-secondary" as any]: cSecondary,
        ["--c-accent" as any]: cAccent,
        ["--page-bg" as any]: isLight ? "#f6f7fb" : "#08070c",
        ["--card-bg" as any]: isLight ? "rgba(255,255,255,0.86)" : "rgba(255,255,255,0.04)",
        ["--text" as any]: isLight ? "#111827" : "#ffffff",
        ["--muted" as any]: isLight ? "rgba(17,24,39,0.62)" : "rgba(255,255,255,0.60)",
        ["--border" as any]: isLight ? "rgba(15,23,42,0.10)" : "rgba(255,255,255,0.10)",
      }}
    >
      <style>{`
        .public-landing { background: var(--page-bg); color: var(--text); }
        .public-landing .public-card { background: var(--card-bg) !important; border-color: var(--border) !important; color: var(--text); }
        .public-landing[data-theme="light"] [class*="text-white"] { color: var(--text) !important; }
        .public-landing[data-theme="light"] [class*="text-white/"] { color: var(--muted) !important; }
        .public-landing[data-theme="light"] [class*="border-white"] { border-color: var(--border) !important; }
        .public-landing[data-theme="light"] [class*="bg-white/"] { background-color: rgba(255,255,255,0.72) !important; }
      `}</style>
      <section className="relative overflow-hidden border-b border-white/10">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at top left, color-mix(in oklch, var(--c-primary) 22%, transparent), transparent 36%), radial-gradient(circle at top right, color-mix(in oklch, var(--c-secondary) 20%, transparent), transparent 36%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-6 sm:py-10">
          <div className="h-44 overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-zinc-800 via-zinc-950 to-zinc-900 shadow-2xl sm:h-60">
            {business.cover_url ? (
              <img src={business.cover_url} alt="Portada del negocio" className="h-full w-full object-cover" decoding="async" />
            ) : null}
          </div>
          <div className="relative z-10 -mt-12 flex flex-col px-4 sm:-mt-14 sm:px-8">
            <div className="relative w-max">
              {profileNote ? (
                <div className="absolute bottom-full left-1/2 mb-2 max-w-[280px] -translate-x-1/2 whitespace-nowrap rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-zinc-950 shadow-xl ring-1 ring-black/5">
                  <span className="block truncate">{profileNote}</span>
                  <span className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-white" />
                </div>
              ) : null}
              <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-3xl border-4 bg-white text-3xl font-bold text-zinc-950 shadow-2xl sm:h-32 sm:w-32" style={{ borderColor: isLight ? "#f6f7fb" : "#08070c" }}>
                {business.avatar_url || business.logo_url ? (
                  <img src={business.avatar_url || business.logo_url || ""} alt={business.name} className="h-full w-full object-cover" decoding="async" />
                ) : (
                  business.name.slice(0, 1)
                )}
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{business.name}</h1>
                  <span className="inline-grid h-8 w-8 place-items-center text-white sm:h-9 sm:w-9" aria-label="Negocio verificado" title="Negocio verificado">
                    <svg viewBox="0 0 24 24" className="h-8 w-8 sm:h-9 sm:w-9 drop-shadow-sm" aria-hidden="true">
                      <path
                        d="M12 1.6l1.75 1.52 2.3-.29.99 2.1 2.2.72.07 2.32 1.64 1.63-1.1 2.04.46 2.27-1.94 1.27-.58 2.24-2.29.2-1.5 1.77L12 18.22l-2 1.17-1.5-1.77-2.29-.2-.58-2.24-1.94-1.27.46-2.27-1.1-2.04 1.64-1.63.07-2.32 2.2-.72.99-2.1 2.3.29L12 1.6z"
                        fill="#1DA1F2"
                      />
                      <path d="M10.45 14.7 6.9 11.15l1.45-1.45 2.1 2.1 5.2-5.2 1.45 1.45-6.65 6.65z" fill="white" />
                    </svg>
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm font-semibold" style={{ color: cAccent }}>
                  <FiveStars />
                  <span className={isLight ? "text-zinc-700" : "text-white/90"}>5,0</span>
                </div>
              </div>

              <div className="grid w-full max-w-xl grid-cols-3 divide-x text-center lg:w-auto lg:min-w-[460px]" style={{ borderColor: isLight ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.14)" }}>
                {[
                  { value: "16.284", label: <>Clientes<br />atendidos</> },
                  { value: "27.541", label: <>Servicios<br />realizados</> },
                  { value: "7", label: <>Años de<br />experiencia</> },
                ].map((item) => (
                  <div key={item.value} className="px-4 sm:px-7">
                    <div className="text-3xl font-bold leading-none tracking-tight sm:text-4xl">{item.value}</div>
                    <div className="mt-2 text-sm leading-5 text-white/55 sm:text-base">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="space-y-6">
          <GlowCard>
            <div className="p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/5" style={{ color: cAccent }}>
                  <Sparkles className="h-5 w-5" />
                </span>
                <h2 className="text-2xl font-semibold">Servicios disponibles</h2>
              </div>
              {services.length === 0 ? (
                <p className="mt-4 text-sm text-white/55">Todavía no hay servicios habilitados para reserva online.</p>
              ) : (
                <div className="mt-5 divide-y divide-white/10">
                  {services.map((service) => (
                    <div key={service.id} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="font-medium">{service.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/50">
                          {service.duration_min ? <span>{Number(service.duration_min)} min</span> : null}
                          <span className="font-semibold text-white">{formatMoney(service.price)}</span>
                        </div>
                      </div>
                      <a
                        href={bookingHref({ service: service.id })}
                        className="shrink-0 rounded-full px-4 py-2 text-sm font-bold text-zinc-950 transition hover:brightness-110"
                        style={{ background: cAccent, boxShadow: "0 10px 24px -12px color-mix(in oklch, var(--c-accent) 70%, transparent)" }}
                      >
                        Reservar
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </GlowCard>

          {employees.length > 0 ? (
            <GlowCard>
              <div className="p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/5" style={{ color: cAccent }}>
                    <CalendarDays className="h-5 w-5" />
                  </span>
                  <h2 className="text-2xl font-semibold">Profesionales disponibles</h2>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {employees.map((employee) => (
                    <a
                      key={employee.id}
                      href={bookingHref({ professional: employee.id })}
                      className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4 transition hover:bg-white/[0.06]"
                    >
                      <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 text-lg font-semibold">
                        {employee.avatar_url ? (
                          <img src={employee.avatar_url} alt={employee.full_name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                        ) : (
                          employee.full_name.slice(0, 1)
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold">{employee.full_name}</h3>
                        <p className="text-sm text-white/50">{employee.role?.trim() || "Profesional"}</p>
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-sm font-bold text-zinc-950 shadow-sm" style={{ borderColor: "color-mix(in oklch, var(--c-accent) 28%, transparent)" }}>
                          <Star className="h-4 w-4 fill-current" style={{ color: cAccent }} />
                          <span>5,0</span>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </GlowCard>
          ) : null}

          {(description || portfolio.length > 0) ? (
            <GlowCard>
              <div className="p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/5" style={{ color: cAccent }}>
                    <Info className="h-5 w-5" />
                  </span>
                  <h2 className="text-2xl font-semibold">Acerca de</h2>
                </div>
                {description ? (
                  <p className="mt-4 max-w-3xl text-sm leading-6 text-white/65 sm:text-base">{description}</p>
                ) : null}
                {portfolio.length > 0 ? (
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {portfolio.slice(0, 3).map((src, i) => (
                      <button
                        key={`${src}-${i}`}
                        type="button"
                        onClick={() => openPortfolio(i)}
                        className="group aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] text-left transition hover:scale-[1.015] hover:border-white/20"
                      >
                        <img src={src} alt={`Imagen ${i + 1} de ${business.name}`} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" decoding="async" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </GlowCard>
          ) : null}

          {business.address ? (
            <GlowCard className="overflow-hidden">
              <div className="p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/5" style={{ color: cAccent }}>
                    <MapPin className="h-5 w-5" />
                  </span>
                  <h2 className="text-2xl font-semibold">Mapa</h2>
                </div>
              </div>
              <div className="h-[300px] overflow-hidden bg-white/[0.03] sm:h-[360px]">
                <iframe
                  title={`Mapa de ${business.name}`}
                  src={`https://www.google.com/maps?q=${encodeURIComponent(business.address)}&output=embed`}
                  className={`h-full w-full border-0 ${isLight ? "" : "grayscale contrast-90 brightness-90"}`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            </GlowCard>
          ) : null}

        </div>

        <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          {/* Reserva */}
          <GlowCard className="p-5 sm:p-6">
            <Link
              {...reservarTo}
              className="inline-flex w-full items-center justify-center rounded-2xl px-5 py-3 text-base font-bold text-zinc-950 transition hover:brightness-110"
              style={{ background: cAccent, boxShadow: "0 12px 32px -10px color-mix(in oklch, var(--c-accent) 70%, transparent)" }}
            >
              Reservar turno
            </Link>
          </GlowCard>

          {/* Horarios + Dirección */}
          <GlowCard className="flex flex-col p-5 sm:p-6 lg:min-h-[448px]">
            <div className="flex items-center gap-2">
              <Clock3 className="h-5 w-5" style={{ color: cPrimary }} />
              <h2 className="text-lg font-semibold">Horarios</h2>
            </div>
            {schedule ? (
              <ul className="mt-4 space-y-2 text-sm">
                {DISPLAY_DAYS.map(({ key, label }) => {
                  const day = schedule[key];
                  return (
                    <li key={key} className="flex items-center justify-between gap-3">
                      <span className={key === todayKey ? "font-bold text-white" : "text-white/55"}>{label}</span>
                      {day.enabled ? <span className="font-medium text-white">{day.start} – {day.end}</span> : <span className="text-white/35">Cerrado</span>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-white/55">Consultá la disponibilidad al momento de reservar.</p>
            )}

            {business.address ? (
              <div className="mt-auto border-t border-white/10 pt-5">
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: cPrimary }} />
                  <div className="min-w-0">
                    <p className="text-white/70">{business.address}</p>
                    {mapLink ? (
                      <a href={mapLink} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold hover:underline" style={{ color: cPrimary }}>
                        Cómo llegar <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </GlowCard>
        </aside>
      </section>


      <section className="mx-auto max-w-6xl px-4 pb-6">
        <GlowCard className="overflow-hidden">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/5" style={{ color: cAccent }}>
                <Phone className="h-5 w-5" />
              </span>
              <h2 className="text-2xl font-semibold">Contactanos</h2>
            </div>
            <div className="flex flex-wrap gap-3">
              {business.phone ? (
                <a
                  href={`https://wa.me/${business.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="WhatsApp"
                  className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/5 transition hover:bg-white/10"
                >
                  <Phone className="h-5 w-5" />
                </a>
              ) : null}
              {instagram ? (
                <a
                  href={`https://instagram.com/${instagram}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Instagram"
                  className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/5 transition hover:bg-white/10"
                >
                  <Instagram className="h-5 w-5" />
                </a>
              ) : null}
              {business.email ? (
                <a
                  href={`mailto:${business.email}`}
                  aria-label="Email"
                  className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/5 transition hover:bg-white/10"
                >
                  <Mail className="h-5 w-5" />
                </a>
              ) : null}
            </div>
          </div>
        </GlowCard>
      </section>

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-2">
        <div className="flex items-center justify-center gap-2 text-sm text-white/50">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-sky-400 via-violet-500 to-fuchsia-500 text-xs font-bold text-white">C</span>
          <span>Hecho con <span className="font-semibold text-white/80">Clippr</span></span>
        </div>
      </footer>

      {selectedPortfolio ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4 text-white">
          <div className="absolute left-6 top-6 text-lg font-semibold">{business.name}</div>
          <div className="absolute left-1/2 top-6 -translate-x-1/2 text-sm font-semibold text-white/80">
            {(selectedPortfolioIndex ?? 0) + 1}/{portfolio.length}
          </div>
          <button
            type="button"
            onClick={closePortfolio}
            className="absolute right-6 top-6 grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-white/5 transition hover:bg-white/10"
            aria-label="Cerrar portafolio"
          >
            <X className="h-6 w-6" />
          </button>
          {portfolio.length > 1 ? (
            <button
              type="button"
              onClick={showPrevPortfolio}
              className="absolute left-4 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white text-zinc-950 shadow-xl transition hover:scale-105"
              aria-label="Imagen anterior"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          ) : null}
          <img
            src={selectedPortfolio}
            alt="Imagen ampliada del portafolio"
            className="max-h-[78vh] max-w-[min(92vw,760px)] rounded-2xl object-contain shadow-2xl"
            decoding="async"
          />
          {portfolio.length > 1 ? (
            <button
              type="button"
              onClick={showNextPortfolio}
              className="absolute right-4 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white text-zinc-950 shadow-xl transition hover:scale-105"
              aria-label="Imagen siguiente"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#08070c]/95 p-3 backdrop-blur sm:hidden">
        <Link
          {...reservarTo}
          className="flex w-full items-center justify-center rounded-2xl px-5 py-3 text-base font-bold text-zinc-950"
          style={{ background: cAccent, boxShadow: "0 12px 32px -10px color-mix(in oklch, var(--c-accent) 70%, transparent)" }}
        >
          Reservar turno
        </Link>
      </div>
    </main>
  );
}
