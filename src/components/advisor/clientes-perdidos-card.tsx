import * as React from "react";
import { Brain, DoorOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtAR } from "@/components/dashboard/use-dashboard-data";

const BA = "America/Argentina/Buenos_Aires";
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

type Fila = { occurred_at: string; preferencia: "cualquiera" | "especifico" | null; requested_employee_id: string | null };
type Carga = { name: string; used: number; capacity: number };

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
  occupancy,
  ticket,
  employeeLoad,
}: {
  businessId: string | null | undefined;
  monthKey: string;
  monthLabel: string;
  occupancy: number | null;
  ticket: number | null;
  /** Ocupación de cada profesional en el mes (servicios vendidos contra su capacidad). */
  employeeLoad?: Carga[];
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
  const generales = filas.filter((f) => f.preferencia !== "especifico");
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
  const ocup = occupancy ?? 0;

  const consejos: string[] = [];
  if (total === 0) {
    consejos.push("Todavía no hay clientes registrados en este mes. Cada vez que alguien se vaya sin atenderse, tocá “Se fue” en la Agenda.");
  } else if (total < 4) {
    consejos.push("Son pocos registros para sacar conclusiones. Seguí cargándolos y a fin de mes vas a tener un número confiable.");
  } else {
    // 1) Falta de lugar general: habla de la capacidad del local.
    if (generales.length >= 4) {
      const concentrado = !!diaGen && !!horaGen && (diaGen[1] >= generales.length / 2 || horaGen[1] >= generales.length / 2);
      if (ocup >= 75) {
        consejos.push(
          `Falta de lugar: ${generales.length} clientes aceptaban a cualquiera y se fueron, con la agenda al ${ocup}%. Hay más demanda que lugar: es buen momento para sumar un profesional o evaluar un aumento de precios.`,
        );
      } else if (concentrado && diaGen && horaGen) {
        consejos.push(
          `Falta de lugar en momentos puntuales: ${generales.length} clientes aceptaban a cualquiera y se fueron, sobre todo los ${DIAS[diaGen[0]]} cerca de las ${horaGen[0]} hs. La agenda del mes está al ${ocup}%, así que no hace falta sumar a alguien fijo: alcanza con reforzar o ampliar esa franja.`,
        );
      } else {
        consejos.push(
          `${generales.length} clientes aceptaban a cualquiera y se fueron, pero la agenda del mes está al ${ocup}%: no es falta de capacidad, son picos. Antes de sumar gente, ofreceles un turno para más tarde.`,
        );
      }
    }
    // 2) Demanda por un profesional: habla de esa persona, no del local.
    if (especificos.length >= 3 && pedidos[0]) {
      const [nombre, n] = pedidos[0];
      const carga = employeeLoad?.find((c) => c.name === nombre);
      const pct = carga && carga.capacity > 0 ? Math.round((carga.used / carga.capacity) * 100) : null;
      if (pct != null && pct >= 75) {
        consejos.push(
          `Demanda por ${nombre}: ${n} clientes lo pidieron y se fueron, y su agenda está al ${pct}%. No se arregla sumando otro profesional: conviene ampliarle el horario o subir el precio de sus servicios.`,
        );
      } else {
        consejos.push(
          `Demanda por ${nombre}: ${n} clientes lo pidieron y se fueron${pct != null ? `, aunque su agenda del mes está al ${pct}%` : ""}. No es falta de capacidad del local: conviene ofrecerles turno con ${nombre} en otro horario y no sumar gente por este motivo.`,
        );
      }
    }
    if (consejos.length === 0) {
      consejos.push("Los casos están repartidos entre falta de lugar y pedidos por un profesional. Todavía no hay un patrón claro: seguí registrando.");
    }
  }

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-rose-300/[0.22] bg-white/[0.016] p-3 shadow-[0_0_0_1px_rgba(244,63,94,0.1),0_28px_110px_-50px_rgba(244,63,94,0.7)] sm:p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.045] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60">
          <DoorOpen className="h-3.5 w-3.5 text-rose-300" /> Clientes que se fueron
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 sm:p-5">
        <p className="text-sm text-muted-foreground">Entraron al local y se fueron sin atenderse · {monthLabel}</p>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-rose-500/10 p-3 text-center ring-1 ring-rose-300/25">
            <div className="font-display text-3xl font-bold tabular-nums text-rose-200">{total}</div>
            <div className="text-xs text-white/60">{total === 1 ? "cliente se fue" : "clientes se fueron"}</div>
          </div>
          <div className="rounded-xl bg-white/[0.04] p-3 text-center ring-1 ring-white/10">
            <div className="font-display text-3xl font-bold tabular-nums text-white">{occupancy == null ? "—" : `${ocup}%`}</div>
            <div className="text-xs text-white/60">agenda ocupada</div>
          </div>
        </div>

        {total > 0 && (
          <>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              <div className="rounded-xl bg-white/[0.04] p-2.5 ring-1 ring-white/10">
                <div className="text-xl font-bold tabular-nums text-white">{generales.length}</div>
                <div className="text-[11px] leading-tight text-white/60">por falta de lugar (aceptaban a cualquiera)</div>
              </div>
              <div className="rounded-xl bg-violet-500/10 p-2.5 ring-1 ring-violet-300/25">
                <div className="text-xl font-bold tabular-nums text-violet-100">{especificos.length}</div>
                <div className="text-[11px] leading-tight text-white/60">querían a un profesional en especial</div>
              </div>
            </div>
            <ul className="mt-3 space-y-1 text-sm text-white/75">
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
                  Más pedidos:{" "}
                  <span className="font-semibold text-violet-100">{pedidos.slice(0, 3).map(([nombre, n]) => `${nombre} (${n})`).join(", ")}</span>
                </li>
              )}
              {perdido > 0 && (
                <li>
                  Se dejó de cobrar aprox. <span className="font-semibold text-rose-200">{fmtAR(perdido)}</span> (a ticket promedio)
                </li>
              )}
            </ul>
          </>
        )}

        <div className="mt-3 rounded-xl bg-emerald-400/[0.07] p-3 ring-1 ring-emerald-300/20">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
            <Brain className="h-3.5 w-3.5" /> Qué conviene hacer
          </div>
          <div className="space-y-2 text-sm leading-snug text-white/80">
            {consejos.map((c) => (
              <p key={c}>{c}</p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
