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
  CalendarDays,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";

const MANUAL_PENDING_KEY = "clippr_pending_manual_charges";

// ─── HISTORIAL DE COBROS ─────────────────────────────────────────────────────
// IMPORTANTE: debe ser la MISMA key que usa Professionals.
// Antes Caja usaba "clippr_cobros_historial" y Profesionales usaba
// "clippr_cobros_historial_v2". Eso hacía que Caja guardara "Cobró"
// en otro historial y la vista de Profesionales nunca lo mostrara.
const HISTORIAL_KEY = "clippr_cobros_historial_v2";
const HISTORIAL_OLD_KEY = "clippr_cobros_historial";

type HistorialEvento = {
  ts: string;
  time: string;
  user: string;
  role: "profesional" | "recepcion" | "sistema";
  action: "Envió a caja" | "Cobró" | "Canceló" | "Anuló cobro" | "Reembolsó";
};

function readHistorialStore(): Record<string, HistorialEvento[]> {
  if (typeof window === "undefined") return {};
  try {
    const current = JSON.parse(window.localStorage.getItem(HISTORIAL_KEY) || "{}") as Record<string, HistorialEvento[]>;
    const legacy = JSON.parse(window.localStorage.getItem(HISTORIAL_OLD_KEY) || "{}") as Record<string, Partial<HistorialEvento>[]>;

    // Migración suave: si hubiera eventos viejos guardados por Caja con la key anterior,
    // los pasamos a la key nueva sin pisar lo existente.
    let changed = false;
    for (const [appointmentId, events] of Object.entries(legacy)) {
      if (!events?.length) continue;
      const prev = current[appointmentId] ?? [];
      const migrated = events.map((e) => ({
        ts: e.ts ?? new Date().toISOString(),
        time: e.time ?? "--:--",
        user: e.user ?? "Recepción",
        role: e.role ?? "recepcion",
        action: e.action ?? "Cobró",
      })) as HistorialEvento[];
      const merged = [...prev];
      for (const ev of migrated) {
        const exists = merged.some((x) => x.time === ev.time && x.user === ev.user && x.action === ev.action);
        if (!exists) merged.push(ev);
      }
      if (merged.length !== prev.length) {
        current[appointmentId] = merged;
        changed = true;
      }
    }
    if (changed) window.localStorage.setItem(HISTORIAL_KEY, JSON.stringify(current));
    return current;
  } catch {
    return {};
  }
}

