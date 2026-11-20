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
        {/* Dos cifras destacadas: cuántos se fueron y cuánto se dejó de vender (estimado, no es plata garantizada). */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-rose-500/10 p-3 ring-1 ring-rose-300/25">
            <div className="font-display text-4xl font-bold tabular-nums leading-none text-rose-200">{total}</div>
            <div className="mt-1.5 text-sm text-white/65">{total === 1 ? "cliente se fue" : "clientes se fueron"}</div>
          </div>
          <div className="rounded-xl bg-rose-500/[0.06] p-3 ring-1 ring-rose-300/20">
            <div className="font-display text-2xl font-bold tabular-nums leading-none text-rose-100">{perdido > 0 ? fmtAR(perdido) : "—"}</div>
            <div className="mt-1.5 text-sm text-white/65">venta perdida (estimada)</div>
          </div>
        </div>

        {/* Por qué se fueron */}
        <div className="mt-3 divide-y divide-white/10 rounded-xl bg-white/[0.03] ring-1 ring-white/10">
          {(
            [
              ["Sin lugar", generales.length, "text-white"],
              ["Querían un profesional", especificos.length, "text-violet-100"],
              ["Por el precio", porPrecio.length, "text-amber-100"],
            ] as const
          ).map(([nombre, n, color]) => (
            <div key={nombre} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <span className="text-sm text-white/70">{nombre}</span>
              <span className={`text-xl font-bold tabular-nums ${color}`}>{n}</span>
            </div>
          ))}
        </div>

        {/* Cuándo se fueron: una sola fila de cada cosa, con lo más repetido */}
        {total > 0 && (
          <div className="mt-3 divide-y divide-white/10 rounded-xl bg-white/[0.03] ring-1 ring-white/10">
            {(
              [
                ["Días", dias.slice(0, 3).map(([d, n]) => `${DIAS[d]} (${n})`).join(" · ")],
                ["Horarios", horas.slice(0, 3).map(([h, n]) => `${h} a ${h + 1} hs (${n})`).join(" · ")],
                ["Profesional pedido", pedidos.slice(0, 3).map(([nombre, n]) => `${nombre} (${n})`).join(" · ")],
              ] as const
            )
              .filter(([, texto]) => texto.length > 0)
              .map(([titulo, texto]) => (
                <div key={titulo} className="px-3.5 py-2.5">
                  <div className="text-sm text-white/55">{titulo}</div>
                  <div className="text-base font-semibold capitalize text-white">{texto}</div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
