import * as React from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Loader2, Search, X, CalendarDays, Repeat2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  saveAppointment,
  type Appointment,
  type ApptStatus,
  type Client,
  type Employee,
  type Service,
} from "./use-agenda-data";

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
};

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
}: Props) {
  const isEdit = !!appointment?.id;
  const [busy, setBusy] = React.useState(false);
  const [repeatOpen, setRepeatOpen] = React.useState(false);

  const [clientId, setClientId] = React.useState<string>("");
  const [clientName, setClientName] = React.useState("");
  const [clientPhone, setClientPhone] = React.useState("");
  const [clientEmail, setClientEmail] = React.useState("");
  const [clientBirth, setClientBirth] = React.useState("");
  const [clientNote, setClientNote] = React.useState("");
  const [newClientMode, setNewClientMode] = React.useState(false);
  const [clientFirstName, setClientFirstName] = React.useState("");
  const [clientLastName, setClientLastName] = React.useState("");
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
      setClientPhone(appointment.client_phone ?? "");
      setClientEmail(appointment.client_email ?? "");
      setClientBirth("");
      setClientNote("");
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
      setClientNote("");
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
    if (s) {
      setServiceName(s.name);
      setPrice(Number(s.price));
      if (s.duration) setDuration(Number(s.duration));
    }
  };

  const resetForAnother = () => {
    setClientId("");
    setClientName("");
    setClientFirstName("");
    setClientLastName("");
    setClientPhone("");
    setClientEmail("");
    setClientBirth("");
    setClientNote("");
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

    const payload: Record<string, unknown> = {
      business_id: businessId,
      full_name: fullName,
      phone: clientPhone.trim() || null,
      email: clientEmail.trim() || null,
      birth_date: clientBirth || null,
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

      for (const date of dates) {
        await saveAppointment({
          id: isEdit ? appointment?.id ?? null : null,
          business_id: businessId,
          client_id: resolvedClientId || null,
          client_name: fullClientName,
          client_phone: clientPhone.trim() || null,
          client_email: clientEmail.trim() || null,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-3">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div>
              <DialogTitle>{isEdit ? "Editar reserva" : "Nueva reserva"}</DialogTitle>
              <DialogDescription>
                Cargá fecha, cliente, profesional y servicio para crear un turno real en Agenda.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-6 py-2">
          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /> Fecha y hora</h3>
                <p className="text-xs text-muted-foreground capitalize mt-1">{formatReadableDate(dateValue)}</p>
              </div>
              {!isEdit && (
                <Button type="button" variant="outline" size="sm" onClick={() => setRepeatOpen(true)}>
                  <Repeat2 className="h-4 w-4 mr-1" /> Repetir
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="grid gap-1.5 sm:col-span-1">
                <Label>Fecha</Label>
                <Input type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Hora</Label>
                <Select value={hourValue} onValueChange={setHourValue}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {hourOptions.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Minutos</Label>
                <Select value={minuteValue} onValueChange={setMinuteValue}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {minuteOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {repeat.enabled && !isEdit && (
              <Badge variant="secondary" className="w-fit">
                Repite {repeat.weekdays.length} día(s)
              </Badge>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Cliente</h3>
              <Button type="button" variant="outline" size="sm" onClick={() => { setNewClientMode(true); setClientId(""); setClientSearch(""); setClientName(""); }}>
                <UserPlus className="h-4 w-4 mr-1" /> Nuevo cliente
              </Button>
            </div>

            {!newClientMode && (
              <div className="grid gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    className="pl-8 pr-8"
                    placeholder="Buscar por nombre, apellido, teléfono o email"
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

                {showClientList && filteredClients.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-popover shadow-xl overflow-hidden max-h-48 overflow-y-auto">
                    {filteredClients.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left px-3 py-2.5 hover:bg-white/[0.05] transition flex items-center gap-2 border-b border-white/5 last:border-0"
                        onClick={() => pickClient(c)}
                      >
                        <div className="h-7 w-7 rounded-full bg-primary/20 ring-1 ring-primary/30 grid place-items-center text-xs font-semibold text-primary shrink-0">
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

                {clientId && (
                  <div className="flex items-center gap-2 rounded-lg bg-primary/10 ring-1 ring-primary/20 px-3 py-2">
                    <span className="text-sm font-medium flex-1">{clientName}</span>
                    {clientPhone && <span className="text-xs text-muted-foreground">{clientPhone}</span>}
                    <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setClientId(""); setClientName(""); setClientPhone(""); setClientSearch(""); }}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {newClientMode && (
              <div className="grid gap-3 rounded-xl bg-black/10 p-3 border border-white/10">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>Nombre *</Label>
                    <Input value={clientFirstName} onChange={(e) => setClientFirstName(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Apellido *</Label>
                    <Input value={clientLastName} onChange={(e) => setClientLastName(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="grid gap-1.5"><Label>Email</Label><Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} /></div>
                  <div className="grid gap-1.5"><Label>Teléfono</Label><Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} /></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="grid gap-1.5"><Label>Fecha de nacimiento</Label><Input type="date" value={clientBirth} onChange={(e) => setClientBirth(e.target.value)} /></div>
                  <div className="grid gap-1.5"><Label>Nota</Label><Input value={clientNote} onChange={(e) => setClientNote(e.target.value)} placeholder="Opcional" /></div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
            <h3 className="text-sm font-semibold">Profesional y servicio</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Profesional</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger><SelectValue placeholder="Elegí profesional" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.full_name ?? e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Servicio</Label>
                <Select value={serviceId} onValueChange={pickService}>
                  <SelectTrigger><SelectValue placeholder="Elegí servicio" /></SelectTrigger>
                  <SelectContent>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name} — ${Math.round(s.price).toLocaleString("es-AR")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>Precio</Label><Input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} /></div>
            </div>
            {requiresDeposit && (
              <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm">
                🟡 Este servicio requiere seña. Seña pendiente: ${Math.round(depositAmount).toLocaleString("es-AR")}
              </div>
            )}
            {isEdit && (
              <div className="grid gap-1.5">
                <Label>Estado del turno</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as ApptStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pendiente</SelectItem>
                    <SelectItem value="confirmed">Confirmado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </section>

          <details className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <summary className="cursor-pointer text-sm font-semibold">Información adicional</summary>
            <div className="grid gap-3 mt-4">
              <div className="grid gap-1.5">
                <Label>Nota del turno</Label>
                <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: Prefiere degradado bajo" />
              </div>
              <div className="grid gap-1.5">
                <Label>Observaciones internas</Label>
                <Textarea rows={3} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} placeholder="Solo para el equipo" />
              </div>
            </div>
          </details>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={() => submit(false)} disabled={busy}>
            {busy ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
            {isEdit ? "Guardar cambios" : "Guardar reserva"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <Dialog open={repeatOpen} onOpenChange={setRepeatOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Repetir turno</DialogTitle>
            <DialogDescription>Configurá los días y hasta cuándo se repite esta reserva.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-2">
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
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRepeatOpen(false)}>Cancelar</Button>
            <Button onClick={() => { setRepeat((r) => ({ ...r, enabled: true })); setRepeatOpen(false); }}>Aceptar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
