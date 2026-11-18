// Puntaje de salud del negocio (0 a 100). Mide la salud económica y comercial con seis indicadores y NO regala puntos:
// cada uno se gana según resultados reales contra un objetivo.
//
//   Rentabilidad y margen ........ 25   (margen de 0% a 35%)
//   Ocupación de agenda .......... 25   (ocupación hasta 75%)
//   Retención de clientes ........ 20   (de 40% a 85% de clientes que vuelven)
//   Crecimiento de facturación ... 15   (de -15% a +15% contra el período equivalente)
//   Cancelaciones y no asistencias 10   (de 5% a 25% de turnos que no se hacen)
//   Ticket promedio ..............  5   (de -5% a +5% contra el período equivalente)
//
// Cada indicador tiene un estado:
//   · calculado    → hay datos completos.
//   · provisional  → se calculó con lo registrado, pero falta confirmar algo (p. ej. gastos fijos del mes sin cargar).
//                    Cuenta en el puntaje: nunca se estima ni se descuenta nada por lo que falta registrar.
//   · insuficiente → todavía no hay datos para medirlo: no suma ni resta; el puntaje se reparte sobre el resto.
export type IndicatorState = "calculado" | "provisional" | "insuficiente";

export type HealthIndicator = {
  key: "rentabilidad" | "ocupacion" | "retencion" | "crecimiento" | "cancelaciones" | "ticket";
  label: string;
  max: number;
  /** Puntos ganados. null cuando no hay datos suficientes. */
  pts: number | null;
  state: IndicatorState;
  /** El dato medido, listo para mostrar ("Margen 36%"). */
  valueText: string;
  /** Por qué obtuvo esos puntos. */
  why: string;
  /** Qué puede hacer para mejorarlo. */
  tip: string;
  /** Advertencia informativa (p. ej. rentabilidad provisional). */
  warning?: string;
};

export type HealthScore = {
  /** 0 a 100 calculado sobre los indicadores medibles; null si no alcanzan los datos. */
  total: number | null;
  earned: number;
  /** Puntos máximos de los indicadores que se pudieron medir. */
  available: number;
  indicators: HealthIndicator[];
  provisional: boolean;
  /** Algún indicador no se pudo medir todavía. */
  partial: boolean;
};

export const HEALTH_MIN_AVAILABLE = 40;
export const RETENTION_MIN_COHORT = 30;
export const CANCEL_MIN_APPOINTMENTS = 20;

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
/** 0 en x0, 1 en x1, lineal entre medio. */
const lin = (x: number, x0: number, x1: number) => clamp((x - x0) / (x1 - x0));
const r1 = (n: number) => Math.round(n * 10) / 10;
const pctTxt = (n: number) => `${Math.round(n)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(Math.round(n * 10) / 10).toFixed(1).replace(".", ",")}%`;

export type HealthInput = {
  /** Ventas del período (para saber si hay actividad). */
  facturacion: number;
  margen: number | null;
  gastosTotal: number;
  /** Cantidad de gastos fijos registrados en el período. */
  gastosFijosCargados: number;
  /** El dueño confirmó que los gastos del mes están completos (opcional, a futuro). */
  gastosConfirmados?: boolean;

  ocupacion: number | null;
  totalSlots: number;

  /** Retención: clientes del grupo de referencia y cuántos volvieron. */
  retencionGrupo: number;
  retencionVolvieron: number;

  /** Variación contra el período equivalente (días completos). null si no hay base comparable. */
  crecimientoPct: number | null;
  ticketPct: number | null;

  turnosHechos: number;
  turnosCancelados: number;
  turnosNoAsistio: number;
};

