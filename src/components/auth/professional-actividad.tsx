import * as React from "react";
import { createPortal } from "react-dom";
import { Lock, Trash2 } from "lucide-react";
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
  oferta: { label: "Te postulaste", cls: "bg-violet-400/20 text-violet-100 ring-violet-300/40" },
  alquiler: { label: "Solicitaste", cls: "bg-violet-400/20 text-violet-100 ring-violet-300/40" },
  invitacion: { label: "Te invitaron", cls: "bg-violet-400/20 text-violet-100 ring-violet-300/40" },
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


// Contenedor que deja deslizar la tarjeta a la izquierda para pedir su eliminación.
function SwipeToDelete({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const [dx, setDx] = React.useState(0);
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const horizontal = React.useRef(false);
  return (
    <div className="relative overflow-hidden rounded-[28px]">
      <div className="absolute inset-0 flex items-center justify-end rounded-[28px] bg-rose-500/80 pr-8 text-white">
        <span className="flex items-center gap-2 text-lg font-semibold">
          <Trash2 className="h-6 w-6" /> Eliminar
        </span>
      </div>
      <div
        className="relative rounded-[28px] bg-[#070512]"
        style={{ transform: `translateX(${dx}px)`, transition: start.current ? "none" : "transform .2s ease", touchAction: "pan-y" }}
        onTouchStart={(e) => {
          start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          horizontal.current = false;
        }}
        onTouchMove={(e) => {
          if (!start.current) return;
          const mx = e.touches[0].clientX - start.current.x;
          const my = e.touches[0].clientY - start.current.y;
          if (!horizontal.current && Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) horizontal.current = true;
          if (horizontal.current) setDx(Math.max(-140, Math.min(0, mx)));
        }}
        onTouchEnd={() => {
          const trigger = dx < -90;
          start.current = null;
          setDx(0);
          if (trigger) onDelete();
        }}
        onTouchCancel={() => {
          start.current = null;
          setDx(0);
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Pestaña "Mi actividad": invitaciones recibidas, postulaciones y pedidos de alquiler enviados, y contactos aceptados.
// Aceptar no confirma una contratación ni un alquiler: solo habilita el contacto entre las partes.
export function ProfessionalActividad() {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [tab, setTab] = React.useState<Row["state"]>("recibida");
  const [confirm, setConfirm] = React.useState<Row | null>(null);
  const [delRow, setDelRow] = React.useState<Row | null>(null);
  const [cancelRow, setCancelRow] = React.useState<{ row: Row; kind: "cancel" | "reject" } | null>(null);
  const [blocked, setBlocked] = React.useState<Array<{ business_id: string; name: string }>>([]);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const { data } = await (supabase as any).rpc("my_activity");
    setRows((data as Row[] | null) ?? []);
    const b = await (supabase as any).rpc("my_blocked_businesses");
    setBlocked((b.data as Array<{ business_id: string; name: string }> | null) ?? []);
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
    setBusy(true);
    const { error } = await (supabase as any).rpc("cancel_my_request", { p_source: r.source, p_id: r.id });
    setBusy(false);
    setCancelRow(null);
    if (error) return toast.error("No se pudo cancelar. Probá de nuevo.");
    toast.success("Solicitud cancelada.");
    void load();
  }

  async function rejectInvite(r: Row, alsoBlock: boolean) {
    setBusy(true);
    const { error } = alsoBlock
      ? await (supabase as any).rpc("block_business", { p_source: r.source, p_id: r.id })
      : await (supabase as any).rpc("respond_join_invite", { p_id: r.id, p_accept: false });
    setBusy(false);
    setCancelRow(null);
    if (error) return toast.error("No se pudo completar. Probá de nuevo.");
    toast.success(alsoBlock ? `Rechazaste y bloqueaste a ${r.name}.` : "Rechazaste la invitación.");
    void load();
  }

  async function removeContact(r: Row) {
    setBusy(true);
    const { error } = await (supabase as any).rpc("remove_my_contact", { p_source: r.source, p_id: r.id });
    setBusy(false);
    setDelRow(null);
    if (error) {
      return toast.error(
        (error.message ?? "").includes("es_parte_del_equipo")
          ? "Sos parte del equipo de este local. Pedile que te desvincule."
          : "No se pudo eliminar. Probá de nuevo.",
      );
    }
    toast.success("Contacto eliminado.");
    void load();
  }

  async function unblock(businessId: string) {
    const { error } = await (supabase as any).rpc("unblock_business", { p_business: businessId });
    if (error) return toast.error("No se pudo desbloquear. Probá de nuevo.");
    toast.success("Local desbloqueado.");
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
      {tab === "contacto" && list.length > 0 && <div className="text-sm text-white/50">Deslizá una tarjeta a la izquierda para eliminar el contacto.</div>}

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
        const card = (
          <LocalCard
            l={r}
            footer={
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex rounded-full bg-violet-400/20 px-3 py-1 text-sm font-semibold text-violet-100 ring-1 ring-violet-300/40">
                    {r.motive === "alquiler" ? "Alquiler de puesto" : "Oportunidad laboral"}
                  </span>
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
                      <button type="button" disabled={busy} onClick={() => setCancelRow({ row: r, kind: "reject" })} className="h-12 rounded-full bg-white/5 px-6 text-base font-semibold text-white/80 ring-1 ring-white/10 disabled:opacity-60">
                        Rechazar
                      </button>
                    </div>
                  </>
                )}

                {r.state === "enviada" && (
                  <div className="space-y-3">
                    <div className="flex justify-center">
                      <button type="button" disabled={busy} onClick={() => setCancelRow({ row: r, kind: "cancel" })} className="h-10 w-4/5 rounded-full bg-rose-500/15 px-6 text-sm font-semibold text-rose-200 ring-1 ring-rose-400/40 disabled:opacity-60">
                        Cancelar solicitud
                      </button>
                    </div>
                  </div>
                )}

                {r.state === "contacto" && (
                  <div className="flex flex-wrap justify-center gap-2">
                    {wa.length >= 8 && (
                      <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-emerald-500/20 px-4 text-base font-semibold text-white ring-1 ring-emerald-400/50">
                        <FaWhatsapp className="h-5 w-5 text-[#25D366]" /> WhatsApp
                      </a>
                    )}
                    {ig && (
                      <a href={`https://instagram.com/${ig}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-rose-500/20 px-4 text-base font-semibold text-white ring-1 ring-rose-400/50">
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
        return r.state === "contacto" ? (
          <SwipeToDelete key={`${r.source}-${r.id}`} onDelete={() => setDelRow(r)}>
            {card}
          </SwipeToDelete>
        ) : (
          <React.Fragment key={`${r.source}-${r.id}`}>{card}</React.Fragment>
        );
      })}

      {blocked.length > 0 && tab === "recibida" && (
        <div className="space-y-2 pt-2">
          <div className="text-base font-semibold text-white/60">Locales bloqueados</div>
          {blocked.map((k) => (
            <div key={k.business_id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <span className="min-w-0 truncate text-base font-semibold">{k.name}</span>
              <button type="button" onClick={() => void unblock(k.business_id)} className="h-10 shrink-0 rounded-full bg-white/5 px-4 text-sm font-semibold text-white/80 ring-1 ring-white/10">
                Desbloquear
              </button>
            </div>
          ))}
        </div>
      )}

      {cancelRow &&
        createPortal(
          <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-5" onClick={() => setCancelRow(null)}>
            <div className="w-full max-w-sm space-y-3 rounded-2xl border border-violet-400/30 p-5 shadow-2xl" style={{ ...startCardStyle, backgroundColor: "#0b0818" }} onClick={(e) => e.stopPropagation()}>
              <div className="text-xl font-semibold">{cancelRow.row.name}</div>
              <p className="text-base text-white/70">{cancelRow.kind === "cancel" ? "¿Querés cancelar esta solicitud?" : "¿Qué querés hacer con esta invitación?"}</p>
              {cancelRow.kind === "cancel" ? (
                <button type="button" disabled={busy} onClick={() => void cancel(cancelRow.row)} className="h-12 w-full rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white disabled:opacity-60">
                  Cancelar solicitud
                </button>
              ) : (
                <>
                  <button type="button" disabled={busy} onClick={() => void rejectInvite(cancelRow.row, false)} className="h-12 w-full rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white disabled:opacity-60">
                    Rechazar
                  </button>
                  <button type="button" disabled={busy} onClick={() => void rejectInvite(cancelRow.row, true)} className="h-12 w-full rounded-full bg-rose-500/15 text-base font-semibold text-rose-200 ring-1 ring-rose-400/40 disabled:opacity-60">
                    Rechazar y bloquear
                  </button>
                  <p className="text-xs text-white/45">Si bloqueás, este local no podrá invitarte ni verte en su lista. Podés desbloquearlo cuando quieras.</p>
                </>
              )}
              <button type="button" onClick={() => setCancelRow(null)} className="h-12 w-full rounded-full bg-white/5 text-base font-semibold text-white/80 ring-1 ring-white/10">
                Salir
              </button>
            </div>
          </div>,
          document.body,
        )}

      {delRow &&
        createPortal(
          <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-5" onClick={() => setDelRow(null)}>
            <div className="w-full max-w-sm space-y-3 rounded-2xl border border-violet-400/30 p-5 shadow-2xl" style={{ ...startCardStyle, backgroundColor: "#0b0818" }} onClick={(e) => e.stopPropagation()}>
              <div className="text-xl font-semibold">Eliminar contacto</div>
              <p className="text-base text-white/75">¿Eliminar a {delRow.name} de tus contactos? Dejarás de ver sus datos de contacto.</p>
              <button type="button" disabled={busy} onClick={() => void removeContact(delRow)} className="h-12 w-full rounded-full bg-rose-500/15 text-base font-semibold text-rose-200 ring-1 ring-rose-400/40 disabled:opacity-60">
                Eliminar
              </button>
              <button type="button" onClick={() => setDelRow(null)} className="h-12 w-full rounded-full bg-white/5 text-base font-semibold text-white/80 ring-1 ring-white/10">
                Salir
              </button>
            </div>
          </div>,
          document.body,
        )}

      {confirm &&
        createPortal(
          <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-5" onClick={() => setConfirm(null)}>
            <div className="w-full max-w-sm space-y-4 rounded-2xl border border-violet-400/30 p-5 shadow-2xl" style={{ ...startCardStyle, backgroundColor: "#0b0818" }} onClick={(e) => e.stopPropagation()}>
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
