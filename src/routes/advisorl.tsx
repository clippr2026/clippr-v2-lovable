import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import { useAuth } from "@/hooks/use-auth";
import { AccessDenied, usePermGuard } from "@/hooks/use-perm-guard";
import { fmtAR } from "@/components/dashboard/use-dashboard-data";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowRight,
  BadgePercent,
  Brain,
  CalendarDays,
  CheckCircle2,
  DollarSign,
  Heart,
  HeartPulse,
  Loader2,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/advisorl")({
  head: () => ({
    meta: [
      { title: "Asesor IA — Clippr" },
      { name: "description", content: "Análisis inteligente para mejorar el negocio." },
    ],
  }),
  component: AdvisorRoute,
});

type ActionTone = "money" | "warning" | "growth" | "client" | "neutral";

type ActionStatus = "pending" | "running" | "completed" | "archived";

type AdvisorAction = {
  title: string;
  detail: string;
  impact: string;
  impactValue: number;
  icon: React.ComponentType<{ className?: string }>;
  button: string;
  tone: ActionTone;
  problem: string;
  opportunity: string;
  howToAct: string[];
  suggestedMessage: string;
  actionButtons: string[];
  score: number;
  status: ActionStatus;
  startedAt?: number;
  completedAt?: number;
};

type ActionLifecycle = { status: ActionStatus; startedAt?: number; completedAt?: number };

const ACTION_LIFECYCLE_KEY = "clippr_advisor_action_lifecycle_demo";
const ACHIEVED_VISIBLE_MS = 3 * 24 * 60 * 60 * 1000;

type InfoModalContent = {
  title: string;
  description: string;
  points: string[];
};

