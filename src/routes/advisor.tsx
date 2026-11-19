import * as React from "react";
import { whatsappHref } from "@/lib/contacto-valido";
import { createPortal } from "react-dom";
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
import { ADVISOR_MONTHS_SELECTABLE, useAdvisorAnalytics, type AdvisorAnalytics } from "@/hooks/use-advisor-analytics";
import type { HealthIndicator } from "@/lib/health-score";
import { cajaDateKeyBA } from "@/lib/caja-cierre";
import { shiftMonth } from "@/lib/monthly-performance";
import { MesSelector, RendimientoMensual } from "@/components/advisor/rendimiento-mensual";
import { ClientesPerdidosCard } from "@/components/advisor/clientes-perdidos-card";
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
  Clock,
  CalendarX,
  Megaphone,
  CircleHelp,
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
    title: "Salud del negocio",
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
      "Qué datos usa: tus servicios, clientes, agenda y horarios.",
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
  "dia-rentable": CalendarDays,
  "dia-tranquilo": CalendarDays,
  "hora-top": Clock,
  "hora-bottom": Clock,
  "prof-factura": Crown,
  "cliente-top": Crown,
  "clientes-nuevos": Users,
  cancelaciones: CalendarX,
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
          {true && (
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
        />
      </div>
    </AppShell>
  );
}

