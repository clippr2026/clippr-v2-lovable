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
  DollarSign,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronUp,
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
  impactAmount: string;
  impactExplanation: string;
  button: string;
  tone: ActionTone;
  problem: string;
  opportunity: string;
  howToAct: string[];
  suggestedMessage: string;
  actionButtons: string[];
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
  const [advisorTab, setAdvisorTab] = React.useState<"acciones" | "analisis" | "simuladores">("acciones");
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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Topbar title="Asesor IA" subtitle="Análisis diario y crecimiento del negocio" />
        {analysisStarted && !isAnalyzing && (
          <div className="flex items-center gap-2 shrink-0">
          {([
            { key: "acciones", label: "🎯 Acciones recomendadas" },
            { key: "analisis", label: "📊 Análisis" },
            { key: "simuladores", label: "💰 Simuladores" },
          ] as const).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setAdvisorTab(t.key)}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-semibold transition-all",
                advisorTab === t.key
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
              )}
            >
              {t.label}
            </button>
          ))}
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
  const [shouldAnimateResults, setShouldAnimateResults] = React.useState(false);
  const animationProgress = useResultAnimation(shouldAnimateResults);
  const [infoModal, setInfoModal] = React.useState<InfoModalContent | null>(null);
  const todayKey = getTodayKey();

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
    <div className="space-y-6">
      {advisorTab === "simuladores" && (
        <SimuladoresTab
          servicios={DEMO.payments}
          facturacion={DEMO.revenue}
          ticket={DEMO.ticket}
          clientes={DEMO.clients}
          ocupacion={DEMO.occupancy}
        />
      )}

      {advisorTab === "acciones" && (
        <PrioridadesTab
          actions={getDemoActions(showExtraRecommendation).slice(0, 3)}
          resolvedRecommendations={resolvedRecommendations}
          onResolve={handleResolveRecommendation}
          onReset={handleResetRecommendations}
        />
      )}

      {advisorTab === "analisis" && (<>
      <section className="grid gap-4">
        <GlassCard className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <Badge icon={HeartPulse}>Salud del negocio</Badge>
              <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">❤️ ¿Cómo está tu negocio hoy?</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">Análisis de los indicadores del período actual.</p>
            </div>

            <div className="text-right">
              <div className={cn("font-display text-6xl font-semibold tracking-tight", healthTone.text)}>{animatedHealth}</div>
              <div className="text-sm text-muted-foreground">Puntaje de salud</div>
              <div className={cn("mt-1 text-xs font-semibold", healthTone.text)}>{healthTone.label}</div>
              <p className="mt-1 max-w-[260px] text-right text-xs leading-relaxed text-muted-foreground">{healthTone.message}</p>
            </div>
          </div>

          <div className="mt-6 h-3 overflow-hidden rounded-full bg-white/10">
            <div className={cn("h-full rounded-full bg-gradient-to-r", healthTone.bar)} style={{ width: `${animatedHealth}%` }} />
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold">¿Qué impacta en tu puntaje?</div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <ReasonItem tone="good" text="Utilidad: +30%" />
              <ReasonItem tone="good" text="Captación de clientes: +16%" />
              <ReasonItem tone="good" text="Ocupación: 62%" />
              <ReasonItem tone="warning" text={`${DEMO.inactiveClients} clientes para recuperar`} />
              <ReasonItem tone="warning" text={`${DEMO.freeSlotsMonth} espacios libres para completar`} />
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
              <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">📈 Evolución del negocio +18%</h2>
              <p className="mt-1 text-sm text-muted-foreground">Respecto al período anterior.</p>
              
            </div>

            <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-4 text-right">
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">UTILIDAD +30%</div>
              <div className="mt-2 font-display text-3xl font-semibold text-emerald-300">{fmtAR(animatedProfit)}</div>
            </div>
          </div>
<div className="mt-6 grid max-w-4xl mx-auto gap-6 md:grid-cols-3">
<GrowthMetric label="Clientes nuevos" value={`${Math.round(45 * animationProgress)}`} detail={`+16% vs mes anterior`} info={INFO_CONTENT.clients} onInfo={setInfoModal} />
            <GrowthMetric label="Ticket promedio" value={`+${fmtAR(Math.round((DEMO.ticket - DEMO.previousTicket) * animationProgress))}`} detail={`+10% vs mes anterior`} info={INFO_CONTENT.ticket} onInfo={setInfoModal} />
            <GrowthMetric label="Ocupación" value={`${Math.round(DEMO.occupancy * animationProgress)}%`} detail={`+8 puntos vs mes anterior`} info={INFO_CONTENT.occupancy} onInfo={setInfoModal} />
          </div>
        </GlassCard>

      </section>


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

              </GlassCard>

      {infoModal ? (
        <InfoModal content={infoModal} onClose={() => setInfoModal(null)} />
      ) : null}
      </>)}
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
        <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">Asesor IA Clippr</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tu consultor virtual analiza utilidad, clientes, ocupación, caja y oportunidades para ayudarte a crecer.
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
      impactAmount: `+${fmtAR(DEMO.inactiveClients * DEMO.ticket)}`,
      impactExplanation: `Facturación recuperable si ${DEMO.inactiveClients} clientes inactivos vuelven al menos una vez. Basado en el ticket promedio actual de ${fmtAR(DEMO.ticket)}.`,
      button: "Tomar acción",
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
      button: "Tomar acción",
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
      actionButtons: ["Crear promoción", "Enviar WhatsApp", "Ver horarios libres", "Marcar como resuelto"],
    });
  }

  if (DEMO.payments > 0) {
    actions.push({
      title: "Aumentar facturación por cliente",
      detail: "El ticket promedio puede mejorar con servicios complementarios, productos o combos de mayor valor.",
      impact: `Potencial estimado: +${fmtAR(DEMO.payments * 1000)}`,
      impactAmount: `+${fmtAR(DEMO.payments * 1000)}`,
      impactExplanation: `Si agregás en promedio $1.000 por venta, sobre los ${DEMO.payments} servicios del período, podés generar este ingreso adicional sin necesidad de sumar nuevos clientes.`,
      button: "Tomar acción",
      tone: "money",
      problem: "Hay oportunidad de aumentar la facturación por cliente sin subir precios de forma directa.",
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
      button: "Tomar acción",
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
      actionButtons: ["Enviar WhatsApp", "Ver clientes VIP", "Crear beneficio", "Marcar como resuelto"],
    });
  }

  if (DEMO.unconfirmedAppointments > 0) {
    actions.push({
      title: "Confirmar turnos",
      detail: `${DEMO.unconfirmedAppointments} turnos todavía no están confirmados.`,
      impact: "Reduce ausencias y huecos de agenda.",
      impactAmount: `${DEMO.unconfirmedAppointments} turnos`,
      impactExplanation: `Confirmarlos reduce el riesgo de ausencias y turnos perdidos. Cada turno sin confirmar representa un posible hueco de ${fmtAR(DEMO.ticket)} que no podés reasignar a tiempo.`,
      button: "Tomar acción",
      tone: "neutral",
      problem: `${DEMO.unconfirmedAppointments} turnos todavía no están confirmados.`,
      opportunity: "Confirmarlos ayuda a reducir ausencias, cancelaciones de último momento y horarios perdidos.",
      howToAct: [
        "Enviar recordatorio automático o manual.",
        "Pedir confirmación con una respuesta simple.",
        "Liberar los turnos que no respondan dentro de un plazo definido.",
        "Registrar confirmados y pendientes para ordenar la agenda.",
      ],
      suggestedMessage:
        "Hola 👋 Te escribimos para confirmar tu turno. Respondé CONFIRMO para mantener la reserva o avisame si necesitás cambiar el horario.",
      actionButtons: ["Ver turnos", "Enviar recordatorio", "Confirmar seleccionados", "Marcar como resuelto"],
    });
  }

  if (showExtraRecommendation) {
    actions.unshift({
      title: "Impulsar el día más flojo",
      detail: `${DEMO.lowDay.charAt(0).toUpperCase() + DEMO.lowDay.slice(1)} viene con menor ocupación que el resto de la semana.`,
      impact: `Potencial con 30% OFF: +${fmtAR(Math.round(8 * DEMO.ticket * 0.7))}`,
      impactAmount: `+${fmtAR(Math.round(8 * DEMO.ticket * 0.7))} por mes`,
      impactExplanation: `Ingresos adicionales si completás 8 turnos vacíos los ${DEMO.lowDay}s con una promoción del 30% OFF. La diferencia de ocupación entre ese día y el promedio semanal indica una oportunidad concreta sin necesidad de nuevos clientes.`,
      button: "Tomar acción",
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
        "Hola 👋 Tenemos algunos horarios disponibles para [día] y activamos un 30% OFF para quienes reserven ese día. Si te interesa, respondé este mensaje y te contamos los horarios disponibles.",
      actionButtons: ["Crear campaña", "Ver horarios", "Enviar WhatsApp", "Marcar como resuelto"],
    });
  }

  return actions;
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
  if (health >= 85) return { label: "Excelente", message: "Tu negocio está funcionando muy bien. Mantené el ritmo actual.", text: "text-emerald-400", bar: "from-emerald-500 to-primary" };
  if (health >= 70) return { label: "Bueno", message: "Tu negocio está saludable, aunque todavía hay oportunidades de crecimiento.", text: "text-lime-300", bar: "from-lime-400 to-primary" };
  if (health >= 50) return { label: "Regular", message: "Hay indicadores que requieren atención para mejorar el rendimiento.", text: "text-amber-300", bar: "from-amber-400 to-accent" };
  return { label: "Crítico", message: "Tu negocio necesita acciones urgentes para recuperar su rendimiento.", text: "text-red-400", bar: "from-red-500 to-amber-400" };
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

