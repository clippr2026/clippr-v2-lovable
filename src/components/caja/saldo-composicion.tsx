// Composición de "Efectivo del día" / "Dinero en cuenta del día" —
// extraído de CierreConciliacionPanel (cash-register.tsx) para que
// Inicio (CajaHoyCard) y Caja > Facturación puedan mostrar EXACTAMENTE
// el mismo desglose con un clic, en vez de que un saldo negativo quede
// sin explicación hasta que alguien abra "Revisar cierre". Única fuente:
// ExpectedCashDigital (computeExpectedCashAndDigital, caja-cierre.ts) —
// nunca un segundo cálculo aparte que pueda desincronizarse del real.
import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConciliacionLado, ExpectedCashDigital } from "@/lib/caja-cierre";

function money(v: number) {
  return `${v < 0 ? "-" : ""}$${Math.round(Math.abs(v)).toLocaleString("es-AR")}`;
}

// De ExpectedCashDigital (lo que ya expone useCajaSummary.todayExpectedFull)
// a la forma ConciliacionLado que ya sabe renderizar SaldoComposicionLado —
// mismos 9 campos, solo reempaquetados, nunca recalculados. ÚNICO uso real:
// SaldoComposicionModal (abajo, el detalle de "Efectivo/Dinero en cuenta
// del día" de Inicio/Caja) — la Conciliación de un cierre (Revisar cierre)
// arma su propio ConciliacionLado vía buildConciliacion, nunca pasa por
// acá, así que tocar esto no afecta ese cálculo.
//
// adelantos: 0 y esperado SIN restarlos — los adelantos a profesionales
// ahora se muestran aparte, como su propia tarjeta "Adelantos del día"
// (ver todayAdvancesOut, useCajaSummary.ts), nunca mezclados con "cuánto
// dinero hay" de una venta o un gasto operativo. expected.cashExpected/
// digitalExpected (el dato real, con los adelantos restados) sigue
// existiendo sin tocar — lo sigue usando quien cierra una caja de verdad
// (efectivo contado/saldo real vs. esperado).
export function expectedToLado(expected: ExpectedCashDigital, side: "cash" | "digital"): ConciliacionLado {
  return side === "cash"
    ? {
        cobros: expected.cashFromPayments,
        ingresosManuales: expected.cashInflows,
        gastos: expected.cashExpenses,
        retirosManuales: expected.cashRetirosManual,
        adelantos: 0,
        esperado: expected.cashExpected + expected.cashAdvancesOut,
      }
    : {
        cobros: expected.digitalFromPayments,
        ingresosManuales: expected.digitalInflows,
        gastos: expected.digitalExpenses,
        retirosManuales: expected.digitalRetirosManual,
        adelantos: 0,
        esperado: expected.digitalExpected + expected.digitalAdvancesOut,
      };
}

export function SaldoComposicionLado({
  label,
  lado,
  totalLabel = "Esperado",
}: {
  label: string;
  lado: ConciliacionLado;
  // "Esperado" (Conciliación de un cierre, proyecta lo que debería haber)
  // vs. "Total" (composición de "Efectivo/Dinero en cuenta del día" en
  // Inicio/Caja — ya es el resultado real de hoy, no una proyección).
  totalLabel?: string;
}) {
  return (
    <div className="rounded-xl bg-white/[0.02] ring-1 ring-white/10 p-3.5 space-y-1.5">
      <div className="text-sm font-semibold text-white">{label}</div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Cobros</span>
        <span className="tabular-nums text-emerald-300">+{money(lado.cobros)}</span>
      </div>
      {lado.ingresosManuales > 0 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Ingresos manuales</span>
          <span className="tabular-nums text-emerald-300">+{money(lado.ingresosManuales)}</span>
        </div>
      )}
      {lado.gastos > 0 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Gastos</span>
          <span className="tabular-nums text-rose-300">-{money(lado.gastos)}</span>
        </div>
      )}
      {lado.retirosManuales > 0 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Retiros manuales</span>
          <span className="tabular-nums text-rose-300">-{money(lado.retirosManuales)}</span>
        </div>
      )}
      {lado.adelantos > 0 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Adelantos a profesionales</span>
          <span className="tabular-nums text-rose-300">-{money(lado.adelantos)}</span>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-white/10 pt-1.5 text-sm">
        <span className="font-semibold text-white">{totalLabel}</span>
        <span className={cn("font-bold tabular-nums", lado.esperado < 0 ? "text-rose-300" : "text-white")}>
          {money(lado.esperado)}
        </span>
      </div>
    </div>
  );
}

// Modal liviano (sin dependencia de una librería de diálogos) — mismo
// patrón de overlay + createPortal que ya usa el resto de la app.
export function SaldoComposicionModal({
  title,
  expected,
  side,
  onClose,
}: {
  title: string;
  expected: ExpectedCashDigital;
  side: "cash" | "digital";
  onClose: () => void;
}) {
  const lado = expectedToLado(expected, side);
  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-t-3xl bg-[#0B0E17] p-4 ring-1 ring-white/10 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-bold text-white">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-white/50 transition hover:bg-white/[0.08] hover:text-white"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Solo los movimientos de hoy — nunca el acumulado de jornadas pendientes.
        </p>
        <SaldoComposicionLado label={title} lado={lado} totalLabel="Total" />
      </div>
    </div>,
    document.body,
  );
}