function AdvisorContent({
  advisorTab,
  setAdvisorTab: _setAdvisorTab,
}: {
  advisorTab: "acciones" | "analisis" | "simuladores";
  setAdvisorTab: (t: "acciones" | "analisis" | "simuladores") => void;
}) {
  const { businessId } = useAuth();
  const animationProgress = useResultAnimation(true);
  const [infoModal, setInfoModal] = React.useState<InfoModalContent | null>(null);
  // Mes elegido en Evolución del negocio: manda sobre las tres tarjetas grandes (Evolución,
  // Salud del negocio y Radiografía del local) — al cambiarlo cambian todos sus datos.
  const currentMonthKey = cajaDateKeyBA().slice(0, 7);
  const [selectedMonthKey, setSelectedMonthKey] = React.useState(currentMonthKey);
  const analytics = useAdvisorAnalytics(businessId, selectedMonthKey);
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

  return (
    <div className="space-y-5 sm:space-y-7 max-w-5xl mx-auto w-full">
      {advisorTab !== "simuladores" && <AiBriefing analytics={analytics} />}

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

      {advisorTab === "acciones" && (
        <GrowthManagerTab
          analytics={analytics}
          businessId={businessId}
          selectedMonthKey={selectedMonthKey}
          onMonthKeyChange={setSelectedMonthKey}
          minMonthKey={shiftMonth(currentMonthKey, -(ADVISOR_MONTHS_SELECTABLE - 1))}
          animatedHealth={animatedHealth}
          healthTone={healthTone}
          healthHeadline={healthHeadline}
        />
      )}

      {advisorTab === "analisis" && (
        <>
          {/* ── EVOLUCIÓN DEL NEGOCIO ─────────────────────────────── */}
          {/* Mismo fix que Salud del negocio: overflow-hidden contiene el
              glow decorativo (-inset-x-6) para que no fuerce scroll
              horizontal en toda la página. */}
          <div className="relative overflow-hidden rounded-[1.7rem] border border-sky-300/[0.30] bg-white/[0.018] p-2.5 pt-4 shadow-[0_0_0_1px_rgba(56,189,248,0.16),0_24px_90px_-42px_rgba(14,165,233,0.9)] sm:p-3 sm:pt-5">
            <div className="pointer-events-none absolute -inset-x-6 -top-8 h-24 rounded-full bg-sky-400/[0.16] blur-3xl" />
            <MesSelector
              monthKey={selectedMonthKey}
              onMonthKeyChange={setSelectedMonthKey}
              minMonthKey={shiftMonth(currentMonthKey, -(ADVISOR_MONTHS_SELECTABLE - 1))}
            />
            <div className="flex items-center gap-4 mb-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <span className="rounded-full border border-white/10 bg-white/[0.045] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60">
                Evolución del negocio
              </span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
            </div>
            <div className="px-0.5 pb-1 pt-1 sm:px-1">
              <RendimientoMensual monthKey={selectedMonthKey} />
            </div>
            <div className="px-0.5 pb-1 pt-3 sm:px-1">
              {(() => {
                const occ = Math.round((analytics.current?.occupancy ?? 0) * animationProgress);
                const tono = occ >= 70 ? "text-emerald-300" : occ >= 50 ? "text-amber-300" : "text-rose-300";
                const barra = occ >= 70 ? "bg-emerald-400/80" : occ >= 50 ? "bg-amber-300/80" : "bg-rose-400/80";
                return (
                  <section className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-[#0b0a14] p-4 [background-image:radial-gradient(110%_90%_at_100%_0%,rgba(79,125,255,0.16),transparent_62%),radial-gradient(90%_80%_at_0%_100%,rgba(139,92,246,0.12),transparent_65%)]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="grid size-9 place-items-center rounded-xl bg-orange-400/10 ring-1 ring-orange-400/20">
                          <ClipboardList className="size-4 text-orange-300" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-white">Ocupación</div>
                          <div className="text-[11px] text-white/50">{analytics.analysisMonthLabel}</div>
                        </div>
                      </div>
                      <div className={cn("font-display text-3xl font-semibold tabular-nums", tono)}>{occ}%</div>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                      <div className={cn("h-full rounded-full", barra)} style={{ width: `${Math.min(100, occ)}%` }} />
                    </div>
                    {analytics.freeSlotsMonth > 0 && (
                      <dl className="mt-3 space-y-2 border-t border-white/[0.07] pt-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-white/60">Turnos vacíos en los días trabajados</dt>
                          <dd className="font-semibold tabular-nums text-white">{analytics.freeSlotsMonth}</dd>
                        </div>
                        {analytics.slotsTo75 > 0 && (
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-white/60">Para llegar al 75% faltan</dt>
                            <dd className="font-semibold tabular-nums text-white">{analytics.slotsTo75} turnos</dd>
                          </div>
                        )}
                        {analytics.slotsTo75 > 0 && (
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-white/60">Serían de más</dt>
                            <dd className="font-semibold tabular-nums text-emerald-300">+{fmtAR(Math.round(analytics.potentialAt75))}</dd>
                          </div>
                        )}
                      </dl>
                    )}
                  </section>
                );
              })()}
            </div>
          </div>
          {/* /Evolución */}


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

// Presentación del Gerente IA al entrar: los pasos reflejan la carga REAL de datos (ventas, clientes, agenda) y
// el resumen sale de los números reales del mes, escrito en vivo. Una vez por día; después aparece directo.
function AiBriefing({ analytics }: { analytics: AdvisorAnalytics }) {
  const todayKey = getTodayKey();
  const alreadySeen = React.useMemo(() => {
    try {
      return localStorage.getItem("clippr_advisor_briefing_seen") === todayKey;
    } catch {
      return false;
    }
  }, [todayKey]);
  const [typed, setTyped] = React.useState(0);

  const c = analytics.current;
  const radiografia = (key: string) => analytics.radiografia.find((i) => i.key === key);
  const lines = React.useMemo(() => {
    if (!c?.hasData) return [] as string[];
    const out: string[] = [
      `${analytics.analysisMonthLabel}: facturaste ${fmtAR(c.revenue)} con un ticket promedio de ${fmtAR(c.ticket)} y una ocupación del ${c.occupancy}%.`,
    ];
    const rentable = radiografia("dia-rentable");
    const tranquilo = radiografia("dia-tranquilo");
    if (rentable && rentable.value !== "—" && tranquilo && tranquilo.value !== "—") {
      out.push(`Tu mejor día es el ${rentable.value} y el más tranquilo el ${tranquilo.value}.`);
    }
    const horario = radiografia("hora-top");
    if (horario && horario.value !== "—") out.push(`El horario con más turnos es de ${horario.value}.`);
    return out;
  }, [c, analytics.analysisMonthLabel, analytics.radiografia]);

  const fullText = lines.join(" ");
  const ready = !analytics.loading;

  React.useEffect(() => {
    if (!ready || !fullText) return;
    if (alreadySeen) {
      setTyped(fullText.length);
      return;
    }
    setTyped(0);
    const id = window.setInterval(() => {
      setTyped((t) => {
        if (t >= fullText.length) {
          window.clearInterval(id);
          try {
            localStorage.setItem("clippr_advisor_briefing_seen", todayKey);
          } catch {
            /* sin almacenamiento: se muestra igual */
          }
          return t;
        }
        return t + 2;
      });
    }, 22);
    return () => window.clearInterval(id);
  }, [ready, fullText, alreadySeen, todayKey]);

  const pasos = [
    { label: "Ventas", icon: DollarSign },
    { label: "Clientes", icon: Users },
    { label: "Agenda", icon: CalendarDays },
  ];

  return (
    <div className="relative overflow-hidden rounded-[22px] border border-violet-300/25 bg-violet-400/[0.06] p-4 sm:p-5">
      <div className="pointer-events-none absolute -left-10 -top-10 h-32 w-32 rounded-full bg-violet-500/20 blur-3xl" />
      <div className="relative flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-400/12 ring-1 ring-violet-300/25">
          <Brain className={cn("h-5 w-5 text-violet-200", !ready && "animate-pulse")} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-violet-200/70">Gerente IA</div>
          {!ready ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {pasos.map((paso, i) => {
                const Icon = paso.icon;
                return (
                  <span
                    key={paso.label}
                    className="inline-flex animate-pulse items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-white/70"
                    style={{ animationDelay: `${i * 180}ms` }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    Leyendo {paso.label.toLowerCase()}…
                  </span>
                );
              })}
            </div>
          ) : fullText ? (
            <p className="mt-1.5 text-sm leading-relaxed text-white/85 sm:text-[15px]">
              {fullText.slice(0, typed)}
              {typed < fullText.length ? <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-violet-300" /> : null}
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-white/60">Todavía no hay actividad suficiente este mes para armar un resumen.</p>
          )}
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

  // Portal a document.body: el árbol de la página vive dentro de
  // `<div className="relative z-10">` en AppShell — como ese div SÍ tiene
  // position:relative + z-index propio, crea su propio contexto de
  // apilamiento en la raíz del documento, y ese contexto completo (con
  // z-10) queda por DEBAJO del header/bottom-nav mobile de AppSidebar
  // (z-40, ambos fixed/sticky, hermanos de <main> a nivel raíz). Ningún
  // z-index interno de este modal podía "escapar" ese contexto — por más
  // alto que fuera, seguía compitiendo puertas adentro de un contenedor
  // que ya perdía contra el header/nav. Por eso la X y el final del
  // contenido quedaban tapados por la barra inferior pase lo que pase.
  // Con createPortal a document.body el modal sale de ese árbol por
  // completo y su z-index sí compite en la raíz del documento.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-black/70 px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-md sm:items-center"
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
        <div className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5">
          <h2 className="min-w-0 truncate font-display text-base font-bold tracking-tight text-white">
            {content.title}
          </h2>
          {/* size-11 = 44×44px: área táctil mínima recomendada en iOS. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid size-11 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-white/60 transition hover:bg-white/[0.10] hover:text-white active:bg-white/[0.14]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* pb grande con safe-area propio (120px + safe-area, no unos
            pocos px): el padding-bottom chico no alcanzaba para que el
            último bloque (la tarjeta roja) quedara totalmente visible al
            llegar al final del scroll en iPhone — entre el home indicator
            y la barra de Safari le comen espacio real al final del scroll
            interno aunque el overlay de afuera ya tenga su propio padding
            de safe-area. overscroll-contain: el scroll de este contenedor
            nunca se lo pasa al fondo (además del bloqueo de body ya
            aplicado con useBodyScrollLock). */}
        <div
          ref={scrollRef}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-[calc(120px+env(safe-area-inset-bottom,0px))] pt-5"
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
    </div>,
    document.body,
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









// ─────────────────────── Salud del negocio (Gerente IA) ───────────────────────
const ESTADO_CHIP: Record<"provisional" | "insuficiente", { text: string; cls: string }> = {
  provisional: { text: "Provisional", cls: "border-amber-300/30 bg-amber-300/10 text-amber-200" },
  insuficiente: { text: "Datos insuficientes", cls: "border-white/15 bg-white/[0.05] text-white/55" },
};

function IndicadorSalud({ ind }: { ind: HealthIndicator }) {
  const [open, setOpen] = React.useState(false);
  const ratio = ind.pts != null ? ind.pts / ind.max : 0;
  const barra = ratio >= 0.7 ? "bg-emerald-400/80" : ratio >= 0.4 ? "bg-amber-300/80" : "bg-rose-400/80";
  const chip = ind.state === "calculado" ? null : ESTADO_CHIP[ind.state];
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03]">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full px-3 py-2.5 text-left">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-white">{ind.label}</span>
          <span className="shrink-0 text-xs tabular-nums text-white/85">
            {ind.pts != null ? (
              <>
                {Math.round(ind.pts)} <span className="text-white/40">/ {ind.max}</span>
              </>
            ) : (
              <span className="text-white/45">— / {ind.max}</span>
            )}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
          {ind.pts != null && <div className={cn("h-full rounded-full", barra)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-white/55">
          <span className="min-w-0 truncate">{ind.valueText}</span>
          {chip && <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", chip.cls)}>{chip.text}</span>}
        </div>
      </button>
      {open && (
        <div className="space-y-2 border-t border-white/[0.07] px-3 py-3 text-xs leading-relaxed text-white/70">
          {ind.warning && <p className="rounded-lg border border-amber-300/25 bg-amber-300/[0.06] px-2.5 py-2 text-amber-100/85">{ind.warning}</p>}
          <p>
            <b className="text-white">Por qué:</b> {ind.why}
          </p>
          <p>
            <b className="text-white">Qué hacer:</b> {ind.tip}
          </p>
        </div>
      )}
    </div>
  );
}

function SaludSection({
  analytics,
  selectedMonthKey,
  onMonthKeyChange,
  minMonthKey,
  animatedHealth,
  healthTone,
  healthHeadline,
}: {
  analytics: AdvisorAnalytics;
  selectedMonthKey: string;
  onMonthKeyChange: (k: string) => void;
  minMonthKey: string;
  animatedHealth: number;
  healthTone: { text: string; bar: string };
  healthHeadline: string;
}) {
  const score = analytics.healthScore;
  const luz =
    "[background-image:radial-gradient(110%_90%_at_100%_0%,rgba(79,125,255,0.16),transparent_62%),radial-gradient(90%_80%_at_0%_100%,rgba(139,92,246,0.12),transparent_65%)]";
  const tarjeta = `rounded-2xl border border-white/10 bg-[#0b0a14] p-4 ${luz}`;
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-emerald-300/[0.30] bg-white/[0.018] p-2.5 pt-4 shadow-[0_0_0_1px_rgba(16,185,129,0.16),0_30px_125px_-42px_rgba(45,212,191,1)] sm:p-3 sm:pt-5">
      <div className="pointer-events-none absolute -inset-x-6 -top-8 h-24 rounded-full bg-emerald-400/[0.16] blur-3xl" />
      <div className="relative">
        <MesSelector monthKey={selectedMonthKey} onMonthKeyChange={onMonthKeyChange} minMonthKey={minMonthKey} />
      </div>
      <div className="relative mb-3 flex items-center gap-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        <span className="rounded-full border border-white/10 bg-white/[0.045] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60">
          Salud del negocio
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      </div>
      {analytics.analysisNote && <p className="relative mb-3 px-2 text-xs leading-snug text-amber-200/80">{analytics.analysisNote}</p>}
      <div className="relative grid gap-3 md:grid-cols-2">
        <section className={tarjeta}>
          <div className="text-sm font-semibold text-white">Estado actual</div>
          <div className="text-[11px] text-white/50">Rentabilidad, clientes y ocupación</div>
          <div className="mt-4 flex items-center gap-4">
            <div className="relative grid shrink-0 place-items-center">
              <svg width="118" height="118" viewBox="0 0 200 200" className="-rotate-90">
                <circle cx="100" cy="100" r="84" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="16" />
                <circle
                  cx="100"
                  cy="100"
                  r="84"
                  fill="none"
                  stroke="url(#healthGrad)"
                  strokeWidth="16"
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
              <div className="absolute flex flex-col items-center">
                <span className={cn("font-display text-4xl font-semibold leading-none tabular-nums", healthTone.text)}>
                  {analytics.health == null ? "—" : animatedHealth}
                </span>
                <span className="mt-0.5 text-[11px] text-white/45">de 100</span>
              </div>
            </div>
            <div className="min-w-0">
              <div className={cn("text-xl font-semibold leading-tight", healthTone.text)}>{healthHeadline}</div>
              <p className="mt-1 text-xs leading-relaxed text-white/60">
                {analytics.health == null
                  ? "Todavía no hay datos suficientes para calcular la salud del negocio."
                  : analytics.health >= 80
                    ? "Tu local está muy bien. Mantené el ritmo y seguí cuidando a tus clientes."
                    : analytics.health >= 65
                      ? "Vas bien. El próximo salto está en llenar la agenda y recuperar clientes, no en bajar precios."
                      : analytics.health >= 50
                        ? "Hay margen de mejora. Empezá por llenar la agenda y recuperar clientes."
                        : "Hay varios indicadores para mejorar. Empezá por llenar la agenda y recuperar clientes."}
              </p>
            </div>
          </div>
          {score && (score.provisional || score.partial) && (
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
              {score.provisional && <span className={cn("rounded-full border px-2.5 py-1 font-semibold", ESTADO_CHIP.provisional.cls)}>Puntaje provisional</span>}
              {score.partial && (
                <span className={cn("rounded-full border px-2.5 py-1 font-semibold", ESTADO_CHIP.insuficiente.cls)}>
                  Calculado con {score.available} de 100 puntos posibles
                </span>
              )}
            </div>
          )}
        </section>

        <section className={tarjeta}>
          <div className="text-sm font-semibold text-white">Cómo se arma el puntaje</div>
          <div className="text-[11px] text-white/50">Tocá un indicador para ver por qué obtuvo esos puntos y qué hacer.</div>
          <div className="mt-3 space-y-2">
            {score ? (
              score.indicators.map((ind) => <IndicadorSalud key={ind.key} ind={ind} />)
            ) : (
              <p className="text-sm text-white/55">Todavía no hay actividad suficiente para armar el puntaje.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// Radiografía del equipo: solo lo que NO está ya en Salud, Radar o Análisis (clientes para recuperar, turnos vacíos).
function RadiografiaSection({ analytics }: { analytics: AdvisorAnalytics }) {
  const items = analytics.radiografia.filter((i) => i.key !== "recuperar" && i.key !== "turnos-vacios");
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-fuchsia-300/[0.22] bg-white/[0.016] p-3 shadow-[0_0_0_1px_rgba(217,70,239,0.12),0_28px_110px_-50px_rgba(217,70,239,0.8)] sm:p-4">
      <div className="pointer-events-none absolute -inset-x-6 -top-8 h-24 rounded-full bg-fuchsia-500/[0.12] blur-3xl" />
      <div className="flex items-center gap-4 mb-3">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        <span className="rounded-full border border-white/10 bg-white/[0.045] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60">
          Radiografía del equipo
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      </div>
      <GlassCard className="p-3.5 sm:p-6 border border-fuchsia-300/[0.2] bg-white/[0.05] shadow-[0_0_0_1px_rgba(217,70,239,0.1),0_35px_120px_-44px_rgba(217,70,239,0.7)]">
        <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
          Equipo, servicios y clientes
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Quién rinde más, qué se vende y cuántos clientes fieles tenés · {analytics.analysisMonthLabel}.
        </p>
        {/* grid-cols-2 desde mobile (antes era 1 sola columna hasta
            sm:, una tarjeta enorme abajo de otra) — en pantallas
            grandes sigue yendo a 4 columnas igual que siempre. */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3 lg:grid-cols-4">
          {items.map((item) => {
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
                {item.detail && (
                  <div className="mt-1 text-xs font-semibold text-white/70 sm:text-sm">{item.detail}</div>
                )}
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
  );
}

type GrowthManagerTabProps = {
  analytics: AdvisorAnalytics;
  businessId: string | null | undefined;
  selectedMonthKey: string;
  onMonthKeyChange: (k: string) => void;
  minMonthKey: string;
  animatedHealth: number;
  healthTone: { text: string; bar: string };
  healthHeadline: string;
};

function GrowthManagerTab({ analytics, businessId, selectedMonthKey, onMonthKeyChange, minMonthKey, animatedHealth, healthTone, healthHeadline }: GrowthManagerTabProps) {
  // Diagnóstico: salud + radar arriba; clientes para recuperar y radiografía del equipo al final. Nada se repite con Análisis.
  const diagnostico = (
    <>
      <SaludSection
        analytics={analytics}
        selectedMonthKey={selectedMonthKey}
        onMonthKeyChange={onMonthKeyChange}
        minMonthKey={minMonthKey}
        animatedHealth={animatedHealth}
        healthTone={healthTone}
        healthHeadline={healthHeadline}
      />
    </>
  );
  const detalleFinal = (
    <>
      <ClientesPerdidosCard
        businessId={businessId}
        monthKey={selectedMonthKey}
        monthLabel={analytics.analysisMonthLabel}
        occupancy={analytics.current?.hasData ? analytics.current.occupancy : null}
        ticket={analytics.current?.ticket ?? null}
        employeeLoad={analytics.current?.employeeLoad}
      />
      <RadiografiaSection analytics={analytics} />
    </>
  );

  if (analytics.loading) {
    return (
      <div className="grid place-items-center py-24">
        <ClipprLoader size="screen" delayMs={130} />
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-8">
      {diagnostico}

      {detalleFinal}
    </div>
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
  const clientsQuery = useClientsData(businessId ?? null, { staleTime: 60_000 });
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

// ── Simuladores ────────────────────────────────────────────────────────────


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

// ── RECUPERAR CLIENTES ─────────────────────────────────────────────────────
function LabRecuperar({ data }: { data: LabData }) {
  const [pct, setPct] = React.useState(25);
  if (data.loading) return <LabSkeleton />;

  const pool = data.inact46.count + data.lost76.count;
  if (pool === 0) {
    return (
      <LabEmpty text="¡Buenas noticias! No detectamos clientes perdidos para recuperar. Tu base está viniendo seguido." />
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
  { key: "recuperar", icon: Users, l1: "Recuperar", l2: "Clientes", label: "Recuperar clientes" },
  { key: "productos", icon: Package, l1: "Venta de", l2: "Productos", label: "Venta de productos" },
  { key: "publicidad", icon: Megaphone, l1: "Publicidad", l2: "", label: "Publicidad" },
] as const;

function LaboratorioDecisiones(props: SimuladorProps) {
  const data = useLabData(props.businessId, props.ticket, props.clientes);
  const [sim, setSim] = React.useState<(typeof LAB_SIMS)[number]["key"]>("precios");
  const [infoOpen, setInfoOpen] = React.useState(false);

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
            title="Los simuladores usan tus datos reales (servicios, clientes, agenda y horarios). Las proyecciones son estimaciones con supuestos conservadores."
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
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
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
          {sim === "recuperar" && <LabRecuperar data={data} />}
          {sim === "productos" && <LabProductos data={data} />}
          {sim === "publicidad" && <LabPublicidad data={data} />}
        </div>
      </div>
    </div>
  );
}

function fmtDemandARS(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}
