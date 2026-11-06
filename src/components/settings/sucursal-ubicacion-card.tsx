import * as React from "react";
import { Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { inputCls } from "@/components/settings/shared";

type BranchLoc = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  checkin_radius_m: number | null;
};

// Ubicación fija de cada sucursal para fichar con "Usar mi ubicación": se
// busca por la dirección de la sucursal o se pega un link / coordenadas de
// Google Maps (no depende de dónde esté parado quien la carga), se confirma
// en el mapa y define, junto con el radio (150 m por defecto), dónde se puede fichar.
type Candidate = { lat: number; lng: number; label: string };

// Acepta "-34.60, -58.38", links de Google Maps con @lat,lng / !3d..!4d.. / ?q=lat,lng.
function parseCoords(input: string): { lat: number; lng: number } | null {
  const text = decodeURIComponent(input.trim());
  const patterns = [
    /@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
    /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    /[?&](?:q|ll|query)=(-?\d{1,3}(?:\.\d+)?)[,+ ]+(-?\d{1,3}(?:\.\d+)?)/,
    /^(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

async function geocodeAddress(address: string): Promise<Candidate | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ar&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("No se pudo buscar la dirección.");
  const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (!data.length) return null;
  return { lat: Number(data[0].lat), lng: Number(data[0].lon), label: data[0].display_name };
}

function osmEmbedUrl(c: { lat: number; lng: number }) {
  const d = 0.003;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${c.lng - d},${c.lat - d},${c.lng + d},${c.lat + d}&layer=mapnik&marker=${c.lat},${c.lng}`;
}

function mapsUrl(c: { lat: number; lng: number }) {
  return `https://www.google.com/maps?q=${c.lat},${c.lng}`;
}
// Ubicación de UNA sucursal para fichar, dentro de su propia tarjeta en
// Sucursales. Si todavía no existen las columnas, no se muestra nada.
export function SucursalUbicacion({
  branchId,
  branchName,
  address,
}: {
  branchId: string;
  branchName: string;
  address?: string | null;
}) {
  const [loc, setLoc] = React.useState<BranchLoc | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [candidate, setCandidate] = React.useState<Candidate | null>(null);
  const [pasted, setPasted] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    const { data, error } = await supabase
      .from("branches" as any)
      .select("id,latitude,longitude,checkin_radius_m")
      .eq("id", branchId)
      .maybeSingle();
    if (error || !data) {
      setLoc(null);
      return;
    }
    const row = data as unknown as BranchLoc;
    setLoc(row);
  }, [branchId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Partial<BranchLoc>) {
    setSaving(true);
    const { error } = await supabase
      .from("branches" as any)
      .update(patch)
      .eq("id", branchId);
    setSaving(false);
    if (error) {
      toast.error("No se pudo guardar la ubicación. Probá de nuevo.");
      return false;
    }
    await load();
    return true;
  }

  async function searchAddress() {
    if (!address?.trim()) {
      toast.error("Esta sucursal no tiene dirección cargada. Pegá un link de Google Maps o las coordenadas.");
      return;
    }
    setSaving(true);
    try {
      const found = await geocodeAddress(address);
      if (!found) {
        toast.error("No encontré esa dirección. Pegá un link de Google Maps o las coordenadas.");
        return;
      }
      setCandidate(found);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function usePasted() {
    const parsed = parseCoords(pasted);
    if (!parsed) {
      toast.error("No pude leer coordenadas. Pegá un link largo de Google Maps o 'latitud, longitud'.");
      return;
    }
    setCandidate({ ...parsed, label: "Coordenadas ingresadas" });
  }

  async function confirmCandidate() {
    if (!candidate) return;
    if (await save({ latitude: candidate.lat, longitude: candidate.lng })) {
      toast.success("Ubicación de la sucursal guardada.");
      setCandidate(null);
      setOpen(false);
    }
  }

  if (!loc) return null;
  const hasLoc = loc.latitude != null && loc.longitude != null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            const opening = !open;
            setOpen(opening);
            if (opening && address?.trim() && !candidate) void searchAddress();
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-foreground ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-60"
        >
          <MapPin className="size-3.5" />
          {hasLoc ? "Cambiar ubicación" : "Fijar ubicación"}
        </button>
        {hasLoc ? (
          <a
            href={mapsUrl({ lat: loc.latitude as number, lng: loc.longitude as number })}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-sky-300 underline"
          >
            Ver la ubicación en el mapa
          </a>
        ) : (
          <div className="text-xs text-amber-300">Sin ubicación: solo se puede fichar con QR</div>
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-2 rounded-xl bg-black/20 p-3 ring-1 ring-white/10">
          <button
            type="button"
            disabled={saving}
            onClick={() => void searchAddress()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-60"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Buscar por la dirección{address ? `: ${address}` : ""}
          </button>
          <div className="flex items-center gap-2">
            <input
              className={`${inputCls} !h-9 flex-1`}
              placeholder="O pegá un link de Google Maps o 'lat, lng'"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <button
              type="button"
              onClick={usePasted}
              className="rounded-lg bg-white/5 px-3 py-1.5 text-xs ring-1 ring-white/10 hover:bg-white/10"
            >
              Usar
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            En Google Maps, mantené apretado el punto exacto del local: arriba aparecen las coordenadas para copiar.
          </p>
          {candidate && (
            <div className="rounded-lg bg-white/5 p-2.5 text-xs ring-1 ring-white/10">
              <div className="text-foreground">{candidate.label}</div>
              <iframe
                title={`Mapa de ${branchName}`}
                src={osmEmbedUrl(candidate)}
                loading="lazy"
                className="my-2 h-48 w-full rounded-lg border-0"
              />
              <a href={mapsUrl(candidate)} target="_blank" rel="noreferrer" className="text-sky-300 underline">
                Abrir en Google Maps
              </a>
              <div className="mt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void confirmCandidate()}
                  className="rounded-lg bg-gradient-to-r from-sky-400 to-violet-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  Es el lugar correcto, guardar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
