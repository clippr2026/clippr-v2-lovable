import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  MapPin,
  Phone,
  Globe,
  X,
  FileText,
  Image as ImageIcon,
  Building2,
  CalendarDays,
  Plus,
  Trash2,
  Mail,
  Instagram,
  GripVertical,
  Sparkles,
  User as UserIcon,
  Moon,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import { SectionCard, reportSaveStatus, processImage } from "@/components/settings/shared";

export function ReservasOnlineIcon({
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

export function BrandingSection() {
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

  async function save(showToast = true) {
    if (!businessId) return;
    if (!showToast) reportSaveStatus("saving");
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
    else reportSaveStatus("saved");
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

  const publicSiteOrigin = import.meta.env.DEV ? window.location.origin : "https://myclippr.com";
  const publicSiteOriginShort = publicSiteOrigin.replace(/^https?:\/\//, "");
  const publicSlug = slugify(data.slug) || slugify(data.name);
  const publicUrl = `${publicSiteOrigin}/negocio/${publicSlug}`;
  const publicUrlShort = `${publicSiteOriginShort}/negocio/${publicSlug}`;

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
                    {publicSiteOriginShort}/negocio/
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
