import * as React from "react";
import { toast } from "sonner";
import { CalendarClock, Check, Loader2, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cajaDateKeyBA } from "@/lib/caja-cierre";
import { cn } from "@/lib/utils";
import { VentanaClippr } from "@/components/clientes/ventana-clippr";

// Gastos a pagar: compras (productos, bebidas…) que se pagan más adelante, con fecha de vencimiento.
// Mientras están pendientes no cuentan como gasto; al pagarlas se convierten en un gasto normal (pay_payable_expense_v1).

export type GastoAPagar = {
  id: string;
  name: string;
  amount: number;
  kind: string | null;
  supplier: string | null;
  due_date: string;
  note: string | null;
};

const EVENTO = "clippr:gastos-a-pagar";
const sb = supabase as any;

export function avisarCambioGastosAPagar() {
  window.dispatchEvent(new CustomEvent(EVENTO));
}

export function useGastosAPagar(businessId: string | null) {
  const [filas, setFilas] = React.useState<GastoAPagar[]>([]);
  const [cargando, setCargando] = React.useState(true);

  const cargar = React.useCallback(async () => {
    if (!businessId) return;
    const { data, error } = await sb
      .from("payable_expenses")
      .select("id,name,amount,kind,supplier,due_date,note")
      .eq("business_id", businessId)
      .eq("status", "pending")
      .order("due_date", { ascending: true });
    // Si la tabla todavía no existe, la lista queda vacía (no rompe la caja).
    setFilas(error ? [] : ((data ?? []) as GastoAPagar[]).map((r) => ({ ...r, amount: Number(r.amount) })));
    setCargando(false);
  }, [businessId]);

  React.useEffect(() => {
    void cargar();
    window.addEventListener(EVENTO, cargar);
    return () => window.removeEventListener(EVENTO, cargar);
  }, [cargar]);

  return { filas, cargando, recargar: cargar };
}

