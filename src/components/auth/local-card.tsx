import * as React from "react";
import { fmtRating } from "@/lib/rating";
import { Link } from "@tanstack/react-router";
import { Clock, MapPin, Scissors, Star } from "lucide-react";
import { startCardCls, startCardStyle } from "@/components/auth/start-shell";
import { formatKm } from "@/lib/geo";

export function Badge({ compact }: { compact?: boolean } = {}) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#1b1245] font-semibold text-white shadow-lg ring-1 ring-violet-300/60 ${compact ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm"}`}>
      <img src="/clippr-logo-login.webp" alt="" className={compact ? "h-3.5 w-3.5 object-contain" : "h-4 w-4 object-contain"} />
      Usa Clippr
    </span>
  );
}


export function yearsOf(date?: string | null): number | null {
  if (!date) return null;
  const y = Math.floor((Date.now() - new Date(date).getTime()) / (365.25 * 24 * 3600 * 1000));
  return y >= 0 ? y : null;
}


const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// "Lun a Sáb · 11:00 a 20:00": agrupa los días seguidos con el mismo horario.
function formatHours(hours?: Record<string, { s: string; e: string }> | null): string[] {
  if (!hours) return [];
  const out: string[] = [];
  let i = 0;
  while (i < 7) {
    const h = hours[DAY_KEYS[i]];
    if (!h) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < 7 && hours[DAY_KEYS[j + 1]]?.s === h.s && hours[DAY_KEYS[j + 1]]?.e === h.e) j++;
    out.push(`${j === i ? DAY_NAMES[i] : j === i + 1 ? `${DAY_NAMES[i]} y ${DAY_NAMES[j]}` : `${DAY_NAMES[i]} a ${DAY_NAMES[j]}`} · ${h.s} a ${h.e}`);
    i = j + 1;
  }
  return out;
}


export type Local = {
  slug: string; name: string; logo_url: string | null; cover_url: string | null; address: string | null;
  instagram: string | null; business_start_date: string | null; reviews_avg: number | null; reviews_count: number; distKm?: number | null;
  hours?: Record<string, { s: string; e: string }> | null;
};

// Tarjeta de un local: portada, logo, nombre con estrellas, dirección y botón para reservar.
export function LocalCard({ l, footer }: { l: Local; footer?: React.ReactNode }) {
  const y = yearsOf(l.business_start_date);
  return (
    <div className={`${startCardCls} overflow-hidden`} style={startCardStyle}>
      <div className="relative">
        {l.cover_url ? <img src={l.cover_url} alt="" loading="lazy" decoding="async" className="h-32 w-full object-cover" /> : <div className="h-20 bg-gradient-to-r from-sky-500/20 to-violet-500/30" />}
        <div className="absolute left-3 top-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1b1245] px-3 py-1 text-sm font-semibold text-white shadow-lg ring-1 ring-violet-300/60">
            <Scissors className="h-4 w-4 text-violet-200" />
            Barbería
          </span>
        </div>
        <div className="absolute right-3 top-3">
          <Badge />
        </div>
      </div>
      <div className="-mt-7 flex items-start gap-3 px-4">
        <span className="relative z-10 grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#0d0b18] text-xl font-semibold ring-2 ring-[#08070f]">
          {l.logo_url ? <img src={l.logo_url} alt={l.name} loading="lazy" decoding="async" className="h-full w-full object-cover" /> : (l.name[0] || "?").toUpperCase()}
        </span>
        <div className="min-w-0 flex-1 pt-8">
          <div className="flex items-center gap-2">
            <span className="truncate text-xl font-semibold leading-tight">{l.name}</span>
            {!!l.reviews_count && (
              <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-base">
                <Star className="h-4 w-4 fill-amber-300 text-amber-300" />
                <span className="font-semibold">{fmtRating(l.reviews_avg)}</span>
                <span className="text-white/50">({l.reviews_count})</span>
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="space-y-2 p-4 pt-3">
        {l.address && (
          <div className="flex items-center gap-2 text-base text-white/75">
            <MapPin className="h-4 w-4 shrink-0 text-violet-300" />
            <span className="truncate">{l.address}</span>
          </div>
        )}
        {formatHours(l.hours).map((h) => (
          <div key={h} className="flex items-center gap-2 text-base text-white/75">
            <Clock className="h-4 w-4 shrink-0 text-violet-300" />
            <span>{h}</span>
          </div>
        ))}
        {(y != null && y >= 1) || l.distKm != null ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-base font-bold text-white/90">{y != null && y >= 1 ? `${y} ${y === 1 ? "año" : "años"} de experiencia` : ""}</span>
            {l.distKm != null && <span className="shrink-0 text-base text-white/60">{formatKm(l.distKm)}</span>}
          </div>
        ) : null}
        {footer ?? (
          <Link to="/negocio/$slug" params={{ slug: l.slug }} className="flex h-12 w-full items-center justify-center rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white">
            Reservar
          </Link>
        )}
      </div>
    </div>
  );
}

