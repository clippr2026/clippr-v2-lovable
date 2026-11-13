import * as React from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Camera, Check, Clock3, Loader2, Pencil, UserX, X } from "lucide-react";
import { getFichajesDeFecha, type FichajeHoyPersona } from "@/lib/fichaje";
import { FichajeEvidenciaModal } from "@/components/dashboard/fichaje-evidencia-modal";
import { supabase } from "@/integrations/supabase/client";
import { puntualidadMessage } from "@/lib/puntualidad-text";
import { dayWindowBA, fetchBusinessClosingTime, horaBA, saveManualSession, saveSessionExit } from "@/lib/work-session-exit";
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
// Salida de un profesional: la hora si ya la fichó, o el campo para cargarla
// si quedó sin fichar (se guarda como cargada al cerrar la caja).
function SalidaRow({
  session,
  defaultOut,
  date,
  editedBy,
  onSaved,
  manual,
}: {
  session: { id: string | null; clock_in_at: string; clock_out_at: string | null };
  defaultOut: string;
  date: string;
  editedBy: string;
  onSaved: () => void;
  // Entrada cargada a mano (sin jornada fichada): al guardar se crea la jornada con su salida.
  manual?: { businessId: string; branchId: string; employeeId: string };
}) {
  const [time, setTime] = React.useState(defaultOut);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setTime(defaultOut), [defaultOut]);

  if (session.clock_out_at) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        <span>
          Entrada <span className="tabular-nums text-foreground/80">{horaBA(session.clock_in_at)}</span>
        </span>
        <span>
          Salida <span className="tabular-nums text-foreground/80">{horaBA(session.clock_out_at)}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
      <span className="w-full text-xs text-rose-300/90">Salida pendiente</span>
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        className="h-10 min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-foreground"
      />
      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          const r =
            session.id || !manual
              ? await saveSessionExit({ sessionId: session.id as string, clockInAt: session.clock_in_at, date, hhmm: time, editedBy })
              : await saveManualSession({ ...manual, clockInAt: session.clock_in_at, date, hhmm: time, editedBy });
          setSaving(false);
          if (!r.ok) return toast.error(r.error);
          toast.success("Salida guardada");
          onSaved();
        }}
        className="inline-flex h-10 shrink-0 items-center gap-1 rounded-full bg-violet-500/20 px-4 text-sm font-semibold text-violet-100 ring-1 ring-violet-400/40 hover:bg-violet-500/30 disabled:opacity-50"
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : null} Guardar salida
      </button>
    </div>
  );
}

