import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import {
  ClipboardList,
  BarChart3,
  Clock,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  CalendarPlus,
  CreditCard,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/date-range-picker";
import { useAuth } from "@/hooks/use-auth";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { registerPayment, type PayMethod, PAY_METHOD_LABEL } from "@/components/cash-register/register-payment";
import { supabase } from "@/integrations/supabase/client";
import {
  useProfessionals, useProfStats, useProfPayments,
  useProfSales, useProfTurnos,
  type ProfTurno,
} from "@/hooks/use-professionals-data";
import { cancelAppointment } from "@/components/agenda/use-agenda-data";
import { useAgendaData } from "@/components/agenda/use-agenda-data";
import { resolveDaySchedule } from "@/lib/availability";
import { getPublicVisibility, normalizePublicBooleanMap } from "@/components/settings/shared";
import { type HistorialEvento, readHistorialCobro, appendHistorialCobro, syncHistorialFromDB, attributionLabel } from "@/lib/cobro-historial";
import { AppointmentDialog } from "@/components/agenda/appointment-dialog";
import { useCajaData } from "@/components/cash-register/use-caja-data";
import { NuevaVentaTab } from "@/routes/cash-register";
import { toast } from "sonner";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import {
  resolveServicePricing,
  type EmployeeServiceOverrideMap,
} from "@/lib/service-pricing";

export const Route = createFileRoute("/professionals")({
  component: ProfessionalsPage,
});

type TabKey = "turnos" | "stats" | "historial-servicios" | "historial-pagos";
type RangeKey = "hoy" | "semana" | "mes" | "custom";

function toLocalISODate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseLocalISODate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  const fallback = new Date();
  const date = new Date(y || fallback.getFullYear(), (m || fallback.getMonth() + 1) - 1, d || fallback.getDate());
  date.setHours(0, 0, 0, 0);
  return date;
}

function monthLabelEs(date: Date) {
  const label = date.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function buildMonthDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const firstDayMonday = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - firstDayMonday);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function getPresetRange(range: Exclude<RangeKey, "custom">) {
  const now = new Date();
  const today = toLocalISODate(now);

  if (range === "hoy") return { from: today, to: today };

  if (range === "semana") {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: toLocalISODate(monday), to: toLocalISODate(sunday) };
  }

  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toLocalISODate(firstDay), to: toLocalISODate(lastDay) };
}



const MANUAL_PENDING_KEY = "clippr_pending_manual_charges";

// Ventas de mostrador enviadas sin turno (botón "Enviar" del panel, sin
// appointment de por medio) guardan su historial "Envió a caja"/"Cobró"
// directo en payments.observations, con este marcador al principio —
// mismo mecanismo/constante que usa cash-register.tsx al escribirlo.
const PAY_HIST_MARKER = "[[HIST]]";
function decodePayHistNotes(observations: string | null | undefined): { time: string; user: string; action: string }[] {
  const raw = String(observations ?? "");
  if (!raw.startsWith(PAY_HIST_MARKER)) return [];
  try {
    return JSON.parse(raw.slice(PAY_HIST_MARKER.length));
  } catch {
    return [];
  }
}

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

function shortName(email: string | null | undefined): string {
  if (!email) return "Sistema";
  const local = email.split("@")[0];
  return local.split(/[._-]/)[0].charAt(0).toUpperCase() + local.split(/[._-]/)[0].slice(1);
}

