import * as React from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { CalendarOff, X, Plus, Pencil, Trash2, AlertTriangle, ChevronDown } from "lucide-react";
import { ClosureDatePicker } from "@/components/agenda/closure-date-picker";
import {
  useClosures,
  useCreateClosure,
  useUpdateClosure,
  useDeleteClosure,
  useClosureAffectedAppointments,
  countAppointmentsInRange,
  type Closure,
} from "@/hooks/use-closures";

function fmtFecha(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtHora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}
function rangoLabel(c: Closure) {
  return c.start_date === c.end_date ? fmtFecha(c.start_date) : `${fmtFecha(c.start_date)} – ${fmtFecha(c.end_date)}`;
}

// Modal "Días cerrados" — se abre desde el botón "+" de Agenda (opción
// "Día cerrado"), no desde la fila de estados: un cierre no es un estado
// de turno, es una acción administrativa. Arriba "+ Agregar día cerrado",
// debajo "Próximos días cerrados" (hoy si está cerrado + futuros — nunca
// cierres ya pasados). Nunca cancela automáticamente los turnos que ya
// existan en el rango: si hay, se avisa la cantidad antes de confirmar,
// pero la decisión queda siempre en el usuario.
export function ClosuresModal({
  businessId,
  branchId,
  createdByName,
  onClose,
}: {
  businessId: string | null;
  branchId: string | null;
  createdByName: string | null;
  onClose: () => void;
}) {
  const { data: closures = [] } = useClosures(businessId, branchId);
  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const create = useCreateClosure(businessId, branchId);
  const update = useUpdateClosure(businessId, branchId);
  const del = useDeleteClosure(businessId, branchId);

  const upcoming = React.useMemo(() => {
    const today = new Date().toLocaleDateString("sv-SE");
    return closures
      .filter((c) => c.end_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [closures]);

  React.useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  if (typeof document === "undefined") return null;

  async function handleDelete(id: string) {
    try {
      await del.mutateAsync(id);
      toast.success("Día cerrado eliminado");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[110] bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[111] flex sm:grid sm:place-items-center sm:p-4" onClick={onClose}>
        <div
          className="flex h-full w-full flex-col overflow-hidden bg-background shadow-2xl ring-1 ring-white/10 sm:h-auto sm:max-h-[88vh] sm:max-w-md sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex shrink-0 items-center justify-between gap-2 border-b border-white/8 px-3.5 py-3 sm:px-5 sm:py-3.5"
            style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
          >
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-rose-500/12 text-rose-200 ring-1 ring-rose-400/25">
                <CalendarOff className="h-4 w-4" />
              </span>
              <div className="text-sm font-bold text-white">Días cerrados</div>
            </div>
            <button type="button" onClick={onClose} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/50 transition hover:bg-white/5 hover:text-white sm:h-8 sm:w-8" aria-label="Cerrar">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            {adding ? (
              // El selector abre limpio — ningún cierre existente se dibuja
              // acá adentro, solo la selección nueva que se está armando.
              <ClosureForm
                businessId={businessId}
                branchId={branchId}
                createdByName={createdByName}
                onCancel={() => setAdding(false)}
                onSubmit={async (input) => {
                  await create.mutateAsync({ ...input, created_by_name: createdByName });
                }}
                submitLabel="Guardar día cerrado"
                pendingLabel="Guardando…"
                onSaved={() => setAdding(false)}
              />
            ) : editingId ? (
              // Mismo criterio al editar: se oculta el resto de la lista,
              // queda solo el formulario de ESE cierre.
              <ClosureForm
                businessId={businessId}
                branchId={branchId}
                createdByName={createdByName}
                initial={upcoming.find((c) => c.id === editingId)}
                onCancel={() => setEditingId(null)}
                onSubmit={async (input) => {
                  await update.mutateAsync({ id: editingId, ...input });
                }}
                submitLabel="Guardar cambios"
                pendingLabel="Guardando…"
                onSaved={() => setEditingId(null)}
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-rose-500/12 px-4 py-2.5 text-sm font-semibold text-rose-200 ring-1 ring-rose-400/25 transition hover:bg-rose-500/18"
                >
                  <Plus className="h-4 w-4" />
                  Agregar día cerrado
                </button>

                <div>
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/40">
                    Próximos días cerrados
                  </div>
                  {upcoming.length === 0 ? (
                    <div className="rounded-xl bg-white/[0.03] px-3 py-4 text-center text-sm text-white/50 ring-1 ring-white/8">
                      No hay días cerrados próximos
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {upcoming.map((c) => (
                        <div key={c.id} className="rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm ring-1 ring-white/8">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-white/85">{rangoLabel(c)}</div>
                              {c.reason && <div className="truncate text-xs text-white/50">{c.reason}</div>}
                            </div>
                            <button
                              type="button"
                              onClick={() => setEditingId(c.id)}
                              className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
                              aria-label="Editar día cerrado"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(c.id)}
                              disabled={del.isPending}
                              className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-white/10 hover:text-rose-300 disabled:opacity-50"
                              aria-label="Eliminar día cerrado"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <ClosureAffectedWarning businessId={businessId} branchId={branchId} closure={c} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

// Aviso de solo lectura: turnos que ya existían antes de este cierre —
// nunca se tocan desde acá (ni se cancelan ni se editan), es para que el
// administrador pueda revisarlos y decidir si reprogramarlos o cancelarlos
// a mano (editando el turno donde corresponda, o achicando/borrando este
// cierre para volver a verlos en la Agenda operativa).
function ClosureAffectedWarning({
  businessId,
  branchId,
  closure,
}: {
  businessId: string | null;
  branchId: string | null;
  closure: Closure;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const { data: appts = [] } = useClosureAffectedAppointments(
    businessId,
    branchId,
    closure.id,
    closure.start_date,
    closure.end_date,
  );

  if (appts.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-left text-xs font-medium text-amber-200 ring-1 ring-amber-400/25 transition hover:bg-amber-500/15"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">
          Había {appts.length} turno{appts.length === 1 ? "" : "s"} agendado{appts.length === 1 ? "" : "s"} antes del cierre
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1">
          {appts.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-xs ring-1 ring-white/8">
              <span className="shrink-0 font-semibold tabular-nums text-white/80">
                {fmtFecha(a.starts_at.slice(0, 10))} {fmtHora(a.starts_at)}
              </span>
              <span className="text-white/30">·</span>
              <span className="truncate text-white/75">{a.client_name || "Cliente"}</span>
              <span className="text-white/30">·</span>
              <span className="truncate text-white/50">{a.service_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClosureForm({
  businessId,
  branchId,
  initial,
  onCancel,
  onSaved,
  onSubmit,
  submitLabel,
  pendingLabel,
}: {
  businessId: string | null;
  branchId: string | null;
  createdByName: string | null;
  initial?: Closure;
  onCancel: () => void;
  onSaved: () => void;
  onSubmit: (input: { start_date: string; end_date: string; reason: string | null }) => Promise<void>;
  submitLabel: string;
  pendingLabel: string;
}) {
  const today = new Date().toLocaleDateString("sv-SE");
  const [from, setFrom] = React.useState(initial?.start_date ?? today);
  const [to, setTo] = React.useState(initial?.end_date ?? today);
  const [reason, setReason] = React.useState(initial?.reason ?? "");
  const [warning, setWarning] = React.useState<number | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleConfirm() {
    if (!businessId) return;
    if (warning === null) {
      // Primer toque: chequea turnos existentes en el rango antes de dejar
      // confirmar — nunca los cancela, solo avisa la cantidad.
      setChecking(true);
      try {
        const count = await countAppointmentsInRange(businessId, branchId, from, to);
        setChecking(false);
        if (count > 0) {
          setWarning(count);
          return;
        }
      } catch (e) {
        setChecking(false);
        toast.error((e as Error).message);
        return;
      }
    }
    setSubmitting(true);
    try {
      await onSubmit({ start_date: from, end_date: to, reason: reason.trim() || null });
      toast.success("Día cerrado guardado");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl bg-white/[0.03] p-3.5 ring-1 ring-white/8">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/40">Fechas cerradas</div>
        <ClosureDatePicker
          from={from}
          to={to}
          onChange={({ from: f, to: t }) => {
            setFrom(f);
            setTo(t);
            setWarning(null);
          }}
        />
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/40">Motivo (opcional)</div>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej. Vacaciones, feriado, mudanza…"
          className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-foreground outline-none ring-1 ring-white/10 placeholder:text-white/35 focus:ring-rose-400/40"
        />
      </div>

      {warning !== null && warning > 0 && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200 ring-1 ring-amber-400/25">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Hay {warning} turno{warning === 1 ? "" : "s"} agendado{warning === 1 ? "" : "s"} en ese rango. El cierre
            no los cancela automáticamente — confirmá si igual querés guardarlo.
          </span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded-xl px-3.5 py-2 text-sm font-medium text-white/60 transition hover:text-white">
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={checking || submitting}
          className="rounded-xl bg-gradient-to-r from-rose-500 to-rose-400 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_30px_-12px_rgba(244,63,94,0.8)] transition hover:brightness-110 disabled:opacity-50"
        >
          {checking ? "Revisando…" : submitting ? pendingLabel : warning !== null && warning > 0 ? "Confirmar igual" : submitLabel}
        </button>
      </div>
    </div>
  );
}
