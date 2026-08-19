import { createFileRoute, Link } from "@tanstack/react-router";
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Crown,
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
import { ClipprLoader } from "@/components/ui/clippr-loader";
import { ServiceImage } from "@/components/ui/service-image";
import { applyCatalogOrder, extractCatalogOrderMap } from "@/lib/catalog-order";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

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
  image_url?: string | null;
  image_position?: string | null;
  category?: string | null;
  cash_discount?: number | null;
};

type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
type DaySchedule = { enabled: boolean; start: string; end: string };
type ScheduleMap = Record<DayKey, DaySchedule>;
type LandingColors = { primary?: string; secondary?: string; accent?: string; buttonText?: string };
type LandingTheme = "dark" | "light";
type FeaturedClient = {
  id?: string;
  name: string;
  category: string;
  image_url?: string;
  active?: boolean;
  order?: number;
  // Solo se usan cuando category === "Futbolista".
  club_name?: string;
  club_logo_url?: string;
};

type PublicBranding = {
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  instagram?: string | null;
  website?: string | null;
  description?: string | null;
  profile_note?: string | null;
  additional_info?: string[] | null;
  portfolio_urls?: string[] | null;
  featured_clients?: FeaturedClient[] | null;
  avatar_position?: string | null;
  cover_position?: string | null;
  portfolio_positions?: string[] | null;
  featured_positions?: Record<string, string> | null;
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

function cashPrice(price: number | null | undefined, discount: number | null | undefined) {
  const p = Number(price ?? 0);
  const d = Number(discount ?? 0);
  return Math.round(p - (p * d) / 100);
}

function extractBranding(schedule: unknown): PublicBranding {
  if (!schedule || typeof schedule !== "object") return {};
  const branding = (schedule as Record<string, any>)._branding;
  return branding && typeof branding === "object" ? branding : {};
}

function extractCatalogImages(schedule: unknown): Record<string, string> {
  if (!schedule || typeof schedule !== "object") return {};
  const imgs = (schedule as Record<string, unknown>)._catalogImages;
  if (!imgs || typeof imgs !== "object") return {};
  const map: Record<string, string> = {};
  for (const [id, url] of Object.entries(imgs as Record<string, unknown>)) {
    if (id.trim() && typeof url === "string" && url) map[id] = url;
  }
  return map;
}

function extractCatalogImagePositions(schedule: unknown): Record<string, string> {
  if (!schedule || typeof schedule !== "object") return {};
  const positions = (schedule as Record<string, unknown>)._catalogImagePositions;
  if (!positions || typeof positions !== "object") return {};
  const map: Record<string, string> = {};
  for (const [id, value] of Object.entries(positions as Record<string, unknown>)) {
    if (id.trim() && typeof value === "string" && value.trim()) map[id] = value;
  }
  return map;
}

function normalizePortfolio(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((url): url is string => typeof url === "string" && url.trim().length > 0).slice(0, 3)
    : [];
}


function normalizeAdditionalInfo(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        if (row.active === false) return "";
        return typeof row.label === "string" ? row.label : "";
      }
      return "";
    })
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, 12);
}


function normalizeFeaturedClients(value: unknown): FeaturedClient[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        id: typeof row.id === "string" ? row.id : `featured-${index}`,
        name: typeof row.name === "string" ? row.name.trim() : "",
        category: typeof row.category === "string" ? row.category : "Otro",
        image_url: typeof row.image_url === "string" ? row.image_url : "",
        active: row.active !== false,
        order: Number.isFinite(Number(row.order)) ? Number(row.order) : index,
        club_name: typeof row.club_name === "string" ? row.club_name.trim() : "",
        club_logo_url: typeof row.club_logo_url === "string" ? row.club_logo_url : "",
      };
    })
    .filter((item) => item.active !== false && (item.name || item.image_url))
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
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
    <div className="flex items-center gap-1" aria-label="5 estrellas" style={{ color: "#F5B301" }}>
      {Array.from({ length: 5 }).map((_, index) => (
        <Star key={index} className={compact ? "h-3.5 w-3.5 fill-current" : "h-4 w-4 fill-current"} />
      ))}
    </div>
  );
}

