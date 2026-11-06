import * as React from "react";
import { supabase } from "@/integrations/supabase/client";

type HeroData = {
  name: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  avatarPosition: string;
  coverPosition: string;
};

// Portada y foto de perfil del negocio (las mismas de la página pública), como
// encabezado de Inicio. Sin imágenes cargadas se ve un degradé y la inicial.
export function NegocioHero({ businessId }: { businessId: string | null }) {
  const [data, setData] = React.useState<HeroData | null>(null);

  React.useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      const [bizRes, settingsRes] = await Promise.all([
        supabase.from("businesses").select("name,logo_url,avatar_url,cover_url").eq("id", businessId).maybeSingle(),
        supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle(),
      ]);
      if (cancelled || !bizRes.data) return;
      const biz = bizRes.data as {
        name: string | null;
        logo_url: string | null;
        avatar_url: string | null;
        cover_url: string | null;
      };
      const schedule = (settingsRes.data as { schedule?: Record<string, any> } | null)?.schedule;
      const branding = schedule && typeof schedule === "object" && typeof schedule._branding === "object" ? schedule._branding : {};
      setData({
        name: biz.name ?? "Mi negocio",
        avatarUrl: biz.avatar_url || biz.logo_url || null,
        coverUrl: biz.cover_url || null,
        avatarPosition: typeof branding?.avatar_position === "string" ? branding.avatar_position : "50% 50%",
        coverPosition: typeof branding?.cover_position === "string" ? branding.cover_position : "50% 50%",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  return (
    <div className="mb-4">
      <div
        className="relative h-28 overflow-hidden rounded-2xl border border-white/10 shadow-xl sm:h-40"
        style={{ background: "linear-gradient(110deg, rgb(139 92 246 / 0.55), rgb(79 125 255 / 0.45) 55%, rgb(255 123 229 / 0.30))" }}
      >
        {data?.coverUrl ? (
          <img
            src={data.coverUrl}
            alt="Portada del negocio"
            className="h-full w-full object-cover"
            style={{ objectPosition: data.coverPosition }}
            decoding="async"
          />
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/45 to-transparent" />
      </div>
      <div className="relative z-10 -mt-9 flex items-end gap-3 px-4 sm:-mt-11 sm:gap-4 sm:px-6">
        <div className="grid h-[72px] w-[72px] shrink-0 place-items-center overflow-hidden rounded-2xl border-4 border-background bg-white text-2xl font-bold text-zinc-950 shadow-xl sm:h-[88px] sm:w-[88px] sm:rounded-3xl">
          {data?.avatarUrl ? (
            <img
              src={data.avatarUrl}
              alt={data.name}
              className="h-full w-full object-cover"
              style={{ objectPosition: data.avatarPosition }}
              decoding="async"
            />
          ) : (
            (data?.name ?? "").slice(0, 1)
          )}
        </div>
        <div className="min-w-0 pb-1">
          <h1 className="truncate font-display text-xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {data?.name ?? " "}
          </h1>
          <p className="text-xs text-muted-foreground sm:text-sm">Resumen del negocio</p>
        </div>
      </div>
    </div>
  );
}
