import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  Loader2,
  Check,
  X,
  DollarSign,
  Pencil,
  CheckCircle2,
  MessageCircle,
  UserRound,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  useAgendaData,
  cancelAppointment,
  setAppointmentStatus,
  checkSchedule,
  type Appointment,
  type ApptStatus,
  getScheduleForDate,
  parseScheduleTime,
} from "@/components/agenda/use-agenda-data";
import { AppointmentDialog } from "@/components/agenda/appointment-dialog";
import { AgendaDrawer } from "@/components/agenda/agenda-drawer";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * Stable callback identity that always invokes the latest closure.
 * Lets us pass handlers to memoized children without breaking React.memo
 * and without dependency-array juggling (the "useEvent" pattern).
 */
function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = React.useRef(fn);
  React.useLayoutEffect(() => { ref.current = fn; });
  return React.useCallback(((...args: any[]) => ref.current(...args)) as T, []);
}

export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda — Clippr" },
      { name: "description", content: "Agenda diaria y semanal con turnos reales." },
    ],
  }),
  component: AgendaPage,
});

// ---------------------------------------------------------------------------
// Status visuals (mismos buckets que app.js)
// ---------------------------------------------------------------------------
const STATUS_META: Record<
  ApptStatus,
  { label: string; bg: string; border: string; dot: string }
> = {
  pending: {
    label: "Pendiente",
    bg: "oklch(0.38 0.2 220 / 0.4)",
    border: "oklch(0.72 0.2 210)",
    dot: "oklch(0.82 0.18 210)",
  },
  confirmed: {
    label: "Confirmado",
    bg: "oklch(0.4 0.24 300 / 0.35)",
    border: "oklch(0.72 0.25 300)",
    dot: "oklch(0.72 0.25 300)",
  },
  completed: {
    label: "Confirmado",
    bg: "oklch(0.42 0.18 80 / 0.5)",
    border: "oklch(0.82 0.2 75)",
    dot: "oklch(0.88 0.2 75)",
  },
  charged: {
    label: "Cobrado",
    bg: "oklch(0.38 0.2 150 / 0.55)",
    border: "oklch(0.76 0.2 150)",
    dot: "oklch(0.76 0.2 150)",
  },
  cancelled: {
    label: "Cancelado",
    bg: "oklch(0.3 0.05 25 / 0.4)",
    border: "oklch(0.6 0.18 25)",
    dot: "oklch(0.65 0.2 25)",
  },
  blocked: {
    label: "Bloqueado",
    bg: "oklch(0.3 0 0 / 0.4)",
    border: "oklch(0.5 0 0)",
    dot: "oklch(0.6 0 0)",
  },
};

