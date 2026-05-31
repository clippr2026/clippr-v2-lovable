import * as React from "react";
import { toast } from "sonner";
import { Loader2, Pencil, X, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Portado de pxLoad / pxSave / pxEdit / pxDelete (app.js ~10151-10310).
 * Tabla: price_catalog (id, business_id, category, name, price, duration_min, active)
 * Soft delete vía active=false.
 */

type CatSlug = "servicios" | "bebidas" | "productos";

const TABS: { slug: CatSlug; label: string; title: string }[] = [
  { slug: "servicios", label: "Servicios", title: "Agregar servicio" },
  { slug: "bebidas", label: "Bebidas", title: "Agregar bebida" },
  { slug: "productos", label: "Productos", title: "Agregar producto" },
];

type Row = {
  id: string;
  name: string;
  price: number;
  duration_min: number | null;
  category: string;
  active: boolean;
};

export function PreciosTab({ businessId }: { businessId: string | null }) {
  const [cat, setCat] = React.useState<CatSlug>("servicios");
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ name: "", price: "", duration: "" });
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!businessId) return;
    setLoading(true);

    // Load valid category slugs (same as Catálogo)
    let validSlugs: string[] = [];
    try {
      const { data: bsData } = await supabase
        .from("business_settings")
        .select("cat_custom_tabs")
        .eq("business_id", businessId)
        .maybeSingle();
      if (Array.isArray(bsData?.cat_custom_tabs)) {
        validSlugs = (bsData.cat_custom_tabs as Array<string | { slug: string }>)
          .map((c) => (typeof c === "string" ? c : c.slug))
          .filter(Boolean);
      }
    } catch (e) { console.warn("[PreciosTab] cat_custom_tabs:", (e as Error).message); }

    const { data, error } = await supabase
      .from("price_catalog")
      .select("id,name,price,duration_min,category,active")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("category")
      .order("name");
    if (error) toast.error("Error cargando precios: " + error.message);

    let filtered = (data ?? []) as Row[];
    if (validSlugs.length > 0) {
      filtered = filtered.filter((r) => r.category && validSlugs.includes(r.category));
    }
    setRows(filtered);
    setLoading(false);
  }, [businessId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const items = rows.filter((r) => r.category === cat);

  function resetForm() {
    setForm({ name: "", price: "", duration: "" });
    setEditId(null);
  }

  function startEdit(r: Row) {
    setEditId(r.id);
    setForm({
      name: r.name,
      price: String(r.price),
      duration: r.duration_min ? String(r.duration_min) : "",
    });
  }

  async function save() {
    if (!businessId) return;
    const name = form.name.trim();
    const price = parseFloat(form.price);
    const duration = parseInt(form.duration) || null;
    if (!name) return toast.error("Ingresá un nombre.");
    if (isNaN(price)) return toast.error("Ingresá un precio válido.");

    setSaving(true);
    const payload = {
      business_id: businessId,
      category: cat,
      name,
      price,
      duration_min: duration,
      active: true,
    };
    const { error } = editId
      ? await supabase.from("price_catalog").update(payload).eq("id", editId)
      : await supabase.from("price_catalog").insert(payload);
    setSaving(false);
    if (error) return toast.error("No se pudo guardar: " + error.message);
    toast.success(editId ? "✓ Actualizado" : "✓ Agregado");
    resetForm();
    load();
  }

  async function softDelete(r: Row) {
    if (!confirm(`¿Eliminar "${r.name}"?`)) return;
    const { error } = await supabase
      .from("price_catalog")
      .update({ active: false })
      .eq("id", r.id);
    if (error) return toast.error("Error al eliminar: " + error.message);
    toast.success(`✓ "${r.name}" eliminado`);
    load();
  }

  const currentTab = TABS.find((t) => t.slug === cat)!;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-1 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.slug}
            onClick={() => {
              setCat(t.slug);
              resetForm();
            }}
            className={cn(
              "flex-1 px-3 py-2 rounded-xl text-sm font-medium transition-all",
              cat === t.slug
                ? "bg-gradient-to-b from-amber-300/15 to-amber-300/0 border border-amber-300/30 text-foreground"
                : "text-muted-foreground hover:text-foreground border border-transparent"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] overflow-hidden">
        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
            <Loader2 className="size-4 animate-spin" /> Cargando…
          </div>
        ) : items.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            Sin precios cargados — agregá el primero abajo.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_140px_140px_100px] px-5 py-3 text-[11px] tracking-[0.16em] text-muted-foreground/70 border-b border-white/5">
              <div>{currentTab.label.slice(0, -1).toUpperCase()}</div>
              <div>PRECIO</div>
              <div>DURACIÓN</div>
              <div />
            </div>
            {items.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[1fr_140px_140px_100px] px-5 py-3 text-sm border-b border-white/5 last:border-0 items-center"
              >
                <div className="text-foreground font-medium">{r.name}</div>
                <div className="text-amber-200 font-semibold tabular-nums">
                  ${Number(r.price).toLocaleString("es-AR")}
                </div>
                <div className="text-muted-foreground">
                  {r.duration_min ? `${r.duration_min} min` : "—"}
                </div>
                <div className="flex gap-1.5 justify-end">
                  <button
                    onClick={() => startEdit(r)}
                    className="size-7 grid place-items-center rounded-md border border-white/10 hover:border-white/25 text-muted-foreground hover:text-foreground transition"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => softDelete(r)}
                    className="size-7 grid place-items-center rounded-md border border-rose-400/30 text-rose-300 hover:bg-rose-400/10 transition"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Formulario */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
        <h3 className="text-base font-semibold text-foreground">
          {editId ? "Editando ítem" : currentTab.title}
        </h3>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_140px_140px] gap-3">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Nombre"
            className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-amber-300/50"
          />
          <input
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            placeholder="Precio"
            type="number"
            min={0}
            className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-amber-300/50"
          />
          <input
            value={form.duration}
            onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
            placeholder="Min (opt)"
            type="number"
            min={0}
            className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-amber-300/50"
          />
        </div>
        <div className="mt-4 flex gap-2">
          <button
            disabled={saving}
            onClick={save}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-b from-amber-300 to-amber-400 text-zinc-950 font-semibold text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {editId ? "Guardar cambios" : "Agregar"}
          </button>
          {editId && (
            <button
              onClick={resetForm}
              className="px-4 py-2.5 rounded-lg border border-white/10 text-muted-foreground hover:text-foreground text-sm"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
