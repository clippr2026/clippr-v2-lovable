import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
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
  ChevronDown,
  Mail,
  Instagram,
  GripVertical,
  Zap,
  Banknote,
  Landmark,
  CreditCard,
  Wallet,
  PiggyBank,
  Rocket,
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
  Moon,
  Sun,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ServiceImage } from "@/components/ui/service-image";
import { SpecialHoursEditor } from "@/components/settings/special-hours-editor";
import type {
  SpecialDateMap,
  EmployeeSpecialDateMap,
} from "@/components/agenda/use-agenda-data";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import { ReservasOnlineIcon, BrandingSection } from "@/components/settings/branding-section";
import { HorariosSection } from "@/components/settings/horarios-section";
import { EquipoSection } from "@/components/settings/equipo-section";
import { ServiciosSection, CatalogoSection } from "@/components/settings/price-catalog-section";
import { CuentaSection } from "@/components/settings/cuenta-section";
import { CajaSection } from "@/components/settings/caja-section";
import {
  SectionCard,
  reportSaveStatus,
  processImage,
  Toggle,
  ConfirmDialog,
  Field,
  inputCls,
  normalizePublicBooleanMap,
  getPublicVisibility,
  type PriceRow,
} from "@/components/settings/shared";



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

// ─────────── shared bits ───────────


// ─────────── Indicador de guardado discreto ───────────
// Reemplaza los toasts de "Guardado" para autoguardados. Cada guardado en
// segundo plano dispara este evento en vez de toast.success/toast.error;
// SaveStatusIndicator (montado una sola vez en SettingsPage) lo escucha y
// muestra "Guardando…" / "Guardado" abajo a la derecha, desapareciendo solo.

function SaveStatusIndicator() {
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        { status?: "saving" | "saved" } | undefined;
      if (!detail?.status) return;
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setStatus(detail.status);
      if (detail.status === "saved") {
        hideTimerRef.current = window.setTimeout(() => setStatus("idle"), 1600);
      }
    };
    window.addEventListener("clippr:save-status", handler);
    return () => {
      window.removeEventListener("clippr:save-status", handler);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (status === "idle") return null;

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-xs text-white/80 ring-1 ring-white/10 backdrop-blur-sm animate-fade-up">
      {status === "saving" ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Guardando…
        </>
      ) : (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          Guardado
        </>
      )}
    </div>
  );
}



function SettingsPage() {
  const [active, setActive] = useState<SectionId>("branding");

  function saveCurrentSection() {
    window.dispatchEvent(
      new CustomEvent("clippr:save-settings", {
        detail: { section: active, silent: true },
      }),
    );
  }

  function requestSectionChange(section: SectionId) {
    if (section === active) return;
    // Guardado silencioso al cambiar de sección. No bloquea la navegación
    // ni muestra el modal de "Tenés cambios sin guardar". Los modales/paneles
    // con botón propio siguen guardando con su acción explícita.
    saveCurrentSection();
    setActive(section);
  }

  return (
    <AppShell>
      <SaveStatusIndicator />
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

  const save = useCallback(async (showToast = true) => {
    if (!businessId) return;
    if (!showToast) reportSaveStatus("saving");
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
      if (showToast) toast.success("Configuración de clientes guardada");
      else reportSaveStatus("saved");
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
      const detail = (e as CustomEvent).detail ?? {};
      const section = detail?.section;
      const silent = detail?.silent === true;
      if (!section || section === "clientes") void saveRef.current(!silent);
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
