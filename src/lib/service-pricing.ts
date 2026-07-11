// Única fuente de verdad para resolver el precio y la duración efectivos de
// un servicio para un profesional determinado. Todo módulo que necesite
// saber "cuánto cuesta / cuánto dura este servicio con este profesional"
// (Agenda, Mi Agenda, Caja, Página Pública) debe pasar por acá — nada de
// recalcular a mano leyendo `price_catalog.price`/`duration_min` directo,
// para que Liquidaciones y Reportes (que solo leen el valor ya congelado en
// `appointments.service_price`/`duration_min` al momento de la reserva)
// queden automáticamente consistentes con lo que se muestra en el resto de
// la app, y para que una futura promoción/convenio se pueda enchufar acá una
// sola vez en lugar de en cada punto de consumo.
//
// Arquitectura desacoplada entre los 3 módulos que tocan precio:
//   - Servicios (price_catalog): nombre, precio estándar, duración estándar.
//   - Equipo (_employeeServiceOverrides): precio/duración por profesional.
//   - Promociones (_promotions, más abajo): descuentos, códigos, vigencias
//     y restricciones — nunca toca price_catalog ni los overrides, solo los
//     referencia por id. El precio final siempre se compone en ese orden:
//     resolveServicePricing() (Servicios + Equipo) → applyPromotionDiscount()
//     (Promociones).

import type { DayKey } from "@/lib/availability";

export type ServiceOverrideConfig = {
  useStandardDuration: boolean;
  duration_min: string;
  useStandardPrice: boolean;
  price: string;
};

export type EmployeeServiceOverrideMap = Record<
  string,
  Record<string, ServiceOverrideConfig>
>;

export type ResolvableService = {
  id: string;
  price: number | string | null | undefined;
  duration_min?: number | string | null;
};

export type ResolvedServicePricing = {
  price: number;
  duration_min: number;
  priceOverridden: boolean;
  durationOverridden: boolean;
};

export function resolveServicePricing(
  service: ResolvableService,
  employeeId: string | null | undefined,
  overridesMap: EmployeeServiceOverrideMap | null | undefined,
): ResolvedServicePricing {
  const standardPrice = Number(service.price ?? 0) || 0;
  const standardDuration = Number(service.duration_min ?? 30) || 30;

  const cfg = employeeId ? overridesMap?.[employeeId]?.[service.id] : undefined;

  const priceOverridden =
    !!cfg && cfg.useStandardPrice === false && cfg.price.trim() !== "";
  const durationOverridden =
    !!cfg &&
    cfg.useStandardDuration === false &&
    cfg.duration_min.trim() !== "";

  return {
    price: priceOverridden ? Number(cfg!.price) || standardPrice : standardPrice,
    duration_min: durationOverridden
      ? Number(cfg!.duration_min) || standardDuration
      : standardDuration,
    priceOverridden,
    durationOverridden,
  };
}

export type ServiceRange = {
  price: { min: number; max: number; hasVariation: boolean };
  duration: { min: number; max: number; hasVariation: boolean };
};

// Para la Página Pública: antes de elegir profesional solo se puede mostrar
// un rango de precio y de duración entre los profesionales visibles para
// ese servicio. Si todos coinciden, no hay rango — se muestra el valor
// único como si fuera un solo profesional.
export function getServiceRange(
  service: ResolvableService,
  employeeIds: string[],
  overridesMap: EmployeeServiceOverrideMap | null | undefined,
): ServiceRange {
  const standardPrice = Number(service.price ?? 0) || 0;
  const standardDuration = Number(service.duration_min ?? 30) || 30;
  if (employeeIds.length === 0) {
    return {
      price: { min: standardPrice, max: standardPrice, hasVariation: false },
      duration: { min: standardDuration, max: standardDuration, hasVariation: false },
    };
  }
  const resolved = employeeIds.map((employeeId) =>
    resolveServicePricing(service, employeeId, overridesMap),
  );
  const prices = resolved.map((r) => r.price);
  const durations = resolved.map((r) => r.duration_min);
  const priceMin = Math.min(...prices);
  const priceMax = Math.max(...prices);
  const durationMin = Math.min(...durations);
  const durationMax = Math.max(...durations);
  return {
    price: { min: priceMin, max: priceMax, hasVariation: priceMin !== priceMax },
    duration: {
      min: durationMin,
      max: durationMax,
      hasVariation: durationMin !== durationMax,
    },
  };
}

