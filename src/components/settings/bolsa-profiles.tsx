import * as React from "react";
import { createPortal } from "react-dom";
import { Instagram, MapPin, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { BolsaTabs, type BolsaTab } from "@/components/settings/bolsa-tabs";

type BolsaProfile = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  zone: string | null;
  experience_since: string | null;
  specialties: string[] | null;
  bio: string | null;
  instagram: string | null;
  nationality: string | null;
  photos: string[] | null;
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

// Botón "Profesionales": perfiles que decidieron mostrarse en la bolsa de trabajo. "Solicitar" le envía
// una solicitud; cuando la persona acepta, aparece en Solicitudes para sumarla al equipo.
export function BolsaProfilesButton({ open, onClose, onSelectTab, onInvited }: { open: boolean; onClose: () => void; onSelectTab: (t: BolsaTab) => void; onInvited: () => void }) {
  const { businessId } = useAuth();
  const setOpen = (v: boolean) => {
    if (!v) onClose();
  };
  const [rows, setRows] = React.useState<BolsaProfile[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const { data } = await (supabase as any).rpc("list_bolsa_profiles", { p_business: businessId });
    setRows((data as BolsaProfile[] | null) ?? []);
    setLoading(false);
  }, [businessId]);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function invite(p: BolsaProfile) {
    if (!businessId) return;
    setBusyId(p.user_id);
    const { error } = await (supabase as any).rpc("invite_professional", { p_business: businessId, p_user: p.user_id });
    setBusyId(null);
    if (error) return toast.error("No se pudo enviar la solicitud");
    toast.success(`Solicitud enviada a ${p.full_name}`);
    setRows((cur) => cur.filter((r) => r.user_id !== p.user_id));
    onInvited();
  }

  const q = query.trim().toLowerCase();
  const shown = q
    ? rows.filter((r) => `${r.zone ?? ""} ${r.full_name} ${(r.specialties ?? []).join(" ")}`.toLowerCase().includes(q))
    : rows;

  return (
    <>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-start justify-center overflow-hidden bg-black/85 p-4 pt-[calc(24px+env(safe-area-inset-top,0px))] pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] lg:pb-4"
            onClick={() => setOpen(false)}
          >
            <div
              className="relative flex max-h-[calc(100dvh-24px-env(safe-area-inset-top,0px)-0.25rem-env(safe-area-inset-bottom,0px))] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-[oklch(0.12_0.02_275)] shadow-2xl ring-1 ring-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 border-b border-white/5 px-5 py-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg font-semibold">Bolsa de trabajo</h3>
                  <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="-mr-2 grid h-12 w-12 place-items-center rounded-full text-white/80">
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
                <div className="relative mt-1">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar por zona o especialidad"
                    className="h-12 w-full rounded-2xl border border-white/10 bg-black/30 pl-12 pr-4 text-base font-semibold text-white placeholder:text-white/35 focus:border-violet-400/50 focus:outline-none"
                  />
                </div>
              </div>

              <BolsaTabs active="profesionales" onSelect={onSelectTab} />
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
                {loading && <div className="py-10 text-center text-white/60">Cargando…</div>}
                {!loading && shown.length === 0 && (
                  <div className="py-10 text-center text-lg text-white/60">
                    {rows.length === 0 ? "Todavía no hay profesionales disponibles." : "No hay resultados."}
                  </div>
                )}
                {shown.map((r) => {
                  const years = yearsSince(r.experience_since);
                  return (
                    <div key={r.user_id} className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4" style={cardStyle}>
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
                        {years !== null && <span>{years} años en el rubro</span>}
                        {r.nationality && <span>{r.nationality}</span>}
                        {r.instagram && (
                          <span className="inline-flex items-center gap-1.5">
                            <Instagram className="h-4 w-4 text-violet-300" />@{r.instagram}
                          </span>
                        )}
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
                      <button
                        type="button"
                        disabled={busyId === r.user_id}
                        onClick={() => void invite(r)}
                        className="h-12 w-full rounded-2xl bg-gradient-to-r from-sky-400 to-violet-500 text-base font-bold text-white shadow-[0_6px_22px_-4px_rgba(124,92,255,0.9)] transition active:scale-95 disabled:opacity-50"
                      >
                        {busyId === r.user_id ? "Enviando…" : "Solicitar"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
