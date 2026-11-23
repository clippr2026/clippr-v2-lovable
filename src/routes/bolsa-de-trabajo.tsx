import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Briefcase, ClipboardList, Clock, Home, Instagram, MapPin, MessageCircle, Scissors, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { StartShell, startCardCls, startCardStyle } from "@/components/auth/start-shell";
import { PostingDetails } from "@/components/auth/posting-details";
import { PlacePicker, loadPlace } from "@/components/auth/place-picker";
import { FilterBar, type SortKey } from "@/components/auth/filter-bar";
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

type Posting = { id: string; business_name: string; title: string; zone: string | null; job_type: string | null; description: string | null; contact?: string | null; request_status?: string | null; kind?: string; price?: string | null; schedule?: string | null; instagram?: string | null; address?: string | null; logo_url?: string | null; cover_url?: string | null; reviews_avg?: number | null; reviews_count?: number; distKm?: number | null; business_start_date?: string | null };
type Pro = {
  user_id?: string; full_name: string; avatar_url: string | null; zone: string | null; experience_since: string | null;
  specialties: string[] | null; bio: string | null; instagram: string | null; nationality: string | null;
  photos: string[] | null; reviews_count: number; reviews_avg: number | null; whatsapp?: string | null; distKm?: number | null;
};

const TYPES: Record<string, string> = { tiempo_completo: "Tiempo completo", medio_tiempo: "Medio tiempo", por_turnos: "Por turnos" };

function Badge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#1b1245] px-3 py-1 text-sm font-semibold text-white shadow-lg ring-1 ring-violet-300/60">
      <img src="/clippr-logo-login.webp" alt="" className="h-4 w-4 object-contain" />
      Usa Clippr
    </span>
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

