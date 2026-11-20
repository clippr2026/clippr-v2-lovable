import * as React from "react";
import { DoorOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtAR } from "@/components/dashboard/use-dashboard-data";
import type { FranjaOcupacion } from "@/lib/decisiones-negocio";

const BA = "America/Argentina/Buenos_Aires";

// Mismo semáforo que la Agenda: rojo hasta 49%, amarillo de 50 a 69 y verde desde 70.
const colorOcupacion = (pct: number) => (pct >= 70 ? "#22c55e" : pct >= 50 ? "#facc15" : "#ef4444");
const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];
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
  occupancy,
  agendada,
  ticket,
  franjas,
}: {
  businessId: string | null | undefined;
  monthKey: string;
  monthLabel: string;
  /** Ocupación atendida del mes (0-100). */
  occupancy: number | null;
  /** Ocupación agendada del mes (0-100). */
  agendada: number | null;
  ticket: number | null;
  /** Ocupación agendada y atendida por franja (día de la semana y hora) del mes. */
  franjas?: FranjaOcupacion[];
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
  // Ocupación promedio de cada día de la semana en que se abre (lunes a domingo, solo los días con horario).
  const porDia = ORDEN_SEMANA.map((dow) => {
    const fs = (franjas ?? []).filter((f) => f.dow === dow && f.disponible > 0);
    const disponible = fs.reduce((n, f) => n + f.disponible, 0);
    if (disponible <= 0) return null;
    return {
      dow,
      agendado: Math.min(100, Math.round((fs.reduce((n, f) => n + f.agendado, 0) / disponible) * 100)),
      atendido: Math.min(100, Math.round((fs.reduce((n, f) => n + f.atendido, 0) / disponible) * 100)),
    };
  }).filter((d): d is { dow: number; agendado: number; atendido: number } => d != null);
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-rose-300/[0.22] bg-white/[0.016] p-3 shadow-[0_0_0_1px_rgba(244,63,94,0.1),0_28px_110px_-50px_rgba(244,63,94,0.7)] sm:p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.045] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60">
          <DoorOpen className="h-3.5 w-3.5 text-rose-300" /> Clientes que se fueron
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 sm:p-5">
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

        {/* Ocupación del mes (promedio) y de cada día abierto: agendado = reservas, atendido = servicios cobrados */}
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-white">Ocupación del mes</span>
            <span className="text-[10px] text-white/45">promedio por día abierto</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                ["Agendado", agendada],
                ["Atendido", occupancy],
              ] as const
            ).map(([nombre, valor]) => (
              <div key={nombre} className="rounded-lg bg-white/[0.04] p-2 ring-1 ring-white/10">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-white/60">{nombre}</span>
                  <span className="text-lg font-bold tabular-nums text-white">{valor == null ? "—" : `${valor}%`}</span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full" style={{ width: `${valor ?? 0}%`, background: colorOcupacion(valor ?? 0) }} />
                </div>
              </div>
            ))}
          </div>
          {porDia.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {porDia.map((d) => (
                <div key={d.dow} className="grid grid-cols-[5.2rem_1fr_1fr] items-center gap-2 text-[11px]">
                  <span className="font-semibold capitalize text-white/80">{DIAS[d.dow]}</span>
                  {(
                    [
                      ["Agendado", d.agendado],
                      ["Atendido", d.atendido],
                    ] as const
                  ).map(([nombre, valor]) => (
                    <div key={nombre}>
                      <div className="flex items-center justify-between text-white/55">
                        <span>{nombre}</span>
                        <span className="font-semibold tabular-nums text-white">{valor}%</span>
                      </div>
                      <div className="mt-0.5 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full" style={{ width: `${valor}%`, background: colorOcupacion(valor) }} />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
