import * as React from "react";
import { toast } from "sonner";
import { AgendaDrawer, AgendaCenteredModal } from "@/components/agenda/agenda-drawer";
import { DarkCalendar } from "@/components/agenda/dark-calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, X, CalendarDays, Repeat2,
  Scissors, UserPlus, UserRound, Clock3, Phone, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  saveAppointment,
  checkOverlap,
  checkDaySchedule,
  resolveDaySchedule,
  type Appointment,
  type ApptStatus,
  type Client,
  type Employee,
  type Service,
} from "./use-agenda-data";
import { ServiceImage } from "@/components/ui/service-image";
import { AcquisitionSourceField } from "@/components/acquisition-source-field";
import { acquisitionChannelRequiresText } from "@/lib/acquisition-channels";
import {
  resolveServicePricing,
  type EmployeeServiceOverrideMap,
} from "@/lib/service-pricing";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  appointment?: Appointment | null;
  defaultEmployeeId?: string | null;
  defaultStartsAt?: Date | null;
  employees: Employee[];
  services: Service[];
  clients: Client[];
  businessId: string;
  createdByName?: string | null;
  createdByRole?: string | null;
  onSaved: () => void;
  schedule?: import("./use-agenda-data").ScheduleMap | null;
  employeeSchedules?: Record<string, import("./use-agenda-data").ScheduleMap>;
  businessSpecialDates?: import("./use-agenda-data").SpecialDateMap;
  employeeSpecialDates?: import("./use-agenda-data").EmployeeSpecialDateMap;
  employeeServiceOverrides?: EmployeeServiceOverrideMap;
  // "drawer" (default) = panel lateral, igual que Agenda general.
  // "modal" = modal centrado en pantalla — usado por Mi Agenda, donde un
  // panel lateral no encaja con el resto del layout del profesional.
  presentation?: "drawer" | "modal";
};


async function clearOverlappingBlocks(
  employeeId: string,
  startsAt: string,
  durationMin: number,
) {
  const newStart = new Date(startsAt);
  const newEnd = new Date(newStart.getTime() + durationMin * 60_000);
  const windowStart = new Date(newStart.getTime() - 2 * 60 * 60_000).toISOString();
  const windowEnd = new Date(newEnd.getTime() + 2 * 60 * 60_000).toISOString();

  const { data, error } = await supabase
    .from("appointments")
    .select("id,starts_at,ends_at,duration_min")
    .eq("employee_id", employeeId)
    .eq("status", "blocked")
    .gte("starts_at", windowStart)
    .lte("starts_at", windowEnd);

  if (error) throw new Error(error.message);

  const ids = (data ?? [])
    .filter((appt) => {
      const existStart = new Date(appt.starts_at);
      const existEnd = appt.ends_at
        ? new Date(appt.ends_at)
        : new Date(existStart.getTime() + Number(appt.duration_min ?? 30) * 60_000);
      return existStart < newEnd && existEnd > newStart;
    })
    .map((appt) => appt.id);

  if (ids.length) {
    const { error: deleteError } = await supabase.from("appointments").delete().in("id", ids);
    if (deleteError) throw new Error(deleteError.message);
  }
}

type SenasConfig = {
  enabled: boolean;
  services: string[];
  amount_type: "fixed" | "percent";
  amount_value: number;
  message?: string;
};

type RepeatWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type RepeatConfig = {
  enabled: boolean;
  weekdays: RepeatWeekday[];
  everyWeeks: number;
  endMode: "count" | "until";
  count: number;
  until: string;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toLocalDateParts(d: Date) {
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hour: pad(d.getHours()),
    minute: pad(d.getMinutes()),
  };
}

function buildLocalDate(date: string, hour: string, minute: string) {
  return new Date(`${date}T${hour}:${minute}:00`);
}

