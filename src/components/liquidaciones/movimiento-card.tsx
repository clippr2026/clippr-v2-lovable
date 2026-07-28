// Card de un Movimiento — la MISMA presentación en Caja > Liquidaciones >
// Movimientos y en Panel del profesional > Movimientos. Antes cada pantalla
// tenía su propio JSX (colores/espaciados ligeramente distintos); esto es
// ahora la única fuente de verdad visual para las dos.
import * as React from "react";
import { cn } from "@/lib/utils";
import type { MovimientoItem } from "@/lib/historial-movimientos";
import { displayResponsable, fmtDateTime, fmtDetalleDateTime, money, paymentMethodLabel } from "./movimiento-format";

export type MovimientoRunInfo = {
  professional_name: string | null;
  period_start_at: string | null;
  prepared_at: string;
};

export function MovimientoCard({
  item,
  professionalName,
  run,
  onVerDetalle,
  extraActions,
}: {
  item: MovimientoItem;
  // Nombre a usar si el propio movimiento no trae uno (adelanto/pago
  // siempre tienen alguien seleccionado en el contexto de la pantalla).
  professionalName: string;
  run?: MovimientoRunInfo | null;
  onVerDetalle: () => void;
  extraActions?: React.ReactNode;
}) {
  if (item.kind === "adelanto") {
    const advance = item.data;
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-black/18 px-4 py-3.5 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            {item.movementNumber != null && (
              <div className="font-bold text-white">Movimiento #{item.movementNumber}</div>
            )}
            <div className="text-sm font-semibold text-white/70">{professionalName}</div>
            <div className="text-xs text-white/50">{advance.advanced_at ? fmtDateTime(advance.advanced_at) : "—"}</div>
          </div>
          <span className="rounded-full bg-rose-400/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-300 ring-1 ring-rose-400/20">
            Adelanto
          </span>
        </div>

        <div className="mt-3 space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-white/45">Monto pagado</span>
            <span className="font-bold tabular-nums text-emerald-300">{money(Number(advance.amount ?? 0))}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/45">Registrado por</span>
            <span className="font-semibold text-white/80">{displayResponsable(advance.registered_by_name)}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={onVerDetalle}
            className="rounded-full bg-white/[0.04] px-3 py-1 text-[11px] font-medium ring-1 ring-white/10 hover:bg-white/[0.07]"
          >
            Ver detalle
          </button>
          {extraActions}
        </div>
      </div>
    );
  }

  if (item.kind === "ajuste" || item.kind === "deduccion") {
    const isAjuste = item.kind === "ajuste";
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-black/18 px-4 py-3.5 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            {item.movementNumber != null && (
              <div className="font-bold text-white">Movimiento #{item.movementNumber}</div>
            )}
            <div className="text-sm font-semibold text-white/70">{item.professionalName || professionalName}</div>
            <div className="text-xs text-white/50">{item.at ? fmtDateTime(item.at) : "—"}</div>
          </div>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1",
              isAjuste
                ? "text-emerald-300 bg-emerald-400/10 ring-emerald-400/20"
                : "text-rose-300 bg-rose-400/10 ring-rose-400/20",
            )}
          >
            {isAjuste ? "Ajuste" : "Deducción"}
          </span>
        </div>

        <div className="mt-3 space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-white/45">Monto</span>
            <span className={cn("font-bold tabular-nums", isAjuste ? "text-emerald-300" : "text-rose-300")}>
              {isAjuste ? "+" : "−"}
              {money(item.amount)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/45">Registrado por</span>
            <span className="font-semibold text-white/80">{displayResponsable(item.preparedByName)}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={onVerDetalle}
            className="rounded-full bg-white/[0.04] px-3 py-1 text-[11px] font-medium ring-1 ring-white/10 hover:bg-white/[0.07]"
          >
            Ver detalle
          </button>
          {extraActions}
        </div>
      </div>
    );
  }

  // item.kind === "pago"
  const isFull = item.isFull;
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/18 px-4 py-3.5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {item.movementNumber != null && (
            <div className="font-bold text-white">Movimiento #{item.movementNumber}</div>
          )}
          <div className="text-sm font-semibold text-white/70">{run?.professional_name || professionalName}</div>
          <div className="text-xs text-white/50">{item.at ? fmtDateTime(item.at) : "—"}</div>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1",
            isFull
              ? "text-emerald-300 bg-emerald-400/10 ring-emerald-400/20"
              : "text-amber-300 bg-amber-400/10 ring-amber-400/20",
          )}
        >
          {isFull ? "Pago total" : "Pago parcial"}
        </span>
      </div>

      <div className="mt-3 space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-white/45">Monto pagado</span>
          <span className="font-bold tabular-nums text-emerald-300">{money(item.totalAmount)}</span>
        </div>
        {item.splits.length > 1 &&
          item.splits.map((split) => (
            <div key={split.id} className="flex items-center justify-between pl-2 text-white/50">
              <span>{paymentMethodLabel(split.payment_method)}</span>
              <span className="tabular-nums">{money(Number(split.amount ?? 0))}</span>
            </div>
          ))}
        <div className="flex items-center justify-between">
          <span className="text-white/45">Registrado por</span>
          <span className="font-semibold text-white/80">{displayResponsable(item.splits[0].paid_by_name)}</span>
        </div>
      </div>

      {/* Período liquidado en dos líneas — solo tiene sentido acá (pago
          total/parcial), los demás tipos de movimiento no pertenecen a un
          período de liquidación. */}
      {run && (
        <div className="mt-2.5 space-y-0.5 border-t border-white/[0.06] pt-2 text-[11px] text-white/45">
          <div>Desde {run.period_start_at ? fmtDetalleDateTime(run.period_start_at) : "primera liquidación"}</div>
          <div>Hasta {fmtDetalleDateTime(run.prepared_at)}</div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={onVerDetalle}
          className="rounded-full bg-white/[0.04] px-3 py-1 text-[11px] font-medium ring-1 ring-white/10 hover:bg-white/[0.07]"
        >
          Ver detalle
        </button>
        {extraActions}
      </div>
    </div>
  );
}
