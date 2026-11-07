// Anuncio público (globo sobre el logo): se escribe desde Inicio y dura 12 horas.
// Se guarda en business_settings.schedule._branding: profile_note (texto),
// profile_note_active (publicado) y profile_note_at (cuándo se publicó).
export const ANNOUNCEMENT_TTL_MS = 12 * 60 * 60 * 1000;
export const ANNOUNCEMENT_MAX_CHARS = 60;

type BrandingLike = {
  profile_note?: unknown;
  profile_note_active?: unknown;
  profile_note_at?: unknown;
} | null | undefined;

export function announcementRemainingMs(branding: BrandingLike, now = Date.now()): number {
  if (!branding || branding.profile_note_active !== true) return 0;
  if (typeof branding.profile_note !== "string" || !branding.profile_note.trim()) return 0;
  const at = typeof branding.profile_note_at === "string" ? Date.parse(branding.profile_note_at) : NaN;
  if (Number.isNaN(at)) return 0; // sin fecha de publicación no se muestra
  return Math.max(0, at + ANNOUNCEMENT_TTL_MS - now);
}

export function activeAnnouncement(branding: BrandingLike, now = Date.now()): string {
  if (announcementRemainingMs(branding, now) <= 0) return "";
  return (branding as { profile_note: string }).profile_note.trim().slice(0, ANNOUNCEMENT_MAX_CHARS);
}

export function formatRemaining(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