function formatReadableDate(date: string) {
  if (!date) return "Seleccioná una fecha";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getRepeatDates(firstDate: Date, repeat: RepeatConfig) {
  if (!repeat.enabled || repeat.weekdays.length === 0) return [firstDate];

  const results: Date[] = [];
  const maxIterations = 370;
  const start = new Date(firstDate);
  start.setHours(firstDate.getHours(), firstDate.getMinutes(), 0, 0);

  const untilDate = repeat.endMode === "until" && repeat.until
    ? new Date(`${repeat.until}T23:59:59`)
    : null;

  for (let i = 0; i < maxIterations; i++) {
    const candidate = addDays(start, i);
    const weeksFromStart = Math.floor(i / 7);
    if (weeksFromStart % Math.max(1, repeat.everyWeeks) !== 0) continue;
    if (!repeat.weekdays.includes(candidate.getDay() as RepeatWeekday)) continue;
    if (candidate < start) continue;
    if (untilDate && candidate > untilDate) break;

    results.push(candidate);
    if (repeat.endMode === "count" && results.length >= Math.max(1, repeat.count)) break;
  }

  return results.length ? results : [firstDate];
}

const WEEKDAYS: { value: RepeatWeekday; label: string }[] = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

// Inline date picker — usa el DarkCalendar compartido (con botón Hoy), en un
// popover fixed para que no lo recorte el overflow del drawer.
function AppointmentDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const selectedDate = value ? new Date(value + "T12:00:00") : new Date();
  const displayValue = value
    ? new Date(value + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : "Seleccioná una fecha";

  const openCal = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      // Mantener el popover (≈280px) dentro de pantalla.
      const left = Math.min(Math.max(r.left, 12), Math.max(12, window.innerWidth - 292));
      setPos({ top: r.bottom + 6, left });
    }
    setOpen(true);
  };

  const handleSelect = (d: Date) => {
    onChange(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openCal}
        className="w-full flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent transition text-left"
      >
        <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className={value ? "text-foreground capitalize" : "text-muted-foreground"}>{displayValue}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="fixed z-[61]" style={{ top: pos.top, left: pos.left }}>
            <DarkCalendar value={selectedDate} onSelect={handleSelect} />
          </div>
        </>
      )}
    </>
  );
}

