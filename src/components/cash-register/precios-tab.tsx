import * as React from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Vista de solo lectura — muestra los precios cargados en Configuración → Servicios y Catálogo.
 * No tiene formulario propio. La única fuente de verdad es price_catalog.
 */

type Row = {
  id: string;
  name: string;
  price: number;
  duration_min: number | null;
  category: string | null;
  active: boolean;
  stock: number | null;
};

export function PreciosTab({ businessId }: { businessId: string | null }) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [cat, setCat] = React.useState<string>("Servicios");

  const load = React.useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("price_catalog")
      .select("id,name,price,duration_min,category,active,stock")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("category")
      .order("name");
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [businessId]);

  React.useEffect(() => { load(); }, [load]);

  // Build ordered categories: Servicios first, then catalog categories
  const categories = React.useMemo(() => {
    const services = rows.filter((r) => r.duration_min != null);
    const catalog = rows.filter((r) => r.duration_min == null);
    const cats: string[] = [];
    if (services.length > 0) cats.push("Servicios");
    const catalogCats = Array.from(new Set(catalog.map((r) => r.category || "Productos")));
    return [...cats, ...catalogCats];
  }, [rows]);

  // Set default to first available category
  React.useEffect(() => {
    if (categories.length > 0 && !categories.includes(cat)) setCat(categories[0]);
  }, [categories, cat]);

  const filtered = React.useMemo(() => {
    if (cat === "Servicios") return rows.filter((r) => r.duration_min != null);
    return rows.filter((r) => r.duration_min == null && (r.category || "Productos") === cat);
  }, [rows, cat]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-5 py-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Cargando precios…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-5 py-12 text-center text-sm text-muted-foreground">
        Sin precios cargados. Agregá servicios en Configuración → Servicios y productos en Configuración → Catálogo.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-xs whitespace-nowrap transition-colors font-medium",
              cat === c
                ? "border-amber-300/50 bg-amber-300/10 text-amber-200"
                : "border-white/10 bg-white/[0.025] text-muted-foreground hover:text-foreground"
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Items */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            Sin ítems en esta categoría.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {/* Header */}
            <div className="grid grid-cols-[1fr_120px_100px_80px] px-5 py-3 text-[10px] tracking-[0.16em] text-muted-foreground/60 uppercase">
              <div>Nombre</div>
              <div className="text-right">Precio</div>
              <div className="text-right">{cat === "Servicios" ? "Duración" : "Stock"}</div>
              <div />
            </div>
            {filtered.map((r) => (
              <div key={r.id} className="grid grid-cols-[1fr_120px_100px_80px] px-5 py-3.5 items-center hover:bg-white/[0.02] transition-colors">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{r.name}</div>
                  {r.duration_min && (
                    <div className="text-[11px] text-muted-foreground">{r.duration_min} min</div>
                  )}
                </div>
                <div className="text-right font-display font-semibold text-sm text-amber-200 tabular-nums">
                  ${Number(r.price).toLocaleString("es-AR")}
                </div>
                <div className="text-right text-sm text-muted-foreground tabular-nums">
                  {cat === "Servicios"
                    ? r.duration_min ? `${r.duration_min} min` : "—"
                    : typeof r.stock === "number" ? r.stock : "—"}
                </div>
                <div className="flex justify-end">
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20">
                    <span className="size-1.5 rounded-full bg-emerald-400" /> Activo
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Para agregar o editar precios, ir a <strong>Configuración → Servicios</strong> o <strong>Configuración → Catálogo</strong>.
      </p>
    </div>
  );
}
