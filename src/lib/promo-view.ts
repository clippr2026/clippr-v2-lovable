import {
  applyPromotionDiscount,
  isPromotionApplicable,
  isPromotionCurrentlyValid,
  type Promotion,
} from "@/lib/service-pricing";

// Promos de un servicio para Caja → Precios. Solo lectura: nunca modifica una promo.

export type ServicePromoOffer = { promo: Promotion; price: number };

// Promos que hoy aplican a un servicio SIN pedir código (las que piden código no tienen un
// precio mostrable: dependen de que el cliente lo diga). Sobre el precio de lista.
// Ordenadas de menor a mayor precio final.
export function activePromoOffersForService(
  service: { id: string; price: number | string | null; category?: string | null },
  promos: Promotion[],
  now: Date,
): ServicePromoOffer[] {
  const list = Number(service.price ?? 0) || 0;
  return promos
    .filter(
      (p) =>
        !p.requiresCode &&
        isPromotionCurrentlyValid(p, now) &&
        isPromotionApplicable(p, { serviceId: service.id, category: service.category ?? null }),
    )
    .map((promo) => ({ promo, price: applyPromotionDiscount(list, promo) }))
    .sort((a, b) => a.price - b.price);
}
