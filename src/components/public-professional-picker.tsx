import * as React from "react";
import { ArrowRight, Briefcase, ChevronLeft, Star, UserRound, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProfessionalPickerItem = {
  id: string;
  name: string;
  avatarUrl: string | null;
  listPrice: number;
  effectivePrice: number | null;
  promoPrice: number | null;
  promoPercent: number | null;
  priceChanged: boolean;
  duration: number;
  // Perfil público (Configuración → Equipo). Cada dato se muestra solo si está cargado.
  ageYears?: number | null;
  nationality?: string | null;
  experienceYears?: number | null;
};

export type ProfessionalRating = { avg: number; count: number };

export type ProfessionalReview = {
  id: string;
  client_name: string;
  rating: number;
  comment: string | null;
  review_date: string;
  featured?: boolean;
};

const CSS = `
  @keyframes pp-card-in { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
  @keyframes pp-strip-in { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: none; } }
  @keyframes pp-grid-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
  .pp-card-in { animation: pp-card-in .32s cubic-bezier(.2,.8,.2,1) both; }
  .pp-strip-in { animation: pp-strip-in .3s cubic-bezier(.2,.8,.2,1) both; }
  .pp-grid-in { animation: pp-grid-in .28s ease both; }
  @media (prefers-reduced-motion: reduce) { .pp-card-in, .pp-strip-in, .pp-grid-in { animation: none; } }
`;

function Avatar({ item, className, icon }: { item: ProfessionalPickerItem; className: string; icon: string }) {
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-full bg-white/10", className)}>
      {item.avatarUrl ? (
        <img loading="lazy" decoding="async" src={item.avatarUrl} alt={item.name} className="h-full w-full object-cover" />
      ) : (
        <UserRound className={icon} />
      )}
    </span>
  );
}

// Bandera para las nacionalidades más comunes; con otra, un globo.
const FLAGS: [RegExp, string][] = [
  [/argentin/i, "🇦🇷"], [/uruguay/i, "🇺🇾"], [/paraguay/i, "🇵🇾"], [/chile/i, "🇨🇱"], [/bolivia/i, "🇧🇴"],
  [/per[uú]/i, "🇵🇪"], [/brasil|brazil/i, "🇧🇷"], [/colombia/i, "🇨🇴"], [/venezuela/i, "🇻🇪"], [/ecuador/i, "🇪🇨"],
  [/mexic|méxic/i, "🇲🇽"], [/espa[nñ]/i, "🇪🇸"], [/ital/i, "🇮🇹"], [/cuba/i, "🇨🇺"], [/dominican/i, "🇩🇴"],
];
const flagFor = (nat: string) => FLAGS.find(([re]) => re.test(nat))?.[1] ?? "🌎";

const reviewDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

