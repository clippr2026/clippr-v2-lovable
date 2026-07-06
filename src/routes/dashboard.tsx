import * as React from "react";
import { cn } from "@/lib/utils";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { AccessDenied, usePermGuard } from "@/hooks/use-perm-guard";
import { DateRangePicker } from "@/components/date-range-picker";
import {
  useDashboardData,
  fmtAR,
  type DashboardData,
  type RecentCancellation,
} from "@/components/dashboard/use-dashboard-data";
import {
  DollarSign,
  ArrowDownCircle,
  Wallet,
  XCircle,
  ChevronDown,
} from "lucide-react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { ClipprLoader } from "@/components/ui/clippr-loader";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Clippr" },
      { name: "description", content: "Panel premium para barberías y salones." },
    ],
  }),
  component: DashboardRoute,
});

function DashboardRoute() {
  const hasAccess = usePermGuard("dashboard");
  const { loading, session, businessId, profile } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!loading && !session) navigate({ to: "/login", replace: true });
  }, [loading, session, navigate]);

  if (!hasAccess) return <AccessDenied />;

  if (loading || !session) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <ClipprLoader size="screen" delayMs={130} />
      </div>
    );
  }

  const firstName = (profile?.full_name ?? "Usuario").split(" ")[0];

  return (
    <AppShell>
      <h1 className="mb-2 font-display text-[1.65rem] leading-tight sm:text-3xl font-semibold tracking-tight">
        Resumen del negocio
      </h1>
      <DashboardContent businessId={businessId} />
    </AppShell>
  );
}

// Fecha local (YYYY-MM-DD) según el reloj/timezone del navegador — nunca usar
// toISOString() acá: convierte a UTC y en Argentina (UTC-3) eso adelanta la
// fecha al día siguiente durante la noche (ej. 21:00 ART ya es 00:00 UTC).
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function DashboardContent({ businessId }: { businessId: string | null }) {
  const todayStr = React.useMemo(() => localDateStr(new Date()), []);
  const [fromStr, setFromStr] = React.useState(todayStr);
  const [toStr, setToStr] = React.useState(todayStr);

  const range = React.useMemo(() => {
    const MIN = new Date("2000-01-01");
    const MAX = new Date("2099-12-31");
    const from = new Date(fromStr + "T00:00:00");
    const to   = new Date(toStr   + "T23:59:59");
    // If either date is invalid or out of range, return null to show zeros
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from < MIN || to > MAX) return null;
    if (to < from) return { from: to, to: from };
    return { from, to };
  }, [fromStr, toStr]);

  const { data, isLoading, error } = useDashboardData(businessId, range ?? null);
  const [activeMetric, setActiveMetric] = React.useState<"ingresos"|"gastos"|"utilidad">("ingresos");

  const setQuickRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (days - 1));
    setFromStr(localDateStr(from));
    setToStr(localDateStr(to));
  };

  if (!businessId) {
    return (
      <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
        No se encontró un negocio asignado a esta cuenta.
      </div>
    );
  }

  const dateBar = (
    <div className="glass dashboard-date-glow rounded-2xl p-2 sm:p-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="uppercase tracking-wider">Rango</span>
      </div>
      <DateRangePicker
        className="w-full sm:w-auto"
        from={fromStr}
        to={toStr}
        onChange={({ from, to }) => {
          setFromStr(from);
          setToStr(to);
        }}
      />
    </div>
  );

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        {dateBar}
        <div className="grid place-items-center py-32">
          <ClipprLoader size="screen" delayMs={130} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {dateBar}
        <div className="glass rounded-2xl p-6 text-sm text-destructive">
          Error cargando dashboard: {(error as Error).message}
        </div>
      </div>
    );
  }

  const utilidad = data.utilidad;

  return (
    <div className="dashboard-premium-shell space-y-3 animate-fade-up">
      {dateBar}
      {/* Top stat cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <Stat
          active={activeMetric === "ingresos"}
          onClick={() => setActiveMetric("ingresos")}
          label="Ingresos"
          value={fmtAR(data.revHoy)}
          icon={DollarSign}
          tone="primary"
        />
        <Stat
          active={activeMetric === "gastos"}
          onClick={() => setActiveMetric("gastos")}
          label="Gastos"
          value={fmtExpenseAR(data.totalGastos)}
          icon={ArrowDownCircle}
          tone="danger"
        />
        <Stat
          active={activeMetric === "utilidad"}
          onClick={() => setActiveMetric("utilidad")}
          label="Utilidad"
          value={fmtAR(utilidad)}
          icon={Wallet}
          tone="success"
        />
      </section>
{/* Revenue chart + breakdown */}
      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(300px,1fr)] gap-3 items-stretch">
        <RevenueChart data={data} activeMetric={activeMetric} fromStr={fromStr} toStr={toStr} />
        <ServicesDonut data={data} activeMetric={activeMetric} />
      </section>

    </div>
  );
}

