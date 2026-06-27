import * as React from "react";
import { toast } from "sonner";
import { UserX, X, ChevronDown, Calendar as CalIcon, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { DarkCalendar } from "@/components/agenda/dark-calendar";
import {
  REJECT_REASONS,
  reasonLabel,
  localDateISO,
  useRejectedByDay,
  useInsertRejectedClient,
  type RejectReason,
} from "@/hooks/use-rejected-clients";
import { useRejectedAnalytics } from "@/hooks/use-rejected-analytics";

// ── Shapes mínimos ──────────────────────────────────────────────────────────
type ServiceLite = { id: string; name: string; price?: number | null };
type EmployeeLite = { id: string; full_name?: string | null; name?: string | null; is_active?: boolean | null };
type ApptLite = { starts_at: string; status?: string | null; duration_min?: number | null };
type OpenHours = { start?: string | number | null; end?: string | number | null } | null;

// ── Helpers ─────────────────────────────────────────────────────────────────
function sameLocalDay(iso: string, d: Date): boolean {
  const x = new Date(iso);
  return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate();
}
function parseHM(v: string | number): number {
  if (typeof v === "number") return v;
  const [h, m] = String(v).split(":").map(Number);
  return (h || 0) + (m || 0) / 60;
}
function empName(e: EmployeeLite): string {
  return (e.full_name || e.name || "Profesional").trim();
}
function activeEmployees(employees: EmployeeLite[]): EmployeeLite[] {
  return employees.filter((e) => e.is_active !== false);
}
function dayAppointmentsOf(appointments: ApptLite[], date: Date): ApptLite[] {
  return appointments.filter((a) => a.status !== "cancelled" && sameLocalDay(a.starts_at, date));
}
function computeSnapshot(appointments: ApptLite[], date: Date, employees: EmployeeLite[], openHours: OpenHours) {
  const day = dayAppointmentsOf(appointments, date);
  const dayAppointments = day.length;
  const workingProfessionals = activeEmployees(employees).length;
  let occupancyPct: number | null = null;
  if (openHours && openHours.start != null && openHours.end != null && workingProfessionals > 0) {
    const openMin = Math.max(0, (parseHM(openHours.end) - parseHM(openHours.start)) * 60);
    if (openMin > 0) {
      const bookedMin = day.reduce((s, a) => s + (a.duration_min ?? 30), 0);
      occupancyPct = Math.min(100, Math.round((bookedMin / (workingProfessionals * openMin)) * 100));
    }
  }
  return { dayAppointments, workingProfessionals, occupancyPct };
}
function hhmm(time: string): string {
  return time.slice(0, 5);
}
function fmtARS(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}
function fmtDMY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// ════════════════════════════════════════════════════════════════════════════
// Modal de captura rápida (se abre desde el menú + de la Agenda) — < 5 segundos
// ════════════════════════════════════════════════════════════════════════════
export function RejectedClientCaptureModal({
  open,
  onClose,
  businessId,
  services,
  employees,
  appointments,
  openHoursToday,
}: {
  open: boolean;
  onClose: () => void;
  businessId: string | null | undefined;
  services: ServiceLite[];
  employees: EmployeeLite[];
  appointments: ApptLite[];
  openHoursToday: OpenHours;
}) {
  const insert = useInsertRejectedClient(businessId);
  const actives = React.useMemo(() => activeEmployees(employees), [employees]);

  const [serviceId, setServiceId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState<RejectReason>("sin_turnos");
  const [employeeId, setEmployeeId] = React.useState<string | null>(null);

  // Reset cada vez que se abre
  React.useEffect(() => {
    if (open) {
      setServiceId(services[0]?.id ?? null);
      setReason("sin_turnos");
      setEmployeeId(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  async function save() {
    if (!businessId) {
      toast.error("No hay un negocio activo.");
      return;
    }
    const svc = services.find((s) => s.id === serviceId) ?? null;
    const emp = reason === "profesional" ? actives.find((e) => e.id === employeeId) ?? null : null;
    const now = new Date();
    const snap = computeSnapshot(appointments, now, employees, openHoursToday);
    try {
      await insert.mutateAsync({
        service_id: svc?.id ?? null,
        service_name: svc?.name ?? null,
        reason,
        requested_employee_id: emp?.id ?? null,
        requested_employee_name: emp ? empName(emp) : null,
        occupancy_pct: snap.occupancyPct,
        working_professionals: snap.workingProfessionals,
        day_appointments: snap.dayAppointments,
        at: now,
      });
      toast.success("Cliente rechazado registrado");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo registrar.";
      toast.error(`No se pudo registrar: ${msg}`);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[81] grid place-items-center p-4" onClick={onClose}>
        <div className="w-full max-w-md overflow-hidden rounded-2xl bg-background shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-2 border-b border-white/8 px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-rose-500/12 text-rose-200 ring-1 ring-rose-400/25">
                <UserX className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-bold text-white">Cliente rechazado</div>
                <div className="text-[11px] text-white/45">Sin datos del cliente · solo demanda</div>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-full p-1.5 text-white/50 transition hover:bg-white/5 hover:text-white" aria-label="Cerrar">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div>
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/40">Servicio solicitado</div>
              {services.length === 0 ? (
                <div className="rounded-xl bg-white/5 px-3 py-2 text-sm text-white/50 ring-1 ring-white/10">No hay servicios cargados.</div>
              ) : (
                <select
                  value={serviceId ?? ""}
                  onChange={(e) => setServiceId(e.target.value || null)}
                  className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-foreground ring-1 ring-white/10 focus:outline-none focus:ring-rose-400/40"
                >
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/40">Motivo del rechazo</div>
              <div className="grid gap-1.5">
                {REJECT_REASONS.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setReason(r.key)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition",
                      reason === r.key ? "border-rose-400/40 bg-rose-500/[0.1] text-white" : "border-white/10 bg-white/[0.03] text-white/65 hover:border-white/20",
                    )}
                  >
                    <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full ring-1", reason === r.key ? "ring-rose-300/70" : "ring-white/25")}>
                      {reason === r.key && <span className="h-2 w-2 rounded-full bg-rose-300" />}
                    </span>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {reason === "profesional" && (
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/40">Profesional solicitado</div>
                {actives.length === 0 ? (
                  <div className="rounded-xl bg-white/5 px-3 py-2 text-sm text-white/50 ring-1 ring-white/10">No hay profesionales activos.</div>
                ) : (
                  <select
                    value={employeeId ?? ""}
                    onChange={(e) => setEmployeeId(e.target.value || null)}
                    className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-foreground ring-1 ring-white/10 focus:outline-none focus:ring-rose-400/40"
                  >
                    <option value="">Elegí un profesional…</option>
                    {actives.map((e) => (
                      <option key={e.id} value={e.id}>{empName(e)}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-white/8 px-5 py-3.5">
            <button type="button" onClick={onClose} className="rounded-xl px-3.5 py-2 text-sm font-medium text-white/60 transition hover:text-white">
              Cancelar
            </button>
            <button
              type="button"
              onClick={save}
              disabled={insert.isPending}
              className="rounded-xl bg-gradient-to-r from-rose-500 to-rose-400 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_30px_-12px_rgba(244,63,94,0.8)] transition hover:brightness-110 disabled:opacity-50"
            >
              {insert.isPending ? "Registrando…" : "Registrar"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Pill "Cliente rechazado" → Panel de CONSULTA (resumen + historial)
// ════════════════════════════════════════════════════════════════════════════
export function RejectedClientsButton({ businessId, className }: { businessId: string | null | undefined; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const [pickedDay, setPickedDay] = React.useState<Date>(() => new Date());
  const [calOpen, setCalOpen] = React.useState(false);
  const pickedISO = localDateISO(pickedDay);

  const { analytics } = useRejectedAnalytics(businessId);
  const { data: pickedRejected = [] } = useRejectedByDay(businessId, pickedISO);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-200/90 ring-1 ring-rose-400/25 transition hover:bg-rose-500/15 shrink-0",
          className,
        )}
        title="Clientes rechazados — consulta"
      >
        <UserX className="h-3.5 w-3.5" />
        <span className="whitespace-nowrap">Rechazados</span>
        {analytics.counts.today > 0 && (
          <span className="ml-0.5 rounded-full bg-rose-500/25 px-1.5 text-[10px] font-bold tabular-nums text-rose-100">{analytics.counts.today}</span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="fixed inset-0 z-[81] grid place-items-center p-4" onClick={() => setOpen(false)}>
            <div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-background shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between gap-2 border-b border-white/8 px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-rose-500/12 text-rose-200 ring-1 ring-rose-400/25">
                    <UserX className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-sm font-bold text-white">Clientes rechazados</div>
                    <div className="text-[11px] text-white/45">Consulta — demanda no atendida</div>
                  </div>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1.5 text-white/50 transition hover:bg-white/5 hover:text-white" aria-label="Cerrar">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-5 overflow-y-auto px-5 py-4">
                {/* Resumen */}
                <div>
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/40">Resumen</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                      <div className="text-2xl font-extrabold tabular-nums text-rose-300">{analytics.counts.today}</div>
                      <div className="mt-0.5 text-[11px] leading-tight text-white/45">Rechazados hoy</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                      <div className="text-2xl font-extrabold tabular-nums text-white">{analytics.counts.month}</div>
                      <div className="mt-0.5 text-[11px] leading-tight text-white/45">Este mes</div>
                    </div>
                    <div className="rounded-xl border border-amber-300/15 bg-amber-500/[0.05] px-3 py-3">
                      <div className="flex items-center gap-1 text-lg font-extrabold tabular-nums text-amber-300">
                        <TrendingDown className="h-3.5 w-3.5" />
                        {fmtARS(analytics.lostRevenue.month)}
                      </div>
                      <div className="mt-0.5 text-[11px] leading-tight text-white/45">Facturación perdida</div>
                    </div>
                  </div>
                </div>

                {/* Historial */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-white/40">Historial</span>
                    {/* Selector de fecha compacto */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setCalOpen((v) => !v)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/80 ring-1 ring-white/10 transition hover:bg-white/10"
                      >
                        <CalIcon className="h-3.5 w-3.5 text-white/50" />
                        {fmtDMY(pickedDay)}
                        <ChevronDown className="h-3.5 w-3.5 text-white/40" />
                      </button>
                      {calOpen && (
                        <>
                          <div className="fixed inset-0 z-[82]" onClick={() => setCalOpen(false)} />
                          <div className="absolute right-0 z-[83] mt-1">
                            <DarkCalendar
                              value={pickedDay}
                              onSelect={(d) => {
                                setPickedDay(d);
                                setCalOpen(false);
                              }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {pickedRejected.length === 0 ? (
                    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-6 text-center text-xs text-white/40">
                      Sin clientes rechazados este día.
                    </div>
                  ) : (
                    <div className="max-h-[280px] space-y-1.5 overflow-y-auto pr-1">
                      {pickedRejected.map((r) => {
                        const motivo =
                          r.reason === "profesional" && r.requested_employee_name
                            ? `Quería a ${r.requested_employee_name}`
                            : reasonLabel(r.reason);
                        return (
                          <div key={r.id} className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-sm ring-1 ring-white/8">
                            <span className="shrink-0 font-semibold tabular-nums text-white/80">{hhmm(r.rejected_time)}</span>
                            <span className="text-white/30">·</span>
                            <span className="truncate text-white/85">{r.service_name ?? "Servicio"}</span>
                            <span className="text-white/30">·</span>
                            <span className="truncate text-rose-200/80">{motivo}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
