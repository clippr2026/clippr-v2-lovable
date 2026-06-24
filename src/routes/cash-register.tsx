import React from 'react';
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useCajaData, searchClientsLite, type Service, type ClientLiteResult } from "@/components/cash-register/use-caja-data";
import {
  PAY_METHOD_LABEL,
  registerPayment,
  type PayMethod,
} from "@/components/cash-register/register-payment";
import {
  openCashSession,
  closeCashSession,
  reopenCashSession,
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
import { useClientesConfig } from "@/hooks/use-clientes-config";

const MANUAL_PENDING_KEY = "clippr_pending_manual_charges";
const HISTORIAL_KEY = "clippr_cobros_historial_v2";

type HistorialEvento = {
  time: string;
  user: string;
  action: string;
};

function appendHistorialCobro(appointmentId: string, evento: HistorialEvento) {
  if (typeof window === "undefined") return;
  try {
    const all = JSON.parse(window.localStorage.getItem(HISTORIAL_KEY) || "{}") as Record<string, HistorialEvento[]>;
    const prev = all[appointmentId] ?? [];
    if (!prev.some((e) => e.time === evento.time && e.user === evento.user && e.action === evento.action)) {
      all[appointmentId] = [...prev, evento];
      window.localStorage.setItem(HISTORIAL_KEY, JSON.stringify(all));
      window.dispatchEvent(new CustomEvent("clippr:cobros-historial-updated"));
    }
  } catch {
    // ignore
  }
}

function getHistorialCobro(appointmentId?: string | null): HistorialEvento[] {
  if (typeof window === "undefined" || !appointmentId) return [];
  try {
    const all = JSON.parse(window.localStorage.getItem(HISTORIAL_KEY) || "{}") as Record<string, HistorialEvento[]>;
    return all[appointmentId] ?? [];
  } catch {
    return [];
  }
}


function normalizeHistorialEventKey(event: HistorialEvento) {
  return `${event.time}__${event.user}__${event.action}`;
}

function uniqueHistorialEvents(events: HistorialEvento[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = normalizeHistorialEventKey(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getHistorialCobroByIds(ids: Array<unknown>): HistorialEvento[] {
  const normalizedIds = Array.from(
    new Set(
      ids
        .map((id) => (id === null || id === undefined ? "" : String(id).trim()))
        .filter(Boolean)
    )
  );

  return uniqueHistorialEvents(normalizedIds.flatMap((id) => getHistorialCobro(id)));
}

function buildPaidHistorialEvents(
  payment: Record<string, unknown>,
  fallbackCobroEvent: HistorialEvento,
): HistorialEvento[] {
  const savedEvents = getHistorialCobroByIds([
    payment.appointment_id,
    payment.appointmentId,
    payment.appointment,
    payment.pending_charge_id,
    payment.pendingChargeId,
    payment.sale_id,
    payment.saleId,
    payment.id,
  ]);

  if (savedEvents.length === 0) return [fallbackCobroEvent];

  const alreadyHasCobro = savedEvents.some((event) => event.action === "Cobró");

  // Si el servicio fue enviado a Caja y el pago ya existe, el historial debe conservar
  // "Envió a caja" y sumar "Cobró". Nunca se compacta a una sola línea.
  if (!alreadyHasCobro) {
    return uniqueHistorialEvents([...savedEvents, fallbackCobroEvent]);
  }

  return savedEvents;
}

function HistorialCell({ events }: { events: HistorialEvento[] }) {
  if (events.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="space-y-1 leading-tight">
      {events.map((event, index) => (
        <div key={`${event.time}-${event.user}-${event.action}-${index}`} className="whitespace-nowrap">
          <span className="text-muted-foreground">{event.time}</span>{" "}
          <span className="font-semibold text-foreground/90">{event.user}</span>{" "}
          <span className="text-muted-foreground">→</span>{" "}
          <span className={cn(event.action === "Cobró" ? "text-emerald-300" : "text-sky-300")}>
            {event.action}
          </span>
        </div>
      ))}
    </div>
  );
}

function removeLocalManualPendingCharge(id: string) {
  if (typeof window === "undefined") return;
  try {
    const rows = JSON.parse(window.localStorage.getItem(MANUAL_PENDING_KEY) || "[]") as Array<{ id: string }>;
    window.localStorage.setItem(MANUAL_PENDING_KEY, JSON.stringify(rows.filter((item) => item.id !== id)));
    window.dispatchEvent(new CustomEvent("clippr:manual-pending-updated"));
  } catch {
    // ignore
  }
}

function getManualPendingNote(notes?: string | null) {
  const value = String(notes ?? "")
    .replace("[PENDIENTE_CAJA]", "")
    .trim();

  const lower = value.toLowerCase();
  const genericServices = ["corte", "barba", "corte + barba", "corte de pelo"];

  if (!value || genericServices.includes(lower)) return "";

  return value;
}

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
      { title: "Caja — Clippr" },
      { name: "description", content: "Cobros, gastos y liquidaciones." },
    ],
  }),
  component: CashRegisterPage,
});

type Tab = "resumen" | "nueva" | "nuevo-gasto" | "precios" | "inventario" | "gastos" | "profesionales" | "cierres";

function CashRegisterPage() {
  const { session, loading: authLoading, permissions } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ from: "/cash-register" });
  const data = useCajaData();
  const [tab, setTab] = useState<Tab>(
    search.depositAppointmentId || search.appointmentId ? "nueva" : "resumen"
  );
  const [pendingToCharge, setPendingToCharge] = useState<ReturnType<typeof useCajaData>["pendingCharges"][number] | null>(null);

  const routePendingCharge = React.useMemo<ReturnType<typeof useCajaData>["pendingCharges"][number] | null>(() => {
    if (!search.appointmentId) return null;

    const totalFromSearch = Number(search.finalAmount ?? search.totalPrice ?? 0);
    return {
      id: search.appointmentId,
      client_name: search.clientName ?? null,
      service_name: search.serviceName ?? null,
      service_price: Number.isFinite(totalFromSearch) && totalFromSearch > 0 ? totalFromSearch : null,
      employee_id: search.employeeId ?? null,
      starts_at: new Date().toISOString(),
      notes: null,
      status: "confirmed",
    };
  }, [search.appointmentId, search.clientName, search.serviceName, search.finalAmount, search.totalPrice, search.employeeId]);

  const activePendingCharge = pendingToCharge ?? routePendingCharge;

  // Instant lock — set to true the moment confirmar() succeeds, no need to wait for refresh
  const [cajaCerrada, setCajaCerrada] = useState(false);
  const [showClosedHistory, setShowClosedHistory] = useState(false);
  const [resumenPanel, setResumenPanel] = useState<"ingresos" | "pendientes" | "gastos">("ingresos");
  const [reopeningCaja, setReopeningCaja] = useState(false);

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

  function handleCobrarPendiente(appt: ReturnType<typeof useCajaData>["pendingCharges"][number]) {
    setPendingToCharge(appt);
    setTab("nueva");
  }

  async function handleReabrirCajaDesdeBanner() {
    if (reopeningCaja) return;

    if (!data.businessId || !session?.user?.id) {
      setCajaCerrada(false);
      data.refresh();
      return;
    }

    setReopeningCaja(true);

    try {
      const { data: lastCierre, error } = await supabase
        .from("caja_cierres" as any)
        .select("id,eventos,estado")
        .eq("business_id", data.businessId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!lastCierre?.id) {
        setCajaCerrada(false);
        await data.refresh();
        return;
      }

      if (isCajaReabiertaRow(lastCierre)) {
        toast.info("La caja ya está abierta");
        setCajaCerrada(false);
        setShowClosedHistory(false);
        await data.refresh();
        return;
      }

      if (!isCajaCerradaRow(lastCierre)) {
        toast.info("La caja no está cerrada");
        setCajaCerrada(false);
        setShowClosedHistory(false);
        await data.refresh();
        return;
      }

      const now = new Date();
      const user = session.user.email ?? session.user.id;
      const evento = {
        tipo: "reapertura",
        fecha_hora: now.toISOString(),
        hora: now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
        usuario: user,
        motivo: null,
      };

      const { data: updated, error: updateError } = await supabase
        .from("caja_cierres" as any)
        .update({
          estado: "reabierta",
          reopened_at: now.toISOString(),
          reopened_by: user,
          eventos: appendCajaEvento((lastCierre as any).eventos, evento),
          updated_at: now.toISOString(),
        })
        .eq("id", (lastCierre as any).id)
        .eq("business_id", data.businessId)
        .eq("estado", "cerrada")
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;

      if (!updated?.id) {
        toast.info("La caja ya estaba abierta");
        setCajaCerrada(false);
        setShowClosedHistory(false);
        await data.refresh();
        return;
      }

      await reopenCashSession({
        sessionId: data.cajaSession?.sessionId ?? (lastCierre as any).id,
        businessId: data.businessId,
        reopenedBy: user,
      });

      toast.success("Caja reabierta");
      window.dispatchEvent(new CustomEvent("clippr:caja-cierre-guardado"));
    } catch (e: any) {
      console.warn(e);
      toast.error(e?.message ?? "No se pudo registrar la reapertura");
    } finally {
      setReopeningCaja(false);
      setCajaCerrada(false);
      setShowClosedHistory(false);
      await data.refresh();
    }
  }

  if (authLoading || !session) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" /> Cargando…
        </div>
      </AppShell>
    );
  }

  // ── GATE: caja cerrada ────────────────────────────────────────────────────
  if (cajaCerrada) {
    return (
      <AppShell>
        <div className="cash-premium-shell">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `
            radial-gradient(circle at 20% 12%, rgba(139,92,246,0.22) 0%, transparent 35%),
            radial-gradient(circle at 78% 8%, rgba(79,125,255,0.18) 0%, transparent 35%),
            radial-gradient(circle at 50% 70%, rgba(255,123,229,0.08) 0%, transparent 50%)
          `,
          filter: "blur(80px)"
        }}
      />

      <div className="pointer-events-none absolute left-1/2 top-[-120px] z-[-1] h-[620px] w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_17%_4%,rgb(139_92_246_/_0.28),transparent_40%),radial-gradient(circle_at_76%_0%,rgb(79_125_255_/_0.25),transparent_38%),radial-gradient(circle_at_46%_96%,rgb(255_123_229_/_0.11),transparent_52%)] blur-[16px]" />
