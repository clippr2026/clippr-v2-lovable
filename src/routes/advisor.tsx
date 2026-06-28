import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import { useAuth } from "@/hooks/use-auth";
import { AccessDenied, usePermGuard } from "@/hooks/use-perm-guard";
import { fmtAR } from "@/components/dashboard/use-dashboard-data";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useClientsData, type Client } from "@/hooks/use-clients-data";
import { useRejectedAnalytics } from "@/hooks/use-rejected-analytics";
import { TIER_EMOJI, buildDemandRecommendations } from "@/lib/rejected-analytics";
import { type RecommendationAchievement } from "@/hooks/use-ai-recommendations";
import type {
  Recommendation,
  RecommendationContact,
  RecommendationTone,
  RecommendationPriority,
} from "@/lib/ai-recommendation-engine";
import {
  AlertTriangle,
  Brain,
  BarChart2,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MessageCircle,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  DollarSign,
  TrendingDown,
  ChevronDown,
  ArrowRight,
  Activity,
  CalendarDays,
  Scissors,
  Gem,
  Package,
  Crown,
  UserX,
  Clock,
  Gift,
  BadgePercent,
  Wallet,
  Trophy,
  CircleHelp,
  Tag,
  BriefcaseBusiness,
} from "lucide-react";

export const Route = createFileRoute("/advisor")({
  head: () => ({
    meta: [
      { title: "Asesor IA — Clippr" },
      { name: "description", content: "Análisis inteligente para mejorar el negocio." },
    ],
  }),
  component: AdvisorRoute,
});

type ActionTone = "money" | "warning" | "growth" | "client" | "neutral";

type AdvisorAction = {
  id: string;
  title: string;
  detail: string;
  impact: string;
  impactAmount: string;
  impactExplanation: string;
  button: string;
  tone: ActionTone;
  problem: string;
  opportunity: string;
  howToAct: string[];
  suggestedMessage: string;
  actionButtons: string[];
  score: number;
  status: "pending" | "running" | "completed" | "archived";
  startedAt?: number;
  completedAt?: number;
  area: "Clientes" | "Agenda" | "Ventas" | "Equipo" | "Caja";
  metricLabel: string;
  metricValue: string;
  objective: string;
  priorityLabel: string;
  priorityTone: "max" | "high" | "medium";
  icon: React.ComponentType<{ className?: string }>;
  occupancyOptions?: {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    recommended?: boolean;
    discount?: number;
    message?: string;
  }[];
};

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

type StoredAdvisorStatus = {
  status: AdvisorAction["status"];
  startedAt?: number;
  completedAt?: number;
};

function getStoredAdvisorStatuses(): Record<string, StoredAdvisorStatus> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem("clippr_advisor_action_statuses_demo_v2");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredAdvisorStatuses(statuses: Record<string, StoredAdvisorStatus>) {
  if (typeof window === "undefined") return;
  localStorage.setItem("clippr_advisor_action_statuses_demo_v2", JSON.stringify(statuses));
}

function sortAdvisorActions(actions: AdvisorAction[]) {
  return [...actions].sort((a, b) => b.score - a.score);
}

function getDaysAgo(timestamp?: number) {
  if (!timestamp) return "Hoy";
  const diff = Date.now() - timestamp;
  const days = Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
  if (days <= 0) return "Hoy";
  if (days === 1) return "Hace 1 día";
  return `Hace ${days} días`;
}

function getPriorityToneClasses(tone: AdvisorAction["priorityTone"]) {
  if (tone === "max") return "border-violet-300/35 bg-violet-400/10 text-violet-200";
  if (tone === "high") return "border-blue-300/30 bg-blue-400/10 text-blue-200";
  return "border-orange-300/30 bg-orange-400/10 text-orange-200";
}

function getAreaIcon(area: AdvisorAction["area"]) {
  switch (area) {
    case "Clientes":
      return Users;
    case "Agenda":
      return CalendarDays;
    case "Ventas":
      return DollarSign;
    case "Equipo":
      return BriefcaseBusiness;
    case "Caja":
      return Wallet;
    default:
      return Target;
  }
}

type InfoModalContent = {
  title: string;
  description: string;
  points: string[];
};

const INFO_CONTENT = {
  health: {
    title: "Estado actual del negocio",
    description:
      "Resume la salud general del negocio en un puntaje simple de 0 a 100, combinando rentabilidad, clientes, ocupación y oportunidades pendientes.",
    points: [
      "82/100 indica que el negocio está saludable, pero todavía tiene margen para crecer.",
      "El puntaje sube cuando mejora la utilidad, aumentan los clientes, se ocupa mejor la agenda y baja la cantidad de oportunidades perdidas.",
      "Los factores de la derecha muestran qué está empujando el resultado: utilidad, captación de clientes y ocupación.",
      "Las alertas inferiores marcan oportunidades concretas: clientes para recuperar y turnos disponibles sin ocupar.",
      "Este diagnóstico sirve para decidir rápido dónde enfocar acciones comerciales esta semana.",
    ],
  },
  growth: {
    title: "Evolución del negocio",
    description:
      "Mide cómo evolucionó la utilidad del negocio frente al mes anterior — tanto mejoras como caídas.",
    points: [
      "Fórmula: utilidad actual vs utilidad del mes anterior.",
      "Utilidad = facturación - gastos - comisiones.",
      "Clientes, ticket y ocupación explican qué impulsó la evolución.",
    ],
  },
  clients: {
    title: "Clientes nuevos",
    description: "Compara los clientes atendidos este mes contra el mes anterior.",
    points: [
      "Ejemplo: 45 clientes vs 39 clientes.",
      "Sirve para ver si el negocio atrae más movimiento.",
      "No reemplaza la utilidad: solo explica parte del crecimiento.",
    ],
  },
  ticket: {
    title: "Ticket promedio",
    description: "Muestra cuánto gasta en promedio cada cliente.",
    points: [
      "Fórmula: facturación total dividida por clientes atendidos.",
      "Si sube el ticket, podés ganar más sin sumar más turnos.",
      "También ayuda a detectar oportunidades de combos o productos.",
    ],
  },
  occupancy: {
    title: "Ocupación",
    description: "Indica qué porcentaje de horarios disponibles fueron utilizados.",
    points: [
      "Fórmula: horarios ocupados divididos por horarios disponibles.",
      "Una ocupación baja muestra espacios que se pueden llenar.",
      "Una ocupación alta permite pensar en subir precios o sumar equipo.",
    ],
  },
} satisfies Record<string, InfoModalContent>;

const DEMO = {
  month: "Junio 2026",
  previousMonth: "Mayo 2026",
  growth: 18,
  health: 82,
  revenue: 4086573,
  previousRevenue: 3462000,
  profit: 1843200,
  previousProfit: 1560000,
  margin: 45,
  clients: 43,
  previousClients: 37,
  activeClients: 23,
  vipClients: 2,
  inactiveClients: 27,
  payments: 67,
  ticket: 60994,
  previousTicket: 55500,
  occupancy: 62,
  previousOccupancy: 54,
  emptySlotsTomorrow: 14,
  freeSlotsMonth: 144,
  pendingPayments: 5,
  unconfirmedAppointments: 8,
  vipInactive: 3,
  lowDay: "martes",
};

// ── Datos del rubro para la pestaña ANÁLISIS (barberías y peluquerías) ──
// Solo se usan en esta pestaña. No tocan el resto de la app.
const ANALISIS_BENCHMARK = 78; // mejor que el X% de barberías/peluquerías similares

const RADAR_LOCAL: {
  tone: "ok" | "warn" | "alert" | "bad";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { tone: "ok", icon: TrendingUp, label: "Utilidad creciendo (+30% vs mes anterior)" },
  { tone: "ok", icon: Users, label: "Nuevos clientes creciendo (+16%)" },
  {
    tone: "warn",
    icon: CalendarDays,
    label: `${DEMO.lowDay.charAt(0).toUpperCase() + DEMO.lowDay.slice(1)} con baja ocupación`,
  },
  { tone: "alert", icon: Users, label: `${DEMO.inactiveClients} clientes para recuperar` },
  { tone: "bad", icon: Package, label: "Venta de productos baja (6%)" },
];

const RADIOGRAFIA_LOCAL: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
}[] = [
  {
    icon: Users,
    label: "Clientes para recuperar",
    value: String(DEMO.inactiveClients),
    tone: "warn",
  },
  {
    icon: CalendarDays,
    label: "Turnos vacíos este mes",
    value: String(DEMO.freeSlotsMonth),
    tone: "warn",
  },
  { icon: TrendingUp, label: "Profesional con mayor ocupación", value: "Alan", tone: "good" },
  { icon: TrendingDown, label: "Profesional con menor ocupación", value: "Juan", tone: "warn" },
  { icon: Scissors, label: "Servicio más vendido", value: "Corte clásico" },
  { icon: Gem, label: "Servicio más rentable", value: "Color", tone: "good" },
  { icon: Package, label: "Venta de productos", value: "6%", tone: "bad" },
  { icon: Crown, label: "Clientes VIP", value: "18", tone: "good" },
];

const MONTH_INSIGHTS: Record<
  string,
  { badge: string; mejora: string; problema: string; resumen: string }
> = {
  "Junio 2026": {
    badge: "Mejor mes del trimestre",
    mejora: "Más clientes nuevos",
    problema: `${DEMO.inactiveClients} clientes inactivos`,
    resumen:
      "La IA detectó un crecimiento sostenido impulsado por una mayor ocupación y un mejor ticket promedio.",
  },
  "Mayo 2026": {
    badge: "Recuperación",
    mejora: "Mayor ticket promedio",
    problema: "Baja ocupación",
    resumen:
      "La facturación comenzó a recuperarse, aunque la ocupación siguió por debajo del objetivo.",
  },
  "Abril 2026": {
    badge: "Ocupación baja",
    mejora: "Más reservas online",
    problema: "Poca fidelización",
    resumen: "La principal causa fue la caída de reservas durante la segunda quincena.",
  },
};

const RADAR_STYLES: Record<
  "ok" | "warn" | "alert" | "bad",
  { icon: string; ring: string; text: string; bg: string }
> = {
  ok: {
    icon: "text-emerald-300",
    ring: "border-emerald-400/20 bg-emerald-400/[0.05]",
    text: "text-emerald-200",
    bg: "bg-emerald-400/10",
  },
  warn: {
    icon: "text-amber-300",
    ring: "border-amber-400/20 bg-amber-400/[0.05]",
    text: "text-amber-200",
    bg: "bg-amber-400/10",
  },
  alert: {
    icon: "text-orange-300",
    ring: "border-orange-400/20 bg-orange-400/[0.05]",
    text: "text-orange-200",
    bg: "bg-orange-400/10",
  },
  bad: {
    icon: "text-rose-300",
    ring: "border-rose-400/20 bg-rose-400/[0.05]",
    text: "text-rose-200",
    bg: "bg-rose-400/10",
  },
};