function diasHasta(fecha: string, hoy: string) {
  const a = Date.parse(`${fecha}T00:00:00Z`);
  const b = Date.parse(`${hoy}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

export function etiquetaVencimiento(fecha: string, hoy = cajaDateKeyBA()) {
  const d = diasHasta(fecha, hoy);
  if (d < 0) return { texto: d === -1 ? "Venció ayer" : `Venció hace ${-d} días`, tono: "text-rose-300 bg-rose-400/10 ring-rose-400/30" };
  if (d === 0) return { texto: "Vence hoy", tono: "text-amber-200 bg-amber-400/10 ring-amber-400/30" };
  if (d === 1) return { texto: "Vence mañana", tono: "text-amber-200 bg-amber-400/10 ring-amber-400/30" };
  if (d <= 7) return { texto: `Vence en ${d} días`, tono: "text-amber-200 bg-amber-400/10 ring-amber-400/30" };
  return { texto: `Vence en ${d} días`, tono: "text-white/70 bg-white/5 ring-white/10" };
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const fechaCorta = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/** Cartel chico para el resumen de la caja: total a pagar y cuántos vencen esta semana. */
export function CartelAPagar({ businessId, onClick }: { businessId: string | null; onClick: () => void }) {
  const { filas } = useGastosAPagar(businessId);
  if (filas.length === 0) return null;
  const hoy = cajaDateKeyBA();
  const total = filas.reduce((s, f) => s + f.amount, 0);
  const proximos = filas.filter((f) => diasHasta(f.due_date, hoy) <= 7).length;
  const vencidos = filas.filter((f) => diasHasta(f.due_date, hoy) < 0).length;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mt-2 flex w-full items-center gap-2 rounded-full border px-4 py-2 text-left text-xs font-semibold transition",
        vencidos > 0
          ? "border-rose-400/40 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15"
          : "border-amber-300/30 bg-amber-300/[0.07] text-amber-100 hover:bg-amber-300/10",
      )}
    >
      <CalendarClock className="size-4 shrink-0" />
      <span className="truncate">
        A pagar {fmt(total)}
        {vencidos > 0 ? ` · ${vencidos} vencido${vencidos === 1 ? "" : "s"}` : proximos > 0 ? ` · ${proximos} vence${proximos === 1 ? "" : "n"} esta semana` : ""}
      </span>
    </button>
  );
}

/** Lista de gastos a pagar (arriba de la pestaña Gastos), con pagar, editar y borrar. */
export function GastosAPagarLista({ businessId, userEmail, activeBranchId }: { businessId: string | null; userEmail: string | null; activeBranchId?: string | null }) {
  const { filas, cargando, recargar } = useGastosAPagar(businessId);
  const [pagando, setPagando] = React.useState<GastoAPagar | null>(null);
  const [editando, setEditando] = React.useState<GastoAPagar | null>(null);
  const hoy = cajaDateKeyBA();
  const total = filas.reduce((s, f) => s + f.amount, 0);

  async function borrar(f: GastoAPagar) {
    if (!confirm(`¿Borrar "${f.name}" de los gastos a pagar? No se registra como gasto.`)) return;
    const { error } = await sb.from("payable_expenses").delete().eq("id", f.id).eq("status", "pending");
    if (error) return toast.error("No se pudo borrar: " + error.message);
    toast.success("Borrado de los gastos a pagar");
    avisarCambioGastosAPagar();
    void recargar();
  }

  if (cargando || filas.length === 0) return null;
  return (
    <div className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.04] p-4">
      <div className="mb-3 flex items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-foreground">Gastos a pagar</h3>
          <p className="text-xs text-muted-foreground">Compras que todavía no pagaste. No descuentan hasta que las pagues.</p>
        </div>
        <div className="text-lg font-bold tabular-nums text-amber-200">{fmt(total)}</div>
      </div>
      <div className="space-y-2">
        {filas.map((f) => {
          const v = etiquetaVencimiento(f.due_date, hoy);
          return (
            <div key={f.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{f.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {f.supplier ? `${f.supplier} · ` : ""}Vence el {fechaCorta(f.due_date)}
                  </div>
                  {f.note ? <div className="text-[11px] text-muted-foreground/70">{f.note}</div> : null}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums text-foreground">{fmt(f.amount)}</div>
                  <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1", v.tono)}>{v.texto}</span>
                </div>
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPagando(f)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/20"
                >
                  <Check className="size-3.5" /> Marcar como pagado
                </button>
                <button
                  type="button"
                  onClick={() => setEditando(f)}
                  aria-label="Editar"
                  className="grid size-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/10"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => borrar(f)}
                  aria-label="Borrar"
                  className="grid size-9 place-items-center rounded-full border border-rose-400/30 bg-rose-400/[0.06] text-rose-300 hover:bg-rose-400/10"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {pagando && (
        <PagarDialog
          gasto={pagando}
          userEmail={userEmail}
          onClose={() => setPagando(null)}
          onPagado={() => {
            setPagando(null);
            avisarCambioGastosAPagar();
            window.dispatchEvent(new CustomEvent("clippr:gasto-guardado"));
            void recargar();
          }}
        />
      )}
      {editando && (
        <EditarDialog
          gasto={editando}
          onClose={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            avisarCambioGastosAPagar();
            void recargar();
          }}
        />
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-violet-400/50";

function PagarDialog({ gasto, userEmail, onClose, onPagado }: { gasto: GastoAPagar; userEmail: string | null; onClose: () => void; onPagado: () => void }) {
  const [origen, setOrigen] = React.useState<"caja" | "otros">("caja");
  const [medio, setMedio] = React.useState<"efectivo" | "transferencia" | "">("");
  const [guardando, setGuardando] = React.useState(false);

  async function pagar() {
    if (guardando) return;
    if (!medio) return toast.error("Elegí con qué medio pagaste: efectivo o transferencia.");
    setGuardando(true);
    const { error } = await sb.rpc("pay_payable_expense_v1", { p_id: gasto.id, p_funds_source: origen, p_method: medio, p_user: userEmail ?? "Caja" });
    setGuardando(false);
    if (error) return toast.error(error.message);
    toast.success("✓ Pagado y registrado como gasto");
    onPagado();
  }

  const opcion = (activo: boolean) =>
    cn(
      "w-full rounded-xl border px-3 py-2.5 text-left text-sm transition",
      activo ? "border-violet-400/60 bg-violet-500/15 text-foreground" : "border-white/10 bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06]",
    );

  return (
    <VentanaClippr
      titulo="Marcar como pagado"
      subtitulo={`${gasto.name} · ${fmt(gasto.amount)}`}
      onClose={onClose}
      ancho="max-w-md"
      footer={
        <button
          type="button"
          onClick={pagar}
          disabled={guardando}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 px-6 text-sm font-semibold text-background disabled:opacity-50"
        >
          {guardando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Registrar el pago
        </button>
      }
    >
      <div>
        <div className="mb-1.5 text-sm font-semibold text-white">¿De dónde sale la plata?</div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={opcion(origen === "caja")} onClick={() => setOrigen("caja")}>
            <span className="block font-semibold">Caja del día</span>
            <span className="block text-[11px] text-muted-foreground">Descuenta y entra en el cierre.</span>
          </button>
          <button type="button" className={opcion(origen === "otros")} onClick={() => setOrigen("otros")}>
            <span className="block font-semibold">Fondos externos</span>
            <span className="block text-[11px] text-muted-foreground">No toca la caja del día.</span>
          </button>
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-sm font-semibold text-white">¿Con qué medio pagaste?</div>
        <div className="grid grid-cols-2 gap-2">
          {(["efectivo", "transferencia"] as const).map((m) => (
            <button key={m} type="button" className={opcion(medio === m)} onClick={() => setMedio(m)}>
              <span className="block text-center font-semibold">{m === "efectivo" ? "Efectivo" : "Transferencia"}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-white/55">Se anota como un gasto de hoy y la deuda sale de esta lista.</p>
    </VentanaClippr>
  );
}

function EditarDialog({ gasto, onClose, onGuardado }: { gasto: GastoAPagar; onClose: () => void; onGuardado: () => void }) {
  const [form, setForm] = React.useState({ name: gasto.name, amount: String(gasto.amount), due: gasto.due_date, supplier: gasto.supplier ?? "", note: gasto.note ?? "" });
  const [guardando, setGuardando] = React.useState(false);

  async function guardar() {
    const amount = parseFloat(form.amount);
    if (!form.name.trim()) return toast.error("Escribí el nombre.");
    if (!amount || amount <= 0) return toast.error("El monto debe ser mayor a 0.");
    if (!form.due) return toast.error("Elegí la fecha de vencimiento.");
    setGuardando(true);
    const { error } = await sb
      .from("payable_expenses")
      .update({ name: form.name.trim(), amount, due_date: form.due, supplier: form.supplier.trim() || null, note: form.note.trim() || null })
      .eq("id", gasto.id)
      .eq("status", "pending");
    setGuardando(false);
    if (error) return toast.error("No se pudo guardar: " + error.message);
    toast.success("Guardado");
    onGuardado();
  }

  return (
    <VentanaClippr
      titulo="Editar gasto a pagar"
      onClose={onClose}
      ancho="max-w-md"
      footer={
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="h-11 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 px-6 text-sm font-semibold text-background disabled:opacity-50"
        >
          Guardar
        </button>
      }
    >
      <input className={inputCls} value={form.name} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Nombre" />
      <input className={inputCls} value={form.amount} type="number" min={0} inputMode="decimal" onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="Monto" />
      <label className="block text-xs font-semibold text-muted-foreground">
        Vence el
        <input className={cn(inputCls, "mt-1")} type="date" value={form.due} onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))} />
      </label>
      <input className={inputCls} value={form.supplier} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} placeholder="Proveedor (opcional)" />
      <input className={inputCls} value={form.note} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Nota (opcional)" />
    </VentanaClippr>
  );
}
