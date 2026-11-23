import * as React from "react";
import { Briefcase, Camera, Instagram, MapPin, Scissors, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AvatarCropper } from "@/components/settings/avatar-cropper";
import { startCardCls, startCardStyle } from "@/components/auth/start-shell";

const SPECIALTIES = ["Corte", "Degradé", "Barba", "Color", "Alisado", "Diseños", "Niños"];

const inputCls =
  "h-14 w-full min-w-0 rounded-2xl border border-white/10 bg-black/30 pl-12 pr-4 text-lg font-semibold text-white placeholder:text-white/35 focus:border-violet-400/50 focus:outline-none";

type ProfileRow = {
  full_name: string;
  avatar_url: string | null;
  zone: string | null;
  experience_since: string | null;
  specialties: string[] | null;
  bio: string | null;
  instagram: string | null;
};

// Ficha permanente del profesional: queda guardada aunque cambie de barbería.
export function ProfessionalProfileForm({ userId, defaultName }: { userId: string; defaultName: string }) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState(defaultName);
  const [avatar, setAvatar] = React.useState("");
  const [zone, setZone] = React.useState("");
  const [since, setSince] = React.useState("");
  const [specialties, setSpecialties] = React.useState<string[]>([]);
  const [bio, setBio] = React.useState("");
  const [instagram, setInstagram] = React.useState("");
  const [cropSrc, setCropSrc] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await (supabase as any)
        .from("professional_profiles")
        .select("full_name,avatar_url,zone,experience_since,specialties,bio,instagram")
        .eq("user_id", userId)
        .maybeSingle();
      if (!alive) return;
      const row = data as ProfileRow | null;
      if (row) {
        setName(row.full_name);
        setAvatar(row.avatar_url ?? "");
        setZone(row.zone ?? "");
        setSince(row.experience_since ?? "");
        setSpecialties(row.specialties ?? []);
        setBio(row.bio ?? "");
        setInstagram(row.instagram ?? "");
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  async function uploadAvatar(file: File) {
    setUploading(true);
    const path = `${userId}/${Date.now()}.${file.type === "image/jpeg" ? "jpg" : "webp"}`;
    const { error } = await supabase.storage
      .from("perfiles-profesionales")
      .upload(path, file, { cacheControl: "3600", upsert: true, contentType: file.type || "image/webp" });
    setUploading(false);
    if (error) return toast.error("No se pudo subir la foto");
    setAvatar(supabase.storage.from("perfiles-profesionales").getPublicUrl(path).data.publicUrl);
  }

  async function save() {
    if (!name.trim()) return toast.error("Ingresá tu nombre");
    setSaving(true);
    const { error } = await (supabase as any).from("professional_profiles").upsert(
      {
        user_id: userId,
        full_name: name.trim(),
        avatar_url: avatar || null,
        zone: zone.trim() || null,
        experience_since: since || null,
        specialties,
        bio: bio.trim() || null,
        instagram: instagram.trim().replace(/^@/, "") || null,
      },
      { onConflict: "user_id" },
    );
    setSaving(false);
    if (error) return toast.error("No se pudo guardar tu perfil");
    toast.success("Perfil guardado");
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
          <div className="min-w-0 flex-1 text-lg font-semibold">{uploading ? "Subiendo foto…" : avatar ? "Tu foto" : "Agregá tu foto"}</div>
        </div>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-base font-semibold text-white/85">Nombre</span>
        <span className="relative block">
          <UserRound className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-base font-semibold text-white/85">Zona</span>
        <span className="relative block">
          <MapPin className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
          <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Ej: Palermo, CABA" className={inputCls} />
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-base font-semibold text-white/85">Trabajo en el rubro desde</span>
        <span className="relative block">
          <Briefcase className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className={`${inputCls} block max-w-full appearance-none [color-scheme:dark]`} />
        </span>
      </label>

      <div>
        <span className="mb-1.5 flex items-center gap-2 text-base font-semibold text-white/85">
          <Scissors className="h-5 w-5 text-violet-300" /> Especialidades
        </span>
        <div className="flex flex-wrap gap-2">
          {SPECIALTIES.map((s) => {
            const on = specialties.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSpecialties((cur) => (on ? cur.filter((x) => x !== s) : [...cur, s]))}
                className={`h-11 rounded-full px-4 text-base font-semibold ring-1 transition ${
                  on ? "bg-gradient-to-r from-sky-400 to-violet-500 text-white ring-violet-300/40" : "bg-white/[0.04] text-white/70 ring-white/10"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-base font-semibold text-white/85">Sobre mí</span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 400))}
          rows={4}
          placeholder="Contá tu experiencia y tu estilo de trabajo"
          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-lg font-semibold text-white placeholder:text-white/35 focus:border-violet-400/50 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-base font-semibold text-white/85">Instagram</span>
        <span className="relative block">
          <Instagram className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
          <input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="tu_usuario" className={inputCls} />
        </span>
      </label>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || uploading}
        className="h-14 w-full rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-lg font-semibold text-white shadow-[0_0_22px_-6px_rgba(139,92,246,0.8)] transition active:scale-[0.99] disabled:opacity-60"
      >
        {saving ? "Guardando…" : "Guardar perfil"}
      </button>

      {cropSrc && (
        <AvatarCropper
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
