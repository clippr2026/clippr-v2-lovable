import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import { useAuth } from "@/hooks/use-auth";
import { AccessDenied, usePermGuard } from "@/hooks/use-perm-guard";
import { fmtAR } from "@/components/dashboard/use-dashboard-data";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle,
  Bell,
  Brain,
  BarChart2,
  CheckCircle2,
  ClipboardList,
  HeartPulse,
  Loader2,
  MessageCircle,
  Sparkles,
  Target,
  TrendingUp,
  Users,
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
  occupancyOptions?: { label: string; emoji: string; recommended?: boolean; discount?: number; message?: string }[];
};


type InfoModalContent = {
  title: string;
  description: string;
  points: string[];
};

const INFO_CONTENT = {
  growth: {
    title: "Evolución del negocio",
    description: "Mide cómo evolucionó la utilidad del negocio frente al mes anterior — tanto mejoras como caídas.",
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

function AdvisorRoute() {
  const hasAccess = usePermGuard("dashboard");
  const { loading, session } = useAuth();
  const navigate = useNavigate();
  const [advisorTab, setAdvisorTab] = React.useState<"acciones" | "analisis" | "simuladores">("analisis");
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
            { key: "analisis", label: "📊 Análisis" },
            { key: "acciones", label: "🎯 Acciones recomendadas" },
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
  const { businessId } = useAuth();
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
    <div className="space-y-10">
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

      {advisorTab === "acciones" && (
        <PrioridadesTab
          actions={getDemoActions(showExtraRecommendation).slice(0, 3)}
          resolvedRecommendations={resolvedRecommendations}
          onResolve={handleResolveRecommendation}
          onReset={handleResetRecommendations}
        />
      )}

      {advisorTab === "analisis" && (<>

      {/* ── SALUD DEL NEGOCIO ─────────────────────────────────── */}
      <div>
        {/* Separador de sección */}
        <div className="flex items-center gap-4 mb-6">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-muted-foreground/60">Salud del negocio</span>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        </div>
      <GlassCard className="p-7 sm:p-10 border border-white/[0.07]">
        <h2 className="font-display text-3xl font-bold tracking-tight mb-1">❤️ ¿Cómo está tu negocio hoy?</h2>
        <p className="text-sm text-muted-foreground mb-8">Análisis de los indicadores del período actual.</p>

        <div className="grid md:grid-cols-2 gap-6 items-center">
          {/* Left: circular gauge + bar */}
          <div className="flex flex-col items-center gap-6">
            <div className="relative flex items-center justify-center">
              {/* SVG ring */}
              <svg width="200" height="200" viewBox="0 0 200 200" className="-rotate-90">
                {/* Track */}
                <circle cx="100" cy="100" r="84" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="14" />
                {/* Progress */}
                <circle
                  cx="100" cy="100" r="84" fill="none"
                  stroke="url(#healthGrad)" strokeWidth="14"
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
                <span className={cn("font-display text-6xl font-bold leading-none", healthTone.text)}>{animatedHealth}</span>
                <span className="text-sm text-muted-foreground mt-1">/100</span>
              </div>
            </div>
            {/* Info below circle */}
            <div className="text-center">
              <div className="text-sm text-muted-foreground">Puntaje de salud</div>
              <div className={cn("mt-1 text-xl font-bold", healthTone.text)}>{healthTone.label}</div>
              <p className="mt-2 text-xs text-muted-foreground max-w-[220px] leading-relaxed">{healthTone.message}</p>
            </div>
            {/* Progress bar */}
            <div className="w-full h-2.5 overflow-hidden rounded-full bg-white/10">
              <div className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700", healthTone.bar)} style={{ width: `${animatedHealth}%` }} />
            </div>
          </div>

          {/* Right: impact panel */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 h-full">
            <div className="text-base font-semibold mb-5">¿Qué impacta en tu puntaje?</div>
            <div className="space-y-4">
              {[
                { tone: "good" as const, label: "Utilidad",             value: "+30%" },
                { tone: "good" as const, label: "Captación de clientes", value: "+16%" },
                { tone: "good" as const, label: "Ocupación",            value: "62%"  },
                { tone: "warning" as const, label: `${DEMO.inactiveClients} clientes para recuperar`, value: "" },
                { tone: "warning" as const, label: "144 turnos disponibles sin ocupar", value: "" },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {item.tone === "good"
                      ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                      : <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />}
                    <span className="text-sm text-muted-foreground">{item.label}</span>
                  </div>
                  {item.value && (
                    <span className={cn("text-sm font-bold", item.tone === "good" ? "text-emerald-300" : "text-amber-300")}>
                      {item.value}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </GlassCard>
      </div>{/* /Salud */}

      {/* ── EVOLUCIÓN DEL NEGOCIO ─────────────────────────────── */}
      <div>
        <div className="flex items-center gap-4 mb-6">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-muted-foreground/60">Evolución del negocio</span>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        </div>
      <GlassCard className="p-7 sm:p-10 space-y-8 border border-white/[0.07]">
        <h2 className="font-display text-3xl font-bold tracking-tight">📈 Evolución del negocio</h2>

        {/* Bloque superior: +18% */}
        <div className="relative flex items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-5">
          {/* Icono izquierda */}
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-emerald-400/10 ring-1 ring-emerald-400/20">
            <TrendingUp className="h-8 w-8 text-emerald-400" />
          </div>
          {/* Textos */}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Evolución del negocio</div>
            <div className="flex items-baseline gap-3 mt-1 flex-wrap">
              <span className="font-display text-6xl font-bold text-emerald-300 leading-none">+18%</span>
              <span className="text-base text-muted-foreground">vs mes anterior</span>
            </div>
          </div>
          {/* Info btn arriba derecha */}
          <button
            type="button"
            onClick={() => setInfoModal(INFO_CONTENT.growth)}
            className="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-full border border-primary/40 bg-primary/10 text-xs font-bold text-primary transition hover:bg-primary/20"
            aria-label="Información de crecimiento"
          >i</button>
        </div>

        {/* Etiqueta IMPULSADOS POR */}
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground">Impulsados por</div>
          <div className="text-muted-foreground text-lg leading-none">↓</div>
        </div>

        {/* 3 tarjetas: Clientes / Ticket / Ocupación */}
        <div className="grid md:grid-cols-3 gap-4">
          {/* Clientes nuevos */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex flex-col gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-violet-400/10 ring-1 ring-violet-400/20">
              <Users className="h-7 w-7 text-violet-400" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Clientes nuevos</div>
              <div className="font-display text-5xl font-bold text-violet-300 mt-2 leading-none">
                {Math.round(45 * animationProgress)}
              </div>
            </div>
            <div className="rounded-xl bg-violet-400/10 px-4 py-2.5">
              <div className="text-sm font-bold text-violet-300">+16%</div>
              <div className="text-xs text-muted-foreground">vs mes anterior</div>
            </div>
          </div>

          {/* Ticket promedio */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex flex-col gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-sky-400/10 ring-1 ring-sky-400/20">
              <DollarSign className="h-7 w-7 text-sky-400" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Ticket promedio</div>
              <div className="font-display text-4xl font-bold text-sky-300 mt-2 leading-none">
                {fmtAR(Math.round(DEMO.ticket * animationProgress))}
              </div>
            </div>
            <div className="rounded-xl bg-sky-400/10 px-4 py-2.5">
              <div className="text-sm font-bold text-sky-300">+10%</div>
              <div className="text-xs text-muted-foreground">vs mes anterior</div>
            </div>
          </div>

          {/* Ocupación */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex flex-col gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-orange-400/10 ring-1 ring-orange-400/20">
              <ClipboardList className="h-7 w-7 text-orange-400" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Ocupación</div>
              <div className="font-display text-5xl font-bold text-orange-300 mt-2 leading-none">
                {Math.round(DEMO.occupancy * animationProgress)}%
              </div>
            </div>
            <div className="rounded-xl bg-orange-400/10 px-4 py-2.5">
              <div className="text-sm font-bold text-orange-300">+8%</div>
              <div className="text-xs text-muted-foreground">vs mes anterior</div>
            </div>
          </div>
        </div>

        {/* Etiqueta GENERARON MÁS */}
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground">Generaron más</div>
          <div className="text-muted-foreground text-lg leading-none">↓</div>
        </div>

        {/* Bloque Utilidad gigante */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] px-8 py-7 flex items-center justify-between gap-6">
          {/* Left */}
          <div className="z-10">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-400/15 ring-1 ring-emerald-400/25">
                <DollarSign className="h-6 w-6 text-emerald-400" />
              </div>
              <div className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-300">Utilidad</div>
              <span className="rounded-lg bg-emerald-400/15 px-2.5 py-1 text-xs font-bold text-emerald-300 ring-1 ring-emerald-400/25">+30%</span>
            </div>
            <div className="font-display text-5xl sm:text-6xl font-bold text-emerald-300 mt-4 leading-none">
              {fmtAR(animatedProfit)}
            </div>
          </div>
          {/* Right: sparkline SVG */}
          <div className="shrink-0 opacity-80">
            <svg width="160" height="80" viewBox="0 0 160 80" fill="none">
              <defs>
                <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4ade80" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0 70 C30 65, 50 55, 70 45 S110 20, 160 5" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" fill="none" />
              <path d="M0 70 C30 65, 50 55, 70 45 S110 20, 160 5 L160 80 L0 80 Z" fill="url(#sparkFill)" />
              <circle cx="160" cy="5" r="5" fill="#4ade80" />
            </svg>
          </div>
        </div>
      </GlassCard>
      </div>{/* /Evolución */}

      {/* ── HISTORIAL DE ANÁLISIS ─────────────────────────────── */}
      <div>
        <div className="flex items-center gap-4 mb-6">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-muted-foreground/60">Historial de análisis</span>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        </div>
      <GlassCard className="p-7 sm:p-10 border border-white/[0.07]">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight">📅 Historial de análisis</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Clippr guarda un informe al comenzar cada mes. No necesitás tocar ningún botón.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-muted-foreground shrink-0">
            Próximo informe: <span className="font-semibold text-white">1 de julio</span>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {reports.map((report) => (
            <ReportCard key={report.month} report={report} />
          ))}
          {!reports.some(r => r.month === "Mayo 2026") && (
            <ReportCard report={{ month: "Mayo 2026", health: 76, growth: 12, profit: 1420000, revenue: 3100000 }} />
          )}
          {!reports.some(r => r.month === "Abril 2026") && (
            <ReportCard report={{ month: "Abril 2026", health: 71, growth: 8, profit: 1180000, revenue: 2780000 }} />
          )}
        </div>
      </GlassCard>
      </div>{/* /Historial */}

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
    const dayLabel = DEMO.lowDay.charAt(0).toUpperCase() + DEMO.lowDay.slice(1);
    actions.unshift({
      title: "Impulsar el día con menor ocupación",
      detail: `${dayLabel} presenta una ocupación inferior al promedio semanal.`,
      impact: `Oportunidad estimada: +${fmtAR(Math.round(8 * DEMO.ticket))} sin bajar precios`,
      impactAmount: `+${fmtAR(Math.round(8 * DEMO.ticket))} por mes`,
      impactExplanation: `Completar 8 turnos vacíos los ${DEMO.lowDay}s al precio normal generaría aproximadamente ${fmtAR(Math.round(8 * DEMO.ticket))} de facturación mensual sin afectar los márgenes. Implementar descuentos agresivos reduce la utilidad por turno — preferí acciones que aumenten la demanda sin ceder rentabilidad.`,
      button: "Tomar acción",
      tone: "growth",
      problem: `${dayLabel} tiene menor ocupación que el resto de la semana — hay turnos disponibles sin cubrir.`,
      opportunity: `Aumentar la demanda ese día con beneficios o acciones focalizadas puede sumar hasta ${fmtAR(Math.round(8 * DEMO.ticket))} mensuales sin reducir precios.`,
      howToAct: [
        "Priorizar beneficios sin descuento: regalo, upgrade o atención preferencial.",
        "Enviar la propuesta a clientes activos con turno reciente.",
        "Publicar disponibilidad ese día en redes o estados de WhatsApp.",
        "Medir si sube la ocupación la semana siguiente para ajustar la estrategia.",
      ],
      suggestedMessage:
        `Hola 👋 Tenemos algunos horarios disponibles para ${DEMO.lowDay} y queremos ofrecerte algo especial. Si reservás ese día, te sumamos [beneficio]. Respondé este mensaje y te ayudamos a coordinar.`,
      actionButtons: ["Crear beneficio", "Ver horarios", "Enviar WhatsApp", "Marcar como resuelto"],
      occupancyOptions: [
        { emoji: "🎁", label: "Beneficio sin descuento", recommended: true, discount: 0,
          message: `Hola 👋 Tenemos algunos horarios disponibles para ${DEMO.lowDay} y queremos ofrecerte algo especial. Si reservás ese día, te sumamos una bebida de regalo. Respondé este mensaje y te ayudamos a coordinar.` },
        { emoji: "⭐", label: "Upgrade de servicio", discount: 0,
          message: `Hola 👋 Reservá tu turno para el ${DEMO.lowDay} y te incluimos un upgrade de servicio sin cargo. Es nuestra forma de reconocer tu preferencia. Escribinos y te contamos los horarios disponibles.` },
        { emoji: "💸", label: "10% OFF", discount: 10,
          message: `Hola 👋 Tenemos horarios disponibles para el ${DEMO.lowDay} con un 10% de descuento por tiempo limitado. Respondé este mensaje y te reservamos el lugar.` },
        { emoji: "💸", label: "15% OFF", discount: 15,
          message: `Hola 👋 Tenemos horarios disponibles para el ${DEMO.lowDay} con un 15% de descuento especial. Si te interesa, respondé y te ayudamos a reservar.` },
        { emoji: "⚙️", label: "Personalizado", discount: undefined,
          message: "" },
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
  weeklyProfit:  [280000, 350000, 440000, 490000],
  weeklyClients: [160, 182, 198, 202],
};

// ─── HISTORIAL MES ANTERIOR ───────────────────────────────────────────────────

function HistorialMesAnterior() {
  const [activeMetric, setActiveMetric] = React.useState<"revenue" | "profit" | "clients">("revenue");

  const metricConfig = {
    revenue: { label: "Facturación", color: "#a78bfa", data: DEMO_PREV.weeklyRevenue, fmt: (v: number) => fmtAR(v) },
    profit:  { label: "Utilidad",   color: "#34d399", data: DEMO_PREV.weeklyProfit,   fmt: (v: number) => fmtAR(v) },
    clients: { label: "Clientes",   color: "#60a5fa", data: DEMO_PREV.weeklyClients,  fmt: (v: number) => String(v) },
  };

  const cfg = metricConfig[activeMetric];
  const CHART_H = 90;

  const impulsores: { tone: "good" | "warning"; text: string }[] = [
    { tone: "good",    text: "Clientes nuevos +16% vs período anterior" },
    { tone: "good",    text: "Ticket promedio +10% vs período anterior" },
    { tone: "good",    text: "Ocupación +8 puntos vs período anterior" },
    { tone: "warning", text: `${DEMO.inactiveClients} clientes sin retorno en +45 días` },
    { tone: "warning", text: `${DEMO.freeSlotsMonth} turnos disponibles sin ocupar` },
  ];

  const statCards = [
    { label: "Ingresos",           value: fmtAR(DEMO_PREV.revenue),       sub: "Facturación bruta",       color: "text-violet-300", bg: "bg-violet-400/10 ring-1 ring-violet-400/20" },
    { label: "Gastos",             value: fmtAR(DEMO_PREV.expenses),      sub: "Costos del período",      color: "text-rose-300",   bg: "bg-rose-400/10 ring-1 ring-rose-400/20" },
    { label: "Utilidad",           value: fmtAR(DEMO_PREV.profit),        sub: "Ganancia neta",           color: "text-emerald-300",bg: "bg-emerald-400/10 ring-1 ring-emerald-400/20" },
    { label: "Clientes atendidos", value: String(DEMO_PREV.clientsTotal), sub: "Total del mes",           color: "text-sky-300",    bg: "bg-sky-400/10 ring-1 ring-sky-400/20" },
    { label: "Clientes nuevos",    value: String(DEMO_PREV.clientsNew),   sub: "+16% vs mes previo",      color: "text-sky-300",    bg: "bg-sky-400/10 ring-1 ring-sky-400/20" },
    { label: "Ticket promedio",    value: fmtAR(DEMO_PREV.ticket),        sub: "+10% vs mes previo",      color: "text-amber-300",  bg: "bg-amber-400/10 ring-1 ring-amber-400/20" },
    { label: "Ocupación",          value: `${DEMO_PREV.occupancy}%`,      sub: "+8 pts vs mes previo",    color: "text-orange-300", bg: "bg-orange-400/10 ring-1 ring-orange-400/20" },
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
          <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight">📅 {DEMO_PREV.month}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Resumen completo del período anterior para comparar con el mes actual.</p>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-right shrink-0">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Crecimiento</div>
          <div className="mt-1 font-display text-3xl font-semibold text-primary">+{DEMO_PREV.growth}%</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">vs mes previo</div>
        </div>
      </div>

      {/* Tarjetas métricas */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {statCards.map((card) => (
          <div key={card.label} className={cn("rounded-2xl p-4", card.bg)}>
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{card.label}</div>
            <div className={cn("mt-2 font-display text-xl font-semibold", card.color)}>{card.value}</div>
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
                    ? k === "revenue" ? "bg-violet-500/15 ring-violet-400/30 text-violet-300"
                      : k === "profit" ? "bg-emerald-500/15 ring-emerald-400/30 text-emerald-300"
                      : "bg-sky-500/15 ring-sky-400/30 text-sky-300"
                    : "bg-white/[0.03] ring-white/10 text-muted-foreground hover:text-foreground"
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
                <div className="text-[10px] font-semibold truncate w-full text-center" style={{ color: cfg.color }}>
                  {cfg.fmt(val)}
                </div>
                <div className="w-full rounded-t-lg relative" style={{ height: `${CHART_H}px`, backgroundColor: "rgba(255,255,255,0.04)" }}>
                  <div
                    className="absolute bottom-0 w-full rounded-t-lg transition-all duration-700"
                    style={{ height: `${barH}px`, backgroundColor: cfg.color, opacity: 0.75 }}
                  />
                </div>
                <div className="text-[10px] text-muted-foreground whitespace-nowrap">{labels[i]}</div>
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
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
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
          <span className="font-semibold text-emerald-300">+30%</span> respecto al mes previo, impulsada principalmente por el aumento de clientes nuevos (+16%) y el ticket promedio (+10%). La ocupación mejoró 8 puntos alcanzando el 62%. Sin embargo, persisten{" "}
          <span className="font-semibold text-amber-300">{DEMO.freeSlotsMonth} espacios libres en agenda</span> y{" "}
          <span className="font-semibold text-amber-300">{DEMO.inactiveClients} clientes inactivos</span> que representan una oportunidad concreta de crecimiento para el mes actual.
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

        {/* Opciones de acción para baja ocupación */}
        {current.occupancyOptions && (() => {
          const opts = current.occupancyOptions!;
          const selOpt = opts[selectedOptionIdx];
          const isCustom = selOpt?.label === "Personalizado";
          const discountPct = isCustom
            ? Math.max(0, Math.min(100, Number(customDiscount) || 0))
            : (selOpt?.discount ?? 0);

          // Recalculate impact based on selected option
          const baseAmount = Math.round(8 * DEMO.ticket);
          const adjustedAmount = discountPct > 0
            ? Math.round(baseAmount * (1 - discountPct / 100))
            : baseAmount;
          const diffVsBase = adjustedAmount - baseAmount;

          // Derive active message
          const activeMsg = isCustom
            ? customMsg
            : (selOpt?.message ?? current.suggestedMessage);

          // Reco text based on selection
          const recoText = (() => {
            if (isCustom) return "Configurá los detalles del beneficio personalizado y la IA ajustará la recomendación.";
            if (!selOpt?.discount) return "Mantener el precio protege tu margen. Un beneficio de bajo costo puede ser suficiente para activar la demanda en este día.";
            if (selOpt.discount <= 10) return `Un ${selOpt.discount}% de descuento es moderado. Puede impulsar la demanda, pero considerá que reduce el ingreso por turno. Aplicalo por tiempo limitado y medí la respuesta.`;
            return `Un ${selOpt.discount}% de descuento es significativo. Solo conviene si la ocupación de este día sigue siendo baja después de probar opciones sin descuento.`;
          })();

          return (
            <div className="mt-4 space-y-4">
              {/* Selector de opción */}
              <div className="rounded-2xl border border-primary/20 bg-primary/[0.05] p-5">
                <div className="text-sm font-semibold text-white mb-1">¿Qué tipo de acción querés implementar?</div>
                <p className="text-xs text-muted-foreground mb-4">Clippr recomienda priorizar beneficios antes de bajar precios para proteger la rentabilidad.</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                            : "border-white/10 bg-white/[0.03] hover:border-white/20"
                        )}
                      >
                        <span className="text-base shrink-0">{opt.emoji}</span>
                        <span className={cn("font-medium", isSelected ? (opt.recommended ? "text-emerald-300" : "text-primary") : "text-muted-foreground")}>
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
                      <label className="text-xs text-muted-foreground mb-1 block">Nombre del beneficio</label>
                      <input type="text" placeholder="Ej: Shampoo gratis"
                        value={customBenefit} onChange={(e) => setCustomBenefit(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-primary/40 placeholder:text-muted-foreground/50" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Descuento % (0 = sin descuento)</label>
                      <input type="text" inputMode="numeric" placeholder="Ej: 0 o 10"
                        value={customDiscount} onChange={(e) => setCustomDiscount(e.target.value.replace(/\D/g, ""))}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-primary/40 placeholder:text-muted-foreground/50" />
                    </div>
                  </div>
                )}
              </div>

              {/* Oportunidad económica recalculada */}
              {discountPct > 0 && (
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-4 flex items-start gap-3">
                  <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Con un <span className="font-semibold text-amber-300">{discountPct}% de descuento</span> la oportunidad económica se reduce a{" "}
                    <span className="font-semibold text-white">+{fmtAR(adjustedAmount)}/mes</span>{" "}
                    (vs {fmtAR(baseAmount)} sin descuento). Diferencia: <span className="text-rose-300 font-semibold">{fmtAR(diffVsBase)}</span>.
                  </p>
                </div>
              )}

              {/* Recomendación dinámica según opción */}
              <div className={cn(
                "rounded-2xl border p-4",
                !selOpt?.discount ? "border-emerald-400/20 bg-emerald-400/[0.05]" :
                selOpt.discount <= 10 ? "border-amber-400/20 bg-amber-400/[0.05]" :
                "border-rose-400/20 bg-rose-400/[0.05]"
              )}>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2">Recomendación IA</div>
                <p className="text-sm text-muted-foreground leading-relaxed">{recoText}</p>
              </div>

              {/* Mensaje reactivo */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="text-sm font-semibold text-white">💬 Mensaje sugerido editable</div>
                <p className="mt-1 text-xs text-muted-foreground">Adaptalo al tono de tu negocio. Sirve para WhatsApp, email, Instagram o campañas.</p>
                <textarea
                  value={isCustom ? customMsg : activeMsg}
                  onChange={(e) => {
                    if (isCustom) setCustomMsg(e.target.value);
                  }}
                  readOnly={!isCustom}
                  className={cn(
                    "mt-3 min-h-[110px] w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none transition resize-none",
                    isCustom ? "focus:border-primary/50" : "cursor-default opacity-90"
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
  const healthTone = getHealthTone(report.health);
  const growthPositive = report.growth >= 0;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex flex-col gap-4 hover:border-white/20 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">{report.month}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground uppercase tracking-wider">Informe guardado</p>
        </div>
        <span className={cn(
          "text-xs font-bold px-2 py-0.5 rounded-full ring-1",
          growthPositive ? "bg-emerald-400/10 ring-emerald-400/20 text-emerald-300" : "bg-rose-400/10 ring-rose-400/20 text-rose-300"
        )}>
          {growthPositive ? "+" : ""}{report.growth}%
        </span>
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Utilidad</span>
          <span className="font-semibold text-emerald-300">{fmtAR(report.profit)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Facturación</span>
          <span className="font-semibold text-white">{fmtAR(report.revenue)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Salud</span>
          <span className={cn("font-semibold", healthTone.text)}>{report.health}/100 · {healthTone.label}</span>
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={cn("h-full rounded-full bg-gradient-to-r", healthTone.bar)} style={{ width: `${report.health}%` }} />
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
  nivel: "recomendado" | "evaluar" | "no_recomendado";
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
    if (!businessId) { setLoading(false); return; }
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
    return () => { cancelled = true; };
  }, [businessId]);

  return { servicios, loading };
}

const PRESETS = [500, 1000, 2000, 5000];

function fmtNum(n: number) {
  return n.toLocaleString("es-AR");
}

const nivelMeta = {
  recomendado:     { emoji: "✅", label: "Recomendado",            cls: "border-emerald-400/30 bg-emerald-400/[0.07]", titleCls: "text-emerald-300", dot: "bg-emerald-400" },
  progresivo:      { emoji: "🟡", label: "Aplicar progresivamente", cls: "border-amber-400/30 bg-amber-400/[0.07]",   titleCls: "text-amber-300",   dot: "bg-amber-400" },
  evaluar:         { emoji: "🟡", label: "Evaluar con cuidado",    cls: "border-amber-400/30 bg-amber-400/[0.07]",   titleCls: "text-amber-300",   dot: "bg-amber-400" },
  no_recomendado:  { emoji: "🔴", label: "No recomendado todavía", cls: "border-rose-400/30 bg-rose-400/[0.07]",     titleCls: "text-rose-300",    dot: "bg-rose-400" },
  alto_riesgo:     { emoji: "⚠️", label: "Alto riesgo",            cls: "border-orange-400/30 bg-orange-400/[0.07]", titleCls: "text-orange-300",  dot: "bg-orange-400" },
};

// Servicios demo (en producción vendrían de price_catalog de Supabase)
const PRESETS_PCT  = [10, 15, 20];
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
    return { nivel: "alto_riesgo", resumen: `Este aumento representa un ${pctAumento.toFixed(0)}% sobre el precio actual, lo que es demasiado alto en relación a la demanda. Podrías perder más clientes de los que compensaría el nuevo precio. Considerá hacerlo en dos etapas.` };
  }
  if (ocupacion >= 80 && pctAumento <= 15) {
    return { nivel: "recomendado", resumen: `Tu ocupación es alta (${ocupacion}%) y el aumento es moderado (${pctAumento.toFixed(0)}%). Este cambio parece seguro: podés perder hasta ${serviciosPerdibles} servicios al mes y seguir facturando lo mismo. Podés aplicarlo directamente.` };
  }
  if (ocupacion >= 80 && pctAumento > 15) {
    return { nivel: "progresivo", resumen: `Tu ocupación es alta (${ocupacion}%) pero el aumento es considerable (${pctAumento.toFixed(0)}%). Conviene aplicarlo primero en clientes nuevos y servicios premium durante 2 semanas antes de generalizarlo.` };
  }
  if (ocupacion >= 60 && pctAumento <= 15) {
    return { nivel: "progresivo", resumen: `Tu ocupación es moderada (${ocupacion}%) y el aumento es razonable (${pctAumento.toFixed(0)}%). Puede funcionar bien, pero conviene comunicarlo con anticipación y medir la respuesta los primeros 15 días. Podés perder hasta ${serviciosPerdibles} turnos sin perder facturación.` };
  }
  if (ocupacion >= 60 && pctAumento > 15) {
    return { nivel: "evaluar", resumen: `Tu ocupación es del ${ocupacion}% y el aumento es del ${pctAumento.toFixed(0)}%. El riesgo es medio-alto. Antes de aplicarlo en toda la agenda, probalo en servicios premium o con clientes nuevos y medí el impacto real.` };
  }
  return { nivel: "no_recomendado", resumen: `Tu ocupación actual (${ocupacion}%) todavía tiene margen libre. Subir precios ahora podría frenar la captación de nuevos clientes justo cuando más los necesitás. Primero conviene completar la agenda y luego revisar los precios.` };
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

  const servicio = serviciosReales.find(s => s.id === servicioId) ?? serviciosReales[0] ?? null;
  const precioActual = servicio?.precio ?? 0;
  const cantidadMensual = servicio?.mensual ?? 0;
  const facturacionServicio = precioActual * cantidadMensual;


  // Calcular aumento en pesos
  const aumentoNum = tipoAumento === "fijo"
    ? Math.max(0, Number(aumentoFijo) || 0)
    : Math.round(precioActual * (Math.max(0, Number(aumentoPct) || 0) / 100));

  const nuevoPrecio = precioActual + aumentoNum;
  const ingresoExtra = aumentoNum * cantidadMensual;
  const cantidadEquilibrio = nuevoPrecio > 0 ? Math.ceil(facturacionServicio / nuevoPrecio) : cantidadMensual;
  const serviciosPerdibles = Math.max(0, cantidadMensual - cantidadEquilibrio);
  const pctPerdible = cantidadMensual > 0 ? ((serviciosPerdibles / cantidadMensual) * 100).toFixed(1) : "0";
  const riesgoLabel = Number(pctPerdible) < 10 ? "Bajo" : Number(pctPerdible) < 25 ? "Medio" : "Alto";
  const riesgoColor = Number(pctPerdible) < 10 ? "text-emerald-300" : Number(pctPerdible) < 25 ? "text-amber-300" : "text-rose-300";

  const recomendacion = simulado && aumentoNum > 0
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
        <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">💰 Simulador de precios</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Elegí un servicio, elegí el aumento y la IA te dice si conviene, cuánto ganás y cuántos clientes podés perder sin facturar menos.
        </p>
      </div>

      {/* Paso 1: Elegir servicio */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">1. Elegí el servicio a simular</p>
        {loadingServicios ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando servicios…
          </div>
        ) : serviciosReales.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-muted-foreground">
            No hay servicios activos. Creá servicios en <span className="font-semibold text-white">Configuración → Servicios</span> para usar el simulador.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {serviciosReales.map((s) => (
              <button key={s.id} type="button"
                onClick={() => { setServicioId(s.id); reset(); }}
                className={cn("rounded-xl border px-4 py-2 text-sm font-semibold transition-all",
                  servicioId === s.id
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground")}>
                {s.nombre}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Paso 2: Datos actuales del servicio */}
      {servicio && (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">2. Datos actuales — {servicio.nombre}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: "Precio actual",      value: `$${fmtNum(precioActual)}` },
            { label: "Servicios este mes", value: cantidadMensual > 0 ? fmtNum(cantidadMensual) : "—" },
            { label: "Facturación/mes",    value: cantidadMensual > 0 ? `$${fmtNum(facturacionServicio)}` : "—" },
            { label: "Ocupación",          value: `${ocupacion}%` },
            { label: "Ticket prom. (total)", value: `$${fmtNum(ticket)}` },
          ].map((d) => (
            <div key={d.label} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-center">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground leading-tight">{d.label}</div>
              <div className="mt-1.5 text-sm font-bold text-white tabular-nums">{d.value}</div>
            </div>
          ))}
        </div>
        {cantidadMensual === 0 && (
          <p className="text-xs text-muted-foreground">
            No se registraron turnos para <span className="font-semibold text-white">{servicio.nombre}</span> en el mes actual. La simulación usará el precio del servicio; el ingreso extra estimado se calculará por unidad.
          </p>
        )}
      </div>
      )}

      {/* Paso 3: Elegir aumento */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">3. Elegí el aumento</p>

        {/* Toggle fijo / % */}
        <div className="flex gap-2 mb-3">
          {([["fijo", "Monto fijo ($)"], ["pct", "Porcentaje (%)"]] as const).map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => { setTipoAumento(k); reset(); }}
              className={cn("rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                tipoAumento === k ? "border-primary/40 bg-primary/10 text-primary" : "border-white/10 bg-white/[0.03] text-muted-foreground")}>
              {lbl}
            </button>
          ))}
        </div>

        {tipoAumento === "fijo" ? (
          <div className="flex flex-wrap gap-2 items-center">
            {PRESETS_FIJO.map((p) => (
              <button key={p} type="button" onClick={() => { setAumentoFijo(String(p)); setSimulado(false); }}
                className={cn("rounded-xl border px-4 py-2 text-sm font-semibold transition-all",
                  Number(aumentoFijo) === p ? "border-primary/50 bg-primary/15 text-primary" : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground")}>
                +${fmtNum(p)}
              </button>
            ))}
            <input type="text" inputMode="numeric" placeholder="Otro monto $"
              value={aumentoFijo} onChange={(e) => { setAumentoFijo(e.target.value.replace(/\D/g, "")); setSimulado(false); }}
              className="w-36 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm outline-none focus:border-primary/40 placeholder:text-muted-foreground/50" />
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 items-center">
            {PRESETS_PCT.map((p) => (
              <button key={p} type="button" onClick={() => { setAumentoPct(String(p)); setSimulado(false); }}
                className={cn("rounded-xl border px-4 py-2 text-sm font-semibold transition-all",
                  Number(aumentoPct) === p ? "border-primary/50 bg-primary/15 text-primary" : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground")}>
                +{p}%
              </button>
            ))}
            <input type="text" inputMode="numeric" placeholder="Otro %"
              value={aumentoPct} onChange={(e) => { setAumentoPct(e.target.value.replace(/\D/g, "")); setSimulado(false); }}
              className="w-28 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm outline-none focus:border-primary/40 placeholder:text-muted-foreground/50" />
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
            <button type="button" onClick={calcular}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110">
              <Sparkles className="h-3.5 w-3.5" />
              Calcular
            </button>
          </div>
        )}
      </div>

      {/* Paso 4 + 5: Resultados + Recomendación */}
      {simulado && aumentoNum > 0 && (
        <div className="space-y-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">4. Resultado de la simulación</p>

          {/* Métricas clave */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Precio actual",        value: `$${fmtNum(precioActual)}`,  color: "text-white" },
              { label: "Nuevo precio",          value: `$${fmtNum(nuevoPrecio)}`,   color: "text-emerald-300" },
              { label: "Diferencia por servicio", value: `+$${fmtNum(aumentoNum)}`, color: "text-emerald-300" },
              { label: "Ingreso extra estimado",  value: `+$${fmtNum(ingresoExtra)}/mes`, color: "text-emerald-300" },
            ].map((m) => (
              <div key={m.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{m.label}</div>
                <div className={cn("mt-2 font-display text-xl font-bold tabular-nums", m.color)}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Punto de equilibrio + Riesgo */}
          <div className="rounded-2xl border border-primary/20 bg-primary/[0.06] p-5 grid sm:grid-cols-2 gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary mb-2">Punto de equilibrio</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Podés perder hasta{" "}
                <span className="font-bold text-white">{fmtNum(serviciosPerdibles)} servicios/mes ({pctPerdible}%)</span>{" "}
                y seguir facturando los mismos{" "}
                <span className="font-bold text-white">${fmtNum(facturacionServicio)}</span> actuales.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2">Riesgo estimado</p>
              <div className={cn("font-display text-3xl font-bold", riesgoColor)}>{riesgoLabel}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {riesgoLabel === "Bajo" ? "Podés perder poca demanda antes de perder facturación."
                  : riesgoLabel === "Medio" ? "Hay margen, pero conviene monitorear las primeras semanas."
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
                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Recomendación IA</p>
                  <p className={cn("text-base font-bold", nivelMeta[recomendacion.nivel].titleCls)}>
                    {nivelMeta[recomendacion.nivel].label}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{recomendacion.resumen}</p>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}

// ─── SIMULADOR PROFESIONAL ────────────────────────────────────────────────────

function SimuladorProfesional({ servicios, facturacion, ticket, clientes, ocupacion }: SimuladorProps) {
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
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
      });
      const json = await res.json();
      const text = (json.content ?? []).map((b: { type: string; text?: string }) => b.type === "text" ? (b.text ?? "") : "").join("");
      setResultado(JSON.parse(text.replace(/```json|```/g, "").trim()) as ProfSimResult);
    } catch {
      const nivel: ProfSimResult["nivel"] = ocupacion >= 80 ? "recomendado" : ocupacion >= 65 ? "evaluar" : "no_recomendado";
      const facturacionPotencial = nivel === "recomendado" ? Math.round(servicios * 0.8 * ticket) : 0;
      setResultado({
        nivel,
        resumen: nivel === "recomendado"
          ? `Tu ocupación del ${ocupacion}% indica que la agenda está casi completa. La demanda actual supera la capacidad disponible y se detectan horarios sin disponibilidad de forma recurrente.`
          : nivel === "evaluar"
          ? `Tu ocupación del ${ocupacion}% es moderada. Todavía existe capacidad para crecer con el equipo actual. Se recomienda volver a analizar cuando la ocupación supere el 80%.`
          : `Tu ocupación del ${ocupacion}% indica que hay capacidad disponible con el equipo actual. Antes de incorporar personal, conviene trabajar en completar la agenda existente.`,
        facturacionPotencial,
        explicacionFacturacion: nivel === "recomendado"
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
          <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">👥 ¿Conviene incorporar un profesional?</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            La IA analiza la ocupación, demanda y capacidad actual para recomendarte si es el momento.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {[
            { label: "📅 Ocupación", value: `${ocupacion}%` },
            { label: "🎟️ Ticket prom.", value: `$${fmtNum(ticket)}` },
            { label: "💰 Facturación", value: `$${fmtNum(facturacion)}` },
          ].map((d) => (
            <div key={d.label} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-center min-w-[100px]">
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{d.label}</div>
              <div className="mt-1 text-sm font-semibold tabular-nums">{d.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Qué analiza la IA */}
      {!analizado && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-3">La IA va a analizar</p>
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
        <button type="button" onClick={analizar}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110">
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
            <p className="text-xs text-muted-foreground mt-0.5">La IA evalúa ocupación, demanda, horarios y tendencia de clientes.</p>
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
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Recomendación IA</p>
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
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{resultado.resumen}</p>
          </div>

          {/* Impacto económico — coherente con la recomendación */}
          {resultado.nivel === "recomendado" ? (
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">📈 Facturación potencial estimada</p>
              <p className="mt-3 font-display text-4xl font-semibold text-emerald-300 tracking-tight">
                +${fmtNum(resultado.facturacionPotencial)}
                <span className="ml-2 text-base font-normal text-emerald-300/70">por mes</span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{resultado.explicacionFacturacion}</p>
            </div>
          ) : resultado.nivel === "evaluar" ? (
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">📈 Potencial de crecimiento con el equipo actual</p>
              <p className="mt-3 font-display text-4xl font-semibold text-amber-300 tracking-tight">
                {Math.round((1 - ocupacion / 100) * 100)}%
                <span className="ml-2 text-base font-normal text-amber-300/70">de capacidad disponible</span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                Ocupación actual: {ocupacion}%. Todavía existe capacidad suficiente para crecer con el equipo actual. Se recomienda volver a analizar cuando la ocupación supere el 80%.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-primary/20 bg-primary/[0.06] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">📅 Capacidad disponible actual</p>
              <p className="mt-3 font-display text-4xl font-semibold text-foreground tracking-tight">
                ~{Math.round(servicios * (1 - ocupacion / 100))}
                <span className="ml-2 text-base font-normal text-muted-foreground">espacios libres por mes</span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                Todavía existen turnos disponibles con el equipo actual. Completar la agenda antes de incorporar un nuevo profesional maximiza la rentabilidad.
              </p>
            </div>
          )}

          {/* Volver a analizar */}
          <button type="button" onClick={() => { setAnalizado(false); setResultado(null); }}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground transition">
            Volver a analizar
          </button>
        </div>
      )}
    </GlassCard>
  );
}

