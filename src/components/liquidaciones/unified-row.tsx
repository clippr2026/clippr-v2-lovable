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
import { ChevronDown, Info, Loader2, MoreHorizontal, Trash2, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { money, paymentMethodLabel, realNote } from "./movimiento-format";
import { normalizeCierreMethodKey } from "@/lib/caja-cierre";
import { resolveDisplayConcept, type EmployeeCommissionMap } from "@/lib/service-pricing";
import { resolveVentaDate } from "@/lib/historial-movimientos";
import {
  getPaymentCollectionHistory,
  type PaymentCollectionHistoryItem,
} from "@/components/cash-register/cobrar-pendiente";

// Grilla compartida por TODAS las filas de la lista única (ventas,
// adelantos, pagos, ajustes, deducciones, presentismo) y por su
// encabezado — mismas 8 columnas siempre: Fecha y hora | Cliente |
// Concepto | Precio | Comisión | Propina | Medio de pago | Puntualidad.
// "Puntualidad" va en la última columna, después de Medio de pago.
// La 7ª celda (Medio de pago) lleva un poco de aire a la izquierda: Propina
// va alineada a la derecha y Medio de pago a la izquierda, y sin esto el
// título "PROPINA" quedaba pegado a "MEDIO DE PAGO".
export const LIQ_GRID_COLS =
  "grid-cols-[116px_minmax(100px,1fr)_minmax(130px,1.1fr)_100px_100px_100px_minmax(90px,1fr)_100px] [&>*:nth-child(7)]:pl-4";

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
      <div className="text-right">Puntualidad</div>
    </div>
  );
}

