import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Briefcase, ClipboardList, Clock, Home, Instagram, MapPin, MessageCircle, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { StartShell, startCardCls, startCardStyle } from "@/components/auth/start-shell";
import { PostingDetails } from "@/components/auth/posting-details";
import { PostingMore } from "@/components/auth/posting-more";
import { PlacePicker, loadPlace } from "@/components/auth/place-picker";
import { distanceKm, formatKm, geocodeCached, type Place } from "@/lib/geo";

export const Route = createFileRoute("/bolsa-de-trabajo")({
  head: () => ({
    meta: [
      { title: "Bolsa de trabajo — Clippr" },
      { name: "description", content: "Ofertas laborales de barberías y perfiles de profesionales." },
    ],
  }),
  component: BolsaPublicaPage,
});

type Posting = { id: string; business_name: string; title: string; zone: string | null; job_type: string | null; description: string | null; contact?: string | null; request_status?: string | null; kind?: string; price?: string | null; schedule?: string | null; instagram?: string | null; address?: string | null; logo_url?: string | null; cover_url?: string | null; reviews_avg?: number | null; reviews_count?: number; distKm?: number | null };
type Pro = {
  user_id?: string; full_name: string; avatar_url: string | null; zone: string | null; experience_since: string | null;
  specialties: string[] | null; bio: string | null; instagram: string | null; nationality: string | null;
  photos: string[] | null; reviews_count: number; reviews_avg: number | null; whatsapp?: string | null; distKm?: number | null;
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

// Encabezado de un aviso: portada y logo del negocio (si los cargó), título, nombre e insignia.
function PostingHeader({ p }: { p: Posting }) {
  return (
    <div>
      {p.cover_url && <img src={p.cover_url} alt="" loading="lazy" className="h-28 w-full object-cover" />}
      <div className={`flex items-start gap-3 px-4 ${p.cover_url ? "-mt-7" : "pt-4"}`}>
        <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-violet-500/20 text-lg font-semibold ring-2 ring-[#08070f]">
          {p.logo_url ? <img src={p.logo_url} alt={p.business_name} loading="lazy" className="h-full w-full object-cover" /> : (p.business_name[0] || "?").toUpperCase()}
        </span>
        <div className={`min-w-0 flex-1 ${p.cover_url ? "pt-8" : ""}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xl font-semibold leading-tight">{p.title}</div>
              <div className="text-base text-white/60">{p.business_name}{p.distKm != null ? ` · ${formatKm(p.distKm)}` : ""}</div>
              {!!p.reviews_count && (
                <div className="mt-0.5 flex items-center gap-1 text-base text-white/70">
                  <Star className="h-4 w-4 fill-amber-300 text-amber-300" />
                  <span className="font-semibold">{String(p.reviews_avg).replace(".", ",")}</span>
                  <span className="text-white/50">({p.reviews_count})</span>
                </div>
              )}
            </div>
            <Badge />
          </div>
        </div>
      </div>
    </div>
  );
}

// Foto de la pestaña: si todavía no está cargada, muestra un icono grande.
function TabPhoto({ src, Icon }: { src: string; Icon: React.ComponentType<{ className?: string }> }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return <Icon className="h-10 w-10 text-violet-300" />;
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="h-20 w-full object-contain" />;
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
  const [place, setPlace] = React.useState<Place | null>(null);
  const [coords, setCoords] = React.useState<Record<string, { lat: number; lng: number } | null>>({});
  React.useEffect(() => {
    setPlace(loadPlace());
  }, []);

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

  // Con una zona elegida, se ubican las direcciones de los avisos y perfiles y se ordenan por cercanía.
  React.useEffect(() => {
    if (!place) return;
    const texts = Array.from(
      new Set([...(postings ?? []).map((x) => x.address ?? x.zone ?? ""), ...(pros ?? []).map((x) => x.zone ?? "")].map((t) => t.trim()).filter(Boolean)),
    ).slice(0, 40);
    let cancelled = false;
    void (async () => {
      for (const t of texts) {
        if (cancelled) return;
        if (t in coords) continue;
        const c = await geocodeCached(t).catch(() => null);
        if (cancelled) return;
        setCoords((cur) => ({ ...cur, [t]: c }));
        await new Promise((r) => setTimeout(r, 120));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, postings, pros]);

  const withDist = <T extends { distKm?: number | null }>(rows: T[] | null, textOf: (r: T) => string): T[] | null => {
    if (!rows) return rows;
    if (!place) return rows;
    const out = rows.map((r) => {
      const c = coords[textOf(r).trim()];
      return { ...r, distKm: c ? distanceKm(place, c) : null };
    });
    return out.sort((a, b) => (a.distKm ?? 1e9) - (b.distKm ?? 1e9));
  };
  const postingsView = withDist(postings, (r) => (r as Posting).address ?? (r as Posting).zone ?? "");
  const prosView = withDist(pros, (r) => (r as Pro).zone ?? "");

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
    <StartShell
      header={
        <div className="flex items-center gap-3">
          <img src="/clippr-logo-login.webp" alt="Clippr" className="h-11 w-11 shrink-0 object-contain" />
          <PlacePicker place={place} onChange={setPlace} />
          <Link to="/" aria-label="Inicio" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/80 ring-1 ring-white/10">
            ✕
          </Link>
        </div>
      }
    >
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

      <div className="mt-5 grid grid-cols-3 gap-3">
        {([["ofertas", "Ofertas", ClipboardList, "/bolsa/ofertas.webp"], ["alquileres", "Alquileres", Home, "/bolsa/alquileres.webp"], ["profesionales", "Profesionales", Briefcase, "/bolsa/profesionales.webp"]] as const).map(([id, label, Icon, img]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex flex-col items-center rounded-3xl border bg-white/[0.04] px-2 pb-3 pt-3 transition active:scale-[0.98] ${tab === id ? "border-violet-400/70 shadow-[0_0_22px_-6px_rgba(139,92,246,0.8)]" : "border-white/10"}`}
          >
            <span className="grid h-20 w-full place-items-center">
              <TabPhoto src={img} Icon={Icon} />
            </span>
            <span className={`mt-2 text-base font-semibold leading-tight ${tab === id ? "text-white" : "text-white/70"}`}>{label}</span>
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3 pb-10">
        {tab === "ofertas" && (
          <>
            {postings === null && <div className="py-10 text-center text-white/60">Cargando…</div>}
            {postingsView?.filter((p) => p.kind !== "alquiler").length === 0 && <div className="py-10 text-center text-lg text-white/60">Todavía no hay ofertas publicadas.</div>}
            {postingsView?.filter((p) => p.kind !== "alquiler").map((p) => {
              const sent = p.request_status === "pending" || p.request_status === "accepted";
              return (
                <div key={p.id} className={`${startCardCls} overflow-hidden`} style={startCardStyle}>
                  <PostingHeader p={p} />
                  <div className="space-y-2 p-4 pt-3">
                  <PostingDetails p={p} />
                  {p.description && <PostingMore text={p.description} />}
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
                </div>
              );
            })}
          </>
        )}

        {tab === "alquileres" && (
          <>
            {postings === null && <div className="py-10 text-center text-white/60">Cargando…</div>}
            {postingsView?.filter((p) => p.kind === "alquiler").length === 0 && <div className="py-10 text-center text-lg text-white/60">Todavía no hay puestos para alquilar.</div>}
            {postingsView?.filter((p) => p.kind === "alquiler").map((p) => (
              <div key={p.id} className={`${startCardCls} overflow-hidden`} style={startCardStyle}>
                <PostingHeader p={p} />
                <div className="space-y-2 p-4 pt-3">
                <PostingDetails p={p} />
                {p.description && <PostingMore text={p.description} />}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === "profesionales" && (
          <>
            {pros === null && <div className="py-10 text-center text-white/60">Cargando…</div>}
            {prosView?.length === 0 && <div className="py-10 text-center text-lg text-white/60">Todavía no hay profesionales disponibles.</div>}
            {prosView?.map((r, i) => {
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
                    {r.zone && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-violet-300" />{r.zone}{r.distKm != null ? ` · ${formatKm(r.distKm)}` : ""}</span>}
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
