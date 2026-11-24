import * as React from "react";
import { createPortal } from "react-dom";
import { Lock } from "lucide-react";
import { FaInstagram, FaWhatsapp } from "react-icons/fa";
import { toast } from "sonner";
import { LocalCard, type Local } from "@/components/auth/local-card";
import { supabase } from "@/integrations/supabase/client";
import { startCardCls, startCardStyle } from "@/components/auth/start-shell";
import { cn } from "@/lib/utils";

type Row = Local & {
  id: string;
  source: "join" | "rental";
  motive: "oferta" | "alquiler" | "invitacion";
  state: "recibida" | "enviada" | "contacto";
  posting_title: string | null;
  whatsapp: string | null;
};

const MOTIVE: Record<Row["motive"], { label: string; cls: string }> = {
  oferta: { label: "Oferta laboral", cls: "bg-sky-400/15 text-sky-200 ring-sky-300/30" },
  alquiler: { label: "Alquiler de puesto", cls: "bg-amber-400/15 text-amber-200 ring-amber-300/30" },
  invitacion: { label: "Invitación profesional", cls: "bg-violet-400/20 text-violet-100 ring-violet-300/40" },
};

const TABS = [
  ["recibida", "Recibidas"],
  ["enviada", "Enviadas"],
  ["contacto", "Contactos"],
] as const;

const EMPTY: Record<Row["state"], string> = {
  recibida: "Todavía no recibiste invitaciones.",
  enviada: "No tenés solicitudes enviadas esperando respuesta.",
  contacto: "Todavía no tenés contactos. Cuando se acepte una solicitud, aparece acá.",
};

// Pestaña "Mi actividad": invitaciones recibidas, postulaciones y pedidos de alquiler enviados, y contactos aceptados.
// Aceptar no confirma una contratación ni un alquiler: solo habilita el contacto entre las partes.
export function ProfessionalActividad() {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [tab, setTab] = React.useState<Row["state"]>("recibida");
  const [confirm, setConfirm] = React.useState<Row | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const { data } = await (supabase as any).rpc("my_activity");
    setRows((data as Row[] | null) ?? []);
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  async function respond(r: Row, accept: boolean) {
    setBusy(true);
    const { error } = await (supabase as any).rpc("respond_join_invite", { p_id: r.id, p_accept: accept });
    setBusy(false);
    setConfirm(null);
    if (error) return toast.error("No se pudo responder. Probá de nuevo.");
    toast.success(accept ? "Listo, ya está en Contactos." : "Rechazaste la invitación.");
    if (accept) setTab("contacto");
    void load();
  }

  async function cancel(r: Row) {
    if (!window.confirm("¿Cancelar esta solicitud?")) return;
    setBusy(true);
    const { error } = await (supabase as any).rpc("cancel_my_request", { p_source: r.source, p_id: r.id });
    setBusy(false);
    if (error) return toast.error("No se pudo cancelar. Probá de nuevo.");
    toast.success("Solicitud cancelada.");
    void load();
  }

  const counts = (s: Row["state"]) => (rows ?? []).filter((r) => r.state === s).length;
  const list = (rows ?? []).filter((r) => r.state === tab);

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {TABS.map(([id, label]) => {
          const n = counts(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn("h-10 flex-1 rounded-full text-base font-semibold transition", tab === id ? "bg-violet-500/30 text-white ring-1 ring-violet-300/50" : "bg-white/[0.06] text-white/65")}
            >
              {label}
              {n > 0 ? ` ${n}` : ""}
            </button>
          );
        })}
      </div>

      {tab === "recibida" && <div className="text-lg font-semibold text-white/85">Invitaciones recibidas</div>}

      {rows === null && <div className="py-8 text-center text-white/60">Cargando…</div>}
      {rows !== null && list.length === 0 && (
        <div className={`${startCardCls} p-4 text-base text-white/60`} style={startCardStyle}>
          {EMPTY[tab]}
        </div>
      )}

      {list.map((r) => {
        const m = MOTIVE[r.motive];
        const wa = (r.whatsapp ?? "").replace(/\D/g, "");
        const ig = (r.instagram ?? "").replace(/^@/, "").trim();
        return (
          <LocalCard
            key={`${r.source}-${r.id}`}
            l={r}
            footer={
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ring-1 ${m.cls}`}>{m.label}</span>
                </div>

                {r.state === "recibida" && (
                  <>
                    <div className="flex items-center gap-2 text-sm text-white/60">
                      <Lock className="h-4 w-4 shrink-0" /> El WhatsApp y el Instagram se desbloquean al aceptar.
                    </div>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={() => setConfirm(r)} className="h-12 flex-1 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white disabled:opacity-60">
                        Aceptar
                      </button>
                      <button type="button" disabled={busy} onClick={() => void respond(r, false)} className="h-12 rounded-full bg-white/5 px-6 text-base font-semibold text-white/80 ring-1 ring-white/10 disabled:opacity-60">
                        Rechazar
                      </button>
                    </div>
                  </>
                )}

                {r.state === "enviada" && (
                  <div className="grid grid-cols-2 gap-2">
                    <span className="grid h-12 place-items-center whitespace-nowrap rounded-full bg-amber-400/15 px-2 text-[15px] font-semibold text-amber-200 ring-1 ring-amber-300/30">Pendiente de respuesta</span>
                    <button type="button" disabled={busy} onClick={() => void cancel(r)} className="h-12 whitespace-nowrap rounded-full bg-white/5 px-2 text-[15px] font-semibold text-white/80 ring-1 ring-white/10 disabled:opacity-60">
                      Cancelar solicitud
                    </button>
                  </div>
                )}

                {r.state === "contacto" && (
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
                    {wa.length < 8 && !ig && <span className="text-sm text-white/60">Este local todavía no cargó sus datos de contacto.</span>}
                  </div>
                )}
              </div>
            }
          />
        );
      })}

      {confirm &&
        createPortal(
          <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-5" onClick={() => setConfirm(null)}>
            <div className={`${startCardCls} w-full max-w-sm space-y-4 bg-[#0b0818] p-5`} style={startCardStyle} onClick={(e) => e.stopPropagation()}>
              <div className="text-xl font-semibold">Aceptar invitación</div>
              <p className="text-base text-white/80">Al aceptar, ambos podrán ver sus datos de contacto.</p>
              <p className="text-sm text-white/50">Aceptar no confirma una contratación ni un alquiler: Clippr solo facilita el contacto entre las partes.</p>
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => void respond(confirm, true)} className="h-12 flex-1 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white disabled:opacity-60">
                  Aceptar
                </button>
                <button type="button" onClick={() => setConfirm(null)} className="h-12 rounded-full bg-white/5 px-6 text-base font-semibold text-white/80 ring-1 ring-white/10">
                  Cancelar
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
