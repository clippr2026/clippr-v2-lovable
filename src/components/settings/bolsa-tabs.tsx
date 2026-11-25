import { ClipboardList, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export type BolsaTab = "avisos" | "postulaciones";

// Pestañas de la Bolsa de trabajo del negocio: Mis avisos (lo que publica el local) y Recibidas (postulaciones y
// solicitudes de alquiler que llegan de profesionales). Control segmentado; la activa lleva el degradado celeste–violeta.
export function BolsaTabs({ active, onSelect, pending }: { active: BolsaTab; onSelect: (t: BolsaTab) => void; pending?: number }) {
  const tabs = [
    ["avisos", "Mis avisos", ClipboardList],
    ["postulaciones", "Recibidas", UserCheck],
  ] as const;
  return (
    <div className="shrink-0 px-4 pb-3">
      <div className="flex gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className={cn(
              "relative inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full px-3 text-base font-semibold transition",
              active === id ? "bg-gradient-to-r from-sky-400 to-violet-500 text-white shadow-[0_6px_20px_-6px_rgba(124,92,255,0.9)]" : "text-white/65",
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {label}
            {id === "postulaciones" && !!pending && pending > 0 && active !== id && (
              <span className="absolute -right-0.5 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-xs font-bold text-white">{pending}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