export function PresentismoRevisionPanel({
  businessId,
  branchId,
  date,
  confirmedBy,
  confirmedByName,
  onPendingChange,
  showSalida = false,
  onSalidasPendingChange,
  onScheduledIdsChange,
}: {
  businessId: string;
  branchId: string;
  date: string; // YYYY-MM-DD
  confirmedBy: string;
  confirmedByName: string;
  // Muestra, en cada profesional, su salida (y permite cargarla si quedó sin
  // fichar): entrada y salida en el mismo lugar al cerrar la caja.
  showSalida?: boolean;
  // Nombres de quienes ficharon entrada pero no salida (para bloquear el cierre).
  onSalidasPendingChange?: (pendingNames: string[]) => void;
  // Ids de los profesionales programados ese día (para no repetirlos abajo).
  onScheduledIdsChange?: (ids: string[]) => void;
  // Se llama después de cada carga (inicial y tras cada confirmación) con
  // los nombres de quienes TODAVÍA no tienen presentismo confirmado —
  // array vacío = todos confirmados, cierre de caja habilitado.
  onPendingChange?: (pendingNames: string[]) => void;
}) {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  // Profesionales con TODA su jornada bloqueada en la agenda (sin fichaje ni confirmación):
  // se muestran como ausentes de entrada; "Desmarcar" los saca de ahí solo en esta pantalla.
  const [bloqueadoIds, setBloqueadoIds] = React.useState<Set<string>>(new Set());
  const [desmarcadoIds, setDesmarcadoIds] = React.useState<Set<string>>(new Set());
  // Fotos del fichaje de cada persona (solo lectura), para verlas junto a su entrada y salida.
  const [fichajes, setFichajes] = React.useState<Map<string, FichajeHoyPersona>>(new Map());
  const [fotosDe, setFotosDe] = React.useState<FichajeHoyPersona | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void getFichajesDeFecha(businessId, branchId, date)
      .then((r) => !cancelled && setFichajes(new Map(r.map((p) => [p.id, p]))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [businessId, branchId, date]);
  const [sessionByEmp, setSessionByEmp] = React.useState<Map<string, { id: string; clock_in_at: string; clock_out_at: string | null }>>(new Map());
  const [defaultOut, setDefaultOut] = React.useState("20:00");
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
      if (showSalida) {
        const win = dayWindowBA(date);
        const [{ data: sess }, closing] = await Promise.all([
          supabase
            .from("work_sessions" as any)
            .select("id,employee_id,clock_in_at,clock_out_at")
            .eq("business_id", businessId)
            .eq("branch_id", branchId)
            .gte("clock_in_at", win.start.toISOString())
            .lt("clock_in_at", win.end.toISOString())
            .order("clock_in_at", { ascending: true }),
          fetchBusinessClosingTime(businessId, date),
        ]);
        const map = new Map<string, { id: string; clock_in_at: string; clock_out_at: string | null }>();
        for (const s of (sess ?? []) as { id: string; employee_id: string; clock_in_at: string; clock_out_at: string | null }[]) {
          map.set(s.employee_id, { id: s.id, clock_in_at: s.clock_in_at, clock_out_at: s.clock_out_at });
        }
        setSessionByEmp(map);
        setDefaultOut(closing);
        // Falta la salida de quien fichó entrada sin salida y de quien tiene la entrada cargada a mano (sin jornada).
        const entradaDe = (r: Row) => r.confirmation?.effectiveClockInAt ?? r.preview?.effectiveClockInAt ?? null;
        onSalidasPendingChange?.(
          built
            .filter((r) => {
              const ses = map.get(r.employeeId);
              if (ses) return !ses.clock_out_at;
              return Boolean(entradaDe(r)) && (r.confirmation?.status ?? r.preview?.status) !== "ausente";
            })
            .map((r) => r.name),
        );
      }
      onScheduledIdsChange?.(built.map((r) => r.employeeId));
      try {
        const win = dayWindowBA(date);
        const [{ data: bloqs }, closing] = await Promise.all([
          supabase
            .from("appointments")
            .select("employee_id,starts_at,ends_at,duration_min")
            .eq("business_id", businessId)
            .eq("status", "blocked")
            .gte("starts_at", win.start.toISOString())
            .lt("starts_at", win.end.toISOString()),
          fetchBusinessClosingTime(businessId, date),
        ]);
        const [ch, cm] = closing.split(":").map(Number);
        const closeMs = win.start.getTime() + ((ch || 0) * 60 + (cm || 0)) * 60_000;
        const tol = 15 * 60_000;
        const ids = new Set<string>();
        for (const r of built) {
          if (!r.expectedStartAt || r.confirmation || r.preview?.status) continue;
          const startMs = new Date(r.expectedStartAt).getTime();
          const ranges = ((bloqs ?? []) as any[])
            .filter((b) => b.employee_id === r.employeeId)
            .map((b) => {
              const st = new Date(b.starts_at).getTime();
              const en = b.ends_at ? new Date(b.ends_at).getTime() : st + Number(b.duration_min ?? 30) * 60_000;
              return { st, en };
            })
            .sort((a, b) => a.st - b.st);
          if (ranges.length === 0) continue;
          // Cubre de corrido desde el horario de entrada hasta el cierre (con 15 min de margen).
          let cursor = startMs;
          for (const g of ranges) {
            if (g.st <= cursor + tol) cursor = Math.max(cursor, g.en);
          }
          if (cursor >= closeMs - tol) ids.add(r.employeeId);
        }
        setBloqueadoIds(ids);
      } catch {
        setBloqueadoIds(new Set());
      }
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
    return `Desde ${r.min_minutes} min → ${r.discount_type === "percent" ? `−${r.discount_value}%` : money(Number(r.discount_value))}`;
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
  async function confirmDirect(row: Row, action: "confirm_on_time" | "confirm_late" | "mark_absent", motivo?: string) {
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
        reason: motivo ?? "Confirmado sin cambios",
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
      {/* Primero los que falta confirmar; los ya confirmados quedan abajo. */}
      {(() => {
        const renderRow = (row: Row) => {
        const bloqueado = bloqueadoIds.has(row.employeeId) && !desmarcadoIds.has(row.employeeId) && !row.confirmation && !row.preview?.status;
        const status = bloqueado ? "ausente" : (row.confirmation?.status ?? row.preview?.status ?? null);
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

        const iconBtns = (
          <>
                {(() => {
                  const f = fichajes.get(row.employeeId);
                  return f && (f.inSelfiePath || f.outSelfiePath) ? (
                    <button
                      type="button"
                      aria-label="Ver fotos"
                      title="Ver fotos"
                      onClick={() => setFotosDe(f)}
                      className="inline-flex size-9 items-center justify-center rounded-full text-sky-200 ring-1 ring-white/10 hover:bg-white/5"
                    >
                      <Camera className="size-4" />
                    </button>
                  ) : null;
                })()}
                {/* Quien ya fichó (a tiempo o tarde) estuvo presente: solo se
                    puede marcar ausente a quien no tiene fichaje. */}
                {!status && (
                  <button
                    type="button"
                    aria-label="Marcar ausente"
                    title="Marcar ausente"
                    onClick={() => startAction(row.employeeId, "mark_absent")}
                    className="inline-flex size-9 items-center justify-center rounded-full text-rose-300/80 ring-1 ring-white/10 hover:bg-white/5"
                  >
                    <UserX className="size-4" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Editar hora"
                  title="Editar hora"
                  onClick={() => startAction(row.employeeId, "correct_time")}
                  className="inline-flex size-9 items-center justify-center rounded-full text-white/70 ring-1 ring-white/10 hover:bg-white/5"
                >
                  <Pencil className="size-4" />
                </button>
          </>
        );
        const ses = sessionByEmp.get(row.employeeId);

        return (
          <div
            key={row.employeeId}
            className="rounded-2xl border border-white/10 bg-[#0b0a14] px-4 py-3.5 [background-image:radial-gradient(110%_90%_at_100%_0%,rgba(79,125,255,0.10),transparent_62%)]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">{row.name}</div>
              <div className="flex shrink-0 items-center gap-2">
                {!isConfirmed &&
                  (shownStatus ? (
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${STATUS_CLASS[shownStatus]}`}>
                      {STATUS_LABEL[shownStatus]}
                      {live ? " · sin guardar" : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-white/45">Sin fichar</span>
                  ))}
                {isConfirmed && iconBtns}
              </div>
            </div>
            {(shownClockIn || bloqueado) && (
              <div className="mt-1 text-[13px] text-white/60">
                {isConfirmed && shownStatus && (
                  <span className={`mb-1.5 flex w-fit rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${STATUS_CLASS[shownStatus]}`}>
                    {STATUS_LABEL[shownStatus]} · confirmado
                  </span>
                )}
                {shownClockIn && (
                  <>
                    Entrada <span className="tabular-nums text-white/80">{horaCorta(shownClockIn)}</span>
                    {ses?.clock_out_at && (
                      <>
                        {" · "}Salida <span className="tabular-nums text-white/80">{horaCorta(ses.clock_out_at)}</span>
                      </>
                    )}
                    {shownLate > 0 && <> · {shownLate} min tarde</>}
                  </>
                )}
                {bloqueado && <>{shownClockIn ? " · " : ""}Día bloqueado</>}
              </div>
            )}
            {(shownRuleId || shownDiscount !== 0) && (
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-white/50">
                <span className="min-w-0 truncate">Regla: {ruleLabel(shownRuleId)}</span>
                <span className={cn("shrink-0 font-semibold tabular-nums", shownDiscount > 0 ? "text-rose-300" : shownDiscount < 0 ? "text-emerald-300" : "")}>
                  {shownDiscount === 0 ? "$0" : shownDiscount > 0 ? `-${money(shownDiscount)}` : `+${money(Math.abs(shownDiscount))}`}
                </span>
              </div>
            )}
            <div className={cn("mt-3 flex items-center gap-2", isConfirmed && "hidden")}>
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
                          bloqueado ? "Día completo bloqueado en la agenda" : undefined,
                        )
                  }
                  className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <Check className="size-4" /> Confirmar
                </button>
              )}
              {bloqueado && (
                <button
                  type="button"
                  onClick={() => setDesmarcadoIds((cur) => new Set(cur).add(row.employeeId))}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-sm text-white/70 ring-1 ring-white/10 hover:bg-white/5"
                >
                  <UserX className="size-4" /> Desmarcar
                </button>
              )}
              {!isConfirmed && (
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {iconBtns}
                </div>
              )}
            </div>

            {showSalida && isConfirmed && !sessionByEmp.get(row.employeeId) && effectiveClockIn && status !== "ausente" && (
              <SalidaRow
                session={{ id: null, clock_in_at: effectiveClockIn, clock_out_at: null }}
                defaultOut={defaultOut}
                date={date}
                editedBy={confirmedByName}
                onSaved={load}
                manual={{ businessId, branchId, employeeId: row.employeeId }}
              />
            )}
            {/* Primero se confirma la entrada; recién después se pide la salida. */}
            {showSalida && isConfirmed && ses && !ses.clock_out_at && (
              <SalidaRow
                session={ses}
                defaultOut={defaultOut}
                date={date}
                editedBy={confirmedByName}
                onSaved={load}
              />
            )}

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
        };
        const pendientes = rows.filter((r) => !r.confirmation);
        const confirmados = rows.filter((r) => r.confirmation);
        return (
          <>
            {pendientes.map(renderRow)}
            {confirmados.length > 0 && pendientes.length > 0 ? (
              <details className="rounded-xl bg-white/[0.02] ring-1 ring-white/10">
                <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-semibold text-white/80">
                  Ya confirmados ({confirmados.length})
                </summary>
                <div className="space-y-2.5 p-2.5 pt-0">{confirmados.map(renderRow)}</div>
              </details>
            ) : (
              confirmados.map(renderRow)
            )}
            {fotosDe && <FichajeEvidenciaModal persona={fotosDe} onClose={() => setFotosDe(null)} />}
          </>
        );
      })()}
    </div>
  );
}
