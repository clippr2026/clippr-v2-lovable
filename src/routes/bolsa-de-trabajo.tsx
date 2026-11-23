import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Briefcase, ClipboardList, Home, Instagram, MapPin, MessageCircle, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { StartShell, startCardCls, startCardStyle } from "@/components/auth/start-shell";

export const Route = createFileRoute("/bolsa-de-trabajo")({
  head: () => ({
    meta: [
      { title: "Bolsa de trabajo — Clippr" },
      { name: "description", content: "Ofertas laborales de barberías y perfiles de profesionales." },
    ],
  }),
  component: BolsaPublicaPage,
});

type Posting = { id: string; business_name: string; title: string; zone: string | null; job_type: string | null; description: string | null; contact?: string | null; request_status?: string | null; kind?: string; price?: string | null };
type Pro = {
  user_id?: string; full_name: string; avatar_url: string | null; zone: string | null; experience_since: string | null;
  specialties: string[] | null; bio: string | null; instagram: string | null; nationality: string | null;
  photos: string[] | null; reviews_count: number; reviews_avg: number | null; whatsapp?: string | null;
};

const TYPES: Record<string, string> = { tiempo_completo: "Tiempo completo", medio_tiempo: "Medio tiempo", por_turnos: "Por turnos" };

function Badge() {
  return <span className="shrink-0 rounded-full bg-violet-500/20 px-3 py-1 text-sm font-semibold text-violet-100 ring-1 ring-violet-400/40">Con Clippr</span>;
}

