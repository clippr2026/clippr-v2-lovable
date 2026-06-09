import * as React from "react";
import { toast } from "sonner";
import { Loader2, X, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Portado de cjLoadGastos / cjGuardarGasto / cjDeleteGasto (app.js ~9579-9707).
 * Tabla: expenses (business_id, name, amount, type, payment_method, date, note)
 * type: fijo | variable | ocasional | marketing
 * payment_method: efectivo | transferencia | débito | crédito | mercado pago
 */

type Expense = {
  id: string;
  name: string;
  amount: number;
  type: string | null;
  payment_method: string | null;
  date: string;
  note: string | null;
};

const TYPES = ["fijo", "variable", "ocasional", "marketing"];
const METHODS = ["efectivo", "transferencia", "débito", "crédito", "mercado pago"];

export function GastosTab({ businessId, createOnly = false, onSaved, onCancel }: { businessId: string | null; createOnly?: boolean; onSaved?: () => void; onCancel?: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [rows, setRows] = React.useState<Expense[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [form, setForm] = React.useState({
    name: "",
    amount: "",
    type: "",
    method: "",
    note: "",
  });
  const [saving, setSaving] = React.useState(false);
  const [showForm, setShowForm] = React.useState(createOnly);

  const load = React.useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("expenses")
      .select("id,name,amount,type,payment_method,date,note")
      .eq("business_id", businessId)
      .eq("date", today)
      .order("created_at", { ascending: false });
    if (error) toast.error("Error cargando gastos: " + error.message);
    setRows((data ?? []) as Expense[]);
    setLoading(false);
  }, [businessId, today]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!businessId) return;
    const name = form.name.trim();
    const amount = parseFloat(form.amount);
    if (!name || !amount || amount <= 0)
      return toast.error("Nombre y monto son obligatorios");

    setSaving(true);
    const { error } = await supabase.from("expenses").insert({
      business_id: businessId,
      name,
      amount,
      type: form.type || null,
      payment_method: form.method || null,
      date: today,
      note: form.note.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error("Error guardando gasto: " + error.message);
    toast.success("✓ Gasto registrado");
    setForm({ name: "", amount: "", type: "", method: "", note: "" });
    setShowForm(createOnly);
    load();
    onSaved?.();
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar este gasto?")) return;
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) return toast.error("Error al eliminar: " + error.message);
    load();
  }

  const total = rows.reduce((s, g) => s + Number(g.amount ?? 0), 0);

  if (createOnly) {
    return (
      <div className="max-w-3xl mx-auto w-full">
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-muted-foreground">Nuevo gasto</h3>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center justify-center rounded-lg border border-white/10 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition"
              >
                Cancelar
              </button>
            )}
          </div>
          <div className="space-y-2.5">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Nombre del gasto *"
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-amber-300/50"
            />
            <input
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="Monto *"
              type="number"
              min={0}
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-amber-300/50"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-amber-300/50"
              >
                <option value="">Tipo</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
              <select
                value={form.method}
                onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
                className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-amber-300/50"
              >
                <option value="">Método de pago</option>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Nota (opcional)"
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-amber-300/50"
            />
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-b from-amber-300 to-amber-400 text-zinc-950 font-semibold text-sm disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Registrar gasto
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto w-full space-y-5">
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
        <div className="flex items-end justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-base font-semibold text-foreground">Gastos del día</h3>
            <p className="text-xs text-muted-foreground capitalize">
              {new Date().toLocaleDateString("es-AR", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xl font-bold text-rose-300 tabular-nums">
              -${total.toLocaleString("es-AR")}
            </div>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-amber-400 text-zinc-950 px-4 py-2.5 text-sm font-semibold"
            >
              <Plus className="size-4" /> Nuevo gasto
            </button>
          </div>
        </div>
      </div>

      {/* Formulario */}
      {showForm && (
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">Nuevo gasto</h3>
        <div className="space-y-2.5">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Nombre del gasto *"
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-amber-300/50"
          />
          <input
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="Monto *"
            type="number"
            min={0}
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-amber-300/50"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-amber-300/50"
            >
              <option value="">Tipo</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
            <select
              value={form.method}
              onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
              className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-amber-300/50"
            >
              <option value="">Método de pago</option>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Nota (opcional)"
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-amber-300/50"
          />
          <button
            onClick={save}
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-b from-amber-300 to-amber-400 text-zinc-950 font-semibold text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Registrar gasto
          </button>
        </div>
      </div>
      )}

      {/* Lista */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] overflow-hidden">
        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
            <Loader2 className="size-4 animate-spin" /> Cargando…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            Sin gastos registrados.
          </div>
        ) : (
          rows.map((g) => (
            <div
              key={g.id}
              className="flex items-center gap-3 px-5 py-3 border-b border-white/5 last:border-0"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">{g.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {g.type ?? ""}
                  {g.payment_method ? ` · ${g.payment_method}` : ""}
                </div>
                {g.note && <div className="text-[11px] text-muted-foreground/70">{g.note}</div>}
              </div>
              <div className="text-sm font-semibold text-rose-300 tabular-nums">
                -${Number(g.amount).toLocaleString("es-AR")}
              </div>
              <button
                onClick={() => remove(g.id)}
                className="size-7 grid place-items-center rounded-md border border-rose-400/30 text-rose-300 hover:bg-rose-400/10"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
