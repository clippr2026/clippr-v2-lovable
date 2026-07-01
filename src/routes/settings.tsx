const DEFAULT_SENA_MESSAGE = `¡Hola! 👋

Para confirmar tu turno es necesario abonar una seña.

Datos para realizar el pago:

Titular: [Nombre]
Alias: [Alias]
CBU: [CBU]

Una vez realizado el pago, envianos el comprobante por WhatsApp al:

📲 [WhatsApp del local]

IMPORTANTE:

• La seña se descuenta del valor total del servicio.
• Podés cancelar o reprogramar tu turno hasta 24 horas antes sin perder la seña.
• Si cancelás con menos de 24 horas de anticipación o no asistís al turno, la seña no será reembolsable.
• La reserva queda confirmada únicamente una vez acreditado el pago.
• En caso de no recibir el comprobante, el turno podrá ser liberado para otro cliente.

¡Muchas gracias! Te esperamos. 🙌`;

import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import {
  Check,
  MapPin,
  Phone,
  Globe,
  X,
  ExternalLink,
  Share2,
  FileText,
  Image as ImageIcon,
  Building2,
  Upload,
  Copy,
  Timer,
  CalendarDays,
  AlarmClock,
  Plus,
  Trash2,
  Scissors,
  ChevronUp,
  ChevronDown,
  Mail,
  Instagram,
  GripVertical,
  Zap,
  Eye,
  Banknote,
  Landmark,
  CreditCard,
  Wallet,
  PiggyBank,
  ArrowLeftRight,
  Rocket,
  Crown,
  Shield,
  Sparkles,
  ChevronRight,
  User as UserIcon,
  Store,
  Cloud,
  RefreshCw,
  Headphones,
  Lock,
  Users,
  UserPlus,
  CheckCircle2,
  XCircle,
  Star,
  ShieldCheck,
  Handshake,
  HandCoins,
  Palette,
  Moon,
  Sun,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SpecialHoursEditor } from "@/components/settings/special-hours-editor";
import type {
  SpecialDateMap,
  EmployeeSpecialDateMap,
} from "@/components/agenda/use-agenda-data";
import { ClipprLoader } from "@/components/ui/clippr-loader";


function ReservasOnlineIcon({
  className,
  strokeWidth,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <span className={cn("relative inline-grid h-5 w-5 place-items-center", className)}>
      <Globe className="h-5 w-5" strokeWidth={strokeWidth ?? 2} />
      <span className="absolute -bottom-1 -left-1 rounded-full border-2 border-[oklch(0.11_0.03_260)] bg-emerald-400 px-1 py-[1px] text-[6px] font-black leading-none tracking-[-0.02em] text-white shadow-sm">
        WWW
      </span>
    </span>
  );
}

type SectionId =
  | "branding"
  | "landing"
  | "horarios"
  | "equipo"
  | "servicios"
  | "catalogo"
  | "caja"
  | "cuenta"
  | "senas"
  | "plan";

type NavItem = {
  id: SectionId;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tint: string;
  glow: string;
};

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: "General",
    items: [
      {
        id: "branding",
        label: "Página de reservas",
        icon: ReservasOnlineIcon,
        tint: "text-white",
        glow: "from-[oklch(0.7_0.25_300/0.25)] to-[oklch(0.55_0.27_285/0.05)]",
      },
      {
        id: "horarios",
        label: "Horarios",
        icon: CalendarDays,
        tint: "text-[oklch(0.78_0.2_270)]",
        glow: "from-[oklch(0.78_0.2_270/0.25)] to-[oklch(0.65_0.22_285/0.05)]",
      },
    ],
  },
  {
    label: "Operaciones",
    items: [
      {
        id: "equipo",
        label: "Equipo",
        icon: Users,
        tint: "text-[oklch(0.82_0.16_200)]",
        glow: "from-[oklch(0.82_0.16_200/0.25)] to-[oklch(0.7_0.2_220/0.05)]",
      },
      {
        id: "servicios",
        label: "Servicios",
        icon: Zap,
        tint: "text-[oklch(0.85_0.18_160)]",
        glow: "from-[oklch(0.85_0.18_160/0.25)] to-[oklch(0.7_0.2_170/0.05)]",
      },
      {
        id: "catalogo",
        label: "Catálogo",
        icon: Store,
        tint: "text-[oklch(0.82_0.14_75)]",
        glow: "from-[oklch(0.82_0.14_75/0.25)] to-[oklch(0.78_0.17_55/0.05)]",
      },
    ],
  },
  {
    label: "Sistema",
    items: [
      {
        id: "caja" as const,
        label: "Caja",
        icon: Banknote,
        tint: "text-[oklch(0.80_0.18_45)]",
        glow: "from-[oklch(0.80_0.18_45/0.25)] to-[oklch(0.75_0.2_35/0.05)]",
      },
      {
        id: "cuenta" as const,
        label: "Cuenta",
        icon: CreditCard,
        tint: "text-[oklch(0.82_0.16_210)]",
        glow: "from-[oklch(0.82_0.16_210/0.25)] to-[oklch(0.68_0.20_230/0.05)]",
      },
    ],
  },
];

// ─────────── Apariencia ───────────
const THEME_KEY = "clippr_theme";

function AparienciaSection() {
  const [theme, setThemeState] = React.useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem(THEME_KEY) as "dark" | "light") ?? "dark";
  });

  function applyTheme(t: "dark" | "light") {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
    const root = document.documentElement;
    if (t === "light") {
      root.classList.remove("dark");
      root.classList.add("light");
    } else {
      root.classList.remove("light");
      root.classList.add("dark");
    }
  }

  // Apply saved theme on mount
  React.useEffect(() => {
    applyTheme(theme);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const options = [
    {
      id: "dark" as const,
      label: "Oscuro",
      desc: "Fondo negro, ideal para trabajar de noche o en ambientes con poca luz.",
      Icon: Moon,
      preview: "bg-[oklch(0.09_0.03_275)]",
      ring: "ring-white/10",
    },
    {
      id: "light" as const,
      label: "Claro",
      desc: "Fondo blanco, ideal para trabajar con luz natural o durante el día.",
      Icon: Sun,
      preview: "bg-[oklch(0.97_0.01_270)]",
      ring: "ring-black/10",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-display font-semibold">Apariencia</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Elegí el tema visual de la aplicación.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {options.map((opt) => {
          const isActive = theme === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => applyTheme(opt.id)}
              className={cn(
                "relative rounded-2xl p-4 text-left transition-all ring-1",
                isActive
                  ? "ring-primary bg-primary/10"
                  : "ring-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
              )}
            >
              {/* Preview swatch */}
              <div
                className={cn(
                  "rounded-xl h-20 mb-4 flex items-center justify-center ring-1",
                  opt.preview,
                  opt.ring,
                )}
              >
                <opt.Icon
                  className={cn(
                    "size-7",
                    opt.id === "dark" ? "text-white/60" : "text-white/50",
                  )}
                />
              </div>

              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-sm">{opt.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {opt.desc}
                  </div>
                </div>
                {isActive && (
                  <div className="shrink-0 h-5 w-5 rounded-full bg-primary grid place-items-center mt-0.5">
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path
                        d="M1 4L3.5 6.5L9 1"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        El tema elegido se guarda localmente en este dispositivo.
      </p>
    </div>
  );
}

// ─────────── Branding ───────────
type FeaturedClientCategory =
  | "Marca"
  | "Artista"
  | "Futbolista"
  | "Equipo de fútbol"
  | "Influencer"
  | "Empresa"
  | "Celebridad"
  | "Otro";

type FeaturedClient = {
  id: string;
  name: string;
  category: FeaturedClientCategory;
  image_url: string;
  active: boolean;
  order: number;
};

const FEATURED_CLIENT_CATEGORIES: FeaturedClientCategory[] = [
  "Marca",
  "Artista",
  "Futbolista",
  "Equipo de fútbol",
  "Influencer",
  "Empresa",
  "Celebridad",
  "Otro",
];

function makeEmptyFeaturedClient(order = 0): FeaturedClient {
  return {
    id: `featured-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    category: "Marca",
    image_url: "",
    active: true,
    order,
  };
}

// ─────────── Beneficios del local (lista editable, máx. 12) ───────────
type Benefit = { id: string; label: string; active: boolean };

const DEFAULT_BENEFITS: string[] = [
  "⚡ Confirmación instantánea",
  "📅 Reserva online 24/7",
  "💈 Orden de llegada",
  "💎 Servicio premium",
  "☕ Bebidas de cortesía",
  "💳 Acepta tarjetas",
  "📶 Wi-Fi gratuito",
  "❄️ Ambiente climatizado",
  "🎵 Música ambiente",
  "🧴 Productos profesionales",
  "🚗 Estacionamiento cercano",
  "⭐ Atención personalizada",
];

function makeBenefitId(): string {
  return `benefit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function buildDefaultBenefits(): Benefit[] {
  return DEFAULT_BENEFITS.map((label, index) => ({
    id: makeBenefitId(),
    label,
    active: index < 8,
  }));
}

function normalizeBenefits(value: unknown): Benefit[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .map((b) => ({
      id: typeof b.id === "string" && b.id ? b.id : makeBenefitId(),
      label: typeof b.label === "string" ? b.label.slice(0, 35) : "",
      active: b.active !== false,
    }))
    .filter((b) => b.label.trim().length > 0)
    .slice(0, 12);
}

function normalizeFeaturedClients(value: unknown): FeaturedClient[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const row =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      const category = FEATURED_CLIENT_CATEGORIES.includes(
        row.category as FeaturedClientCategory,
      )
        ? (row.category as FeaturedClientCategory)
        : "Otro";
      return {
        id:
          typeof row.id === "string" && row.id
            ? row.id
            : `featured-${Date.now()}-${index}`,
        name: typeof row.name === "string" ? row.name : "",
        category,
        image_url: typeof row.image_url === "string" ? row.image_url : "",
        active: row.active !== false,
        order: Number.isFinite(Number(row.order)) ? Number(row.order) : index,
      };
    })
    .filter((item) => item.name.trim() || item.image_url.trim())
    .sort((a, b) => a.order - b.order);
}

type BrandingData = {
  name: string;
  slug: string;
  address: string;
  phone: string;
  email: string;
  instagram: string;
  website: string;
  description: string;
  profile_note: string;
  profile_note_active: boolean;
  logo_url: string;
  avatar_url: string;
  cover_url: string;
  portfolio_urls: string[];
  featured_clients: FeaturedClient[];
  avatar_position: string;
  cover_position: string;
  portfolio_positions: string[];
  featured_positions: Record<string, string>;
  business_start_date: string;
};
const PROFILE_NOTE_MAX_LINES = 3;
const DEFAULT_PROFILE_NOTE = "🔥 Todos los Miercoles 20% OFF EN EFECTIVO";

const EMPTY_BRANDING: BrandingData = {
  name: "",
  slug: "",
  address: "",
  phone: "",
  email: "",
  instagram: "",
  website: "",
  description: "",
  profile_note: "",
  profile_note_active: false,
  logo_url: "",
  avatar_url: "",
  cover_url: "",
  portfolio_urls: [],
  featured_clients: [],
  avatar_position: "50% 50%",
  cover_position: "50% 50%",
  portfolio_positions: [],
  featured_positions: {},
  business_start_date: "",
};

// Optimiza una imagen del lado del cliente: redimensiona (sin agrandar) dentro de
// maxW x maxH y la convierte a WebP (cae a JPEG si el navegador no soporta WebP).
async function processImage(
  file: File,
  maxW: number,
  maxH: number,
  quality = 0.8,
): Promise<{ blob: Blob; ext: string; type: string }> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("No se pudo leer la imagen"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("No se pudo cargar la imagen"));
    i.src = dataUrl;
  });
  const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.drawImage(img, 0, 0, w, h);
  const toBlob = (type: string) =>
    new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), type, quality),
    );
  let blob = await toBlob("image/webp");
  let ext = "webp";
  let type = "image/webp";
  if (!blob) {
    blob = await toBlob("image/jpeg");
    ext = "jpg";
    type = "image/jpeg";
  }
  if (!blob) throw new Error("No se pudo procesar la imagen");
  return { blob, ext, type };
}

// Normaliza un slug para URLs públicas: minúsculas, sin acentos, sin espacios,
// solo a-z 0-9 y guiones, sin guiones colgando.
function slugify(value: string): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
// Versión suave para mientras el usuario escribe (no recorta guiones del final).
function slugifyLive(value: string): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-");
}

// ─────────── Landing (colores de la página pública) ───────────
const LANDING_DEFAULTS = {
  primary: "#7c3aed",
  secondary: "#d946ef",
  accent: "#d6b66a",
  buttonText: "#ffffff",
};
const LANDING_THEME_DEFAULT = "dark" as const;
type LandingTheme = "dark" | "light";
const HEX_RE = /^#([0-9a-fA-F]{6})$/;

function normalizeHex(value: string, fallback: string): string {
  const v = (value || "").trim();
  return HEX_RE.test(v) ? v.toLowerCase() : fallback;
}

const ADDITIONAL_INFO_OPTIONS = [
  "⚡ Confirmación instantánea",
  "📅 Reserva online 24/7",
  "💳 Acepta tarjetas",
  "📶 Wi-Fi gratuito",
  "🚗 Estacionamiento cercano",
  "♿ Accesible para silla de ruedas",
  "☕ Café de cortesía",
  "❄️ Ambiente climatizado",
  "💎 Atención premium",
  "🎵 Música ambiente",
  "🧴 Productos profesionales",
  "🐶 Pet friendly",
];
const MAX_ADDITIONAL_INFO = 12;

