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
import { Loader2, Search, X, CalendarDays, Repeat2,
  Scissors, UserPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  saveAppointment,
  checkOverlap,
  checkSchedule,
  type Appointment,
  type ApptStatus,
  type Client,
  type Employee,
  type Service,
} from "./use-agenda-data";
import { useClientesConfig } from "@/hooks/use-clientes-config";

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

// Inline date picker — no native calendar ───────────────────────────────────
function AppointmentDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [viewMonth, setViewMonth] = React.useState(() => {
    if (value) { const d = new Date(value + "T12:00:00"); return { m: d.getMonth(), y: d.getFullYear() }; }
    return { m: new Date().getMonth(), y: new Date().getFullYear() };
  });
  const ref = React.useRef<HTMLDivElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  React.useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open]);

  const daysInMonth = new Date(viewMonth.y, viewMonth.m + 1, 0).getDate();
  const firstDow = (new Date(viewMonth.y, viewMonth.m, 1).getDay() + 6) % 7;
  const cells: (string | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${viewMonth.y}-${String(viewMonth.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push(iso);
  }
  const monthLabel = new Date(viewMonth.y, viewMonth.m, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  const DOW = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

  const displayValue = value
    ? new Date(value + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : "Seleccioná una fecha";

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background hover:bg-accent transition text-left">
        <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className={value ? "text-foreground capitalize" : "text-muted-foreground"}>{displayValue}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-72 rounded-2xl bg-[oklch(0.10_0.03_275)] ring-1 ring-white/10 shadow-2xl p-3">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setViewMonth(v => v.m === 0 ? { m: 11, y: v.y - 1 } : { m: v.m - 1, y: v.y })}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-semibold capitalize">{monthLabel}</span>
            <button type="button" onClick={() => setViewMonth(v => v.m === 11 ? { m: 0, y: v.y + 1 } : { m: v.m + 1, y: v.y })}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-px mb-1">
            {DOW.map(d => <div key={d} className="text-center text-[10px] text-muted-foreground/50 py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-px">
            {cells.map((iso, i) => {
              if (!iso) return <div key={i} />;
              const sel = iso === value;
              const isT = iso === today;
              return (
                <button key={iso} type="button" onClick={() => { onChange(iso); setOpen(false); }}
                  className={cn("h-8 w-full rounded-lg text-xs font-medium transition-all",
                    sel && "text-white",
                    !sel && isT && "ring-1 ring-primary text-primary",
                    !sel && !isT && "text-foreground hover:bg-white/[0.08]"
                  )}
                  style={sel ? { background: "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))" } : undefined}
                >
                  {new Date(iso + "T12:00:00").getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
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
}: Props) {
  const isEdit = !!appointment?.id;
  const [busy, setBusy] = React.useState(false);
  const [repeatOpen, setRepeatOpen] = React.useState(false);

  // Client config — controls which fields appear in "nuevo cliente"
  const { isFieldEnabled } = useClientesConfig(businessId ?? null);

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
      setClientPhone("");
      setClientEmail("");
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

    const extraNotes = clientNote.trim() || null;

    const payload: Record<string, unknown> = {
      business_id: businessId,
      full_name: fullName,
      phone: clientPhone.trim() || null,
      email: clientEmail.trim() || null,
      birth_date: clientBirth.trim() || null,
      notes: extraNotes,
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

      // ── Schedule validation ───────────────────────────────────────────────
      for (const date of dates) {
        const schedErr = checkSchedule(schedule, date, Number(duration) || 30);
        if (schedErr) {
          toast.error(schedErr);
          setBusy(false);
          return;
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Overlap validation ────────────────────────────────────────────────
      if (employeeId) {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader className="space-y-1 pb-1">
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle>{isEdit ? "Editar reserva" : "Nueva reserva"}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="grid gap-3 py-1">
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
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <AppointmentDatePicker value={dateValue} onChange={setDateValue} />
              </div>
              <div>
                <Select value={hourValue} onValueChange={setHourValue}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {hourOptions.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Select value={minuteValue} onValueChange={setMinuteValue}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {minuteOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
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
              <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => { setNewClientMode(true); setClientId(""); setClientSearch(""); setClientName(""); }}>
                <UserPlus className="h-3.5 w-3.5 mr-1" /> Nuevo
              </Button>
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
                {isFieldEnabled("email") && <Input className="h-8 text-sm" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="Email" />}
                {isFieldEnabled("notas") && <Input className="h-8 text-sm" value={clientNote} onChange={(e) => setClientNote(e.target.value)} placeholder="Nota" />}
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground text-left transition" onClick={() => setNewClientMode(false)}>✕ Cancelar</button>
              </div>
            )}
          </section>

          {/* Profesional y servicio */}
          <section className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.03] p-3 space-y-3">
            <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider"><Scissors className="h-3.5 w-3.5 text-emerald-300" /> Profesional y servicio</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Profesional" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name ?? e.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={serviceId} onValueChange={pickService}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Servicio" /></SelectTrigger>
                <SelectContent>
                  {services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} — ${Math.round(s.price).toLocaleString("es-AR")}</SelectItem>)}
                </SelectContent>
              </Select>
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

          {/* Nota — simple, no details */}
          <div>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nota (opcional)" className="text-sm resize-none" />
          </div>
        </div>

        {/* Compact summary — only when enough data */}
        {(serviceName || previewClientName) && (
          <div className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2.5 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
            {serviceName && <span>Servicio: <span className="text-foreground font-medium">{serviceName}{price ? ` — $${Number(price).toLocaleString("es-AR")}` : ""}</span></span>}
            {previewClientName && <span>Cliente: <span className="text-foreground font-medium">{previewClientName}</span></span>}
            {employees.find(e => e.id === employeeId) && <span>Prof.: <span className="text-foreground font-medium">{employees.find(e => e.id === employeeId)?.full_name ?? ""}</span></span>}
            {dateValue && <span>Fecha: <span className="text-foreground font-medium">{dateValue} {hourValue}:{minuteValue}</span></span>}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2 pt-2">
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