function AdvisorRoute() {
  const hasAccess = usePermGuard("dashboard");
  const { loading, session } = useAuth();
  const navigate = useNavigate();
  const [advisorTab, setAdvisorTab] = React.useState<"acciones" | "analisis" | "simuladores">(
    "analisis",
  );
  const [priorityOpen, setPriorityOpen] = React.useState(false);
  const [analysisStarted, setAnalysisStarted] = React.useState(() => {
    if (typeof window === "undefined") return false;
    const today = new Date().toISOString().slice(0, 10);
    return localStorage.getItem("clippr_advisor_last_daily_analysis") === today;
  });
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);

  React.useEffect(() => {
    if (!loading && !session) navigate({ to: "/login", replace: true });
  }, [loading, session, navigate]);

  if (!hasAccess) return <AccessDenied />;

  if (loading || !session) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="text-sm text-muted-foreground">Cargando…</div>
      </div>
    );
  }

  const priorityAction = getDemoActions(true)[0] ?? null;

  return (
    <AppShell>
      <div className="app-premium-shell">
        <div className="pointer-events-none absolute left-1/2 top-[-120px] z-[-1] h-[620px] w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_17%_4%,rgb(139_92_246_/_0.34),transparent_38%),radial-gradient(circle_at_76%_0%,rgb(79_125_255_/_0.30),transparent_36%),radial-gradient(circle_at_46%_96%,rgb(255_123_229_/_0.14),transparent_50%)] blur-[16px]" />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Topbar title="Asesor IA" subtitle="Análisis diario y crecimiento del negocio" />
          {analysisStarted && !isAnalyzing && (
            <div className="relative flex w-full items-center justify-end sm:w-auto">
              <div className="pointer-events-none absolute -inset-3 rounded-[30px] bg-gradient-to-r from-cyan-500/15 via-violet-500/12 to-emerald-500/12 blur-2xl" />
              <div className="relative flex max-w-full items-center gap-2 overflow-x-auto rounded-[24px] border border-white/12 bg-[#070b18]/75 p-2 shadow-[0_18px_65px_rgba(14,165,233,0.16),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl">
                {(
                  [
                    {
                      key: "analisis",
                      icon: BarChart2,
                      label: "Análisis",
                      active:
                        "from-cyan-400/25 via-blue-500/18 to-indigo-500/20 text-cyan-100 ring-cyan-300/35 shadow-cyan-500/20",
                      idle: "hover:text-cyan-100 hover:ring-cyan-300/20 hover:bg-cyan-400/8",
                    },
                    {
                      key: "acciones",
                      icon: Brain,
                      label: "Gerente IA",
                      active:
                        "from-fuchsia-400/25 via-violet-500/18 to-indigo-500/20 text-fuchsia-100 ring-fuchsia-300/35 shadow-fuchsia-500/20",
                      idle: "hover:text-fuchsia-100 hover:ring-fuchsia-300/20 hover:bg-fuchsia-400/8",
                    },
                    {
                      key: "simuladores",
                      icon: DollarSign,
                      label: "Simuladores",
                      active:
                        "from-emerald-400/25 via-teal-500/18 to-cyan-500/20 text-emerald-100 ring-emerald-300/35 shadow-emerald-500/20",
                      idle: "hover:text-emerald-100 hover:ring-emerald-300/20 hover:bg-emerald-400/8",
                    },
                  ] as const
                ).map((t) => {
                  const active = advisorTab === t.key;
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setAdvisorTab(t.key)}
                      className={cn(
                        "group relative min-h-[48px] overflow-hidden rounded-[18px] px-4 py-3 text-sm font-bold tracking-[-0.01em] transition-all duration-300 ring-1 ring-white/10 sm:px-5",
                        "before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/55 before:to-transparent before:opacity-0 before:transition-opacity",
                        "after:absolute after:inset-0 after:bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.16),transparent_48%)] after:opacity-0 after:transition-opacity",
                        active
                          ? cn(
                              "bg-gradient-to-br shadow-[0_16px_42px_var(--tw-shadow-color)] before:opacity-100 after:opacity-100 scale-[1.01]",
                              t.active,
                            )
                          : cn(
                              "text-muted-foreground bg-white/[0.035] hover:-translate-y-0.5 hover:ring-1 hover:shadow-[0_12px_30px_rgba(15,23,42,0.35)]",
                              t.idle,
                            ),
                      )}
                    >
                      <span className="relative z-10 flex items-center gap-2 whitespace-nowrap">
                        <span
                          className={cn(
                            "grid h-7 w-7 place-items-center rounded-full text-[14px] transition-all",
                            active
                              ? "bg-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_18px_rgba(255,255,255,0.10)]"
                              : "bg-white/[0.06] group-hover:bg-white/12",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span>{t.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <AdvisorContent
          advisorTab={advisorTab}
          setAdvisorTab={setAdvisorTab}
          analysisStarted={analysisStarted}
          setAnalysisStarted={setAnalysisStarted}
          isAnalyzing={isAnalyzing}
          setIsAnalyzing={setIsAnalyzing}
        />
      </div>
    </AppShell>
  );
}

function AdvisorContent({
  advisorTab,
  setAdvisorTab: _setAdvisorTab,
  analysisStarted,
  setAnalysisStarted,
  isAnalyzing,
  setIsAnalyzing,
}: {
  advisorTab: "acciones" | "analisis" | "simuladores";
  setAdvisorTab: (t: "acciones" | "analisis" | "simuladores") => void;
  analysisStarted: boolean;
  setAnalysisStarted: (v: boolean) => void;
  isAnalyzing: boolean;
  setIsAnalyzing: (v: boolean) => void;
}) {
  const { businessId } = useAuth();
  const [shouldAnimateResults, setShouldAnimateResults] = React.useState(false);
  const animationProgress = useResultAnimation(shouldAnimateResults);
  const [infoModal, setInfoModal] = React.useState<InfoModalContent | null>(null);
  const todayKey = getTodayKey();

  const [analysisStep, setAnalysisStep] = React.useState(0);
  const [reports, setReports] = React.useState<
    Array<{ month: string; health: number; growth: number; profit: number; revenue: number }>
  >(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("clippr_advisor_monthly_reports_demo");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return [];
  });

  React.useEffect(() => {
    if (!isAnalyzing) return;

    const steps = ["Ventas", "Clientes", "Agenda", "Generando recomendaciones"];

    let index = 0;
    setAnalysisStep(0);

    const interval = window.setInterval(() => {
      index += 1;
      setAnalysisStep(index);

      if (index >= steps.length) {
        window.clearInterval(interval);
        localStorage.setItem("clippr_advisor_last_daily_analysis", todayKey);
        setTimeout(() => {
          setShouldAnimateResults(true);
          setIsAnalyzing(false);
        }, 800);
      }
    }, 1400);

    return () => window.clearInterval(interval);
  }, [isAnalyzing, todayKey]);

  React.useEffect(() => {
    const hasCurrentMonth = reports.some((report) => report.month === DEMO.month);
    if (hasCurrentMonth) return;

    const nextReports = [
      {
        month: DEMO.month,
        health: DEMO.health,
        growth: DEMO.growth,
        profit: DEMO.profit,
        revenue: DEMO.revenue,
      },
      ...reports,
    ].slice(0, 6);

    setReports(nextReports);
    if (typeof window !== "undefined") {
      localStorage.setItem("clippr_advisor_monthly_reports_demo", JSON.stringify(nextReports));
    }
  }, [reports]);

  const [showExtraRecommendation] = React.useState(true);
  const [resolvedRecommendations, setResolvedRecommendations] = React.useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("clippr_advisor_resolved_recommendations_demo");
    if (!saved) return [];
    try {
      return JSON.parse(saved);
    } catch {
      return [];
    }
  });

  const healthTone = getHealthTone(DEMO.health);
  const healthHeadline =
    DEMO.health >= 80
      ? "Excelente"
      : DEMO.health >= 65
        ? "Muy bien"
        : DEMO.health >= 50
          ? "Aceptable"
          : "Necesita atención";
  const animatedHealth = Math.round(DEMO.health * animationProgress);
  const animatedProfit = Math.round(DEMO.profit * animationProgress);

  function handleResolveRecommendation(action: AdvisorAction) {
    setResolvedRecommendations((current) => {
      if (current.includes(action.title)) return current;
      const next = [...current, action.title];
      if (typeof window !== "undefined") {
        localStorage.setItem("clippr_advisor_resolved_recommendations_demo", JSON.stringify(next));
      }
      return next;
    });
  }

  function handleResetRecommendations() {
    setResolvedRecommendations([]);
    if (typeof window !== "undefined") {
      localStorage.removeItem("clippr_advisor_resolved_recommendations_demo");
    }
  }

  if (!analysisStarted) {
    return (
      <StartAnalysis
        onStart={() => {
          setAnalysisStarted(true);
          setIsAnalyzing(true);
        }}
      />
    );
  }

  if (isAnalyzing) {
    return <AnalysisLoader step={analysisStep} />;
  }

  return (
    <div className="space-y-7 max-w-5xl mx-auto w-full">
      {advisorTab === "simuladores" && (
        <SimuladoresTab
          servicios={DEMO.payments}
          facturacion={DEMO.revenue}
          ticket={DEMO.ticket}
          clientes={DEMO.clients}
          ocupacion={DEMO.occupancy}
          businessId={businessId}
        />
      )}

      {advisorTab === "acciones" && <GrowthManagerTab businessId={businessId} />}

      {advisorTab === "analisis" && (
        <>
          {/* ── SALUD DEL NEGOCIO ─────────────────────────────────── */}
          <div className="relative rounded-[2rem] border border-emerald-300/[0.30] bg-white/[0.018] p-3 shadow-[0_0_0_1px_rgba(16,185,129,0.16),0_30px_125px_-42px_rgba(45,212,191,1)] sm:p-4">
            <div className="pointer-events-none absolute -inset-x-6 -top-8 h-24 rounded-full bg-emerald-400/[0.16] blur-3xl" />
            {/* Separador de sección */}
            <div className="relative flex items-center gap-4 mb-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <span className="rounded-full border border-white/10 bg-white/[0.045] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60">
                Salud del negocio
              </span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
            </div>
            <GlassCard className="relative overflow-hidden p-5 sm:p-6 border border-emerald-300/[0.32] bg-white/[0.052] shadow-[0_0_0_1px_rgba(45,212,191,0.16),0_35px_125px_-40px_rgba(45,212,191,1)]">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                    Estado actual
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Rentabilidad, clientes y ocupación del período.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInfoModal(INFO_CONTENT.health)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-emerald-300/35 bg-emerald-300/10 text-xs font-bold text-emerald-300 shadow-[0_0_22px_rgba(45,212,191,0.18)] transition hover:bg-emerald-300/20 hover:text-white"
                  aria-label="Información de estado actual"
                >
                  i
                </button>
              </div>

              <div className="grid md:grid-cols-[0.95fr_1.05fr] gap-5 items-center">
                {/* Left: circular gauge + bar */}
                <div className="flex flex-col items-center gap-4">
                  <div className="relative flex items-center justify-center">
                    {/* SVG ring */}
                    <svg width="200" height="200" viewBox="0 0 200 200" className="-rotate-90">
                      {/* Track */}
                      <circle
                        cx="100"
                        cy="100"
                        r="84"
                        fill="none"
                        stroke="rgba(255,255,255,0.08)"
                        strokeWidth="14"
                      />
                      {/* Progress */}
                      <circle
                        cx="100"
                        cy="100"
                        r="84"
                        fill="none"
                        stroke="url(#healthGrad)"
                        strokeWidth="14"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 84}`}
                        strokeDashoffset={`${2 * Math.PI * 84 * (1 - animatedHealth / 100)}`}
                        className="transition-all duration-700"
                      />
                      <defs>
                        <linearGradient id="healthGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#4ade80" />
                          <stop offset="100%" stopColor="#818cf8" />
                        </linearGradient>
                      </defs>
                    </svg>
                    {/* Center text */}
                    <div className="absolute flex flex-col items-center">
                      <span
                        className={cn(
                          "font-display text-6xl font-bold leading-none",
                          healthTone.text,
                        )}
                      >
                        {animatedHealth}
                      </span>
                      <span className="text-sm text-muted-foreground mt-1">/100</span>
                    </div>
                  </div>
                  {/* Info below circle */}
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground">Puntaje de salud</div>
                    <div className={cn("mt-1 text-2xl font-bold", healthTone.text)}>
                      {healthHeadline}
                    </div>
                    <div className="mx-auto mt-3 max-w-[310px] space-y-5 text-center">
                      <p className="text-xs font-semibold leading-relaxed text-emerald-300/90">
                        Mejor que el {ANALISIS_BENCHMARK}% de las barberías y peluquerías similares.
                      </p>

                      <div className="h-px bg-white/10" />

                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Tu local está sólido. El próximo salto está en llenar la agenda y recuperar
                        clientes, no en bajar precios.
                      </p>

                      <div>
                        <div className="mb-2 flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                          <Brain className="h-3.5 w-3.5" /> Insight IA
                        </div>
                        <div className="space-y-1.5 text-xs leading-relaxed text-white/72">
                          <p>La principal oportunidad detectada está en la ocupación.</p>
                          <p>
                            Tenés{" "}
                            <span className="font-semibold text-white">
                              {DEMO.freeSlotsMonth} turnos disponibles
                            </span>{" "}
                            este mes.
                          </p>
                          <p>
                            Si alcanzás una ocupación del{" "}
                            <span className="font-semibold text-white">75%</span>, podrías generar
                            aproximadamente{" "}
                            <span className="font-semibold text-emerald-300">
                              {fmtAR(Math.round(DEMO.freeSlotsMonth * 0.21 * DEMO.ticket))}
                            </span>{" "}
                            adicionales sin incorporar más personal.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full h-2.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={cn(
                        "h-full rounded-full bg-gradient-to-r transition-all duration-700",
                        healthTone.bar,
                      )}
                      style={{ width: `${animatedHealth}%` }}
                    />
                  </div>
                </div>

                {/* Right: impact panel */}
                <div className="rounded-2xl border border-emerald-300/[0.13] bg-white/[0.035] p-5 h-full shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
                  <div className="mb-4 flex items-center gap-2 text-base font-semibold">
                    <Activity className="h-4 w-4 text-emerald-300" /> Radar del local
                  </div>
                  <div className="space-y-2">
                    {RADAR_LOCAL.map((item) => {
                      const style = RADAR_STYLES[item.tone];
                      const Icon = item.icon;
                      return (
                        <div
                          key={item.label}
                          className={cn(
                            "flex items-center gap-3 rounded-xl border px-3 py-2",
                            style.ring,
                          )}
                        >
                          <span
                            className={cn(
                              "grid h-7 w-7 shrink-0 place-items-center rounded-lg",
                              style.bg,
                            )}
                          >
                            <Icon className={cn("h-4 w-4", style.icon)} />
                          </span>
                          <span className="text-sm text-white/85">{item.label}</span>
                        </div>
                      );
                    })}
                    <p className="pt-1 text-[11px] leading-relaxed text-white/40">
                      La IA marca en verde lo que va bien y en naranja/rojo lo que te está costando
                      plata. Empezá por lo rojo.
                    </p>
                  </div>
                </div>
              </div>
            </GlassCard>
          </div>
          {/* /Salud */}

          {/* ── EVOLUCIÓN DEL NEGOCIO ─────────────────────────────── */}
          <div className="relative rounded-[1.7rem] border border-sky-300/[0.30] bg-white/[0.018] p-2.5 shadow-[0_0_0_1px_rgba(56,189,248,0.16),0_24px_90px_-42px_rgba(14,165,233,0.9)] sm:p-3">
            <div className="pointer-events-none absolute -inset-x-6 -top-8 h-24 rounded-full bg-sky-400/[0.16] blur-3xl" />
            <div className="flex items-center gap-4 mb-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <span className="rounded-full border border-white/10 bg-white/[0.045] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60">
                Evolución del negocio
              </span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
            </div>
            <GlassCard className="p-4 sm:p-5 space-y-3 border border-sky-300/[0.32] bg-white/[0.052] shadow-[0_0_0_1px_rgba(56,189,248,0.16),0_35px_125px_-40px_rgba(14,165,233,1)]">
              <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                Resultados del período
              </h2>

              {/* Bloque superior: +18% */}
              <div className="relative flex items-center gap-4 rounded-2xl border border-white/[0.12] bg-white/[0.035] px-4 py-3">
                {/* Icono izquierda */}
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-400/12 ring-1 ring-sky-300/25">
                  <TrendingUp className="h-5 w-5 text-sky-300" />
                </div>
                {/* Textos */}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Crecimiento mensual
                  </div>
                  <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                    <span className="font-display text-4xl font-bold text-sky-300 leading-none">
                      +18%
                    </span>
                    <span className="text-sm text-muted-foreground">vs mes anterior</span>
                  </div>
                </div>
                {/* Info btn arriba derecha */}
                <button
                  type="button"
                  onClick={() => setInfoModal(INFO_CONTENT.growth)}
                  className="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-full border border-sky-300/40 bg-sky-300/10 text-xs font-bold text-sky-300 transition hover:bg-sky-300/20"
                  aria-label="Información de crecimiento"
                >
                  i
                </button>
              </div>

              {/* Etiqueta IMPULSADOS POR */}
              <div className="flex flex-col items-center gap-0.5 text-center">
                <div className="text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground">
                  Impulsados por
                </div>
                <div className="text-muted-foreground text-base leading-none">↓</div>
              </div>

              {/* 3 tarjetas: Clientes / Ticket / Ocupación */}
              <div className="grid md:grid-cols-3 gap-2.5">
                {/* Clientes nuevos */}
                <div className="rounded-2xl border border-white/[0.12] bg-white/[0.035] p-3 flex flex-col gap-2">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-400/10 ring-1 ring-violet-400/20">
                    <Users className="h-4 w-4 text-violet-400" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Clientes nuevos</div>
                    <div className="font-display text-3xl font-bold text-violet-300 mt-1 leading-none">
                      {Math.round(45 * animationProgress)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-violet-400/10 px-3 py-1.5">
                    <div className="text-sm font-bold text-violet-300">+16%</div>
                    <div className="text-xs text-muted-foreground">vs mes anterior</div>
                  </div>
                </div>

                {/* Ticket promedio */}
                <div className="rounded-2xl border border-white/[0.12] bg-white/[0.035] p-3 flex flex-col gap-2">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-sky-400/10 ring-1 ring-sky-400/20">
                    <DollarSign className="h-4 w-4 text-sky-400" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Ticket promedio</div>
                    <div className="font-display text-2xl font-bold text-sky-300 mt-1 leading-none">
                      {fmtAR(Math.round(DEMO.ticket * animationProgress))}
                    </div>
                  </div>
                  <div className="rounded-xl bg-sky-400/10 px-3 py-1.5">
                    <div className="text-sm font-bold text-sky-300">+10%</div>
                    <div className="text-xs text-muted-foreground">vs mes anterior</div>
                  </div>
                  <div className="rounded-xl border border-sky-300/15 bg-sky-300/[0.04] px-3 py-1.5 text-[11px]">
                    <div className="text-white/70">
                      Objetivo:{" "}
                      <span className="font-semibold text-sky-200">
                        {fmtAR(Math.round(DEMO.ticket * 1.2))}
                      </span>
                    </div>
                    <div className="mt-0.5 text-white/45">
                      Potencial: +{fmtAR(Math.round(DEMO.ticket * 0.2))} por cliente sumando barba y
                      productos al corte.
                    </div>
                  </div>
                </div>

                {/* Ocupación */}
                <div className="rounded-2xl border border-white/[0.12] bg-white/[0.035] p-3 flex flex-col gap-2">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-orange-400/10 ring-1 ring-orange-400/20">
                    <ClipboardList className="h-4 w-4 text-orange-400" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Ocupación</div>
                    <div className="font-display text-3xl font-bold text-orange-300 mt-1 leading-none">
                      {Math.round(DEMO.occupancy * animationProgress)}%
                    </div>
                  </div>
                  <div className="rounded-xl bg-orange-400/10 px-3 py-1.5">
                    <div className="text-sm font-bold text-orange-300">+8%</div>
                    <div className="text-xs text-muted-foreground">vs mes anterior</div>
                  </div>
                  <div className="rounded-xl border border-orange-300/15 bg-orange-300/[0.05] px-3 py-1.5 text-[11px]">
                    <div className="text-white/70">
                      Meta: <span className="font-semibold text-orange-200">75%</span> ·{" "}
                      {DEMO.freeSlotsMonth} turnos vacíos
                    </div>
                    <div className="mt-0.5 text-white/45">
                      Potencial: +{fmtAR(Math.round(DEMO.freeSlotsMonth * 0.21 * DEMO.ticket))} por
                      mes si los llenás.
                    </div>
                  </div>
                </div>
              </div>

              {/* Etiqueta GENERARON MÁS */}
              <div className="flex flex-col items-center gap-0.5 text-center">
                <div className="text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground">
                  Generaron más
                </div>
                <div className="text-muted-foreground text-base leading-none">↓</div>
              </div>

              {/* Bloque Utilidad gigante */}
              <div className="relative overflow-hidden rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.08] px-5 py-3.5 flex items-center justify-between gap-4">
                {/* Left */}
                <div className="z-10">
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 place-items-center rounded-2xl bg-emerald-400/15 ring-1 ring-emerald-400/25">
                      <DollarSign className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-300">
                      Utilidad
                    </div>
                    <span className="rounded-lg bg-emerald-400/15 px-2.5 py-1 text-xs font-bold text-emerald-300 ring-1 ring-emerald-400/25">
                      +30%
                    </span>
                  </div>
                  <div className="font-display text-3xl sm:text-4xl font-bold text-emerald-300 mt-2 leading-none">
                    {fmtAR(animatedProfit)}
                  </div>
                </div>
                {/* Right: sparkline SVG */}
                <div className="shrink-0 opacity-80">
                  <svg width="120" height="60" viewBox="0 0 160 80" fill="none">
                    <defs>
                      <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4ade80" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M0 70 C30 65, 50 55, 70 45 S110 20, 160 5"
                      stroke="#4ade80"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      fill="none"
                    />
                    <path
                      d="M0 70 C30 65, 50 55, 70 45 S110 20, 160 5 L160 80 L0 80 Z"
                      fill="url(#sparkFill)"
                    />
                    <circle cx="160" cy="5" r="5" fill="#4ade80" />
                  </svg>
                </div>
              </div>
            </GlassCard>
          </div>
          {/* /Evolución */}

          {/* ── RADIOGRAFÍA DEL LOCAL ─────────────────────────────── */}
          <div className="relative rounded-[2rem] border border-fuchsia-300/[0.22] bg-white/[0.016] p-3 shadow-[0_0_0_1px_rgba(217,70,239,0.12),0_28px_110px_-50px_rgba(217,70,239,0.8)] sm:p-4">
            <div className="pointer-events-none absolute -inset-x-6 -top-8 h-24 rounded-full bg-fuchsia-500/[0.12] blur-3xl" />
            <div className="flex items-center gap-4 mb-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <span className="rounded-full border border-white/10 bg-white/[0.045] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60">
                Radiografía del local
              </span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
            </div>
            <GlassCard className="p-5 sm:p-6 border border-fuchsia-300/[0.2] bg-white/[0.05] shadow-[0_0_0_1px_rgba(217,70,239,0.1),0_35px_120px_-44px_rgba(217,70,239,0.7)]">
              <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                Tu negocio de un vistazo
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Los números que un dueño de barbería o peluquería mira todos los días.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {RADIOGRAFIA_LOCAL.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.label}
                      className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.045]"
                    >
                      <div
                        className={cn(
                          "grid h-10 w-10 place-items-center rounded-xl ring-1",
                          item.tone === "good"
                            ? "bg-emerald-400/10 ring-emerald-400/20 text-emerald-300"
                            : item.tone === "warn"
                              ? "bg-amber-400/10 ring-amber-400/20 text-amber-300"
                              : item.tone === "bad"
                                ? "bg-rose-400/10 ring-rose-400/20 text-rose-300"
                                : "bg-white/[0.05] ring-white/10 text-white/75",
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div
                        className={cn(
                          "mt-3 text-2xl font-bold leading-none",
                          item.tone === "good"
                            ? "text-emerald-300"
                            : item.tone === "warn"
                              ? "text-amber-300"
                              : item.tone === "bad"
                                ? "text-rose-300"
                                : "text-white",
                        )}
                      >
                        {item.value}
                      </div>
                      <div className="mt-1.5 text-xs leading-snug text-muted-foreground">
                        {item.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          </div>
          {/* /Radiografía */}

          {/* ── HISTORIAL DE ANÁLISIS ─────────────────────────────── */}
          <div className="relative rounded-[2rem] border border-violet-300/[0.13] bg-white/[0.014] p-3 shadow-[0_0_0_1px_rgba(139,92,246,0.05),0_24px_90px_-52px_rgba(124,58,237,0.55)] sm:p-4">
            <div className="pointer-events-none absolute -inset-x-6 -top-8 h-24 rounded-full bg-violet-500/[0.06] blur-3xl" />
            <div className="flex items-center gap-4 mb-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <span className="rounded-full border border-white/10 bg-white/[0.045] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60">
                Historial de análisis
              </span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
            </div>
            <GlassCard className="relative overflow-hidden p-5 sm:p-6 border border-violet-300/[0.16] bg-white/[0.045] shadow-[0_0_0_1px_rgba(139,92,246,0.06),0_30px_100px_-52px_rgba(124,58,237,0.7)]">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                <div>
                  <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                    Informes mensuales
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Clippr guarda un informe al comenzar cada mes. No necesitás tocar ningún botón.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-muted-foreground shrink-0">
                  Próximo informe: <span className="font-semibold text-white">1 de julio</span>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {[
                  ...reports,
                  ...(reports.some((r) => r.month === "Mayo 2026")
                    ? []
                    : [
                        {
                          month: "Mayo 2026",
                          health: 76,
                          growth: 12,
                          profit: 1420000,
                          revenue: 3100000,
                        },
                      ]),
                  ...(reports.some((r) => r.month === "Abril 2026")
                    ? []
                    : [
                        {
                          month: "Abril 2026",
                          health: 71,
                          growth: 8,
                          profit: 1180000,
                          revenue: 2780000,
                        },
                      ]),
                ]
                  .slice(0, 3)
                  .map((report) => {
                    const insight = MONTH_INSIGHTS[report.month];
                    const isPrimary = report.month === "Junio 2026";
                    const tone = getHealthTone(report.health);
                    return (
                      <div
                        key={report.month}
                        className={cn(
                          "relative flex flex-col rounded-2xl border p-4 transition-all",
                          isPrimary
                            ? "border-emerald-300/25 bg-emerald-300/[0.05] shadow-[0_0_0_1px_rgba(16,185,129,0.05),0_22px_70px_-46px_rgba(45,212,191,0.7)]"
                            : "border-white/10 bg-white/[0.026] hover:border-white/20",
                        )}
                      >
                        {isPrimary && (
                          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/45 to-transparent" />
                        )}
                        {/* Mes + Score */}
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-white">{report.month}</p>
                          <span className={cn("text-xs font-bold tabular-nums", tone.text)}>
                            {report.health}/100
                          </span>
                        </div>
                        {/* Estado del mes */}
                        <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/55">
                          {insight ? insight.badge : "Informe guardado"}
                        </p>
                        {/* Resumen escrito por la IA */}
                        <p className="mt-3 flex-1 text-xs leading-relaxed text-white/72">
                          {insight?.resumen ?? "Informe mensual generado por la IA de Clippr."}
                        </p>
                        {/* Ver informe */}
                        <button
                          type="button"
                          className="mt-4 self-start text-xs font-semibold text-violet-200/85 transition hover:text-white"
                        >
                          Ver informe →
                        </button>
                      </div>
                    );
                  })}
              </div>
              <button
                type="button"
                className="mt-4 text-sm font-semibold text-violet-200/85 transition hover:text-white"
              >
                Ver todos los informes →
              </button>
            </GlassCard>
          </div>
          {/* /Historial */}

          {infoModal ? <InfoModal content={infoModal} onClose={() => setInfoModal(null)} /> : null}
        </>
      )}
    </div>
  );
}

function useResultAnimation(enabled = false) {
  const [progress, setProgress] = React.useState(enabled ? 0 : 1);

  React.useLayoutEffect(() => {
    if (!enabled) {
      setProgress(1);
      return;
    }

    let frame = 0;
    const duration = 1800;
    const startedAt = performance.now();

    setProgress(0);

    function animate(now: number) {
      const raw = Math.min((now - startedAt) / duration, 1);
      const eased = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
      setProgress(eased);

      if (raw < 1) {
        frame = window.requestAnimationFrame(animate);
      }
    }

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [enabled]);

  return progress;
}

function StartAnalysis({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative -mt-2 flex h-[calc(100svh-128px)] min-h-[560px] flex-col items-center justify-center overflow-hidden px-4 py-4">
      <div className="pointer-events-none absolute -left-28 top-4 h-72 w-72 rounded-full bg-violet-500/18 blur-3xl" />
      <div className="pointer-events-none absolute -right-28 top-8 h-72 w-72 rounded-full bg-sky-500/14 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-20 h-80 w-80 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative z-10 flex w-full max-w-4xl flex-col items-center">
        <div className="relative mb-7">
          <div className="absolute inset-0 scale-[1.75] rounded-full bg-gradient-to-br from-primary/28 via-violet-500/18 to-sky-500/18 blur-3xl" />
          <div className="absolute inset-0 scale-[1.24] rounded-[2rem] border border-white/10 bg-white/[0.018] backdrop-blur-xl" />
          <div className="relative grid h-32 w-32 place-items-center rounded-[2rem] border border-white/12 bg-gradient-to-br from-white/[0.12] via-white/[0.045] to-white/[0.02] shadow-[0_0_90px_-22px_oklch(0.65_0.28_290/0.9)] sm:h-36 sm:w-36">
            <Brain className="h-16 w-16 text-primary drop-shadow-[0_0_24px_oklch(0.65_0.28_290/0.6)] sm:h-20 sm:w-20" />
          </div>
          <div
            className="absolute inset-0 rounded-[2rem] ring-1 ring-primary/20 animate-ping"
            style={{ animationDuration: "3s" }}
          />
        </div>

        <div className="mb-7 inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 shadow-[0_18px_55px_-32px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          <span className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.75)]" />
          <span className="text-base font-semibold text-foreground">Asesor IA listo</span>
        </div>

        <div className="max-w-3xl text-center">
          <h1 className="font-display text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-6xl">
            Descubrí cómo hacer
            <br className="hidden sm:block" /> crecer tu negocio
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
            Analizamos tu barbería y te mostramos oportunidades concretas para crecer.
          </p>
        </div>

        <button
          type="button"
          onClick={onStart}
          className="group relative mt-10 inline-flex h-16 w-full max-w-[360px] items-center justify-center gap-4 overflow-hidden rounded-2xl bg-gradient-to-r from-primary via-violet-500 to-accent px-8 text-lg font-bold text-white shadow-[0_22px_60px_-18px_oklch(0.65_0.28_290/0.9)] transition duration-300 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_28px_75px_-18px_oklch(0.65_0.28_290/1)] sm:min-w-[380px]"
        >
          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          <Brain className="relative h-6 w-6" />
          <span className="relative">Analizar mi negocio</span>
          <ArrowRight className="relative h-6 w-6 transition-transform duration-300 group-hover:translate-x-1" />
        </button>
      </div>
    </div>
  );
}

function AnalysisLoader({ step }: { step: number }) {
  const steps = [
    { label: "Ventas", icon: DollarSign },
    { label: "Clientes", icon: Users },
    { label: "Agenda", icon: CalendarDays },
    { label: "Generando recomendaciones", icon: Brain },
  ];

  const safeStep = Math.min(Math.max(0, step), steps.length);
  const pct = Math.round((safeStep / steps.length) * 100);

  return (
    <div className="relative flex min-h-[68vh] flex-col items-center justify-center overflow-hidden px-4 py-6">
      <div className="pointer-events-none absolute -left-32 top-10 h-72 w-72 rounded-full bg-violet-500/16 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 top-16 h-72 w-72 rounded-full bg-sky-500/14 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-24 h-80 w-80 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative z-10 w-full max-w-2xl rounded-[2rem] border border-white/10 bg-white/[0.035] p-5 shadow-[0_28px_90px_-40px_rgba(0,0,0,0.95)] backdrop-blur-xl sm:p-6">
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-5">
          <div className="relative mb-4">
            <div className="absolute inset-0 scale-[1.65] rounded-full bg-gradient-to-br from-primary/25 to-accent/20 blur-3xl" />
            <div className="relative grid h-20 w-20 place-items-center rounded-[1.75rem] border border-white/12 bg-gradient-to-br from-white/[0.12] to-white/[0.03] shadow-[0_0_70px_-20px_oklch(0.65_0.28_290/0.8)]">
              <Brain className="h-10 w-10 text-primary" />
            </div>
            <svg
              className="absolute inset-0 animate-spin"
              style={{ animationDuration: "3s" }}
              viewBox="0 0 96 96"
              fill="none"
              width="80"
              height="80"
            >
              <circle
                cx="48"
                cy="48"
                r="46"
                stroke="url(#spinGradPremium)"
                strokeWidth="2"
                strokeDasharray="72 220"
                strokeLinecap="round"
              />
              <defs>
                <linearGradient
                  id="spinGradPremium"
                  x1="0"
                  y1="0"
                  x2="96"
                  y2="96"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor="oklch(0.65 0.28 290)" />
                  <stop offset="55%" stopColor="oklch(0.72 0.2 245)" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Analizando tu negocio</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md">
            Preparando tu diagnóstico...
          </p>
        </div>

        {/* Progress bar premium */}
        <div className="mb-5">
          <div className="flex justify-center text-xs text-muted-foreground mb-2">
            <span className="font-semibold text-foreground">{pct}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-white/10 overflow-hidden ring-1 ring-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary via-violet-500 to-accent shadow-[0_0_24px_oklch(0.65_0.28_290/0.65)] transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-2.5">
          {steps.map((item, index) => {
            const done = index < safeStep;
            const current = index === safeStep;
            const pending = index > safeStep;
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border px-4 py-3 transition-all duration-500",
                  done &&
                    "border-emerald-400/25 bg-emerald-400/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]",
                  current &&
                    "border-primary/35 bg-primary/[0.075] ring-1 ring-primary/20 shadow-[0_0_32px_-20px_oklch(0.65_0.28_290/0.9)]",
                  pending && "border-white/8 bg-white/[0.02] opacity-50",
                )}
              >
                <div className="shrink-0 w-7 h-7 flex items-center justify-center">
                  {done && <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
                  {current && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                  {pending && <div className="h-4 w-4 rounded-full border-2 border-white/15" />}
                </div>
                <span
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-xl ring-1",
                    done && "bg-emerald-400/10 ring-emerald-400/20 text-emerald-300",
                    current && "bg-primary/10 ring-primary/20 text-primary",
                    pending && "bg-white/[0.04] ring-white/10 text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span
                  className={cn(
                    "text-sm font-medium flex-1",
                    done && "text-emerald-300",
                    current && "text-white",
                    pending && "text-muted-foreground",
                  )}
                >
                  {item.label}
                  {current ? "..." : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getDemoActions(showExtraRecommendation = false): AdvisorAction[] {
  const actions: AdvisorAction[] = [];

  if (DEMO.inactiveClients > 0) {
    actions.push({
      title: "Recuperar clientes",
      detail: `${DEMO.inactiveClients} clientes no volvieron hace más de 45 días.`,
      impact: `Impacto estimado: +${fmtAR(DEMO.inactiveClients * DEMO.ticket)}`,
      impactAmount: `+${fmtAR(DEMO.inactiveClients * DEMO.ticket)}`,
      impactExplanation: `Facturación recuperable si ${DEMO.inactiveClients} clientes inactivos vuelven al menos una vez. Basado en el ticket promedio actual de ${fmtAR(DEMO.ticket)}.`,
      id: "recover-inactive-clients",
      score: 97,
      status: "pending",
      area: "Clientes",
      metricLabel: "Clientes involucrados",
      metricValue: String(DEMO.inactiveClients),
      objective: "Recuperar y fidelizar",
      priorityLabel: "Prioridad máxima",
      priorityTone: "max",
      icon: Users,
      button: "Empezar estrategia",
      tone: "client",
      problem: `${DEMO.inactiveClients} clientes no volvieron hace más de 45 días.`,
      opportunity: `Si recuperás parte de esos clientes, podrías sumar hasta ${fmtAR(DEMO.inactiveClients * DEMO.ticket)} en facturación estimada.`,
      howToAct: [
        "Crear una acción especial para clientes inactivos.",
        "Ofrecer un beneficio por tiempo limitado: descuento, regalo, upgrade o atención prioritaria.",
        "Enviar un mensaje personalizado por WhatsApp, email o mensaje directo.",
        "Medir cuántos clientes vuelven después de la campaña.",
      ],
      suggestedMessage:
        "Hola 👋 Hace un tiempo que no te vemos. Esta semana tenemos un beneficio especial para que vuelvas a visitarnos. Respondé este mensaje y te ayudamos a reservar.",
      actionButtons: ["Ver clientes", "Enviar WhatsApp", "Crear promoción", "Marcar como resuelto"],
    });
  }

  if (DEMO.emptySlotsTomorrow > 0) {
    actions.push({
      title: "Llenar horarios libres",
      detail: `Mañana tenés ${DEMO.emptySlotsTomorrow} espacios vacíos.`,
      impact: `Impacto estimado: +${fmtAR(DEMO.emptySlotsTomorrow * DEMO.ticket)}`,
      impactAmount: `+${fmtAR(DEMO.emptySlotsTomorrow * DEMO.ticket)}`,
      impactExplanation: `Ingresos que se perderían si los ${DEMO.emptySlotsTomorrow} turnos disponibles mañana quedan vacíos. Cada turno vale en promedio ${fmtAR(DEMO.ticket)}.`,
      id: "fill-empty-slots",
      score: 90,
      status: "pending",
      area: "Agenda",
      metricLabel: "Turnos libres",
      metricValue: String(DEMO.emptySlotsTomorrow),
      objective: "Ocupación",
      priorityLabel: "Prioridad alta",
      priorityTone: "high",
      icon: CalendarDays,
      button: "Empezar estrategia",
      tone: "warning",
      problem: `Mañana hay ${DEMO.emptySlotsTomorrow} horarios disponibles sin ocupar.`,
      opportunity: `Completar esos espacios puede generar hasta ${fmtAR(DEMO.emptySlotsTomorrow * DEMO.ticket)} adicionales.`,
      howToAct: [
        "Crear una promoción para horarios con baja demanda.",
        "Enviar el beneficio a clientes activos.",
        "Publicar la disponibilidad en historias, estados o canales del negocio.",
        "Priorizar los horarios libres más cercanos para llenar la agenda rápido.",
      ],
      suggestedMessage:
        "Hola 👋 Tenemos algunos horarios disponibles para mañana y activamos un beneficio especial por tiempo limitado. ¿Querés que te reserve un lugar?",
      actionButtons: [
        "Crear promoción",
        "Enviar WhatsApp",
        "Ver horarios libres",
        "Marcar como resuelto",
      ],
    });
  }

  if (DEMO.payments > 0) {
    actions.push({
      title: "Aumentar facturación por cliente",
      detail:
        "El ticket promedio puede mejorar con servicios complementarios, productos o combos de mayor valor.",
      impact: `Potencial estimado: +${fmtAR(DEMO.payments * 1000)}`,
      impactAmount: `+${fmtAR(DEMO.payments * 1000)}`,
      impactExplanation: `Si agregás en promedio $1.000 por venta, sobre los ${DEMO.payments} servicios del período, podés generar este ingreso adicional sin necesidad de sumar nuevos clientes.`,
      id: "increase-average-ticket",
      score: 84,
      status: "pending",
      area: "Ventas",
      metricLabel: "Mejora por ticket",
      metricValue: "+$1.000",
      objective: "Ticket promedio",
      priorityLabel: "Prioridad alta",
      priorityTone: "high",
      icon: Tag,
      button: "Empezar estrategia",
      tone: "money",
      problem:
        "Hay oportunidad de aumentar la facturación por cliente sin subir precios de forma directa.",
      opportunity: `Si agregás $1.000 promedio por venta, podrías generar aproximadamente ${fmtAR(DEMO.payments * 1000)} adicionales en el período analizado.`,
      howToAct: [
        "Ofrecer productos o servicios complementarios durante la visita.",
        "Crear combos o paquetes con mayor valor percibido.",
        "Capacitar al equipo para detectar oportunidades de venta sin presionar al cliente.",
        "Analizar qué productos o servicios tienen mayor aceptación.",
      ],
      suggestedMessage:
        "Tenemos una opción especial para completar tu visita con un beneficio extra. Si querés, podemos sumarla a tu servicio de hoy.",
      actionButtons: ["Ver simulación", "Crear combo", "Ver servicios", "Marcar como resuelto"],
    });
  }

  if (DEMO.vipInactive > 0) {
    actions.push({
      title: "Reactivar clientes VIP",
      detail: `${DEMO.vipInactive} clientes VIP no visitan hace 30 días.`,
      impact: `Impacto estimado: +${fmtAR(DEMO.vipInactive * DEMO.ticket)}`,
      impactAmount: `+${fmtAR(DEMO.vipInactive * DEMO.ticket)}`,
      impactExplanation: `Estimado si los ${DEMO.vipInactive} clientes VIP inactivos regresan. Son clientes de alto valor con un ticket promedio de ${fmtAR(DEMO.ticket)}.`,
      id: "reactivate-vip-clients",
      score: 79,
      status: "pending",
      area: "Clientes",
      metricLabel: "Clientes VIP",
      metricValue: String(DEMO.vipInactive),
      objective: "Fidelización",
      priorityLabel: "Prioridad alta",
      priorityTone: "high",
      icon: Crown,
      button: "Empezar estrategia",
      tone: "growth",
      problem: `${DEMO.vipInactive} clientes VIP no volvieron en los últimos 30 días.`,
      opportunity: `Recuperarlos puede sumar aproximadamente ${fmtAR(DEMO.vipInactive * DEMO.ticket)} y reforzar la fidelización.`,
      howToAct: [
        "Enviar un mensaje personalizado con tono cercano.",
        "Ofrecer un beneficio exclusivo para clientes frecuentes o VIP.",
        "Dar prioridad de agenda o un regalo en la próxima visita.",
        "Registrar quién respondió para medir la efectividad.",
      ],
      suggestedMessage:
        "Hola 👋 Queríamos agradecerte por ser parte de nuestros clientes frecuentes. Esta semana tenemos un beneficio especial para vos. ¿Querés que te pasemos horarios disponibles?",
      actionButtons: [
        "Enviar WhatsApp",
        "Ver clientes VIP",
        "Crear beneficio",
        "Marcar como resuelto",
      ],
    });
  }

  if (DEMO.unconfirmedAppointments > 0) {
    actions.push({
      title: "Confirmar turnos",
      detail: `${DEMO.unconfirmedAppointments} turnos todavía no están confirmados.`,
      impact: "Reduce ausencias y huecos de agenda.",
      impactAmount: `${DEMO.unconfirmedAppointments} turnos`,
      impactExplanation: `Confirmarlos reduce el riesgo de ausencias y turnos perdidos. Cada turno sin confirmar representa un posible hueco de ${fmtAR(DEMO.ticket)} que no podés reasignar a tiempo.`,
      id: "confirm-pending-appointments",
      score: 74,
      status: "pending",
      area: "Agenda",
      metricLabel: "Turnos pendientes",
      metricValue: String(DEMO.unconfirmedAppointments),
      objective: "Reducir ausencias",
      priorityLabel: "Prioridad media",
      priorityTone: "medium",
      icon: ClipboardList,
      button: "Empezar estrategia",
      tone: "neutral",
      problem: `${DEMO.unconfirmedAppointments} turnos todavía no están confirmados.`,
      opportunity:
        "Confirmarlos ayuda a reducir ausencias, cancelaciones de último momento y horarios perdidos.",
      howToAct: [
        "Enviar recordatorio automático o manual.",
        "Pedir confirmación con una respuesta simple.",
        "Liberar los turnos que no respondan dentro de un plazo definido.",
        "Registrar confirmados y pendientes para ordenar la agenda.",
      ],
      suggestedMessage:
        "Hola 👋 Te escribimos para confirmar tu turno. Respondé CONFIRMO para mantener la reserva o avisame si necesitás cambiar el horario.",
      actionButtons: [
        "Ver turnos",
        "Enviar recordatorio",
        "Confirmar seleccionados",
        "Marcar como resuelto",
      ],
    });
  }

  if (showExtraRecommendation) {
    const dayLabel = DEMO.lowDay.charAt(0).toUpperCase() + DEMO.lowDay.slice(1);
    actions.unshift({
      title: "Impulsar el día con menor ocupación",
      detail: `${dayLabel} presenta una ocupación inferior al promedio semanal.`,
      impact: `Oportunidad estimada: +${fmtAR(Math.round(8 * DEMO.ticket))} sin bajar precios`,
      impactAmount: `+${fmtAR(Math.round(8 * DEMO.ticket))} por mes`,
      impactExplanation: `Completar 8 turnos vacíos los ${DEMO.lowDay}s al precio normal generaría aproximadamente ${fmtAR(Math.round(8 * DEMO.ticket))} de facturación mensual sin afectar los márgenes. Implementar descuentos agresivos reduce la utilidad por turno — preferí acciones que aumenten la demanda sin ceder rentabilidad.`,
      id: "boost-low-occupancy-day",
      score: 88,
      status: "pending",
      area: "Agenda",
      metricLabel: "Día detectado",
      metricValue: dayLabel,
      objective: "Llenar agenda",
      priorityLabel: "Prioridad alta",
      priorityTone: "high",
      icon: TrendingUp,
      button: "Empezar estrategia",
      tone: "growth",
      problem: `${dayLabel} tiene menor ocupación que el resto de la semana — hay turnos disponibles sin cubrir.`,
      opportunity: `Aumentar la demanda ese día con beneficios o acciones focalizadas puede sumar hasta ${fmtAR(Math.round(8 * DEMO.ticket))} mensuales sin reducir precios.`,
      howToAct: [
        "Priorizar beneficios sin descuento: regalo, upgrade o atención preferencial.",
        "Enviar la propuesta a clientes activos con turno reciente.",
        "Publicar disponibilidad ese día en redes o estados de WhatsApp.",
        "Medir si sube la ocupación la semana siguiente para ajustar la estrategia.",
      ],
      suggestedMessage: `Hola 👋 Tenemos algunos horarios disponibles para ${DEMO.lowDay} y queremos ofrecerte algo especial. Si reservás ese día, te sumamos [beneficio]. Respondé este mensaje y te ayudamos a coordinar.`,
      actionButtons: ["Crear beneficio", "Ver horarios", "Enviar WhatsApp", "Marcar como resuelto"],
      occupancyOptions: [
        {
          icon: Gift,
          label: "Beneficio sin descuento",
          recommended: true,
          discount: 0,
          message: `Hola 👋 Tenemos algunos horarios disponibles para ${DEMO.lowDay} y queremos ofrecerte algo especial. Si reservás ese día, te sumamos una bebida de regalo. Respondé este mensaje y te ayudamos a coordinar.`,
        },
        {
          icon: Sparkles,
          label: "Upgrade de servicio",
          discount: 0,
          message: `Hola 👋 Reservá tu turno para el ${DEMO.lowDay} y te incluimos un upgrade de servicio sin cargo. Es nuestra forma de reconocer tu preferencia. Escribinos y te contamos los horarios disponibles.`,
        },
        {
          icon: BadgePercent,
          label: "10% OFF",
          discount: 10,
          message: `Hola 👋 Tenemos horarios disponibles para el ${DEMO.lowDay} con un 10% de descuento por tiempo limitado. Respondé este mensaje y te reservamos el lugar.`,
        },
        {
          icon: BadgePercent,
          label: "15% OFF",
          discount: 15,
          message: `Hola 👋 Tenemos horarios disponibles para el ${DEMO.lowDay} con un 15% de descuento especial. Si te interesa, respondé y te ayudamos a reservar.`,
        },
        { icon: CircleHelp, label: "Personalizado", discount: undefined, message: "" },
      ],
    });
  }

  return actions;
}

// ─── DATOS MES ANTERIOR ───────────────────────────────────────────────────────

const DEMO_PREV = {
  month: "Mayo 2026",
  revenue: 3462000,
  expenses: 1902000,
  profit: 1560000,
  clientsTotal: 742,
  clientsNew: 45,
  ticket: 55500,
  occupancy: 54,
  growth: 18,
  weeklyRevenue: [680000, 820000, 960000, 1002000],
  weeklyProfit: [280000, 350000, 440000, 490000],
  weeklyClients: [160, 182, 198, 202],
};

// ─── HISTORIAL MES ANTERIOR ───────────────────────────────────────────────────

function HistorialMesAnterior() {
  const [activeMetric, setActiveMetric] = React.useState<"revenue" | "profit" | "clients">(
    "revenue",
  );

  const metricConfig = {
    revenue: {
      label: "Facturación",
      color: "#a78bfa",
      data: DEMO_PREV.weeklyRevenue,
      fmt: (v: number) => fmtAR(v),
    },
    profit: {
      label: "Utilidad",
      color: "#34d399",
      data: DEMO_PREV.weeklyProfit,
      fmt: (v: number) => fmtAR(v),
    },
    clients: {
      label: "Clientes",
      color: "#60a5fa",
      data: DEMO_PREV.weeklyClients,
      fmt: (v: number) => String(v),
    },
  };

  const cfg = metricConfig[activeMetric];
  const CHART_H = 90;

  const impulsores: { tone: "good" | "warning"; text: string }[] = [
    { tone: "good", text: "Clientes nuevos +16% vs período anterior" },
    { tone: "good", text: "Ticket promedio +10% vs período anterior" },
    { tone: "good", text: "Ocupación +8 puntos vs período anterior" },
    { tone: "warning", text: `${DEMO.inactiveClients} clientes sin retorno en +45 días` },
    { tone: "warning", text: `${DEMO.freeSlotsMonth} turnos disponibles sin ocupar` },
  ];

  const statCards = [
    {
      label: "Ingresos",
      value: fmtAR(DEMO_PREV.revenue),
      sub: "Facturación bruta",
      color: "text-violet-300",
      bg: "bg-violet-400/10 ring-1 ring-violet-400/20",
    },
    {
      label: "Gastos",
      value: fmtAR(DEMO_PREV.expenses),
      sub: "Costos del período",
      color: "text-rose-300",
      bg: "bg-rose-400/10 ring-1 ring-rose-400/20",
    },
    {
      label: "Utilidad",
      value: fmtAR(DEMO_PREV.profit),
      sub: "Ganancia neta",
      color: "text-emerald-300",
      bg: "bg-emerald-400/10 ring-1 ring-emerald-400/20",
    },
    {
      label: "Clientes atendidos",
      value: String(DEMO_PREV.clientsTotal),
      sub: "Total del mes",
      color: "text-sky-300",
      bg: "bg-sky-400/10 ring-1 ring-sky-400/20",
    },
    {
      label: "Clientes nuevos",
      value: String(DEMO_PREV.clientsNew),
      sub: "+16% vs mes previo",
      color: "text-sky-300",
      bg: "bg-sky-400/10 ring-1 ring-sky-400/20",
    },
    {
      label: "Ticket promedio",
      value: fmtAR(DEMO_PREV.ticket),
      sub: "+10% vs mes previo",
      color: "text-cyan-300",
      bg: "bg-cyan-400/10 ring-1 ring-cyan-400/20",
    },
    {
      label: "Ocupación",
      value: `${DEMO_PREV.occupancy}%`,
      sub: "+8 pts vs mes previo",
      color: "text-orange-300",
      bg: "bg-orange-400/10 ring-1 ring-orange-400/20",
    },
  ];

  const maxVal = Math.max(...cfg.data);

  return (
    <GlassCard className="p-5 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-muted-foreground ring-1 ring-white/10">
            <BarChart2 className="h-3.5 w-3.5" />
            Historial del mes anterior
          </div>
          <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight">
            {DEMO_PREV.month}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Resumen completo del período anterior para comparar con el mes actual.
          </p>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-right shrink-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Crecimiento
          </div>
          <div className="mt-1 font-display text-3xl font-semibold text-primary">
            +{DEMO_PREV.growth}%
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">vs mes previo</div>
        </div>
      </div>

      {/* Tarjetas métricas */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {statCards.map((card) => (
          <div key={card.label} className={cn("rounded-2xl p-4", card.bg)}>
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
              {card.label}
            </div>
            <div className={cn("mt-2 font-display text-xl font-semibold", card.color)}>
              {card.value}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Tendencia semanal */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="text-sm font-semibold">Tendencia semanal</div>
          <div className="flex gap-2">
            {(["revenue", "profit", "clients"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setActiveMetric(k)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ring-1",
                  activeMetric === k
                    ? k === "revenue"
                      ? "bg-violet-500/15 ring-violet-400/30 text-violet-300"
                      : k === "profit"
                        ? "bg-emerald-500/15 ring-emerald-400/30 text-emerald-300"
                        : "bg-sky-500/15 ring-sky-400/30 text-sky-300"
                    : "bg-white/[0.03] ring-white/10 text-muted-foreground hover:text-foreground",
                )}
              >
                {metricConfig[k].label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-end gap-3">
          {cfg.data.map((val, i) => {
            const barH = Math.max(8, Math.round((val / maxVal) * CHART_H));
            const labels = ["Sem 1", "Sem 2", "Sem 3", "Sem 4"];
            return (
              <div key={i} className="flex flex-col items-center gap-1.5 flex-1">
                <div
                  className="text-[10px] font-semibold truncate w-full text-center"
                  style={{ color: cfg.color }}
                >
                  {cfg.fmt(val)}
                </div>
                <div
                  className="w-full rounded-t-lg relative"
                  style={{ height: `${CHART_H}px`, backgroundColor: "rgba(255,255,255,0.04)" }}
                >
                  <div
                    className="absolute bottom-0 w-full rounded-t-lg transition-all duration-700"
                    style={{ height: `${barH}px`, backgroundColor: cfg.color, opacity: 0.75 }}
                  />
                </div>
                <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {labels[i]}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Principales impulsores */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="text-sm font-semibold mb-4">Principales impulsores del resultado</div>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {impulsores.map((item) => (
            <div key={item.text} className="flex items-start gap-2 text-sm">
              {item.tone === "good" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
              )}
              <span className="text-muted-foreground leading-snug">{item.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Resumen IA */}
      <div className="rounded-2xl border border-primary/20 bg-primary/[0.06] p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="grid h-7 w-7 place-items-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
            <Brain className="h-4 w-4 text-primary" />
          </div>
          <div className="text-sm font-semibold text-primary">Resumen IA</div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          La utilidad de {DEMO_PREV.month} creció un{" "}
          <span className="font-semibold text-emerald-300">+30%</span> respecto al mes previo,
          impulsada principalmente por el aumento de clientes nuevos (+16%) y el ticket promedio
          (+10%). La ocupación mejoró 8 puntos alcanzando el 62%. Sin embargo, persisten{" "}
          <span className="font-semibold text-cyan-300">
            {DEMO.freeSlotsMonth} espacios libres en agenda
          </span>{" "}
          y{" "}
          <span className="font-semibold text-cyan-300">
            {DEMO.inactiveClients} clientes inactivos
          </span>{" "}
          que representan una oportunidad concreta de crecimiento para el mes actual.
        </p>
      </div>
    </GlassCard>
  );
}

function getStrategicIdea() {
  return {
    title: "Crear un sistema de recomendados",
    detail:
      "Invitá a tus clientes actuales a recomendar a una persona y ofrecé un beneficio cuando esa persona reserve o compre. Es una acción de crecimiento, no una urgencia.",
    impact: "Ideal para aumentar captación sin depender solo de publicidad.",
  };
}

function getTodayKey() {
  const date = new Date();
  return date.toISOString().slice(0, 10);
}

function percent(now: number, previous: number) {
  if (!previous) return 0;
  return Math.round(((now - previous) / previous) * 100);
}

function getHealthTone(health: number) {
  if (health >= 85)
    return {
      label: "Excelente",
      message: "Tu negocio está funcionando muy bien. Mantené el ritmo actual.",
      text: "text-emerald-400",
      bar: "from-emerald-500 to-primary",
    };
  if (health >= 70)
    return {
      label: "Bueno",
      message: "Tu negocio está saludable, aunque todavía hay oportunidades de crecimiento.",
      text: "text-lime-300",
      bar: "from-lime-400 to-primary",
    };
  if (health >= 50)
    return {
      label: "Regular",
      message: "Hay indicadores que requieren atención para mejorar el rendimiento.",
      text: "text-cyan-300",
      bar: "from-cyan-400 to-accent",
    };
  return {
    label: "Crítico",
    message: "Tu negocio necesita acciones urgentes para recuperar su rendimiento.",
    text: "text-red-400",
    bar: "from-red-500 to-cyan-400",
  };
}

function GlassCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "glass rounded-3xl bg-white/[0.025] ring-1 ring-white/[0.08] shadow-[0_18px_70px_-45px_rgba(99,102,241,0.65)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Badge({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary ring-1 ring-primary/20">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </div>
  );
}

function GrowthMetric({
  label,
  value,
  detail,
  info,
  onInfo,
}: {
  label: string;
  value: string;
  detail?: string;
  info?: InfoModalContent;
  onInfo?: (content: InfoModalContent) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-all duration-700 ease-out">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        {info && onInfo ? (
          <button
            type="button"
            onClick={() => onInfo(info)}
            className="grid h-6 w-6 place-items-center rounded-full border border-white/20 bg-white/[0.05] text-xs font-bold text-muted-foreground transition hover:border-primary/50 hover:text-primary"
            aria-label={`Información de ${label}`}
          >
            i
          </button>
        ) : null}
      </div>
      <div className="mt-2 text-lg font-semibold text-emerald-300">{value}</div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function ReasonItem({ tone, text }: { tone: "good" | "warning"; text: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {tone === "good" ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
      )}
      <span className="text-muted-foreground">{text}</span>
    </div>
  );
}

function ActionCard({ action, onOpen }: { action: AdvisorAction; onOpen: () => void }) {
  return (
    <div className="flex min-h-[220px] flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div
        className={cn(
          "mb-4 grid h-9 w-9 place-items-center rounded-2xl ring-1",
          action.tone === "money" && "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
          action.tone === "warning" && "bg-cyan-400/10 text-cyan-300 ring-cyan-400/20",
          action.tone === "growth" && "bg-primary/10 text-primary ring-primary/20",
          action.tone === "client" && "bg-cyan-400/10 text-cyan-300 ring-cyan-400/20",
          action.tone === "neutral" && "bg-white/5 text-white ring-white/10",
        )}
      >
        {action.tone === "client" ? (
          <MessageCircle className="h-4 w-4" />
        ) : (
          <Target className="h-4 w-4" />
        )}
      </div>

      <div className="text-sm font-semibold">{action.title}</div>
      <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{action.detail}</div>
      <div className="mt-3 text-xs font-semibold text-emerald-300">{action.impact}</div>

      <button
        type="button"
        onClick={onOpen}
        className="mt-auto rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-primary transition hover:bg-white/[0.08]"
      >
        {action.button}
      </button>
    </div>
  );
}

// ─── PRIORIDADES TAB ─────────────────────────────────────────────────────────

function PrioridadesTab({
  actions,
  resolvedRecommendations,
  onResolve,
  onReset,
}: {
  actions: AdvisorAction[];
  resolvedRecommendations: string[];
  onResolve: (action: AdvisorAction) => void;
  onReset: () => void;
}) {
  const pending = actions.filter((a) => !resolvedRecommendations.includes(a.title));
  const [idx, setIdx] = React.useState(0);
  const [selectedOptionIdx, setSelectedOptionIdx] = React.useState<number>(0);
  const [customBenefit, setCustomBenefit] = React.useState("");
  const [customDiscount, setCustomDiscount] = React.useState("");
  const [customMsg, setCustomMsg] = React.useState("");

  // Reset option selection when action changes
  React.useEffect(() => {
    setSelectedOptionIdx(0);
    setCustomBenefit("");
    setCustomDiscount("");
    setCustomMsg("");
  }, [idx]);

  // Advance to next when resolved
  React.useEffect(() => {
    if (idx >= pending.length && pending.length > 0) setIdx(0);
  }, [pending.length, idx]);

  const current = pending[idx] ?? null;

  if (!current) {
    return (
      <GlassCard className="p-8 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-emerald-400/10 ring-1 ring-emerald-400/20">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">
          🎉 ¡Estás al día!
        </h2>
        <p className="mt-2 max-w-md mx-auto text-sm text-muted-foreground">
          No se detectaron nuevas acciones prioritarias para hoy. Tu negocio está funcionando
          correctamente según los indicadores actuales.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Volvé mañana para revisar nuevas oportunidades detectadas por la IA.
        </p>
        <button
          type="button"
          onClick={onReset}
          className="mt-6 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-white/[0.08] hover:text-white"
        >
          Reiniciar recomendaciones
        </button>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-5">
      {/* Main card */}
      <GlassCard className="relative overflow-hidden border-cyan-400/20 p-6 shadow-[0_0_80px_rgba(34,211,238,0.10),0_0_110px_rgba(16,185,129,0.08)] sm:p-8">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-cyan-400/20 blur-[90px]" />
        <div className="pointer-events-none absolute right-0 top-0 h-80 w-80 rounded-full bg-emerald-400/16 blur-[95px]" />
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
        {/* Header */}
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.25em] text-cyan-200 shadow-[0_0_28px_rgba(34,211,238,0.16)]">
            🎯 Oportunidad detectada por IA
          </div>
          <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {current.title}
          </h2>
        </div>

        {/* Oportunidad + Impacto */}
        <div className="relative z-10 mt-6 grid gap-4 md:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-white/12 bg-white/[0.04] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              🔍 Oportunidad detectada
            </div>
            <p className="mt-3 text-sm leading-relaxed text-white">{current.problem}</p>
          </div>
          <div className="relative overflow-hidden rounded-3xl border border-emerald-300/35 bg-gradient-to-br from-emerald-400/[0.16] via-cyan-400/[0.08] to-white/[0.035] p-5 shadow-[0_0_55px_rgba(16,185,129,0.16),inset_0_1px_0_rgba(255,255,255,0.10)] flex flex-col justify-between">
            <div className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full bg-emerald-300/25 blur-3xl" />
            <div className="relative text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">
              Potencial mensual
            </div>
            <div className="relative mt-3 font-display text-5xl font-semibold tracking-tight text-emerald-300 leading-none drop-shadow-[0_0_20px_rgba(52,211,153,0.22)]">
              {current.impactAmount}
            </div>
            <p className="relative mt-3 text-xs text-emerald-50/70 leading-relaxed">
              {current.impactExplanation}
            </p>
          </div>
        </div>

        {/* Cómo tomar acción */}
        <div className="relative z-10 mt-4 rounded-3xl border border-cyan-300/15 bg-gradient-to-br from-white/[0.055] to-cyan-400/[0.035] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="text-sm font-semibold text-white">✅ Plan de acción</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {current.howToAct.map((step) => (
              <div key={step} className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span className="text-sm text-muted-foreground leading-relaxed">{step}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Opciones de acción para baja ocupación */}
        {current.occupancyOptions &&
          (() => {
            const opts = current.occupancyOptions!;
            const selOpt = opts[selectedOptionIdx];
            const isCustom = selOpt?.label === "Personalizado";
            const discountPct = isCustom
              ? Math.max(0, Math.min(100, Number(customDiscount) || 0))
              : (selOpt?.discount ?? 0);

            // Recalculate impact based on selected option
            const baseAmount = Math.round(8 * DEMO.ticket);
            const adjustedAmount =
              discountPct > 0 ? Math.round(baseAmount * (1 - discountPct / 100)) : baseAmount;
            const diffVsBase = adjustedAmount - baseAmount;

            // Derive active message
            const activeMsg = isCustom ? customMsg : (selOpt?.message ?? current.suggestedMessage);

            // Reco text based on selection
            const recoText = (() => {
              if (isCustom)
                return "Configurá los detalles del beneficio personalizado y la IA ajustará la recomendación.";
              if (!selOpt?.discount)
                return "Mantener el precio protege tu margen. Un beneficio de bajo costo puede ser suficiente para activar la demanda en este día.";
              if (selOpt.discount <= 10)
                return `Un ${selOpt.discount}% de descuento es moderado. Puede impulsar la demanda, pero considerá que reduce el ingreso por turno. Aplicalo por tiempo limitado y medí la respuesta.`;
              return `Un ${selOpt.discount}% de descuento es significativo. Solo conviene si la ocupación de este día sigue siendo baja después de probar opciones sin descuento.`;
            })();

            return (
              <div className="relative z-10 mt-4 space-y-4">
                {/* Selector de opción */}
                <div className="relative overflow-hidden rounded-3xl border border-cyan-300/20 bg-gradient-to-br from-cyan-400/[0.08] via-blue-500/[0.04] to-violet-500/[0.05] p-5 shadow-[0_0_50px_rgba(59,130,246,0.10),inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-cyan-300/14 blur-3xl" />
                  <div className="relative text-sm font-semibold text-white mb-1">
                    ¿Qué tipo de acción querés implementar?
                  </div>
                  <p className="relative text-xs text-muted-foreground mb-4">
                    Clippr recomienda priorizar beneficios antes de bajar precios para proteger la
                    rentabilidad.
                  </p>
                  <div className="relative grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {opts.map((opt, i) => {
                      const isSelected = selectedOptionIdx === i;
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => setSelectedOptionIdx(i)}
                          className={cn(
                            "relative flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition text-left",
                            isSelected
                              ? opt.recommended
                                ? "border-emerald-400/50 bg-emerald-400/[0.12] ring-1 ring-emerald-400/30"
                                : "border-primary/50 bg-primary/[0.12] ring-1 ring-primary/30"
                              : "border-white/10 bg-white/[0.03] hover:border-white/20",
                          )}
                        >
                          <span className="shrink-0 text-primary">
                            {React.createElement(opt.icon, { className: "h-4 w-4" })}
                          </span>
                          <span
                            className={cn(
                              "font-medium",
                              isSelected
                                ? opt.recommended
                                  ? "text-emerald-300"
                                  : "text-primary"
                                : "text-muted-foreground",
                            )}
                          >
                            {opt.label}
                          </span>
                          {opt.recommended && (
                            <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full ring-1 ring-emerald-400/20 whitespace-nowrap shrink-0">
                              Recomendado
                            </span>
                          )}
                          {isSelected && !opt.recommended && (
                            <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-primary" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Personalizado: campos extra */}
                  {isCustom && (
                    <div className="mt-4 grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-cyan-100/75 mb-1 block">
                          Nombre de la acción
                        </label>
                        <input
                          type="text"
                          placeholder="Ej: Corte + bebida, Promo martes, Upgrade de barba"
                          value={customBenefit}
                          onChange={(e) => setCustomBenefit(e.target.value)}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-primary/40 placeholder:text-muted-foreground/50"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Descuento % (0 = sin descuento)
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="Ej: 0 o 10"
                          value={customDiscount}
                          onChange={(e) => setCustomDiscount(e.target.value.replace(/\D/g, ""))}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-primary/40 placeholder:text-muted-foreground/50"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Oportunidad económica recalculada */}
                {discountPct > 0 && (
                  <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.05] p-4 flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Con un{" "}
                      <span className="font-semibold text-cyan-300">
                        {discountPct}% de descuento
                      </span>{" "}
                      la oportunidad económica se reduce a{" "}
                      <span className="font-semibold text-white">+{fmtAR(adjustedAmount)}/mes</span>{" "}
                      (vs {fmtAR(baseAmount)} sin descuento). Diferencia:{" "}
                      <span className="text-rose-300 font-semibold">{fmtAR(diffVsBase)}</span>.
                    </p>
                  </div>
                )}

                {/* Recomendación dinámica según opción */}
                <div
                  className={cn(
                    "rounded-2xl border p-4",
                    !selOpt?.discount
                      ? "border-emerald-400/20 bg-emerald-400/[0.05]"
                      : selOpt.discount <= 10
                        ? "border-cyan-400/20 bg-cyan-400/[0.05]"
                        : "border-rose-400/20 bg-rose-400/[0.05]",
                  )}
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2">
                    Recomendación IA
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{recoText}</p>
                </div>

                {/* Mensaje reactivo */}
                <div className="rounded-3xl border border-white/12 bg-white/[0.045] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <div className="text-sm font-semibold text-white">
                    {isCustom
                      ? "⚙️ Configurar acción personalizada"
                      : "💬 Mensaje listo para enviar"}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isCustom
                      ? "Escribí una propuesta clara para enviar por WhatsApp, email o Instagram."
                      : "Podés usar este texto como base para activar más turnos."}
                  </p>
                  <textarea
                    value={isCustom ? customMsg : activeMsg}
                    placeholder={
                      isCustom
                        ? "Escribí el mensaje que querés enviar a tus clientes..."
                        : undefined
                    }
                    onChange={(e) => {
                      if (isCustom) setCustomMsg(e.target.value);
                    }}
                    readOnly={!isCustom}
                    className={cn(
                      "mt-3 min-h-[110px] w-full rounded-2xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none transition resize-none placeholder:text-muted-foreground/60",
                      isCustom ? "focus:border-cyan-300/50" : "cursor-default opacity-90",
                    )}
                  />
                  {!isCustom && (
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      Seleccioná "Personalizado" para editar el mensaje libremente.
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

        {/* Mensaje sugerido estándar (solo si no hay occupancyOptions) */}
        {!current.occupancyOptions && (
          <MessageSugeridoBlock suggestedMessage={current.suggestedMessage} />
        )}

        {/* Marcar como resuelto */}
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => onResolve(current)}
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-400 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-10px_rgba(52,211,153,0.5)] transition hover:brightness-110"
          >
            <CheckCircle2 className="h-4 w-4" />
            Marcar como resuelto
          </button>
        </div>
      </GlassCard>
    </div>
  );
}

function MessageSugeridoBlock({ suggestedMessage }: { suggestedMessage: string }) {
  const [message, setMessage] = React.useState(suggestedMessage);
  React.useEffect(() => {
    setMessage(suggestedMessage);
  }, [suggestedMessage]);

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-sm font-semibold text-white">💬 Mensaje sugerido editable</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Adaptalo al tono de tu negocio. Sirve para WhatsApp, email, Instagram o campañas.
      </p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="mt-3 min-h-[110px] w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none transition placeholder:text-muted-foreground focus:border-primary/50 resize-none"
      />
    </div>
  );
}

function RecommendationDetailModal({
  action,
  onClose,
  onResolve,
}: {
  action: AdvisorAction;
  onClose: () => void;
  onResolve: () => void;
}) {
  const [message, setMessage] = React.useState(action.suggestedMessage);
  React.useEffect(() => {
    setMessage(action.suggestedMessage);
  }, [action.suggestedMessage]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-background p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
              🎯 Prioridad detectada por IA
            </div>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white">
              {action.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-white/[0.08] hover:text-white"
          >
            Cerrar
          </button>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              🔍 Oportunidad detectada
            </div>
            <p className="mt-2 text-sm leading-relaxed text-white">{action.problem}</p>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
              Impacto estimado
            </div>
            <div className="mt-2 font-display text-2xl font-semibold text-emerald-300">
              {action.impact}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Basado en datos reales de los últimos 30 días.
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm font-semibold text-white">✅ Cómo tomar acción</div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {action.howToAct.map((step) => (
              <div key={step} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm font-semibold text-white">💬 Mensaje sugerido editable</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Adaptalo al tono de tu negocio. Sirve para WhatsApp, email o mensaje directo.
          </p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="mt-3 min-h-[120px] w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none transition focus:border-primary/50"
          />
        </div>
        <div className="mt-5">
          <button
            type="button"
            onClick={onResolve}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-400/20"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Marcar como resuelto
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoModal({ content, onClose }: { content: InfoModalContent; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 px-4 backdrop-blur-md">
      <div className="relative w-full max-w-xl overflow-hidden rounded-[2rem] border border-emerald-300/15 bg-[#090714]/95 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_35px_120px_-55px_rgba(45,212,191,0.85)]">
        <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-emerald-400/12 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 bottom-0 h-48 w-48 rounded-full bg-sky-400/10 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300">
              Información
            </div>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white">
              {content.title}
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              {content.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-white/[0.09] hover:text-white"
          >
            Cerrar
          </button>
        </div>

        <div className="relative mt-6 space-y-3">
          {content.points.map((point, index) => (
            <div
              key={point}
              className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm leading-relaxed text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-300/10 text-xs font-bold text-emerald-300">
                {index + 1}
              </span>
              <span>{point}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportCard({
  report,
  isPrimary = false,
}: {
  report: { month: string; health: number; growth: number; profit: number; revenue: number };
  isPrimary?: boolean;
}) {
  const healthTone = getHealthTone(report.health);
  const growthPositive = report.growth >= 0;
  const insight = MONTH_INSIGHTS[report.month];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-4 flex flex-col gap-3 transition-all",
        isPrimary
          ? "border-emerald-300/25 bg-emerald-300/[0.055] shadow-[0_0_0_1px_rgba(16,185,129,0.05),0_22px_70px_-46px_rgba(45,212,191,0.75)] hover:border-emerald-300/35"
          : "border-white/10 bg-white/[0.026] opacity-85 hover:opacity-100 hover:border-white/20",
      )}
    >
      {isPrimary && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/45 to-transparent" />
      )}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            {isPrimary && (
              <span className="rounded-full bg-emerald-300/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200 ring-1 ring-emerald-300/20">
                Último
              </span>
            )}
            <p className={cn("font-semibold text-white", isPrimary ? "text-base" : "text-sm")}>
              {report.month}
            </p>
          </div>
          <p className="mt-1 text-[11px] font-bold leading-snug text-white/80">
            {insight ? insight.badge : "Informe guardado"}
          </p>
        </div>
        <span
          className={cn(
            "text-xs font-bold px-2 py-0.5 rounded-full ring-1",
            growthPositive
              ? "bg-emerald-400/10 ring-emerald-400/20 text-emerald-300"
              : "bg-rose-400/10 ring-rose-400/20 text-rose-300",
          )}
        >
          {growthPositive ? "+" : ""}
          {report.growth}%
        </span>
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Utilidad</span>
          <span className={cn("font-semibold text-emerald-300", isPrimary && "text-sm")}>
            {fmtAR(report.profit)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Facturación</span>
          <span className="font-semibold text-white">{fmtAR(report.revenue)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Salud</span>
          <span className={cn("font-semibold", healthTone.text)}>
            {report.health}/100 · {healthTone.label}
          </span>
        </div>
      </div>

      {insight ? (
        <div className="space-y-1.5 rounded-xl border border-white/[0.08] bg-white/[0.025] p-2.5 text-[11px]">
          <div className="flex items-start gap-1.5">
            <span className="text-emerald-300">▲</span>
            <span className="text-white/70">
              <span className="text-white/45">Mejora:</span> {insight.mejora}
            </span>
          </div>
          <div className="flex items-start gap-1.5">
            <span className="text-rose-300">▼</span>
            <span className="text-white/70">
              <span className="text-white/45">Problema:</span> {insight.problema}
            </span>
          </div>
        </div>
      ) : null}

      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn("h-full rounded-full bg-gradient-to-r", healthTone.bar)}
          style={{ width: `${report.health}%` }}
        />
      </div>
    </div>
  );
}

function ReportPlaceholder({ month }: { month: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-sm font-semibold text-white">{month}</p>
      <p className="mt-1 text-xs text-muted-foreground">Sin informe guardado.</p>
      <p className="mt-4 text-xs text-muted-foreground">
        Se va a crear automáticamente cuando corresponda.
      </p>
    </div>
  );
}

// ─── SIMULADORES TAB ─────────────────────────────────────────────────────────

function SimuladoresTab(props: SimuladorProps) {
  return <LaboratorioDecisiones {...props} />;
}

// ─── SIMULADOR DE PRECIOS ────────────────────────────────────────────────────

type SimuladorProps = {
  servicios: number;
  facturacion: number;
  ticket: number;
  clientes: number;
  ocupacion: number;
  businessId?: string | null;
};

type IARecomendacion = {
  nivel: "recomendado" | "evaluar" | "no_recomendado" | "progresivo" | "alto_riesgo";
  resumen: string;
};

type ProfSimResult = {
  nivel: "recomendado" | "evaluar" | "no_recomendado";
  resumen: string;
  facturacionPotencial: number;
  explicacionFacturacion: string;
};

type ServicioReal = {
  id: string;
  nombre: string;
  precio: number;
  mensual: number; // estimated from appointments (or 0 if unavailable)
};

function useServicesData(businessId: string | null | undefined) {
  const [servicios, setServicios] = React.useState<ServicioReal[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        // Load active services from price_catalog (duration_min != null → es servicio)
        const { data: catalog } = await supabase
          .from("price_catalog")
          .select("id,name,price,duration_min")
          .eq("business_id", businessId)
          .eq("active", true)
          .not("duration_min", "is", null)
          .order("name");

        if (cancelled) return;

        // Load current month appointments to estimate monthly count per service
        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

        const { data: appts } = await supabase
          .from("appointments")
          .select("service_name,status")
          .eq("business_id", businessId)
          .gte("starts_at", from)
          .lte("starts_at", to)
          .not("status", "in", "(cancelled,blocked)");

        if (cancelled) return;

        // Count appointments per service name (case-insensitive match)
        const countMap: Record<string, number> = {};
        for (const a of appts ?? []) {
          const key = (a.service_name ?? "").toLowerCase().trim();
          countMap[key] = (countMap[key] ?? 0) + 1;
        }

        const mapped: ServicioReal[] = (catalog ?? []).map((s) => ({
          id: s.id,
          nombre: s.name,
          precio: Number(s.price ?? 0),
          mensual: countMap[(s.name ?? "").toLowerCase().trim()] ?? 0,
        }));

        setServicios(mapped);
      } catch {
        // silently fail — component will show empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  return { servicios, loading };
}

const PRESETS = [500, 1000, 2000, 5000];

function fmtNum(n: number) {
  return n.toLocaleString("es-AR");
}

const nivelMeta = {
  recomendado: {
    emoji: "✅",
    label: "Recomendado",
    cls: "border-emerald-400/30 bg-emerald-400/[0.16]",
    titleCls: "text-emerald-300",
    dot: "bg-emerald-400",
  },
  progresivo: {
    emoji: "🟡",
    label: "Aplicar progresivamente",
    cls: "border-cyan-400/30 bg-cyan-400/[0.07]",
    titleCls: "text-cyan-300",
    dot: "bg-cyan-400",
  },
  evaluar: {
    emoji: "🟡",
    label: "Evaluar con cuidado",
    cls: "border-cyan-400/30 bg-cyan-400/[0.07]",
    titleCls: "text-cyan-300",
    dot: "bg-cyan-400",
  },
  no_recomendado: {
    emoji: "🔴",
    label: "No recomendado todavía",
    cls: "border-rose-400/30 bg-rose-400/[0.07]",
    titleCls: "text-rose-300",
    dot: "bg-rose-400",
  },
  alto_riesgo: {
    emoji: "⚠️",
    label: "Alto riesgo",
    cls: "border-orange-400/30 bg-orange-400/[0.07]",
    titleCls: "text-orange-300",
    dot: "bg-orange-400",
  },
};

// Servicios demo (en producción vendrían de price_catalog de Supabase)
const PRESETS_PCT = [10, 15, 20];
const PRESETS_FIJO = [500, 1000, 2000, 5000];

function getRecomendacion(
  aumentoNum: number,
  precioActual: number,
  ocupacion: number,
  serviciosPerdibles: number,
  cantidadMensual: number,
): IARecomendacion & { nivel: keyof typeof nivelMeta } {
  const pctAumento = precioActual > 0 ? (aumentoNum / precioActual) * 100 : 0;
  const pctPerdible = cantidadMensual > 0 ? (serviciosPerdibles / cantidadMensual) * 100 : 0;

  if (pctAumento > 30) {
    return {
      nivel: "alto_riesgo",
      resumen: `Este aumento representa un ${pctAumento.toFixed(0)}% sobre el precio actual, lo que es demasiado alto en relación a la demanda. Podrías perder más clientes de los que compensaría el nuevo precio. Considerá hacerlo en dos etapas.`,
    };
  }
  if (ocupacion >= 80 && pctAumento <= 15) {
    return {
      nivel: "recomendado",
      resumen: `Tu ocupación es alta (${ocupacion}%) y el aumento es moderado (${pctAumento.toFixed(0)}%). Este cambio parece seguro: podés perder hasta ${serviciosPerdibles} servicios al mes y seguir facturando lo mismo. Podés aplicarlo directamente.`,
    };
  }
  if (ocupacion >= 80 && pctAumento > 15) {
    return {
      nivel: "progresivo",
      resumen: `Tu ocupación es alta (${ocupacion}%) pero el aumento es considerable (${pctAumento.toFixed(0)}%). Conviene aplicarlo primero en clientes nuevos y servicios premium durante 2 semanas antes de generalizarlo.`,
    };
  }
  if (ocupacion >= 60 && pctAumento <= 15) {
    return {
      nivel: "progresivo",
      resumen: `Tu ocupación es moderada (${ocupacion}%) y el aumento es razonable (${pctAumento.toFixed(0)}%). Puede funcionar bien, pero conviene comunicarlo con anticipación y medir la respuesta los primeros 15 días. Podés perder hasta ${serviciosPerdibles} turnos sin perder facturación.`,
    };
  }
  if (ocupacion >= 60 && pctAumento > 15) {
    return {
      nivel: "evaluar",
      resumen: `Tu ocupación es del ${ocupacion}% y el aumento es del ${pctAumento.toFixed(0)}%. El riesgo es medio-alto. Antes de aplicarlo en toda la agenda, probalo en servicios premium o con clientes nuevos y medí el impacto real.`,
    };
  }
  return {
    nivel: "no_recomendado",
    resumen: `Tu ocupación actual (${ocupacion}%) todavía tiene margen libre. Subir precios ahora podría frenar la captación de nuevos clientes justo cuando más los necesitás. Primero conviene completar la agenda y luego revisar los precios.`,
  };
}

function SimuladorPrecios({ ticket, ocupacion, businessId }: SimuladorProps) {
  const { servicios: serviciosReales, loading: loadingServicios } = useServicesData(businessId);
  const [servicioId, setServicioId] = React.useState<string | null>(null);
  const [tipoAumento, setTipoAumento] = React.useState<"fijo" | "pct">("fijo");
  const [aumentoFijo, setAumentoFijo] = React.useState("");
  const [aumentoPct, setAumentoPct] = React.useState("");
  const [simulado, setSimulado] = React.useState(false);

  // Auto-select first service once loaded
  React.useEffect(() => {
    if (serviciosReales.length > 0 && !servicioId) {
      setServicioId(serviciosReales[0].id);
    }
  }, [serviciosReales, servicioId]);

  const servicio = serviciosReales.find((s) => s.id === servicioId) ?? serviciosReales[0] ?? null;
  const precioActual = servicio?.precio ?? 0;
  const cantidadMensual = servicio?.mensual ?? 0;
  const facturacionServicio = precioActual * cantidadMensual;

  // Calcular aumento en pesos
  const aumentoNum =
    tipoAumento === "fijo"
      ? Math.max(0, Number(aumentoFijo) || 0)
      : Math.round(precioActual * (Math.max(0, Number(aumentoPct) || 0) / 100));

  const nuevoPrecio = precioActual + aumentoNum;
  const ingresoExtra = aumentoNum * cantidadMensual;
  const cantidadEquilibrio =
    nuevoPrecio > 0 ? Math.ceil(facturacionServicio / nuevoPrecio) : cantidadMensual;
  const serviciosPerdibles = Math.max(0, cantidadMensual - cantidadEquilibrio);
  const pctPerdible =
    cantidadMensual > 0 ? ((serviciosPerdibles / cantidadMensual) * 100).toFixed(1) : "0";
  const riesgoLabel =
    Number(pctPerdible) < 10 ? "Bajo" : Number(pctPerdible) < 25 ? "Medio" : "Alto";
  const riesgoColor =
    Number(pctPerdible) < 10
      ? "text-emerald-300"
      : Number(pctPerdible) < 25
        ? "text-cyan-300"
        : "text-rose-300";

  const recomendacion =
    simulado && aumentoNum > 0
      ? getRecomendacion(aumentoNum, precioActual, ocupacion, serviciosPerdibles, cantidadMensual)
      : null;

  function calcular() {
    if (!aumentoNum) return;
    setSimulado(true);
  }

  function reset() {
    setSimulado(false);
    setAumentoFijo("");
    setAumentoPct("");
  }

  return (
    <GlassCard className="p-6 sm:p-8 space-y-8">
      {/* Header */}
      <div>
        <Badge icon={DollarSign}>Simulador de precios</Badge>
        <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">
          Simulador de precios
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Elegí un servicio, elegí el aumento y la IA te dice si conviene, cuánto ganás y cuántos
          clientes podés perder sin facturar menos.
        </p>
      </div>

      {/* Paso 1: Elegir servicio */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          1. Elegí el servicio a simular
        </p>
        {loadingServicios ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando servicios…
          </div>
        ) : serviciosReales.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-muted-foreground">
            No hay servicios activos. Creá servicios en{" "}
            <span className="font-semibold text-white">Configuración → Servicios</span> para usar el
            simulador.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {serviciosReales.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setServicioId(s.id);
                  reset();
                }}
                className={cn(
                  "rounded-xl border px-4 py-2 text-sm font-semibold transition-all",
                  servicioId === s.id
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground",
                )}
              >
                {s.nombre}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Paso 2: Datos actuales del servicio */}
      {servicio && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            2. Datos actuales — {servicio.nombre}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { label: "Precio actual", value: `$${fmtNum(precioActual)}` },
              {
                label: "Servicios este mes",
                value: cantidadMensual > 0 ? fmtNum(cantidadMensual) : "—",
              },
              {
                label: "Facturación/mes",
                value: cantidadMensual > 0 ? `$${fmtNum(facturacionServicio)}` : "—",
              },
              { label: "Ocupación", value: `${ocupacion}%` },
              { label: "Ticket prom. (total)", value: `$${fmtNum(ticket)}` },
            ].map((d) => (
              <div
                key={d.label}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-center"
              >
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground leading-tight">
                  {d.label}
                </div>
                <div className="mt-1.5 text-sm font-bold text-white tabular-nums">{d.value}</div>
              </div>
            ))}
          </div>
          {cantidadMensual === 0 && (
            <p className="text-xs text-muted-foreground">
              No se registraron turnos para{" "}
              <span className="font-semibold text-white">{servicio.nombre}</span> en el mes actual.
              La simulación usará el precio del servicio; el ingreso extra estimado se calculará por
              unidad.
            </p>
          )}
        </div>
      )}

      {/* Paso 3: Elegir aumento */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          3. Elegí el aumento
        </p>

        {/* Toggle fijo / % */}
        <div className="flex gap-2 mb-3">
          {(
            [
              ["fijo", "Monto fijo ($)"],
              ["pct", "Porcentaje (%)"],
            ] as const
          ).map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setTipoAumento(k);
                reset();
              }}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                tipoAumento === k
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-white/10 bg-white/[0.03] text-muted-foreground",
              )}
            >
              {lbl}
            </button>
          ))}
        </div>

        {tipoAumento === "fijo" ? (
          <div className="flex flex-wrap gap-2 items-center">
            {PRESETS_FIJO.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setAumentoFijo(String(p));
                  setSimulado(false);
                }}
                className={cn(
                  "rounded-xl border px-4 py-2 text-sm font-semibold transition-all",
                  Number(aumentoFijo) === p
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground",
                )}
              >
                +${fmtNum(p)}
              </button>
            ))}
            <input
              type="text"
              inputMode="numeric"
              placeholder="Otro monto $"
              value={aumentoFijo}
              onChange={(e) => {
                setAumentoFijo(e.target.value.replace(/\D/g, ""));
                setSimulado(false);
              }}
              className="w-36 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm outline-none focus:border-primary/40 placeholder:text-muted-foreground/50"
            />
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 items-center">
            {PRESETS_PCT.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setAumentoPct(String(p));
                  setSimulado(false);
                }}
                className={cn(
                  "rounded-xl border px-4 py-2 text-sm font-semibold transition-all",
                  Number(aumentoPct) === p
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground",
                )}
              >
                +{p}%
              </button>
            ))}
            <input
              type="text"
              inputMode="numeric"
              placeholder="Otro %"
              value={aumentoPct}
              onChange={(e) => {
                setAumentoPct(e.target.value.replace(/\D/g, ""));
                setSimulado(false);
              }}
              className="w-28 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm outline-none focus:border-primary/40 placeholder:text-muted-foreground/50"
            />
          </div>
        )}

        {/* Preview del nuevo precio + Calcular */}
        {aumentoNum > 0 && (
          <div className="flex items-center gap-4 pt-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">${fmtNum(precioActual)}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-bold text-emerald-300">${fmtNum(nuevoPrecio)}</span>
              <span className="text-xs text-emerald-300/70">(+${fmtNum(aumentoNum)})</span>
            </div>
            <button
              type="button"
              onClick={calcular}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Calcular
            </button>
          </div>
        )}
      </div>

      {/* Paso 4 + 5: Resultados + Recomendación */}
      {simulado && aumentoNum > 0 && (
        <div className="space-y-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            4. Resultado de la simulación
          </p>

          {/* Métricas clave */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Precio actual", value: `$${fmtNum(precioActual)}`, color: "text-white" },
              {
                label: "Nuevo precio",
                value: `$${fmtNum(nuevoPrecio)}`,
                color: "text-emerald-300",
              },
              {
                label: "Diferencia por servicio",
                value: `+$${fmtNum(aumentoNum)}`,
                color: "text-emerald-300",
              },
              {
                label: "Ingreso extra estimado",
                value: `+$${fmtNum(ingresoExtra)}/mes`,
                color: "text-emerald-300",
              },
            ].map((m) => (
              <div key={m.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {m.label}
                </div>
                <div className={cn("mt-2 font-display text-xl font-bold tabular-nums", m.color)}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>

          {/* Punto de equilibrio + Riesgo */}
          <div className="rounded-2xl border border-primary/20 bg-primary/[0.06] p-5 grid sm:grid-cols-2 gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary mb-2">
                Punto de equilibrio
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Podés perder hasta{" "}
                <span className="font-bold text-white">
                  {fmtNum(serviciosPerdibles)} servicios/mes ({pctPerdible}%)
                </span>{" "}
                y seguir facturando los mismos{" "}
                <span className="font-bold text-white">${fmtNum(facturacionServicio)}</span>{" "}
                actuales.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2">
                Riesgo estimado
              </p>
              <div className={cn("font-display text-3xl font-bold", riesgoColor)}>
                {riesgoLabel}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {riesgoLabel === "Bajo"
                  ? "Podés perder poca demanda antes de perder facturación."
                  : riesgoLabel === "Medio"
                    ? "Hay margen, pero conviene monitorear las primeras semanas."
                    : "El margen para perder demanda sin afectar facturación es pequeño."}
              </p>
            </div>
          </div>

          {/* Recomendación IA dinámica */}
          {recomendacion && (
            <div className={cn("rounded-2xl border p-5", nivelMeta[recomendacion.nivel].cls)}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{nivelMeta[recomendacion.nivel].emoji}</span>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    Recomendación IA
                  </p>
                  <p className={cn("text-base font-bold", nivelMeta[recomendacion.nivel].titleCls)}>
                    {nivelMeta[recomendacion.nivel].label}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {recomendacion.resumen}
              </p>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}

// ─── SIMULADOR PROFESIONAL ────────────────────────────────────────────────────

function SimuladorProfesional({
  servicios,
  facturacion,
  ticket,
  clientes,
  ocupacion,
}: SimuladorProps) {
  const [loadingIA, setLoadingIA] = React.useState(false);
  const [resultado, setResultado] = React.useState<ProfSimResult | null>(null);
  const [analizado, setAnalizado] = React.useState(false);

  // Estimación automática: nuevo profesional absorbe ~80% de la demanda promedio actual
  const serviciosNuevoProf = Math.round(servicios * 0.8);
  const facturacionPotencial = serviciosNuevoProf * ticket;

  async function analizar() {
    setLoadingIA(true);
    setAnalizado(true);
    setResultado(null);

    try {
      const prompt = `Sos el asesor de negocio de un servicio profesional (puede ser barbería, peluquería, uñas, estética, masajes, psicología, nutrición, odontología, tatuajes u otro negocio de servicios). Analizá si conviene incorporar un nuevo profesional. Respondé SOLO con JSON válido, sin markdown.

DATOS DEL NEGOCIO:
- Servicios realizados/mes: ${servicios}
- Facturación mensual: $${fmtNum(facturacion)}
- Ticket promedio: $${fmtNum(ticket)}
- Clientes atendidos: ${clientes}
- Ocupación promedio: ${ocupacion}%

CRITERIO DE EVALUACIÓN (basado exclusivamente en ocupación y demanda, NO en métricas por profesional):
- Ocupación < 65%: nivel = "no_recomendado" → hay capacidad disponible con el equipo actual
- Ocupación 65-79%: nivel = "evaluar" → monitorear, todavía no es necesario
- Ocupación 80-89%: nivel = "recomendado" → comenzar a evaluar incorporación
- Ocupación >= 90%: nivel = "recomendado" → se recomienda incorporar un profesional

Facturación potencial (solo calcular si nivel = "recomendado"):
- Estimá cuánta demanda adicional existe que no se puede absorber con la capacidad actual
- Basate en la ocupación y el ticket promedio, NO en "servicios por profesional por día"
- facturacionPotencial debe ser 0 si nivel != "recomendado"

JSON: {"nivel":"recomendado","resumen":"2-3 oraciones concretas con los datos reales explicando la recomendación basada en ocupación y demanda","facturacionPotencial":0,"explicacionFacturacion":"solo completar si nivel = recomendado, sino dejar vacío"}`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const json = await res.json();
      const text = (json.content ?? [])
        .map((b: { type: string; text?: string }) => (b.type === "text" ? (b.text ?? "") : ""))
        .join("");
      setResultado(JSON.parse(text.replace(/```json|```/g, "").trim()) as ProfSimResult);
    } catch {
      const nivel: ProfSimResult["nivel"] =
        ocupacion >= 80 ? "recomendado" : ocupacion >= 65 ? "evaluar" : "no_recomendado";
      const facturacionPotencial =
        nivel === "recomendado" ? Math.round(servicios * 0.8 * ticket) : 0;
      setResultado({
        nivel,
        resumen:
          nivel === "recomendado"
            ? `Tu ocupación del ${ocupacion}% indica que la agenda está casi completa. La demanda actual supera la capacidad disponible y se detectan horarios sin disponibilidad de forma recurrente.`
            : nivel === "evaluar"
              ? `Tu ocupación del ${ocupacion}% es moderada. Todavía existe capacidad para crecer con el equipo actual. Se recomienda volver a analizar cuando la ocupación supere el 80%.`
              : `Tu ocupación del ${ocupacion}% indica que hay capacidad disponible con el equipo actual. Antes de incorporar personal, conviene trabajar en completar la agenda existente.`,
        facturacionPotencial,
        explicacionFacturacion:
          nivel === "recomendado"
            ? `Basado en la demanda que no puede absorberse con la capacidad actual al ${ocupacion}% de ocupación y un ticket promedio de $${fmtNum(ticket)}.`
            : "",
      });
    } finally {
      setLoadingIA(false);
    }
  }

  return (
    <GlassCard className="p-5 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge icon={TrendingUp}>Análisis de equipo</Badge>
          <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">
            ¿Conviene incorporar un profesional?
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            La IA analiza la ocupación, demanda y capacidad actual para recomendarte si es el
            momento.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {[
            { label: "Ocupación", value: `${ocupacion}%` },
            { label: "🎟️ Ticket prom.", value: `$${fmtNum(ticket)}` },
            { label: "Facturación", value: `$${fmtNum(facturacion)}` },
          ].map((d) => (
            <div
              key={d.label}
              className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-center min-w-[100px]"
            >
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {d.label}
              </div>
              <div className="mt-1 text-sm font-semibold tabular-nums">{d.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Qué analiza la IA */}
      {!analizado && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-3">
            La IA va a analizar
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              "Ocupación promedio del período",
              "Horarios completos y sin disponibilidad",
              "Tendencia de crecimiento de clientes",
              "Capacidad disponible actual",
              "Ticket promedio y facturación",
              "Servicios realizados y demanda",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary/60" />
                {item}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Botón analizar */}
      {!analizado && (
        <button
          type="button"
          onClick={analizar}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
        >
          <Sparkles className="h-4 w-4" />
          Analizar ahora
        </button>
      )}

      {/* Loading */}
      {loadingIA && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
          <div>
            <p className="text-sm font-semibold">Analizando tu negocio…</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              La IA evalúa ocupación, demanda, horarios y tendencia de clientes.
            </p>
          </div>
        </div>
      )}

      {/* Resultado */}
      {!loadingIA && resultado && (
        <div className="space-y-4">
          {/* Recomendación */}
          <div className={cn("rounded-2xl border p-5", nivelMeta[resultado.nivel].cls)}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{nivelMeta[resultado.nivel].emoji}</span>
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Recomendación IA
                </p>
                <p className={cn("text-base font-semibold", nivelMeta[resultado.nivel].titleCls)}>
                  {resultado.nivel === "recomendado"
                    ? ocupacion >= 90
                      ? "Se recomienda incorporar un profesional"
                      : "Comenzar a evaluar la incorporación"
                    : resultado.nivel === "evaluar"
                      ? "Todavía no es necesario"
                      : "No se recomienda actualmente"}
                </p>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              {resultado.resumen}
            </p>
          </div>

          {/* Impacto económico — coherente con la recomendación */}
          {resultado.nivel === "recomendado" ? (
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                📈 Facturación potencial estimada
              </p>
              <p className="mt-3 font-display text-4xl font-semibold text-emerald-300 tracking-tight">
                +${fmtNum(resultado.facturacionPotencial)}
                <span className="ml-2 text-base font-normal text-emerald-300/70">por mes</span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                {resultado.explicacionFacturacion}
              </p>
            </div>
          ) : resultado.nivel === "evaluar" ? (
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.06] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
                📈 Potencial de crecimiento con el equipo actual
              </p>
              <p className="mt-3 font-display text-4xl font-semibold text-cyan-300 tracking-tight">
                {Math.round((1 - ocupacion / 100) * 100)}%
                <span className="ml-2 text-base font-normal text-cyan-300/70">
                  de capacidad disponible
                </span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                Ocupación actual: {ocupacion}%. Todavía existe capacidad suficiente para crecer con
                el equipo actual. Se recomienda volver a analizar cuando la ocupación supere el 80%.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-primary/20 bg-primary/[0.06] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                Capacidad disponible actual
              </p>
              <p className="mt-3 font-display text-4xl font-semibold text-foreground tracking-tight">
                ~{Math.round(servicios * (1 - ocupacion / 100))}
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  espacios libres por mes
                </span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                Todavía existen turnos disponibles con el equipo actual. Completar la agenda antes
                de incorporar un nuevo profesional maximiza la rentabilidad.
              </p>
            </div>
          )}

          {/* Volver a analizar */}
          <button
            type="button"
            onClick={() => {
              setAnalizado(false);
              setResultado(null);
            }}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground transition"
          >
            Volver a analizar
          </button>
        </div>
      )}
    </GlassCard>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  GERENTE DE CRECIMIENTO IA — motor de recomendaciones reales
//  Exclusivo para barberías y peluquerías. Lee datos reales (solo lectura):
//  clients (useClientsData), appointments, services, employees.
//  Cada recomendación responde: problema · dinero perdido · recuperable ·
//  acción exacta · a quién contactar · mensaje · cómo medir.
//  NO modifica base de datos ni ninguna otra parte de la app.
// ══════════════════════════════════════════════════════════════════════════

function GrowthContactsBlock({ contacts }: { contacts: RecommendationContact[] }) {
  const [open, setOpen] = React.useState(false);
  if (contacts.length === 0) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/45">
          Clientes afectados
        </span>
        <span className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
          <span className="grid h-6 min-w-[24px] place-items-center rounded-full bg-white/8 px-1.5 text-sm font-bold text-white/85 ring-1 ring-white/10">
            {contacts.length}
          </span>
          <span className="inline-flex items-center gap-1">
            {open ? "Ver menos" : "Ver todos"}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </span>
        </span>
      </button>
      {open ? (
        <div className="mt-3 space-y-1.5">
          {contacts.map((c, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium text-white/90">{c.name}</span>
              <span className="shrink-0 text-xs text-white/45">{c.detail}</span>
              {c.phone ? (
                <a
                  href={`https://wa.me/${c.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25"
                >
                  WhatsApp
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GrowthMessageBlock({ message }: { message: string }) {
  const [copied, setCopied] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left"
        >
          <span className="text-sm">💬</span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-white/45">
            Mensaje listo
          </span>
          <ChevronDown
            className={cn("h-3.5 w-3.5 text-white/40 transition-transform", open && "rotate-180")}
          />
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              navigator.clipboard?.writeText(message);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* ignore */
            }
          }}
          className="rounded-lg bg-white/8 px-2.5 py-1 text-xs font-semibold text-white/80 ring-1 ring-white/10 hover:bg-white/15"
        >
          {copied ? "¡Copiado!" : "Copiar"}
        </button>
      </div>
      {open ? <p className="mt-2 text-sm leading-relaxed text-white/80">{message}</p> : null}
    </div>
  );
}

const GROWTH_TONES: Record<RecommendationTone, { ring: string; glow: string; chip: string }> = {
  money: {
    ring: "ring-amber-300/25",
    glow: "from-amber-500/20 via-orange-500/10 to-transparent",
    chip: "bg-amber-400/15 text-amber-200 ring-amber-300/30",
  },
  warning: {
    ring: "ring-rose-300/25",
    glow: "from-rose-500/20 via-red-500/10 to-transparent",
    chip: "bg-rose-400/15 text-rose-200 ring-rose-300/30",
  },
  growth: {
    ring: "ring-emerald-300/25",
    glow: "from-emerald-500/20 via-teal-500/10 to-transparent",
    chip: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30",
  },
  client: {
    ring: "ring-cyan-300/25",
    glow: "from-cyan-500/20 via-blue-500/10 to-transparent",
    chip: "bg-cyan-400/15 text-cyan-200 ring-cyan-300/30",
  },
};

const PRIORITY_META: Record<
  RecommendationPriority,
  { label: string; emoji: string; chip: string }
> = {
  alta: { label: "Alta", emoji: "🔥", chip: "bg-rose-500/15 text-rose-200 ring-rose-400/35" },
  media: { label: "Media", emoji: "🟡", chip: "bg-amber-400/15 text-amber-100 ring-amber-300/30" },
  baja: {
    label: "Baja",
    emoji: "🟢",
    chip: "bg-emerald-400/15 text-emerald-100 ring-emerald-300/30",
  },
};

function getDaysSince(dateIso: string | null) {
  if (!dateIso) return 0;
  const diff = Date.now() - new Date(dateIso).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function ResolvedRecommendationCard({ achievement }: { achievement: RecommendationAchievement }) {
  const days = achievement.daysSince;
  return (
    <div className="relative overflow-hidden rounded-[26px] border border-emerald-300/20 bg-emerald-500/[0.055] p-5 ring-1 ring-emerald-300/20 backdrop-blur-2xl sm:p-6">
      <div className="pointer-events-none absolute -top-24 right-0 h-56 w-56 rounded-full bg-emerald-400/15 blur-3xl" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200 ring-1 ring-emerald-300/30">
            <CheckCircle2 className="h-3.5 w-3.5" /> Objetivo logrado
          </span>
          <h3 className="mt-3 text-xl font-extrabold leading-tight text-white">
            {achievement.title}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-white/70">{achievement.message}</p>
          <p className="mt-1 text-xs text-white/45">
            La dejamos visible 3 días como logro y después pasa al historial del Gerente IA.
          </p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          {achievement.moneyRecoverable > 0 ? (
            <>
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/40">
                Impacto recuperado
              </div>
              <div className="mt-1 text-2xl font-black text-emerald-200">
                {fmtAR(achievement.moneyRecoverable)}
              </div>
            </>
          ) : null}
          <div className="mt-2 text-xs font-semibold text-emerald-200/75">
            {days === 0 ? "Logrado hoy" : `Logrado hace ${days} ${days === 1 ? "día" : "días"}`}
          </div>
        </div>
      </div>
    </div>
  );
}

function AchievementsHistory({ achievements }: { achievements: RecommendationAchievement[] }) {
  const [open, setOpen] = React.useState(false);
  if (achievements.length === 0) return null;
  const visible = open ? achievements : achievements.slice(0, 4);
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/12 text-emerald-200 ring-1 ring-emerald-400/25">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl">
            Historial de logros IA
          </h2>
          <p className="text-xs text-white/45">La evolución de tu negocio gracias al Gerente IA</p>
        </div>
      </div>
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
        <ul className="space-y-2.5">
          {visible.map((a) => (
            <li key={a.key} className="flex items-start gap-3">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30">
                <CheckCircle2 className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white/90">{a.title}</p>
                <p className="text-[13px] leading-relaxed text-white/55">{a.message}</p>
              </div>
              {a.moneyRecoverable > 0 ? (
                <span className="ml-auto shrink-0 text-xs font-bold text-emerald-200/80">
                  {fmtAR(a.moneyRecoverable)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {achievements.length > 4 ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-200/80 hover:text-emerald-200"
          >
            {open ? "Ver menos" : `Ver los ${achievements.length} logros`}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function GrowthRecCard({ rec, hero = false }: { rec: Recommendation; hero?: boolean }) {
  const s = rec.strategy;
  const t = GROWTH_TONES[s.tone];
  const pm = PRIORITY_META[rec.priority];
  const [open, setOpen] = React.useState(false);

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-[28px] border border-white/10 bg-[#070b18]/76 p-5 shadow-[0_24px_80px_-58px_rgba(124,58,237,0.72)] ring-1 backdrop-blur-2xl transition duration-300 hover:-translate-y-0.5 hover:bg-[#080b18]/90 sm:p-6",
        t.ring,
        hero && "ring-2",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -top-28 right-0 h-56 w-56 rounded-full bg-gradient-to-br blur-3xl opacity-80",
          t.glow,
        )}
      />
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1",
              pm.chip,
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" /> {pm.label}
          </span>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1",
              t.chip,
            )}
          >
            {s.category}
          </span>
        </div>

        <div className="mt-4 flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/[0.07] text-2xl ring-1 ring-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            {s.icon}
          </span>
          <div className="min-w-0">
            <h3
              className={cn(
                "font-display font-extrabold leading-[1.08] tracking-[-0.035em] text-white",
                hero ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl",
              )}
            >
              {rec.title}
            </h3>
            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-white/55">
              {rec.description}
            </p>
          </div>
        </div>

        <div
          className={cn(
            "mt-5 rounded-2xl border p-4",
            s.moneyRecoverable > 0
              ? "border-emerald-400/25 bg-emerald-500/[0.075]"
              : "border-white/10 bg-white/[0.035]",
          )}
        >
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-white/45">
            {s.moneyRecoverable > 0 ? "Podés recuperar" : "Oportunidad"}
          </div>
          <div
            className={cn(
              "mt-1 font-display text-3xl font-black tracking-[-0.04em]",
              s.moneyRecoverable > 0 ? "text-emerald-200" : "text-white/85",
            )}
          >
            {s.moneyRecoverable > 0 ? fmtAR(s.moneyRecoverable) : "Sin monto directo"}
          </div>
          {s.moneyRecoverable > 0 ? (
            <div className="mt-0.5 text-xs font-semibold text-emerald-200/55">por mes</div>
          ) : null}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-white/60">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="truncate">
              {s.steps.length}{" "}
              {s.steps.length === 1 ? "acción recomendada" : "acciones recomendadas"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.10] px-4 py-2 text-sm font-black text-white ring-1 ring-white/15 transition hover:bg-white/[0.16]"
          >
            {open ? "Ocultar" : "Ver estrategia"}
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        </div>

        {open ? (
          <div className="mt-5 space-y-3 border-t border-white/[0.08] pt-5">
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.055] to-white/[0.02] p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.14em] text-white/45">
                Estrategia recomendada
              </div>
              <p className="mt-1.5 text-base font-bold leading-snug text-white/90">{s.action}</p>
              <ol className="mt-3 space-y-2">
                {s.steps.map((step, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-white/68">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-bold text-white/80">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            <GrowthContactsBlock contacts={s.contacts} />
            <GrowthMessageBlock message={s.message} />
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
              <div className="text-[11px] font-black uppercase tracking-[0.14em] text-white/45">
                Cómo medir si funcionó
              </div>
              <p className="mt-1 text-sm leading-relaxed text-white/60">{s.measure}</p>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ManagerTrendSparkline() {
  return (
    <svg
      viewBox="0 0 320 120"
      className="h-28 w-full max-w-[360px] overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="clippr-manager-line" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="rgb(124 58 237)" />
          <stop offset="55%" stopColor="rgb(168 85 247)" />
          <stop offset="100%" stopColor="rgb(94 234 212)" />
        </linearGradient>
        <filter id="clippr-manager-glow" x="-20%" y="-80%" width="140%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        d="M8 94 C36 84 42 65 66 68 S100 88 124 64 S157 28 184 42 S220 74 244 48 S286 40 312 18"
        fill="none"
        stroke="url(#clippr-manager-line)"
        strokeWidth="5"
        strokeLinecap="round"
        filter="url(#clippr-manager-glow)"
      />
      <circle
        cx="312"
        cy="18"
        r="7"
        fill="rgb(94 234 212)"
        className="drop-shadow-[0_0_14px_rgba(94,234,212,0.8)]"
      />
    </svg>
  );
}

function ManagerHero({ rec, totalOpportunity }: { rec: Recommendation; totalOpportunity: number }) {
  const s = rec.strategy;
  const amount = s.moneyRecoverable > 0 ? s.moneyRecoverable : totalOpportunity;
  const keyMetric = s.moneyLost > 0 ? fmtAR(s.moneyLost) : rec.score;
  const keyLabel = s.moneyLost > 0 ? "pérdida estimada detectada" : "score de prioridad";

  return (
    <section className="relative overflow-hidden rounded-[34px] border border-violet-300/20 bg-[#090b18]/82 p-6 shadow-[0_36px_120px_-58px_rgba(139,92,246,0.95)] ring-1 ring-white/10 backdrop-blur-2xl sm:p-8 lg:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_10%,rgba(168,85,247,0.22),transparent_38%),radial-gradient(circle_at_92%_12%,rgba(20,184,166,0.20),transparent_35%),linear-gradient(135deg,rgba(168,85,247,0.12),transparent_42%,rgba(14,165,233,0.08))]" />
      <div className="relative grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-violet-500/12 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-violet-200 ring-1 ring-violet-300/25">
            <Brain className="h-3.5 w-3.5" /> Tu prioridad hoy
          </div>
          <h2 className="mt-5 max-w-2xl font-display text-4xl font-black leading-[0.98] tracking-[-0.055em] text-white sm:text-5xl">
            {rec.title}
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-white/68">{rec.description}</p>
          <div className="mt-6">
            <div className="text-[12px] font-black uppercase tracking-[0.18em] text-emerald-200/70">
              Podés recuperar
            </div>
            <div className="mt-1 bg-gradient-to-r from-emerald-300 via-teal-200 to-cyan-200 bg-clip-text font-display text-5xl font-black tracking-[-0.06em] text-transparent sm:text-6xl">
              {fmtAR(amount)}
            </div>
            <div className="mt-1 text-sm font-semibold text-white/50">
              este mes si ejecutás la estrategia principal
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              document
                .getElementById(`strategy-${rec.key}`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-3 text-sm font-black text-white shadow-[0_18px_45px_-22px_rgba(168,85,247,0.9)] ring-1 ring-white/15 transition hover:brightness-110"
          >
            Ver estrategia <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="relative min-h-[220px] overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.045] p-5 ring-1 ring-white/8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_22%,rgba(168,85,247,0.22),transparent_42%)]" />
          <div className="relative flex h-full flex-col justify-between gap-6">
            <ManagerTrendSparkline />
            <div className="ml-auto w-full max-w-[330px] rounded-3xl border border-fuchsia-300/28 bg-fuchsia-500/[0.09] p-5 ring-1 ring-fuchsia-300/20">
              <div className="flex items-end gap-4">
                <div className="font-display text-5xl font-black tracking-[-0.06em] text-white">
                  {keyMetric}
                </div>
                <div className="pb-1 text-sm font-semibold leading-snug text-white/70">
                  {keyLabel}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function RecentAchievements({
  resolved,
  achievements,
}: {
  resolved: RecommendationAchievement[];
  achievements: RecommendationAchievement[];
}) {
  const recent = [...resolved, ...achievements].slice(0, 4);
  if (recent.length === 0) return null;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-black tracking-[-0.035em] text-white">
            Logros recientes
          </h2>
          <p className="mt-1 text-sm text-white/48">
            Problemas que ya mejoraron y dejaron impacto positivo.
          </p>
        </div>
        {achievements.length > 4 ? (
          <button className="text-sm font-bold text-violet-200 hover:text-white">
            Ver historial completo →
          </button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {recent.map((a) => (
          <div
            key={a.key}
            className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 ring-1 ring-white/8 backdrop-blur-xl"
          >
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-500/16 text-emerald-200 ring-1 ring-emerald-400/25">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <h3 className="mt-3 line-clamp-2 text-sm font-black leading-snug text-white/90">
              {a.title}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/52">{a.message}</p>
            <span className="mt-3 inline-flex rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-bold text-white/55 ring-1 ring-white/10">
              {a.daysSince === 0
                ? "Logrado hoy"
                : `Hace ${a.daysSince} ${a.daysSince === 1 ? "día" : "días"}`}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// Cantidad de recomendaciones visibles de entrada. El Gerente IA no debe llenar
// la pantalla: 1 prioridad ejecutiva + 3 recomendaciones compactas.
const GROWTH_VISIBLE_LIMIT = 3;

function GrowthManagerTab({ businessId: _businessId }: { businessId: string | null | undefined }) {
  const [actionStatuses, setActionStatuses] = React.useState(() => getStoredAdvisorStatuses());
  const [detailAction, setDetailAction] = React.useState<AdvisorAction | null>(null);

  const actions = React.useMemo(() => {
    const generated = getDemoActions(true);
    const withStoredStatus = generated.map((action) => {
      const saved = actionStatuses[action.id];
      if (!saved) return action;
      if (
        saved.status === "completed" &&
        saved.completedAt &&
        Date.now() - saved.completedAt >= THREE_DAYS_MS
      ) {
        return {
          ...action,
          status: "archived" as const,
          startedAt: saved.startedAt,
          completedAt: saved.completedAt,
        };
      }
      return {
        ...action,
        status: saved.status,
        startedAt: saved.startedAt,
        completedAt: saved.completedAt,
      };
    });
    return sortAdvisorActions(withStoredStatus);
  }, [actionStatuses]);

  const activeActions = actions.filter((action) => action.status !== "archived");
  const archivedActions = actions.filter((action) => action.status === "archived");

  const heroAction = activeActions[0] ?? null;
  const secondaryActions = activeActions
    .filter((action) => action.id !== heroAction?.id)
    .slice(0, 3);

  function updateActionStatus(action: AdvisorAction, status: AdvisorAction["status"]) {
    setActionStatuses((current) => {
      const next = {
        ...current,
        [action.id]: {
          status,
          startedAt:
            status === "running" ? Date.now() : (current[action.id]?.startedAt ?? action.startedAt),
          completedAt:
            status === "completed"
              ? Date.now()
              : (current[action.id]?.completedAt ?? action.completedAt),
        },
      };
      saveStoredAdvisorStatuses(next);
      return next;
    });
  }

  function handlePrimaryAction(action: AdvisorAction) {
    if (action.status === "pending") {
      updateActionStatus(action, "running");
    }
  }

  function markActionCompleted(action: AdvisorAction) {
    updateActionStatus(action, "completed");
    setDetailAction(null);
  }

  return (
    <div className="mt-6 space-y-8">
      {heroAction && (
        <section className="relative overflow-hidden rounded-[28px] border border-violet-400/35 bg-[#070b18]/80 p-5 shadow-[0_0_0_1px_rgba(139,92,246,0.12),0_28px_95px_-45px_rgba(139,92,246,0.95)] backdrop-blur-xl sm:p-6">
          <div className="pointer-events-none absolute -inset-x-20 -top-24 h-56 bg-violet-500/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-violet-200">
              <Target className="h-4 w-4" />
              Recomendación principal
            </div>

            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold",
                getPriorityToneClasses(heroAction.priorityTone),
              )}
            >
              <Crown className="h-4 w-4" />
              {heroAction.priorityLabel}
            </div>
          </div>

          <div className="relative mt-6 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="flex gap-5">
              <div className="grid h-24 w-24 shrink-0 place-items-center rounded-3xl border border-violet-300/35 bg-violet-500/20 shadow-[0_0_34px_rgba(139,92,246,0.35)]">
                <heroAction.icon className="h-11 w-11 text-violet-200" />
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  {heroAction.title}
                </h2>

                <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/70">
                  {heroAction.detail}
                </p>

                <div className="mt-5 grid gap-3 xl:grid-cols-3">
                  <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs text-white/55">
                      <DollarSign className="h-4 w-4 text-emerald-300" />
                      Impacto estimado
                    </div>
                    <div className="break-words text-[clamp(1.05rem,2vw,1.5rem)] font-bold leading-tight text-emerald-300">
                      {heroAction.impactAmount}
                    </div>
                    <div className="mt-1 text-xs text-white/55">en 30 días</div>
                  </div>

                  <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs text-white/55">
                      <Users className="h-4 w-4 text-blue-300" />
                      {heroAction.metricLabel}
                    </div>
                    <div className="text-2xl font-bold text-white">{heroAction.metricValue}</div>
                  </div>

                  <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs text-white/55">
                      <Target className="h-4 w-4 text-violet-300" />
                      Objetivo
                    </div>
                    <div className="text-base font-bold leading-snug text-white">
                      {heroAction.objective}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-violet-300/15 bg-violet-400/[0.055] p-4 text-sm leading-relaxed text-white/75">
                  <div className="flex gap-3">
                    <Brain className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" />
                    <p>
                      Esta acción fue seleccionada porque representa la mayor oportunidad económica
                      detectada hoy en tu negocio.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
              <h3 className="text-base font-bold text-white">¿Por qué es prioridad?</h3>

              <div className="mt-4 space-y-3 text-sm text-white/75">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-violet-300" />
                  <span>{heroAction.problem}</span>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-violet-300" />
                  <span>{heroAction.impactExplanation}</span>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-violet-300" />
                  <span>Es la oportunidad con mayor impacto detectada hoy.</span>
                </div>
              </div>

              <div className="mt-5 h-28 rounded-2xl border border-violet-300/10 bg-[radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.35),transparent_32%),linear-gradient(135deg,rgba(139,92,246,0.12),rgba(15,23,42,0.25))]" />

              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDetailAction(heroAction)}
                  className="rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-3 text-sm font-bold text-white/80 transition hover:bg-white/[0.06] hover:text-white"
                >
                  Ver detalle
                </button>

                {heroAction.status === "completed" ? (
                  <span className="inline-flex items-center gap-3 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-6 py-3 text-sm font-bold text-emerald-200">
                    <CheckCircle2 className="h-5 w-5" />
                    Objetivo logrado
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handlePrimaryAction(heroAction)}
                    disabled={heroAction.status === "running"}
                    className={cn(
                      "inline-flex items-center gap-3 rounded-2xl px-6 py-3 text-sm font-bold transition disabled:cursor-default",
                      heroAction.status === "running"
                        ? "border border-violet-300/30 bg-violet-400/12 text-violet-100"
                        : "bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white shadow-[0_20px_55px_-24px_rgba(168,85,247,0.9)] hover:-translate-y-0.5",
                    )}
                  >
                    {heroAction.status === "running" ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Estrategia en curso
                      </>
                    ) : (
                      <>
                        Empezar estrategia
                        <ArrowRight className="h-5 w-5" />
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {secondaryActions.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white">Próximas prioridades</h2>
            <CircleHelp className="h-4 w-4 text-white/35" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {secondaryActions.map((action) => {
              const Icon = action.icon;
              return (
                <article
                  key={action.id}
                  className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 shadow-[0_22px_70px_-52px_rgba(0,0,0,0.95)] transition hover:-translate-y-0.5 hover:border-violet-300/25 hover:bg-white/[0.045]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid h-14 w-14 place-items-center rounded-2xl border border-violet-300/25 bg-violet-400/12">
                      <Icon className="h-7 w-7 text-violet-200" />
                    </div>

                    <span
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold",
                        getPriorityToneClasses(action.priorityTone),
                      )}
                    >
                      {action.priorityLabel}
                    </span>
                  </div>

                  <h3 className="mt-4 text-lg font-bold text-white">{action.title}</h3>
                  <p className="mt-2 min-h-[56px] text-sm leading-relaxed text-white/65">
                    {action.detail}
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="min-w-0 rounded-xl border border-white/8 bg-white/[0.025] p-3">
                      <div className="text-[11px] text-white/45">Impacto estimado</div>
                      <div className="mt-1 break-words text-sm font-bold leading-tight text-emerald-300">
                        {action.impactAmount}
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
                      <div className="text-[11px] text-white/45">{action.metricLabel}</div>
                      <div className="mt-1 text-base font-bold text-white">
                        {action.metricValue}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2">
                    <button
                      type="button"
                      onClick={() => setDetailAction(action)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/75 transition hover:bg-white/[0.06] hover:text-white"
                    >
                      Ver detalle
                    </button>

                    {action.status === "completed" ? (
                      <span className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-emerald-200">
                        <CheckCircle2 className="h-4 w-4" />
                        Objetivo logrado
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handlePrimaryAction(action)}
                        disabled={action.status === "running"}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-violet-300/25 bg-violet-400/[0.045] px-4 py-3 text-sm font-bold text-violet-100 transition hover:bg-violet-400/10 disabled:cursor-default disabled:hover:bg-violet-400/[0.045]"
                      >
                        {action.status === "running" ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Estrategia en curso
                          </>
                        ) : (
                          <>
                            Empezar estrategia
                            <ArrowRight className="h-4 w-4" />
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Trophy className="h-5 w-5 text-white/75" />
            <h2 className="text-xl font-bold text-white">Historial de logros</h2>
          </div>

          <button
            type="button"
            className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-2 text-sm font-semibold text-white/75 transition hover:bg-white/[0.06] hover:text-white"
          >
            Ver todos
          </button>
        </div>

        <div className="relative space-y-2 pl-6">
          <div className="absolute bottom-4 left-[11px] top-4 w-px bg-emerald-400/35" />

          {archivedActions.length > 0 ? (
            archivedActions.map((action) => {
              const AreaIcon = getAreaIcon(action.area);
              return (
                <div
                  key={action.id}
                  className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <div className="absolute -left-[30px] top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-emerald-400 text-[#06140c] shadow-[0_0_20px_rgba(16,185,129,0.45)]">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>

                  <div className="grid gap-3 md:grid-cols-[1fr_140px_140px_120px] md:items-center">
                    <div>
                      <div className="font-semibold text-white">{action.title}</div>
                      <div className="mt-1 text-sm text-white/50">
                        Completado automáticamente por el Gerente IA
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-white/45">Impacto</div>
                      <div className="font-bold text-emerald-300">{action.impactAmount}</div>
                    </div>

                    <div>
                      <div className="text-xs text-white/45">Área</div>
                      <div className="mt-1 flex items-center gap-2 text-sm text-white/75">
                        <AreaIcon className="h-4 w-4" />
                        {action.area}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-white/55">
                      <CalendarDays className="h-4 w-4" />
                      {getDaysAgo(action.completedAt)}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm text-white/50">
              Todavía no hay logros archivados. Cuando una estrategia se complete, se mostrará acá
              después de 3 días.
            </div>
          )}
        </div>
      </section>


      {detailAction ? (
        <AdvisorActionDetailModal
          action={detailAction}
          onClose={() => setDetailAction(null)}
          onStart={() => handlePrimaryAction(detailAction)}
          onComplete={() => markActionCompleted(detailAction)}
        />
      ) : null}
      <div className="rounded-[24px] border border-violet-300/25 bg-violet-400/[0.055] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-violet-400/10 ring-1 ring-violet-300/25">
              <Brain className="h-8 w-8 text-violet-300" />
            </div>

            <div>
              <div className="font-bold text-violet-200">El Asesor IA aprende de tu negocio</div>
              <div className="mt-1 text-sm text-white/60">
                Cuanto más uses las recomendaciones, mejores y más precisas serán.
              </div>
            </div>
          </div>

          <button
            type="button"
            className="rounded-2xl border border-violet-300/30 px-6 py-3 text-sm font-bold text-violet-100 transition hover:bg-violet-400/10"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}


function AdvisorActionDetailModal({
  action,
  onClose,
  onStart,
  onComplete,
}: {
  action: AdvisorAction;
  onClose: () => void;
  onStart: () => void;
  onComplete: () => void;
}) {
  const Icon = action.icon;
  const canStart = action.status === "pending";
  const canComplete = action.status === "running";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-md">
      <div className="relative max-h-[90svh] w-full max-w-3xl overflow-y-auto rounded-[2rem] border border-violet-300/20 bg-[#080715]/95 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_35px_120px_-45px_rgba(139,92,246,0.9)] sm:p-6">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-violet-500/18 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 bottom-0 h-52 w-52 rounded-full bg-cyan-500/10 blur-3xl" />

        <div className="relative flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-violet-300/25 bg-violet-400/12">
              <Icon className="h-7 w-7 text-violet-200" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-[0.22em] text-violet-300">
                Detalle de estrategia
              </div>
              <h2 className="mt-2 break-words font-display text-2xl font-bold tracking-tight text-white">
                {action.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-white/65">{action.detail}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold text-white/60 transition hover:bg-white/[0.09] hover:text-white"
          >
            Cerrar
          </button>
        </div>

        <div className="relative mt-6 grid gap-3 sm:grid-cols-3">
          <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="text-xs text-white/45">Impacto esperado</div>
            <div className="mt-1 break-words text-xl font-bold leading-tight text-emerald-300">
              {action.impactAmount}
            </div>
          </div>
          <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="text-xs text-white/45">Métrica usada</div>
            <div className="mt-1 break-words text-xl font-bold leading-tight text-white">
              {action.metricValue}
            </div>
            <div className="mt-1 text-xs text-white/45">{action.metricLabel}</div>
          </div>
          <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="text-xs text-white/45">Estado</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-bold text-violet-100">
              {action.status === "completed" ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" /> Objetivo logrado
                </>
              ) : action.status === "running" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Estrategia en curso
                </>
              ) : (
                <>
                  <Clock className="h-4 w-4 text-violet-300" /> Pendiente
                </>
              )}
            </div>
          </div>
        </div>

        <div className="relative mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-bold text-white">Por qué se recomienda</h3>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-white/70">
              <p>{action.problem}</p>
              <p>{action.impactExplanation}</p>
              <p>{action.opportunity}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-bold text-white">Acciones sugeridas</h3>
            <div className="mt-3 space-y-2">
              {action.howToAct.map((step) => (
                <div key={step} className="flex gap-3 text-sm leading-relaxed text-white/70">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative mt-5 rounded-2xl border border-violet-300/15 bg-violet-400/[0.055] p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-violet-200">
            <MessageCircle className="h-4 w-4" /> Mensaje sugerido
          </div>
          <p className="mt-3 text-sm leading-relaxed text-white/70">{action.suggestedMessage}</p>
        </div>

        <div className="relative mt-6 flex flex-wrap justify-end gap-3">
          {canStart ? (
            <button
              type="button"
              onClick={onStart}
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-5 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5"
            >
              Empezar estrategia
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : null}

          {canComplete ? (
            <button
              type="button"
              onClick={onComplete}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-5 py-3 text-sm font-bold text-emerald-200 transition hover:bg-emerald-400/15"
            >
              <CheckCircle2 className="h-4 w-4" />
              Marcar objetivo logrado
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ManagerFooter() {
  const updated = new Date().toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <footer className="relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.035] p-5 ring-1 ring-white/8 backdrop-blur-xl sm:p-6">
      <div className="pointer-events-none absolute -left-16 -top-16 h-40 w-40 rounded-full bg-violet-500/15 blur-3xl" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-500/12 text-2xl ring-1 ring-violet-300/20">
            🧠
          </span>
          <div>
            <p className="font-display text-base font-black tracking-tight text-white">
              El Gerente IA aprende de tu negocio todos los días
            </p>
            <p className="mt-1 text-sm text-white/52">
              Analiza tus datos, detecta oportunidades y prioriza automáticamente las acciones con
              mayor impacto económico.
            </p>
          </div>
        </div>
        <div className="shrink-0 text-sm font-semibold text-white/52">
          Última actualización: Hoy {updated}{" "}
          <span className="ml-2 inline-block h-2 w-2 rounded-full bg-emerald-400" />
        </div>
      </div>
    </footer>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  LABORATORIO DE DECISIONES — 7 simuladores para barberías y peluquerías.
//  Reemplaza la experiencia de "Simuladores". Cálculos deterministas e
//  instantáneos con datos reales donde existen (servicios, clientes, agenda,
//  horarios) + supuestos claros y editables. No toca el resto de la app.
// ══════════════════════════════════════════════════════════════════════════

const LAB_MARGIN = 0.45; // utilidad estimada sobre facturación (editable conceptualmente)
const LAB_PRODUCT_MARGIN = 0.55; // los productos suelen dejar más margen
const LAB_TURNOS_POR_HORA = 1.3; // ~45 min por servicio promedio

type LabData = {
  loading: boolean;
  avgTicket: number;
  monthlyClients: number;
  monthlyVisits: number;
  avgTurnosPerDay: number;
  openDaysPerWeek: number;
  sundayOpen: boolean;
  inactivos: number;
  inactivosValue: number;
  services: ServicioReal[];
};

const LAB_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

// Estados que cuentan como turno efectivamente realizado (espejo del motor).
const DONE_STATUSES = ["completed", "charged"];

function useLabData(
  businessId: string | null | undefined,
  fallbackTicket: number,
  fallbackClients: number,
): LabData {
  const clientsQuery = useClientsData(businessId ?? null);
  const { servicios, loading: loadingServices } = useServicesData(businessId);
  const [appts, setAppts] = React.useState<
    { starts_at: string; status: string; client_id: string | null }[]
  >([]);
  const [openDays, setOpenDays] = React.useState<boolean[]>([
    false,
    true,
    true,
    true,
    true,
    true,
    false,
  ]);
  const [loadingExtra, setLoadingExtra] = React.useState(true);

  React.useEffect(() => {
    if (!businessId) {
      setLoadingExtra(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingExtra(true);
      const since = new Date();
      since.setDate(since.getDate() - 30);
      try {
        const [apptRes, settRes] = await Promise.all([
          supabase
            .from("appointments")
            .select("starts_at,status,client_id")
            .eq("business_id", businessId)
            .gte("starts_at", since.toISOString()),
          supabase
            .from("business_settings")
            .select("schedule")
            .eq("business_id", businessId)
            .maybeSingle(),
        ]);
        if (cancelled) return;
        setAppts(
          apptRes.error
            ? []
            : ((apptRes.data ?? []) as {
                starts_at: string;
                status: string;
                client_id: string | null;
              }[]),
        );
        const schedule = (
          settRes.data as { schedule?: Record<string, { enabled?: boolean }> } | null
        )?.schedule;
        if (schedule && typeof schedule === "object") {
          setOpenDays(LAB_DAY_KEYS.map((k) => schedule[k]?.enabled !== false && !!schedule[k]));
        }
      } catch {
        /* degradar con elegancia */
      } finally {
        if (!cancelled) setLoadingExtra(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const clients = clientsQuery.data ?? [];
  const totalVisits = clients.reduce((s, c) => s + c.visits, 0);
  const totalSpent = clients.reduce((s, c) => s + c.spent, 0);
  const svcAvg =
    servicios.length > 0
      ? Math.round(servicios.reduce((s, x) => s + x.precio, 0) / servicios.length)
      : 0;
  const avgTicket =
    totalVisits > 0 ? Math.round(totalSpent / totalVisits) : svcAvg || fallbackTicket;

  const done = appts.filter((a) => DONE_STATUSES.includes(a.status));
  const monthlyVisits = done.length || Math.round(fallbackClients * 1.5);
  const monthlyClients =
    new Set(done.map((a) => a.client_id).filter(Boolean)).size || fallbackClients;

  const inactivosList = clients.filter(
    (c) => c.visits >= 1 && (c.lastVisitDays ?? 0) >= 45 && (c.lastVisitDays ?? 0) < 180,
  );
  const inactivos = inactivosList.length;
  const inactivosValue = inactivosList.reduce(
    (s, c) => s + (c.visits > 0 ? Math.round(c.spent / c.visits) : avgTicket),
    0,
  );

  const openDaysPerWeek = openDays.filter(Boolean).length || 6;
  const sundayOpen = openDays[0] === true;
  const avgTurnosPerDay = Math.max(1, Math.round(monthlyVisits / (openDaysPerWeek * 4.3)));

  return {
    loading: clientsQuery.isLoading || loadingServices || loadingExtra,
    avgTicket,
    monthlyClients,
    monthlyVisits,
    avgTurnosPerDay,
    openDaysPerWeek,
    sundayOpen,
    inactivos,
    inactivosValue,
    services: servicios,
  };
}

// ── Bloques visuales compartidos ───────────────────────────────────────────

function LabScenario({
  currentLabel,
  currentValue,
  projectedLabel,
  projectedValue,
}: {
  currentLabel: string;
  currentValue: React.ReactNode;
  projectedLabel: string;
  projectedValue: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-white/40">
          {currentLabel}
        </div>
        <div className="mt-1 text-2xl font-bold text-white/85">{currentValue}</div>
      </div>
      <div className="grid place-items-center text-white/30">
        <ArrowRight className="h-5 w-5" />
      </div>
      <div className="rounded-2xl border border-emerald-300/25 bg-emerald-400/[0.07] p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-200/70">
          {projectedLabel}
        </div>
        <div className="mt-1 text-2xl font-bold text-emerald-200">{projectedValue}</div>
      </div>
    </div>
  );
}

function LabImpact({
  facturacion,
  utilidad,
  extra,
}: {
  facturacion: number;
  utilidad: number;
  extra?: { label: string; value: string };
}) {
  return (
    <div className={cn("grid gap-2", extra ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      <div className="rounded-2xl border border-sky-300/20 bg-sky-400/[0.06] px-3.5 py-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-sky-200/70">
          Facturación extra / mes
        </div>
        <div className="mt-1 text-2xl font-extrabold text-sky-200">+{fmtAR(facturacion)}</div>
      </div>
      <div className="rounded-2xl border border-emerald-300/25 bg-emerald-400/[0.08] px-3.5 py-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-200/80">
          Utilidad extra / mes
        </div>
        <div className="mt-1 text-2xl font-extrabold text-emerald-200">+{fmtAR(utilidad)}</div>
      </div>
      {extra ? (
        <div className="rounded-2xl border border-violet-300/20 bg-violet-400/[0.06] px-3.5 py-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-violet-200/70">
            {extra.label}
          </div>
          <div className="mt-1 text-2xl font-extrabold text-violet-200">{extra.value}</div>
        </div>
      ) : null}
    </div>
  );
}

function LabVerdict({ nivel, text }: { nivel: keyof typeof nivelMeta; text: string }) {
  const meta = nivelMeta[nivel];
  return (
    <div className={cn("rounded-2xl border p-4", meta.cls)}>
      <div className={cn("flex items-center gap-2 text-sm font-bold", meta.titleCls)}>
        <span>{meta.emoji}</span> Recomendación IA · {meta.label}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-white/80">{text}</p>
    </div>
  );
}

function LabChips({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (k: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-xl border px-3.5 py-1.5 text-sm font-semibold transition-all",
            value === o.key
              ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-100 shadow-[0_0_24px_-8px_rgba(34,211,238,0.6)]"
              : "border-white/10 bg-white/[0.03] text-white/55 hover:text-white hover:border-white/20",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Simuladores ────────────────────────────────────────────────────────────

function LabPrecios({ data }: { data: LabData }) {
  const services = data.services.length > 0 ? data.services : [];
  const [svcId, setSvcId] = React.useState<string | null>(null);
  const svc = services.find((s) => s.id === svcId) ?? services[0] ?? null;
  const [aumento, setAumento] = React.useState(1000);

  if (data.loading) return <LabSkeleton />;
  if (services.length === 0) {
    return (
      <LabEmpty text="Todavía no hay servicios cargados con precio. Cargá tus servicios (Corte, Corte + Barba, Color…) en Configuración para simular aumentos reales." />
    );
  }

  const precioActual = svc?.precio ?? 0;
  const mensual = svc?.mensual ?? 0;
  const precioNuevo = precioActual + aumento;
  const diferenciaMensual = mensual * aumento;
  const pct = precioActual > 0 ? (aumento / precioActual) * 100 : 0;
  // Clientes que podés perder manteniendo la misma facturación del servicio.
  const perdibles =
    precioNuevo > 0 ? Math.max(0, mensual - Math.ceil((mensual * precioActual) / precioNuevo)) : 0;
  const avgPrice =
    services.length > 0
      ? Math.round(services.reduce((s, x) => s + x.precio, 0) / services.length)
      : 0;

  const nivel: keyof typeof nivelMeta =
    pct > 30 ? "alto_riesgo" : pct <= 12 ? "recomendado" : pct <= 20 ? "progresivo" : "evaluar";
  const verdict =
    pct > 30
      ? `Subir ${fmtAR(aumento)} es un ${pct.toFixed(0)}% de golpe: demasiado. Hacelo en dos etapas para no asustar clientes.`
      : `Podés aumentar ${fmtAR(aumento)} y seguir siendo competitivo. Aunque pierdas hasta ${perdibles} clientes por mes en este servicio, tu facturación se mantiene o crece.`;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/40">
          Elegí el servicio
        </div>
        <LabChips
          options={services.map((s) => ({ key: s.id, label: s.nombre }))}
          value={svc?.id ?? ""}
          onChange={setSvcId}
        />
      </div>
      <div>
        <div className="mb-2 flex items-end justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-white/40">
            Aumento a probar
          </span>
          <span className="text-2xl font-extrabold leading-none text-cyan-200 sm:text-3xl">
            +{fmtAR(aumento)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(5000, Math.round(precioActual))}
          step={100}
          value={aumento}
          onChange={(e) => setAumento(Number(e.target.value))}
          className="w-full accent-cyan-400"
        />
      </div>
      <LabScenario
        currentLabel="Precio actual"
        currentValue={fmtAR(precioActual)}
        projectedLabel="Precio sugerido"
        projectedValue={fmtAR(precioNuevo)}
      />
      <LabImpact
        facturacion={Math.max(0, diferenciaMensual)}
        utilidad={Math.round(Math.max(0, diferenciaMensual) * 0.9)}
        extra={{
          label: "Vs. tu precio promedio",
          value: `${precioNuevo >= avgPrice ? "+" : ""}${fmtAR(precioNuevo - avgPrice)}`,
        }}
      />
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/55">
        Este servicio se vende ~<span className="font-semibold text-white/80">{mensual}</span> veces
        por mes. Podés perder hasta <span className="font-semibold text-rose-200">{perdibles}</span>{" "}
        clientes/mes sin bajar la facturación.
      </div>
      <LabVerdict nivel={nivel} text={verdict} />
    </div>
  );
}

function LabProfesional({ data, ocupacion }: { data: LabData; ocupacion: number }) {
  const [inversion, setInversion] = React.useState(200000);
  if (data.loading) return <LabSkeleton />;

  const serviciosExtra = Math.round(data.monthlyVisits * 0.6); // un profesional nuevo llega a ~60% del promedio
  const facturacionAdic = serviciosExtra * data.avgTicket;
  const utilidadAdic = Math.round(facturacionAdic * (LAB_MARGIN - 0.05)); // descontá su comisión
  const dias = utilidadAdic > 0 ? Math.max(1, Math.round(inversion / (utilidadAdic / 30))) : 0;

  const nivel: keyof typeof nivelMeta =
    ocupacion >= 75 ? "recomendado" : ocupacion >= 60 ? "evaluar" : "no_recomendado";
  const verdict =
    ocupacion >= 75
      ? `Tu ocupación está alta (${ocupacion}%): ya estás rechazando demanda. Incorporar un profesional podría generar hasta ${fmtAR(facturacionAdic)} adicionales por mes y recuperar la inversión en ~${dias} días.`
      : ocupacion >= 60
        ? `Ocupación media (${ocupacion}%). Conviene primero llenar la agenda actual; si seguís creciendo, sumá un profesional en 1-2 meses.`
        : `Con ${ocupacion}% de ocupación todavía tenés sillones libres. Sumar gente ahora divide tu demanda. Primero llená la agenda actual.`;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/60">
        Ocupación actual: <span className="font-bold text-white">{ocupacion}%</span> ·
        Servicios/mes: <span className="font-bold text-white">{data.monthlyVisits}</span>
      </div>
      <LabScenario
        currentLabel="Servicios / mes hoy"
        currentValue={String(data.monthlyVisits)}
        projectedLabel="Con +1 profesional"
        projectedValue={`+${serviciosExtra}`}
      />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-white/40">
            Inversión inicial (sillón, herramientas, alta)
          </span>
          <span className="text-sm font-bold text-cyan-200">{fmtAR(inversion)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={800000}
          step={20000}
          value={inversion}
          onChange={(e) => setInversion(Number(e.target.value))}
          className="w-full accent-cyan-400"
        />
      </div>
      <LabImpact
        facturacion={facturacionAdic}
        utilidad={utilidadAdic}
        extra={{ label: "Recuperás la inversión en", value: `${dias} días` }}
      />
      <LabVerdict nivel={nivel} text={verdict} />
      <p className="text-center text-[11px] text-white/35">
        Para el análisis completo de demanda no atendida y la recomendación de Clippr IA, mirá la
        sección <span className="text-white/55">Demanda no atendida</span> en Análisis.
      </p>
    </div>
  );
}

function LabHorario({ data }: { data: LabData }) {
  const [scenario, setScenario] = React.useState("1h");
  if (data.loading) return <LabSkeleton />;
  const extraHours: Record<string, { h: number; label: string }> = {
    "1h": { h: 1, label: "Abrir 1 hora más" },
    "2h": { h: 2, label: "Abrir 2 horas más" },
    antes: { h: 1, label: "Abrir antes" },
    tarde: { h: 1, label: "Cerrar más tarde" },
  };
  const sel = extraHours[scenario];
  const turnosAdic = Math.round(sel.h * data.openDaysPerWeek * 4.3 * LAB_TURNOS_POR_HORA);
  const facturacion = turnosAdic * data.avgTicket;
  const utilidad = Math.round(facturacion * LAB_MARGIN);
  const nivel: keyof typeof nivelMeta = "evaluar";

  return (
    <div className="space-y-4">
      <LabChips
        options={[
          { key: "1h", label: "🕐 +1 hora" },
          { key: "2h", label: "🕑 +2 horas" },
          { key: "antes", label: "🌅 Abrir antes" },
          { key: "tarde", label: "🌙 Cerrar más tarde" },
        ]}
        value={scenario}
        onChange={setScenario}
      />
      <LabScenario
        currentLabel="Turnos / mes hoy"
        currentValue={String(Math.round(data.monthlyVisits))}
        projectedLabel="Turnos adicionales"
        projectedValue={`+${turnosAdic}`}
      />
      <LabImpact facturacion={facturacion} utilidad={utilidad} />
      <LabVerdict
        nivel={nivel}
        text={`${sel.label} suma unos ${turnosAdic} turnos por mes (${fmtAR(facturacion)} de facturación). Probalo 3 semanas: si la franja nueva se llena más del 50%, dejala fija.`}
      />
    </div>
  );
}

function LabDomingos({ data }: { data: LabData }) {
  if (data.loading) return <LabSkeleton />;
  // Un domingo rinde como un día típico (turnos promedio por día).
  const turnosAdic = data.avgTurnosPerDay * 4; // 4 domingos al mes
  const ingreso = turnosAdic * data.avgTicket;
  const utilidad = Math.round(ingreso * LAB_MARGIN);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/60">
        En tu barbería un día típico rinde{" "}
        <span className="font-bold text-white">{data.avgTurnosPerDay}</span> turnos. Los domingos
        suelen tener alta demanda en este rubro.
      </div>
      <LabScenario
        currentLabel="Domingos hoy"
        currentValue="Cerrado"
        projectedLabel="Turnos / mes"
        projectedValue={`+${turnosAdic}`}
      />
      <LabImpact facturacion={ingreso} utilidad={utilidad} />
      <LabVerdict
        nivel="recomendado"
        text={`Abrir los domingos podría sumar ~${turnosAdic} turnos y ${fmtAR(ingreso)} por mes. Empezá con medio día (mañana) y un solo profesional; si se llena, ampliás.`}
      />
    </div>
  );
}

function LabRecuperar({ data }: { data: LabData }) {
  const [pct, setPct] = React.useState(20);
  if (data.loading) return <LabSkeleton />;
  if (data.inactivos === 0) {
    return (
      <LabEmpty text="¡Buenas noticias! No detectamos clientes perdidos hace más de 45 días para recuperar." />
    );
  }
  const recuperables = Math.round((data.inactivos * pct) / 100);
  const ticketProm =
    data.inactivos > 0 ? Math.round(data.inactivosValue / data.inactivos) : data.avgTicket;
  const facturacion = recuperables * ticketProm;
  const utilidad = Math.round(facturacion * LAB_MARGIN);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/60">
        Tenés <span className="font-bold text-white">{data.inactivos}</span> clientes que no vienen
        hace más de 45 días. Valen{" "}
        <span className="font-bold text-emerald-200">{fmtAR(data.inactivosValue)}</span> si
        volvieran todos.
      </div>
      <LabChips
        options={[
          { key: "10", label: "Recuperar 10%" },
          { key: "20", label: "Recuperar 20%" },
          { key: "30", label: "Recuperar 30%" },
        ]}
        value={String(pct)}
        onChange={(k) => setPct(Number(k))}
      />
      <LabScenario
        currentLabel="Clientes perdidos"
        currentValue={String(data.inactivos)}
        projectedLabel="Recuperás"
        projectedValue={`${recuperables}`}
      />
      <LabImpact facturacion={facturacion} utilidad={utilidad} />
      <LabVerdict
        nivel={pct <= 20 ? "recomendado" : "progresivo"}
        text={`Recuperar el ${pct}% (${recuperables} clientes) suma ${fmtAR(facturacion)} por mes. Es realista con una campaña de WhatsApp con beneficio por tiempo limitado. Empezá por los que más gastaban.`}
      />
    </div>
  );
}

function LabProductos({ data }: { data: LabData }) {
  const [actual, setActual] = React.useState(6);
  const [target, setTarget] = React.useState("10");
  if (data.loading) return <LabSkeleton />;
  const targetPct = Number(target);
  const productPrice = Math.round(data.avgTicket * 0.45);
  const extraClients = Math.max(0, Math.round((data.monthlyClients * (targetPct - actual)) / 100));
  const facturacion = extraClients * productPrice;
  const utilidad = Math.round(facturacion * LAB_PRODUCT_MARGIN);

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-white/40">
            % de clientes que compran productos hoy
          </span>
          <span className="text-sm font-bold text-cyan-200">{actual}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={30}
          step={1}
          value={actual}
          onChange={(e) => setActual(Number(e.target.value))}
          className="w-full accent-cyan-400"
        />
      </div>
      <div>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/40">
          Meta a alcanzar
        </div>
        <LabChips
          options={[
            { key: "5", label: "Llegar a 5%" },
            { key: "10", label: "Llegar a 10%" },
            { key: "15", label: "Llegar a 15%" },
          ]}
          value={target}
          onChange={setTarget}
        />
      </div>
      <LabScenario
        currentLabel="Compran producto hoy"
        currentValue={`${actual}%`}
        projectedLabel="Meta"
        projectedValue={`${targetPct}%`}
      />
      <LabImpact facturacion={facturacion} utilidad={utilidad} />
      <LabVerdict
        nivel={targetPct - actual <= 5 ? "recomendado" : "progresivo"}
        text={`Pasar del ${actual}% al ${targetPct}% son ${extraClients} ventas extra de producto por mes (${fmtAR(facturacion)}). Se logra ofreciendo el producto en el sillón al terminar el corte: "esto es lo que te puse, ¿te lo llevás?".`}
      />
    </div>
  );
}

function LabFidelizacion({ data }: { data: LabData }) {
  const [freqActual, setFreqActual] = React.useState(35);
  const [freqSim, setFreqSim] = React.useState(30);
  if (data.loading) return <LabSkeleton />;
  const visitasActualMes = (data.monthlyClients * 30) / freqActual;
  const visitasSimMes = (data.monthlyClients * 30) / freqSim;
  const visitasAdic = Math.max(0, Math.round(visitasSimMes - visitasActualMes));
  const facturacion = visitasAdic * data.avgTicket;
  const utilidad = Math.round(facturacion * LAB_MARGIN);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/40">
              Frecuencia actual
            </span>
            <span className="text-sm font-bold text-white/70">{freqActual} días</span>
          </div>
          <input
            type="range"
            min={20}
            max={60}
            step={1}
            value={freqActual}
            onChange={(e) => setFreqActual(Number(e.target.value))}
            className="w-full accent-white/40"
          />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-200/70">
              Frecuencia objetivo
            </span>
            <span className="text-sm font-bold text-emerald-200">{freqSim} días</span>
          </div>
          <input
            type="range"
            min={15}
            max={freqActual}
            step={1}
            value={Math.min(freqSim, freqActual)}
            onChange={(e) => setFreqSim(Number(e.target.value))}
            className="w-full accent-emerald-400"
          />
        </div>
      </div>
      <LabScenario
        currentLabel="Vuelven cada"
        currentValue={`${freqActual} días`}
        projectedLabel="Si vuelven cada"
        projectedValue={`${Math.min(freqSim, freqActual)} días`}
      />
      <LabImpact
        facturacion={facturacion}
        utilidad={utilidad}
        extra={{ label: "Visitas extra / mes", value: `+${visitasAdic}` }}
      />
      <LabVerdict
        nivel="recomendado"
        text={`Si tus clientes vuelven cada ${Math.min(freqSim, freqActual)} días en vez de ${freqActual}, sumás ~${visitasAdic} visitas por mes (${fmtAR(facturacion)}). Se logra con recordatorio de WhatsApp y un programa de puntos: el corte 5 con descuento.`}
      />
    </div>
  );
}

function LabSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[0.04]" />
      ))}
    </div>
  );
}

function LabEmpty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/60">
      {text}
    </div>
  );
}

const LAB_SIMS = [
  {
    key: "precios",
    icon: DollarSign,
    label: "Subir precios",
    sub: "Probá un aumento sin perder clientes",
  },
  {
    key: "profesional",
    icon: Scissors,
    label: "Sumar un profesional",
    sub: "¿Conviene contratar?",
  },
  { key: "horario", icon: Clock, label: "Extender horario", sub: "Abrir antes o cerrar más tarde" },
  { key: "domingos", icon: CalendarDays, label: "Abrir domingos", sub: "El día de mayor demanda" },
  {
    key: "recuperar",
    icon: Users,
    label: "Recuperar clientes",
    sub: "Traer de vuelta a los perdidos",
  },
  {
    key: "productos",
    icon: Package,
    label: "Venta de productos",
    sub: "Ticket extra sin más turnos",
  },
  { key: "fidelizacion", icon: Gift, label: "Fidelización", sub: "Que vuelvan más seguido" },
] as const;

function LaboratorioDecisiones(props: SimuladorProps) {
  const data = useLabData(props.businessId, props.ticket, props.clientes);
  const [sim, setSim] = React.useState<(typeof LAB_SIMS)[number]["key"]>("precios");

  // Ocultar "Abrir domingos" si la barbería ya abre domingos.
  const sims = LAB_SIMS.filter((s) => !(s.key === "domingos" && data.sundayOpen));
  const current = sims.find((s) => s.key === sim) ?? sims[0];

  return (
    <div className="space-y-5">
      {/* Encabezado del laboratorio · franja compacta */}
      <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-[#070b18]/80 px-4 py-3.5 shadow-[0_20px_70px_-50px_rgba(56,189,248,0.7)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute -top-16 left-1/4 h-40 w-40 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-xl ring-1 ring-white/15">
            🧪
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold tracking-[-0.02em] text-white sm:text-xl">
              Simulá una decisión de negocio
            </h2>
            <p className="truncate text-xs text-white/55">
              Clippr IA calcula el impacto antes de que tomes la decisión.
            </p>
          </div>
          <button
            type="button"
            title={`Los simuladores usan tus datos reales (servicios, clientes, agenda y horarios). Las proyecciones son estimaciones con supuestos conservadores: utilidad ~${Math.round(LAB_MARGIN * 100)}% sobre facturación y ~${Math.round(LAB_PRODUCT_MARGIN * 100)}% en productos.`}
            aria-label="Cómo se calculan los simuladores"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/5 text-[11px] font-bold text-white/50 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white/80"
          >
            i
          </button>
        </div>
      </div>

      {/* Selector de simuladores */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sims.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSim(s.key)}
            className={cn(
              "group flex items-center gap-3 rounded-2xl border p-3 text-left transition-all",
              sim === s.key
                ? "border-cyan-300/40 bg-cyan-400/[0.1] opacity-100 shadow-[0_0_30px_-10px_rgba(34,211,238,0.6)]"
                : "border-white/10 bg-white/[0.03] opacity-55 hover:border-white/20 hover:bg-white/[0.05] hover:opacity-100",
            )}
          >
            <span
              className={cn(
                "grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 text-white",
                sim === s.key ? "bg-white/15 ring-white/20" : "bg-white/[0.06] ring-white/10",
              )}
            >
              {React.createElement(s.icon, { className: "h-5 w-5" })}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-white">{s.label}</span>
              <span className="block truncate text-xs text-white/45">{s.sub}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Simulador activo */}
      <div className="relative overflow-hidden rounded-[28px] border border-white/12 bg-[#080b16]/80 p-5 shadow-[0_24px_80px_-50px_rgba(56,189,248,0.6)] backdrop-blur-2xl sm:p-6">
        <div className="pointer-events-none absolute -top-24 right-0 h-56 w-56 rounded-full bg-gradient-to-br from-cyan-500/15 to-transparent blur-3xl" />
        <div className="relative">
          <div className="mb-4 flex items-center gap-3 border-b border-white/8 pb-4">
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-white/8 ring-1 ring-white/10 text-white">
              {React.createElement(current.icon, { className: "h-5 w-5" })}
            </span>
            <div>
              <h3 className="text-lg font-bold text-white">{current.label}</h3>
              <p className="text-xs text-white/45">{current.sub}</p>
            </div>
          </div>
          {sim === "precios" && <LabPrecios data={data} />}
          {sim === "profesional" && <LabProfesional data={data} ocupacion={props.ocupacion} />}
          {sim === "horario" && <LabHorario data={data} />}
          {sim === "domingos" && <LabDomingos data={data} />}
          {sim === "recuperar" && <LabRecuperar data={data} />}
          {sim === "productos" && <LabProductos data={data} />}
          {sim === "fidelizacion" && <LabFidelizacion data={data} />}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Demanda no atendida (clientes rechazados) — inline en advisor para evitar
// dependencias de archivos externos. Toda la inteligencia vive acá.
// ════════════════════════════════════════════════════════════════════════════
function fmtDemandARS(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}
function pluralDemandDay(d: string): string {
  return d.endsWith("s") ? d : `${d}s`;
}

function DemandMiniRow({
  icon,
  title,
  items,
  empty,
}: {
  icon: React.ReactNode;
  title: string;
  items: { label: string; value: string | number }[];
  empty: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/45">
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-white/35">{empty}</div>
      ) : (
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-white/75">{it.label}</span>
              <span className="shrink-0 font-bold tabular-nums text-white/90">{it.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const DEMAND_REC_NIVEL: Record<string, { cls: string; titleCls: string; emoji: string }> = {
  recomendado: {
    cls: "border-emerald-400/30 bg-emerald-400/[0.12]",
    titleCls: "text-emerald-300",
    emoji: "✅",
  },
  evaluar: { cls: "border-cyan-400/30 bg-cyan-400/[0.07]", titleCls: "text-cyan-300", emoji: "🟡" },
  no_recomendado: {
    cls: "border-white/12 bg-white/[0.03]",
    titleCls: "text-white/70",
    emoji: "⏸️",
  },
};

function DemandaNoAtendidaSection({
  businessId,
  occupancyPct,
}: {
  businessId: string | null;
  occupancyPct?: number | null;
}) {
  const { analytics: a, isLoading } = useRejectedAnalytics(businessId);

  const month = a.counts.month;
  const maxMonthly = Math.max(1, ...a.monthly.map((m) => m.count));
  const occForRecs = occupancyPct ?? a.avgOccupancyMonth ?? null;
  const recs = React.useMemo(
    () => buildDemandRecommendations(a, { occupancyPct: occForRecs, workingProfessionals: null }),
    [a, occForRecs],
  );

  const topProf = a.topProfessionals[0];
  const topDay = a.peakDays[0];
  const topDayShare = month > 0 && topDay ? Math.round((topDay.count / month) * 100) : 0;
  const windowShare = (() => {
    if (!a.peakRangeLabel) return null;
    const m = a.peakRangeLabel.match(/(\d{2}):00 y (\d{2}):00/);
    if (!m) return null;
    const start = Number(m[1]);
    const end = Number(m[2]);
    const sum = a.peakHours
      .filter((h) => h.hour >= start && h.hour < end)
      .reduce((s, h) => s + h.count, 0);
    return month > 0 ? Math.round((sum / month) * 100) : null;
  })();

  const narrative: string[] = [];
  if (month > 0)
    narrative.push(`Durante este mes rechazaste ${month} clientes por falta de disponibilidad.`);
  if (topProf)
    narrative.push(
      `${topProf.label} recibió ${topProf.count} solicitudes que no pudieron concretarse.`,
    );
  if (windowShare != null && a.peakRangeLabel)
    narrative.push(
      `El ${windowShare}% de los rechazos ocurrió entre las ${a.peakRangeLabel.replace(" y ", " y las ")}.`,
    );
  if (topDay && topDayShare > 0)
    narrative.push(
      `Los ${pluralDemandDay(topDay.label.toLowerCase())} concentran el ${topDayShare}% de la demanda no atendida.`,
    );

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-rose-500/12 text-rose-200 ring-1 ring-rose-400/25">
          <UserX className="h-4 w-4" />
        </span>
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl">
            Demanda no atendida
          </h2>
          <p className="text-xs text-white/45">
            Clientes que no pudieron atenderse por falta de disponibilidad
          </p>
        </div>
      </div>

      {a.total === 0 && !isLoading ? (
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6 text-center text-sm text-white/50">
          Todavía no hay clientes rechazados registrados. Usá{" "}
          <span className="font-semibold text-rose-200/80">+ Cliente rechazado</span> en la Agenda
          para empezar a medir la demanda que el negocio no pudo atender. A medida que se acumulen
          datos, las recomendaciones se vuelven más precisas.
        </div>
      ) : (
        <>
          {narrative.length > 0 && (
            <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/45">
                <Sparkles className="h-3.5 w-3.5" /> Lo que detectó Clippr IA
              </div>
              <ul className="space-y-1.5">
                {narrative.map((t, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-relaxed text-white/75">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rose-300/70" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-rose-300/15 bg-rose-500/[0.05] p-4">
              <div className="text-3xl font-extrabold tabular-nums text-rose-300">
                {a.counts.today}
              </div>
              <div className="mt-0.5 text-[11px] text-white/45">Rechazados hoy</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-3xl font-extrabold tabular-nums text-white">{a.counts.week}</div>
              <div className="mt-0.5 text-[11px] text-white/45">Esta semana</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-3xl font-extrabold tabular-nums text-white">
                {a.counts.month}
              </div>
              <div className="mt-0.5 text-[11px] text-white/45">Este mes</div>
            </div>
            <div className="rounded-2xl border border-amber-300/15 bg-amber-500/[0.05] p-4">
              <div className="flex items-center gap-1.5 text-2xl font-extrabold tabular-nums text-amber-300">
                <TrendingDown className="h-4 w-4" />
                {fmtDemandARS(a.lostRevenue.month)}
              </div>
              <div className="mt-0.5 text-[11px] text-white/45">
                Facturación potencial perdida (mes)
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DemandMiniRow
              icon={<Clock className="h-3.5 w-3.5" />}
              title="Horarios con más demanda"
              items={a.peakHours.slice(0, 4).map((h) => ({
                label: `${String(h.hour).padStart(2, "0")}:00 – ${String(h.hour + 1).padStart(2, "0")}:00`,
                value: h.count,
              }))}
              empty="Sin datos suficientes."
            />
            <DemandMiniRow
              icon={<CalendarDays className="h-3.5 w-3.5" />}
              title="Días con mayor demanda"
              items={a.peakDays.map((d) => ({ label: d.label, value: d.count }))}
              empty="Sin datos suficientes."
            />
            <DemandMiniRow
              icon={<Scissors className="h-3.5 w-3.5" />}
              title="Servicios más solicitados"
              items={a.topServices.map((s) => ({ label: s.label, value: s.count }))}
              empty="Sin datos suficientes."
            />
            <DemandMiniRow
              icon={<Users className="h-3.5 w-3.5" />}
              title="Profesionales más solicitados"
              items={a.topProfessionals.map((p) => ({ label: p.label, value: p.count }))}
              empty="Sin solicitudes por profesional."
            />
            <DemandMiniRow
              icon={<UserX className="h-3.5 w-3.5" />}
              title="Motivos más frecuentes"
              items={a.topReasons.map((r) => ({ label: r.label, value: r.count }))}
              empty="Sin datos suficientes."
            />
            <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <div className="mb-2.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/45">
                <TrendingDown className="h-3.5 w-3.5" /> Evolución mensual
              </div>
              <div className="flex h-[64px] items-end justify-between gap-1.5">
                {a.monthly.map((m) => (
                  <div key={m.ym} className="flex flex-1 flex-col items-center justify-end gap-1">
                    <div
                      className="w-full rounded-t bg-rose-400/60"
                      style={{ height: `${Math.max(3, (m.count / maxMonthly) * 52)}px` }}
                      title={`${m.count} rechazos`}
                    />
                    <span className="text-[10px] capitalize text-white/40">{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {a.professionals.length > 0 && (
            <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-white/45">
                Índice de demanda por profesional
              </div>
              <div className="space-y-2">
                {a.professionals.map((p) => (
                  <div key={p.name} className="flex items-center gap-3">
                    <span className="text-base">{TIER_EMOJI[p.tier]}</span>
                    <span className="w-28 shrink-0 truncate text-sm font-semibold text-white/85">
                      {p.name}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          p.tier === "fire" && "bg-rose-400",
                          p.tier === "high" && "bg-emerald-400",
                          p.tier === "mid" && "bg-amber-400",
                          p.tier === "low" && "bg-sky-400",
                        )}
                        style={{ width: `${p.score}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-xs font-bold tabular-nums text-white/70">
                      {p.score}/100
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recs.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/45">
                Recomendaciones de Clippr IA
              </div>
              {recs.map((r, i) => {
                const meta = DEMAND_REC_NIVEL[r.nivel] ?? DEMAND_REC_NIVEL.evaluar;
                const prio =
                  r.priority === "alta"
                    ? { label: "Prioridad alta", cls: "bg-rose-500/15 text-rose-200" }
                    : r.priority === "media"
                      ? { label: "Prioridad media", cls: "bg-amber-400/15 text-amber-100" }
                      : { label: "Prioridad baja", cls: "bg-emerald-400/15 text-emerald-100" };
                return (
                  <div key={i} className={cn("rounded-2xl border p-4", meta.cls)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("text-sm font-bold", meta.titleCls)}>
                        {meta.emoji} {r.title}
                      </span>
                      <span className="ml-auto flex items-center gap-1.5">
                        <span
                          className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", prio.cls)}
                        >
                          {prio.label}
                        </span>
                        {r.confidence === "preliminar" && (
                          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold text-white/50">
                            Evidencia preliminar
                          </span>
                        )}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-white/80">{r.reasoning}</p>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