const INFO_CONTENT = {
  growth: {
    title: "Crecimiento del negocio",
    description: "Mide cuánto creció la utilidad del negocio frente al mes anterior.",
    points: [
      "Fórmula: utilidad actual vs utilidad del mes anterior.",
      "Utilidad = facturación - gastos - comisiones.",
      "Clientes, ticket y ocupación explican qué impulsó el crecimiento.",
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

function AdvisorRoute() {
  const hasAccess = usePermGuard("dashboard");
  const { loading, session } = useAuth();
  const navigate = useNavigate();

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

  return (
    <AppShell>
      <Topbar title="Asesor IA" subtitle="Análisis diario y crecimiento del negocio" />
      <AdvisorContent />
    </AppShell>
  );
}

function AdvisorContent() {
  const [shouldAnimateResults, setShouldAnimateResults] = React.useState(false);
  const animationProgress = useResultAnimation(shouldAnimateResults);
  const [infoModal, setInfoModal] = React.useState<InfoModalContent | null>(null);
  const todayKey = getTodayKey();
  const needsDailyAnalysis = React.useMemo(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("clippr_advisor_last_daily_analysis") !== todayKey;
  }, [todayKey]);

  const [analysisStarted, setAnalysisStarted] = React.useState(() => !needsDailyAnalysis);
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);

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

    const steps = [
      "Revisando utilidad del mes...",
      "Analizando clientes activos...",
      "Detectando horarios libres...",
      "Buscando oportunidades de recuperación...",
      "Generando acciones recomendadas...",
    ];

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
        }, 700);
      }
    }, 2000);

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
  const [selectedRecommendation, setSelectedRecommendation] = React.useState<AdvisorAction | null>(
    null,
  );
  const [actionLifecycle, setActionLifecycle] = React.useState<Record<string, ActionLifecycle>>(
    () => {
      if (typeof window === "undefined") return {};
      const saved = localStorage.getItem(ACTION_LIFECYCLE_KEY);
      if (!saved) return {};
      try {
        return JSON.parse(saved);
      } catch {
        return {};
      }
    },
  );

  const now = Date.now();

  // Recomendaciones enriquecidas con su estado persistido. Una recomendación
  // "completed" pasa automáticamente a "archived" después de 3 días.
  const enrichedActions = getDemoActions(showExtraRecommendation).map((action) => {
    const life = actionLifecycle[action.title];
    let status: ActionStatus = life?.status ?? "pending";
    if (
      status === "completed" &&
      life?.completedAt &&
      now - life.completedAt > ACHIEVED_VISIBLE_MS
    ) {
      status = "archived";
    }
    return { ...action, status, startedAt: life?.startedAt, completedAt: life?.completedAt };
  });

  // Todo sale de la lista ordenada por score descendente: el Hero es el score
  // más alto y las tarjetas son los siguientes tres.
  const ranked = [...enrichedActions].sort((a, b) => b.score - a.score);
  const archivedActions = ranked.filter((a) => a.status === "archived");
  const activeActions = ranked.filter((a) => a.status !== "archived");
  const priorityAction = activeActions[0] ?? null;
  const otherActions = activeActions.slice(1, 4);

  const strategicIdea = getStrategicIdea();
  const healthTone = getHealthTone(DEMO.health);
  const animatedHealth = Math.round(DEMO.health * animationProgress);
  const animatedProfit = Math.round(DEMO.profit * animationProgress);

  function patchLifecycle(title: string, patch: Partial<ActionLifecycle>) {
    setActionLifecycle((current) => {
      const prev = current[title] ?? { status: "pending" as ActionStatus };
      const next = { ...current, [title]: { ...prev, ...patch } };
      if (typeof window !== "undefined") {
        localStorage.setItem(ACTION_LIFECYCLE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }

  function handleStartStrategy(action: AdvisorAction) {
    patchLifecycle(action.title, { status: "running", startedAt: Date.now() });
  }

  function handleResolveRecommendation(action: AdvisorAction) {
    patchLifecycle(action.title, { status: "completed", completedAt: Date.now() });
    setSelectedRecommendation(null);
  }

  function handleResetRecommendations() {
    setActionLifecycle({});
    if (typeof window !== "undefined") {
      localStorage.removeItem(ACTION_LIFECYCLE_KEY);
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
    <div className="space-y-6">
      <GlassCard className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Badge icon={Brain}>Gerente IA · Qué hacer hoy</Badge>
            <h2 className="mt-4 font-display text-xl font-semibold tracking-tight">
              {priorityAction ? "Recomendación prioritaria" : "Todo al día"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {priorityAction
                ? "La mayor oportunidad detectada hoy, elegida automáticamente por score de impacto."
                : "No hay oportunidades activas en este momento. Revisá una idea estratégica para seguir creciendo."}
            </p>
          </div>
          {priorityAction ? <ScoreChip score={priorityAction.score} /> : null}
        </div>

        {priorityAction ? (
          <div
            className={cn(
              "mt-5 rounded-3xl border p-5 transition-all duration-1000",
              priorityAction.status === "completed"
                ? "border-emerald-400/50 bg-emerald-400/[0.08] shadow-[0_0_55px_rgba(16,185,129,0.28)]"
                : "border-primary/40 bg-primary/[0.08] shadow-[0_0_45px_rgba(88,101,242,0.16)]",
            )}
            style={{
              opacity: shouldAnimateResults ? animationProgress : 1,
              transform: shouldAnimateResults
                ? `translateY(${Math.round((1 - animationProgress) * 10)}px)`
                : "translateY(0px)",
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="max-w-2xl">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "grid h-11 w-11 place-items-center rounded-2xl ring-1",
                      priorityAction.status === "completed"
                        ? "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30"
                        : "bg-white/10 text-white ring-white/15",
                    )}
                  >
                    {priorityAction.status === "completed" ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <priorityAction.icon className="h-5 w-5" />
                    )}
                  </span>
                  <div
                    className={cn(
                      "text-xs font-semibold uppercase tracking-[0.25em]",
                      priorityAction.status === "completed" ? "text-emerald-300" : "text-primary",
                    )}
                  >
                    {priorityAction.status === "completed"
                      ? "Objetivo logrado"
                      : "Prioridad actual"}
                  </div>
                </div>
                <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight text-white">
                  {priorityAction.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {priorityAction.detail}
                </p>
                <p className="mt-3 text-sm font-semibold text-emerald-300">
                  {priorityAction.impact}
                </p>
              </div>

              <ActionStatusButton
                action={priorityAction}
                size="lg"
                onStart={() => handleStartStrategy(priorityAction)}
                onOpen={() => setSelectedRecommendation(priorityAction)}
              />
            </div>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.8fr]">
            <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.06] p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">
                Sin urgencias
              </div>
              <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight text-white">
                Todo al día
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Las prioridades importantes ya fueron resueltas o no superan el impacto mínimo para
                mostrarse.
              </p>
              <button
                type="button"
                onClick={handleResetRecommendations}
                className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-white/[0.08] hover:text-white"
              >
                Recalcular prioridades demo
              </button>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                Idea estratégica
              </div>
              <h3 className="mt-3 font-display text-xl font-semibold tracking-tight text-white">
                {strategicIdea.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {strategicIdea.detail}
              </p>
              <p className="mt-3 text-xs font-semibold text-emerald-300">{strategicIdea.impact}</p>
            </div>
          </div>
        )}
      </GlassCard>

      {priorityAction && otherActions.length > 0 ? (
        <section className="space-y-4">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-white">
              Otras acciones recomendadas
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ordenadas automáticamente por score de impacto.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {otherActions.map((action) => (
              <ActionCard
                key={action.title}
                action={action}
                onStart={() => handleStartStrategy(action)}
                onOpen={() => setSelectedRecommendation(action)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {archivedActions.length > 0 ? (
        <AchievedHistory actions={archivedActions} now={now} onReset={handleResetRecommendations} />
      ) : null}

      <section className="grid gap-4">
        <GlassCard className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <Badge icon={HeartPulse}>Salud del negocio</Badge>
              <h2 className="mt-4 inline-flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
                <Heart className="h-5 w-5 text-rose-400" /> ¿Cómo está tu negocio hoy?
              </h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Análisis de los indicadores del período actual.
              </p>
            </div>

            <div className="text-right">
              <div
                className={cn(
                  "font-display text-6xl font-semibold tracking-tight",
                  healthTone.text,
                )}
              >
                {animatedHealth}
              </div>
              <div className="text-sm text-muted-foreground">Puntaje de salud</div>
              <div className={cn("mt-1 text-xs font-semibold", healthTone.text)}>
                {healthTone.label}
              </div>
              <p className="mt-1 max-w-[260px] text-right text-xs leading-relaxed text-muted-foreground">
                {healthTone.message}
              </p>
            </div>
          </div>

          <div className="mt-6 h-3 overflow-hidden rounded-full bg-white/10">
            <div
              className={cn("h-full rounded-full bg-gradient-to-r", healthTone.bar)}
              style={{ width: `${animatedHealth}%` }}
            />
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold">¿Qué impacta en tu puntaje?</div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <ReasonItem tone="good" text="Utilidad: +30%" />
              <ReasonItem tone="good" text="Ocupación: 62%" />
              <ReasonItem
                tone="warning"
                text={`${DEMO.freeSlotsMonth} espacios libres para completar`}
              />
              <ReasonItem tone="good" text="Captación de clientes: +16%" />
              <ReasonItem tone="warning" text={`${DEMO.inactiveClients} clientes para recuperar`} />
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <Badge icon={TrendingUp}>
                <button
                  type="button"
                  onClick={() => setInfoModal(INFO_CONTENT.growth)}
                  className="grid h-10 w-10 place-items-center rounded-full border border-primary/40 bg-primary/15 text-xs font-bold text-primary transition hover:bg-primary/25"
                  aria-label="Información de crecimiento"
                >
                  i
                </button>
              </Badge>
              <h2 className="mt-4 inline-flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
                <TrendingUp className="h-5 w-5 text-emerald-300" /> Evolución del negocio +18%
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Respecto al período anterior.</p>
            </div>

            <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-4 text-right">
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">
                UTILIDAD +30%
              </div>
              <div className="mt-2 font-display text-3xl font-semibold text-emerald-300">
                {fmtAR(animatedProfit)}
              </div>
            </div>
          </div>
          <div className="mt-6 grid max-w-4xl mx-auto gap-6 md:grid-cols-3">
            <GrowthMetric
              label="Clientes nuevos"
              value={`${Math.round(45 * animationProgress)}`}
              detail={`+16% vs mes anterior`}
              info={INFO_CONTENT.clients}
              onInfo={setInfoModal}
            />
            <GrowthMetric
              label="Ticket promedio"
              value={`+${fmtAR(Math.round((DEMO.ticket - DEMO.previousTicket) * animationProgress))}`}
              detail={`+10% vs mes anterior`}
              info={INFO_CONTENT.ticket}
              onInfo={setInfoModal}
            />
            <GrowthMetric
              label="Ocupación"
              value={`${Math.round(DEMO.occupancy * animationProgress)}%`}
              detail={`+8 puntos vs mes anterior`}
              info={INFO_CONTENT.occupancy}
              onInfo={setInfoModal}
            />
          </div>
        </GlassCard>
      </section>

      <GlassCard className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge icon={Sparkles}>Informe mensual automático</Badge>
            <h2 className="mt-4 font-display text-xl font-semibold tracking-tight">
              Historial de análisis
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Clippr guarda un informe al comenzar cada mes. No necesitás tocar ningún botón.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-muted-foreground">
            Próximo informe automático: <span className="font-semibold text-white">1 de julio</span>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {reports.map((report) => (
            <ReportCard key={report.month} report={report} />
          ))}

          <ReportPlaceholder month="Mayo 2026" />
          <ReportPlaceholder month="Abril 2026" />
        </div>
      </GlassCard>
      {selectedRecommendation ? (
        <RecommendationDetailModal
          action={selectedRecommendation}
          onClose={() => setSelectedRecommendation(null)}
          onResolve={() => handleResolveRecommendation(selectedRecommendation)}
        />
      ) : null}

      {infoModal ? <InfoModal content={infoModal} onClose={() => setInfoModal(null)} /> : null}
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
    <div className="grid min-h-[560px] place-items-center">
      <GlassCard className="w-full max-w-xl p-8 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-primary/10 ring-1 ring-primary/20">
          <Brain className="h-7 w-7 text-primary" />
        </div>
        <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">
          Asesor IA Clippr
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tu consultor virtual analiza utilidad, clientes, ocupación, caja y oportunidades para
          ayudarte a crecer.
        </p>

        <button
          type="button"
          onClick={onStart}
          className="mt-6 inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-primary to-accent px-5 text-sm font-semibold text-white shadow-[0_12px_28px_-14px_oklch(0.65_0.28_290/0.7)] transition hover:brightness-110"
        >
          Analizar negocio
        </button>
      </GlassCard>
    </div>
  );
}

function AnalysisLoader({ step }: { step: number }) {
  const steps = [
    "Revisando utilidad del mes...",
    "Analizando clientes activos...",
    "Detectando horarios libres...",
    "Buscando oportunidades de recuperación...",
    "Generando acciones recomendadas...",
  ];

  return (
    <div className="grid min-h-[560px] place-items-center">
      <GlassCard className="w-full max-w-xl p-8 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-primary/10 ring-1 ring-primary/20">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
        <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">
          Analizando tu negocio
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Clippr está leyendo caja, clientes, turnos y rendimiento.
        </p>

        <div className="mt-6 space-y-3 text-left">
          {steps.map((item, index) => (
            <div
              key={item}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"
            >
              {index < step ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : index === step ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-white/20" />
              )}
              <span className={index <= step ? "text-white" : "text-muted-foreground"}>{item}</span>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

type BaseAction = Omit<
  AdvisorAction,
  "icon" | "impactValue" | "score" | "status" | "startedAt" | "completedAt"
>;

function getDemoActions(showExtraRecommendation = false): AdvisorAction[] {
  const actions: BaseAction[] = [];

  if (DEMO.inactiveClients > 0) {
    actions.push({
      title: "Recuperar clientes",
      detail: `${DEMO.inactiveClients} clientes no volvieron hace más de 45 días.`,
      impact: `Impacto estimado: +${fmtAR(DEMO.inactiveClients * DEMO.ticket)}`,
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
        "Hola, Hace un tiempo que no te vemos. Esta semana tenemos un beneficio especial para que vuelvas a visitarnos. Respondé este mensaje y te ayudamos a reservar.",
      actionButtons: ["Ver clientes", "Enviar WhatsApp", "Crear promoción", "Marcar como resuelto"],
    });
  }

  if (DEMO.emptySlotsTomorrow > 0) {
    actions.push({
      title: "Llenar horarios libres",
      detail: `Mañana tenés ${DEMO.emptySlotsTomorrow} espacios vacíos.`,
      impact: `Impacto estimado: +${fmtAR(DEMO.emptySlotsTomorrow * DEMO.ticket)}`,
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
        "Hola, Tenemos algunos horarios disponibles para mañana y activamos un beneficio especial por tiempo limitado. ¿Querés que te reserve un lugar?",
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
        "Hola, Queríamos agradecerte por ser parte de nuestros clientes frecuentes. Esta semana tenemos un beneficio especial para vos. ¿Querés que te pasemos horarios disponibles?",
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
        "Hola, Te escribimos para confirmar tu turno. Respondé CONFIRMO para mantener la reserva o avisame si necesitás cambiar el horario.",
      actionButtons: [
        "Ver turnos",
        "Enviar recordatorio",
        "Confirmar seleccionados",
        "Marcar como resuelto",
      ],
    });
  }

  if (showExtraRecommendation) {
    actions.unshift({
      title: "Impulsar el día más flojo",
      detail: `${DEMO.lowDay.charAt(0).toUpperCase() + DEMO.lowDay.slice(1)} viene con menor ocupación que el resto de la semana.`,
      impact: `Potencial con 30% OFF: +${fmtAR(Math.round(8 * DEMO.ticket * 0.7))}`,
      button: "Empezar estrategia",
      tone: "growth",
      problem: `${DEMO.lowDay.charAt(0).toUpperCase() + DEMO.lowDay.slice(1)} tiene menor ocupación que el resto de la semana.`,
      opportunity: `Recuperar 8 espacios en el día de menor ocupación con una promoción de 30% OFF podría generar aproximadamente ${fmtAR(Math.round(8 * DEMO.ticket * 0.7))} de facturación mensual.`,
      howToAct: [
        "Crear una acción exclusiva para el día con menor ocupación.",
        "Ofrecer un beneficio por reservar en ese día.",
        "Enviar la propuesta a clientes activos.",
        "Medir si sube la ocupación de ese día en la semana siguiente.",
      ],
      suggestedMessage:
        "Hola, Tenemos algunos horarios disponibles para [día] y activamos un 30% OFF para quienes reserven ese día. Si te interesa, respondé este mensaje y te contamos los horarios disponibles.",
      actionButtons: ["Crear campaña", "Ver horarios", "Enviar WhatsApp", "Marcar como resuelto"],
    });
  }

  // Metadatos por recomendación: icono Lucide + peso base + impacto monetario
  // estimado. El score final combina el peso base con un boost proporcional al
  // impacto real, de modo que si cambian los datos del negocio, cambia el orden
  // (y por lo tanto el Hero) automáticamente.
  const META: Record<
    string,
    { icon: React.ComponentType<{ className?: string }>; base: number; impactValue: number }
  > = {
    "Recuperar clientes": {
      icon: Users,
      base: 90,
      impactValue: DEMO.inactiveClients * DEMO.ticket,
    },
    "Llenar horarios libres": {
      icon: CalendarDays,
      base: 84,
      impactValue: DEMO.emptySlotsTomorrow * DEMO.ticket,
    },
    "Aumentar facturación por cliente": {
      icon: DollarSign,
      base: 78,
      impactValue: DEMO.payments * 1000,
    },
    "Reactivar clientes VIP": {
      icon: Sparkles,
      base: 74,
      impactValue: DEMO.vipInactive * DEMO.ticket,
    },
    "Confirmar turnos": {
      icon: CheckCircle2,
      base: 64,
      impactValue: DEMO.unconfirmedAppointments * 5000,
    },
    "Impulsar el día más flojo": {
      icon: BadgePercent,
      base: 70,
      impactValue: Math.round(8 * DEMO.ticket * 0.7),
    },
  };

  const maxImpact = Math.max(1, ...actions.map((a) => META[a.title]?.impactValue ?? 0));

  return actions.map((a) => {
    const meta = META[a.title];
    const impactValue = meta?.impactValue ?? 0;
    const dataBoost = Math.round((impactValue / maxImpact) * 9);
    const score = Math.min(99, (meta?.base ?? 60) + dataBoost);
    return {
      ...a,
      icon: meta?.icon ?? Target,
      impactValue,
      score,
      status: "pending" as ActionStatus,
    };
  });
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
      text: "text-amber-300",
      bar: "from-amber-400 to-accent",
    };
  return {
    label: "Crítico",
    message: "Tu negocio necesita acciones urgentes para recuperar su rendimiento.",
    text: "text-red-400",
    bar: "from-red-500 to-amber-400",
  };
}

function GlassCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("glass rounded-3xl", className)}>{children}</div>;
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
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
      {tone === "good" ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
      )}
      <span className="text-muted-foreground">{text}</span>
    </div>
  );
}

function ScoreChip({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/10">
      <Sparkles className="h-3.5 w-3.5 text-primary" />
      Score {score}
    </span>
  );
}

function ActionStatusButton({
  action,
  size = "sm",
  onStart,
  onOpen,
}: {
  action: AdvisorAction;
  size?: "sm" | "lg";
  onStart: () => void;
  onOpen: () => void;
}) {
  const base =
    size === "lg"
      ? "inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition"
      : "inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition";

  if (action.status === "completed") {
    return (
      <span className={cn(base, "border border-emerald-400/40 bg-emerald-400/10 text-emerald-300")}>
        <CheckCircle2 className="h-4 w-4" />
        Objetivo logrado
      </span>
    );
  }

  if (action.status === "running") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          base,
          "border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Trabajando sobre esto
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onStart}
      className={cn(
        base,
        size === "lg"
          ? "bg-gradient-to-r from-primary to-accent text-white shadow-[0_12px_28px_-14px_oklch(0.65_0.28_290/0.7)] hover:brightness-110"
          : "border border-white/10 bg-white/[0.04] text-primary hover:bg-white/[0.08]",
      )}
    >
      Empezar estrategia
      <ArrowRight className="h-4 w-4" />
    </button>
  );
}

function ActionCard({
  action,
  onStart,
  onOpen,
}: {
  action: AdvisorAction;
  onStart: () => void;
  onOpen: () => void;
}) {
  const Icon = action.icon;
  const completed = action.status === "completed";
  return (
    <div
      className={cn(
        "flex min-h-[230px] flex-col rounded-2xl border bg-white/[0.03] p-4 transition-all",
        completed
          ? "border-emerald-400/40 shadow-[0_0_38px_rgba(16,185,129,0.22)]"
          : "border-white/10",
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <div
          className={cn(
            "grid h-9 w-9 place-items-center rounded-2xl ring-1",
            completed && "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
            !completed &&
              action.tone === "money" &&
              "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
            !completed &&
              action.tone === "warning" &&
              "bg-amber-400/10 text-amber-300 ring-amber-400/20",
            !completed && action.tone === "growth" && "bg-primary/10 text-primary ring-primary/20",
            !completed &&
              action.tone === "client" &&
              "bg-cyan-400/10 text-cyan-300 ring-cyan-400/20",
            !completed && action.tone === "neutral" && "bg-white/5 text-white ring-white/10",
          )}
        >
          {completed ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-bold text-white/80">
          <Sparkles className="h-3 w-3 text-primary" />
          {action.score}
        </span>
      </div>

      <div className="text-sm font-semibold">{action.title}</div>
      <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{action.detail}</div>
      <div className="mt-3 text-xs font-semibold text-emerald-300">{action.impact}</div>

      <div className="mt-auto pt-3">
        <ActionStatusButton action={action} onStart={onStart} onOpen={onOpen} />
      </div>
    </div>
  );
}

function AchievedHistory({
  actions,
  now,
  onReset,
}: {
  actions: AdvisorAction[];
  now: number;
  onReset: () => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 font-display text-xl font-semibold tracking-tight text-white">
            <Trophy className="h-5 w-5 text-amber-300" /> Historial de logros
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Recomendaciones completadas hace más de 3 días.
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-white/[0.08] hover:text-white"
        >
          Reiniciar demo
        </button>
      </div>

      <div className="grid gap-3">
        {actions.map((action) => {
          const days = action.completedAt
            ? Math.max(0, Math.floor((now - action.completedAt) / (24 * 60 * 60 * 1000)))
            : 0;
          return (
            <div
              key={action.title}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-white">{action.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {days === 0 ? "Logrado hoy" : `Hace ${days} ${days === 1 ? "día" : "días"}`}
                  </div>
                </div>
              </div>
              <div className="text-sm font-semibold text-emerald-300">{action.impact}</div>
            </div>
          );
        })}
      </div>
    </section>
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
              Recomendación IA
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
              Problema detectado
            </div>
            <p className="mt-2 text-sm leading-relaxed text-white">{action.problem}</p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
              Impacto estimado
            </div>
            <p className="mt-2 text-sm leading-relaxed text-white">{action.opportunity}</p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm font-semibold text-white">Cómo tomar acción</div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {action.howToAct.map((step) => (
              <div key={step} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm font-semibold text-white">Mensaje sugerido editable</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Adaptalo al tono de tu negocio. Sirve para WhatsApp, email o mensaje directo.
          </p>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="mt-3 min-h-[120px] w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none transition placeholder:text-muted-foreground focus:border-primary/50"
          />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onResolve}
            className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-400/20"
          >
            Marcar como resuelto
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoModal({ content, onClose }: { content: InfoModalContent; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-background p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
              Información
            </div>
            <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-white">
              {content.title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{content.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-white/[0.08] hover:text-white"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {content.points.map((point) => (
            <div
              key={point}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-muted-foreground"
            >
              {point}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportCard({
  report,
}: {
  report: { month: string; health: number; growth: number; profit: number; revenue: number };
}) {
  return (
    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
      <p className="text-sm font-semibold text-white">{report.month}</p>
      <p className="mt-1 text-xs text-muted-foreground">Informe automático guardado.</p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <span className="text-muted-foreground">Crecimiento</span>
        <span className="text-right font-semibold text-emerald-300">+{report.growth}%</span>
        <span className="text-muted-foreground">Salud</span>
        <span className="text-right font-semibold text-white">{report.health}/100</span>
        <span className="text-muted-foreground">Utilidad</span>
        <span className="text-right font-semibold text-white">{fmtAR(report.profit)}</span>
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
