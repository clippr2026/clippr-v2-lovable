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
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { registerPayment, type PayMethod } from "@/components/cash-register/register-payment";
import { supabase } from "@/integrations/supabase/client";
import {
  useProfessionals, useProfStats, useProfPayments,
  useProfSales, useProfTurnos, useRegisterPayout,
  type ProfPayment, type ProfTurno,
} from "@/hooks/use-professionals-data";
import { toast } from "sonner";

export const Route = createFileRoute("/professionals")({
  component: ProfessionalsPage,
});

type TabKey = "turnos" | "stats" | "historial-servicios" | "historial-pagos";
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



const MANUAL_PENDING_KEY = "clippr_pending_manual_charges";

type ManualPendingCharge = {
  id: string;
  business_id: string;
  employee_id: string | null;
  client_name: string | null;
  service_name: string | null;
  service_price: number | null;
  starts_at: string;
  notes?: string | null;
};

function readManualPendingCharges(): ManualPendingCharge[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(MANUAL_PENDING_KEY) || "[]") as ManualPendingCharge[];
  } catch {
    return [];
  }
}

function saveManualPendingCharge(charge: ManualPendingCharge) {
  if (typeof window === "undefined") return;
  const current = readManualPendingCharges();
  const next = [charge, ...current.filter((item) => item.id !== charge.id)];
  window.localStorage.setItem(MANUAL_PENDING_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("clippr:manual-pending-updated"));
}

// ─── HISTORIAL DE COBROS ─────────────────────────────────────────────────────
// Eventos persistidos en appointments.cobro_events (JSONB array en Supabase).
// localStorage actúa únicamente como caché para la sesión actual.
// NUNCA se recalcula desde payment_status ni desde el modo de cobro actual.

const HISTORIAL_LS_KEY = "clippr_cobros_historial_v2";

type HistorialEvento = {
  ts: string;        // ISO timestamp completo — fuente de verdad
  time: string;      // HH:MM — display
  user: string;      // nombre corto del usuario
  role: "profesional" | "recepcion" | "sistema";
  action: "Envió a caja" | "Cobró" | "Canceló" | "Anuló cobro" | "Reembolsó";
};

// ── Lectura: Supabase primero, localStorage como cache ────────────────────────
function readHistorialLS(appointmentId: string): HistorialEvento[] {
  if (typeof window === "undefined") return [];
  try {
    const all = JSON.parse(window.localStorage.getItem(HISTORIAL_LS_KEY) || "{}") as Record<string, HistorialEvento[]>;
    return all[appointmentId] ?? [];
  } catch { return []; }
}

function writeHistorialLS(appointmentId: string, events: HistorialEvento[]) {
  if (typeof window === "undefined") return;
  try {
    const all = JSON.parse(window.localStorage.getItem(HISTORIAL_LS_KEY) || "{}") as Record<string, HistorialEvento[]>;
    all[appointmentId] = events;
    window.localStorage.setItem(HISTORIAL_LS_KEY, JSON.stringify(all));
  } catch { /* silently fail */ }
}

// Lee los eventos del turno. Cache local tiene prioridad en misma sesión.
function readHistorialCobro(appointmentId: string): HistorialEvento[] {
  return readHistorialLS(appointmentId).sort((a, b) => {
    const at = a.ts ? new Date(a.ts).getTime() : 0;
    const bt = b.ts ? new Date(b.ts).getTime() : 0;
    return at - bt;
  });
}

// Agrega un evento — escribe a localStorage inmediatamente y persiste a Supabase.
// NUNCA modifica eventos anteriores.
async function appendHistorialCobro(
  appointmentId: string,
  evento: Omit<HistorialEvento, "ts">
) {
  const full: HistorialEvento = { ...evento, ts: new Date().toISOString() };

  // 1. Leer estado local actual
  const prev = readHistorialLS(appointmentId);

  // Deduplicar: no agregar si ya existe el mismo (action + time iguales)
  if (prev.some(e => e.time === full.time && e.action === full.action)) return;

  const next = [...prev, full];

  // 2. Escribir a localStorage de inmediato (UI reactiva sin esperar red)
  writeHistorialLS(appointmentId, next);

  // 3. Persistir a Supabase (cobro_events es columna JSONB en appointments)
  try {
    await supabase
      .from("appointments")
      .update({ cobro_events: next } as Record<string, unknown>)
      .eq("id", appointmentId);
  } catch {
    // Columna puede no existir aún — el localStorage tiene los datos seguros
  }
}

// Cuando se carga la vista, sincronizar Supabase → localStorage para cada turno
// Esto cubre el caso de que otro dispositivo haya escrito eventos
async function syncHistorialFromDB(appointmentIds: string[]): Promise<void> {
  if (!appointmentIds.length) return;
  try {
    const { data } = await supabase
      .from("appointments")
      .select("id, cobro_events")
      .in("id", appointmentIds);

    for (const row of data ?? []) {
      const dbEvents = row.cobro_events as HistorialEvento[] | null;
      if (!dbEvents?.length) continue;
      const local = readHistorialLS(row.id);
      // Merge: usar el que tenga más eventos
      if (dbEvents.length > local.length) {
        writeHistorialLS(row.id, dbEvents);
      }
    }
  } catch { /* red no disponible — local sigue siendo válido */ }
}

function shortName(email: string | null | undefined): string {
  if (!email) return "Sistema";
  const local = email.split("@")[0];
  return local.split(/[._-]/)[0].charAt(0).toUpperCase() + local.split(/[._-]/)[0].slice(1);
}


const COLORS = [
  { color: "from-cyan-400 to-cyan-600", ring: "ring-cyan-400/60" },
  { color: "from-emerald-300 to-emerald-500", ring: "ring-emerald-400/60" },
  { color: "from-violet-300 to-violet-500", ring: "ring-violet-400/60" },
  { color: "from-sky-300 to-sky-500", ring: "ring-sky-400/60" },
  { color: "from-rose-300 to-rose-500", ring: "ring-rose-400/60" },
  { color: "from-cyan-300 to-cyan-500", ring: "ring-cyan-400/60" },
];