const TONE = {
  primary: {
    ring: "ring-primary/20",
    bg: "bg-primary/10",
    icon: "text-primary",
    fillFrom: "oklch(0.66 0.22 265 / 0.3)",
    fillTo: "oklch(0.66 0.22 265 / 0)",
    stroke: "oklch(0.66 0.22 265)",
  },
  danger: {
    ring: "ring-rose-400/20",
    bg: "bg-rose-400/10",
    icon: "text-rose-400",
    fillFrom: "rgb(251 113 133 / 0.3)",
    fillTo: "rgb(251 113 133 / 0)",
    stroke: "rgb(251 113 133)",
  },
  success: {
    ring: "ring-emerald-400/20",
    bg: "bg-emerald-400/10",
    icon: "text-emerald-400",
    fillFrom: "rgb(52 211 153 / 0.3)",
    fillTo: "rgb(52 211 153 / 0)",
    stroke: "rgb(52 211 153)",
  },
  neutral: {
    ring: "ring-white/10",
    bg: "bg-white/5",
    icon: "text-muted-foreground",
    fillFrom: "rgb(255 255 255 / 0.15)",
    fillTo: "rgb(255 255 255 / 0)",
    stroke: "rgb(255 255 255 / 0.4)",
  },
} as const;

function Stat({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  active = false,
  onClick,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof TONE;
  active?: boolean;
  onClick?: () => void;
}) {
  const t = TONE[tone];

  return (
    <div
      onClick={onClick}
      className={cn(
        // min-h fijo: el alto de la tarjeta nunca depende del largo del monto
        // ($0 vs $395.138) ni de si hay datos ese día.
        "glass rounded-2xl p-4 min-h-[108px] relative overflow-hidden transition-all duration-200 ease-out hover:-translate-y-0.5",
        // El borde/glow de hover y del estado activo dependen del tono (ver
        // styles.css: .stat-glow-{tone}:hover y .stat-glow-{tone}.stat-active).
        // El azul ya NO se aplica nunca a Gastos (danger) ni Utilidad (success).
        tone === "primary" && "stat-glow-primary",
        tone === "danger" && "stat-glow-danger",
        tone === "success" && "stat-glow-success",
        tone === "neutral" && "glass-hover",
        onClick && "cursor-pointer",
        active && "stat-active",
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className={`h-9 w-9 rounded-xl grid place-items-center ring-1 ${t.ring} ${t.bg}`}>
          <Icon className={`h-4 w-4 ${t.icon}`} />
        </div>
        <span className="text-sm">{label}</span>
      </div>
      <div className="mt-2 min-w-0">
        <div className="font-display text-3xl font-semibold tracking-tight truncate">{value}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue chart (7d)
// ---------------------------------------------------------------------------
function fmtExpenseAR(value: number) {
  const abs = Math.abs(Math.round(value || 0));
  return abs > 0 ? `-$${abs.toLocaleString("es-AR")}` : "$0";
}

function RevenueChart({ data, activeMetric, fromStr, toStr }: {
  data: DashboardData;
  activeMetric: "ingresos" | "gastos" | "utilidad";
  fromStr: string;
  toStr: string;
}) {
  const isSingleDay = fromStr === toStr;

  const rawHourlyGastos = data.hoursGastosValues ?? data.hoursValues.map(() => 0);
  const rawDailyGastos = data.gastosByDay ?? data.revByDay.map(() => 0);

  // Si el gasto no tiene hora real, no lo dejamos en 0: lo ubicamos al inicio del día.
  // Así "Gastos" muestra el total real y "Utilidad" resta correctamente.
  const hourlyGastos =
    isSingleDay && data.totalGastos > 0 && rawHourlyGastos.every((v) => Number(v || 0) === 0)
      ? rawHourlyGastos.map((_, i) => (i === 0 ? data.totalGastos : 0))
      : rawHourlyGastos;

  const dailyGastos =
    !isSingleDay && data.totalGastos > 0 && rawDailyGastos.every((v) => Number(v || 0) === 0)
      ? rawDailyGastos.map((_, i) => (i === 0 ? data.totalGastos : 0))
      : rawDailyGastos;

  const metricConfig: Record<"ingresos" | "gastos" | "utilidad", { label: string; values: number[]; fmt: (v: number) => string; total: number }> = {
    ingresos: {
      label: "Ingresos",
      values: isSingleDay ? data.hoursValues : data.revByDay,
      fmt: fmtAR,
      total: data.revHoy,
    },
    gastos: {
      label: "Gastos",
      values: isSingleDay ? hourlyGastos : dailyGastos,
      fmt: fmtExpenseAR,
      total: data.totalGastos,
    },
    utilidad: {
      label: "Utilidad",
      values: isSingleDay
        ? data.hoursValues.map((v, i) => v - (hourlyGastos[i] ?? 0))
        : data.revByDay.map((v, i) => v - (dailyGastos[i] ?? 0)),
      fmt: fmtAR,
      total: data.utilidad,
    },
  };

  const cfg = metricConfig[activeMetric] ?? metricConfig.ingresos;

  const chart = isSingleDay
    ? data.hoursLabels.map((h, i) => ({
        day: h,
        value: cfg.values[i] ?? 0,
      }))
    : data.days7.map((d, i) => ({
        day: new Date(d + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" }),
        value: cfg.values[i] ?? 0,
      }));

  const rangeLabel = isSingleDay
    ? `Hoy · ${new Date(fromStr + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })}`
    : `${new Date(fromStr + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })} al ${new Date(toStr + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}`;

  const strokeColor =
    activeMetric === "gastos"
      ? "rgb(251 113 133)"
      : activeMetric === "utilidad"
        ? "rgb(52 211 153)"
        : "oklch(0.72 0.2 245)";

  return (
    <div className="glass dashboard-chart-glow rounded-2xl p-4 relative overflow-hidden h-[500px] flex flex-col">
      <div className="pointer-events-none absolute -top-20 left-1/4 h-40 w-56 rounded-full bg-primary/20 blur-[90px]" />
      <div className="pointer-events-none absolute -bottom-24 right-1/4 h-40 w-56 rounded-full bg-cyan-400/10 blur-[90px]" />
      <div className="relative flex items-start justify-between shrink-0">
        <div>
          <div className="text-xs text-muted-foreground">{cfg.label}</div>
          <div className="font-display text-2xl font-semibold tracking-tight mt-0.5">
            {cfg.fmt(cfg.total)}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{rangeLabel}</div>
        </div>
      </div>
      {/* flex-1: el gráfico ocupa todo el alto restante de la tarjeta (en vez
          de una altura fija chica), así su base queda cerca del borde
          inferior sin agrandar la tarjeta ni generar scroll. */}
      <div className="revenue-area-glow flex-1 min-h-[160px] mt-2 -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart key={activeMetric} data={chart} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`chart-grad-${activeMetric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity={0.42} />
                <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="oklch(1 0 0 / 0.05)" vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              interval={2}
              tick={{ fill: "oklch(0.65 0.025 270)", fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "oklch(0.65 0.025 270)", fontSize: 11 }}
              width={58}
              domain={activeMetric === "utilidad" ? ["auto", "auto"] : [0, "auto"]}
              tickFormatter={(v) => {
                const n = Number(v);
                const sign = n < 0 ? "-" : "";
                const abs = Math.abs(n);
                return abs >= 1000 ? `${sign}${Math.round(abs / 1000)}k` : `${sign}${abs}`;
              }}
            />
            <Tooltip
              contentStyle={{
                background: "oklch(0.14 0.03 282)",
                border: "1px solid oklch(1 0 0 / 0.08)",
                borderRadius: 12,
                fontSize: 12,
              }}
              labelStyle={{ color: "oklch(0.85 0 0)" }}
              formatter={(v: number) => [cfg.fmt(Number(v)), cfg.label]}
            />
            {activeMetric === "utilidad" ? (
              <ReferenceLine y={0} stroke="oklch(1 0 0 / 0.18)" strokeDasharray="4 4" />
            ) : null}
            <Area
              type="monotone"
              dataKey="value"
              stroke={strokeColor}
              strokeWidth={2.5}
              fill={`url(#chart-grad-${activeMetric})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Services donut
// ---------------------------------------------------------------------------
const DONUT_COLORS = [
  "oklch(0.82 0.16 200)", // cyan
  "oklch(0.72 0.26 305)", // purple
  "oklch(0.76 0.2 155)", // green
  "oklch(0.78 0.17 55)", // orange
  "oklch(0.72 0.2 245)", // blue
  "oklch(0.66 0.24 25)", // red
];

const INCOME_TAB_ALL = "Todos";
const INCOME_TAB_SERVICES = "Servicios";
// Tope de elementos visibles en el listado de "Todos" (categorías) y en los
// gastos expandidos por tipo — sin scroll y sin botón "Ver más".
const MAX_LIST_ROWS = 9;

// Comportamiento uniforme para CUALQUIER pestaña de Ingresos (Servicios o
// cualquier categoría, incluidas las que crea el usuario, sin diccionario
// hardcodeado): el botón usa el nombre tal cual ("Ver bebidas", "Ver
// indumentaria"), y el conteo agrega o quita la "s" final según corresponda
// ("1 servicio" / "2 servicios", "1 indumentaria" / "3 indumentarias").
function categoryButtonLabel(categoryName: string): string {
  return `Ver ${categoryName.trim().toLowerCase()}`;
}
function categoryCountNoun(categoryName: string, count: number): string {
  const raw = categoryName.trim();
  const endsInS = /s$/i.test(raw);
  const noun = count === 1 ? (endsInS ? raw.slice(0, -1) : raw) : endsInS ? raw : `${raw}s`;
  return noun.toLowerCase();
}

type DetailModalRow = { name: string; amount: number; pct: number };
type DetailModalState = { title: string; total: number; rows: DetailModalRow[] } | null;

function ServicesDonut({
  data,
  activeMetric,
}: {
  data: DashboardData;
  activeMetric: "ingresos" | "gastos" | "utilidad";
}) {
  // Sub-tabs de Ingresos: Todos / Servicios / una por cada categoría real del
  // catálogo (dinámicas, igual que en Caja → Nueva venta — nada hardcodeado).
  const [incomeTab, setIncomeTab] = React.useState<string>(INCOME_TAB_ALL);
  // Gastos: categorías (Fijo/Variable/Ocasional/Marketing) expandidas para
  // listar debajo los gastos individuales de ese tipo.
  const [expandedExpenseTypes, setExpandedExpenseTypes] = React.useState<Set<string>>(new Set());
  // Modal con el detalle completo (torta + listado) de Servicios o de una
  // categoría del catálogo — el card principal solo muestra un resumen.
  const [detailModal, setDetailModal] = React.useState<DetailModalState>(null);
  // Selector de Ingresos: un solo botón desplegable en vez de pestañas
  // múltiples, para no ocupar espacio ni achicar la torta.
  const [incomeMenuOpen, setIncomeMenuOpen] = React.useState(false);
  const incomeMenuRef = React.useRef<HTMLDivElement | null>(null);

  const serviceItems = data.topServices;
  const catalogCategories = data.topCatalog;
  const expenseTypes = data.topExpenses;

  const servicesTotal = serviceItems.reduce((sum, item) => sum + Number(item.rev || 0), 0);

  // Nunca se agrupa nada en un "Otros" automático: se listan TODAS las
  // categorías reales del catálogo como opciones del desplegable.
  const incomeTabs = React.useMemo(
    () => [INCOME_TAB_ALL, INCOME_TAB_SERVICES, ...catalogCategories.map((c) => c.category)],
    [catalogCategories],
  );

  React.useEffect(() => {
    if (!incomeMenuOpen) return;
    function onOutsideClick(event: MouseEvent) {
      if (incomeMenuRef.current && !incomeMenuRef.current.contains(event.target as Node)) {
        setIncomeMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onOutsideClick, true);
    return () => document.removeEventListener("pointerdown", onOutsideClick, true);
  }, [incomeMenuOpen]);

  // Si la categoría seleccionada deja de existir (cambió el rango de fechas y
  // ya no hay ventas de esa categoría), volver a "Todos" en vez de mostrar una
  // pestaña fantasma.
  React.useEffect(() => {
    if (activeMetric === "ingresos" && !incomeTabs.includes(incomeTab)) setIncomeTab(INCOME_TAB_ALL);
  }, [activeMetric, incomeTabs, incomeTab]);

  function toggleExpenseType(type: string) {
    setExpandedExpenseTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  let items: Array<{ name: string; rev: number; pct: number }> = [];
  let displayTotal = 0;
  let colorFor: (i: number, name: string) => string = (i) => DONUT_COLORS[i % DONUT_COLORS.length];
  // "categories": filas por categoría, sin ítems (Todos).
  // "expenses": lista de tipos de gasto expandible.
  // "summary": resumen "N <categoría>" + botón "Ver <categoría>" que abre el modal con el detalle completo.
  // "items": listado plano de ítems (comparación de Utilidad).
  let listMode: "categories" | "expenses" | "summary" | "items" = "items";
  let summaryLabel = "";
  let summaryButtonLabel = "";

  if (activeMetric === "gastos") {
    const total = expenseTypes.reduce((s, e) => s + e.amount, 0);
    items = expenseTypes.map((e) => ({ name: e.label, rev: e.amount, pct: e.pct }));
    displayTotal = total;
    listMode = "expenses";
  } else if (activeMetric === "utilidad") {
    const ingresos = data.revHoy;
    const gastos = data.totalGastos;
    const sum = ingresos + gastos;
    items = [
      { name: "Ingresos", rev: ingresos, pct: sum > 0 ? Math.round((ingresos / sum) * 100) : 0 },
      { name: "Gastos", rev: gastos, pct: sum > 0 ? Math.round((gastos / sum) * 100) : 0 },
    ].filter((i) => i.rev > 0);
    displayTotal = data.utilidad;
    colorFor = (_, name) => (name === "Gastos" ? TONE.danger.stroke : TONE.success.stroke);
  } else if (incomeTab === INCOME_TAB_SERVICES) {
    // Servicios: siempre resumen + "Ver servicios" — el detalle completo va en el modal.
    items = serviceItems.map((s) => ({ name: s.name, rev: s.rev, pct: s.pct }));
    displayTotal = servicesTotal;
    listMode = "summary";
    summaryLabel = `${serviceItems.length} ${categoryCountNoun(INCOME_TAB_SERVICES, serviceItems.length)}`;
    summaryButtonLabel = categoryButtonLabel(INCOME_TAB_SERVICES);
  } else if (incomeTab === INCOME_TAB_ALL) {
    const source = [
      { name: INCOME_TAB_SERVICES, rev: servicesTotal },
      ...catalogCategories.map((c) => ({ name: c.category, rev: c.rev })),
    ];
    const all = source.filter((i) => i.rev > 0);
    const total = all.reduce((s, i) => s + i.rev, 0);
    items = all.map((i) => ({ ...i, pct: total > 0 ? Math.round((i.rev / total) * 100) : 0 }));
    displayTotal = total;
    listMode = "categories";
  } else {
    // Cualquier categoría del catálogo: mismo comportamiento uniforme que
    // Servicios — nunca se listan los ítems dentro del card.
    const selectedCategory = catalogCategories.find((c) => c.category === incomeTab);
    items = (selectedCategory?.items ?? []).map((i) => ({ name: i.name, rev: i.rev, pct: i.pct }));
    displayTotal = selectedCategory?.rev ?? 0;
    listMode = "summary";
    summaryLabel = `${items.length} ${categoryCountNoun(incomeTab, items.length)}`;
    summaryButtonLabel = categoryButtonLabel(incomeTab);
  }

  const pieItems = items.length ? items : [{ name: "Sin datos", rev: 1, pct: 100 }];
  // Tamaño de torta SIEMPRE constante — Todos, Servicios, Bebidas o cualquier
  // categoría se ven exactamente igual, sin achicarse por cantidad de ítems
  // ni por el nombre de la pestaña (el detalle completo vive en el modal). Con
  // el selector como un solo botón desplegable (en vez de pestañas múltiples)
  // sobra espacio arriba, así que la torta puede ser más grande.
  const pieSize = 170;
  const outerR = pieSize / 2 - 3;
  const innerR = outerR - 24;

  return (
    <div className="glass dashboard-donut-glow rounded-2xl p-4 relative overflow-hidden h-[500px] flex flex-col">
      <div className="pointer-events-none absolute -top-16 right-8 h-36 w-36 rounded-full bg-cyan-400/16 blur-[72px]" />
      <div className="pointer-events-none absolute -bottom-16 left-8 h-36 w-36 rounded-full bg-primary/14 blur-[72px]" />

      {activeMetric === "ingresos" && (
        <div ref={incomeMenuRef} className="relative w-full shrink-0">
          <button
            type="button"
            onClick={() => setIncomeMenuOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:bg-white/[0.06]"
          >
            <span className="min-w-0 truncate text-sm font-semibold">{incomeTab}</span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                incomeMenuOpen && "rotate-180",
              )}
            />
          </button>

          {incomeMenuOpen && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-2xl border border-white/10 bg-[oklch(0.13_0.035_275/0.98)] p-1.5 shadow-2xl backdrop-blur-xl">
              {incomeTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  title={tab}
                  onClick={() => {
                    setIncomeTab(tab);
                    setIncomeMenuOpen(false);
                  }}
                  className={cn(
                    "block w-full truncate rounded-xl px-3 py-2 text-left text-sm transition",
                    incomeTab === tab
                      ? "bg-primary text-white"
                      : "text-white/85 hover:bg-white/10 hover:text-white",
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        className={cn(
          "relative flex flex-1 min-h-0 flex-col justify-center",
          activeMetric === "ingresos" ? "mt-2" : "mt-1",
        )}
      >
        {/* Una sola regla para todas las pestañas: la torta y el contenido de
            abajo se centran como bloque dentro del espacio disponible. En
            "Todos" el contenido varía (0 a 9 categorías), así que el bloque
            crece y la torta sube naturalmente. En Servicios/una categoría el
            contenido de abajo es siempre el mismo resumen+botón (mismo alto
            haya 1, 3 o 6 elementos), así que en la práctica la torta queda
            fija en el centro sin necesidad de ningún caso especial. */}
        <div className="donut-chart-glow mx-auto relative shrink-0" style={{ height: pieSize, width: pieSize }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieItems}
                dataKey="rev"
                nameKey="name"
                innerRadius={innerR}
                outerRadius={outerR}
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
              >
                {pieItems.map((it, i) => (
                  <Cell key={i} fill={colorFor(i, it.name)} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="text-center">
              <div className="font-display text-lg font-semibold leading-none">
                {fmtAR(displayTotal)}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                {activeMetric === "utilidad" ? "Utilidad" : "Total"}
              </div>
            </div>
          </div>
        </div>

        {/* min-h-0 + overflow-y-auto: si el contenido no entra en el espacio
            disponible, se contiene y scrollea acá adentro — nunca empuja el
            alto de la tarjeta ni descentra el bloque de arriba. */}
        <div className="relative mt-5 flex min-h-0 flex-col overflow-y-auto">
        {listMode === "expenses" ? (
          expenseTypes.length > 0 ? (
            <div className="space-y-1 min-w-0">
              {expenseTypes.map((exp, i) => {
                const expanded = expandedExpenseTypes.has(exp.type);
                return (
                  <div key={exp.type}>
                    <button
                      type="button"
                      onClick={() => toggleExpenseType(exp.type)}
                      className="flex w-full items-center gap-2 text-xs py-1 text-left"
                    >
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                      />
                      <span className="truncate text-foreground/90 flex-1">{exp.label}</span>
                      <span className="text-muted-foreground tabular-nums">{fmtExpenseAR(exp.amount)}</span>
                      <span className="text-foreground/80 tabular-nums w-9 text-right">{exp.pct}%</span>
                    </button>
                    {expanded && (
                      <ul className="mt-1 mb-1 space-y-1 pl-4">
                        {exp.items.slice(0, MAX_LIST_ROWS).map((it, idx) => (
                          <li key={`${it.name}-${idx}`} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="truncate flex-1">{it.name}</span>
                            <span className="tabular-nums">{fmtExpenseAR(it.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Sin gastos en el período.</p>
          )
        ) : listMode === "categories" ? (
          items.length > 0 ? (
            <div className="space-y-2 min-w-0">
              {items.slice(0, MAX_LIST_ROWS).map((entry, i) => (
                <div key={entry.name} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                  />
                  <span className="truncate text-foreground font-semibold flex-1">{entry.name}</span>
                  <span className="text-muted-foreground tabular-nums">{fmtAR(entry.rev)}</span>
                  <span className="text-foreground/80 tabular-nums w-9 text-right">{entry.pct}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Sin datos en el período.</p>
          )
        ) : listMode === "summary" ? (
          // Misma caja + mismo botón haya o no ventas — así el card mide
          // exactamente igual en un día vacío que en un día con datos.
          <div className="space-y-3 min-w-0">
            <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 px-3 py-2.5 text-center">
              <div className="font-display text-sm font-semibold">
                {items.length > 0 ? summaryLabel : "Sin datos en el período"}
              </div>
            </div>
            <button
              type="button"
              disabled={items.length === 0}
              onClick={() =>
                setDetailModal({
                  title: incomeTab,
                  total: displayTotal,
                  rows: items.map((i) => ({ name: i.name, amount: i.rev, pct: i.pct })),
                })
              }
              className="w-full rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/5"
            >
              {summaryButtonLabel}
            </button>
          </div>
        ) : (
          <ul className="space-y-2 min-w-0">
            {items.slice(0, MAX_LIST_ROWS).map((s, i) => (
              <li key={s.name} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ background: colorFor(i, s.name) }}
                />
                <span className="truncate text-foreground/90 flex-1">{s.name}</span>
                <span className="text-muted-foreground tabular-nums">{displayTotal ? fmtAR(s.rev) : fmtAR(0)}</span>
                <span className="text-foreground/80 tabular-nums w-9 text-right">{displayTotal ? s.pct : 0}%</span>
              </li>
            ))}
            {items.length === 0 && <li className="text-xs text-muted-foreground">Sin datos.</li>}
          </ul>
        )}
        </div>
      </div>

      {detailModal && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setDetailModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-[oklch(0.12_0.02_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <h3 className="font-display text-base font-semibold truncate">{detailModal.title}</h3>
              <button
                onClick={() => setDetailModal(null)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-white/5 shrink-0"
              >
                ✕
              </button>
            </div>
            <div className="p-4">
              <div className="donut-chart-glow mx-auto relative h-[170px] w-[170px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={detailModal.rows}
                      dataKey="amount"
                      nameKey="name"
                      innerRadius={58}
                      outerRadius={82}
                      paddingAngle={2}
                      stroke="none"
                      isAnimationActive={false}
                    >
                      {detailModal.rows.map((_, i) => (
                        <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                  <div className="text-center">
                    <div className="font-display text-lg font-semibold leading-none">
                      {fmtAR(detailModal.total)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                      Total
                    </div>
                  </div>
                </div>
              </div>
              <ul className="mt-4 max-h-[280px] space-y-2 overflow-y-auto pr-1">
                {detailModal.rows.map((r, i) => (
                  <li key={`${r.name}-${i}`} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                    />
                    <span className="truncate text-foreground/90 flex-1">{r.name}</span>
                    <span className="text-muted-foreground tabular-nums">{fmtAR(r.amount)}</span>
                    <span className="text-foreground/80 tabular-nums w-9 text-right">{r.pct}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cancellations
// ---------------------------------------------------------------------------
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.max(1, Math.round(diff / 60000));
  if (m < 60) return `Hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `Hace ${h} h`;
  return `Hace ${Math.round(h / 24)} d`;
}

function CancellationsPanel({ items }: { items: RecentCancellation[] }) {
  const count = items.length;
  const perdida = items.reduce((s, a) => s + Number(a.service_price ?? 0), 0);

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg grid place-items-center bg-destructive/15 ring-1 ring-destructive/30">
            <XCircle className="h-4 w-4 text-destructive" />
          </div>
          <h3 className="font-display text-base font-semibold">Cancelaciones</h3>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">❌</span>
            <span className="font-display text-lg font-semibold text-destructive">{count}</span>
            <span className="text-xs text-muted-foreground">cancelaciones</span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">💸</span>
            <span className="font-display text-lg font-semibold text-destructive">{fmtAR(perdida)}</span>
            <span className="text-xs text-muted-foreground">pérdida est.</span>
          </div>
        </div>
      </div>

      {count === 0 ? (
        <p className="text-sm text-muted-foreground">Sin cancelaciones en el período.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-full grid place-items-center bg-destructive/15 ring-1 ring-destructive/30 shrink-0">
                <XCircle className="h-3.5 w-3.5 text-destructive" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {a.client_name || "Cliente"}
                  {a.service_name && (
                    <>
                      <span className="text-muted-foreground font-normal"> · </span>
                      <span className="text-foreground/80">{a.service_name}</span>
                    </>
                  )}
                </div>
                {a.service_price ? (
                  <div className="text-xs text-destructive/70">{fmtAR(a.service_price)} perdido</div>
                ) : (
                  <div className="text-xs text-muted-foreground">Turno cancelado</div>
                )}
              </div>
              <div className="text-xs text-muted-foreground shrink-0 tabular-nums">
                {timeAgo(a.starts_at)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
