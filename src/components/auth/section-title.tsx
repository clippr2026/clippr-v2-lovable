import * as React from "react";
import { Building2, Tag, UserRound } from "lucide-react";

// Título de sección de un perfil profesional, con su icono (mismos iconos que en el formulario del perfil).
const ICONS = { especialidades: Tag, sobre: UserRound, referencias: Building2 } as const;
const LABELS = { especialidades: "Especialidades", sobre: "Sobre mí", referencias: "Referencias" } as const;

export function SectionTitle({ kind }: { kind: keyof typeof ICONS }) {
  const Icon = ICONS[kind];
  return (
    <div className="flex items-center gap-2 text-base font-semibold text-white/85">
      <Icon className="h-5 w-5 shrink-0 text-violet-300" />
      {LABELS[kind]}
    </div>
  );
}
