import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import { useAuth } from "@/hooks/use-auth";
import { AccessDenied, usePermGuard } from "@/hooks/use-perm-guard";
import { useDashboardData, fmtAR } from "@/components/dashboard/use-dashboard-data";
import { useClientsData } from "@/hooks/use-clients-data";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Brain,
  CheckCircle2,
  ClipboardList,
  HeartPulse,
  Sparkles,
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

type AlertTone = "good" | "warning" | "danger" | "neutral";

type AlertItem = {
  title: string;
  detail: string;
  tone: AlertTone;
};

function AdvisorRoute() {
  const hasAccess = usePermGuard("dashboard");
  const { loading, session, businessId } = useAuth();
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
      <Topbar title="Asesor IA" subtitle="Crecimiento, salud y análisis del negocio" />
      <AdvisorContent businessId={businessId} />
    </AppShell>
  );
}

function AdvisorContent({ businessId }: { businessId: string | null }) {
  const [monthlyGenerated, setMonthlyGenerated] = React.useState(false);

  const todayRange = React.useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }, []);

  const monthRange = React.useMemo(() => {
    const from = new Date();
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }, []);

  const previousMonthRange = React.useMemo(() => {
    const from = new Date();
    from.setMonth(from.getMonth() - 1, 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setMonth(to.getMonth() + 1, 0);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }, []);

  const todayQuery = useDashboardData(businessId, todayRange);
  const monthQuery = useDashboardData(businessId, monthRange);
  const previousMonthQuery = useDashboardData(businessId, previousMonthRange);
  const clientsQuery = useClientsData(businessId);

  const today = todayQuery.data;
  const month = monthQuery.data;
  const previousMonth = previousMonthQuery.data;
  const clients = clientsQuery.data ?? [];

  const activeClients = clients.filter((client) => client.status === "activo" || client.status === "vip").length;
  const inactiveClients = clients.filter((client) => client.status === "inactivo" || client.status === "perdido").length;
  const vipClients = clients.filter((client) => client.status === "vip").length;

  const revenue = month?.revHoy ?? 0;
  const expenses = month?.totalGastos ?? 0;
  const profit = month?.utilidad ?? 0;
  const ticket = month?.ticket ?? 0;
  const occupancy = month?.occ ?? 0;
  const payments = month?.cobros ?? 0;
  const pendingRisk = today ? Math.max((today.usedSlots ?? 0) - (today.cobros ?? 0), 0) : 0;
  const cancellations = month?.recentCancellations?.length ?? 0;
  const hasMonthData = revenue > 0 || payments > 0 || activeClients > 0;

  const health = React.useMemo(() => {
    if (!hasMonthData) return null;

    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const profitScore = clamp(margin * 2.5, 0, 100);
    const clientsScore = clamp(activeClients * 3, 0, 100);
    const occupancyScore = clamp(occupancy, 0, 100);
    const recoveryScore = clients.length > 0 ? clamp(100 - (inactiveClients / clients.length) * 100, 0, 100) : 70;
    const cashScore = pendingRisk === 0 ? 100 : clamp(100 - pendingRisk * 12, 0, 100);

    return Math.round(
      profitScore * 0.4 +
        clientsScore * 0.2 +
        occupancyScore * 0.2 +
        recoveryScore * 0.1 +
        cashScore * 0.1,
    );
  }, [activeClients, clients.length, hasMonthData, inactiveClients, occupancy, pendingRisk, profit, revenue]);

  const growth = React.useMemo(() => {
    if (!previousMonth || !hasMonthData) return null;

    const profitGrowth = percentChange(profit, previousMonth.utilidad);
    const revenueGrowth = percentChange(revenue, previousMonth.revHoy);
    const ticketGrowth = percentChange(ticket, previousMonth.ticket);
    const occupancyGrowth = percentChange(occupancy, previousMonth.occ);
    const valid = [profitGrowth, revenueGrowth, ticketGrowth, occupancyGrowth].filter((n): n is number => n !== null);

    if (!valid.length) return null;
    return Math.round(valid.reduce((sum, n) => sum + n, 0) / valid.length);
  }, [hasMonthData, occupancy, previousMonth, profit, revenue, ticket]);

  const healthTone = getHealthTone(health);
  const healthReasons = buildHealthReasons({
    profit,
    revenue,
    occupancy,
    activeClients,
    inactiveClients,
    pendingRisk,
    cancellations,
  });

  const dailyAlerts = buildDailyAlerts({
    today,
    month,
    inactiveClients,
    vipClients,
    pendingRisk,
    ticket,
  });

  const monthlySummary = buildMonthlySummary({
    revenue,
    expenses,
    profit,
    payments,
    activeClients,
    inactiveClients,
    occupancy,
    ticket,
    growth,
  });

  if (todayQuery.isLoading || monthQuery.isLoading || clientsQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Analizando métricas del negocio…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
        <div>
          <div className="text-sm font-semibold text-white">Análisis inteligente</div>
          <p className="mt-1 text-sm text-muted-foreground">Mirá si el negocio crece, si está sano y generá informes mensuales.</p>
        </div>
      </div>

      <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <GlassCard className="p-5 sm:p-6">
          <Badge icon={TrendingUp}>Crecimiento del negocio</Badge>
          <div className="mt-4">
            {growth === null ? (
              <>
                <div className="font-display text-4xl font-semibold tracking-tight text-muted-foreground">Sin comparación</div>
                <p className="mt-2 text-sm text-muted-foreground">Se calcula cuando exista información del mes anterior.</p>
              </>
            ) : (
              <>
                <div className={cn("font-display text-6xl font-semibold tracking-tight", growth >= 0 ? "text-emerald-400" : "text-amber-300")}>
                  {growth > 0 ? "+" : ""}{growth}%
                </div>
                <p className="mt-2 text-sm text-muted-foreground">Comparado con el mes anterior.</p>
              </>
            )}
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-muted-foreground">
            Crecimiento compara el mes actual contra el anterior. La utilidad es el dato principal; también se mira facturación, ticket promedio y ocupación.
          </div>
        </GlassCard>
        <GlassCard className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <Badge icon={HeartPulse}>Salud del negocio</Badge>
              <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">Cómo viene tu negocio</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Basado en utilidad, clientes activos, ocupación, clientes por recuperar y caja.
              </p>
            </div>

            <div className="text-right">
              {health === null ? (
                <>
                  <div className="font-display text-4xl font-semibold tracking-tight text-muted-foreground">En análisis</div>
                  <div className="mt-1 text-xs font-medium text-muted-foreground">Faltan movimientos del mes</div>
                </>
              ) : (
                <>
                  <div className={cn("font-display text-6xl font-semibold tracking-tight", healthTone.text)}>{health}</div>
                  <div className="text-sm text-muted-foreground">sobre 100</div>
                  <div className={cn("mt-1 text-xs font-semibold", healthTone.text)}>{healthTone.label}</div>
                </>
              )}
            </div>
          </div>

          <div className="mt-6 h-3 overflow-hidden rounded-full bg-white/10">
            <div
              className={cn("h-full rounded-full bg-gradient-to-r transition-all", healthTone.bar)}
              style={{ width: health === null ? "16%" : `${health}%` }}
            />
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold">¿Por qué?</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {healthReasons.map((reason) => (
                <ReasonItem key={reason.text} tone={reason.tone} text={reason.text} />
              ))}
            </div>
          </div>
        </GlassCard>

      </section>

      <GlassCard className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Badge icon={Bell}>Acciones del día</Badge>
            <h2 className="mt-4 font-display text-xl font-semibold tracking-tight">5 acciones recomendadas</h2>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-5">
          {dailyAlerts.map((alert) => (
            <AlertCard key={alert.title} alert={alert} />
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Badge icon={Sparkles}>Historial</Badge>
            <h2 className="mt-4 font-display text-xl font-semibold tracking-tight">Análisis mensuales guardados</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Tus informes mensuales quedan guardados para comparar la evolución del negocio.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm font-semibold text-white">Junio 2026</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {monthlyGenerated ? "Informe generado este mes." : "Todavía no hay informe guardado."}
            </p>
            <p className={cn("mt-3 text-sm", monthlyGenerated ? "text-emerald-300" : "text-muted-foreground")}>
              {monthlyGenerated ? "Disponible" : "Pendiente"}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm font-semibold text-white">Mayo 2026</p>
            <p className="mt-1 text-xs text-muted-foreground">Historial del mes anterior.</p>
            <p className="mt-3 text-sm text-muted-foreground">Sin informe guardado</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm font-semibold text-white">Abril 2026</p>
            <p className="mt-1 text-xs text-muted-foreground">Historial anterior.</p>
            <p className="mt-3 text-sm text-muted-foreground">Sin informe guardado</p>
          </div>
        </div>

        {monthlyGenerated ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <MonthlyBlock title="Resumen" items={monthlySummary.summary} />
            <MonthlyBlock title="Lo mejor" items={monthlySummary.good} />
            <MonthlyBlock title="A mejorar" items={monthlySummary.improve} />
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-muted-foreground">
            Todavía no generaste el análisis mensual. Cuando lo generes, Clippr va a resumir cómo viene el negocio y qué conviene hacer.
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function buildHealthReasons(input: {
  profit: number;
  revenue: number;
  occupancy: number;
  activeClients: number;
  inactiveClients: number;
  pendingRisk: number;
  cancellations: number;
}) {
  const reasons: Array<{ text: string; tone: "good" | "warning" }> = [];

  if (input.profit > 0) reasons.push({ text: "La utilidad del mes es positiva", tone: "good" });
  else reasons.push({ text: "Falta utilidad registrada este mes", tone: "warning" });

  if (input.activeClients > 0) reasons.push({ text: "Hay clientes activos en movimiento", tone: "good" });
  else reasons.push({ text: "Todavía falta movimiento de clientes", tone: "warning" });

  if (input.occupancy >= 60) reasons.push({ text: "La ocupación viene bien", tone: "good" });
  else reasons.push({ text: "La ocupación puede mejorar", tone: "warning" });

  if (input.inactiveClients > 0) reasons.push({ text: "Hay clientes para recuperar", tone: "warning" });
  else reasons.push({ text: "No hay alerta fuerte de clientes perdidos", tone: "good" });

  if (input.pendingRisk > 0) reasons.push({ text: "Revisar servicios pendientes de cobro", tone: "warning" });
  else reasons.push({ text: "Caja y cobros se ven ordenados", tone: "good" });

  if (input.cancellations > 0) reasons.push({ text: "Hubo cancelaciones para revisar", tone: "warning" });

  return reasons.slice(0, 6);
}

function buildDailyAlerts(input: {
  today?: { usedSlots: number; totalSlots: number; cobros: number; recentCancellations: unknown[]; ticket: number };
  month?: { occ: number; revHoy: number; utilidad: number };
  inactiveClients: number;
  vipClients: number;
  pendingRisk: number;
  ticket: number;
}): AlertItem[] {
  const alerts: AlertItem[] = [];
  const emptyToday = input.today ? Math.max(input.today.totalSlots - input.today.usedSlots, 0) : 0;
  const cancellations = input.today?.recentCancellations?.length ?? 0;

  if (input.inactiveClients > 0) {
    alerts.push({
      title: `${input.inactiveClients} clientes para recuperar`,
      detail: "Podés contactarlos por WhatsApp.",
      tone: "warning",
    });
  } else {
    alerts.push({ title: "Recuperar clientes", detail: "Enviá un WhatsApp a clientes que no volvieron hace más de 45 días.
                <div className="mt-4">
                  <button
                    type="button"
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-primary transition hover:bg-white/[0.08]"
                  >
                    Ver cómo
                  </button>
                </div>", tone: "good" });
  }

  if (emptyToday > 0) {
    alerts.push({ title: `${emptyToday} espacios libres hoy`, detail: "Creá una promo rápida para horarios con baja ocupación.
                <div className="mt-4">
                  <button
                    type="button"
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-primary transition hover:bg-white/[0.08]"
                  >
                    Ver cómo
                  </button>
                </div>", tone: "warning" });
  } else {
    alerts.push({ title: "Agenda cubierta", detail: "Buen nivel de ocupación para hoy.", tone: "good" });
  }

  if (input.pendingRisk > 0) {
    alerts.push({ title: `${input.pendingRisk} servicios por revisar`, detail: "Controlá que todo quede cobrado.", tone: "danger" });
  } else {
    alerts.push({ title: "Revisar pendientes de cobro", detail: "Controlá que todos los servicios del día estén cobrados.
                <div className="mt-4">
                  <button
                    type="button"
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-primary transition hover:bg-white/[0.08]"
                  >
                    Ver cómo
                  </button>
                </div>", tone: "good" });
  }

  if (cancellations > 0) {
    alerts.push({ title: `${cancellations} cancelaciones recientes`, detail: "Revisá señas y recordatorios.", tone: "warning" });
  } else {
    alerts.push({ title: "Confirmar turnos de mañana", detail: "Mandá recordatorio a los clientes para reducir ausencias.
                <div className="mt-4">
                  <button
                    type="button"
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-primary transition hover:bg-white/[0.08]"
                  >
                    Ver cómo
                  </button>
                </div>", tone: "good" });
  }

  if (input.vipClients > 0) {
    alerts.push({ title: `${input.vipClients} clientes VIP`, detail: "Cuidalos con atención personalizada.", tone: "good" });
  } else if (input.ticket > 0) {
    alerts.push({ title: `Ticket promedio ${fmtAR(input.ticket)}`, detail: "Revisá si podés sumar productos.", tone: "neutral" });
  } else {
    alerts.push({ title: "Faltan datos de ticket", detail: "Se completa con más cobros.", tone: "neutral" });
  }

  return alerts.slice(0, 5);
}

function buildMonthlySummary(input: {
  revenue: number;
  expenses: number;
  profit: number;
  payments: number;
  activeClients: number;
  inactiveClients: number;
  occupancy: number;
  ticket: number;
  growth: number | null;
}) {
  return {
    summary: [
      input.revenue > 0 ? `Facturación acumulada: ${fmtAR(input.revenue)}` : "Aún falta facturación registrada.",
      input.profit > 0 ? `Utilidad estimada: ${fmtAR(input.profit)}` : "La utilidad todavía no está clara.",
      input.growth !== null ? `Crecimiento vs mes anterior: ${input.growth > 0 ? "+" : ""}${input.growth}%` : "Sin comparación completa con el mes anterior.",
    ],
    good: [
      input.payments > 0 ? `${input.payments} cobros registrados.` : "La caja está lista para registrar movimientos.",
      input.ticket > 0 ? `Ticket promedio: ${fmtAR(input.ticket)}.` : "El ticket promedio se completa con más cobros.",
      input.activeClients > 0 ? `${input.activeClients} clientes activos.` : "Todavía faltan clientes activos este mes.",
    ],
    improve: [
      input.occupancy < 60 ? "Mejorar ocupación de horarios libres." : "Mantener la ocupación actual.",
      input.inactiveClients > 0 ? `Recuperar ${input.inactiveClients} clientes inactivos.` : "Seguir cuidando la recurrencia.",
      input.expenses > 0 ? "Revisar gastos para proteger la utilidad." : "Registrar gastos para medir mejor la utilidad.",
    ],
  };
}

function percentChange(now: number, prev: number) {
  if (!prev || !Number.isFinite(prev)) return null;
  return Math.round(((now - prev) / prev) * 100);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getHealthTone(health: number | null) {
  if (health === null) {
    return {
      label: "En análisis",
      text: "text-muted-foreground",
      bar: "from-muted-foreground/40 to-muted-foreground/20",
    };
  }

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

function AlertCard({ alert }: { alert: AlertItem }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div
        className={cn(
          "mb-3 h-2.5 w-2.5 rounded-full",
          alert.tone === "good" && "bg-emerald-400",
          alert.tone === "warning" && "bg-amber-400",
          alert.tone === "danger" && "bg-red-400",
          alert.tone === "neutral" && "bg-primary",
        )}
      />
      <div className="text-sm font-semibold">{alert.title}</div>
      <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{alert.detail}</div>
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
