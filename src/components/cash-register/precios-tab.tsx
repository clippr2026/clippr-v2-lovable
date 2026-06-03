import * as React from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Vista sincronizada de Configuración → Servicios y Catálogo.
 * Sin formulario propio. Fuente única: price_catalog.
 * Estructura:
 *   SERVICIOS → subcategorías de servicios (ej: Servicios, Color)
 *   luego tabs de catálogo (ej: Productos, Bebidas, Indumentaria)
 */

type Row = {
  id: string;
  name: string;
  price: number;
  cash_discount: number | null; // % descuento efectivo
  duration_min: number | null;
  category: string | null;
  active: boolean;
  stock: number | null;
};

function cashPrice(price: number, discountPct: number | null) {
  const d = Number(discountPct ?? 0);
  if (d <= 0) return null;
  return Math.round(price - (price * d) / 100);
}

export function PreciosTab({ businessId }: { businessId: string | null }) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<string>("");

  const load = React.useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("price_catalog")
      .select("id,name,price,cash_discount,duration_min,category,active,stock")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("name");
    // cash_discount may not exist in schema — handle gracefully
    const safe = (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      price: Number(r.price ?? 0),
      cash_discount: typeof r.cash_discount === "number" ? r.cash_discount : null,
      duration_min: r.duration_min as number | null,
      category: r.category as string | null,
      active: r.active !== false,
      stock: typeof r.stock === "number" ? r.stock : null,
    }));
    setRows(safe);
    setLoading(false);
  }, [businessId]);

  React.useEffect(() => { load(); }, [load]);

  // Build tab structure:
  // Services: group by their category (e.g. "Servicios", "Color")
  // Catalog: each category becomes a tab (e.g. "Productos", "Bebidas")
  const serviceRows = rows.filter((r) => r.duration_min != null);
  const catalogRows = rows.filter((r) => r.duration_min == null);

  const serviceCats = Array.from(new Set(serviceRows.map((r) => r.category || "Servicios")));
  const catalogCats = Array.from(new Set(catalogRows.map((r) => r.category || "Productos")));
  const allTabs = [...serviceCats, ...catalogCats];

  React.useEffect(() => {
    if (allTabs.length > 0 && !allTabs.includes(tab)) setTab(allTabs[0]);
  }, [allTabs.join(",")]);

  const isServiceTab = serviceCats.includes(tab);
  const filtered = isServiceTab
    ? serviceRows.filter((r) => (r.category || "Servicios") === tab)
    : catalogRows.filter((r) => (r.category || "Productos") === tab);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-5 py-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2 w-full">
        <Loader2 className="size-4 animate-spin" /> Cargando precios…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-5 py-12 text-center text-sm text-muted-foreground">
        Sin precios cargados. Agregá servicios en <strong>Configuración → Servicios</strong> y productos en <strong>Configuración → Catálogo</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section labels + tabs */}
      <div className="space-y-2">
        {serviceCats.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 w-20 shrink-0">Servicios</span>
            {serviceCats.map((c) => (
              <button key={c} onClick={() => setTab(c)}
                className={cn("rounded-full border px-4 py-1.5 text-xs whitespace-nowrap font-medium transition-colors",
                  tab === c ? "border-amber-300/50 bg-amber-300/10 text-amber-200" : "border-white/10 bg-white/[0.025] text-muted-foreground hover:text-foreground")}>
                {c}
              </button>
            ))}
          </div>
        )}
        {catalogCats.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 w-20 shrink-0">Catálogo</span>
            {catalogCats.map((c) => (
              <button key={c} onClick={() => setTab(c)}
                className={cn("rounded-full border px-4 py-1.5 text-xs whitespace-nowrap font-medium transition-colors",
                  tab === c ? "border-amber-300/50 bg-amber-300/10 text-amber-200" : "border-white/10 bg-white/[0.025] text-muted-foreground hover:text-foreground")}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Items table */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">Sin ítems en esta categoría.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {/* Header */}
            <div className={cn("grid px-5 py-3 text-[10px] tracking-[0.16em] text-muted-foreground/60 uppercase",
              isServiceTab ? "grid-cols-[1fr_110px_110px_90px]" : "grid-cols-[1fr_110px_110px_60px]")}>
              <div>Nombre</div>
              <div className="text-right">Lista</div>
              <div className="text-right text-amber-200/70">Efectivo</div>
              <div className="text-right">{isServiceTab ? "Min" : "Stock"}</div>
            </div>
            {filtered.map((r) => {
              const cash = cashPrice(r.price, r.cash_discount);
              return (
                <div key={r.id}
                  className={cn("grid px-5 py-4 items-center hover:bg-white/[0.02] transition-colors",
                    isServiceTab ? "grid-cols-[1fr_110px_110px_90px]" : "grid-cols-[1fr_110px_110px_60px]")}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{r.name}</div>
                  </div>
                  <div className="text-right text-sm tabular-nums text-muted-foreground">
                    ${Number(r.price).toLocaleString("es-AR")}
                  </div>
                  <div className="text-right tabular-nums">
                    {cash != null ? (
                      <span className="text-sm font-semibold text-amber-200">
                        ${cash.toLocaleString("es-AR")}
                        <span className="ml-1 text-[10px] text-muted-foreground font-normal">({r.cash_discount}%)</span>
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground/40">—</span>
                    )}
                  </div>
                  <div className="text-right text-sm text-muted-foreground tabular-nums">
                    {isServiceTab
                      ? r.duration_min ? `${r.duration_min} min` : "—"
                      : r.stock != null ? r.stock : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Editá precios en <strong>Configuración → Servicios</strong> o <strong>Configuración → Catálogo</strong>.
      </p>
    </div>
  );
}
