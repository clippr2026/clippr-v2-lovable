import * as React from "react";
import { Lock } from "lucide-react";
import { FaInstagram, FaWhatsapp } from "react-icons/fa";
import { LocalCard, type Local } from "@/components/auth/local-card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { startCardCls, startCardStyle } from "@/components/auth/start-shell";
import { MyRequestsList } from "@/components/auth/professional-join";

// Pestaña "Mi bolsa": barberías que le enviaron una solicitud y las que envió él. Mostrar u ocultar el perfil se hace
// desde el botón WWW de arriba.
export function ProfessionalBolsa() {
  const [invites, setInvites] = React.useState<Array<Local & { id: string; status: string; whatsapp: string | null }>>([]);

  const loadInvites = React.useCallback(async () => {
    const { data } = await (supabase as any).rpc("my_invitations");
    setInvites((data as Array<Local & { id: string; status: string; whatsapp: string | null }> | null) ?? []);
  }, []);

  React.useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  async function respond(id: string, accept: boolean) {
    const { error } = await (supabase as any).rpc("respond_join_invite", { p_id: id, p_accept: accept });
    if (error) return toast.error("No se pudo responder. Probá de nuevo.");
    toast.success(accept ? "Ya podés hablar con la barbería." : "Rechazaste la solicitud.");
    void loadInvites();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="text-lg font-semibold text-white/85">Barberías que te solicitaron</div>
        {invites.length === 0 && (
          <div className={`${startCardCls} p-4 text-base text-white/60`} style={startCardStyle}>
            Todavía ninguna barbería te solicitó.
          </div>
        )}
        {invites.map((i) => {
          const accepted = i.status === "pending" || i.status === "accepted";
          const wa = (i.whatsapp ?? "").replace(/\D/g, "");
          const ig = (i.instagram ?? "").replace(/^@/, "").trim();
          return (
            <LocalCard
              key={i.id}
              l={i}
              footer={
                accepted ? (
                  <div className="space-y-2">
                    <div className="text-base font-semibold text-emerald-300">Ya podés hablar con la barbería.</div>
                    <div className="flex flex-wrap gap-2">
                      {wa.length >= 8 && (
                        <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-violet-500/15 px-4 text-base font-semibold text-white ring-1 ring-violet-400/40">
                          <FaWhatsapp className="h-5 w-5 text-[#25D366]" /> WhatsApp
                        </a>
                      )}
                      {ig && (
                        <a href={`https://instagram.com/${ig}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-violet-500/15 px-4 text-base font-semibold text-white ring-1 ring-violet-400/40">
                          <FaInstagram className="h-5 w-5 text-[#F0447F]" /> Instagram
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-white/60">
                      <Lock className="h-4 w-4 shrink-0" /> El WhatsApp y el Instagram se desbloquean al aceptar.
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void respond(i.id, true)} className="h-12 flex-1 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white">
                        Aceptar
                      </button>
                      <button type="button" onClick={() => void respond(i.id, false)} className="h-12 rounded-full bg-white/5 px-6 text-base font-semibold text-white/80 ring-1 ring-white/10">
                        Rechazar
                      </button>
                    </div>
                  </div>
                )
              }
            />
          );
        })}
      </div>

      <MyRequestsList />
    </div>
  );
}