function getHueFromHex(hex?: string | null) {
  const clean = String(hex || "").replace("#", "").trim();
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return 42;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

function mapDarkFilter(accentColor: string) {
  const hue = getHueFromHex(accentColor);
  return `invert(92%) hue-rotate(${180 + hue}deg) saturate(220%) brightness(58%) contrast(112%)`;
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

// Distribución de "Confían en nosotros" según cuánta gente hay cargada —
// misma cantidad de columnas en todos los tamaños de pantalla (no depende
// del viewport, depende de cuántas tarjetas hay), para que 4 personas se
// vean siempre "2 arriba y 2 abajo", 5 siempre "3 arriba y 2 abajo", 6
// siempre "3 arriba y 3 abajo". Con más de 6 (solo puede pasar dentro de
// "Ver todos", agrupado por categoría) no hay una distribución prolija
// única para todos los casos, ahí se cae a 3 columnas siempre.
function featuredCols(count: number): number {
  if (count <= 1) return 1;
  if (count === 2 || count === 4) return 2;
  return 3;
}

// Ancho de cada tarjeta como flexbox (no CSS grid): con grid, una fila
// incompleta (el caso de 5 personas: 3 arriba y 2 abajo) queda pegada a la
// izquierda con un hueco vacío a la derecha. flex-wrap + justify-center
// centra automáticamente cualquier fila incompleta, sin casos especiales.
// El cálculo replica gap-1 (mobile) / gap-1.5 (desktop) descontado del
// ancho de cada tarjeta, para que N tarjetas + sus gaps sumen exactamente
// el 100% del contenedor — el gap más chico posible que sigue viéndose
// prolijo es lo que más ancho real le devuelve a cada tarjeta.
function featuredCardWidthClass(cols: number): string {
  if (cols <= 1) return "w-full shrink-0";
  if (cols === 2) return "w-[calc(50%-0.125rem)] sm:w-[calc(50%-0.1875rem)] shrink-0";
  return "w-[calc(33.333%-0.1667rem)] sm:w-[calc(33.333%-0.25rem)] shrink-0";
}

// Tarjeta de una persona en "Confían en nosotros" — la usan tanto la grilla
// principal como el modal "Ver todos" (mismo diseño en los dos lugares a
// propósito: nunca dos versiones distintas de la misma tarjeta). La foto es
// el elemento protagonista (aspect-square, object-cover, ocupa todo el
// ancho de la tarjeta) y es lo único tapeable — abre la foto ampliada.
// Nombre / categoría / club quedan debajo, con jerarquía clara.
function FeaturedClientCard({
  item,
  isLight,
  imagePosition,
  onZoom,
  className = "",
}: {
  item: FeaturedClient;
  isLight: boolean;
  imagePosition?: string;
  onZoom: (item: FeaturedClient) => void;
  className?: string;
}) {
  const isFootballer = item.category === "Futbolista" && Boolean(item.club_name);
  return (
    <div
      className={
        (isLight
          ? "border-zinc-200 bg-white shadow-[0_0_42px_rgba(168,85,247,0.14)]"
          : "border-white/10 bg-white/[0.055] shadow-[0_0_42px_rgba(168,85,247,0.2)]") +
        " overflow-hidden rounded-3xl border transition hover:-translate-y-0.5 " +
        className
      }
    >
      <button
        type="button"
        onClick={() => item.image_url && onZoom(item)}
        disabled={!item.image_url}
        className={
          (isLight ? "bg-zinc-100" : "bg-white/5") +
          // aspect-[1/1.05] (no aspect-square): mismo ancho de siempre
          // (no toca featuredCols/featuredCardWidthClass), pero ~5% más
          // alta — la foto gana un poco más de protagonismo sin romper la
          // grilla.
          " grid aspect-[1/1.05] w-full place-items-center overflow-hidden disabled:cursor-default"
        }
        aria-label={item.image_url ? `Ampliar foto de ${item.name}` : undefined}
      >
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.name}
            className="h-full w-full object-cover transition duration-300 hover:scale-105"
            style={{ objectPosition: imagePosition || "50% 50%" }}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className={(isLight ? "text-zinc-700" : "text-white/80") + " text-4xl font-bold"}>
            {item.name.slice(0, 1)}
          </span>
        )}
      </button>
      {/* flex-col + justify-center (sin items-center: así los hijos
          heredan el stretch por default y el ancho completo que necesita
          `truncate` para poder cortar con "..." en vez de desbordar) sobre
          un min-h fijo — el nombre/categoría/club quedan centrados
          verticalmente y la altura del bloque es IDÉNTICA en todas las
          tarjetas, tengan club o no: el min-h es el piso común y
          justify-center absorbe la diferencia cuando una tarjeta tiene
          menos contenido (sin club, o con club pero sin logo) que otra. */}
      <div className="flex min-h-[58px] flex-col justify-center px-2 py-1 text-center sm:min-h-[68px] sm:px-3 sm:py-1.5">
        <p className="truncate text-[12px] font-semibold leading-tight sm:text-[14px]">{item.name}</p>
        <p className={(isLight ? "text-zinc-500" : "text-white/50") + " mt-0.5 truncate text-[10px] leading-tight sm:text-[11px]"}>
          {item.category}
        </p>
        {/* Bloque del club (logo a la izquierda, nombre a la derecha,
            centrado como un solo grupo): SIEMPRE se renderiza (con
            `invisible` cuando no aplica) para que todas las tarjetas
            reserven el mismo piso de altura — ver el comentario del min-h
            arriba. Sin logo cargado no se dibuja ningún ícono de
            reemplazo, solo el nombre del club centrado. */}
        <div
          className={
            // gap-1/sm:gap-1.5 da una separación uniforme y prolija entre
            // escudo y nombre (escudo ahora más chico, h-4 w-4 — ver más
            // abajo — así no le compite en protagonismo al nombre).
            //
            // justify-center SIEMPRE (no según un umbral de longitud): el
            // grupo escudo+nombre queda centrado con el mismo espacio libre
            // a los dos lados sin importar cuántas letras tenga el club, y
            // se recentra solo a medida que el nombre cambia de largo —
            // sin saltos ni casos especiales.
            //
            // SIN sangrado (sin -mx): esta fila se queda dentro del
            // px-2/sm:px-3 normal del contenedor padre, igual que el
            // nombre y la categoría de arriba. Lo probamos con bleed
            // (-mx-2/-mx-3, cancelando el padding) y el escudo terminaba
            // demasiado cerca de la esquina inferior izquierda de la
            // tarjeta: como el borde es rounded-3xl (radio de 24px), la
            // curva "come" varios px horizontales incluso ANTES de llegar
            // al borde recto, así que 0px de inset ahí SÍ se corta contra
            // el overflow-hidden de la tarjeta. Con el padding normal de
            // 8px/12px como piso mínimo, el escudo (shrink-0, nunca se
            // achica) queda siempre con margen de sobra respecto a esa
            // curva. El <span> truncado absorbe todo el ajuste: con
            // nombres muy largos se acorta con "..." en vez de forzar más
            // ancho para la fila.
            "mt-0 flex items-center justify-center gap-1 sm:gap-1.5" +
            (isFootballer ? "" : " invisible")
          }
        >
          {item.club_logo_url ? (
            <img
              src={item.club_logo_url}
              alt={item.club_name || ""}
              // rounded-full + object-cover: el contenedor es 1:1 (h-4 w-4)
              // así que rounded-full siempre da un círculo perfecto, y
              // cover rellena ese círculo completo recortando el sobrante
              // (centrado por default) en vez de dejar letterboxing — así
              // un escudo con foto vertical/horizontal no se ve ovalado ni
              // con espacios raros. h-4 w-4 (antes h-6 w-6) para que el
              // escudo no le robe protagonismo al nombre del club.
              className="h-4 w-4 shrink-0 rounded-full bg-white/10 object-cover ring-1 ring-white/15"
              loading="lazy"
              decoding="async"
            />
          ) : null}
          <span className={(isLight ? "text-zinc-500" : "text-white/50") + " max-w-full truncate text-[10px] font-bold leading-tight sm:text-[11px]"}>
            {item.club_name || " "}
          </span>
        </div>
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
  const [portfolioPositions, setPortfolioPositions] = React.useState<string[]>([]);
  const [avatarPosition, setAvatarPosition] = React.useState("50% 50%");
  const [coverPosition, setCoverPosition] = React.useState("50% 50%");
  const [featuredPositions, setFeaturedPositions] = React.useState<Record<string, string>>({});
  const [featuredClients, setFeaturedClients] = React.useState<FeaturedClient[]>([]);
  const [showAllFeaturedClients, setShowAllFeaturedClients] = React.useState(false);
  // Foto de una persona de "Confían en nosotros" ampliada en modal — separado
  // del lightbox del portafolio porque no hay noción de "siguiente/anterior"
  // acá, es una sola foto por persona.
  const [zoomedFeaturedClient, setZoomedFeaturedClient] = React.useState<FeaturedClient | null>(null);
  const [description, setDescription] = React.useState<string>("");
  const [profileNote, setProfileNote] = React.useState<string>("");
  const [additionalInfo, setAdditionalInfo] = React.useState<string[]>([]);
  const [colors, setColors] = React.useState<LandingColors>({});
  const [theme, setTheme] = React.useState<LandingTheme>("dark");
  // Tema real del negocio, conocido ANTES de renderizar el loader. Nunca arranca en
  // "dark" ni "light" por defecto: hasta que no se resuelve desde business_settings, el
  // loader no se muestra, para que jamás aparezca con el tema contrario al configurado.
  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark" | null>(null);
  const [selectedPortfolioIndex, setSelectedPortfolioIndex] = React.useState<number | null>(null);
  const [headerStats, setHeaderStats] = React.useState<{
    clientsAttended: number;
    servicesCompleted: number;
    startDate: string | null;
  } | null>(null);

  // Bloquean el scroll del fondo mientras cualquiera de estos dos modales
  // está abierto. useBodyScrollLock lleva un contador propio, así que se
  // pueden anidar sin problema (abrir la foto ampliada desde adentro de
  // "Ver todos" no desbloquea el scroll de golpe al cerrar solo una).
  useBodyScrollLock(showAllFeaturedClients);
  useBodyScrollLock(zoomedFeaturedClient !== null);

  // Cerrar los modales de "Confían en nosotros" con Escape, igual que con
  // el click afuera / la X.
  React.useEffect(() => {
    if (!showAllFeaturedClients && !zoomedFeaturedClient) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (zoomedFeaturedClient) setZoomedFeaturedClient(null);
      else setShowAllFeaturedClients(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAllFeaturedClients, zoomedFeaturedClient]);

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

        // El tema real (_branding.theme) se resuelve primero que cualquier otro dato.
        // Así el loader conoce el fondo correcto antes de que termine de cargar el resto
        // de la página, y nunca aparece con el tema contrario al configurado.
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
        const branding = extractBranding(settingsSchedule);
        if (!cancelled) setResolvedTheme(branding.theme === "light" ? "light" : "dark");

        // Métricas reales de cabecera (agregados sin PII vía RPC dedicada).
        // Aislado en su propio try/catch: si la RPC no existe o falla, la página igual carga.
        let statsResult: { clientsAttended: number; servicesCompleted: number; startDate: string | null } | null = null;
        try {
          const { data: statsData, error: statsError } = await supabase.rpc("get_public_business_stats", {
            p_business_id: businessId,
          });
          if (!statsError && statsData) {
            const row = (Array.isArray(statsData) ? statsData[0] : statsData) as
              | { clients_attended?: number | string; services_completed?: number | string; business_start_date?: string | null }
              | undefined;
            if (row) {
              statsResult = {
                clientsAttended: Number(row.clients_attended ?? 0),
                servicesCompleted: Number(row.services_completed ?? 0),
                startDate: (row.business_start_date as string | null) ?? null,
              };
            }
          }
        } catch {
          statsResult = null;
        }

        const [employeesWithRoleRes, servicesRes] = await Promise.all([
          supabase
            .from("public_booking_employees")
            .select("id,full_name,avatar_url,is_active,role")
            .eq("business_id", businessId)
            .order("full_name", { ascending: true }),
          // La vista public_booking_services (rol anon) no expone `cash_discount`
          // de price_catalog — se lee espejado desde business_settings.schedule
          // más abajo, mismo criterio que ya se usa para `category`.
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

        // La página pública no debe caer completa si una vista secundaria falla.
        // Primero mostramos el negocio y degradamos servicios/equipo con elegancia.
        console.warn("Public profile secondary data", {
          employeesError: employeesRes.error?.message,
          servicesError: servicesRes.error?.message,
        });

        const mergedBusiness = {
          ...(businessData as Business),
          address: branding.address || (businessData as Business).address,
          phone: branding.phone || (businessData as Business).phone,
          email: branding.email || (businessData as Business).email,
          instagram: branding.instagram || (businessData as Business).instagram,
        };

        const visibility = extractPublicVisibility(settingsSchedule);
        const serviceImages = extractCatalogImages(settingsSchedule);
        const serviceImagePositions = extractCatalogImagePositions(settingsSchedule);
        // La vista public_booking_services no expone `category` (no tiene esa
        // columna) y price_catalog no es legible por el rol anónimo, así que
        // la categoría de cada servicio se lee espejada desde
        // business_settings.schedule._serviceCategories — mismo criterio que
        // ya se usa para las imágenes de servicios/catálogo.
        const serviceCategoriesMap =
          settingsSchedule &&
          typeof settingsSchedule === "object" &&
          (settingsSchedule as Record<string, unknown>)._serviceCategories &&
          typeof (settingsSchedule as Record<string, unknown>)._serviceCategories === "object"
            ? ((settingsSchedule as Record<string, unknown>)._serviceCategories as Record<string, string>)
            : {};
        // Mismo criterio que serviceCategoriesMap arriba, para el descuento
        // en efectivo (tampoco expuesto por la vista pública).
        const serviceCashDiscountsMap =
          settingsSchedule &&
          typeof settingsSchedule === "object" &&
          (settingsSchedule as Record<string, unknown>)._serviceCashDiscounts &&
          typeof (settingsSchedule as Record<string, unknown>)._serviceCashDiscounts === "object"
            ? ((settingsSchedule as Record<string, unknown>)._serviceCashDiscounts as Record<string, number>)
            : {};
        // Orden de categorías configurado en Configuración → Servicios
        // (business_settings.schedule._categories.service), para que la
        // página pública liste primero por categoría en ese mismo orden.
        const serviceCategoryOrder = (() => {
          const cats =
            settingsSchedule && typeof settingsSchedule === "object"
              ? (settingsSchedule as Record<string, unknown>)._categories
              : null;
          const list = cats && typeof cats === "object" ? (cats as Record<string, unknown>).service : null;
          return Array.isArray(list) ? (list as string[]) : undefined;
        })();

        if (!cancelled) {
          setBusiness(mergedBusiness as Business);
          setHeaderStats(statsResult);
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
          const orderedServices = applyCatalogOrder(
            (servicesRes.error ? [] : ((servicesRes.data ?? []) as Service[]))
              .filter((service) => service.is_active !== false)
              .filter((service) => visibility.services[service.id] !== false)
              .map((service) => ({
                ...service,
                image_url: serviceImages[service.id] ?? null,
                image_position: serviceImagePositions[service.id] ?? "50% 50%",
                category: serviceCategoriesMap[service.id] ?? null,
                cash_discount: serviceCashDiscountsMap[service.id] ?? null,
              })),
            extractCatalogOrderMap(settingsSchedule as Record<string, unknown>, "service"),
            "Servicios",
            serviceCategoryOrder,
          );
          setServices(orderedServices);
          setSchedule(normalizeSchedule(settingsSchedule));
          setPortfolioUrls(normalizePortfolio(branding.portfolio_urls));
          setPortfolioPositions(Array.isArray(branding.portfolio_positions) ? branding.portfolio_positions : []);
          setAvatarPosition(typeof branding.avatar_position === "string" ? branding.avatar_position : "50% 50%");
          setCoverPosition(typeof branding.cover_position === "string" ? branding.cover_position : "50% 50%");
          setFeaturedPositions((branding.featured_positions && typeof branding.featured_positions === "object" ? branding.featured_positions : {}) as Record<string, string>);
          setFeaturedClients(normalizeFeaturedClients(branding.featured_clients));
          setDescription(typeof branding.description === "string" ? branding.description.trim() : "");
          setProfileNote(typeof branding.profile_note === "string" ? branding.profile_note.trim().slice(0, 50) : "");
          setAdditionalInfo(normalizeAdditionalInfo(branding.additional_info));
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

  const cPrimary = colors.primary || colors.secondary || business?.accent_color || "#7c3aed";
  const cSecondary = colors.secondary || cPrimary;
  const cAccent = colors.accent || business?.accent_color || "#d6b66a";
  const accent = cAccent; // acciones principales: botones, estados e indicadores
  const isLight = theme === "light";
  const accentButtonText = colors.buttonText || "#ffffff";

  // Métricas reales de cabecera. Si no hay datos caen a "—": nunca rompen el render.
  const statClientsAttended = headerStats ? headerStats.clientsAttended.toLocaleString("es-AR") : "—";
  const statServicesCompleted = headerStats ? headerStats.servicesCompleted.toLocaleString("es-AR") : "—";
  const statYearsExperience = (() => {
    const raw = headerStats?.startDate;
    if (!raw) return "—";
    const start = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(start.getTime())) return "—";
    const now = new Date();
    let years = now.getFullYear() - start.getFullYear();
    const monthDiff = now.getMonth() - start.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < start.getDate())) years -= 1;
    return years >= 0 ? String(years) : "—";
  })();
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
    if (resolvedTheme === null) return null;
    return <ClipprLoader fullScreen size="lg" background={resolvedTheme} />;
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
  const featuredCategoryOrder = ["Marca", "Artista", "Futbolista", "Equipo de fútbol", "Influencer", "Empresa", "Celebridad", "Otro"];
  const featuredClientsByCategory = featuredClients.reduce<Record<string, FeaturedClient[]>>((groups, item) => {
    const category = item.category || "Otro";
    groups[category] = groups[category] ? [...groups[category], item] : [item];
    return groups;
  }, {});
  const featuredCategoryEntries = Object.entries(featuredClientsByCategory).sort(([a], [b]) => {
    const ai = featuredCategoryOrder.indexOf(a);
    const bi = featuredCategoryOrder.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  return (
    <main
      data-theme={theme}
      className="public-landing min-h-dvh pb-24 sm:pb-10"
      style={{
        ["--accent" as any]: accent,
        ["--c-primary" as any]: cPrimary,
        ["--c-secondary" as any]: cSecondary,
        ["--c-accent" as any]: cAccent,
        ["--c-button-text" as any]: accentButtonText,
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
      <section className="relative overflow-hidden border-b border-white/[0.06]">
        <div
          className="absolute inset-0"
          style={{
            background: isLight
              ? "linear-gradient(90deg, color-mix(in oklch, var(--c-primary) 32%, #ffffff) 0%, #ffffff 48%, color-mix(in oklch, var(--c-secondary) 32%, #ffffff) 100%)"
              : "linear-gradient(90deg, color-mix(in oklch, var(--c-primary) 28%, #08070c) 0%, #08070c 48%, color-mix(in oklch, var(--c-secondary) 28%, #08070c) 100%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-5 sm:py-10">
          <div className="h-44 overflow-hidden rounded-[2rem] border border-white/10 shadow-2xl sm:h-60" style={{ background: "linear-gradient(90deg, var(--c-primary), var(--c-secondary))" }}>
            {business.cover_url ? (
              <img loading="lazy" src={business.cover_url} alt="Portada del negocio" className="h-full w-full object-cover" style={{ objectPosition: coverPosition }} decoding="async" />
            ) : null}
          </div>
          <div className="relative z-10 -mt-12 flex flex-col px-4 sm:-mt-14 sm:px-8">
            <div className="relative w-max">
              {/* Centrado sobre el avatar (flecha centrada bajo el globo,
                  apuntando al logo). El max-w es el límite matemático real
                  para que, perfectamente centrado, nunca toque el borde de
                  pantalla (avatar a ~88px del borde en mobile, ~112px en
                  sm+): no se puede agrandar más sin perder el centrado o
                  desbordar. Para que igual entren ~50 caracteres en 2 líneas
                  dentro de ese ancho, se compensa con letra y padding más
                  chicos en vez de más ancho. min-w evita que un texto corto
                  quede angosto y vertical. */}
              {profileNote ? (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex w-fit min-w-[150px] max-w-[176px] flex-col items-center justify-center rounded-2xl bg-white px-2.5 py-2 text-[11px] font-semibold leading-snug text-zinc-950 shadow-xl ring-1 ring-black/5 sm:min-w-[190px] sm:max-w-[224px]">
                  <span className="block text-center whitespace-pre-line break-words [word-break:normal]">{profileNote}</span>
                  <span className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-white" />
                </div>
              ) : null}
              <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-3xl border-4 bg-white text-3xl font-bold text-zinc-950 shadow-2xl sm:h-32 sm:w-32" style={{ borderColor: isLight ? "#f6f7fb" : "#08070c" }}>
                {business.avatar_url || business.logo_url ? (
                  <img loading="lazy" src={business.avatar_url || business.logo_url || ""} alt={business.name} className="h-full w-full object-cover" style={{ objectPosition: avatarPosition }} decoding="async" />
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

              <div className="grid w-full max-w-lg grid-cols-3 divide-x text-center lg:w-auto lg:min-w-[390px] lg:justify-self-start" style={{ borderColor: isLight ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.14)" }}>
                {[
                  { value: statClientsAttended, label: <>Clientes<br />atendidos</> },
                  { value: statServicesCompleted, label: <>Servicios<br />realizados</> },
                  { value: statYearsExperience, label: <>Años de<br />experiencia</> },
                ].map((item, index) => (
                  <div key={index} className="px-3 sm:px-5">
                    <div className="whitespace-nowrap text-2xl font-bold leading-none tracking-tight sm:text-3xl">{item.value}</div>
                    <div className="mt-2 text-xs leading-4 text-white/55 sm:text-sm">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-5 lg:grid-cols-[1fr_360px] lg:items-start">
        {/* min-w-0: sin esto, este ítem del grid usa su ancho mínimo de
            contenido como piso — y el header de "Ellos confían en
            nosotros" (título+chip en la misma fila, con truncate) reporta
            como mínimo su ancho SIN truncar, lo que termina empujando toda
            la columna (y la página en mobile) a desbordar horizontalmente.
            min-w-0 le devuelve al grid la libertad de angostar esta
            columna al ancho real disponible; el truncate interno se
            encarga de recortar el texto ahí adentro. */}
        <div className="min-w-0 space-y-6">

          {featuredClients.length > 0 ? (
            <GlowCard className="overflow-hidden shadow-[0_24px_60px_-28px_rgba(0,0,0,0.45)]">
              {/* Degradado muy sutil con el color principal del negocio,
                  limitado a la franja del encabezado (h-28) — no un fondo
                  fijo violeta: usa var(--c-primary), que ya se resuelve por
                  negocio y por tema (ver el estilo inline en <main> más
                  arriba). El overflow-hidden de GlowCard (className) lo
                  recorta contra las esquinas redondeadas de la tarjeta. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-28"
                style={{
                  background: isLight
                    ? "linear-gradient(120deg, color-mix(in oklch, var(--c-primary) 6%, transparent) 0%, transparent 60%)"
                    : "linear-gradient(120deg, color-mix(in oklch, var(--c-primary) 10%, transparent) 0%, transparent 60%)",
                }}
              />

              {/* Menos padding lateral que el resto de las secciones a
                  propósito — le da más ancho real a las tarjetas de abajo,
                  que ya vienen apretadas por tener que entrar 3 por fila.
                  pt-5/sm:pt-6 (más que el px/pb) para que la corona y el
                  título respiren arriba, separados de la esquina de la
                  tarjeta. */}
              <div className="relative px-4 pb-4 pt-5 sm:px-5 sm:pb-5 sm:pt-6">
                {/* Fila siempre horizontal (ni siquiera en mobile pasa a
                    flex-col): título y "Ver todos" comparten renglón para
                    no gastar una fila entera solo en el botón. truncate +
                    min-w-0 en el título y shrink-0 en la corona/botón para
                    que si el nombre no entra en una pantalla muy angosta,
                    ceda el título (con "…") y no el layout. */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                    {/* Corona más chica y fina que un ícono normal (h-5 se
                        sentía grande al lado del título), color PRIMARIO
                        de marca (cPrimary) — es el que identifica
                        visualmente a cada negocio, así que la corona,
                        el degradado de arriba y el chip "Ver todos" de
                        abajo comparten SIEMPRE ese mismo color dinámico
                        (nunca el accent, que cada negocio suele
                        configurar aparte para botones — a veces negro
                        puro — ni ningún hex fijo). */}
                    <Crown className="h-[17px] w-[17px] shrink-0" strokeWidth={1.75} style={{ color: cPrimary }} />
                    {/* text-base (no text-lg) en mobile: con el chip "Ver
                        todos" compartiendo el mismo renglón, text-lg
                        llegaba a truncar el título en anchos de celular
                        típicos (~375-390px). */}
                    <h2 className="truncate text-base font-semibold sm:text-2xl">Ellos confían en nosotros</h2>
                  </div>

                  {featuredClients.length > 6 ? (
                    <button
                      type="button"
                      onClick={() => setShowAllFeaturedClients(true)}
                      className="mr-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold transition hover:brightness-110 sm:mr-1 sm:gap-1.5 sm:px-3.5 sm:py-1.5"
                      style={{ borderColor: "color-mix(in oklch, var(--c-primary) 32%, transparent)", color: cPrimary }}
                    >
                      Ver todos <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>

                {/* Distribución fija según cuánta gente hay (2/3/2/3/3 arriba
                    para 2/3/4/5/6 personas — ver featuredCols). flex-wrap +
                    justify-center (no CSS grid) para que una fila incompleta
                    —el caso de 5: 3 arriba y 2 abajo— quede centrada en vez
                    de pegada a la izquierda. Máximo 6 visibles; el resto
                    (si hay más de 6) solo se ve entrando a "Ver todos".
                    -mx-1.5/sm:-mx-2 le gana unos px más de ancho real a cada
                    tarjeta (mismo truco que el padding del bloque, un nivel
                    más adentro) — imágenes ligeramente más grandes sin
                    tocar la cantidad de columnas por cantidad de gente
                    (featuredCols) ni el gap entre tarjetas. */}
                <div className="-mx-1.5 mt-3 flex flex-wrap justify-center gap-1 sm:-mx-2 sm:gap-1.5">
                  {featuredClients.slice(0, 6).map((item, index) => (
                    <FeaturedClientCard
                      key={item.id || `${item.name}-${index}`}
                      item={item}
                      isLight={isLight}
                      imagePosition={item.id ? featuredPositions[item.id] : undefined}
                      onZoom={setZoomedFeaturedClient}
                      className={featuredCardWidthClass(featuredCols(Math.min(featuredClients.length, 6)))}
                    />
                  ))}
                </div>
              </div>
            </GlowCard>
          ) : null}
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
                // Cada servicio es su propia tarjeta (borde + fondo propio,
                // sombra marcada + separación vertical generosa) para que se
                // lea como un bloque individual y no como una lista continua.
                // Estructura en dos filas: arriba imagen + nombre a todo el
                // ancho disponible (nada de precio/botón compitiendo por
                // espacio, así el nombre trunca lo más tarde posible); abajo
                // precios y botón "Reservar" alineados en la misma línea
                // para que el pie de la tarjeta quede equilibrado.
                <div className="mt-5 grid gap-4 sm:gap-5">
                  {services.map((service: Service) => {
                    const cash = cashPrice(service.price, service.cash_discount);
                    const hasCashDiscount = Number(service.cash_discount ?? 0) > 0 && cash !== Number(service.price ?? 0);
                    return (
                      <div
                        key={service.id}
                        className={
                          (isLight
                            ? "border-zinc-200/80 bg-zinc-50/60 shadow-[0_16px_40px_-24px_rgba(24,24,27,0.35)] hover:bg-zinc-50"
                            : "border-white/[0.08] bg-white/[0.03] shadow-[0_16px_40px_-20px_rgba(0,0,0,0.6)] hover:bg-white/[0.05]") +
                          // min-w-0: es un ítem de un grid — sin esto, el
                          // truncate del nombre de abajo reporta su ancho
                          // sin truncar como mínimo y desborda la página.
                          " min-w-0 rounded-2xl border p-4 transition sm:p-5"
                        }
                      >
                        <div className="flex min-w-0 items-center gap-4">
                          <ServiceImage
                            src={service.image_url}
                            alt={service.name}
                            position={service.image_position}
                            className={(isLight ? "ring-zinc-200" : "ring-white/10") + " h-16 w-16 shrink-0 rounded-xl ring-1 sm:h-20 sm:w-20"}
                            fallback={
                              // Placeholder con un degradado muy suave del
                              // color del negocio en vez del ícono suelto de
                              // antes — se siente a marca, no a "falta imagen".
                              <div
                                className="grid h-full w-full place-items-center"
                                style={{
                                  background:
                                    "linear-gradient(135deg, color-mix(in oklch, var(--c-accent) 20%, transparent), color-mix(in oklch, var(--c-primary) 12%, transparent))",
                                }}
                              >
                                <Sparkles className="h-6 w-6" style={{ color: cAccent }} />
                              </div>
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-base font-semibold sm:text-lg">{service.name}</p>
                            {service.duration_min ? (
                              <p className={(isLight ? "text-zinc-500" : "text-white/45") + " mt-0.5 text-xs"}>
                                {Number(service.duration_min)} min
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div
                          className={
                            (isLight ? "border-zinc-200/70" : "border-white/[0.06]") +
                            // items-center (no items-end): el botón queda centrado contra el
                            // bloque de precio de altura fija en vez de pegado abajo del todo —
                            // misma posición tenga o no tenga descuento el servicio.
                            " mt-4 flex items-center justify-between gap-4 border-t pt-4"
                          }
                        >
                          {/* Bloque de precio: un elemento invisible (siempre con la
                              estructura de 2 filas) reserva la altura para que todas las
                              tarjetas midan exactamente lo mismo, tengan o no descuento.
                              El contenido visible se superpone en la misma celda de grid:
                              con descuento queda arriba (ambas filas, como antes); sin
                              descuento se centra en esa altura reservada, quedando a la
                              misma línea vertical que el botón "Reservar". */}
                          <div className="min-w-0 grid">
                            <div className="invisible col-start-1 row-start-1" aria-hidden="true">
                              <p className="text-xs font-semibold">Precio de lista</p>
                              <p className="text-xl font-extrabold tracking-tight">{formatMoney(service.price)}</p>
                              <div className="mt-2">
                                <p className="text-xs font-semibold">Descuento en efectivo</p>
                                <p className="text-xl font-extrabold tracking-tight">{formatMoney(cash)}</p>
                              </div>
                            </div>
                            <div
                              className={
                                "col-start-1 row-start-1 flex min-w-0 flex-col" +
                                (hasCashDiscount ? " justify-start" : " justify-center")
                              }
                            >
                              <p className={(isLight ? "text-zinc-400" : "text-white/40") + " text-xs font-semibold"}>Precio de lista</p>
                              <p className={(isLight ? "text-zinc-900" : "text-white") + " text-xl font-extrabold tracking-tight"}>
                                {formatMoney(service.price)}
                              </p>
                              {hasCashDiscount ? (
                                <div className="mt-2">
                                  <p className={(isLight ? "text-emerald-600/80" : "text-emerald-400/80") + " text-xs font-semibold"}>
                                    Descuento en efectivo
                                  </p>
                                  <p className={(isLight ? "text-emerald-600" : "text-emerald-400") + " text-xl font-extrabold tracking-tight"}>
                                    {formatMoney(cash)}
                                  </p>
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <a
                            href={bookingHref({ service: service.id })}
                            className="shrink-0 rounded-full px-5 py-2.5 text-sm font-bold transition hover:-translate-y-0.5 hover:brightness-110"
                            style={{ background: cAccent, color: accentButtonText, WebkitTextFillColor: accentButtonText, boxShadow: "0 14px 30px -12px color-mix(in oklch, var(--c-accent) 75%, transparent)" }}
                          >
                            Reservar
                          </a>
                        </div>
                      </div>
                    );
                  })}
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
                      // min-w-0: ítem de un grid — sin esto, el truncate
                      // del nombre de abajo puede empujar la página a
                      // desbordar horizontalmente en mobile (mismo bug que
                      // en Servicios/Confían en nosotros).
                      className="flex min-w-0 items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4 transition hover:bg-white/[0.06]"
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
                          <Star className="h-4 w-4 fill-current" style={{ color: "#F5B301" }} />
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
                        <img src={src} alt={`Imagen ${i + 1} de ${business.name}`} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" style={{ objectPosition: portfolioPositions[i] || "50% 50%" }} loading="lazy" decoding="async" />
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
                  className="h-full w-full border-0"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            </GlowCard>
          ) : null}

        </div>

        <aside className="min-w-0 space-y-5 lg:sticky lg:top-6 lg:self-start">
          {/* Reserva */}
          <GlowCard className="p-5 sm:p-6">
            <Link
              {...reservarTo}
              className="inline-flex w-full items-center justify-center rounded-2xl px-5 py-3 text-base font-bold transition hover:brightness-110"
              style={{ background: cAccent, color: accentButtonText, WebkitTextFillColor: accentButtonText, boxShadow: "0 12px 32px -10px color-mix(in oklch, var(--c-accent) 70%, transparent)" }}
            >
              Reservar turno
            </Link>
          </GlowCard>

          {/* Horarios + Dirección */}
          <GlowCard className="flex flex-col p-5 sm:p-6 lg:min-h-[448px]">
            <div className="flex items-center gap-2">
              <Clock3 className="h-5 w-5" style={{ color: cAccent }} />
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
              <div className="mt-auto border-t border-white/[0.06] pt-5">
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: cAccent }} />
                  <div className="min-w-0">
                    <p className="text-white/70">{business.address}</p>
                    {mapLink ? (
                      <a href={mapLink} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold hover:underline" style={{ color: cAccent }}>
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


      {additionalInfo.length > 0 ? (
        <section className="mx-auto max-w-6xl px-4 pb-6">
          <GlowCard className="overflow-hidden">
            <div className="p-5 sm:p-6">
              <h2 className="text-2xl font-semibold">Beneficios del negocio</h2>
              {/* Grilla de tarjetas (2/3/4 columnas según ancho) en vez de
                  la nube de chips grises de antes — cada beneficio ya trae
                  su propio emoji cargado por el negocio ("⚡ Confirmación
                  instantánea", etc.); lo separamos del texto para mostrarlo
                  como ícono en una burbuja, con el color PRINCIPAL del
                  negocio de fondo muy suave (color-mix, nunca un hex fijo).
                  Si algún beneficio no trae emoji, cae a un check genérico. */}
              <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {additionalInfo.slice(0, 12).map((item) => {
                  const match = item.match(/^(\p{Extended_Pictographic}️?)\s*(.+)$/u);
                  const icon = match ? match[1] : "✓";
                  const label = match ? match[2] : item;
                  return (
                    <div
                      key={item}
                      // min-w-0: ítem de un grid, mismo cuidado que en
                      // Servicios/Profesionales/Confían en nosotros.
                      className={(isLight ? "border-zinc-200" : "border-white/10") + " flex min-w-0 items-center gap-2.5 rounded-2xl border p-3"}
                      style={{ background: "color-mix(in oklch, var(--c-primary) 6%, transparent)" }}
                    >
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base"
                        style={{ background: "color-mix(in oklch, var(--c-primary) 14%, transparent)" }}
                      >
                        {icon}
                      </span>
                      <span className="text-sm font-semibold leading-tight">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </GlowCard>
        </section>
      ) : null}

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
                  className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold transition hover:bg-white/10"
                >
                  <Phone className="h-5 w-5" /> WhatsApp
                </a>
              ) : null}
              {instagram ? (
                <a
                  href={`https://instagram.com/${instagram}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Instagram"
                  className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold transition hover:bg-white/10"
                >
                  <Instagram className="h-5 w-5" /> Instagram
                </a>
              ) : null}
              {business.email ? (
                <a
                  href={`mailto:${business.email}`}
                  aria-label="Email"
                  className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold transition hover:bg-white/10"
                >
                  <Mail className="h-5 w-5" /> Mail
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


      {showAllFeaturedClients ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm" onClick={() => setShowAllFeaturedClients(false)}>
          <div
            className={(isLight
              ? "border-zinc-200 bg-white text-zinc-950"
              : "border-white/10 bg-[#080512] text-white") + " max-h-[86vh] w-full max-w-4xl overflow-hidden rounded-[2rem] border shadow-2xl"}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={(isLight ? "border-zinc-200" : "border-white/10") + " flex items-start justify-between gap-4 border-b p-5 sm:p-6"}>
              <div className="flex min-w-0 items-center gap-2">
                <Crown className="h-[17px] w-[17px] shrink-0" strokeWidth={1.75} style={{ color: cPrimary }} />
                <h2 className="truncate text-lg font-semibold sm:text-2xl">Ellos confían en nosotros</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowAllFeaturedClients(false)}
                className={(isLight ? "bg-zinc-100 text-zinc-900 hover:bg-zinc-200" : "bg-white/10 text-white hover:bg-white/15") + " grid h-10 w-10 shrink-0 place-items-center rounded-full transition"}
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(86vh-96px)] overflow-y-auto p-5 sm:p-6">
              <div className="space-y-7">
                {featuredCategoryEntries.map(([category, items]) => (
                  <section key={category}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="text-lg font-bold">{category}</h3>
                      <span className={(isLight ? "bg-zinc-100 text-zinc-600" : "bg-white/10 text-white/60") + " rounded-full px-3 py-1 text-xs font-semibold"}>{items.length}</span>
                    </div>
                    <div className="flex flex-wrap justify-center gap-1 sm:gap-1.5">
                      {items.map((item, index) => (
                        <FeaturedClientCard
                          key={item.id || `featured-modal-${category}-${item.name}-${index}`}
                          item={item}
                          isLight={isLight}
                          imagePosition={item.id ? featuredPositions[item.id] : undefined}
                          onZoom={setZoomedFeaturedClient}
                          className={featuredCardWidthClass(featuredCols(items.length))}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Foto ampliada de una persona de "Confían en nosotros" — a
          diferencia del lightbox del portafolio (más abajo), este sí cierra
          tocando afuera, porque acá no hay galería con flechas: es una
          sola foto por persona. */}
      {zoomedFeaturedClient?.image_url ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={() => setZoomedFeaturedClient(null)}
        >
          <button
            type="button"
            onClick={() => setZoomedFeaturedClient(null)}
            className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/10 text-white transition hover:bg-white/20 sm:right-6 sm:top-6"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex max-h-[86vh] max-w-[min(92vw,520px)] flex-col items-center gap-4" onClick={(event) => event.stopPropagation()}>
            <img
              src={zoomedFeaturedClient.image_url}
              alt={zoomedFeaturedClient.name}
              className="max-h-[72vh] w-full rounded-2xl object-contain shadow-2xl"
              decoding="async"
            />
            <div className="text-center text-white">
              <p className="text-lg font-semibold">{zoomedFeaturedClient.name}</p>
              <p className="text-sm text-white/60">{zoomedFeaturedClient.category}</p>
              {zoomedFeaturedClient.category === "Futbolista" && zoomedFeaturedClient.club_name ? (
                <div className="mt-1.5 flex items-center justify-center gap-1.5">
                  {zoomedFeaturedClient.club_logo_url ? (
                    <img
                      src={zoomedFeaturedClient.club_logo_url}
                      alt={zoomedFeaturedClient.club_name}
                      className="h-5 w-5 rounded-full bg-white/10 object-cover ring-1 ring-white/20"
                    />
                  ) : null}
                  <span className="text-sm font-medium text-white/70">{zoomedFeaturedClient.club_name}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

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

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] bg-[#08070c]/95 p-3 backdrop-blur sm:hidden">
        <Link
          {...reservarTo}
          className="flex w-full items-center justify-center rounded-2xl px-5 py-3 text-base font-bold text-white"
          style={{ background: cAccent, color: accentButtonText, WebkitTextFillColor: accentButtonText, boxShadow: "0 12px 32px -10px color-mix(in oklch, var(--c-accent) 70%, transparent)" }}
        >
          Reservar turno
        </Link>
      </div>
    </main>
  );
}


/* clippr public glow tuning */
