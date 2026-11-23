import { Briefcase, ClipboardList, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export type BolsaTab = "avisos" | "profesionales" | "postulaciones";

// Pestañas comunes de la Bolsa de trabajo del negocio; solo la activa muestra el nombre.
export function BolsaTabs({ active, onSelect, pending }: { active: BolsaTab; onSelect: (t: BolsaTab) => void; pending?: number }) {
  const tabs = [
    ["avisos", "Avisos", ClipboardList],
    ["profesionales", "Profesionales", Briefcase],
    ["postulaciones", "Postulaciones", UserCheck],
  ] as const;
  return (
    <div className="flex shrink-0 gap-1.5 px-4 pb-3">
      {tabs.map(([id, label, Icon]) => (
        <button
          key={id}
          type="button"
          aria-label={label}
          onClick={() => onSelect(id)}
          className={cn(
            "relative inline-flex h-11 items-center justify-center gap-2 rounded-full text-base font-semibold transition",
            active === id ? "shrink-0 bg-gradient-to-r from-sky-400 to-violet-500 px-4 text-white" : "flex-1 bg-white/[0.06] px-3 text-white/65",
          )}
        >
          <Icon className="h-5 w-5 shrink-0" />
          {active === id && label}
          {id === "postulaciones" && !!pending && pending > 0 && active !== id && (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-xs font-bold text-white">{pending}</span>
          )}
        </button>
      ))}
    </div>
  );
}
