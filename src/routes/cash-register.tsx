import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  Lock,
  Unlock,
} from "lucide-react";

export const Route = createFileRoute("/cash-register")({
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
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const data = useCajaData();
  const [tab, setTab] = useState<Tab>("resumen");

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
        {tab === "resumen" && <ResumenTab data={data} />}
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

function Header({ data }: { data: ReturnType<typeof useCajaData> }) {
  const cashSessionId = data.cashSessionId;
  const open = Boolean(cashSessionId);
  const [busy, setBusy] = useState(false);

  async function handleOpen() {
    if (!data.businessId || !data.profileId) {
      toast.error("Falta identificar negocio o usuario.");
      return;
    }
    setBusy(true);
    try {
      await openCashSession({ businessId: data.businessId, openedBy: data.profileId });
      toast.success("Caja abierta");
      await data.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    if (!cashSessionId || !data.profileId) return;
    if (!confirm("¿Cerrar la caja del día?")) return;
    setBusy(true);
    try {
      await closeCashSession({
        sessionId: cashSessionId,
        closedBy: data.profileId,
        total: data.revHoy,
      });
      toast.success("Caja cerrada");
      await data.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 className="font-display text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
          Caja & Cobro
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Resumen del día, ventas, precios e inventario en un solo lugar.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
            open
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
              : "border-white/15 bg-white/[0.04] text-muted-foreground"
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              open ? "bg-emerald-400 shadow-[0_0_10px] shadow-emerald-400/70" : "bg-muted-foreground/60"
            )}
          />
          {open ? "Caja abierta" : "Caja sin abrir"}
        </span>
        {open ? (
          <button
            onClick={handleClose}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 text-amber-200 px-3 py-1.5 text-xs font-medium hover:bg-amber-300/20 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}
            Cerrar caja
          </button>
        ) : (
          <button
            onClick={handleOpen}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 px-3 py-1.5 text-xs font-medium hover:bg-emerald-400/20 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Unlock className="size-3.5" />}
            Abrir caja
          </button>
        )}
      </div>
    </div>
  );
}


