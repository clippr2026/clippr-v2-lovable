import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Origen del dinero de un gasto o adelanto. Desmarcado: sale de la caja del día según el medio de pago.
// Marcado: fondos externos (no toca Efectivo en caja, Dinero digital ni el cierre, y no es un ingreso de caja).

export const DESCRIPCION_NO_DESCONTAR = "Marcá esta opción si el pago se realiza con dinero que no forma parte de la recaudación de hoy.";
export const DESCRIPCION_CAJA_CERRADA = "La caja del día está cerrada: el pago se registra sin descontar de ella.";

export function NoDescontarCaja({
  externo,
  cajaCerrada = false,
  onChange,
}: {
  externo: boolean;
  cajaCerrada?: boolean;
  onChange: (externo: boolean) => void;
}) {
  const marcado = externo || cajaCerrada;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={marcado}
      disabled={cajaCerrada}
      onClick={() => onChange(!externo)}
      className={cn(
        "flex w-full items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition disabled:cursor-not-allowed",
        marcado ? "border-violet-400/60 bg-violet-500/15" : "border-white/10 bg-white/[0.04]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[5px] border-2",
          marcado ? "border-violet-500 bg-violet-600" : "border-white/30",
        )}
      >
        {marcado && <Check className="h-3.5 w-3.5" strokeWidth={3} style={{ color: "#ffffff" }} />}
      </span>
      <span className="min-w-0">
        <span className="block whitespace-nowrap text-[15px] font-bold leading-6 text-white">No descontar de la caja del día</span>
        <span className="mt-1 block text-[13px] font-medium leading-snug text-white/60">
          {cajaCerrada ? DESCRIPCION_CAJA_CERRADA : DESCRIPCION_NO_DESCONTAR}
        </span>
      </span>
    </button>
  );
}
