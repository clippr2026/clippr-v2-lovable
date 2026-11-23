import * as React from "react";
import { ChevronDown, ListFilter, MapPin } from "lucide-react";

export type SortKey = "relevantes" | "cercanos" | "puntuados";
const SORTS: Array<[SortKey, string]> = [
  ["relevantes", "Más relevantes"],
  ["cercanos", "Más cercanos"],
  ["puntuados", "Mejor puntuados"],
];
const DISTANCES: Array<[number | null, string]> = [
  [null, "Cualquiera"],
  [2, "2 km"],
  [5, "5 km"],
  [10, "10 km"],
  [16, "16 km"],
  [30, "30 km"],
];

function Dropdown({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-12 w-full items-center justify-between gap-2 rounded-full border border-white/15 bg-white/[0.05] px-3 text-[15px] font-semibold text-white"
      >
        <Icon className="h-5 w-5 shrink-0 text-violet-300" />
        <span className="min-w-0 flex-1 whitespace-nowrap text-left">{label}</span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-white/60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <button type="button" aria-label="Cerrar" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-14 z-50 overflow-hidden rounded-2xl border border-white/10 bg-[#0d0b18] py-1 shadow-2xl">{children(() => setOpen(false))}</div>
        </>
      )}
    </div>
  );
}

// Filtros de orden y distancia (iguales para Servicios y Bolsa de trabajo).
export function FilterBar({
  sort,
  onSort,
  maxKm,
  onMaxKm,
  hasPlace,
  onNeedPlace,
}: {
  sort: SortKey;
  onSort: (s: SortKey) => void;
  maxKm: number | null;
  onMaxKm: (k: number | null) => void;
  hasPlace: boolean;
  onNeedPlace: () => void;
}) {
  return (
    <div className="mt-5 flex gap-2">
      <Dropdown icon={ListFilter} label={{ relevantes: "Relevantes", cercanos: "Cercanos", puntuados: "Puntuados" }[sort]}>
        {(close) =>
          SORTS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                if (k === "cercanos" && !hasPlace) onNeedPlace();
                else onSort(k);
                close();
              }}
              className={`block w-full px-4 py-3 text-left text-base font-semibold ${sort === k ? "text-violet-300" : "text-white/85"}`}
            >
              {l}
            </button>
          ))
        }
      </Dropdown>
      <Dropdown icon={MapPin} label={maxKm ? `Hasta ${maxKm} km` : "Distancia"}>
        {(close) =>
          DISTANCES.map(([k, l]) => (
            <button
              key={String(k)}
              type="button"
              onClick={() => {
                if (k !== null && !hasPlace) onNeedPlace();
                else onMaxKm(k);
                close();
              }}
              className={`block w-full px-4 py-3 text-left text-base font-semibold ${maxKm === k ? "text-violet-300" : "text-white/85"}`}
            >
              {l}
            </button>
          ))
        }
      </Dropdown>
    </div>
  );
}
