import React from 'react';
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useCajaData, type Service } from "@/components/cash-register/use-caja-data";
import {
  PAY_METHOD_LABEL,
  registerPayment,
  type PayMethod,
} from "@/components/cash-register/register-payment";
import {
  openCashSession,
  closeCashSession,
} from "@/components/cash-register/session-actions";
import { PreciosTab } from "@/components/cash-register/precios-tab";
import { InventarioTab } from "@/components/cash-register/inventario-tab";
import { GastosTab } from "@/components/cash-register/gastos-tab";
import { ProfesionalesTab } from "@/components/cash-register/profesionales-tab";
import {
  Search,
  Plus,
  Minus,
  Zap,
  Hand,
  Clock,
  Wallet,
  BarChart3,
  TrendingUp,
  ArrowRight,
  Trash2,
  ClipboardList,
  CreditCard,
  Banknote,
  Smartphone,
  Check,
  Loader2,
  Unlock,
  CalendarDays
} from "lucide-react";

export const Route = createFileRoute("/cash-register")({
  validateSearch: (search: Record<string, unknown>) => ({
    depositAppointmentId: (search.depositAppointmentId as string) ?? null,
    depositAmount: (search.depositAmount as string) ?? null,
    clientName: (search.clientName as string) ?? null,
    serviceName: (search.serviceName as string) ?? null,
    employeeId: (search.employeeId as string) ?? null,
    appointmentId: (search.appointmentId as string) ?? null,
    finalAmount: (search.finalAmount as string) ?? null,
    depositPaid: (search.depositPaid as string) ?? null,
    totalPrice: (search.totalPrice as string) ?? null,
  }),
  head: () => ({
    meta: [
      { title: "Caja & Cobro — Clippr" },
      { name: "description", content: "Caja del día, nueva venta, precios e inventario." },
    ],
  }),
  component: CashRegisterPage,
});

type Tab = "resumen" | "nueva" | "precios" | "inventario" | "gastos" | "profesionales";

function CashRegisterPage() {
  const { session, loading: authLoading, permissions } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ from: "/cash-register" });
  const data = useCajaData();
  // Determine initial tab based on search params
  const [tab, setTab] = useState<Tab>(
    search.depositAppointmentId || search.appointmentId ? "nueva" : "resumen"
  );
  // Toast on arrival from deposit/cobro flow
  React.useEffect(() => {
    if (search.depositAppointmentId && search.depositAmount) {
      toast.info(`Cobrar seña de $${parseInt(search.depositAmount).toLocaleString("es-AR")} para ${search.clientName ?? "cliente"}`);
    } else if (search.appointmentId && search.depositPaid && parseInt(search.depositPaid) > 0) {
      toast.info(`Cobro final: $${parseInt(search.finalAmount ?? "0").toLocaleString("es-AR")} (seña pagada: $${parseInt(search.depositPaid).toLocaleString("es-AR")})`);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && !session) navigate({ to: "/login", replace: true });
  }, [authLoading, session, navigate]);

  if (authLoading || !session) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" /> Cargando…
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Header data={data} />
      <Tabs tab={tab} onChange={setTab} />
      <div className="mt-6">
        {tab === "resumen" && <ResumenTab data={data} equipoEnabled={permissions.equipo} />}
        {tab === "nueva" && <NuevaVentaTab data={data} />}
        {tab === "precios" && <PreciosTab businessId={data.businessId} />}
        {tab === "inventario" && (
          <InventarioTab businessId={data.businessId} userEmail={session.user.email ?? null} />
        )}
        {tab === "gastos" && <GastosTab businessId={data.businessId} />}
        {tab === "profesionales" && (
          <ProfesionalesTab businessId={data.businessId} userEmail={session.user.email ?? null} />
        )}

      </div>
    </AppShell>
  );
}

function Header({ data: _data }: { data: ReturnType<typeof useCajaData> }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 className="font-display text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
          Caja
        </h1>
      </div>
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "precios", label: "Precios" },
  { id: "inventario", label: "Inventario" },
  { id: "profesionales", label: "Liquidaciones" },
];

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const nuevaActive = tab === "nueva";
  return (
    <div className="mt-6 flex items-end justify-between gap-3 border-b border-white/5">
      <div className="flex gap-1 overflow-x-auto -mb-px flex-1 min-w-0">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={cn(
                "relative px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors",
                active ? "text-amber-200" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              {active && (
                <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-gradient-to-r from-amber-300/80 via-amber-200 to-amber-400/80 shadow-[0_0_12px] shadow-amber-300/40" />
              )}
            </button>
          );
        })}
      </div>
      {tab === "resumen" && (
        <div className="shrink-0 mb-2 flex items-center gap-2">
          <button
            onClick={() => onChange("gastos")}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all bg-white/[0.04] text-foreground border border-white/10 hover:bg-white/[0.07]"
          >
            <span className="text-base leading-none">＋</span> Nuevo gasto
          </button>
          <button
            onClick={() => onChange("nueva")}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all",
              nuevaActive
                ? "bg-gradient-to-r from-amber-200 to-amber-400 text-black shadow-[0_8px_30px_-8px_oklch(0.78_0.17_65/0.7)] ring-1 ring-amber-300/60"
                : "bg-gradient-to-r from-amber-300/90 to-amber-500/90 text-black hover:brightness-110 shadow-[0_8px_24px_-10px_oklch(0.78_0.17_65/0.55)]"
            )}
          >
            <span className="text-base leading-none">＋</span> Nueva venta
          </button>
          <CierreCajaBtn />
        </div>
      )}
    </div>
  );
}


