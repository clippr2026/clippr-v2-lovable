import * as React from "react";
import { toast } from "sonner";
import { Loader2, Megaphone, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PublicHero, AnnouncementBubble } from "@/components/public-hero";
import { normalizePublicDecor, type PublicDecorKey } from "@/components/public-decor";
import { normalizePublicNeon, type PublicNeonKey } from "@/lib/public-neon";
import { normalizePublicBg, pageBackground, type PublicBgKey } from "@/lib/public-theme";
import { getPublicFont, publicFontsStylesheet } from "@/lib/public-fonts";
import {
  ANNOUNCEMENT_MAX_CHARS,
  activeAnnouncement,
  announcementRemainingMs,
  formatRemaining,
} from "@/lib/announcement";

type HeroData = {
  name: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  avatarPosition: string;
  coverPosition: string;
  primary: string;
  secondary: string;
  accent: string;
  light: boolean;
  decor: PublicDecorKey;
  neon: PublicNeonKey;
  bg: PublicBgKey;
  fontKey: string | null;
  years: string;
  branding: Record<string, unknown>;
};

function yearsSince(raw: string | null | undefined): string {
  if (!raw) return "—";
  const start = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(start.getTime())) return "—";
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  const monthDiff = now.getMonth() - start.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < start.getDate())) years -= 1;
  return years >= 0 ? String(years) : "—";
}

