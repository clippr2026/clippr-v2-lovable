// ════════════════════════════════════════════════════════════════════════════
//  MOTOR DE RECOMENDACIONES DEL GERENTE IA
//  ----------------------------------------------------------------------------
//  Toda la inteligencia del Gerente IA vive acá. Es código PURO: no usa React,
//  no toca Supabase, no renderiza nada. Recibe datos crudos del negocio y
//  devuelve recomendaciones priorizadas con un score multifactor, además de un
//  snapshot de métricas período-contra-período para detectar y explicar mejoras.
//
//  El componente React sólo consume el resultado. La capa de datos + ciclo de
//  vida (active / resolved / archived) vive en el hook use-ai-recommendations.
// ════════════════════════════════════════════════════════════════════════════

// ── Formato de moneda (local, para no acoplar el motor a la UI) ──────────────
function fmtARS(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-AR");
}

function pct(now: number, prev: number): number {
  if (prev <= 0) return now > 0 ? 100 : 0;
  return Math.round(((now - prev) / prev) * 100);
}

// ─────────────────────────── Tipos de entrada ───────────────────────────────
// Definidos de forma estructural y mínima para que el motor no dependa de los
// tipos concretos de los hooks. Cualquier objeto compatible sirve.

export type EngineClientPayment = { service: string; date?: string; amount?: number };

export type EngineClient = {
  id: string;
  name: string;
  phone?: string | null;
  visits: number;
  spent: number;
  lastVisit?: string | null;
  lastVisitDays?: number | null;
  history: EngineClientPayment[];
};

export type EngineAppt = {
  id: string;
  client_id?: string | null;
  client_name?: string | null;
  service_name?: string | null;
  service_price?: number | null;
  starts_at: string;
  status: string;
  employee_id?: string | null;
};

export type EngineService = { id: string; name: string; price: number | null };
export type EngineEmployee = { id: string; full_name: string };

/** Contexto del ciclo de vida que aporta el hook (viene de la base de datos). */
export type LifecycleContext = Record<string, { firstSeenAt?: string | null }>;

export type EngineInput = {
  clients: EngineClient[];
  appts: EngineAppt[];
  services: EngineService[];
  employees: EngineEmployee[];
  /** Persistencia: hace cuánto se ve cada recomendación. Opcional. */
  lifecycle?: LifecycleContext;
  /** Fecha de referencia (inyectable para tests). Default: ahora. */
  now?: Date;
};

// ─────────────────────────── Tipos de salida ────────────────────────────────

export type RecommendationStatus = "active" | "working" | "resolved" | "archived";
export type RecommendationCategory =
  | "recuperacion"
  | "agenda"
  | "equipo"
  | "ticket"
  | "rentabilidad";
export type RecommendationTone = "money" | "warning" | "growth" | "client";
export type RecommendationPriority = "alta" | "media" | "baja";

export type RecommendationContact = {
  name: string;
  phone?: string | null;
  detail?: string;
};

/** Todo lo accionable de una recomendación: el "qué hacer". */
export type RecommendationStrategy = {
  icon: string;
  tone: RecommendationTone;
  category: RecommendationCategory;
  problem: string;
  moneyLost: number;
  moneyRecoverable: number;
  action: string;
  steps: string[];
  who: string;
  contacts: RecommendationContact[];
  message: string;
  measure: string;
  basis: string;
};

/** Desglose transparente del score (sumando da el total 0–100). */
export type ScoreBreakdown = {
  economicImpact: number; // 0–40
  urgency: number; // 0–30
  persistence: number; // 0–15
  ease: number; // 0–15
};

export type Recommendation = {
  key: string;
  title: string;
  description: string;
  priority: RecommendationPriority;
  score: number; // 0–100, calculado automáticamente
  scoreBreakdown: ScoreBreakdown;
  shouldShow: boolean;
  status: RecommendationStatus;
  strategy: RecommendationStrategy;
};

/** Métricas período-contra-período para detectar y explicar mejoras. */
export type EngineMetrics = {
  avgTicket: number;
  ticketCurrent: number;
  ticketPrev: number;
  cancellationsCurrent: number;
  cancellationsPrev: number;
  doneCurrent: number;
  donePrev: number;
  inactiveCount: number;
  vipRiskCount: number;
};