function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025]",
        "shadow-[0_1px_0_oklch(1_0_0/0.04)_inset,0_20px_50px_-20px_oklch(0_0_0/0.6)]",
        "backdrop-blur-xl",
        className
      )}
    >
      {children}
    </div>
  );
}

function Money({ value, large = false }: { value: number; large?: boolean }) {
  const integer = useMemo(() => Math.round(value).toLocaleString("es-AR"), [value]);
  return (
    <span
      className={cn(
        "font-display tabular-nums tracking-tight text-foreground",
        large ? "text-4xl font-semibold" : "text-2xl font-semibold"
      )}
    >
      <span className="text-muted-foreground/70 mr-0.5">$</span>
      {integer}
    </span>
  );
}

// ───────────────────────────── RESUMEN
function ResumenTab({ data, equipoEnabled }: { data: ReturnType<typeof useCajaData>; equipoEnabled: boolean }) {
  // Métodos más usados
  const topMethods = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of data.paymentsToday) {
      const m = String(p.method ?? p.payment_method ?? "cash");
      counts[m] = (counts[m] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [data.paymentsToday]);

  const stats = [
    {
      label: "Cobrado",
      value: data.revHoy,
      icon: Wallet,
      tint: "from-amber-400/20 to-amber-500/0",
      money: true,
    },
    {
      label: "Pendiente",
      value: data.pendingAmount,
      icon: Clock,
      tint: "from-violet-400/25 to-violet-500/0",
      money: true,
    },
    {
      label: "Cobros",
      value: data.cobros,
      icon: ClipboardList,
      tint: "from-sky-400/25 to-sky-500/0",
      money: false,
    },
    {
      label: "Clientes",
      value: data.cobros,
      icon: BarChart3,
      tint: "from-emerald-400/25 to-emerald-500/0",
      money: false,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div
              className={cn(
                "pointer-events-none absolute -top-14 -right-10 size-32 rounded-full blur-3xl opacity-60 bg-gradient-to-br",
                s.tint
              )}
            />
            <div className="flex items-start justify-between relative gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{s.label}</p>
                <div className="mt-2">
                  {s.money ? (
                    <Money value={Number(s.value)} />
                  ) : (
                    <span className="font-display tabular-nums tracking-tight text-2xl font-semibold text-foreground">
                      {Number(s.value).toLocaleString("es-AR")}
                    </span>
                  )}
                </div>
              </div>
              <div className="rounded-xl bg-white/[0.04] border border-white/5 p-2">
                <s.icon className="size-3.5 text-foreground/80" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <History data={data} equipoEnabled={equipoEnabled} />
    </div>
  );
}

function ApprovalMode({ data, equipoEnabled }: { data: ReturnType<typeof useCajaData>; equipoEnabled: boolean }) {
  if (!data.approvalModeEnabled || !equipoEnabled) return null;

  const mode = data.approvalMode;
  const desc: Record<typeof mode, string> = {
    auto: "Automático — el profesional cobra desde su panel y el cobro impacta sin confirmación.",
    manual: "Manual — el servicio queda pendiente y caja/recepción lo confirma y cobra.",
  };
  const labelMap: Record<typeof mode, string> = {
    auto: "AUTOMÁTICO",
    manual: "MANUAL",
  };
  const chipCls: Record<typeof mode, string> = {
    auto: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    manual: "border-amber-300/30 bg-amber-300/10 text-amber-200",
  };
  const dotCls: Record<typeof mode, string> = {
    auto: "bg-emerald-400",
    manual: "bg-amber-300",
  };
  const options: { id: typeof mode; label: string; icon: typeof Zap }[] = [
    { id: "auto", label: "Automático", icon: Zap },
    { id: "manual", label: "Manual", icon: Hand },
  ];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-foreground">Modo de aprobación</h3>
          <p className="text-sm text-muted-foreground mt-0.5">{desc[mode]}</p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium tracking-wide border",
            chipCls[mode],
          )}
        >
          <span className={cn("size-1.5 rounded-full", dotCls[mode])} />
          {labelMap[mode]}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 p-1 rounded-xl bg-white/[0.03] border border-white/5">
        {options.map((o) => {
          const active = mode === o.id;
          return (
            <button
              key={o.id}
              onClick={() => data.setApprovalMode(o.id)}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all",
                active
                  ? "bg-gradient-to-b from-white/[0.08] to-white/[0.02] text-foreground shadow-[0_1px_0_oklch(1_0_0/0.08)_inset]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <o.icon className="size-4 text-amber-300" /> {o.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function CierreCajaBtn() {
  // Trigger closeout via a custom event — History component listens
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("clippr:open-closeout"))}
      className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all bg-white/[0.04] text-foreground border border-white/10 hover:bg-white/[0.07]"
    >
      Cierre de caja
    </button>
  );
}

// helpers
const CHARGE_TYPE_META: Record<string, { label: string; cls: string }> = {
  auto:   { label: "Automático", cls: "bg-emerald-500/10 ring-emerald-400/25 text-emerald-300" },
  manual: { label: "Manual",     cls: "bg-amber-500/10  ring-amber-400/25  text-amber-200"  },
  caja:   { label: "Caja",       cls: "bg-sky-500/10    ring-sky-400/25    text-sky-300"    },
};

