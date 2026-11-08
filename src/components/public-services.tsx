import * as React from "react";
import { Crown, Info, Sparkles, Star, Tag, UserRound } from "lucide-react";
import { publicButtonStyle } from "@/lib/public-button";
import { ServiceImage } from "@/components/ui/service-image";
import {
  computeStandardEffectivePrice,
  resolveServicePricing,
  type EmployeeServiceOverrideMap,
} from "@/lib/service-pricing";

export type PublicServiceItem = {
  id: string;
  name: string;
  price: number | null;
  duration_min?: number | null;
  image_url?: string | null;
  image_position?: string | null;
  cash_discount?: number | null;
};

const money = (n: number) => `$${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n)}`;
const GOLD = "#F5B301";

// Precio de lista, precio en efectivo y si el precio cambia según el profesional.
function pricingOf(service: PublicServiceItem, employeeIds: string[], overrides: EmployeeServiceOverrideMap) {
  const price = Number(service.price ?? 0) || 0;
  const effective = computeStandardEffectivePrice(service.price, service.cash_discount);
  const combos = new Set<string>();
  const ids = employeeIds.length > 0 ? employeeIds : [null];
  for (const id of ids) {
    const r = resolveServicePricing(
      { id: service.id, price: service.price, duration_min: service.duration_min, cash_discount: service.cash_discount },
      id,
      overrides,
    );
    combos.add(`${r.price}|${r.effectivePrice ?? ""}`);
  }
  return { price, effective, varies: combos.size > 1 };
}

function PriceChips({
  price,
  effective,
  varies,
  infoOpen,
  onInfo,
  light,
}: {
  light: boolean;
  price: number;
  effective: number | null;
  varies: boolean;
  infoOpen: boolean;
  onInfo: () => void;
}) {
  // Tono del color elegido apenas más vivo que el acento, sin llegar a blanquearse.
  // Letras de los dos precios: blancas (negras en fondo claro); el color queda en el borde neón.
  const listColor = light ? "#111827" : "#ffffff";
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {price > 0 ? (
          <span
            className="rounded-xl border-2 border-white/20 bg-white/[0.05] px-2.5 py-1 text-center leading-tight"
            style={{ boxShadow: "0 0 7px color-mix(in oklch, var(--c-primary) 85%, transparent), inset 0 0 6px -2px var(--c-primary)" }}
          >
            <span className="block text-[10px] font-bold" style={{ color: listColor, WebkitTextFillColor: listColor }}>
              Precio de lista
            </span>
            <span className="block text-base font-extrabold" style={{ color: listColor, WebkitTextFillColor: listColor }}>
              {money(price)}
            </span>
          </span>
        ) : null}
        {effective != null && effective < price ? (
          <span
            className="rounded-xl border-2 px-2.5 py-1 text-center leading-tight"
            style={{
              borderColor: "var(--c-accent)",
              boxShadow: "0 0 7px var(--c-accent), inset 0 0 6px -2px var(--c-accent)",
              background: "color-mix(in oklch, var(--c-accent) 32%, transparent)",
            }}
          >
            <span className="block text-[10px] font-bold" style={{ color: listColor, WebkitTextFillColor: listColor }}>
              Efectivo
            </span>
            <span className="block text-base font-extrabold" style={{ color: listColor, WebkitTextFillColor: listColor }}>
              {money(effective)}
            </span>
          </span>
        ) : null}
        {varies ? (
          <button type="button" onClick={onInfo} className="flex items-center gap-1.5 text-left text-[11px] font-medium leading-tight text-white/75">
            <UserRound className="h-4 w-4 shrink-0" />
            <span>Según profesional</span>
            <Info className="h-3.5 w-3.5 shrink-0 opacity-80" />
          </button>
        ) : null}
      </div>
      {varies && infoOpen ? (
        <p className="mt-1.5 text-[11px] leading-snug text-white/60">El precio puede cambiar según el profesional que elijas al reservar.</p>
      ) : null}
    </>
  );
}

