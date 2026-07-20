import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import { useAuth } from "@/hooks/use-auth";
import { AccessDenied, usePermGuard } from "@/hooks/use-perm-guard";
import { fmtAR, pctDelta } from "@/components/dashboard/use-dashboard-data";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useClientsData, type Client } from "@/hooks/use-clients-data";
import { useAdvisorAnalytics } from "@/hooks/use-advisor-analytics";
import { useAiRecommendations, type RecommendationAchievement, type UseAiRecommendationsResult } from "@/hooks/use-ai-recommendations";
import { useRejectedAnalytics } from "@/hooks/use-rejected-analytics";
import { TIER_EMOJI, buildDemandRecommendations } from "@/lib/rejected-analytics";
import { MEASURABLE_CHANNELS } from "@/lib/acquisition-channels";
import { AcquisitionChannelIcon } from "@/components/acquisition-channel-icon";
import { DateRangePicker, type DateRange } from "@/components/date-range-picker";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import type {
  Recommendation,
  RecommendationContact,
  RecommendationTone,
  RecommendationPriority,
} from "@/lib/ai-recommendation-engine";
import {
  Brain,
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Sparkles,
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
  Megaphone,
  CircleHelp,
  BriefcaseBusiness,
  Sunrise,
  Sunset,
  X,
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
  simuladores: {
    title: "Cómo funcionan los simuladores",
    description:
      "Cada simulador proyecta qué pasaría con tu negocio si tomás una decisión concreta (subir precios, contratar, invertir en publicidad, etc.), antes de que la tomes.",
    points: [
      "Qué analiza: el impacto esperado de la decisión en facturación, utilidad y ocupación, comparado contra seguir como estás hoy.",
      "Qué datos usa: tus servicios, clientes, agenda, horarios y la demanda no atendida (turnos rechazados o sin disponibilidad).",
      "Cómo calcula: proyecciones con supuestos conservadores — utilidad ~45% sobre facturación y ~55% en productos.",
      "Qué beneficio aporta: te deja comparar escenarios reales de tu propio negocio antes de invertir tiempo o plata en una decisión.",
    ],
  },
} satisfies Record<string, InfoModalContent>;