export type EngineResult = {
  recommendations: Recommendation[]; // sólo shouldShow, ordenadas por score desc
  metrics: EngineMetrics;
  avgTicket: number;
  totalOpportunity: number;
};

// ─────────────────────────── Constantes ─────────────────────────────────────
const DONE_STATUSES = ["completed", "charged"];
const DOW_LABELS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DAY = 86_400_000;

// ─────────────────────────── Scoring multifactor ────────────────────────────
// El score NO está hardcodeado: cada recomendación lo calcula a partir de los
// datos. Suma cuatro componentes y luego se ordena de mayor a menor.
//
//   score = impacto económico (40) + urgencia (30) + persistencia (15) + facilidad (15)

type ScoreSignals = {
  /** Plata en juego (perdida + recuperable). */
  money: number;
  /** 0–1: qué tan apremiante es según los datos (tendencia, antigüedad de la fuga). */
  urgencySignal: number;
  /** Hace cuántos días se detecta la recomendación (persistencia). */
  persistenceDays: number;
  /** 0–1: qué tan fácil es ejecutarla (contactos listos, mensaje listo, pocos pasos). */
  easeSignal: number;
};

function saturate(value: number, half: number): number {
  // Curva con retornos decrecientes acotada en [0,1): value/(value+half).
  if (value <= 0) return 0;
  return value / (value + half);
}

