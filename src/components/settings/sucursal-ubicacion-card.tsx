import * as React from "react";
import { Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SectionCard, inputCls } from "@/components/settings/shared";

type BranchLoc = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  checkin_radius_m: number | null;
};

const DEFAULT_RADIUS = 150;

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
export function SucursalUbicacionCard({
  businessId,
  branches,
}: {
  businessId: string | null;
  branches: { id: string; name: string; address?: string | null }[];
}) {
  const [rows, setRows] = React.useState<Record<string, BranchLoc> | null>(null);
  const [radii, setRadii] = React.useState<Record<string, string>>({});
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [candidates, setCandidates] = React.useState<Record<string, Candidate>>({});
  const [pasted, setPasted] = React.useState<Record<string, string>>({});
  const [openId, setOpenId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!businessId) return;
    const { data, error } = await supabase
      .from("branches" as any)
      .select("id,latitude,longitude,checkin_radius_m")
      .eq("business_id", businessId);
    // Si las columnas todavía no existen (migración sin aplicar), la tarjeta no se muestra.
    if (error) {
      setRows(null);
      return;
    }
    const map: Record<string, BranchLoc> = {};
    const rad: Record<string, string> = {};
    for (const r of (data ?? []) as BranchLoc[]) {
      map[r.id] = r;
      rad[r.id] = String(r.checkin_radius_m ?? DEFAULT_RADIUS);
    }
    setRows(map);
    setRadii(rad);
  }, [businessId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save(branchId: string, patch: Partial<BranchLoc>) {
    setSavingId(branchId);
    const { error } = await supabase
      .from("branches" as any)
      .update(patch)
      .eq("id", branchId);
    setSavingId(null);
    if (error) {
      toast.error("No se pudo guardar la ubicación. Probá de nuevo.");
      return false;
    }
    await load();
    return true;
  }

  async function searchAddress(branchId: string, address: string | null | undefined) {
    if (!address?.trim()) {
      toast.error("Esta sucursal no tiene dirección cargada. Pegá un link de Google Maps o las coordenadas.");
      return;
    }
    setSavingId(branchId);
    try {
      const found = await geocodeAddress(address);
      if (!found) {
        toast.error("No encontré esa dirección. Pegá un link de Google Maps o las coordenadas.");
        return;
      }
      setCandidates((m) => ({ ...m, [branchId]: found }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  function usePasted(branchId: string) {
    const parsed = parseCoords(pasted[branchId] ?? "");
    if (!parsed) {
      toast.error("No pude leer coordenadas. Pegá un link largo de Google Maps o 'latitud, longitud'.");
      return;
    }
    setCandidates((m) => ({ ...m, [branchId]: { ...parsed, label: "Coordenadas ingresadas" } }));
  }

  async function confirmCandidate(branchId: string) {
    const c = candidates[branchId];
    if (!c) return;
    if (await save(branchId, { latitude: c.lat, longitude: c.lng })) {
      toast.success("Ubicación de la sucursal guardada.");
      setCandidates((m) => {
        const { [branchId]: _drop, ...rest } = m;
        return rest;
      });
      setOpenId(null);
    }
  }

  async function saveRadius(branchId: string) {
    const value = Math.round(Number(radii[branchId]));
    if (!Number.isFinite(value) || value < 30 || value > 1000) {
      toast.error("El radio tiene que estar entre 30 y 1000 metros.");
      return;
    }
    if (await save(branchId, { checkin_radius_m: value })) toast.success("Radio guardado.");
  }

  if (!rows || branches.length === 0) return null;

  return (
    <SectionCard label="Ubicación para fichar">
      <p className="mb-3 text-sm text-muted-foreground">
        Para que el equipo pueda fichar con su ubicación, fijá la de cada sucursal por su dirección o con un link de
        Google Maps. Solo se puede fichar dentro del radio indicado.
      </p>
      <div className="space-y-2">
        {branches.map((b) => {
          const loc = rows[b.id];
          const hasLoc = loc?.latitude != null && loc?.longitude != null;
          const busy = savingId === b.id;
          return (
            <div key={b.id} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{b.name}</div>
                  <div className={hasLoc ? "text-xs text-emerald-300" : "text-xs text-amber-300"}>
                    {hasLoc ? "Ubicación guardada" : "Sin ubicación: solo se puede fichar con QR"}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const opening = openId !== b.id;
                    setOpenId(opening ? b.id : null);
                    if (opening && b.address?.trim() && !candidates[b.id]) void searchAddress(b.id, b.address);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-foreground ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-60"
                >
                  <MapPin className="size-3.5" />
                  {hasLoc ? "Cambiar ubicación" : "Fijar ubicación"}
                </button>
              </div>
              {hasLoc && (
                <a
                  href={mapsUrl({ lat: loc.latitude as number, lng: loc.longitude as number })}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs text-sky-300 underline"
                >
                  Ver la ubicación guardada en el mapa
                </a>
              )}
              {openId === b.id && (
                <div className="mt-3 space-y-2 rounded-xl bg-black/20 p-3 ring-1 ring-white/10">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void searchAddress(b.id, b.address)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-60"
                  >
                    {busy && <Loader2 className="size-3.5 animate-spin" />}
                    Buscar por la dirección{b.address ? `: ${b.address}` : ""}
                  </button>
                  <div className="flex items-center gap-2">
                    <input
                      className={`${inputCls} !h-9 flex-1`}
                      placeholder="O pegá un link de Google Maps o 'lat, lng'"
                      value={pasted[b.id] ?? ""}
                      onChange={(e) => setPasted((m) => ({ ...m, [b.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      onClick={() => usePasted(b.id)}
                      className="rounded-lg bg-white/5 px-3 py-1.5 text-xs ring-1 ring-white/10 hover:bg-white/10"
                    >
                      Usar
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    En Google Maps, mantené apretado el punto exacto del local: arriba aparecen las coordenadas para copiar.
                  </p>
                  {candidates[b.id] && (
                    <div className="rounded-lg bg-white/5 p-2.5 text-xs ring-1 ring-white/10">
                      <div className="text-foreground">{candidates[b.id].label}</div>
                      <iframe
                        title={`Mapa de ${b.name}`}
                        src={osmEmbedUrl(candidates[b.id])}
                        loading="lazy"
                        className="my-2 h-48 w-full rounded-lg border-0"
                      />
                      <a
                        href={mapsUrl(candidates[b.id])}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-300 underline"
                      >
                        Abrir en Google Maps
                      </a>
                      <div className="mt-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void confirmCandidate(b.id)}
                          className="rounded-lg bg-gradient-to-r from-sky-400 to-violet-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          Es el lugar correcto, guardar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {hasLoc && (
                <div className="mt-2.5 flex items-center gap-2">
                  <label className="text-xs text-muted-foreground" htmlFor={`radio-${b.id}`}>
                    Radio (metros)
                  </label>
                  <input
                    id={`radio-${b.id}`}
                    type="number"
                    inputMode="numeric"
                    min={30}
                    max={1000}
                    className={`${inputCls} !h-9 w-24`}
                    value={radii[b.id] ?? String(DEFAULT_RADIUS)}
                    onChange={(e) => setRadii((m) => ({ ...m, [b.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveRadius(b.id)}
                    className="rounded-lg bg-white/5 px-3 py-1.5 text-xs ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-60"
                  >
                    Guardar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