// Encabezado de un aviso: portada con la insignia arriba a la derecha, logo, nombre con estrellas y título.
function PostingHeader({ p }: { p: Posting }) {
  return (
    <div>
      <div className="relative">
        {p.cover_url && <img src={p.cover_url} alt="" loading="lazy" decoding="async" className="h-28 w-full object-cover" />}
        {p.cover_url && (
          <div className="absolute right-3 top-3">
            <Badge />
          </div>
        )}
      </div>
      <div className={`flex items-start gap-3 px-4 ${p.cover_url ? "-mt-7" : "pt-4"}`}>
        <span className="relative z-10 grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#0d0b18] text-xl font-semibold ring-2 ring-[#08070f]">
          {p.logo_url ? <img src={p.logo_url} alt={p.business_name} loading="lazy" decoding="async" className="h-full w-full object-cover" /> : (p.business_name[0] || "?").toUpperCase()}
        </span>
        <div className={`min-w-0 flex-1 ${p.cover_url ? "pt-8" : ""}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-lg font-normal leading-tight text-white/70">{p.business_name}</span>
              {!!p.reviews_count && (
                <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-base">
                  <Star className="h-4 w-4 fill-amber-300 text-amber-300" />
                  <span className="font-semibold">{String(p.reviews_avg).replace(".", ",")}</span>
                  <span className="text-white/50">({p.reviews_count})</span>
                </span>
              )}
            </div>
            {!p.cover_url && <Badge />}
          </div>
          {p.distKm != null && <div className="text-sm text-white/50">{formatKm(p.distKm)}</div>}
        </div>
      </div>
      <div className="truncate px-4 pt-2 text-xl font-semibold leading-tight">{p.title}</div>
      {p.kind === "alquiler" && p.price && <div className="px-4 pt-0.5 text-lg font-semibold text-emerald-300">{p.price}</div>}
    </div>
  );
}

// Foto de la pestaña: si todavía no está cargada, muestra un icono grande.
function TabPhoto({ src, Icon }: { src: string; Icon: React.ComponentType<{ className?: string }> }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return <Icon className="h-10 w-10 text-violet-300" />;
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />;
}

// Pie del aviso: "Ver más" a la izquierda y el botón de acción a la derecha. Con sesión envía la solicitud (o abre
// WhatsApp en los alquileres); sin sesión pide crear cuenta o iniciar sesión.
function PostingFooter({
  text,
  logged,
  label,
  disabled,
  onSend,
  whatsapp,
  showAction = true,
}: {
  text?: string | null;
  logged: boolean;
  label: string;
  disabled?: boolean;
  onSend: () => void;
  whatsapp?: string | null;
  showAction?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [ask, setAsk] = React.useState(false);
  const wa = (whatsapp ?? "").replace(/\D/g, "");
  const cls = "inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-sky-400 to-violet-500 px-5 text-base font-semibold text-white disabled:bg-white/[0.04] disabled:bg-none disabled:text-white/40";
  const isLink = whatsapp !== undefined;
  return (
    <div>
      {open && text && <p className="mb-2 whitespace-pre-line text-base font-semibold text-white/90">{text}</p>}
      <div className="flex items-center justify-between gap-3">
        {text ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-base font-semibold text-violet-300">
            {open ? "Ver menos" : "Ver más"}
          </button>
        ) : (
          <span />
        )}
        {showAction &&
          (logged && isLink ? (
            wa.length >= 8 ? (
              <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className={cls}>
                {label}
              </a>
            ) : null
          ) : (
            <button type="button" disabled={disabled} onClick={() => (logged ? onSend() : setAsk((v) => !v))} className={cls}>
              {label}
            </button>
          ))}
      </div>
      {!logged && ask && (
        <div className="mt-3 rounded-2xl bg-black/25 p-3">
          <p className="text-base text-white/80">Creá tu cuenta o iniciá sesión para mandar solicitudes.</p>
          <div className="mt-3 flex gap-2">
            <Link to="/empezar" className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white">Crear cuenta</Link>
            <Link to="/login" className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-white/5 text-base font-semibold text-white/85 ring-1 ring-white/10">Iniciar sesión</Link>
          </div>
        </div>
      )}
    </div>
  );
}

type Local = {
  slug: string; name: string; logo_url: string | null; cover_url: string | null; address: string | null;
  instagram: string | null; business_start_date: string | null; reviews_avg: number | null; reviews_count: number; distKm?: number | null;
  hours?: Record<string, { s: string; e: string }> | null;
};

// Tarjeta de un local: portada, logo, nombre con estrellas, dirección y botón para reservar.
function LocalCard({ l }: { l: Local }) {
  const y = yearsOf(l.business_start_date);
  return (
    <div className={`${startCardCls} overflow-hidden`} style={startCardStyle}>
      <div className="relative">
        {l.cover_url ? <img src={l.cover_url} alt="" loading="lazy" decoding="async" className="h-32 w-full object-cover" /> : <div className="h-20 bg-gradient-to-r from-sky-500/20 to-violet-500/30" />}
        <div className="absolute left-3 top-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1b1245] px-3 py-1 text-sm font-semibold text-white shadow-lg ring-1 ring-violet-300/60">
            <Scissors className="h-4 w-4 text-violet-200" />
            Barbería
          </span>
        </div>
        <div className="absolute right-3 top-3">
          <Badge />
        </div>
      </div>
      <div className="-mt-7 flex items-start gap-3 px-4">
        <span className="relative z-10 grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#0d0b18] text-xl font-semibold ring-2 ring-[#08070f]">
          {l.logo_url ? <img src={l.logo_url} alt={l.name} loading="lazy" decoding="async" className="h-full w-full object-cover" /> : (l.name[0] || "?").toUpperCase()}
        </span>
        <div className="min-w-0 flex-1 pt-8">
          <div className="flex items-center gap-2">
            <span className="truncate text-xl font-semibold leading-tight">{l.name}</span>
            {!!l.reviews_count && (
              <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-base">
                <Star className="h-4 w-4 fill-amber-300 text-amber-300" />
                <span className="font-semibold">{String(l.reviews_avg).replace(".", ",")}</span>
                <span className="text-white/50">({l.reviews_count})</span>
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="space-y-2 p-4 pt-3">
        {l.address && (
          <div className="flex items-center gap-2 text-base text-white/75">
            <MapPin className="h-4 w-4 shrink-0 text-violet-300" />
            <span className="truncate">{l.address}</span>
          </div>
        )}
        {formatHours(l.hours).map((h) => (
          <div key={h} className="flex items-center gap-2 text-base text-white/75">
            <Clock className="h-4 w-4 shrink-0 text-violet-300" />
            <span>{h}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3">
          <span className="text-base text-white/60">{y != null && y >= 1 ? `${y} ${y === 1 ? "año" : "años"} de experiencia` : ""}</span>
          <Link to="/negocio/$slug" params={{ slug: l.slug }} className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-sky-400 to-violet-500 px-6 text-base font-semibold text-white">
            Reservar
          </Link>
        </div>
        {l.distKm != null && <div className="text-right text-sm text-white/55">{formatKm(l.distKm)}</div>}
      </div>
    </div>
  );
}

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// "Lun a Sáb · 11:00 a 20:00": agrupa los días seguidos con el mismo horario.
function formatHours(hours?: Record<string, { s: string; e: string }> | null): string[] {
  if (!hours) return [];
  const out: string[] = [];
  let i = 0;
  while (i < 7) {
    const h = hours[DAY_KEYS[i]];
    if (!h) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < 7 && hours[DAY_KEYS[j + 1]]?.s === h.s && hours[DAY_KEYS[j + 1]]?.e === h.e) j++;
    out.push(`${j === i ? DAY_NAMES[i] : j === i + 1 ? `${DAY_NAMES[i]} y ${DAY_NAMES[j]}` : `${DAY_NAMES[i]} a ${DAY_NAMES[j]}`} · ${h.s} a ${h.e}`);
    i = j + 1;
  }
  return out;
}

function yearsOf(date?: string | null): number | null {
  if (!date) return null;
  const y = Math.floor((Date.now() - new Date(date).getTime()) / (365.25 * 24 * 3600 * 1000));
  return y >= 0 ? y : null;
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
  const [section, setSection] = React.useState<"locales" | "bolsa">("locales");
  const [sort, setSort] = React.useState<SortKey>("relevantes");
  const [maxKm, setMaxKm] = React.useState<number | null>(null);
  const [pickSignal, setPickSignal] = React.useState(0);
  const [locales, setLocales] = React.useState<Local[] | null>(null);
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
    const [a, b, c] = await Promise.all([rpc("public_job_postings"), rpc("public_bolsa_profiles"), rpc("public_businesses")]);
    setLocales((c.data as Local[] | null) ?? []);
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
      new Set([...(postings ?? []).map((x) => x.address ?? x.zone ?? ""), ...(pros ?? []).map((x) => x.zone ?? ""), ...(locales ?? []).map((x) => x.address ?? "")].map((t) => t.trim()).filter(Boolean)),
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
  }, [place, postings, pros, locales]);

  // Agrega la distancia, filtra por el máximo elegido y ordena según el criterio.
  const withDist = <T extends { distKm?: number | null; reviews_avg?: number | null; reviews_count?: number }>(rows: T[] | null, textOf: (r: T) => string): T[] | null => {
    if (!rows) return rows;
    let out = rows.map((r) => {
      const c = place ? coords[textOf(r).trim()] : null;
      return { ...r, distKm: place && c ? distanceKm(place, c) : null };
    });
    if (place && maxKm) out = out.filter((r) => r.distKm == null || r.distKm <= maxKm);
    if (sort === "cercanos") out.sort((x, y) => (x.distKm ?? 1e9) - (y.distKm ?? 1e9));
    else if (sort === "puntuados") out.sort((x, y) => (y.reviews_avg ?? 0) - (x.reviews_avg ?? 0) || (y.reviews_count ?? 0) - (x.reviews_count ?? 0));
    else if ((rows as unknown) === locales) out.sort((x, y) => (y.reviews_count ?? 0) - (x.reviews_count ?? 0));
    return out;
  };
  const localesView = withDist(locales, (r) => (r as Local).address ?? "");
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
          <PlacePicker place={place} onChange={(p) => { setPlace(p); if (p) setSort("cercanos"); else { setSort("relevantes"); setMaxKm(null); } }} openSignal={pickSignal} />
          <Link to="/" aria-label="Inicio" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/80 ring-1 ring-white/10">
            ✕
          </Link>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-1.5 rounded-full bg-white/[0.06] p-1">
        {([["locales", "Servicios"], ["bolsa", "Bolsa de trabajo"]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`h-11 rounded-full text-base font-semibold transition ${section === id ? "bg-gradient-to-r from-sky-400 to-violet-500 text-white" : "text-white/65"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <FilterBar sort={sort} onSort={setSort} maxKm={maxKm} onMaxKm={setMaxKm} hasPlace={Boolean(place)} onNeedPlace={() => { toast.info("Elegí tu zona para ordenar y filtrar por distancia."); setPickSignal((n) => n + 1); }} />

      <h1 className="mt-5 font-display text-3xl font-bold">{section === "locales" ? "Reservá tu turno" : "Bolsa de trabajo"}</h1>
      <p className="mt-2 text-lg text-white/65">
        {section === "locales" ? "Locales que usan Clippr, cerca tuyo." : "Empleos, alquileres y profesionales disponibles."}
      </p>

      {section === "locales" && (
        <div className="mt-5 space-y-4 pb-10">
          {localesView === null && <div className="py-10 text-center text-white/60">Cargando…</div>}
          {localesView?.length === 0 && <div className="py-10 text-center text-lg text-white/60">Todavía no hay locales.</div>}
          {localesView?.map((l) => (
            <LocalCard key={l.slug} l={l} />
          ))}
        </div>
      )}

      {section === "bolsa" && !session && !authLoading && (
        <div className={`${startCardCls} mt-5 p-4`} style={startCardStyle}>
          <p className="text-base text-white/75">Para postularte o solicitar a un profesional, iniciá sesión o creá tu cuenta.</p>
          <div className="mt-3 flex gap-2">
            <Link to="/empezar" className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white">Crear cuenta</Link>
            <Link to="/login" className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-white/5 text-base font-semibold text-white/85 ring-1 ring-white/10">Iniciar sesión</Link>
          </div>
        </div>
      )}

      {section === "bolsa" && (
      <>
      <div className="mt-5 grid grid-cols-3 gap-3">
        {([["ofertas", "Empleos", ClipboardList, "/bolsa/ofertas.webp"], ["alquileres", "Alquileres", Home, "/bolsa/alquileres.webp"], ["profesionales", "Profesionales", Briefcase, "/bolsa/profesionales.webp"]] as const).map(([id, label, Icon, img]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex min-w-0 flex-col items-center overflow-hidden rounded-3xl border bg-[#0a0d1f] pb-3 transition active:scale-[0.98] ${tab === id ? "border-violet-400/70 shadow-[0_0_22px_-6px_rgba(139,92,246,0.8)]" : "border-white/10"}`}
          >
            <span className="grid aspect-square w-full place-items-center">
              <TabPhoto src={img} Icon={Icon} />
            </span>
            <span className={`mt-1 max-w-full whitespace-nowrap px-1 text-[13px] font-semibold leading-tight tracking-tight ${tab === id ? "text-white" : "text-white/70"}`}>{label}</span>
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3 pb-10">
        {tab === "ofertas" && (
          <>
            {postings === null && <div className="py-10 text-center text-white/60">Cargando…</div>}
            {postingsView?.filter((p) => p.kind !== "alquiler").length === 0 && <div className="py-10 text-center text-lg text-white/60">Todavía no hay empleos publicados.</div>}
            {postingsView?.filter((p) => p.kind !== "alquiler").map((p) => {
              const sent = p.request_status === "pending" || p.request_status === "accepted";
              return (
                <div key={p.id} className={`${startCardCls} overflow-hidden`} style={startCardStyle}>
                  <PostingHeader p={p} />
                  <div className="space-y-2 p-4 pt-3">
                  <PostingDetails p={{ ...p, price: null, years: yearsOf(p.business_start_date) }} />
                  <PostingFooter
                    text={p.description}
                    logged={Boolean(session)}
                    showAction
                    disabled={sent || busy === p.id}
                    label={p.request_status === "accepted" ? "Ya sos parte" : sent ? "Solicitud enviada" : busy === p.id ? "Enviando…" : "Postularme"}
                    onSend={() => (isPro ? void apply(p) : toast.info("Para postularte necesitás una cuenta de profesional."))}
                  />
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
                <PostingDetails p={{ ...p, price: null, years: yearsOf(p.business_start_date) }} />
                <PostingFooter text={p.description} logged={Boolean(session)} label="Solicitar" whatsapp={p.contact} onSend={() => {}} />
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
                  <PostingFooter
                    logged={Boolean(session)}
                    showAction
                    disabled={busy === r.user_id}
                    label={busy === r.user_id ? "Enviando…" : "Invitar"}
                    onSend={() => (isOwner ? void invite(r) : toast.info("Para invitar necesitás una cuenta de dueño de negocio."))}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>
      </>
      )}
    </StartShell>
  );
}
