import { reasonLabel, type RejectedClient } from "@/hooks/use-rejected-clients";

// ── Helpers de fecha ────────────────────────────────────────────────────────
const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function parseLocalDate(dateISO: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function daysAgo(d: Date, n: number): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - n);
  return x;
}
function hourOf(time: string): number {
  return Number(time.slice(0, 2)) || 0;
}

// Hora a partir de la cual consideramos un rechazo "tardío" (señal de ampliar horarios).
const LATE_CUTOFF = 19;

/** Ventana contigua de `width` horas con mayor concentración de rechazos. */
function densestWindow(hourMap: Map<number, number>, width = 3): { start: number; end: number } | null {
  if (hourMap.size === 0) return null;
  const hours = [...hourMap.keys()];
  const minH = Math.min(...hours);
  const maxH = Math.max(...hours);
  let best = { start: minH, sum: -1 };
  for (let s = minH; s <= maxH; s++) {
    let sum = 0;
    for (let k = s; k < s + width; k++) sum += hourMap.get(k) ?? 0;
    if (sum > best.sum) best = { start: s, sum };
  }
  return { start: best.start, end: best.start + width };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// ── Tipos de salida ─────────────────────────────────────────────────────────
export type CountSet = { today: number; week: number; month: number };
export type LabeledCount = { key: string; label: string; count: number };
export type HourCount = { hour: number; count: number };
export type MonthlyPoint = { ym: string; label: string; count: number };
export type ProfessionalDemand = {
  id: string | null;
  name: string;
  requests: number; // solicitudes que no se concretaron (reason = profesional)
  score: number; // índice de demanda 0-100
  tier: "fire" | "high" | "mid" | "low";
  recommendation: string;
};

export type RejectedAnalytics = {
  total: number;
  counts: CountSet;
  lostRevenue: CountSet;
  peakHours: HourCount[]; // ordenado desc por count
  peakHourLabel: string | null; // p.ej. "18:00 y 20:00"
  peakDays: LabeledCount[]; // por día de semana, desc
  topServices: LabeledCount[];
  topReasons: LabeledCount[];
  topProfessionals: LabeledCount[]; // por nombre solicitado
  monthly: MonthlyPoint[]; // evolución últimos 6 meses
  avgOccupancyMonth: number | null;
  professionals: ProfessionalDemand[];
  // Señales combinadas (para el motor de recomendaciones)
  reasonsMonth: Record<string, number>; // conteo por motivo (últimos 30 días)
  lateShare: number; // 0..1 — proporción de rechazos después de LATE_CUTOFF
  lateCutoffLabel: string; // "19:00"
  peakRangeLabel: string | null; // franja contigua pico "17:00 y 20:00"
  peakDayLabels: string[]; // 1-2 días de semana con más demanda
  prevMonthCount: number; // rechazos en el período 30-59 días atrás
  trend: "up" | "down" | "flat";
  trendPct: number | null; // variación % vs período anterior
};

// ── Índice de demanda por profesional (heurístico, documentado) ─────────────
// Considera: solicitudes no concretadas del profesional + ocupación general.
// (No depende de la facturación.) El más solicitado, con ocupación alta, ~98.
function demandScore(requests: number, maxRequests: number, occupancyPct: number | null): number {
  const reqPart = maxRequests > 0 ? requests / maxRequests : 0;
  const occPart = (occupancyPct ?? 0) / 100;
  return Math.max(0, Math.min(100, Math.round(60 * reqPart + 40 * occPart)));
}
function tierOf(score: number): ProfessionalDemand["tier"] {
  if (score >= 85) return "fire";
  if (score >= 60) return "high";
  if (score >= 45) return "mid";
  return "low";
}
export const TIER_EMOJI: Record<ProfessionalDemand["tier"], string> = {
  fire: "🔥",
  high: "🟢",
  mid: "🟡",
  low: "🔵",
};

function topN(map: Map<string, { label: string; count: number }>, n = 5): LabeledCount[] {
  return [...map.entries()]
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

// ── Agregación principal ────────────────────────────────────────────────────
export function summarizeRejected(
  rows: RejectedClient[],
  opts: { now?: Date; priceById?: Map<string, number> } = {},
): RejectedAnalytics {
  const now = opts.now ?? new Date();
  const priceById = opts.priceById ?? new Map<string, number>();

  const todayStart = startOfDay(now);
  const weekStart = daysAgo(now, 6); // hoy + 6 días atrás
  const monthStart = daysAgo(now, 29); // ventana móvil de 30 días
  const prevStart = daysAgo(now, 59); // período anterior (30-59 días atrás)

  const counts: CountSet = { today: 0, week: 0, month: 0 };
  const lostRevenue: CountSet = { today: 0, week: 0, month: 0 };

  let lateCount = 0;
  let prevMonthCount = 0;
  const reasonsMonth: Record<string, number> = {};

  const hourMap = new Map<number, number>();
  const dayMap = new Map<string, { label: string; count: number }>();
  const svcMap = new Map<string, { label: string; count: number }>();
  const reasonMap = new Map<string, { label: string; count: number }>();
  const profMap = new Map<string, { label: string; count: number; id: string | null }>();
  const monthMap = new Map<string, number>();

  let occSum = 0;
  let occN = 0;

  for (const r of rows) {
    const d = parseLocalDate(r.rejected_date);
    const price = r.service_id ? priceById.get(r.service_id) ?? 0 : 0;

    if (d.getTime() >= monthStart.getTime()) {
      counts.month += 1;
      lostRevenue.month += price;
      if (typeof r.occupancy_pct === "number") {
        occSum += r.occupancy_pct;
        occN += 1;
      }
    }
    if (d.getTime() >= weekStart.getTime()) {
      counts.week += 1;
      lostRevenue.week += price;
    }
    if (d.getTime() === todayStart.getTime()) {
      counts.today += 1;
      lostRevenue.today += price;
    }
    if (d.getTime() >= prevStart.getTime() && d.getTime() < monthStart.getTime()) {
      prevMonthCount += 1;
    }

    // Histogramas (sobre los últimos 30 días para que sean accionables)
    if (d.getTime() >= monthStart.getTime()) {
      const h = hourOf(r.rejected_time);
      hourMap.set(h, (hourMap.get(h) ?? 0) + 1);
      if (h >= LATE_CUTOFF) lateCount += 1;
      reasonsMonth[r.reason] = (reasonsMonth[r.reason] ?? 0) + 1;

      const wd = String(r.weekday);
      const wdLabel = WEEKDAYS[r.weekday] ?? "—";
      dayMap.set(wd, { label: wdLabel, count: (dayMap.get(wd)?.count ?? 0) + 1 });

      const svcKey = r.service_name ?? "Otro";
      svcMap.set(svcKey, { label: svcKey, count: (svcMap.get(svcKey)?.count ?? 0) + 1 });

      reasonMap.set(r.reason, { label: reasonLabel(r.reason), count: (reasonMap.get(r.reason)?.count ?? 0) + 1 });

      if (r.reason === "profesional" && r.requested_employee_name) {
        const pk = r.requested_employee_id ?? r.requested_employee_name;
        const prev = profMap.get(pk);
        profMap.set(pk, {
          label: r.requested_employee_name,
          count: (prev?.count ?? 0) + 1,
          id: r.requested_employee_id ?? null,
        });
      }
    }

    // Evolución mensual (últimos 6 meses)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthMap.set(ym, (monthMap.get(ym) ?? 0) + 1);
  }

  const peakHours: HourCount[] = [...hourMap.entries()]
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => b.count - a.count);

  // Rango de franja pico (dos horas top contiguas o la top + 1)
  let peakHourLabel: string | null = null;
  if (peakHours.length > 0) {
    const top = peakHours[0].hour;
    peakHourLabel = `${String(top).padStart(2, "0")}:00 y ${String(top + 2).padStart(2, "0")}:00`;
  }

  // Últimos 6 meses en orden cronológico
  const monthly: MonthlyPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    monthly.push({
      ym,
      label: dt.toLocaleDateString("es-AR", { month: "short" }),
      count: monthMap.get(ym) ?? 0,
    });
  }

  const avgOccupancyMonth = occN > 0 ? Math.round(occSum / occN) : null;

  // Señales combinadas
  const lateShare = counts.month > 0 ? lateCount / counts.month : 0;
  const win = densestWindow(hourMap, 3);
  const peakRangeLabel = win ? `${pad2(win.start)}:00 y ${pad2(win.end)}:00` : null;
  const peakDayLabels = topN(dayMap, 2).map((d) => d.label);
  let trend: "up" | "down" | "flat" = "flat";
  let trendPct: number | null = null;
  if (prevMonthCount > 0) {
    trendPct = Math.round(((counts.month - prevMonthCount) / prevMonthCount) * 100);
    trend = trendPct > 10 ? "up" : trendPct < -10 ? "down" : "flat";
  } else if (counts.month > 0) {
    trend = "up";
  }

  // Demanda por profesional + índice
  const profEntries = [...profMap.entries()].map(([key, v]) => ({ key, ...v }));
  const maxReq = profEntries.reduce((m, p) => Math.max(m, p.count), 0);
  const professionals: ProfessionalDemand[] = profEntries
    .map((p) => {
      const score = demandScore(p.count, maxReq, avgOccupancyMonth);
      const tier = tierOf(score);
      return {
        id: p.id,
        name: p.label,
        requests: p.count,
        score,
        tier,
        recommendation: professionalRecommendation(p.label, p.count, tier),
      };
    })
    .sort((a, b) => b.score - a.score);

  return {
    total: rows.length,
    counts,
    lostRevenue,
    peakHours,
    peakHourLabel,
    peakDays: topN(dayMap),
    topServices: topN(svcMap),
    topReasons: topN(reasonMap),
    topProfessionals: topN(
      new Map([...profMap.entries()].map(([k, v]) => [k, { label: v.label, count: v.count }])),
    ),
    monthly,
    avgOccupancyMonth,
    professionals,
    reasonsMonth,
    lateShare,
    lateCutoffLabel: `${pad2(LATE_CUTOFF)}:00`,
    peakRangeLabel,
    peakDayLabels,
    prevMonthCount,
    trend,
    trendPct,
  };
}