export function computeHealthScore(i: HealthInput): HealthScore {
  const indicators: HealthIndicator[] = [];

  // 1. Rentabilidad y margen
  {
    const hayVentas = i.facturacion > 0 && i.margen != null;
    if (!hayVentas) {
      indicators.push({
        key: "rentabilidad", label: "Rentabilidad y margen", max: 25, pts: null, state: "insuficiente", valueText: "Sin ventas para medir",
        why: "Todavía no hay ventas suficientes para calcular el margen.",
        tip: "Se calcula solo cuando haya ventas registradas.",
      });
    } else {
      const margen = i.margen as number;
      const pts = 25 * lin(margen, 0, 35);
      const provisional = !i.gastosConfirmados && i.gastosFijosCargados === 0;
      indicators.push({
        key: "rentabilidad", label: "Rentabilidad y margen", max: 25, pts: r1(pts), state: provisional ? "provisional" : "calculado",
        valueText: `Margen ${pctTxt(margen)}`,
        why: `El margen es ${pctTxt(margen)}; con 35% o más se logran los 25 puntos.`,
        tip: margen >= 35 ? "Mantené el control de gastos y el precio de tus servicios." : "Revisá tus gastos y el precio de los servicios que más vendés: cada punto de margen suma.",
        warning: provisional
          ? "Rentabilidad provisional: todavía no hay gastos fijos registrados este mes. Se calculó con los gastos cargados y se actualiza sola cuando los registres."
          : undefined,
      });
    }
  }

  // 2. Ocupación
  {
    if (i.ocupacion == null || i.totalSlots <= 0) {
      indicators.push({
        key: "ocupacion", label: "Ocupación de agenda", max: 25, pts: null, state: "insuficiente", valueText: "Sin horarios cargados",
        why: "No hay horarios de atención suficientes para medir la ocupación.",
        tip: "Cargá los horarios de tus profesionales en Configuración.",
      });
    } else {
      const pts = 25 * clamp(i.ocupacion / 75);
      indicators.push({
        key: "ocupacion", label: "Ocupación de agenda", max: 25, pts: r1(pts), state: "calculado", valueText: `Ocupación ${pctTxt(i.ocupacion)}`,
        why: `Ocupás el ${pctTxt(i.ocupacion)} de los turnos disponibles; con 75% o más se logran los 25 puntos.`,
        tip: i.ocupacion >= 75 ? "Tu agenda está bien aprovechada." : "Llená los turnos vacíos: promociones en los días flojos y recordatorios a clientes inactivos.",
      });
    }
  }

  // 3. Retención
  {
    if (i.retencionGrupo < RETENTION_MIN_COHORT) {
      indicators.push({
        key: "retencion", label: "Retención de clientes", max: 20, pts: null, state: "insuficiente",
        valueText: `Pocos clientes para medir (${i.retencionGrupo})`,
        why: `Hacen falta al menos ${RETENTION_MIN_COHORT} clientes con más de 45 días de antigüedad para medir cuántos vuelven.`,
        tip: "Se va a calcular solo a medida que sumes clientes.",
      });
    } else {
      const rate = (i.retencionVolvieron / i.retencionGrupo) * 100;
      const pts = 20 * lin(rate, 40, 85);
      indicators.push({
        key: "retencion", label: "Retención de clientes", max: 20, pts: r1(pts), state: "calculado",
        valueText: `Vuelven ${pctTxt(rate)} (${i.retencionVolvieron} de ${i.retencionGrupo})`,
        why: `De ${i.retencionGrupo} clientes que vinieron hace 45 a 75 días, ${i.retencionVolvieron} volvieron (${pctTxt(rate)}). Con 85% o más se logran los 20 puntos.`,
        tip: rate >= 85 ? "Tus clientes vuelven: seguí cuidándolos." : "Escribile a quienes no volvieron y agendá la próxima visita antes de que se vayan.",
      });
    }
  }

  // 4. Crecimiento de facturación
  {
    if (i.crecimientoPct == null) {
      indicators.push({
        key: "crecimiento", label: "Crecimiento de facturación", max: 15, pts: null, state: "insuficiente", valueText: "Sin período anterior comparable",
        why: "No hay un período anterior equivalente con el que comparar.",
        tip: "Se calcula cuando haya un mes anterior completo de actividad.",
      });
    } else {
      const pts = 15 * lin(i.crecimientoPct, -15, 15);
      indicators.push({
        key: "crecimiento", label: "Crecimiento de facturación", max: 15, pts: r1(pts), state: "calculado", valueText: `${signed(i.crecimientoPct)} vs período equivalente`,
        why: `La facturación varió ${signed(i.crecimientoPct)} contra el mismo período del mes anterior (días completos). Con +15% o más se logran los 15 puntos.`,
        tip: i.crecimientoPct >= 15 ? "Estás creciendo bien." : "Sumá clientes nuevos y recuperá a los que no vuelven.",
      });
    }
  }

  // 5. Cancelaciones y no asistencias
  {
    const total = i.turnosHechos + i.turnosCancelados + i.turnosNoAsistio;
    if (total < CANCEL_MIN_APPOINTMENTS) {
      indicators.push({
        key: "cancelaciones", label: "Cancelaciones y no asistencias", max: 10, pts: null, state: "insuficiente", valueText: `Pocos turnos (${total})`,
        why: `Hacen falta al menos ${CANCEL_MIN_APPOINTMENTS} turnos cerrados para medirlo.`,
        tip: "Se va a calcular solo a medida que se cierren turnos.",
      });
    } else {
      const rate = ((i.turnosCancelados + i.turnosNoAsistio) / total) * 100;
      const pts = 10 * (1 - lin(rate, 5, 25));
      indicators.push({
        key: "cancelaciones", label: "Cancelaciones y no asistencias", max: 10, pts: r1(pts), state: "calculado",
        valueText: `${pctTxt(rate)} de turnos no realizados`,
        why: `De ${total} turnos, ${i.turnosCancelados} se cancelaron y ${i.turnosNoAsistio} no asistieron (${pctTxt(rate)}). Con 5% o menos se logran los 10 puntos.`,
        tip: rate <= 5 ? "Muy pocas faltas: bien." : "Pedí seña en los turnos con más faltas y mandá recordatorios el día anterior.",
      });
    }
  }

  // 6. Ticket promedio
  {
    if (i.ticketPct == null) {
      indicators.push({
        key: "ticket", label: "Ticket promedio", max: 5, pts: null, state: "insuficiente", valueText: "Sin período anterior comparable",
        why: "No hay un período anterior equivalente con el que comparar.",
        tip: "Se calcula cuando haya un mes anterior completo de actividad.",
      });
    } else {
      const pts = 5 * lin(i.ticketPct, -5, 5);
      indicators.push({
        key: "ticket", label: "Ticket promedio", max: 5, pts: r1(pts), state: "calculado", valueText: `${signed(i.ticketPct)} vs período equivalente`,
        why: `El ticket promedio varió ${signed(i.ticketPct)} contra el mismo período del mes anterior. Con +5% o más se logran los 5 puntos.`,
        tip: i.ticketPct >= 5 ? "Tu ticket sube: bien." : "Ofrecé combos (corte + barba) y productos al cobrar.",
      });
    }
  }

  const medibles = indicators.filter((x) => x.pts != null);
  const available = medibles.reduce((s, x) => s + x.max, 0);
  const earned = r1(medibles.reduce((s, x) => s + (x.pts as number), 0));
  const total = available >= HEALTH_MIN_AVAILABLE ? Math.round((earned / available) * 100) : null;
  return {
    total,
    earned,
    available,
    indicators,
    provisional: indicators.some((x) => x.state === "provisional"),
    partial: indicators.some((x) => x.state === "insuficiente"),
  };
}

// ─────────────────────────── Retención ───────────────────────────
// Clientes vistos hace 45 a 75 días (a contar desde `cutKey`, inclusive) y cuántos volvieron en los últimos 45.
export type VisitDay = { clientKey: string; dayKey: string };

const toDay = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / 86_400_000;

export function computeRetention(visits: VisitDay[], cutKey: string): { grupo: number; volvieron: number } {
  const cut = toDay(cutKey);
  const grupo = new Set<string>();
  const volvieron = new Set<string>();
  for (const v of visits) {
    const d = toDay(v.dayKey);
    if (d > cut - 75 && d <= cut - 45) grupo.add(v.clientKey);
  }
  for (const v of visits) {
    const d = toDay(v.dayKey);
    if (d > cut - 45 && d <= cut && grupo.has(v.clientKey)) volvieron.add(v.clientKey);
  }
  return { grupo: grupo.size, volvieron: volvieron.size };
}
