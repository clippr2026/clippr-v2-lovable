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
import { monthBounds, monthLabel as monthLabelES, shiftMonth } from "@/lib/monthly-performance";
import { MesSelector, RendimientoMensual } from "@/components/advisor/rendimiento-mensual";
import { ClientesPerdidosCard } from "@/components/advisor/clientes-perdidos-card";
import { mesBaseValido, proyectarMes, simularPrecio } from "@/lib/simulador-precios";
import { OcupacionMesCard } from "@/components/advisor/ocupacion-mes-card";
import { TARJETA_CLIPPR, TITULO_CLIPPR, VENTANA_CLIPPR } from "@/components/advisor/estilo-clippr";
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
  ChevronLeft,
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
  // Accesos guardados a la antigua pestaña Simuladores (?tab=simuladores) abren el Simulador de precios.
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
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
  const search = Route.useSearch();
  const vieneDeSimuladores = search.tab === "simuladores";
  const [advisorTab, setAdvisorTab] = React.useState<"acciones" | "analisis">(vieneDeSimuladores ? "acciones" : "analisis");
  // Simulador de precios abierto dentro de Gerente IA (el mes y la sucursal que se miraban se conservan).
  const [verSimulador, setVerSimulador] = React.useState(vieneDeSimuladores);
  // El análisis se inicia una vez por día; las demás veces que se entra, el Asesor abre normal. Mientras no se haga,
  // no se muestran las pestañas.
  const [introDone, setIntroDone] = React.useState(analisisHechoHoy);
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
        <div className="pointer-events-none absolute left-1/2 top-[-120px] z-[-1] h-[620px] w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_17%_4%,rgb(139_92_246_/_0.34),transparent_38%),radial-gradient(circle_at_76%_0%,rgb(79_125_255_/_0.30),transparent_36%),radial-gradient(circle_at_46%_96%,rgb(255_123_229_/_0.14),transparent_50%)] [-webkit-mask-image:linear-gradient(#000_55%,transparent)] [mask-image:linear-gradient(#000_55%,transparent)]" />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Topbar title="Asesor IA" subtitle="Análisis diario y crecimiento del negocio" />
          {introDone && (
            <div className="relative flex w-full items-center justify-end sm:w-auto">
              <div className="pointer-events-none absolute -inset-3 rounded-[30px] bg-gradient-to-r from-cyan-500/15 via-violet-500/12 to-emerald-500/12 [-webkit-mask-image:radial-gradient(closest-side,#000,transparent)] [mask-image:radial-gradient(closest-side,#000,transparent)]" />
              {/* Mobile: grid de 3 columnas iguales — así "Simuladores" (el
                  label más largo) ya no fuerza un botón más ancho que
                  "Análisis"/"Gerente IA" y desalinea el grupo. Desktop
                  (sm+) vuelve a la fila flex de ancho automático de
                  siempre. */}
              <div className="relative grid grid-cols-2 max-w-full items-center gap-2 rounded-[24px] border border-white/12 bg-[#070b18]/75 p-2 shadow-[0_18px_65px_rgba(14,165,233,0.16),inset_0_1px_0_rgba(255,255,255,0.08)] sm:flex sm:overflow-x-auto [&>button]:sm:flex-1">
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
          introDone={introDone}
          setIntroDone={setIntroDone}
          verSimulador={verSimulador}
          setVerSimulador={setVerSimulador}
        />
      </div>
    </AppShell>
  );
}

