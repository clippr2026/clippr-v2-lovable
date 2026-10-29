// Contenido de los modales "Ver detalle" de un Movimiento — un componente
// por tipo (Pago, Adelanto, Ajuste, Deducción), cada uno con su propia
// identidad visual premium (azul/verde/rojo) pero el mismo lenguaje de
// diseño: gradiente sutil, borde con brillo, sombra difusa, divisores
// tintados. Usados tanto por Caja > Liquidaciones como por el Panel del
// profesional, siempre envueltos en el mismo `AgendaCenteredModal` de cada
// pantalla — acá solo vive el contenido, sin fetch propio: cada pantalla ya
// tiene los datos (payments/advances/services) resueltos.
import * as React from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PAY_METHOD_LABEL, type PayMethod } from "@/components/cash-register/register-payment";
import { displayResponsable, fmtDetalleDateTime, isInternalNote, money } from "./movimiento-format";
import { VentaRow } from "./unified-row";
import type { EmployeeCommissionMap } from "@/lib/service-pricing";

// Portal a document.body: este popover suele vivir dentro de modales con
// overflow-y-auto — sin portal queda recortado por ese overflow.
export function InfoPopover({ text }: { text: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const supportsHover = React.useRef(false);
  React.useEffect(() => {
    supportsHover.current = typeof window !== "undefined" && window.matchMedia?.("(hover: hover)").matches;
  }, []);

  const updatePosition = React.useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const halfPanel = 112;
    const idealLeft = rect.left + rect.width / 2;
    const clampedLeft = Math.min(Math.max(idealLeft, halfPanel + 8), window.innerWidth - halfPanel - 8);
    setCoords({ top: rect.bottom + 8, left: clampedLeft });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updatePosition();
    function handleOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  return (
    <span className="relative inline-flex shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onMouseEnter={() => supportsHover.current && setOpen(true)}
        onMouseLeave={() => supportsHover.current && setOpen(false)}
        aria-label="Más información"
        aria-expanded={open}
        className="-m-2 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-white/32 transition hover:text-white/65"
      >
        <Info className="size-3.5" />
      </button>
      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            onClick={(event) => event.stopPropagation()}
            style={{ position: "fixed", top: coords.top, left: coords.left, transform: "translateX(-50%)" }}
            className="z-[70] w-56 rounded-2xl border border-white/[0.12] bg-[#0A0D18] p-3 text-left normal-case shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar"
              className="absolute right-2 top-2 text-white/35 transition hover:text-white/70"
            >
              <X className="size-3" />
            </button>
            <div className="pr-4 text-[11px] font-normal leading-relaxed tracking-normal text-white/70">{text}</div>
          </div>,
          document.body,
        )}
    </span>
  );
}

export type PagoDetalleRun = {
  professional_name: string | null;
  previous_balance: number;
  new_commissions: number;
  // Propinas de este período — siempre separadas de new_commissions, tanto
  // acá como en prepare_settlement_run (nunca se suman en una sola cifra).
  new_tips?: number;
  adjustments: number;
  adjustment_items: { amount: number; reason: string }[] | null;
  deductions: number;
  deduction_items: { amount: number; reason: string }[] | null;
  advances: number;
  total_to_settle: number;
  amount_paid: number;
  period_start_at: string | null;
  prepared_at: string;
  service_count?: number | null;
};

export type PagoDetallePayment = {
  id: string;
  payment_method: string | null;
  amount: number;
  paid_at: string;
  paid_by_name: string;
  note: string | null;
};

export type PagoDetalleAdvance = {
  id: string;
  advanced_at: string;
  amount: number;
  note: string | null;
};

export type PagoDetalleService = {
  id: string;
  amount: number;
  created_at: string | null;
  sale: {
    client_name: string | null;
    service_name: string | null;
    total: number | null;
    amount: number | null;
    method: string | null;
    payment_method: string | null;
  } | null;
};

