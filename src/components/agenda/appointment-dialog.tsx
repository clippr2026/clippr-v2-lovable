import * as React from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
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
import { Loader2 } from "lucide-react";
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

const STATUS_OPTIONS: { value: ApptStatus; label: string }[] = [
  { value: "pending", label: "Pendiente" },
  { value: "confirmed", label: "Confirmado" },
  { value: "completed", label: "Completado" },
  { value: "cancelled", label: "Cancelado" },
];

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
}: Props) {
  const isEdit = !!appointment?.id;
  const [busy, setBusy] = React.useState(false);

  const [clientId, setClientId] = React.useState<string>("");
  const [clientName, setClientName] = React.useState("");
  const [employeeId, setEmployeeId] = React.useState<string>("");
  const [serviceId, setServiceId] = React.useState<string>("");
  const [serviceName, setServiceName] = React.useState("");
  const [price, setPrice] = React.useState<number>(0);
  const [duration, setDuration] = React.useState<number>(30);
  const [startsAt, setStartsAt] = React.useState<string>("");
  const [status, setStatus] = React.useState<ApptStatus>("pending");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    if (appointment) {
      setClientId(appointment.client_id ?? "");
      setClientName(appointment.client_name ?? "");
      setEmployeeId(appointment.employee_id ?? "");
      setServiceId("");
      setServiceName(appointment.service_name ?? "");
      setPrice(Number(appointment.service_price ?? 0));
      setDuration(Number(appointment.duration_min ?? 30));
      setStartsAt(toLocalInputValue(new Date(appointment.starts_at)));
      setStatus(appointment.status);
      setNotes(appointment.notes ?? "");
    } else {
      setClientId("");
      setClientName("");
      setEmployeeId(defaultEmployeeId ?? employees[0]?.id ?? "");
      setServiceId("");
      setServiceName("");
      setPrice(0);
      setDuration(30);
      setStartsAt(toLocalInputValue(defaultStartsAt ?? new Date()));
      setStatus("pending");
      setNotes("");
    }
  }, [open, appointment, defaultEmployeeId, defaultStartsAt, employees]);

  const pickClient = (id: string) => {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (c) setClientName(c.full_name ?? c.name ?? "");
  };
  const pickService = (id: string) => {
    setServiceId(id);
    const s = services.find((x) => x.id === id);
    if (s) {
      setServiceName(s.name);
      setPrice(Number(s.price));
      if (s.duration) setDuration(Number(s.duration));
    }
  };

  const submit = async () => {
    if (!clientName.trim()) return toast.error("Indicá el nombre del cliente.");
    if (!serviceName.trim()) return toast.error("Elegí o escribí un servicio.");
    if (!startsAt) return toast.error("Falta la fecha y hora.");
    setBusy(true);
    try {
      await saveAppointment({
        id: appointment?.id ?? null,
        business_id: businessId,
        client_id: clientId || null,
        client_name: clientName.trim(),
        employee_id: employeeId || null,
        service_name: serviceName.trim(),
        service_price: Number(price) || 0,
        duration_min: Number(duration) || 30,
        starts_at: new Date(startsAt).toISOString(),
        status,
        notes: notes.trim() || null,
        created_by_name: createdByName,
        created_by_role: createdByRole,
      });
      toast.success(isEdit ? "Turno actualizado" : "Turno creado");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar turno" : "Nuevo turno"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 py-3">
          <div className="grid gap-1.5">
            <Label>Cliente</Label>
            <div className="flex gap-2">
              <Select value={clientId} onValueChange={pickClient}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Elegí cliente existente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name ?? c.name}
                      {c.phone ? ` · ${c.phone}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              placeholder="o escribí un nombre"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Profesional</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger>
                <SelectValue placeholder="Elegí profesional" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.full_name ?? e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Servicio</Label>
            <Select value={serviceId} onValueChange={pickService}>
              <SelectTrigger>
                <SelectValue placeholder="Elegí servicio" />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} — ${Math.round(s.price).toLocaleString("es-AR")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="o escribí el nombre del servicio"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Precio</Label>
              <Input
                type="number"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Duración (min)</Label>
              <Input
                type="number"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Fecha y hora</Label>
            <Input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Estado</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ApptStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Notas</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
            {isEdit ? "Guardar cambios" : "Crear turno"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
