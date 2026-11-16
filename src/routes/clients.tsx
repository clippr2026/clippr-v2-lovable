import { AccessDenied, usePermGuard } from "@/hooks/use-perm-guard";
import { confirmarClippr } from "@/components/ui/dialogos-clippr";
import { VentanaClippr } from "@/components/clientes/ventana-clippr";
import { EtiquetaBarbero, barberoPrincipal, useClientBarberos } from "@/components/clientes/barbero-cliente";
import { GRUPOS_CLIENTE, GrupoBadge, GrupoHistorial, grupoInfo, grupoPermiteVip, useClientGroups, type ClientGrupo } from "@/components/clientes/grupo-cliente";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { AppShell } from "@/components/app-shell";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import {
  AlertTriangle,
  ArrowRight,
  Cake,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crown,
  Mail,
  MoreHorizontal,
  Megaphone,
  PauseCircle,
  Phone,
  Search,
  Sparkles,
  Star,
  Trash2,
  UserRound,
  Users,
  CalendarDays,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { ACQUISITION_CHANNELS, acquisitionChannelLabel } from "@/lib/acquisition-channels";
import { AcquisitionChannelIcon } from "@/components/acquisition-channel-icon";
import { DateRangePicker, getPreset, type DateRange } from "@/components/date-range-picker";
import { useClientsData } from "@/hooks/use-clients-data";
import {
  useClientsPage,
  useClientSegmentSummary,
  useClientDetail,
  fetchClientsByStatus,
  fetchAllClientRows,
  useDeleteClient,
  useUpdateClientNotes,
  type Client,
  type ClientPayment,
  type ClientListRow,
  type ClientStatus,
} from "@/hooks/use-clients-data";
import { useAuth } from "@/hooks/use-auth";
import { PAY_METHOD_LABEL, type PayMethod } from "@/components/cash-register/register-payment";
import { cancelAppointment, checkOverlap, getMaxAdvanceDays, saveAppointment } from "@/components/agenda/use-agenda-data";
import { computeRepeatDates, WEEKDAYS, type RepeatWeekday } from "@/lib/recurring-schedule";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { emailValido, whatsappHref } from "@/lib/contacto-valido";

// "Reservas recurrentes" (ficha del cliente) — misma tabla que arma
// appointment-dialog.tsx al confirmar "Repetir turno".
type RecurringSeriesRow = {
  id: string;
  employee_id: string | null;
  service_name: string;
  service_price: number | null;
  duration_min: number;
  weekdays: number[];
  every_weeks: number;
  start_time: string;
  end_mode: "count" | "until" | "none";
  end_count: number | null;
  end_until: string | null;
  status: "active" | "finished";
};

const RECURRING_WEEKDAY_LABEL: Record<number, string> = {
  0: "domingos", 1: "lunes", 2: "martes", 3: "miércoles", 4: "jueves", 5: "viernes", 6: "sábados",
};

function recurringSeriesSummary(s: RecurringSeriesRow): string {
  const days = (s.weekdays ?? []).map((d) => RECURRING_WEEKDAY_LABEL[d] ?? "").filter(Boolean).join(", ");
  const cadence = s.every_weeks > 1 ? ` (cada ${s.every_weeks} semanas)` : "";
  const end =
    s.end_mode === "none"
      ? "Sin fecha de finalización"
      : s.end_mode === "until" && s.end_until
        ? `Hasta ${new Date(`${s.end_until}T12:00:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}`
        : s.end_mode === "count" && s.end_count
          ? `${s.end_count} visitas`
          : "";
  return `${days ? `${days.charAt(0).toUpperCase()}${days.slice(1)}` : "Sin días"}${cadence} · ${s.start_time}hs${end ? ` · ${end}` : ""}`;
}

export const Route = createFileRoute("/clients")({
  // Deep link desde Agenda ("Ficha" de un turno, ver handleFicha en
  // agenda.tsx): clientId abre esa ficha directo al entrar, sin pasar por
  // el listado general. agendaDate ("YYYY-MM-DD") es solo para volver a
  // Agenda con la misma fecha al cerrar esa ficha puntual.
  validateSearch: (
    search: Record<string, unknown>,
  ): { clientId?: string; agendaDate?: string; q?: string; openRecurring?: string } => ({
    clientId: typeof search.clientId === "string" ? search.clientId : undefined,
    agendaDate: typeof search.agendaDate === "string" ? search.agendaDate : undefined,
    // Fallback cuando el turno de origen no tenía client_id: solo precarga
    // la búsqueda, nunca abre una ficha por nombre (puede haber homónimos).
    q: typeof search.q === "string" ? search.q : undefined,
    // "Ver recurrencia" desde el detalle del turno (agenda.tsx): abre la
    // ficha directo en la pestaña "reservas" para ver la sección de
    // Reservas recurrentes sin un paso extra.
    openRecurring: typeof search.openRecurring === "string" ? search.openRecurring : undefined,
  }),
  component: ClientsPageGuarded,
});

// Estilo Clippr: luz suave de las tarjetas (celeste arriba a la derecha, violeta abajo a la izquierda).
const CARD_LUZ =
  "radial-gradient(110% 90% at 100% 0%, rgba(79,125,255,.16), transparent 62%), radial-gradient(90% 80% at 0% 100%, rgba(139,92,246,.12), transparent 65%)";

const avatarTints = [
  "from-sky-400/30 to-violet-600/10 text-sky-100 ring-violet-400/30",
  "from-rose-300/30 to-rose-600/10 text-rose-100 ring-rose-300/30",
  "from-violet-300/30 to-violet-600/10 text-violet-100 ring-violet-300/30",
  "from-cyan-300/30 to-cyan-600/10 text-cyan-100 ring-cyan-300/30",
  "from-emerald-300/30 to-emerald-600/10 text-emerald-100 ring-emerald-300/30",
];

function statusBadge(s: ClientStatus) {
  const map = {
    vip: {
      label: "VIP",
      cls: "bg-gradient-to-r from-amber-300/20 to-violet-400/15 text-amber-100 ring-amber-300/40",
    },
    nuevo: { label: "NUEVO", cls: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30" },
    activo: { label: "ACTIVO", cls: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/30" },
    inactivo: { label: "INACTIVO", cls: "bg-white/5 text-muted-foreground ring-white/10" },
    perdido: { label: "PERDIDO", cls: "bg-rose-400/10 text-rose-300 ring-rose-400/30" },
  } as const;
  const c = map[s];
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[9px] font-bold tracking-[0.18em] ring-1",
        c.cls,
      )}
    >
      {c.label}
    </span>
  );
}

function vipTagBadge(tag: Client["vipTag"]) {
  if (tag === "vip") {
    return (
      <span className="rounded-full bg-gradient-to-r from-amber-300/20 to-violet-400/15 px-2 py-0.5 text-[9px] font-bold tracking-[0.18em] text-amber-100 ring-1 ring-amber-300/40">
        👑 VIP
      </span>
    );
  }
  if (tag === "ex_vip") {
    return (
      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] font-bold tracking-[0.18em] text-amber-200 ring-1 ring-amber-300/25">
        👑 EX VIP
      </span>
    );
  }
  return null;
}

type ClientMetricInfo = {
  title: string;
  description: string;
  bullets: string[];
};

const CLIENT_METRIC_INFO = {
  vip: {
    title: "Clientes VIP",
    description:
      "Clientes que mantienen 4 visitas seguidas con una diferencia de 15 días o menos entre visitas.",
    bullets: [
      "Si sus últimas 4 visitas cumplen la frecuencia, aparece como VIP.",
      "Si alguna vez fue VIP pero ya no cumple la frecuencia, queda marcado como EX VIP en su ficha.",
      "Si vuelve a cumplir 4 visitas seguidas cada 15 días o menos, recupera el sello VIP automáticamente.",
    ],
  },
  nuevos: {
    title: "Clientes nuevos",
    description:
      "Clientes con 0 o 1 visita completada, todavía dentro del período inicial (45 días desde esa visita, o desde el turno al que no asistieron si nunca llegaron a visitar).",
    bullets: [
      "Un turno futuro agendado los mantiene como nuevos aunque hayan pasado los 45 días.",
      "Al completar su segunda visita dejan de ser nuevos y pasan a activos.",
      "Si tenían 0 visitas y no asistieron a su primer turno, pasan a inactivo (45 días) o perdido (60 días) si no vuelven a agendar.",
    ],
  },
  activos: {
    title: "Clientes activos",
    description: "Clientes con 2 o más visitas cuya última visita fue hace 45 días o menos, o tienen un turno futuro agendado.",
    bullets: [
      "Representan la base vigente del negocio.",
      "Incluye clientes que siguen viniendo con una frecuencia saludable.",
      "Si un EX VIP está activo, se muestra como activo con el sello EX VIP en su ficha.",
    ],
  },
  inactivos: {
    title: "Clientes inactivos",
    description: "Clientes cuya última visita (o el turno al que no asistieron) fue hace entre 46 y 59 días, sin turno futuro agendado.",
    bullets: [
      "Todavía son recuperables con una acción simple.",
      "Conviene contactarlos antes de que pasen a perdidos.",
      "Un WhatsApp o beneficio puntual suele ser suficiente para probar recuperación.",
    ],
  },
  perdidos: {
    title: "Clientes perdidos",
    description: "Clientes cuya última visita (o el turno al que no asistieron) fue hace 60 días o más, sin turno futuro agendado.",
    bullets: [
      "Necesitan una campaña de reconquista más fuerte.",
      "Sirven para medir clientes que el negocio dejó de retener.",
      "Si fueron VIP alguna vez, mantienen el sello EX VIP en su ficha para no perder ese dato de valor.",
    ],
  },
} satisfies Record<string, ClientMetricInfo>;

function Rating({ value }: { value: number }) {
  return (
    <div className="flex gap-[3px]">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "h-3 w-3",
            i < value
              ? "fill-violet-300 text-violet-300 drop-shadow-[0_0_4px_rgba(139,92,246,0.6)]"
              : "text-white/15",
          )}
        />
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  caption,
  link,
  onLinkClick,
  icon,
  glow,
  rgb,
  featured,
  info,
  onInfoClick,
  className,
}: {
  label: string;
  value: string;
  caption: React.ReactNode;
  link?: string;
  onLinkClick?: () => void;
  icon: React.ReactNode;
  glow: string;
  /** Color de la tarjeta ("r, g, b"); sin esto queda violeta como siempre. */
  rgb?: string;
  featured?: boolean;
  info?: string;
  onInfoClick?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-3.5 group transition-all hover:-translate-y-0.5 hover:border-white/20",
        featured && "border-violet-400/35",
        className,
      )}
      style={
        rgb
          ? {
              background: `radial-gradient(110% 90% at 100% 0%, rgba(${rgb},.20), transparent 62%), radial-gradient(90% 80% at 0% 100%, rgba(${rgb},.10), transparent 65%)`,
              borderColor: `rgba(${rgb},.38)`,
            }
          : { background: CARD_LUZ }
      }
    >
      <div className="relative flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs sm:text-sm font-semibold leading-tight" style={{ color: rgb ? `rgb(${rgb})` : "#fff" }}>
            {label}
          </div>
          {info && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onInfoClick?.();
              }}
              className="shrink-0 text-[10px] font-semibold text-muted-foreground/40 opacity-0 transition hover:text-violet-200 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Información sobre ${label}`}
            >
              i
            </button>
          )}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="text-3xl sm:text-[2rem] font-display font-medium leading-none tracking-tight">
            {value}
          </div>
          <div className="text-lg sm:text-xl opacity-80 shrink-0">{icon}</div>
        </div>
        {caption && <div className="text-[11px] text-muted-foreground leading-snug">{caption}</div>}
        {link && (
          <button
            onClick={onLinkClick}
            className="mt-0.5 inline-flex items-center gap-1 self-start text-[11px] sm:text-xs font-semibold text-violet-300 hover:text-violet-200 transition-colors"
            style={rgb ? { color: `rgb(${rgb})` } : undefined}
          >
            {link} <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function formatClientSince(date?: string | null) {
  if (!date) return "Sin fecha";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return parsed.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Solo día y mes — un cumpleaños no necesita mostrar la edad.
function formatBirthday(date?: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("es-AR", { day: "2-digit", month: "long" });
}

function formatApptDateTime(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Mismas etiquetas que STATUS_META en agenda.tsx — "completed" muestra
// "Confirmado" igual que ahí (es el mismo status, la Agenda nunca lo llama
// "Completado" en la UI).
const APPT_STATUS_LABEL: Record<string, string> = {
  pending: "Por confirmar",
  confirmed: "Confirmado",
  completed: "Confirmado",
  charged: "Cobrado",
  cancelled: "Cancelado",
  no_show: "No asistió",
  blocked: "Bloqueado",
};

const APPT_STATUS_TONE: Record<string, string> = {
  pending: "text-sky-300",
  confirmed: "text-violet-300",
  completed: "text-emerald-300",
  charged: "text-emerald-300",
  cancelled: "text-white/40",
  no_show: "text-rose-300",
  blocked: "text-white/40",
};

// "10%" o "$5.000" — null si no hay descuento real para no mostrar "0%".
function formatDiscountLabel(discountType?: string | null, discountValue?: string | null): string | null {
  if (!discountType || discountValue == null) return null;
  const value = Number(discountValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  return discountType === "percent" ? `${value}%` : `$${value.toLocaleString("es-AR")}`;
}

function formatPayMethodLabel(method?: string | null): string | null {
  if (!method) return null;
  return PAY_METHOD_LABEL[method as PayMethod] ?? method;
}

type ClientDetailPanelProps = {
  client: Client;
  onDelete: (client: Client) => void;
  onSaveNotes: (clientId: string, notes: string) => Promise<void>;
  savingNotes: boolean;
  businessId: string | null;
  profile: ReturnType<typeof useAuth>["profile"];
  initialTab?: "resumen" | "reservas" | "grupos";
};

// Memoizado: el padre re-renderiza en cada tecla de búsqueda, cambio de orden,
// etc. Sin este límite, toda la ficha del cliente (header, métricas, historial)
// se recalculaba y re-renderizaba en cada una de esas teclas aunque nada acá
// hubiera cambiado. Ahora solo re-renderiza cuando cambia el cliente
// seleccionado o el estado de guardado de notas.
const ClientDetailPanel = memo(function ClientDetailPanel({
  client,
  onDelete,
  onSaveNotes,
  savingNotes,
  businessId,
  profile,
  initialTab,
}: ClientDetailPanelProps) {
  const { data: gruposFicha } = useClientGroups(businessId);
  const { data: barberosFicha } = useClientBarberos(businessId);
  const [tab, setTab] = useState<"resumen" | "reservas" | "grupos">(initialTab ?? "resumen");
  // Reserva cobrada actualmente expandida (para ver el detalle del pago) —
  // una sola a la vez, se resetea al cambiar de cliente igual que el resto
  // del estado local del panel.
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(client.notes ?? "");
  // El cuadro de escritura solo se muestra al crear la primera nota o
  // mientras se edita una existente — una vez guardada, se ve solo el texto.
  const [isEditingNote, setIsEditingNote] = useState(false);

  useEffect(() => {
    setNoteDraft(client.notes ?? "");
    setIsEditingNote(false);
    setMenuOpen(false);
    if (initialTab) setTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id, client.notes]);

  // ── Reservas recurrentes ("Repetir turno") ──────────────────────────────
  const [recurringSeries, setRecurringSeries] = useState<RecurringSeriesRow[]>([]);
  const [seriesEmployees, setSeriesEmployees] = useState<{ id: string; name: string }[]>([]);
  const [finalizingSeriesId, setFinalizingSeriesId] = useState<string | null>(null);
  const [editingSeries, setEditingSeries] = useState<RecurringSeriesRow | null>(null);

  useEffect(() => {
    if (!businessId) {
      setRecurringSeries([]);
      return;
    }
    let cancelled = false;
    supabase
      .from("recurring_series" as any)
      .select("*")
      .eq("business_id", businessId)
      .eq("client_id", client.id)
      .eq("status", "active")
      .then(({ data, error }: any) => {
        if (!cancelled) setRecurringSeries(!error && data ? (data as RecurringSeriesRow[]) : []);
      });
    return () => {
      cancelled = true;
    };
  }, [client.id, businessId]);

  // Profesionales — solo se piden si hace falta (hay al menos una serie
  // activa), para no sumar una consulta más a la ficha en el caso común.
  useEffect(() => {
    if (!businessId || recurringSeries.length === 0 || seriesEmployees.length > 0) return;
    supabase
      .from("employees")
      .select("id,full_name")
      .eq("business_id", businessId)
      .then(({ data, error }) => {
        if (!error && data) {
          setSeriesEmployees(data.map((e) => ({ id: e.id, name: e.full_name ?? "Profesional" })));
        }
      });
  }, [businessId, recurringSeries.length, seriesEmployees.length]);

  async function handleFinalizeSeries(series: RecurringSeriesRow) {
    if (!(await confirmarClippr({ titulo: "¿Detener las reservas futuras?", texto: "Se detienen las reservas futuras de esta recurrencia. No afecta turnos pasados ni ya cobrados.", confirmar: "Detener", destructivo: true }))) return;
    setFinalizingSeriesId(series.id);
    try {
      const nowIso = new Date().toISOString();
      const { data: futureAppts, error: fetchError } = await supabase
        .from("appointments")
        .select("id")
        .eq("recurring_series_id", series.id)
        .gt("starts_at", nowIso)
        .not("status", "in", "(charged,cancelled)");
      if (fetchError) throw new Error(fetchError.message);

      for (const a of futureAppts ?? []) {
        try {
          await cancelAppointment(a.id, {
            userId: profile?.id ?? null,
            name: profile?.full_name ?? "Recepción",
            role: profile?.role ?? null,
            reason: "Recurrencia finalizada",
          });
        } catch {
          // Best-effort: un turno que falle no debe frenar el resto.
        }
      }

      const { error: seriesError } = await supabase
        .from("recurring_series" as any)
        .update({ status: "finished", updated_at: new Date().toISOString() })
        .eq("id", series.id);
      if (seriesError) throw new Error(seriesError.message);

      setRecurringSeries((prev) => prev.filter((s) => s.id !== series.id));
      toast.success("Recurrencia finalizada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFinalizingSeriesId(null);
    }
  }

  // "Editar recurrencia" — edita TODO el patrón (días, cada cuántas
  // semanas, horario, condición de finalización) además de
  // servicio/precio/duración/profesional. Si el patrón no cambió, solo
  // actualiza contenido en los turnos futuros ya generados (rápido, no
  // toca fechas). Si el patrón SÍ cambió, borra las ocurrencias futuras
  // viejas (nunca pasadas/cobradas/completadas) y genera las nuevas según
  // el patrón nuevo, validando que no choquen con otro turno.
  const [seriesEditForm, setSeriesEditForm] = useState({
    serviceName: "",
    price: "0",
    duration: "30",
    employeeId: "",
    weekdays: [] as number[],
    everyWeeks: "1",
    startTime: "09:00",
    endMode: "count" as "count" | "until" | "none",
    count: "4",
    until: "",
  });
  const [savingSeriesEdit, setSavingSeriesEdit] = useState(false);

  useEffect(() => {
    if (!editingSeries) return;
    setSeriesEditForm({
      serviceName: editingSeries.service_name,
      price: String(editingSeries.service_price ?? 0),
      duration: String(editingSeries.duration_min ?? 30),
      employeeId: editingSeries.employee_id ?? "",
      weekdays: editingSeries.weekdays ?? [],
      everyWeeks: String(editingSeries.every_weeks ?? 1),
      startTime: editingSeries.start_time ?? "09:00",
      endMode: editingSeries.end_mode,
      count: String(editingSeries.end_count ?? 4),
      until: editingSeries.end_until ?? "",
    });
  }, [editingSeries]);

  async function handleSaveSeriesEdit() {
    if (!editingSeries || !businessId) return;
    const newWeekdays = [...seriesEditForm.weekdays].sort();
    if (newWeekdays.length === 0) {
      toast.error("Elegí al menos un día de la semana.");
      return;
    }
    const contentPatch = {
      service_name: seriesEditForm.serviceName.trim() || editingSeries.service_name,
      service_price: Number(seriesEditForm.price) || 0,
      duration_min: Number(seriesEditForm.duration) || 30,
      employee_id: seriesEditForm.employeeId || null,
    };
    const oldWeekdays = [...(editingSeries.weekdays ?? [])].sort();
    const patternChanged =
      JSON.stringify(newWeekdays) !== JSON.stringify(oldWeekdays) ||
      Number(seriesEditForm.everyWeeks) !== editingSeries.every_weeks ||
      seriesEditForm.startTime !== editingSeries.start_time ||
      seriesEditForm.endMode !== editingSeries.end_mode ||
      (seriesEditForm.endMode === "count" && Number(seriesEditForm.count) !== editingSeries.end_count) ||
      (seriesEditForm.endMode === "until" && seriesEditForm.until !== editingSeries.end_until);

    setSavingSeriesEdit(true);
    try {
      if (!patternChanged) {
        // Camino liviano: solo contenido, no toca fechas ni recalcula nada.
        const { error: seriesError } = await supabase
          .from("recurring_series" as any)
          .update({ ...contentPatch, updated_at: new Date().toISOString() })
          .eq("id", editingSeries.id);
        if (seriesError) throw new Error(seriesError.message);

        const { error: apptError } = await supabase
          .from("appointments")
          .update(contentPatch)
          .eq("recurring_series_id", editingSeries.id)
          .gt("starts_at", new Date().toISOString())
          .not("status", "in", "(charged,cancelled,completed)");
        if (apptError) throw new Error(apptError.message);

        setRecurringSeries((prev) => prev.map((s) => (s.id === editingSeries.id ? { ...s, ...contentPatch } : s)));
        toast.success("Recurrencia actualizada");
        setEditingSeries(null);
        return;
      }

      // Patrón cambiado: recalcula SOLO las ocurrencias futuras. Arranca
      // desde ahora (o mañana, si la hora nueva ya pasó hoy) — nunca desde
      // la fecha original de la serie, que puede estar en el pasado.
      const now = new Date();
      const [h, m] = seriesEditForm.startTime.split(":").map((x) => Number(x) || 0);
      const anchor = new Date(now);
      anchor.setHours(h, m, 0, 0);
      if (anchor.getTime() <= now.getTime()) anchor.setDate(anchor.getDate() + 1);

      const everyWeeks = Math.max(1, Number(seriesEditForm.everyWeeks) || 1);
      // Solo se agenda dentro del límite de anticipación (Configuración → Horarios); el resto se
      // agenda solo a medida que se liberan días.
      const advanceDays = await getMaxAdvanceDays(businessId);
      const windowEnd = new Date();
      windowEnd.setDate(windowEnd.getDate() + advanceDays);
      windowEnd.setHours(23, 59, 59, 0);
      const candidateDates = computeRepeatDates(anchor, {
        weekdays: newWeekdays as RepeatWeekday[],
        everyWeeks,
        endMode: seriesEditForm.endMode,
        count: Number(seriesEditForm.count) || 1,
        until: seriesEditForm.until,
      }, windowEnd);

      // Valida que no choque con otro turno del mismo profesional — no
      // repite acá la validación de horario laboral/descansos de Agenda
      // (evitaría duplicar esa lógica fuera de la Agenda); si programás una
      // recurrencia fuera del horario configurado, Agenda lo va a avisar
      // recién si después tocás ese turno puntual ahí.
      const okDates: Date[] = [];
      let skipped = 0;
      for (const date of candidateDates) {
        if (contentPatch.employee_id) {
          const conflict = await checkOverlap(contentPatch.employee_id, date.toISOString(), contentPatch.duration_min, null);
          if (conflict) {
            skipped++;
            continue;
          }
        }
        okDates.push(date);
      }

      const confirmMsg =
        `Esto va a reemplazar las reservas futuras de esta serie por el nuevo patrón — ` +
        `se van a crear ${okDates.length} turno${okDates.length === 1 ? "" : "s"} nuevo${okDates.length === 1 ? "" : "s"}` +
        `${skipped > 0 ? ` (${skipped} fecha${skipped === 1 ? "" : "s"} no se pudo${skipped === 1 ? "" : "ieron"} generar por choque de horario)` : ""}. ` +
        `Las reservas pasadas, cobradas o completadas no se tocan. ¿Confirmás?`;
      if (!(await confirmarClippr({ titulo: "¿Reemplazar las reservas futuras?", texto: confirmMsg.replace(/\s*¿Confirmás\?$/, ""), confirmar: "Confirmar" }))) {
        setSavingSeriesEdit(false);
        return;
      }

      // Borra (no cancela) las ocurrencias futuras viejas: son placeholders
      // generados por la serie, no cancelaciones reales que deban quedar en
      // el historial — mismo criterio que clearOverlappingBlocks con los
      // bloqueos horarios. Pasadas/cobradas/completadas nunca se tocan.
      const nowIso = now.toISOString();
      const { error: deleteError } = await supabase
        .from("appointments")
        .delete()
        .eq("recurring_series_id", editingSeries.id)
        .gt("starts_at", nowIso)
        .not("status", "in", "(charged,cancelled,completed)");
      if (deleteError) throw new Error(deleteError.message);

      for (const date of okDates) {
        try {
          await saveAppointment({
            business_id: businessId,
            client_id: client.id,
            client_name: client.name,
            employee_id: contentPatch.employee_id,
            service_name: contentPatch.service_name,
            service_price: contentPatch.service_price,
            duration_min: contentPatch.duration_min,
            starts_at: date.toISOString(),
            status: "pending",
            recurring_series_id: editingSeries.id,
          });
        } catch {
          // Best-effort — una fecha con conflicto de último momento (carrera)
          // no debe frenar el resto de la regeneración.
        }
      }

      const seriesPatch = {
        ...contentPatch,
        weekdays: newWeekdays,
        every_weeks: everyWeeks,
        start_time: seriesEditForm.startTime,
        end_mode: seriesEditForm.endMode,
        end_count: seriesEditForm.endMode === "count" ? Number(seriesEditForm.count) || null : null,
        end_until: seriesEditForm.endMode === "until" && seriesEditForm.until ? seriesEditForm.until : null,
        last_generated_until: okDates.length
          ? okDates[okDates.length - 1].toISOString().slice(0, 10)
          : null,
      };
      const { error: seriesError } = await supabase
        .from("recurring_series" as any)
        .update({ ...seriesPatch, updated_at: new Date().toISOString() })
        .eq("id", editingSeries.id);
      if (seriesError) throw new Error(seriesError.message);

      setRecurringSeries((prev) => prev.map((s) => (s.id === editingSeries.id ? { ...s, ...seriesPatch } : s)));
      toast.success(`Recurrencia actualizada — ${okDates.length} turno${okDates.length === 1 ? "" : "s"} nuevo${okDates.length === 1 ? "" : "s"}`);
      setEditingSeries(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingSeriesEdit(false);
    }
  }

  async function handleSaveNote() {
    await onSaveNotes(client.id, noteDraft);
    setIsEditingNote(false);
  }

  function handleEditNote() {
    setNoteDraft(client.notes ?? "");
    setIsEditingNote(true);
  }

  function handleCancelEditNote() {
    setNoteDraft(client.notes ?? "");
    setIsEditingNote(false);
  }

  async function handleDeleteNote() {
    await onSaveNotes(client.id, "");
    setNoteDraft("");
    setIsEditingNote(false);
  }

  // Visitas = días distintos con pago (dos pagos el mismo día son una visita), igual que los grupos.
  const visitasDias = gruposFicha?.porCliente.get(client.id)?.dias_visitas ?? client.visits;

  // Historial = turnos + ventas sin turno (servicios y productos). Una venta del mismo día que un turno va debajo de ese turno.
  const timeline = useMemo(() => {
    const dia = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
    const sueltas = client.history.filter((p) => !p.appointmentId);
    const usadas = new Set<string>();
    const items: Array<
      | { tipo: "turno"; fecha: number; r: Client["reservations"][number]; ventas: ClientPayment[] }
      | { tipo: "venta"; fecha: number; p: ClientPayment }
    > = client.reservations.map((r) => {
      const ventas = sueltas.filter((p) => !usadas.has(p.id) && dia(p.date) === dia(r.date));
      ventas.forEach((p) => usadas.add(p.id));
      return { tipo: "turno" as const, fecha: new Date(r.date).getTime(), r, ventas };
    });
    sueltas.filter((p) => !usadas.has(p.id)).forEach((p) => items.push({ tipo: "venta", fecha: new Date(p.date).getTime(), p }));
    return items.sort((a, b) => b.fecha - a.fecha);
  }, [client.history, client.reservations]);
  const ticket = visitasDias ? Math.round(client.spent / visitasDias) : 0;
  const since = formatClientSince(client.created_at);
  const birthday = formatBirthday(client.birth_date);
  const favoriteServices = client.favoriteServices;
  const hasNote = Boolean((client.notes ?? "").trim());

  return (
    <>
    <div className="flex flex-col lg:h-full">
      <div
        className={cn(
          "relative px-6 py-5 border-b border-white/5",
        )}
      >
        <div className="relative">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-3 pr-10">
                  <div className="h-12 w-12 rounded-2xl grid place-items-center bg-gradient-to-br from-sky-400/30 to-violet-600/10 ring-1 ring-violet-400/40 text-sky-100 shrink-0">
                    <UserRound className="h-6 w-6 text-sky-100/80" />
                  </div>
                  <div className="min-w-0 text-xl font-display font-semibold leading-tight">{client.name}</div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <GrupoBadge grupo={gruposFicha?.porCliente.get(client.id)?.grupo} />
                  {client.origen && (
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1",
                        client.origen === "online"
                          ? "bg-sky-400/10 text-sky-200 ring-sky-400/30"
                          : "bg-white/5 text-white/70 ring-white/10",
                      )}
                    >
                      {client.origen === "online" ? "Reserva online" : "Reserva manual"}
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-center gap-2 text-sm text-white/70">
                  <CalendarDays className="h-4 w-4 text-white/45" />
                  <span>
                    Cliente desde <span className="font-semibold text-white capitalize">{since}</span>
                  </span>
                </div>
                {client.acquisitionSource && (
                  <div className="mt-2 flex items-start gap-2 text-sm text-white/70">
                    {(() => {
                      const channel = ACQUISITION_CHANNELS.find((c) => c.id === client.acquisitionSource);
                      return channel ? (
                        <AcquisitionChannelIcon channel={channel} className="h-4 w-4 shrink-0 mt-0.5" />
                      ) : (
                        <Megaphone className="h-4 w-4 text-white/45 mt-0.5" />
                      );
                    })()}
                    <div>
                      <span>
                        Nos conoció por{" "}
                        <span className="font-semibold text-white">
                          {ACQUISITION_CHANNELS.find((c) => c.id === client.acquisitionSource)?.label ??
                            client.acquisitionSource}
                        </span>
                      </span>
                      {/* Texto libre de "Otro": campo propio de adquisición, nunca una nota. */}
                      {client.acquisitionSourceCustom?.trim() && (
                        <div className="mt-0.5 text-xs text-white/50">
                          {client.acquisitionSourceCustom.trim()}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {(client.phone || client.email) && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-white/70">
                    {client.phone &&
                      (whatsappHref(client.phone) ? (
                        // Tocar el teléfono abre el chat de WhatsApp con el cliente.
                        <a
                          href={whatsappHref(client.phone)!}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 font-semibold text-emerald-200 transition hover:bg-emerald-400/20"
                        >
                          <WhatsAppIcon className="h-4 w-4" />
                          {client.phone}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 text-white/45" />
                          {client.phone}
                        </span>
                      ))}
                    {client.email &&
                      (emailValido(client.email) ? (
                        // Tocar el correo abre un mensaje nuevo para el cliente.
                        <a
                          href={`mailto:${client.email.trim()}`}
                          className="inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 font-semibold text-white/85 transition hover:bg-white/10"
                        >
                          <Mail className="h-4 w-4 shrink-0" />
                          <span className="truncate">{client.email}</span>
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 truncate">
                          <Mail className="h-3.5 w-3.5 shrink-0 text-white/45" />
                          <span className="truncate">{client.email}</span>
                        </span>
                      ))}
                  </div>
                )}
                {birthday && (
                  <div className="mt-1.5 inline-flex items-center gap-2 text-sm text-white/70">
                    <Cake className="h-4 w-4 text-white/45" />
                    <span>{birthday}</span>
                  </div>
                )}
              </div>
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="rounded-full p-2 hover:bg-white/5 transition"
                >
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-9 z-20 w-44 rounded-xl bg-background/95 ring-1 ring-white/10 shadow-2xl p-1.5 backdrop-blur">
                    <button
                      onClick={() => onDelete(client)}
                      className="w-full inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-3 shrink-0">
        <div className="grid grid-cols-3 rounded-full bg-white/[0.04] ring-1 ring-white/10 p-1">
          {(["resumen", "reservas", "grupos"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "h-9 rounded-full px-2 text-sm font-semibold transition",
                tab === t
                  ? "bg-gradient-to-r from-sky-400 to-violet-500 text-background"
                  : "text-white/60 hover:text-white",
              )}
            >
              {t === "reservas" ? "Historial" : t === "grupos" ? "Grupos" : "Resumen"}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-5 lg:flex-1 min-h-0 lg:overflow-y-auto">
        {/* Ambas pestañas quedan montadas y apiladas en la misma celda de grid,
            así el alto del panel lo define la más alta de las dos y no
            cambia (ni el modal salta de posición) al alternar resumen/
            historial — solo se alterna la visibilidad. */}
        <div className="grid">
          <div
            className={cn(
              "col-start-1 row-start-1 space-y-5",
              tab !== "resumen" && "invisible pointer-events-none",
            )}
            aria-hidden={tab !== "resumen"}
          >
            {/* Métricas: tarjetas con luz, sin mayúsculas */}
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { t: "Valor histórico", v: `$${client.spent.toLocaleString("es-AR")}` },
                { t: "Visitas", v: String(visitasDias) },
                { t: "Ticket promedio", v: `$${ticket.toLocaleString("es-AR")}` },
                { t: "Última visita", v: client.lastVisit ?? "—" },
              ].map((m) => (
                <div
                  key={m.t}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3"
                  style={{ background: CARD_LUZ }}
                >
                  <div className="text-sm font-semibold text-white">{m.t}</div>
                  <div className="mt-1 text-xl font-display tabular-nums text-white">{m.v}</div>
                </div>
              ))}
            </div>

            {/* Con quién se atiende */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4" style={{ background: CARD_LUZ }}>
              <div className="mb-2 text-sm font-semibold text-white">Se atiende con</div>
              {(() => {
                const info = barberosFicha?.info.get(client.id);
                if (!info?.conteo?.length) {
                  return <div className="text-sm text-white/55">Todavía no tiene turnos cobrados con un barbero.</div>;
                }
                return (
                  <div className="space-y-2.5">
                    <div className="divide-y divide-white/[0.06]">
                      {info.conteo.map(([id, n]) => (
                        <div key={id} className="flex items-center justify-between gap-3 py-2">
                          <span className="truncate text-sm font-medium text-white/85">
                            {barberosFicha!.nombres.get(id) ?? "Sin nombre"}
                          </span>
                          <span className="shrink-0 text-[11px] text-white/55">
                            {n} {n === 1 ? "atención" : "atenciones"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Servicios favoritos */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4" style={{ background: CARD_LUZ }}>
              <div className="mb-2 text-sm font-semibold text-white">Servicios favoritos</div>
              {favoriteServices.length === 0 ? (
                <div className="text-sm text-white/55">
                  Todavía no hay servicios suficientes para detectar favoritos.
                </div>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {favoriteServices.map((item) => (
                    <div key={item.service} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="truncate text-sm font-medium text-white/85">{item.service}</span>
                      <span className="shrink-0 text-[11px] text-white/55">
                        {item.count} veces · ${item.amount.toLocaleString("es-AR")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notas: integradas a la ficha, sin módulo contenedor propio.
                Solo la nota manual guardada por un usuario (clients.notes) —
                nunca datos automáticos de reservas/promos/turnos. Una sola
                nota activa por cliente: mientras hay una guardada se ve solo
                el texto (con Editar/eliminar); el cuadro de escritura solo
                aparece para crearla o mientras se edita, nunca los dos a la
                vez. */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4" style={{ background: CARD_LUZ }}>
              <div className="mb-2">
                <span className="text-sm font-semibold text-white">Notas</span>
              </div>
              {hasNote && !isEditingNote ? (
                <div className="flex items-start justify-between gap-3 rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-3">
                  <p className="text-sm leading-relaxed text-white/80 whitespace-pre-wrap">{client.notes}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={handleEditNote}
                      className="text-xs font-semibold text-violet-300 hover:text-violet-200 transition"
                    >
                      Editar nota
                    </button>
                    <button
                      onClick={handleDeleteNote}
                      disabled={savingNotes}
                      aria-label="Eliminar nota"
                      className="rounded-full p-1 text-muted-foreground hover:text-rose-300 hover:bg-rose-500/10 transition disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Agregá notas internas del cliente..."
                    className="w-full min-h-[68px] rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-3 text-sm focus:outline-none focus:ring-violet-400/40 focus:bg-white/[0.045] transition"
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    {hasNote && (
                      <button
                        onClick={handleCancelEditNote}
                        disabled={savingNotes}
                        className="h-10 rounded-full px-4 text-sm font-semibold text-white/60 hover:text-white transition disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    )}
                    <button
                      onClick={handleSaveNote}
                      disabled={savingNotes}
                      className="h-10 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-background px-5 text-sm font-semibold disabled:opacity-50"
                    >
                      {savingNotes ? "Guardando…" : "Guardar nota"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div
            className={cn("col-start-1 row-start-1", tab !== "grupos" && "invisible pointer-events-none")}
            aria-hidden={tab !== "grupos"}
          >
            <GrupoHistorial clientId={client.id} />
          </div>
          <div
            className={cn(
              "col-start-1 row-start-1 space-y-2",
              tab !== "reservas" && "invisible pointer-events-none",
            )}
            aria-hidden={tab !== "reservas"}
          >
            {recurringSeries.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-white">Reservas recurrentes</div>
                {recurringSeries.map((s) => {
                  const empName = s.employee_id ? seriesEmployees.find((e) => e.id === s.employee_id)?.name : null;
                  return (
                    <div key={s.id} className="rounded-xl bg-violet-500/[0.06] ring-1 ring-violet-400/20 p-3 space-y-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{s.service_name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {recurringSeriesSummary(s)}
                          {empName ? ` · ${empName}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingSeries(s)}
                          className="rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-white/80 ring-1 ring-white/10 transition hover:bg-white/10"
                        >
                          Editar recurrencia
                        </button>
                        <button
                          type="button"
                          disabled={finalizingSeriesId === s.id}
                          onClick={() => handleFinalizeSeries(s)}
                          className="rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-medium text-rose-300 ring-1 ring-rose-400/25 transition hover:bg-rose-500/15 disabled:opacity-50"
                        >
                          {finalizingSeriesId === s.id ? "Finalizando…" : "Finalizar recurrencia"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {timeline.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/55" style={{ background: CARD_LUZ }}>
                Sin movimientos todavía.
              </div>
            ) : (
              timeline.map((it) => {
                if (it.tipo === "venta") {
                  const v = it.p;
                  return (
                    <div key={v.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5" style={{ background: CARD_LUZ }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white truncate">{v.service}</div>
                              {v.productos?.map((n) => (
                                <div key={n} className="text-xs text-white/60 truncate">{n}</div>
                              ))}
                            </div>
                            {v.esProducto && (
                              <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/70 ring-1 ring-white/10">
                                Producto
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-white/55">
                            {formatApptDateTime(v.date)}
                            {v.employeeName ? ` · ${v.employeeName}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-semibold tabular-nums text-white">${v.amount.toLocaleString("es-AR")}</div>
                          <div className="text-[11px] font-semibold text-emerald-300">Cobrado</div>
                          {formatPayMethodLabel(v.method) && (
                            <div className="text-[11px] text-white/55">{formatPayMethodLabel(v.method)}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }
                const r = it.r;
                // Lo que se muestra es lo que de verdad se cobró (con descuento
                // por efectivo, promo, etc.), no el precio de lista del turno.
                const cobrado = r.status === "charged" && r.payment ? r.payment.amount : r.price;
                const methodLabel = r.status === "charged" ? formatPayMethodLabel(r.payment?.method) : null;
                return (
                  <div
                    key={r.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden"
                    style={{ background: CARD_LUZ }}
                  >
                    <div className="flex w-full items-center justify-between gap-3 p-3.5">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{r.service}</div>
                        {client.history
                          .filter((h) => h.appointmentId === r.id)
                          .flatMap((h) => h.productos ?? [])
                          .map((n, i) => (
                            <div key={`${n}-${i}`} className="text-xs text-white/60 truncate">{n}</div>
                          ))}
                        <div className="text-[11px] text-white/55">
                          {formatApptDateTime(r.date)}
                          {r.employeeName ? ` · ${r.employeeName}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {cobrado != null && (
                          <div className="text-sm font-semibold tabular-nums text-white">
                            ${cobrado.toLocaleString("es-AR")}
                          </div>
                        )}
                        <div className={cn("text-[11px] font-semibold", APPT_STATUS_TONE[r.status] ?? "text-white/60")}>
                          {APPT_STATUS_LABEL[r.status] ?? r.status}
                        </div>
                        {methodLabel && <div className="text-[11px] text-white/55">{methodLabel}</div>}
                      </div>
                    </div>
                    {it.ventas.length > 0 && (
                      <div className="space-y-1.5 border-t border-white/10 bg-white/[0.02] px-3.5 py-2.5">
                        {it.ventas.map((v) => (
                          <div key={v.id} className="flex items-center justify-between gap-3 text-[11px]">
                            <span className="min-w-0 truncate text-white/80">
                              + {v.service}
                              {v.esProducto && (
                                <span className="ml-2 rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-white/60 ring-1 ring-white/10">
                                  Producto
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 tabular-nums text-white/80">${v.amount.toLocaleString("es-AR")}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>

    {editingSeries && (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={() => setEditingSeries(null)}
      >
        <div
          className="flex max-h-[85dvh] w-full max-w-sm flex-col rounded-2xl bg-[#15161c] ring-1 ring-white/10 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shrink-0 px-5 pt-5">
            <div className="text-lg font-semibold">Editar recurrencia</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Se aplica solo a los turnos futuros de esta serie — nunca a pasados, cobrados o completados.
              Si cambiás días, horario o cada cuánto se repite, esos turnos futuros se regeneran con el patrón nuevo.
            </p>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Repetir todos los:</label>
              <div className="grid grid-cols-2 gap-1.5">
                {WEEKDAYS.map((day) => (
                  <label key={day.value} className="flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={seriesEditForm.weekdays.includes(day.value)}
                      onChange={(e) =>
                        setSeriesEditForm((f) => ({
                          ...f,
                          weekdays: e.target.checked
                            ? Array.from(new Set([...f.weekdays, day.value]))
                            : f.weekdays.filter((d) => d !== day.value),
                        }))
                      }
                    />
                    {day.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Horario</label>
                <input
                  type="time"
                  value={seriesEditForm.startTime}
                  onChange={(e) => setSeriesEditForm((f) => ({ ...f, startTime: e.target.value }))}
                  className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-primary/40"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Cada cuántas semanas</label>
                <input
                  type="number"
                  min={1}
                  value={seriesEditForm.everyWeeks}
                  onChange={(e) => setSeriesEditForm((f) => ({ ...f, everyWeeks: e.target.value }))}
                  className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-primary/40"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Finaliza</label>
              <select
                value={seriesEditForm.endMode}
                onChange={(e) => setSeriesEditForm((f) => ({ ...f, endMode: e.target.value as "count" | "until" | "none" }))}
                className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-primary/40"
              >
                <option value="count">Después de X visitas</option>
                <option value="until">En una fecha</option>
                <option value="none">Sin fecha de finalización</option>
              </select>
              {seriesEditForm.endMode === "count" ? (
                <input
                  type="number"
                  min={1}
                  value={seriesEditForm.count}
                  onChange={(e) => setSeriesEditForm((f) => ({ ...f, count: e.target.value }))}
                  className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-primary/40"
                />
              ) : seriesEditForm.endMode === "until" ? (
                <input
                  type="date"
                  value={seriesEditForm.until}
                  onChange={(e) => setSeriesEditForm((f) => ({ ...f, until: e.target.value }))}
                  className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-primary/40"
                />
              ) : null}
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Servicio</label>
              <input
                value={seriesEditForm.serviceName}
                onChange={(e) => setSeriesEditForm((f) => ({ ...f, serviceName: e.target.value }))}
                className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-primary/40"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Precio</label>
                <input
                  type="number"
                  min={0}
                  value={seriesEditForm.price}
                  onChange={(e) => setSeriesEditForm((f) => ({ ...f, price: e.target.value }))}
                  className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-primary/40"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Duración (min)</label>
                <input
                  type="number"
                  min={5}
                  value={seriesEditForm.duration}
                  onChange={(e) => setSeriesEditForm((f) => ({ ...f, duration: e.target.value }))}
                  className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-primary/40"
                />
              </div>
            </div>
            {seriesEmployees.length > 0 && (
              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Profesional</label>
                <select
                  value={seriesEditForm.employeeId}
                  onChange={(e) => setSeriesEditForm((f) => ({ ...f, employeeId: e.target.value }))}
                  className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-primary/40"
                >
                  <option value="">Sin asignar</option>
                  {seriesEmployees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t border-white/10 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => setEditingSeries(null)}
              className="h-10 flex-1 rounded-xl bg-white/5 ring-1 ring-white/10 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={savingSeriesEdit}
              onClick={handleSaveSeriesEdit}
              className="h-10 flex-1 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingSeriesEdit ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
});

type ClientDetailModalProps = {
  open: boolean;
  loading: boolean;
  client: Client | null;
  onClose: () => void;
  onDelete: (client: Client) => void;
  onSaveNotes: (clientId: string, notes: string) => Promise<void>;
  savingNotes: boolean;
  businessId: string | null;
  profile: ReturnType<typeof useAuth>["profile"];
  // "Ver recurrencia" desde el detalle del turno — fuerza la pestaña
  // "reservas" al abrir esta ficha puntual.
  initialTab?: "resumen" | "reservas" | "grupos";
};

function ClientDetailModal({
  open,
  loading,
  client,
  onClose,
  onDelete,
  onSaveNotes,
  savingNotes,
  businessId,
  profile,
  initialTab,
}: ClientDetailModalProps) {
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative flex w-full sm:max-w-2xl max-h-[92dvh] flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px] border border-violet-400/45 bg-[#08070f]"
        style={{
          boxShadow: "0 0 0 1px rgba(139,92,246,.35), 0 30px 90px -20px rgba(0,0,0,.9), 0 0 60px -18px rgba(139,92,246,.55)",
          backgroundImage:
            "radial-gradient(120% 45% at 85% 0%, rgba(79,125,255,.20), transparent 60%), radial-gradient(110% 50% at 0% 100%, rgba(139,92,246,.22), transparent 62%)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur transition hover:bg-black/60 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {client ? (
            <ClientDetailPanel
              client={client}
              onDelete={onDelete}
              onSaveNotes={onSaveNotes}
              savingNotes={savingNotes}
              businessId={businessId}
              profile={profile}
              initialTab={initialTab}
            />
          ) : (
            <div className="grid min-h-[280px] place-items-center p-6">
              <div className="text-center space-y-3">
                {loading ? (
                  <>
                    <UserRound className="mx-auto h-8 w-8 text-muted-foreground animate-pulse" />
                    <div className="text-lg font-display text-muted-foreground">Cargando cliente…</div>
                  </>
                ) : (
                  <>
                    <UserRound className="mx-auto h-8 w-8 text-muted-foreground" />
                    <div className="text-lg font-display">No se encontró el cliente</div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Sin el permiso de esta sección (por ejemplo, una cuenta Profesional), no se muestra aunque entre por el link.
function ClientsPageGuarded() {
  const hasAccess = usePermGuard("clientes");
  if (!hasAccess) return <AccessDenied />;
  return <ClientsPage />;
}

function ClientsPage() {
  const { businessId, profile } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const deleteClient = useDeleteClient(businessId);
  const updateNotes = useUpdateClientNotes(businessId);
  // Deep link desde Agenda ("Ficha" de un turno): abre esa ficha puntual sin
  // pasar por el listado. Se capturan en el primer render y no se vuelven a
  // leer del search param — si el usuario cierra la ficha y abre otra desde
  // la lista normal, esa segunda ya no "vuelve a Agenda" al cerrarla (ver
  // onClose de ClientDetailModal más abajo). openRecurring: mismo criterio,
  // para "Ver recurrencia" desde el detalle del turno.
  const [deepLink] = useState(() => ({
    clientId: search.clientId,
    agendaDate: search.agendaDate,
    openRecurring: search.openRecurring,
  }));

  const [query, setQuery] = useState(() => search.q ?? "");
  const [sort, setSort] = useState<"gasto" | "recientes" | "nombre">("gasto");
  const [selected, setSelected] = useState<string | null>(() => deepLink.clientId ?? null);
  const [segmentModal, setSegmentModal] = useState<{ title: string; clients: ClientListRow[]; loading?: boolean } | null>(
    null,
  );
  const [metricInfo, setMetricInfo] = useState<ClientMetricInfo | null>(null);
  const [acquisitionModalOpen, setAcquisitionModalOpen] = useState(false);
  const [acquisitionRange, setAcquisitionRange] = useState<DateRange>(() => {
    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - 6);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });
  // Drilldown de una categoría puntual ("Recomendado", "Instagram", etc.)
  // dentro del mismo modal — nunca navega a otra pantalla.
  const [acquisitionDrilldown, setAcquisitionDrilldown] = useState<{ key: string; label: string } | null>(null);
  // Estos 4 modales (a diferencia de ClientDetailModal, que ya lo tenía)
  // no bloqueaban el scroll de fondo: en iOS Safari eso deja moverse a la
  // página de atrás mientras el modal está abierto, y al reaparecer el body
  // scrolleado es lo que corre el header/botón Cerrar fuera de vista hasta
  // hacer scroll. Un solo lock combinado alcanza (el hook ya soporta que
  // más de un llamador lo pida a la vez, ver use-body-scroll-lock.ts).
  useBodyScrollLock(acquisitionModalOpen || Boolean(metricInfo) || Boolean(segmentModal));
  const acquisitionScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    acquisitionScrollRef.current?.scrollTo(0, 0);
  }, [acquisitionModalOpen, acquisitionDrilldown]);
  // Lista completa (no paginada) solo para el panel de estadísticas por canal —
  // el grid principal sigue usando useClientsPage (RPC paginada), sin tocarlo.
  const { data: allClients } = useClientsData(acquisitionModalOpen ? businessId : null);

  // Debounce the search so we don't hit the server on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => clearTimeout(t);
  }, [query]);

  // Server-side: sort by name/recientes (gasto is sorted client-side over the
  // already-loaded pages, since spend is an aggregate).
  // All three sorts (incl. "gasto") are now resolved server-side by the RPC.
  const {
    data: pageData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useClientsPage(businessId, debouncedQuery, sort);

  const { data: summary } = useClientSegmentSummary(businessId);
  const { data: grupos } = useClientGroups(businessId);
  const { data: barberos } = useClientBarberos(businessId);
  const [filtroBarbero, setFiltroBarbero] = useState<string | null>(null);
  const { data: currentDetail, isLoading: detailLoading } = useClientDetail(businessId, selected);

  const clients = useMemo<ClientListRow[]>(
    () => (pageData?.pages ?? []).flatMap((p) => p.rows),
    [pageData],
  );
  const genericos = grupos?.genericos;
  const total = Math.max(0, (pageData?.pages?.[0]?.total ?? 0) - (genericos?.size ?? 0));

  // Ya no se auto-selecciona el primer cliente de la lista al cargar: el
  // detalle ahora es un modal (ver ClientDetailModal más abajo), y un modal
  // solo debe abrirse por una acción explícita del usuario (tocar una
  // tarjeta), nunca solo. Antes tenía sentido porque el panel de detalle
  // era un panel siempre visible al lado de la lista en desktop.

  // Search + sorting (nombre/recientes/gasto) all happen server-side now.
  // La ficha genérica ("Sin agendar") junta ventas de personas que no se agendaron: no es un cliente.
  const filtered = useMemo(() => (genericos && genericos.size > 0 ? clients.filter((c) => !genericos.has(c.id)) : clients), [clients, genericos]);

  const counts = useMemo(
    () => ({
      vip: summary?.counts.vip ?? 0,
      nuevos: summary?.counts.nuevo ?? 0,
      activos: summary?.counts.activo ?? 0,
      inactivos: summary?.counts.inactivo ?? 0,
      perdidos: summary?.counts.perdido ?? 0,
    }),
    [summary],
  );

  const current = currentDetail ?? null;

  // Una sola pasada: agrupa por canal Y guarda los clientes de cada grupo,
  // así el conteo de la tarjeta y el listado del drilldown salen siempre de
  // los mismos datos (nunca pueden mostrar números distintos).
  const acquisitionGroups = useMemo(() => {
    const byChannel = new Map<string, { count: number; revenue: number; clients: Client[] }>();
    if (!allClients) return byChannel;
    const rangeStart = new Date(`${acquisitionRange.from}T00:00:00`).getTime();
    const rangeEnd = new Date(`${acquisitionRange.to}T23:59:59`).getTime();
    for (const c of allClients) {
      const capturedAt = c.acquisitionCapturedAt ?? c.created_at;
      const capturedTime = new Date(capturedAt).getTime();
      if (Number.isNaN(capturedTime) || capturedTime < rangeStart || capturedTime > rangeEnd) continue;
      const key = c.acquisitionSource ?? "sin_dato";
      const entry = byChannel.get(key) ?? { count: 0, revenue: 0, clients: [] };
      entry.count += 1;
      entry.revenue += c.spent;
      entry.clients.push(c);
      byChannel.set(key, entry);
    }
    for (const entry of byChannel.values()) {
      entry.clients.sort((a, b) => {
        const aTime = new Date(a.acquisitionCapturedAt ?? a.created_at).getTime();
        const bTime = new Date(b.acquisitionCapturedAt ?? b.created_at).getTime();
        return bTime - aTime;
      });
    }
    return byChannel;
  }, [allClients, acquisitionRange]);

  const acquisitionStats = useMemo(
    () =>
      Array.from(acquisitionGroups.entries())
        .map(([value, stats]) => ({
          value,
          label: value === "sin_dato" ? "Sin dato" : acquisitionChannelLabel(value),
          count: stats.count,
          revenue: stats.revenue,
        }))
        .sort((a, b) => b.count - a.count),
    [acquisitionGroups],
  );

  const acquisitionDrilldownClients = acquisitionDrilldown
    ? acquisitionGroups.get(acquisitionDrilldown.key)?.clients ?? []
    : [];

  const showGroup = useCallback(
    async (title: string, grupo: ClientGrupo) => {
      setFiltroBarbero(null);
      setSegmentModal({ title, clients: [], loading: true });
      if (!businessId) {
        setSegmentModal({ title, clients: [], loading: false });
        return;
      }
      try {
        const [rows, g] = await Promise.all([fetchAllClientRows(businessId), Promise.resolve(grupos?.porCliente)]);
        const del = rows.filter((r) => g?.get(r.id)?.grupo === grupo);
        setSegmentModal({ title, clients: del, loading: false });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error cargando clientes");
        setSegmentModal({ title, clients: [], loading: false });
      }
    },
    [businessId, grupos],
  );

  const handleDeleteClient = useCallback(
    async (client: Client) => {
      if (!(await confirmarClippr({ titulo: `¿Eliminar a ${client.name}?`, texto: "Se borra la ficha del cliente.", confirmar: "Eliminar", destructivo: true }))) return;
      await deleteClient.mutateAsync(client.id);
      toast.success("Cliente eliminado");
      setSelected((cur) => (cur === client.id ? null : cur));
    },
    [deleteClient],
  );

  const saveNotes = useCallback(
    async (clientId: string, notes: string) => {
      await updateNotes.mutateAsync({ clientId, notes });
      toast.success("Nota guardada");
    },
    [updateNotes],
  );

  // Cierra la ficha. Si es la que se abrió por deep link desde Agenda, vuelve
  // ahí con la misma fecha que se estaba viendo en vez de dejar al usuario
  // en el listado general de Clientes — si mientras tanto abrió otra ficha
  // distinta desde la lista normal, `selected` ya no coincide con
  // `deepLink.clientId` y este cierre se comporta como cualquier otro.
  const closeClientDetail = useCallback(() => {
    if (deepLink.clientId && deepLink.agendaDate && selected === deepLink.clientId) {
      navigate({ to: "/agenda", search: { date: deepLink.agendaDate } as never });
      return;
    }
    setSelected(null);
  }, [deepLink, selected, navigate]);

  if (isLoading && clients.length === 0) {
    return (
      <AppShell>
        <div className="grid place-items-center py-32">
          <ClipprLoader size="screen" delayMs={130} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="app-premium-shell">
        <div className="pointer-events-none absolute left-1/2 top-[-120px] z-[-1] h-[620px] w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_17%_4%,rgb(139_92_246_/_0.34),transparent_38%),radial-gradient(circle_at_76%_0%,rgb(79_125_255_/_0.30),transparent_36%),radial-gradient(circle_at_46%_96%,rgb(255_123_229_/_0.14),transparent_50%)] blur-[16px]" />
        {/* Mobile: sin altura fija ni overflow-hidden — la página scrollea
            de forma natural (AppShell ya deja lugar para el nav inferior con
            pb-[4rem+safe-area] en <main>). Sumamos 40px más acá para que la
            última tarjeta quede claramente despegada del nav, sin duplicar
            el safe-area-inset-bottom que ya aplica AppShell. Total ~104–138px
            según el dispositivo. Desktop (lg+): layout de panes fijo, sin
            cambios. */}
        <div className="lg:h-[calc(100dvh-92px)] lg:overflow-hidden animate-fade-up flex flex-col gap-3 pb-10 lg:pb-0">
          {/* KPI cards — siempre arriba, fuera de cualquier scroll.
              Mobile: VIP+Activos / Nuevos+Inactivos / Perdidos a pantalla
              completa (destacado, misma altura que el resto — ver StatCard
              featured). Desktop (sm+): sin cambios, grilla pareja de 5. */}
          <div className="grid shrink-0 grid-cols-3 gap-2 sm:gap-3">
            {GRUPOS_CLIENTE.map((g) => (
              <StatCard
                key={g.key}
                label={g.label}
                value={String(grupos?.counts[g.key] ?? 0)}
                caption={null}
                icon={g.key === "semanal" ? <Crown className="h-5 w-5" style={{ color: `rgb(${g.rgb})` }} /> : g.key === "perdido" ? <AlertTriangle className="h-5 w-5" style={{ color: `rgb(${g.rgb})` }} /> : <Users className="h-5 w-5" style={{ color: `rgba(${g.rgb},.8)` }} />}
                glow={g.glow}
                rgb={g.rgb}
                featured={g.key === "semanal" || g.key === "perdido"}
                info={g.label}
                onInfoClick={() => setMetricInfo({ title: g.label, description: g.regla, bullets: [] })}
                link={g.key === "perdido" ? "Reconquistar" : "Ver todos"}
                onLinkClick={() => showGroup(g.label, g.key)}
              />
            ))}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => setAcquisitionModalOpen(true)}
              className="h-11 flex-1 sm:flex-none px-5 rounded-full text-sm font-semibold flex items-center justify-center gap-2 bg-white/[0.04] border border-white/10 hover:bg-white/10 transition"
            >
              <Megaphone className="h-4 w-4 text-violet-300" />
              Cómo nos conocieron
            </button>
          </div>
        <div className="min-h-0 flex-1">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-4 flex min-h-0 lg:h-full flex-col gap-3 sm:gap-4 lg:overflow-hidden" style={{ background: CARD_LUZ }}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre, teléfono, servicio…"
                className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-9 pr-3 text-sm focus:outline-none focus:border-violet-400/50"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{total} cliente{total === 1 ? "" : "s"}</span>
              <div className="flex items-center gap-2">
                <span>Ordenar:</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                  className="rounded-md bg-white/5 ring-1 ring-white/10 px-2 py-1 text-foreground"
                >
                  <option value="gasto">Mayor gasto</option>
                  <option value="recientes">Recientes</option>
                  <option value="nombre">Nombre</option>
                </select>
              </div>
            </div>
            <div className="lg:flex-1 lg:overflow-y-auto pr-1 -mr-1 space-y-2">
              {filtered.map((c, i) => {
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-2xl border p-3 transition text-left relative overflow-hidden",
                      selected === c.id ? "border-violet-400/45" : "border-white/10 hover:border-white/20",
                    )}
                    style={{ background: CARD_LUZ }}
                  >
                    <div
                      className={cn(
                        "h-11 w-11 rounded-full grid place-items-center text-sm font-semibold bg-gradient-to-br ring-1",
                        avatarTints[i % avatarTints.length],
                      )}
                    >
                      <UserRound className="h-5 w-5 opacity-80" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-white truncate">{c.name}</div>
                        <div className="text-sm font-semibold tabular-nums">
                          ${Number(grupos?.porCliente.get(c.id)?.gasto ?? c.spent).toLocaleString("es-AR")}
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {(() => {
                          const v = grupos?.porCliente.get(c.id)?.dias_visitas ?? c.visits;
                          return `${v} ${v === 1 ? "visita" : "visitas"}`;
                        })()} · {c.lastVisit ?? "sin visitas"}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <GrupoBadge grupo={grupos?.porCliente.get(c.id)?.grupo} />
                      </div>
                    </div>
                  </button>
                );
              })}
              {isLoading && (
                <div className="grid place-items-center py-10">
                  <ClipprLoader size="screen" delayMs={130} />
                </div>
              )}
              {!isLoading && filtered.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-14 text-center">
                  {debouncedQuery ? (
                    <>
                      <Search className="h-6 w-6 text-muted-foreground/50" />
                      <div className="text-sm text-muted-foreground">
                        Sin resultados para “{debouncedQuery}”.
                      </div>
                    </>
                  ) : (
                    <>
                      <UserRound className="h-7 w-7 text-muted-foreground/50" />
                      <div className="text-sm font-medium text-white/80">Todavía no tenés clientes</div>
                      <div className="max-w-[220px] text-xs text-muted-foreground">
                        Se van a ir sumando solos con las ventas y las reservas.
                      </div>
                    </>
                  )}
                </div>
              )}
              {!isLoading && hasNextPage && (
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="w-full mt-2 rounded-xl bg-white/5 ring-1 ring-white/10 py-2.5 text-sm hover:bg-white/[0.08] transition disabled:opacity-50"
                >
                  {isFetchingNextPage ? "Cargando…" : `Cargar más (${clients.length} de ${total})`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Detalle del cliente: modal superpuesto, no contenido normal de la
          página. Portal a document.body + useBodyScrollLock — mismo motivo
          que AgendaCenteredModal (src/components/agenda/agenda-drawer.tsx):
          sin portal, un modal fixed adentro de un contenedor con su propio
          stacking context puede terminar tapado por hermanos fixed del
          árbol raíz (barra inferior, etc.) aunque su z-index sea mayor en
          el papel. No se reusa AgendaCenteredModal tal cual porque
          ClientDetailPanel ya trae su propio header (avatar, nombre,
          estado) — un segundo título arriba sería un header duplicado; acá
          solo se agrega la X de cierre flotante sobre ese header propio.
          useBodyScrollLock además deja al usuario en el mismo scroll del
          listado al cerrar (no hace falta recordar la posición a mano). */}
      {selected &&
        createPortal(
          <ClientDetailModal
            open
            loading={detailLoading}
            client={current}
            onClose={closeClientDetail}
            onDelete={handleDeleteClient}
            onSaveNotes={saveNotes}
            savingNotes={updateNotes.isPending}
            businessId={businessId}
            profile={profile}
            initialTab={deepLink.openRecurring && current?.id === deepLink.clientId ? "reservas" : undefined}
          />,
          document.body,
        )}

      {acquisitionModalOpen && (
        <VentanaClippr
          titulo={acquisitionDrilldown ? acquisitionDrilldown.label : "Cómo nos conocieron"}
          subtitulo={
            acquisitionDrilldown
              ? `${acquisitionDrilldownClients.length} cliente${acquisitionDrilldownClients.length === 1 ? "" : "s"} en el rango elegido.`
              : "Origen de los clientes registrados en el rango elegido."
          }
          onVolver={acquisitionDrilldown ? () => setAcquisitionDrilldown(null) : undefined}
          onClose={() => {
            setAcquisitionModalOpen(false);
            setAcquisitionDrilldown(null);
          }}
        >
          <div ref={acquisitionScrollRef} className="space-y-4">
              <DateRangePicker
                from={acquisitionRange.from}
                to={acquisitionRange.to}
                onChange={setAcquisitionRange}
              />
              {acquisitionDrilldown ? (
                <div className="space-y-1.5">
                  {acquisitionDrilldownClients.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-4 text-sm text-muted-foreground text-center">
                      No hay clientes en ese rango de fechas.
                    </div>
                  ) : (
                    acquisitionDrilldownClients.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setSelected(c.id);
                          setAcquisitionModalOpen(false);
                          setAcquisitionDrilldown(null);
                        }}
                        className="w-full flex items-center justify-between gap-3 rounded-2xl border border-white/10 px-3 py-3 text-left hover:border-white/20 transition" style={{ background: CARD_LUZ }}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate">{c.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            Desde {formatClientSince(c.acquisitionCapturedAt ?? c.created_at)} · {c.visits} visita
                            {c.visits === 1 ? "" : "s"}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-sm font-semibold tabular-nums">
                            ${c.spent.toLocaleString("es-AR")}
                          </span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {acquisitionStats.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-4 text-sm text-muted-foreground text-center">
                      No hay clientes registrados en ese rango de fechas.
                    </div>
                  ) : (
                    acquisitionStats.map((stat) => {
                      const channel = ACQUISITION_CHANNELS.find((c) => c.id === stat.value);
                      return (
                        <button
                          key={stat.value}
                          onClick={() => setAcquisitionDrilldown({ key: stat.value, label: stat.label })}
                          className="w-full flex items-center justify-between rounded-2xl border border-white/10 px-3 py-3 text-left hover:border-white/20 transition" style={{ background: CARD_LUZ }}
                        >
                          <div className="flex items-center gap-2 text-sm font-semibold text-white">
                            {channel ? (
                              <AcquisitionChannelIcon channel={channel} className="h-4 w-4 shrink-0" />
                            ) : null}
                            {stat.label}
                          </div>
                          <div className="flex items-center gap-3 text-sm">
                            <span className="text-muted-foreground">
                              {stat.count} cliente{stat.count === 1 ? "" : "s"}
                            </span>
                            <span className="font-semibold tabular-nums">
                              ${stat.revenue.toLocaleString("es-AR")}
                            </span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
          </div>
        </VentanaClippr>
      )}

      {metricInfo && (
        <VentanaClippr titulo={metricInfo.title} onClose={() => setMetricInfo(null)} ancho="max-w-md">
          <p className="text-sm leading-relaxed text-white/70">{metricInfo.description}</p>
          {metricInfo.bullets.length > 0 && (
            <div className="space-y-2">
              {metricInfo.bullets.map((point) => (
                <div key={point} className="rounded-2xl border border-white/10 px-3 py-2.5 text-sm text-white/80" style={{ background: CARD_LUZ }}>
                  {point}
                </div>
              ))}
            </div>
          )}
        </VentanaClippr>
      )}

      {segmentModal && createPortal(
        <div
          className="fixed inset-0 z-[300] flex items-start sm:items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
        >
          <div
            className="flex w-full max-w-xl max-h-[calc(100dvh-2rem)] flex-col rounded-[28px] border border-violet-400/45 bg-[#08070f] overflow-hidden"
            style={{
              boxShadow: "0 0 0 1px rgba(139,92,246,.35), 0 30px 90px -20px rgba(0,0,0,.9), 0 0 60px -18px rgba(139,92,246,.55)",
              backgroundImage:
                "radial-gradient(120% 45% at 85% 0%, rgba(79,125,255,.20), transparent 60%), radial-gradient(110% 50% at 0% 100%, rgba(139,92,246,.22), transparent 62%)",
            }}
          >
            <div className="shrink-0 flex items-center justify-between p-5 border-b border-white/5">
              <div className="text-base font-semibold text-white">{segmentModal.title}</div>
              <button
                onClick={() => setSegmentModal(null)}
                className="h-10 rounded-full border border-white/10 bg-white/[0.04] px-5 text-sm font-semibold text-white"
              >
                Cerrar
              </button>
            </div>
            {(() => {
              const cuenta = new Map<string, number>();
              segmentModal.clients.forEach((c) => {
                const b = barberoPrincipal(barberos?.info.get(c.id));
                if (b) cuenta.set(b, (cuenta.get(b) ?? 0) + 1);
              });
              if (cuenta.size === 0) return null;
              const orden = Array.from(cuenta.entries()).sort((x, y) => (x[0] === "cualquiera" ? 1 : y[0] === "cualquiera" ? -1 : y[1] - x[1]));
              const chip = (activo: boolean) =>
                cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  activo ? "border-violet-400/60 bg-violet-500/20 text-white" : "border-white/10 bg-white/[0.04] text-white/70",
                );
              return (
                <div className="shrink-0 flex gap-2 overflow-x-auto px-4 py-3 border-b border-white/5">
                  <button type="button" onClick={() => setFiltroBarbero(null)} className={chip(filtroBarbero === null)}>
                    Todos {segmentModal.clients.length}
                  </button>
                  {orden.map(([id, n]) => (
                    <button key={id} type="button" onClick={() => setFiltroBarbero(filtroBarbero === id ? null : id)} className={chip(filtroBarbero === id)}>
                      {id === "cualquiera" ? "Con cualquiera" : barberos?.nombres.get(id) ?? "Sin nombre"} {n}
                    </button>
                  ))}
                </div>
              );
            })()}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
              {segmentModal.loading ? (
                <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">
                  Cargando clientes…
                </div>
              ) : segmentModal.clients.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No hay clientes en este grupo.
                </div>
              ) : (
                segmentModal.clients
                  .filter((c) => !filtroBarbero || barberoPrincipal(barberos?.info.get(c.id)) === filtroBarbero)
                  .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelected(c.id);
                      setSegmentModal(null);
                    }}
                    className="w-full flex items-center justify-between rounded-2xl border border-white/10 p-3 text-left hover:border-white/20"
                    style={{ background: CARD_LUZ }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">{c.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {c.phone || "sin teléfono"} · {c.lastVisit || "sin visitas"}
                      </div>
                      {barberos ? (
                        <div className="mt-1.5">
                          <EtiquetaBarbero info={barberos.info.get(c.id)} nombres={barberos.nombres} permitirVip={grupoPermiteVip(grupos?.porCliente.get(c.id)?.grupo)} />
                        </div>
                      ) : null}
                    </div>
                    <div className="shrink-0 pl-3 text-sm font-semibold">${Number(grupos?.porCliente.get(c.id)?.gasto ?? c.spent).toLocaleString("es-AR")}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
      </div>
    </AppShell>
  );
}
