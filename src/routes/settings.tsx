import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import React from 'react';
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import {
  Check,
  MapPin,
  Phone,
  Globe,
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
  Star,
  ShieldCheck,
  Handshake,
  HandCoins,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SectionId =
  | "branding"
  | "horarios"
  | "equipo"
  | "servicios"
  | "catalogo"
  | "caja"
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
        label: "Branding",
        icon: Sparkles,
        tint: "text-[oklch(0.82_0.18_300)]",
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
        id: "caja",
        label: "Caja",
        icon: Banknote,
        tint: "text-[oklch(0.80_0.18_45)]",
        glow: "from-[oklch(0.80_0.18_45/0.25)] to-[oklch(0.75_0.2_35/0.05)]",
      },
      {
        id: "senas",
        label: "Señas",
        icon: HandCoins,
        tint: "text-[oklch(0.82_0.18_50)]",
        glow: "from-[oklch(0.82_0.18_50/0.25)] to-[oklch(0.78_0.2_40/0.05)]",
      },
    ],
  },
  {
    label: "Cuenta",
    items: [
      {
        id: "plan",
        label: "Plan & facturación",
        icon: Crown,
        tint: "text-[oklch(0.88_0.16_320)]",
        glow: "from-[oklch(0.88_0.16_320/0.25)] to-[oklch(0.7_0.25_300/0.05)]",
      },
    ],
  },
];

// ─────────── Branding ───────────
type BrandingData = {
  name: string;
  address: string;
  phone: string;
  email: string;
  instagram: string;
  website: string;
  description: string;
  logo_url: string;
};
const EMPTY_BRANDING: BrandingData = {
  name: "", address: "", phone: "", email: "",
  instagram: "", website: "", description: "", logo_url: "",
};