function LandingSection() {
  const { businessId } = useAuth();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [colors, setColors] = React.useState(LANDING_DEFAULTS);
  const [theme, setTheme] = React.useState<LandingTheme>(LANDING_THEME_DEFAULT);
  const [additionalInfo, setAdditionalInfo] = React.useState<string[]>([]);
  const [newAdditionalInfo, setNewAdditionalInfo] = React.useState("");

  React.useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule ?? {}) as Record<string, any>;
        const c = (schedule._branding?.colors ?? {}) as Record<string, string>;
        setColors({
          primary: normalizeHex(
            c.primary,
            normalizeHex(c.secondary, LANDING_DEFAULTS.primary),
          ),
          secondary: normalizeHex(c.secondary, LANDING_DEFAULTS.secondary),
          accent: normalizeHex(c.accent, LANDING_DEFAULTS.accent),
          buttonText: normalizeHex(c.buttonText, LANDING_DEFAULTS.buttonText),
        });
        const savedTheme = schedule._branding?.theme;
        setTheme(savedTheme === "light" ? "light" : "dark");
        const savedAdditional = Array.isArray(
          schedule._branding?.additional_info,
        )
          ? schedule._branding.additional_info
          : [];
        const cleanAdditional = savedAdditional
          .filter(
            (item: unknown): item is string =>
              typeof item === "string" && item.trim().length > 0,
          )
          .slice(0, MAX_ADDITIONAL_INFO);
        setAdditionalInfo(
          cleanAdditional.length > 0
            ? cleanAdditional
            : ADDITIONAL_INFO_OPTIONS,
        );
        setLoading(false);
      });
  }, [businessId]);

  async function save(showToast = true) {
    if (!businessId) return;
    setSaving(true);
    const next = {
      primary: normalizeHex(colors.primary, LANDING_DEFAULTS.primary),
      secondary: normalizeHex(colors.secondary, LANDING_DEFAULTS.secondary),
      accent: normalizeHex(colors.accent, LANDING_DEFAULTS.accent),
      buttonText: normalizeHex(colors.buttonText, LANDING_DEFAULTS.buttonText),
    };
    // Merge sin pisar el resto de _branding.
    const { data: row, error: loadErr } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    if (loadErr) {
      setSaving(false);
      return toast.error(
        "No se pudo leer la configuración: " + loadErr.message,
      );
    }
    const schedule = (row?.schedule ?? {}) as Record<string, unknown>;
    const branding = (schedule._branding ?? {}) as Record<string, unknown>;
    const nextAdditionalInfo = additionalInfo
      .filter((item) => item.trim().length > 0)
      .slice(0, 12);
    const nextSchedule = {
      ...schedule,
      _branding: {
        ...branding,
        colors: next,
        theme,
        additional_info: nextAdditionalInfo,
      },
    };
    const { error } = await supabase
      .from("business_settings")
      .upsert(
        { business_id: businessId, schedule: nextSchedule },
        { onConflict: "business_id" },
      );
    setSaving(false);
    if (error) return toast.error("No se pudo guardar: " + error.message);
    setColors(next);
    toast.success("Landing guardada");
  }

  function updateAdditionalInfo(index: number, value: string) {
    setAdditionalInfo((current) =>
      current
        .map((item, i) => (i === index ? value.slice(0, 35) : item))
        .slice(0, MAX_ADDITIONAL_INFO),
    );
  }

  function removeAdditionalInfo(index: number) {
    setAdditionalInfo((current) => current.filter((_, i) => i !== index));
  }

  function addAdditionalInfo() {
    const value = newAdditionalInfo.trim().slice(0, 35);
    if (!value) return;
    if (additionalInfo.length >= MAX_ADDITIONAL_INFO) {
      toast.error("Máximo 12 beneficios.");
      return;
    }
    setAdditionalInfo((current) =>
      [...current, value].slice(0, MAX_ADDITIONAL_INFO),
    );
    setNewAdditionalInfo("");
  }

  const fields: { key: keyof typeof colors; label: string; desc: string }[] = [
    {
      key: "primary",
      label: "Color principal",
      desc: "Color base de la portada, glows y fondo ambiental.",
    },
    {
      key: "accent",
      label: "Color de resaltado",
      desc: "Botones, estados, acciones principales, links, íconos e indicadores.",
    },
    {
      key: "buttonText",
      label: "Texto de botones",
      desc: "Color de la letra dentro de los botones principales.",
    },
  ];

  if (loading) {
    return (
      <div className="grid place-items-center py-20">
        <ClipprLoader size="screen" delayMs={130} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-6">
        <h2
          id="pagina-reservas-colores"
          className="scroll-mt-28 text-lg font-semibold"
        >
          Colores
        </h2>
        <p className="mt-1 text-sm text-white/55">
          Personalizá modo claro/oscuro, gradientes, glows, color de resaltado,
          texto de botones y beneficios del local.
        </p>

        <div className="mt-5 space-y-4">
          {fields.map(({ key, label, desc }) => (
            <div key={key} className="flex items-center gap-4">
              <label
                className="relative h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-white/15"
                style={{ background: colors[key] }}
              >
                <input
                  type="color"
                  value={normalizeHex(colors[key], LANDING_DEFAULTS[key])}
                  onChange={(e) =>
                    setColors((c) => ({ ...c, [key]: e.target.value }))
                  }
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-white/50">{desc}</div>
              </div>
              <input
                type="text"
                value={colors[key]}
                onChange={(e) =>
                  setColors((c) => ({ ...c, [key]: e.target.value }))
                }
                spellCheck={false}
                className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-mono uppercase outline-none focus:border-white/25"
                placeholder="#000000"
              />
            </div>
          ))}
        </div>

        <div className="mt-6 border-t border-white/10 pt-5">
          <h3 className="text-sm font-semibold">Modo de la página pública</h3>
          <p className="mt-1 text-xs text-white/50">
            Elegí si el perfil público y la reserva online se ven en modo oscuro
            o claro.
          </p>
          <div className="mt-3 grid max-w-sm grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/5 p-1">
            {(["dark", "light"] as LandingTheme[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTheme(mode)}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
                  theme === mode
                    ? "bg-white text-slate-950 shadow-sm"
                    : "bg-transparent text-white/65 hover:bg-white/10 hover:text-white",
                )}
              >
                {mode === "dark" ? (
                    <>
                      <Moon className="h-3.5 w-3.5" />
                      Modo oscuro
                    </>
                  ) : (
                    <>
                      <Sun className="h-3.5 w-3.5" />
                      Modo claro
                    </>
                  )}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-white/10 pt-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold">Beneficios del negocio</h3>
            </div>
            <span className="text-xs font-medium text-white/45">
              {additionalInfo.length}/{MAX_ADDITIONAL_INFO}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {additionalInfo.slice(0, MAX_ADDITIONAL_INFO).map((item, index) => (
              <span
                key={`${index}-${item}`}
                className="inline-flex items-center gap-2 rounded-full bg-white/[0.075] px-3 py-2 ring-1 ring-white/10"
              >
                <input
                  value={item}
                  maxLength={35}
                  onChange={(e) => updateAdditionalInfo(index, e.target.value)}
                  className="w-48 max-w-[50vw] bg-transparent text-sm font-medium outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeAdditionalInfo(index)}
                  className="text-red-300 transition hover:text-red-200"
                  aria-label="Eliminar"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={newAdditionalInfo}
              maxLength={35}
              onChange={(e) => setNewAdditionalInfo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addAdditionalInfo();
                }
              }}
              placeholder="Agregar beneficio..."
              disabled={additionalInfo.length >= MAX_ADDITIONAL_INFO}
              className="flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-45"
            />
            <button
              type="button"
              onClick={addAdditionalInfo}
              disabled={additionalInfo.length >= MAX_ADDITIONAL_INFO}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Agregar
            </button>
          </div>
          {additionalInfo.length >= MAX_ADDITIONAL_INFO ? (
            <p className="mt-2 text-xs text-white/45">
              Llegaste al máximo de 12.
            </p>
          ) : null}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar colores"}
          </button>
          <button
            type="button"
            onClick={() => setColors(LANDING_DEFAULTS)}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 transition hover:bg-white/10"
          >
            Restaurar predeterminados
          </button>
        </div>
      </div>

      {/* Vista previa */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-6">
        <p className="text-sm font-medium text-white/70">Vista previa</p>
        <div
          className="mt-3 overflow-hidden rounded-2xl border p-6"
          style={{
            borderColor:
              theme === "light"
                ? "rgba(15,23,42,0.10)"
                : "rgba(255,255,255,0.10)",
            color: theme === "light" ? "#0f172a" : "#fff",
            background: `radial-gradient(circle at top left, color-mix(in oklch, ${colors.primary} 34%, transparent), transparent 40%), radial-gradient(circle at top right, color-mix(in oklch, ${colors.primary} 28%, transparent), transparent 40%), ${theme === "light" ? "#f8fafc" : "#08070c"}`,
          }}
        >
          <div className="relative">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-1 rounded-[2rem] opacity-[0.14] blur-2xl"
              style={{
                background: `radial-gradient(60% 70% at 18% 0%, ${colors.primary}, transparent 70%), radial-gradient(55% 70% at 100% 100%, ${colors.primary}, transparent 70%)`,
              }}
            />
            <div
              className="relative rounded-3xl border p-4 shadow-xl"
              style={{
                borderColor:
                  theme === "light"
                    ? "rgba(15,23,42,0.10)"
                    : "rgba(255,255,255,0.10)",
                background:
                  theme === "light"
                    ? "rgba(255,255,255,0.88)"
                    : "rgba(255,255,255,0.04)",
                color: theme === "light" ? "#0f172a" : "#fff",
              }}
            >
              <h3 className="text-base font-semibold">Reservá tu turno</h3>
              <button
                type="button"
                className="mt-3 inline-flex w-full items-center justify-center rounded-2xl px-5 py-3 text-sm font-bold"
                style={{
                  background: colors.accent,
                  color: colors.buttonText,
                  boxShadow: `0 12px 32px -10px color-mix(in oklch, ${colors.accent} 70%, transparent)`,
                }}
              >
                Reservar turno
              </button>
              <div className="mt-3 flex items-center gap-2 text-sm">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: colors.accent }}
                />
                <span style={{ color: colors.accent, fontWeight: 600 }}>
                  Abierto ahora
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function normalizeWhatsAppArgentina(phone: string): string {
  let raw = String(phone ?? "").replace(/\D/g, "");
  if (!raw) return "";
  if (raw.startsWith("00")) raw = raw.slice(2);

  // Si ya viene internacional, lo dejamos en formato WhatsApp Argentina móvil.
  if (raw.startsWith("549")) return raw;
  if (raw.startsWith("54")) {
    let rest = raw.slice(2).replace(/^0+/, "");
    if (!rest.startsWith("9")) rest = `9${rest}`;
    return `54${rest}`;
  }

  raw = raw.replace(/^0+/, "");

  // AMBA: muchas personas escriben 15 + 8 dígitos. WhatsApp necesita 54911 + 8 dígitos.
  if (raw.startsWith("15") && raw.length === 10) return `54911${raw.slice(2)}`;

  // Si escriben 11 + 8 dígitos: 1127900829 => 5491127900829.
  return `549${raw}`;
}

function formatWhatsAppArgentinaPreview(normalized: string): string {
  if (!normalized) return "";
  if (!normalized.startsWith("549") || normalized.length < 12) return "";
  const national = normalized.slice(3);
  const area = national.slice(0, 2);
  const first = national.slice(2, 6);
  const last = national.slice(6);
  return `+54 9 ${area} ${first}${last ? ` ${last}` : ""}`;
}

function denormalizeStoredPhoneForInput(phone: string): string {
  const value = String(phone ?? "").trim();
  const digits = value.replace(/\D/g, "");

  // Compatibilidad con números ya guardados antes como WhatsApp Argentina.
  // Ej: 5491127900829 -> 1127900829
  if (digits.startsWith("549") && digits.length >= 12) return digits.slice(3);

  // Ej: 541127900829 -> 1127900829
  if (digits.startsWith("54") && digits.length >= 11) return digits.slice(2);

  return value;
}

function BrandingSection() {
  const { businessId } = useAuth();
  const [data, setData] = useState<BrandingData>(EMPTY_BRANDING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingPortfolioIndex, setUploadingPortfolioIndex] = useState<
    number | null
  >(null);
  const [uploadingFeaturedId, setUploadingFeaturedId] = useState<string | null>(
    null,
  );
  const [draggedFeaturedId, setDraggedFeaturedId] = useState<string | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<"info" | "imagenes" | "colores">(
    "info",
  );
  const [colors, setColors] = useState(LANDING_DEFAULTS);
  const [theme, setTheme] = useState<LandingTheme>(LANDING_THEME_DEFAULT);
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [customBenefit, setCustomBenefit] = useState("");

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    // Load name/slug + assets públicos desde businesses; el resto desde _branding.
    Promise.all([
      supabase
        .from("businesses")
        .select(
          "name,slug,address,phone,email,instagram,avatar_url,cover_url,business_start_date",
        )
        .eq("id", businessId)
        .maybeSingle(),
      supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]).then(([bizRes, settRes]) => {
      const biz = bizRes.data;
      const schedule = (settRes.data?.schedule ?? {}) as Record<
        string,
        unknown
      >;
      const cfg = (schedule._branding ?? {}) as Record<string, unknown>;
      const normalizedFeaturedClients = normalizeFeaturedClients(
        cfg.featured_clients,
      );
      setData({
        name: (biz?.name as string) ?? "",
        slug: (biz?.slug as string) ?? "",
        address: (cfg.address as string) ?? (biz?.address as string) ?? "",
        phone: denormalizeStoredPhoneForInput(
          ((cfg.phone as string) ?? (biz?.phone as string) ?? "") as string,
        ),
        email: (cfg.email as string) ?? (biz?.email as string) ?? "",
        instagram:
          (cfg.instagram as string) ?? (biz?.instagram as string) ?? "",
        website: (cfg.website as string) ?? "",
        description: (cfg.description as string) ?? "",
        profile_note: (cfg.profile_note as string) ?? "",
        profile_note_active: cfg.profile_note_active === true,
        logo_url: (cfg.logo_url as string) ?? "",
        avatar_url: (biz?.avatar_url as string) ?? "",
        cover_url: (biz?.cover_url as string) ?? "",
        portfolio_urls: Array.isArray(cfg.portfolio_urls)
          ? (cfg.portfolio_urls as string[]).filter(Boolean).slice(0, 3)
          : [],
        featured_clients:
          normalizedFeaturedClients.length > 0
            ? normalizedFeaturedClients
            : [makeEmptyFeaturedClient()],
        avatar_position: (cfg.avatar_position as string) ?? "50% 50%",
        cover_position: (cfg.cover_position as string) ?? "50% 50%",
        portfolio_positions: Array.isArray(cfg.portfolio_positions)
          ? (cfg.portfolio_positions as string[])
          : [],
        featured_positions: (cfg.featured_positions &&
        typeof cfg.featured_positions === "object"
          ? cfg.featured_positions
          : {}) as Record<string, string>,
        business_start_date: (biz?.business_start_date as string) ?? "",
      });
      const cc = (cfg.colors ?? {}) as Record<string, string>;
      setColors({
        primary: normalizeHex(
          cc.primary,
          normalizeHex(cc.secondary, LANDING_DEFAULTS.primary),
        ),
        secondary: normalizeHex(
          cc.secondary,
          normalizeHex(cc.primary, LANDING_DEFAULTS.secondary),
        ),
        accent: normalizeHex(cc.accent, LANDING_DEFAULTS.accent),
        buttonText: normalizeHex(cc.buttonText, LANDING_DEFAULTS.buttonText),
      });
      setTheme((cfg.theme as string) === "light" ? "light" : "dark");
      const rawBenefits = normalizeBenefits(cfg.benefits);
      if (rawBenefits.length > 0) {
        setBenefits(rawBenefits);
      } else {
        const legacy = Array.isArray(cfg.additional_info)
          ? (cfg.additional_info as unknown[]).filter(
              (x): x is string => typeof x === "string" && x.trim().length > 0,
            )
          : [];
        setBenefits(
          legacy.length > 0
            ? legacy
                .slice(0, 12)
                .map((label) => ({
                  id: makeBenefitId(),
                  label: label.slice(0, 35),
                  active: true,
                }))
            : buildDefaultBenefits(),
        );
      }
      setLoading(false);
    });
  }, [businessId]);

  // El preview sale de la URL real ya persistida (nada de object URLs locales,
  // que se pierden en re-renders / scroll / cambios de sección).
  const avatarPreview = data.avatar_url;
  const coverPreview = data.cover_url;

  const set =
    (k: keyof BrandingData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setData((d) => ({ ...d, [k]: e.target.value }));

  async function uploadImage(file: File, path: string): Promise<string | null> {
    const { error } = await supabase.storage
      .from("business-assets")
      .upload(path, file, { upsert: true });
    if (error) {
      toast.error("Error subiendo imagen: " + error.message);
      return null;
    }
    const { data: urlData } = supabase.storage
      .from("business-assets")
      .getPublicUrl(path);
    return urlData.publicUrl;
  }

  async function uploadBlob(
    blob: Blob,
    path: string,
    contentType: string,
  ): Promise<string | null> {
    const { error } = await supabase.storage
      .from("business-assets")
      .upload(path, blob, { upsert: true, contentType });
    if (error) {
      console.error("[storage] upload failed", {
        path,
        contentType,
        size: blob.size,
        error,
      });
      toast.error("No se pudo subir la imagen: " + error.message);
      return null;
    }
    const { data: urlData } = supabase.storage
      .from("business-assets")
      .getPublicUrl(path);
    // Cache-bust: el path se sobrescribe (upsert), así forzamos refrescar el CDN.
    return `${urlData.publicUrl}?v=${Date.now()}`;
  }

  // Persiste una columna de imagen directo en businesses (sin esperar a "Guardar").
  async function persistBrandingPatch(
    patch: Partial<
      Pick<
        BrandingData,
        | "address"
        | "phone"
        | "email"
        | "instagram"
        | "website"
        | "description"
        | "profile_note"
        | "logo_url"
        | "portfolio_urls"
        | "featured_clients"
      >
    >,
  ): Promise<boolean> {
    if (!businessId) return false;
    const { data: existingRow, error: loadError } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    if (loadError) {
      console.error("[branding] load settings error", loadError);
      toast.error("No se pudo leer la configuración: " + loadError.message);
      return false;
    }

    const existingSchedule = (existingRow?.schedule ?? {}) as Record<
      string,
      unknown
    >;
    const existingBranding = (existingSchedule._branding ?? {}) as Record<
      string,
      unknown
    >;
    const nextSchedule = {
      ...existingSchedule,
      _branding: {
        ...existingBranding,
        ...patch,
      },
    };

    const { error } = await supabase
      .from("business_settings")
      .upsert(
        { business_id: businessId, schedule: nextSchedule },
        { onConflict: "business_id" },
      );
    if (error) {
      console.error("[branding] persistBrandingPatch error", { patch, error });
      toast.error("No se pudo guardar la configuración: " + error.message);
      return false;
    }
    return true;
  }

  async function persistAsset(fields: {
    avatar_url?: string | null;
    cover_url?: string | null;
  }): Promise<boolean> {
    if (!businessId) return false;
    const { data: row, error } = await supabase
      .from("businesses")
      .update(fields)
      .eq("id", businessId)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[branding] persistAsset error", { fields, error });
      toast.error("No se pudo guardar la imagen: " + error.message);
      return false;
    }
    if (!row) {
      toast.error(
        "No se pudo guardar la imagen. Revisá los permisos del negocio.",
      );
      return false;
    }
    return true;
  }

  // Subida inmediata: optimiza → sube a Storage → persiste la URL en businesses.
  async function handleAvatarSelect(file: File | null) {
    if (!file || !businessId) return;
    setUploadingAvatar(true);
    try {
      const { blob, ext, type } = await processImage(file, 512, 512, 0.8);
      const url = await uploadBlob(blob, `${businessId}/profile.${ext}`, type);
      if (!url) return;
      setData((d) => ({ ...d, avatar_url: url }));
      toast.success("Foto cargada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleCoverSelect(file: File | null) {
    if (!file || !businessId) return;
    setUploadingCover(true);
    try {
      const { blob, ext, type } = await processImage(file, 1600, 600, 0.8);
      const url = await uploadBlob(blob, `${businessId}/cover.${ext}`, type);
      if (!url) return;
      setData((d) => ({ ...d, cover_url: url }));
      toast.success("Portada cargada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploadingCover(false);
    }
  }

  async function removeAvatar() {
    setData((d) => ({ ...d, avatar_url: "" }));
    toast.success("Foto quitada");
  }
  async function removeCover() {
    setData((d) => ({ ...d, cover_url: "" }));
    toast.success("Portada quitada");
  }

  async function handlePortfolioSelect(index: number, file: File | null) {
    if (!file || !businessId) return;
    setUploadingPortfolioIndex(index);
    try {
      const { blob, ext, type } = await processImage(file, 1200, 900, 0.78);
      const url = await uploadBlob(
        blob,
        `${businessId}/portfolio-${index + 1}.${ext}`,
        type,
      );
      if (!url) return;
      const next = [...data.portfolio_urls];
      next[index] = url;
      const clean = next.filter(Boolean).slice(0, 3);
      setData((d) => ({ ...d, portfolio_urls: clean }));
      toast.success("Imagen cargada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploadingPortfolioIndex(null);
    }
  }

  async function removePortfolioImage(index: number) {
    const next = data.portfolio_urls.filter((_, i) => i !== index).slice(0, 3);
    setData((d) => ({ ...d, portfolio_urls: next }));
    toast.success("Imagen quitada");
  }

  function addBenefit() {
    const value = customBenefit.trim().slice(0, 35);
    if (!value) return;
    if (benefits.length >= 12) {
      toast.error("Has alcanzado el máximo de 12 beneficios.");
      return;
    }
    if (benefits.some((b) => b.label.toLowerCase() === value.toLowerCase())) {
      setCustomBenefit("");
      return;
    }
    setBenefits((current) =>
      [...current, { id: makeBenefitId(), label: value, active: true }].slice(
        0,
        12,
      ),
    );
    setCustomBenefit("");
  }

  function updateBenefit(id: string, label: string) {
    setBenefits((current) =>
      current.map((b) =>
        b.id === id ? { ...b, label: label.slice(0, 35) } : b,
      ),
    );
  }

  function toggleBenefit(id: string) {
    setBenefits((current) =>
      current.map((b) => (b.id === id ? { ...b, active: !b.active } : b)),
    );
  }

  function removeBenefit(id: string) {
    setBenefits((current) => current.filter((b) => b.id !== id));
  }

  function moveBenefit(id: string, dir: -1 | 1) {
    setBenefits((current) => {
      const index = current.findIndex((b) => b.id === id);
      if (index < 0) return current;
      const target = index + dir;
      if (target < 0 || target >= current.length) return current;
      const list = [...current];
      [list[index], list[target]] = [list[target], list[index]];
      return list;
    });
  }

  function addFeaturedClient() {
    setData((d) => ({
      ...d,
      featured_clients: [
        ...d.featured_clients,
        makeEmptyFeaturedClient(d.featured_clients.length),
      ],
    }));
  }

  function updateFeaturedClient(id: string, patch: Partial<FeaturedClient>) {
    setData((d) => ({
      ...d,
      featured_clients: d.featured_clients.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  }

  function removeFeaturedClient(id: string) {
    setData((d) => {
      const next = d.featured_clients
        .filter((item) => item.id !== id)
        .map((item, index) => ({ ...item, order: index }));
      return {
        ...d,
        featured_clients: next.length > 0 ? next : [makeEmptyFeaturedClient()],
      };
    });
  }

  function moveFeaturedClient(id: string, direction: -1 | 1) {
    setData((d) => {
      const list = [...d.featured_clients];
      const index = list.findIndex((item) => item.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return d;
      [list[index], list[nextIndex]] = [list[nextIndex], list[index]];
      return {
        ...d,
        featured_clients: list.map((item, order) => ({ ...item, order })),
      };
    });
  }

  function reorderFeaturedClient(dragId: string | null, targetId: string) {
    if (!dragId || dragId === targetId) return;
    setData((d) => {
      const list = [...d.featured_clients];
      const from = list.findIndex((item) => item.id === dragId);
      const to = list.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return d;

      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);

      return {
        ...d,
        featured_clients: list.map((item, order) => ({ ...item, order })),
      };
    });
  }

  function nudgePosition(
    value: string | undefined,
    dx: number,
    dy: number,
  ): string {
    const [xRaw, yRaw] = String(value || "50% 50%").split(" ");
    const x = Math.min(100, Math.max(0, parseFloat(xRaw) || 50));
    const y = Math.min(100, Math.max(0, parseFloat(yRaw) || 50));
    return `${Math.min(100, Math.max(0, x + dx))}% ${Math.min(100, Math.max(0, y + dy))}%`;
  }

  function PositionControls({
    value,
    onChange,
  }: {
    value?: string;
    onChange: (next: string) => void;
  }) {
    return null;
  }

  async function handleFeaturedImageSelect(id: string, file: File | null) {
    if (!file || !businessId) return;
    setUploadingFeaturedId(id);
    try {
      const { blob, ext, type } = await processImage(file, 512, 512, 0.82);
      const url = await uploadBlob(
        blob,
        `${businessId}/featured-${id}.${ext}`,
        type,
      );
      if (!url) return;
      updateFeaturedClient(id, { image_url: url });
      toast.success("Imagen actualizada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploadingFeaturedId(null);
    }
  }

  async function save() {
    if (!businessId) return;
    setSaving(true);
    let logo_url = data.logo_url;
    if (logoFile) {
      const url = await uploadImage(logoFile, `${businessId}/logo`);
      if (url) logo_url = url;
    }

    // Foto de perfil y portada ya se suben y persisten al seleccionarlas.
    // Acá solo reusamos lo que ya está en data (se reescribe igual, es idempotente).
    const avatar_url = data.avatar_url;
    const cover_url = data.cover_url;

    // Resolver slug final: usa el escrito o lo deriva del nombre.
    const finalSlug = slugify(data.slug) || slugify(data.name);
    if (!finalSlug) {
      setSaving(false);
      return toast.error("Definí una URL pública (slug) o un nombre.");
    }
    // Validar que no esté usado por otro negocio.
    const { data: clash } = await supabase
      .from("businesses")
      .select("id")
      .eq("slug", finalSlug)
      .neq("id", businessId)
      .maybeSingle();
    if (clash) {
      setSaving(false);
      return toast.error("Esa URL pública ya está en uso. Probá otra.");
    }

    const normalizedPhone = normalizeWhatsAppArgentina(data.phone);

    // Save name + slug to businesses. Pedimos la fila de vuelta para detectar
    // el caso RLS: un UPDATE que no matchea filas devuelve éxito con 0 filas.
    const nameResult = await supabase
      .from("businesses")
      .update({
        name: data.name,
        slug: finalSlug,
        avatar_url: avatar_url || null,
        cover_url: cover_url || null,
        address: data.address || null,
        phone: data.phone || null,
        email: data.email || null,
        instagram: data.instagram || null,
        business_start_date: data.business_start_date || null,
      })
      .eq("id", businessId)
      .select("id,name,slug")
      .maybeSingle();

    // Save branding fields inside schedule._branding (schedule column exists).
    // Importante: siempre hacemos merge y preservamos imágenes/clientes destacados
    // si el estado llega vacío por una carga incompleta, para no pisar datos existentes.
    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    const existingSchedule = (existingRow?.schedule ?? {}) as Record<
      string,
      unknown
    >;
    const existingBranding = (existingSchedule._branding ?? {}) as Record<
      string,
      unknown
    >;
    const nextPortfolioUrls = data.portfolio_urls.filter(Boolean).slice(0, 3);
    const nextFeaturedClients = data.featured_clients
      .map((item, index) => ({
        ...item,
        order: index,
        name: item.name.trim(),
        image_url: item.image_url.trim(),
      }))
      .filter((item) => item.name || item.image_url);
    const newSchedule = {
      ...existingSchedule,
      _branding: {
        ...existingBranding,
        address: data.address,
        phone: normalizedPhone,
        email: data.email,
        instagram: data.instagram,
        website: data.website,
        description: data.description,
        profile_note: data.profile_note,
        profile_note_active: data.profile_note_active,
        logo_url:
          logo_url || (existingBranding.logo_url as string | undefined) || "",
        portfolio_urls:
          nextPortfolioUrls.length > 0
            ? nextPortfolioUrls
            : (existingBranding.portfolio_urls ?? []),
        featured_clients:
          nextFeaturedClients.length > 0
            ? nextFeaturedClients
            : (existingBranding.featured_clients ?? []),
        colors: {
          primary: normalizeHex(colors.primary, LANDING_DEFAULTS.primary),
          secondary: normalizeHex(colors.secondary, LANDING_DEFAULTS.secondary),
          accent: normalizeHex(colors.accent, LANDING_DEFAULTS.accent),
          buttonText: normalizeHex(
            colors.buttonText,
            LANDING_DEFAULTS.buttonText,
          ),
        },
        theme,
        benefits: benefits
          .map((b) => ({ id: b.id, label: b.label.trim(), active: b.active }))
          .filter((b) => b.label.length > 0)
          .slice(0, 12),
        additional_info: benefits
          .filter((b) => b.active && b.label.trim().length > 0)
          .map((b) => b.label.trim())
          .slice(0, 12),
        avatar_position: data.avatar_position,
        cover_position: data.cover_position,
        portfolio_positions: data.portfolio_positions,
        featured_positions: data.featured_positions,
      },
    };
    const cfgResult = await supabase
      .from("business_settings")
      .upsert(
        { business_id: businessId, schedule: newSchedule },
        { onConflict: "business_id" },
      );

    setSaving(false);
    if (nameResult.error)
      return toast.error("Error guardando: " + nameResult.error.message);
    if (!nameResult.data) {
      return toast.error(
        "No se pudo guardar el nombre y la URL pública. Revisá los permisos del negocio.",
      );
    }
    if (cfgResult.error)
      return toast.error("Error guardando: " + cfgResult.error.message);
    if (showToast) {
      setData((d) => ({
        ...d,
        logo_url,
        slug: finalSlug,
        avatar_url,
        cover_url,
      }));
      setLogoFile(null);
    }
    // Avisar al header (botón 🌐) para que actualice el link al instante.
    window.dispatchEvent(
      new CustomEvent("clippr:slug-updated", { detail: { slug: finalSlug } }),
    );
    if (showToast) toast.success("Guardado");
  }

  const saveRef = React.useRef(save);
  React.useEffect(() => {
    saveRef.current = save;
  }, [businessId, data, logoFile, colors, theme, benefits]);

  const brandingHydratedRef = React.useRef(false);

  React.useEffect(() => {
    if (loading || !businessId) return;

    if (!brandingHydratedRef.current) {
      brandingHydratedRef.current = true;
      return;
    }

    const timer = window.setTimeout(() => {
      void save(false);
    }, 650);

    return () => window.clearTimeout(timer);
  }, [data, logoFile, colors, theme, benefits, loading, businessId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent).detail?.section;
      if (!section || section === "branding") void saveRef.current(false);
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, []);

  if (loading)
    return (
      <div className="grid place-items-center py-24">
        <ClipprLoader size="screen" delayMs={130} />
      </div>
    );

  const publicSlug = slugify(data.slug) || slugify(data.name);
  const publicUrl = `https://myclippr.com/negocio/${publicSlug}`;
  const publicUrlShort = `myclippr.com/negocio/${publicSlug}`;

  async function copyPublicLink() {
    if (!publicSlug) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Link copiado correctamente");
    } catch {
      toast.error("No se pudo copiar el link");
    }
  }
  function openPublicSite() {
    if (!publicSlug) return;
    window.open(publicUrl, "_blank", "noopener,noreferrer");
  }
  async function sharePublicLink() {
    if (!publicSlug) return;
    const nav = navigator as Navigator & {
      share?: (d: { title?: string; url?: string }) => Promise<void>;
    };
    if (typeof nav.share === "function") {
      try {
        await nav.share({
          title: data.name || "Reservá tu turno",
          url: publicUrl,
        });
      } catch {
        /* usuario canceló el share */
      }
    } else {
      try {
        await navigator.clipboard.writeText(publicUrl);
        toast.success("Link copiado correctamente");
      } catch {
        toast.error("No se pudo copiar el link");
      }
    }
  }

  const infoRows: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    hint: string;
    key: keyof BrandingData;
    type?: string;
  }[] = [
    { icon: Building2, label: "Nombre", hint: "", key: "name" },
    { icon: MapPin, label: "Dirección", hint: "", key: "address" },
    { icon: Phone, label: "WhatsApp", hint: "Escribilo como lo usás. Clippr lo formatea para WhatsApp al enviar.", key: "phone" },
    { icon: Mail, label: "Email", hint: "", key: "email", type: "email" },
    { icon: Instagram, label: "Instagram", hint: "", key: "instagram" },
  ];

  return (
    <>
      <div>
        <h2 className="text-xl font-display font-semibold">
          Página de reservas
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configuración de la página pública de reservas
        </p>
      </div>

      <SectionCard label="Estado">
        <div
          className={cn(
            "relative flex flex-col gap-4 pr-0 transition lg:flex-row lg:items-center lg:pr-24",
            data.profile_note_active && "rounded-2xl",
          )}
        >
          <div className="absolute right-0 top-0 flex items-center">
            <button
              type="button"
              role="switch"
              aria-checked={data.profile_note_active}
              onClick={() =>
                setData((d) => {
                  const nextActive = !d.profile_note_active;
                  return {
                    ...d,
                    profile_note_active: nextActive,
                    profile_note:
                      nextActive && !d.profile_note.trim()
                        ? "🔥 Todos los Miercoles 20% OFF EN EFECTIVO"
                        : d.profile_note,
                  };
                })
              }
              className={cn(
                "relative h-8 w-16 rounded-full border transition focus:outline-none focus:ring-2 focus:ring-primary/40",
                data.profile_note_active
                  ? "border-violet-400/35 bg-violet-500/25 shadow-[0_0_22px_rgba(139,92,246,0.22)]"
                  : "border-white/8 bg-white/[0.035]",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 h-6 w-6 rounded-full transition-all duration-200",
                  data.profile_note_active
                    ? "left-9 bg-white shadow-[0_0_14px_rgba(255,255,255,0.35)]"
                    : "left-1 bg-white/60",
                )}
              />
            </button>
          </div>

          <div className="flex flex-1 items-start gap-4 min-w-0 pt-2 lg:pt-0">
            <div
              className={cn(
                "relative h-11 w-11 rounded-2xl ring-1 grid place-items-center shrink-0 transition",
                data.profile_note_active
                  ? "bg-violet-500/10 ring-violet-400/25"
                  : "bg-white/5 ring-white/10",
              )}
            >
              <span
                className={cn(
                  "absolute right-2 top-2 h-2.5 w-2.5 rounded-full transition",
                  data.profile_note_active
                    ? "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.9)]"
                    : "bg-white/25",
                )}
              />
              <Sparkles
                className={cn(
                  "h-5 w-5 transition",
                  data.profile_note_active
                    ? "text-violet-200"
                    : "text-white/45",
                )}
              />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm">Estado público</div>
              <p
                className={cn(
                  "mt-1 text-xs transition",
                  data.profile_note_active
                    ? "text-muted-foreground"
                    : "text-muted-foreground/70",
                )}
              >
                Aparece arriba de tu página pública. Ideal para promociones,
                avisos o novedades.
              </p>
            </div>
          </div>

          <div className="w-full lg:w-[420px]">
            <div className="relative">
              <input
                type="text"
                value={data.profile_note}
                onChange={(e) =>
                  setData((d) => ({
                    ...d,
                    profile_note: e.target.value.slice(0, 140),
                  }))
                }
                maxLength={140}
                placeholder="🔥 Todos los Miercoles 20% OFF EN EFECTIVO"
                className={cn(
                  "w-full rounded-xl px-3 py-2.5 pr-10 text-sm transition focus:outline-none",
                  data.profile_note_active
                    ? "bg-white/5 ring-1 ring-violet-400/40 focus:ring-violet-300/60 text-white"
                    : "bg-white/[0.035] ring-1 ring-white/10 text-white/60 placeholder:text-white/35 focus:ring-white/20",
                )}
              />
              {data.profile_note.trim() ? (
                <button
                  type="button"
                  onClick={() =>
                    setData((d) => ({
                      ...d,
                      profile_note: "",
                      profile_note_active: false,
                    }))
                  }
                  className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white"
                  aria-label="Limpiar estado"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                {data.profile_note_active
                  ? "Publicado en tu página pública"
                  : "Guardado como borrador. Activá el switch para publicarlo."}
              </span>
              <span>{data.profile_note.length}/140</span>
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-white/[0.035] p-2">
        {(
          [
            ["info", "Información"],
            ["imagenes", "Imágenes"],
            ["colores", "Colores"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={
              "rounded-xl px-4 py-2 text-sm font-semibold transition " +
              (activeTab === id
                ? "bg-white/[0.08] text-foreground ring-1 ring-white/10"
                : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "info" && (
        <>
          <SectionCard label="Información del negocio">
            <div className="divide-y divide-white/5">
              {infoRows.map((f) => {
                const Icon = f.icon;
                return (
                  <div
                    key={f.key}
                    className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center shrink-0">
                      <Icon className="h-4.5 w-4.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{f.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {f.hint}
                      </div>
                    </div>
                    <div className="w-72 max-w-[55%]">
                      <input
                        type={f.type ?? "text"}
                        value={(data[f.key] as string) ?? ""}
                        onChange={set(f.key)}
                        className="w-full rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40"
                      />
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center gap-4 py-3">
                <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center shrink-0">
                  <CalendarDays className="h-4.5 w-4.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">
                    Fecha de inicio del negocio
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Se usa para calcular los años de experiencia en el perfil
                    público.
                  </div>
                </div>
                <div className="w-72 max-w-[55%]">
                  <input
                    type="date"
                    value={data.business_start_date}
                    onChange={(e) =>
                      setData((d) => ({
                        ...d,
                        business_start_date: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40 [color-scheme:dark]"
                  />
                </div>
              </div>
              <div className="flex items-start gap-4 py-3">
                <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center shrink-0">
                  <Globe className="h-4.5 w-4.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">URL pública</div>
                  <div className="text-xs text-muted-foreground mt-0.5 break-all">
                    myclippr.com/negocio/
                    <span className="text-foreground">
                      {slugify(data.slug) || slugify(data.name) || "tu-negocio"}
                    </span>
                  </div>
                </div>
                <input
                  type="text"
                  value={data.slug}
                  onChange={(e) =>
                    setData((d) => ({
                      ...d,
                      slug: slugifyLive(e.target.value),
                    }))
                  }
                  onBlur={() =>
                    setData((d) => ({ ...d, slug: slugify(d.slug) }))
                  }
                  placeholder="auro-styloff"
                  className="w-72 max-w-[55%] rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40"
                />
              </div>
              <div className="flex items-start gap-4 py-3 last:pb-0">
                <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center shrink-0">
                  <FileText className="h-4.5 w-4.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">Descripción</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Cuéntale a tus clientes sobre tu empresa
                  </div>
                </div>
                <textarea
                  value={data.description}
                  onChange={set("description")}
                  rows={3}
                  className="w-72 max-w-[55%] rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-primary/40"
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard label="Beneficios del negocio">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span
                  className={cn(
                    "shrink-0 text-xs font-semibold",
                    benefits.length >= 12 ? "text-violet-300" : "text-white/45",
                  )}
                >
                  {benefits.length}/12
                </span>
              </div>

              {benefits.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-3 text-center text-xs text-muted-foreground">
                  Todavía no cargaste beneficios.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {benefits.map((b) => (
                    <div
                      key={b.id}
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-full border px-3 py-2 transition",
                        b.active
                          ? "border-emerald-500/25 bg-emerald-500/10"
                          : "border-white/10 bg-white/[0.05] opacity-75",
                      )}
                    >
                      <input
                        value={b.label}
                        maxLength={35}
                        onChange={(e) => updateBenefit(b.id, e.target.value)}
                        className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => toggleBenefit(b.id)}
                        className={cn(
                          "shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ring-1 transition",
                          b.active
                            ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                            : "bg-white/5 text-muted-foreground ring-white/10",
                        )}
                      >
                        {b.active ? "Activo" : "Inactivo"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeBenefit(b.id)}
                        className="shrink-0 text-red-300 hover:text-red-200"
                        aria-label="Eliminar"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  value={customBenefit}
                  onChange={(e) =>
                    setCustomBenefit(e.target.value.slice(0, 35))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addBenefit();
                    }
                  }}
                  maxLength={35}
                  disabled={benefits.length >= 12}
                  placeholder="Agregar beneficio..."
                  className="flex-1 rounded-full bg-white/5 ring-1 ring-white/10 px-4 py-2 text-sm focus:outline-none focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
                />
                <button
                  type="button"
                  onClick={addBenefit}
                  disabled={benefits.length >= 12}
                  className="rounded-full bg-white/8 px-4 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Agregar
                </button>
              </div>
              {benefits.length >= 12 ? (
                <p className="text-xs font-medium text-violet-300">
                  Has alcanzado el máximo de 12 beneficios.
                </p>
              ) : null}
            </div>
          </SectionCard>
        </>
      )}

      {activeTab === "imagenes" && (
        <>
          <SectionCard label="Imágenes" id="pagina-reservas-imagenes">
            <div className="space-y-5">
              {/* Foto de perfil */}
              <div className="flex items-center gap-4 border-b border-white/5 pb-5 last:border-b-0 last:pb-0">
                <label
                  className={cn(
                    "group relative grid h-16 w-16 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full border border-white/10 bg-white/[0.04] transition hover:bg-white/[0.07]",
                    uploadingAvatar && "cursor-not-allowed opacity-50",
                  )}
                >
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt="Foto de perfil"
                      className="h-full w-full object-cover"
                      style={{ objectPosition: data.avatar_position }}
                    />
                  ) : (
                    <UserIcon className="h-5 w-5 text-white/45" />
                  )}
                  <div className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 transition group-hover:opacity-100">
                    <span className="rounded-full bg-white/90 px-2 py-1 text-[10px] font-bold text-black">
                      {uploadingAvatar ? "Subiendo" : "Cargar"}
                    </span>
                  </div>
                  {!avatarPreview ? (
                    <span className="absolute bottom-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/70 ring-1 ring-white/10">
                      Cargar
                    </span>
                  ) : null}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingAvatar}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      e.target.value = "";
                      handleAvatarSelect(f);
                    }}
                  />
                </label>

                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">Foto de perfil</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Imagen circular del perfil público. Se optimiza a WebP
                    512px.
                  </div>
                </div>

                {avatarPreview ? (
                  <button
                    type="button"
                    onClick={removeAvatar}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/5 text-red-300 ring-1 ring-white/10 transition hover:bg-red-500/10 hover:text-red-200"
                    aria-label="Eliminar foto de perfil"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              {/* Portada */}
              <div className="flex items-center gap-4 border-b border-white/5 pb-5 last:border-b-0 last:pb-0">
                <label
                  className={cn(
                    "group relative grid h-16 w-28 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] transition hover:bg-white/[0.07] sm:w-36",
                    uploadingCover && "cursor-not-allowed opacity-50",
                  )}
                >
                  {coverPreview ? (
                    <img
                      src={coverPreview}
                      alt="Portada"
                      className="h-full w-full object-cover"
                      style={{ objectPosition: data.cover_position }}
                    />
                  ) : (
                    <ImageIcon className="h-5 w-5 text-white/45" />
                  )}
                  <div className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 transition group-hover:opacity-100">
                    <span className="rounded-full bg-white/90 px-2 py-1 text-[10px] font-bold text-black">
                      {uploadingCover ? "Subiendo" : "Cargar"}
                    </span>
                  </div>
                  {!coverPreview ? (
                    <span className="absolute bottom-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/70 ring-1 ring-white/10">
                      Cargar
                    </span>
                  ) : null}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingCover}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      e.target.value = "";
                      handleCoverSelect(f);
                    }}
                  />
                </label>

                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">Portada</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Banner superior de tu sitio web. Se optimiza a WebP
                    1600×600.
                  </div>
                </div>

                {coverPreview ? (
                  <button
                    type="button"
                    onClick={removeCover}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/5 text-red-300 ring-1 ring-white/10 transition hover:bg-red-500/10 hover:text-red-200"
                    aria-label="Eliminar portada"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              {/* Portafolio */}
              <div>
                <div className="mb-3 flex items-start gap-4">
                  <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center shrink-0">
                    <Sparkles className="h-4.5 w-4.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm">Portafolio</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Hasta 3 imágenes destacadas para tu página pública.
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {[0, 1, 2].map((index) => {
                    const url = data.portfolio_urls[index];
                    const uploading = uploadingPortfolioIndex === index;
                    return (
                      <div
                        key={index}
                        className="flex items-center gap-3 rounded-2xl bg-white/[0.03] p-2 ring-1 ring-white/10"
                      >
                        <label
                          className={cn(
                            "group relative grid h-20 w-20 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] transition hover:bg-white/[0.07]",
                            uploading && "cursor-not-allowed opacity-50",
                          )}
                        >
                          {url ? (
                            <img
                              src={url}
                              alt={`Imagen ${index + 1}`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <ImageIcon className="h-5 w-5 text-white/45" />
                          )}
                          <div className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 transition group-hover:opacity-100">
                            <span className="rounded-full bg-white/90 px-2 py-1 text-[10px] font-bold text-black">
                              {uploading ? "Subiendo" : "Cargar"}
                            </span>
                          </div>
                          {!url ? (
                            <span className="absolute bottom-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/70 ring-1 ring-white/10">
                              Cargar
                            </span>
                          ) : null}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={uploading}
                            onChange={(e) => {
                              const f = e.target.files?.[0] ?? null;
                              e.target.value = "";
                              handlePortfolioSelect(index, f);
                            }}
                          />
                        </label>

                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">
                            Imagen {index + 1}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {url ? "Cargada" : "Sin cargar"}
                          </div>
                        </div>

                        {url ? (
                          <button
                            type="button"
                            onClick={() => removePortfolioImage(index)}
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/5 text-red-300 ring-1 ring-white/10 transition hover:bg-red-500/10 hover:text-red-200"
                            aria-label={`Eliminar imagen ${index + 1}`}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard label="">
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium">Confían en nosotros</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Logos o fotos de personas, marcas o equipos que querés
                    mostrar en tu página pública. Si no hay activos, esta
                    sección no aparece.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addFeaturedClient}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10 transition hover:bg-white/10"
                >
                  <Plus className="h-4 w-4" /> Agregar
                </button>
              </div>

              <div className="space-y-2">
                {data.featured_clients.map((item, index) => {
                  const uploading = uploadingFeaturedId === item.id;
                  return (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={(event) => {
                        setDraggedFeaturedId(item.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        reorderFeaturedClient(draggedFeaturedId, item.id);
                        setDraggedFeaturedId(null);
                      }}
                      onDragEnd={() => setDraggedFeaturedId(null)}
                      className={cn(
                        "grid cursor-grab gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition active:cursor-grabbing lg:grid-cols-[22px_72px_1fr_170px_auto] lg:items-center",
                        draggedFeaturedId === item.id && "opacity-50",
                      )}
                    >
                      <GripVertical className="hidden h-4 w-4 text-white/35 lg:block" />
                      <label
                        className={cn(
                          "group relative grid h-16 w-16 cursor-pointer place-items-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] transition hover:bg-white/[0.07]",
                          uploading && "cursor-not-allowed opacity-50",
                        )}
                      >
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt={item.name || "Confían en nosotros"}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <ImageIcon className="h-5 w-5 text-white/45" />
                        )}
                        <div className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 transition group-hover:opacity-100">
                          <span className="rounded-full bg-white/90 px-2 py-1 text-[10px] font-bold text-black">
                            {uploading ? "Subiendo" : "Cargar"}
                          </span>
                        </div>
                        {!item.image_url ? (
                          <span className="absolute bottom-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/70 ring-1 ring-white/10">
                            Cargar
                          </span>
                        ) : null}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploading}
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            e.target.value = "";
                            handleFeaturedImageSelect(item.id, f);
                          }}
                        />
                      </label>

                      <input
                        value={item.name}
                        onChange={(e) =>
                          updateFeaturedClient(item.id, {
                            name: e.target.value,
                          })
                        }
                        placeholder="Nombre: Nike, Duki, Boca Juniors..."
                        className="rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40"
                      />

                      <select
                        value={item.category}
                        onChange={(e) =>
                          updateFeaturedClient(item.id, {
                            category: e.target.value as FeaturedClientCategory,
                          })
                        }
                        className="rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40"
                      >
                        {FEATURED_CLIENT_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>

                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateFeaturedClient(item.id, {
                              active: !item.active,
                            })
                          }
                          className={cn(
                            "rounded-full px-2.5 py-2 text-xs ring-1 transition",
                            item.active
                              ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                              : "bg-white/5 text-muted-foreground ring-white/10",
                          )}
                        >
                          {item.active ? "Activo" : "Inactivo"}
                        </button>

                        <button
                          type="button"
                          onClick={() => removeFeaturedClient(item.id)}
                          className="rounded-full bg-white/5 p-2 text-red-300 ring-1 ring-white/10 transition hover:bg-red-500/10 hover:text-red-200"
                          aria-label="Eliminar de Confían en nosotros"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </SectionCard>
        </>
      )}

      {activeTab === "colores" && (
        <>
          <SectionCard label="Colores">
            <p className="text-sm text-white/55">
              Personalizá modo claro/oscuro, gradientes, glows, color de
              resaltado y texto de botones.
            </p>
            <div className="mt-5 space-y-4">
              {(
                [
                  {
                    key: "primary",
                    label: "Color principal",
                    desc: "Color base de la portada, glows y fondo ambiental.",
                  },
                  {
                    key: "secondary",
                    label: "Color secundario",
                    desc: "Color complementario del gradiente y luces ambientales.",
                  },
                  {
                    key: "accent",
                    label: "Color de resaltado",
                    desc: "Botones, estados, acciones principales, links, íconos e indicadores.",
                  },
                  {
                    key: "buttonText",
                    label: "Texto de botones",
                    desc: "Color de la letra dentro de los botones principales.",
                  },
                ] as const
              ).map(({ key, label, desc }) => (
                <div key={key} className="flex items-center gap-4">
                  <label
                    className="relative h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-white/15"
                    style={{ background: colors[key] }}
                  >
                    <input
                      type="color"
                      value={normalizeHex(colors[key], LANDING_DEFAULTS[key])}
                      onChange={(e) =>
                        setColors((c) => ({ ...c, [key]: e.target.value }))
                      }
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </label>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-white/50">{desc}</div>
                  </div>
                  <input
                    type="text"
                    value={colors[key]}
                    onChange={(e) =>
                      setColors((c) => ({ ...c, [key]: e.target.value }))
                    }
                    spellCheck={false}
                    className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-mono uppercase outline-none focus:border-white/25"
                    placeholder="#000000"
                  />
                </div>
              ))}
            </div>
            <div className="mt-6 border-t border-white/10 pt-5">
              <h3 className="text-sm font-semibold">
                Modo de la página pública
              </h3>
              <p className="mt-1 text-xs text-white/50">
                Elegí si el perfil público y la reserva online se ven en modo
                oscuro o claro.
              </p>
              <div className="mt-3 grid max-w-sm grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/5 p-1">
                {(["dark", "light"] as LandingTheme[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTheme(mode)}
                    className={cn(
                      "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
                      theme === mode
                        ? "bg-white text-slate-950 shadow-sm"
                        : "bg-transparent text-white/65 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    {mode === "dark" ? (
                    <>
                      <Moon className="h-3.5 w-3.5" />
                      Modo oscuro
                    </>
                  ) : (
                    <>
                      <Sun className="h-3.5 w-3.5" />
                      Modo claro
                    </>
                  )}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-6">
              <p className="text-sm font-medium text-white/70">Vista previa</p>
              <div
                className="mt-3 overflow-hidden rounded-2xl border p-6"
                style={{
                  borderColor:
                    theme === "light"
                      ? "rgba(15,23,42,0.10)"
                      : "rgba(255,255,255,0.10)",
                  color: theme === "light" ? "#0f172a" : "#fff",
                  background: `linear-gradient(90deg, color-mix(in oklch, ${colors.primary} 42%, transparent), color-mix(in oklch, ${colors.secondary} 42%, transparent)), ${theme === "light" ? "#f8fafc" : "#080512"}`,
                }}
              >
                <div
                  className="relative rounded-3xl border p-4 shadow-xl"
                  style={{
                    borderColor:
                      theme === "light"
                        ? "rgba(15,23,42,0.10)"
                        : "rgba(255,255,255,0.10)",
                    background:
                      theme === "light"
                        ? "rgba(255,255,255,0.88)"
                        : "rgba(255,255,255,0.04)",
                  }}
                >
                  <h3 className="text-base font-semibold">Reservá tu turno</h3>
                  <button
                    type="button"
                    className="mt-3 inline-flex w-full items-center justify-center rounded-2xl px-5 py-3 text-sm font-bold"
                    style={{
                      background: colors.accent,
                      color: colors.buttonText,
                      boxShadow: `0 12px 32px -10px color-mix(in oklch, ${colors.accent} 70%, transparent)`,
                    }}
                  >
                    Reservar turno
                  </button>
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: colors.accent }}
                    />
                    <span style={{ color: colors.accent, fontWeight: 600 }}>
                      Abierto ahora
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>
        </>
      )}
    </>
  );
}

// ─────────── shared bits ───────────
function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-6 w-11 rounded-full transition-colors ring-1",
        on
          ? "bg-gradient-to-r from-sky-400 to-violet-500 ring-violet-400/45"
          : "bg-white/5 ring-white/10",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          on ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function SectionCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass rounded-2xl p-4 ring-1 ring-white/5">
      {label ? (
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-4">
          {label}
        </div>
      ) : null}
      {children}
    </div>
  );
}

// ─────────── ConfirmDialog ───────────
function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Eliminar",
  danger = true,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  danger?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass rounded-2xl p-6 max-w-sm w-full mx-4 ring-1 ring-white/10 space-y-4">
        <div>
          <div className="font-display font-semibold text-base text-foreground">
            {title}
          </div>
          <div className="text-sm text-muted-foreground mt-1">{message}</div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-semibold transition",
              danger
                ? "bg-red-500/20 hover:bg-red-500/30 ring-1 ring-red-500/40 text-red-300"
                : "bg-gradient-to-r from-sky-400 to-violet-500 text-white",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────── Horarios ───────────
const DAYS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

type ReservationSettings = {
  interval: string;
  maxAdvance: string;
  minCancel: string;
};

const DEFAULT_RESERVATION_SETTINGS: ReservationSettings = {
  interval: "30",
  maxAdvance: "30",
  minCancel: "2",
};

function HorariosSection() {
  const { businessId } = useAuth();
  const [days, setDays] = useState(
    DAYS.map((d, i) => ({
      name: d,
      open: "11:00",
      close: "20:00",
      enabled: i < 6,
    })),
  );
  const [reservationSettings, setReservationSettings] =
    useState<ReservationSettings>(DEFAULT_RESERVATION_SETTINGS);
  const [saving, setSaving] = useState(false);
  const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

  const timeToMinutes = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 60 + minutes;
  };

  const normalizeCloseTime = (open: string, close: string) => {
    const openMin = timeToMinutes(open);
    const closeMin = timeToMinutes(close);
    if (openMin == null || closeMin == null || closeMin <= openMin)
      return "20:00";
    return close;
  };

  useEffect(() => {
    if (!businessId) return;
    supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        const schedule = data?.schedule as
          Record<string, any> | null | undefined;
        if (!schedule || typeof schedule !== "object") return;
        setDays((current) =>
          current.map((day, i) => {
            const saved = schedule[dayKeys[i]];
            if (!saved || typeof saved !== "object") return day;
            const open =
              typeof saved.start === "string" ? saved.start : day.open;
            const close = typeof saved.end === "string" ? saved.end : day.close;
            return {
              ...day,
              open,
              close: normalizeCloseTime(open, close),
              enabled: saved.enabled !== false,
            };
          }),
        );
        const settings = schedule._settings;
        if (settings && typeof settings === "object") {
          setReservationSettings({
            interval: String(
              settings.interval ?? DEFAULT_RESERVATION_SETTINGS.interval,
            ),
            maxAdvance: String(
              settings.maxAdvance ?? DEFAULT_RESERVATION_SETTINGS.maxAdvance,
            ),
            minCancel: String(
              settings.minCancel ?? DEFAULT_RESERVATION_SETTINGS.minCancel,
            ),
          });
        }
      });
  }, [businessId]);

  async function saveSchedule(showToast = true) {
    if (!businessId) return toast.error("No se encontró el negocio");

    const invalidDay = days.find((day) => {
      if (!day.enabled) return false;
      const openMin = timeToMinutes(day.open);
      const closeMin = timeToMinutes(day.close);
      return openMin == null || closeMin == null || closeMin <= openMin;
    });

    if (invalidDay) {
      toast.error(
        "El horario de cierre debe ser posterior al horario de apertura.",
      );
      return;
    }

    setSaving(true);

    // IMPORTANTE: leer el schedule existente y MERGEAR. Antes se reconstruía
    // desde cero y el upsert pisaba el resto de sub-configs (_employeeSchedules,
    // _branding, _caja, especiales, etc.).
    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    const existing = (existingRow?.schedule ?? {}) as Record<string, any>;

    const schedule: Record<string, any> = { ...existing };
    days.forEach((day, i) => {
      schedule[dayKeys[i]] = {
        enabled: day.enabled,
        start: day.open,
        end: day.close,
        breakStart: "12:00",
        breakEnd: "13:00",
      };
    });

    schedule._settings = {
      interval: Number(reservationSettings.interval) || 30,
      maxAdvance: Number(reservationSettings.maxAdvance) || 30,
      minCancel: Number(reservationSettings.minCancel) || 2,
    };
    const { error } = await supabase
      .from("business_settings")
      .upsert(
        { business_id: businessId, schedule },
        { onConflict: "business_id" },
      );

    setSaving(false);
    if (error) return toast.error("Error guardando horarios: " + error.message);
    if (showToast) toast.success("Guardado");
  }

  const saveScheduleRef = useRef(saveSchedule);
  useEffect(() => {
    saveScheduleRef.current = saveSchedule;
  }, [businessId, days, reservationSettings]);

  const horariosHydratedRef = useRef(false);

  useEffect(() => {
    if (!businessId) return;

    if (!horariosHydratedRef.current) {
      horariosHydratedRef.current = true;
      return;
    }

    const timer = window.setTimeout(() => {
      void saveSchedule(false);
    }, 550);

    return () => window.clearTimeout(timer);
  }, [businessId, days, reservationSettings]);

  useEffect(() => {
    const handler = (event: Event) => {
      const section = (event as CustomEvent).detail?.section;
      if (!section || section === "horarios") void saveScheduleRef.current(false);
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, []);

  const reservationRows = [
    {
      key: "interval" as const,
      icon: Timer,
      title: "Intervalo de turnos",
      hint: "Cada cuántos minutos se pueden crear turnos",
      suffix: "min",
    },
    {
      key: "maxAdvance" as const,
      icon: CalendarDays,
      title: "Anticipación máxima",
      hint: "Con cuántos días de anticipación se puede reservar",
      suffix: "días",
    },
    {
      key: "minCancel" as const,
      icon: AlarmClock,
      title: "Cancelación mínima",
      hint: "Con cuántas horas de anticipación se puede cancelar",
      suffix: "horas",
    },
  ];

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-display font-semibold">
            Horarios de atención
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Días y horarios de atención.
          </p>
        </div>
      </div>

      <div className="glass rounded-2xl p-4 ring-1 ring-white/5">
        <div className="grid grid-cols-[120px_1fr_1fr_auto_auto] gap-3 px-1 pb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
          <div>Día</div>
          <div>Apertura</div>
          <div>Cierre</div>
          <div>Abierto</div>
          <div></div>
        </div>
        <div className="divide-y divide-white/5">
          {days.map((d, i) => (
            <div
              key={d.name}
              className={cn(
                "grid grid-cols-[120px_1fr_1fr_auto_auto] gap-3 items-center py-3",
                !d.enabled && "opacity-50",
              )}
            >
              <div className="text-sm font-medium">{d.name}</div>
              <input
                type="time"
                value={d.open}
                disabled={!d.enabled}
                onChange={(e) => {
                  const value = e.target.value;
                  // En Clippr el horario de atención se usa como regla general
                  // de la agenda. Al cambiar la apertura, aplicamos el mismo
                  // valor a todos los días para que no quede modificado solo el
                  // día que se editó.
                  setDays((s) => s.map((x) => ({ ...x, open: value })));
                }}
                className="rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40 disabled:cursor-not-allowed"
              />
              <input
                type="time"
                value={d.close}
                disabled={!d.enabled}
                onChange={(e) => {
                  const value = e.target.value;
                  // Igual que apertura: el cierre se aplica a todos los días.
                  setDays((s) => s.map((x) => ({ ...x, close: value })));
                }}
                className="rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40 disabled:cursor-not-allowed"
              />
              <Toggle
                on={d.enabled}
                onChange={(v) =>
                  setDays((s) =>
                    s.map((x, idx) =>
                      idx === i
                        ? {
                            ...x,
                            enabled: v,
                            close: v
                              ? normalizeCloseTime(x.open, x.close)
                              : x.close,
                          }
                        : x,
                    ),
                  )
                }
              />
              <button
                disabled={!d.enabled}
                onClick={() => {
                  const source = days[i];
                  setDays((state) =>
                    state.map((row, idx) =>
                      idx > i
                        ? {
                            ...row,
                            open: source.open,
                            close: source.close,
                            enabled: source.enabled,
                          }
                        : row,
                    ),
                  );
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 ring-1 ring-white/10 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/10 disabled:opacity-40"
              >
                <Copy className="h-3 w-3" /> Copiar
              </button>
            </div>
          ))}
        </div>
      </div>


      <SectionCard label="Turnos y reservas">
        <div className="divide-y divide-white/5">
          {reservationRows.map((r) => {
            const Icon = r.icon;
            return (
              <div
                key={r.key}
                className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center">
                  <Icon className="h-4.5 w-4.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{r.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {r.hint}
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2">
                  <input
                    type="number"
                    min={1}
                    value={reservationSettings[r.key]}
                    onChange={(e) =>
                      setReservationSettings((state) => ({
                        ...state,
                        [r.key]: e.target.value,
                      }))
                    }
                    className="w-16 bg-transparent text-sm focus:outline-none text-right"
                  />
                  <span className="text-xs text-muted-foreground">
                    {r.suffix}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}

// ─────────── Equipo ───────────
const PRO_TINTS = [
  "from-[oklch(0.78_0.17_55)] to-[oklch(0.72_0.2_40)]",
  "from-[oklch(0.72_0.2_245)] to-[oklch(0.65_0.22_270)]",
  "from-[oklch(0.7_0.25_300)] to-[oklch(0.6_0.22_290)]",
  "from-[oklch(0.82_0.16_200)] to-[oklch(0.7_0.2_220)]",
  "from-[oklch(0.78_0.17_140)] to-[oklch(0.7_0.2_160)]",
  "from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)]",
];

// Color estable por id (no por posición): así eliminar un profesional no cambia
// el color/avatar de los demás.
function tintForId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PRO_TINTS[h % PRO_TINTS.length];
}

const AGENDA_COLORS = [
  "oklch(0.65 0.18 240)",
  "oklch(0.65 0.22 300)",
  "oklch(0.75 0.14 75)",
  "oklch(0.72 0.18 150)",
  "oklch(0.68 0.22 25)",
  "oklch(0.8 0.17 90)",
];

const WEEKDAYS = [
  ["mon", "Lunes"],
  ["tue", "Martes"],
  ["wed", "Miércoles"],
  ["thu", "Jueves"],
  ["fri", "Viernes"],
  ["sat", "Sábado"],
  ["sun", "Domingo"],
] as const;

type DayKey = (typeof WEEKDAYS)[number][0];
type DaySchedule = {
  enabled: boolean;
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
};
type ScheduleMap = Record<DayKey, DaySchedule>;

const DEFAULT_SCHEDULE: ScheduleMap = {
  mon: {
    enabled: true,
    start: "11:00",
    end: "20:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  },
  tue: {
    enabled: true,
    start: "11:00",
    end: "20:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  },
  wed: {
    enabled: true,
    start: "11:00",
    end: "20:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  },
  thu: {
    enabled: true,
    start: "11:00",
    end: "20:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  },
  fri: {
    enabled: true,
    start: "11:00",
    end: "20:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  },
  sat: {
    enabled: true,
    start: "11:00",
    end: "20:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  },
  sun: {
    enabled: false,
    start: "11:00",
    end: "20:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  },
};

type EmployeeRow = {
  id: string;
  name?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  is_active?: boolean | null;
  commission_pct?: number | null;
  role?: string | null;
};

type PendingProfessional = {
  tempId: string;
  payload: {
    id?: string;
    full_name: string;
    is_active: boolean;
    commission_pct: number | null;
    avatar_url?: string | null;
    role?: string | null;
    acceptsOnline?: boolean;
    commissions?: Record<string, CommissionConfig>;
    schedule?: ScheduleMap;
    specialDates?: SpecialDateMap;
  };
  isNew: boolean;
};

type CommissionMode = "percent" | "fixed";

type CommissionConfig = {
  enabled: boolean;
  mode: CommissionMode;
  value: string;
};

type NewProForm = {
  fullName: string;
  email: string;
  phone: string;
  role: string;
  acceptsOnline: boolean;
  color: string;
  schedule: ScheduleMap;
  publicName: string;
  description: string;
  specialty: string;
  commissionPct: string;
  avatarUrl: string;
  commissions: Record<string, CommissionConfig>;
  specialDates: SpecialDateMap;
};

const EMPTY_FORM: NewProForm = {
  fullName: "",
  email: "",
  phone: "",
  role: "Barbero",
  acceptsOnline: true,
  color: AGENDA_COLORS[0],
  schedule: DEFAULT_SCHEDULE,
  publicName: "",
  description: "",
  specialty: "",
  commissionPct: "",
  avatarUrl: "",
  commissions: {},
  specialDates: {},
};

const inputCls =
  "w-full rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-primary/40";
const timeCls =
  "rounded-md bg-white/5 ring-1 ring-white/10 px-2 py-1 text-xs focus:outline-none w-[72px]";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-1.5">
        {label}
      </div>
      {children}
      {hint && (
        <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>
      )}
    </div>
  );
}

type RolePermissionId =
  "admin_general" | "socio" | "admin_local" | "recepcionista" | "profesional";

type PermissionKey =
  | "dashboard"
  | "agenda"
  | "caja_cobro"
  | "panel_profesionales"
  | "clientes"
  | "configuracion"
  | "branding"
  | "horarios"
  | "equipo"
  | "servicios"
  | "catalogo"
  | "caja"
  | "senas"
  | "asesor_ia"
  | "plan_facturacion";

type PermissionMap = Record<PermissionKey, boolean>;
type RolePermissions = Record<RolePermissionId, PermissionMap>;

type AccessStatus = "invited" | "active" | "suspended";

type AccessUser = {
  id: string;
  auth_user_id?: string | null;
  name: string;
  email: string;
  role: RolePermissionId;
  status: AccessStatus;
  employee_id?: string | null;
  branch_id?: string | null;
  created_at?: string | null;
};

type AccessFormState = {
  name: string;
  email: string;
  role: RolePermissionId;
  status: "active" | "inactive";
  employee_id: string | null;
  branch_id: string | null;
};

const ROLE_LABEL_BY_ID: Record<RolePermissionId, string> = {
  admin_general: "Admin. General",
  socio: "Socio",
  admin_local: "Administrador Local",
  recepcionista: "Recepcionista",
  profesional: "Profesional",
};

const EMPTY_ACCESS_FORM: AccessFormState = {
  name: "",
  email: "",
  role: "profesional",
  status: "active",
  employee_id: null,
  branch_id: null,
};

const MAIN_PERMISSION_ITEMS: {
  key: PermissionKey;
  label: string;
  desc: string;
}[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    desc: "Métricas generales del negocio.",
  },
  { key: "agenda", label: "Agenda", desc: "Turnos, calendario y reservas." },
  { key: "caja_cobro", label: "Caja", desc: "Cobros y medios de pago." },
  {
    key: "panel_profesionales",
    label: "Profesionales",
    desc: "Panel y actividad de profesionales.",
  },
  { key: "clientes", label: "Clientes", desc: "Base de clientes e historial." },
  {
    key: "configuracion",
    label: "Configuración",
    desc: "Acceso a ajustes del negocio.",
  },
  {
    key: "asesor_ia",
    label: "Asesor IA",
    desc: "Análisis, recomendaciones, simuladores y métricas con IA.",
  },
];

const CONFIG_PERMISSION_ITEMS: {
  key: PermissionKey;
  label: string;
  desc: string;
}[] = [
  {
    key: "branding",
    label: "Página de reservas",
    desc: "Identidad visual y datos del negocio.",
  },
  {
    key: "horarios",
    label: "Horarios",
    desc: "Disponibilidad y reglas de agenda.",
  },
  {
    key: "equipo",
    label: "Equipo",
    desc: "Profesionales, usuarios y permisos.",
  },
  {
    key: "servicios",
    label: "Servicios",
    desc: "Servicios, precios y categorías.",
  },
  {
    key: "catalogo",
    label: "Catálogo",
    desc: "Productos, stock y categorías.",
  },
  { key: "caja", label: "Caja", desc: "Métodos de pago y reglas de cobro." },
  { key: "senas", label: "Señas", desc: "Reglas de señas para reservas." },
];

const ALL_PERMISSION_KEYS: PermissionKey[] = [
  ...MAIN_PERMISSION_ITEMS.map((item) => item.key),
  ...CONFIG_PERMISSION_ITEMS.map((item) => item.key),
];

// Subsecciones internas que dependen del único permiso "Configuración".
const CONFIG_SUB_KEYS: PermissionKey[] = [
  "branding",
  "horarios",
  "equipo",
  "servicios",
  "catalogo",
  "caja",
  "senas",
];

const allOnPermissions = (): PermissionMap =>
  ALL_PERMISSION_KEYS.reduce(
    (acc, key) => ({ ...acc, [key]: true }),
    {} as PermissionMap,
  );

const buildPermissions = (enabled: PermissionKey[]): PermissionMap =>
  ALL_PERMISSION_KEYS.reduce(
    (acc, key) => ({ ...acc, [key]: enabled.includes(key) }),
    {} as PermissionMap,
  );

const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  admin_general: allOnPermissions(),
  socio: buildPermissions([
    "dashboard",
    "agenda",
    "caja_cobro",
    "panel_profesionales",
    "clientes",
    "configuracion",
    "asesor_ia",
    "branding",
    "horarios",
    "equipo",
    "servicios",
    "catalogo",
    "caja",
    "senas",
  ]),
  admin_local: buildPermissions([
    "dashboard",
    "agenda",
    "caja_cobro",
    "clientes",
  ]),
  recepcionista: buildPermissions(["agenda", "caja_cobro", "clientes"]),
  profesional: buildPermissions(["panel_profesionales"]),
};

const ROLE_PERMISSION_OPTIONS: {
  id: RolePermissionId;
  label: string;
  icon: string;
  desc: string;
  locked?: boolean;
}[] = [
  {
    id: "admin_general",
    label: "Admin. General",
    icon: "👑",
    desc: "Administrador principal del negocio.",
    locked: true,
  },
  {
    id: "socio",
    label: "Socio",
    icon: "🤝",
    desc: "Acceso completo por defecto, editable.",
  },
  {
    id: "admin_local",
    label: "Administrador Local",
    icon: "🏢",
    desc: "Gestión operativa de la sucursal.",
  },
  {
    id: "recepcionista",
    label: "Recepcionista",
    icon: "💼",
    desc: "Agenda, caja y clientes.",
  },
  {
    id: "profesional",
    label: "Profesional",
    icon: "✂️",
    desc: "Accesos para el trabajo diario.",
  },
];

const ROLE_ACCESS_SUMMARY: Record<
  RolePermissionId,
  { title: string; desc: string; can: string[]; cannot: string[] }
> = {
  admin_general: {
    title: "Administrador principal",
    desc: "Control completo del negocio en Clippr.",
    can: ["Todo el negocio", "Configuración", "Caja", "Asesor IA"],
    cannot: [],
  },
  socio: {
    title: "Gestión completa",
    desc: "Ideal para socios o encargados con visión completa del negocio.",
    can: ["Dashboard", "Agenda", "Caja", "Profesionales", "Clientes", "Asesor IA", "Configuración"],
    cannot: [],
  },
  admin_local: {
    title: "Gestión operativa",
    desc: "Para administrar la operación diaria sin tocar datos sensibles del negocio.",
    can: ["Dashboard", "Agenda", "Caja", "Clientes"],
    cannot: ["Profesionales", "Configuración", "Asesor IA"],
  },
  recepcionista: {
    title: "Recepción y caja",
    desc: "Para gestionar turnos, clientes y cobros del día.",
    can: ["Agenda", "Caja", "Clientes"],
    cannot: ["Dashboard", "Profesionales", "Configuración", "Asesor IA"],
  },
  profesional: {
    title: "Panel profesional",
    desc: "Para que cada profesional vea su actividad y registre su trabajo.",
    can: ["Profesionales"],
    cannot: ["Dashboard", "Agenda", "Caja", "Clientes", "Configuración", "Asesor IA"],
  },
};

function normalizeRolePermissions(value: unknown): RolePermissions {
  const saved = (
    value && typeof value === "object" ? value : {}
  ) as Partial<RolePermissions>;
  return ROLE_PERMISSION_OPTIONS.reduce((acc, role) => {
    const base = DEFAULT_ROLE_PERMISSIONS[role.id];
    const incoming = (saved[role.id] ?? {}) as Partial<PermissionMap>;
    acc[role.id] =
      role.id === "admin_general"
        ? allOnPermissions()
        : ALL_PERMISSION_KEYS.reduce(
            (roleAcc, key) => ({
              ...roleAcc,
              [key]:
                typeof incoming[key] === "boolean"
                  ? Boolean(incoming[key])
                  : base[key],
            }),
            {} as PermissionMap,
          );
    return acc;
  }, {} as RolePermissions);
}

function normalizePermissionMap(value: unknown): PermissionMap {
  const src = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return ALL_PERMISSION_KEYS.reduce(
    (acc, key) => ({ ...acc, [key]: src[key] === true }),
    {} as PermissionMap,
  );
}

function normalizePublicBooleanMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key.trim().length > 0)
      .map(([key, next]) => [key, next !== false]),
  );
}

function getPublicVisibility(schedule: Record<string, unknown>) {
  return (schedule._publicVisibility ?? {}) as Record<string, unknown>;
}

// Tarjeta de profesional memoizada: solo se re-renderiza si cambian sus props
// (este profesional o sus callbacks), no cuando cambia cualquier otro estado de
// Configuración. Reduce drásticamente los re-renders con muchos profesionales.
const ProfessionalCard = React.memo(function ProfessionalCard({
  emp,
  tintClass,
  deleting,
  onEdit,
  onToggle,
  onRemove,
}: {
  emp: EmployeeRow;
  tintClass: string;
  deleting?: boolean;
  onEdit: (emp: EmployeeRow) => void;
  onToggle: (emp: EmployeeRow) => void;
  onRemove: (emp: EmployeeRow) => void;
}) {
  const displayName = emp.full_name || emp.name || "—";
  const active = emp.is_active !== false;
  return (
    <div
      className={cn(
        "glass rounded-2xl p-4 ring-1 ring-white/5 transition-opacity",
        (!active || deleting) && "opacity-70",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "h-10 w-10 rounded-full overflow-hidden grid place-items-center text-sm font-semibold text-white bg-gradient-to-br ring-1 ring-white/10",
            tintClass,
          )}
        >
          {emp.avatar_url ? (
            <img
              src={emp.avatar_url}
              alt={displayName}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            displayName[0]?.toUpperCase()
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm ">{displayName}</div>
          <div className="text-xs text-muted-foreground">{emp.role?.trim() || "Profesional"}</div>
        </div>
        <button
          type="button"
          onClick={() => onToggle(emp)}
          disabled={deleting}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full ring-1 px-2 py-0.5 text-[10px] uppercase tracking-wider transition hover:brightness-110 disabled:opacity-50",
            active
              ? "bg-[oklch(0.78_0.17_140/0.12)] ring-[oklch(0.78_0.17_140/0.3)] text-[oklch(0.85_0.17_140)]"
              : "bg-white/5 ring-white/10 text-muted-foreground",
          )}
          title={active ? "Desactivar profesional" : "Activar profesional"}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              active ? "bg-[oklch(0.78_0.17_140)]" : "bg-muted-foreground",
            )}
          />
          {active ? "Activo" : "Inactivo"}
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => onEdit(emp)}
          disabled={deleting}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-3 py-1.5 text-xs disabled:opacity-50"
        >
          Editar
        </button>
      </div>
    </div>
  );
});

function EquipoSection() {
  const { businessId } = useAuth();
  const [tab, setTab] = useState<"pros" | "users">("pros");
  const [selectedPermRole, setSelectedPermRole] =
    useState<RolePermissionId>("admin_general");
  const [rolePermissions, setRolePermissions] = useState<RolePermissions>(
    DEFAULT_ROLE_PERMISSIONS,
  );
  const [individualPermMode, setIndividualPermMode] = useState(true);
  const [selectedAccessUserId, setSelectedAccessUserId] = useState<string>("");
  const [accessUsers, setAccessUsers] = useState<AccessUser[]>([]);
  const [accessForm, setAccessForm] = useState(EMPTY_ACCESS_FORM);
  const [editingAccessUserId, setEditingAccessUserId] = useState<string | null>(
    null,
  );
  const [pendingDeleteUser, setPendingDeleteUser] = useState<AccessUser | null>(
    null,
  );
  const [deletingAccess, setDeletingAccess] = useState(false);
  const [accessTouched, setAccessTouched] = useState(false);
  const [accessPermissionsForm, setAccessPermissionsForm] =
    useState<PermissionMap>(DEFAULT_ROLE_PERMISSIONS.profesional);
  const [userPermissions, setUserPermissions] = useState<
    Record<string, PermissionMap>
  >({});
  const [approvalEnabled, setApprovalEnabled] = useState(false);
  const [approvalMode, setApprovalMode] = useState<"auto" | "manual">("auto");
  const [showAutoApprovalExample, setShowAutoApprovalExample] = useState(false);
  const [showManualApprovalExample, setShowManualApprovalExample] = useState(false);
  const [showAutoApprovalPurpose, setShowAutoApprovalPurpose] = useState(false);
  const [showManualApprovalPurpose, setShowManualApprovalPurpose] = useState(false);
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [employeeOnlineMap, setEmployeeOnlineMap] = useState<
    Record<string, boolean>
  >({});
  // Horario individual por profesional cargado desde
  // business_settings.schedule._employeeSchedules. Pre-carga el form al editar
  // y evita perderlo al re-guardar.
  const [employeeSchedules, setEmployeeSchedules] = useState<
    Record<string, ScheduleMap>
  >({});
  const [employeeSpecialDates, setEmployeeSpecialDates] =
    useState<EmployeeSpecialDateMap>({});
  const [pendingProfessionals, setPendingProfessionals] = useState<
    PendingProfessional[]
  >([]);
  const [commissionItems, setCommissionItems] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<EmployeeRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingEmp, setEditingEmp] = useState<EmployeeRow | null>(null);
  const [form, setForm] = useState<NewProForm>(EMPTY_FORM);
  const [dlgTab, setDlgTab] = useState<"perfil" | "horarios" | "comisiones">(
    "perfil",
  );

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data, error }, catalogResult, settingsResult] = await Promise.all([
      supabase
        .from("employees")
        .select("id,full_name,avatar_url,is_active,commission_pct")
        .eq("business_id", businessId)
        .order("full_name", { ascending: true }),
      supabase
        .from("price_catalog")
        .select(
          "id,name,price,duration_min,category,active,stock,cash_discount",
        )
        .eq("business_id", businessId)
        .order("category")
        .order("name"),
      supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);
    if (error) toast.error("Error cargando profesionales: " + error.message);
    if (catalogResult.error)
      toast.error(
        "Error cargando servicios y catálogo: " + catalogResult.error.message,
      );
    const schedule = (settingsResult.data?.schedule ?? {}) as Record<
      string,
      unknown
    >;
    const employeeRoles = (
      schedule._employeeRoles && typeof schedule._employeeRoles === "object"
        ? schedule._employeeRoles
        : {}
    ) as Record<string, string>;
    setRows(
      ((data ?? []) as EmployeeRow[]).map((emp) => ({
        ...emp,
        role: employeeRoles[emp.id] ?? emp.role ?? null,
      })),
    );
    setCommissionItems((catalogResult.data ?? []) as PriceRow[]);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const loadTeamMembers = useCallback(async () => {
    if (!businessId) return;
    const { data, error } = await supabase
      .from("team_members")
      .select(
        "id, auth_user_id, full_name, email, role, status, professional_id, branch_id, permissions, created_at",
      )
      .eq("business_id", businessId)
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Error cargando accesos: " + error.message);
      return;
    }
    // Excluimos los tombstones de accesos eliminados (status deleted/removed):
    // la fila se conserva en la base para bloquear el re-acceso, pero NO debe
    // mostrarse en la lista de accesos.
    const rows = ((data ?? []) as Array<Record<string, unknown>>).filter(
      (r) =>
        !["deleted", "removed"].includes(String(r.status ?? "").toLowerCase()),
    );
    const users: AccessUser[] = rows.map((r) => {
      const rawStatus = String(r.status ?? "invited");
      const status: AccessStatus =
        rawStatus === "active"
          ? "active"
          : rawStatus === "suspended"
            ? "suspended"
            : "invited";
      const role: RolePermissionId = ROLE_PERMISSION_OPTIONS.some(
        (o) => o.id === r.role,
      )
        ? (r.role as RolePermissionId)
        : "profesional";
      return {
        id: String(r.id),
        auth_user_id: (r.auth_user_id as string | null) ?? null,
        name: String(r.full_name ?? "").trim(),
        email: String(r.email ?? "").trim(),
        role,
        status,
        employee_id: (r.professional_id as string | null) ?? null,
        branch_id: (r.branch_id as string | null) ?? null,
        created_at: (r.created_at as string | null) ?? null,
      };
    });
    const perms: Record<string, PermissionMap> = {};
    rows.forEach((r) => {
      perms[String(r.id)] = normalizePermissionMap(r.permissions);
    });
    setAccessUsers(users);
    setUserPermissions(perms);
    setSelectedAccessUserId((current) => current || users[0]?.id || "");
  }, [businessId]);

  useEffect(() => {
    loadTeamMembers();
  }, [loadTeamMembers]);

  useEffect(() => {
    if (!businessId) return;
    supabase
      .from("business_settings")
      .select("schedule,approval_mode")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
        const caja = (schedule._caja ?? {}) as Record<string, unknown>;
        setRolePermissions(normalizeRolePermissions(schedule._rolePermissions));
        const visibility = getPublicVisibility(schedule);
        setEmployeeOnlineMap(
          normalizePublicBooleanMap(
            visibility.employees ?? schedule._employeeOnline,
          ),
        );
        const loadedEmployeeSchedules = (
          schedule._employeeSchedules &&
          typeof schedule._employeeSchedules === "object"
            ? schedule._employeeSchedules
            : {}
        ) as Record<string, ScheduleMap>;
        setEmployeeSchedules(loadedEmployeeSchedules);
        const loadedEmployeeSpecial = (
          schedule._employeeSpecialDates &&
          typeof schedule._employeeSpecialDates === "object"
            ? schedule._employeeSpecialDates
            : {}
        ) as EmployeeSpecialDateMap;
        setEmployeeSpecialDates(loadedEmployeeSpecial);
        const employeeRoles = (
          schedule._employeeRoles && typeof schedule._employeeRoles === "object"
            ? schedule._employeeRoles
            : {}
        ) as Record<string, string>;
        setRows((current) =>
          current.map((emp) => ({
            ...emp,
            role: employeeRoles[emp.id] ?? emp.role ?? null,
          })),
        );
        setApprovalEnabled(caja.approvalModeEnabled === true);
        setApprovalMode(data?.approval_mode === "manual" ? "manual" : "auto");
      });
  }, [businessId]);

  async function saveRolePermissions() {
    if (!businessId) return;

    for (const item of pendingProfessionals) {
      const payload = item.payload;
      if (item.isNew) {
        const { data: inserted, error } = await supabase
          .from("employees")
          .insert({
            business_id: businessId,
            full_name: payload.full_name,
            is_active: payload.is_active,
            commission_pct: payload.commission_pct,
            avatar_url: payload.avatar_url ?? null,
          })
          .select("id")
          .single();

        if (error || !inserted) {
          return toast.error(
            "Error guardando profesional: " +
              (error?.message ?? "no se pudo crear"),
          );
        }

        {
          const { data: existingRow } = await supabase
            .from("business_settings")
            .select("schedule")
            .eq("business_id", businessId)
            .maybeSingle();
          const existingSchedule = (existingRow?.schedule ?? {}) as Record<
            string,
            unknown
          >;
          const existingCommissions = (existingSchedule._employeeCommissions ??
            {}) as Record<string, unknown>;
          const existingRoles = (existingSchedule._employeeRoles ??
            {}) as Record<string, string>;
          const visibility = getPublicVisibility(existingSchedule);
          const employeesVisibility = normalizePublicBooleanMap(
            visibility.employees ?? existingSchedule._employeeOnline,
          );

          await supabase.from("business_settings").upsert(
            {
              business_id: businessId,
              schedule: {
                ...existingSchedule,
                _employeeCommissions: payload.commissions
                  ? {
                      ...existingCommissions,
                      [inserted.id]: payload.commissions,
                    }
                  : existingCommissions,
                _employeeRoles: {
                  ...existingRoles,
                  [inserted.id]: payload.role ?? "Profesional",
                },
                _employeeSchedules: payload.schedule
                  ? {
                      ...((existingSchedule._employeeSchedules ?? {}) as Record<
                        string,
                        unknown
                      >),
                      [inserted.id]: payload.schedule,
                    }
                  : (existingSchedule._employeeSchedules ?? {}),
                _publicVisibility: {
                  ...visibility,
                  employees: {
                    ...employeesVisibility,
                    [inserted.id]: payload.acceptsOnline !== false,
                  },
                },
              },
            },
            { onConflict: "business_id" },
          );
        }
      } else if (payload.id) {
        const { error } = await supabase
          .from("employees")
          .update({
            full_name: payload.full_name,
            is_active: payload.is_active,
            commission_pct: payload.commission_pct,
            avatar_url: payload.avatar_url ?? null,
          })
          .eq("id", payload.id);

        if (error)
          return toast.error("Error guardando profesional: " + error.message);

        {
          const { data: existingRow } = await supabase
            .from("business_settings")
            .select("schedule")
            .eq("business_id", businessId)
            .maybeSingle();
          const existingSchedule = (existingRow?.schedule ?? {}) as Record<
            string,
            unknown
          >;
          const existingCommissions = (existingSchedule._employeeCommissions ??
            {}) as Record<string, unknown>;
          const existingRoles = (existingSchedule._employeeRoles ??
            {}) as Record<string, string>;
          const visibility = getPublicVisibility(existingSchedule);
          const employeesVisibility = normalizePublicBooleanMap(
            visibility.employees ?? existingSchedule._employeeOnline,
          );

          await supabase.from("business_settings").upsert(
            {
              business_id: businessId,
              schedule: {
                ...existingSchedule,
                _employeeCommissions: payload.commissions
                  ? {
                      ...existingCommissions,
                      [payload.id]: payload.commissions,
                    }
                  : existingCommissions,
                _employeeRoles: {
                  ...existingRoles,
                  [payload.id]: payload.role ?? "Profesional",
                },
                _employeeSchedules: payload.schedule
                  ? {
                      ...((existingSchedule._employeeSchedules ?? {}) as Record<
                        string,
                        unknown
                      >),
                      [payload.id]: payload.schedule,
                    }
                  : (existingSchedule._employeeSchedules ?? {}),
                _publicVisibility: {
                  ...visibility,
                  employees: {
                    ...employeesVisibility,
                    [payload.id]: payload.acceptsOnline !== false,
                  },
                },
              },
            },
            { onConflict: "business_id" },
          );
        }
      }
    }

    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();

    const existingSchedule = (existingRow?.schedule ?? {}) as Record<
      string,
      unknown
    >;
    const cleaned = normalizeRolePermissions(rolePermissions);

    const { error } = await supabase.from("business_settings").upsert(
      {
        business_id: businessId,
        approval_mode: approvalMode,
        schedule: {
          ...existingSchedule,
          _rolePermissions: cleaned,
          _caja: {
            ...((existingSchedule._caja ?? {}) as Record<string, unknown>),
            approvalModeEnabled: approvalEnabled,
          },
        },
      },
      { onConflict: "business_id" },
    );

    if (error)
      return toast.error(
        "Error guardando accesos y permisos: " + error.message,
      );
    window.dispatchEvent(new CustomEvent("clippr:caja-settings-updated"));
    setPendingProfessionals([]);
    await load();
    toast.success("Equipo guardado correctamente");
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent).detail?.section;
      if (!section || section === "equipo") {
        void saveRolePermissions();
      }
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, [
    businessId,
    rolePermissions,
    accessUsers,
    userPermissions,
    pendingProfessionals,
    load,
    approvalEnabled,
    approvalMode,
  ]);

  async function saveApprovalSettings(
    nextEnabled = approvalEnabled,
    nextMode = approvalMode,
  ) {
    if (!businessId) return toast.error("No se encontró el negocio");

    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();

    const existingSchedule = (existingRow?.schedule ?? {}) as Record<
      string,
      unknown
    >;

    const { error } = await supabase.from("business_settings").upsert(
      {
        business_id: businessId,
        approval_mode: nextMode,
        schedule: {
          ...existingSchedule,
          _caja: {
            ...((existingSchedule._caja ?? {}) as Record<string, unknown>),
            approvalModeEnabled: nextEnabled,
          },
        },
      },
      { onConflict: "business_id" },
    );

    if (error) return toast.error("Error guardando: " + error.message);
    window.dispatchEvent(new CustomEvent("clippr:caja-settings-updated"));
    toast.success("Guardado");
  }

  function updateApprovalEnabled(value: boolean) {
    setApprovalEnabled(value);
    void saveApprovalSettings(value, approvalMode);
  }

  function updateApprovalMode(value: "auto" | "manual") {
    setApprovalMode(value);
    void saveApprovalSettings(approvalEnabled, value);
  }

  async function compressProfessionalAvatar(file: File): Promise<Blob> {
    const imageUrl = URL.createObjectURL(file);

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("No se pudo leer la imagen"));
        img.src = imageUrl;
      });

      const size = 200;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No se pudo preparar la imagen");

      const sourceSize = Math.min(image.width, image.height);
      const sourceX = Math.max(0, (image.width - sourceSize) / 2);
      const sourceY = Math.max(0, (image.height - sourceSize) / 2);

      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(
        image,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        size,
        size,
      );

      const toBlob = (quality: number) =>
        new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) reject(new Error("No se pudo comprimir la imagen"));
              else resolve(blob);
            },
            "image/webp",
            quality,
          );
        });

      let quality = 0.75;
      let blob = await toBlob(quality);

      while (blob.size > 80 * 1024 && quality > 0.45) {
        quality -= 0.08;
        blob = await toBlob(quality);
      }

      if (blob.size > 80 * 1024) {
        toast.info(
          "La imagen quedó optimizada, pero puede superar levemente los 80 KB por el formato original.",
        );
      }

      return blob;
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }

  async function uploadProfessionalAvatar(file: File) {
    if (!businessId) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Subí una imagen JPG, PNG o WEBP");
      return;
    }

    const compressed = await compressProfessionalAvatar(file);
    const safeId = editingEmp?.id ?? `new-${crypto.randomUUID()}`;
    const path = `${businessId}/${safeId}-${Date.now()}.webp`;

    const { error } = await supabase.storage
      .from("professionals")
      .upload(path, compressed, {
        cacheControl: "3600",
        upsert: true,
        contentType: "image/webp",
      });

    if (error) {
      toast.error("Error subiendo la foto: " + error.message);
      return;
    }

    const { data } = supabase.storage.from("professionals").getPublicUrl(path);
    setForm((current) => ({ ...current, avatarUrl: data.publicUrl }));
    toast.success(
      "Foto comprimida y cargada. Tocá Aceptar y luego Guardar para confirmar.",
    );
  }

  function openNew() {
    setEditingEmp(null);
    setForm(EMPTY_FORM);
    setDlgTab("perfil");
    setOpen(true);
  }

  async function saveEmployeeCommissionConfig(employeeId: string) {
    if (!businessId) return;
    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    const existingSchedule = (existingRow?.schedule ?? {}) as Record<
      string,
      unknown
    >;
    const existingCommissions = (existingSchedule._employeeCommissions ??
      {}) as Record<string, unknown>;

    await supabase.from("business_settings").upsert(
      {
        business_id: businessId,
        schedule: {
          ...existingSchedule,
          _employeeCommissions: {
            ...existingCommissions,
            [employeeId]: form.commissions,
          },
        },
      },
      { onConflict: "business_id" },
    );
  }

  async function saveProfessional() {
    if (!businessId) return;
    const name = form.fullName.trim();
    if (!name) {
      setDlgTab("perfil");
      return toast.error("Ingresá el nombre completo");
    }

    const commission = form.commissionPct ? Number(form.commissionPct) : null;
    const payload = {
      id: editingEmp?.id,
      full_name: name,
      is_active: editingEmp ? editingEmp.is_active !== false : true,
      commission_pct: commission,
      avatar_url: form.avatarUrl || null,
      role: form.role.trim() || "Profesional",
      acceptsOnline: form.acceptsOnline,
      commissions: form.commissions,
      schedule: form.schedule,
      specialDates: form.specialDates,
    };

    if (editingEmp) {
      setRows((current) =>
        current.map((emp) =>
          emp.id === editingEmp.id
            ? {
                ...emp,
                full_name: name,
                commission_pct: commission,
                avatar_url: form.avatarUrl || null,
                role: form.role.trim() || "Profesional",
              }
            : emp,
        ),
      );

      setEmployeeOnlineMap((current) => ({
        ...current,
        [editingEmp.id]: form.acceptsOnline,
      }));

      // Persistencia INMEDIATA del horario individual del profesional, sin
      // depender del "Guardar" de la sección (igual que avatar/portada). Esto
      // garantiza que _employeeSchedules quede en Supabase apenas se acepta.
      try {
        const { data: existingRow } = await supabase
          .from("business_settings")
          .select("schedule")
          .eq("business_id", businessId)
          .maybeSingle();
        const existingSchedule = (existingRow?.schedule ?? {}) as Record<
          string,
          unknown
        >;
        const existingEmpScheds = (existingSchedule._employeeSchedules ??
          {}) as Record<string, unknown>;
        const { error: schedErr } = await supabase
          .from("business_settings")
          .upsert(
            {
              business_id: businessId,
              schedule: {
                ...existingSchedule,
                _employeeSchedules: {
                  ...existingEmpScheds,
                  [editingEmp.id]: form.schedule,
                },
                _employeeSpecialDates: {
                  ...((existingSchedule._employeeSpecialDates ?? {}) as Record<
                    string,
                    unknown
                  >),
                  [editingEmp.id]: form.specialDates,
                },
              },
            },
            { onConflict: "business_id" },
          );
        if (schedErr)
          toast.error(
            "No se pudo guardar el horario del profesional. Probá de nuevo.",
          );
        setEmployeeSchedules((current) => ({
          ...current,
          [editingEmp.id]: form.schedule,
        }));
        setEmployeeSpecialDates((current) => ({
          ...current,
          [editingEmp.id]: form.specialDates,
        }));
      } catch {
        toast.error(
          "No se pudo guardar el horario del profesional. Probá de nuevo.",
        );
      }

      setPendingProfessionals((current) => [
        ...current.filter((item) => item.payload.id !== editingEmp.id),
        { tempId: editingEmp.id, payload, isNew: false },
      ]);

      toast.success(
        "Horario guardado. Tocá Guardar para confirmar los demás cambios.",
      );
      setOpen(false);
      setEditingEmp(null);
      return;
    }

    // Alta INMEDIATA: inserta el empleado y persiste su configuración (horario,
    // rol, comisión, visibilidad) en el momento, sin depender del "Guardar" de
    // la sección. Mismo criterio que la edición.
    setSaving(true);
    try {
      const { data: inserted, error } = await supabase
        .from("employees")
        .insert({
          business_id: businessId,
          full_name: name,
          is_active: true,
          commission_pct: commission,
          avatar_url: form.avatarUrl || null,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        toast.error(
          "Error guardando profesional: " +
            (error?.message ?? "no se pudo crear"),
        );
        setSaving(false);
        return;
      }

      const newId = inserted.id as string;
      const { data: existingRow } = await supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle();
      const existingSchedule = (existingRow?.schedule ?? {}) as Record<
        string,
        unknown
      >;
      const existingCommissions = (existingSchedule._employeeCommissions ??
        {}) as Record<string, unknown>;
      const existingRoles = (existingSchedule._employeeRoles ?? {}) as Record<
        string,
        string
      >;
      const existingEmpScheds = (existingSchedule._employeeSchedules ??
        {}) as Record<string, unknown>;
      const visibility = getPublicVisibility(existingSchedule);
      const employeesVisibility = normalizePublicBooleanMap(
        visibility.employees ?? existingSchedule._employeeOnline,
      );

      const { error: settingsErr } = await supabase
        .from("business_settings")
        .upsert(
          {
            business_id: businessId,
            schedule: {
              ...existingSchedule,
              _employeeCommissions: form.commissions
                ? { ...existingCommissions, [newId]: form.commissions }
                : existingCommissions,
              _employeeRoles: {
                ...existingRoles,
                [newId]: form.role.trim() || "Profesional",
              },
              _employeeSchedules: {
                ...existingEmpScheds,
                [newId]: form.schedule,
              },
              _employeeSpecialDates: {
                ...((existingSchedule._employeeSpecialDates ?? {}) as Record<
                  string,
                  unknown
                >),
                [newId]: form.specialDates,
              },
              _publicVisibility: {
                ...visibility,
                employees: {
                  ...employeesVisibility,
                  [newId]: form.acceptsOnline !== false,
                },
              },
            },
          },
          { onConflict: "business_id" },
        );
      if (settingsErr) {
        toast.error(
          "Profesional creado, pero no se pudo guardar su configuración. Editalo para reintentar.",
        );
      }

      setRows((current) => [
        ...current,
        {
          id: newId,
          full_name: name,
          avatar_url: form.avatarUrl || null,
          role: form.role.trim() || "Profesional",
          is_active: true,
          commission_pct: commission,
        },
      ]);
      setEmployeeOnlineMap((current) => ({
        ...current,
        [newId]: form.acceptsOnline,
      }));
      setEmployeeSchedules((current) => ({
        ...current,
        [newId]: form.schedule,
      }));
      setEmployeeSpecialDates((current) => ({
        ...current,
        [newId]: form.specialDates,
      }));

      toast.success("Profesional agregado.");
      setOpen(false);
    } catch {
      toast.error("No se pudo guardar el profesional. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const toggleActive = useCallback(
    async (emp: EmployeeRow) => {
      const { error } = await supabase
        .from("employees")
        .update({ is_active: !(emp.is_active !== false) })
        .eq("id", emp.id);
      if (error)
        return toast.error(
          "No se pudo actualizar el estado del profesional. Probá de nuevo.",
        );
      load();
    },
    [load],
  );

  const remove = useCallback(async (emp: EmployeeRow) => {
    // Solo bloquean la eliminación los turnos FUTUROS reales (no cancelados y
    // que NO sean bloqueos de horario). El historial pasado, los cancelados y
    // los bloqueos NO bloquean: se desvinculan del profesional al eliminarlo.
    const nowIso = new Date().toISOString();
    const { data: future, error: checkError } = await supabase
      .from("appointments")
      .select("id")
      .eq("employee_id", emp.id)
      .gte("starts_at", nowIso)
      .neq("status", "cancelled")
      .neq("status", "blocked")
      .limit(1);
    if (checkError) {
      toast.error(
        "No se pudo verificar los turnos del profesional. Probá de nuevo.",
      );
      return;
    }
    if (future && future.length > 0) {
      toast.error(
        "No se puede eliminar este profesional porque tiene turnos futuros agendados. Podés marcarlo como inactivo.",
      );
      return;
    }
    setConfirmDel(emp);
  }, []);

  const handleEditPro = useCallback(
    (emp: EmployeeRow) => {
      setEditingEmp(emp);
      setForm({
        ...EMPTY_FORM,
        fullName: emp.full_name ?? emp.name ?? "",
        avatarUrl: emp.avatar_url ?? "",
        commissionPct: String(emp.commission_pct ?? ""),
        role: emp.role ?? "Barbero",
        acceptsOnline: employeeOnlineMap[emp.id] !== false,
        schedule: employeeSchedules[emp.id] ?? EMPTY_FORM.schedule,
        specialDates: employeeSpecialDates[emp.id] ?? {},
      });
      setDlgTab("perfil");
      setOpen(true);
    },
    [employeeOnlineMap, employeeSchedules, employeeSpecialDates],
  );

  async function doRemoveEmp() {
    if (!confirmDel) return;
    const emp = confirmDel;
    setConfirmDel(null);
    setDeletingId(emp.id);

    // La FK appointments.employee_id → employees.id impide borrar un profesional
    // con turnos que lo referencian. Para poder eliminarlo cuando solo tiene
    // historial, desvinculamos (employee_id = null) sus turnos PASADOS y los
    // CANCELADOS (cualquier fecha). Los FUTUROS no cancelados NO se tocan: si
    // existe alguno (p. ej. agendado entre el chequeo y el borrado), la FK
    // bloquea el delete y el backstop de abajo muestra el mensaje correcto.
    const nowIso = new Date().toISOString();
    const detachPast = await supabase
      .from("appointments")
      .update({ employee_id: null })
      .eq("employee_id", emp.id)
      .lt("starts_at", nowIso);
    const detachCancelled = await supabase
      .from("appointments")
      .update({ employee_id: null })
      .eq("employee_id", emp.id)
      .eq("status", "cancelled");
    const detachBlocked = await supabase
      .from("appointments")
      .update({ employee_id: null })
      .eq("employee_id", emp.id)
      .eq("status", "blocked");
    if (detachPast.error || detachCancelled.error || detachBlocked.error) {
      setDeletingId(null);
      toast.error("No se pudo eliminar el profesional. Probá de nuevo.");
      return;
    }

    const { error } = await supabase
      .from("employees")
      .delete()
      .eq("id", emp.id);
    if (error) {
      setDeletingId(null);
      // Backstop por si se agendó un turno FUTURO entre el chequeo y el borrado:
      // nunca mostramos el error técnico de la FK al usuario.
      if (
        error.code === "23503" ||
        /appointments_employee_id_fkey|foreign key/i.test(error.message)
      ) {
        toast.error(
          "No se puede eliminar este profesional porque tiene turnos futuros agendados. Podés marcarlo como inactivo.",
        );
        return;
      }
      toast.error("No se pudo eliminar el profesional. Probá de nuevo.");
      return;
    }
    // Borrado quirúrgico por id en el estado local (sin recargar la página ni
    // re-fetchear toda la lista). Solo desaparece exactamente este profesional.
    setRows((prev) => prev.filter((e) => e.id !== emp.id));
    if (editingEmp?.id === emp.id) {
      setOpen(false);
      setEditingEmp(null);
    }
    setDeletingId(null);
    toast.success("Profesional eliminado.");
  }

  function setDay(key: DayKey, patch: Partial<DaySchedule>) {
    setForm((f) => ({
      ...f,
      schedule: { ...f.schedule, [key]: { ...f.schedule[key], ...patch } },
    }));
  }

  function togglePermission(roleId: RolePermissionId, key: PermissionKey) {
    if (roleId === "admin_general") return;
    setRolePermissions((current) => {
      const nextValue = !current[roleId][key];
      const nextRole = { ...current[roleId], [key]: nextValue };

      if (key === "configuracion" && !nextValue) {
        CONFIG_PERMISSION_ITEMS.forEach((item) => {
          nextRole[item.key] = false;
        });
      }

      if (
        CONFIG_PERMISSION_ITEMS.some((item) => item.key === key) &&
        nextValue
      ) {
        nextRole.configuracion = true;
      }

      return { ...current, [roleId]: nextRole };
    });
  }

  async function saveAccessUser() {
    setAccessTouched(true);
    const selectedEmployee = rows.find(
      (emp) => emp.id === accessForm.employee_id,
    );
    const fallbackName =
      accessForm.role === "profesional"
        ? selectedEmployee?.full_name || selectedEmployee?.name || ""
        : ROLE_LABEL_BY_ID[accessForm.role];
    const name = fallbackName.trim();
    const email = accessForm.email.trim();

    if (accessForm.role === "profesional" && !selectedEmployee) {
      setAccessTouched(true);
      return toast.error("Debés seleccionar un profesional para este acceso.");
    }
    if (!email) return toast.error("Ingresá el correo electrónico");
    if (!businessId) return toast.error("No se pudo determinar el negocio");

    setSaving(true);
    const payload = {
      action: editingAccessUserId ? "update" : "create",
      member_id: editingAccessUserId ?? undefined,
      business_id: businessId,
      email,
      full_name: name,
      role: accessForm.role,
      status:
        editingAccessUserId &&
        accessUsers.find((user) => user.id === editingAccessUserId)?.status ===
          "invited"
          ? "invited"
          : accessForm.status === "inactive"
            ? "suspended"
            : "active",
      professional_id:
        accessForm.role === "profesional"
          ? (selectedEmployee?.id ?? null)
          : null,
      branch_id: accessForm.branch_id ?? null,
      permissions: accessPermissionsForm,
    };

    const { data, error } = await supabase.functions.invoke(
      "invite-team-member",
      {
        body: payload,
      },
    );
    setSaving(false);

    const rawErrMsg =
      error?.message ?? (data as { error?: string } | null)?.error ?? null;
    const friendlyErrMsg = rawErrMsg?.includes("non-2xx status code")
      ? "No se pudo crear el acceso. Revisá si ese correo ya existe o tiene una invitación pendiente."
      : rawErrMsg;
    if (friendlyErrMsg) return toast.error(friendlyErrMsg);

    toast.success(
      editingAccessUserId
        ? "Acceso actualizado correctamente"
        : "Invitación enviada por email",
    );
    setEditingAccessUserId(null);
    setAccessForm(EMPTY_ACCESS_FORM);
    setAccessTouched(false);
    setAccessPermissionsForm(DEFAULT_ROLE_PERMISSIONS.profesional);
    setSelectedPermRole(accessForm.role);
    await loadTeamMembers();
  }

  function editAccessUser(user: AccessUser) {
    setEditingAccessUserId(user.id);
    setAccessForm({
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status === "suspended" ? "inactive" : "active",
      employee_id: user.employee_id ?? null,
      branch_id: user.branch_id ?? null,
    });
    setAccessPermissionsForm(
      userPermissions[user.id] ?? DEFAULT_ROLE_PERMISSIONS[user.role],
    );
    setSelectedPermRole(user.role);
    setSelectedAccessUserId(user.id);
    setAccessTouched(false);
  }

  function cancelEditAccessUser() {
    setEditingAccessUserId(null);
    setAccessForm(EMPTY_ACCESS_FORM);
    setAccessPermissionsForm(DEFAULT_ROLE_PERMISSIONS.profesional);
    setAccessTouched(false);
  }

  async function removeAccessUser(id: string) {
    if (!businessId) return;
    if (id === principalAdminId) {
      setPendingDeleteUser(null);
      return toast.error("El administrador principal no se puede eliminar.");
    }

    setDeletingAccess(true);
    const { data, error } = await supabase.functions.invoke(
      "invite-team-member",
      {
        body: {
          action: "delete",
          business_id: businessId,
          member_id: id,
        },
      },
    );
    setDeletingAccess(false);
    setPendingDeleteUser(null);

    const errMsg =
      error?.message ?? (data as { error?: string } | null)?.error ?? null;
    if (errMsg) return toast.error("Error eliminando acceso: " + errMsg);

    if (selectedAccessUserId === id) setSelectedAccessUserId("");
    if (editingAccessUserId === id) cancelEditAccessUser();
    toast.success("Acceso eliminado");
    await loadTeamMembers();
  }

  // Admin principal = el admin_general más antiguo del negocio (no se puede eliminar).
  const principalAdminId = (() => {
    const admins = accessUsers
      .filter((u) => u.role === "admin_general")
      .slice()
      .sort((a, b) =>
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
      );
    return admins[0]?.id ?? null;
  })();

  function toggleUserPermission(userId: string, key: PermissionKey) {
    const user = accessUsers.find((item) => item.id === userId);
    if (!user) return;

    setUserPermissions((current) => {
      const base = current[userId] ?? DEFAULT_ROLE_PERMISSIONS[user.role];
      const nextValue = !base[key];
      const nextUser = { ...base, [key]: nextValue };

      if (key === "configuracion" && !nextValue) {
        CONFIG_PERMISSION_ITEMS.forEach((item) => {
          nextUser[item.key] = false;
        });
      }

      if (
        CONFIG_PERMISSION_ITEMS.some((item) => item.key === key) &&
        nextValue
      ) {
        nextUser.configuracion = true;
      }

      return { ...current, [userId]: nextUser };
    });
  }

  function getRecommendedPermissionKeys(role: RolePermissionId) {
    return MAIN_PERMISSION_ITEMS.map((i) => i.key).filter(
      (key) => DEFAULT_ROLE_PERMISSIONS[role][key],
    );
  }

  function getAdditionalPermissionKeys(role: RolePermissionId) {
    return MAIN_PERMISSION_ITEMS.map((i) => i.key).filter(
      (key) => !DEFAULT_ROLE_PERMISSIONS[role][key],
    );
  }

  function getPermissionItem(key: PermissionKey) {
    return (
      MAIN_PERMISSION_ITEMS.find((item) => item.key === key) ??
      CONFIG_PERMISSION_ITEMS.find((item) => item.key === key)
    );
  }

  function toggleAccessFormPermission(key: PermissionKey) {
    setAccessPermissionsForm((current) => {
      const next = { ...current, [key]: !current[key] };
      // "Configuración" es un único permiso que habilita/inhabilita todas las
      // subsecciones internas (Branding, Horarios, Equipo, Servicios, Catálogo,
      // Caja, Señas) de una vez.
      if (key === "configuracion") {
        const v = next.configuracion;
        CONFIG_SUB_KEYS.forEach((sub) => {
          next[sub] = v;
        });
      }
      return next;
    });
  }

  function resetSelectedAccessPermissions() {
    if (!selectedAccessUser) return;
    setUserPermissions((current) => ({
      ...current,
      [selectedAccessUser.id]: {
        ...DEFAULT_ROLE_PERMISSIONS[selectedAccessUser.role],
      },
    }));
    toast.success("Permisos recomendados restablecidos");
  }

  const selectedRole =
    ROLE_PERMISSION_OPTIONS.find((role) => role.id === selectedPermRole) ??
    ROLE_PERMISSION_OPTIONS[0];
  const selectedRoleUsers = accessUsers.filter(
    (user) => user.role === selectedPermRole,
  );
  const selectedAccessUser =
    selectedRoleUsers.find((user) => user.id === selectedAccessUserId) ??
    selectedRoleUsers[0] ??
    null;
  const selectedUserPermissions = selectedAccessUser
    ? (userPermissions[selectedAccessUser.id] ??
      DEFAULT_ROLE_PERMISSIONS[selectedAccessUser.role])
    : null;
  const selectedPermissions =
    individualPermMode && selectedUserPermissions
      ? selectedUserPermissions
      : selectedPermRole === "admin_general"
        ? allOnPermissions()
        : rolePermissions[selectedPermRole];
  const selectedRoleLocked = selectedAccessUser?.role === "admin_general";
  const currentPanelTitle =
    individualPermMode && selectedAccessUser
      ? `${selectedAccessUser.name} · ${ROLE_LABEL_BY_ID[selectedAccessUser.role]}`
      : selectedRole.label;
  const accessRoleOption =
    ROLE_PERMISSION_OPTIONS.find((role) => role.id === accessForm.role) ??
    ROLE_PERMISSION_OPTIONS[0];
  const accessRoleSummary = ROLE_ACCESS_SUMMARY[accessForm.role];

  return (
    <>
      <div>
        <h2 className="text-xl font-display font-semibold">Equipo</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Administrá tu equipo.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-white/5">
        {(
          [
            ["pros", "Profesionales"],
            ["users", "Accesos"],
          ] as const
        ).map(([id, label]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "relative px-4 py-2.5 text-sm transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              {active && (
                <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-sky-400 to-violet-500" />
              )}
            </button>
          );
        })}
      </div>

      {tab === "pros" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              onClick={openNew}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-4 py-2.5 text-sm shadow-lg shadow-sky-500/20"
            >
              <Plus className="h-4 w-4" /> Agregar profesional
            </button>
          </div>

          {loading ? (
            <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
              Cargando…
            </div>
          ) : rows.length === 0 ? (
            <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
              No hay profesionales cargados. Agregá el primero con el botón de
              arriba.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {rows.map((emp) => (
                <ProfessionalCard
                  key={emp.id}
                  emp={emp}
                  tintClass={tintForId(emp.id)}
                  deleting={deletingId === emp.id}
                  onEdit={handleEditPro}
                  onToggle={toggleActive}
                  onRemove={remove}
                />
              ))}
            </div>
          )}
          <SectionCard label="Aprobación de cobros profesionales">
            <div className="space-y-5">
              <div className="flex items-center gap-4 rounded-2xl bg-white/[0.025] ring-1 ring-white/10 p-4">
                <div className="h-11 w-11 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center shrink-0">
                  <ShieldCheck className="h-5 w-5 text-violet-200" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-base">
                    Habilitar modo de aprobación
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    Definí si los cobros de profesionales se registran directo
                    en Caja o si necesitan revisión.
                  </div>
                </div>
                <Toggle on={approvalEnabled} onChange={updateApprovalEnabled} />
              </div>

              {approvalEnabled && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => updateApprovalMode("auto")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        updateApprovalMode("auto");
                      }
                    }}
                    className={cn(
                      "group text-left rounded-2xl p-5 ring-1 transition-all relative overflow-hidden cursor-pointer",
                      approvalMode === "auto"
                        ? "bg-gradient-to-br from-violet-500/12 via-sky-500/8 to-white/[0.03] ring-violet-300/35 shadow-[0_0_60px_-35px_rgba(139,92,246,0.9)]"
                        : "bg-white/[0.025] ring-white/10 hover:bg-white/[0.045] hover:ring-white/20",
                    )}
                  >
                    <div className="pointer-events-none absolute -right-14 -top-16 h-36 w-36 rounded-full bg-sky-400/10 blur-3xl" />
                    <div className="relative flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                          Modo
                        </div>
                        <div className="mt-1 text-xl font-display font-semibold">
                          Automático
                        </div>
                      </div>
                      {approvalMode === "auto" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-400/10 ring-1 ring-violet-300/25 px-2.5 py-1 text-[11px] font-semibold text-violet-200">
                          Seleccionado
                        </span>
                      )}
                    </div>
                    <p className="relative mt-3 text-sm leading-relaxed text-muted-foreground">
                      El profesional cobra desde su panel y el ingreso se
                      registra automáticamente en Caja.
                    </p>
                    <div className="relative mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAutoApprovalPurpose((v) => !v);
                        }}
                        className="inline-flex items-center gap-2 rounded-full bg-white/[0.055] px-3 py-2 text-xs font-semibold text-white/75 ring-1 ring-white/10 transition hover:bg-white/[0.085] hover:text-white"
                      >
                        <span>💡</span>
                        <span>¿Para qué sirve?</span>
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            showAutoApprovalPurpose && "rotate-180",
                          )}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAutoApprovalExample((v) => !v);
                        }}
                        className="inline-flex items-center gap-2 rounded-full bg-white/[0.055] px-3 py-2 text-xs font-semibold text-white/75 ring-1 ring-white/10 transition hover:bg-white/[0.085] hover:text-white"
                      >
                        <span>❓</span>
                        <span>¿Cómo funciona?</span>
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            showAutoApprovalExample && "rotate-180",
                          )}
                        />
                      </button>
                    </div>

                    {showAutoApprovalPurpose ? (
                      <div className="relative mt-3 rounded-2xl bg-black/15 ring-1 ring-white/10 p-4">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/85">
                          Para qué sirve
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-white/78">
                          Ideal si cada profesional cobra directamente a sus clientes. Permite registrar el pago desde su propio panel, sin depender de la recepción, agilizando el cobro y reduciendo los tiempos de espera.
                        </p>
                      </div>
                    ) : null}

                    {showAutoApprovalExample ? (
                      <div className="relative mt-3 rounded-2xl bg-black/15 ring-1 ring-white/10 p-4">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/85">
                          Ejemplo
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-white/78">
                          Juan finaliza un servicio de $20.000 y registra el cobro
                          desde su panel.
                        </p>
                        <div className="mt-3 space-y-2">
                          <div className="text-sm font-semibold text-white">
                            Resultado:
                          </div>
                          <div className="rounded-xl bg-white/[0.045] px-3 py-2 ring-1 ring-white/10 shadow-[0_14px_35px_-28px_rgba(56,189,248,0.7)]">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-mono text-xs text-white/42">12:00</span>
                              <span className="font-semibold text-white">Juan</span>
                              <span className="text-white/35">→</span>
                              <span className="font-semibold text-emerald-400">Cobró</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => updateApprovalMode("manual")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        updateApprovalMode("manual");
                      }
                    }}
                    className={cn(
                      "group text-left rounded-2xl p-5 ring-1 transition-all relative overflow-hidden cursor-pointer",
                      approvalMode === "manual"
                        ? "bg-gradient-to-br from-violet-500/12 via-sky-500/8 to-white/[0.03] ring-violet-300/35 shadow-[0_0_60px_-35px_rgba(139,92,246,0.9)]"
                        : "bg-white/[0.025] ring-white/10 hover:bg-white/[0.045] hover:ring-white/20",
                    )}
                  >
                    <div className="pointer-events-none absolute -right-14 -top-16 h-36 w-36 rounded-full bg-violet-400/10 blur-3xl" />
                    <div className="relative flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                          Modo
                        </div>
                        <div className="mt-1 text-xl font-display font-semibold">
                          Manual
                        </div>
                      </div>
                      {approvalMode === "manual" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-400/10 ring-1 ring-violet-300/25 px-2.5 py-1 text-[11px] font-semibold text-violet-200">
                          Seleccionado
                        </span>
                      )}
                    </div>
                    <p className="relative mt-3 text-sm leading-relaxed text-muted-foreground">
                      El profesional informa el cobro y Caja lo revisa antes de
                      registrarlo oficialmente.
                    </p>
                    <div className="relative mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowManualApprovalPurpose((v) => !v);
                        }}
                        className="inline-flex items-center gap-2 rounded-full bg-white/[0.055] px-3 py-2 text-xs font-semibold text-white/75 ring-1 ring-white/10 transition hover:bg-white/[0.085] hover:text-white"
                      >
                        <span>💡</span>
                        <span>¿Para qué sirve?</span>
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            showManualApprovalPurpose && "rotate-180",
                          )}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowManualApprovalExample((v) => !v);
                        }}
                        className="inline-flex items-center gap-2 rounded-full bg-white/[0.055] px-3 py-2 text-xs font-semibold text-white/75 ring-1 ring-white/10 transition hover:bg-white/[0.085] hover:text-white"
                      >
                        <span>❓</span>
                        <span>¿Cómo funciona?</span>
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            showManualApprovalExample && "rotate-180",
                          )}
                        />
                      </button>
                    </div>

                    {showManualApprovalPurpose ? (
                      <div className="relative mt-3 rounded-2xl bg-black/15 ring-1 ring-white/10 p-4">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/85">
                          Para qué sirve
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-white/78">
                          Ideal para que profesionales y Caja tengan el mismo control sobre los servicios realizados. Cada servicio se registra desde el panel del profesional y Caja lo aprueba antes de registrarlo oficialmente.
                        </p>
                      </div>
                    ) : null}

                    {showManualApprovalExample ? (
                      <div className="relative mt-3 rounded-2xl bg-black/15 ring-1 ring-white/10 p-4">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/85">
                          Ejemplo
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-white/78">
                          Juan finaliza un servicio de $20.000 y registra el cobro
                          desde su panel.
                        </p>
                        <div className="mt-3 space-y-2">
                          <div className="text-sm font-semibold text-white">
                            Resultado:
                          </div>
                          <div className="rounded-xl bg-white/[0.045] px-3 py-2 ring-1 ring-sky-400/15 shadow-[0_14px_35px_-28px_rgba(56,189,248,0.75)]">
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-mono text-xs text-white/42">12:00</span>
                                <span className="font-semibold text-white">Juan</span>
                                <span className="text-white/35">→</span>
                                <span className="font-semibold text-sky-400">Envió a caja</span>
                              </div>
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-mono text-xs text-white/42">12:01</span>
                                <span className="font-semibold text-white">Caja</span>
                                <span className="text-white/35">→</span>
                                <span className="font-semibold text-emerald-400">Cobró</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      )}

      {tab === "users" && (
        <div className="-mt-2 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-lg font-display font-semibold">
                Accesos del equipo
              </h3>
              <p className="text-sm text-muted-foreground">
                Invitá y administrá quién puede entrar a Clippr.
              </p>
            </div>
            {editingAccessUserId && (
              <div className="rounded-xl bg-cyan-500/10 ring-1 ring-cyan-400/20 px-3 py-2 text-xs text-cyan-200 flex items-center justify-between gap-3">
                <span>Editando: {accessForm.email || "sin email"}</span>
                <button
                  type="button"
                  onClick={cancelEditAccessUser}
                  className="rounded-lg bg-white/10 hover:bg-white/15 px-2 py-1 text-[11px] text-foreground"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[0.78fr_1fr] gap-3">
            <div className="glass rounded-2xl p-4 ring-1 ring-white/5">
              <div className="flex items-center gap-3 mb-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-sky-400/10 ring-1 ring-sky-300/20">
                  <UserPlus className="h-5 w-5 text-sky-300" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Nuevo acceso</div>
                  <div className="text-xs text-muted-foreground">
                    {editingAccessUserId
                      ? "Actualizá el acceso seleccionado."
                      : "Invitá a un profesional o colaborador a Clippr."}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Rol">
                    <select
                      value={accessForm.role}
                      onChange={(e) => {
                        const role = e.target.value as RolePermissionId;
                        setAccessForm((f) => ({
                          ...f,
                          role,
                          name: "",
                          employee_id: null,
                          email: "",
                        }));
                        setAccessPermissionsForm(
                          DEFAULT_ROLE_PERMISSIONS[role],
                        );
                        setAccessTouched(false);
                      }}
                      className={inputCls}
                    >
                      {ROLE_PERMISSION_OPTIONS.filter(
                        (role) => role.id !== "admin_general",
                      ).map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Estado">
                    <select
                      value={accessForm.status}
                      onChange={(e) =>
                        setAccessForm((f) => ({
                          ...f,
                          status: e.target.value as "active" | "inactive",
                        }))
                      }
                      className={inputCls}
                    >
                      <option value="active">Activo</option>
                      <option value="inactive">Inactivo</option>
                    </select>
                  </Field>
                </div>

                {accessForm.role === "profesional" && (
                  <div>
                    <Field label="Profesional">
                      <select
                        value={accessForm.employee_id ?? ""}
                        onChange={(e) =>
                          setAccessForm((f) => ({
                            ...f,
                            employee_id: e.target.value || null,
                          }))
                        }
                        className={cn(
                          inputCls,
                          accessTouched &&
                            !accessForm.employee_id &&
                            "ring-red-500/70 focus:ring-red-500/70",
                        )}
                      >
                        <option value="">Elegí un profesional</option>
                        {rows.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.full_name || emp.name || "Sin nombre"}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {accessTouched && !accessForm.employee_id && (
                      <div className="text-xs text-red-400 mt-1">
                        Debés seleccionar un profesional para este acceso.
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <Field label="Correo electrónico">
                    <input
                      type="email"
                      autoComplete="off"
                      name="clippr-access-email"
                      value={accessForm.email}
                      onChange={(e) =>
                        setAccessForm((f) => ({ ...f, email: e.target.value }))
                      }
                      className={cn(
                        inputCls,
                        accessTouched &&
                          !accessForm.email.trim() &&
                          "ring-red-500/70 focus:ring-red-500/70",
                      )}
                      placeholder="ejemplo@correo.com"
                    />
                  </Field>
                  {accessTouched && !accessForm.email.trim() && (
                    <div className="text-xs text-red-400 mt-1">
                      Campo requerido
                    </div>
                  )}
                </div>

                <div className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 px-3 py-2.5 text-xs text-muted-foreground flex items-start gap-2">
                  <Mail className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                  <span>
                    La persona crea su contraseña desde la invitación que recibe
                    por email.
                  </span>
                </div>

                <button
                  type="button"
                  onClick={saveAccessUser}
                  disabled={saving}
                  className="w-full rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-4 py-2.5 text-sm shadow-lg shadow-sky-500/20 disabled:opacity-60"
                >
                  {saving
                    ? "Procesando…"
                    : editingAccessUserId
                      ? "Guardar cambios"
                      : "Invitar y guardar"}
                </button>
              </div>
            </div>

            <div className="glass rounded-2xl p-4 ring-1 ring-white/5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">
                    Usuarios y accesos
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {accessUsers.length}{" "}
                    {accessUsers.length === 1
                      ? "acceso creado"
                      : "accesos creados"}
                  </div>
                </div>
              </div>

              {accessUsers.length === 0 ? (
                <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-5 text-sm text-muted-foreground text-center">
                  Todavía no hay accesos creados.
                </div>
              ) : (
                <div className="space-y-2">
                  {accessUsers.map((user) => {
                    const displayTitle =
                      user.role === "profesional"
                        ? user.name || ROLE_LABEL_BY_ID[user.role]
                        : ROLE_LABEL_BY_ID[user.role];
                    return (
                    <div
                      key={user.id}
                      className="flex items-center gap-3 rounded-xl bg-white/[0.04] ring-1 ring-white/10 p-3"
                    >
                      <div className="h-9 w-9 rounded-full bg-white/8 ring-1 ring-white/10 grid place-items-center text-xs font-semibold">
                        {(displayTitle[0] || "A").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium ">
                          {displayTitle}
                        </div>
                        <div className="text-xs text-muted-foreground ">
                          {user.email}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2 py-1 text-[10px] ring-1",
                          user.status === "active"
                            ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
                            : user.status === "invited"
                              ? "bg-cyan-500/10 text-cyan-300 ring-cyan-400/20"
                              : "bg-white/5 text-muted-foreground ring-white/10",
                        )}
                      >
                        {user.status === "active"
                          ? "Activo"
                          : user.status === "invited"
                            ? "Pendiente"
                            : "Inactivo"}
                      </span>
                      <button
                        type="button"
                        onClick={() => editAccessUser(user)}
                        className="rounded-lg bg-white/[0.05] hover:bg-white/[0.09] ring-1 ring-white/10 text-foreground px-2.5 py-1.5 text-xs"
                      >
                        Editar
                      </button>
                      {user.id === principalAdminId ? (
                        <span
                          className="rounded-lg bg-white/[0.04] ring-1 ring-white/10 text-muted-foreground px-2.5 py-1.5 text-[10px]"
                          title="El administrador principal no se puede eliminar"
                        >
                          Principal
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteUser(user)}
                          className="rounded-lg bg-red-500/10 hover:bg-red-500/20 ring-1 ring-red-500/30 text-red-300 px-2.5 py-1.5"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}

              <div className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-sm">
                      Permisos incluidos
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Según el rol seleccionado:{" "}
                      {ROLE_LABEL_BY_ID[accessForm.role]}.
                    </div>
                  </div>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-400/10 ring-1 ring-violet-300/20">
                    <ShieldCheck className="h-4.5 w-4.5 text-violet-200" />
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-emerald-400/[0.06] ring-1 ring-emerald-400/15 p-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300/90">
                        Puede acceder
                      </div>
                      <div className="space-y-1.5">
                        {accessRoleSummary.can.map((item) => (
                          <div
                            key={item}
                            className="flex items-center gap-2 text-xs text-white/80"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 p-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                        No accede
                      </div>
                      {accessRoleSummary.cannot.length === 0 ? (
                        <div className="text-xs text-muted-foreground">
                          Sin restricciones.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {accessRoleSummary.cannot.map((item) => (
                            <div
                              key={item}
                              className="flex items-center gap-2 text-xs text-muted-foreground"
                            >
                              <XCircle className="h-3.5 w-3.5 text-white/30" />
                              {item}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <details className="group rounded-xl bg-white/[0.025] ring-1 ring-white/10 overflow-hidden">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold hover:bg-white/[0.04]">
                      <span>Personalizar permisos</span>
                      <span className="text-xs font-medium text-muted-foreground group-open:hidden">
                        Opcional
                      </span>
                      <span className="hidden text-xs font-medium text-muted-foreground group-open:inline">
                        Cerrar
                      </span>
                    </summary>
                    <div className="border-t border-white/5 p-4 space-y-4">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-2">
                          Accesos recomendados
                        </div>
                        <div className="space-y-2">
                          {getRecommendedPermissionKeys(accessForm.role).map(
                            (key) => {
                              const item = getPermissionItem(key);
                              if (!item) return null;
                              const checked = accessPermissionsForm[key];
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() =>
                                    toggleAccessFormPermission(key)
                                  }
                                  className={cn(
                                    "w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ring-1 text-left transition",
                                    checked
                                      ? "bg-white/[0.06] ring-white/15"
                                      : "bg-white/[0.03] ring-white/10 hover:bg-white/[0.06]",
                                  )}
                                >
                                  <div>
                                    <div className="text-sm font-medium">
                                      {item.label}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {item.desc}
                                    </div>
                                  </div>
                                  <span
                                    className={cn(
                                      "h-5 w-5 rounded-full grid place-items-center ring-1",
                                      checked
                                        ? "bg-emerald-400/90 text-white ring-transparent"
                                        : "bg-white/5 ring-white/15",
                                    )}
                                  >
                                    {checked && (
                                      <Check
                                        className="h-3.5 w-3.5"
                                        strokeWidth={3}
                                      />
                                    )}
                                  </span>
                                </button>
                              );
                            },
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-2">
                          Adicionales
                        </div>
                        <div className="space-y-2">
                          {getAdditionalPermissionKeys(accessForm.role).map(
                            (key) => {
                              const item = getPermissionItem(key);
                              if (!item) return null;
                              const checked = accessPermissionsForm[key];
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() =>
                                    toggleAccessFormPermission(key)
                                  }
                                  className={cn(
                                    "w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ring-1 text-left transition",
                                    checked
                                      ? "bg-white/[0.06] ring-white/15"
                                      : "bg-white/[0.03] ring-white/10 hover:bg-white/[0.06]",
                                  )}
                                >
                                  <div>
                                    <div className="text-sm font-medium">
                                      {item.label}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {item.desc}
                                    </div>
                                  </div>
                                  <span
                                    className={cn(
                                      "h-5 w-5 rounded-full grid place-items-center ring-1",
                                      checked
                                        ? "bg-emerald-400/90 text-white ring-transparent"
                                        : "bg-white/5 ring-white/15",
                                    )}
                                  >
                                    {checked && (
                                      <Check
                                        className="h-3.5 w-3.5"
                                        strokeWidth={3}
                                      />
                                    )}
                                  </span>
                                </button>
                              );
                            },
                          )}
                        </div>
                      </div>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteUser && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-xl grid place-items-center bg-red-500/15 ring-1 ring-red-500/30">
                  <Trash2 className="h-5 w-5 text-red-300" />
                </div>
                <h3 className="text-lg font-semibold">¿Eliminar acceso?</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Esta acción eliminará de{" "}
                <span className="text-foreground font-medium">
                  {pendingDeleteUser.name || pendingDeleteUser.email}
                </span>
                :
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 mb-4 list-disc pl-5">
                <li>Usuario</li>
                <li>Permisos</li>
                <li>Historial de acceso</li>
              </ul>
              <p className="text-sm text-red-300/90 mb-5">
                El usuario ya no podrá iniciar sesión.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingDeleteUser(null)}
                  disabled={deletingAccess}
                  className="rounded-xl bg-white/[0.05] hover:bg-white/[0.09] ring-1 ring-white/10 px-4 py-2 text-sm disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => removeAccessUser(pendingDeleteUser.id)}
                  disabled={deletingAccess}
                  className="rounded-xl bg-red-500/90 hover:bg-red-500 text-white font-semibold px-4 py-2 text-sm disabled:opacity-60"
                >
                  {deletingAccess ? "Eliminando…" : "Eliminar acceso"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-zinc-950 ring-1 ring-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 p-4 border-b border-white/5">
              <div className="h-10 w-10 rounded-full overflow-hidden grid place-items-center text-sm font-semibold text-white bg-gradient-to-br from-red-400 to-rose-500 ring-1 ring-white/10">
                {form.avatarUrl ? (
                  <img
                    src={form.avatarUrl}
                    alt={form.fullName || "Profesional"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (form.fullName[0] || "A").toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold">
                  {editingEmp ? "Editar profesional" : "Nuevo profesional"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {form.role || "Barbero"}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full p-1.5 ring-1 ring-white/10 hover:bg-white/5 text-muted-foreground"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center gap-6 px-5 border-b border-white/5">
              {(
                [
                  ["perfil", "Perfil"],
                  ["horarios", "Horarios"],
                  ["comisiones", "Comisiones"],
                ] as const
              ).map(([id, label]) => {
                const active = dlgTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setDlgTab(id)}
                    className={cn(
                      "relative py-3 text-sm transition-colors",
                      active
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                    {active && (
                      <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-sky-400 to-violet-500" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="p-4 space-y-4">
              {dlgTab === "perfil" && (
                <div className="space-y-3">
                  <div className="rounded-2xl bg-white/[0.035] ring-1 ring-white/10 p-4">
                    <div className="flex items-center gap-4">
                      <div className="h-16 w-16 rounded-full overflow-hidden grid place-items-center bg-gradient-to-br from-red-400 to-rose-500 text-white font-semibold text-xl ring-1 ring-white/10">
                        {form.avatarUrl ? (
                          <img
                            src={form.avatarUrl}
                            alt={form.fullName || "Profesional"}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          (form.fullName[0] || "A").toUpperCase()
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold">
                          Foto del profesional
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          JPG, PNG o WEBP. La app la recorta a 200x200, la
                          convierte a WebP y la comprime antes de subirla.
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-white/[0.05] hover:bg-white/[0.09] ring-1 ring-white/10 px-3 py-2 text-xs font-medium">
                            Subir imagen
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void uploadProfessionalAvatar(file);
                                e.currentTarget.value = "";
                              }}
                            />
                          </label>
                          {form.avatarUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setForm({ ...form, avatarUrl: "" })
                              }
                              className="rounded-xl bg-red-500/10 hover:bg-red-500/20 ring-1 ring-red-500/30 px-3 py-2 text-xs text-red-300"
                            >
                              Quitar foto
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <Field label="Nombre completo *">
                    <input
                      value={form.fullName}
                      onChange={(e) =>
                        setForm({ ...form, fullName: e.target.value })
                      }
                      className={inputCls}
                      placeholder="Ej: Alejandro"
                    />
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Teléfono">
                      <input
                        value={form.phone}
                        onChange={(e) =>
                          setForm({ ...form, phone: e.target.value })
                        }
                        className={inputCls}
                        placeholder="11..."
                      />
                    </Field>
                    <Field label="Rol">
                      <input
                        value={form.role}
                        onChange={(e) =>
                          setForm({ ...form, role: e.target.value })
                        }
                        className={inputCls}
                        placeholder="Barbero"
                      />
                    </Field>
                  </div>
                  <label className="flex items-center gap-3 rounded-xl bg-white/5 ring-1 ring-white/10 p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.acceptsOnline}
                      onChange={(e) =>
                        setForm({ ...form, acceptsOnline: e.target.checked })
                      }
                      className="sr-only"
                    />
                    <span
                      className={cn(
                        "h-5 w-9 rounded-full relative transition-colors shrink-0",
                        form.acceptsOnline ? "bg-primary" : "bg-white/15",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                          form.acceptsOnline ? "left-[18px]" : "left-0.5",
                        )}
                      />
                    </span>
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        Acepta reservas en línea
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Este profesional aparecerá disponible para reservas
                        online
                      </div>
                    </div>
                  </label>
                  <Field label="Descripción (opcional)">
                    <textarea
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                      className={cn(inputCls, "min-h-[90px] resize-y")}
                      placeholder="Especialidades, experiencia, estilo…"
                    />
                  </Field>
                </div>
              )}

              {dlgTab === "horarios" && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Días desactivados no recibirán turnos.
                  </p>
                  {WEEKDAYS.map(([key, label]) => {
                    const d = form.schedule[key];
                    return (
                      <div
                        key={key}
                        className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3"
                      >
                        <div className="flex items-center gap-3 flex-wrap">
                          <button
                            onClick={() => setDay(key, { enabled: !d.enabled })}
                            className={cn(
                              "h-5 w-9 rounded-full relative transition-colors shrink-0",
                              d.enabled ? "bg-primary" : "bg-white/15",
                            )}
                          >
                            <span
                              className={cn(
                                "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                                d.enabled ? "left-[18px]" : "left-0.5",
                              )}
                            />
                          </button>
                          <div className="text-sm font-medium w-20">
                            {label}
                          </div>
                          {d.enabled && (
                            <>
                              <input
                                type="time"
                                value={d.start}
                                onChange={(e) =>
                                  setDay(key, { start: e.target.value })
                                }
                                className={timeCls}
                              />
                              <span className="text-muted-foreground text-xs">
                                a
                              </span>
                              <input
                                type="time"
                                value={d.end}
                                onChange={(e) =>
                                  setDay(key, { end: e.target.value })
                                }
                                className={timeCls}
                              />
                              <div className="text-xs text-muted-foreground ml-2">
                                Descanso:
                              </div>
                              <input
                                type="time"
                                value={d.breakStart}
                                onChange={(e) =>
                                  setDay(key, { breakStart: e.target.value })
                                }
                                className={timeCls}
                              />
                              <span className="text-muted-foreground text-xs">
                                -
                              </span>
                              <input
                                type="time"
                                value={d.breakEnd}
                                onChange={(e) =>
                                  setDay(key, { breakEnd: e.target.value })
                                }
                                className={timeCls}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <SpecialHoursEditor
                    value={form.specialDates}
                    onChange={(next) =>
                      setForm((f) => ({ ...f, specialDates: next }))
                    }
                    allowBreak
                    closedLabel="No disponible"
                    title="Horario especial"
                    description="Un día distinto al horario normal (ej. 24/12 09:00–15:00) o no disponible una fecha."
                  />
                </div>
              )}

              {dlgTab === "comisiones" && (
                <div className="space-y-5">
                  <div className="rounded-2xl bg-white/[0.035] ring-1 ring-white/10 p-4">
                    <div className="font-semibold text-sm">
                      Comisiones y servicios que realiza
                    </div>
                  </div>

                  {(["servicios", "catalogo"] as const).map((kind) => {
                    const isServiceKind = kind === "servicios";
                    const filtered = commissionItems.filter((item) =>
                      isServiceKind
                        ? item.duration_min != null
                        : item.duration_min == null,
                    );
                    const grouped = filtered.reduce(
                      (acc, item) => {
                        const category =
                          item.category ||
                          (isServiceKind ? "Servicios" : "Productos");
                        if (!acc[category]) acc[category] = [];
                        acc[category].push(item);
                        return acc;
                      },
                      {} as Record<string, PriceRow[]>,
                    );

                    return (
                      <div
                        key={kind}
                        className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 overflow-hidden"
                      >
                        <div className="px-4 py-3 border-b border-white/5">
                          <div className="text-sm font-semibold">
                            {isServiceKind ? "Servicios" : "Catálogo"}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {isServiceKind
                              ? "Servicios cargados en Configuración → Servicios."
                              : "Productos cargados en Configuración → Catálogo."}
                          </div>
                        </div>

                        {Object.keys(grouped).length === 0 ? (
                          <div className="p-4 text-sm text-muted-foreground">
                            No hay {isServiceKind ? "servicios" : "productos"}{" "}
                            cargados.
                          </div>
                        ) : (
                          <div className="divide-y divide-white/5">
                            {Object.entries(grouped).map(
                              ([category, items]) => (
                                <div key={category} className="p-4 space-y-3">
                                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                                    {category}
                                  </div>
                                  <div className="space-y-2">
                                    {items.map((item) => {
                                      const cfg = form.commissions[item.id] ?? {
                                        enabled: false,
                                        mode: "percent" as CommissionMode,
                                        value: "",
                                      };
                                      const updateCfg = (
                                        patch: Partial<CommissionConfig>,
                                      ) =>
                                        setForm({
                                          ...form,
                                          commissions: {
                                            ...form.commissions,
                                            [item.id]: { ...cfg, ...patch },
                                          },
                                        });

                                      return (
                                        <div
                                          key={item.id}
                                          className={cn(
                                            "rounded-xl ring-1 p-3 transition-all",
                                            cfg.enabled
                                              ? "bg-white/[0.06] ring-white/10"
                                              : "bg-white/[0.025] ring-white/5 opacity-75",
                                          )}
                                        >
                                          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                updateCfg({
                                                  enabled: !cfg.enabled,
                                                })
                                              }
                                              className={cn(
                                                "h-6 w-11 rounded-full relative transition-colors shrink-0",
                                                cfg.enabled
                                                  ? "bg-primary"
                                                  : "bg-white/15",
                                              )}
                                            >
                                              <span
                                                className={cn(
                                                  "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                                                  cfg.enabled
                                                    ? "left-[22px]"
                                                    : "left-0.5",
                                                )}
                                              />
                                            </button>

                                            <div className="flex-1 min-w-0">
                                              <div className="text-sm font-medium ">
                                                {item.name}
                                              </div>
                                              <div className="text-xs text-muted-foreground">
                                                $
                                                {Number(
                                                  item.price ?? 0,
                                                ).toLocaleString("es-AR")}
                                                {isServiceKind &&
                                                item.duration_min
                                                  ? ` · ${item.duration_min} min`
                                                  : ""}
                                              </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                              <select
                                                value={cfg.mode}
                                                disabled={!cfg.enabled}
                                                onChange={(e) =>
                                                  updateCfg({
                                                    mode: e.target
                                                      .value as CommissionMode,
                                                  })
                                                }
                                                className="rounded-lg bg-white/5 ring-1 ring-white/10 px-2 py-1.5 text-xs focus:outline-none disabled:opacity-50"
                                              >
                                                <option value="percent">
                                                  % comisión
                                                </option>
                                                <option value="fixed">
                                                  Monto fijo
                                                </option>
                                              </select>
                                              <div className="flex items-center gap-1 rounded-lg bg-white/5 ring-1 ring-white/10 px-2 py-1.5">
                                                <input
                                                  type="number"
                                                  min={0}
                                                  disabled={!cfg.enabled}
                                                  value={cfg.value}
                                                  onChange={(e) =>
                                                    updateCfg({
                                                      value: e.target.value,
                                                    })
                                                  }
                                                  className="w-20 bg-transparent text-sm text-right focus:outline-none disabled:opacity-50"
                                                  placeholder="0"
                                                />
                                                <span className="text-xs text-muted-foreground">
                                                  {cfg.mode === "percent"
                                                    ? "%"
                                                    : "$"}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ),
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 p-4 border-t border-white/5">
              {editingEmp ? (
                <button
                  type="button"
                  onClick={() => setConfirmDel(editingEmp)}
                  disabled={saving || deletingId === editingEmp.id}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-300 ring-1 ring-red-500/30 transition hover:bg-red-500/20 disabled:opacity-50"
                >
                  {deletingId === editingEmp.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Eliminar
                </button>
              ) : null}
              <div className="flex-1" />
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                className="rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-4 py-2.5 text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={saveProfessional}
                disabled={saving}
                className="inline-flex min-w-[160px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-4 py-2.5 text-sm disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmDel}
        title="Eliminar profesional"
        message={`¿Deseás eliminar a "${confirmDel?.full_name ?? confirmDel?.name}"?`}
        onConfirm={doRemoveEmp}
        onCancel={() => setConfirmDel(null)}
      />
    </>
  );
}

// ─────────── Servicios y Catálogo ───────────
type PriceRow = {
  id: string;
  name: string;
  price: number;
  duration_min: number | null;
  category: string | null;
  active: boolean | null;
  stock?: number | null;
  cash_discount?: number | null;
};

type PriceForm = {
  name: string;
  price: string;
  discount: string;
  duration: string;
  status: "Activo" | "Inactivo";
  category: string;
  description: string;
  reservable: boolean;
  stock: string;
  warnStock: string;
  criticalStock: string;
  // Reservas online (solo catálogo)
  bookingShow: boolean;
  bookingOffer: string;
  miniDesc: string;
  // Imagen general (catálogo y servicios)
  image: string;
};

const emptyPriceForm = (
  category = "Servicios",
  isService = true,
): PriceForm => ({
  name: "",
  price: "0",
  discount: "0",
  duration: isService ? "30" : "",
  status: "Activo",
  category,
  description: "",
  reservable: true,
  stock: "0",
  warnStock: "0",
  criticalStock: "0",
  bookingShow: false,
  bookingOffer: "none",
  miniDesc: "",
  image: "",
});

const defaultServiceCategories = ["Servicios"];
const serviceCategories = defaultServiceCategories;
const defaultCatalogCategories = ["Productos", "Bebidas", "Indumentaria"];

function markSettingsDirty() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("clippr:settings-dirty"));
  }
}


function priceToCash(price: string, discount: string) {
  const p = Number(price) || 0;
  const d = Number(discount) || 0;
  return Math.max(0, Math.round(p - (p * d) / 100));
}

function rowToForm(row: PriceRow, isService: boolean): PriceForm {
  return {
    name: row.name ?? "",
    price: String(row.price ?? 0),
    discount: String(row.cash_discount ?? 0), // ← read real value
    duration: row.duration_min
      ? String(row.duration_min)
      : isService
        ? "30"
        : "",
    status: row.active === false ? "Inactivo" : "Activo",
    category: row.category || (isService ? "Servicios" : "Productos"),
    description: "",
    reservable: true,
    stock: String(row.stock ?? 0),
    warnStock: "0",
    criticalStock: "0",
    bookingShow: false,
    bookingOffer: "none",
    miniDesc: "",
    image: "",
  };
}

function PriceEditorModal({
  open,
  mode,
  isService,
  form,
  setForm,
  onClose,
  onSave,
  onDelete,
  saving,
  catalogCategories = defaultCatalogCategories,
  onUploadImage,
  featuredOthers = 0,
}: {
  open: boolean;
  mode: "new" | "edit";
  isService: boolean;
  form: PriceForm;
  setForm: (form: PriceForm) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
  catalogCategories?: string[];
  onUploadImage?: (file: File) => Promise<string | null>;
  featuredOthers?: number;
}) {
  const [uploadingImg, setUploadingImg] = useState(false);
  const bookingFileRef = useRef<HTMLInputElement | null>(null);
  if (!open) return null;
  const cashPrice = priceToCash(form.price, form.discount);
  const title = `${mode === "edit" ? "Editar" : "Nuevo"} ${isService ? "servicio" : "producto"}`;
  const availableCatalogCategories = Array.from(
    new Set([...(form.category ? [form.category] : []), ...catalogCategories]),
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-[oklch(0.12_0.02_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-white/5"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3">
          {isService ? (
            <>
              {/* Servicio · información básica + imagen en una fila */}
              <SectionCard label="Información básica">
                <div className="flex gap-3">
                  <div className="min-w-0 flex-1 space-y-3">
                    <Field label="Nombre del servicio">
                      <input
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className={inputCls}
                        placeholder="Corte + Barba"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Precio de lista">
                        <input
                          type="number"
                          value={form.price}
                          onChange={(e) => setForm({ ...form, price: e.target.value })}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Desc. efectivo (%)">
                        <input
                          type="number"
                          value={form.discount}
                          onChange={(e) => setForm({ ...form, discount: e.target.value })}
                          className={inputCls}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Duración (min)">
                        <input
                          type="number"
                          min={0}
                          value={form.duration}
                          onChange={(e) => setForm({ ...form, duration: e.target.value })}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Categoría">
                        <select
                          value={form.category}
                          onChange={(e) => setForm({ ...form, category: e.target.value })}
                          className={inputCls}
                        >
                          {availableCatalogCategories.map((category) => (
                            <option key={category}>{category}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Estado">
                        <select
                          value={form.status}
                          onChange={(e) =>
                            setForm({ ...form, status: e.target.value as PriceForm["status"] })
                          }
                          className={inputCls}
                        >
                          <option>Activo</option>
                          <option>Inactivo</option>
                        </select>
                      </Field>
                    </div>
                  </div>

                  {/* Imagen del servicio */}
                  <div className="w-28 shrink-0 sm:w-32">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-1.5">
                      Imagen del servicio
                    </div>
                    <div className="relative">
                      <input
                        ref={bookingFileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file || !onUploadImage) return;
                          setUploadingImg(true);
                          const url = await onUploadImage(file);
                          setUploadingImg(false);
                          if (url) setForm({ ...form, image: url });
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => bookingFileRef.current?.click()}
                        disabled={uploadingImg}
                        className="grid aspect-square w-full place-items-center overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-50"
                      >
                        {form.image ? (
                          <img
                            src={form.image}
                            alt={form.name || "Servicio"}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : uploadingImg ? (
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        ) : (
                          <span className="flex flex-col items-center gap-1 text-muted-foreground/80">
                            <Upload className="h-5 w-5" />
                            <span className="text-[11px]">Subir imagen</span>
                          </span>
                        )}
                      </button>
                      {form.image ? (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, image: "" })}
                          disabled={uploadingImg}
                          className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-red-500 text-white shadow-lg disabled:opacity-50"
                          title="Quitar imagen"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Efectivo:{" "}
                  <span className="font-semibold text-[oklch(0.82_0.14_75)]">
                    ${cashPrice.toLocaleString("es-AR")}
                  </span>
                </p>
              </SectionCard>

              <SectionCard label="Reserva online">
                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <div className="text-sm font-medium">Se puede reservar online</div>
                  <Toggle
                    on={form.reservable}
                    onChange={(v) => setForm({ ...form, reservable: v })}
                  />
                </label>
              </SectionCard>

              <SectionCard label="Descripción">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={cn(inputCls, "min-h-[72px] resize-y")}
                  placeholder="Detalles del servicio (opcional)"
                />
              </SectionCard>
            </>
          ) : (
            <>
              {/* Producto · básica + imagen en una fila */}
              <SectionCard label="Información básica">
                <div className="flex gap-3">
                  <div className="min-w-0 flex-1 space-y-3">
                    <Field label="Nombre">
                      <input
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className={inputCls}
                        placeholder="Nombre del producto"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Precio de lista">
                        <input
                          type="number"
                          value={form.price}
                          onChange={(e) => setForm({ ...form, price: e.target.value })}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Desc. efectivo (%)">
                        <input
                          type="number"
                          value={form.discount}
                          onChange={(e) => setForm({ ...form, discount: e.target.value })}
                          className={inputCls}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Categoría">
                        <select
                          value={form.category}
                          onChange={(e) => setForm({ ...form, category: e.target.value })}
                          className={inputCls}
                        >
                          {availableCatalogCategories.map((category) => (
                            <option key={category}>{category}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Estado">
                        <select
                          value={form.status}
                          onChange={(e) =>
                            setForm({ ...form, status: e.target.value as PriceForm["status"] })
                          }
                          className={inputCls}
                        >
                          <option>Activo</option>
                          <option>Inactivo</option>
                        </select>
                      </Field>
                    </div>
                  </div>

                  {/* Imagen del producto */}
                  <div className="w-28 shrink-0 sm:w-32">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-1.5">
                      Imagen del producto
                    </div>
                    <div className="relative">
                      <input
                        ref={bookingFileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file || !onUploadImage) return;
                          setUploadingImg(true);
                          const url = await onUploadImage(file);
                          setUploadingImg(false);
                          if (url) setForm({ ...form, image: url });
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => bookingFileRef.current?.click()}
                        disabled={uploadingImg}
                        className="grid aspect-square w-full place-items-center overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-50"
                      >
                        {form.image ? (
                          <img
                            src={form.image}
                            alt={form.name || "Producto"}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : uploadingImg ? (
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        ) : (
                          <span className="flex flex-col items-center gap-1 text-muted-foreground/80">
                            <Upload className="h-5 w-5" />
                            <span className="text-[11px]">Subir imagen</span>
                          </span>
                        )}
                      </button>
                      {form.image ? (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, image: "" })}
                          disabled={uploadingImg}
                          className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-red-500 text-white shadow-lg disabled:opacity-50"
                          title="Quitar imagen"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Efectivo:{" "}
                  <span className="font-semibold text-[oklch(0.82_0.14_75)]">
                    ${cashPrice.toLocaleString("es-AR")}
                  </span>
                </p>
              </SectionCard>

              {/* Reservas online */}
              <SectionCard label="Reservas online">
                <div className="space-y-3">
                  {(() => {
                    const featuredTotal = featuredOthers + (form.bookingShow ? 1 : 0);
                    const limitReached = !form.bookingShow && featuredOthers >= 3;
                    return (
                      <>
                        <label className="flex items-center justify-between gap-4 cursor-pointer">
                          <div>
                            <div className="text-sm font-medium">Mostrar en reservas online</div>
                            <div className="text-xs text-muted-foreground">Aparece en reserva online.</div>
                          </div>
                          <Toggle
                            on={form.bookingShow}
                            onChange={(v) => {
                              if (v && limitReached) return;
                              setForm({ ...form, bookingShow: v });
                            }}
                          />
                        </label>
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                          <span className="font-medium text-muted-foreground">
                            Productos destacados: {featuredTotal} de 3
                          </span>
                          {limitReached ? (
                            <span className="text-amber-300">Solo podés destacar hasta 3 productos.</span>
                          ) : null}
                        </div>
                      </>
                    );
                  })()}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Oferta %">
                      <input
                        type="number"
                        min={0}
                        max={90}
                        value={form.bookingOffer === "none" || form.bookingOffer === "special" ? "" : form.bookingOffer}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            bookingOffer: e.target.value.trim() ? e.target.value : "none",
                          })
                        }
                        className={inputCls}
                        placeholder="20"
                      />
                    </Field>
                    <Field label="Mini descripción">
                      <input
                        value={form.miniDesc}
                        onChange={(e) => setForm({ ...form, miniDesc: e.target.value })}
                        className={inputCls}
                        maxLength={60}
                        placeholder="Fijación fuerte y acabado mate natural."
                      />
                    </Field>
                  </div>
                </div>
              </SectionCard>

              {/* Stock compacto */}
              <SectionCard label="Stock">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">Actual</div>
                    <input
                      type="number"
                      value={form.stock}
                      onChange={(e) => setForm({ ...form, stock: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-amber-300/80">Aviso</div>
                    <input
                      type="number"
                      value={form.warnStock}
                      onChange={(e) => setForm({ ...form, warnStock: e.target.value })}
                      className={cn(inputCls, "ring-1 ring-amber-400/20 focus:ring-amber-400/40")}
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-red-400/80">Crítico</div>
                    <input
                      type="number"
                      value={form.criticalStock}
                      onChange={(e) => setForm({ ...form, criticalStock: e.target.value })}
                      className={cn(inputCls, "ring-1 ring-red-500/20 focus:ring-red-500/40")}
                    />
                  </div>
                </div>
              </SectionCard>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-white/5">
          {mode === "edit" && onDelete && (
          <button
            onClick={onDelete}
            disabled={saving}
            className="rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 ring-1 ring-red-500/20 px-4 py-2.5 text-sm">
            Eliminar
          </button>)}
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-4 py-2.5 text-sm">
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex-1 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-4 py-2.5 text-sm disabled:opacity-50"
          >
            {saving
              ? "Guardando…"
              : `Guardar ${isService ? "servicio" : "producto"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function PriceCatalogSection({ kind }: { kind: "servicios" | "catalogo" }) {
  const isService = kind === "servicios";
  const { businessId } = useAuth();
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [serviceReservableMap, setServiceReservableMap] = useState<
    Record<string, boolean>
  >({});
  // Reservas online del catálogo: { [productId]: { show, offer, miniDesc } }
  const [bookingConfig, setBookingConfig] = useState<
    Record<string, { show: boolean; offer: string; miniDesc?: string }>
  >({});
  // Imagen general por item (servicios y productos): { [id]: url }
  const [imageMap, setImageMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<string>(isService ? "Servicios" : "Productos");
  const reorderingCategories = true;
  const [draggedCategory, setDraggedCategory] = useState<string | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PriceRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PriceForm>(
    emptyPriceForm(isService ? "Servicios" : "Productos", isService),
  );
  const [confirmDelItem, setConfirmDelItem] = useState<PriceRow | null>(null);
  // Pending changes — written to Supabase only when global Save is pressed
  type PendingItem = {
    tempId: string;
    payload: Record<string, unknown>;
    isNew: boolean;
  };
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [confirmDelCat, setConfirmDelCat] = useState<string | null>(null);
  const [customCatalogCategories, setCustomCatalogCategories] = useState<
    string[]
  >(defaultCatalogCategories);
  const [customServiceCategories, setCustomServiceCategories] = useState<
    string[]
  >(defaultServiceCategories);

  // Load categories from Supabase schedule._categories
  useEffect(() => {
    if (!businessId) return;
    supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
        const cats = (schedule._categories ?? {}) as Record<string, unknown>;
        const visibility = getPublicVisibility(schedule);
        if (isService) {
          setServiceReservableMap(
            normalizePublicBooleanMap(
              visibility.services ?? schedule._serviceReservable,
            ),
          );
          if (Array.isArray(cats.service))
            setCustomServiceCategories(cats.service as string[]);
        }
        if (!isService && Array.isArray(cats.catalog))
          setCustomCatalogCategories(cats.catalog as string[]);
        {
          const imgs = (schedule._catalogImages ?? {}) as Record<string, unknown>;
          const imgMap: Record<string, string> = {};
          for (const [pid, url] of Object.entries(imgs)) {
            if (pid.trim() && typeof url === "string" && url) imgMap[pid] = url;
          }
          setImageMap(imgMap);
        }
        if (!isService) {
          const bp = (schedule._bookingProducts ?? {}) as Record<
            string,
            unknown
          >;
          const cfg = (bp.config ?? {}) as Record<string, unknown>;
          const normalized: Record<
            string,
            { show: boolean; offer: string; miniDesc?: string }
          > = {};
          for (const [pid, value] of Object.entries(cfg)) {
            if (!pid.trim()) continue;
            const v = (value ?? {}) as Record<string, unknown>;
            normalized[pid] = {
              show: v.show === true,
              offer: typeof v.offer === "string" ? v.offer : "none",
              miniDesc: typeof v.miniDesc === "string" ? v.miniDesc : "",
            };
          }
          setBookingConfig(normalized);
        }
      });
  }, [businessId, isService]);

  // Save categories to Supabase (called by global save)
  const persistCategories = useCallback(async () => {
    if (!businessId) return;
    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    const existingSchedule = (existingRow?.schedule ?? {}) as Record<
      string,
      unknown
    >;
    const existingCats = (existingSchedule._categories ?? {}) as Record<
      string,
      unknown
    >;
    const updatedCats = isService
      ? { ...existingCats, service: customServiceCategories }
      : { ...existingCats, catalog: customCatalogCategories };
    await supabase
      .from("business_settings")
      .upsert(
        {
          business_id: businessId,
          schedule: { ...existingSchedule, _categories: updatedCats },
        },
        { onConflict: "business_id" },
      );
  }, [businessId, isService, customServiceCategories, customCatalogCategories]);

  // Local-only category update (no Supabase until global save)
  const saveCategories = useCallback(
    (next: string[], type: "catalog" | "service") => {
      const clean = Array.from(
        new Set(next.map((c) => c.trim()).filter(Boolean)),
      );
      if (type === "service") {
        setCustomServiceCategories(
          clean.length ? clean : defaultServiceCategories,
        );
      } else {
        setCustomCatalogCategories(
          clean.length ? clean : defaultCatalogCategories,
        );
      }
      markSettingsDirty();
    },
    [isService],
  );

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("price_catalog")
      .select("id,name,price,duration_min,category,active,stock,cash_discount")
      .eq("business_id", businessId)
      .order("category")
      .order("name");
    if (error) toast.error("Error: " + error.message);
    setRows((data ?? []) as PriceRow[]);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!businessId) return;

    const onCatalogStockSaved = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        { productId?: string; stock?: number } | undefined;

      if (detail?.productId && typeof detail.stock === "number") {
        setRows((prev) =>
          prev.map((row) =>
            row.id === detail.productId ? { ...row, stock: detail.stock } : row,
          ),
        );
        return;
      }

      load();
    };

    window.addEventListener("clippr:catalog-stock-saved", onCatalogStockSaved);

    const channel = supabase
      .channel(`settings_price_catalog_${businessId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "price_catalog",
          filter: `business_id=eq.${businessId}`,
        },
        () => load(),
      )
      .subscribe();

    return () => {
      window.removeEventListener(
        "clippr:catalog-stock-saved",
        onCatalogStockSaved,
      );
      supabase.removeChannel(channel);
    };
  }, [businessId, load]);

  // Global Save: persist pending + categories + show toast
  const persistCategoriesRef = useRef(persistCategories);
  useEffect(() => {
    persistCategoriesRef.current = persistCategories;
  }, [persistCategories]);
  const pendingItemsRef = useRef(pendingItems);
  const pendingDeletesRef = useRef(pendingDeletes);
  const serviceReservableMapRef = useRef(serviceReservableMap);
  const bookingConfigRef = useRef(bookingConfig);
  const rowsRef = useRef(rows);
  const imageMapRef = useRef(imageMap);
  useEffect(() => {
    bookingConfigRef.current = bookingConfig;
  }, [bookingConfig]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useEffect(() => {
    imageMapRef.current = imageMap;
  }, [imageMap]);
  useEffect(() => {
    pendingItemsRef.current = pendingItems;
  }, [pendingItems]);
  useEffect(() => {
    pendingDeletesRef.current = pendingDeletes;
  }, [pendingDeletes]);
  useEffect(() => {
    serviceReservableMapRef.current = serviceReservableMap;
  }, [serviceReservableMap]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const section = (e as CustomEvent).detail?.section;
      const mySection = isService ? "servicios" : "catalogo";
      if (!section || section === mySection) {
        const items = pendingItemsRef.current;
        const deletes = pendingDeletesRef.current;
        const errors: string[] = [];

        let nextServiceReservableMap = { ...serviceReservableMapRef.current };
        const nextBookingConfig = { ...bookingConfigRef.current };
        const nextImageMap = { ...imageMapRef.current };
        const tempIdToReal: Record<string, string> = {};

        // Flush deletes
        for (const id of deletes) {
          const { error } = await supabase
            .from("price_catalog")
            .delete()
            .eq("id", id);
          if (error) errors.push(error.message);
          if (isService) delete nextServiceReservableMap[id];
          else delete nextBookingConfig[id];
          delete nextImageMap[id];
        }

        // Flush upserts
        for (const { tempId, payload, isNew } of items) {
          if (isNew) {
            const { data: inserted, error } = await supabase
              .from("price_catalog")
              .insert(payload)
              .select("id")
              .single();
            if (error || !inserted) {
              errors.push(error?.message ?? "No se pudo crear el servicio");
            } else if (isService) {
              const realId = String(inserted.id);
              const reservable = nextServiceReservableMap[tempId] !== false;
              delete nextServiceReservableMap[tempId];
              nextServiceReservableMap[realId] = reservable;
              tempIdToReal[tempId] = realId;
              if (nextImageMap[tempId]) {
                nextImageMap[realId] = nextImageMap[tempId];
                delete nextImageMap[tempId];
              }
            } else {
              const realId = String(inserted.id);
              tempIdToReal[tempId] = realId;
              if (nextBookingConfig[tempId]) {
                nextBookingConfig[realId] = nextBookingConfig[tempId];
                delete nextBookingConfig[tempId];
              }
              if (nextImageMap[tempId]) {
                nextImageMap[realId] = nextImageMap[tempId];
                delete nextImageMap[tempId];
              }
            }
          } else {
            const { error } = await supabase
              .from("price_catalog")
              .update(payload)
              .eq("id", tempId);
            if (error) errors.push(error.message);
          }
        }

        // Imagen general por item: se guarda en schedule._catalogImages.
        // Cada instancia (servicios/productos) solo toca sus propios ids y
        // preserva los de la otra para evitar pisarse al guardar.
        const ownImageIds = () => {
          const ids = new Set<string>();
          for (const r of rowsRef.current) {
            const category = (
              r.category || (isService ? "Servicios" : "Productos")
            ).toLowerCase();
            const mine = isService
              ? r.duration_min != null
              : r.duration_min == null && !category.includes("servicio");
            if (mine) ids.add(tempIdToReal[r.id] ?? r.id);
          }
          for (const id of deletes) ids.add(id);
          return ids;
        };
        const mergeCatalogImages = (
          existingSchedule: Record<string, unknown>,
        ): Record<string, string> => {
          const existing = (existingSchedule._catalogImages ?? {}) as Record<
            string,
            unknown
          >;
          const ids = ownImageIds();
          const merged: Record<string, string> = {};
          for (const [k, v] of Object.entries(existing)) {
            if (!ids.has(k) && typeof v === "string" && v) merged[k] = v;
          }
          for (const id of ids) {
            const url = nextImageMap[id];
            if (url) merged[id] = url;
          }
          return merged;
        };

        imageMapRef.current = nextImageMap;
        setImageMap(nextImageMap);

        if (isService && businessId) {
          serviceReservableMapRef.current = nextServiceReservableMap;
          setServiceReservableMap(nextServiceReservableMap);
          const { data: existingRow } = await supabase
            .from("business_settings")
            .select("schedule")
            .eq("business_id", businessId)
            .maybeSingle();
          const existingSchedule = (existingRow?.schedule ?? {}) as Record<
            string,
            unknown
          >;
          const visibility = getPublicVisibility(existingSchedule);
          await supabase.from("business_settings").upsert(
            {
              business_id: businessId,
              schedule: {
                ...existingSchedule,
                _catalogImages: mergeCatalogImages(existingSchedule),
                _publicVisibility: {
                  ...visibility,
                  services: nextServiceReservableMap,
                },
              },
            },
            { onConflict: "business_id" },
          );
        }

        if (!isService && businessId) {
          bookingConfigRef.current = nextBookingConfig;
          setBookingConfig(nextBookingConfig);

          // Snapshot de recomendados: respeta el orden actual del Catálogo,
          // toma los primeros 3 productos activos con "Mostrar en reservas
          // online". Se guarda nombre/precio/oferta para que la reserva pública
          // (anon) los lea desde business_settings sin acceder a price_catalog.
          const orderedProducts = rowsRef.current.filter((r) => {
            const category = (r.category || "Productos").toLowerCase();
            return r.duration_min == null && !category.includes("servicio");
          });
          const recommended = orderedProducts
            .map((r) => ({ row: r, id: tempIdToReal[r.id] ?? r.id }))
            .filter(
              ({ id, row }) =>
                row.active !== false && nextBookingConfig[id]?.show === true,
            )
            .slice(0, 3)
            .map(({ id, row }) => ({
              id,
              name: row.name,
              price: Number(row.price) || 0,
              offer: nextBookingConfig[id]?.offer ?? "none",
              image: nextImageMap[id] ?? "",
              description: nextBookingConfig[id]?.miniDesc ?? "",
            }));

          const { data: existingRow } = await supabase
            .from("business_settings")
            .select("schedule")
            .eq("business_id", businessId)
            .maybeSingle();
          const existingSchedule = (existingRow?.schedule ?? {}) as Record<
            string,
            unknown
          >;
          await supabase.from("business_settings").upsert(
            {
              business_id: businessId,
              schedule: {
                ...existingSchedule,
                _catalogImages: mergeCatalogImages(existingSchedule),
                _bookingProducts: {
                  config: nextBookingConfig,
                  recommended,
                },
              },
            },
            { onConflict: "business_id" },
          );
        }

        await persistCategoriesRef.current();

        if (errors.length > 0) {
          toast.error("Error guardando: " + errors[0]);
        } else {
          setPendingItems([]);
          setPendingDeletes(new Set());
          window.dispatchEvent(new CustomEvent("clippr:catalog-stock-saved"));
          toast.success(
            isService
              ? "Servicios guardados correctamente"
              : "Catálogo guardado correctamente",
          );
          load();
        }
      }
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, [isService]);

  const visibleRows = rows.filter((row) => {
    const category = (row.category || "Productos").toLowerCase();
    if (isService) return row.duration_min != null;
    return row.duration_min == null && !category.includes("servicio");
  });
  const categories = isService
    ? Array.from(
        new Set([
          ...customServiceCategories,
          ...visibleRows.map((r) => r.category || "Servicios"),
        ]),
      )
    : Array.from(
        new Set([
          ...customCatalogCategories,
          ...visibleRows.map((r) => r.category || "Productos"),
        ]),
      );
  const filtered = visibleRows.filter(
    (r) => (r.category || (isService ? "Servicios" : "Productos")) === cat,
  );

  async function uploadBookingImage(file: File): Promise<string | null> {
    if (!businessId) {
      toast.error("No se encontró el negocio");
      return null;
    }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${businessId}/catalog/booking/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("business-assets")
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (error) {
      toast.error("No se pudo subir la imagen: " + error.message);
      return null;
    }
    const { data: urlData } = supabase.storage
      .from("business-assets")
      .getPublicUrl(path);
    return urlData.publicUrl ? `${urlData.publicUrl}?v=${Date.now()}` : null;
  }

  function openNew() {
    setEditing(null);
    setForm(emptyPriceForm(cat, isService));
    setModalOpen(true);
  }

  function openEdit(row: PriceRow) {
    setEditing(row);
    const cfg = bookingConfig[row.id];
    setForm({
      ...rowToForm(row, isService),
      reservable: isService ? serviceReservableMap[row.id] !== false : true,
      bookingShow: !isService && cfg?.show === true,
      bookingOffer: !isService ? cfg?.offer ?? "none" : "none",
      miniDesc: !isService ? cfg?.miniDesc ?? "" : "",
      image: imageMap[row.id] ?? "",
    });
    setModalOpen(true);
  }

  function saveItem() {
    if (!businessId) return toast.error("No se encontró el negocio");
    if (!form.name.trim()) return toast.error("Ingresá un nombre");
    const payload: Record<string, unknown> = {
      business_id: businessId,
      name: form.name.trim(),
      price: Number(form.price) || 0,
      cash_discount: Number(form.discount) || 0,
      category: form.category,
      active: form.status === "Activo",
      duration_min: isService ? Number(form.duration) || 30 : null,
    };
    if (!isService) payload.stock = Number(form.stock) || 0;

    if (editing) {
      if (isService)
        setServiceReservableMap((current) => ({
          ...current,
          [editing.id]: form.reservable,
        }));
      else
        setBookingConfig((current) => ({
          ...current,
          [editing.id]: {
            show: form.bookingShow,
            offer: Number(form.bookingOffer) > 0 ? String(Number(form.bookingOffer)) : "none",
            miniDesc: form.miniDesc,
          },
        }));
      setImageMap((current) => {
        const next = { ...current };
        if (form.image) next[editing.id] = form.image;
        else delete next[editing.id];
        return next;
      });
      // Update existing row locally
      setRows((prev) =>
        prev.map((r) =>
          r.id === editing.id ? ({ ...r, ...payload } as PriceRow) : r,
        ),
      );
      setPendingItems((prev) => {
        const next = prev.filter((p) => p.tempId !== editing.id);
        return [
          ...next,
          { tempId: editing.id, payload: { ...payload }, isNew: false },
        ];
      });
    } else {
      // New row — temp negative id until saved
      const tempId = `new_${Date.now()}`;
      if (isService)
        setServiceReservableMap((current) => ({
          ...current,
          [tempId]: form.reservable,
        }));
      else
        setBookingConfig((current) => ({
          ...current,
          [tempId]: {
            show: form.bookingShow,
            offer: Number(form.bookingOffer) > 0 ? String(Number(form.bookingOffer)) : "none",
            miniDesc: form.miniDesc,
          },
        }));
      if (form.image)
        setImageMap((current) => ({ ...current, [tempId]: form.image }));
      setRows((prev) => [...prev, { id: tempId, ...payload } as PriceRow]);
      setPendingItems((prev) => [
        ...prev,
        { tempId, payload: { ...payload }, isNew: true },
      ]);
    }
    setModalOpen(false);
    markSettingsDirty();

    // Persistencia inmediata: "Guardar producto" debe quedar guardado aunque el usuario recargue la página.
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("clippr:save-settings", {
          detail: { section: isService ? "servicios" : "catalogo" },
        }),
      );
    }, 150);
  }

  function toggle(row: PriceRow) {
    const newActive = !row.active;
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, active: newActive } : r)),
    );
    setPendingItems((prev) => {
      const existing = prev.find((p) => p.tempId === row.id);
      if (existing)
        return prev.map((p) =>
          p.tempId === row.id
            ? { ...p, payload: { ...p.payload, active: newActive } }
            : p,
        );
      return [
        ...prev,
        { tempId: row.id, payload: { active: newActive }, isNew: false },
      ];
    });
    markSettingsDirty();
  }

  async function remove(row: PriceRow) {
    setConfirmDelItem(row);
  }

  async function doRemoveItem() {
    if (!confirmDelItem) return;
    const row = confirmDelItem;
    setConfirmDelItem(null);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    if (isService)
      setServiceReservableMap((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    else
      setBookingConfig((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    setImageMap((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    // If it was a new (unsaved) item, just remove from pending
    if (row.id.startsWith("new_")) {
      setPendingItems((prev) => prev.filter((p) => p.tempId !== row.id));
    } else {
      setPendingItems((prev) => prev.filter((p) => p.tempId !== row.id));
      setPendingDeletes((prev) => new Set([...prev, row.id]));
    }
    setEditing(null);
    setModalOpen(false);
    toast.success(isService ? "Servicio eliminado" : "Producto eliminado");
    markSettingsDirty();
  }

  function reorderItem(row: PriceRow, direction: "up" | "down") {
    const catRows = filtered;
    const idx = catRows.findIndex((r) => r.id === row.id);
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === catRows.length - 1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const swapRow = catRows[swapIdx];
    setRows((prev) => {
      const arr = [...prev];
      const i = arr.findIndex((r) => r.id === row.id);
      const j = arr.findIndex((r) => r.id === swapRow.id);
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
    markSettingsDirty();
  }

  function reorderItemToTarget(sourceId: string | null, targetId: string) {
    if (!sourceId || sourceId === targetId) return;
    const source = rows.find((r) => r.id === sourceId);
    const target = rows.find((r) => r.id === targetId);
    if (!source || !target || source.category !== target.category) return;

    setRows((prev) => {
      const categoryRows = prev.filter((r) => r.category === target.category);
      const otherRows = prev.filter((r) => r.category !== target.category);
      const nextCategoryRows = [...categoryRows];
      const from = nextCategoryRows.findIndex((r) => r.id === sourceId);
      const to = nextCategoryRows.findIndex((r) => r.id === targetId);
      if (from < 0 || to < 0) return prev;
      const [moved] = nextCategoryRows.splice(from, 1);
      nextCategoryRows.splice(to, 0, moved);
      return [...otherRows, ...nextCategoryRows];
    });
    markSettingsDirty();
  }

  // Inline input modal for add/rename category (avoids browser prompt())
  const [catModal, setCatModal] = useState<{
    mode: "add" | "rename";
    current?: string;
  } | null>(null);
  const [catInputVal, setCatInputVal] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!addMenuOpen) return;

    function handleAddMenuOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (addMenuRef.current && !addMenuRef.current.contains(target)) {
        setAddMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleAddMenuOutsideClick, true);
    return () =>
      document.removeEventListener("pointerdown", handleAddMenuOutsideClick, true);
  }, [addMenuOpen]);


  function addCategory() {
    setCatInputVal("");
    setCatModal({ mode: "add" });
  }

  async function renameCategory(category: string) {
    setCatInputVal(category);
    setCatModal({ mode: "rename", current: category });
  }

  function reorderCategory(fromCategory: string, toCategory: string) {
    if (!fromCategory || !toCategory || fromCategory === toCategory) return;
    const list = [...categories];
    const fromIndex = list.findIndex((c) => c === fromCategory);
    const toIndex = list.findIndex((c) => c === toCategory);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    saveCategories(list, isService ? "service" : "catalog");
    setCat(fromCategory);
  }

  async function submitCatModal() {
    const clean = catInputVal.trim();
    if (!clean) {
      setCatModal(null);
      return;
    }
    if (catModal?.mode === "add") {
      if (isService)
        saveCategories([...customServiceCategories, clean], "service");
      else saveCategories([...customCatalogCategories, clean], "catalog");
      setCat(clean);
    } else if (catModal?.mode === "rename" && catModal.current) {
      const category = catModal.current;
      if (clean !== category) {
        if (isService) {
          const next = customServiceCategories.includes(category)
            ? customServiceCategories.map((c) => (c === category ? clean : c))
            : [...customServiceCategories, clean];
          saveCategories(next, "service");
        } else {
          const next = customCatalogCategories.includes(category)
            ? customCatalogCategories.map((c) => (c === category ? clean : c))
            : [...customCatalogCategories, clean];
          saveCategories(next, "catalog");
        }
        if (businessId) {
          await supabase
            .from("price_catalog")
            .update({ category: clean })
            .eq("business_id", businessId)
            .eq("category", category);
        }
        setCat(clean);
        toast.success("Categoría actualizada");
        load();
      }
    }
    setCatModal(null);
  }

  async function deleteCategory(category: string) {
    setConfirmDelCat(category);
  }

  async function doDeleteCategory() {
    if (!confirmDelCat) return;
    const category = confirmDelCat;
    setConfirmDelCat(null);
    const currentCategories = categories.filter((c) => c !== category);
    if (currentCategories.length === 0)
      return toast.error("Debe quedar al menos una categoría");
    const targetCategory = currentCategories[0];
    if (isService)
      saveCategories(
        customServiceCategories.filter((c) => c !== category),
        "service",
      );
    else
      saveCategories(
        customCatalogCategories.filter((c) => c !== category),
        "catalog",
      );
    if (businessId) {
      await supabase
        .from("price_catalog")
        .update({ category: targetCategory })
        .eq("business_id", businessId)
        .eq("category", category);
    }
    setCat(targetCategory);
    toast.success("Categoría eliminada");
    markSettingsDirty();
    load();
  }

  return (
    <>
      <div>
        <h2 className="text-xl font-display font-semibold">
          {isService ? "Servicios" : "Catálogo"}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {isService ? "Servicios que ofrecés." : "Productos para la venta."}
        </p>
      </div>

      <div className="glass overflow-visible rounded-2xl ring-1 ring-white/5">
        <div className="relative flex items-center gap-1 px-3 pt-3 pr-1 border-b border-white/5 overflow-visible">
          {categories.map((category) => {
            const active = category === cat;
            return (
              <div
                key={category}
                draggable
                onDragStart={(event) => {
                  setDraggedCategory(category);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  reorderCategory(draggedCategory ?? "", category);
                  setDraggedCategory(null);
                }}
                onDragEnd={() => setDraggedCategory(null)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-t-lg transition-colors whitespace-nowrap",
                  "cursor-grab active:cursor-grabbing",
                  active
                    ? "bg-white/5 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                  draggedCategory === category && "opacity-50",
                )}
              >
                <button
                  type="button"
                  onClick={() => setCat(category)}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm select-none"
                >
                  <GripVertical className="h-4 w-4 text-white/40" />
                  <span>{category}</span>
                </button>
                {categories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => deleteCategory(category)}
                    className="grid h-6 w-6 place-items-center rounded-md pr-1 text-red-300/70 transition hover:bg-red-500/10 hover:text-red-300"
                    title="Eliminar categoría"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          <div className="ml-auto flex shrink-0 items-center justify-end pl-4 pr-0">
            <div ref={addMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setAddMenuOpen((open) => !open)}
                className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white shadow-[0_8px_24px_-10px_rgba(56,189,248,0.75)] transition hover:opacity-95"
                aria-label="Agregar"
              >
                <Plus className="h-4.5 w-4.5" strokeWidth={2.5} />
              </button>

              {addMenuOpen ? (
                <div className="absolute right-0 top-10 z-30 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[oklch(0.13_0.035_275/0.98)] p-1.5 shadow-2xl backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setAddMenuOpen(false);
                      addCategory();
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                  >
                    <Plus className="h-4 w-4 text-sky-300" />
                    Nueva categoría
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddMenuOpen(false);
                      openNew();
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                  >
                    <Plus className="h-4 w-4 text-violet-300" />
                    Nuevo servicio
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Cargando…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No hay ítems en esta sección.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filtered.map((row) => (
              <div
                key={row.id}
                draggable
                onDragStart={(event) => {
                  setDraggedItemId(row.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  reorderItemToTarget(draggedItemId, row.id);
                  setDraggedItemId(null);
                }}
                onDragEnd={() => setDraggedItemId(null)}
                className={cn(
                  "flex cursor-grab items-center gap-3 px-5 py-3 transition active:cursor-grabbing",
                  draggedItemId === row.id && "opacity-50",
                )}
              >
                <GripVertical className="h-4 w-4 shrink-0 text-white/35" />
                <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.72_0.2_245)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{row.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {row.duration_min ? `${row.duration_min} min` : ""}
                    {typeof row.stock === "number" && !isService
                      ? `Stock: ${row.stock}`
                      : ""}
                  </div>
                </div>

                {!isService && bookingConfig[row.id]?.show && (
                  <span className="mx-2 inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-500/12 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-200 ring-1 ring-violet-400/25">
                    <Star className="h-3 w-3 fill-current" />
                    Online
                  </span>
                )}

                <div className="text-right shrink-0">
                  <div className="font-display text-sm font-semibold text-[oklch(0.82_0.14_75)]">
                    ${Number(row.price).toLocaleString("es-AR")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(row)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full ring-1 px-2 py-0.5 text-[10px] uppercase tracking-wider transition hover:brightness-110",
                    row.active !== false
                      ? "bg-[oklch(0.78_0.17_140/0.12)] ring-[oklch(0.78_0.17_140/0.3)] text-[oklch(0.85_0.17_140)]"
                      : "bg-white/5 ring-white/10 text-muted-foreground hover:bg-white/10",
                  )}
                  title={row.active !== false ? "Desactivar" : "Activar"}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      row.active !== false
                        ? "bg-[oklch(0.78_0.17_140)]"
                        : "bg-muted-foreground",
                    )}
                  />{" "}
                  {row.active !== false ? "Activo" : "Inactivo"}
                </button>
                <button
                  onClick={() => openEdit(row)}
                  className="rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-3 py-1.5 text-xs"
                >
                  Editar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <PriceEditorModal
        open={modalOpen}
        mode={editing ? "edit" : "new"}
        isService={isService}
        form={form}
        setForm={setForm}
        onClose={() => setModalOpen(false)}
        onSave={saveItem}
        onDelete={() => editing && setConfirmDelItem(editing)}
        saving={saving}
        catalogCategories={categories}
        onUploadImage={uploadBookingImage}
        featuredOthers={
          Object.entries(bookingConfig).filter(
            ([id, c]) => c.show && id !== editing?.id,
          ).length
        }
      />
      <ConfirmDialog
        open={!!confirmDelItem}
        title={isService ? "Eliminar servicio" : "Eliminar producto"}
        message={`¿Deseás eliminar "${confirmDelItem?.name}"?`}
        onConfirm={doRemoveItem}
        onCancel={() => setConfirmDelItem(null)}
      />
      <ConfirmDialog
        open={!!confirmDelCat}
        title="Eliminar categoría"
        message={`¿Deseás eliminar la categoría "${confirmDelCat}"? Los ítems se moverán a la primera categoría disponible.`}
        onConfirm={doDeleteCategory}
        onCancel={() => setConfirmDelCat(null)}
      />
      {/* Category name input modal */}
      {catModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass rounded-2xl p-6 max-w-sm w-full mx-4 ring-1 ring-white/10 space-y-4">
            <div className="font-display font-semibold text-base">
              {catModal.mode === "add"
                ? "Nueva categoría"
                : "Renombrar categoría"}
            </div>
            <input
              autoFocus
              value={catInputVal}
              onChange={(e) => setCatInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCatModal();
                if (e.key === "Escape") setCatModal(null);
              }}
              placeholder="Nombre de la categoría"
              className="w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-4 py-2.5 text-sm focus:outline-none focus:ring-primary/40"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setCatModal(null)}
                className="px-4 py-2 rounded-xl text-sm bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition"
              >
                Cancelar
              </button>
              <button
                onClick={submitCatModal}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-sky-400 to-violet-500 text-white transition"
              >
                {catModal.mode === "add" ? "Agregar" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ServiciosSection() {
  return <PriceCatalogSection kind="servicios" />;
}

function CatalogoSection() {
  return <PriceCatalogSection kind="catalogo" />;
}

// ─────────── Caja ───────────


function CuentaSection() {
  const BASE_PRICE = 10000;
  const INCLUDED_PROS = 1;
  const INCLUDED_BRANCHES = 1;
  const EXTRA_PRO_PRICE = 3500;
  const EXTRA_BRANCH_PRICE = 8000;

  const [professionals, setProfessionals] = useState(1);
  const [branches, setBranches] = useState(1);

  const extraPros = Math.max(0, professionals - INCLUDED_PROS);
  const extraBranches = Math.max(0, branches - INCLUDED_BRANCHES);
  const prosTotal = extraPros * EXTRA_PRO_PRICE;
  const branchesTotal = extraBranches * EXTRA_BRANCH_PRICE;
  const monthlyTotal = BASE_PRICE + prosTotal + branchesTotal;
  const renewalDate = new Date(2026, 6, 29);
  const today = new Date();
  const billingCycleDays = 30;
  const daysRemaining = Math.max(
    0,
    Math.min(
      billingCycleDays,
      Math.ceil((renewalDate.getTime() - today.getTime()) / 86_400_000),
    ),
  );
  const prorationRatio = daysRemaining / billingCycleDays;
  const todayProsProration = Math.round(prosTotal * prorationRatio);
  const todayBranchesProration = Math.round(branchesTotal * prorationRatio);
  const todayTotal = todayProsProration + todayBranchesProration;

  const money = (value: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(value);

  const included = [
    "Agenda",
    "Caja",
    "Clientes",
    "Reservas online",
    "Perfil público",
    "Asesor IA",
    "Inventario",
    "Roles y permisos",
    "Marketing",
    "Reportes",
    "Todas las futuras funciones",
  ];

  const payments = [
    ["Junio 2026", monthlyTotal, "Pagado"],
    ["Mayo 2026", monthlyTotal, "Pagado"],
    ["Abril 2026", Math.max(BASE_PRICE, monthlyTotal - EXTRA_BRANCH_PRICE), "Pagado"],
  ] as const;

  function CounterCard({
    title,
    subtitle,
    value,
    onMinus,
    onPlus,
    priceLabel,
  }: {
    title: string;
    subtitle: string;
    value: number;
    onMinus: () => void;
    onPlus: () => void;
    priceLabel: string;
  }) {
    return (
      <div className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
          </div>
          <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-xs font-semibold text-white/70 ring-1 ring-white/10">
            Incluye 1
          </span>
        </div>

        <div className="mt-5 flex items-center justify-between rounded-2xl bg-white/[0.035] p-2 ring-1 ring-white/10">
          <button
            type="button"
            onClick={onMinus}
            className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-lg font-semibold ring-1 ring-white/10 transition hover:bg-white/[0.09]"
          >
            −
          </button>
          <div className="text-center">
            <div className="text-3xl font-display font-semibold">{value}</div>
            <div className="text-[11px] text-muted-foreground">total</div>
          </div>
          <button
            type="button"
            onClick={onPlus}
            className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-lg font-semibold text-white shadow-[0_10px_30px_-14px_rgba(56,189,248,0.8)] transition hover:opacity-95"
          >
            +
          </button>
        </div>

        <div className="mt-4 rounded-2xl bg-white/[0.025] px-4 py-3 text-sm text-muted-foreground ring-1 ring-white/8">
          {priceLabel}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-display font-semibold">Cuenta</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Suscripción, facturación y estado de tu cuenta.
        </p>
      </div>

      <div className="glass relative overflow-hidden rounded-3xl p-5 ring-1 ring-white/10">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-sky-400/14 blur-3xl" />
        <div className="pointer-events-none absolute -left-24 -bottom-24 h-64 w-64 rounded-full bg-violet-500/12 blur-3xl" />

        <div className="relative grid gap-5 lg:grid-cols-[1fr_430px] lg:items-center">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-sky-400/10 text-sky-200 ring-1 ring-sky-300/20">
              <CreditCard className="h-6 w-6" />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Tu suscripción
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h3 className="text-2xl font-display font-semibold">Clippr</h3>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Activa
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Una sola suscripción con todas las funciones. Pagás según la
                cantidad de profesionales y sucursales que necesitás.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white/[0.035] p-4 ring-1 ring-white/10">
              <div className="text-xs text-muted-foreground">Próximo pago</div>
              <div className="mt-1 font-semibold">29 Jul 2026</div>
            </div>
            <div className="rounded-2xl bg-white/[0.035] p-4 ring-1 ring-white/10">
              <div className="text-xs text-muted-foreground">Total mensual</div>
              <div className="mt-1 font-semibold">{money(monthlyTotal)}</div>
            </div>
            <div className="rounded-2xl bg-white/[0.035] p-4 ring-1 ring-white/10">
              <div className="text-xs text-muted-foreground">Pago</div>
              <div className="mt-1 font-semibold">Visa ****4821</div>
            </div>
          </div>
        </div>
      </div>

      <SectionCard label="Personalizá tu plan">
        <div className="grid gap-4 lg:grid-cols-2">
          <CounterCard
            title="Profesionales"
            subtitle="Barberos o miembros del equipo que usan Clippr."
            value={professionals}
            onMinus={() => setProfessionals((value) => Math.max(1, value - 1))}
            onPlus={() => setProfessionals((value) => value + 1)}
            priceLabel={`+ ${money(EXTRA_PRO_PRICE)} por profesional adicional`}
          />

          <CounterCard
            title="Sucursales"
            subtitle="Locales o puntos de atención de tu negocio."
            value={branches}
            onMinus={() => setBranches((value) => Math.max(1, value - 1))}
            onPlus={() => setBranches((value) => value + 1)}
            priceLabel={`+ ${money(EXTRA_BRANCH_PRICE)} por sucursal adicional`}
          />
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard label="Resumen de suscripción">
          <div className="space-y-4">
            <div className="rounded-3xl bg-white/[0.03] p-4 ring-1 ring-white/10">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Nuevo total mensual
              </div>

              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Plan base</span>
                  <span className="font-semibold">{money(BASE_PRICE)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {extraPros} profesionales adicionales
                  </span>
                  <span className="font-semibold">{money(prosTotal)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {extraBranches} sucursales adicionales
                  </span>
                  <span className="font-semibold">{money(branchesTotal)}</span>
                </div>
              </div>

              <div className="mt-4 flex items-end justify-between border-t border-white/10 pt-4">
                <span className="text-sm text-muted-foreground">Total mensual</span>
                <div className="text-right">
                  <div className="text-2xl font-display font-semibold">
                    {money(monthlyTotal)}
                  </div>
                  <div className="text-xs text-muted-foreground">desde la próxima renovación</div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-gradient-to-br from-sky-400/12 to-violet-500/12 p-4 ring-1 ring-sky-300/20">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200/80">
                    Hoy pagarás
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Proporcional por los {daysRemaining} días restantes del período.
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-display font-semibold">
                    {money(todayTotal)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    proporcional
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {extraPros} profesionales · proporcional
                  </span>
                  <span className="font-semibold">{money(todayProsProration)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {extraBranches} sucursales · proporcional
                  </span>
                  <span className="font-semibold">{money(todayBranchesProration)}</span>
                </div>
              </div>

              <p className="mt-4 rounded-2xl bg-black/15 px-3 py-2 text-xs leading-relaxed text-white/60 ring-1 ring-white/10">
                El nuevo valor mensual de {money(monthlyTotal)} comenzará a cobrarse automáticamente en tu próxima renovación.
              </p>
            </div>

            <button
              type="button"
              className="w-full rounded-2xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-95"
            >
              Actualizar suscripción
            </button>
          </div>
        </SectionCard>

        <SectionCard label="Todo incluido">
          <div className="grid gap-2 sm:grid-cols-2">
            {included.map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 rounded-2xl bg-white/[0.03] px-3 py-2 ring-1 ring-white/8"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                <span className="text-sm">{item}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            No existen límites de uso. Solo pagás por el tamaño de tu negocio.
          </p>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <SectionCard label="Facturación">
          <div className="space-y-3">
            {[
              ["Método de pago", "Visa terminada en 4821"],
              ["Próximo cobro", "29 Jul 2026"],
              ["Estado", "Pagos al día"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/8"
              >
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-medium">{value}</span>
              </div>
            ))}

            <button
              type="button"
              className="w-full rounded-2xl bg-white/[0.05] px-4 py-2.5 text-sm font-semibold ring-1 ring-white/10 transition hover:bg-white/[0.09]"
            >
              Cambiar método de pago
            </button>
          </div>
        </SectionCard>

        <SectionCard label="Historial de pagos">
          <div className="overflow-hidden rounded-2xl ring-1 ring-white/10">
            {payments.map(([month, amount, status], index) => (
              <div
                key={month}
                className={cn(
                  "grid grid-cols-[1fr_auto_auto] items-center gap-4 bg-white/[0.025] px-4 py-3 text-sm",
                  index > 0 && "border-t border-white/5",
                )}
              >
                <span className="font-medium">{month}</span>
                <span className="text-muted-foreground">{money(amount)}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/25">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {status}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function CajaSection() {
  const { businessId } = useAuth();
  const defaultMethods = {
    efectivo: true,
    transferencia: true,
    tarjeta: true,
    mp: true,
    cuentaDni: false,
  };
  const [methods, setMethods] = useState(defaultMethods);
  const autoChange = true;
  const [approvalEnabled, setApprovalEnabled] = useState(false);
  const [approvalMode, setApprovalMode] = useState<"auto" | "manual">("auto");

  useEffect(() => {
    if (!businessId) return;
    supabase
      .from("business_settings")
      .select("approval_mode,schedule")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
        const caja = (schedule._caja ?? {}) as Record<string, unknown>;
        if (caja.methods) setMethods(caja.methods as typeof defaultMethods);
      });
  }, [businessId]);

  async function saveCajaSettings(
    nextMethods = methods,
    nextAutoChange = autoChange,
    showToast = true,
  ) {
    if (!businessId) return toast.error("No se encontró el negocio");
    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    const existingSchedule = (existingRow?.schedule ?? {}) as Record<
      string,
      unknown
    >;
    const { error } = await supabase.from("business_settings").upsert(
      {
        business_id: businessId,
        schedule: {
          ...existingSchedule,
          _caja: {
            ...((existingSchedule._caja ?? {}) as Record<string, unknown>),
            methods: nextMethods,
            autoChange: true,
          },
        },
      },
      { onConflict: "business_id" },
    );
    if (error) return toast.error("Error guardando: " + error.message);
    window.dispatchEvent(new CustomEvent("clippr:caja-settings-updated"));
    if (showToast) toast.success("Guardado");
  }

  function updateMethod(methodId: keyof typeof defaultMethods, value: boolean) {
    const nextMethods = { ...methods, [methodId]: value };
    setMethods(nextMethods);
    void saveCajaSettings(nextMethods, autoChange);
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const section = (event as CustomEvent).detail?.section;
      if (!section || section === "caja") void saveCajaSettings(methods, autoChange, false);
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, [methods, autoChange, businessId]);

  const M = [
    {
      id: "efectivo",
      icon: Banknote,
      label: "Efectivo",
      tint: "text-[oklch(0.82_0.14_75)]",
    },
    {
      id: "transferencia",
      icon: Landmark,
      label: "Transferencia bancaria",
      tint: "text-[oklch(0.78_0.17_140)]",
    },
    {
      id: "tarjeta",
      icon: CreditCard,
      label: "Tarjeta débito / crédito",
      tint: "text-[oklch(0.72_0.2_245)]",
    },
    {
      id: "mp",
      icon: Wallet,
      label: "Mercado Pago",
      tint: "text-[oklch(0.72_0.2_245)]",
    },
    {
      id: "cuentaDni",
      icon: PiggyBank,
      label: "Cuenta DNI",
      tint: "text-[oklch(0.7_0.25_300)]",
    },
  ] as const;

  return (
    <>
      <div>
        <h2 className="text-xl font-display font-semibold">Caja</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Cobros y medios de pago.
        </p>
      </div>

      <SectionCard label="Métodos de pago habilitados">
        <div className="divide-y divide-white/5">
          {M.map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.id}
                className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0"
              >
                <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center">
                  <Icon className={cn("h-4.5 w-4.5", m.tint)} />
                </div>
                <div className="flex-1 font-medium text-sm">{m.label}</div>
                <Toggle
                  on={methods[m.id]}
                  onChange={(v) => updateMethod(m.id, v)}
                />
              </div>
            );
          })}
        </div>
      </SectionCard>


    </>
  );
}

// ─────────── Page ───────────

function SenasBlock({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white/[0.02] ring-1 ring-white/[0.06] p-6 space-y-4">
      <div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {subtitle && (
          <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
        )}
      </div>
      {children}
    </div>
  );
}

function SenasToggleBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl px-5 py-2.5 text-sm font-medium ring-1 transition-all",
        active
          ? "bg-primary/20 ring-primary/50 text-foreground shadow-[0_0_16px_-4px_oklch(0.66_0.22_265/0.4)]"
          : "bg-white/[0.03] ring-white/10 text-muted-foreground hover:text-foreground hover:bg-white/[0.05]",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Señas Section
// ---------------------------------------------------------------------------
function SenasSection() {
  const { businessId } = useAuth();
  const [services, setServices] = React.useState<
    {
      id: string;
      name: string;
      category?: string | null;
      price?: number | null;
      duration_min?: number | null;
    }[]
  >([]);
  const [selectedSvcs, setSelectedSvcs] = React.useState<string[]>([]);
  const [amountType, setAmountType] = React.useState<"fixed" | "percent">(
    "fixed",
  );
  const [amountValue, setAmountValue] = React.useState("");
  const [lostDist, setLostDist] = React.useState<"local" | "prof" | "custom">(
    "local",
  );
  const [lostLocal, setLostLocal] = React.useState("100");
  const [lostProf, setLostProf] = React.useState("0");
  const [msg, setMsg] = React.useState(DEFAULT_SENA_MESSAGE);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!businessId) return;
    supabase
      .from("business_settings")
      .select("senas_config")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.senas_config) {
          const c = data.senas_config as Record<string, unknown>;
          setSelectedSvcs((c.services as string[]) ?? []);
          setAmountType((c.amount_type as "fixed" | "percent") ?? "fixed");
          setAmountValue(String(c.amount_value ?? ""));
          setLostDist((c.lost_dist as "local" | "prof" | "custom") ?? "local");
          setLostLocal(String(c.lost_local ?? "100"));
          setLostProf(String(c.lost_prof ?? "0"));
          setMsg(String(c.msg || DEFAULT_SENA_MESSAGE));
        }
        setLoading(false);
      });
    supabase
      .from("price_catalog")
      .select("id,name,category,price,duration_min,active")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("category")
      .order("name")
      .then(({ data, error }) => {
        if (error) {
          toast.error("Error cargando servicios para señas: " + error.message);
          return;
        }

        const servicesOnly = (data ?? []).filter(
          (item) =>
            item.duration_min !== null && item.duration_min !== undefined,
        );

        setServices(
          servicesOnly as {
            id: string;
            name: string;
            category?: string | null;
            price?: number | null;
            duration_min?: number | null;
          }[],
        );
      });
  }, [businessId]);

  const save = React.useCallback(async () => {
    if (!businessId) return;
    const localPct = parseFloat(lostLocal) || 0;
    const typedProfPct = parseFloat(lostProf) || 0;
    const parsedAmount = parseFloat(amountValue) || 0;

    if (lostDist === "custom") {
      const totalPct = Math.round((localPct + typedProfPct) * 10) / 10;
      if (totalPct !== 100) {
        toast.error("La distribución personalizada debe sumar 100%");
        return;
      }
    }

    const profPct =
      lostDist === "custom" ? typedProfPct : lostDist === "prof" ? 100 : 0;
    const { error } = await supabase.from("business_settings").upsert(
      {
        business_id: businessId,
        senas_config: {
          enabled: selectedSvcs.length > 0,
          services: selectedSvcs,
          amount_type: amountType,
          amount_value: parsedAmount,
          lost_dist: lostDist,
          lost_local: localPct,
          lost_prof: profPct,
          msg,
        },
      },
      { onConflict: "business_id" },
    );
    if (error) {
      toast.error("Error guardando señas: " + error.message);
      return;
    }
    toast.success("Configuración de señas guardada correctamente");
  }, [
    businessId,
    selectedSvcs,
    amountType,
    amountValue,
    lostDist,
    lostLocal,
    lostProf,
    msg,
  ]);

  const saveRef = React.useRef(save);
  React.useEffect(() => {
    saveRef.current = save;
  }, [save]);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent).detail?.section;
      if (!section || section === "senas" || section === "servicios")
        saveRef.current();
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, []);

  if (loading)
    return (
      <div className="grid place-items-center py-24">
        <ClipprLoader size="screen" delayMs={130} />
      </div>
    );

  return (
    <div className="space-y-4">
      {/* Servicios con seña: si no hay servicios seleccionados, las señas quedan desactivadas. */}
      <>
        {/* Bloque 1: Servicios */}
        <SenasBlock title="Servicios que requieren seña">
          <div className="space-y-2">
            {services.length > 0 && (
              <div className="flex items-center justify-between gap-3 pb-2 border-b border-white/5">
                <div className="text-xs text-muted-foreground">
                  {selectedSvcs.length} de {services.length} servicios
                  seleccionados
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedSvcs(services.map((s) => s.id))}
                    className="rounded-lg bg-white/[0.04] hover:bg-white/[0.08] ring-1 ring-white/10 px-3 py-1.5 text-[11px] text-foreground transition"
                  >
                    Marcar todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedSvcs([])}
                    className="rounded-lg bg-white/[0.04] hover:bg-white/[0.08] ring-1 ring-white/10 px-3 py-1.5 text-[11px] text-muted-foreground transition"
                  >
                    Limpiar
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {services.map((s) => {
                const on = selectedSvcs.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      setSelectedSvcs(
                        on
                          ? selectedSvcs.filter((x) => x !== s.id)
                          : [...selectedSvcs, s.id],
                      )
                    }
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left ring-1 transition-all",
                      on
                        ? "bg-primary/14 ring-primary/35 shadow-[0_0_14px_-6px_oklch(0.66_0.22_265/0.45)]"
                        : "bg-white/[0.03] ring-white/10 hover:bg-white/[0.055]",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium ">
                        {s.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {s.category && <span>{s.category}</span>}
                        {typeof s.duration_min === "number" &&
                          s.duration_min > 0 && (
                            <span>{s.duration_min} min</span>
                          )}
                        {typeof s.price === "number" && s.price > 0 && (
                          <span>
                            ${Number(s.price).toLocaleString("es-AR")}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full ring-1 transition",
                        on
                          ? "bg-primary ring-primary/40"
                          : "bg-white/10 ring-white/10",
                      )}
                    >
                      <span
                        className={cn(
                          "h-5 w-5 rounded-full bg-white shadow transition-transform",
                          on ? "translate-x-5" : "translate-x-0.5",
                        )}
                      />
                    </span>
                  </button>
                );
              })}
            </div>

            {services.length === 0 && (
              <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-4 text-sm text-muted-foreground text-center">
                Primero cargá servicios en Configuración → Servicios.
              </div>
            )}
          </div>
        </SenasBlock>
        {/* Bloque 4: Distribución si se pierde */}
        <SenasBlock title="Si el cliente pierde la seña">
          <div className="flex flex-wrap gap-3">
            {(
              [
                ["local", "🏢 Local"],
                ["prof", "👤 Profesional"],
                ["custom", "⚙️ Personalizado"],
              ] as [string, string][]
            ).map(([v, l]) => (
              <SenasToggleBtn
                key={v}
                label={l}
                active={lostDist === v}
                onClick={() => {
                  setLostDist(v as "local" | "prof" | "custom");
                  if (v === "local") {
                    setLostLocal("100");
                    setLostProf("0");
                  } else if (v === "prof") {
                    setLostLocal("0");
                    setLostProf("100");
                  }
                }}
              />
            ))}
          </div>

          {lostDist === "custom" && (
            <div className="mt-2 p-4 rounded-xl bg-white/[0.02] ring-1 ring-white/[0.06] space-y-3">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Distribución personalizada
              </div>
              <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-24">
                    Local
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={lostLocal}
                    onChange={(e) => setLostLocal(e.target.value)}
                    className="w-20 rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2 text-sm text-center focus:outline-none"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-24">
                    Profesional
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={lostProf}
                    onChange={(e) => setLostProf(e.target.value)}
                    className="w-20 rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2 text-sm text-center focus:outline-none"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Podés escribir los porcentajes libremente. Se validan cuando
                tocás Guardar.
              </div>
            </div>
          )}
        </SenasBlock>

        {/* Bloque 4: Mensaje */}
        <SenasBlock
          title="Mensaje para el cliente"
          subtitle="Mensaje que verá el cliente después de reservar un turno con seña."
        >
          <div className="relative">
            <textarea
              rows={4}
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              className="min-h-[360px] resize-y w-full rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-4 py-3.5 text-sm leading-relaxed focus:outline-none focus:ring-white/25 transition resize-none"
            />
          </div>
          <div className="text-xs text-muted-foreground"></div>
        </SenasBlock>
      </>
    </div>
  );
}

function SettingsPage() {
  const [active, setActive] = useState<SectionId>("branding");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingActive, setPendingActive] = useState<SectionId | null>(null);

  useEffect(() => {
    const markDirty = () => setHasUnsavedChanges(true);
    window.addEventListener("clippr:settings-dirty", markDirty);
    return () => window.removeEventListener("clippr:settings-dirty", markDirty);
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [hasUnsavedChanges]);

  function saveCurrentSection(nextSection?: SectionId | null) {
    window.dispatchEvent(
      new CustomEvent("clippr:save-settings", {
        detail: { section: active },
      }),
    );
    setHasUnsavedChanges(false);
    if (nextSection) {
      setActive(nextSection);
      setPendingActive(null);
    }
  }

  function requestSectionChange(section: SectionId) {
    if (section === active) return;
    if (hasUnsavedChanges) {
      setPendingActive(section);
      return;
    }
    setActive(section);
  }

  return (
    <AppShell>
      <div className="settings-compact-page -mt-4 sm:-mt-5 lg:-mt-6">
        <Topbar
          title="Configuración"
          subtitle="Tu negocio"
          action={null}
        />
        <div className="app-premium-shell -mt-3 sm:-mt-4 lg:-mt-5">
          <div className="pointer-events-none absolute left-1/2 top-[-120px] z-[-1] h-[620px] w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_17%_4%,rgb(139_92_246_/_0.34),transparent_38%),radial-gradient(circle_at_76%_0%,rgb(79_125_255_/_0.30),transparent_36%),radial-gradient(circle_at_46%_96%,rgb(255_123_229_/_0.14),transparent_50%)] blur-[16px]" />
          <div className="space-y-6 animate-fade-up">
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
              {/* Sidebar */}
              <aside className="space-y-5">
                {groups.map((g) => (
                  <div key={g.label}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 px-3 mb-2">
                      {g.label}
                    </div>
                    <div className="space-y-1">
                      {g.items.map((it) => {
                        const isActive = active === it.id;
                        const Icon = it.icon;
                        return (
                          <button
                            key={it.id}
                            onClick={() => requestSectionChange(it.id)}
                            className={cn(
                              "w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-all group",
                              isActive
                                ? "bg-white/[0.06] ring-1 ring-white/10 text-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
                            )}
                          >
                            <span
                              className={cn(
                                "h-8 w-8 rounded-lg grid place-items-center bg-gradient-to-br ring-1 transition-all shrink-0",
                                it.glow,
                                isActive
                                  ? "ring-white/15 shadow-[0_0_18px_-6px_currentColor]"
                                  : "ring-white/5 group-hover:ring-white/15",
                                it.tint,
                              )}
                            >
                              <Icon
                                className={cn("h-4 w-4", it.tint)}
                                strokeWidth={2}
                              />
                            </span>
                            <span className={cn(isActive && "font-medium")}>
                              {it.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="px-3 pt-3 text-[11px] text-muted-foreground/60">
                  Clippr v1.0.0
                </div>
              </aside>

              {/* Content */}
              <section className="space-y-6">
                {active === "branding" && <BrandingSection />}

                {active === "horarios" && <HorariosSection />}
                {active === "equipo" && <EquipoSection />}
                {active === "servicios" && <ServiciosSection />}

                {active === "catalogo" && <CatalogoSection />}
                {active === "cuenta" && <CuentaSection />}
                {active === "caja" && <CajaSection />}
                {active === "plan" && <PlanSection />}
              </section>
            </div>
          </div>
        </div>
      </div>

      {pendingActive ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[oklch(0.12_0.035_275)] p-5 shadow-2xl">
            <div className="text-lg font-display font-semibold text-white">
              Tenés cambios sin guardar
            </div>
            <p className="mt-2 text-sm leading-relaxed text-white/65">
              Los cambios que realizaste todavía no fueron guardados. Podés guardarlos antes de salir o cancelar para seguir editando.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPendingActive(null)}
                className="rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold text-white/75 ring-1 ring-white/10 transition hover:bg-white/10"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setHasUnsavedChanges(false);
                  setActive(pendingActive);
                  setPendingActive(null);
                }}
                className="rounded-xl bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 ring-1 ring-red-400/25 transition hover:bg-red-500/15"
              >
                Salir sin guardar
              </button>
              <button
                type="button"
                onClick={() => saveCurrentSection(pendingActive)}
                className="rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95"
              >
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

// ─────────── Clientes ───────────

type ClientField = {
  key: string;
  label: string;
  required: boolean;
};

const ALL_CLIENT_FIELDS: ClientField[] = [
  { key: "nombre", label: "Nombre", required: true },
  { key: "telefono", label: "Teléfono", required: true },
  { key: "email", label: "Email", required: true },
  { key: "fecha_nacimiento", label: "Fecha de nacimiento", required: false },
  { key: "notas", label: "Notas", required: false },
];

type ClientesConfig = {
  fields: Record<string, boolean>;
  diasInactivo: number;
  diasPerdido: number;
  vipVisitasEnabled: boolean;
  vipVisitasMin: number;
  vipGastoEnabled: boolean;
  vipGastoMin: number;
};

const DEFAULT_CLIENTES_CONFIG: ClientesConfig = {
  fields: {
    nombre: true,
    telefono: true,
    email: true,
    fecha_nacimiento: true,
    notas: false,
  },
  diasInactivo: 30,
  diasPerdido: 90,
  vipVisitasEnabled: true,
  vipVisitasMin: 4,
  vipGastoEnabled: true,
  vipGastoMin: 100000,
};

// ── Helpers outside component — prevents focus loss on re-render ─────────────

function CfgCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 space-y-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

function CfgSectionTitle({ label, sub }: { label: string; sub?: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{label}</h3>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function CfgNumInput({
  label,
  value,
  onChange,
  min = 1,
  step = 1,
  prefix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: number;
  prefix?: string;
}) {
  const [local, setLocal] = React.useState(String(value));
  React.useEffect(() => {
    setLocal(String(value));
  }, [value]);
  const commit = () => {
    const n = Math.max(min, Number(local) || min);
    setLocal(String(n));
    onChange(n);
  };
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-sm text-foreground/80">{label}</span>
      <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
        {prefix && (
          <span className="text-sm text-muted-foreground">{prefix}</span>
        )}
        <input
          type="number"
          min={min}
          step={step}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          className="w-24 bg-transparent text-sm text-right tabular-nums outline-none text-foreground"
        />
      </div>
    </label>
  );
}

function CfgToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "relative h-6 w-11 rounded-full transition-all shrink-0",
        enabled ? "bg-primary/70" : "bg-white/10",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          enabled ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function ClientesSection() {
  const { businessId } = useAuth();
  const [cfg, setCfg] = useState<ClientesConfig>(DEFAULT_CLIENTES_CONFIG);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
        if (schedule._clientes) {
          setCfg({
            ...DEFAULT_CLIENTES_CONFIG,
            ...(schedule._clientes as Partial<ClientesConfig>),
          });
        }
        setLoaded(true);
      });
  }, [businessId]);

  const save = useCallback(async () => {
    if (!businessId) return;
    try {
      const { data: existingRow } = await supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle();
      const existingSchedule = (existingRow?.schedule ?? {}) as Record<
        string,
        unknown
      >;
      const result = await supabase
        .from("business_settings")
        .upsert(
          {
            business_id: businessId,
            schedule: { ...existingSchedule, _clientes: cfg },
          },
          { onConflict: "business_id" },
        );
      if (result.error) throw new Error(result.error.message);
      toast.success("Configuración de clientes guardada");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [businessId, cfg]);

  // Wire up global save button
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent).detail?.section;
      if (!section || section === "clientes") void saveRef.current();
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, []);

  const setField = (key: string, val: boolean) =>
    setCfg((prev) => ({ ...prev, fields: { ...prev.fields, [key]: val } }));

  if (!loaded)
    return (
      <div className="py-16 text-center text-sm text-muted-foreground animate-pulse">
        Cargando…
      </div>
    );

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-display font-semibold">Clientes</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Campos del formulario, segmentación automática y criterios VIP.
        </p>
      </div>

      {/* ── Campos ── */}
      <CfgCard>
        <CfgSectionTitle
          label="Campos visibles"
          sub="Los campos activos aparecen al crear o editar clientes y al agendar turnos."
        />
        <div className="space-y-2.5 pt-1">
          {ALL_CLIENT_FIELDS.map((f) => {
            const enabled = cfg.fields[f.key] ?? false;
            return (
              <div
                key={f.key}
                className="flex items-center justify-between gap-4 py-1"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    disabled={f.required}
                    onClick={() => !f.required && setField(f.key, !enabled)}
                    className={cn(
                      "h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-all",
                      enabled
                        ? "bg-primary/80 border-primary/60"
                        : "bg-white/[0.03] border-white/15",
                      f.required && "opacity-60 cursor-not-allowed",
                    )}
                  >
                    {enabled && (
                      <Check className="h-3 w-3 text-white" strokeWidth={3} />
                    )}
                  </button>
                  <span className="text-sm text-foreground/90">{f.label}</span>
                </div>
                {f.required && (
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground border border-white/10 rounded-full px-2 py-0.5">
                    Obligatorio
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CfgCard>

      {/* ── Estado ── */}
      <CfgCard>
        <CfgSectionTitle
          label="Estado de clientes"
          sub="El sistema calcula automáticamente el estado según la fecha de la última visita."
        />
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            {
              label: "Activo",
              color: "text-emerald-300",
              ring: "ring-emerald-400/25 bg-emerald-400/8",
              range: `0 – ${cfg.diasInactivo - 1} días`,
            },
            {
              label: "Inactivo",
              color: "text-cyan-300",
              ring: "ring-cyan-400/25 bg-cyan-400/8",
              range: `${cfg.diasInactivo} – ${cfg.diasPerdido - 1} días`,
            },
            {
              label: "Perdido",
              color: "text-rose-300",
              ring: "ring-rose-400/25 bg-rose-400/8",
              range: `${cfg.diasPerdido}+ días`,
            },
          ].map((s) => (
            <div key={s.label} className={cn("rounded-xl ring-1 p-3", s.ring)}>
              <div className={cn("text-xs font-semibold", s.color)}>
                {s.label}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {s.range}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-3 pt-1">
          <CfgNumInput
            label="Días para considerar cliente inactivo"
            value={cfg.diasInactivo}
            min={1}
            onChange={(n) =>
              setCfg((p) => ({
                ...p,
                diasInactivo: Math.min(n, p.diasPerdido - 1),
              }))
            }
          />
          <CfgNumInput
            label="Días para considerar cliente perdido"
            value={cfg.diasPerdido}
            min={2}
            onChange={(n) =>
              setCfg((p) => ({
                ...p,
                diasPerdido: Math.max(n, p.diasInactivo + 1),
              }))
            }
          />
        </div>
      </CfgCard>

      {/* ── VIP ── */}
      <CfgCard>
        <CfgSectionTitle
          label="Cliente VIP"
          sub="Se calcula mes a mes. Si el cliente deja de cumplir las condiciones, pierde la etiqueta automáticamente."
        />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                VIP por visitas mensuales
              </div>
              <div className="text-xs text-muted-foreground">
                Cantidad mínima de visitas en el mes actual
              </div>
            </div>
            <CfgToggle
              enabled={cfg.vipVisitasEnabled}
              onToggle={() =>
                setCfg((p) => ({
                  ...p,
                  vipVisitasEnabled: !p.vipVisitasEnabled,
                }))
              }
            />
          </div>
          {cfg.vipVisitasEnabled && (
            <CfgNumInput
              label="Visitas mínimas por mes"
              value={cfg.vipVisitasMin}
              min={1}
              onChange={(n) => setCfg((p) => ({ ...p, vipVisitasMin: n }))}
            />
          )}
        </div>
        <div className="h-px bg-white/5" />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                VIP por gasto mensual
              </div>
              <div className="text-xs text-muted-foreground">
                Gasto mínimo acumulado en el mes actual
              </div>
            </div>
            <CfgToggle
              enabled={cfg.vipGastoEnabled}
              onToggle={() =>
                setCfg((p) => ({ ...p, vipGastoEnabled: !p.vipGastoEnabled }))
              }
            />
          </div>
          {cfg.vipGastoEnabled && (
            <CfgNumInput
              label="Gasto mínimo mensual"
              value={cfg.vipGastoMin}
              min={0}
              step={1000}
              prefix="$"
              onChange={(n) => setCfg((p) => ({ ...p, vipGastoMin: n }))}
            />
          )}
        </div>
        {(cfg.vipVisitasEnabled || cfg.vipGastoEnabled) && (
          <p className="text-[11px] text-muted-foreground rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-3 py-2">
            Un cliente se marca VIP si cumple{" "}
            <strong className="text-foreground">cualquiera</strong> de las
            condiciones activas durante el mes en curso.
          </p>
        )}
      </CfgCard>
    </div>
  );
}

// ─────────── Plan & facturación ───────────
const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);

const plans = [
  {
    id: "pro",
    name: "Pro",
    icon: Rocket,
    tagline: "Ideal para barberías y salones con una sucursal.",
    monthly: 29900,
    badge: "60 DÍAS GRATIS",
    highlight: true,
    cta: "Comenzar prueba gratuita",
    features: [
      "1 sucursal",
      "Profesionales ilimitados",
      "Agenda online",
      "Caja y cobros",
      "Clientes",
      "Comisiones",
      "Página de reservas",
      "Asesor IA",
      "Estadísticas del negocio",
    ],
  },
  {
    id: "business",
    name: "Business",
    icon: Store,
    tagline: "Para negocios con más de una sucursal.",
    monthly: 49900,
    badge: "MULTISUCURSAL",
    highlight: false,
    cta: "Comenzar prueba gratuita",
    features: [
      "Todo lo incluido en Pro",
      "2 sucursales incluidas",
      "Comparativa entre sucursales",
      "Dashboard consolidado",
      "Métricas por local",
      "Roles y permisos avanzados",
      "Gestión centralizada",
      "Soporte prioritario",
    ],
    extra: "+ $10.000 / mes por cada sucursal adicional",
    examples: [
      "2 sucursales → $49.900",
      "3 sucursales → $59.900",
      "4 sucursales → $69.900",
    ],
  },
];

const trustItems = [
  {
    icon: ShieldCheck,
    title: "Sin tarjeta",
    desc: "Probá 60 días sin compromiso.",
  },
  {
    icon: Cloud,
    title: "Tus datos seguros",
    desc: "Guardados en la nube.",
  },
  {
    icon: RefreshCw,
    title: "Actualizaciones incluidas",
    desc: "Mejoras sin costo extra.",
  },
  { icon: Headphones, title: "Soporte humano", desc: "Estamos para ayudarte." },
];

function PlanSection() {
  const trialTotal = 60;
  const trialLeft = 43;
  const trialPct = ((trialTotal - trialLeft) / trialTotal) * 100;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Planes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Probá Clippr gratis y después elegí el plan según la cantidad de
            sucursales.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_oklch(0.78_0.15_150)]" />
          60 días gratis
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl p-5 ring-1 ring-[oklch(0.62_0.25_295/0.28)] bg-gradient-to-br from-[oklch(0.18_0.07_290/0.78)] via-[oklch(0.12_0.04_285/0.9)] to-[oklch(0.08_0.03_275)] shadow-[0_0_60px_-30px_oklch(0.62_0.25_295/0.65)]">
        <div className="pointer-events-none absolute -top-24 -right-20 h-56 w-56 rounded-full bg-[oklch(0.72_0.22_305/0.16)] blur-3xl" />
        <div className="relative grid gap-5 lg:grid-cols-[1fr_280px] lg:items-center">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 shrink-0 rounded-xl grid place-items-center bg-[oklch(0.62_0.25_295/0.14)] ring-1 ring-[oklch(0.62_0.25_295/0.35)]">
              <CalendarDays className="h-5 w-5 text-[oklch(0.82_0.18_300)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[oklch(0.82_0.18_300)]">
                Prueba gratuita activa
              </div>
              <h2 className="mt-1 text-xl font-semibold">
                Todas las funciones de Clippr por 60 días
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sin tarjeta de crédito. Sin compromisos. Al finalizar la prueba,
                elegís Pro o Business para continuar.
              </p>
              <div className="mt-4 h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)]"
                  style={{ width: `${trialPct}%` }}
                />
              </div>
            </div>
          </div>
          <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Tiempo restante
            </div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">
              {trialLeft} días
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Después se activa el plan que elijas.
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={cn(
              "relative rounded-2xl p-6 ring-1 transition overflow-hidden",
              plan.highlight
                ? "bg-gradient-to-b from-[oklch(0.18_0.07_290)] to-[oklch(0.10_0.05_280)] ring-[oklch(0.62_0.25_295/0.5)] shadow-[0_0_50px_-18px_oklch(0.62_0.25_295/0.6)]"
                : "glass ring-white/5",
            )}
          >
            <div className="pointer-events-none absolute -top-24 -right-20 h-52 w-52 rounded-full bg-[oklch(0.62_0.25_295/0.12)] blur-3xl" />
            <div className="relative space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "h-12 w-12 rounded-xl grid place-items-center ring-1 shrink-0",
                      plan.highlight
                        ? "bg-[oklch(0.62_0.25_295/0.15)] ring-[oklch(0.62_0.25_295/0.4)]"
                        : "bg-white/5 ring-white/10",
                    )}
                  >
                    <plan.icon
                      className={cn(
                        "h-5 w-5",
                        plan.highlight
                          ? "text-[oklch(0.82_0.18_300)]"
                          : "text-muted-foreground",
                      )}
                    />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold">{plan.name}</h2>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ring-1",
                          plan.highlight
                            ? "bg-[oklch(0.62_0.25_295/0.18)] text-[oklch(0.82_0.18_300)] ring-[oklch(0.62_0.25_295/0.35)]"
                            : "bg-white/5 text-muted-foreground ring-white/10",
                        )}
                      >
                        {plan.badge}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground max-w-md">
                      {plan.tagline}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Luego de la prueba
                </div>
                <div className="mt-1 flex items-end gap-1">
                  <span className="text-4xl font-semibold tracking-tight">
                    {fmtARS(plan.monthly)}
                  </span>
                  <span className="pb-1 text-sm text-muted-foreground">
                    / mes
                  </span>
                </div>
                {plan.extra && (
                  <div className="mt-2 text-sm text-[oklch(0.82_0.18_300)]">
                    {plan.extra}
                  </div>
                )}
              </div>

              <ul className="space-y-2 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 shrink-0 text-[oklch(0.82_0.18_300)]" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {plan.examples && (
                <div className="rounded-2xl bg-white/[0.035] ring-1 ring-white/10 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Ejemplos de precio
                  </div>
                  <div className="mt-3 grid gap-2 text-sm">
                    {plan.examples.map((example) => (
                      <div
                        key={example}
                        className="flex items-center justify-between rounded-xl bg-white/[0.035] px-3 py-2 ring-1 ring-white/5"
                      >
                        <span>{example.split("→")[0].trim()}</span>
                        <span className="font-semibold text-white/90">
                          {example.split("→")[1].trim()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)] text-white shadow-[0_8px_30px_-10px_oklch(0.62_0.25_295/0.8)] hover:brightness-110">
                {plan.cta} <ChevronRight className="h-4 w-4" />
              </button>
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                <Lock className="h-3 w-3" /> Sin permanencia. Cancelás cuando
                quieras.
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl p-5 ring-1 ring-white/5 grid grid-cols-2 md:grid-cols-4 gap-4">
        {trustItems.map((t) => (
          <div key={t.title} className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl grid place-items-center bg-[oklch(0.62_0.25_295/0.12)] ring-1 ring-[oklch(0.62_0.25_295/0.3)]">
              <t.icon className="h-4.5 w-4.5 text-[oklch(0.82_0.18_300)]" />
            </div>
            <div>
              <div className="text-sm font-medium">{t.title}</div>
              <div className="text-xs text-muted-foreground">{t.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings")({ component: SettingsPage });
