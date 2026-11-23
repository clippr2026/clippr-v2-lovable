import * as React from "react";
import { Briefcase, Building2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Toggle } from "@/components/settings/shared";
import { startCardCls, startCardStyle } from "@/components/auth/start-shell";

// Pestaña "Bolsa de trabajo": el profesional decide si su perfil se muestra a las barberías.
export function ProfessionalBolsa({ userId }: { userId: string }) {
  const [loading, setLoading] = React.useState(true);
  const [hasProfile, setHasProfile] = React.useState(false);
  const [listed, setListed] = React.useState(false);
  const [invites, setInvites] = React.useState<Array<{ id: string; business_name: string }>>([]);

  const loadInvites = React.useCallback(async () => {
    const { data } = await (supabase as any).rpc("my_join_requests");
    const all = (data as Array<{ id: string; business_name: string; initiated_by: string; status: string }> | null) ?? [];
    setInvites(all.filter((r) => r.initiated_by === "business" && r.status === "invited"));
  }, []);

  React.useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  async function respond(id: string, accept: boolean) {
    const { error } = await (supabase as any).rpc("respond_join_invite", { p_id: id, p_accept: accept });
    if (error) return toast.error("No se pudo responder. Probá de nuevo.");
    toast.success(accept ? "Aceptaste. La barbería te va a sumar al equipo." : "Rechazaste la solicitud.");
    void loadInvites();
  }

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
            ? "Tu perfil se muestra en la bolsa de trabajo pública: cualquier persona puede verlo, con tu WhatsApp para que te contacten. Tu fecha de nacimiento y tu correo no se muestran."
            : "Primero guardá tu perfil para poder mostrarlo."}
        </p>
      </div>

      <div className={`${startCardCls} p-4`} style={startCardStyle}>
        <div className="text-lg font-semibold">Barberías que te solicitaron</div>
        {invites.length === 0 ? (
          <p className="mt-1 text-base text-white/60">Todavía ninguna barbería te solicitó.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {invites.map((i) => (
              <div key={i.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-500/20 text-violet-300">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1 truncate text-lg font-semibold">{i.business_name}</div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => void respond(i.id, true)} className="h-11 flex-1 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white">
                    Aceptar
                  </button>
                  <button type="button" onClick={() => void respond(i.id, false)} className="h-11 rounded-full bg-white/5 px-5 text-base font-semibold text-white/80 ring-1 ring-white/10">
                    Rechazar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
