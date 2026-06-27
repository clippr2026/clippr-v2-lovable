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

  const counts: CountSet = { today: 0, week: 0, month: 0 };
  const lostRevenue: CountSet = { today: 0, week: 0, month: 0 };

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

    // Histogramas (sobre los últimos 30 días para que sean accionables)
    if (d.getTime() >= monthStart.getTime()) {
      const h = hourOf(r.rejected_time);
      hourMap.set(h, (hourMap.get(h) ?? 0) + 1);

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
