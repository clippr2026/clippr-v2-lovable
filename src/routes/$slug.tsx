import { createFileRoute, Link } from "@tanstack/react-router";
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CalendarDays,
  Clock3,
  Instagram,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Scissors,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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

// Orden de visualización (lunes a domingo) y etiquetas en español.
const DISPLAY_DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Lunes" },
  { key: "tue", label: "Martes" },
  { key: "wed", label: "Miércoles" },
  { key: "thu", label: "Jueves" },
  { key: "fri", label: "Viernes" },
  { key: "sat", label: "Sábado" },
  { key: "sun", label: "Domingo" },
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
  return Array.isArray(value) ? value.filter((url): url is string => typeof url === "string" && url.trim().length > 0).slice(0, 3) : [];
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

function PublicProfilePage() {
  const { slug } = Route.useParams();

  const [loading, setLoading] = React.useState(true);
  const [business, setBusiness] = React.useState<Business | null>(null);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [services, setServices] = React.useState<Service[]>([]);
  const [schedule, setSchedule] = React.useState<ScheduleMap | null>(null);
  const [portfolioUrls, setPortfolioUrls] = React.useState<string[]>([]);

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

        // Preferimos una vista pública segura para exponer solo schedule/_branding.
        // Si todavía no existe, intentamos la tabla original como fallback.
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

        if (employeesRes.error) throw new Error(employeesRes.error.message);
        if (servicesRes.error) throw new Error(servicesRes.error.message);

        const branding = extractBranding(settingsSchedule);
        const mergedBusiness = {
          ...(businessData as Business),
          address: branding.address || (businessData as Business).address,
          phone: branding.phone || (businessData as Business).phone,
          email: branding.email || (businessData as Business).email,
          instagram: branding.instagram || (businessData as Business).instagram,
        };

        if (!cancelled) {
          setBusiness(mergedBusiness as Business);
          setEmployees(((employeesRes.data ?? []) as Employee[]).filter((e) => e.is_active !== false));
          setServices(((servicesRes.data ?? []) as Service[]).filter((s) => s.is_active !== false));
          setSchedule(normalizeSchedule(settingsSchedule));
          setPortfolioUrls(normalizePortfolio(branding.portfolio_urls));
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

  const accent = business?.accent_color || "#f59e0b";
  const portfolio = portfolioUrls;

  if (loading) {
    return (
      <main className="min-h-dvh bg-[#09090f] text-white grid place-items-center px-4">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl">
          <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: "#f59e0b" }} />
          <p className="mt-4 text-sm text-white/60">Cargando perfil...</p>
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

  const reservarTo = { to: "/reservar/$slug" as const, params: { slug } };

  return (
    <main className="min-h-dvh bg-[#09090f] text-white pb-24 sm:pb-10" style={{ ["--accent" as any]: accent }}>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at top left, color-mix(in oklch, var(--accent) 28%, transparent), transparent 34%), radial-gradient(circle at top right, rgba(124,58,237,0.22), transparent 32%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-6 sm:py-10">
          <div className="h-40 overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-zinc-800 via-zinc-950 to-zinc-900 shadow-2xl sm:h-56">
            {business.cover_url ? (
              <img
                src={business.cover_url}
                alt=""
                className="h-full w-full object-cover"
                decoding="async"
              />
            ) : null}
          </div>
          <div className="-mt-12 flex flex-col gap-4 px-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between sm:px-8">
            <div className="flex items-end gap-4">
              <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-3xl border-4 border-[#09090f] bg-white text-3xl font-bold text-zinc-950 shadow-xl">
                {business.avatar_url || business.logo_url ? (
                  <img
                    src={business.avatar_url || business.logo_url || ""}
                    alt={business.name}
                    className="h-full w-full object-cover"
                    decoding="async"
                  />
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

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Servicios */}
          <Card className="border-white/10 bg-white/[0.04] text-white shadow-xl">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-white/50">Carta</p>
                  <h2 className="text-2xl font-semibold">Servicios</h2>
                </div>
                <Scissors className="h-6 w-6" style={{ color: accent }} />
              </div>
              {services.length === 0 ? (
                <p className="mt-4 text-sm text-white/55">Todavía no hay servicios publicados.</p>
              ) : (
                <div className="mt-4 divide-y divide-white/10">
                  {services.map((service) => (
                    <div key={service.id} className="flex items-center justify-between gap-4 py-4">
                      <div className="min-w-0">
                        <p className="font-medium">{service.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/50">
                          {service.duration_min ? <span>{Number(service.duration_min)} min</span> : null}
                          <span className="font-semibold text-white">{formatMoney(service.price)}</span>
                        </div>
                      </div>
                      <Link
                        {...reservarTo}
                        className="shrink-0 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold transition hover:bg-white/10"
                      >
                        Reservar
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Equipo */}
          {employees.length > 0 ? (
            <Card className="border-white/10 bg-white/[0.04] text-white shadow-xl">
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-white/50">Profesionales</p>
                    <h2 className="text-2xl font-semibold">El equipo</h2>
                  </div>
                  <UsersRound className="h-6 w-6" style={{ color: accent }} />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {employees.map((employee) => (
                    <div
                      key={employee.id}
                      className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/10 text-lg font-semibold">
                        {employee.avatar_url ? (
                          <img src={employee.avatar_url} alt={employee.full_name} className="h-full w-full object-cover" />
                        ) : (
                          employee.full_name.slice(0, 1)
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold">{employee.full_name}</h3>
                        <p className="text-sm text-white/50">Profesional</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Portafolio */}
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
                    <div
                      key={`${src}-${i}`}
                      className="aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]"
                    >
                      <img src={src} alt={`Portafolio ${i + 1}`} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Columna lateral */}
        <aside className="space-y-6">
          {/* CTA Reservar */}
          <Card className="border-white/10 bg-white/[0.04] text-white shadow-xl">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5" style={{ color: accent }} />
                <h2 className="text-lg font-semibold">Reservá tu turno</h2>
              </div>
              <p className="mt-2 text-sm text-white/60">
                Elegí servicio, profesional y horario en segundos.
              </p>
              <Link
                {...reservarTo}
                className="mt-4 inline-flex w-full items-center justify-center rounded-2xl px-5 py-3 text-base font-bold text-zinc-950 shadow-lg transition hover:brightness-110"
                style={{ background: accent }}
              >
                Reservar turno
              </Link>
            </CardContent>
          </Card>

          {/* Horarios */}
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
                        {day.enabled ? (
                          <span className="font-medium">
                            {day.start} – {day.end}
                          </span>
                        ) : (
                          <span className="text-white/40">Cerrado</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-white/55">
                  Consultá la disponibilidad al momento de reservar.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Contacto */}
          {(business.address || business.phone || business.email || business.instagram) && (
            <Card className="border-white/10 bg-white/[0.04] text-white shadow-xl">
              <CardContent className="p-5 sm:p-6">
                <h2 className="text-lg font-semibold">Contacto</h2>
                <div className="mt-4 space-y-3 text-sm">
                  {business.address ? (
                    <div className="flex items-start gap-2 text-white/70">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> <span>{business.address}</span>
                    </div>
                  ) : null}
                  {business.phone ? (
                    <a href={`tel:${business.phone}`} className="flex items-center gap-2 text-white/70 hover:text-white">
                      <Phone className="h-4 w-4 shrink-0" /> <span>{business.phone}</span>
                    </a>
                  ) : null}
                  {business.email ? (
                    <a href={`mailto:${business.email}`} className="flex items-center gap-2 text-white/70 hover:text-white">
                      <Mail className="h-4 w-4 shrink-0" /> <span className="truncate">{business.email}</span>
                    </a>
                  ) : null}
                  {business.instagram ? (
                    <a
                      href={`https://instagram.com/${business.instagram.replace(/^@/, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 text-white/70 hover:text-white"
                    >
                      <Instagram className="h-4 w-4 shrink-0" />{" "}
                      <span>@{business.instagram.replace(/^@/, "")}</span>
                    </a>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          )}
        </aside>
      </section>

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-2 text-center text-xs text-white/40">
        Hecho con <span className="font-semibold text-white/60">Clippr</span>
      </footer>

      {/* CTA fija en mobile */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#09090f]/95 p-3 backdrop-blur sm:hidden">
        <Link
          {...reservarTo}
          className="flex w-full items-center justify-center rounded-2xl px-5 py-3 text-base font-bold text-zinc-950 shadow-lg"
          style={{ background: accent }}
        >
          Reservar turno
        </Link>
      </div>
    </main>
  );
}
