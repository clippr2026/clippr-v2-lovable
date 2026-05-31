import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import {
  Zap,
  ClipboardList,
  BarChart3,
  Clock,
  DollarSign,
  Plus,
  ArrowRight,
} from "lucide-react";

import { cn } from "@/lib/utils";

export const Route = createFileRoute("/professionals")({
  component: ProfessionalsPage,
});

type TabKey = "turnos" | "stats" | "historial" | "pagos";

const barbers = [
  { id: "alejandro", initial: "A", name: "Alejandroo", role: "Barbero", color: "from-amber-400 to-amber-600", ring: "ring-rose-400/60", accent: "rose" },
  { id: "facundo", initial: "F", name: "Facundo", role: "Barbero", color: "from-amber-300 to-yellow-500", ring: "ring-amber-400/60", accent: "amber" },
  { id: "diego", initial: "D", name: "Diego", role: "Barbero", color: "from-emerald-300 to-emerald-500", ring: "ring-emerald-400/60", accent: "emerald" },
  { id: "ariel", initial: "A", name: "Ariel", role: "Barbero", color: "from-amber-300 to-amber-500", ring: "ring-amber-400/60", accent: "amber" },
  { id: "santi", initial: "S", name: "Santiago", role: "Barbero", color: "from-violet-300 to-violet-500", ring: "ring-violet-400/60", accent: "violet" },
  { id: "luciano", initial: "L", name: "Luciano", role: "Barbero", color: "from-amber-300 to-amber-500", ring: "ring-amber-400/60", accent: "amber" },
];

