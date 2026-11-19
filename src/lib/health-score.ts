// Puntaje de salud del negocio (0 a 100) con tres indicadores. Todos se ganan según resultados reales contra umbrales
// fijos: no se regalan puntos y los puntos suben de forma gradual entre un umbral y el siguiente.
//
//   Rentabilidad operativa ..... 45   margen: 0 pts con 0% o menos · 25 pts con 20% · 45 pts con 35% o más
//   Retención de clientes ...... 30
//       Nuevos que vuelven ..... 20   0 pts con 20% o menos · 10 pts con 45% · 20 pts con 70% o más
//       Habituales al día ...... 10   0 pts con 40% o menos · 5 pts con 62,5% · 10 pts con 85% o más
//   Ocupación atendida ......... 25   0 pts con 20% o menos · 15 pts con 50% · 25 pts con 80% o más
//
// Redondeo en un solo lugar: cada indicador redondea sus puntos a enteros y el total es la suma de lo que se ve.
// Cuando a un indicador (o a la mitad de la retención) le faltan datos, ese tramo no suma ni resta: el resultado se
// marca como parcial y se informa cuántos puntos se pudieron evaluar.

export type IndicatorState = "calculado" | "parcial" | "insuficiente";

export type HealthIndicator = {
  key: "rentabilidad" | "retencion" | "ocupacion";
  label: string;
  /** Puntos máximos del indicador. */
  max: number;
  /** Puntos que se pudieron evaluar (igual a `max` salvo que falten datos de una parte). */
  evaluable: number;
  /** Puntos ganados, enteros. null cuando no hay datos suficientes. */
  pts: number | null;
  state: IndicatorState;
  /** El dato medido, listo para mostrar ("Margen 36%"). */
  valueText: string;
  /** Resultado: por qué obtuvo esos puntos. */
  why: string;
  /** Período que se midió. */
  period: string;
  /** Datos que se usaron, uno por línea. */
  datos: string[];
  /** Con qué resultado se logra el máximo de puntos. */
  escala: string;
};

export type HealthScore = {
  /** Suma de los puntos visibles de las tarjetas; null si no hay datos para calcular la salud. */
  total: number | null;
  /** Total llevado a 100 (solo difiere de `total` cuando el resultado es parcial). Sirve para el color y el aro. */
  scaled: number | null;
  /** Puntos que se pudieron evaluar (100 si no falta ningún dato). */
  available: number;
  indicators: HealthIndicator[];
  /** Falta algún dato: el resultado es parcial. */
  partial: boolean;
  /** Período cerrado con pérdida operativa. */
  requiereAtencion: boolean;
};

