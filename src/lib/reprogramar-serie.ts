// Cambio de días, horario o frecuencia de una recurrencia: rige desde el próximo turno. Los turnos que ya
// estaban agendados se MUEVEN a las fechas nuevas (conservan su seña, notas y estado); si faltan se crean y
// si sobran se quitan, salvo los que tienen seña.
import { computeRepeatDates, type RepeatConfig, type RepeatWeekday } from "@/lib/recurring-schedule";

export type TurnoDeSerie = { id: string; starts_at: string; status: string };

/** Turnos de la serie que todavía se pueden reprogramar: futuros, reservados o confirmados. */
export function turnosReprogramables<T extends TurnoDeSerie>(turnos: T[], ahora: Date): T[] {
  return turnos
    .filter((t) => (t.status === "pending" || t.status === "confirmed") && new Date(t.starts_at).getTime() > ahora.getTime())
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
}

/** Fechas del patrón nuevo, desde el próximo horario posible. */
export function fechasDelPatron({
  repeat,
  hora,
  ahora,
  proximoActual,
  limite,
  yaUsados,
}: {
  repeat: RepeatConfig;
  /** "HH:MM" */
  hora: string;
  ahora: Date;
  /** Fecha del próximo turno que tenía la serie (para no cambiar de semana en series quincenales o más espaciadas). */
  proximoActual: Date | null;
  /** Último instante agendable (anticipación máxima). */
  limite: Date;
  /** Turnos de la serie que no se mueven (pasados, cobrados, cancelados): cuentan si la serie tiene cantidad fija. */
  yaUsados: number;
}): Date[] {
  if (repeat.weekdays.length === 0) return [];
  const [h, m] = hora.split(":").map((x) => Number(x) || 0);
  const inicio = new Date(ahora);
  if (repeat.everyWeeks > 1 && proximoActual) {
    // Lunes de la semana del próximo turno, nunca antes de hoy.
    const lunes = new Date(proximoActual);
    lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7));
    lunes.setHours(0, 0, 0, 0);
    if (lunes.getTime() > inicio.getTime()) inicio.setTime(lunes.getTime());
  }
  inicio.setHours(h, m, 0, 0);
  if (inicio.getTime() <= ahora.getTime()) inicio.setDate(inicio.getDate() + 1);

  let repetir = repeat;
  if (repeat.endMode === "count") {
    const quedan = Math.max(0, repeat.count - yaUsados);
    if (quedan === 0) return [];
    repetir = { ...repeat, count: quedan };
  }
  const hasta = repeat.endMode === "until" && repeat.until ? new Date(`${repeat.until}T23:59:59`) : null;
  // computeRepeatDates devuelve la fecha inicial si no encuentra ninguna: se vuelve a filtrar.
  return computeRepeatDates(inicio, repetir, limite).filter(
    (f) => repeat.weekdays.includes(f.getDay() as RepeatWeekday) && f <= limite && (!hasta || f <= hasta),
  );
}

/** Empareja, en orden, los turnos agendados con las fechas nuevas. */
export function repartir<T extends TurnoDeSerie>(turnos: T[], fechas: Date[]) {
  const n = Math.min(turnos.length, fechas.length);
  return {
    mover: turnos.slice(0, n).map((turno, i) => ({ turno, fecha: fechas[i] })),
    crear: fechas.slice(n),
    sobran: turnos.slice(n),
  };
}
