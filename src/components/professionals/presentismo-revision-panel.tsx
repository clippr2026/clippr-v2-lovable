import * as React from "react";
import { toast } from "sonner";
import { Check, Clock3, Loader2, Pencil, UserX, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { puntualidadMessage } from "@/lib/puntualidad-text";
import { latenessMinutes, pickLatenessRule } from "@/lib/lateness-penalty";
import {
  confirmAttendance,
  getAttendanceConfirmationsForDate,
  getScheduledProfessionalsForDate,
  previewAttendance,
  previewAttendanceAt,
  type AttendanceAction,
  type AttendanceConfirmation,
  type AttendancePreview,
} from "@/lib/presentismo";
import type { LatenessRule } from "@/lib/fichaje";

function horaCorta(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

// HH:MM de un instante en hora de Buenos Aires, para precargar el input de
// hora (type="time" necesita exactamente ese formato).
function horaBuenosAires(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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

function PenaltyChoice({
  selected,
  onSelect,
  disableAplicar,
}: {
  selected: "aplicar" | "anular" | null;
  onSelect: (choice: "aplicar" | "anular") => void;
  disableAplicar?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["aplicar", "anular"] as const).map((choice) => (
        <button
          key={choice}
          type="button"
          disabled={choice === "aplicar" && disableAplicar}
          onClick={() => onSelect(choice)}
          className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40 ${
            selected === choice
              ? "bg-gradient-to-r from-sky-400 to-violet-500 text-white"
              : "text-muted-foreground ring-1 ring-white/10 hover:bg-white/5"
          }`}
        >
          {choice === "aplicar" ? "Sí, aplicar" : "No, anular"}
        </button>
      ))}
    </div>
  );
}

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
  const [penaltyChoice, setPenaltyChoice] = React.useState<"aplicar" | "anular" | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Resultado REAL (calculado por el servidor, preview_attendance_at) de la hora
  // que se está escribiendo. `key` evita mostrar el de una hora anterior.
  const [livePreview, setLivePreview] = React.useState<{
    key: string;
    lateMinutes: number;
    status: "tarde" | "a_tiempo";
    ruleId: string | null;
    discount: number;
  } | null>(null);

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
      toast.error(puntualidadMessage((e as Error).message));
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, branchId, date]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Consulta al servidor el resultado de la hora que se está escribiendo.
  React.useEffect(() => {
    if (!actionFor || actionFor.action !== "correct_time" || !correctedTime) {
      setLivePreview(null);
      return;
    }
    const employeeId = actionFor.employeeId;
    const key = `${employeeId}|${correctedTime}`;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const iso = new Date(`${date}T${correctedTime}:00.000-03:00`).toISOString();
      const p = await previewAttendanceAt(businessId, employeeId, branchId, date, iso);
      if (cancelled || !p) return;
      setLivePreview({
        key,
        lateMinutes: p.lateMinutes,
        status: p.status === "tarde" ? "tarde" : "a_tiempo",
        ruleId: p.ruleId,
        discount: p.discountAmountRequested,
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [actionFor, correctedTime, businessId, branchId, date]);

  function ruleLabel(ruleId: string | null) {
    if (!ruleId) return "—";
    const r = rules.find((x) => x.id === ruleId);
    if (!r) return "—";
    return `Desde ${r.min_minutes} min → ${r.discount_type === "percent" ? `−${r.discount_value} pts de comisión` : money(Number(r.discount_value))}`;
  }

  function startAction(employeeId: string, action: AttendanceAction) {
    setActionFor({ employeeId, action });
    setReason("");
    const row = rows?.find((r) => r.employeeId === employeeId);
    const currentClockIn = row?.confirmation?.effectiveClockInAt ?? row?.preview?.effectiveClockInAt ?? null;
    setCorrectedTime(action === "correct_time" ? horaBuenosAires(currentClockIn) : "");
    setPenaltyChoice(null);
  }

  // Vista previa de una hora de llegada corregida. La penalización la calcula
  // el SERVIDOR (preview_attendance_at): la misma cuenta que se guarda al
  // confirmar, con la tasa propia de cada servicio. Mientras llega la
  // respuesta (o si esa función todavía no existe en la base) se muestran
  // estado y minutos calculados acá, sin importe (discount = null).
  function liveFor(row: Row, time: string) {
    if (!time || !row.expectedStartAt) return null;
    const iso = `${date}T${time}:00.000-03:00`;
    if (livePreview && livePreview.key === `${row.employeeId}|${time}`) {
      return { iso, lateMinutes: livePreview.lateMinutes, status: livePreview.status, ruleId: livePreview.ruleId, discount: livePreview.discount as number | null };
    }
    const lateMinutes = latenessMinutes(row.expectedStartAt, iso);
    const rule = pickLatenessRule(rules, lateMinutes);
    return {
      iso,
      lateMinutes,
      status: (lateMinutes > 0 ? "tarde" : "a_tiempo") as "tarde" | "a_tiempo",
      ruleId: rule?.id ?? null,
      discount: null as number | null,
    };
  }

  async function submitAction() {
    if (!actionFor || !rows) return;
    if (!reason.trim()) return toast.error("El motivo es obligatorio");
    const row = rows.find((r) => r.employeeId === actionFor.employeeId);
    if (!row) return;

    if (actionFor.action === "correct_time" && !correctedTime) {
      return toast.error("Ingresá la hora corregida");
    }
    if (actionFor.action === "override_penalty" && !penaltyChoice) {
      return toast.error("Elegí si se aplica o no la penalización");
    }
    // "Sí" mantiene la penalización calculada; "No" la anula (importe 0).
    const requestedPenalty = row.confirmation?.discountAmountRequested ?? row.preview?.discountAmountRequested ?? 0;

    // confirm_attendance recalcula todo desde la hora que recibe: para ajustar
    // la penalización hay que reenviar la hora vigente, o volvería a la
    // fichada original y desharía una corrección anterior.
    const currentClockIn = row.confirmation?.effectiveClockInAt ?? row.preview?.effectiveClockInAt ?? null;
    const correctedIso =
      actionFor.action === "correct_time" ? new Date(`${date}T${correctedTime}:00.000-03:00`).toISOString() : null;
    const live = actionFor.action === "correct_time" ? liveFor(row, correctedTime) : null;

    setSaving(true);
    try {
      await confirmAttendance({
        businessId,
        employeeId: actionFor.employeeId,
        branchId,
        date,
        action: actionFor.action,
        correctedClockInAt: correctedIso ?? (actionFor.action === "override_penalty" ? currentClockIn : null),
        overrideDiscountAmount:
          actionFor.action === "override_penalty" ? (penaltyChoice === "aplicar" ? requestedPenalty : 0) : null,
        reason: reason.trim(),
        confirmedBy,
        confirmedByName,
      });
      // Hora corregida que deja tarde con penalización: si se eligió "No", se
      // anula en un segundo paso (queda registrado como ajuste aparte).
      if (live && live.lateMinutes > 0 && live.ruleId && penaltyChoice === "anular") {
        await confirmAttendance({
          businessId,
          employeeId: actionFor.employeeId,
          branchId,
          date,
          action: "override_penalty",
          correctedClockInAt: correctedIso,
          overrideDiscountAmount: 0,
          reason: reason.trim(),
          confirmedBy,
          confirmedByName,
        });
      }
      toast.success(`Puntualidad de ${row.name} actualizada`);
      setActionFor(null);
      await load();
    } catch (e) {
      toast.error(puntualidadMessage((e as Error).message));
    } finally {
      setSaving(false);
    }
  }

  // Confirmar de un clic, sin abrir el recuadro: la base exige un motivo en
  // toda acción, así que se registra uno automático (queda en la auditoría,
  // junto con quién confirmó).
  async function confirmDirect(row: Row, action: "confirm_on_time" | "confirm_late" | "mark_absent") {
    setSaving(true);
    try {
      await confirmAttendance({
        businessId,
        employeeId: row.employeeId,
        branchId,
        date,
        action,
        correctedClockInAt: null,
        overrideDiscountAmount: null,
        reason: "Confirmado sin cambios",
        confirmedBy,
        confirmedByName,
      });
      toast.success(`Puntualidad de ${row.name} actualizada`);
      setActionFor(null);
      await load();
    } catch (e) {
      toast.error(puntualidadMessage((e as Error).message));
    } finally {
      setSaving(false);
    }
  }

  if (loading || !rows) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando puntualidad…
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
        const requestedPenalty = row.confirmation?.discountAmountRequested ?? row.preview?.discountAmountRequested ?? 0;
        const isConfirmed = Boolean(row.confirmation);
        // La penalización solo se puede ajustar si llegó tarde; Guardar solo
        // hace falta donde no hay un botón Confirmar que guarde.
        const esTarde = status === "tarde";
        const showGuardar = !(status && !isConfirmed);
        const editingThis = actionFor?.employeeId === row.employeeId;

        // Mientras se escribe una hora nueva, la fila muestra el resultado que
        // tendría (estado, minutos, regla, ajuste) antes de guardar.
        const live = editingThis && actionFor!.action === "correct_time" ? liveFor(row, correctedTime) : null;
        const liveDecision = penaltyChoice ?? "aplicar"; // por defecto se aplica lo que dice la regla
        const shownStatus = live?.status ?? status;
        const shownLate = live ? live.lateMinutes : lateMinutes;
        const shownRuleId = live ? live.ruleId : ruleId;
        const shownDiscount = live ? (live.ruleId && liveDecision === "aplicar" ? (live.discount ?? 0) : 0) : discount;
        const shownClockIn = live ? live.iso : effectiveClockIn;

        return (
          <div key={row.employeeId} className="rounded-xl bg-white/[0.03] px-3.5 py-3 ring-1 ring-white/5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{row.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>Real <span className="tabular-nums text-foreground/80">{horaCorta(shownClockIn)}</span></span>
                  {shownLate > 0 && <span>{shownLate} min tarde</span>}
                  <span>Regla: {ruleLabel(shownRuleId)}</span>
                  <span className={shownDiscount > 0 ? "text-rose-300" : shownDiscount < 0 ? "text-emerald-300" : ""}>
                    Ajuste: {shownDiscount === 0 ? "$0" : shownDiscount > 0 ? `-${money(shownDiscount)}` : `+${money(Math.abs(shownDiscount))}`}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {shownStatus && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${STATUS_CLASS[shownStatus]}`}>
                    {STATUS_LABEL[shownStatus]}
                    {live ? " · sin guardar" : isConfirmed ? " · confirmado" : ""}
                  </span>
                )}
                {!isConfirmed && status && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      // Con una corrección o un ajuste de penalización abiertos,
                      // Confirmar es lo que los guarda; si no, confirma directo.
                      editingThis && (actionFor!.action === "correct_time" || actionFor!.action === "override_penalty")
                        ? submitAction()
                        : confirmDirect(
                            row,
                            status === "tarde" ? "confirm_late" : status === "ausente" ? "mark_absent" : "confirm_on_time",
                          )
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-sky-400 to-violet-500 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    <Check className="size-3.5" /> Confirmar
                  </button>
                )}
                {!isConfirmed && !status && (
                  <span className="text-xs text-muted-foreground">Sin fichar</span>
                )}
                {/* Quien ya fichó (a tiempo o tarde) estuvo presente: solo se
                    puede marcar ausente a quien no tiene fichaje. */}
                {!status && (
                  <button
                    type="button"
                    onClick={() => startAction(row.employeeId, "mark_absent")}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground ring-1 ring-white/10 hover:bg-white/5"
                  >
                    <UserX className="size-3.5" /> Ausente
                  </button>
                )}
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
                    {actionFor!.action === "override_penalty" && "Penalización"}
                    {(actionFor!.action === "confirm_late" || actionFor!.action === "confirm_on_time") && "Confirmar puntualidad"}
                  </div>
                  <button type="button" onClick={() => setActionFor(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </div>
                {actionFor!.action === "correct_time" && (
                  <input
                    type="time"
                    value={correctedTime}
                    onChange={(e) => setCorrectedTime(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-sm text-foreground outline-none focus:border-violet-300/40"
                  />
                )}
                {live && (
                  <div className="space-y-1.5">
                    {live.lateMinutes === 0 ? (
                      <div className="text-xs text-muted-foreground">Con esa hora llega a tiempo.</div>
                    ) : !live.ruleId ? (
                      <div className="text-xs text-muted-foreground">
                        Con esa hora llega {live.lateMinutes} min tarde, pero ninguna regla aplica penalización.
                      </div>
                    ) : (
                      <>
                        <div className="text-xs text-muted-foreground">
                          Con esa hora llega {live.lateMinutes} min tarde. ¿Aplicar penalización
                          {live.discount !== null ? ` (${money(live.discount)})` : ""}?
                        </div>
                        <PenaltyChoice selected={liveDecision} onSelect={setPenaltyChoice} />
                      </>
                    )}
                  </div>
                )}
                {actionFor!.action === "override_penalty" && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-muted-foreground">
                      {requestedPenalty > 0
                        ? `Penalización calculada: ${money(requestedPenalty)}. ¿Se aplica?`
                        : "No hay penalización calculada para esta jornada."}
                    </div>
                    <PenaltyChoice selected={penaltyChoice} onSelect={setPenaltyChoice} disableAplicar={requestedPenalty <= 0} />
                  </div>
                )}
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Motivo (obligatorio)"
                  className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-sm text-foreground outline-none focus:border-violet-300/40"
                />
                <div className={`flex gap-2 ${showGuardar || esTarde ? "" : "hidden"}`}>
                  {/* Si la fila tiene el botón Confirmar, ese es el que guarda. */}
                  {showGuardar && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={submitAction}
                      className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-400 to-violet-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Guardar
                    </button>
                  )}
                  {esTarde && (
                    <button
                      type="button"
                      onClick={() => startAction(row.employeeId, "override_penalty")}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground ring-1 ring-white/10"
                    >
                      <Clock3 className="size-3.5" /> Ajustar penalización
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
