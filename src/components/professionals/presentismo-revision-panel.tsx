import * as React from "react";
import { toast } from "sonner";
import { Check, Clock3, Loader2, Pencil, UserX, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  confirmAttendance,
  getAttendanceConfirmationsForDate,
  getScheduledProfessionalsForDate,
  previewAttendance,
  type AttendanceAction,
  type AttendanceConfirmation,
  type AttendancePreview,
} from "@/lib/presentismo";
import type { LatenessRule } from "@/lib/fichaje";

function horaCorta(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function money(v: number) {
  return `${v < 0 ? "-" : ""}$${Math.round(Math.abs(v)).toLocaleString("es-AR")}`;
}

type Row = {
  employeeId: string;
  name: string;
  expectedStartAt: string | null;
  confirmation: AttendanceConfirmation | null; // ya confirmado, estado congelado
  preview: AttendancePreview | null; // sin confirmar todavía, estado en vivo
};

const STATUS_LABEL: Record<string, string> = { a_tiempo: "A tiempo", tarde: "Tarde", ausente: "Ausente" };
const STATUS_CLASS: Record<string, string> = {
  a_tiempo: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
  tarde: "bg-rose-400/10 text-rose-300 ring-rose-400/25",
  ausente: "bg-zinc-400/10 text-zinc-300 ring-zinc-400/25",
};

// Panel de revisión de presentismo de UNA jornada (fecha + sucursal) — el
// paso obligatorio antes de poder cerrar esa caja (ver trigger
// check_attendance_confirmed_before_close en la migración de presentismo).
// Lista a TODOS los profesionales programados ese día (get_scheduled_
// professionals_for_date), muestre o no fichaje real, y para cada uno
// permite: Confirmar A tiempo/Tarde, Marcar ausente, Corregir hora,
// Ajustar/anular la penalización — todas con motivo obligatorio, todas
// pasan por confirm_attendance (nunca un UPDATE directo).
export function PresentismoRevisionPanel({
  businessId,
  branchId,
  date,
  confirmedBy,
  confirmedByName,
  onPendingChange,
}: {
  businessId: string;
  branchId: string;
  date: string; // YYYY-MM-DD
  confirmedBy: string;
  confirmedByName: string;
  // Se llama después de cada carga (inicial y tras cada confirmación) con
  // los nombres de quienes TODAVÍA no tienen presentismo confirmado —
  // array vacío = todos confirmados, cierre de caja habilitado.
  onPendingChange?: (pendingNames: string[]) => void;
}) {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [rules, setRules] = React.useState<LatenessRule[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [actionFor, setActionFor] = React.useState<{ employeeId: string; action: AttendanceAction } | null>(null);
  const [reason, setReason] = React.useState("");
  const [correctedTime, setCorrectedTime] = React.useState("");
  const [overrideAmount, setOverrideAmount] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [scheduled, confirmations, employeesRes, rulesRes] = await Promise.all([
        getScheduledProfessionalsForDate(businessId, branchId, date),
        getAttendanceConfirmationsForDate(businessId, branchId, date),
        supabase.from("employees").select("id,full_name").eq("business_id", businessId).eq("branch_id", branchId),
        supabase.from("lateness_rules" as any).select("*").eq("branch_id", branchId),
      ]);
      const nameById = new Map(
        ((employeesRes.data ?? []) as { id: string; full_name: string | null }[]).map((e) => [e.id, e.full_name ?? "Profesional"]),
      );
      const confirmationByEmployee = new Map(confirmations.map((c) => [c.employeeId, c]));

      const built: Row[] = await Promise.all(
        scheduled.map(async (s) => {
          const confirmation = confirmationByEmployee.get(s.employeeId) ?? null;
          const preview = confirmation ? null : await previewAttendance(businessId, s.employeeId, branchId, date);
          return {
            employeeId: s.employeeId,
            name: nameById.get(s.employeeId) ?? "Profesional",
            expectedStartAt: s.expectedStartAt,
            confirmation,
            preview,
          };
        }),
      );
      built.sort((a, b) => a.name.localeCompare(b.name));
      setRows(built);
      setRules((rulesRes.data ?? []) as unknown as LatenessRule[]);
      // Se reporta en CADA carga, no solo cuando queda todo confirmado —
      // así el aviso "X sin confirmar" de quien use este panel (ej. el
      // botón "Cerrar caja") nunca queda con un número viejo mientras se
      // va confirmando de a uno.
      onPendingChange?.(built.filter((r) => !r.confirmation).map((r) => r.name));
    } catch (e) {
      toast.error((e as Error).message);
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, branchId, date]);

  React.useEffect(() => {
    load();
  }, [load]);

  function ruleLabel(ruleId: string | null) {
    if (!ruleId) return "—";
    const r = rules.find((x) => x.id === ruleId);
    if (!r) return "—";
    return `Desde ${r.min_minutes} min → ${r.discount_type === "percent" ? `${r.discount_value}%` : money(Number(r.discount_value))}`;
  }

  function startAction(employeeId: string, action: AttendanceAction) {
    setActionFor({ employeeId, action });
    setReason("");
    setCorrectedTime("");
    setOverrideAmount("");
  }

  async function submitAction() {
    if (!actionFor || !rows) return;
    if (!reason.trim()) return toast.error("El motivo es obligatorio");
    const row = rows.find((r) => r.employeeId === actionFor.employeeId);
    if (!row) return;

    if (actionFor.action === "correct_time" && !correctedTime) {
      return toast.error("Ingresá la hora corregida");
    }
    if (actionFor.action === "override_penalty" && overrideAmount.trim() === "") {
      return toast.error("Ingresá el importe del ajuste");
    }

    setSaving(true);
    try {
      await confirmAttendance({
        businessId,
        employeeId: actionFor.employeeId,
        branchId,
        date,
        action: actionFor.action,
        correctedClockInAt: actionFor.action === "correct_time" ? new Date(correctedTime).toISOString() : null,
        overrideDiscountAmount: actionFor.action === "override_penalty" ? Number(overrideAmount) : null,
        reason: reason.trim(),
        confirmedBy,
        confirmedByName,
      });
      toast.success(`Presentismo de ${row.name} actualizado`);
      setActionFor(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !rows) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando presentismo…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Ningún profesional tenía jornada programada este día — no hace falta confirmar nada para cerrar la caja.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {rows.map((row) => {
        const status = row.confirmation?.status ?? row.preview?.status ?? null;
        const lateMinutes = row.confirmation?.lateMinutes ?? row.preview?.lateMinutes ?? 0;
        const discount = row.confirmation?.discountAmountApplied ?? row.preview?.discountAmountRequested ?? 0;
        const ruleId = row.confirmation?.ruleId ?? row.preview?.ruleId ?? null;
        const effectiveClockIn = row.confirmation?.effectiveClockInAt ?? row.preview?.effectiveClockInAt ?? null;
        const isConfirmed = Boolean(row.confirmation);
        const editingThis = actionFor?.employeeId === row.employeeId;

        return (
          <div key={row.employeeId} className="rounded-xl bg-white/[0.03] px-3.5 py-3 ring-1 ring-white/5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{row.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>Prog. <span className="tabular-nums text-foreground/80">{horaCorta(row.expectedStartAt)}</span></span>
                  <span>Real <span className="tabular-nums text-foreground/80">{horaCorta(effectiveClockIn)}</span></span>
                  {lateMinutes > 0 && <span>{lateMinutes} min tarde</span>}
                  <span>Regla: {ruleLabel(ruleId)}</span>
                  <span className={discount > 0 ? "text-rose-300" : discount < 0 ? "text-emerald-300" : ""}>
                    Ajuste: {discount === 0 ? "$0" : discount > 0 ? `-${money(discount)}` : `+${money(Math.abs(discount))}`}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {status && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${STATUS_CLASS[status]}`}>
                    {STATUS_LABEL[status]}
                    {isConfirmed ? " · confirmado" : ""}
                  </span>
                )}
                {!isConfirmed && status && (
                  <button
                    type="button"
                    onClick={() => startAction(row.employeeId, status === "tarde" ? "confirm_late" : "confirm_on_time")}
                    className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-sky-400 to-violet-500 px-2.5 py-1.5 text-xs font-semibold text-white"
                  >
                    <Check className="size-3.5" /> Confirmar
                  </button>
                )}
                {!isConfirmed && !status && (
                  <span className="text-xs text-muted-foreground">Sin fichar</span>
                )}
                <button
                  type="button"
                  onClick={() => startAction(row.employeeId, "mark_absent")}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground ring-1 ring-white/10 hover:bg-white/5"
                >
                  <UserX className="size-3.5" /> Ausente
                </button>
                <button
                  type="button"
                  onClick={() => startAction(row.employeeId, "correct_time")}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground ring-1 ring-white/10 hover:bg-white/5"
                >
                  <Pencil className="size-3.5" /> Editar
                </button>
              </div>
            </div>

            {editingThis && (
              <div className="mt-3 space-y-2 rounded-lg bg-black/20 p-3 ring-1 ring-white/10">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-foreground">
                    {actionFor!.action === "mark_absent" && "Marcar ausente"}
                    {actionFor!.action === "correct_time" && "Corregir hora de llegada"}
                    {(actionFor!.action === "confirm_late" || actionFor!.action === "confirm_on_time") && "Confirmar presentismo"}
                  </div>
                  <button type="button" onClick={() => setActionFor(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </div>
                {actionFor!.action === "correct_time" && (
                  <input
                    type="datetime-local"
                    value={correctedTime}
                    onChange={(e) => setCorrectedTime(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-sm text-foreground outline-none focus:border-violet-300/40"
                  />
                )}
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Motivo (obligatorio)"
                  className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-sm text-foreground outline-none focus:border-violet-300/40"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={submitAction}
                    className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-400 to-violet-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Guardar
                  </button>
                  <button
                    type="button"
                    onClick={() => startAction(row.employeeId, "override_penalty")}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground ring-1 ring-white/10"
                  >
                    <Clock3 className="size-3.5" /> Ajustar penalización
                  </button>
                </div>
                {actionFor!.action === "override_penalty" && (
                  <input
                    type="number"
                    value={overrideAmount}
                    onChange={(e) => setOverrideAmount(e.target.value)}
                    placeholder="Importe del ajuste ($, 0 para anular)"
                    className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-sm text-foreground outline-none focus:border-violet-300/40"
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