export function PagoDetalleContent({
  run,
  payments,
  advances,
  services,
  loadingServices,
  hideServices = false,
  paidAtDisplayOverride = null,
  commissionsMap = null,
}: {
  run: PagoDetalleRun;
  payments: PagoDetallePayment[];
  advances: PagoDetalleAdvance[];
  services: PagoDetalleService[] | null;
  loadingServices: boolean;
  // Panel del profesional > Historial ya muestra sus propias "Ventas
  // incluidas" (con VentaRow, detalle de descuento/promo/propina) debajo
  // de este componente — sin esto, el bloque "Servicios incluidos" de
  // acá (más simple, sin esos campos) se duplicaba con un mensaje de
  // "Sin servicios" de más, sin aportar nada.
  hideServices?: boolean;
  // Excepción visual puntual (liquidación #101 de Melany, pedido explícito
  // del negocio) — reemplaza SOLO el texto mostrado en "Fecha y hora" de
  // Datos del pago, sin tocar paid_at real ni ningún cálculo. Quien decide
  // si corresponde vive en historial-panel-view.tsx, nunca acá.
  paidAtDisplayOverride?: string | null;
  // Reenviado tal cual a VentaRow (Servicios incluidos) para que filtre del
  // concepto los productos sin comisión activa — ver resolveDisplayConcept.
  commissionsMap?: EmployeeCommissionMap | null;
}) {
  const remaining = Math.max(Number(run.total_to_settle) - Number(run.amount_paid), 0);
  // Mismo criterio de tolerancia que isPaymentFull/isRunEffectivelySettled
  // (movimiento-format.ts) — un resto menor a $1 es redondeo entre
  // comisiones/adelantos con centavos, nunca plata real pendiente.
  const isFullyPaid = remaining < 1;
  const sortedPayments = [...payments].sort((a, b) => String(a.paid_at ?? "").localeCompare(String(b.paid_at ?? "")));
  const firstPayment = sortedPayments[0] ?? null;
  const sortedAdvances = [...advances].sort((a, b) => String(a.advanced_at ?? "").localeCompare(String(b.advanced_at ?? "")));
  const realServices = (services ?? []).filter((s) => Number(s.amount ?? 0) > 0);
  const hasPreviousBalance = Number(run.previous_balance ?? 0) > 0;
  const isFirstRun = !run.period_start_at;
  const hasAdjustments = Number(run.adjustments ?? 0) > 0;
  const hasDeductions = Number(run.deductions ?? 0) > 0;
  const hasAdvancesAmount = Number(run.advances ?? 0) > 0;
  const hasTips = Number(run.new_tips ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-blue-300/25 bg-[linear-gradient(135deg,rgba(37,99,235,0.14),rgba(8,11,20,0.96),rgba(2,4,12,0.98))] text-sm shadow-[0_0_40px_rgba(96,165,250,0.12),0_18px_55px_-34px_rgba(0,0,0,1)]">
        <div className="px-3.5 pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-200/55">Resumen</div>
        <div className="divide-y divide-blue-300/10">
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-white/50">Profesional</span>
            <span className="font-semibold text-white">{run.professional_name || "—"}</span>
          </div>

          {hasPreviousBalance && (
            <div className="flex items-end justify-between px-3.5 py-2.5">
              <div>
                <div className="text-white/70">Comisiones pendientes</div>
                <div className="text-[10px] uppercase tracking-wider text-white/35">Período anterior</div>
              </div>
              <span className="font-semibold text-white">{money(Number(run.previous_balance ?? 0))}</span>
            </div>
          )}

          <div className="flex items-end justify-between px-3.5 py-2.5">
            <div>
              <div className="text-white/70">Comisiones generadas</div>
              {!isFirstRun && <div className="text-[10px] uppercase tracking-wider text-white/35">Período actual</div>}
            </div>
            <span className="font-semibold text-white">{money(Number(run.new_commissions ?? 0))}</span>
          </div>

          {hasTips && (
            <div className="flex items-end justify-between px-3.5 py-2.5">
              <div className="text-white/70">Propinas</div>
              <span className="font-semibold text-white">{money(Number(run.new_tips ?? 0))}</span>
            </div>
          )}

          {run.service_count != null && (
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <span className="text-white/50">Cantidad de servicios</span>
              <span className="font-semibold tabular-nums text-white">{run.service_count}</span>
            </div>
          )}

          {hasAdjustments && (
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <span className="flex items-center text-white/50">
                Adicionales
                {Array.isArray(run.adjustment_items) && run.adjustment_items.length > 0 && (
                  <InfoPopover
                    text={
                      <div className="space-y-1.5">
                        {run.adjustment_items.map((item, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <span className="text-white/70">{item.reason}</span>
                            <span className="shrink-0 font-semibold text-white">+{money(Number(item.amount))}</span>
                          </div>
                        ))}
                      </div>
                    }
                  />
                )}
              </span>
              <span className="font-semibold text-white">+{money(Number(run.adjustments ?? 0))}</span>
            </div>
          )}
          {hasDeductions && (
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <span className="flex items-center text-white/50">
                Deducciones
                {Array.isArray(run.deduction_items) && run.deduction_items.length > 0 && (
                  <InfoPopover
                    text={
                      <div className="space-y-1.5">
                        {run.deduction_items.map((item, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <span className="text-white/70">{item.reason}</span>
                            <span className="shrink-0 font-semibold text-rose-300">−{money(Number(item.amount))}</span>
                          </div>
                        ))}
                      </div>
                    }
                  />
                )}
              </span>
              <span className="font-semibold text-rose-300">−{money(Number(run.deductions ?? 0))}</span>
            </div>
          )}
          {hasAdvancesAmount && (
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <span className="flex items-center text-white/50">
                Adelantos
                {sortedAdvances.length > 0 && (
                  <InfoPopover
                    text={
                      <div className="space-y-1.5">
                        {sortedAdvances.map((advance) => (
                          <div key={advance.id} className="space-y-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-white/70">
                                {advance.advanced_at ? fmtDetalleDateTime(advance.advanced_at) : "—"}
                              </span>
                              <span className="shrink-0 font-semibold text-rose-300">
                                −{money(Number(advance.amount ?? 0))}
                              </span>
                            </div>
                            {advance.note && <div className="text-white/45">{advance.note}</div>}
                          </div>
                        ))}
                      </div>
                    }
                  />
                )}
              </span>
              <span className="font-semibold text-rose-300">−{money(Number(run.advances ?? 0))}</span>
            </div>
          )}
        </div>

        {/* Sección fija, siempre visible, separada del bloque de arriba por
            un borde marcado + un poco de aire extra — Total final / Monto
            pagado / Saldo pendiente son el cierre del Resumen, no una fila
            condicional más. */}
        <div className="mt-1.5 divide-y divide-blue-300/10 border-t border-blue-300/20 pt-1.5">
          <div className="flex items-center justify-between bg-blue-400/[0.09] px-3.5 py-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-white/80">Total final</span>
            <span className="text-xl font-bold tracking-tight text-white">{money(Number(run.total_to_settle))}</span>
          </div>
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-white/50">Monto pagado</span>
            <span className="font-semibold text-emerald-300">{money(Number(run.amount_paid))}</span>
          </div>
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-white/50">Saldo pendiente</span>
            <span className={cn("font-semibold", remaining > 0 ? "text-amber-300" : "text-emerald-300")}>
              {money(remaining)}
            </span>
          </div>
        </div>
      </div>

      {sortedPayments.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-emerald-300/25 bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(8,11,20,0.96),rgba(2,4,12,0.98))] text-sm shadow-[0_0_40px_rgba(16,185,129,0.12),0_18px_55px_-34px_rgba(0,0,0,1)]">
          <div className="flex items-center justify-between gap-2 px-3.5 pb-1.5 pt-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200/55">
              Datos del pago
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1",
                isFullyPaid
                  ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25"
                  : "bg-amber-400/10 text-amber-300 ring-amber-400/25",
              )}
            >
              {isFullyPaid ? "Pago total" : "Pago parcial"}
            </span>
          </div>
          <div className="divide-y divide-emerald-300/10">
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <span className="text-white/50">Fecha y hora</span>
              <span className="font-semibold text-white">
                {paidAtDisplayOverride ?? (firstPayment?.paid_at ? fmtDetalleDateTime(firstPayment.paid_at) : "—")}
              </span>
            </div>
            {/* Un solo método o varios, misma fila para cada uno: el nombre
                del medio de pago a la izquierda, el importe a la derecha —
                sin numerar ("Método 1/2") ni separar en dos filas
                (Método/Monto), ni con uno solo. */}
            {sortedPayments.map((payment, idx) => (
              <div key={payment.id ?? idx} className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                <span className="font-semibold capitalize text-white">
                  {PAY_METHOD_LABEL[payment.payment_method as PayMethod] ?? payment.payment_method ?? "—"}
                </span>
                <span className="font-semibold text-white">{money(Number(payment.amount ?? 0))}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <span className="text-white/50">Registrado por</span>
              <span className="font-semibold text-white">{displayResponsable(firstPayment?.paid_by_name)}</span>
            </div>
            {firstPayment?.note && !isInternalNote(firstPayment.note) && (
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                <span className="text-white/50">Nota</span>
                <span className="truncate font-semibold text-white">{firstPayment.note}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {!hideServices && (
      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/38">Servicios incluidos</div>
        {loadingServices ? (
          <div className="py-6 text-center text-sm text-white/45">Cargando…</div>
        ) : realServices.length === 0 ? (
          <div className="py-6 text-center text-sm text-white/45">Sin servicios en esta liquidación.</div>
        ) : (
          // VentaRow (unified-row.tsx) — MISMA fila que usa Caja > Movimientos,
          // Profesionales > Movimientos e Historial de liquidaciones: única
          // lógica de "Descuento Promo X / Descuento manual / Descuento en
          // efectivo" en todo el código, nunca reimplementada acá. Antes esta
          // sección tenía su propio JSX simplificado (sin discount/promotion_*),
          // así que una venta con promo perdía la etiqueta en este panel aunque
          // el payment SÍ tuviera la promo bien guardada.
          <div className="space-y-2">
            {realServices.map((c) => (
              <VentaRow key={c.id} c={c} commissionsMap={commissionsMap} />
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

export function AdelantoDetalleContent({
  professionalName,
  advance,
}: {
  professionalName: string;
  advance: {
    amount: number;
    payment_method: string | null;
    advanced_at: string;
    // Ver 20261028170000_professional_advances_display_date.sql — null/
    // ausente = mostrar advanced_at, como siempre.
    display_date?: string | null;
    registered_by_name: string;
    note: string | null;
  };
}) {
  const fechaMostrada = advance.display_date ?? advance.advanced_at;
  return (
    <div className="overflow-hidden rounded-2xl border border-rose-300/25 bg-[linear-gradient(135deg,rgba(244,63,94,0.14),rgba(8,11,20,0.96),rgba(2,4,12,0.98))] text-sm shadow-[0_0_40px_rgba(244,63,94,0.12),0_18px_55px_-34px_rgba(0,0,0,1)]">
      <div className="divide-y divide-rose-300/10">
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Profesional</span>
          <span className="font-semibold text-white">{professionalName}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Monto adelantado</span>
          <span className="font-bold tabular-nums text-rose-300">{money(Number(advance.amount ?? 0))}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Método</span>
          <span className="font-semibold capitalize text-white">{advance.payment_method ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Fecha y hora</span>
          <span className="font-semibold text-white">
            {fechaMostrada ? fmtDetalleDateTime(fechaMostrada) : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Registrado por</span>
          <span className="font-semibold text-white">{displayResponsable(advance.registered_by_name)}</span>
        </div>
        {advance.note && (
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
            <span className="text-white/50">Nota</span>
            <span className="truncate font-semibold text-white">{advance.note}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export type ItemsDetalleData = {
  professionalName: string | null;
  preparedByName: string;
  preparedAt: string;
  amount: number;
  items: { amount: number; reason: string }[];
};

function ItemsDetalleContent({ data, tone }: { data: ItemsDetalleData; tone: "ajuste" | "deduccion" }) {
  const isAjuste = tone === "ajuste";
  const border = isAjuste ? "border-emerald-300/25" : "border-rose-300/25";
  const gradient = isAjuste
    ? "bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(8,11,20,0.96),rgba(2,4,12,0.98))]"
    : "bg-[linear-gradient(135deg,rgba(244,63,94,0.14),rgba(8,11,20,0.96),rgba(2,4,12,0.98))]";
  const shadow = isAjuste
    ? "shadow-[0_0_40px_rgba(16,185,129,0.12),0_18px_55px_-34px_rgba(0,0,0,1)]"
    : "shadow-[0_0_40px_rgba(244,63,94,0.12),0_18px_55px_-34px_rgba(0,0,0,1)]";
  const divide = isAjuste ? "divide-emerald-300/10" : "divide-rose-300/10";
  const amountColor = isAjuste ? "text-emerald-300" : "text-rose-300";
  const sign = isAjuste ? "+" : "−";

  return (
    <div className={cn("overflow-hidden rounded-2xl border text-sm", border, gradient, shadow)}>
      <div className={cn("divide-y", divide)}>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Profesional</span>
          <span className="font-semibold text-white">{data.professionalName || "—"}</span>
        </div>
        {data.items.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-2 px-3.5 py-2.5">
            <span className="text-white/50">{item.reason}</span>
            <span className={cn("font-semibold", amountColor)}>
              {sign}
              {money(Number(item.amount))}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="font-bold text-white/70">Total</span>
          <span className={cn("text-base font-bold", amountColor)}>
            {sign}
            {money(data.amount)}
          </span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Preparado por</span>
          <span className="font-semibold text-white">{displayResponsable(data.preparedByName)}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Fecha y hora</span>
          <span className="font-semibold text-white">{fmtDetalleDateTime(data.preparedAt)}</span>
        </div>
      </div>
    </div>
  );
}

export function AjusteDetalleContent({ data }: { data: ItemsDetalleData }) {
  return <ItemsDetalleContent data={data} tone="ajuste" />;
}

export function DeduccionDetalleContent({ data }: { data: ItemsDetalleData }) {
  return <ItemsDetalleContent data={data} tone="deduccion" />;
}

// "Venta anulada" — ver historial-movimientos.ts (HistorialVentaAnuladaRow) y
// 20261026020000_void_adjustment_settlement_tracking.sql. Tono violeta,
// distinto del verde/rojo de Ajuste/Deducción y del rojo de Adelanto —
// pedido explícito de distinguirlo visualmente de un adelanto normal,
// aunque aparezca en la misma lista.
export function VentaAnuladaDetalleContent({ data }: { data: import("@/lib/historial-movimientos").HistorialVentaAnuladaRow }) {
  const isCompensado = Boolean(data.appliedSettlementRunId);
  // "credito" — ver restore_payment_authorized: la venta se restableció
  // después de que su deducción ya se había compensado en una liquidación
  // cerrada (que no se toca) — esto es un crédito A FAVOR del profesional,
  // nunca otra deducción. Mismo monto, signo y título opuestos.
  const isCredito = data.kind === "credito";
  const metodoLabel = data.method
    ? (PAY_METHOD_LABEL[data.method as PayMethod] ?? data.method)
    : "—";
  return (
    <div className="overflow-hidden rounded-2xl border border-violet-300/25 bg-[linear-gradient(135deg,rgba(167,139,250,0.14),rgba(8,11,20,0.96),rgba(2,4,12,0.98))] text-sm shadow-[0_0_40px_rgba(167,139,250,0.12),0_18px_55px_-34px_rgba(0,0,0,1)]">
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <span className="text-sm font-bold text-white">
          {isCredito ? "Crédito por venta restablecida" : "Venta anulada"}
        </span>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1",
            isCompensado
              ? "text-emerald-300 bg-emerald-400/10 ring-emerald-400/20"
              : "text-amber-300 bg-amber-400/10 ring-amber-400/20",
          )}
        >
          {isCompensado ? "Compensado" : "Pendiente"}
        </span>
      </div>
      <div className="divide-y divide-violet-300/10">
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Número de venta</span>
          <span className="font-semibold text-white">#{data.saleId.slice(-6).toUpperCase()}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Fecha y hora de la venta</span>
          <span className="font-semibold text-white">
            {data.saleCreatedAt ? fmtDetalleDateTime(data.saleCreatedAt) : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Cliente</span>
          <span className="font-semibold text-white">{data.clientName || "—"}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Profesional</span>
          <span className="font-semibold text-white">{data.professionalName || "—"}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Servicio/producto</span>
          <span className="font-semibold text-white">{data.serviceName || "—"}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Importe original cobrado</span>
          <span className="font-semibold text-white">{money(data.saleTotal)}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Medio de pago</span>
          <span className="font-semibold capitalize text-white">{metodoLabel}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">% de comisión original</span>
          <span className="font-semibold text-white">
            {data.commissionPct != null ? `${data.commissionPct}%` : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">{isCredito ? "Crédito a favor del profesional" : "Comisión ya pagada"}</span>
          <span className={cn("font-semibold", isCredito ? "text-emerald-300" : "text-violet-300")}>
            {isCredito ? "+" : ""}
            {money(data.commissionAmount)}
          </span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Liquidación donde se pagó</span>
          <span className="font-semibold text-white">
            {data.originalSettlementRunNumber != null ? `#${data.originalSettlementRunNumber}` : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
          <span className="text-white/50">{isCredito ? "Motivo del restablecimiento" : "Motivo de la anulación"}</span>
          <span className="truncate font-semibold text-white">{data.reason || "—"}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">{isCredito ? "Restablecido por" : "Anulado por"}</span>
          <span className="font-semibold text-white">{displayResponsable(data.performedByName)}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Autorizado por</span>
          <span className="font-semibold text-white">{data.authorizedByName || "—"}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">{isCredito ? "Fecha y hora del restablecimiento" : "Fecha y hora de la anulación"}</span>
          <span className="font-semibold text-white">{fmtDetalleDateTime(data.voidedAt)}</span>
        </div>
        {isCompensado ? (
          <>
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <span className="text-white/50">Compensado en liquidación</span>
              <span className="font-semibold text-emerald-300">
                {data.appliedSettlementRunNumber != null ? `#${data.appliedSettlementRunNumber}` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <span className="text-white/50">Fecha de la compensación</span>
              <span className="font-semibold text-white">
                {data.appliedAt ? fmtDetalleDateTime(data.appliedAt) : "—"}
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-white/50">Estado</span>
            <span className="font-semibold text-amber-300">Pendiente de la próxima liquidación</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Presentismo de UNA jornada confirmada — ver historial-movimientos.ts
// (HistorialPresentismoRow) y la migración de presentismo
// (attendance_confirmations/attendance_adjustments). Un único movimiento
// diario, nunca por venta. Tono según impacto: rojo si descontó, verde si
// no descontó nada o si fue un ajuste a favor.
export function PresentismoDetalleContent({
  data,
}: {
  data: import("@/lib/historial-movimientos").HistorialPresentismoRow;
}) {
  const statusLabel = data.status === "a_tiempo" ? "A tiempo" : data.status === "tarde" ? "Tarde" : "Ausente";
  const statusClass =
    data.status === "a_tiempo"
      ? "text-emerald-300 bg-emerald-400/10 ring-emerald-400/20"
      : data.status === "tarde"
        ? "text-rose-300 bg-rose-400/10 ring-rose-400/20"
        : "text-zinc-300 bg-zinc-400/10 ring-zinc-400/20";
  const amount = data.discountAmountApplied;
  const amountColor = amount > 0 ? "text-rose-300" : "text-emerald-300";
  const amountSign = amount === 0 ? "" : amount > 0 ? "-" : "+";
  const borderTone = amount > 0 ? "border-rose-400/25" : "border-emerald-400/25";
  const bgTone =
    amount > 0
      ? "bg-[linear-gradient(135deg,rgba(244,63,94,0.13),rgba(20,7,9,0.94),rgba(10,3,4,0.96))]"
      : "bg-[linear-gradient(135deg,rgba(52,211,153,0.10),rgba(5,14,11,0.95),rgba(2,8,6,0.98))]";
  return (
    <div className={cn("overflow-hidden rounded-2xl border text-sm", borderTone, bgTone)}>
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <span className="text-sm font-bold text-white">Presentismo</span>
        <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1", statusClass)}>
          {statusLabel}
        </span>
      </div>
      <div className="divide-y divide-white/10">
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Fecha</span>
          <span className="font-semibold text-white">
            {new Date(`${data.date}T12:00:00`).toLocaleDateString("es-AR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })}
          </span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Horario programado</span>
          <span className="font-semibold text-white">
            {data.expectedStartAt
              ? new Date(data.expectedStartAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
              : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Hora real de llegada</span>
          <span className="font-semibold text-white">
            {data.effectiveClockInAt
              ? new Date(data.effectiveClockInAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
              : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Minutos de tardanza</span>
          <span className="font-semibold text-white">{data.lateMinutes > 0 ? `${data.lateMinutes} min` : "—"}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">{data.penaltyOverridden ? "Ajuste manual" : "Ajuste automático"}</span>
          <span className={cn("text-base font-bold", amountColor)}>
            {amountSign}
            {money(Math.abs(amount))}
          </span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Confirmado por</span>
          <span className="font-semibold text-white">{displayResponsable(data.confirmedByName)}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-white/50">Fecha y hora de confirmación</span>
          <span className="font-semibold text-white">{fmtDetalleDateTime(data.confirmedAt)}</span>
        </div>
      </div>
    </div>
  );
}
