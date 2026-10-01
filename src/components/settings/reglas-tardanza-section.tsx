import * as React from "react";
import { Clock3, Plus, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { SectionCard, Field, inputCls, reportSaveStatus } from "@/components/settings/shared";
import type { LatenessRule } from "@/lib/fichaje";
import { toast } from "sonner";

type RuleForm = {
  minMinutes: string;
  maxMinutes: string;
  discountType: "percent" | "fixed";
  discountValue: string;
};

const EMPTY_FORM: RuleForm = { minMinutes: "", maxMinutes: "", discountType: "percent", discountValue: "" };

function rangesOverlap(aMin: number, aMax: number | null, bMin: number, bMax: number | null) {
  const aEnd = aMax ?? Infinity;
  const bEnd = bMax ?? Infinity;
  return aMin <= bEnd && bMin <= aEnd;
}

// Reglas de descuento por tardanza — por sucursal (cada local puede tener
// su propia tolerancia/escala). Ver src/lib/fichaje.ts para dónde se
// aplican (al fichar entrada tarde).
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
    const max = form.maxMinutes.trim() ? Number(form.maxMinutes) : null;
    const value = Number(form.discountValue);
    if (!Number.isFinite(min) || min < 0) return toast.error("Ingresá un mínimo de minutos válido");
    if (max != null && (!Number.isFinite(max) || max < min)) return toast.error("El máximo debe ser mayor al mínimo");
    if (!Number.isFinite(value) || value <= 0) return toast.error("Ingresá un valor de descuento válido");

    const overlapping = rules.some((r) => rangesOverlap(min, max, r.min_minutes, r.max_minutes));
    if (overlapping) return toast.error("Ese rango se superpone con una regla existente");

    setSaving(true);
    const { error } = await supabase.from("lateness_rules" as any).insert({
      business_id: businessId,
      branch_id: activeBranchId,
      min_minutes: min,
      max_minutes: max,
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
                    {r.min_minutes}–{r.max_minutes ?? "∞"} min →{" "}
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="Desde (min)">
                <input
                  type="number"
                  min={0}
                  className={inputCls}
                  value={form.minMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, minMinutes: e.target.value }))}
                  placeholder="Ej. 11"
                />
              </Field>
              <Field label="Hasta (min, opcional)">
                <input
                  type="number"
                  min={0}
                  className={inputCls}
                  value={form.maxMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, maxMinutes: e.target.value }))}
                  placeholder="Ej. 20"
                />
              </Field>
            </div>
            <Field label="Tipo de descuento">
              <select
                className={inputCls}
                value={form.discountType}
                onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value as "percent" | "fixed" }))}
              >
                <option value="percent">Porcentaje de la comisión del día</option>
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
    </div>
  );
}
