import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as React from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  useAgendaData,
  cancelAppointment,
  setAppointmentStatus,
  type Appointment,
  type ApptStatus,
} from "@/components/agenda/use-agenda-data";
import { AppointmentDialog } from "@/components/agenda/appointment-dialog";
import { Button } from "@/components/ui/button";

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
    bg: "oklch(0.4 0.22 260 / 0.35)",
    border: "oklch(0.72 0.22 260)",
    dot: "oklch(0.72 0.22 260)",
  },
  confirmed: {
    label: "Confirmado",
    bg: "oklch(0.4 0.24 300 / 0.35)",
    border: "oklch(0.72 0.25 300)",
    dot: "oklch(0.72 0.25 300)",
  },
  completed: {
    label: "Completado",
    bg: "oklch(0.4 0.2 150 / 0.35)",
    border: "oklch(0.76 0.2 150)",
    dot: "oklch(0.76 0.2 150)",
  },
  charged: {
    label: "Cobrado",
    bg: "oklch(0.4 0.2 150 / 0.55)",
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
const HOUR_START = 8;
const HOUR_END = 22;
const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
const ROW_PX = 64;

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
  const [editing, setEditing] = React.useState<Appointment | null>(null);
  const [dlgDefaults, setDlgDefaults] = React.useState<{
    employeeId?: string | null;
    startsAt?: Date | null;
  }>({});

  const openNew = (employeeId?: string | null, startsAt?: Date | null) => {
    setEditing(null);
    setDlgDefaults({ employeeId, startsAt });
    setDlgOpen(true);
  };
  const openEdit = (a: Appointment) => {
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
  };

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
      <div className="flex flex-wrap items-center gap-3 mb-5 animate-fade-up">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">Agenda</h1>
        <div className="inline-flex items-center gap-2 glass rounded-xl px-3.5 h-10 text-sm">
          <CalendarIcon className="h-4 w-4 text-primary" />
          <span className="capitalize">{headerLabel}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 glass rounded-xl p-1">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-medium transition",
                  view === v
                    ? "text-white shadow-[0_8px_24px_-10px_oklch(0.65_0.28_290/0.7)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
                style={
                  view === v
                    ? {
                        background:
                          "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))",
                      }
                    : undefined
                }
              >
                {v === "day" ? "Día" : v === "week" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>
          <Button size="sm" variant="secondary" onClick={() => setCursor(startOfDay(new Date()))}>
            Hoy
          </Button>
          <Button size="icon" variant="ghost" onClick={() => move(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => move(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button onClick={() => openNew(null, cursor)}>
            <Plus className="h-4 w-4 mr-1" /> Nuevo turno
          </Button>
        </div>
      </div>

      {/* Quick stats */}
      <section className="glass rounded-2xl p-5 mb-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 animate-fade-up">
        {([
          ["pending", "Pendientes", "oklch(0.72 0.2 245)"],
          ["confirmed", "Confirmados", "oklch(0.72 0.26 305)"],
          ["inService", "En servicio", "oklch(0.78 0.17 55)"],
          ["seña", "Seña", "oklch(0.78 0.17 75)"],
          ["charged", "Cobrados", "oklch(0.76 0.2 155)"],
        ] as const).map(([k, label, color]) => (
          <div key={k}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="font-display text-2xl sm:text-3xl font-semibold mt-1" style={{ color }}>
              {counts[k as keyof typeof counts]}
            </div>
          </div>
        ))}
        {data.loading && (
          <div className="col-span-full text-xs text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" /> Cargando…
          </div>
        )}
      </section>

      {/* Calendar */}
      {view === "day" ? (
        <DayView
          date={cursor}
          data={data}
          onSlotClick={openNew}
          onApptClick={openEdit}
          onChangeStatus={onChangeStatus}
          onCobrar={goToCobro}
        />
      ) : view === "week" ? (
        <WeekView
          start={startOfWeek(cursor)}
          appointments={data.appointments}
          onApptClick={openEdit}
          onSlotClick={(date) => openNew(null, date)}
        />
      ) : (
        <MonthView
          cursor={cursor}
          appointments={data.appointments}
          onApptClick={openEdit}
          onPickDay={(d) => {
            setCursor(d);
            setView("day");
          }}
        />
      )}

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

// ---------------------------------------------------------------------------
// Day view: columnas por profesional
// ---------------------------------------------------------------------------
function DayView({
  date,
  data,
  onSlotClick,
  onApptClick,
  onChangeStatus,
  onCobrar,
}: {
  date: Date;
  data: ReturnType<typeof useAgendaData>;
  onSlotClick: (employeeId: string | null, startsAt: Date) => void;
  onApptClick: (a: Appointment) => void;
  onChangeStatus: (a: Appointment, s: ApptStatus) => void;
  onCobrar: (a: Appointment) => void;
}) {
  const employees = data.employees.length
    ? data.employees
    : [{ id: "__none__", name: "Sin asignar", sort_order: 0 }];

  const sameDay = (iso: string) => {
    const d = new Date(iso);
    return (
      d.getFullYear() === date.getFullYear() &&
      d.getMonth() === date.getMonth() &&
      d.getDate() === date.getDate()
    );
  };
  const dayAppts = data.appointments.filter((a) => sameDay(a.starts_at));

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
            const initials = (e.name || "?")
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
                <div
                  className="h-9 w-9 rounded-full grid place-items-center text-xs font-semibold text-white ring-1 ring-white/10 shrink-0"
                  style={{
                    background:
                      "linear-gradient(135deg, oklch(0.7 0.22 245), oklch(0.65 0.27 305))",
                  }}
                >
                  {initials || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{e.name}</div>
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
                  onClick={() => {
                    const dt = new Date(date);
                    dt.setHours(h, 0, 0, 0);
                    onSlotClick(e.id === "__none__" ? null : e.id, dt);
                  }}
                />
              ))}

              {dayAppts
                .filter((a) => (e.id === "__none__" ? !a.employee_id : a.employee_id === e.id))
                .map((a) => (
                  <ApptCard
                    key={a.id}
                    a={a}
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
}

function ApptCard({
  a,
  onClick,
  onChangeStatus,
  onCobrar,
}: {
  a: Appointment;
  onClick: () => void;
  onChangeStatus: (s: ApptStatus) => void;
  onCobrar: () => void;
}) {
  const start = new Date(a.starts_at);
  const startH = start.getHours() + start.getMinutes() / 60;
  const dur = Math.max(0.5, Number(a.duration_min ?? 30) / 60);
  const top = (startH - HOUR_START) * ROW_PX + 2;
  const height = dur * ROW_PX - 4;
  if (top < 0 || top > (HOUR_END - HOUR_START) * ROW_PX) return null;
  const meta = STATUS_META[a.status];

  return (
    <div
      className="absolute left-1.5 right-1.5 rounded-lg px-2.5 py-1.5 cursor-pointer group transition hover:z-10 hover:scale-[1.01]"
      style={{
        top,
        height,
        background: meta.bg,
        boxShadow: `inset 0 0 0 1px ${meta.border}`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <div className="text-[10px] font-semibold" style={{ color: meta.dot }}>
        {fmtTime(start)} · {meta.label}
      </div>
      <div className="text-xs font-semibold truncate">{a.client_name || "Sin nombre"}</div>
      <div className="text-[10px] text-foreground/70 truncate">{a.service_name}</div>
      {a.service_price ? (
        <div className="text-[10px] text-foreground/60">
          ${Math.round(Number(a.service_price)).toLocaleString("es-AR")}
        </div>
      ) : null}

      {/* Quick actions */}
      <div
        className="absolute bottom-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition"
        onClick={(e) => e.stopPropagation()}
      >
        {a.status === "pending" && (
          <IconBtn title="Confirmar" onClick={() => onChangeStatus("confirmed")}>
            <Check className="h-3 w-3" />
          </IconBtn>
        )}
        {(a.status === "pending" || a.status === "confirmed") && (
          <IconBtn title="Completar" onClick={() => onChangeStatus("completed")}>
            <CheckCircle2 className="h-3 w-3" />
          </IconBtn>
        )}
        {(a.status === "completed" || a.status === "confirmed" || a.status === "pending") && (
          <IconBtn title="Cobrar" onClick={onCobrar}>
            <DollarSign className="h-3 w-3" />
          </IconBtn>
        )}
        <IconBtn title="Editar" onClick={onClick}>
          <Pencil className="h-3 w-3" />
        </IconBtn>
        {a.status !== "cancelled" && (
          <IconBtn title="Cancelar" onClick={() => onChangeStatus("cancelled")}>
            <X className="h-3 w-3" />
          </IconBtn>
        )}
      </div>
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

// ---------------------------------------------------------------------------
// Week view: columnas por día
// ---------------------------------------------------------------------------
function WeekView({
  start,
  appointments,
  onApptClick,
  onSlotClick,
}: {
  start: Date;
  appointments: Appointment[];
  onApptClick: (a: Appointment) => void;
  onSlotClick: (date: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

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
            return (
              <div
                key={d.toISOString()}
                className="px-2 pb-2 pt-1 border-l border-white/[0.04] text-center"
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
            const dayAppts = appointments.filter((a) => {
              const ad = new Date(a.starts_at);
              return (
                ad.getFullYear() === d.getFullYear() &&
                ad.getMonth() === d.getMonth() &&
                ad.getDate() === d.getDate()
              );
            });
            return (
              <div key={d.toISOString()} className="relative border-l border-white/[0.04]">
                {HOURS.map((h) => (
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
                ))}
                {dayAppts.map((a) => {
                  const start = new Date(a.starts_at);
                  const startH = start.getHours() + start.getMinutes() / 60;
                  const dur = Math.max(0.5, Number(a.duration_min ?? 30) / 60);
                  const top = (startH - HOUR_START) * ROW_PX + 2;
                  const height = dur * ROW_PX - 4;
                  if (top < 0) return null;
                  const meta = STATUS_META[a.status];
                  return (
                    <div
                      key={a.id}
                      className="absolute left-1 right-1 rounded-md px-1.5 py-1 cursor-pointer hover:z-10 hover:scale-[1.01] transition"
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
                      <div className="text-[9px] font-semibold" style={{ color: meta.dot }}>
                        {fmtTime(start)}
                      </div>
                      <div className="text-[11px] font-semibold truncate">
                        {a.client_name || "—"}
                      </div>
                      <div className="text-[10px] truncate text-foreground/70">
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
                  const meta = STATUS_META[a.status];
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

