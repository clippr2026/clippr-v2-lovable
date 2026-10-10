// Filas de la lista única de Liquidaciones — ÚNICA fuente de verdad visual,
// compartida por Caja > Liquidaciones (cash-register.tsx) y Panel del
// profesional > Movimientos (professionals.tsx). Antes cash-register.tsx
// tenía su propia copia de VentaRow/MovRow/InfoPopover y professionals.tsx
// usaba un layout de card completamente distinto (MovimientoCard) — ahora
// las dos pantallas renderizan literalmente el mismo componente, así que
// cualquier corrección visual futura (texto, formato de precio, colores)
// se aplica en un solo lugar y se ve igual en ambas.
import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Info, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { money, paymentMethodLabel } from "./movimiento-format";

// Grilla compartida por TODAS las filas de la lista única (ventas,
// adelantos, pagos, ajustes, deducciones) y por su encabezado — mismas 7
// columnas siempre: Fecha y hora | Cliente | Concepto | Precio | Comisión |
// Propina | Medio de pago.
export const LIQ_GRID_COLS =
  "grid-cols-[116px_minmax(100px,1fr)_minmax(130px,1.1fr)_100px_100px_100px_minmax(90px,1fr)]";

export function UnifiedMovimientosHeader() {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 hidden gap-3 rounded-t-xl border-b border-white/[0.07] bg-[#0A0D18] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/38 sm:grid",
        LIQ_GRID_COLS,
      )}
    >
      <div>Fecha y hora</div>
      <div>Cliente</div>
      <div>Concepto</div>
      <div className="text-right">Precio</div>
      <div className="text-right">Comisión</div>
      <div className="text-right">Propina</div>
      <div>Medio de pago</div>
    </div>
  );
}

