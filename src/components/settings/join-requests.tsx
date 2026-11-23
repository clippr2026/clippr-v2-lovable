import * as React from "react";
import { createPortal } from "react-dom";
import { Cake, Copy, Info, Instagram, KeyRound, MapPin, MessageCircle, RefreshCw, Star, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { BolsaTabs, type BolsaTab } from "@/components/settings/bolsa-tabs";

export type JoinRequest = {
  id: string;
  user_id: string;
  initiated_by: string;
  status: string;
  created_at: string;
  full_name: string;
  avatar_url: string | null;
  zone: string | null;
  experience_since: string | null;
  specialties: string[] | null;
  bio: string | null;
  instagram: string | null;
  nationality: string | null;
  photos: string[] | null;
  whatsapp: string | null;
  birth_date: string | null;
  reviews_count: number;
  reviews_avg: number | null;
};

const cardStyle: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(110% 90% at 100% 0%, rgba(79,125,255,.16), transparent 62%), radial-gradient(90% 80% at 0% 100%, rgba(139,92,246,.12), transparent 65%)",
};

function yearsSince(date: string | null): number | null {
  if (!date) return null;
  const years = (Date.now() - new Date(date).getTime()) / (365.25 * 24 * 3600 * 1000);
  return years >= 0 ? Math.floor(years) : null;
}

