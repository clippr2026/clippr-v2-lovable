import * as React from "react";
import { DoorOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtAR } from "@/components/dashboard/use-dashboard-data";
import { TARJETA_CLIPPR, TITULO_CLIPPR, VENTANA_CLIPPR } from "@/components/advisor/estilo-clippr";

const BA = "America/Argentina/Buenos_Aires";

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

type Fila = { occurred_at: string; preferencia: "cualquiera" | "especifico" | "precio" | null; requested_employee_id: string | null };

/** Límites [desde, hasta) de un mes "2026-11" en hora de Buenos Aires. */
function rangoMes(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number);
  const sig = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { desde: `${monthKey}-01T00:00:00-03:00`, hasta: `${sig}-01T00:00:00-03:00` };
}

/** Cuenta repeticiones, de mayor a menor: [clave, cantidad][]. */
function ranking<T>(valores: T[]): Array<[T, number]> {
  const cuenta = new Map<T, number>();
  for (const v of valores) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  return [...cuenta].sort((a, b) => b[1] - a[1]);
}

/**
 * Asesor IA: clientes que se fueron sin atender en el mes (botón "Se fue" de la Agenda),
 * cruzado con la ocupación de la agenda. Separa la falta de lugar general (aceptaba a
 * cualquiera) de la demanda por un profesional puntual: la primera habla de capacidad del
 * local; la segunda, solo de ese profesional.
 */
export function ClientesPerdidosCard({
  businessId,
  monthKey,
  monthLabel,
  ticket,
}: {
  businessId: string | null | undefined;
  monthKey: string;
  monthLabel: string;
  ticket: number | null;
}) {
  const [filas, setFilas] = React.useState<Fila[] | null>(null);
  const [nombres, setNombres] = React.useState<Map<string, string>>(new Map());

  React.useEffect(() => {
    if (!businessId) return setFilas(null);
    let cancelled = false;
    setFilas(null);
    const { desde, hasta } = rangoMes(monthKey);
    void Promise.all([
      (supabase.from("clientes_no_atendidos" as any) as any)
        .select("occurred_at,preferencia,requested_employee_id")
        .eq("business_id", businessId)
        .gte("occurred_at", desde)
        .lt("occurred_at", hasta),
      supabase.from("employees").select("id,full_name").eq("business_id", businessId),
    ]).then(([reg, emp]: any[]) => {
      if (cancelled) return;
      setFilas(reg.error ? [] : ((reg.data ?? []) as Fila[]));
      setNombres(new Map(((emp.data ?? []) as any[]).map((e) => [e.id as string, e.full_name as string])));
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, monthKey]);

  if (filas === null) return null;

  const total = filas.length;
  // Sin dato (registros anteriores a la pregunta) cuenta como falta de lugar general:
  // así se cargaban antes ("se fue porque estaban todos ocupados").
  const porPrecio = filas.filter((f) => f.preferencia === "precio");
  const generales = filas.filter((f) => f.preferencia !== "especifico" && f.preferencia !== "precio");
  const especificos = filas.filter((f) => f.preferencia === "especifico");
  const enBA = (f: Fila) => new Date(new Date(f.occurred_at).toLocaleString("en-US", { timeZone: BA }));
  const dias = ranking(filas.map((f) => enBA(f).getDay()));
  const horas = ranking(filas.map((f) => enBA(f).getHours()));
  const diaGen = ranking(generales.map((f) => enBA(f).getDay()))[0];
  const horaGen = ranking(generales.map((f) => enBA(f).getHours()))[0];
  const pedidos = ranking(especificos.map((f) => f.requested_employee_id).filter((id): id is string => !!id)).map(
    ([id, n]) => [nombres.get(id) ?? "Profesional", n] as [string, number],
  );
  const perdido = ticket && total > 0 ? Math.round(ticket * total) : 0;
  return (
    <div className={VENTANA_CLIPPR}>
      <div className="mb-2.5 flex items-center gap-2 px-1">
        <DoorOpen className="h-4 w-4 text-rose-300" />
        <h2 className={TITULO_CLIPPR}>Clientes que se fueron</h2>
      </div>
      <div className={`${TARJETA_CLIPPR} sm:p-5`}>
        <p className="text-sm font-semibold text-white">{monthLabel}</p>
        <p className="text-xs text-white/55">Entraron al local y se fueron sin atenderse</p>

        {/* Dos cifras destacadas: cuántos se fueron y cuánto se dejó de vender (estimado, no es plata garantizada). */}
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-rose-500/10 p-2.5 ring-1 ring-rose-300/25">
            <div className="font-display text-3xl font-bold tabular-nums leading-none text-rose-200">{total}</div>
            <div className="mt-1 text-[11px] leading-tight text-white/60">{total === 1 ? "cliente se fue" : "clientes se fueron"}</div>
          </div>
          <div className="rounded-xl bg-rose-500/[0.06] p-2.5 ring-1 ring-rose-300/20">
            <div className="font-display text-2xl font-bold tabular-nums leading-none text-rose-100">{perdido > 0 ? fmtAR(perdido) : "—"}</div>
            <div className="mt-1 text-[11px] leading-tight text-white/60">venta potencial perdida</div>
            <div className="mt-0.5 text-[10px] leading-tight text-white/40">Estimado con el ticket promedio; no es facturación garantizada.</div>
          </div>
        </div>

        {/* Motivos, en tarjetas compactas */}
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white/[0.04] p-2 text-center ring-1 ring-white/10">
            <div className="text-lg font-bold tabular-nums text-white">{generales.length}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-white/55">Sin lugar</div>
          </div>
          <div className="rounded-xl bg-violet-500/10 p-2 text-center ring-1 ring-violet-300/25">
            <div className="text-lg font-bold tabular-nums text-violet-100">{especificos.length}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-white/55">Profesional</div>
          </div>
          <div className="rounded-xl bg-amber-400/10 p-2 text-center ring-1 ring-amber-300/25">
            <div className="text-lg font-bold tabular-nums text-amber-100">{porPrecio.length}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-white/55">Precio</div>
          </div>
        </div>

        {total > 0 && (
          <ul className="mt-2.5 space-y-0.5 text-[13px] leading-snug text-white/70">
            {dias.length > 0 && (
              <li>
                Días con más casos:{" "}
                <span className="font-semibold text-white">{dias.slice(0, 2).map(([d, n]) => `${DIAS[d]} (${n})`).join(", ")}</span>
              </li>
            )}
            {horas.length > 0 && (
              <li>
                Horarios con más casos:{" "}
                <span className="font-semibold text-white">{horas.slice(0, 2).map(([h, n]) => `${h} a ${h + 1} hs (${n})`).join(", ")}</span>
              </li>
            )}
            {pedidos.length > 0 && (
              <li>
                Profesional más pedido:{" "}
                <span className="font-semibold text-violet-100">{pedidos.slice(0, 3).map(([nombre, n]) => `${nombre} (${n})`).join(", ")}</span>
              </li>
            )}
          </ul>
        )}

      </div>
    </div>
  );
}
