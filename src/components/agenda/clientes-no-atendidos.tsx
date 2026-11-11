import * as React from "react";
import { createPortal } from "react-dom";
import { DoorOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const BA = "America/Argentina/Buenos_Aires";

/** Límites [desde, hasta) del día de hoy en Buenos Aires. */
function rangoHoy() {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: BA });
  const desde = new Date(`${hoy}T00:00:00-03:00`);
  const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

/**
 * Botón de Agenda "Se fue": registra (con día y hora de ahora) un cliente que entró al
 * local y se fue porque estaban todos ocupados. Muestra cuántos se fueron hoy.
 */
export function ClientesNoAtendidosButton({
  businessId,
  branchId,
  createdByName,
}: {
  businessId: string | null | undefined;
  branchId: string | null | undefined;
  createdByName?: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [countHoy, setCountHoy] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  const tabla = () => supabase.from("clientes_no_atendidos" as any) as any;

  React.useEffect(() => {
    if (!businessId) return setCountHoy(0);
    let cancelled = false;
    const { desde, hasta } = rangoHoy();
    let q = tabla().select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("occurred_at", desde).lt("occurred_at", hasta);
    if (branchId) q = q.eq("branch_id", branchId);
    void q.then(({ count, error }: any) => {
      if (!cancelled && !error) setCountHoy(count ?? 0);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, branchId, tick]);

  const registrar = async () => {
    if (!businessId || saving) return;
    setSaving(true);
    const { error } = await tabla().insert({ business_id: businessId, branch_id: branchId ?? null, created_by_name: createdByName ?? null });
    setSaving(false);
    if (error) return toast.error("No se pudo registrar. Probá de nuevo.");
    toast.success("Registrado.");
    setOpen(false);
    setTick((t) => t + 1);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-white/10 transition hover:bg-white/[0.07]"
      >
        <DoorOpen className="h-3.5 w-3.5 text-rose-300" />
        Se fue
        <span className="rounded-full bg-rose-400/20 px-1.5 text-[11px] font-semibold tabular-nums text-rose-200">{countHoy}</span>
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[120] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
            <div className="w-full max-w-sm rounded-3xl bg-[oklch(0.11_0.04_275)] p-5 shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white">¿Se fue un cliente sin atender?</h3>
              <p className="mt-2 text-sm leading-snug text-white/65">
                Usalo cuando alguien entra al local, quiere atenderse y se va porque están todos ocupados. Se guarda con el día y la hora de ahora,
                para saber a fin de mes cuántos clientes se fueron.
              </p>
              <p className="mt-3 text-sm font-medium text-rose-200">
                Hoy {countHoy === 1 ? "se fue 1 cliente" : `se fueron ${countHoy} clientes`}.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-11 rounded-xl bg-white/[0.05] text-sm font-semibold text-white/80 ring-1 ring-white/10 transition hover:bg-white/[0.09]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={registrar}
                  disabled={saving}
                  className="h-11 rounded-xl bg-rose-500/25 text-sm font-semibold text-rose-100 ring-1 ring-rose-300/50 transition hover:bg-rose-500/35 disabled:opacity-60"
                >
                  {saving ? "Registrando…" : "Sí, registrar"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
