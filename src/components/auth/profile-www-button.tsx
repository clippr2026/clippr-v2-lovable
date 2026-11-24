import * as React from "react";
import { Copy, ExternalLink, Globe, Share2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const LISTED_EVENT = "clippr:perfil-visible-cambio";
const PUBLIC_URL = "https://myclippr.com/bolsa-de-trabajo";

const actionCls =
  "inline-flex items-center justify-center gap-2 rounded-2xl bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-white/90 ring-1 ring-white/10 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-45";

// Botón "WWW" del encabezado del profesional: mismo estilo que el "Sitio Web Público" del negocio, pero para mostrar
// u ocultar su perfil en la bolsa de trabajo pública.
export function ProfileWwwButton({ userId }: { userId: string }) {
  const [hasProfile, setHasProfile] = React.useState(false);
  const [listed, setListed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    const { data } = await (supabase as any).from("professional_profiles").select("is_listed").eq("user_id", userId).maybeSingle();
    setHasProfile(Boolean(data));
    setListed(Boolean((data as { is_listed?: boolean } | null)?.is_listed));
  }, [userId]);

  React.useEffect(() => {
    void load();
    const onChange = (e: Event) => setListed(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(LISTED_EVENT, onChange);
    return () => window.removeEventListener(LISTED_EVENT, onChange);
  }, [load]);

  async function toggle() {
    if (!hasProfile) return toast.error("Primero guardá tu perfil.");
    const next = !listed;
    setSaving(true);
    setListed(next);
    const { error } = await (supabase as any).from("professional_profiles").update({ is_listed: next }).eq("user_id", userId);
    setSaving(false);
    if (error) {
      setListed(!next);
      return toast.error("No se pudo cambiar. Probá de nuevo.");
    }
    window.dispatchEvent(new CustomEvent(LISTED_EVENT, { detail: next }));
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(PUBLIC_URL);
      toast.success("Link copiado");
    } catch {
      toast.error("No se pudo copiar el link");
    }
  }

  async function share() {
    const nav = navigator as Navigator & { share?: (d: { title?: string; url?: string }) => Promise<void> };
    if (typeof nav.share === "function") {
      try {
        await nav.share({ title: "Bolsa de trabajo", url: PUBLIC_URL });
      } catch {
        /* canceló */
      }
      return;
    }
    await copyLink();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Mostrar mi perfil" className="inline-flex h-10 items-center rounded-xl glass glass-hover px-2.5 text-white/85 transition active:scale-[0.96] hover:text-white">
          <span className="relative grid h-5 w-5 place-items-center">
            <Globe className="h-[18px] w-[18px]" />
            <span className="absolute -bottom-1 -left-1 rounded-full border-2 border-black bg-emerald-400 px-1 py-[1px] text-[6px] font-black leading-none tracking-[-0.02em] text-white">WWW</span>
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" collisionPadding={16} className="w-[calc(100vw-2rem)] rounded-3xl border-white/10 bg-[oklch(0.10_0.025_265/0.98)] p-5 shadow-2xl shadow-black/40 backdrop-blur-xl sm:w-[430px]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Globe className="h-6 w-6 shrink-0 text-white/65" />
            <div className="min-w-0 truncate text-lg font-semibold leading-tight text-white">Mostrar mi perfil</div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void toggle()}
            className={[
              "inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-1 text-sm font-semibold ring-1 transition hover:brightness-110 disabled:opacity-60",
              listed ? "bg-emerald-500/12 text-emerald-200 ring-emerald-500/35" : "bg-amber-500/12 text-amber-200 ring-amber-500/35",
            ].join(" ")}
          >
            <span className={["relative h-7 w-12 shrink-0 rounded-full ring-1 transition", listed ? "bg-emerald-500/25 ring-emerald-400/35" : "bg-amber-500/25 ring-amber-400/35"].join(" ")}>
              <span className={["absolute top-1 h-5 w-5 rounded-full shadow-lg transition-all", listed ? "left-6 bg-emerald-300" : "left-1 bg-amber-300"].join(" ")} />
            </span>
            <span className="whitespace-nowrap">{listed ? "Online" : "Oculto"}</span>
          </button>
        </div>
        <div className="mt-0.5 pl-8 text-xs text-white/45">Bolsa de trabajo</div>

        <div className="mt-3 break-all text-base text-white/55">myclippr.com/bolsa-de-trabajo</div>

        <div className="mt-4 rounded-2xl bg-white/[0.035] p-3 text-xs leading-relaxed text-white/50 ring-1 ring-white/10">
          {!hasProfile
            ? "Primero guardá tu perfil para poder mostrarlo."
            : listed
              ? "Tu perfil se mostrará en la bolsa de trabajo pública para que te contacten."
              : "Tu perfil no se muestra en la bolsa de trabajo pública."}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <button type="button" onClick={() => void copyLink()} className={actionCls}>
            <Copy className="h-5 w-5" />
            Copiar
          </button>
          <button type="button" onClick={() => void share()} className={actionCls}>
            <Share2 className="h-5 w-5" />
            Compartir
          </button>
          <button type="button" onClick={() => window.open(PUBLIC_URL, "_blank", "noopener")} className={actionCls}>
            <ExternalLink className="h-5 w-5" />
            Abrir
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