export const HEALTH_MIN_AVAILABLE = 25;
/** Mínimo de clientes para medir cada parte de la retención. */
export const RETENTION_MIN_COHORT = 10;

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
/** 0 en x0, 1 en x1, lineal entre medio. */
const lin = (x: number, x0: number, x1: number) => clamp((x - x0) / (x1 - x0));
const pctTxt = (n: number) => `${Math.round(n)}%`;
const pctTxt1 = (n: number) => `${(Math.round(n * 10) / 10).toString().replace(".", ",")}%`;
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("es-AR")}`;

// ─────────────────────────── Escalas ───────────────────────────
const ESCALA_RENTABILIDAD = "45 puntos con 35% de margen o más.";
const ESCALA_RETENCION = "Nuevos: 20 puntos con 70% o más. Habituales: 10 puntos con 85% o más.";
const ESCALA_OCUPACION = "25 puntos con 80% de ocupación o más.";
export const pointsRentabilidad = (margen: number) =>
  margen <= 0 ? 0 : margen <= 20 ? 25 * (margen / 20) : 25 + 20 * lin(margen, 20, 35);
export const pointsNuevos = (rate: number) => 20 * lin(rate, 20, 70);
export const pointsHabituales = (rate: number) => 10 * lin(rate, 40, 85);
export const pointsOcupacion = (pct: number) =>
  pct <= 20 ? 0 : pct <= 50 ? 15 * ((pct - 20) / 30) : 15 + 10 * lin(pct, 50, 80);

export type HealthInput = {
  /** Período que se mide, listo para mostrar ("noviembre de 2026"). */
  periodoLabel: string;
  /** El período ya terminó (mes cerrado). */
  periodoCerrado: boolean;
  /** Hubo actividad (cobros o turnos) en el período. */
  hayActividad: boolean;

  /** Ganancia operativa: lo cobrado y consumos − gastos − pago a profesionales (comisiones contadas una sola vez). */
  facturacion: number;
  /** Gastos del período y pago a profesionales (lo que se descuenta de la facturación para llegar a la ganancia). */
  gastos: number;
  pagoProfesionales: number;
  ganancia: number | null;
  margen: number | null;

  /** Ocupación real: turnos realizados contra turnos disponibles (la duración del turno es la de cada profesional). */
  turnosRealizados: number;
  turnosDisponibles: number;
  /** Ocupación agendada (tiempo reservado sobre el disponible), solo informativa. */
  ocupacionAgendada: number | null;
  turnosCancelados: number;
  turnosNoAsistio: number;

  /** Clientes nuevos con 45 días completos para volver, y cuántos tuvieron un segundo servicio dentro de esos 45 días. */
  nuevosElegibles: number;
  nuevosVolvieron: number;
  nuevosDesde: string;
  nuevosHasta: string;
  /** Clientes habituales (3 visitas o más) y cuántos siguen viniendo dentro de su frecuencia esperada. */
  habituales: number;
  habitualesAlDia: number;
};

export function computeHealthScore(i: HealthInput): HealthScore {
  const indicators: HealthIndicator[] = [];

  // 1. Rentabilidad operativa (45)
  {
    const nominal = 45;
    if (!(i.facturacion > 0) || i.margen == null || i.ganancia == null) {
      indicators.push({
        key: "rentabilidad", label: "Rentabilidad operativa", max: nominal, evaluable: 0, pts: null, state: "insuficiente",
        valueText: "Sin ventas para medir",
        why: "Todavía no hay ventas suficientes para calcular la ganancia y el margen.",
        period: i.periodoLabel,
        escala: ESCALA_RENTABILIDAD,
        datos: [],
      });
    } else {
      const margen = i.margen;
      const pts = Math.round(pointsRentabilidad(margen));
      indicators.push({
        key: "rentabilidad", label: "Rentabilidad operativa", max: nominal, evaluable: nominal, pts, state: "calculado",
        valueText: `Ganancia ${money(i.ganancia)} · margen ${pctTxt(margen)}`,
        why: `El margen es ${pctTxt1(margen)} y suma ${pts} de ${nominal} puntos.`,
        period: i.periodoLabel,
        escala: ESCALA_RENTABILIDAD,
        datos: [
          `Facturación: ${money(i.facturacion)}`,
          `Gastos: ${money(i.gastos)}`,
          `Pago a profesionales: ${money(i.pagoProfesionales)}`,
          `Ganancia operativa: ${money(i.ganancia)}`,
          `Margen: ${pctTxt1(margen)}`,
        ],
      });
    }
  }

  // 2. Retención de clientes (30 = 20 nuevos + 10 habituales)
  {
    const nominal = 30;
    const nuevosOk = i.nuevosElegibles >= RETENTION_MIN_COHORT;
    const habitualesOk = i.habituales >= RETENTION_MIN_COHORT;
    const rateNuevos = nuevosOk ? (i.nuevosVolvieron / i.nuevosElegibles) * 100 : null;
    const rateHab = habitualesOk ? (i.habitualesAlDia / i.habituales) * 100 : null;
    const ptsNuevos = rateNuevos != null ? Math.round(pointsNuevos(rateNuevos)) : null;
    const ptsHab = rateHab != null ? Math.round(pointsHabituales(rateHab)) : null;
    const evaluable = (ptsNuevos != null ? 20 : 0) + (ptsHab != null ? 10 : 0);
    const pts = evaluable > 0 ? (ptsNuevos ?? 0) + (ptsHab ?? 0) : null;

    const datos: string[] = [
      nuevosOk
        ? `Nuevos: ${i.nuevosVolvieron} de ${i.nuevosElegibles} volvieron dentro de 45 días (${pctTxt(rateNuevos as number)}) → ${ptsNuevos} de 20 puntos`
        : `Nuevos: ${i.nuevosElegibles} clientes con 45 días para volver; hacen falta al menos ${RETENTION_MIN_COHORT} para medirlo`,
      habitualesOk
        ? `Habituales: ${i.habitualesAlDia} de ${i.habituales} siguen viniendo dentro de su frecuencia (${pctTxt(rateHab as number)}) → ${ptsHab} de 10 puntos`
        : `Habituales: ${i.habituales} clientes con 3 visitas o más; hacen falta al menos ${RETENTION_MIN_COHORT} para medirlo`,
    ];
    indicators.push({
      key: "retencion", label: "Retención de clientes", max: nominal, evaluable, pts,
      state: evaluable === 0 ? "insuficiente" : evaluable < nominal ? "parcial" : "calculado",
      valueText:
        evaluable === 0
          ? "Pocos clientes para medir"
          : `Nuevos ${rateNuevos != null ? pctTxt(rateNuevos) : "—"} · habituales ${rateHab != null ? pctTxt(rateHab) : "—"}`,
      why:
        evaluable === 0
          ? "Todavía no hay suficientes clientes para medir la retención."
          : `Suma ${pts} de ${evaluable} puntos evaluados${evaluable < nominal ? ` (se pudieron evaluar ${evaluable} de ${nominal})` : ""}.`,
      period: `Nuevos: primeras visitas del ${i.nuevosDesde} al ${i.nuevosHasta} · Habituales: hoy`,
      escala: ESCALA_RETENCION,
      datos,
    });
  }

  // 3. Ocupación real de agenda (25)
  {
    const nominal = 25;
    if (i.turnosDisponibles <= 0) {
      indicators.push({
        key: "ocupacion", label: "Ocupación atendida", max: nominal, evaluable: 0, pts: null, state: "insuficiente",
        valueText: "Sin horarios cargados",
        why: "No hay horarios de atención suficientes para medir la ocupación.",
        period: i.periodoLabel,
        escala: ESCALA_OCUPACION,
        datos: [],
      });
    } else {
      const pct = (i.turnosRealizados / i.turnosDisponibles) * 100;
      const pts = Math.round(pointsOcupacion(pct));
      indicators.push({
        key: "ocupacion", label: "Ocupación atendida", max: nominal, evaluable: nominal, pts, state: "calculado",
        valueText: `Ocupación ${pctTxt(Math.min(100, pct))}`,
        why: `Ocupás el ${pctTxt1(Math.min(100, pct))} del tiempo disponible y suma ${pts} de ${nominal} puntos.`,
        period: i.periodoLabel,
        escala: ESCALA_OCUPACION,
        datos: [
          `Turnos realizados: ${i.turnosRealizados.toLocaleString("es-AR")}`,
          `Turnos disponibles: ${i.turnosDisponibles.toLocaleString("es-AR")}`,
          `Ocupación atendida: ${pctTxt1(Math.min(100, pct))}`,
          ...(i.ocupacionAgendada != null ? [`Ocupación agendada: ${i.ocupacionAgendada}%`] : []),
          `Cancelaciones: ${i.turnosCancelados}`,
          `No asistió: ${i.turnosNoAsistio}`,
        ],
      });
    }
  }

  const medibles = indicators.filter((x) => x.pts != null);
  const available = indicators.reduce((s, x) => s + x.evaluable, 0);
  const earned = medibles.reduce((s, x) => s + (x.pts as number), 0);
  const partial = available < 100;
  const hayDatos = i.hayActividad && available >= HEALTH_MIN_AVAILABLE;
  const perdida = i.periodoCerrado && i.ganancia != null && i.ganancia < 0;
  return {
    total: hayDatos ? earned : null,
    scaled: hayDatos ? Math.round((earned / available) * 100) : null,
    available,
    indicators,
    partial: hayDatos && partial,
    requiereAtencion: hayDatos && perdida,
  };
}

// ─────────────────────────── Retención ───────────────────────────
const toDay = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / 86_400_000;
const dayKeyOf = (iso: string) =>
  new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });
const fmtDM = (dayKey: string) => `${dayKey.slice(8, 10)}/${dayKey.slice(5, 7)}`;
const addDays = (key: string, n: number) => new Date((toDay(key) + n) * 86_400_000).toISOString().slice(0, 10);

export const NEW_CLIENT_WINDOW_DAYS = 45;
/** Ancho del grupo de primeras visitas que se mide (cada una con sus 45 días completos). */
export const NEW_CLIENT_COHORT_DAYS = 90;

export type RetentionClient = {
  firstVisitAt?: string | null;
  secondVisitAt?: string | null;
  visits: number;
  grupo?: string | null;
};

// Nuevos: primeras visitas que ya tuvieron 45 días completos para volver (hasta `cutKey`) y que caen en los 90 días
// anteriores a ese límite. Volvió = tuvo otro servicio, en otro día, dentro de los 45 días de la primera visita.
export function computeNewClientRetention(clients: RetentionClient[], cutKey: string) {
  const hasta = addDays(cutKey, -NEW_CLIENT_WINDOW_DAYS);
  const desde = addDays(hasta, -(NEW_CLIENT_COHORT_DAYS - 1));
  let elegibles = 0;
  let volvieron = 0;
  for (const c of clients) {
    if (!c.firstVisitAt) continue;
    const f = dayKeyOf(c.firstVisitAt);
    if (f < desde || f > hasta) continue;
    elegibles += 1;
    if (c.secondVisitAt) {
      const gap = toDay(dayKeyOf(c.secondVisitAt)) - toDay(f);
      if (gap >= 1 && gap <= NEW_CLIENT_WINDOW_DAYS) volvieron += 1;
    }
  }
  return { elegibles, volvieron, desde: fmtDM(desde), hasta: fmtDM(hasta) };
}

// Habituales: 3 visitas o más. "Al día" = no figuran como Perdidos en Clientes (que pasan a Perdidos cuando superan 1,5
// veces su ritmo habitual entre visitas, con un mínimo de 30 y un máximo de 120 días).
export function computeHabitualRetention(clients: RetentionClient[]) {
  let habituales = 0;
  let alDia = 0;
  for (const c of clients) {
    if (c.visits < 3) continue;
    habituales += 1;
    if (c.grupo && c.grupo !== "perdido") alDia += 1;
  }
  return { habituales, alDia };
}
