import React from "react";
import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { ServiceImage } from "@/components/ui/service-image";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  type CierreMetodoDetalle,
  type CajaEvento,
  cajaEventosArray,
  appendCajaEvento,
  cleanCajaEventosForDisplay,
  isCajaCerradaRow,
  isCajaReabiertaRow,
  cajaDateKey,
  cajaDateKeyBA,
  filterToDayBA,
  dayBoundsBA,
  cajaTimeLabel,
  cajaHoraDisplay,
  cajaEventTimeToMinutes,
  sortCajaEventos,
  getCajaLastEvent,
  getCajaFirstEvent,
  buildSingleDayCierrePreview,
  findAllPendingCierres,
  type PendingCierre,
  closeSingleDayCierre,
  normalizeCierreMethodKey,
  getCajaAbiertaDesde,
  splitServiciosYProductos,
  countServiciosYProductos,
  parseMoneyInput,
  type ExpectedCashDigital,
  type CajaMovimientoManual,
  type Conciliacion,
  distributeCobroByMethod,
} from "@/lib/caja-cierre";
import { SaldoComposicionLado, SaldoComposicionModal } from "@/components/caja/saldo-composicion";
import { useCashMovements, type CashMovement } from "@/hooks/use-cash-movements";
import { useCajaSummary, type CajaSummary } from "@/hooks/use-caja-summary";
import {
  cleanSearchParam,
  EMPTY_CASH_REGISTER_SEARCH,
  resolvePendingChargeFromSearch,
} from "@/lib/cash-register-search";
import { supabase } from "@/integrations/supabase/client";
import {
  useCajaData,
  searchClientsLite,
  notifyCajaPendientesChanged,
  type ClientLiteResult,
  type PaymentCollectionRow,
} from "@/components/cash-register/use-caja-data";
import {
  PAY_METHOD_LABEL,
  ACTIVE_PAY_METHODS,
  registerPayment,
  deletePayment,
  deleteProfessionalAdvance,
  type PayMethod,
} from "@/components/cash-register/register-payment";
import {
  closeCashSession,
  reopenCashSession,
} from "@/components/cash-register/session-actions";
import {
  CobrarPendienteModal,
  usePendingDebtSummary,
  getPaymentCollectionHistory,
  type PaymentCollectionHistoryItem,
} from "@/components/cash-register/cobrar-pendiente";
import {
  attachReceiptToPayment,
  getPaymentReceiptSignedUrl,
  paymentReceiptPath,
} from "@/lib/payment-receipts";
import { GastosTab } from "@/components/cash-register/gastos-tab";
import {
  Search,
  Plus,
  Minus,
  Zap,
  Hand,
  Clock,
  AlertTriangle,
  Wallet,
  BarChart3,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  ArrowLeft,
  Trash2,
  ClipboardList,
  CreditCard,
  Banknote,
  Smartphone,
  QrCode,
  Check,
  Loader2,
  CalendarDays,
  X,
  Scissors,
  Info,
  Tag,
  Gift,
  User,
  Users,
  Receipt,
  Camera,
  Image as ImageIcon,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import {
  resolveServicePricing,
  isPromotionCurrentlyValid,
  isPromotionApplicable,
  applyPromotionDiscount,
} from "@/lib/service-pricing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { AgendaCenteredModal } from "@/components/agenda/agenda-drawer";
import { fetchSettlementRunServices, fetchSettlementRunSales, resolveOperativeDates } from "@/hooks/use-professionals-data";
import { MultiMethodPaymentSplit, type MultiSplit } from "@/components/cash-register/multi-method-payment-split";
import {
  buildHistorialMovimientos,
  computeLiquidacionSummary,
  isWithinCutoff,
  resolveVentaDate,
  type MovimientoAjuste,
  type MovimientoDeduccion,
} from "@/lib/historial-movimientos";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { displayResponsable, isRunEffectivelySettled } from "@/components/liquidaciones/movimiento-format";
import { HistorialPanelView } from "@/components/liquidaciones/historial-panel-view";
import {
  PagoDetalleContent,
  AjusteDetalleContent,
  DeduccionDetalleContent,
} from "@/components/liquidaciones/movimiento-detalle-content";
import {
  VentaRow,
  MovRow,
  InfoPopover,
  UnifiedMovimientosHeader,
  StatCard,
} from "@/components/liquidaciones/unified-row";

const MANUAL_PENDING_KEY = "clippr_pending_manual_charges";
const HISTORIAL_KEY = "clippr_cobros_historial_v2";
// Marca al inicio de payments.observations para guardar el historial
// "Envió a caja" / "Cobró" de una venta de mostrador sin turno — no hay
// appointment al que asociar appointments.cobro_events en ese caso, así que
// se usa esta columna de texto libre (ya probada, sin columnas nuevas).
const PAY_HIST_MARKER = "[[HIST]]";
// Marca los pagos que nacen de "Retirar stock → Pagar ahora" (Caja >
// Inventario) — ese ingreso ya se muestra con todo su detalle (quién
// retiró, método, etc.) en "Últimos movimientos"; sin esta marca,
// salesMovements (más abajo) lo volvía a listar ahí una segunda vez,
// cruzándolo por nombre de producto contra data.paymentsToday.
const STOCK_WITHDRAWAL_NOTE_MARKER = "[[STOCK_WITHDRAWAL]]";

// Precio para colaboradores (price_catalog.staff_price_mode/
// staff_discount_percent/staff_fixed_price, ver Configuración > Productos)
// — exclusivamente para Inventario > Retirar stock cuando "Quién retira" es
// un profesional real (nunca "Otro", nunca Nueva venta ni ninguna venta
// normal: ningún otro lugar de la app llama a esta función). Único punto
// que calcula el precio colaborador — usado tanto por el preview del modal
// como por confirmStockAdjustment, así nunca pueden mostrar un monto y
// cobrar otro.
function resolveStaffUnitPrice(
  item: any,
  listUnitPrice: number,
  isCollaboratorEligible: boolean,
): number {
  if (!isCollaboratorEligible) return listUnitPrice;
  const mode = item?.staff_price_mode ?? "none";
  if (mode === "fixed") {
    return Number(item?.staff_fixed_price ?? 0) || 0;
  }
  if (mode === "percent") {
    const pct = Number(item?.staff_discount_percent ?? 0) || 0;
    return Math.max(0, Math.round(listUnitPrice * (1 - pct / 100)));
  }
  return listUnitPrice;
}

// Match tolerante (trim + lowercase) entre payments.service_name (texto
// congelado al momento de la venta) y price_catalog.name (puede haberse
// re-tipeado con otra capitalización/espacios desde entonces) — usado solo
// para el fallback visual de "precio de lista" en Liquidaciones cuando la
// venta no tiene original_amount guardado (ver openDetail).
function normalizeServiceName(name: unknown): string {
  return String(name ?? "").trim().toLowerCase();
}

// Selector de métodos de pago de Nueva venta/Pago múltiple — fijo, a nivel
// de módulo (nunca cambia entre renders, no depende de ningún prop/state,
// no hace falta useMemo). Ya no depende de business_settings.schedule.
// _caja.methods — esa configuración se sacó por completo, junto con la
// sección "Caja" de Configuración (que solo existía para esos switches;
// ver settings.tsx, grupo "Sistema"). Fila 1: Efectivo/Transferencia.
// Fila 2: Débito/Crédito/QR — tres métodos independientes (antes
// "Tarjeta débito/crédito" combinada + Mercado Pago), cada uno con su
// propio PayMethod (register-payment.ts) para poder tener a futuro su
// propia comisión/configuración.
const PAYMENT_OPTIONS = [
  { id: "cash", label: "Efectivo", icon: Banknote },
  { id: "transfer", label: "Transferencia", icon: Smartphone },
  { id: "debit", label: "Débito", icon: CreditCard },
  { id: "credit", label: "Crédito", icon: CreditCard },
  { id: "qr", label: "QR", icon: QrCode },
] as const;

// Botón de método de pago (Paso 4 · Pago simple) — componente propio en
// vez de JSX duplicado, ahora que las dos filas fijas (Efectivo/
// Transferencia, Débito/Crédito/QR) lo renderizan por separado.
function PaymentMethodButton({
  method,
  active,
  onClick,
}: {
  method: (typeof PAYMENT_OPTIONS)[number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-all duration-200 shadow-[0_18px_50px_-34px_rgba(0,0,0,1)]",
        active
          ? "border-blue-300/48 bg-[linear-gradient(135deg,rgba(37,99,235,0.22),rgba(8,11,20,0.94))] text-white ring-1 ring-blue-300/20 shadow-[0_0_26px_rgba(96,165,250,0.13)]"
          : "border-white/[0.065] bg-[linear-gradient(135deg,rgba(8,11,20,0.92),rgba(2,6,23,0.90))] text-muted-foreground hover:border-white/[0.12] hover:bg-white/[0.045] hover:text-foreground",
      )}
    >
      <method.icon className="size-4 shrink-0" />
      <span className="min-w-0 break-words text-xs font-semibold leading-tight">
        {method.label}
      </span>
    </button>
  );
}

type HistorialEvento = {
  time: string;
  user: string;
  action: string;
  // ISO completo — opcional, solo lo escribe el envío a caja de un turno
  // (ver handleCobrar) para poder ordenar Pendientes por fecha/hora real de
  // envío, no solo por "HH:MM" (ambiguo entre días).
  ts?: string;
};

function setHistorialCobroLS(appointmentId: string, events: HistorialEvento[]) {
  if (typeof window === "undefined") return;
  try {
    const all = JSON.parse(
      window.localStorage.getItem(HISTORIAL_KEY) || "{}",
    ) as Record<string, HistorialEvento[]>;
    all[appointmentId] = events;
    window.localStorage.setItem(HISTORIAL_KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent("clippr:cobros-historial-updated"));
  } catch {
    // ignore
  }
}

// Agrega un evento al historial del turno. La fuente de verdad es
// appointments.cobro_events (JSONB en Supabase); localStorage es solo un cache
// para refrescar la UI al instante. Mergea contra lo que ya hay en la DB para
// no pisar eventos escritos desde otro dispositivo o desde el Panel de
// Profesionales (p.ej. "Envió a caja").
async function appendHistorialCobro(appointmentId: string, evento: HistorialEvento) {
  if (typeof window === "undefined" || !appointmentId) return;

  const sameEvent = (a: HistorialEvento, b: HistorialEvento) =>
    a.time === b.time && a.user === b.user && a.action === b.action;

  // 1. Cache local inmediato (la UI no espera a la red).
  try {
    const all = JSON.parse(
      window.localStorage.getItem(HISTORIAL_KEY) || "{}",
    ) as Record<string, HistorialEvento[]>;
    const prev = all[appointmentId] ?? [];
    if (!prev.some((e) => sameEvent(e, evento))) {
      setHistorialCobroLS(appointmentId, [...prev, evento]);
    }
  } catch {
    // ignore
  }

  // 2. Persistir en Supabase, mergeando contra el estado actual de la DB.
  try {
    const { data } = await supabase
      .from("appointments")
      .select("cobro_events")
      .eq("id", appointmentId)
      .maybeSingle();
    const dbEvents = (((data?.cobro_events ?? []) as HistorialEvento[]) || []).filter(Boolean);
    if (!dbEvents.some((e) => sameEvent(e, evento))) {
      const merged = uniqueHistorialEvents([...dbEvents, evento]);
      await supabase
        .from("appointments")
        .update({ cobro_events: merged } as Record<string, unknown>)
        .eq("id", appointmentId);
      setHistorialCobroLS(appointmentId, merged);
    }
  } catch {
    // La columna puede no existir aún; el cache local conserva el evento.
  }
}

// Sincroniza appointments.cobro_events (Supabase) → localStorage para los turnos
// visibles. Así el historial ("Envió a caja" / "Cobró") sobrevive recargas y
// cambios de dispositivo en lugar de depender de un cache local efímero.
async function syncHistorialFromDB(
  appointmentIds: Array<string | null | undefined>,
): Promise<boolean> {
  const ids = Array.from(
    new Set(appointmentIds.map((x) => String(x ?? "").trim()).filter(Boolean)),
  );
  if (!ids.length) return false;
  try {
    const { data } = await supabase
      .from("appointments")
      .select("id, cobro_events")
      .in("id", ids);
    let changed = false;
    for (const row of data ?? []) {
      const events = ((row.cobro_events as HistorialEvento[] | null) ?? []).filter(Boolean);
      if (events.length) {
        setHistorialCobroLS(row.id as string, uniqueHistorialEvents(events));
        changed = true;
      }
    }
    return changed;
  } catch {
    return false;
  }
}

function getHistorialCobro(appointmentId?: string | null): HistorialEvento[] {
  if (typeof window === "undefined" || !appointmentId) return [];
  try {
    const all = JSON.parse(
      window.localStorage.getItem(HISTORIAL_KEY) || "{}",
    ) as Record<string, HistorialEvento[]>;
    return all[appointmentId] ?? [];
  } catch {
    return [];
  }
}

function normalizeHistorialEventKey(event: HistorialEvento) {
  return `${event.time}__${event.user}__${event.action}`;
}

function uniqueHistorialEvents(events: HistorialEvento[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = normalizeHistorialEventKey(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatHistorialTimeLabel(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";

  const normalized = raw.toLowerCase().replace(/\s+/g, " ").replace(/\./g, "");
  const match = normalized.match(
    /^(\d{1,2}):(\d{2})(?:\s*(a\s*m|p\s*m|am|pm))?/,
  );
  if (!match) return raw.endsWith("hs") ? raw : `${raw}hs`;

  let hours = Number(match[1]);
  const minutes = match[2];
  const period = match[3]?.replace(/\s/g, "") ?? "";

  if ((period === "pm" || period === "pm") && hours < 12) hours += 12;
  if ((period === "am" || period === "am") && hours === 12) hours = 0;

  return `${String(hours).padStart(2, "0")}:${minutes}hs`;
}

function getHistorialCobroByIds(ids: Array<unknown>): HistorialEvento[] {
  const normalizedIds = Array.from(
    new Set(
      ids
        .map((id) => (id === null || id === undefined ? "" : String(id).trim()))
        .filter(Boolean),
    ),
  );

  return uniqueHistorialEvents(
    normalizedIds.flatMap((id) => getHistorialCobro(id)),
  );
}

function buildPaidHistorialEvents(
  payment: Record<string, unknown>,
  fallbackCobroEvent: HistorialEvento,
): HistorialEvento[] {
  // Prioridad 1: cobro_events ya resuelto por useCajaData (appointments.
  // cobro_events para turnos, o el marcador [[HIST]] en observations para
  // ventas de mostrador), con el usuario real de cada acción — no depende
  // de ningún cache local por dispositivo. Antes esta función SOLO miraba
  // localStorage (getHistorialCobroByIds), así que si "Envió a caja" se
  // había escrito desde el dispositivo del profesional y este dispositivo
  // de Caja nunca lo cacheó, se perdía esa línea entera y el nombre caía al
  // genérico "Recepción" del fallback.
  const resolved = (payment.cobro_events as HistorialEvento[] | undefined) ?? [];
  if (resolved.length > 0) {
    const alreadyHasCobro = resolved.some((event) => event.action === "Cobró");
    return alreadyHasCobro ? resolved : uniqueHistorialEvents([...resolved, fallbackCobroEvent]);
  }

  // Fallback: reconstrucción desde localStorage — solo para pagos que por
  // algún motivo no trajeron cobro_events resuelto (ej. columna todavía sin
  // datos en un registro muy viejo).
  const savedEvents = getHistorialCobroByIds([
    payment.appointment_id,
    payment.appointmentId,
    payment.appointment,
    payment.pending_charge_id,
    payment.pendingChargeId,
    payment.sale_id,
    payment.saleId,
    payment.id,
  ]);

  if (savedEvents.length === 0) return [fallbackCobroEvent];

  const alreadyHasCobro = savedEvents.some((event) => event.action === "Cobró");

  // Si el servicio fue enviado a Caja y el pago ya existe, el historial debe conservar
  // "Envió a caja" y sumar "Cobró". Nunca se compacta a una sola línea.
  if (!alreadyHasCobro) {
    return uniqueHistorialEvents([...savedEvents, fallbackCobroEvent]);
  }

  return savedEvents;
}

function HistorialCell({ events }: { events: HistorialEvento[] }) {
  if (events.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="space-y-1 leading-tight">
      {events.map((event, index) => (
        <div
          key={`${event.time}-${event.user}-${event.action}-${index}`}
          className="whitespace-nowrap"
        >
          <span className="text-muted-foreground">
            {formatHistorialTimeLabel(event.time)}
          </span>{" "}
          <span className="font-semibold text-foreground/90">{event.user}</span>{" "}
          <span className="text-muted-foreground">→</span>{" "}
          <span
            className={cn(
              event.action === "Cobró" ? "text-emerald-300" : event.action === "Rechazó" ? "text-rose-300" : "text-sky-300",
            )}
          >
            {event.action}
          </span>
        </div>
      ))}
    </div>
  );
}

function removeLocalManualPendingCharge(id: string) {
  if (typeof window === "undefined") return;
  try {
    const rows = JSON.parse(
      window.localStorage.getItem(MANUAL_PENDING_KEY) || "[]",
    ) as Array<{ id: string }>;
    window.localStorage.setItem(
      MANUAL_PENDING_KEY,
      JSON.stringify(rows.filter((item) => item.id !== id)),
    );
    window.dispatchEvent(new CustomEvent("clippr:manual-pending-updated"));
  } catch {
    // ignore
  }
}

function displayCashActor(row: any, fallback = "Usuario") {
  const candidates = [
    row?.charged_by_name,
    row?.charged_by_username,
    row?.charged_by_user,
    row?.cashier_name,
    row?.cashier_username,
    row?.cashier,
    row?.approved_by_name,
    row?.approved_by_username,
    row?.approved_by,
    row?.created_by_name,
    row?.created_by_username,
    row?.created_by_email,
    row?.created_by,
    row?.user_name,
    row?.user_email,
    row?.user,
  ];

  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (!value) continue;

    const normalized = value.toLowerCase();
    if (["caja", "recepción", "recepcion", "admin", "usuario"].includes(normalized)) {
      continue;
    }

    if (value.includes("@")) return value.split("@")[0] || fallback;
    return value;
  }

  return fallback;
}

function displayResponsibleUser(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Caja";

  // Si viene email, mostrar solo antes del @.
  if (raw.includes("@")) return raw.split("@")[0] || "Caja";

  // Nunca un UUID crudo — cash_sessions.opened_by/closed_by (y el
  // "usuario" de un cobros_snapshot viejo, que cae a payment.charged_by)
  // guardan el id de profiles cuando no hay todavía un nombre ya
  // resuelto en ese registro. Mismo criterio que getChargedByLabel.
  if (/^[0-9a-f]{8}-[0-9a-f-]{13,}$/i.test(raw)) return "Caja";

  return raw;
}

// "DD/MM/YYYY" numérico — distinto de fechaLabel (día/mes abreviado/año,
// solo usado dentro de CierresTab), lo necesitan tanto CierresTab como
// CashRegisterPage (para el acceso directo a Cerrar caja en Facturación).
function fechaDDMMYYYY(fecha?: string | null) {
  const raw = String(fecha ?? "").slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "—";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

// Usuario que cobró/pagó: muestra el email antes del "@". Solo cae en
// "Recepción" si realmente no hay email del usuario de sesión.
function chargedByUsername(email?: string | null) {
  const raw = String(email ?? "").trim();
  if (!raw) return "Recepción";
  return raw.includes("@") ? raw.split("@")[0] || "Recepción" : raw;
}

// "HH:MM" en zona horaria de Argentina, sin importar en qué huso horario
// esté configurado el dispositivo — usado para el "time" que se muestra en
// el historial de Pendientes ("11:47hs Alan → Envió a caja"). El ISO
// (new Date().toISOString(), usado para ordenar) ya es correcto sin
// conversión: siempre representa el mismo instante UTC más allá del huso
// del dispositivo, esto es solo para el texto legible.
function formatArgTime(d: Date = new Date()): string {
  return d.toLocaleTimeString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getManualPendingNote(notes?: string | null, serviceName?: string | null) {
  const raw = String(notes ?? "").trim();
  if (!raw) return "";

  // [[HIST]]... es el historial interno de una venta de mostrador
  // (Envió a caja/Cobró/Rechazó, ver PAY_HIST_MARKER) guardado en
  // payments.observations — nunca una nota real del profesional/cliente.
  // Sin este chequeo, ese JSON se colaba acá como si fuera texto de nota,
  // así que "Ver nota" aparecía en TODAS las ventas de mostrador cobradas,
  // aunque nadie hubiera escrito ninguna nota.
  if (raw.startsWith(PAY_HIST_MARKER)) return "";

  // Metadata automática de reservas online (ver publicNotes en
  // reservar/$slug.tsx → create_public_booking_public_v5 → appointments.notes):
  // siempre termina con la línea fija "Origen: reserva online" y SOLO contiene
  // campos generados (Email, Fecha de nacimiento, Servicios seleccionados,
  // Productos agregados, Promoción aplicada) — nunca texto escrito a mano por
  // el cliente o el profesional. Sin este chequeo, "Ver nota" aparecía en
  // cualquier turno reservado online aunque nadie hubiera escrito una nota.
  if (raw.includes("Origen: reserva online")) return "";

  let value = raw
    .replace("[PENDIENTE_CAJA]", "")
    .replace("[MANUAL_PENDING]", "")
    .replace("[ENVIADO_CAJA]", "")
    .replace(STOCK_WITHDRAWAL_NOTE_MARKER, "")
    .trim();

  // Panel Profesional puede guardar: "nota real | Servicio $18.900".
  // En Caja solo debe mostrarse la nota real.
  if (value.includes("|")) {
    value = value.split("|")[0]?.trim() ?? "";
  }

  if (!value) return "";

  const lower = value.toLowerCase();
  const serviceLower = String(serviceName ?? "").trim().toLowerCase();

  // No mostrar textos generados, el nombre del servicio ni "Servicio $precio".
  if (serviceLower && (lower === serviceLower || lower.startsWith(`${serviceLower} $`))) {
    return "";
  }

  const generatedNotes = [
    "servicio realizado",
    "sin nota",
    "sin notas",
    "nota",
    "observación",
    "observacion",
  ];

  if (generatedNotes.includes(lower)) return "";

  return value;
}


function getCashRowNote(row: any, serviceName?: string | null) {
  const candidates = [
    row?.cash_note,
    row?.pending_note,
    row?.professional_note,
    row?.professional_notes,
    row?.appointment_note,
    row?.appointment_notes,
    row?.client_note,
    row?.client_notes,
    row?.customer_note,
    row?.observation,
    row?.observations,
    row?.note,
    row?.notes,
    row?.message,
    row?.comment,
    row?.comments,
  ];

  for (const candidate of candidates) {
    const parsed = getManualPendingNote(candidate, serviceName);
    if (parsed) return parsed;
  }

  return "";
}

function getCashItemImage(item: any) {
  return (
    item?.image_url ??
    item?.photo_url ??
    item?.thumbnail_url ??
    item?.cover_url ??
    item?.service_image_url ??
    item?.product_image_url ??
    item?.image ??
    item?.photo ??
    null
  );
}


// Una URL como .../cash-register?appointmentId=null&clientName=null&...
// (los literales "null"/"undefined" como texto, no el valor JS) llegan acá
// como string truthy — `"null" ?? null` no los limpia porque `??` solo actúa
// sobre null/undefined reales. Sin este filtro, `tab` arranca en "nueva" y se
// arma un pendingCharge de mentira (cliente "null", servicio "null", monto
// NaN) salteando directo al paso 4 de Nueva venta en vez de mostrar Resumen.
//
// Devuelve `undefined`, NUNCA `null`: validateSearch de abajo arma un
// objeto con estos 10 campos siempre presentes, y TanStack Router
// serializa ese objeto de vuelta en la URL — `undefined` se omite de la
// query string, pero `null` se escribe literal como la palabra "null"
// (JSON.stringify(null) === "null"). Antes esto hacía que entrar a
// /cash-register a secas (sin ningún query param) terminara reescribiendo
// la URL con los 10 campos en "null" — con "null" devuelto acá, no había
// forma de distinguir "este campo no vino" de "este campo vino pero está
// vacío", así que el router nunca podía omitirlo.
export const Route = createFileRoute("/cash-register")({
  validateSearch: (search: Record<string, unknown>) => ({
    depositAppointmentId: cleanSearchParam(search.depositAppointmentId),
    depositAmount: cleanSearchParam(search.depositAmount),
    clientName: cleanSearchParam(search.clientName),
    serviceName: cleanSearchParam(search.serviceName),
    employeeId: cleanSearchParam(search.employeeId),
    appointmentId: cleanSearchParam(search.appointmentId),
    finalAmount: cleanSearchParam(search.finalAmount),
    depositPaid: cleanSearchParam(search.depositPaid),
    totalPrice: cleanSearchParam(search.totalPrice),
    chargeStep: cleanSearchParam(search.chargeStep),
    pendingDate: cleanSearchParam(search.pendingDate),
  }),
  head: () => ({
    meta: [
      { title: "Caja — Clippr" },
      { name: "description", content: "Cobros, gastos y liquidaciones." },
    ],
  }),
  component: CashRegisterPage,
});

type Tab =
  | "resumen"
  | "nueva"
  | "nuevo-gasto"
  | "precios"
  | "inventario"
  | "gastos"
  | "profesionales"
  | "cierres";

function CashRegisterPage() {
  const { session, profile, loading: authLoading, permissions } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ from: "/cash-register" });
  const cajaData = useCajaData();

  // Fuente única de Ingresos/Efectivo esperado/Dinero esperado en
  // cuenta/Últimos ingresos — EXACTAMENTE la misma que consume Inicio
  // (vía useCajaHoy, que ahora delega en este mismo hook, ver
  // use-caja-summary.ts). useCajaData sigue existiendo para lo demás
  // (pendientes, profesionales, aprobación de ventas, configuraciones,
  // cierre, realtime operativo), pero deja de ser la fuente de verdad de
  // estos valores — por eso el objeto `data` de acá abajo los sobreescribe.
  const summary = useCajaSummary(cajaData.businessId, cajaData.activeBranchId);

  // `data` = lo que useCajaData calculó, con revHoy/cobros/paymentsToday/
  // expensesToday/refresh reemplazados por los de `summary`. Se llama
  // igual que antes (`data`) y se pasa a los mismos subcomponentes de
  // siempre (ResumenTab, FacturacionPanel, History, CierresTab,
  // ProfesionalesTab) sin tocar sus props — así ningún otro lugar de este
  // archivo que lea `data.paymentsToday`/`data.revHoy`/etc. tiene que
  // cambiar para quedar consistente con Inicio. `refresh` dispara las dos
  // cargas juntas, para no tener que tocar cada uno de los `data.refresh()`
  // ya existentes (envío/cobro/rechazo/cierre/movimiento) uno por uno.
  const data = React.useMemo(() => {
    return {
      ...cajaData,
      revHoy: summary.revHoy,
      cobros: summary.cobros,
      ticket: summary.cobros > 0 ? Math.round(summary.revHoy / summary.cobros) : 0,
      // Gastos del día (hoy, huso Buenos Aires) — distinto del acumulado
      // desde el último cierre que sí necesita CierreCajaBtn (ese usa
      // expensesToday completo, sin filtrar, para el cierre real).
      totalGastos: summary.totalGastosHoy,
      paymentsToday: summary.paymentsToday,
      expensesToday: summary.expensesToday,
      collectionsToday: summary.collectionsToday,
      collectionsForPeriod: summary.collectionsForPeriod,
      refresh: (reason?: string) =>
        Promise.all([cajaData.refresh(reason), summary.refresh(reason)]).then(() => undefined),
    };
  }, [cajaData, summary]);

  // Movimientos manuales (Ingresar/Retirar dinero) — lista + acción de
  // registrar, sin cambios; el CÁLCULO de cashExpected/digitalExpected que
  // antes se armaba acá con esto + data.paymentsToday ahora vive adentro de
  // useCajaSummary (misma fuente/criterio, ver arriba). rangeStartDate sale
  // de `summary` (no de un cajaOpenRangeStartDate(data.pendingCierre)
  // propio) para que la lista de movimientos cubra EXACTAMENTE el mismo
  // período que los números que muestra.
  const cajaRangeStartDate = summary.rangeStartDate;
  const movementsData = useCashMovements(data.businessId, data.activeBranchId, cajaRangeStartDate);

  const expected: ExpectedCashDigital = React.useMemo(
    () => ({
      cashExpected: summary.cashExpected,
      cashOutflows: summary.cashOutflows,
      cashInflows: summary.cashInflows,
      // Mismo nombre/semántica que el `expected.digitalExpected` de
      // siempre: ya incluye el carry-forward de cuenta (ver bankExpected
      // en use-caja-summary.ts) — ningún consumidor existente (
      // FacturacionStatCard, CierreCajaBtn) necesita cambiar.
      digitalExpected: summary.bankExpected,
      digitalOutflows: summary.digitalOutflows,
      // Desglose detallado (Conciliación) — esta `expected` del Resumen
      // viene de useCajaSummary, que no lo expone por separado (solo los
      // totales de arriba). Las cards que sí lo necesitan (Conciliación
      // dentro de "Revisar cierre") usan preview.expected directamente,
      // que siempre viene de computeExpectedCashAndDigital con estos 9
      // campos completos — acá quedan en 0 porque nada los lee.
      cashFromPayments: 0,
      cashExpenses: 0,
      cashAdvancesOut: 0,
      cashRetirosManual: 0,
      digitalFromPayments: 0,
      digitalExpenses: 0,
      digitalAdvancesOut: 0,
      digitalInflows: 0,
      digitalRetirosManual: 0,
    }),
    [summary],
  );

  // "Caja abierta desde" para el acceso directo a Cerrar caja en
  // Facturación (CierresTab ya calcula lo mismo para su propia vista, pero
  // a partir de su propio historial cargado — acá es una sola fila, nada
  // que compartir con esa lista).
  const [cajaAbiertaDesdeInfo, setCajaAbiertaDesdeInfo] = useState<{ fecha: string; hora: string } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    function loadAbiertaDesde() {
      getCajaAbiertaDesde(data.businessId, data.activeBranchId).then((v) => {
        if (!cancelled) setCajaAbiertaDesdeInfo(v);
      });
    }
    loadAbiertaDesde();
    window.addEventListener("clippr:caja-cierre-guardado", loadAbiertaDesde);
    return () => {
      cancelled = true;
      window.removeEventListener("clippr:caja-cierre-guardado", loadAbiertaDesde);
    };
  }, [data.businessId, data.activeBranchId]);
  const cajaAbiertaDesdeLabel = cajaAbiertaDesdeInfo
    ? `${fechaDDMMYYYY(cajaAbiertaDesdeInfo.fecha)} · ${cajaAbiertaDesdeInfo.hora}`
    : "—";
  const cajaAbiertaDesdeFecha = cajaAbiertaDesdeInfo?.fecha ?? cajaRangeStartDate;

  const [tab, setTab] = useState<Tab>(
    search.depositAppointmentId || search.appointmentId
      ? "nueva"
      : search.pendingDate
        ? "cierres"
        : "resumen",
  );
  const [pendingToCharge, setPendingToCharge] = useState<
    ReturnType<typeof useCajaData>["pendingCharges"][number] | null
  >(null);

  const routePendingCharge = React.useMemo<
    ReturnType<typeof useCajaData>["pendingCharges"][number] | null
  >(
    () => resolvePendingChargeFromSearch(search) as ReturnType<typeof useCajaData>["pendingCharges"][number] | null,
    [
      search.appointmentId,
      search.clientName,
      search.serviceName,
      search.finalAmount,
      search.totalPrice,
      search.employeeId,
    ],
  );

  const activePendingCharge = pendingToCharge ?? routePendingCharge;

  // Causa raíz del bug "Nueva venta conserva el cliente anterior": pasar
  // de la pestaña "nueva" a "resumen" (cobro terminado, cancelado, o
  // "Nueva venta" tocado de nuevo) solo cambiaba el estado local `tab` —
  // la URL seguía teniendo ?appointmentId=...&clientName=...&finalAmount=...
  // del turno ya cobrado (routePendingCharge se arma A PARTIR de esos query
  // params, ver arriba). Al volver a abrir "Nueva venta", activePendingCharge
  // volvía a resolver al turno viejo, precargaba su cliente de nuevo y
  // bloqueaba el selector (pendingChargeInitialStep). Limpiar explícitamente
  // los search params en cada punto de salida de "nueva" es la única forma
  // de que una Nueva venta arranque genuinamente en blanco.
  const clearChargeSearchParams = React.useCallback(() => {
    navigate({ to: "/cash-register", search: EMPTY_CASH_REGISTER_SEARCH, replace: true });
  }, [navigate]);

  // "Revisar cierre" del aviso de pendientes en Caja > Resumen — misma
  // mecánica que ya usa el Link de Inicio (?pendingDate=...), para no
  // duplicar el salto a la vista previa: cambia a la pestaña Cierres y deja
  // que CierresTab (initialPendingDate) haga el resto.
  const goToPendingReview = React.useCallback(
    (date: string) => {
      setTab("cierres");
      navigate({ to: "/cash-register", search: { ...EMPTY_CASH_REGISTER_SEARCH, pendingDate: date } });
    },
    [navigate],
  );

  // Instant lock — set to true the moment confirmar() succeeds, no need to wait for refresh
  const [cajaCerrada, setCajaCerrada] = useState(false);
  const [showClosedHistory, setShowClosedHistory] = useState(false);

  React.useEffect(() => {
    if (search.depositAppointmentId && search.depositAmount) {
      toast.info(
        `Cobrar seña de $${parseInt(search.depositAmount).toLocaleString("es-AR")} para ${search.clientName ?? "cliente"}`,
      );
    } else if (
      search.appointmentId &&
      search.depositPaid &&
      parseInt(search.depositPaid) > 0
    ) {
      toast.info(
        `Cobro final: $${parseInt(search.finalAmount ?? "0").toLocaleString("es-AR")} (seña pagada: $${parseInt(search.depositPaid).toLocaleString("es-AR")})`,
      );
    }
  }, []);

  useEffect(() => {
    if (!authLoading && !session) navigate({ to: "/login", replace: true });
  }, [authLoading, session, navigate]);

  useEffect(() => {
    if (!session?.user || !data.businessId) return;

    let cancelled = false;

    (async () => {
      // La caja YA NO se cierra sola — solo se chequea si hoy ya está
      // cerrada (cierre manual seguido de un refresh de página; `cajaCerrada`
      // es estado local en memoria, sin esto se perdía al recargar). Las
      // jornadas pendientes de revisión las muestra CierresTab (banner +
      // historial), con su propio findAllPendingCierres.
      let todayQuery = supabase
        .from("caja_cierres" as any)
        .select("estado")
        .eq("business_id", data.businessId)
        .eq("fecha", cajaDateKey());
      if (data.activeBranchId) todayQuery = todayQuery.eq("branch_id", data.activeBranchId);
      const { data: todayCierre } = await todayQuery.maybeSingle();
      if (!cancelled && isCajaCerradaRow(todayCierre)) setCajaCerrada(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [data.businessId, data.activeBranchId, session?.user?.id]);

  function handleCobrarPendiente(
    appt: ReturnType<typeof useCajaData>["pendingCharges"][number],
  ) {
    setPendingToCharge(appt);
    setTab("nueva");
  }


  if (authLoading || !session) {
    return (
      <AppShell>
        <div className="grid place-items-center py-32">
          <ClipprLoader size="screen" delayMs={130} />
        </div>
      </AppShell>
    );
  }

  // ── GATE: caja cerrada ────────────────────────────────────────────────────
  if (cajaCerrada) {
    return (
      <AppShell>
        <div className="cash-premium-shell">
          {/* Glow ambiental unificado con el resto de la app (Dashboard,
              Agenda, Profesionales, Asesor IA, Clientes, Configuración) —
              antes Caja tenía dos capas propias (una extra con blur(80px))
              más fuertes que en cualquier otra sección. */}
          <div className="pointer-events-none absolute left-1/2 top-[-120px] z-[-1] h-[620px] w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_17%_4%,rgb(139_92_246_/_0.34),transparent_38%),radial-gradient(circle_at_76%_0%,rgb(79_125_255_/_0.30),transparent_36%),radial-gradient(circle_at_46%_96%,rgb(255_123_229_/_0.14),transparent_50%)] blur-[16px]" />
          <div className="mt-4">
            <CierresTab
              businessId={data.businessId}
              cajaCerrada={cajaCerrada}
              paymentsToday={data.paymentsToday}
              expensesToday={data.expensesToday}
              pendingCharges={data.pendingCharges}
              userEmail={session.user.email ?? null}
              expected={expected}
              movementsData={movementsData}
              onCajaCerrada={() => {
                setCajaCerrada(true);
                setShowClosedHistory(false);
                setPendingToCharge(null);
                setTab("resumen");
              }}
              onCajaReopened={() => {
                setCajaCerrada(false);
                setShowClosedHistory(false);
                data.refresh();
              }}
            />
          </div>
        </div>
      </AppShell>
    );
  }

  // ── CAJA ABIERTA ──────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="cash-premium-shell">
        {/* Glow ambiental unificado con el resto de la app (Dashboard,
            Agenda, Profesionales, Asesor IA, Clientes, Configuración) —
            antes Caja tenía dos capas propias (una extra con blur(80px))
            más fuertes que en cualquier otra sección. */}
        <div className="pointer-events-none absolute left-1/2 top-[-120px] z-[-1] h-[620px] w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_17%_4%,rgb(139_92_246_/_0.34),transparent_38%),radial-gradient(circle_at_76%_0%,rgb(79_125_255_/_0.30),transparent_36%),radial-gradient(circle_at_46%_96%,rgb(255_123_229_/_0.14),transparent_50%)] blur-[16px]" />

        <Header data={data} />
        {/* Oculto mientras Nueva venta o Nuevo gasto están activos — el
            formulario sube y aprovecha ese espacio. El resto de las
            secciones (Resumen/Precios/Inventario/Liquidaciones/Cierre de
            caja) siguen existiendo tal cual, solo se ocultan
            momentáneamente; vuelven a aparecer apenas se sale. */}
        {tab !== "nueva" && tab !== "nuevo-gasto" && (
          <Tabs
            tab={tab}
            onChange={(t) => {
              if (t !== "nueva") {
                setPendingToCharge(null);
                clearChargeSearchParams();
              }
              setTab(t);
            }}
            data={data}
            userEmail={session.user.email ?? null}
            onCajaCerrada={() => {
              setCajaCerrada(true);
              setShowClosedHistory(false);
              setPendingToCharge(null);
              clearChargeSearchParams();
              setTab("resumen");
            }}
          />
        )}
        <div className="mt-1 sm:mt-3">
          {tab === "resumen" && (
            <ResumenTab
              data={data}
              equipoEnabled={permissions.equipo}
              onCobrarPendiente={handleCobrarPendiente}
              onNuevaVenta={() => {
                setPendingToCharge(null);
                // "Nueva venta" siempre arranca en blanco — nunca hereda el
                // turno/cliente de una operación anterior, aunque la URL
                // todavía tenga ?appointmentId=... de un cobro ya hecho.
                clearChargeSearchParams();
                setTab("nueva");
              }}
              onNuevoGasto={() => {
                setPendingToCharge(null);
                clearChargeSearchParams();
                setTab("nuevo-gasto");
              }}
              userEmail={session.user.email ?? null}
              expected={expected}
              summary={summary}
              movementsData={movementsData}
              cajaAbiertaDesde={cajaAbiertaDesdeLabel}
              cajaRangeStartDate={cajaAbiertaDesdeFecha}
              onCajaCerrada={() => {
                setCajaCerrada(true);
                setShowClosedHistory(false);
                setPendingToCharge(null);
                clearChargeSearchParams();
                setTab("resumen");
              }}
              onRevisarCierre={goToPendingReview}
            />
          )}
          {tab === "nuevo-gasto" && (
            <NuevoGastoTab
              data={data}
              userEmail={session.user.email ?? null}
              onCancel={() => {
                clearChargeSearchParams();
                setTab("resumen");
              }}
              onSaved={() => {
                data.refresh();
                clearChargeSearchParams();
                setTab("resumen");
              }}
            />
          )}
          {tab === "nueva" && (
            <NuevaVentaTab
              data={data}
              pendingCharge={activePendingCharge}
              // "Cobrar turno" desde Agenda manda chargeStep=3 por URL para
              // entrar al Paso Servicios con el turno precargado, en vez de
              // ir directo a Pago — mismo prop que ya usa professionals.tsx
              // al llamar a este mismo componente.
              pendingChargeInitialStep={search.chargeStep === "3" ? 3 : undefined}
              userEmail={session.user.email ?? null}
              chargedByName={profile?.full_name || chargedByUsername(session.user.email)}
              onCancel={() => {
                setPendingToCharge(null);
                // Cancelar una venta ligada a un turno (venida de Agenda por
                // URL) no puede dejar ese turno "pegado" para la próxima
                // Nueva venta — limpia los search params igual que un cobro
                // exitoso.
                clearChargeSearchParams();
                setTab("resumen");
              }}
              onPendingDone={() => {
                setPendingToCharge(null);
                clearChargeSearchParams();
                setTab("resumen");
              }}
              onSaleDone={() => {
                setPendingToCharge(null);
                clearChargeSearchParams();
                setTab("resumen");
              }}
            />
          )}
          {tab === "precios" && (
            <PreciosTab businessId={data.businessId} data={data} />
          )}
          {tab === "inventario" && (
            <InventarioTab
              businessId={data.businessId}
              userEmail={session.user.email ?? null}
              chargedByName={profile?.full_name || chargedByUsername(session.user.email)}
              data={data}
            />
          )}
          {tab === "gastos" && <GastosTab businessId={data.businessId} />}
          {tab === "profesionales" && (
            <ProfesionalesTab
              businessId={data.businessId}
              chargedByName={profile?.full_name || chargedByUsername(session.user.email)}
              data={data}
            />
          )}
          {tab === "cierres" && (
            <CierresTab
              businessId={data.businessId}
              cajaCerrada={cajaCerrada}
              paymentsToday={data.paymentsToday}
              expensesToday={data.expensesToday}
              pendingCharges={data.pendingCharges}
              userEmail={session.user.email ?? null}
              expected={expected}
              movementsData={movementsData}
              initialPendingDate={search.pendingDate}
              onPendingDateConsumed={clearChargeSearchParams}
              onCajaCerrada={() => {
                setCajaCerrada(true);
                setShowClosedHistory(false);
                setPendingToCharge(null);
                setTab("resumen");
              }}
              onCajaReopened={() => {
                setCajaCerrada(false);
                data.refresh();
              }}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Header({
  data: _data,
}: {
  data: ReturnType<typeof useCajaData>;
}) {
  // El acceso rápido "Nueva venta"/"Nuevo gasto" ya no vive acá — ahora es
  // un solo botón centrado dentro de ResumenTab, arriba de la tarjeta
  // Ingresos, igual en mobile y desktop (ver ResumenTab). Acá solo queda
  // el título, que además ya está oculto en mobile (el banner de sección
  // debajo del header ya dice "Caja" — ver MobileSectionBanner).
  return (
    <div className="hidden lg:block">
      <h1 className="font-display text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
        Caja
      </h1>
      <p className="mt-2 text-sm text-muted-foreground md:text-base">
        Cobros, gastos y liquidaciones
      </p>
    </div>
  );
}

const TABS: {
  id: Tab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "resumen", label: "Resumen", icon: BarChart3 },
  { id: "precios", label: "Precios", icon: CreditCard },
  { id: "inventario", label: "Inventario", icon: ClipboardList },
  { id: "profesionales", label: "Liquidaciones", icon: Wallet },
  { id: "cierres", label: "Cierre de caja", icon: CalendarDays },
];

// Botón de pestaña usado solo en la fila mobile de 2 filas (ver Tabs). `compact`
// apila ícono + texto para que las 4 pestañas de la fila 2 entren sin scroll
// horizontal en un iPhone/Android chico.
function TabButton({
  t,
  tab,
  onChange,
  compact = false,
  className,
}: {
  t: (typeof TABS)[number];
  tab: Tab;
  onChange: (t: Tab) => void;
  compact?: boolean;
  className?: string;
}) {
  const active = t.id === tab;
  const Icon = t.icon;
  return (
    <button
      onClick={() => onChange(t.id)}
      className={cn(
        "group relative inline-flex items-center justify-center rounded-2xl font-semibold transition-all duration-200",
        compact
          ? "flex-col gap-1 px-1 py-2 text-center text-[10px] leading-tight"
          : "gap-2 px-4 py-2.5 text-sm whitespace-nowrap",
        active
          ? "bg-[linear-gradient(135deg,rgba(59,130,246,0.22),rgba(139,92,246,0.22))] text-white ring-1 ring-violet-200/28 shadow-[0_0_26px_rgba(99,102,241,0.18),0_1px_0_rgba(255,255,255,0.10)_inset]"
          : "text-white/55 hover:bg-white/[0.045] hover:text-white/85",
        className,
      )}
    >
      <Icon
        className={cn(
          compact ? "size-3.5" : "size-4",
          "transition-all",
          active ? "text-blue-200" : "text-white/40 group-hover:text-white/70",
        )}
      />
      <span className={compact ? "line-clamp-2" : undefined}>{t.label}</span>
    </button>
  );
}

function Tabs({
  tab,
  onChange,
  data,
  userEmail: _userEmail,
  onCajaCerrada: _onCajaCerrada,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  data: ReturnType<typeof useCajaData>;
  userEmail: string | null;
  onCajaCerrada: () => void;
}) {
  const [firstTab, ...restTabs] = TABS;
  return (
    <div className="mt-2 flex flex-wrap items-end justify-between gap-5 border-b border-white/[0.055] pb-1.5 sm:mt-3 sm:pb-2">
      {/* Mobile: sin scroll horizontal — Resumen ocupa toda la fila 1, el
          resto se reparte en una fila 2 de 4 columnas parejas. */}
      <div className="relative flex w-full flex-col gap-1.5 rounded-3xl border border-white/[0.085] bg-[linear-gradient(135deg,rgba(8,10,20,0.96),rgba(12,16,32,0.88))] p-1.5 backdrop-blur-2xl shadow-[0_18px_55px_-28px_rgba(0,0,0,0.95),0_1px_0_rgba(255,255,255,0.06)_inset] sm:hidden">
        <div className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(circle_at_8%_0%,rgba(59,130,246,0.12),transparent_35%),radial-gradient(circle_at_92%_0%,rgba(139,92,246,0.13),transparent_35%)]" />
        <TabButton t={firstTab} tab={tab} onChange={onChange} className="w-full" />
        <div className="grid grid-cols-4 gap-1">
          {restTabs.map((t) => (
            <TabButton key={t.id} t={t} tab={tab} onChange={onChange} compact />
          ))}
        </div>
      </div>

      {/* Desktop/tablet: fila única, sin cambios visuales. */}
      <div className="relative hidden sm:flex gap-1.5 overflow-x-auto rounded-3xl border border-white/[0.085] bg-[linear-gradient(135deg,rgba(8,10,20,0.96),rgba(12,16,32,0.88))] p-1.5 backdrop-blur-2xl shadow-[0_18px_55px_-28px_rgba(0,0,0,0.95),0_1px_0_rgba(255,255,255,0.06)_inset] sm:flex-none">
        <div className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(circle_at_8%_0%,rgba(59,130,246,0.12),transparent_35%),radial-gradient(circle_at_92%_0%,rgba(139,92,246,0.13),transparent_35%)]" />
        {TABS.map((t) => {
          const active = t.id === tab;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={cn(
                "group relative inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-all duration-200",
                active
                  ? "bg-[linear-gradient(135deg,rgba(59,130,246,0.22),rgba(139,92,246,0.22))] text-white ring-1 ring-violet-200/28 shadow-[0_0_26px_rgba(99,102,241,0.18),0_1px_0_rgba(255,255,255,0.10)_inset]"
                  : "text-white/55 hover:bg-white/[0.045] hover:text-white/85",
              )}
            >
              <Icon
                className={cn(
                  "size-4 transition-all",
                  active
                    ? "text-blue-200"
                    : "text-white/40 group-hover:text-white/70",
                )}
              />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      {...props}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/[0.075] bg-[linear-gradient(135deg,rgba(5,8,15,0.96),rgba(8,11,20,0.94),rgba(2,4,12,0.98))] cash-card-glow",
        "shadow-[0_1px_0_oklch(1_0_0/0.04)_inset,0_20px_50px_-20px_oklch(0_0_0/0.6)]",
        "backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Money({ value, large = false }: { value: number; large?: boolean }) {
  const integer = useMemo(
    () => Math.round(value).toLocaleString("es-AR"),
    [value],
  );
  return (
    <span
      className={cn(
        "font-display tabular-nums tracking-tight text-foreground",
        large ? "text-lg sm:text-4xl font-semibold" : "text-2xl font-semibold",
      )}
    >
      <span className="text-muted-foreground/70 mr-0.5">$</span>
      {integer}
    </span>
  );
}

// Definido a nivel de módulo (no adentro de PreciosTab/InventarioTab): un
// componente declarado DENTRO de otro componente se vuelve a crear con una
// identidad nueva en cada render de ese padre. React lo trata entonces
// como un tipo distinto, desmonta el <input> viejo y monta uno nuevo — el
// input pierde el foco (y el teclado se cierra en iPhone) después de cada
// letra, porque escribir dispara el setState que causa ese re-render.
// Con el componente fijo en el módulo, su identidad no cambia nunca y el
// mismo <input> del DOM se reutiliza entre renders.
const SearchBox = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) => (
  <div className="relative w-full">
    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/38" />
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-10 w-full rounded-2xl border border-white/[0.08] bg-[#060812]/72 pl-10 pr-4 text-base text-white outline-none backdrop-blur-xl placeholder:text-white/35 focus:border-violet-300/35 focus:ring-2 focus:ring-violet-400/12"
    />
  </div>
);

// ───────────────────────────── RESUMEN
function ResumenTab({
  data,
  equipoEnabled,
  onCobrarPendiente,
  onNuevaVenta,
  onNuevoGasto,
  userEmail,
  expected,
  summary,
  movementsData,
  cajaAbiertaDesde,
  cajaRangeStartDate,
  onCajaCerrada,
  onRevisarCierre,
}: {
  data: ReturnType<typeof useCajaData>;
  equipoEnabled: boolean;
  onCobrarPendiente: (
    appt: ReturnType<typeof useCajaData>["pendingCharges"][number],
  ) => void;
  onNuevaVenta: () => void;
  onNuevoGasto: () => void;
  userEmail: string | null;
  expected: ExpectedCashDigital;
  summary: CajaSummary;
  movementsData: ReturnType<typeof useCashMovements>;
  cajaAbiertaDesde: string;
  cajaRangeStartDate: string;
  onCajaCerrada: () => void;
  onRevisarCierre: (date: string) => void;
}) {
  // Historial de cobros: lo leemos desde appointments.cobro_events (Supabase)
  // para los turnos visibles, así "Envió a caja" / "Cobró" persiste tras
  // recargar o entrar desde otro dispositivo. `histVersion` fuerza el re-render
  // cuando el cache local se actualiza con lo que vino de la base.
  const [, setHistVersion] = React.useState(0);
  React.useEffect(() => {
    const ids = (data.paymentsToday ?? [])
      .map((p) => (p as { appointment_id?: string | null }).appointment_id)
      .filter(Boolean) as string[];
    const pendingIds = (data.pendingCharges ?? []).map((p) => p.id).filter(Boolean);
    const allIds = [...ids, ...pendingIds];
    if (!allIds.length) return;
    let active = true;
    syncHistorialFromDB(allIds).then((changed) => {
      if (active && changed) setHistVersion((v) => v + 1);
    });
    return () => {
      active = false;
    };
  }, [data.paymentsToday, data.pendingCharges]);

  React.useEffect(() => {
    const bump = () => setHistVersion((v) => v + 1);
    window.addEventListener("clippr:cobros-historial-updated", bump);
    return () => window.removeEventListener("clippr:cobros-historial-updated", bump);
  }, []);

  // Antes este evento también cambiaba la vista a la pestaña "Gastos" para
  // mostrar el gasto recién guardado — esa pestaña ya no existe (vista
  // unificada: Gastos ya se ve en la stat card y en Movimientos de caja sin
  // cambiar de pantalla), así que solo queda refrescar los datos.
  React.useEffect(() => {
    const handler = () => data.refresh();
    window.addEventListener("clippr:gasto-guardado", handler);
    return () => window.removeEventListener("clippr:gasto-guardado", handler);
  }, [data]);

  const showPendientes = data.approvalModeEnabled && equipoEnabled;

  // Tema ámbar para "Cobros pendientes" (bloque expandible dentro de
  // FacturacionPanel, se abre al tocar la stat card Pendientes) — Ingresos y
  // Gastos ya no necesitan un theme de panel propio: el selector grande que
  // los usaba para pintar toda una vista desapareció, ahora cada uno es una
  // stat card (FacturacionStatCard) o filas coloreadas en
  // MovimientosUnificados.
  const pendientesTheme = {
    border: "border-amber-400/24",
    glow: "shadow-[0_30px_90px_-48px_rgba(245,158,11,0.32),0_22px_70px_-42px_rgba(0,0,0,0.95)]",
    panelBg:
      "bg-[radial-gradient(circle_at_14%_50%,rgba(245,158,11,0.18),transparent_34%),linear-gradient(135deg,rgba(120,53,15,0.22),rgba(3,7,18,0.94))]",
    headerIcon: "bg-amber-500/14 text-amber-300 ring-amber-400/25",
    title: "text-amber-50",
    chip: "bg-amber-400/10 text-amber-300 ring-amber-400/18",
    tableHead: "border-amber-400/10 bg-black/[0.10]",
    rowHover: "hover:bg-amber-400/[0.035]",
    amount: "text-amber-300",
    badge: "bg-amber-500/12 text-amber-300 ring-amber-400/20",
  };

  return (
    <>
      {/* Nueva venta / Nuevo gasto — antes era un solo botón que cambiaba de
          acción según la pestaña Facturación/Gastos activa; sin esa
          pestaña (vista unificada), los dos accesos quedan siempre visibles
          lado a lado. */}
      <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onNuevaVenta}
          className="group inline-flex items-center justify-center gap-3 rounded-2xl border border-emerald-300/36 bg-[linear-gradient(135deg,rgba(16,185,129,0.26),rgba(6,95,70,0.56))] px-9 py-3.5 text-base font-bold text-emerald-50 shadow-[0_0_40px_rgba(16,185,129,0.36),0_0_85px_rgba(16,185,129,0.14),0_1px_0_rgba(255,255,255,0.16)_inset] transition-all duration-200 hover:-translate-y-0.5 hover:bg-emerald-400/24 hover:text-white hover:shadow-[0_0_58px_rgba(16,185,129,0.50),0_0_100px_rgba(16,185,129,0.20)]"
        >
          <Plus className="size-5 transition-transform group-hover:rotate-90" />
          Nueva venta
        </button>
        <button
          type="button"
          onClick={onNuevoGasto}
          className="group inline-flex items-center justify-center gap-2.5 rounded-2xl border border-rose-300/38 bg-[linear-gradient(135deg,rgba(244,63,94,0.28),rgba(127,29,29,0.58))] px-6 py-3 text-sm font-extrabold text-rose-50 shadow-[0_0_34px_rgba(244,63,94,0.34),0_0_70px_rgba(244,63,94,0.12),0_1px_0_rgba(255,255,255,0.18)_inset] transition-all duration-200 hover:-translate-y-0.5 hover:bg-rose-500/22 hover:text-white hover:shadow-[0_0_52px_rgba(244,63,94,0.46),0_0_90px_rgba(244,63,94,0.18)]"
        >
          <Wallet className="size-4 transition-transform group-hover:scale-110" />
          Nuevo gasto
        </button>
      </div>

      <div className="relative space-y-6 pt-0 pb-2 sm:py-2">
        <div className="pointer-events-none absolute inset-x-0 sm:inset-x-[-56px] top-[-54px] bottom-[-72px] z-0 rounded-[56px] bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.68)_0%,rgba(0,0,0,0.46)_34%,rgba(0,0,0,0.22)_58%,transparent_82%)] blur-3xl" />
        <div className="pointer-events-none absolute inset-x-0 sm:inset-x-[-30px] top-[-28px] bottom-[-40px] z-0 rounded-[46px] bg-[linear-gradient(180deg,transparent_0%,rgba(0,0,0,0.18)_14%,rgba(0,0,0,0.38)_46%,rgba(0,0,0,0.28)_72%,transparent_100%)]" />

        {/* Vista única (ya no hay selector Facturación/Gastos): resumen +
            acciones de caja (FacturacionPanel) y debajo el historial
            unificado de movimientos. */}
        <div className="relative z-10 space-y-4">
          <FacturacionPanel
            data={data}
            equipoEnabled={equipoEnabled}
            summary={summary}
            movementsData={movementsData}
            userEmail={userEmail}
            cajaAbiertaDesde={cajaAbiertaDesde}
            cajaRangeStartDate={cajaRangeStartDate}
            onCajaCerrada={onCajaCerrada}
            onCobrarPendiente={onCobrarPendiente}
            onRevisarCierre={onRevisarCierre}
            pendientesTheme={pendientesTheme}
          />
          <MovimientosUnificados
            data={data}
            movementsData={movementsData}
            showPendientes={showPendientes}
          />
        </div>
      </div>
    </>
  );
}

function PreciosTab({
  businessId: _businessId,
  data,
}: {
  businessId: string | null;
  data: ReturnType<typeof useCajaData>;
}) {
  // Reutiliza el `data` que ya cargó CashRegisterPage (mismo fix que
  // ProfesionalesTab/CierresTab) — antes esta pestaña llamaba su propia
  // useCajaData(), que vuelve a pedir todo cada vez que se monta y por un
  // instante muestra "Sin servicios/Sin artículos" antes de que llegue la
  // respuesta real: el flash oscuro reportado.
  const [serviceQuery, setServiceQuery] = React.useState("");
  const [catalogQuery, setCatalogQuery] = React.useState("");
  const [serviceFilter, setServiceFilter] = React.useState("Todos");
  const [catalogFilter, setCatalogFilter] = React.useState("Todos");
  // Mobile: pestañas Servicios/Catálogo para mostrar una sección a la vez
  // (en desktop las dos siguen viéndose lado a lado, sin cambios ahí).
  const [mobileSection, setMobileSection] = React.useState<"servicios" | "catalogo">("servicios");

  const items = React.useMemo(() => data.services ?? [], [data.services]);
  const serviceItems = React.useMemo(
    () => items.filter((item: any) => !item.is_catalog),
    [items],
  );
  const catalogItems = React.useMemo(
    () => items.filter((item: any) => item.is_catalog),
    [items],
  );

  const serviceCategory = (item: any) =>
    String(item.category || item.type || "Servicios").trim() || "Servicios";

  const serviceCategories = React.useMemo(() => {
    const preferred = ["Cortes", "Color", "Barba", "Tratamientos", "Peinados"];
    const fromData = Array.from(
      new Set(
        serviceItems
          .map((item: any) => serviceCategory(item))
          .filter(Boolean),
      ),
    );
    const ordered = [
      ...preferred.filter((cat) => fromData.includes(cat)),
      ...fromData.filter((cat) => !preferred.includes(cat)),
    ];
    return ["Todos", ...ordered];
  }, [serviceItems]);


  const catalogCategories = React.useMemo(() => {
    const preferred = ["Productos", "Bebidas", "Indumentaria"];
    const fromData = Array.from(
      new Set(
        catalogItems
          .map((item: any) => String(item.category || "Productos").trim())
          .filter(Boolean),
      ),
    );
    const ordered = [
      ...preferred.filter((cat) => fromData.includes(cat)),
      ...fromData.filter((cat) => !preferred.includes(cat)),
    ];
    return ["Todos", ...ordered];
  }, [catalogItems]);

  React.useEffect(() => {
    if (!serviceCategories.includes(serviceFilter)) setServiceFilter("Todos");
  }, [serviceCategories, serviceFilter]);

  React.useEffect(() => {
    if (!catalogCategories.includes(catalogFilter)) setCatalogFilter("Todos");
  }, [catalogCategories, catalogFilter]);

  const normalizedServiceQuery = serviceQuery.trim().toLowerCase();
  const normalizedCatalogQuery = catalogQuery.trim().toLowerCase();

  const filteredServices = serviceItems.filter((item: any) => {
    const matchesCategory =
      serviceFilter === "Todos" || serviceCategory(item) === serviceFilter;
    const matchesText =
      !normalizedServiceQuery ||
      `${item.name ?? ""} ${item.category ?? ""} ${item.type ?? ""}`
        .toLowerCase()
        .includes(normalizedServiceQuery);
    return matchesCategory && matchesText;
  });

  const filteredCatalog = catalogItems.filter((item: any) => {
    const matchesCategory =
      catalogFilter === "Todos" ||
      String(item.category || "Productos") === catalogFilter;
    const matchesText =
      !normalizedCatalogQuery ||
      `${item.name ?? ""} ${item.category ?? ""}`
        .toLowerCase()
        .includes(normalizedCatalogQuery);
    return matchesCategory && matchesText;
  });

  const money = (value: unknown) =>
    `$${Number(value ?? 0).toLocaleString("es-AR")}`;
  const effectivePrice = (item: any) =>
    Number(
      item.cash_price ??
        item.price_cash ??
        item.efectivo_price ??
        item.effective_price ??
        item.cashPrice ??
        item.price ??
        0,
    );
  const itemImage = (item: any) =>
    item.image_url ??
    item.photo_url ??
    item.thumbnail_url ??
    item.cover_url ??
    item.image ??
    item.photo ??
    null;
  const duration = (item: any) =>
    Number(
      item.duration ??
        item.duration_min ??
        item.duration_minutes ??
        item.minutes ??
        0,
    );
  const catalogCategory = (item: any) => String(item.category || "Productos");

  const PriceBadge = ({
    label,
    value,
    tone = "violet",
    compact = false,
  }: {
    label: string;
    value: number;
    tone?: "violet" | "green";
    compact?: boolean;
  }) => (
    <div
      className={cn(
        "rounded-xl border text-left shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]",
        compact ? "min-w-[62px] px-2 py-1.5" : "min-w-[90px] px-3 py-2",
        tone === "green"
          ? "border-emerald-400/22 bg-emerald-400/[0.045]"
          : "border-violet-300/18 bg-violet-400/[0.055]",
      )}
    >
      <div
        className={cn(
          "font-bold uppercase tracking-[0.14em]",
          compact ? "text-[8px]" : "text-[9px]",
          tone === "green" ? "text-emerald-300" : "text-violet-200",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 font-bold tabular-nums text-white",
          compact ? "text-xs" : "text-sm",
        )}
      >
        {money(value)}
      </div>
    </div>
  );

  const Thumb = ({ item, fallback }: { item: any; fallback: string }) => (
    <ServiceImage
      src={itemImage(item)}
      alt={item.name ?? ""}
      className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-violet-300/12 bg-violet-500/10 text-lg text-violet-200 shadow-[0_0_20px_rgba(139,92,246,0.12)]"
      imgClassName="h-full w-full object-cover object-center"
      fallback={<span>{fallback}</span>}
    />
  );

  // Placeholder mientras `data.loading` es true — mismo fondo/tamaño de fila
  // que el contenido real, para no mostrar "Sin servicios/artículos" por un
  // instante en la primera carga real de Caja. Versión desktop: sin tarjeta
  // propia, se usa dentro de la caja continua de siempre (ver más abajo).
  const RowSkeleton = () => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-white/[0.055] px-3 py-2.5 last:border-0"
        >
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-white/[0.06]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-1/2 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-white/[0.045]" />
          </div>
          <div className="hidden h-9 w-[90px] shrink-0 animate-pulse rounded-xl bg-white/[0.045] sm:block" />
          <div className="hidden h-9 w-[90px] shrink-0 animate-pulse rounded-xl bg-white/[0.045] sm:block" />
        </div>
      ))}
    </>
  );

  // Versión mobile del skeleton: reproduce las MISMAS 2 filas que
  // ServiceRowMobile/CatalogRowMobile (thumb+nombre, y las 2 PriceBadge de
  // precio) — antes le faltaba la fila de precios, que aparecía recién con
  // los datos reales (tarjetas violeta/verde con precio) sin placeholder.
  const RowSkeletonMobile = () => (
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-3"
        >
          <div className="flex min-w-0 items-center gap-4">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-white/[0.06]" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3.5 w-1/2 animate-pulse rounded bg-white/[0.06]" />
              <div className="h-2.5 w-1/3 animate-pulse rounded bg-white/[0.045]" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="h-11 flex-1 animate-pulse rounded-xl bg-white/[0.045]" />
            <div className="h-11 flex-1 animate-pulse rounded-xl bg-white/[0.045]" />
          </div>
        </div>
      ))}
    </div>
  );

  // Fila de escritorio: estilo original, línea divisoria dentro de una caja
  // continua (sin cambios respecto de la versión web de siempre).
  const ServiceRow = ({ item }: { item: any }) => (
    <div className="group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-white/[0.055] px-3 py-2 transition-all duration-200 last:border-0 hover:bg-white/[0.026]">
      <div className="flex min-w-0 items-center gap-4">
        <Thumb item={item} fallback="✂" />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-white">
            {item.name ?? "Servicio"}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/55">
            <Clock className="size-3.5" />
            {duration(item) > 0 ? `${duration(item)} min` : "Sin duración"}
          </div>
        </div>
      </div>
      <PriceBadge label="Lista" value={Number(item.price ?? 0)} />
      <PriceBadge label="Efectivo" value={effectivePrice(item)} tone="green" />
    </div>
  );

  const CatalogRow = ({ item }: { item: any }) => (
    <div className="group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-white/[0.055] px-3 py-2 transition-all duration-200 last:border-0 hover:bg-white/[0.026]">
      <div className="flex min-w-0 items-center gap-4">
        <Thumb item={item} fallback="□" />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-white">
            {item.name ?? "Producto"}
          </div>
          <div className="mt-0.5 text-[11px] text-white/50">
            {catalogCategory(item)}
          </div>
        </div>
      </div>
      <PriceBadge label="Lista" value={Number(item.price ?? 0)} />
      <PriceBadge label="Efectivo" value={effectivePrice(item)} tone="green" />
    </div>
  );

  // Mobile: cada ítem es su propia tarjeta (borde + fondo sutil propio),
  // separada de las demás por aire real (gap), en vez de una sola caja
  // continua con líneas divisorias — SOLO mobile, la versión de escritorio
  // (ServiceRow/CatalogRow de arriba) no cambia.
  const ServiceRowMobile = ({ item }: { item: any }) => (
    <div className="flex items-center gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 active:bg-white/[0.045]">
      <Thumb item={item} fallback="✂" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-white">
          {item.name ?? "Servicio"}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/55">
          <Clock className="size-3.5" />
          {duration(item) > 0 ? `${duration(item)} min` : "Sin duración"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <PriceBadge label="Lista" value={Number(item.price ?? 0)} compact />
        <PriceBadge label="Efectivo" value={effectivePrice(item)} tone="green" compact />
      </div>
    </div>
  );

  const CatalogRowMobile = ({ item }: { item: any }) => (
    <div className="flex items-center gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 active:bg-white/[0.045]">
      <Thumb item={item} fallback="□" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-white">
          {item.name ?? "Producto"}
        </div>
        <div className="mt-0.5 text-[11px] text-white/50">
          {catalogCategory(item)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <PriceBadge label="Lista" value={Number(item.price ?? 0)} compact />
        <PriceBadge label="Efectivo" value={effectivePrice(item)} tone="green" compact />
      </div>
    </div>
  );

  return (
    <div className="mt-3 h-auto overflow-visible pb-6 sm:-mt-5 sm:h-[calc(100vh-270px)] sm:min-h-[470px] sm:overflow-hidden">
      {/* Mobile: pestañas para ver una sección a la vez. Desktop no cambia:
          las dos secciones siguen lado a lado (ver sm:grid abajo).
          El -mt-5 (desktop) tira el contenido hacia arriba para ajustar el
          budget de altura fijo (calc(100vh-270px)) — pero en mobile
          (h-auto, sin ese budget) esa misma resta hacía que estos botones
          quedaran tapados por la barra de tabs de arriba, sobre todo
          después de sacar los títulos con ícono de cada sección. En mobile
          usa un margen positivo (mt-3, ~16px sumado al mt-1 del wrapper)
          en vez de negativo, para separación real sin solapamiento. */}
      <div className="mb-3 flex gap-2 sm:hidden">
        {(
          [
            ["servicios", "Servicios", <Scissors key="i" className="size-4" />],
            ["catalogo", "Catálogo", <span key="i" className="text-sm leading-none">▣</span>],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMobileSection(id)}
            className={cn(
              "flex h-14 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border transition-all",
              mobileSection === id
                ? "border-violet-300/28 bg-violet-500/18 text-white ring-1 ring-violet-300/24"
                : "border-white/[0.085] bg-black/25 text-white/50 active:bg-white/[0.045]",
            )}
          >
            {icon}
            <span className="text-[9px] font-bold uppercase tracking-wide">
              {label}
            </span>
          </button>
        ))}
      </div>
      <div className="grid h-auto min-h-0 grid-cols-1 gap-5 sm:h-full xl:grid-cols-2">
        <section
          className={cn(
            // El intento anterior (degradado con background-size fijo de
            // 320px) seguía viviendo en el MISMO elemento que crece con el
            // contenido, así que el punto de recorte del degradado también
            // se recalculaba. Ahora el degradado vive en una capa aparte,
            // absolutamente posicionada con un alto fijo (100dvh) que NUNCA
            // depende de cuánto mida la sección — la sección solo recorta
            // (overflow-hidden + rounded) la parte de esa capa que le
            // corresponde según su alto real, pero el degradado en sí
            // siempre mapea sus colores a la MISMA franja de 100dvh sin
            // importar si la sección mide 400px o 2000px. Por eso la zona
            // de categorías (a una distancia fija del techo) cae siempre en
            // el mismo punto de esa franja fija. Desktop no cambia: sigue
            // usando su propio degradado estirado al 100% de su alto fijo.
            "relative min-h-0 flex-col overflow-hidden rounded-3xl border border-white/[0.085] shadow-[0_24px_85px_-50px_rgba(139,92,246,0.42)] sm:flex sm:bg-[linear-gradient(180deg,rgba(12,16,30,0.95),rgba(5,7,16,0.98))]",
            mobileSection === "servicios" ? "flex" : "hidden",
          )}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[100dvh] bg-[linear-gradient(180deg,rgba(12,16,30,0.95),rgba(5,7,16,0.98))] sm:hidden" />
          <div className="flex shrink-0 flex-col gap-3 border-b border-white/[0.065] px-5 py-3">
            {/* self-start + max-w-full: antes este contenedor se estiraba
                al 100% del ancho (comportamiento por defecto de un hijo
                dentro de un flex-column) sin importar cuántas categorías
                hubiera. Con pocas categorías, eso dejaba un área grande de
                fondo negro "vacío" a la derecha de los chips — con muchas,
                los chips ocupaban todo el ancho y no quedaba fondo visible.
                Mismo bg-black/25 y mismo border siempre: lo que cambiaba
                era cuánto quedaba expuesto. Ahora el contenedor se ajusta
                al contenido (como un chip real), y solo usa scroll interno
                si no entran todas — igual en cualquier cantidad. */}
            {/* Bug conocido de WebKit: cuando `overflow-x-auto` y el fondo
                translúcido viven en el MISMO elemento, WebKit promueve ese
                elemento a una capa de composición de scroll solo cuando el
                contenido realmente necesita scrollear — y esa capa se pinta
                distinto (compositing en buffer aparte) que el elemento
                pintado directo. Como acá el contenido entra o no según la
                cantidad de categorías, la capa se crea o no según la
                cantidad de categorías: de ahí el cambio de intensidad.
                Confirmado por el usuario: pasa en Safari Y Chrome de iOS
                (mismo motor WebKit), nunca en Chrome Android (Blink) — es
                el motor, no el navegador ni el touch.
                Fix: separar el fondo/borde (elemento de afuera, SIN
                overflow, nunca se promueve a capa de scroll) del mecanismo
                de scroll (elemento de adentro, sin fondo propio — no hay
                color que se pinte distinto sin importar qué capa use
                WebKit para él). Mismo resultado visual y funcional. */}
            <div className="isolate inline-flex max-w-full self-start rounded-2xl border border-white/[0.07] bg-[rgba(0,0,0,0.25)] p-1.5">
              <div className="flex min-w-0 gap-2 overflow-x-auto">
                {/* Mientras `data.loading` es true, `serviceCategories`
                    todavía no tiene los datos reales y colapsa a solo
                    ["Todos"] (ver el useMemo de arriba). Un skeleton con el
                    mismo ancho aproximado del estado final evita el salto
                    de tamaño al llegar los datos. */}
                {data.loading ? (
                  [0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-9 w-16 shrink-0 animate-pulse rounded-xl bg-white/[0.06]"
                    />
                  ))
                ) : (
                  serviceCategories.map((cat) => {
                    const active = serviceFilter === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setServiceFilter(cat)}
                        className={cn(
                          "rounded-xl px-3.5 py-2 text-xs font-bold transition-all whitespace-nowrap",
                          active
                            ? "bg-violet-500/18 text-white ring-1 ring-violet-300/24"
                            : "text-white/50 [@media(hover:hover)]:hover:bg-white/[0.045] [@media(hover:hover)]:hover:text-white/80 active:bg-white/[0.045] active:text-white/80",
                        )}
                      >
                        {cat}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <SearchBox
              value={serviceQuery}
              onChange={setServiceQuery}
              placeholder="Buscar servicio"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-visible sm:overflow-y-auto px-3 py-3 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
            {/* Desktop: caja continua de siempre, sin cambios. */}
            <div className="hidden overflow-hidden rounded-3xl border border-white/[0.065] bg-white/[0.018] sm:block">
              {data.loading ? (
                <RowSkeleton />
              ) : filteredServices.length === 0 ? (
                <div className="py-16 text-center text-sm text-white/45">
                  Sin servicios.
                </div>
              ) : (
                filteredServices.map((item: any) => (
                  <ServiceRow key={item.id} item={item} />
                ))
              )}
            </div>
            {/* Mobile: tarjetas individuales con separación real. min-h
                evita que la página se achique/agrande de golpe al cambiar
                de categoría (algunas tienen 1-2 servicios, otras muchos) —
                ese salto de alto corría el scroll y exponía distinto el
                glow ambiental fijo de arriba de la página, sensación de
                "cambia la luz" sin que ningún color cambiara en realidad. */}
            <div className="min-h-[50vh] sm:hidden">
              {data.loading ? (
                <RowSkeletonMobile />
              ) : filteredServices.length === 0 ? (
                <div className="py-16 text-center text-sm text-white/45">
                  Sin servicios.
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {filteredServices.map((item: any) => (
                    <ServiceRowMobile key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section
          className={cn(
            // Ver comentario detallado en la sección de Servicios: el
            // degradado vive en una capa aparte, absolutamente posicionada
            // con alto fijo (100dvh) que nunca depende de cuánto mida la
            // sección. Desktop no cambia.
            "relative min-h-0 flex-col overflow-hidden rounded-3xl border border-white/[0.085] shadow-[0_24px_85px_-50px_rgba(59,130,246,0.34)] sm:flex sm:bg-[linear-gradient(180deg,rgba(12,16,30,0.95),rgba(5,7,16,0.98))]",
            mobileSection === "catalogo" ? "flex" : "hidden",
          )}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[100dvh] bg-[linear-gradient(180deg,rgba(12,16,30,0.95),rgba(5,7,16,0.98))] sm:hidden" />
          <div className="flex shrink-0 flex-col gap-3 border-b border-white/[0.065] px-5 py-3">
            {/* Ver comentario detallado en la lista de Servicios: mismo
                bug de WebKit (fondo translúcido + overflow-x-auto en el
                mismo elemento cambia de composición según si hay scroll o
                no) y mismo fix (separar fondo/borde del mecanismo de
                scroll en dos elementos). */}
            <div className="isolate inline-flex max-w-full self-start rounded-2xl border border-white/[0.07] bg-[rgba(0,0,0,0.25)] p-1.5">
              <div className="flex min-w-0 gap-2 overflow-x-auto">
                {data.loading ? (
                  [0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-9 w-16 shrink-0 animate-pulse rounded-xl bg-white/[0.06]"
                    />
                  ))
                ) : (
                  catalogCategories.map((cat) => {
                    const active = catalogFilter === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCatalogFilter(cat)}
                        className={cn(
                          "rounded-xl px-3.5 py-2 text-xs font-bold transition-all whitespace-nowrap",
                          active
                            ? "bg-violet-500/18 text-white ring-1 ring-violet-300/24"
                            : "text-white/50 [@media(hover:hover)]:hover:bg-white/[0.045] [@media(hover:hover)]:hover:text-white/80 active:bg-white/[0.045] active:text-white/80",
                        )}
                      >
                        {cat}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <SearchBox
              value={catalogQuery}
              onChange={setCatalogQuery}
              placeholder="Buscar producto"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-visible sm:overflow-y-auto px-3 py-3 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
            {/* Desktop: caja continua de siempre, sin cambios. */}
            <div className="hidden overflow-hidden rounded-3xl border border-white/[0.065] bg-white/[0.018] sm:block">
              {data.loading ? (
                <RowSkeleton />
              ) : filteredCatalog.length === 0 ? (
                <div className="py-16 text-center text-sm text-white/45">
                  Sin artículos.
                </div>
              ) : (
                filteredCatalog.map((item: any) => (
                  <CatalogRow key={item.id} item={item} />
                ))
              )}
            </div>
            {/* Mobile: tarjetas individuales con separación real. min-h
                evita que la página se achique/agrande de golpe al cambiar
                de categoría (ver mismo comentario en la lista de
                Servicios de arriba). */}
            <div className="min-h-[50vh] sm:hidden">
              {data.loading ? (
                <RowSkeletonMobile />
              ) : filteredCatalog.length === 0 ? (
                <div className="py-16 text-center text-sm text-white/45">
                  Sin artículos.
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {filteredCatalog.map((item: any) => (
                    <CatalogRowMobile key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function InventarioTab({
  businessId: _businessId,
  userEmail,
  chargedByName,
  data,
}: {
  businessId: string | null;
  userEmail: string | null;
  chargedByName: string;
  data: ReturnType<typeof useCajaData>;
}) {
  // Reutiliza el `data` que ya cargó CashRegisterPage (mismo fix que
  // ProfesionalesTab/PreciosTab) — evita el refetch redundante y el flash
  // de "Sin artículos" al entrar a esta pestaña.
  const [stockQuery, setStockQuery] = React.useState("");
  const [stockFilter, setStockFilter] = React.useState("Todos");
  const [movementQuery, setMovementQuery] = React.useState("");
  // Mobile: "Últimos movimientos" deja de listarse fijo en pantalla y pasa a
  // un modal (mismo dato/lógica, solo cambia dónde se muestra). Desktop no
  // se toca — sigue siendo la segunda columna de siempre.
  const [movementsModalOpen, setMovementsModalOpen] = React.useState(false);
  useBodyScrollLock(movementsModalOpen);
  const [adjustingId, setAdjustingId] = React.useState<string | null>(null);
  const INVENTORY_STOCK_KEY = "clippr_inventory_stock_overrides_v1";
  const readLocalStock = React.useCallback((): Record<string, number> => {
    if (typeof window === "undefined") return {};
    try {
      const parsed = JSON.parse(window.localStorage.getItem(INVENTORY_STOCK_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }, []);
  const [stockById, setStockById] = React.useState<Record<string, number>>(() => readLocalStock());
  const [stockAdjustment, setStockAdjustment] = React.useState<{
    item: any;
    direction: "in" | "out";
  } | null>(null);
  // Fondo bloqueado mientras el modal de Agregar/Retirar stock está
  // abierto — mismo hook que el resto de los modales de esta pantalla
  // (movementsModalOpen arriba, DetailModal en History), evita el
  // rubber-band de iOS Safari moviendo la pantalla de atrás.
  useBodyScrollLock(Boolean(stockAdjustment));
  const [adjustQty, setAdjustQty] = React.useState("");
  const [adjustNote, setAdjustNote] = React.useState("");
  // Flujo nuevo de "Retirar stock" (direction === "out" únicamente):
  // withdrawWho = id de employees, o el sentinel "__other__" (sin texto
  // libre — un profesional real siempre va por su nombre; cualquier otro
  // caso, incluido un ajuste de stock sin persona, va por "Otro").
  // withdrawMode: cómo se resuelve ese consumo — "pay" genera un ingreso
  // real en Caja, "advance" un adelanto al profesional (sistema existente
  // de Liquidaciones, no una lógica paralela, solo disponible con un
  // profesional real), "courtesy" no mueve plata en ningún lado, "adjust"
  // (solo con "Otro") es un ajuste de inventario puro — ni ingreso, ni
  // adelanto, ni cliente/profesional asociado.
  const [withdrawWho, setWithdrawWho] = React.useState("");
  const [withdrawMode, setWithdrawMode] = React.useState<"pay" | "advance" | "courtesy" | "adjust" | "">("");
  const [withdrawPayMethod, setWithdrawPayMethod] = React.useState<"cash" | "transfer" | "">("");
  const INVENTORY_MOVEMENTS_KEY = "clippr_inventory_movements_v1";

  React.useEffect(() => {
    const handler = () => setStockById(readLocalStock());
    window.addEventListener("clippr:inventory-stock-updated", handler);
    return () => window.removeEventListener("clippr:inventory-stock-updated", handler);
  }, [readLocalStock]);

  const catalogItems = React.useMemo(
    () => (data.services ?? []).filter((item: any) => item.is_catalog),
    [data.services],
  );
  const CATALOG_CATEGORY_ORDER = ["Productos", "Bebidas", "Indumentaria"];
  const stockCategories = React.useMemo(() => {
    const present = new Set(
      catalogItems.map((item: any) =>
        String(item.category || item.type || "Productos"),
      ),
    );
    const ordered = CATALOG_CATEGORY_ORDER.filter((cat) => present.has(cat));
    const extra = [...present].filter(
      (cat) => !CATALOG_CATEGORY_ORDER.includes(cat),
    );
    return ["Todos", ...ordered, ...extra];
  }, [catalogItems]);
  const normalizedStockQuery = stockQuery.trim().toLowerCase();
  const normalizedMovementQuery = movementQuery.trim().toLowerCase();

  const itemImage = (item: any) =>
    item.image_url ??
    item.photo_url ??
    item.thumbnail_url ??
    item.cover_url ??
    item.image ??
    item.photo ??
    null;
  const catalogCategory = (item: any) =>
    String(item.category || item.type || "Productos");
  const itemId = (item: any) =>
    String(
      item.id ??
        item.service_id ??
        item.product_id ??
        item.name ??
        crypto.randomUUID(),
    );
  const stockNumber = (item: any) => {
    const id = itemId(item);
    if (Object.prototype.hasOwnProperty.call(stockById, id))
      return stockById[id];
    return Number(item.stock ?? item.quantity ?? item.qty ?? 0);
  };

  // Placeholder mientras `data.loading` es true — mismo tamaño/fondo de fila
  // que el contenido real, para no mostrar "Sin artículos/movimientos" por
  // un instante en la primera carga real de Caja. Versión desktop: sin
  // tarjeta propia, se usa DENTRO de la caja continua de siempre.
  const InventoryRowSkeleton = () => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-white/[0.055] px-4 py-3 last:border-0"
        >
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-white/[0.06]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-1/2 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-white/[0.045]" />
          </div>
          <div className="hidden h-6 w-16 shrink-0 animate-pulse rounded-full bg-white/[0.045] sm:block" />
        </div>
      ))}
    </>
  );

  // Versión mobile del skeleton de Stock: reproduce la MISMA fila única de
  // la tarjeta real (thumb+nombre, badge de stock + botones +/-) — antes
  // tenía una segunda fila que ya no existe, y el botón "+" con glow
  // (shadow-[0_0_18px_rgba(16,185,129,0.16)]) aparecía recién con los
  // datos reales, lo que se veía como "prende la luz".
  const InventoryRowSkeletonMobile = () => (
    <div className="flex flex-col gap-2.5">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-2.5"
        >
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-white/[0.06]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-1/2 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-white/[0.045]" />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="h-6 w-16 animate-pulse rounded-full bg-white/[0.045]" />
            <div className="size-8 shrink-0 animate-pulse rounded-full bg-white/[0.045]" />
            <div className="size-8 shrink-0 animate-pulse rounded-full bg-white/[0.045]" />
          </div>
        </div>
      ))}
    </div>
  );

  // Versión mobile del skeleton de Movimientos: estructura propia (fecha +
  // tipo, producto, cantidad/stock/usuario) — distinta a la de Stock, así
  // que no comparte el mismo componente.
  const InventoryMovementSkeletonMobile = () => (
    <div className="flex flex-col gap-2.5">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3.5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="h-2.5 w-20 animate-pulse rounded bg-white/[0.045]" />
            <div className="h-4 w-16 animate-pulse rounded-full bg-white/[0.045]" />
          </div>
          <div className="mt-2 h-3.5 w-2/3 animate-pulse rounded bg-white/[0.06]" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="h-3 w-10 animate-pulse rounded bg-white/[0.045]" />
            <div className="h-3 w-16 animate-pulse rounded bg-white/[0.045]" />
            <div className="h-3 w-14 animate-pulse rounded bg-white/[0.045]" />
          </div>
        </div>
      ))}
    </div>
  );

  const formatInventoryDate = (value: string | Date | null | undefined) => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "—";
    return (
      date.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      }) +
      ", " +
      date.toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }) +
      "hs"
    );
  };

  type InventoryMovement = {
    id: string;
    created_at: string;
    product: string;
    type: "Ingreso" | "Egreso";
    qty: number;
    stockFrom: number | null;
    stockTo: number | null;
    note: string | null;
    user: string | null;
    // Solo presentes en retiros del flujo nuevo ("Retirar stock" con
    // persona/motivo) — el resto de los movimientos (ingresos, ventas,
    // ajustes viejos) los deja undefined.
    withdrawnBy?: string | null;
    withdrawnKind?: "pagado" | "adelanto" | "cortesia" | "ajuste" | null;
    withdrawnMethod?: "cash" | "transfer" | null;
    unitPrice?: number | null;
  };

  const readLocalMovements = React.useCallback((): InventoryMovement[] => {
    if (typeof window === "undefined") return [];
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem(INVENTORY_MOVEMENTS_KEY) || "[]",
      );
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

  const [localMovements, setLocalMovements] = React.useState<
    InventoryMovement[]
  >(() => readLocalMovements());

  React.useEffect(() => {
    const handler = () => setLocalMovements(readLocalMovements());
    window.addEventListener("clippr:inventory-movements-updated", handler);
    return () =>
      window.removeEventListener("clippr:inventory-movements-updated", handler);
  }, [readLocalMovements]);

  const saveLocalMovement = React.useCallback(
    (movement: InventoryMovement) => {
      if (typeof window === "undefined") return;
      try {
        const next = [movement, ...readLocalMovements()].slice(0, 120);
        window.localStorage.setItem(
          INVENTORY_MOVEMENTS_KEY,
          JSON.stringify(next),
        );
        setLocalMovements(next);
        window.dispatchEvent(
          new CustomEvent("clippr:inventory-movements-updated"),
        );
      } catch {
        // ignore
      }
    },
    [readLocalMovements],
  );

  const filteredStock = catalogItems.filter((item: any) => {
    if (
      stockFilter !== "Todos" &&
      String(item.category || item.type || "Productos") !== stockFilter
    )
      return false;
    if (!normalizedStockQuery) return true;
    return `${item.name ?? ""} ${item.category ?? ""} ${item.type ?? ""}`
      .toLowerCase()
      .includes(normalizedStockQuery);
  });

  // El color del badge ya comunica el estado (verde = hay stock, rojo =
  // sin stock) — no hace falta un texto "Disponible"/"Sin stock" aparte.
  const StockBadge = ({ stock }: { stock: number }) => (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ring-1",
        stock > 0
          ? "bg-emerald-400/12 text-emerald-300 ring-emerald-400/24"
          : "bg-rose-500/12 text-rose-300 ring-rose-400/24",
      )}
    >
      <span className="size-2 rounded-full bg-current" />
      Stock {stock}
    </span>
  );

  const Thumb = ({ item }: { item: any }) => (
    <ServiceImage
      src={itemImage(item)}
      alt={item.name ?? ""}
      position={item.image_position ?? item.imagePosition}
      className="size-10 rounded-xl border border-violet-300/12 bg-violet-500/10 text-lg text-violet-200 shadow-[0_0_24px_rgba(139,92,246,0.14)]"
      fallback={<span>□</span>}
    />
  );

  // Estilos del modal "Retirar stock" — chip (Quién retira) y botón de
  // modo (Cómo se registra), reutilizados 2-3 veces cada uno en el JSX.
  const withdrawChipClass = (active: boolean) =>
    cn(
      "rounded-xl border px-3 py-1.5 text-sm font-semibold transition",
      active
        ? "border-violet-300/45 bg-violet-400/14 text-violet-100 ring-1 ring-violet-300/20"
        : "border-white/10 bg-white/[0.035] text-white/65 hover:border-white/20 hover:text-white",
    );
  const withdrawModeClass = (active: boolean, tone: "emerald" | "amber" | "sky" | "slate") =>
    cn(
      "flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-bold transition",
      active
        ? {
            emerald: "border-emerald-300/45 bg-emerald-400/14 text-emerald-100 ring-1 ring-emerald-300/20",
            amber: "border-amber-300/45 bg-amber-400/14 text-amber-100 ring-1 ring-amber-300/20",
            sky: "border-sky-300/45 bg-sky-400/14 text-sky-100 ring-1 ring-sky-300/20",
            slate: "border-white/25 bg-white/[0.09] text-white ring-1 ring-white/15",
          }[tone]
        : "border-white/10 bg-white/[0.035] text-white/65 hover:border-white/20 hover:text-white",
    );

  function openStockAdjustment(item: any, direction: "in" | "out") {
    if (adjustingId) return;
    setStockAdjustment({ item, direction });
    // "out": selector −/1/+, siempre arranca en 1. "in": sigue siendo un
    // input numérico libre, vacío hasta que se escribe algo.
    setAdjustQty(direction === "out" ? "1" : "");
    setAdjustNote("");
    setWithdrawWho("");
    setWithdrawMode("");
    setWithdrawPayMethod("");
  }

  // Único lugar que persiste stock en Supabase — antes apuntaba a
  // "services" (tabla que no existe; el catálogo vive en price_catalog,
  // ver use-caja-data.ts), así que el update fallaba SIEMPRE y todo
  // ajuste de stock quedaba solo guardado en localStorage sin que nadie
  // se enterara (el catch de abajo mostraba éxito igual). Se corrige de
  // paso acá, ya que este flujo nuevo depende de que el stock se
  // descuente de verdad.
  //
  // Sin "updated_at": esa columna no existe en price_catalog en
  // producción (confirmado — ningún otro punto de la app que actualiza
  // price_catalog, ej. price-catalog-section.tsx, la envía tampoco).
  // Mandarla rompía el update con "Could not find the 'updated_at'
  // column... in the schema cache" en TODOS los casos, incluido
  // Cortesía (que no pasa por ningún otro punto de fallo visible, así
  // que el error quedaba fácil de atribuir mal a otra parte del flujo).
  async function persistCatalogStock(id: string, nextStock: number) {
    const { error } = await supabase
      .from("price_catalog")
      .update({ stock: nextStock } as any)
      .eq("id", id);
    if (error) throw error;
    setStockById((prev) => {
      const next = { ...prev, [id]: nextStock };
      try {
        window.localStorage.setItem(INVENTORY_STOCK_KEY, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("clippr:inventory-stock-updated"));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function resetStockAdjustmentForm() {
    setStockAdjustment(null);
    setAdjustQty("");
    setAdjustNote("");
    setWithdrawWho("");
    setWithdrawMode("");
    setWithdrawPayMethod("");
  }

  async function confirmStockAdjustment() {
    if (!stockAdjustment) return;

    const item = stockAdjustment.item;
    const direction = stockAdjustment.direction;
    const id = itemId(item);
    if (adjustingId) return;

    const qty = Math.abs(Number(adjustQty));
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Ingresá una cantidad válida");
      return;
    }

    const currentStock = stockNumber(item);
    if (direction === "out" && qty > currentStock) {
      toast.error("No podés retirar más stock del disponible");
      return;
    }

    // "Agregar stock" (direction === "in") no cambia: mismo flujo simple
    // de siempre (Cantidad + Nota), solo con el fix de tabla de arriba.
    if (direction === "in") {
      const nextStock = currentStock + qty;
      setAdjustingId(id);
      try {
        await persistCatalogStock(id, nextStock);
        saveLocalMovement({
          id: `${Date.now()}-${id}`,
          created_at: new Date().toISOString(),
          product: item.name ?? "Producto",
          type: "Ingreso",
          qty,
          stockFrom: currentStock,
          stockTo: nextStock,
          note: adjustNote.trim() || null,
          user: userEmail ?? "Caja",
        });
        toast.success("Stock agregado");
        resetStockAdjustmentForm();
        await data.refresh();
      } catch (error: any) {
        // Fallback local: si por lo que sea el update a Supabase falla,
        // igual dejamos persistido el ajuste en este dispositivo — sin
        // plata ni adelantos de por medio, un ingreso de stock no tiene
        // el mismo riesgo que un retiro pagado/adelanto (ver abajo).
        setStockById((prev) => {
          const next = { ...prev, [id]: nextStock };
          try {
            window.localStorage.setItem(INVENTORY_STOCK_KEY, JSON.stringify(next));
            window.dispatchEvent(new CustomEvent("clippr:inventory-stock-updated"));
          } catch {
            // ignore
          }
          return next;
        });
        saveLocalMovement({
          id: `${Date.now()}-${id}`,
          created_at: new Date().toISOString(),
          product: item.name ?? "Producto",
          type: "Ingreso",
          qty,
          stockFrom: currentStock,
          stockTo: nextStock,
          note: adjustNote.trim() || null,
          user: userEmail ?? "Caja",
        });
        toast.success("Stock agregado");
        resetStockAdjustmentForm();
      } finally {
        setAdjustingId(null);
      }
      return;
    }

    // "Retirar stock" (direction === "out"): quién retira + cómo se
    // registra son obligatorios — reemplazan la nota libre de antes como
    // forma de dejar registrado el motivo, con casos reales (Pagar ahora/
    // Adelanto/Cortesía) en vez de solo texto suelto.
    if (!data.businessId) {
      toast.error("Falta el negocio — recargá la página");
      return;
    }
    if (!withdrawWho) {
      toast.error("Elegí quién retira");
      return;
    }
    const isOther = withdrawWho === "__other__";
    if (!withdrawMode) {
      toast.error("Elegí cómo se registra el retiro");
      return;
    }
    if (withdrawMode === "pay" && !withdrawPayMethod) {
      toast.error("Elegí el método de pago");
      return;
    }

    const nextStock = currentStock - qty;
    const employee = isOther ? null : (data.employees.find((e) => e.id === withdrawWho) ?? null);
    // "Otro" ya no tiene texto libre — el label es literalmente "Otro".
    // "Ajuste de stock" (solo con "Otro") no se asocia a nadie: sin
    // whoLabel, sin cliente, sin profesional.
    const whoLabel = withdrawMode === "adjust" ? null : isOther ? "Otro" : (employee?.name ?? "—");
    const listUnitPrice = Number(item.price ?? item.cash_discount ?? 0) || 0;
    // Precio colaborador: solo con un profesional real (nunca "Otro") y
    // solo para Pagar ahora/Anotar como adelanto — Cortesía nunca cobra
    // nada de todos modos, pero el monto "de referencia" que se guarda en
    // el movimiento usa el mismo precio que se hubiera cobrado, para que
    // el historial de Inventario sea consistente con lo que se vio en el
    // modal.
    const isCollaboratorEligible = !isOther;
    const unitPrice = resolveStaffUnitPrice(item, listUnitPrice, isCollaboratorEligible);
    const totalAmount = unitPrice * qty;
    const kind: "pagado" | "adelanto" | "cortesia" | "ajuste" =
      withdrawMode === "pay"
        ? "pagado"
        : withdrawMode === "advance"
          ? "adelanto"
          : withdrawMode === "adjust"
            ? "ajuste"
            : "cortesia";

    setAdjustingId(id);
    try {
      // 1. Plata primero (si corresponde) — si esto falla, el stock queda
      //    sin tocar en vez de quedar descontado sin que se haya
      //    registrado el ingreso/adelanto correspondiente.
      if (withdrawMode === "pay") {
        await registerPayment({
          businessId: data.businessId,
          branchId: data.activeBranchId,
          // Profesional real → va en employeeId (columna real de
          // trazabilidad), nunca en clientName — así "Últimos ingresos"
          // lo muestra en Profesional, con Cliente en "—", en vez de
          // aparecer como si fuera un cliente que compró. "Otro" (sin
          // employees.id real) sigue yendo en clientName, como antes.
          //
          // Sin employeeCommissions/commissionPct/commissionFixed: aunque
          // employeeId quede seteado, computeCommissionAmount no tiene con
          // qué calcular nada (cae a 0 en todos los casos) — no genera
          // comisión sobre su propio consumo.
          employeeId: isOther ? null : withdrawWho,
          clientName: isOther ? whoLabel || "Cliente del mostrador" : null,
          items: [
            {
              serviceId: id,
              serviceName: item.name ?? "Producto",
              amount: unitPrice,
              isCatalog: true,
              qty,
            },
          ],
          method: withdrawPayMethod === "transfer" ? "transfer" : "cash",
          sessionId: data.cashSessionId,
          chargedBy: data.profileId,
          chargeOrigin: "caja",
          notes: STOCK_WITHDRAWAL_NOTE_MARKER,
        });
      } else if (withdrawMode === "advance") {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user?.id) throw new Error("Sesión inválida — volvé a iniciar sesión");
        const { error: advanceError } = await supabase.rpc(
          "register_professional_advance" as any,
          {
            p_business_id: data.businessId,
            p_professional_id: withdrawWho,
            p_amount: totalAmount,
            p_payment_method: null,
            p_note: `Retiro de stock: ${item.name ?? "Producto"} x${qty}`,
            p_advanced_at: new Date().toISOString(),
            p_registered_by: user.id,
            p_registered_by_name: chargedByName,
          },
        );
        if (advanceError) throw advanceError;
      }
      // "courtesy"/"adjust": no genera ingreso ni adelanto — solo stock +
      // movimiento. "adjust" además nunca pasa por acá con whoLabel: no
      // se asocia a cliente ni profesional en ningún lado.

      // 2. Stock.
      await persistCatalogStock(id, nextStock);

      // 3. Movimiento — siempre el detalle completo, para "Pagar ahora"
      //    reemplaza (vía STOCK_WITHDRAWAL_NOTE_MARKER, filtrado en
      //    salesMovements) al que se hubiera generado solo por cruzar el
      //    pago recién insertado contra el nombre del producto.
      saveLocalMovement({
        id: `${Date.now()}-${id}`,
        created_at: new Date().toISOString(),
        product: item.name ?? "Producto",
        type: "Egreso",
        qty: -qty,
        stockFrom: currentStock,
        stockTo: nextStock,
        note: null,
        user: chargedByName || userEmail || "Caja",
        withdrawnBy: whoLabel || null,
        withdrawnKind: kind,
        withdrawnMethod: withdrawMode === "pay" ? withdrawPayMethod || null : null,
        unitPrice,
      });

      toast.success("Stock retirado");
      resetStockAdjustmentForm();
      await data.refresh();
    } catch (error: any) {
      // A diferencia de "Agregar stock", acá NO hay fallback silencioso a
      // localStorage: si el ingreso/adelanto o el update de stock fallan,
      // hay plata o deuda de por medio — mejor mostrar el error real y
      // dejar el modal abierto que fingir éxito con datos a medias.
      toast.error(error?.message || "No se pudo registrar el retiro");
    } finally {
      setAdjustingId(null);
    }
  }

  const salesMovements = React.useMemo<InventoryMovement[]>(() => {
    const catalogNames = new Set(
      catalogItems
        .map((item: any) => String(item.name ?? "").toLowerCase())
        .filter(Boolean),
    );
    return (data.paymentsToday ?? [])
      .filter(
        (payment: any) =>
          // Excluye los pagos que ya vienen del flujo "Retirar stock →
          // Pagar ahora" (ver STOCK_WITHDRAWAL_NOTE_MARKER) — esos ya se
          // guardan como movimiento propio, con todo el detalle
          // (quién retiró, método), en confirmStockAdjustment. Sin este
          // filtro aparecían acá DE NUEVO, cruzados solo por nombre de
          // producto, duplicando la fila en "Últimos movimientos".
          !String(payment.observations ?? "").startsWith(STOCK_WITHDRAWAL_NOTE_MARKER) &&
          catalogNames.has(
            String(
              payment.service_name ??
                payment.service ??
                payment.item_name ??
                payment.name ??
                "",
            ).toLowerCase(),
          ),
      )
      .map((payment: any) => {
        // Antes caía a payment.charged_by/created_by crudos (uuid de
        // profiles) cuando no había user_name — un movimiento de
        // inventario terminaba mostrando un UUID en vez de un nombre.
        // getChargedByLabel es la misma resolución que ya usa "Cobrado
        // por"/"Cobró" en el resto de Caja: nunca devuelve algo con forma
        // de UUID.
        const empName =
          data.employees.find((e) => e.id === payment.employee_id)?.name ?? null;
        return {
          id: `sale-${payment.id}`,
          created_at: payment.created_at ?? new Date().toISOString(),
          product:
            payment.service_name ??
            payment.service ??
            payment.item_name ??
            payment.name ??
            "Venta",
          type: "Egreso" as const,
          qty: -Number(payment.quantity ?? payment.qty ?? 1),
          stockFrom: null,
          stockTo: null,
          note: "Venta en caja",
          user: getChargedByLabel(payment, empName, getChargeType(payment)),
        };
      });
  }, [data.paymentsToday, catalogItems, userEmail]);

  const inventoryMovements = React.useMemo(() => {
    return [...localMovements, ...salesMovements].sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    );
  }, [localMovements, salesMovements]);

  const filteredMovements = inventoryMovements.filter(
    (item: InventoryMovement) => {
      if (!normalizedMovementQuery) return true;
      return `${item.product ?? ""} ${item.note ?? ""} ${item.type ?? ""} ${item.user ?? ""} ${item.withdrawnBy ?? ""}`
        .toLowerCase()
        .includes(normalizedMovementQuery);
    },
  );

  const movementTypeClass = (type: InventoryMovement["type"]) =>
    type === "Ingreso"
      ? "bg-emerald-400/12 text-emerald-300 ring-emerald-400/24"
      : "bg-rose-500/12 text-rose-300 ring-rose-400/24";

  const qtyText = (qty: number) => `${qty > 0 ? "+" : ""}${qty}`;
  const stockFlow = (movement: InventoryMovement) =>
    movement.stockFrom === null || movement.stockTo === null
      ? "—"
      : `${movement.stockFrom} → ${movement.stockTo}`;

  // Etiqueta/color del "Tipo" de retiro (Pagado/Adelanto/Cortesía) que
  // pide el flujo nuevo de "Retirar stock" — se muestra en vez de la nota
  // libre cuando el movimiento tiene withdrawnKind (nunca para ingresos,
  // ventas normales, o ajustes viejos sin persona asociada).
  const withdrawKindLabel = (movement: InventoryMovement) => {
    const method = movement.withdrawnMethod === "transfer" ? "Transferencia" : "Efectivo";
    if (movement.withdrawnKind === "pagado") return `Pagado (${method})`;
    if (movement.withdrawnKind === "adelanto") return "Adelanto";
    if (movement.withdrawnKind === "cortesia") return "Cortesía";
    if (movement.withdrawnKind === "ajuste") return "Ajuste de stock";
    return null;
  };
  const withdrawKindClass = (kind: InventoryMovement["withdrawnKind"]) =>
    kind === "pagado"
      ? "bg-emerald-400/12 text-emerald-300 ring-emerald-400/22"
      : kind === "adelanto"
        ? "bg-amber-400/12 text-amber-300 ring-amber-400/22"
        : kind === "ajuste"
          ? "bg-white/10 text-white/60 ring-white/15"
          : "bg-sky-400/12 text-sky-300 ring-sky-400/22";

  return (
    <div className="mt-3 grid h-auto grid-cols-1 gap-5 overflow-visible pb-6 xl:grid-cols-2 sm:-mt-5 sm:h-[calc(100vh-270px)] sm:min-h-[470px] sm:overflow-hidden">
      <section className="flex min-h-0 flex-col overflow-visible rounded-3xl border border-white/[0.085] bg-[linear-gradient(180deg,rgba(12,16,30,0.95),rgba(5,7,16,0.98))] shadow-[0_24px_85px_-50px_rgba(139,92,246,0.42)] sm:overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-white/[0.065] px-5 py-3">
          {/* Mobile: "Últimos movimientos" pasa a un modal (ver botón +
              modal más abajo, fuera de esta sección) en vez de listarse
              fijo en pantalla. Acceso rápido desde acá mismo. */}
          <button
            type="button"
            onClick={() => setMovementsModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.09] bg-white/[0.045] px-4 py-2.5 text-sm font-semibold text-white/85 transition active:bg-white/[0.08] sm:hidden"
          >
            <ArrowRight className="size-4" />
            Ver últimos movimientos
          </button>
          {/* Mismo fix de WebKit que en Precios: fondo/borde afuera (sin
              overflow, nunca se promueve a capa de scroll) y el mecanismo
              de scroll adentro (sin fondo propio). */}
          <div className="isolate inline-flex max-w-full self-start rounded-2xl border border-white/[0.07] bg-[rgba(0,0,0,0.25)] p-1.5">
            <div className="flex min-w-0 gap-2 overflow-x-auto">
              {stockCategories.map((cat) => {
                const active = stockFilter === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setStockFilter(cat)}
                    className={cn(
                      "rounded-xl px-3.5 py-2 text-xs font-bold transition-all whitespace-nowrap",
                      active
                        ? "bg-violet-500/18 text-white ring-1 ring-violet-300/24"
                        : "text-white/50 [@media(hover:hover)]:hover:bg-white/[0.045] [@media(hover:hover)]:hover:text-white/80 active:bg-white/[0.045] active:text-white/80",
                    )}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>
          <SearchBox
            value={stockQuery}
            onChange={setStockQuery}
            placeholder="Buscar artículo"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-visible sm:overflow-y-auto px-4 py-4 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
          {/* Desktop: tabla. En mobile, tarjetas verticales debajo — mismos
              datos y mismas acciones de ajustar stock. */}
          <div className="hidden overflow-hidden rounded-3xl border border-white/[0.065] bg-white/[0.018] sm:block">
            <div className="grid grid-cols-[minmax(190px,1fr)_140px_140px] gap-4 border-b border-white/[0.065] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/38">
              <div>Artículo</div>
              <div>Stock</div>
              <div className="text-right">Ajustar</div>
            </div>
            {data.loading ? (
              <InventoryRowSkeleton />
            ) : filteredStock.length === 0 ? (
              <div className="py-16 text-center text-sm text-white/45">
                Sin artículos.
              </div>
            ) : (
              filteredStock.map((item: any) => {
                const stock = stockNumber(item);
                const id = itemId(item);
                const loading = adjustingId === id;
                return (
                  <div
                    key={id}
                    className="grid grid-cols-[minmax(190px,1fr)_140px_140px] items-center gap-4 border-b border-white/[0.055] px-4 py-2.5 text-sm last:border-0 hover:bg-white/[0.026]"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <Thumb item={item} />
                      <div className="min-w-0">
                        <div className="truncate font-bold text-white">
                          {item.name ?? "Producto"}
                        </div>
                        <div className="mt-1 text-xs text-white/50">
                          {catalogCategory(item)}
                        </div>
                      </div>
                    </div>
                    <StockBadge stock={stock} />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openStockAdjustment(item, "out")}
                        disabled={loading}
                        className="grid size-9 place-items-center rounded-full border border-white/10 bg-white/[0.035] text-white/70 transition hover:-translate-y-0.5 hover:bg-rose-500/12 hover:text-rose-200 disabled:opacity-50"
                      >
                        <Minus className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openStockAdjustment(item, "in")}
                        disabled={loading}
                        className="grid size-9 place-items-center rounded-full border border-emerald-300/18 bg-emerald-400/12 text-emerald-200 shadow-[0_0_22px_rgba(16,185,129,0.18)] transition hover:-translate-y-0.5 hover:bg-emerald-400/18 disabled:opacity-50"
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="sm:hidden">
            {data.loading ? (
              <InventoryRowSkeletonMobile />
            ) : filteredStock.length === 0 ? (
              <div className="py-16 text-center text-sm text-white/45">
                Sin artículos.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {filteredStock.map((item: any) => {
                  const stock = stockNumber(item);
                  const id = itemId(item);
                  const loading = adjustingId === id;
                  return (
                    <div
                      key={`mobile-${id}`}
                      className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-2.5"
                    >
                      <Thumb item={item} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold text-white">
                          {item.name ?? "Producto"}
                        </div>
                        <div className="mt-0.5 text-xs text-white/50">
                          {catalogCategory(item)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StockBadge stock={stock} />
                        <button
                          type="button"
                          onClick={() => openStockAdjustment(item, "out")}
                          disabled={loading}
                          className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.035] text-white/70 transition active:bg-rose-500/12 active:text-rose-200 disabled:opacity-50"
                        >
                          <Minus className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openStockAdjustment(item, "in")}
                          disabled={loading}
                          className="grid size-8 shrink-0 place-items-center rounded-full border border-emerald-300/18 bg-emerald-400/12 text-emerald-200 shadow-[0_0_18px_rgba(16,185,129,0.16)] transition active:bg-emerald-400/18 disabled:opacity-50"
                        >
                          <Plus className="size-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="hidden min-h-0 flex-col overflow-hidden rounded-3xl border border-white/[0.085] bg-[linear-gradient(180deg,rgba(12,16,30,0.95),rgba(5,7,16,0.98))] shadow-[0_24px_85px_-50px_rgba(59,130,246,0.34)] sm:flex">
        <div className="flex flex-col gap-4 border-b border-white/[0.065] px-5 py-5">
          <div className="flex items-center gap-4">
            <div className="grid size-12 place-items-center rounded-2xl bg-violet-500/12 text-violet-200 ring-1 ring-violet-300/18">
              <ArrowRight className="size-6" />
            </div>
            <div className="text-xl font-bold text-white">
              Últimos movimientos <span className="text-white/35">·</span>{" "}
              <span className="text-white/55">{inventoryMovements.length}</span>
            </div>
          </div>
          <SearchBox
            value={movementQuery}
            onChange={setMovementQuery}
            placeholder="Buscar movimiento"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
          <div className="overflow-hidden rounded-3xl border border-white/[0.065] bg-white/[0.018]">
            <div className="grid grid-cols-[145px_minmax(120px,1fr)_95px_70px_80px_minmax(105px,1fr)_minmax(120px,1fr)] gap-4 border-b border-white/[0.065] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/38">
              <div>Fecha</div>
              <div>Producto</div>
              <div>Tipo</div>
              <div>Cant.</div>
              <div>Stock</div>
              <div>Nota</div>
              <div>Usuario</div>
            </div>
            {data.loading ? (
              <InventoryRowSkeleton />
            ) : filteredMovements.length === 0 ? (
              <div className="py-16 text-center text-sm text-white/45">
                Sin movimientos.
              </div>
            ) : (
              filteredMovements.map((item: InventoryMovement) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[145px_minmax(120px,1fr)_95px_70px_80px_minmax(105px,1fr)_minmax(120px,1fr)] items-center gap-4 border-b border-white/[0.055] px-4 py-3 text-sm last:border-0 hover:bg-white/[0.026]"
                >
                  <div className="text-xs text-white/50">
                    {formatInventoryDate(item.created_at)}
                  </div>
                  <div className="truncate font-semibold text-white">
                    {item.product}
                  </div>
                  <div
                    className={cn(
                      "inline-flex w-fit rounded-full px-3 py-1 text-xs font-bold ring-1",
                      movementTypeClass(item.type),
                    )}
                  >
                    {item.type}
                  </div>
                  <div
                    className={cn(
                      "font-bold tabular-nums",
                      item.qty >= 0 ? "text-emerald-300" : "text-rose-300",
                    )}
                  >
                    {qtyText(item.qty)}
                  </div>
                  <div className="text-white/60">{stockFlow(item)}</div>
                  <div className="min-w-0 truncate text-white/50">
                    {item.withdrawnKind ? (
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={cn(
                            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ring-1",
                            withdrawKindClass(item.withdrawnKind),
                          )}
                        >
                          {withdrawKindLabel(item)}
                        </span>
                        <span className="truncate text-white/60">{item.withdrawnBy}</span>
                      </span>
                    ) : (
                      item.note || "—"
                    )}
                  </div>
                  <div className="truncate text-white/50">
                    {item.user || "Caja"}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Mobile: modal de "Últimos movimientos" — mismos datos y lógica que
          la sección de escritorio (filteredMovements/movementQuery), solo
          cambia dónde se muestran en mobile: acá, con scroll interno. */}
      {movementsModalOpen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/70 p-3 backdrop-blur-sm sm:hidden"
          onClick={() => setMovementsModalOpen(false)}
        >
          {/* Anclado arriba (no como bottom sheet): sin mt-auto, el panel
              queda pegado al top con un margen chico parejo alrededor.
              useBodyScrollLock arriba bloquea el scroll de fondo mientras
              está abierto y restaura el scrollY exacto al cerrar — evita
              los saltos/huecos negros que aparecían antes. */}
          <div
            className="flex max-h-full w-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(12,16,30,0.98),rgba(5,7,16,0.99))] shadow-[0_30px_100px_-45px_rgba(139,92,246,0.4)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-4 border-b border-white/[0.065] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid size-10 place-items-center rounded-2xl bg-violet-500/12 text-violet-200 ring-1 ring-violet-300/18">
                    <ArrowRight className="size-5" />
                  </div>
                  <div className="text-lg font-bold text-white">
                    Últimos movimientos{" "}
                    <span className="text-white/35">·</span>{" "}
                    <span className="text-white/55">{inventoryMovements.length}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMovementsModalOpen(false)}
                  className="grid size-8 shrink-0 place-items-center rounded-full text-white/50 transition active:bg-white/10 active:text-white"
                  aria-label="Cerrar"
                >
                  <X className="size-4" />
                </button>
              </div>
              <SearchBox
                value={movementQuery}
                onChange={setMovementQuery}
                placeholder="Buscar movimiento"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
              {data.loading ? (
                <InventoryMovementSkeletonMobile />
              ) : filteredMovements.length === 0 ? (
                <div className="py-16 text-center text-sm text-white/45">
                  Sin movimientos.
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {filteredMovements.map((item: InventoryMovement) => (
                    <div
                      key={`mobile-${item.id}`}
                      className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
                          {formatInventoryDate(item.created_at)}
                        </span>
                        <span
                          className={cn(
                            "inline-flex w-fit rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1",
                            movementTypeClass(item.type),
                          )}
                        >
                          {item.type}
                        </span>
                      </div>
                      <div className="mt-1.5 truncate font-semibold text-white">
                        {item.product}
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "font-bold tabular-nums",
                            item.qty >= 0 ? "text-emerald-300" : "text-rose-300",
                          )}
                        >
                          {qtyText(item.qty)}
                        </span>
                        <span className="text-white/60">{stockFlow(item)}</span>
                        <span className="truncate text-white/50">{item.user || "Caja"}</span>
                      </div>
                      {item.withdrawnKind && (
                        <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                          <span
                            className={cn(
                              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ring-1",
                              withdrawKindClass(item.withdrawnKind),
                            )}
                          >
                            {withdrawKindLabel(item)}
                          </span>
                          <span className="truncate text-white/60">{item.withdrawnBy}</span>
                          {Boolean(item.unitPrice) && (
                            <span className="ml-auto shrink-0 text-white/45">
                              ${(Number(item.unitPrice) * Math.abs(item.qty)).toLocaleString("es-AR")}
                            </span>
                          )}
                        </div>
                      )}
                      {item.note && (
                        <div className="mt-1 truncate text-white/50">{item.note}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {stockAdjustment && typeof document !== "undefined" && createPortal(
        (() => {
          const isOut = stockAdjustment.direction === "out";
          const stockMax = stockNumber(stockAdjustment.item);
          const qtyNum = Math.max(1, Number(adjustQty) || 1);
          const listUnitPrice = Number(stockAdjustment.item?.price ?? stockAdjustment.item?.cash_discount ?? 0) || 0;
          // Mismo criterio que confirmStockAdjustment: precio colaborador
          // solo con un profesional real elegido (nunca "Otro").
          const isCollaboratorEligible = Boolean(withdrawWho) && withdrawWho !== "__other__";
          const unitPrice = resolveStaffUnitPrice(stockAdjustment.item, listUnitPrice, isCollaboratorEligible);
          const hasStaffPrice = isCollaboratorEligible && (stockAdjustment.item?.staff_price_mode ?? "none") !== "none";
          const withdrawTotal = unitPrice * qtyNum;
          const fmtTotal = `$${withdrawTotal.toLocaleString("es-AR")}`;
          return (
            <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
              {/* max-h + overflow-y-auto en el body: aun compacto, en
                  pantallas muy chicas puede llegar a no entrar entero —
                  esto evita que el modal se corte contra los bordes del
                  viewport en vez de simplemente scrollear su contenido. */}
              <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(12,16,30,0.98),rgba(5,7,16,0.99))] shadow-[0_30px_100px_-45px_rgba(139,92,246,0.55)]">
                <div className="shrink-0 border-b border-white/[0.065] px-5 py-4">
                  <div className="text-lg font-bold text-white">
                    {isOut ? "Retirar stock" : "Agregar stock"}
                  </div>
                  {/* Stock a la derecha del nombre — antes vivía en una
                      tarjeta grande aparte más abajo, esto ahorra bastante
                      alto sin perder el dato. */}
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="truncate text-sm text-white/55">
                      {stockAdjustment.item?.name ?? "Producto"}
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-white/70">
                      Stock: {stockMax}
                    </span>
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
                  {isOut ? (
                    // Selector −/N/+, nunca teclado: la cantidad siempre es
                    // un entero entre 1 y el stock disponible, así que no
                    // hace falta (ni conviene) un input libre acá.
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                        Cantidad
                      </label>
                      <div className="mt-2 flex items-center justify-center gap-5">
                        <button
                          type="button"
                          onClick={() => setAdjustQty(String(Math.max(1, qtyNum - 1)))}
                          disabled={qtyNum <= 1}
                          className="grid size-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.035] text-2xl font-bold text-white transition active:bg-white/[0.08] disabled:opacity-30"
                        >
                          −
                        </button>
                        <span className="min-w-[2ch] text-center text-2xl font-extrabold tabular-nums text-white">
                          {qtyNum}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAdjustQty(String(Math.min(stockMax, qtyNum + 1)))}
                          disabled={qtyNum >= stockMax}
                          className="grid size-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.035] text-2xl font-bold text-white transition active:bg-white/[0.08] disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                        Cantidad
                      </label>
                      <input
                        value={adjustQty}
                        onChange={(event) => setAdjustQty(event.target.value)}
                        type="number"
                        min={1}
                        autoFocus
                        placeholder="Cantidad a agregar"
                        // text-base (16px): con autoFocus, este input se
                        // enfoca apenas se toca "+" para abrir el modal —
                        // con menos de 16px, iOS hace zoom automático de la
                        // pantalla entera al enfocar. Mismo fix ya aplicado
                        // en login/Nuevo gasto.
                        className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 text-base font-semibold text-white outline-none placeholder:text-white/35 focus:border-violet-300/35 focus:ring-2 focus:ring-violet-400/12"
                      />
                    </div>
                  )}

                  {isOut && (
                    <>
                      {/* Quién retira: gente real de Equipo (data.employees,
                          sin opciones genéricas como "Recepción") + "Otro"
                          al final — sin texto libre: "Otro" alcanza para
                          cubrir cualquier caso sin persona/liquidación
                          asociada (invitado, proveedor, limpieza, o un
                          ajuste de stock puro vía "Cómo se registra"). */}
                      <div>
                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                          Quién retira
                        </label>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {data.employees.map((emp) => (
                            <button
                              key={emp.id}
                              type="button"
                              onClick={() => {
                                setWithdrawWho(emp.id);
                                setWithdrawMode("");
                              }}
                              className={withdrawChipClass(withdrawWho === emp.id)}
                            >
                              {emp.name}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              setWithdrawWho("__other__");
                              setWithdrawMode("");
                            }}
                            className={withdrawChipClass(withdrawWho === "__other__")}
                          >
                            Otro
                          </button>
                        </div>
                      </div>

                      {/* Cómo se registra: recién visible con "quién"
                          elegido — progresivo, no todo junto. Con "Otro":
                          Pagar ahora / Cortesía / Ajuste de stock (nunca
                          Adelanto, no hay profesional/liquidación a la que
                          asociarlo). Con un profesional real: Pagar ahora /
                          Anotar como adelanto / Cortesía (nunca Ajuste de
                          stock, ese caso siempre es "Otro"). El total
                          ($unitPrice × cantidad) se ve en todas salvo
                          Ajuste de stock (no es una transacción de valor),
                          tachado en Cortesía para dejar registrado cuánto
                          valía sin cobrarlo. */}
                      {withdrawWho && (
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                              ¿Cómo se registra?
                            </label>
                            {hasStaffPrice && (
                              <span className="rounded-full border border-violet-300/35 bg-violet-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-200">
                                Precio colaborador
                              </span>
                            )}
                          </div>
                          <div className="mt-2 space-y-1.5">
                            <button
                              type="button"
                              onClick={() => setWithdrawMode("pay")}
                              className={withdrawModeClass(withdrawMode === "pay", "emerald")}
                            >
                              <span>Pagar ahora</span>
                              <span className="tabular-nums">{fmtTotal}</span>
                            </button>
                            {withdrawWho !== "__other__" && (
                              <button
                                type="button"
                                onClick={() => setWithdrawMode("advance")}
                                className={withdrawModeClass(withdrawMode === "advance", "amber")}
                              >
                                <span>Anotar como adelanto</span>
                                <span className="tabular-nums">{fmtTotal}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setWithdrawMode("courtesy")}
                              className={withdrawModeClass(withdrawMode === "courtesy", "sky")}
                            >
                              <span>Cortesía</span>
                              <span className="tabular-nums text-white/40 line-through">{fmtTotal}</span>
                            </button>
                            {withdrawWho === "__other__" && (
                              <button
                                type="button"
                                onClick={() => setWithdrawMode("adjust")}
                                className={withdrawModeClass(withdrawMode === "adjust", "slate")}
                              >
                                <span>Ajuste de stock</span>
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Método de pago: solo si se eligió "Pagar ahora" —
                          ni un hueco vacío ni el título aparecen para
                          Adelanto/Cortesía, se saltea directo. */}
                      {withdrawMode === "pay" && (
                        <div>
                          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                            Método de pago
                          </label>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setWithdrawPayMethod("cash")}
                              className={withdrawModeClass(withdrawPayMethod === "cash", "emerald")}
                            >
                              Efectivo
                            </button>
                            <button
                              type="button"
                              onClick={() => setWithdrawPayMethod("transfer")}
                              className={withdrawModeClass(withdrawPayMethod === "transfer", "emerald")}
                            >
                              Transferencia
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Nota: solo en "Agregar stock" — el flujo de retiro ya
                      no la necesita (quién retira + cómo se registra
                      reemplazan el texto libre como forma de dejar
                      constancia del motivo). */}
                  {!isOut && (
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                        Nota
                      </label>
                      <textarea
                        value={adjustNote}
                        onChange={(event) => setAdjustNote(event.target.value)}
                        rows={2}
                        placeholder="Motivo del movimiento, proveedor, corrección, etc."
                        className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-base text-white outline-none placeholder:text-white/35 focus:border-violet-300/35 focus:ring-2 focus:ring-violet-400/12"
                      />
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 justify-end gap-3 border-t border-white/[0.065] p-5 pt-4">
                  <button
                    type="button"
                    onClick={() => setStockAdjustment(null)}
                    className="rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-3 text-sm font-bold text-white/70 transition hover:bg-white/[0.07] hover:text-white"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={confirmStockAdjustment}
                    disabled={
                      Boolean(adjustingId) ||
                      (isOut &&
                        (!withdrawWho ||
                          !withdrawMode ||
                          (withdrawMode === "pay" && !withdrawPayMethod)))
                    }
                    className={cn(
                      "rounded-2xl px-5 py-3 text-sm font-bold transition disabled:opacity-50",
                      isOut
                        ? "bg-rose-500/12 text-rose-200 ring-1 ring-rose-400/24 shadow-[0_0_26px_rgba(244,63,94,0.20)] hover:bg-rose-500/18"
                        : "bg-emerald-400/12 text-emerald-200 ring-1 ring-emerald-400/24 shadow-[0_0_26px_rgba(16,185,129,0.22)] hover:bg-emerald-400/18",
                    )}
                  >
                    {/* "Aceptar" siempre en Retirar, sin importar el modo
                        elegido — nunca "Retirar" ni el monto en el botón. */}
                    {adjustingId ? "Guardando…" : isOut ? "Aceptar" : "Agregar"}
                  </button>
                </div>
              </div>
            </div>
          );
        })(),
        document.body,
      )}
    </div>
  );
}

const LIQUIDACION_ANTERIOR_INFO_TEXT =
  "Comisiones de períodos anteriores que todavía no fueron pagadas.";
const COMISIONES_NUEVAS_INFO_TEXT =
  "Comisiones generadas desde la última liquidación hasta ahora.";
const ADELANTOS_INFO_TEXT =
  "Dinero adelantado al profesional. Se descuenta del total a pagar.";

// Lista editable de ajustes o deducciones (importe + motivo) dentro del
// modal "Pagar" — compacta a propósito: sin fila vacía por default (solo
// aparecen las que el usuario agregó) y sin una tarjeta grande por fila,
// para que el modal no crezca de más apenas se suman un par de ítems.
function SettlementItemsEditor({
  items,
  onChange,
  addLabel,
  reasonPlaceholder,
  formatThousands,
  accentClass,
}: {
  items: { id: string; amount: string; reason: string }[];
  onChange: (items: { id: string; amount: string; reason: string }[]) => void;
  addLabel: string;
  reasonPlaceholder: string;
  formatThousands: (digits: string) => string;
  accentClass: string;
}) {
  function addItem() {
    onChange([...items, { id: crypto.randomUUID(), amount: "", reason: "" }]);
  }
  function updateItem(id: string, patch: Partial<{ amount: string; reason: string }>) {
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function removeItem(id: string) {
    onChange(items.filter((it) => it.id !== id));
  }

  return (
    <div className="space-y-1.5">
      {items.map((item) => {
        const incomplete = Number(item.amount || 0) > 0 && !item.reason.trim();
        return (
          <div key={item.id}>
            <div className="flex items-center gap-1.5">
              <input
                value={item.reason}
                onChange={(e) => updateItem(item.id, { reason: e.target.value })}
                placeholder={reasonPlaceholder}
                maxLength={140}
                className="h-8 min-w-0 flex-[2] rounded-lg border border-white/[0.08] bg-black/25 px-2.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-white/25"
              />
              <div className="relative w-20 shrink-0">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-white/45">
                  $
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatThousands(item.amount)}
                  onChange={(e) => updateItem(item.id, { amount: e.target.value.replace(/\D/g, "") })}
                  placeholder="0"
                  className="h-8 w-full rounded-lg border border-white/[0.08] bg-black/25 pl-4 pr-1.5 text-right text-xs font-bold tabular-nums text-white outline-none focus:border-white/25"
                />
              </div>
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/40 transition hover:text-rose-300"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            {incomplete && <div className="px-1 text-[10px] text-rose-300">Falta el motivo para este importe.</div>}
          </div>
        );
      })}
      <button
        type="button"
        onClick={addItem}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition",
          accentClass,
        )}
      >
        <Plus className="size-3" /> {addLabel}
      </button>
    </div>
  );
}

// Nuestros propios raise exception en las RPC de liquidaciones (motivo
// faltante, total negativo, etc.) llegan con code "P0001" y ya son texto
// en español pensado para mostrarse tal cual. Cualquier otro error
// (función no encontrada, columna inexistente, red) es jerga técnica que
// no debería llegar al usuario final — se loguea completo en consola
// para diagnóstico y se muestra un mensaje corto en su lugar.
function friendlyRpcError(e: unknown, fallback: string) {
  console.error(fallback, e);
  const code = (e as { code?: string } | null)?.code;
  const message = (e as Error)?.message;
  if (code === "P0001" && message) return message;
  return fallback;
}

function ProfesionalesTab({
  businessId,
  chargedByName,
  data,
}: {
  businessId: string | null;
  chargedByName: string;
  data: ReturnType<typeof useCajaData>;
}) {
  // Antes esta pestaña llamaba a su propia useCajaData(), que vuelve a
  // pedir todo (servicios, empleados, pagos, gastos) cada vez que se monta
  // — es decir, cada vez que se entraba a Liquidaciones. Eso arrancaba
  // siempre en loading=true, tapando el contenido con "Cargando…" y
  // volviendo a mostrarlo apenas terminaba: el parpadeo del fondo/glow que
  // se reportó. Ahora reutiliza el `data` que ya cargó CashRegisterPage
  // (mismo patrón que ya usa CierresTab), sin ningún fetch redundante.
  // cajaDateKeyBA, no toLocaleDateString("sv-SE") del huso LOCAL del
  // navegador: el negocio opera en Argentina sin importar desde dónde se
  // abra Caja — mismo criterio que ya usa el resto de la pantalla (Resumen,
  // ver cajaDateKeyBA más abajo).
  const today = React.useMemo(() => cajaDateKeyBA(), []);
  // Liquidaciones trabaja siempre sobre un único profesional — nunca
  // "todos" — así que arranca vacío y un efecto más abajo lo completa en
  // cuanto hay empleados: el último consultado (persistido por negocio) o,
  // si es la primera vez, el primero disponible.
  const [selectedEmployeeId, setSelectedEmployeeId] = React.useState<string>("");
  // El corte ya no se elige a mano — siempre es "ahora". Este estado solo
  // controla si el modal informativo (calendario de solo lectura) está
  // abierto, y qué mes muestra.
  const [periodInfoOpen, setPeriodInfoOpen] = React.useState(false);
  const [calendarMonth, setCalendarMonth] = React.useState(
    () => new Date(`${today}T12:00:00`),
  );
  // Detalle expandible de una liquidación del Historial: qué run se está
  // viendo (null = cerrado) y sus servicios, pedidos bajo demanda porque
  // no viven en settlement_runs — mismo query que ya usa "Mis
  // liquidaciones" del profesional (fetchSettlementRunServices).
  const [historialDetailRun, setHistorialDetailRun] = React.useState<any | null>(null);
  const [historialDetailMovementNumber, setHistorialDetailMovementNumber] = React.useState<number | null>(null);
  const [historialDetailServices, setHistorialDetailServices] = React.useState<any[] | null>(null);
  const [loadingHistorialDetail, setLoadingHistorialDetail] = React.useState(false);
  // Detalle de un ajuste/deducción del Historial — tampoco necesita fetch
  // (ya vienen completos con sus items dentro del movimiento derivado).
  const [historialDetailAjuste, setHistorialDetailAjuste] = React.useState<MovimientoAjuste | null>(null);
  const [historialDetailDeduccion, setHistorialDetailDeduccion] = React.useState<MovimientoDeduccion | null>(null);
  const [loadingCommissions, setLoadingCommissions] = React.useState(true);
  const [loadingRuns, setLoadingRuns] = React.useState(true);
  // Errores reales (no silenciados en $0): si la query falla (RLS, columna
  // faltante, etc.), se muestra acá en vez de quedar solo en la consola —
  // "todo en $0" tiene que distinguirse de "no hay datos" de un error real.
  const [commissionsError, setCommissionsError] = React.useState<string | null>(null);
  const [runsError, setRunsError] = React.useState<string | null>(null);
  const [loadingTips, setLoadingTips] = React.useState(true);
  const [tipsError, setTipsError] = React.useState<string | null>(null);
  const [preparingRunFor, setPreparingRunFor] = React.useState<string | null>(null);
  const [paymentForm, setPaymentForm] = React.useState({
    amount: "",
    method: "transfer",
    note: "",
  });
  // Mientras el usuario no haya tocado "Monto a pagar" a mano, se mantiene
  // sincronizado con el total final (que cambia en vivo al agregar
  // adicionales/deducciones) — apenas lo edita una vez, deja de
  // autocompletarse para no pisarle un pago parcial intencional.
  const [paymentAmountTouched, setPaymentAmountTouched] = React.useState(false);
  // Pago múltiple del modal Pagar: mismo componente/lógica que "Pago
  // múltiple" en Nueva venta (MultiMethodPaymentSplit), pero acá si se
  // permite pago parcial (la suma no tiene por qué llegar al total).
  const [paymentMode, setPaymentMode] = React.useState<"simple" | "multiple">("simple");
  const [paymentSplits, setPaymentSplits] = React.useState<MultiSplit[]>([{ method: "cash", amount: "" }]);
  // Ajustes/deducciones itemizados: cada uno es un importe + un motivo
  // (obligatorio si el importe es > $0), preservados tal cual en el
  // comprobante/historial — reemplaza los dos campos numéricos sueltos de
  // antes. El id es solo para la key de React, se descarta al confirmar.
  const [adjustmentItems, setAdjustmentItems] = React.useState<
    { id: string; amount: string; reason: string }[]
  >([]);
  const [deductionItems, setDeductionItems] = React.useState<
    { id: string; amount: string; reason: string }[]
  >([]);
  const [liquidarModalOpen, setLiquidarModalOpen] = React.useState(false);
  // "" = hoy/ahora (el default de siempre). Se elige desde la tarjeta
  // "Período actual" (línea "Hasta"), no desde el modal de Pagar —
  // por eso NO se resetea al cerrar ese modal (resetLiquidarForm), solo
  // al cambiar de profesional, para que la elección quede guardada
  // entre aperturas del modal.
  const [liquidarCutoffDate, setLiquidarCutoffDate] = React.useState("");

  function resetLiquidarForm() {
    setAdjustmentItems([]);
    setDeductionItems([]);
    setLiquidarModalOpen(false);
    setPaymentForm({ amount: "", method: "transfer", note: "" });
    setPaymentAmountTouched(false);
    setPaymentMode("simple");
    setPaymentSplits([{ method: "cash", amount: "" }]);
  }

  const [adelantoModalOpen, setAdelantoModalOpen] = React.useState(false);
  const [adelantoForm, setAdelantoForm] = React.useState({
    amount: "",
    method: "efectivo",
    note: "",
  });
  const [registeringAdvance, setRegisteringAdvance] = React.useState(false);

  function resetAdelantoForm() {
    setAdelantoModalOpen(false);
    setAdelantoForm({ amount: "", method: "efectivo", note: "" });
  }

  const [deletingAdvanceId, setDeletingAdvanceId] = React.useState<string | null>(null);

  async function handleDeleteAdvance(advanceId: string, amount: number) {
    if (deletingAdvanceId || !businessId) return;
    const confirmed = window.confirm(
      `¿Eliminar este adelanto de ${money(amount)}? No se puede deshacer.`,
    );
    if (!confirmed) return;
    setDeletingAdvanceId(advanceId);
    try {
      await deleteProfessionalAdvance(advanceId, businessId);
      toast.success("Adelanto eliminado");
      setCommissionsVersion((v) => v + 1);
    } catch (e) {
      toast.error((e as Error).message || "No se pudo eliminar el adelanto");
    } finally {
      setDeletingAdvanceId(null);
    }
  }
  // commission_records: fuente de verdad de cuánto se le debe a cada
  // profesional. Las que ya tienen settlement_run_id están "bloqueadas"
  // dentro de una liquidación preparada; las que no, son las que entrarían
  // como "comisiones nuevas" en la próxima liquidación. settlement_runs es
  // el lote preparado (inmutable) y settlement_payments los pagos contra
  // cada uno.
  const [allCommissions, setAllCommissions] = React.useState<any[]>([]);
  // tip_records: mismo patrón que commission_records pero SIEMPRE sumado
  // aparte — "Comisiones generadas" y "Propinas" nunca se mezclan en una
  // sola cifra, ni acá ni en prepare_settlement_run (ver migración
  // 20260927010000_tips_system.sql).
  const [allTips, setAllTips] = React.useState<any[]>([]);
  // Eventos de cobro de pendientes (commission_collection_events/
  // tip_collection_events) — sin esto, allCommissions/allTips por sí solos
  // NO alcanzan para saber cuánto hay realmente disponible de una venta
  // pendiente/parcial (ver bug real de Daniel, 24/10/2026: se mostraba
  // pending_amount completo, plata todavía sin cobrar, como si estuviera
  // disponible). sale_id de cada fila de allCommissions/allTips mapea 1:1
  // a su id, así que acá solo guardamos los eventos crudos y la
  // atribución a professional_id se arma más abajo (commissionRecordProById).
  const [allCommissionEvents, setAllCommissionEvents] = React.useState<any[]>([]);
  const [allTipEvents, setAllTipEvents] = React.useState<any[]>([]);
  const [allRuns, setAllRuns] = React.useState<any[]>([]);
  const [allRunPayments, setAllRunPayments] = React.useState<any[]>([]);
  const [allAdvances, setAllAdvances] = React.useState<any[]>([]);
  const [commissionsVersion, setCommissionsVersion] = React.useState(0);

  // Red de seguridad además de Realtime (ver canal de postgres_changes más
  // abajo): si la pestaña estuvo en background o la conexión de Realtime
  // se cortó un instante, volver a esta pestaña siempre refresca —
  // bumpear commissionsVersion solo repite los mismos SELECT de siempre,
  // nunca inserta ni duplica nada.
  React.useEffect(() => {
    function onFocus() {
      setCommissionsVersion((v) => v + 1);
    }
    function onVisibility() {
      if (document.visibilityState === "visible") onFocus();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const money = React.useCallback(
    (value: number) => `$${Math.round(value).toLocaleString("es-AR")}`,
    [],
  );
  // Formatea dígitos crudos con separador de miles ("20000" -> "20.000")
  // mientras se escribe — mismo patrón que precios en Precios/Catálogo.
  const formatThousands = React.useCallback((digits: string) => {
    const n = Number(digits);
    return digits && Number.isFinite(n) ? n.toLocaleString("es-AR") : "";
  }, []);

  // Ya no se auto-selecciona ningún profesional: el selector arranca en
  // "Seleccionar profesional" y se queda ahí hasta que el usuario elige
  // uno a mano. Este efecto solo limpia la selección si el profesional
  // elegido deja de existir en la lista (ej. se lo dio de baja).
  React.useEffect(() => {
    if (!selectedEmployeeId) return;
    const employees = data.employees ?? [];
    const stillValid = employees.some(
      (employee: any) => String(employee.id) === selectedEmployeeId,
    );
    if (!stillValid) setSelectedEmployeeId("");
  }, [data.employees, selectedEmployeeId]);

  // Todas las comisiones del negocio (bloqueadas o no en algún run): el
  // saldo pendiente TOTAL de cada profesional sale de acá, nunca de un
  // rango de fechas. Las que tienen settlement_run_id null y created_at
  // posterior a la última liquidación son las "comisiones nuevas"
  // candidatas a la próxima.
  React.useEffect(() => {
    let cancelled = false;
    async function loadCommissions() {
      if (!businessId) {
        if (!cancelled) {
          setAllCommissions([]);
          setLoadingCommissions(false);
        }
        return;
      }
      setLoadingCommissions(true);
      try {
        // fetchAllRows: sin esto, un negocio con más de 1000
        // commission_records (límite default de PostgREST) perdía filas en
        // silencio — Caja > Liquidaciones terminaba mostrando comisiones
        // pendientes de menos, sin ningún error visible.
        const rows = await fetchAllRows((from, to) =>
          supabase
            .from("commission_records" as any)
            .select(
              "id,professional_id,amount,paid_amount,pending_amount,status,sale_date,created_at,commission_pct,settlement_run_id,sale_id",
            )
            .eq("business_id", businessId)
            .order("id", { ascending: true })
            .range(from, to),
        );
        // resolveOperativeDates solo sobre las NO liquidadas (settlement_run_id
        // null): son las únicas cuya fecha importa para algún cálculo (las ya
        // liquidadas se excluyen por settlement_run_id, nunca por fecha) —
        // evita pedirle a Supabase los payments de TODO el historial del
        // negocio (fetchAllRows puede traer miles de filas viejas).
        const unsettled = rows.filter((r: any) => !r.settlement_run_id);
        const settled = rows.filter((r: any) => r.settlement_run_id);
        const resolvedUnsettled = await resolveOperativeDates(unsettled);
        if (!cancelled) {
          setAllCommissions([...resolvedUnsettled, ...settled]);
          setCommissionsError(null);
        }
      } catch (e) {
        const message = (e as Error).message;
        if (!cancelled) {
          setAllCommissions([]);
          setCommissionsError(message);
        }
        console.warn("[caja] no se pudieron cargar las comisiones:", message);
        toast.error(`No se pudieron cargar las comisiones: ${message}`);
      } finally {
        if (!cancelled) setLoadingCommissions(false);
      }
    }
    loadCommissions();
    return () => {
      cancelled = true;
    };
  }, [businessId, commissionsVersion]);

  // Todas las propinas del negocio (bloqueadas o no) — misma forma que
  // commission_records, tabla separada. Fetch con su propio try/catch: si
  // la migración de propinas todavía no corrió (tabla inexistente), no
  // tira abajo comisiones/liquidaciones que sí cargaron bien.
  React.useEffect(() => {
    let cancelled = false;
    async function loadTips() {
      if (!businessId) {
        if (!cancelled) {
          setAllTips([]);
          setLoadingTips(false);
        }
        return;
      }
      setLoadingTips(true);
      try {
        const rows = await fetchAllRows((from, to) =>
          supabase
            .from("tip_records" as any)
            .select(
              "id,professional_id,amount,paid_amount,pending_amount,status,sale_date,created_at,settlement_run_id,sale_id",
            )
            .eq("business_id", businessId)
            .order("id", { ascending: true })
            .range(from, to),
        );
        // Mismo criterio que allCommissions: solo resuelve fecha real en las
        // no liquidadas, nunca en todo el historial.
        const unsettled = rows.filter((r: any) => !r.settlement_run_id);
        const settled = rows.filter((r: any) => r.settlement_run_id);
        const resolvedUnsettled = await resolveOperativeDates(unsettled);
        if (!cancelled) {
          setAllTips([...resolvedUnsettled, ...settled]);
          setTipsError(null);
        }
      } catch (e) {
        const message = (e as Error).message;
        if (!cancelled) {
          setAllTips([]);
          setTipsError(message);
        }
        console.warn("[caja] no se pudieron cargar las propinas:", message);
      } finally {
        if (!cancelled) setLoadingTips(false);
      }
    }
    loadTips();
    return () => {
      cancelled = true;
    };
  }, [businessId, commissionsVersion]);

  // Eventos de cobro de pendientes — un renglón por cobro real contra una
  // venta que nació pendiente/parcial (ver 20261023010000_pending_payments_schema.sql).
  // Sin liquidar todavía (settlement_run_id null) o ya liquidados, los dos
  // casos hacen falta: computeLiquidacionSummary filtra los sin liquidar
  // para "nuevo disponible"; openDetail usa los sin liquidar para listar
  // qué ventas pendientes aportan algo a la próxima liquidación.
  React.useEffect(() => {
    let cancelled = false;
    async function loadEvents() {
      if (!businessId) {
        if (!cancelled) {
          setAllCommissionEvents([]);
          setAllTipEvents([]);
        }
        return;
      }
      try {
        const [cceRows, tceRows] = await Promise.all([
          fetchAllRows((from, to) =>
            supabase
              .from("commission_collection_events" as any)
              .select("id,commission_record_id,amount,collected_at,settlement_run_id")
              .eq("business_id", businessId)
              .order("id", { ascending: true })
              .range(from, to),
          ),
          fetchAllRows((from, to) =>
            supabase
              .from("tip_collection_events" as any)
              .select("id,tip_record_id,amount,collected_at,settlement_run_id")
              .eq("business_id", businessId)
              .order("id", { ascending: true })
              .range(from, to),
          ),
        ]);
        if (!cancelled) {
          setAllCommissionEvents(cceRows);
          setAllTipEvents(tceRows);
        }
      } catch (e) {
        if (!cancelled) {
          setAllCommissionEvents([]);
          setAllTipEvents([]);
        }
        console.warn("[caja] no se pudieron cargar los eventos de cobro:", (e as Error).message);
      }
    }
    loadEvents();
    return () => {
      cancelled = true;
    };
  }, [businessId, commissionsVersion]);

  // Todas las liquidaciones (settlement_runs) y sus pagos (settlement_payments).
  React.useEffect(() => {
    let cancelled = false;
    async function loadRuns() {
      if (!businessId) {
        if (!cancelled) {
          setAllRuns([]);
          setAllRunPayments([]);
          setLoadingRuns(false);
        }
        return;
      }
      setLoadingRuns(true);
      try {
        const [runs, runPayments] = await Promise.all([
          fetchAllRows((from, to) =>
            supabase
              .from("settlement_runs" as any)
              .select(
                "id,professional_id,professional_name,run_number,cutoff_date,period_start,period_start_at,previous_settlement_run_id,previous_balance,new_commissions,new_tips,adjustments,deductions,advances,adjustment_items,deduction_items,adjustment_movement_number,adjustment_movement_id,deduction_movement_number,deduction_movement_id,total_to_settle,amount_paid,service_count,total_sold,status,prepared_by_name,prepared_at",
              )
              .eq("business_id", businessId)
              .order("id", { ascending: true })
              .range(from, to),
          ),
          fetchAllRows((from, to) =>
            supabase
              .from("settlement_payments" as any)
              .select(
                "id,settlement_run_id,professional_id,amount,payment_method,note,balance_before,balance_after,paid_by_name,paid_at,movement_number",
              )
              .eq("business_id", businessId)
              .order("id", { ascending: true })
              .range(from, to),
          ),
        ]);
        if (!cancelled) {
          // Orden de presentación (más reciente primero) — fetchAllRows
          // pagina por id para que la paginación sea estable, así que se
          // reordena acá recién con todo ya traído.
          setAllRuns([...runs].sort((a: any, b: any) => String(b.cutoff_date ?? "").localeCompare(String(a.cutoff_date ?? ""))));
          setAllRunPayments(
            [...runPayments].sort((a: any, b: any) => String(b.paid_at ?? "").localeCompare(String(a.paid_at ?? ""))),
          );
          setRunsError(null);
        }
      } catch (e) {
        const message = (e as Error).message;
        if (!cancelled) {
          setAllRuns([]);
          setAllRunPayments([]);
          setRunsError(message);
        }
        console.warn("[caja] no se pudieron cargar las liquidaciones:", message);
        toast.error(`No se pudieron cargar las liquidaciones: ${message}`);
      } finally {
        if (!cancelled) setLoadingRuns(false);
      }
    }
    loadRuns();
    return () => {
      cancelled = true;
    };
  }, [businessId, commissionsVersion]);

  // Adelantos (professional_advances) — fetch aparte y con su propio
  // try/catch: si la migración todavía no corrió en producción (tabla
  // inexistente), no debe tirar abajo runs/payments que sí cargaron bien.
  React.useEffect(() => {
    let cancelled = false;
    async function loadAdvances() {
      if (!businessId) {
        if (!cancelled) setAllAdvances([]);
        return;
      }
      try {
        const rows = await fetchAllRows((from, to) =>
          supabase
            .from("professional_advances" as any)
            .select(
              "id,professional_id,amount,payment_method,note,advanced_at,registered_by_name,settlement_run_id,movement_number",
            )
            .eq("business_id", businessId)
            .order("id", { ascending: true })
            .range(from, to),
        );
        if (!cancelled) {
          setAllAdvances(
            [...rows].sort((a: any, b: any) => String(b.advanced_at ?? "").localeCompare(String(a.advanced_at ?? ""))),
          );
        }
      } catch (e) {
        if (!cancelled) setAllAdvances([]);
        console.warn("[caja] no se pudieron cargar los adelantos:", (e as Error).message);
      }
    }
    loadAdvances();
    return () => {
      cancelled = true;
    };
  }, [businessId, commissionsVersion]);

  // Tiempo real: si se prepara/paga una liquidación desde otra pestaña/
  // dispositivo (o Profesionales, que usa las mismas tablas), este panel
  // se actualiza solo.
  React.useEffect(() => {
    if (!businessId) return;
    const channel = supabase
      .channel(`caja-liquidaciones-${businessId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "commission_records", filter: `business_id=eq.${businessId}` },
        () => setCommissionsVersion((v) => v + 1),
      )
      .on(
        // tip_records nunca estuvo acá — cobrar una propina no actualizaba
        // esta pantalla sin recargar, aunque el Panel del profesional (que sí
        // escucha esta tabla, ver use-professionals-data.ts) se actualizaba
        // solo. Mismo patrón que el resto de este canal.
        "postgres_changes",
        { event: "*", schema: "public", table: "tip_records", filter: `business_id=eq.${businessId}` },
        () => setCommissionsVersion((v) => v + 1),
      )
      .on(
        // Un cobro de pendiente (Cobrar pendiente) inserta acá — sin esto,
        // "Comisiones generadas" quedaba desactualizado hasta un refresh
        // manual después de cobrar un saldo parcial/total.
        "postgres_changes",
        { event: "*", schema: "public", table: "commission_collection_events", filter: `business_id=eq.${businessId}` },
        () => setCommissionsVersion((v) => v + 1),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tip_collection_events", filter: `business_id=eq.${businessId}` },
        () => setCommissionsVersion((v) => v + 1),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "settlement_runs", filter: `business_id=eq.${businessId}` },
        () => setCommissionsVersion((v) => v + 1),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "settlement_payments", filter: `business_id=eq.${businessId}` },
        () => setCommissionsVersion((v) => v + 1),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "professional_advances", filter: `business_id=eq.${businessId}` },
        () => setCommissionsVersion((v) => v + 1),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId]);

  // commission_collection_events/tip_collection_events no tienen
  // professional_id propio (solo commission_record_id/tip_record_id) —
  // estos dos mapas lo resuelven vía allCommissions/allTips, que ya
  // cargan {id, professional_id} de cada fila.
  const commissionRecordProById = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of allCommissions) m[c.id] = String(c.professional_id);
    return m;
  }, [allCommissions]);
  const tipRecordProById = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of allTips) m[t.id] = String(t.professional_id);
    return m;
  }, [allTips]);
  const allCommissionEventsAttributed = React.useMemo(
    () =>
      allCommissionEvents.map((e: any) => ({
        professional_id: commissionRecordProById[e.commission_record_id] ?? "",
        settlement_run_id: e.settlement_run_id,
        amount: Number(e.amount ?? 0),
        collected_at: e.collected_at,
      })),
    [allCommissionEvents, commissionRecordProById],
  );
  const allTipEventsAttributed = React.useMemo(
    () =>
      allTipEvents.map((e: any) => ({
        professional_id: tipRecordProById[e.tip_record_id] ?? "",
        settlement_run_id: e.settlement_run_id,
        amount: Number(e.amount ?? 0),
        collected_at: e.collected_at,
      })),
    [allTipEvents, tipRecordProById],
  );

  const rows = React.useMemo(() => {
    return (data.employees ?? []).map((employee: any) => {
      // Pendiente total: TODA la deuda real, sin importar si la comisión ya
      // quedó bloqueada dentro de una liquidación preparada — solo cambia
      // cuando se genera una comisión nueva o se registra un pago. No es
      // parte de computeLiquidacionSummary (ese es "nuevo desde la última
      // liquidación", esto es el total histórico sin filtro de período).
      const pending = allCommissions
        .filter((c: any) => String(c.professional_id) === String(employee.id))
        .reduce((sum: number, c: any) => sum + Number(c.pending_amount ?? 0), 0);

      const summary = computeLiquidacionSummary(
        String(employee.id),
        allCommissions,
        allTips,
        allRuns,
        allAdvances,
        allCommissionEventsAttributed,
        allTipEventsAttributed,
      );

      return {
        id: String(employee.id),
        name: employee.name ?? "Profesional",
        role: employee.role ?? employee.position ?? "Profesional",
        pending,
        previousBalance: summary.previousBalance,
        previousPeriodLabel: summary.previousPeriodLabel,
        newCommissions: summary.newCommissions,
        pendingAdvances: summary.pendingAdvances,
        periodStart: summary.periodStart,
        periodStartAt: summary.periodStartAt,
        latestRun: summary.latestRun,
        commissionPct: Number(employee.commission_pct ?? 0),
      };
    });
  }, [
    data.employees,
    allCommissions,
    allTips,
    allRuns,
    allAdvances,
    allCommissionEventsAttributed,
    allTipEventsAttributed,
  ]);

  const selectedRow = React.useMemo(() => {
    return rows.find((row) => row.id === selectedEmployeeId) ?? null;
  }, [rows, selectedEmployeeId]);

  // Sub-pestaña de Liquidaciones para el profesional elegido: Movimientos
  // (cuenta corriente abierta — pendiente/posterior al último corte) vs
  // Historial (liquidaciones ya pagadas, detalle completo) — mismo
  // patrón que Panel del profesional, ver LiquidacionesPanelView/
  // HistorialPanelView en professionals.tsx.
  const [liqSubTab, setLiqSubTab] = React.useState<"movimientos" | "historial">("movimientos");
  React.useEffect(() => {
    setLiqSubTab("movimientos");
  }, [selectedEmployeeId]);

  const totals = React.useMemo(() => {
    const source = selectedRow ? [selectedRow] : rows;
    return source.reduce(
      (acc, row) => ({
        previousBalance: acc.previousBalance + row.previousBalance,
        newCommissions: acc.newCommissions + row.newCommissions,
        pendingAdvances: acc.pendingAdvances + row.pendingAdvances,
        pending: acc.pending + row.pending,
      }),
      { previousBalance: 0, newCommissions: 0, pendingAdvances: 0, pending: 0 },
    );
  }, [rows, selectedRow]);
  // Redondeado (igual que money(), que hace Math.round para mostrar): un
  // resto de centavos no cuenta como "pendiente" para decidir si la
  // tarjeta "Comisiones pendientes" se muestra o no.
  const hasPendingPreviousBalance = Math.round(totals.previousBalance) > 0;

  // Ver detalle: desglose auditable de las comisiones que entrarían en la
  // próxima liquidación (bloqueadas o no, hasta el corte elegido). Se pide
  // bajo demanda (no en cada render) porque necesita el detalle de la
  // venta (cliente/servicio/método/descuento), que no vive en
  // commission_records.
  const [detailRows, setDetailRows] = React.useState<any[] | null>(null);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [detailError, setDetailError] = React.useState<string | null>(null);

  async function openDetail(professionalId: string) {
    setLoadingDetail(true);
    setDetailRows(null);
    setDetailError(null);
    try {
      const row = rows.find((r) => r.id === professionalId);
      // Sin filtro de fecha acá: commission_records.created_at es cuándo se
      // CREÓ la fila (congelado al cobrar, nunca se corrige), no la fecha
      // operativa real del pago — filtrar por corte/período en SQL contra
      // esa columna excluía mal ventas con la fecha corregida (ver
      // withOperativeDates/isWithinCutoff, abajo). El set ya está acotado a
      // lo NO liquidado de UN profesional (gt pending_amount, is
      // settlement_run_id null), así que traer todo y filtrar en cliente
      // por la fecha real es seguro en volumen.
      const { data: commissionRows, error } = await supabase
        .from("commission_records" as any)
        .select("id,amount,pending_amount,commission_pct,sale_date,created_at,status,sale_id,professional_id")
        .eq("business_id", businessId)
        .eq("professional_id", professionalId)
        .is("settlement_run_id", null)
        .gt("pending_amount", 0);
      if (error) throw error;

      // Eventos de cobro de pendientes sin liquidar de este profesional —
      // la plata real de una venta pendiente/parcial sale de acá, nunca de
      // su pending_amount crudo (bug real: Daniel, 24/10/2026 — se
      // mostraba pending_amount completo, incluyendo lo TODAVÍA NO
      // cobrado, como si estuviera disponible para esta liquidación).
      const recoveredEvents = allCommissionEvents.filter(
        (e: any) =>
          !e.settlement_run_id && commissionRecordProById[e.commission_record_id] === String(professionalId),
      );
      const saleIdByCommissionId: Record<string, string> = {};
      for (const c of allCommissions) saleIdByCommissionId[c.id] = c.sale_id;

      const saleIds = Array.from(
        new Set([
          ...(commissionRows ?? []).map((c: any) => c.sale_id),
          ...recoveredEvents.map((e: any) => saleIdByCommissionId[e.commission_record_id]),
        ]),
      ).filter(Boolean);
      let paymentsById: Record<string, any> = {};
      if (saleIds.length > 0) {
        const { data: pays, error: payError } = await supabase
          .from("payments" as any)
          .select(
            "id,client_name,service_name,total,amount,method,payment_method,created_at,discount,original_amount,promotion_id,promotion_name,tip_amount,items,notes,observations,status,collected_amount",
          )
          .in("id", saleIds);
        if (payError) throw payError;
        paymentsById = Object.fromEntries((pays ?? []).map((p: any) => [p.id, p]));
      }

      // Ventas pendientes/parciales NUNCA entran acá con su pending_amount
      // crudo — ver syntheticRecoveredRows más abajo, que las representa
      // correctamente (una fila por cobro real, con su propio monto y
      // fecha). Una venta ya totalmente cobrada por el flujo de
      // pendientes vuelve a status='cobrado' y sigue el camino normal
      // (pending_amount ya está en 0 para esa fila en ese punto, así que
      // ni siquiera llega hasta acá).
      const normalCommissionRows = (commissionRows ?? []).filter((c: any) => {
        const st = paymentsById[c.sale_id]?.status;
        return st !== "pendiente" && st !== "parcial";
      });
      const syntheticRecoveredRows = recoveredEvents.map((e: any) => {
        const original = allCommissions.find((c: any) => c.id === e.commission_record_id);
        return {
          id: `recovered-${e.id}`,
          amount: Number(e.amount ?? 0),
          pending_amount: Number(e.amount ?? 0),
          commission_pct: original?.commission_pct ?? null,
          sale_date: e.collected_at,
          created_at: e.collected_at,
          // Marcador para VentaRow (unified-row.tsx): esta fila representa
          // UN cobro puntual de una venta pendiente/parcial, nunca la
          // comisión completa de la venta — nunca "status" (ese campo ya
          // tiene un significado real en commission_records, pending/
          // partially_paid/paid/voided; no hay que pisarlo).
          __recovered: true,
          sale_id: saleIdByCommissionId[e.commission_record_id],
          professional_id: professionalId,
        };
      });
      const sourceRows = [...normalCommissionRows, ...syntheticRecoveredRows];
      // Fallback SOLO visual de "precio de lista" para ventas viejas que no
      // guardaron original_amount (de antes de que registerPayment lo
      // empezara a congelar siempre — ver register-payment.ts): precio
      // ACTUAL del catálogo. Puede no coincidir con el precio real de ese
      // día si cambió después — por eso nunca pisa un original_amount ya
      // guardado, es el último recurso. Dos caminos, no solo uno: por id de
      // payments.items (el normal) Y por nombre del servicio (respaldo —
      // cubre ventas donde el id del ítem guardado no matchea más un
      // price_catalog vigente, ej. catálogo recreado).
      const salesNeedingFallback = Object.values(paymentsById).filter(
        (p: any) => !(Number(p?.original_amount ?? 0) > 0),
      );
      const missingListPriceItemIds = Array.from(
        new Set(
          salesNeedingFallback
            .flatMap((p: any) => (Array.isArray(p?.items) ? p.items : []))
            .map((i: any) => i?.id)
            .filter(Boolean),
        ),
      );
      const missingListPriceNames = Array.from(
        new Set(salesNeedingFallback.map((p: any) => String(p?.service_name ?? "").trim()).filter(Boolean)),
      );
      let catalogPriceById: Record<string, number> = {};
      if (missingListPriceItemIds.length > 0) {
        const { data: catalogRows, error: catalogError } = await supabase
          .from("price_catalog" as any)
          .select("id,price")
          .in("id", missingListPriceItemIds);
        if (catalogError) throw catalogError;
        catalogPriceById = Object.fromEntries(
          (catalogRows ?? []).map((r: any) => [r.id, Number(r.price ?? 0)]),
        );
      }
      // Sin .in("name", ...): el match exacto por string rompía contra
      // ventas viejas cuyo service_name quedó grabado con otra
      // capitalización/espacios que el catálogo actual (ej. el servicio se
      // re-tipeó en Configuración → Servicios después de esas ventas) — con
      // el negocio entero en memoria, el match normalizado de abajo
      // (trim + lowercase) lo cubre sin depender de que coincida byte a
      // byte.
      let catalogPriceByName: Record<string, number> = {};
      if (missingListPriceNames.length > 0) {
        const { data: catalogByName, error: catalogByNameError } = await supabase
          .from("price_catalog" as any)
          .select("name,price")
          .eq("business_id", businessId);
        if (catalogByNameError) throw catalogByNameError;
        catalogPriceByName = Object.fromEntries(
          (catalogByName ?? []).map((r: any) => [normalizeServiceName(r.name), Number(r.price ?? 0)]),
        );
      }
      const periodStartAt = row?.periodStartAt ?? null;
      const enrichedRows = sourceRows.map((c: any) => {
        const sale = paymentsById[c.sale_id] ?? null;
        let listPriceFallback: number | null = null;
        if (sale && !(Number(sale.original_amount ?? 0) > 0)) {
          if (Array.isArray(sale.items) && sale.items.length > 0) {
            const sum = sale.items.reduce((s: number, i: any) => {
              const unitPrice = catalogPriceById[i?.id] ?? null;
              if (unitPrice == null) return s;
              return s + unitPrice * Number(i?.qty ?? 1);
            }, 0);
            if (sum > 0) listPriceFallback = sum;
          }
          if (listPriceFallback == null) {
            const byName = catalogPriceByName[normalizeServiceName(sale.service_name)] ?? null;
            if (byName != null && byName > 0) listPriceFallback = byName;
          }
        }
        // created_at pasa a ser la fecha operativa REAL (payment, o la de
        // la fila de comisión si no se pudo traer el payment) — un solo
        // lugar resuelve esto, todo lo demás (filtro de período/corte de
        // abajo, orden, <VentaRow> vía resolveVentaDate) lo hereda gratis.
        return {
          ...c,
          sale,
          listPriceFallback,
          created_at: resolveVentaDate({ created_at: c.created_at, sale, __recovered: c.__recovered }) ?? c.created_at,
        };
      });
      const filteredRows = enrichedRows
        .filter(
          (c: any) =>
            (!periodStartAt || String(c.created_at ?? "") > periodStartAt) &&
            isWithinCutoff(c.created_at, liquidarCutoffAt),
        )
        .sort((a: any, b: any) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
      setDetailRows(filteredRows);
    } catch (e) {
      const message = (e as Error).message;
      setDetailError(message);
      toast.error(`No se pudo cargar el detalle: ${message}`);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function openHistorialDetail(run: any, movementNumber: number | null = null) {
    setHistorialDetailRun(run);
    setHistorialDetailMovementNumber(movementNumber);
    setHistorialDetailServices(null);
    setLoadingHistorialDetail(true);
    try {
      // settlement_run_sales (snapshot completo: descuento/promo/propina)
      // primero — mismo criterio que Historial de liquidaciones. Solo cae a
      // fetchSettlementRunServices (4 campos, sin descuento/promo) si esa
      // tabla no tiene filas para este run (liquidación de antes de la
      // migración 20261010010000, o la tabla todavía sin migrar).
      let rows: any[] = [];
      try {
        rows = await fetchSettlementRunSales(run.id);
      } catch {
        rows = [];
      }
      if (rows.length === 0) {
        rows = await fetchSettlementRunServices(run.id);
      }
      setHistorialDetailServices(rows);
    } catch (e) {
      toast.error(`No se pudo cargar el detalle de la liquidación: ${(e as Error).message}`);
      setHistorialDetailServices([]);
    } finally {
      setLoadingHistorialDetail(false);
    }
  }

  const selectedRuns = React.useMemo(() => {
    if (!selectedRow) return [] as any[];
    return allRuns
      .filter((r: any) => String(r.professional_id) === selectedRow.id)
      .sort((a: any, b: any) => (a.cutoff_date < b.cutoff_date ? 1 : a.cutoff_date > b.cutoff_date ? -1 : 0));
  }, [allRuns, selectedRow]);

  const selectedRunPayments = React.useMemo(() => {
    if (!selectedRow) return [] as any[];
    return allRunPayments
      .filter((p: any) => String(p.professional_id) === selectedRow.id)
      .sort((a: any, b: any) => String(b.paid_at ?? "").localeCompare(String(a.paid_at ?? "")));
  }, [allRunPayments, selectedRow]);

  const selectedAdvances = React.useMemo(() => {
    if (!selectedRow) return [] as any[];
    return allAdvances
      .filter((a: any) => String(a.professional_id) === selectedRow.id)
      .sort((a: any, b: any) => String(b.advanced_at ?? "").localeCompare(String(a.advanced_at ?? "")));
  }, [allAdvances, selectedRow]);

  // Mismos métodos/orden que Nueva venta (PAYMENT_OPTIONS, fijo a nivel de
  // módulo) — "Pagar" usa exactamente las mismas opciones, método simple y
  // las filas de pago múltiple comparten esta lista.
  const paymentOptions = PAYMENT_OPTIONS;

  // Si el método por default (o el de la primera fila de pago múltiple) no
  // está habilitado para este negocio, cae al primero que sí lo esté —
  // mismo criterio que Nueva venta.
  React.useEffect(() => {
    if (!paymentOptions.some((m) => m.id === paymentForm.method)) {
      setPaymentForm((f) => ({ ...f, method: paymentOptions[0].id }));
    }
    setPaymentSplits((prev) =>
      prev.every((s) => paymentOptions.some((m) => m.id === s.method))
        ? prev
        : prev.map((s) => (paymentOptions.some((m) => m.id === s.method) ? s : { ...s, method: paymentOptions[0].id })),
    );
  }, [paymentOptions, paymentForm.method]);

  // Reloj para que liquidarCutoffAt (y todo lo que depende de "ahora")
  // se actualice solo cada minuto mientras el corte elegido sea "hoy".
  const [nowClock, setNowClock] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNowClock(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Corte elegido para "Pagar" — vacío (o == hoy) significa "ahora mismo"
  // (mismo comportamiento de siempre, se recalcula solo con nowClock). Si
  // se elige un día anterior, el corte pasa a ser las 23:59:59.999 de ESE
  // día: el día elegido queda completo adentro, lo generado desde el
  // día siguiente 00:00 en adelante queda pendiente para la próxima vez.
  const liquidarCutoffAt = React.useMemo(() => {
    if (!liquidarCutoffDate || liquidarCutoffDate === today) return nowClock;
    // dayBoundsBA: 23:59:59.999 del día elegido en huso Argentina EXPLÍCITO
    // (-03:00), no el de `new Date("YYYY-MM-DDT23:59:59.999")` sin offset
    // (eso lo interpreta el huso LOCAL del navegador — correcto por
    // casualidad solo si quien abre Caja está físicamente en Argentina).
    return dayBoundsBA(liquidarCutoffDate).end;
  }, [liquidarCutoffDate, today, nowClock]);

  // Liquidaciones ya cerradas (pagada o prácticamente saldadas, ver
  // isRunEffectivelySettled) — su pago, sus adelantos y sus ajustes/
  // deducciones pertenecen SOLO a la sub-pestaña Historial de acá en más
  // (ver liqSubTab/HistorialPanelView abajo), nunca a Movimientos — mismo
  // criterio que ya aplica Panel del profesional > Movimientos.
  const closedRunIds = React.useMemo(
    () => new Set(selectedRuns.filter((r: any) => isRunEffectivelySettled(r)).map((r: any) => r.id)),
    [selectedRuns],
  );
  // El corte elegido ("hasta" en Preparar liquidación) acota TODO lo que
  // se ve en Movimientos, no solo las tarjetas-resumen: un adelanto, pago
  // o ajuste fechado DESPUÉS del corte no puede aparecer en una vista que
  // termina antes de esa fecha, aunque siga "abierto" (sin liquidación
  // cerrada que lo contenga todavía). Se filtra por la fecha REAL del
  // movimiento (advanced_at/paid_at/cutoff_date), nunca por created_at.
  const openRunPayments = React.useMemo(
    () =>
      selectedRunPayments.filter(
        (p: any) => !closedRunIds.has(p.settlement_run_id) && isWithinCutoff(p.paid_at, liquidarCutoffAt),
      ),
    [selectedRunPayments, closedRunIds, liquidarCutoffAt],
  );
  const openAdvances = React.useMemo(
    () =>
      selectedAdvances.filter(
        (a: any) =>
          (!a.settlement_run_id || !closedRunIds.has(a.settlement_run_id)) &&
          isWithinCutoff(a.advanced_at, liquidarCutoffAt),
      ),
    [selectedAdvances, closedRunIds, liquidarCutoffAt],
  );
  const openRuns = React.useMemo(
    () => selectedRuns.filter((r: any) => !closedRunIds.has(r.id)),
    [selectedRuns, closedRunIds],
  );

  // Movimientos es un timeline único — pagos de liquidación (agrupados por
  // movement_number: un pago múltiple con varios métodos es UNA sola
  // card), adelantos, ajustes y deducciones, mezclados y ordenados por
  // fecha — ya sin nada de liquidaciones cerradas (ver closedRunIds arriba).
  const historialItems = React.useMemo(
    () => buildHistorialMovimientos(openRunPayments, openAdvances, openRuns),
    [openRunPayments, openAdvances, openRuns],
  );

  // Lista única de Liquidaciones: ventas con comisión (detailRows) +
  // pagos/adelantos/ajustes/deducciones (historialItems), mezclados y
  // ordenados por fecha — reemplaza las pestañas "Comisiones"/"Movimientos"
  // de antes, que mostraban las dos fuentes por separado.
  const unifiedMovimientos = React.useMemo(() => {
    const ventaItems = (detailRows ?? []).map((c: any) => ({
      kind: "venta" as const,
      at: resolveVentaDate(c) as string,
      commission: c,
    }));
    return [...ventaItems, ...historialItems].sort((a: any, b: any) =>
      String(b.at ?? "").localeCompare(String(a.at ?? "")),
    );
  }, [detailRows, historialItems]);

  // Este mapa solo sirve para recuperar el run dueño de un pago (período,
  // "Ver detalle"), no para agrupar la vista — eso lo hace historialItems.
  const runById = React.useMemo(() => {
    const map = new Map<string, any>();
    selectedRuns.forEach((r: any) => map.set(r.id, r));
    return map;
  }, [selectedRuns]);

  // Solo cuentan los items con importe > 0 — una fila agregada pero nunca
  // completada se descarta en vez de mandarse como un ajuste de $0.
  function validSettlementItems(items: { amount: string; reason: string }[]) {
    return items
      .map((i) => ({ amount: Number(i.amount || 0), reason: i.reason.trim() }))
      .filter((i) => i.amount > 0);
  }

  function hasIncompleteSettlementItems(items: { amount: string; reason: string }[]) {
    return items.some((i) => Number(i.amount || 0) > 0 && !i.reason.trim());
  }

  async function prepareRun(row: (typeof rows)[number] | null) {
    if (!row || preparingRunFor) return;
    const validAdjustments = validSettlementItems(adjustmentItems);
    const validDeductions = validSettlementItems(deductionItems);
    // Mismo total que ya se muestra en pantalla (liquidarFinalTotal) — antes
    // se recalculaba acá aparte y se olvidaba sumar las propinas
    // (liquidarNewTips), lo que rechazaba el pago completo apenas el
    // profesional tenía propinas pendientes aunque la UI mostrara "Saldo
    // pendiente: $0". Una sola fuente de verdad, nunca más dos números que
    // puedan desincronizarse.
    const total = liquidarFinalTotal;
    if (total <= 0) {
      toast.error("No hay nada para pagar en este corte");
      return;
    }
    if (hasIncompleteSettlementItems(adjustmentItems) || hasIncompleteSettlementItems(deductionItems)) {
      toast.error("Cada adicional o deducción con importe necesita un motivo");
      return;
    }
    // El monto a pagar es opcional acá: si se completó, el pago se
    // registra apenas se crea la liquidación, en la misma acción — si se
    // deja vacío, solo se prepara (se puede pagar después desde "Pagar",
    // que ya va a mostrar el saldo pendiente de este run). En pago
    // múltiple cada método con importe > 0 viaja como su propio split
    // dentro de una sola llamada a register_settlement_run_payment_batch
    // — todos comparten el mismo Movimiento #, y "Ver detalle" igual puede
    // listar cada método por separado.
    const paymentsToRegister =
      paymentMode === "multiple"
        ? paymentSplits
            .map((s) => ({ amount: Number(s.amount || 0), method: s.method }))
            .filter((p) => p.amount > 0)
        : [{ amount: Number(paymentForm.amount || 0), method: paymentForm.method }].filter((p) => p.amount > 0);
    const paymentAmount = paymentsToRegister.reduce((sum, p) => sum + p.amount, 0);
    if (paymentAmount > 0 && paymentAmount > total) {
      toast.error("El monto a pagar no puede superar el total a pagar");
      return;
    }
    setPreparingRunFor(row.id);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) throw new Error("Sesión inválida — volvé a iniciar sesión");

      const { data: newRun, error } = await supabase.rpc("prepare_settlement_run" as any, {
        p_business_id: businessId,
        p_professional_id: row.id,
        p_adjustment_items: validAdjustments,
        p_deduction_items: validDeductions,
        p_prepared_by: user.id,
        p_prepared_by_name: chargedByName,
        p_cutoff_at: liquidarCutoffAt.toISOString(),
      });
      if (error) throw error;

      // La liquidación ya quedó creada acá — si el pago falla, no se
      // pierde nada: el run sigue activo, listo para pagarse desde "Pagar"
      // de nuevo. register_settlement_run_payment_batch inserta todos los
      // splits en una sola transacción (todo o nada) bajo un mismo
      // Movimiento #, así que no hay riesgo de fallo parcial a mitad de
      // una tanda de pago múltiple.
      if (paymentAmount > 0 && (newRun as any)?.id) {
        const note = paymentForm.note.trim() || null;
        const { error: payError } = await supabase.rpc("register_settlement_run_payment_batch" as any, {
          p_settlement_run_id: (newRun as any).id,
          p_splits: paymentsToRegister.map((p) => ({ amount: p.amount, method: p.method || "transfer" })),
          p_note: note,
          p_paid_by: user.id,
          p_paid_by_name: chargedByName,
        });
        if (payError) {
          toast.error(
            friendlyRpcError(
              payError,
              "Se guardó el saldo, pero no pudimos registrar el pago. Podés intentarlo de nuevo desde Pagar.",
            ),
          );
          resetLiquidarForm();
          setCommissionsVersion((v) => v + 1);
          setLiquidarModalOpen(true);
          return;
        }
        toast.success(`Pago registrado para ${row.name}: ${money(paymentAmount)}`);
        resetLiquidarForm();
        setCommissionsVersion((v) => v + 1);
      } else {
        toast.success(`Saldo actualizado para ${row.name}`);
        resetLiquidarForm();
        setCommissionsVersion((v) => v + 1);
        setLiquidarModalOpen(true);
      }
    } catch (e) {
      toast.error(friendlyRpcError(e, "No pudimos registrar el pago. Intentá nuevamente."));
    } finally {
      setPreparingRunFor(null);
    }
  }

  async function registerAdvance(row: (typeof rows)[number] | null) {
    if (!row || registeringAdvance) return;
    const amount = Number(adelantoForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Ingresá un monto válido");
      return;
    }
    setRegisteringAdvance(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) throw new Error("Sesión inválida — volvé a iniciar sesión");

      // Siempre "ahora" — no hay campo Fecha en este modal, el adelanto
      // queda registrado con el momento exacto de la confirmación.
      const { error } = await supabase.rpc("register_professional_advance" as any, {
        p_business_id: businessId,
        p_professional_id: row.id,
        p_amount: amount,
        p_payment_method: adelantoForm.method || null,
        p_note: adelantoForm.note.trim() || null,
        p_advanced_at: new Date().toISOString(),
        p_registered_by: user.id,
        p_registered_by_name: chargedByName,
      });
      if (error) throw error;
      toast.success(`Adelanto registrado para ${row.name}: ${money(amount)}`);
      resetAdelantoForm();
      setCommissionsVersion((v) => v + 1);
    } catch (e) {
      toast.error(friendlyRpcError(e, "No pudimos registrar el adelanto. Intentá nuevamente."));
    } finally {
      setRegisteringAdvance(false);
    }
  }

  // Fecha y hora EXACTAS de la última liquidación del profesional
  // seleccionado — null si todavía no tiene ninguna ("Primera
  // liquidación"). No usar toLocaleDateString("es-AR") a secas para la
  // hora: da formato "15:00" pero sin la unidad — se agrega " h" a mano
  // (nunca "hs", como pidió el negocio).
  const lastLiquidacionInfo = React.useMemo(() => {
    if (!selectedRow?.latestRun) return null;
    const d = new Date(selectedRow.latestRun.prepared_at);
    return {
      dateLabel: d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }),
      timeLabel: `${d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })} h`,
    };
  }, [selectedRow]);

  // "Desde"/"hasta" del período que se va a liquidar — hasta refleja el
  // corte elegido (hoy/ahora por default, o las 23:59 del día elegido).
  const liquidarPeriodLabel = React.useMemo(() => {
    const hastaDate = liquidarCutoffAt.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const hastaTime = liquidarCutoffAt.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const hastaLabel = `Hasta ${hastaDate} • ${hastaTime} h`;
    if (lastLiquidacionInfo) {
      return `Desde ${lastLiquidacionInfo.dateLabel} • ${lastLiquidacionInfo.timeLabel} ${hastaLabel}`;
    }
    return `Primera liquidación · ${hastaLabel}`;
  }, [lastLiquidacionInfo, liquidarCutoffAt]);

  // Para la tarjeta "Período actual" del header — "hasta" ahora refleja
  // el corte elegido (liquidarCutoffAt: hoy/ahora por default, ticking
  // cada minuto, o las 23:59 del día elegido desde esta misma tarjeta).
  // Devuelve "Desde" y "Hasta" por separado para que el header los
  // renderice en dos líneas propias, nunca juntas en una sola.
  const periodoActualLabel = React.useMemo(() => {
    const hastaDate = liquidarCutoffAt.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const hastaTime = liquidarCutoffAt.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return {
      desde: lastLiquidacionInfo
        ? `Desde ${lastLiquidacionInfo.dateLabel} • ${lastLiquidacionInfo.timeLabel}`
        : "Primera liquidación",
      hasta: `Hasta ${hastaDate} • ${hastaTime} h`,
    };
  }, [lastLiquidacionInfo, liquidarCutoffAt]);

  const calendarDays = React.useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const days: Array<{ iso: string; day: number; inMonth: boolean }> = [];

    for (let index = 0; index < startOffset; index += 1) {
      days.push({ iso: "", day: 0, inMonth: false });
    }

    for (let day = 1; day <= lastDay.getDate(); day += 1) {
      const date = new Date(year, month, day);
      days.push({ iso: date.toLocaleDateString("sv-SE"), day, inMonth: true });
    }

    while (days.length % 7 !== 0) {
      days.push({ iso: "", day: 0, inMonth: false });
    }

    return days;
  }, [calendarMonth]);

  const calendarTitle = React.useMemo(() => {
    const raw = calendarMonth.toLocaleDateString("es-AR", {
      month: "long",
      year: "numeric",
    });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [calendarMonth]);


  // StatCard/VentaRow/MovRow/LIQ_GRID_COLS: movidos a
  // src/components/liquidaciones/unified-row.tsx — ÚNICA fuente de verdad
  // visual, compartida con Panel del profesional > Movimientos
  // (professionals.tsx). No duplicar acá.

  // Pagar es un botón de acción (como Adelantar): abre su modal directo,
  // precargando el monto sugerido. Usa liquidarNewCommissions/liquidarPendingAdvances
  // (recalculados para el corte "Hasta" ya elegido desde la tarjeta
  // Período actual), no row.newCommissions/pendingAdvances — esos
  // siempre reflejan "ahora", así que si ya se eligió un corte pasado el
  // monto sugerido quedaba más alto de lo que en verdad se puede pagar.
  function openLiquidarModal(row: (typeof rows)[number] | null) {
    if (!row) return;
    // El monto sugerido lo pone el efecto de liquidarFinalTotal (más abajo)
    // apenas liquidarModalOpen pasa a true — acá solo hace falta abrir.
    setLiquidarModalOpen(true);
  }

  // Carga el detalle de ventas/comisiones cuando cambia el profesional
  // seleccionado (o el corte "Liquidar hasta" elegido desde la tarjeta
  // "Período actual") — ya no depende de ninguna pestaña, Liquidaciones
  // muestra una sola lista unificada.
  React.useEffect(() => {
    if (!selectedRow) return;
    openDetail(selectedRow.id);
    // liquidarCutoffDate (el string elegido), no liquidarCutoffAt (el
    // Date derivado, que cambia cada minuto por nowClock aunque el
    // corte elegido siga siendo "hoy") — evita refetchear de más.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRow?.id, commissionsVersion, liquidarCutoffDate]);

  // Comisiones/adelantos recalculados en vivo para el corte elegido —
  // selectedRow.newCommissions/pendingAdvances siempre reflejan "ahora",
  // acá se vuelve a filtrar por fecha para poder liquidar "hasta tal día".
  const liquidarNewCommissions = React.useMemo(() => {
    if (!selectedRow) return 0;
    const periodStartAt = selectedRow.periodStartAt;
    return allCommissions
      .filter(
        (c: any) =>
          String(c.professional_id) === selectedRow.id &&
          !c.settlement_run_id &&
          (!periodStartAt || String(c.created_at ?? "") > periodStartAt) &&
          isWithinCutoff(c.created_at, liquidarCutoffAt) &&
          Number(c.pending_amount ?? 0) > 0,
      )
      .reduce((sum: number, c: any) => sum + Number(c.pending_amount ?? 0), 0);
  }, [allCommissions, selectedRow, liquidarCutoffAt]);

  // Propinas pendientes del mismo profesional/período/corte — mismo
  // criterio exacto que liquidarNewCommissions, pero sobre tip_records.
  // Se suma a liquidarBaseTotal (abajo) pero SIEMPRE se muestra como cifra
  // aparte en la UI (tarjeta "Propinas" propia) — nunca dentro de
  // "Comisiones generadas".
  const liquidarNewTips = React.useMemo(() => {
    if (!selectedRow) return 0;
    const periodStartAt = selectedRow.periodStartAt;
    return allTips
      .filter(
        (t: any) =>
          String(t.professional_id) === selectedRow.id &&
          !t.settlement_run_id &&
          (!periodStartAt || String(t.created_at ?? "") > periodStartAt) &&
          isWithinCutoff(t.created_at, liquidarCutoffAt) &&
          Number(t.pending_amount ?? 0) > 0,
      )
      .reduce((sum: number, t: any) => sum + Number(t.pending_amount ?? 0), 0);
  }, [allTips, selectedRow, liquidarCutoffAt]);

  const liquidarPendingAdvances = React.useMemo(() => {
    if (!selectedRow) return 0;
    const cutoffIso = liquidarCutoffAt.toISOString();
    return allAdvances
      .filter(
        (a: any) =>
          String(a.professional_id) === selectedRow.id &&
          !a.settlement_run_id &&
          String(a.advanced_at ?? "") <= cutoffIso,
      )
      .reduce((sum: number, a: any) => sum + Number(a.amount ?? 0), 0);
  }, [allAdvances, selectedRow, liquidarCutoffAt]);

  // Totales en vivo del modal "Preparar liquidación" — se recalculan en
  // cada tecla mientras se agregan/editan ajustes y deducciones, y cada
  // vez que cambia el corte elegido.
  const liquidarAdjustmentsSum = adjustmentItems.reduce(
    (sum, i) => sum + Math.max(Number(i.amount || 0), 0),
    0,
  );
  const liquidarDeductionsSum = deductionItems.reduce(
    (sum, i) => sum + Math.max(Number(i.amount || 0), 0),
    0,
  );
  const liquidarBaseTotal = selectedRow
    ? selectedRow.previousBalance + liquidarNewCommissions + liquidarNewTips - liquidarPendingAdvances
    : 0;
  const liquidarFinalTotal = liquidarBaseTotal + liquidarAdjustmentsSum - liquidarDeductionsSum;
  const liquidarValidAdjustmentsCount = validSettlementItems(adjustmentItems).length;
  const liquidarValidDeductionsCount = validSettlementItems(deductionItems).length;

  // "Monto a pagar" arranca siempre igual al total final y lo sigue en vivo
  // (si se agrega un adicional, sube solo) mientras el usuario no lo haya
  // tocado a mano — apenas lo edita una vez, se respeta su valor (pago
  // parcial intencional) y deja de autocompletarse.
  React.useEffect(() => {
    if (!liquidarModalOpen || paymentAmountTouched) return;
    setPaymentForm((f) => ({ ...f, amount: liquidarFinalTotal > 0 ? String(Math.round(liquidarFinalTotal)) : "" }));
  }, [liquidarModalOpen, paymentAmountTouched, liquidarFinalTotal]);

  return (
    <div className="-mt-5 h-auto overflow-visible pb-6 sm:h-[calc(100vh-270px)] sm:min-h-[470px] sm:overflow-hidden">
      {/* Mobile: un solo shadow liviano (mismo costo de paint que
          Precios/Inventario) en vez del shadow doble con capa negra
          pesada (blur 100px + blur 85px apiladas) que tenía esta pantalla.
          Ese doble shadow es mucho más caro de componer para Safari iOS en
          el primer frame tras montar el tab — quedaba "plano" un instante y
          recién after se terminaba de pintar, dando la sensación de que
          "prende la luz" al cargar. Desktop no cambia (shadow doble original
          vía `sm:`). */}
      <section className="flex flex-col overflow-visible rounded-3xl border border-white/[0.085] bg-[linear-gradient(180deg,rgba(10,14,26,0.96),rgba(4,6,14,0.985))] shadow-[0_24px_85px_-50px_rgba(139,92,246,0.42)] sm:h-full sm:overflow-hidden sm:shadow-[0_32px_100px_-58px_rgba(0,0,0,0.95),0_24px_85px_-62px_rgba(139,92,246,0.42)]">
        <div className="flex flex-col gap-3 border-b border-white/[0.065] px-5 py-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={selectedEmployeeId}
              onChange={(event) => {
                const nextId = event.target.value;
                setSelectedEmployeeId(nextId);
                // Cambiar de profesional nunca abre un modal solo — se
                // queda en la lista unificada mostrando los datos del
                // profesional entrante. Cierra cualquier modal que hubiera
                // quedado abierto para el anterior, así no se reutiliza su
                // estado (montos precargados, etc.).
                resetLiquidarForm();
                resetAdelantoForm();
                setLiquidarCutoffDate("");
                setPeriodInfoOpen(false);
                setHistorialDetailRun(null);
                setHistorialDetailServices(null);
              }}
              className="h-10 w-full rounded-2xl border border-white/[0.09] bg-[#070A13]/80 px-3.5 text-base text-white outline-none backdrop-blur-xl focus:border-violet-300/35 focus:ring-2 focus:ring-violet-400/12 sm:min-w-[230px] sm:w-auto sm:text-sm"
            >
              <option value="" disabled>
                Seleccionar profesional
              </option>
              {(data.employees ?? []).map((employee: any) => (
                <option key={employee.id} value={String(employee.id)}>
                  {employee.name ?? "Profesional"}
                </option>
              ))}
            </select>

            {/* Sin profesional elegido no hay período que mostrar —
                arrancar con "Primera liquidación"/fechas sueltas antes
                de elegir a alguien confunde más que ayuda. */}
            {selectedRow && (
              <div className="inline-flex w-full flex-col items-center gap-1 rounded-2xl border border-white/[0.10] bg-white/[0.055] px-3.5 py-2.5 text-center ring-1 ring-white/[0.07] sm:w-auto">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
                  <CalendarDays className="size-3.5" />
                  Período actual
                </span>
                <span className="max-w-full break-words text-xs font-semibold text-white">
                  {periodoActualLabel.desde}
                </span>
                {/* Solo "Hasta" es editable — "Desde" queda fijo (es la
                    última liquidación pagada). Tocarlo abre el calendario
                    de abajo para elegir hasta qué día liquidar. */}
                <button
                  type="button"
                  onClick={() => {
                    setCalendarMonth(new Date(`${liquidarCutoffDate || today}T12:00:00`));
                    setPeriodInfoOpen(true);
                  }}
                  className="max-w-full break-words text-xs font-semibold text-violet-200 underline decoration-dotted underline-offset-2 transition hover:text-violet-100"
                >
                  {periodoActualLabel.hasta}
                </button>
              </div>
            )}
          </div>
        </div>

        {selectedRow && (
          <div className="flex flex-col gap-2.5 border-b border-white/[0.055] px-5 py-3 lg:flex-row lg:items-stretch">
            <div
              className={cn(
                "grid flex-1 grid-cols-2 gap-2.5",
                // Comisiones generadas + Adelantos son siempre fijas;
                // Comisiones pendientes y Propinas son condicionales — la
                // cantidad de columnas en desktop sigue la cantidad real de
                // tarjetas visibles para que no queden huecos. previousBalance
                // redondeado: un resto de centavos (ej. $0,17 por un
                // adelanto con decimales) no debe mostrar una tarjeta de
                // "$0" — ver money(), que ya redondea para mostrar.
                2 + (hasPendingPreviousBalance ? 1 : 0) + (liquidarNewTips > 0 ? 1 : 0) >= 4
                  ? "sm:grid-cols-4"
                  : hasPendingPreviousBalance || liquidarNewTips > 0
                    ? "sm:grid-cols-3"
                    : "sm:grid-cols-2",
              )}
            >
              <StatCard
                label="Comisiones generadas"
                sublabel={hasPendingPreviousBalance ? "Período actual" : undefined}
                value={money(liquidarNewCommissions)}
                tone="violet"
                info={COMISIONES_NUEVAS_INFO_TEXT}
              />
              {hasPendingPreviousBalance && (
                <StatCard
                  label="Comisiones pendientes"
                  sublabel={selectedRow.previousPeriodLabel ?? "Período anterior"}
                  value={money(totals.previousBalance)}
                  tone="neutral"
                  info={LIQUIDACION_ANTERIOR_INFO_TEXT}
                />
              )}
              {liquidarNewTips > 0 && (
                <StatCard
                  label="Propinas"
                  value={money(liquidarNewTips)}
                  tone="violet"
                  info="Propinas cobradas junto con ventas de este profesional, pendientes de liquidar. Nunca forman parte de las comisiones ni de la facturación del negocio."
                />
              )}
              {/* Adelantos: misma tarjeta de siempre (tono rose, igual
                  estilo que StatCard), ahora con el botón "Adelantar"
                  integrado adentro, alineado a la derecha — antes vivía
                  junto a "Pagar" en la barra de Total a pagar. No se tocó
                  StatCard (compartido con Panel del profesional, que no
                  tiene botones) para no arriesgar su layout ahí. */}
              <div className="col-span-2 flex items-center justify-between gap-2 rounded-2xl border border-rose-400/18 bg-rose-400/[0.055] px-3.5 py-2.5 text-rose-300 shadow-[0_0_28px_rgba(251,113,133,0.10)] sm:col-span-1">
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-rose-200/70">
                    <span>Adelantos</span>
                    <InfoPopover text={ADELANTOS_INFO_TEXT} />
                  </div>
                  <div className="mt-0.5 text-lg font-bold tabular-nums">
                    {liquidarPendingAdvances > 0 ? `−${money(liquidarPendingAdvances)}` : money(0)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAdelantoModalOpen(true)}
                  className="shrink-0 rounded-xl bg-rose-500 px-3 py-2 text-xs font-bold text-white shadow-[0_0_18px_rgba(244,63,94,0.26)] transition hover:brightness-110"
                >
                  Adelantar
                </button>
              </div>
            </div>

            {/* Total a pagar: mayor jerarquía visual que el resto de las
                tarjetas (más grande, tono propio) y con Pagar integrado en
                la misma zona, alineado a la derecha — Adelantar vive ahora
                en la tarjeta Adelantos (ver arriba), no acá. sticky: queda
                siempre visible arriba a la derecha aunque se haga scroll
                en la lista de abajo. */}
            <div className="sticky top-0 z-20 flex items-center gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.07] px-4 py-2.5 shadow-[0_0_28px_rgba(16,185,129,0.10)] backdrop-blur-xl lg:min-w-[300px]">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200/70">
                  Total a pagar
                </div>
                <div className="mt-0.5 text-xl font-bold tabular-nums text-emerald-300 sm:text-2xl">
                  {money(
                    Math.max(
                      totals.previousBalance + liquidarNewCommissions + liquidarNewTips - liquidarPendingAdvances,
                      0,
                    ),
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => openLiquidarModal(selectedRow)}
                  className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-white shadow-[0_0_18px_rgba(16,185,129,0.28)] transition hover:brightness-110"
                >
                  Pagar
                </button>
              </div>
            </div>
          </div>
        )}

        {(commissionsError || runsError) && (
          <div className="mx-5 mt-3 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-xs text-rose-200">
            {commissionsError && (
              <div>No se pudieron cargar las comisiones: {commissionsError}</div>
            )}
            {runsError && (
              <div>No se pudieron cargar las liquidaciones: {runsError}</div>
            )}
          </div>
        )}

        {data.loading || loadingCommissions || loadingRuns ? (
          <>
            {/* Desktop: skeleton sin tarjeta propia (misma caja continua de
                siempre). Sin cambios de layout respecto de la web. */}
            <div className="hidden overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.018] sm:block">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 border-b border-white/[0.055] px-5 py-3.5 last:border-0"
                >
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3.5 w-1/3 animate-pulse rounded bg-white/[0.06]" />
                    <div className="h-2.5 w-1/4 animate-pulse rounded bg-white/[0.045]" />
                  </div>
                  <div className="h-3 w-20 shrink-0 animate-pulse rounded bg-white/[0.045]" />
                </div>
              ))}
            </div>
            {/* Mobile: skeleton en tarjetas individuales — reproduce las
                MISMAS 3 filas que la tarjeta real (nombre+pendiente,
                ventas/comisión/pagado, botones) para que no aparezcan
                filas/elementos nuevos cuando llegan los datos: antes el
                skeleton solo tenía nombre+monto y la tarjeta real sumaba
                de golpe la grilla de 3 columnas y los botones — ese
                contenido apareciendo de la nada era lo que se percibía
                como "prende la luz". También usa la MISMA cantidad de
                tarjetas que `data.employees` (ya disponible aunque
                loadingCommissions/loadingRuns sigan en true, porque son fetches
                aparte) en vez de un número fijo — antes, con una lista de
                4 placeholders fijos, si el negocio tenía menos o más
                empleados la altura de la sección cambiaba de golpe al
                llegar los datos. En mobile la sección crece con el
                contenido (a diferencia de desktop, que tiene alto fijo y
                scroll interno), así que ese cambio de alto reacomoda toda
                la página y corre los fondos ambientales de más arriba —
                eso es lo que se percibía como "cambia la luz", exclusivo
                de mobile. */}
            <div className="flex flex-col gap-2.5 p-3 sm:hidden">
              {Array.from({
                length: Math.max(data.employees?.length ?? 0, 1),
              }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="h-3.5 w-28 animate-pulse rounded bg-white/[0.06]" />
                      <div className="h-2.5 w-16 animate-pulse rounded bg-white/[0.045]" />
                    </div>
                    <div className="h-3.5 w-14 shrink-0 animate-pulse rounded bg-white/[0.045]" />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="h-3 animate-pulse rounded bg-white/[0.045]" />
                    <div className="h-3 animate-pulse rounded bg-white/[0.045]" />
                    <div className="h-3 animate-pulse rounded bg-white/[0.045]" />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <div className="h-8 flex-1 animate-pulse rounded-xl bg-white/[0.035]" />
                    <div className="h-8 flex-1 animate-pulse rounded-xl bg-white/[0.035]" />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : selectedRow ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Adelantar/Pagar ahora viven integrados en la tarjeta "Total
                a pagar" de arriba (ver bloque de resumen) — no hay una
                barra de botones aparte acá. */}

            {/* Movimientos (cuenta corriente abierta) vs Historial
                (liquidaciones ya pagadas) — mismo patrón que Panel del
                profesional, para que una liquidación cerrada (su pago,
                sus adelantos, sus ajustes/deducciones) nunca se mezcle
                con lo pendiente. */}
            <div className="flex gap-2 px-5 pt-3">
              {(
                [
                  { key: "movimientos", label: "Movimientos" },
                  { key: "historial", label: "Historial" },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setLiqSubTab(key)}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs font-medium ring-1 transition",
                    liqSubTab === key
                      ? "bg-primary/15 ring-primary/40 text-foreground"
                      : "bg-white/[0.03] ring-white/10 text-muted-foreground hover:bg-white/[0.06]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {liqSubTab === "historial" ? (
              <div className="min-h-0 flex-1 overflow-visible sm:overflow-y-auto px-5 py-4 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
                <HistorialPanelView businessId={businessId} empId={selectedRow.id} />
              </div>
            ) : (
            <div className="min-h-0 flex-1 overflow-visible sm:overflow-y-auto px-5 py-4 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
              {detailError && (
                <div className="mb-3 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-xs text-rose-200">
                  {detailError}
                </div>
              )}
              {loadingDetail || loadingRuns ? (
                <div className="px-4 py-10 text-center text-sm text-white/45">
                  Cargando…
                </div>
              ) : unifiedMovimientos.length === 0 ? (
                <div className="rounded-xl border border-white/[0.07] bg-black/18 px-4 py-8 text-center text-sm text-white/45">
                  Todavía no hay ventas ni movimientos para este profesional.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <UnifiedMovimientosHeader />
                  {unifiedMovimientos.map((item: any) => {
                    if (item.kind === "venta") {
                      return (
                        <VentaRow
                          key={`venta-${item.commission.id}`}
                          c={item.commission}
                          commissionsMap={data.employeeCommissions}
                        />
                      );
                    }
                    const dateTime = item.at
                      ? `${new Date(item.at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })} · ${new Date(item.at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}`
                      : "—";
                    if (item.kind === "adelanto") {
                      return (
                        <MovRow
                          key={`adelanto-${item.data.id}`}
                          dateTime={dateTime}
                          cliente=""
                          concepto="Adelanto"
                          precioText={`-${money(Number(item.data.amount ?? 0))}`}
                          precioClass="text-rose-300"
                          detalle={`Dado por ${displayResponsable(item.data.registered_by_name)}`}
                          note={item.data.note ?? null}
                          redStripe
                          clickable={false}
                          emptyFiller=""
                          onDelete={() => handleDeleteAdvance(item.data.id, Number(item.data.amount ?? 0))}
                          deleting={deletingAdvanceId === item.data.id}
                        />
                      );
                    }
                    if (item.kind === "ajuste" || item.kind === "deduccion") {
                      const isAjuste = item.kind === "ajuste";
                      const isExpanded = isAjuste
                        ? historialDetailAjuste?.runId === item.runId
                        : historialDetailDeduccion?.runId === item.runId;
                      const detalleData = {
                        professionalName: item.professionalName,
                        preparedByName: item.preparedByName,
                        preparedAt: item.at,
                        amount: item.amount,
                        items: item.items,
                      };
                      return (
                        <MovRow
                          key={`${item.kind}-${item.runId}`}
                          dateTime={dateTime}
                          concepto={isAjuste ? "Ajuste" : "Deducción"}
                          precioText={`${isAjuste ? "+" : "-"}${money(Number(item.amount ?? 0))}`}
                          precioClass={isAjuste ? "text-emerald-300" : "text-rose-300"}
                          detalle={`Preparado por ${displayResponsable(item.preparedByName)}`}
                          expanded={isExpanded}
                          onToggle={() => {
                            if (isAjuste) setHistorialDetailAjuste(isExpanded ? null : item);
                            else setHistorialDetailDeduccion(isExpanded ? null : item);
                          }}
                          detail={
                            isAjuste ? (
                              <AjusteDetalleContent data={detalleData} />
                            ) : (
                              <DeduccionDetalleContent data={detalleData} />
                            )
                          }
                        />
                      );
                    }
                    const run = runById.get(item.settlementRunId);
                    const isExpanded =
                      historialDetailMovementNumber === item.movementNumber && Boolean(historialDetailRun);
                    const paidBy = displayResponsable(item.splits[0]?.paid_by_name);
                    // La fila de pago muestra el corte de la liquidación
                    // (settlement_runs.cutoff_date), no paid_at — paid_at
                    // sigue intacto en la base para auditoría (ver
                    // detalle/comprobante), pero acá el profesional/admin
                    // tiene que identificar el pago por el PERÍODO que
                    // liquida, no por el día en que se tocó "Pagar"
                    // (pueden ser fechas distintas si se cobró días
                    // después del corte). Split manual del string, nunca
                    // `new Date(cutoff_date)`: esa columna es un `date`
                    // puro ("2026-10-03"), y parsearla como Date la
                    // interpreta en UTC medianoche — con timezone
                    // negativo (Argentina) el navegador la corre un día
                    // para atrás al formatear.
                    const pagoDateTime = run?.cutoff_date
                      ? (() => {
                          const [, m, d] = String(run.cutoff_date).slice(0, 10).split("-");
                          return `${d}/${m}`;
                        })()
                      : dateTime;
                    return (
                      <MovRow
                        key={`pago-${item.movementNumber ?? item.splits[0].id}`}
                        dateTime={pagoDateTime}
                        concepto={item.isFull ? "Pago total" : "Pago parcial"}
                        precioText={money(Number(item.totalAmount ?? 0))}
                        precioClass={item.isFull ? "text-emerald-300" : "text-amber-300"}
                        detalle={`Pagado por ${paidBy}`}
                        expanded={isExpanded}
                        loadingDetail={isExpanded && loadingHistorialDetail}
                        onToggle={() => {
                          if (isExpanded) {
                            setHistorialDetailRun(null);
                            setHistorialDetailMovementNumber(null);
                            setHistorialDetailServices(null);
                          } else if (run) {
                            openHistorialDetail(run, item.movementNumber);
                          }
                        }}
                        detail={
                          historialDetailRun ? (
                            <PagoDetalleContent
                              run={historialDetailRun}
                              payments={allRunPayments
                                .filter((p: any) => p.settlement_run_id === item.settlementRunId)
                                .sort((a: any, b: any) => String(a.paid_at ?? "").localeCompare(String(b.paid_at ?? "")))}
                              advances={allAdvances
                                .filter((a: any) => a.settlement_run_id === item.settlementRunId)
                                .sort((a: any, b: any) => String(a.advanced_at ?? "").localeCompare(String(b.advanced_at ?? "")))}
                              services={historialDetailServices}
                              loadingServices={loadingHistorialDetail}
                              commissionsMap={data.employeeCommissions}
                            />
                          ) : null
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
            )}
          </div>
        ) : (data.employees ?? []).length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-white/45">
            Todavía no hay profesionales cargados en Equipo.
          </div>
        ) : (
          <div className="px-5 py-10 text-center text-sm text-white/45">
            Seleccioná un profesional para ver sus comisiones.
          </div>
        )}
      </section>

      {selectedRow && (
        <AgendaCenteredModal
          open={adelantoModalOpen}
          onOpenChange={(v) => {
            if (!v) resetAdelantoForm();
          }}
          lockOutside={false}
          title="Adelantar"
          subtitle={selectedRow.name}
          footer={
            <button
              type="button"
              onClick={() => registerAdvance(selectedRow)}
              disabled={registeringAdvance || !Number.isFinite(Number(adelantoForm.amount)) || Number(adelantoForm.amount) <= 0}
              className="w-full rounded-2xl bg-rose-500 px-4 py-3 text-sm font-bold text-white shadow-[0_0_35px_rgba(244,63,94,0.28)] transition hover:brightness-110 disabled:opacity-60"
            >
              {registeringAdvance ? "Adelantando…" : "Adelantar"}
            </button>
          }
        >
          <div className="space-y-3">
            <label className="space-y-1.5 text-xs font-semibold text-white/55">
              Monto
              <input
                type="number"
                min={0}
                value={adelantoForm.amount}
                onChange={(event) => setAdelantoForm((form) => ({ ...form, amount: event.target.value }))}
                placeholder="Ej: 20.000"
                className="h-11 w-full rounded-2xl border border-white/[0.08] bg-black/30 px-3 text-base text-white outline-none placeholder:text-white/30 focus:border-amber-300/35"
              />
            </label>
            <label className="space-y-1.5 text-xs font-semibold text-white/55">
              Método
              <select
                value={adelantoForm.method}
                onChange={(event) => setAdelantoForm((form) => ({ ...form, method: event.target.value }))}
                className="h-11 w-full rounded-2xl border border-white/[0.08] bg-black/30 px-3 text-base text-white outline-none focus:border-amber-300/35"
              >
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="debito">Débito</option>
              </select>
            </label>
            <label className="block space-y-1.5 text-xs font-semibold text-white/55">
              Nota
              <textarea
                value={adelantoForm.note}
                onChange={(event) => setAdelantoForm((form) => ({ ...form, note: event.target.value }))}
                placeholder="Opcional"
                rows={2}
                className="w-full resize-none rounded-2xl border border-white/[0.08] bg-black/30 px-3 py-3 text-base text-white outline-none placeholder:text-white/32 focus:border-amber-300/35"
              />
            </label>
          </div>
        </AgendaCenteredModal>
      )}

      {selectedRow && (
        <AgendaCenteredModal
          open={periodInfoOpen}
          onOpenChange={setPeriodInfoOpen}
          lockOutside={false}
          title="Liquidar hasta"
          subtitle={liquidarPeriodLabel}
        >
          <div>
            <div className="mb-5 flex items-center justify-between">
              <button
                type="button"
                onClick={() =>
                  setCalendarMonth(
                    (date) => new Date(date.getFullYear(), date.getMonth() - 1, 1),
                  )
                }
                className="grid size-9 place-items-center rounded-xl text-white/45 transition hover:bg-white/[0.06] hover:text-white"
              >
                ‹
              </button>
              <div className="text-lg font-bold capitalize text-white">{calendarTitle}</div>
              <button
                type="button"
                onClick={() =>
                  setCalendarMonth(
                    (date) => new Date(date.getFullYear(), date.getMonth() + 1, 1),
                  )
                }
                className="grid size-9 place-items-center rounded-xl text-white/45 transition hover:bg-white/[0.06] hover:text-white"
              >
                ›
              </button>
            </div>

            <div className="grid grid-cols-7 text-center text-xs font-semibold uppercase tracking-[0.16em] text-white/28">
              {["LU", "MA", "MI", "JU", "VI", "SÁ", "DO"].map((day) => (
                <div key={day} className="py-2">
                  {day}
                </div>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 overflow-hidden rounded-2xl">
              {calendarDays.map((day, index) => {
                // Elegible: entre el inicio del período actual y hoy —
                // nunca futuro, nunca antes de la última liquidación.
                const selectable = Boolean(
                  day.iso &&
                    (!selectedRow.periodStart || day.iso >= selectedRow.periodStart) &&
                    day.iso <= today,
                );
                const isToday = day.iso === today;
                const hastaIso = liquidarCutoffDate || today;
                // Rango que se va a liquidar: desde el inicio real del
                // período (Desde) hasta el corte elegido (Hasta) — nunca
                // "desde el elegido hasta hoy", ni un solo día suelto.
                const isRangeStart = Boolean(selectedRow.periodStart && day.iso === selectedRow.periodStart);
                const isRangeEnd = day.iso === hastaIso;
                const isInRange = Boolean(
                  day.iso &&
                    (!selectedRow.periodStart || day.iso >= selectedRow.periodStart) &&
                    day.iso <= hastaIso,
                );
                const isRangeMiddle = isInRange && !isRangeStart && !isRangeEnd;
                return (
                  <button
                    key={`${day.iso || "empty"}-${index}`}
                    type="button"
                    disabled={!selectable}
                    onClick={() => {
                      if (!day.iso) return;
                      setLiquidarCutoffDate(day.iso === today ? "" : day.iso);
                      setPeriodInfoOpen(false);
                    }}
                    className={cn(
                      "grid h-11 place-items-center text-sm font-semibold transition",
                      !day.inMonth && "opacity-0",
                      day.inMonth && !selectable && "text-white/25",
                      // Fuera del rango a liquidar: estado normal, solo
                      // clickeable — un leve hover para que se note.
                      selectable && !isInRange && !isToday && "rounded-xl text-white/85 hover:bg-white/[0.06]",
                      // Hoy, si queda FUERA del rango: solo un borde, nunca
                      // relleno — para que no se confunda con "seleccionado".
                      isToday && !isInRange && "rounded-xl text-white/85 ring-1 ring-sky-400/55 ring-inset hover:bg-white/[0.06]",
                      // Días intermedios del rango: fondo parejo, sin bordes
                      // redondeados propios (se ve como una franja continua).
                      isRangeMiddle && "bg-violet-400/20 text-white",
                      // Extremos del rango (Desde/Hasta): relleno sólido,
                      // redondeados hacia afuera del rango.
                      isRangeStart &&
                        "rounded-l-xl bg-gradient-to-br from-sky-400 to-violet-500 text-white shadow-[0_0_18px_rgba(139,92,246,0.45)]",
                      isRangeEnd &&
                        "rounded-r-xl bg-gradient-to-br from-sky-400 to-violet-500 text-white shadow-[0_0_18px_rgba(139,92,246,0.45)]",
                      // Si el rango es un solo día (Desde === Hasta, o no hay
                      // Desde), ese día redondea los dos lados.
                      isRangeStart && isRangeEnd && "rounded-xl",
                    )}
                  >
                    {day.day || ""}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 text-center text-xs text-white/28">
              Elegí hasta qué día liquidar — el día elegido queda completo incluido, hasta las 23:59 h
            </div>
          </div>
        </AgendaCenteredModal>
      )}

      {/* El detalle de cada Movimiento (pago/adelanto/ajuste/deducción) ya
          no abre en un modal aparte — se expande inline dentro de la misma
          fila/tarjeta en la lista de Movimientos (variant="row" de
          MovimientoCard), así no queda tanto espacio vacío alrededor de
          poca información. */}

      {selectedRow && (() => {
        // Un solo flujo para todos los profesionales, tengan o no una
        // liquidación previa sin terminar de pagar: "Pagar" siempre
        // prepara una liquidación nueva (prepareRun), que arrastra el
        // saldo restante de la anterior como "Comisiones pendientes"
        // (previousBalance) — nunca reutiliza ni vuelve a mostrar el
        // viejo modal de solo lectura (Total/Pagado/Restante) de un run
        // ya preparado. No hay riesgo de contar comisiones dos veces:
        // cada run solo toma las que todavía no tienen settlement_run_id.
        const periodStartAtMs = selectedRow.periodStartAt ? new Date(selectedRow.periodStartAt).getTime() : null;
        const liquidarPeriodValid = periodStartAtMs === null || liquidarCutoffAt.getTime() > periodStartAtMs;
        const paymentSplitsSum = paymentSplits.reduce((s, sp) => s + Number(sp.amount || 0), 0);
        const multipleSumOver = paymentMode === "multiple" && Math.round(paymentSplitsSum) > Math.round(liquidarFinalTotal);
        const payDisabled =
          preparingRunFor === selectedRow.id || !liquidarPeriodValid || liquidarFinalTotal <= 0 || multipleSumOver;

        return (
          <AgendaCenteredModal
            open={liquidarModalOpen}
            onOpenChange={(v) => {
              if (!v) resetLiquidarForm();
            }}
            title={selectedRow.name}
            footer={
              <button
                type="button"
                onClick={() => prepareRun(selectedRow)}
                disabled={payDisabled}
                className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white shadow-[0_0_35px_rgba(16,185,129,0.28)] transition hover:brightness-110 disabled:opacity-60"
              >
                {preparingRunFor === selectedRow.id ? "Pagando…" : "Pagar"}
              </button>
            }
          >
            <div className="space-y-4">
              {/* Sin período ni "Comisiones generadas" acá — ya están en
                  la pantalla principal (tarjeta Período actual + tarjetas
                  de arriba), no hace falta repetirlas dentro del modal. */}
              {!liquidarPeriodValid && (
                <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-3.5 py-2.5 text-xs text-rose-200">
                  No hay comisiones disponibles hasta la fecha seleccionada.
                </div>
              )}

              <SettlementItemsEditor
                items={adjustmentItems}
                onChange={setAdjustmentItems}
                addLabel="Agregar adicional"
                reasonPlaceholder="Ej. Feriado trabajado, bono o comisión adicional"
                formatThousands={formatThousands}
                accentClass="border-emerald-400/25 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15"
              />

              <SettlementItemsEditor
                items={deductionItems}
                onChange={setDeductionItems}
                addLabel="Agregar deducción"
                reasonPlaceholder="Ej. Llegada tarde, adelanto o producto descontado"
                formatThousands={formatThousands}
                accentClass="border-rose-400/25 bg-rose-400/10 text-rose-200 hover:bg-rose-400/15"
              />

              {/* Sin Comisiones pendientes/nuevas ni Adelantos acá — ya
                  están en las tarjetas de la pantalla principal, este
                  resumen solo agrega lo que se puede tocar en este
                  modal (adicionales/deducciones) y el total final. */}
              <div className="space-y-1.5 rounded-2xl border border-white/[0.08] bg-black/25 p-3.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-white/50">Adicionales</span>
                  <span className="font-semibold text-emerald-300">
                    {liquidarValidAdjustmentsCount > 0 ? `${liquidarValidAdjustmentsCount} · ` : ""}+{money(liquidarAdjustmentsSum)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/50">Deducciones</span>
                  <span className="font-semibold text-rose-300">
                    {liquidarValidDeductionsCount > 0 ? `${liquidarValidDeductionsCount} · ` : ""}−{money(liquidarDeductionsSum)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between border-t border-white/[0.08] pt-2">
                  <span className="font-bold text-white/70">Total final</span>
                  <span className="text-base font-bold text-emerald-300">{money(liquidarFinalTotal)}</span>
                </div>
              </div>

              <div>
                {/* Mismo segmented control que Nueva venta (paso Pago) —
                    "simple" es un método + un monto editable (permite pago
                    parcial); "multiple" reusa MultiMethodPaymentSplit, acá
                    con allowPartial: la suma puede ser menor al total
                    (queda como pago parcial), nunca mayor. */}
                <div className="mb-3 grid grid-cols-2 overflow-hidden rounded-2xl border border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setPaymentMode("simple")}
                    className={cn(
                      "py-2 text-xs font-semibold transition",
                      paymentMode === "simple"
                        ? "bg-[linear-gradient(135deg,rgba(96,165,250,0.55),rgba(139,92,246,0.62))] text-white"
                        : "bg-black/25 text-white/45 hover:text-white/70",
                    )}
                  >
                    Pago simple
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMode("multiple")}
                    className={cn(
                      "py-2 text-xs font-semibold transition",
                      paymentMode === "multiple"
                        ? "bg-[linear-gradient(135deg,rgba(96,165,250,0.55),rgba(139,92,246,0.62))] text-white"
                        : "bg-black/25 text-white/45 hover:text-white/70",
                    )}
                  >
                    Pago múltiple
                  </button>
                </div>

                {paymentMode === "simple"
                  ? (() => {
                      const simpleAmount = Number(paymentForm.amount || 0);
                      const simpleDiff = liquidarFinalTotal - simpleAmount;
                      const isCashOverpay = simpleDiff < 0 && paymentForm.method === "cash";
                      return (
                        <div className="space-y-2 rounded-2xl border border-blue-300/25 bg-[linear-gradient(135deg,rgba(37,99,235,0.14),rgba(8,11,20,0.96),rgba(2,4,12,0.98))] p-3 shadow-[0_0_40px_rgba(96,165,250,0.12),0_18px_55px_-34px_rgba(0,0,0,1)]">
                          <p className="text-[11px] tracking-[0.18em] text-muted-foreground/70">PAGO SIMPLE</p>
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                            <label className="space-y-1 text-xs font-semibold text-white/55">
                              Monto del pago
                              <div className="relative">
                                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-white/45">
                                  $
                                </span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={formatThousands(paymentForm.amount)}
                                  onChange={(event) => {
                                    setPaymentAmountTouched(true);
                                    setPaymentForm((form) => ({ ...form, amount: event.target.value.replace(/\D/g, "") }));
                                  }}
                                  placeholder="0"
                                  className="h-11 w-full rounded-xl border border-blue-300/25 bg-black/45 pl-7 pr-3 text-base font-bold tabular-nums text-white outline-none placeholder:text-white/35 focus:border-blue-300/55 focus:ring-2 focus:ring-blue-400/15"
                                />
                              </div>
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-white/55">
                              Método
                              <select
                                value={paymentForm.method}
                                onChange={(event) => setPaymentForm((form) => ({ ...form, method: event.target.value }))}
                                className="h-11 w-full rounded-xl border border-blue-300/25 bg-black/45 px-3 text-base text-white outline-none focus:border-blue-300/55 focus:ring-2 focus:ring-blue-400/15"
                              >
                                {paymentOptions.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          {/* Un solo renglón dinámico en vez del recuadro de
                              3 filas (Total final/Monto del pago/Saldo
                              pendiente) — esos dos primeros ya se muestran
                              en el resumen de arriba, repetirlos acá era
                              información duplicada. */}
                          <div className="px-1 text-sm font-semibold">
                            {isCashOverpay ? (
                              <span className="text-emerald-300">Vuelto: {money(Math.abs(simpleDiff))}</span>
                            ) : simpleDiff < 0 ? (
                              <span className="text-rose-300">
                                Sobra {money(Math.abs(simpleDiff))} — no puede superar el total
                              </span>
                            ) : simpleDiff === 0 ? (
                              <div className="space-y-0.5">
                                <div className="font-bold text-emerald-300">Liquidación completa</div>
                                <div className="text-xs font-semibold text-emerald-300/80">Saldo pendiente: $0</div>
                              </div>
                            ) : (
                              <span className="text-rose-300">Saldo pendiente: {money(simpleDiff)}</span>
                            )}
                          </div>
                        </div>
                      );
                    })()
                  : (
                    <MultiMethodPaymentSplit
                      splits={paymentSplits}
                      onChange={setPaymentSplits}
                      paymentOptions={paymentOptions}
                      total={liquidarFinalTotal}
                      allowPartial
                    />
                  )}

                <label className="mt-3 block space-y-1.5 text-xs font-semibold text-white/55">
                  Nota
                  <textarea
                    value={paymentForm.note}
                    onChange={(event) => setPaymentForm((form) => ({ ...form, note: event.target.value }))}
                    placeholder="Opcional"
                    rows={2}
                    className="w-full resize-none rounded-2xl border border-white/[0.08] bg-black/30 px-3 py-3 text-base text-white outline-none placeholder:text-white/32 focus:border-violet-300/35"
                  />
                </label>
              </div>
            </div>
          </AgendaCenteredModal>
        );
      })()}
    </div>
  );
}

function NuevoGastoTab({
  data,
  userEmail,
  onCancel,
  onSaved,
}: {
  data: ReturnType<typeof useCajaData>;
  userEmail: string | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
    amount: "",
    category: "",
    method: "",
    // "Descripción del gasto" — opcional, funciona como aclaración/nota.
    // Reemplaza a los dos campos que había antes (nombre obligatorio +
    // nota opcional aparte): quedaban duplicados, así que se unifican en
    // uno solo.
    description: "",
  });
  const [saving, setSaving] = React.useState(false);
  const GCATEGORIES = [
    "Alquiler",
    "Impuestos y servicios",
    "Insumos",
    "Mercadería",
    "Profesionales",
    "Mantenimiento",
    "Marketing",
    "Equipamiento",
    "Otros",
  ];
  const GMETHODS = [
    "efectivo",
    "transferencia",
    "débito",
    "crédito",
    "mercado pago",
  ];

  async function saveGasto() {
    const amount = parseFloat(form.amount);
    if (!form.category) return toast.error("Elegí el tipo de gasto.");
    if (!amount || amount <= 0)
      return toast.error("El monto debe ser mayor a 0.");
    if (!form.method) return toast.error("Seleccioná el método de pago.");
    const description = form.description.trim();
    setSaving(true);
    // El usuario que registra el gasto se sigue guardando internamente
    // (user_name/created_by) para historial y auditoría, aunque ya no se
    // muestre como campo en el formulario — no hace falta pedirlo, ya se
    // sabe quién está cargando. Misma lógica para la fecha: se toma la
    // fecha y hora actuales al momento de guardar, sin pedirla — created_at
    // ya la registra con precisión de hora, "date" es solo el día para
    // filtros/reportes. name (usado para mostrar el gasto en listados) sale
    // de la descripción si se cargó algo, o del tipo de gasto si no.
    const { error } = await supabase.from("expenses").insert({
      business_id: data.businessId,
      branch_id: data.activeBranchId,
      name: description || form.category,
      amount,
      category: form.category,
      payment_method: form.method || null,
      date: new Date().toISOString().slice(0, 10),
      note: description || null,
      user_name: userEmail ?? "Caja",
      created_by: userEmail ?? "Caja",
    });
    setSaving(false);
    if (error) return toast.error("Error guardando gasto: " + error.message);
    toast.success("✓ Gasto registrado");
    window.dispatchEvent(new CustomEvent("clippr:gasto-guardado"));
    onSaved();
  }

  return (
    <div className="animate-fade-up">
      <Card className="mx-auto w-full max-w-3xl p-3 md:p-3.5">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-foreground">
            Nuevo gasto
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Registrá un egreso de caja.
          </p>
        </div>

        <div className="space-y-3">
          {/* Orden: Tipo de gasto → Monto → Método de pago → Descripción
              (opcional, al final, funciona como nota/aclaración). */}
          <Select
            value={form.category}
            onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
          >
            <SelectTrigger className="h-auto w-full rounded-xl border-white/10 bg-white/[0.04] px-4 py-3 text-base text-foreground focus:border-blue-300/50 focus:ring-0">
              <SelectValue placeholder="Tipo de gasto *" />
            </SelectTrigger>
            <SelectContent>
              {GCATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="Monto *"
            type="number"
            min={0}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-blue-300/50"
          />
          <Select
            value={form.method}
            onValueChange={(v) => setForm((f) => ({ ...f, method: v }))}
          >
            <SelectTrigger className="h-auto w-full rounded-xl border-white/10 bg-white/[0.04] px-4 py-3 text-base text-foreground focus:border-blue-300/50 focus:ring-0">
              <SelectValue placeholder="Método de pago *" />
            </SelectTrigger>
            <SelectContent>
              {GMETHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            placeholder="Descripción del gasto (opcional)"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-blue-300/50"
          />

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.03] px-4 py-3 text-sm font-medium text-muted-foreground transition hover:bg-white/[0.07] hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> Atrás
            </button>
            <button
              type="button"
              onClick={saveGasto}
              disabled={saving}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-rose-500 to-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Registrar gasto
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ApprovalMode({
  data,
  equipoEnabled,
}: {
  data: ReturnType<typeof useCajaData>;
  equipoEnabled: boolean;
}) {
  if (!data.approvalModeEnabled || !equipoEnabled) return null;

  const mode = data.approvalMode;
  const desc: Record<typeof mode, string> = {
    auto: "Automático — el profesional cobra desde su panel y el cobro impacta sin confirmación.",
    manual:
      "Manual — el servicio queda pendiente y caja/recepción lo confirma y cobra.",
  };
  const labelMap: Record<typeof mode, string> = {
    auto: "AUTOMÁTICO",
    manual: "MANUAL",
  };
  const chipCls: Record<typeof mode, string> = {
    auto: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    manual: "border-blue-300/30 bg-blue-300/10 text-blue-200",
  };
  const dotCls: Record<typeof mode, string> = {
    auto: "bg-emerald-400",
    manual: "bg-blue-300",
  };
  const options: { id: typeof mode; label: string; icon: typeof Zap }[] = [
    { id: "auto", label: "Automático", icon: Zap },
    { id: "manual", label: "Manual", icon: Hand },
  ];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Modo de aprobación
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">{desc[mode]}</p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-medium tracking-wide border",
            chipCls[mode],
          )}
        >
          <span className={cn("size-1.5 rounded-full", dotCls[mode])} />
          {labelMap[mode]}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 p-1 rounded-xl bg-white/[0.03] border border-white/5">
        {options.map((o) => {
          const active = mode === o.id;
          return (
            <button
              key={o.id}
              onClick={() => data.setApprovalMode(o.id)}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all",
                active
                  ? "bg-gradient-to-b from-white/[0.08] to-white/[0.02] text-foreground shadow-[0_1px_0_oklch(1_0_0/0.08)_inset]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <o.icon className="size-4 text-blue-300" /> {o.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ─────────── Cierre de caja ──────────────────────────────────────────────────

function paymentMethodLabel(method: string) {
  return PAY_METHOD_LABEL[method as PayMethod] ?? method ?? "Sin método";
}

// Color propio por medio de pago — para que Efectivo/Transferencia/
// Débito/Crédito/QR se distingan de un vistazo en la tabla de servicios,
// nunca como texto plano indistinguible entre sí.
const METODO_BADGE_CLASS: Record<string, string> = {
  cash: "text-emerald-300 bg-emerald-400/10 ring-emerald-400/25",
  transfer: "text-sky-300 bg-sky-400/10 ring-sky-400/25",
  debit: "text-violet-300 bg-violet-400/10 ring-violet-400/25",
  credit: "text-fuchsia-300 bg-fuchsia-400/10 ring-fuchsia-400/25",
  qr: "text-cyan-300 bg-cyan-400/10 ring-cyan-400/25",
  card: "text-slate-300 bg-slate-400/10 ring-slate-400/25",
  mp: "text-sky-300 bg-sky-400/10 ring-sky-400/25",
  cuenta: "text-slate-300 bg-slate-400/10 ring-slate-400/25",
};

function MetodoBadge({
  method,
  amount,
  onClick,
  active,
}: {
  method: string | null | undefined;
  amount?: number | null;
  // Resumen interactivo (sección 4 del pedido): el mismo badge que
  // identifica un medio de pago también sirve de filtro — un clic en
  // "Efectivo $50.000" en el resumen equivale a elegir "Efectivo" en los
  // chips de arriba. Sin onClick, queda como hoy (solo visual).
  onClick?: () => void;
  active?: boolean;
}) {
  const key = normalizeCierreMethodKey(method ?? "cash");
  const classes = cn(
    "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 transition",
    METODO_BADGE_CLASS[key] ?? "text-white/70 bg-white/10 ring-white/20",
    onClick && "cursor-pointer hover:brightness-125",
    active && "ring-2",
  );
  const content = (
    <>
      {paymentMethodLabel(method ?? "cash")}
      {amount != null && (
        <span className="tabular-nums opacity-80">${Math.round(amount).toLocaleString("es-AR")}</span>
      )}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {content}
      </button>
    );
  }
  return <span className={classes}>{content}</span>;
}

// Un cobro con pago múltiple (payments.splits) se muestra como VARIOS
// badges, uno por medio con su importe real — nunca un solo texto
// ambiguo, y nunca se duplica el importe de la venta (cada badge muestra
// su propia fracción, la fila sigue siendo una sola).
function MetodoBadges({ metodo, splits }: { metodo: string | null | undefined; splits: Array<{ method?: string | null; amount?: number | null }> | null | undefined }) {
  const validSplits = (splits ?? []).filter((s) => Number(s?.amount ?? 0) > 0);
  if (validSplits.length === 0) return <MetodoBadge method={metodo} />;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {validSplits.map((s, i) => (
        <MetodoBadge key={i} method={s.method} amount={Number(s.amount ?? 0)} />
      ))}
    </div>
  );
}

type DetalleFiltro = "todos" | "servicios" | "productos" | "gastos" | "retiros";

// Listado línea por línea de servicios/productos/gastos/retiros de UN
// día — compartido entre CierreRevisionDetalle (revisión de una jornada
// PENDIENTE, antes de confirmar: sección 3 del pedido, "poder consultar
// los servicios sin salir de la pantalla de cierre") y CierreDetalleView
// (detalle de un cierre YA guardado). Mismo componente, misma fuente
// (cobrosSnapshot/gastosSnapshot/movimientosManuales ya calculados por
// buildSingleDayCierrePreview) — nunca una lista distinta según de dónde
// se abra.
// Importe de UN cobro que corresponde a un medio de pago puntual — en un
// pago múltiple, nunca el total de la venta, solo la fracción real de ese
// medio (ver distributeCobroByMethod). medio="todos" no filtra nada: pasa
// el monto/propina completos tal cual. `incluido` decide si esta fila
// pertenece al filtro activo (false = esta venta no tuvo nada de ese
// medio, se excluye de la lista filtrada).
function montoParaMedio(
  monto: number,
  propina: number,
  metodo: string | null | undefined,
  splits: Array<{ method?: string | null; amount?: number | null }> | null | undefined,
  medio: string,
): { monto: number; propina: number; incluido: boolean } {
  if (medio === "todos") return { monto, propina, incluido: true };
  const dist = distributeCobroByMethod(monto, propina, metodo, splits);
  const amt = dist[medio];
  const m = amt?.monto ?? 0;
  const t = amt?.propina ?? 0;
  return { monto: m, propina: t, incluido: m > 0 || t > 0 };
}

function CierreMovimientosDetalleList({
  cobros,
  gastos,
  movimientos,
}: {
  cobros: any[];
  gastos: any[];
  movimientos: CajaMovimientoManual[];
}) {
  const [filtro, setFiltro] = React.useState<DetalleFiltro>("todos");
  const [profesionalFiltro, setProfesionalFiltro] = React.useState<string>("todos");
  // "todos" | cash | transfer | debit | credit | qr — mismo vocabulario
  // que ACTIVE_PAY_METHODS, combinable con profesionalFiltro/filtro (las
  // 3 dimensiones se aplican en conjunto, nunca una pisa a la otra).
  const [medioFiltro, setMedioFiltro] = React.useState<string>("todos");

  const hayFiltrosActivos = filtro !== "todos" || profesionalFiltro !== "todos" || medioFiltro !== "todos";
  function restablecerFiltros() {
    setFiltro("todos");
    setProfesionalFiltro("todos");
    setMedioFiltro("todos");
  }

  const retiros = movimientos.filter((m) => m.tipo === "retiro");
  const ingresosManuales = movimientos.filter((m) => m.tipo === "ingreso");
  const { servicios: serviciosRows, productos: productosRows } = splitServiciosYProductos(cobros);
  const profesionales = Array.from(
    new Set([...serviciosRows.map((p) => p.profesional), ...productosRows.map((p) => p.profesional)].filter(Boolean)),
  ) as string[];

  // Profesional primero, medio de pago después — las dos dimensiones se
  // combinan siempre (sección 1 del pedido: "deben funcionar conjuntamente").
  const serviciosPorProfesional =
    profesionalFiltro === "todos" ? serviciosRows : serviciosRows.filter((p) => p.profesional === profesionalFiltro);
  const serviciosFiltrados =
    medioFiltro === "todos"
      ? serviciosPorProfesional
      : serviciosPorProfesional.filter((p: any) => montoParaMedio(p.monto, p.propina, p.metodo, p.splits, medioFiltro).incluido);
  const productosPorProfesional =
    profesionalFiltro === "todos" ? productosRows : productosRows.filter((p) => p.profesional === profesionalFiltro);
  // Sin el filtro de medio — pareja de totalFacturadoProfesional más
  // abajo (los dos sobre el mismo recorte, solo por profesional): si acá
  // se usara la versión ya filtrada por medio, "de los cuales, productos"
  // mostraría un número de otra escala que el total del que depende.
  const totalProductosProfesional = productosPorProfesional.reduce((s, it: any) => s + Number(it.monto ?? 0), 0);
  const productosFiltrados =
    medioFiltro === "todos"
      ? productosPorProfesional
      : productosPorProfesional.filter((it: any) => montoParaMedio(it.monto, 0, it.metodo, it.splits, medioFiltro).incluido);
  const money = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;

  // Gastos/retiros NUNCA se filtran por profesional (no les corresponde:
  // sección 5 del pedido, "no atribuirse a un profesional si no
  // corresponde") — quedan siempre en su propia sección, con todos los
  // movimientos del día, sin importar profesionalFiltro/medioFiltro.

  // ── Resumen inferior ───────────────────────────────────────────────
  // Total general del día: SIEMPRE sobre `cobros` completo, sin ningún
  // filtro — punto de referencia fijo para comparar contra el subtotal.
  const totalGeneralDia = (cobros as any[]).reduce((s, p) => s + Number(p.monto ?? 0), 0);
  const propinasGeneralDia = (cobros as any[]).reduce((s, p) => s + Number(p.propina ?? 0), 0);

  // Cobros de el/los profesional(es) elegido(s), SIN el filtro de medio
  // todavía — es la base para el desglose por medio de pago del resumen
  // (los badges tienen que mostrar SIEMPRE los 5 medios completos, para
  // poder saltar de uno a otro haciendo click, nunca solo el que ya está
  // activo).
  const cobrosPorProfesional = (
    profesionalFiltro === "todos" ? cobros : (cobros as any[]).filter((p) => p.profesional === profesionalFiltro)
  ) as any[];
  const totalFacturadoProfesional = cobrosPorProfesional.reduce((s, p) => s + Number(p.monto ?? 0), 0);
  const propinasProfesional = cobrosPorProfesional.reduce((s, p) => s + Number(p.propina ?? 0), 0);

  // Subtotal filtrado: profesional Y medio de pago combinados — el
  // número que realmente responde "cuánto es esto que estoy viendo ahora".
  const cobrosSubtotal =
    medioFiltro === "todos"
      ? cobrosPorProfesional
      : cobrosPorProfesional.filter((p) => montoParaMedio(p.monto, p.propina, p.metodo, p.splits, medioFiltro).incluido);
  const totalSubtotalFiltrado = cobrosSubtotal.reduce(
    (s, p) => s + montoParaMedio(p.monto, p.propina, p.metodo, p.splits, medioFiltro).monto,
    0,
  );
  const propinasSubtotalFiltrado = cobrosSubtotal.reduce(
    (s, p) => s + montoParaMedio(p.monto, p.propina, p.metodo, p.splits, medioFiltro).propina,
    0,
  );

  // Desglose por medio de pago del/de los profesional(es) elegido(s) —
  // SIEMPRE completo (los 5 medios, incluso en $0), sobre
  // cobrosPorProfesional (no sobre el subtotal ya filtrado por medio):
  // son justamente los botones que permiten cambiar de medio con un
  // click (sección 4 del pedido).
  const desglosePorMedio = React.useMemo(() => {
    const byMethod: Record<string, { monto: number; propina: number }> = {};
    for (const p of cobrosPorProfesional) {
      const dist = distributeCobroByMethod(Number(p.monto ?? 0), Number(p.propina ?? 0), p.metodo, p.splits);
      for (const [key, amt] of Object.entries(dist)) {
        if (!byMethod[key]) byMethod[key] = { monto: 0, propina: 0 };
        byMethod[key].monto += amt.monto;
        byMethod[key].propina += amt.propina;
      }
    }
    return byMethod;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobros, profesionalFiltro]);

  // "Cuánto facturó cada profesional" (sección 3 del pedido) — respeta
  // medioFiltro (si hay un medio elegido, muestra lo que facturó cada uno
  // POR ESE medio), nunca profesionalFiltro (es la lista para elegir
  // profesional). Nunca suma por item de producto (ver comentario de
  // totalGeneralDia más arriba): siempre sobre el cobro completo.
  const facturacionPorProfesional = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const p of cobros as any[]) {
      if (!p.profesional) continue;
      const { monto, incluido } = montoParaMedio(Number(p.monto ?? 0), Number(p.propina ?? 0), p.metodo, p.splits, medioFiltro);
      if (!incluido) continue;
      map.set(p.profesional, (map.get(p.profesional) ?? 0) + monto);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobros, medioFiltro]);

  const filtroChips: Array<{ key: DetalleFiltro; label: string }> = [
    { key: "todos", label: "Todos" },
    { key: "servicios", label: "Servicios" },
    { key: "productos", label: "Productos" },
    { key: "gastos", label: "Gastos" },
    { key: "retiros", label: "Retiros" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {filtroChips.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFiltro(f.key)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-bold ring-1 transition",
              filtro === f.key
                ? "bg-[linear-gradient(135deg,rgba(59,130,246,0.25),rgba(139,92,246,0.25))] text-white ring-violet-200/30"
                : "bg-white/[0.04] text-white/60 ring-white/10 hover:bg-white/[0.07]",
            )}
          >
            {f.label}
          </button>
        ))}
        {profesionales.length > 0 && (
          <select
            value={profesionalFiltro}
            onChange={(e) => setProfesionalFiltro(e.target.value)}
            className="rounded-full border border-white/[0.08] bg-black/40 px-3 py-1.5 text-xs font-semibold text-white/80 outline-none"
          >
            <option value="todos">Todos los profesionales</option>
            {profesionales.map((nombre) => (
              <option key={nombre} value={nombre}>
                {nombre}
              </option>
            ))}
          </select>
        )}
        {hayFiltrosActivos && (
          <button
            type="button"
            onClick={restablecerFiltros}
            className="rounded-full bg-rose-400/10 px-3 py-1.5 text-xs font-bold text-rose-300 ring-1 ring-rose-400/25 transition hover:bg-rose-400/15"
          >
            Restablecer filtros
          </button>
        )}
      </div>

      {/* Filtro por medio de pago — combina con tipo de movimiento y
          profesional, nunca los reemplaza (sección 1 del pedido). */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Medio de pago</span>
        <button
          type="button"
          onClick={() => setMedioFiltro("todos")}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-bold ring-1 transition",
            medioFiltro === "todos"
              ? "bg-white/15 text-white ring-white/30"
              : "bg-white/[0.04] text-white/60 ring-white/10 hover:bg-white/[0.07]",
          )}
        >
          Todos los medios
        </button>
        {ACTIVE_PAY_METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMedioFiltro(m.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-bold ring-1 transition",
              medioFiltro === m.id
                ? cn(METODO_BADGE_CLASS[m.id], "ring-2")
                : "bg-white/[0.04] text-white/60 ring-white/10 hover:bg-white/[0.07]",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {(filtro === "todos" || filtro === "servicios") && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/[0.075] bg-white/[0.03]">
          <div className="p-4 pb-0 text-xs font-bold uppercase tracking-[0.16em] text-white/45">
            Servicios ({serviciosFiltrados.length})
          </div>
          {serviciosFiltrados.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Sin servicios cobrados.</p>
          ) : (
            <>
              {/* Desktop/tablet ancho: tabla de verdad, una fila por servicio
                  cobrado — nunca se mezcla precio de lista/descuento/propina/
                  cobro en una sola cifra. */}
              <div className="hidden overflow-x-auto lg:block">
                <div className="min-w-[980px]">
                  <div className="grid grid-cols-[64px_minmax(120px,1fr)_minmax(100px,0.75fr)_minmax(150px,1.3fr)_95px_90px_120px_90px_minmax(160px,1.1fr)] gap-3 border-y border-white/[0.06] bg-white/[0.02] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                    <div>Hora</div>
                    <div>Cliente</div>
                    <div>Profesional</div>
                    <div>Servicio</div>
                    <div className="text-right">Precio lista</div>
                    <div className="text-right">Descuento</div>
                    <div className="text-right">Cobrado</div>
                    <div className="text-right">Propina</div>
                    <div>Medio de pago</div>
                  </div>
                  {serviciosFiltrados.map((p: any, idx: number) => {
                    const items: any[] = Array.isArray(p.items) ? p.items : [];
                    const servicioNombre =
                      items.filter((it) => !it?.esProducto).map((it) => it.nombre).join(" + ") || p.servicio || "Servicio";
                    const descuento = Number(p.descuento ?? 0);
                    const precioLista = Number(p.precio_lista ?? p.monto ?? 0);
                    // Con un medio de pago elegido y esta venta pagada con
                    // VARIOS medios, el importe/propina a mostrar es SOLO
                    // la fracción de ese medio (nunca el total de la
                    // venta) — precio de lista/descuento describen la
                    // venta completa, no una fracción, así que se ocultan
                    // acá para no mostrar un número de otra escala al
                    // lado del importe parcial.
                    const esSplitParcial = medioFiltro !== "todos" && Array.isArray(p.splits) && p.splits.length > 0;
                    const { monto: montoMostrado, propina: propinaMostrada } = montoParaMedio(
                      Number(p.monto ?? 0),
                      Number(p.propina ?? 0),
                      p.metodo,
                      p.splits,
                      medioFiltro,
                    );
                    return (
                      <div
                        key={`${p.id ?? idx}`}
                        className="grid grid-cols-[64px_minmax(120px,1fr)_minmax(100px,0.75fr)_minmax(150px,1.3fr)_95px_90px_120px_90px_minmax(160px,1.1fr)] items-center gap-3 border-b border-white/[0.05] px-4 py-2.5 text-xs last:border-0 hover:bg-white/[0.02]"
                      >
                        <div className="tabular-nums text-white/55">{p.hora ?? "—"}</div>
                        <div className="truncate font-semibold text-white" title={p.cliente ?? "Cliente"}>
                          {p.cliente ?? "Cliente"}
                        </div>
                        <div className="truncate text-white/70">{p.profesional ?? "—"}</div>
                        <div className="truncate text-white/70" title={servicioNombre}>
                          {servicioNombre}
                          {p.promocion && <div className="truncate text-[10px] text-violet-300/80">Promo: {p.promocion}</div>}
                        </div>
                        <div
                          className={cn(
                            "text-right tabular-nums",
                            descuento > 0 ? "text-white/40 line-through decoration-white/20" : "text-white/35",
                          )}
                        >
                          {esSplitParcial ? "—" : money(precioLista)}
                        </div>
                        <div className="text-right tabular-nums text-amber-300/90">
                          {esSplitParcial ? "—" : descuento > 0 ? `-${money(descuento)}` : "—"}
                        </div>
                        {/* Importe cobrado — destacado: la cifra que de verdad
                            entró a caja, nunca confundida con precio de
                            lista ni propina. Con un medio filtrado, es la
                            fracción real de ESE medio. */}
                        <div className="text-right text-sm font-extrabold tabular-nums text-emerald-300">
                          {money(montoMostrado)}
                        </div>
                        <div className="text-right tabular-nums text-amber-200">
                          {propinaMostrada > 0 ? money(propinaMostrada) : "—"}
                        </div>
                        <div>
                          {medioFiltro === "todos" ? (
                            <MetodoBadges metodo={p.metodo} splits={p.splits} />
                          ) : (
                            <MetodoBadge method={medioFiltro} amount={esSplitParcial ? montoMostrado : undefined} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Celular/tablet angosta: una tarjeta compacta por servicio,
                  con etiqueta + valor en cada campo (nunca un solo texto
                  corrido como antes). */}
              <div className="space-y-2 p-4 lg:hidden">
                {serviciosFiltrados.map((p: any, idx: number) => {
                  const items: any[] = Array.isArray(p.items) ? p.items : [];
                  const servicioNombre =
                    items.filter((it) => !it?.esProducto).map((it) => it.nombre).join(" + ") || p.servicio || "Servicio";
                  const descuento = Number(p.descuento ?? 0);
                  const precioLista = Number(p.precio_lista ?? p.monto ?? 0);
                  const esSplitParcial = medioFiltro !== "todos" && Array.isArray(p.splits) && p.splits.length > 0;
                  const { monto: montoMostrado, propina: propinaMostrada } = montoParaMedio(
                    Number(p.monto ?? 0),
                    Number(p.propina ?? 0),
                    p.metodo,
                    p.splits,
                    medioFiltro,
                  );
                  return (
                    <div key={`${p.id ?? idx}`} className="rounded-xl bg-black/22 px-3.5 py-3 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-white">{p.cliente ?? "Cliente"}</div>
                          <div className="mt-0.5 truncate text-white/50">
                            {p.hora ?? "—"}
                            {p.profesional ? ` · ${p.profesional}` : ""} · {servicioNombre}
                          </div>
                        </div>
                        {medioFiltro === "todos" ? (
                          <MetodoBadges metodo={p.metodo} splits={p.splits} />
                        ) : (
                          <MetodoBadge method={medioFiltro} amount={esSplitParcial ? montoMostrado : undefined} />
                        )}
                      </div>
                      {p.promocion && <div className="mt-1 text-[11px] text-violet-300/80">Promo: {p.promocion}</div>}
                      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg bg-white/[0.03] p-2.5">
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-white/35">Precio de lista</div>
                          <div className={cn("tabular-nums", descuento > 0 ? "text-white/45 line-through decoration-white/20" : "text-white/60")}>
                            {esSplitParcial ? "—" : money(precioLista)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-white/35">Descuento</div>
                          <div className="tabular-nums text-amber-300/90">{esSplitParcial ? "—" : descuento > 0 ? `-${money(descuento)}` : "—"}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-white/35">Cobrado</div>
                          <div className="text-sm font-extrabold tabular-nums text-emerald-300">{money(montoMostrado)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-white/35">Propina</div>
                          <div className="tabular-nums text-amber-200">{propinaMostrada > 0 ? money(propinaMostrada) : "—"}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {(filtro === "todos" || filtro === "productos") && (
        <div className="mt-4 rounded-2xl border border-white/[0.075] bg-white/[0.03] p-4">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/45">
            Productos ({productosFiltrados.length})
          </div>
          <div className="space-y-2">
            {productosFiltrados.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin productos vendidos.</p>
            ) : (
              productosFiltrados.map((it: any) => {
                const { monto: montoMostrado } = montoParaMedio(Number(it.monto ?? 0), 0, it.metodo, it.splits, medioFiltro);
                return (
                  <div key={it.key} className="rounded-xl bg-black/22 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-semibold text-white">
                        {it.nombre ?? "Producto"}
                        {it.cantidad > 1 ? ` x${it.cantidad}` : ""}
                      </span>
                      <span className="font-bold text-emerald-300">{money(montoMostrado)}</span>
                    </div>
                    <div className="mt-1 truncate text-white/45">
                      {it.hora ?? "—"} · {it.cliente ?? "Cliente"}
                      {it.profesional ? ` · ${it.profesional}` : ""}
                      {medioFiltro === "todos" && <> · {paymentMethodLabel(it.metodo ?? "cash")}</>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {(filtro === "todos" || filtro === "servicios" || filtro === "productos") && (
        <div className="mt-4 space-y-3">
          {/* Total general del día (fijo, nunca cambia con los filtros) vs
              subtotal filtrado (sección 5 del pedido: "diferenciar
              claramente" los dos) — ambos sin propina en la cifra
              grande, propina aparte siempre (nunca mezclada). */}
          <div className="rounded-2xl border border-white/[0.075] bg-white/[0.025] p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-white/40">Total general del día</div>
                <div className="mt-0.5 text-lg font-extrabold tabular-nums text-white">{money(totalGeneralDia)}</div>
                <div className="mt-0.5 text-[11px] text-white/40">+ {money(propinasGeneralDia)} de propinas</div>
              </div>
              {/* Solo profesional/medio afectan este subtotal (el chip de
                  tipo de movimiento decide qué SECCIÓN se ve, no cuánto
                  suma el cobrado) — mostrarlo también con solo el tipo
                  activo daría un "subtotal filtrado" idéntico al total
                  general, como si hubiera filtrado algo sin filtrar nada. */}
              {(profesionalFiltro !== "todos" || medioFiltro !== "todos") && (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wide text-violet-300/75">Subtotal filtrado</div>
                  <div className="mt-0.5 text-lg font-extrabold tabular-nums text-violet-200">
                    {money(totalSubtotalFiltrado)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-white/40">+ {money(propinasSubtotalFiltrado)} de propinas</div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.075] bg-white/[0.025] p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/45">
              {profesionalFiltro === "todos" ? "Resumen del equipo" : `Resumen de ${profesionalFiltro}`}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-white/40">Total facturado por servicios</div>
                <div className="mt-0.5 text-base font-extrabold tabular-nums text-emerald-300">
                  {money(totalFacturadoProfesional)}
                </div>
                <div className="mt-0.5 text-[11px] text-white/40">
                  de los cuales, productos (todos los medios): {money(totalProductosProfesional)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-white/40">Propinas (separadas)</div>
                <div className="mt-0.5 text-base font-extrabold tabular-nums text-amber-200">
                  {money(propinasProfesional)}
                </div>
              </div>
            </div>

            <div className="mt-3 border-t border-white/[0.06] pt-3">
              <div className="text-[10px] uppercase tracking-wide text-white/40">
                Por medio de pago (sin propina) — tocá uno para filtrar
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {ACTIVE_PAY_METHODS.map((m) => (
                  <MetodoBadge
                    key={m.id}
                    method={m.id}
                    amount={desglosePorMedio[m.id]?.monto ?? 0}
                    active={medioFiltro === m.id}
                    onClick={() => setMedioFiltro(m.id)}
                  />
                ))}
                {/* Medios legado (tarjeta/Mercado Pago genéricos, solo en
                    pagos viejos — ACTIVE_PAY_METHODS ya no los ofrece para
                    cobros nuevos) — informativo, sin click: no hay chip de
                    "otros" arriba con el que combinarlo. Se muestra para
                    que los 5 badges de arriba más este nunca sumen menos
                    que "Total facturado por servicios". */}
                {Object.entries(desglosePorMedio)
                  .filter(([key, v]) => !ACTIVE_PAY_METHODS.some((m) => m.id === key) && v.monto !== 0)
                  .map(([key, v]) => (
                    <MetodoBadge key={key} method={key} amount={v.monto} />
                  ))}
              </div>
            </div>

            {profesionalFiltro === "todos" && facturacionPorProfesional.length > 0 && (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <div className="text-[10px] uppercase tracking-wide text-white/40">
                  Facturación por profesional{medioFiltro !== "todos" ? ` · ${paymentMethodLabel(medioFiltro)}` : ""} — tocá
                  uno para filtrar
                </div>
                <div className="mt-2 space-y-1.5">
                  {facturacionPorProfesional.map(([nombre, total]) => (
                    <button
                      key={nombre}
                      type="button"
                      onClick={() => setProfesionalFiltro(nombre)}
                      className="flex w-full items-center justify-between rounded-lg bg-white/[0.03] px-3 py-1.5 text-xs transition hover:bg-white/[0.06]"
                    >
                      <span className="text-white/75">{nombre}</span>
                      <span className="font-bold tabular-nums text-emerald-300">{money(total)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {(filtro === "todos" || filtro === "gastos") && (
        <div className="mt-4 rounded-2xl border border-white/[0.075] bg-white/[0.03] p-4">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/45">
            Gastos ({gastos.length})
          </div>
          <div className="space-y-2">
            {gastos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin gastos.</p>
            ) : (
              gastos.map((g: any, idx: number) => (
                <div key={`${g.id ?? idx}`} className="rounded-xl bg-black/22 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-semibold text-white">{g.nombre ?? "Gasto"}</span>
                    <span className="font-bold text-rose-300">-{money(g.monto ?? 0)}</span>
                  </div>
                  <div className="mt-1 truncate text-white/45">
                    {g.hora ?? "—"} · {paymentMethodLabel(g.metodo ?? "cash")}
                    {g.usuario ? ` · ${g.usuario}` : ""}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {(filtro === "todos" || filtro === "retiros") && (
        <div className="mt-4 rounded-2xl border border-white/[0.075] bg-white/[0.03] p-4">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/45">
            Retiros e ingresos manuales ({retiros.length + ingresosManuales.length})
          </div>
          <div className="space-y-2">
            {retiros.length + ingresosManuales.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin retiros ni ingresos manuales.</p>
            ) : (
              [...retiros, ...ingresosManuales]
                .sort((a, b) => (a.hora ?? "").localeCompare(b.hora ?? ""))
                .map((m) => (
                  <div key={m.id} className="rounded-xl bg-black/22 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-semibold text-white">
                        {m.tipo === "retiro" ? "Retiro" : "Ingreso manual"}
                        {m.nota ? ` · ${m.nota}` : ""}
                      </span>
                      <span className={cn("font-bold", m.tipo === "retiro" ? "text-rose-300" : "text-emerald-300")}>
                        {m.tipo === "retiro" ? "-" : "+"}
                        {money(m.monto)}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-white/45">
                      {m.hora ?? "—"} · {paymentMethodLabel(m.metodo === "cuenta" ? "transfer" : "cash")}
                      {m.usuario ? ` · ${m.usuario}` : ""}
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Conciliación de los movimientos del día: cuánto se cobró (con el
// desglose real de pagos múltiples) y cuánto se gastó por cada medio,
// más el desglose completo de la fórmula de "esperado" (efectivo y
// dinero en cuenta por separado) — para poder identificar, término por
// término, qué movimiento explica una diferencia en vez de ver solo el
// resultado final. Alertas: ventas con pago múltiple cuyos splits no
// suman el total cobrado (dato mal cargado, nunca corregido en
// silencio — ver distributeCobroByMethod en caja-cierre.ts).
function CierreConciliacionPanel({ conciliacion }: { conciliacion: Conciliacion }) {
  // Signo ANTES del $ — lado.esperado/v.neto/a.diferencia pueden dar
  // negativos acá (gastos/retiros superando lo cobrado por ese medio, o
  // un reparto de pago múltiple que sumó de menos) y "$-500" se lee como
  // un glitch en una pantalla de conciliación de plata.
  const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.round(Math.abs(v)).toLocaleString("es-AR")}`;
  const metodoEntries = Object.entries(conciliacion.porMetodo).filter(([, v]) => v.cobrado !== 0 || v.gastos !== 0);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-white">Conciliación por medio de pago</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Lo cobrado (venta + propina, con el reparto real de los pagos múltiples) menos los gastos pagados por ese
          mismo medio. Tiene que coincidir con el resumen de caja de arriba — sale de los mismos números.
        </p>
        <div className="mt-2 rounded-xl bg-white/[0.025] ring-1 ring-white/10 overflow-hidden">
          {metodoEntries.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">Sin movimientos este día.</div>
          ) : (
            metodoEntries.map(([key, v]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-3 px-4 py-2 border-b border-white/5 last:border-0 text-xs"
              >
                <span className="text-muted-foreground">{paymentMethodLabel(key)}</span>
                <span className="flex items-center gap-3 tabular-nums">
                  <span className="text-emerald-300">{money(v.cobrado)}</span>
                  {v.gastos > 0 && <span className="text-rose-300">-{money(v.gastos)}</span>}
                  <span className="font-bold text-white">{money(v.neto)}</span>
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SaldoComposicionLado label="Efectivo" lado={conciliacion.efectivo} />
        <SaldoComposicionLado label="Dinero en cuenta" lado={conciliacion.digital} />
      </div>

      {conciliacion.alertas.length > 0 && (
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-3.5 text-xs text-amber-200">
          <div className="font-semibold">
            {conciliacion.alertas.length} venta{conciliacion.alertas.length === 1 ? "" : "s"} con pago múltiple que
            no concilia
          </div>
          <p className="mt-1 text-amber-200/80">
            El reparto cargado para esa venta no suma el total cobrado — mirá el detalle de Servicios arriba para
            corregirlo si hace falta.
          </p>
          <div className="mt-2 space-y-1.5">
            {conciliacion.alertas.map((a, i) => (
              <div key={a.paymentId ?? i} className="flex items-center justify-between gap-2">
                <span>
                  {a.hora ?? "—"} · {a.cliente ?? "Cliente"}
                </span>
                <span className="tabular-nums">
                  vendido {money(a.monto)} · repartido {money(a.splitsSum)} ({a.diferencia > 0 ? "+" : ""}
                  {money(a.diferencia)})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Detalle completo de "Revisar cierre" — compartido entre CierreCajaBtn (la
// jornada en curso) y CerrarDiaAnteriorCard (una jornada pendiente de
// revisión): mismo desglose exacto, sin importar qué fecha se esté
// revisando. Cubre la lista completa del pedido — ingresos totales,
// servicios/productos cobrados, efectivo esperado, Transferencia/Débito/
// Crédito/QR, propinas, gastos, ingresos y retiros manuales, efectivo
// contado (editable) y la diferencia resultante — a partir de UN solo
// cálculo (buildSingleDayCierrePreview), nunca una segunda fuente de
// verdad. Puramente de presentación: no dispara ninguna query ni cierra
// nada por sí mismo.
function CierreRevisionDetalle({
  preview,
  efectivoContado,
  onEfectivoContadoChange,
  saldoReal,
  onSaldoRealChange,
  observacion,
  onObservacionChange,
}: {
  preview: Awaited<ReturnType<typeof buildSingleDayCierrePreview>>;
  efectivoContado: string;
  onEfectivoContadoChange: (v: string) => void;
  saldoReal: string;
  onSaldoRealChange: (v: string) => void;
  observacion: string;
  onObservacionChange: (v: string) => void;
}) {
  const { snapshot, expected, manualMovements, movimientosManuales, conciliacion } = preview;
  const { servicios, productos } = countServiciosYProductos(snapshot.cobrosSnapshot);
  const [showDetalle, setShowDetalle] = React.useState(false);
  const [showConciliacion, setShowConciliacion] = React.useState(false);

  // Cobrado por método, sin propina (detalleMetodos) — ya repartido real
  // entre medios cuando una venta se pagó con pago múltiple (ver
  // distributeCobroByMethod en caja-cierre.ts), nunca una venta entera
  // atribuida a un solo método porque sea el que quedó seteado en el
  // selector "simple" del carrito.
  const cobradoPorMetodo = snapshot.detalleMetodos;

  const efectivoContadoNum = parseMoneyInput(efectivoContado);
  const diferencia = efectivoContadoNum - expected.cashExpected;
  const saldoRealNum = parseMoneyInput(saldoReal);
  const ajusteCuenta = saldoRealNum - expected.digitalExpected;

  return (
    <div className="space-y-4">
      {/* Ingresos totales + desglose por método */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70">
          Ingresos totales
        </div>
        <div className="mt-0.5 text-2xl font-semibold tabular-nums text-emerald-300">
          ${Math.round(snapshot.totalCobrado).toLocaleString("es-AR")}
        </div>
        <div className="mt-2 rounded-xl bg-white/[0.025] ring-1 ring-white/10 overflow-hidden">
          {ACTIVE_PAY_METHODS.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-2 px-4 py-2 border-b border-white/5 last:border-0 text-sm"
            >
              <span className="text-muted-foreground">{m.label}</span>
              <span className="font-semibold tabular-nums">
                ${Math.round(cobradoPorMetodo[m.id]?.ingresos ?? 0).toLocaleString("es-AR")}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Servicios y productos cobrados */}
      <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.025] ring-1 ring-white/10 px-4 py-3">
        <span className="text-sm text-muted-foreground">Servicios y productos cobrados</span>
        <span className="text-sm font-semibold tabular-nums">
          {servicios} servicio{servicios === 1 ? "" : "s"} · {productos} producto{productos === 1 ? "" : "s"}
        </span>
      </div>

      {/* Ver detalle de servicios/productos/gastos/retiros SIN salir de
          esta pantalla de revisión — antes solo mostraba el conteo de
          arriba, para ver el detalle línea por línea había que esperar a
          confirmar el cierre y volver a entrar desde Historial. */}
      <div className="rounded-xl bg-white/[0.025] ring-1 ring-white/10 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowDetalle((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-white/85 transition hover:bg-white/[0.04]"
        >
          <span>Ver detalle de servicios, gastos y retiros</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", showDetalle && "rotate-180")} />
        </button>
        {showDetalle && (
          <div className="border-t border-white/10 p-4">
            <CierreMovimientosDetalleList
              cobros={snapshot.cobrosSnapshot}
              gastos={snapshot.gastosSnapshot}
              movimientos={movimientosManuales}
            />
          </div>
        )}
      </div>

      {/* Conciliación — por medio de pago + desglose de la fórmula de
          efectivo/cuenta esperados + alertas de pagos múltiples que no
          cierran, para poder identificar qué movimiento explica una
          diferencia antes de confirmar. */}
      <div className="rounded-xl bg-white/[0.025] ring-1 ring-white/10 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowConciliacion((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-white/85 transition hover:bg-white/[0.04]"
        >
          <span className="flex items-center gap-2">
            Conciliación
            {conciliacion.alertas.length > 0 && (
              <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/30">
                {conciliacion.alertas.length} alerta{conciliacion.alertas.length === 1 ? "" : "s"}
              </span>
            )}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", showConciliacion && "rotate-180")} />
        </button>
        {showConciliacion && (
          <div className="border-t border-white/10 p-4">
            <CierreConciliacionPanel conciliacion={conciliacion} />
          </div>
        )}
      </div>

      {/* Propinas — del profesional, nunca de la facturación, pero sí
          plata real que entró a caja y hay que dejar constancia. */}
      <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.025] ring-1 ring-white/10 px-4 py-3">
        <span className="text-sm text-muted-foreground">Propinas</span>
        <span className="text-lg font-semibold tabular-nums text-amber-200">
          ${Math.round(snapshot.totalPropinas).toLocaleString("es-AR")}
        </span>
      </div>

      {/* Gastos */}
      <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.025] ring-1 ring-white/10 px-4 py-3">
        <span className="text-sm text-muted-foreground">Gastos</span>
        <span className="text-lg font-semibold tabular-nums text-rose-300">
          -${Math.round(snapshot.totalGastos).toLocaleString("es-AR")}
        </span>
      </div>

      {/* Ingresos y retiros manuales (cash_movements) — separados de
          gastos/adelantos, que ya se ven arriba y en Movimientos. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white/[0.025] ring-1 ring-white/10 px-4 py-3">
          <div className="text-xs text-muted-foreground">Ingresos manuales</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-300">
            +${Math.round(manualMovements.ingresos).toLocaleString("es-AR")}
          </div>
        </div>
        <div className="rounded-xl bg-white/[0.025] ring-1 ring-white/10 px-4 py-3">
          <div className="text-xs text-muted-foreground">Retiros manuales</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums text-rose-300">
            -${Math.round(manualMovements.retiros).toLocaleString("es-AR")}
          </div>
        </div>
      </div>

      {/* Efectivo esperado en caja */}
      <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.035] ring-1 ring-white/10 px-4 py-3">
        <span className="text-sm text-muted-foreground">Efectivo esperado en caja</span>
        <span className="text-lg font-semibold tabular-nums">
          ${Math.round(expected.cashExpected).toLocaleString("es-AR")}
        </span>
      </div>

      {/* Efectivo contado — editable, precargado con lo esperado por el padre */}
      <div>
        <div className="text-sm font-semibold">Efectivo contado</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Contá el efectivo de la caja e ingresá el monto real.
        </p>
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 focus-within:border-blue-300/40">
          <span className="text-muted-foreground/70">$</span>
          <input
            type="text"
            inputMode="numeric"
            value={efectivoContado}
            onChange={(e) => onEfectivoContadoChange(e.target.value.replace(/[^\d.,]/g, ""))}
            className="w-full bg-transparent text-sm outline-none tabular-nums"
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Si coincide con lo esperado, no se registra diferencia.
        </p>
      </div>

      {/* Diferencia */}
      <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.035] ring-1 ring-white/10 px-4 py-3">
        <span className="text-sm text-muted-foreground">
          {diferencia === 0 ? "Diferencia" : diferencia > 0 ? "Sobra" : "Falta"}
        </span>
        <span
          className={cn(
            "text-lg font-semibold tabular-nums",
            diferencia === 0 ? "text-white" : diferencia > 0 ? "text-emerald-300" : "text-rose-300",
          )}
        >
          ${Math.round(Math.abs(diferencia)).toLocaleString("es-AR")}
        </span>
      </div>

      {/* Dinero en cuenta — a diferencia del efectivo, NO se resetea: el
          saldo esperado ya arrastra el carry-forward del último cierre (ver
          getDigitalCarryForward). Acá solo se deja constancia del saldo
          real al momento de cerrar; el ajuste nunca se mezcla con la
          diferencia de efectivo. */}
      <div className="rounded-xl bg-white/[0.02] ring-1 ring-white/10 px-4 py-3 space-y-3">
        <div>
          <div className="text-sm font-semibold text-sky-200">Dinero en banco</div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">Saldo esperado</span>
          <span className="text-lg font-semibold tabular-nums text-sky-300">
            ${Math.round(expected.digitalExpected).toLocaleString("es-AR")}
          </span>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Saldo real en cuenta</label>
          <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 focus-within:border-blue-300/40">
            <span className="text-muted-foreground/70">$</span>
            <input
              type="text"
              inputMode="numeric"
              value={saldoReal}
              onChange={(e) => onSaldoRealChange(e.target.value.replace(/[^\d.,]/g, ""))}
              className="w-full bg-transparent text-sm outline-none tabular-nums"
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Ingresá el saldo que ves actualmente en tu cuenta. Si coincide con lo esperado,
            no se registra ningún ajuste.
          </p>
        </div>

        {ajusteCuenta !== 0 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Ajuste</span>
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                ajusteCuenta > 0 ? "text-emerald-300" : "text-rose-300",
              )}
            >
              {ajusteCuenta > 0 ? "+" : "-"}$
              {Math.round(Math.abs(ajusteCuenta)).toLocaleString("es-AR")}
            </span>
          </div>
        )}
      </div>

      <div>
        <label className="text-xs text-muted-foreground">
          Observación{diferencia !== 0 ? " — obligatoria por la diferencia de efectivo" : " (opcional)"}
        </label>
        <textarea
          value={observacion}
          onChange={(e) => onObservacionChange(e.target.value)}
          rows={2}
          placeholder={
            diferencia !== 0
              ? "Contá qué pasó con la diferencia (faltante/sobrante) antes de confirmar."
              : "Novedades del día, diferencias, etc."
          }
          className={cn(
            "mt-1 w-full rounded-xl border px-3 py-2.5 text-sm outline-none resize-none bg-white/[0.03] focus:border-blue-300/40",
            diferencia !== 0 && !observacion.trim() ? "border-amber-400/40" : "border-white/10",
          )}
        />
      </div>
    </div>
  );
}

// Resumen final + segunda confirmación antes de registrar el cierre
// (sección 5 del pedido: "Antes de finalizar, solicitar confirmación") —
// un solo clic en "Confirmar cierre de caja" nunca alcanza para escribir
// en caja_cierres.
function CierreConfirmarStep({
  fecha,
  diferencia,
  ajusteCuenta,
  saving,
  onVolver,
  onConfirmar,
}: {
  fecha: string;
  diferencia: number;
  ajusteCuenta: number;
  saving: boolean;
  onVolver: () => void;
  onConfirmar: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-amber-400/10 ring-1 ring-amber-400/25 px-4 py-3">
        <p className="text-sm font-semibold text-amber-200">
          ¿Confirmás el cierre de caja del {fechaDDMMYYYY(fecha)}?
        </p>
        <p className="mt-1 text-xs text-amber-200/70">
          Una vez confirmado, la jornada queda "Cerrada" con el detalle de movimientos conservado.
          Para corregir algo después hay que reabrirla — queda registrado quién y cuándo lo hizo.
        </p>
      </div>
      {(diferencia !== 0 || ajusteCuenta !== 0) && (
        <div className="space-y-2 text-sm">
          {diferencia !== 0 && (
            <div className="flex items-center justify-between rounded-xl bg-white/[0.03] ring-1 ring-white/10 px-4 py-2.5">
              <span className="text-muted-foreground">{diferencia > 0 ? "Sobrante de efectivo" : "Faltante de efectivo"}</span>
              <span className={cn("font-semibold tabular-nums", diferencia > 0 ? "text-emerald-300" : "text-rose-300")}>
                ${Math.round(Math.abs(diferencia)).toLocaleString("es-AR")}
              </span>
            </div>
          )}
          {ajusteCuenta !== 0 && (
            <div className="flex items-center justify-between rounded-xl bg-white/[0.03] ring-1 ring-white/10 px-4 py-2.5">
              <span className="text-muted-foreground">Ajuste de cuenta</span>
              <span className={cn("font-semibold tabular-nums", ajusteCuenta > 0 ? "text-emerald-300" : "text-rose-300")}>
                {ajusteCuenta > 0 ? "+" : "-"}${Math.round(Math.abs(ajusteCuenta)).toLocaleString("es-AR")}
              </span>
            </div>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onVolver}
          disabled={saving}
          className="flex-1 rounded-xl border border-white/[0.09] bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/[0.08] disabled:opacity-50"
        >
          Volver a revisar
        </button>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={saving}
          className="flex-1 rounded-xl px-4 py-3 text-sm font-bold bg-gradient-to-b from-blue-400 to-violet-500 text-white hover:brightness-105 disabled:opacity-50 transition-all"
        >
          {saving ? "Guardando…" : "Sí, confirmar cierre"}
        </button>
      </div>
    </div>
  );
}

function CierreCajaBtn({
  businessId,
  branchId,
  userEmail,
  onCajaCerrada,
  cajaAbiertaDesde,
  cajaRangeStartDate,
}: {
  businessId: string | null;
  branchId: string | null;
  userEmail: string | null;
  onCajaCerrada: () => void;
  cajaAbiertaDesde: string;
  // Fecha (YYYY-MM-DD) que identifica la fila de caja_cierres a cerrar —
  // la de apertura real, NO necesariamente "hoy" (una caja vencida sigue
  // abierta desde un día anterior; cerrarla tiene que actualizar ESA fila,
  // no crear una nueva para hoy). Este botón SIEMPRE cierra exactamente
  // ese único día calendario (closeSingleDayCierre), nunca se extiende a
  // ningún otro día — ver buildSingleDayCierrePreview/closeSingleDayCierre
  // en caja-cierre.ts.
  cajaRangeStartDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  const [efectivoContado, setEfectivoContado] = useState("");
  const [contadoTouched, setContadoTouched] = useState(false);
  const [saldoReal, setSaldoReal] = useState("");
  const [saldoRealTouched, setSaldoRealTouched] = useState(false);
  // Sección 5 del pedido: un clic en "Confirmar cierre de caja" nunca
  // alcanza — primero muestra un resumen final (CierreConfirmarStep) y
  // recién un segundo clic ahí dispara closeSingleDayCierre.
  const [confirmStep, setConfirmStep] = useState(false);

  // Vista previa propia, acotada EXACTAMENTE a cajaRangeStartDate — nunca
  // los `paymentsToday`/`expensesToday` acumulados de la pantalla (esos
  // sí deben seguir incluyendo todo el backlog sin cerrar para "Efectivo/
  // Dinero esperado" en otras tarjetas, pero este modal cierra un día
  // puntual y no puede mezclar otro día en el snapshot que guarda).
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof buildSingleDayCierrePreview>> | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    if (!open || !businessId) return;
    let cancelled = false;
    setLoadingPreview(true);
    buildSingleDayCierrePreview(businessId, branchId, cajaRangeStartDate)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((e) => {
        if (!cancelled) toast.error((e as Error).message || "No se pudo calcular el cierre.");
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, businessId, branchId, cajaRangeStartDate]);

  const expected = preview?.expected ?? { cashExpected: 0, cashOutflows: 0, cashInflows: 0, digitalExpected: 0, digitalOutflows: 0 };

  // Precarga "Efectivo contado"/"Saldo real en cuenta" con lo esperado
  // apenas se conoce, pero solo una vez — si el usuario ya escribió algo
  // (contadoTouched/saldoRealTouched), no se le pisa lo que tipeó cada vez
  // que expected se recalcula (ej. llega un cobro nuevo mientras el modal
  // está abierto).
  useEffect(() => {
    if (!open || contadoTouched || !preview) return;
    setEfectivoContado(String(Math.round(expected.cashExpected)));
  }, [open, contadoTouched, preview, expected.cashExpected]);

  useEffect(() => {
    if (!open || saldoRealTouched || !preview) return;
    setSaldoReal(String(Math.round(expected.digitalExpected)));
  }, [open, saldoRealTouched, preview, expected.digitalExpected]);

  const efectivoContadoNum = parseMoneyInput(efectivoContado);
  const diferencia = efectivoContadoNum - expected.cashExpected;
  const saldoRealNum = parseMoneyInput(saldoReal);
  const ajusteCuenta = saldoRealNum - expected.digitalExpected;
  const obsRequeridaFalta = diferencia !== 0 && !obs.trim();

  function cerrarModal() {
    setOpen(false);
    setConfirmStep(false);
    setContadoTouched(false);
    setSaldoRealTouched(false);
  }

  async function confirmar() {
    if (saving || !businessId || !preview) return;
    setSaving(true);
    try {
      const result = await closeSingleDayCierre({
        businessId,
        branchId,
        dateStr: cajaRangeStartDate,
        closedBy: userEmail || "Caja",
        observacion: obs,
        efectivoContado: efectivoContadoNum,
        saldoReal: saldoRealNum,
      });
      if (result.alreadyClosed) {
        toast.info("La caja ya está cerrada");
        cerrarModal();
        onCajaCerrada();
        return;
      }
      if (!result.closed) {
        toast.error("No se pudo guardar el cierre.");
        return;
      }
      toast.success("Cierre registrado correctamente");
      cerrarModal();
      setObs("");
      setEfectivoContado("");
      setSaldoReal("");
      setPreview(null);
      onCajaCerrada(); // ← bloquea la pantalla inmediatamente
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-bold transition-all duration-200 bg-white/[0.035] text-foreground border border-white/14 hover:-translate-y-0.5 hover:bg-white/[0.065] hover:border-white/20 shadow-[0_12px_40px_-28px_rgba(0,0,0,0.9)]"
      >
        <Wallet className="size-4 text-white/80 transition-transform group-hover:scale-110" />
        Cerrar caja
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold">{confirmStep ? "Confirmar cierre de caja" : "Revisar cierre"}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Caja abierta desde {cajaAbiertaDesde}
                </p>
              </div>
              <button
                type="button"
                onClick={cerrarModal}
                className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-sm"
              >
                Cancelar
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto p-5 space-y-4">
              {!preview || loadingPreview ? (
                <div className="py-10 text-center text-sm text-muted-foreground">Calculando…</div>
              ) : confirmStep ? (
                <CierreConfirmarStep
                  fecha={cajaRangeStartDate}
                  diferencia={diferencia}
                  ajusteCuenta={ajusteCuenta}
                  saving={saving}
                  onVolver={() => setConfirmStep(false)}
                  onConfirmar={confirmar}
                />
              ) : (
                <>
                  <CierreRevisionDetalle
                    preview={preview}
                    efectivoContado={efectivoContado}
                    onEfectivoContadoChange={(v) => {
                      setContadoTouched(true);
                      setEfectivoContado(v);
                    }}
                    saldoReal={saldoReal}
                    onSaldoRealChange={(v) => {
                      setSaldoRealTouched(true);
                      setSaldoReal(v);
                    }}
                    observacion={obs}
                    onObservacionChange={setObs}
                  />
                  <button
                    type="button"
                    onClick={() => setConfirmStep(true)}
                    disabled={obsRequeridaFalta}
                    title={obsRequeridaFalta ? "Contá qué pasó con la diferencia antes de continuar" : undefined}
                    className="w-full inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold bg-gradient-to-b from-blue-400 to-violet-500 text-white hover:brightness-105 disabled:opacity-50 transition-all"
                  >
                    Confirmar cierre de caja
                  </button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// Cerrar un día PASADO puntual (ej. se quedó sin cerrar varios días y
// ahora hay que ponerse al día uno por uno) sin mezclarlo con "hoy" ni con
// ningún otro día — a diferencia de "Caja vencida"/CierreCajaBtn, que
// siempre extiende el cierre hasta el instante actual porque asume un
// backlog continuo sin cortes intermedios. Acá el usuario elige una fecha
// estrictamente anterior a hoy, ve una vista previa (solo lectura,
// ingresos/efectivo/transferencia/gastos/total) y recién después confirma
// — nunca se dispara un cierre solo. No deja elegir un día que ya tiene un
// cierre guardado (evita recontar los mismos movimientos dos veces).
function CerrarDiaAnteriorCard({
  businessId,
  branchId,
  userEmail,
  cierresExistentes,
  jumpToDate,
  onJumped,
  onCierreGuardado,
}: {
  businessId: string | null;
  branchId: string | null;
  userEmail: string | null;
  cierresExistentes: any[];
  // Fecha a la que hay que saltar y mostrar su vista previa automáticamente
  // (viene del aviso "Caja vencida") — null en el uso normal, donde el
  // usuario elige la fecha a mano con el selector de abajo.
  jumpToDate?: string | null;
  onJumped?: () => void;
  onCierreGuardado: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof buildSingleDayCierrePreview>> | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [efectivoContado, setEfectivoContado] = useState("");
  const [contadoTouched, setContadoTouched] = useState(false);
  const [saldoReal, setSaldoReal] = useState("");
  const [saldoRealTouched, setSaldoRealTouched] = useState(false);
  const [obs, setObs] = useState("");
  // Sección 5 del pedido: resumen final + segundo clic antes de confirmar.
  const [confirmStep, setConfirmStep] = useState(false);

  const closedDates = useMemo(
    () => new Set(cierresExistentes.filter((c) => isCajaCerradaRow(c)).map((c) => c.fecha)),
    [cierresExistentes],
  );
  const yaCerrado = selectedDate ? closedDates.has(selectedDate) : false;

  function resetReview() {
    setPreview(null);
    setConfirmStep(false);
    setContadoTouched(false);
    setSaldoRealTouched(false);
    setEfectivoContado("");
    setSaldoReal("");
    setObs("");
  }

  async function verVistaPrevia(dateOverride?: string) {
    const date = dateOverride ?? selectedDate;
    if (!businessId || !date || closedDates.has(date)) return;
    setLoadingPreview(true);
    resetReview();
    try {
      const result = await buildSingleDayCierrePreview(businessId, branchId, date);
      setPreview(result);
    } catch (e) {
      toast.error((e as Error).message || "No se pudo calcular la vista previa.");
    } finally {
      setLoadingPreview(false);
    }
  }

  useEffect(() => {
    if (!jumpToDate) return;
    setSelectedDate(jumpToDate);
    void verVistaPrevia(jumpToDate);
    onJumped?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToDate]);

  // Sección 7 del pedido: "si llegan pagos atrasados de una jornada
  // pendiente, actualizar su vista previa y advertir el cambio" — mientras
  // el detalle de ESTA fecha está abierto, un pago/gasto nuevo (de
  // cualquier dispositivo) recalcula el preview solo, sin pisar lo que el
  // usuario ya tipeó en efectivo/saldo/observación, y avisa si algo
  // relevante cambió. Vuelve al detalle (sale de confirmStep) para que no
  // confirme un resumen ya desactualizado.
  const previewRef = React.useRef(preview);
  previewRef.current = preview;
  useEffect(() => {
    if (!businessId || !selectedDate || !preview || yaCerrado) return;
    async function refreshSilently() {
      if (!businessId) return;
      try {
        const fresh = await buildSingleDayCierrePreview(businessId, branchId, selectedDate);
        const prev = previewRef.current;
        const changed =
          !prev ||
          prev.snapshot.cantidadCobros !== fresh.snapshot.cantidadCobros ||
          Math.round(prev.snapshot.totalCobrado) !== Math.round(fresh.snapshot.totalCobrado) ||
          Math.round(prev.snapshot.totalGastos) !== Math.round(fresh.snapshot.totalGastos);
        setPreview(fresh);
        if (changed) {
          toast.info(`Los movimientos del ${fechaDDMMYYYY(selectedDate)} cambiaron — se actualizó la vista previa.`);
          setConfirmStep(false);
        }
      } catch {
        // Red de seguridad: si falla, el usuario sigue viendo el último
        // preview calculado — nunca rompe la revisión en curso.
      }
    }
    const channel = supabase
      .channel(`cierre-dia-anterior-${businessId}-${selectedDate}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments", filter: `business_id=eq.${businessId}` },
        () => void refreshSilently(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expenses", filter: `business_id=eq.${businessId}` },
        () => void refreshSilently(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, branchId, selectedDate, !!preview, yaCerrado]);

  // Precarga el efectivo/saldo contado con lo esperado, igual que
  // CierreCajaBtn — una sola vez, sin pisar lo que el usuario ya escribió.
  useEffect(() => {
    if (contadoTouched || !preview) return;
    setEfectivoContado(String(Math.round(preview.expected.cashExpected)));
  }, [contadoTouched, preview]);
  useEffect(() => {
    if (saldoRealTouched || !preview) return;
    setSaldoReal(String(Math.round(preview.expected.digitalExpected)));
  }, [saldoRealTouched, preview]);

  const efectivoContadoNum = parseMoneyInput(efectivoContado);
  const diferencia = preview ? efectivoContadoNum - preview.expected.cashExpected : 0;
  const saldoRealNum = parseMoneyInput(saldoReal);
  const ajusteCuenta = preview ? saldoRealNum - preview.expected.digitalExpected : 0;
  const obsRequeridaFalta = diferencia !== 0 && !obs.trim();

  async function confirmarCierre() {
    if (!businessId || !selectedDate || !preview) return;
    setConfirming(true);
    try {
      const result = await closeSingleDayCierre({
        businessId,
        branchId,
        dateStr: selectedDate,
        closedBy: userEmail || "Desconocido",
        observacion: obs,
        efectivoContado: efectivoContadoNum,
        saldoReal: saldoRealNum,
      });
      if (result.alreadyClosed) {
        toast.error("Ese día ya tiene un cierre guardado.");
      } else if (result.closed) {
        toast.success(`Caja del ${fechaDDMMYYYY(selectedDate)} cerrada correctamente.`);
        resetReview();
        setSelectedDate("");
        onCierreGuardado();
      } else {
        toast.error("No se pudo guardar el cierre.");
      }
    } catch (e) {
      toast.error((e as Error).message || "No se pudo cerrar ese día.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="mt-4 rounded-[28px] border border-white/[0.085] bg-black/20 p-5">
      <p className="text-sm font-bold text-white/85">Revisar un día anterior</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Para ponerse al día con jornadas pendientes de revisión, una por una — cada cierre queda
        acotado exclusivamente a la fecha elegida, sin mezclar movimientos de otros días.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
            Fecha a revisar
          </label>
          <input
            type="date"
            value={selectedDate}
            max={cajaDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000))}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              resetReview();
            }}
            className="h-10 rounded-xl border border-white/[0.09] bg-[#070A13]/80 px-3 text-sm text-white outline-none focus:border-violet-300/35"
          />
        </div>
        <button
          type="button"
          disabled={!selectedDate || yaCerrado || loadingPreview}
          onClick={() => verVistaPrevia()}
          className="h-10 rounded-xl border border-white/[0.09] bg-white/[0.05] px-4 text-sm font-bold text-white/85 transition hover:bg-white/[0.09] disabled:opacity-40"
        >
          {loadingPreview ? "Calculando…" : "Revisar cierre"}
        </button>
      </div>

      {yaCerrado && (
        <p className="mt-3 text-sm font-semibold text-amber-300">
          El {fechaDDMMYYYY(selectedDate)} ya tiene un cierre guardado — elegí otra fecha.
        </p>
      )}

      {preview && !yaCerrado && (
        <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
          <p className="text-sm font-bold text-white">
            {confirmStep ? "Confirmar cierre de caja" : "Revisar cierre"} — {fechaDDMMYYYY(selectedDate)}
          </p>
          <div className="mt-3">
            {confirmStep ? (
              <CierreConfirmarStep
                fecha={selectedDate}
                diferencia={diferencia}
                ajusteCuenta={ajusteCuenta}
                saving={confirming}
                onVolver={() => setConfirmStep(false)}
                onConfirmar={confirmarCierre}
              />
            ) : (
              <>
                <CierreRevisionDetalle
                  preview={preview}
                  efectivoContado={efectivoContado}
                  onEfectivoContadoChange={(v) => {
                    setContadoTouched(true);
                    setEfectivoContado(v);
                  }}
                  saldoReal={saldoReal}
                  onSaldoRealChange={(v) => {
                    setSaldoRealTouched(true);
                    setSaldoReal(v);
                  }}
                  observacion={obs}
                  onObservacionChange={setObs}
                />
                <button
                  type="button"
                  disabled={obsRequeridaFalta}
                  title={obsRequeridaFalta ? "Contá qué pasó con la diferencia antes de continuar" : undefined}
                  onClick={() => setConfirmStep(true)}
                  className="mt-4 h-10 w-full rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 text-sm font-extrabold text-emerald-300 transition hover:bg-emerald-400/15 disabled:opacity-50"
                >
                  {`Confirmar cierre de caja del ${fechaDDMMYYYY(selectedDate)}`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Detalle de un cierre — siempre se reconstruye EN VIVO desde payments/
// expenses/cash_movements (vía buildSingleDayCierrePreview), nunca desde
// el cobros_snapshot/gastos_snapshot guardado: así cualquier cierre
// (viejo o nuevo) muestra el mismo nivel de detalle real, y si algo
// cambió después del cierre (un pago editado, por ejemplo) se nota como
// advertencia en vez de mostrarse calladamente distinto del total
// oficial guardado.
function CierreDetalleView({
  cierre,
  businessId,
  branchId,
  onVolver,
  cierreEventos,
  getCierreObservacion,
  fechaDetalleLabel,
  tipoCierreLabel,
  actor,
  onReabrir,
  puedeReabrir,
  reabriendo,
}: {
  cierre: any;
  businessId: string | null;
  branchId: string | null;
  onVolver: () => void;
  cierreEventos: (c: any) => any[];
  getCierreObservacion: (c: any) => string | null;
  fechaDetalleLabel: (fecha?: string | null) => string;
  tipoCierreLabel: (c: any) => string;
  actor: (value?: string | null) => string;
  onReabrir: () => void;
  puedeReabrir: boolean;
  reabriendo: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof buildSingleDayCierrePreview>> | null>(null);

  const fecha = cierre?.fecha ?? null;

  useEffect(() => {
    if (!businessId || !fecha) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    buildSingleDayCierrePreview(businessId, branchId, fecha)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, branchId, fecha]);

  const snapshot = preview?.snapshot ?? null;
  const movimientos = preview?.movimientosManuales ?? [];
  const cobros = (snapshot?.cobrosSnapshot ?? []) as any[];
  const gastos = (snapshot?.gastosSnapshot ?? []) as any[];
  const retiros = movimientos.filter((m) => m.tipo === "retiro");
  const ingresosManuales = movimientos.filter((m) => m.tipo === "ingreso");

  // detalleMetodosRecibido (a diferencia de detalleMetodos) suma cobro +
  // propina por método — "Efectivo"/"Transferencias"/etc tienen que
  // mostrar la plata que de verdad entró por ese medio, propina incluida,
  // nunca solo la facturación. "Ingresos totales" (abajo) sigue siendo
  // pura facturación — las dos cosas conviven sin pisarse.
  const metodosRecibidos = (snapshot?.detalleMetodosRecibido ?? {}) as Record<string, CierreMetodoDetalle>;
  const metodoRecibido = (key: string) => metodosRecibidos[key]?.ingresos ?? 0;
  const metodosConocidos = ["cash", "transfer", "debit", "credit", "qr"];
  const otrosMetodos = Object.entries(metodosRecibidos).filter(([k]) => !metodosConocidos.includes(k));
  const otrosTotal = otrosMetodos.reduce((s, [, v]) => s + (v?.ingresos ?? 0), 0);

  const ingresosTotales = Number(snapshot?.totalCobrado ?? 0);
  const totalPropinas = Number(snapshot?.totalPropinas ?? 0);
  const totalRecibido = Number(snapshot?.totalRecibido ?? 0);
  const totalGastos = Number(snapshot?.totalGastos ?? 0);
  // Ingreso/retiro de efectivo: EXCLUSIVAMENTE movimientos manuales de
  // caja (cash_movements, method="efectivo") — nunca cobros. Un cobro en
  // efectivo entra por la tarjeta "Efectivo" (fila 2), no acá.
  const ingresoEfectivoManual = ingresosManuales
    .filter((m) => m.metodo !== "cuenta")
    .reduce((s, m) => s + m.monto, 0);
  const retiroEfectivoManual = retiros.filter((m) => m.metodo !== "cuenta").reduce((s, m) => s + m.monto, 0);
  const dineroEnCuentaRecibido = Object.entries(metodosRecibidos)
    .filter(([k]) => k !== "cash")
    .reduce((s, [, v]) => s + (v?.ingresos ?? 0), 0);

  const totalGuardado = Number(cierre?.total_cobrado ?? 0);
  const hayDiferenciaConLoGuardado = !loading && Math.abs(ingresosTotales - totalGuardado) >= 1;

  const cierreEvt = [...cierreEventos(cierre)].reverse().find((e: any) => e?.tipo === "cierre");
  const efectivoContado = cierre?.efectivo_contado;
  const diferenciaEfectivo = cierreEvt?.diferencia ?? null;
  const observacion = getCierreObservacion(cierre);
  const money = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;

  // Fila 1: facturación + los dos movimientos manuales de efectivo.
  const filaIngresosYMovimientos = [
    { l: "Ingresos totales", v: money(ingresosTotales), cls: "text-emerald-300" },
    { l: "Gastos", v: money(totalGastos), cls: "text-rose-300" },
    { l: "Ingreso de efectivo", v: money(ingresoEfectivoManual), cls: "text-emerald-300" },
    { l: "Retiro de efectivo", v: money(retiroEfectivoManual), cls: "text-rose-300" },
  ];
  // Fila 2: todos los medios de pago juntos — cobro + propina por medio.
  const filaMedios = [
    { l: "Efectivo", v: money(metodoRecibido("cash")), cls: "text-white" },
    { l: "Transferencias", v: money(metodoRecibido("transfer")), cls: "text-white" },
    { l: "Débito", v: money(metodoRecibido("debit")), cls: "text-white" },
    { l: "Crédito", v: money(metodoRecibido("credit")), cls: "text-white" },
    { l: "QR", v: money(metodoRecibido("qr")), cls: "text-white" },
    ...(otrosTotal > 0 ? [{ l: "Otros medios", v: money(otrosTotal), cls: "text-white" }] : []),
  ];
  // Fila 3: propinas separadas de la facturación + los dos totales que
  // tienen que coincidir con la plata real (efectivo esperado/cuenta).
  const filaPropinasYTotales = [
    { l: "Propinas recibidas", v: money(totalPropinas), cls: "text-amber-300" },
    { l: "Total de dinero recibido", v: money(totalRecibido), cls: "text-emerald-300" },
    { l: "Dinero recibido en cuenta", v: money(dineroEnCuentaRecibido), cls: "text-white" },
  ];

  return (
    <div className="pt-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onVolver}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-white/70 transition hover:bg-white/[0.08] hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Historial
          </button>
          <div className="mt-2.5 text-lg font-extrabold text-white">{fechaDetalleLabel(fecha)}</div>
        </div>
        {renderEstadoPill(cierre)}
      </div>

      {hayDiferenciaConLoGuardado && (
        <div className="mb-4 rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-xs text-amber-200">
          Este cierre se registró con {money(totalGuardado)}, pero los movimientos actuales de este día suman{" "}
          {money(ingresosTotales)}. No se modificó el cierre automáticamente — si la diferencia no corresponde a un
          error, puede deberse a un movimiento agregado o editado después del cierre.
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {filaIngresosYMovimientos.map((k) => (
              <div key={k.l} className="rounded-2xl border border-white/[0.075] bg-white/[0.035] p-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{k.l}</div>
                <div className={cn("mt-1 text-base font-extrabold tabular-nums", k.cls)}>{k.v}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {filaMedios.map((k) => (
              <div key={k.l} className="rounded-2xl border border-white/[0.075] bg-white/[0.035] p-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{k.l}</div>
                <div className={cn("mt-1 text-base font-extrabold tabular-nums", k.cls)}>{k.v}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            {filaPropinasYTotales.map((k) => (
              <div key={k.l} className="rounded-2xl border border-white/[0.075] bg-white/[0.035] p-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{k.l}</div>
                <div className={cn("mt-1 text-base font-extrabold tabular-nums", k.cls)}>{k.v}</div>
              </div>
            ))}
            {efectivoContado != null && (
              <div className="rounded-2xl border border-white/[0.075] bg-white/[0.035] p-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Efectivo contado</div>
                <div className="mt-1 text-base font-extrabold tabular-nums text-white">{money(Number(efectivoContado))}</div>
                {diferenciaEfectivo != null && Number(diferenciaEfectivo) !== 0 && (
                  <div className={cn("mt-0.5 text-[11px] font-bold", Number(diferenciaEfectivo) > 0 ? "text-emerald-300" : "text-rose-300")}>
                    {Number(diferenciaEfectivo) > 0 ? "Sobra" : "Falta"} {money(Math.abs(Number(diferenciaEfectivo)))}
                  </div>
                )}
              </div>
            )}
          </div>

          {preview?.conciliacion && (
            <div className="mt-5">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/45">Conciliación</div>
              <CierreConciliacionPanel conciliacion={preview.conciliacion} />
            </div>
          )}

          <div className="mt-5">
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/45">Movimientos del día</div>
            <CierreMovimientosDetalleList cobros={cobros} gastos={gastos} movimientos={movimientos} />
          </div>
        </>
      )}

      <div className="mt-4 rounded-2xl border border-white/[0.075] bg-white/[0.03] p-4">
        <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/45">Datos del cierre</div>
        <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
          <div>
            <div className="text-white/40">Fecha operativa</div>
            <div className="mt-0.5 font-semibold text-white">{fecha ?? "—"}</div>
          </div>
          <div>
            <div className="text-white/40">Tipo de cierre</div>
            <div className="mt-0.5 font-semibold text-white">{tipoCierreLabel(cierre)}</div>
          </div>
          <div>
            <div className="text-white/40">Responsable</div>
            <div className="mt-0.5 font-semibold text-white">
              {actor(cierreEvt?.usuario ?? cierre?.closed_by ?? cierre?.usuario_nombre)}
            </div>
          </div>
          <div>
            <div className="text-white/40">Registrado el</div>
            <div className="mt-0.5 font-semibold text-white">
              {cierreEvt?.fecha_hora
                ? new Date(cierreEvt.fecha_hora).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
                : "—"}
            </div>
          </div>
        </div>
        {observacion && (
          <div className="mt-3 rounded-xl border border-white/[0.055] bg-white/[0.03] px-3 py-2 text-xs text-white/65">
            {observacion}
          </div>
        )}
        {puedeReabrir && (
          <button
            type="button"
            disabled={reabriendo}
            onClick={onReabrir}
            className="mt-4 w-full rounded-2xl border border-white/[0.10] bg-white/[0.055] px-4 py-3 text-sm font-extrabold text-white transition hover:bg-white/[0.09] disabled:opacity-50"
          >
            {reabriendo ? "Reabriendo…" : "Reabrir caja"}
          </button>
        )}
      </div>
    </div>
  );
}

function renderEstadoPill(c: any) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-bold ring-1",
        c?.estado === "reabierta"
          ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/25"
          : "bg-rose-500/10 text-rose-300 ring-rose-400/25",
      )}
    >
      {c?.estado === "reabierta" ? "Reabierta" : "Cerrada"}
    </span>
  );
}

// ─────────── Cierres de caja — historial tab ─────────────────────────────────

function CierresTab({
  businessId,
  cajaCerrada,
  paymentsToday,
  expensesToday,
  pendingCharges,
  userEmail,
  expected,
  movementsData,
  initialPendingDate,
  onPendingDateConsumed,
  onCajaCerrada,
  onCajaReopened,
}: {
  businessId: string | null;
  cajaCerrada: boolean;
  paymentsToday: ReturnType<typeof useCajaData>["paymentsToday"];
  expensesToday: ReturnType<typeof useCajaData>["expensesToday"];
  pendingCharges: ReturnType<typeof useCajaData>["pendingCharges"];
  userEmail: string | null;
  expected: ExpectedCashDigital;
  movementsData: ReturnType<typeof useCashMovements>;
  // Fecha (YYYY-MM-DD) con la que esta pestaña debe abrir directo la vista
  // previa de "Cerrar un día anterior" — viene del aviso "Caja vencida" de
  // Inicio (Link con ?pendingDate=...). onPendingDateConsumed limpia ese
  // query param una vez usado, para que un refresh de página no vuelva a
  // disparar el salto.
  initialPendingDate?: string;
  onPendingDateConsumed?: () => void;
  onCajaCerrada: () => void;
  onCajaReopened: () => void;
}) {
  const { activeBranchId } = useAuth();
  const [cierres, setCierres] = useState<any[]>([]);
  const [pendingCierres, setPendingCierres] = useState<PendingCierre[]>([]);
  const [jumpToDate, setJumpToDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [reopenTarget, setReopenTarget] = useState<any | null>(null);
  const [reopenNote, setReopenNote] = useState("");
  const [subtab, setSubtab] = useState<"dia" | "historial">("dia");

  // `selected.detalle_metodos_pago` es una foto guardada en la fila del
  // cierre al momento de cerrarlo — si esa foto se guardó ANTES del fix de
  // agrupamiento por método (normalizeCierreMethodKey), queda para siempre
  // con "Efectivo" duplicado sin importar qué tan actualizado esté el
  // código. Acá se recalcula en vivo a partir de cobros_snapshot/
  // gastos_snapshot (que sí tienen el método de cada movimiento suelto),
  // así el fix también corrige el historial ya guardado, no solo los
  // cierres nuevos. Si un cierre muy viejo no tiene esos snapshots
  // detallados, se cae de vuelta a la foto guardada como antes.
  const loadCierres = React.useCallback(() => {
    if (!businessId) {
      setCierres([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let query = supabase
      .from("caja_cierres" as any)
      .select("*")
      .eq("business_id", businessId);
    if (activeBranchId) query = query.eq("branch_id", activeBranchId);
    query
      .order("fecha", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(90)
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        setCierres(data ?? []);
        setLoading(false);
      });
  }, [businessId, activeBranchId]);

  useEffect(() => {
    loadCierres();
    const handler = () => loadCierres();
    window.addEventListener("clippr:caja-cierre-guardado", handler);
    return () => window.removeEventListener("clippr:caja-cierre-guardado", handler);
  }, [loadCierres]);

  // Aviso "Tenés N cajas pendientes de revisión" — TODAS las jornadas con
  // actividad sin cerrar, no solo la más vieja (ver findAllPendingCierres
  // en caja-cierre.ts). Se recarga con el mismo evento que el historial:
  // cerrar/reabrir cualquier día cambia qué queda pendiente.
  const loadPendingCierres = React.useCallback(() => {
    if (!businessId) {
      setPendingCierres([]);
      return;
    }
    findAllPendingCierres(businessId, activeBranchId)
      .then(setPendingCierres)
      .catch((e) => console.warn("[CierresTab] findAllPendingCierres:", e));
  }, [businessId, activeBranchId]);

  useEffect(() => {
    loadPendingCierres();
    const handler = () => loadPendingCierres();
    window.addEventListener("clippr:caja-cierre-guardado", handler);
    return () => window.removeEventListener("clippr:caja-cierre-guardado", handler);
  }, [loadPendingCierres]);

  // Realtime: closeSingleDayCierre dispara un CustomEvent same-tab — esto
  // es lo que hace que un cierre/reapertura confirmado desde OTRO
  // dispositivo también actualice el historial y el aviso de pendientes
  // acá, sin recargar la página (ver sección 6 del pedido).
  useEffect(() => {
    if (!businessId) return;
    const channel = supabase
      .channel(`cierres-tab-${businessId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "caja_cierres", filter: `business_id=eq.${businessId}` },
        () => {
          loadCierres();
          loadPendingCierres();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId, loadCierres, loadPendingCierres]);

  // Red de seguridad además de Realtime — mismo criterio que el resto de
  // esta página (ver el efecto de ProfesionalesTab más arriba): si la
  // conexión se cortó o la pestaña estuvo en background, volver a ella
  // siempre refresca el historial y el aviso de pendientes.
  useEffect(() => {
    function onFocus() {
      loadCierres();
      loadPendingCierres();
    }
    function onVisibility() {
      if (document.visibilityState === "visible") onFocus();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadCierres, loadPendingCierres]);

  // El salto desde el aviso de Inicio solo se consume UNA vez — si el
  // usuario después elige otra fecha a mano en "Cerrar un día anterior",
  // jumpToDate no debe volver a pisarle la selección.
  const consumedPendingDateRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!initialPendingDate || consumedPendingDateRef.current === initialPendingDate) return;
    consumedPendingDateRef.current = initialPendingDate;
    setSubtab("dia");
    setJumpToDate(initialPendingDate);
    onPendingDateConsumed?.();
  }, [initialPendingDate, onPendingDateConsumed]);

  const cierreEventos = (cierre: any) =>
    cleanCajaEventosForDisplay(sortCajaEventos(cajaEventosArray(cierre?.eventos)));

  // Historial = cierres reales + días pendientes intercalados por fecha
  // (desc) — ver sección 4 del pedido ("cada día debe tener uno de estos
  // estados"). Nunca se mezclan en `cierres` mismo: ese array sigue siendo
  // SOLO filas reales de caja_cierres (lo que usa latestCierre/CierreCajaBtn
  // para saber qué fila actualizar al cerrar).
  type HistorialRow = { kind: "cierre"; cierre: any } | { kind: "pendiente"; date: string };
  const historialRows = React.useMemo<HistorialRow[]>(() => {
    const rows: HistorialRow[] = [
      ...cierres.map((c): HistorialRow => ({ kind: "cierre", cierre: c })),
      ...pendingCierres.map((p): HistorialRow => ({ kind: "pendiente", date: p.date })),
    ];
    const keyOf = (r: HistorialRow) => (r.kind === "cierre" ? String(r.cierre.fecha) : r.date);
    return rows.sort((a, b) => keyOf(b).localeCompare(keyOf(a)));
  }, [cierres, pendingCierres]);

  const latestCierre = cierres[0] ?? null;
  const latestEventos = latestCierre ? cierreEventos(latestCierre) : [];
  const cierreEvent = [...latestEventos].reverse().find((e: any) => e?.tipo === "cierre");
  // "Hora de apertura" = la PRIMERA apertura del día. Una "reapertura"
  // (reabrir la caja después de cerrarla) nunca debe pisar ese valor —
  // por eso queda excluida del pool de candidatos acá, no solo se prioriza
  // "apertura" sobre ella.
  // Nunca cae a aperturaCandidates[0]: ese fallback mostraba la hora del
  // propio evento de CIERRE disfrazada de "apertura" cuando no existía un
  // evento real tipo:"apertura" (nunca se escribe uno en ningún flujo
  // actual) — una apertura ficticia a las 00:00/hora de cierre. Sin un
  // evento real, mostrar "—" es la verdad: no sabemos a qué hora abrió.
  const aperturaEvent = latestEventos.find((e: any) => e?.tipo === "apertura");

  const actor = (value?: string | null) => displayResponsibleUser(value ?? userEmail ?? "Usuario");
  const openedBy = actor(aperturaEvent?.usuario ?? latestCierre?.opened_by ?? latestCierre?.created_by ?? userEmail);
  const closedBy = actor(cierreEvent?.usuario ?? latestCierre?.closed_by ?? latestCierre?.usuario_nombre ?? latestCierre?.user_email ?? userEmail);
  const openedAt = cajaHoraDisplay(aperturaEvent?.hora ?? latestCierre?.hora_apertura ?? "—");
  const closedAt = cajaHoraDisplay(cierreEvent?.hora ?? latestCierre?.hora_cierre ?? "—");
  const todayKey = cajaDateKey();
  const cierresToday = cierres.filter((c: any) => c?.fecha === todayKey);
  const closedResponsablesToday = React.useMemo(() => {
    const names = cierresToday
      .map((c: any) => {
        const eventos = cierreEventos(c);
        const cierre = [...eventos].reverse().find((e: any) => e?.tipo === "cierre");
        return actor(cierre?.usuario ?? c.closed_by ?? c.usuario_nombre ?? c.user_email ?? userEmail);
      })
      .filter(Boolean);
    return Array.from(new Set(names)).join(" / ") || closedBy;
  }, [cierresToday, closedBy]);

  const cierreCandidates = (cierresToday.length ? cierresToday : latestCierre ? [latestCierre] : [])
    .flatMap((c: any) => {
      const events = cierreEventos(c)
        .filter((event: any) => event?.tipo === "cierre")
        .map((event: any) => ({ cierre: c, event, hora: event?.hora ?? c?.hora_cierre }));

      if (c?.hora_cierre && !events.some((row: any) => cajaEventTimeToMinutes(row.hora) === cajaEventTimeToMinutes(c.hora_cierre))) {
        events.push({
          cierre: c,
          event: {
            tipo: "cierre",
            hora: c.hora_cierre,
            usuario: c.closed_by ?? c.usuario_nombre ?? c.user_email ?? userEmail,
          },
          hora: c.hora_cierre,
        });
      }

      return events;
    })
    .sort((a: any, b: any) => cajaEventTimeToMinutes(b.hora) - cajaEventTimeToMinutes(a.hora));

  const lastCloseEntryToday = cierreCandidates[0] ?? null;
  const lastCierreToday = lastCloseEntryToday?.cierre ?? cierresToday[0] ?? latestCierre;
  const lastCloseEventToday = lastCloseEntryToday?.event ?? getCajaLastEvent(lastCierreToday, "cierre");
  const lastClosedBy = actor(lastCloseEventToday?.usuario ?? lastCierreToday?.closed_by ?? lastCierreToday?.usuario_nombre ?? lastCierreToday?.user_email ?? userEmail);
  const lastClosedToday = cajaHoraDisplay(lastCloseEntryToday?.hora ?? lastCloseEventToday?.hora ?? lastCierreToday?.hora_cierre ?? closedAt);
  const closedCountToday = cierreCandidates.length || cierresToday.length;


  function fechaLabel(fecha?: string | null, long = false) {
    if (!fecha) return "—";
    return new Date(`${fecha}T12:00:00`).toLocaleDateString("es-AR", long ? {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    } : {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function fechaDetalleLabel(fecha?: string | null) {
    if (!fecha) return "—";
    const date = new Date(`${fecha}T12:00:00`);
    const weekday = date.toLocaleDateString("es-AR", { weekday: "long" });
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${day}/${month}`;
  }

  function getCierreObservacion(cierre: any): string | null {
    const eventos = cierreEventos(cierre);
    const lastCierre = [...eventos]
      .reverse()
      .find((e: any) => e?.tipo === "cierre" && (e?.observacion || e?.nota));
    return lastCierre?.observacion ?? lastCierre?.nota ?? cierre?.observacion ?? null;
  }

  function getReaperturaObservacion(cierre: any): string | null {
    const eventos = cierreEventos(cierre);
    const lastReopen = [...eventos]
      .reverse()
      .find((e: any) => e?.tipo === "reapertura" && (e?.motivo || e?.observacion || e?.nota));
    return lastReopen?.motivo ?? lastReopen?.observacion ?? lastReopen?.nota ?? cierre?.reopen_reason ?? null;
  }

  function hasNotes(cierre: any) {
    return Boolean(getCierreObservacion(cierre) || getReaperturaObservacion(cierre));
  }

  // Reabrir desde el historial NUNCA muta la fila elegida de vuelta a
  // 'reabierta' — eso fue el bug que duplicaba ingresos cuando una caja
  // vencida de varios días quedaba "reabierta" con su fecha vieja para
  // siempre. Sea cual sea el cierre histórico elegido, el efecto real es
  // siempre el mismo: una cash_session nueva, con opened_at = ahora. La
  // fila histórica solo recibe reopened_at/reopened_by/reopen_reason como
  // auditoría de "por qué se reabrió".
  async function reabrirCaja(cierre: any) {
    if (!businessId || !cierre?.id || reopeningId) return;

    setReopeningId(cierre.id);

    try {
      const { data: freshCierre, error: readError } = await supabase
        .from("caja_cierres" as any)
        .select("id,eventos,estado")
        .eq("id", cierre.id)
        .eq("business_id", businessId)
        .maybeSingle();

      if (readError) throw readError;
      if (!freshCierre?.id) throw new Error("No se encontró el cierre");

      const now = new Date();
      const user = userEmail ? displayResponsibleUser(userEmail) : "Usuario";
      const motivo = reopenNote.trim() || null;

      if (isCajaCerradaRow(freshCierre)) {
        const reaperturaEvento = {
          tipo: "reapertura",
          fecha_hora: now.toISOString(),
          hora: cajaTimeLabel(now),
          usuario: user,
          motivo,
        };
        await supabase
          .from("caja_cierres" as any)
          .update({
            reopened_at: now.toISOString(),
            reopened_by: user,
            reopen_reason: motivo,
            eventos: appendCajaEvento((freshCierre as any).eventos, reaperturaEvento),
          })
          .eq("id", cierre.id)
          .eq("business_id", businessId);
      }

      await reopenCashSession({
        businessId,
        branchId: activeBranchId,
        reopenedBy: user,
        previousSessionId: cierre.id,
      });

      toast.success("Caja reabierta");
      setSelected(null);
      setReopenTarget(null);
      setReopenNote("");

      // La pantalla se desbloquea inmediatamente; la sincronización secundaria no bloquea la UI.
      onCajaReopened();
      window.dispatchEvent(new CustomEvent("clippr:caja-cierre-guardado"));

      loadCierres();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo reabrir la caja");
    } finally {
      setReopeningId(null);
    }
  }

  const renderEstado = renderEstadoPill;

  const cierreSummary = (c: any) => {
    const eventos = cierreEventos(c);
    const cierre = [...eventos].reverse().find((e: any) => e?.tipo === "cierre");
    // Nunca sintetiza una "apertura" a partir de otro evento (ver mismo
    // criterio arriba en aperturaEvent) — sin un evento real tipo:
    // "apertura", no hay hora de apertura que mostrar.
    const apertura = eventos.find((e: any) => e?.tipo === "apertura" && e?.tipo !== "reapertura");
    const modo = String(cierre?.modo ?? c?.tipo_cierre ?? "manual").toLowerCase();
    const tipoCierre =
      modo === "historico_regularizado"
        ? "Histórico regularizado"
        : modo === "automatico"
          ? "Automático"
          : "Manual";
    return {
      apertura,
      cierre,
      responsableApertura: apertura ? actor(apertura?.usuario ?? c.opened_by ?? c.created_by) : "—",
      responsableCierre: actor(cierre?.usuario ?? c.closed_by ?? c.usuario_nombre ?? c.user_email ?? userEmail),
      horaApertura: apertura ? cajaHoraDisplay(apertura?.hora ?? "—") : "—",
      horaCierre: cajaHoraDisplay(cierre?.hora ?? c.hora_cierre ?? "—"),
      tipoCierre,
      esHistoricoRegularizado: modo === "historico_regularizado",
    };
  };

  return (
    <div className="-mt-3 space-y-4">
      <section className="overflow-hidden rounded-[32px] border border-white/[0.085] bg-[radial-gradient(circle_at_14%_0%,rgba(96,165,250,0.08),transparent_32%),radial-gradient(circle_at_90%_6%,rgba(139,92,246,0.10),transparent_36%),linear-gradient(135deg,rgba(5,8,15,0.98),rgba(8,10,20,0.97),rgba(2,4,12,0.99))] p-5 shadow-[0_38px_120px_-62px_rgba(0,0,0,1),0_0_70px_-52px_rgba(139,92,246,0.62)]">
        <div className="flex justify-end border-b border-white/[0.065] pb-5">
          <button
            type="button"
            onClick={() => setSubtab(subtab === "historial" ? "dia" : "historial")}
            className={cn(
              "rounded-2xl border border-white/[0.085] bg-black/35 px-4 py-2 text-sm font-bold transition",
              subtab === "historial"
                ? "bg-[linear-gradient(135deg,rgba(59,130,246,0.22),rgba(139,92,246,0.22))] text-white ring-1 ring-violet-200/25"
                : "text-white/70 hover:bg-white/[0.06] hover:text-white",
            )}
          >
            Historial
          </button>
        </div>

        {subtab === "dia" ? (
          <div className="pt-5">
            {pendingCierres.length > 0 && (
              <div className="mb-4 rounded-[24px] border border-amber-400/25 bg-amber-400/[0.08] p-4">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-amber-200">
                      {pendingCierres.length === 1
                        ? `Tenés una caja pendiente de revisión del ${fechaDDMMYYYY(pendingCierres[0].date)}`
                        : `Tenés ${pendingCierres.length} cajas pendientes de revisión`}
                    </p>
                    <p className="mt-1 text-xs text-amber-200/70">
                      Ninguna se cierra sola — revisá cada una y confirmá el cierre a mano.
                    </p>
                    <div className="mt-3 space-y-1.5">
                      {pendingCierres.map((p) => (
                        <div
                          key={p.date}
                          className="flex items-center justify-between gap-3 rounded-xl bg-black/15 px-3 py-2"
                        >
                          <span className="text-sm font-semibold text-white/85">
                            {fechaDDMMYYYY(p.date)}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSubtab("dia");
                              setJumpToDate(p.date);
                            }}
                            className="rounded-lg bg-amber-400/15 px-3 py-1.5 text-xs font-bold text-amber-100 ring-1 ring-amber-400/30 transition hover:bg-amber-400/25"
                          >
                            Revisar cierre
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {!cajaCerrada ? (
              <div className="rounded-[28px] border border-emerald-300/14 bg-[linear-gradient(135deg,rgba(16,185,129,0.08),rgba(0,0,0,0.20))] p-5">
                <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="inline-flex rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-300">
                      Caja abierta
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Caja abierta desde{" "}
                      <span className="font-semibold text-white">
                        {fechaDDMMYYYY(latestCierre?.fecha)} · {openedAt}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Responsable: <span className="font-semibold text-white">{openedBy}</span>
                    </p>
                  </div>
                  <CierreCajaBtn
                    businessId={businessId}
                    branchId={activeBranchId}
                    userEmail={userEmail}
                    onCajaCerrada={() => {
                      onCajaCerrada();
                      loadCierres();
                    }}
                    cajaAbiertaDesde={`${fechaDDMMYYYY(latestCierre?.fecha)} · ${openedAt}`}
                    cajaRangeStartDate={latestCierre?.fecha ?? cajaDateKey()}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-[28px] border border-red-500/18 bg-[linear-gradient(90deg,rgba(90,18,28,0.22)_0%,rgba(35,12,18,0.15)_55%,rgba(15,15,20,0.10)_100%)] p-5 shadow-[0_0_45px_rgba(239,68,68,0.10)]">
                <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-3xl font-extrabold tracking-tight text-red-300">
                      Caja cerrada
                    </div>
                    <p className="mt-3 text-sm font-semibold text-white/70">
                      Hora de cierre: <span className="text-white">{lastClosedToday}</span>
                    </p>
                    <p className="mt-2 text-sm text-white/50">
                      Podés reabrirla hasta las 00:00.
                    </p>
                  </div>
                  {latestCierre && (
                    <button
                      type="button"
                      disabled={reopeningId === latestCierre.id}
                      onClick={() => {
                        setReopenTarget(latestCierre);
                        setReopenNote("");
                      }}
                      className="rounded-2xl border border-white/[0.10] bg-white/[0.055] px-5 py-3 text-sm font-extrabold text-white shadow-[0_20px_70px_-45px_rgba(0,0,0,1)] transition hover:bg-white/[0.09] disabled:opacity-50"
                    >
                      {reopeningId === latestCierre.id ? "Reabriendo…" : "Reabrir caja"}
                    </button>
                  )}
                </div>
              </div>
            )}
            <CerrarDiaAnteriorCard
              businessId={businessId}
              branchId={activeBranchId}
              userEmail={userEmail}
              cierresExistentes={cierres}
              jumpToDate={jumpToDate}
              onJumped={() => setJumpToDate(null)}
              onCierreGuardado={() => {
                onCajaCerrada();
                loadCierres();
                loadPendingCierres();
              }}
            />
          </div>
        ) : loading ? (
          <div className="pt-5">
            <div className="overflow-hidden rounded-[28px] border border-white/[0.085] bg-black/25">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 border-b border-white/[0.055] px-5 py-3.5 last:border-0"
                >
                  <div className="h-3 w-16 shrink-0 animate-pulse rounded bg-white/[0.06]" />
                  <div className="h-3 flex-1 animate-pulse rounded bg-white/[0.045]" />
                  <div className="h-3 flex-1 animate-pulse rounded bg-white/[0.045]" />
                  <div className="h-6 w-16 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
                </div>
              ))}
            </div>
          </div>
        ) : cierres.length === 0 && pendingCierres.length === 0 ? (
          <div className="rounded-3xl border border-white/[0.08] bg-black/30 py-12 text-center text-sm text-muted-foreground">
            Sin cierres registrados todavía.
          </div>
        ) : (
          <div className="pt-5">
            {selected ? (
              <CierreDetalleView
                cierre={selected}
                businessId={businessId}
                branchId={activeBranchId}
                onVolver={() => setSelected(null)}
                cierreEventos={cierreEventos}
                getCierreObservacion={getCierreObservacion}
                fechaDetalleLabel={fechaDetalleLabel}
                tipoCierreLabel={(c: any) => cierreSummary(c).tipoCierre}
                actor={actor}
                onReabrir={() => {
                  setReopenTarget(selected);
                  setReopenNote("");
                }}
                puedeReabrir={selected.estado !== "reabierta"}
                reabriendo={reopeningId === selected.id}
              />
            ) : (
              // Historial minimalista: solo fechas, de más reciente a más
              // antigua, cada una completamente clickeable. Nada de
              // importes/servicios/profesionales/métodos/responsable acá
              // — todo eso vive en CierreDetalleView, un clic adentro. Los
              // días pendientes (actividad real, sin cierre guardado) se
              // intercalan por fecha con una píldora "Pendiente" — nunca
              // aparecen como "Cerrada" solo porque el día ya terminó (ver
              // sección 4 del pedido). Tocar uno abre la vista previa, no
              // CierreDetalleView (no hay snapshot guardado todavía).
              <div className="overflow-hidden rounded-[28px] border border-white/[0.085] bg-black/25">
                {historialRows.map((row) =>
                  row.kind === "pendiente" ? (
                    <button
                      key={`pendiente-${row.date}`}
                      type="button"
                      onClick={() => {
                        setSubtab("dia");
                        setJumpToDate(row.date);
                      }}
                      className="flex w-full items-center justify-between gap-3 border-b border-white/[0.055] px-5 py-4 text-left transition last:border-0 hover:bg-white/[0.035] active:bg-white/[0.05]"
                    >
                      <span className="text-sm font-semibold text-white/85">{fechaDetalleLabel(row.date)}</span>
                      <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-300 ring-1 ring-amber-400/30">
                        Pendiente de revisión
                      </span>
                    </button>
                  ) : (
                    <button
                      key={row.cierre.id}
                      type="button"
                      onClick={() => setSelected(row.cierre)}
                      className="flex w-full items-center justify-between gap-3 border-b border-white/[0.055] px-5 py-4 text-left transition last:border-0 hover:bg-white/[0.035] active:bg-white/[0.05]"
                    >
                      <span className="text-sm font-semibold text-white/85">{fechaDetalleLabel(row.cierre.fecha)}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-white/35" />
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* createPortal: sin esto, el <div className="relative z-10"> con el
          que <AppShell> envuelve la página atrapa este modal en su propio
          stacking context, y la barra inferior de navegación (fixed, z-40,
          hermana de <main>) termina pintando encima en mobile. */}
      {reopenTarget && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/[0.10] bg-[linear-gradient(135deg,rgba(5,8,15,0.99),rgba(10,12,24,0.98),rgba(2,4,12,0.99))] shadow-2xl">
            <div className="border-b border-white/[0.08] px-5 py-4">
              <h3 className="text-lg font-bold text-white">Reabrir caja</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Es el único camino para corregir un día ya cerrado — nunca se sobrescribe en
                silencio. Contá el motivo: queda guardado junto con quién y cuándo reabrió.
              </p>
            </div>
            <div className="space-y-4 p-5">
              <textarea
                value={reopenNote}
                onChange={(event) => setReopenNote(event.target.value)}
                placeholder={'Ej: "Faltó cobrar un turno."'}
                className="min-h-[120px] w-full rounded-2xl border border-white/[0.09] bg-black/35 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-violet-300/40"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReopenTarget(null);
                    setReopenNote("");
                  }}
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-2 text-sm font-semibold text-white/65 hover:bg-white/[0.07] hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={reopeningId === reopenTarget.id || !reopenNote.trim()}
                  title={!reopenNote.trim() ? "Contá el motivo de la reapertura antes de continuar" : undefined}
                  onClick={() => reabrirCaja(reopenTarget)}
                  className="rounded-2xl border border-emerald-300/25 bg-emerald-400/14 px-4 py-2 text-sm font-extrabold text-emerald-100 hover:bg-emerald-400/22 disabled:opacity-50"
                >
                  {reopeningId === reopenTarget.id ? "Reabriendo…" : "Reabrir caja"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

const CHARGE_TYPE_META: Record<string, { label: string; cls: string }> = {
  auto:   { label: "Automático", cls: "bg-emerald-500/10 ring-emerald-400/25 text-emerald-300" },
  manual: { label: "Manual",     cls: "bg-blue-500/10  ring-blue-400/25  text-blue-200"  },
  caja:   { label: "Caja",       cls: "bg-sky-500/10    ring-sky-400/25    text-sky-300"    },
};

const STATUS_META: Record<string, { label: string; dot: string }> = {
  cobrado:     { label: "Cobrado",     dot: "bg-emerald-400" },
  pendiente:   { label: "Pendiente",   dot: "bg-blue-400"   },
  pending_payment: { label: "Pendiente", dot: "bg-blue-400" },
  aprobado:    { label: "Aprobado",    dot: "bg-sky-400"     },
  anulado:     { label: "Anulado",     dot: "bg-rose-400"    },
  reembolsado: { label: "Reembolsado", dot: "bg-violet-400"  },
};

function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, dot: "bg-white/40" };
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium">
      <span className={cn("size-1.5 rounded-full shrink-0", m.dot)} />
      {m.label}
    </span>
  );
}

function ChargeTypePill({ type }: { type: string }) {
  const normalized = type === "desactivado" ? "caja" : type;
  const m = CHARGE_TYPE_META[normalized] ?? {
    label: normalized,
    cls: "bg-white/5 ring-white/10 text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
        m.cls,
      )}
    >
      {m.label}
    </span>
  );
}

function getChargeType(payment: Record<string, unknown>) {
  const raw = String(
    payment.charge_type ?? payment.origin ?? payment.source ?? "caja",
  );
  if (["auto", "automatico", "automático"].includes(raw.toLowerCase()))
    return "auto";
  if (["manual"].includes(raw.toLowerCase())) return "manual";
  if (["desactivado", "disabled"].includes(raw.toLowerCase())) return "caja";
  return raw || "caja";
}

function getChargedByLabel(
  payment: Record<string, unknown>,
  professionalName: string | null,
  chargeType: string,
) {
  const raw = String(
    payment.charged_by_name ?? payment.cashier_name ?? payment.user_name ?? "",
  ).trim();
  if (raw && !/^[0-9a-f]{8}-[0-9a-f-]{13,}$/i.test(raw)) return raw;

  // Antes de caer en el genérico "Recepción": si ya sabemos quién cobró
  // realmente (cobro_events, resuelto por useCajaData desde la base — no
  // un cache local), usar ese nombre. Cubre el mismo caso que
  // buildPaidHistorialEvents pero como red de seguridad extra acá, para
  // que ningún llamador de esta función pueda terminar mostrando
  // "Recepción" cuando la cuenta real ya se conoce.
  const resolvedEvents = (payment.cobro_events as { action: string; user: string }[] | undefined) ?? [];
  const lastCobro = [...resolvedEvents].reverse().find((e) => e.action === "Cobró");
  if (lastCobro?.user) return lastCobro.user;

  if (chargeType === "auto") return professionalName ?? "Profesional";
  if (chargeType === "manual") return "Recepción";
  return "Caja";
}

function getPaymentMethodLabel(payment: Record<string, unknown>) {
  const method = String(
    payment.method ?? payment.payment_method ?? "cash",
  ) as PayMethod;
  return PAY_METHOD_LABEL[method] ?? method;
}

function getSaleDetailLabel(payment: Record<string, unknown>) {
  const serviceName = String(payment.service_name ?? "").trim();
  const productName = String(
    payment.product_name ?? payment.catalog_name ?? "",
  ).trim();
  const itemName = serviceName || productName || "—";
  const qty = Number(payment.qty ?? payment.quantity ?? 1);
  return qty > 1 && itemName !== "—" ? `${itemName} x${qty}` : itemName;
}

function DetailModal({
  payment,
  employees,
  onClose,
  onDeleted,
}: {
  payment: ReturnType<typeof useCajaData>["paymentsToday"][number];
  employees: ReturnType<typeof useCajaData>["employees"];
  onClose: () => void;
  onDeleted: () => void;
}) {
  // Mismo patrón ya probado en el resto de la app (Agenda, Clientes,
  // Asesor, Equipo, Promociones, Catálogo) — overflow:hidden solo en el
  // body no alcanza en iOS Safari, el rubber-band del viewport sigue
  // moviendo el fondo por debajo del modal. Este componente solo se
  // monta mientras el detalle está abierto (ver detailPayment && <...>
  // en History), así que el lock es simplemente "true" mientras exista.
  useBodyScrollLock(true);
  const [deleting, setDeleting] = React.useState(false);
  const method = (payment.method ??
    payment.payment_method ??
    "cash") as PayMethod;
  const empName =
    employees.find((e) => e.id === payment.employee_id)?.name ?? null;
  const chargeType =
    ((payment as Record<string, unknown>).charge_type as string | null) ??
    "caja";
  // "Cobrado por": payment.charged_by es el uuid de profiles (quien cobró
  // logueado), no un employees.id — buscarlo en `employees` nunca
  // matcheaba, y el fallback de antes ("si el string mide menos de 40
  // caracteres, mostralo tal cual") terminaba mostrando el UUID crudo en
  // pantalla, porque un uuid mide 36. getChargedByLabel es la misma
  // función que ya resuelve "Cobró" en las filas de Últimos ingresos —
  // usa el nombre real ya resuelto en cobro_events (guardado ahí en el
  // momento del cobro, nunca un id) y explícitamente nunca devuelve algo
  // con forma de UUID.
  const chargedBy = getChargedByLabel(
    payment as Record<string, unknown>,
    empName,
    chargeType,
  );
  const status =
    ((payment as Record<string, unknown>).status as string | null) ?? "cobrado";
  const comprobante =
    ((payment as Record<string, unknown>).reference as string | null) ?? null;
  const obs =
    (((payment as Record<string, unknown>).observations as string | null) ??
      null) ||
    (((payment as Record<string, unknown>).notes as string | null) ?? null);
  const sucursal =
    ((payment as Record<string, unknown>).branch as string | null) ?? null;
  const paymentNumber =
    ((payment as Record<string, unknown>).payment_number as
      | number
      | string
      | null) ?? null;
  // "discount", no "discount_amount" — esa columna no existe en `payments`
  // (registerPayment escribe en `discount`, ver register-payment.ts). Leer
  // el nombre que no existe hacía que "Descuento aplicado" nunca se
  // mostrara sin importar cuánto descuento hubiera tenido el cobro.
  const discountAmount = Number((payment as Record<string, unknown>).discount ?? 0) || 0;
  const tipAmount = Number((payment as Record<string, unknown>).tip_amount ?? 0) || 0;
  // Precio de lista antes del descuento: original_amount solo se guarda
  // cuando hubo descuento (ver register-payment.ts); sin descuento, el
  // "precio de lista" es directamente el total cobrado por servicios.
  const servicioAmount =
    Number((payment as Record<string, unknown>).original_amount ?? 0) ||
    Number(payment.total ?? payment.amount ?? 0);
  // Total efectivamente cobrado al cliente: total (ya post-descuento, sin
  // propina — pura facturación de servicios) + propina, que nunca se suma
  // dentro de total/amount en ningún otro lugar de la app.
  const totalCobrado = Number(payment.total ?? payment.amount ?? 0) + tipAmount;
  const depositApplied =
    ((payment as Record<string, unknown>).deposit_paid as number | null) ??
    null;
  // Venta con saldo (pendiente/parcial) — el "Total cobrado" de arriba no
  // aplica: todavía no entró toda la plata. Se muestra Venta/Cobrado/Saldo
  // en su lugar, y el historial completo de cobros (ver
  // VentaPendienteHistoryPanel) más abajo.
  const isPendingOrParcial = status === "pendiente" || status === "parcial";
  const collectedAmount = Number((payment as Record<string, unknown>).collected_amount ?? 0) || 0;
  const saldoPendiente = Math.max(0, Math.round(Number(payment.total ?? payment.amount ?? 0) - collectedAmount));

  // Comisión REAL de esta venta puntual — nunca recalculada acá. Antes este
  // bloque adivinaba "precio × commission_pct ACTUAL del profesional" (o
  // ni siquiera eso: caía directo a %, ignorando si esa venta en realidad
  // usó una comisión por servicio específica), lo que podía mostrar un
  // número que no tenía nada que ver con lo que se le pagó/debe a ese
  // profesional — y cambiaba solo si el % general del profesional se
  // editaba después, aunque esta venta ya estuviera cobrada. commission_
  // records.amount es la comisión efectivamente calculada y guardada al
  // momento del cobro (computeCommissionAmount, con prioridad servicio >
  // fijo > %, ver register-payment.ts) — un snapshot fijo que ninguna
  // liquidación ni edición posterior del profesional vuelve a tocar.
  const [commissionRecord, setCommissionRecord] = React.useState<{
    amount: number;
    commission_pct: number | null;
  } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    supabase
      .from("commission_records" as any)
      .select("amount,commission_pct")
      .eq("sale_id", payment.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setCommissionRecord((data as { amount: number; commission_pct: number | null } | null) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [payment.id]);

  const fmtDT = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("es-AR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs text-foreground text-right">{value ?? "—"}</span>
    </div>
  );

  const ventaNum = paymentNumber
    ? `#${String(paymentNumber).padStart(6, "0")}`
    : `#${payment.id.slice(-6).toUpperCase()}`;

  // Retiro de stock pagado (Inventario → Retirar stock → Pagar ahora):
  // este payment no tiene cliente/profesional/servicio real — reusar el
  // detalle de venta normal mostraba campos que no aplican ("Servicio",
  // "Profesional", Trazabilidad, etc). STOCK_WITHDRAWAL_NOTE_MARKER es
  // interno (nunca se muestra) — ver más abajo el branch corto para este
  // caso.
  const isStockWithdrawal = String(
    (payment as Record<string, unknown>).observations ?? "",
  ).startsWith(STOCK_WITHDRAWAL_NOTE_MARKER);

  async function handleDelete() {
    if (deleting) return;
    const confirmed = window.confirm(
      isPendingOrParcial
        ? `¿Eliminar esta venta de ${payment.client_name ?? empName ?? "cliente"} por $${Math.round(Number(payment.total ?? payment.amount ?? 0)).toLocaleString("es-AR")} (de la cual se cobraron $${Math.round(collectedAmount).toLocaleString("es-AR")})? No se puede deshacer: se borra la venta junto con todo su historial de cobros, su comisión y su propina asociadas.`
        : `¿Eliminar este cobro de ${payment.client_name ?? empName ?? "cliente"} por $${totalCobrado.toLocaleString("es-AR")}? No se puede deshacer: se borra el pago junto con su comisión y su propina asociadas.`,
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      const businessId = (payment as Record<string, unknown>).business_id as string | null;
      if (!businessId) throw new Error("Falta business_id en este cobro");
      await deletePayment(payment.id, businessId);
      toast.success("Cobro eliminado");
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message || "No se pudo eliminar el cobro");
    } finally {
      setDeleting(false);
    }
  }

  if (typeof document === "undefined") return null;

  if (isStockWithdrawal) {
    const items = (payment as Record<string, unknown>).items as
      | Array<{ name?: string; amount?: number; qty?: number }>
      | null
      | undefined;
    const lineItem = items?.[0] ?? null;
    const qty = Number(lineItem?.qty ?? 1) || 1;
    // lineItem.amount ya viene multiplicado por qty (ver register-payment.ts:
    // savedItems) — es el TOTAL de esa línea, no el precio unitario.
    const lineTotal = Number(lineItem?.amount ?? payment.total ?? payment.amount ?? 0);
    const unitPrice = qty > 0 ? lineTotal / qty : lineTotal;
    const productName = lineItem?.name ?? payment.service_name ?? "Producto";

    return createPortal(
      <div
        className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-lg rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-sm font-semibold">Detalle de venta</h3>
                <span className="text-[11px] font-mono text-primary/80 bg-primary/10 px-2 py-0.5 rounded-lg">
                  {ventaNum}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {fmtDT(payment.created_at)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300 transition disabled:opacity-50"
              >
                {deleting ? "Eliminando…" : "Eliminar cobro"}
              </button>
              <button
                onClick={onClose}
                className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs transition"
              >
                Cerrar
              </button>
            </div>
          </div>

          <div className="px-5 py-1 max-h-[72vh] overflow-y-auto overscroll-contain">
            {/* Solo el importe — sin pills de "Cobrado"/"Caja": acá no es
                una venta de servicio, esos conceptos no aplican. */}
            <div className="py-2 border-b border-white/5">
              <span className="font-display text-2xl font-semibold tabular-nums">
                ${Number(payment.total ?? payment.amount ?? 0).toLocaleString("es-AR")}
              </span>
            </div>

            <div className="mt-2 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3 space-y-0">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">
                Retiro
              </p>
              {/* Profesional real: client_name queda null a propósito
                  (ver register-payment.ts), el nombre sale de empName vía
                  employee_id. "Otro": sigue en client_name, como antes. */}
              <Row label="Retiró" value={payment.client_name ?? empName ?? "—"} />
            </div>

            <div className="mt-2 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3 space-y-0">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">
                Detalle del producto
              </p>
              <Row label="Producto" value={productName} />
              {qty > 1 ? (
                <>
                  <Row label="Cantidad" value={String(qty)} />
                  <Row
                    label="Precio unitario"
                    value={`$${Math.round(unitPrice).toLocaleString("es-AR")}`}
                  />
                  <Row
                    label="Total"
                    value={`$${Math.round(lineTotal).toLocaleString("es-AR")}`}
                  />
                </>
              ) : (
                <Row label="Precio" value={`$${Math.round(unitPrice).toLocaleString("es-AR")}`} />
              )}
            </div>

            <div className="mt-2 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3 space-y-0">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">
                Método de pago
              </p>
              <Row label="Método de pago" value={PAY_METHOD_LABEL[method] ?? method} />
            </div>

            <div className="h-4" />
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-semibold">Detalle de venta</h3>
              <span className="text-[11px] font-mono text-primary/80 bg-primary/10 px-2 py-0.5 rounded-lg">
                {ventaNum}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {fmtDT(payment.created_at)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-lg bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300 transition disabled:opacity-50"
            >
              {deleting ? "Eliminando…" : "Eliminar cobro"}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs transition"
            >
              Cerrar
            </button>
          </div>
        </div>

        {/* overscroll-contain: aunque el body ya está bloqueado (arriba),
            esto evita que llegar al principio/final de ESTE scroll
            encadene el gesto hacia algún ancestro — mismo criterio que ya
            usan las listas scrolleables de Pago múltiple. */}
        <div className="px-5 py-1 max-h-[72vh] overflow-y-auto overscroll-contain">
          {/* Total + estado — el importe grande es el TOTAL EFECTIVAMENTE
              COBRADO al cliente (servicio - descuento + propina), no solo
              payment.total (que es pura facturación de servicios, sin
              propina — la base correcta de Facturación/comisión, pero no
              lo que el cliente pagó en mano). */}
          <div className="py-2 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
            <span className="font-display text-2xl font-semibold tabular-nums">
              ${totalCobrado.toLocaleString("es-AR")}
            </span>
            <div className="flex gap-2 flex-wrap">
              <StatusPill status={status} />
              <ChargeTypePill type={chargeType} />
            </div>
          </div>

          {/* Venta con saldo (pendiente/parcial): el importe grande de
              arriba es la venta COMPLETA, no lo que entró en caja hasta
              ahora — este desglose aclara cuánto se cobró de verdad y
              cuánto falta. */}
          {isPendingOrParcial && (
            <div className="py-2 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap text-xs">
              <span className="text-muted-foreground">
                Cobrado hasta ahora <span className="font-semibold text-emerald-300">${Math.round(collectedAmount).toLocaleString("es-AR")}</span>
              </span>
              <span className="text-muted-foreground">
                Saldo pendiente <span className="font-semibold text-amber-300">${saldoPendiente.toLocaleString("es-AR")}</span>
              </span>
            </div>
          )}

          {/* Bloque: Quién */}
          <div className="mt-2 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3 space-y-0">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">
              Participantes
            </p>
            <Row label="Cliente" value={payment.client_name ?? "—"} />
            <Row label="Profesional" value={empName ?? "—"} />
            <Row label="Cobrado por" value={chargedBy ?? "—"} />
            {sucursal && <Row label="Sucursal" value={sucursal} />}
          </div>

          {/* Bloque: Qué */}
          <div className="mt-2 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3 space-y-0">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">
              Detalle del servicio
            </p>
            <Row
              label="Servicio / Producto"
              value={payment.service_name ?? "—"}
            />
            {/* Desglose Servicio/Descuento/Propina/Total cobrado — las
                filas de Descuento y Propina solo aparecen si hubo alguno de
                los dos, para no ensuciar el detalle de un cobro simple. */}
            <Row
              label="Servicio"
              value={`$${servicioAmount.toLocaleString("es-AR")}`}
            />
            {discountAmount > 0 && (
              <Row
                label="Descuento"
                value={
                  <span className="text-blue-300">
                    −${discountAmount.toLocaleString("es-AR")}
                  </span>
                }
              />
            )}
            {tipAmount > 0 && (
              <Row
                label="Propina"
                value={
                  <span className="text-emerald-300">
                    +${tipAmount.toLocaleString("es-AR")}
                  </span>
                }
              />
            )}
            {(discountAmount > 0 || tipAmount > 0) && (
              <Row
                label="Total cobrado"
                value={
                  <span className="font-bold text-foreground">
                    ${totalCobrado.toLocaleString("es-AR")}
                  </span>
                }
              />
            )}
            {depositApplied && depositApplied > 0 && (
              <Row
                label="Seña aplicada"
                value={
                  <span className="text-primary">
                    −${depositApplied.toLocaleString("es-AR")}
                  </span>
                }
              />
            )}
            {commissionRecord && (
              <Row
                label={isPendingOrParcial ? "Comisión potencial (venta completa)" : "Comisión profesional"}
                value={
                  <>
                    ${Math.round(commissionRecord.amount).toLocaleString("es-AR")}
                    {commissionRecord.commission_pct != null && (
                      <span className="text-muted-foreground"> ({commissionRecord.commission_pct}%)</span>
                    )}
                  </>
                }
              />
            )}
            {isPendingOrParcial && commissionRecord && (
              <p className="pt-1.5 text-[10px] text-muted-foreground/70">
                Comisión habilitada únicamente por lo ya cobrado — se ve en Liquidaciones, no acá.
              </p>
            )}
          </div>

          {/* Bloque: Cómo se cobró */}
          <div className="mt-2 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3 space-y-0">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">
              Método de cobro
            </p>
            <Row
              label="💳 Método de pago"
              value={PAY_METHOD_LABEL[method] ?? method}
            />
            <Row
              label="📍 Origen del cobro"
              value={<ChargeTypePill type={chargeType} />}
            />
            <Row label="Estado" value={<StatusPill status={status} />} />
            {comprobante && (
              <Row label="Referencia / Comprobante" value={comprobante} />
            )}
            {method === "transfer" && (
              <Row
                label="Comprobante"
                value={
                  <ReceiptButton
                    payment={payment}
                    businessId={((payment as Record<string, unknown>).business_id as string) ?? null}
                  />
                }
              />
            )}
          </div>

          {/* Bloque: Trazabilidad */}
          <div className="mt-2 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3 space-y-0">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">
              Trazabilidad
            </p>
            <Row
              label="Nº de venta"
              value={<span className="font-mono">{ventaNum}</span>}
            />
            <Row label="Registrado" value={fmtDT(payment.created_at)} />
            <Row
              label="Cobrado"
              value={fmtDT(
                ((payment as Record<string, unknown>).charged_at as
                  | string
                  | null) ?? payment.created_at,
              )}
            />
          </div>

          {isPendingOrParcial && (
            <div className="mt-2 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">
                Historial de cobros
              </p>
              <VentaPendienteHistoryPanel paymentId={payment.id} />
            </div>
          )}

          {obs && (
            <div className="mt-2 rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">
                Nota / Observaciones
              </p>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                {obs}
              </p>
            </div>
          )}

          <div className="h-4" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Tarjeta chica reusada para Ingresos/Pendientes/Efectivo esperado/Dinero
// esperado en Facturación — mismo lenguaje visual (icono + label + monto
// grande) que ya usa Inicio para estas mismas cifras.
function FacturacionStatCard({
  icon: Icon,
  iconClass,
  label,
  value,
  loading,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  label: string;
  value: number;
  loading?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", iconClass)} />
        <span className="truncate text-xs">{label}</span>
      </div>
      <div className="mt-0.5">
        {loading ? (
          <div className="h-7 w-24 animate-pulse rounded-lg bg-white/[0.08]" />
        ) : (
          <Money value={value} large />
        )}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 rounded-xl bg-white/[0.03] ring-1 ring-white/8 px-3.5 py-3 text-left transition hover:bg-white/[0.05]"
      >
        {content}
      </button>
    );
  }
  return <div className="min-w-0 rounded-xl bg-white/[0.03] ring-1 ring-white/8 px-3.5 py-3">{content}</div>;
}

// Modal de "Ingresar dinero"/"Retirar dinero" — monto + motivo + medio
// (Efectivo/Cuenta); quién lo registró y fecha/hora quedan automáticos
// (userEmail + now(), ver registerMovement en use-cash-movements.ts).
function RegistrarMovimientoModal({
  tipo,
  onClose,
  onConfirm,
}: {
  tipo: "ingreso" | "retiro";
  onClose: () => void;
  onConfirm: (amount: number, note: string, method: "efectivo" | "cuenta") => Promise<void>;
}) {
  const [amountStr, setAmountStr] = React.useState("");
  const [note, setNote] = React.useState("");
  const [method, setMethod] = React.useState<"efectivo" | "cuenta">("efectivo");
  const [saving, setSaving] = React.useState(false);
  const isIngreso = tipo === "ingreso";
  const amount = Number(amountStr.replace(/\./g, "").replace(",", ".")) || 0;

  async function handleConfirm() {
    if (amount <= 0 || saving) return;
    setSaving(true);
    try {
      await onConfirm(amount, note, method);
      toast.success(isIngreso ? "Ingreso registrado" : "Retiro registrado");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h3 className="text-lg font-semibold">{isIngreso ? "Ingresar dinero" : "Retirar dinero"}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-sm"
          >
            Cancelar
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Monto</label>
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 focus-within:border-blue-300/40">
              <span className="text-muted-foreground/70">$</span>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value.replace(/[^\d.,]/g, ""))}
                className="w-full bg-transparent text-sm outline-none tabular-nums"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Motivo</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej: cambio inicial, retiro para depósito, etc."
              className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-blue-300/40"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Medio</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(["efectivo", "cuenta"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-sm font-semibold ring-1 transition",
                    method === m
                      ? "bg-white/[0.12] ring-white/25 text-white"
                      : "bg-white/[0.02] ring-white/10 text-muted-foreground hover:bg-white/[0.05]",
                  )}
                >
                  {/* Texto visible "Banco" — el valor interno sigue siendo
                      "cuenta" (enum/DB sin cambios, ver tipo CashMovement). */}
                  {m === "efectivo" ? "Efectivo" : "Banco"}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving || amount <= 0}
            className={cn(
              "w-full inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-50 transition-all",
              isIngreso
                ? "bg-gradient-to-b from-emerald-400 to-emerald-600 hover:brightness-105"
                : "bg-gradient-to-b from-rose-400 to-rose-600 hover:brightness-105",
            )}
          >
            {saving ? "Guardando…" : isIngreso ? "Ingresar dinero" : "Retirar dinero"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function movimientoRow(m: CashMovement) {
  const hora = m.created_at
    ? new Date(m.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
    : "—";
  return (
    <div key={m.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn("font-semibold", m.type === "ingreso" ? "text-emerald-300" : "text-rose-300")}
          >
            {m.type === "ingreso" ? "Ingreso" : "Retiro"}
          </span>
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            {m.method === "cuenta" ? "Cuenta" : "Efectivo"}
          </span>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {m.note || "—"} · {displayResponsibleUser(m.created_by)} · {hora}hs
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 font-semibold tabular-nums",
          m.type === "ingreso" ? "text-emerald-300" : "text-rose-300",
        )}
      >
        {m.type === "ingreso" ? "+" : "-"}${Math.round(m.amount).toLocaleString("es-AR")}
      </span>
    </div>
  );
}

// ── Movimientos de caja unificados ──────────────────────────────────────────
// Reemplaza los 3 historiales que antes vivían separados (Últimos ingresos /
// Movimientos de caja manuales / Historial de gastos) por un único feed
// cronológico de solo lectura. Fuente: las mismas 4 listas que ya devuelven
// useCajaData/useCashMovements — no se agrega ninguna tabla ni query nueva, y
// los totales de las stat cards (Ingresos/Pendientes/Gastos) SIEMPRE se leen
// directo de data.revHoy/data.pendingAmount/data.totalGastos, nunca sumando
// este feed (ver FacturacionPanel) — así un bug acá nunca puede alterar un
// total mostrado en pantalla.
//
// Las acciones reales (Cobrar/Rechazar un pendiente, ver detalle de una
// venta) siguen viviendo donde ya vivían (History con panel="pendientes" /
// "ingresos" fue reemplazado acá para la vista unificada, pero el bloque
// "Cobrar pendientes" dentro de FacturacionPanel sigue intacto) — este feed
// es solo para visualizar, no duplica esa interacción.
type UnifiedMovKind = "pago" | "gasto" | "pendiente" | "movimiento" | "venta_pendiente";
type UnifiedMovColor = "verde" | "rojo" | "ambar";

// Una venta con saldo (payments.status en pendiente/parcial — ver
// 20261023010000_pending_payments_schema.sql), agrupada con TODOS sus
// cobros de HOY en un solo ítem — nunca una fila por la venta y otra por
// cada cobro (eso duplicaba visualmente el mismo cobro inicial parcial,
// reportado en vivo). El detalle de cada pago individual (fecha exacta,
// método, quién) se consulta aparte, on-demand, al desplegar (ver
// getPaymentCollectionHistory) — acá solo vive el resumen necesario para
// la fila colapsada.
type VentaPendienteGroup = {
  paymentId: string;
  clientName: string | null;
  serviceName: string | null;
  employeeId: string | null;
  method: string | null;
  // Snapshot ACTUAL (al momento de esta carga) de la venta — total de la
  // venta, cuánto se cobró en total hasta ahora (toda la vida, no solo
  // hoy) y su status vigente.
  total: number;
  collectedToDate: number;
  status: string;
  saleCreatedAt: string;
  // Cuánto de ese collectedToDate entró HOY específicamente — es lo que se
  // muestra como "+$X"/"-$X" en la fila (puede ser 0 si la venta se creó
  // hoy sin cobrar nada, o negativo si hoy se revirtió más de lo que se
  // cobró hoy mismo).
  collectedTodayAmount: number;
  // Quién hizo el último cobro de HOY (o quién cargó la venta, si hoy no
  // hubo ningún cobro) — para la columna "Quién".
  lastActorLabel: string;
  // Momento más reciente de actividad de HOY contra esta venta (el último
  // cobro, o si no hubo ninguno, el de la creación) — determina dónde cae
  // este ítem en el orden cronológico del feed.
  ts: number;
};

type UnifiedMov = {
  id: string;
  kind: UnifiedMovKind;
  ts: number;
  color: UnifiedMovColor;
  amount: number;
  payment?: ReturnType<typeof useCajaData>["paymentsToday"][number];
  expense?: ReturnType<typeof useCajaData>["expensesToday"][number];
  pending?: ReturnType<typeof useCajaData>["pendingCharges"][number];
  movement?: CashMovement;
  venta?: VentaPendienteGroup;
};

const UNIFIED_COLOR_CLASSES: Record<
  UnifiedMovColor,
  { text: string; border: string; bg: string; bgMobile: string }
> = {
  verde: {
    text: "text-emerald-200",
    border: "border-l-emerald-300/80",
    bg: "bg-emerald-500/[0.075]",
    bgMobile: "bg-emerald-500/[0.11]",
  },
  rojo: {
    text: "text-rose-200",
    border: "border-l-rose-300/80",
    bg: "bg-rose-500/[0.075]",
    bgMobile: "bg-rose-500/[0.11]",
  },
  // "ambar" es el nombre interno del tipo (UnifiedMovColor) para "pendiente"
  // — a pedido explícito ahora se pinta celeste/sky acá (solo en este
  // historial unificado), no se renombró la clave para no tocar más
  // superficie de la esperada. El stat card "Pendientes" y el panel
  // expandible "Cobros pendientes" siguen en ámbar, sin cambios.
  ambar: {
    text: "text-sky-200",
    border: "border-l-sky-300/80",
    bg: "bg-sky-500/[0.075]",
    bgMobile: "bg-sky-500/[0.11]",
  },
};

function buildUnifiedMovements(
  paymentsToday: ReturnType<typeof useCajaData>["paymentsToday"],
  expensesToday: ReturnType<typeof useCajaData>["expensesToday"],
  pendingCharges: ReturnType<typeof useCajaData>["pendingCharges"],
  showPendientes: boolean,
  movements: CashMovement[],
  collections: PaymentCollectionRow[] = [],
): UnifiedMov[] {
  const items: UnifiedMov[] = [];

  // Ventas con saldo (pendiente/parcial) — una sola fila por venta,
  // agrupando CUALQUIER cobro de hoy contra ella (el inicial al vender Y
  // cualquiera posterior el mismo día), en vez de una fila por la venta y
  // otra por cada cobro (eso mostraba el mismo cobro inicial dos veces,
  // reportado en vivo). Dos pasadas: primero se siembra el grupo desde la
  // venta (si se creó hoy), después se van sumando los cobros de hoy —
  // así una venta de un día anterior que recién hoy recibe un cobro
  // también arma su grupo (sembrado desde el embed de la propia
  // collection), sin necesitar estar en paymentsToday.
  const ventaGroups = new Map<string, VentaPendienteGroup>();

  for (const p of paymentsToday) {
    if (p.status !== "pendiente" && p.status !== "parcial") continue;
    const raw = (p as { sort_ts?: string | null }).sort_ts ?? p.created_at;
    const ts = raw ? new Date(raw).getTime() : 0;
    const paymentRecord = p as unknown as Record<string, unknown>;
    const chargeType = getChargeType(paymentRecord);
    const actorLabel = getChargedByLabel(paymentRecord, null, chargeType);
    ventaGroups.set(p.id, {
      paymentId: p.id,
      clientName: p.client_name ?? null,
      serviceName: getSaleDetailLabel(paymentRecord),
      employeeId: p.employee_id ?? null,
      method: p.method ?? p.payment_method ?? null,
      total: Number(p.total ?? p.amount ?? 0),
      collectedToDate: Number(p.collected_amount ?? 0),
      status: p.status,
      saleCreatedAt: p.created_at,
      collectedTodayAmount: 0,
      lastActorLabel: `${actorLabel} → Cargó`,
      // Arranca en el momento de la venta — si hoy también se cobra algo,
      // el loop de collections de abajo lo corre al momento real del
      // cobro (más tarde).
      ts: Number.isFinite(ts) ? ts : 0,
    });
  }

  for (const c of collections) {
    const ts = c.collected_at ? new Date(c.collected_at).getTime() : 0;
    const amount = Number(c.amount ?? 0);
    let g = ventaGroups.get(c.payment_id);
    if (!g) {
      // Venta de un día anterior (no está en paymentsToday) — se siembra
      // acá mismo desde el snapshot embebido de la venta (ver el select de
      // payment_collections en use-caja-summary.ts).
      const snap = c.payments;
      g = {
        paymentId: c.payment_id,
        clientName: snap?.client_name ?? null,
        serviceName: snap?.service_name ?? null,
        employeeId: snap?.employee_id ?? null,
        method: c.method ?? null,
        total: Number(snap?.total ?? snap?.amount ?? 0),
        collectedToDate: Number(snap?.collected_amount ?? 0),
        status: snap?.status ?? "parcial",
        saleCreatedAt: snap?.created_at ?? c.collected_at,
        collectedTodayAmount: 0,
        lastActorLabel: "—",
        ts: Number.isFinite(ts) ? ts : 0,
      };
      ventaGroups.set(c.payment_id, g);
    }
    g.collectedTodayAmount += amount;
    g.lastActorLabel = `${c.collected_by_name || "—"} → ${amount < 0 ? "Revirtió" : "Cobró"}`;
    if (Number.isFinite(ts) && ts > g.ts) g.ts = ts;
  }

  for (const g of ventaGroups.values()) {
    items.push({
      id: `venta-${g.paymentId}`,
      kind: "venta_pendiente",
      ts: g.ts,
      color: g.collectedTodayAmount > 0 ? "verde" : g.collectedTodayAmount < 0 ? "rojo" : "ambar",
      amount: g.collectedTodayAmount,
      venta: g,
    });
  }

  // Ventas cobradas por completo en el momento (status='cobrado', nunca
  // pasaron por el ledger de pendientes) — sin cambios respecto de
  // siempre.
  for (const p of paymentsToday) {
    if (p.status === "pendiente" || p.status === "parcial") continue;
    const raw = (p as { sort_ts?: string | null }).sort_ts ?? p.created_at;
    const ts = raw ? new Date(raw).getTime() : 0;
    items.push({
      id: `pago-${p.id}`,
      kind: "pago",
      ts: Number.isFinite(ts) ? ts : 0,
      color: "verde",
      amount: Number(p.total ?? p.amount ?? 0) + Number(p.tip_amount ?? 0),
      payment: p,
    });
  }

  for (const e of expensesToday) {
    const raw = e.created_at ?? (e.date ? `${e.date}T00:00:00` : null);
    const ts = raw ? new Date(raw).getTime() : 0;
    items.push({
      id: `gasto-${e.id}`,
      kind: "gasto",
      ts: Number.isFinite(ts) ? ts : 0,
      color: "rojo",
      amount: Number(e.amount ?? 0),
      expense: e,
    });
  }

  // Un cobro pendiente nunca coexiste con su propio pago en paymentsToday —
  // al cobrarse pasa a esa lista y deja de estar en pendingCharges (son dos
  // colas separadas en useCajaData), así que no hay forma de que el mismo
  // cobro aparezca dos veces en este feed.
  if (showPendientes) {
    for (const p of pendingCharges) {
      const raw = p.sentAt ?? p.starts_at;
      const ts = raw ? new Date(raw).getTime() : 0;
      items.push({
        id: `pendiente-${p.id}`,
        kind: "pendiente",
        ts: Number.isFinite(ts) ? ts : 0,
        color: "ambar",
        amount: Number(p.service_price ?? 0),
        pending: p,
      });
    }
  }

  for (const m of movements) {
    const ts = m.created_at ? new Date(m.created_at).getTime() : 0;
    items.push({
      id: `mov-${m.id}`,
      kind: "movimiento",
      ts: Number.isFinite(ts) ? ts : 0,
      color: m.type === "ingreso" ? "verde" : "rojo",
      amount: Number(m.amount ?? 0),
      movement: m,
    });
  }

  // Más reciente primero. Empate de timestamp (dos movimientos en el mismo
  // segundo): orden estable de Array.sort alcanza, no hace falta un
  // desempate artificial — no hay ninguna expectativa de orden entre dos
  // movimientos simultáneos de fuentes distintas.
  items.sort((a, b) => b.ts - a.ts);
  return items;
}

// Huso horario fijo para todas las fechas/horas del historial unificado —
// explícito en vez de depender del huso del dispositivo/servidor (que en un
// render SSR puede no ser Argentina), para que "Hora" siempre sea la hora
// real de Buenos Aires sin importar dónde corra el código.
const ARG_TIME_ZONE = "America/Argentina/Buenos_Aires";

function formatArgFecha(dt: Date) {
  return Number.isNaN(dt.getTime())
    ? "—"
    : dt.toLocaleDateString("es-AR", { timeZone: ARG_TIME_ZONE, day: "numeric", month: "numeric" });
}

function formatArgHora(dt: Date) {
  return Number.isNaN(dt.getTime())
    ? "—"
    : `${dt.toLocaleTimeString("es-AR", {
        timeZone: ARG_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })}hs`;
}

// Vista normalizada de un UnifiedMov — mismas columnas para los 4 tipos
// (Fecha, Cliente/Concepto, Profesional, Servicio/Categoría, Monto, Método,
// Hora, Quién), con "—" donde un tipo no tiene ese dato. "Quién" es siempre
// "Nombre → Acción" de la acción principal (Cobró/Cargó/Ingresó/Retiró) — no
// el timeline completo de varios eventos que sí muestra HistorialCell en
// otros lados de la pantalla (p.ej. el bloque "Cobros pendientes"), a pedido
// explícito de simplificar esta vista. Reutiliza los mismos helpers que ya
// usaba cada historial por separado (getSaleDetailLabel, getChargedByLabel,
// displayCashActor, displayResponsibleUser, etc.) — nada de lógica nueva de
// quién hizo qué, solo de cómo se presenta.
function unifiedMovView(
  item: UnifiedMov,
  employees: ReturnType<typeof useCajaData>["employees"],
) {
  if (item.kind === "pago" && item.payment) {
    const p = item.payment;
    const dt = new Date(p.created_at);
    const empName = employees.find((e) => e.id === p.employee_id)?.name ?? "—";
    const paymentRecord = p as unknown as Record<string, unknown>;
    const chargeType = getChargeType(paymentRecord);
    const chargedByName = getChargedByLabel(
      paymentRecord,
      empName === "—" ? null : empName,
      chargeType,
    );
    const servicio = getSaleDetailLabel(paymentRecord);
    const nota = getCashRowNote(paymentRecord, servicio);
    return {
      typeLabel: "Ingreso",
      fecha: formatArgFecha(dt),
      hora: formatArgHora(dt),
      quien: `${chargedByName} → Cobró`,
      clienteOConcepto: p.client_name ?? "—",
      profesional: empName,
      servicio,
      metodoLabel: getPaymentMethodLabel(paymentRecord),
      nota,
      notaTitle: nota ? `${p.client_name ?? "Cliente"} · ${servicio ?? "Servicio"}` : null,
    };
  }

  if (item.kind === "gasto" && item.expense) {
    const e = item.expense;
    const createdDate = e.created_at ? new Date(e.created_at) : null;
    const rawDate = e.date || (createdDate ? createdDate.toISOString().slice(0, 10) : "");
    const fecha = rawDate ? formatArgFecha(new Date(`${rawDate}T00:00:00`)) : "—";
    const hora = createdDate ? formatArgHora(createdDate) : "—";
    const concepto = String(e.note?.trim() || e.name || "").trim();
    return {
      typeLabel: "Gasto",
      fecha,
      hora,
      // "Cargó" — mismo verbo en pasado que el resto (Cobró/Ingresó/
      // Retiró), no hay una acción "oficial" previa para gastos.
      quien: `${displayCashActor(e)} → Cargó`,
      clienteOConcepto: concepto || "—",
      profesional: "—",
      servicio: e.category ?? e.type ?? "—",
      metodoLabel: paymentMethodLabel(e.payment_method ?? ""),
      nota: null,
      notaTitle: null,
    };
  }

  if (item.kind === "pendiente" && item.pending) {
    const p = item.pending;
    const dt = new Date(p.starts_at);
    const empName = employees.find((e) => e.id === p.employee_id)?.name ?? "—";
    const historialEvents = p.events?.length ? p.events : getHistorialCobro(p.id);
    const lastEvent = historialEvents[historialEvents.length - 1] ?? null;
    const nota = getCashRowNote(p, p.service_name);
    return {
      typeLabel: "Pendiente",
      fecha: formatArgFecha(dt),
      hora: lastEvent?.time ?? "—",
      quien: lastEvent ? `${lastEvent.user} → ${lastEvent.action}` : "—",
      clienteOConcepto: p.client_name ?? "—",
      profesional: empName,
      servicio: p.service_name ?? "—",
      metodoLabel: "—",
      nota,
      notaTitle: nota ? `${p.client_name ?? "Cliente"} · ${p.service_name ?? "Servicio"}` : null,
    };
  }

  const m = item.movement!;
  const dt = new Date(m.created_at);
  const tipoLabel = m.type === "ingreso" ? "Ingreso manual" : "Retiro";
  // El concepto cargado en "Motivo" al registrar el movimiento (Ingresar/
  // Retirar dinero) es lo que tiene que verse en Cliente/Concepto — nunca
  // "—" ahí. cash_movements.note es el único campo de texto que carga ese
  // formulario (ver RegistrarMovimientoModal), así que si por algún motivo
  // quedó vacío, el fallback es el tipo de movimiento, no un guion.
  const concepto = m.note?.trim() || tipoLabel;
  return {
    typeLabel: tipoLabel,
    fecha: formatArgFecha(dt),
    hora: formatArgHora(dt),
    quien: `${displayResponsibleUser(m.created_by)} → ${m.type === "ingreso" ? "Ingresó" : "Retiró"}`,
    clienteOConcepto: concepto,
    profesional: "—",
    servicio: "—",
    metodoLabel: m.method === "cuenta" ? "Cuenta" : "Efectivo",
    nota: null,
    notaTitle: null,
  };
}

const UNIFIED_GRID_COLS =
  "grid-cols-[64px_minmax(150px,0.85fr)_minmax(130px,0.7fr)_minmax(220px,1.1fr)_120px_110px_72px_minmax(190px,0.9fr)]";

function UnifiedMovRow({
  item,
  employees,
  businessId,
  onClick,
  onShowNote,
}: {
  item: UnifiedMov;
  employees: ReturnType<typeof useCajaData>["employees"];
  businessId: string | null;
  onClick?: () => void;
  onShowNote?: (title: string, note: string) => void;
}) {
  const view = unifiedMovView(item, employees);
  const colorCls = UNIFIED_COLOR_CLASSES[item.color];
  const sign = item.color === "rojo" ? "-" : "+";
  return (
    <div
      className={cn(
        "grid items-center gap-x-3 border-l-2 px-5 py-3 text-xs border-b border-white/[0.07] last:border-b-0 transition-colors",
        UNIFIED_GRID_COLS,
        colorCls.border,
        colorCls.bg,
        onClick ? "cursor-pointer hover:brightness-125" : "",
      )}
      onClick={onClick}
    >
      <div className="text-muted-foreground whitespace-nowrap">{view.fecha}</div>
      <div className="text-foreground truncate">{view.clienteOConcepto}</div>
      <div className="text-muted-foreground truncate">{view.profesional}</div>
      <div className="min-w-0 truncate text-muted-foreground">
        <span>{view.servicio}</span>
        {view.nota && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onShowNote?.(view.notaTitle ?? "Nota", view.nota!);
            }}
            className="ml-2 rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300 ring-1 ring-sky-300/20 hover:bg-sky-400/20 transition"
            title="Ver nota del profesional"
          >
            Ver nota
          </button>
        )}
      </div>
      <div className={cn("text-right font-bold tabular-nums", colorCls.text)}>
        {sign}${Math.round(Math.abs(item.amount)).toLocaleString("es-AR")}
      </div>
      <div className="min-w-0 flex flex-col text-muted-foreground">
        <span className="truncate">{view.metodoLabel}</span>
        {item.kind === "pago" && item.payment && (
          <ReceiptButton payment={item.payment} businessId={businessId} />
        )}
      </div>
      <div className="text-muted-foreground whitespace-nowrap">{view.hora}</div>
      <div className="min-w-0 truncate text-muted-foreground">{view.quien}</div>
    </div>
  );
}

function UnifiedMovCardMobile({
  item,
  employees,
  businessId,
  onClick,
  onShowNote,
}: {
  item: UnifiedMov;
  employees: ReturnType<typeof useCajaData>["employees"];
  businessId: string | null;
  onClick?: () => void;
  onShowNote?: (title: string, note: string) => void;
}) {
  const view = unifiedMovView(item, employees);
  const colorCls = UNIFIED_COLOR_CLASSES[item.color];
  const sign = item.color === "rojo" ? "-" : "+";
  return (
    <div
      className={cn(
        "w-full rounded-2xl border-l-2 border border-white/[0.07] px-3.5 py-3 text-xs",
        colorCls.border,
        colorCls.bgMobile,
        onClick ? "cursor-pointer active:brightness-125" : "",
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {view.typeLabel} · {view.fecha} · {view.hora}
        </span>
        <span className={cn("text-sm font-bold tabular-nums", colorCls.text)}>
          {sign}${Math.round(Math.abs(item.amount)).toLocaleString("es-AR")}
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-muted-foreground/70">Cliente / concepto</span>
          <span className="truncate text-right text-foreground/90">{view.clienteOConcepto}</span>
        </div>
        {view.profesional !== "—" && (
          <div className="flex items-start justify-between gap-3">
            <span className="shrink-0 text-muted-foreground/70">Profesional</span>
            <span className="truncate text-right text-muted-foreground">{view.profesional}</span>
          </div>
        )}
        {view.servicio !== "—" && (
          <div className="flex items-start justify-between gap-3">
            <span className="shrink-0 text-muted-foreground/70">Servicio / categoría</span>
            <span className="truncate text-right text-muted-foreground">{view.servicio}</span>
          </div>
        )}
        {view.nota && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onShowNote?.(view.notaTitle ?? "Nota", view.nota!);
              }}
              className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300 ring-1 ring-sky-300/20 hover:bg-sky-400/20 transition"
              title="Ver nota del profesional"
            >
              Ver nota
            </button>
          </div>
        )}
        {view.metodoLabel !== "—" && (
          <div className="flex items-start justify-between gap-3">
            <span className="shrink-0 text-muted-foreground/70">Método</span>
            <span className="truncate text-right text-muted-foreground">{view.metodoLabel}</span>
          </div>
        )}
        {item.kind === "pago" && item.payment && (
          <div className="flex justify-end">
            <ReceiptButton payment={item.payment} businessId={businessId} />
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-muted-foreground/70">Quién</span>
          <span className="truncate text-right text-muted-foreground">{view.quien}</span>
        </div>
      </div>
    </div>
  );
}

function VentaPendienteBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pendiente: { label: "Pendiente", cls: "bg-amber-400/15 text-amber-200 ring-amber-400/25" },
    parcial: { label: "Parcialmente pagado", cls: "bg-sky-400/15 text-sky-200 ring-sky-400/25" },
    cobrado: { label: "Pagado", cls: "bg-emerald-400/15 text-emerald-200 ring-emerald-400/25" },
  };
  const v = map[status] ?? map.pendiente;
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1", v.cls)}>
      {v.label}
    </span>
  );
}

// Historial completo de pagos de UNA venta (todos los cobros, incluidas
// reversiones) — se pide on-demand recién al desplegar la fila, nunca
// precargado (ver getPaymentCollectionHistory). Mantiene el registro
// contable individual de cada pago a la vista, sin sumarlos entre sí
// salvo en el resumen de arriba (venta/total.cobrado/saldo, que vienen
// del snapshot ya cargado, no de este fetch).
function VentaPendienteHistoryPanel({ paymentId }: { paymentId: string }) {
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
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Cargando historial de pagos…
      </div>
    );
  }
  if (!items || items.length === 0) {
    return <div className="text-xs text-muted-foreground">Todavía no se cobró nada de esta venta.</div>;
  }

  return (
    <div className="divide-y divide-white/[0.06]">
      {items.map((it) => {
        const dt = new Date(it.collected_at);
        const isReversal = it.amount < 0;
        return (
          <div key={it.id} className="flex items-center justify-between gap-3 py-2 text-xs">
            <div className="flex min-w-0 flex-col">
              <span className="text-foreground/85">
                {formatArgFecha(dt)} · {formatArgHora(dt)}
              </span>
              <span className="truncate text-muted-foreground">
                {paymentMethodLabel(it.method ?? "")}
                {it.collected_by_name ? ` · ${it.collected_by_name}` : ""}
                {isReversal && it.reversal_reason ? ` · Reversión: ${it.reversal_reason}` : ""}
                {it.observations ? ` · ${it.observations}` : ""}
              </span>
            </div>
            <span className={cn("shrink-0 font-bold tabular-nums", isReversal ? "text-rose-300" : "text-emerald-300")}>
              {isReversal ? "-" : "+"}${Math.abs(it.amount).toLocaleString("es-AR")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Fila de "venta con saldo" (pendiente/parcial) — agrupa la venta y TODOS
// sus cobros de hoy en un solo renglón (nunca una fila por la venta y otra
// por cada cobro, eso duplicaba visualmente el mismo cobro). Un click abre
// el detalle completo de la venta en DetailModal (historial de cobros +
// eliminar), igual que cualquier otra fila de tipo "pago".
function VentaPendienteRow({
  item,
  employees,
  onClick,
  loading,
}: {
  item: UnifiedMov;
  employees: ReturnType<typeof useCajaData>["employees"];
  onClick?: () => void;
  loading?: boolean;
}) {
  const g = item.venta!;
  const empName = employees.find((e) => e.id === g.employeeId)?.name ?? "—";
  const dt = new Date(item.ts || Date.now());
  const saldo = Math.max(0, Math.round(g.total - g.collectedToDate));
  const colorCls = UNIFIED_COLOR_CLASSES[item.color];
  const sign = item.amount < 0 ? "-" : item.amount > 0 ? "+" : "";

  return (
    <div
      className={cn(
        "grid items-center gap-x-3 border-l-2 px-5 py-3 text-xs border-b border-white/[0.07] last:border-b-0 transition-colors",
        UNIFIED_GRID_COLS,
        colorCls.border,
        colorCls.bg,
        onClick ? "cursor-pointer hover:brightness-125" : "",
        loading ? "opacity-60 pointer-events-none" : "",
      )}
      onClick={onClick}
    >
      <div className="text-muted-foreground whitespace-nowrap">{formatArgFecha(dt)}</div>
      <div className="flex min-w-0 items-center gap-1.5 text-foreground">
        {loading && <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />}
        <span className="truncate">{g.clientName ?? "—"}</span>
      </div>
      <div className="text-muted-foreground truncate">{empName}</div>
      <div className="min-w-0 truncate text-muted-foreground">
        <span>{g.serviceName ?? "—"}</span>
        <VentaPendienteBadge status={g.status} />
        <span className="ml-2 text-[10px] text-muted-foreground/70">
          Venta ${Math.round(g.total).toLocaleString("es-AR")} · Cobrado ${Math.round(g.collectedToDate).toLocaleString("es-AR")} · Saldo ${saldo.toLocaleString("es-AR")}
        </span>
      </div>
      <div className={cn("text-right font-bold tabular-nums", sign ? colorCls.text : "text-muted-foreground/50")}>
        {sign}${Math.round(Math.abs(item.amount)).toLocaleString("es-AR")}
      </div>
      <div className="min-w-0 truncate text-muted-foreground">{paymentMethodLabel(g.method ?? "")}</div>
      <div className="text-muted-foreground whitespace-nowrap">{formatArgHora(dt)}</div>
      <div className="min-w-0 truncate text-muted-foreground">{g.lastActorLabel}</div>
    </div>
  );
}

function VentaPendienteCardMobile({
  item,
  employees,
  onClick,
  loading,
}: {
  item: UnifiedMov;
  employees: ReturnType<typeof useCajaData>["employees"];
  onClick?: () => void;
  loading?: boolean;
}) {
  const g = item.venta!;
  const empName = employees.find((e) => e.id === g.employeeId)?.name ?? "—";
  const dt = new Date(item.ts || Date.now());
  const saldo = Math.max(0, Math.round(g.total - g.collectedToDate));
  const colorCls = UNIFIED_COLOR_CLASSES[item.color];
  const sign = item.amount < 0 ? "-" : item.amount > 0 ? "+" : "";

  return (
    <div
      className={cn(
        "w-full rounded-2xl border-l-2 border border-white/[0.07] px-3.5 py-3 text-xs",
        colorCls.border,
        colorCls.bgMobile,
        onClick ? "cursor-pointer active:brightness-125" : "",
        loading ? "opacity-60 pointer-events-none" : "",
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {loading && <Loader2 className="size-3 shrink-0 animate-spin" />}
          {formatArgFecha(dt)} · {formatArgHora(dt)}
        </span>
        <span className={cn("text-sm font-bold tabular-nums", sign ? colorCls.text : "text-muted-foreground/50")}>
          {sign}${Math.round(Math.abs(item.amount)).toLocaleString("es-AR")}
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-muted-foreground/70">Cliente</span>
          <span className="flex items-center gap-1.5 truncate text-right text-foreground/90">
            {g.clientName ?? "—"} <VentaPendienteBadge status={g.status} />
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-muted-foreground/70">Profesional</span>
          <span className="truncate text-right text-muted-foreground">{empName}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-muted-foreground/70">Servicio</span>
          <span className="truncate text-right text-muted-foreground">{g.serviceName ?? "—"}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-muted-foreground/70">Venta / cobrado / saldo</span>
          <span className="truncate text-right text-muted-foreground">
            ${Math.round(g.total).toLocaleString("es-AR")} / ${Math.round(g.collectedToDate).toLocaleString("es-AR")} / ${saldo.toLocaleString("es-AR")}
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-muted-foreground/70">Quién</span>
          <span className="truncate text-right text-muted-foreground">{g.lastActorLabel}</span>
        </div>
      </div>
    </div>
  );
}

// Despacha al componente correcto según el tipo — "venta_pendiente" usa su
// propia fila agrupada+desplegable, el resto sigue con UnifiedMovRow/
// UnifiedMovCardMobile de siempre. Evita tocar los 4 call-sites (feed +
// modal "Ver todos", desktop + mobile) con un ternario cada uno.
function UnifiedRowAny(props: React.ComponentProps<typeof UnifiedMovRow> & { loading?: boolean }) {
  if (props.item.kind === "venta_pendiente") {
    return <VentaPendienteRow item={props.item} employees={props.employees} onClick={props.onClick} loading={props.loading} />;
  }
  return <UnifiedMovRow {...props} />;
}
function UnifiedCardAny(props: React.ComponentProps<typeof UnifiedMovCardMobile> & { loading?: boolean }) {
  if (props.item.kind === "venta_pendiente") {
    return <VentaPendienteCardMobile item={props.item} employees={props.employees} onClick={props.onClick} loading={props.loading} />;
  }
  return <UnifiedMovCardMobile {...props} />;
}

// Historial unificado que reemplaza "Últimos ingresos" + el bloque viejo
// "Movimientos de caja" (cash_movements) + la tabla de Gastos — últimos 10,
// más reciente primero. "Ver todos los movimientos" abre el mismo feed sin
// límite. El click en una fila de tipo "pago" abre el mismo DetailModal que
// ya existía; los demás tipos son de solo lectura (sus acciones reales —
// cobrar/rechazar un pendiente — siguen en el bloque "Cobros pendientes" de
// FacturacionPanel, no se duplican acá).
function MovimientosUnificados({
  data,
  movementsData,
  showPendientes,
}: {
  data: ReturnType<typeof useCajaData>;
  movementsData: ReturnType<typeof useCashMovements>;
  showPendientes: boolean;
}) {
  const [allOpen, setAllOpen] = React.useState(false);
  const [detailPayment, setDetailPayment] = React.useState<
    ReturnType<typeof useCajaData>["paymentsToday"][number] | null
  >(null);
  // "Ver nota" (nota del profesional en una venta o pendiente) — mismo
  // modal/estilo que ya usaba History (pendingNoteModal), restaurado acá
  // para no perder esa funcionalidad al unificar el historial.
  const [noteModal, setNoteModal] = React.useState<{ title: string; note: string } | null>(null);
  const showNote = React.useCallback((title: string, note: string) => setNoteModal({ title, note }), []);
  // Ninguno de los dos modales de acá abajo bloqueaba el scroll de fondo
  // (a diferencia de DetailModal, que sí usa este mismo hook) — en iOS
  // Safari eso deja el rubber-band del viewport moviendo el contenido de
  // atrás mientras el modal está abierto, y la página puede quedar en un
  // scroll inconsistente al cerrarlo. useBodyScrollLock es contador
  // global (ver use-body-scroll-lock.ts): abrir "Ver nota" arriba de "Ver
  // todos los movimientos" no pisa el lock del otro, cada unlock solo
  // actúa cuando ya no queda ninguno abierto.
  useBodyScrollLock(allOpen);
  useBodyScrollLock(Boolean(noteModal));

  // El feed "de hoy" (esta lista de los últimos 10, sin el modal "Ver
  // todos los movimientos" — ese ya se filtraba bien más abajo con
  // paymentsForSelectedDate) tiene que mostrar EXCLUSIVAMENTE la jornada
  // actual: data.paymentsToday/expensesToday/movementsData.movements
  // siguen traen también el backlog de un día anterior sin cerrar (lo
  // necesita "Efectivo esperado en caja", que sí tiene que verlo), pero
  // ese backlog no puede aparecer mezclado en "Movimientos de caja" — una
  // jornada pendiente de revisión se consulta desde Cierre de caja →
  // Pendiente de revisión, nunca filtrada adentro de la caja del día
  // siguiente.
  const todayKeyBA = cajaDateKeyBA();
  const paymentsOnlyToday = React.useMemo(
    () => filterToDayBA(data.paymentsToday, (p) => p.created_at, todayKeyBA),
    [data.paymentsToday, todayKeyBA],
  );
  const expensesOnlyToday = React.useMemo(
    () => data.expensesToday.filter((e) => e.date === todayKeyBA),
    [data.expensesToday, todayKeyBA],
  );
  const movementsOnlyToday = React.useMemo(
    () => filterToDayBA(movementsData.movements, (m) => m.created_at, todayKeyBA),
    [movementsData.movements, todayKeyBA],
  );

  const all = React.useMemo(
    () =>
      buildUnifiedMovements(
        paymentsOnlyToday,
        expensesOnlyToday,
        data.pendingCharges,
        showPendientes,
        movementsOnlyToday,
        data.collectionsToday,
      ),
    [
      paymentsOnlyToday,
      expensesOnlyToday,
      data.pendingCharges,
      showPendientes,
      movementsOnlyToday,
      data.collectionsToday,
    ],
  );
  const recent = all.slice(0, 10);
  const loading = data.loading || movementsData.loading;

  // Carga la venta completa desde la base (nunca el snapshot resumido del
  // grupo, que puede faltar columnas si el grupo se sembró desde el embed
  // de un cobro de un día anterior — ver buildUnifiedMovements) para abrir
  // el mismo DetailModal que cualquier otro pago, con permiso de eliminar.
  const [loadingVentaDetailId, setLoadingVentaDetailId] = React.useState<string | null>(null);
  async function openVentaPendienteDetail(paymentId: string) {
    setLoadingVentaDetailId(paymentId);
    try {
      const { data: full, error } = await supabase
        .from("payments")
        .select("*")
        .eq("id", paymentId)
        .maybeSingle();
      if (error) throw error;
      if (full) setDetailPayment(full as unknown as ReturnType<typeof useCajaData>["paymentsToday"][number]);
      else toast.error("No se encontró la venta");
    } catch (e) {
      toast.error((e as Error).message || "No se pudo abrir el detalle de la venta");
    } finally {
      setLoadingVentaDetailId(null);
    }
  }

  function handleRowClick(item: UnifiedMov) {
    if (item.kind === "pago" && item.payment) setDetailPayment(item.payment);
    else if (item.kind === "venta_pendiente" && item.venta) openVentaPendienteDetail(item.venta.paymentId);
  }

  function closeAllModal() {
    setAllOpen(false);
    // Arranca de nuevo en "Todos los profesionales" y en el día de hoy la
    // próxima vez que se abra, en vez de quedar pegado al último filtro
    // elegido.
    setSelectedProfessionalId(null);
    setSelectedDateKey(cajaDateKeyBA());
  }

  // Fecha del modal "Ver todos los movimientos" — por defecto HOY (huso
  // Buenos Aires), nunca el acumulado de días sin cerrar. data.paymentsToday/
  // expensesToday/movementsData.movements pueden traer también backlog de
  // un día anterior sin cerrar (ver cajaOpenRangeStartDate) — por eso TODO
  // lo que se muestra o calcula en este modal pasa por este filtro antes,
  // nunca directo de esos arrays acumulados.
  const [selectedDateKey, setSelectedDateKey] = React.useState(() => cajaDateKeyBA());
  const paymentsForSelectedDate = React.useMemo(
    () => filterToDayBA(data.paymentsToday, (p) => p.created_at, selectedDateKey),
    [data.paymentsToday, selectedDateKey],
  );
  // Cobros de pendientes (payment_collections) de la fecha elegida — por
  // collected_at, igual criterio que paymentsForSelectedDate. Necesario
  // para que "Resumen por método de pago" cuente la plata real de una
  // venta pendiente/parcial (su total NO se suma ahí, ver closeoutByMethod
  // más abajo — mismo criterio que computeExpectedCashAndDigital).
  const collectionsForSelectedDate = React.useMemo(
    () => filterToDayBA(data.collectionsForPeriod, (c) => c.collected_at, selectedDateKey),
    [data.collectionsForPeriod, selectedDateKey],
  );

  // Selector de profesional del modal "Ver todos los movimientos" — null =
  // Todos los profesionales. Solo lista profesionales con al menos un cobro
  // en la fecha elegida, no cualquier empleado activo ni el período
  // acumulado completo.
  const [selectedProfessionalId, setSelectedProfessionalId] = React.useState<string | null>(null);
  const professionalOptions = React.useMemo(() => {
    const ids = new Set(
      paymentsForSelectedDate.map((p) => p.employee_id).filter((id): id is string => !!id),
    );
    return data.employees
      .filter((e) => ids.has(e.id))
      .map((e) => ({ id: e.id, name: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [paymentsForSelectedDate, data.employees]);

  const professionalPayments = React.useMemo(
    () =>
      selectedProfessionalId
        ? paymentsForSelectedDate.filter((p) => p.employee_id === selectedProfessionalId)
        : [],
    [paymentsForSelectedDate, selectedProfessionalId],
  );
  const professionalCollections = React.useMemo(
    () =>
      selectedProfessionalId
        ? collectionsForSelectedDate.filter((c) => c.payments?.employee_id === selectedProfessionalId)
        : [],
    [collectionsForSelectedDate, selectedProfessionalId],
  );

  // Resumen por método de pago — mismo cálculo que ya existía en History
  // (closeout). Con un profesional elegido, reutiliza professionalPayments
  // (ya filtrado por profesional Y por fecha); sin profesional ("Todos"),
  // usa paymentsForSelectedDate (ya acotado a la fecha elegida, nunca el
  // acumulado completo). En los dos casos la fuente es siempre payments —
  // nunca gastos, movimientos manuales ni pendientes — y un método sin
  // cobros simplemente no genera entrada en el reduce, así que "monto > 0"
  // queda garantizado sin un filtro aparte. Nunca suma tip_amount: la
  // propina es plata del profesional, no facturación del negocio — mismo
  // criterio que "Ingresos" en toda la app. (computeExpectedCashAndDigital
  // SÍ suma la propina, pero para "efectivo/cuenta esperados" — plata que
  // físicamente entra a la caja —, nunca para facturación/Ingresos como
  // este resumen.)
  const closeoutByMethod = React.useMemo(() => {
    const paySource = selectedProfessionalId ? professionalPayments : paymentsForSelectedDate;
    const collSource = selectedProfessionalId ? professionalCollections : collectionsForSelectedDate;
    const groups: Record<string, { method: string; total: number; count: number }> = {};
    for (const payment of paySource) {
      // pendiente/parcial: su plata real (al vender Y cualquier cobro
      // posterior) se cuenta exclusivamente vía collSource, más abajo —
      // sumar acá TAMBIÉN payment.total mostraría el total de la venta
      // como si estuviera cobrado por ese medio, mismo bug que ya se
      // corrigió en computeExpectedCashAndDigital.
      if (payment.status === "pendiente" || payment.status === "parcial") continue;
      const method = String(payment.method ?? payment.payment_method ?? "cash");
      if (!groups[method]) groups[method] = { method, total: 0, count: 0 };
      groups[method].total += Number(payment.total ?? payment.amount ?? 0);
      groups[method].count += 1;
    }
    for (const c of collSource) {
      const method = String(c.method ?? "cash");
      if (!groups[method]) groups[method] = { method, total: 0, count: 0 };
      groups[method].total += Number(c.amount ?? 0);
      groups[method].count += 1;
    }
    return Object.values(groups).sort((a, b) => b.total - a.total);
  }, [selectedProfessionalId, professionalPayments, paymentsForSelectedDate, professionalCollections, collectionsForSelectedDate]);

  // Comisión real de cada cobro — commission_records.amount, la misma
  // fuente que ya usa DetailModal (computeCommissionAmount al momento del
  // cobro, prioridad servicio > fijo > %; ver ese comentario más arriba).
  // Nunca se recalcula acá, solo se suma lo que ya quedó guardado por
  // sale_id — así respeta automáticamente cualquier promoción/descuento que
  // ya haya ajustado esa comisión en su momento.
  const [commissionBySaleId, setCommissionBySaleId] = React.useState<Record<string, number>>({});
  React.useEffect(() => {
    if (professionalPayments.length === 0) {
      setCommissionBySaleId({});
      return;
    }
    let cancelled = false;
    const saleIds = professionalPayments.map((p) => p.id);
    supabase
      .from("commission_records" as any)
      .select("sale_id,amount")
      .in("sale_id", saleIds)
      .then(({ data: rows }) => {
        if (cancelled) return;
        const map: Record<string, number> = {};
        for (const r of (rows ?? []) as { sale_id: string; amount: number }[]) {
          map[r.sale_id] = (map[r.sale_id] ?? 0) + Number(r.amount ?? 0);
        }
        setCommissionBySaleId(map);
      });
    return () => {
      cancelled = true;
    };
  }, [professionalPayments]);

  // Servicios/Facturación nunca de gastos, movimientos manuales ni
  // pendientes sin cobrar — professionalPayments sale de data.paymentsToday,
  // que por definición son solo cobros ya completados (los pendientes viven
  // en data.pendingCharges, una lista aparte).
  const professionalSummary = React.useMemo(() => {
    if (!selectedProfessionalId) return null;
    const servicios = professionalPayments.length;
    const facturacion = professionalPayments.reduce(
      (s, p) => s + Number(p.total ?? p.amount ?? 0),
      0,
    );
    const comision = professionalPayments.reduce(
      (s, p) => s + (commissionBySaleId[p.id] ?? 0),
      0,
    );
    return { servicios, facturacion, comision };
  }, [selectedProfessionalId, professionalPayments, commissionBySaleId]);

  // Filtra el listado del modal (no el acotado a 10 de abajo, que no tiene
  // selector) a la fecha elegida y, si hay uno, al profesional elegido —
  // los dos filtros se combinan, nunca uno pisa al otro.
  const modalItems = React.useMemo(() => {
    const { start, end } = dayBoundsBA(selectedDateKey);
    const startMs = start.getTime();
    const endMs = end.getTime();
    const byDate = all.filter((item) => item.ts >= startMs && item.ts <= endMs);
    if (!selectedProfessionalId) return byDate;
    return byDate.filter(
      (item) =>
        (item.kind === "pago" && item.payment?.employee_id === selectedProfessionalId) ||
        (item.kind === "venta_pendiente" && item.venta?.employeeId === selectedProfessionalId),
    );
  }, [all, selectedDateKey, selectedProfessionalId]);

  return (
    <>
      <Card className="rounded-3xl border-white/[0.075] bg-white/[0.02]">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5">
          <h3 className="text-sm font-bold text-foreground/90">Movimientos de caja</h3>
        </div>

        {/* Desktop: tabla con scroll horizontal — mobile usa tarjetas. */}
        <div className="hidden overflow-x-auto sm:block">
          <div className="min-w-[1020px]">
            <div
              className={cn(
                "grid items-center gap-x-3 px-6 py-2.5 text-[10px] font-semibold tracking-[0.18em] text-muted-foreground/60 border-b border-white/[0.07] uppercase",
                UNIFIED_GRID_COLS,
              )}
            >
              <div>Fecha</div>
              <div>Cliente / concepto</div>
              <div>Profesional</div>
              <div>Servicio / categoría</div>
              <div className="text-right">Monto</div>
              <div>Método</div>
              <div>Hora</div>
              <div>Quién</div>
            </div>
            {loading ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">Cargando…</div>
            ) : recent.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                Todavía no hay movimientos registrados hoy.
              </div>
            ) : (
              <div>
                {recent.map((item) => (
                  <UnifiedRowAny
                    key={item.id}
                    item={item}
                    employees={data.employees}
                    businessId={data.businessId}
                    onClick={item.kind === "pago" || item.kind === "venta_pendiente" ? () => handleRowClick(item) : undefined}
                    onShowNote={showNote}
                    loading={item.kind === "venta_pendiente" && item.venta?.paymentId === loadingVentaDetailId}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="sm:hidden">
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">Cargando…</div>
          ) : recent.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              Todavía no hay movimientos registrados hoy.
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-3">
              {recent.map((item) => (
                <UnifiedCardAny
                  key={item.id}
                  item={item}
                  employees={data.employees}
                  businessId={data.businessId}
                  onClick={item.kind === "pago" || item.kind === "venta_pendiente" ? () => handleRowClick(item) : undefined}
                  onShowNote={showNote}
                  loading={item.kind === "venta_pendiente" && item.venta?.paymentId === loadingVentaDetailId}
                />
              ))}
            </div>
          )}
        </div>

        {all.length > 10 && (
          <div className="flex items-center justify-end border-t border-white/[0.07] px-6 py-2">
            <button
              type="button"
              onClick={() => setAllOpen(true)}
              className="inline-flex items-center gap-2 text-xs font-semibold text-foreground/70 transition hover:text-foreground"
            >
              <ClipboardList className="size-3.5" /> Ver todos los movimientos <ArrowRight className="size-3.5" />
            </button>
          </div>
        )}
      </Card>

      {allOpen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={closeAllModal}
        >
          <div
            // h-[...] (no max-h-): fuerza SIEMPRE esta altura, sin importar
            // cuánto contenido tenga la lista de abajo — antes el card no
            // tenía alto propio, así que con pocos movimientos (ej. un
            // profesional con 1 solo cobro) se achicaba a su contenido y,
            // al estar centrado con grid place-items-center, el borde
            // superior bajaba con cada cambio de filtro. Con alto fijo acá,
            // header/selector/resumen quedan anclados en el mismo lugar en
            // los tres casos (Todos, muchos movimientos, un solo
            // movimiento) y el espacio sobrante (si hay pocos) queda vacío
            // debajo en vez de encoger el modal.
            className="flex h-[min(820px,82vh)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/[0.085] bg-[linear-gradient(135deg,rgba(10,8,14,0.98),rgba(8,10,20,0.97),rgba(3,5,12,0.99))] shadow-[0_40px_120px_-55px_rgba(0,0,0,1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
              <h3 className="text-lg font-bold text-white">Todos los movimientos</h3>
              <button
                type="button"
                onClick={closeAllModal}
                className="h-10 rounded-2xl bg-white/[0.06] px-4 text-xs font-semibold text-white/70 hover:bg-white/[0.09] hover:text-white"
              >
                Cerrar
              </button>
            </div>

            {/* Filtro por profesional — Servicios/Facturación/Comisión usan
                exactamente data.paymentsToday (cobros ya completados) y
                commission_records (comisión real guardada al momento del
                cobro, no recalculada), nunca gastos/movimientos
                manuales/pendientes sin cobrar.

                "Todos los profesionales": solo el selector, sin métricas.
                Con un profesional elegido: selector a la izquierda y las 3
                métricas a la derecha, MISMA fila (flex-row desde sm:, con
                justify-between). La fila nunca gana una segunda línea en
                desktop porque las métricas van inline, no en un grid debajo
                — por eso no hace falta reservar altura con min-h ni nada
                parecido: el alto de la fila es siempre el del <select>,
                tanto si las métricas están como si no. En mobile se
                permite apilar (flex-col) porque no entra todo en una fila
                angosta. */}
            <div className="flex shrink-0 flex-col gap-3 border-b border-white/10 bg-white/[0.02] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {/* Fecha a consultar — por defecto hoy (huso Buenos Aires).
                    max=hoy: este modal es para revisar días ya cobrados,
                    nunca una fecha futura. */}
                <input
                  type="date"
                  value={selectedDateKey}
                  max={cajaDateKeyBA()}
                  onChange={(e) => setSelectedDateKey(e.target.value || cajaDateKeyBA())}
                  className="h-10 shrink-0 rounded-xl bg-white/[0.05] ring-1 ring-white/10 px-3 text-sm text-white outline-none focus:ring-2 focus:ring-primary/50"
                />
                <select
                  value={selectedProfessionalId ?? ""}
                  onChange={(e) => setSelectedProfessionalId(e.target.value || null)}
                  className="h-10 w-full shrink-0 rounded-xl bg-white/[0.05] ring-1 ring-white/10 px-3 text-sm text-white outline-none focus:ring-2 focus:ring-primary/50 sm:w-auto"
                >
                  <option value="">Todos los profesionales</option>
                  {professionalOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {professionalSummary && (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 sm:flex-nowrap sm:justify-end">
                  <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
                      Servicios
                    </span>
                    <span className="text-sm font-bold tabular-nums text-white">
                      {professionalSummary.servicios}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-emerald-300/70">
                      Facturación
                    </span>
                    <span className="text-sm font-bold tabular-nums text-emerald-300">
                      ${Math.round(professionalSummary.facturacion).toLocaleString("es-AR")}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-violet-300/70">
                      Comisión
                    </span>
                    <span className="text-sm font-bold tabular-nums text-violet-300">
                      ${Math.round(professionalSummary.comision).toLocaleString("es-AR")}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {closeoutByMethod.length > 0 && (
              <div className="flex shrink-0 flex-wrap gap-2 border-b border-white/10 bg-white/[0.02] px-5 py-3">
                {closeoutByMethod.map((g) => (
                  <span
                    key={g.method}
                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-400/20"
                  >
                    {paymentMethodLabel(g.method)}: ${Math.round(g.total).toLocaleString("es-AR")} ({g.count})
                  </span>
                ))}
              </div>
            )}

            {/* flex-1 + min-h-0 (no max-h-[70vh] fijo): esta es la ÚNICA
                zona que scrollea adentro del card de alto fijo de arriba.
                min-h-0 es necesario para que un hijo flex con overflow-y-auto
                pueda achicarse por debajo de su contenido — sin esto, un
                listado largo empuja el alto del padre en vez de scrollear. */}
            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
              <div className="hidden min-w-[1020px] sm:block">
                {modalItems.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-white/45">
                    Sin movimientos registrados.
                  </div>
                ) : (
                  modalItems.map((item) => (
                    <UnifiedRowAny
                      key={item.id}
                      item={item}
                      employees={data.employees}
                      businessId={data.businessId}
                      onClick={item.kind === "pago" || item.kind === "venta_pendiente" ? () => handleRowClick(item) : undefined}
                      onShowNote={showNote}
                      loading={item.kind === "venta_pendiente" && item.venta?.paymentId === loadingVentaDetailId}
                    />
                  ))
                )}
              </div>
              <div className="sm:hidden">
                {modalItems.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-white/45">
                    Sin movimientos registrados.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5 p-3">
                    {modalItems.map((item) => (
                      <UnifiedCardAny
                        key={item.id}
                        item={item}
                        employees={data.employees}
                        businessId={data.businessId}
                        onClick={item.kind === "pago" || item.kind === "venta_pendiente" ? () => handleRowClick(item) : undefined}
                        onShowNote={showNote}
                        loading={item.kind === "venta_pendiente" && item.venta?.paymentId === loadingVentaDetailId}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {detailPayment && (
        <DetailModal
          payment={detailPayment}
          employees={data.employees}
          onClose={() => setDetailPayment(null)}
          onDeleted={() => {
            setDetailPayment(null);
            data.refresh();
          }}
        />
      )}

      {noteModal && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setNoteModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold">Nota del profesional</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{noteModal.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setNoteModal(null)}
                className="rounded-lg bg-white/5 px-3 py-1.5 text-xs transition hover:bg-white/10"
              >
                Cerrar
              </button>
            </div>
            <div className="p-5">
              <div className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">
                  Nota guardada
                </p>
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                  {noteModal.note}
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// Panel completo de la pestaña Facturación: headline Ingresos/Pendientes,
// Efectivo/Dinero esperado, acciones manuales de caja, historial de esos
// movimientos y el acceso directo a Cerrar caja — todo reusando datos ya
// calculados arriba (expected/movementsData, computeExpectedCashAndDigital)
// en vez de recalcular nada acá.
function FacturacionPanel({
  data,
  equipoEnabled,
  summary,
  movementsData,
  userEmail,
  cajaAbiertaDesde,
  cajaRangeStartDate,
  onCajaCerrada,
  onCobrarPendiente,
  onRevisarCierre,
  pendientesTheme,
}: {
  data: ReturnType<typeof useCajaData>;
  equipoEnabled: boolean;
  summary: CajaSummary;
  movementsData: ReturnType<typeof useCashMovements>;
  userEmail: string | null;
  cajaAbiertaDesde: string;
  cajaRangeStartDate: string;
  onCajaCerrada: () => void;
  onCobrarPendiente: (
    appt: ReturnType<typeof useCajaData>["pendingCharges"][number],
  ) => void;
  onRevisarCierre: (date: string) => void;
  pendientesTheme?: {
    border: string;
    glow: string;
    headerIcon: string;
    title: string;
    chip: string;
    tableHead: string;
    rowHover: string;
    amount: string;
    badge: string;
    panelBg: string;
  };
}) {
  const [movType, setMovType] = React.useState<"ingreso" | "retiro" | null>(null);
  // "Ingresar dinero" ahora abre una elección (Nuevo ingreso vs Cobrar
  // pendiente) en vez de ir directo al modal de movimiento — ese modal
  // (RegistrarMovimientoModal, vía movType="ingreso") sigue intacto para
  // "Nuevo ingreso"; "Cobrar pendiente" abre CobrarPendienteModal, una
  // pantalla nueva y completamente separada (lista de deudas + cobro).
  const [showIngresoChoice, setShowIngresoChoice] = React.useState(false);
  const [showCobrarPendiente, setShowCobrarPendiente] = React.useState(false);
  // "Pendiente de cobro" — acumulado de TODAS las deudas abiertas del
  // negocio (no solo las de hoy), distinto del stat "Pendientes" de arriba
  // (ese es el concepto viejo: turnos enviados a Caja sin cobrar nada
  // todavía). Se refresca cada vez que cambian los pagos/cobros del
  // período (nueva venta pendiente, cobro parcial/total, reversión).
  const pendingDebtSummary = usePendingDebtSummary(data.businessId, data.activeBranchId);
  React.useEffect(() => {
    pendingDebtSummary.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.paymentsToday, data.collectionsToday]);
  // Composición de "Efectivo del día"/"Dinero en cuenta del día" — un
  // saldo negativo nunca queda sin explicación, un clic alcanza (ver
  // src/components/caja/saldo-composicion.tsx).
  const [saldoDetalle, setSaldoDetalle] = React.useState<"cash" | "digital" | null>(null);
  // "Pendientes" ya no es una pestaña propia — se expande/colapsa dentro
  // de la misma vista de Facturación (ver cobrosPendientesRef más abajo).
  const [cobrosPendientesOpen, setCobrosPendientesOpen] = React.useState(false);
  const cobrosPendientesRef = React.useRef<HTMLDivElement>(null);
  // "Pendientes" acá = ventas/turnos pendientes de cobro o confirmación
  // (data.pendingAmount) — solo tiene sentido mostrarlo si existe al
  // menos un profesional con "Exigir aprobación de ventas" activado
  // (Equipo → [profesional] → Puede cobrar + Exigir aprobación de ventas,
  // ver _employeeApprovalEnabled/_employeeApprovalMode en use-caja-data.ts)
  // — mismo criterio que ya usa el bloque "Modo de aprobación" de
  // Liquidaciones, ningún flag nuevo.
  const showPendientes = data.approvalModeEnabled && equipoEnabled;

  return (
    <>
      {/* Aviso de cajas pendientes de revisión — misma fuente
          (summary.pendingCierres) y mismo botón "Revisar cierre" que ya
          usan Inicio y Caja > Cierres, para que las tres pantallas
          queden sincronizadas en tiempo real sin un cálculo aparte. */}
      {summary.pendingCierres.length > 0 && (
        <div className="rounded-[20px] border border-amber-400/25 bg-amber-400/[0.08] p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-amber-200">
                {summary.pendingCierres.length === 1
                  ? `Tenés una caja pendiente de revisión del ${fechaDDMMYYYY(summary.pendingCierres[0].date)}`
                  : `Tenés ${summary.pendingCierres.length} cajas pendientes de revisión`}
              </p>
              <p className="mt-1 text-xs text-amber-200/70">
                Ninguna se cierra sola — revisá cada una y confirmá el cierre a mano.
              </p>
              <div className="mt-3 space-y-1.5">
                {summary.pendingCierres.map((p) => (
                  <div
                    key={p.date}
                    className="flex items-center justify-between gap-3 rounded-xl bg-black/15 px-3 py-2"
                  >
                    <span className="text-sm font-semibold text-white/85">{fechaDDMMYYYY(p.date)}</span>
                    <button
                      type="button"
                      onClick={() => onRevisarCierre(p.date)}
                      className="rounded-lg bg-amber-400/15 px-3 py-1.5 text-xs font-bold text-amber-100 ring-1 ring-amber-400/30 transition hover:bg-amber-400/25"
                    >
                      Revisar cierre
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ingresos | Pendientes (turnos sin cobrar) | Pendiente de cobro
          (ventas con saldo) | Gastos — reemplaza el selector grande
          Facturación/Gastos de ResumenTab. 2 columnas en mobile (wrap),
          una sola fila desde sm. */}
      <div className={cn("grid grid-cols-2 gap-2", showPendientes ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
        <FacturacionStatCard
          icon={TrendingUp}
          iconClass="text-emerald-400"
          label="Ingresos"
          value={data.revHoy}
          loading={data.loading}
        />
        {showPendientes && (
          <FacturacionStatCard
            icon={Clock}
            iconClass="text-amber-400"
            label="Pendientes"
            value={data.pendingAmount}
            loading={data.loading}
            onClick={() => {
              setCobrosPendientesOpen((v) => !v);
              // Foco/scroll al bloque recién abierto — el usuario puede
              // estar lejos (el botón queda arriba de todo Facturación).
              requestAnimationFrame(() => {
                cobrosPendientesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              });
            }}
          />
        )}
        {/* Distinto del "Pendientes" de arriba: ese es turnos enviados a
            Caja sin ningún cobro registrado todavía (concepto viejo). Este
            es la suma de saldo de TODAS las ventas con payments.status en
            pendiente/parcial — clic abre directo "Cobrar pendiente". */}
        <FacturacionStatCard
          icon={Clock}
          iconClass="text-amber-400"
          label="Pendiente de cobro"
          value={pendingDebtSummary.total}
          loading={pendingDebtSummary.loading}
          onClick={() => setShowCobrarPendiente(true)}
        />
        <FacturacionStatCard
          icon={TrendingDown}
          iconClass="text-rose-400"
          label="Gastos"
          value={data.totalGastos}
          loading={data.loading}
        />
      </div>

      {/* Movimientos de hoy: Efectivo/Dinero en cuenta ESTRICTAMENTE de
          hoy (summary.todayCashExpected/todayDigitalExpected) — misma
          fuente que Inicio, nunca una query/cálculo aparte (antes este
          panel llamaba a buildSingleDayCierrePreview por su cuenta). */}
      <div className="grid grid-cols-2 gap-2">
        <FacturacionStatCard
          icon={Wallet}
          iconClass="text-amber-400"
          label="Efectivo del día"
          value={summary.todayCashExpected}
          loading={summary.loading}
          onClick={() => setSaldoDetalle("cash")}
        />
        <FacturacionStatCard
          icon={CreditCard}
          iconClass="text-sky-400"
          label="Dinero en cuenta del día"
          value={summary.todayDigitalExpected}
          loading={summary.loading}
          onClick={() => setSaldoDetalle("digital")}
        />
      </div>

      {saldoDetalle && (
        <SaldoComposicionModal
          title={saldoDetalle === "cash" ? "Efectivo del día" : "Dinero en cuenta del día"}
          expected={summary.todayExpectedFull}
          side={saldoDetalle}
          onClose={() => setSaldoDetalle(null)}
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setShowIngresoChoice(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/[0.12]"
        >
          <Plus className="size-4" /> Ingresar dinero
        </button>
        <button
          type="button"
          onClick={() => setMovType("retiro")}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-3 py-3 text-sm font-semibold text-rose-200 transition hover:bg-rose-400/[0.12]"
        >
          <Minus className="size-4" /> Retirar dinero
        </button>
      </div>

      <div className="flex justify-center">
        <CierreCajaBtn
          businessId={data.businessId}
          branchId={data.activeBranchId}
          userEmail={userEmail}
          onCajaCerrada={onCajaCerrada}
          cajaAbiertaDesde={cajaAbiertaDesde}
          cajaRangeStartDate={cajaRangeStartDate}
        />
      </div>

      {showPendientes && cobrosPendientesOpen && (
        <div ref={cobrosPendientesRef} className="scroll-mt-4">
          <History
            data={data}
            equipoEnabled={equipoEnabled}
            onCobrarPendiente={onCobrarPendiente}
            title="Cobros pendientes"
            panel="pendientes"
            theme={pendientesTheme}
          />
        </div>
      )}

      {movType && (
        <RegistrarMovimientoModal
          tipo={movType}
          onClose={() => setMovType(null)}
          onConfirm={(amount, note, method) =>
            // El cálculo de Efectivo/Dinero esperado ya no es reactivo a
            // movementsData (vive en useCajaSummary, ver cash-register.tsx
            // arriba) — sin este refresh() explícito, Ingresar/Retirar
            // dinero actualizaría la LISTA de movimientos pero no los dos
            // montos esperados hasta el próximo trigger.
            movementsData
              .registerMovement(movType, amount, note, method, userEmail)
              .then(() => data.refresh("movimiento registrado"))
          }
        />
      )}

      {/* "Ingresar dinero" → elección entre A) Nuevo ingreso (movimiento
          manual de caja, comportamiento de siempre) y B) Cobrar pendiente
          (venta con saldo — ver CobrarPendienteModal). Modal chico propio,
          mismo patrón createPortal que RegistrarMovimientoModal. */}
      {showIngresoChoice &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => setShowIngresoChoice(false)}
          >
            <div
              className="w-full max-w-sm overflow-hidden rounded-2xl bg-[oklch(0.11_0.04_275)] shadow-2xl ring-1 ring-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <h3 className="text-lg font-semibold">Ingresar dinero</h3>
                <button
                  type="button"
                  onClick={() => setShowIngresoChoice(false)}
                  className="rounded-lg bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="space-y-2.5 p-5">
                <button
                  type="button"
                  onClick={() => {
                    setShowIngresoChoice(false);
                    setMovType("ingreso");
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3.5 text-left transition hover:bg-emerald-400/[0.12]"
                >
                  <Plus className="size-5 shrink-0 text-emerald-300" />
                  <span>
                    <span className="block text-sm font-bold text-emerald-100">Nuevo ingreso</span>
                    <span className="block text-xs text-emerald-200/60">
                      Movimiento de caja independiente (no es una venta)
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowIngresoChoice(false);
                    setShowCobrarPendiente(true);
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3.5 text-left transition hover:bg-amber-400/[0.12]"
                >
                  <Clock className="size-5 shrink-0 text-amber-300" />
                  <span>
                    <span className="block text-sm font-bold text-amber-100">Cobrar pendiente</span>
                    <span className="block text-xs text-amber-200/60">
                      Registrar el cobro de una venta con saldo
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {showCobrarPendiente && data.businessId && (
        <CobrarPendienteModal
          businessId={data.businessId}
          branchId={data.activeBranchId}
          employees={data.employees}
          collectedBy={data.profileId ?? ""}
          collectedByName={chargedByUsername(userEmail)}
          onClose={() => setShowCobrarPendiente(false)}
          onCollected={() => data.refresh("cobro de pendiente registrado")}
        />
      )}
    </>
  );
}

// Captura de comprobante en el Paso 4 (Transferencia) — 100% local hasta
// confirmar el cobro (ver receiptFile/receiptPreviewUrl en NuevaVentaTab).
// Sin `capture` en el input: así el picker nativo (iOS/Android) ofrece
// cámara Y galería, no solo cámara directa.
function TransferReceiptField({
  previewUrl,
  onSelect,
  onClear,
}: {
  previewUrl: string | null;
  onSelect: (file: File | null) => void;
  onClear: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  if (!previewUrl) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm font-semibold text-white/80 transition hover:bg-white/[0.06]"
        >
          <Camera className="size-4" />
          Agregar comprobante
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-2.5">
      <img
        src={previewUrl}
        alt="Comprobante"
        className="size-12 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-200">
          <Check className="size-3.5 shrink-0" />
          <span className="truncate">Comprobante agregado</span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="font-semibold text-blue-300 hover:text-blue-200"
          >
            Cambiar
          </button>
          <button type="button" onClick={onClear} className="font-semibold text-rose-300 hover:text-rose-200">
            Eliminar
          </button>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

function ReceiptLightboxModal({ url, onClose }: { url: string; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="relative max-h-[90vh] max-w-full" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-11 right-0 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
        >
          Cerrar
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Comprobante"
          className="max-h-[90vh] max-w-full rounded-xl object-contain shadow-2xl"
        />
      </div>
    </div>,
    document.body,
  );
}

// Adjuntar un comprobante DESPUÉS de que el cobro ya existe (ej. falló la
// subida original, o el usuario quiere agregarlo más tarde) — mismo
// payment_id de siempre, nunca crea un pago nuevo.
function AttachReceiptModal({
  businessId,
  paymentId,
  onClose,
  onAttached,
}: {
  businessId: string;
  paymentId: string;
  onClose: () => void;
  onAttached: () => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  function handleSelect(f: File | null) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error("Elegí una imagen (foto o captura) del comprobante.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  }

  function handleClear() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
  }

  async function handleConfirm() {
    if (!file || saving) return;
    setSaving(true);
    try {
      await attachReceiptToPayment(businessId, paymentId, file);
      toast.success("Comprobante agregado");
      handleClear();
      onAttached();
      onClose();
    } catch (e) {
      toast.error("No se pudo subir el comprobante — probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h3 className="text-lg font-semibold">Agregar comprobante</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-sm"
          >
            Cancelar
          </button>
        </div>
        <div className="p-5 space-y-3">
          <TransferReceiptField previewUrl={previewUrl} onSelect={handleSelect} onClear={handleClear} />
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!file || saving}
            className="w-full inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold bg-gradient-to-b from-blue-400 to-violet-500 text-white hover:brightness-105 disabled:opacity-50 transition-all"
          >
            {saving ? "Subiendo…" : "Guardar comprobante"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// "Ver comprobante" / "Agregar comprobante" — solo para pagos por
// Transferencia. La URL firmada se pide recién al tocar el botón (nunca
// al renderizar la fila/lista), para no generar tráfico de Storage de
// más. Renderizado como <span role="button"> (no <button>) a propósito:
// se usa dentro de filas que a veces ya son un <button> completo (cards
// mobile) — mismo criterio que "Ver nota" en estas mismas tablas.
function ReceiptButton({
  payment,
  businessId,
}: {
  payment: { id: string; receipt_path?: string | null; method?: string | null; payment_method?: string | null };
  businessId: string | null;
}) {
  const [receiptPath, setReceiptPath] = React.useState(payment.receipt_path ?? null);
  const [lightboxUrl, setLightboxUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [uploaderOpen, setUploaderOpen] = React.useState(false);
  const method = String(payment.method ?? payment.payment_method ?? "");

  React.useEffect(() => {
    setReceiptPath(payment.receipt_path ?? null);
  }, [payment.receipt_path]);

  if (method !== "transfer") return null;

  async function openReceipt(event: React.MouseEvent) {
    event.stopPropagation();
    if (!receiptPath || loading) return;
    setLoading(true);
    try {
      const url = await getPaymentReceiptSignedUrl(receiptPath);
      setLightboxUrl(url);
    } catch {
      toast.error("No se pudo abrir el comprobante.");
    } finally {
      setLoading(false);
    }
  }

  function openUploader(event: React.MouseEvent) {
    event.stopPropagation();
    setUploaderOpen(true);
  }

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        onClick={receiptPath ? openReceipt : openUploader}
        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300 transition hover:text-sky-200"
      >
        <ImageIcon className="size-3 shrink-0" />
        {loading ? "Abriendo…" : receiptPath ? "Ver comprobante" : "Agregar comprobante"}
      </span>
      {lightboxUrl && <ReceiptLightboxModal url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      {uploaderOpen && businessId && (
        <AttachReceiptModal
          businessId={businessId}
          paymentId={payment.id}
          onClose={() => setUploaderOpen(false)}
          onAttached={() => {
            setReceiptPath(paymentReceiptPath(businessId, payment.id));
            window.dispatchEvent(new CustomEvent("clippr:cobros-historial-updated"));
          }}
        />
      )}
    </>
  );
}

function History({
  data,
  equipoEnabled,
  onCobrarPendiente,
  title = "Cobros",
  panel = "ingresos",
  theme,
}: {
  data: ReturnType<typeof useCajaData>;
  equipoEnabled: boolean;
  onCobrarPendiente: (
    appt: ReturnType<typeof useCajaData>["pendingCharges"][number],
  ) => void;
  title?: string;
  panel?: "ingresos" | "pendientes";
  theme?: {
    border: string;
    glow: string;
    headerIcon: string;
    title: string;
    chip: string;
    tableHead: string;
    rowHover: string;
    amount: string;
    badge: string;
    panelBg: string;
  };
}) {
  // Nombre real de quien rechaza un pendiente ("Alan Melgar → Rechazó"),
  // para el mismo historial que ya usan "Envió a caja"/"Cobró" — nunca el
  // username/email crudo.
  const { profile: rejectProfile, session: rejectSession } = useAuth();
  const rejectedByName = rejectProfile?.full_name || chargedByUsername(rejectSession?.user?.email);

  const incomeTheme = theme ?? {
    border: "border-emerald-400/24",
    glow: "shadow-[0_24px_90px_-45px_rgba(16,185,129,0.42)]",
    panelBg:
      "bg-[radial-gradient(circle_at_14%_50%,rgba(16,185,129,0.18),transparent_34%),linear-gradient(135deg,rgba(6,95,70,0.20),rgba(3,7,18,0.94))]",
    headerIcon: "bg-emerald-500/14 text-emerald-300 ring-emerald-400/25",
    title: "text-emerald-50",
    chip: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/18",
    tableHead: "border-emerald-400/10 bg-emerald-400/[0.018]",
    rowHover: "hover:bg-emerald-400/[0.045]",
    amount: "text-emerald-300",
    badge: "bg-emerald-500/12 text-emerald-300 ring-emerald-400/20",
  };

  const rows = panel === "ingresos" ? data.paymentsToday : [];
  const pendingRows = panel === "pendientes" ? data.pendingCharges : [];
  const [rejectingId, setRejectingId] = React.useState<string | null>(null);
  const [previousPendingOpen, setPreviousPendingOpen] = React.useState(false);

  // Rechazar un pendiente ("✕" en Acción): saca la venta de la cola sin
  // cobrarla. Turno: solo se limpia el marcador "[PENDIENTE_CAJA]" de sus
  // notas (el turno vuelve a su estado normal, no se cancela ni se toca su
  // horario). Venta de mostrador sin turno: se saca directamente de
  // business_settings.schedule._pendingWalkInSales.
  async function handleRechazarPendiente(p: ReturnType<typeof useCajaData>["pendingCharges"][number]) {
    if (!data.businessId || rejectingId) return;
    if (!window.confirm("¿Rechazar este cobro pendiente? No se va a cobrar.")) return;
    setRejectingId(p.id);
    try {
      const now = new Date();
      const rejectEvent = { time: formatArgTime(now), ts: now.toISOString(), user: rejectedByName, action: "Rechazó" };
      if (p.id.startsWith("walkin-")) {
        // No se saca de _pendingWalkInSales — se marca status:"rechazado" y
        // se le agrega el evento. Pedido explícito: un pendiente rechazado
        // sigue apareciendo en Caja → Pendientes como registro histórico
        // (sin botones de acción), no desaparece solo.
        const { data: existingRow, error: readError } = await supabase
          .from("business_settings")
          .select("schedule")
          .eq("business_id", data.businessId)
          .maybeSingle();
        if (readError) throw readError;
        const schedule = (existingRow?.schedule ?? {}) as Record<string, unknown>;
        const currentPending = Array.isArray((schedule as Record<string, unknown>)._pendingWalkInSales)
          ? ((schedule as Record<string, unknown>)._pendingWalkInSales as Array<{ id: string; events?: HistorialEvento[] }>)
          : [];
        const nextPending = currentPending.map((s) =>
          s.id === p.id ? { ...s, status: "rechazado", events: [...(s.events ?? []), rejectEvent] } : s,
        );
        const { error: writeError } = await supabase
          .from("business_settings")
          .upsert(
            { business_id: data.businessId, schedule: { ...schedule, _pendingWalkInSales: nextPending } },
            { onConflict: "business_id" },
          );
        if (writeError) throw writeError;
      } else {
        // No se toca la nota (el marcador "[PENDIENTE_CAJA]" se deja tal
        // cual) — si se limpiara, la consulta de Pendientes dejaría de
        // encontrar este turno y desaparecería solo de la lista, que es
        // justo lo que no se quiere. Queda visible como registro histórico
        // gracias al evento "Rechazó" (sin botones de acción, ver render).
        await appendHistorialCobro(p.id, rejectEvent);
      }
      toast.success("Cobro pendiente rechazado");
      await data.refresh();
      notifyCajaPendientesChanged();
    } catch (e) {
      toast.error((e as Error).message || "No se pudo rechazar el pendiente");
    } finally {
      setRejectingId(null);
    }
  }

  const [closeoutOpen, setCloseoutOpen] = React.useState(false);
  const [selectedMethod, setSelectedMethod] = React.useState<string | null>(
    null,
  );
  const [detailPayment, setDetailPayment] = React.useState<
    (typeof rows)[number] | null
  >(null);
  const [pendingNoteModal, setPendingNoteModal] = React.useState<{
    title: string;
    note: string;
  } | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  const visibleRows = rows.slice(0, 5);
  // Solo para el panel "ingresos": en mobile la tarjeta muestra 3 en vez de
  // 5, con "Ver historial completo" debajo (mismo modal de siempre).
  const mobileRows = rows.slice(0, 3);
  const hasAnyRows = pendingRows.length > 0 || visibleRows.length > 0;

  const closeout = React.useMemo(() => {
    const groups = data.paymentsToday.reduce(
      (acc, payment) => {
        const method = String(
          payment.method ?? payment.payment_method ?? "cash",
        );
        if (!acc[method])
          acc[method] = {
            method,
            total: 0,
            count: 0,
            rows: [] as typeof data.paymentsToday,
          };
        acc[method].total += Number(payment.total ?? payment.amount ?? 0);
        acc[method].count += 1;
        acc[method].rows.push(payment);
        return acc;
      },
      {} as Record<
        string,
        {
          method: string;
          total: number;
          count: number;
          rows: typeof data.paymentsToday;
        }
      >,
    );
    return Object.values(groups).sort((a, b) => b.total - a.total);
  }, [data.paymentsToday]);

  const totalFacturado = closeout.reduce((sum, g) => sum + g.total, 0);
  const selectedGroup =
    closeout.find((g) => g.method === selectedMethod) ?? closeout[0] ?? null;

  return (
    <>
      <Card
        className={cn(
          "rounded-3xl transition-all duration-300",
          incomeTheme.panelBg,
          incomeTheme.border,
          incomeTheme.glow,
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex min-h-[64px] items-center gap-3 px-5 py-3 border-b",
            incomeTheme.tableHead,
          )}
        >
          <h3
            className={cn(
              "w-full text-base font-bold tracking-tight",
              incomeTheme.title,
            )}
          >
            {title}
          </h3>
        </div>

        {/* Pendientes de días anteriores (antes del último cierre de caja):
            no se mezclan con la lista de hoy, pero siguen siendo cobrables/
            rechazables desde este banner + modal. */}
        {panel === "pendientes" && data.pendingCountPrevious > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/15 bg-amber-500/[0.06] px-5 py-2.5 text-xs">
            <span className="text-amber-200">
              ⚠️ {data.pendingCountPrevious} pendiente{data.pendingCountPrevious === 1 ? "" : "s"} de días anteriores · ${data.pendingAmountPrevious.toLocaleString("es-AR")}
            </span>
            <button
              type="button"
              onClick={() => setPreviousPendingOpen(true)}
              className="rounded-full bg-amber-400/15 px-3 py-1 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-400/30 transition hover:bg-amber-400/25"
            >
              Ver pendientes anteriores
            </button>
          </div>
        )}

        {/* Table header — en mobile, ambos paneles ("ingresos" y
            "pendientes") usan tarjetas verticales en su lugar (ver bloques
            debajo), así que esta tabla con scroll horizontal queda oculta
            en mobile para los dos. */}
        <div className="hidden overflow-x-auto sm:block">
          <div className="min-w-[1080px]">
            <div
              className={cn(
                panel === "pendientes" ? "grid grid-cols-[80px_minmax(130px,0.75fr)_minmax(130px,0.75fr)_minmax(240px,1.15fr)_110px_120px_minmax(230px,1fr)_140px] items-center gap-x-3 px-6 py-2.5 text-[10px] font-semibold tracking-[0.18em] text-muted-foreground/60 border-b uppercase" : "grid grid-cols-[80px_minmax(150px,0.85fr)_minmax(150px,0.85fr)_minmax(280px,1.35fr)_120px_140px_minmax(260px,1fr)] items-center gap-x-3 px-6 py-2.5 text-[10px] font-semibold tracking-[0.18em] text-muted-foreground/60 border-b uppercase",
                incomeTheme.tableHead,
              )}
            >
              <div>Fecha</div>
              <div>Cliente</div>
              <div>Profesional</div>
              <div>Servicio / catálogo</div>
              <div className="text-right">Monto</div>
              <div>Método</div>
              <div>Historial</div>
              {panel === "pendientes" && <div>Acción</div>}
            </div>

            {/* Rows */}
            {data.loading ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
                <Loader2 className="size-4 animate-spin" /> Cargando…
              </div>
            ) : !hasAnyRows ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                {panel === "pendientes" ? "Sin pendientes." : "Sin cobros"}
              </div>
            ) : (
              <>
                {pendingRows.map((p) => {
                  const dt = new Date(p.starts_at);
                  const fecha = dt.toLocaleDateString("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                  });
                  const empName =
                    data.employees.find((e) => e.id === p.employee_id)?.name ??
                    "—";
                  const pendingNote = getCashRowNote(p, p.service_name);
                  // p.events viene ya resuelto (appointments.cobro_events o
                  // el propio registro de venta de mostrador) — no depende
                  // de un historial local del dispositivo, que puede no
                  // tener el evento si Caja está en otro aparato distinto
                  // al que envió. getHistorialCobro(p.id) queda como
                  // respaldo por si el registro no trae events todavía.
                  const historialEvents = p.events?.length ? p.events : getHistorialCobro(p.id);
                  const yaCobro = historialEvents.some(
                    (e) => e.action === "Cobró",
                  );
                  const yaRechazado = historialEvents.some(
                    (e) => e.action === "Rechazó",
                  );
                  const showCobrarBtn = !yaCobro && !yaRechazado;

                  return (
                    <div
                      key={`pending-${p.id}`}
                      className={cn(
                        "grid grid-cols-[80px_minmax(130px,0.75fr)_minmax(130px,0.75fr)_minmax(240px,1.15fr)_110px_120px_minmax(230px,1fr)_140px] items-center gap-x-3 px-6 py-3 text-xs border-b border-white/[0.09] odd:bg-white/[0.022] transition-all duration-200 last:border-0",
                        incomeTheme.rowHover,
                      )}
                    >
                      <div className="text-muted-foreground whitespace-nowrap">
                        {fecha}
                      </div>
                      <div className="text-foreground truncate">
                        {p.client_name ?? "—"}
                      </div>
                      <div className="text-muted-foreground truncate">
                        {empName}
                      </div>
                      <div className="text-muted-foreground truncate">
                        <span>{p.service_name ?? "—"}</span>
                        {pendingNote && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPendingNoteModal({
                                title: `${p.client_name ?? "Cliente"} · ${p.service_name ?? "Servicio"}`,
                                note: pendingNote,
                              });
                            }}
                            className="ml-2 rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300 ring-1 ring-sky-300/20 hover:bg-sky-400/20 transition"
                            title="Ver nota del profesional"
                          >
                            Ver nota
                          </button>
                        )}
                      </div>
                      <div className={cn("tabular-nums font-bold text-right", incomeTheme.amount)}>
                        ${Number(p.service_price ?? 0).toLocaleString("es-AR")}
                      </div>
                      <div className="text-muted-foreground">—</div>
                      <div>
                        <HistorialCell events={historialEvents} />
                      </div>
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {showCobrarBtn && (
                          <button
                            type="button"
                            onClick={() => onCobrarPendiente(p)}
                            className="inline-flex items-center gap-1 rounded-xl border border-emerald-300/45 bg-emerald-400/18 px-3.5 py-1.5 text-[11px] font-extrabold text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.18)] ring-1 ring-emerald-400/20 transition hover:border-emerald-300/70 hover:bg-emerald-400/28 hover:text-white whitespace-nowrap"
                          >
                            Cobrar
                          </button>
                        )}
                        {!yaCobro && !yaRechazado && (
                          <button
                            type="button"
                            title="Rechazar"
                            disabled={rejectingId === p.id}
                            onClick={() => handleRechazarPendiente(p)}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-rose-400/70 ring-1 ring-rose-400/20 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-40"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {visibleRows.map((p) => {
                  const dt = new Date(p.created_at);
                  const fecha = dt.toLocaleDateString("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                  });
                  const hora = `${dt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}hs`;
                  const paymentRecord = p as Record<string, unknown>;
                  const empName =
                    data.employees.find((e) => e.id === p.employee_id)?.name ??
                    "—";
                  const chargeType = getChargeType(paymentRecord);
                  const methodLabel = getPaymentMethodLabel(paymentRecord);
                  const chargedByName = getChargedByLabel(
                    paymentRecord,
                    empName === "—" ? null : empName,
                    chargeType,
                  );
                  const saleDetail = getSaleDetailLabel(paymentRecord);
                  const paymentNote = getCashRowNote(paymentRecord, saleDetail);
                  const historialEvents = buildPaidHistorialEvents(
                    paymentRecord,
                    {
                      time: hora,
                      user: chargedByName,
                      action: "Cobró",
                    },
                  );

                  return (
                    <div
                      key={p.id}
                      className={cn("grid grid-cols-[80px_minmax(150px,0.85fr)_minmax(150px,0.85fr)_minmax(280px,1.35fr)_120px_140px_minmax(260px,1fr)] items-center gap-x-3 px-6 py-3 text-xs border-b border-white/[0.09] odd:bg-white/[0.022] last:border-0 transition-all duration-200 group cursor-pointer", incomeTheme.rowHover)}
                      onClick={() => setDetailPayment(p)}
                    >
                      <div className="text-muted-foreground whitespace-nowrap">
                        {fecha}
                      </div>
                      <div className="text-foreground truncate">
                        {p.client_name ?? "—"}
                      </div>
                      <div className="text-muted-foreground truncate">
                        {empName}
                      </div>
                      <div className="text-muted-foreground truncate">
                        <span>{saleDetail}</span>
                        {paymentNote && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPendingNoteModal({
                                title: `${p.client_name ?? "Cliente"} · ${saleDetail}`,
                                note: paymentNote,
                              });
                            }}
                            className="ml-2 rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300 ring-1 ring-sky-300/20 hover:bg-sky-400/20 transition"
                            title="Ver nota del profesional"
                          >
                            Ver nota
                          </button>
                        )}
                      </div>
                      <div className="tabular-nums font-bold text-right">
                        {p.status === "pendiente" || p.status === "parcial" ? (
                          // Pago pendiente/parcial: nunca mostrar el total
                          // como si estuviera cobrado — solo lo que
                          // efectivamente entró hasta ahora, con el saldo
                          // explícito al lado (ver payments.collected_amount,
                          // 20261023010000_pending_payments_schema.sql).
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-amber-300">
                              ${Number(p.collected_amount ?? 0).toLocaleString("es-AR")}
                            </span>
                            <span className="text-[10px] font-normal text-amber-200/60">
                              {p.status === "pendiente" ? "100% pendiente" : "saldo $"}
                              {p.status === "parcial" &&
                                Math.round(
                                  Number(p.total ?? p.amount ?? 0) - Number(p.collected_amount ?? 0),
                                ).toLocaleString("es-AR")}
                            </span>
                          </div>
                        ) : (
                          // Total efectivamente cobrado (incluye propina) —
                          // no payment.total, que es pura facturación de
                          // servicios sin propina.
                          <span className="text-emerald-300">
                            ${(Number(p.total ?? p.amount ?? 0) + Number(p.tip_amount ?? 0)).toLocaleString("es-AR")}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex flex-col text-muted-foreground">
                        <span className="truncate">{methodLabel}</span>
                        <ReceiptButton payment={p} businessId={data.businessId} />
                      </div>
                      <div>
                        <HistorialCell events={historialEvents} />
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Mobile: tarjetas verticales para "Últimos ingresos" — mismos
            datos, misma fuente (data.paymentsToday) y mismo modal de detalle
            al tocar, sin scroll horizontal. "Pendientes" no se toca acá. */}
        {panel === "ingresos" && (
          <div className="sm:hidden">
            {data.loading ? (
              // Reproduce la misma tarjeta real (fecha+monto, 3 filas de
              // datos, sección de historial) en gris neutro — antes era
              // solo un "Cargando…" y la tarjeta completa aparecía de
              // golpe con los datos, incluido el monto en verde.
              <div className="flex flex-col gap-3 p-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-full rounded-2xl border border-white/[0.07] bg-black/25 px-3.5 py-3"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
                      <div className="h-2.5 w-20 animate-pulse rounded bg-white/[0.06]" />
                      <div className="h-3.5 w-16 animate-pulse rounded bg-white/[0.06]" />
                    </div>
                    <div className="mt-2 space-y-1.5">
                      <div className="h-2.5 w-full animate-pulse rounded bg-white/[0.045]" />
                      <div className="h-2.5 w-full animate-pulse rounded bg-white/[0.045]" />
                      <div className="h-2.5 w-3/4 animate-pulse rounded bg-white/[0.045]" />
                    </div>
                    <div className="mt-2.5 border-t border-white/[0.06] pt-2">
                      <div className="h-2 w-16 animate-pulse rounded bg-white/[0.045]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Sin cobros
              </div>
            ) : (
              <div className="flex flex-col gap-3 p-3">
                {mobileRows.map((p) => {
                  const dt = new Date(p.created_at);
                  const fecha = dt.toLocaleDateString("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  });
                  const hora = `${dt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}hs`;
                  const paymentRecord = p as Record<string, unknown>;
                  const empName =
                    data.employees.find((e) => e.id === p.employee_id)?.name ??
                    "—";
                  const chargeType = getChargeType(paymentRecord);
                  const methodLabel = getPaymentMethodLabel(paymentRecord);
                  const chargedByName = getChargedByLabel(
                    paymentRecord,
                    empName === "—" ? null : empName,
                    chargeType,
                  );
                  const saleDetail = getSaleDetailLabel(paymentRecord);
                  const paymentNote = getCashRowNote(paymentRecord, saleDetail);
                  const historialEvents = buildPaidHistorialEvents(
                    paymentRecord,
                    {
                      time: hora,
                      user: chargedByName,
                      action: "Cobró",
                    },
                  );

                  return (
                    <button
                      key={`mobile-${p.id}`}
                      type="button"
                      onClick={() => setDetailPayment(p)}
                      className="w-full rounded-2xl border border-white/[0.07] bg-black/25 px-3.5 py-3 text-left text-xs transition active:brightness-110"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                          {fecha}
                        </span>
                        {p.status === "pendiente" || p.status === "parcial" ? (
                          <span className="flex items-center gap-1 text-sm font-bold tabular-nums text-amber-300">
                            ${Number(p.collected_amount ?? 0).toLocaleString("es-AR")}
                            <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-200">
                              {p.status === "pendiente" ? "Pendiente" : "Parcial"}
                            </span>
                          </span>
                        ) : (
                          <span className="text-sm font-bold tabular-nums text-emerald-300">
                            $
                            {(
                              Number(p.total ?? p.amount ?? 0) + Number(p.tip_amount ?? 0)
                            ).toLocaleString("es-AR")}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-start justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground/70">Cliente</span>
                          <span className="truncate text-right text-foreground">
                            {p.client_name ?? "—"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground/70">Profesional</span>
                          <span className="truncate text-right text-muted-foreground">
                            {empName}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground/70">Servicio/Catálogo</span>
                          <span className="truncate text-right text-muted-foreground">
                            {saleDetail}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground/70">Método</span>
                          <span className="flex min-w-0 flex-col items-end text-right text-muted-foreground">
                            <span className="truncate">{methodLabel}</span>
                            <ReceiptButton payment={p} businessId={data.businessId} />
                          </span>
                        </div>
                        {paymentNote && (
                          <div className="pt-0.5 text-right">
                            <span
                              onClick={(event) => {
                                event.stopPropagation();
                                setPendingNoteModal({
                                  title: `${p.client_name ?? "Cliente"} · ${saleDetail}`,
                                  note: paymentNote,
                                });
                              }}
                              className="inline-flex items-center rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300 ring-1 ring-sky-300/20"
                            >
                              Ver nota
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="mt-2.5 border-t border-white/[0.06] pt-2">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                          Historial
                        </div>
                        <HistorialCell events={historialEvents} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Mobile: tarjetas verticales para "Pendientes" — mismos datos
            (data.pendingCharges) y mismo botón "Cobrar" de siempre, sin
            scroll horizontal. No abre modal de detalle (igual que la fila
            de escritorio, que tampoco lo hace para pendientes). */}
        {panel === "pendientes" && (
          <div className="sm:hidden">
            {data.loading ? (
              // Misma tarjeta real + una fila extra para el botón "Cobrar"
              // (shadow-[0_0_20px_rgba(16,185,129,0.18)] verde) que antes
              // aparecía recién con los datos, sin placeholder.
              <div className="flex flex-col gap-3 p-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-full rounded-2xl border border-white/[0.07] bg-white/[0.018] px-3.5 py-3"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
                      <div className="h-2.5 w-20 animate-pulse rounded bg-white/[0.06]" />
                      <div className="h-3.5 w-16 animate-pulse rounded bg-white/[0.06]" />
                    </div>
                    <div className="mt-2 space-y-1.5">
                      <div className="h-2.5 w-full animate-pulse rounded bg-white/[0.045]" />
                      <div className="h-2.5 w-full animate-pulse rounded bg-white/[0.045]" />
                      <div className="h-2.5 w-3/4 animate-pulse rounded bg-white/[0.045]" />
                    </div>
                    <div className="mt-2.5 border-t border-white/[0.06] pt-2">
                      <div className="h-2 w-16 animate-pulse rounded bg-white/[0.045]" />
                    </div>
                    <div className="mt-2.5 border-t border-white/[0.06] pt-2.5">
                      <div className="h-8 w-full animate-pulse rounded-xl bg-white/[0.045]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : pendingRows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Sin pendientes.
              </div>
            ) : (
              <div className="flex flex-col gap-3 p-3">
                {pendingRows.map((p) => {
                  const dt = new Date(p.starts_at);
                  const fecha = dt.toLocaleDateString("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  });
                  const empName =
                    data.employees.find((e) => e.id === p.employee_id)?.name ??
                    "—";
                  const pendingNote = getCashRowNote(p, p.service_name);
                  const historialEvents = p.events?.length ? p.events : getHistorialCobro(p.id);
                  const yaCobro = historialEvents.some(
                    (e) => e.action === "Cobró",
                  );
                  const yaRechazado = historialEvents.some(
                    (e) => e.action === "Rechazó",
                  );
                  const showCobrarBtn = !yaCobro && !yaRechazado;

                  return (
                    <div
                      key={`pending-mobile-${p.id}`}
                      className="w-full rounded-2xl border border-white/[0.07] bg-white/[0.018] px-3.5 py-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                          {fecha}
                        </span>
                        <span className={cn("text-sm font-bold tabular-nums", incomeTheme.amount)}>
                          ${Number(p.service_price ?? 0).toLocaleString("es-AR")}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-start justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground/70">Cliente</span>
                          <span className="truncate text-right text-foreground">
                            {p.client_name ?? "—"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground/70">Profesional</span>
                          <span className="truncate text-right text-muted-foreground">
                            {empName}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground/70">Servicio/Catálogo</span>
                          <span className="truncate text-right text-muted-foreground">
                            {p.service_name ?? "—"}
                          </span>
                        </div>
                        {pendingNote && (
                          <div className="pt-0.5 text-right">
                            <span
                              onClick={() =>
                                setPendingNoteModal({
                                  title: `${p.client_name ?? "Cliente"} · ${p.service_name ?? "Servicio"}`,
                                  note: pendingNote,
                                })
                              }
                              className="inline-flex items-center rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300 ring-1 ring-sky-300/20"
                            >
                              Ver nota
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="mt-2.5 border-t border-white/[0.06] pt-2">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                          Historial
                        </div>
                        <HistorialCell events={historialEvents} />
                      </div>
                      <div className="mt-2.5 flex items-center gap-1.5 border-t border-white/[0.06] pt-2.5">
                        {showCobrarBtn && (
                          <button
                            type="button"
                            onClick={() => onCobrarPendiente(p)}
                            className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-emerald-300/45 bg-emerald-400/18 px-3.5 py-2 text-[11px] font-extrabold text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.18)] ring-1 ring-emerald-400/20 transition active:brightness-110"
                          >
                            Cobrar
                          </button>
                        )}
                        {!yaCobro && !yaRechazado && (
                          <button
                            type="button"
                            title="Rechazar"
                            disabled={rejectingId === p.id}
                            onClick={() => handleRechazarPendiente(p)}
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-rose-400/70 ring-1 ring-rose-400/20 transition active:bg-rose-500/10 disabled:opacity-40"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-2 border-t border-white/[0.07] flex items-center justify-between gap-3">
          {((panel === "ingresos" && rows.length > 0) || (panel === "pendientes" && pendingRows.length > 0)) && (
            <button
              onClick={() => setCloseoutOpen(true)}
              className={cn(
                "ml-auto text-xs font-semibold inline-flex items-center gap-2 transition hover:brightness-125",
                incomeTheme.amount,
              )}
            >
              <ClipboardList className="size-3.5" /> Ver historial completo{" "}
              <ArrowRight className="size-3.5" />
            </button>
          )}
        </div>
      </Card>

      {/* Detail modal */}
      {detailPayment && (
        <DetailModal
          payment={detailPayment}
          employees={data.employees}
          onClose={() => setDetailPayment(null)}
          onDeleted={() => {
            setDetailPayment(null);
            data.refresh();
          }}
        />
      )}

      {pendingNoteModal && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setPendingNoteModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold">Nota del profesional</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {pendingNoteModal.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingNoteModal(null)}
                className="rounded-lg bg-white/5 px-3 py-1.5 text-xs transition hover:bg-white/10"
              >
                Cerrar
              </button>
            </div>
            <div className="p-5">
              <div className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">
                  Nota guardada
                </p>
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                  {pendingNoteModal.note}
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Pendientes de días anteriores — mismos datos (data.pendingChargesPrevious)
          y mismas acciones (Cobrar/Rechazar) que la lista de hoy, separados
          nada más para no mezclarlos en la vista principal. */}
      {previousPendingOpen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setPreviousPendingOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 shrink-0">
              <div>
                <h3 className="text-sm font-semibold">Pendientes de días anteriores</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Enviados antes del último cierre de caja — todavía sin cobrar ni rechazar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviousPendingOpen(false)}
                className="rounded-lg bg-white/5 px-3 py-1.5 text-xs transition hover:bg-white/10"
              >
                Cerrar
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {data.pendingChargesPrevious.map((p) => {
                const empName = data.employees.find((e) => e.id === p.employee_id)?.name ?? "—";
                const historialEvents = p.events?.length ? p.events : getHistorialCobro(p.id);
                const yaCobro = historialEvents.some((e) => e.action === "Cobró");
                const yaRechazado = historialEvents.some((e) => e.action === "Rechazó");
                return (
                  <div key={`prev-${p.id}`} className="w-full rounded-2xl border border-amber-400/15 bg-amber-500/[0.03] px-3.5 py-3 text-xs">
                    <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                        {new Date(p.starts_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                      </span>
                      <span className="text-sm font-bold tabular-nums text-amber-200">
                        ${Number(p.service_price ?? 0).toLocaleString("es-AR")}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <span className="shrink-0 text-muted-foreground/70">Cliente</span>
                        <span className="truncate text-right text-foreground">{p.client_name ?? "—"}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="shrink-0 text-muted-foreground/70">Profesional</span>
                        <span className="truncate text-right text-muted-foreground">{empName}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="shrink-0 text-muted-foreground/70">Servicio/Catálogo</span>
                        <span className="truncate text-right text-muted-foreground">{p.service_name ?? "—"}</span>
                      </div>
                    </div>
                    <div className="mt-2.5 border-t border-white/[0.06] pt-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Historial</div>
                      <HistorialCell events={historialEvents} />
                    </div>
                    <div className="mt-2.5 flex items-center gap-1.5 border-t border-white/[0.06] pt-2.5">
                      {!yaCobro && !yaRechazado && (
                        <button
                          type="button"
                          onClick={() => { setPreviousPendingOpen(false); onCobrarPendiente(p); }}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-emerald-300/45 bg-emerald-400/18 px-3.5 py-2 text-[11px] font-extrabold text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.18)] transition active:brightness-110"
                        >
                          Cobrar
                        </button>
                      )}
                      {!yaCobro && !yaRechazado && (
                        <button
                          type="button"
                          title="Rechazar"
                          disabled={rejectingId === p.id}
                          onClick={() => handleRechazarPendiente(p)}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-rose-400/70 ring-1 ring-rose-400/20 transition active:bg-rose-500/10 disabled:opacity-40"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {data.pendingChargesPrevious.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">Sin pendientes anteriores.</div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Historial completo */}
      {closeoutOpen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setCloseoutOpen(false)}
        >
          <div
            className={cn(
              "w-full max-w-7xl overflow-hidden rounded-3xl border bg-[linear-gradient(135deg,rgba(5,8,15,0.98),rgba(7,10,22,0.97),rgba(2,4,12,0.99))] shadow-[0_40px_120px_-55px_rgba(0,0,0,1)]",
              incomeTheme.border,
              incomeTheme.glow,
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className={cn(
                "flex items-center justify-between border-b px-5 py-4",
                incomeTheme.tableHead,
              )}
            >
              <div>
                <h3 className={cn("text-lg font-bold", incomeTheme.title)}>
                  {panel === "pendientes"
                    ? "Historial completo de pendientes"
                    : "Historial completo de ingresos"}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {panel === "pendientes"
                    ? "Todos los cobros pendientes del día."
                    : "Todos los ingresos del día."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCloseoutOpen(false)}
                className="rounded-2xl bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white/70 transition hover:bg-white/[0.10] hover:text-white"
              >
                Cerrar
              </button>
            </div>

            <div className="max-h-[72vh] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
              {/* En mobile, ambos paneles usan tarjetas verticales (ver
                  bloques debajo) en vez de esta tabla con scroll horizontal. */}
              <div className="hidden min-w-[1180px] sm:block">
                <div
                  className={cn(
                    panel === "pendientes"
                      ? "grid grid-cols-[80px_minmax(130px,0.75fr)_minmax(130px,0.75fr)_minmax(240px,1.15fr)_110px_120px_minmax(230px,1fr)_140px] items-center gap-x-3 px-6 py-2.5 text-[10px] font-semibold tracking-[0.18em] text-muted-foreground/60 border-b uppercase"
                      : "grid grid-cols-[80px_minmax(150px,0.85fr)_minmax(150px,0.85fr)_minmax(280px,1.35fr)_120px_140px_minmax(260px,1fr)] items-center gap-x-3 px-6 py-2.5 text-[10px] font-semibold tracking-[0.18em] text-muted-foreground/60 border-b uppercase",
                    incomeTheme.tableHead,
                  )}
                >
                  <div>Fecha</div>
                  <div>Cliente</div>
                  <div>Profesional</div>
                  <div>Servicio / Catálogo</div>
                  <div className="text-right">Monto</div>
                  <div>Método</div>
                  <div>Historial</div>
                  {panel === "pendientes" && <div>Acción</div>}
                </div>

                {panel === "ingresos" ? (
                  rows.length === 0 ? (
                    <div className="px-6 py-14 text-center text-sm text-muted-foreground">
                      Sin cobros.
                    </div>
                  ) : (
                    <div>
                      {rows.map((p: any) => {
                        const date = p.created_at
                          ? new Date(p.created_at).toLocaleDateString("es-AR", {
                              day: "numeric",
                              month: "numeric",
                            })
                          : "—";
                        const time = p.created_at
                          ? `${new Date(p.created_at).toLocaleTimeString("es-AR", {
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })}hs`
                          : "—";
                        // Incluye propina: es el total efectivamente
                        // cobrado al cliente, no solo la facturación pura
                        // de servicios (payment.total).
                        const amount = Number(p.total ?? p.amount ?? 0) + Number(p.tip_amount ?? 0);
                        const methodLabel = paymentMethodLabel(p.method ?? p.payment_method);
                        const paymentNote = getCashRowNote(p, p.service_name);
                        // Misma lógica que "Últimos ingresos" (no el genérico
                        // displayCashActor + "→ Cobró" fijo que tenía esta
                        // modal antes) — línea de tiempo completa con el
                        // nombre real de cada acción, no solo el último
                        // evento.
                        const paymentRecord = p as Record<string, unknown>;
                        // Antes leía p.employee_name/p.professional_name —
                        // columnas que no existen en payments (solo
                        // employee_id), así que la columna Profesional de
                        // este modal siempre caía a "—" aunque el cobro sí
                        // tuviera profesional. Misma resolución que ya usa
                        // "Últimos ingresos" (la tabla de atrás, sin este
                        // bug): buscar el nombre en data.employees por id.
                        const empNameForHist = data.employees.find((e) => e.id === p.employee_id)?.name ?? null;
                        const chargeType = getChargeType(paymentRecord);
                        const chargedByName = getChargedByLabel(paymentRecord, empNameForHist, chargeType);
                        const historialEvents = buildPaidHistorialEvents(paymentRecord, {
                          time,
                          user: chargedByName,
                          action: "Cobró",
                        });

                        return (
                          <div
                            key={`historial-ingreso-${p.id}`}
                            onClick={() => setDetailPayment(p)}
                            className={cn(
                              "grid grid-cols-[80px_minmax(150px,0.85fr)_minmax(150px,0.85fr)_minmax(280px,1.35fr)_120px_140px_minmax(260px,1fr)] items-center gap-x-3 border-b border-white/[0.09] odd:bg-white/[0.022] px-6 py-3 text-xs transition-all duration-200 last:border-0 cursor-pointer",
                              incomeTheme.rowHover,
                            )}
                          >
                            <div className="text-muted-foreground">{date}</div>
                            <div className="truncate text-foreground">{p.client_name ?? "—"}</div>
                            <div className="truncate text-muted-foreground">
                              {empNameForHist ?? "—"}
                            </div>
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="truncate text-foreground/88">
                                {p.service_name ?? p.item_name ?? "—"}
                              </div>
                              {paymentNote && (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setPendingNoteModal({
                                      title: p.service_name ?? "Nota",
                                      note: paymentNote,
                                    });
                                  }}
                                  className={cn(
                                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 transition hover:brightness-125",
                                    incomeTheme.chip,
                                  )}
                                >
                                  Ver nota
                                </button>
                              )}
                            </div>
                            <div className={cn("text-right font-bold tabular-nums", incomeTheme.amount)}>
                              ${amount.toLocaleString("es-AR")}
                            </div>
                            <div className="min-w-0 flex flex-col text-muted-foreground">
                              <span className="truncate">{methodLabel}</span>
                              <ReceiptButton payment={p} businessId={data.businessId} />
                            </div>
                            <div>
                              <HistorialCell events={historialEvents} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : pendingRows.length === 0 ? (
                  <div className="px-6 py-14 text-center text-sm text-muted-foreground">
                    Sin pendientes.
                  </div>
                ) : (
                  <div>
                    {pendingRows.map((p: any) => {
                      const created = p.created_at ? new Date(p.created_at) : null;
                      const date = created
                        ? created.toLocaleDateString("es-AR", {
                            day: "numeric",
                            month: "numeric",
                          })
                        : "—";
                      const amount = Number(p.service_price ?? p.amount ?? 0);
                      const pendingNote = getCashRowNote(p, p.service_name);
                      const historialEvents = p.events?.length ? p.events : getHistorialCobro(p.id);
                      const yaCobro = historialEvents.some((e: HistorialEvento) => e.action === "Cobró");
                      const yaRechazado = historialEvents.some((e: HistorialEvento) => e.action === "Rechazó");

                      return (
                        <div
                          key={`historial-pendiente-${p.id}`}
                          className={cn(
                            "grid grid-cols-[80px_minmax(130px,0.75fr)_minmax(130px,0.75fr)_minmax(240px,1.15fr)_110px_120px_minmax(230px,1fr)_140px] items-center gap-x-3 border-b border-white/[0.09] odd:bg-white/[0.022] px-6 py-3 text-xs transition-all duration-200 last:border-0",
                            incomeTheme.rowHover,
                          )}
                        >
                          <div className="text-muted-foreground">{date}</div>
                          <div className="truncate text-foreground">{p.client_name ?? "—"}</div>
                          <div className="truncate text-muted-foreground">
                            {data.employees.find((e) => e.id === p.employee_id)?.name ?? "—"}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-foreground/88">
                              {p.service_name ?? "—"}
                            </div>
                            {pendingNote && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPendingNoteModal({
                                    title: p.service_name ?? "Nota",
                                    note: pendingNote,
                                  })
                                }
                                className={cn(
                                  "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 transition hover:brightness-125",
                                  incomeTheme.chip,
                                )}
                              >
                                Ver nota
                              </button>
                            )}
                          </div>
                          <div className={cn("text-right font-bold tabular-nums", incomeTheme.amount)}>
                            ${amount.toLocaleString("es-AR")}
                          </div>
                          <div className="truncate text-muted-foreground">—</div>
                          <div>
                            <HistorialCell events={historialEvents} />
                          </div>
                          <div className="flex items-center justify-end gap-1.5">
                            {!yaCobro && !yaRechazado && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCloseoutOpen(false);
                                  onCobrarPendiente(p);
                                }}
                                className="rounded-full border border-emerald-300/45 bg-emerald-400/18 px-4 py-1.5 text-xs font-extrabold text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.18)] transition hover:bg-emerald-400/28 hover:border-emerald-300/70 hover:text-white"
                              >
                                Cobrar
                              </button>
                            )}
                            {!yaCobro && !yaRechazado && (
                              <button
                                type="button"
                                title="Rechazar"
                                disabled={rejectingId === p.id}
                                onClick={() => handleRechazarPendiente(p)}
                                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-rose-400/70 ring-1 ring-rose-400/20 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-40"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Mobile: mismas tarjetas verticales que "Últimos ingresos",
                  mismos datos (rows), mismo modal de detalle al tocar. */}
              {panel === "ingresos" && (
                <div className="sm:hidden">
                  {rows.length === 0 ? (
                    <div className="px-4 py-14 text-center text-sm text-muted-foreground">
                      Sin cobros.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 p-3">
                      {rows.map((p: any) => {
                        const date = p.created_at
                          ? new Date(p.created_at).toLocaleDateString("es-AR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })
                          : "—";
                        const time = p.created_at
                          ? `${new Date(p.created_at).toLocaleTimeString("es-AR", {
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })}hs`
                          : "—";
                        // Incluye propina: es el total efectivamente
                        // cobrado al cliente, no solo la facturación pura
                        // de servicios (payment.total).
                        const amount = Number(p.total ?? p.amount ?? 0) + Number(p.tip_amount ?? 0);
                        const methodLabel = paymentMethodLabel(p.method ?? p.payment_method);
                        const paymentNote = getCashRowNote(p, p.service_name);
                        const paymentRecord = p as Record<string, unknown>;
                        const empNameForHist = data.employees.find((e) => e.id === p.employee_id)?.name ?? null;
                        const chargeType = getChargeType(paymentRecord);
                        const chargedByName = getChargedByLabel(paymentRecord, empNameForHist, chargeType);
                        const historialEvents = buildPaidHistorialEvents(paymentRecord, {
                          time,
                          user: chargedByName,
                          action: "Cobró",
                        });

                        return (
                          <button
                            key={`historial-mobile-${p.id}`}
                            type="button"
                            onClick={() => setDetailPayment(p)}
                            className="w-full rounded-2xl border border-white/[0.07] bg-black/25 px-3.5 py-3 text-left text-xs transition active:brightness-110"
                          >
                            <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                                {date}
                              </span>
                              <span className={cn("text-sm font-bold tabular-nums", incomeTheme.amount)}>
                                ${amount.toLocaleString("es-AR")}
                              </span>
                            </div>
                            <div className="mt-2 space-y-1.5">
                              <div className="flex items-start justify-between gap-3">
                                <span className="shrink-0 text-muted-foreground/70">Cliente</span>
                                <span className="truncate text-right text-foreground">
                                  {p.client_name ?? "—"}
                                </span>
                              </div>
                              <div className="flex items-start justify-between gap-3">
                                <span className="shrink-0 text-muted-foreground/70">Profesional</span>
                                <span className="truncate text-right text-muted-foreground">
                                  {empNameForHist ?? "—"}
                                </span>
                              </div>
                              <div className="flex items-start justify-between gap-3">
                                <span className="shrink-0 text-muted-foreground/70">Servicio/Catálogo</span>
                                <span className="truncate text-right text-muted-foreground">
                                  {p.service_name ?? p.item_name ?? "—"}
                                </span>
                              </div>
                              <div className="flex items-start justify-between gap-3">
                                <span className="shrink-0 text-muted-foreground/70">Método</span>
                                <span className="flex min-w-0 flex-col items-end text-right text-muted-foreground">
                                  <span className="truncate">{methodLabel}</span>
                                  <ReceiptButton payment={p} businessId={data.businessId} />
                                </span>
                              </div>
                              {paymentNote && (
                                <div className="pt-0.5 text-right">
                                  <span
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setPendingNoteModal({
                                        title: p.service_name ?? "Nota",
                                        note: paymentNote,
                                      });
                                    }}
                                    className={cn(
                                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                                      incomeTheme.chip,
                                    )}
                                  >
                                    Ver nota
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="mt-2.5 border-t border-white/[0.06] pt-2">
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                                Historial
                              </div>
                              <HistorialCell events={historialEvents} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Mobile: mismas tarjetas verticales que el panel de
                  Pendientes, mismos datos (pendingRows) y mismo botón
                  "Cobrar" de siempre (cierra el modal y abre el cobro). */}
              {panel === "pendientes" && (
                <div className="sm:hidden">
                  {pendingRows.length === 0 ? (
                    <div className="px-4 py-14 text-center text-sm text-muted-foreground">
                      Sin pendientes.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 p-3">
                      {pendingRows.map((p: any) => {
                        const created = p.created_at ? new Date(p.created_at) : null;
                        const date = created
                          ? created.toLocaleDateString("es-AR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })
                          : "—";
                        const amount = Number(p.service_price ?? p.amount ?? 0);
                        const pendingNote = getCashRowNote(p, p.service_name);
                        const historialEvents = p.events?.length ? p.events : getHistorialCobro(p.id);
                        const yaCobro = historialEvents.some((e: HistorialEvento) => e.action === "Cobró");
                        const yaRechazado = historialEvents.some((e: HistorialEvento) => e.action === "Rechazó");

                        return (
                          <div
                            key={`historial-pendiente-mobile-${p.id}`}
                            className="w-full rounded-2xl border border-white/[0.07] bg-black/25 px-3.5 py-3 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                                {date}
                              </span>
                              <span className={cn("text-sm font-bold tabular-nums", incomeTheme.amount)}>
                                ${amount.toLocaleString("es-AR")}
                              </span>
                            </div>
                            <div className="mt-2 space-y-1.5">
                              <div className="flex items-start justify-between gap-3">
                                <span className="shrink-0 text-muted-foreground/70">Cliente</span>
                                <span className="truncate text-right text-foreground">
                                  {p.client_name ?? "—"}
                                </span>
                              </div>
                              <div className="flex items-start justify-between gap-3">
                                <span className="shrink-0 text-muted-foreground/70">Profesional</span>
                                <span className="truncate text-right text-muted-foreground">
                                  {data.employees.find((e) => e.id === p.employee_id)?.name ?? "—"}
                                </span>
                              </div>
                              <div className="flex items-start justify-between gap-3">
                                <span className="shrink-0 text-muted-foreground/70">Servicio/Catálogo</span>
                                <span className="truncate text-right text-muted-foreground">
                                  {p.service_name ?? "—"}
                                </span>
                              </div>
                              {pendingNote && (
                                <div className="pt-0.5 text-right">
                                  <span
                                    onClick={() =>
                                      setPendingNoteModal({
                                        title: p.service_name ?? "Nota",
                                        note: pendingNote,
                                      })
                                    }
                                    className={cn(
                                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                                      incomeTheme.chip,
                                    )}
                                  >
                                    Ver nota
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="mt-2.5 border-t border-white/[0.06] pt-2">
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                                Historial
                              </div>
                              <HistorialCell events={historialEvents} />
                            </div>
                            <div className="mt-2.5 flex items-center gap-1.5 border-t border-white/[0.06] pt-2.5">
                              {!yaCobro && !yaRechazado && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCloseoutOpen(false);
                                    onCobrarPendiente(p);
                                  }}
                                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-emerald-300/45 bg-emerald-400/18 px-3.5 py-2 text-[11px] font-extrabold text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.18)] transition active:brightness-110"
                                >
                                  Cobrar
                                </button>
                              )}
                              {!yaCobro && !yaRechazado && (
                                <button
                                  type="button"
                                  title="Rechazar"
                                  disabled={rejectingId === p.id}
                                  onClick={() => handleRechazarPendiente(p)}
                                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-rose-400/70 ring-1 ring-rose-400/20 transition active:bg-rose-500/10 disabled:opacity-40"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

    </>
  );
}

// ───────────────────────────── NUEVA VENTA
// Iniciales seguras para el fallback del avatar cuando no hay foto: nunca
// rompe con nombre null/undefined/vacío (mismo criterio que initialsOf en app-sidebar.tsx).
function getInitials(name?: string | null): string {
  const src = (name || "").trim();
  if (!src) return "··";
  const parts = src.split(/\s+/).filter(Boolean);
  return (
    ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || src.slice(0, 2).toUpperCase()
  );
}

type PendingCharge = ReturnType<typeof useCajaData>["pendingCharges"][number];

export function NuevaVentaTab({
  data,
  pendingCharge = null,
  onPendingDone,
  onSaleDone,
  onCancel,
  userEmail,
  lockedEmployeeId,
  variant = "page",
  pendingChargeInitialStep,
  pendingChargeExtraItems,
  turnoChargeMode,
  onManualSend,
  chargedByName,
}: {
  data: ReturnType<typeof useCajaData>;
  pendingCharge?: PendingCharge | null;
  onPendingDone?: () => void;
  onSaleDone?: () => void;
  // Solo se usa en variant="modal": cierra el modal desde el primer paso
  // visible (Cliente, cuando el profesional viene bloqueado), donde no
  // hay a qué "volver" — la acción correcta ahí es cancelar del todo.
  onCancel?: () => void;
  userEmail: string | null;
  // Cuando viene seteado (ej. desde Mi Agenda del profesional), el paso
  // "Profesional" se salta — ya viene elegido y no se puede cambiar.
  lockedEmployeeId?: string;
  // "page": tab normal dentro de la página completa de Caja — el alto se
  // calcula descontando el header de esa página (contexto original de
  // este componente). "modal": este mismo componente montado dentro de un
  // modal centrado (ej. "+ Venta" de Mi Agenda en Profesionales) sin ese
  // header arriba — la fórmula de "page" no tiene sentido ahí, así que
  // usa un cálculo propio basado en el alto real del viewport (dvh) menos
  // el padding del propio overlay del modal.
  variant?: "page" | "modal";
  // ── "Cobrar turno" desde Mi Agenda (Profesionales) ──────────────────────
  // Reutiliza exactamente el mecanismo de pendingCharge (mismo shape que
  // la cola de "Pendientes" de Caja: appointment ya existente, servicio a
  // precargar), pero con tres diferencias puntuales:
  // 1. pendingChargeInitialStep: la cola de Caja siempre arranca en Pago
  //    (paso 4, comportamiento default sin este prop) porque ahí ya está
  //    todo cargado y solo falta cobrar. "Cobrar turno" en cambio quiere
  //    arrancar en Servicios (paso 3) para poder revisar/agregar productos
  //    antes de pagar.
  // 2. pendingChargeExtraItems: productos ya reservados en las notas del
  //    turno (parseProfessionalProductsFromNotes en professionals.tsx) —
  //    el mecanismo original de pendingCharge solo precargaba UN servicio.
  // 3. turnoChargeMode/onManualSend: la cola de Pendientes de Caja siempre
  //    cobra directo al confirmar (ya pasó por aprobación). "Cobrar turno"
  //    en modo manual necesita en cambio ENVIAR a Caja (no cobrar
  //    directo) — mismo comportamiento que tenía el CobroModal viejo.
  //    Sin este prop (undefined), el comportamiento es exactamente el de
  //    siempre: cobra directo.
  pendingChargeInitialStep?: 3 | 4;
  pendingChargeExtraItems?: { name: string; price: number }[];
  turnoChargeMode?: "auto" | "manual";
  onManualSend?: (args: { total: number; items: { serviceName: string; amount: number }[] }) => void | Promise<void>;
  // Nombre visible real (ej. profile.full_name) para el evento "Cobró" del
  // historial. Opcional a propósito: si no viene, sigue cayendo en
  // chargedByUsername(userEmail) (comportamiento de siempre, usado por la
  // cola de Pendientes de Caja) — pero ese fallback es username crudo
  // (ej. "aurostyloadmi"), por eso "Cobrar turno" desde Mi Agenda sí lo pasa.
  chargedByName?: string | null;
}) {
  // Modo "Enviar" (turnoChargeMode="manual"): el profesional no cobra, así
  // que no existe paso de Pago — el flujo termina en Servicios con el botón
  // "Enviar a caja". Modo normal: termina en Pago con "Confirmar cobro",
  // sin cambios de comportamiento.
  const isManualFlow = turnoChargeMode === "manual";
  const finalStep: 1 | 2 | 3 | 4 = isManualFlow ? 3 : 4;
  // pendingChargeInitialStep=3 solo lo pasa professionals.tsx al abrir este
  // modal desde una fila de turno (Cobrar/Enviar) — el cliente ya viene del
  // turno, así que ni se muestra el paso Cliente ni se puede retroceder a
  // él. La cola de Pendientes de Caja (que confirma cobro arrancando en
  // Pago, paso 4) no pasa este prop, así que no se ve afectada.
  const hideClienteStep = pendingChargeInitialStep === 3;
  const minStep: 1 | 2 | 3 | 4 = hideClienteStep ? 3 : lockedEmployeeId ? 2 : 1;

  const [step, setStep] = React.useState<1 | 2 | 3 | 4>(
    pendingCharge ? (pendingChargeInitialStep ?? 4) : lockedEmployeeId ? 2 : 1,
  );
  const [cart, setCart] = React.useState<Record<string, number>>({});
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string>("");
  const [clientId, setClientId] = React.useState<string | null>(pendingCharge ? `__pending_client__${pendingCharge.id}` : null);
  const [client, setClient] = React.useState(pendingCharge?.client_name ?? "");
  const [clientSearch, setClientSearch] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [birthDate, setBirthDate] = React.useState("");
  const [employeeId, setEmployeeId] = React.useState<string>(
    pendingCharge?.employee_id ?? lockedEmployeeId ?? "",
  );
  // "" = sin promoción. Precargada desde la promo PREVISTA del turno (si
  // viene de uno) — se puede mantener, cambiar o quitar libremente antes de
  // cobrar. Esta es la que queda como APLICADA (definitiva) al confirmar.
  const [promotionId, setPromotionId] = React.useState<string>(pendingCharge?.promotion_id ?? "");
  // Descuento manual (sin promoción) — monto ($ o %) + motivo, se aplica en
  // vez de una promoción (elegir uno limpia el otro). discountPanelOpen
  // controla el panel inline del Paso 3, no un modal. manualDiscountMode
  // decide si manualDiscountAmount se interpreta como $ fijo o como %.
  const [manualDiscountAmount, setManualDiscountAmount] = React.useState("");
  // "fixed" | "percent" — mismos valores que PromotionDiscountType
  // (service-pricing.ts), así discountType se pasa directo sin mapear.
  const [manualDiscountMode, setManualDiscountMode] = React.useState<"fixed" | "percent">("fixed");
  const [manualDiscountReason, setManualDiscountReason] = React.useState("Descuento manual");
  const [discountPanelOpen, setDiscountPanelOpen] = React.useState(false);
  // Propina — monto manual, plata del profesional (nunca se suma a
  // facturación/comisión, ver register-payment.ts).
  const [tipAmountInput, setTipAmountInput] = React.useState("");
  const [tipPanelOpen, setTipPanelOpen] = React.useState(false);
  // Pago pendiente — deja la venta con saldo a favor del negocio en vez de
  // asumirla cobrada (Caja → Nueva venta → "Pago pendiente"). Fuerza Pago
  // simple (sin Pago múltiple: un cobro parcial inicial usa un solo
  // método). pendingCollectedInput es cuánto se cobra AHORA (opcional,
  // vacío/"0" = 100% pendiente) — nunca se autocompleta con el total, y
  // viaja como collectedAmount a registerPayment (register-payment.ts).
  const [pagoPendiente, setPagoPendiente] = React.useState(false);
  const [pendingCollectedInput, setPendingCollectedInput] = React.useState("");
  const [method, setMethod] = React.useState<PayMethod>("cash");
  // Método preferido por defecto: Transferencia > Efectivo > primero
  // disponible — se aplica UNA vez por cobro (carga inicial de la
  // pantalla y cada vez que arranca un cobro nuevo, ver los dos puntos
  // donde se resetea este ref más abajo), nunca pisa una elección manual
  // del usuario hecha después. No cambia qué métodos tiene habilitados el
  // negocio, solo cuál queda seleccionado al entrar al Paso 4.
  const methodDefaultAppliedRef = React.useRef(false);
  const [paymentMode, setPaymentMode] = React.useState<"simple" | "multiple">(
    "simple",
  );
  const [received, setReceived] = React.useState("");
  const [splits, setSplits] = React.useState<MultiSplit[]>([
    { method: "cash", amount: "" },
  ]);
  // Comprobante de transferencia — 100% local hasta confirmar el cobro
  // (solo File + object URL, nunca toca Storage): cambiarlo/eliminarlo
  // antes de confirmar no puede dejar archivos huérfanos porque todavía
  // no se subió nada. Solo se sube después de que registerPayment ya
  // devolvió el id real (ver attachReceiptIfNeeded más abajo).
  const [receiptFile, setReceiptFile] = React.useState<File | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  // Idempotencia de cobros (ver 20261019040000_payments_idempotency_key.sql)
  // — se genera una vez por intento de cobro y se reutiliza SOLO si
  // handleCobrar se reintenta para el MISMO carrito (ej. time-out de red);
  // se invalida (useEffect de abajo) ante cualquier cambio real de lo que
  // se está por cobrar, para que un cobro genuinamente distinto nunca
  // reuse la key de uno anterior.
  const chargeAttemptKeyRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    chargeAttemptKeyRef.current = null;
  }, [cart, method, client, clientId, tipAmountInput, splits, employeeId]);
  const [newClientOpen, setNewClientOpen] = React.useState(false);
  // Apellido del cliente nuevo — "client" guarda el nombre (o el nombre
  // completo, una vez elegido un cliente existente por el buscador). Flujo
  // interno simplificado: teléfono obligatorio y principal, nombre/apellido
  // opcionales, nunca mail/notas/"cómo nos conoció" acá (ver
  // saveClientIfNeeded más abajo) — eso sigue siendo exclusivo de la
  // reserva pública, sin tocar.
  const [clientLastName, setClientLastName] = React.useState("");
  const [professionalSearch, setProfessionalSearch] = React.useState("");
  // Resumen del paso 4: arranca compacto (2 ítems) — "Ver más" lo despliega
  // sin que el módulo se agrande de entrada con carritos grandes.
  const [summaryExpanded, setSummaryExpanded] = React.useState(false);

  const pendingHydrateRef = React.useRef<string | null>(null);
  const pendingInjectedRef = React.useRef(false);
  const syntheticServiceId = pendingCharge
    ? `__pending__${pendingCharge.id}`
    : null;

  React.useEffect(() => {
    if (!pendingCharge) return;
    if (pendingHydrateRef.current === pendingCharge.id) return;

    pendingHydrateRef.current = pendingCharge.id;
    pendingInjectedRef.current = false;
    setStep(pendingChargeInitialStep ?? 4);
    setEmployeeId(pendingCharge.employee_id ?? "");
    setClientId(`__pending_client__${pendingCharge.id}`);
    setClient(pendingCharge.client_name ?? "Cliente del mostrador");
    setClientSearch("");
    setPhone("");
    setEmail("");
    setBirthDate("");
    setReceived("");
    setPaymentMode("simple");
    setSplits([{ method: "cash", amount: "" }]);
    methodDefaultAppliedRef.current = false;
    setPromotionId(pendingCharge.promotion_id ?? "");
    setManualDiscountAmount("");
    setManualDiscountMode("fixed");
    setManualDiscountReason("Descuento manual");
    setDiscountPanelOpen(false);
    setTipAmountInput("");
    setTipPanelOpen(false);
  }, [pendingCharge]);

  // Servicio principal del pendingCharge + productos ya reservados (turno
  // cobrado desde Mi Agenda, ver pendingChargeExtraItems) — todos se
  // precargan igual: se intenta matchear por nombre contra el catálogo
  // real, y si no hay match se arma una entrada sintética de solo lectura
  // con el precio ya guardado en el turno. Antes esto solo contemplaba UN
  // servicio; ahora es una lista para poder precargar varios ítems.
  const pendingLineItems = React.useMemo(() => {
    if (!pendingCharge) return [] as { name: string; price: number }[];
    const items: { name: string; price: number }[] = [];
    if (pendingCharge.service_name) {
      items.push({ name: pendingCharge.service_name, price: Number(pendingCharge.service_price ?? 0) });
    }
    for (const extra of pendingChargeExtraItems ?? []) {
      if (extra.name) items.push({ name: extra.name, price: Number(extra.price ?? 0) });
    }
    return items;
  }, [pendingCharge, pendingChargeExtraItems]);

  // When pendingCharge arrives and services are loaded, inject every
  // pending line item into the cart (matched catalog ID, or synthetic).
  React.useEffect(() => {
    if (
      !pendingCharge ||
      pendingInjectedRef.current ||
      data.services.length === 0 ||
      pendingLineItems.length === 0
    )
      return;

    const nextCart: Record<string, number> = {};
    pendingLineItems.forEach((item, index) => {
      const match = data.services.find(
        (s) => s.name.toLowerCase() === item.name.toLowerCase(),
      );
      const id = match?.id ?? (syntheticServiceId ? `${syntheticServiceId}__${index}` : null);
      if (id) nextCart[id] = (nextCart[id] ?? 0) + 1;
    });
    if (Object.keys(nextCart).length > 0) {
      setCart(nextCart);
      pendingInjectedRef.current = true;
    }
  }, [pendingCharge, data.services, syntheticServiceId, pendingLineItems]);

  // If the service from pending is NOT in the catalogue we still need to show it in the cart.
  // We build a synthetic catalogue entry and inject it.
  // Precio de lista + precio en efectivo de cada servicio para el
  // profesional ya elegido (paso 1), resuelto con el mismo
  // `resolveServicePricing` que usan Agenda, Mi Agenda y la Página Pública
  // — el picker, el carrito y el total salen todos de esta lista, así que
  // quedan consistentes por construcción. cashPrice queda en null cuando
  // el servicio no tiene "Precio en efectivo" configurado (ver
  // Configuración → Servicios) — ahí no cambia nada al elegir Efectivo.
  // Precio de lista ESTÁNDAR por id, sin resolver por profesional — única
  // fuente para "precio tachado" en Liquidaciones (ver items más abajo).
  // servicesForEmployee pisa price con el override del profesional si
  // existe; este lookup es deliberadamente anterior a esa resolución.
  const rawServicePriceById = React.useMemo(
    () => Object.fromEntries(data.services.map((s) => [s.id, Number(s.price ?? 0)])),
    [data.services],
  );

  const servicesForEmployee = React.useMemo(() => {
    return data.services.map((s) => {
      if (s.is_catalog) return s;
      const resolved = resolveServicePricing(
        { id: s.id, price: s.price, duration_min: s.duration, cash_discount: s.cash_discount },
        employeeId || null,
        data.employeeServiceOverrides,
      );
      return {
        ...s,
        price: resolved.priceOverridden ? resolved.price : s.price,
        cashPrice: resolved.effectivePrice,
        // Tope de comisión — ver comentario en ResolvedServicePricing
        // (service-pricing.ts): a diferencia de cashPrice, nunca es null
        // solo porque el profesional apagó su propio "Precio en efectivo"
        // público sin cargar un valor propio.
        commissionCap: resolved.commissionCapPrice,
      };
    });
  }, [data.services, data.employeeServiceOverrides, employeeId]);

  const servicesWithSynthetic = React.useMemo(() => {
    if (!pendingCharge || !syntheticServiceId || pendingLineItems.length === 0) return servicesForEmployee;
    // Una entrada sintética por cada ítem pendiente que NO matchea un
    // servicio/producto real del catálogo (antes: como mucho una sola).
    const synthetics = pendingLineItems
      .map((item, index) => {
        const alreadyMatched = servicesForEmployee.some(
          (s) => s.name.toLowerCase() === item.name.toLowerCase(),
        );
        if (alreadyMatched) return null;
        return {
          id: `${syntheticServiceId}__${index}`,
          name: item.name,
          price: item.price,
          category: "Servicios",
          is_catalog: false,
          stock: null,
          image_url: null,
        } as (typeof data.services)[0];
      })
      .filter((s): s is (typeof data.services)[0] => s !== null);
    return synthetics.length > 0 ? [...synthetics, ...servicesForEmployee] : servicesForEmployee;
  }, [servicesForEmployee, pendingCharge, syntheticServiceId, pendingLineItems]);

  // Build categories: services first, then catalog categories (no "Todos")
  const categories = React.useMemo(() => {
    const serviceItems = data.services.filter((s) => !s.is_catalog);
    const catalogItems = data.services.filter((s) => s.is_catalog);
    const cats: string[] = [];
    if (serviceItems.length > 0) cats.push("Servicios");
    const catalogCats = Array.from(
      new Set(catalogItems.map((s) => s.category || "Productos")),
    ).filter(Boolean);
    return [...cats, ...catalogCats];
  }, [data.services]);

  // Set default category on load
  React.useEffect(() => {
    if (categories.length > 0 && !category) setCategory(categories[0]);
  }, [categories, category]);

  const filtered = servicesWithSynthetic.filter((i) => {
    const q = query.trim().toLowerCase();
    const matchesText =
      !q || `${i.name} ${i.category ?? ""}`.toLowerCase().includes(q);
    const matchesCategory =
      category === "Servicios"
        ? !i.is_catalog
        : (i.category || "Productos") === category;
    return matchesText && matchesCategory;
  });

  const paymentOptions = PAYMENT_OPTIONS;

  React.useEffect(() => {
    if (!paymentOptions.some((m) => m.id === method)) {
      setMethod((paymentOptions[0]?.id ?? "cash") as PayMethod);
    }
  }, [paymentOptions, method]);

  // Aplica el método preferido por defecto (Transferencia > Efectivo >
  // primero disponible) — PAYMENT_OPTIONS es fijo, siempre incluye
  // "transfer", así que en la práctica esto siempre resuelve a
  // Transferencia; Efectivo/primero quedan como red de seguridad. Se
  // ejecuta una sola vez por cobro: methodDefaultAppliedRef se resetea a
  // false en los dos puntos donde arranca un cobro nuevo (hidratación de
  // pendingCharge y reset post-venta), así que no vuelve a pisar la
  // elección del usuario dentro del mismo cobro.
  React.useEffect(() => {
    if (methodDefaultAppliedRef.current) return;
    const preferred = paymentOptions.some((m) => m.id === "transfer")
      ? "transfer"
      : paymentOptions.some((m) => m.id === "cash")
        ? "cash"
        : paymentOptions[0].id;
    setMethod(preferred as PayMethod);
    methodDefaultAppliedRef.current = true;
  }, [paymentOptions]);

  const cartItems = Object.entries(cart)
    .map(([id, qty]) => {
      const svc = servicesWithSynthetic.find((s) => s.id === id);
      return svc ? { svc, qty } : null;
    })
    .filter(
      (x): x is { svc: (typeof data.services)[0]; qty: number } => x !== null,
    );

  // Precio en efectivo: se aplica automáticamente cuando el método de pago
  // elegido es "cash" (Efectivo) y el servicio tiene precio en efectivo
  // configurado (cashPrice); con cualquier otro método se vuelve al precio
  // de lista sin tocar nada más. Única fuente para "total" — de acá bajan
  // el descuento de promo, "Total" en pantalla, y lo que se guarda en
  // payments/comisión/liquidación (ver items en handleCobrar más abajo).
  const isCashMethod = method === "cash";
  const cartUnitPrice = (svc: (typeof cartItems)[number]["svc"]) =>
    isCashMethod && svc.cashPrice != null ? Number(svc.cashPrice) : Number(svc.price);
  // Precio de lista del carrito (ignora precio en efectivo) — solo para
  // mostrar el tachado "lista → efectivo" en el resumen del Paso 3, igual
  // que ya se muestra por ítem en el resumen del Paso 4. `total` sigue
  // siendo la única fuente real (ya resuelta según método) para todo lo
  // demás: descuento, subtotal, total a cobrar.
  const listTotal = cartItems.reduce((acc, { svc, qty }) => acc + Number(svc.price) * qty, 0);
  const cartCount = cartItems.reduce((acc, { qty }) => acc + qty, 0);

  // Promoción / descuento — mismo motor que Agenda y la Página Pública, sin
  // duplicar lógica. Solo se muestran promos vigentes y aplicables a ALGÚN
  // servicio del carrito para el profesional elegido; el descuento se
  // aplica únicamente a los ítems de servicio que esa promo alcanza (no a
  // productos de catálogo), sumando el resto del carrito sin tocar.
  const validPromotions = React.useMemo(() => {
    if (!employeeId || cartItems.length === 0) return [];
    const now = new Date();
    return data.promotions.filter(
      (p) =>
        isPromotionCurrentlyValid(p, now) &&
        cartItems.some(
          ({ svc }) => !svc.is_catalog && isPromotionApplicable(p, { serviceId: svc.id, employeeId, category: svc.category ?? null }),
        ),
    );
  }, [data.promotions, cartItems, employeeId]);

  React.useEffect(() => {
    if (promotionId && !validPromotions.some((p) => p.id === promotionId)) {
      setPromotionId("");
    }
  }, [promotionId, validPromotions]);

  const selectedPromotion = validPromotions.find((p) => p.id === promotionId) ?? null;
  const promoAppliesToItem = (svc: (typeof cartItems)[number]["svc"]) =>
    !!selectedPromotion &&
    !svc.is_catalog &&
    isPromotionApplicable(selectedPromotion, { serviceId: svc.id, employeeId, category: svc.category ?? null });
  // El precio de una promoción es siempre el mismo sin importar el medio de
  // pago (efectivo, transferencia, tarjeta, QR) — nunca se calcula sobre el
  // "Precio en efectivo" del servicio, siempre sobre el precio de LISTA.
  // Si se acumulara sobre el precio en efectivo, el mismo turno quedaría
  // más barato pagando en efectivo que por transferencia, lo cual no es la
  // promoción configurada sino un descuento adicional no autorizado. Para
  // ítems sin promoción (o sin promo seleccionada), se mantiene el
  // comportamiento de siempre: precio en efectivo si corresponde.
  const promoAwareUnitPrice = (svc: (typeof cartItems)[number]["svc"]) =>
    promoAppliesToItem(svc) ? rawServicePriceById[svc.id] ?? Number(svc.price) : cartUnitPrice(svc);
  const total = cartItems.reduce(
    (acc, { svc, qty }) => acc + promoAwareUnitPrice(svc) * qty,
    0,
  );
  // Un solo descuento activo a la vez: promoción O manual, nunca los dos
  // sumados — elegir uno limpia el otro (ver los onChange del panel del
  // Paso 3). Como todo acá es estado derivado (no un $ congelado al elegir
  // la promo), si el método de pago cambia después en el Paso 4 esto se
  // recalcula solo, siempre sobre el precio de lista para los ítems que la
  // promo alcanza.
  // Descuento por promoción, ÍTEM por ÍTEM (qty incluido) — solo descuenta
  // los servicios que esa promo alcanza (nunca catálogo, nunca un servicio
  // no aplicable). promoDiscountAmount es simplemente la suma.
  const promoItemDiscounts: number[] = selectedPromotion
    ? cartItems.map(({ svc, qty }) => {
        if (!promoAppliesToItem(svc)) return 0;
        const subtotal = (rawServicePriceById[svc.id] ?? Number(svc.price)) * qty;
        return subtotal - applyPromotionDiscount(subtotal, selectedPromotion);
      })
    : cartItems.map(() => 0);
  const promoDiscountAmount = promoItemDiscounts.reduce((s, d) => s + d, 0);
  // "total" ya es el precio con el método actual resuelto (efectivo si
  // corresponde) — un % manual se calcula sobre ESE monto, nunca sobre el
  // precio de lista, mismo criterio que el descuento de una promoción.
  const manualDiscountValue = Math.max(
    0,
    Math.min(
      total,
      manualDiscountMode === "percent"
        ? (total * (Number(manualDiscountAmount) || 0)) / 100
        : Number(manualDiscountAmount) || 0,
    ),
  );
  const discountAmount = selectedPromotion ? promoDiscountAmount : manualDiscountValue;
  // Descuento por ÍTEM final — fuente única para lo que se manda a
  // registerPayment (ver items en handleCobrar), así la comisión de cada
  // servicio se calcula sobre lo realmente cobrado de ESE servicio, no
  // sobre un promedio parejo de todo el carrito. Promoción: ya viene
  // repartido arriba (promoItemDiscounts). Descuento manual: el cajero no
  // elige a qué ítems aplica, así que se prorratea por peso (subtotal del
  // ítem / total del carrito) entre todos.
  const itemDiscounts: number[] = selectedPromotion
    ? promoItemDiscounts
    : manualDiscountValue > 0 && total > 0
      ? cartItems.map(({ svc, qty }) => ((cartUnitPrice(svc) * qty) / total) * manualDiscountValue)
      : cartItems.map(() => 0);
  const discountLabel = selectedPromotion
    ? selectedPromotion.name
    : manualDiscountValue > 0
      ? manualDiscountReason.trim() || "Descuento manual"
      : null;
  const subtotalAfterDiscount = Math.max(0, total - discountAmount);
  // Propina: plata del profesional, se suma SOLO acá (lo que hay que
  // cobrarle al cliente) — nunca entra en `total`/`finalTotal` de
  // facturación server-side (ver register-payment.ts, tip_amount es una
  // columna aparte). finalTotal sigue siendo la única fuente para vuelto,
  // validación de monto recibido/pago múltiple y el resumen del Paso 4.
  const tipAmount = Math.max(0, Number(tipAmountInput) || 0);
  const finalTotal = subtotalAfterDiscount + tipAmount;

  const receivedNumber = Number(received || 0);
  const change =
    method === "cash" && receivedNumber >= finalTotal ? receivedNumber - finalTotal : 0;
  const cashShortfall =
    method === "cash" && receivedNumber > 0 && receivedNumber < finalTotal
      ? finalTotal - receivedNumber
      : 0;
  const splitsTotal = splits.reduce((s, sp) => s + Number(sp.amount || 0), 0);
  const splitsRemaining = finalTotal - splitsTotal;
  const selectedEmployee = data.employees.find((e) => e.id === employeeId);
  const filteredSaleEmployees = React.useMemo(() => {
    const q = professionalSearch.trim().toLowerCase();
    if (!q) return data.employees;
    return data.employees.filter((employee: any) =>
      `${employee.name ?? ""} ${employee.role ?? ""} ${employee.email ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [data.employees, professionalSearch]);
  const hasSelectedClient = Boolean(clientId || pendingCharge?.client_name);
  const serviceSummary =
    cartItems.length > 0
      ? cartItems
          .map(({ svc, qty }) => `${svc.name}${qty > 1 ? ` x${qty}` : ""}`)
          .join(" + ")
      : "Sin servicios";
  // En el paso 2, con el formulario "Nuevo cliente" abierto, el teléfono ya
  // escrito alcanza para habilitar Continuar — el cliente se crea/reutiliza
  // recién al tocar ese botón (ver goNext), no hace falta un botón
  // "Confirmar cliente" propio del formulario.
  const canContinue =
    step === 1
      ? Boolean(employeeId)
      : step === 2
        ? hasSelectedClient || (newClientOpen && phone.trim().length > 0)
        : step === 3
          ? cartItems.length > 0
          : true;

  const add = (id: string) =>
    setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  const sub = (id: string) =>
    setCart((c) => {
      const n = (c[id] ?? 0) - 1;
      const { [id]: _, ...rest } = c;
      return n <= 0 ? rest : { ...c, [id]: n };
    });

  async function goNext() {
    if (step === 1 && !employeeId) {
      toast.error("Seleccioná un profesional.");
      return;
    }
    if (step === 2 && !clientId) {
      if (!phone.trim()) {
        toast.error("Seleccioná o creá un cliente para continuar.");
        return;
      }
      // Formulario "Nuevo cliente" abierto con teléfono cargado: crea (o
      // reutiliza por teléfono, ver saveClientIfNeeded) el cliente recién
      // acá, sin paso de confirmación intermedio.
      const saved = await saveClientIfNeeded();
      if (!saved) {
        toast.error("No se pudo guardar el cliente. Revisá los datos e intentá de nuevo.");
        return;
      }
      setClientId(saved);
      setClient(`${client.trim()} ${clientLastName.trim()}`.trim());
      setNewClientOpen(false);
    }
    if (step === 3 && cartItems.length === 0) {
      toast.error("Agregá al menos un servicio o producto.");
      return;
    }
    setStep((s) => (s < finalStep ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  }

  // Flujo interno simplificado: el teléfono es el dato principal y el
  // identificador real — se compara por dígitos (sin espacios/signos/código
  // de país), mismo criterio que ya usan Agenda, Clientes y
  // create_public_booking_public_v4, para no crear un cliente duplicado.
  // Nunca se guardan mail/notas/"cómo nos conoció" acá (quedan null; eso
  // sigue siendo exclusivo de la reserva pública, sin tocar).
  async function saveClientIfNeeded(): Promise<string | null> {
    if (!data.businessId) return clientId;
    if (clientId && !clientId.startsWith("__pending_client__")) return clientId;
    if (pendingCharge?.client_name) return null;
    if (!phone.trim()) return clientId;
    try {
      const trimmedPhone = phone.trim();
      const digits = trimmedPhone.replace(/\D/g, "");
      if (digits.length >= 6) {
        const { data: candidates } = await supabase
          .from("clients")
          .select("id, phone")
          .eq("business_id", data.businessId)
          .ilike("phone", `%${digits.slice(-8)}%`);
        const existing = (candidates ?? []).find(
          (c) => (c.phone ?? "").replace(/\D/g, "") === digits,
        );
        if (existing) return existing.id;
      }
      const fullName = `${client.trim()} ${clientLastName.trim()}`.trim();
      const { data: created, error } = await supabase
        .from("clients")
        .insert({
          business_id: data.businessId,
          branch_id: data.activeBranchId,
          full_name: fullName || null,
          phone: trimmedPhone,
        })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return created?.id ?? null;
    } catch (e) {
      console.warn("[cash-register] no se pudo guardar cliente nuevo", e);
      return null;
    }
  }

  // Se llama DESPUÉS de que registerPayment ya insertó el pago y devolvió
  // su id real — nunca antes. Si falla, el cobro ya confirmado queda
  // igual (sin comprobante); nunca se vuelve a llamar registerPayment por
  // esto. attachReceiptToPayment (payment-receipts.ts) ya se encarga de
  // no dejar el archivo huérfano si el UPDATE de receipt_path falla.
  async function attachReceiptIfNeeded(paymentId: string) {
    if (method !== "transfer" || !receiptFile || !data.businessId) return;
    try {
      await attachReceiptToPayment(data.businessId, paymentId, receiptFile);
    } catch (e) {
      toast.error(
        "El cobro se registró, pero el comprobante no se pudo subir. Podés agregarlo después desde el historial.",
      );
      console.warn("[cash-register] no se pudo adjuntar el comprobante:", (e as Error).message);
    }
  }

  function clearReceiptFile() {
    if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
    setReceiptFile(null);
    setReceiptPreviewUrl(null);
  }

  function handleReceiptFileSelected(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Elegí una imagen (foto o captura) del comprobante.");
      return;
    }
    if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
    setReceiptFile(file);
    setReceiptPreviewUrl(URL.createObjectURL(file));
  }

  async function handleCobrar() {
    // Idempotencia: se genera una sola vez por intento — si esta misma
    // llamada falla y el usuario clickea "Confirmar" de nuevo sin cambiar
    // nada del carrito, chargeAttemptKeyRef sigue teniendo la MISMA key (el
    // useEffect de arriba solo la limpia ante un cambio real), así que el
    // reintento deduplica en vez de crear un cobro nuevo.
    if (!chargeAttemptKeyRef.current) {
      chargeAttemptKeyRef.current = crypto.randomUUID();
    }
    const idempotencyKey = chargeAttemptKeyRef.current;

    if (!data.businessId) {
      toast.error("No se pudo identificar el negocio.");
      return;
    }
    if (!employeeId) {
      toast.error("Seleccioná un profesional.");
      setStep(1);
      return;
    }
    if (!hasSelectedClient) {
      toast.error("Seleccioná o creá un cliente.");
      setStep(2);
      return;
    }
    if (cartItems.length === 0) {
      toast.error("Agregá al menos un servicio.");
      setStep(3);
      return;
    }

    // turnoChargeMode="manual": no cobra ahora, envía a Caja para que
    // recepción confirme el cobro después — no tiene sentido pedir monto
    // abonado / distribución de pago múltiple para algo que todavía no se
    // está cobrando. pagoPendiente: tampoco se exige que el monto cubra el
    // total — la venta queda con saldo a favor del negocio a propósito,
    // ver validación propia más abajo.
    if (turnoChargeMode !== "manual" && !pagoPendiente) {
      if (paymentMode === "simple") {
        if (method === "cash") {
          if (!received.trim() || Number(received) <= 0) {
            toast.error("Ingresá el monto abonado.");
            return;
          }
          if (Number(received) < finalTotal) {
            toast.error(
              `El monto abonado ($${Number(received).toLocaleString("es-AR")}) es menor al total ($${finalTotal.toLocaleString("es-AR")}).`,
            );
            return;
          }
        }
      }

      if (paymentMode === "multiple") {
        if (splits.filter((s) => Number(s.amount) > 0).length < 1) {
          toast.error("Cargá al menos un monto en pago múltiple.");
          return;
        }
        if (Math.round(splitsTotal) !== Math.round(finalTotal)) {
          toast.error(
            `El pago múltiple debe sumar $${finalTotal.toLocaleString("es-AR")}. Falta/sobra $${Math.abs(splitsRemaining).toLocaleString("es-AR")}.`,
          );
          return;
        }
      }
    }

    // pagoPendiente: el único monto relevante es lo que se cobra AHORA
    // (opcional, "" = $0 = 100% pendiente) — nunca puede superar
    // subtotalAfterDiscount (servicios+productos, YA con descuento, SIN
    // propina). Nunca finalTotal: ese incluye tipAmount, pero
    // payments.total en la base (lo que valida register_sale/p_total) es
    // siempre sin propina — compararlo contra finalTotal podía rechazar un
    // cobro válido (o aceptar uno que en el backend se recorta solo).
    const pendingCollectedAmount = pagoPendiente ? Number(pendingCollectedInput) || 0 : undefined;
    if (pagoPendiente && pendingCollectedAmount !== undefined && pendingCollectedAmount > subtotalAfterDiscount) {
      toast.error(
        `No podés cobrar más que el total del servicio ($${subtotalAfterDiscount.toLocaleString("es-AR")}, sin contar la propina) al dejar un pago pendiente.`,
      );
      return;
    }

    setSubmitting(true);
    let normalSaleCompleted = false;
    try {
      const savedClientId = await saveClientIfNeeded();
      if (savedClientId && !clientId) setClientId(savedClientId);

      // amount ya viene con el precio en efectivo aplicado si corresponde
      // (cartUnitPrice) — lo que se guarda en payments/liquidación es
      // siempre el monto realmente cobrado, nunca el de lista si se cobró
      // con descuento por efectivo. Para ítems con una promoción aplicada,
      // en cambio, se usa promoAwareUnitPrice: el precio de la promo nunca
      // depende del medio de pago, siempre sale del precio de lista (ver
      // promoAwareUnitPrice más arriba). effectivePrice (tope de la base de
      // comisión) y discountAmount (ya repartido por servicio, ver
      // itemDiscounts abajo) viajan por ítem para que registerPayment
      // calcule la comisión real de CADA servicio — nunca el de lista si
      // supera al efectivo, nunca más de lo que esa línea realmente cobró.
      const items = cartItems.map(({ svc, qty }, idx) => ({
        serviceId: svc.id,
        serviceName: svc.name,
        amount: promoAwareUnitPrice(svc),
        // Precio de lista ESTÁNDAR (data.services, sin resolver por
        // profesional) al momento de ESTA venta — se guarda en
        // payments.original_amount (ver register-payment.ts) para que
        // Liquidaciones pueda mostrar "precio tachado vs. final" sin
        // depender del precio ACTUAL del catálogo. Importante: NO usar
        // svc.price acá — ese ya viene resuelto por profesional
        // (servicesForEmployee aplica un override de precio por
        // profesional si existe), así que podía coincidir con el precio en
        // efectivo y esconder el tachado justo en el caso que se quiere
        // mostrar. "Precio de lista" es siempre el precio único del
        // catálogo, nunca el ajustado por profesional.
        listPrice: rawServicePriceById[svc.id] ?? svc.price,
        // Tope de la base de comisión — commissionCap, NO cashPrice: un
        // profesional puede tener el "Precio en efectivo" público
        // desactivado para este servicio y aun así corresponde aplicar el
        // tope estándar del servicio a su comisión (ver
        // ResolvedServicePricing.commissionCapPrice).
        effectivePrice: svc.is_catalog ? null : svc.commissionCap ?? null,
        discountAmount: itemDiscounts[idx] ?? 0,
        isCatalog: svc.is_catalog ?? false,
        stock: svc.stock,
        qty,
      }));

      const validSplits =
        paymentMode === "multiple"
          ? splits
              .filter((s) => Number(s.amount) > 0)
              .map((s) => ({
                method: s.method as PayMethod,
                amount: Number(s.amount),
              }))
          : undefined;

      if (pendingCharge && turnoChargeMode === "manual") {
        // ── Cobrar turno (modo manual) ── no se cobra ahora: se envía a
        // Caja para que recepción lo confirme después. Mismo marcador
        // interno "[PENDIENTE_CAJA]" que usaba el CobroModal viejo, para
        // que el resto del sistema (Caja → Pendientes) lo reconozca igual.
        //
        // IMPORTANTE: nunca tocar appointments.status acá. La restricción
        // "appointments_status_check" de Supabase no admite "pending_payment"
        // (los valores válidos son pending/confirmed/completed/cancelled/
        // no_show/charged/blocked) — escribirlo tiraba el update entero
        // abajo (incluida la nota), así que el turno JAMÁS quedaba marcado
        // como enviado en la base, solo en el caché local del dispositivo
        // del profesional. Caja, en otro dispositivo, nunca lo veía. El
        // marcador "[PENDIENTE_CAJA]" en las notas es la única fuente de
        // verdad — no requiere ninguna columna nueva.
        const cleanNote = getCashRowNote(pendingCharge, pendingCharge.service_name);
        const itemsStr = items
          .map((i) => `${i.serviceName} $${Math.round(i.amount).toLocaleString("es-AR")}`)
          .join(", ");
        const noteParts = [cleanNote, itemsStr].filter(Boolean).join(" | ");
        const nextNotes = noteParts ? `[PENDIENTE_CAJA] ${noteParts}` : "[PENDIENTE_CAJA]";

        // .select("id") + chequeo de filas afectadas: si el turno ya fue
        // cobrado/cancelado/enviado por otra acción mientras este modal
        // estaba abierto (doble tap, otra pestaña), el .in("status", ...)
        // no matchea ninguna fila — sin este chequeo, Supabase no tira
        // error igual y el código seguía de largo, pudiendo duplicar el
        // envío a Caja del mismo turno.
        const { data: sentRows, error: sendError } = await supabase
          .from("appointments")
          .update({ notes: nextNotes })
          .eq("id", pendingCharge.id)
          .in("status", ["pending", "confirmed", "in_service"])
          .select("id");
        if (sendError) throw sendError;
        if (!sentRows || sentRows.length === 0) {
          toast.error("Este turno ya fue cobrado o actualizado — recargá la agenda.");
          return;
        }

        await appendHistorialCobro(pendingCharge.id, {
          time: formatArgTime(),
          ts: new Date().toISOString(),
          user: chargedByName || chargedByUsername(userEmail),
          action: "Envió a caja",
        });

        await onManualSend?.({
          total,
          items: items.map((i) => ({ serviceName: i.serviceName, amount: i.amount })),
        });

        toast.success("✓ Enviado a Caja");
        notifyCajaPendientesChanged();
        return;
      }

      if (!pendingCharge && turnoChargeMode === "manual") {
        // ── Venta de mostrador en modo "Enviar" (botón del panel, sin
        // partir de un turno) ── NO debe crear ni ocupar un turno: un
        // intento anterior creaba un appointment (aun con duración 0) y
        // terminaba apareciendo en la agenda del profesional, superpuesto
        // con turnos reales — lo cual está mal, no es un turno. En cambio
        // se guarda en business_settings.schedule._pendingWalkInSales
        // (mismo JSONB que ya usan _employeeServiceOverrides/_catalogImages
        // en este mismo archivo de settings — columna ya probada, sin
        // arriesgar un valor de status no soportado como pasó con
        // appointments.status = "pending_payment"). Es visible desde
        // cualquier dispositivo porque se persiste en Supabase, no en
        // localStorage.
        const clientNameFinal = client.trim() || "Cliente del mostrador";
        const walkInId = `walkin-${crypto.randomUUID()}`;
        const nowIso = new Date().toISOString();
        const sendEvent = {
          time: formatArgTime(),
          ts: nowIso,
          user: chargedByName || chargedByUsername(userEmail),
          action: "Envió a caja",
        };

        const { data: existingRow, error: readError } = await supabase
          .from("business_settings")
          .select("schedule")
          .eq("business_id", data.businessId)
          .maybeSingle();
        if (readError) throw readError;

        const schedule = (existingRow?.schedule ?? {}) as Record<string, unknown>;
        const currentPending = Array.isArray((schedule as Record<string, unknown>)._pendingWalkInSales)
          ? ((schedule as Record<string, unknown>)._pendingWalkInSales as unknown[])
          : [];
        const newSale = {
          id: walkInId,
          employee_id: employeeId || null,
          client_name: clientNameFinal,
          service_name: serviceSummary,
          service_price: total,
          starts_at: nowIso,
          events: [sendEvent],
        };
        const { error: writeError } = await supabase
          .from("business_settings")
          .upsert(
            { business_id: data.businessId, schedule: { ...schedule, _pendingWalkInSales: [...currentPending, newSale] } },
            { onConflict: "business_id" },
          );
        if (writeError) throw writeError;

        toast.success("✓ Enviado a Caja");
        notifyCajaPendientesChanged();
        await onManualSend?.({
          total,
          items: items.map((i) => ({ serviceName: i.serviceName, amount: i.amount })),
        });
        return;
      }

      if (pendingCharge && pendingCharge.id.startsWith("walkin-")) {
        // ── Confirmar cobro de una venta de mostrador enviada sin turno ──
        // No hay appointment que actualizar: se registra el pago suelto y
        // se saca la entrada de business_settings.schedule._pendingWalkInSales.
        const { data: existingRow, error: readError } = await supabase
          .from("business_settings")
          .select("schedule")
          .eq("business_id", data.businessId)
          .maybeSingle();
        if (readError) throw readError;

        const schedule = (existingRow?.schedule ?? {}) as Record<string, unknown>;
        const currentPending = Array.isArray((schedule as Record<string, unknown>)._pendingWalkInSales)
          ? ((schedule as Record<string, unknown>)._pendingWalkInSales as Array<{ id: string; events?: HistorialEvento[] }>)
          : [];
        const thisSale = currentPending.find((s) => s.id === pendingCharge.id);
        if (!thisSale) {
          toast.error("Esta venta ya fue cobrada o actualizada — recargá la caja.");
          return;
        }

        const now = new Date();
        const hhmm = formatArgTime(now);
        // Traspasar "Envió a caja" + agregar "Cobró" al mismo historial —
        // se guardan juntos en payments.observations (columna de texto
        // libre ya usada, sin riesgo de constraint) porque no hay
        // appointment.cobro_events al que asociarlos.
        const fullHist: HistorialEvento[] = [
          ...(thisSale.events ?? []),
          { time: hhmm, ts: now.toISOString(), user: chargedByName || chargedByUsername(userEmail), action: "Cobró" },
        ];

        const walkinRows = await registerPayment({
          idempotencyKey,
          businessId: data.businessId,
          branchId: data.activeBranchId,
          employeeId: employeeId || null,
          employeeName: selectedEmployee?.name ?? null,
          commissionPct: selectedEmployee?.commission_pct ?? null,
          commissionFixed: selectedEmployee?.commission_fixed ?? null,
          employeeCommissions: data.employeeCommissions,
          commissionsEnabled: selectedEmployee?.commission_enabled !== false,
          clientName: client.trim() || pendingCharge.client_name || "Cliente del mostrador",
          clientId: savedClientId?.startsWith?.("__pending_client__") ? null : savedClientId,
          items,
          method,
          splits: validSplits,
          appointmentId: null,
          sessionId: data.cashSessionId,
          chargedBy: data.profileId,
          chargeOrigin: "manual",
          notes: `${PAY_HIST_MARKER}${JSON.stringify(fullHist)}`,
          promotionId: selectedPromotion?.id ?? null,
          // Sin promoción, promotionName pasa a ser el motivo del
          // descuento manual (ej. "Cortesía") — misma columna, ver
          // register-payment.ts.
          promotionName: discountLabel,
          discountType: selectedPromotion?.discountType ?? (manualDiscountValue > 0 ? manualDiscountMode : null),
          discountValue:
            selectedPromotion?.discountValue ??
            (manualDiscountValue > 0 ? String(Number(manualDiscountAmount) || 0) : null),
          discountAmount,
          tipAmount,
          clientPhone: phone,
          clientEmail: email,
          collectedAmount: pendingCollectedAmount,
        });
        if (walkinRows[0]?.id) await attachReceiptIfNeeded(walkinRows[0].id);

        const { error: removeError } = await supabase
          .from("business_settings")
          .upsert(
            { business_id: data.businessId, schedule: { ...schedule, _pendingWalkInSales: currentPending.filter((s) => s.id !== pendingCharge.id) } },
            { onConflict: "business_id" },
          );
        if (removeError) throw removeError;

        chargeAttemptKeyRef.current = null;
        toast.success(
          pagoPendiente
            ? (pendingCollectedAmount ?? 0) > 0
              ? `Venta registrada · cobrado $${(pendingCollectedAmount ?? 0).toLocaleString("es-AR")} · pendiente $${Math.round(finalTotal - (pendingCollectedAmount ?? 0)).toLocaleString("es-AR")}`
              : `Venta registrada como pago pendiente · $${finalTotal.toLocaleString("es-AR")}`
            : `Cobro confirmado · $${finalTotal.toLocaleString("es-AR")}`,
        );
        clearReceiptFile();
        onPendingDone?.();
        await data.refresh();
        notifyCajaPendientesChanged();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("clippr:manual-pending-updated"));
        return;
      }

      if (pendingCharge) {
        const professionalNote = getCashRowNote(pendingCharge, pendingCharge.service_name);

        // ── FLUJO PENDIENTE: registrar pago + transición del turno, todo
        // atómico dentro de register_sale (ver register-payment.ts) ──
        // Antes esto era dos pasos separados: 1) UPDATE appointments.status
        // a "charged" y 2) registerPayment() — si el paso 2 fallaba
        // entero, el turno quedaba "cobrado" sin ningún payment real (3
        // casos así en producción, auditoría del 11/10/2026). Ahora
        // appointmentId + appointmentNotes van DENTRO del RPC: si el turno
        // ya no está en un estado cobrable, el RPC entero hace rollback
        // (ni el payment se llega a crear) y lanza el mismo mensaje de
        // siempre, mostrado por el catch de más abajo.
        const pendingRows = await registerPayment({
          idempotencyKey,
          businessId: data.businessId,
          branchId: data.activeBranchId,
          employeeId: employeeId || null,
          employeeName: selectedEmployee?.name ?? null,
          commissionPct: selectedEmployee?.commission_pct ?? null,
          commissionFixed: selectedEmployee?.commission_fixed ?? null,
          employeeCommissions: data.employeeCommissions,
          commissionsEnabled: selectedEmployee?.commission_enabled !== false,
          clientName:
            client.trim() ||
            pendingCharge.client_name ||
            "Cliente del mostrador",
          clientId: savedClientId?.startsWith?.("__pending_client__") ? null : savedClientId,
          items,
          method,
          splits: validSplits,
          appointmentId: pendingCharge.id,
          appointmentNotes: professionalNote || null,
          sessionId: data.cashSessionId,
          chargedBy: data.profileId,
          chargeOrigin: "manual",
          notes: professionalNote || null,
          promotionId: selectedPromotion?.id ?? null,
          // Sin promoción, promotionName pasa a ser el motivo del
          // descuento manual (ej. "Cortesía") — misma columna, ver
          // register-payment.ts.
          promotionName: discountLabel,
          discountType: selectedPromotion?.discountType ?? (manualDiscountValue > 0 ? manualDiscountMode : null),
          discountValue:
            selectedPromotion?.discountValue ??
            (manualDiscountValue > 0 ? String(Number(manualDiscountAmount) || 0) : null),
          discountAmount,
          tipAmount,
          clientPhone: phone,
          clientEmail: email,
          collectedAmount: pendingCollectedAmount,
        });
        if (pendingRows[0]?.id) await attachReceiptIfNeeded(pendingRows[0].id);

        // 3. Registrar en el historial del turno que el usuario de caja cobró el
        //    pendiente. Persiste en appointments.cobro_events (Supabase).
        //    Awaited a propósito: data.refresh() (al final de esta función)
        //    vuelve a traer cobro_events fresco de la base para mostrarlo en
        //    "Últimos ingresos" — sin esperar acá, esa relectura podía
        //    ganarle a este UPDATE y traer el historial todavía sin el
        //    "Cobró" recién escrito, cayendo al nombre genérico de fallback.
        const now = new Date();
        const hhmm = formatArgTime(now);
        await appendHistorialCobro(pendingCharge.id, {
          time: hhmm,
          ts: now.toISOString(),
          user: chargedByName || chargedByUsername(userEmail),
          action: "Cobró",
        });

        // 4. Limpiar de localStorage
        removeLocalManualPendingCharge(pendingCharge.id);

        chargeAttemptKeyRef.current = null;
        toast.success(
          pagoPendiente
            ? (pendingCollectedAmount ?? 0) > 0
              ? `Venta registrada · cobrado $${(pendingCollectedAmount ?? 0).toLocaleString("es-AR")} · pendiente $${Math.round(finalTotal - (pendingCollectedAmount ?? 0)).toLocaleString("es-AR")}`
              : `Venta registrada como pago pendiente · $${finalTotal.toLocaleString("es-AR")}`
            : `Cobro confirmado · $${finalTotal.toLocaleString("es-AR")}`,
        );
        clearReceiptFile();
        onPendingDone?.();
        notifyCajaPendientesChanged();
      } else {
        // ── FLUJO NORMAL: nueva venta desde cero ──
        // Sin esto, el historial quedaba vacío (nunca pasó por Pendientes,
        // no hay appointment_id ni marcador [[HIST]] previo) y
        // buildPaidHistorialEvents caía en getChargedByLabel, que devuelve
        // el genérico "Caja" para chargeOrigin "caja" — nunca la cuenta
        // real que confirmó el cobro. chargedByName ya viene resuelto
        // desde el profile del usuario autenticado (ver CashRegisterPage);
        // si no hay nombre cargado, chargedByUsername cae al email.
        const now = new Date();
        const chargeEvent: HistorialEvento = {
          time: formatArgTime(now),
          ts: now.toISOString(),
          user: chargedByName || chargedByUsername(userEmail),
          action: "Cobró",
        };
        const saleRows = await registerPayment({
          idempotencyKey,
          businessId: data.businessId,
          branchId: data.activeBranchId,
          employeeId: employeeId || null,
          employeeName: selectedEmployee?.name ?? null,
          commissionPct: selectedEmployee?.commission_pct ?? null,
          commissionFixed: selectedEmployee?.commission_fixed ?? null,
          employeeCommissions: data.employeeCommissions,
          commissionsEnabled: selectedEmployee?.commission_enabled !== false,
          clientName: client.trim() || "Cliente del mostrador",
          clientId: savedClientId,
          items,
          method,
          splits: validSplits,
          sessionId: data.cashSessionId,
          chargedBy: data.profileId,
          chargeOrigin: "caja",
          notes: `${PAY_HIST_MARKER}${JSON.stringify([chargeEvent])}`,
          promotionId: selectedPromotion?.id ?? null,
          // Sin promoción, promotionName pasa a ser el motivo del
          // descuento manual (ej. "Cortesía") — misma columna, ver
          // register-payment.ts.
          promotionName: discountLabel,
          discountType: selectedPromotion?.discountType ?? (manualDiscountValue > 0 ? manualDiscountMode : null),
          discountValue:
            selectedPromotion?.discountValue ??
            (manualDiscountValue > 0 ? String(Number(manualDiscountAmount) || 0) : null),
          discountAmount,
          tipAmount,
          clientPhone: phone,
          clientEmail: email,
          collectedAmount: pendingCollectedAmount,
        });
        if (saleRows[0]?.id) await attachReceiptIfNeeded(saleRows[0].id);

        chargeAttemptKeyRef.current = null;
        toast.success(
          pagoPendiente
            ? (pendingCollectedAmount ?? 0) > 0
              ? `Venta registrada · cobrado $${(pendingCollectedAmount ?? 0).toLocaleString("es-AR")} · pendiente $${Math.round(finalTotal - (pendingCollectedAmount ?? 0)).toLocaleString("es-AR")}`
              : `Venta registrada como pago pendiente · $${finalTotal.toLocaleString("es-AR")}`
            : `Cobro confirmado · $${finalTotal.toLocaleString("es-AR")}`,
        );
        setCart({});
        setClientId(null);
        setClient("");
        setClientLastName("");
        setClientSearch("");
        setPhone("");
        setEmail("");
        setBirthDate("");
        setReceived("");
        setSplits([{ method: "cash", amount: "" }]);
        setPaymentMode("simple");
        methodDefaultAppliedRef.current = false;
        setPromotionId("");
        setManualDiscountAmount("");
        setManualDiscountMode("fixed");
        setManualDiscountReason("Descuento manual");
        setDiscountPanelOpen(false);
        setTipAmountInput("");
        setTipPanelOpen(false);
        setPagoPendiente(false);
        setPendingCollectedInput("");
        clearReceiptFile();
        normalSaleCompleted = true;
      }

      await data.refresh();
      if (normalSaleCompleted) onSaleDone?.();
    } catch (e) {
      toast.error((e as Error).message || "Error al guardar el cobro");
    } finally {
      setSubmitting(false);
    }
  }

  const stepItems = [
    { n: 1, label: "Profesional", hint: selectedEmployee?.name ?? "Elegí quién atiende", icon: Wallet },
    { n: 2, label: "Cliente", hint: clientId ? client || "Cliente seleccionado" : "Buscá o creá cliente", icon: Search },
    { n: 3, label: "Servicios", hint: cartCount > 0 ? `${cartCount} ítem${cartCount === 1 ? "" : "s"}` : "Agregá servicios", icon: ClipboardList },
    { n: 4, label: "Pago", hint: finalTotal > 0 ? `$${finalTotal.toLocaleString("es-AR")}` : "Confirmá cobro", icon: CreditCard },
  ] as const;
  // Con profesional bloqueado (ej. Mi Agenda), ese paso no se muestra: ya
  // viene elegido y no se puede cambiar. hideClienteStep: el cliente ya
  // viene del turno (ver arriba). isManualFlow: modo "Enviar", no existe
  // paso de Pago (ver finalStep).
  const visibleStepItems = stepItems.filter((s) => {
    if (lockedEmployeeId && s.n === 1) return false;
    if (hideClienteStep && s.n === 2) return false;
    if (isManualFlow && s.n === 4) return false;
    return true;
  });

  function canOpenStep(target: 1 | 2 | 3 | 4) {
    if (target > finalStep) return false;
    if (target > 1 && !employeeId) return false;
    if (target > 2 && !hasSelectedClient) return false;
    if (target > 3 && cartItems.length === 0) return false;
    return true;
  }

  return (
    <div
      className={cn(
        // backdrop-blur-2xl SOLO desde lg: (no en mobile/md). backdrop-filter
        // en un ancestro crea su propio "containing block" para hijos
        // position:fixed — la barra Volver/COBRAR de abajo (fixed en
        // mobile) estaba resolviendo su bottom relativo a ESTA tarjeta
        // (que mide 100svh-210px, no la pantalla completa) en vez del
        // viewport real, por eso quedaba "flotando" muy por encima de la
        // nav inferior real con un hueco vacío debajo. El fondo ya es casi
        // opaco (alpha 0.95-0.99), así que sacar el blur en mobile no se
        // nota visualmente — y en lg: (donde esa barra vuelve a flujo
        // normal, sin fixed) el blur se mantiene exactamente igual.
        "relative mx-auto flex w-full max-w-5xl flex-col overflow-hidden rounded-[30px] border border-white/[0.085] bg-[linear-gradient(135deg,rgba(5,8,15,0.97),rgba(10,12,24,0.95),rgba(2,4,12,0.99))] px-3 pt-3 md:px-3.5 md:pt-3.5 shadow-[0_44px_130px_-55px_rgba(0,0,0,1),0_0_70px_-48px_rgba(139,92,246,0.60)] lg:backdrop-blur-2xl",
        variant === "modal"
          // overflow-y-auto (pisa el overflow-hidden base vía twMerge):
          // el alto de acá abajo pasó de "height" fija a "maxHeight" —
          // ahora el contenido puede terminar siendo más alto que ese
          // máximo (pantalla chica + carrito con varios ítems, por
          // ejemplo), y sin esto se recortaría en vez de scrollear. Antes
          // no hacía falta: con "height" fija + los hijos en flex-1
          // forzados a esa altura exacta, nunca había overflow real que
          // scrollear — a costa del espacio vacío enorme que se estiraba
          // cuando el contenido real medía menos.
          ? "min-h-[420px] overflow-y-auto pb-3 md:pb-3.5"
          : cn(
              // svh, no vh: 100vh en iOS Safari mide el viewport GRANDE
              // (como si la barra de direcciones ya estuviera colapsada),
              // más alto que lo realmente visible. svh es el viewport más
              // chico posible, estable desde el primer render.
              "h-[calc(100svh-210px)] min-h-[560px] sm:h-[calc(100svh-262px)] sm:mb-6",
              // pb-24 (96px) SOLO hasta lg: Volver/COBRAR pasa a
              // position:fixed en mobile (ver más abajo), sale del flujo
              // normal — sin este padding, el contenido scrolleable de
              // cada paso podría renderizar por DEBAJO de donde esa barra
              // fija termina quedando, tapado. En lg: la barra vuelve al
              // flujo normal (no hay nav inferior de Clippr ahí, es
              // lg:hidden), así que el padding también vuelve al normal.
              "pb-24 lg:pb-3.5",
            ),
      )}
      style={
        variant === "modal"
          // Espeja exacto el padding del overlay que envuelve este modal
          // en professionals.tsx (pt-6 + pb-[max(1.5rem,safe-area)]), para
          // que la tarjeta ocupe justo el alto real disponible del
          // dispositivo sin sobrar ni faltar contra la barra superior o
          // inferior. svh (no dvh): dvh en iOS Safari a veces mide el
          // viewport "grande" (como si la barra de direcciones ya estuviera
          // colapsada) recién al abrir el modal, y no se corrige hasta que
          // algo fuerza un resize real (como enfocar un input y abrir el
          // teclado) — eso dejaba la barra de Volver/Continuar fuera del
          // área visible hasta tocar el buscador. svh es el viewport MÁS
          // chico posible (barra de direcciones expandida), estable desde
          // el primer render sin depender de ningún evento para recalcular.
          // maxHeight, no height: el modal ahora se achica al alto real
          // de su contenido (Cliente/Servicios en el paso 3, resumen +
          // método de pago en el paso 4, etc.) en vez de ocupar siempre
          // este alto completo — este valor pasa a ser un TOPE, no un
          // tamaño fijo, para pantallas donde el contenido sí llega a
          // necesitar todo ese espacio (o más, y ahí scrollea).
          ? { maxHeight: "calc(100svh - 1.5rem - max(1.5rem, env(safe-area-inset-bottom, 0px)))" }
          : undefined
      }
    >
      <div className="pointer-events-none absolute -inset-x-16 top-0 -z-10 h-[760px] rounded-[48px] bg-[radial-gradient(circle_at_50%_18%,rgba(0,0,0,0.62),rgba(0,0,0,0.34)_38%,rgba(0,0,0,0)_72%)] blur-2xl" />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_18%_0%,rgba(96,165,250,0.10),transparent_34%),radial-gradient(circle_at_86%_0%,rgba(139,92,246,0.12),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_34%)]" />
      <Card className="relative z-10 shrink-0 overflow-hidden rounded-3xl border-white/[0.07] bg-[linear-gradient(135deg,rgba(4,7,17,0.94),rgba(9,12,26,0.92),rgba(2,4,12,0.98))] p-1.5 shadow-[0_34px_105px_-48px_rgba(0,0,0,1),0_0_60px_-38px_rgba(139,92,246,0.58)]">
        {/* Columnas = cantidad real de pasos visibles, no un fijo 3/4 según
            lockedEmployeeId — con Profesional Y Pago ocultos a la vez (ej.
            "Enviar" desde Mi Agenda) solo quedan Cliente+Servicios, pero el
            grid seguía reservando una 3ra columna fantasma vacía, corriendo
            todo hacia la izquierda con espacio libre a la derecha. */}
        <div className={cn(
          "grid gap-1.5 sm:gap-2",
          visibleStepItems.length === 2 && "grid-cols-2",
          visibleStepItems.length === 3 && "grid-cols-3",
          visibleStepItems.length === 4 && "grid-cols-4",
        )}>
          {visibleStepItems.map((s, index) => {
            const active = step === s.n;
            const done = step > s.n;
            const enabled = canOpenStep(s.n);
            const Icon = s.icon;
            return (
              <button
                key={s.n}
                type="button"
                onClick={() => {
                  if (!enabled) {
                    if (s.n > 1 && !employeeId) toast.error("Seleccioná un profesional.");
                    else if (s.n > 2 && !hasSelectedClient) toast.error("Seleccioná o creá un cliente.");
                    else if (s.n > 3 && cartItems.length === 0) toast.error("Agregá al menos un servicio o producto.");
                    return;
                  }
                  setStep(s.n);
                }}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border px-2 py-1.5 text-left transition-all duration-300 sm:px-3",
                  active
                    ? "border-blue-200/38 bg-[linear-gradient(135deg,rgba(96,165,250,0.86),rgba(139,92,246,0.88))] text-white shadow-[0_0_34px_rgba(99,102,241,0.28),0_18px_45px_-24px_rgba(0,0,0,0.90),0_1px_0_rgba(255,255,255,0.24)_inset]"
                    : done
                      ? "border-emerald-300/18 bg-[linear-gradient(135deg,rgba(16,185,129,0.10),rgba(2,6,23,0.72))] text-emerald-100 hover:bg-emerald-400/[0.08]"
                      : "border-white/[0.065] bg-[linear-gradient(135deg,rgba(255,255,255,0.035),rgba(2,6,23,0.68))] text-white/55 hover:border-white/[0.12] hover:bg-white/[0.055] hover:text-white/85",
                  !enabled && !active && "cursor-not-allowed opacity-55",
                )}
              >
                {index < visibleStepItems.length - 1 && (
                  <span className={cn(
                    "pointer-events-none absolute right-[-10px] top-1/2 hidden h-px w-5 -translate-y-1/2 md:block",
                    done ? "bg-emerald-300/40" : "bg-white/10",
                  )} />
                )}
                <div className="relative flex items-center gap-0 sm:gap-3">
                  {/* El ícono se saca por completo en mobile (hidden, no
                      solo opacity/visibility): con 3 pasos compitiendo por
                      el mismo ancho angosto, cada ícono + su gap le
                      robaban espacio al texto y "Servicios" terminaba
                      cortado. hidden = display:none, así que ni siquiera
                      reserva el hueco del gap — el texto pasa a ocupar
                      todo el ancho del botón. Desktop (sm+, 4 columnas con
                      más aire) sigue mostrando el ícono sin cambios. */}
                  <span className={cn(
                    "hidden shrink-0 place-items-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-105 sm:grid sm:size-7",
                    active
                      ? "bg-white/18 text-white ring-white/35"
                      : done
                        ? "bg-emerald-400/14 text-emerald-200 ring-emerald-300/24"
                        : "bg-white/[0.045] text-white/55 ring-white/10",
                  )}>
                    {done ? <Check className="size-4" /> : <Icon className="size-4" />}
                  </span>
                  <span className="min-w-0 w-full text-center sm:w-auto sm:text-left">
                    <span className={cn("block truncate text-xs font-extrabold sm:text-sm", active ? "text-white" : "text-current")}>
                      {/* Con profesional bloqueado (Mi Agenda) no se numeran
                          los pasos — el paso "Profesional" ya no existe acá,
                          así que "2 · Cliente" quedaba con una numeración
                          que no tenía sentido para el profesional. */}
                      {lockedEmployeeId ? s.label : `${s.n} · ${s.label}`}
                    </span>
                    {/* Hint ("Agregá servicios", "Confirmá cobro", etc.):
                        oculto en mobile, no solo por espacio — con 3 pasos
                        angostos y sin ícono, esa segunda línea competía
                        con el label por ser lo primero que se lee y
                        rompía la idea de "Cliente / Servicios / Pago"
                        como tres botones parejos. hidden = display:none,
                        no reserva alto: los tres quedan con el mismo
                        alto real. Desktop (más aire, 4 columnas con
                        ícono) lo conserva. */}
                    <span className={cn("mt-0.5 hidden truncate text-[10px] font-medium sm:block", active ? "text-white/75" : "text-white/40")}>
                      {s.hint}
                    </span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="relative z-10 h-px shrink-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

      {step === 1 && (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col space-y-3 overflow-hidden">
          <div className="relative shrink-0">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-white/35" />
            <input
              value={professionalSearch}
              onChange={(event) => setProfessionalSearch(event.target.value)}
              placeholder="Buscar profesional..."
              className="h-11 w-full rounded-2xl border border-white/[0.075] bg-black/35 pl-11 pr-4 text-base text-white outline-none placeholder:text-white/35 focus:border-blue-300/35 focus:ring-2 focus:ring-blue-400/10"
            />
          </div>

          <div className={cn("min-h-0 flex-1 pr-1", filteredSaleEmployees.length > 12 && "overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]")}>
            <div className={cn(
              "grid gap-2.5",
              filteredSaleEmployees.length <= 3 && "grid-cols-1",
              filteredSaleEmployees.length === 4 && "grid-cols-2",
              filteredSaleEmployees.length >= 5 && filteredSaleEmployees.length <= 6 && "grid-cols-2",
              filteredSaleEmployees.length >= 7 && "grid-cols-3 xl:grid-cols-4",
            )}>
              {filteredSaleEmployees.length === 0 ? (
                <Card className="px-4 py-8 text-center text-sm text-white/45">
                  No encontramos profesionales.
                </Card>
              ) : (
                filteredSaleEmployees.map((e: any) => {
                  const active = employeeId === e.id;
                  const avatar =
                    e.avatar_url || e.photo_url || e.image_url || e.profile_image_url;
                  return (
                    <Card
                      key={e.id}
                      onClick={() => setEmployeeId(e.id)}
                      className={cn(
                        "group cursor-pointer px-3 py-3 transition-all duration-200",
                        active
                          ? "border-blue-300/50 bg-[linear-gradient(135deg,rgba(59,130,246,0.20),rgba(8,11,20,0.94))] shadow-[0_0_28px_rgba(96,165,250,0.12)]"
                          : "hover:border-white/14 hover:bg-white/[0.035]",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/20 text-sm font-bold text-violet-100 ring-1 ring-white/10">
                          {avatar ? (
                            <img src={avatar} alt={e.name} className="h-full w-full object-cover" />
                          ) : (
                            getInitials(e.name)
                          )}
                        </div>
                        {active ? (
                          <Check className="size-4 shrink-0 text-blue-200" />
                        ) : (
                          <ArrowRight className="size-4 shrink-0 text-white/40 transition-transform group-hover:translate-x-0.5 group-hover:text-white/70" />
                        )}
                      </div>
                      <p className="mt-2 w-full break-words text-sm font-bold text-white">
                        {e.name}
                      </p>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Igual que Servicios/Pago (pasos 3 y 4): el contenido de este
              paso tiene su propio scroll interno acotado por flex-1, en vez
              de crecer libremente dentro del modal de alto fijo. Sin esto,
              con poco espacio disponible (profesional bloqueado en Panel
              del profesional, donde Cliente suele ser el primer paso
              visible) el contenido podía empujar la barra de Volver/
              Continuar fuera del área visible del modal hasta que algún
              evento (como enfocar el buscador) forzaba un recálculo del
              layout. */}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
          {/* 3. Tarjeta de confirmación — siempre visible cuando hay cliente */}
          {clientId && (
            <div className="flex items-start gap-3 rounded-2xl bg-[linear-gradient(135deg,rgba(16,185,129,0.16),rgba(6,95,70,0.16),rgba(2,6,23,0.78))] border border-emerald-400/28 px-4 py-3.5 shadow-[0_22px_55px_-42px_rgba(16,185,129,0.55)]">
              <div className="size-8 rounded-full bg-emerald-400/20 ring-1 ring-emerald-400/30 grid place-items-center shrink-0 mt-0.5">
                <Check className="size-4 text-emerald-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400/90 mb-0.5">
                  Cliente seleccionado
                </p>
                <p className="text-sm font-semibold text-foreground truncate">
                  {client}
                </p>
                <div className="flex flex-wrap gap-x-3 mt-0.5">
                  {phone && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="text-[11px]">📱</span>
                      {phone}
                    </span>
                  )}
                  {email && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground truncate">
                      <span className="text-[11px]">✉️</span>
                      {email}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setClientId(null);
                  setClient("");
                  setClientLastName("");
                  setPhone("");
                  setEmail("");
                  setBirthDate("");
                  setNewClientOpen(false);
                  setClientSearch("");
                }}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground border border-white/10 rounded-lg px-2.5 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] transition-colors mt-0.5"
              >
                Cambiar
              </button>
            </div>
          )}

          {/* 1 + 2. Buscador + resultados — solo visible si no hay cliente seleccionado */}
          {!clientId && (
            <Card className="max-h-[300px] overflow-y-auto p-4 space-y-3 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
              <p className="text-xs text-muted-foreground tracking-[0.15em] uppercase">
                Buscar cliente existente
              </p>
              <ClientAutocomplete
                value={clientSearch}
                onChange={setClientSearch}
                onPick={(c) => {
                  setClientId(c.id);
                  setClient(c.name ?? "");
                  setPhone(c.phone ?? "");
                  setEmail(c.email ?? "");
                  setBirthDate(c.birth_date ?? "");
                  setNewClientOpen(false);
                }}
                businessId={data.businessId}
              />
            </Card>
          )}

          {/* 4. Nuevo cliente — acción secundaria, oculta si ya hay cliente seleccionado */}
          {!clientId && !newClientOpen && (
            <button
              type="button"
              onClick={() => {
                setNewClientOpen(true);
                setClient("");
                setClientLastName("");
                setClientId(null);
              }}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium border border-white/15 bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.07] hover:border-white/25 transition-colors"
            >
              <Plus className="size-4" />
              Nuevo cliente
            </button>
          )}

          {/* Formulario nuevo cliente — flujo interno simplificado: teléfono
              obligatorio y principal, nombre/apellido opcionales. Sin
              mail/notas/"cómo nos conoció" acá (exclusivo de la reserva
              pública, sin tocar). Sin botones propios (Cancelar/Confirmar):
              el Continuar del pie del paso crea o reutiliza el cliente por
              teléfono y recién ahí avanza — ver goNext. Para salir de este
              formulario sin crear nada, el buscador de arriba sigue
              disponible para elegir un cliente existente en su lugar. */}
          {!clientId &&
            newClientOpen && (
                <Card className="max-h-[340px] overflow-y-auto p-4 space-y-3 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
                  <p className="text-xs text-muted-foreground tracking-[0.15em] uppercase">
                    Nuevo cliente
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={client}
                      onChange={(e) => {
                        setClient(e.target.value);
                        setClientId(null);
                      }}
                      placeholder="Nombre"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-base outline-none focus:border-blue-300/40"
                    />
                    <input
                      value={clientLastName}
                      onChange={(e) => setClientLastName(e.target.value)}
                      placeholder="Apellido"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-base outline-none focus:border-blue-300/40"
                    />
                  </div>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Teléfono *"
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-base outline-none focus:border-blue-300/40"
                  />
                </Card>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto pr-1 space-y-3 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
          <Card className="rounded-2xl border-white/[0.075] bg-[linear-gradient(135deg,rgba(255,255,255,0.04),rgba(2,6,23,0.70))] px-4 py-3 flex items-center gap-3 shadow-[0_16px_44px_-34px_rgba(0,0,0,0.85)]">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar servicio o producto..."
              className="flex-1 bg-transparent outline-none text-base placeholder:text-muted-foreground"
            />
          </Card>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs whitespace-nowrap transition-colors capitalize",
                  category === c
                    ? "border-blue-300/50 bg-blue-300/10 text-blue-200"
                    : "border-white/10 bg-white/[0.025] text-muted-foreground hover:text-foreground",
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.loading ? (
              <Card className="px-4 py-12 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
                <Loader2 className="size-4 animate-spin inline mr-2" />{" "}
                Cargando…
              </Card>
            ) : filtered.length === 0 ? (
              <Card className="px-4 py-12 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
                Sin servicios o productos en esta categoría.
              </Card>
            ) : (
              filtered.map((it) => {
                const qty = cart[it.id] ?? 0;
                const imageSrc = getCashItemImage(it);
                const noStock =
                  it.is_catalog &&
                  typeof it.stock === "number" &&
                  it.stock <= 0;
                return (
                  <Card
                    key={it.id}
                    // p-2.5 (mobile) vs p-4 (md+): en mobile la tarjeta es
                    // una sola fila (imagen / nombre+categoría / contador+
                    // precio apilados a la derecha) en vez de las dos filas
                    // de antes (imagen+nombre+precio arriba, stock+contador
                    // abajo) — bajarle el padding y sacar la fila extra es
                    // lo que realmente la hace más fina y baja, no achicar
                    // el contador (ver más abajo, mismo tamaño de botón).
                    className={cn("p-2.5 rounded-2xl border-white/[0.07] bg-[linear-gradient(145deg,rgba(8,11,20,0.94),rgba(5,8,15,0.96),rgba(2,4,12,0.98))] shadow-[0_20px_60px_-36px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:border-blue-300/24 hover:shadow-[0_26px_72px_-36px_rgba(0,0,0,1),0_0_28px_rgba(96,165,250,0.10)] transition-all duration-200 md:p-4", qty > 0 && "border-blue-300/35 bg-[linear-gradient(145deg,rgba(30,64,175,0.20),rgba(8,11,20,0.95),rgba(2,4,12,0.98))] shadow-[0_0_28px_rgba(96,165,250,0.14),0_20px_60px_-36px_rgba(0,0,0,1)]", noStock && "opacity-50")}
                  >
                    <div className="flex items-center gap-3">
                      <ServiceImage
                        src={imageSrc}
                        alt={it.name ?? "Ítem"}
                        position={it.image_position}
                        className="size-10 shrink-0 rounded-xl border border-white/[0.08] bg-[linear-gradient(135deg,rgba(96,165,250,0.10),rgba(139,92,246,0.10))] text-lg text-blue-100 shadow-[0_0_22px_rgba(96,165,250,0.10)] md:size-11"
                        fallback={<span>{it.is_catalog ? "□" : "✂"}</span>}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {it.name}
                        </p>
                        <p className="text-xs text-muted-foreground capitalize truncate">
                          {it.category ?? "ítem"}
                          {it.duration ? ` · ${it.duration} min` : ""}
                          {it.is_catalog && typeof it.stock === "number" && (
                            noStock ? (
                              <span className="text-rose-300"> · Sin stock</span>
                            ) : (
                              ` · Stock ${it.stock}`
                            )
                          )}
                        </p>
                      </div>
                      {/* Contador arriba, precio debajo — mismo bloque a la
                          derecha, apilado (antes: precio arriba junto al
                          nombre, contador abajo en su propia fila). Los
                          botones −/+ quedan exactamente del mismo tamaño
                          (size-8 = 32px) que antes: lo que se compacta es
                          el espacio alrededor, no el área táctil. */}
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <div className="flex items-center gap-1 rounded-xl border border-white/[0.10] bg-black/35 p-1 shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]">
                          <button
                            onClick={() => sub(it.id)}
                            disabled={noStock && qty === 0}
                            className="size-8 grid place-items-center rounded-lg hover:bg-white/8 text-muted-foreground hover:text-foreground"
                          >
                            <Minus className="size-3.5" />
                          </button>
                          <span className="w-6 text-center text-sm tabular-nums">
                            {qty}
                          </span>
                          <button
                            onClick={() => add(it.id)}
                            disabled={
                              noStock ||
                              (it.is_catalog &&
                                typeof it.stock === "number" &&
                                qty >= it.stock)
                            }
                            className="size-8 grid place-items-center rounded-lg hover:bg-white/8 text-foreground disabled:opacity-40"
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                        <span className="text-sm font-semibold text-foreground tabular-nums">
                          ${Number(it.price).toLocaleString("es-AR")}
                        </span>
                      </div>
                    </div>
                  </Card>
                );
              })
            )}
          </div>

          {/* Paso 3 solo selecciona qué se cobra — muestra el subtotal, sin
              descuento ni propina (eso se agrega en el Paso 4, una vez
              elegido el método de pago). */}
          {cartItems.length > 0 && (
            <Card className="rounded-2xl border-white/[0.075] bg-[linear-gradient(135deg,rgba(255,255,255,0.04),rgba(2,6,23,0.70))] px-4 py-3 shadow-[0_16px_44px_-34px_rgba(0,0,0,0.85)]">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/60">Subtotal</span>
                {listTotal !== total ? (
                  <span className="tabular-nums">
                    <span className="text-white/30 line-through">
                      ${Math.round(listTotal).toLocaleString("es-AR")}
                    </span>{" "}
                    <span className="font-extrabold text-emerald-300">
                      ${Math.round(total).toLocaleString("es-AR")}
                    </span>
                  </span>
                ) : (
                  <span className="font-extrabold text-white tabular-nums">
                    ${Math.round(total).toLocaleString("es-AR")}
                  </span>
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      {step === 4 && (
        <Card
          className={cn(
            "relative z-10 flex flex-col overflow-hidden rounded-3xl p-3 pt-0 border-white/[0.075] bg-[radial-gradient(circle_at_16%_0%,rgba(59,130,246,0.10),transparent_34%),radial-gradient(circle_at_90%_0%,rgba(139,92,246,0.12),transparent_40%),linear-gradient(135deg,rgba(3,6,14,0.98),rgba(8,9,22,0.96),rgba(1,3,10,0.99))] shadow-[0_38px_110px_-62px_rgba(0,0,0,1),0_0_70px_-48px_rgba(139,92,246,0.62)] sm:px-3.5 sm:pb-3.5",
            // variant="page": esta Card ocupa TODO el resto del alto fijo
            // del módulo (flex-1) — el bloque de "cómo se paga" de adentro
            // scrollea si hace falta, Volver/COBRAR quedan fixed aparte.
            // variant="modal" (Cobrar desde Mi Agenda/turno del
            // profesional): shrink-0, sin flex-1 — el contenedor del modal
            // ya no tiene una altura FIJA (ver más abajo, pasa a
            // max-height), así que esta Card se achica a lo que su
            // contenido realmente ocupa en vez de estirarse a llenar el
            // resto del alto disponible. Eso era justo lo que dejaba un
            // bloque vacío enorme debajo de Método de pago: el contenido
            // real medía mucho menos que el alto que "flex-1" le forzaba
            // a ocupar.
            variant === "page" ? "min-h-0 flex-1" : "shrink-0",
          )}
        >
          {/* Barra de punta a punta pegada al borde superior del módulo
              (márgenes negativos cancelan el padding del Card) — recta,
              sin puntas redondeadas propias salvo las que hacen juego con
              las esquinas superiores del Card. Arriba de todo, como en la
              referencia: primero se elige simple/múltiple, después se ve
              el resumen del cobro. Ya no "sticky": esta Card dejó de
              scrollear como bloque único (ver más abajo), así que no hay
              contenedor scrolleable del que despegarse. */}
          <div className="shrink-0 -mx-3.5 grid grid-cols-2 rounded-t-3xl border-b border-white/[0.07] bg-black/50 backdrop-blur-sm">
            <button
              onClick={() => setPaymentMode("simple")}
              className={cn(
                "py-2 text-sm font-semibold first:rounded-tl-3xl",
                paymentMode === "simple"
                  ? "bg-[linear-gradient(135deg,rgba(96,165,250,0.55),rgba(139,92,246,0.62))] text-white"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Pago simple
            </button>
            <button
              onClick={() => setPaymentMode("multiple")}
              disabled={pagoPendiente}
              title={pagoPendiente ? "No disponible con Pago pendiente activo" : undefined}
              className={cn(
                "py-2 text-sm font-semibold last:rounded-tr-3xl",
                pagoPendiente
                  ? "cursor-not-allowed text-muted-foreground/40"
                  : paymentMode === "multiple"
                    ? "bg-[linear-gradient(135deg,rgba(96,165,250,0.55),rgba(139,92,246,0.62))] text-white"
                    : "text-muted-foreground hover:text-foreground",
              )}
            >
              Pago múltiple
            </button>
          </div>

          <div className="shrink-0 pt-1.5">
          {/* Resumen arriba de todo — lo primero que se ve al entrar al
              Paso 4, antes de configurar el pago: profesional/cliente,
              servicio con precio de lista tachado + precio en efectivo, y
              Total a cobrar (reactivo, adentro de esta misma tarjeta — no
              aislado más abajo). Después Ajustes (descuento/propina,
              mismo card) y recién debajo cómo se paga. shrink-0: este
              bloque NUNCA scrollea ni se achica, siempre completo y
              visible — el único que puede llegar a scrollear es el de
              "cómo se paga", más abajo. Espaciado compactado a propósito
              (pt-1.5 pegado a las tabs, gaps chicos entre filas) para que
              en mobile entre lo más posible sin scroll, sin perder
              legibilidad ni área táctil. */}
          <Card className="rounded-2xl border-white/[0.075] bg-[linear-gradient(135deg,rgba(2,4,10,0.98),rgba(5,8,18,0.97),rgba(1,3,9,0.99))] px-3.5 py-2 space-y-1.5 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.9)]">
            <div className="space-y-1">
              <div className={cn("grid gap-x-3 gap-y-1", !lockedEmployeeId ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
                {!lockedEmployeeId && (
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <User className="size-4 shrink-0 text-white/35" />
                    <span className="min-w-0 truncate text-white">
                      <span className="text-white/45">Profesional: </span>
                      <span className="font-semibold">{selectedEmployee?.name ?? "—"}</span>
                    </span>
                  </div>
                )}
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <Users className="size-4 shrink-0 text-white/35" />
                  <span className="min-w-0 truncate text-white">
                    <span className="text-white/45">Cliente: </span>
                    <span className="font-semibold">{client || "Cliente seleccionado"}</span>
                  </span>
                </div>
              </div>

              {cartItems.length === 1 ? (
                <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-white">
                    <Scissors className="size-4 shrink-0 text-white/35" />
                    <span className="min-w-0 truncate">
                      <span className="text-white/45">Servicio: </span>
                      <span className="font-semibold">{cartItems[0].svc.name}</span>
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {listTotal !== total ? (
                      <>
                        <span className="text-white/30 line-through">
                          ${Math.round(listTotal).toLocaleString("es-AR")}
                        </span>{" "}
                        <span className="font-bold text-emerald-300">
                          ${Math.round(total).toLocaleString("es-AR")}
                        </span>
                      </>
                    ) : (
                      <span className="font-bold text-white">${Math.round(total).toLocaleString("es-AR")}</span>
                    )}
                  </span>
                </div>
              ) : cartItems.length > 1 ? (
                // Sin subtítulo "Servicios" aparte: la lista arranca
                // directo después de Cliente, con la tijera pegada al
                // primer servicio (mismo lugar que ocupaba antes el
                // ícono de la fila del título) — ahorra una fila entera
                // de alto. Las filas siguientes llevan un espaciador del
                // mismo ancho que la tijera para que el texto quede
                // alineado en columna, no la tijera en sí.
                <div className="space-y-1 border-t border-white/10 pt-1.5">
                  {(summaryExpanded ? cartItems : cartItems.slice(0, 2)).map(({ svc, qty }, idx) => {
                    const showCashPrice = isCashMethod && svc.cashPrice != null;
                    return (
                      <div key={svc.id} className="flex items-start justify-between gap-2">
                        <span className="flex min-w-0 items-start gap-2 text-xs text-white/70">
                          {idx === 0 ? (
                            <Scissors className="size-3.5 shrink-0 text-white/35" />
                          ) : (
                            <span className="size-3.5 shrink-0" aria-hidden="true" />
                          )}
                          <span className="min-w-0 break-words">
                            {svc.name}
                            {qty > 1 ? ` ×${qty}` : ""}
                          </span>
                        </span>
                        {showCashPrice ? (
                          <span className="shrink-0 whitespace-nowrap text-xs">
                            <span className="text-white/30 line-through">
                              ${Math.round(Number(svc.price) * qty).toLocaleString("es-AR")}
                            </span>{" "}
                            <span className="font-semibold text-emerald-300">
                              ${Math.round(Number(svc.cashPrice) * qty).toLocaleString("es-AR")}
                            </span>
                          </span>
                        ) : (
                          <span className="shrink-0 tabular-nums text-xs text-white/70">
                            ${Math.round(Number(svc.price) * qty).toLocaleString("es-AR")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {cartItems.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setSummaryExpanded((v) => !v)}
                      className="pl-[22px] text-xs font-semibold text-blue-300 hover:text-blue-200 transition-colors"
                    >
                      {summaryExpanded ? "Ver menos" : "Ver más"}
                    </button>
                  )}
                </div>
              ) : null}

              {/* Total a cobrar — DENTRO de la tarjeta de resumen, con más
                  jerarquía visual que el resto de las filas (fondo propio,
                  texto más grande). Reactivo: ya incluye cualquier
                  descuento/propina cargado en Ajustes, debajo. */}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-1.5">
                <span className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <Receipt className="size-3.5 text-emerald-300" /> Total a cobrar
                </span>
                <span className="tabular-nums text-base font-extrabold text-white">
                  ${Math.round(finalTotal).toLocaleString("es-AR")}
                </span>
              </div>
            </div>

            {/* Ajustes del cobro: descuento y propina, dentro del MISMO
                card que el resumen — se sienten parte de "qué estoy
                cobrando", no flotando sin contexto aparte. Acá y no en el
                Paso 3: recién elegido método de pago tiene sentido ajustar
                el cobro (el descuento manual se calcula sobre el precio YA
                resuelto según método, ver "total"). Compartido entre Pago
                simple y Pago múltiple (vive antes de la barra de tabs), así
                el monto a conciliar (finalTotal) ya los incluye antes de
                que se cargue el monto recibido o los splits. Un solo
                descuento activo (promoción O manual), la propina siempre
                aparte. Los campos quedan colapsados hasta tocar el botón —
                nunca abiertos por default. */}
            <div className="border-t border-white/10 pt-1.5">
              {/* Descuento/Propina: el botón SE CONVIERTE en un input al
                  tocarlo, sin panel desplegable debajo — una sola fila
                  compacta en los dos estados. Sin promoción/% en la UI
                  (simplificado a pedido): el input es siempre un monto $
                  fijo, aplicado sobre "total" (precio ya resuelto según
                  método de pago). Vacío o $0 vuelve a verse como el botón
                  original. manualDiscountMode se queda fijo en "fixed" (ya
                  no hay toggle %) y promotionId solo puede venir prellenado
                  de un turno con promo asociada — si eso pasa, el botón
                  queda de solo lectura con el nombre de esa promo en vez de
                  ser editable, un toque más la limpia y vuelve a manual. */}
              <div className="grid grid-cols-2 gap-1.5">
                {discountPanelOpen ? (
                  <div className="flex items-center gap-1 rounded-xl border border-violet-300/35 bg-violet-400/10 px-2.5 py-2">
                    <Tag className="size-3.5 shrink-0 text-violet-200" />
                    <span className="shrink-0 text-xs font-semibold text-violet-200/70">$</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      autoFocus
                      value={manualDiscountAmount}
                      onChange={(e) => {
                        setPromotionId("");
                        setManualDiscountAmount(e.target.value);
                      }}
                      onBlur={() => setDiscountPanelOpen(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      placeholder="0"
                      className="min-w-0 flex-1 bg-transparent text-right text-xs font-bold text-white outline-none"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => (selectedPromotion ? setPromotionId("") : setDiscountPanelOpen(true))}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition",
                      discountAmount > 0
                        ? "border-violet-300/35 bg-violet-400/10 text-violet-200"
                        : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Tag className="size-3.5 shrink-0" />
                      <span className="truncate">{discountAmount > 0 ? discountLabel : "Descuento"}</span>
                    </span>
                    {discountAmount > 0 && (
                      <span className="shrink-0">-${Math.round(discountAmount).toLocaleString("es-AR")}</span>
                    )}
                  </button>
                )}

                {tipPanelOpen ? (
                  <div className="flex items-center gap-1 rounded-xl border border-emerald-300/35 bg-emerald-400/10 px-2.5 py-2">
                    <Gift className="size-3.5 shrink-0 text-emerald-200" />
                    <span className="shrink-0 text-xs font-semibold text-emerald-200/70">$</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      autoFocus
                      value={tipAmountInput}
                      onChange={(e) => setTipAmountInput(e.target.value)}
                      onBlur={() => setTipPanelOpen(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      placeholder="0"
                      className="min-w-0 flex-1 bg-transparent text-right text-xs font-bold text-white outline-none"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTipPanelOpen(true)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition",
                      tipAmount > 0
                        ? "border-emerald-300/35 bg-emerald-400/10 text-emerald-200"
                        : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Gift className="size-3.5 shrink-0" />
                      <span className="truncate">Propina</span>
                    </span>
                    {tipAmount > 0 && (
                      <span className="shrink-0">+${Math.round(tipAmount).toLocaleString("es-AR")}</span>
                    )}
                  </button>
                )}
              </div>

              {/* Pago pendiente — deja la venta con saldo a favor del
                  negocio en vez de asumirla cobrada. Al activarlo: fuerza
                  Pago simple (un cobro parcial inicial usa un solo
                  método), reemplaza "Monto recibido"/vuelto por un campo
                  opcional "¿Cobrás algo ahora?" (ver más abajo) y la
                  validación de handleCobrar deja de exigir que el monto
                  cubra el total. El método elegido abajo sigue
                  aplicando: es el método nominal de la venta y, si se
                  cobra algo ahora, el de ese cobro puntual. No disponible
                  en "Enviar a caja" (turnoChargeMode="manual"): ahí
                  todavía no existe ningún cobro que dejar pendiente. */}
              {!isManualFlow && (
                <button
                  type="button"
                  onClick={() => {
                    setPagoPendiente((v) => {
                      const next = !v;
                      if (next) setPaymentMode("simple");
                      else setPendingCollectedInput("");
                      return next;
                    });
                  }}
                  className={cn(
                    "mt-1.5 flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition",
                    pagoPendiente
                      ? "border-amber-300/40 bg-amber-400/10 text-amber-200"
                      : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Clock className="size-3.5 shrink-0" />
                    Pago pendiente
                  </span>
                  <span className="text-[11px] font-normal opacity-80">
                    {pagoPendiente ? "Queda con saldo pendiente" : "Se cobra ahora"}
                  </span>
                </button>
              )}
            </div>
          </Card>
          </div>

          {/* variant="page": único bloque que scrollea en Paso 4, acotado a
              "cómo se paga" (método + monto recibido, o Pago múltiple).
              Resumen/Ajustes/tabs quedan shrink-0 arriba, siempre
              completos y visibles. Volver/Cobrar (fixed, más abajo) solo
              compiten por espacio con este bloque puntual, nunca con toda
              la pantalla.
              variant="modal": sin flex-1/min-h-0/overflow-y-auto propio —
              el contenedor del modal entero (max-height, no height fija)
              es el único scroll posible, y solo entra en juego si el
              contenido realmente no entra. Fluye en su alto natural en
              vez de estirarse a ocupar el resto de un alto que ya no está
              fijo. */}
          <div
            className={cn(
              "pt-1.5",
              variant === "page"
                ? "min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin] [scrollbar-color:rgba(96,165,250,0.35)_transparent]"
                : "shrink-0",
            )}
          >
          {paymentMode === "simple" ? (
            <>
              <div>
                <p className="text-[11px] tracking-[0.18em] text-muted-foreground/70 mb-1.5">
                  MÉTODO DE PAGO
                </p>
                {/* Ícono a la izquierda, nombre a la derecha, en una sola
                    fila — antes iban apilados (ícono arriba, nombre abajo),
                    lo que hacía cada tarjeta mucho más alta de lo
                    necesario. Dos filas FIJAS (no un grid uniforme que
                    reparte parejo): Efectivo/Transferencia arriba,
                    Débito/Crédito/QR abajo — mismo orden en mobile y
                    desktop. */}
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5">
                    {paymentOptions.slice(0, 2).map((m) => (
                      <PaymentMethodButton
                        key={m.id}
                        method={m}
                        active={method === m.id}
                        onClick={() => setMethod(m.id as PayMethod)}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {paymentOptions.slice(2).map((m) => (
                      <PaymentMethodButton
                        key={m.id}
                        method={m}
                        active={method === m.id}
                        onClick={() => setMethod(m.id as PayMethod)}
                      />
                    ))}
                  </div>
                </div>
              </div>
              {pagoPendiente ? (
                // Pago pendiente: reemplaza "Monto recibido"/vuelto por un
                // campo opcional "¿Cobrás algo ahora?" — vacío/"0" = la
                // venta queda 100% pendiente; cualquier otro valor (hasta
                // el total) queda como pago parcial, con el resto pendiente
                // de cobro vía Caja → Ingresar dinero → Cobrar pendiente.
                // Nunca se autocompleta con el total (mismo criterio que
                // "received" arriba).
                <div className="rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold tracking-[0.1em] text-amber-200/80">
                    ¿COBRÁS ALGO AHORA? (OPCIONAL)
                  </p>
                  <div className="relative min-w-0 flex-1">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-bold text-white/55">
                      $
                    </span>
                    <input
                      value={
                        pendingCollectedInput
                          ? Number(pendingCollectedInput).toLocaleString("es-AR")
                          : ""
                      }
                      onChange={(e) =>
                        setPendingCollectedInput(e.target.value.replace(/\D/g, "").slice(0, 9))
                      }
                      inputMode="numeric"
                      placeholder="0 = queda 100% pendiente"
                      aria-label="Monto cobrado ahora"
                      className="h-10 w-full rounded-xl border border-amber-300/30 bg-black/45 pl-8 pr-3 text-left text-lg font-extrabold tabular-nums text-white outline-none placeholder:text-xs placeholder:font-normal placeholder:text-white/30 focus:border-amber-300/65 focus:ring-2 focus:ring-amber-400/20"
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-amber-200/60">
                    Saldo pendiente: $
                    {Math.max(
                      0,
                      Math.round(subtotalAfterDiscount - (Number(pendingCollectedInput) || 0)),
                    ).toLocaleString("es-AR")}
                    {tipAmount > 0 && " (propina aparte, se cobra siempre completa)"}
                  </p>
                </div>
              ) : (
                <>
                  {method === "cash" && (
                    // Sin borde propio acá (antes tenía uno, más el del input
                    // de adentro — se veían dos círculos/bordes concéntricos).
                    // Queda solo el borde del input, el único que hace falta.
                    <div className="rounded-2xl bg-[linear-gradient(135deg,rgba(37,99,235,0.16),rgba(8,11,20,0.96),rgba(2,4,12,0.98))] p-2.5 shadow-[0_0_34px_rgba(96,165,250,0.14),0_18px_55px_-34px_rgba(0,0,0,1)]">
                      {/* Una sola fila: campo a la izquierda ($ + hint "Monto
                          recibido", visible solo mientras está vacío — nunca
                          un placeholder tipo "0" que se lea como precargado;
                          nunca se autocompleta con el total, received arranca
                          "" y solo lo cambia el usuario tipeando) y el
                          resultado a la derecha, en la MISMA fila (antes
                          quedaba en un renglón aparte debajo, agrandando el
                          bloque). Si entrega el importe exacto no se muestra
                          absolutamente nada a la derecha (ni "$0" ni
                          "Exacto") — cashShortfall y change dan 0 en ese caso
                          igual, así que alcanza con gatear el render en
                          "> 0" en vez de en receivedNumber > 0. */}
                      <div className="flex items-center gap-2">
                        {/* Valor Y hint van al mismo lado (izquierda) ahora —
                            ya no hace falta el span superpuesto de antes (que
                            existía solo para poder tener hint a la izquierda
                            + valor a la derecha con alineaciones distintas).
                            Con los dos a la izquierda alcanza con el
                            placeholder nativo, que ya se alinea solo con el
                            texto que se escribe. */}
                        <div className="relative min-w-0 flex-1">
                          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-bold text-white/55">
                            $
                          </span>
                          <input
                            // received en sí sigue guardando solo dígitos
                            // crudos ("20000") — lo único que cambia es cómo
                            // se MUESTRA (con separador de miles, mismo
                            // patrón que ya usa formatThousands en Liquidaciones
                            // y Precios/Catálogo). change/cashShortfall siguen
                            // calculando sobre Number(received), sin cambios.
                            value={received ? Number(received).toLocaleString("es-AR") : ""}
                            // Tope de 9 dígitos (hasta $999.999.999) — evita
                            // escribir un número interminable que rompa el
                            // layout o el cálculo, mismo criterio que Pago
                            // múltiple (multi-method-payment-split.tsx).
                            onChange={(e) => setReceived(e.target.value.replace(/\D/g, "").slice(0, 9))}
                            inputMode="numeric"
                            placeholder="Monto recibido"
                            aria-label="Monto recibido"
                            className="h-10 w-full rounded-xl border border-blue-300/30 bg-black/45 pl-8 pr-3 text-left text-lg font-extrabold tabular-nums text-white outline-none placeholder:text-sm placeholder:font-normal placeholder:text-white/30 focus:border-blue-300/65 focus:ring-2 focus:ring-blue-400/20"
                          />
                        </div>
                        {(cashShortfall > 0 || change > 0) && (
                          <span
                            className={cn(
                              "shrink-0 whitespace-nowrap text-sm font-bold",
                              cashShortfall > 0 ? "text-red-300" : "text-emerald-300",
                            )}
                          >
                            {cashShortfall > 0
                              ? `Falta $${cashShortfall.toLocaleString("es-AR")}`
                              : `Vuelto $${change.toLocaleString("es-AR")}`}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {method === "transfer" && (
                    <TransferReceiptField
                      previewUrl={receiptPreviewUrl}
                      onSelect={handleReceiptFileSelected}
                      onClear={clearReceiptFile}
                    />
                  )}
                </>
              )}
            </>
          ) : (
            <MultiMethodPaymentSplit
              splits={splits}
              onChange={setSplits}
              paymentOptions={paymentOptions}
              total={finalTotal}
            />
          )}
          </div>
        </Card>
      )}

      {/* Volver/COBRAR: en variant="page" (el que usa "Cobrar turno" desde
          Agenda) esta barra pasa a ser position:fixed en mobile — NO forma
          más parte del flujo normal del contenido. Rondas anteriores
          intentaron resolver esto con flex-1/min-h-0/overflow-y-auto +
          gaps (mt-auto → mt-2), pero el usuario confirmó con capturas que
          el contenedor scrolleable igual empuja/mueve la barra cuando
          aparece contenido nuevo (ej. "Vuelto" al tipear el monto
          recibido) — la contención por flexbox no alcanzaba en la
          práctica. position:fixed ancla la barra al VIEWPORT, no al
          contenido: estructuralmente no puede moverse sin importar qué
          aparezca/desaparezca arriba. bottom = calc(3.5rem +
          safe-area-inset-bottom) + 8px de margen — mismo patrón exacto
          que ya usa la nav inferior real de Clippr (MobileBottomNav,
          h-14 = 3.5rem + safe-area propio) y que reutilizan otros modales
          del código (price-catalog-section.tsx, equipo-section.tsx,
          promotions-section.tsx) — así queda pegada justo arriba de esa
          nav, nunca superpuesta ni flotando a mitad de pantalla.
          variant="modal" (usado por professionals.tsx) NO se toca acá:
          sigue en flujo normal. El espacio vacío enorme que quedaba antes
          debajo de Método de pago en esta variante no era por este
          footer — era el Card del Paso 4 estirándose con flex-1 a ocupar
          todo el alto de un contenedor con height FIJA; el fix real está
          arriba (esa Card pasa a shrink-0) y en el contenedor exterior
          (height → maxHeight), no en esta barra. */}
      <div
        className={cn(
          "z-40",
          variant === "page"
            ? "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+8px)] mx-auto w-full max-w-5xl px-3 md:px-3.5 lg:static lg:inset-auto lg:z-20 lg:mx-0 lg:w-auto lg:max-w-none lg:px-0 lg:pb-0"
            : "relative mt-2 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom,0px))]",
        )}
      >
        {/* "Total a cobrar" ya vive dentro de la tarjeta de resumen, arriba
            del todo en el Paso 4 — no se repite acá abajo. Card de fondo
            solo en mobile+variant="page" (fixed sobre contenido, necesita
            su propio fondo/blur); en flujo normal no hace falta. */}
        <div
          className={cn(
            variant === "page" && "rounded-2xl border border-white/[0.09] bg-[linear-gradient(135deg,rgba(8,11,20,0.97),rgba(4,6,14,0.98))] p-2 shadow-[0_-14px_40px_-20px_rgba(0,0,0,0.85)] backdrop-blur-xl lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none",
          )}
        >
        <div className="flex items-stretch gap-2">
          {/* Volver/Cancelar — siempre montado (nunca se saca del DOM) para
              que Continuar no se corra de lugar al llegar al primer paso:
              en variant="page" queda deshabilitado; en variant="modal" el
              primer paso visible usa Volver (cierra el modal, sigue
              siempre habilitado) y los siguientes Volver un paso atrás. */}
          {variant === "modal" ? (
            step === minStep ? (
              <button
                onClick={onCancel}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-medium border border-white/[0.075] bg-white/[0.025] text-muted-foreground hover:bg-white/[0.055] hover:text-foreground transition-all"
              >
                <ArrowLeft className="size-4" /> Volver
              </button>
            ) : (
              <button
                onClick={() => setStep((s) => (s > minStep ? ((s - 1) as 1 | 2 | 3 | 4) : s))}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-medium border border-white/[0.075] bg-white/[0.025] text-muted-foreground hover:bg-white/[0.055] hover:text-foreground transition-all"
              >
                <ArrowLeft className="size-4" /> Volver
              </button>
            )
          ) : (
            <button
              onClick={() => {
                if (step > minStep) {
                  setStep((s) => (s - 1) as 1 | 2 | 3 | 4);
                  return;
                }
                // Primer paso: Volver sale del flujo y vuelve a la
                // pantalla principal de Caja. Si ya hay algo cargado
                // (profesional, cliente o carrito) se confirma antes de
                // descartarlo — nunca se pierde en silencio.
                const hasSaleData = Boolean(
                  employeeId || clientId || client.trim() || cartItems.length > 0,
                );
                if (
                  hasSaleData &&
                  !window.confirm(
                    "¿Salir de Nueva venta? Se va a descartar lo que cargaste hasta ahora.",
                  )
                ) {
                  return;
                }
                onCancel?.();
              }}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-medium border border-white/[0.075] bg-white/[0.025] text-muted-foreground hover:bg-white/[0.055] hover:text-foreground transition-all"
            >
              <ArrowLeft className="size-4" /> Volver
            </button>
          )}

          {step < finalStep ? (
            <button
              onClick={goNext}
              disabled={!canContinue}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-2.5 text-sm font-bold text-white bg-[linear-gradient(135deg,#60A5FA,#8B5CF6)] shadow-[0_0_34px_rgba(96,165,250,0.24)] hover:-translate-y-0.5 hover:shadow-[0_0_46px_rgba(139,92,246,0.36)] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Continuar <ArrowRight className="size-4" />
            </button>
          ) : (
            <button
              disabled={
                !employeeId ||
                !clientId ||
                cartCount === 0 ||
                submitting ||
                (!isManualFlow && !pagoPendiente && paymentMode === "multiple" && splitsRemaining !== 0) ||
                (!isManualFlow && !pagoPendiente && paymentMode === "simple" && method === "cash" && cashShortfall > 0)
              }
              onClick={handleCobrar}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl px-7 py-2 text-sm font-extrabold text-white bg-[linear-gradient(135deg,#6EA8FF,#8B5CF6)] shadow-[0_0_40px_rgba(110,168,255,0.32),0_18px_45px_-28px_rgba(0,0,0,0.95)] hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_0_56px_rgba(139,92,246,0.46)] disabled:opacity-40 transition-all"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> {isManualFlow ? "Enviando…" : "Confirmando…"}
                </>
              ) : isManualFlow ? (
                <>
                  Enviar a caja <ArrowRight className="size-4" />
                </>
              ) : pagoPendiente ? (
                <>
                  {Number(pendingCollectedInput) > 0 ? "CONFIRMAR PAGO PARCIAL" : "DEJAR PENDIENTE"} <Clock className="size-4" />
                </>
              ) : (
                <>
                  COBRAR <Check className="size-4" />
                </>
              )}
            </button>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

function ClientAutocomplete({
  value,
  onChange,
  onPick,
  businessId,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (c: {
    id: string;
    name: string;
    phone: string | null;
    email?: string | null;
    birth_date?: string | null;
  }) => void;
  businessId: string | null;
}) {
  const q = value.trim().toLowerCase();
  const hasQuery = q.length >= 1;
  const [matches, setMatches] = React.useState<ClientLiteResult[]>([]);
  const [searching, setSearching] = React.useState(false);

  // Server-side search (debounced). Replaces filtering a fully-loaded list:
  // only the top matches are fetched, using the trigram indexes.
  React.useEffect(() => {
    if (!businessId || !hasQuery) {
      setMatches([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const res = await searchClientsLite(businessId, value, 8);
      if (cancelled) return;
      setMatches(res);
      setSearching(false);
      // Auto-pick a single exact phone/email match (only for longer queries).
      if (q.length >= 6) {
        const exact = res.filter(
          (c) =>
            (c.phone ?? "").replace(/\s/g, "").toLowerCase() === q ||
            (c.email ?? "").toLowerCase() === q,
        );
        if (exact.length === 1) {
          onPick(exact[0]);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, businessId]);

  return (
    <div className="space-y-2">
      {/* Search input */}
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 focus-within:border-blue-300/40">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Buscar por nombre, teléfono o email"
          className="flex-1 bg-transparent outline-none text-base placeholder:text-sm placeholder:text-muted-foreground"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-muted-foreground hover:text-foreground transition shrink-0 text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* Inline results — only shown after typing */}
      {hasQuery && (
        <div className="rounded-xl border border-white/10 bg-[oklch(0.12_0.025_282)] overflow-hidden">
          {searching ? (
            <div className="px-4 py-3 text-sm text-muted-foreground text-center">
              Buscando…
            </div>
          ) : matches.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground text-center">
              No encontramos clientes con ese dato.
            </div>
          ) : (
            <>
              <div className="px-4 py-2 border-b border-white/5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60">
                {matches.length} resultado{matches.length !== 1 ? "s" : ""}
              </div>
              {matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onPick(c);
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-white/[0.05] flex items-center justify-between gap-3 border-b border-white/5 last:border-0 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground truncate">
                      {c.name}
                    </span>
                    {c.email && (
                      <span className="block text-xs text-muted-foreground truncate">
                        {c.email}
                      </span>
                    )}
                  </span>
                  {c.phone && (
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {c.phone}
                    </span>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