function professionalRecommendation(name: string, requests: number, tier: ProfessionalDemand["tier"]): string {
  if (tier === "fire") {
    return `${name} recibió ${requests} solicitudes que no pudieron concretarse este mes. Es el profesional con mayor demanda del equipo. Considerá ampliar sus horarios, aumentar gradualmente el precio de sus servicios para equilibrar la demanda o derivar parte de sus clientes hacia otros profesionales.`;
  }
  if (tier === "high") {
    return `${name} tiene una demanda sostenida (${requests} solicitudes sin turno este mes). Si la tendencia continúa, podría justificarse ampliar sus horarios o un aumento gradual de precio.`;
  }
  return `${name} recibió ${requests} ${requests === 1 ? "solicitud" : "solicitudes"} sin turno. Todavía con margen; promoverlo en la reserva online puede equilibrar la demanda del equipo.`;
}

// ── Veredicto de contratación (¿conviene incorporar un profesional?) ────────
export type StaffingTier = "no" | "evaluar" | "incorporar";
export function staffingVerdict(
  occupancyPct: number | null,
  monthRejected: number,
  peakHourLabel: string | null,
): { tier: StaffingTier; nivel: "recomendado" | "evaluar" | "no_recomendado"; text: string } {
  const occ = occupancyPct ?? 0;
  const occTxt = occupancyPct != null ? `${occupancyPct}%` : "—";

  if (occ >= 88 && monthRejected >= 30) {
    return {
      tier: "incorporar",
      nivel: "recomendado",
      text: `Tu agenda mantiene una ocupación del ${occTxt} y rechazaste ${monthRejected} clientes este mes. La demanda supera la capacidad del equipo: probablemente estés perdiendo ventas por falta de disponibilidad. Conviene incorporar un profesional.`,
    };
  }
  if (monthRejected >= 8) {
    return {
      tier: "evaluar",
      nivel: "evaluar",
      text: `Ocupación del ${occTxt} y ${monthRejected} clientes rechazados este mes${
        peakHourLabel ? `, la mayoría entre las ${peakHourLabel}` : ""
      }. Antes de incorporar un profesional, evaluá ampliar horarios en esa franja.`,
    };
  }
  return {
    tier: "no",
    nivel: "no_recomendado",
    text: `Tu ocupación es del ${occTxt} y este mes solo rechazaste ${monthRejected} ${
      monthRejected === 1 ? "cliente" : "clientes"
    }. Todavía no hay evidencia suficiente para incorporar un profesional: tenés capacidad para crecer con el equipo actual.`,
  };
}

