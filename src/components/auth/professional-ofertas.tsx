import * as React from "react";
import { Briefcase, Building2, MapPin, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { startCardCls, startCardStyle } from "@/components/auth/start-shell";
import { PostingDetails } from "@/components/auth/posting-details";

type Posting = {
  id: string; business_name: string; title: string; zone: string | null; job_type: string;
  description: string | null; contact: string | null; request_status: string | null; schedule?: string | null; instagram?: string | null;
};

const TYPES: Record<string, string> = { tiempo_completo: "Tiempo completo", medio_tiempo: "Medio tiempo", por_turnos: "Por turnos" };

// Ofertas laborales publicadas por las barberías; el profesional se postula con su perfil.
export function ProfessionalOfertas() {
  const [rows, setRows] = React.useState<Posting[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const { data } = await (supabase as any).rpc("list_job_postings");
    setRows((data as Posting[] | null) ?? []);
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  async function apply(p: Posting) {
    setBusy(p.id);
    const { error } = await (supabase as any).rpc("apply_to_posting", { p_posting: p.id });
    setBusy(null);
    if (error) return toast.error(error.message?.includes("perfil_incompleto") ? "Primero guardá tu perfil." : "No se pudo enviar la solicitud.");
    toast.success(`Solicitud enviada a ${p.business_name}`);
    void load();
  }

  if (!rows) return <div className="py-10 text-center text-white/60">Cargando…</div>;
  if (rows.length === 0) return <div className="py-10 text-center text-lg text-white/60">Todavía no hay ofertas publicadas.</div>;

  return (
    <div className="space-y-3">
      {rows.map((p) => {
        const sent = p.request_status === "pending" || p.request_status === "accepted";
        return (
          <div key={p.id} className={`${startCardCls} space-y-3 p-4`} style={startCardStyle}>
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-500/20 text-violet-300">
                <Building2 className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xl font-semibold">{p.title}</div>
                <div className="truncate text-base text-white/60">{p.business_name}</div>
              </div>
            </div>
            <PostingDetails p={p} />
            {p.description && <p className="text-base text-white/75">{p.description}</p>}
            <button
              type="button"
              disabled={sent || busy === p.id}
              onClick={() => void apply(p)}
              className="h-12 w-full rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white shadow-[0_0_22px_-6px_rgba(139,92,246,0.8)] transition active:scale-[0.99] disabled:bg-white/[0.04] disabled:bg-none disabled:text-white/40 disabled:shadow-none"
            >
              {p.request_status === "accepted" ? "Ya sos parte" : sent ? "Solicitud enviada" : busy === p.id ? "Enviando…" : "Enviar solicitud"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
