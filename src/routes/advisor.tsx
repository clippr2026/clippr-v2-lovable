import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import { useAuth } from "@/hooks/use-auth";
import { AccessDenied, usePermGuard } from "@/hooks/use-perm-guard";
import { useDashboardData, fmtAR, pctDelta } from "@/components/dashboard/use-dashboard-data";
import { useClientsData } from "@/hooks/use-clients-data";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Brain,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  Lightbulb,
  Sparkles,
  Target,
  Trophy,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/advisor")({
  head: () => ({
    meta: [
      { title: "Asesor IA — Clippr" },
      { name: "description", content: "Recomendaciones inteligentes para mejorar el negocio." },
    ],
  }),
  component: AdvisorRoute,
});

type Insight = {
  title: string;
  detail: string;
  tone?: "good" | "warning" | "neutral";
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
      <Topbar
        title="Asesor IA"
        subtitle="Decisiones para mejorar el negocio"
        action={<div />}
      />
      <AdvisorContent businessId={businessId} />
    </AppShell>
  );
}

function AdvisorContent({ businessId }: { businessId: string | null }) {
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

  const dashboard = useDashboardData(businessId, todayRange);
  const monthDashboard = useDashboardData(businessId, monthRange);
  const clients = useClientsData(businessId);

  const data = dashboard.data;
  const month = monthDashboard.data;
  const allClients = clients.data ?? [];
  const inactiveClients = allClients.filter((client) => client.status === "inactivo" || client.status === "perdido");
  const vipClients = allClients.filter((client) => client.status === "vip");
  const noShowRisk = data?.recentCancellations.length ?? 0;
  const emptySlots = data ? Math.max(data.totalSlots - data.usedSlots, 0) : 0;
  const revenueDelta = data ? pctDelta(data.revHoy, data.revAyer) : null;
  const ticketDelta = data ? pctDelta(data.ticket, data.ticketAyer) : null;
  const estimatedTicket = Math.max(data?.ticket ?? 12000, 12000);
  const recoveryImpact = inactiveClients.length * estimatedTicket;
  const emptySlotsImpact = emptySlots * estimatedTicket;
  const ticketImpact = (data?.cobros ?? 0) * 1000;

  const health = React.useMemo(() => {
    if (!data) return 0;
    let score = 55;
    if (data.revHoy > 0) score += 10;
    if (data.utilidad > 0) score += 10;
    if (data.occ >= 50) score += 10;
    if (data.ticket >= data.ticketAyer && data.ticket > 0) score += 5;
    if (inactiveClients.length <= Math.max(allClients.length * 0.35, 5)) score += 5;
    if (noShowRisk === 0) score += 5;
    return Math.max(0, Math.min(100, score));
  }, [allClients.length, data, inactiveClients.length, noShowRisk]);

  const dailyAlerts: Insight[] = [
    inactiveClients.length > 0
      ? {
          title: `Recuperar ${inactiveClients.length} clientes`,
          detail: `Impacto estimado: ${fmtAR(recoveryImpact)}.`,
          tone: "warning",
        }
      : {
          title: "Clientes al día",
          detail: "No hay una alerta fuerte de recuperación.",
          tone: "good",
        },
    emptySlots > 0
      ? {
          title: `Tenés ${emptySlots} espacios libres hoy`,
          detail: `Podrías generar hasta ${fmtAR(emptySlotsImpact)}.`,
          tone: "warning",
        }
      : {
          title: "Agenda completa",
          detail: "Buen nivel de ocupación para hoy.",
          tone: "good",
        },
    noShowRisk > 0
      ? {
          title: `${noShowRisk} cancelaciones recientes`,
          detail: "Reforzá señas o recordatorios para reducir ausencias.",
          tone: "warning",
        }
      : {
          title: "Sin cancelaciones relevantes",
          detail: "La agenda viene estable.",
          tone: "good",
        },
  ];

  const todayTasks: Insight[] = [
    {
      title: "Contactar clientes inactivos",
      detail: inactiveClients.length > 0 ? `Prioridad: ${Math.min(inactiveClients.length, 20)} clientes.` : "Mantené activa la fidelización.",
    },
    {
      title: "Completar horarios libres",
      detail: emptySlots > 0 ? "Usá historias o WhatsApp para llenar huecos." : "La agenda de hoy está bien cubierta.",
    },
    {
      title: "Revisar pendientes de cobro",
      detail: data && data.cobros === 0 ? "Todavía no hay cobros registrados hoy." : "Controlá que todo servicio quede cobrado.",
    },
  ];

  const strengths: Insight[] = [
    {
      title: "Clientes VIP",
      detail: `${vipClients.length} clientes de alto valor detectados.`,
      tone: vipClients.length > 0 ? "good" : "neutral",
    },
    {
      title: "Ticket promedio",
      detail: data?.ticket ? `${fmtAR(data.ticket)} por cobro.` : "Sin cobros registrados todavía.",
      tone: data?.ticket ? "good" : "neutral",
    },
    {
      title: "Utilidad del día",
      detail: data ? `${fmtAR(data.utilidad)} estimados.` : "Cargando datos.",
      tone: data && data.utilidad >= 0 ? "good" : "warning",
    },
    {
      title: "Servicios más vendidos",
      detail: data?.topServices?.[0]?.name ? `${data.topServices[0].name} lidera el día.` : "Aún no hay servicio destacado.",
      tone: data?.topServices?.[0]?.name ? "good" : "neutral",
    },
    {
      title: "Clientes atendidos",
      detail: data ? `${data.clientsCount} clientes con cobros hoy.` : "Cargando datos.",
      tone: data?.clientsCount ? "good" : "neutral",
    },
  ];

  const improvements: Insight[] = [
    {
      title: "Recuperación",
      detail: `${inactiveClients.length} clientes pueden volver con una campaña simple.`,
      tone: inactiveClients.length > 0 ? "warning" : "good",
    },
    {
      title: "Ocupación",
      detail: data ? `${data.occ}% de ocupación estimada hoy.` : "Cargando datos.",
      tone: data && data.occ < 60 ? "warning" : "good",
    },
    {
      title: "Cancelaciones",
      detail: noShowRisk > 0 ? "Revisá señas y recordatorios." : "Sin alerta fuerte de cancelaciones.",
      tone: noShowRisk > 0 ? "warning" : "good",
    },
    {
      title: "Ticket promedio",
      detail: ticketDelta === null ? "Comparación disponible con más cobros." : `${ticketDelta >= 0 ? "+" : ""}${ticketDelta}% vs período anterior.`,
      tone: ticketDelta !== null && ticketDelta < 0 ? "warning" : "good",
    },
    {
      title: "Ventas del mes",
      detail: month ? `${fmtAR(month.revHoy)} acumulado mensual.` : "Cargando mes.",
      tone: month?.revHoy ? "good" : "neutral",
    },
  ];

  if (dashboard.isLoading || clients.isLoading) {
    return <div className="text-sm text-muted-foreground">Analizando métricas del negocio…</div>;
  }

  const healthTone = health >= 76 ? "good" : health >= 51 ? "warning" : "danger";
  const healthColorClass =
    healthTone === "good"
      ? "text-emerald-400"
      : healthTone === "warning"
        ? "text-amber-300"
        : "text-red-400";
  const healthBarClass =
    healthTone === "good"
      ? "from-emerald-500 to-primary"
      : healthTone === "warning"
        ? "from-amber-400 to-accent"
        : "from-red-500 to-amber-400";
  const healthLabel = healthTone === "good" ? "Salud fuerte" : healthTone === "warning" ? "Hay oportunidades" : "Requiere atención";

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <GlassCard className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary ring-1 ring-primary/20">
                <Brain className="h-3.5 w-3.5" />
                Análisis del día
              </div>
              <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">Salud del negocio</h2>
              <p className="mt-1 text-sm text-muted-foreground">Lectura rápida de ingresos, ocupación, clientes y caja.</p>
            </div>
            <div className="text-right">
              <div className={cn("font-display text-6xl font-semibold tracking-tight", healthColorClass)}>{health}</div>
              <div className="text-sm text-muted-foreground">sobre 100</div>
              <div className={cn("mt-1 text-xs font-medium", healthColorClass)}>{healthLabel}</div>
            </div>
          </div>

          <div className="mt-6 h-3 overflow-hidden rounded-full bg-white/10">
            <div
              className={cn("h-full rounded-full bg-gradient-to-r transition-all", healthBarClass)}
              style={{ width: `${health}%` }}
            />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Metric label="Facturación hoy" value={fmtAR(data?.revHoy ?? 0)} delta={revenueDelta} />
            <Metric label="Ocupación" value={`${data?.occ ?? 0}%`} />
            <Metric label="Clientes" value={`${data?.clientsCount ?? 0}`} />
          </div>
        </GlassCard>

        <GlassCard className="p-5 sm:p-6">
          <SectionTitle icon={Bell} title="Notificaciones de hoy" />
          <div className="mt-4 space-y-3">
            {dailyAlerts.map((item) => (
              <InsightRow key={item.title} item={item} />
            ))}
          </div>
        </GlassCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <GlassCard className="p-5">
          <SectionTitle icon={Target} title="Prioridad de hoy" />
          <div className="mt-4 space-y-3">
            {todayTasks.map((item, index) => (
              <div key={item.title} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{index + 1}</div>
                <div>
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="text-xs text-muted-foreground">{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <SectionTitle icon={DollarSign} title="Oportunidades" />
          <div className="mt-4 space-y-3">
            <Opportunity label="Recuperar inactivos" value={fmtAR(recoveryImpact)} />
            <Opportunity label="Llenar espacios libres" value={fmtAR(emptySlotsImpact)} />
            <Opportunity label="Subir ticket +$1.000" value={fmtAR(ticketImpact)} />
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <SectionTitle icon={Trophy} title="Equipo" />
          <div className="mt-4 space-y-3 text-sm">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="font-medium">Profesional destacado</div>
              <div className="text-xs text-muted-foreground">Disponible cuando haya más datos de rendimiento.</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="font-medium">Espacios vacíos</div>
              <div className="text-xs text-muted-foreground">{emptySlots} turnos potenciales para completar hoy.</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="font-medium">Cobros registrados</div>
              <div className="text-xs text-muted-foreground">{data?.cobros ?? 0} movimientos en caja.</div>
            </div>
          </div>
        </GlassCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <SectionTitle icon={CheckCircle2} title="5 cosas buenas" />
          <div className="mt-4 space-y-3">
            {strengths.map((item) => (
              <InsightRow key={item.title} item={item} />
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <SectionTitle icon={AlertTriangle} title="5 puntos a mejorar" />
          <div className="mt-4 space-y-3">
            {improvements.map((item) => (
              <InsightRow key={item.title} item={item} />
            ))}
          </div>
        </GlassCard>
      </section>

      <GlassCard className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <SectionTitle icon={Sparkles} title="Análisis mensual" />
            <p className="mt-2 text-sm text-muted-foreground">Generá un cierre simple con fortalezas, mejoras y acciones para el próximo mes.</p>
          </div>
          <button
            type="button"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-4 text-sm font-semibold text-white shadow-[0_12px_28px_-14px_oklch(0.65_0.28_290/0.7)] transition hover:brightness-110"
          >
            <ClipboardList className="h-4 w-4" />
            Generar análisis
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Metric label="Mes actual" value={fmtAR(month?.revHoy ?? 0)} />
          <Metric label="Ticket promedio" value={fmtAR(month?.ticket ?? 0)} />
          <Metric label="Clientes activos" value={`${allClients.filter((client) => client.status === "activo" || client.status === "vip").length}`} />
        </div>
      </GlassCard>
    </div>
  );
}

function GlassCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("glass rounded-3xl", className)}>{children}</div>;
}

function SectionTitle({ icon: Icon, title }: { icon: React.ComponentType<{ className?: string }>; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
        <Icon className="h-4 w-4" />
      </div>
      <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
    </div>
  );
}

function InsightRow({ item }: { item: Insight }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div
        className={cn(
          "mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full",
          item.tone === "good" && "bg-emerald-400",
          item.tone === "warning" && "bg-amber-400",
          (!item.tone || item.tone === "neutral") && "bg-primary",
        )}
      />
      <div className="min-w-0">
        <div className="text-sm font-medium">{item.title}</div>
        <div className="text-xs text-muted-foreground">{item.detail}</div>
      </div>
    </div>
  );
}

function Metric({ label, value, delta }: { label: string; value: string; delta?: number | null }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
        {value}
        {delta !== undefined && delta !== null && (
          <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", delta >= 0 ? "text-emerald-400" : "text-amber-400")}>
            <ArrowUpRight className={cn("h-3 w-3", delta < 0 && "rotate-90")} />
            {delta >= 0 ? "+" : ""}{delta}%
          </span>
        )}
      </div>
    </div>
  );
}

function Opportunity({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Lightbulb className="h-4 w-4 text-primary" />
        {label}
      </div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
