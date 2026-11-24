import * as React from "react";
import { Briefcase, Cake, Camera, Star, Flag, Image as ImageIcon, Instagram, MapPin, MessageCircle, Plus, Tag, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AvatarCropper } from "@/components/settings/avatar-cropper";
import { startCardCls, startCardStyle } from "@/components/auth/start-shell";

const SUGGESTED = ["Corte", "Degradé", "Barba", "Color", "Alisado", "Diseños", "Niños"];
const MAX_SPECIALTIES = 8;
const MAX_PHOTOS = 3;
const NATIONALITIES = [
  "Argentina", "Bolivia", "Brasil", "Chile", "Colombia", "Cuba", "Ecuador", "España", "Italia", "México",
  "Paraguay", "Perú", "República Dominicana", "Uruguay", "Venezuela",
];

const inputCls =
  "h-14 w-full min-w-0 max-w-full appearance-none rounded-2xl border border-white/10 bg-black/30 pl-12 pr-4 text-lg font-semibold text-white placeholder:text-white/35 focus:border-violet-400/50 focus:outline-none [color-scheme:dark]";

type ProfileRow = {
  full_name: string;
  avatar_url: string | null;
  zone: string | null;
  experience_since: string | null;
  specialties: string[] | null;
  bio: string | null;
  instagram: string | null;
  nationality: string | null;
  photos: string[] | null;
};

function Label({ icon: Icon, children, extra }: { icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <span className="mb-1.5 flex items-center justify-between gap-2 text-base font-semibold text-white/85">
      <span className="flex items-center gap-2">
        {Icon && <Icon className="h-5 w-5 text-violet-300" />}
        {children}
      </span>
      {extra}
    </span>
  );
}

