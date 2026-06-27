import * as React from "react";
import { toast } from "sonner";
import { UserX, X, Footprints, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REJECT_REASONS,
  reasonLabel,
  localDateISO,
  useRejectedByDay,
  useInsertRejectedClient,
  type RejectReason,
} from "@/hooks/use-rejected-clients";

// ── Shapes mínimos (no acoplar a los tipos completos de la agenda) ──────────
type ServiceLite = { id: string; name: string };
type EmployeeLite = { id: string; full_name?: string | null; name?: string | null; is_active?: boolean | null };
type ApptLite = { starts_at: string; status?: string | null; duration_min?: number | null };
type OpenHours = { start?: string | number | null; end?: string | number | null } | null;

// ── Helpers ─────────────────────────────────────────────────────────────────
function sameLocalDay(iso: string, d: Date): boolean {
  const x = new Date(iso);
  return (
    x.getFullYear() === d.getFullYear() &&
    x.getMonth() === d.getMonth() &&
    x.getDate() === d.getDate()
  );
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

/** Cuenta turnos no cancelados de un día. */
function dayAppointmentsOf(appointments: ApptLite[], date: Date): ApptLite[] {
  return appointments.filter((a) => a.status !== "cancelled" && sameLocalDay(a.starts_at, date));
}

/** Snapshot de la agenda en el momento del rechazo. */
function computeSnapshot(
  appointments: ApptLite[],
  date: Date,
  employees: EmployeeLite[],
  openHours: OpenHours,
): { dayAppointments: number; workingProfessionals: number; occupancyPct: number | null } {
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
  // "13:10:00" → "13:10"
  return time.slice(0, 5);
}

// ════════════════════════════════════════════════════════════════════════════
// Botón "+ Cliente rechazado" + modal de captura rápida
// ════════════════════════════════════════════════════════════════════════════
export function RejectedClientControl({
  businessId,
  services,
  employees,
  appointments,
  openHours,
  className,
}: {
  businessId: string | null | undefined;
  services: ServiceLite[];
  employees: EmployeeLite[];
  appointments: ApptLite[];
  openHours: OpenHours;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const insert = useInsertRejectedClient(businessId);
  const actives = React.useMemo(() => activeEmployees(employees), [employees]);

  const [serviceId, setServiceId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState<RejectReason>("sin_turnos");
  const [employeeId, setEmployeeId] = React.useState<string | null>(null);

  function reset() {
    setServiceId(services[0]?.id ?? null);
    setReason("sin_turnos");
    setEmployeeId(null);
  }

  function openModal() {
    reset();
    setOpen(true);
  }

  async function save() {
    if (!businessId) {
      toast.error("No hay un negocio activo.");
      return;
    }
    const svc = services.find((s) => s.id === serviceId) ?? null;
    const emp = reason === "profesional" ? actives.find((e) => e.id === employeeId) ?? null : null;
    // El rechazo se registra AHORA (no en la fecha que estás mirando).
    const now = new Date();
    const snap = computeSnapshot(appointments, now, employees, openHours);
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
      setOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo registrar.";
      toast.error(`No se pudo registrar: ${msg}`);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-rose-200/90 ring-1 ring-rose-400/25 bg-rose-500/10 transition hover:bg-rose-500/15 shrink-0",
          className,
        )}
        title="Registrar un cliente que llegó sin turno y no pudo ser atendido"
      >
        <UserX className="h-3.5 w-3.5" />
        <span className="whitespace-nowrap">Cliente rechazado</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="fixed inset-0 z-[81] grid place-items-center p-4" onClick={() => setOpen(false)}>
            <div
              className="w-full max-w-md rounded-2xl bg-background ring-1 ring-white/10 shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
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
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-1.5 text-white/50 transition hover:bg-white/5 hover:text-white"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 px-5 py-4">
                {/* Servicio solicitado */}
                <div>
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/40">
                    Servicio solicitado
                  </div>
                  {services.length === 0 ? (
                    <div className="rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm text-white/50">
                      No hay servicios cargados.
                    </div>
                  ) : (
                    <select
                      value={serviceId ?? ""}
                      onChange={(e) => setServiceId(e.target.value || null)}
                      className="w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-rose-400/40"
                    >
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Motivo del rechazo */}
                <div>
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/40">
                    Motivo del rechazo
                  </div>
                  <div className="grid gap-1.5">
                    {REJECT_REASONS.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => setReason(r.key)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition",
                          reason === r.key
                            ? "border-rose-400/40 bg-rose-500/[0.1] text-white"
                            : "border-white/10 bg-white/[0.03] text-white/65 hover:border-white/20",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-4 w-4 shrink-0 place-items-center rounded-full ring-1",
                            reason === r.key ? "ring-rose-300/70" : "ring-white/25",
                          )}
                        >
                          {reason === r.key && <span className="h-2 w-2 rounded-full bg-rose-300" />}
                        </span>
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Profesional solicitado — solo si reason = profesional */}
                {reason === "profesional" && (
                  <div>
                    <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/40">
                      Profesional solicitado
                    </div>
                    {actives.length === 0 ? (
                      <div className="rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm text-white/50">
                        No hay profesionales activos.
                      </div>
                    ) : (
                      <select
                        value={employeeId ?? ""}
                        onChange={(e) => setEmployeeId(e.target.value || null)}
                        className="w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-rose-400/40"
                      >
                        <option value="">Elegí un profesional…</option>
                        {actives.map((e) => (
                          <option key={e.id} value={e.id}>
                            {empName(e)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-white/8 px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-3.5 py-2 text-sm font-medium text-white/60 transition hover:text-white"
                >
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
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tarjeta "🚶 Orden de llegada" (Atendidos / Rechazados) + historial del día
// ════════════════════════════════════════════════════════════════════════════
export function OrderOfArrivalCard({
  businessId,
  appointments,
  date,
  className,
}: {
  businessId: string | null | undefined;
  appointments: ApptLite[];
  date: Date;
  className?: string;
}) {
  const dateISO = localDateISO(date);
  const { data: rejected = [] } = useRejectedByDay(businessId, dateISO);
  const [histOpen, setHistOpen] = React.useState(false);

  const attended = React.useMemo(() => dayAppointmentsOf(appointments, date).length, [appointments, date]);
  const rejectedCount = rejected.length;

  return (
    <>
      <div
        className={cn(
          "glass flex items-center gap-3 rounded-xl px-3 py-1.5 animate-fade-up",
          className,
        )}
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-white/70 shrink-0">
          <Footprints className="h-3.5 w-3.5 text-white/50" />
          Orden de llegada
        </span>
        <div className="h-4 w-px bg-white/10" />
        <span className="inline-flex items-center gap-1.5 text-xs text-white/60">
          <span className="font-bold tabular-nums text-emerald-300">{attended}</span>
          Atendidos
        </span>
        <button
          type="button"
          onClick={() => rejectedCount > 0 && setHistOpen(true)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs transition",
            rejectedCount > 0 ? "text-rose-200/90 hover:bg-rose-500/10" : "text-white/40 cursor-default",
          )}
          title={rejectedCount > 0 ? "Ver el historial del día" : "Sin rechazos hoy"}
        >
          <span className="font-bold tabular-nums text-rose-300">{rejectedCount}</span>
          Rechazados
          {rejectedCount > 0 && <ChevronRight className="h-3.5 w-3.5 opacity-60" />}
        </button>
      </div>

      {histOpen && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-sm" onClick={() => setHistOpen(false)} />
          <div className="fixed inset-0 z-[81] grid place-items-center p-4" onClick={() => setHistOpen(false)}>
            <div
              className="w-full max-w-md rounded-2xl bg-background ring-1 ring-white/10 shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 border-b border-white/8 px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/8 text-base ring-1 ring-white/10">
                    🚶
                  </span>
                  <div>
                    <div className="text-sm font-bold text-white">Clientes rechazados</div>
                    <div className="text-[11px] text-white/45">
                      {rejectedCount} {rejectedCount === 1 ? "rechazo" : "rechazos"} este día
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setHistOpen(false)}
                  className="rounded-full p-1.5 text-white/50 transition hover:bg-white/5 hover:text-white"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[60vh] space-y-1.5 overflow-y-auto p-3">
                {rejected.map((r) => {
                  const motivo =
                    r.reason === "profesional" && r.requested_employee_name
                      ? `Quería a ${r.requested_employee_name}`
                      : reasonLabel(r.reason);
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 rounded-xl bg-white/[0.03] ring-1 ring-white/8 px-3 py-2 text-sm"
                    >
                      <span className="font-semibold tabular-nums text-white/80 shrink-0">
                        {hhmm(r.rejected_time)}
                      </span>
                      <span className="text-white/30">·</span>
                      <span className="truncate text-white/85">{r.service_name ?? "Servicio"}</span>
                      <span className="text-white/30">·</span>
                      <span className="truncate text-rose-200/80">{motivo}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
