import { Clock, Instagram, MapPin, MessageCircle } from "lucide-react";

type Details = { schedule?: string | null; price?: string | null; zone?: string | null; contact?: string | null; instagram?: string | null; years?: number | null };

// Datos de un aviso, en el mismo orden en todas partes: horario, precio, dirección y botones de contacto.
export function PostingDetails({ p }: { p: Details }) {
  const wa = (p.contact ?? "").replace(/\D/g, "");
  const ig = (p.instagram ?? "").replace(/^@/, "").trim();
  return (
    <>
      <div className="space-y-1 text-base text-white/75">
        {p.schedule && (
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 shrink-0 text-violet-300" />{p.schedule}</div>
        )}
        {p.price && <div className="font-semibold text-emerald-300">{p.price}</div>}
        {p.zone && (
          <div className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-violet-300" />{p.zone}</div>
        )}
      </div>
      {(wa.length >= 8 || ig || p.years != null) && (
        <div className="flex flex-wrap items-center gap-2">
          {wa.length >= 8 && (
            <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="grid h-11 w-11 place-items-center rounded-full bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30">
              <MessageCircle className="h-5 w-5" />
            </a>
          )}
          {ig && (
            <a href={`https://instagram.com/${ig}`} target="_blank" rel="noreferrer" aria-label="Instagram" className="grid h-11 w-11 place-items-center rounded-full bg-white/5 text-white/85 ring-1 ring-white/10">
              <Instagram className="h-5 w-5" />
            </a>
          )}
          {p.years != null && p.years >= 1 && (
            <span className="ml-1 text-base text-white/70">{p.years} {p.years === 1 ? "año" : "años"} de experiencia</span>
          )}
        </div>
      )}
    </>
  );
}
