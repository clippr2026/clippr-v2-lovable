import * as React from "react";
import { createPortal } from "react-dom";
import { HandCoins, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
const BA = "America/Argentina/Buenos_Aires";
const dayKeyBA = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: BA });
const fechaLabel = (key: string) => {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
};

export type SenaExtensionItem = { id: string; monto: number; metodo: string; nota: string | null };
export type SenaExtensionDia = { fecha: string; total: number; items: SenaExtensionItem[] };

/** Agrupa por día las señas que entraron en una caja ya cerrada y todavía no se cerraron como extensión. */
export function agruparSenasExtension(
  rows: Array<{ id: string; amount: number | string | null; method: string | null; note: string | null; created_at: string }>,
): SenaExtensionDia[] {
  const byDay = new Map<string, SenaExtensionDia>();
  for (const r of rows) {
    const fecha = dayKeyBA(r.created_at);
    const dia = byDay.get(fecha) ?? { fecha, total: 0, items: [] };
    const monto = Number(r.amount) || 0;
    dia.total += monto;
    dia.items.push({ id: r.id, monto, metodo: r.method ?? "cuenta", nota: r.note });
    byDay.set(fecha, dia);
  }
  return [...byDay.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function useSenasExtensionPendientes(businessId: string | null | undefined, branchId: string | null | undefined) {
  const [dias, setDias] = React.useState<SenaExtensionDia[]>([]);
  const refresh = React.useCallback(async () => {
    if (!businessId) return setDias([]);
    let q = (supabase.from("cash_movements" as any) as any)
      .select("id,amount,method,note,created_at")
      .eq("business_id", businessId)
      .eq("extension_pendiente", true)
      .is("cierre_extension_id", null)
      .not("deposit_id", "is", null)
      .order("created_at", { ascending: true });
    if (branchId) q = q.eq("branch_id", branchId);
    const { data, error } = await q;
    if (!error) setDias(agruparSenasExtension((data ?? []) as any[]));
  }, [businessId, branchId]);

  React.useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { dias, refresh };
}

/**
 * Aviso "Señas pendientes de cierre": señas aprobadas cuyo día de transferencia ya tenía la caja cerrada.
 * Se cierran aparte, como una extensión de esa caja; el cierre original no se modifica.
 */
export function SenasExtensionBanner({
  businessId,
  branchId,
  onClosed,
}: {
  businessId: string | null | undefined;
  branchId: string | null | undefined;
  onClosed?: () => void;
}) {
  const { dias, refresh } = useSenasExtensionPendientes(businessId, branchId);
  const [abierto, setAbierto] = React.useState<SenaExtensionDia | null>(null);
  const [saving, setSaving] = React.useState(false);

  const confirmar = async () => {
    if (!abierto || !businessId || saving) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase.rpc as any)("close_caja_extension_v1", {
        p_business_id: businessId,
        p_branch_id: branchId ?? null,
        p_fecha: abierto.fecha,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "No se pudo cerrar la extensión.");
      toast.success(`Señas del ${fechaLabel(abierto.fecha)} cerradas`);
      setAbierto(null);
      await refresh();
      onClosed?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (dias.length === 0) return null;
  return (
    <>
      <div className="rounded-xl bg-amber-400/10 px-3 py-2.5 ring-1 ring-amber-400/25">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-200">
          <HandCoins className="h-4 w-4 shrink-0" />
          {dias.length === 1
            ? `Tenés señas pendientes de cierre del ${fechaLabel(dias[0].fecha)}`
            : `Tenés señas pendientes de cierre de ${dias.length} días`}
        </div>
        <div className="mt-2 space-y-1.5">
          {dias.map((d) => (
            <div key={d.fecha} className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-amber-100/85">
                {fechaLabel(d.fecha)} · {d.items.length} {d.items.length === 1 ? "seña" : "señas"} · {money(d.total)}
              </span>
              <button
                type="button"
                onClick={() => setAbierto(d)}
                className="inline-flex items-center justify-center rounded-lg bg-amber-400/20 px-3 py-1 text-[11px] font-semibold text-amber-100 ring-1 ring-amber-400/30 transition hover:bg-amber-400/30"
              >
                Revisar y cerrar
              </button>
            </div>
          ))}
        </div>
      </div>
      {abierto &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[70] grid place-items-end bg-black/70 backdrop-blur-sm sm:place-items-center" onClick={() => !saving && setAbierto(null)}>
            <div
              className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-[oklch(0.11_0.04_275)] p-4 shadow-2xl ring-1 ring-white/10 sm:rounded-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Señas del {fechaLabel(abierto.fecha)}</h3>
                <button type="button" aria-label="Cerrar" onClick={() => setAbierto(null)} className="grid h-8 w-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mb-3 text-xs text-white/55">
                La caja de ese día ya estaba cerrada cuando se aprobaron. Se agregan como una extensión; el cierre original no cambia.
              </p>
              <div className="space-y-1.5">
                {abierto.items.map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2 text-sm ring-1 ring-white/10">
                    <span className="min-w-0 truncate text-white/85">{(it.nota ?? "Seña").replace(/^Seña – /, "")}</span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums text-white">{money(it.monto)}</span>
                      <span className="block text-[11px] text-white/50">{it.metodo === "efectivo" ? "Efectivo en caja" : "Dinero en banco"}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-sm font-bold text-white">
                <span>Total</span>
                <span className="tabular-nums">{money(abierto.total)}</span>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void confirmar()}
                className="mt-4 h-11 w-full rounded-xl bg-gradient-to-b from-blue-400 to-violet-500 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
              >
                {saving ? "Cerrando…" : "Confirmar cierre de señas"}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Historial: extensiones de señas agregadas a un cierre después de cerrado. */
export function CierreExtensionesNota({
  businessId,
  branchId,
  fecha,
}: {
  businessId: string | null | undefined;
  branchId: string | null | undefined;
  fecha: string | null | undefined;
}) {
  const [rows, setRows] = React.useState<
    Array<{ id: string; total_banco: number; total_efectivo: number; detalle: any[]; closed_by: string | null; closed_at: string }>
  >([]);

  React.useEffect(() => {
    if (!businessId || !fecha) return setRows([]);
    let cancelled = false;
    let q = (supabase.from("caja_cierre_extensiones" as any) as any)
      .select("id,total_banco,total_efectivo,detalle,closed_by,closed_at")
      .eq("business_id", businessId)
      .eq("fecha", fecha)
      .order("closed_at", { ascending: true });
    if (branchId) q = q.eq("branch_id", branchId);
    void q.then(({ data, error }: any) => {
      if (!cancelled && !error) setRows((data ?? []) as any[]);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, branchId, fecha]);

  if (rows.length === 0) return null;
  return (
    <section className="rounded-2xl bg-violet-400/[0.06] p-4 ring-1 ring-violet-300/25">
      <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-violet-200/80">Extensión · señas agregadas después del cierre</div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="space-y-1.5">
            {(Array.isArray(r.detalle) ? r.detalle : []).map((d: any, i: number) => (
              <div key={d?.movimiento_id ?? i} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-muted-foreground">{String(d?.nota ?? "Seña").replace(/^Seña – /, "Seña · ")}</span>
                <span className="shrink-0 font-semibold tabular-nums text-white">{money(Number(d?.monto) || 0)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] pt-2 text-sm">
              <span className="text-white/80">
                {Number(r.total_banco) > 0 && `Dinero en banco +${money(Number(r.total_banco))}`}
                {Number(r.total_banco) > 0 && Number(r.total_efectivo) > 0 && " · "}
                {Number(r.total_efectivo) > 0 && `Efectivo en caja +${money(Number(r.total_efectivo))}`}
              </span>
              <span className="text-[11px] text-white/50">
                Cerrada por {r.closed_by ?? "Caja"} el {new Date(r.closed_at).toLocaleDateString("es-AR", { timeZone: BA })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
