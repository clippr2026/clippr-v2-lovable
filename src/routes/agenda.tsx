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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  useAgendaData,
  cancelAppointment,
  setAppointmentStatus,
  markAppointmentDeposit,
  type Appointment,
  type ApptStatus,
  getScheduleForDate,
  parseScheduleTime,
} from "@/components/agenda/use-agenda-data";
import { AppointmentDialog } from "@/components/agenda/appointment-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
    label: "En servicio",
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
const ROW_PX = 86;

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
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
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

  const [dlgOpen, setDlgOpen] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Appointment | null>(null);
  const [editing, setEditing] = React.useState<Appointment | null>(null);
  const [dlgDefaults, setDlgDefaults] = React.useState<{
    employeeId?: string | null;
    startsAt?: Date | null;
  }>({});

  const openNew = (employeeId?: string | null, startsAt?: Date | null) => {
    const target = startsAt ?? cursor;
    const schedule = getScheduleForDate(data.schedule, target);
    if (!schedule?.enabled) {
      toast.error("Negocio cerrado este día.");
      return;
    }
    setEditing(null);
    setDlgDefaults({ employeeId, startsAt });
    setDlgOpen(true);
  };
  const openDetail = (a: Appointment) => {
    setSelected(a);
    setDetailOpen(true);
  };
  const openEdit = (a: Appointment) => {
    setDetailOpen(false);
    setEditing(a);
    setDlgDefaults({});
    setDlgOpen(true);
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

  const onMarkDeposit = async (a: Appointment) => {
    try {
      const hadDeposit = /se(ñ|n)a/i.test(a.notes || "");
      await markAppointmentDeposit(a.id, a.notes);
      // When adding seña: also set status to "confirmed"
      if (!hadDeposit && a.status === "pending") {
        await setAppointmentStatus(a.id, "confirmed");
      }
      toast.success(hadDeposit ? "Seña desmarcada" : "Seña marcada · turno confirmado");
      setSelected((current) => {
        if (!current || current.id !== a.id) return current;
        const hasDeposit = /se(ñ|n)a/i.test(current.notes || "");
        const nextNotes = hasDeposit
          ? (current.notes || "").split("\n").filter((l) => !/se(ñ|n)a/i.test(l)).join("\n").trim() || null
          : [current.notes, "Seña paga"].filter(Boolean).join("\n");
        const nextStatus = !hasDeposit && current.status === "pending" ? "confirmed" as ApptStatus : current.status;
        return { ...current, notes: nextNotes, status: nextStatus };
      });
      data.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const goToCobro = async (a: Appointment) => {
    if (a.status !== "completed" && a.status !== "charged") {
      try {
        await setAppointmentStatus(a.id, "completed");
        data.refresh();
      } catch (e) {
        toast.error((e as Error).message);
        return;
      }
    }
    navigate({ to: "/cash-register", search: { appointmentId: a.id } as never });
  };

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
    inService: data.appointments.filter((a) => a.status === "completed").length,
    seña: data.appointments.filter((a) => /se(ñ|n)a/i.test(a.notes || "")).length,
    charged: data.appointments.filter((a) => a.status === "charged").length,
    cancelled: data.appointments.filter((a) => a.status === "cancelled").length,
  };
  const [filterModal, setFilterModal] = React.useState<string|null>(null);

  const move = (delta: number) => {
    const step = view === "day" ? 1 : view === "week" ? 7 : 30;
    setCursor((c) => new Date(c.getTime() + delta * step * DAY_MS));
  };

  const headerLabel =
    view === "day"
      ? fmtDate(cursor)
      : view === "month"
        ? cursor.toLocaleDateString("es-AR", { month: "long", year: "numeric" })
        : `${range.start.toLocaleDateString("es-AR")} – ${range.end.toLocaleDateString("es-AR")}`;

  return (
    <AppShell>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 animate-fade-up">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">Agenda</h1>

        {/* All nav controls grouped together */}
        <div className="flex items-center gap-1.5 glass rounded-2xl px-2 py-1.5">
          {/* Hoy — leftmost */}
          <button
            onClick={() => setCursor(startOfDay(new Date()))}
            className="px-3 py-1.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition"
          >
            Hoy
          </button>
          <div className="h-4 w-px bg-white/10 mx-1" />
          {/* Date label */}
          <div className="inline-flex items-center gap-1.5 px-2 text-sm">
            <CalendarIcon className="h-3.5 w-3.5 text-primary" />
            <span className="capitalize text-sm font-medium">{headerLabel}</span>
          </div>
          <div className="h-4 w-px bg-white/10 mx-1" />
          {/* View selector */}
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-medium transition",
                view === v
                  ? "text-white shadow-[0_4px_16px_-6px_oklch(0.65_0.28_290/0.7)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
              )}
              style={view === v ? { background: "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))" } : undefined}
            >
              {v === "day" ? "Día" : v === "week" ? "Semana" : "Mes"}
            </button>
          ))}
          <div className="h-4 w-px bg-white/10 mx-1" />
          {/* Prev / Next */}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(-1)}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(1)}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Button onClick={() => openNew(null, cursor)}>
          <Plus className="h-4 w-4 mr-1" /> Nuevo turno
        </Button>
      </div>

      {/* Quick stats */}
      <section className="glass rounded-2xl p-5 mb-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 animate-fade-up">
        {([
          ["pending",   "Pendientes",   "oklch(0.72 0.2 245)"],
          ["confirmed", "Confirmados",  "oklch(0.72 0.26 305)"],
          ["inService", "En servicio",  "oklch(0.92 0.18 100)"],
          ["charged",   "Cobrados",     "oklch(0.76 0.2 155)"],
          ["cancelled", "Cancelados",   "oklch(0.65 0.2 25)"],
        ] as [string,string,string][]).map(([k, label, color]) => (
          <div key={k} className="group">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="font-display text-2xl sm:text-3xl font-semibold mt-1" style={{ color }}>
              {(counts as Record<string,number>)[k] ?? 0}
            </div>
            <button
              onClick={() => setFilterModal(k)}
              className="text-[10px] text-muted-foreground hover:text-foreground mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              Ver todos →
            </button>
          </div>
        ))}
        {data.loading && (
          <div className="col-span-full text-xs text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" /> Cargando…
          </div>
        )}
      </section>

      {/* Filter modal */}
      {filterModal && (() => {
        const statusMap: Record<string,string> = { pending:"pending", confirmed:"confirmed", inService:"completed", charged:"charged", cancelled:"cancelled" };
        const labels: Record<string,string> = { pending:"Pendientes", confirmed:"Confirmados", inService:"En servicio", charged:"Cobrados", cancelled:"Cancelados" };
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

      {/* Calendar */}
      {view === "day" ? (
        <DayView
          date={cursor}
          data={data}
          schedule={getScheduleForDate(data.schedule, cursor)}
          onSlotClick={openNew}
          onApptClick={openDetail}
          onChangeStatus={onChangeStatus}
          onCobrar={goToCobro}
        />
      ) : view === "week" ? (
        <WeekView
          start={startOfWeek(cursor)}
          appointments={data.appointments}
          schedule={data.schedule}
          onApptClick={openDetail}
          onSlotClick={(date) => openNew(null, date)}
        />
      ) : (
        <MonthView
          cursor={cursor}
          appointments={data.appointments}
          onApptClick={openDetail}
          onPickDay={(d) => {
            setCursor(d);
            setView("day");
          }}
        />
      )}

      <AppointmentDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        appointment={selected}
        employees={data.employees}
        clients={data.clients}
        onEdit={openEdit}
        onCancel={(a) => { if (window.confirm("¿Cancelar este turno? No se puede deshacer.")) onChangeStatus(a, "cancelled"); }}
        onCobrar={goToCobro}
        onFicha={() => navigate({ to: "/clients" })}
        onChangeStatus={onChangeStatus}
        onMarkDeposit={onMarkDeposit}
      />

      {data.businessId && (
        <AppointmentDialog
          open={dlgOpen}
          onOpenChange={setDlgOpen}
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
        />
      )}
    </AppShell>
  );
}

type ApptLayout = { lane: number; laneCount: number };

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
function DayView({
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
  onSlotClick: (employeeId: string | null, startsAt: Date) => void;
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

  const handleDrop = async (e: React.DragEvent, empId: string, hour: number, dropDate?: Date) => {
    e.preventDefault();
    const apptId = e.dataTransfer.getData("apptId");
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
    const targetDate = dropDate ?? date;
    const newStart = new Date(targetDate);
    newStart.setHours(hour, 0, 0, 0);
    const dur = Number(appt.duration_min ?? 30);
    const newEnd = new Date(newStart.getTime() + dur * 60000);
    try {
      const { error } = await supabase.from("appointments").update({
        starts_at: newStart.toISOString(),
        ends_at: newEnd.toISOString(),
        employee_id: empId === "__none__" ? null : empId,
      }).eq("id", apptId);
      if (error) throw new Error(error.message);
      data.refresh();
      toast.success("Turno movido");
    } catch (ex) { toast.error((ex as Error).message); }
  };

  const sameDay = (iso: string) => {
    const d = new Date(iso);
    return (
      d.getFullYear() === date.getFullYear() &&
      d.getMonth() === date.getMonth() &&
      d.getDate() === date.getDate()
    );
  };
  const dayAppts = data.appointments.filter((a) => sameDay(a.starts_at) && a.status !== "cancelled");
  const isToday = startOfDay(now).getTime() === startOfDay(date).getTime();
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const showNowLine = isToday && !isClosed && nowHour >= HOUR_START && nowHour <= HOUR_END;
  const nowLineTop = (nowHour - HOUR_START) * ROW_PX;

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
    <section className="glass rounded-2xl p-4">
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[800px]"
          style={{ gridTemplateColumns: `64px repeat(${employees.length}, minmax(180px,1fr))` }}
        >
          <div />
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
                className="px-3 pb-3 pt-1 border-l border-white/[0.04] flex items-center gap-2.5"
              >
                {e.avatar_url ? (
                  <img
                    src={e.avatar_url}
                    alt={e.full_name ?? ""}
                    className="h-9 w-9 rounded-full object-cover ring-1 ring-white/10 shrink-0"
                  />
                ) : (
                  <div
                    className="h-9 w-9 rounded-full grid place-items-center text-xs font-semibold text-white ring-1 ring-white/10 shrink-0"
                    style={{ background: "linear-gradient(135deg, oklch(0.7 0.22 245), oklch(0.65 0.27 305))" }}
                  >
                    {initials || "?"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{e.full_name ?? e.name}</div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
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

          <div className="relative">
            {HOURS.map((h) => (
              <div
                key={h}
                className="text-[11px] text-muted-foreground pr-2 text-right"
                style={{ height: ROW_PX }}
              >
                <span className="relative -top-2">{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>

          {employees.map((e) => (
            <div key={e.id} className="relative border-l border-white/[0.04]">
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors cursor-pointer"
                  style={{ height: ROW_PX }}
                  onDragOver={(ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; }}
                  onDrop={(ev) => handleDrop(ev, e.id, h)}
                  onClick={() => {
                    const dt = new Date(date);
                    dt.setHours(h, 0, 0, 0);
                    onSlotClick(e.id === "__none__" ? null : e.id, dt);
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

              {(() => {
                const columnAppts = dayAppts.filter((a) => (e.id === "__none__" ? !a.employee_id : a.employee_id === e.id));
                const layouts = computeOverlapLayouts(columnAppts);
                return columnAppts.map((a) => (
                  <ApptCard
                    key={a.id}
                    a={a}
                    layout={layouts.get(a.id)}
                    hourStart={HOUR_START}
                    hourEnd={HOUR_END}
                    onClick={() => onApptClick(a)}
                    onChangeStatus={(s) => onChangeStatus(a, s)}
                    onCobrar={() => onCobrar(a)}
                  />
                ));
              })()}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ApptCard({
  a,
  onClick,
  onChangeStatus,
  onCobrar,
  layout,
  hourStart,
  hourEnd,
}: {
  a: Appointment;
  onClick: () => void;
  onChangeStatus: (s: ApptStatus) => void;
  onCobrar: () => void;
  layout?: ApptLayout;
  hourStart: number;
  hourEnd: number;
}) {
  const start = new Date(a.starts_at);
  const startH = start.getHours() + start.getMinutes() / 60;
  const dur = Math.max(0.5, Number(a.duration_min ?? 30) / 60);
  const top = (startH - hourStart) * ROW_PX + 2;
  const height = Math.max(dur * ROW_PX - 4, 38);
  if (top < 0 || top > (hourEnd - hourStart) * ROW_PX) return null;
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
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {/* Time + status */}
      <div className="flex items-center justify-between gap-1 min-w-0 leading-none">
        <span className="text-[9px] font-bold tabular-nums truncate leading-none" style={{ color: meta.dot }}>
          {fmtTime(start)}{a.duration_min ? ` – ${fmtTime(new Date(start.getTime() + Number(a.duration_min)*60000))}` : ""}
        </span>
        <span className="shrink-0 text-[8px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded-full" style={{ background: meta.bg, color: meta.dot, boxShadow: `inset 0 0 0 1px ${meta.border}` }}>
          {meta.label}
        </span>
      </div>
      {/* Client */}
      <div className="text-[10px] font-semibold leading-[1.05] truncate mt-0.5">{a.client_name || "Sin nombre"}</div>
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
}

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

function AppointmentDetailDialog({
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
  const dateText = `${start.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "long" })} - ${fmtTime(start)} a ${fmtTime(end)}`;
  const cleanPhone = phone ? phone.replace(/\D/g, "") : "";
  const whatsappHref = cleanPhone ? `https://wa.me/${cleanPhone}` : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden" aria-describedby={undefined}>
        <DialogHeader className="px-6 pt-5 pb-4" style={{ background: `oklch(from ${meta.dot} calc(l*0.15) c h / 0.12)`, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Cliente Nuevo</div>
              <DialogTitle className="mt-1 text-2xl font-display">{appointment.client_name || "Sin cliente"}</DialogTitle>
            </div>
            <div className="flex gap-2 pr-6">
              <Button size="sm" variant="secondary" onClick={() => onEdit(appointment)}>
                Editar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                Cerrar
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-4 px-6" style={{ background: `oklch(from ${meta.dot} calc(l*0.15) c h / 0.08)` }}>
          <div className="rounded-2xl p-4 ring-1 ring-white/10" style={{ background: meta.bg }}>
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: meta.dot }}>
              {meta.label}
            </div>
            <div className="mt-2 text-lg font-semibold">{appointment.service_name || "Servicio"}</div>
            {appointment.service_price ? (
              <div className="mt-1 text-2xl font-display font-semibold">
                ${Number(appointment.service_price).toLocaleString("es-AR")}
              </div>
            ) : null}
            <div className="mt-3 text-sm text-foreground/80 capitalize">{dateText}</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Se atenderá con: <span className="text-foreground">{employee?.full_name ?? employee?.name ?? "Sin asignar"}</span>
            </div>
          </div>

          <div className="grid gap-3 text-sm">
            {phone && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] ring-1 ring-white/10 px-3 py-2.5">
                <span>{phone}</span>
                {whatsappHref && (
                  <a href={whatsappHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/15 transition">
                    <MessageCircle className="h-3.5 w-3.5" /> Hablar por WhatsApp
                  </a>
                )}
              </div>
            )}
            {email && <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 px-3 py-2.5">{email}</div>}
            {appointment.notes && (
              <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Nota interna</div>
                {appointment.notes}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => onCobrar(appointment)} disabled={appointment.status === "charged"}>
              <DollarSign className="h-4 w-4 mr-1" /> {appointment.status === "charged" ? "Cobrado" : "Cobrar"}
            </Button>
            <Button variant="secondary" onClick={() => onFicha(appointment)}>
              <UserRound className="h-4 w-4 mr-1" /> Ficha
            </Button>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Cambiar estado</div>
            <div className="flex flex-wrap gap-2">
              {(() => {
                const hasDeposit = /se(ñ|n)a/i.test(appointment.notes || "");
                return ([
                  ["pending", "Pendiente"],
                  ["confirmed", "Confirmado"],
                  ["completed", "En servicio"],
                  ["charged", "Cobrado"],
                ] as [ApptStatus, string][]).map(([status, label]) => {
                  const sMeta = STATUS_META[status] ?? STATUS_META.pending;
                  const isActive = appointment.status === status;
                  // Block going back to pending if has seña
                  const isDisabled = status === "pending" && hasDeposit;
                  return (
                    <button
                      key={status}
                      onClick={() => !isDisabled && onChangeStatus(appointment, status)}
                      disabled={isDisabled}
                      title={isDisabled ? "No se puede volver a Pendiente con seña cargada" : undefined}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 transition disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{
                        background: isActive ? sMeta.bg : "rgba(255,255,255,0.03)",
                        color: isActive ? sMeta.dot : "rgba(255,255,255,0.45)",
                        boxShadow: isActive ? `inset 0 0 0 1px ${sMeta.border}, 0 0 12px -4px ${sMeta.dot}` : "inset 0 0 0 1px rgba(255,255,255,0.1)",
                      }}
                    >
                      {label}
                    </button>
                  );
                });
              })()}
              {/* Seña — marks as confirmed + adds note */}
              {(() => {
                const hasDeposit = /se(ñ|n)a/i.test(appointment.notes || "");
                return (
                  <button
                    onClick={() => onMarkDeposit(appointment)}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 transition"
                    style={{
                      background: hasDeposit ? "oklch(0.42 0.18 75 / 0.5)" : "rgba(255,255,255,0.03)",
                      color: hasDeposit ? "oklch(0.88 0.2 75)" : "rgba(255,255,255,0.45)",
                      boxShadow: hasDeposit
                        ? "inset 0 0 0 1px oklch(0.82 0.2 75), 0 0 12px -4px oklch(0.88 0.2 75)"
                        : "inset 0 0 0 1px rgba(255,255,255,0.1)",
                    }}
                  >
                    Seña {hasDeposit ? "✓" : ""}
                  </button>
                );
              })()}
            </div>
          </div>

          {appointment.status !== "charged" && appointment.status !== "cancelled" && (
            <Button variant="destructive" className="w-full" onClick={() => onCancel(appointment)}>
              Cancelar turno
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Week view: columnas por día
// ---------------------------------------------------------------------------
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
    <section className="glass rounded-2xl p-4">
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

          <div className="relative">
            {HOURS.map((h) => (
              <div
                key={h}
                className="text-[11px] text-muted-foreground pr-2 text-right"
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
    <section className="glass rounded-2xl p-4">
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

