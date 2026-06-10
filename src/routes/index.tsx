import * as React from "react";
import { cn } from "@/lib/utils";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import { useAuth } from "@/hooks/use-auth";
import { AccessDenied, usePermGuard } from "@/hooks/use-perm-guard";
import { supabase } from "@/integrations/supabase/client";
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
  Users,
  Receipt,
  Activity,
  XCircle,
} from "lucide-react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Panel — Clippr" },
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
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="text-sm text-muted-foreground">Cargando…</div>
      </div>
    );
  }

  const firstName = (profile?.full_name ?? "Usuario").split(" ")[0];

  return (
    <AppShell>
      <Topbar
        title="Dashboard"
        subtitle="Resumen del negocio"
        action={<div />}
      />
      <DashboardContent businessId={businessId} />
    </AppShell>
  );
}

function DashboardContent({ businessId }: { businessId: string | null }) {
  const todayStr = React.useMemo(() => new Date().toISOString().slice(0, 10), []);
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
  const [activeMetric, setActiveMetric] = React.useState<"ingresos"|"gastos"|"utilidad"|"clientes"|"ticket"|"ocupacion">("ingresos");

  const setQuickRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (days - 1));
    setFromStr(from.toISOString().slice(0, 10));
    setToStr(to.toISOString().slice(0, 10));
  };

  if (!businessId) {
    return (
      <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
        No se encontró un negocio asignado a esta cuenta.
      </div>
    );
  }

  const dateBar = (
    <div className="glass rounded-2xl p-3 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="uppercase tracking-wider">Rango</span>
      </div>
      <DateRangePicker
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
        <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
          Cargando datos del rango…
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

  const utilidad = Math.max(0, data.utilidad);

  return (
    <div className="space-y-5 animate-fade-up">
      {dateBar}
      {/* Top stat cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <Stat
          active={activeMetric === "ingresos"}
          onClick={() => setActiveMetric("ingresos")}
          label="Ingresos"
          value={fmtAR(data.revHoy)}
          icon={DollarSign}
          tone="primary"
          spark={data.revByDay}
        />
        <Stat
          active={activeMetric === "gastos"}
          onClick={() => setActiveMetric("gastos")}
          label="Gastos"
          value={data.totalGastos > 0 ? `-${fmtAR(data.totalGastos)}` : "$0"}
          icon={ArrowDownCircle}
          tone="danger"
          spark={data.revByDay.map((v) => v * 0.25)}
        />
        <Stat
          active={activeMetric === "utilidad"}
          onClick={() => setActiveMetric("utilidad")}
          label="Utilidad"
          value={fmtAR(utilidad)}
          icon={Wallet}
          tone="success"
          spark={data.revByDay.map((v, i) => v - (data.revByDay[i] || 0) * 0.25)}
        />
      </section>

      {/* Second row */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <Stat
          active={activeMetric === "clientes"}
          onClick={() => setActiveMetric("clientes")}
          label="Clientes atendidos"
          value={String(data.clientsCount)}
          icon={Users}
          tone="neutral"
          spark={data.doneByDay}
        />
        <Stat
          active={activeMetric === "ticket"}
          onClick={() => setActiveMetric("ticket")}
          label="Ticket promedio"
          value={fmtAR(data.ticket)}
          icon={Receipt}
          tone="neutral"
          spark={data.tickByDay}
        />
        <Stat
          active={activeMetric === "ocupacion"}
          onClick={() => setActiveMetric("ocupacion")}
          label="Ocupación"
          value={`${data.occ}%`}
          icon={Activity}
          tone="neutral"
          spark={data.occByDay}
        />
      </section>

      {/* Revenue chart + breakdown */}
      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(300px,1fr)] gap-4 items-stretch">
        <RevenueChart data={data} activeMetric={activeMetric} fromStr={fromStr} toStr={toStr} />
        <ServicesDonut data={data} />
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
  sub,
  icon: Icon,
  tone = "neutral",
  spark,
  active = false,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof TONE;
  spark?: number[];
  active?: boolean;
  onClick?: () => void;
}) {
  const t = TONE[tone];
  const id = React.useId().replace(/:/g, "");
  const sparkData = (spark ?? []).map((v, i) => ({ i, v }));
  const hasSpark = sparkData.some((d) => d.v > 0);

  return (
    <div
      onClick={onClick}
      className={cn("glass glass-hover rounded-2xl p-5 relative overflow-hidden transition-all", onClick && "cursor-pointer", active && "ring-2 ring-primary/60 shadow-[0_0_30px_-8px_oklch(0.66_0.22_265)]")}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className={`h-9 w-9 rounded-xl grid place-items-center ring-1 ${t.ring} ${t.bg}`}>
            <Icon className={`h-4 w-4 ${t.icon}`} />
          </div>
          <span className="text-sm">{label}</span>
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-3xl font-semibold tracking-tight truncate">{value}</div>
          <div className="text-xs text-muted-foreground mt-1.5">{sub}</div>
        </div>
        {hasSpark && (
          <div className="h-12 w-28 shrink-0 opacity-90">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={t.fillFrom} />
                    <stop offset="100%" stopColor={t.fillTo} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={t.stroke}
                  strokeWidth={2}
                  fill={`url(#g${id})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue chart (7d)
// ---------------------------------------------------------------------------
function RevenueChart({ data, activeMetric, fromStr, toStr }: {
  data: DashboardData;
  activeMetric: string;
  fromStr: string;
  toStr: string;
}) {
  const isSingleDay = fromStr === toStr;

  const metricConfig: Record<string, { label: string; values: number[]; fmt: (v: number) => string; total?: number }> = {
    ingresos:  { label: "Ingresos",        values: isSingleDay ? data.hoursValues : data.revByDay,    fmt: fmtAR,                          total: data.revHoy },
    gastos:    { label: "Gastos",          values: isSingleDay ? data.hoursValues.map(() => 0) : (data.gastosByDay ?? data.revByDay.map(() => 0)), fmt: fmtAR, total: data.totalGastos },
    utilidad:  { label: "Utilidad",        values: isSingleDay ? data.hoursValues.map((v) => Math.max(0, v)) : data.revByDay.map((v, i) => Math.max(0, v - (data.gastosByDay?.[i] ?? 0))), fmt: fmtAR, total: Math.max(0, data.utilidad) },
    clientes:  { label: "Clientes",        values: isSingleDay ? data.hoursValues.map(() => 0) : data.doneByDay, fmt: (v) => String(Math.round(v)), total: data.clientsCount },
    ticket:    { label: "Ticket promedio", values: isSingleDay ? data.hoursValues.map(() => 0) : data.tickByDay, fmt: fmtAR,                        total: data.ticket },
    ocupacion: { label: "Ocupación",       values: isSingleDay ? data.hoursValues.map(() => 0) : data.occByDay,  fmt: (v) => `${Math.round(v)}%`,    total: data.occ },
  };
  const cfg = metricConfig[activeMetric] ?? metricConfig.ingresos;

  // Build chart data: hourly if single day, daily if range
  const chart = isSingleDay
    ? data.hoursLabels.filter((_, i) => i % 3 === 0).map((h, i) => ({
        day: h,
        rev: data.hoursValues.filter((_, j) => j % 3 === 0)[i] ?? 0,
      }))
    : data.days7.map((d, i) => ({
        // Use only dates within range — no off-by-one
        day: new Date(d + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" }),
        rev: cfg.values[i] ?? 0,
      }));

  const total = cfg.total !== undefined ? cfg.total : cfg.values.reduce((s, v) => s + v, 0);

  const rangeLabel = isSingleDay
    ? `Hoy · ${new Date(fromStr + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })}`
    : `${new Date(fromStr + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })} al ${new Date(toStr + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}`;

  return (
    <div className="glass rounded-2xl p-5 relative overflow-hidden h-full">
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="text-xs text-muted-foreground">{cfg.label}</div>
          <div className="font-display text-3xl font-semibold tracking-tight mt-1">
            {cfg.fmt(total)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">{rangeLabel}</div>
        </div>
      </div>
      <div className="h-64 sm:h-72 mt-3 -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="rev-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="oklch(0.72 0.26 305 / 0.55)" />
                <stop offset="100%" stopColor="oklch(0.72 0.2 245 / 0)" />
              </linearGradient>
              <linearGradient id="rev-stroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="oklch(0.72 0.2 245)" />
                <stop offset="100%" stopColor="oklch(0.72 0.26 305)" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="oklch(1 0 0 / 0.05)" vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "oklch(0.65 0.025 270)", fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "oklch(0.65 0.025 270)", fontSize: 11 }}
              width={50}
              tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
            />
            <Tooltip
              contentStyle={{
                background: "oklch(0.14 0.03 282)",
                border: "1px solid oklch(1 0 0 / 0.08)",
                borderRadius: 12,
                fontSize: 12,
              }}
              labelStyle={{ color: "oklch(0.85 0 0)" }}
              formatter={(v: number) => [fmtAR(v), "Ingresos"]}
            />
            <Area
              type="monotone"
              dataKey="rev"
              stroke="url(#rev-stroke)"
              strokeWidth={2.5}
              fill="url(#rev-grad)"
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

function ServicesDonut({ data }: { data: DashboardData }) {
  const [view, setView] = React.useState<"all" | "services" | "catalog">("all");

  const serviceItems = data.topServices.length
    ? data.topServices
    : [];

  // Por ahora el dashboard solo recibe servicios desde useDashboardData.
  // Cuando se conecten ventas de catálogo/productos, se pueden mapear acá.
  const catalogItems: Array<{ name: string; rev: number; count: number; pct: number }> = [];

  const sourceItems =
    view === "catalog" ? catalogItems : serviceItems;

  const total = sourceItems.reduce((sum, item) => sum + Number(item.rev || 0), 0);

  const items = sourceItems.length
    ? sourceItems.map((item) => ({
        ...item,
        pct: total > 0 ? Math.round((Number(item.rev || 0) / total) * 100) : 0,
      }))
    : [{ name: view === "catalog" ? "Sin datos de catálogo" : "Sin datos", rev: 1, count: 0, pct: 100 }];

  const displayTotal = sourceItems.length ? total : 0;

  const title =
    view === "catalog" ? "Catálogo" : view === "services" ? "Servicios" : "Todos";

  return (
    <div className="glass rounded-2xl p-5 relative overflow-hidden h-full">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Desglose</div>
          <div className="font-display text-xl font-semibold mt-0.5">{title}</div>
        </div>

        <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
          {[
            ["all", "Todos"],
            ["services", "Servicios"],
            ["catalog", "Catálogo"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key as "all" | "services" | "catalog")}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                view === key
                  ? "bg-primary text-white shadow-[0_8px_20px_-14px_oklch(0.65_0.28_290/0.8)]"
                  : "text-muted-foreground hover:text-white",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-5">
        <div className="mx-auto relative h-[170px] w-[170px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={items}
                dataKey="rev"
                nameKey="name"
                innerRadius={58}
                outerRadius={82}
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
              >
                {items.map((_, i) => (
                  <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
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
                Total
              </div>
            </div>
          </div>
        </div>

        <ul className="space-y-2 min-w-0">
          {items.slice(0, 5).map((s, i) => (
            <li key={s.name} className="flex items-center gap-2 text-xs">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
              />
              <span className="truncate text-foreground/90 flex-1">{s.name}</span>
              <span className="text-muted-foreground tabular-nums">{displayTotal ? fmtAR(s.rev) : fmtAR(0)}</span>
              <span className="text-foreground/80 tabular-nums w-9 text-right">{displayTotal ? s.pct : 0}%</span>
            </li>
          ))}
        </ul>
      </div>
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
