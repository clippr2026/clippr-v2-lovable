import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Origen del dinero de un gasto o adelanto. Desmarcado: sale de la caja del día según el medio de pago.
// Marcado: fondos externos (no toca Efectivo en caja, Dinero digital ni el cierre, y no es un ingreso de caja).

export function textoOrigen({
  tipo,
  externo,
  medio,
  cajaCerrada = false,
}: {
  tipo: "gasto" | "adelanto";
  externo: boolean;
  medio: string;
  cajaCerrada?: boolean;
}): string {
  const igual =
    tipo === "adelanto"
      ? "Igual se descuenta de la liquidación del profesional."
      : "Igual cuenta en las estadísticas del negocio.";
  if (cajaCerrada) return `La caja del día está cerrada: se registra con fondos externos. ${igual}`;
  if (externo) return `Fondos externos: no cambia el efectivo en caja, el dinero digital ni el cierre. ${igual}`;
  const de = medio === "efectivo" ? " de Efectivo en caja" : medio === "transferencia" ? " de Dinero digital" : " según el medio de pago";
  return `Se descuenta de la caja del día${de} y entra en el cierre.`;
}

export function NoDescontarCaja({
  tipo,
  externo,
  medio,
  cajaCerrada = false,
  onChange,
}: {
  tipo: "gasto" | "adelanto";
  externo: boolean;
  medio: string;
  cajaCerrada?: boolean;
  onChange: (externo: boolean) => void;
}) {
  const marcado = externo || cajaCerrada;
  return (
    <div>
      <button
        type="button"
        role="checkbox"
        aria-checked={marcado}
        disabled={cajaCerrada}
        onClick={() => onChange(!externo)}
        className={cn(
          "flex min-h-12 w-full items-center gap-3 rounded-2xl border px-4 py-2.5 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
          marcado ? "border-violet-400/60 bg-violet-500/15 text-white" : "border-white/10 bg-white/[0.04] text-white/80",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded-md border-2",
            marcado ? "border-violet-500 bg-violet-600" : "border-white/30",
          )}
        >
          {marcado && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} style={{ color: "#ffffff" }} />}
        </span>
        No descontar de la caja del día
      </button>
      <p className="mt-2 text-[13px] font-medium leading-snug text-white/60">
        {textoOrigen({ tipo, externo: marcado, medio, cajaCerrada })}
      </p>
    </div>
  );
}
