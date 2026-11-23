import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Briefcase, ClipboardList, Instagram, MapPin, MessageCircle, Plus, Star } from "lucide-react";
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

type Posting = { id: string; business_name: string; title: string; zone: string | null; job_type: string | null; description: string | null; contact?: string | null; request_status?: string | null; with_clippr?: boolean };
type Pro = {
  user_id?: string; full_name: string; avatar_url: string | null; zone: string | null; experience_since: string | null;
  specialties: string[] | null; bio: string | null; instagram: string | null; nationality: string | null;
  photos: string[] | null; reviews_count: number; reviews_avg: number | null; whatsapp?: string | null; with_clippr?: boolean;
};

const TYPES: Record<string, string> = { tiempo_completo: "Tiempo completo", medio_tiempo: "Medio tiempo", por_turnos: "Por turnos" };

function Badge({ withClippr }: { withClippr?: boolean }) {
  return withClippr ? (
    <span className="shrink-0 rounded-full bg-violet-500/20 px-3 py-1 text-sm font-semibold text-violet-100 ring-1 ring-violet-400/40">Con Clippr</span>
  ) : (
    <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white/60 ring-1 ring-white/15">Sin Clippr</span>
  );
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
  const [tab, setTab] = React.useState<"ofertas" | "profesionales">("ofertas");
  const [postings, setPostings] = React.useState<Posting[] | null>(null);
  const [pros, setPros] = React.useState<Pro[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);

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

      <button
        type="button"
        onClick={() => setPublishOpen(true)}
        className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-violet-400/40 bg-violet-500/15 text-base font-semibold text-violet-100"
      >
        <Plus className="h-5 w-5" /> Publicar sin cuenta
      </button>

      <div className="mt-5 flex gap-1.5">
        {([["ofertas", "Ofertas", ClipboardList], ["profesionales", "Profesionales", Briefcase]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-base font-semibold transition ${tab === id ? "bg-gradient-to-r from-sky-400 to-violet-500 text-white" : "bg-white/[0.06] text-white/65"}`}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3 pb-10">
        {tab === "ofertas" && (
          <>
            {postings === null && <div className="py-10 text-center text-white/60">Cargando…</div>}
            {postings?.length === 0 && <div className="py-10 text-center text-lg text-white/60">Todavía no hay ofertas publicadas.</div>}
            {postings?.map((p) => {
              const sent = p.request_status === "pending" || p.request_status === "accepted";
              return (
                <div key={p.id} className={`${startCardCls} space-y-2 p-4`} style={startCardStyle}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xl font-semibold">{p.title}</div>
                      <div className="text-base text-white/60">{p.business_name}</div>
                    </div>
                    <Badge withClippr={p.with_clippr} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-base text-white/70">
                    {p.job_type && <span className="inline-flex items-center gap-1.5"><Briefcase className="h-4 w-4 text-violet-300" />{TYPES[p.job_type] ?? p.job_type}</span>}
                    {p.zone && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-violet-300" />{p.zone}</span>}
                  </div>
                  {p.description && <p className="text-base text-white/75">{p.description}</p>}
                  {p.contact && (/^\d{8,15}$/.test(p.contact.replace(/\D/g, "")) ? <WhatsAppButton number={p.contact} /> : <div className="text-base text-white/70">{p.contact}</div>)}
                  {isPro && p.with_clippr && (
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
                      {r.with_clippr && (
                        <div className="flex items-center gap-1 text-base text-white/60">
                          <Star className="h-4 w-4 text-amber-300" />
                          {r.reviews_count > 0 ? `${String(r.reviews_avg).replace(".", ",")} (${r.reviews_count} reseñas)` : "Sin reseñas todavía"}
                        </div>
                      )}
                    </div>
                    <Badge withClippr={r.with_clippr} />
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
                  {isOwner && r.user_id && r.with_clippr && (
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
      {publishOpen && <PublishForm onClose={() => setPublishOpen(false)} onDone={() => { setPublishOpen(false); void load(); }} />}
    </StartShell>
  );
}

const fieldCls = "h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base font-semibold text-white placeholder:text-white/35 focus:border-violet-400/50 focus:outline-none";

const PUBLISH_ERRORS: Record<string, string> = {
  correo_invalido: "Revisá el correo.",
  whatsapp_invalido: "El WhatsApp debe tener entre 8 y 15 números.",
  demasiadas_publicaciones: "Ya publicaste varias veces hoy. Probá más tarde.",
};

// Publicar sin cuenta: nombre, correo (no se muestra) y WhatsApp, con largos limitados. Dura 30 días.
function PublishForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = React.useState<"oferta" | "profesional">("oferta");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [whatsapp, setWhatsapp] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [zone, setZone] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [hp, setHp] = React.useState("");
  const [sending, setSending] = React.useState(false);

  async function send() {
    if (name.trim().length < 2) return toast.error("Ingresá tu nombre");
    if (title.trim().length < 3) return toast.error(kind === "oferta" ? "Escribí qué buscás" : "Escribí tu especialidad");
    setSending(true);
    const { error } = await (supabase as any).rpc("submit_external_listing", {
      p_kind: kind, p_name: name, p_email: email, p_whatsapp: whatsapp, p_title: title, p_zone: zone, p_description: description, p_hp: hp,
    });
    setSending(false);
    if (error) {
      const key = Object.keys(PUBLISH_ERRORS).find((k) => error.message?.includes(k));
      return toast.error(key ? PUBLISH_ERRORS[key] : "No se pudo publicar. Revisá los datos.");
    }
    toast.success("Publicado por 30 días");
    onDone();
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-black/85 p-4" onClick={onClose}>
      <div className="my-4 w-full max-w-md space-y-4 rounded-3xl border border-violet-400/30 bg-[#08070f] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Publicar sin cuenta</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-full text-white/80">✕</button>
        </div>
        <div className="flex gap-1.5">
          {([["oferta", "Busco barbero"], ["profesional", "Busco trabajo"]] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setKind(id)} className={`h-11 flex-1 rounded-full text-base font-semibold ${kind === id ? "bg-gradient-to-r from-sky-400 to-violet-500 text-white" : "bg-white/[0.06] text-white/65"}`}>
              {label}
            </button>
          ))}
        </div>
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder={kind === "oferta" ? "Nombre de la barbería" : "Tu nombre"} className={fieldCls} />
        <input value={email} onChange={(e) => setEmail(e.target.value.slice(0, 80))} type="email" placeholder="Correo (no se muestra)" className={fieldCls} />
        <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value.replace(/[^\d+ ]/g, "").slice(0, 20))} inputMode="tel" placeholder="WhatsApp, con código de área" className={fieldCls} />
        <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} placeholder={kind === "oferta" ? "Ej: Busco barbero turno tarde" : "Ej: Barbero con 5 años de experiencia"} className={fieldCls} />
        <input value={zone} onChange={(e) => setZone(e.target.value.slice(0, 60))} placeholder="Zona (opcional)" className={fieldCls} />
        <div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, 300))} rows={3} placeholder="Detalles (opcional)" className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base font-semibold text-white placeholder:text-white/35 focus:border-violet-400/50 focus:outline-none" />
          <div className="mt-1 text-right text-sm text-white/50">{description.length}/300</div>
        </div>
        <input value={hp} onChange={(e) => setHp(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
        <p className="text-sm text-white/50">Se muestra tu nombre y tu WhatsApp, y dura 30 días. Tu correo queda guardado pero no se publica.</p>
        <button type="button" disabled={sending} onClick={() => void send()} className="h-14 w-full rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-lg font-semibold text-white disabled:opacity-60">
          {sending ? "Publicando…" : "Publicar"}
        </button>
      </div>
    </div>
  );
}
