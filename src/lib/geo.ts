// Búsqueda de direcciones con Photon (datos de OpenStreetMap), igual que usan otras apps de reservas.
// Se consulta desde el navegador: el texto que la persona escribe se envía a photon.komoot.io.
export type Place = { label: string; lat: number; lng: number };

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; street?: string; housenumber?: string; district?: string; city?: string; state?: string };
};

// Sesgo hacia Buenos Aires para que "Obelisco" o "Palermo" resuelvan acá y no en otro país.
const BIAS = "&lat=-34.6&lon=-58.45";

function labelOf(p: PhotonFeature["properties"]): string {
  const street = p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ""}` : "";
  const first = p.name || street;
  const area = p.district || p.city || p.state || "";
  return [first, area].filter((x, i, a) => x && a.indexOf(x) === i).join(", ") || "Ubicación";
}

function toPlace(f: PhotonFeature): Place {
  return { label: labelOf(f.properties), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
}

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  if (q.trim().length < 3) return [];
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q.trim())}&limit=5${BIAS}`, { signal });
  if (!r.ok) return [];
  const j = (await r.json()) as { features?: PhotonFeature[] };
  return (j.features ?? []).map(toPlace);
}

export async function reversePlace(lat: number, lng: number): Promise<Place> {
  try {
    const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`);
    const j = (await r.json()) as { features?: PhotonFeature[] };
    const f = j.features?.[0];
    if (f) return { label: labelOf(f.properties), lat, lng };
  } catch {
    /* sin red: se usa la etiqueta genérica */
  }
  return { label: "Mi ubicación", lat, lng };
}

// Ubica una dirección de un aviso (con caché en el navegador para no repetir consultas).
export async function geocodeCached(text: string): Promise<{ lat: number; lng: number } | null> {
  const key = `clippr_geo_${text.trim().toLowerCase()}`;
  try {
    const hit = localStorage.getItem(key);
    if (hit) return hit === "x" ? null : (JSON.parse(hit) as { lat: number; lng: number });
  } catch {
    /* sin storage */
  }
  const found = (await searchPlaces(`${text}, Buenos Aires`))[0] ?? (await searchPlaces(text))[0];
  const out = found ? { lat: found.lat, lng: found.lng } : null;
  try {
    localStorage.setItem(key, out ? JSON.stringify(out) : "x");
  } catch {
    /* sin storage */
  }
  return out;
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatKm(km: number): string {
  return km < 1 ? `a ${Math.round(km * 10) * 100} m` : `a ${km.toFixed(1).replace(".", ",")} km`;
}
