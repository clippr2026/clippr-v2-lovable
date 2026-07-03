import {
  createFileRoute,
  useNavigate } from "@tanstack/react-router"; import * as React from "react"; import { supabase } from "@/integrations/supabase/client"; import { toast } from "sonner"; import { AppShell } from "@/components/app-shell"; import {   ChevronLeft,
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
  Clock3,
  UserX,
  Clock,
  Scissors,
  Phone,
  Mail
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ServiceImage } from "@/components/ui/service-image";
import { useAuth } from "@/hooks/use-auth";
import {
  useAgendaData,
  cancelAppointment,
  setAppointmentStatus,
  checkDaySchedule,
  resolveDaySchedule,
  toDateKey,
  type Appointment,
  type ApptStatus,
  type DaySchedule,
  getScheduleForDate,
  getVisibleRange,
  parseScheduleTime,
} from "@/components/agenda/use-agenda-data";
import { AppointmentDialog } from "@/components/agenda/appointment-dialog";
import { SpecialDayEditor } from "@/components/settings/special-hours-editor";
import { AgendaDrawer } from "@/components/agenda/agenda-drawer";
import { DarkCalendar } from "@/components/agenda/dark-calendar";
import { RejectedClientsButton, RejectedClientCaptureModal } from "@/components/agenda/rejected-clients";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClipprLoader } from "@/components/ui/clippr-loader";

/**
 * Stable callback identity that always invokes the latest closure.
 * Lets us pass handlers to memoized children without breaking React.memo
 * and without dependency-array juggling (the "useEvent" pattern).
 */