function computeScore(signals: ScoreSignals, avgTicket: number): ScoreBreakdown {
  const ref = Math.max(avgTicket * 6, 30_000);
  const economicImpact = Math.round(40 * saturate(signals.money, ref));
  const urgency = Math.round(30 * clamp01(signals.urgencySignal));
  const persistence = Math.round(15 * clamp01(signals.persistenceDays / 21));
  const ease = Math.round(15 * clamp01(signals.easeSignal));
  return { economicImpact, urgency, persistence, ease };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function totalScore(b: ScoreBreakdown): number {
  return Math.max(0, Math.min(100, b.economicImpact + b.urgency + b.persistence + b.ease));
}

function priorityFromScore(score: number): RecommendationPriority {
  if (score >= 66) return "alta";
  if (score >= 40) return "media";
  return "baja";
}

function easeFromStrategy(s: {
  contacts: RecommendationContact[];
  message: string;
  steps: string[];
}): number {
  const hasContacts = s.contacts.length > 0 ? 0.4 : 0;
  const hasMessage = s.message.trim().length > 0 ? 0.3 : 0;
  const stepFactor = clamp01((5 - s.steps.length) / 4) * 0.3;
  return clamp01(hasContacts + hasMessage + stepFactor);
}

// Borrador interno antes de calcular el score: la "estrategia" + señales.
type RecDraft = {
  key: string;
  title: string;
  description: string;
  urgencySignal: number;
  strategy: RecommendationStrategy;
};

function finalizeRecommendation(
  draft: RecDraft,
  avgTicket: number,
  lifecycle: LifecycleContext,
  now: Date,
): Recommendation {
  const firstSeen = lifecycle[draft.key]?.firstSeenAt ?? null;
  const persistenceDays = firstSeen
    ? Math.max(0, Math.floor((now.getTime() - new Date(firstSeen).getTime()) / DAY))
    : 0;

  const breakdown = computeScore(
    {
      money: draft.strategy.moneyLost * 0.6 + draft.strategy.moneyRecoverable,
      urgencySignal: draft.urgencySignal,
      persistenceDays,
      easeSignal: easeFromStrategy(draft.strategy),
    },
    avgTicket,
  );
  const score = totalScore(breakdown);

  return {
    key: draft.key,
    title: draft.title,
    description: draft.description,
    priority: priorityFromScore(score),
    score,
    scoreBreakdown: breakdown,
    shouldShow: true,
    status: "active",
    strategy: draft.strategy,
  };
}

// ─────────────────────────── Métricas de período ────────────────────────────
function computeMetrics(
  clients: EngineClient[],
  appts: EngineAppt[],
  avgTicket: number,
  now: Date,
): EngineMetrics {
  const cutCurrent = now.getTime() - 30 * DAY;
  const cutPrev = now.getTime() - 60 * DAY;

  let cancellationsCurrent = 0;
  let cancellationsPrev = 0;
  let ticketSumCurrent = 0;
  let ticketCountCurrent = 0;
  let ticketSumPrev = 0;
  let ticketCountPrev = 0;
  let doneCurrent = 0;
  let donePrev = 0;

  for (const a of appts) {
    const t = new Date(a.starts_at).getTime();
    const inCurrent = t >= cutCurrent;
    const inPrev = t >= cutPrev && t < cutCurrent;
    if (!inCurrent && !inPrev) continue;

    if (a.status === "cancelled") {
      if (inCurrent) cancellationsCurrent += 1;
      else cancellationsPrev += 1;
    }
    if (DONE_STATUSES.includes(a.status)) {
      const price = Number(a.service_price ?? 0);
      if (inCurrent) {
        doneCurrent += 1;
        if (price > 0) {
          ticketSumCurrent += price;
          ticketCountCurrent += 1;
        }
      } else {
        donePrev += 1;
        if (price > 0) {
          ticketSumPrev += price;
          ticketCountPrev += 1;
        }
      }
    }
  }

  const inactiveCount = clients.filter(
    (c) => c.visits >= 1 && (c.lastVisitDays ?? 0) >= 45 && (c.lastVisitDays ?? 0) < 180,
  ).length;
  const vipRiskCount = clients.filter(
    (c) => (c.visits >= 8 || c.spent >= 100_000) && (c.lastVisitDays ?? 0) >= 30,
  ).length;

  return {
    avgTicket,
    ticketCurrent: ticketCountCurrent > 0 ? Math.round(ticketSumCurrent / ticketCountCurrent) : avgTicket,
    ticketPrev: ticketCountPrev > 0 ? Math.round(ticketSumPrev / ticketCountPrev) : avgTicket,
    cancellationsCurrent,
    cancellationsPrev,
    doneCurrent,
    donePrev,
    inactiveCount,
    vipRiskCount,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  GENERADORES DE RECOMENDACIONES
//  Cada bloque sólo emite una recomendación cuando hay evidencia suficiente
//  (req. 6: tarjetas dinámicas). Los títulos y descripciones se construyen con
//  los datos reales (req. 11: textos dinámicos).
// ════════════════════════════════════════════════════════════════════════════

export function runRecommendationEngine(input: EngineInput): EngineResult {
  const now = input.now ?? new Date();
  const lifecycle = input.lifecycle ?? {};
  const { clients, appts, services, employees } = input;

  const drafts: RecDraft[] = [];

  // Ticket promedio real (gasto total / visitas reales).
  const totalVisits = clients.reduce((s, c) => s + c.visits, 0);
  const totalSpent = clients.reduce((s, c) => s + c.spent, 0);
  const svcPrices = services.map((s) => Number(s.price ?? 0)).filter((p) => p > 0);
  const apptPrices = appts.map((a) => Number(a.service_price ?? 0)).filter((p) => p > 0);
  const avgSvcPrice =
    svcPrices.length > 0
      ? Math.round(svcPrices.reduce((a, b) => a + b, 0) / svcPrices.length)
      : apptPrices.length > 0
        ? Math.round(apptPrices.reduce((a, b) => a + b, 0) / apptPrices.length)
        : 0;
  const avgTicket = totalVisits > 0 ? Math.round(totalSpent / totalVisits) : avgSvcPrice;

  const done = appts.filter((a) => DONE_STATUSES.includes(a.status));
  const empName = (id: string | null | undefined) =>
    employees.find((e) => e.id === id)?.full_name ?? "Sin asignar";

  const metrics = computeMetrics(clients, appts, avgTicket, now);

  // ── 1. VIP en riesgo (alto valor que se está enfriando) ────────────────────
  const vipRisk = clients
    .filter((c) => (c.visits >= 8 || c.spent >= 100_000) && (c.lastVisitDays ?? 0) >= 30)
    .sort((a, b) => b.spent - a.spent);
  if (vipRisk.length > 0) {
    const perClient = vipRisk.map((c) => (c.visits > 0 ? Math.round(c.spent / c.visits) : avgTicket));
    const lost = perClient.reduce((a, b) => a + b, 0);
    const recoverable = Math.round(lost * 0.6);
    const maxDays = Math.max(...vipRisk.map((c) => c.lastVisitDays ?? 30));
    drafts.push({
      key: "vip-riesgo",
      title:
        vipRisk.length === 1
          ? `Tu mejor cliente no vuelve hace ${maxDays} días`
          : `${vipRisk.length} clientes VIP se están enfriando`,
      description: `${vipRisk.length} de tus mejores clientes (los que más gastan y más vienen) no pasan hace más de 30 días. Representan ${fmtARS(lost)} de facturación en riesgo.`,
      // Cuanto más tiempo lleven enfriándose, más urgente.
      urgencySignal: clamp01(0.5 + (maxDays - 30) / 120),
      strategy: {
        icon: "👑",
        tone: "money",
        category: "recuperacion",
        problem: `${vipRisk.length} de tus mejores clientes (los que más gastan y más vienen) no pasan hace más de 30 días.`,
        moneyLost: lost,
        moneyRecoverable: recoverable,
        action:
          "Contactá uno por uno a tus VIP con un mensaje personal (no masivo) y ofrecéles prioridad de turno esta semana.",
        steps: [
          "Abrí la lista de VIP de abajo y mandales un WhatsApp personalizado con su nombre.",
          "Ofrecé un turno reservado a su horario habitual sin que tengan que pedirlo.",
          "Sumá un detalle premium gratis (lavado, perfilado de barba o asesoramiento) para que sientan el trato VIP.",
        ],
        who: `${vipRisk.length} clientes VIP sin visita reciente`,
        contacts: vipRisk.slice(0, 8).map((c) => ({
          name: c.name,
          phone: c.phone,
          detail: `${c.visits} visitas · ${fmtARS(c.spent)} · ${c.lastVisit ?? "hace tiempo"}`,
        })),
        message:
          "Hola {nombre} 👋 Soy de la barbería. Te tengo reservado tu horario de siempre para esta semana así no te quedás sin lugar. ¿Te viene bien el {día}? Cualquier cosa lo movemos. ✂️",
        measure: "Cuántos de estos VIP reservaron en los próximos 7 días. Meta: recuperar al menos la mitad.",
        basis: `Ticket real por VIP: ${fmtARS(Math.round(lost / vipRisk.length))}. Recuperable estimado con un retorno del 60%.`,
      },
    });
  }

  // ── 2. Clientes inactivos (+45 días) ───────────────────────────────────────
  const inactivos = clients
    .filter((c) => c.visits >= 1 && (c.lastVisitDays ?? 0) >= 45 && (c.lastVisitDays ?? 0) < 180)
    .filter((c) => !vipRisk.some((v) => v.id === c.id))
    .sort((a, b) => b.spent - a.spent);
  if (inactivos.length > 0) {
    const lost = inactivos.length * avgTicket;
    const recoverable = Math.round(lost * 0.35);
    drafts.push({
      key: "inactivos-45",
      title: `${inactivos.length} clientes dejaron de venir`,
      description: `${inactivos.length} clientes que ya te conocían no vuelven hace más de 45 días. Cada semana que pasa es más difícil recuperarlos.`,
      urgencySignal: clamp01(0.35 + inactivos.length / 40),
      strategy: {
        icon: "🔁",
        tone: "client",
        category: "recuperacion",
        problem: `${inactivos.length} clientes que ya te conocían no vuelven hace más de 45 días. Cada semana que pasa es más difícil recuperarlos.`,
        moneyLost: lost,
        moneyRecoverable: recoverable,
        action: `Lanzá una campaña de reactivación a estos ${inactivos.length} clientes con un motivo concreto para volver esta semana.`,
        steps: [
          "Mandá el mensaje de abajo por WhatsApp a la lista de clientes inactivos.",
          "Dales un motivo con fecha límite: un beneficio que vence el domingo.",
          "Si en 3 días no responden, mandá un segundo mensaje corto recordando el beneficio.",
        ],
        who: `${inactivos.length} clientes inactivos (45+ días)`,
        contacts: inactivos.slice(0, 8).map((c) => ({
          name: c.name,
          phone: c.phone,
          detail: `${c.visits} visitas · última ${c.lastVisit ?? "hace tiempo"}`,
        })),
        message:
          "Hola {nombre} 👋 ¡Hace rato que no te vemos! Esta semana te guardamos un lugar y un 15% off en tu próximo corte. Válido hasta el domingo. ¿Te reservo? ✂️",
        measure: "Cuántos volvieron en 14 días. Si vuelve 1 de cada 3, la campaña ya es rentable.",
        basis: `Ticket promedio real: ${fmtARS(avgTicket)}. Recuperable estimado con retorno conservador del 35%.`,
      },
    });
  }

  // ── 3. Día muerto (el día que menos factura) ───────────────────────────────
  if (done.length >= 10) {
    const weeks = 90 / 7;
    const byDow = Array.from({ length: 7 }, () => ({ revenue: 0, count: 0 }));
    done.forEach((a) => {
      const d = new Date(a.starts_at).getDay();
      byDow[d].revenue += Number(a.service_price ?? avgTicket);
      byDow[d].count += 1;
    });
    const active = byDow
      .map((v, dow) => ({ dow, perWeek: v.revenue / weeks, count: v.count }))
      .filter((v) => v.count > 0);
    if (active.length >= 2) {
      const best = active.reduce((m, v) => (v.perWeek > m.perWeek ? v : m));
      const worst = active.reduce((m, v) => (v.perWeek < m.perWeek ? v : m));
      const gapMonthly = Math.round((best.perWeek - worst.perWeek) * 4);
      if (gapMonthly > avgTicket) {
        drafts.push({
          key: "dia-muerto",
          title: `El ${DOW_LABELS[worst.dow]} factura ${fmtARS(gapMonthly)} menos que tu mejor día`,
          description: `Los ${DOW_LABELS[worst.dow]} facturás muy por debajo del ${DOW_LABELS[best.dow]}. Es agenda vacía que ya estás pagando igual (alquiler, sillón, tu tiempo).`,
          urgencySignal: 0.45,
          strategy: {
            icon: "📉",
            tone: "warning",
            category: "agenda",
            problem: `Los ${DOW_LABELS[worst.dow]} facturás muy por debajo de tu mejor día (${DOW_LABELS[best.dow]}). Es agenda vacía que ya estás pagando igual (alquiler, sillón, tu tiempo).`,
            moneyLost: gapMonthly,
            moneyRecoverable: Math.round(gapMonthly * 0.5),
            action: `Convertí el ${DOW_LABELS[worst.dow]} en tu día de ofertas: promo fija + difusión el día anterior.`,
            steps: [
              `Creá una promo exclusiva del ${DOW_LABELS[worst.dow]} (ej: corte + barba a precio especial, o 2x1 con un amigo).`,
              `Publicá los turnos libres del ${DOW_LABELS[worst.dow]} en Instagram y estados de WhatsApp el ${DOW_LABELS[(worst.dow + 6) % 7]}.`,
              "Ofrecé ese día a clientes que siempre piden horarios saturados como alternativa cómoda.",
            ],
            who: "Clientes activos + seguidores de Instagram/WhatsApp",
            contacts: [],
            message: `🔥 Promo de los ${DOW_LABELS[worst.dow]}: corte + barba a precio especial, solo con turno previo. Quedan pocos lugares, escribime y te reservo. ✂️`,
            measure: `Facturación del ${DOW_LABELS[worst.dow]} en las próximas 3 semanas vs hoy.`,
            basis: `Diferencia real ${DOW_LABELS[best.dow]} vs ${DOW_LABELS[worst.dow]}, proyectada a un mes.`,
          },
        });
      }
    }
  }

  // ── 4. Profesional con baja ocupación ──────────────────────────────────────
  if (employees.length >= 2 && done.length >= 12) {
    const byEmp = new Map<string, number>();
    done.forEach((a) => {
      if (!a.employee_id) return;
      byEmp.set(a.employee_id, (byEmp.get(a.employee_id) ?? 0) + 1);
    });
    if (byEmp.size >= 2) {
      const counts = [...byEmp.entries()].map(([id, count]) => ({ id, count }));
      const avg = counts.reduce((s, c) => s + c.count, 0) / counts.length;
      const low = counts.reduce((m, c) => (c.count < m.count ? c : m));
      if (low.count < avg * 0.6) {
        const gap = Math.round((avg - low.count) * avgSvcPrice);
        const occPct = Math.round((low.count / avg) * 100);
        drafts.push({
          key: "prof-baja-ocupacion",
          title: `${empName(low.id)} está al ${occPct}% de la ocupación del equipo`,
          description: `${empName(low.id)} atendió bastante menos que el promedio en los últimos 90 días. Sillón parado = plata parada.`,
          urgencySignal: 0.4,
          strategy: {
            icon: "🪑",
            tone: "warning",
            category: "equipo",
            problem: `${empName(low.id)} atendió bastante menos que el promedio del equipo en los últimos 90 días. Sillón parado = plata parada.`,
            moneyLost: gap,
            moneyRecoverable: Math.round(gap * 0.7),
            action: `Dirigí demanda hacia ${empName(low.id)}: asignale los nuevos turnos y mostralo en tu perfil público.`,
            steps: [
              `Cuando entren reservas sin profesional elegido, asignáselas a ${empName(low.id)}.`,
              `Pediles a tus clientes nuevos que prueben con ${empName(low.id)} destacando su especialidad.`,
              `Dale a ${empName(low.id)} un horario propio en la promo del día flojo para que arranque su agenda.`,
            ],
            who: `${empName(low.id)} (profesional con menor ocupación)`,
            contacts: [],
            message: `¿Probaste cortarte con ${empName(low.id)}? Esta semana tiene los mejores horarios disponibles. Escribime y te reservo. ✂️`,
            measure: `Turnos completados por ${empName(low.id)} el próximo mes vs los últimos 30 días.`,
            basis: `Promedio del equipo: ${Math.round(avg)} turnos. ${empName(low.id)}: ${low.count}. Valorizado al precio medio de servicio.`,
          },
        });
      }
    }
  }

  // ── 5. Oportunidad corte + barba (combo clásico de barbería) ───────────────
  const corteSinBarba = clients.filter(
    (c) =>
      c.history.some((h) => /corte|pelo|cabello/i.test(h.service)) &&
      !c.history.some((h) => /barba/i.test(h.service)) &&
      (c.lastVisitDays ?? 999) <= 90,
  );
  if (corteSinBarba.length >= 3) {
    const barbaSvc = services.find((s) => /barba/i.test(s.name));
    const barbaPrice = Number(barbaSvc?.price ?? 0) || Math.round(avgTicket * 0.5);
    const recoverable = Math.round(corteSinBarba.length * barbaPrice * 0.3);
    drafts.push({
      key: "corte-mas-barba",
      title: `${corteSinBarba.length} clientes se cortan pero nunca suman barba`,
      description: `${corteSinBarba.length} clientes activos se cortan con vos pero nunca sumaron la barba. Es la venta más fácil que estás dejando pasar.`,
      urgencySignal: 0.25,
      strategy: {
        icon: "🧔",
        tone: "growth",
        category: "ticket",
        problem: `${corteSinBarba.length} clientes activos se cortan con vos pero nunca sumaron la barba. Es la venta más fácil que estás dejando pasar.`,
        moneyLost: 0,
        moneyRecoverable: recoverable,
        action: "Convertí el corte+barba en oferta por defecto: ofrecelo en el sillón, no esperes que lo pidan.",
        steps: [
          `Entrená al equipo para ofrecer la barba a todo cliente de corte: "¿Te emprolijo la barba también?".`,
          `Mostrá un precio combo atractivo (corte + barba) más barato que comprarlos por separado.`,
          "Mandá el mensaje de abajo a los clientes que nunca probaron el servicio de barba.",
        ],
        who: `${corteSinBarba.length} clientes de corte que nunca hicieron barba`,
        contacts: corteSinBarba.slice(0, 8).map((c) => ({
          name: c.name,
          phone: c.phone,
          detail: `${c.visits} cortes · ${c.lastVisit ?? ""}`,
        })),
        message: `Hola {nombre} 👋 Esta semana estamos con combo corte + barba a precio especial. Te queda 🔥. ¿Lo sumamos a tu próximo turno? ✂️`,
        measure: "Cuántos de estos clientes sumaron barba en su próxima visita.",
        basis: `Precio de barba usado: ${fmtARS(barbaPrice)}. Recuperable con adopción del 30%.`,
      },
    });
  }

  // ── 6. Cancelaciones recurrentes ───────────────────────────────────────────
  const cancels = appts.filter((a) => a.status === "cancelled" && a.client_name);
  if (cancels.length >= 3) {
    const byClient = new Map<string, number>();
    cancels.forEach((a) => {
      const k = (a.client_name ?? "").trim();
      if (k) byClient.set(k, (byClient.get(k) ?? 0) + 1);
    });
    const repeat = [...byClient.entries()].filter(([, n]) => n >= 2);
    const lost = cancels.length * avgTicket;
    if (lost > avgTicket) {
      // Título dinámico según tendencia y concentración (req. 11).
      const trendPct = pct(metrics.cancellationsCurrent, metrics.cancellationsPrev);
      const repeatShare =
        cancels.length > 0
          ? Math.round((repeat.reduce((s, [, n]) => s + n, 0) / cancels.length) * 100)
          : 0;
      let title: string;
      if (trendPct > 10 && metrics.cancellationsPrev > 0) {
        title = `Las cancelaciones aumentaron un ${trendPct}% este mes`;
      } else if (repeat.length >= 2 && repeatShare >= 25) {
        title = `${repeat.length} clientes concentran el ${repeatShare}% de tus cancelaciones`;
      } else {
        title = `${cancels.length} cancelaciones te vaciaron turnos`;
      }
      drafts.push({
        key: "cancelaciones",
        title,
        description: `Reduciendo las cancelaciones podrías recuperar ${fmtARS(Math.round(lost * 0.5))} por mes. Cada hueco que no se rellena es plata perdida.`,
        urgencySignal: clamp01(0.5 + (trendPct > 0 ? trendPct / 100 : 0)),
        strategy: {
          icon: "🚫",
          tone: "warning",
          category: "agenda",
          problem: `Tuviste ${cancels.length} cancelaciones en los últimos 90 días${repeat.length > 0 ? ` y ${repeat.length} clientes cancelan de forma repetida` : ""}. Cada hueco que no se rellena es plata perdida.`,
          moneyLost: lost,
          moneyRecoverable: Math.round(lost * 0.5),
          action: "Implementá recordatorio + lista de espera para tapar los huecos al instante.",
          steps: [
            "Mandá un recordatorio por WhatsApp 24 hs antes de cada turno para bajar el ausentismo.",
            "Armá una lista de espera de clientes que quieren entrar antes; ofrecéles el hueco apenas alguien cancela.",
            repeat.length > 0
              ? "A los que cancelan repetido, pedí una seña simbólica para reservar."
              : "Pedí confirmación el día anterior para liberar el lugar a tiempo.",
          ],
          who: repeat.length > 0 ? `${repeat.length} clientes con cancelaciones repetidas` : "Clientes con turno próximo",
          contacts: repeat.slice(0, 8).map(([name, n]) => ({ name, detail: `${n} cancelaciones` })),
          message:
            "Hola {nombre} 👋 Te recuerdo tu turno de mañana ✂️ Si no podés venir, avisame así libero el lugar para otra persona. ¡Gracias!",
          measure: "Cantidad de cancelaciones y ausencias el próximo mes vs hoy.",
          basis: `Cada turno perdido vale ${fmtARS(avgTicket)}. Recuperable estimado tapando la mitad de los huecos.`,
        },
      });
    }
  }

  // ── 7. Servicio premium poco vendido ───────────────────────────────────────
  if (services.length >= 3 && done.length >= 10) {
    const usage = new Map<string, number>();
    done.forEach((a) => {
      const n = (a.service_name ?? "").toLowerCase();
      usage.set(n, (usage.get(n) ?? 0) + 1);
    });
    const pricedSorted = [...services]
      .filter((s) => Number(s.price ?? 0) > avgSvcPrice * 1.2)
      .sort((a, b) => Number(b.price ?? 0) - Number(a.price ?? 0));
    const premium = pricedSorted.find(
      (s) => (usage.get(s.name.toLowerCase()) ?? 0) <= Math.max(1, done.length * 0.05),
    );
    if (premium) {
      const target = Math.max(4, Math.round(done.length * 0.08));
      const recoverable = Math.round(target * Number(premium.price ?? 0));
      drafts.push({
        key: "premium-poco-vendido",
        title: `"${premium.name}" casi no se vende`,
        description: `${premium.name} es uno de tus servicios más caros (${fmtARS(Number(premium.price ?? 0))}) pero casi nadie lo pide. Tenés margen alto sin aprovechar.`,
        urgencySignal: 0.2,
        strategy: {
          icon: "💎",
          tone: "growth",
          category: "rentabilidad",
          problem: `${premium.name} es uno de tus servicios más caros (${fmtARS(Number(premium.price ?? 0))}) pero casi nadie lo pide. Tenés margen alto sin aprovechar.`,
          moneyLost: 0,
          moneyRecoverable: recoverable,
          action: `Hacé visible y deseable el ${premium.name}: mostralo, explicá el beneficio y ofrecelo activamente.`,
          steps: [
            `Mostrá el ${premium.name} en tu perfil público y en el local con una foto de antes/después.`,
            `Entrená al equipo para recomendarlo al cliente indicado en el momento justo.`,
            `Probá una promo de lanzamiento por tiempo limitado para que lo prueben.`,
          ],
          who: "Clientes que buscan calidad / experiencia premium",
          contacts: [],
          message: `Sumamos ${premium.name} ✨ Ideal si querés un resultado de otro nivel. Esta semana con cupo limitado. ¿Te lo reservo? ✂️`,
          measure: `Cuántos ${premium.name} vendiste el próximo mes (hoy: casi cero).`,
          basis: `Precio del servicio: ${fmtARS(Number(premium.price ?? 0))}. Meta conservadora: ${target} ventas/mes.`,
        },
      });
    }
  }

  // Calcular score de cada draft y ordenar de mayor a menor (req. 4).
  const recommendations = drafts
    .map((d) => finalizeRecommendation(d, avgTicket, lifecycle, now))
    .sort((a, b) => b.score - a.score);

  const totalOpportunity = recommendations.reduce((s, r) => s + r.strategy.moneyRecoverable, 0);

  return { recommendations, metrics, avgTicket, totalOpportunity };
}

// ════════════════════════════════════════════════════════════════════════════
//  DETECCIÓN Y EXPLICACIÓN DE MEJORAS (req. 8 + 11)
//  Cuando una recomendación deja de estar activa, generamos un mensaje dinámico
//  que explica QUÉ mejoró usando las métricas período-contra-período.
// ════════════════════════════════════════════════════════════════════════════

export function describeResolution(key: string, metrics: EngineMetrics): string {
  switch (key) {
    case "cancelaciones": {
      const change = pct(metrics.cancellationsCurrent, metrics.cancellationsPrev);
      if (metrics.cancellationsPrev > 0 && change < 0) {
        return `Excelente. Reduciste las cancelaciones un ${Math.abs(change)}% respecto al período anterior.`;
      }
      return "Las cancelaciones dejaron de ser un problema. Tu agenda está más firme.";
    }
    case "corte-mas-barba":
    case "premium-poco-vendido": {
      const change = pct(metrics.ticketCurrent, metrics.ticketPrev);
      if (change > 0) {
        return `Subiste el ticket promedio un ${change}% respecto al período anterior. La estrategia de venta está funcionando.`;
      }
      return "Estás aprovechando mejor cada visita. El ticket dejó de ser una oportunidad perdida.";
    }
    case "vip-riesgo":
      return "Recuperaste a tus clientes VIP. Volvieron a pasar y el riesgo de fuga se disipó.";
    case "inactivos-45":
      return "Reactivaste clientes que se habían enfriado. Buen trabajo recuperándolos.";
    case "dia-muerto":
      return "Mejoró la facturación de tu día más flojo. La agenda quedó más pareja.";
    case "prof-baja-ocupacion":
      return "Mejoró la ocupación del equipo. El sillón frío se está llenando.";
    default:
      return "Los datos muestran que esta oportunidad ya mejoró. Objetivo logrado.";
  }
}
