import * as React from "react";
import { TrendingUp, TrendingDown, Wallet, CreditCard } from "lucide-react";

// "Caja de hoy": el mismo bloque que se ve en Inicio (Ingresos y Egresos, servicios realizados, productos vendidos, efectivo en
// caja y dinero en banco), para que Caja muestre exactamente lo mismo.
const pesos = (n: number) => `$${Math.round(n || 0).toLocaleString("es-AR")}`;
const egreso = (n: number) => {
  const abs = Math.abs(Math.round(n || 0));
  return abs > 0 ? `-$${abs.toLocaleString("es-AR")}` : "$0";
};

function MiniStat({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-[11px] leading-tight">{label}</span>
      </div>
      <div className="mt-1 font-display text-lg font-semibold tracking-tight truncate">{value}</div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-xl px-3 py-2.5 text-left ring-1 transition hover:bg-white/[0.1] bg-white/[0.07] ring-white/20 [background-image:radial-gradient(120%_100%_at_100%_0%,rgba(255,255,255,.16),transparent_60%)] shadow-[0_0_22px_-10px_rgba(255,255,255,.45)]"
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
  onEfectivo,
  onBanco,
}: {
  ingresos: number;
  egresos: number;
  efectivo: number;
  banco: number;
  onEfectivo: () => void;
  onBanco: () => void;
}) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5 ring-1 ring-white/5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">Caja de hoy</div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-xs">Ingresos</span>
          </div>
          <div className="mt-0.5 text-xl sm:text-2xl font-display font-semibold tracking-tight">{pesos(ingresos)}</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
            <span className="text-xs">Egresos</span>
          </div>
          <div className="mt-0.5 text-xl sm:text-2xl font-display font-semibold tracking-tight">{egreso(egresos)}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniStat icon={Wallet} label="Efectivo en caja" value={pesos(efectivo)} onClick={onEfectivo} />
        <MiniStat icon={CreditCard} label="Dinero en banco" value={pesos(banco)} onClick={onBanco} />
      </div>
    </div>
  );
}