// Lista de servicios de la página pública: un servicio destacado arriba (el que elige el negocio en
// Configuración) y el resto en filas compactas con precio de lista, precio en efectivo y "Según profesional".
export function PublicServicesList({
  services,
  featuredId,
  featuredDescription,
  promoIds,
  employeeIds,
  overrides,
  accent,
  buttonText,
  light,
  bookingHref,
}: {
  services: PublicServiceItem[];
  featuredId: string | null;
  featuredDescription: string;
  promoIds: string[];
  employeeIds: string[];
  overrides: EmployeeServiceOverrideMap;
  accent: string;
  buttonText: string;
  light: boolean;
  bookingHref: (p: { service: string }) => string;
}) {
  const [infoFor, setInfoFor] = React.useState<string | null>(null);
  const featured = featuredId ? services.find((s) => s.id === featuredId) ?? null : null;
  const rest = services.filter((s) => s.id !== featured?.id);

  const promoBadge = (id: string) =>
    promoIds.includes(id) ? (
      <span
        className="mb-1 inline-flex items-center gap-1 rounded-full border-2 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider"
        style={{
          // Mismo neón que el borde de las tarjetas (color secundario del negocio).
          borderColor: "var(--c-secondary)",
          color: "var(--c-secondary)",
          WebkitTextFillColor: "var(--c-secondary)",
          background: "color-mix(in oklch, var(--c-secondary) 16%, transparent)",
          boxShadow: "0 0 8px color-mix(in oklch, var(--c-secondary) 75%, transparent), inset 0 0 6px -2px var(--c-secondary)",
        }}
      >
        <Tag className="h-3 w-3" /> Promo
      </span>
    ) : null;

  const reserve = (id: string, className: string) => (
    <a
      href={bookingHref({ service: id })}
      className={className + " rounded-full text-center font-bold transition hover:-translate-y-0.5 hover:brightness-110"}
      style={publicButtonStyle(accent, buttonText)}
    >
      Reservar
    </a>
  );

  const fallback = (
    <div
      className="grid h-full w-full place-items-center"
      style={{ background: "linear-gradient(135deg, color-mix(in oklch, var(--c-accent) 20%, transparent), color-mix(in oklch, var(--c-primary) 12%, transparent))" }}
    >
      <Sparkles className="h-6 w-6" style={{ color: accent }} />
    </div>
  );

  const rowBorder = light
    ? "border-zinc-200/80 bg-zinc-50/60 shadow-[0_16px_40px_-24px_rgba(24,24,27,0.35)]"
    : "border-white/[0.12] bg-white/[0.03] shadow-[0_16px_40px_-20px_rgba(0,0,0,0.6)]";

  return (
    <div className="mt-5 grid gap-3 sm:gap-4">
      {featured
        ? (() => {
            const pr = pricingOf(featured, employeeIds, overrides);
            return (
              <div
                className="relative min-w-0 rounded-3xl border p-4 sm:p-5"
                style={{
                  borderColor: `${GOLD}cc`,
                  boxShadow: `0 0 0 1px ${GOLD}40, 0 0 30px -8px ${GOLD}88`,
                  background: `linear-gradient(135deg, ${GOLD}14, transparent 55%)`,
                }}
              >
                <span
                  className="absolute -top-3 left-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide text-black"
                  style={{ background: `linear-gradient(90deg, ${GOLD}, #ffcf4d)`, WebkitTextFillColor: "#000" }}
                >
                  <Star className="h-3.5 w-3.5" /> Servicio destacado
                </span>
                <Crown className="absolute right-4 top-3 h-7 w-7" style={{ color: GOLD, filter: `drop-shadow(0 0 8px ${GOLD}aa)` }} />
                <div className="mt-2 flex items-start gap-4">
                  <ServiceImage
                    src={featured.image_url}
                    alt={featured.name}
                    position={featured.image_position}
                    className="h-24 w-24 shrink-0 rounded-2xl ring-1 ring-white/15 sm:h-28 sm:w-28"
                    fallback={fallback}
                  />
                  <div className="min-w-0 flex-1 pr-7">
                    {promoBadge(featured.id)}
                    <p className="line-clamp-3 text-xl font-bold uppercase leading-tight sm:text-2xl">{featured.name}</p>
                    {featuredDescription ? <p className="mt-1.5 text-sm leading-snug text-white/75">{featuredDescription}</p> : null}
                  </div>
                </div>
                <div className="mt-3">
                  <PriceChips {...pr} light={light} infoOpen={infoFor === featured.id} onInfo={() => setInfoFor((v) => (v === featured.id ? null : featured.id))} />
                </div>
                {reserve(featured.id, "mt-3.5 block w-full py-3 text-sm")}
              </div>
            );
          })()
        : null}

      {rest.map((service) => {
        const pr = pricingOf(service, employeeIds, overrides);
        return (
          <div key={service.id} className={`${rowBorder} flex min-w-0 items-center gap-3 rounded-2xl border p-3 transition hover:bg-white/[0.05] sm:gap-4 sm:p-4`}>
            <ServiceImage
              src={service.image_url}
              alt={service.name}
              position={service.image_position}
              className={(light ? "ring-zinc-200" : "ring-white/10") + " h-16 w-16 shrink-0 rounded-xl ring-1 sm:h-[4.5rem] sm:w-[4.5rem]"}
              fallback={fallback}
            />
            <div className="min-w-0 flex-1">
              {promoBadge(service.id)}
              <p className="line-clamp-2 text-base font-bold uppercase leading-snug sm:text-lg">{service.name}</p>
              <div className="mt-1.5 sm:flex sm:items-end sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <PriceChips {...pr} light={light} infoOpen={infoFor === service.id} onInfo={() => setInfoFor((v) => (v === service.id ? null : service.id))} />
                </div>
                {reserve(service.id, "mt-2 block w-full py-1.5 text-xs sm:mt-0 sm:w-auto sm:shrink-0 sm:px-5")}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