// ── Motor de recomendaciones (análisis combinado, con justificación) ────────
export type DemandRecKind = "incorporar" | "ampliar_horarios" | "ajustar_precio" | "esperar";
export type DemandRecommendation = {
  kind: DemandRecKind;
  priority: "alta" | "media" | "baja";
  nivel: "recomendado" | "evaluar" | "no_recomendado";
  title: string;
  reasoning: string; // explica SIEMPRE el porqué, con números reales
  confidence: "alta" | "media" | "preliminar";
};

/**
 * Genera recomendaciones cruzando TODAS las señales disponibles
 * (ocupación, volumen de rechazos, horarios, días, motivos, profesional
 * solicitado, profesionales trabajando, servicios y tendencia), en lugar de
 * un único umbral fijo. La confianza escala con el volumen de datos, así las
 * recomendaciones se vuelven más precisas a medida que se acumula historial.
 */
export function buildDemandRecommendations(
  a: RejectedAnalytics,
  ctx: { occupancyPct: number | null; workingProfessionals: number | null } = { occupancyPct: null, workingProfessionals: null },
): DemandRecommendation[] {
  const month = a.counts.month;
  const occ = Math.round(ctx.occupancyPct ?? a.avgOccupancyMonth ?? 0);
  const occTxt = `${occ}%`;
  const period = "en los últimos 30 días";

  const confidence: DemandRecommendation["confidence"] = month >= 25 ? "alta" : month >= 8 ? "media" : "preliminar";

  const trendNote =
    a.trend === "up" && a.trendPct != null && a.prevMonthCount > 0
      ? ` Además, los rechazos crecieron ${a.trendPct}% respecto del período anterior.`
      : a.trend === "down" && a.trendPct != null
        ? ` La tendencia viene bajando (${a.trendPct}% vs el período anterior).`
        : "";

  const fuera = a.reasonsMonth["fuera_horario"] ?? 0;
  const lateOrFuera = Math.max(a.lateShare, month > 0 ? fuera / month : 0);
  const broad = lateOrFuera < 0.6; // los rechazos NO son solo por horario tardío

  const recs: DemandRecommendation[] = [];

  // 1) Profesional con demanda dominante → ajustar precio / redistribuir
  const top = a.professionals[0];
  const totalProfReq = a.professionals.reduce((s, p) => s + p.requests, 0);
  if (top && top.requests >= 5 && totalProfReq > 0 && top.requests / totalProfReq >= 0.45 && top.score >= 75) {
    recs.push({
      kind: "ajustar_precio",
      priority: "media",
      nivel: "evaluar",
      title: `${top.name}: demanda muy por encima del equipo`,
      reasoning: `${top.name} recibió ${top.requests} solicitudes que no pudieron concretarse ${period} y su índice de demanda (${top.score}/100) supera ampliamente al del resto del equipo. Clippr recomienda evaluar un aumento gradual del 5% al 10% en el precio de sus servicios, o derivar parte de su demanda hacia otros profesionales.`,
      confidence,
    });
  }

  // 2) Ampliar horarios → cuando los rechazos se concentran tarde / fuera de horario
  if (month >= 5 && lateOrFuera >= 0.5) {
    const dias = a.peakDayLabels.length ? ` los ${a.peakDayLabels.join(", ").toLowerCase()}` : "";
    recs.push({
      kind: "ampliar_horarios",
      priority: month >= 15 ? "alta" : "media",
      nivel: "evaluar",
      title: "Conviene ampliar horarios antes de contratar",
      reasoning: `El ${Math.round(lateOrFuera * 100)}% de los clientes rechazados llegó después de las ${a.lateCutoffLabel}${a.peakDayLabels.length ? `, sobre todo${dias}` : ""}. Antes de contratar un nuevo profesional, podría ser más conveniente extender el horario de atención una hora${dias}.${trendNote}`,
      confidence,
    });
  }

  // 3) Incorporar profesional → demanda alta, AMPLIA (no solo horario) y ocupación alta
  if (occ >= 85 && month >= 25 && broad) {
    recs.push({
      kind: "incorporar",
      priority: "alta",
      nivel: "recomendado",
      title: "Conviene incorporar un profesional",
      reasoning: `Durante ${period} rechazaste ${month} clientes por falta de disponibilidad. La ocupación promedio fue del ${occTxt}${a.peakRangeLabel ? ` y la mayoría de los rechazos ocurrió entre las ${a.peakRangeLabel}` : ""}. Clippr recomienda incorporar un nuevo profesional o sumar un refuerzo en los horarios de mayor demanda.${trendNote}`,
      confidence,
    });
  } else if (occ >= 80 && month >= 12 && broad) {
    recs.push({
      kind: "incorporar",
      priority: "media",
      nivel: "evaluar",
      title: "Evaluá un refuerzo parcial",
      reasoning: `Ocupación del ${occTxt} y ${month} rechazos ${period}${a.peakRangeLabel ? `, concentrados entre las ${a.peakRangeLabel}` : ""}. Hay presión sobre la agenda, pero todavía no es concluyente: evaluá un refuerzo parcial en la franja pico antes de una contratación full-time.${trendNote}`,
      confidence,
    });
  }

  // 4) No contratar todavía → señal baja y sin contratación fuerte recomendada
  const hasStrongHire = recs.some((r) => r.kind === "incorporar" && r.priority === "alta");
  if (!hasStrongHire && (recs.length === 0 || (month < 8 && occ < 80))) {
    recs.push({
      kind: "esperar",
      priority: "baja",
      nivel: "no_recomendado",
      title: "Todavía no conviene incorporar",
      reasoning: `La ocupación promedio es del ${occTxt} y ${month === 0 ? "no se registraron" : `solo se registraron ${month}`} clientes rechazados ${period}. El equipo todavía tiene capacidad para seguir creciendo sin incorporar un nuevo profesional.${trendNote}`,
      confidence,
    });
  }

  const order = { alta: 0, media: 1, baja: 2 };
  return recs.sort((x, y) => order[x.priority] - order[y.priority]);
}
