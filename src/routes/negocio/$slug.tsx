import { createFileRoute, Link } from "@tanstack/react-router";
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CalendarDays,
  Clock3,
  ExternalLink,
  Instagram,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Scissors,
  Sparkles,
  UsersRound,
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
type PublicBranding = {
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  instagram?: string | null;
  website?: string | null;
  description?: string | null;
  portfolio_urls?: string[] | null;
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

function PublicProfilePage() {
  const { slug } = Route.useParams();

  const [loading, setLoading] = React.useState(true);
  const [business, setBusiness] = React.useState<Business | null>(null);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [services, setServices] = React.useState<Service[]>([]);
  const [schedule, setSchedule] = React.useState<ScheduleMap | null>(null);
  const [portfolioUrls, setPortfolioUrls] = React.useState<string[]>([]);
  const [description, setDescription] = React.useState<string>("");

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

        const [employeesRes, servicesRes] = await Promise.all([
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
        ]);

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
          setEmployees(
            (employeesRes.error ? [] : ((employeesRes.data ?? []) as Employee[]))
              .filter((employee) => employee.is_active !== false)
              .filter((employee) => visibility.employees[employee.id] !== false),
          );
          setServices(
            (servicesRes.error ? [] : ((servicesRes.data ?? []) as Service[]))
              .filter((service) => service.is_active !== false)
              .filter((service) => visibility.services[service.id] !== false),
          );
          setSchedule(normalizeSchedule(settingsSchedule));
          setPortfolioUrls(normalizePortfolio(branding.portfolio_urls));
          setDescription(typeof branding.description === "string" ? branding.description.trim() : "");
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

  const accent = business?.accent_color || "#d6b66a";
  const portfolio = portfolioUrls;

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

  return (
    <main className="min-h-dvh bg-[#08070c] text-white pb-24 sm:pb-10" style={{ ["--accent" as any]: accent }}>
      <section className="relative overflow-hidden border-b border-white/10">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at top left, color-mix(in oklch, var(--accent) 25%, transparent), transparent 34%), radial-gradient(circle at top right, rgba(124,58,237,0.22), transparent 35%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-6 sm:py-10">
          <div className="h-44 overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-zinc-800 via-zinc-950 to-zinc-900 shadow-2xl sm:h-60">
            {business.cover_url ? (
              <img src={business.cover_url} alt="Portada del negocio" className="h-full w-full object-cover" decoding="async" />
            ) : null}
          </div>
          <div className="-mt-12 flex flex-col gap-4 px-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between sm:px-8">
            <div className="flex items-end gap-4">
              <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-3xl border-4 border-[#08070c] bg-white text-3xl font-bold text-zinc-950 shadow-xl">
                {business.avatar_url || business.logo_url ? (
                  <img src={business.avatar_url || business.logo_url || ""} alt={business.name} className="h-full w-full object-cover" decoding="async" />
                ) : (
                  business.name.slice(0, 1)
                )}
              </div>
              <div className="pb-2">
                <p className="text-xs uppercase tracking-[0.3em]" style={{ color: accent }}>
                  Perfil del local
                </p>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{business.name}</h1>
                {business.address ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white/70">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-4 w-4" /> {business.address}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
            <Link
              {...reservarTo}
              className="hidden rounded-2xl px-6 py-4 text-base font-bold text-zinc-950 shadow-lg transition hover:brightness-110 sm:inline-flex sm:items-center"
              style={{ background: accent }}
            >
              Reservar turno
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="space-y-6">
          <Card className="border-white/10 bg-white/[0.04] text-white shadow-xl">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-white/50">Servicios disponibles</p>
                  <h2 className="text-2xl font-semibold">Elegí qué querés reservar</h2>
                </div>
                <Scissors className="h-6 w-6" style={{ color: accent }} />
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
                        className="shrink-0 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold transition hover:bg-white/10"
                      >
                        Reservar
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {employees.length > 0 ? (
            <Card className="border-white/10 bg-white/[0.04] text-white shadow-xl">
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-white/50">Profesionales disponibles</p>
                    <h2 className="text-2xl font-semibold">El equipo</h2>
                  </div>
                  <UsersRound className="h-6 w-6" style={{ color: accent }} />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {employees.map((employee) => (
                    <div key={employee.id} className="flex items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/10 text-lg font-semibold">
                          {employee.avatar_url ? (
                            <img src={employee.avatar_url} alt={employee.full_name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                          ) : (
                            employee.full_name.slice(0, 1)
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold">{employee.full_name}</h3>
                          <p className="text-sm text-white/50">{employee.role || "Profesional"}</p>
                        </div>
                      </div>
                      <a href={bookingHref({ professional: employee.id })} className="shrink-0 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold transition hover:bg-white/10">Reservar</a>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {description ? (
            <Card className="border-white/10 bg-white/[0.04] text-white shadow-xl">
              <CardContent className="p-5 sm:p-6">
                <p className="text-sm text-white/50">Sobre el local</p>
                <h2 className="mt-1 text-2xl font-semibold">Conocé {business.name}</h2>
                <p className="mt-4 max-w-3xl text-sm leading-6 text-white/65">{description}</p>
              </CardContent>
            </Card>
          ) : null}

          {portfolio.length > 0 ? (
            <Card className="border-white/10 bg-white/[0.04] text-white shadow-xl">
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-white/50">Local, trabajos e instalaciones</p>
                    <h2 className="text-2xl font-semibold">Portafolio</h2>
                  </div>
                  <Sparkles className="h-6 w-6" style={{ color: accent }} />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {portfolio.slice(0, 3).map((src, i) => (
                    <div key={`${src}-${i}`} className="aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
                      <img src={src} alt={`Portafolio ${i + 1}`} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card className="border-white/10 bg-white/[0.04] text-white shadow-xl">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5" style={{ color: accent }} />
                <h2 className="text-lg font-semibold">Reservá tu turno</h2>
              </div>
              <p className="mt-4 text-sm font-semibold text-white">Horario de hoy</p>
              <p className="mt-1 text-sm text-white/60">{todayStatus}</p>
              {business.address ? (
                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accent }} />
                    <div>
                      <p>{business.address}</p>
                      <p>Buenos Aires, Ciudad Autónoma de Buenos Aires</p>
                      {mapLink ? (
                        <a href={mapLink} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 font-semibold hover:text-white" style={{ color: accent }}>
                          Cómo llegar <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
              <Link
                {...reservarTo}
                className="mt-5 inline-flex w-full items-center justify-center rounded-2xl px-5 py-3 text-base font-bold text-zinc-950 shadow-lg transition hover:brightness-110"
                style={{ background: accent }}
              >
                Reservar turno
              </Link>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.04] text-white shadow-xl">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <Clock3 className="h-5 w-5" style={{ color: accent }} />
                <h2 className="text-lg font-semibold">Horarios</h2>
              </div>
              {schedule ? (
                <ul className="mt-4 space-y-2 text-sm">
                  {DISPLAY_DAYS.map(({ key, label }) => {
                    const day = schedule[key];
                    return (
                      <li key={key} className="flex items-center justify-between gap-3">
                        <span className="text-white/70">{label}</span>
                        {day.enabled ? <span className="font-medium">{day.start} – {day.end}</span> : <span className="text-white/40">Cerrado</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-white/55">Consultá la disponibilidad al momento de reservar.</p>
              )}
            </CardContent>
          </Card>
        </aside>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-6">
        <Card className="overflow-hidden border-white/10 bg-white/[0.04] text-white shadow-xl">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="text-sm text-white/50">¿Tenés dudas?</p>
              <h2 className="text-2xl font-semibold">Contactanos</h2>
              <p className="mt-1 text-sm text-white/60">Escribinos y te ayudamos a elegir el mejor turno.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {business.phone ? (
                <a href={`https://wa.me/${business.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold hover:bg-white/10">
                  WhatsApp
                </a>
              ) : null}
              {instagram ? (
                <a href={`https://instagram.com/${instagram}`} target="_blank" rel="noreferrer" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold hover:bg-white/10">
                  Instagram
                </a>
              ) : null}
              {business.email ? (
                <a href={`mailto:${business.email}`} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold hover:bg-white/10">
                  Email
                </a>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </section>

      <footer className="mx-auto max-w-6xl px-4 pb-10">
        <div className="rounded-[2rem] border border-white/10 bg-gradient-to-r from-sky-500/15 via-violet-500/15 to-fuchsia-500/15 p-6 text-center shadow-xl">
          <p className="text-xs uppercase tracking-[0.3em] text-white/45">Hecho con Clippr</p>
          <p className="mt-2 text-lg font-semibold text-white">Gestioná tu negocio desde un solo lugar</p>
        </div>
      </footer>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#08070c]/95 p-3 backdrop-blur sm:hidden">
        <Link {...reservarTo} className="flex w-full items-center justify-center rounded-2xl px-5 py-3 text-base font-bold text-zinc-950 shadow-lg" style={{ background: accent }}>
          Reservar turno
        </Link>
      </div>
    </main>
  );
}