async function appendHistorialCobro(appointmentId: string, evento: Omit<HistorialEvento, "ts">) {
  if (typeof window === "undefined") return;

  const full: HistorialEvento = { ...evento, ts: new Date().toISOString() };

  try {
    const all = readHistorialStore();
    const prev = all[appointmentId] ?? [];

    // No reemplazar eventos. Solo evitar duplicados exactos.
    if (!prev.some((e) => e.time === full.time && e.user === full.user && e.action === full.action)) {
      const next = [...prev, full];
      all[appointmentId] = next;
      window.localStorage.setItem(HISTORIAL_KEY, JSON.stringify(all));

      // Persistir también en Supabase si existe la columna cobro_events.
      // Si no existe o falla por tipos/RLS, localStorage igual mantiene el historial local.
      try {
        await supabase
          .from("appointments")
          .update({ cobro_events: next } as Record<string, unknown>)
          .eq("id", appointmentId);
      } catch {
        // ignore
      }

      window.dispatchEvent(new CustomEvent("clippr:cobros-historial-updated"));
    }
  } catch {
    // ignore
  }
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
  return String(notes ?? "")
    .replace("[PENDIENTE_CAJA]", "")
    .trim();
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

type Tab = "resumen" | "nueva" | "precios" | "inventario" | "gastos" | "profesionales";

function CashRegisterPage() {
  const { session, loading: authLoading, permissions } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ from: "/cash-register" });
  const data = useCajaData();

  // Local override: set to true the instant the user confirms close,
  // so the UI blocks immediately without waiting for data.refresh()
  const [forcedClosed, setForcedClosed] = useState(false);
  const [closeoutOpen, setCloseoutOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(
    search.depositAppointmentId || search.appointmentId ? "nueva" : "resumen"
  );
  const [pendingToCharge, setPendingToCharge] = useState<ReturnType<typeof useCajaData>["pendingCharges"][number] | null>(null);
  const [sessionAction, setSessionAction] = useState<"opening" | "reopening" | null>(null);

  // Reset forcedClosed if caja gets reopened (cajaStatus goes back to "open")
  useEffect(() => {
    if (data.cajaStatus === "open") setForcedClosed(false);
  }, [data.cajaStatus]);

  // Open closeout modal via custom event (fired by CierreCajaBtn)
  useEffect(() => {
    const handler = () => setCloseoutOpen(true);
    window.addEventListener("clippr:open-closeout", handler);
    return () => window.removeEventListener("clippr:open-closeout", handler);
  }, []);

  useEffect(() => {
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

  async function handleOpenCaja() {
    if (!data.businessId || !data.profileId) return;
    setSessionAction("opening");
    try {
      await openCashSession({ businessId: data.businessId, openedBy: data.profileId });
      toast.success("Caja abierta");
      await data.refresh();
    } catch (e) {
      toast.error((e as Error).message || "Error al abrir la caja");
    } finally {
      setSessionAction(null);
    }
  }

  async function handleReopenCaja() {
    if (!data.businessId || !data.profileId) return;
    setSessionAction("reopening");
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: sess } = await supabase
        .from("cash_sessions")
        .select("id")
        .eq("business_id", data.businessId)
        .eq("status", "closed")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!sess?.id) throw new Error("No se encontró la sesión cerrada");
      await reopenCashSession({ sessionId: sess.id, reopenedBy: data.profileId });
      setForcedClosed(false);
      toast.success("Caja reabierta");
      await data.refresh();
    } catch (e) {
      toast.error((e as Error).message || "Error al reabrir la caja");
    } finally {
      setSessionAction(null);
    }
  }

  async function handleConfirmarCierre(totalFacturado: number, observation: string) {
    if (!data.cashSessionId || !data.profileId) return;
    try {
      await closeCashSession({
        sessionId: data.cashSessionId,
        closedBy: data.profileId,
        total: totalFacturado,
        actionType: "cierre_manual",
        observation: observation || undefined,
      });
      // Force UI to blocked state IMMEDIATELY — don't wait for data.refresh()
      setCloseoutOpen(false);
      setForcedClosed(true);
      setPendingToCharge(null);
      setTab("resumen");
      toast.success("Caja cerrada correctamente");
      // Refresh in background to sync cajaStatus from server
      data.refresh();
    } catch (e) {
      throw e;
    }
  }

  // ── AUTH GUARD ────────────────────────────────────────────────────────────
  if (authLoading || !session) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" /> Cargando…
        </div>
      </AppShell>
    );
  }

  if (data.loading) {
    return (
      <AppShell>
        <CajaHeader />
        <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" /> Cargando caja…
        </div>
      </AppShell>
    );
  }

  // ── GATE: caja cerrada ────────────────────────────────────────────────────
  // forcedClosed = confirmed close this session (instant)
  // cajaStatus from hook = persistent closed state (after refresh / on page load)
  const isClosed = forcedClosed || data.cajaStatus === "closed_today" || data.cajaStatus === "closed";
  const canReopen = forcedClosed || data.cajaStatus === "closed_today";

  if (isClosed) {
    return (
      <AppShell>
        <CajaHeader />
        <CajaClosedScreen
          canReopen={canReopen}
          onReopen={handleReopenCaja}
          sessionAction={sessionAction}
          data={data}
        />
      </AppShell>
    );
  }

  // ── GATE: sin sesión → abrir nueva jornada ────────────────────────────────
  if (data.cajaStatus === "no_session") {
    return (
      <AppShell>
        <CajaHeader />
        <CajaClosedScreen
          canReopen={false}
          onOpen={handleOpenCaja}
          sessionAction={sessionAction}
          data={data}
        />
      </AppShell>
    );
  }

  // ── CAJA ABIERTA ──────────────────────────────────────────────────────────
  return (
    <AppShell>
      <CajaHeader />
      <CajaTabs
        tab={tab}
        onChange={(t) => { if (t !== "nueva") setPendingToCharge(null); setTab(t); }}
        cajaOpen
      />
      <div className="mt-6">
        {tab === "resumen" && (
          <ResumenTab data={data} equipoEnabled={permissions.equipo} onCobrarPendiente={handleCobrarPendiente} />
        )}
        {tab === "nueva" && (
          <NuevaVentaTab
            data={data}
            pendingCharge={pendingToCharge}
            onPendingDone={() => { setPendingToCharge(null); setTab("resumen"); }}
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
      </div>
      {closeoutOpen && (
        <CloseoutModal
          data={data}
          onClose={() => setCloseoutOpen(false)}
          onConfirm={handleConfirmarCierre}
        />
      )}
    </AppShell>
  );
}

// ── Modal de cierre — vive al nivel de CashRegisterPage ───────────────────────
function CloseoutModal({
  data,
  onClose,
  onConfirm,
}: {
  data: ReturnType<typeof useCajaData>;
  onClose: () => void;
  onConfirm: (totalFacturado: number, observation: string) => Promise<void>;
}) {
  const [observation, setObservation] = React.useState("");
  const [closing, setClosing] = React.useState(false);
  const [selectedMethod, setSelectedMethod] = React.useState<string | null>(null);

  const totalCobrado = data.paymentsToday.reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
  const totalGastos = data.expensesToday.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const utilidad = totalCobrado - totalGastos;

  // Group payments by method
  const byMethod = React.useMemo(() => {
    const groups: Record<string, { method: string; ingresos: number; gastos: number; count: number }> = {};
    for (const p of data.paymentsToday) {
      const m = String(p.method ?? p.payment_method ?? "cash");
      if (!groups[m]) groups[m] = { method: m, ingresos: 0, gastos: 0, count: 0 };
      groups[m].ingresos += Number(p.total ?? p.amount ?? 0);
      groups[m].count += 1;
    }
    for (const e of data.expensesToday) {
      const m = String(e.payment_method ?? "cash");
      if (!groups[m]) groups[m] = { method: m, ingresos: 0, gastos: 0, count: 0 };
      groups[m].gastos += Number(e.amount ?? 0);
    }
    return Object.values(groups);
  }, [data.paymentsToday, data.expensesToday]);

  const now = new Date();
  const fechaLabel = now.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

  async function handleConfirm() {
    setClosing(true);
    try {
      await onConfirm(totalCobrado, observation);
    } catch (e) {
      toast.error((e as Error).message || "Error al cerrar la caja");
      setClosing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[oklch(0.10_0.03_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">Cierre de caja</h3>
            <p className="text-xs text-muted-foreground mt-0.5 capitalize">{fechaLabel}</p>
          </div>
          <button
            onClick={onClose}
            disabled={closing}
            className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition disabled:opacity-40"
          >
            Cancelar
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {/* Totales */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "COBRADO", value: totalCobrado, color: "text-emerald-300" },
              { label: "GASTOS",  value: totalGastos,  color: "text-rose-300"    },
              { label: "UTILIDAD",value: utilidad,     color: utilidad >= 0 ? "text-emerald-300" : "text-rose-300" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] px-4 py-3 text-center">
                <p className="text-[10px] tracking-[0.16em] text-muted-foreground/60 uppercase mb-1">{s.label}</p>
                <p className={cn("text-xl font-semibold tabular-nums font-display", s.color)}>
                  ${s.value.toLocaleString("es-AR")}
                </p>
              </div>
            ))}
          </div>

          {/* Tabla por método */}
          {byMethod.length > 0 && (
            <div className="rounded-xl overflow-hidden ring-1 ring-white/[0.06]">
              <div className="grid grid-cols-4 px-4 py-2 text-[10px] tracking-[0.14em] text-muted-foreground/60 uppercase border-b border-white/5">
                <span>Método</span>
                <span className="text-right">Ingresos</span>
                <span className="text-right">Gastos</span>
                <span className="text-right">Utilidad</span>
              </div>
              {byMethod.map((row) => {
                const method = row.method as PayMethod;
                const util = row.ingresos - row.gastos;
                return (
                  <div key={row.method} className="grid grid-cols-4 px-4 py-2.5 text-sm border-b border-white/5 last:border-0">
                    <span className="text-foreground">{PAY_METHOD_LABEL[method] ?? row.method}</span>
                    <span className="text-right text-emerald-300 tabular-nums">
                      {row.ingresos > 0 ? `$${row.ingresos.toLocaleString("es-AR")}` : "$0"}
                    </span>
                    <span className="text-right text-rose-300 tabular-nums">
                      {row.gastos > 0 ? `$${row.gastos.toLocaleString("es-AR")}` : "$0"}
                    </span>
                    <span className={cn("text-right tabular-nums", util >= 0 ? "text-emerald-300" : "text-rose-300")}>
                      {util >= 0 ? `$${util.toLocaleString("es-AR")}` : `$-${Math.abs(util).toLocaleString("es-AR")}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Observación */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Observación opcional</label>
            <textarea
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              placeholder="Novedades del día, diferencias, etc."
              rows={2}
              className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-amber-300/30 resize-none"
            />
          </div>

          {/* Confirm button */}
          <button
            onClick={handleConfirm}
            disabled={closing}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold bg-gradient-to-r from-amber-300 to-amber-500 text-black hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {closing ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {closing ? "Cerrando…" : "Confirmar cierre"}
          </button>
        </div>
      </div>
    </div>
  );
}


function CajaClosedScreen({
  canReopen,
  onReopen,
  onOpen,
  sessionAction,
  data,
}: {
  canReopen: boolean;
  onReopen?: () => void;
  onOpen?: () => void;
  sessionAction: "opening" | "reopening" | null;
  data: ReturnType<typeof useCajaData>;
}) {
  const isClosedToday = canReopen;

  // Summary stats (read-only)
  const totalCobrado = data.paymentsToday.reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
  const cobros = data.paymentsToday.length;
  const gastos = data.expensesToday.reduce((s, e) => s + Number(e.amount ?? 0), 0);

  return (
    <div className="mt-6 space-y-5">
      {/* Estado banner */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] backdrop-blur-xl px-6 py-5 flex items-center gap-5">
        <div className={cn(
          "h-14 w-14 rounded-2xl grid place-items-center shrink-0",
          isClosedToday
            ? "bg-rose-500/10 border border-rose-400/20"
            : "bg-amber-400/10 border border-amber-400/20"
        )}>
          {isClosedToday
            ? <LockKeyhole className="size-6 text-rose-300" />
            : <CalendarDays className="size-6 text-amber-300" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-foreground">
            {isClosedToday ? "Caja cerrada" : "Nueva jornada"}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isClosedToday
              ? "La caja de hoy ya fue cerrada. Podés reabrirla hasta las 00:00."
              : "La caja no está abierta. Abrila para comenzar a operar."
            }
          </p>
        </div>
        <div className="shrink-0">
          {isClosedToday ? (
            <button
              onClick={onReopen}
              disabled={sessionAction !== null}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold bg-white/[0.07] border border-white/10 hover:bg-white/[0.12] transition-all text-foreground disabled:opacity-50"
            >
              {sessionAction === "reopening"
                ? <Loader2 className="size-4 animate-spin" />
                : <RefreshCw className="size-4" />}
              Reabrir caja
            </button>
          ) : (
            <button
              onClick={onOpen}
              disabled={sessionAction !== null}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold bg-gradient-to-r from-amber-300/90 to-amber-500/90 text-black hover:brightness-110 transition-all disabled:opacity-50"
            >
              {sessionAction === "opening"
                ? <Loader2 className="size-4 animate-spin" />
                : <Unlock className="size-4" />}
              Abrir caja
            </button>
          )}
        </div>
      </div>

      {/* Resumen de solo lectura (solo si hay datos del día) */}
      {isClosedToday && cobros > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Total cobrado", value: `$${totalCobrado.toLocaleString("es-AR")}`, tint: "from-amber-400/20 to-amber-500/0" },
            { label: "Cobros", value: cobros.toString(), tint: "from-sky-400/25 to-sky-500/0" },
            { label: "Gastos", value: `$${gastos.toLocaleString("es-AR")}`, tint: "from-rose-400/25 to-rose-500/0" },
          ].map((s) => (
            <div key={s.label} className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025] backdrop-blur-xl p-4">
              <div className={cn("pointer-events-none absolute -top-14 -right-10 size-32 rounded-full blur-3xl opacity-50 bg-gradient-to-br", s.tint)} />
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-foreground">{s.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CajaHeader() {
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

const TABS_DEF: { id: Tab; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "precios", label: "Precios" },
  { id: "inventario", label: "Inventario" },
  { id: "profesionales", label: "Liquidaciones" },
];

function CajaTabs({ tab, onChange, cajaOpen }: { tab: Tab; onChange: (t: Tab) => void; cajaOpen: boolean }) {
  return (
    <div className="mt-6 flex items-end justify-between gap-3 border-b border-white/5">
      <div className="flex gap-1 overflow-x-auto -mb-px flex-1 min-w-0">
        {TABS_DEF.map((t) => {
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
      {/* Action buttons — only visible on resumen AND only when caja is open */}
      {tab === "resumen" && cajaOpen && (
        <div className="shrink-0 mb-2 flex items-center gap-2">
          <button
            onClick={() => onChange("gastos")}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all bg-white/[0.04] text-foreground border border-white/10 hover:bg-white/[0.07]"
          >
            <span className="text-base leading-none">＋</span> Nuevo gasto
          </button>
          <button
            onClick={() => onChange("nueva")}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all bg-gradient-to-r from-amber-300/90 to-amber-500/90 text-black hover:brightness-110 shadow-[0_8px_24px_-10px_oklch(0.78_0.17_65/0.55)]"
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
function ResumenTab({
  data,
  equipoEnabled,
  onCobrarPendiente,
}: {
  data: ReturnType<typeof useCajaData>;
  equipoEnabled: boolean;
  onCobrarPendiente: (appt: ReturnType<typeof useCajaData>["pendingCharges"][number]) => void;
}) {
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
      sub: "",
      icon: Wallet,
      tint: "from-amber-400/20 to-amber-500/0",
      money: true,
    },
    {
      label: "Pendiente",
      value: data.pendingAmount,
      sub: "",
      icon: Clock,
      tint: "from-violet-400/25 to-violet-500/0",
      money: true,
    },
    {
      label: "Cobros",
      value: data.cobros,
      sub: "",
      icon: ClipboardList,
      tint: "from-sky-400/25 to-sky-500/0",
      money: false,
    },
    {
      label: "Clientes",
      value: data.cobros,
      sub: "",
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
                {s.sub && <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{s.sub}</p>}
              </div>
              <div className="rounded-xl bg-white/[0.04] border border-white/5 p-2">
                <s.icon className="size-3.5 text-foreground/80" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <History data={data} equipoEnabled={equipoEnabled} onCobrarPendiente={onCobrarPendiente} />
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
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("clippr:open-closeout"))}
      className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all bg-white/[0.04] text-foreground border border-white/10 hover:bg-white/[0.07]"
    >
      <LockKeyhole className="size-3.5" /> Cierre de caja
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
  pending_payment: { label: "Pendiente", dot: "bg-amber-400" },
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
              <Row label="Descuento aplicado" value={<span className="text-amber-300">−${discount.toLocaleString("es-AR")}</span>} />
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

function History({ data, equipoEnabled, onCobrarPendiente }: { data: ReturnType<typeof useCajaData>; equipoEnabled: boolean; onCobrarPendiente: (appt: ReturnType<typeof useCajaData>["pendingCharges"][number]) => void }) {
  const rows = data.paymentsToday;
  const pendingRows = data.pendingCharges;
  const [selectedMethod, setSelectedMethod] = React.useState<string | null>(null);
  const [detailPayment, setDetailPayment] = React.useState<typeof rows[number] | null>(null);
  const [pendingNoteModal, setPendingNoteModal] = React.useState<{ title: string; note: string } | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  const visibleRows = showAll ? rows : rows.slice(0, 10);
  const hasAnyRows = pendingRows.length > 0 || visibleRows.length > 0;

  return (
    <>
      <Card>
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">Cobros</h3>
            <span className="text-[11px] text-muted-foreground">
{data.cobros} cobro{data.cobros === 1 ? "" : "s"} hoy · {pendingRows.length} pendiente{pendingRows.length === 1 ? "" : "s"}
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
          <div className="min-w-[1180px]">
            <div className="grid grid-cols-[55px_105px_minmax(130px,0.8fr)_minmax(115px,0.75fr)_minmax(220px,1.25fr)_95px_90px_90px_100px_90px_85px] items-center gap-x-3 px-5 py-3 text-[10px] tracking-[0.16em] text-muted-foreground/60 border-b border-white/5 uppercase">
              <div>Fecha</div>
              <div>Hora</div>
              <div>Cliente</div>
              <div>Profesional</div>
              <div>Servicio / catálogo</div>
              <div className="text-right">Total</div>
              <div>Método</div>
              <div>Origen</div>
              <div>Cobrado por</div>
              <div>Estado</div>
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
                  const hora  = dt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
                  const empName = data.employees.find(e => e.id === p.employee_id)?.name ?? "—";
                  const pendingNote = getManualPendingNote(p.notes);

                  return (
                    <div key={`pending-${p.id}`}
                      className="grid grid-cols-[55px_105px_minmax(130px,0.8fr)_minmax(115px,0.75fr)_minmax(220px,1.25fr)_95px_90px_90px_100px_90px_85px] items-center gap-x-3 px-5 py-3 text-xs border-b border-white/5 bg-amber-400/[0.035]"
                    >
                      <div className="text-muted-foreground whitespace-nowrap">{fecha}</div>
                      <div className="text-muted-foreground whitespace-nowrap">{hora}</div>
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
                      <div><ChargeTypePill type="manual" /></div>
                      <div className="text-muted-foreground truncate">—</div>
                      <div className="flex items-center gap-1.5">
                        <StatusPill status="pendiente" />
                      </div>
                      <div>
                        <button
                          type="button"
                          onClick={() => onCobrarPendiente(p)}
                          className="rounded-lg bg-amber-300/90 px-3 py-1.5 text-[11px] font-bold text-black hover:bg-amber-200 transition"
                        >
                          Cobrar
                        </button>
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
                  const status = paymentRecord.status as string | null ?? "cobrado";
                  const chargeType = getChargeType(paymentRecord);
                  const methodLabel = getPaymentMethodLabel(paymentRecord);
                  const chargedByName = getChargedByLabel(paymentRecord, empName === "—" ? null : empName, chargeType);
                  const saleDetail = getSaleDetailLabel(paymentRecord);
                  const paymentNote = getManualPendingNote(
                    ((paymentRecord.observations as string | null) ?? (paymentRecord.notes as string | null) ?? null)
                  );

                  return (
                    <div key={p.id}
                      className="grid grid-cols-[55px_105px_minmax(130px,0.8fr)_minmax(115px,0.75fr)_minmax(220px,1.25fr)_95px_90px_90px_100px_90px_85px] items-center gap-x-3 px-5 py-3 text-xs border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition group cursor-pointer"
                      onClick={() => setDetailPayment(p)}
                    >
                      <div className="text-muted-foreground whitespace-nowrap">{fecha}</div>
                      <div className="text-muted-foreground whitespace-nowrap">{hora}</div>
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
                      <div className="text-foreground tabular-nums font-medium text-right">
                        ${Number(p.total ?? p.amount ?? 0).toLocaleString("es-AR")}
                      </div>
                      <div className="text-muted-foreground truncate">{methodLabel}</div>
                      <div><ChargeTypePill type={chargeType} /></div>
                      <div className="text-muted-foreground truncate">{chargedByName}</div>
                      <div className="flex items-center gap-1.5">
                        <StatusPill status={status} />
                      </div>
                      <div className="text-muted-foreground">—</div>
                    </div>
                  );
                })}
              </>
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

      {/* Closeout modal removed — now rendered by CashRegisterPage */}
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
}: {
  data: ReturnType<typeof useCajaData>;
  pendingCharge?: PendingCharge | null;
  onPendingDone?: () => void;
}) {
  const [step, setStep] = React.useState<1 | 2 | 3 | 4>(pendingCharge ? 3 : 1);
  const [cart, setCart] = React.useState<Record<string, number>>({});
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string>("");
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [client, setClient] = React.useState(pendingCharge?.client_name ?? "");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [birthDate, setBirthDate] = React.useState("");
  const [employeeId, setEmployeeId] = React.useState<string>(pendingCharge?.employee_id ?? "");
  const [method, setMethod] = React.useState<PayMethod>("cash");
  const [paymentMode, setPaymentMode] = React.useState<"simple" | "multiple">("simple");
  const [received, setReceived] = React.useState("");
  const [splits, setSplits] = React.useState<MultiSplit[]>([{ method: "cash", amount: "" }]);
  const [submitting, setSubmitting] = React.useState(false);

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
        await appendHistorialCobro(pendingCharge.id, { time: hhmm, user: "Recepción", role: "recepcion", action: "Cobró" });

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
        setCart({}); setClientId(null); setClient(""); setPhone(""); setEmail(""); setBirthDate("");
        setReceived(""); setSplits([{ method: "cash", amount: "" }]); setPaymentMode("simple"); setStep(1);
      }

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
      {pendingCharge && (
        <Card className="px-5 py-3 flex items-center gap-3 border-amber-300/30 bg-amber-300/[0.06]">
          <Clock className="size-4 text-amber-300 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-200">Continuando cobro pendiente</p>
            <p className="text-xs text-muted-foreground truncate">
              {pendingCharge.client_name ?? "Sin cliente"} · {pendingCharge.service_name ?? "Servicio"} · ${Number(pendingCharge.service_price ?? 0).toLocaleString("es-AR")}
            </p>
            {getManualPendingNote(pendingCharge.notes) && (
              <p className="mt-1 text-xs text-amber-100/90 truncate">
                Nota del profesional: {getManualPendingNote(pendingCharge.notes)}
              </p>
            )}
          </div>
          <button
            onClick={() => onPendingDone?.()}
            className="text-xs text-muted-foreground hover:text-foreground transition shrink-0"
          >
            Cancelar
          </button>
        </Card>
      )}
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