// Ficha permanente del profesional: queda guardada aunque cambie de barbería.
export function ProfessionalProfileForm({ userId, defaultName }: { userId: string; defaultName: string }) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState(defaultName);
  const [avatar, setAvatar] = React.useState("");
  const [zone, setZone] = React.useState("");
  const [since, setSince] = React.useState("");
  const [nationality, setNationality] = React.useState("");
  const [birth, setBirth] = React.useState("");
  const [whatsapp, setWhatsapp] = React.useState("");
  const [specialties, setSpecialties] = React.useState<string[]>([]);
  const [adding, setAdding] = React.useState(false);
  const [newSpec, setNewSpec] = React.useState("");
  const [bio, setBio] = React.useState("");
  const [instagram, setInstagram] = React.useState("");
  const [photos, setPhotos] = React.useState<string[]>([]);
  const [cropSrc, setCropSrc] = React.useState<string | null>(null);
  const [workCropSrc, setWorkCropSrc] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [savedSnap, setSavedSnap] = React.useState<string | null>(null);
  const [reviews, setReviews] = React.useState<{ count: number; avg: number | null }>({ count: 0, avg: null });

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      void (async () => {
        const { data } = await (supabase as any).rpc("my_review_stats");
        const r = (data as Array<{ reviews_count: number; reviews_avg: number | null }> | null)?.[0];
        if (alive && r) setReviews({ count: r.reviews_count, avg: r.reviews_avg });
      })();
      const [pub, priv] = await Promise.all([
        (supabase as any)
          .from("professional_profiles")
          .select("full_name,avatar_url,zone,experience_since,specialties,bio,instagram,nationality,photos")
          .eq("user_id", userId)
          .maybeSingle(),
        (supabase as any).from("professional_private").select("birth_date,whatsapp").eq("user_id", userId).maybeSingle(),
      ]);
      if (!alive) return;
      const row = pub.data as ProfileRow | null;
      if (row) {
        setName(row.full_name);
        setAvatar(row.avatar_url ?? "");
        setZone(row.zone ?? "");
        setSince(row.experience_since ?? "");
        setSpecialties(row.specialties ?? []);
        setBio(row.bio ?? "");
        setInstagram(row.instagram ?? "");
        setNationality(row.nationality ?? "");
        setPhotos(row.photos ?? []);
      }
      const pv = priv.data as { birth_date?: string | null; whatsapp?: string | null } | null;
      setSavedSnap(
        makeSnap({
          name: row?.full_name ?? defaultName, avatar: row?.avatar_url ?? "", zone: row?.zone ?? "", since: row?.experience_since ?? "",
          nationality: row?.nationality ?? "", birth: pv?.birth_date ?? "", whatsapp: pv?.whatsapp ?? "", specialties: row?.specialties ?? [],
          bio: row?.bio ?? "", instagram: row?.instagram ?? "", photos: row?.photos ?? [],
        }),
      );
      const p = priv.data as { birth_date: string | null; whatsapp: string | null } | null;
      if (p) {
        setBirth(p.birth_date ?? "");
        setWhatsapp(p.whatsapp ?? "");
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  async function uploadBlob(blob: Blob, folder: string): Promise<string | null> {
    const ext = blob.type === "image/jpeg" ? "jpg" : "webp";
    const path = `${userId}/${folder}${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("perfiles-profesionales")
      .upload(path, blob, { cacheControl: "3600", upsert: true, contentType: blob.type || "image/webp" });
    if (error) {
      toast.error("No se pudo subir la foto");
      return null;
    }
    return supabase.storage.from("perfiles-profesionales").getPublicUrl(path).data.publicUrl;
  }

  async function uploadAvatar(file: File) {
    setUploading(true);
    let url: string | null = null;
    try {
      url = await uploadBlob(file, "");
    } catch {
      toast.error("No se pudo subir la foto");
    } finally {
      setUploading(false);
    }
    if (url) {
      setAvatar(url);
      void save({ avatar: url });
    }
  }

  async function addWorkPhoto(file: File) {
    if (photos.length >= MAX_PHOTOS) return;
    setUploading(true);
    let url: string | null = null;
    try {
      url = await uploadBlob(file, "trabajos/");
    } catch {
      toast.error("No se pudo subir la foto");
    } finally {
      setUploading(false);
    }
    if (url) {
      const next = [...latest.current.photos, url].slice(0, MAX_PHOTOS);
      setPhotos(next);
      void save({ photos: next });
    }
  }

  function addSpecialty(raw: string) {
    const value = raw.trim().slice(0, 24);
    if (!value) return;
    if (specialties.length >= MAX_SPECIALTIES) return toast.error(`Máximo ${MAX_SPECIALTIES} especialidades`);
    if (specialties.some((s) => s.toLowerCase() === value.toLowerCase())) return;
    setSpecialties((cur) => [...cur, value]);
  }

  // Valores más recientes de los campos: las subidas de fotos guardan solas, y sin esto guardaban lo que había en
  // pantalla cuando empezó la subida (pisando lo que se escribió mientras tanto).
  const latest = React.useRef({ name, avatar, zone, since, nationality, birth, whatsapp, specialties, bio, instagram, photos });
  latest.current = { name, avatar, zone, since, nationality, birth, whatsapp, specialties, bio, instagram, photos };

  const makeSnap = (f: typeof latest.current) =>
    JSON.stringify([
      f.name.trim(), f.avatar, f.zone.trim(), f.since, f.nationality, f.birth, f.whatsapp.replace(/\D/g, ""), f.specialties, f.bio.trim(),
      f.instagram.trim().replace(/^@/, ""), f.photos,
    ]);
  const snap = makeSnap({ name, avatar, zone, since, nationality, birth, whatsapp, specialties, bio, instagram, photos });
  const dirty = savedSnap !== null && snap !== savedSnap;

  async function save(over?: { avatar?: string; photos?: string[] }) {
    const f = { ...latest.current, ...(over?.avatar !== undefined ? { avatar: over.avatar } : {}), ...(over?.photos ? { photos: over.photos } : {}) };
    if (!f.name.trim()) return toast.error("Ingresá tu nombre");
    setSaving(true);
    try {
      const [a, b] = await Promise.all([
        (supabase as any).from("professional_profiles").upsert(
          {
            user_id: userId,
            full_name: f.name.trim(),
            avatar_url: f.avatar || null,
            zone: f.zone.trim() || null,
            experience_since: f.since || null,
            specialties: f.specialties,
            bio: f.bio.trim() || null,
            instagram: f.instagram.trim().replace(/^@/, "") || null,
            nationality: f.nationality || null,
            photos: f.photos,
          },
          { onConflict: "user_id" },
        ),
        (supabase as any).from("professional_private").upsert(
          { user_id: userId, birth_date: f.birth || null, whatsapp: f.whatsapp.replace(/\D/g, "") || null },
          { onConflict: "user_id" },
        ),
      ]);
      if (a.error || b.error) return toast.error("No se pudo guardar tu perfil");
      setSavedSnap(makeSnap(f));
      toast.success("Perfil guardado");
    } catch {
      toast.error("No se pudo guardar tu perfil. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="py-10 text-center text-white/60">Cargando…</div>;

  return (
    <div className="space-y-4">
      <div className={`${startCardCls} p-4`} style={startCardStyle}>
        <div className="flex items-center gap-4">
          <label className="relative h-20 w-20 shrink-0 cursor-pointer">
            <span className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-violet-500/20 text-2xl font-semibold text-violet-100 ring-2 ring-violet-400/40">
              {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" /> : (name[0] || "?").toUpperCase()}
            </span>
            <span className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-violet-500 text-white ring-2 ring-[#05040b]">
              <Camera className="h-4 w-4" />
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setCropSrc(URL.createObjectURL(f));
                e.currentTarget.value = "";
              }}
            />
          </label>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold">{uploading ? "Subiendo…" : avatar ? "Tu foto" : "Agregá tu foto"}</div>
            {reviews.count > 0 && (
              <div className="mt-1 flex items-center gap-1 text-base text-white/65">
                <Star className="h-4 w-4 text-amber-300" />
                {reviews.avg} ({reviews.count} reseñas)
              </div>
            )}
          </div>
        </div>
      </div>

      <label className="block">
        <Label>Nombre</Label>
        <span className="relative block">
          <UserRound className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputCls} />
        </span>
      </label>

      <label className="block">
        <Label>Zona</Label>
        <span className="relative block">
          <MapPin className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
          <input value={zone} onChange={(e) => setZone(e.target.value)} maxLength={60} placeholder="Ej: Palermo, CABA" className={inputCls} />
        </span>
      </label>

      <label className="block">
        <Label>Fecha de nacimiento</Label>
        <span className="relative block">
          <Cake className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
          <input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} className={inputCls} />
        </span>
      </label>

      <label className="block">
        <Label>Nacionalidad</Label>
        <span className="relative block">
          <Flag className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
          <select value={nationality} onChange={(e) => setNationality(e.target.value)} className={inputCls}>
            <option value="">Sin indicar</option>
            {NATIONALITIES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
      </label>

      <label className="block">
        <Label>Trabajo en el rubro desde</Label>
        <span className="relative block">
          <Briefcase className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className={inputCls} />
        </span>
      </label>

      <label className="block">
        <Label>WhatsApp</Label>
        <span className="relative block">
          <MessageCircle className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
          <input
            inputMode="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value.replace(/[^\d+]/g, "").slice(0, 20))}
            placeholder="Ej: 5491155551234"
            className={inputCls}
          />
        </span>
      </label>

      <div>
        <Label icon={Tag} extra={<span className="text-sm font-medium text-white/50">{specialties.length}/{MAX_SPECIALTIES}</span>}>
          Especialidades
        </Label>
        <div className="flex flex-wrap gap-2">
          {specialties.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpecialties((cur) => cur.filter((x) => x !== s))}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 px-4 text-base font-semibold text-white ring-1 ring-violet-300/40"
            >
              {s}
              <X className="h-4 w-4" />
            </button>
          ))}
          {specialties.length < MAX_SPECIALTIES && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-11 items-center gap-1.5 rounded-full border border-dashed border-violet-400/50 px-4 text-base font-semibold text-violet-200"
            >
              <Plus className="h-4 w-4" /> Agregar
            </button>
          )}
        </div>
        {adding && specialties.length < MAX_SPECIALTIES && (
          <div className="mt-3 space-y-3">
            <div className="flex gap-2">
              <input
                autoFocus
                value={newSpec}
                onChange={(e) => setNewSpec(e.target.value.slice(0, 24))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSpecialty(newSpec);
                    setNewSpec("");
                  }
                }}
                placeholder="Escribí una especialidad"
                className="h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 text-lg font-semibold text-white placeholder:text-white/35 focus:border-violet-400/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  addSpecialty(newSpec);
                  setNewSpec("");
                }}
                className="h-12 rounded-full bg-violet-500/20 px-5 text-base font-semibold text-violet-100 ring-1 ring-violet-400/40"
              >
                Sumar
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED.filter((s) => !specialties.includes(s)).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addSpecialty(s)}
                  className="h-10 rounded-full bg-white/[0.04] px-4 text-base font-semibold text-white/70 ring-1 ring-white/10"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <label className="block">
        <Label extra={<span className="text-sm font-medium text-white/50">{bio.length}/300</span>}>Sobre mí</Label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 300))}
          maxLength={300}
          rows={4}
          placeholder="Contá tu experiencia y tu estilo de trabajo"
          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-lg font-semibold text-white placeholder:text-white/35 focus:border-violet-400/50 focus:outline-none"
        />
      </label>

      <label className="block">
        <Label>Instagram</Label>
        <span className="relative block">
          <Instagram className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
          <input value={instagram} onChange={(e) => setInstagram(e.target.value.slice(0, 30))} maxLength={30} placeholder="tu_usuario" className={inputCls} />
        </span>
      </label>

      <div>
        <Label icon={ImageIcon} extra={<span className="text-sm font-medium text-white/50">{photos.length}/{MAX_PHOTOS}</span>}>
          Fotos de tus trabajos
        </Label>
        <div className="grid grid-cols-3 gap-3">
          {photos.map((url) => (
            <div key={url} className="relative aspect-square overflow-hidden rounded-2xl ring-1 ring-white/15">
              <img src={url} alt="Trabajo" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setPhotos((cur) => cur.filter((x) => x !== url))}
                aria-label="Quitar foto"
                className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full bg-black/70 text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label className="grid aspect-square cursor-pointer place-items-center rounded-2xl border border-dashed border-violet-400/50 text-violet-200">
              <Plus className="h-7 w-7" />
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setWorkCropSrc(URL.createObjectURL(f));
                  e.currentTarget.value = "";
                }}
              />
            </label>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !dirty}
        className="h-14 w-full rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-lg font-semibold text-white shadow-[0_0_22px_-6px_rgba(139,92,246,0.8)] transition active:scale-[0.99] disabled:bg-white/[0.04] disabled:bg-none disabled:text-white/30 disabled:shadow-none"
      >
        {saving ? "Guardando…" : "Guardar perfil"}
      </button>

      {workCropSrc && (
        <AvatarCropper
          shape="square"
          size={640}
          quality={0.6}
          src={workCropSrc}
          onCancel={() => setWorkCropSrc(null)}
          onDone={(file) => {
            setWorkCropSrc(null);
            void addWorkPhoto(file);
          }}
        />
      )}

      {cropSrc && (
        <AvatarCropper
          size={256}
          quality={0.6}
          src={cropSrc}
          onCancel={() => setCropSrc(null)}
          onDone={(file) => {
            setCropSrc(null);
            void uploadAvatar(file);
          }}
        />
      )}
    </div>
  );
}
