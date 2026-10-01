import * as React from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { CalendarOff, X, Plus, Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/date-range-picker";
import {
  useClosures,
  useCreateClosure,
  useDeleteClosure,
  countAppointmentsInRange,
  type Closure,
} from "@/hooks/use-closures";

function fmtFecha(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}
function rangoLabel(c: Closure) {
  return c.start_date === c.end_date ? fmtFecha(c.start_date) : `${fmtFecha(c.start_date)} – ${fmtFecha(c.end_date)}`;
}

// Botón "Cierres" de la barra de Agenda — lista los cierres de la
// sucursal activa (fechas en las que no se aceptan turnos nuevos) y
// permite agregar uno nuevo. Nunca cancela automáticamente los turnos
// que ya existan en el rango: si hay, se avisa la cantidad antes de
// confirmar, pero la decisión queda siempre en el usuario.
export function ClosuresButton({
  businessId,
  branchId,
  createdByName,
  compact = false,
}: {
  businessId: string | null;
  branchId: string | null;
  createdByName: string | null;
  compact?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const { data: closures = [] } = useClosures(businessId, branchId);

  const upcoming = React.useMemo(() => {
    const today = new Date().toLocaleDateString("sv-SE");
    return closures.filter((c) => c.end_date >= today);
  }, [closures]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          compact
            ? "flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-center transition-all active:brightness-110"
            : "inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium transition-all hover:brightness-110",
        )}
        style={{
          background: "rgba(248, 113, 113, 0.12)",
          boxShadow: "0 0 0 1px rgba(248, 113, 113, 0.3)",
          color: "#FCA5A5",
        }}
        title="Cierres de la sucursal"
      >
        <span className={compact ? "font-semibold tabular-nums text-sm leading-none" : "font-semibold tabular-nums text-sm"}>
          {upcoming.length}
        </span>
        <span className={compact ? "text-[10px] leading-tight opacity-80 truncate max-w-full" : "opacity-80"}>
          Cierres
        </span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <ClosuresModal
          businessId={businessId}
          branchId={branchId}
          createdByName={createdByName}
          closures={closures}
          onClose={() => setOpen(false)}
        />,
        document.body,
      )}
    </>
  );
}

function ClosuresModal({
  businessId,
  branchId,
  createdByName,
  closures,
  onClose,
}: {
  businessId: string | null;
  branchId: string | null;
  createdByName: string | null;
  closures: Closure[];
  onClose: () => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const create = useCreateClosure(businessId, branchId);
  const del = useDeleteClosure(businessId, branchId);

  React.useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  async function handleDelete(id: string) {
    try {
      await del.mutateAsync(id);
      toast.success("Cierre eliminado");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
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
              <div className="text-sm font-bold text-white">Cierres</div>
            </div>
            <button type="button" onClick={onClose} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/50 transition hover:bg-white/5 hover:text-white sm:h-8 sm:w-8" aria-label="Cerrar">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            {adding ? (
              <AddClosureForm
                businessId={businessId}
                branchId={branchId}
                createdByName={createdByName}
                onCancel={() => setAdding(false)}
                onSaved={() => setAdding(false)}
                create={create}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-rose-500/12 px-4 py-2.5 text-sm font-semibold text-rose-200 ring-1 ring-rose-400/25 transition hover:bg-rose-500/18"
              >
                <Plus className="h-4 w-4" />
                Agregar cierre
              </button>
            )}

            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/40">
                {closures.length === 0 ? "Sin cierres cargados" : "Cierres cargados"}
              </div>
              <div className="space-y-1.5">
                {closures.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm ring-1 ring-white/8">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-white/85">{rangoLabel(c)}</div>
                      {c.reason && <div className="truncate text-xs text-white/50">{c.reason}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      disabled={del.isPending}
                      className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-white/10 hover:text-rose-300 disabled:opacity-50"
                      aria-label="Eliminar cierre"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function AddClosureForm({
  businessId,
  branchId,
  createdByName,
  onCancel,
  onSaved,
  create,
}: {
  businessId: string | null;
  branchId: string | null;
  createdByName: string | null;
  onCancel: () => void;
  onSaved: () => void;
  create: ReturnType<typeof useCreateClosure>;
}) {
  const today = new Date().toLocaleDateString("sv-SE");
  const [from, setFrom] = React.useState(today);
  const [to, setTo] = React.useState(today);
  const [reason, setReason] = React.useState("");
  const [warning, setWarning] = React.useState<number | null>(null);
  const [checking, setChecking] = React.useState(false);

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
    try {
      await create.mutateAsync({ start_date: from, end_date: to, reason: reason.trim() || null, created_by_name: createdByName });
      toast.success("Cierre guardado");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-3 rounded-xl bg-white/[0.03] p-3.5 ring-1 ring-white/8">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/40">Rango de fechas</div>
        <DateRangePicker
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
          onChange={(e) => {
            setReason(e.target.value);
          }}
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
          disabled={checking || create.isPending}
          className="rounded-xl bg-gradient-to-r from-rose-500 to-rose-400 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_30px_-12px_rgba(244,63,94,0.8)] transition hover:brightness-110 disabled:opacity-50"
        >
          {checking ? "Revisando…" : create.isPending ? "Guardando…" : warning !== null && warning > 0 ? "Confirmar igual" : "Guardar cierre"}
        </button>
      </div>
    </div>
  );
}