// Tarjeta de resumen ("Comisiones generadas" / "Adelantos" / "Total a
// pagar") — misma presentación en Caja > Liquidaciones y Panel del
// profesional > Movimientos.
export function StatCard({
  label,
  sublabel,
  value,
  tone,
  info,
  className,
}: {
  label: string;
  sublabel?: string;
  value: React.ReactNode;
  tone: "neutral" | "violet" | "green" | "rose";
  info?: React.ReactNode;
  className?: string;
}) {
  const toneClass = {
    neutral: "border-white/[0.075] bg-white/[0.025] text-white shadow-[0_0_28px_rgba(255,255,255,0.035)]",
    violet: "border-violet-300/18 bg-violet-400/[0.055] text-violet-300 shadow-[0_0_28px_rgba(167,139,250,0.10)]",
    green: "border-emerald-400/18 bg-emerald-400/[0.055] text-emerald-300 shadow-[0_0_28px_rgba(34,197,94,0.09)]",
    rose: "border-rose-400/18 bg-rose-400/[0.055] text-rose-300 shadow-[0_0_28px_rgba(251,113,133,0.10)]",
  }[tone];

  const labelClass = "text-white/75";

  return (
    <div className={cn("rounded-2xl border px-3.5 py-2.5", toneClass, className)}>
      <div className={cn("flex items-center gap-1 text-xs font-semibold", labelClass)}>
        <span>{label}</span>
        {info && <InfoPopover text={info} />}
      </div>
      {sublabel && (
        <div className="text-[10px] font-medium text-white/40">{sublabel}</div>
      )}
      <div className="mt-0.5 text-lg font-bold tabular-nums">{value}</div>
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

// Historial completo de pagos de UNA venta (todos los cobros reales,
// incluidas reversiones) — se pide on-demand recién al desplegar una fila
// "recuperada" (isRecovered), nunca precargado: una venta puede acumular
// semanas de cobros parciales que no hace falta traer si nadie despliega
// el detalle. Mismo dato que usa el historial de "Movimientos de caja"
// (Caja > Resumen), reutilizado acá para no reimplementar el fetch.
function PaymentHistoryPanel({ paymentId }: { paymentId: string }) {
  const [items, setItems] = React.useState<PaymentCollectionHistoryItem[] | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPaymentCollectionHistory(paymentId)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3.5 py-2.5 text-xs text-sky-100/70 sm:px-4">
        <Loader2 className="size-3.5 animate-spin" /> Cargando historial de pagos…
      </div>
    );
  }
  if (!items || items.length === 0) {
    return (
      <div className="px-3.5 py-2.5 text-xs text-sky-100/70 sm:px-4">Todavía no se cobró nada de esta venta.</div>
    );
  }

  return (
    <div className="divide-y divide-sky-400/10 px-3.5 py-1 sm:px-4">
      {items.map((it) => {
        const dt = new Date(it.collected_at);
        const isReversal = it.amount < 0;
        return (
          <div key={it.id} className="flex items-center justify-between gap-3 py-2 text-xs">
            <div className="flex min-w-0 flex-col">
              <span className="text-sky-50/90">
                {dt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })} ·{" "}
                {dt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}
              </span>
              <span className="truncate text-sky-100/60">
                {paymentMethodLabel(it.method ?? "")}
                {it.collected_by_name ? ` · ${it.collected_by_name}` : ""}
                {isReversal && it.reversal_reason ? ` · Reversión: ${it.reversal_reason}` : ""}
                {it.observations ? ` · ${it.observations}` : ""}
              </span>
            </div>
            <span className={cn("shrink-0 font-bold tabular-nums", isReversal ? "text-rose-300" : "text-emerald-300")}>
              {isReversal ? "-" : "+"}
              {money(Math.abs(it.amount))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Una fila de venta con comisión dentro de la lista única de
// Liquidaciones/Movimientos — autocontenida (desktop + mobile en un solo
// bloque) para poder intercalarse cronológicamente con pagos/adelantos/
// ajustes/deducciones. `c` es una fila de commission_records enriquecida
// con `.sale` (el payment real) — misma forma en Caja y en el profesional.
// `commissionsMap` (_employeeCommissions de business_settings.schedule) es
// opcional: sin él, o sin sale.items (ventas viejas, o liquidaciones que
// cayeron al fallback de snapshot sin items), se muestra service_name tal
// cual guardado — nunca rompe, solo deja de filtrar.
// Quién cobró una venta: payments.charged_by (id de perfil) → nombre. Las filas
// de Liquidaciones/Mi Panel vienen de distintos orígenes y no todas traen ese
// dato, así que se resuelve acá, en lote (una consulta por tanda de filas
// visibles) y con caché. Un perfil que no se puede leer cae en "Recepción".
const cobradorCache = new Map<string, string | null>();
let cobradorPending = new Set<string>();
let cobradorTimer: ReturnType<typeof setTimeout> | null = null;
const cobradorListeners = new Set<() => void>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f-]{13,}$/i;

async function flushCobradores() {
  cobradorTimer = null;
  const ids = Array.from(cobradorPending);
  cobradorPending = new Set();
  if (ids.length === 0) return;
  try {
    const { data: pays } = await supabase.from("payments" as any).select("id,charged_by").in("id", ids);
    const byPay = new Map<string, string | null>((pays ?? []).map((p: any) => [p.id, p.charged_by ?? null]));
    const profileIds = Array.from(new Set(Array.from(byPay.values()).filter((v): v is string => !!v && UUID_RE.test(v))));
    const names = new Map<string, string>();
    if (profileIds.length > 0) {
      const { data: profs } = await supabase.from("profiles").select("id,full_name").in("id", profileIds);
      (profs ?? []).forEach((pr: any) => pr.full_name && names.set(pr.id, pr.full_name));
    }
    for (const id of ids) {
      const raw = byPay.get(id) ?? null;
      cobradorCache.set(id, !raw ? null : names.get(raw) ?? (UUID_RE.test(raw) ? "Recepción" : raw));
    }
  } catch {
    for (const id of ids) cobradorCache.set(id, null);
  }
  cobradorListeners.forEach((fn) => fn());
}

function useCobradoPor(saleId: string | null | undefined): string | null {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!saleId) return;
    cobradorListeners.add(force);
    if (!cobradorCache.has(saleId)) {
      cobradorPending.add(saleId);
      if (!cobradorTimer) cobradorTimer = setTimeout(flushCobradores, 40);
    }
    return () => {
      cobradorListeners.delete(force);
    };
  }, [saleId]);
  return saleId ? cobradorCache.get(saleId) ?? null : null;
}

export function VentaRow({
  c,
  commissionsMap,
  presentismoDescuento,
}: {
  c: any;
  commissionsMap?: EmployeeCommissionMap | null;
  // Parte de este servicio del descuento de presentismo del día, cuando la
  // regla es por porcentaje (positivo = descuento, negativo = a favor).
  // undefined = este servicio no lleva presentismo propio.
  presentismoDescuento?: number;
}) {
  const presentismoVenta =
    presentismoDescuento === undefined || presentismoDescuento === 0
      ? null
      : {
          text:
            presentismoDescuento > 0 ? `-${money(presentismoDescuento)}` : `+${money(-presentismoDescuento)}`,
          className: presentismoDescuento > 0 ? "text-rose-300" : "text-emerald-300",
        };
  const [expanded, setExpanded] = React.useState(false);
  const sale = c.sale ?? {};
  const cobradoPor = useCobradoPor(c.sale_id ?? sale.id ?? null);
  // resolveVentaDate: payments.created_at (== charged_at) siempre antes que
  // commission_records.created_at — ver comentario en historial-movimientos.ts.
  const saleDateRaw = resolveVentaDate(c);
  const saleDate = saleDateRaw ? new Date(saleDateRaw) : null;
  const dateTime = saleDate
    ? `${saleDate.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })} · ${saleDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}`
    : "—";
  // Fila sintética: UN cobro puntual contra una venta pendiente/parcial —
  // ver syntheticRecoveredRows (cash-register.tsx) / fetchPendingVentasForProfessional
  // (use-professionals-data.ts). c.amount/c.pending_amount acá NUNCA son la
  // comisión completa de la venta, son solo lo habilitado por ESE cobro.
  const isRecovered = Boolean(c.__recovered);
  // sale.status ya refleja el estado ACTUAL (al momento de esta carga): si
  // esta fue la última porción que faltaba, sale.status ya es 'cobrado'
  // acá — "recuperado" (saldo saldado) en vez de "parcial" (todavía debe).
  const isFullyRecovered = isRecovered && sale.status === "cobrado";
  const saleOriginalDate = sale.created_at ? new Date(sale.created_at) : null;
  const saleOriginalDateLabel = saleOriginalDate
    ? saleOriginalDate.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;
  const collectedAmount = Number(sale.collected_amount ?? sale.total ?? sale.amount ?? 0);
  const saldoPendiente = Math.max(0, Number(sale.total ?? sale.amount ?? 0) - collectedAmount);
  const method = paymentMethodLabel(String(sale.method ?? sale.payment_method ?? ""));
  // Concepto a mostrar: si la venta tuvo varios ítems, saca del nombre
  // concatenado cualquier producto de catálogo sin comisión activa para
  // este profesional (ej. "Corte en cabello corto / Coca" → "Corte en
  // cabello corto" si Coca no tiene comisión configurada) — el item sigue
  // intacto en sale.items, esto es solo la etiqueta. c.professional_id
  // siempre existe (columna propia de commission_records).
  const displayConcept = resolveDisplayConcept(
    sale.items,
    c.professional_id ?? null,
    commissionsMap,
    sale.service_name,
  );
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
  // normalizeCierreMethodKey (ya compartida con Caja > Cierre de caja):
  // payments.method usa vocabularios distintos entre ventas viejas y
  // nuevas ("efectivo" vs "cash", con/sin acentos) — un === "cash" literal
  // dejaba afuera ventas en efectivo reales solo porque el valor guardado
  // era "efectivo" en vez de "cash".
  const isCashSale = normalizeCierreMethodKey(sale.method ?? sale.payment_method) === "cash";
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
  // "Pago parcial" mientras la venta sigue debiendo saldo; "Pago pendiente
  // recuperado" cuando ESTE cobro fue el que terminó de saldarla — nunca
  // sobre una venta normal (cobrada de una sola vez, isRecovered=false).
  const recoveredBadgeLabel = isFullyRecovered ? "Pago pendiente recuperado" : "Pago parcial";
  // Nota real del cliente/staff en esta venta — nunca el marcador técnico
  // [[HIST]] (historial interno de "Envió a caja", ver movimiento-format.ts)
  // ni ningún otro dato de auditoría/metadata del sistema. Si no hay nota
  // real, esto es null.
  const saleNote = realNote(sale.observations);
  // Precio de lista/final, descuento, promoción, propina, medio de pago y
  // comisión YA son visibles en la fila cerrada (columnas propias o el
  // tachado del precio) — la única razón real para expandir un servicio ya
  // realizado es leer una nota real. Sin nota, no hay flecha ni nada para
  // abrir. Una fila recuperada SIEMPRE es desplegable: ahí vive el
  // historial completo de pagos de la venta (ver PaymentHistoryPanel),
  // independiente de si además tiene una nota real.
  const hasExpandableContent = Boolean(saleNote) || isRecovered;
  // Mobile usa <button> real solo cuando hay algo para expandir — igual
  // criterio que el role="button" del bloque desktop de más abajo.
  const MobileTag = hasExpandableContent ? "button" : "div";

  const anulada = Boolean(c.__anulada);
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-violet-400/30 bg-[#0b0a14] bg-[radial-gradient(120%_100%_at_100%_0%,rgba(139,92,246,0.14),transparent_62%)] sm:border-white/[0.07] sm:bg-black/18 sm:bg-none", anulada && "border-rose-400/30 opacity-70")}>
      {/* Desktop — div con role="button", no <button> real: la celda de
          precio contiene su propio InfoPopover (un <button>), y un <button>
          no puede anidar otro <button> válidamente en HTML. */}
      <div
        role={hasExpandableContent ? "button" : undefined}
        tabIndex={hasExpandableContent ? 0 : undefined}
        onClick={hasExpandableContent ? () => setExpanded((v) => !v) : undefined}
        onKeyDown={
          hasExpandableContent
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded((v) => !v);
                }
              }
            : undefined
        }
        className={cn(
          "hidden w-full items-center gap-3 px-4 py-3 text-left text-sm transition sm:grid",
          hasExpandableContent && "cursor-pointer hover:bg-white/[0.025]",
          LIQ_GRID_COLS,
        )}
      >
        <div className="text-white/52">{dateTime}</div>
        <div className="truncate text-white/82">{sale.client_name ?? "Sin cliente"}</div>
        <div className="min-w-0">
          <div className="truncate text-white/82">{displayConcept}</div>
          {isRecovered && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1",
                  isFullyRecovered
                    ? "bg-emerald-400/15 text-emerald-200 ring-emerald-400/25"
                    : "bg-amber-400/15 text-amber-200 ring-amber-400/25",
                )}
              >
                {recoveredBadgeLabel}
              </span>
              {saleOriginalDateLabel && (
                <span className="truncate text-[10px] text-white/40">Servicio: {saleOriginalDateLabel}</span>
              )}
            </div>
          )}
          {conceptSubtitle && (
            <div className={cn("truncate text-[11px] font-medium", conceptSubtitleClass)}>{conceptSubtitle}</div>
          )}
        </div>
        <div className="text-right tabular-nums text-white/72">
          {isRecovered ? (
            // Pago parcial/recuperado: el precio tachado de siempre no
            // alcanza acá — hace falta distinguir precio total, cuánto se
            // cobró EN TOTAL hasta ahora (no solo este evento) y cuánto
            // sigue faltando, para que nunca se confunda con una venta
            // cobrada completa de una sola vez.
            <div className="space-y-0.5">
              <div className="text-[11px] text-white/40">Total {money(saleTotal)}</div>
              <div className="font-semibold text-emerald-300">Cobrado {money(collectedAmount)}</div>
              {saldoPendiente > 0 && (
                <div className="text-[11px] font-semibold text-amber-300">Saldo {money(saldoPendiente)}</div>
              )}
            </div>
          ) : (
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
          )}
        </div>
        <div className="text-right font-bold tabular-nums text-violet-300">
          <div className="flex items-center justify-end gap-1">
            {money(Number(c.pending_amount ?? c.amount ?? 0))}
            {isRecovered && (
              <InfoPopover
                text={
                  <div className="space-y-1">
                    <div className="text-white/70">
                      Comisión habilitada por ESTE cobro puntual — no la comisión completa de la venta.
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-1">
                      <span className="text-white/60">Cobrado este evento</span>
                      <span className="font-semibold text-white">{money(Number(c.amount ?? 0))}</span>
                    </div>
                  </div>
                }
              />
            )}
          </div>
        </div>
        <div className={cn("text-right text-sm font-semibold tabular-nums", hasTip ? "text-emerald-300" : "text-white/25")}>
          {tipText}
        </div>
        <div className="flex items-center justify-between gap-2 text-white/52">
          <span>{method}</span>
          {hasExpandableContent && (
            <ChevronDown className={cn("size-3.5 shrink-0 text-white/30 transition-transform", expanded && "rotate-180")} />
          )}
        </div>
        {/* Presentismo por porcentaje: la parte de ESTE servicio del descuento
            del día (ver presentismoRepartido en cash-register.tsx). Uno fijo
            va en su propia fila diaria (kind:"presentismo"), no acá — nunca
            las dos cosas, para no duplicar el descuento. */}
        <div className={cn("text-right tabular-nums", presentismoVenta ? cn("font-semibold", presentismoVenta.className) : "text-white/25")}>
          {presentismoVenta ? presentismoVenta.text : "—"}
        </div>
      </div>
      {/* Mobile — sin InfoPopover acá, un <button> real es seguro. Misma tarjeta que Movimientos de caja:
          tipo y fecha arriba, comisión a la derecha; cliente y servicio; chips con precio, medio y extras. */}
      <MobileTag
        type={hasExpandableContent ? "button" : undefined}
        onClick={hasExpandableContent ? () => setExpanded((v) => !v) : undefined}
        className="w-full px-3.5 py-2.5 text-left sm:hidden"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 text-[12px] tabular-nums text-white/60">{dateTime}</span>
          <div className="shrink-0 text-right">
            {anulada ? (
              <>
                <div className="text-lg font-bold leading-none tabular-nums text-rose-300 line-through">{money(saleTotal)}</div>
                <div className="mt-0.5 text-[11px] font-semibold text-rose-300">Venta anulada</div>
              </>
            ) : (
              <>
                <div className="text-lg font-bold leading-none tabular-nums text-violet-300">
                  +{money(Number(c.pending_amount ?? c.amount ?? 0))}
                </div>
                <div className="mt-0.5 text-[11px] font-medium text-violet-200/70">Comisión{isRecovered ? " del cobro" : ""}</div>
              </>
            )}
          </div>
        </div>
        <div className="mt-2 min-w-0">
          <div className="truncate text-[15px] font-semibold leading-tight text-white">{sale.client_name ?? "Sin cliente"}</div>
          <div className="mt-0.5 truncate text-[13px] text-white/65">{displayConcept}</div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {isRecovered ? (
            <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[12px] text-white/80 ring-1 ring-white/10">
              Total {money(saleTotal)} · Cobrado <span className="font-semibold text-emerald-300">{money(collectedAmount)}</span>
              {saldoPendiente > 0 && (
                <>
                  {" "}· Saldo <span className="font-semibold text-amber-300">{money(saldoPendiente)}</span>
                </>
              )}
            </span>
          ) : (
            <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[12px] text-white/80 ring-1 ring-white/10">
              {showReduction ? (
                <>
                  <span className="text-white/40 line-through">{money(originalAmount)}</span> {money(saleTotal)}
                </>
              ) : (
                money(saleTotal)
              )}
            </span>
          )}
          <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[12px] text-white/80 ring-1 ring-white/10">{method}</span>
          {hasTip && (
            <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-emerald-300 ring-1 ring-emerald-300/25">
              + propina {money(Number(sale.tip_amount))}
            </span>
          )}
          {presentismoVenta && (
            <span className={cn("rounded-full bg-white/[0.05] px-2 py-0.5 text-[12px] font-semibold tabular-nums ring-1 ring-white/10", presentismoVenta.className)}>
              Puntualidad {presentismoVenta.text}
            </span>
          )}
        </div>
        {(isRecovered || conceptSubtitle || hasExpandableContent || cobradoPor) && (
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              {isRecovered && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1",
                    isFullyRecovered
                      ? "bg-emerald-400/15 text-emerald-200 ring-emerald-400/25"
                      : "bg-amber-400/15 text-amber-200 ring-amber-400/25",
                  )}
                >
                  {recoveredBadgeLabel}
                </span>
              )}
              {isRecovered && saleOriginalDateLabel && (
                <span className="truncate text-[11px] text-white/50">Servicio: {saleOriginalDateLabel}</span>
              )}
              {conceptSubtitle && (
                <span className={cn("truncate text-[12px] font-medium", conceptSubtitleClass)}>{conceptSubtitle}</span>
              )}
              {cobradoPor && <span className="truncate text-[12px] text-white/50">{cobradoPor} → Cobró</span>}
            </div>
            {hasExpandableContent && (
              <ChevronDown className={cn("size-4 shrink-0 text-white/40 transition-transform", expanded && "rotate-180")} />
            )}
          </div>
        )}
      </MobileTag>
      {/* Contenido expandible: nota real (si hay) + historial completo de
          pagos (solo filas recuperadas) — ver PaymentHistoryPanel. Precio
          de lista/final, descuento, promoción, propina, medio de pago y
          comisión NUNCA se repiten acá, ya son columnas/tachado visibles
          en la fila cerrada; el historial de pagos sí es información
          nueva, no visible en ningún otro lado de esta fila. */}
      {expanded && (saleNote || isRecovered) && (
        <div className="border-t border-sky-400/25 bg-sky-400/[0.12] sm:px-0">
          {saleNote && <div className="px-3.5 py-2.5 text-xs text-sky-100 sm:px-4 sm:text-sm">{saleNote}</div>}
          {isRecovered && c.sale_id && <PaymentHistoryPanel paymentId={c.sale_id} />}
        </div>
      )}
    </div>
  );
}