export function InfoPopover({ text }: { text: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  // matchMedia("hover: hover") — no window.onMouseEnter/onMouseLeave para
  // abrir en dispositivos táctiles: ahí un tap dispara un mouseenter
  // sintético ANTES del click, así que abrir-por-hover + togglear-por-click
  // se cancelaban entre sí en el mismo toque. En desktop real sí se
  // permite hover.
  const supportsHover = React.useRef(false);
  React.useEffect(() => {
    supportsHover.current =
      typeof window !== "undefined" && window.matchMedia?.("(hover: hover)").matches;
  }, []);

  const updatePosition = React.useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const halfPanel = 112;
    const idealLeft = rect.left + rect.width / 2;
    const clampedLeft = Math.min(
      Math.max(idealLeft, halfPanel + 8),
      window.innerWidth - halfPanel - 8,
    );
    setCoords({ top: rect.bottom + 8, left: clampedLeft });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updatePosition();
    function handleOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
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

// Una fila de venta con comisión dentro de la lista única de
// Liquidaciones/Movimientos — autocontenida (desktop + mobile en un solo
// bloque) para poder intercalarse cronológicamente con pagos/adelantos/
// ajustes/deducciones. `c` es una fila de commission_records enriquecida
// con `.sale` (el payment real) — misma forma en Caja y en el profesional.
export function VentaRow({ c }: { c: any }) {
  const sale = c.sale ?? {};
  const saleDate = c.created_at ? new Date(c.created_at) : null;
  const dateTime = saleDate
    ? `${saleDate.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })} · ${saleDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}`
    : "—";
  const method = paymentMethodLabel(String(sale.method ?? sale.payment_method ?? ""));
  const saleTotal = Number(sale.total ?? sale.amount ?? 0);
  const hasTip = Number(sale.tip_amount ?? 0) > 0;
  const hasDiscount = Number(sale.discount ?? 0) > 0;
  // Prioridad del precio de lista a tachar: original_amount guardado en el
  // momento real de la venta (promoción, descuento manual O precio en
  // efectivo sin descuento explícito — ver register-payment.ts): si no
  // existe (venta vieja, de antes de este cambio), cae al precio ACTUAL del
  // catálogo (listPriceFallback, resuelto por quien arma `c.sale`) solo
  // como aproximación visual — nunca pisa un original_amount real.
  const storedOriginal = Number(sale.original_amount ?? 0);
  const originalAmount = storedOriginal > 0 ? storedOriginal : Number(sale.listPriceFallback ?? saleTotal);
  const hasReduction = originalAmount > saleTotal;
  const isCashSale = String(sale.method ?? sale.payment_method ?? "") === "cash";
  const totalCobrado = saleTotal + Number(sale.tip_amount ?? 0);
  // Distingue POR QUÉ bajó el precio, usando los mismos campos reales que
  // ya usa el resto de la app (register-payment.ts): promotion_id = la
  // venta pasó por una promoción real (nombre en promotion_name);
  // promotion_name sin promotion_id = motivo de un descuento manual (ej.
  // "Cortesía"); ninguno de los dos pero hasReduction + pago en efectivo =
  // precio en efectivo sin ningún descuento explícito. Nunca inventa una
  // regla nueva, solo lee lo que ya se guarda.
  const promoLabel = sale.promotion_id && sale.promotion_name
    ? (/^promo\b/i.test(String(sale.promotion_name))
        ? `Descuento ${sale.promotion_name}`
        : `Descuento promo ${sale.promotion_name}`)
    : null;
  const manualDiscountLabel = !sale.promotion_id && hasDiscount ? sale.promotion_name : null;
  // El catch-all ("Descuento en efectivo") exige método efectivo — sin
  // promo/descuento manual explícito, un precio final por debajo del de
  // lista solo es un recorte real cuando se cobró en efectivo; en
  // cualquier otro método esa diferencia puede ser solo que el precio de
  // lista subió DESPUÉS de esta venta — mostrar "tachado" ahí sería un
  // falso positivo, no un descuento real.
  const cashReduction = isCashSale && hasReduction && !promoLabel && !manualDiscountLabel;
  const showReduction = Boolean(promoLabel) || Boolean(manualDiscountLabel) || cashReduction;
  const conceptSubtitle = promoLabel ?? manualDiscountLabel ?? (cashReduction ? "Descuento en efectivo" : null);
  const conceptSubtitleClass = promoLabel
    ? "text-sky-300"
    : manualDiscountLabel
      ? "text-amber-300"
      : "text-emerald-300/80";
  const tipText = hasTip ? `+ ${money(Number(sale.tip_amount))}` : "—";

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-black/18">
      {/* Desktop */}
      <div
        title={`ID: ${c.id}`}
        className={cn("hidden gap-3 px-4 py-3 text-sm transition hover:bg-white/[0.025] sm:grid", LIQ_GRID_COLS)}
      >
        <div className="text-white/52">{dateTime}</div>
        <div className="truncate text-white/82">{sale.client_name ?? "Sin cliente"}</div>
        <div className="min-w-0">
          <div className="truncate text-white/82">{sale.service_name ?? "Servicio"}</div>
          {conceptSubtitle && (
            <div className={cn("truncate text-[11px] font-medium", conceptSubtitleClass)}>{conceptSubtitle}</div>
          )}
        </div>
        <div className="text-right tabular-nums text-white/72">
          <div className="flex items-center justify-end gap-1">
            {showReduction ? (
              <div>
                <div className="text-[11px] text-white/35 line-through">{money(originalAmount)}</div>
                <div>{money(saleTotal)}</div>
              </div>
            ) : (
              money(saleTotal)
            )}
            {(showReduction || hasTip) && (
              <InfoPopover
                text={
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-white/60">Precio original</span>
                      <span className="font-semibold text-white">{money(originalAmount)}</span>
                    </div>
                    {hasDiscount && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white/60">{promoLabel ?? sale.promotion_name ?? "Descuento"}</span>
                        <span className="font-semibold text-rose-300">-{money(Number(sale.discount))}</span>
                      </div>
                    )}
                    {hasTip && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white/60">Propina</span>
                        <span className="font-semibold text-emerald-300">+{money(Number(sale.tip_amount))}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-1">
                      <span className="text-white/60">Total cobrado</span>
                      <span className="font-semibold text-white">{money(totalCobrado)}</span>
                    </div>
                  </div>
                }
              />
            )}
          </div>
        </div>
        <div className="text-right font-bold tabular-nums text-violet-300">
          {money(Number(c.pending_amount ?? c.amount ?? 0))}
        </div>
        <div className={cn("text-right text-sm font-semibold tabular-nums", hasTip ? "text-emerald-300" : "text-white/25")}>
          {tipText}
        </div>
        <div className="text-white/52">{method}</div>
      </div>
      {/* Mobile */}
      <div className="px-3.5 py-3 text-xs sm:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-white/82">{sale.client_name ?? "Sin cliente"}</div>
            <div className="mt-0.5 truncate text-white/60">{sale.service_name ?? "Servicio"}</div>
            {conceptSubtitle && (
              <div className={cn("truncate text-[11px] font-medium", conceptSubtitleClass)}>{conceptSubtitle}</div>
            )}
            <div className="mt-1 text-white/45">
              Precio:{" "}
              {showReduction ? (
                <>
                  <span className="text-white/30 line-through">{money(originalAmount)}</span> {money(saleTotal)}
                </>
              ) : (
                money(saleTotal)
              )}
            </div>
          </div>
          <div className="shrink-0 space-y-0.5 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white/45">{dateTime}</div>
            <div className="font-bold tabular-nums text-violet-300">
              Comisión: {money(Number(c.pending_amount ?? c.amount ?? 0))}
            </div>
            <div className="text-white/60">{method}</div>
            {hasTip && (
              <div className="text-sm font-semibold tabular-nums text-emerald-300">
                + propina {money(Number(sale.tip_amount))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Fila genérica para Adelanto/Pago/Ajuste/Deducción dentro de la misma
// lista única — mismas 7 columnas que VentaRow (Comisión/Medio de pago no
// aplican a estos movimientos, quedan en "—"). "Detalles" es clickeable
// (ChevronDown) y expande el mismo panel de siempre debajo de la fila (o,
// si quien la usa prefiere un modal aparte, `onToggle` puede abrirlo en vez
// de expandir inline — ver `actions`/`detail` más abajo).
export function MovRow({
  dateTime,
  cliente = "—",
  concepto,
  precioText,
  precioClass,
  detalle,
  redStripe = false,
  expanded,
  onToggle,
  detail,
  loadingDetail: loadingThis = false,
  clickable = true,
  emptyFiller = "—",
  onDelete,
  deleting: deletingThis = false,
  actions,
}: {
  dateTime: string;
  cliente?: string;
  concepto: string;
  precioText: string;
  precioClass?: string;
  detalle: React.ReactNode;
  redStripe?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  detail?: React.ReactNode;
  loadingDetail?: boolean;
  // Adelanto no tiene nada más para mostrar (sin método, sin run) — no
  // tiene sentido que se pueda "abrir": se queda con la info que ya tiene
  // la fila, sin chevron ni modal.
  clickable?: boolean;
  // Adelanto pide celdas vacías en blanco, no "—" (Cliente/Comisión/
  // Propina/Medio de pago no aplican en absoluto, a diferencia de un
  // movimiento donde "—" sí tiene sentido como "no corresponde").
  emptyFiller?: string;
  // Solo Caja > Liquidaciones lo usa — borrar un adelanto cargado por
  // error (ej. una prueba), siempre que no esté ya liquidado.
  onDelete?: () => void;
  deleting?: boolean;
  // Solo Panel del profesional lo usa — Descargar/Compartir comprobante y
  // Confirmar recepción/Observar, siempre visibles (no detrás del
  // expand), igual que ya se mostraban en la card vieja de ese panel.
  actions?: React.ReactNode;
}) {
  const Tag = clickable ? "button" : "div";
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-white/[0.07] bg-black/18",
        redStripe && "border-l-2 border-l-rose-500",
      )}
    >
      {/* Desktop */}
      <Tag
        type={clickable ? "button" : undefined}
        onClick={clickable ? onToggle : undefined}
        className={cn(
          "hidden w-full items-center gap-3 px-4 py-3 text-left text-sm sm:grid",
          clickable && "transition hover:bg-white/[0.025]",
          LIQ_GRID_COLS,
        )}
      >
        <div className="text-white/52">{dateTime}</div>
        <div className="truncate text-white/82">{cliente || emptyFiller}</div>
        <div className="min-w-0">
          <div className="truncate text-white/82">{concepto}</div>
          <div className="truncate text-[11px] font-medium text-white/40">{detalle}</div>
        </div>
        <div className={cn("text-right tabular-nums", precioClass ?? "text-white/72")}>{precioText}</div>
        <div className="text-right text-white/30">{emptyFiller}</div>
        <div className="text-right text-white/30">{emptyFiller}</div>
        <div className="flex items-center justify-between gap-2 text-white/52">
          <span>{emptyFiller}</span>
          {onDelete ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              disabled={deletingThis}
              className="grid size-6 shrink-0 place-items-center rounded-lg text-white/40 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : (
            clickable && (
              <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")} />
            )
          )}
        </div>
      </Tag>
      {/* Mobile */}
      <Tag
        type={clickable ? "button" : undefined}
        onClick={clickable ? onToggle : undefined}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left text-xs sm:hidden"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-white/82">{concepto}</div>
          <div className="mt-0.5 truncate text-white/50">{detalle}</div>
          <div className="mt-0.5 text-[10px] text-white/35">{dateTime}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={cn("font-bold tabular-nums", precioClass ?? "text-white")}>{precioText}</span>
          {onDelete ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              disabled={deletingThis}
              className="grid size-6 shrink-0 place-items-center rounded-lg text-white/40 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : (
            clickable && (
              <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
            )
          )}
        </div>
      </Tag>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] bg-white/[0.012] px-3.5 py-2.5 sm:px-4">
          {actions}
        </div>
      )}
      {clickable && expanded && (
        <div className="border-t border-white/[0.06] bg-white/[0.015] px-3.5 py-3 sm:px-4">
          {loadingThis ? <div className="py-4 text-center text-xs text-white/45">Cargando…</div> : detail}
        </div>
      )}
    </div>
  );
}
