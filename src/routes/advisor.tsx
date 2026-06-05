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
  BarChart3,
  Bell,
  Brain,
  CheckCircle2,
  ClipboardList,
  HeartPulse,
  Loader2,
  MessageCircle,
  Sparkles,
  Target,
  TrendingUp,
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
  title: string;
  detail: string;
  impact: string;
  button: string;
  tone: ActionTone;
};


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
  const animationProgress = useResultAnimation();
  const [infoModal, setInfoModal] = React.useState<InfoModalContent | null>(null);
  const todayKey = getTodayKey();
  const needsDailyAnalysis = React.useMemo(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("clippr_advisor_last_daily_analysis") !== todayKey;
  }, [todayKey]);

  const [analysisStarted, setAnalysisStarted] = React.useState(() => !needsDailyAnalysis);
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);

  const [analysisStep, setAnalysisStep] = React.useState(0);
  const [reports, setReports] = React.useState<Array<{ month: string; health: number; growth: number; profit: number; revenue: number }>>(() => {
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

  const [hasNewRecommendation, setHasNewRecommendation] = React.useState(true);
  const [isUpdatingRecommendation, setIsUpdatingRecommendation] = React.useState(false);
  const [showExtraRecommendation, setShowExtraRecommendation] = React.useState(false);

  const actions = getDemoActions(showExtraRecommendation);
  const healthTone = getHealthTone(DEMO.health);

  function handleAnalyzeNewRecommendation() {
    setIsUpdatingRecommendation(true);

    window.setTimeout(() => {
      setShowExtraRecommendation(true);
      setHasNewRecommendation(false);
      setIsUpdatingRecommendation(false);
    }, 1200);
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
      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
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
              <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">📈 Evolución del negocio +18%</h2>
              <p className="mt-1 text-sm text-muted-foreground">Respecto al período anterior.</p>
              
            </div>

            <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-4 text-right">
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">UTILIDAD +30%</div>
              <div className="mt-2 font-display text-3xl font-semibold text-emerald-300">{fmtAR(DEMO.profit)}</div>
            </div>
          </div>
<div className="mt-6 grid max-w-4xl mx-auto gap-6 md:grid-cols-3">
<GrowthMetric label="Clientes nuevos" value={`+${Math.round(percent(DEMO.clients, DEMO.previousClients) * animationProgress)}%`} detail={`45 vs 39 clientes`} info={INFO_CONTENT.clients} onInfo={setInfoModal} />
            <GrowthMetric label="Ticket promedio" value={`+${fmtAR(Math.round((DEMO.ticket - DEMO.previousTicket) * animationProgress))}`} detail={`+10% vs mes anterior`} info={INFO_CONTENT.ticket} onInfo={setInfoModal} />
            <GrowthMetric label="Ocupación" value={`${Math.round(DEMO.occupancy * animationProgress)}%`} detail={`+8 puntos vs mes anterior`} info={INFO_CONTENT.occupancy} onInfo={setInfoModal} />
          </div>
        </GlassCard>

        <GlassCard className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <Badge icon={HeartPulse}>Salud del negocio</Badge>
              <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">❤️ ¿Cómo está tu negocio hoy?</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">Análisis de los indicadores del período actual.</p>
            </div>

            <div className="text-right">
              <div className={cn("font-display text-6xl font-semibold tracking-tight", healthTone.text)}>{DEMO.health}</div>
              <div className="text-sm text-muted-foreground">Puntaje de salud</div>
              <div className={cn("mt-1 text-xs font-semibold", healthTone.text)}>{healthTone.label}</div>
            </div>
          </div>

          <div className="mt-6 h-3 overflow-hidden rounded-full bg-white/10">
            <div className={cn("h-full rounded-full bg-gradient-to-r", healthTone.bar)} style={{ width: `${DEMO.health}%` }} />
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold">¿Qué impacta en tu puntaje?</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <ReasonItem tone="good" text={`Utilidad positiva: ${fmtAR(DEMO.profit)}`} />
              <ReasonItem tone="good" text={`${DEMO.clients} clientes atendidos este mes`} />
              <ReasonItem tone="good" text="Captación de clientes: +16%" />
              <ReasonItem tone="warning" text={`${DEMO.freeSlotsMonth} espacios libres para completar`} />
              <ReasonItem tone="warning" text={`${DEMO.inactiveClients} clientes para recuperar`} />
            </div>
          </div>
        </GlassCard>
      </section>

      {hasNewRecommendation ? (
        <GlassCard className="border border-primary/20 bg-primary/[0.04] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
                <Bell className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">Tenés una recomendación nueva</h2>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  Clippr detectó una oportunidad que puede mejorar la ocupación y la utilidad del negocio.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleAnalyzeNewRecommendation}
              disabled={isUpdatingRecommendation}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-accent px-4 text-sm font-semibold text-white shadow-[0_12px_28px_-14px_oklch(0.65_0.28_290/0.7)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isUpdatingRecommendation ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analizando...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Analizar recomendación
                </>
              )}
            </button>
          </div>
        </GlassCard>
      ) : null}

      <GlassCard className="p-5 sm:p-6">
        <div>
          <Badge icon={Target}>Qué hacer hoy</Badge>
          <h2 className="mt-4 font-display text-xl font-semibold tracking-tight">Prioridades de hoy</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Clippr muestra solo las acciones importantes detectadas hoy. Si hay una sola, muestra una sola.
          </p>
        </div>

        {actions.length > 0 ? (
          <div className={cn(
            "mt-5 grid gap-3",
            actions.length === 1 && "xl:grid-cols-1",
            actions.length === 2 && "xl:grid-cols-2",
            actions.length === 3 && "xl:grid-cols-3",
            actions.length === 4 && "xl:grid-cols-4",
            actions.length >= 5 && "xl:grid-cols-5",
          )}>
            {actions.map((action) => (
              <ActionCard key={action.title} action={action} />
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-muted-foreground">
            No hay acciones urgentes para hoy. El negocio viene estable.
          </div>
        )}
      </GlassCard>

      <GlassCard className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge icon={Sparkles}>Informe mensual automático</Badge>
            <h2 className="mt-4 font-display text-xl font-semibold tracking-tight">Historial de análisis</h2>
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

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <MonthlyBlock
            title="Resumen ejecutivo"
            items={[
              `Facturación acumulada: ${fmtAR(DEMO.revenue)}`,
              `Utilidad estimada: ${fmtAR(DEMO.profit)}`,
              `Crecimiento vs ${DEMO.previousMonth}: +${DEMO.growth}%`,
            ]}
          />
          <MonthlyBlock
            title="Lo mejor"
            items={[
              `${DEMO.payments} cobros registrados`,
              `Ticket promedio de ${fmtAR(DEMO.ticket)}`,
              `${DEMO.activeClients} clientes activos`,
            ]}
          />
          <MonthlyBlock
            title="A mejorar"
            items={[
              `Completar ${DEMO.freeSlotsMonth} espacios libres`,
              `Recuperar ${DEMO.inactiveClients} clientes inactivos`,
              "Subir ticket promedio con productos o combos",
            ]}
          />
        </div>
      </GlassCard>
      {infoModal ? (
        <InfoModal content={infoModal} onClose={() => setInfoModal(null)} />
      ) : null}
    </div>
  );
}


function useResultAnimation() {
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    let frame = 0;
    const duration = 1000;
    const startedAt = performance.now();

    function animate(now: number) {
      const raw = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - raw, 3);
      setProgress(eased);

      if (raw < 1) {
        frame = window.requestAnimationFrame(animate);
      }
    }

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return progress;
}

function StartAnalysis({ onStart }: { onStart: () => void }) {
  return (
    <div className="grid min-h-[560px] place-items-center">
      <GlassCard className="w-full max-w-xl p-8 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-primary/10 ring-1 ring-primary/20">
          <Brain className="h-7 w-7 text-primary" />
        </div>
        <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">Asesor IA Clippr</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tu consultor virtual analiza utilidad, clientes, ocupación, caja y oportunidades para ayudarte a crecer.
        </p>

        <button
          type="button"
          onClick={onStart}
          className="mt-6 inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-primary to-accent px-5 text-sm font-semibold text-white shadow-[0_12px_28px_-14px_oklch(0.65_0.28_290/0.7)] transition hover:brightness-110"
        >
          Generar análisis de hoy
        </button>

        <p className="mt-4 text-xs text-muted-foreground">
          Se genera una vez por día. Si volvés a entrar hoy, el informe se muestra directo.
        </p>
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
        <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">Analizando tu negocio</h2>
        <p className="mt-2 text-sm text-muted-foreground">Clippr está leyendo caja, clientes, turnos y rendimiento.</p>

        <div className="mt-6 space-y-3 text-left">
          {steps.map((item, index) => (
            <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
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

function getDemoActions(showExtraRecommendation = false): AdvisorAction[] {
  const actions: AdvisorAction[] = [];

  if (DEMO.inactiveClients > 0) {
    actions.push({
      title: "Recuperar clientes",
      detail: `${DEMO.inactiveClients} clientes no volvieron hace más de 45 días.`,
      impact: `Impacto estimado: +${fmtAR(DEMO.inactiveClients * DEMO.ticket)}`,
      button: "Ver clientes",
      tone: "client",
    });
  }

  if (DEMO.emptySlotsTomorrow > 0) {
    actions.push({
      title: "Llenar horarios libres",
      detail: `Mañana tenés ${DEMO.emptySlotsTomorrow} espacios vacíos.`,
      impact: `Impacto estimado: +${fmtAR(DEMO.emptySlotsTomorrow * DEMO.ticket)}`,
      button: "Crear promoción",
      tone: "warning",
    });
  }

  if (DEMO.payments > 0) {
    actions.push({
      title: "Subir ticket promedio",
      detail: "Sumar $1.000 por cobro mejora la utilidad mensual.",
      impact: `Potencial: +${fmtAR(DEMO.payments * 1000)}`,
      button: "Ver simulación",
      tone: "money",
    });
  }

  if (DEMO.vipInactive > 0) {
    actions.push({
      title: "Reactivar clientes VIP",
      detail: `${DEMO.vipInactive} clientes VIP no visitan hace 30 días.`,
      impact: `Impacto estimado: +${fmtAR(DEMO.vipInactive * DEMO.ticket)}`,
      button: "Enviar WhatsApp",
      tone: "growth",
    });
  }

  if (DEMO.unconfirmedAppointments > 0) {
    actions.push({
      title: "Confirmar turnos",
      detail: `${DEMO.unconfirmedAppointments} turnos todavía no están confirmados.`,
      impact: "Reduce ausencias y huecos de agenda.",
      button: "Ver turnos",
      tone: "neutral",
    });
  }

  if (showExtraRecommendation) {
    actions.unshift({
      title: "Impulsar el día más flojo",
      detail: `${DEMO.lowDay.charAt(0).toUpperCase() + DEMO.lowDay.slice(1)} viene con menor ocupación que el resto de la semana.`,
      impact: `Potencial estimado: +${fmtAR(8 * DEMO.ticket)}`,
      button: "Crear campaña",
      tone: "growth",
    });
  }

  return actions;
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
  if (health >= 85) return { label: "Excelente", text: "text-emerald-400", bar: "from-emerald-500 to-primary" };
  if (health >= 70) return { label: "Bueno", text: "text-lime-300", bar: "from-lime-400 to-primary" };
  if (health >= 50) return { label: "Regular", text: "text-amber-300", bar: "from-amber-400 to-accent" };
  return { label: "Requiere atención", text: "text-red-400", bar: "from-red-500 to-amber-400" };
}

function GlassCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("glass rounded-3xl", className)}>{children}</div>;
}

function Badge({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
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
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      )}
      <span className="text-muted-foreground">{text}</span>
    </div>
  );
}

function ActionCard({ action }: { action: AdvisorAction }) {
  return (
    <div className="flex min-h-[220px] flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div
        className={cn(
          "mb-4 grid h-9 w-9 place-items-center rounded-2xl ring-1",
          action.tone === "money" && "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
          action.tone === "warning" && "bg-amber-400/10 text-amber-300 ring-amber-400/20",
          action.tone === "growth" && "bg-primary/10 text-primary ring-primary/20",
          action.tone === "client" && "bg-cyan-400/10 text-cyan-300 ring-cyan-400/20",
          action.tone === "neutral" && "bg-white/5 text-white ring-white/10",
        )}
      >
        {action.tone === "client" ? <MessageCircle className="h-4 w-4" /> : <Target className="h-4 w-4" />}
      </div>

      <div className="text-sm font-semibold">{action.title}</div>
      <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{action.detail}</div>
      <div className="mt-3 text-xs font-semibold text-emerald-300">{action.impact}</div>

      <button
        type="button"
        className="mt-auto rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-primary transition hover:bg-white/[0.08]"
      >
        {action.button}
      </button>
    </div>
  );
}

function InfoModal({ content, onClose }: { content: InfoModalContent; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-background p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">Información</div>
            <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-white">{content.title}</h2>
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
            <div key={point} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-muted-foreground">
              {point}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportCard({ report }: { report: { month: string; health: number; growth: number; profit: number; revenue: number } }) {
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
      <p className="mt-4 text-xs text-muted-foreground">Se va a crear automáticamente cuando corresponda.</p>
    </div>
  );
}

function MonthlyBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <BarChart3 className="h-4 w-4 text-primary" />
        {title}
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item} className="text-sm text-muted-foreground">• {item}</div>
        ))}
      </div>
    </div>
  );
}