// Separador por día de la lista de Movimientos (Caja → Liquidaciones y Panel
// del profesional). Los días se cuentan en hora de Argentina, nunca en la del
// dispositivo, para que un movimiento de las 23:30 no caiga en el día siguiente.
const MOV_DAY_TZ = "America/Argentina/Buenos_Aires";

function movDayKey(at: unknown): string | null {
  const d = new Date(String(at ?? ""));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("sv-SE", { timeZone: MOV_DAY_TZ });
}

function movDayLabel(dayKey: string): string {
  const todayKey = new Date().toLocaleDateString("sv-SE", { timeZone: MOV_DAY_TZ });
  const yesterday = new Date(`${todayKey}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toLocaleDateString("sv-SE");
  const [y, m, d] = dayKey.split("-");
  const date = `${d}/${m}`;
  if (dayKey === todayKey) return `Hoy · ${date}`;
  if (dayKey === yesterdayKey) return `Ayer · ${date}`;
  const weekday = new Date(`${dayKey}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long" });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${date}${y !== todayKey.slice(0, 4) ? `/${y}` : ""}`;
}

type DayHeaderItem = { kind: "dia"; dayKey: string; presentismo: any | null };

// Intercala un item { kind: "dia" } antes del primer movimiento de cada día
// (la lista ya viene ordenada de más nuevo a más viejo). La puntualidad del
// día NO es una fila aparte: se muestra en el encabezado del día, a la
// derecha, y se saca de la lista de filas.
// `todoPresentismo`: toda la puntualidad del período, incluida la que NO es
// una fila propia (un descuento por porcentaje se reparte entre las ventas
// del día y nunca llega a `items`).
export function withDayHeaders<T extends { at?: unknown; kind?: string; data?: any }>(
  items: T[],
  todoPresentismo: any[] = [],
): Array<T | DayHeaderItem> {
  const presentismoPorDia = new Map<string, any>();
  for (const p of todoPresentismo) {
    const key = movDayKey(p.effectiveClockInAt ?? `${p.date}T12:00:00`);
    if (key && !presentismoPorDia.has(key)) presentismoPorDia.set(key, p);
  }
  for (const item of items) {
    if (item.kind !== "presentismo") continue;
    const key = movDayKey(item.at);
    if (key && !presentismoPorDia.has(key)) presentismoPorDia.set(key, item.data);
  }
  const out: Array<T | DayHeaderItem> = [];
  let prev: string | null = null;
  for (const item of items) {
    const key = movDayKey(item.at);
    if (key && key !== prev) {
      out.push({ kind: "dia", dayKey: key, presentismo: presentismoPorDia.get(key) ?? null });
      prev = key;
    }
    if (item.kind === "presentismo") continue;
    out.push(item);
  }
  return out;
}

export function MovDayHeader({
  dayKey,
  presentismo,
  count,
  open,
  onToggle,
}: {
  dayKey: string;
  presentismo?: any | null;
  count?: number;
  open?: boolean;
  onToggle?: () => void;
}) {
  const p = presentismo;
  const amount = p ? Number(p.discountAmountApplied ?? 0) : 0;
  const statusLabel = p ? (p.status === "a_tiempo" ? "A tiempo" : p.status === "tarde" ? "Tarde" : "Ausente") : "";
  const montoText = amount > 0 ? money(amount) : amount < 0 ? `+${money(-amount)}` : "";
  const text = [statusLabel, montoText].filter(Boolean).join(" ");
  const cls = p?.status === "ausente" ? "text-white/50" : p?.status === "tarde" ? "text-rose-300" : "text-emerald-300";
  const llegada = p?.effectiveClockInAt
    ? new Date(p.effectiveClockInAt).toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: MOV_DAY_TZ,
      })
    : null;
  const collapsible = !!onToggle;
  const Tag = collapsible ? "button" : "div";
  const puntualidad =
    p && (llegada || text) ? (
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px]">
        {llegada && <span className="text-white/60">Entrada {llegada}</span>}
        <span className={cn("font-semibold", cls)}>{text}</span>
        {p.penaltyOverridden && <span className="text-white/50">ajustado</span>}
      </div>
    ) : null;
  return (
    <Tag
      type={collapsible ? "button" : undefined}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left",
        collapsible && "active:bg-white/[0.06]",
      )}
      style={{ backgroundImage: "radial-gradient(110% 120% at 100% 0%, rgba(79,125,255,.10), transparent 62%)" }}
    >
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-white">{movDayLabel(dayKey)}</div>
        {puntualidad}
        {count === 0 && <div className="mt-0.5 text-[12px] text-white/40">Sin servicios ni movimientos</div>}
      </div>
      {collapsible && (
        <ChevronDown className={cn("size-5 shrink-0 text-white/55 transition-transform", !open && "-rotate-90")} />
      )}
    </Tag>
  );
}