function WhatsAppButton({ number }: { number?: string | null }) {
  const digits = (number ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return (
    <a
      href={`https://wa.me/${digits}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-11 items-center gap-2 rounded-full bg-emerald-500/15 px-4 text-base font-semibold text-emerald-200 ring-1 ring-emerald-400/30"
    >
      <MessageCircle className="h-4 w-4" />
      WhatsApp
    </a>
  );
}

function years(date: string | null): number | null {
  if (!date) return null;
  const y = (Date.now() - new Date(date).getTime()) / (365.25 * 24 * 3600 * 1000);
  return y >= 0 ? Math.floor(y) : null;
}

// Página pública: cualquiera mira; con sesión, el profesional se postula y el negocio solicita.
function BolsaPublicaPage() {
  const { session, businessId, user, loading: authLoading } = useAuth();
  const [tab, setTab] = React.useState<"ofertas" | "alquileres" | "profesionales">("ofertas");
  const [postings, setPostings] = React.useState<Posting[] | null>(null);
  const [pros, setPros] = React.useState<Pro[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const isOwner = Boolean(session && businessId);
  const isPro = Boolean(session && !businessId && (user?.user_metadata as { account_type?: string } | undefined)?.account_type === "profesional");

  const load = React.useCallback(async () => {
    if (authLoading) return;
    const rpc = (supabase as any).rpc.bind(supabase);
    const [a, b] = await Promise.all([rpc("public_job_postings"), rpc("public_bolsa_profiles")]);
    setPostings((a.data as Posting[] | null) ?? []);
    setPros((b.data as Pro[] | null) ?? []);
  }, [authLoading, session]);

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

  async function invite(p: Pro) {
    if (!p.user_id || !businessId) return;
    setBusy(p.user_id);
    const { error } = await (supabase as any).rpc("invite_professional", { p_business: businessId, p_user: p.user_id });
    setBusy(null);
    if (error) return toast.error("No se pudo enviar la solicitud");
    toast.success(`Solicitud enviada a ${p.full_name}`);
    void load();
  }

  return (
    <StartShell back={{ to: "/", label: "Volver" }}>
      <h1 className="font-display text-3xl font-bold">Bolsa de trabajo</h1>
      <p className="mt-2 text-lg text-white/65">Ofertas de barberías y profesionales disponibles.</p>

      {!session && !authLoading && (
        <div className={`${startCardCls} mt-5 p-4`} style={startCardStyle}>
          <p className="text-base text-white/75">Para postularte o solicitar a un profesional, iniciá sesión o creá tu cuenta.</p>
          <div className="mt-3 flex gap-2">
            <Link to="/empezar" className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white">Crear cuenta</Link>
            <Link to="/login" className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-white/5 text-base font-semibold text-white/85 ring-1 ring-white/10">Iniciar sesión</Link>
          </div>
        </div>
      )}

      <div className="mt-5 flex gap-1.5">
        {([["ofertas", "Ofertas", ClipboardList], ["alquileres", "Alquileres", Home], ["profesionales", "Profesionales", Briefcase]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-full text-base font-semibold transition ${tab === id ? "flex-[2]" : "flex-1"} ${tab === id ? "bg-gradient-to-r from-sky-400 to-violet-500 text-white" : "bg-white/[0.06] text-white/65"}`}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {tab === id && label}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3 pb-10">
        {tab === "ofertas" && (
          <>
            {postings === null && <div className="py-10 text-center text-white/60">Cargando…</div>}
            {postings?.filter((p) => p.kind !== "alquiler").length === 0 && <div className="py-10 text-center text-lg text-white/60">Todavía no hay ofertas publicadas.</div>}
            {postings?.filter((p) => p.kind !== "alquiler").map((p) => {
              const sent = p.request_status === "pending" || p.request_status === "accepted";
              return (
                <div key={p.id} className={`${startCardCls} space-y-2 p-4`} style={startCardStyle}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xl font-semibold">{p.title}</div>
                      <div className="text-base text-white/60">{p.business_name}</div>
                    </div>
                    <Badge />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-base text-white/70">
                    {p.job_type && <span className="inline-flex items-center gap-1.5"><Briefcase className="h-4 w-4 text-violet-300" />{TYPES[p.job_type] ?? p.job_type}</span>}
                    {p.zone && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-violet-300" />{p.zone}</span>}
                  </div>
                  {p.description && <p className="text-base text-white/75">{p.description}</p>}
                  {p.contact && (/^\d{8,15}$/.test(p.contact.replace(/\D/g, "")) ? <WhatsAppButton number={p.contact} /> : <div className="text-base text-white/70">{p.contact}</div>)}
                  {isPro && (
                    <button
                      type="button"
                      disabled={sent || busy === p.id}
                      onClick={() => void apply(p)}
                      className="h-12 w-full rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white disabled:bg-white/[0.04] disabled:bg-none disabled:text-white/40"
                    >
                      {p.request_status === "accepted" ? "Ya sos parte" : sent ? "Solicitud enviada" : "Enviar solicitud"}
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}

        {tab === "alquileres" && (
          <>
            {postings === null && <div className="py-10 text-center text-white/60">Cargando…</div>}
            {postings?.filter((p) => p.kind === "alquiler").length === 0 && <div className="py-10 text-center text-lg text-white/60">Todavía no hay puestos para alquilar.</div>}
            {postings?.filter((p) => p.kind === "alquiler").map((p) => (
              <div key={p.id} className={`${startCardCls} space-y-2 p-4`} style={startCardStyle}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xl font-semibold">{p.title}</div>
                    <div className="text-base text-white/60">{p.business_name}</div>
                  </div>
                  <Badge />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-base text-white/70">
                  {p.price && <span className="font-semibold text-emerald-300">{p.price}</span>}
                  {p.zone && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-violet-300" />{p.zone}</span>}
                </div>
                {p.description && <p className="text-base text-white/75">{p.description}</p>}
                {p.contact && (/^\d{8,15}$/.test(p.contact.replace(/\D/g, "")) ? <WhatsAppButton number={p.contact} /> : <div className="text-base text-white/70">{p.contact}</div>)}
              </div>
            ))}
          </>
        )}

        {tab === "profesionales" && (
          <>
            {pros === null && <div className="py-10 text-center text-white/60">Cargando…</div>}
            {pros?.length === 0 && <div className="py-10 text-center text-lg text-white/60">Todavía no hay profesionales disponibles.</div>}
            {pros?.map((r, i) => {
              const y = years(r.experience_since);
              return (
                <div key={r.user_id ?? `${r.full_name}-${i}`} className={`${startCardCls} space-y-3 p-4`} style={startCardStyle}>
                  <div className="flex items-center gap-3">
                    <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/20 text-xl font-semibold ring-2 ring-violet-400/40">
                      {r.avatar_url ? <img src={r.avatar_url} alt={r.full_name} className="h-full w-full object-cover" /> : (r.full_name[0] || "?").toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xl font-semibold">{r.full_name}</div>
                      {(
                        <div className="flex items-center gap-1 text-base text-white/60">
                          <Star className="h-4 w-4 text-amber-300" />
                          {r.reviews_count > 0 ? `${String(r.reviews_avg).replace(".", ",")} (${r.reviews_count} reseñas)` : "Sin reseñas todavía"}
                        </div>
                      )}
                    </div>
                    <Badge />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-base text-white/70">
                    {r.zone && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-violet-300" />{r.zone}</span>}
                    {y !== null && <span>{y} años en el rubro</span>}
                    {r.nationality && <span>{r.nationality}</span>}
                    {r.instagram && <span className="inline-flex items-center gap-1.5"><Instagram className="h-4 w-4 text-violet-300" />@{r.instagram}</span>}
                  </div>
                  {r.specialties && r.specialties.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.specialties.map((s) => <span key={s} className="rounded-full bg-violet-500/15 px-3 py-1 text-sm font-semibold text-violet-100 ring-1 ring-violet-400/30">{s}</span>)}
                    </div>
                  )}
                  {r.bio && <p className="text-base text-white/75">{r.bio}</p>}
                  {r.photos && r.photos.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {r.photos.map((u) => <img key={u} src={u} alt="Trabajo" className="aspect-square w-full rounded-xl object-cover ring-1 ring-white/15" />)}
                    </div>
                  )}
                  <WhatsAppButton number={r.whatsapp} />
                  {isOwner && r.user_id && (
                    <button
                      type="button"
                      disabled={busy === r.user_id}
                      onClick={() => void invite(r)}
                      className="h-12 w-full rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white disabled:opacity-50"
                    >
                      {busy === r.user_id ? "Enviando…" : "Solicitar"}
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </StartShell>
  );
}
