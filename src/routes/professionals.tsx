import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo, useState, useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import {
  Zap,
  ClipboardList,
  BarChart3,
  Clock,
  DollarSign,
  ArrowRight,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { registerPayment, type PayMethod } from "@/components/cash-register/register-payment";
import { supabase } from "@/integrations/supabase/client";
import {
  useProfessionals, useProfStats, useProfPayments,
  useProfSales, useProfTurnos, useRegisterPayout,
  type ProfPayment, type ProfSale, type ProfTurno,
} from "@/hooks/use-professionals-data";
import { toast } from "sonner";

export const Route = createFileRoute("/professionals")({
  component: ProfessionalsPage,
});

type TabKey = "turnos" | "stats" | "historial" | "pagos";
type RangeKey = "hoy" | "semana" | "mes" | "custom";

function toISODate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getPresetRange(range: Exclude<RangeKey, "custom">) {
  const now = new Date();
  const today = toISODate(now);

  if (range === "hoy") return { from: today, to: today };

  if (range === "semana") {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: toISODate(monday), to: toISODate(sunday) };
  }

  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toISODate(firstDay), to: toISODate(lastDay) };
}


const COLORS = [
  { color: "from-amber-400 to-amber-600", ring: "ring-amber-400/60" },
  { color: "from-emerald-300 to-emerald-500", ring: "ring-emerald-400/60" },
  { color: "from-violet-300 to-violet-500", ring: "ring-violet-400/60" },
  { color: "from-sky-300 to-sky-500", ring: "ring-sky-400/60" },
  { color: "from-rose-300 to-rose-500", ring: "ring-rose-400/60" },
  { color: "from-amber-300 to-yellow-500", ring: "ring-yellow-400/60" },
];