// Encabezado de Inicio: es el mismo encabezado de la página pública (portada, logo con neón,
// nombre, estrellas, años, dibujos y colores del negocio). Además es el único lugar donde se
// escribe el anuncio público: aparece en la página pública arriba del logo y dura 12 horas.
export function NegocioHero({ businessId }: { businessId: string | null }) {
  const { profile } = useAuth();
  const canEdit = profile?.role !== "profesional";
  const [data, setData] = React.useState<HeroData | null>(null);
  const [rating, setRating] = React.useState<{ avg: number | null; count: number }>({ avg: null, count: 0 });
  const [now, setNow] = React.useState(() => Date.now());
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!businessId) return;
    const [bizRes, settingsRes, statsRes] = await Promise.all([
      supabase.from("businesses").select("name,logo_url,avatar_url,cover_url,business_start_date").eq("id", businessId).maybeSingle(),
      supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle(),
      (supabase.from("public_review_stats" as any) as any)
        .select("professional_id,avg_rating,review_count")
        .eq("business_id", businessId),
    ]);
    if (!bizRes.data) return;
    const biz = bizRes.data as {
      name: string | null;
      logo_url: string | null;
      avatar_url: string | null;
      cover_url: string | null;
      business_start_date: string | null;
    };
    const schedule = (settingsRes.data as { schedule?: Record<string, any> } | null)?.schedule;
    const branding: Record<string, any> =
      schedule && typeof schedule === "object" && typeof schedule._branding === "object" && schedule._branding ? schedule._branding : {};
    const colors = (branding.colors && typeof branding.colors === "object" ? branding.colors : {}) as Record<string, string>;
    const primary = colors.primary || colors.secondary || "#7c3aed";
    const rows = (statsRes.data ?? []) as { professional_id: string | null; avg_rating: number | string; review_count: number }[];
    const total = rows.find((r) => r.professional_id == null);
    setRating({ avg: total ? Number(total.avg_rating) : null, count: total?.review_count ?? 0 });
    setData({
      name: biz.name ?? "Mi negocio",
      avatarUrl: biz.avatar_url || biz.logo_url || null,
      coverUrl: biz.cover_url || null,
      avatarPosition: typeof branding.avatar_position === "string" ? branding.avatar_position : "50% 50%",
      coverPosition: typeof branding.cover_position === "string" ? branding.cover_position : "50% 50%",
      primary,
      secondary: colors.secondary || primary,
      accent: colors.accent || "#d6b66a",
      light: branding.theme === "light",
      decor: normalizePublicDecor(branding.decor),
      neon: normalizePublicNeon(branding.neon),
      bg: normalizePublicBg(branding.bg_style),
      fontKey: typeof branding.font === "string" ? branding.font : null,
      years: yearsSince(biz.business_start_date),
      branding,
    });
  }, [businessId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Reloj para el tiempo restante y para que el anuncio desaparezca solo a las 12 hs.
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);

  const remaining = data ? announcementRemainingMs(data.branding, now) : 0;
  const text = data ? activeAnnouncement(data.branding, now) : "";

  async function persist(patch: Record<string, unknown>) {
    if (!businessId) return false;
    setSaving(true);
    // Se relee antes de guardar para no pisar lo que se haya cambiado en Configuración.
    const { data: row } = await supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle();
    const schedule = ((row?.schedule ?? {}) as Record<string, any>) || {};
    const branding = (schedule._branding && typeof schedule._branding === "object" ? schedule._branding : {}) as Record<string, unknown>;
    const next = { ...schedule, _branding: { ...branding, ...patch } };
    const { error } = await supabase
      .from("business_settings")
      .upsert({ business_id: businessId, schedule: next }, { onConflict: "business_id" });
    setSaving(false);
    if (error) {
      toast.error("No se pudo guardar el anuncio");
      return false;
    }
    setData((d) => (d ? { ...d, branding: { ...d.branding, ...patch } } : d));
    setNow(Date.now());
    return true;
  }

  async function publish() {
    const value = draft.trim().slice(0, ANNOUNCEMENT_MAX_CHARS);
    if (!value) return toast.error("Escribí el anuncio antes de publicarlo");
    const ok = await persist({ profile_note: value, profile_note_active: true, profile_note_at: new Date().toISOString() });
    if (ok) {
      toast.success("Anuncio publicado por 12 horas");
      setEditing(false);
    }
  }

  async function remove() {
    const ok = await persist({ profile_note_active: false });
    if (ok) {
      toast.success("Anuncio quitado");
      setEditing(false);
    }
  }

  function openEditor() {
    if (!canEdit) return;
    setDraft(text);
    setEditing(true);
  }

  if (!data) return <div className="mb-5 h-72 animate-pulse rounded-3xl bg-white/[0.03]" />;

  const font = getPublicFont(data.fontKey);
  const bubble = text ? (
    <AnnouncementBubble>
      {canEdit ? (
        <button type="button" onClick={openEditor} className="cursor-pointer text-center" title="Editar anuncio">
          {text}
        </button>
      ) : (
        text
      )}
    </AnnouncementBubble>
  ) : canEdit ? (
    <AnnouncementBubble>
      <button type="button" onClick={openEditor} className="flex cursor-pointer items-center justify-center gap-1.5 text-center" title="Escribir anuncio">
        <Megaphone className="h-3.5 w-3.5 shrink-0 text-violet-600" />
        <span>
          Escribí un anuncio
          <span className="block text-[10px] font-medium text-zinc-500">se muestra 12 hs</span>
        </span>
      </button>
    </AnnouncementBubble>
  ) : undefined;

  return (
    <div className="mb-5">
      {font ? <link rel="stylesheet" href={publicFontsStylesheet([font])} /> : null}
      <PublicHero
        className="overflow-hidden rounded-3xl border border-white/10"
        background={pageBackground(data.bg, data.light, data.primary, data.secondary)}
        name={data.name}
        coverUrl={data.coverUrl}
        avatarUrl={data.avatarUrl}
        avatarPosition={data.avatarPosition}
        coverPosition={data.coverPosition}
        primary={data.primary}
        secondary={data.secondary}
        accent={data.accent}
        light={data.light}
        decor={data.decor}
        neon={data.neon}
        flat={data.bg === "liso"}
        entryEffect="none"
        playFx={false}
        effectRun={0}
        fontFamily={font?.family ?? null}
        ratingAvg={rating.avg}
        ratingCount={rating.count}
        years={data.years}
        bubble={bubble}
      />
      {text ? (
        <p className="mt-2 px-1 text-xs text-white/55">
          Tu anuncio se ve en tu página pública y se borra solo en {formatRemaining(remaining)}.
        </p>
      ) : null}

      {editing ? (
        <div className="fixed inset-0 z-[300] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setEditing(false)}>
          <div
            className="w-full max-w-md space-y-4 rounded-3xl border border-violet-400/25 bg-[#0d0b14] p-5 text-white shadow-[0_0_60px_-18px_rgba(139,92,246,0.8)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <Megaphone className="h-4 w-4 text-violet-300" /> Anuncio público
              </h3>
              <button type="button" onClick={() => setEditing(false)} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-white/55">
              Lo que escribas se muestra en tu página pública, arriba del logo, durante 12 horas. Después se borra solo.
            </p>
            <textarea
              autoFocus
              value={draft}
              maxLength={ANNOUNCEMENT_MAX_CHARS}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ej: Hoy atendemos hasta las 22 hs"
              className="min-h-[88px] w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white outline-none placeholder:text-white/35 focus:border-violet-300/50"
            />
            <div className="text-right text-[11px] text-white/45">
              {draft.length}/{ANNOUNCEMENT_MAX_CHARS}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void publish()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Publicar por 12 hs
              </button>
              {text ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void remove()}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/70 hover:bg-white/10 disabled:opacity-60"
                >
                  Quitar
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