const STATUS_META: Record<string, { label: string; dot: string }> = {
  cobrado:     { label: "Cobrado",     dot: "bg-emerald-400" },
  pendiente:   { label: "Pendiente",   dot: "bg-amber-400"   },
  aprobado:    { label: "Aprobado",    dot: "bg-sky-400"     },
  anulado:     { label: "Anulado",     dot: "bg-rose-400"    },
  reembolsado: { label: "Reembolsado", dot: "bg-violet-400"  },
};

function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, dot: "bg-white/40" };
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium">
      <span className={cn("size-1.5 rounded-full shrink-0", m.dot)} />
      {m.label}
    </span>
  );
}

function ChargeTypePill({ type }: { type: string }) {
  const m = CHARGE_TYPE_META[type] ?? { label: type, cls: "bg-white/5 ring-white/10 text-muted-foreground" };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1", m.cls)}>
      {m.label}
    </span>
  );
}

function DetailModal({ payment, employees, onClose }: {
  payment: ReturnType<typeof useCajaData>["paymentsToday"][number];
  employees: ReturnType<typeof useCajaData>["employees"];
  onClose: () => void;
}) {
  const method = (payment.method ?? payment.payment_method ?? "cash") as PayMethod;
  const empName = employees.find(e => e.id === payment.employee_id)?.name ?? null;
  const chargedBy = (payment as Record<string, unknown>).charged_by as string | null ?? null;
  const chargeType = (payment as Record<string, unknown>).charge_type as string | null ?? "caja";
  const status = (payment as Record<string, unknown>).status as string | null ?? "cobrado";
  const comprobante = (payment as Record<string, unknown>).reference as string | null ?? null;
  const obs = (payment as Record<string, unknown>).observations as string | null ?? null;
  const commission = payment.employee_id && employees.find(e => e.id === payment.employee_id)?.commission_pct
    ? Math.round(Number(payment.total ?? payment.amount ?? 0) * (employees.find(e => e.id === payment.employee_id)!.commission_pct! / 100))
    : null;

  const fmtDT = (iso: string | null) => iso
    ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs text-foreground text-right">{value ?? "—"}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold">Detalle del cobro</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">{fmtDT(payment.created_at)}</p>
          </div>
          <button onClick={onClose} className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs transition">Cerrar</button>
        </div>
        <div className="px-5 py-1 max-h-[72vh] overflow-y-auto">
          <div className="py-3 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
            <span className="font-display text-2xl font-semibold tabular-nums">
              ${Number(payment.total ?? payment.amount ?? 0).toLocaleString("es-AR")}
            </span>
            <div className="flex gap-2 flex-wrap">
              <StatusPill status={status} />
              <ChargeTypePill type={chargeType} />
            </div>
          </div>

          <div className="mt-1 space-y-0">
            <Row label="Cliente"       value={payment.client_name ?? "—"} />
            <Row label="Profesional"   value={empName} />
            <Row label="Servicio"      value={payment.service_name ?? "—"} />
            <Row label="Método de pago" value={PAY_METHOD_LABEL[method] ?? method} />
            <Row label="Cobrado por"   value={chargedBy} />
            <Row label="Tipo de cobro" value={<ChargeTypePill type={chargeType} />} />
            <Row label="Estado"        value={<StatusPill status={status} />} />
            {commission !== null && (
              <Row label="Comisión prof." value={`$${commission.toLocaleString("es-AR")}`} />
            )}
            {comprobante && <Row label="Comprobante / Ref." value={comprobante} />}
            {obs && <Row label="Observaciones" value={obs} />}
          </div>

          <div className="mt-3 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3 space-y-0">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">Trazabilidad</p>
            <Row label="Registrado"  value={fmtDT(payment.created_at)} />
            <Row label="Aprobado"    value={fmtDT((payment as Record<string, unknown>).approved_at as string | null ?? null)} />
            <Row label="Cobrado"     value={fmtDT((payment as Record<string, unknown>).charged_at as string | null ?? payment.created_at)} />
          </div>
          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}

