import * as React from "react";
import { toast } from "sonner";
import { Loader2, Minus, Plus, History, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Portado de cjLoadInventario / cjOpenStockModal / cjConfirmStock / cjLoadHistory
 * (app.js ~9300-9572).
 * Tablas: price_catalog (stock, stock_min, stock_critical, active),
 *         stock_movements (type: ingreso/retiro/ajuste, qty, stock_before,
 *         stock_after, product_id, product_name, user_email, note)
 */

type Product = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  stock: number | null;
  stock_min: number | null;
  stock_critical: number | null;
  active: boolean;
  duration_min?: number | null;
};

type Movement = {
  id: string;
  product_id: string | null;
  product_name: string | null;
  type: string;
  qty: number;
  stock_before: number | null;
  stock_after: number | null;
  user_email: string | null;
  note: string | null;
  created_at: string;
};

function mvStyle(type: string) {
  if (["ingreso", "in", "inicial"].includes(type))
    return { color: "text-emerald-300", sign: "+", label: type === "inicial" ? "INICIAL" : "INGRESO" };
  if (type === "venta") return { color: "text-amber-300", sign: "-", label: "VENTA" };
  if (type === "ajuste") return { color: "text-muted-foreground", sign: "±", label: "AJUSTE" };
  return { color: "text-rose-300", sign: "-", label: "RETIRO" };
}