function BrandingSection() {
  const { businessId } = useAuth();
  const [data, setData] = useState<BrandingData>(EMPTY_BRANDING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    // Load name from businesses, rest from business_settings.schedule._branding
    Promise.all([
      supabase.from("businesses").select("name").eq("id", businessId).maybeSingle(),
      supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle(),
    ]).then(([bizRes, settRes]) => {
      const biz = bizRes.data;
      const schedule = (settRes.data?.schedule ?? {}) as Record<string, unknown>;
      const cfg = (schedule._branding ?? {}) as Record<string, unknown>;
      setData({
        name: (biz?.name as string) ?? "",
        address: (cfg.address as string) ?? "",
        phone: (cfg.phone as string) ?? "",
        email: (cfg.email as string) ?? "",
        instagram: (cfg.instagram as string) ?? "",
        website: (cfg.website as string) ?? "",
        description: (cfg.description as string) ?? "",
        logo_url: (cfg.logo_url as string) ?? "",
      });
      setLoading(false);
    });
  }, [businessId]);

  const set = (k: keyof BrandingData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setData(d => ({ ...d, [k]: e.target.value }));

  async function uploadImage(file: File, path: string): Promise<string | null> {
    const { error } = await supabase.storage.from("business-assets").upload(path, file, { upsert: true });
    if (error) { toast.error("Error subiendo imagen: " + error.message); return null; }
    const { data: urlData } = supabase.storage.from("business-assets").getPublicUrl(path);
    return urlData.publicUrl;
  }

  async function save() {
    if (!businessId) return;
    setSaving(true);
    let logo_url = data.logo_url;
    if (logoFile) {
      const url = await uploadImage(logoFile, `${businessId}/logo`);
      if (url) logo_url = url;
    }

    // Save name to businesses
    const nameResult = await supabase.from("businesses").update({ name: data.name }).eq("id", businessId);

    // Save branding fields inside schedule._branding (schedule column exists)
    const { data: existingRow } = await supabase.from("business_settings")
      .select("schedule").eq("business_id", businessId).maybeSingle();
    const existingSchedule = (existingRow?.schedule ?? {}) as Record<string, unknown>;
    const newSchedule = {
      ...existingSchedule,
      _branding: {
        address: data.address,
        phone: data.phone,
        email: data.email,
        instagram: data.instagram,
        website: data.website,
        description: data.description,
        logo_url,
      },
    };
    const cfgResult = await supabase.from("business_settings").upsert(
      { business_id: businessId, schedule: newSchedule },
      { onConflict: "business_id" },
    );

    setSaving(false);
    if (nameResult.error) return toast.error("Error guardando: " + nameResult.error.message);
    if (cfgResult.error) return toast.error("Error guardando: " + cfgResult.error.message);
    setData(d => ({ ...d, logo_url }));
    setLogoFile(null);
    toast.success("Branding guardado correctamente");
  }

  const saveRef = React.useRef(save);
  React.useEffect(() => { saveRef.current = save; }, [businessId, data, logoFile]);

  useEffect(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent).detail?.section;
      if (!section || section === "branding") void saveRef.current();
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, []);

  if (loading) return <div className="text-sm text-muted-foreground animate-pulse p-6">Cargando…</div>;

  const infoRows: { icon: React.ComponentType<{className?:string}>; label: string; hint: string; key: keyof BrandingData; type?: string }[] = [
    { icon: Building2, label: "Nombre del local", hint: "Aparece en tickets, reportes y la pantalla de login", key: "name" },
    { icon: MapPin, label: "Dirección", hint: "Dirección del local principal", key: "address" },
    { icon: Phone, label: "Teléfono de contacto", hint: "Para confirmaciones y WhatsApp", key: "phone" },
    { icon: Mail, label: "Email de contacto", hint: "Para notificaciones y comunicaciones", key: "email", type: "email" },
    { icon: Instagram, label: "Instagram / Redes", hint: "Aparece en el pie de los tickets", key: "instagram" },
    { icon: Globe, label: "Sitio web", hint: "URL del sitio web del negocio", key: "website" },
  ];

  return (
    <>
      <div>
        <h2 className="text-xl font-display font-semibold">Branding</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Personalizá la identidad visual de tu barbería en el sistema.
        </p>
      </div>

      <SectionCard label="Información de la barbería">
        <div className="divide-y divide-white/5">
          {infoRows.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.key} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center shrink-0">
                  <Icon className="h-4.5 w-4.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{f.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{f.hint}</div>
                </div>
                <input
                  type={f.type ?? "text"}
                  value={(data[f.key] as string) ?? ""}
                  onChange={set(f.key)}
                  className="w-72 max-w-[55%] rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40"
                />
              </div>
            );
          })}
          <div className="flex items-start gap-4 py-4 last:pb-0">
            <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center shrink-0">
              <FileText className="h-4.5 w-4.5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">Descripción</div>
              <div className="text-xs text-muted-foreground mt-0.5">Cuéntale a tus clientes sobre tu empresa</div>
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

      <SectionCard label="Imágenes">
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center shrink-0">
              <ImageIcon className="h-4.5 w-4.5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-sm">Logo</div>
              <div className="text-xs text-muted-foreground mt-0.5">Se muestra en el sidebar y en los tickets</div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="h-16 w-24 rounded-lg bg-white/5 ring-1 ring-white/10 grid place-items-center overflow-hidden">
                {logoFile ? (
                  <img src={URL.createObjectURL(logoFile)} alt="" className="h-full w-full object-cover" />
                ) : data.logo_url ? (
                  <img src={data.logo_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">vacío</span>
                )}
              </div>
              <label className="inline-flex items-center gap-2 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-3 py-1.5 text-xs cursor-pointer">
                <Upload className="h-3.5 w-3.5" /> Subir logo
                <input type="file" accept="image/*" className="hidden" onChange={e => setLogoFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold bg-gradient-to-r from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)] text-black shadow-[0_8px_30px_-8px_oklch(0.78_0.17_65/0.5)] hover:opacity-95 transition disabled:opacity-50"
        >
          {saving ? "Guardando…" : <><Check className="h-4 w-4" strokeWidth={3} /> Guardar branding</>}
        </button>
      </div>
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
          ? "bg-gradient-to-r from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)] ring-[oklch(0.78_0.17_65/0.5)]"
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
    <div className="glass rounded-2xl p-5 ring-1 ring-white/5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-4">
        {label}
      </div>
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
          <div className="font-display font-semibold text-base text-foreground">{title}</div>
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
                : "bg-gradient-to-r from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)] text-black",
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

  useEffect(() => {
    if (!businessId) return;
    supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        const schedule = data?.schedule as
          | Record<string, any>
          | null
          | undefined;
        if (!schedule || typeof schedule !== "object") return;
        setDays((current) =>
          current.map((day, i) => {
            const saved = schedule[dayKeys[i]];
            if (!saved || typeof saved !== "object") return day;
            return {
              ...day,
              open: typeof saved.start === "string" ? saved.start : day.open,
              close: typeof saved.end === "string" ? saved.end : day.close,
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

  async function saveSchedule() {
    if (!businessId) return toast.error("No se encontró el negocio");
    setSaving(true);

    const schedule = Object.fromEntries(
      days.map((day, i) => [
        dayKeys[i],
        {
          enabled: day.enabled,
          start: day.open,
          end: day.close,
          breakStart: "12:00",
          breakEnd: "13:00",
        },
      ]),
    ) as Record<string, any>;

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
    toast.success("Horarios guardados correctamente");
  }

  const saveScheduleRef = useRef(saveSchedule);
  useEffect(() => { saveScheduleRef.current = saveSchedule; }, [businessId, days, reservationSettings]);

  useEffect(() => {
    const handler = (event: Event) => {
      const section = (event as CustomEvent).detail?.section;
      if (!section || section === "horarios") void saveScheduleRef.current();
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
            Configurá los días y horarios en que tu barbería atiende clientes.
          </p>
        </div>
      </div>

      <div className="glass rounded-2xl p-5 ring-1 ring-white/5">
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
                onChange={(e) =>
                  setDays((s) =>
                    s.map((x, idx) =>
                      idx === i ? { ...x, open: e.target.value } : x,
                    ),
                  )
                }
                className="rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40 disabled:cursor-not-allowed"
              />
              <input
                type="time"
                value={d.close}
                disabled={!d.enabled}
                onChange={(e) =>
                  setDays((s) =>
                    s.map((x, idx) =>
                      idx === i ? { ...x, close: e.target.value } : x,
                    ),
                  )
                }
                className="rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40 disabled:cursor-not-allowed"
              />
              <Toggle
                on={d.enabled}
                onChange={(v) =>
                  setDays((s) =>
                    s.map((x, idx) => (idx === i ? { ...x, enabled: v } : x)),
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
                className="flex items-center gap-4 py-4 first:pt-0 last:pb-0"
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
  is_active?: boolean | null;
  commission_pct?: number | null;
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

function EquipoSection() {
  const { businessId } = useAuth();
  const [tab, setTab] = useState<"pros" | "users" | "perms">("pros");
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<EmployeeRow | null>(null);
  const [editingEmp, setEditingEmp] = useState<EmployeeRow | null>(null);
  const [form, setForm] = useState<NewProForm>(EMPTY_FORM);
  const [dlgTab, setDlgTab] = useState<
    "datos" | "horarios" | "perfil" | "comisiones"
  >("datos");

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("employees")
      .select("id,full_name,is_active,commission_pct")
      .eq("business_id", businessId)
      .order("full_name", { ascending: true });
    if (error) toast.error("Error cargando profesionales: " + error.message);
    setRows((data ?? []) as EmployeeRow[]);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent).detail?.section;
      if (!section || section === "equipo") {
        toast.success("Equipo guardado correctamente");
      }
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, []);

  function openNew() {
    setEditingEmp(null);
    setForm(EMPTY_FORM);
    setDlgTab("datos");
    setOpen(true);
  }

  async function saveProfessional() {
    if (!businessId) return;
    const name = form.fullName.trim();
    if (!name) {
      setDlgTab("datos");
      return toast.error("Ingresá el nombre completo");
    }
    setSaving(true);
    const commission = form.commissionPct ? Number(form.commissionPct) : null;

    if (editingEmp) {
      // Update existing
      const { error } = await supabase.from("employees").update({
        full_name: name,
        commission_pct: commission,
      }).eq("id", editingEmp.id);
      setSaving(false);
      if (error) return toast.error("Error: " + error.message);
      toast.success("Profesional actualizado correctamente");
      setOpen(false);
      setEditingEmp(null);
      load();
      return;
    }

    // Insert new
    const { data: inserted, error } = await supabase
      .from("employees")
      .insert({
        business_id: businessId,
        full_name: name,
        is_active: true,
        commission_pct: commission,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      setSaving(false);
      return toast.error("Error: " + (error?.message ?? "no se pudo crear"));
    }
    setSaving(false);
    toast.success("Profesional agregado correctamente");
    setOpen(false);
    load();
  }

  async function toggleActive(emp: EmployeeRow) {
    const { error } = await supabase
      .from("employees")
      .update({ is_active: !(emp.is_active !== false) })
      .eq("id", emp.id);
    if (error) return toast.error("Error: " + error.message);
    load();
  }

  async function remove(emp: EmployeeRow) {
    setConfirmDel(emp);
  }

  async function doRemoveEmp() {
    if (!confirmDel) return;
    const emp = confirmDel;
    setConfirmDel(null);
    const { error } = await supabase.from("employees").delete().eq("id", emp.id);
    if (error) return toast.error("Error: " + error.message);
    toast.success("Equipo actualizado correctamente");
    load();
  }

  function setDay(key: DayKey, patch: Partial<DaySchedule>) {
    setForm((f) => ({
      ...f,
      schedule: { ...f.schedule, [key]: { ...f.schedule[key], ...patch } },
    }));
  }

  return (
    <>
      <div>
        <h2 className="text-xl font-display font-semibold">Equipo</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Profesionales sincronizados con Agenda y Caja en tiempo real.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-white/5">
        {(
          [
            ["pros", "Profesionales"],
            ["users", "Usuarios"],
            ["perms", "Permisos"],
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
                <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)]" />
              )}
            </button>
          );
        })}
      </div>

      {tab === "pros" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={openNew}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)] text-zinc-950 font-semibold px-4 py-2.5 text-sm shadow-lg shadow-[oklch(0.78_0.17_55/0.3)]"
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
              {rows.map((emp, i) => {
                const displayName = emp.full_name || emp.name || "—";
                const active = emp.is_active !== false;
                return (
                  <div
                    key={emp.id}
                    className={cn(
                      "glass rounded-2xl p-4 ring-1 ring-white/5 transition-opacity",
                      !active && "opacity-70",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "h-10 w-10 rounded-full grid place-items-center text-sm font-semibold text-black bg-gradient-to-br",
                          PRO_TINTS[i % PRO_TINTS.length],
                        )}
                      >
                        {displayName[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {displayName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Profesional
                        </div>
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full ring-1 px-2 py-0.5 text-[10px] uppercase tracking-wider",
                          active
                            ? "bg-[oklch(0.78_0.17_140/0.12)] ring-[oklch(0.78_0.17_140/0.3)] text-[oklch(0.85_0.17_140)]"
                            : "bg-white/5 ring-white/10 text-muted-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            active
                              ? "bg-[oklch(0.78_0.17_140)]"
                              : "bg-muted-foreground",
                          )}
                        />
                        {active ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => { setEditingEmp(emp); setForm({ ...EMPTY_FORM, fullName: emp.full_name ?? emp.name ?? "", commissionPct: String(emp.commission_pct ?? "") }); setDlgTab("datos"); setOpen(true); }}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-3 py-1.5 text-xs"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => toggleActive(emp)}
                        className="inline-flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-2.5 py-1.5 text-xs"
                      >
                        {active ? "Off" : "On"}
                      </button>
                      <button
                        onClick={() => remove(emp)}
                        className="inline-flex items-center justify-center rounded-lg bg-red-500/10 hover:bg-red-500/20 ring-1 ring-red-500/30 text-red-300 px-2.5 py-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab !== "pros" && (
        <div className="glass rounded-2xl p-10 ring-1 ring-white/5 text-center text-muted-foreground">
          Sección en construcción.
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
            <div className="flex items-center gap-3 p-5 border-b border-white/5">
              <div className="h-10 w-10 rounded-full grid place-items-center text-sm font-semibold text-black bg-gradient-to-br from-red-400 to-rose-500">
                {(form.fullName[0] || "A").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold">Nuevo profesional</div>
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
                  ["datos", "Datos"],
                  ["horarios", "Horarios"],
                  ["perfil", "Perfil"],
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
                      <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)]" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="p-5 space-y-4">
              {dlgTab === "datos" && (
                <div className="space-y-4">
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
                  <Field
                    label="Email de acceso *"
                    hint="Este email se usará para ingresar a la plataforma."
                  >
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) =>
                        setForm({ ...form, email: e.target.value })
                      }
                      className={inputCls}
                      placeholder="ale@gmail.com"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
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
                        form.acceptsOnline
                          ? "bg-[oklch(0.78_0.17_55)]"
                          : "bg-white/15",
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
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-2">
                      Color en agenda
                    </div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {AGENDA_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setForm({ ...form, color: c })}
                          className={cn(
                            "h-8 w-8 rounded-full transition-all ring-2",
                            form.color === c
                              ? "ring-white scale-110"
                              : "ring-white/10",
                          )}
                          style={{ background: c }}
                          aria-label={c}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {dlgTab === "horarios" && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Configurá los días y horarios de trabajo. Los días
                    desactivados no recibirán turnos.
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
                              d.enabled
                                ? "bg-[oklch(0.78_0.17_55)]"
                                : "bg-white/15",
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
                </div>
              )}

              {dlgTab === "perfil" && (
                <div className="space-y-4">
                  <Field label="Nombre público">
                    <input
                      value={form.publicName}
                      onChange={(e) =>
                        setForm({ ...form, publicName: e.target.value })
                      }
                      className={inputCls}
                      placeholder={
                        form.fullName || "Nombre que verán los clientes"
                      }
                    />
                  </Field>
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
                  <Field label="Especialidad destacada">
                    <input
                      value={form.specialty}
                      onChange={(e) =>
                        setForm({ ...form, specialty: e.target.value })
                      }
                      className={inputCls}
                      placeholder="Ej: Degradados, Color, Barba clásica"
                    />
                  </Field>
                </div>
              )}

              {dlgTab === "comisiones" && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Activá la comisión general. Podés ajustar por servicio luego
                    de crear al profesional.
                  </p>
                  <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3 flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        Comisión general
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Aplicada a todos los servicios.
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={form.commissionPct}
                      onChange={(e) =>
                        setForm({ ...form, commissionPct: e.target.value })
                      }
                      className="w-20 rounded-lg bg-white/5 ring-1 ring-white/10 px-2 py-1.5 text-sm text-right focus:outline-none"
                      placeholder="0"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 p-5 border-t border-white/5">
              <button
                onClick={saveProfessional}
                disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)] text-zinc-950 font-semibold px-4 py-2.5 text-sm disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar profesional"}
              </button>
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                className="rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-4 py-2.5 text-sm"
              >
                Cancelar
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
});

const defaultServiceCategories = ["Servicios"];
const serviceCategories = defaultServiceCategories;
const defaultCatalogCategories = ["Productos", "Bebidas", "Indumentaria"];

function priceToCash(price: string, discount: string) {
  const p = Number(price) || 0;
  const d = Number(discount) || 0;
  return Math.max(0, Math.round(p - (p * d) / 100));
}

function rowToForm(row: PriceRow, isService: boolean): PriceForm {
  return {
    name: row.name ?? "",
    price: String(row.price ?? 0),
    discount: "0",
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
  saving,
  catalogCategories = defaultCatalogCategories,
}: {
  open: boolean;
  mode: "new" | "edit";
  isService: boolean;
  form: PriceForm;
  setForm: (form: PriceForm) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  catalogCategories?: string[];
}) {
  if (!open) return null;
  const cashPrice = priceToCash(form.price, form.discount);
  const title = `${mode === "edit" ? "Editar" : "Nuevo"} ${isService ? "servicio" : form.category.toLowerCase()}`;
  const availableCatalogCategories = Array.from(
    new Set([
      ...(form.category ? [form.category] : []),
      ...catalogCategories,
    ]),
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-2xl bg-[oklch(0.12_0.02_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/5">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-white/5"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          <Field label={isService ? "Nombre del servicio" : "Nombre"}>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputCls}
              placeholder={isService ? "Corte + Barba" : "Nombre del producto"}
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
            <Field label="Descuento efectivo (%)">
              <input
                type="number"
                value={form.discount}
                onChange={(e) => setForm({ ...form, discount: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>

          <div className="rounded-xl bg-white/5 ring-1 ring-white/5 px-4 py-3 text-sm text-muted-foreground">
            💵 Precio en efectivo:{" "}
            <span className="font-semibold text-[oklch(0.82_0.14_75)]">
              ${cashPrice.toLocaleString("es-AR")}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {isService && (
              <Field label="Duración (min)">
                <input
                  type="number"
                  min={0}
                  value={form.duration}
                  onChange={(e) =>
                    setForm({ ...form, duration: e.target.value })
                  }
                  className={inputCls}
                />
              </Field>
            )}
            <Field label="Estado">
              <select
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value as PriceForm["status"],
                  })
                }
                className={inputCls}
              >
                <option>Activo</option>
                <option>Inactivo</option>
              </select>
            </Field>
            {(
              <Field label="Categoría">
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                  className={inputCls}
                >
                  {availableCatalogCategories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          <label className="flex items-center justify-between gap-4 rounded-xl bg-white/5 ring-1 ring-white/5 px-4 py-3 cursor-pointer">
            <div>
              <div className="text-sm font-medium">
                Se puede reservar online
              </div>
              <div className="text-xs text-muted-foreground">
                Disponible para reserva/compra online
              </div>
            </div>
            <Toggle
              on={form.reservable}
              onChange={(v) => setForm({ ...form, reservable: v })}
            />
          </label>

          {!isService && (
            <SectionCard label="Stock">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Stock inicial">
                  <input
                    type="number"
                    value={form.stock}
                    onChange={(e) =>
                      setForm({ ...form, stock: e.target.value })
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="⚠️ Avisar en">
                  <input
                    type="number"
                    value={form.warnStock}
                    onChange={(e) =>
                      setForm({ ...form, warnStock: e.target.value })
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="🔴 Crítico en">
                  <input
                    type="number"
                    value={form.criticalStock}
                    onChange={(e) =>
                      setForm({ ...form, criticalStock: e.target.value })
                    }
                    className={inputCls}
                  />
                </Field>
              </div>
            </SectionCard>
          )}

          <Field label="Descripción (opcional)">
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              className={cn(inputCls, "min-h-[100px] resize-y")}
              placeholder={
                isService
                  ? "Describí el servicio, qué incluye, técnica o detalles…"
                  : "Descripción, detalles de stock o información del producto…"
              }
            />
          </Field>
        </div>

        <div className="flex items-center gap-2 px-6 py-5 border-t border-white/5">
          <button
            onClick={onSave}
            disabled={saving}
            className="flex-1 rounded-xl bg-gradient-to-b from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)] text-zinc-950 font-semibold px-4 py-2.5 text-sm disabled:opacity-50"
          >
            {saving
              ? "Guardando…"
              : `Guardar ${isService ? "servicio" : form.category.toLowerCase()}`}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-4 py-2.5 text-sm"
          >
            Cancelar
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
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<string>(isService ? "Servicios" : "Productos");
  const [editing, setEditing] = useState<PriceRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PriceForm>(
    emptyPriceForm(isService ? "Servicios" : "Productos", isService),
  );
  const [confirmDelItem, setConfirmDelItem] = useState<PriceRow | null>(null);
  // Pending changes — written to Supabase only when global Save is pressed
  type PendingItem = { tempId: string; payload: Record<string, unknown>; isNew: boolean };
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [confirmDelCat, setConfirmDelCat] = useState<string | null>(null);
  const [customCatalogCategories, setCustomCatalogCategories] = useState<string[]>(defaultCatalogCategories);
  const [customServiceCategories, setCustomServiceCategories] = useState<string[]>(defaultServiceCategories);

  // Load categories from Supabase schedule._categories
  useEffect(() => {
    if (!businessId) return;
    supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
        const cats = (schedule._categories ?? {}) as Record<string, unknown>;
        if (isService && Array.isArray(cats.service)) setCustomServiceCategories(cats.service as string[]);
        if (!isService && Array.isArray(cats.catalog)) setCustomCatalogCategories(cats.catalog as string[]);
      });
  }, [businessId, isService]);

  // Save categories to Supabase (called by global save)
  const persistCategories = useCallback(async () => {
    if (!businessId) return;
    const { data: existingRow } = await supabase.from("business_settings")
      .select("schedule").eq("business_id", businessId).maybeSingle();
    const existingSchedule = (existingRow?.schedule ?? {}) as Record<string, unknown>;
    const existingCats = (existingSchedule._categories ?? {}) as Record<string, unknown>;
    const updatedCats = isService
      ? { ...existingCats, service: customServiceCategories }
      : { ...existingCats, catalog: customCatalogCategories };
    await supabase.from("business_settings").upsert(
      { business_id: businessId, schedule: { ...existingSchedule, _categories: updatedCats } },
      { onConflict: "business_id" },
    );
  }, [businessId, isService, customServiceCategories, customCatalogCategories]);

  // Local-only category update (no Supabase until global save)
  const saveCategories = useCallback((next: string[], type: "catalog" | "service") => {
    const clean = Array.from(new Set(next.map((c) => c.trim()).filter(Boolean)));
    if (type === "service") {
      setCustomServiceCategories(clean.length ? clean : defaultServiceCategories);
    } else {
      setCustomCatalogCategories(clean.length ? clean : defaultCatalogCategories);
    }
  }, [isService]);

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

  // Global Save: persist pending + categories + show toast
  const persistCategoriesRef = useRef(persistCategories);
  useEffect(() => { persistCategoriesRef.current = persistCategories; }, [persistCategories]);
  const pendingItemsRef = useRef(pendingItems);
  const pendingDeletesRef = useRef(pendingDeletes);
  useEffect(() => { pendingItemsRef.current = pendingItems; }, [pendingItems]);
  useEffect(() => { pendingDeletesRef.current = pendingDeletes; }, [pendingDeletes]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const section = (e as CustomEvent).detail?.section;
      const mySection = isService ? "servicios" : "catalogo";
      if (!section || section === mySection) {
        const items = pendingItemsRef.current;
        const deletes = pendingDeletesRef.current;
        const errors: string[] = [];

        // Flush deletes
        for (const id of deletes) {
          const { error } = await supabase.from("price_catalog").delete().eq("id", id);
          if (error) errors.push(error.message);
        }

        // Flush upserts
        for (const { tempId, payload, isNew } of items) {
          if (isNew) {
            const { error } = await supabase.from("price_catalog").insert(payload);
            if (error) errors.push(error.message);
          } else {
            const { error } = await supabase.from("price_catalog").update(payload).eq("id", tempId);
            if (error) errors.push(error.message);
          }
        }

        await persistCategoriesRef.current();

        if (errors.length > 0) {
          toast.error("Error guardando: " + errors[0]);
        } else {
          setPendingItems([]);
          setPendingDeletes(new Set());
          toast.success(isService ? "Servicios guardados correctamente" : "Catálogo guardado correctamente");
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
    ? Array.from(new Set([...customServiceCategories, ...visibleRows.map((r) => r.category || "Servicios")]))
    : Array.from(new Set([...customCatalogCategories, ...visibleRows.map((r) => r.category || "Productos")]));
  const filtered = visibleRows.filter((r) => (r.category || (isService ? "Servicios" : "Productos")) === cat);

  function openNew() {
    setEditing(null);
    setForm(emptyPriceForm(cat, isService));
    setModalOpen(true);
  }

  function openEdit(row: PriceRow) {
    setEditing(row);
    setForm(rowToForm(row, isService));
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
      // Update existing row locally
      setRows(prev => prev.map(r => r.id === editing.id ? { ...r, ...payload } as PriceRow : r));
      setPendingItems(prev => {
        const next = prev.filter(p => p.tempId !== editing.id);
        return [...next, { tempId: editing.id, payload: { ...payload }, isNew: false }];
      });
    } else {
      // New row — temp negative id until saved
      const tempId = `new_${Date.now()}`;
      setRows(prev => [...prev, { id: tempId, ...payload } as PriceRow]);
      setPendingItems(prev => [...prev, { tempId, payload: { ...payload }, isNew: true }]);
    }
    setModalOpen(false);
  }

  function toggle(row: PriceRow) {
    const newActive = !row.active;
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, active: newActive } : r));
    setPendingItems(prev => {
      const existing = prev.find(p => p.tempId === row.id);
      if (existing) return prev.map(p => p.tempId === row.id ? { ...p, payload: { ...p.payload, active: newActive } } : p);
      return [...prev, { tempId: row.id, payload: { active: newActive }, isNew: false }];
    });
  }

  async function remove(row: PriceRow) {
    setConfirmDelItem(row);
  }

  async function doRemoveItem() {
    if (!confirmDelItem) return;
    const row = confirmDelItem;
    setConfirmDelItem(null);
    setRows(prev => prev.filter(r => r.id !== row.id));
    // If it was a new (unsaved) item, just remove from pending
    if (row.id.startsWith("new_")) {
      setPendingItems(prev => prev.filter(p => p.tempId !== row.id));
    } else {
      setPendingItems(prev => prev.filter(p => p.tempId !== row.id));
      setPendingDeletes(prev => new Set([...prev, row.id]));
    }
    toast.success(isService ? "Servicio eliminado" : "Producto eliminado");
  }

  function reorderItem(row: PriceRow, direction: "up" | "down") {
    const catRows = filtered;
    const idx = catRows.findIndex((r) => r.id === row.id);
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === catRows.length - 1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const swapRow = catRows[swapIdx];
    setRows(prev => {
      const arr = [...prev];
      const i = arr.findIndex(r => r.id === row.id);
      const j = arr.findIndex(r => r.id === swapRow.id);
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  }

  // Inline input modal for add/rename category (avoids browser prompt())
  const [catModal, setCatModal] = useState<{ mode: "add" | "rename"; current?: string } | null>(null);
  const [catInputVal, setCatInputVal] = useState("");

  function addCategory() {
    setCatInputVal("");
    setCatModal({ mode: "add" });
  }

  async function renameCategory(category: string) {
    setCatInputVal(category);
    setCatModal({ mode: "rename", current: category });
  }

  async function submitCatModal() {
    const clean = catInputVal.trim();
    if (!clean) { setCatModal(null); return; }
    if (catModal?.mode === "add") {
      if (isService) saveCategories([...customServiceCategories, clean], "service");
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
          await supabase.from("price_catalog").update({ category: clean }).eq("business_id", businessId).eq("category", category);
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
    if (currentCategories.length === 0) return toast.error("Debe quedar al menos una categoría");
    const targetCategory = currentCategories[0];
    if (isService) saveCategories(customServiceCategories.filter((c) => c !== category), "service");
    else saveCategories(customCatalogCategories.filter((c) => c !== category), "catalog");
    if (businessId) {
      await supabase.from("price_catalog").update({ category: targetCategory }).eq("business_id", businessId).eq("category", category);
    }
    setCat(targetCategory);
    toast.success("Categoría eliminada");
    load();
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-display font-semibold">
            {isService ? "Servicios" : "Catálogo"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {isService
              ? "Administrá únicamente los servicios que se reservan y se cobran en Caja."
              : "Administrá productos, bebidas, indumentaria y otros ítems del negocio."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(
            <button
              onClick={addCategory}
              className="inline-flex items-center gap-2 rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-4 py-2.5 text-sm"
            >
              <Plus className="h-4 w-4" /> Nueva categoría
            </button>
          )}
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)] text-zinc-950 font-semibold px-4 py-2.5 text-sm"
          >
            <Plus className="h-4 w-4" />{" "}
            {isService ? "Nuevo servicio" : `Nuevo ${cat.toLowerCase()}`}
          </button>
        </div>
      </div>

      <div className="glass rounded-2xl ring-1 ring-white/5">
        <div className="flex items-center gap-1 px-3 pt-3 border-b border-white/5 overflow-x-auto">
          {categories.map((category) => {
            const active = category === cat;
            return (
              <div
                key={category}
                className={cn(
                  "inline-flex items-center gap-1 rounded-t-lg transition-colors whitespace-nowrap",
                  active
                    ? "bg-white/5 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <button
                  onClick={() => setCat(category)}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm"
                >
                  {category}
                </button>
                {(
                  <>
                    <button
                      onClick={() => renameCategory(category)}
                      className="px-1 text-xs opacity-60 hover:opacity-100"
                    >
                      ✎
                    </button>
                    {categories.length > 1 && (
                      <button
                        onClick={() => deleteCategory(category)}
                        className="pr-2 text-xs text-red-300/80 hover:text-red-300"
                        title="Eliminar categoría"
                      >
                        ×
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
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
            {filtered.map((row, rowIdx) => (
              <div key={row.id} className="flex items-center gap-3 px-5 py-4">
                {/* Reorder buttons */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    onClick={() => reorderItem(row, "up")}
                    disabled={rowIdx === 0}
                    className="h-5 w-5 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-white/10 disabled:opacity-20 transition"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => reorderItem(row, "down")}
                    disabled={rowIdx === filtered.length - 1}
                    className="h-5 w-5 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-white/10 disabled:opacity-20 transition"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
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
                {typeof row.stock === "number" && !isService && (
                  <span className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                    row.stock > 0
                      ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/25"
                      : "bg-red-500/10 text-red-300 ring-red-400/25"
                  )}>
                    Stock {row.stock}
                  </span>
                )}
                <div className="text-right shrink-0">
                  <div className="font-display text-sm font-semibold text-[oklch(0.82_0.14_75)]">
                    ${Number(row.price).toLocaleString("es-AR")}
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full ring-1 px-2 py-0.5 text-[10px] uppercase tracking-wider",
                    row.active !== false
                      ? "bg-[oklch(0.78_0.17_140/0.12)] ring-[oklch(0.78_0.17_140/0.3)] text-[oklch(0.85_0.17_140)]"
                      : "bg-white/5 ring-white/10 text-muted-foreground",
                  )}
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
                </span>
                <button
                  onClick={() => openEdit(row)}
                  className="rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-3 py-1.5 text-xs"
                >
                  Editar
                </button>
                <button
                  onClick={() => toggle(row)}
                  className="rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {row.active !== false ? "Off" : "On"}
                </button>
                <button
                  onClick={() => remove(row)}
                  className="rounded-lg bg-red-500/10 hover:bg-red-500/20 ring-1 ring-red-500/30 text-red-300 px-2 py-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
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
        saving={saving}
        catalogCategories={categories}
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
              {catModal.mode === "add" ? "Nueva categoría" : "Renombrar categoría"}
            </div>
            <input
              autoFocus
              value={catInputVal}
              onChange={(e) => setCatInputVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitCatModal(); if (e.key === "Escape") setCatModal(null); }}
              placeholder="Nombre de la categoría"
              className="w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-4 py-2.5 text-sm focus:outline-none focus:ring-primary/40"
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setCatModal(null)} className="px-4 py-2 rounded-xl text-sm bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition">
                Cancelar
              </button>
              <button
                onClick={submitCatModal}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)] text-black transition"
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
function CajaSection() {
  const { businessId } = useAuth();
  const defaultMethods = { efectivo: true, transferencia: true, tarjeta: true, mp: true, cuentaDni: false };
  const [methods, setMethods] = useState(defaultMethods);
  const [autoChange, setAutoChange] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
        const caja = (schedule._caja ?? {}) as Record<string, unknown>;
        if (caja.methods) setMethods(caja.methods as typeof defaultMethods);
        if (typeof caja.autoChange === "boolean") setAutoChange(caja.autoChange);
      });
  }, [businessId]);

  async function saveCajaSettings() {
    if (!businessId) return toast.error("No se encontró el negocio");
    const { data: existingRow } = await supabase.from("business_settings")
      .select("schedule").eq("business_id", businessId).maybeSingle();
    const existingSchedule = (existingRow?.schedule ?? {}) as Record<string, unknown>;
    const { error } = await supabase.from("business_settings").upsert(
      { business_id: businessId, schedule: { ...existingSchedule, _caja: { methods, autoChange } } },
      { onConflict: "business_id" },
    );
    if (error) return toast.error("Error guardando: " + error.message);
    window.dispatchEvent(new CustomEvent("clippr:caja-settings-updated"));
    toast.success("Configuración de caja guardada correctamente");
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const section = (event as CustomEvent).detail?.section;
      if (!section || section === "caja") void saveCajaSettings();
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, [methods, autoChange]);

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
        <h2 className="text-xl font-display font-semibold">
          Configuración de caja
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Definí los medios de pago y comportamiento básico de Caja & Cobro.
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
                  onChange={(v) => setMethods((s) => ({ ...s, [m.id]: v }))}
                />
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard label="Comportamiento de caja">
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center">
            <ArrowLeftRight className="h-4.5 w-4.5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm">
              Calcular vuelto automáticamente
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Muestra el vuelto al ingresar el monto en efectivo
            </div>
          </div>
          <Toggle on={autoChange} onChange={setAutoChange} />
        </div>
      </SectionCard>
    </>
  );
}

// ─────────── Page ───────────

// ---------------------------------------------------------------------------
// Señas Section
// ---------------------------------------------------------------------------
function SenasSection() {
  const { businessId } = useAuth();
  const [enabled, setEnabled] = React.useState(false);
  const [services, setServices] = React.useState<{id:string;name:string}[]>([]);
  const [selectedSvcs, setSelectedSvcs] = React.useState<string[]>([]);
  const [amountType, setAmountType] = React.useState<"fixed"|"percent">("fixed");
  const [amountValue, setAmountValue] = React.useState("");
  const [lostDist, setLostDist] = React.useState<"local"|"prof"|"custom">("local");
  const [lostLocal, setLostLocal] = React.useState("100");
  const [lostProf, setLostProf] = React.useState("0");
  const [msg, setMsg] = React.useState(
    "Hola 👋\nPara confirmar tu turno debés abonar una seña.\nTitular: [Nombre]\nAlias: [alias]\nCBU: [cbu]\nBanco: [banco]"
  );
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!businessId) return;
    supabase.from("business_settings").select("senas_config").eq("business_id", businessId).maybeSingle()
      .then(({ data }) => {
        if (data?.senas_config) {
          const c = data.senas_config as Record<string,unknown>;
          setEnabled(!!c.enabled);
          setSelectedSvcs((c.services as string[]) ?? []);
          setAmountType((c.amount_type as "fixed"|"percent") ?? "fixed");
          setAmountValue(String(c.amount_value ?? ""));
          setLostDist((c.lost_dist as "local"|"prof"|"custom") ?? "local");
          setLostLocal(String(c.lost_local ?? "100"));
          setLostProf(String(c.lost_prof ?? "0"));
          setMsg(String(c.msg ?? msg));
        }
        setLoading(false);
      });
    supabase.from("services").select("id,name").eq("business_id", businessId).order("name")
      .then(({ data }) => setServices((data ?? []) as {id:string;name:string}[]));
  }, [businessId]);

  const save = React.useCallback(async () => {
    if (!businessId) return;
    const localPct = parseInt(lostLocal) || 0;
    const profPct  = lostDist === "custom" ? (100 - localPct) : lostDist === "prof" ? 100 : 0;
    const { error } = await supabase.from("business_settings").upsert({
      business_id: businessId,
      senas_config: {
        enabled, services: selectedSvcs, amount_type: amountType,
        amount_value: parseFloat(amountValue) || 0,
        lost_dist: lostDist, lost_local: localPct, lost_prof: profPct, msg,
      }
    }, { onConflict: "business_id" });
    if (error) { toast.error("Error guardando señas: " + error.message); return; }
    toast.success("Configuración de señas guardada correctamente");
  }, [businessId, enabled, selectedSvcs, amountType, amountValue, lostDist, lostLocal, msg]);

  const saveRef = React.useRef(save);
  React.useEffect(() => { saveRef.current = save; }, [save]);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent).detail?.section;
      if (!section || section === "senas") saveRef.current();
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, []);

  if (loading) return <div className="text-sm text-muted-foreground animate-pulse p-6">Cargando…</div>;

  // Reusable block wrapper
  const Block = ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
    <div className="rounded-2xl bg-white/[0.02] ring-1 ring-white/[0.06] p-6 space-y-4">
      <div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
      </div>
      {children}
    </div>
  );

  const ToggleBtn = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
    <button onClick={onClick}
      className={cn("px-5 py-2.5 rounded-xl text-sm font-semibold ring-1 transition-all",
        active
          ? "bg-primary/20 ring-primary/50 text-foreground shadow-[0_0_16px_-4px_oklch(0.66_0.22_265/0.4)]"
          : "bg-white/[0.03] ring-white/10 text-muted-foreground hover:text-foreground hover:bg-white/[0.05]")}>
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Bloque 1: Activar */}
      <Block title="¿Activar señas?" subtitle="Cuando está activado podés requerir una seña para confirmar turnos.">
        <div className="flex gap-3">
          <ToggleBtn label="Sí" active={enabled} onClick={() => setEnabled(true)} />
          <ToggleBtn label="No" active={!enabled} onClick={() => setEnabled(false)} />
        </div>
      </Block>

      {enabled && (<>
        {/* Bloque 2: Servicios */}
        <Block title="Servicios que requieren seña" subtitle="Solo los servicios seleccionados pedirán seña al reservar.">
          <div className="flex flex-wrap gap-2">
            {services.map((s) => {
              const on = selectedSvcs.includes(s.id);
              return (
                <button key={s.id}
                  onClick={() => setSelectedSvcs(on ? selectedSvcs.filter(x=>x!==s.id) : [...selectedSvcs,s.id])}
                  className={cn("px-3.5 py-2 rounded-xl text-xs font-medium ring-1 transition-all",
                    on
                      ? "bg-primary/20 ring-primary/40 text-foreground shadow-[0_0_12px_-4px_oklch(0.66_0.22_265/0.35)]"
                      : "bg-white/[0.03] ring-white/10 text-muted-foreground hover:text-foreground hover:bg-white/[0.05]")}>
                  {s.name}
                </button>
              );
            })}
            {services.length === 0 && (
              <div className="text-xs text-muted-foreground py-1">Primero cargá servicios en la sección Servicios.</div>
            )}
          </div>
        </Block>

        {/* Bloque 3: Monto */}
        <Block title="Monto de la seña" subtitle="Definí si la seña es un monto fijo o un porcentaje del servicio.">
          <div className="flex gap-3">
            <ToggleBtn label="Monto fijo" active={amountType==="fixed"} onClick={() => setAmountType("fixed")} />
            <ToggleBtn label="Porcentaje" active={amountType==="percent"} onClick={() => setAmountType("percent")} />
          </div>
          <div className="flex items-center gap-3 mt-1">
            {amountType === "fixed" && (
              <span className="text-lg font-light text-muted-foreground">$</span>
            )}
            <input
              type="number"
              min="0"
              step={amountType === "percent" ? "0.1" : "1"}
              value={amountValue}
              onChange={e => setAmountValue(e.target.value)}
              placeholder={amountType==="fixed" ? "Ej: 30000" : "Ej: 50"}
              className="w-44 rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-4 py-2.5 text-sm focus:outline-none focus:ring-white/30 transition"
            />
            {amountType === "percent" && (
              <span className="text-lg font-light text-muted-foreground">%</span>
            )}
            {amountValue && (
              <span className="text-xs text-muted-foreground">
                {amountType==="fixed"
                  ? `$${parseInt(amountValue||"0").toLocaleString("es-AR")} fijos`
                  : `${amountValue}% del precio del servicio`}
              </span>
            )}
          </div>
        </Block>

        {/* Bloque 4: Distribución si se pierde */}
        <Block title="Si el cliente pierde la seña" subtitle="Definí cómo se distribuye el dinero de la seña perdida.">
          <div className="flex flex-wrap gap-3">
            {([
              ["local",  "100% para el local"],
              ["prof",   "100% para el profesional"],
              ["custom", "Personalizado"],
            ] as [string,string][]).map(([v,l]) => (
              <ToggleBtn key={v} label={l} active={lostDist===v} onClick={() => {
                setLostDist(v as "local"|"prof"|"custom");
                if (v==="local")      { setLostLocal("100"); setLostProf("0"); }
                else if (v==="prof")  { setLostLocal("0");   setLostProf("100"); }
              }} />
            ))}
          </div>

          {lostDist==="custom" && (
            <div className="mt-2 p-4 rounded-xl bg-white/[0.02] ring-1 ring-white/[0.06] space-y-3">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Distribución personalizada</div>
              <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-24">Local</span>
                  <input type="number" min="0" max="100" step="0.1" value={lostLocal}
                    onChange={e=>{const v=Math.min(100,Math.max(0,parseFloat(e.target.value)||0));setLostLocal(String(v));setLostProf(String(Math.round((100-v)*10)/10));}}
                    className="w-20 rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2 text-sm text-center focus:outline-none" />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-24">Profesional</span>
                  <input type="number" min="0" max="100" step="0.1" value={lostProf}
                    onChange={e=>{const v=Math.min(100,Math.max(0,parseFloat(e.target.value)||0));setLostProf(String(v));setLostLocal(String(Math.round((100-v)*10)/10));}}
                    className="w-20 rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2 text-sm text-center focus:outline-none" />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <div className={cn("text-xs font-semibold px-3 py-1 rounded-full",
                  parseInt(lostLocal)+parseInt(lostProf)===100
                    ? "bg-emerald-400/10 text-emerald-400 ring-1 ring-emerald-400/20"
                    : "bg-destructive/10 text-destructive ring-1 ring-destructive/20")}>
                  Total: {parseInt(lostLocal)+parseInt(lostProf)}%
                  {parseInt(lostLocal)+parseInt(lostProf)===100 ? " ✓" : " (debe ser 100%)"}
                </div>
              </div>
            </div>
          )}
        </Block>

        {/* Bloque 5: Mensaje */}
        <Block title="Mensaje para el cliente" subtitle="Se muestra al cliente al finalizar la reserva cuando se requiere seña. No se envía automáticamente.">
          <div className="relative">
            <textarea
              rows={4}
              value={msg}
              onChange={e => setMsg(e.target.value)}
              className="w-full rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-4 py-3.5 text-sm leading-relaxed focus:outline-none focus:ring-white/25 transition resize-none"
            />
            <div className="absolute bottom-3 right-3 text-[10px] text-muted-foreground/50">
              {msg.length} car.
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Podés usar saltos de línea. El mensaje se puede copiar y enviar por WhatsApp o mensaje de texto.
          </div>
        </Block>
      </>)}
    </div>
  );
}

function SettingsPage() {
  const [active, setActive] = useState<SectionId>("branding");

  return (
    <AppShell>
      <Topbar
        title="Configuración"
        subtitle="Personalizá tu negocio"
        action={
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("clippr:save-settings"))}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold bg-gradient-to-r from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)] text-black shadow-[0_8px_30px_-8px_oklch(0.78_0.17_65/0.5)] hover:opacity-95 transition"
          >
            Guardar <Check className="h-4 w-4" strokeWidth={3} />
          </button>
        }
      />
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
                        onClick={() => setActive(it.id)}
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
          </aside>

          {/* Content */}
          <section className="space-y-6">
            {active === "branding" && <BrandingSection />}

            {active === "horarios" && <HorariosSection />}
            {active === "equipo" && <EquipoSection />}
            {active === "servicios" && <ServiciosSection />}
            {active === "catalogo" && <CatalogoSection />}
            {active === "caja" && <CajaSection />}
            {active === "senas" && <SenasSection />}

            {active === "plan" && <PlanSection />}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

// ─────────── Plan & facturación ───────────
const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);

const founderPerks = [
  { icon: Rocket, label: "Acceso anticipado" },
  { icon: Sparkles, label: "Nuevas funciones primero" },
  { icon: Crown, label: "Insignia fundador" },
  { icon: Lock, label: "Precio congelado de por vida" },
];

type Billing = "mensual" | "anual";

const plans = [
  {
    id: "starter",
    name: "Starter",
    icon: UserIcon,
    tagline: "Para empezar solo.",
    monthly: 0,
    yearly: 0,
    badge: null as string | null,
    highlight: false,
    cta: "Tu plan actual",
    ctaDisabled: true,
    features: [
      "1 profesional",
      "Hasta 100 servicios mensuales",
      "1 sucursal",
      "Agenda online",
      "Gestión de clientes",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    icon: Rocket,
    tagline: "Para negocios que quieren crecer.",
    monthly: 29900,
    yearly: 299000,
    badge: "MÁS ELEGIDO",
    highlight: true,
    cta: "Continuar con Pro",
    ctaDisabled: false,
    features: [
      "Profesionales ilimitados",
      "Servicios ilimitados",
      "Caja y cobros",
      "Comisiones automáticas",
      "Estadísticas completas",
      "Historial financiero",
      "Soporte prioritario",
    ],
  },
  {
    id: "business",
    name: "Business",
    icon: Store,
    tagline: "Para negocios que quieren escalar.",
    monthly: 69900,
    yearly: 699000,
    badge: null,
    highlight: false,
    cta: "Elegir Business",
    ctaDisabled: false,
    features: [
      "2 sucursales o más",
      "Métricas por sucursal",
      "Comparativas avanzadas",
      "Permisos avanzados",
      "Roles personalizados",
      "Soporte prioritario 24/7",
    ],
  },
];

const trustItems = [
  {
    icon: ShieldCheck,
    title: "Sin permanencia",
    desc: "Cancelás cuando quieras.",
  },
  {
    icon: Cloud,
    title: "Tus datos siempre seguros",
    desc: "Almacenados en la nube.",
  },
  {
    icon: RefreshCw,
    title: "Actualizaciones incluidas",
    desc: "Nuevas funciones siempre.",
  },
  { icon: Headphones, title: "Soporte humano", desc: "Estamos para ayudarte." },
];

function PlanSection() {
  const [billing, setBilling] = useState<Billing>("mensual");
  const trialTotal = 90;
  const trialLeft = 63;
  const trialPct = ((trialTotal - trialLeft) / trialTotal) * 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Planes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Elegí el plan que mejor se adapte a tu negocio.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_oklch(0.78_0.15_150)]" />
          En vivo
        </div>
      </div>

      {/* Fundadores card */}
      <div className="relative overflow-hidden rounded-2xl ring-1 ring-[oklch(0.62_0.25_295/0.35)] bg-gradient-to-br from-[oklch(0.18_0.07_290)] via-[oklch(0.14_0.06_285)] to-[oklch(0.10_0.05_280)] p-6 shadow-[0_0_60px_-20px_oklch(0.62_0.25_295/0.5)]">
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[oklch(0.72_0.22_305/0.18)] blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-6">
          <div className="relative h-28 w-28 shrink-0 grid place-items-center rounded-2xl bg-gradient-to-br from-[oklch(0.72_0.22_305/0.2)] to-[oklch(0.55_0.27_285/0.1)] ring-1 ring-[oklch(0.62_0.25_295/0.4)]">
            <Shield
              className="h-14 w-14 text-[oklch(0.82_0.18_300)] drop-shadow-[0_0_12px_oklch(0.62_0.25_295/0.6)]"
              strokeWidth={1.4}
            />
            <Crown
              className="absolute h-6 w-6 text-[oklch(0.88_0.16_320)] top-7"
              strokeWidth={1.6}
            />
          </div>
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-semibold">Fundadores Clippr</h2>
              <span className="text-[10px] font-semibold tracking-wider px-2 py-1 rounded-md bg-[oklch(0.62_0.25_295/0.2)] text-[oklch(0.82_0.18_300)] ring-1 ring-[oklch(0.62_0.25_295/0.4)]">
                LIMITADO
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Accedé hoy y conservá tu{" "}
              <span className="text-[oklch(0.82_0.18_300)]">
                precio fundador congelado de por vida.
              </span>
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
              {founderPerks.map((p) => (
                <div
                  key={p.label}
                  className="flex items-center gap-2 rounded-lg bg-white/[0.03] ring-1 ring-white/10 px-3 py-2"
                >
                  <p.icon className="h-4 w-4 text-[oklch(0.82_0.18_300)] shrink-0" />
                  <span className="text-xs">{p.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>
                <span className="text-foreground font-medium">63 / 100</span>{" "}
                lugares disponibles
              </span>
            </div>
            <button className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)] text-white shadow-[0_8px_30px_-10px_oklch(0.62_0.25_295/0.8)] hover:brightness-110 transition">
              Quiero mi acceso <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Current plan banner */}
      <div className="glass rounded-2xl p-5 ring-1 ring-white/5 grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-5 items-center">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl grid place-items-center bg-gradient-to-br from-[oklch(0.72_0.22_305/0.2)] to-[oklch(0.55_0.27_285/0.1)] ring-1 ring-[oklch(0.62_0.25_295/0.3)]">
            <CalendarDays className="h-5 w-5 text-[oklch(0.82_0.18_300)]" />
          </div>
          <div className="flex-1">
            <div className="text-sm">
              Estás disfrutando tu plan{" "}
              <span className="text-[oklch(0.82_0.18_300)] font-medium">
                Pro
              </span>
            </div>
            <div className="text-xs text-[oklch(0.82_0.18_300)] mt-0.5">
              Prueba gratis
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Te quedan{" "}
              <span className="text-foreground font-medium">
                {trialLeft} días
              </span>{" "}
              de prueba gratis
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/5 mt-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)]"
                style={{ width: `${trialPct}%` }}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <button className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm bg-white/5 hover:bg-white/10 ring-1 ring-white/10">
            Ver mi plan <ChevronRight className="h-4 w-4" />
          </button>
          <div className="text-[11px] text-muted-foreground">
            Finaliza el 18 de agosto, 2026
          </div>
        </div>
        <div className="inline-flex items-center gap-1 rounded-xl bg-white/5 ring-1 ring-white/10 p-1">
          {(["mensual", "anual"] as Billing[]).map((b) => (
            <button
              key={b}
              onClick={() => setBilling(b)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs capitalize transition",
                billing === b
                  ? "bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)] text-white font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {b}
            </button>
          ))}
          <span className="px-2 text-[10px] text-emerald-400">
            Ahorrá 2 meses
          </span>
        </div>
      </div>

      {/* Pricing tiers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const price = billing === "mensual" ? plan.monthly : plan.yearly;
          const suffix = billing === "mensual" ? "/mes" : "/año";
          return (
            <div
              key={plan.id}
              className={cn(
                "relative rounded-2xl p-6 ring-1 transition",
                plan.highlight
                  ? "bg-gradient-to-b from-[oklch(0.18_0.07_290)] to-[oklch(0.10_0.05_280)] ring-[oklch(0.62_0.25_295/0.5)] shadow-[0_0_50px_-15px_oklch(0.62_0.25_295/0.6)]"
                  : "glass ring-white/5",
              )}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-semibold tracking-wider bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)] text-white">
                  <Star className="h-3 w-3 fill-current" /> {plan.badge}
                </div>
              )}
              <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-4">
                <div className="flex flex-col items-start gap-3">
                  <div
                    className={cn(
                      "h-12 w-12 rounded-xl grid place-items-center ring-1",
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
                    <div className="text-xl font-semibold">{plan.name}</div>
                    <div className="text-xs text-muted-foreground mt-1 max-w-[140px]">
                      {plan.tagline}
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="text-3xl font-semibold">
                      {price === 0 ? "$0" : fmtARS(price)}
                      {price > 0 && (
                        <span className="text-sm text-muted-foreground font-normal">
                          {suffix}
                        </span>
                      )}
                    </div>
                    <div
                      className={cn(
                        "text-xs mt-1",
                        plan.highlight
                          ? "text-[oklch(0.82_0.18_300)]"
                          : "text-muted-foreground",
                      )}
                    >
                      {price === 0
                        ? "Gratis para siempre"
                        : "Todo desbloqueado"}
                    </div>
                  </div>
                </div>
                <ul className="space-y-2 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check
                        className={cn(
                          "h-4 w-4 mt-0.5 shrink-0",
                          plan.highlight
                            ? "text-[oklch(0.82_0.18_300)]"
                            : "text-emerald-400/80",
                        )}
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                  <li className="text-xs text-[oklch(0.82_0.18_300)] pt-1">
                    y mucho más...
                  </li>
                </ul>
              </div>
              <button
                disabled={plan.ctaDisabled}
                className={cn(
                  "mt-6 w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition",
                  plan.ctaDisabled
                    ? "bg-white/5 ring-1 ring-white/10 text-muted-foreground cursor-not-allowed"
                    : plan.highlight
                      ? "bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)] text-white shadow-[0_8px_30px_-10px_oklch(0.62_0.25_295/0.8)] hover:brightness-110"
                      : "bg-white/5 hover:bg-white/10 ring-1 ring-white/10",
                )}
              >
                {plan.cta}{" "}
                {!plan.ctaDisabled && <ChevronRight className="h-4 w-4" />}
              </button>
              {!plan.ctaDisabled && (
                <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                  <Lock className="h-3 w-3" /> Sin permanencia. Cancelás cuando
                  quieras.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Trust strip */}
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
