import { SelectClippr } from "@/components/ui/select-clippr";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

/**
 * Selector de sucursal — compacto, pensado para vivir en el header de
 * Agenda/Caja/Equipo/Inventario. Un solo componente, un solo estado
 * (useAuth().activeBranchId), así cambiar de sucursal en una pantalla se
 * refleja en todas sin recargar la página.
 *
 * branches.length <= 1: no se muestra nada — con una sola sucursal (o con 0
 * filas, negocio todavía no migrado) no hay nada que elegir ni hace falta
 * repetir el nombre. Con 2 o más, desplegable para elegir.
 */
export function BranchSelector({ className }: { className?: string }) {
  const { branches, activeBranchId, setActiveBranchId, profile } = useAuth();

  // Un profesional no elige sucursal: trabaja en la suya.
  if (profile?.role === "profesional") return null;
  if (branches.length <= 1) return null;

  return (
    <SelectClippr
      compact
      className={cn("min-w-[170px]", className)}
      valor={activeBranchId ?? ""}
      onChange={setActiveBranchId}
      opciones={branches.map((b) => ({ id: b.id, label: b.name }))}
    />
  );
}