function AdvisorContent({
  advisorTab,
  setAdvisorTab: _setAdvisorTab,
  introDone,
  setIntroDone,
  verSimulador,
  setVerSimulador,
}: {
  advisorTab: "acciones" | "analisis";
  setAdvisorTab: (t: "acciones" | "analisis") => void;
  verSimulador: boolean;
  setVerSimulador: (v: boolean) => void;
  introDone: boolean;
  setIntroDone: (v: boolean) => void;
}) {
  const { businessId } = useAuth();
  const animationProgress = useResultAnimation(introDone);
  const [iniciado, setIniciado] = React.useState(false);
  const finishIntro = React.useCallback(() => {
    guardarAnalisisHoy();
    setIntroDone(true);
  }, [setIntroDone]);
  const [infoModal, setInfoModal] = React.useState<InfoModalContent | null>(null);
  // Mes elegido en Evolución del negocio: manda sobre las tres tarjetas grandes (Evolución,
  // Salud del negocio y Radiografía del local) — al cambiarlo cambian todos sus datos.
  const currentMonthKey = cajaDateKeyBA().slice(0, 7);
  const [selectedMonthKey, setSelectedMonthKey] = React.useState(currentMonthKey);
  const analytics = useAdvisorAnalytics(businessId, selectedMonthKey);
  // Si falla la carga, se salta la presentación y se muestran las pestañas con el aviso de error.
  React.useEffect(() => {
    if (analytics.entry.error) setIntroDone(true);
  }, [analytics.entry.error, setIntroDone]);
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

  // La primera vez de cada día se pide "Iniciar análisis" y corre la presentación; después abre normal. Si la carga
  // falla, se pasa directo al aviso con Reintentar.
  if (!introDone && !analytics.entry.error && !iniciado) {
    return <AdvisorInicio onStart={() => setIniciado(true)} />;
  }
  if (!introDone && !analytics.entry.error) {
    return (
      <AdvisorIntro
        loaded={{
          ventas: analytics.entry.ventas === "ready",
          clientes: analytics.entry.clientes === "ready",
          turnos: analytics.entry.turnos === "ready",
        }}
        onDone={finishIntro}
      />
    );
  }

  return (
    <div className="space-y-5 sm:space-y-7 max-w-5xl mx-auto w-full">
      {/* Un solo selector de mes para Análisis y Gerente IA (el simulador no depende del mes). */}
      {!(advisorTab === "acciones" && verSimulador) && (
        <MesSelector
          monthKey={selectedMonthKey}
          onMonthKeyChange={setSelectedMonthKey}
          minMonthKey={shiftMonth(currentMonthKey, -(ADVISOR_MONTHS_SELECTABLE - 1))}
        />
      )}
      {advisorTab === "acciones" && verSimulador && (
        <SimuladorPrecios
          businessId={businessId}
          ticket={analytics.current?.ticket ?? 0}
          clientes={analytics.current?.clientsServed ?? 0}
          ocupacionAtendida={analytics.current?.hasData ? analytics.current.occupancy : null}
          onBack={() => setVerSimulador(false)}
        />
      )}

      {advisorTab === "acciones" && !verSimulador && (
        <GrowthManagerTab
          onOpenSimulador={() => setVerSimulador(true)}
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
          <AdvisorEntryNotice analytics={analytics} />
          {/* ── EVOLUCIÓN DEL NEGOCIO ─────────────────────────────── */}
          {/* Mismo fix que Salud del negocio: overflow-hidden contiene el
              glow decorativo (-inset-x-6) para que no fuerce scroll
              horizontal en toda la página. */}
          <div className="relative overflow-hidden rounded-[1.7rem] border border-sky-300/[0.30] bg-white/[0.018] p-2.5 pt-4 shadow-[0_0_0_1px_rgba(56,189,248,0.16),0_24px_90px_-42px_rgba(14,165,233,0.9)] sm:p-3 sm:pt-5">
            <div className="pointer-events-none absolute -inset-x-6 -top-8 h-24 rounded-full bg-sky-400/[0.16] [-webkit-mask-image:radial-gradient(closest-side,#000,transparent)] [mask-image:radial-gradient(closest-side,#000,transparent)]" />
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

// Análisis diario: se inicia una vez por día (día de Buenos Aires); el resto de las entradas abren normal.
const ANALISIS_DIA_KEY = "clippr_advisor_analisis_dia";
function analisisHechoHoy(): boolean {
  try {
    return localStorage.getItem(ANALISIS_DIA_KEY) === cajaDateKeyBA();
  } catch {
    return false;
  }
}
function guardarAnalisisHoy() {
  try {
    localStorage.setItem(ANALISIS_DIA_KEY, cajaDateKeyBA());
  } catch {
    /* sin almacenamiento: se vuelve a pedir */
  }
}

// Pantalla de inicio del análisis diario (estilo Clippr).
function AdvisorInicio({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative flex min-h-[calc(100svh-164px-env(safe-area-inset-bottom))] items-center justify-center px-1 py-3 sm:min-h-[68vh]">
      <div className={cn(VENTANA_CLIPPR, "w-full max-w-md p-5 text-center sm:p-6")}>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[1.6rem] border border-violet-300/30 bg-violet-400/10">
          <Brain className="h-8 w-8 text-violet-200" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-white">Análisis diario</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-white/60">
          El Asesor IA revisa tus ventas, clientes y agenda para decirte cómo está tu negocio hoy.
        </p>
        <button
          type="button"
          onClick={onStart}
          className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-full bg-gradient-to-r from-sky-400 via-violet-500 to-fuchsia-500 text-base font-bold text-white shadow-[0_0_30px_-8px_rgba(139,92,246,0.9)] transition active:scale-[0.99]"
        >
          Iniciar análisis
        </button>
      </div>
    </div>
  );
}

// Presentación al entrar al Asesor IA: un avance por porcentaje en estilo Clippr. Cada paso se
// tilda cuando llegan sus datos reales (con un mínimo de tiempo para que se vea), y la pantalla no se cierra hasta que
// terminó la carga.
function AdvisorIntro({
  loaded,
  onDone,
}: {
  loaded: { ventas: boolean; clientes: boolean; turnos: boolean };
  onDone: () => void;
}) {
  const pasos = [
    { label: "Ventas", icon: DollarSign, ok: loaded.ventas },
    { label: "Clientes", icon: Users, ok: loaded.clientes },
    { label: "Agenda", icon: CalendarDays, ok: loaded.turnos },
    { label: "Armando tu panel", icon: Brain, ok: loaded.ventas && loaded.clientes && loaded.turnos },
  ];

  // Porcentaje gradual (de a 1%): avanza solo hasta donde lo permiten los datos ya cargados — cada paso sin sus
  // datos frena la barra un poco antes del siguiente tramo — y llega a 100% cuando terminó la carga real.
  const [pct, setPct] = React.useState(0);
  let permitidos = 0;
  while (permitidos < pasos.length && pasos[permitidos].ok) permitidos += 1;
  const tope = permitidos >= pasos.length ? 100 : Math.min(99, permitidos * 25 + 22);
  React.useEffect(() => {
    if (pct >= tope) return;
    // Rápido mientras los datos ya llegaron (como cuando entrás por segunda vez); lento solo mientras se espera.
    const demora = pct < permitidos * 25 ? 7 : 30;
    const id = window.setTimeout(() => setPct((p) => Math.min(p + 1, tope)), demora);
    return () => window.clearTimeout(id);
  }, [pct, tope, permitidos]);

  const hechos = pasos.filter((p, i) => p.ok && pct >= (i + 1) * 25).length;
  const total = pasos.length;
  const terminado = pct >= 100;

  React.useEffect(() => {
    if (!terminado) return;
    const id = window.setTimeout(onDone, 600);
    return () => window.clearTimeout(id);
  }, [terminado, onDone]);

  const luz =
    "radial-gradient(110% 90% at 100% 0%, rgba(79,125,255,.16), transparent 62%), radial-gradient(90% 80% at 0% 100%, rgba(139,92,246,.12), transparent 65%)";

  return (
    <div className="relative flex min-h-[calc(100svh-164px-env(safe-area-inset-bottom))] items-center justify-center px-1 py-3 sm:min-h-[68vh]">
      <div
        className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-violet-400/45 bg-[#08070f] p-4 sm:p-6"
        style={{
          boxShadow:
            "0 0 0 1px rgba(139,92,246,.35), 0 30px 90px -20px rgba(0,0,0,.9), 0 0 60px -18px rgba(139,92,246,.55)",
          backgroundImage:
            "radial-gradient(120% 45% at 85% 0%, rgba(79,125,255,.20), transparent 60%), radial-gradient(110% 50% at 0% 100%, rgba(139,92,246,.22), transparent 62%)",
        }}
      >
        <div className="flex flex-col items-center text-center">
          <div className="relative mb-3 h-16 w-16 sm:h-20 sm:w-20">
            <div className="absolute inset-0 scale-[1.5] rounded-full bg-violet-500/25 [-webkit-mask-image:radial-gradient(closest-side,#000,transparent)] [mask-image:radial-gradient(closest-side,#000,transparent)]" />
            <div className="relative grid h-full w-full place-items-center rounded-[1.6rem] border border-violet-300/30 bg-violet-400/10">
              <Brain className="h-8 w-8 text-violet-200 sm:h-10 sm:w-10" />
            </div>
            <svg className="absolute inset-0 h-full w-full animate-spin" style={{ animationDuration: "3s" }} viewBox="0 0 96 96" fill="none">
              <circle cx="48" cy="48" r="46" stroke="url(#introRing)" strokeWidth="2" strokeDasharray="72 220" strokeLinecap="round" />
              <defs>
                <linearGradient id="introRing" x1="0" y1="0" x2="96" y2="96" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="rgb(167 139 250)" />
                  <stop offset="55%" stopColor="rgb(56 189 248)" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h2 className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl">Analizando tu negocio</h2>
          <p className="mt-1 text-sm text-white/55">Preparando tu diagnóstico…</p>
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex justify-center text-sm font-semibold text-white">{pct}%</div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-400 via-violet-500 to-fuchsia-500 shadow-[0_0_24px_rgba(139,92,246,.65)]"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {pasos.map((item, i) => {
            const Icon = item.icon;
            const hecho = i < hechos;
            const actual = i === hechos;
            return (
              <div
                key={item.label}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 transition-all duration-500",
                  hecho ? "border-emerald-400/25" : actual ? "border-violet-300/40" : "border-white/10 opacity-55",
                )}
                style={{ backgroundImage: luz, backgroundColor: "rgba(255,255,255,0.03)" }}
              >
                <span
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-xl ring-1",
                    hecho ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20" : actual ? "bg-violet-400/10 text-violet-200 ring-violet-300/25" : "bg-white/[0.04] text-white/45 ring-white/10",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className={cn("flex-1 text-sm font-semibold", hecho ? "text-emerald-300" : actual ? "text-white" : "text-white/50")}>
                  {item.label}
                  {actual ? "…" : ""}
                </span>
                {hecho ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : actual ? <Loader2 className="h-5 w-5 animate-spin text-violet-200" /> : null}
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}

// Avisos de la entrada al Asesor IA, una vez terminada la carga: error (con Reintentar) o sucursal sin movimientos.
function AdvisorEntryNotice({ analytics }: { analytics: AdvisorAnalytics }) {
  const { entry } = analytics;
  const marco = "relative overflow-hidden rounded-[22px] border p-4 sm:p-5 animate-in fade-in slide-in-from-bottom-1 duration-300";
  if (entry.error) {
    return (
      <div className={cn(marco, "border-rose-400/30 bg-rose-400/[0.07]")}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-300" />
            <p className="text-sm font-semibold text-rose-100">No pude cargar el análisis</p>
          </div>
          <button
            type="button"
            onClick={entry.retry}
            className="rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white ring-1 ring-white/15 hover:bg-white/15"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }
  if (entry.emptyBranch) {
    return (
      <div className={cn(marco, "border-white/12 bg-white/[0.035]")}>
        <div className="flex items-center gap-3">
          <Brain className="h-5 w-5 shrink-0 text-white/50" />
          <p className="text-sm font-semibold text-white/80">Todavía no tengo movimientos para analizar en esta sucursal</p>
        </div>
      </div>
    );
  }
  return null;
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
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-violet-400/16 [-webkit-mask-image:radial-gradient(closest-side,#000,transparent)] [mask-image:radial-gradient(closest-side,#000,transparent)]" />
        <div className="pointer-events-none absolute -left-24 bottom-0 h-56 w-56 rounded-full bg-emerald-400/12 [-webkit-mask-image:radial-gradient(closest-side,#000,transparent)] [mask-image:radial-gradient(closest-side,#000,transparent)]" />
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
  mensual: number; // ventas cobradas del servicio en los últimos 30 días
  /** Comisión efectiva (0 a 1) de las ventas de los últimos 30 días; null si no hay comisiones registradas. */
  comision: number | null;
  /** Ventas cobradas y comisión efectiva del MES ANTERIOR completo (base de la proyección del próximo mes). */
  ventasMesAnt: number;
  comisionMesAnt: number | null;
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

        // Ventas COBRADAS por servicio y la comisión real de esas ventas: últimos 30 días (para el resultado) y mes anterior
        // completo (base de la proyección del próximo mes). Se baja una sola vez la ventana que cubre a las dos.
        const mesAnt = shiftMonth(cajaDateKeyBA().slice(0, 7), -1);
        const limitesAnt = monthBounds(mesAnt);
        const desde30 = new Date(Date.now() - 30 * 86_400_000);
        const desde = new Date(Math.min(desde30.getTime(), limitesAnt.start.getTime())).toISOString();
        const { data: ventas } = await supabase
          .from("payments")
          .select("id,total,amount,items,service_name,created_at")
          .eq("business_id", businessId)
          .gte("created_at", desde)
          .not("status", "in", "(anulado,reembolsado,pendiente)");
        if (cancelled) return;

        const ids = (ventas ?? []).map((v) => v.id as string);
        const lotes: string[][] = [];
        for (let k = 0; k < ids.length; k += 150) lotes.push(ids.slice(k, k + 150));
        const respuestas = await Promise.all(
          lotes.map((l) => supabase.from("commission_records" as any).select("sale_id,amount").in("sale_id", l)),
        );
        if (cancelled) return;
        const comisionPorVenta = new Map<string, number>();
        for (const r of respuestas) for (const c of ((r.data ?? []) as any[])) comisionPorVenta.set(c.sale_id, (comisionPorVenta.get(c.sale_id) ?? 0) + Number(c.amount ?? 0));

        const agregar = (incluir: (creado: number) => boolean) => {
          const cuenta: Record<string, number> = {};
          const ingreso: Record<string, number> = {};
          const comision: Record<string, number> = {};
          for (const v of (ventas ?? []) as any[]) {
            if (!incluir(new Date(v.created_at).getTime())) continue;
            const lineas = Array.isArray(v.items) ? v.items.filter((it: any) => it && !it.is_catalog) : [];
            const entradas = lineas.length > 0
              ? lineas.map((it: any) => ({ name: String(it.name ?? ""), qty: Number(it.qty ?? 1) > 0 ? Number(it.qty ?? 1) : 1 }))
              : [{ name: String(v.service_name ?? ""), qty: 1 }];
            const total = Number(v.total ?? v.amount ?? 0);
            const com = comisionPorVenta.get(v.id) ?? 0;
            // Ventas con varios servicios: la comisión se reparte en partes iguales entre sus líneas.
            for (const e of entradas) {
              const key = e.name.toLowerCase().trim();
              if (!key) continue;
              cuenta[key] = (cuenta[key] ?? 0) + e.qty;
              ingreso[key] = (ingreso[key] ?? 0) + total / entradas.length;
              comision[key] = (comision[key] ?? 0) + com / entradas.length;
            }
          }
          return { cuenta, ingreso, comision };
        };
        const tasa = (g: ReturnType<typeof agregar>, key: string) =>
          (g.ingreso[key] ?? 0) > 0 && (g.comision[key] ?? 0) > 0 ? Math.min(1, g.comision[key] / g.ingreso[key]) : null;
        const g30 = agregar((t) => t >= desde30.getTime());
        const gAnt = agregar((t) => t >= limitesAnt.start.getTime() && t <= limitesAnt.end.getTime());

        const mapped: ServicioReal[] = (catalog ?? []).map((s) => {
          const key = (s.name ?? "").toLowerCase().trim();
          return {
            id: s.id,
            nombre: s.name,
            precio: Number(s.price ?? 0),
            mensual: g30.cuenta[key] ?? 0,
            comision: tasa(g30, key),
            ventasMesAnt: gAnt.cuenta[key] ?? 0,
            comisionMesAnt: tasa(gAnt, key),
          };
        });

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
const ESTADO_CHIP: Record<"parcial" | "insuficiente", { text: string; cls: string }> = {
  parcial: { text: "Parcial", cls: "border-amber-300/30 bg-amber-300/10 text-amber-200" },
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
                {ind.pts} <span className="text-white/40">/ {ind.max}</span>
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
          {ind.datos.length > 0 && (
            <div>
              <b className="text-white">Datos que se usaron:</b>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {ind.datos.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          <p>
            <b className="text-white">Puntos obtenidos:</b>{" "}
            {ind.pts != null ? `${ind.pts} de ${ind.max}${ind.evaluable < ind.max ? ` (se pudieron evaluar ${ind.evaluable})` : ""}` : "todavía no se puede evaluar"}
          </p>
          <p>
            <b className="text-white">Máximo:</b> {ind.escala}
          </p>
        </div>
      )}
    </div>
  );
}

function SaludSection({
  analytics,
  animatedHealth,
  healthTone,
  healthHeadline,
}: {
  analytics: AdvisorAnalytics;
  animatedHealth: number;
  healthTone: { text: string; bar: string };
  healthHeadline: string;
}) {
  const score = analytics.healthScore;
  const tarjeta = `${TARJETA_CLIPPR} p-4`;
  return (
    <div className={VENTANA_CLIPPR}>
      <h2 className={cn(TITULO_CLIPPR, "relative mb-3 mt-1 text-center")}>Salud del negocio</h2>
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
                  {score?.total == null ? "—" : Math.round(score.total * (analytics.health ? animatedHealth / analytics.health : 1))}
                </span>
                <span className="mt-0.5 text-[11px] text-white/45">de {score?.partial ? score.available : 100}</span>
              </div>
            </div>
            <div className="min-w-0">
              <div className={cn("text-xl font-semibold leading-tight", healthTone.text)}>{healthHeadline}</div>
              {analytics.health == null && (
                <p className="mt-1 text-xs leading-relaxed text-white/60">Todavía no hay datos para calcular la salud del negocio.</p>
              )}
              {score?.requiereAtencion && (
                <span className="mt-1 inline-block rounded-full border border-rose-300/30 bg-rose-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-rose-200">
                  Requiere atención
                </span>
              )}
            </div>
          </div>
          {score && score.partial && (
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
              {score.partial && (
                <span className={cn("rounded-full border px-2.5 py-1 font-semibold", ESTADO_CHIP.parcial.cls)}>
                  Resultado parcial: se pudieron evaluar {score.available} de 100 puntos
                </span>
              )}
            </div>
          )}
        </section>

        <section className={tarjeta}>
          <div className="text-sm font-semibold text-white">Cómo se arma el puntaje</div>
          <div className="text-[11px] text-white/50">Tocá cada tarjeta para ver los datos que se usaron y el máximo de puntos.</div>
          <div className="mt-3 space-y-2">
            {score ? (
              score.indicators.map((ind) => <IndicadorSalud key={ind.key} ind={ind} />)
            ) : (
              <p className="text-sm text-white/55">Todavía no hay datos para calcular la salud del negocio.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// Radiografía del equipo: solo lo que NO está ya en Salud, Radar o Análisis (clientes para recuperar, turnos vacíos).
function RadiografiaSection({ analytics }: { analytics: AdvisorAnalytics }) {
  const items = analytics.radiografia.filter((i) => i.key !== "recuperar" && i.key !== "turnos-vacios" && i.key !== "prof-top" && i.key !== "prof-bottom");
  return (
    <div className={VENTANA_CLIPPR}>
      <div className={cn(TARJETA_CLIPPR, "p-3.5 sm:p-5")}>
        <h2 className={TITULO_CLIPPR}>Equipo, servicios y clientes</h2>
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
      </div>
    </div>
  );
}

type GrowthManagerTabProps = {
  onOpenSimulador: () => void;
  analytics: AdvisorAnalytics;
  businessId: string | null | undefined;
  selectedMonthKey: string;
  onMonthKeyChange: (k: string) => void;
  minMonthKey: string;
  animatedHealth: number;
  healthTone: { text: string; bar: string };
  healthHeadline: string;
};

function GrowthManagerTab({ onOpenSimulador, analytics, businessId, selectedMonthKey, onMonthKeyChange, minMonthKey, animatedHealth, healthTone, healthHeadline }: GrowthManagerTabProps) {
  // Diagnóstico: salud + radar arriba; clientes para recuperar y radiografía del equipo al final. Nada se repite con Análisis.
  const diagnostico = (
    <>
      <SaludSection
        analytics={analytics}
        animatedHealth={animatedHealth}
        healthTone={healthTone}
        healthHeadline={healthHeadline}
      />
    </>
  );
  const detalleFinal = (
    <>
      <RadiografiaSection analytics={analytics} />
      <OcupacionMesCard
        monthLabel={analytics.analysisMonthLabel}
        agendada={analytics.current?.agendadaPct ?? null}
        atendida={analytics.current?.hasData ? analytics.current.occupancy : null}
        franjas={analytics.current?.franjas}
      />
      <ClientesPerdidosCard
        businessId={businessId}
        monthKey={selectedMonthKey}
        monthLabel={analytics.analysisMonthLabel}
        ticket={analytics.current?.ticket ?? null}
      />
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

      <button
        type="button"
        onClick={onOpenSimulador}
        className="flex h-12 w-full items-center gap-3 rounded-full border border-violet-400/45 bg-[#08070f] px-4 text-left shadow-[0_0_0_1px_rgba(139,92,246,0.25),0_0_30px_-12px_rgba(139,92,246,0.7)] transition active:scale-[0.99] [background-image:radial-gradient(120%_120%_at_85%_0%,rgba(79,125,255,0.18),transparent_60%),radial-gradient(110%_120%_at_0%_100%,rgba(139,92,246,0.2),transparent_62%)]"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-300/30">
          <DollarSign className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm font-semibold text-white">Simulador de precios</span>
        <ArrowRight className="h-4 w-4 text-white/60" />
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  LABORATORIO DE DECISIONES — 7 simuladores para barberías y peluquerías.
//  Reemplaza la experiencia de "Simuladores". Cálculos deterministas e
//  instantáneos con datos reales donde existen (servicios, clientes, agenda,
//  horarios) + supuestos claros y editables. No toca el resto de la app.
// ══════════════════════════════════════════════════════════════════════════

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
function LabPrecios({ data, ocupacionAtendida, seFueronPorPrecio }: { data: LabData; ocupacionAtendida: number | null; seFueronPorPrecio: number }) {
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
  const r = simularPrecio({
    precioActual,
    aumento,
    ventas30: mensual,
    comision: svc?.comision ?? null,
    ocupacionAtendida,
    seFueronPorPrecio,
  });
  const { precioNuevo, pctAumento: pct, facturacionAdicional: facturacion, gananciaAdicional: utilidad, puntoEquilibrio: perdibles } = r;
  const riesgoLabel = r.riesgo;
  const riesgoChip =
    r.riesgo === "Alto" ? "border-rose-300/35 bg-rose-400/10 text-rose-200" : r.riesgo === "Medio" ? "border-amber-300/35 bg-amber-300/10 text-amber-200" : "border-emerald-300/35 bg-emerald-400/10 text-emerald-200";
  const nivel: keyof typeof nivelMeta =
    r.riesgo === "Alto" ? "alto_riesgo" : r.riesgo === "Medio" ? (pct <= 12 ? "evaluar" : "progresivo") : "recomendado";
  const verdict =
    r.riesgo === "Alto"
      ? `Subir ${fmtAR(aumento)} es un ${pct.toFixed(0)}% sobre ${svc?.nombre}. ${r.factores.slice(1).length > 0 ? `Pesa: ${r.factores.slice(1).join(", ")}. ` : ""}Mejor un aumento menor o en dos etapas.`
      : mensual === 0
        ? `No hay ventas cobradas de ${svc?.nombre} en los últimos 30 días para proyectar el impacto. La estimación no es confiable.`
        : `Con ${mensual} ventas en los últimos 30 días, subir ${fmtAR(aumento)} suma hasta ${fmtAR(facturacion)} si todos siguen viniendo. Dejaría de convenir si se pierden más de ${perdibles} ventas al mes. ${r.factores.length > 1 ? `Riesgo ${riesgoLabel.toLowerCase()} por: ${r.factores.join(", ")}.` : "Depende de cuántos clientes sigan comprando al nuevo precio."}`;

  // Proyección del próximo mes con las mismas ventas del MES ANTERIOR completo. Si ese mes fue diciembre (alta demanda),
  // no se compara.
  const mesAnteriorKey = shiftMonth(cajaDateKeyBA().slice(0, 7), -1);
  const baseValida = mesBaseValido(mesAnteriorKey);
  const proyeccion =
    baseValida && (svc?.ventasMesAnt ?? 0) > 0
      ? proyectarMes({ precioActual, aumento, ventasBase: svc?.ventasMesAnt ?? 0, comision: svc?.comisionMesAnt ?? null })
      : null;
  const maxAumento = Math.max(5000, Math.round(precioActual));
  const meta = nivelMeta[nivel];
  const VeredictoIcon = meta.icon;

  return (
    <div className="space-y-3">
      {/* 1. Simular: servicio, aumento y nuevo precio */}
      <div className={TARJETA_CLIPPR}>
        <label className="block text-sm font-semibold text-white" htmlFor="sim-servicio">
          Servicio
        </label>
        <select
          id="sim-servicio"
          value={svc?.id ?? ""}
          onChange={(e) => setSvcId(e.target.value)}
          className="mt-1.5 h-11 w-full rounded-xl border border-white/12 bg-white/[0.05] px-3 text-sm font-semibold text-white outline-none focus:border-violet-300/50"
        >
          {services.map((s) => (
            <option key={s.id} value={s.id} className="bg-[#0b0a14] text-white">
              {s.nombre}
            </option>
          ))}
        </select>

        <div className="mt-4 flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-white">Aumento de precio</span>
          <span className="text-right leading-none">
            <span className="block text-2xl font-extrabold text-cyan-200">+{fmtAR(aumento)}</span>
            <span className="mt-1 block text-sm font-bold text-cyan-100/80">+{pct.toFixed(1).replace(".", ",")}%</span>
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={maxAumento}
          step={100}
          value={aumento}
          onChange={(e) => setAumento(Number(e.target.value))}
          aria-label="Aumento de precio"
          className="mt-2 h-2 w-full accent-cyan-400"
        />
        <div className="mt-1 flex justify-between text-[11px] font-semibold text-white/45">
          <span>Sin aumento</span>
          <span>+{fmtAR(maxAumento)}</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-white/[0.04] p-2.5 ring-1 ring-white/10">
            <div className="text-[11px] text-white/55">Precio actual</div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-white">{fmtAR(precioActual)}</div>
          </div>
          <div className="rounded-xl bg-emerald-400/10 p-2.5 ring-1 ring-emerald-300/25">
            <div className="text-[11px] text-emerald-100/70">Nuevo precio ({pct.toFixed(1).replace(".", ",")}% más)</div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-emerald-200">{fmtAR(precioNuevo)}</div>
          </div>
        </div>
      </div>

      {/* 2. Resultado: una sola tarjeta con la parte económica */}
      <div className={cn(TARJETA_CLIPPR, "border-cyan-300/25 shadow-[0_0_40px_-18px_rgba(34,211,238,0.6)]")}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-white">Resultado estimado</span>
          <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-bold", riesgoChip)}>Riesgo {riesgoLabel.toLowerCase()}</span>
        </div>
        <div className="mt-2.5 text-[11px] text-white/55">Facturación adicional mensual</div>
        <div className="text-3xl font-extrabold tabular-nums leading-tight text-cyan-200">+{fmtAR(facturacion)}</div>
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-white/10 pt-2">
          <span className="text-xs text-white/60">Ganancia adicional{r.comisionReal ? ` (comisión ${Math.round(r.comisionUsada * 100)}%)` : " (comisión de referencia)"}</span>
          <span className="text-lg font-bold tabular-nums text-emerald-300">+{fmtAR(utilidad)}</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-white/10 pt-2">
          <span className="text-xs text-white/60">Punto de equilibrio</span>
          <span className="text-right text-sm font-semibold tabular-nums text-white">
            {mensual > 0 ? `hasta ${perdibles} ${perdibles === 1 ? "venta" : "ventas"} menos al mes (${r.puntoEquilibrioPct.toFixed(1).replace(".", ",")}%)` : "sin ventas para calcular"}
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-white/40">
          Facturación y ganancia suponen que todos los clientes siguen viniendo. El riesgo es una estimación orientativa: Clippr no sabe cuántos clientes se irían.
        </p>
      </div>

      {/* Proyección del próximo mes: mismas ventas y pagos del mes anterior completo */}
      <div className={TARJETA_CLIPPR}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-white">Próximo mes</span>
          <span className="text-[11px] text-white/45">base: {monthLabelES(mesAnteriorKey)}</span>
        </div>
        {!baseValida ? (
          <p className="mt-2 text-xs leading-relaxed text-white/60">
            No se compara contra diciembre: es un mes de alta demanda y no representa un mes normal.
          </p>
        ) : proyeccion == null ? (
          <p className="mt-2 text-xs leading-relaxed text-white/60">
            No hay ventas cobradas de {svc?.nombre} en {monthLabelES(mesAnteriorKey)} para proyectar.
          </p>
        ) : (
          <>
            <p className="mt-1.5 text-xs text-white/55">
              Con las mismas {proyeccion.sinAumento.ventas} ventas de {monthLabelES(mesAnteriorKey)}: sin aumento facturarías{" "}
              {fmtAR(proyeccion.sinAumento.facturacion)}.
            </p>
            <div className="mt-2 space-y-1.5">
              {proyeccion.escenarios.map((e) => (
                <div key={e.perdidaPct} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/10">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white">
                      {e.perdidaPct === 0 ? "Si todos siguen viniendo" : `Si se pierde el ${e.perdidaPct}% de las ventas`}
                    </div>
                    <div className="text-[11px] text-white/50">
                      {e.ventas} ventas · {fmtAR(e.facturacion)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={cn("text-sm font-bold tabular-nums", e.difFacturacion >= 0 ? "text-emerald-300" : "text-rose-300")}>
                      {e.difFacturacion >= 0 ? "+" : "-"}
                      {fmtAR(Math.abs(e.difFacturacion))}
                    </div>
                    <div className={cn("text-[11px] tabular-nums", e.difGanancia >= 0 ? "text-emerald-200/80" : "text-rose-200/80")}>
                      ganancia {e.difGanancia >= 0 ? "+" : "-"}
                      {fmtAR(Math.abs(e.difGanancia))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-white/40">Diferencia contra no subir el precio, con la comisión real de ese mes.</p>
          </>
        )}
      </div>

      {/* 3. Gerente IA: veredicto breve */}
      <div className={cn("rounded-2xl border px-3.5 py-3", meta.cls)}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-white">
            <VeredictoIcon className={cn("h-4 w-4", meta.titleCls)} /> Veredicto del Gerente IA
          </span>
          <span className={cn("rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold", meta.titleCls)}>{meta.label}</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-white/80">{verdict}</p>
      </div>
    </div>
  );
}

// ── RECUPERAR CLIENTES ─────────────────────────────────────────────────────

// ── VENTA DE PRODUCTOS ─────────────────────────────────────────────────────
const PRODUCT_TARGETS = [6, 10, 15, 20, 25];


// ── FIDELIZACIÓN ───────────────────────────────────────────────────────────

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

function SimuladorPrecios({
  businessId,
  ticket,
  clientes,
  ocupacionAtendida,
  onBack,
}: {
  businessId: string | null | undefined;
  ticket: number;
  clientes: number;
  ocupacionAtendida: number | null;
  onBack: () => void;
}) {
  const data = useLabData(businessId, ticket, clientes);
  // Clientes que se fueron por el precio en los últimos 30 días (botón "Se fue" de la Agenda).
  const [seFueronPorPrecio, setSeFueronPorPrecio] = React.useState(0);
  React.useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void ((supabase.from("clientes_no_atendidos" as any) as any)
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("preferencia", "precio")
      .gte("occurred_at", new Date(Date.now() - 30 * 86_400_000).toISOString()) as PromiseLike<{ count: number | null; error: unknown }>).then(({ count, error }) => {
      if (!cancelled && !error) setSeFueronPorPrecio(count ?? 0);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId]);
  return (
    <div className="space-y-3 pb-28">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-4 text-sm font-semibold text-white/80 transition hover:text-white"
      >
        <ChevronLeft className="h-4 w-4" /> Volver
      </button>
      <div className={VENTANA_CLIPPR}>
        <div className="mb-3 flex items-center gap-2 px-1">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-300/30">
            <DollarSign className="h-4 w-4" />
          </span>
          <h2 className={TITULO_CLIPPR}>Simulador de precios</h2>
        </div>
        <LabPrecios data={data} ocupacionAtendida={ocupacionAtendida} seFueronPorPrecio={seFueronPorPrecio} />
      </div>
    </div>
  );
}

function fmtDemandARS(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}