// Texto único "duración · precio" para la Página Pública, siguiendo siempre
// el mismo orden y las mismas reglas de rango:
//   - sin variación:        "30 min · $20.000"
//   - duración variable:    "30–60 min · $20.000"
//   - precio variable:      "30 min · Desde $20.000"
//   - ambos variables:      "30–60 min · Desde $20.000"
export function formatServiceRangeLabel(
  range: ServiceRange,
  formatMoney: (value: number) => string,
): string {
  const durationLabel = range.duration.hasVariation
    ? `${range.duration.min}–${range.duration.max} min`
    : `${range.duration.min} min`;
  const priceLabel = range.price.hasVariation
    ? `Desde ${formatMoney(range.price.min)}`
    : formatMoney(range.price.min);
  return `${durationLabel} · ${priceLabel}`;
}

// ─────────────────────────── Promociones (Fase 2) ───────────────────────────
// Administradas por completo desde Configuración → Promociones, guardadas en
// business_settings.schedule._promotions (mismo criterio JSONB que el resto
// de esta app — no hay tabla ni migración nueva). Solo se aplican en la
// Página Pública; Agenda/Mi Agenda/Caja no las consumen en esta fase.

export type PromotionDiscountType = "percent" | "fixed";

export type PromoDaySchedule = {
  enabled: boolean;
  start: string; // "" = sin franja horaria ese día (todo el día habilitado)
  end: string;
};

export type Promotion = {
  id: string;
  name: string;
  imageUrl: string | null;
  description: string;
  active: boolean;
  discountType: PromotionDiscountType;
  discountValue: string; // raw input
  requiresCode: boolean;
  code: string; // guardado normalizado (trim + uppercase)
  serviceIds: string[];
  categoryNames: string[];
  employeeIds: string[];
  // false (default) = promoción siempre vigente, sin fechas/días/horarios —
  // solo depende del switch "Activa" de la lista. true = respeta
  // startDate/endDate/days como restricción real.
  hasVigencia: boolean;
  startDate: string; // "" = sin inicio
  endDate: string; // "" = sin fin
  days: Record<DayKey, PromoDaySchedule>;
  maxUsesTotal: number | null;
  maxUsesPerClient: number | null;
  usageCount: number;
  usedByClient: Record<string, number>;
};

// Las promociones creadas antes de que existiera el switch "Vigencia" no
// tienen ese campo guardado. Se completa una sola vez al cargar: si ya tenía
// fechas o días/horarios restringidos, se preserva ese comportamiento
// (hasVigencia = true); si no, se entiende que siempre fue "siempre
// vigente" (hasVigencia = false), sin cambiar su comportamiento real.
export function backfillPromotionVigencia(promo: Promotion): Promotion {
  if (typeof promo.hasVigencia === "boolean") return promo;
  const hasExplicitVigencia =
    !!promo.startDate ||
    !!promo.endDate ||
    Object.values(promo.days ?? {}).some((d) => !d.enabled || d.start || d.end);
  return { ...promo, hasVigencia: hasExplicitVigencia };
}

function toDayKey(date: Date): DayKey {
  const keys: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return keys[date.getDay()];
}

export function hasPromotionReachedLimit(promo: Promotion): boolean {
  return promo.maxUsesTotal != null && promo.usageCount >= promo.maxUsesTotal;
}

export function getPromotionUsesRemaining(promo: Promotion): number | null {
  if (promo.maxUsesTotal == null) return null;
  return Math.max(0, promo.maxUsesTotal - promo.usageCount);
}

// Normaliza los datos de contacto del cliente en las mismas claves que se
// guardan en `usedByClient`, para poder chequear/incrementar de forma
// consistente en los dos lugares.
export function normalizeClientKeys(phone: string, email: string): string[] {
  const keys: string[] = [];
  const p = phone.replace(/\D/g, "");
  if (p) keys.push(`phone:${p}`);
  const e = email.trim().toLowerCase();
  if (e) keys.push(`email:${e}`);
  return keys;
}