// ---------------------------------------------------------------------------
// Helpers de fechas
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;
const ROW_PX = 88;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfWeek(d: Date) {
  // lunes
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
function fmtDate(d: Date) {
  return d.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
function fmtShortDow(d: Date) {
  return d.toLocaleDateString("es-AR", { weekday: "short" });
}
function fmtTime(d: Date) {
  return `${d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}hs`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function AgendaPage() {
  const navigate = useNavigate();
  const { session, profile, loading: authLoading } = useAuth();
  const [view, setView] = React.useState<"day" | "week" | "month">("day");
  const [cursor, setCursor] = React.useState<Date>(startOfDay(new Date()));

  React.useEffect(() => {
    if (!authLoading && !session) navigate({ to: "/login", replace: true });
  }, [authLoading, session, navigate]);

  const range = React.useMemo(() => {
    if (view === "day") return { start: startOfDay(cursor), end: endOfDay(cursor) };
    if (view === "month") {
      const s = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const e = endOfDay(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
      return { start: s, end: e };
    }
    const s = startOfWeek(cursor);
    const e = endOfDay(new Date(s.getTime() + 6 * DAY_MS));
    return { start: s, end: e };
  }, [view, cursor]);

  const data = useAgendaData(range.start, range.end);
  const [senasConfig, setSenasConfig] = React.useState<{
    enabled: boolean;
    services: string[];
    amount_type: "fixed" | "percent";
    amount_value: number;
    lost_dist: "local" | "prof" | "custom";
    lost_local: number;
    lost_prof: number;
  } | null>(null);

  const { businessId } = useAuth();

  React.useEffect(() => {
    if (!businessId) return;
    supabase.from("business_settings").select("senas_config").eq("business_id", businessId).maybeSingle()
      .then(({ data: bsData }) => {
        if (bsData?.senas_config) setSenasConfig(bsData.senas_config as typeof senasConfig);
      });
  }, [businessId]);

  const serviceRequiresDeposit = (serviceName: string | null) => {
    if (!senasConfig?.enabled || !serviceName) return false;
    return data.services.some((s) => senasConfig.services.includes(s.id) && s.name === serviceName);
  };

  const calcDeposit = (price: number) => {
    if (!senasConfig) return 0;
    if (senasConfig.amount_type === "fixed") return senasConfig.amount_value;
    return Math.round(price * senasConfig.amount_value / 100);
  };

  // Single source of truth: only ONE lateral drawer can be active at a time.
  // Opening any drawer switches this; closing sets it to null. No stacking.
  const [activeDrawer, setActiveDrawer] = React.useState<
    "detail" | "new" | "edit" | "block" | null
  >(null);
  const [selected, setSelected] = React.useState<Appointment | null>(null);
  const [editing, setEditing] = React.useState<Appointment | null>(null);
  const [dlgDefaults, setDlgDefaults] = React.useState<{
    employeeId?: string | null;
    startsAt?: Date | null;
  }>({});
  const [filterModal, setFilterModal] = React.useState<string | null>(null);
  const [slotMenu, setSlotMenu] = React.useState<{
    employeeId: string | null;
    startsAt: Date;
    x: number;
    y: number;
  } | null>(null);
  const [blockDialog, setBlockDialog] = React.useState<{
    employeeId: string | null;
    startsAt: Date;
    appointment?: Appointment | null;
  } | null>(null);
  const [newMenu, setNewMenu] = React.useState(false);


  const openNew = (employeeId?: string | null, startsAt?: Date | null) => {
    const target = startsAt ?? cursor;
    const schedule = getScheduleForDate(data.schedule, target);
    if (!schedule?.enabled) {
      toast.error("Negocio cerrado este día.");
      return;
    }
    setSlotMenu(null);
    setEditing(null);
    setDlgDefaults({ employeeId, startsAt });
    setActiveDrawer("new");
  };

  const openSlotMenu = (employeeId: string | null, startsAt: Date, event: React.MouseEvent) => {
    const schedule = getScheduleForDate(data.schedule, startsAt);
    if (!schedule?.enabled) {
      toast.error("Negocio cerrado este día.");
      return;
    }

    setSlotMenu({
      employeeId,
      startsAt,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const openBlockDialog = (employeeId: string | null, startsAt: Date, appointment?: Appointment | null) => {
    setSlotMenu(null);
    setBlockDialog({ employeeId, startsAt, appointment });
    setActiveDrawer("block");
  };

  const saveBlock = async (payload: {
    appointmentId?: string | null;
    employeeId: string | null;
    startsAt: Date;
    endsAt: Date;
    label: string;
    repeatEnabled: boolean;
    repeatEvery: number;
    repeatCount: number;
  }) => {
    if (!data.businessId) {
      toast.error("No se encontró el negocio.");
      return;
    }

    const durationMin = Math.max(15, Math.round((payload.endsAt.getTime() - payload.startsAt.getTime()) / 60_000));
    if (durationMin <= 0) {
      toast.error("La hora de fin debe ser posterior a la hora de inicio.");
      return;
    }

    try {
      if (payload.appointmentId) {
        const { error } = await supabase
          .from("appointments")
          .update({
            client_name: payload.label || "Horario bloqueado",
            employee_id: payload.employeeId,
            service_name: "Bloqueo de horario",
            service_price: 0,
            starts_at: payload.startsAt.toISOString(),
            ends_at: payload.endsAt.toISOString(),
            duration_min: durationMin,
            status: "blocked",
            notes: payload.label ? `Horario bloqueado: ${payload.label}` : "Horario bloqueado desde Agenda",
            updated_at: new Date().toISOString(),
          })
          .eq("id", payload.appointmentId);
        if (error) throw new Error(error.message);
      } else {
        const repeatTotal = payload.repeatEnabled ? Math.max(1, payload.repeatCount) : 1;
        const repeatEvery = Math.max(1, payload.repeatEvery);
        const rows = Array.from({ length: repeatTotal }, (_, index) => {
          const startsAt = new Date(payload.startsAt);
          startsAt.setDate(startsAt.getDate() + index * repeatEvery);
          const endsAt = new Date(payload.endsAt);
          endsAt.setDate(endsAt.getDate() + index * repeatEvery);
          return {
            business_id: data.businessId,
            client_id: null,
            client_name: payload.label || "Horario bloqueado",
            employee_id: payload.employeeId,
            service_name: "Bloqueo de horario",
            service_price: 0,
            starts_at: startsAt.toISOString(),
            ends_at: endsAt.toISOString(),
            duration_min: durationMin,
            status: "blocked",
            notes: payload.label ? `Horario bloqueado: ${payload.label}` : "Horario bloqueado desde Agenda",
            created_by_name: profile?.full_name ?? null,
            created_by_role: profile?.role ?? null,
            updated_at: new Date().toISOString(),
          };
        });

        const { error } = await supabase.from("appointments").insert(rows);
        if (error) throw new Error(error.message);
      }

      setActiveDrawer(null);
      data.refresh();
      toast.success(payload.appointmentId ? "Bloqueo actualizado" : "Horario bloqueado");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const releaseBlock = async (a: Appointment) => {
    try {
      const { error } = await supabase.from("appointments").delete().eq("id", a.id);
      if (error) throw new Error(error.message);
      setActiveDrawer(null);
      data.refresh();
      toast.success("Horario liberado");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const openDetail = (a: Appointment) => {
    setSelected(a);
    setActiveDrawer("detail");
  };
  const openEdit = (a: Appointment) => {
    if (a.status === "blocked") {
      openBlockDialog(a.employee_id ?? null, new Date(a.starts_at), a);
      return;
    }
    setEditing(a);
    setDlgDefaults({});
    setActiveDrawer("edit");
  };

  const onChangeStatus = async (a: Appointment, status: ApptStatus) => {
    try {
      if (status === "cancelled") {
        await cancelAppointment(a.id, {
          userId: session?.user.id,
          name: profile?.full_name,
          role: profile?.role,
        });
      } else {
        await setAppointmentStatus(a.id, status);
      }
      toast.success("Turno actualizado");
      setSelected((current) => current && current.id === a.id ? { ...current, status } : current);
      data.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onMarkDeposit = (a: Appointment) => {
    if (a.deposit_status === "paid") {
      toast.info("Este turno ya tiene seña pagada.");
      return;
    }
    const depositAmount = a.deposit_amount ?? calcDeposit(Number(a.service_price ?? 0));
    navigate({ to: "/cash-register", search: {
      depositAppointmentId: a.id,
      depositAmount: String(depositAmount),
      clientName: a.client_name ?? "",
      serviceName: a.service_name ?? "",
      employeeId: a.employee_id ?? "",
    } as never });
  };

  const goToCobro = async (a: Appointment) => {
    if (a.status === "cancelled") {
      toast.error("No se puede cobrar un turno cancelado.");
      return;
    }
    const depositPaid = Number(a.deposit_paid ?? 0);
    const totalPrice  = Number(a.service_price ?? 0);
    const remainder   = depositPaid > 0 ? Math.max(0, totalPrice - depositPaid) : totalPrice;
    navigate({ to: "/cash-register", search: {
      appointmentId: a.id,
      finalAmount: String(remainder),
      depositPaid: String(depositPaid),
      totalPrice: String(totalPrice),
      clientName: a.client_name ?? "",
      serviceName: a.service_name ?? "",
      employeeId: a.employee_id ?? "",
    } as never });
  };

  const onCancelWithDeposit = async (a: Appointment, action: "keep" | "return") => {
    if (action === "return") {
      // Motivo - prompt para más detalle
      const motivo = window.prompt("Ingresá el motivo de la devolución (opcional):", "") ?? "";
      try {
        // Register refund in expenses
        await supabase.from("expenses").insert({
          business_id: a.business_id,
          description: `Devolución de seña – ${a.client_name ?? "cliente"} – ${a.service_name ?? ""}${motivo ? " – " + motivo : ""}`,
          amount: Number(a.deposit_paid ?? 0),
          type: "devolucion_sena",
          date: new Date().toISOString().slice(0, 10),
        });
        // Update appointment
        await supabase.from("appointments").update({
          deposit_status: "returned",
          status: "cancelled",
        }).eq("id", a.id);
        toast.success("Seña devuelta y egreso registrado en Caja");
      } catch (e) { toast.error((e as Error).message); return; }
    } else {
      // Keep seña — mark as lost, apply distribution
      try {
        await supabase.from("appointments").update({
          deposit_status: "lost",
          status: "cancelled",
        }).eq("id", a.id);
        // If prof share > 0, register compensation
        // (senasConfig is loaded at page level)
        toast.success("Seña marcada como perdida");
      } catch (e) { toast.error((e as Error).message); return; }
    }
    setActiveDrawer(null);
    data.refresh();
  };

  // ── Performance: stable references so memoized children (DayView, drawer)
  //    don't re-render when unrelated state (e.g. opening a turno) changes.
  //    NOTE: these hooks MUST run before the auth guard below — otherwise the
  //    hook count changes between renders (React error #310).
  // useAgendaData returns a fresh object every render but its arrays are
  // stable (useState); memoize the wrapper so identity only changes on real data.
  const memoData = React.useMemo(
    () => data,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.loading, data.appointments, data.employees, data.services, data.clients, data.schedule, data.realtimeStatus, data.businessId, data.refresh],
  );
  const daySchedule = React.useMemo(
    () => getScheduleForDate(data.schedule, cursor),
    [data.schedule, cursor],
  );

  // Stable handlers passed to the (memoized) DayView grid.
  const handleSlotClick = useStableCallback(openSlotMenu);
  const handleApptClick = useStableCallback(openDetail);
  const handleChangeStatus = useStableCallback(onChangeStatus);
  const handleCobrar = useStableCallback(goToCobro);

  // Stable handlers passed to the (memoized) detail drawer.
  const handleEdit = useStableCallback(openEdit);
  const handleCancel = useStableCallback((a: Appointment) => {
    if (window.confirm("¿Cancelar este turno? No se puede deshacer.")) onChangeStatus(a, "cancelled");
  });
  const handleFicha = useStableCallback(() => navigate({ to: "/clients" }));
  const handleMarkDeposit = useStableCallback(onMarkDeposit);
  const handleCancelWithDeposit = useStableCallback(onCancelWithDeposit);
  const handleReleaseBlock = useStableCallback(releaseBlock);

  if (authLoading || !session) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" /> Cargando…
        </div>
      </AppShell>
    );
  }

  const counts = {
    pending: data.appointments.filter((a) => a.status === "pending").length,
    confirmed: data.appointments.filter((a) => a.status === "confirmed").length,
    seña: data.appointments.filter((a) => /se(ñ|n)a/i.test(a.notes || "")).length,
    charged: data.appointments.filter((a) => a.status === "charged").length,
    cancelled: data.appointments.filter((a) => a.status === "cancelled").length,
  };

  // Always day view — navigation via the banner arrows
  const move = (delta: number) => {
    setCursor((c) => new Date(c.getTime() + delta * DAY_MS));
  };

  // Full date label for the unified banner — "Sábado, 20 de Junio de 2026"
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const fullDate = `${cap(cursor.toLocaleDateString("es-AR", { weekday: "long" }))}, ${cursor.getDate()} de ${cap(cursor.toLocaleDateString("es-AR", { month: "long" }))} de ${cursor.getFullYear()}`;
  const isCursorToday = startOfDay(cursor).getTime() === startOfDay(new Date()).getTime();

  return (
    <AppShell>
      <div className="app-premium-shell -mt-1 sm:-mt-2 space-y-0">
      
      <div className="pointer-events-none absolute left-1/2 top-[-120px] z-[-1] h-[620px] w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_17%_4%,rgb(139_92_246_/_0.34),transparent_38%),radial-gradient(circle_at_76%_0%,rgb(79_125_255_/_0.30),transparent_36%),radial-gradient(circle_at_46%_96%,rgb(255_123_229_/_0.14),transparent_50%)] blur-[16px]" />
{/* Unified glass banner — compact control bar (counts · Hoy · date nav · Nuevo turno) */}
      <div
        className="glass rounded-xl mb-2 px-2.5 py-1 animate-fade-up flex items-center gap-2.5 flex-nowrap overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {/* Hoy */}
        <button
          onClick={() => setCursor(startOfDay(new Date()))}
          disabled={isCursorToday}
          className="text-xs font-medium text-primary hover:text-primary/80 transition shrink-0 disabled:opacity-40 disabled:hover:text-primary"
        >
          Hoy
        </button>

        <div className="h-5 w-px bg-white/10 shrink-0" />

        {/* Date navigation — prev/next one day */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => move(-1)}
            aria-label="Día anterior"
            className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold whitespace-nowrap min-w-[205px] text-center">{fullDate}</span>
          <button
            onClick={() => move(1)}
            aria-label="Día siguiente"
            className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {data.loading && <span className="text-xs text-muted-foreground shrink-0">Cargando…</span>}

        {/* Status counts (clickable filters) — pushed right */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {([
            ["pending",   "Pendientes",  "oklch(0.72 0.2 245)",  "oklch(0.72 0.2 245 / 0.12)", "oklch(0.72 0.2 245 / 0.3)"],
            ["confirmed", "Confirmados", "oklch(0.72 0.26 305)", "oklch(0.72 0.26 305 / 0.12)", "oklch(0.72 0.26 305 / 0.3)"],
            ["charged",   "Cobrados",    "oklch(0.76 0.2 155)",  "oklch(0.76 0.2 155 / 0.12)", "oklch(0.76 0.2 155 / 0.3)"],
            ["cancelled", "Cancelados",  "oklch(0.65 0.2 25)",   "oklch(0.65 0.2 25 / 0.12)",  "oklch(0.65 0.2 25 / 0.3)"],
          ] as [string,string,string,string,string][]).map(([k, label, color, bg, ring]) => (
            <button
              key={k}
              onClick={() => setFilterModal(k)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium transition-all hover:brightness-110 shrink-0"
              style={{ background: bg, boxShadow: `0 0 0 1px ${ring}`, color }}
            >
              <span className="font-semibold tabular-nums text-sm">{(counts as Record<string,number>)[k] ?? 0}</span>
              <span className="opacity-80">{label}</span>
            </button>
          ))}
        </div>

        <div className="h-5 w-px bg-white/10 shrink-0" />

        {/* Nuevo — square button with menu (Agregar turno / Bloquear horario) */}
        <div className="relative shrink-0">
          <Button
            className="h-7 w-7 p-0"
            aria-label="Nuevo"
            onClick={() => setNewMenu((v) => !v)}
          >
            <Plus className="h-4 w-4" />
          </Button>
          {newMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setNewMenu(false)} />
              <div className="absolute right-0 mt-1.5 z-50 w-44 glass-strong rounded-xl p-1 animate-fade-up">
                <button
                  className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-white/[0.06] transition flex items-center gap-2"
                  onClick={() => { setNewMenu(false); openNew(null, cursor); }}
                >
                  <CalendarIcon className="h-4 w-4 text-primary" /> Agregar turno
                </button>
                <button
                  className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-white/[0.06] transition flex items-center gap-2"
                  onClick={() => { setNewMenu(false); openBlockDialog(null, cursor); }}
                >
                  <XCircle className="h-4 w-4 text-amber-300" /> Bloquear horario
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Filter modal */}
      {filterModal && (() => {
        const statusMap: Record<string,string> = { pending:"pending", confirmed:"confirmed", charged:"charged", cancelled:"cancelled" };
        const labels: Record<string,string> = { pending:"Pendientes", confirmed:"Confirmados", charged:"Finalizados", cancelled:"Cancelados" };
        const filtered = filterModal === "seña"
          ? data.appointments.filter((a) => /se(ñ|n)a/i.test(a.notes || ""))
          : data.appointments.filter((a) => a.status === statusMap[filterModal]);
        return (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 pt-16 overflow-y-auto" onClick={() => setFilterModal(null)}>
            <div className="glass-strong rounded-3xl w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-white/5">
                <h3 className="font-display text-lg font-semibold">{labels[filterModal]} ({filtered.length})</h3>
                <button onClick={() => setFilterModal(null)} className="text-muted-foreground hover:text-foreground text-xl">×</button>
              </div>
              <div className="p-3 max-h-[60vh] overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-8">Sin turnos en este estado.</div>
                ) : filtered.map((a) => {
                  const m = STATUS_META[a.status] ?? STATUS_META.pending;
                  const emp = data.employees.find((e) => e.id === a.employee_id);
                  return (
                    <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.03] transition">
                      <div className="h-8 w-8 rounded-full grid place-items-center ring-1 ring-white/10 shrink-0" style={{ background: m.bg }}>
                        <span className="text-[10px] font-bold" style={{ color: m.dot }}>
                          {(a.client_name || "?")[0]?.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{a.client_name || "Sin cliente"}</div>
                        <div className="text-xs text-muted-foreground truncate">{emp?.full_name ?? emp?.name ?? "—"} · {a.service_name || "—"}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs tabular-nums">{new Date(a.starts_at).toLocaleDateString("es-AR",{day:"2-digit",month:"short"})} {fmtTime(new Date(a.starts_at))}</div>
                        {a.service_price ? <div className="text-xs text-muted-foreground">${Number(a.service_price).toLocaleString("es-AR")}</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Always day view */}
      <DayView
        date={cursor}
        data={memoData}
        schedule={daySchedule}
        onSlotClick={handleSlotClick}
        onApptClick={handleApptClick}
        onChangeStatus={handleChangeStatus}
        onCobrar={handleCobrar}
      />

      {slotMenu ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setSlotMenu(null)}
            aria-label="Cerrar opciones de casillero"
          />
          <div
            className="fixed z-50 w-56 overflow-hidden rounded-2xl border border-white/10 bg-background/95 shadow-2xl backdrop-blur-xl"
            style={{
              left: Math.min(slotMenu.x, window.innerWidth - 240),
              top: Math.min(slotMenu.y, window.innerHeight - 150),
            }}
          >
            <div className="border-b border-white/10 px-3 py-2 text-xs text-muted-foreground">
              {slotMenu.startsAt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })} · {fmtTime(slotMenu.startsAt)}
            </div>
            <button
              type="button"
              onClick={() => openNew(slotMenu.employeeId, slotMenu.startsAt)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-foreground transition hover:bg-white/[0.06]"
            >
              <CalendarIcon className="h-4 w-4 text-primary" />
              Agregar turno
            </button>
            <button
              type="button"
              onClick={() => openBlockDialog(slotMenu.employeeId, slotMenu.startsAt)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-foreground transition hover:bg-white/[0.06]"
            >
              <XCircle className="h-4 w-4 text-amber-300" />
              Bloquear horario
            </button>
          </div>
        </>
      ) : null}

      <AppointmentDetailDialog
        open={activeDrawer === "detail"}
        onOpenChange={(open) => { if (!open) setActiveDrawer(null); }}
        appointment={selected}
        employees={memoData.employees}
        clients={memoData.clients}
        onEdit={handleEdit}
        onCancel={handleCancel}
        onCobrar={handleCobrar}
        onFicha={handleFicha}
        onChangeStatus={handleChangeStatus}
        onMarkDeposit={handleMarkDeposit}
        onCancelWithDeposit={handleCancelWithDeposit}
        onReleaseBlock={handleReleaseBlock}
      />

      <BlockHoursDialog
        open={activeDrawer === "block"}
        onOpenChange={(open) => { if (!open) setActiveDrawer(null); }}
        employees={data.employees}
        initialEmployeeId={blockDialog?.employeeId ?? null}
        initialStartsAt={blockDialog?.startsAt ?? cursor}
        appointment={blockDialog?.appointment ?? null}
        onSave={saveBlock}
      />

      </div>

      {data.businessId && (
      <AppointmentDialog
          open={activeDrawer === "new" || activeDrawer === "edit"}
          onOpenChange={(open) => { if (!open) setActiveDrawer(null); }}
          appointment={editing}
          defaultEmployeeId={dlgDefaults.employeeId}
          defaultStartsAt={dlgDefaults.startsAt}
          employees={data.employees}
          services={data.services}
          clients={data.clients}
          businessId={data.businessId}
          createdByName={profile?.full_name}
          createdByRole={profile?.role}
          onSaved={data.refresh}
          schedule={data.schedule}
        />
      )}
    </AppShell>
  );
}

type ApptLayout = { lane: number; laneCount: number };

// Drag & drop tuning + helpers (shared by the grid and cards).
const DRAG_SNAP_MIN = 15; // drop snaps to 15-minute increments
const fmtHM = (d: Date) =>
  d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
// Tracks the appointment currently being dragged so onDragOver (which cannot
// read dataTransfer for security reasons) knows its duration for the preview.
const draggedApptRef: { current: Appointment | null } = { current: null };

function getApptEnd(a: Appointment) {
  if (a.ends_at) return new Date(a.ends_at);
  return new Date(new Date(a.starts_at).getTime() + Number(a.duration_min ?? 30) * 60_000);
}

function computeOverlapLayouts(appts: Appointment[]) {
  const sorted = [...appts].sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
  const result = new Map<string, ApptLayout>();
  let group: Appointment[] = [];
  let groupEnd = 0;

  const flush = () => {
    if (!group.length) return;
    const laneEnds: number[] = [];
    const laneById = new Map<string, number>();

    for (const appt of group) {
      const start = +new Date(appt.starts_at);
      let lane = laneEnds.findIndex((end) => end <= start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = +getApptEnd(appt);
      laneById.set(appt.id, lane);
    }

    const laneCount = Math.max(1, laneEnds.length);
    for (const appt of group) result.set(appt.id, { lane: laneById.get(appt.id) ?? 0, laneCount });
    group = [];
    groupEnd = 0;
  };

  for (const appt of sorted) {
    const start = +new Date(appt.starts_at);
    const end = +getApptEnd(appt);
    if (!group.length || start < groupEnd) {
      group.push(appt);
      groupEnd = Math.max(groupEnd, end);
    } else {
      flush();
      group = [appt];
      groupEnd = end;
    }
  }
  flush();
  return result;
}

// ---------------------------------------------------------------------------
// Day view: columnas por profesional
// ---------------------------------------------------------------------------
const DayView = React.memo(function DayView({
  date,
  data,
  schedule,
  onSlotClick,
  onApptClick,
  onChangeStatus,
  onCobrar,
}: {
  date: Date;
  data: ReturnType<typeof useAgendaData>;
  schedule: ReturnType<typeof getScheduleForDate>;
  onSlotClick: (employeeId: string | null, startsAt: Date, event: React.MouseEvent) => void;
  onApptClick: (a: Appointment) => void;
  onChangeStatus: (a: Appointment, s: ApptStatus) => void;
  onCobrar: (a: Appointment) => void;
}) {
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const isClosed = !schedule?.enabled;
  const HOUR_START = schedule ? Math.floor(parseScheduleTime(schedule.start)) : 0;
  const HOUR_END = schedule ? Math.ceil(parseScheduleTime(schedule.end)) : 0;
  const HOURS = !isClosed ? Array.from({ length: Math.max(0, HOUR_END - HOUR_START) }, (_, i) => HOUR_START + i) : [];
  const employees = data.employees.length
    ? data.employees
    : [{ id: "__none__", full_name: "Sin asignar" }];

  // ── Dynamic row height — fills available viewport so the last configured
  //    hour lands at the bottom edge. rowPx = freeSpace / numberOfHours.
  const gridBodyRef = React.useRef<HTMLDivElement>(null);
  const [rowPx, setRowPx] = React.useState(ROW_PX);

  // Drag preview ghost (target time range while dragging). Lightweight: only
  // stored in state, no Supabase calls, no grid recompute.
  const [dragPreview, setDragPreview] = React.useState<
    { empId: string; top: number; height: number; label: string } | null
  >(null);
  React.useEffect(() => {
    const clear = () => { draggedApptRef.current = null; setDragPreview(null); };
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);
  React.useLayoutEffect(() => {
    const recompute = () => {
      const body = gridBodyRef.current;
      if (!body || HOURS.length === 0) return;
      const top = body.getBoundingClientRect().top;        // where the hour rows begin
      const BOTTOM_GAP = 18;                                 // breathing room under the last row
      const available = window.innerHeight - top - BOTTOM_GAP;
      const per = available / HOURS.length;
      setRowPx(Math.max(52, per));                           // clamp: never cramp below 52px (grid scrolls if it must)
    };
    const raf = requestAnimationFrame(recompute);
    window.addEventListener("resize", recompute);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", recompute); };
  }, [HOURS.length, employees.length]);

  // Drop is handled at the COLUMN level (not per hour-cell) so it works whether
  // you release over an empty slot or on top of another card. The minute is
  // derived from the cursor's Y within the column, snapped to DRAG_SNAP_MIN.
  const handleDrop = async (e: React.DragEvent, empId: string) => {
    e.preventDefault();
    setDragPreview(null);
    const apptId = e.dataTransfer.getData("apptId") || draggedApptRef.current?.id || "";
    draggedApptRef.current = null;
    if (!apptId) return;
    const appt = data.appointments.find((a) => a.id === apptId);
    if (!appt) return;
    if (appt.status === "charged") {
      toast.error("Los turnos cobrados no se pueden mover.");
      return;
    }
    if (isClosed) {
      toast.error("Negocio cerrado este día.");
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rawMin = HOUR_START * 60 + (rowPx > 0 ? (y / rowPx) * 60 : 0);
    const dur = Number(appt.duration_min ?? 30);
    // Keep the appointment inside the grid; checkSchedule validates real hours.
    const maxStart = HOUR_END * 60 - dur;
    const snappedMin = Math.max(
      HOUR_START * 60,
      Math.min(maxStart, Math.round(rawMin / DRAG_SNAP_MIN) * DRAG_SNAP_MIN),
    );

    const newStart = new Date(date);
    newStart.setHours(Math.floor(snappedMin / 60), snappedMin % 60, 0, 0);
    const newEnd = new Date(newStart.getTime() + dur * 60000);
    const targetEmpId = empId === "__none__" ? null : empId;

    // 1) Working hours (business schedule)
    const schedErr = checkSchedule(data.schedule, newStart, dur);
    if (schedErr) { toast.error(schedErr); return; }

    // 2) Real-range overlap against the SAME in-memory data the grid shows, in
    //    the SAME column. Consistent by construction: if the slot looks free,
    //    the move is allowed. Touching endpoints (11:30 end vs 11:30 start) are OK.
    const conflict = data.appointments.find((o) => {
      if (o.id === apptId) return false;                 // never compare against itself
      if (o.status === "cancelled") return false;        // cancelled don't occupy
      const sameColumn = targetEmpId ? o.employee_id === targetEmpId : !o.employee_id;
      if (!sameColumn) return false;
      const oStart = new Date(o.starts_at);
      const oEnd = getApptEnd(o);
      return oStart < newEnd && oEnd > newStart;
    });
    if (conflict) {
      const t = new Date(conflict.starts_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
      toast.error(
        conflict.status === "blocked"
          ? `Horario bloqueado (${t}).`
          : `Profesional ocupado: ya tiene un turno a las ${t}${conflict.client_name ? ` · ${conflict.client_name}` : ""}.`,
      );
      return;
    }

    // 3) Persist
    try {
      const { error } = await supabase.from("appointments").update({
        starts_at: newStart.toISOString(),
        ends_at: newEnd.toISOString(),
        employee_id: targetEmpId,
      }).eq("id", apptId);
      if (error) throw new Error(error.message);
      data.refresh();
      toast.success("Turno movido");
    } catch (ex) {
      toast.error(`Error al guardar: ${(ex as Error).message}`);
    }
  };

  const dayAppts = React.useMemo(
    () => data.appointments.filter((a) => {
      const d = new Date(a.starts_at);
      return d.getFullYear() === date.getFullYear()
        && d.getMonth() === date.getMonth()
        && d.getDate() === date.getDate()
        && a.status !== "cancelled";
    }),
    [data.appointments, date],
  );
  // Precompute each column's appointments + overlap layout once per data/day,
  // so dragging (which only updates dragPreview state) never recomputes this.
  const columnRender = React.useMemo(
    () => employees.map((e) => {
      const columnAppts = dayAppts.filter((a) => (e.id === "__none__" ? !a.employee_id : a.employee_id === e.id));
      return { e, columnAppts, layouts: computeOverlapLayouts(columnAppts) };
    }),
    [employees, dayAppts],
  );
  const isToday = startOfDay(now).getTime() === startOfDay(date).getTime();
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const showNowLine = isToday && !isClosed && nowHour >= HOUR_START && nowHour <= HOUR_END;
  const nowLineTop = (nowHour - HOUR_START) * rowPx;

  // Reuse the same snap math as the drop, off the cursor Y within the column.
  const previewFromColumn = (col: HTMLElement, clientY: number, empId: string) => {
    const appt = draggedApptRef.current;
    if (!appt) return;
    const durMin = Number(appt.duration_min ?? 30);
    const rect = col.getBoundingClientRect();
    const y = clientY - rect.top;
    const rawMin = HOUR_START * 60 + (rowPx > 0 ? (y / rowPx) * 60 : 0);
    const maxStart = HOUR_END * 60 - durMin;
    const snappedMin = Math.max(
      HOUR_START * 60,
      Math.min(maxStart, Math.round(rawMin / DRAG_SNAP_MIN) * DRAG_SNAP_MIN),
    );
    const top = (snappedMin / 60 - HOUR_START) * rowPx;
    const height = Math.max((durMin / 60) * rowPx, 18);
    const s = new Date(date); s.setHours(Math.floor(snappedMin / 60), snappedMin % 60, 0, 0);
    const label = `${fmtHM(s)} - ${fmtHM(new Date(s.getTime() + durMin * 60000))}`;
    setDragPreview((prev) =>
      prev && prev.empId === empId && prev.top === top && prev.label === label
        ? prev
        : { empId, top, height, label },
    );
  };

  if (isClosed) {
    return (
      <section className="glass rounded-2xl p-8 min-h-[360px] grid place-items-center text-center">
        <div>
          <div className="text-sm font-semibold">Negocio cerrado este día</div>
          <div className="text-xs text-muted-foreground mt-1">
            Este día está desactivado en Configuración &gt; Horarios.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="glass rounded-2xl p-2 sm:p-3">
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[860px]"
          style={{ gridTemplateColumns: `58px repeat(${employees.length}, minmax(170px,1fr))` }}
        >
          <div className="sticky left-0 z-30 bg-background/80 backdrop-blur-xl" />
          {employees.map((e) => {
            const total = dayAppts.filter((a) => a.employee_id === e.id).length;
            const inSvc = dayAppts.filter(
              (a) => a.employee_id === e.id && (a.status === "completed" || a.status === "confirmed"),
            ).length;
            const initials = (e.full_name || e.name || "?")
              .split(/\s+/)
              .map((s) => s[0])
              .slice(0, 2)
              .join("")
              .toUpperCase();
            return (
              <div
                key={e.id}
                className="px-2.5 pb-1.5 pt-1 border-l border-white/[0.04] flex items-center gap-2"
              >
                {e.avatar_url ? (
                  <img
                    src={e.avatar_url}
                    alt={e.full_name ?? ""}
                    className="h-7 w-7 rounded-full object-cover ring-1 ring-white/10 shrink-0"
                  />
                ) : (
                  <div
                    className="h-7 w-7 rounded-full grid place-items-center text-[10px] font-semibold text-white ring-1 ring-white/10 shrink-0"
                    style={{ background: "linear-gradient(135deg, oklch(0.7 0.22 245), oklch(0.65 0.27 305))" }}
                  >
                    {initials || "?"}
                  </div>
                )}
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="text-[13px] font-semibold truncate leading-none">{e.full_name ?? e.name}</div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5 leading-none">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        background: inSvc > 0 ? "oklch(0.76 0.2 155)" : "oklch(0.65 0.025 270)",
                      }}
                    />
                    {total} turno{total === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
            );
          })}

          <div ref={gridBodyRef} className="relative sticky left-0 z-30 bg-background/80 backdrop-blur-xl border-r border-white/[0.06]">
            {HOURS.map((h) => (
              <div
                key={h}
                className="text-[11px] text-muted-foreground pr-2 text-right select-none"
                style={{ height: rowPx }}
              >
                <span className="relative -top-2">{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>

          {columnRender.map(({ e, columnAppts, layouts }) => (
            <div
              key={e.id}
              className="relative border-l border-white/[0.04]"
              onDragOver={(ev) => {
                ev.preventDefault();
                ev.dataTransfer.dropEffect = "move";
                previewFromColumn(ev.currentTarget as HTMLElement, ev.clientY, e.id);
              }}
              onDrop={(ev) => handleDrop(ev, e.id)}
            >
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors cursor-pointer"
                  style={{ height: rowPx }}
                  onClick={(event) => {
                    const dt = new Date(date);
                    dt.setHours(h, 0, 0, 0);
                    onSlotClick(e.id === "__none__" ? null : e.id, dt, event);
                  }}
                />
              ))}

              {showNowLine && (
                <div
                  className="pointer-events-none absolute left-0 right-0 z-20 border-t border-red-400/90 shadow-[0_0_10px_rgba(248,113,113,0.75)]"
                  style={{ top: nowLineTop }}
                >
                  <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.9)]" />
                </div>
              )}

              {/* Drag preview ghost — target time range before dropping */}
              {dragPreview && dragPreview.empId === e.id && (
                <div
                  className="pointer-events-none absolute left-1 right-1 z-30 rounded-lg border-2 border-dashed border-primary/70 bg-primary/10 backdrop-blur-[1px] px-2 py-0.5 overflow-hidden"
                  style={{ top: dragPreview.top, height: dragPreview.height }}
                >
                  <span className="text-[10px] font-bold tabular-nums text-primary leading-none">{dragPreview.label}</span>
                </div>
              )}

              {columnAppts.map((a) => (
                <ApptCard
                  key={a.id}
                  a={a}
                  layout={layouts.get(a.id)}
                  hourStart={HOUR_START}
                  hourEnd={HOUR_END}
                  rowPx={rowPx}
                  onClick={() => onApptClick(a)}
                  onChangeStatus={(s) => onChangeStatus(a, s)}
                  onCobrar={() => onCobrar(a)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
});

const ApptCard = React.memo(function ApptCard({
  a,
  onClick,
  onChangeStatus,
  onCobrar,
  layout,
  hourStart,
  hourEnd,
  rowPx,
}: {
  a: Appointment;
  onClick: () => void;
  onChangeStatus: (s: ApptStatus) => void;
  onCobrar: () => void;
  layout?: ApptLayout;
  hourStart: number;
  hourEnd: number;
  rowPx: number;
}) {
  const start = new Date(a.starts_at);
  const end = getApptEnd(a);
  const firstName = (a.client_name || "Sin nombre").trim().split(/\s+/)[0] || "Sin nombre";
  const startH = start.getHours() + start.getMinutes() / 60;
  const dur = Math.max(0.5, Number(a.duration_min ?? 30) / 60);
  const top = (startH - hourStart) * rowPx + 2;
  const height = Math.max(dur * rowPx - 4, 38);
  if (top < 0 || top > (hourEnd - hourStart) * rowPx) return null;
  const meta = STATUS_META[a.status] ?? STATUS_META.pending;
  const isMovable = a.status !== "charged";
  const laneCount = layout?.laneCount ?? 1;
  const lane = layout?.lane ?? 0;
  const gapPx = 6;
  const width = `calc(${100 / laneCount}% - ${gapPx}px)`;
  const left = `calc(${(lane * 100) / laneCount}% + ${gapPx / 2}px)`;

  const handleDragStart = (e: React.DragEvent) => {
    if (!isMovable) {
      e.preventDefault();
      toast.error("Los turnos cobrados no se pueden mover.");
      return;
    }
    e.dataTransfer.setData("apptId", a.id);
    e.dataTransfer.effectAllowed = "move";
    draggedApptRef.current = a;
  };
  const handleDragEnd = () => {
    draggedApptRef.current = null;
  };

  return (
    <div
      className={cn(
        "absolute rounded-lg px-2 py-0.5 group transition hover:z-10 hover:scale-[1.01] overflow-hidden",
        isMovable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      )}
      style={{ top, height, left, width, background: meta.bg, boxShadow: `inset 0 0 0 1px ${meta.border}` }}
      draggable={isMovable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {/* Time range · first name (same line) */}
      <div className="flex items-center gap-1 min-w-0 leading-tight">
        <span className="text-[10px] font-bold tabular-nums shrink-0 leading-none" style={{ color: meta.dot }}>
          {fmtHM(start)} - {fmtHM(end)}
        </span>
        <span className="text-[9px] opacity-40 shrink-0 leading-none">·</span>
        <span className="text-[10px] font-semibold truncate flex-1 min-w-0 leading-none">{firstName}</span>
      </div>
      {/* Service */}
      {a.service_name && <div className="text-[9px] text-foreground/65 truncate leading-[1.05] mt-0.5">{a.service_name}</div>}
      {/se(ñ|n)a/i.test(a.notes || "") && (
        <div className="text-[8px] font-semibold mt-0.5 px-1 rounded w-fit"
          style={{ background: "oklch(0.42 0.18 75 / 0.5)", color: "oklch(0.88 0.2 75)" }}>
          Seña
        </div>
      )}

      {/* Quick actions removed — use detail modal instead */}
    </div>
  );
});

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="h-5 w-5 grid place-items-center rounded-md bg-background/70 ring-1 ring-white/10 hover:bg-background"
    >
      {children}
    </button>
  );
}


function dateInputValue(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function timeParts(date: Date) {
  return {
    hour: String(date.getHours()).padStart(2, "0"),
    minute: String(date.getMinutes()).padStart(2, "0"),
  };
}

function combineLocalDateTime(date: string, hour: string, minute: string) {
  return new Date(`${date}T${hour}:${minute}:00`);
}

function BlockHoursDialog({
  open,
  onOpenChange,
  employees,
  initialEmployeeId,
  initialStartsAt,
  appointment,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employees: ReturnType<typeof useAgendaData>["employees"];
  initialEmployeeId: string | null;
  initialStartsAt: Date;
  appointment: Appointment | null;
  onSave: (payload: {
    appointmentId?: string | null;
    employeeId: string | null;
    startsAt: Date;
    endsAt: Date;
    label: string;
    repeatEnabled: boolean;
    repeatEvery: number;
    repeatCount: number;
  }) => void;
}) {
  const start = appointment ? new Date(appointment.starts_at) : initialStartsAt;
  const end = appointment?.ends_at
    ? new Date(appointment.ends_at)
    : new Date(start.getTime() + 60 * 60_000);
  const startTime = timeParts(start);
  const endTime = timeParts(end);
  const [label, setLabel] = React.useState(appointment?.client_name === "Horario bloqueado" ? "" : appointment?.client_name ?? "");
  const [employeeId, setEmployeeId] = React.useState(initialEmployeeId ?? "");
  const [startDate, setStartDate] = React.useState(dateInputValue(start));
  const [startHour, setStartHour] = React.useState(startTime.hour);
  const [startMinute, setStartMinute] = React.useState(startTime.minute);
  const [endDate, setEndDate] = React.useState(dateInputValue(end));
  const [endHour, setEndHour] = React.useState(endTime.hour);
  const [endMinute, setEndMinute] = React.useState(endTime.minute);
  const [repeatEnabled, setRepeatEnabled] = React.useState(false);
  const [repeatEvery, setRepeatEvery] = React.useState("1");
  const [repeatCount, setRepeatCount] = React.useState("5");

  React.useEffect(() => {
    if (!open) return;
    const nextStart = appointment ? new Date(appointment.starts_at) : initialStartsAt;
    const nextEnd = appointment?.ends_at
      ? new Date(appointment.ends_at)
      : new Date(nextStart.getTime() + 60 * 60_000);
    const nextStartTime = timeParts(nextStart);
    const nextEndTime = timeParts(nextEnd);
    setLabel(appointment?.client_name === "Horario bloqueado" ? "" : appointment?.client_name ?? "");
    setEmployeeId((appointment?.employee_id ?? initialEmployeeId) || "");
    setStartDate(dateInputValue(nextStart));
    setStartHour(nextStartTime.hour);
    setStartMinute(nextStartTime.minute);
    setEndDate(dateInputValue(nextEnd));
    setEndHour(nextEndTime.hour);
    setEndMinute(nextEndTime.minute);
    setRepeatEnabled(false);
    setRepeatEvery("1");
    setRepeatCount("5");
  }, [open, appointment, initialEmployeeId, initialStartsAt]);

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = ["00", "15", "30", "45"];

  const inputClass = "h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm outline-none focus:border-primary/50";
  const selectClass = "h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm outline-none focus:border-primary/50";

  return (
    <AgendaDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={appointment ? "Editar bloqueo de horas" : "Bloqueo de horas"}
      footer={
        <>
          <Button variant="secondary" className="h-9" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            className="h-9"
            onClick={() => onSave({
              appointmentId: appointment?.id,
              employeeId: employeeId || null,
              startsAt: combineLocalDateTime(startDate, startHour, startMinute),
              endsAt: combineLocalDateTime(endDate, endHour, endMinute),
              label: label.trim(),
              repeatEnabled,
              repeatEvery: Number(repeatEvery || 1),
              repeatCount: Number(repeatCount || 1),
            })}
          >
            {appointment ? "Guardar cambios" : "Guardar bloqueo"}
          </Button>
        </>
      }
    >
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
            <label className="block text-sm font-semibold">
              Motivo/Etiqueta
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ej: Almuerzo, trámite, capacitación"
                className={`${inputClass} mt-2 w-full`}
              />
            </label>
            <label className="block text-sm font-semibold">
              Profesional
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={`${selectClass} mt-2 w-full`}>
                <option value="">Sin asignar</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name ?? employee.name ?? "Profesional"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
              <label className="block text-sm font-semibold">
                Fecha de inicio
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`${inputClass} mt-2 w-full`} />
              </label>
              <label className="block text-sm font-semibold">
                Hora
                <select value={startHour} onChange={(e) => setStartHour(e.target.value)} className={`${selectClass} mt-2 w-full`}>
                  {hours.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold">
                &nbsp;
                <select value={startMinute} onChange={(e) => setStartMinute(e.target.value)} className={`${selectClass} mt-2 w-full`}>
                  {minutes.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
              <label className="block text-sm font-semibold">
                Fecha de fin
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={`${inputClass} mt-2 w-full`} />
              </label>
              <label className="block text-sm font-semibold">
                Hora
                <select value={endHour} onChange={(e) => setEndHour(e.target.value)} className={`${selectClass} mt-2 w-full`}>
                  {hours.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold">
                &nbsp;
                <select value={endMinute} onChange={(e) => setEndMinute(e.target.value)} className={`${selectClass} mt-2 w-full`}>
                  {minutes.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            </div>
          </div>

          {!appointment && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
              <label className="flex items-center gap-3 text-sm font-semibold">
                <input type="checkbox" checked={repeatEnabled} onChange={(e) => setRepeatEnabled(e.target.checked)} />
                Repetir bloqueo
              </label>
              {repeatEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm font-semibold">
                    Cada
                    <div className="mt-2 flex items-center gap-2">
                      <input type="number" min="1" value={repeatEvery} onChange={(e) => setRepeatEvery(e.target.value)} className={`${inputClass} w-20`} />
                      <span className="text-sm text-muted-foreground">día(s)</span>
                    </div>
                  </label>
                  <label className="block text-sm font-semibold">
                    Finaliza después de
                    <div className="mt-2 flex items-center gap-2">
                      <input type="number" min="1" value={repeatCount} onChange={(e) => setRepeatCount(e.target.value)} className={`${inputClass} w-24`} />
                      <span className="text-sm text-muted-foreground">repeticiones</span>
                    </div>
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
    </AgendaDrawer>
  );
}

const AppointmentDetailDialog = React.memo(function AppointmentDetailDialog({
  open,
  onOpenChange,
  appointment,
  employees,
  clients,
  onEdit,
  onCancel,
  onCobrar,
  onFicha,
  onChangeStatus,
  onMarkDeposit,
  onCancelWithDeposit,
  onReleaseBlock,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  appointment: Appointment | null;
  employees: ReturnType<typeof useAgendaData>["employees"];
  clients: ReturnType<typeof useAgendaData>["clients"];
  onEdit: (a: Appointment) => void;
  onCancel: (a: Appointment) => void;
  onCobrar: (a: Appointment) => void;
  onFicha: (a: Appointment) => void;
  onChangeStatus: (a: Appointment, s: ApptStatus) => void;
  onMarkDeposit: (a: Appointment) => void;
  onCancelWithDeposit: (a: Appointment, action: "keep" | "return") => void;
  onReleaseBlock: (a: Appointment) => void;
}) {
  if (!appointment) return null;

  const employee = employees.find((e) => e.id === appointment.employee_id);
  const client = clients.find((c) => c.id === appointment.client_id);
  const start = new Date(appointment.starts_at);
  const end = appointment.ends_at
    ? new Date(appointment.ends_at)
    : new Date(start.getTime() + Number(appointment.duration_min ?? 30) * 60_000);
  const phone = client?.phone ?? null;
  const email = client?.email ?? null;
  const meta = STATUS_META[appointment.status] ?? STATUS_META.pending;
  const requiresDeposit = Boolean(appointment.deposit_status && appointment.deposit_status !== "none");
  const dateText = `${start.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "")} · ${fmtTime(start)} a ${fmtTime(end)}`;
  const statusLabel = appointment.status === "charged"
    ? "Cobrado"
    : appointment.status === "confirmed"
      ? "Confirmado"
      : appointment.status === "cancelled"
        ? "Cancelado"
        : appointment.status === "in_service"
          ? "En servicio"
          : "Pendiente";
  const cleanPhone = phone ? phone.replace(/\D/g, "") : "";
  const whatsappHref = cleanPhone ? `https://wa.me/${cleanPhone}` : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        forceMount
        side="right"
        hideOverlay
        className="w-full sm:max-w-[372px] p-0 overflow-y-auto border-white/10 bg-[#08070f] shadow-[0_24px_80px_-24px_rgba(0,0,0,0.85)] data-[state=open]:duration-100 data-[state=closed]:duration-100 data-[state=closed]:hidden"
        aria-describedby={undefined}
      >
        <SheetHeader className="relative px-4 pt-4 pb-3 border-b border-white/10 bg-white/[0.025] text-left space-y-0">
          <div className="pointer-events-none absolute -top-20 left-1/2 h-32 w-56 -translate-x-1/2 rounded-full opacity-20 blur-3xl" style={{ background: meta.dot }} />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: meta.dot }}>
                <span className="size-1.5 rounded-full" style={{ background: meta.dot, boxShadow: `0 0 12px ${meta.dot}` }} />
                {statusLabel}
              </div>
              <SheetTitle className="text-[20px] leading-none font-display tracking-tight truncate">
                {appointment.status === "blocked" ? "Horario bloqueado" : appointment.client_name || "Sin cliente"}
              </SheetTitle>
            </div>
            <div className="flex gap-1.5 pr-7">
              <Button size="sm" variant="secondary" className="h-7 rounded-full border-white/10 bg-white/[0.06] px-2.5 text-xs hover:bg-white/[0.1]" onClick={() => onFicha(appointment)}>
                <UserRound className="h-3.5 w-3.5 mr-1" /> Ficha
              </Button>
              <Button size="sm" variant="secondary" className="h-7 rounded-full border-white/10 bg-white/[0.06] px-2.5 text-xs hover:bg-white/[0.1]" onClick={() => onEdit(appointment)}>
                Editar
              </Button>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-3 p-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Turno</div>
                <div className="mt-1 text-base font-semibold leading-tight truncate">{appointment.service_name || "Servicio"}</div>
                <div className="mt-1.5 text-sm text-white/70">{dateText}</div>
                <div className="mt-0.5 text-sm text-white/45">
                  Profesional: <span className="text-white/85">{employee?.full_name ?? employee?.name ?? "Sin asignar"}</span>
                </div>
              </div>
              {appointment.service_price ? (
                <div className="shrink-0 text-right text-xl font-display font-semibold tracking-tight">
                  ${Number(appointment.service_price).toLocaleString("es-AR")}
                </div>
              ) : null}
            </div>

            {appointment.deposit_status && appointment.deposit_status !== "none" && (() => {
              const ds = appointment.deposit_status;
              const depositAmt = Number(appointment.deposit_amount ?? 0);
              const depositPaid = Number(appointment.deposit_paid ?? 0);
              const total = Number(appointment.service_price ?? 0);
              const remaining = Math.max(0, total - depositPaid);
              const statusMap: Record<string, { icon: string; label: string; color: string }> = {
                pending: { icon: "🟡", label: "Seña pendiente", color: "text-amber-300" },
                paid: { icon: "🟢", label: "Seña pagada", color: "text-emerald-300" },
                lost: { icon: "🔴", label: "Seña perdida", color: "text-rose-300" },
                returned:{ icon: "🔵", label: "Seña devuelta", color: "text-sky-300" },
              };
              const dsInfo = statusMap[ds] ?? statusMap.pending;
              return (
                <div className="mt-3 pt-3 border-t border-white/10 text-sm">
                  <div className={`font-semibold ${dsInfo.color}`}>{dsInfo.icon} {dsInfo.label}</div>
                  {depositAmt > 0 && <div className="mt-1 text-muted-foreground">Seña requerida: <span className="text-foreground font-medium">${depositAmt.toLocaleString("es-AR")}</span></div>}
                  {ds === "paid" && depositPaid > 0 && (
                    <div className="mt-1 text-muted-foreground">Pendiente de cobro: <span className="text-foreground font-medium">${remaining.toLocaleString("es-AR")}</span></div>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="space-y-2 text-sm">
            {(phone || email) && (
              <div className="grid grid-cols-2 gap-2">
                {phone && (
                  <div className={cn("flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 min-w-0", !email && "col-span-2")}>
                    <div className="min-w-0">
                      <div className="text-[9px] uppercase tracking-[0.16em] text-white/35">Teléfono</div>
                      <div className="mt-0.5 truncate text-white/85 text-[13px]">{phone}</div>
                    </div>
                    {whatsappHref && (
                      <a href={whatsappHref} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="inline-flex shrink-0 items-center justify-center h-7 w-7 rounded-full bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/25 hover:bg-emerald-500/25 transition">
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                )}
                {email && (
                  <div className={cn("rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 min-w-0", !phone && "col-span-2")}>
                    <div className="text-[9px] uppercase tracking-[0.16em] text-white/35">Email</div>
                    <div className="mt-0.5 truncate text-white/85 text-[13px]">{email}</div>
                  </div>
                )}
              </div>
            )}
            {appointment.notes && (
              <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2">
                <div className="text-[9px] uppercase tracking-[0.16em] text-white/35 mb-1">Notas</div>
                <div className="text-white/80 text-[13px]">{appointment.notes}</div>
              </div>
            )}
          </div>

          {appointment.status === "blocked" ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" className="h-9" onClick={() => onEdit(appointment)}>Editar bloqueo</Button>
              <Button variant="destructive" className="h-9" onClick={() => onReleaseBlock(appointment)}>Liberar horario</Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => onCobrar(appointment)}
                disabled={appointment.status === "charged"}
                className={appointment.status === "charged"
                  ? "h-9 rounded-2xl border-white/10 bg-white/[0.06] text-white/45"
                  : "h-9 rounded-2xl border-0 bg-emerald-500/90 text-white hover:bg-emerald-400 shadow-[0_12px_30px_-16px_rgba(16,185,129,0.9)]"}
              >
                <DollarSign className="h-4 w-4 mr-1" /> {appointment.status === "charged" ? "Cobrado" : "Cobrar"}
              </Button>
              {appointment.status !== "charged" && appointment.status !== "cancelled" && appointment.deposit_status !== "paid" ? (
                <Button variant="destructive" onClick={() => onCancel(appointment)} className="h-9 rounded-2xl bg-rose-500/90 hover:bg-rose-400 text-white border-0 shadow-[0_12px_30px_-16px_rgba(244,63,94,0.9)]">
                  Cancelar turno
                </Button>
              ) : (
                requiresDeposit && appointment.deposit_status !== "paid" && appointment.deposit_status !== "lost" && appointment.status !== "charged" && (
                  <Button variant="secondary" onClick={() => onMarkDeposit(appointment)} className="h-9 border-amber-300/25 bg-amber-300/10 text-amber-200 hover:bg-amber-300/15">
                    <DollarSign className="h-4 w-4 mr-1" /> Cobrar seña
                  </Button>
                )
              )}
            </div>
          )}

          {appointment.status !== "blocked" && (
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/35 shrink-0">Estado</div>
            <div className="flex flex-wrap gap-1.5">
              {([
                ["pending", "Pendiente"],
                ["confirmed", "Confirmado"],
              ] as [ApptStatus, string][]).map(([status, label]) => {
                const sMeta = STATUS_META[status] ?? STATUS_META.pending;
                const isActive = appointment.status === status;
                return (
                  <button
                    key={status}
                    onClick={() => onChangeStatus(appointment, status)}
                    className="rounded-full px-3 py-1 text-xs font-semibold ring-1 transition"
                    style={{
                      background: isActive ? `${sMeta.dot}18` : "rgba(255,255,255,0.035)",
                      color: isActive ? sMeta.dot : "rgba(255,255,255,0.45)",
                      boxShadow: isActive ? `inset 0 0 0 1px ${sMeta.dot}55` : "inset 0 0 0 1px rgba(255,255,255,0.1)",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {appointment.status !== "charged" && appointment.status !== "cancelled" && appointment.deposit_status === "paid" && (
            <div className="space-y-2.5 rounded-xl bg-rose-500/5 ring-1 ring-rose-400/20 p-3.5">
              <div className="text-sm font-semibold text-rose-300">Cancelar turno con seña pagada</div>
              <div className="text-xs text-muted-foreground">Elegí qué hacer con la seña antes de cancelar.</div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="destructive" className="h-9" onClick={() => onCancelWithDeposit(appointment, "keep")}>Perder seña</Button>
                <Button variant="secondary" className="h-9" onClick={() => onCancelWithDeposit(appointment, "return")}>Devolver seña</Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
});


function WeekView({
  start,
  appointments,
  schedule,
  onApptClick,
  onSlotClick,
}: {
  start: Date;
  appointments: Appointment[];
  schedule: ReturnType<typeof useAgendaData>["schedule"];
  onApptClick: (a: Appointment) => void;
  onSlotClick: (date: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const openDays = days
    .map((d) => getScheduleForDate(schedule, d))
    .filter((day): day is NonNullable<typeof day> => Boolean(day?.enabled));
  const hourStart = openDays.length ? Math.floor(Math.min(...openDays.map((day) => parseScheduleTime(day.start)))) : 0;
  const hourEnd = openDays.length ? Math.ceil(Math.max(...openDays.map((day) => parseScheduleTime(day.end)))) : 0;
  const HOURS = openDays.length ? Array.from({ length: Math.max(0, hourEnd - hourStart) }, (_, i) => hourStart + i) : [];

  return (
    <section className="glass rounded-2xl p-2 sm:p-3">
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[900px]"
          style={{ gridTemplateColumns: `64px repeat(7, minmax(120px,1fr))` }}
        >
          <div />
          {days.map((d) => {
            const isToday = startOfDay(new Date()).getTime() === startOfDay(d).getTime();
            const daySchedule = getScheduleForDate(schedule, d);
            const isClosed = !daySchedule?.enabled;
            return (
              <div
                key={d.toISOString()}
                className={cn(
                  "px-2 pb-2 pt-1 border-l border-white/[0.04] text-center",
                  isClosed && "opacity-50"
                )}
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {fmtShortDow(d)}
                </div>
                <div
                  className={cn(
                    "text-sm font-semibold",
                    isToday && "text-primary",
                  )}
                >
                  {d.getDate()}
                </div>
              </div>
            );
          })}

          <div className="relative sticky left-0 z-30 bg-background/80 backdrop-blur-xl border-r border-white/[0.06]">
            {HOURS.map((h) => (
              <div
                key={h}
                className="text-[11px] text-muted-foreground pr-2 text-right select-none"
                style={{ height: ROW_PX }}
              >
                <span className="relative -top-2">{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>

          {days.map((d) => {
            const daySchedule = getScheduleForDate(schedule, d);
            const isClosed = !daySchedule?.enabled;
            const dayAppts = appointments.filter((a) => {
              const ad = new Date(a.starts_at);
              return (
                !isClosed &&
                a.status !== "cancelled" &&
                ad.getFullYear() === d.getFullYear() &&
                ad.getMonth() === d.getMonth() &&
                ad.getDate() === d.getDate()
              );
            });
            return (
              <div key={d.toISOString()} className="relative border-l border-white/[0.04]">
                {isClosed ? (
                  <div className="absolute inset-0 grid place-items-center bg-black/10 text-[11px] text-muted-foreground text-center px-2">
                    Negocio cerrado
                  </div>
                ) : (
                  HOURS.map((h) => (
                    <div
                      key={h}
                      className="border-t border-white/[0.04] hover:bg-white/[0.02] transition cursor-pointer"
                      style={{ height: ROW_PX }}
                      onClick={() => {
                        const dt = new Date(d);
                        dt.setHours(h, 0, 0, 0);
                        onSlotClick(dt);
                      }}
                    />
                  ))
                )}
                {dayAppts.map((a) => {
                  const start = new Date(a.starts_at);
                  const startH = start.getHours() + start.getMinutes() / 60;
                  const dur = Math.max(0.5, Number(a.duration_min ?? 30) / 60);
                  const top = (startH - hourStart) * ROW_PX + 2;
                  const height = Math.max(dur * ROW_PX - 4, 38);
                  if (top < 0 || top > (hourEnd - hourStart) * ROW_PX) return null;
                  const meta = STATUS_META[a.status] ?? STATUS_META.pending;
                  return (
                    <div
                      key={a.id}
                      className="absolute left-1 right-1 rounded-md px-1.5 py-0.5 cursor-pointer hover:z-10 hover:scale-[1.01] transition overflow-hidden"
                      style={{
                        top,
                        height,
                        background: meta.bg,
                        boxShadow: `inset 0 0 0 1px ${meta.border}`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onApptClick(a);
                      }}
                    >
                      <div className="text-[8px] font-semibold leading-none truncate" style={{ color: meta.dot }}>
                        {fmtTime(start)}{a.duration_min ? ` – ${fmtTime(new Date(start.getTime() + Number(a.duration_min) * 60000))}` : ""}
                      </div>
                      <div className="text-[10px] font-semibold truncate leading-[1.05] mt-0.5">
                        {a.client_name || "—"}
                      </div>
                      <div className="text-[9px] truncate text-foreground/70 leading-[1.05] mt-0.5">
                        {a.service_name}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Month view: grilla mensual con conteo de turnos por día
// ---------------------------------------------------------------------------
function MonthView({
  cursor,
  appointments,
  onApptClick,
  onPickDay,
}: {
  cursor: Date;
  appointments: Appointment[];
  onApptClick: (a: Appointment) => void;
  onPickDay: (d: Date) => void;
}) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const leading = (first.getDay() + 6) % 7; // lunes = 0
  const totalCells = Math.ceil((leading + last.getDate()) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - leading + 1;
    if (dayNum < 1 || dayNum > last.getDate()) return null;
    return new Date(year, month, dayNum);
  });
  const today = startOfDay(new Date()).getTime();

  const apptByDay = new Map<string, Appointment[]>();
  appointments.forEach((a) => {
    const k = new Date(a.starts_at).toLocaleDateString("sv-SE");
    if (!apptByDay.has(k)) apptByDay.set(k, []);
    apptByDay.get(k)!.push(a);
  });

  return (
    <section className="glass rounded-2xl p-2 sm:p-3">
      <div className="grid grid-cols-7 gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
        {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
          <div key={d} className="px-2 py-1.5 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="h-24 rounded-xl bg-white/[0.015]" />;
          const k = d.toLocaleDateString("sv-SE");
          const items = apptByDay.get(k) ?? [];
          const isToday = startOfDay(d).getTime() === today;
          return (
            <button
              key={i}
              onClick={() => onPickDay(d)}
              className={cn(
                "h-24 rounded-xl p-2 text-left transition border",
                isToday
                  ? "border-primary/40 bg-primary/10"
                  : "border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.05]",
              )}
            >
              <div
                className={cn(
                  "text-xs font-semibold",
                  isToday ? "text-primary" : "text-foreground/85",
                )}
              >
                {d.getDate()}
              </div>
              <div className="mt-1 space-y-1">
                {items.slice(0, 2).map((a) => {
                  const meta = STATUS_META[a.status] ?? STATUS_META.pending;
                  return (
                    <div
                      key={a.id}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onApptClick(a);
                      }}
                      className="text-[10px] truncate rounded px-1.5 py-0.5"
                      style={{
                        background: meta.bg,
                        color: meta.dot,
                      }}
                    >
                      {fmtTime(new Date(a.starts_at))} {a.client_name || "—"}
                    </div>
                  );
                })}
                {items.length > 2 && (
                  <div className="text-[10px] text-muted-foreground">
                    +{items.length - 2} más
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

