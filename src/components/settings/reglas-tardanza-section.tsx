import * as React from "react";
import { Clock3, Plus, Trash2, Loader2, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { SectionCard, Field, inputCls, reportSaveStatus } from "@/components/settings/shared";
import type { LatenessRule } from "@/lib/fichaje";
import { getAttendanceAdjustments, type AttendanceAdjustment, type AttendanceAction, type AttendanceStatus } from "@/lib/presentismo";
import { toast } from "sonner";

type RuleForm = {
  minMinutes: string;
  discountType: "percent" | "fixed";
  discountValue: string;
};

const EMPTY_FORM: RuleForm = { minMinutes: "", discountType: "percent", discountValue: "" };

// Reglas de descuento por tardanza — por sucursal (cada local puede tener
// su propia escala). Cada regla es un umbral abierto ("desde N minutos"),
// sin límite superior que configurar: ante una tardanza puntual se aplica
// SIEMPRE la regla de minuto de inicio más alto ya alcanzado (ver
// findMatchingRule en src/lib/fichaje.ts) — los descuentos nunca se
// acumulan entre reglas, y la liquidación nunca cae a $0 por quedar fuera
// de un rango "hasta X" mal configurado.
export function ReglasTardanzaSection() {
  const { businessId, activeBranchId, branches } = useAuth();
  const [rules, setRules] = React.useState<LatenessRule[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [form, setForm] = React.useState<RuleForm>(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!businessId || !activeBranchId) {
      setRules([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("lateness_rules" as any)
      .select("*")
      .eq("business_id", businessId)
      .eq("branch_id", activeBranchId)
      .order("min_minutes", { ascending: true });
    if (error) toast.error("Error cargando reglas: " + error.message);
    setRules((data ?? []) as unknown as LatenessRule[]);
    setLoading(false);
  }, [businessId, activeBranchId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (!businessId || !activeBranchId) return;
    const min = Number(form.minMinutes);
    const value = Number(form.discountValue);
    if (!Number.isFinite(min) || min < 1) return toast.error("Ingresá desde qué minuto de tardanza aplica (mínimo 1)");
    if (!Number.isFinite(value) || value <= 0) return toast.error("Ingresá un valor de descuento válido");

    const duplicate = rules.some((r) => r.min_minutes === min);
    if (duplicate) return toast.error(`Ya existe una regla "desde ${min} min"`);

    setSaving(true);
    const { error } = await supabase.from("lateness_rules" as any).insert({
      business_id: businessId,
      branch_id: activeBranchId,
      min_minutes: min,
      max_minutes: null,
      discount_type: form.discountType,
      discount_value: value,
    });
    setSaving(false);
    if (error) return toast.error("No se pudo guardar la regla: " + error.message);
    setForm(EMPTY_FORM);
    reportSaveStatus("saved");
    await load();
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from("lateness_rules" as any).delete().eq("id", id);
    if (error) return toast.error("No se pudo eliminar la regla");
    await load();
  }

  const activeBranchName = branches.find((b) => b.id === activeBranchId)?.name ?? "";

  return (
    <div className="space-y-4">
      <SectionCard label={`Reglas de tardanza${activeBranchName ? ` — ${activeBranchName}` : ""}`}>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Cargando…
          </div>
        ) : rules.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Sin reglas configuradas — una tardanza no descuenta nada hasta que agregues al menos una.
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Clock3 className="size-4 shrink-0 text-muted-foreground/70" />
                  <div className="text-sm text-foreground">
                    Desde {r.min_minutes} min →{" "}
                    <span className="font-semibold">
                      {r.discount_type === "percent" ? `${r.discount_value}%` : `$${r.discount_value.toLocaleString("es-AR")}`}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(r.id)}
                  className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-300"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard label="Agregar regla">
        {!activeBranchId ? (
          <div className="text-sm text-muted-foreground">Elegí una sucursal para configurar sus reglas.</div>
        ) : (
          <div className="space-y-3">
            <Field label="Desde qué minuto de tardanza aplica">
              <input
                type="number"
                min={1}
                className={inputCls}
                value={form.minMinutes}
                onChange={(e) => setForm((f) => ({ ...f, minMinutes: e.target.value }))}
                placeholder="Ej. 1"
              />
            </Field>
            <Field label="Tipo de descuento">
              <select
                className={inputCls}
                value={form.discountType}
                onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value as "percent" | "fixed" }))}
              >
                <option value="percent">Porcentaje de la comisión de SERVICIOS del día</option>
                <option value="fixed">Monto fijo</option>
              </select>
            </Field>
            <Field label={form.discountType === "percent" ? "Porcentaje (%)" : "Monto ($)"}>
              <input
                type="number"
                min={0}
                className={inputCls}
                value={form.discountValue}
                onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
                placeholder={form.discountType === "percent" ? "Ej. 5" : "Ej. 3000"}
              />
            </Field>
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-40"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Agregar regla
            </button>
          </div>
        )}
      </SectionCard>

      <PresentismoAjustesHistorial rules={rules} />
    </div>
  );
}