function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = React.useRef(fn);
  React.useLayoutEffect(() => {
    ref.current = fn;
  });
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
const STATUS_META: Record<ApptStatus, { label: string; bg: string; border: string; dot: string }> =
  {
    pending: {
      label: "Por confirmar",
      bg: "oklch(0.38 0.2 220 / 0.4)",
      border: "oklch(0.72 0.2 210)",
      dot: "oklch(0.82 0.18 210)",
    },
    confirmed: {
      label: "Confirmado",
      bg: "rgba(139, 92, 246, 0.28)",
      border: "#8B5CF6",
      dot: "#A78BFA",
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
      label: "Cancelar",
      bg: "oklch(0.3 0.02 270 / 0.38)",
      border: "oklch(0.62 0.03 270)",
      dot: "oklch(0.76 0.02 270)",
    },
    no_show: {
      label: "No asistió",
      bg: "oklch(0.34 0.2 25 / 0.58)",
      border: "oklch(0.68 0.22 25)",
      dot: "oklch(0.68 0.22 25)",
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
// Alto FIJO de cada bloque de 1 hora (no se achica para meter más horas) y alto
// del header de profesionales. La grilla muestra ~11 bloques y, si el día tiene
// más horas visibles, scrollea verticalmente en vez de comprimir las filas.
const AGENDA_ROW_PX = 64;
const AGENDA_HEADER_PX = 46;
const AGENDA_VISIBLE_ROWS = 11;
const AGENDA_SLOT_OPTIONS = [20, 30, 40, 45, 50, 60] as const;
const AGENDA_SLOT_STORAGE_KEY = "clippr-agenda-slot-minutes";

// Un casillero/horario está en el pasado si su instante ya ocurrió. Se usa SOLO
// para impedir la CREACIÓN de turnos/bloqueos nuevos en el pasado; nunca para
// limitar acciones sobre turnos ya existentes (abrir, editar, cancelar, liberar).
const isPastSlot = (date: Date) => date.getTime() < Date.now();
const PAST_SLOT_MESSAGE = "No podés crear turnos en horarios que ya pasaron.";

// Un turno está en el pasado cuando ya terminó (ends_at, o start + duración).
// Los turnos pasados quedan SOLO como historial: no se editan, mueven, cancelan,
// cobran ni eliminan. `getApptEnd` está declarado más abajo (función hoisteada).
const isPastAppointment = (a: Appointment) => getApptEnd(a).getTime() < Date.now();
const PAST_APPT_MESSAGE = "Este turno ya pasó: solo se puede ver o marcar como no asistió.";
const AGENDA_EMPLOYEE_COL_PX = 160;
const AGENDA_VIRTUALIZE_AFTER = 12;
const AGENDA_VIRTUAL_OVERSCAN = 4;

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
    supabase
      .from("business_settings")
      .select("senas_config")
      .eq("business_id", businessId)
      .maybeSingle()
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
    return Math.round((price * senasConfig.amount_value) / 100);
  };

  // Single source of truth: only ONE lateral drawer can be active at a time.
  // Opening any drawer switches this; closing sets it to null. No stacking.
  const [activeDrawer, setActiveDrawer] = React.useState<
    "detail" | "new" | "edit" | "block" | "filter" | null
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
    restricted?: boolean;
  } | null>(null);
  const [blockDialog, setBlockDialog] = React.useState<{
    employeeId: string | null;
    startsAt: Date;
    appointment?: Appointment | null;
  } | null>(null);
  const [newMenu, setNewMenu] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectAt, setRejectAt] = React.useState<Date | null>(null);
  // Descansos habilitados temporalmente (solo en esta sesión, sin tocar la
  // config permanente). Clave: `${employeeId}|${YYYY-MM-DD}`.
  const [enabledBreaks, setEnabledBreaks] = React.useState<Set<string>>(() => new Set());
  // Modal al tocar un bloque de descanso.
  const [breakModal, setBreakModal] = React.useState<{
    employeeId: string | null;
    date: Date;
    breakStart: string;
    breakEnd: string;
  } | null>(null);
  // Editor de horario especial para (profesional, fecha) desde la Agenda.
  const [specialEditor, setSpecialEditor] = React.useState<{
    employeeId: string | null;
    date: Date;
    startsAt: Date;
    available: boolean;
    start: string;
    end: string;
    breakStart: string;
    breakEnd: string;
    saving: boolean;
  } | null>(null);
  const newBtnRef = React.useRef<HTMLButtonElement>(null);
  const [newMenuPos, setNewMenuPos] = React.useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });
  const [calOpen, setCalOpen] = React.useState(false);
  const dateBtnRef = React.useRef<HTMLButtonElement>(null);
  const [calPos, setCalPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const openCalendar = () => {
    const r = dateBtnRef.current?.getBoundingClientRect();
    if (r) {
      const centered = r.left + r.width / 2;
      // Mantener el popover (≈280px) dentro de la pantalla en móvil.
      const left = Math.min(Math.max(centered, 150), window.innerWidth - 150);
      setCalPos({ top: r.bottom + 6, left });
    }
    setCalOpen(true);
  };
  const toggleNewMenu = () => {
    setNewMenu((v) => {
      const next = !v;
      if (next && newBtnRef.current) {
        const r = newBtnRef.current.getBoundingClientRect();
        setNewMenuPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
      }
      return next;
    });
  };

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
    // Casillero vacío en el pasado: no se puede crear nada (turno ni bloqueo).
    // Los turnos YA existentes no pasan por acá (usan openDetail), así que se
    // siguen pudiendo abrir/cancelar/eliminar/liberar.
    if (isPastSlot(startsAt)) {
      toast.error(PAST_SLOT_MESSAGE);
      return;
    }
    // Bloqueo de creación fuera del horario real, resolviendo la prioridad de
    // horarios (especial profesional → normal profesional → especial negocio →
    // normal negocio). (Fase posterior: convertir en confirmación con override.)
    const resolvedDay = resolveDaySchedule(
      data.schedule,
      data.employeeSchedules ?? {},
      data.businessSpecialDates ?? {},
      data.employeeSpecialDates ?? {},
      employeeId,
      startsAt,
    );
    const breakKey = `${employeeId ?? "__none__"}|${toDateKey(startsAt)}`;
    const breakEnabled = enabledBreaks.has(breakKey);
    const guardErr = checkDaySchedule(resolvedDay, startsAt, 1);
    if (guardErr) {
      // Descanso: si no está habilitado temporalmente, abrir el modal de
      // descanso (Cancelar / Habilitar / Editar). Si ya está habilitado, dejar
      // pasar (cae al setSlotMenu de abajo).
      if (guardErr.includes("descanso") && !breakEnabled) {
        const br = breakRangeMin(resolvedDay);
        setBreakModal({
          employeeId,
          date: startsAt,
          breakStart: br ? minToHHMM(br.startMin) : (resolvedDay?.breakStart ?? ""),
          breakEnd: br ? minToHHMM(br.endMin) : (resolvedDay?.breakEnd ?? ""),
        });
        return;
      }
      if (!guardErr.includes("descanso")) {
        // Día no disponible / fuera de horario. No bloqueamos del todo: si hay
        // un profesional en la columna, abrimos un menú reducido para poder
        // entrar a "Horario especial" y volver a habilitar el día (ej. 08:00–
        // 22:00). La validación de turnos queda intacta: en este modo no se
        // ofrece "Agregar turno".
        if (employeeId) {
          setSlotMenu({
            employeeId,
            startsAt,
            x: event.clientX,
            y: event.clientY,
            restricted: true,
          });
        } else {
          toast.error("Seleccioná un profesional para editar el horario especial de este día.");
        }
        return;
      }
      // (guardErr es descanso pero breakEnabled === true) → continúa.
    }

    setSlotMenu({
      employeeId,
      startsAt,
      x: event.clientX,
      y: event.clientY,
      restricted: false,
    });
  };

  const openBlockDialog = (
    employeeId: string | null,
    startsAt: Date,
    appointment?: Appointment | null,
  ) => {
    setSlotMenu(null);
    setBlockDialog({ employeeId, startsAt, appointment });
    setActiveDrawer("block");
  };

  const buildSpecialEditorState = (employeeId: string | null, date: Date) => {
    if (!employeeId) {
      return {
        employeeId: null,
        date,
        startsAt: date,
        available: true,
        start: "11:00",
        end: "20:00",
        breakStart: "",
        breakEnd: "",
        saving: false,
      };
    }

    const day = resolveDaySchedule(
      data.schedule,
      data.employeeSchedules ?? {},
      data.businessSpecialDates ?? {},
      data.employeeSpecialDates ?? {},
      employeeId,
      date,
    );

    const base =
      day?.enabled !== false
        ? day
        : resolveDaySchedule(data.schedule, data.employeeSchedules ?? {}, {}, {}, employeeId, date);

    return {
      employeeId,
      date,
      startsAt: date,
      available: day?.enabled !== false,
      start: base?.start ?? "11:00",
      end: base?.end ?? "20:00",
      breakStart: base?.breakStart ?? "",
      breakEnd: base?.breakEnd ?? "",
      saving: false,
    };
  };

  const changeSpecialEmployee = (employeeId: string) => {
    setSpecialEditor((current) => {
      if (!current) return current;
      return buildSpecialEditorState(employeeId || null, current.date);
    });
  };

  const openBlockFromSpecial = () => {
    if (!specialEditor?.employeeId) {
      toast.error("Seleccioná un profesional para bloquear horario.");
      return;
    }
    const start = specialEditor.startsAt ?? specialEditor.date;
    setSpecialEditor(null);
    openBlockDialog(specialEditor.employeeId, start);
  };

  // ── Descanso: habilitar temporalmente / editar horario especial ────────────
  const enableBreakTemporarily = async () => {
    if (!breakModal || !breakModal.employeeId || !data.businessId) return;

    const key = toDateKey(breakModal.date);

    const day = resolveDaySchedule(
      data.schedule,
      data.employeeSchedules ?? {},
      data.businessSpecialDates ?? {},
      data.employeeSpecialDates ?? {},
      breakModal.employeeId,
      breakModal.date,
    );

    if (!day) return;

    try {
      const { data: row, error: readError } = await supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", data.businessId)
        .maybeSingle();

      if (readError) throw readError;

      const sched = (row?.schedule ?? {}) as Record<string, any>;

      const empSpecial = (sched._employeeSpecialDates ?? {}) as Record<
        string,
        Record<string, unknown>
      >;

      const forEmp = (empSpecial[breakModal.employeeId] ?? {}) as Record<string, unknown>;

      const nextDay = {
        enabled: day.enabled !== false,
        start: day.start,
        end: day.end,
      };

      const nextSchedule = {
        ...sched,
        _employeeSpecialDates: {
          ...empSpecial,
          [breakModal.employeeId]: {
            ...forEmp,
            [key]: nextDay,
          },
        },
      };

      const { error } = await supabase.from("business_settings").upsert(
        {
          business_id: data.businessId,
          schedule: nextSchedule,
        },
        {
          onConflict: "business_id",
        },
      );

      if (error) throw error;

      setBreakModal(null);
      data.refresh();
    } catch (error) {
      console.error(error);
      toast.error("No se pudo habilitar el descanso. Probá de nuevo.");
    }
  };
  const openSpecialFromBreak = () => {
    if (!breakModal || !breakModal.employeeId) {
      setBreakModal(null);
      return;
    }
    // No se puede editar un día que ya pasó.
    const today = new Date();
    if (toDateKey(breakModal.date) < toDateKey(today)) {
      toast.error("No podés editar un horario que ya pasó.");
      return;
    }
    const day = resolveDaySchedule(
      data.schedule,
      data.employeeSchedules ?? {},
      data.businessSpecialDates ?? {},
      data.employeeSpecialDates ?? {},
      breakModal.employeeId,
      breakModal.date,
    );
    setSpecialEditor({
      employeeId: breakModal.employeeId,
      date: breakModal.date,
      startsAt: breakModal.date,
      available: day?.enabled !== false,
      start: day?.start ?? "11:00",
      end: day?.end ?? "20:00",
      breakStart: day?.breakStart ?? "",
      breakEnd: day?.breakEnd ?? "",
      saving: false,
    });
    setBreakModal(null);
  };
  const openSpecialFromSlot = (employeeId: string | null, date: Date) => {
    setSpecialEditor(buildSpecialEditorState(employeeId, date));
    setSlotMenu(null);
    setNewMenu(false);
  };

  const saveSpecialFromAgenda = async (day: DaySchedule) => {
    if (!specialEditor || !data.businessId) return;
    if (!specialEditor.employeeId) {
      toast.error("Seleccioná un profesional para guardar el horario especial.");
      return;
    }
    setSpecialEditor((s) => (s ? { ...s, saving: true } : s));
    const key = toDateKey(specialEditor.date);
    try {
      const { data: row } = await supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", data.businessId)
        .maybeSingle();
      const sched = (row?.schedule ?? {}) as Record<string, any>;
      const empSpecial = (sched._employeeSpecialDates ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const forEmp = (empSpecial[specialEditor.employeeId] ?? {}) as Record<string, unknown>;
      const next = {
        ...sched,
        _employeeSpecialDates: {
          ...empSpecial,
          [specialEditor.employeeId]: { ...forEmp, [key]: day },
        },
      };
      const { error } = await supabase
        .from("business_settings")
        .upsert({ business_id: data.businessId, schedule: next }, { onConflict: "business_id" });
      if (error) throw error;
      toast.success("Horario especial guardado.");
      setSpecialEditor(null);
      data.refresh();
    } catch {
      toast.error("No se pudo guardar el horario especial. Probá de nuevo.");
      setSpecialEditor((s) => (s ? { ...s, saving: false } : s));
    }
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

    const durationMin = Math.max(
      15,
      Math.round((payload.endsAt.getTime() - payload.startsAt.getTime()) / 60_000),
    );
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
            notes: payload.label
              ? `Horario bloqueado: ${payload.label}`
              : "Horario bloqueado desde Agenda",
            updated_at: new Date().toISOString(),
          })
          .eq("id", payload.appointmentId);
        if (error) throw new Error(error.message);
      } else {
        // Bloqueo NUEVO: no se permite en el pasado (la edición de un bloqueo
        // existente sí, porque payload.appointmentId está presente y entra por
        // la rama de arriba).
        if (isPastSlot(payload.startsAt)) {
          toast.error(PAST_SLOT_MESSAGE);
          return;
        }
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
            notes: payload.label
              ? `Horario bloqueado: ${payload.label}`
              : "Horario bloqueado desde Agenda",
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
    // Turno pasado: solo historial, no editable.
    if (isPastAppointment(a)) {
      toast.error(PAST_APPT_MESSAGE);
      return;
    }
    setEditing(a);
    setDlgDefaults({});
    setActiveDrawer("edit");
  };

  const onChangeStatus = async (a: Appointment, status: ApptStatus) => {
    // Turno pasado: no se cancela; se marca como "No asistió" para conservar historial.
    if (a.status !== "blocked" && isPastAppointment(a) && status !== "no_show") {
      toast.error(PAST_APPT_MESSAGE);
      return;
    }
    // Un turno cobrado es estado final: no se permite ningún cambio de estado.
    if (a.status === "charged" && status !== "charged") {
      toast.error("Este turno ya está cobrado. No se puede cambiar el estado.");
      return;
    }
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
      setSelected((current) => (current && current.id === a.id ? { ...current, status } : current));
      data.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onMarkDeposit = (a: Appointment) => {
    if (isPastAppointment(a)) {
      toast.error(PAST_APPT_MESSAGE);
      return;
    }
    if (a.deposit_status === "paid") {
      toast.info("Este turno ya tiene seña pagada.");
      return;
    }
    const depositAmount = a.deposit_amount ?? calcDeposit(Number(a.service_price ?? 0));
    navigate({
      to: "/cash-register",
      search: {
        depositAppointmentId: a.id,
        depositAmount: String(depositAmount),
        clientName: a.client_name ?? "",
        serviceName: a.service_name ?? "",
        employeeId: a.employee_id ?? "",
      } as never,
    });
  };

  const goToCobro = async (a: Appointment) => {
    // No se cobra retroactivamente: un turno pasado queda como historial.
    if (isPastAppointment(a)) {
      toast.error(PAST_APPT_MESSAGE);
      return;
    }
    if (a.status === "cancelled") {
      toast.error("No se puede cobrar un turno cancelado.");
      return;
    }
    if (a.status === "no_show") {
      toast.error("No se puede cobrar un turno marcado como no asistió.");
      return;
    }
    const depositPaid = Number(a.deposit_paid ?? 0);
    const totalPrice = Number(a.service_price ?? 0);
    const remainder = depositPaid > 0 ? Math.max(0, totalPrice - depositPaid) : totalPrice;
    navigate({
      to: "/cash-register",
      search: {
        appointmentId: a.id,
        finalAmount: String(remainder),
        depositPaid: String(depositPaid),
        totalPrice: String(totalPrice),
        clientName: a.client_name ?? "",
        serviceName: a.service_name ?? "",
        employeeId: a.employee_id ?? "",
      } as never,
    });
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
        await supabase
          .from("appointments")
          .update({
            deposit_status: "returned",
            status: "cancelled",
          })
          .eq("id", a.id);
        toast.success("Seña devuelta y egreso registrado en Caja");
      } catch (e) {
        toast.error((e as Error).message);
        return;
      }
    } else {
      // Keep seña — mark as lost, apply distribution
      try {
        await supabase
          .from("appointments")
          .update({
            deposit_status: "lost",
            status: "cancelled",
          })
          .eq("id", a.id);
        // If prof share > 0, register compensation
        // (senasConfig is loaded at page level)
        toast.success("Seña marcada como perdida");
      } catch (e) {
        toast.error((e as Error).message);
        return;
      }
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
    [
      data.loading,
      data.appointments,
      data.employees,
      data.services,
      data.clients,
      data.schedule,
      data.employeeSchedules,
      data.businessSpecialDates,
      data.employeeSpecialDates,
      data.realtimeStatus,
      data.businessId,
      data.refresh,
    ],
  );
  const daySchedule = React.useMemo(() => {
    // Rango visible derivado de horarios individuales (local como fallback) y
    // expandido solo por turnos reales. Se devuelve como DaySchedule sintético
    // para alimentar HOUR_START/HOUR_END/isClosed del grid.
    const range = getVisibleRange(
      data.schedule,
      data.employeeSchedules ?? {},
      data.businessSpecialDates ?? {},
      data.employeeSpecialDates ?? {},
      data.employees,
      cursor,
      data.appointments,
    );
    if (!range) return null;
    return { enabled: true, start: range.start, end: range.end };
  }, [
    data.schedule,
    data.employeeSchedules,
    data.businessSpecialDates,
    data.employeeSpecialDates,
    data.employees,
    cursor,
    data.appointments,
  ]);

  // Stable handlers passed to the (memoized) DayView grid.
  const handleSlotClick = useStableCallback(openSlotMenu);
  const handleApptClick = useStableCallback(openDetail);
  const handleChangeStatus = useStableCallback(onChangeStatus);
  const handleCobrar = useStableCallback(goToCobro);

  // Stable handlers passed to the (memoized) detail drawer.
  const handleEdit = useStableCallback(openEdit);
  const handleCancel = useStableCallback((a: Appointment) => {
    if (window.confirm("¿Cancelar este turno? No se puede deshacer."))
      onChangeStatus(a, "cancelled");
  });
  const handleFicha = useStableCallback(() => navigate({ to: "/clients" }));
  const handleMarkDeposit = useStableCallback(onMarkDeposit);
  const handleCancelWithDeposit = useStableCallback(onCancelWithDeposit);
  const handleReleaseBlock = useStableCallback(releaseBlock);

  if (authLoading || !session) {
    return (
      <AppShell>
        <div className="grid place-items-center py-32">
          <ClipprLoader size="screen" delayMs={130} />
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
    no_show: data.appointments.filter((a) => a.status === "no_show").length,
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
    <AppShell fullWidth>
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
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition shrink-0 disabled:opacity-40 disabled:hover:text-primary"
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            Hoy
          </button>

          <div className="h-5 w-px bg-white/10 shrink-0" />

          {/* Date navigation — prev/next one day, fecha abre calendario */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => move(-1)}
              aria-label="Día anterior"
              className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              ref={dateBtnRef}
              onClick={openCalendar}
              aria-label="Elegir fecha"
              className="text-sm font-semibold whitespace-nowrap min-w-[205px] text-center rounded-md px-1 py-0.5 hover:bg-white/[0.06] transition"
            >
              {fullDate}
            </button>
            <button
              onClick={() => move(1)}
              aria-label="Día siguiente"
              className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Calendario oscuro — popover para saltar a cualquier fecha */}
          {calOpen && (
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setCalOpen(false)} />
              <div
                className="fixed z-[61]"
                style={{ top: calPos.top, left: calPos.left, transform: "translateX(-50%)" }}
              >
                <DarkCalendar
                  value={cursor}
                  onSelect={(d) => {
                    setCursor(startOfDay(d));
                    setCalOpen(false);
                  }}
                />
              </div>
            </>
          )}

          {data.loading && (
            <span className="grid h-7 w-7 shrink-0 place-items-center">
              <ClipprLoader size="sm" />
            </span>
          )}

          {/* Realtime sync indicator (does not alter layout — sits in the empty gap) */}
          <div
            className="flex items-center gap-1.5 shrink-0 text-[11px] text-muted-foreground select-none"
            title="La agenda se actualiza sola en tiempo real"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                data.realtimeStatus === "connected" && "bg-emerald-400 animate-pulse",
                data.realtimeStatus === "connecting" && "bg-amber-400 animate-pulse",
                data.realtimeStatus === "disconnected" && "bg-rose-400",
              )}
            />
            <span className="hidden sm:inline whitespace-nowrap">
              {data.realtimeStatus === "connected"
                ? "Actualizado en tiempo real"
                : data.realtimeStatus === "connecting"
                  ? "Conectando…"
                  : "Sin conexión"}
            </span>
          </div>

          {/* Status counts (clickable filters) — pushed right */}
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {(
              [
                [
                  "pending",
                  "Por confirmar",
                  "oklch(0.72 0.2 245)",
                  "oklch(0.72 0.2 245 / 0.12)",
                  "oklch(0.72 0.2 245 / 0.3)",
                ],
                [
                  "confirmed",
                  "Confirmados",
                  "#8B5CF6",
                  "rgba(139, 92, 246, 0.14)",
                  "rgba(139, 92, 246, 0.35)",
                ],
                [
                  "charged",
                  "Cobrados",
                  "oklch(0.76 0.2 155)",
                  "oklch(0.76 0.2 155 / 0.12)",
                  "oklch(0.76 0.2 155 / 0.3)",
                ],
                [
                  "cancelled",
                  "Cancelados",
                  "oklch(0.76 0.02 270)",
                  "oklch(0.76 0.02 270 / 0.10)",
                  "oklch(0.76 0.02 270 / 0.25)",
                ],
                [
                  "no_show",
                  "No asistió",
                  "oklch(0.68 0.22 25)",
                  "oklch(0.68 0.22 25 / 0.12)",
                  "oklch(0.68 0.22 25 / 0.30)",
                ],
              ] as [string, string, string, string, string][]
            ).map(([k, label, color, bg, ring]) => (
              <button
                key={k}
                onClick={() => {
                  setFilterModal(k);
                  setActiveDrawer("filter");
                }}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium transition-all hover:brightness-110 shrink-0"
                style={{ background: bg, boxShadow: `0 0 0 1px ${ring}`, color }}
              >
                <span className="font-semibold tabular-nums text-sm">
                  {(counts as Record<string, number>)[k] ?? 0}
                </span>
                <span className="opacity-80">{label}</span>
              </button>
            ))}
          </div>

          <div className="h-5 w-px bg-white/10 shrink-0" />

          <RejectedClientsButton businessId={data.businessId} date={cursor} services={data.services} />

          <div className="h-5 w-px bg-white/10 shrink-0" />

          {/* Nuevo — square button with menu (Agregar turno / Horario especial / Cliente rechazado) */}
          <div className="relative shrink-0">
            <Button
              ref={newBtnRef}
              className="h-7 w-7 p-0"
              aria-label="Nuevo"
              onClick={toggleNewMenu}
            >
              <Plus className="h-4 w-4" />
            </Button>
            {newMenu && (
              <>
                <div className="fixed inset-0 z-[60]" onClick={() => setNewMenu(false)} />
                <div
                  className="fixed z-[61] w-56 glass-strong rounded-xl p-1 animate-fade-up"
                  style={{ top: newMenuPos.top, right: newMenuPos.right }}
                >
                  <button
                    className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-white/[0.06] transition flex items-center gap-2"
                    onClick={() => {
                      setNewMenu(false);
                      openNew(null, cursor);
                    }}
                  >
                    <CalendarIcon className="h-4 w-4 shrink-0 text-primary" /> <span className="whitespace-nowrap">Agregar turno</span>
                  </button>
                  <button
                    className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-white/[0.06] transition flex items-center gap-2"
                    onClick={() => openSpecialFromSlot(null, cursor)}
                  >
                    <Pencil className="h-4 w-4 shrink-0 text-violet-300" /> <span className="whitespace-nowrap">Horario especial</span>
                  </button>
                  <button
                    className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-white/[0.06] transition flex items-center gap-2"
                    onClick={() => {
                      setNewMenu(false);
                      setRejectAt(cursor);
                      setRejectOpen(true);
                    }}
                  >
                    <UserX className="h-4 w-4 shrink-0 text-orange-300" /> <span className="whitespace-nowrap">Cliente rechazado</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Filter modal */}
        {filterModal &&
          (() => {
            const statusMap: Record<string, ApptStatus> = {
              pending: "pending",
              confirmed: "confirmed",
              charged: "charged",
              cancelled: "cancelled",
              no_show: "no_show",
            };
            const labels: Record<string, string> = {
              pending: "Por confirmar",
              confirmed: "Confirmados",
              charged: "Cobrados",
              cancelled: "Cancelados",
              no_show: "No asistió",
            };
            const descriptions: Record<string, string> = {
              pending: "Espera confirmación.",
              confirmed: "Turnos confirmados.",
              charged: "Servicios finalizados y cobrados.",
              cancelled: "Turnos cancelados antes de ser atendidos.",
              no_show: "El cliente tenía turno pero no se presentó.",
            };
            const filtered =
              filterModal === "seña"
                ? data.appointments.filter((a) => /se(ñ|n)a/i.test(a.notes || ""))
                : data.appointments.filter((a) => a.status === statusMap[filterModal]);
            return (
              <AgendaDrawer
                open={activeDrawer === "filter"}
                onOpenChange={(open) => {
                  if (!open) setActiveDrawer(null);
                }}
                lockOutside={false}
                title={`${labels[filterModal] ?? "Turnos"} (${filtered.length})`}
              >
                <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-[12px] text-white/60">
                  {descriptions[filterModal] ?? "Turnos del estado seleccionado."}
                </div>
                <div className="space-y-1">
                  {filtered.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground py-8">
                      Sin turnos en este estado.
                    </div>
                  ) : (
                    filtered.map((a) => {
                      const m = STATUS_META[a.status] ?? STATUS_META.pending;
                      const emp = data.employees.find((e) => e.id === a.employee_id);
                      return (
                        <button
                          key={a.id}
                          onClick={() => openDetail(a)}
                          className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.05] transition"
                        >
                          <div
                            className="h-8 w-8 rounded-full grid place-items-center ring-1 ring-white/10 shrink-0"
                            style={{ background: m.bg }}
                          >
                            <span className="text-[10px] font-bold" style={{ color: m.dot }}>
                              {(a.client_name || "?")[0]?.toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">
                              {a.client_name || "Sin cliente"}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {emp?.full_name ?? emp?.name ?? "—"} · {a.service_name || "—"}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs tabular-nums">
                              {fmtHM(new Date(a.starts_at))}
                            </div>
                            {a.service_price ? (
                              <div className="text-xs text-muted-foreground">
                                ${Number(a.service_price).toLocaleString("es-AR")}
                              </div>
                            ) : null}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </AgendaDrawer>
            );
          })()}

        {/* Modal de captura rápida (desde el menú +) */}
        <RejectedClientCaptureModal
          open={rejectOpen}
          onClose={() => {
            setRejectOpen(false);
            setRejectAt(null);
          }}
          businessId={data.businessId}
          services={data.services}
          employees={data.employees}
          appointments={data.appointments}
          openHoursToday={getScheduleForDate(data.schedule, rejectAt ?? cursor)}
          initialAt={rejectAt ?? cursor}
        />

        {/* Always day view */}
        {data.loading ? (
          <div className="grid min-h-[330px] place-items-center rounded-3xl border border-white/10 bg-white/[0.03]">
            <ClipprLoader size="screen" delayMs={130} />
          </div>
        ) : (
          <DayView
            date={cursor}
            data={memoData}
            schedule={daySchedule}
            enabledBreaks={enabledBreaks}
            onSlotClick={handleSlotClick}
            onApptClick={handleApptClick}
            onChangeStatus={handleChangeStatus}
            onCobrar={handleCobrar}
            onBreakClick={(item) => {
              setBreakModal({
                employeeId: item.employeeId === "__none__" ? null : item.employeeId,
                date: cursor,
                breakStart: minToHHMM(item.startMin),
                breakEnd: minToHHMM(item.endMin),
              });
            }}
          />
        )}

        {slotMenu ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setSlotMenu(null)}
              aria-label="Cerrar opciones de casillero"
            />
            <div
              className="fixed z-50 w-64 overflow-hidden rounded-2xl border border-white/10 bg-background/95 shadow-2xl backdrop-blur-xl"
              style={{
                left: Math.min(slotMenu.x, window.innerWidth - 272),
                top: Math.min(slotMenu.y, window.innerHeight - 150),
              }}
            >
              <div className="border-b border-white/10 px-3 py-2 text-xs text-muted-foreground">
                {slotMenu.startsAt.toLocaleDateString("es-AR", {
                  day: "2-digit",
                  month: "2-digit",
                })}{" "}
                · {fmtTime(slotMenu.startsAt)}
                {slotMenu.restricted && (
                  <div className="mt-0.5 text-[11px] font-medium text-amber-300/90">
                    Profesional no disponible este día
                  </div>
                )}
              </div>
              {!slotMenu.restricted && (
                <>
                  <button
                    type="button"
                    onClick={() => openNew(slotMenu.employeeId, slotMenu.startsAt)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-foreground transition hover:bg-white/[0.06]"
                  >
                    <CalendarIcon className="h-4 w-4 shrink-0 text-primary" />
                    <span className="whitespace-nowrap">Agregar turno</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => openSpecialFromSlot(slotMenu.employeeId, slotMenu.startsAt)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-foreground transition hover:bg-white/[0.06]"
              >
                <Pencil className="h-4 w-4 shrink-0 text-violet-300" />
                <span className="whitespace-nowrap">Horario especial</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRejectAt(slotMenu.startsAt);
                  setSlotMenu(null);
                  setRejectOpen(true);
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-foreground transition hover:bg-white/[0.06]"
              >
                <UserX className="h-4 w-4 shrink-0 text-orange-300" />
                <span className="whitespace-nowrap">Cliente rechazado</span>
              </button>
            </div>
          </>
        ) : null}

        {/* Modal de descanso (Habilitar descanso / Editar horario) */}
        {breakModal ? (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setBreakModal(null)}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-[#15161c] ring-1 ring-white/10 p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">Horario de descanso</div>
                </div>
                <button
                  type="button"
                  aria-label="Cerrar"
                  onClick={() => setBreakModal(null)}
                  className="-mr-1 -mt-1 rounded-full p-2 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  onClick={enableBreakTemporarily}
                  className="w-full rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-4 py-2.5 text-sm"
                >
                  Habilitar descanso
                </button>
                <button
                  onClick={openSpecialFromBreak}
                  className="w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-4 py-2.5 text-sm hover:bg-white/10"
                >
                  Editar horario
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Editor de horario especial para (profesional, fecha) — mismo editor que
          Configuración → Equipo → Horario especial (campos compartidos). */}
        {specialEditor ? (
          <SpecialDayEditor
            date={specialEditor.date}
            value={{
              enabled: specialEditor.available,
              start: specialEditor.start,
              end: specialEditor.end,
              breakStart: specialEditor.breakStart || undefined,
              breakEnd: specialEditor.breakEnd || undefined,
            }}
            allowBreak
            closedLabel="No disponible"
            saving={specialEditor.saving}
            professionals={data.employees}
            selectedEmployeeId={specialEditor.employeeId}
            onSelectEmployee={changeSpecialEmployee}
            onBlock={openBlockFromSpecial}
            onSave={saveSpecialFromAgenda}
            onCancel={() => setSpecialEditor(null)}
          />
        ) : null}

        <AppointmentDetailDialog
          open={activeDrawer === "detail"}
          onOpenChange={(open) => {
            if (!open) setActiveDrawer(null);
          }}
          appointment={selected}
          employees={memoData.employees}
          clients={memoData.clients}
          services={memoData.services}
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
          onOpenChange={(open) => {
            if (!open) setActiveDrawer(null);
          }}
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
          onOpenChange={(open) => {
            if (!open) setActiveDrawer(null);
          }}
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
          employeeSchedules={data.employeeSchedules}
          businessSpecialDates={data.businessSpecialDates}
          employeeSpecialDates={data.employeeSpecialDates}
        />
      )}
    </AppShell>
  );
}

type ApptLayout = { lane: number; laneCount: number };

// Drag & drop tuning + helpers (shared by the grid and cards).
// NOTE: drag snapping is NOT a fixed value anymore. It follows the live
// `slotMinutes` selector (20/30/40/45/50/60) via `snapToSlot` inside the grid
// component, anchored to HOUR_START so drops land exactly on the visible cuts.
const fmtHM = (d: Date) =>
  d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
// Tracks the appointment currently being dragged so onDragOver (which cannot
// read dataTransfer for security reasons) knows its duration for the preview.
const draggedApptRef: { current: Appointment | null } = { current: null };
const draggedBreakRef: {
  current: { employeeId: string; startMin: number; endMin: number } | null;
} = { current: null };

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

// Devuelve el rango de descanso del día en minutos, o null si no hay descanso
// válido configurado (o el día está deshabilitado).
function breakRangeMin(
  day: { enabled?: boolean; breakStart?: string; breakEnd?: string } | null | undefined,
): { startMin: number; endMin: number } | null {
  if (!day || day.enabled === false || !day.breakStart || !day.breakEnd) return null;
  const startMin = Math.round(parseScheduleTime(day.breakStart) * 60);
  const endMin = Math.round(parseScheduleTime(day.breakEnd) * 60);
  return endMin > startMin ? { startMin, endMin } : null;
}

// Minutos del día → "HH:MM".
function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
const DayView = React.memo(function DayView({
  date,
  data,
  schedule,
  enabledBreaks,
  onSlotClick,
  onApptClick,
  onChangeStatus,
  onCobrar,
  onBreakClick,
}: {
  date: Date;
  data: ReturnType<typeof useAgendaData>;
  schedule: ReturnType<typeof getScheduleForDate>;
  enabledBreaks: Set<string>;
  onSlotClick: (employeeId: string | null, startsAt: Date, event: React.MouseEvent) => void;
  onApptClick: (a: Appointment) => void;
  onChangeStatus: (a: Appointment, s: ApptStatus) => void;
  onCobrar: (a: Appointment) => void;
  onBreakClick: (item: { employeeId: string; startMin: number; endMin: number }) => void;
}) {
  const [now, setNow] = React.useState(() => new Date());
  const [hoverTime, setHoverTime] = React.useState<{
    top: number;
    label: string;
  } | null>(null);

  React.useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const isClosed = !schedule?.enabled;
  const HOUR_START = schedule ? Math.floor(parseScheduleTime(schedule.start)) : 0;
  const HOUR_END = schedule ? Math.ceil(parseScheduleTime(schedule.end)) : 0;
  const HOURS = !isClosed
    ? Array.from({ length: Math.max(0, HOUR_END - HOUR_START) }, (_, i) => HOUR_START + i)
    : [];

  // El rango operable por columna lo resuelve effectiveWindowFor vía
  // resolveDaySchedule (prioridad de horarios + especiales por fecha).

  const employees = data.employees.length
    ? data.employees
    : [{ id: "__none__", full_name: "Sin asignar" }];

  // ── Alto de fila FIJO. Antes se calculaba para llenar el viewport (achicaba
  //    las filas). Ahora cada bloque mide AGENDA_ROW_PX y, si hay muchas horas,
  //    la grilla scrollea (no se comprime).
  const gridBodyRef = React.useRef<HTMLDivElement>(null);
  // `rowPx` representa 1 hora completa. El selector tipo AgendaPro cambia
  // cada cuánto se dibujan los cortes/casilleros sin deformar la escala de los turnos.
  const rowPx = AGENDA_ROW_PX;
  const [slotMinutes, setSlotMinutes] = React.useState<(typeof AGENDA_SLOT_OPTIONS)[number]>(() => {
    if (typeof window === "undefined") return 60;
    const stored = Number(window.localStorage.getItem(AGENDA_SLOT_STORAGE_KEY));
    return AGENDA_SLOT_OPTIONS.includes(stored as (typeof AGENDA_SLOT_OPTIONS)[number])
      ? (stored as (typeof AGENDA_SLOT_OPTIONS)[number])
      : 60;
  });

  React.useEffect(() => {
    window.localStorage.setItem(AGENDA_SLOT_STORAGE_KEY, String(slotMinutes));
  }, [slotMinutes]);

  // Scroll horizontal de profesionales: detecta si hay más columnas a los
  // lados para mostrar el fade/sombra. Además, con equipos grandes virtualiza
  // columnas: mantiene el mismo ancho real, pero solo renderiza las visibles
  // + un margen. Esto evita la sensación pesada al arrastrar lateralmente con
  // 20, 25 o más profesionales cargados.
  const gridScrollRef = React.useRef<HTMLDivElement>(null);
  const horizontalScrollRafRef = React.useRef<number | null>(null);
  const shouldVirtualizeColumns = employees.length > AGENDA_VIRTUALIZE_AFTER;
  const [scrollEdges, setScrollEdges] = React.useState({ left: false, right: false });
  const [visibleColumnRange, setVisibleColumnRange] = React.useState(() => ({
    start: 0,
    end: Math.min(employees.length, AGENDA_VIRTUALIZE_AFTER + AGENDA_VIRTUAL_OVERSCAN),
  }));

  const updateHorizontalScrollState = React.useCallback(() => {
    const el = gridScrollRef.current;
    if (!el) return;

    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setScrollEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));

    if (!shouldVirtualizeColumns) {
      setVisibleColumnRange((prev) =>
        prev.start === 0 && prev.end === employees.length
          ? prev
          : { start: 0, end: employees.length },
      );
      return;
    }

    const scrollLeftInsideEmployees = Math.max(0, el.scrollLeft - 58);
    const start = Math.max(
      0,
      Math.floor(scrollLeftInsideEmployees / AGENDA_EMPLOYEE_COL_PX) - AGENDA_VIRTUAL_OVERSCAN,
    );
    const end = Math.min(
      employees.length,
      Math.ceil((scrollLeftInsideEmployees + el.clientWidth) / AGENDA_EMPLOYEE_COL_PX) +
        AGENDA_VIRTUAL_OVERSCAN,
    );
    setVisibleColumnRange((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    );
  }, [employees.length, shouldVirtualizeColumns]);

  const onGridScroll = React.useCallback(() => {
    if (horizontalScrollRafRef.current !== null) return;
    horizontalScrollRafRef.current = requestAnimationFrame(() => {
      horizontalScrollRafRef.current = null;
      updateHorizontalScrollState();
    });
  }, [updateHorizontalScrollState]);

  React.useLayoutEffect(() => {
    const raf = requestAnimationFrame(updateHorizontalScrollState);
    window.addEventListener("resize", updateHorizontalScrollState);
    return () => {
      cancelAnimationFrame(raf);
      if (horizontalScrollRafRef.current !== null)
        cancelAnimationFrame(horizontalScrollRafRef.current);
      horizontalScrollRafRef.current = null;
      window.removeEventListener("resize", updateHorizontalScrollState);
    };
  }, [employees.length, rowPx, updateHorizontalScrollState]);

  // Drag preview ghost (target time range while dragging). Lightweight: only
  // stored in state, no Supabase calls, no grid recompute.
  const [dragPreview, setDragPreview] = React.useState<{
    empId: string;
    top: number;
    height: number;
    label: string;
  } | null>(null);
  React.useEffect(() => {
    const clear = () => {
      draggedApptRef.current = null;
      draggedBreakRef.current = null;
      setDragPreview(null);
    };
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);
  const persistMovedBreak = async (args: {
    employeeId: string;
    startMin: number;
    endMin: number;
  }) => {
    if (!data.businessId) {
      toast.error("No se encontró el negocio.");
      return;
    }

    const targetEmpId = args.employeeId === "__none__" ? null : args.employeeId;
    if (!targetEmpId) {
      toast.error("Seleccioná un profesional para mover el descanso.");
      return;
    }

    const day = resolveDaySchedule(
      data.schedule,
      data.employeeSchedules ?? {},
      data.businessSpecialDates ?? {},
      data.employeeSpecialDates ?? {},
      targetEmpId,
      date,
    );

    if (!day || !day.enabled) {
      toast.error("El profesional no trabaja este día.");
      return;
    }

    const openMin = Math.round(parseScheduleTime(day.start) * 60);
    const closeMin = Math.round(parseScheduleTime(day.end) * 60);
    if (args.startMin < openMin || args.endMin > closeMin) {
      toast.error("El descanso debe quedar dentro del horario del profesional.");
      return;
    }

    const newStart = new Date(date);
    newStart.setHours(Math.floor(args.startMin / 60), args.startMin % 60, 0, 0);
    if (isPastSlot(newStart)) {
      toast.error("No podés mover un descanso a un horario que ya pasó.");
      return;
    }

    const newEnd = new Date(date);
    newEnd.setHours(Math.floor(args.endMin / 60), args.endMin % 60, 0, 0);

    const conflict = data.appointments.find((o) => {
      if (o.status === "cancelled") return false;
      if (o.employee_id !== targetEmpId) return false;
      const oStart = new Date(o.starts_at);
      const oEnd = getApptEnd(o);
      return oStart < newEnd && oEnd > newStart;
    });

    if (conflict) {
      const t = new Date(conflict.starts_at).toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      toast.error(
        conflict.status === "blocked"
          ? `Horario bloqueado (${t}).`
          : `Profesional ocupado: ya tiene un turno a las ${t}${conflict.client_name ? ` · ${conflict.client_name}` : ""}.`,
      );
      return;
    }

    try {
      const { data: row, error: readError } = await supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", data.businessId)
        .maybeSingle();

      if (readError) throw readError;

      const sched = (row?.schedule ?? {}) as Record<string, any>;
      const empSpecial = (sched._employeeSpecialDates ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const forEmp = (empSpecial[targetEmpId] ?? {}) as Record<string, unknown>;
      const key = toDateKey(date);

      const nextDay: DaySchedule = {
        ...day,
        enabled: day.enabled !== false,
        breakStart: minToHHMM(args.startMin),
        breakEnd: minToHHMM(args.endMin),
      };

      const nextSchedule = {
        ...sched,
        _employeeSpecialDates: {
          ...empSpecial,
          [targetEmpId]: {
            ...forEmp,
            [key]: nextDay,
          },
        },
      };

      const { error } = await supabase.from("business_settings").upsert(
        { business_id: data.businessId, schedule: nextSchedule },
        { onConflict: "business_id" },
      );

      if (error) throw error;

      data.refresh();
      toast.success("Descanso movido");
    } catch (ex) {
      toast.error(`Error al guardar: ${(ex as Error).message}`);
    }
  };

  // Snap a raw minute-of-day to the interval chosen in the slot selector.
  // Anchored to HOUR_START (the same anchor the grid lines use) so the result
  // always lands on a visible cut — this matters for 40/45/50, which don't
  // divide 60. For 20/30/60 it's identical to a midnight-anchored snap.
  const snapToSlot = React.useCallback(
    (rawMin: number) => {
      const base = HOUR_START * 60;
      return base + Math.round((rawMin - base) / slotMinutes) * slotMinutes;
    },
    [HOUR_START, slotMinutes],
  );

  // Drop is handled at the COLUMN level (not per hour-cell) so it works whether
  // you release over an empty slot or on top of another card. The minute is
  // derived from the cursor's Y within the column, snapped to the active
  // `slotMinutes` selector via snapToSlot.
  const handleDrop = async (e: React.DragEvent, empId: string) => {
    e.preventDefault();
    setDragPreview(null);

    const breakDrag = draggedBreakRef.current;
    const droppedEmpId = empId === "__none__" ? null : empId;
    if (breakDrag) {
      draggedBreakRef.current = null;
      draggedApptRef.current = null;

      if (!droppedEmpId || droppedEmpId !== breakDrag.employeeId) {
        toast.error("El descanso solo se puede mover dentro del mismo profesional.");
        return;
      }

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = e.clientY - rect.top;
      const rawMin = HOUR_START * 60 + (rowPx > 0 ? (y / rowPx) * 60 : 0);
      const dur = breakDrag.endMin - breakDrag.startMin;
      const { openMin, closeMin } = effectiveWindowFor(empId);
      const maxStart = closeMin - dur;
      const snappedMin = Math.max(
        openMin,
        Math.min(maxStart, snapToSlot(rawMin)),
      );

      await persistMovedBreak({
        employeeId: breakDrag.employeeId,
        startMin: snappedMin,
        endMin: snappedMin + dur,
      });
      return;
    }

    const apptId = e.dataTransfer.getData("apptId") || draggedApptRef.current?.id || "";
    draggedApptRef.current = null;
    if (!apptId) return;
    const appt = data.appointments.find((a) => a.id === apptId);
    if (!appt) return;
    // Un turno pasado es historial: no se puede mover/reprogramar.
    if (appt.status !== "blocked" && isPastAppointment(appt)) {
      toast.error(PAST_APPT_MESSAGE);
      return;
    }
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
      Math.min(maxStart, snapToSlot(rawMin)),
    );

    const newStart = new Date(date);
    newStart.setHours(Math.floor(snappedMin / 60), snappedMin % 60, 0, 0);
    const newEnd = new Date(newStart.getTime() + dur * 60000);
    const targetEmpId = empId === "__none__" ? null : empId;

    // No se puede reprogramar hacia el pasado.
    if (isPastSlot(newStart)) {
      toast.error(PAST_SLOT_MESSAGE);
      return;
    }

    // 1) Horario disponible del profesional destino (prioridad de horarios).
    const dropDay = resolveDaySchedule(
      data.schedule,
      data.employeeSchedules ?? {},
      data.businessSpecialDates ?? {},
      data.employeeSpecialDates ?? {},
      targetEmpId,
      newStart,
    );
    const schedErr = checkDaySchedule(dropDay, newStart, dur);
    if (schedErr) {
      toast.error(schedErr);
      return;
    }

    // 2) Real-range overlap against the SAME in-memory data the grid shows, in
    //    the SAME column. Consistent by construction: if the slot looks free,
    //    the move is allowed. Touching endpoints (11:30 end vs 11:30 start) are OK.
    const conflict = data.appointments.find((o) => {
      if (o.id === apptId) return false; // never compare against itself
      if (o.status === "cancelled") return false; // cancelled don't occupy
      const sameColumn = targetEmpId ? o.employee_id === targetEmpId : !o.employee_id;
      if (!sameColumn) return false;
      const oStart = new Date(o.starts_at);
      const oEnd = getApptEnd(o);
      return oStart < newEnd && oEnd > newStart;
    });
    if (conflict) {
      const t = new Date(conflict.starts_at).toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      toast.error(
        conflict.status === "blocked"
          ? `Horario bloqueado (${t}).`
          : `Profesional ocupado: ya tiene un turno a las ${t}${conflict.client_name ? ` · ${conflict.client_name}` : ""}.`,
      );
      return;
    }

    // 3) Persist
    try {
      const { error } = await supabase
        .from("appointments")
        .update({
          starts_at: newStart.toISOString(),
          ends_at: newEnd.toISOString(),
          employee_id: targetEmpId,
        })
        .eq("id", apptId);
      if (error) throw new Error(error.message);
      data.refresh();
      toast.success("Turno movido");
    } catch (ex) {
      toast.error(`Error al guardar: ${(ex as Error).message}`);
    }
  };

  const dayAppts = React.useMemo(
    () =>
      data.appointments.filter((a) => {
        const d = new Date(a.starts_at);
        return (
          d.getFullYear() === date.getFullYear() &&
          d.getMonth() === date.getMonth() &&
          d.getDate() === date.getDate() &&
          a.status !== "cancelled"
        );
      }),
    [data.appointments, date],
  );
  // Precompute each column's appointments + overlap layout once per data/day,
  // so dragging (which only updates dragPreview state) never recomputes this.
  const columnRender = React.useMemo(
    () =>
      employees.map((e) => {
        const columnAppts = dayAppts.filter((a) =>
          e.id === "__none__" ? !a.employee_id : a.employee_id === e.id,
        );
        return { e, columnAppts, layouts: computeOverlapLayouts(columnAppts) };
      }),
    [employees, dayAppts],
  );
  const isToday = startOfDay(now).getTime() === startOfDay(date).getTime();
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const showNowLine = isToday && !isClosed && nowHour >= HOUR_START && nowHour <= HOUR_END;
  const nowLineTop = (nowHour - HOUR_START) * rowPx;
  const timeSlots = React.useMemo(() => {
    const startMin = HOUR_START * 60;
    const endMin = HOUR_END * 60;
    const slots: number[] = [];
    for (let min = startMin; min < endMin; min += slotMinutes) slots.push(min);
    return slots;
  }, [HOUR_START, HOUR_END, slotMinutes]);
  const slotHeightPx = (slotMinutes / 60) * rowPx;

  // Reuse the same snap math as the drop, off the cursor Y within the column.
  const previewFromColumn = (col: HTMLElement, clientY: number, empId: string) => {
    const appt = draggedApptRef.current;
    const br = draggedBreakRef.current;
    if (!appt && !br) return;

    const durMin = br ? br.endMin - br.startMin : Number(appt?.duration_min ?? 30);
    const rect = col.getBoundingClientRect();
    const y = clientY - rect.top;
    const rawMin = HOUR_START * 60 + (rowPx > 0 ? (y / rowPx) * 60 : 0);

    const bounds = br && br.employeeId === empId ? effectiveWindowFor(empId) : null;
    const minStart = bounds ? bounds.openMin : HOUR_START * 60;
    const maxStart = (bounds ? bounds.closeMin : HOUR_END * 60) - durMin;

    const snappedMin = Math.max(
      minStart,
      Math.min(maxStart, snapToSlot(rawMin)),
    );
    const top = (snappedMin / 60 - HOUR_START) * rowPx;
    const height = Math.max((durMin / 60) * rowPx, 18);
    const s = new Date(date);
    s.setHours(Math.floor(snappedMin / 60), snappedMin % 60, 0, 0);
    const label = `${br ? "Descanso · " : ""}${fmtHM(s)} - ${fmtHM(new Date(s.getTime() + durMin * 60000))}`;
    setDragPreview((prev) =>
      prev && prev.empId === empId && prev.top === top && prev.label === label
        ? prev
        : { empId, top, height, label },
    );
  };

  const renderedColumns = shouldVirtualizeColumns
    ? columnRender.slice(visibleColumnRange.start, visibleColumnRange.end)
    : columnRender;
  const leftVirtualSpacer = shouldVirtualizeColumns
    ? visibleColumnRange.start * AGENDA_EMPLOYEE_COL_PX
    : 0;
  const rightVirtualSpacer = shouldVirtualizeColumns
    ? Math.max(0, (employees.length - visibleColumnRange.end) * AGENDA_EMPLOYEE_COL_PX)
    : 0;
  const gridTemplateColumns = shouldVirtualizeColumns
    ? `58px ${leftVirtualSpacer}px repeat(${renderedColumns.length}, ${AGENDA_EMPLOYEE_COL_PX}px) ${rightVirtualSpacer}px`
    : `58px repeat(${employees.length}, minmax(160px,1fr))`;
  const gridWidth = shouldVirtualizeColumns
    ? 58 + employees.length * AGENDA_EMPLOYEE_COL_PX
    : undefined;
  const gridBodyHeight = Math.max(0, HOUR_END - HOUR_START) * rowPx;

  const updateHoverTimeFromColumn = React.useCallback(
    (col: HTMLElement, clientY: number) => {
      if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) return;

      const rect = col.getBoundingClientRect();
      const y = Math.max(0, Math.min(gridBodyHeight, clientY - rect.top));

      const startMin = HOUR_START * 60;
      const endMin = HOUR_END * 60;

      // El hover usa EXACTAMENTE el mismo paso visual que la columna izquierda.
      // Si la agenda está en 50 min, salta 11:00 → 11:50 → 12:40.
      // Si está en 30 min, salta 11:00 → 11:30 → 12:00.
      const slotIndex = Math.max(
        0,
        Math.min(
          Math.max(0, timeSlots.length - 1),
          Math.round(y / Math.max(1, slotHeightPx)),
        ),
      );

      const snappedMin = Math.max(
        startMin,
        Math.min(endMin, startMin + slotIndex * slotMinutes),
      );

      // Misma fórmula de render que usan los slots:
      // índice de slot * alto de slot. Así queda alineado al píxel.
      const top = slotIndex * slotHeightPx;
      const label = minToHHMM(snappedMin);

      setHoverTime((prev) =>
        prev && prev.top === top && prev.label === label ? prev : { top, label },
      );
    },
    [HOUR_START, HOUR_END, slotMinutes, slotHeightPx, gridBodyHeight, timeSlots.length],
  );

  const clearHoverTime = React.useCallback(() => {
    setHoverTime(null);
  }, []);

  // Franjas bloqueadas (fuera de hora) dentro del rango visible, para una
  // ventana laboral [openMin, closeMin]. Hoy todas las columnas usan el horario
  // del negocio; cuando exista horario por profesional, basta pasar acá su
  // ventana efectiva (intersección con la del negocio) por columna.
  const blockedSegmentsFor = React.useCallback(
    (openMin: number, closeMin: number, breaks: { startMin: number; endMin: number }[] = []) => {
      const gridStart = HOUR_START * 60;
      const gridEnd = HOUR_END * 60;
      const segs: { top: number; height: number }[] = [];
      const push = (aMin: number, bMin: number) => {
        const a = Math.max(gridStart, aMin);
        const b = Math.min(gridEnd, bMin);
        if (b > a)
          segs.push({ top: (a / 60 - HOUR_START) * rowPx, height: ((b - a) / 60) * rowPx });
      };
      push(gridStart, openMin); // antes de abrir
      push(closeMin, gridEnd); // después de cerrar
      // Descansos: bloqueados dentro de la ventana operable (recortados a ella
      // para no duplicar las bandas de apertura/cierre).
      for (const br of breaks) {
        push(Math.max(br.startMin, openMin), Math.min(br.endMin, closeMin));
      }
      return segs;
    },
    [HOUR_START, HOUR_END, rowPx],
  );
  // Ventana operable EFECTIVA de una columna: intersección del horario del
  // negocio con el horario individual del profesional (si tiene configurado).
  // Si el profesional no trabaja ese día, la ventana queda vacía → toda la
  // columna bloqueada. Sin horario propio ("__none__" o no configurado) usa el
  // horario del negocio.
  // Ventana operable EFECTIVA de una columna, resolviendo la prioridad de
  // horarios (especial profesional → normal profesional → especial negocio →
  // normal negocio). Devuelve también los descansos a bloquear.
  const effectiveWindowFor = React.useCallback(
    (empId: string) => {
      const breaks: { startMin: number; endMin: number }[] = [];
      const day = resolveDaySchedule(
        data.schedule,
        data.employeeSchedules ?? {},
        data.businessSpecialDates ?? {},
        data.employeeSpecialDates ?? {},
        empId === "__none__" ? null : empId,
        date,
      );
      if (!day || !day.enabled) {
        // No atiende este día (libre / cerrado) → columna entera bloqueada.
        return { openMin: HOUR_START * 60, closeMin: HOUR_START * 60, breaks: [] };
      }
      const br = breakRangeMin(day);
      const breakKey = `${empId}|${toDateKey(date)}`;
      if (br && !enabledBreaks.has(breakKey)) breaks.push(br);
      return {
        openMin: Math.round(parseScheduleTime(day.start) * 60),
        closeMin: Math.round(parseScheduleTime(day.end) * 60),
        breaks,
      };
    },
    [
      data.schedule,
      data.employeeSchedules,
      data.businessSpecialDates,
      data.employeeSpecialDates,
      date,
      HOUR_START,
      enabledBreaks,
    ],
  );

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
    <section className="rounded-2xl p-2 sm:p-3 relative border border-white/10 shadow-[0_18px_60px_-34px_rgba(0,0,0,0.95)]" style={{ background: "#111323" }}>
      <div
        ref={gridScrollRef}
        onScroll={onGridScroll}
        className="overflow-auto agenda-hscroll"
        style={{ maxHeight: AGENDA_HEADER_PX + AGENDA_VISIBLE_ROWS * rowPx }}
      >
        <div className="grid min-w-[860px]" style={{ gridTemplateColumns, width: gridWidth }}>
          <div
            className="sticky left-0 top-0 z-40 bg-[#111323] border-b border-r border-white/10 px-1.5 flex items-center justify-center"
            style={{ height: AGENDA_HEADER_PX }}
          >
            <label
              className="relative flex h-8 w-[50px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-foreground/80 shadow-[0_10px_24px_-18px_rgba(0,0,0,0.9)] hover:bg-white/[0.07] transition"
              title="Escala de horarios"
            >
              <Clock3 className="h-4 w-4 pointer-events-none" />
              <select
                aria-label="Escala de horarios"
                value={slotMinutes}
                onChange={(event) =>
                  setSlotMinutes(Number(event.target.value) as (typeof AGENDA_SLOT_OPTIONS)[number])
                }
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              >
                {AGENDA_SLOT_OPTIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutos
                  </option>
                ))}
              </select>
            </label>
          </div>
          {shouldVirtualizeColumns && <div aria-hidden="true" />}
          {renderedColumns.map(({ e }) => {
            const total = dayAppts.filter((a) => a.employee_id === e.id).length;
            const inSvc = dayAppts.filter(
              (a) =>
                a.employee_id === e.id && (a.status === "completed" || a.status === "confirmed"),
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
                className="sticky top-0 z-20 px-2.5 border-l border-b border-white/10 bg-[#111323] flex items-center gap-2"
                style={{ height: AGENDA_HEADER_PX }}
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
                    style={{
                      background:
                        "linear-gradient(135deg, oklch(0.7 0.22 245), oklch(0.65 0.27 305))",
                    }}
                  >
                    {initials || "?"}
                  </div>
                )}
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="text-[13px] font-semibold truncate leading-none">
                    {e.full_name ?? e.name}
                  </div>
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
          {shouldVirtualizeColumns && <div aria-hidden="true" />}

          <div
            ref={gridBodyRef}
            className="relative sticky left-0 z-30 bg-[#111323] border-r border-white/15 shadow-[2px_0_8px_rgba(0,0,0,0.35)]"
          >
            {timeSlots.map((min) => (
              <div
                key={min}
                className="text-[11px] font-medium text-foreground/70 pr-2.5 pt-1 text-right select-none border-t border-white/[0.04]"
                style={{ height: slotHeightPx }}
              >
                <span>{minToHHMM(min)}</span>
              </div>
            ))}
            {hoverTime && (
              <div
                className="pointer-events-none absolute right-1 z-50 rounded-full border border-violet-300/25 bg-[#111323]/95 px-2 py-0.5 text-[11px] font-bold tabular-nums text-violet-100 shadow-[0_0_24px_rgba(139,92,246,0.24)]"
                style={{ top: hoverTime.top + 4 }}
              >
                {hoverTime.label}
              </div>
            )}
          </div>

          {shouldVirtualizeColumns && <div aria-hidden="true" style={{ height: gridBodyHeight }} />}

          {renderedColumns.map(({ e, columnAppts, layouts }) => {
            // Ventana operable de ESTA columna (horario del profesional, o del
            // local como fallback). Fuera de hora = franja rayada; el descanso
            // se muestra como un bloque "DESCANSO" propio.
            const {
              openMin: colOpenMin,
              closeMin: colCloseMin,
              breaks: colBreaks,
            } = effectiveWindowFor(e.id);
            const oohSegments = blockedSegmentsFor(colOpenMin, colCloseMin);
            const gridStartMin = HOUR_START * 60;
            const gridEndMin = HOUR_END * 60;
            const breakBlocks = colBreaks
              .map((br) => {
                const a = Math.max(br.startMin, gridStartMin, colOpenMin);
                const b = Math.min(br.endMin, gridEndMin, colCloseMin);
                if (b <= a) return null;
                return {
                  top: (a / 60 - HOUR_START) * rowPx,
                  height: ((b - a) / 60) * rowPx,
                  label: `${minToHHMM(br.startMin)} - ${minToHHMM(br.endMin)}`,
                  startMin: br.startMin,
                  endMin: br.endMin,
                };
              })
              .filter(
                (x): x is {
                  top: number;
                  height: number;
                  label: string;
                  startMin: number;
                  endMin: number;
                } => x !== null,
              );
            return (
              <div
                key={e.id}
                className="relative border-l border-white/[0.055] bg-white/[0.006]"
                onMouseMove={(ev) =>
                  updateHoverTimeFromColumn(ev.currentTarget as HTMLElement, ev.clientY)
                }
                onMouseLeave={clearHoverTime}
                onDragOver={(ev) => {
                  ev.preventDefault();
                  ev.dataTransfer.dropEffect = "move";
                  previewFromColumn(ev.currentTarget as HTMLElement, ev.clientY, e.id);
                  updateHoverTimeFromColumn(ev.currentTarget as HTMLElement, ev.clientY);
                }}
                onDrop={(ev) => handleDrop(ev, e.id)}
              >
                {timeSlots.map((min) => {
                  // Una celda queda bloqueada si cae fuera de la ventana efectiva
                  // (negocio o profesional) o si toca un descanso configurado.
                  const cellStart = min;
                  const cellEnd = min + slotMinutes;
                  const cellBlocked =
                    cellEnd <= colOpenMin ||
                    cellStart >= colCloseMin ||
                    colBreaks.some((br) => cellStart < br.endMin && cellEnd > br.startMin);
                  return (
                    <div
                      key={min}
                      className={cn(
                        "border-t border-white/[0.055] bg-white/[0.012] transition-colors",
                        cellBlocked ? "cursor-not-allowed" : "hover:bg-white/[0.035] cursor-pointer",
                      )}
                      style={{ height: slotHeightPx }}
                      onClick={(event) => {
                        const dt = new Date(date);
                        dt.setHours(Math.floor(min / 60), min % 60, 0, 0);
                        onSlotClick(e.id === "__none__" ? null : e.id, dt, event);
                      }}
                    />
                  );
                })}

                {/* Fuera del horario (profesional o local): franja rayada,
                  visible pero no operable. Los turnos previos se pintan encima.
                  pointer-events-none para no romper el drag. */}
                {oohSegments.map((seg, i) => (
                  <div
                    key={`ooh-${i}`}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0"
                    style={{
                      top: seg.top,
                      height: seg.height,
                      background:
                        "repeating-linear-gradient(135deg, rgba(255,255,255,0.010) 0, rgba(255,255,255,0.010) 7px, rgba(255,255,255,0.028) 7px, rgba(255,255,255,0.028) 14px)",
                    }}
                  />
                ))}

                {/* Descanso: bloque real "DESCANSO". Ahora se puede tocar y arrastrar
                    igual que un turno, pero solo dentro del mismo profesional. */}
                {breakBlocks.map((b, i) => (
                  <div
                    key={`break-${i}`}
                    draggable
                    onDragStart={(ev) => {
                      ev.dataTransfer.setData("breakMove", `${e.id}:${b.startMin}:${b.endMin}`);
                      ev.dataTransfer.effectAllowed = "move";
                      draggedBreakRef.current = {
                        employeeId: e.id === "__none__" ? "__none__" : e.id,
                        startMin: b.startMin,
                        endMin: b.endMin,
                      };
                    }}
                    onDragEnd={() => {
                      draggedBreakRef.current = null;
                      setDragPreview(null);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onBreakClick({ employeeId: e.id, startMin: b.startMin, endMin: b.endMin });
                    }}
                    className="absolute inset-x-0.5 z-[1] flex cursor-grab flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md px-1 text-center transition hover:z-10 hover:scale-[1.01] active:cursor-grabbing"
                    style={{
                      top: b.top,
                      height: b.height,
                      border: "1px solid rgba(148,163,184,0.34)",
                      background:
                        "repeating-linear-gradient(135deg, rgba(148,163,184,0.12) 0, rgba(148,163,184,0.12) 8px, rgba(148,163,184,0.22) 8px, rgba(148,163,184,0.22) 16px)",
                    }}
                    title="Arrastrar descanso"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide leading-none text-slate-300/90">
                      Descanso
                    </span>
                    <span className="text-[10px] tabular-nums leading-none text-slate-400/85">
                      {b.label}
                    </span>
                  </div>
                ))}

                {showNowLine && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-20 border-t border-red-400/90 shadow-[0_0_10px_rgba(248,113,113,0.75)]"
                    style={{ top: nowLineTop }}
                  >
                    <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.9)]" />
                  </div>
                )}

                {hoverTime && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 z-[19] border-t border-violet-300/25"
                    style={{ top: hoverTime.top }}
                  />
                )}

                {/* Drag preview ghost — target time range before dropping */}
                {dragPreview && dragPreview.empId === e.id && (
                  <div
                    className="pointer-events-none absolute left-1 right-1 z-30 rounded-lg border-2 border-dashed border-primary/70 bg-primary/10 backdrop-blur-[1px] px-2 py-0.5 overflow-hidden"
                    style={{ top: dragPreview.top, height: dragPreview.height }}
                  >
                    <span className="text-[10px] font-bold tabular-nums text-primary leading-none">
                      {dragPreview.label}
                    </span>
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
                    employeeCount={employees.length}
                    services={data.services}
                    onClick={() => onApptClick(a)}
                    onChangeStatus={(s) => onChangeStatus(a, s)}
                    onCobrar={() => onCobrar(a)}
                  />
                ))}
              </div>
            );
          })}

          {shouldVirtualizeColumns && <div aria-hidden="true" style={{ height: gridBodyHeight }} />}
        </div>
      </div>

      {/* Navegación horizontal premium: flechas flotantes que solo aparecen si
          hay overflow real, y se ocultan en cada extremo. */}
      {scrollEdges.left && (
        <button
          type="button"
          aria-label="Profesionales anteriores"
          onClick={() => gridScrollRef.current?.scrollBy({ left: -600, behavior: "smooth" })}
          className="absolute left-[62px] top-1/2 -translate-y-1/2 z-40 h-9 w-9 rounded-full grid place-items-center text-white/85 ring-1 ring-white/15 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)] backdrop-blur-md hover:text-white hover:ring-white/30 transition"
          style={{ background: "oklch(0.18 0.03 285 / 0.92)" }}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {scrollEdges.right && (
        <>
          <div
            className="pointer-events-none absolute top-0 bottom-0 right-0 w-14 z-30 rounded-r-2xl"
            style={{ background: "linear-gradient(to right, transparent, var(--background) 92%)" }}
          />
          <button
            type="button"
            aria-label="Más profesionales"
            onClick={() => gridScrollRef.current?.scrollBy({ left: 600, behavior: "smooth" })}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 z-40 h-9 w-9 rounded-full grid place-items-center text-white/85 ring-1 ring-white/15 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)] backdrop-blur-md hover:text-white hover:ring-white/30 transition"
            style={{ background: "oklch(0.18 0.03 285 / 0.92)" }}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
    </section>
  );
});

