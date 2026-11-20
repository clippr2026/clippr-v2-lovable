import { Gauge } from "lucide-react";
import type { FranjaOcupacion } from "@/lib/decisiones-negocio";
import { TARJETA_CLIPPR, TITULO_CLIPPR, VENTANA_CLIPPR } from "@/components/advisor/estilo-clippr";

// Mismo semáforo que la Agenda: rojo hasta 49%, amarillo de 50 a 69 y verde desde 70.
const colorOcupacion = (pct: number) => (pct >= 70 ? "#22c55e" : pct >= 50 ? "#facc15" : "#ef4444");
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];

/**
 * Ocupación del mes: agendado (tiempo reservado) y atendido (servicios cobrados, con o sin turno), y el promedio de cada
 * día de la semana en que se abre (lunes a domingo, solo los días con horario). Mismo cálculo que la Agenda.
 */
export function OcupacionMesCard({
  monthLabel,
  agendada,
  atendida,
  franjas,
}: {
  monthLabel: string;
  agendada: number | null;
  atendida: number | null;
  franjas?: FranjaOcupacion[];
}) {
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
    <div className={VENTANA_CLIPPR}>
      <div className="mb-2.5 flex items-center gap-2 px-1">
        <Gauge className="h-4 w-4 text-sky-300" />
        <h2 className={TITULO_CLIPPR}>Ocupación del mes</h2>
      </div>
      <div className={`${TARJETA_CLIPPR} sm:p-5`}>
        <p className="text-sm font-semibold text-white">{monthLabel}</p>
        <p className="text-xs text-white/55">Promedio por día abierto</p>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {(
            [
              ["Agendado", agendada],
              ["Atendido", atendida],
            ] as const
          ).map(([nombre, valor]) => (
            <div key={nombre} className="rounded-xl bg-white/[0.04] p-2.5 ring-1 ring-white/10">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-white/60">{nombre}</span>
                <span className="text-xl font-bold tabular-nums text-white">{valor == null ? "—" : `${valor}%`}</span>
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
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
  );
}