// Íconos por clave de indicador de la Radiografía del local (los valores
// reales vienen de useAdvisorAnalytics).
const RADIOGRAFIA_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  recuperar: Users,
  "turnos-vacios": CalendarDays,
  "prof-top": TrendingUp,
  "prof-bottom": TrendingDown,
  "servicio-top": Scissors,
  "servicio-rentable": Gem,
  productos: Package,
  vip: Crown,
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
        <ClipprLoader size="screen" delayMs={130} />
      </div>
    );
  }

  return (
    <AppShell>
      <div className="app-premium-shell">
        <div className="pointer-events-none absolute left-1/2 top-[-120px] z-[-1] h-[620px] w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_17%_4%,rgb(139_92_246_/_0.34),transparent_38%),radial-gradient(circle_at_76%_0%,rgb(79_125_255_/_0.30),transparent_36%),radial-gradient(circle_at_46%_96%,rgb(255_123_229_/_0.14),transparent_50%)] blur-[16px]" />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Topbar title="Asesor IA" subtitle="Análisis diario y crecimiento del negocio" />
          {analysisStarted && !isAnalyzing && (
            <div className="relative flex w-full items-center justify-end sm:w-auto">
              <div className="pointer-events-none absolute -inset-3 rounded-[30px] bg-gradient-to-r from-cyan-500/15 via-violet-500/12 to-emerald-500/12 blur-2xl" />
              {/* Mobile: grid de 3 columnas iguales — así "Simuladores" (el
                  label más largo) ya no fuerza un botón más ancho que
                  "Análisis"/"Gerente IA" y desalinea el grupo. Desktop
                  (sm+) vuelve a la fila flex de ancho automático de
                  siempre. */}
              <div className="relative grid grid-cols-3 max-w-full items-center gap-2 rounded-[24px] border border-white/12 bg-[#070b18]/75 p-2 shadow-[0_18px_65px_rgba(14,165,233,0.16),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl sm:flex sm:overflow-x-auto">
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
                        "group relative w-full min-h-[48px] overflow-hidden rounded-[18px] px-4 py-3 text-sm font-bold tracking-[-0.01em] transition-all duration-300 ring-1 ring-white/10 sm:w-auto sm:px-5",
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
                      <span className="relative z-10 flex items-center justify-center gap-2 whitespace-nowrap">
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

  const analytics = useAdvisorAnalytics(businessId);
  const aiRecs = useAiRecommendations(businessId);

  const healthTone = analytics.health != null ? getHealthTone(analytics.health) : getHealthTone(0);
  const healthHeadline =
    analytics.health == null
      ? "Sin datos suficientes"
      : analytics.health >= 80
        ? "Excelente"
        : analytics.health >= 65
          ? "Muy bien"
          : analytics.health >= 50
            ? "Aceptable"
            : "Necesita atención";
  const animatedHealth = Math.round((analytics.health ?? 0) * animationProgress);
  const animatedProfit = Math.round((analytics.current?.profit ?? 0) * animationProgress);

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
    <div className="space-y-5 sm:space-y-7 max-w-5xl mx-auto w-full">
      {advisorTab === "simuladores" && (
        <SimuladoresTab
          servicios={analytics.current?.doneCount ?? 0}
          facturacion={analytics.current?.revenue ?? 0}
          ticket={analytics.current?.ticket ?? 0}
          clientes={analytics.current?.clientsServed ?? 0}
          ocupacion={analytics.current?.occupancy ?? 0}
          businessId={businessId}
        />
      )}

      {advisorTab === "acciones" && <GrowthManagerTab data={aiRecs} />}

      {advisorTab === "analisis" && (
        <>
          {/* ── SALUD DEL NEGOCIO ─────────────────────────────────── */}
          <div className="relative overflow-visible rounded-[2rem] border border-emerald-300/[0.30] bg-white/[0.018] p-3 pt-14 shadow-[0_0_0_1px_rgba(16,185,129,0.16),0_30px_125px_-42px_rgba(45,212,191,1)] sm:p-4 sm:pt-16">
            <div className="pointer-events-none absolute -inset-x-6 -top-8 h-24 rounded-full bg-emerald-400/[0.16] blur-3xl" />
            {/* "Cómo funciona" una sola vez por sección, en la esquina
                superior derecha del bloque completo — antes vivía adentro
                de la tarjeta "Estado actual" (absolute) y podía superponerse
                al contenido en pantallas angostas. Acá nunca compite con el
                dato principal porque no hay nada más en esta esquina.
                pt-14/16 en el contenedor le reserva su propia fila arriba
                (antes el botón flotaba con position:absolute sobre el
                borde redondeado de 2rem con apenas 12px de margen — con un
                radio tan grande, ese margen quedaba dentro de la curva y
                el botón se veía "colgando" fuera del borde visible de la
                tarjeta, como recortado). overflow-visible explícito: nunca
                debe quedar tapado por el propio contenedor. */}
            <button
              type="button"
              onClick={() => setInfoModal(INFO_CONTENT.health)}
              className="absolute right-4 top-4 z-20 inline-flex h-6 shrink-0 items-center justify-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 text-[11px] font-bold text-emerald-200 shadow-[0_0_22px_rgba(45,212,191,0.14)] transition hover:border-emerald-200/55 hover:bg-emerald-300/16 hover:text-white sm:right-5 sm:top-5 sm:h-7 sm:px-2.5"
              aria-label="Cómo funciona estado actual"
            >
              <CircleHelp className="h-3 w-3" />
              <span className="hidden sm:inline">Cómo funciona</span>
            </button>
            {/* Separador de sección */}
            <div className="relative flex items-center gap-4 mb-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <span className="rounded-full border border-white/10 bg-white/[0.045] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60">
                Salud del negocio
              </span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
            </div>
            <GlassCard className="relative overflow-hidden p-3.5 sm:p-6 border border-emerald-300/[0.32] bg-white/[0.052] shadow-[0_0_0_1px_rgba(45,212,191,0.16),0_35px_125px_-40px_rgba(45,212,191,1)]">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <div className="mb-3 sm:mb-4">
                <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                  Estado actual
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Rentabilidad, clientes y ocupación del período.
                </p>
              </div>

              <div className="grid gap-3 sm:gap-5 md:grid-cols-[0.95fr_1.05fr] items-center">
                {/* Left: circular gauge + bar */}
                <div className="flex flex-col items-center gap-3 sm:gap-4">
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
                    <div className="mx-auto mt-2 max-w-[310px] space-y-3 text-center sm:mt-3 sm:space-y-5">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {analytics.health == null
                          ? "Todavía no hay datos suficientes para calcular la salud del negocio."
                          : "Tu local está sólido. El próximo salto está en llenar la agenda y recuperar clientes, no en bajar precios."}
                      </p>

                      {analytics.health != null && (
                        <>
                          <div className="h-px bg-white/10" />
                          <div>
                            <div className="mb-1.5 flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300 sm:mb-2">
                              <Brain className="h-3.5 w-3.5" /> Insight IA
                            </div>
                            <div className="space-y-1.5 text-xs leading-relaxed text-white/72">
                              {analytics.freeSlotsMonth > 0 ? (
                                <>
                                  <p>La principal oportunidad detectada está en la ocupación.</p>
                                  <p>
                                    Tenés{" "}
                                    <span className="font-semibold text-white">
                                      {analytics.freeSlotsMonth} turnos disponibles
                                    </span>{" "}
                                    este mes.
                                  </p>
                                  <p>
                                    Si alcanzás una ocupación del{" "}
                                    <span className="font-semibold text-white">75%</span>, podrías generar
                                    aproximadamente{" "}
                                    <span className="font-semibold text-emerald-300">
                                      {fmtAR(Math.round(analytics.freeSlotsMonth * 0.21 * (analytics.current?.ticket ?? 0)))}
                                    </span>{" "}
                                    adicionales sin incorporar más personal.
                                  </p>
                                </>
                              ) : (
                                <p>La agenda está prácticamente completa este mes. Buen trabajo.</p>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full h-1.5 overflow-hidden rounded-full bg-white/10 sm:h-2.5">
                    <div
                      className={cn(
                        "h-full rounded-full bg-gradient-to-r transition-all duration-700",
                        healthTone.bar,
                      )}
                      style={{ width: `${animatedHealth}%` }}
                    />
                  </div>
                </div>

                {/* Right: impact panel — en mobile pasa a lista compacta
                    (sin la caja/borde propia, solo íconos+texto por fila);
                    desktop conserva la tarjeta completa vía `sm:`. */}
                <div className="rounded-2xl border-0 bg-transparent p-0 h-full shadow-none sm:border sm:border-emerald-300/[0.13] sm:bg-white/[0.035] sm:p-5 sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
                  <div className="mb-2 flex items-center gap-2 text-base font-semibold sm:mb-4">
                    <Activity className="h-4 w-4 text-emerald-300" /> Radar del local
                  </div>
                  <div className="space-y-1 sm:space-y-2">
                    {analytics.radar.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Todavía no hay suficiente historial para generar el radar del local.
                      </p>
                    ) : (
                      analytics.radar.map((item) => {
                        const style = RADAR_STYLES[item.tone];
                        const Icon =
                          item.tone === "ok"
                            ? TrendingUp
                            : item.tone === "bad"
                              ? Package
                              : item.tone === "alert"
                                ? Users
                                : CalendarDays;
                        return (
                          <div
                            key={item.key}
                            className={cn(
                              "flex items-center gap-2 rounded-lg border-0 px-0 py-1 sm:gap-3 sm:rounded-xl sm:border sm:px-3 sm:py-2",
                              style.ring,
                            )}
                          >
                            <span
                              className={cn(
                                "grid h-6 w-6 shrink-0 place-items-center rounded-lg sm:h-7 sm:w-7",
                                style.bg,
                              )}
                            >
                              <Icon className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", style.icon)} />
                            </span>
                            <span className="text-sm text-white/85">{item.label}</span>
                          </div>
                        );
                      })
                    )}
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
          <div className="relative overflow-visible rounded-[1.7rem] border border-sky-300/[0.30] bg-white/[0.018] p-2.5 pt-14 shadow-[0_0_0_1px_rgba(56,189,248,0.16),0_24px_90px_-42px_rgba(14,165,233,0.9)] sm:p-3 sm:pt-16">
            <div className="pointer-events-none absolute -inset-x-6 -top-8 h-24 rounded-full bg-sky-400/[0.16] blur-3xl" />
            {/* Ver mismo comentario en Salud del negocio: "Cómo funciona"
                una sola vez por sección, en la esquina superior derecha del
                bloque completo — antes vivía adentro del bloque de
                "Crecimiento mensual" y podía superponerse al porcentaje.
                pt-14/16 + más margen del borde: mismo fix que Salud del
                negocio (el botón quedaba dentro de la curva del borde
                redondeado grande y se veía cortado/colgando). */}
            <button
              type="button"
              onClick={() => setInfoModal(INFO_CONTENT.growth)}
              className="absolute right-4 top-4 z-20 inline-flex h-6 shrink-0 items-center justify-center gap-1.5 rounded-full border border-sky-300/35 bg-sky-300/10 px-2 text-[11px] font-bold text-sky-200 transition hover:border-sky-200/55 hover:bg-sky-300/16 hover:text-white sm:right-5 sm:top-5 sm:h-7 sm:px-2.5"
              aria-label="Cómo funciona crecimiento"
            >
              <CircleHelp className="h-3 w-3" />
              <span className="hidden sm:inline">Cómo funciona</span>
            </button>
            <div className="flex items-center gap-4 mb-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <span className="rounded-full border border-white/10 bg-white/[0.045] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60">
                Evolución del negocio
              </span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
            </div>
            <GlassCard className="p-3 sm:p-5 space-y-2.5 sm:space-y-3 border border-sky-300/[0.32] bg-white/[0.052] shadow-[0_0_0_1px_rgba(56,189,248,0.16),0_35px_125px_-40px_rgba(14,165,233,1)]">
              <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                Resultados del período
              </h2>

              {/* Bloque superior: crecimiento real de facturación */}
              <div className="relative flex items-center gap-3 rounded-2xl border border-white/[0.12] bg-white/[0.035] px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3">
                {/* Icono izquierda */}
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-400/12 ring-1 ring-sky-300/25 sm:h-10 sm:w-10">
                  <TrendingUp className="h-4 w-4 text-sky-300 sm:h-5 sm:w-5" />
                </div>
                {/* Textos */}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Crecimiento mensual
                  </div>
                  <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                    {(() => {
                      const growth =
                        analytics.current && analytics.previous?.hasData
                          ? pctDelta(analytics.current.revenue, analytics.previous.revenue)
                          : null;
                      return growth == null ? (
                        <span className="font-display text-2xl font-bold text-white/40">
                          Sin datos del mes anterior todavía
                        </span>
                      ) : (
                        <>
                          <span className="font-display text-3xl font-bold text-sky-300 leading-none sm:text-4xl">
                            {growth >= 0 ? "+" : ""}
                            {growth}%
                          </span>
                          <span className="text-sm text-muted-foreground">vs mes anterior</span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Etiqueta IMPULSADOS POR */}
              <div className="flex flex-col items-center gap-0.5 text-center">
                <div className="text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground">
                  Impulsados por
                </div>
                <div className="text-muted-foreground text-base leading-none">↓</div>
              </div>

              {/* 3 tarjetas: Clientes / Ticket / Ocupación */}
              <div className="grid gap-2 sm:gap-2.5 md:grid-cols-3">
                {/* Clientes atendidos */}
                <div className="rounded-2xl border border-white/[0.12] bg-white/[0.035] p-2.5 flex flex-col gap-1.5 sm:p-3 sm:gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-violet-400/10 ring-1 ring-violet-400/20 sm:h-9 sm:w-9">
                    <Users className="h-4 w-4 text-violet-400" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Clientes atendidos</div>
                    <div className="font-display text-2xl font-bold text-violet-300 mt-1 leading-none sm:text-3xl">
                      {Math.round((analytics.current?.clientsServed ?? 0) * animationProgress)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-violet-400/10 px-2.5 py-1 sm:px-3 sm:py-1.5">
                    {(() => {
                      const g =
                        analytics.current && analytics.previous?.hasData
                          ? pctDelta(analytics.current.clientsServed, analytics.previous.clientsServed)
                          : null;
                      return (
                        <>
                          <div className="text-sm font-bold text-violet-300">
                            {g == null ? "—" : `${g >= 0 ? "+" : ""}${g}%`}
                          </div>
                          <div className="text-xs text-muted-foreground">vs mes anterior</div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Ticket promedio */}
                <div className="rounded-2xl border border-white/[0.12] bg-white/[0.035] p-2.5 flex flex-col gap-1.5 sm:p-3 sm:gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-sky-400/10 ring-1 ring-sky-400/20 sm:h-9 sm:w-9">
                    <DollarSign className="h-4 w-4 text-sky-400" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Ticket promedio</div>
                    <div className="font-display text-xl font-bold text-sky-300 mt-1 leading-none sm:text-2xl">
                      {fmtAR(Math.round((analytics.current?.ticket ?? 0) * animationProgress))}
                    </div>
                  </div>
                  <div className="rounded-xl bg-sky-400/10 px-2.5 py-1 sm:px-3 sm:py-1.5">
                    {(() => {
                      const g =
                        analytics.current && analytics.previous?.hasData
                          ? pctDelta(analytics.current.ticket, analytics.previous.ticket)
                          : null;
                      return (
                        <>
                          <div className="text-sm font-bold text-sky-300">
                            {g == null ? "—" : `${g >= 0 ? "+" : ""}${g}%`}
                          </div>
                          <div className="text-xs text-muted-foreground">vs mes anterior</div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Ocupación */}
                <div className="rounded-2xl border border-white/[0.12] bg-white/[0.035] p-2.5 flex flex-col gap-1.5 sm:p-3 sm:gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-orange-400/10 ring-1 ring-orange-400/20 sm:h-9 sm:w-9">
                    <ClipboardList className="h-4 w-4 text-orange-400" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Ocupación</div>
                    <div className="font-display text-2xl font-bold text-orange-300 mt-1 leading-none sm:text-3xl">
                      {Math.round((analytics.current?.occupancy ?? 0) * animationProgress)}%
                    </div>
                  </div>
                  <div className="rounded-xl bg-orange-400/10 px-2.5 py-1 sm:px-3 sm:py-1.5">
                    {(() => {
                      const g =
                        analytics.current && analytics.previous?.hasData
                          ? pctDelta(analytics.current.occupancy, analytics.previous.occupancy)
                          : null;
                      return (
                        <>
                          <div className="text-sm font-bold text-orange-300">
                            {g == null ? "—" : `${g >= 0 ? "+" : ""}${g}%`}
                          </div>
                          <div className="text-xs text-muted-foreground">vs mes anterior</div>
                        </>
                      );
                    })()}
                  </div>
                  {analytics.freeSlotsMonth > 0 && (
                    <div className="rounded-xl border border-orange-300/15 bg-orange-300/[0.05] px-2.5 py-1 text-[11px] sm:px-3 sm:py-1.5">
                      <div className="text-white/70">{analytics.freeSlotsMonth} turnos vacíos este mes</div>
                      <div className="mt-0.5 text-white/45">
                        Potencial: +
                        {fmtAR(Math.round(analytics.freeSlotsMonth * 0.21 * (analytics.current?.ticket ?? 0)))} por
                        mes si los llenás.
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Etiqueta GENERARON MÁS */}
              <div className="flex flex-col items-center gap-0.5 text-center">
                <div className="text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground">
                  Generaron más
                </div>
                <div className="text-muted-foreground text-base leading-none">↓</div>
              </div>

              {/* Bloque Utilidad */}
              <div className="relative overflow-hidden rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.08] px-3.5 py-2.5 flex items-center justify-between gap-3 sm:px-5 sm:py-3.5 sm:gap-4">
                {/* Left */}
                <div className="z-10">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="grid h-8 w-8 place-items-center rounded-2xl bg-emerald-400/15 ring-1 ring-emerald-400/25 sm:h-9 sm:w-9">
                      <DollarSign className="h-4 w-4 text-emerald-400 sm:h-5 sm:w-5" />
                    </div>
                    <div className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-300">
                      Utilidad
                    </div>
                    {(() => {
                      const g =
                        analytics.current && analytics.previous?.hasData
                          ? pctDelta(analytics.current.profit, analytics.previous.profit)
                          : null;
                      if (g == null) return null;
                      return (
                        <span className="rounded-lg bg-emerald-400/15 px-2.5 py-1 text-xs font-bold text-emerald-300 ring-1 ring-emerald-400/25">
                          {g >= 0 ? "+" : ""}
                          {g}%
                        </span>
                      );
                    })()}
                  </div>
                  <div className="font-display text-2xl sm:text-4xl font-bold text-emerald-300 mt-1.5 sm:mt-2 leading-none">
                    {analytics.current ? fmtAR(animatedProfit) : "—"}
                  </div>
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
            <GlassCard className="p-3.5 sm:p-6 border border-fuchsia-300/[0.2] bg-white/[0.05] shadow-[0_0_0_1px_rgba(217,70,239,0.1),0_35px_120px_-44px_rgba(217,70,239,0.7)]">
              <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                Tu negocio de un vistazo
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Los números que un dueño de barbería o peluquería mira todos los días.
              </p>
              {/* grid-cols-2 desde mobile (antes era 1 sola columna hasta
                  sm:, una tarjeta enorme abajo de otra) — en pantallas
                  grandes sigue yendo a 4 columnas igual que siempre. */}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3 lg:grid-cols-4">
                {analytics.radiografia.map((item) => {
                  const Icon =
                    RADIOGRAFIA_ICONS[item.key as keyof typeof RADIOGRAFIA_ICONS] ?? Activity;
                  return (
                    <div
                      key={item.key}
                      className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.045] sm:p-4"
                    >
                      <div
                        className={cn(
                          "grid h-8 w-8 place-items-center rounded-xl ring-1 sm:h-10 sm:w-10",
                          item.tone === "good"
                            ? "bg-emerald-400/10 ring-emerald-400/20 text-emerald-300"
                            : item.tone === "warn"
                              ? "bg-amber-400/10 ring-amber-400/20 text-amber-300"
                              : item.tone === "bad"
                                ? "bg-rose-400/10 ring-rose-400/20 text-rose-300"
                                : "bg-white/[0.05] ring-white/10 text-white/75",
                        )}
                      >
                        <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                      </div>
                      <div
                        className={cn(
                          "mt-2 text-xl font-bold leading-none sm:mt-3 sm:text-2xl",
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
                      <div className="mt-1 text-xs leading-snug text-muted-foreground sm:mt-1.5">
                        {item.label}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!analytics.hasAnyData && (
                <p className="mt-4 text-sm text-muted-foreground">
                  Todavía no hay datos suficientes para generar este análisis. A medida que se
                  registren turnos y cobros, esta radiografía se va a ir completando sola.
                </p>
              )}
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
            <GlassCard className="relative overflow-hidden p-3.5 sm:p-6 border border-violet-300/[0.16] bg-white/[0.045] shadow-[0_0_0_1px_rgba(139,92,246,0.06),0_30px_100px_-52px_rgba(124,58,237,0.7)]">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <div className="flex flex-wrap items-start justify-between gap-4 mb-3 sm:mb-5">
                <div>
                  <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                    Informes mensuales
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Se calculan solos a partir de tus turnos y cobros reales, sin que tengas que
                    tocar nada.
                  </p>
                </div>
              </div>

              {analytics.history.filter((h) => h.hasData).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Todavía no hay historial suficiente para generar informes mensuales. Van a ir
                  apareciendo acá a medida que registres turnos y cobros.
                </p>
              ) : (
                <div className="grid gap-2.5 sm:gap-3 md:grid-cols-3">
                  {analytics.history
                    .filter((h) => h.hasData)
                    .slice(0, 3)
                    .map((report, index) => {
                      const isPrimary = index === 0;
                      const health = isPrimary ? analytics.health : null;
                      const tone = getHealthTone(health ?? 50);
                      const prev = analytics.history[analytics.history.indexOf(report) + 1];
                      const growthPct = prev?.hasData ? pctDelta(report.revenue, prev.revenue) : null;
                      return (
                        <div
                          key={report.monthKey}
                          className={cn(
                            "relative flex flex-col rounded-2xl border p-3 transition-all sm:p-4",
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
                            <p className="text-sm font-semibold text-white">{report.monthLabel}</p>
                            {health != null && (
                              <span className={cn("text-xs font-bold tabular-nums", tone.text)}>
                                {health}/100
                              </span>
                            )}
                          </div>
                          {/* Estado del mes */}
                          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/55">
                            {isPrimary ? "Mes en curso" : growthPct != null && growthPct >= 0 ? "Creciendo" : "Informe guardado"}
                          </p>
                          {/* Resumen con datos reales */}
                          <p className="mt-3 flex-1 text-xs leading-relaxed text-white/72">
                            Facturación: {fmtAR(report.revenue)}
                            {growthPct != null && (
                              <>
                                {" "}
                                ({growthPct >= 0 ? "+" : ""}
                                {growthPct}% vs mes anterior)
                              </>
                            )}
                            . Utilidad: {fmtAR(report.profit)}.
                          </p>
                        </div>
                      );
                    })}
                </div>
              )}
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
    // Mobile: la portada no debe scrollear — cabe entera en una pantalla.
    // El alto se calcula restando el chrome real de arriba (Topbar, ~90px)
    // y de abajo (nav inferior fijo de AppShell: 4rem + safe-area-inset) al
    // svh; el -164px de antes (128px fijo) se quedaba corto y sobraba
    // contenido. Todos los tamaños/espaciados de acá abajo se achican solo
    // en mobile (clases base) y vuelven a los valores originales en sm+, que
    // no tiene esta restricción y queda intacto.
    <div className="relative -mt-2 flex h-[calc(100svh-164px-env(safe-area-inset-bottom))] min-h-[420px] flex-col items-center justify-center overflow-hidden px-4 py-4 sm:h-[calc(100svh-128px)] sm:min-h-[560px]">
      <div className="pointer-events-none absolute -left-28 top-4 h-72 w-72 rounded-full bg-violet-500/18 blur-3xl" />
      <div className="pointer-events-none absolute -right-28 top-8 h-72 w-72 rounded-full bg-sky-500/14 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-20 h-80 w-80 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative z-10 flex w-full max-w-4xl flex-col items-center">
        <div className="relative mb-3 sm:mb-7">
          <div className="absolute inset-0 scale-[1.75] rounded-full bg-gradient-to-br from-primary/28 via-violet-500/18 to-sky-500/18 blur-3xl" />
          <div className="absolute inset-0 scale-[1.24] rounded-[2rem] border border-white/10 bg-white/[0.018] backdrop-blur-xl" />
          <div className="relative grid h-20 w-20 place-items-center rounded-[2rem] border border-white/12 bg-gradient-to-br from-white/[0.12] via-white/[0.045] to-white/[0.02] shadow-[0_0_90px_-22px_oklch(0.65_0.28_290/0.9)] sm:h-36 sm:w-36">
            <Brain className="h-10 w-10 text-primary drop-shadow-[0_0_24px_oklch(0.65_0.28_290/0.6)] sm:h-20 sm:w-20" />
          </div>
          <div
            className="absolute inset-0 rounded-[2rem] ring-1 ring-primary/20 animate-ping"
            style={{ animationDuration: "3s" }}
          />
        </div>

        <div className="mb-3 inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2 shadow-[0_18px_55px_-32px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:mb-7 sm:gap-3 sm:px-5 sm:py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.75)] sm:h-3 sm:w-3" />
          <span className="text-sm font-semibold text-foreground sm:text-base">Asesor IA listo</span>
        </div>

        <div className="max-w-3xl text-center">
          <h1 className="font-display text-2xl font-bold leading-[1.1] tracking-tight text-white sm:text-6xl sm:leading-[1.08]">
            Descubrí cómo hacer
            <br className="hidden sm:block" /> crecer tu negocio
          </h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:mt-6 sm:text-xl">
            Analizamos tu barbería y te mostramos oportunidades concretas para crecer.
          </p>
        </div>

        <button
          type="button"
          onClick={onStart}
          className="group relative mt-4 inline-flex h-12 w-full max-w-[360px] items-center justify-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-primary via-violet-500 to-accent px-6 text-base font-bold text-white shadow-[0_22px_60px_-18px_oklch(0.65_0.28_290/0.9)] transition duration-300 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_28px_75px_-18px_oklch(0.65_0.28_290/1)] sm:mt-10 sm:h-16 sm:min-w-[380px] sm:gap-4 sm:px-8 sm:text-lg"
        >
          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          <Brain className="relative h-5 w-5 sm:h-6 sm:w-6" />
          <span className="relative">Analizar mi negocio</span>
          <ArrowRight className="relative h-5 w-5 transition-transform duration-300 group-hover:translate-x-1 sm:h-6 sm:w-6" />
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
    // Mobile: igual que StartAnalysis, esta pantalla tampoco debe scrollear.
    // Se achica todo (ícono, márgenes, tarjetas de paso, padding) en mobile
    // vía clases base, y sm: restaura los valores originales sin cambios.
    <div className="relative flex min-h-[50vh] flex-col items-center justify-center overflow-hidden px-4 py-3 sm:min-h-[68vh] sm:py-6">
      <div className="pointer-events-none absolute -left-32 top-10 h-72 w-72 rounded-full bg-violet-500/16 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 top-16 h-72 w-72 rounded-full bg-sky-500/14 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-24 h-80 w-80 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative z-10 w-full max-w-2xl rounded-[2rem] border border-white/10 bg-white/[0.035] p-3.5 shadow-[0_28px_90px_-40px_rgba(0,0,0,0.95)] backdrop-blur-xl sm:p-6">
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-3 sm:mb-5">
          <div className="relative mb-2 sm:mb-4">
            <div className="absolute inset-0 scale-[1.65] rounded-full bg-gradient-to-br from-primary/25 to-accent/20 blur-3xl" />
            <div className="relative grid h-14 w-14 place-items-center rounded-[1.75rem] border border-white/12 bg-gradient-to-br from-white/[0.12] to-white/[0.03] shadow-[0_0_70px_-20px_oklch(0.65_0.28_290/0.8)] sm:h-20 sm:w-20">
              <Brain className="h-7 w-7 text-primary sm:h-10 sm:w-10" />
            </div>
            <svg
              className="absolute inset-0 h-14 w-14 animate-spin sm:h-20 sm:w-20"
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
          <h2 className="font-display text-lg font-bold tracking-tight sm:text-2xl">Analizando tu negocio</h2>
          <p className="mt-1 text-xs text-muted-foreground max-w-md sm:mt-2 sm:text-sm">
            Preparando tu diagnóstico...
          </p>
        </div>

        {/* Progress bar premium */}
        <div className="mb-3 sm:mb-5">
          <div className="flex justify-center text-xs text-muted-foreground mb-1.5 sm:mb-2">
            <span className="font-semibold text-foreground">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden ring-1 ring-white/10 sm:h-2.5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary via-violet-500 to-accent shadow-[0_0_24px_oklch(0.65_0.28_290/0.65)] transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-1.5 sm:space-y-2.5">
          {steps.map((item, index) => {
            const done = index < safeStep;
            const current = index === safeStep;
            const pending = index > safeStep;
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className={cn(
                  "flex items-center gap-2 rounded-2xl border px-3 py-2 transition-all duration-500 sm:gap-3 sm:px-4 sm:py-3",
                  done &&
                    "border-emerald-400/25 bg-emerald-400/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]",
                  current &&
                    "border-primary/35 bg-primary/[0.075] ring-1 ring-primary/20 shadow-[0_0_32px_-20px_oklch(0.65_0.28_290/0.9)]",
                  pending && "border-white/8 bg-white/[0.02] opacity-50",
                )}
              >
                <div className="shrink-0 w-6 h-6 flex items-center justify-center sm:w-7 sm:h-7">
                  {done && <CheckCircle2 className="h-4 w-4 text-emerald-400 sm:h-5 sm:w-5" />}
                  {current && <Loader2 className="h-4 w-4 animate-spin text-primary sm:h-5 sm:w-5" />}
                  {pending && <div className="h-3.5 w-3.5 rounded-full border-2 border-white/15 sm:h-4 sm:w-4" />}
                </div>
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-xl ring-1 sm:h-8 sm:w-8",
                    done && "bg-emerald-400/10 ring-emerald-400/20 text-emerald-300",
                    current && "bg-primary/10 ring-primary/20 text-primary",
                    pending && "bg-white/[0.04] ring-white/10 text-muted-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </span>
                <span
                  className={cn(
                    "text-xs font-medium flex-1 sm:text-sm",
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


function getTodayKey() {
  const date = new Date();
  return date.toISOString().slice(0, 10);
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


function InfoModal({ content, onClose }: { content: InfoModalContent; onClose: () => void }) {
  const readablePoints = content.points.map((point) => {
    const [lead, ...rest] = point.split(":");
    const hasLead = rest.length > 0 && lead.length < 72;
    return {
      lead: hasLead ? lead : null,
      text: hasLead ? rest.join(":").trim() : point,
    };
  });

  // Bloquea el scroll de fondo mientras el modal está montado y restaura
  // exactamente el scrollY al desmontar (se abre/cierra vía render
  // condicional, así que el mount/unmount de este componente coincide
  // siempre con abrir/cerrar el modal).
  useBodyScrollLock(true);

  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [content]);

  // Botón/gesto de "volver" del teléfono: al abrir el modal se agrega una
  // entrada extra al historial; si el usuario vuelve con el botón físico o
  // el gesto del navegador, ese popstate cierra el modal en vez de navegar
  // fuera de Asesor IA. Si se cierra con la X o tocando afuera, se
  // consume esa misma entrada con history.back() para no dejarla colgada
  // (evita que un "volver" posterior, ya con el modal cerrado, quede
  // pisando una entrada vacía).
  const closedByBackRef = React.useRef(false);
  React.useEffect(() => {
    window.history.pushState({ clipprInfoModal: true }, "");
    const handlePopState = () => {
      closedByBackRef.current = true;
      onClose();
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (!closedByBackRef.current) window.history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-md sm:items-center"
      onClick={onClose}
    >
      <div
        // El overlay ya reserva max(1rem, safe-area) arriba y abajo con su
        // propio padding (pt-/pb- de la clase de afuera) — este cálculo
        // espeja exactamente esa misma reserva para no restarla dos veces
        // (lo que dejaría la tarjeta más baja de lo necesario).
        className="relative flex max-h-[calc(100dvh-max(1rem,env(safe-area-inset-top,0px))-max(1rem,env(safe-area-inset-bottom,0px)))] w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border border-white/12 bg-[#080713]/96 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_38px_130px_-58px_rgba(124,58,237,0.95)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-violet-400/16 blur-3xl" />
        <div className="pointer-events-none absolute -left-24 bottom-0 h-56 w-56 rounded-full bg-emerald-400/12 blur-3xl" />
        {/* Solo esta barra chica (título + X) queda fija — el resto,
            incluida la descripción, es parte del mismo scroll interno de
            abajo. Antes el título Y la descripción completa vivían en el
            header fijo, lo que en mobile podía ocupar media pantalla de
            contenido estático. */}
        <div className="relative flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5">
          <h2 className="min-w-0 truncate font-display text-base font-bold tracking-tight text-white">
            {content.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-white/60 transition hover:bg-white/[0.10] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* pb con safe-area propio: el padding-bottom normal (py-5) no
            alcanzaba para que el último bloque (la tarjeta roja) quedara
            totalmente visible al llegar al final del scroll — sobre todo
            con el home indicator de iPhone, que le come espacio real al
            final del scroll interno aunque el overlay de afuera ya tenga
            su propio padding de safe-area. */}
        <div
          ref={scrollRef}
          className="relative min-h-0 flex-1 overflow-y-auto px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pt-5"
        >
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/25 bg-violet-300/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-violet-200">
              <CircleHelp className="h-3.5 w-3.5" />
              Cómo funciona
            </div>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/62">
              {content.description}
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-emerald-300/18 bg-emerald-300/[0.055] p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                  Qué analiza
                </div>
                <p className="mt-2 text-sm leading-relaxed text-white/72">
                  Datos reales del negocio, clientes, agenda, ventas y evolución del período.
                </p>
              </div>
              <div className="rounded-2xl border border-sky-300/18 bg-sky-300/[0.055] p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-300">
                  Cómo lo calcula
                </div>
                <p className="mt-2 text-sm leading-relaxed text-white/72">
                  Compara resultados actuales contra períodos anteriores y detecta cambios relevantes.
                </p>
              </div>
              <div className="rounded-2xl border border-violet-300/18 bg-violet-300/[0.055] p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300">
                  Para qué sirve
                </div>
                <p className="mt-2 text-sm leading-relaxed text-white/72">
                  Ayuda a decidir rápido dónde enfocar acciones para mejorar el negocio.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                <Brain className="h-4 w-4 text-violet-300" />
                Lectura simple
              </div>
              <div className="space-y-2.5">
                {readablePoints.map((point, index) => (
                  <div
                    key={`${point.text}-${index}`}
                    className="flex gap-3 rounded-xl border border-white/[0.07] bg-black/18 p-3 text-sm leading-relaxed text-white/72"
                  >
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/[0.07] text-[11px] font-bold text-white/70">
                      {index + 1}
                    </span>
                    <span>
                      {point.lead ? (
                        <>
                          <span className="font-semibold text-white">{point.lead}:</span>{" "}
                          {point.text}
                        </>
                      ) : (
                        point.text
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.045] px-3 py-2 text-xs leading-relaxed text-emerald-100/80">
                <span className="font-bold text-emerald-300">Verde:</span> va bien o mejora.
              </div>
              <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.045] px-3 py-2 text-xs leading-relaxed text-amber-100/80">
                <span className="font-bold text-amber-300">Naranja:</span> requiere atención.
              </div>
              <div className="rounded-xl border border-rose-300/15 bg-rose-300/[0.045] px-3 py-2 text-xs leading-relaxed text-rose-100/80">
                <span className="font-bold text-rose-300">Rojo:</span> puede estar costando plata.
              </div>
            </div>
        </div>
      </div>
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
  score: number;
  confianza: number;
  factores: { label: string; value: number; estado: "positivo" | "neutral" | "riesgo" }[];
  razones: string[];
  sugerencia: string;
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
    <div className="relative overflow-hidden rounded-[26px] border border-emerald-300/20 bg-emerald-500/[0.055] p-5 ring-1 ring-emerald-300/20 backdrop-blur-2xl sm:p-4">
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
            La movemos automáticamente al historial del Gerente IA apenas se detecta el objetivo logrado.
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
  // "Ver estrategia" apuntaba con scrollIntoView a un id
  // (`strategy-${rec.key}`) que solo existía para las recomendaciones
  // secundarias — la principal (esta, la que muestra ManagerHero) nunca
  // tuvo ese id ni tampoco el detalle expandible (pasos, clientes,
  // mensaje) en ningún lado de la página, así que el botón no hacía
  // nada. Ahora el detalle se expande acá mismo, con el mismo contenido
  // que ya usa GrowthRecCard para las demás recomendaciones.
  const [open, setOpen] = React.useState(false);

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
        </div>

        {/* Botón + detalle desplegable ahora viven pegados a la tarjeta de
            "pérdida estimada" que los origina (antes el botón quedaba en
            la columna de texto, arriba del gráfico y del monto — se veía
            desconectado de lo que en realidad controla). Orden: gráfico →
            pérdida estimada → Ver estrategia → Estrategia recomendada. */}
        <div className="space-y-4">
          <div className="relative min-h-[220px] overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.045] p-5 ring-1 ring-white/8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_22%,rgba(168,85,247,0.22),transparent_42%)]" />
            <div className="relative flex h-full flex-col justify-between gap-6">
              <ManagerTrendSparkline />
              {/* w-full sin tope fijo en mobile (el max-w-[330px] recién
                  entra desde sm, con más aire): antes el monto grande y su
                  etiqueta iban siempre en fila (flex items-end), y en
                  pantallas angostas eso se salía del ancho de la tarjeta —
                  como la sección padre tiene overflow-hidden, no se veía
                  como scroll sino como texto cortado/ilegible. En mobile
                  pasan a columna. */}
              <div className="ml-auto w-full rounded-3xl border border-fuchsia-300/28 bg-fuchsia-500/[0.09] p-5 ring-1 ring-fuchsia-300/20 sm:max-w-[330px]">
                <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-end sm:gap-4">
                  <div className="font-display text-4xl font-black tracking-[-0.06em] text-white sm:text-5xl">
                    {keyMetric}
                  </div>
                  <div className="text-sm font-semibold leading-snug text-white/70 sm:pb-1">
                    {keyLabel}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-3 text-sm font-black text-white shadow-[0_18px_45px_-22px_rgba(168,85,247,0.9)] ring-1 ring-white/15 transition hover:brightness-110"
          >
            {open ? "Ocultar estrategia" : "Ver estrategia"}
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>

          {open ? (
            <div className="relative space-y-3">
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

function GrowthManagerTab({ data }: { data: UseAiRecommendationsResult }) {
  const { ready, loading, recommendations, resolved, achievements, totalOpportunity } = data;

  if (loading && !ready) {
    return (
      <div className="grid place-items-center py-24">
        <ClipprLoader size="screen" delayMs={130} />
      </div>
    );
  }

  const hero = recommendations[0] ?? null;
  const secondary = recommendations.slice(1, 1 + GROWTH_VISIBLE_LIMIT);

  if (!hero) {
    return (
      <div className="mt-6 space-y-8">
        <RecentAchievements resolved={resolved} achievements={achievements} />
        <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-8 text-center">
          <Brain className="mx-auto h-8 w-8 text-white/35" />
          <p className="mt-3 text-base font-semibold text-white/80">
            Todavía no hay suficientes datos para generar recomendaciones.
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-white/50">
            A medida que se registren turnos, cobros y clientes en Clippr, el Gerente IA va a ir
            detectando oportunidades reales acá. Si ya tenés actividad cargada y no ves nada, es
            buena señal: no se detectó ningún problema urgente hoy.
          </p>
        </div>
        <AchievementsHistory achievements={achievements} />
        <ManagerFooter />
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-8">
      <ManagerHero rec={hero} totalOpportunity={totalOpportunity} />

      <RecentAchievements resolved={resolved} achievements={achievements} />

      {secondary.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white">Próximas prioridades</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {secondary.map((rec) => (
              <div key={rec.key} id={`strategy-${rec.key}`}>
                <GrowthRecCard rec={rec} />
              </div>
            ))}
          </div>
        </section>
      )}

      <AchievementsHistory achievements={achievements} />

      <div className="rounded-[24px] border border-violet-300/25 bg-violet-400/[0.055] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-violet-400/10 ring-1 ring-violet-300/25">
              <Brain className="h-8 w-8 text-violet-300" />
            </div>
            <div>
              <div className="font-bold text-violet-200">El Asesor IA aprende de tu negocio</div>
              <div className="mt-1 text-sm text-white/60">
                Las recomendaciones se recalculan solas a medida que cambian tus datos reales.
              </div>
            </div>
          </div>
        </div>
      </div>

      <ManagerFooter />
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

type LabBucket = { count: number; value: number; ticket: number };

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
  // ── señales nuevas (Gerente IA) ──
  openHour: number; // hora real de apertura (de la agenda efectiva)
  closeHour: number; // hora real de cierre
  inact46: LabBucket; // inactivos 46–75 días
  lost76: LabBucket; // perdidos 76+ días
  avgFrequencyDays: number; // frecuencia promedio de visita
  segActivos: number;
  segVip: number;
  segNuevos: number;
  productBuyerPct: number | null; // % real de clientes que compran productos
  productAvgPrice: number; // precio promedio real de productos del catálogo
  sellsProducts: boolean;
  payingClients: number;
  // Datos crudos por cliente para el simulador de Publicidad (agrupa/filtra por
  // su propio rango de fechas, no por el período fijo del resto de LabData).
  clients: {
    acquisitionSource: string | null;
    acquisitionSourceCustom: string | null;
    acquisitionCapturedAt: string | null;
    spent: number;
    visits: number;
  }[];
};

const LAB_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

// Estados que cuentan como turno efectivamente realizado (espejo del motor).
const DONE_STATUSES = ["completed", "charged"];

// Metadata visual por nivel de recomendación de LabPrecios (score → estilo).
const nivelMeta = {
  recomendado: {
    emoji: "✅",
    label: "Recomendado",
    cls: "border-emerald-400/30 bg-emerald-400/[0.14]",
    titleCls: "text-emerald-300",
    dot: "bg-emerald-400",
    icon: CheckCircle2,
  },
  progresivo: {
    emoji: "🟦",
    label: "Aplicar progresivamente",
    cls: "border-cyan-400/30 bg-cyan-400/[0.08]",
    titleCls: "text-cyan-300",
    dot: "bg-cyan-400",
    icon: TrendingUp,
  },
  evaluar: {
    emoji: "🟡",
    label: "Evaluar con cuidado",
    cls: "border-amber-400/30 bg-amber-400/[0.08]",
    titleCls: "text-amber-300",
    dot: "bg-amber-400",
    icon: CircleHelp,
  },
  no_recomendado: {
    emoji: "🔴",
    label: "No recomendado todavía",
    cls: "border-rose-400/30 bg-rose-400/[0.08]",
    titleCls: "text-rose-300",
    dot: "bg-rose-400",
    icon: AlertTriangle,
  },
  alto_riesgo: {
    emoji: "⚠️",
    label: "Alto riesgo",
    cls: "border-orange-400/30 bg-orange-400/[0.08]",
    titleCls: "text-orange-300",
    dot: "bg-orange-400",
    icon: AlertTriangle,
  },
};

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
  const [productAvgPrice, setProductAvgPrice] = React.useState(0);
  const [sellsProducts, setSellsProducts] = React.useState(false);
  const [payBuyerPct, setPayBuyerPct] = React.useState<number | null>(null);
  const [payingClients, setPayingClients] = React.useState(0);
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
      const since90 = new Date();
      since90.setDate(since90.getDate() - 90);
      try {
        const [apptRes, settRes, prodRes, payRes] = await Promise.all([
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
          // Productos reales del catálogo (duration_min IS NULL → producto)
          supabase
            .from("price_catalog")
            .select("name,price")
            .eq("business_id", businessId)
            .eq("active", true)
            .is("duration_min", null),
          // Ventas reales para medir cuántos clientes compran productos
          supabase
            .from("payments")
            .select("client_id,service_name,items,paid_at")
            .eq("business_id", businessId)
            .gte("paid_at", since90.toISOString()),
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

        // ── Productos del catálogo ──
        const prods = (prodRes.error ? [] : (prodRes.data ?? [])) as {
          name: string | null;
          price: number | null;
        }[];
        const productNames = new Set(
          prods.map((p) => (p.name ?? "").trim().toLowerCase()).filter(Boolean),
        );
        if (!cancelled) {
          setSellsProducts(productNames.size > 0);
          setProductAvgPrice(
            prods.length > 0
              ? Math.round(prods.reduce((s, p) => s + Number(p.price ?? 0), 0) / prods.length)
              : 0,
          );
        }

        // ── % real de clientes que compran productos ──
        if (!payRes.error && productNames.size > 0) {
          const pays = (payRes.data ?? []) as {
            client_id: string | null;
            service_name: string | null;
            items: unknown;
            paid_at: string | null;
          }[];
          const buyers = new Set<string>();
          const payers = new Set<string>();
          for (const p of pays) {
            const cid = p.client_id;
            if (cid) payers.add(cid);
            // Nombres de líneas: items jsonb si existe, sino service_name de la fila
            const lineNames: string[] = [];
            if (Array.isArray(p.items)) {
              for (const it of p.items as Record<string, unknown>[]) {
                const nm = (it?.service_name ?? it?.name ?? "") as string;
                if (nm) lineNames.push(nm.trim().toLowerCase());
              }
            }
            if (lineNames.length === 0 && p.service_name) {
              lineNames.push(p.service_name.trim().toLowerCase());
            }
            if (cid && lineNames.some((n) => productNames.has(n))) buyers.add(cid);
          }
          if (!cancelled) {
            setPayingClients(payers.size);
            setPayBuyerPct(
              payers.size > 0 ? Math.round((buyers.size / payers.size) * 100) : 0,
            );
          }
        } else if (!cancelled) {
          setPayBuyerPct(null);
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

  // ── Buckets de recuperación: inactivos (46–75 d) vs perdidos (76+ d) ──
  const clientTicket = (c: Client) =>
    c.visits > 0 ? Math.round(c.spent / c.visits) : avgTicket;
  const buildBucket = (pred: (c: Client) => boolean): LabBucket => {
    const list = clients.filter((c) => c.visits >= 1 && pred(c));
    const value = list.reduce((s, c) => s + clientTicket(c), 0);
    return {
      count: list.length,
      value,
      ticket: list.length > 0 ? Math.round(value / list.length) : avgTicket,
    };
  };
  const inact46 = buildBucket(
    (c) => (c.lastVisitDays ?? 0) >= 46 && (c.lastVisitDays ?? 0) <= 75,
  );
  const lost76 = buildBucket((c) => (c.lastVisitDays ?? 0) >= 76);

  // ── Frecuencia promedio de visita (días entre cortes) ──
  const visitsPerClientMonth = monthlyClients > 0 ? monthlyVisits / monthlyClients : 0;
  const avgFrequencyDays =
    visitsPerClientMonth > 0 ? Math.max(5, Math.round(30 / visitsPerClientMonth)) : 30;

  // ── Segmentos para oportunidad de productos ──
  const segActivos = clients.filter((c) => c.visits >= 1 && (c.lastVisitDays ?? 999) <= 30).length;
  const segNuevos = clients.filter((c) => c.visits <= 1).length;
  const spents = clients.map((c) => c.spent).sort((a, b) => b - a);
  const vipThreshold = spents.length > 0 ? spents[Math.floor(spents.length * 0.2)] ?? 0 : 0;
  const segVip = clients.filter((c) => c.visits >= 2 && c.spent >= vipThreshold && c.spent > 0).length;

  // ── Hora real de apertura/cierre desde la agenda efectiva ──
  const hoursDone = done
    .map((a) => new Date(a.starts_at).getHours())
    .filter((h) => Number.isFinite(h));
  const openHour = hoursDone.length > 0 ? Math.min(...hoursDone) : 9;
  const closeHour = hoursDone.length > 0 ? Math.max(...hoursDone) + 1 : 20;

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
    openHour,
    closeHour,
    inact46,
    lost76,
    avgFrequencyDays,
    segActivos,
    segVip,
    segNuevos,
    productBuyerPct: payBuyerPct,
    productAvgPrice: productAvgPrice || Math.round(avgTicket * 0.45),
    sellsProducts,
    payingClients,
    clients: clients.map((c) => ({
      acquisitionSource: c.acquisitionSource ?? null,
      acquisitionSourceCustom: c.acquisitionSourceCustom ?? null,
      acquisitionCapturedAt: c.acquisitionCapturedAt ?? null,
      spent: c.spent,
      visits: c.visits,
    })),
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
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
          {currentLabel}
        </div>
        <div className="mt-0.5 text-lg font-bold leading-none text-white/85">{currentValue}</div>
      </div>
      <div className="grid place-items-center text-white/25">
        <ArrowRight className="h-4 w-4" />
      </div>
      <div className="rounded-2xl border border-emerald-300/25 bg-emerald-400/[0.07] px-3 py-2.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/70">
          {projectedLabel}
        </div>
        <div className="mt-0.5 text-lg font-bold leading-none text-emerald-200">{projectedValue}</div>
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
      <div className="rounded-2xl border border-sky-300/20 bg-sky-400/[0.06] px-3.5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-sky-200/70">
          Facturación adicional
        </div>
        <div className="mt-0.5 text-xl font-extrabold text-sky-200">+{fmtAR(facturacion)}</div>
      </div>
      <div className="rounded-2xl border border-emerald-300/25 bg-emerald-400/[0.08] px-3.5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/80">
          Ganancia estimada
        </div>
        <div className="mt-0.5 text-xl font-extrabold text-emerald-200">+{fmtAR(utilidad)}</div>
      </div>
      {extra ? (
        <div className="rounded-2xl border border-violet-300/20 bg-violet-400/[0.06] px-3.5 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-violet-200/70">
            {extra.label}
          </div>
          <div className="mt-0.5 text-xl font-extrabold text-violet-200">{extra.value}</div>
        </div>
      ) : null}
    </div>
  );
}

function LabVerdict({ nivel, text }: { nivel: keyof typeof nivelMeta; text: string }) {
  const meta = nivelMeta[nivel];
  const title = nivel === "alto_riesgo" ? "Revisar antes de aplicar" : nivel === "evaluar" ? "Conviene probar con cuidado" : "Recomendado por IA";
  const Icon = meta.icon;
  return (
    <div className={cn("rounded-[20px] border px-3.5 py-3", meta.cls)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
            <Icon className={cn("h-4 w-4", meta.titleCls)} />
          </span>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/45">
              Veredicto del Gerente IA
            </p>
            <p className={cn("text-sm font-extrabold", meta.titleCls)}>{title}</p>
          </div>
        </div>
        <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold", meta.titleCls, "bg-white/8")}>{meta.label}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-white/80">{text}</p>
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
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-xl border px-3 py-1 text-xs font-semibold transition-all",
            value === o.key
              ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-100 shadow-[0_0_18px_-10px_rgba(34,211,238,0.65)]"
              : "border-white/10 bg-white/[0.03] text-white/55 hover:text-white hover:border-white/20",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Señales del simulador (compartidas) ─────────────────────────────

type LabSignal = { label: string; value: React.ReactNode; tone?: "neutral" | "alert" | "good" };

function LabSignals({ items }: { items: LabSignal[] }) {
  const toneCls: Record<string, string> = {
    neutral: "text-white/90",
    alert: "text-rose-200",
    good: "text-emerald-200",
  };
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((it, i) => (
        <div key={i} className="rounded-2xl border border-white/8 bg-white/[0.025] px-3 py-2.5">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/40">
            {it.label}
          </div>
          <div className={cn("mt-1 text-lg font-extrabold leading-none tabular-nums", toneCls[it.tone ?? "neutral"])}>
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// Señales de demanda no atendida que alimentan a los simuladores.
type DemandSlice = {
  loading: boolean;
  rejectedMonth: number;
  lostRevenueMonth: number;
  peakHours: { hour: number; count: number }[];
  saturatedPros: number;
  topPro: string | null;
  occupancy: number | null;
};

// ── Simuladores ────────────────────────────────────────────────────────────

function clampScore01(n: number) {
  return Math.max(1, Math.min(100, Math.round(n)));
}

// ── SUBIR PRECIOS ──────────────────────────────────────────────────────────
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
  const perdibles =
    precioNuevo > 0 ? Math.max(0, mensual - Math.ceil((mensual * precioActual) / precioNuevo)) : 0;
  const perdiblesShare = mensual > 0 ? (perdibles / mensual) * 100 : 0;
  const facturacion = Math.max(0, diferenciaMensual);
  const utilidad = Math.round(facturacion * LAB_MARGIN);
  const riesgoLabel = pct > 30 ? "Alto" : pct > 20 ? "Medio" : "Bajo";
  const riesgoCls = pct > 30 ? "text-rose-200" : pct > 20 ? "text-amber-200" : "text-emerald-200";
  const nivel: keyof typeof nivelMeta =
    pct > 30 ? "alto_riesgo" : pct <= 12 ? "recomendado" : pct <= 20 ? "progresivo" : "evaluar";
  const verdict =
    pct > 30
      ? `Subir ${fmtAR(aumento)} es un ${pct.toFixed(0)}% de golpe sobre ${svc?.nombre}. Mejor un aumento menor o en dos etapas: el riesgo de perder clientes supera lo que ganás.`
      : mensual === 0
        ? `Todavía no tengo ventas registradas de ${svc?.nombre} este mes para proyectar el impacto con precisión. La estimación es conservadora.`
        : `Sobre ${mensual} ventas mensuales, subir ${fmtAR(aumento)} suma ${fmtAR(facturacion)} de facturación con riesgo ${riesgoLabel.toLowerCase()}. Podés resignar hasta ${perdibles} cliente${perdibles === 1 ? "" : "s"}/mes y aún así mantenerte arriba.`;

  return (
    <div className="space-y-3">
      <div className="rounded-[18px] border border-cyan-300/15 bg-cyan-400/[0.035] px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/55">
            Elegí el servicio
          </p>
          <span className="hidden rounded-full border border-white/10 bg-white/[0.045] px-2.5 py-0.5 text-[10px] font-bold text-white/42 sm:inline-flex">
            {services.length} servicios
          </span>
        </div>
        <LabChips
          options={services.map((s) => ({ key: s.id, label: s.nombre }))}
          value={svc?.id ?? ""}
          onChange={setSvcId}
        />
      </div>

      <div className="relative overflow-hidden rounded-[20px] border border-cyan-300/20 bg-gradient-to-br from-cyan-400/[0.10] via-white/[0.035] to-emerald-400/[0.06] px-4 py-3 shadow-[0_18px_60px_-48px_rgba(34,211,238,0.95)]">
        <div className="pointer-events-none absolute -right-12 -top-20 h-44 w-44 rounded-full bg-cyan-400/18 blur-3xl" />
        <div className="relative flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-100/80">
              <Sparkles className="h-3 w-3" /> Resultado estimado
            </div>
            <h3 className="max-w-2xl text-lg font-extrabold tracking-[-0.03em] text-white sm:text-xl">
              Si aumentás {fmtAR(aumento)}, podrías generar {fmtAR(facturacion)} más por mes.
            </h3>
            <p className="mt-1 max-w-2xl truncate text-xs text-white/58">
              {svc?.nombre} · precio actual {fmtAR(precioActual)} · riesgo{" "}
              <span className={cn("font-bold", riesgoCls)}>{riesgoLabel.toLowerCase()}</span>
            </p>
          </div>
          <div className="shrink-0 rounded-2xl border border-white/12 bg-white/[0.055] px-4 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/42">Riesgo</p>
            <p className={cn("mt-0.5 text-lg font-extrabold leading-none", riesgoCls)}>{riesgoLabel}</p>
          </div>
        </div>
      </div>

      <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="mb-1.5 flex items-end justify-between gap-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            Aumento seleccionado
          </span>
          <span className="text-2xl font-extrabold leading-none text-cyan-200">+{fmtAR(aumento)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(5000, Math.round(precioActual))}
          step={100}
          value={aumento}
          onChange={(e) => setAumento(Number(e.target.value))}
          className="h-2 w-full accent-cyan-400"
        />
        <div className="mt-1 flex justify-between text-[9px] font-semibold text-white/32">
          <span>$0</span>
          <span>+{fmtAR(Math.max(5000, Math.round(precioActual)))}</span>
        </div>
      </div>

      <LabVerdict nivel={nivel} text={verdict} />

      <LabImpact facturacion={facturacion} utilidad={utilidad} />

      <LabScenario
        currentLabel="Precio actual"
        currentValue={fmtAR(precioActual)}
        projectedLabel="Precio sugerido"
        projectedValue={fmtAR(precioNuevo)}
      />
    </div>
  );
}

// ── SUMAR PROFESIONAL ──────────────────────────────────────────────────────
function LabProfesional({
  data,
  demand,
  ocupacion,
}: {
  data: LabData;
  demand: DemandSlice;
  ocupacion: number;
}) {
  if (data.loading || demand.loading) return <LabSkeleton />;

  const occ = Math.round(ocupacion || demand.occupancy || 0);
  const rechazados = demand.rejectedMonth;
  const saturados = demand.saturatedPros;
  const perdida = demand.lostRevenueMonth;

  // Un profesional nuevo absorbe la demanda no atendida (tope realista).
  const recuperables = Math.min(rechazados, Math.round(data.avgTurnosPerDay * data.openDaysPerWeek * 4.3 * 0.6));
  const facturacion = recuperables * data.avgTicket;
  const utilidad = Math.round(facturacion * (LAB_MARGIN - 0.05));

  const occScore = occ;
  const rejScore = Math.min(100, rechazados * 3);
  const satScore = saturados >= 1 ? 100 : 40;

  let nivel: keyof typeof nivelMeta;
  let titulo: string;
  let verdict: string;
  if (occ >= 85 || (rechazados >= 20 && saturados >= 1)) {
    nivel = "recomendado";
    titulo = "Conviene contratar";
    verdict = `Con ${occ}% de ocupación${rechazados > 0 ? ` y ${rechazados} clientes rechazados este mes` : ""}, ya estás dejando demanda afuera. Un profesional nuevo podría recuperar ~${recuperables} servicios/mes (${fmtAR(facturacion)})${saturados >= 1 ? ` y descomprimir a ${saturados} profesional${saturados === 1 ? "" : "es"} saturado${saturados === 1 ? "" : "s"}` : ""}.`;
  } else if (occ >= 70 || rechazados >= 10) {
    nivel = "progresivo";
    titulo = "Esperar un poco más";
    verdict = `Ocupación ${occ}%${rechazados > 0 ? ` con ${rechazados} rechazos/mes` : ""}: estás cerca, pero todavía hay margen para llenar la agenda actual. Si el rechazo sigue subiendo 1–2 meses, sumá un profesional.`;
  } else {
    nivel = "no_recomendado";
    titulo = "Todavía no conviene";
    verdict = `Con ${occ}% de ocupación${rechazados === 0 ? " y sin clientes rechazados registrados" : ` y solo ${rechazados} rechazos/mes`}, todavía tenés sillones libres. Sumar gente ahora divide tu demanda. Primero llená la agenda que ya tenés.`;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-[18px] border border-white/10 bg-white/[0.025] px-4 py-3">
        <h3 className="text-base font-extrabold tracking-[-0.02em] text-white sm:text-lg">
          ¿Conviene contratar un profesional?
        </h3>
        <p className="mt-0.5 text-xs text-white/50">
          Analizo tu ocupación y la demanda que el negocio no pudo atender.
        </p>
      </div>

      <LabSignals
        items={[
          { label: "Agenda ocupada", value: `${occ}%`, tone: occ >= 85 ? "alert" : "neutral" },
          { label: "Clientes rechazados", value: rechazados, tone: rechazados > 0 ? "alert" : "neutral" },
          { label: "Profesionales completos", value: saturados, tone: saturados > 0 ? "alert" : "neutral" },
          { label: "Demanda perdida (mes)", value: fmtDemandARS(perdida), tone: perdida > 0 ? "alert" : "neutral" },
        ]}
      />

      <div className={cn("rounded-[18px] border px-3.5 py-3", nivelMeta[nivel].cls)}>
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/45">
          Veredicto del Gerente IA
        </p>
        <p className={cn("mt-0.5 text-base font-extrabold", nivelMeta[nivel].titleCls)}>{titulo}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-white/80">{verdict}</p>
      </div>

      {recuperables > 0 && (
        <LabImpact
          facturacion={facturacion}
          utilidad={utilidad}
          extra={{ label: "Servicios recuperables / mes", value: `+${recuperables}` }}
        />
      )}
    </div>
  );
}

// ── EXTENDER HORARIO ───────────────────────────────────────────────────────
function LabHorario({ data, demand }: { data: LabData; demand: DemandSlice }) {
  const [opt, setOpt] = React.useState<"antes" | "tarde">("antes");
  if (data.loading || demand.loading) return <LabSkeleton />;

  const openHour = data.openHour;
  const closeHour = data.closeHour;
  const ph = demand.peakHours;
  const sum = (pred: (h: number) => boolean) =>
    ph.filter((x) => pred(x.hour)).reduce((s, x) => s + x.count, 0);

  const benefitAntes = sum((h) => h < openHour) + sum((h) => h === openHour);
  const benefitTarde = sum((h) => h >= closeHour) + sum((h) => h === closeHour - 1);
  const extraClients = opt === "antes" ? benefitAntes : benefitTarde;
  const best = Math.max(benefitAntes, benefitTarde);
  const facturacion = extraClients * data.avgTicket;
  const utilidad = Math.round(facturacion * LAB_MARGIN);

  let nivel: keyof typeof nivelMeta;
  let titulo: string;
  let verdict: string;
  const beforeHasDemand = benefitAntes >= 2;
  const afterHasDemand = benefitTarde >= 2;

  if (!beforeHasDemand && !afterHasDemand) {
    nivel = "no_recomendado";
    titulo = "No conviene extender horario";
    verdict =
      opt === "antes"
        ? "No detectamos clientes rechazados ni una alta demanda durante el primer horario del día. La agenda tiene disponibilidad al inicio de la jornada, por lo que abrir antes no generaría más reservas en este momento."
        : "No detectamos clientes rechazados ni una alta demanda durante el último horario del día. Los últimos turnos disponibles no están completamente ocupados, por lo que extender el cierre no aportaría más reservas por ahora.";
  } else if (opt === "antes" && beforeHasDemand) {
    nivel = "recomendado";
    titulo = "Conviene abrir 1 hora antes";
    verdict = `Detectamos una alta demanda durante el primer horario del día. Varios clientes intentaron reservar en ese horario y no encontraron disponibilidad. Abrir una hora antes podría captar aproximadamente ${benefitAntes} clientes más por mes y sumar ${fmtAR(facturacion)} de facturación.`;
  } else if (opt === "tarde" && afterHasDemand) {
    nivel = "recomendado";
    titulo = "Conviene cerrar 1 hora después";
    verdict = `Detectamos una alta demanda durante el último horario del día. Se registraron clientes rechazados o falta de disponibilidad en el cierre de la jornada. Extender el horario una hora podría sumar aproximadamente ${benefitTarde} clientes más por mes y generar ${fmtAR(facturacion)} de facturación.`;
  } else {
    nivel = "evaluar";
    titulo = benefitAntes > benefitTarde ? "Mejor abrir 1 hora antes" : "Mejor cerrar 1 hora después";
    verdict =
      opt === "antes"
        ? "No detectamos clientes rechazados ni una alta demanda durante el primer horario del día. La oportunidad más fuerte aparece al final de la jornada, por eso conviene evaluar cerrar más tarde antes que abrir antes."
        : "No detectamos clientes rechazados ni una alta demanda durante el último horario del día. La oportunidad más fuerte aparece al inicio de la jornada, por eso conviene evaluar abrir antes antes que cerrar más tarde.";
  }

  return (
    <div className="space-y-3">
      <div className="rounded-[18px] border border-white/10 bg-white/[0.025] px-4 py-3">
        <h3 className="text-base font-extrabold tracking-[-0.02em] text-white sm:text-lg">
          ¿Conviene abrir antes o cerrar más tarde?
        </h3>
        <p className="mt-0.5 text-xs text-white/50">
          Tu agenda hoy abre ~{openHour}:00 y cierra ~{closeHour}:00. Miro los rechazos en cada borde.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {([
          { key: "antes", label: "Abrir 1 hora antes", icon: Sunrise, n: benefitAntes },
          { key: "tarde", label: "Cerrar 1 hora después", icon: Sunset, n: benefitTarde },
        ] as const).map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setOpt(o.key)}
            className={cn(
              "flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition-all",
              opt === o.key
                ? "border-cyan-300/40 bg-cyan-400/[0.1] shadow-[0_0_28px_-12px_rgba(34,211,238,0.6)]"
                : "border-white/10 bg-white/[0.03] opacity-60 hover:opacity-100",
            )}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15 text-white">
              <o.icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-white">{o.label}</span>
              <span className="block text-[11px] leading-snug text-white/45">
                {o.key === "antes"
                  ? o.n > 0
                    ? `${o.n} rechazados en el primer horario`
                    : "Sin rechazos ni alta demanda al inicio"
                  : o.n > 0
                    ? `${o.n} rechazados en el último horario`
                    : "Sin rechazos ni alta demanda al cierre"}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className={cn("rounded-[18px] border px-3.5 py-3", nivelMeta[nivel].cls)}>
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/45">
          Veredicto del Gerente IA
        </p>
        <p className={cn("mt-0.5 text-base font-extrabold", nivelMeta[nivel].titleCls)}>{titulo}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-white/80">{verdict}</p>
      </div>

      <LabImpact
        facturacion={facturacion}
        utilidad={utilidad}
        extra={{ label: "Clientes adicionales / mes", value: `+${extraClients}` }}
      />
    </div>
  );
}

// ── RECUPERAR CLIENTES ─────────────────────────────────────────────────────
function LabRecuperar({ data }: { data: LabData }) {
  const [pct, setPct] = React.useState(25);
  if (data.loading) return <LabSkeleton />;

  const pool = data.inact46.count + data.lost76.count;
  if (pool === 0) {
    return (
      <LabEmpty text="¡Buenas noticias! No detectamos clientes inactivos ni perdidos para recuperar. Tu base está viniendo seguido." />
    );
  }

  const recuperados = Math.round((pool * pct) / 100);
  const totalValue = data.inact46.value + data.lost76.value;
  const ticketProm = pool > 0 ? Math.round(totalValue / pool) : data.avgTicket;
  const facturacion = recuperados * ticketProm;
  const utilidad = Math.round(facturacion * LAB_MARGIN);
  const nivel: keyof typeof nivelMeta = pct <= 25 ? "recomendado" : pct <= 45 ? "progresivo" : "evaluar";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-amber-300/15 bg-amber-400/[0.05] px-3.5 py-3">
          <div className="text-3xl font-extrabold tabular-nums text-amber-200">{data.inact46.count}</div>
          <div className="mt-0.5 text-[11px] text-white/50">Clientes inactivos</div>
          <div className="text-[10px] text-white/35">46 a 75 días sin venir</div>
        </div>
        <div className="rounded-2xl border border-rose-300/15 bg-rose-500/[0.05] px-3.5 py-3">
          <div className="text-3xl font-extrabold tabular-nums text-rose-300">{data.lost76.count}</div>
          <div className="mt-0.5 text-[11px] text-white/50">Clientes perdidos</div>
          <div className="text-[10px] text-white/35">76 días o más</div>
        </div>
      </div>

      <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="mb-1.5 flex items-end justify-between gap-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            ¿Qué porcentaje recuperar?
          </span>
          <span className="text-2xl font-extrabold leading-none text-cyan-200">{pct}%</span>
        </div>
        <input
          type="range"
          min={5}
          max={60}
          step={5}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          className="h-2 w-full accent-cyan-400"
        />
        <div className="mt-1 flex justify-between text-[9px] font-semibold text-white/32">
          <span>5%</span>
          <span>60%</span>
        </div>
      </div>

      <LabVerdict
        nivel={nivel}
        text={`Recuperar el ${pct}% son ${recuperados} cliente${recuperados === 1 ? "" : "s"} (${fmtAR(facturacion)} estimados). Es realista con una campaña de WhatsApp con beneficio por tiempo limitado. Arrancá por los que más gastaban.`}
      />

      <LabImpact
        facturacion={facturacion}
        utilidad={utilidad}
        extra={{ label: "Clientes recuperados", value: `+${recuperados}` }}
      />
    </div>
  );
}

// ── VENTA DE PRODUCTOS ─────────────────────────────────────────────────────
const PRODUCT_TARGETS = [6, 10, 15, 20, 25];

function LabProductos({ data }: { data: LabData }) {
  // Hooks SIEMPRE antes de cualquier return condicional (regla de hooks).
  const [target, setTarget] = React.useState<number | null>(null);

  if (data.loading) return <LabSkeleton />;
  if (!data.sellsProducts) {
    return (
      <LabEmpty text="Todavía no cargaste productos en el catálogo. Cargalos en Configuración (shampoo, cera, after, etc.) para medir y simular la venta de productos." />
    );
  }
  if (data.productBuyerPct === null) {
    return (
      <LabEmpty text="Todavía no podemos leer ventas con productos para medir cuántos clientes compran. Registrá cobros que incluyan productos y este simulador se activa con tu dato real." />
    );
  }

  const actual = data.productBuyerPct;
  const opciones = PRODUCT_TARGETS.filter((t) => t > actual);
  // Default vivo: hasta que el usuario elija, refleja el primer objetivo sobre el % real.
  const defaultTarget = opciones[0] ?? actual + 5;
  const effectiveTarget = Math.max(target ?? defaultTarget, actual);

  const base = data.payingClients > 0 ? data.payingClients : data.monthlyClients;
  const extraClients = Math.max(0, Math.round((base * (effectiveTarget - actual)) / 100));
  const price = data.productAvgPrice;
  const facturacion = extraClients * price;
  const utilidad = Math.round(facturacion * LAB_PRODUCT_MARGIN);
  const salto = effectiveTarget - actual;
  const nivel: keyof typeof nivelMeta = salto <= 5 ? "recomendado" : salto <= 12 ? "progresivo" : "evaluar";

  const segmentos = [
    { label: "Clientes activos", n: data.segActivos },
    { label: "Clientes VIP", n: data.segVip },
    { label: "Clientes nuevos", n: data.segNuevos },
  ].sort((a, b) => b.n - a.n);
  const oportunidad = segmentos[0];

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-[18px] border border-cyan-300/15 bg-cyan-400/[0.04] px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/55">
              Hoy compra productos
            </p>
            <p className="mt-0.5 text-xs text-white/45">
              Sobre {base} clientes que te compraron en los últimos 90 días.
            </p>
          </div>
          <span className="text-3xl font-extrabold leading-none text-cyan-200">{actual}%</span>
        </div>
      </div>

      <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/40">
          ¿A qué porcentaje querés llegar?
        </div>
        {opciones.length > 0 ? (
          <LabChips
            options={opciones.map((t) => ({ key: String(t), label: `${t}%` }))}
            value={String(effectiveTarget)}
            onChange={(k) => setTarget(Number(k))}
          />
        ) : (
          <p className="text-xs text-white/55">
            Ya estás en {actual}%, un nivel muy alto de venta de productos. Mantené el ritmo.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-violet-300/15 bg-violet-400/[0.05] px-3.5 py-2.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-violet-200/70">
          Mayor oportunidad
        </span>
        <p className="mt-0.5 text-sm font-bold text-white/85">
          {oportunidad.label} <span className="text-white/45">· {oportunidad.n} clientes</span>
        </p>
      </div>

      <LabVerdict
        nivel={nivel}
        text={`Pasar del ${actual}% al ${effectiveTarget}% son ${extraClients} ventas extra de producto por mes (${fmtAR(facturacion)}). Se logra ofreciendo el producto en el sillón al terminar el corte: "esto es lo que te puse, ¿te lo llevás?". Empezá por ${oportunidad.label.toLowerCase()}.`}
      />

      <LabImpact
        facturacion={facturacion}
        utilidad={utilidad}
        extra={{ label: "Compradores extra / mes", value: `+${extraClients}` }}
      />
    </div>
  );
}

// ── FIDELIZACIÓN ───────────────────────────────────────────────────────────
function LabPublicidad({ data }: { data: LabData }) {
  const [channel, setChannel] = React.useState<string>(MEASURABLE_CHANNELS[0].id);
  const [investment, setInvestment] = React.useState(100_000);
  const [projection, setProjection] = React.useState(100_000);
  const [range, setRange] = React.useState<DateRange>(() => {
    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - 1);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });

  if (data.loading) return <LabSkeleton />;

  const hasAnyChannelData = data.clients.some((c) => c.acquisitionSource);
  if (!hasAnyChannelData) {
    return (
      <LabEmpty text="Todavía no hay clientes con canal de origen registrado. En cuanto empiecen a reservar desde la página pública respondiendo '¿Cómo nos conociste?', este simulador se activa con tus datos reales." />
    );
  }

  const rangeStart = new Date(`${range.from}T00:00:00`).getTime();
  const rangeEnd = new Date(`${range.to}T23:59:59`).getTime();
  const sixMonthsAgo = Date.now() - 182 * 86_400_000;

  function statsFor(chan: string, sinceMs: number, untilMs: number = Date.now()) {
    const list = data.clients.filter((c) => {
      if (c.acquisitionSource !== chan || !c.acquisitionCapturedAt) return false;
      const t = new Date(c.acquisitionCapturedAt).getTime();
      return !Number.isNaN(t) && t >= sinceMs && t <= untilMs;
    });
    const clientes = list.length;
    const facturacion = list.reduce((s, c) => s + c.spent, 0);
    const avgVisitas = clientes > 0 ? list.reduce((s, c) => s + c.visits, 0) / clientes : 0;
    return { clientes, facturacion, avgVisitas };
  }

  // Métricas reales del canal elegido, dentro del rango de inversión cargado.
  const sel = statsFor(channel, rangeStart, rangeEnd);
  const costoPorCliente = sel.clientes > 0 ? Math.round(investment / sel.clientes) : 0;
  const ganancia = Math.round(sel.facturacion * LAB_MARGIN) - investment;
  const roi = investment > 0 ? ganancia / investment : 0;

  // Proyección: extrapola el costo por cliente real a una inversión futura.
  const avgRevenuePerClient = sel.clientes > 0 ? sel.facturacion / sel.clientes : 0;
  const clientesProyectados = costoPorCliente > 0 ? Math.round(projection / costoPorCliente) : 0;
  const facturacionProyectada = Math.round(clientesProyectados * avgRevenuePerClient);
  const gananciaProyectada = Math.round(facturacionProyectada * LAB_MARGIN) - projection;

  const riesgo: "Bajo" | "Medio" | "Alto" =
    sel.clientes < 3 || roi < 0 ? "Alto" : sel.clientes < 8 || roi < 0.5 ? "Medio" : "Bajo";
  const riesgoTone = riesgo === "Alto" ? "alert" : riesgo === "Medio" ? "neutral" : "good";

  const nivel: keyof typeof nivelMeta =
    sel.clientes < 3
      ? "alto_riesgo"
      : roi >= 1
        ? "recomendado"
        : roi >= 0.3
          ? "progresivo"
          : roi >= 0
            ? "evaluar"
            : "no_recomendado";

  const channelLabel = MEASURABLE_CHANNELS.find((c) => c.id === channel)?.label ?? channel;

  // Comparación entre canales medibles (ventana fija de 6 meses) — solo con
  // datos reales de clientes/facturación/recurrencia; no inventa inversión
  // para canales donde el usuario no la cargó.
  const comparison = MEASURABLE_CHANNELS.map((c) => ({ ...c, ...statsFor(c.id, sixMonthsAgo) })).filter(
    (c) => c.clientes > 0,
  );
  const bestValue = [...comparison].sort(
    (a, b) => b.facturacion / b.clientes - a.facturacion / a.clientes,
  )[0];
  const bestRetention = [...comparison].sort((a, b) => b.avgVisitas - a.avgVisitas)[0];

  const verdictText =
    sel.clientes === 0
      ? `No detectamos clientes que hayan llegado por ${channelLabel} entre ${range.from} y ${range.to}. Probá otro canal o ampliá el rango de fechas.`
      : `Con ${fmtAR(investment)} invertidos en ${channelLabel} conseguiste ${sel.clientes} cliente${sel.clientes === 1 ? "" : "s"} a ${fmtAR(costoPorCliente)} cada uno, con una ganancia estimada de ${fmtAR(ganancia)} (ROI ${Math.round(roi * 100)}%). Si invertís ${fmtAR(projection)} más, estimamos ~${clientesProyectados} clientes nuevos.${
          bestValue && bestRetention
            ? ` En los últimos 6 meses, ${bestValue.label} trajo el mayor valor promedio por cliente (${fmtAR(Math.round(bestValue.facturacion / bestValue.clientes))}) y ${bestRetention.label} la mayor recurrencia (${bestRetention.avgVisitas.toFixed(1)} visitas promedio).`
            : ""
        }`;

  return (
    <div className="space-y-3">
      <div className="rounded-[18px] border border-white/10 bg-white/[0.025] px-4 py-3">
        <h3 className="text-base font-extrabold tracking-[-0.02em] text-white sm:text-lg">
          Publicidad: ¿dónde conviene invertir el próximo peso?
        </h3>
        <p className="mt-0.5 text-xs text-white/50">
          Elegí un canal pago y cargá cuánto invertiste para ver el costo por cliente y el ROI real.
        </p>
      </div>

      <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/40">
          Canal publicitario
        </div>
        <LabChips
          options={MEASURABLE_CHANNELS.map((c) => ({ key: c.id, label: c.label }))}
          value={channel}
          onChange={setChannel}
        />
      </div>

      <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/40">
          Rango de fechas de la inversión
        </div>
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
      </div>

      <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="mb-1.5 flex items-end justify-between gap-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            ¿Cuánto invertiste en {channelLabel} en ese período?
          </span>
          <span className="text-2xl font-extrabold leading-none text-cyan-200">{fmtDemandARS(investment)}</span>
        </div>
        <input
          type="range"
          min={10_000}
          max={1_000_000}
          step={10_000}
          value={investment}
          onChange={(e) => setInvestment(Number(e.target.value))}
          className="h-2 w-full accent-cyan-400"
        />
        <div className="mt-1 flex justify-between text-[9px] font-semibold text-white/32">
          <span>$10.000</span>
          <span>$1.000.000</span>
        </div>
      </div>

      <LabSignals
        items={[
          { label: "Clientes obtenidos", value: sel.clientes, tone: "good" },
          { label: "Costo por cliente", value: fmtDemandARS(costoPorCliente) },
          { label: "Facturación generada", value: fmtDemandARS(sel.facturacion) },
          { label: "Riesgo", value: riesgo, tone: riesgoTone },
        ]}
      />

      <LabImpact
        facturacion={sel.facturacion}
        utilidad={ganancia}
        extra={{ label: "ROI", value: `${Math.round(roi * 100)}%` }}
      />

      <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="mb-1.5 flex items-end justify-between gap-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            Simular nueva inversión en {channelLabel}
          </span>
          <span className="text-2xl font-extrabold leading-none text-cyan-200">{fmtDemandARS(projection)}</span>
        </div>
        <input
          type="range"
          min={10_000}
          max={1_000_000}
          step={10_000}
          value={projection}
          onChange={(e) => setProjection(Number(e.target.value))}
          className="h-2 w-full accent-cyan-400"
        />
        <div className="mt-1 flex justify-between text-[9px] font-semibold text-white/32">
          <span>$10.000</span>
          <span>$1.000.000</span>
        </div>
      </div>

      <LabScenario
        currentLabel="Clientes con la inversión actual"
        currentValue={sel.clientes}
        projectedLabel="Clientes proyectados"
        projectedValue={`~${clientesProyectados}`}
      />

      {clientesProyectados > 0 ? (
        <LabSignals
          items={[
            { label: "Facturación esperada", value: fmtDemandARS(facturacionProyectada), tone: "good" },
            { label: "Ganancia esperada", value: fmtDemandARS(gananciaProyectada), tone: gananciaProyectada >= 0 ? "good" : "alert" },
          ]}
        />
      ) : null}

      {comparison.length > 1 ? (
        <div className="rounded-[18px] border border-white/10 bg-white/[0.025] px-4 py-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/40">
            Canales medibles · últimos 6 meses
          </div>
          <div className="space-y-1.5">
            {comparison
              .sort((a, b) => b.clientes - a.clientes)
              .map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-semibold text-white/80">
                    <AcquisitionChannelIcon channel={c} className="h-3.5 w-3.5 shrink-0" />
                    {c.label}
                  </span>
                  <span className="text-white/50">
                    {c.clientes} cliente{c.clientes === 1 ? "" : "s"} · {fmtDemandARS(Math.round(c.facturacion / c.clientes))} prom.
                  </span>
                </div>
              ))}
          </div>
        </div>
      ) : null}

      <LabVerdict nivel={nivel} text={verdictText} />
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
  { key: "precios", icon: DollarSign, l1: "Subir", l2: "Precios", label: "Subir precios" },
  { key: "profesional", icon: BriefcaseBusiness, l1: "Sumar", l2: "Profesional", label: "Sumar profesional" },
  { key: "horario", icon: Clock, l1: "Extender", l2: "Horario", label: "Extender horario" },
  { key: "recuperar", icon: Users, l1: "Recuperar", l2: "Clientes", label: "Recuperar clientes" },
  { key: "productos", icon: Package, l1: "Venta de", l2: "Productos", label: "Venta de productos" },
  { key: "publicidad", icon: Megaphone, l1: "Publicidad", l2: "", label: "Publicidad" },
] as const;

function LaboratorioDecisiones(props: SimuladorProps) {
  const data = useLabData(props.businessId, props.ticket, props.clientes);
  const { analytics: a, isLoading: demandLoading } = useRejectedAnalytics(props.businessId ?? null);
  const [sim, setSim] = React.useState<(typeof LAB_SIMS)[number]["key"]>("precios");
  const [infoOpen, setInfoOpen] = React.useState(false);

  const demand: DemandSlice = {
    loading: demandLoading,
    rejectedMonth: a.counts.month,
    lostRevenueMonth: a.lostRevenue.month,
    peakHours: a.peakHours,
    saturatedPros: a.professionals.filter((p) => p.tier === "fire").length,
    topPro: a.topProfessionals[0]?.label ?? null,
    occupancy: a.avgOccupancyMonth ?? null,
  };

  const sims = LAB_SIMS;

  return (
    <div className="space-y-4">
      {/* Encabezado del laboratorio · franja compacta */}
      <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-[#070b18]/80 px-4 py-2.5 shadow-[0_20px_70px_-50px_rgba(56,189,248,0.7)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute -top-16 left-1/4 h-40 w-40 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-xl ring-1 ring-white/15">
            🧪
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 text-lg font-extrabold tracking-[-0.02em] text-white sm:text-xl">
              Gerente IA · ¿conviene hacerlo en tu negocio?
            </h2>
            <p className="line-clamp-2 text-xs text-white/55">
              Analizo tus datos reales y te digo si conviene tomar la decisión.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            title="Los simuladores usan tus datos reales (servicios, clientes, agenda, horarios y demanda no atendida). Las proyecciones son estimaciones con supuestos conservadores."
            aria-label="Cómo funcionan los simuladores"
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/[0.08] px-3 text-xs font-bold text-cyan-100 shadow-[0_0_24px_-12px_rgba(34,211,238,0.7)] transition hover:border-cyan-200/35 hover:bg-cyan-400/[0.13] hover:text-white"
          >
            <CircleHelp className="h-4 w-4" />
            <span className="hidden sm:inline">Cómo funciona</span>
          </button>
        </div>
      </div>

      {infoOpen && (
        <InfoModal content={INFO_CONTENT.simuladores} onClose={() => setInfoOpen(false)} />
      )}

      {/* Selector de simuladores · solo título */}
      <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
        {sims.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSim(s.key)}
            className={cn(
              // min-h subido y padding/ícono/tipografía ajustados para que
              // las etiquetas de 2 líneas (ej. "Sumar" / "Profesional")
              // entren sin desbordar en el grid de 3 columnas de mobile —
              // mismo concepto de botón (ícono + texto en fila), solo el
              // ajuste interno. truncate como garantía final: nunca se sale
              // del botón aunque una palabra puntual no entre entera.
              "group flex min-h-[60px] items-center gap-1.5 rounded-2xl border px-2 py-2 text-left transition-all",
              sim === s.key
                ? "border-cyan-300/40 bg-cyan-400/[0.1] opacity-100 shadow-[0_0_30px_-10px_rgba(34,211,238,0.6)]"
                : "border-white/10 bg-white/[0.03] opacity-55 hover:border-white/20 hover:bg-white/[0.05] hover:opacity-100",
            )}
          >
            <span
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-xl ring-1 text-white",
                sim === s.key ? "bg-white/15 ring-white/20" : "bg-white/[0.06] ring-white/10",
              )}
            >
              {React.createElement(s.icon, { className: "h-3.5 w-3.5" })}
            </span>
            <span className="min-w-0 flex-1 leading-[1.2]">
              <span className="block truncate text-[11px] font-bold text-white sm:text-[13px]">{s.l1}</span>
              {s.l2 ? <span className="block truncate text-[11px] font-bold text-white sm:text-[13px]">{s.l2}</span> : null}
            </span>
          </button>
        ))}
      </div>

      {/* Simulador activo */}
      <div className="relative overflow-hidden rounded-[24px] border border-white/12 bg-[#080b16]/80 p-3 shadow-[0_24px_80px_-50px_rgba(56,189,248,0.6)] backdrop-blur-2xl sm:p-5">
        <div className="pointer-events-none absolute -top-24 right-0 h-56 w-56 rounded-full bg-gradient-to-br from-cyan-500/15 to-transparent blur-3xl" />
        <div className="relative">
          {sim === "precios" && <LabPrecios data={data} />}
          {sim === "profesional" && (
            <LabProfesional data={data} demand={demand} ocupacion={props.ocupacion} />
          )}
          {sim === "horario" && <LabHorario data={data} demand={demand} />}
          {sim === "recuperar" && <LabRecuperar data={data} />}
          {sim === "productos" && <LabProductos data={data} />}
          {sim === "publicidad" && <LabPublicidad data={data} />}
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