const avg1 = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Paso "Profesional" de la página de reservas: grilla con todos los profesionales; al tocar uno
// se abre en grande (sin cambiar de pantalla) y los demás pasan a una tira arriba.
export function PublicProfessionalPicker({
  items,
  ratings,
  reviews = {},
  accent,
  buttonText,
  hasServices,
  formatMoney,
  onChoose,
  onAny,
}: {
  items: ProfessionalPickerItem[];
  ratings: Record<string, ProfessionalRating>;
  // Reseñas publicadas de cada profesional (se ven abajo al abrirlo).
  reviews?: Record<string, ProfessionalReview[]>;
  accent: string;
  buttonText: string;
  hasServices: boolean;
  formatMoney: (n: number) => string;
  onChoose: (id: string) => void;
  onAny: () => void;
}) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [showAllReviews, setShowAllReviews] = React.useState(false);
  const open = items.find((i) => i.id === openId) ?? null;
  React.useEffect(() => {
    setShowAllReviews(false);
  }, [openId]);

  // Mismos recuadros de precio que la lista de servicios: título chico arriba, monto abajo, letras
  // blancas y borde neón (lista con el color principal, efectivo/promo con el de acento).
  const priceBlock = (item: ProfessionalPickerItem, big: boolean) => {
    if (!hasServices) return null;
    const chip = (label: string, value: string, kind: "list" | "accent") => (
      <span
        key={label}
        className={cn(
          "block min-w-0 flex-1 rounded-xl border-2 px-2 py-0.5 text-center leading-tight text-white",
          kind === "list" ? "border-white/20 bg-white/[0.05]" : "",
        )}
        style={
          kind === "list"
            ? { boxShadow: "0 0 7px color-mix(in oklch, var(--c-primary) 85%, transparent), inset 0 0 6px -2px var(--c-primary)" }
            : {
                borderColor: accent,
                background: `color-mix(in oklch, ${accent} 32%, transparent)`,
                boxShadow: `0 0 7px ${accent}, inset 0 0 6px -2px ${accent}`,
              }
        }
      >
        {big ? (
          <>
            <span className="block text-[10px] font-bold">{label}</span>
            <span className="block text-xl font-extrabold">{value}</span>
          </>
        ) : (
          <span className="flex items-baseline justify-between gap-1">
            <span className="text-[10px] font-bold">{label}</span>
            <span className="text-sm font-extrabold">{value}</span>
          </span>
        )}
      </span>
    );
    const second =
      item.promoPrice != null
        ? chip(big ? `Promo${item.promoPercent != null ? ` (-${item.promoPercent}%)` : ""}` : "Promo", formatMoney(item.promoPrice), "accent")
        : item.effectivePrice != null
          ? chip(big ? "Precio efectivo" : "Efectivo", formatMoney(item.effectivePrice), "accent")
          : null;
    return (
      <div className={cn("flex", big ? "flex-row gap-2" : "flex-col gap-1")}>
        {chip(big ? "Precio de lista" : "Lista", formatMoney(item.listPrice), "list")}
        {second}
      </div>
    );
  };

  const ratingPill = (id: string, big: boolean) => {
    const r = ratings[id];
    if (!r || !(r.count > 0)) return null;
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-full border border-white/20 px-2.5 py-0.5 font-bold", big ? "text-sm" : "text-xs")}>
        <Star className={cn("fill-current text-amber-400", big ? "h-4 w-4" : "h-3.5 w-3.5")} />
        {avg1(r.avg)}
        {big ? <span className="font-medium text-white/60">({r.count})</span> : null}
      </span>
    );
  };

  return (
    <div className="mt-3">
      <style>{CSS}</style>
      {open ? (
        <div>
          {/* Los demás profesionales, arriba, en una tira; tocar otro cambia el abierto. */}
          <div className="pp-strip-in -mx-1 flex gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {items.map((item) => {
              const active = item.id === open.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setOpenId(item.id)}
                  className="flex w-[68px] shrink-0 flex-col items-center gap-1 text-center"
                  aria-pressed={active}
                >
                  <Avatar
                    item={item}
                    icon="h-6 w-6"
                    className={cn(
                      "h-14 w-14 border-2 transition",
                      active ? "scale-110 border-white/80" : "border-white/20 opacity-75",
                    )}
                  />
                  <span className={cn("w-full truncate text-[11px] font-semibold", active ? "" : "text-white/65")}>{item.name.split(" ")[0]}</span>
                </button>
              );
            })}
          </div>

          <div key={open.id} className="pp-card-in relative mt-4 rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 text-center">
            {open.priceChanged ? (
              <span
                className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border px-4 py-1 text-xs font-bold text-white"
                style={{ borderColor: accent, background: `color-mix(in oklch, ${accent} 30%, #0b0818)` }}
              >
                Precio diferencial
              </span>
            ) : null}
            <Avatar item={open} icon="h-14 w-14" className="mx-auto h-36 w-36 border-2 border-white/40 sm:h-40 sm:w-40" />
            <h3 className="mt-4 text-2xl font-extrabold uppercase leading-tight">{open.name}</h3>
            <div className="mt-2 flex justify-center">{ratingPill(open.id, true)}</div>
            <div className="mt-4">{priceBlock(open, true)}</div>
            {open.ageYears != null || open.nationality || open.experienceYears != null ? (
              <div className="mt-4 grid grid-flow-col auto-cols-fr divide-x divide-white/10 rounded-2xl border border-white/10 py-3">
                {open.ageYears != null ? (
                  <div className="px-2 text-center leading-tight">
                    <UserRound className="mx-auto mb-1 h-5 w-5 text-white/70" />
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-white/55">Edad</span>
                    <span className="block text-sm font-bold">{open.ageYears} años</span>
                  </div>
                ) : null}
                {open.nationality ? (
                  <div className="px-2 text-center leading-tight">
                    <span className="mx-auto mb-1 block text-xl leading-none">{flagFor(open.nationality)}</span>
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-white/55">Nacionalidad</span>
                    <span className="block text-sm font-bold">{open.nationality}</span>
                  </div>
                ) : null}
                {open.experienceYears != null ? (
                  <div className="px-2 text-center leading-tight">
                    <Briefcase className="mx-auto mb-1 h-5 w-5 text-white/70" />
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-white/55">Experiencia</span>
                    <span className="block text-sm font-bold">{open.experienceYears === 1 ? "1 año" : `${open.experienceYears} años`}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
            {hasServices ? (
              <p className="mt-3 text-xs text-white/60">🕒 {open.duration} min</p>
            ) : null}
            <button
              type="button"
              onClick={() => onChoose(open.id)}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold uppercase tracking-wide transition hover:brightness-110"
              style={{ background: accent, color: buttonText, WebkitTextFillColor: buttonText }}
            >
              Elegir profesional <ArrowRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setOpenId(null)} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-white/65 hover:text-white">
              <ChevronLeft className="h-3.5 w-3.5" /> Ver todos los profesionales
            </button>
          </div>

          {(() => {
            const all = [...(reviews[open.id] ?? [])].sort(
              (a, b) => Number(!!b.featured) - Number(!!a.featured) || b.review_date.localeCompare(a.review_date),
            );
            if (all.length === 0) return null;
            const shown = showAllReviews ? all : all.slice(0, 3);
            return (
              <div key={`rev-${open.id}`} className="pp-card-in mt-5">
                <h4 className="mb-2 text-sm font-bold">Reseñas de {open.name.split(" ")[0]}</h4>
                <div className="space-y-2.5">
                  {shown.map((r) => (
                    <div key={r.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-0.5" aria-label={`${r.rating} de 5 estrellas`}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Star key={n} className={cn("h-3.5 w-3.5", n <= r.rating ? "fill-current text-amber-400" : "text-white/25")} />
                          ))}
                        </span>
                        <span className="text-[11px] text-white/50">{reviewDate(r.review_date)}</span>
                      </div>
                      {r.comment ? <p className="mt-2 break-words text-sm text-white/85">"{r.comment}"</p> : null}
                      <p className="mt-2 text-xs font-semibold">{r.client_name}</p>
                    </div>
                  ))}
                </div>
                {all.length > 3 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllReviews((v) => !v)}
                    className="mt-3 w-full text-center text-xs font-semibold"
                    style={{ color: accent }}
                  >
                    {showAllReviews ? "Ver menos" : `Ver todas (${all.length})`}
                  </button>
                ) : null}
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="pp-grid-in">
          <div className="grid grid-cols-2 gap-2.5">
            {items.map((item) => {
              const r = ratings[item.id];
              const second =
                item.promoPrice != null
                  ? { label: "Promo", value: item.promoPrice }
                  : item.effectivePrice != null
                    ? { label: "Efectivo", value: item.effectivePrice }
                    : null;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setOpenId(item.id)}
                  className="relative flex min-w-0 flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-2.5 py-3.5 text-left transition hover:bg-white/[0.055] active:scale-[0.98]"
                >
                  {item.priceChanged ? (
                    <span
                      className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border px-1.5 py-[1px] text-[8px] font-bold leading-tight text-white"
                      style={{ borderColor: accent, background: `color-mix(in oklch, ${accent} 30%, #0b0818)` }}
                    >
                      Precio diferencial
                    </span>
                  ) : null}
                  <span className="flex items-center gap-2">
                    <span
                      className="grid h-[52px] w-[52px] shrink-0 place-items-center overflow-hidden rounded-full bg-white/10"
                      style={{ boxShadow: `0 0 16px 3px color-mix(in oklch, ${accent} 65%, transparent)` }}
                    >
                      {item.avatarUrl ? (
                        <img loading="lazy" decoding="async" src={item.avatarUrl} alt={item.name} className="h-full w-full object-cover" />
                      ) : (
                        <UserRound className="h-6 w-6" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block break-words text-xs font-extrabold uppercase tracking-tight">{item.name.split(" ")[0]}</span>
                      {r && r.count > 0 ? (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-white/75">
                          <Star className="h-3 w-3 fill-current text-amber-400" />
                          {avg1(r.avg)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {hasServices ? (
                    <span className="block space-y-1">
                      <span className="flex items-baseline justify-between gap-1">
                        <span className="text-[11px] font-bold text-white/60">Lista</span>
                        <span className={cn("text-xl font-extrabold text-white/70", item.promoPrice != null && "line-through")}>{formatMoney(item.listPrice)}</span>
                      </span>
                      {second ? (
                        <span className="flex items-baseline justify-between gap-1">
                          <span className="text-[11px] font-bold" style={{ color: accent }}>
                            {second.label}
                            {second.label === "Promo" && item.promoPercent != null ? ` -${item.promoPercent}%` : ""}
                          </span>
                          <span className="text-xl font-extrabold" style={{ color: accent }}>{formatMoney(second.value)}</span>
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onAny}
            className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-3xl border border-white/10 bg-white/[0.04] p-2.5 text-sm font-semibold transition hover:bg-white/[0.055]"
          >
            <UsersRound className="h-4 w-4" style={{ color: accent }} /> Sin preferencia
            <span className="text-xs font-normal text-white/55">· Disponible</span>
          </button>
        </div>
      )}
    </div>
  );
}