function ActionCard({ action, onOpen }: { action: AdvisorAction; onOpen: () => void }) {
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
        <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">🎉 ¡Estás al día!</h2>
        <p className="mt-2 max-w-md mx-auto text-sm text-muted-foreground">
          No se detectaron nuevas acciones prioritarias para hoy. Tu negocio está funcionando correctamente según los indicadores actuales.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Volvé mañana para revisar nuevas oportunidades detectadas por la IA.</p>
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
    <div className="space-y-4">
      {/* Main card */}
      <GlassCard className="p-6 sm:p-8">
        {/* Header */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
            🎯 Prioridad detectada por IA
          </div>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white">{current.title}</h2>
        </div>

        {/* Oportunidad + Impacto */}
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">🔍 Oportunidad detectada</div>
            <p className="mt-3 text-sm leading-relaxed text-white">{current.problem}</p>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-5 flex flex-col justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">💰 Oportunidad económica</div>
            <div className="mt-3 font-display text-4xl font-semibold tracking-tight text-emerald-300 leading-none">
              {current.impactAmount}
            </div>
            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{current.impactExplanation}</p>
          </div>
        </div>

        {/* Cómo tomar acción */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="text-sm font-semibold text-white">✅ Cómo tomar acción</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {current.howToAct.map((step) => (
              <div key={step} className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span className="text-sm text-muted-foreground leading-relaxed">{step}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Mensaje sugerido */}
        <MessageSugeridoBlock suggestedMessage={current.suggestedMessage} />

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
  React.useEffect(() => { setMessage(suggestedMessage); }, [suggestedMessage]);

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
  React.useEffect(() => { setMessage(action.suggestedMessage); }, [action.suggestedMessage]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-background p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">🎯 Prioridad detectada por IA</div>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white">{action.title}</h2>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-white/[0.08] hover:text-white">
            Cerrar
          </button>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">🔍 Oportunidad detectada</div>
            <p className="mt-2 text-sm leading-relaxed text-white">{action.problem}</p>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">💰 Impacto estimado</div>
            <div className="mt-2 font-display text-2xl font-semibold text-emerald-300">{action.impact}</div>
            <p className="mt-1 text-xs text-muted-foreground">Basado en datos reales de los últimos 30 días.</p>
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
          <p className="mt-1 text-xs text-muted-foreground">Adaptalo al tono de tu negocio. Sirve para WhatsApp, email o mensaje directo.</p>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)}
            className="mt-3 min-h-[120px] w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none transition focus:border-primary/50" />
        </div>
        <div className="mt-5">
          <button type="button" onClick={onResolve}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-400/20">
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

// ─── SIMULADORES TAB ─────────────────────────────────────────────────────────

function SimuladoresTab(props: SimuladorProps) {
  const [sim, setSim] = React.useState<"precios" | "profesional">("precios");

  return (
    <div className="space-y-5">
      {/* Selector interno */}
      <div className="flex gap-2">
        {([
          { key: "precios", label: "💰 Simulador de precios" },
          { key: "profesional", label: "🧑‍💼 Sumar un profesional" },
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSim(t.key)}
            className={cn(
              "rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all",
              sim === t.key
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sim === "precios" && <SimuladorPrecios {...props} />}
      {sim === "profesional" && <SimuladorProfesional {...props} />}
    </div>
  );
}

// ─── SIMULADOR NUEVO PROFESIONAL ─────────────────────────────────────────────

type ProfSimResult = {
  nivel: "recomendado" | "evaluar" | "no_recomendado";
  titulo: string;
  resumen: string;
  breakdown: {
    ocupacion: string;
    demanda: string;
    retorno: string;
    plazo: string;
    riesgo: string;
    conclusion: string;
  };
};

function SimuladorProfesional({ servicios, facturacion, ticket, clientes, ocupacion }: SimuladorProps) {
  const [sueldoBase, setSueldoBase] = React.useState("");
  const [comision, setComision] = React.useState("50");
  const [simulado, setSimulado] = React.useState(false);
  const [loadingIA, setLoadingIA] = React.useState(false);
  const [resultado, setResultado] = React.useState<ProfSimResult | null>(null);
  const [showBreakdown, setShowBreakdown] = React.useState(false);

  const sueldoNum = Number(sueldoBase.replace(/\D/g, "")) || 0;
  const comisionNum = Math.min(100, Math.max(0, Number(comision) || 50));

  // Estimación: si agrego un profesional, ¿cuánto más podría generar?
  // Asume que puede atender ~80% de lo que atiende el promedio actual
  const serviciosPorProf = servicios > 0 ? servicios : 1;
  const serviciosNuevoProf = Math.round(serviciosPorProf * 0.8);
  const facturacionExtra = serviciosNuevoProf * ticket;
  const comisionExtra = (facturacionExtra * comisionNum) / 100;
  const costoTotal = sueldoNum + comisionExtra;
  const gananciaNetaEstimada = facturacionExtra - costoTotal;
  const roiMensual = costoTotal > 0 ? Math.round((gananciaNetaEstimada / costoTotal) * 100) : 0;
  const mesesRetorno = gananciaNetaEstimada > 0
    ? Math.ceil(costoTotal / gananciaNetaEstimada)
    : null;

  const SUELDO_PRESETS = [150000, 250000, 400000, 600000];
  const COMISION_PRESETS = [30, 40, 50, 60];

  async function calcular() {
    if (!sueldoNum) return;
    setSimulado(true);
    setLoadingIA(true);
    setResultado(null);
    setShowBreakdown(false);

    try {
      const prompt = `Sos el asesor financiero de un negocio de barbería/salón de belleza. Analizá si conviene contratar un nuevo profesional.

DATOS DEL NEGOCIO (último período):
- Servicios realizados: ${servicios}
- Facturación: $${fmtNum(facturacion)}
- Ticket promedio: $${fmtNum(ticket)}
- Clientes atendidos: ${clientes}
- Ocupación promedio: ${ocupacion}%

COSTO DEL NUEVO PROFESIONAL:
- Sueldo base mensual: $${fmtNum(sueldoNum)}
- Comisión: ${comisionNum}%
- Servicios estimados que podría atender: ${serviciosNuevoProf}
- Facturación extra estimada: $${fmtNum(facturacionExtra)}
- Costo total (sueldo + comisiones): $${fmtNum(costoTotal)}
- Ganancia neta estimada: $${fmtNum(gananciaNetaEstimada)}
- ROI mensual estimado: ${roiMensual}%

Reglas:
- Si ocupación >= 75% y ganancia neta > 0: nivel = "recomendado"
- Si ocupación entre 55-74% o ganancia neta marginal: nivel = "evaluar"
- Si ocupación < 55% o ganancia neta negativa: nivel = "no_recomendado"

Respondé SOLO con un JSON válido, sin markdown:
{"nivel":"recomendado","titulo":"texto corto","resumen":"2-3 oraciones con datos concretos","breakdown":{"ocupacion":"1 oración sobre la ocupación actual","demanda":"1 oración sobre si hay demanda suficiente para otro profesional","retorno":"1 oración sobre el ROI y retorno de la inversión","plazo":"1 oración sobre el plazo estimado de recupero","riesgo":"1 oración sobre el riesgo principal","conclusion":"1 oración de conclusión"}}`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const json = await res.json();
      const text = (json.content ?? []).map((b: { type: string; text?: string }) => b.type === "text" ? (b.text ?? "") : "").join("");
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean) as ProfSimResult;
      setResultado(parsed);
    } catch {
      const nivel: ProfSimResult["nivel"] = ocupacion >= 75 && gananciaNetaEstimada > 0
        ? "recomendado"
        : ocupacion >= 55
        ? "evaluar"
        : "no_recomendado";
      setResultado({
        nivel,
        titulo: nivel === "recomendado" ? "Alta ocupación, momento de crecer" : nivel === "evaluar" ? "Evaluar antes de contratar" : "Completar la agenda primero",
        resumen: nivel === "recomendado"
          ? `Tu ocupación del ${ocupacion}% indica que hay demanda para un nuevo profesional. Con ${serviciosNuevoProf} servicios estimados, la ganancia neta sería de $${fmtNum(gananciaNetaEstimada)} por mes.`
          : nivel === "evaluar"
          ? `Tu ocupación del ${ocupacion}% es moderada. Un nuevo profesional podría generar $${fmtNum(gananciaNetaEstimada)} netos, pero hay que asegurarse de tener la demanda antes de contratar.`
          : `Tu ocupación del ${ocupacion}% muestra que la agenda no está completa. Antes de sumar un profesional, trabajá en llenar los turnos actuales.`,
        breakdown: {
          ocupacion: `Ocupación actual: ${ocupacion}%. ${ocupacion >= 75 ? "Alta — hay demanda para otro profesional." : ocupacion >= 55 ? "Moderada — puede funcionar con captación activa." : "Baja — la agenda tiene mucha disponibilidad libre."}`,
          demanda: `Con ${servicios} servicios actuales, el nuevo profesional podría atender ~${serviciosNuevoProf} servicios por mes.`,
          retorno: `ROI mensual estimado: ${roiMensual}%. Facturación extra: $${fmtNum(facturacionExtra)}.`,
          plazo: mesesRetorno ? `El costo se recuperaría en aproximadamente ${mesesRetorno} mes${mesesRetorno > 1 ? "es" : ""}.` : "El costo no se recupera con los números actuales.",
          riesgo: "El riesgo principal es que el nuevo profesional no llegue a llenar su agenda desde el inicio.",
          conclusion: gananciaNetaEstimada > 0 ? `La incorporación generaría $${fmtNum(gananciaNetaEstimada)} de ganancia neta mensual.` : "Los costos superan la facturación estimada con la demanda actual.",
        },
      });
    } finally {
      setLoadingIA(false);
    }
  }

  const nivelMeta = {
    recomendado: { emoji: "🟢", label: "Recomendado", cls: "border-emerald-400/30 bg-emerald-400/[0.07]", titleCls: "text-emerald-300" },
    evaluar: { emoji: "🟡", label: "Evaluar", cls: "border-amber-400/30 bg-amber-400/[0.07]", titleCls: "text-amber-300" },
    no_recomendado: { emoji: "🔴", label: "No recomendado", cls: "border-rose-400/30 bg-rose-400/[0.07]", titleCls: "text-rose-300" },
  };

  return (
    <GlassCard className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge icon={TrendingUp}>Simulador de crecimiento</Badge>
          <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">🧑‍💼 ¿Conviene sumar un profesional?</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Calculá cuánto costaría contratar uno nuevo y si la demanda actual lo justifica.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {[
            { label: "Ocupación", value: `${ocupacion}%` },
            { label: "Ticket prom.", value: `$${fmtNum(ticket)}` },
            { label: "Servicios/mes", value: fmtNum(servicios) },
          ].map((d) => (
            <div key={d.label} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-center min-w-[90px]">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{d.label}</div>
              <div className="mt-1 text-sm font-semibold tabular-nums">{d.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Inputs */}
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-[0.18em]">Sueldo base mensual</p>
          <div className="flex flex-wrap gap-2">
            {SUELDO_PRESETS.map((p) => (
              <button key={p} type="button" onClick={() => setSueldoBase(String(p))}
                className={cn("rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all",
                  sueldoNum === p ? "border-primary/50 bg-primary/15 text-primary" : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground")}>
                ${fmtNum(p)}
              </button>
            ))}
          </div>
          <input type="text" inputMode="numeric" placeholder="Otro monto" value={sueldoBase}
            onChange={(e) => setSueldoBase(e.target.value.replace(/\D/g, ""))}
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm outline-none focus:border-primary/40 placeholder:text-muted-foreground/50" />
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-[0.18em]">Comisión sobre servicios</p>
          <div className="flex flex-wrap gap-2">
            {COMISION_PRESETS.map((p) => (
              <button key={p} type="button" onClick={() => setComision(String(p))}
                className={cn("rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all",
                  comisionNum === p ? "border-primary/50 bg-primary/15 text-primary" : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground")}>
                {p}%
              </button>
            ))}
          </div>
          <input type="text" inputMode="numeric" placeholder="Otra comisión %" value={comision}
            onChange={(e) => setComision(e.target.value.replace(/\D/g, ""))}
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm outline-none focus:border-primary/40 placeholder:text-muted-foreground/50" />
        </div>
      </div>

      <div className="mt-4">
        <button type="button" onClick={calcular} disabled={!sueldoNum || loadingIA}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40">
          {loadingIA ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Calcular
        </button>
      </div>

      {simulado && sueldoNum > 0 && (
        <div className="mt-6 space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-[0.18em]">Proyección mensual</p>

          {/* Números clave */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Servicios estimados", value: fmtNum(serviciosNuevoProf), sub: "del nuevo profesional", cls: "text-foreground" },
              { label: "Facturación extra", value: `+$${fmtNum(facturacionExtra)}`, sub: "ingresos adicionales", cls: "text-emerald-300" },
              { label: "Costo total", value: `-$${fmtNum(costoTotal)}`, sub: `sueldo + ${comisionNum}% comisión`, cls: "text-rose-300" },
              { label: "Ganancia neta", value: `${gananciaNetaEstimada >= 0 ? "+" : ""}$${fmtNum(gananciaNetaEstimada)}`, sub: "por mes estimada", cls: gananciaNetaEstimada >= 0 ? "text-emerald-300" : "text-rose-300" },
            ].map((m) => (
              <div key={m.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{m.label}</p>
                <p className={cn("mt-1.5 font-display text-xl font-semibold tabular-nums", m.cls)}>{m.value}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{m.sub}</p>
              </div>
            ))}
          </div>

          {/* Retorno */}
          <div className="rounded-2xl border border-primary/20 bg-primary/[0.06] p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/15 ring-1 ring-primary/20">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Punto de retorno</p>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                  {mesesRetorno
                    ? <>El costo del nuevo profesional se recuperaría en <span className="font-semibold text-white">{mesesRetorno} mes{mesesRetorno > 1 ? "es" : ""}</span> con una ganancia neta de <span className="font-semibold text-white">${fmtNum(gananciaNetaEstimada)}/mes</span>.</>
                    : <>Con los números actuales, el costo supera la facturación estimada. Conviene esperar a que la ocupación sea mayor.</>
                  }
                </p>
              </div>
            </div>
          </div>

          {/* IA */}
          {loadingIA ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
              <div>
                <p className="text-sm font-semibold">Analizando viabilidad…</p>
                <p className="text-xs text-muted-foreground mt-0.5">La IA está evaluando ocupación, demanda y ROI.</p>
              </div>
            </div>
          ) : resultado ? (
            <div className={cn("rounded-2xl border p-5 space-y-4", nivelMeta[resultado.nivel].cls)}>
              <div className="flex items-center gap-3">
                <span className="text-xl">{nivelMeta[resultado.nivel].emoji}</span>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Recomendación IA</p>
                  <p className={cn("text-base font-semibold", nivelMeta[resultado.nivel].titleCls)}>
                    {nivelMeta[resultado.nivel].label} — {resultado.titulo}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{resultado.resumen}</p>
              <button type="button" onClick={() => setShowBreakdown((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition">
                {showBreakdown ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {showBreakdown ? "Ocultar análisis" : "Ver análisis"}
              </button>
              {showBreakdown && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { label: "✅ Ocupación actual", value: resultado.breakdown.ocupacion },
                    { label: "✅ Demanda", value: resultado.breakdown.demanda },
                    { label: "✅ Retorno de inversión", value: resultado.breakdown.retorno },
                    { label: "✅ Plazo estimado", value: resultado.breakdown.plazo },
                    { label: "✅ Riesgo principal", value: resultado.breakdown.riesgo },
                    { label: "✅ Conclusión", value: resultado.breakdown.conclusion },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{item.label}</p>
                      <p className="mt-1.5 text-xs text-foreground leading-relaxed">{item.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </GlassCard>
  );
}

// ─── SIMULADOR DE PRECIOS ────────────────────────────────────────────────────

type SimuladorProps = {
  servicios: number;
  facturacion: number;
  ticket: number;
  clientes: number;
  ocupacion: number;
};

type IARecomendacion = {
  nivel: "recomendado" | "evaluar" | "no_recomendado";
  titulo: string;
  resumen: string;
  breakdown: {
    ocupacion: string;
    clientesNuevos: string;
    cancelaciones: string;
    horarios: string;
    disponibilidad: string;
    tendencia: string;
  };
};

const PRESETS = [500, 1000, 2000, 5000];

function fmtNum(n: number) {
  return n.toLocaleString("es-AR");
}

function SimuladorPrecios({ servicios, facturacion, ticket, clientes, ocupacion }: SimuladorProps) {
  const [aumento, setAumento] = React.useState("");
  const [simulado, setSimulado] = React.useState(false);
  const [loadingIA, setLoadingIA] = React.useState(false);
  const [recomendacion, setRecomendacion] = React.useState<IARecomendacion | null>(null);
  const [showBreakdown, setShowBreakdown] = React.useState(false);
  const aumentoNum = Math.max(0, Number(aumento.replace(/\D/g, "")) || 0);

  const conservador = Math.round(servicios * 0.9);
  const normal = servicios;
  const optimista = Math.round(servicios * 1.1);

  const impactoConservador = conservador * aumentoNum;
  const impactoNormal = normal * aumentoNum;
  const impactoOptimista = optimista * aumentoNum;

  const nuevoPrecioPromedio = ticket + aumentoNum;
  const serviciosEquilibrio = nuevoPrecioPromedio > 0 ? Math.floor(facturacion / nuevoPrecioPromedio) : servicios;
  const serviciosPerdibles = Math.max(0, servicios - serviciosEquilibrio);
  const pctPerdible = servicios > 0 ? ((serviciosPerdibles / servicios) * 100).toFixed(1) : "0";

  async function calcular() {
    if (!aumentoNum) return;
    setSimulado(true);
    setLoadingIA(true);
    setRecomendacion(null);
    setShowBreakdown(false);

    try {
      const prompt = `Sos el asesor financiero de un negocio de barbería/salón de belleza. Analizá si conviene aumentar el precio promedio de los servicios.

DATOS DEL NEGOCIO (último período):
- Servicios realizados: ${servicios}
- Facturación: $${fmtNum(facturacion)}
- Ticket promedio: $${fmtNum(ticket)}
- Clientes atendidos: ${clientes}
- Ocupación promedio: ${ocupacion}%
- Aumento propuesto por servicio: $${fmtNum(aumentoNum)}
- Nuevo ticket promedio estimado: $${fmtNum(nuevoPrecioPromedio)}
- Punto de equilibrio: pueden perder hasta ${serviciosPerdibles} servicios (${pctPerdible}%) y mantener la misma facturación

Reglas de nivel:
- Si ocupación >= 80%: nivel = "recomendado"
- Si ocupación entre 60-79%: nivel = "evaluar"
- Si ocupación < 60%: nivel = "no_recomendado"

Respondé SOLO con un JSON válido, sin markdown ni texto extra, con esta estructura:
{"nivel":"recomendado","titulo":"texto corto","resumen":"2-3 oraciones con datos concretos","breakdown":{"ocupacion":"1 oración","clientesNuevos":"1 oración","cancelaciones":"1 oración","horarios":"1 oración","disponibilidad":"1 oración","tendencia":"1 oración"}}`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const json = await res.json();
      const text = (json.content ?? []).map((b: { type: string; text?: string }) => b.type === "text" ? (b.text ?? "") : "").join("");
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean) as IARecomendacion;
      setRecomendacion(parsed);
    } catch {
      const nivel: IARecomendacion["nivel"] = ocupacion >= 80 ? "recomendado" : ocupacion >= 60 ? "evaluar" : "no_recomendado";
      setRecomendacion({
        nivel,
        titulo: nivel === "recomendado" ? "Alta ocupación, momento ideal" : nivel === "evaluar" ? "Evaluar con cuidado" : "Priorizar captación primero",
        resumen: nivel === "recomendado"
          ? `Tu ocupación del ${ocupacion}% es alta. La demanda sostiene la agenda y un aumento de $${fmtNum(aumentoNum)} mejoraría la rentabilidad sin afectar significativamente la demanda.`
          : nivel === "evaluar"
          ? `Tu ocupación del ${ocupacion}% es moderada. El aumento puede funcionar si se comunica bien, pero conviene monitorear la respuesta de los clientes.`
          : `Tu ocupación del ${ocupacion}% muestra capacidad libre. Antes de subir precios, trabajá en llenar la agenda para maximizar el impacto.`,
        breakdown: {
          ocupacion: `Ocupación actual: ${ocupacion}%. ${ocupacion >= 80 ? "La agenda está casi completa." : ocupacion >= 60 ? "Hay margen de mejora." : "Existe capacidad sin utilizar."}`,
          clientesNuevos: `${clientes} clientes atendidos en el período analizado.`,
          cancelaciones: "Riesgo bajo si el aumento es gradual y comunicado con anticipación.",
          horarios: ocupacion >= 80 ? "La mayoría de los turnos están ocupados." : "Existen franjas horarias disponibles.",
          disponibilidad: `Capacidad libre estimada: ${Math.round((1 - ocupacion / 100) * 100)}% de los turnos.`,
          tendencia: "Tendencia estable según los datos del período.",
        },
      });
    } finally {
      setLoadingIA(false);
    }
  }

  const nivelMeta = {
    recomendado: { emoji: "🟢", label: "Recomendado", cls: "border-emerald-400/30 bg-emerald-400/[0.07]", titleCls: "text-emerald-300" },
    evaluar: { emoji: "🟡", label: "Evaluar", cls: "border-amber-400/30 bg-amber-400/[0.07]", titleCls: "text-amber-300" },
    no_recomendado: { emoji: "🔴", label: "No recomendado", cls: "border-rose-400/30 bg-rose-400/[0.07]", titleCls: "text-rose-300" },
  };

  return (
    <GlassCard className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge icon={DollarSign}>Simulador de precios</Badge>
          <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">💰 ¿Conviene subir los precios?</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Simulá un aumento y recibí una recomendación basada en los datos reales de tu negocio.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {[
            { label: "Servicios", value: fmtNum(servicios) },
            { label: "Facturación", value: `$${fmtNum(facturacion)}` },
            { label: "Ticket prom.", value: `$${fmtNum(ticket)}` },
          ].map((d) => (
            <div key={d.label} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-center min-w-[90px]">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{d.label}</div>
              <div className="mt-1 text-sm font-semibold tabular-nums">{d.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-[0.18em]">¿Cuánto querés aumentar el precio promedio?</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => setAumento(String(p))}
              className={cn("rounded-xl border px-4 py-2 text-sm font-semibold transition-all",
                aumentoNum === p ? "border-primary/50 bg-primary/15 text-primary" : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground")}>
              +${fmtNum(p)}
            </button>
          ))}
          <input type="text" inputMode="numeric" placeholder="Otro monto" value={aumento}
            onChange={(e) => setAumento(e.target.value.replace(/\D/g, ""))}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm outline-none focus:border-primary/40 w-36 placeholder:text-muted-foreground/50" />
          <button type="button" onClick={calcular} disabled={!aumentoNum || loadingIA}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40">
            {loadingIA ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Calcular
          </button>
        </div>
      </div>

      {simulado && aumentoNum > 0 && (
        <div className="mt-6 space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-[0.18em]">Escenarios</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Conservador", emoji: "🔴", serviciosN: conservador, impacto: impactoConservador, desc: "si baja un 10% la demanda", cls: "border-rose-400/20 bg-rose-400/[0.05]", val: "text-rose-300" },
              { label: "Normal",      emoji: "🟡", serviciosN: normal,      impacto: impactoNormal,      desc: "si la demanda se mantiene igual",   cls: "border-amber-400/20 bg-amber-400/[0.05]", val: "text-amber-300" },
              { label: "Optimista",   emoji: "🟢", serviciosN: optimista,   impacto: impactoOptimista,   desc: "si sube un 10% la demanda",cls: "border-emerald-400/20 bg-emerald-400/[0.05]", val: "text-emerald-300" },
            ].map((sc) => (
              <div key={sc.label} className={cn("rounded-2xl border p-4", sc.cls)}>
                <div className="flex items-center gap-2">
                  <span className="text-base">{sc.emoji}</span>
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{sc.label}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{fmtNum(sc.serviciosN)} servicios × ${fmtNum(aumentoNum)}</p>
                <p className={cn("mt-1.5 font-display text-2xl font-semibold tabular-nums", sc.val)}>+${fmtNum(sc.impacto)}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">por mes · {sc.desc}</p>
                <div className="mt-3 border-t border-white/[0.06] pt-2.5">
                  <p className="text-[10px] text-muted-foreground">Impacto anual estimado</p>
                  <p className={cn("text-sm font-semibold tabular-nums", sc.val)}>+${fmtNum(sc.impacto * 12)}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-primary/20 bg-primary/[0.06] p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/15 ring-1 ring-primary/20">
                <Minus className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Punto de equilibrio</p>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                  Con este aumento podés perder hasta{" "}
                  <span className="font-semibold text-white">{fmtNum(serviciosPerdibles)} servicios por mes ({pctPerdible}%)</span>{" "}
                  y seguir manteniendo tu facturación actual de{" "}
                  <span className="font-semibold text-white">${fmtNum(facturacion)}</span>.
                </p>
              </div>
            </div>
          </div>

          {loadingIA ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
              <div>
                <p className="text-sm font-semibold">Analizando datos del negocio…</p>
                <p className="text-xs text-muted-foreground mt-0.5">La IA está evaluando ocupación, tendencia y demanda.</p>
              </div>
            </div>
          ) : recomendacion ? (
            <div className={cn("rounded-2xl border p-5 space-y-4", nivelMeta[recomendacion.nivel].cls)}>
              <div className="flex items-center gap-3">
                <span className="text-xl">{nivelMeta[recomendacion.nivel].emoji}</span>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Recomendación IA</p>
                  <p className={cn("text-base font-semibold", nivelMeta[recomendacion.nivel].titleCls)}>
                    {nivelMeta[recomendacion.nivel].label} — {recomendacion.titulo}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{recomendacion.resumen}</p>
              <button type="button" onClick={() => setShowBreakdown((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition">
                {showBreakdown ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {showBreakdown ? "Ocultar análisis" : "Ver análisis"}
              </button>
              {showBreakdown && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { label: "✅ Ocupación",            value: recomendacion.breakdown.ocupacion },
                    { label: "✅ Clientes nuevos",       value: recomendacion.breakdown.clientesNuevos },
                    { label: "✅ Cancelaciones",         value: recomendacion.breakdown.cancelaciones },
                    { label: "✅ Horarios completos",    value: recomendacion.breakdown.horarios },
                    { label: "✅ Disponibilidad restante", value: recomendacion.breakdown.disponibilidad },
                    { label: "✅ Tendencia de demanda",  value: recomendacion.breakdown.tendencia },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{item.label}</p>
                      <p className="mt-1.5 text-xs text-foreground leading-relaxed">{item.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </GlassCard>
  );
}
