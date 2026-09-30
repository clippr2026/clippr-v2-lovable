import { Building2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

/**
 * Selector de sucursal — compacto, pensado para vivir en el header de
 * Agenda/Caja/Equipo/Inventario. Un solo componente, un solo estado
 * (useAuth().activeBranchId), así cambiar de sucursal en una pantalla se
 * refleja en todas sin recargar la página.
 *
 * branches.length <= 1: texto fijo con el nombre, nunca un desplegable
 * innecesario con una sola sucursal (incluye el caso de 0 filas — negocio
 * todavía no migrado — donde no hay nada que elegir).
 */
export function BranchSelector({ className }: { className?: string }) {
  const { branches, activeBranchId, setActiveBranchId } = useAuth();

  if (branches.length <= 1) {
    const name = branches[0]?.name ?? null;
    if (!name) return null;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-sm font-semibold text-white/80",
          className,
        )}
      >
        <Building2 className="size-3.5 shrink-0 text-white/40" />
        {name}
      </span>
    );
  }

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <Building2 className="pointer-events-none absolute left-2.5 size-3.5 shrink-0 text-white/40" />
      <select
        value={activeBranchId ?? ""}
        onChange={(e) => setActiveBranchId(e.target.value)}
        className="h-8 min-w-0 appearance-none rounded-lg border border-white/10 bg-white/[0.04] py-0 pl-8 pr-6 text-sm font-semibold text-white outline-none transition hover:border-white/20 focus:border-violet-300/40 focus:ring-2 focus:ring-violet-400/15"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      {/* Flecha propia — appearance-none saca la nativa del navegador, así
          el ancho queda consistente entre mobile/desktop. */}
      <span className="pointer-events-none absolute right-2 text-[10px] text-white/40">▾</span>
    </div>
  );
}