function getServiceImageByName(
  serviceName: string | null | undefined,
  services: ReturnType<typeof useAgendaData>["services"],
): string | null {
  const name = serviceName?.trim();
  if (!name) return null;

  const segments = name
    .split("+")
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);

  for (const segment of segments) {
    const match = services.find((service) => service.name.trim().toLowerCase() === segment);
    if (match?.image_url) return match.image_url;
  }

  const loose = services.find((service) =>
    name.toLowerCase().includes(service.name.trim().toLowerCase()),
  );

  return loose?.image_url ?? null;
}

function getServiceImagePositionByName(
  serviceName: string | null | undefined,
  services: ReturnType<typeof useAgendaData>["services"],
): string {
  const name = serviceName?.trim();
  if (!name) return "50% 50%";

  const segments = name
    .split("+")
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);

  for (const segment of segments) {
    const match = services.find((service) => service.name.trim().toLowerCase() === segment);
    if (match?.image_url) return match.image_position ?? "50% 50%";
  }

  const loose = services.find((service) =>
    name.toLowerCase().includes(service.name.trim().toLowerCase()),
  );

  return loose?.image_position ?? "50% 50%";
}

const ApptCard = React.memo(function ApptCard({
  a,
  onClick,
  onChangeStatus,
  onCobrar,
  layout,
  hourStart,
  hourEnd,
  rowPx,
  employeeCount,
  services,
}: {
  a: Appointment;
  onClick: () => void;
  onChangeStatus: (s: ApptStatus) => void;
  onCobrar: () => void;
  layout?: ApptLayout;
  hourStart: number;
  hourEnd: number;
  rowPx: number;
  employeeCount: number;
  services: ReturnType<typeof useAgendaData>["services"];
}) {
  const start = new Date(a.starts_at);
  const end = getApptEnd(a);
  // Nombre del cliente: con hasta 8 profesionales visibles hay ancho de sobra,
  // se muestra completo. Con más de 8, se compacta a nombre + inicial.
  const clientDisplay = (() => {
    const parts = (a.client_name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "Sin nombre";
    if (parts.length === 1) return parts[0];
    if (employeeCount <= 8) return parts.join(" ");
    return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
  })();
  const startH = start.getHours() + start.getMinutes() / 60;
  const dur = Math.max(0.5, Number(a.duration_min ?? 30) / 60);
  // Gap vertical mínimo (1px arriba + 1px abajo): turnos consecutivos quedan
  // pegados sin montarse, y se gana alto útil para el servicio.
  const top = (startH - hourStart) * rowPx + 1;
  const height = Math.max(18, dur * rowPx - 2);
  if (top < 0 || top > (hourEnd - hourStart) * rowPx) return null;
  const meta = STATUS_META[a.status] ?? STATUS_META.pending;
  const isMovable = a.status !== "charged" && a.status !== "no_show";
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
        "absolute rounded-[6px] px-1.5 py-0.5 group transition hover:z-10 hover:scale-[1.01] overflow-hidden",
        isMovable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
      )}
      style={{
        top,
        height,
        left,
        width,
        background: meta.bg,
        boxShadow: `inset 0 0 0 1px ${meta.border}`,
      }}
      draggable={isMovable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {/* Línea 1: horario (lo más importante) + cliente */}
      <div className="flex items-center gap-1 min-w-0 leading-none">
        <span
          className="text-[11px] font-bold tabular-nums shrink-0 leading-none"
          style={{ color: meta.dot }}
        >
          {fmtHM(start)} • {fmtHM(end)}
        </span>
        <span className="text-[10px] opacity-40 shrink-0 leading-none">·</span>
        <span className="text-[12px] font-semibold truncate flex-1 min-w-0 leading-none">
          {clientDisplay}
        </span>
      </div>
      {/* Línea 2: servicio + producto online — pegado al horario, legible y sin cortarse */}
      {a.service_name && (
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 leading-none">
          <span className="truncate text-[11px] text-foreground/85">
            {a.service_name}
          </span>
          {appointmentProductsFromNotes(a.notes).length > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1 py-px text-[9px] font-semibold leading-none text-amber-300">
              <span aria-hidden>⭐</span>
              <span>Producto</span>
            </span>
          )}
        </div>
      )}
      {/se(ñ|n)a/i.test(a.notes || "") && (
        <div
          className="text-[8px] font-semibold mt-px px-1 rounded w-fit"
          style={{ background: "oklch(0.42 0.18 75 / 0.5)", color: "oklch(0.88 0.2 75)" }}
        >
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
  const [label, setLabel] = React.useState(
    appointment?.client_name === "Horario bloqueado" ? "" : (appointment?.client_name ?? ""),
  );
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
    setLabel(
      appointment?.client_name === "Horario bloqueado" ? "" : (appointment?.client_name ?? ""),
    );
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

  const inputClass =
    "h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm outline-none focus:border-primary/50";
  const selectClass =
    "h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm outline-none focus:border-primary/50";

  return (
    <AgendaDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={appointment ? "Editar bloqueo de horas" : "Bloqueo de horas"}
      footer={
        <>
          <Button variant="secondary" className="h-9" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="h-9"
            onClick={() =>
              onSave({
                appointmentId: appointment?.id,
                employeeId: employeeId || null,
                startsAt: combineLocalDateTime(startDate, startHour, startMinute),
                endsAt: combineLocalDateTime(endDate, endHour, endMinute),
                label: label.trim(),
                repeatEnabled,
                repeatEvery: Number(repeatEvery || 1),
                repeatCount: Number(repeatCount || 1),
              })
            }
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
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={`${selectClass} mt-2 w-full`}
            >
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
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={`${inputClass} mt-2 w-full`}
              />
            </label>
            <label className="block text-sm font-semibold">
              Hora
              <select
                value={startHour}
                onChange={(e) => setStartHour(e.target.value)}
                className={`${selectClass} mt-2 w-full`}
              >
                {hours.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              &nbsp;
              <select
                value={startMinute}
                onChange={(e) => setStartMinute(e.target.value)}
                className={`${selectClass} mt-2 w-full`}
              >
                {minutes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
            <label className="block text-sm font-semibold">
              Fecha de fin
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={`${inputClass} mt-2 w-full`}
              />
            </label>
            <label className="block text-sm font-semibold">
              Hora
              <select
                value={endHour}
                onChange={(e) => setEndHour(e.target.value)}
                className={`${selectClass} mt-2 w-full`}
              >
                {hours.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              &nbsp;
              <select
                value={endMinute}
                onChange={(e) => setEndMinute(e.target.value)}
                className={`${selectClass} mt-2 w-full`}
              >
                {minutes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {!appointment && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
            <label className="flex items-center gap-3 text-sm font-semibold">
              <input
                type="checkbox"
                checked={repeatEnabled}
                onChange={(e) => setRepeatEnabled(e.target.checked)}
              />
              Repetir bloqueo
            </label>
            {repeatEnabled && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-semibold">
                  Cada
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      value={repeatEvery}
                      onChange={(e) => setRepeatEvery(e.target.value)}
                      className={`${inputClass} w-20`}
                    />
                    <span className="text-sm text-muted-foreground">día(s)</span>
                  </div>
                </label>
                <label className="block text-sm font-semibold">
                  Finaliza después de
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      value={repeatCount}
                      onChange={(e) => setRepeatCount(e.target.value)}
                      className={`${inputClass} w-24`}
                    />
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

/**
 * Show only what the client actually wrote in the notes field. Online bookings
 * pack extra metadata into `notes` (e.g. "Notas del cliente: X  Email: ...  Origen:
 * reserva online"); the email/origin are NOT notes and are shown elsewhere, so we
 * strip them here and keep just the client's text.
 */
type AppointmentProduct = {
  name: string;
  priceLabel?: string;
  image?: string;
};

function appointmentProductsFromNotes(raw?: string | null): AppointmentProduct[] {
  if (!raw) return [];

  const match = raw.match(/Productos agregados:\s*([\s\S]*?)(?:\n\s*\n|$)/i);
  const block = match?.[1]?.trim();
  if (!block) return [];

  return block
    .split(/\n+/)
    .map((line) => line.trim().replace(/^[-•]\s*/, ""))
    .filter(Boolean)
    .map((line) => {
      const imageMatch = line.match(/\s*\[img:([^\]]+)\]\s*$/);
      const cleanLine = imageMatch ? line.replace(/\s*\[img:[^\]]+\]\s*$/, "").trim() : line;
      const parsed = cleanLine.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      return parsed
        ? { name: parsed[1].trim(), priceLabel: parsed[2].trim(), image: imageMatch?.[1]?.trim() }
        : { name: cleanLine.trim(), image: imageMatch?.[1]?.trim() };
    })
    .filter((product) => product.name.length > 0);
}

function clientNoteOnly(raw?: string | null): string {
  if (!raw) return "";
  let s = raw;
  const m = s.match(/Notas del cliente:\s*([\s\S]*)/i);
  if (m) s = m[1];
  // Cut at the first booking-metadata marker.
  s = s.split(/\s*(?:Productos agregados|Email|Origen|Tel[eé]fono)\s*:/i)[0];
  return s.trim();
}

/** Add an alpha channel to an oklch(...) color string. */
function withAlpha(color: string, a: number): string {
  return color.replace(/\)\s*$/, ` / ${a})`);
}

const AppointmentDetailDialog = React.memo(function AppointmentDetailDialog({
  open,
  onOpenChange,
  appointment,
  employees,
  clients,
  services,
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
  services: ReturnType<typeof useAgendaData>["services"];
  onEdit: (a: Appointment) => void;
  onCancel: (a: Appointment) => void;
  onCobrar: (a: Appointment) => void;
  onFicha: (a: Appointment) => void;
  onChangeStatus: (a: Appointment, s: ApptStatus) => void;
  onMarkDeposit: (a: Appointment) => void;
  onCancelWithDeposit: (a: Appointment, action: "keep" | "return") => void;
  onReleaseBlock: (a: Appointment) => void;
}) {
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const apptId = appointment?.id;
  React.useEffect(() => {
    setConfirmCancel(false);
  }, [apptId]);
  if (!appointment) return null;

  const employee = employees.find((e) => e.id === appointment.employee_id);
  const client = clients.find((c) => c.id === appointment.client_id);
  // El turno guarda service_name como texto libre (puede combinar varios
  // servicios con " + "), no hay FK a price_catalog. Resolvemos la imagen
  // buscando el primer servicio del catálogo cuyo nombre matchee alguno de
  // los segmentos del texto guardado.
  const serviceImageUrl = getServiceImageByName(appointment.service_name, services);
  const serviceImagePosition = getServiceImagePositionByName(appointment.service_name, services);
  const start = new Date(appointment.starts_at);
  const end = appointment.ends_at
    ? new Date(appointment.ends_at)
    : new Date(start.getTime() + Number(appointment.duration_min ?? 30) * 60_000);
  const phone = client?.phone ?? null;
  const email = client?.email ?? null;
  const meta = STATUS_META[appointment.status] ?? STATUS_META.pending;
  const requiresDeposit = Boolean(
    appointment.deposit_status && appointment.deposit_status !== "none",
  );
  const dateText = `${start.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "")} · ${fmtTime(start)} a ${fmtTime(end)}`;
  const statusLabel =
    appointment.status === "charged"
      ? "Cobrado"
      : appointment.status === "confirmed"
        ? "Confirmado"
        : appointment.status === "cancelled"
          ? "Cancelado"
          : appointment.status === "no_show"
            ? "No asistió"
          : appointment.status === "in_service"
            ? "En servicio"
            : "Por confirmar";
  const cleanPhone = phone ? phone.replace(/\D/g, "") : "";
  const whatsappHref = cleanPhone ? `https://wa.me/${cleanPhone}` : undefined;
  const noteText = clientNoteOnly(appointment.notes);
  const appointmentProducts = appointmentProductsFromNotes(appointment.notes);
  const productsSubtotal = appointmentProducts.reduce((sum, product) => {
    const amount = Number(String(product.priceLabel ?? "").replace(/[^0-9,-]/g, "").replace(",", "."));
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
  const serviceTotal = Number(appointment.service_price ?? 0);
  const appointmentTotal = serviceTotal + productsSubtotal;
  // Turno pasado (no bloqueo): solo lectura. Se ocultan todas las acciones.
  const isPast = appointment.status !== "blocked" && isPastAppointment(appointment);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        forceMount
        side="right"
        hideOverlay
        hideClose
        className="w-full sm:max-w-[372px] p-0 overflow-y-auto border-white/10 bg-[#08070f] shadow-[0_24px_80px_-24px_rgba(0,0,0,0.85)] data-[state=open]:duration-100 data-[state=closed]:duration-100 data-[state=closed]:hidden"
        aria-describedby={undefined}
      >
        <SheetHeader className="relative px-4 pt-4 pb-3 border-b border-white/10 bg-white/[0.025] text-left space-y-0">
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => onOpenChange(false)}
            className="absolute right-3 top-3.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full text-white/55 hover:text-white hover:bg-white/[0.08] transition"
          >
            <X className="h-4 w-4" />
          </button>
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-40 w-72 -translate-x-1/2 rounded-full opacity-35 blur-3xl"
            style={{ background: meta.dot }}
          />
          <div
            className="pointer-events-none absolute -top-10 left-4 h-24 w-32 rounded-full opacity-20 blur-2xl"
            style={{ background: meta.dot }}
          />
          <div className="relative space-y-3">
            <div className="flex min-w-0 items-start pr-8">
              <div className="min-w-0 flex-1 pt-0.5">
                <SheetTitle className="text-[26px] leading-tight font-display font-semibold tracking-tight truncate">
                  {appointment.status === "blocked"
                    ? "Horario bloqueado"
                    : appointment.client_name || "Sin cliente"}
                </SheetTitle>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pr-8">
              <div
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em]"
                style={{
                  color: meta.dot,
                  background: withAlpha(meta.dot, 0.13),
                  border: `1px solid ${withAlpha(meta.dot, 0.36)}`,
                  boxShadow: `0 0 18px ${withAlpha(meta.dot, 0.18)}, inset 0 0 0 1px rgba(255,255,255,0.04)`,
                }}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: meta.dot, boxShadow: `0 0 12px ${meta.dot}` }}
                />
                {statusLabel}
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 rounded-full border-white/10 bg-white/[0.06] px-2.5 text-xs hover:bg-white/[0.1]"
                  onClick={() => onFicha(appointment)}
                >
                  <UserRound className="h-3.5 w-3.5 mr-1" /> Ficha
                </Button>
                {!isPast && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 rounded-full border-white/10 bg-white/[0.06] px-2.5 text-xs hover:bg-white/[0.1]"
                    onClick={() => onEdit(appointment)}
                  >
                    Editar
                  </Button>
                )}
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-3 p-4 pt-5">
          <div
            className="rounded-2xl border p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
            style={{
              background: meta.bg,
              borderColor: meta.border,
              boxShadow: `0 0 0 1px ${meta.border}, 0 18px 34px -28px ${meta.dot}, inset 0 1px 0 rgba(255,255,255,0.06)`,
            }}
          >
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div
                  className="grid h-14 w-14 shrink-0 place-items-center rounded-xl overflow-hidden"
                  style={{ boxShadow: `0 0 0 1px ${meta.border}, 0 10px 22px -18px ${meta.dot}` }}
                >
                  <ServiceImage
                    src={serviceImageUrl}
                    alt={appointment.service_name || "Servicio"}
                    position={serviceImagePosition}
                    className="h-full w-full rounded-xl"
                    fallback={<Scissors className="h-4 w-4 shrink-0" style={{ color: meta.dot }} />}
                  />
                </div>

                {appointment.service_price ? (
                  <div className="shrink-0 text-right text-xl font-display font-semibold tracking-tight">
                    ${Number(appointment.service_price).toLocaleString("es-AR")}
                  </div>
                ) : null}
              </div>

              <div className="text-base font-semibold leading-snug text-white/95 break-words">
                {appointment.service_name || "Servicio"}
              </div>

              <div className="flex min-w-0 items-center gap-4 text-sm">
                <div className="flex items-center gap-2 text-white/72">
                  <Clock3 className="h-4 w-4 shrink-0 text-white/38" />
                  <span className="tabular-nums">{fmtTime(start)} – {fmtTime(end)}</span>
                </div>
                <div className="flex min-w-0 items-center gap-2 text-white/60">
                  <UserRound className="h-4 w-4 shrink-0 text-white/35" />
                  <span className="truncate">{employee?.full_name ?? employee?.name ?? "Sin asignar"}</span>
                </div>
              </div>
            </div>

            {appointment.deposit_status &&
              appointment.deposit_status !== "none" &&
              (() => {
                const ds = appointment.deposit_status;
                const depositAmt = Number(appointment.deposit_amount ?? 0);
                const depositPaid = Number(appointment.deposit_paid ?? 0);
                const total = Number(appointment.service_price ?? 0);
                const remaining = Math.max(0, total - depositPaid);
                const statusMap: Record<string, { icon: string; label: string; color: string }> = {
                  pending: { icon: "🟡", label: "Seña pendiente", color: "text-amber-300" },
                  paid: { icon: "🟢", label: "Seña pagada", color: "text-emerald-300" },
                  lost: { icon: "🔴", label: "Seña perdida", color: "text-rose-300" },
                  returned: { icon: "🔵", label: "Seña devuelta", color: "text-sky-300" },
                };
                const dsInfo = statusMap[ds] ?? statusMap.pending;
                return (
                  <div className="mt-3 pt-3 border-t border-white/10 text-sm">
                    <div className={`font-semibold ${dsInfo.color}`}>
                      {dsInfo.icon} {dsInfo.label}
                    </div>
                    {depositAmt > 0 && (
                      <div className="mt-1 text-muted-foreground">
                        Seña requerida:{" "}
                        <span className="text-foreground font-medium">
                          ${depositAmt.toLocaleString("es-AR")}
                        </span>
                      </div>
                    )}
                    {ds === "paid" && depositPaid > 0 && (
                      <div className="mt-1 text-muted-foreground">
                        Por confirmar de cobro:{" "}
                        <span className="text-foreground font-medium">
                          ${remaining.toLocaleString("es-AR")}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
          </div>

          {appointmentProducts.length > 0 && (
            <div
              className="rounded-2xl border p-3.5"
              style={{
                background: "rgba(251, 191, 36, 0.095)",
                borderColor: "rgba(251, 191, 36, 0.58)",
                boxShadow:
                  "0 0 0 1px rgba(251,191,36,0.34), 0 18px 34px -28px rgba(251,191,36,0.95), inset 0 1px 0 rgba(255,255,255,0.07)",
              }}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">
                  Productos agregados
                </div>
                <span
                  className="h-1.5 w-1.5 rounded-full bg-amber-300"
                  style={{ boxShadow: "0 0 14px rgba(251,191,36,0.95)" }}
                  aria-hidden
                />
              </div>

              <div className="space-y-2">
                {appointmentProducts.map((product, index) => (
                  <div
                    key={`${product.name}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5"
                    style={{
                      background: "rgba(251, 191, 36, 0.055)",
                      borderColor: "rgba(251, 191, 36, 0.34)",
                      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.035)",
                    }}
                  >
                    {product.image ? (
                      <ServiceImage
                        src={product.image}
                        alt={product.name}
                        className="h-10 w-10 rounded-xl ring-1 ring-amber-300/40"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white/90">{product.name}</div>
                    </div>
                    {product.priceLabel && (
                      <div className="shrink-0 text-sm font-semibold text-amber-100">
                        {product.priceLabel}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {appointmentProducts.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3.5 text-sm">
              <div className="flex items-center justify-between text-base font-semibold text-white">
                <span>Total del turno</span>
                <span className="text-white">${appointmentTotal.toLocaleString("es-AR")}</span>
              </div>
            </div>
          )}

          {appointment.status === "blocked" ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" className="h-9" onClick={() => onEdit(appointment)}>
                Editar bloqueo
              </Button>
              <Button
                variant="destructive"
                className="h-9"
                onClick={() => onReleaseBlock(appointment)}
              >
                Liberar horario
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {isPast && appointment.status !== "cancelled" && appointment.status !== "no_show" && (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-[12px] text-white/55">
                  Este turno ya pasó. Podés marcarlo como no asistió.
                </div>
              )}

              <div className="space-y-2 pt-1">
                <div className="px-1 text-[10px] uppercase tracking-[0.18em] text-white/35">
                  Acciones
                </div>

                {/* Confirmar turno: solo si está por confirmar */}
                {!isPast &&
                  appointment.status === "pending" &&
                  (() => {
                    const dot = STATUS_META.confirmed.dot;
                    return (
                      <button
                        onClick={() => onChangeStatus(appointment, "confirmed")}
                        className="w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition hover:brightness-110 active:scale-[0.99]"
                        style={{
                          background: "rgba(139, 92, 246, 0.16)",
                          color: "#A78BFA",
                          boxShadow:
                            "inset 0 0 0 1px rgba(139, 92, 246, 0.42), 0 12px 26px -22px rgba(139, 92, 246, 0.8)",
                        }}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Confirmar turno
                      </button>
                    );
                  })()}

                {/* CTA principal: Cobrar */}
                {!isPast &&
                  appointment.status !== "charged" &&
                  appointment.status !== "cancelled" &&
                  appointment.status !== "no_show" &&
                  (() => {
                    return (
                      <button
                        onClick={() => onCobrar(appointment)}
                        className="w-full h-12 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition hover:brightness-110 active:scale-[0.99]"
                        style={{
                          background:
                            "linear-gradient(135deg, rgba(16,185,129,.95), rgba(34,197,94,.72))",
                          color: "white",
                          boxShadow:
                            "0 16px 34px -22px rgba(34,197,94,.95), inset 0 0 0 1px rgba(255,255,255,.16)",
                        }}
                      >
                        <DollarSign className="h-4 w-4" />
                        Cobrar turno
                      </button>
                    );
                  })()}

                {/* Cobrar seña (si aplica) */}
                {!isPast &&
                  requiresDeposit &&
                  appointment.status !== "charged" &&
                  appointment.deposit_status !== "paid" &&
                  appointment.deposit_status !== "lost" && (
                    <Button
                      variant="secondary"
                      onClick={() => onMarkDeposit(appointment)}
                      className="w-full h-10 border-amber-300/25 bg-amber-300/10 text-amber-200 hover:bg-amber-300/15"
                    >
                      <DollarSign className="h-4 w-4 mr-1" /> Cobrar seña
                    </Button>
                  )}

                {/* Cancelar / No asistió como acción secundaria */}
                {(() => {
                  const isNoShowAction = isPast && appointment.status !== "cancelled";
                  const statusKey = isNoShowAction ? "no_show" : "cancelled";
                  const dot = STATUS_META[statusKey].dot;
                  const cancelled = appointment.status === "cancelled";
                  const noShow = appointment.status === "no_show";

                  if (cancelled || noShow) {
                    return (
                      <div
                        className="w-full h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
                        style={{
                          background: withAlpha(dot, 0.12),
                          color: dot,
                          boxShadow: `inset 0 0 0 1px ${withAlpha(dot, 0.38)}`,
                        }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: dot, boxShadow: `0 0 10px ${dot}` }}
                        />
                        {noShow ? "No asistió" : "Cancelado"}
                      </div>
                    );
                  }

                  if (isNoShowAction) {
                    return (
                      <button
                        onClick={() => onChangeStatus(appointment, "no_show")}
                        className="w-full h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition hover:brightness-110"
                        style={{
                          background: "rgba(255,255,255,0.025)",
                          color: dot,
                          boxShadow: `inset 0 0 0 1px ${withAlpha(dot, 0.34)}`,
                        }}
                      >
                        No asistió
                      </button>
                    );
                  }

                  return confirmCancel ? (
                    <div
                      className="rounded-xl p-2.5 space-y-2"
                      style={{
                        background: withAlpha(dot, 0.08),
                        boxShadow: `inset 0 0 0 1px ${withAlpha(dot, 0.36)}`,
                      }}
                    >
                      <div className="text-xs text-center" style={{ color: dot }}>
                        {appointment.deposit_status === "paid"
                          ? "Tiene seña pagada. ¿Qué hacés con la seña?"
                          : "¿Cancelar este turno?"}
                      </div>
                      {appointment.deposit_status === "paid" ? (
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="destructive"
                            className="h-9"
                            onClick={() => {
                              onCancelWithDeposit(appointment, "keep");
                              setConfirmCancel(false);
                            }}
                          >
                            Perder seña
                          </Button>
                          <Button
                            variant="secondary"
                            className="h-9"
                            onClick={() => {
                              onCancelWithDeposit(appointment, "return");
                              setConfirmCancel(false);
                            }}
                          >
                            Devolver seña
                          </Button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="destructive"
                            className="h-9"
                            onClick={() => {
                              onCancel(appointment);
                              setConfirmCancel(false);
                            }}
                          >
                            Sí, cancelar
                          </Button>
                          <Button
                            variant="secondary"
                            className="h-9"
                            onClick={() => setConfirmCancel(false)}
                          >
                            No
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : appointment.status !== "charged" ? (
                    <button
                      onClick={() => setConfirmCancel(true)}
                      className="w-full h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition hover:bg-white/[0.045]"
                      style={{
                        background: "rgba(255,255,255,0.018)",
                        color: "rgba(255,255,255,.72)",
                        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.13)",
                      }}
                    >
                      Cancelar turno
                    </button>
                  ) : null;
                })()}
              </div>
            </div>
          )}

          <div className="space-y-2 text-sm">
            {phone && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.028] px-3 py-2.5 min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Phone className="h-4 w-4 shrink-0 text-white/38" />
                  <div className="truncate text-white/85 text-[13px]">{phone}</div>
                </div>
                {whatsappHref && (
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="WhatsApp"
                    className="inline-flex shrink-0 items-center gap-1.5 h-8 rounded-full border border-white/10 bg-white/[0.035] text-white/70 hover:bg-white/[0.07] hover:text-white transition px-3 text-[12px] font-medium"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    WhatsApp
                  </a>
                )}
              </div>
            )}
            {email && (
              <div className="flex items-center gap-2 px-1 py-1.5 min-w-0">
                <Mail className="h-4 w-4 shrink-0 text-white/38" />
                <div className="truncate text-white/78 text-[13px]">{email}</div>
              </div>
            )}
            {noteText && (
              <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5">
                <div className="text-[9px] uppercase tracking-[0.16em] text-white/35 mb-1">
                  Notas
                </div>
                <div className="text-white/80 text-[13px] whitespace-pre-wrap break-words">
                  {noteText}
                </div>
              </div>
            )}
          </div>

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
  const hourStart = openDays.length
    ? Math.floor(Math.min(...openDays.map((day) => parseScheduleTime(day.start))))
    : 0;
  const hourEnd = openDays.length
    ? Math.ceil(Math.max(...openDays.map((day) => parseScheduleTime(day.end))))
    : 0;
  const HOURS = openDays.length
    ? Array.from({ length: Math.max(0, hourEnd - hourStart) }, (_, i) => hourStart + i)
    : [];

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
                  isClosed && "opacity-50",
                )}
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {fmtShortDow(d)}
                </div>
                <div className={cn("text-sm font-semibold", isToday && "text-primary")}>
                  {d.getDate()}
                </div>
              </div>
            );
          })}

          <div className="relative sticky left-0 z-30 bg-[#111323] border-r border-white/[0.06]">
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
              <div key={d.toISOString()} className="relative border-l border-white/[0.055] bg-white/[0.006]">
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
                  const height = Math.max(18, dur * ROW_PX - 4);
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
                      <div
                        className="text-[8px] font-semibold leading-none truncate"
                        style={{ color: meta.dot }}
                      >
                        {fmtTime(start)}
                        {a.duration_min
                          ? ` – ${fmtTime(new Date(start.getTime() + Number(a.duration_min) * 60000))}`
                          : ""}
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
                  <div className="text-[10px] text-muted-foreground">+{items.length - 2} más</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
