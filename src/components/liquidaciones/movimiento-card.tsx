// Card de un Movimiento — la MISMA presentación en Caja > Liquidaciones >
// Movimientos y en Panel del profesional > Movimientos. Antes cada pantalla
// tenía su propio JSX (colores/espaciados ligeramente distintos); esto es
// ahora la única fuente de verdad visual para las dos.
//
// `variant="row"` (Caja > Liquidaciones) es un layout de tabla compacta en
// desktop con detalle expandible inline. `variant="card"` (default, Panel
// del profesional) es el layout vertical original, sin cambios — esa
// pantalla tiene acciones extra (Descargar/Compartir comprobante) que no
// entran en una fila compacta, así que no se migra.
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MovimientoItem } from "@/lib/historial-movimientos";
import { displayResponsable, fmtDateTime, fmtDetalleDateTime, money, paymentMethodLabel } from "./movimiento-format";

export type MovimientoRunInfo = {
  professional_name: string | null;
  period_start_at: string | null;
  prepared_at: string;
};

function shortDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

const BADGE_TONE = {
  emerald: "text-emerald-300 bg-emerald-400/10 ring-emerald-400/20",
  amber: "text-amber-300 bg-amber-400/10 ring-amber-400/20",
  rose: "text-rose-300 bg-rose-400/10 ring-rose-400/20",
};

function badgeClass(tone: keyof typeof BADGE_TONE) {
  return cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1", BADGE_TONE[tone]);
}

export function MovimientoCard({
  item,
  professionalName,
  run,
  onVerDetalle,
  extraActions,
  variant = "card",
  expanded = false,
  detail,
  loadingDetail = false,
}: {
  item: MovimientoItem;
  // Nombre a usar si el propio movimiento no trae uno (adelanto/pago
  // siempre tienen alguien seleccionado en el contexto de la pantalla).
  professionalName: string;
  run?: MovimientoRunInfo | null;
  onVerDetalle: () => void;
  extraActions?: React.ReactNode;
  variant?: "card" | "row";
  // Solo variant="row": el padre controla si este movimiento tiene su
  // detalle abierto inline (en vez de un modal aparte) y qué contenido
  // mostrar ahí.
  expanded?: boolean;
  detail?: React.ReactNode;
  loadingDetail?: boolean;
}) {
  if (variant === "row") {
    let tone: keyof typeof BADGE_TONE;
    let label: string;
    let sign: "" | "+" | "−";
    let amount: number;
    let at: string | null;
    let registeredBy: string;
    let period: string | null = null;

    if (item.kind === "adelanto") {
      tone = "rose";
      label = "Adelanto";
      sign = "−";
      amount = Number(item.data.amount ?? 0);
      at = item.data.advanced_at ?? null;
      registeredBy = displayResponsable(item.data.registered_by_name);
    } else if (item.kind === "ajuste" || item.kind === "deduccion") {
      const isAjuste = item.kind === "ajuste";
      tone = isAjuste ? "emerald" : "rose";
      label = isAjuste ? "Ajuste" : "Deducción";
      sign = isAjuste ? "+" : "−";
      amount = item.amount;
      at = item.at ?? null;
      registeredBy = displayResponsable(item.preparedByName);
    } else {
      tone = item.isFull ? "emerald" : "amber";
      label = item.isFull ? "Pago total" : "Pago parcial";
      sign = "";
      amount = item.totalAmount;
      at = item.at ?? null;
      registeredBy = displayResponsable(item.splits[0].paid_by_name);
      period = run ? (run.period_start_at ? `${shortDate(run.period_start_at)}–${shortDate(run.prepared_at)}` : "Primera liquidación") : null;
    }

    const amountColor = tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : "text-rose-300";

    return (
      <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-black/18">
        {/* Desktop: fila de tabla compacta, una sola línea por movimiento. */}
        <button
          type="button"
          onClick={onVerDetalle}
          className="hidden w-full grid-cols-[86px_120px_minmax(120px,1fr)_120px_130px_96px] items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-white/[0.025] sm:grid"
        >
          <div className="text-white/60">
            {at ? shortDate(at) : "—"}
            {at && (
              <div className="text-[11px] text-white/35">
                {new Date(at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}
              </div>
            )}
          </div>
          <div>
            <span className={badgeClass(tone)}>{label}</span>
          </div>
          <div className="truncate text-xs text-white/50">{period ?? "—"}</div>
          <div className={cn("font-bold tabular-nums", amountColor)}>
            {sign}
            {money(amount)}
          </div>
          <div className="truncate text-xs text-white/40">{registeredBy}</div>
          <div className="flex items-center justify-end gap-1 text-[11px] font-medium text-white/55">
            {expanded ? "Ocultar" : "Ver detalle"}
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          </div>
        </button>

        {/* Mobile: tarjeta compacta vertical. */}
        <button type="button" onClick={onVerDetalle} className="flex w-full flex-col gap-1 px-3.5 py-3 text-left text-xs sm:hidden">
          <div className="flex items-center justify-between gap-2">
            <span className={badgeClass(tone)}>{label}</span>
            <span className={cn("font-bold tabular-nums", amountColor)}>
              {sign}
              {money(amount)}
            </span>
          </div>
          <div className="text-white/45">
            {at ? fmtDateTime(at) : "—"}
          </div>
          {period && <div className="text-white/45">{period}</div>}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-white/35">Registrado por {registeredBy}</span>
            <span className="flex items-center gap-0.5 font-medium text-white/55">
              {expanded ? "Ocultar" : "Ver detalle"}
              <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
            </span>
          </div>
        </button>

        {expanded && (
          <div className="border-t border-white/[0.06] bg-white/[0.015] px-3.5 py-3 sm:px-4">
            {loadingDetail ? (
              <div className="py-4 text-center text-xs text-white/45">Cargando…</div>
            ) : (
              detail
            )}
          </div>
        )}
      </div>
    );
  }

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

// Header de columnas — solo desktop, solo para variant="row" (Caja >
// Liquidaciones > Movimientos). El listado en variant="card" no usa tabla,
// así que no necesita header.
export function MovimientoListHeader() {
  return (
    <div className="hidden grid-cols-[86px_120px_minmax(120px,1fr)_120px_130px_96px] gap-3 border-b border-white/[0.055] px-4 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35 sm:grid">
      <div>Fecha y hora</div>
      <div>Tipo</div>
      <div>Período</div>
      <div>Monto</div>
      <div>Registrado por</div>
      <div className="text-right">Acción</div>
    </div>
  );
}