export function InventarioTab({
  businessId,
  userEmail,
}: {
  businessId: string | null;
  userEmail: string | null;
}) {
  const [products, setProducts] = React.useState<Product[]>([]);
  const [movements, setMovements] = React.useState<Movement[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [activeCat, setActiveCat] = React.useState<string>("");
  const [modal, setModal] = React.useState<{ product: Product; direction: -1 | 0 | 1 } | null>(null);
  const [showHistory, setShowHistory] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!businessId) return;
    setLoading(true);

    const [{ data: items, error: itemsError }, { data: movs, error: movsError }] = await Promise.all([
      supabase
        .from("price_catalog")
        .select("id,name,category,price,duration_min,stock,stock_min,stock_critical,active")
        .eq("business_id", businessId)
        .order("category")
        .order("name"),
      supabase
        .from("stock_movements")
        .select("id,product_id,product_name,type,qty,stock_before,stock_after,user_email,note,created_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (itemsError) toast.error("Error cargando catálogo: " + itemsError.message);
    if (movsError) toast.error("Error cargando movimientos: " + movsError.message);

    // Inventario debe mostrar exactamente los productos de Configuración → Catálogo.
    // Servicios quedan afuera porque tienen duration_min.
    const catalogProducts = ((items ?? []) as Product[]).filter((item) => {
      const category = (item.category ?? "").toLowerCase();
      return item.duration_min == null && !category.includes("servicio");
    });

    setProducts(catalogProducts);
    setMovements((movs ?? []) as Movement[]);
    setLoading(false);
  }, [businessId]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    if (!businessId) return;

    const reloadInventory = () => load();
    window.addEventListener("clippr:catalog-stock-saved", reloadInventory);

    const channel = supabase
      .channel(`inventory_price_catalog_${businessId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "price_catalog",
          filter: `business_id=eq.${businessId}`,
        },
        () => load(),
      )
      .subscribe();

    return () => {
      window.removeEventListener("clippr:catalog-stock-saved", reloadInventory);
      supabase.removeChannel(channel);
    };
  }, [businessId, load]);

  // Categories from actual data
  const categories = React.useMemo(
    () => Array.from(new Set(products.map((p) => p.category ?? "Productos"))),
    [products]
  );

  React.useEffect(() => {
    if (categories.length > 0 && !categories.includes(activeCat)) setActiveCat(categories[0]);
  }, [categories.join(",")]);

  const filtered = products.filter((p) => (p.category ?? "Productos") === activeCat);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-5 py-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2 w-full">
        <Loader2 className="size-4 animate-spin" /> Cargando inventario…
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-5 py-12 text-center text-sm text-muted-foreground">
        Sin productos en el catálogo. Cargá productos en <strong>Configuración → Catálogo</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Horizontal category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {categories.map((c) => (
          <button key={c} onClick={() => setActiveCat(c)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-xs whitespace-nowrap font-medium transition-colors",
              activeCat === c
                ? "border-amber-300/50 bg-amber-300/10 text-amber-200"
                : "border-white/10 bg-white/[0.025] text-muted-foreground hover:text-foreground"
            )}>
            {c}
          </button>
        ))}
      </div>

      {/* Products in active category */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">Sin productos en esta categoría.</div>
        ) : (
          <div className="divide-y divide-white/5">
            <div className="grid grid-cols-[1fr_80px_80px_100px] px-5 py-3 text-[10px] tracking-[0.16em] text-muted-foreground/60 uppercase">
              <div>Producto</div>
              <div className="text-center">Stock</div>
              <div className="text-center">Estado</div>
              <div />
            </div>
            {filtered.map((p) => {
              const stock = Number(p.stock ?? 0);
              const min = Number(p.stock_min ?? 0);
              const crit = Number(p.stock_critical ?? 0);
              let badge: { cls: string; label: string } | null = null;
              let stockCls = "text-foreground";
              if (stock === 0) { badge = { cls: "bg-rose-400/15 text-rose-300 ring-rose-400/20", label: "SIN STOCK" }; stockCls = "text-rose-300"; }
              else if (crit > 0 && stock <= crit) { badge = { cls: "bg-rose-400/15 text-rose-300 ring-rose-400/20", label: "CRÍTICO" }; stockCls = "text-rose-300"; }
              else if (min > 0 && stock <= min) { badge = { cls: "bg-amber-400/15 text-amber-300 ring-amber-400/20", label: "BAJO" }; stockCls = "text-amber-300"; }
              else { badge = { cls: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20", label: "OK" }; }
              return (
                <div key={p.id} className="grid grid-cols-[1fr_80px_80px_100px] px-5 py-3.5 items-center hover:bg-white/[0.02] transition-colors">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{p.name}</div>
                    {(min > 0 || crit > 0) && (
                      <div className="text-[11px] text-muted-foreground">
                        {min > 0 && `Avisar ≤${min}`}{min > 0 && crit > 0 && " · "}{crit > 0 && `Crítico ≤${crit}`}
                      </div>
                    )}
                  </div>
                  <div className={cn("text-center text-xl font-bold tabular-nums", stockCls)}>{stock}</div>
                  <div className="flex justify-center">
                    {badge && <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium ring-1", badge.cls)}>{badge.label}</span>}
                  </div>
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => setModal({ product: p, direction: -1 })}
                      className="size-8 grid place-items-center rounded-md border border-white/10 text-muted-foreground hover:text-foreground transition-colors">
                      <Minus className="size-4" />
                    </button>
                    <button onClick={() => setModal({ product: p, direction: 1 })}
                      className="size-8 grid place-items-center rounded-md bg-gradient-to-b from-amber-300 to-amber-400 text-zinc-950">
                      <Plus className="size-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent movements */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-base font-semibold text-foreground">Últimos movimientos</h3>
          <button onClick={() => setShowHistory(true)}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
            <History className="size-3.5" /> Ver todo
          </button>
        </div>
        {movements.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">Sin movimientos.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-white/10">
                  {["Fecha", "Producto", "Tipo", "Cant.", "Stock", "Nota"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movements.slice(0, 8).map((m) => {
                  const s = mvStyle(m.type);
                  return (
                    <tr key={m.id} className="border-b border-white/5 last:border-0">
                      <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(m.created_at).toLocaleString("es-AR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-5 py-3 text-foreground whitespace-nowrap">{m.product_name ?? "—"}</td>
                      <td className="px-5 py-3 text-[10px] whitespace-nowrap">{s.label}</td>
                      <td className={cn("px-5 py-3 font-bold whitespace-nowrap", s.color)}>
                        {s.sign}
                        {m.qty}
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {m.stock_before != null ? `${m.stock_before} → ${m.stock_after}` : "—"}
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">
                        {m.note ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <StockModal product={modal.product} direction={modal.direction}
          businessId={businessId!} userEmail={userEmail}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />
      )}
      {showHistory && <HistoryModal businessId={businessId!} onClose={() => setShowHistory(false)} />}
    </div>
  );
}

function StockModal({
  product,
  direction,
  businessId,
  userEmail,
  onClose,
  onSaved,
}: {
  product: Product;
  direction: -1 | 0 | 1;
  businessId: string;
  userEmail: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [qty, setQty] = React.useState("1");
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const stockBefore = Number(product.stock ?? 0);
  const label = direction === 0 ? "Ajustar stock" : direction > 0 ? "Ingresar stock" : "Retirar stock";

  async function confirm() {
    const q = parseInt(qty);
    if (!q || q <= 0) return toast.error("Cantidad debe ser mayor a 0");
    setSaving(true);

    const isAdjust = direction === 0;
    const type = isAdjust ? "ajuste" : direction > 0 ? "ingreso" : "retiro";
    const delta = direction > 0 ? q : -q;
    const stockAfter = isAdjust ? Math.max(0, q) : Math.max(0, stockBefore + delta);

    const { error: updErr } = await supabase
      .from("price_catalog")
      .update({ stock: stockAfter })
      .eq("id", product.id)
      .eq("business_id", businessId);
    if (updErr) {
      setSaving(false);
      return toast.error("Error actualizando stock: " + updErr.message);
    }

    const { error: insErr } = await supabase.from("stock_movements").insert({
      business_id: businessId,
      product_id: product.id,
      product_name: product.name,
      type,
      qty: q,
      stock_before: stockBefore,
      stock_after: stockAfter,
      user_email: userEmail ?? "desconocido",
      note: note.trim() || null,
    });
    setSaving(false);
    window.dispatchEvent(new CustomEvent("clippr:catalog-stock-saved", {
      detail: { productId: product.id, stock: stockAfter },
    }));
    if (insErr) toast.warning("Stock OK, historial falló: " + insErr.message);
    else toast.success("✓ Movimiento registrado y sincronizado");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground">{label}</h3>
          <button onClick={onClose} className="text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="text-xs text-muted-foreground mb-4">
          {product.name} · Stock actual: <span className="text-foreground font-semibold">{stockBefore}</span>
        </div>
        <label className="text-[11px] text-muted-foreground">Cantidad</label>
        <input
          autoFocus
          type="number"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-3 text-xl font-bold text-center text-foreground mt-1 mb-3 focus:outline-none focus:border-amber-300/50"
        />
        <label className="text-[11px] text-muted-foreground">Nota / responsable (opcional)</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ej: Reposición proveedor"
          className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground mt-1 mb-4 focus:outline-none focus:border-amber-300/50"
        />
        <div className="flex gap-2">
          <button
            disabled={saving}
            onClick={confirm}
            className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-amber-300 to-amber-400 text-zinc-950 font-semibold text-sm disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Confirmar"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-white/10 text-muted-foreground text-sm"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryModal({ businessId, onClose }: { businessId: string; onClose: () => void }) {
  const [rows, setRows] = React.useState<Movement[] | null>(null);

  React.useEffect(() => {
    supabase
      .from("stock_movements")
      .select(
        "id,product_id,product_name,type,qty,stock_before,stock_after,user_email,note,created_at"
      )
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setRows((data ?? []) as Movement[]));
  }, [businessId]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-4xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-foreground">Historial de movimientos</h3>
          <button onClick={onClose} className="text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {rows === null ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Cargando…</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Sin movimientos.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-white/10">
                  {["Fecha", "Producto", "Tipo", "Cant.", "Stock", "Nota"].map((h) => (
                    <th key={h} className="px-2 py-2 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const s = mvStyle(m.type);
                  return (
                    <tr key={m.id} className="border-b border-white/5">
                      <td className="px-2 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(m.created_at).toLocaleString("es-AR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-2 py-2 text-foreground">{m.product_name ?? "—"}</td>
                      <td className="px-2 py-2 text-[10px]">{s.label}</td>
                      <td className={cn("px-2 py-2 font-bold", s.color)}>
                        {s.sign}
                        {m.qty}
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {m.stock_before != null ? `${m.stock_before} → ${m.stock_after}` : "—"}
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">{m.note ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
