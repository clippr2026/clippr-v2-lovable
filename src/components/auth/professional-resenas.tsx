import * as React from "react";
import { Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { startCardCls, startCardStyle } from "@/components/auth/start-shell";

type Review = { id: string; client_name: string | null; rating: number; comment: string | null; review_date: string | null; business_name: string };

// Reseñas publicadas de la persona (de todas las barberías) y su puntaje promedio.
export function ProfessionalResenas() {
  const [rows, setRows] = React.useState<Review[] | null>(null);
  React.useEffect(() => {
    void (async () => {
      const { data } = await (supabase as any).rpc("my_reviews");
      setRows((data as Review[] | null) ?? []);
    })();
  }, []);
  if (!rows) return <div className="py-10 text-center text-white/60">Cargando…</div>;
  const avg = rows.length ? (rows.reduce((a, r) => a + r.rating, 0) / rows.length).toFixed(1).replace(".", ",") : null;

  return (
    <div className="space-y-3">
      <div className={`${startCardCls} flex items-center gap-4 p-4`} style={startCardStyle}>
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-amber-400/15 text-amber-300 ring-1 ring-amber-300/25">
          <Star className="h-7 w-7" />
        </span>
        <div>
          <div className="text-4xl font-bold">{avg ?? "—"}</div>
          <div className="text-base text-white/60">{rows.length} {rows.length === 1 ? "reseña" : "reseñas"}</div>
        </div>
      </div>
      {rows.length === 0 && <div className="py-6 text-center text-lg text-white/60">Todavía no tenés reseñas.</div>}
      {rows.map((r) => (
        <div key={r.id} className={`${startCardCls} space-y-2 p-4`} style={startCardStyle}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <Star key={i} className={`h-5 w-5 ${i <= r.rating ? "fill-amber-300 text-amber-300" : "text-white/20"}`} />
              ))}
            </div>
            <span className="text-sm text-white/50">{r.business_name}</span>
          </div>
          {r.comment && <p className="text-base text-white/80">{r.comment}</p>}
          <div className="text-sm text-white/50">{r.client_name || "Cliente"}</div>
        </div>
      ))}
    </div>
  );
}
