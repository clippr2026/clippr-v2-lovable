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

const avg1 = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Paso "Profesional" de la página de reservas: grilla con todos los profesionales; al tocar uno
// se abre en grande (sin cambiar de pantalla) y los demás pasan a una tira arriba.
export function PublicProfessionalPicker({
  items,
  ratings,
  accent,
  buttonText,
  hasServices,
  formatMoney,
  onChoose,
  onAny,
}: {
  items: ProfessionalPickerItem[];
  ratings: Record<string, ProfessionalRating>;
  accent: string;
  buttonText: string;
  hasServices: boolean;
  formatMoney: (n: number) => string;
  onChoose: (id: string) => void;
  onAny: () => void;
}) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const open = items.find((i) => i.id === openId) ?? null;

  const priceBlock = (item: ProfessionalPickerItem, big: boolean) => {
    if (!hasServices) return null;
    const row = (label: string, value: string, strong?: boolean) =>
      big ? (
        <span
          className={cn("flex-1 rounded-2xl border px-3 py-2 text-center leading-tight", strong ? "border-white/30 bg-white/[0.08]" : "border-white/15 bg-white/[0.03]")}
          style={strong ? { boxShadow: "0 0 12px -3px var(--c-accent)" } : undefined}
        >
          <span className="block text-[11px] font-bold uppercase tracking-wide text-white/65">{label}</span>
          <span className="block text-xl font-extrabold">{value}</span>
        </span>
      ) : (
        <span
          className={cn("flex w-full items-center justify-between gap-1 rounded-full border px-2.5 py-1 text-[11px] leading-tight", strong ? "border-white/30 bg-white/[0.09]" : "border-white/15")}
        >
          <span className="whitespace-nowrap text-white/75">{label}:</span>
          <span className="font-bold">{value}</span>
        </span>
      );
    const rows = [
      row(big ? "Precio de lista" : "Lista", formatMoney(item.listPrice)),
      item.promoPrice != null
        ? row(big ? `Promo${item.promoPercent != null ? ` (-${item.promoPercent}%)` : ""}` : "Promo", formatMoney(item.promoPrice), true)
        : item.effectivePrice != null
          ? row(big ? "Precio efectivo" : "Efectivo", formatMoney(item.effectivePrice), true)
          : null,
    ];
    return big ? (
      <div className="flex gap-2">{rows}</div>
    ) : (
      <div className="flex w-full flex-col gap-1">{rows}</div>
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
    <div className="mt-5">
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

          <div key={open.id} className="pp-card-in mt-3 rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 text-center">
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
              <p className="mt-3 text-xs text-white/60">🕒 {open.duration} min{open.priceChanged ? " · precio diferente al estándar" : ""}</p>
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
        </div>
      ) : (
        <div className="pp-grid-in">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Profesionales</p>
          <div className="grid grid-cols-2 gap-3">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setOpenId(item.id)}
                className="flex min-w-0 flex-col gap-2 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-white/30 hover:bg-white/[0.055] active:scale-[0.98]"
              >
                <span className="flex items-center gap-2.5">
                  <Avatar item={item} icon="h-6 w-6" className="h-16 w-16 border-2 border-white/30" />
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                    <span className="w-full truncate text-base font-extrabold uppercase leading-tight">{item.name.split(" ")[0]}</span>
                    {ratingPill(item.id, false)}
                  </span>
                </span>
                {item.priceChanged ? (
                  <span className="self-start rounded-full bg-violet-900 px-2 py-[2px] text-[9px] font-semibold" style={{ color: "#fff" }}>
                    Precio diferente
                  </span>
                ) : null}
                {priceBlock(item, false)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onAny}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-3xl border border-white/10 bg-white/[0.03] p-3 text-sm font-semibold transition hover:border-white/30 hover:bg-white/[0.055]"
          >
            <UsersRound className="h-4 w-4" style={{ color: accent }} /> Sin preferencia
            <span className="text-xs font-normal text-white/55">· Disponible</span>
          </button>
        </div>
      )}
    </div>
  );
}
