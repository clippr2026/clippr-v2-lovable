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
import { PlanSection } from "@/components/settings/plan-section";
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

export const Route = createFileRoute("/settings")({ component: SettingsPage });