function ProfessionalsPage() {
  const { businessId, profile, permissions } = useAuth();
  const { data: professionals = [], isLoading } = useProfessionals(businessId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("turnos");
  const initialRange = useMemo(() => getPresetRange("mes"), []);
  const [range, setRange] = useState<RangeKey>("mes");
  const [fromDate, setFromDate] = useState(initialRange.from);
  const [toDate, setToDate] = useState(initialRange.to);

  function applyRange(nextRange: Exclude<RangeKey, "custom">) {
    const next = getPresetRange(nextRange);
    setRange(nextRange);
    setFromDate(next.from);
    setToDate(next.to);
  }


  const profileEmployeeId = (profile as { employee_id?: string | null } | null)?.employee_id ?? null;
  const isProfessionalAccess = profile?.role === "profesional" && !!profileEmployeeId;

  const ownProfessional = useMemo(() => {
    if (!isProfessionalAccess || !profileEmployeeId) return null;
    return professionals.find((p) => p.id === profileEmployeeId) ?? null;
  }, [isProfessionalAccess, professionals, profileEmployeeId]);

  const visibleProfessionals = useMemo(
    () => (isProfessionalAccess ? (ownProfessional ? [ownProfessional] : []) : professionals),
    [isProfessionalAccess, ownProfessional, professionals],
  );

  const empId = isProfessionalAccess
    ? ownProfessional?.id ?? null
    : activeId ?? visibleProfessionals[0]?.id ?? null;

  const canOperateSelectedPanel = isProfessionalAccess && ownProfessional?.id === empId;

  // Load approval_mode from Supabase
  const [approvalMode, setApprovalMode] = useState<"auto" | "manual" | "disabled">(() => {
    if (typeof window === "undefined") return "auto";
    const saved = window.localStorage.getItem("clippr_approval_mode");
    return saved === "manual" || saved === "disabled" || saved === "auto" ? saved : "auto";
  });
  const [approvalModeEnabled, setApprovalModeEnabled] = useState(false);
  useEffect(() => {
    if (isProfessionalAccess && ownProfessional?.id && activeId !== ownProfessional.id) {
      setActiveId(ownProfessional.id);
    }
    if (!isProfessionalAccess && !activeId && visibleProfessionals[0]?.id) {
      setActiveId(visibleProfessionals[0].id);
    }
  }, [activeId, isProfessionalAccess, ownProfessional?.id, visibleProfessionals]);

  useEffect(() => {
    if (!businessId) return;
    supabase.from("business_settings").select("approval_mode,schedule").eq("business_id", businessId).maybeSingle()
      .then(({ data }) => {
        if (data?.approval_mode) {
          setApprovalMode(data.approval_mode as typeof approvalMode);
          if (typeof window !== "undefined") window.localStorage.setItem("clippr_approval_mode", data.approval_mode);
        }
        const caja = ((data?.schedule as Record<string, unknown> | null)?._caja ?? {}) as Record<string, unknown>;
        setApprovalModeEnabled(caja.approvalModeEnabled === true);
      });
  }, [businessId]);
  const active = useMemo(() => visibleProfessionals.find((p) => p.id === empId) ?? visibleProfessionals[0] ?? null, [visibleProfessionals, empId]);
  const activeColor = useMemo(() => COLORS[(visibleProfessionals.findIndex(p => p.id === empId) % COLORS.length) || 0], [visibleProfessionals, empId]);
  const initials = (active?.full_name ?? "?").split(/\s+/).map((s: string) => s[0]).slice(0, 2).join("").toUpperCase();

  if (isLoading) return (
    <AppShell><Topbar title="Profesionales" subtitle="Equipo y rendimiento" />
      <div className="glass rounded-3xl p-8 text-center text-sm text-muted-foreground animate-pulse">Cargando profesionales…</div>
    </AppShell>
  );
  if (!active) return (
    <AppShell><Topbar title="Profesionales" subtitle="Equipo y rendimiento" />
      <div className="glass rounded-3xl p-8 text-center text-sm text-muted-foreground">Sin profesionales configurados.</div>
    </AppShell>
  );

  return (
    <AppShell>
      <Topbar title="Profesionales" subtitle="Equipo y rendimiento" />
      <div className="space-y-6 animate-fade-up">
      {/* Header card */}
      <div className="glass rounded-3xl p-5 md:p-6 relative overflow-hidden">
        <div className="absolute -top-24 -left-16 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center gap-5 md:gap-6 relative">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div
              className={cn(
                "h-16 w-16 md:h-[68px] md:w-[68px] rounded-full overflow-hidden grid place-items-center text-2xl font-display font-semibold text-background bg-gradient-to-br shadow-[0_0_40px_-4px_rgba(251,191,36,0.55)] ring-1 ring-white/10",
                activeColor.color
              )}
            >
              {active.avatar_url ? (
                <img src={active.avatar_url} alt={active.full_name} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0">
              <div className="text-2xl md:text-[26px] font-display font-semibold tracking-tight leading-tight">
                {active.full_name}
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                Profesional {active.is_active === false && <span className="ml-2 rounded-full bg-white/5 ring-1 ring-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider">Inactivo</span>}
              </div>
              {permissions.equipo && approvalModeEnabled && <div className={cn(
                "mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1",
                approvalMode === "auto" && "bg-emerald-500/10 ring-emerald-400/30 text-emerald-300",
                approvalMode === "manual" && "bg-amber-500/10 ring-amber-400/30 text-amber-300",
                approvalMode === "disabled" && "bg-rose-500/10 ring-rose-400/30 text-rose-300",
              )}>
                {approvalMode === "auto" && <><Zap className="h-3 w-3 fill-emerald-300" /> Automático</>}
                {approvalMode === "manual" && <>👁 Manual</>}
                {approvalMode === "disabled" && <>🚫 Desactivado</>}
              </div>}
            </div>
          </div>

          {/* Barber selector */}
          <div className="flex items-center gap-2 flex-wrap">
            {visibleProfessionals.map((p, idx) => {
              const isActive = p.id === empId;
              const isInactive = p.is_active === false;
              const c = COLORS[idx % COLORS.length];
              const ini = (p.full_name ?? "?").split(/\s+/).map((s: string) => s[0]).slice(0,2).join("").toUpperCase();
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    if (!isProfessionalAccess) setActiveId(p.id);
                  }}
                  title={`${p.full_name ?? "Profesional"}${isInactive ? " · Inactivo" : ""}`}
                  className={cn(
                    "h-9 w-9 rounded-full overflow-hidden grid place-items-center text-[13px] font-semibold transition-all ring-1",
                    isActive
                      ? `bg-gradient-to-br ${c.color} text-background ${c.ring} ring-2 shadow-[0_0_20px_-2px_rgba(251,191,36,0.45)]`
                      : "bg-white/[0.03] text-muted-foreground ring-white/10 hover:ring-white/20",
                    isInactive && "opacity-45 grayscale",
                    isProfessionalAccess && "cursor-default"
                  )}
                  aria-label={p.full_name ?? ""}
                >
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt={p.full_name ?? "Profesional"} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    ini
                  )}
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
          { key: "stats", label: "Rendimiento", Icon: BarChart3, tint: "text-sky-300" },
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

      {profile?.role === "profesional" && !profileEmployeeId && (
        <div className="rounded-2xl px-4 py-3 text-xs ring-1 bg-amber-500/8 ring-amber-400/15 text-amber-300">
          Este acceso profesional no tiene un profesional asociado. Asignalo desde Configuración → Equipo → Accesos para ver su panel.
        </div>
      )}

      <UniversalDateFilter
        range={range}
        fromDate={fromDate}
        toDate={toDate}
        onPreset={applyRange}
        onFromChange={(value) => {
          setRange("custom");
          setFromDate(value);
        }}
        onToChange={(value) => {
          setRange("custom");
          setToDate(value);
        }}
      />

      {/* Content */}
      {tab === "turnos" && <TurnosView businessId={businessId} empId={empId} approvalMode={approvalMode} approvalModeEnabled={approvalModeEnabled} profile={profile} from={fromDate} to={toDate} canOperate={canOperateSelectedPanel} equipoEnabled={permissions.equipo} />}
      {tab === "stats" && <StatsView businessId={businessId} empId={empId} from={fromDate} to={toDate} />}
      {tab === "historial" && <HistorialView businessId={businessId} empId={empId} commissionPct={Number(active?.commission_pct ?? 0)} from={fromDate} to={toDate} />}
      {tab === "pagos" && <PagosView businessId={businessId} empId={empId} userEmail={profile?.email ?? null} from={fromDate} to={toDate} />}
      </div>
    </AppShell>
  );
}



function UniversalDateFilter({
  range,
  fromDate,
  toDate,
  onPreset,
  onFromChange,
  onToChange,
}: {
  range: RangeKey;
  fromDate: string;
  toDate: string;
  onPreset: (range: Exclude<RangeKey, "custom">) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div className="flex items-center gap-2">
        {([
          ["hoy", "Hoy"],
          ["semana", "Semana"],
          ["mes", "Mes"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onPreset(key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-xs font-medium transition ring-1",
              range === key
                ? "bg-white/10 text-foreground ring-white/20"
                : "bg-white/[0.03] text-muted-foreground ring-white/10 hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <label className="flex items-center gap-1.5">
          <span>Desde</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => onFromChange(e.target.value)}
            className="rounded-full bg-white/[0.04] ring-1 ring-white/10 px-3 py-1.5 text-foreground focus:outline-none focus:ring-white/30"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span>Hasta</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => onToChange(e.target.value)}
            className="rounded-full bg-white/[0.04] ring-1 ring-white/10 px-3 py-1.5 text-foreground focus:outline-none focus:ring-white/30"
          />
        </label>
      </div>
    </div>
  );
}


// ── Cobro modal ────────────────────────────────────────────────────────────
function CobroModal({
  turno, empId, businessId, mode, userEmail, onClose, onDone,
}: {
  turno: import("@/hooks/use-professionals-data").ProfTurno;
  empId: string; businessId: string; mode: "auto" | "manual";
  userEmail: string | null; onClose: () => void; onDone: () => void;
}) {
  const [method, setMethod] = useState<PayMethod>("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const price = Number(turno.service_price ?? 0);

  async function confirm() {
    setSaving(true);
    try {
      if (mode === "auto") {
        // Charge directly
        await registerPayment({
          businessId, employeeId: empId,
          clientName: turno.client_name ?? "Sin cliente",
          items: [{ serviceName: turno.service_name ?? "Servicio", amount: price }],
          method,
        });
        // Mark appointment as charged
        await supabase.from("appointments").update({ status: "charged" }).eq("id", turno.id);
        toast.success("✓ Cobro registrado");
      } else {
        // Manual: mark as pending approval
        await supabase.from("appointments").update({ status: "pending", notes: note || turno.notes }).eq("id", turno.id);
        toast.success("✓ Enviado a Caja para aprobación");
      }
      onDone();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-strong rounded-3xl w-full max-w-md p-6 space-y-5" onClick={e => e.stopPropagation()}>
        {/* Banner de modo */}
        <div className={cn("rounded-2xl px-4 py-3 text-sm ring-1",
          mode === "auto" ? "bg-emerald-500/10 ring-emerald-400/20 text-emerald-200" : "bg-amber-500/10 ring-amber-400/20 text-amber-200")}>
          <div className="font-semibold mb-0.5">{mode === "auto" ? "⚡ Cobro automático" : "👁 Enviar a Caja"}</div>
          <div className="text-xs opacity-75">
            {mode === "auto" ? "El cobro se registra directamente en caja." : "La recepcionista revisará y confirmará el cobro."}
          </div>
        </div>

        {/* Turno info */}
        <div>
          <div className="font-display font-semibold text-lg">{turno.client_name ?? "Sin cliente"}</div>
          <div className="text-sm text-muted-foreground">{turno.service_name ?? "—"}</div>
          {price > 0 && <div className="text-2xl font-display font-light mt-1">${price.toLocaleString("es-AR")}</div>}
        </div>

        {/* Método de pago — solo en auto */}
        {mode === "auto" && (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Método de pago</div>
            <div className="grid grid-cols-3 gap-2">
              {(["cash","transfer","card","mp","qr"] as PayMethod[]).map(m => {
                const labels: Record<PayMethod,string> = { cash:"Efectivo", transfer:"Transfer.", card:"Tarjeta", mp:"Mercado P.", qr:"QR", cuenta:"Cuenta" };
                return (
                  <button key={m} onClick={() => setMethod(m)}
                    className={cn("rounded-xl py-2 text-xs font-medium ring-1 transition-all",
                      method === m ? "bg-primary/20 ring-primary/50 text-foreground" : "bg-white/[0.03] ring-white/10 text-muted-foreground hover:ring-white/20")}>
                    {labels[m]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Nota */}
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Nota opcional…"
          className="w-full rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-white/30" />

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl ring-1 ring-white/10 py-3 text-sm text-muted-foreground hover:text-foreground transition">
            Cancelar
          </button>
          <button onClick={confirm} disabled={saving}
            className={cn("flex-1 rounded-xl py-3 text-sm font-semibold transition disabled:opacity-50",
              mode === "auto" ? "bg-gradient-to-r from-emerald-400 to-emerald-500 text-background" : "bg-gradient-to-r from-amber-300 to-amber-500 text-background")}>
            {saving ? "Guardando…" : mode === "auto" ? "Confirmar cobro" : "Enviar a Caja"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TurnosView({ businessId, empId, approvalMode, approvalModeEnabled, profile, from, to, canOperate, equipoEnabled }: {
  businessId: string | null; empId: string | null;
  approvalMode: "auto" | "manual" | "disabled";
  approvalModeEnabled: boolean;
  profile: { id: string; email?: string } | null;
  from: string;
  to: string;
  canOperate: boolean;
  equipoEnabled: boolean;
}) {
  const { data: turnos = [], isLoading, refetch } = useProfTurnos(businessId, empId, from, to);
  const [cobroTurno, setCobroTurno] = useState<import("@/hooks/use-professionals-data").ProfTurno | null>(null);

  const formatMoney = (value: number | null | undefined) =>
    value == null ? "—" : `$${Number(value).toLocaleString("es-AR")}`;

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

  const formatTime = (value: string) =>
    new Date(value).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  const statusLabel: Record<string, string> = {
    pending: "Pendiente", confirmed: "Confirmado", completed: "Completado",
    charged: "Cobrado", cancelled: "Cancelado", approved: "Aprobado",
  };
  const statusColor: Record<string, string> = {
    pending: "text-amber-300", confirmed: "text-sky-300", completed: "text-emerald-300",
    charged: "text-emerald-300", cancelled: "text-rose-300", approved: "text-violet-300",
  };

  const canShowAction = (status: string) => {
    if (!canOperate) return false;
    if (approvalMode === "disabled") return false;
    if (["charged", "cancelled"].includes(status)) return false;
    if (approvalMode === "manual" && status === "pending") return false;
    return true;
  };

  return (
    <div className="space-y-4 animate-fade-up">
      {/* Mode explanation banner */}
      {equipoEnabled && approvalModeEnabled && canOperate ? (
        <div className={cn("rounded-2xl px-4 py-3 text-xs ring-1",
          approvalMode === "auto" && "bg-emerald-500/8 ring-emerald-400/15 text-emerald-300",
          approvalMode === "manual" && "bg-amber-500/8 ring-amber-400/15 text-amber-300",
          approvalMode === "disabled" && "bg-rose-500/8 ring-rose-400/15 text-rose-300",
        )}>
          {approvalMode === "auto" && "⚡ Cobro automático — el profesional ve el botón Cobrar y al confirmar queda como Cobrado."}
          {approvalMode === "manual" && "👁 Cobro manual — el profesional ve Enviar; al enviarlo queda Pendiente hasta que Caja lo cobre."}
          {approvalMode === "disabled" && "🚫 Cobro desactivado — el profesional solo consulta turnos; Caja realiza todos los cobros."}
        </div>
      ) : (
        <div className="rounded-2xl px-4 py-3 text-xs ring-1 bg-white/[0.035] ring-white/10 text-muted-foreground inline-flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-white/30 shrink-0" /> Consulta
        </div>
      )}

      <div className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">Turnos del período</div>

      {isLoading ? (
        <div className="glass rounded-2xl py-8 text-center text-sm text-muted-foreground animate-pulse">Cargando turnos…</div>
      ) : turnos.length === 0 ? (
        <div className="glass rounded-2xl py-8 text-center text-sm text-muted-foreground">Sin turnos en este período.</div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[150px_90px_1.7fr_1.5fr_1fr_1fr_1fr_0.9fr] gap-4 px-5 py-3 border-b border-white/10 bg-white/[0.025] text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <div>Fecha</div>
            <div>Hora</div>
            <div>Cliente</div>
            <div>Servicio</div>
            <div className="text-right">Precio lista</div>
            <div className="text-right">Precio efectivo</div>
            <div>Estado</div>
            <div className="text-right">Acción</div>
          </div>

          {turnos.map((t, i) => {
            const listPrice = Number(t.service_price ?? 0);
            const cashPrice = listPrice;
            return (
              <div
                key={t.id}
                className={cn(
                  "grid grid-cols-[150px_90px_1.7fr_1.5fr_1fr_1fr_1fr_0.9fr] gap-4 items-center px-5 py-4 text-sm",
                  i < turnos.length - 1 && "border-b border-white/5"
                )}
              >
                <div className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatDate(t.starts_at)}</div>
                <div className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatTime(t.starts_at)}</div>
                <div className="font-medium truncate">{t.client_name ?? "Sin cliente"}</div>
                <div className="text-xs text-muted-foreground truncate">{t.service_name ?? "—"}</div>
                <div className="text-right font-semibold tabular-nums whitespace-nowrap">{formatMoney(listPrice)}</div>
                <div className="text-right font-semibold tabular-nums whitespace-nowrap text-emerald-300">{formatMoney(cashPrice)}</div>
                <div>
                  <span className={cn("text-[11px] font-semibold uppercase tracking-wider", statusColor[t.status] ?? "text-muted-foreground")}>
                    {statusLabel[t.status] ?? t.status}
                  </span>
                </div>
                <div className="flex justify-end">
                  {canShowAction(t.status) ? (
                    <button onClick={() => setCobroTurno(t)}
                      className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold transition ring-1 whitespace-nowrap",
                        approvalMode === "auto"
                          ? "bg-emerald-500/15 ring-emerald-400/30 text-emerald-300 hover:bg-emerald-500/25"
                          : "bg-amber-500/15 ring-amber-400/30 text-amber-300 hover:bg-amber-500/25")}>
                      {approvalMode === "auto" ? "Cobrar" : "Enviar"}
                    </button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wider">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canOperate && cobroTurno && businessId && empId && (
        <CobroModal
          turno={cobroTurno}
          empId={empId}
          businessId={businessId}
          mode={approvalMode === "manual" ? "manual" : "auto"}
          userEmail={profile?.email ?? null}
          onClose={() => setCobroTurno(null)}
          onDone={() => refetch()}
        />
      )}
    </div>
  );
}

function StatsView({
  businessId, empId, from, to,
}: {
  businessId: string | null;
  empId: string | null;
  from: string;
  to: string;
}) {
  const validFrom = from && !isNaN(new Date(from).getTime()) ? from : new Date().toISOString().slice(0,10);
  const validTo   = to   && !isNaN(new Date(to).getTime())   ? to   : new Date().toISOString().slice(0,10);
  const { data: stats } = useProfStats(businessId, empId, validFrom, validTo);
  const { data: sales = [] } = useProfSales(businessId, empId, validFrom, validTo);

  const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-AR");

  return (
    <div className="space-y-4 animate-fade-up">
      {/* KPI cards: Comisión / Pagado / Pendiente */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="glass rounded-2xl p-3.5 ring-1 ring-amber-400/20 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
            <span>💸</span> Comisión
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-muted-foreground text-sm">$</span>
            <span className="text-3xl font-display font-light tracking-tight">{stats ? stats.comision.toLocaleString("es-AR") : "—"}</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">{stats?.ventasCount ?? 0} ventas</div>
        </div>
        <div className="glass rounded-2xl p-3.5 ring-1 ring-emerald-400/30 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-emerald-400/10 blur-3xl" />
          <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
            <span>✅</span> Pagado
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-muted-foreground text-sm">$</span>
            <span className="text-3xl font-display font-light tracking-tight">{stats ? stats.pagado.toLocaleString("es-AR") : "—"}</span>
          </div>
        </div>
        <div className="glass rounded-2xl p-3.5 ring-1 ring-amber-300/20 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-amber-300/10 blur-3xl" />
          <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
            <span>⏳</span> Pendiente
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-muted-foreground text-sm">$</span>
            <span className="text-3xl font-display font-light tracking-tight">{stats ? stats.pendiente.toLocaleString("es-AR") : "—"}</span>
          </div>
          <div className="mt-1 text-[11px] text-emerald-300">{stats && stats.pendiente === 0 ? "✓ al día" : ""}</div>
        </div>
      </div>

      {/* Ingresos area chart */}
      <div className="glass rounded-2xl p-5 relative overflow-hidden">
        <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Ingresos</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-display font-light tracking-tight">{stats ? stats.facturacion.toLocaleString("es-AR") : "0"}</span>
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
  // No data yet — will be populated from real appointments once analytics are available
  return (
    <div className="glass rounded-2xl p-5 relative overflow-hidden">
      <div className="absolute -top-16 -left-16 h-56 w-56 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Servicios</div>
          <div className="mt-0.5 text-2xl font-display font-light tracking-tight">Desglose</div>
        </div>
      </div>
      <div className="mt-8 flex flex-col items-center justify-center py-8 text-center text-sm text-muted-foreground gap-2">
        <div className="h-10 w-10 rounded-full bg-white/5 ring-1 ring-white/10 grid place-items-center mb-1">
          <svg viewBox="0 0 24 24" className="h-5 w-5 opacity-40" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3v16a2 2 0 002 2h16" strokeLinecap="round"/>
            <path d="M7 16l4-4 4 4 5-5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        Sin datos aún
        <span className="text-xs opacity-60">Los datos aparecerán cuando haya turnos registrados</span>
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

function PagosView({ businessId, empId, userEmail, from, to }: { businessId: string | null; empId: string | null; userEmail: string | null; from: string; to: string }) {
  const { data: payments = [], isLoading } = useProfPayments(businessId, empId, from, to);

  return (
    <div className="space-y-4 animate-fade-up">
<div className="glass rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">Cargando…</div>
        ) : payments.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Sin pagos registrados aún.</div>
        ) : (
          payments.map((p, i) => (
            <div key={p.id} className={cn("flex items-center gap-4 px-5 py-3.5", i < payments.length - 1 && "border-b border-white/5")}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{new Date(p.date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })}</div>
                <div className="text-xs text-muted-foreground">{p.method ?? "—"}{p.note ? " · " + p.note : ""}</div>
              </div>
              <div className="text-base font-bold text-emerald-300 tabular-nums">${Number(p.amount).toLocaleString("es-AR")}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}


const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  efectivo: "Efectivo",
  transfer: "Transferencia",
  transferencia: "Transferencia",
  card: "Tarjeta",
  tarjeta: "Tarjeta",
  mercadopago: "Mercado Pago",
  mercado_pago: "Mercado Pago",
  mp: "Mercado Pago",
  cuenta_dni: "Cuenta DNI",
  cuentaDni: "Cuenta DNI",
};

function formatSaleDate(value: string) {
  const date = new Date(value);
  const day = date.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");
  const formattedDay = day.charAt(0).toUpperCase() + day.slice(1);
  const datePart = date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
  const timePart = date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return `${formattedDay} ${datePart} ${timePart}`;
}

function methodLabel(method?: string | null) {
  if (!method) return "—";
  return METHOD_LABELS[method] ?? METHOD_LABELS[method.toLowerCase()] ?? method;
}

function HistorialView({ businessId, empId, commissionPct, from, to }: { businessId: string | null; empId: string | null; commissionPct: number; from: string; to: string }) {
  const { data: sales = [], isLoading } = useProfSales(businessId, empId, from, to);

  const totalFacturado = sales.reduce((sum, sale) => sum + Number(sale.total ?? 0), 0);
  const totalComisiones = sales.reduce((sum, sale) => sum + Math.round((Number(sale.total ?? 0) * commissionPct) / 100), 0);

  return (
    <div className="glass rounded-2xl p-5 animate-fade-up">
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
        <div>
          <div className="font-medium">Historial de servicios</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>Servicios: <strong className="text-foreground">{sales.length}</strong></span>
            <span className="text-white/20">•</span>
            <span>Facturación: <strong className="text-emerald-300">${totalFacturado.toLocaleString("es-AR")}</strong></span>
            <span className="text-white/20">•</span>
            <span>Comisiones: <strong className="text-amber-300">${totalComisiones.toLocaleString("es-AR")}</strong></span>
          </div>
        </div>

</div>

      {isLoading ? (
        <div className="mt-8 mb-4 text-center text-sm text-muted-foreground animate-pulse">Cargando…</div>
      ) : sales.length === 0 ? (
        <div className="mt-8 mb-4 text-center text-sm text-muted-foreground">Sin historial en este período</div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl ring-1 ring-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/[0.035] text-[10px] uppercase tracking-[0.16em] text-muted-foreground/80">
                <th className="px-4 py-3 text-left whitespace-nowrap">Día / Hora</th>
                <th className="px-4 py-3 text-left whitespace-nowrap">Cliente</th>
                <th className="px-4 py-3 text-left whitespace-nowrap">Servicio</th>
                <th className="px-4 py-3 text-left whitespace-nowrap">Método</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Total</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Comisión</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => {
                const commission = Math.round((Number(sale.total ?? 0) * commissionPct) / 100);
                return (
                  <tr key={sale.id} className="border-t border-white/5 hover:bg-white/[0.025] transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatSaleDate(sale.created_at)}</td>
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">{sale.client_name ?? "Sin cliente"}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{sale.service_name ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-emerald-300 whitespace-nowrap">{methodLabel(sale.method)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap">${Number(sale.total ?? 0).toLocaleString("es-AR")}</td>
                    <td className="px-4 py-3 text-right text-amber-300 font-semibold tabular-nums whitespace-nowrap">${commission.toLocaleString("es-AR")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