export function hasClientReachedPerClientLimit(
  promo: Promotion,
  clientKeys: string[],
): boolean {
  if (promo.maxUsesPerClient == null) return false;
  return clientKeys.some(
    (key) => (promo.usedByClient[key] ?? 0) >= promo.maxUsesPerClient!,
  );
}

// Activa + dentro de vigencia (fecha) + día de semana habilitado + (si ese
// día tiene franja horaria) hora dentro de esa franja + cupo total no
// agotado. No chequea el límite por cliente (recién se conoce el
// teléfono/email en el paso "Tus datos", más adelante en el flujo).
export function isPromotionCurrentlyValid(
  promo: Promotion,
  when: Date,
): boolean {
  if (!promo.active) return false;
  if (hasPromotionReachedLimit(promo)) return false;
  // Sin vigencia configurada: siempre válida en cuanto a fecha/día/hora,
  // solo depende de "Activa" y del cupo.
  if (!promo.hasVigencia) return true;

  if (promo.startDate && when < new Date(`${promo.startDate}T00:00:00`)) return false;
  if (promo.endDate && when > new Date(`${promo.endDate}T23:59:59`)) return false;

  const day = promo.days[toDayKey(when)];
  if (!day || !day.enabled) return false;
  if (day.start && day.end) {
    const hhmm = when.toTimeString().slice(0, 5);
    if (hhmm < day.start || hhmm > day.end) return false;
  }
  return true;
}

// Servicio incluido (por id o por categoría) y, si ya hay un profesional
// elegido, profesional incluido. Antes de elegir profesional el chequeo de
// employeeId se omite (todavía no se sabe a quién le va a tocar).
export function isPromotionApplicable(
  promo: Promotion,
  ctx: { serviceId: string; employeeId?: string | null; category?: string | null },
): boolean {
  const serviceMatch =
    promo.serviceIds.includes(ctx.serviceId) ||
    (!!ctx.category && promo.categoryNames.includes(ctx.category));
  if (!serviceMatch) return false;
  if (ctx.employeeId && !promo.employeeIds.includes(ctx.employeeId)) return false;
  return true;
}

export function applyPromotionDiscount(
  price: number,
  promo: Promotion | null | undefined,
): number {
  if (!promo) return price;
  const value = Number(promo.discountValue) || 0;
  const discounted =
    promo.discountType === "percent" ? price * (1 - value / 100) : price - value;
  return Math.max(0, Math.round(discounted));
}

// Texto único de "condiciones" para el modal ℹ️ de la Página Pública,
// armado a partir de los datos estructurados de la promo (no un campo de
// texto libre aparte que el dueño tendría que mantener sincronizado a mano).
export function formatPromotionConditions(
  promo: Promotion,
  formatMoney: (value: number) => string,
): string {
  const discount =
    promo.discountType === "percent"
      ? `${Number(promo.discountValue) || 0}% de descuento`
      : `${formatMoney(Number(promo.discountValue) || 0)} de descuento`;
  const parts = [discount];
  if (promo.hasVigencia && (promo.startDate || promo.endDate)) {
    parts.push(
      `Válido ${promo.startDate ? `desde ${promo.startDate}` : ""}${
        promo.startDate && promo.endDate ? " " : ""
      }${promo.endDate ? `hasta ${promo.endDate}` : ""}`.trim(),
    );
  }
  const enabledDays = (Object.entries(promo.days) as [DayKey, PromoDaySchedule][])
    .filter(([, d]) => d.enabled)
    .map(([key]) => key);
  if (promo.hasVigencia && enabledDays.length > 0 && enabledDays.length < 7) {
    const labels: Record<DayKey, string> = {
      sun: "Dom", mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb",
    };
    parts.push(enabledDays.map((d) => labels[d]).join(" a "));
  }
  const remaining = getPromotionUsesRemaining(promo);
  if (remaining != null) parts.push(`${remaining} disponibles`);
  return parts.join(" · ");
}
