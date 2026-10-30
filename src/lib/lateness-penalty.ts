// Penalización por tardanza en PUNTOS PORCENTUALES de la tasa de comisión.
//
// Una regla "percent" con valor N no descuenta el N% de la comisión: resta N
// puntos a la tasa habitual del profesional. Con una comisión del 45%:
//   a tiempo        -> 45%
//   regla de 5 pts  -> 40%   (sobre un corte de $20.000: $9.000 -> $8.000)
//   regla de 10 pts -> 35%   ($9.000 -> $7.000)
// Como la comisión ya se calcula sobre el precio efectivamente cobrado
// (incluye descuentos y promociones, nunca propinas), la diferencia es
// precio × puntos, y por servicio se obtiene como:
//   comisión del servicio × puntos ÷ tasa de ese servicio
// Eso respeta la tasa propia de cada profesional (50% con 10 pts -> 40%).
//
// ESTE ARCHIVO NO ES EL MOTOR. El motor es SQL (borrador probado en
// supabase/migrations/20261030010000_lateness_points_penalty.sql: funciones
// lateness_points_penalty, _lateness_record_penalty y
// _attendance_discount_for_rule), que además lee la tasa de cada servicio de
// la configuración de comisiones. Acá queda la especificación ejecutable de
// las reglas (ver lateness-penalty.test.ts: 11:00, 11:01, 11:14, 11:15,
// 11:30, tasa propia, servicios fijos, tope, catálogo) y el reparto de
// respaldo por servicio que usa Liquidaciones si el servidor todavía no
// ofrece el desglose real. Una regla "fixed" no cambia: es un importe fijo
// por jornada.

export type LatenessRuleLike = {
  id?: string;
  min_minutes: number;
  discount_type: string; // "percent" (puntos) | "fixed"
  discount_value: number;
};

// Un servicio del día: su comisión de servicios (amount_services, o amount en
// filas viejas) y la tasa con la que se calculó. pct null = comisión especial
// o de importe fijo: no se le aplica penalización (su base no se puede
// derivar del precio).
export type PenaltyService = {
  commission: number;
  pct: number | null;
};

// Minutos de tardanza, truncados: 11:00:59 sigue siendo 11:00 (0 min) y
// 11:14:59 sigue en el tramo de 14 min, igual que lee el negocio la regla
// "11:01 a 11:14" / "11:15 en adelante".
export function latenessMinutes(expectedAt: string | Date | null, actualAt: string | Date | null): number {
  if (!expectedAt || !actualAt) return 0;
  const diff = new Date(actualAt).getTime() - new Date(expectedAt).getTime();
  return Math.max(0, Math.floor(diff / 60000));
}

// La regla de mayor min_minutes alcanzado (mismo criterio que el servidor).
export function pickLatenessRule<R extends LatenessRuleLike>(rules: R[], lateMinutes: number): R | null {
  if (lateMinutes <= 0) return null;
  return [...rules].filter((r) => r.min_minutes <= lateMinutes).sort((a, b) => b.min_minutes - a.min_minutes)[0] ?? null;
}

// Penalización de UN servicio, sin redondear y sin pasarse de su propia
// comisión (una regla de más puntos que la tasa no deja comisión negativa).
export function servicePenalty(commission: number, pct: number | null, points: number): number {
  if (!(commission > 0) || !pct || !(pct > 0) || !(points > 0)) return 0;
  return Math.min((commission * points) / pct, commission);
}

// Reparte `total` (pesos enteros) entre filas según `weights`; la última
// absorbe el redondeo, así lo repartido suma exacto el total. Si ninguna fila
// tiene peso, reparte por igual.
export function allocateProportional(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((s, w) => s + w, 0);
  const effective = sum > 0 ? weights : weights.map(() => 1);
  const effectiveSum = sum > 0 ? sum : weights.length;
  let assigned = 0;
  return effective.map((w, i) => {
    const part = i === effective.length - 1 ? total - assigned : Math.round((total * w) / effectiveSum);
    assigned += part;
    return part;
  });
}

export type LatenessPenalty = {
  lateMinutes: number;
  rule: LatenessRuleLike | null;
  // Puntos restados a la tasa (solo reglas "percent"); 0 si es fija o no hay regla.
  points: number;
  // Descuento total de la jornada, en pesos enteros — el ÚNICO ajuste
  // económico de ese día, aunque se muestre desglosado por servicio.
  total: number;
  // Desglose por servicio, mismo orden que `services`; suma exactamente `total`.
  perService: number[];
  // Servicios sin tasa registrada (comisión especial/fija): sin penalización.
  excludedServices: number;
};

export function computeLatenessPenalty(params: {
  lateMinutes: number;
  rules: LatenessRuleLike[];
  services: PenaltyService[];
}): LatenessPenalty {
  const { lateMinutes, rules, services } = params;
  const rule = pickLatenessRule(rules, lateMinutes);
  const servicesCommission = services.reduce((s, x) => s + Math.max(0, x.commission), 0);
  const excludedServices = services.filter((s) => !s.pct || s.pct <= 0).length;
  const none = (): LatenessPenalty => ({
    lateMinutes,
    rule,
    points: 0,
    total: 0,
    perService: services.map(() => 0),
    excludedServices,
  });
  if (!rule) return none();

  if (rule.discount_type === "fixed") {
    // Importe fijo por jornada: se mantiene tal cual (tope: la comisión de
    // servicios del día), repartido por comisión solo para mostrarlo.
    const total = Math.max(0, Math.min(Math.round(Number(rule.discount_value)), servicesCommission));
    return {
      lateMinutes,
      rule,
      points: 0,
      total,
      perService: allocateProportional(total, services.map((s) => Math.max(0, s.commission))),
      excludedServices,
    };
  }

  const points = Number(rule.discount_value);
  const raw = services.map((s) => servicePenalty(s.commission, s.pct, points));
  const total = Math.max(0, Math.min(Math.round(raw.reduce((s, x) => s + x, 0)), servicesCommission));
  return { lateMinutes, rule, points, total, perService: allocateProportional(total, raw), excludedServices };
}

// ── Solo servicios: el catálogo (productos) nunca lleva descuento por puntualidad ──
export type CommissionRecordLike = {
  amount?: number | string | null;
  amount_services?: number | string | null;
  // La venta tiene algún ítem de catálogo (producto).
  hasCatalogItems?: boolean;
};

// ¿La venta incluye algún producto del catálogo? (payments.items[].is_catalog)
export function hasCatalogItems(items: unknown): boolean {
  return Array.isArray(items) && items.some((i) => Boolean((i as { is_catalog?: unknown } | null)?.is_catalog));
}

// Comisión de SERVICIOS de un registro: la única base de la penalización.
//  - amount_services informado: ya viene sin la parte de productos (0 en una
//    venta solo de catálogo).
//  - amount_services vacío (registro anterior al desglose): si la venta tiene
//    productos no se puede separar qué parte es de cada cosa, así que se
//    excluye (0); si es solo de servicios, la comisión completa.
export function serviceCommissionOf(r: CommissionRecordLike): number {
  if (r.amount_services !== null && r.amount_services !== undefined) {
    return Math.max(0, Number(r.amount_services));
  }
  if (r.hasCatalogItems) return 0;
  return Math.max(0, Number(r.amount ?? 0));
}
