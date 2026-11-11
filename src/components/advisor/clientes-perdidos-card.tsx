import * as React from "react";
import { Brain, DoorOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtAR } from "@/components/dashboard/use-dashboard-data";

const BA = "America/Argentina/Buenos_Aires";
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Límites [desde, hasta) de un mes "2026-11" en hora de Buenos Aires. */
function rangoMes(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number);
  const sig = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { desde: `${monthKey}-01T00:00:00-03:00`, hasta: `${sig}-01T00:00:00-03:00` };
}

/** El que más se repite: [clave, cantidad]. */
function masRepetido(valores: number[]): [number, number] | null {
  const cuenta = new Map<number, number>();
  for (const v of valores) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  let mejor: [number, number] | null = null;
  for (const par of cuenta) if (!mejor || par[1] > mejor[1]) mejor = par;
  return mejor;
}

/**
 * Asesor IA: clientes que se fueron sin atender en el mes (botón "Se fue" de la Agenda),
 * cruzado con la ocupación de la agenda, para decidir precio, equipo u horario.
 */
export function ClientesPerdidosCard({
  businessId,
  monthKey,
  monthLabel,
  occupancy,
  ticket,
}: {
  businessId: string | null | undefined;
  monthKey: string;
  monthLabel: string;
  occupancy: number | null;
  ticket: number | null;
}) {
  const [fechas, setFechas] = React.useState<string[] | null>(null);

  React.useEffect(() => {
    if (!businessId) return setFechas(null);
    let cancelled = false;
    setFechas(null);
    const { desde, hasta } = rangoMes(monthKey);
    void (supabase.from("clientes_no_atendidos" as any) as any)
      .select("occurred_at")
      .eq("business_id", businessId)
      .gte("occurred_at", desde)
      .lt("occurred_at", hasta)
      .then(({ data, error }: any) => {
        if (!cancelled) setFechas(error ? [] : ((data ?? []) as any[]).map((r) => r.occurred_at as string));
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, monthKey]);

  if (fechas === null) return null;

  const total = fechas.length;
  const enBA = fechas.map((iso) => new Date(new Date(iso).toLocaleString("en-US", { timeZone: BA })));
  const dia = masRepetido(enBA.map((d) => d.getDay()));
  const hora = masRepetido(enBA.map((d) => d.getHours()));
  const perdido = ticket && total > 0 ? Math.round(ticket * total) : 0;
  const ocup = occupancy ?? 0;
  const concentrado = total >= 4 && !!dia && !!hora && (dia[1] >= total / 2 || hora[1] >= total / 2);

  let consejo: string;
  if (total === 0) {
    consejo = "Todavía no hay clientes registrados en este mes. Cada vez que alguien se vaya sin atenderse, tocá “Se fue” en la Agenda.";
  } else if (total < 4) {
    consejo = "Son pocos registros para sacar conclusiones. Seguí cargándolos y a fin de mes vas a tener un número confiable.";
  } else if (ocup >= 75) {
    consejo =
      "La agenda está casi llena y además se va gente: hay más demanda que lugar. Es buen momento para subir precios o sumar un barbero.";
  } else if (concentrado && dia && hora) {
    consejo = `Se van sobre todo los ${DIAS[dia[0]]} y cerca de las ${hora[0]} hs. La agenda en general tiene lugar, así que alcanza con reforzar esa franja: un barbero más en ese horario o extenderlo.`;
  } else {
    consejo =
      "La agenda en general tiene lugar, pero igual se va gente en los momentos de más movimiento. Antes de sumar un barbero, probá ofrecerles un turno para más tarde o reforzar los horarios pico.";
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
        <p className="text-sm text-muted-foreground">Entraron al local y se fueron porque estaban todos ocupados · {monthLabel}</p>
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
          <ul className="mt-3 space-y-1 text-sm text-white/75">
            {dia && (
              <li>
                Día con más casos: <span className="font-semibold text-white">{DIAS[dia[0]]}</span> ({dia[1]})
              </li>
            )}
            {hora && (
              <li>
                Horario con más casos: <span className="font-semibold text-white">{hora[0]} a {hora[0] + 1} hs</span> ({hora[1]})
              </li>
            )}
            {perdido > 0 && (
              <li>
                Se dejó de cobrar aprox. <span className="font-semibold text-rose-200">{fmtAR(perdido)}</span> (a ticket promedio)
              </li>
            )}
          </ul>
        )}
        <div className="mt-3 rounded-xl bg-emerald-400/[0.07] p-3 ring-1 ring-emerald-300/20">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
            <Brain className="h-3.5 w-3.5" /> Qué conviene hacer
          </div>
          <p className="text-sm leading-snug text-white/80">{consejo}</p>
        </div>
      </div>
    </div>
  );
}
