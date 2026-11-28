import * as React from "react";
import { MONTO_OCULTO, useMontosOcultos } from "@/hooks/use-montos-ocultos";
import { TrendingUp, TrendingDown, Wallet, CreditCard, Eye, EyeOff } from "lucide-react";

// "Caja de hoy": el mismo bloque que se ve en Inicio (Ingresos y Egresos, servicios realizados, productos vendidos, efectivo en
// caja y dinero en banco), para que Caja muestre exactamente lo mismo.
const pesos = (n: number) => `$${Math.round(n || 0).toLocaleString("es-AR")}`;
const CARGANDO = "···";
const OCULTO = MONTO_OCULTO;
const egreso = (n: number) => {
  const abs = Math.abs(Math.round(n || 0));
  return abs > 0 ? `-$${abs.toLocaleString("es-AR")}` : "$0";
};

function MiniStat({
  icon: Icon,
  label,
  value,
  onClick,
  onToggle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  onClick?: () => void;
  onToggle?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-center gap-1.5 text-white">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate text-sm leading-tight">{label}</span>
      </div>
      <div
        className="mt-1 truncate font-display text-lg font-semibold tracking-tight"
        onClick={
          onToggle
            ? (e) => {
                e.stopPropagation();
                onToggle();
              }
            : undefined
        }
      >
        {value}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="caja-mini w-full rounded-xl px-3 py-2.5 text-left ring-1 transition hover:bg-white/[0.18] bg-white/[0.14] ring-white/35 [background-image:linear-gradient(160deg,rgba(255,255,255,.32),rgba(255,255,255,.04)_70%)] shadow-[0_0_24px_-10px_rgba(255,255,255,.6)]"
      >
        {content}
      </button>
    );
  }
  return <div className="rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/8">{content}</div>;
}

export function CajaHoyBloque({
  ingresos,
  egresos,
  efectivo,
  banco,
  loading = false,
  onEfectivo,
  onBanco,
}: {
  ingresos: number;
  egresos: number;
  efectivo: number;
  banco: number;
  // Mientras carga se muestra un marcador en vez de $0 (un $0 falso parece un dato real).
  loading?: boolean;
  onEfectivo: () => void;
  onBanco: () => void;
}) {
  const [oculto, alternar] = useMontosOcultos();
  const ver = (t: string) => (loading ? CARGANDO : oculto ? OCULTO : t);
  return (
    <div className={`glass rounded-2xl p-4 sm:p-5 ring-1 ring-white/5 ${loading ? "animate-pulse" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-base font-semibold text-white">
          <Wallet className="h-5 w-5 text-violet-300" />
          Caja de hoy
        </div>
        <button
          type="button"
          onClick={alternar}
          aria-label={oculto ? "Mostrar montos" : "Ocultar montos"}
          className="-mr-1 -mt-1 grid h-10 w-10 touch-manipulation place-items-center rounded-full text-white/70 transition active:scale-95 hover:text-white"
        >
          {oculto ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <TrendingUp className="h-4 w-4 text-blue-400" />
            <span className="text-sm">Ingresos</span>
          </div>
          <div onClick={alternar} className="mt-0.5 cursor-pointer text-xl sm:text-2xl font-display font-semibold tracking-tight">{ver(pesos(ingresos))}</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <TrendingDown className="h-4 w-4 text-rose-400" />
            <span className="text-sm">Egresos</span>
          </div>
          <div onClick={alternar} className="mt-0.5 cursor-pointer text-xl sm:text-2xl font-display font-semibold tracking-tight">{ver(egreso(egresos))}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniStat icon={Wallet} label="Efectivo en caja" value={ver(pesos(efectivo))} onToggle={alternar} onClick={onEfectivo} />
        <MiniStat icon={CreditCard} label="Dinero digital" value={ver(pesos(banco))} onToggle={alternar} onClick={onBanco} />
      </div>
    </div>
  );
}
