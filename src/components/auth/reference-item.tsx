import * as React from "react";
import { Instagram, MessageCircle } from "lucide-react";

export type RefRow = { id: string; place_name: string; locality: string | null; from_date: string | null; to_date: string | null; instagram: string | null; whatsapp: string | null };

export function monthLabel(d: string | null): string {
  if (!d) return "";
  const [y, m] = d.split("-");
  const names = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${names[Number(m) - 1] ?? ""} ${y}`;
}

export function RefItem({ x }: { x: RefRow }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-xl bg-black/25 p-3 ring-1 ring-white/10">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 truncate text-base font-semibold">{x.place_name}</div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="shrink-0 text-sm font-semibold text-violet-200">
          {open ? "Ver menos" : "Ver más"}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          {x.locality && <div className="text-sm text-white/70">{x.locality}</div>}
          <div className="text-sm text-white/60">
            Desde {x.from_date ? monthLabel(x.from_date) : "—"} · Hasta {x.to_date ? monthLabel(x.to_date) : "Actualidad"}
          </div>
          <div className="flex flex-wrap gap-2">
            {x.whatsapp && (
              <a href={`https://wa.me/${x.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 text-sm font-semibold text-emerald-200 ring-1 ring-emerald-400/30">
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
            )}
            {x.instagram && (
              <a href={`https://instagram.com/${x.instagram}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-fuchsia-500/15 px-3 text-sm font-semibold text-fuchsia-200 ring-1 ring-fuchsia-400/30">
                <Instagram className="h-4 w-4" /> @{x.instagram}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
