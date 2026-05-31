import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  TrendingUp,
  Wallet,
  Receipt,
  Users,
  Loader2,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Informes — Clippr" },
      { name: "description", content: "Facturación, gastos y métricas por rango." },
    ],
  }),
  component: ReportsPage,
});

type Range = "7d" | "30d" | "month" | "90d";

const RANGES: { key: Range; label: string }[] = [
  { key: "7d", label: "7 días" },
  { key: "30d", label: "30 días" },
  { key: "month", label: "Mes actual" },
  { key: "90d", label: "90 días" },
];

const PAY_LABELS: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  mp: "Mercado Pago",
  qr: "QR",
  cuenta: "Cuenta",
};

function getRange(r: Range): { from: Date; to: Date } {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (r === "7d") from.setDate(from.getDate() - 6);
  else if (r === "30d") from.setDate(from.getDate() - 29);
  else if (r === "90d") from.setDate(from.getDate() - 89);
  else from.setDate(1);
  return { from, to };
}

type Payment = {
  id: string;
  total: number | null;
  amount: number | null;
  method: string | null;
  service_name: string | null;
  employee_id: string | null;
  created_at: string;
};
type Expense = { id: string; amount: number | null; date: string };

function ReportsPage() {
  const { businessId } = useAuth();
  const [range, setRange] = React.useState<Range>("30d");
  const [loading, setLoading] = React.useState(true);
  const [payments, setPayments] = React.useState<Payment[]>([]);
  const [expenses, setExpenses] = React.useState<Expense[]>([]);
  const [employeesMap, setEmployeesMap] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { from, to } = getRange(range);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    const dFrom = from.toISOString().slice(0, 10);
    const dTo = to.toISOString().slice(0, 10);

    Promise.allSettled([
      supabase
        .from("payments")
        .select("id,total,amount,method,service_name,employee_id,created_at")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false }),
      supabase
        .from("expenses")
        .select("id,amount,date")
        .eq("business_id", businessId)
        .gte("date", dFrom)
        .lte("date", dTo),
      supabase
        .from("employees")
        .select("id,name")
        .eq("business_id", businessId),
    ]).then(([pr, er, emp]) => {
      const pData = pr.status === "fulfilled" && !pr.value.error ? (pr.value.data as Payment[]) ?? [] : [];
      const eData = er.status === "fulfilled" && !er.value.error ? (er.value.data as Expense[]) ?? [] : [];
      const empData = emp.status === "fulfilled" && !emp.value.error ? (emp.value.data as { id: string; name: string }[]) ?? [] : [];
      setPayments(pData);
      setExpenses(eData);
      setEmployeesMap(Object.fromEntries(empData.map((e) => [e.id, e.name])));
      setLoading(false);
    });
  }, [businessId, range]);

  const facturacion = payments.reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
  const totalGastos = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const neto = facturacion - totalGastos;
  const cobros = payments.length;
  const ticket = cobros > 0 ? Math.round(facturacion / cobros) : 0;

  const byMethod = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of payments) {
      const k = p.method ?? "otros";
      m[k] = (m[k] ?? 0) + Number(p.total ?? p.amount ?? 0);
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [payments]);

  const byService = React.useMemo(() => {
    const m: Record<string, { total: number; count: number }> = {};
    for (const p of payments) {
      const k = p.service_name ?? "Sin nombre";
      if (!m[k]) m[k] = { total: 0, count: 0 };
      m[k].total += Number(p.total ?? p.amount ?? 0);
      m[k].count += 1;
    }
    return Object.entries(m)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 8);
  }, [payments]);

  const byEmployee = React.useMemo(() => {
    const m: Record<string, { total: number; count: number }> = {};
    for (const p of payments) {
      const k = p.employee_id ?? "—";
      if (!m[k]) m[k] = { total: 0, count: 0 };
      m[k].total += Number(p.total ?? p.amount ?? 0);
      m[k].count += 1;
    }
    return Object.entries(m).sort((a, b) => b[1].total - a[1].total);
  }, [payments]);

  const maxMethod = Math.max(1, ...byMethod.map((m) => m[1]));
  const maxService = Math.max(1, ...byService.map((s) => s[1].total));

  return (
    <AppShell>
      <Topbar title="Informes" subtitle="Métricas reales del negocio" />
      <div className="animate-fade-up space-y-6">
        {/* Range selector */}
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                "h-9 px-3.5 rounded-xl text-xs font-medium transition-all",
                range === r.key
                  ? "bg-gradient-primary text-primary-foreground shadow-[0_8px_22px_-10px_oklch(0.6_0.28_290/0.65)]"
                  : "glass glass-hover text-muted-foreground"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="glass rounded-2xl p-16 grid place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Facturación" value={`$${facturacion.toLocaleString("es-AR")}`} accent />
              <KpiCard icon={<Receipt className="h-4 w-4" />} label="Gastos" value={`$${totalGastos.toLocaleString("es-AR")}`} />
              <KpiCard icon={<Wallet className="h-4 w-4" />} label="Neto" value={`$${neto.toLocaleString("es-AR")}`} positive={neto >= 0} />
              <KpiCard icon={<BarChart3 className="h-4 w-4" />} label="Ticket promedio" value={`$${ticket.toLocaleString("es-AR")}`} hint={`${cobros} cobros`} />
            </div>

            {/* By method + by service */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel title="Por método de pago">
                {byMethod.length === 0 ? (
                  <EmptyState text="Sin cobros en el rango." />
                ) : (
                  <div className="space-y-3">
                    {byMethod.map(([k, v]) => (
                      <div key={k}>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-muted-foreground">{PAY_LABELS[k] ?? k}</span>
                          <span className="text-foreground font-medium">
                            ${v.toLocaleString("es-AR")}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
                          <div
                            className="h-full bg-gradient-primary"
                            style={{ width: `${(v / maxMethod) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Top servicios">
                {byService.length === 0 ? (
                  <EmptyState text="Sin cobros en el rango." />
                ) : (
                  <div className="space-y-3">
                    {byService.map(([k, v]) => (
                      <div key={k}>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-muted-foreground truncate pr-2">{k}</span>
                          <span className="text-foreground font-medium whitespace-nowrap">
                            ${v.total.toLocaleString("es-AR")} · {v.count}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
                          <div
                            className="h-full"
                            style={{
                              width: `${(v.total / maxService) * 100}%`,
                              background:
                                "linear-gradient(90deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))",
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>

            {/* By employee */}
            <Panel title="Producción por profesional" icon={<Users className="h-4 w-4 text-muted-foreground" />}>
              {byEmployee.length === 0 ? (
                <EmptyState text="Sin movimientos por profesional." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b border-white/[0.06]">
                        <th className="text-left py-2 font-medium">Profesional</th>
                        <th className="text-right py-2 font-medium">Cobros</th>
                        <th className="text-right py-2 font-medium">Facturación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byEmployee.map(([id, v]) => (
                        <tr key={id} className="border-b border-white/[0.04] last:border-0">
                          <td className="py-3">{employeesMap[id] ?? "Sin asignar"}</td>
                          <td className="py-3 text-right text-muted-foreground">{v.count}</td>
                          <td className="py-3 text-right font-medium">
                            ${v.total.toLocaleString("es-AR")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        )}
      </div>
    </AppShell>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  accent,
  positive,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  positive?: boolean;
}) {
  return (
    <div className="glass glass-hover rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div
          className={cn(
            "h-9 w-9 rounded-xl grid place-items-center",
            accent ? "bg-gradient-primary text-primary-foreground" : "bg-white/[0.04] text-muted-foreground"
          )}
        >
          {icon}
        </div>
      </div>
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div
        className={cn(
          "font-display text-2xl font-semibold mt-1",
          positive === false && "text-destructive"
        )}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function Panel({
  title,
  children,
  icon,
}: {
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-xs text-muted-foreground text-center py-8">{text}</div>
  );
}
