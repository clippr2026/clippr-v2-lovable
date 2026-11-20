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
  agendada,
  atendida,
  franjas,
}: {
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
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["Agendado", agendada],
              ["Atendido", atendida],
            ] as const
          ).map(([nombre, valor]) => (
            <div key={nombre} className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
              <div className="text-sm text-white/60">{nombre}</div>
              <div className="text-3xl font-bold tabular-nums text-white">{valor == null ? "—" : `${valor}%`}</div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full" style={{ width: `${valor ?? 0}%`, background: colorOcupacion(valor ?? 0) }} />
              </div>
            </div>
          ))}
        </div>
        {porDia.length > 0 && (
          <div className="mt-4">
            {/* Los títulos se escriben una sola vez; cada día lleva solo sus dos barras. */}
            <div className="grid grid-cols-[6rem_1fr_1fr] gap-3 pb-1 text-sm text-white/55">
              <span>Por día</span>
              <span>Agendado</span>
              <span>Atendido</span>
            </div>
            <div className="space-y-2.5">
              {porDia.map((d) => (
                <div key={d.dow} className="grid grid-cols-[6rem_1fr_1fr] items-center gap-3 text-sm">
                  <span className="font-semibold capitalize text-white/85">{DIAS[d.dow]}</span>
                  {([d.agendado, d.atendido] as const).map((valor, idx) => (
                    <div key={idx}>
                      <div className="text-right font-semibold tabular-nums text-white">{valor}%</div>
                      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full" style={{ width: `${valor}%`, background: colorOcupacion(valor) }} />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
