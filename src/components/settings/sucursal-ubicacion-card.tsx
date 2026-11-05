import * as React from "react";
import { Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentCoords } from "@/lib/fichaje";
import { SectionCard, inputCls } from "@/components/settings/shared";

type BranchLoc = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  checkin_radius_m: number | null;
};

const DEFAULT_RADIUS = 150;

// Ubicación de cada sucursal para fichar con "Usar mi ubicación": se carga
// estando parado en el local ("Usar mi ubicación actual") y define el radio
// (150 m por defecto) dentro del cual se puede fichar.
export function SucursalUbicacionCard({
  businessId,
  branches,
}: {
  businessId: string | null;
  branches: { id: string; name: string }[];
}) {
  const [rows, setRows] = React.useState<Record<string, BranchLoc> | null>(null);
  const [radii, setRadii] = React.useState<Record<string, string>>({});
  const [savingId, setSavingId] = React.useState<string | null>(null);

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

  async function useCurrentLocation(branchId: string) {
    setSavingId(branchId);
    try {
      const coords = await getCurrentCoords();
      if (coords.accuracyM > 100) {
        toast.error("La ubicación es muy imprecisa para guardarla. Probá de nuevo, con buena señal o al aire libre.");
        return;
      }
      if (await save(branchId, { latitude: coords.lat, longitude: coords.lng })) {
        toast.success("Ubicación de la sucursal guardada.");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingId(null);
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
        Para que el equipo pueda fichar con su ubicación, guardá la de cada sucursal estando parado en el local.
        Solo se puede fichar dentro del radio indicado.
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
                  onClick={() => void useCurrentLocation(b.id)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-foreground ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <MapPin className="size-3.5" />}
                  {hasLoc ? "Actualizar con mi ubicación actual" : "Usar mi ubicación actual"}
                </button>
              </div>
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
