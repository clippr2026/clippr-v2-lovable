import * as React from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { UserX, X, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REJECT_REASONS,
  reasonLabel,
  localDateISO,
  useRejectedByDay,
  useInsertRejectedClient,
  type RejectReason,
} from "@/hooks/use-rejected-clients";

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
  initialAt,
}: {
  open: boolean;
  onClose: () => void;
  businessId: string | null | undefined;
  services: ServiceLite[];
  employees: EmployeeLite[];
  appointments: ApptLite[];
  openHoursToday: OpenHours;
  initialAt?: Date | null;
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
  if (typeof document === "undefined") return null;

  async function save() {
    if (!businessId) {
      toast.error("No hay un negocio activo.");
      return;
    }
    const svc = services.find((s) => s.id === serviceId) ?? null;
    const emp = reason === "profesional" ? actives.find((e) => e.id === employeeId) ?? null : null;
    const now = initialAt ?? new Date();
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
      toast.success("Cliente no atendido registrado");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo registrar.";
      toast.error(`No se pudo registrar: ${msg}`);
    }
  }

  // createPortal a document.body: este modal se abre dentro de <AppShell>,
  // que envuelve la página en un <div className="relative z-10">. Sin
  // portal, ese wrapper crea su propio stacking context y el modal queda
  // atrapado compitiendo solo contra sus hermanos ahí adentro, nunca contra
  // la barra inferior de navegación (fixed, z-40, hermana de <main> en el
  // árbol raíz) — sin importar el z-index que tenga.
  return createPortal(
    <>
      <div className="fixed inset-0 z-[110] bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[111] grid place-items-center p-4" onClick={onClose}>
        <div className="w-full max-w-md overflow-hidden rounded-2xl bg-background shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-2 border-b border-white/8 px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-rose-500/12 text-rose-200 ring-1 ring-rose-400/25">
                <UserX className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-bold text-white">Cliente no atendido</div>
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
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/40">Motivo</div>
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
    </>,
    document.body,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Ficha "No atendidos" → Panel de CONSULTA (resumen + historial)
// ════════════════════════════════════════════════════════════════════════════
export function RejectedClientsButton({
  businessId,
  date,
  services,
  className,
  compact = false,
  onRegisterNew,
}: {
  businessId: string | null | undefined;
  date: Date;
  services: ServiceLite[];
  className?: string;
  // Layout apilado (conteo arriba, label abajo) que ocupa todo el ancho/alto
  // disponible — para usarse dentro de una grilla de celdas parejas (ej. la
  // grilla de estados de Agenda en mobile), en vez del pill horizontal.
  compact?: boolean;
  // Abre el formulario de captura (RejectedClientCaptureModal), que vive
  // fuera de este componente — ver botón "+ Registrar cliente no atendido".
  onRegisterNew: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const dayISO = localDateISO(date);
  const { data: dayRejected = [] } = useRejectedByDay(businessId, dayISO);

  const lostToday = React.useMemo(() => {
    const priceById = new Map(services.map((s) => [s.id, Number(s.price ?? 0)]));
    return dayRejected.reduce((sum, r) => sum + (r.service_id ? priceById.get(r.service_id) ?? 0 : 0), 0);
  }, [dayRejected, services]);

  // Al abrir: arrancar siempre scrolleado arriba (el body puede haber
  // quedado con scroll de una apertura anterior) y bloquear el scroll de
  // la página de fondo para que no interfiera con el del modal.
  React.useEffect(() => {
    if (!open) return;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          compact
            ? "flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-center transition-all active:brightness-110"
            : "inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium transition-all hover:brightness-110",
          className,
        )}
        style={{
          background: "rgba(245, 158, 11, 0.14)",
          boxShadow: "0 0 0 1px rgba(245, 158, 11, 0.35)",
          color: "#FBBF24",
        }}
        title="Clientes no atendidos del día"
      >
        <span className={compact ? "font-semibold tabular-nums text-sm leading-none" : "font-semibold tabular-nums text-sm"}>
          {dayRejected.length}
        </span>
        <span className={compact ? "text-[10px] leading-tight opacity-80 truncate max-w-full" : "opacity-80"}>
          No atendidos
        </span>
      </button>

      {/* createPortal: este modal se abre dentro de <AppShell>, que envuelve
          la página en un <div className="relative z-10">. Sin portal, ese
          wrapper crea su propio stacking context y el modal queda atrapado
          compitiendo solo contra sus hermanos ahí adentro, nunca contra la
          barra inferior de navegación (fixed, z-40, hermana de <main> en el
          árbol raíz) — sin importar el z-index que tenga. */}
      {open && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[110] bg-black/55 backdrop-blur-sm" onClick={() => setOpen(false)} />
          {/* Mobile: hoja de pantalla completa (h-full de un fixed inset-0,
              no vh) para que el header con la X nunca quede fuera de la
              viewport visible, sin depender de cálculos de vh/dvh con la
              barra de Safari. Desktop (sm+): diálogo centrado clásico. */}
          <div
            className="fixed inset-0 z-[111] flex sm:grid sm:place-items-center sm:p-4"
            onClick={() => setOpen(false)}
          >
            <div
              className="flex h-full w-full flex-col overflow-hidden bg-background shadow-2xl ring-1 ring-white/10 sm:h-auto sm:max-h-[88vh] sm:max-w-md sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header fijo — shrink-0 dentro del flex-col, nunca scrollea.
                  Respeta el notch/isla dinámica de iPhone. */}
              <div
                className="flex shrink-0 items-center justify-between gap-2 border-b border-white/8 px-3.5 py-3 sm:px-5 sm:py-3.5"
                style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
              >
                <div className="min-w-0 flex-1 truncate text-[13px] font-bold text-white sm:text-sm">
                  Clientes no atendidos
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/50 transition hover:bg-white/5 hover:text-white sm:h-8 sm:w-8"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Único contenedor con scroll — overscroll-contain evita que
                  el "rebote" del scroll se propague a la página de fondo. */}
              <div
                ref={scrollRef}
                className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4"
                style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
              >
                <div>
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/40">Resumen del día</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                      <div className="text-2xl font-extrabold tabular-nums text-amber-300">{dayRejected.length}</div>
                      <div className="mt-0.5 text-[11px] leading-tight text-white/45">Clientes no atendidos</div>
                    </div>
                    <div className="rounded-xl border border-amber-300/25 bg-amber-500/[0.08] px-3 py-3 shadow-[0_0_28px_-14px_rgba(245,158,11,0.55)]">
                      <div className="text-3xl font-extrabold tabular-nums text-amber-300">{fmtARS(lostToday)}</div>
                      <div className="mt-0.5 text-[11px] leading-tight text-white/50">Ingresos potenciales perdidos</div>
                    </div>
                  </div>
                </div>

                {/* Única explicación de la feature — breve, sin duplicarla en
                    ningún tooltip. */}
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-sm leading-6 text-white/55">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-white/80">
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    ¿Qué es un cliente no atendido?
                  </div>
                  <p>
                    Es una persona que quiso atenderse pero no pudo concretar un turno por falta de
                    disponibilidad, horarios ocupados, precio u otros motivos.
                  </p>
                  <p className="mt-2">
                    Clippr utiliza esta información para medir demanda que el negocio no pudo absorber
                    y detectar oportunidades de mejora.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onRegisterNew();
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-500/15 px-4 py-2.5 text-sm font-semibold text-amber-200 ring-1 ring-amber-400/30 transition hover:bg-amber-500/20"
                >
                  <UserX className="h-4 w-4" />
                  Registrar cliente no atendido
                </button>

                {dayRejected.length > 0 && (
                  <div>
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/40">Detalle del día</div>
                    <div className="max-h-[280px] space-y-1.5 overflow-y-auto pr-1">
                      {dayRejected.map((r) => {
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
                            <span className="truncate text-amber-200/80">{motivo}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