const ACTION_LABEL: Record<AttendanceAction, string> = {
  confirm_on_time: "Confirmar a tiempo",
  confirm_late: "Confirmar tarde",
  mark_absent: "Marcar ausente",
  correct_time: "Corregir hora de llegada",
  override_penalty: "Ajustar/anular penalización",
  revert_absent: "Revertir ausente",
};

const STATUS_LABEL: Record<AttendanceStatus, string> = { a_tiempo: "A tiempo", tarde: "Tarde", ausente: "Ausente" };

function horaCorta(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function fechaCorta(iso: string) {
  return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function money(v: number | null) {
  if (v == null) return "—";
  return `${v < 0 ? "-" : ""}$${Math.round(Math.abs(v)).toLocaleString("es-AR")}`;
}

// Historial de ajustes manuales de presentismo — de SOLO lectura, sin
// ningún botón de editar/borrar: esta tabla es append-only a nivel base
// (ver getAttendanceAdjustments en src/lib/presentismo.ts), cada
// corrección posterior de un admin genera una fila nueva, nunca
// sobrescribe la anterior. "Regla automática original" muestra la regla
// que calculó el motor en el momento de la acción (rule_id), aunque la
// acción haya sido un override/corrección manual que termine en otro
// importe.
function PresentismoAjustesHistorial({ rules }: { rules: LatenessRule[] }) {
  const { businessId, activeBranchId } = useAuth();
  const [rows, setRows] = React.useState<AttendanceAdjustment[] | null>(null);
  const [names, setNames] = React.useState<Map<string, string>>(new Map());
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!businessId || !activeBranchId) {
        setRows([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [adjustments, employeesRes] = await Promise.all([
          getAttendanceAdjustments(businessId, activeBranchId),
          supabase.from("employees").select("id,full_name").eq("business_id", businessId).eq("branch_id", activeBranchId),
        ]);
        if (cancelled) return;
        setRows(adjustments);
        setNames(
          new Map(
            ((employeesRes.data ?? []) as { id: string; full_name: string | null }[]).map((e) => [e.id, e.full_name ?? "Profesional"]),
          ),
        );
      } catch (e) {
        if (!cancelled) {
          toast.error("Error cargando historial de presentismo: " + (e as Error).message);
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [businessId, activeBranchId]);

  function ruleLabel(ruleId: string | null) {
    if (!ruleId) return "—";
    const r = rules.find((x) => x.id === ruleId);
    if (!r) return "—";
    return `Desde ${r.min_minutes} min → ${r.discount_type === "percent" ? `${r.discount_value}%` : money(Number(r.discount_value))}`;
  }

  return (
    <SectionCard label="Historial de ajustes manuales de presentismo">
      {!activeBranchId ? (
        <div className="text-sm text-muted-foreground">Elegí una sucursal para ver su historial.</div>
      ) : loading || rows === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Cargando…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">Todavía no se registró ninguna confirmación o corrección de presentismo.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl bg-white/[0.03] px-3.5 py-3 ring-1 ring-white/5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <History className="size-4 shrink-0 text-muted-foreground/70" />
                  <div className="text-sm font-semibold text-foreground">{names.get(r.employeeId) ?? "Profesional"}</div>
                  <span className="text-xs text-muted-foreground">— jornada {r.date}</span>
                </div>
                <span className="text-xs text-muted-foreground">{fechaCorta(r.createdAt)}</span>
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground/80">{ACTION_LABEL[r.action]}</span> por {r.performedByName}
                {" · "}Motivo: {r.reason}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">Horario</div>
                  <div className="text-foreground/90">
                    {horaCorta(r.previousClockInAt)} → {horaCorta(r.newClockInAt)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Estado</div>
                  <div className="text-foreground/90">
                    {r.previousStatus ? STATUS_LABEL[r.previousStatus] : "—"} → {r.newStatus ? STATUS_LABEL[r.newStatus] : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Importe</div>
                  <div className="text-foreground/90">
                    {money(r.previousDiscountAmount)} → {money(r.newDiscountAmount)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Regla automática original</div>
                  <div className="text-foreground/90">{ruleLabel(r.ruleId)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
