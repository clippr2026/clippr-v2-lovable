// Ocupación del local en dos medidas, con el mismo cálculo en la Agenda y en el Asesor IA:
//   · Ocupación agendada: tiempo ocupado por reservas sobre el horario disponible.
//   · Ocupación atendida: tiempo de los servicios atendidos y cobrados (con turno o por orden de llegada) sobre el
//     horario disponible.
// El tope de 100% se aplica por profesional y por día ANTES de sumar el local: lo que un profesional atiende de más
// no tapa los huecos de otro.

export type OcupacionProfesionalDia = {
  /** Tiempo disponible ese día (horario sin descansos ni bloqueos), en minutos. */
  disponible: number;
  /** Tiempo reservado ese día, en minutos. */
  agendado: number;
  /** Tiempo de servicios atendidos y cobrados ese día, en minutos. */
  atendido: number;
};

export type OcupacionLocal = {
  /** 0-100, o null si no hay horario disponible. */
  agendada: number | null;
  atendida: number | null;
  disponible: number;
};

export function ocupacionLocal(filas: OcupacionProfesionalDia[]): OcupacionLocal {
  let disponible = 0;
  let agendado = 0;
  let atendido = 0;
  for (const f of filas) {
    const d = Math.max(0, f.disponible);
    if (d <= 0) continue;
    disponible += d;
    agendado += Math.min(Math.max(0, f.agendado), d);
    atendido += Math.min(Math.max(0, f.atendido), d);
  }
  if (disponible <= 0) return { agendada: null, atendida: null, disponible: 0 };
  return {
    agendada: Math.min(100, Math.round((agendado / disponible) * 100)),
    atendida: Math.min(100, Math.round((atendido / disponible) * 100)),
    disponible,
  };
}

export const OCUPACION_EJEMPLO =
  "Si tenés 8 horas disponibles, agendás 4 y atendés y cobrás 8 horas de servicios, vas a ver 50% agendada y 100% atendida. Si atendés más de 8 horas, la barra atendida sigue en 100%.";
export const OCUPACION_AGENDADA_TEXTO = "Ocupación agendada: el tiempo ocupado por reservas sobre el horario disponible.";
export const OCUPACION_ATENDIDA_TEXTO =
  "Ocupación atendida: el tiempo de los servicios atendidos y cobrados (con turno o por orden de llegada) sobre el horario disponible.";