// Usuario que cobró/pagó: email completo antes del "@" (ej. alangmelgar).
// Solo cae en "Recepción" si no hay email de sesión.
function emailUsername(email: string | null | undefined): string {
  const raw = String(email ?? "").trim();
  if (!raw) return "Recepción";
  return raw.includes("@") ? raw.split("@")[0] || "Recepción" : raw;
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

  useEffect(() => {
    if (tab !== "turnos") return;
    if (toDate !== fromDate) setToDate(fromDate);
  }, [tab, fromDate, toDate]);

  const canOperateSelectedPanel = !!empId && (
    isProfessionalAccess ? ownProfessional?.id === empId : true
  );

  // Modo de aprobación de cobros y switches de agenda — todos por profesional
  // (configurados en Equipo → Editar profesional, no por rol de login). Se
  // traen los 4 mapas completos y se deriva el valor del profesional activo.
  const [employeeApprovalEnabledMap, setEmployeeApprovalEnabledMap] = useState<
    Record<string, boolean>
  >({});
  const [employeeApprovalModeMap, setEmployeeApprovalModeMap] = useState<
    Record<string, "auto" | "manual">
  >({});
  const [employeeCanAddTurnoMap, setEmployeeCanAddTurnoMap] = useState<
    Record<string, boolean>
  >({});
  const [employeeCanCancelTurnoMap, setEmployeeCanCancelTurnoMap] = useState<
    Record<string, boolean>
  >({});
  // Mismo switch "Acepta reservas en línea" que Equipo — no hay un estado
  // "Activo/Inactivo" separado para esto, es literalmente el mismo dato
  // (_publicVisibility.employees, con fallback al key legacy _employeeOnline).
  const [employeeOnlineMap, setEmployeeOnlineMap] = useState<Record<string, boolean>>({});

  // Un admin/recepción viendo esta pantalla siempre puede agregar/cancelar
  // turnos; un profesional viendo la suya solo si tiene el switch activado
  // en Equipo (por profesional, no por rol de login).
  const canAddTurno = canOperateSelectedPanel && (!isProfessionalAccess || (!!empId && employeeCanAddTurnoMap[empId] === true));
  const canDeleteTurno = canOperateSelectedPanel && (!isProfessionalAccess || (!!empId && employeeCanCancelTurnoMap[empId] === true));
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
    supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule as Record<string, unknown> | null) ?? {};
        setEmployeeApprovalEnabledMap(
          (schedule._employeeApprovalEnabled as Record<string, boolean>) ?? {},
        );
        setEmployeeApprovalModeMap(
          (schedule._employeeApprovalMode as Record<string, "auto" | "manual">) ?? {},
        );
        setEmployeeCanAddTurnoMap(
          (schedule._employeeAgendaAdd as Record<string, boolean>) ?? {},
        );
        setEmployeeCanCancelTurnoMap(
          (schedule._employeeAgendaCancel as Record<string, boolean>) ?? {},
        );
        const visibility = getPublicVisibility(schedule);
        setEmployeeOnlineMap(
          normalizePublicBooleanMap(visibility.employees ?? schedule._employeeOnline),
        );
      });
  }, [businessId]);
  // "disabled" acá representa "No cobra servicios" para este profesional
  // (nunca aparece el botón Cobrar/Enviar) — mismo criterio que antes tenía
  // el toggle global "Habilitar modo de aprobación" apagado.
  const approvalModeEnabled = !!empId && employeeApprovalEnabledMap[empId] === true;
  const approvalMode: "auto" | "manual" | "disabled" = !approvalModeEnabled
    ? "disabled"
    : employeeApprovalModeMap[empId ?? ""] === "manual"
      ? "manual"
      : "auto";
  const active = useMemo(() => visibleProfessionals.find((p) => p.id === empId) ?? visibleProfessionals[0] ?? null, [visibleProfessionals, empId]);
  const activeColor = useMemo(() => COLORS[(visibleProfessionals.findIndex(p => p.id === empId) % COLORS.length) || 0], [visibleProfessionals, empId]);
  const initials = (active?.full_name ?? "?").split(/\s+/).map((s: string) => s[0]).slice(0, 2).join("").toUpperCase();

  const selectedDateObj = useMemo(() => parseLocalISODate(fromDate), [fromDate]);
  const selectedDayLabel = useMemo(() => {
    return selectedDateObj.toLocaleDateString("es-AR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    }).replace(".", "");
  }, [selectedDateObj]);

  const [dayPickerOpen, setDayPickerOpen] = React.useState(false);
  const [visibleMonth, setVisibleMonth] = React.useState(
    () => new Date(selectedDateObj.getFullYear(), selectedDateObj.getMonth(), 1)
  );

  React.useEffect(() => {
    if (tab === "turnos") {
      setVisibleMonth(new Date(selectedDateObj.getFullYear(), selectedDateObj.getMonth(), 1));
    }
  }, [tab, selectedDateObj]);

  const selectSingleDay = React.useCallback((date: Date) => {
    const day = toLocalISODate(date);
    setRange("custom");
    setFromDate(day);
    setToDate(day);
    setDayPickerOpen(false);
  }, []);

  // El selector de fecha de Mi Agenda pasa a modal centrado + portal (ver
  // el JSX más abajo) por el mismo motivo que CobroModal/AgendaCenteredModal:
  // fondo bloqueado mientras está abierto, y cierre con Esc en desktop.
  useBodyScrollLock(dayPickerOpen);
  React.useEffect(() => {
    if (!dayPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDayPickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dayPickerOpen]);

  const calendarDays = useMemo(() => buildMonthDays(visibleMonth), [visibleMonth]);

  if (isLoading) return (
    <AppShell><Topbar title="Profesionales" subtitle="Equipo y rendimiento" />
      <div className="grid place-items-center py-32">
        <ClipprLoader size="screen" delayMs={130} />
      </div>
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
      <div className="app-premium-shell">
      
      <div className="pointer-events-none absolute left-1/2 top-[-120px] z-[-1] h-[620px] w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_17%_4%,rgb(139_92_246_/_0.34),transparent_38%),radial-gradient(circle_at_76%_0%,rgb(79_125_255_/_0.30),transparent_36%),radial-gradient(circle_at_46%_96%,rgb(255_123_229_/_0.14),transparent_50%)] blur-[16px]" />
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
              <div className="text-sm text-muted-foreground mt-0.5 flex items-center flex-wrap gap-x-2 gap-y-1">
                <span>{active.role_label?.trim() || "Profesional"}</span>
                {/* ONLINE/OFFLINE: mismo dato que el switch "Acepta reservas
                    en línea" de Equipo (_publicVisibility.employees) — no
                    Activo/Inactivo (is_active), que es un concepto distinto
                    (si el profesional existe/opera en la barbería, no si
                    acepta reservas desde la página pública). */}
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full ring-1 px-2 py-0.5 text-[10px] uppercase tracking-wider",
                    employeeOnlineMap[active.id] !== false
                      ? "bg-[oklch(0.78_0.17_140/0.12)] ring-[oklch(0.78_0.17_140/0.3)] text-[oklch(0.85_0.17_140)]"
                      : "bg-white/5 ring-white/10 text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      employeeOnlineMap[active.id] !== false ? "bg-[oklch(0.78_0.17_140)]" : "bg-muted-foreground",
                    )}
                  />
                  {employeeOnlineMap[active.id] !== false ? "ONLINE" : "OFFLINE"}
                </span>
              </div>
              {/* Antes solo se mostraba con permissions.equipo (Admin/Dueño) —
                  un profesional viendo su PROPIA ficha (típicamente desde Mi
                  Agenda en el celular) nunca tiene ese permiso, así que este
                  badge nunca le aparecía a él mismo aunque el diseño no
                  tuviera nada de "solo desktop". isProfessionalAccess cubre
                  ese caso: puede ver su propio modo de cobro sin necesitar
                  permiso de gestión de equipo. */}
              {(permissions.equipo || isProfessionalAccess) && <div className={cn(
                "mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1",
                approvalMode === "auto" && "bg-emerald-500/10 ring-emerald-400/30 text-emerald-300",
                approvalMode === "manual" && "bg-amber-500/10 ring-amber-400/30 text-amber-300",
                approvalMode === "disabled" && "bg-white/5 ring-white/15 text-muted-foreground",
              )}>
                {approvalMode === "auto" && <>🟢 Cobra directamente</>}
                {approvalMode === "manual" && <>🟡 Requiere aprobación</>}
                {approvalMode === "disabled" && <>⚪ No cobra servicios</>}
              </div>}
            </div>
          </div>

          {/* Barber selector: solo tiene sentido para cuentas que pueden
              administrar varios profesionales (Admin/Socio/Dueño). Una
              cuenta Profesional ya solo ve su propia ficha arriba (ver
              visibleProfessionals más abajo, que la colapsa a un único
              elemento) — renderizar igual esta fila para ese caso era
              directamente muerto: un solo avatar clickeable que no lleva a
              ningún lado. !isProfessional evita el render por completo (no
              un CSS hidden que deje el hueco), aprovechando mejor el alto
              de la tarjeta. */}
          {!isProfessional && (
            <div className="flex items-center gap-2 flex-wrap">
              {visibleProfessionals.map((p, idx) => {
                const isActive = p.id === empId;
                const isInactive = p.is_active === false;
                const c = COLORS[idx % COLORS.length];
                const ini = (p.full_name ?? "?").split(/\s+/).map((s: string) => s[0]).slice(0,2).join("").toUpperCase();
                return (
                  <button
                    key={p.id}
                    onClick={() => setActiveId(p.id)}
                    title={`${p.full_name ?? "Profesional"}${isInactive ? " · Inactivo" : ""}`}
                    className={cn(
                      "h-9 w-9 rounded-full overflow-hidden grid place-items-center text-[13px] font-semibold transition-all ring-1",
                      isActive
                        ? `bg-gradient-to-br ${c.color} text-background ${c.ring} ring-2 shadow-[0_0_20px_-2px_rgba(251,191,36,0.45)]`
                        : "bg-white/[0.03] text-muted-foreground ring-white/10 hover:ring-white/20",
                      isInactive && "opacity-45 grayscale",
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
          )}
        </div>
      </div>

      {/* Tabs */}
      {/* pb-3: separación garantizada hacia la fila de fecha/acciones de
          abajo — a diferencia de un margin-top ahí, este padding no puede
          "colapsar" ni perderse, así que asegura el aire pedido sin
          depender de cómo el navegador resuelva márgenes adyacentes. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 pb-3">
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

      {tab !== "turnos" && (
        <div className="flex justify-end -mt-3">
          <DateRangePicker
            from={fromDate}
            to={toDate}
            onChange={({ from, to }) => {
              setRange("custom");
              setFromDate(from);
              setToDate(to);
            }}
          />
        </div>
      )}

      {/* Content */}
      {tab === "turnos" && (
        <TurnosView
          businessId={businessId}
          empId={empId}
          fromDate={fromDate}
          toDate={fromDate}
          approvalMode={approvalMode}
          approvalModeEnabled={approvalModeEnabled}
          profile={profile}
          canOperate={canOperateSelectedPanel}
          equipoEnabled={approvalModeEnabled}
          canAddTurno={canAddTurno}
          canDeleteTurno={canDeleteTurno}
          dateControl={
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 rounded-full bg-[#070814]/85 p-1 ring-1 ring-white/10 shadow-[0_0_24px_rgba(0,0,0,0.22)]">
              <button
                type="button"
                onClick={() => {
                  const today = getPresetRange("hoy").from;
                  setRange("hoy");
                  setFromDate(today);
                  setToDate(today);
                  setDayPickerOpen(false);
                }}
                className="whitespace-nowrap rounded-full bg-white/[0.04] px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-muted-foreground ring-1 ring-white/10 transition hover:bg-white/[0.07] hover:text-white"
              >
                Hoy
              </button>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setDayPickerOpen((v) => !v)}
                  className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 sm:gap-2 whitespace-nowrap rounded-full bg-[#070814]/95 px-2.5 sm:px-3 text-xs font-semibold text-foreground ring-1 ring-white/10 shadow-[0_0_18px_rgba(124,58,237,0.14)] transition hover:bg-[#0d1020] hover:ring-violet-300/25"
                >
                  <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="capitalize tabular-nums">{selectedDayLabel}</span>
                </button>

                {dayPickerOpen && typeof document !== "undefined" && createPortal(
                  // createPortal a document.body + fixed centrado: antes
                  // era un "absolute left-0 top-11" anclado al botón
                  // trigger, sin portal — vivía dentro del <div
                  // className="relative z-10"> de AppShell (mismo trap de
                  // siempre) y con ancho fijo (336px) sin clamping,
                  // así que en mobile se abría pegado abajo y quedaba
                  // cortado por la barra "Mi Agenda". Ahora es un modal
                  // real: centrado, con backdrop, cierre al tocar afuera
                  // o con Esc, fondo bloqueado, y max-h con scroll interno
                  // si no entra completo.
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-3 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] bg-black/75"
                    onClick={() => setDayPickerOpen(false)}
                  >
                    <div
                      className="glass-strong w-full max-w-[336px] shrink-0 overflow-hidden rounded-3xl border border-white/10 bg-[#050612] text-white shadow-[0_24px_80px_rgba(0,0,0,0.62),0_0_0_1px_rgba(124,58,237,0.08)]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex flex-wrap gap-2 border-b border-white/10 p-4">
                        {[
                          ["Hoy", getPresetRange("hoy").from],
                          ["Ayer", toLocalISODate(new Date(Date.now() - 24 * 60 * 60 * 1000))],
                        ].map(([label, value]) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => selectSingleDay(parseLocalISODate(value))}
                            className="rounded-full bg-white/[0.035] px-3 py-1.5 text-xs font-semibold text-white/60 ring-1 ring-white/10 transition hover:bg-white/[0.07] hover:text-white"
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <div className="p-4">
                        <div className="mb-4 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => setVisibleMonth((m) => addMonths(m, -1))}
                            className="rounded-full p-2 text-white/45 transition hover:bg-white/[0.06] hover:text-white"
                            aria-label="Mes anterior"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <div className="text-base font-bold tracking-tight text-white">
                            {monthLabelEs(visibleMonth)}
                          </div>
                          <button
                            type="button"
                            onClick={() => setVisibleMonth((m) => addMonths(m, 1))}
                            className="rounded-full p-2 text-white/45 transition hover:bg-white/[0.06] hover:text-white"
                            aria-label="Mes siguiente"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-7 gap-y-2 text-center">
                          {["LU", "MA", "MI", "JU", "VI", "SÁ", "DO"].map((d) => (
                            <div key={d} className="pb-2 text-[11px] font-semibold tracking-[0.18em] text-white/28">
                              {d}
                            </div>
                          ))}

                          {calendarDays.map((day) => {
                            const selected = sameLocalDay(day, selectedDateObj);
                            const inMonth = day.getMonth() === visibleMonth.getMonth();
                            return (
                              <button
                                key={toLocalISODate(day)}
                                type="button"
                                onClick={() => selectSingleDay(day)}
                                className={cn(
                                  "mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold tabular-nums transition",
                                  selected
                                    ? "bg-gradient-to-br from-[#62A8FF] to-[#8B5CF6] text-white shadow-[0_0_24px_rgba(139,92,246,0.42)]"
                                    : inMonth
                                      ? "text-white/78 hover:bg-white/[0.07] hover:text-white"
                                      : "text-white/20 hover:bg-white/[0.04]",
                                )}
                              >
                                {day.getDate()}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>,
                  document.body,
                )}
              </div>
            </div>
          }
        />
      )}
      {tab === "stats" && <StatsView businessId={businessId} empId={empId} from={fromDate} to={toDate} commissionPct={Number(active?.commission_pct ?? 0)} commissionFixed={Number(active?.commission_fixed ?? 0)} />}
      {tab === "historial-servicios" && <HistorialView businessId={businessId} empId={empId} commissionPct={Number(active?.commission_pct ?? 0)} from={fromDate} to={toDate} />}
      {tab === "historial-pagos" && <PagosView businessId={businessId} empId={empId} userEmail={profile?.email ?? null} from={fromDate} to={toDate} />}
      </div>
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


function fmtMoney(n: number) {
  return "$" + Math.round(n).toLocaleString("es-AR");
}

type ProfessionalAppointmentProduct = {
  name: string;
  amount: number;
};

function parseProfessionalProductsFromNotes(raw?: string | null): ProfessionalAppointmentProduct[] {
  if (!raw) return [];

  const match = raw.match(/Productos agregados:\s*([\s\S]*?)(?:\n\s*\n|$)/i);
  const block = match?.[1]?.trim();
  if (!block) return [];

  return block
    .split(/\n+/)
    .map((line) => line.trim().replace(/^[-•]\s*/, ""))
    .filter(Boolean)
    .map((line) => {
      const parsed = line.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      const name = (parsed?.[1] ?? line).trim();
      const priceText = parsed?.[2] ?? "";
      const amount = Number(priceText.replace(/[^0-9,-]/g, "").replace(",", ".")) || 0;
      return { name, amount };
    })
    .filter((product) => product.name.length > 0);
}

function stripBookingMetadataFromNote(raw?: string | null): string | null {
  if (!raw) return null;

  let clean = raw.replace("[PENDIENTE_CAJA]", "").trim();
  const clientNoteMatch = clean.match(/Notas del cliente:\s*([\s\S]*)/i);
  if (clientNoteMatch) clean = clientNoteMatch[1];

  clean = clean
    .split(/\s*(?:Productos agregados|Email|Origen|Tel[eé]fono|Fecha de nacimiento|Servicios seleccionados)\s*:/i)[0]
    .trim();

  return clean || null;
}

// ── Shared helpers (mirrors agenda.tsx) ──────────────────────────────────────
const DAY_MS = 86_400_000;
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d: Date)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }

function parseScheduleTime(value?: string | null) {
  if (!value) return 0;
  const [hh, mm = "0"] = String(value).split(":");
  return (Number(hh) || 0) + (Number(mm) || 0) / 60;
}

function minutesOfDayFromISO(value: string) {
  const d = new Date(value);
  return d.getHours() * 60 + d.getMinutes();
}

function minToHHMM(min: number) {
  const safe = Math.max(0, Math.min(24 * 60, Math.round(min)));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dateKeyAR(value: Date | string) {
  const d = typeof value === "string" ? new Date(value) : value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekdayKey(date: Date) {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][date.getDay()];
}

function readScheduleDay(schedule: any, empId: string | null, date: Date) {
  const key = weekdayKey(date);
  const dateKey = dateKeyAR(date);

  const empSpecial =
    empId && schedule?._employeeSpecialDates?.[empId]?.[dateKey]
      ? schedule._employeeSpecialDates[empId][dateKey]
      : null;
  if (empSpecial) return empSpecial;

  const businessSpecial = schedule?._businessSpecialDates?.[dateKey] ?? schedule?.specialDates?.[dateKey] ?? null;
  const employeeNormal =
    empId && schedule?._employeeSchedules?.[empId]?.[key]
      ? schedule._employeeSchedules[empId][key]
      : empId && schedule?.employees?.[empId]?.[key]
        ? schedule.employees[empId][key]
        : null;
  const businessNormal = schedule?.[key] ?? schedule?.days?.[key] ?? null;

  return employeeNormal ?? businessSpecial ?? businessNormal ?? null;
}

function readBreakRange(schedule: any, empId: string | null, date: Date) {
  const day = readScheduleDay(schedule, empId, date);
  if (!day || day.enabled === false || !day.breakStart || !day.breakEnd) return null;
  const startMin = Math.round(parseScheduleTime(day.breakStart) * 60);
  const endMin = Math.round(parseScheduleTime(day.breakEnd) * 60);
  return endMin > startMin ? { startMin, endMin } : null;
}

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

function TurnosView({ businessId, empId, fromDate, toDate, approvalMode, approvalModeEnabled, profile, canOperate, equipoEnabled, canAddTurno, canDeleteTurno, dateControl }: {
  businessId: string | null; empId: string | null;
  fromDate: string;
  toDate: string;
  approvalMode: "auto" | "manual" | "disabled";
  approvalModeEnabled: boolean;
  profile: { id: string; email?: string | null; full_name?: string | null } | null;
  canOperate: boolean;
  equipoEnabled: boolean;
  canAddTurno: boolean;
  canDeleteTurno: boolean;
  dateControl?: React.ReactNode;
}) {
  const from = fromDate;
  const to = toDate;

  const { data: turnos = [], isLoading, refetch } = useProfTurnos(businessId, empId, from, to);
  const [historialVersion, setHistorialVersion] = React.useState(0);
  const [businessSchedule, setBusinessSchedule] = React.useState<any>(null);

  // Mismos datos/hooks que usan Agenda general y Caja — así "+ Nuevo turno" y
  // "Cliente sin turno" reutilizan sus modales/flujos reales tal cual, sin
  // reimplementar nada.
  const agendaRangeStart = React.useMemo(() => new Date(`${from}T00:00:00`), [from]);
  const agendaRangeEnd = React.useMemo(() => new Date(`${from}T23:59:59`), [from]);
  const agendaData = useAgendaData(agendaRangeStart, agendaRangeEnd);
  const lockedEmployees = React.useMemo(
    () => agendaData.employees.filter((e) => e.id === empId),
    [agendaData.employees, empId],
  );

  // Hora por defecto de "+ Nuevo turno": la hora de INICIO de la jornada
  // laboral configurada para este profesional en `from` (prioridad especial
  // del profesional → semanal del profesional → especial del negocio →
  // semanal del negocio, misma resolución que usa Agenda/reserva online) —
  // nunca un valor fijo. "09:00" solo queda como último recurso si el día
  // no tiene horario configurado (nada que resolver).
  const defaultTurnoStartsAt = React.useMemo(() => {
    const day = resolveDaySchedule(
      agendaData.schedule,
      agendaData.employeeSchedules,
      agendaData.businessSpecialDates,
      agendaData.employeeSpecialDates,
      empId,
      agendaRangeStart,
    );
    const startTime = day?.enabled && day.start ? day.start : "09:00";
    return new Date(`${from}T${startTime}:00`);
  }, [agendaData.schedule, agendaData.employeeSchedules, agendaData.businessSpecialDates, agendaData.employeeSpecialDates, empId, agendaRangeStart, from]);
  const cajaData = useCajaData();

  React.useEffect(() => {
    if (!businessId) {
      setBusinessSchedule(null);
      return;
    }
    supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => setBusinessSchedule((data?.schedule as any) ?? null));
  }, [businessId]);

  React.useEffect(() => {
    if (turnos.length > 0) {
      syncHistorialFromDB(turnos.map(t => t.id)).then(() => setHistorialVersion(v => v + 1));
    }
  }, [turnos]);

  const [cobroTurno, setCobroTurno] = useState<import("@/hooks/use-professionals-data").ProfTurno | null>(null);
  const [walkInChargeOpen, setWalkInChargeOpen] = useState(false);
  // El modal de "+ Venta" es un div fixed a mano (no Radix), así que no
  // bloquea el scroll de fondo por su cuenta — sin esto, hacer scroll
  // dentro del formulario también arrastraba la pantalla de atrás.
  useBodyScrollLock(approvalMode !== "disabled" && walkInChargeOpen && !!businessId && !!empId);
  const [addTurnoOpen, setAddTurnoOpen] = useState(false);
  const [notaTurno, setNotaTurno] = useState<import("@/hooks/use-professionals-data").ProfTurno | null>(null);
  const [canceladosOpen, setCanceladosOpen] = useState(false);
  const [confirmadosOpen, setConfirmadosOpen] = useState(false);
  const [pendientesOpen, setPendientesOpen] = useState(false);
  const [cobradosOpen, setCobradosOpen] = useState(false);
  useBodyScrollLock(canceladosOpen || confirmadosOpen || pendientesOpen || cobradosOpen);
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
    `${new Date(value).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}hs`;
  const formatDate = (value: string) => {
    const d = new Date(value);
    const day = d.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");
    return `${day.charAt(0).toUpperCase() + day.slice(1)} ${d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}`;
  };

  function getNoteDisplay(t: import("@/hooks/use-professionals-data").ProfTurno) {
    return stripBookingMetadataFromNote(t.notes);
  }

  function hasProductBadge(t: import("@/hooks/use-professionals-data").ProfTurno) {
    return parseProfessionalProductsFromNotes(t.notes).length > 0;
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
  const confirmedTurnos = React.useMemo(() =>
    turnos.filter(t => t.status === "confirmed" || t.status === "approved"),
    [turnos]
  );
  const chargedTurnos = React.useMemo(() =>
    turnos.filter(t => getTurnoMeta(t).isCharged),
    [turnos]
  );
  // Mismo criterio "todo lo demás" que ya usa counts.pendientes: ni
  // cancelado, ni cobrado, ni confirmado.
  const pendingTurnosList = React.useMemo(() =>
    turnos.filter(t => {
      const meta = getTurnoMeta(t);
      return !meta.isCancelled && !meta.isCharged && !meta.isConfirmed;
    }),
    [turnos, sentToCajaIds]
  );

  // Style per status
  function getBlockStyle(t: import("@/hooks/use-professionals-data").ProfTurno) {
    const { isPending, isCharged, isConfirmed } = getTurnoMeta(t);
    // Cobrado se ve claramente verde a simple vista (fondo/ring más
    // intensos que el resto de los estados) — pedido explícito para poder
    // identificarlo de un vistazo en la lista de Mi Agenda, no solo por el
    // label de texto.
    if (isCharged) return {
      border: "border-l-emerald-400",
      bg: "bg-emerald-500/[0.16]",
      ring: "ring-emerald-400/35",
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
      onClick: counts.pendientes > 0 ? () => setPendientesOpen(true) : undefined,
    },
    {
      label: "Confirmados",
      count: counts.confirmados,
      color: "text-violet-300",
      bg: "bg-violet-500/10",
      ring: "ring-violet-400/20",
      dot: "bg-violet-400",
      onClick: counts.confirmados > 0 ? () => setConfirmadosOpen(true) : undefined,
    },
    {
      label: "Cobrados",
      count: counts.finalizados,
      color: "text-emerald-300",
      bg: "bg-emerald-500/10",
      ring: "ring-emerald-400/20",
      dot: "bg-emerald-400",
      onClick: counts.finalizados > 0 ? () => setCobradosOpen(true) : undefined,
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

  const HOUR_HEIGHT = 92;
  const TIMELINE_TOP_OFFSET = 36;
  const agendaTurnos = React.useMemo(
    () => [...activeTurnos].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()),
    [activeTurnos]
  );

  const timelineBaseDate = React.useMemo(() => {
    const first = agendaTurnos[0]?.starts_at ?? `${from}T11:00:00`;
    return new Date(first);
  }, [agendaTurnos, from]);

  const breakRange = React.useMemo(
    () => readBreakRange(businessSchedule, empId, timelineBaseDate),
    [businessSchedule, empId, timelineBaseDate],
  );

  const dayBounds = React.useMemo(() => {
    const mins = [
      11 * 60,
      20 * 60,
      ...agendaTurnos.flatMap((t) => {
        const start = minutesOfDayFromISO(t.starts_at);
        const end = t.ends_at
          ? minutesOfDayFromISO(t.ends_at)
          : start + 30;
        return [start, end];
      }),
      ...(breakRange ? [breakRange.startMin, breakRange.endMin] : []),
    ];
    const minHour = Math.floor(Math.min(...mins) / 60);
    const maxHour = Math.ceil(Math.max(...mins) / 60);
    return {
      startHour: Math.max(0, minHour),
      endHour: Math.min(24, maxHour),
    };
  }, [agendaTurnos, breakRange]);

  const timelineHours = React.useMemo(
    () => Array.from({ length: dayBounds.endHour - dayBounds.startHour + 1 }, (_, i) => dayBounds.startHour + i),
    [dayBounds.startHour, dayBounds.endHour],
  );

  const minutesFromDayStart = (value: string) => Math.max(0, minutesOfDayFromISO(value) - dayBounds.startHour * 60);
  const getBlockTop = (value: string) => (minutesFromDayStart(value) / 60) * HOUR_HEIGHT;
  const getTurnoEndMin = (t: import("@/hooks/use-professionals-data").ProfTurno) => {
    const startMin = minutesOfDayFromISO(t.starts_at);
    if (t.ends_at) return minutesOfDayFromISO(t.ends_at);
    return startMin + 30;
  };
  const getBlockHeight = (t: import("@/hooks/use-professionals-data").ProfTurno) => {
    const startMin = minutesOfDayFromISO(t.starts_at);
    const endMin = getTurnoEndMin(t);
    const durationMin = Math.max(15, endMin - startMin);
    return Math.max(44, (durationMin / 60) * HOUR_HEIGHT - 6);
  };
  const timelineHeight = (dayBounds.endHour - dayBounds.startHour) * HOUR_HEIGHT + TIMELINE_TOP_OFFSET + 36;

  return (
    <div className="w-full space-y-2 animate-fade-up">

      {/* Una sola fila: Hoy/fecha a la izquierda, acciones a la derecha.
          Dos permisos independientes: el modo de cobro del profesional
          habilita Cobrar/Enviar (con o sin turno); el switch "Puede agregar
          turnos" habilita crear turnos agendados. No se mezclan. */}
      {/* Sin margin-top propio: el aire de arriba ya lo garantiza el pb-3 de
          "Tabs" de arriba + el gap normal entre bloques. mb-4 separa esta
          fila de "Estados" (colapsa con el space-y-2 de TurnosView y deja
          ~16px). */}
      <div className="flex flex-nowrap items-center justify-between gap-2 mb-4">
        {dateControl ?? <div />}
        {(canAddTurno || approvalMode !== "disabled") && (
          <div className="flex shrink-0 flex-nowrap gap-1.5 sm:gap-2">
            {/* + Turno: violeta (identidad Clippr) — crear un turno nuevo.
                Enviar: celeste (el mismo que antes tenía + Turno) — acción
                operativa de mandar servicios a caja. + Venta (modo
                automático, cobra directo) sigue verde, en línea con el
                resto de la app donde verde = Cobrado. */}
            {canAddTurno && (
              <button
                type="button"
                onClick={() => setAddTurnoOpen(true)}
                className="inline-flex h-9 items-center gap-1 sm:gap-1.5 whitespace-nowrap rounded-xl bg-[linear-gradient(135deg,#A78BFA,#7C3AED)] px-2.5 sm:px-3 text-xs font-semibold text-white shadow-[0_0_18px_-4px_rgba(139,92,246,0.55)] transition hover:brightness-110"
              >
                <CalendarPlus className="h-3.5 w-3.5 shrink-0" />
                <span className="sm:hidden">+ Turno</span>
                <span className="hidden sm:inline">Nuevo turno</span>
              </button>
            )}
            {approvalMode !== "disabled" && (
              <button
                type="button"
                onClick={() => setWalkInChargeOpen(true)}
                className={cn(
                  "inline-flex h-9 items-center gap-1 sm:gap-1.5 whitespace-nowrap rounded-xl px-2.5 sm:px-3 text-xs font-semibold text-white transition hover:brightness-110",
                  approvalMode === "manual"
                    ? "bg-[linear-gradient(135deg,#60A5FA,#3B82F6)] shadow-[0_0_18px_-4px_rgba(96,165,250,0.55)]"
                    : "bg-[linear-gradient(135deg,#34D399,#10B981)] shadow-[0_0_18px_-4px_rgba(16,185,129,0.55)]"
                )}
              >
                <CreditCard className="h-3.5 w-3.5 shrink-0" />
                <span className="sm:hidden">{approvalMode === "manual" ? "Enviar" : "+ Venta"}</span>
                <span className="hidden sm:inline">{approvalMode === "manual" ? "Enviar" : "Nueva venta"}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Status cards — ocupan todo el ancho de la agenda. mb-4 (antes mb-1,
          quedaba pegado a la grilla horaria de abajo). */}
      <div className="grid w-full grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {statusCards.map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={card.onClick}
            disabled={!card.onClick}
            className={cn(
              "flex h-9 items-center justify-center gap-2 rounded-xl px-3 text-[11px] font-semibold transition-all ring-1",
              card.bg,
              card.ring,
              card.color,
              card.onClick ? "hover:brightness-110 cursor-pointer" : "cursor-default"
            )}
          >
            <span className="font-bold tabular-nums text-sm leading-none">{card.count}</span>
            <span className="opacity-90 leading-none">{card.label}</span>
          </button>
        ))}
      </div>

      {/* Agenda visual */}
      {isLoading ? (
        <div className="glass rounded-2xl py-10 text-center text-sm text-muted-foreground animate-pulse">Cargando turnos…</div>
      ) : agendaTurnos.length === 0 && !breakRange ? (
        <div className="glass rounded-2xl py-10 text-center text-sm text-muted-foreground">Sin turnos en este período.</div>
      ) : (
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.10] bg-[#111323] shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_18px_60px_-34px_rgba(0,0,0,0.95)]">
          {/* Columna de horarios: más angosta y discreta en mobile (64px,
              texto fino y gris apagado — referencia de fondo, no elemento
              principal) para devolverle ese ancho a la tarjeta del turno.
              Desktop (sm+) sin cambios: 84px, texto normal. */}
          <div className="absolute left-0 top-0 bottom-0 w-[48px] sm:w-[84px] bg-[#111323]" />
          <div className="absolute left-12 sm:left-[84px] top-0 bottom-0 w-px bg-white/[0.07]" />
          <div className="relative" style={{ height: timelineHeight }}>
            {timelineHours.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 border-t border-white/[0.065]"
                style={{ top: TIMELINE_TOP_OFFSET + (hour - dayBounds.startHour) * HOUR_HEIGHT }}
              >
                {/* Mobile: más angosto (48px), más fino (font-thin), más
                    apagado (white/20) y centrado dentro de su franja horaria
                    (top-10 ≈ mitad de HOUR_HEIGHT=92px) — referencia de
                    fondo, no protagonista. Desktop (sm+) sin cambios: pegado
                    a la línea de la hora, como siempre. */}
                <div className="absolute left-2 top-10 sm:left-5 sm:top-auto sm:-top-2.5 text-[10px] sm:text-sm font-thin sm:font-normal text-white/20 sm:text-white/50 tabular-nums">
                  {String(hour).padStart(2, "0")}:00
                </div>
              </div>
            ))}

            {breakRange && (
              <div
                className="pointer-events-none absolute left-[60px] sm:left-[104px] right-3 z-[1] flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-xl px-3 text-center"
                style={{
                  top: TIMELINE_TOP_OFFSET + ((breakRange.startMin - dayBounds.startHour * 60) / 60) * HOUR_HEIGHT + 6,
                  height: Math.max(44, ((breakRange.endMin - breakRange.startMin) / 60) * HOUR_HEIGHT - 6),
                  border: "1px solid rgba(148,163,184,0.28)",
                  background:
                    "repeating-linear-gradient(135deg, rgba(148,163,184,0.10) 0, rgba(148,163,184,0.10) 8px, rgba(148,163,184,0.18) 8px, rgba(148,163,184,0.18) 16px)",
                }}
              >
                <span className="text-[11px] font-bold uppercase tracking-wide leading-none text-slate-300/85">
                  Descanso
                </span>
                <span className="text-[11px] tabular-nums leading-none text-slate-400/80">
                  {minToHHMM(breakRange.startMin)} - {minToHHMM(breakRange.endMin)}
                </span>
              </div>
            )}

            {agendaTurnos.map((t) => {
              void historialVersion;
              const style = getBlockStyle(t);
              const noteText = getNoteDisplay(t);
              const historialDisplay = readHistorialCobro(t.id);
              const showActionBtn = canShowAction(t.status) && historialDisplay.length === 0;
              const { isSentToCaja } = getTurnoMeta(t);

              // Celda de acción (botón Cobrar-Enviar / Enviado / "—") — una
              // sola definición, reusada tal cual en el layout compacto de
              // mobile y en el grid de desktop. Ya NO muestra quién
              // cobró/envió acá: esa info vive únicamente en Historial de
              // ventas (pedido explícito — Mi Agenda queda limpia, solo
              // información del turno y su estado). historialDisplay solo
              // se usa para decidir si el botón sigue teniendo sentido.
              // Enviado (gris, deshabilitado, ✓): reemplaza al botón
              // Enviar en cuanto el profesional lo tocó, para que no se
              // pueda enviar dos veces — el turno en sí no cambia de
              // estado ni de color, solo cambia el botón.
              const actionCell = showActionBtn ? (
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
              ) : isSentToCaja ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 whitespace-nowrap bg-white/5 ring-white/15 text-muted-foreground cursor-not-allowed"
                >
                  <span aria-hidden>✓</span> Enviado
                </button>
              ) : (
                <span className="text-[11px] text-muted-foreground">—</span>
              );

              const canDeleteThisTurno =
                canDeleteTurno && !["cancelled", "charged"].includes(t.status);
              const deleteCell = canDeleteThisTurno ? (
                <button
                  type="button"
                  title="Cancelar turno"
                  onClick={async () => {
                    if (!window.confirm("¿Cancelar este turno?")) return;
                    try {
                      // name: nombre visible real (profile.full_name), no el
                      // email — cancelAppointment ahora escribe el evento
                      // "Canceló" del historial internamente con este valor.
                      await cancelAppointment(t.id, {
                        userId: profile?.id ?? null,
                        name: profile?.full_name ?? emailUsername(profile?.email ?? null),
                        role: "profesional",
                      });
                      toast.success("Turno cancelado");
                      refetch();
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                  className="shrink-0 rounded-lg px-1.5 text-rose-400/70 transition hover:bg-rose-500/10 hover:text-rose-300"
                >
                  ✕
                </button>
              ) : null;

              return (
                <div
                  key={t.id}
                  className={cn(
                    "absolute left-[60px] sm:left-[104px] right-3 z-[2] rounded-xl border-l-[3px] ring-1 px-3 py-1.5 transition-all overflow-hidden",
                    style.border, style.bg, style.ring
                  )}
                  style={{ top: TIMELINE_TOP_OFFSET + getBlockTop(t.starts_at) + 6, height: getBlockHeight(t) }}
                >
                  {/* Mobile (<sm): fila compacta — línea 1 hora (fina, celeste)
                      + nombre del cliente (usa el ancho disponible, trunca
                      solo si no entra); línea 2 servicio (más chico, gris
                      claro). Acción (Cobrar/Enviar/historial) + cancelar
                      siempre visibles a la derecha, sin cambios de lógica ni
                      tamaño. El grid de desktop de abajo queda oculto acá. */}
                  <div className="flex h-full items-center justify-between gap-2 sm:hidden">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className={cn("shrink-0 text-[10px] font-normal tabular-nums", style.labelColor)}>
                          {minToHHMM(minutesOfDayFromISO(t.starts_at))} · {minToHHMM(getTurnoEndMin(t))}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                          {t.client_name ?? "Sin cliente"}
                        </span>
                      </div>
                      <div className="truncate text-[10.5px] text-muted-foreground/70">
                        {t.service_name ?? "—"}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      {actionCell}
                      {deleteCell}
                    </div>
                  </div>

                  {/* Desktop (sm+): grid original, sin cambios. */}
                  <div className="hidden h-full grid-cols-[112px_minmax(120px,0.85fr)_auto_minmax(170px,1.25fr)_auto_auto] items-center gap-3 sm:grid">
                    <div className={cn("min-w-0 text-xs font-semibold tabular-nums", style.labelColor)}>
                      {minToHHMM(minutesOfDayFromISO(t.starts_at))} - {minToHHMM(getTurnoEndMin(t))}
                    </div>

                    <div className="min-w-0 truncate text-xs font-semibold text-foreground">
                      {t.client_name ?? "Sin cliente"}
                    </div>

                    <span className={cn(
                      "justify-self-start whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1",
                      style.bg, style.ring, style.labelColor
                    )}>
                      {style.label}
                    </span>

                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs text-muted-foreground">{t.service_name ?? "—"}</span>
                      {hasProductBadge(t) && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[10px] font-semibold text-amber-300">
                          <span aria-hidden>⭐</span>
                          <span>Producto</span>
                        </span>
                      )}
                    </div>

                    <div className="min-w-[70px] justify-self-start">
                      {noteText ? (
                        <button
                          type="button"
                          onClick={() => setNotaTurno(t)}
                          className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-semibold text-sky-300/80 hover:text-sky-300 transition"
                        >
                          📄 Ver nota
                        </button>
                      ) : null}
                    </div>

                    <div className="min-w-[92px] max-w-[260px] justify-self-end flex items-center justify-end gap-1 text-right">
                      {actionCell}
                      {deleteCell}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modals */}
      {/* Cobrar/Enviar un turno — mismo componente y flujo que "+ Venta"
          (NuevaVentaTab), no un diseño de cobro aparte. Se precarga como
          pendingCharge (mismo mecanismo que usa Caja → Pendientes) pero
          arrancando en el paso Servicios (pendingChargeInitialStep=3) para
          poder revisar/agregar antes de pagar, con los productos ya
          reservados en las notas del turno precargados también
          (pendingChargeExtraItems). turnoChargeMode bifurca el cobro:
          "auto" cobra directo (mismo camino que la cola de Pendientes),
          "manual" envía a Caja sin cobrar (onManualSend hace el guardado
          local + historial que antes hacía el CobroModal viejo). */}
      {canOperate && cobroTurno && businessId && empId && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-3 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:items-center bg-black/80"
          onClick={() => setCobroTurno(null)}
        >
          <div className="relative w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setCobroTurno(null)}
              className="absolute -top-3 -right-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20"
            >
              ✕
            </button>
            <NuevaVentaTab
              data={cajaData}
              userEmail={profile?.email ?? null}
              lockedEmployeeId={empId}
              variant="modal"
              onCancel={() => setCobroTurno(null)}
              pendingCharge={{
                id: cobroTurno.id,
                client_name: cobroTurno.client_name,
                service_name: cobroTurno.service_name,
                service_price: cobroTurno.service_price,
                employee_id: empId,
                starts_at: cobroTurno.starts_at,
                notes: cobroTurno.notes,
                status: cobroTurno.status,
              }}
              pendingChargeInitialStep={3}
              pendingChargeExtraItems={parseProfessionalProductsFromNotes(cobroTurno.notes).map((p) => ({ name: p.name, price: p.amount }))}
              turnoChargeMode={approvalMode === "manual" ? "manual" : "auto"}
              chargedByName={profile?.full_name ?? null}
              onManualSend={async ({ total, items }) => {
                if (!cobroTurno) return;
                const itemsStr = items.map((i) => `${i.serviceName} ${fmtMoney(i.amount)}`).join(", ");
                saveManualPendingCharge({
                  id: cobroTurno.id,
                  business_id: businessId,
                  employee_id: empId,
                  client_name: cobroTurno.client_name ?? null,
                  service_name: items.map((i) => i.serviceName).join(" + "),
                  service_price: total,
                  starts_at: cobroTurno.starts_at,
                  notes: `[PENDIENTE_CAJA] ${itemsStr}`,
                });
                await appendHistorialCobro(cobroTurno.id, {
                  time: new Date().toTimeString().slice(0, 5),
                  user: profile?.full_name ?? emailUsername(profile?.email ?? null),
                  role: "profesional",
                  action: "Envió a caja",
                });
                setSentToCajaIds((prev) => new Set([...prev, cobroTurno.id]));
                setCobroTurno(null);
                refetch();
              }}
              onPendingDone={() => {
                setCobroTurno(null);
                refetch();
                cajaData.refresh();
              }}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* + Nuevo turno — el mismo AppointmentDialog que usa Agenda → Nuevo
          turno (misma lógica de guardado, mismas validaciones de horario),
          con el profesional ya fijo (un solo elemento en `employees`). */}
      {canAddTurno && addTurnoOpen && businessId && empId && (
        <AppointmentDialog
          open={addTurnoOpen}
          onOpenChange={(open) => { if (!open) setAddTurnoOpen(false); }}
          appointment={null}
          defaultEmployeeId={empId}
          defaultStartsAt={defaultTurnoStartsAt}
          employees={lockedEmployees}
          services={agendaData.services}
          clients={agendaData.clients}
          businessId={businessId}
          createdByName={profile?.email ?? null}
          createdByRole="profesional"
          onSaved={() => { setAddTurnoOpen(false); refetch(); }}
          schedule={agendaData.schedule}
          employeeSchedules={agendaData.employeeSchedules}
          businessSpecialDates={agendaData.businessSpecialDates}
          employeeSpecialDates={agendaData.employeeSpecialDates}
          employeeServiceOverrides={agendaData.employeeServiceOverrides}
          presentation="modal"
        />
      )}

      {/* Nueva venta — el mismo NuevaVentaTab que usa Caja → Nueva
          venta (mismo flujo de cobro/envío a caja), con el profesional
          bloqueado en el paso 1. */}
      {approvalMode !== "disabled" && walkInChargeOpen && businessId && empId && typeof document !== "undefined" && createPortal(
        <div
          // overflow-y-auto + items-start acá (no solo items-center): la
          // tarjeta interna mide su alto en base a 100vh, que en iOS no se
          // achica cuando aparece el teclado — sin poder scrollear este
          // overlay, la parte de abajo del formulario (botón de confirmar)
          // quedaba inalcanzable, tapada detrás del teclado. pb usa
          // env(safe-area-inset-bottom): el mismo cálculo se replica en el
          // style de NuevaVentaTab (variant="modal") para que su alto
          // encaje exacto con lo que este padding realmente consume.
          //
          // createPortal a document.body: este div vivía dentro del
          // <div className="relative z-10"> que AppShell pone alrededor
          // del contenido de la página — eso crea su propio stacking
          // context, y ahí adentro el z-50 de este modal nunca llega a
          // competir con la barra inferior "Mi Agenda" (fixed, z-40, pero
          // hermana de <main> en el árbol raíz). Resultado real en
          // iPhone: la barra de abajo pintaba encima del footer del
          // modal. Portalear a document.body lo saca de ese contenedor,
          // así compite en el stacking context raíz donde z-50 sí le
          // gana a la barra.
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-3 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:items-center bg-black/80"
          onClick={() => setWalkInChargeOpen(false)}
        >
          <div className="relative w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setWalkInChargeOpen(false)}
              className="absolute -top-3 -right-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20"
            >
              ✕
            </button>
            <NuevaVentaTab
              data={cajaData}
              userEmail={profile?.email ?? null}
              lockedEmployeeId={empId}
              variant="modal"
              onCancel={() => setWalkInChargeOpen(false)}
              onSaleDone={() => {
                setWalkInChargeOpen(false);
                refetch();
                cajaData.refresh();
              }}
              turnoChargeMode={approvalMode === "manual" ? "manual" : "auto"}
              chargedByName={profile?.full_name ?? null}
              onManualSend={async () => {
                setWalkInChargeOpen(false);
                refetch();
                cajaData.refresh();
              }}
            />
          </div>
        </div>,
        document.body,
      )}

      {notaTurno && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 -sm" onClick={() => setNotaTurno(null)}>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 -sm" onClick={() => setCanceladosOpen(false)}>
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
                          <div className="text-xs font-semibold text-rose-300">{attributionLabel(cancelEvent)}</div>
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

      {/* Confirmados modal — mismo patrón que Cancelados: X, click afuera,
          scroll de fondo bloqueado mientras está abierto. */}
      {confirmadosOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setConfirmadosOpen(false)}>
          <div className="glass-strong rounded-3xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/10 shrink-0">
              <div>
                <div className="font-semibold text-base">Turnos confirmados</div>
                <div className="text-xs text-muted-foreground mt-0.5">{confirmedTurnos.length} turno{confirmedTurnos.length !== 1 ? "s" : ""} confirmado{confirmedTurnos.length !== 1 ? "s" : ""}</div>
              </div>
              <button type="button" onClick={() => setConfirmadosOpen(false)}
                className="rounded-xl p-2 text-muted-foreground hover:text-white hover:bg-white/[0.08] transition">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
              {confirmedTurnos.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Sin turnos confirmados en este período.</p>
              ) : confirmedTurnos.map((t) => (
                <div key={t.id} className="rounded-2xl bg-violet-500/[0.06] ring-1 ring-violet-400/15 border-l-[3px] border-l-violet-400 px-4 py-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground">{t.client_name ?? "Sin cliente"}</span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 bg-violet-500/10 ring-violet-400/20 text-violet-300">Confirmado</span>
                      </div>
                      <div className="text-sm text-muted-foreground">{t.service_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(t.starts_at)} · {formatTime(t.starts_at)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Pendientes modal — mismo patrón. */}
      {pendientesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setPendientesOpen(false)}>
          <div className="glass-strong rounded-3xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/10 shrink-0">
              <div>
                <div className="font-semibold text-base">Turnos pendientes</div>
                <div className="text-xs text-muted-foreground mt-0.5">{pendingTurnosList.length} turno{pendingTurnosList.length !== 1 ? "s" : ""} pendiente{pendingTurnosList.length !== 1 ? "s" : ""}</div>
              </div>
              <button type="button" onClick={() => setPendientesOpen(false)}
                className="rounded-xl p-2 text-muted-foreground hover:text-white hover:bg-white/[0.08] transition">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
              {pendingTurnosList.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Sin turnos pendientes en este período.</p>
              ) : pendingTurnosList.map((t) => (
                <div key={t.id} className="rounded-2xl bg-sky-500/[0.06] ring-1 ring-sky-400/15 border-l-[3px] border-l-sky-400 px-4 py-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground">{t.client_name ?? "Sin cliente"}</span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 bg-sky-500/10 ring-sky-400/20 text-sky-300">Pendiente</span>
                      </div>
                      <div className="text-sm text-muted-foreground">{t.service_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(t.starts_at)} · {formatTime(t.starts_at)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Cobrados modal — mismo patrón. */}
      {cobradosOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setCobradosOpen(false)}>
          <div className="glass-strong rounded-3xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/10 shrink-0">
              <div>
                <div className="font-semibold text-base">Turnos cobrados</div>
                <div className="text-xs text-muted-foreground mt-0.5">{chargedTurnos.length} turno{chargedTurnos.length !== 1 ? "s" : ""} cobrado{chargedTurnos.length !== 1 ? "s" : ""}</div>
              </div>
              <button type="button" onClick={() => setCobradosOpen(false)}
                className="rounded-xl p-2 text-muted-foreground hover:text-white hover:bg-white/[0.08] transition">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
              {chargedTurnos.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Sin turnos cobrados en este período.</p>
              ) : chargedTurnos.map((t) => (
                <div key={t.id} className="rounded-2xl bg-emerald-500/[0.06] ring-1 ring-emerald-400/15 border-l-[3px] border-l-emerald-400 px-4 py-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground">{t.client_name ?? "Sin cliente"}</span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 bg-emerald-500/10 ring-emerald-400/20 text-emerald-300">Cobrado</span>
                      </div>
                      <div className="text-sm text-muted-foreground">{t.service_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(t.starts_at)} · {formatTime(t.starts_at)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function StatsView({
  businessId, empId, from, to, commissionPct, commissionFixed,
}: {
  businessId: string | null;
  empId: string | null;
  from: string;
  to: string;
  commissionPct: number;
  commissionFixed: number;
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
      <ServiciosDesglose sales={sales} businessId={businessId} commissionPct={commissionPct} commissionFixed={commissionFixed} />
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
          <div className="text-2xl font-display font-light tracking-tight">Desglose</div>
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
            const hora = dt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
            const rawPayer = String(p.created_by ?? "").trim();
            const payer = rawPayer
              ? (rawPayer.includes("@") ? rawPayer.split("@")[0] || "Caja" : rawPayer)
              : "Caja";
            return (
              <div key={p.id} className={cn("flex items-center gap-4 px-5 py-3.5", i < payments.length - 1 && "border-b border-white/5")}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium capitalize">{fecha}</div>
                  <div className="text-xs text-muted-foreground">{hora} hs · {payer} pagó · {p.method ?? "Sin método"}{p.note ? " · " + p.note : ""}</div>
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
  const timePart = date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${formattedDay} ${datePart} ${timePart}`;
}

function methodLabel(method?: string | null) {
  if (!method) return "—";
  return METHOD_LABELS[method] ?? METHOD_LABELS[method.toLowerCase()] ?? method;
}

// "Efectivo" o, si fue pago múltiple, "Efectivo • Transferencia" — sin
// importes por método (eso es del detalle de la venta, no de este listado).
function methodsSummary(methods: string[]): string {
  if (methods.length === 0) return "—";
  return methods.map((m) => PAY_METHOD_LABEL[m as PayMethod] ?? methodLabel(m)).join(" • ");
}

// Badge de estado del ciclo de vida de la venta en Historial de ventas —
// null (turno nunca enviado ni cobrado) no muestra nada, para no ensuciar
// filas que ya se veían así antes de este cambio.
function SaleStatusBadge({ status }: { status: "pendiente" | "cobrado" | "rechazado" | null }) {
  // "rechazado" no repite badge acá arriba — pedido explícito: la palabra
  // "Rechazó" ya se ve en rojo en la línea de historial de abajo, alcanza.
  if (!status || status === "rechazado") return null;
  const meta = {
    pendiente: { dot: "🟡", label: "Enviado a Caja", cls: "bg-sky-500/10 ring-sky-400/25 text-sky-300" },
    cobrado: { dot: "🟢", label: "Cobrado", cls: "bg-emerald-500/10 ring-emerald-400/25 text-emerald-300" },
  }[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 whitespace-nowrap", meta.cls)}>
      {meta.dot} {meta.label}
    </span>
  );
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
    // Método(s) de pago usados — varios si fue pago múltiple (ej. Efectivo +
    // Transferencia). Sin importes acá a propósito: eso es para el detalle
    // de la venta, no para este listado.
    methods: string[];
    // Historial completo (Envió a caja / Cobró / Rechazó), en orden
    // cronológico — para turnos sale de appointments.cobro_events
    // (readHistorialCobro); para ventas directas sin turno, del marcador en
    // payments.observations (no hay appointment al que asociar cobro_events
    // en ese caso).
    histEvents: { time: string; user: string; action: string }[];
    // Estado del ciclo de vida de la venta, derivado del último evento del
    // historial (o de la existencia de un pago) — null cuando el turno
    // nunca se envió ni se cobró (no hay nada que mostrar como estado).
    status: "pendiente" | "cobrado" | "rechazado" | null;
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

  // Refresco en tiempo real: cuando el profesional envía/cobra/rechaza una
  // venta (desde acá mismo o desde Caja, en otro dispositivo), este
  // historial tiene que reflejarlo sin recargar la página. El aviso local
  // (mismo navegador) llega por evento custom; el canal realtime cubre
  // otros dispositivos/sesiones.
  const [refreshTick, setRefreshTick] = React.useState(0);
  React.useEffect(() => {
    const bump = () => setRefreshTick((v) => v + 1);
    window.addEventListener("clippr:manual-pending-updated", bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener("clippr:manual-pending-updated", bump);
      window.removeEventListener("storage", bump);
    };
  }, []);
  React.useEffect(() => {
    if (!businessId) return;
    const bump = () => setRefreshTick((v) => v + 1);
    const channel = supabase
      .channel(`historial-ventas-${businessId}-${empId ?? "none"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `business_id=eq.${businessId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "business_settings", filter: `business_id=eq.${businessId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `business_id=eq.${businessId}` }, bump)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [businessId, empId]);

  React.useEffect(() => {
    if (!businessId || !empId || turnosLoading) return;

    setEnrichLoading(true);
    (async () => {
      const fromDate = new Date(from + "T00:00:00");
      fromDate.setDate(fromDate.getDate() - 1);
      const toDate = new Date(to + "T23:59:59");
      toDate.setDate(toDate.getDate() + 1);

      // "splits" (métodos de pago múltiple) puede no existir todavía como
      // columna en `payments` — un SELECT con una columna inexistente tira
      // error duro (PGRST 42703), y sin chequear `error` acá `payments`
      // quedaba en null (rompiendo TODO el merge de pagos, no solo los
      // métodos). Reintentar sin "splits" evita perder el resto del
      // Historial si la columna no está.
      let payments: any[] | null;
      let paymentsError: { code?: string; message: string } | null;
      ({ data: payments, error: paymentsError } = await supabase
        .from("payments")
        .select("id,appointment_id,client_name,service_name,total,amount,method,payment_method,splits,observations,created_at")
        .eq("business_id", businessId)
        .eq("employee_id", empId)
        .gte("created_at", fromDate.toISOString())
        .lte("created_at", toDate.toISOString()));
      if (paymentsError?.code === "42703") {
        ({ data: payments } = await supabase
          .from("payments")
          .select("id,appointment_id,client_name,service_name,total,amount,method,payment_method,observations,created_at")
          .eq("business_id", businessId)
          .eq("employee_id", empId)
          .gte("created_at", fromDate.toISOString())
          .lte("created_at", toDate.toISOString()));
      }

      // Métodos usados por un pago — varios si fue pago múltiple (splits),
      // uno solo si no. Sin importes: eso queda para el detalle de la venta.
      const methodsOf = (p: { method?: string | null; payment_method?: string | null; splits?: unknown }): string[] => {
        const splits = p.splits as { method: string }[] | null | undefined;
        if (Array.isArray(splits) && splits.length > 0) {
          return splits.map((s) => s.method).filter(Boolean);
        }
        const single = p.method ?? p.payment_method ?? null;
        return single ? [single] : [];
      };

      const payByAppt = new Map<string, { id: string; total: number | null; amount: number | null; method?: string | null; payment_method?: string | null; splits?: unknown }>();
      for (const p of payments ?? []) {
        if (p.appointment_id) payByAppt.set(p.appointment_id, p);
      }

      // Estado (🟡 Enviado a Caja / 🟢 Cobrado / 🔴 Rechazado) según el
      // último evento del historial — un pago ya registrado siempre gana
      // (más confiable que el historial, que podría no haberse persistido).
      const deriveStatus = (events: { action: string }[], hasPay: boolean): "pendiente" | "cobrado" | "rechazado" | null => {
        if (hasPay) return "cobrado";
        const latest = events[events.length - 1];
        if (!latest) return null;
        if (latest.action === "Cobró") return "cobrado";
        if (latest.action === "Rechazó") return "rechazado";
        if (latest.action === "Envió a caja") return "pendiente";
        return null;
      };

      const rows: typeof enriched = [];
      const usedPaymentIds = new Set<string>();

      // useProfTurnos ya no filtra "cancelled" en la query (ver el hook:
      // el contador de Cancelados de TurnosView necesita verlos), así que
      // acá hay que excluirlos a mano — un turno cancelado no facturó
      // nada y no debe generar una fila de comisión.
      for (const t of turnos) {
        if (t.status === "cancelled" || t.status === "blocked") continue;
        const pay = payByAppt.get(t.id);
        if (pay) usedPaymentIds.add(pay.id);
        const localDate = new Date(t.starts_at).toLocaleDateString("sv-SE");
        if (localDate < from || localDate > to) continue;
        const events = readHistorialCobro(t.id);
        rows.push({
          id: t.id,
          fecha: localDate,
          client_name: t.client_name,
          service_name: t.service_name,
          total: pay ? Number(pay.total ?? pay.amount ?? t.service_price ?? 0) : Number(t.service_price ?? 0),
          commission: 0,
          sourceType: "turno",
          methods: pay ? methodsOf(pay) : [],
          histEvents: events,
          status: deriveStatus(events, !!pay),
        });
      }

      // Ventas directas sin turno
      for (const p of payments ?? []) {
        if (usedPaymentIds.has(p.id)) continue;
        if (p.appointment_id && payByAppt.has(p.appointment_id)) continue;
        const localDate = new Date(p.created_at).toLocaleDateString("sv-SE");
        if (localDate < from || localDate > to) continue;
        const events = decodePayHistNotes(p.observations);
        rows.push({
          id: p.id,
          fecha: localDate,
          client_name: p.client_name,
          service_name: p.service_name,
          total: Number(p.total ?? p.amount ?? 0),
          commission: 0,
          sourceType: "venta-directa",
          methods: methodsOf(p),
          histEvents: events,
          status: deriveStatus(events, true),
        });
      }

      // Ventas de mostrador enviadas a caja sin turno, todavía sin cobrar o
      // rechazadas — viven en business_settings.schedule._pendingWalkInSales
      // (nunca en `payments`/`appointments` mientras no se cobren; ver
      // handleCobrar en cash-register.tsx). Sin esto, el profesional no veía
      // acá nada de lo que envió hasta que Caja lo cobraba.
      {
        const { data: bsRow } = await supabase
          .from("business_settings")
          .select("schedule")
          .eq("business_id", businessId)
          .maybeSingle();
        const schedule = (bsRow?.schedule ?? {}) as Record<string, unknown>;
        const walkIns = (Array.isArray(schedule._pendingWalkInSales) ? schedule._pendingWalkInSales : []) as Array<{
          id: string; employee_id: string | null; client_name: string | null; service_name: string | null;
          service_price: number | null; starts_at: string; status?: string;
          events?: { time: string; user: string; action: string }[];
        }>;
        for (const w of walkIns) {
          if (w.employee_id !== empId) continue;
          const localDate = new Date(w.starts_at).toLocaleDateString("sv-SE");
          if (localDate < from || localDate > to) continue;
          const events = w.events ?? [];
          rows.push({
            id: w.id,
            fecha: localDate,
            client_name: w.client_name,
            service_name: w.service_name,
            total: Number(w.service_price ?? 0),
            commission: 0,
            sourceType: "venta-directa",
            methods: [],
            histEvents: events,
            status: deriveStatus(events, false),
          });
        }
      }

      const final = rows
        .map(r => ({ ...r, commission: Math.round(r.total * commissionPct / 100) }))
        .sort((a, b) => a.fecha < b.fecha ? 1 : -1);

      setEnriched(final);
      setEnrichLoading(false);
    })();
  }, [businessId, empId, from, to, turnos, turnosLoading, commissionPct, refreshTick]);

  const loading = isLoading || enrichLoading;

  const totalFacturado = enriched.reduce((s, r) => s + r.total, 0);
  const totalComisiones = enriched.reduce((s, r) => s + r.commission, 0);

  // Vista previa mobile: al entrar a "Historial de ventas" se muestran solo
  // las últimas 2-3 ventas (mismo `enriched`, ya ordenado por fecha
  // descendente) con un botón "Ver historial completo" que revela el resto.
  // Se resetea sola cada vez que se re-entra a esta pestaña porque el
  // componente se desmonta/monta con el tab (ver ProfessionalsPage). No
  // afecta a desktop, que siempre muestra la tabla completa.
  const [showFull, setShowFull] = React.useState(false);
  const showPreviewGate = !showFull && enriched.length > 3;
  const mobileRows = showPreviewGate ? enriched.slice(0, 3) : enriched;

  const renderMobileCard = (row: (typeof enriched)[number]) => {
    const [y, m, d] = row.fecha.split("-");
    const fechaDisplay = new Date(Number(y), Number(m) - 1, Number(d))
      .toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" })
      .replace(".", "");
    // Todos los eventos (Envió a caja / Cobró), uno debajo del otro en
    // orden cronológico — mismo formato "HH:MM Nombre → Acción" que ya
    // tenía Mi Agenda, misma posición de siempre (donde antes decía
    // "Cobrado por X"), sin moverla.
    const historialEvents = [...row.histEvents].sort((a, b) => a.time.localeCompare(b.time));
    return (
      <div key={row.id} className="glass rounded-2xl p-3">
        <div className="flex items-start justify-between gap-2">
          {/* Cliente + servicio agrupados en el MISMO contenedor (antes el
              servicio era un div aparte, hermano de esta fila completa —
              con items-start en la fila y la columna derecha más alta
              (3 líneas: método/total/comisión) contra esta de 2, la fila
              tomaba la altura de la derecha y el servicio quedaba
              "empujado" abajo, no pegado al cliente. Ahora está adentro de
              esta columna, así se apila directo debajo del cliente sin
              depender de la altura de la columna derecha). flex-col gap-0,
              sin justify-between/min-height/space-y acá adentro. */}
          <div className="flex min-w-0 flex-1 flex-col gap-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] capitalize text-muted-foreground tabular-nums">{fechaDisplay}</span>
              <SaleStatusBadge status={row.status} />
            </div>
            <div className="truncate text-sm font-semibold leading-tight text-foreground">{row.client_name ?? "Sin cliente"}</div>
            <div className="line-clamp-2 leading-tight text-xs text-muted-foreground">{row.service_name ?? "—"}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[11px] text-muted-foreground">{methodsSummary(row.methods)}</div>
            <div className="text-sm font-semibold tabular-nums text-foreground">${row.total.toLocaleString("es-AR")}</div>
            <div className="text-xs font-semibold tabular-nums text-cyan-300">Com. ${row.commission.toLocaleString("es-AR")}</div>
          </div>
        </div>
        {historialEvents.length > 0 && (
          <div className="mt-1.5 space-y-0.5 border-t border-white/5 pt-1.5">
            {historialEvents.map((ev, i) => (
              <div key={i} className="flex items-baseline gap-1.5 leading-none">
                <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0">{ev.time}</span>
                <span className="text-[10px] font-semibold text-white/80 whitespace-nowrap shrink-0">{ev.user}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">→</span>
                <span className={cn("text-[10px] font-medium whitespace-nowrap", ev.action === "Envió a caja" ? "text-sky-300" : ev.action === "Cobró" ? "text-emerald-300" : ev.action === "Rechazó" ? "text-rose-300" : "text-muted-foreground")}>{ev.action}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 animate-fade-up">
      <div className="max-w-5xl mx-auto space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>Total de ventas: <strong className="text-foreground">{enriched.length}</strong></span>
        </div>

        {loading ? (
          <div className="glass rounded-2xl py-8 text-center text-sm text-muted-foreground animate-pulse">Cargando…</div>
        ) : enriched.length === 0 ? (
          <div className="glass rounded-2xl py-8 text-center text-sm text-muted-foreground">Sin historial en este período</div>
        ) : (
          <>
            {/* Desktop (sm+): tabla, columna "Historial" reemplazada por una
                línea de atribución ("Cobrado por X" / "Enviado por X") debajo
                de Total/Comisión — mismo dato, formato pedido explícito, y
                ya no compite por su propia columna. */}
            <div className="hidden sm:block glass rounded-2xl overflow-hidden">
              {/* Header — same structure as TurnosView */}
              <div className="grid grid-cols-[14%_24%_34%_28%] px-5 py-3.5 border-b border-white/10 bg-white/[0.025] text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                <div>Fecha</div>
                <div>Cliente</div>
                <div>Servicio / Catálogo</div>
                <div className="text-right">Pago / Total / Comisión</div>
              </div>

              {enriched.map((row, i) => {
                void historialVersion;
                const [y, m, d] = row.fecha.split("-");
                const fechaDisplay = new Date(Number(y), Number(m) - 1, Number(d))
                  .toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" })
                  .replace(".", "");

                const historialEvents = [...row.histEvents].sort((a, b) => a.time.localeCompare(b.time));

                return (
                  <div
                    key={row.id}
                    className={cn(
                      "px-5 py-4 text-sm",
                      i < enriched.length - 1 && "border-b border-white/5"
                    )}
                  >
                    <div className="grid grid-cols-[14%_24%_34%_28%] items-start">
                      <div className="space-y-1 pt-0.5">
                        <div className="text-xs text-muted-foreground tabular-nums whitespace-nowrap capitalize">{fechaDisplay}</div>
                        <SaleStatusBadge status={row.status} />
                      </div>
                      <div className="font-medium truncate pr-2 pt-0.5">{row.client_name ?? "Sin cliente"}</div>
                      <div className="text-muted-foreground truncate pr-2 pt-0.5">{row.service_name ?? "—"}</div>
                      {/* Columna derecha: método(s) de pago, Total, Comisión
                          — apilados, sin importe por método (eso es del
                          detalle de la venta). */}
                      <div className="text-right pt-0.5">
                        <div className="text-[11px] text-muted-foreground truncate">{methodsSummary(row.methods)}</div>
                        <div className="font-semibold tabular-nums whitespace-nowrap text-xs">${row.total.toLocaleString("es-AR")}</div>
                        <div className="text-cyan-300 font-semibold tabular-nums whitespace-nowrap text-xs">Comisión ${row.commission.toLocaleString("es-AR")}</div>
                      </div>
                    </div>
                    {/* Línea(s) inferior(es): mismo lugar y formato que ya
                        tenía Mi Agenda (hora, nombre, flecha, acción con
                        color) — Envió a caja y Cobró, una debajo de la
                        otra en orden cronológico cuando hay ambas. */}
                    {historialEvents.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        {historialEvents.map((ev, idx) => (
                          <div key={idx} className="flex items-baseline justify-end gap-1.5 leading-none">
                            <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0">{ev.time}</span>
                            <span className="text-[10px] font-semibold text-white/80 whitespace-nowrap shrink-0">{ev.user}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">→</span>
                            <span className={cn("text-[10px] font-medium whitespace-nowrap", ev.action === "Envió a caja" ? "text-sky-300" : ev.action === "Cobró" ? "text-emerald-300" : ev.action === "Rechazó" ? "text-rose-300" : "text-muted-foreground")}>{ev.action}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Mobile (<sm): misma info que la tabla, en tarjetas verticales
                — nada de columnas comprimidas ni texto/importes superpuestos.
                Mismos datos, mismo `enriched`, ningún dato distinto al de
                web. Al entrar se ve solo una vista previa (últimas 2-3
                ventas) con botón para revelar el resto — ver showPreviewGate. */}
            <div className="sm:hidden space-y-2">
              {void historialVersion}
              {mobileRows.map(renderMobileCard)}
              {showPreviewGate && (
                <button
                  type="button"
                  onClick={() => setShowFull(true)}
                  className="w-full rounded-xl px-3 py-2.5 text-center text-xs font-semibold text-violet-300 transition hover:text-violet-200"
                >
                  Ver historial completo →
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