function ProfessionalsPage() {
  const { businessId, profile, permissions } = useAuth();
  const { data: professionals = [], isLoading } = useProfessionals(businessId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("turnos");
  // Always start on "hoy" — never remember last session's range
  const initialToday = useMemo(() => getPresetRange("hoy"), []);
  const [range, setRange] = useState<RangeKey>("hoy");
  const [fromDate, setFromDate] = useState(initialToday.from);
  const [toDate, setToDate] = useState(initialToday.to);

  function applyRange(nextRange: Exclude<RangeKey, "custom">) {
    const next = getPresetRange(nextRange);
    setRange(nextRange);
    setFromDate(next.from);
    setToDate(next.to);
  }


  const profileEmployeeId = (profile as { employee_id?: string | null } | null)?.employee_id ?? null;
  const isProfessional = profile?.role === "profesional";
  const isProfessionalAccess = isProfessional && !!profileEmployeeId;

  const ownProfessional = useMemo(() => {
    if (!isProfessionalAccess || !profileEmployeeId) return null;
    return professionals.find((p) => p.id === profileEmployeeId) ?? null;
  }, [isProfessionalAccess, professionals, profileEmployeeId]);

  // Un profesional SOLO ve su propio perfil (vacío si no tiene uno vinculado).
  // Nunca la lista completa.
  const visibleProfessionals = useMemo(
    () => (isProfessional ? (ownProfessional ? [ownProfessional] : []) : professionals),
    [isProfessional, ownProfessional, professionals],
  );

  const empId = isProfessional
    ? ownProfessional?.id ?? null
    : activeId ?? visibleProfessionals[0]?.id ?? null;

  useEffect(() => {
    if (profile?.role !== "profesional") return;
    console.log(
      "[link] panel profesional →",
      "profile.employee_id:", profileEmployeeId,
      "| employees cargados:", professionals.map((p) => p.id),
      "| employee encontrado:", ownProfessional?.id ?? "NINGUNO (no hay match)",
    );
  }, [profile?.role, profileEmployeeId, professionals, ownProfessional]);

  const canOperateSelectedPanel = !!empId && (
    isProfessionalAccess ? ownProfessional?.id === empId : true
  );

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
    if (!isProfessional && !activeId && visibleProfessionals[0]?.id) {
      setActiveId(visibleProfessionals[0].id);
    }
  }, [activeId, isProfessional, isProfessionalAccess, ownProfessional?.id, visibleProfessionals]);

  // Reset date filter to "hoy" whenever the active professional changes
  const prevEmpIdRef = React.useRef<string | null>(null);
  useEffect(() => {
    const currentEmpId = empId;
    if (prevEmpIdRef.current !== null && prevEmpIdRef.current !== currentEmpId) {
      const today = getPresetRange("hoy");
      setRange("hoy");
      setFromDate(today.from);
      setToDate(today.to);
    }
    prevEmpIdRef.current = currentEmpId;
  }, [empId]);

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
        <div className="absolute -top-24 -left-16 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
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
                {active.role_label?.trim() || "Profesional"} {active.is_active === false && <span className="ml-2 rounded-full bg-white/5 ring-1 ring-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider">Inactivo</span>}
              </div>
              {permissions.equipo && approvalModeEnabled && <div className={cn(
                "mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1",
                approvalMode === "auto" && "bg-emerald-500/10 ring-emerald-400/30 text-emerald-300",
                approvalMode === "manual" && "bg-cyan-500/10 ring-cyan-400/30 text-cyan-300",
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
                    if (!isProfessional) setActiveId(p.id);
                  }}
                  title={`${p.full_name ?? "Profesional"}${isInactive ? " · Inactivo" : ""}`}
                  className={cn(
                    "h-9 w-9 rounded-full overflow-hidden grid place-items-center text-[13px] font-semibold transition-all ring-1",
                    isActive
                      ? `bg-gradient-to-br ${c.color} text-background ${c.ring} ring-2 shadow-[0_0_20px_-2px_rgba(251,191,36,0.45)]`
                      : "bg-white/[0.03] text-muted-foreground ring-white/10 hover:ring-white/20",
                    isInactive && "opacity-45 grayscale",
                    isProfessional && "cursor-default"
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
          { key: "turnos",             label: "Mi Agenda",             Icon: ClipboardList, tint: "text-cyan-300" },
          { key: "stats",              label: "Rendimiento",           Icon: BarChart3,     tint: "text-sky-300"   },
          { key: "historial-servicios",label: "Historial de ventas",   Icon: Clock,         tint: "text-violet-300"},
          { key: "historial-pagos",    label: "Historial de pagos",    Icon: DollarSign,    tint: "text-emerald-300"},
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
        <div className="rounded-2xl px-4 py-3 text-xs ring-1 bg-cyan-500/8 ring-cyan-400/15 text-cyan-300">
          Este acceso profesional no tiene un profesional asociado. Asignalo desde Configuración → Equipo → Accesos para ver su panel.
        </div>
      )}

      {/* Date filter — hidden on Mi Agenda (it has its own day-strip nav) */}
      {tab !== "turnos" && (
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
      )}

      {/* Content */}
      {tab === "turnos" && <TurnosView businessId={businessId} empId={empId} approvalMode={approvalMode} approvalModeEnabled={approvalModeEnabled} profile={profile} canOperate={canOperateSelectedPanel} equipoEnabled={approvalModeEnabled} />}
      {tab === "stats" && <StatsView businessId={businessId} empId={empId} from={fromDate} to={toDate} />}
      {tab === "historial-servicios" && <HistorialView businessId={businessId} empId={empId} commissionPct={Number(active?.commission_pct ?? 0)} from={fromDate} to={toDate} />}
      {tab === "historial-pagos" && <PagosView businessId={businessId} empId={empId} userEmail={profile?.email ?? null} from={fromDate} to={toDate} />}
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

type LineItem = { id: string; name: string; amount: number };
type SplitEntry = { method: PayMethod; amount: string };

const PAY_LABELS: Record<PayMethod, string> = {
  cash: "Efectivo", transfer: "Transfer.", card: "Tarjeta",
  mp: "Mercado P.", qr: "QR", cuenta: "Cuenta",
};
const ALL_METHODS: PayMethod[] = ["cash", "transfer", "card", "mp", "qr"];

function fmtMoney(n: number) {
  return "$" + Math.round(n).toLocaleString("es-AR");
}

// ── Inline item editor ─────────────────────────────────────────────────────
// The item row itself becomes the search field — no separate buscador above.
function ItemPicker({
  businessId, currentName, currentAmount,
  onSelect, onClose,
}: {
  businessId: string;
  currentName: string; currentAmount: string;
  onSelect: (name: string, amount: number) => void;
  onClose: () => void;
}) {
  // Start with current name so the field is pre-filled, ready to edit
  const [query, setQuery] = useState(currentName);
  const [editAmount, setEditAmount] = useState(currentAmount);
  const [options, setOptions] = useState<{ id: string; name: string; price: number }[]>([]);
  const [selected, setSelected] = useState<{ name: string; price: number } | null>(
    currentName ? { name: currentName, price: Number(currentAmount) || 0 } : null
  );
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!businessId) return;
    (async () => {
      const [{ data: svcs }, { data: prods }] = await Promise.all([
        supabase.from("price_catalog").select("id,name,price").eq("business_id", businessId).eq("active", true).not("duration_min", "is", null).order("name"),
        supabase.from("price_catalog").select("id,name,price").eq("business_id", businessId).eq("active", true).is("duration_min", null).order("name"),
      ]);
      setOptions([
        ...(svcs ?? []).map(s => ({ id: s.id, name: s.name as string, price: Number(s.price ?? 0) })),
        ...(prods ?? []).map(p => ({ id: p.id, name: p.name as string, price: Number(p.price ?? 0) })),
      ]);
    })();
  }, [businessId]);

  React.useEffect(() => {
    // Auto-focus and select all text so user can type immediately
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const filtered = query.trim()
    ? options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    : options.slice(0, 8);

  function pick(opt: { name: string; price: number }) {
    setSelected(opt);
    setQuery(opt.name);
    setEditAmount(String(opt.price));
    setShowDropdown(false);
  }

  const canSave = selected !== null;

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/[0.06] p-3 space-y-2">
      {/* The item name IS the search field */}
      <div className="relative">
        <input
          ref={inputRef}
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setSelected(null);        // deselect while typing
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          placeholder="Buscar servicio o producto…"
          className="w-full rounded-xl bg-white/[0.07] ring-1 ring-primary/30 px-3 py-2.5 text-sm font-medium text-white focus:outline-none focus:ring-primary/50 placeholder:font-normal placeholder:text-muted-foreground/60"
        />
        {query && (
          <button type="button"
            onClick={() => { setQuery(""); setSelected(null); setShowDropdown(true); inputRef.current?.focus(); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white text-xs w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/10 transition">
            ✕
          </button>
        )}
      </div>

      {/* Dropdown — only while searching (no selection yet or explicitly opened) */}
      {showDropdown && filtered.length > 0 && (
        <div className="rounded-xl bg-[#0d0d14] border border-white/10 max-h-40 overflow-y-auto divide-y divide-white/[0.05] shadow-xl">
          {filtered.slice(0, 10).map(opt => (
            <button key={opt.id} type="button"
              onMouseDown={e => e.preventDefault()} // prevent blur before click
              onClick={() => pick(opt)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-white/[0.06] transition text-left gap-3">
              <span className="truncate">{opt.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">{fmtMoney(opt.price)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Price edit — shown after selection */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <input
          type="text" inputMode="numeric"
          value={editAmount}
          onChange={e => setEditAmount(e.target.value.replace(/\D/g, ""))}
          placeholder="0"
          className="w-full rounded-xl bg-white/[0.04] ring-1 ring-white/10 pl-6 pr-3 py-2.5 text-sm tabular-nums text-white focus:outline-none focus:ring-primary/40"
        />
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={onClose}
          className="flex-1 rounded-xl ring-1 ring-white/10 py-2 text-xs text-muted-foreground hover:text-white transition">
          Cancelar
        </button>
        <button type="button" disabled={!canSave}
          onClick={() => canSave && onSelect(selected!.name, Math.max(0, Number(editAmount) || 0))}
          className="flex-1 rounded-xl bg-primary/15 ring-1 ring-primary/30 py-2 text-xs font-semibold text-primary hover:bg-primary/25 transition disabled:opacity-40">
          Listo
        </button>
      </div>
    </div>
  );
}

function CobroModal({
  turno, empId, businessId, mode, userEmail, onClose, onDone,
}: {
  turno: import("@/hooks/use-professionals-data").ProfTurno;
  empId: string; businessId: string; mode: "auto" | "manual";
  userEmail: string | null; onClose: () => void; onDone: () => void;
}) {
  // ── Items ──────────────────────────────────────────────────────────────────
  const initPrice = Number(turno.service_price ?? 0);
  const [items, setItems] = useState<LineItem[]>([
    { id: "main", name: turno.service_name ?? "Servicio", amount: initPrice },
  ]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingItem, setAddingItem] = useState(false);

  const total = items.reduce((s, i) => s + i.amount, 0);

  function applyEdit(id: string, name: string, amount: number) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, name, amount } : i));
    setEditingId(null);
  }
  function applyAdd(name: string, amount: number) {
    setItems(prev => [...prev, { id: crypto.randomUUID(), name, amount }]);
    setAddingItem(false);
  }
  function removeItem(id: string) {
    setItems(prev => prev.filter(i => i.id !== id));
    if (editingId === id) setEditingId(null);
  }

  // ── Pagos ──────────────────────────────────────────────────────────────────
  const [multiPay, setMultiPay] = useState(false);
  const [splits, setSplits] = useState<SplitEntry[]>([{ method: "cash", amount: "" }]);

  // Keep single-pay amount in sync with total when not manually edited
  const splitTotal = splits.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const remaining = total - splitTotal;
  const isBalanced = Math.abs(remaining) < 1;
  const hasCash = splits.some(s => s.method === "cash");
  const isOver = splitTotal > total;
  const overAmount = splitTotal - total;
  const showVuelto = isOver && hasCash;

  function addSplit() {
    const used = new Set(splits.map(s => s.method));
    const next = ALL_METHODS.find(m => !used.has(m));
    if (!next) return;
    setSplits(prev => [...prev, { method: next, amount: "" }]);
  }
  function removeSplit(idx: number) {
    setSplits(prev => prev.filter((_, i) => i !== idx));
  }
  function setSplitMethod(idx: number, m: PayMethod) {
    setSplits(prev => prev.map((e, i) => i === idx ? { ...e, method: m } : e));
  }
  function setSplitAmount(idx: number, v: string) {
    setSplits(prev => prev.map((e, i) => i === idx ? { ...e, amount: v.replace(/[^0-9]/g, "") } : e));
  }
  function fillRemaining(idx: number) {
    const rem = total - splits.reduce((s, e, i) => i !== idx ? s + (Number(e.amount) || 0) : s, 0);
    if (rem > 0) setSplitAmount(idx, String(Math.round(rem)));
  }

  // ── Nota ──────────────────────────────────────────────────────────────────
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // In single pay mode, if no amount typed, treat as NOT covered (require explicit entry)
  const effectiveSplitTotal = splitTotal;
  const effectiveRemaining = total - effectiveSplitTotal;
  const effectiveIsBalanced = Math.abs(effectiveRemaining) < 1;
  const effectiveIsOver = effectiveSplitTotal > total;
  const effectiveShowVuelto = effectiveIsOver && splits.some(s => s.method === "cash");

  const canConfirm = mode !== "auto" || (
    splits.length > 0 && splitTotal > 0 && (effectiveIsBalanced || effectiveShowVuelto)
  );

  // ── Confirm ───────────────────────────────────────────────────────────────
  async function confirm() {
    if (mode === "auto" && !effectiveIsBalanced && !effectiveShowVuelto) {
      toast.error(`Falta distribuir ${fmtMoney(effectiveRemaining)}.`);
      return;
    }
    setSaving(true);
    try {
      const now = new Date();
      const hhmm = now.toTimeString().slice(0, 5);
      const actor = shortName(userEmail);
      // Use first split method; if amount empty, use total
      const primaryMethod: PayMethod = splits[0]?.method ?? "cash";

      if (mode === "auto") {
        await registerPayment({
          businessId, employeeId: empId,
          clientName: turno.client_name ?? "Sin cliente",
          items: items.map(i => ({ serviceName: i.name, amount: i.amount })),
          method: primaryMethod,
          appointmentId: turno.id, chargeOrigin: "auto", chargedBy: userEmail,
          notes: note || null,
        });
        await supabase.from("appointments").update({ status: "charged", notes: note || null }).eq("id", turno.id);
        appendHistorialCobro(turno.id, { time: hhmm, user: actor, role: "profesional", action: "Cobró" });
        toast.success("✓ Cobro registrado");
      } else {
        const marker = "[PENDIENTE_CAJA]";
        const itemsStr = items.map(i => `${i.name} ${fmtMoney(i.amount)}`).join(", ");
        const noteParts = [note.trim(), itemsStr].filter(Boolean).join(" | ");
        const nextNotes = noteParts ? `${marker} ${noteParts}` : marker;
        await supabase.from("appointments").update({ status: "pending_payment", notes: nextNotes }).eq("id", turno.id);
        saveManualPendingCharge({
          id: turno.id, business_id: businessId, employee_id: empId,
          client_name: turno.client_name ?? null,
          service_name: items.map(i => i.name).join(" + "),
          service_price: total, starts_at: turno.starts_at, notes: nextNotes,
        });
        appendHistorialCobro(turno.id, { time: hhmm, user: actor, role: "profesional", action: "Envió a caja" });
        toast.success("✓ Enviado a Caja");
      }
      onDone(); onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-strong rounded-3xl w-full max-w-md flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>

        {/* ── Scrollable body ── */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {/* Mode banner */}
          <div className={cn("rounded-2xl px-4 py-2.5 text-sm ring-1",
            mode === "auto" ? "bg-emerald-500/10 ring-emerald-400/20 text-emerald-200" : "bg-cyan-500/10 ring-cyan-400/20 text-cyan-200")}>
            <span className="font-semibold">{mode === "auto" ? "⚡ Cobro automático" : "👁 Enviar a Caja"}</span>
            <span className="text-xs opacity-70 ml-2">{mode === "auto" ? "Se registra directamente en caja." : "Recepción revisará y confirmará."}</span>
          </div>

          {/* Client + total */}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display font-semibold text-lg leading-tight">{turno.client_name ?? "Sin cliente"}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {new Date(turno.starts_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
            <div className="font-display text-2xl font-light tabular-nums">{fmtMoney(total)}</div>
          </div>

          {/* ── Items ── */}
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id}>
                {editingId === item.id ? (
                  <ItemPicker
                    businessId={businessId}
                    currentName={item.name}
                    currentAmount={String(item.amount)}
                    onSelect={(name, amount) => applyEdit(item.id, name, amount)}
                    onClose={() => setEditingId(null)}
                  />
                ) : (
                  <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                    <div className="flex-1 min-w-0 text-sm font-medium truncate">{item.name}</div>
                    {items.length > 1 && (
                      <div className="text-sm font-semibold tabular-nums shrink-0">{fmtMoney(item.amount)}</div>
                    )}
                    <button type="button" onClick={() => setEditingId(item.id)}
                      className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-white transition px-2 py-1 rounded-lg hover:bg-white/[0.06]">
                      Editar
                    </button>
                    {items.length > 1 && (
                      <button type="button" onClick={() => removeItem(item.id)}
                        className="shrink-0 text-rose-400/60 hover:text-rose-300 transition text-xs px-1">✕</button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Add item picker */}
            {addingItem ? (
              <ItemPicker
                businessId={businessId}
                currentName="" currentAmount="0"
                onSelect={applyAdd}
                onClose={() => setAddingItem(false)}
              />
            ) : (
              <button type="button" onClick={() => setAddingItem(true)}
                className="w-full rounded-2xl border border-dashed border-white/15 hover:border-white/25 hover:bg-white/[0.02] transition py-2.5 text-xs font-semibold text-muted-foreground flex items-center justify-center gap-2">
                <span className="text-base leading-none">+</span> Agregar ítem
              </button>
            )}
          </div>

          {/* ── Pago (solo modo auto) ── */}
          {mode === "auto" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Método de pago</div>
                {!multiPay ? (
                  <button type="button" onClick={() => {
                    setMultiPay(true);
                    setSplits([{ method: splits[0]?.method ?? "cash", amount: splits[0]?.amount ?? "" }]);
                  }}
                    className="text-[10px] font-semibold text-primary hover:text-primary/80 transition">
                    Pago múltiple
                  </button>
                ) : (
                  <button type="button" onClick={() => {
                    setMultiPay(false);
                    setSplits([{ method: "cash", amount: "" }]);
                  }}
                    className="text-[10px] font-semibold text-muted-foreground hover:text-white transition">
                    Pago simple
                  </button>
                )}
              </div>

              {!multiPay ? (
                /* ── Single method: selector + amount field ── */
                <div className="space-y-2">
                  <div className="grid grid-cols-5 gap-1.5">
                    {ALL_METHODS.map(m => (
                      <button key={m} type="button"
                        onClick={() => setSplits([{ method: m, amount: splits[0]?.amount ?? "" }])}
                        className={cn("rounded-xl py-2 text-xs font-medium ring-1 transition-all",
                          splits[0]?.method === m
                            ? "bg-primary/20 ring-primary/50 text-foreground"
                            : "bg-white/[0.03] ring-white/10 text-muted-foreground hover:ring-white/20")}>
                        {PAY_LABELS[m]}
                      </button>
                    ))}
                  </div>
                  {/* Amount input */}
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <input
                      type="text" inputMode="numeric"
                      value={splits[0]?.amount ?? ""}
                      onChange={e => setSplits([{ method: splits[0]?.method ?? "cash", amount: e.target.value.replace(/\D/g, "") }])}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.04] pl-6 pr-3 py-2.5 text-sm tabular-nums focus:outline-none focus:border-primary/40"
                    />
                  </div>
                  {/* Balance for single pay */}
                  {splits[0]?.amount && (
                    <div className={cn("rounded-xl px-4 py-2 text-xs font-semibold flex items-center justify-between",
                      isBalanced ? "bg-emerald-500/10 ring-1 ring-emerald-400/20 text-emerald-300"
                      : showVuelto ? "bg-sky-500/10 ring-1 ring-sky-400/20 text-sky-300"
                      : isOver && !hasCash ? "hidden"
                      : "bg-cyan-500/10 ring-1 ring-cyan-400/20 text-cyan-300")}>
                      {isBalanced ? <span>✓ Total cubierto</span>
                      : showVuelto ? <><span>Vuelto</span><span className="tabular-nums">{fmtMoney(overAmount)}</span></>
                      : <><span>Falta cubrir</span><span className="tabular-nums">{fmtMoney(remaining)}</span></>}
                    </div>
                  )}
                </div>
              ) : (
                /* ── Multi method rows ── */
                <div className="space-y-2">
                  {splits.map((entry, idx) => {
                    const usedMethods = new Set(splits.filter((_, i) => i !== idx).map(s => s.method));
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        <div className="relative">
                          <select value={entry.method}
                            onChange={e => setSplitMethod(idx, e.target.value as PayMethod)}
                            className="appearance-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary/40 pr-7 cursor-pointer">
                            {ALL_METHODS.filter(m => !usedMethods.has(m)).map(m => (
                              <option key={m} value={m}>{PAY_LABELS[m]}</option>
                            ))}
                          </select>
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">▾</span>
                        </div>
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                          <input type="text" inputMode="numeric" value={entry.amount}
                            placeholder={idx === splits.length - 1 && remaining > 0 ? String(Math.round(remaining)) : "0"}
                            onFocus={() => !entry.amount && fillRemaining(idx)}
                            onChange={e => setSplitAmount(idx, e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] pl-6 pr-3 py-2.5 text-sm tabular-nums focus:outline-none focus:border-primary/40" />
                        </div>
                        {splits.length > 1 && (
                          <button type="button" onClick={() => removeSplit(idx)}
                            className="rounded-xl px-2.5 py-2.5 text-xs text-rose-400/60 hover:text-rose-300 hover:bg-rose-500/10 transition ring-1 ring-rose-400/15">✕</button>
                        )}
                      </div>
                    );
                  })}
                  {splits.length < ALL_METHODS.length && (
                    <button type="button" onClick={addSplit}
                      className="w-full text-[10px] font-semibold text-primary hover:text-primary/80 transition py-1">
                      + Agregar método
                    </button>
                  )}
                  {/* Balance */}
                  {splitTotal > 0 && (
                    <div className={cn("rounded-xl px-4 py-2 text-xs font-semibold flex items-center justify-between",
                      isBalanced ? "bg-emerald-500/10 ring-1 ring-emerald-400/20 text-emerald-300"
                      : showVuelto ? "bg-sky-500/10 ring-1 ring-sky-400/20 text-sky-300"
                      : isOver && !hasCash ? "hidden"
                      : "bg-cyan-500/10 ring-1 ring-cyan-400/20 text-cyan-300")}>
                      {isBalanced ? <span>✓ Total cubierto</span>
                      : showVuelto ? <><span>Vuelto</span><span className="tabular-nums">{fmtMoney(overAmount)}</span></>
                      : <><span>Falta cubrir</span><span className="tabular-nums">{fmtMoney(remaining)}</span></>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Nota */}
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Nota opcional…"
            className="w-full rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-white/30" />
        </div>

        {/* ── Footer fijo ── */}
        <div className="p-4 pt-0 flex gap-3 border-t border-white/[0.06]">
          <button onClick={onClose}
            className="flex-1 rounded-xl ring-1 ring-white/10 py-3 text-sm text-muted-foreground hover:text-foreground transition">
            Cancelar
          </button>
          <button onClick={confirm} disabled={saving || !canConfirm}
            className={cn("flex-1 rounded-xl py-3 text-sm font-semibold transition disabled:opacity-40",
              mode === "auto" ? "bg-gradient-to-r from-emerald-400 to-emerald-500 text-background"
                             : "bg-gradient-to-r from-cyan-300 to-cyan-500 text-background")}>
            {saving ? "Guardando…" : mode === "auto" ? "Confirmar cobro" : "Enviar a Caja"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared helpers (mirrors agenda.tsx) ──────────────────────────────────────
const DAY_MS = 86_400_000;
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d: Date)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }

// ── DayStripNav — same component as in agenda.tsx ────────────────────────────
function DayStripNav({ cursor, onSelect }: { cursor: Date; onSelect: (d: Date) => void }) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const today = startOfDay(new Date());
  // Pool: 180 days centered on cursor month — regenerates on month change
  const days = React.useMemo(() =>
    Array.from({ length: 181 }, (_, i) => new Date(startOfDay(cursor).getTime() + (i - 90) * DAY_MS)),
  [cursor.getFullYear(), cursor.getMonth()]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const cursorStr = cursor.toISOString().slice(0, 10);
    const idx = days.findIndex(d => d.toISOString().slice(0, 10) === cursorStr);
    if (idx === -1) return;
    const itemWidth = 56;
    container.scrollTo({ left: Math.max(0, idx * itemWidth - container.clientWidth / 2 + itemWidth / 2), behavior: "smooth" });
  }, [cursor, days]);

  // Month label always tracks selected cursor
  const monthLabel = cursor.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  const cursorStr = cursor.toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  return (
    <div className="glass rounded-2xl mb-5 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <button onClick={() => onSelect(new Date(cursor.getFullYear(), cursor.getMonth() - 1, cursor.getDate()))}
            className="h-6 w-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-sm font-semibold capitalize">{monthLabel}</span>
          <button onClick={() => onSelect(new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()))}
            className="h-6 w-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {cursorStr !== todayStr && (
          <button onClick={() => onSelect(startOfDay(new Date()))}
            className="text-xs font-medium text-cyan-300 hover:text-cyan-200 transition">Hoy</button>
        )}
      </div>
      <div ref={scrollRef} className="flex gap-1 overflow-x-auto px-3 pb-3 scroll-smooth"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
        {days.map((d) => {
          const dStr = d.toISOString().slice(0, 10);
          const isSelected = dStr === cursorStr;
          const isToday = dStr === todayStr;
          const dow = d.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "").slice(0, 3);
          return (
            <button key={dStr} onClick={() => onSelect(startOfDay(d))}
              className={cn(
                "flex flex-col items-center gap-1 rounded-2xl py-2 transition-all shrink-0 w-[52px]",
                isSelected ? "text-white" : isToday ? "text-cyan-300 ring-1 ring-cyan-400/30 bg-cyan-500/10" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.05]"
              )}
              style={isSelected ? { background: "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))" } : undefined}
            >
              <span className="text-[10px] uppercase tracking-wider font-medium">{dow}</span>
              <span className="text-base font-semibold leading-none tabular-nums">{d.getDate()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TurnosView({ businessId, empId, approvalMode, approvalModeEnabled, profile, canOperate, equipoEnabled }: {
  businessId: string | null; empId: string | null;
  approvalMode: "auto" | "manual" | "disabled";
  approvalModeEnabled: boolean;
  profile: { id: string; email?: string | null } | null;
  canOperate: boolean;
  equipoEnabled: boolean;
}) {
  // Own cursor — not driven by parent's date filter
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const from = cursor.toISOString().slice(0, 10);
  const to = endOfDay(cursor).toISOString().slice(0, 10);

  const { data: turnos = [], isLoading, refetch } = useProfTurnos(businessId, empId, from, to);
  const [historialVersion, setHistorialVersion] = React.useState(0);

  React.useEffect(() => {
    if (turnos.length > 0) {
      syncHistorialFromDB(turnos.map(t => t.id)).then(() => setHistorialVersion(v => v + 1));
    }
  }, [turnos]);

  const [cobroTurno, setCobroTurno] = useState<import("@/hooks/use-professionals-data").ProfTurno | null>(null);
  const [notaTurno, setNotaTurno] = useState<import("@/hooks/use-professionals-data").ProfTurno | null>(null);
  const [canceladosOpen, setCanceladosOpen] = useState(false);
  const [sentToCajaIds, setSentToCajaIds] = useState<Set<string>>(() => {
    if (!businessId) return new Set();
    return new Set(readManualPendingCharges().filter((item) => item.business_id === businessId).map((item) => item.id));
  });

  useEffect(() => {
    if (!businessId) return;
    const syncPending = () => setSentToCajaIds(new Set(readManualPendingCharges().filter((item) => item.business_id === businessId).map((item) => item.id)));
    const syncHistorial = () => setHistorialVersion((v) => v + 1);
    syncPending();
    window.addEventListener("clippr:manual-pending-updated", syncPending);
    window.addEventListener("clippr:cobros-historial-updated", syncHistorial);
    window.addEventListener("storage", syncPending);
    window.addEventListener("storage", syncHistorial);
    return () => {
      window.removeEventListener("clippr:manual-pending-updated", syncPending);
      window.removeEventListener("clippr:cobros-historial-updated", syncHistorial);
      window.removeEventListener("storage", syncPending);
      window.removeEventListener("storage", syncHistorial);
    };
  }, [businessId]);

  const formatTime = (value: string) =>
    new Date(value).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  const formatDate = (value: string) => {
    const d = new Date(value);
    const day = d.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");
    return `${day.charAt(0).toUpperCase() + day.slice(1)} ${d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}`;
  };

  function getNoteDisplay(t: import("@/hooks/use-professionals-data").ProfTurno) {
    if (!t.notes) return null;
    const clean = t.notes.replace("[PENDIENTE_CAJA]", "").trim();
    return clean || null;
  }

  function getTurnoMeta(t: import("@/hooks/use-professionals-data").ProfTurno) {
    const isSentToCaja = sentToCajaIds.has(t.id);
    const isPending = isSentToCaja || String(t.notes ?? "").includes("[PENDIENTE_CAJA]") || t.status === "pending_payment";
    const isCancelled = t.status === "cancelled" || t.status === "blocked";
    const isCharged = t.status === "charged";
    const isConfirmed = t.status === "confirmed" || t.status === "approved";
    return { isSentToCaja, isPending, isCancelled, isCharged, isConfirmed };
  }

  // Status card data
  const counts = React.useMemo(() => {
    let pendientes = 0, confirmados = 0, finalizados = 0, cancelados = 0;
    for (const t of turnos) {
      const { isPending, isCancelled, isCharged, isConfirmed } = getTurnoMeta(t);
      if (isCancelled) cancelados++;
      else if (isCharged) finalizados++;
      else if (isConfirmed) confirmados++;
      else if (isPending || t.status === "pending" || t.status === "pending_payment") pendientes++;
      else pendientes++;
    }
    return { pendientes, confirmados, finalizados, cancelados };
  }, [turnos, sentToCajaIds]);

  // Active turnos (not cancelled) for agenda view
  const activeTurnos = React.useMemo(() =>
    turnos.filter(t => t.status !== "cancelled" && t.status !== "blocked"),
    [turnos]
  );
  const cancelledTurnos = React.useMemo(() =>
    turnos.filter(t => t.status === "cancelled" || t.status === "blocked"),
    [turnos]
  );

  // Style per status
  function getBlockStyle(t: import("@/hooks/use-professionals-data").ProfTurno) {
    const { isPending, isCharged, isConfirmed } = getTurnoMeta(t);
    if (isCharged) return {
      border: "border-l-emerald-400",
      bg: "bg-emerald-500/[0.08]",
      ring: "ring-emerald-400/15",
      dot: "bg-emerald-400",
      label: "Cobrado",
      labelColor: "text-emerald-300",
    };
    if (isConfirmed) return {
      border: "border-l-violet-400",
      bg: "bg-violet-500/[0.08]",
      ring: "ring-violet-400/15",
      dot: "bg-violet-400",
      label: "Confirmado",
      labelColor: "text-violet-300",
    };
    // pending / pending_payment / default
    return {
      border: "border-l-sky-400",
      bg: "bg-sky-500/[0.08]",
      ring: "ring-sky-400/15",
      dot: "bg-sky-400",
      label: isPending ? "Pendiente" : "Pendiente",
      labelColor: "text-sky-300",
    };
  }

  const canShowAction = (status: string) => {
    if (!canOperate || !approvalModeEnabled || approvalMode === "disabled") return false;
    return !["charged", "cancelled", "blocked", "pending_payment"].includes(status);
  };

  // Status cards config
  const statusCards = [
    {
      label: "Pendientes",
      count: counts.pendientes,
      color: "text-sky-300",
      bg: "bg-sky-500/10",
      ring: "ring-sky-400/20",
      dot: "bg-sky-400",
    },
    {
      label: "Confirmados",
      count: counts.confirmados,
      color: "text-violet-300",
      bg: "bg-violet-500/10",
      ring: "ring-violet-400/20",
      dot: "bg-violet-400",
    },
    {
      label: "Cobrados",
      count: counts.finalizados,
      color: "text-emerald-300",
      bg: "bg-emerald-500/10",
      ring: "ring-emerald-400/20",
      dot: "bg-emerald-400",
    },
    {
      label: "Cancelados",
      count: counts.cancelados,
      color: "text-rose-300",
      bg: "bg-rose-500/10",
      ring: "ring-rose-400/20",
      dot: "bg-rose-400",
      onClick: counts.cancelados > 0 ? () => setCanceladosOpen(true) : undefined,
    },
  ];

  const DAY_START_HOUR = 11;
  const DAY_END_HOUR = 20;
  const HOUR_HEIGHT = 92;
  const timelineHours = React.useMemo(
    () => Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i),
    []
  );
  const agendaTurnos = React.useMemo(
    () => [...activeTurnos].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()),
    [activeTurnos]
  );
  const minutesFromDayStart = (value: string) => {
    const d = new Date(value);
    return Math.max(0, (d.getHours() - DAY_START_HOUR) * 60 + d.getMinutes());
  };
  const getBlockTop = (value: string) => (minutesFromDayStart(value) / 60) * HOUR_HEIGHT;
  const getBlockHeight = (t: import("@/hooks/use-professionals-data").ProfTurno) => {
    const start = new Date(t.starts_at).getTime();
    const end = t.ends_at ? new Date(t.ends_at).getTime() : start + 30 * 60_000;
    const durationMin = Math.max(30, Math.round((end - start) / 60_000));
    return Math.max(64, (durationMin / 60) * HOUR_HEIGHT - 8);
  };
  const TIMELINE_TOP_OFFSET = 28;
  const timelineHeight = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT + TIMELINE_TOP_OFFSET + 36;

  return (
    <div className="space-y-5 animate-fade-up max-w-5xl mx-auto">

      {/* Day strip navigation */}
      <DayStripNav cursor={cursor} onSelect={setCursor} />

      {/* Mode banner */}
      {approvalModeEnabled && canOperate && (
        <div className={cn("rounded-2xl px-4 py-3 text-xs ring-1",
          approvalMode === "auto" && "bg-emerald-500/8 ring-emerald-400/15 text-emerald-300",
          approvalMode === "manual" && "bg-cyan-500/8 ring-cyan-400/15 text-cyan-300",
          approvalMode === "disabled" && "bg-rose-500/8 ring-rose-400/15 text-rose-300",
        )}>
          {approvalMode === "auto" && "⚡ Cobro automático — el profesional ve el botón Cobrar y al confirmar queda como Cobrado."}
          {approvalMode === "manual" && "👁 Cobro manual — el profesional ve Enviar; al enviarlo queda Pendiente hasta que Caja lo cobre."}
          {approvalMode === "disabled" && "🚫 Cobro desactivado — el profesional solo consulta turnos; Caja realiza todos los cobros."}
        </div>
      )}

      {/* Status pills — compact left aligned */}
      <div className="flex items-center gap-2 flex-wrap mb-0 justify-start">
        {statusCards.map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={card.onClick}
            disabled={!card.onClick}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-[11px] font-semibold transition-all ring-1",
              card.bg,
              card.ring,
              card.color,
              card.onClick ? "hover:brightness-110 cursor-pointer" : "cursor-default"
            )}
          >
            <span className="font-bold tabular-nums text-xs">{card.count}</span>
            <span className="opacity-90">{card.label}</span>
          </button>
        ))}
      </div>

      {/* Agenda visual */}
      <div className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase mt-1">Turnos del período</div>

      {isLoading ? (
        <div className="glass rounded-2xl py-10 text-center text-sm text-muted-foreground animate-pulse">Cargando turnos…</div>
      ) : agendaTurnos.length === 0 ? (
        <div className="glass rounded-2xl py-10 text-center text-sm text-muted-foreground">Sin turnos en este período.</div>
      ) : (
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.07] bg-white/[0.018]">
          <div className="absolute left-[72px] top-0 bottom-0 w-px bg-white/[0.07]" />
          <div className="relative" style={{ height: timelineHeight }}>
            {timelineHours.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 border-t border-white/[0.055]"
                style={{ top: TIMELINE_TOP_OFFSET + (hour - DAY_START_HOUR) * HOUR_HEIGHT }}
              >
                <div className="absolute left-5 -top-2.5 text-sm text-muted-foreground tabular-nums">
                  {String(hour).padStart(2, "0")}:00
                </div>
              </div>
            ))}

            {agendaTurnos.map((t) => {
              void historialVersion;
              const style = getBlockStyle(t);
              const noteText = getNoteDisplay(t);
              const historialDisplay = readHistorialCobro(t.id);
              const showActionBtn = canShowAction(t.status) && historialDisplay.length === 0;
              const { isSentToCaja } = getTurnoMeta(t);

              return (
                <div
                  key={t.id}
                  className={cn(
                    "absolute left-[88px] right-3 rounded-2xl border-l-[3px] ring-1 px-4 py-3 transition-all overflow-hidden",
                    style.border, style.bg, style.ring
                  )}
                  style={{ top: TIMELINE_TOP_OFFSET + getBlockTop(t.starts_at) + 6, minHeight: getBlockHeight(t) }}
                >
                  <div className="flex items-start gap-4 h-full">
                    <div className="shrink-0 min-w-[74px]">
                      <div className={cn("text-sm font-semibold tabular-nums", style.labelColor)}>
                        {formatTime(t.starts_at)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{formatDate(t.starts_at)}</div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground">{t.client_name ?? "Sin cliente"}</span>
                        <span className={cn(
                          "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1",
                          style.bg, style.ring, style.labelColor
                        )}>
                          {style.label}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5 truncate">{t.service_name ?? "—"}</div>
                      {noteText && (
                        <button
                          type="button"
                          onClick={() => setNotaTurno(t)}
                          className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-sky-300/80 hover:text-sky-300 transition"
                        >
                          📄 Ver nota
                        </button>
                      )}
                    </div>

                    <div className="shrink-0 min-w-[140px] space-y-1.5">
                      {historialDisplay.length > 0 ? (
                        historialDisplay.map((ev, ei) => {
                          const actionColor =
                            ev.action === "Envió a caja" ? "text-sky-300" :
                            ev.action === "Cobró"        ? "text-emerald-300" :
                            ev.action === "Canceló"      ? "text-rose-300" :
                            ev.action === "Anuló cobro"  ? "text-orange-300" :
                            ev.action === "Reembolsó"    ? "text-violet-300" :
                            "text-muted-foreground";
                          return (
                            <div key={ei} className="flex items-baseline gap-1.5 leading-none justify-end">
                              <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0">{ev.time}</span>
                              <span className="text-[10px] font-semibold text-white/80 whitespace-nowrap shrink-0">{ev.user}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0">→</span>
                              <span className={cn("text-[10px] font-medium whitespace-nowrap", actionColor)}>{ev.action}</span>
                            </div>
                          );
                        })
                      ) : showActionBtn ? (
                        <button
                          onClick={() => setCobroTurno(t)}
                          className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold transition ring-1 whitespace-nowrap",
                            approvalMode === "auto"
                              ? "bg-emerald-500/15 ring-emerald-400/30 text-emerald-300 hover:bg-emerald-500/25"
                              : "bg-cyan-500/15 ring-cyan-400/30 text-cyan-300 hover:bg-cyan-500/25"
                          )}
                        >
                          {approvalMode === "auto" ? "Cobrar" : "Enviar"}
                        </button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modals */}
      {canOperate && cobroTurno && businessId && empId && (
        <CobroModal
          turno={cobroTurno}
          empId={empId}
          businessId={businessId}
          mode={approvalMode === "manual" ? "manual" : "auto"}
          userEmail={profile?.email ?? null}
          onClose={() => setCobroTurno(null)}
          onDone={() => {
            if (cobroTurno) setSentToCajaIds((prev) => new Set([...prev, cobroTurno.id]));
            refetch();
          }}
        />
      )}

      {notaTurno && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setNotaTurno(null)}>
          <div className="glass-strong rounded-3xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Nota del turno</div>
                <div className="mt-1 font-semibold text-base">{notaTurno.service_name ?? "—"}</div>
              </div>
              <button type="button" onClick={() => setNotaTurno(null)}
                className="rounded-xl p-2 text-muted-foreground hover:text-white hover:bg-white/[0.08] transition shrink-0">✕</button>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>{formatDate(notaTurno.starts_at)} · {formatTime(notaTurno.starts_at)}</div>
              <div>{notaTurno.client_name ?? "Sin cliente"}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words">
              {getNoteDisplay(notaTurno) ?? "—"}
            </div>
          </div>
        </div>
      )}

      {/* Cancelados modal */}
      {canceladosOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setCanceladosOpen(false)}>
          <div className="glass-strong rounded-3xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/10 shrink-0">
              <div>
                <div className="font-semibold text-base">Turnos cancelados</div>
                <div className="text-xs text-muted-foreground mt-0.5">{cancelledTurnos.length} turno{cancelledTurnos.length !== 1 ? "s" : ""} cancelado{cancelledTurnos.length !== 1 ? "s" : ""}</div>
              </div>
              <button type="button" onClick={() => setCanceladosOpen(false)}
                className="rounded-xl p-2 text-muted-foreground hover:text-white hover:bg-white/[0.08] transition">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
              {cancelledTurnos.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Sin turnos cancelados en este período.</p>
              ) : cancelledTurnos.map((t) => {
                const historial = readHistorialCobro(t.id);
                const cancelEvent = historial.find(e => e.action === "Canceló");
                return (
                  <div key={t.id} className="rounded-2xl bg-rose-500/[0.06] ring-1 ring-rose-400/15 border-l-[3px] border-l-rose-400 px-4 py-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-foreground">{t.client_name ?? "Sin cliente"}</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 bg-rose-500/10 ring-rose-400/20 text-rose-300">Cancelado</span>
                        </div>
                        <div className="text-sm text-muted-foreground">{t.service_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(t.starts_at)} · {formatTime(t.starts_at)}</div>
                      </div>
                      {cancelEvent && (
                        <div className="text-right space-y-0.5 shrink-0">
                          <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Cancelado por</div>
                          <div className="text-xs font-semibold text-rose-300">{cancelEvent.user}</div>
                          <div className="text-[10px] text-muted-foreground">{cancelEvent.time}</div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
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
        <div className="glass rounded-2xl p-3.5 ring-1 ring-cyan-400/20 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-cyan-400/10 blur-3xl" />
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
        <div className="glass rounded-2xl p-3.5 ring-1 ring-cyan-300/20 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-cyan-300/10 blur-3xl" />
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

      {/* Servicios Desglose */}
      <ServiciosDesglose sales={sales} businessId={businessId} commissionPct={Number(active?.commission_pct ?? 0)} commissionFixed={Number(active?.commission_fixed ?? 0)} />
    </div>
  );
}

type ProfSale = ReturnType<typeof useProfSales> extends { data: (infer T)[] | undefined } ? T : never;

const PIE_COLORS = [
  "oklch(0.72 0.22 300)",  // violet
  "oklch(0.72 0.20 200)",  // sky
  "oklch(0.72 0.22 145)",  // emerald
  "oklch(0.78 0.16 200)",   // amber
  "oklch(0.72 0.22 15)",   // rose
  "oklch(0.72 0.18 250)",  // blue
  "oklch(0.75 0.14 95)",   // lime
];

function ServiciosDesglose({ sales, businessId, commissionPct, commissionFixed }: { sales: ProfSale[]; businessId: string | null; commissionPct: number; commissionFixed: number }) {
  const [tab, setTab] = React.useState<"all" | "services" | "catalog">("all");

  // Load price_catalog to classify each sale by real origin
  const [serviceNames, setServiceNames] = React.useState<Set<string>>(new Set());
  const [catalogNames, setCatalogNames] = React.useState<Set<string>>(new Set());
  // Original-case names for display
  const [serviceNamesOrig, setServiceNamesOrig] = React.useState<string[]>([]);
  const [catalogNamesOrig, setCatalogNamesOrig] = React.useState<string[]>([]);
  const [catalogLoaded, setCatalogLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!businessId) return;
    (async () => {
      const [{ data: svcs }, { data: prods }] = await Promise.all([
        supabase.from("price_catalog").select("name").eq("business_id", businessId).eq("active", true).not("duration_min", "is", null),
        supabase.from("price_catalog").select("name").eq("business_id", businessId).eq("active", true).is("duration_min", null),
      ]);
      const svcOrig = (svcs ?? []).map(s => s.name as string);
      const prodOrig = (prods ?? []).map(p => p.name as string);
      setServiceNamesOrig(svcOrig);
      setCatalogNamesOrig(prodOrig);
      setServiceNames(new Set(svcOrig.map(n => n.trim().toLowerCase())));
      setCatalogNames(new Set(prodOrig.map(n => n.trim().toLowerCase())));
      setCatalogLoaded(true);
    })();
  }, [businessId]);

  // Aggregate sales against real catalog names only
  const aggregated = React.useMemo(() => {
    if (!catalogLoaded) return [];

    // All known real names (service + catalog), longest first to avoid partial matches
    const allReal = [
      ...serviceNamesOrig.map(n => ({ name: n.trim().toLowerCase(), displayName: n, isService: true, isCatalog: false })),
      ...catalogNamesOrig.map(n => ({ name: n.trim().toLowerCase(), displayName: n, isService: false, isCatalog: true })),
    ].sort((a, b) => b.name.length - a.name.length);

    const map = new Map<string, { displayName: string; total: number; isService: boolean; isCatalog: boolean }>();

    for (const s of sales) {
      const rawName = (s.service_name ?? "").trim().toLowerCase();
      const saleTotal = Number(s.total ?? 0);

      if (!rawName || saleTotal <= 0) continue;

      // En este desglose mostramos SOLO la comisión del profesional, no el total facturado.
      const saleCommission = commissionFixed > 0
        ? Number(commissionFixed)
        : Math.round(saleTotal * (Number(commissionPct || 0) / 100));

      // Find which real catalog items appear in this payment's service_name
      const matched: typeof allReal = [];
      let remaining = rawName;
      for (const real of allReal) {
        if (remaining.includes(real.name)) {
          matched.push(real);
          // Remove matched segment to avoid double-counting
          remaining = remaining.split(real.name).join(" ");
        }
      }

      if (matched.length === 0) {
        // No match → skip entirely (seña, x2, internal text, etc.)
        continue;
      }

      if (matched.length === 1) {
        const key = matched[0].name;
        const existing = map.get(key);
        if (existing) {
          existing.total += saleCommission;
        } else {
          map.set(key, { displayName: matched[0].displayName, total: saleCommission, isService: matched[0].isService, isCatalog: matched[0].isCatalog });
        }
      } else {
        // Multiple items: split total evenly
        const share = saleCommission / matched.length;
        for (const real of matched) {
          const existing = map.get(real.name);
          if (existing) {
            existing.total += share;
          } else {
            map.set(real.name, { displayName: real.displayName, total: share, isService: real.isService, isCatalog: real.isCatalog });
          }
        }
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.total - a.total);
  }, [sales, serviceNamesOrig, catalogNamesOrig, catalogLoaded, commissionPct, commissionFixed]);

  const filtered = React.useMemo(() => {
    if (tab === "services") return aggregated.filter(i => i.isService);
    if (tab === "catalog")  return aggregated.filter(i => i.isCatalog);
    return aggregated;
  }, [aggregated, tab]);
  const grandTotal = filtered.reduce((s, i) => s + i.total, 0);
  const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-AR");
  const fmtPct = (n: number) => grandTotal > 0 ? ((n / grandTotal) * 100).toFixed(1) + "%" : "0%";

  // SVG donut chart
  const RADIUS = 70;
  const CX = 90;
  const CY = 90;
  const STROKE = 28;
  const circumference = 2 * Math.PI * RADIUS;

  const arcs = React.useMemo(() => {
    let offset = 0;
    return filtered.map((item, i) => {
      const pct = grandTotal > 0 ? item.total / grandTotal : 0;
      const dash = pct * circumference;
      const gap = circumference - dash;
      const arc = { item, dash, gap, offset: offset * circumference, color: PIE_COLORS[i % PIE_COLORS.length] };
      offset += pct;
      return arc;
    });
  }, [filtered, grandTotal, circumference]);

  return (
    <div className="glass rounded-2xl p-5 relative overflow-hidden">
      <div className="absolute -top-16 -left-16 h-56 w-56 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />

      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Comisión por servicio</div>
          <div className="mt-0.5 text-2xl font-display font-light tracking-tight">Desglose</div>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 rounded-xl bg-white/[0.05] p-1">
          {([["all", "Todos"], ["services", "Servicios"], ["catalog", "Catálogo"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={cn("rounded-lg px-3 py-1 text-xs font-semibold transition-all",
                tab === k ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {grandTotal === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center text-sm text-muted-foreground gap-2">
          <div className="h-10 w-10 rounded-full bg-white/5 ring-1 ring-white/10 grid place-items-center mb-1">
            <svg viewBox="0 0 24 24" className="h-5 w-5 opacity-40" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 3v16a2 2 0 002 2h16" strokeLinecap="round"/>
              <path d="M7 16l4-4 4 4 5-5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          Sin datos aún
          <span className="text-xs opacity-60">Los datos aparecerán cuando haya turnos registrados</span>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          {/* Donut — smaller to sit tight next to the legend */}
          <div className="shrink-0 relative">
            <svg width="140" height="140" viewBox="0 0 180 180">
              {arcs.map((arc, i) => (
                <circle key={i}
                  cx={CX} cy={CY} r={RADIUS}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={STROKE}
                  strokeDasharray={`${arc.dash} ${arc.gap}`}
                  strokeDashoffset={-arc.offset}
                  strokeLinecap="butt"
                  style={{ transform: "rotate(-90deg)", transformOrigin: `${CX}px ${CY}px`, transition: "stroke-dasharray 0.5s" }}
                />
              ))}
              <text x={CX} y={CY - 8} textAnchor="middle" fill="white" fontSize="11" opacity="0.5" fontFamily="sans-serif">Comisión</text>
              <text x={CX} y={CY + 10} textAnchor="middle" fill="white" fontSize="14" fontWeight="600" fontFamily="sans-serif">
                {fmt(grandTotal)}
              </text>
            </svg>
          </div>

          {/* Legend — natural width, no flex-1 stretch */}
          <div className="space-y-2 min-w-0 w-full sm:w-auto sm:max-w-xs">
            {filtered.slice(0, 7).map((item, i) => (
              <div key={item.displayName} className="flex items-center gap-3 min-w-0">
                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                <div className="flex-1 text-sm truncate min-w-0">{item.displayName}</div>
                <div className="tabular-nums text-xs text-muted-foreground shrink-0 ml-3">{fmt(item.total)}</div>
                <div className="tabular-nums text-xs font-semibold shrink-0 w-12 text-right">{fmtPct(item.total)}</div>
              </div>
            ))}
            {filtered.length > 7 && (
              <div className="text-xs text-muted-foreground pl-5">+{filtered.length - 7} más</div>
            )}
          </div>
        </div>
      )}
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
          payments.map((p, i) => {
            const dt = p.created_at ? new Date(p.created_at) : new Date(p.date + "T12:00:00");
            const fecha = dt.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "numeric" }).replace(".", "");
            const hora = dt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
            return (
              <div key={p.id} className={cn("flex items-center gap-4 px-5 py-3.5", i < payments.length - 1 && "border-b border-white/5")}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium capitalize">{fecha}</div>
                  <div className="text-xs text-muted-foreground">{hora} · {p.created_by ?? "Caja"} pagó · {p.method ?? "Sin método"}{p.note ? " · " + p.note : ""}</div>
                </div>
                <div className="text-base font-bold text-emerald-300 tabular-nums">${Number(p.amount).toLocaleString("es-AR")}</div>
              </div>
            );
          })
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
  // ── Cargar turnos del período (misma fuente que TurnosView) ─────────────
  const { data: turnos = [], isLoading: turnosLoading } = useProfTurnos(businessId, empId, from, to);

  // ── Cargar payments del mismo período para enriquecer con total ──────────
  const { data: sales = [], isLoading: salesLoading } = useProfSales(businessId, empId, from, to);

  const isLoading = turnosLoading || salesLoading;

  // ── Datos enriquecidos ───────────────────────────────────────────────────
  const [enriched, setEnriched] = React.useState<{
    id: string;
    fecha: string;       // YYYY-MM-DD local
    client_name: string | null;
    service_name: string | null;
    total: number;
    commission: number;
    sourceType: "turno" | "venta-directa";
  }[]>([]);
  const [enrichLoading, setEnrichLoading] = React.useState(false);

  // Sync historial from Supabase (same as TurnosView)
  const [historialVersion, setHistorialVersion] = React.useState(0);
  React.useEffect(() => {
    if (turnos.length > 0) {
      syncHistorialFromDB(turnos.map(t => t.id)).then(() => setHistorialVersion(v => v + 1));
    }
  }, [turnos]);
  React.useEffect(() => {
    const sync = () => setHistorialVersion(v => v + 1);
    window.addEventListener("clippr:cobros-historial-updated", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("clippr:cobros-historial-updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  React.useEffect(() => {
    if (!businessId || !empId || turnosLoading) return;
    if (turnos.length === 0 && sales.length === 0) { setEnriched([]); return; }

    setEnrichLoading(true);
    (async () => {
      const fromDate = new Date(from + "T00:00:00");
      fromDate.setDate(fromDate.getDate() - 1);
      const toDate = new Date(to + "T23:59:59");
      toDate.setDate(toDate.getDate() + 1);

      const { data: payments } = await supabase
        .from("payments")
        .select("id,appointment_id,client_name,service_name,total,amount,created_at")
        .eq("business_id", businessId)
        .eq("employee_id", empId)
        .gte("created_at", fromDate.toISOString())
        .lte("created_at", toDate.toISOString());

      const payByAppt = new Map<string, { id: string; total: number | null; amount: number | null }>();
      for (const p of payments ?? []) {
        if (p.appointment_id) payByAppt.set(p.appointment_id, p);
      }

      const rows: typeof enriched = [];
      const usedPaymentIds = new Set<string>();

      for (const t of turnos) {
        const pay = payByAppt.get(t.id);
        if (pay) usedPaymentIds.add(pay.id);
        const localDate = new Date(t.starts_at).toLocaleDateString("sv-SE");
        if (localDate < from || localDate > to) continue;
        rows.push({
          id: t.id,
          fecha: localDate,
          client_name: t.client_name,
          service_name: t.service_name,
          total: pay ? Number(pay.total ?? pay.amount ?? t.service_price ?? 0) : Number(t.service_price ?? 0),
          commission: 0,
          sourceType: "turno",
        });
      }

      // Ventas directas sin turno
      for (const p of payments ?? []) {
        if (usedPaymentIds.has(p.id)) continue;
        if (p.appointment_id && payByAppt.has(p.appointment_id)) continue;
        const localDate = new Date(p.created_at).toLocaleDateString("sv-SE");
        if (localDate < from || localDate > to) continue;
        rows.push({
          id: p.id,
          fecha: localDate,
          client_name: p.client_name,
          service_name: p.service_name,
          total: Number(p.total ?? p.amount ?? 0),
          commission: 0,
          sourceType: "venta-directa",
        });
      }

      const final = rows
        .map(r => ({ ...r, commission: Math.round(r.total * commissionPct / 100) }))
        .sort((a, b) => a.fecha < b.fecha ? 1 : -1);

      setEnriched(final);
      setEnrichLoading(false);
    })();
  }, [businessId, empId, from, to, turnos, turnosLoading, commissionPct]);

  const loading = isLoading || enrichLoading;

  const totalFacturado = enriched.reduce((s, r) => s + r.total, 0);
  const totalComisiones = enriched.reduce((s, r) => s + r.commission, 0);

  return (
    <div className="space-y-4 animate-fade-up">
      <div className="max-w-5xl mx-auto space-y-3">
        <div className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">Historial de ventas</div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>Total de ventas: <strong className="text-foreground">{enriched.length}</strong></span>
          <span className="text-white/20">•</span>
          <span>Comisiones: <strong className="text-cyan-300">${totalComisiones.toLocaleString("es-AR")}</strong></span>
        </div>

        {loading ? (
          <div className="glass rounded-2xl py-8 text-center text-sm text-muted-foreground animate-pulse">Cargando…</div>
        ) : enriched.length === 0 ? (
          <div className="glass rounded-2xl py-8 text-center text-sm text-muted-foreground">Sin historial en este período</div>
        ) : (
          <div className="glass rounded-2xl overflow-hidden">
            {/* Header — same structure as TurnosView */}
            <div className="grid grid-cols-[12%_22%_26%_24%_8%_8%] px-5 py-3.5 border-b border-white/10 bg-white/[0.025] text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              <div>Fecha</div>
              <div>Cliente</div>
              <div>Servicio / Catálogo</div>
              <div>Historial</div>
              <div className="text-right">Total</div>
              <div className="text-right">Comisión</div>
            </div>

            {enriched.map((row, i) => {
              void historialVersion;
              const [y, m, d] = row.fecha.split("-");
              const fechaDisplay = new Date(Number(y), Number(m) - 1, Number(d))
                .toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" })
                .replace(".", "");

              const historialEvents = readHistorialCobro(row.id);

              return (
                <div
                  key={row.id}
                  className={cn(
                    "grid grid-cols-[12%_22%_26%_24%_8%_8%] items-start px-5 py-4 text-sm",
                    i < enriched.length - 1 && "border-b border-white/5"
                  )}
                >
                  <div className="text-xs text-muted-foreground tabular-nums whitespace-nowrap pt-0.5 capitalize">{fechaDisplay}</div>
                  <div className="font-medium truncate pr-2 pt-0.5">{row.client_name ?? "Sin cliente"}</div>
                  <div className="text-muted-foreground truncate pr-2 pt-0.5">{row.service_name ?? "—"}</div>

                  {/* Historial — same renderer as TurnosView */}
                  <div className="space-y-1.5 pr-2">
                    {historialEvents.length > 0 ? (
                      historialEvents.map((ev, ei) => {
                        const actionColor =
                          ev.action === "Envió a caja" ? "text-sky-300" :
                          ev.action === "Cobró"        ? "text-emerald-300" :
                          ev.action === "Canceló"      ? "text-rose-300" :
                          ev.action === "Anuló cobro"  ? "text-orange-300" :
                          ev.action === "Reembolsó"    ? "text-violet-300" :
                          "text-muted-foreground";
                        return (
                          <div key={ei} className="flex items-baseline gap-1.5 leading-none">
                            <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0">{ev.time}</span>
                            <span className="text-[10px] font-semibold text-white/80 whitespace-nowrap shrink-0">{ev.user}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">→</span>
                            <span className={cn("text-[10px] font-medium whitespace-nowrap", actionColor)}>{ev.action}</span>
                          </div>
                        );
                      })
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </div>

                  <div className="text-right font-semibold tabular-nums whitespace-nowrap text-xs pt-0.5">${row.total.toLocaleString("es-AR")}</div>
                  <div className="text-right text-cyan-300 font-semibold tabular-nums whitespace-nowrap text-xs pt-0.5">${row.commission.toLocaleString("es-AR")}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
