import * as React from "react";
import { Loader2 } from "lucide-react";
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
// Ubicación de UNA sucursal para fichar, dentro de Editar. Al escribir la
// dirección, el mapa se actualiza solo con el punto encontrado; la ubicación
// se guarda junto con el resto al tocar "Guardar" (onPendingChange le avisa al
// padre qué punto guardar). Si hace falta, se puede pegar un link o
// coordenadas de Google Maps. Si todavía no existen las columnas, no se muestra.
export function SucursalUbicacion({
  branchId,
  branchName,
  address,
  savedAddress,
  onPendingChange,
}: {
  branchId: string;
  branchName: string;
  address: string;
  savedAddress?: string | null;
  onPendingChange: (coords: { lat: number; lng: number } | null) => void;
}) {
  const [loaded, setLoaded] = React.useState(false);
  const [loc, setLoc] = React.useState<BranchLoc | null>(null);
  const [candidate, setCandidate] = React.useState<Candidate | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [notFound, setNotFound] = React.useState(false);
  const [showPaste, setShowPaste] = React.useState(false);
  const [pasted, setPasted] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    void supabase
      .from("branches" as any)
      .select("id,latitude,longitude,checkin_radius_m")
      .eq("id", branchId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoc(error || !data ? null : (data as unknown as BranchLoc));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  const hasLoc = loc?.latitude != null && loc?.longitude != null;

  // Cambió la dirección escrita: se vuelve a buscar sola (con una pausa corta).
  // Un punto pegado a mano rige hasta que se vuelva a tocar la dirección.
  React.useEffect(() => {
    if (!loaded || !loc) return;
    const trimmed = address.trim();
    setNotFound(false);
    if (hasLoc && trimmed === (savedAddress ?? "").trim()) {
      setCandidate(null);
      return;
    }
    if (trimmed.length < 5) {
      setCandidate(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await geocodeAddress(trimmed);
        if (cancelled) return;
        setCandidate(found);
        setNotFound(!found);
      } catch {
        if (!cancelled) {
          setCandidate(null);
          setNotFound(true);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, loaded, hasLoc]);

  React.useEffect(() => {
    onPendingChange(candidate ? { lat: candidate.lat, lng: candidate.lng } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate]);

  function usePasted() {
    const parsed = parseCoords(pasted);
    if (!parsed) {
      toast.error("No pude leer coordenadas. Pegá un link largo de Google Maps o 'latitud, longitud'.");
      return;
    }
    setNotFound(false);
    setCandidate({ ...parsed, label: "Coordenadas ingresadas" });
    setShowPaste(false);
    setPasted("");
  }

  if (!loc) return null;

  const point = candidate ?? (hasLoc ? { lat: loc.latitude as number, lng: loc.longitude as number } : null);

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        La ubicación sale de la dirección: escribila arriba y el mapa se actualiza solo.
      </div>
      {searching && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Buscando la dirección…
        </div>
      )}
      {!searching && notFound && (
        <div className="text-xs text-amber-300">
          No encontré esa dirección. Probá agregando la ciudad o pegá un link de Google Maps.
        </div>
      )}
      {!searching && !point && !notFound && (
        <div className="text-xs text-amber-300">Sin ubicación: solo se puede fichar con QR</div>
      )}
      {point && (
        <div className="rounded-xl bg-black/20 p-2.5 ring-1 ring-white/10">
          {candidate && candidate.label && (
            <div className="mb-2 text-xs text-foreground">{candidate.label}</div>
          )}
          <iframe
            title={`Mapa de ${branchName}`}
            src={osmEmbedUrl(point)}
            loading="lazy"
            className="h-48 w-full rounded-lg border-0"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <a href={mapsUrl(point)} target="_blank" rel="noreferrer" className="text-sky-300 underline">
              Abrir en Google Maps
            </a>
            {candidate && <span className="text-muted-foreground">Se guarda al tocar Guardar.</span>}
          </div>
        </div>
      )}
      <div>
        <button
          type="button"
          onClick={() => setShowPaste((v) => !v)}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          ¿No es el lugar? Pegá un link de Google Maps
        </button>
        {showPaste && (
          <div className="mt-2 flex items-center gap-2">
            <input
              className={`${inputCls} !h-9 flex-1`}
              placeholder="Link de Google Maps o 'lat, lng'"
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
        )}
      </div>
    </div>
  );
}
