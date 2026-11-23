import * as React from "react";
import { Briefcase } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Toggle } from "@/components/settings/shared";
import { startCardCls, startCardStyle } from "@/components/auth/start-shell";

// Pestaña "Bolsa de trabajo": el profesional decide si su perfil se muestra a las barberías.
export function ProfessionalBolsa({ userId }: { userId: string }) {
  const [loading, setLoading] = React.useState(true);
  const [hasProfile, setHasProfile] = React.useState(false);
  const [listed, setListed] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      const { data } = await (supabase as any).from("professional_profiles").select("is_listed").eq("user_id", userId).maybeSingle();
      setHasProfile(Boolean(data));
      setListed(Boolean((data as { is_listed?: boolean } | null)?.is_listed));
      setLoading(false);
    })();
  }, [userId]);

  async function toggle(next: boolean) {
    setListed(next);
    const { error } = await (supabase as any).from("professional_profiles").update({ is_listed: next }).eq("user_id", userId);
    if (error) {
      setListed(!next);
      toast.error("No se pudo cambiar. Probá de nuevo.");
    }
  }

  if (loading) return <div className="py-10 text-center text-white/60">Cargando…</div>;

  return (
    <div className="space-y-4">
      <div className={`${startCardCls} p-4`} style={startCardStyle}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3 text-xl font-semibold">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-500/20 text-violet-300">
              <Briefcase className="h-5 w-5" />
            </span>
            Mostrar mi perfil
          </div>
          <Toggle on={listed} onChange={(v) => void toggle(v)} />
        </div>
        <p className="mt-3 text-base text-white/60">
          {hasProfile
            ? "Las barberías van a poder ver tu perfil en la bolsa de trabajo y solicitarte."
            : "Primero guardá tu perfil para poder mostrarlo."}
        </p>
      </div>

      <div className={`${startCardCls} p-4`} style={startCardStyle}>
        <div className="text-lg font-semibold">Barberías que te solicitaron</div>
        <p className="mt-1 text-base text-white/60">Todavía ninguna barbería te solicitó.</p>
      </div>
    </div>
  );
}