const TABS: { id: Tab; label: string }[] = [
  { id: "resumen", label: "Resumen del día" },
  { id: "precios", label: "Precios" },
  { id: "inventario", label: "Inventario" },
  { id: "gastos", label: "Gastos" },
  { id: "profesionales", label: "Profesionales" },
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
      <button
        onClick={() => onChange("nueva")}
        className={cn(
          "shrink-0 mb-2 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all",
          nuevaActive
            ? "bg-gradient-to-r from-amber-200 to-amber-400 text-black shadow-[0_8px_30px_-8px_oklch(0.78_0.17_65/0.7)] ring-1 ring-amber-300/60"
            : "bg-gradient-to-r from-amber-300/90 to-amber-500/90 text-black hover:brightness-110 shadow-[0_8px_24px_-10px_oklch(0.78_0.17_65/0.55)]"
        )}
      >
        <span className="text-base leading-none">＋</span> Nueva venta
      </button>
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
function ResumenTab({ data }: { data: ReturnType<typeof useCajaData> }) {
  // Proyección Día = revHoy / fracción del horario laboral transcurrido (8h-22h)
  const projection = useMemo(() => {
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    const startH = 8;
    const endH = 22;
    const frac = Math.max(0.05, Math.min(1, (h - startH) / (endH - startH)));
    return Math.round(data.revHoy / frac);
  }, [data.revHoy]);

  const utilidad = data.revHoy - data.totalGastos;

  const stats = [
    {
      label: "COBRADO HOY",
      value: data.revHoy,
      sub: `${data.cobros} cobro${data.cobros === 1 ? "" : "s"} hoy`,
      icon: Wallet,
      tint: "from-amber-400/20 to-amber-500/0",
    },
    {
      label: "GASTOS HOY",
      value: data.totalGastos,
      sub: `${data.expensesToday.length} registrado${data.expensesToday.length === 1 ? "" : "s"}`,
      icon: ArrowRight,
      tint: "from-rose-400/25 to-rose-500/0",
    },
    {
      label: "UTILIDAD",
      value: utilidad,
      sub: `$${data.revHoy.toLocaleString("es-AR")} − $${data.totalGastos.toLocaleString("es-AR")}`,
      icon: TrendingUp,
      tint: "from-emerald-400/25 to-emerald-500/0",
    },
    {
      label: "PENDIENTES",
      value: data.pendingAmount,
      sub: `${data.pendingCount} turno${data.pendingCount === 1 ? "" : "s"} sin cobrar`,
      icon: Clock,
      tint: "from-violet-400/25 to-violet-500/0",
    },
    {
      label: "TICKET PROMEDIO",
      value: data.ticket,
      sub: data.cobros === 0 ? "sin cobros" : `sobre ${data.cobros} cobros`,
      icon: BarChart3,
      tint: "from-cyan-400/25 to-cyan-500/0",
    },
    {
      label: "PROYECCIÓN DÍA",
      value: projection,
      sub: "estimado al cierre",
      icon: TrendingUp,
      tint: "from-sky-400/25 to-sky-500/0",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-5">
            <div
              className={cn(
                "pointer-events-none absolute -top-16 -right-10 size-40 rounded-full blur-3xl opacity-70 bg-gradient-to-br",
                s.tint
              )}
            />
            <div className="flex items-start justify-between relative">
              <div>
                <p className="text-[11px] tracking-[0.18em] text-muted-foreground/80 font-medium">
                  {s.label}
                </p>
                <div className="mt-3">
                  <Money value={s.value} large />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{s.sub}</p>
              </div>
              <div className="rounded-xl bg-white/[0.04] border border-white/5 p-2.5">
                <s.icon className="size-4 text-foreground/80" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <ApprovalMode data={data} />
      <History data={data} />
    </div>
  );
}

function ApprovalMode({ data }: { data: ReturnType<typeof useCajaData> }) {
  const mode = data.approvalMode;
  const desc: Record<typeof mode, string> = {
    auto: "Automático — el profesional cobra desde su panel y el cobro impacta sin confirmación.",
    manual: "Manual — el servicio queda pendiente y caja/recepción lo confirma y cobra.",
    disabled: "Desactivado — el profesional no puede cobrar desde su panel.",
  };
  const labelMap: Record<typeof mode, string> = {
    auto: "AUTOMÁTICO",
    manual: "MANUAL",
    disabled: "DESACTIVADO",
  };
  const chipCls: Record<typeof mode, string> = {
    auto: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    manual: "border-amber-300/30 bg-amber-300/10 text-amber-200",
    disabled: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  };
  const dotCls: Record<typeof mode, string> = {
    auto: "bg-emerald-400",
    manual: "bg-amber-300",
    disabled: "bg-rose-400",
  };
  const options: { id: typeof mode; label: string; icon: typeof Zap }[] = [
    { id: "auto", label: "Automático", icon: Zap },
    { id: "manual", label: "Manual", icon: Hand },
    { id: "disabled", label: "Desactivado", icon: Lock },
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
      <div className="mt-4 grid grid-cols-3 gap-2 p-1 rounded-xl bg-white/[0.03] border border-white/5">
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
              <o.icon
                className={cn(
                  "size-4",
                  o.id === "disabled" ? "text-rose-300" : "text-amber-300",
                )}
              />{" "}
              {o.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function History({ data }: { data: ReturnType<typeof useCajaData> }) {
  const rows = data.paymentsToday.slice(0, 10);
  return (
    <Card>
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
        <h3 className="text-base font-semibold text-foreground">Historial de cobros</h3>
        <span className="text-xs text-muted-foreground">
          {data.cobros} cobro{data.cobros === 1 ? "" : "s"} hoy
        </span>
      </div>
      <div className="grid grid-cols-[80px_1fr_1.4fr_120px_120px] px-5 py-3 text-[11px] tracking-[0.16em] text-muted-foreground/70 border-b border-white/5">
        <div>HORA</div>
        <div>CLIENTE</div>
        <div>SERVICIO</div>
        <div>PAGADO</div>
        <div>MÉTODO</div>
      </div>
      {data.loading ? (
        <div className="px-5 py-12 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
          <Loader2 className="size-4 animate-spin" /> Cargando…
        </div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-muted-foreground">Sin cobros hoy</div>
      ) : (
        rows.map((p) => {
          const hour = new Date(p.created_at).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          });
          const method = (p.method ?? "cash") as PayMethod;
          return (
            <div
              key={p.id}
              className="grid grid-cols-[80px_1fr_1.4fr_120px_120px] px-5 py-3 text-sm border-b border-white/5 last:border-0"
            >
              <div className="text-muted-foreground">{hour}</div>
              <div className="text-foreground">{p.client_name ?? "—"}</div>
              <div className="text-muted-foreground">{p.service_name ?? "—"}</div>
              <div className="text-foreground tabular-nums">
                ${Number(p.total ?? p.amount ?? 0).toLocaleString("es-AR")}
              </div>
              <div className="text-emerald-300 text-xs">
                {PAY_METHOD_LABEL[method] ?? method}
              </div>
            </div>
          );
        })
      )}
      <div className="px-5 py-3 border-t border-white/5 text-center">
        <button className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-2">
          <ClipboardList className="size-3.5" /> Ver historial completo
        </button>
      </div>
    </Card>
  );
}

// ───────────────────────────── NUEVA VENTA
function NuevaVentaTab({ data }: { data: ReturnType<typeof useCajaData> }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("Todos");
  const [clientId, setClientId] = useState<string | null>(null);
  const [client, setClient] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [employeeId, setEmployeeId] = useState<string>("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [paymentMode, setPaymentMode] = useState<"simple" | "multiple">("simple");
  const [received, setReceived] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const services = data.services;
  const categories = useMemo(() => {
    const list = Array.from(new Set(services.map((s) => s.category || "Otros"))).filter(Boolean);
    return ["Todos", ...list];
  }, [services]);

  const filtered = services.filter((i) => {
    const q = query.trim().toLowerCase();
    const matchesText = !q || `${i.name} ${i.category ?? ""}`.toLowerCase().includes(q);
    const matchesCategory = category === "Todos" || (i.category || "Otros") === category;
    return matchesText && matchesCategory;
  });

  const cartItems = Object.entries(cart)
    .map(([id, qty]) => {
      const svc = services.find((s) => s.id === id);
      return svc ? { svc, qty } : null;
    })
    .filter((x): x is { svc: Service; qty: number } => x !== null);

  const total = cartItems.reduce((acc, { svc, qty }) => acc + Number(svc.price) * qty, 0);
  const cartCount = cartItems.reduce((acc, { qty }) => acc + qty, 0);
  const receivedNumber = Number(received || 0);
  const change = method === "cash" && receivedNumber > total ? receivedNumber - total : 0;
  const selectedEmployee = data.employees.find((e) => e.id === employeeId);

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  const sub = (id: string) =>
    setCart((c) => {
      const n = (c[id] ?? 0) - 1;
      const { [id]: _, ...rest } = c;
      return n <= 0 ? rest : { ...c, [id]: n };
    });

  function goNext() {
    if (step === 1 && !employeeId) {
      toast.error("Seleccioná un profesional.");
      return;
    }
    if (step === 2 && !client.trim()) {
      toast.error("Completá o seleccioná un cliente.");
      return;
    }
    if (step === 3 && cartItems.length === 0) {
      toast.error("Agregá al menos un servicio o producto.");
      return;
    }
    setStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  }

  async function saveClientIfNeeded() {
    if (!data.businessId || clientId || !client.trim()) return;
    try {
      const { data: created, error } = await supabase
        .from("clients")
        .insert({
          business_id: data.businessId,
          name: client.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          birth_date: birthDate || null,
        })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (created?.id) setClientId(created.id);
    } catch (e) {
      console.warn("[cash-register] no se pudo guardar cliente nuevo", e);
    }
  }

  async function handleCobrar() {
    if (!data.businessId) {
      toast.error("No se pudo identificar el negocio.");
      return;
    }
    if (!employeeId) {
      toast.error("Seleccioná un profesional.");
      setStep(1);
      return;
    }
    if (cartItems.length === 0) {
      toast.error("Agregá al menos un servicio.");
      setStep(3);
      return;
    }
    setSubmitting(true);
    try {
      await saveClientIfNeeded();
      const items = cartItems.flatMap(({ svc, qty }) =>
        Array.from({ length: qty }, () => ({
          serviceName: svc.name,
          amount: Number(svc.price),
        }))
      );

      await registerPayment({
        businessId: data.businessId,
        employeeId: employeeId || null,
        clientName: client.trim() || "Cliente del mostrador",
        items,
        method,
        sessionId: data.cashSessionId,
        chargedBy: data.profileId,
      });

      toast.success(`Cobro confirmado · $${total.toLocaleString("es-AR")}`);
      setCart({});
      setClientId(null);
      setClient("");
      setPhone("");
      setEmail("");
      setBirthDate("");
      setReceived("");
      setStep(1);
      await data.refresh();
    } catch (e) {
      toast.error((e as Error).message || "Error al guardar el cobro");
    } finally {
      setSubmitting(false);
    }
  }

  const stepItems = [
    { n: 1, label: "Profesional" },
    { n: 2, label: "Cliente" },
    { n: 3, label: "Servicios" },
    { n: 4, label: "Pago" },
  ] as const;

  return (
    <div className="space-y-5">
      <Card className="p-1.5">
        <div className="grid grid-cols-4 gap-1">
          {stepItems.map((s) => {
            const active = step === s.n;
            return (
              <button
                key={s.n}
                onClick={() => setStep(s.n)}
                className={cn(
                  "rounded-xl px-3 py-2.5 text-xs font-semibold transition-all border",
                  active
                    ? "bg-gradient-to-b from-amber-200 to-amber-300 text-black border-amber-200"
                    : "text-muted-foreground border-white/10 bg-white/[0.02] hover:text-foreground"
                )}
              >
                {s.n} · {s.label}
              </button>
            );
          })}
        </div>
      </Card>

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Seleccioná un profesional</p>
          {data.employees.map((e) => {
            const active = employeeId === e.id;
            const name = e.name;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setEmployeeId(e.id)}
                className={cn(
                  "w-full rounded-xl border px-4 py-3 flex items-center gap-3 text-left transition-all",
                  active
                    ? "border-amber-300/50 bg-amber-300/10"
                    : "border-white/10 bg-white/[0.025] hover:bg-white/[0.04]"
                )}
              >
                <span className="size-9 rounded-full bg-gradient-to-br from-amber-200/80 to-amber-500/80 text-black font-semibold grid place-items-center">
                  {(name || "P").slice(0, 1).toUpperCase()}
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-foreground">{name}</span>
                  <span className="block text-xs text-muted-foreground">Profesional</span>
                </span>
                {active ? <Check className="size-4 text-amber-200" /> : <ArrowRight className="size-4 text-muted-foreground" />}
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && (
        <Card className="p-5 space-y-4">
          <ClientAutocomplete
            value={client}
            onChange={(v) => {
              setClient(v);
              setClientId(null);
            }}
            onPick={(c) => {
              setClientId(c.id);
              setClient(c.name ?? "");
              setPhone(c.phone ?? "");
              setEmail(c.email ?? "");
              setBirthDate(c.birth_date ?? "");
            }}
            clients={data.clients}
          />
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
            <span className="h-px flex-1 bg-white/10" />
            o completá los datos para crear uno nuevo
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <div className="space-y-3">
            <input
              value={client}
              onChange={(e) => {
                setClient(e.target.value);
                setClientId(null);
              }}
              placeholder="Nombre *"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-amber-300/40"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Teléfono"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-amber-300/40"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-amber-300/40"
            />
            <input
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              type="date"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-amber-300/40"
            />
          </div>
        </Card>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <Card className="px-4 py-3 flex items-center gap-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar servicio o producto..."
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
            />
          </Card>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs whitespace-nowrap transition-colors capitalize",
                  category === c
                    ? "border-amber-300/50 bg-amber-300/10 text-amber-200"
                    : "border-white/10 bg-white/[0.025] text-muted-foreground hover:text-foreground"
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.loading ? (
              <Card className="px-4 py-12 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
                <Loader2 className="size-4 animate-spin inline mr-2" /> Cargando servicios…
              </Card>
            ) : filtered.length === 0 ? (
              <Card className="px-4 py-12 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
                Sin servicios o productos.
              </Card>
            ) : (
              filtered.map((it) => {
                const qty = cart[it.id] ?? 0;
                return (
                  <Card key={it.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{it.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {it.category ?? "ítem"}{it.duration ? ` · ${it.duration} min` : ""}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-foreground tabular-nums">
                        ${Number(it.price).toLocaleString("es-AR")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      {typeof it.stock === "number" && it.category !== "servicios" ? (
                        <span className="text-[11px] text-muted-foreground">Stock {it.stock}</span>
                      ) : <span />}
                      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
                        <button onClick={() => sub(it.id)} className="size-8 grid place-items-center rounded-md hover:bg-white/5 text-muted-foreground hover:text-foreground">
                          <Minus className="size-3.5" />
                        </button>
                        <span className="w-8 text-center text-sm tabular-nums">{qty}</span>
                        <button onClick={() => add(it.id)} className="size-8 grid place-items-center rounded-md hover:bg-white/5 text-foreground">
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </Card>
                );
              })
            )}
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
          </div>
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-white/[0.03] border border-white/5">
            <button onClick={() => setPaymentMode("simple")} className={cn("rounded-lg py-2.5 text-sm font-semibold", paymentMode === "simple" ? "bg-amber-200 text-black" : "text-muted-foreground hover:text-foreground")}>Pago simple</button>
            <button onClick={() => setPaymentMode("multiple")} className={cn("rounded-lg py-2.5 text-sm font-semibold", paymentMode === "multiple" ? "bg-amber-200 text-black" : "text-muted-foreground hover:text-foreground")}>Pago múltiple</button>
          </div>
          <div>
            <p className="text-[11px] tracking-[0.18em] text-muted-foreground/70 mb-3">MÉTODO DE PAGO</p>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {([
                { id: "cash", label: "Efectivo", icon: Banknote },
                { id: "transfer", label: "Transferencia", icon: Smartphone },
                { id: "card", label: "Débito / Crédito", icon: CreditCard },
                { id: "mp", label: "Mercado Pago", icon: Wallet },
                { id: "qr", label: "QR", icon: Smartphone },
              ] as const).map((m) => {
                const active = method === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-xl border p-4 transition-all",
                      active
                        ? "border-amber-300/50 bg-amber-300/10 text-foreground"
                        : "border-white/10 bg-white/[0.02] text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <m.icon className="size-5" /> <span className="text-sm font-medium">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {method === "cash" && (
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">¿Con cuánto paga?</label>
              <input
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                inputMode="numeric"
                placeholder="Monto entregado"
                className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-amber-300/40"
              />
              {receivedNumber > 0 && (
                <p className="text-sm text-muted-foreground">
                  Entregado: ${receivedNumber.toLocaleString("es-AR")} {change > 0 && <span className="text-emerald-300">| Vuelto: ${change.toLocaleString("es-AR")}</span>}
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      <div className="sticky bottom-4 z-10">
        <Card className="px-4 py-3 flex items-center gap-4">
          <button
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s))}
            disabled={step === 1}
            className="rounded-xl px-5 py-3 text-sm font-medium border border-white/10 text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            ← Volver
          </button>
          <div className="flex-1 min-w-0 text-right sm:text-left">
            <p className="text-[11px] tracking-[0.16em] text-muted-foreground/70">TOTAL</p>
            <p className="text-sm text-foreground">
              {cartCount} item{cartCount === 1 ? "" : "s"} · {selectedEmployee?.name ?? "Sin profesional"}
            </p>
          </div>
          <Money value={total} />
          {step < 4 ? (
            <button
              onClick={goNext}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-zinc-950 bg-gradient-to-b from-amber-200 to-amber-400 hover:from-amber-100 hover:to-amber-300 disabled:opacity-40 transition-all"
            >
              Continuar <ArrowRight className="size-4" />
            </button>
          ) : (
            <button
              disabled={cartCount === 0 || submitting}
              onClick={handleCobrar}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-zinc-950 bg-gradient-to-b from-amber-200 to-amber-400 hover:from-amber-100 hover:to-amber-300 disabled:opacity-40 transition-all"
            >
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