function History({ data, equipoEnabled }: { data: ReturnType<typeof useCajaData>; equipoEnabled: boolean }) {
  const rows = data.paymentsToday;
  const [closeoutOpen, setCloseoutOpen] = React.useState(false);
  const [selectedMethod, setSelectedMethod] = React.useState<string | null>(null);
  const [detailPayment, setDetailPayment] = React.useState<typeof rows[number] | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  const visibleRows = showAll ? rows : rows.slice(0, 10);

  const closeout = React.useMemo(() => {
    const groups = data.paymentsToday.reduce((acc, payment) => {
      const method = String(payment.method ?? payment.payment_method ?? "cash");
      if (!acc[method]) acc[method] = { method, total: 0, count: 0, rows: [] as typeof data.paymentsToday };
      acc[method].total += Number(payment.total ?? payment.amount ?? 0);
      acc[method].count += 1;
      acc[method].rows.push(payment);
      return acc;
    }, {} as Record<string, { method: string; total: number; count: number; rows: typeof data.paymentsToday }>);
    return Object.values(groups).sort((a, b) => b.total - a.total);
  }, [data.paymentsToday]);

  const totalFacturado = closeout.reduce((sum, g) => sum + g.total, 0);
  const selectedGroup = closeout.find(g => g.method === selectedMethod) ?? closeout[0] ?? null;

  return (
    <>
      <Card>
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">Cobros</h3>
            <span className="text-[11px] text-muted-foreground">
              {data.cobros} cobro{data.cobros === 1 ? "" : "s"} hoy
            </span>
            {data.approvalModeEnabled && equipoEnabled && (
              <div className="flex gap-1 ml-1">
                {([
                  { id: "auto",   label: "Automático", title: "El profesional cobra desde su panel sin confirmación", activeCls: "bg-emerald-500/15 ring-emerald-400/35 text-emerald-300" },
                  { id: "manual", label: "Manual",      title: "Caja/recepción confirma y cobra cada servicio",        activeCls: "bg-amber-500/15  ring-amber-400/35  text-amber-300"  },
                ] as const).map((opt) => (
                  <button key={opt.id} onClick={() => data.setApprovalMode(opt.id)} title={opt.title}
                    className={cn("px-2.5 py-1 rounded-full text-[11px] font-medium ring-1 transition",
                      data.approvalMode === opt.id ? opt.activeCls : "bg-white/[0.03] ring-white/10 text-muted-foreground hover:text-foreground")}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Table header */}
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className="grid grid-cols-[60px_110px_1.2fr_1.2fr_110px_90px_90px_130px] px-5 py-3 text-[10px] tracking-[0.16em] text-muted-foreground/60 border-b border-white/5 uppercase">
              <div>Fecha</div>
              <div>Hora</div>
              <div>Cliente</div>
              <div>Profesional</div>
              <div>Servicio</div>
              <div>Total</div>
              <div>Método</div>
              <div>Estado</div>
            </div>

            {/* Rows */}
            {data.loading ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
                <Loader2 className="size-4 animate-spin" /> Cargando…
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">Sin cobros hoy</div>
            ) : (
              visibleRows.map((p) => {
                const dt = new Date(p.created_at);
                const fecha = dt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
                const hora  = dt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
                const method = (p.method ?? p.payment_method ?? "cash") as PayMethod;
                const empName = data.employees.find(e => e.id === p.employee_id)?.name ?? "—";
                const status = (p as Record<string, unknown>).status as string | null ?? "cobrado";
                const chargeType = (p as Record<string, unknown>).charge_type as string | null ?? null;

                return (
                  <div key={p.id}
                    className="grid grid-cols-[60px_110px_1.2fr_1.2fr_110px_90px_90px_130px] px-5 py-3 text-xs border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition group cursor-pointer"
                    onClick={() => setDetailPayment(p)}
                  >
                    <div className="text-muted-foreground">{fecha}</div>
                    <div className="text-muted-foreground">{hora}</div>
                    <div className="text-foreground truncate">{p.client_name ?? "—"}</div>
                    <div className="text-muted-foreground truncate">{empName}</div>
                    <div className="text-muted-foreground truncate">{p.service_name ?? "—"}</div>
                    <div className="text-foreground tabular-nums font-medium">
                      ${Number(p.total ?? p.amount ?? 0).toLocaleString("es-AR")}
                    </div>
                    <div className="text-[11px] text-emerald-300">{PAY_METHOD_LABEL[method] ?? method}</div>
                    <div className="flex items-center gap-1.5">
                      <StatusPill status={status} />
                      {chargeType && <span className="hidden group-hover:inline"><ChargeTypePill type={chargeType} /></span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/5 flex items-center justify-between gap-3">
          {rows.length > 10 && (
            <button onClick={() => setShowAll(v => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition inline-flex items-center gap-1.5">
              <ArrowRight className={cn("size-3.5 transition", showAll && "rotate-90")} />
              {showAll ? "Mostrar menos" : `Ver ${rows.length - 10} cobros más`}
            </button>
          )}
          <button onClick={() => window.dispatchEvent(new CustomEvent("clippr:open-closeout"))}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-2">
            <ClipboardList className="size-3.5" /> Ver historial completo
          </button>
        </div>
      </Card>

      {/* Detail modal */}
      {detailPayment && (
        <DetailModal
          payment={detailPayment}
          employees={data.employees}
          onClose={() => setDetailPayment(null)}
        />
      )}

      {/* Closeout modal */}
      {closeoutOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-5xl rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold">Cierre de caja</h3>
                <p className="text-xs text-muted-foreground mt-1">Detalle de cobros del día por método de pago.</p>
              </div>
              <button type="button" onClick={() => setCloseoutOpen(false)}
                className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-sm">Cerrar</button>
            </div>
            <div className="p-5 space-y-5 max-h-[78vh] overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-[0.85fr_1.15fr] gap-4">
                <div className="rounded-2xl bg-white/[0.035] ring-1 ring-white/10 overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/5">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">Total facturado</div>
                    <div className="mt-1 text-3xl font-semibold tabular-nums">${totalFacturado.toLocaleString("es-AR")}</div>
                  </div>
                  {closeout.length === 0 ? (
                    <div className="p-6 text-sm text-muted-foreground text-center">No hay cobros registrados hoy.</div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {closeout.map((group) => {
                        const method = group.method as PayMethod;
                        const active = selectedGroup?.method === group.method;
                        return (
                          <button key={group.method} type="button" onClick={() => setSelectedMethod(group.method)}
                            className={cn("w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition",
                              active ? "bg-white/[0.07]" : "hover:bg-white/[0.045]")}>
                            <div>
                              <div className="text-sm font-semibold">{PAY_METHOD_LABEL[method] ?? group.method}</div>
                              <div className="text-xs text-muted-foreground">{group.count} cobro{group.count === 1 ? "" : "s"}</div>
                            </div>
                            <div className="text-sm font-semibold tabular-nums text-emerald-300">${group.total.toLocaleString("es-AR")}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="rounded-2xl bg-white/[0.035] ring-1 ring-white/10 overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">
                        {selectedGroup ? PAY_METHOD_LABEL[selectedGroup.method as PayMethod] ?? selectedGroup.method : "Detalle"}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {selectedGroup
                          ? `${selectedGroup.count} cobro${selectedGroup.count === 1 ? "" : "s"} · $${selectedGroup.total.toLocaleString("es-AR")}`
                          : "Seleccioná un método de pago."}
                      </div>
                    </div>
                  </div>
                  {!selectedGroup ? (
                    <div className="p-6 text-sm text-muted-foreground text-center">Seleccioná un método para ver el detalle.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-white/10">
                            {["Hora", "Cliente", "Servicio", "Monto"].map(h => (
                              <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {selectedGroup.rows.map(payment => {
                            const hour = new Date(payment.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
                            return (
                              <tr key={payment.id} className="border-b border-white/5 last:border-0">
                                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{hour}</td>
                                <td className="px-4 py-3 text-foreground whitespace-nowrap">{payment.client_name ?? "—"}</td>
                                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{payment.service_name ?? "—"}</td>
                                <td className="px-4 py-3 text-emerald-300 font-semibold tabular-nums whitespace-nowrap">
                                  ${Number(payment.total ?? payment.amount ?? 0).toLocaleString("es-AR")}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ───────────────────────────── NUEVA VENTA
type MultiSplit = { method: string; amount: string };

function NuevaVentaTab({ data }: { data: ReturnType<typeof useCajaData> }) {
  const [step, setStep] = React.useState<1 | 2 | 3 | 4>(1);
  const [cart, setCart] = React.useState<Record<string, number>>({});
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string>("");
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [client, setClient] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [birthDate, setBirthDate] = React.useState("");
  const [employeeId, setEmployeeId] = React.useState<string>("");
  const [method, setMethod] = React.useState<PayMethod>("cash");
  const [paymentMode, setPaymentMode] = React.useState<"simple" | "multiple">("simple");
  const [received, setReceived] = React.useState("");
  const [splits, setSplits] = React.useState<MultiSplit[]>([{ method: "cash", amount: "" }]);
  const [submitting, setSubmitting] = React.useState(false);

  // Build categories: services first, then catalog categories (no "Todos")
  const categories = React.useMemo(() => {
    const serviceItems = data.services.filter((s) => !s.is_catalog);
    const catalogItems = data.services.filter((s) => s.is_catalog);
    const cats: string[] = [];
    if (serviceItems.length > 0) cats.push("Servicios");
    const catalogCats = Array.from(new Set(catalogItems.map((s) => s.category || "Productos"))).filter(Boolean);
    return [...cats, ...catalogCats];
  }, [data.services]);

  // Set default category on load
  React.useEffect(() => {
    if (categories.length > 0 && !category) setCategory(categories[0]);
  }, [categories, category]);

  const filtered = data.services.filter((i) => {
    const q = query.trim().toLowerCase();
    const matchesText = !q || `${i.name} ${i.category ?? ""}`.toLowerCase().includes(q);
    const matchesCategory = category === "Servicios"
      ? !i.is_catalog
      : (i.category || "Productos") === category;
    return matchesText && matchesCategory;
  });

  const paymentOptions = React.useMemo(() => {
    const cfg = data.paymentMethods;
    return ([
      { id: "cash", label: "Efectivo", icon: Banknote, enabled: cfg.efectivo },
      { id: "transfer", label: "Transferencia", icon: Smartphone, enabled: cfg.transferencia },
      { id: "card", label: "Débito / Crédito", icon: CreditCard, enabled: cfg.tarjeta },
      { id: "mp", label: "Mercado Pago", icon: Wallet, enabled: cfg.mp },
      { id: "cuenta", label: "Cuenta DNI", icon: Smartphone, enabled: cfg.cuentaDni },
    ] as const).filter((m) => m.enabled);
  }, [data.paymentMethods]);

  React.useEffect(() => {
    if (!paymentOptions.some((m) => m.id === method)) {
      setMethod((paymentOptions[0]?.id ?? "cash") as PayMethod);
    }
  }, [paymentOptions, method]);

  const cartItems = Object.entries(cart)
    .map(([id, qty]) => { const svc = data.services.find((s) => s.id === id); return svc ? { svc, qty } : null; })
    .filter((x): x is { svc: typeof data.services[0]; qty: number } => x !== null);

  const total = cartItems.reduce((acc, { svc, qty }) => acc + Number(svc.price) * qty, 0);
  const cartCount = cartItems.reduce((acc, { qty }) => acc + qty, 0);
  const receivedNumber = Number(received || 0);
  const change = method === "cash" && receivedNumber > total ? receivedNumber - total : 0;
  const splitsTotal = splits.reduce((s, sp) => s + Number(sp.amount || 0), 0);
  const splitsRemaining = total - splitsTotal;
  const selectedEmployee = data.employees.find((e) => e.id === employeeId);

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  const sub = (id: string) => setCart((c) => {
    const n = (c[id] ?? 0) - 1;
    const { [id]: _, ...rest } = c;
    return n <= 0 ? rest : { ...c, [id]: n };
  });

  function addSplit() {
    const available = paymentOptions.filter((o) => !splits.some((s) => s.method === o.id));
    if (available.length === 0) return;
    setSplits((prev) => [...prev, { method: available[0].id, amount: "" }]);
  }
  function removeSplit(idx: number) { setSplits((prev) => prev.filter((_, i) => i !== idx)); }
  function updateSplit(idx: number, key: "method" | "amount", val: string) {
    setSplits((prev) => prev.map((s, i) => i === idx ? { ...s, [key]: val } : s));
  }

  function goNext() {
    if (step === 1 && !employeeId) { toast.error("Seleccioná un profesional."); return; }
    if (step === 2 && !client.trim()) { toast.error("Completá o seleccioná un cliente."); return; }
    if (step === 3 && cartItems.length === 0) { toast.error("Agregá al menos un servicio o producto."); return; }
    setStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  }

  async function saveClientIfNeeded(): Promise<string | null> {
    if (!data.businessId || !client.trim()) return clientId;
    if (clientId) return clientId;
    try {
      const { data: created, error } = await supabase
        .from("clients")
        .insert({ business_id: data.businessId, full_name: client.trim(), phone: phone.trim() || null, email: email.trim() || null, birth_date: birthDate || null })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return created?.id ?? null;
    } catch (e) {
      console.warn("[cash-register] no se pudo guardar cliente nuevo", e);
      return null;
    }
  }

  async function handleCobrar() {
    if (!data.businessId) { toast.error("No se pudo identificar el negocio."); return; }
    if (!employeeId) { toast.error("Seleccioná un profesional."); setStep(1); return; }
    if (cartItems.length === 0) { toast.error("Agregá al menos un servicio."); setStep(3); return; }

    if (paymentMode === "multiple") {
      if (splits.filter((s) => Number(s.amount) > 0).length < 1) {
        toast.error("Cargá al menos un monto en pago múltiple."); return;
      }
      if (Math.round(splitsTotal) !== Math.round(total)) {
        toast.error(`El pago múltiple debe sumar $${total.toLocaleString("es-AR")}. Falta/sobra $${Math.abs(splitsRemaining).toLocaleString("es-AR")}.`); return;
      }
    }

    setSubmitting(true);
    try {
      const savedClientId = await saveClientIfNeeded();
      if (savedClientId && !clientId) setClientId(savedClientId);

      const items = cartItems.map(({ svc, qty }) => ({
        serviceId: svc.id,
        serviceName: svc.name,
        amount: Number(svc.price),
        isCatalog: svc.is_catalog ?? false,
        stock: svc.stock,
        qty,
      }));

      const validSplits = paymentMode === "multiple"
        ? splits.filter((s) => Number(s.amount) > 0).map((s) => ({ method: s.method as PayMethod, amount: Number(s.amount) }))
        : undefined;

      await registerPayment({
        businessId: data.businessId,
        employeeId: employeeId || null,
        commissionPct: selectedEmployee?.commission_pct ?? null,
        clientName: client.trim() || "Cliente del mostrador",
        clientId: savedClientId,
        items,
        method,
        splits: validSplits,
        sessionId: data.cashSessionId,
        chargedBy: data.profileId,
      });

      toast.success(`Cobro confirmado · $${total.toLocaleString("es-AR")}`);
      setCart({}); setClientId(null); setClient(""); setPhone(""); setEmail(""); setBirthDate("");
      setReceived(""); setSplits([{ method: "cash", amount: "" }]); setPaymentMode("simple"); setStep(1);
      await data.refresh();
    } catch (e) {
      toast.error((e as Error).message || "Error al guardar el cobro");
    } finally {
      setSubmitting(false);
    }
  }

  const stepItems = [
    { n: 1, label: "Profesional" }, { n: 2, label: "Cliente" },
    { n: 3, label: "Servicios" }, { n: 4, label: "Pago" },
  ] as const;

  return (
    <div className="space-y-5">
      <Card className="p-1.5">
        <div className="grid grid-cols-4 gap-1">
          {stepItems.map((s) => {
            const active = step === s.n;
            return (
              <button key={s.n} onClick={() => setStep(s.n)}
                className={cn("rounded-xl px-3 py-2.5 text-xs font-semibold transition-all border",
                  active ? "bg-gradient-to-b from-amber-200 to-amber-300 text-black border-amber-200"
                    : "text-muted-foreground border-white/10 bg-white/[0.02] hover:text-foreground")}>
                {s.n} · {s.label}
              </button>
            );
          })}
        </div>
      </Card>

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Seleccioná un profesional</p>
          {data.employees.length === 0 ? (
            <Card className="px-4 py-10 text-center text-sm text-muted-foreground">
              No hay profesionales activos. Cargalos en Configuración → Equipo → Profesionales.
            </Card>
          ) : data.employees.map((e) => {
            const active = employeeId === e.id;
            return (
              <button key={e.id} type="button" onClick={() => setEmployeeId(e.id)}
                className={cn("w-full rounded-xl border px-4 py-3 flex items-center gap-3 text-left transition-all",
                  active ? "border-amber-300/50 bg-amber-300/10" : "border-white/10 bg-white/[0.025] hover:bg-white/[0.04]")}>
                <span className="size-9 rounded-full bg-gradient-to-br from-amber-200/80 to-amber-500/80 text-black font-semibold grid place-items-center">
                  {(e.name || "P").slice(0, 1).toUpperCase()}
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-foreground">{e.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {e.commission_pct != null ? `${e.commission_pct}% comisión` : "Profesional"}
                  </span>
                </span>
                {active ? <Check className="size-4 text-amber-200" /> : <ArrowRight className="size-4 text-muted-foreground" />}
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && (
        <Card className="p-5 space-y-4">
          <ClientAutocomplete value={client}
            onChange={(v) => { setClient(v); setClientId(null); }}
            onPick={(c) => { setClientId(c.id); setClient(c.name ?? ""); setPhone(c.phone ?? ""); setEmail(c.email ?? ""); setBirthDate(c.birth_date ?? ""); }}
            clients={data.clients} />
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
            <span className="h-px flex-1 bg-white/10" /> o completá los datos para crear uno nuevo <span className="h-px flex-1 bg-white/10" />
          </div>
          <div className="space-y-3">
            <input value={client} onChange={(e) => { setClient(e.target.value); setClientId(null); }} placeholder="Nombre *"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-amber-300/40" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Teléfono"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-amber-300/40" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-amber-300/40" />
            <input value={birthDate} onChange={(e) => setBirthDate(e.target.value)} type="date"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-amber-300/40" />
          </div>
        </Card>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <Card className="px-4 py-3 flex items-center gap-3">
            <Search className="size-4 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar servicio o producto..."
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground" />
          </Card>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {categories.map((c) => (
              <button key={c} onClick={() => setCategory(c)}
                className={cn("rounded-full border px-3 py-1.5 text-xs whitespace-nowrap transition-colors capitalize",
                  category === c ? "border-amber-300/50 bg-amber-300/10 text-amber-200"
                    : "border-white/10 bg-white/[0.025] text-muted-foreground hover:text-foreground")}>
                {c}
              </button>
            ))}
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.loading ? (
              <Card className="px-4 py-12 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
                <Loader2 className="size-4 animate-spin inline mr-2" /> Cargando…
              </Card>
            ) : filtered.length === 0 ? (
              <Card className="px-4 py-12 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
                Sin servicios o productos en esta categoría.
              </Card>
            ) : filtered.map((it) => {
              const qty = cart[it.id] ?? 0;
              const noStock = it.is_catalog && typeof it.stock === "number" && it.stock <= 0;
              return (
                <Card key={it.id} className={cn("p-4 space-y-3", noStock && "opacity-50")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{it.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {it.category ?? "ítem"}{it.duration ? ` · ${it.duration} min` : ""}
                        {noStock && <span className="ml-2 text-rose-300">Sin stock</span>}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-foreground tabular-nums">${Number(it.price).toLocaleString("es-AR")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {it.is_catalog && typeof it.stock === "number" ? (
                      <span className="text-[11px] text-muted-foreground">Stock {it.stock}</span>
                    ) : <span />}
                    <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
                      <button onClick={() => sub(it.id)} disabled={noStock && qty === 0}
                        className="size-8 grid place-items-center rounded-md hover:bg-white/5 text-muted-foreground hover:text-foreground">
                        <Minus className="size-3.5" />
                      </button>
                      <span className="w-8 text-center text-sm tabular-nums">{qty}</span>
                      <button onClick={() => add(it.id)}
                        disabled={noStock || (it.is_catalog && typeof it.stock === "number" && qty >= it.stock)}
                        className="size-8 grid place-items-center rounded-md hover:bg-white/5 text-foreground disabled:opacity-40">
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {step === 4 && (
        <Card className="p-5 space-y-5">
          <div className="space-y-2">
            <p className="text-[11px] tracking-[0.18em] text-muted-foreground/70">RESUMEN</p>
            {cartItems.map(({ svc, qty }) => (
              <div key={svc.id} className="flex items-center justify-between gap-3 text-sm border-b border-white/5 pb-2">
                <span className="text-muted-foreground">{svc.name} x{qty}</span>
                <span className="text-foreground tabular-nums">${(Number(svc.price) * qty).toLocaleString("es-AR")}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2">
              <span className="text-lg font-semibold text-foreground">Total</span>
              <Money value={total} />
            </div>
            {selectedEmployee && selectedEmployee.commission_pct != null && (
              <div className="text-xs text-muted-foreground flex gap-4">
                <span>Profesional ({selectedEmployee.commission_pct}%): ${Math.round(total * selectedEmployee.commission_pct / 100).toLocaleString("es-AR")}</span>
                <span>Local: ${Math.round(total * (1 - selectedEmployee.commission_pct / 100)).toLocaleString("es-AR")}</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-white/[0.03] border border-white/5">
            <button onClick={() => setPaymentMode("simple")}
              className={cn("rounded-lg py-2.5 text-sm font-semibold", paymentMode === "simple" ? "bg-amber-200 text-black" : "text-muted-foreground hover:text-foreground")}>
              Pago simple
            </button>
            <button onClick={() => setPaymentMode("multiple")}
              className={cn("rounded-lg py-2.5 text-sm font-semibold", paymentMode === "multiple" ? "bg-amber-200 text-black" : "text-muted-foreground hover:text-foreground")}>
              Pago múltiple
            </button>
          </div>

          {paymentMode === "simple" ? (
            <>
              <div>
                <p className="text-[11px] tracking-[0.18em] text-muted-foreground/70 mb-3">MÉTODO DE PAGO</p>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {paymentOptions.map((m) => {
                    const active = method === m.id;
                    return (
                      <button key={m.id} onClick={() => setMethod(m.id as PayMethod)}
                        className={cn("flex flex-col items-center gap-2 rounded-xl border p-4 transition-all",
                          active ? "border-amber-300/50 bg-amber-300/10 text-foreground"
                            : "border-white/10 bg-white/[0.02] text-muted-foreground hover:text-foreground")}>
                        <m.icon className="size-5" /> <span className="text-sm font-medium">{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {method === "cash" && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">¿Con cuánto paga?</label>
                  <input value={received} onChange={(e) => setReceived(e.target.value)} inputMode="numeric" placeholder="Monto entregado"
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-amber-300/40" />
                  {receivedNumber > 0 && (
                    <p className="text-sm text-muted-foreground">
                      Entregado: ${receivedNumber.toLocaleString("es-AR")}{change > 0 && <span className="text-emerald-300"> | Vuelto: ${change.toLocaleString("es-AR")}</span>}
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] tracking-[0.18em] text-muted-foreground/70">PAGO MÚLTIPLE</p>
              {splits.map((sp, idx) => {
                const opt = paymentOptions.find((o) => o.id === sp.method);
                const Icon = opt?.icon ?? Wallet;
                return (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_36px] gap-2 items-center">
                    <select value={sp.method} onChange={(e) => updateSplit(idx, "method", e.target.value)}
                      className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-foreground outline-none">
                      {paymentOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                    <input value={sp.amount} onChange={(e) => updateSplit(idx, "amount", e.target.value)}
                      inputMode="numeric" placeholder="Monto"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-300/40" />
                    <button onClick={() => removeSplit(idx)} disabled={splits.length <= 1}
                      className="h-10 w-9 rounded-xl border border-white/10 bg-white/[0.03] grid place-items-center text-muted-foreground hover:text-rose-300 disabled:opacity-30 transition-colors">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                );
              })}
              <button onClick={addSplit} disabled={splits.length >= paymentOptions.length}
                className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
                <Plus className="size-3.5" /> Agregar método de pago
              </button>
              <div className="flex items-center justify-between text-sm rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3">
                <span className="text-muted-foreground">Total cargado: ${splitsTotal.toLocaleString("es-AR")}</span>
                <span className={cn("font-semibold", splitsRemaining === 0 ? "text-emerald-300" : splitsRemaining > 0 ? "text-amber-200" : "text-rose-300")}>
                  {splitsRemaining === 0 ? "Completo ✓" : splitsRemaining > 0 ? `Falta $${splitsRemaining.toLocaleString("es-AR")}` : `Sobra $${Math.abs(splitsRemaining).toLocaleString("es-AR")}`}
                </span>
              </div>
            </div>
          )}
        </Card>
      )}

      <div className="sticky bottom-4 z-10">
        <Card className="px-4 py-3 flex items-center gap-4">
          <button onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s))} disabled={step === 1}
            className="rounded-xl px-5 py-3 text-sm font-medium border border-white/10 text-muted-foreground hover:text-foreground disabled:opacity-40">
            ← Volver
          </button>
          <div className="flex-1 min-w-0 text-right sm:text-left">
            <p className="text-[11px] tracking-[0.16em] text-muted-foreground/70">TOTAL</p>
            <p className="text-sm text-foreground">{cartCount} item{cartCount === 1 ? "" : "s"} · {selectedEmployee?.name ?? "Sin profesional"}</p>
          </div>
          <Money value={total} />
          {step < 4 ? (
            <button onClick={goNext}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-zinc-950 bg-gradient-to-b from-amber-200 to-amber-400 hover:from-amber-100 hover:to-amber-300 disabled:opacity-40 transition-all">
              Continuar <ArrowRight className="size-4" />
            </button>
          ) : (
            <button disabled={cartCount === 0 || submitting || (paymentMode === "multiple" && splitsRemaining !== 0)} onClick={handleCobrar}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-zinc-950 bg-gradient-to-b from-amber-200 to-amber-400 hover:from-amber-100 hover:to-amber-300 disabled:opacity-40 transition-all">
              {submitting ? <><Loader2 className="size-4 animate-spin" /> Confirmando…</> : <>Confirmar cobro <Check className="size-4" /></>}
            </button>
          )}
        </Card>
      </div>
    </div>
  );
}

function ClientAutocomplete({
  value,
  onChange,
  onPick,
  clients,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (c: { id: string; name: string; phone: string | null; email?: string | null; birth_date?: string | null }) => void;
  clients: Array<{ id: string; name: string; phone: string | null; email?: string | null; birth_date?: string | null }>;
}) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const matches = q
    ? clients
        .filter((c) => `${c.name ?? ""} ${c.phone ?? ""} ${c.email ?? ""}`.toLowerCase().includes(q))
        .slice(0, 8)
    : clients.slice(0, 8);

  return (
    <label className="block relative">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 focus-within:border-amber-300/40">
        <Search className="size-4 text-muted-foreground" />
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Buscar cliente existente..."
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xl border border-white/10 bg-[oklch(0.13_0.025_282)]/95 backdrop-blur-xl shadow-2xl max-h-64 overflow-auto">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(c);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2.5 hover:bg-white/[0.05] flex items-center justify-between gap-3 border-b border-white/5 last:border-0"
            >
              <span className="min-w-0">
                <span className="block text-sm text-foreground truncate">{c.name}</span>
                {c.email && <span className="block text-xs text-muted-foreground truncate">{c.email}</span>}
              </span>
              {c.phone && <span className="text-xs text-muted-foreground tabular-nums truncate">{c.phone}</span>}
            </button>
          ))}
        </div>
      )}
    </label>
  );
}