export function AppointmentDialog({
  open,
  onOpenChange,
  appointment,
  defaultEmployeeId,
  defaultStartsAt,
  employees,
  services,
  clients,
  businessId,
  createdByName,
  createdByRole,
  onSaved,
  schedule = null,
  employeeSchedules = {},
  businessSpecialDates = {},
  employeeSpecialDates = {},
  employeeServiceOverrides = {},
  presentation = "drawer",
}: Props) {
  const Wrapper = presentation === "modal" ? AgendaCenteredModal : AgendaDrawer;
  const isEdit = !!appointment?.id;
  const [busy, setBusy] = React.useState(false);
  const [repeatOpen, setRepeatOpen] = React.useState(false);

  // Client config — controls which fields appear in "nuevo cliente"

  const [clientId, setClientId] = React.useState<string>("");
  const [clientName, setClientName] = React.useState("");
  const [clientPhone, setClientPhone] = React.useState("");
  const [clientEmail, setClientEmail] = React.useState("");
  const [clientBirth, setClientBirth] = React.useState("");
  const [newClientMode, setNewClientMode] = React.useState(false);
  const [clientFirstName, setClientFirstName] = React.useState("");
  const [clientLastName, setClientLastName] = React.useState("");
  const [acquisitionSource, setAcquisitionSource] = React.useState("");
  const [acquisitionCustom, setAcquisitionCustom] = React.useState("");
  const [clientSearch, setClientSearch] = React.useState("");
  const [showClientList, setShowClientList] = React.useState(false);

  const [employeeId, setEmployeeId] = React.useState<string>("");
  const [serviceId, setServiceId] = React.useState<string>("");
  const [serviceName, setServiceName] = React.useState("");
  const [price, setPrice] = React.useState<number>(0);
  const [duration, setDuration] = React.useState<number>(30);
  const [dateValue, setDateValue] = React.useState("");
  const [hourValue, setHourValue] = React.useState("09");
  const [minuteValue, setMinuteValue] = React.useState("00");
  const [status, setStatus] = React.useState<ApptStatus>("pending");
  const [notes, setNotes] = React.useState("");
  const [internalNotes, setInternalNotes] = React.useState("");
  const [senasConfig, setSenasConfig] = React.useState<SenasConfig | null>(null);
  const [repeat, setRepeat] = React.useState<RepeatConfig>({
    enabled: false,
    weekdays: [],
    everyWeeks: 1,
    endMode: "count",
    count: 4,
    until: "",
  });

  React.useEffect(() => {
    if (!open || !businessId) return;
    supabase
      .from("business_settings")
      .select("senas_config")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        setSenasConfig((data?.senas_config as SenasConfig | null) ?? null);
      });
  }, [open, businessId]);

  React.useEffect(() => {
    if (!open) return;
    const baseDate = appointment ? new Date(appointment.starts_at) : (defaultStartsAt ?? new Date());
    const parts = toLocalDateParts(baseDate);

    if (appointment) {
      setClientId(appointment.client_id ?? "");
      setClientName(appointment.client_name ?? "");
      setClientFirstName((appointment.client_name ?? "").split(" ")[0] ?? "");
      setClientLastName((appointment.client_name ?? "").split(" ").slice(1).join(" "));
      setClientPhone("");
      setClientEmail("");
      setClientBirth("");
      setNewClientMode(false);
      setEmployeeId(appointment.employee_id ?? "");
      setServiceId("");
      setServiceName(appointment.service_name ?? "");
      setPrice(Number(appointment.service_price ?? 0));
      setDuration(Number(appointment.duration_min ?? 30));
      setDateValue(parts.date);
      setHourValue(parts.hour);
      setMinuteValue(parts.minute);
      setStatus(appointment.status === "confirmed" ? "confirmed" : "pending");
      setNotes(appointment.notes ?? "");
      setInternalNotes("");
    } else {
      setClientId("");
      setClientName("");
      setClientPhone("");
      setClientEmail("");
      setClientBirth("");
      setClientFirstName("");
      setClientLastName("");
      setClientSearch("");
      setShowClientList(false);
      setNewClientMode(false);
      setEmployeeId(defaultEmployeeId ?? employees[0]?.id ?? "");
      setServiceId("");
      setServiceName("");
      setPrice(0);
      setDuration(30);
      setDateValue(parts.date);
      setHourValue(parts.hour);
      setMinuteValue(parts.minute);
      setStatus("pending");
      setNotes("");
      setInternalNotes("");
      setRepeat({
        enabled: false,
        weekdays: [baseDate.getDay() as RepeatWeekday],
        everyWeeks: 1,
        endMode: "count",
        count: 4,
        until: "",
      });
    }
  }, [open, appointment, defaultEmployeeId, defaultStartsAt, employees]);

  const pickClient = (c: Client) => {
    const fullName = c.full_name ?? c.name ?? "";
    setClientId(c.id);
    setClientName(fullName);
    setClientFirstName(fullName.split(" ")[0] ?? "");
    setClientLastName(fullName.split(" ").slice(1).join(" "));
    setClientPhone(c.phone ?? "");
    setClientEmail(c.email ?? "");
    setClientBirth(c.birth_date ?? "");
    setClientSearch("");
    setShowClientList(false);
    setNewClientMode(false);
  };

  const filteredClients = clientSearch.length >= 1
    ? clients.filter((c) => {
        const q = clientSearch.toLowerCase();
        return (c.full_name ?? c.name ?? "").toLowerCase().includes(q)
          || (c.phone ?? "").includes(q)
          || (c.email ?? "").toLowerCase().includes(q);
      }).slice(0, 8)
    : [];

  const selectedService = React.useMemo(
    () => services.find((s) => s.id === serviceId || s.name === serviceName),
    [services, serviceId, serviceName],
  );

  const requiresDeposit = !!(
    senasConfig?.enabled
    && selectedService?.id
    && Array.isArray(senasConfig.services)
    && senasConfig.services.includes(selectedService.id)
  );

  const depositAmount = React.useMemo(() => {
    if (!requiresDeposit || !senasConfig) return 0;
    if (senasConfig.amount_type === "percent") {
      return Math.round((Number(price) || 0) * (Number(senasConfig.amount_value) || 0) / 100);
    }
    return Number(senasConfig.amount_value) || 0;
  }, [requiresDeposit, senasConfig, price]);

  const pickService = (id: string) => {
    setServiceId(id);
    const s = services.find((x) => x.id === id);
    if (s) setServiceName(s.name);
  };

  // Precio/duración del servicio elegido, resueltos con el mismo resolver
  // que usan Caja y la Página Pública (`resolveServicePricing`) — respeta el
  // override por profesional si existe, o el estándar si no. Se recalcula
  // si el usuario cambia de profesional después de elegir el servicio. No
  // corre al abrir un turno YA existente para editar (`serviceId` arranca
  // vacío en ese caso — ver efecto de arriba), así que nunca pisa el precio
  // congelado de un turno ya guardado sin que el usuario vuelva a elegir el
  // servicio explícitamente.
  React.useEffect(() => {
    if (!serviceId) return;
    const s = services.find((x) => x.id === serviceId);
    if (!s) return;
    const resolved = resolveServicePricing(
      { id: s.id, price: s.price, duration_min: s.duration },
      employeeId || null,
      employeeServiceOverrides,
    );
    setPrice(resolved.price);
    setDuration(resolved.duration_min);
  }, [serviceId, employeeId, services, employeeServiceOverrides]);

  const resetForAnother = () => {
    setClientId("");
    setClientName("");
    setClientFirstName("");
    setClientLastName("");
    setClientPhone("");
    setClientEmail("");
    setClientBirth("");
    setAcquisitionSource("");
    setAcquisitionCustom("");
    setClientSearch("");
    setShowClientList(false);
    setNewClientMode(false);
    setServiceId("");
    setServiceName("");
    setPrice(0);
    setDuration(30);
    setNotes("");
    setInternalNotes("");
    setStatus("pending");
  };

  const createClientIfNeeded = async () => {
    if (clientId) return clientId;

    const fullName = newClientMode
      ? `${clientFirstName.trim()} ${clientLastName.trim()}`.trim()
      : clientName.trim();

    if (!fullName) throw new Error("Indicá el cliente.");
    if (newClientMode && (!clientFirstName.trim() || !clientLastName.trim())) {
      throw new Error("Nombre y apellido son obligatorios para crear un cliente nuevo.");
    }
    if (newClientMode && !clientEmail.trim()) {
      throw new Error("El email es obligatorio para crear un cliente nuevo.");
    }
    if (newClientMode && !acquisitionSource) {
      throw new Error("Contanos cómo nos conoció el cliente.");
    }
    if (newClientMode && acquisitionChannelRequiresText(acquisitionSource) && !acquisitionCustom.trim()) {
      throw new Error("Contanos dónde conoció el cliente.");
    }

    const payload: Record<string, unknown> = {
      business_id: businessId,
      full_name: fullName,
      phone: clientPhone.trim() || null,
      email: clientEmail.trim() || null,
      birth_date: clientBirth.trim() || null,
      ...(newClientMode
        ? {
            acquisition_source: acquisitionSource,
            acquisition_source_custom: acquisitionChannelRequiresText(acquisitionSource) ? acquisitionCustom.trim() : null,
            acquisition_captured_at: new Date().toISOString(),
          }
        : {}),
    };

    const { data: newClient, error } = await supabase
      .from("clients")
      .insert(payload)
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return newClient?.id ?? null;
  };

  const submit = async (addAnother = false) => {
    const fullClientName = newClientMode
      ? `${clientFirstName.trim()} ${clientLastName.trim()}`.trim()
      : clientName.trim();

    if (!fullClientName) return toast.error("Indicá el cliente.");
    if (newClientMode && (!clientFirstName.trim() || !clientLastName.trim())) return toast.error("Nombre y apellido son obligatorios.");
    if (newClientMode && !clientEmail.trim()) return toast.error("El email es obligatorio.");
    if (newClientMode && !acquisitionSource) return toast.error("Contanos cómo nos conoció el cliente.");
    if (newClientMode && acquisitionChannelRequiresText(acquisitionSource) && !acquisitionCustom.trim())
      return toast.error("Contanos dónde conoció el cliente.");
    if (!employeeId) return toast.error("Elegí un profesional.");
    if (!serviceName.trim()) return toast.error("Elegí un servicio.");
    if (!dateValue || !hourValue || !minuteValue) return toast.error("Falta la fecha y hora.");

    setBusy(true);
    try {
      const resolvedClientId = await createClientIfNeeded();
      const start = buildLocalDate(dateValue, hourValue, minuteValue);
      const dates = isEdit ? [start] : getRepeatDates(start, repeat);
      const mergedNotes = [notes.trim(), internalNotes.trim() ? `Observación interna: ${internalNotes.trim()}` : ""]
        .filter(Boolean)
        .join("\n");

      // ── Schedule validation ───────────────────────────────────────────────
      // Resuelve la prioridad de horarios (especial profesional → normal
      // profesional → especial negocio → normal negocio) para cada fecha.
      for (const date of dates) {
        const day = resolveDaySchedule(
          schedule,
          employeeSchedules,
          businessSpecialDates,
          employeeSpecialDates,
          employeeId || null,
          date,
        );
        const schedErr = checkDaySchedule(day, date, Number(duration) || 30);
        if (schedErr) {
          toast.error(schedErr);
          setBusy(false);
          return;
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Overlap validation ────────────────────────────────────────────────
      if (employeeId) {
        // Si el horario estaba bloqueado y ahora se carga un turno real, el bloqueo se libera.
        // Así nunca quedan el bloqueo y el turno superpuestos en la misma columna.
        for (const date of dates) {
          await clearOverlappingBlocks(employeeId, date.toISOString(), Number(duration) || 30);
        }

        for (const date of dates) {
          const conflict = await checkOverlap(
            employeeId,
            date.toISOString(),
            Number(duration) || 30,
            isEdit ? (appointment?.id ?? null) : null,
          );
          if (conflict) {
            const conflictTime = new Date(conflict.starts_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
            toast.error(
              `Este profesional ya tiene un turno en ese horario (${conflictTime}${conflict.client_name ? ` · ${conflict.client_name}` : ""}).`,
            );
            setBusy(false);
            return;
          }
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      for (const date of dates) {
        await saveAppointment({
          id: isEdit ? appointment?.id ?? null : null,
          business_id: businessId,
          client_id: resolvedClientId || null,
          client_name: fullClientName,
          employee_id: employeeId || null,
          service_name: serviceName.trim(),
          service_price: Number(price) || 0,
          duration_min: Number(duration) || 30,
          starts_at: date.toISOString(),
          status,
          notes: mergedNotes || null,
          deposit_amount: requiresDeposit ? depositAmount : null,
          deposit_paid: requiresDeposit ? 0 : null,
          deposit_status: requiresDeposit ? "pending" : null,
          created_by_name: createdByName,
          created_by_role: createdByRole,
        });
      }

      const suffix = dates.length > 1 ? ` (${dates.length} reservas)` : "";
      toast.success(isEdit ? "Reserva actualizada" : `Reserva guardada${suffix}`);

      if (requiresDeposit && !isEdit) {
        toast.info(senasConfig?.message || "Este servicio requiere seña. La reserva queda con seña pendiente.");
      }

      onSaved();
      if (addAnother && !isEdit) {
        resetForAnother();
      } else {
        onOpenChange(false);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hourOptions = Array.from({ length: 24 }, (_, i) => pad(i));
  const minuteOptions = ["00", "15", "30", "45"];

  const previewClientName = newClientMode
    ? `${clientFirstName.trim()} ${clientLastName.trim()}`.trim()
    : clientName.trim();

  return (
    <>
    <Wrapper
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Editar reserva" : "Nueva reserva"}
      footer={
        <>
          <Button variant="ghost" className="h-10" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button className="h-10 px-5" onClick={() => submit(false)} disabled={busy}>
            {busy ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
            {isEdit ? "Guardar cambios" : "Guardar reserva"}
          </Button>
        </>
      }
    >
        <div className="grid gap-4">
          {/* Fecha y hora — compact */}
          <section className="rounded-xl border border-white/10 bg-white/[0.025] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider"><CalendarDays className="h-3.5 w-3.5 text-primary" /> Fecha y hora</h3>
              {!isEdit && (
                <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setRepeatOpen(true)}>
                  <Repeat2 className="h-3.5 w-3.5 mr-1" /> Repetir
                </Button>
              )}
            </div>
            <div className="space-y-2">
              <AppointmentDatePicker value={dateValue} onChange={setDateValue} />
              {/* "hs" describe el horario completo (hora : minuto), no un
                  selector individual — así no se lee raro como "14 hs". */}
              <div className="flex items-center gap-1.5">
                <Select value={hourValue} onValueChange={setHourValue}>
                  <SelectTrigger className="h-9 flex-1 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {hourOptions.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-sm font-semibold text-muted-foreground">:</span>
                <Select value={minuteValue} onValueChange={setMinuteValue}>
                  <SelectTrigger className="h-9 flex-1 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {minuteOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="shrink-0 text-sm font-medium text-muted-foreground">hs</span>
              </div>
            </div>
            {repeat.enabled && !isEdit && (
              <Badge variant="secondary" className="w-fit text-xs">Repite {repeat.weekdays.length} día(s)</Badge>
            )}
          </section>

          {/* Cliente */}
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cliente</h3>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-lg bg-white/5 px-2.5 text-xs font-medium text-muted-foreground ring-1 ring-white/10 transition hover:bg-white/10 hover:text-foreground"
                onClick={() => {
                  if (newClientMode) {
                    setNewClientMode(false);
                  } else {
                    setNewClientMode(true);
                    setClientId("");
                    setClientSearch("");
                    setClientName("");
                  }
                }}
              >
                {newClientMode ? "Cancelar" : (<><UserPlus className="h-3.5 w-3.5" /> Nuevo</>)}
              </button>
            </div>

            {!newClientMode && (
              <div className="grid gap-2">
                {clientId ? (
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 ring-1" style={{ background: "oklch(0.38 0.2 150 / 0.15)", boxShadow: "inset 0 0 0 1px oklch(0.76 0.2 150 / 0.3)" }}>
                    <span className="text-sm font-semibold flex-1 text-foreground">{clientName}</span>
                    {clientPhone && <span className="text-xs text-muted-foreground">{clientPhone}</span>}
                    <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setClientId(""); setClientName(""); setClientPhone(""); setClientSearch(""); }}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      className="pl-8 pr-8 h-9"
                      placeholder="Buscar cliente…"
                      value={clientSearch}
                      onChange={(e) => { setClientSearch(e.target.value); setShowClientList(true); setClientId(""); setClientName(""); }}
                      onFocus={() => setShowClientList(true)}
                    />
                    {clientSearch && (
                      <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => { setClientSearch(""); setClientName(""); setClientId(""); setShowClientList(false); }}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {showClientList && filteredClients.length > 0 && !clientId && (
                  <div className="rounded-xl border border-white/10 bg-popover shadow-xl overflow-hidden max-h-40 overflow-y-auto">
                    {filteredClients.map((c) => (
                      <button key={c.id} type="button" className="w-full text-left px-3 py-2 hover:bg-white/[0.05] transition flex items-center gap-2 border-b border-white/5 last:border-0" onClick={() => pickClient(c)}>
                        <div className="h-6 w-6 rounded-full bg-primary/20 ring-1 ring-primary/30 grid place-items-center text-[10px] font-semibold text-primary shrink-0">
                          {(c.full_name ?? c.name ?? "?")[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{c.full_name ?? c.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{[c.phone, c.email].filter(Boolean).join(" · ")}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {newClientMode && (
              <div className="grid gap-2 rounded-lg bg-black/10 p-2.5 border border-white/10">
                <div className="grid grid-cols-2 gap-2">
                  <Input className="h-8 text-sm" value={clientFirstName} onChange={(e) => setClientFirstName(e.target.value)} placeholder="Nombre *" />
                  <Input className="h-8 text-sm" value={clientLastName} onChange={(e) => setClientLastName(e.target.value)} placeholder="Apellido *" />
                </div>
                <Input className="h-8 text-sm" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="Teléfono *" />
                <Input className="h-8 text-sm" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="Email *" />
                <AcquisitionSourceField
                  value={acquisitionSource}
                  onChange={setAcquisitionSource}
                  customValue={acquisitionCustom}
                  onCustomChange={setAcquisitionCustom}
                  wrapperClassName="grid grid-cols-2 gap-2"
                  labelClassName="text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
                  triggerClassName="h-8 text-sm"
                  inputClassName="h-8 text-sm"
                />
              </div>
            )}
          </section>

          {/* Servicio (y Profesional, solo cuando hay más de uno para elegir) */}
          <section className="rounded-xl border border-white/10 bg-white/[0.025] p-3 space-y-3">
            <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
              <Scissors className="h-3.5 w-3.5 text-primary" />
              {employees.length > 1 ? "Profesional y servicio" : "Servicio"}
            </h3>
            <div className="space-y-3">
              {employees.length > 1 && (
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Profesional</Label>
                  <Select value={employeeId} onValueChange={setEmployeeId}>
                    <SelectTrigger className="h-10 text-sm w-full"><SelectValue placeholder="Profesional" /></SelectTrigger>
                    <SelectContent>
                      {employees
                        .filter((e) => e.is_active !== false || e.id === employeeId)
                        .map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name ?? e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Servicio</Label>
                <Select value={serviceId} onValueChange={pickService}>
                  <SelectTrigger className="h-10 text-sm w-full border-white/20 hover:border-white/30 transition-colors [&>svg]:opacity-80 data-[placeholder]:text-white/55">
                    <SelectValue placeholder="Elegí un servicio" />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} — {Number(s.duration ?? 30)} min · ${Math.round(s.price).toLocaleString("es-AR")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {requiresDeposit && (
              <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs">
                🟡 Requiere seña: ${Math.round(depositAmount).toLocaleString("es-AR")}
              </div>
            )}
            {isEdit && (
              <Select value={status} onValueChange={(v) => setStatus(v as ApptStatus)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pendiente</SelectItem>
                  <SelectItem value="confirmed">Confirmado</SelectItem>
                </SelectContent>
              </Select>
            )}
          </section>

          {/* Nota — simple, expands only if needed */}
          <div>
            <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Agregar nota..." className="min-h-10 text-sm resize-none" />
          </div>
        </div>

        {/* Premium summary — only when enough data */}
        {(serviceName || previewClientName) && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Resumen</div>

            {serviceName && (
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  {services.find(s => s.id === serviceId)?.image_url ? (
                    <ServiceImage
                      src={services.find(s => s.id === serviceId)?.image_url}
                      alt={serviceName || "Servicio"}
                      position={services.find(s => s.id === serviceId)?.image_position}
                      className="h-12 w-12 rounded-2xl ring-1 ring-white/10"
                    />
                  ) : (
                    <Scissors className="h-4 w-4 shrink-0 text-emerald-300/75" />
                  )}
                  <span className="truncate font-medium text-foreground">{serviceName}</span>
                </div>
                {price ? (
                  <span className="shrink-0 font-semibold text-foreground">${Number(price).toLocaleString("es-AR")}</span>
                ) : null}
              </div>
            )}

            <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
              {previewClientName && (
                <div className="flex items-center gap-2">
                  <UserRound className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate text-foreground/85">{previewClientName}</span>
                </div>
              )}

              {employees.find(e => e.id === employeeId) && (
                <div className="flex items-center gap-2">
                  <UserPlus className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate text-foreground/85">{employees.find(e => e.id === employeeId)?.full_name ?? employees.find(e => e.id === employeeId)?.name ?? ""}</span>
                </div>
              )}

              {dateValue && (
                <div className="flex items-center gap-2">
                  <Clock3 className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-foreground/85">{dateValue} · {hourValue}:{minuteValue}</span>
                </div>
              )}

              {serviceId && services.find(s => s.id === serviceId) && (
                <div className="pt-1 text-[11px] text-muted-foreground">
                  Duración {Number(services.find(s => s.id === serviceId)?.duration ?? 30)} min
                </div>
              )}
            </div>
          </div>
        )}

    </Wrapper>

      <Wrapper
        open={repeatOpen}
        onOpenChange={setRepeatOpen}
        title="Repetir turno"
        subtitle="Configurá los días y hasta cuándo se repite esta reserva."
        footer={
          <>
            <Button variant="ghost" className="h-9" onClick={() => setRepeatOpen(false)}>Cancelar</Button>
            <Button className="h-9" onClick={() => { setRepeat((r) => ({ ...r, enabled: true })); setRepeatOpen(false); }}>Aceptar</Button>
          </>
        }
      >
          <div className="grid gap-5">
            <div className="grid gap-2">
              <Label>Se repite el</Label>
              <div className="grid grid-cols-2 gap-2">
                {WEEKDAYS.map((day) => (
                  <label key={day.value} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
                    <Checkbox
                      checked={repeat.weekdays.includes(day.value)}
                      onCheckedChange={(checked) => {
                        setRepeat((current) => ({
                          ...current,
                          weekdays: checked
                            ? Array.from(new Set([...current.weekdays, day.value]))
                            : current.weekdays.filter((value) => value !== day.value),
                        }));
                      }}
                    />
                    {day.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Finaliza</Label>
              <Select value={repeat.endMode} onValueChange={(v) => setRepeat((r) => ({ ...r, endMode: v as "count" | "until" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="count">Después de X repeticiones</SelectItem>
                  <SelectItem value="until">Hasta la fecha</SelectItem>
                </SelectContent>
              </Select>
              {repeat.endMode === "count" ? (
                <Input type="number" min={1} value={repeat.count} onChange={(e) => setRepeat((r) => ({ ...r, count: Number(e.target.value) || 1 }))} />
              ) : (
                <Input type="date" value={repeat.until} onChange={(e) => setRepeat((r) => ({ ...r, until: e.target.value }))} />
              )}
            </div>
          </div>
      </Wrapper>
    </>
  );
}
