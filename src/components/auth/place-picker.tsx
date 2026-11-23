import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, LocateFixed, MapPin, Search } from "lucide-react";
import { toast } from "sonner";
import { reversePlace, searchPlaces, type Place } from "@/lib/geo";

const STORAGE_KEY = "clippr_bolsa_place";

export function loadPlace(): Place | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Place) : null;
  } catch {
    return null;
  }
}

// Encabezado "Buscar cerca de ..." con el lugar elegido; al tocarlo se elige otra dirección o la ubicación actual.
export function PlacePicker({ place, onChange }: { place: Place | null; onChange: (p: Place | null) => void }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<Place[]>([]);
  const [locating, setLocating] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      searchPlaces(q, ctl.signal).then(setResults).catch(() => {});
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, open]);

  function choose(p: Place | null) {
    try {
      if (p) localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* sin storage */
    }
    onChange(p);
    setOpen(false);
    setQ("");
  }

  function useMyLocation() {
    if (!navigator.geolocation) return toast.error("Tu navegador no permite usar la ubicación.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const p = await reversePlace(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
        choose(p);
      },
      () => {
        setLocating(false);
        toast.error("No pudimos obtener tu ubicación. Revisá el permiso del navegador.");
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="min-w-0 flex-1 text-center">
        <span className="block text-sm text-white/55">Buscar cerca de</span>
        <span className="mx-auto flex max-w-full items-center justify-center gap-1 text-lg font-bold">
          <span className="truncate">{place?.label ?? "Elegí tu zona"}</span>
          <ChevronDown className="h-5 w-5 shrink-0 text-violet-300" />
        </span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[9999] bg-black/70" onClick={() => setOpen(false)}>
            <div className="rounded-b-3xl bg-[#0d0b18] px-5 pb-6 pt-5 shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-bold">Buscar cerca de…</h2>
                <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white/80">
                  ✕
                </button>
              </div>
              <button type="button" onClick={useMyLocation} disabled={locating} className="mt-4 flex w-full items-center gap-3 rounded-2xl py-3 text-left text-lg font-semibold disabled:opacity-60">
                <LocateFixed className="h-6 w-6 text-violet-300" />
                {locating ? "Buscando tu ubicación…" : "Usar mi ubicación actual"}
              </button>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value.slice(0, 80))}
                  placeholder="Escribí una dirección o un lugar"
                  className="h-14 w-full rounded-2xl border border-white/10 bg-black/30 pl-12 pr-4 text-lg font-semibold text-white placeholder:text-white/35 focus:border-violet-400/50 focus:outline-none"
                />
              </div>
              {results.length > 0 && (
                <div className="mt-2 divide-y divide-white/5">
                  {results.map((r, i) => (
                    <button key={`${r.lat}-${r.lng}-${i}`} type="button" onClick={() => choose(r)} className="flex w-full items-center gap-3 py-3 text-left text-base">
                      <MapPin className="h-5 w-5 shrink-0 text-violet-300" />
                      <span className="truncate">{r.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {place && (
                <button type="button" onClick={() => choose(null)} className="mt-3 text-base font-semibold text-white/60 underline underline-offset-4">
                  Quitar la zona
                </button>
              )}
              <p className="mt-4 text-sm text-white/40">Direcciones © OpenStreetMap · Photon</p>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