// Días plegables: el más reciente abierto y los anteriores cerrados; lo que el usuario abre o cierra se recuerda.
export function useDayCollapse(scope: string) {
  const [state, setState] = React.useState<Record<string, boolean>>({});
  return {
    state,
    scope,
    toggle: (dayKey: string, currentlyOpen: boolean) =>
      setState((cur) => ({ ...cur, [`${scope}:${dayKey}`]: !currentlyOpen })),
  };
}

export function renderCollapsibleDays(
  entries: any[],
  collapse: ReturnType<typeof useDayCollapse>,
  renderItem: (item: any) => React.ReactNode,
): React.ReactNode[] {
  const counts = new Map<string, number>();
  let cur: string | null = null;
  for (const e of entries) {
    if (e.kind === "dia") {
      cur = e.dayKey;
      counts.set(cur!, 0);
    } else if (cur) counts.set(cur, (counts.get(cur) ?? 0) + 1);
  }
  const out: React.ReactNode[] = [];
  let firstDay = true;
  let group: { key: string; header: React.ReactNode; items: React.ReactNode[]; open: boolean } | null = null;
  const flush = () => {
    if (!group) return;
    const g = group;
    out.push(
      <div key={`grupo-${g.key}`} className="max-sm:pt-3 max-sm:first:pt-0">
        {g.header}
        {g.open && g.items.length > 0 && (
          <div className="mt-2 max-sm:ml-4 max-sm:space-y-2.5 max-sm:border-l-2 max-sm:border-violet-400/25 max-sm:pl-3">{g.items}</div>
        )}
      </div>,
    );
    group = null;
  };
  for (const e of entries) {
    if (e.kind === "dia") {
      flush();
      const stored = collapse.state[`${collapse.scope}:${e.dayKey}`];
      const isOpen = stored ?? firstDay;
      firstDay = false;
      const n = counts.get(e.dayKey) ?? 0;
      group = {
        key: e.dayKey,
        open: isOpen,
        items: [],
        header: (
          <MovDayHeader
            key={`dia-${e.dayKey}`}
            dayKey={e.dayKey}
            presentismo={e.presentismo}
            count={n}
            open={isOpen}
            onToggle={n > 0 ? () => collapse.toggle(e.dayKey, isOpen) : undefined}
          />
        ),
      };
      continue;
    }
    if (group) group.items.push(renderItem(e));
    else out.push(renderItem(e));
  }
  flush();
  return out;
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
  presentismoText,
  presentismoClass,
  medioText,
  detalle,
  note,
  redStripe = false,
  skyStripe = false,
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
  // Solo la fila de presentismo los usa — el resto (Adelanto/Pago/Ajuste/
  // Deducción/Venta anulada) deja la columna "Presentismo" en blanco
  // (emptyFiller), ningún cambio de comportamiento para esos casos. En
  // mobile (sin columnas discretas) reemplaza al monto en negrita de
  // siempre, para no perder visibilidad ahí.
  presentismoText?: string;
  presentismoClass?: string;
  // Medio de pago de la fila (hoy solo lo usa el adelanto: Efectivo/Transferencia).
  medioText?: string;
  detalle: React.ReactNode;
  // Nota opcional de un adelanto — NUNCA se muestra sola: aparece como un
  // botón "Ver nota" a la izquierda del tacho, y el contenido solo se
  // despliega al tocarlo (colapsado por defecto, no deforma la fila).
  note?: string | null;
  redStripe?: boolean;
  // Banner celeste — fila de Puntualidad (mismo recurso que redStripe del
  // adelanto, otro color para distinguirlas de un vistazo).
  skyStripe?: boolean;
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
  // Estado propio, nunca mezclado con `expanded`/`onToggle` — esos dos
  // controlan el detalle del MOVIMIENTO (que en Profesionales abre un
  // modal aparte, no un panel inline), mientras que la nota es un
  // desplegable chico e independiente que tiene que funcionar igual sin
  // importar qué hace el resto de la fila al tocarla.
  const [noteOpen, setNoteOpen] = React.useState(false);
  const verNotaButton = note ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setNoteOpen((v) => !v);
      }}
      className="shrink-0 rounded-full px-2 py-1 text-[11px] font-medium text-sky-300/85 transition hover:bg-sky-400/10 hover:text-sky-300"
    >
      {noteOpen ? "Ocultar nota" : "Ver nota"}
    </button>
  ) : null;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border",
        redStripe
          ? "border-rose-900/30 border-l-2 border-l-rose-500/55 bg-[linear-gradient(135deg,rgba(244,63,94,0.06),rgba(14,8,10,0.94),rgba(10,5,6,0.96))]"
          : skyStripe
            ? "border-sky-900/30 border-l-2 border-l-sky-400/55 bg-[linear-gradient(135deg,rgba(56,189,248,0.06),rgba(8,13,18,0.94),rgba(6,10,14,0.96))]"
            : "border-violet-400/30 bg-[#0b0a14] bg-[radial-gradient(120%_100%_at_100%_0%,rgba(139,92,246,0.14),transparent_62%)] sm:border-white/[0.07] sm:bg-black/18 sm:bg-none",
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
          <span>{medioText ?? emptyFiller}</span>
          <div className="flex shrink-0 items-center gap-1">
            {verNotaButton}
            {onDelete ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    disabled={deletingThis}
                    aria-label="Más acciones"
                    className="grid size-7 shrink-0 place-items-center rounded-full text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem
                    onSelect={() => onDelete()}
                    className="text-rose-300 focus:text-rose-200"
                  >
                    <Trash2 className="mr-2 size-4" />
                    Eliminar adelanto
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              clickable && (
                <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")} />
              )
            )}
          </div>
        </div>
        <div className={cn("text-right tabular-nums", presentismoText ? (presentismoClass ?? "text-white/72") : "text-white/30")}>
          {presentismoText ?? emptyFiller}
        </div>
      </Tag>
      {/* Mobile: misma tarjeta que Movimientos de caja — tipo y fecha, importe, detalle y acciones. */}
      <Tag
        type={clickable ? "button" : undefined}
        onClick={clickable ? onToggle : undefined}
        className="w-full px-3.5 py-2.5 text-left sm:hidden"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/85 ring-1 ring-white/15">
              {concepto}
            </span>
            <span className="text-[11px] tabular-nums text-white/55">{dateTime}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={cn("text-lg font-bold leading-none tabular-nums", (presentismoText ? presentismoClass : precioClass) ?? "text-white")}>
              {presentismoText ?? precioText}
            </span>
            {verNotaButton}
            {onDelete ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    disabled={deletingThis}
                    aria-label="Más acciones"
                    className="grid size-7 shrink-0 place-items-center rounded-full text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem
                    onSelect={() => onDelete()}
                    className="text-rose-300 focus:text-rose-200"
                  >
                    <Trash2 className="mr-2 size-4" />
                    Eliminar adelanto
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              clickable && (
                <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
              )
            )}
          </div>
        </div>
        {(cliente && cliente !== "—") || detalle ? (
          <div className="mt-2 min-w-0">
            {cliente && cliente !== "—" && (
              <div className="truncate text-[15px] font-semibold leading-tight text-white">{cliente}</div>
            )}
            {detalle && <div className="mt-0.5 truncate text-[12px] text-white/60">{detalle}</div>}
          </div>
        ) : null}
        {medioText && medioText !== "—" && (
          <div className="mt-2">
            <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[12px] text-white/80 ring-1 ring-white/10">{medioText}</span>
          </div>
        )}
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
      {/* Nota del adelanto — cerrada por defecto siempre, solo aparece al
          tocar "Ver nota". Nunca se abre sola ni con el resto de la fila.
          Fondo celeste a propósito (único uso de este tono en toda la
          fila) para que se lea de un vistazo "esto es una nota", distinto
          del resto de los paneles expandidos (grises). */}
      {note && noteOpen && (
        <div className="border-t border-sky-400/25 bg-sky-400/[0.12] px-3.5 py-2.5 text-xs text-sky-100 sm:px-4 sm:text-sm">
          {note}
        </div>
      )}
    </div>
  );
}