// Panel "Postulaciones" de la Bolsa de trabajo: quienes se postularon o aceptaron una solicitud.
export function PostulacionesPanel({
  onAccept,
  refreshKey,
  open = false,
  onClose = () => {},
  onSelectTab,
  inline = false,
}: {
  onAccept: (req: JoinRequest) => void;
  refreshKey: number;
  open?: boolean;
  onClose?: () => void;
  onSelectTab: (t: BolsaTab) => void;
  inline?: boolean;
}) {
  const { businessId } = useAuth();
  const [rows, setRows] = React.useState<JoinRequest[]>([]);
  const [busy, setBusy] = React.useState(false);
  const setOpen = (v: boolean) => {
    if (!v) onClose();
  };
  const wrap = (n: React.ReactNode, _t?: unknown) => (inline ? n : createPortal(n, document.body));

  const load = React.useCallback(async () => {
    if (!businessId) return;
    const { data } = await (supabase as any).rpc("business_join_requests", { p_business: businessId });
    setRows((data as JoinRequest[] | null) ?? []);
  }, [businessId]);
  React.useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function decide(id: string, action: "reject" | "block" | "unblock") {
    if (action === "block" && !window.confirm("¿Bloquear a esta persona? No va a poder volver a pedir unirse.")) return;
    setBusy(true);
    const { error } = await (supabase as any).rpc("decide_join_request", { p_id: id, p_action: action });
    setBusy(false);
    if (error) return toast.error("No se pudo completar la acción");
    void load();
  }

  const pending = rows.filter((r) => r.status === "pending");
  const blocked = rows.filter((r) => r.status === "blocked");
  const invited = rows.filter((r) => r.status === "invited");

  return (
    <>
      {(open || inline) &&
        typeof document !== "undefined" &&
        wrap(
          <div
            className={inline ? "" : "fixed inset-0 z-[9999] flex items-start justify-center overflow-hidden bg-black/85 p-4 pt-[calc(24px+env(safe-area-inset-top,0px))] pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] lg:pb-4"}
            onClick={() => setOpen(false)}
          >
            <div
              className={inline ? "flex w-full flex-col overflow-hidden rounded-2xl bg-[oklch(0.12_0.02_275)] ring-1 ring-white/10" : "relative flex max-h-[calc(100dvh-24px-env(safe-area-inset-top,0px)-0.25rem-env(safe-area-inset-bottom,0px))] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-[oklch(0.12_0.02_275)] shadow-2xl ring-1 ring-white/10"}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={inline ? "hidden" : "flex shrink-0 items-center justify-between border-b border-white/5 px-5 py-4"}>
                <h3 className="font-display text-lg font-semibold">Bolsa de trabajo</h3>
                <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="-mr-2 grid h-12 w-12 place-items-center rounded-full text-white/80">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <BolsaTabs active="postulaciones" onSelect={onSelectTab} pending={pending.length} />
              <div className={inline ? "space-y-3 px-3.5 py-3" : "min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3"}>
                {pending.length === 0 && <div className="py-10 text-center text-lg text-white/60">Todavía nadie se postuló ni aceptó una solicitud.</div>}
                {pending.map((r) => {
                  const years = yearsSince(r.experience_since);
                  const age = yearsSince(r.birth_date);
                  return (
                    <div key={r.id} className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4" style={cardStyle}>
                      <div className="flex items-center gap-3">
                        <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/20 text-xl font-semibold ring-2 ring-violet-400/40">
                          {r.avatar_url ? <img src={r.avatar_url} alt={r.full_name} className="h-full w-full object-cover" /> : (r.full_name[0] || "?").toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xl font-semibold">{r.full_name}</div>
                          <div className="flex items-center gap-1 text-base text-white/60">
                            <Star className="h-4 w-4 text-amber-300" />
                            {r.reviews_count > 0 ? `${r.reviews_avg} (${r.reviews_count} reseñas)` : "Sin reseñas todavía"}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-base text-white/70">
                        {r.zone && (
                          <span className="inline-flex items-center gap-1.5">
                            <MapPin className="h-4 w-4 text-violet-300" />
                            {r.zone}
                          </span>
                        )}
                        {age !== null && (
                          <span className="inline-flex items-center gap-1.5">
                            <Cake className="h-4 w-4 text-violet-300" />
                            {age} años
                          </span>
                        )}
                        {years !== null && <span>{years} años en el rubro</span>}
                        {r.nationality && <span>{r.nationality}</span>}
                      </div>
                      {r.specialties && r.specialties.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {r.specialties.map((s) => (
                            <span key={s} className="rounded-full bg-violet-500/15 px-3 py-1 text-sm font-semibold text-violet-100 ring-1 ring-violet-400/30">
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                      {r.bio && <p className="text-base text-white/75">{r.bio}</p>}
                      {r.photos && r.photos.length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                          {r.photos.map((u) => (
                            <img key={u} src={u} alt="Trabajo" className="aspect-square w-full rounded-xl object-cover ring-1 ring-white/15" />
                          ))}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {r.whatsapp && (
                          <a
                            href={`https://wa.me/${r.whatsapp.replace(/\D/g, "")}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-10 items-center gap-2 rounded-full bg-emerald-500/15 px-4 text-sm font-semibold text-emerald-200 ring-1 ring-emerald-400/30"
                          >
                            <MessageCircle className="h-4 w-4" />
                            WhatsApp
                          </a>
                        )}
                        {r.instagram && (
                          <a
                            href={`https://instagram.com/${r.instagram}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-10 items-center gap-2 rounded-full bg-white/5 px-4 text-sm font-semibold text-white/80 ring-1 ring-white/10"
                          >
                            <Instagram className="h-4 w-4" />@{r.instagram}
                          </a>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setOpen(false);
                            onAccept(r);
                          }}
                          className="h-12 flex-1 rounded-2xl bg-gradient-to-r from-sky-400 to-violet-500 text-base font-bold text-white shadow-[0_6px_22px_-4px_rgba(124,92,255,0.9)] transition active:scale-95 disabled:opacity-50"
                        >
                          Aceptar
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void decide(r.id, "reject")}
                          className="h-12 rounded-2xl bg-white/5 px-4 text-base font-semibold text-white/80 ring-1 ring-white/10 disabled:opacity-50"
                        >
                          Eliminar
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void decide(r.id, "block")}
                          className="h-12 rounded-2xl border border-red-400/50 bg-red-500/25 px-4 text-base font-bold text-red-100 disabled:opacity-50"
                        >
                          Bloquear
                        </button>
                      </div>
                    </div>
                  );
                })}

                {invited.length > 0 && (
                  <div className="pt-2">
                    <div className="mb-2 text-base font-semibold text-white/60">Esperando respuesta</div>
                    {invited.map((r) => (
                      <div key={r.id} className="mb-2 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                        <span className="min-w-0 truncate text-base font-semibold">{r.full_name}</span>
                        <span className="shrink-0 rounded-full bg-amber-400/15 px-3 py-1 text-sm font-semibold text-amber-200 ring-1 ring-amber-300/30">Enviada</span>
                      </div>
                    ))}
                  </div>
                )}

                {blocked.length > 0 && (
                  <div className="pt-2">
                    <div className="mb-2 text-base font-semibold text-white/60">Bloqueados</div>
                    {blocked.map((r) => (
                      <div key={r.id} className={cn("mb-2 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3")}>
                        <span className="min-w-0 truncate text-base font-semibold">{r.full_name}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void decide(r.id, "unblock")}
                          className="h-10 shrink-0 rounded-full bg-white/5 px-4 text-sm font-semibold text-white/80 ring-1 ring-white/10"
                        >
                          Desbloquear
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>,
        )}
    </>
  );
}

// Tarjeta con el código del negocio y, debajo, las solicitudes que llegaron con ese código.
export function JoinCodeAndRequests({ onAccept, refreshKey }: { onAccept: (req: JoinRequest) => void; refreshKey: number }) {
  const { businessId } = useAuth();
  const [code, setCode] = React.useState<string>("");
  const [rows, setRows] = React.useState<JoinRequest[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [infoOpen, setInfoOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!businessId) return;
    const [biz, reqs] = await Promise.all([
      (supabase as any).from("businesses").select("join_code").eq("id", businessId).maybeSingle(),
      (supabase as any).rpc("business_join_requests", { p_business: businessId }),
    ]);
    setCode(((biz.data as { join_code?: string } | null)?.join_code as string) ?? "");
    setRows((reqs.data as JoinRequest[] | null) ?? []);
  }, [businessId]);
  React.useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function regenerate() {
    if (!businessId) return;
    if (!window.confirm("¿Generar un código nuevo? El código anterior deja de funcionar.")) return;
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("regenerate_join_code", { p_business: businessId });
    setBusy(false);
    if (error) return toast.error("No se pudo generar el código");
    setCode(data as string);
  }

  async function reject(id: string) {
    setBusy(true);
    const { error } = await (supabase as any).rpc("decide_join_request", { p_id: id, p_action: "reject" });
    setBusy(false);
    if (error) return toast.error("No se pudo completar la acción");
    void load();
  }

  // Solo las que llegaron por el código (las que la persona inició).
  const pending = rows.filter((r) => r.status === "pending" && r.initiated_by === "professional");

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4" style={cardStyle}>
      <div className="flex items-center gap-3 text-lg font-semibold">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-400/25 text-violet-300">
          <KeyRound className="h-5 w-5" />
        </span>
        <span className="flex-1">Código del negocio</span>
        <button
          type="button"
          aria-label="Información sobre el código"
          aria-expanded={infoOpen}
          onClick={() => setInfoOpen((v) => !v)}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/5 text-violet-200 ring-1 ring-white/10"
        >
          <Info className="h-5 w-5" />
        </button>
      </div>
      {infoOpen && (
        <p className="mt-3 rounded-2xl bg-black/25 px-4 py-3 text-base text-white/75">
          Pasale este código al profesional. Lo escribe en "Unirme" y su solicitud te llega acá para aceptarla o rechazarla.
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <div className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-center text-3xl font-bold tracking-[0.3em]">
          {code || "······"}
        </div>
        <button
          type="button"
          aria-label="Copiar código"
          onClick={() => {
            void navigator.clipboard?.writeText(code);
            toast.success("Código copiado");
          }}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/40"
        >
          <Copy className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Generar código nuevo"
          onClick={() => void regenerate()}
          disabled={busy}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/5 text-white/70 ring-1 ring-white/10 disabled:opacity-50"
        >
          <RefreshCw className="h-5 w-5" />
        </button>
      </div>

      {pending.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 text-base font-semibold text-white/85">
            <UserCheck className="h-4 w-4 text-violet-300" />
            {pending.length} {pending.length === 1 ? "solicitud" : "solicitudes"}
          </div>
          {pending.map((r) => (
            <div key={r.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/20 text-lg font-semibold ring-2 ring-violet-400/40">
                  {r.avatar_url ? <img src={r.avatar_url} alt={r.full_name} className="h-full w-full object-cover" /> : (r.full_name[0] || "?").toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-semibold">{r.full_name}</div>
                  <div className="flex items-center gap-1 text-base text-white/60">
                    <Star className="h-4 w-4 text-amber-300" />
                    {r.reviews_count > 0 ? String(r.reviews_avg).replace(".", ",") : "Sin reseñas"}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAccept(r)}
                  className="h-11 flex-1 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-bold text-white disabled:opacity-50"
                >
                  Aceptar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void reject(r.id)}
                  className="h-11 rounded-full bg-white/5 px-5 text-base font-semibold text-white/80 ring-1 ring-white/10 disabled:opacity-50"
                >
                  Rechazar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
