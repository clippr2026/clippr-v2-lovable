import * as React from "react";
import { MapPin, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type HeroData = {
  name: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  avatarPosition: string;
  coverPosition: string;
  startDate: string | null;
};

function yearsSince(raw: string | null) {
  if (!raw) return "—";
  const start = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(start.getTime())) return "—";
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  const monthDiff = now.getMonth() - start.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < start.getDate())) years -= 1;
  return years >= 0 ? String(years) : "—";
}

// Encabezado de Inicio: mismo diseño que la cabecera de la página pública
// (portada, foto de perfil, nombre con verificación, estrellas, años de
// experiencia y sucursales), con las mismas imágenes y encuadres.
export function NegocioHero({ businessId }: { businessId: string | null }) {
  const { branches, activeBranchId, setActiveBranchId } = useAuth();
  const [data, setData] = React.useState<HeroData | null>(null);

  React.useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      const [bizRes, settingsRes, statsRes] = await Promise.all([
        supabase.from("businesses").select("name,logo_url,avatar_url,cover_url").eq("id", businessId).maybeSingle(),
        supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle(),
        supabase.rpc("get_public_business_stats" as any, { p_business_id: businessId }),
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
      const statsRow = (Array.isArray(statsRes.data) ? statsRes.data[0] : statsRes.data) as
        | { business_start_date?: string | null }
        | null
        | undefined;
      setData({
        name: biz.name ?? "Mi negocio",
        avatarUrl: biz.avatar_url || biz.logo_url || null,
        coverUrl: biz.cover_url || null,
        avatarPosition: typeof branding?.avatar_position === "string" ? branding.avatar_position : "50% 50%",
        coverPosition: typeof branding?.cover_position === "string" ? branding.cover_position : "50% 50%",
        startDate: statsRes.error ? null : (statsRow?.business_start_date ?? null),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const activeBranches = branches.filter((b) => b.is_active);

  return (
    <div className="mb-5">
      <div
        className="h-44 overflow-hidden rounded-[2rem] border border-white/10 shadow-2xl sm:h-60"
        style={{ background: "linear-gradient(90deg, rgb(139 92 246 / 0.6), rgb(79 125 255 / 0.5))" }}
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
      </div>
      <div className="relative z-10 -mt-12 flex flex-col px-4 sm:-mt-14 sm:px-8">
        <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-3xl border-4 border-background bg-white text-3xl font-bold text-zinc-950 shadow-2xl sm:h-32 sm:w-32">
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
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-5xl">{data?.name ?? " "}</h1>
            <span className="inline-grid h-8 w-8 place-items-center sm:h-9 sm:w-9" aria-label="Negocio verificado" title="Negocio verificado">
              <svg viewBox="0 0 24 24" className="h-8 w-8 sm:h-9 sm:w-9 drop-shadow-sm" aria-hidden="true">
                <path
                  d="M12 1.6l1.75 1.52 2.3-.29.99 2.1 2.2.72.07 2.32 1.64 1.63-1.1 2.04.46 2.27-1.94 1.27-.58 2.24-2.29.2-1.5 1.77L12 18.22l-2 1.17-1.5-1.77-2.29-.2-.58-2.24-1.94-1.27.46-2.27-1.1-2.04 1.64-1.63.07-2.32 2.2-.72.99-2.1 2.3.29L12 1.6z"
                  fill="#1DA1F2"
                />
                <path d="M10.45 14.7 6.9 11.15l1.45-1.45 2.1 2.1 5.2-5.2 1.45 1.45-6.65 6.65z" fill="white" />
              </svg>
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 sm:gap-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <div className="flex items-center gap-1" aria-label="5 estrellas" style={{ color: "#F5B301" }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <span className="text-white/90">5,0</span>
            </div>
            <div className="flex items-center gap-2 border-l border-white/[0.14] pl-4 sm:pl-5">
              <div className="whitespace-nowrap text-2xl font-bold leading-none tracking-tight sm:text-3xl">
                {yearsSince(data?.startDate ?? null)}
              </div>
              <div className="text-xs leading-4 text-white/55 sm:text-sm">
                Años de<br />experiencia
              </div>
            </div>
          </div>
          {activeBranches.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-white/50" />
              {activeBranches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setActiveBranchId(b.id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold transition",
                    b.id === activeBranchId
                      ? "bg-gradient-to-r from-sky-400 to-violet-500 text-white"
                      : "bg-white/5 text-white/60 hover:bg-white/10",
                  )}
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