function ProfessionalsPage() {
  const [activeId, setActiveId] = useState(barbers[0].id);
  const [tab, setTab] = useState<TabKey>("turnos");
  const [range, setRange] = useState<"hoy" | "semana" | "mes">("semana");
  const active = useMemo(() => barbers.find((b) => b.id === activeId)!, [activeId]);

  return (
    <AppShell>
      <Topbar title="Profesionales" subtitle="Equipo, turnos y rendimiento" />
      <div className="space-y-6 animate-fade-up">
      {/* Header card */}
      <div className="glass rounded-3xl p-5 md:p-6 relative overflow-hidden">
        <div className="absolute -top-24 -left-16 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center gap-5 md:gap-6 relative">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div
              className={cn(
                "h-16 w-16 md:h-[68px] md:w-[68px] rounded-full grid place-items-center text-2xl font-display font-semibold text-background bg-gradient-to-br shadow-[0_0_40px_-4px_rgba(251,191,36,0.55)]",
                active.color
              )}
            >
              {active.initial}
            </div>
            <div className="min-w-0">
              <div className="text-2xl md:text-[26px] font-display font-semibold tracking-tight leading-tight">
                {active.name}
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">{active.role}</div>
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 ring-1 ring-emerald-400/30 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                <Zap className="h-3 w-3 fill-emerald-300" />
                Automático
              </div>
            </div>
          </div>

          {/* Barber selector */}
          <div className="flex items-center gap-2 flex-wrap">
            {barbers.map((b) => {
              const isActive = b.id === activeId;
              return (
                <button
                  key={b.id}
                  onClick={() => setActiveId(b.id)}
                  className={cn(
                    "h-9 w-9 rounded-full grid place-items-center text-[13px] font-semibold transition-all ring-1",
                    isActive
                      ? `bg-gradient-to-br ${b.color} text-background ${b.ring} ring-2 shadow-[0_0_20px_-2px_rgba(251,191,36,0.45)]`
                      : "bg-white/[0.03] text-muted-foreground ring-white/10 hover:ring-white/20"
                  )}
                  aria-label={b.name}
                >
                  {b.initial}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {([
          { key: "turnos", label: "Turnos", Icon: ClipboardList, tint: "text-amber-300" },
          { key: "stats", label: "Dashboards", Icon: BarChart3, tint: "text-sky-300" },
          { key: "historial", label: "Historial", Icon: Clock, tint: "text-violet-300" },
          { key: "pagos", label: "Pagos", Icon: DollarSign, tint: "text-emerald-300" },
        ] as const).map(({ key, label, Icon, tint }) => {
          const isActive = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "glass rounded-2xl py-4 flex flex-col items-center gap-1.5 transition-all",
                isActive
                  ? "ring-1 ring-primary/40 shadow-[0_0_30px_-10px_var(--neon-blue)] bg-white/[0.04]"
                  : "hover:bg-white/[0.04]"
              )}
            >
              <Icon className={cn("h-5 w-5", isActive ? tint : "text-muted-foreground")} />
              <span className={cn("text-sm font-medium", isActive ? "text-foreground" : "text-muted-foreground")}>
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      {tab === "turnos" && <TurnosView />}
      {tab === "stats" && <StatsView range={range} setRange={setRange} />}
      {tab === "historial" && <HistorialView />}
      {tab === "pagos" && <PagosView />}
      </div>
    </AppShell>
  );
}



function TurnosView() {
  return (
    <div className="space-y-4 animate-fade-up">
      <div className="flex justify-end">
        <button className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-300 to-amber-500 text-background px-4 py-2.5 text-sm font-semibold shadow-[0_0_30px_-6px_rgba(251,191,36,0.6)] hover:brightness-110 transition">
          <Plus className="h-4 w-4" strokeWidth={3} />
          Cobro directo
        </button>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">Próximos turnos</div>
        <button className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] ring-1 ring-white/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.07] transition">
          Ver todos <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      <button className="w-full glass rounded-2xl py-5 text-sm text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition">
        📋  Ver todos los turnos →
      </button>
    </div>
  );
}

function StatsView({
  range,
  setRange,
}: {
  range: "hoy" | "semana" | "mes";
  setRange: (r: "hoy" | "semana" | "mes") => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  return (
    <div className="space-y-4 animate-fade-up">
      {/* Range chips + dates */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-2">
          {(["hoy", "semana", "mes"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-medium transition ring-1",
                range === r
                  ? "bg-white/10 text-foreground ring-white/20"
                  : "bg-white/[0.03] text-muted-foreground ring-white/10 hover:text-foreground"
              )}
            >
              {r === "hoy" ? "Hoy" : r === "semana" ? "Esta semana" : "Este mes"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <span>Desde</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md bg-white/[0.04] ring-1 ring-white/10 px-2.5 py-1 text-foreground focus:outline-none focus:ring-white/30"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span>Hasta</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md bg-white/[0.04] ring-1 ring-white/10 px-2.5 py-1 text-foreground focus:outline-none focus:ring-white/30"
            />
          </label>
        </div>
      </div>

      {/* KPI cards: Comisión / Pagado / Pendiente */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass rounded-2xl p-5 ring-1 ring-amber-400/20 relative overflow-hidden">
          <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
            <span>💸</span> Comisión
          </div>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-muted-foreground text-lg">$</span>
            <span className="text-5xl font-display font-light tracking-tight">0</span>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">0 ventas</div>
        </div>
        <div className="glass rounded-2xl p-5 ring-1 ring-emerald-400/30 relative overflow-hidden">
          <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-emerald-400/10 blur-3xl" />
          <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
            <span>✅</span> Pagado
          </div>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-muted-foreground text-lg">$</span>
            <span className="text-5xl font-display font-light tracking-tight">0</span>
          </div>
        </div>
        <div className="glass rounded-2xl p-5 ring-1 ring-amber-300/20 relative overflow-hidden">
          <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-amber-300/10 blur-3xl" />
          <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
            <span>⏳</span> Pendiente
          </div>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-muted-foreground text-lg">$</span>
            <span className="text-5xl font-display font-light tracking-tight">0</span>
          </div>
          <div className="mt-2 text-xs text-emerald-300">✓ al día</div>
        </div>
      </div>

      {/* Ingresos area chart */}
      <div className="glass rounded-2xl p-5 relative overflow-hidden">
        <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Ingresos</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-display font-light tracking-tight">0</span>
              <span className="text-muted-foreground text-lg">$</span>
            </div>
            <div className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-300">
              ↗ 0,0 % <span className="text-muted-foreground">últimos 30 días</span>
            </div>
          </div>
        </div>
        <LineChart
          points={Array.from({ length: 30 }, () => 0)}
          labels={["29 abr", "6 may", "13 may", "20 may", "27 may"]}
          dense
        />
      </div>

      {/* Servicios Desglose */}
      <ServiciosDesglose />
    </div>
  );
}

function ServiciosDesglose() {
  const items = [
    { label: "Cortes", value: 0, color: "oklch(0.78 0.16 200)" },
    { label: "Barba", value: 0, color: "oklch(0.62 0.22 295)" },
    { label: "Tratamientos", value: 0, color: "oklch(0.72 0.17 155)" },
    { label: "Otros", value: 0, color: "oklch(0.72 0.18 55)" },
  ];
  const total = items.reduce((s, i) => s + i.value, 0);
  // visual fallback when all zero so donut isn't empty
  const display = total === 0 ? items.map(() => 1) : items.map((i) => i.value);
  const sum = display.reduce((s, v) => s + v, 0);

  const R = 60;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="glass rounded-2xl p-5 relative overflow-hidden">
      <div className="absolute -top-16 -left-16 h-56 w-56 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Servicios</div>
          <div className="mt-0.5 text-2xl font-display font-light tracking-tight">Desglose</div>
        </div>
        <button className="text-muted-foreground hover:text-foreground text-lg leading-none">···</button>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-[180px_1fr] gap-6 items-center">
        <div className="relative mx-auto">
          <svg viewBox="0 0 160 160" className="w-44 h-44 -rotate-90">
            <circle cx="80" cy="80" r={R} fill="none" stroke="oklch(0.25 0.02 270 / 0.4)" strokeWidth="18" />
            {items.map((it, idx) => {
              const frac = display[idx] / sum;
              const len = frac * C;
              const dasharray = `${len} ${C - len}`;
              const el = (
                <circle
                  key={it.label}
                  cx="80"
                  cy="80"
                  r={R}
                  fill="none"
                  stroke={it.color}
                  strokeWidth="18"
                  strokeDasharray={dasharray}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                />
              );
              offset += len;
              return el;
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-2xl font-display font-light">{total} $</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total</div>
          </div>
        </div>

        <div className="space-y-3">
          {items.map((it) => {
            const pct = total === 0 ? 0 : Math.round((it.value / total) * 100);
            return (
              <div key={it.label} className="flex items-center gap-3 text-sm">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: it.color }} />
                <span className="flex-1 text-foreground/90">{it.label}</span>
                <span className="tabular-nums text-muted-foreground w-20 text-right">{it.value} $</span>
                <span className="tabular-nums font-semibold w-10 text-right">{pct} %</span>
              </div>
            );
          })}
          <button className="text-sky-300 hover:text-sky-200 text-sm pt-1 inline-flex items-center gap-1">
            Ver todo <span aria-hidden>›</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function LineChart({
  points,
  labels,
  dense = false,
}: {
  points: number[];
  labels: string[];
  dense?: boolean;
}) {
  const W = 600;
  const H = 140;
  const PAD_X = 8;
  const PAD_Y = 18;
  const max = Math.max(...points, 1);
  // smooth display: if all zeros, draw a gentle baseline wave so it doesn't look dead
  const display = points.every((p) => p === 0)
    ? points.map((_, i) => 0.45 + 0.1 * Math.sin((i / Math.max(points.length - 1, 1)) * Math.PI * 2))
    : points.map((p) => p / max);

  const step = (W - PAD_X * 2) / Math.max(display.length - 1, 1);
  const pts = display.map((v, i) => ({
    x: PAD_X + i * step,
    y: H - PAD_Y - v * (H - PAD_Y * 2),
  }));

  // smooth cubic path
  const line = pts
    .map((p, i, arr) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const prev = arr[i - 1];
      const cx = (prev.x + p.x) / 2;
      return `C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
    })
    .join(" ");
  const area = `${line} L ${pts[pts.length - 1].x} ${H} L ${pts[0].x} ${H} Z`;

  return (
    <div className="mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32 overflow-visible">
        <defs>
          <linearGradient id="proAreaFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.7 0.25 300)" stopOpacity="0.45" />
            <stop offset="60%" stopColor="oklch(0.6 0.22 290)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="oklch(0.6 0.22 290)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="proAreaStroke" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="oklch(0.72 0.2 245)" />
            <stop offset="100%" stopColor="oklch(0.7 0.25 300)" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#proAreaFill)" />
        <path
          d={line}
          fill="none"
          stroke="url(#proAreaStroke)"
          strokeWidth="2"
          strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 8px oklch(0.72 0.2 245 / 0.6))" }}
        />
        {!dense &&
          pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="oklch(0.82 0.16 200)" />
          ))}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-1">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  );
}

function PagosView() {
  return (
    <div className="glass rounded-2xl p-8 animate-fade-up">
      <div className="text-center text-sm text-muted-foreground">Sin pagos registrados aún.</div>
    </div>
  );
}

function HistorialView() {

  const [filter, setFilter] = useState<"todo" | "hoy" | "semana">("todo");
  return (
    <div className="glass rounded-2xl p-5 animate-fade-up">
      <div className="flex items-center justify-between">
        <div className="font-medium">Historial de servicios</div>
        <div className="flex items-center gap-2">
          {(["todo", "hoy", "semana"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-semibold tracking-wider uppercase transition ring-1",
                filter === f
                  ? "bg-white/10 text-foreground ring-white/20"
                  : "bg-transparent text-muted-foreground ring-white/10 hover:text-foreground"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-10 mb-6 text-center text-sm text-muted-foreground">Sin historial hoy</div>
    </div>
  );
}
