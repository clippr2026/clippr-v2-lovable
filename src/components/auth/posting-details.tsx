import { Clock, MapPin } from "lucide-react";

type Details = { schedule?: string | null; price?: string | null; zone?: string | null; contact?: string | null; instagram?: string | null; years?: number | null };

// Datos de un aviso, en el mismo orden en todas partes: horario, precio y dirección.
export function PostingDetails({ p }: { p: Details }) {
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
    </>
  );
}
