import * as React from "react";
import { MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type HeroData = {
  name: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  avatarPosition: string;
  coverPosition: string;
};

// Encabezado de Inicio: portada con luz, foto de perfil y nombre del negocio
// centrados, con las mismas imágenes y encuadres que la página pública.
export function NegocioHero({ businessId }: { businessId: string | null }) {
  const { branches, activeBranchId, setActiveBranchId } = useAuth();
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

  const activeBranches = branches.filter((b) => b.is_active);

  return (
    <div className="mb-5">
      <div className="relative">
        {/* Luz detrás de la portada */}
        <div
          className="pointer-events-none absolute -inset-3 -z-10 rounded-[2.5rem] opacity-70 blur-2xl sm:-inset-5"
          style={{
            background:
              "radial-gradient(60% 90% at 25% 40%, rgb(139 92 246 / 0.55), transparent 70%), radial-gradient(60% 90% at 78% 55%, rgb(236 72 153 / 0.40), transparent 70%), radial-gradient(50% 80% at 50% 100%, rgb(56 189 248 / 0.35), transparent 70%)",
          }}
        />
        <div
          className="relative h-44 overflow-hidden rounded-[2rem] border border-white/20 sm:h-60"
          style={{
            background: "linear-gradient(90deg, rgb(139 92 246 / 0.6), rgb(79 125 255 / 0.5))",
            boxShadow:
              "0 0 0 1px rgb(255 255 255 / 0.06), 0 0 34px rgb(139 92 246 / 0.45), 0 0 80px rgb(236 72 153 / 0.22), 0 18px 50px rgb(0 0 0 / 0.5)",
          }}
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
          <div className="pointer-events-none absolute inset-0 rounded-[2rem] bg-[linear-gradient(180deg,rgb(255_255_255/0.08),transparent_28%,transparent_55%,rgb(0_0_0/0.35))]" />
          {/* Sombra interior de color (violeta, azul y rosa de la app) */}
          <div
            className="pointer-events-none absolute inset-0 rounded-[2rem]"
            style={{
              boxShadow:
                "inset 0 0 60px 6px rgb(139 92 246 / 0.55), inset 0 0 120px rgb(79 125 255 / 0.35), inset 0 -50px 70px rgb(236 72 153 / 0.30)",
            }}
          />
        </div>
      </div>
      <div className="relative z-10 -mt-12 flex flex-col items-center px-4 text-center sm:-mt-14 sm:px-8">
        {/* Aro de neón alrededor de la foto: sirve para cualquier logo, también los de fondo oscuro */}
        <div
          className="rounded-[1.7rem] p-[3px] sm:rounded-[1.9rem]"
          style={{
            background: "linear-gradient(135deg, #38bdf8, #8b5cf6 50%, #ec4899)",
            boxShadow:
              "0 0 10px rgb(139 92 246 / 0.9), 0 0 26px rgb(139 92 246 / 0.65), 0 0 56px rgb(236 72 153 / 0.4), 0 0 80px rgb(56 189 248 / 0.25)",
          }}
        >
          <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-[1.45rem] bg-white text-3xl font-bold text-zinc-950 sm:h-32 sm:w-32 sm:rounded-[1.65rem]">
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
        </div>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-5xl">{data?.name ?? " "}</h1>
        {activeBranches.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
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
  );
}