<div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h1 className="font-display text-3xl md:text-4xl font-semibold tracking-tight text-foreground">Caja</h1>
              <p className="mt-2 text-sm md:text-base text-muted-foreground">Cobros, gastos y liquidaciones</p>
            </div>
          </div>
          <div className="mt-8 space-y-4">
          {/* Estado banner */}
          <div className="rounded-2xl border border-white/[0.085] bg-white/[0.028] cash-panel-glow backdrop-blur-xl px-6 py-6 flex items-center gap-5">
            <div className="h-14 w-14 rounded-2xl bg-rose-500/10 border border-rose-400/20 grid place-items-center shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-rose-300"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold text-foreground">Caja cerrada</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">La caja de hoy ya fue cerrada. Podés reabrirla hasta las 00:00.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShowClosedHistory((v) => !v)}
                className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold bg-white/[0.045] border border-white/10 hover:bg-white/[0.09] transition-all text-foreground"
              >
                {showClosedHistory ? "Ocultar historial" : "Ver cierre / historial"}
              </button>
              <button
                onClick={handleReabrirCajaDesdeBanner}
                disabled={reopeningCaja}
                className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold bg-white/[0.07] border border-white/10 hover:bg-white/[0.12] transition-all text-foreground disabled:opacity-50"
              >
                {reopeningCaja ? "Reabriendo…" : "Reabrir caja"}
              </button>
            </div>
          </div>
          {showClosedHistory && (
            <div className="mt-5">
              <CierresTab
                businessId={data.businessId}
                cajaCerrada={cajaCerrada}
                onCajaReopened={() => {
                  setCajaCerrada(false);
                  setShowClosedHistory(false);
                  data.refresh();
                }}
              />
            </div>
          )}
          </div>
        </div>
      </AppShell>
    );
  }

  // ── CAJA ABIERTA ──────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="cash-premium-shell">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `
            radial-gradient(circle at 20% 12%, rgba(139,92,246,0.22) 0%, transparent 35%),
            radial-gradient(circle at 78% 8%, rgba(79,125,255,0.18) 0%, transparent 35%),
            radial-gradient(circle at 50% 70%, rgba(255,123,229,0.08) 0%, transparent 50%)
          `,
          filter: "blur(80px)"
        }}
      />

      <div className="pointer-events-none absolute left-1/2 top-[-120px] z-[-1] h-[620px] w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_17%_4%,rgb(139_92_246_/_0.28),transparent_40%),radial-gradient(circle_at_76%_0%,rgb(79_125_255_/_0.25),transparent_38%),radial-gradient(circle_at_46%_96%,rgb(255_123_229_/_0.11),transparent_52%)] blur-[16px]" />

      <Header data={data} />
      <Tabs
        tab={tab}
        onChange={(t) => { if (t !== "nueva") setPendingToCharge(null); setTab(t); }}
        data={data}
        userEmail={session.user.email ?? null}
        onNuevoGasto={() => { setPendingToCharge(null); setTab("nuevo-gasto"); }}
        onCajaCerrada={() => { setCajaCerrada(true); setShowClosedHistory(false); setPendingToCharge(null); setResumenPanel("ingresos"); setTab("resumen"); }}
      />
      <div className="mt-6">
        {tab === "resumen" && (
          <ResumenTab
            data={data}
            equipoEnabled={permissions.equipo}
            initialPanel={resumenPanel}
            onCobrarPendiente={handleCobrarPendiente}
          />
        )}
        {tab === "nuevo-gasto" && (
          <NuevoGastoTab
            data={data}
            userEmail={session.user.email ?? null}
            onCancel={() => setTab("resumen")}
            onSaved={() => { setResumenPanel("gastos"); data.refresh(); setTab("resumen"); }}
          />
        )}
        {tab === "nueva" && (
          <NuevaVentaTab
            data={data}
            pendingCharge={activePendingCharge}
            onPendingDone={() => { setPendingToCharge(null); setTab("resumen"); }}
            onSaleDone={() => { setPendingToCharge(null); setResumenPanel("ingresos"); setTab("resumen"); }}
          />
        )}
        {tab === "precios" && <PreciosTab businessId={data.businessId} />}
        {tab === "inventario" && (
          <InventarioTab businessId={data.businessId} userEmail={session.user.email ?? null} />
        )}
        {tab === "gastos" && <GastosTab businessId={data.businessId} />}
        {tab === "profesionales" && (
          <ProfesionalesTab businessId={data.businessId} userEmail={session.user.email ?? null} />
        )}
        {tab === "cierres" && (
          <CierresTab
            businessId={data.businessId}
            cajaCerrada={cajaCerrada}
            onCajaReopened={() => { setCajaCerrada(false); data.refresh(); }}
          />
        )}
      </div>
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
        <p className="mt-2 text-sm md:text-base text-muted-foreground">
          Cobros, gastos y liquidaciones
        </p>
      </div>
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: "resumen",       label: "Resumen"          },
  { id: "precios",       label: "Precios"           },
  { id: "inventario",    label: "Inventario"        },
  { id: "profesionales", label: "Liquidaciones"     },
  { id: "cierres",       label: "Cierres de caja"   },
];

function Tabs({
  tab,
  onChange,
  data,
  userEmail,
  onNuevoGasto,
  onCajaCerrada,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  data: ReturnType<typeof useCajaData>;
  userEmail: string | null;
  onNuevoGasto: () => void;
  onCajaCerrada: () => void;
}) {
  const nuevaActive = tab === "nueva";
  return (
    <div className="mt-9 flex flex-wrap items-end justify-between gap-5 border-b border-white/[0.045] pb-5">
      <div className="flex min-w-0 flex-1 overflow-x-auto rounded-[22px] border border-white/[0.07] bg-[#151820]/95 p-1.5 shadow-[0_18px_55px_rgba(0,0,0,0.42),0_1px_0_rgba(255,255,255,0.04)_inset] backdrop-blur-xl sm:flex-none">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={cn(
                "relative rounded-2xl px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-all duration-200",
                active
                  ? "bg-[#252A38] text-white ring-1 ring-violet-400/25 shadow-[0_10px_28px_rgba(0,0,0,0.32),0_1px_0_rgba(255,255,255,0.08)_inset]"
                  : "text-white/58 hover:bg-white/[0.045] hover:text-white/88"
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {tab === "resumen" && (
        <div className="mb-3 flex w-full flex-wrap items-center justify-end gap-3 sm:w-auto sm:shrink-0 sm:flex-nowrap">
          <button
            onClick={onNuevoGasto}
            className="group inline-flex flex-1 sm:flex-none justify-center items-center gap-2.5 rounded-2xl px-5 py-3 text-sm font-bold transition-all duration-200 bg-gradient-to-b from-orange-400/95 via-orange-500/90 to-amber-700/90 text-white border border-orange-300/35 shadow-[0_0_28px_rgba(249,115,22,0.20),0_1px_0_rgba(255,255,255,0.18)_inset] hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_0_34px_rgba(249,115,22,0.30)]"
          >
            <Wallet className="size-4 transition-transform group-hover:scale-110" />
            Nuevo gasto
          </button>
          <button
            onClick={() => onChange("nueva")}
            className={cn(
              "group inline-flex flex-1 sm:flex-none justify-center items-center gap-3 rounded-2xl px-7 py-3 text-base font-bold transition-all duration-200 border",
              nuevaActive
                ? "bg-gradient-to-r from-blue-500 via-violet-500 to-purple-600 text-white border-violet-300/55 shadow-[0_0_40px_rgba(139,92,246,0.42),0_1px_0_rgba(255,255,255,0.20)_inset]"
                : "bg-gradient-to-r from-blue-500 via-violet-500 to-purple-600 text-white border-violet-300/35 shadow-[0_0_34px_rgba(99,102,241,0.32),0_1px_0_rgba(255,255,255,0.18)_inset] hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_0_42px_rgba(139,92,246,0.45)]"
            )}
          >
            <Plus className="size-5 transition-transform group-hover:rotate-90" />
            Nueva venta
          </button>
          <CierreCajaBtn
            paymentsToday={data.paymentsToday}
            expensesToday={data.expensesToday}
            businessId={data.businessId}
            userEmail={userEmail}
            onCajaCerrada={onCajaCerrada}
          />
        </div>
      )}
    </div>
  );
}


function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { className?: string; children: React.ReactNode }) {
  return (
    <div
      {...props}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/[0.085] bg-white/[0.028] cash-card-glow",
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
function ResumenTab({
  data,
  equipoEnabled,
  initialPanel = "ingresos",
  onCobrarPendiente,
}: {
  data: ReturnType<typeof useCajaData>;
  equipoEnabled: boolean;
  initialPanel?: "ingresos" | "pendientes" | "gastos";
  onCobrarPendiente: (appt: ReturnType<typeof useCajaData>["pendingCharges"][number]) => void;
}) {
  type ActivePanel = "ingresos" | "pendientes" | "gastos";
  const [activePanel, setActivePanel] = React.useState<ActivePanel>(initialPanel);

  React.useEffect(() => {
    setActivePanel(initialPanel);
  }, [initialPanel]);

  React.useEffect(() => {
    const handler = () => { data.refresh(); setActivePanel("gastos"); };
    window.addEventListener("clippr:gasto-guardado", handler);
    return () => window.removeEventListener("clippr:gasto-guardado", handler);
  }, [data]);

  const stats: {
    id: ActivePanel;
    label: string;
    value: number;
    sub: string;
    icon: any;
    money: boolean;
    cardClass: string;
    iconClass: string;
    amountClass: string;
    chipClass: string;
  }[] = [
    {
      id: "ingresos",
      label: "Ingresos",
      value: data.revHoy,
      sub: `${data.cobros} cobro${data.cobros === 1 ? "" : "s"} hoy`,
      icon: Wallet,
      money: true,
      cardClass: "border-emerald-400/25 bg-[radial-gradient(circle_at_12%_50%,rgba(34,197,94,0.16),transparent_34%),linear-gradient(135deg,rgba(15,118,110,0.16),rgba(15,23,42,0.56))] shadow-[0_0_40px_rgba(16,185,129,0.08)]",
      iconClass: "bg-emerald-500/14 text-emerald-300 ring-emerald-400/30 shadow-[0_0_26px_rgba(34,197,94,0.20)]",
      amountClass: "text-white",
      chipClass: "bg-emerald-400/12 text-emerald-300 ring-emerald-400/20",
    },
    {
      id: "pendientes",
      label: "Pendientes",
      value: data.pendingAmount,
      sub: `${data.pendingCharges?.length ?? 0} pendiente${(data.pendingCharges?.length ?? 0) === 1 ? "" : "s"}`,
      icon: Clock,
      money: true,
      cardClass: "border-orange-400/25 bg-[radial-gradient(circle_at_12%_50%,rgba(249,115,22,0.16),transparent_34%),linear-gradient(135deg,rgba(120,53,15,0.16),rgba(15,23,42,0.56))] shadow-[0_0_40px_rgba(249,115,22,0.08)]",
      iconClass: "bg-orange-500/14 text-orange-300 ring-orange-400/30 shadow-[0_0_26px_rgba(249,115,22,0.18)]",
      amountClass: "text-white",
      chipClass: "bg-orange-400/12 text-orange-300 ring-orange-400/20",
    },
    {
      id: "gastos",
      label: "Gastos",
      value: data.totalGastos,
      sub: `${data.expensesToday.length} gasto${data.expensesToday.length === 1 ? "" : "s"}`,
      icon: TrendingUp,
      money: true,
      cardClass: "border-rose-400/25 bg-[radial-gradient(circle_at_12%_50%,rgba(244,63,94,0.15),transparent_34%),linear-gradient(135deg,rgba(127,29,29,0.15),rgba(15,23,42,0.56))] shadow-[0_0_40px_rgba(244,63,94,0.08)]",
      iconClass: "bg-rose-500/14 text-rose-300 ring-rose-400/30 shadow-[0_0_26px_rgba(244,63,94,0.18)]",
      amountClass: "text-white",
      chipClass: "bg-rose-400/12 text-rose-300 ring-rose-400/20",
    },
  ];

  const panelTheme: Record<ActivePanel, {
    border: string;
    glow: string;
    headerIcon: string;
    title: string;
    chip: string;
    tableHead: string;
    rowHover: string;
    amount: string;
    badge: string;
  }> = {
    ingresos: {
      border: "border-emerald-400/24",
      glow: "shadow-[0_24px_90px_-45px_rgba(16,185,129,0.42)]",
      headerIcon: "bg-emerald-500/14 text-emerald-300 ring-emerald-400/25",
      title: "text-emerald-50",
      chip: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/18",
      tableHead: "border-emerald-400/10 bg-emerald-400/[0.018]",
      rowHover: "hover:bg-emerald-400/[0.045]",
      amount: "text-emerald-300",
      badge: "bg-emerald-500/12 text-emerald-300 ring-emerald-400/20",
    },
    pendientes: {
      border: "border-orange-400/24",
      glow: "shadow-[0_24px_90px_-45px_rgba(249,115,22,0.42)]",
      headerIcon: "bg-orange-500/14 text-orange-300 ring-orange-400/25",
      title: "text-orange-50",
      chip: "bg-orange-400/10 text-orange-300 ring-orange-400/18",
      tableHead: "border-orange-400/10 bg-orange-400/[0.018]",
      rowHover: "hover:bg-orange-400/[0.045]",
      amount: "text-orange-300",
      badge: "bg-orange-500/12 text-orange-300 ring-orange-400/20",
    },
    gastos: {
      border: "border-rose-400/24",
      glow: "shadow-[0_24px_90px_-45px_rgba(244,63,94,0.42)]",
      headerIcon: "bg-rose-500/14 text-rose-300 ring-rose-400/25",
      title: "text-rose-50",
      chip: "bg-rose-400/10 text-rose-300 ring-rose-400/18",
      tableHead: "border-rose-400/10 bg-rose-400/[0.018]",
      rowHover: "hover:bg-rose-400/[0.045]",
      amount: "text-rose-300",
      badge: "bg-rose-500/12 text-rose-300 ring-rose-400/20",
    },
  };

  const activeTheme = panelTheme[activePanel];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {stats.map((s) => {
          const isActive = activePanel === s.id;
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActivePanel(s.id)}
              className={cn(
                "group relative min-h-[150px] overflow-hidden rounded-3xl border p-6 text-left transition-all duration-300",
                "backdrop-blur-xl shadow-[0_34px_90px_-42px_rgba(0,0,0,0.98),0_14px_32px_-18px_rgba(0,0,0,0.82),0_1px_0_rgba(255,255,255,0.05)_inset] hover:-translate-y-0.5 hover:shadow-[0_42px_105px_-44px_rgba(0,0,0,1),0_18px_42px_-20px_rgba(0,0,0,0.9),0_1px_0_rgba(255,255,255,0.06)_inset]",
                s.cardClass,
                isActive ? "ring-1 ring-white/15" : "ring-1 ring-transparent"
              )}
            >
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.012))]" />
              <div className="relative flex items-center gap-5">
                <div className={cn("grid size-16 place-items-center rounded-full ring-1 transition-transform duration-300 group-hover:scale-105", s.iconClass)}>
                  <Icon className="size-7" />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-semibold text-foreground/90">{s.label}</p>
                  <div className="mt-1">
                    <Money value={Number(s.value)} large />
                  </div>
                  <div className={cn("mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1", s.chipClass)}>
                    <span className="size-1.5 rounded-full bg-current" />
                    {s.sub}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {activePanel === "ingresos" && (
        <History data={data} equipoEnabled={equipoEnabled} onCobrarPendiente={onCobrarPendiente} title="Últimos movimientos" theme={activeTheme} />
      )}

      {activePanel === "pendientes" && (
        <div className={cn("rounded-3xl border bg-white/[0.025] overflow-hidden cash-panel-glow transition-all duration-300", panelTheme.pendientes.border, panelTheme.pendientes.glow)}>
          <div className={cn("px-5 py-4 border-b flex items-center justify-between", panelTheme.pendientes.tableHead)}>
            <div className={cn("text-sm font-semibold", panelTheme.pendientes.title)}>Pendientes de cobro</div>
            <div className={cn("rounded-full px-3 py-1 text-xs font-semibold ring-1", panelTheme.pendientes.chip)}>
              {data.pendingCharges.length} pendiente{data.pendingCharges.length !== 1 ? "s" : ""} · ${data.pendingAmount.toLocaleString("es-AR")}
            </div>
          </div>
          {data.pendingCharges.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">Sin pendientes.</p>
          ) : (
            <div className="divide-y divide-white/5">
              {data.pendingCharges.map((a: any) => (
                <div key={a.id} className={cn("px-5 py-3.5 flex items-start justify-between gap-3 transition-all duration-200", panelTheme.pendientes.rowHover)}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{a.client_name ?? "Sin cliente"}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {a.service_name ?? "—"}
                      {a.starts_at && <span> · {new Date(a.starts_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-sm font-semibold tabular-nums text-orange-300">${Number(a.service_price ?? 0).toLocaleString("es-AR")}</div>
                    {equipoEnabled && (
                      <button
                        onClick={() => onCobrarPendiente(a)}
                        className={cn("text-xs font-semibold px-2.5 py-1 rounded-lg ring-1 transition", panelTheme.pendientes.badge, "hover:bg-orange-400/20")}
                      >
                        Cobrar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activePanel === "gastos" && (
        <div className={cn("rounded-3xl border bg-white/[0.025] overflow-hidden cash-panel-glow transition-all duration-300", panelTheme.gastos.border, panelTheme.gastos.glow)}>
          <div className={cn("px-5 py-4 border-b flex items-center justify-between", panelTheme.gastos.tableHead)}>
            <div className={cn("text-sm font-semibold", panelTheme.gastos.title)}>Gastos</div>
            <div className={cn("rounded-full px-3 py-1 text-xs font-semibold ring-1", panelTheme.gastos.chip)}>
              {data.expensesToday.length} gasto{data.expensesToday.length !== 1 ? "s" : ""} · ${data.totalGastos.toLocaleString("es-AR")}
            </div>
          </div>
          <div className={cn("grid grid-cols-[90px_160px_1fr_130px_190px] gap-4 px-5 py-3 border-b text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70", panelTheme.gastos.tableHead)}>
            <div>Fecha</div>
            <div>Categoría</div>
            <div>Descripción</div>
            <div className="text-right">Monto</div>
            <div>Usuario responsable</div>
          </div>
          {data.expensesToday.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">Sin gastos registrados.</p>
          ) : (
            <div className="divide-y divide-white/5">
              {data.expensesToday.map((e: any) => {
                const date = e.date
                  ? new Date(`${e.date}T00:00:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })
                  : e.created_at
                    ? new Date(e.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })
                    : "—";
                const category = e.category ?? e.type ?? "—";
                const description = e.name ?? e.description ?? e.concept ?? e.note ?? "Gasto";
                const user = e.user_name ?? e.user_email ?? e.created_by ?? "Caja";
                return (
                  <div key={e.id} className={cn("grid grid-cols-[90px_160px_1fr_130px_190px] gap-4 px-5 py-3.5 items-center text-sm transition-all duration-200", panelTheme.gastos.rowHover)}>
                    <div className="text-muted-foreground">{date}</div>
                    <div className="text-muted-foreground capitalize">{category}</div>
                    <div className="min-w-0">
                      <div className="truncate text-foreground/90">{description}</div>
                      {e.note && e.note !== description && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground/70">{e.note}</div>
                      )}
                    </div>
                    <div className="text-right font-bold tabular-nums text-rose-300">-${Number(e.amount ?? 0).toLocaleString("es-AR")}</div>
                    <div className="truncate text-muted-foreground">{user}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NuevoGastoTab({
  data,
  userEmail,
  onCancel,
  onSaved,
}: {
  data: ReturnType<typeof useCajaData>;
  userEmail: string | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({ name: "", amount: "", type: "", method: "", note: "" });
  const [saving, setSaving] = React.useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const GTYPES = ["fijo", "variable", "ocasional", "marketing"];
  const GMETHODS = ["efectivo", "transferencia", "débito", "crédito", "mercado pago"];

  async function saveGasto() {
    const name = form.name.trim();
    const amount = parseFloat(form.amount);
    if (!name) return toast.error("El nombre del gasto es obligatorio.");
    if (!amount || amount <= 0) return toast.error("El monto debe ser mayor a 0.");
    setSaving(true);
    const { error } = await supabase.from("expenses").insert({
      business_id: data.businessId,
      name,
      amount,
      type: form.type || null,
      payment_method: form.method || null,
      date: today,
      note: form.note.trim() || null,
      user_name: userEmail ?? "Caja",
      created_by: userEmail ?? "Caja",
    });
    setSaving(false);
    if (error) return toast.error("Error guardando gasto: " + error.message);
    toast.success("✓ Gasto registrado");
    window.dispatchEvent(new CustomEvent("clippr:gasto-guardado"));
    onSaved();
  }

  return (
    <div className="animate-fade-up">
      <Card className="mx-auto w-full max-w-3xl p-5 md:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Nuevo gasto</h3>
            <p className="mt-1 text-sm text-muted-foreground">Registrá un egreso de caja.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-muted-foreground transition hover:bg-white/[0.07] hover:text-foreground"
          >
            Cancelar
          </button>
        </div>

        <div className="space-y-3">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Nombre del gasto *"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-blue-300/50"
          />
          <input
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="Monto *"
            type="number"
            min={0}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-blue-300/50"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-foreground outline-none focus:border-blue-300/50"
            >
              <option value="">Tipo</option>
              {GTYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
            <select
              value={form.method}
              onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-foreground outline-none focus:border-blue-300/50"
            >
              <option value="">Método de pago</option>
              {GMETHODS.map((m) => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
            </select>
          </div>
          <input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Nota (opcional)"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-blue-300/50"
          />
          <button
            type="button"
            onClick={saveGasto}
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-blue-400 to-violet-500 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Registrar gasto
          </button>
        </div>
      </Card>
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
    manual: "border-blue-300/30 bg-blue-300/10 text-blue-200",
  };
  const dotCls: Record<typeof mode, string> = {
    auto: "bg-emerald-400",
    manual: "bg-blue-300",
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
              <o.icon className="size-4 text-blue-300" /> {o.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ─────────── Cierre de caja ──────────────────────────────────────────────────

type CierreMetodoDetalle = {
  ingresos: number;
  gastos: number;
  utilidad: number;
};

type CajaEvento = {
  tipo?: string | null;
  fecha_hora?: string | null;
  hora?: string | null;
  usuario?: string | null;
  observacion?: string | null;
  motivo?: string | null;
  [key: string]: unknown;
};

function cajaEventosArray(value: unknown): CajaEvento[] {
  return Array.isArray(value) ? (value as CajaEvento[]) : [];
}

function appendCajaEvento(prevEventos: unknown, evento: CajaEvento): CajaEvento[] {
  return [...cajaEventosArray(prevEventos), evento];
}

function cleanCajaEventosForDisplay(events: CajaEvento[]): CajaEvento[] {
  const cleaned: CajaEvento[] = [];

  for (const event of events) {
    const previous = cleaned[cleaned.length - 1];
    const sameAsPrevious =
      previous &&
      previous.tipo === event.tipo &&
      previous.hora === event.hora &&
      previous.usuario === event.usuario &&
      (previous.observacion ?? null) === (event.observacion ?? null) &&
      (previous.motivo ?? null) === (event.motivo ?? null);

    if (!sameAsPrevious) cleaned.push(event);
  }

  return cleaned;
}

function isCajaCerradaRow(cierre: any) {
  return String(cierre?.estado ?? "").toLowerCase() === "cerrada";
}

function isCajaReabiertaRow(cierre: any) {
  return String(cierre?.estado ?? "").toLowerCase() === "reabierta";
}

function paymentMethodLabel(method: string) {
  return PAY_METHOD_LABEL[method as PayMethod] ?? method ?? "Sin método";
}

function CierreCajaBtn({
  paymentsToday,
  expensesToday,
  businessId,
  userEmail,
  onCajaCerrada,
}: {
  paymentsToday: ReturnType<typeof useCajaData>["paymentsToday"];
  expensesToday: ReturnType<typeof useCajaData>["expensesToday"];
  businessId: string | null;
  userEmail: string | null;
  onCajaCerrada: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);

  const today = new Date().toLocaleDateString("sv-SE");

  const todayPayments = paymentsToday.filter(
    (p) => new Date(p.created_at).toLocaleDateString("sv-SE") === today,
  );

  const todayExpenses = expensesToday.filter((e: any) => {
    if (e.date) return e.date === today;
    if (e.created_at) return new Date(e.created_at).toLocaleDateString("sv-SE") === today;
    return true;
  });

  const totalCobrado = todayPayments.reduce(
    (s, p) => s + Number((p as any).total ?? (p as any).amount ?? 0), 0,
  );
  const totalGastos = todayExpenses.reduce(
    (s, e) => s + Number((e as any).amount ?? 0), 0,
  );
  const utilidad = totalCobrado - totalGastos;

  const detalleMetodos = useMemo(() => {
    const detail: Record<string, CierreMetodoDetalle> = {};
    const ensure = (method: string | null | undefined) => {
      const key = String(method || "efectivo").toLowerCase();
      if (!detail[key]) detail[key] = { ingresos: 0, gastos: 0, utilidad: 0 };
      return detail[key];
    };

    for (const p of todayPayments) {
      const row = ensure((p as any).method ?? (p as any).payment_method);
      row.ingresos += Number((p as any).total ?? (p as any).amount ?? 0);
    }

    for (const e of todayExpenses) {
      const row = ensure((e as any).payment_method ?? (e as any).method);
      row.gastos += Number((e as any).amount ?? 0);
    }

    Object.values(detail).forEach((row) => {
      row.utilidad = row.ingresos - row.gastos;
    });

    return detail;
  }, [todayPayments, todayExpenses]);

  const cobrosSnapshot = todayPayments.map((p: any) => ({
    id: p.id,
    hora: p.created_at
      ? new Date(p.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
      : null,
    cliente: p.client_name ?? p.cliente ?? null,
    profesional: p.employee_name ?? p.professional_name ?? null,
    servicio: p.service_name ?? p.service ?? null,
    metodo: p.method ?? p.payment_method ?? null,
    monto: Number(p.total ?? p.amount ?? 0),
    usuario: p.charged_by ?? p.created_by ?? null,
  }));

  const gastosSnapshot = todayExpenses.map((e: any) => ({
    id: e.id,
    hora: e.created_at
      ? new Date(e.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
      : null,
    nombre: e.name ?? e.concept ?? e.category ?? "Gasto",
    tipo: e.type ?? e.category ?? null,
    metodo: e.payment_method ?? e.method ?? null,
    monto: Number(e.amount ?? 0),
    nota: e.note ?? null,
    usuario: e.user_name ?? e.created_by ?? null,
  }));

  async function confirmar() {
    if (saving || !businessId) return;
    setSaving(true);
    try {
      const now = new Date();
      const hora = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
      const cierreEvento = {
        tipo: "cierre",
        modo: "manual",
        fecha_hora: now.toISOString(),
        hora,
        usuario: userEmail ?? "Caja",
        observacion: obs.trim() || null,
        total_cobrado: totalCobrado,
        total_gastos: totalGastos,
        utilidad,
      };

      const { data: existing } = await supabase
        .from("caja_cierres" as any)
        .select("id,eventos,estado")
        .eq("business_id", businessId)
        .eq("fecha", today)
        .maybeSingle();

      if (existing?.id && isCajaCerradaRow(existing)) {
        toast.info("La caja ya está cerrada");
        setOpen(false);
        onCajaCerrada();
        return;
      }

      const payload = {
        business_id: businessId,
        fecha: today,
        hora_cierre: hora,
        usuario_id: null,
        usuario_nombre: userEmail ?? "Caja",
        total_cobrado: totalCobrado,
        total_gastos: totalGastos,
        utilidad,
        cantidad_cobros: todayPayments.length,
        detalle_metodos_pago: detalleMetodos,
        cobros_snapshot: cobrosSnapshot,
        gastos_snapshot: gastosSnapshot,
        observacion: obs.trim() || null,
        tipo_cierre: "manual",
        estado: "cerrada",
        eventos: appendCajaEvento((existing as any)?.eventos, cierreEvento),
        updated_at: now.toISOString(),
      };

      const query = existing?.id
        ? supabase
            .from("caja_cierres" as any)
            .update(payload)
            .eq("id", (existing as any).id)
            .eq("business_id", businessId)
            .neq("estado", "cerrada")
            .select("id")
            .maybeSingle()
        : supabase.from("caja_cierres" as any).insert(payload).select("id").maybeSingle();

      const { data: savedCierre, error } = await query;
      if (error) throw new Error(error.message);
      if (!savedCierre?.id) {
        toast.info("La caja ya estaba cerrada");
        setOpen(false);
        onCajaCerrada();
        return;
      }
      toast.success("Cierre registrado correctamente");
      setOpen(false);
      setObs("");
      onCajaCerrada(); // ← bloquea la pantalla inmediatamente
      window.dispatchEvent(new CustomEvent("clippr:caja-cierre-guardado"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition-all duration-200 bg-white/[0.035] text-foreground border border-white/14 hover:-translate-y-0.5 hover:bg-white/[0.065] hover:border-white/20 shadow-[0_12px_40px_-28px_rgba(0,0,0,0.9)]"
      >
        <Wallet className="size-4 text-white/80 transition-transform group-hover:scale-110" />
        Cierre de caja
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold">Cierre de caja</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)}
                className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-sm">
                Cancelar
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Cobrado",  v: totalCobrado, cls: "text-emerald-300" },
                  { label: "Gastos",   v: totalGastos,  cls: "text-rose-300"   },
                  { label: "Utilidad", v: utilidad,     cls: utilidad >= 0 ? "text-emerald-300" : "text-rose-300" },
                ].map((k) => (
                  <div key={k.label} className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 p-3 text-center">
                    <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70">{k.label}</div>
                    <div className={`mt-1 text-xl font-semibold tabular-nums ${k.cls}`}>
                      ${k.v.toLocaleString("es-AR")}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-white/[0.025] ring-1 ring-white/10 overflow-hidden">
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 border-b border-white/5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                  <div>Método</div>
                  <div className="text-right">Ingresos</div>
                  <div className="text-right">Gastos</div>
                  <div className="text-right">Utilidad</div>
                </div>
                {Object.entries(detalleMetodos).length === 0 ? (
                  <div className="px-4 py-3 text-sm text-muted-foreground">Sin movimientos hoy.</div>
                ) : (
                  Object.entries(detalleMetodos).map(([m, row]) => (
                    <div key={m} className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 border-b border-white/5 last:border-0 text-sm">
                      <span className="capitalize">{paymentMethodLabel(m)}</span>
                      <span className="text-right font-semibold tabular-nums text-emerald-300">${row.ingresos.toLocaleString("es-AR")}</span>
                      <span className="text-right font-semibold tabular-nums text-rose-300">${row.gastos.toLocaleString("es-AR")}</span>
                      <span className={`text-right font-semibold tabular-nums ${row.utilidad >= 0 ? "text-emerald-300" : "text-rose-300"}`}>${row.utilidad.toLocaleString("es-AR")}</span>
                    </div>
                  ))
                )}
              </div>

              <div>
                <label className="text-xs text-muted-foreground">Observación opcional</label>
                <textarea
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  rows={2}
                  placeholder="Novedades del día, diferencias, etc."
                  className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-blue-300/40 resize-none"
                />
              </div>

              <button
                type="button"
                onClick={confirmar}
                disabled={saving}
                className="w-full inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold bg-gradient-to-b from-blue-400 to-violet-500 text-white hover:brightness-105 disabled:opacity-50 transition-all"
              >
                {saving ? "Guardando…" : "Confirmar cierre"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────── Cierres de caja — historial tab ─────────────────────────────────

function CierresTab({ businessId, cajaCerrada, onCajaReopened }: {
  businessId: string | null;
  cajaCerrada: boolean;
  onCajaReopened: () => void;
}) {
  const [cierres, setCierres] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  const loadCierres = React.useCallback(() => {
    if (!businessId) return;
    setLoading(true);
    supabase
      .from("caja_cierres" as any)
      .select("*")
      .eq("business_id", businessId)
      .order("fecha", { ascending: false })
      .order("hora_cierre", { ascending: false })
      .limit(90)
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        setCierres(data ?? []);
        setLoading(false);
      });
  }, [businessId]);

  useEffect(() => {
    loadCierres();
    const handler = () => loadCierres();
    window.addEventListener("clippr:caja-cierre-guardado", handler);
    return () => window.removeEventListener("clippr:caja-cierre-guardado", handler);
  }, [loadCierres]);

  const cierreEventos = (cierre: any) => cleanCajaEventosForDisplay(cajaEventosArray(cierre?.eventos));

  // Observation: get from the most recent "cierre" event (not from root field)
  function getCierreObservacion(cierre: any): string | null {
    const eventos = cierreEventos(cierre);
    // Find last cierre event that has an observacion
    const lastCierre = [...eventos].reverse().find((e: any) => e?.tipo === "cierre" && e?.observacion);
    return lastCierre?.observacion ?? cierre?.observacion ?? null;
  }

  async function reabrirCaja(cierre: any) {
    if (!businessId || !cierre?.id || reopeningId) return;

    const reason = window.prompt("Motivo de reapertura de caja (opcional)") ?? "";
    setReopeningId(cierre.id);

    try {
      const { data: freshCierre, error: readError } = await supabase
        .from("caja_cierres" as any)
        .select("id,eventos,estado")
        .eq("id", cierre.id)
        .eq("business_id", businessId)
        .maybeSingle();

      if (readError) throw readError;
      if (!freshCierre?.id) throw new Error("No se encontró el cierre");

      if (isCajaReabiertaRow(freshCierre)) {
        toast.info("La caja ya está abierta");
        setSelected(null);
        loadCierres();
        onCajaReopened();
        return;
      }

      if (!isCajaCerradaRow(freshCierre)) {
        toast.info("La caja no está cerrada");
        setSelected(null);
        loadCierres();
        onCajaReopened();
        return;
      }

      const now = new Date();
      const user = "Caja";
      const hora = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
      const evento = {
        tipo: "reapertura",
        fecha_hora: now.toISOString(),
        hora,
        usuario: user,
        motivo: reason.trim() || null,
      };

      const { data: updated, error } = await supabase
        .from("caja_cierres" as any)
        .update({
          estado: "reabierta",
          reopened_at: now.toISOString(),
          reopened_by: user,
          reopen_reason: reason.trim() || null,
          eventos: appendCajaEvento((freshCierre as any).eventos, evento),
          updated_at: now.toISOString(),
        })
        .eq("id", cierre.id)
        .eq("business_id", businessId)
        .eq("estado", "cerrada")
        .select("id")
        .maybeSingle();

      if (error) throw error;

      if (!updated?.id) {
        toast.info("La caja ya estaba abierta");
        setSelected(null);
        loadCierres();
        onCajaReopened();
        return;
      }

      try {
        await reopenCashSession({
          sessionId: cierre.id,
          businessId,
          reopenedBy: user,
        });
      } catch {
        // El historial visual ya quedó guardado en caja_cierres.
      }

      toast.success("Caja reabierta");
      setSelected(null);
      loadCierres();
      onCajaReopened();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo reabrir la caja");
    } finally {
      setReopeningId(null);
    }
  }


  return (
    <div className="space-y-4 animate-fade-up">
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Cierres de caja</div>
        <p className="mt-1 text-sm text-muted-foreground">Historial de cierres manuales y automáticos.</p>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground animate-pulse">Cargando…</div>
      ) : cierres.length === 0 ? (
        <div className="glass rounded-2xl py-12 text-center text-sm text-muted-foreground cash-panel-glow">
          Sin cierres registrados todavía.
        </div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden cash-panel-glow">
          <div className="grid grid-cols-[1fr_160px] px-5 py-3 border-b border-white/10 text-[10px] uppercase tracking-[0.13em] text-muted-foreground/60">
            <div>Fecha</div>
            <div className="text-right">Estado</div>
          </div>
          {cierres.map((c) => {
            const eventos = cierreEventos(c);
            const nCierres = eventos.filter((e: any) => e?.tipo === "cierre").length || 1;
            return (
              <button key={c.id} type="button" onClick={() => setSelected(c)}
                className="w-full grid grid-cols-[1fr_160px] items-center px-5 py-3.5 text-sm border-b border-white/5 last:border-0 hover:bg-white/[0.025] transition text-left">
                <div>
                  <div className="text-foreground text-sm font-medium">
                    {new Date(c.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "numeric" })}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{nCierres} cierre{nCierres === 1 ? "" : "s"}</div>
                </div>
                <div className="text-right">
                  <span className={cn("text-xs px-2 py-0.5 rounded-full ring-1",
                    c.estado === "reabierta"
                      ? "bg-emerald-500/10 ring-emerald-400/20 text-emerald-300"
                      : "bg-rose-500/10 ring-rose-400/20 text-rose-300"
                  )}>
                    {c.estado === "reabierta" ? "Reabierta" : "Cerrada"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 sticky top-0 bg-[oklch(0.11_0.04_275)] z-10">
              <div>
                <div className="font-semibold text-sm">Detalle del cierre</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {new Date(selected.fecha + "T12:00:00").toLocaleDateString("es-AR", {
                    weekday: "long", day: "numeric", month: "long", year: "numeric",
                  })} · {selected.hora_cierre ?? "—"}
                </div>
              </div>
              <button type="button" onClick={() => setSelected(null)}
                className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-sm">Cerrar</button>
            </div>
            <div className="p-5 space-y-5 text-sm">
              {/* KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { l: "Cobrado",  v: `$${Number(selected.total_cobrado ?? 0).toLocaleString("es-AR")}`, cls: "text-emerald-300" },
                  { l: "Gastos",   v: `$${Number(selected.total_gastos ?? 0).toLocaleString("es-AR")}`,  cls: "text-rose-300" },
                  { l: "Utilidad", v: `$${Number(selected.utilidad ?? 0).toLocaleString("es-AR")}`,      cls: Number(selected.utilidad) >= 0 ? "text-emerald-300" : "text-rose-300" },
                  { l: "Cobros",   v: String(selected.cantidad_cobros ?? "—"),                            cls: "text-foreground" },
                ].map((r) => (
                  <div key={r.l} className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 p-3">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">{r.l}</div>
                    <div className={`mt-1 font-semibold tabular-nums ${r.cls}`}>{r.v}</div>
                  </div>
                ))}
              </div>

              {/* Observation for THIS specific cierre — from last cierre event */}
              {getCierreObservacion(selected) && (
                <div className="rounded-xl bg-blue-500/[0.06] ring-1 ring-blue-400/15 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.15em] text-blue-300/60 mb-1">Observación del cierre</div>
                  <p className="text-sm text-foreground/80 whitespace-pre-wrap">{getCierreObservacion(selected)}</p>
                </div>
              )}

              {/* Full event history — always shown */}
              {cierreEventos(selected).length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60">Historial de movimientos</div>
                  <div className="rounded-xl bg-white/[0.025] ring-1 ring-white/10 overflow-hidden divide-y divide-white/5">
                    {cierreEventos(selected).map((ev: any, i: number) => {
                      const hora = ev.hora ?? (ev.fecha_hora ? new Date(ev.fecha_hora).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "—");
                      const fecha = ev.fecha_hora ? new Date(ev.fecha_hora).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) : "";
                      const isReopen = ev.tipo === "reapertura";
                      return (
                        <div key={i} className="px-4 py-3 text-xs space-y-0.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span className={cn("size-1.5 rounded-full shrink-0", isReopen ? "bg-emerald-400" : "bg-rose-400")} />
                              <span className={cn("font-semibold", isReopen ? "text-emerald-300" : "text-rose-300")}>
                                {isReopen ? "Reabrió caja" : "Cerró caja"}
                              </span>
                            </div>
                            <span className="text-muted-foreground tabular-nums">{fecha} {hora}</span>
                          </div>
                          <div className="pl-3.5 text-muted-foreground">
                            Usuario: <span className="text-foreground">{ev.usuario ?? "—"}</span>
                            {ev.motivo && <span> · Motivo: <span className="text-foreground">{ev.motivo}</span></span>}
                            {ev.observacion && <span> · Obs: <span className="text-foreground">{ev.observacion}</span></span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Detalle por método */}
              {selected.detalle_metodos_pago && Object.keys(selected.detalle_metodos_pago).length > 0 && (
                <div className="rounded-xl bg-white/[0.025] ring-1 ring-white/10 overflow-hidden">
                  <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 border-b border-white/5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    <div>Método</div><div className="text-right">Ingresos</div><div className="text-right">Gastos</div><div className="text-right">Utilidad</div>
                  </div>
                  {Object.entries(selected.detalle_metodos_pago as Record<string, CierreMetodoDetalle>).map(([m, row]) => (
                    <div key={m} className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 border-b border-white/5 last:border-0">
                      <span className="text-muted-foreground capitalize">{paymentMethodLabel(m)}</span>
                      <span className="text-right font-semibold tabular-nums text-emerald-300">${Number(row.ingresos ?? 0).toLocaleString("es-AR")}</span>
                      <span className="text-right font-semibold tabular-nums text-rose-300">${Number(row.gastos ?? 0).toLocaleString("es-AR")}</span>
                      <span className={`text-right font-semibold tabular-nums ${Number(row.utilidad ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>${Number(row.utilidad ?? 0).toLocaleString("es-AR")}</span>
                    </div>
                  ))}
                </div>
              )}

              {Array.isArray(selected.cobros_snapshot) && selected.cobros_snapshot.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60">Cobros incluidos</div>
                  <div className="rounded-xl bg-white/[0.025] ring-1 ring-white/10 overflow-hidden divide-y divide-white/5">
                    {selected.cobros_snapshot.map((c: any, i: number) => (
                      <div key={c.id ?? i} className="grid grid-cols-[55px_1fr_1fr_90px] gap-2 px-4 py-2.5 text-xs">
                        <span className="text-muted-foreground">{c.hora ?? "—"}</span>
                        <span>{c.cliente ?? "Sin cliente"}</span>
                        <span className="text-muted-foreground truncate">{c.servicio ?? "Venta"}</span>
                        <span className="text-right font-semibold tabular-nums">${Number(c.monto ?? 0).toLocaleString("es-AR")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {Array.isArray(selected.gastos_snapshot) && selected.gastos_snapshot.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60">Gastos incluidos</div>
                  <div className="rounded-xl bg-white/[0.025] ring-1 ring-white/10 overflow-hidden divide-y divide-white/5">
                    {selected.gastos_snapshot.map((g: any, i: number) => (
                      <div key={g.id ?? i} className="grid grid-cols-[55px_1fr_1fr_90px] gap-2 px-4 py-2.5 text-xs">
                        <span className="text-muted-foreground">{g.hora ?? "—"}</span>
                        <span>{g.nombre ?? "Gasto"}</span>
                        <span className="text-muted-foreground truncate">{g.metodo ?? g.tipo ?? "—"}</span>
                        <span className="text-right font-semibold tabular-nums text-rose-300">-${Number(g.monto ?? 0).toLocaleString("es-AR")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reabrir — only show when caja is actually closed (not already reopened) */}
              {cajaCerrada && selected.estado !== "reabierta" && (
                <button
                  type="button"
                  onClick={() => reabrirCaja(selected)}
                  disabled={reopeningId === selected.id}
                  className="w-full rounded-xl bg-white/[0.04] hover:bg-white/[0.07] ring-1 ring-white/10 px-4 py-3 text-sm font-semibold transition disabled:opacity-50"
                >
                  {reopeningId === selected.id ? "Reabriendo…" : "Reabrir caja"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// helpers
const CHARGE_TYPE_META: Record<string, { label: string; cls: string }> = {
  auto:   { label: "Automático", cls: "bg-emerald-500/10 ring-emerald-400/25 text-emerald-300" },
  manual: { label: "Manual",     cls: "bg-blue-500/10  ring-blue-400/25  text-blue-200"  },
  caja:   { label: "Caja",       cls: "bg-sky-500/10    ring-sky-400/25    text-sky-300"    },
};

const STATUS_META: Record<string, { label: string; dot: string }> = {
  cobrado:     { label: "Cobrado",     dot: "bg-emerald-400" },
  pendiente:   { label: "Pendiente",   dot: "bg-blue-400"   },
  pending_payment: { label: "Pendiente", dot: "bg-blue-400" },
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
  const normalized = type === "desactivado" ? "caja" : type;
  const m = CHARGE_TYPE_META[normalized] ?? { label: normalized, cls: "bg-white/5 ring-white/10 text-muted-foreground" };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1", m.cls)}>
      {m.label}
    </span>
  );
}

function getChargeType(payment: Record<string, unknown>) {
  const raw = String(payment.charge_type ?? payment.origin ?? payment.source ?? "caja");
  if (["auto", "automatico", "automático"].includes(raw.toLowerCase())) return "auto";
  if (["manual"].includes(raw.toLowerCase())) return "manual";
  if (["desactivado", "disabled"].includes(raw.toLowerCase())) return "caja";
  return raw || "caja";
}

function getChargedByLabel(payment: Record<string, unknown>, professionalName: string | null, chargeType: string) {
  const raw = String(payment.charged_by_name ?? payment.cashier_name ?? payment.user_name ?? "").trim();
  if (raw && !/^[0-9a-f]{8}-[0-9a-f-]{13,}$/i.test(raw)) return raw;
  if (chargeType === "auto") return professionalName ?? "Profesional";
  if (chargeType === "manual") return "Recepción";
  return "Caja";
}

function getPaymentMethodLabel(payment: Record<string, unknown>) {
  const method = String(payment.method ?? payment.payment_method ?? "cash") as PayMethod;
  return PAY_METHOD_LABEL[method] ?? method;
}

function getSaleDetailLabel(payment: Record<string, unknown>) {
  const serviceName = String(payment.service_name ?? "").trim();
  const productName = String(payment.product_name ?? payment.catalog_name ?? "").trim();
  const itemName = serviceName || productName || "—";
  const qty = Number(payment.qty ?? payment.quantity ?? 1);
  return qty > 1 && itemName !== "—" ? `${itemName} x${qty}` : itemName;
}

function DetailModal({ payment, employees, onClose }: {
  payment: ReturnType<typeof useCajaData>["paymentsToday"][number];
  employees: ReturnType<typeof useCajaData>["employees"];
  onClose: () => void;
}) {
  const method = (payment.method ?? payment.payment_method ?? "cash") as PayMethod;
  const empName = employees.find(e => e.id === payment.employee_id)?.name ?? null;
  const chargedById = (payment as Record<string, unknown>).charged_by as string | null ?? null;
  const chargedBy = chargedById
    ? (employees.find(e => e.id === chargedById)?.name ?? (chargedById.length < 40 ? chargedById : null) ?? "—")
    : "—";
  const chargeType = (payment as Record<string, unknown>).charge_type as string | null ?? "caja";
  const status = (payment as Record<string, unknown>).status as string | null ?? "cobrado";
  const comprobante = (payment as Record<string, unknown>).reference as string | null ?? null;
  const obs = ((payment as Record<string, unknown>).observations as string | null ?? null) || ((payment as Record<string, unknown>).notes as string | null ?? null);
  const sucursal = (payment as Record<string, unknown>).branch as string | null ?? null;
  const paymentNumber = (payment as Record<string, unknown>).payment_number as number | string | null ?? null;
  const discount = (payment as Record<string, unknown>).discount_amount as number | null ?? null;
  const depositApplied = (payment as Record<string, unknown>).deposit_paid as number | null ?? null;

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

  const ventaNum = paymentNumber
    ? `#${String(paymentNumber).padStart(6, "0")}`
    : `#${payment.id.slice(-6).toUpperCase()}`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-semibold">Detalle de venta</h3>
              <span className="text-[11px] font-mono text-primary/80 bg-primary/10 px-2 py-0.5 rounded-lg">{ventaNum}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{fmtDT(payment.created_at)}</p>
          </div>
          <button onClick={onClose} className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs transition">Cerrar</button>
        </div>

        <div className="px-5 py-1 max-h-[72vh] overflow-y-auto">

          {/* Total + estado */}
          <div className="py-3 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
            <span className="font-display text-2xl font-semibold tabular-nums">
              ${Number(payment.total ?? payment.amount ?? 0).toLocaleString("es-AR")}
            </span>
            <div className="flex gap-2 flex-wrap">
              <StatusPill status={status} />
              <ChargeTypePill type={chargeType} />
            </div>
          </div>

          {/* Bloque: Quién */}
          <div className="mt-3 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3 space-y-0">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">Participantes</p>
            <Row label="Cliente"       value={payment.client_name ?? "—"} />
            <Row label="Profesional"   value={empName ?? "—"} />
            <Row label="Cobrado por"   value={chargedBy ?? "—"} />
            {sucursal && <Row label="Sucursal" value={sucursal} />}
          </div>

          {/* Bloque: Qué */}
          <div className="mt-3 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3 space-y-0">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">Detalle del servicio</p>
            <Row label="Servicio / Producto" value={payment.service_name ?? "—"} />
            {discount && discount > 0 && (
              <Row label="Descuento aplicado" value={<span className="text-blue-300">−${discount.toLocaleString("es-AR")}</span>} />
            )}
            {depositApplied && depositApplied > 0 && (
              <Row label="Seña aplicada" value={<span className="text-primary">−${depositApplied.toLocaleString("es-AR")}</span>} />
            )}
            {commission !== null && (
              <Row label="Comisión profesional" value={`$${commission.toLocaleString("es-AR")}`} />
            )}
          </div>

          {/* Bloque: Cómo se cobró */}
          <div className="mt-3 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3 space-y-0">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">Método de cobro</p>
            <Row label="💳 Método de pago" value={PAY_METHOD_LABEL[method] ?? method} />
            <Row label="📍 Origen del cobro" value={<ChargeTypePill type={chargeType} />} />
            <Row label="Estado" value={<StatusPill status={status} />} />
            {comprobante && <Row label="Referencia / Comprobante" value={comprobante} />}
          </div>

          {/* Bloque: Trazabilidad */}
          <div className="mt-3 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3 space-y-0">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">Trazabilidad</p>
            <Row label="Nº de venta"  value={<span className="font-mono">{ventaNum}</span>} />
            <Row label="Registrado"   value={fmtDT(payment.created_at)} />
            <Row label="Cobrado"      value={fmtDT((payment as Record<string, unknown>).charged_at as string | null ?? payment.created_at)} />
          </div>

          {obs && (
            <div className="mt-3 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">Nota / Observaciones</p>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{obs}</p>
            </div>
          )}

          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}

function History({ data, equipoEnabled, onCobrarPendiente, title = "Cobros", theme }: { data: ReturnType<typeof useCajaData>; equipoEnabled: boolean; onCobrarPendiente: (appt: ReturnType<typeof useCajaData>["pendingCharges"][number]) => void; title?: string; theme?: { border: string; glow: string; headerIcon: string; title: string; chip: string; tableHead: string; rowHover: string; amount: string; badge: string } }) {
  const incomeTheme = theme ?? {
    border: "border-emerald-400/24",
    glow: "shadow-[0_24px_90px_-45px_rgba(16,185,129,0.42)]",
    headerIcon: "bg-emerald-500/14 text-emerald-300 ring-emerald-400/25",
    title: "text-emerald-50",
    chip: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/18",
    tableHead: "border-emerald-400/10 bg-emerald-400/[0.018]",
    rowHover: "hover:bg-emerald-400/[0.045]",
    amount: "text-emerald-300",
    badge: "bg-emerald-500/12 text-emerald-300 ring-emerald-400/20",
  };

  const rows = data.paymentsToday;
  const pendingRows = data.pendingCharges;
  const [closeoutOpen, setCloseoutOpen] = React.useState(false);
  const [selectedMethod, setSelectedMethod] = React.useState<string | null>(null);
  const [detailPayment, setDetailPayment] = React.useState<typeof rows[number] | null>(null);
  const [pendingNoteModal, setPendingNoteModal] = React.useState<{ title: string; note: string } | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  const visibleRows = showAll ? rows : rows.slice(0, 10);
  const hasAnyRows = pendingRows.length > 0 || visibleRows.length > 0;

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
      <Card
        className={cn("rounded-3xl transition-all duration-300", incomeTheme.border, incomeTheme.glow)}
        style={{ background: "linear-gradient(180deg, oklch(0.18 0.035 260 / 0.70), oklch(0.105 0.028 270 / 0.78))" }}
      >
        {/* Header */}
        <div className={cn("flex items-center justify-between gap-3 px-6 py-5 border-b", incomeTheme.tableHead)}>
          <div className="flex items-center gap-3 flex-wrap">
            <div className={cn("grid size-8 place-items-center rounded-xl ring-1", incomeTheme.headerIcon)}>
              <ClipboardList className="size-4" />
            </div>
            <h3 className={cn("text-lg font-bold tracking-tight", incomeTheme.title)}>{title}</h3>
            <span className={cn("rounded-full px-3 py-1 text-xs font-semibold ring-1", incomeTheme.chip)}>
              {data.cobros} cobro{data.cobros === 1 ? "" : "s"} hoy · {pendingRows.length} pendiente{pendingRows.length === 1 ? "" : "s"}
            </span>
            {data.approvalModeEnabled && equipoEnabled && (
              <div className="flex gap-1 ml-1">
                {([
                  { id: "auto",   label: "Automático", title: "El profesional cobra desde su panel sin confirmación", activeCls: "bg-emerald-500/15 ring-emerald-400/35 text-emerald-300" },
                  { id: "manual", label: "Manual",      title: "Caja/recepción confirma y cobra cada servicio",        activeCls: "bg-blue-500/15  ring-blue-400/35  text-blue-300"  },
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
          <div className="min-w-[1080px]">
            <div className={cn("grid grid-cols-[80px_minmax(130px,0.75fr)_minmax(130px,0.75fr)_minmax(240px,1.15fr)_110px_120px_minmax(230px,1fr)_100px] items-center gap-x-3 px-6 py-3.5 text-[10px] font-semibold tracking-[0.18em] text-muted-foreground/60 border-b uppercase", incomeTheme.tableHead)}>
              <div>Fecha</div>
              <div>Cliente</div>
              <div>Profesional</div>
              <div>Servicio / catálogo</div>
              <div className="text-right">Monto</div>
              <div>Método</div>
              <div>Historial</div>
              <div>Acción</div>
            </div>

            {/* Rows */}
            {data.loading ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
                <Loader2 className="size-4 animate-spin" /> Cargando…
              </div>
            ) : !hasAnyRows ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">Sin cobros</div>
            ) : (
              <>
                {pendingRows.map((p) => {
                  const dt = new Date(p.starts_at);
                  const fecha = dt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
                  const empName = data.employees.find(e => e.id === p.employee_id)?.name ?? "—";
                  const pendingNote = getManualPendingNote(p.notes);
                  const historialEvents = getHistorialCobro(p.id);
                  // Mostrar "Cobrar" si: existe "Envió a caja" y NO existe "Cobró"
                  const envioACaja = historialEvents.some(e => e.action === "Envió a caja");
                  const yaCobro = historialEvents.some(e => e.action === "Cobró");
                  const showCobrarBtn = envioACaja && !yaCobro;

                  return (
                    <div key={`pending-${p.id}`}
                      className={cn("grid grid-cols-[80px_minmax(130px,0.75fr)_minmax(130px,0.75fr)_minmax(240px,1.15fr)_110px_120px_minmax(230px,1fr)_100px] items-center gap-x-3 px-6 py-3.5 text-xs border-b border-white/[0.055] bg-emerald-400/[0.025] transition-all duration-200 cursor-pointer", incomeTheme.rowHover)}
                      onClick={() => onCobrarPendiente(p)}
                    >
                      <div className="text-muted-foreground whitespace-nowrap">{fecha}</div>
                      <div className="text-foreground truncate">{p.client_name ?? "—"}</div>
                      <div className="text-muted-foreground truncate">{empName}</div>
                      <div className="text-muted-foreground truncate">
                        <span>{p.service_name ?? "—"}</span>
                        {pendingNote && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPendingNoteModal({
                                title: `${p.client_name ?? "Cliente"} · ${p.service_name ?? "Servicio"}`,
                                note: pendingNote,
                              });
                            }}
                            className="ml-2 rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300 ring-1 ring-sky-300/20 hover:bg-sky-400/20 transition"
                            title="Ver nota del profesional"
                          >
                            Ver nota
                          </button>
                        )}
                      </div>
                      <div className="text-foreground tabular-nums font-medium text-right">
                        ${Number(p.service_price ?? 0).toLocaleString("es-AR")}
                      </div>
                      <div className="text-muted-foreground">—</div>
                      <div><HistorialCell events={historialEvents} /></div>
                      <div onClick={e => e.stopPropagation()}>
                        {showCobrarBtn && (
                          <button
                            type="button"
                            onClick={() => onCobrarPendiente(p)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold bg-blue-300/15 text-blue-200 ring-1 ring-blue-300/30 hover:bg-blue-300/25 transition whitespace-nowrap"
                          >
                            Cobrar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {visibleRows.map((p) => {
                  const dt = new Date(p.created_at);
                  const fecha = dt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
                  const hora  = dt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
                  const paymentRecord = p as Record<string, unknown>;
                  const empName = data.employees.find(e => e.id === p.employee_id)?.name ?? "—";
                  const chargeType = getChargeType(paymentRecord);
                  const methodLabel = getPaymentMethodLabel(paymentRecord);
                  const chargedByName = getChargedByLabel(paymentRecord, empName === "—" ? null : empName, chargeType);
                  const saleDetail = getSaleDetailLabel(paymentRecord);
                  const paymentNote = getManualPendingNote(
                    ((paymentRecord.observations as string | null) ?? (paymentRecord.notes as string | null) ?? null)
                  );
                  const historialEvents = buildPaidHistorialEvents(paymentRecord, {
                    time: hora,
                    user: chargedByName,
                    action: "Cobró",
                  });

                  return (
                    <div key={p.id}
                      className="grid grid-cols-[80px_minmax(130px,0.75fr)_minmax(130px,0.75fr)_minmax(240px,1.15fr)_110px_120px_minmax(230px,1fr)_100px] items-center gap-x-3 px-6 py-3.5 text-xs border-b border-white/[0.055] last:border-0 hover:bg-white/[0.035] transition-all duration-200 group cursor-pointer"
                      onClick={() => setDetailPayment(p)}
                    >
                      <div className="text-muted-foreground whitespace-nowrap">{fecha}</div>
                      <div className="text-foreground truncate">{p.client_name ?? "—"}</div>
                      <div className="text-muted-foreground truncate">{empName}</div>
                      <div className="text-muted-foreground truncate">
                        <span>{saleDetail}</span>
                        {paymentNote && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPendingNoteModal({
                                title: `${p.client_name ?? "Cliente"} · ${saleDetail}`,
                                note: paymentNote,
                              });
                            }}
                            className="ml-2 rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300 ring-1 ring-sky-300/20 hover:bg-sky-400/20 transition"
                            title="Ver nota del profesional"
                          >
                            Ver nota
                          </button>
                        )}
                      </div>
                      <div className="text-emerald-300 tabular-nums font-bold text-right">
                        ${Number(p.total ?? p.amount ?? 0).toLocaleString("es-AR")}
                      </div>
                      <div className="text-muted-foreground truncate">{methodLabel}</div>
                      <div><HistorialCell events={historialEvents} /></div>
                      <div className="flex items-center justify-end gap-2">
                        <span className="rounded-full bg-emerald-400/12 px-2.5 py-1 text-[11px] font-bold text-emerald-300 ring-1 ring-emerald-400/18">
                          Cobrado
                        </span>
                        <span className="text-lg leading-none text-muted-foreground/70 transition group-hover:text-foreground">⋮</span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.07] flex items-center justify-between gap-3">
          {rows.length > 10 && (
            <button onClick={() => setShowAll(v => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition inline-flex items-center gap-1.5">
              <ArrowRight className={cn("size-3.5 transition", showAll && "rotate-90")} />
              {showAll ? "Mostrar menos" : `Ver ${rows.length - 10} cobros más`}
            </button>
          )}
          <button onClick={() => window.dispatchEvent(new CustomEvent("clippr:open-closeout"))}
            className="ml-auto text-xs font-semibold text-violet-300 hover:text-violet-200 inline-flex items-center gap-2 transition">
            <ClipboardList className="size-3.5" /> Ver historial completo <ArrowRight className="size-3.5" />
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

      {pendingNoteModal && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setPendingNoteModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold">Nota del profesional</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{pendingNoteModal.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setPendingNoteModal(null)}
                className="rounded-lg bg-white/5 px-3 py-1.5 text-xs transition hover:bg-white/10"
              >
                Cerrar
              </button>
            </div>
            <div className="p-5">
              <div className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">Nota guardada</p>
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{pendingNoteModal.note}</p>
              </div>
            </div>
          </div>
        </div>
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

type PendingCharge = ReturnType<typeof useCajaData>["pendingCharges"][number];

function NuevaVentaTab({
  data,
  pendingCharge = null,
  onPendingDone,
  onSaleDone,
}: {
  data: ReturnType<typeof useCajaData>;
  pendingCharge?: PendingCharge | null;
  onPendingDone?: () => void;
  onSaleDone?: () => void;
}) {
  const [step, setStep] = React.useState<1 | 2 | 3 | 4>(pendingCharge ? 3 : 1);
  const [cart, setCart] = React.useState<Record<string, number>>({});
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string>("");
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [client, setClient] = React.useState(pendingCharge?.client_name ?? "");
  const [clientSearch, setClientSearch] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [birthDate, setBirthDate] = React.useState("");
  const [employeeId, setEmployeeId] = React.useState<string>(pendingCharge?.employee_id ?? "");
  const [method, setMethod] = React.useState<PayMethod>("cash");
  const [paymentMode, setPaymentMode] = React.useState<"simple" | "multiple">("simple");
  const [received, setReceived] = React.useState("");
  const [splits, setSplits] = React.useState<MultiSplit[]>([{ method: "cash", amount: "" }]);
  const [submitting, setSubmitting] = React.useState(false);
  const [newClientOpen, setNewClientOpen] = React.useState(false);
  const [clientNotes, setClientNotes] = React.useState("");

  const { isFieldEnabled } = useClientesConfig(data.businessId ?? null);

  // When pendingCharge arrives and services are loaded, inject the service into the cart
  const pendingInjectedRef = React.useRef(false);
  React.useEffect(() => {
    if (!pendingCharge || pendingInjectedRef.current || data.services.length === 0) return;

    // Try to match by name (case-insensitive)
    const match = data.services.find(
      (s) => s.name.toLowerCase() === (pendingCharge.service_name ?? "").toLowerCase()
    );

    if (match) {
      setCart({ [match.id]: 1 });
    } else if (pendingCharge.service_name) {
      // Service not in catalogue — inject a virtual item keyed by a sentinel
      // We'll handle the amount manually via a synthetic service entry below
      // For now just leave cart empty; the service row will be shown via pendingCharge
    }

    pendingInjectedRef.current = true;
  }, [pendingCharge, data.services]);

  // If the service from pending is NOT in the catalogue we still need to show it in the cart.
  // We build a synthetic catalogue entry and inject it.
  const syntheticServiceId = pendingCharge ? `__pending__${pendingCharge.id}` : null;

  const servicesWithSynthetic = React.useMemo(() => {
    if (!pendingCharge || !syntheticServiceId) return data.services;
    const alreadyMatched = data.services.some(
      (s) => s.name.toLowerCase() === (pendingCharge.service_name ?? "").toLowerCase()
    );
    if (alreadyMatched) return data.services;
    // Inject a synthetic read-only service
    const synthetic = {
      id: syntheticServiceId,
      name: pendingCharge.service_name ?? "Servicio",
      price: Number(pendingCharge.service_price ?? 0),
      category: "Servicios",
      is_catalog: false,
      stock: null,
    } as typeof data.services[0];
    return [synthetic, ...data.services];
  }, [data.services, pendingCharge, syntheticServiceId]);

  // Inject synthetic into cart once services resolve
  React.useEffect(() => {
    if (!pendingCharge || !syntheticServiceId || pendingInjectedRef.current) return;
    if (data.services.length === 0) return; // wait for load

    const alreadyMatched = data.services.some(
      (s) => s.name.toLowerCase() === (pendingCharge.service_name ?? "").toLowerCase()
    );
    if (!alreadyMatched) {
      setCart({ [syntheticServiceId]: 1 });
    }
    pendingInjectedRef.current = true;
  }, [pendingCharge, syntheticServiceId, data.services]);

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

  const filtered = servicesWithSynthetic.filter((i) => {
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
    .map(([id, qty]) => { const svc = servicesWithSynthetic.find((s) => s.id === id); return svc ? { svc, qty } : null; })
    .filter((x): x is { svc: typeof data.services[0]; qty: number } => x !== null);

  const total = cartItems.reduce((acc, { svc, qty }) => acc + Number(svc.price) * qty, 0);
  const cartCount = cartItems.reduce((acc, { qty }) => acc + qty, 0);
  const receivedNumber = Number(received || 0);
  const change = method === "cash" && receivedNumber > total ? receivedNumber - total : 0;
  const splitsTotal = splits.reduce((s, sp) => s + Number(sp.amount || 0), 0);
  const splitsRemaining = total - splitsTotal;
  const selectedEmployee = data.employees.find((e) => e.id === employeeId);
  const hasSelectedClient = Boolean(clientId);
  const serviceSummary = cartItems.length > 0
    ? cartItems.map(({ svc, qty }) => `${svc.name}${qty > 1 ? ` x${qty}` : ""}`).join(" + ")
    : "Sin servicios";
  const canContinue = step === 1
    ? Boolean(employeeId)
    : step === 2
      ? hasSelectedClient
      : step === 3
        ? cartItems.length > 0
        : true;

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
    if (step === 2) {
      if (!clientId) { toast.error("Seleccioná un cliente para continuar."); return; }
    }
    if (step === 3 && cartItems.length === 0) { toast.error("Agregá al menos un servicio o producto."); return; }
    setStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  }

  async function saveClientIfNeeded(): Promise<string | null> {
    if (!data.businessId || !client.trim()) return clientId;
    if (clientId) return clientId;
    try {
      const { data: created, error } = await supabase
        .from("clients")
        .insert({
          business_id: data.businessId,
          full_name: client.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          birth_date: birthDate || null,
          notes: clientNotes.trim() || null,
        })
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
    if (!clientId) { toast.error("Seleccioná o creá un cliente."); setStep(2); return; }
    if (cartItems.length === 0) { toast.error("Agregá al menos un servicio."); setStep(3); return; }

    if (paymentMode === "simple") {
      if (method === "cash") {
        if (!received.trim() || Number(received) <= 0) {
          toast.error("Ingresá el monto abonado."); return;
        }
        if (Number(received) < total) {
          toast.error(`El monto abonado ($${Number(received).toLocaleString("es-AR")}) es menor al total ($${total.toLocaleString("es-AR")}).`); return;
        }
      }
    }

    if (paymentMode === "multiple") {
      if (splits.filter((s) => Number(s.amount) > 0).length < 1) {
        toast.error("Cargá al menos un monto en pago múltiple."); return;
      }
      if (Math.round(splitsTotal) !== Math.round(total)) {
        toast.error(`El pago múltiple debe sumar $${total.toLocaleString("es-AR")}. Falta/sobra $${Math.abs(splitsRemaining).toLocaleString("es-AR")}.`); return;
      }
    }

    setSubmitting(true);
    let normalSaleCompleted = false;
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

      if (pendingCharge) {
        const professionalNote = getManualPendingNote(pendingCharge.notes);

        // ── FLUJO PENDIENTE: actualizar appointment existente y registrar pago ──
        // 1. Actualizar estado del appointment a "charged" y conservar la nota sin el marcador interno
        const { error: updateError } = await supabase
          .from("appointments")
          .update({ status: "charged", notes: professionalNote || null })
          .eq("id", pendingCharge.id)
          .in("status", ["pending_payment", "pending", "confirmed", "in_service"]);

        if (updateError) throw updateError;

        // 2. Registrar el pago vinculado al appointment existente
        await registerPayment({
          businessId: data.businessId,
          employeeId: employeeId || null,
          employeeName: selectedEmployee?.name ?? null,
          commissionPct: selectedEmployee?.commission_pct ?? null,
          clientName: client.trim() || pendingCharge.client_name || "Cliente del mostrador",
          clientId: savedClientId,
          items,
          method,
          splits: validSplits,
          appointmentId: pendingCharge.id,
          sessionId: data.cashSessionId,
          chargedBy: data.profileId,
          chargeOrigin: "manual",
          notes: professionalNote || null,
        });

        // 3. Registrar en el historial del profesional que Caja/Recepción cobró el pendiente manual
        const now = new Date();
        const hhmm = now.toTimeString().slice(0, 5);
        appendHistorialCobro(pendingCharge.id, { time: hhmm, user: "Recepción", action: "Cobró" });

        // 4. Limpiar de localStorage
        removeLocalManualPendingCharge(pendingCharge.id);

        toast.success(`Cobro confirmado · $${total.toLocaleString("es-AR")}`);
        onPendingDone?.();
      } else {
        // ── FLUJO NORMAL: nueva venta desde cero ──
        await registerPayment({
          businessId: data.businessId,
          employeeId: employeeId || null,
          employeeName: selectedEmployee?.name ?? null,
          commissionPct: selectedEmployee?.commission_pct ?? null,
          clientName: client.trim() || "Cliente del mostrador",
          clientId: savedClientId,
          items,
          method,
          splits: validSplits,
          sessionId: data.cashSessionId,
          chargedBy: data.profileId,
          chargeOrigin: "caja",
        });

        toast.success(`Cobro confirmado · $${total.toLocaleString("es-AR")}`);
        setCart({}); setClientId(null); setClient(""); setClientSearch(""); setPhone(""); setEmail(""); setBirthDate(""); setClientNotes("");
        setReceived(""); setSplits([{ method: "cash", amount: "" }]); setPaymentMode("simple"); setStep(1);
        normalSaleCompleted = true;
      }

      await data.refresh();
      if (normalSaleCompleted) onSaleDone?.();
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
    <div className="max-w-3xl mx-auto w-full space-y-5">
      <Card className="p-1.5">
        <div className="grid grid-cols-4 gap-1">
          {stepItems.map((s) => {
            const active = step === s.n;
            return (
              <button key={s.n} onClick={() => {
                  if (s.n > 1 && !employeeId) { toast.error("Seleccioná un profesional."); return; }
                  if (s.n > 2 && !clientId) { toast.error("Seleccioná o creá un cliente."); return; }
                  if (s.n > 3 && cartItems.length === 0) { toast.error("Agregá al menos un servicio o producto."); return; }
                  setStep(s.n);
                }}
                className={cn("rounded-xl px-3 py-2.5 text-xs font-semibold transition-all border",
                  active ? "bg-gradient-to-b from-blue-200 to-blue-300 text-black border-blue-200"
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
                  active ? "border-blue-300/50 bg-blue-300/10" : "border-white/10 bg-white/[0.025] hover:bg-white/[0.04]")}>
                {(() => {
                  const avatarUrl = (e as { avatar_url?: string | null; photo_url?: string | null; image_url?: string | null }).avatar_url
                    || (e as { photo_url?: string | null }).photo_url
                    || (e as { image_url?: string | null }).image_url
                    || null;
                  return avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={e.name || "Profesional"}
                      className="size-9 rounded-full object-cover ring-1 ring-white/15 bg-white/[0.04]"
                    />
                  ) : (
                    <span className="size-9 rounded-full bg-gradient-to-br from-blue-200/80 to-blue-500/80 text-black font-semibold grid place-items-center">
                      {(e.name || "P").slice(0, 1).toUpperCase()}
                    </span>
                  );
                })()}
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-foreground">{e.name}</span>
                  <span className="block text-xs text-muted-foreground">Profesional</span>
                </span>
                {active ? <Check className="size-4 text-blue-200" /> : <ArrowRight className="size-4 text-muted-foreground" />}
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">

          {/* 3. Tarjeta de confirmación — siempre visible cuando hay cliente */}
          {clientId && (
            <div className="flex items-start gap-3 rounded-xl bg-emerald-500/10 border border-emerald-400/25 px-4 py-3.5">
              <div className="size-8 rounded-full bg-emerald-400/20 ring-1 ring-emerald-400/30 grid place-items-center shrink-0 mt-0.5">
                <Check className="size-4 text-emerald-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400/90 mb-0.5">Cliente seleccionado</p>
                <p className="text-sm font-semibold text-foreground truncate">{client}</p>
                <div className="flex flex-wrap gap-x-3 mt-0.5">
                  {phone && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="text-[11px]">📱</span>{phone}
                    </span>
                  )}
                  {email && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground truncate">
                      <span className="text-[11px]">✉️</span>{email}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setClientId(null); setClient(""); setPhone(""); setEmail(""); setBirthDate(""); setClientNotes(""); setNewClientOpen(false);
                  setClientSearch(""); }}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground border border-white/10 rounded-lg px-2.5 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] transition-colors mt-0.5"
              >
                Cambiar
              </button>
            </div>
          )}

          {/* 1 + 2. Buscador + resultados — solo visible si no hay cliente seleccionado */}
          {!clientId && (
            <Card className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground tracking-[0.15em] uppercase">Buscar cliente existente</p>
              <ClientAutocomplete
                value={clientSearch}
                onChange={setClientSearch}
                onPick={(c) => {
                  setClientId(c.id);
                  setClient(c.name ?? "");
                  setPhone(c.phone ?? "");
                  setEmail(c.email ?? "");
                  setBirthDate(c.birth_date ?? "");
                  setNewClientOpen(false);
                }}
                businessId={data.businessId}
              />
            </Card>
          )}

          {/* 4. Nuevo cliente — acción secundaria, oculta si ya hay cliente seleccionado */}
          {!clientId && !newClientOpen && (
            <button
              type="button"
              onClick={() => { setNewClientOpen(true); setClient(""); setClientId(null); }}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium border border-white/15 bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.07] hover:border-white/25 transition-colors"
            >
              <Plus className="size-4" />
              Nuevo cliente
            </button>
          )}

          {/* Formulario nuevo cliente */}
          {!clientId && newClientOpen && (() => {
            async function handleGuardarCliente() {
              if (!client.trim()) { toast.error("Ingresá el nombre del cliente."); return; }
              if (!phone.trim()) { toast.error("Ingresá el teléfono del cliente."); return; }
              const saved = await saveClientIfNeeded();
              if (saved) {
                setClientId(saved);
                setNewClientOpen(false);
                toast.success("Cliente guardado y seleccionado");
              } else {
                toast.error("No se pudo guardar el cliente. Revisá los datos e intentá de nuevo.");
              }
            }
            return (
              <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground tracking-[0.15em] uppercase">Nuevo cliente</p>
                  <button type="button" onClick={() => setNewClientOpen(false)}
                    className="text-xs text-muted-foreground hover:text-foreground transition">✕ Cancelar</button>
                </div>
                <input value={client} onChange={(e) => { setClient(e.target.value); setClientId(null); }}
                  placeholder="Nombre *"
                  className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-300/40" />
                <input value={phone} onChange={(e) => setPhone(e.target.value)}
                  placeholder="Teléfono *"
                  className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-300/40" />
                {isFieldEnabled("email") && (
                  <input value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email" type="email"
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-300/40" />
                )}
                {isFieldEnabled("fecha_nacimiento") && (
                  <input value={birthDate} onChange={(e) => setBirthDate(e.target.value)}
                    type="date"
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-300/40" />
                )}
                {isFieldEnabled("notas") && (
                  <input value={clientNotes} onChange={(e) => setClientNotes(e.target.value)}
                    placeholder="Notas"
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-300/40" />
                )}
                <button
                  type="button"
                  onClick={handleGuardarCliente}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold transition bg-gradient-to-r from-blue-500/90 to-violet-500/90 text-white hover:brightness-110 cash-sale-button-glow"
                >
                  Confirmar cliente
                </button>
              </Card>
            );
          })()}

        </div>
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
                  category === c ? "border-blue-300/50 bg-blue-300/10 text-blue-200"
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
          </div>
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-white/[0.03] border border-white/5">
            <button onClick={() => setPaymentMode("simple")}
              className={cn("rounded-lg py-2.5 text-sm font-semibold", paymentMode === "simple" ? "bg-blue-200 text-black" : "text-muted-foreground hover:text-foreground")}>
              Pago simple
            </button>
            <button onClick={() => setPaymentMode("multiple")}
              className={cn("rounded-lg py-2.5 text-sm font-semibold", paymentMode === "multiple" ? "bg-blue-200 text-black" : "text-muted-foreground hover:text-foreground")}>
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
                          active ? "border-blue-300/50 bg-blue-300/10 text-foreground"
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
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-300/40" />
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
                      className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-300/40" />
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
                <span className={cn("font-semibold", splitsRemaining === 0 ? "text-emerald-300" : splitsRemaining > 0 ? "text-blue-200" : "text-rose-300")}>
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
            <p className="text-sm text-foreground truncate">
              Profesional: {selectedEmployee?.name ?? "Sin profesional"} · Cliente: {clientId ? (client || "Cliente seleccionado") : "Sin cliente"}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              Servicios: {serviceSummary}
            </p>
          </div>
          <Money value={total} />
          {step < 4 ? (
            <button onClick={goNext} disabled={!canContinue}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white bg-gradient-to-b from-blue-400 to-violet-500 hover:from-blue-100 hover:to-blue-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              Continuar <ArrowRight className="size-4" />
            </button>
          ) : (
            <button disabled={!employeeId || !clientId || cartCount === 0 || submitting || (paymentMode === "multiple" && splitsRemaining !== 0)} onClick={handleCobrar}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white bg-gradient-to-b from-blue-400 to-violet-500 hover:from-blue-100 hover:to-blue-300 disabled:opacity-40 transition-all">
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
  businessId,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (c: { id: string; name: string; phone: string | null; email?: string | null; birth_date?: string | null }) => void;
  businessId: string | null;
}) {
  const q = value.trim().toLowerCase();
  const hasQuery = q.length >= 1;
  const [matches, setMatches] = React.useState<ClientLiteResult[]>([]);
  const [searching, setSearching] = React.useState(false);

  // Server-side search (debounced). Replaces filtering a fully-loaded list:
  // only the top matches are fetched, using the trigram indexes.
  React.useEffect(() => {
    if (!businessId || !hasQuery) { setMatches([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const res = await searchClientsLite(businessId, value, 8);
      if (cancelled) return;
      setMatches(res);
      setSearching(false);
      // Auto-pick a single exact phone/email match (only for longer queries).
      if (q.length >= 6) {
        const exact = res.filter(
          (c) =>
            ((c.phone ?? "").replace(/\s/g, "").toLowerCase() === q) ||
            ((c.email ?? "").toLowerCase() === q),
        );
        if (exact.length === 1) { onPick(exact[0]); }
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, businessId]);

  return (
    <div className="space-y-2">
      {/* Search input */}
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 focus-within:border-blue-300/40">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Buscar por nombre, teléfono o email..."
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
        {value && (
          <button type="button" onClick={() => onChange("")}
            className="text-muted-foreground hover:text-foreground transition shrink-0 text-xs">✕</button>
        )}
      </div>

      {/* Inline results — only shown after typing */}
      {hasQuery && (
        <div className="rounded-xl border border-white/10 bg-[oklch(0.12_0.025_282)] overflow-hidden">
          {searching ? (
            <div className="px-4 py-3 text-sm text-muted-foreground text-center">Buscando…</div>
          ) : matches.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground text-center">
              No encontramos clientes con ese dato.
            </div>
          ) : (
            <>
              <div className="px-4 py-2 border-b border-white/5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60">
                {matches.length} resultado{matches.length !== 1 ? "s" : ""}
              </div>
              {matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onPick(c); }}
                  className="w-full text-left px-4 py-2.5 hover:bg-white/[0.05] flex items-center justify-between gap-3 border-b border-white/5 last:border-0 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground truncate">{c.name}</span>
                    {c.email && <span className="block text-xs text-muted-foreground truncate">{c.email}</span>}
                  </span>
                  {c.phone && <span className="text-xs text-muted-foreground tabular-nums shrink-0">{c.phone}</span>}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
