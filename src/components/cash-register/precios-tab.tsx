import * as React from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Vista de Precios — misma query y misma lógica de categorías que Configuración → Servicios/Catálogo.
 * Fuente: price_catalog, mismas columnas, mismo filtro.
 * Servicios:  duration_min != null
 * Catálogo:   duration_min == null && category no incluye "servicio"
 * Categorías: business_settings.schedule._categories (igual que Configuración)
 */

type Row = {
  id: string;
  name: string;
  price: number;
  cash_discount: number | null;
  duration_min: number | null;
  category: string | null;
  active: boolean | null;
  stock: number | null;
};

function cashPrice(price: number, discount: number | null) {
  const d = Number(discount ?? 0);
  return Math.round(price - (price * d) / 100);
}

const DEFAULT_SERVICE_CATS = ["Servicios"];
const DEFAULT_CATALOG_CATS = ["Productos", "Bebidas", "Indumentaria"];

export function PreciosTab({ businessId }: { businessId: string | null }) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [serviceCats, setServiceCats] = React.useState<string[]>(DEFAULT_SERVICE_CATS);
  const [catalogCats, setCatalogCats] = React.useState<string[]>(DEFAULT_CATALOG_CATS);

  const load = React.useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);

    // Exact same query as PriceCatalogSection in settings.tsx
    const [rowsRes, scheduleRes] = await Promise.all([
      supabase
        .from("price_catalog")
        .select("id,name,price,cash_discount,duration_min,category,active,stock")
        .eq("business_id", businessId)
        .order("category")
        .order("name"),
      supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);

    setRows((rowsRes.data ?? []) as Row[]);

    // Exact same category loading as PriceCatalogSection
    const schedule = (scheduleRes.data?.schedule ?? {}) as Record<string, unknown>;
    const cats = (schedule._categories ?? {}) as Record<string, unknown>;
    if (Array.isArray(cats.service) && cats.service.length > 0)
      setServiceCats(cats.service as string[]);
    if (Array.isArray(cats.catalog) && cats.catalog.length > 0)
      setCatalogCats(cats.catalog as string[]);

    setLoading(false);
  }, [businessId]);

  React.useEffect(() => { load(); }, [load]);

  // Exact same visibleRows logic as PriceCatalogSection
  const serviceRows = rows.filter((r) => r.duration_min != null);
  const catalogRows = rows.filter((r) => {
    const cat = (r.category || "Productos").toLowerCase();
    return r.duration_min == null && !cat.includes("servicio");
  });

  // Categories exactly as in PriceCatalogSection
  const finalServiceCats = Array.from(new Set([...serviceCats, ...serviceRows.map((r) => r.category || "Servicios")]));
  const finalCatalogCats = Array.from(new Set([...catalogCats, ...catalogRows.map((r) => r.category || "Productos")]));

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
    <div className="grid md:grid-cols-2 gap-4">
      {/* ── COLUMNA SERVICIOS ── */}
      <div className="space-y-3">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/70 px-1">
          Servicios
        </div>
        {finalServiceCats.map((catName) => {
          const items = serviceRows.filter((r) => (r.category || "Servicios") === catName);
          if (items.length === 0) return null;
          return (
            <div key={catName} className="rounded-[24px] border border-white/[0.08] bg-white/[0.03] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="px-4 py-2.5 text-[11px] uppercase tracking-[0.16em] font-semibold text-muted-foreground/60 border-b border-white/5">
                {catName}
              </div>
              <div className="divide-y divide-white/5">
                {items.map((r) => {
                  const cash = cashPrice(r.price, r.cash_discount);
                  return (
                    <div key={r.id} className="px-4 py-3.5 flex items-center justify-between gap-4 hover:bg-white/[0.025] transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-foreground truncate">{r.name}</div>
                        {r.duration_min && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">{r.duration_min} min</div>
                        )}
                      </div>
                      <div className="shrink-0 min-w-[155px] rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
                        <div className="flex items-center justify-between gap-3 text-sm tabular-nums">
                          <span className="text-white/40">Lista</span>
                          <span className="font-semibold text-white/70">${Number(r.price).toLocaleString("es-AR")}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-3 text-sm tabular-nums">
                          <span className="text-blue-300/70">Ef.</span>
                          <span className="font-semibold text-blue-200">${cash.toLocaleString("es-AR")}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {serviceRows.length === 0 && (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-10 text-center text-sm text-muted-foreground">
            Sin servicios. Cargalos en Configuración → Servicios.
          </div>
        )}
      </div>

      {/* ── COLUMNA CATÁLOGO ── */}
      <div className="space-y-3">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/70 px-1">
          Catálogo
        </div>
        {finalCatalogCats.map((catName) => {
          const items = catalogRows.filter((r) => (r.category || "Productos") === catName);
          if (items.length === 0) return null;
          return (
            <div key={catName} className="rounded-[24px] border border-white/[0.08] bg-white/[0.03] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="px-4 py-2.5 text-[11px] uppercase tracking-[0.16em] font-semibold text-muted-foreground/60 border-b border-white/5">
                {catName}
              </div>
              <div className="divide-y divide-white/5">
                {items.map((r) => {
                  const cash = cashPrice(r.price, r.cash_discount);
                  return (
                    <div key={r.id} className="px-4 py-3.5 flex items-center justify-between gap-4 hover:bg-white/[0.025] transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-foreground truncate">{r.name}</div>
                        {typeof r.stock === "number" && (
                          <div className={cn("text-[11px] mt-0.5",
                            r.stock === 0 ? "text-rose-300" : r.stock <= 3 ? "text-blue-300" : "text-muted-foreground")}>
                            Stock: {r.stock}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 min-w-[155px] rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
                        <div className="flex items-center justify-between gap-3 text-sm tabular-nums">
                          <span className="text-white/40">Lista</span>
                          <span className="font-semibold text-white/70">${Number(r.price).toLocaleString("es-AR")}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-3 text-sm tabular-nums">
                          <span className="text-blue-300/70">Ef.</span>
                          <span className="font-semibold text-blue-200">${cash.toLocaleString("es-AR")}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {catalogRows.length === 0 && (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-10 text-center text-sm text-muted-foreground">
            Sin productos. Cargalos en Configuración → Catálogo.
          </div>
        )}
      </div>
    </div>
  );
}
