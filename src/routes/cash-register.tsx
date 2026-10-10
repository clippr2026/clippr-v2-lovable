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
  cajaTimeLabel,
  cajaHoraDisplay,
  cajaEventTimeToMinutes,
  sortCajaEventos,
  getCajaLastEvent,
  getCajaFirstEvent,
  buildCierreSnapshotForDate,
  findPendingCierre,
  closeCierreForDate,
  closeOpenCajaSession,
  normalizeCierreMethodKey,
  getCajaAbiertaDesde,
  type ExpectedCashDigital,
} from "@/lib/caja-cierre";
import { useCashMovements, type CashMovement } from "@/hooks/use-cash-movements";
import { useCajaSummary } from "@/hooks/use-caja-summary";
import { supabase } from "@/integrations/supabase/client";
import {
  useCajaData,
  searchClientsLite,
  notifyCajaPendientesChanged,
  type ClientLiteResult,
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
import { fetchSettlementRunServices } from "@/hooks/use-professionals-data";
import { MultiMethodPaymentSplit, type MultiSplit } from "@/components/cash-register/multi-method-payment-split";
import { buildHistorialMovimientos, type MovimientoAjuste, type MovimientoDeduccion } from "@/lib/historial-movimientos";
import { displayResponsable } from "@/components/liquidaciones/movimiento-format";
import {
  PagoDetalleContent,
  AjusteDetalleContent,
  DeduccionDetalleContent,
} from "@/components/liquidaciones/movimiento-detalle-content";

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
function cleanSearchParam(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return undefined;
  return trimmed;
}

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
    const totalGastos = summary.expensesToday.reduce((s, e) => s + Number(e.amount ?? 0), 0);
    return {
      ...cajaData,
      revHoy: summary.revHoy,
      cobros: summary.cobros,
      ticket: summary.cobros > 0 ? Math.round(summary.revHoy / summary.cobros) : 0,
      totalGastos,
      paymentsToday: summary.paymentsToday,
      expensesToday: summary.expensesToday,
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
    search.depositAppointmentId || search.appointmentId ? "nueva" : "resumen",
  );
  const [pendingToCharge, setPendingToCharge] = useState<
    ReturnType<typeof useCajaData>["pendingCharges"][number] | null
  >(null);

  const routePendingCharge = React.useMemo<
    ReturnType<typeof useCajaData>["pendingCharges"][number] | null
  >(() => {
    if (!search.appointmentId) return null;

    const totalFromSearch = Number(
      search.finalAmount ?? search.totalPrice ?? 0,
    );
    return {
      id: search.appointmentId,
      client_name: search.clientName ?? null,
      service_name: search.serviceName ?? null,
      service_price:
        Number.isFinite(totalFromSearch) && totalFromSearch > 0
          ? totalFromSearch
          : null,
      employee_id: search.employeeId ?? null,
      starts_at: new Date().toISOString(),
      notes: null,
      status: "confirmed",
    };
  }, [
    search.appointmentId,
    search.clientName,
    search.serviceName,
    search.finalAmount,
    search.totalPrice,
    search.employeeId,
  ]);

  const activePendingCharge = pendingToCharge ?? routePendingCharge;

  // Instant lock — set to true the moment confirmar() succeeds, no need to wait for refresh
  const [cajaCerrada, setCajaCerrada] = useState(false);
  const [showClosedHistory, setShowClosedHistory] = useState(false);
  const [reopeningCaja, setReopeningCaja] = useState(false);
  // Caja vencida: día anterior con actividad que nunca se cerró. null =
  // no hay nada pendiente (caja al día). Nunca se cierra solo — ver
  // findPendingCierre/closeCierreForDate.
  const [pendingCierre, setPendingCierre] = useState<{ date: string; cierreId: string | null } | null>(null);

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
      // es estado local en memoria, sin esto se perdía al recargar) y si
      // quedó algún día anterior sin cerrar ("Caja vencida").
      let todayQuery = supabase
        .from("caja_cierres" as any)
        .select("estado")
        .eq("business_id", data.businessId)
        .eq("fecha", cajaDateKey());
      if (data.activeBranchId) todayQuery = todayQuery.eq("branch_id", data.activeBranchId);
      const { data: todayCierre } = await todayQuery.maybeSingle();
      if (!cancelled && isCajaCerradaRow(todayCierre)) setCajaCerrada(true);

      try {
        const pending = await findPendingCierre(data.businessId, data.activeBranchId);
        if (!cancelled) setPendingCierre(pending);
      } catch (error) {
        console.warn(error);
      }
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

  // Reabrir NUNCA muta la fila cerrada de caja_cierres de vuelta a
  // 'reabierta' — eso fue el bug que duplicaba los ingresos (una caja
  // vencida de varios días quedaba "reabierta" con su fecha vieja para
  // siempre). caja_cierres queda como snapshot histórico, intacto;
  // reopened_at/reopened_by se escriben ahí solo como auditoría. El
  // período operativo real nace de reopenCashSession(), que SIEMPRE crea
  // una cash_session nueva con opened_at = now().
  async function handleReabrirCajaDesdeBanner() {
    if (reopeningCaja) return;

    if (!data.businessId || !session?.user?.id) {
      setCajaCerrada(false);
      data.refresh();
      return;
    }

    setReopeningCaja(true);

    try {
      let lastCierreQuery = supabase
        .from("caja_cierres" as any)
        .select("id,eventos,estado")
        .eq("business_id", data.businessId);
      if (data.activeBranchId) lastCierreQuery = lastCierreQuery.eq("branch_id", data.activeBranchId);
      const { data: lastCierre, error } = await lastCierreQuery
        .order("fecha", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      const now = new Date();
      const user = session.user.email ?? session.user.id;

      // Auditoría sobre la fila histórica (si la hay) — nunca toca estado
      // (caja_cierres no vuelve a 'reabierta'), pero SÍ agrega el evento
      // "reapertura" a `eventos`: es lo que le permite a un segundo cierre
      // el mismo día (cerrar → reabrir → cobrar → cerrar) saber que hay
      // algo nuevo que cerrar — ver el chequeo "último evento" en
      // CierreCajaBtn.confirmar().
      if ((lastCierre as any)?.id && isCajaCerradaRow(lastCierre)) {
        const reaperturaEvento = {
          tipo: "reapertura",
          fecha_hora: now.toISOString(),
          hora: cajaTimeLabel(now),
          usuario: user,
          motivo: null,
        };
        await supabase
          .from("caja_cierres" as any)
          .update({
            reopened_at: now.toISOString(),
            reopened_by: user,
            eventos: appendCajaEvento((lastCierre as any).eventos, reaperturaEvento),
          })
          .eq("id", (lastCierre as any).id)
          .eq("business_id", data.businessId);
      }

      await reopenCashSession({
        businessId: data.businessId,
        branchId: data.activeBranchId,
        reopenedBy: user,
        previousSessionId: (lastCierre as any)?.id ?? null,
      });

      toast.success("Caja reabierta");
      window.dispatchEvent(new CustomEvent("clippr:caja-cierre-guardado"));
    } catch (e: any) {
      console.warn(e);
      toast.error(e?.message ?? "No se pudo registrar la reapertura");
    } finally {
      setReopeningCaja(false);
      setCajaCerrada(false);
      setShowClosedHistory(false);
      await data.refresh();
    }
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
              if (t !== "nueva") setPendingToCharge(null);
              setTab(t);
            }}
            data={data}
            userEmail={session.user.email ?? null}
            onCajaCerrada={() => {
              setCajaCerrada(true);
              setShowClosedHistory(false);
              setPendingToCharge(null);
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
                setTab("nueva");
              }}
              onNuevoGasto={() => {
                setPendingToCharge(null);
                setTab("nuevo-gasto");
              }}
              userEmail={session.user.email ?? null}
              expected={expected}
              movementsData={movementsData}
              cajaAbiertaDesde={cajaAbiertaDesdeLabel}
              cajaRangeStartDate={cajaAbiertaDesdeFecha}
              onCajaCerrada={() => {
                setCajaCerrada(true);
                setShowClosedHistory(false);
                setPendingToCharge(null);
                setTab("resumen");
              }}
            />
          )}
          {tab === "nuevo-gasto" && (
            <NuevoGastoTab
              data={data}
              userEmail={session.user.email ?? null}
              onCancel={() => setTab("resumen")}
              onSaved={() => {
                data.refresh();
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
                setTab("resumen");
              }}
              onPendingDone={() => {
                setPendingToCharge(null);
                setTab("resumen");
              }}
              onSaleDone={() => {
                setPendingToCharge(null);
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
  movementsData,
  cajaAbiertaDesde,
  cajaRangeStartDate,
  onCajaCerrada,
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
  movementsData: ReturnType<typeof useCashMovements>;
  cajaAbiertaDesde: string;
  cajaRangeStartDate: string;
  onCajaCerrada: () => void;
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
            expected={expected}
            movementsData={movementsData}
            userEmail={userEmail}
            cajaAbiertaDesde={cajaAbiertaDesde}
            cajaRangeStartDate={cajaRangeStartDate}
            onCajaCerrada={onCajaCerrada}
            onCobrarPendiente={onCobrarPendiente}
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
    const unitPrice = Number(item.price ?? item.cash_discount ?? 0) || 0;
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
          const unitPrice = Number(stockAdjustment.item?.price ?? stockAdjustment.item?.cash_discount ?? 0) || 0;
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
                          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                            ¿Cómo se registra?
                          </label>
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

// Ícono de información chico junto a un título — no existe nada parecido
// en este codebase (sin Tooltip/Popover instalado), así que es un
// wrapper propio: onClick lo abre/cierra (cubre el tap en mobile),
// onMouseEnter/onMouseLeave también (cubre el hover en desktop sin
// necesitar click), y un listener de click afuera lo cierra en ambos
// casos. Una X chica adentro como cierre de respaldo.
function InfoPopover({ text }: { text: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  // matchMedia("hover: hover") — no window.onMouseEnter/onMouseLeave para
  // abrir en dispositivos táctiles: ahí un tap dispara un mouseenter
  // sintético ANTES del click, así que abrir-por-hover + togglear-por-click
  // se cancelaban entre sí en el mismo toque (el bug reportado: "aparece
  // pero no pasa nada"). En desktop real sí se permite hover.
  const supportsHover = React.useRef(false);
  React.useEffect(() => {
    supportsHover.current =
      typeof window !== "undefined" && window.matchMedia?.("(hover: hover)").matches;
  }, []);

  const updatePosition = React.useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // El panel mide w-56 (224px, mitad 112) — se centra en el ícono pero
    // sin dejar que se corte contra el borde de la pantalla en mobile.
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
      if (
        !buttonRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    // capture:true en scroll para detectar el scroll DENTRO de un modal
    // (overflow-y-auto), no solo el de la ventana.
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
        // -m-2 sobre size-8 (32px, el mínimo táctil pedido) sin empujar el
        // layout del título — el ícono visual sigue siendo de 3.5 (14px).
        className="-m-2 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-white/32 transition hover:text-white/65"
      >
        <Info className="size-3.5" />
      </button>
      {/* Portal a document.body: esta tarjeta vive dentro de secciones con
          overflow-hidden/overflow-y-auto (la sección principal y el modal
          de Preparar liquidación) — sin portal, el popover quedaba
          recortado por ese overflow y parecía que "no pasaba nada" al
          tocar el ícono. Mismo problema, mismo remedio que
          AgendaCenteredModal (agenda-drawer.tsx). */}
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
            <div className="pr-4 text-[11px] font-normal leading-relaxed tracking-normal text-white/70">
              {text}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}

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
  const today = React.useMemo(() => new Date().toLocaleDateString("sv-SE"), []);
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
  const [allRuns, setAllRuns] = React.useState<any[]>([]);
  const [allRunPayments, setAllRunPayments] = React.useState<any[]>([]);
  const [allAdvances, setAllAdvances] = React.useState<any[]>([]);
  const [commissionsVersion, setCommissionsVersion] = React.useState(0);

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
        const { data: rows, error } = await supabase
          .from("commission_records" as any)
          .select(
            "id,professional_id,amount,paid_amount,pending_amount,status,sale_date,created_at,commission_pct,settlement_run_id,sale_id",
          )
          .eq("business_id", businessId);
        if (error) throw error;
        if (!cancelled) {
          setAllCommissions(rows ?? []);
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
        const { data: rows, error } = await supabase
          .from("tip_records" as any)
          .select("id,professional_id,amount,paid_amount,pending_amount,status,sale_date,created_at,settlement_run_id,sale_id")
          .eq("business_id", businessId);
        if (error) throw error;
        if (!cancelled) {
          setAllTips(rows ?? []);
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
        const [runsRes, paymentsRes] = await Promise.all([
          supabase
            .from("settlement_runs" as any)
            .select(
              "id,professional_id,professional_name,run_number,cutoff_date,period_start,period_start_at,previous_settlement_run_id,previous_balance,new_commissions,new_tips,adjustments,deductions,advances,adjustment_items,deduction_items,adjustment_movement_number,adjustment_movement_id,deduction_movement_number,deduction_movement_id,total_to_settle,amount_paid,service_count,total_sold,status,prepared_by_name,prepared_at",
            )
            .eq("business_id", businessId)
            .order("cutoff_date", { ascending: false }),
          supabase
            .from("settlement_payments" as any)
            .select(
              "id,settlement_run_id,professional_id,amount,payment_method,note,balance_before,balance_after,paid_by_name,paid_at,movement_number",
            )
            .eq("business_id", businessId)
            .order("paid_at", { ascending: false }),
        ]);
        if (runsRes.error) throw runsRes.error;
        if (paymentsRes.error) throw paymentsRes.error;
        if (!cancelled) {
          setAllRuns(runsRes.data ?? []);
          setAllRunPayments(paymentsRes.data ?? []);
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
        const { data: rows, error } = await supabase
          .from("professional_advances" as any)
          .select(
            "id,professional_id,amount,payment_method,note,advanced_at,registered_by_name,settlement_run_id,movement_number",
          )
          .eq("business_id", businessId)
          .order("advanced_at", { ascending: false });
        if (error) throw error;
        if (!cancelled) setAllAdvances(rows ?? []);
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

  const rows = React.useMemo(() => {
    return (data.employees ?? []).map((employee: any) => {
      const employeeCommissions = allCommissions.filter(
        (c: any) => String(c.professional_id) === String(employee.id),
      );
      // Pendiente total: TODA la deuda real, sin importar si la comisión ya
      // quedó bloqueada dentro de una liquidación preparada — solo cambia
      // cuando se genera una comisión nueva o se registra un pago.
      const pending = employeeCommissions.reduce(
        (sum: number, c: any) => sum + Number(c.pending_amount ?? 0),
        0,
      );

      // Orden por prepared_at (marca exacta), no por cutoff_date (date) —
      // con el corte automático "ahora", varias liquidaciones del mismo
      // profesional pueden caer en la misma fecha.
      const employeeRuns = allRuns
        .filter((r: any) => String(r.professional_id) === String(employee.id))
        .sort((a: any, b: any) => String(b.prepared_at ?? "").localeCompare(String(a.prepared_at ?? "")));
      const latestRun = employeeRuns[0] ?? null;
      const previousBalance = latestRun
        ? Math.max(Number(latestRun.total_to_settle) - Number(latestRun.amount_paid), 0)
        : 0;

      // Comisiones nuevas: generadas después de la marca de tiempo EXACTA
      // de la última liquidación (no del día siguiente) y todavía sin
      // asignar a ningún run — así una comisión de esa misma tarde, unas
      // horas después del corte, entra en la próxima liquidación en vez
      // de perderse o quedar mezclada con la anterior.
      const periodStartAt: string | null = latestRun?.prepared_at ?? null;
      const periodStart: string | null = periodStartAt
        ? new Date(periodStartAt).toLocaleDateString("sv-SE")
        : null;
      // Solo deuda real (pending_amount, no amount): una comisión con
      // pagos históricos ya aplicados (de antes de este sistema) no debe
      // volver a contar como "nueva" por su monto bruto.
      const unlockedSincePeriodStart = employeeCommissions.filter(
        (c: any) =>
          !c.settlement_run_id &&
          (!periodStartAt || String(c.created_at ?? "") > periodStartAt) &&
          Number(c.pending_amount ?? 0) > 0,
      );
      const newCommissions = unlockedSincePeriodStart.reduce(
        (sum: number, c: any) => sum + Number(c.pending_amount ?? 0),
        0,
      );

      // Adelantos todavía no incluidos en ninguna liquidación — se
      // descuentan del total a pagar (ver prepare_settlement_run).
      const pendingAdvances = allAdvances
        .filter((a: any) => String(a.professional_id) === String(employee.id) && !a.settlement_run_id)
        .reduce((sum: number, a: any) => sum + Number(a.amount ?? 0), 0);

      return {
        id: String(employee.id),
        name: employee.name ?? "Profesional",
        role: employee.role ?? employee.position ?? "Profesional",
        pending,
        previousBalance,
        newCommissions,
        pendingAdvances,
        periodStart,
        periodStartAt,
        latestRun,
        commissionPct: Number(employee.commission_pct ?? 0),
      };
    });
  }, [data.employees, allCommissions, allRuns, allAdvances]);

  const selectedRow = React.useMemo(() => {
    return rows.find((row) => row.id === selectedEmployeeId) ?? null;
  }, [rows, selectedEmployeeId]);

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
      let query = supabase
        .from("commission_records" as any)
        .select("id,amount,pending_amount,commission_pct,sale_date,created_at,status,sale_id")
        .eq("business_id", businessId)
        .eq("professional_id", professionalId)
        .is("settlement_run_id", null)
        .gt("pending_amount", 0)
        .lte("created_at", liquidarCutoffAt.toISOString());
      if (row?.periodStartAt) {
        query = query.gt("created_at", row.periodStartAt);
      }
      const { data: commissionRows, error } = await query.order("created_at", { ascending: true });
      if (error) throw error;
      const saleIds = (commissionRows ?? [])
        .map((c: any) => c.sale_id)
        .filter(Boolean);
      let paymentsById: Record<string, any> = {};
      if (saleIds.length > 0) {
        const { data: pays, error: payError } = await supabase
          .from("payments" as any)
          .select(
            "id,client_name,service_name,total,amount,method,payment_method,created_at,discount,original_amount,promotion_id,promotion_name,tip_amount,items",
          )
          .in("id", saleIds);
        if (payError) throw payError;
        paymentsById = Object.fromEntries((pays ?? []).map((p: any) => [p.id, p]));
      }
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
      let catalogPriceByName: Record<string, number> = {};
      if (missingListPriceNames.length > 0) {
        const { data: catalogByName, error: catalogByNameError } = await supabase
          .from("price_catalog" as any)
          .select("name,price")
          .eq("business_id", businessId)
          .in("name", missingListPriceNames);
        if (catalogByNameError) throw catalogByNameError;
        catalogPriceByName = Object.fromEntries(
          (catalogByName ?? []).map((r: any) => [String(r.name ?? "").trim(), Number(r.price ?? 0)]),
        );
      }
      setDetailRows(
        (commissionRows ?? []).map((c: any) => {
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
              const byName = catalogPriceByName[String(sale.service_name ?? "").trim()] ?? null;
              if (byName != null && byName > 0) listPriceFallback = byName;
            }
          }
          return { ...c, sale, listPriceFallback };
        }),
      );
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
      const rows = await fetchSettlementRunServices(run.id);
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

  // Movimientos es un timeline único — pagos de liquidación (agrupados por
  // movement_number: un pago múltiple con varios métodos es UNA sola
  // card), adelantos, ajustes y deducciones, mezclados y ordenados por
  // fecha.
  const historialItems = React.useMemo(
    () => buildHistorialMovimientos(selectedRunPayments, selectedAdvances, selectedRuns),
    [selectedRunPayments, selectedAdvances, selectedRuns],
  );

  // Lista única de Liquidaciones: ventas con comisión (detailRows) +
  // pagos/adelantos/ajustes/deducciones (historialItems), mezclados y
  // ordenados por fecha — reemplaza las pestañas "Comisiones"/"Movimientos"
  // de antes, que mostraban las dos fuentes por separado.
  const unifiedMovimientos = React.useMemo(() => {
    const ventaItems = (detailRows ?? []).map((c: any) => ({
      kind: "venta" as const,
      at: c.created_at as string,
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
    const adjustments = validAdjustments.reduce((sum, i) => sum + i.amount, 0);
    const deductions = validDeductions.reduce((sum, i) => sum + i.amount, 0);
    // Usa los totales recalculados para el corte elegido (liquidarCutoffAt),
    // no row.newCommissions/pendingAdvances (que siempre reflejan "ahora").
    const total = row.previousBalance + liquidarNewCommissions + adjustments - deductions - liquidarPendingAdvances;
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

  // Reloj para que liquidarCutoffAt (y todo lo que depende de "ahora")
  // se actualice solo cada minuto mientras el corte elegido sea "hoy".
  const [nowClock, setNowClock] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNowClock(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

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

  // Corte elegido para "Pagar" — vacío (o == hoy) significa "ahora mismo"
  // (mismo comportamiento de siempre, se recalcula solo con nowClock). Si
  // se elige un día anterior, el corte pasa a ser las 23:59:59.999 de ESE
  // día: el día elegido queda completo adentro, lo generado desde el
  // día siguiente 00:00 en adelante queda pendiente para la próxima vez.
  const liquidarCutoffAt = React.useMemo(() => {
    if (!liquidarCutoffDate || liquidarCutoffDate === today) return nowClock;
    return new Date(`${liquidarCutoffDate}T23:59:59.999`);
  }, [liquidarCutoffDate, today, nowClock]);

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


  const StatCard = ({
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
  }) => {
    const toneClass = {
      neutral:
        "border-white/[0.075] bg-white/[0.025] text-white shadow-[0_0_28px_rgba(255,255,255,0.035)]",
      violet:
        "border-violet-300/18 bg-violet-400/[0.055] text-violet-300 shadow-[0_0_28px_rgba(167,139,250,0.10)]",
      green:
        "border-emerald-400/18 bg-emerald-400/[0.055] text-emerald-300 shadow-[0_0_28px_rgba(34,197,94,0.09)]",
      rose: "border-rose-400/18 bg-rose-400/[0.055] text-rose-300 shadow-[0_0_28px_rgba(251,113,133,0.10)]",
    }[tone];

    const labelClass = {
      neutral: "text-white/38",
      violet: "text-violet-200/70",
      green: "text-emerald-200/70",
      rose: "text-rose-200/70",
    }[tone];

    return (
      <div className={cn("rounded-2xl border px-3.5 py-2.5", toneClass, className)}>
        <div
          className={cn(
            "flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em]",
            labelClass,
          )}
        >
          <span>{label}</span>
          {info && <InfoPopover text={info} />}
        </div>
        {sublabel && (
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/30">
            {sublabel}
          </div>
        )}
        <div className="mt-0.5 text-lg font-bold tabular-nums">{value}</div>
      </div>
    );
  };

  // Una fila de venta con comisión dentro de la lista única de
  // Liquidaciones — mismo contenido que antes mostraba la pestaña
  // "Comisiones", ahora autocontenida (desktop + mobile en un solo bloque,
  // como cualquier otro ítem de la lista) para poder intercalarse
  // cronológicamente con pagos/adelantos/ajustes/deducciones.
  // Grilla compartida por TODAS las filas de la lista única de
  // Liquidaciones (ventas, adelantos, pagos, ajustes, deducciones) y por su
  // encabezado — mismas 7 columnas siempre: Fecha y hora | Cliente |
  // Concepto | Precio | Comisión | Propina | Medio de pago.
  const LIQ_GRID_COLS =
    "grid-cols-[116px_minmax(100px,1fr)_minmax(130px,1.1fr)_100px_100px_100px_minmax(90px,1fr)]";

  const VentaRow = ({ c }: { c: any }) => {
    const sale = c.sale ?? {};
    const saleDate = c.created_at ? new Date(c.created_at) : null;
    // Una sola línea ("01/10 · 23:27"), no fecha arriba y hora abajo —
    // sobra espacio horizontal en la columna.
    const dateTime = saleDate
      ? `${saleDate.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })} · ${saleDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}`
      : "—";
    const method =
      PAY_METHOD_LABEL[String(sale.method ?? sale.payment_method ?? "") as PayMethod] ??
      sale.method ??
      sale.payment_method ??
      "—";
    const saleTotal = Number(sale.total ?? sale.amount ?? 0);
    const hasTip = Number(sale.tip_amount ?? 0) > 0;
    const hasDiscount = Number(sale.discount ?? 0) > 0;
    // Prioridad del precio de lista a tachar: original_amount guardado en
    // el momento real de la venta (promoción, descuento manual O precio en
    // efectivo sin descuento explícito — ver register-payment.ts): si no
    // existe (venta vieja, de antes de este cambio), cae al precio ACTUAL
    // del catálogo (listPriceFallback, resuelto en openDetail) solo como
    // aproximación visual — nunca pisa un original_amount real.
    const storedOriginal = Number(sale.original_amount ?? 0);
    const originalAmount =
      storedOriginal > 0 ? storedOriginal : Number(sale.listPriceFallback ?? saleTotal);
    const hasReduction = originalAmount > saleTotal;
    const totalCobrado = saleTotal + Number(sale.tip_amount ?? 0);
    // Distingue POR QUÉ bajó el precio, usando los mismos campos reales que
    // ya usa el resto de la app (register-payment.ts): promotion_id = la
    // venta pasó por una promoción real (nombre en promotion_name);
    // promotion_name sin promotion_id = motivo de un descuento manual
    // (ej. "Cortesía"); ninguno de los dos pero hasReduction = precio en
    // efectivo sin ningún descuento explícito. Nunca inventa una regla
    // nueva, solo lee lo que ya se guarda.
    const promoLabel = sale.promotion_id && sale.promotion_name
      ? (/^promo\b/i.test(String(sale.promotion_name))
          ? `Descuento ${sale.promotion_name}`
          : `Descuento promo ${sale.promotion_name}`)
      : null;
    const manualDiscountLabel = !sale.promotion_id && hasDiscount ? sale.promotion_name : null;
    const conceptSubtitle = promoLabel ?? manualDiscountLabel ?? (hasReduction ? "Descuento en efectivo" : null);
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
              {hasReduction ? (
                <div>
                  <div className="text-[11px] text-white/35 line-through">{money(originalAmount)}</div>
                  <div>{money(saleTotal)}</div>
                </div>
              ) : (
                money(saleTotal)
              )}
              {(hasReduction || hasTip) && (
                <InfoPopover
                  text={
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white/60">Precio original</span>
                        <span className="font-semibold text-white">{money(originalAmount)}</span>
                      </div>
                      {hasDiscount && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-white/60">{sale.promotion_name || "Descuento"}</span>
                          <span className="font-semibold text-rose-300">-{money(Number(sale.discount))}</span>
                        </div>
                      )}
                      {hasTip && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-white/60">Propina</span>
                          <span className="font-semibold text-emerald-300">
                            +{money(Number(sale.tip_amount))}
                          </span>
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
                {hasReduction ? (
                  <>
                    <span className="text-white/30 line-through">{money(originalAmount)}</span>{" "}
                    {money(saleTotal)}
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
  };

  // Fila genérica para Adelanto/Pago/Ajuste/Deducción dentro de la misma
  // lista única — mismas 7 columnas que VentaRow (Comisión/Medio de pago
  // no aplican a estos movimientos, quedan en "—"). "Detalles" es clickeable
  // (ChevronDown) y expande el mismo panel de siempre debajo de la fila.
  const MovRow = ({
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
    // tiene sentido que se pueda "abrir": se queda con la info que ya
    // tiene la fila, sin chevron ni modal.
    clickable?: boolean;
    // Adelanto pide celdas vacías en blanco, no "—" (Cliente/Comisión/
    // Propina/Medio de pago no aplican en absoluto, a diferencia de un
    // movimiento donde "—" sí tiene sentido como "no corresponde").
    emptyFiller?: string;
    // Solo Adelanto lo usa por ahora — borrar un adelanto cargado por
    // error (ej. una prueba), siempre que no esté ya liquidado.
    onDelete?: () => void;
    deleting?: boolean;
  }) => {
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
        {clickable && expanded && (
          <div className="border-t border-white/[0.06] bg-white/[0.015] px-3.5 py-3 sm:px-4">
            {loadingThis ? <div className="py-4 text-center text-xs text-white/45">Cargando…</div> : detail}
          </div>
        )}
      </div>
    );
  };

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
    const cutoffIso = liquidarCutoffAt.toISOString();
    return allCommissions
      .filter(
        (c: any) =>
          String(c.professional_id) === selectedRow.id &&
          !c.settlement_run_id &&
          (!periodStartAt || String(c.created_at ?? "") > periodStartAt) &&
          String(c.created_at ?? "") <= cutoffIso &&
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
    const cutoffIso = liquidarCutoffAt.toISOString();
    return allTips
      .filter(
        (t: any) =>
          String(t.professional_id) === selectedRow.id &&
          !t.settlement_run_id &&
          (!periodStartAt || String(t.created_at ?? "") > periodStartAt) &&
          String(t.created_at ?? "") <= cutoffIso &&
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
                // tarjetas visibles para que no queden huecos.
                2 + (totals.previousBalance > 0 ? 1 : 0) + (liquidarNewTips > 0 ? 1 : 0) >= 4
                  ? "sm:grid-cols-4"
                  : totals.previousBalance > 0 || liquidarNewTips > 0
                    ? "sm:grid-cols-3"
                    : "sm:grid-cols-2",
              )}
            >
              <StatCard
                label="Comisiones generadas"
                sublabel={totals.previousBalance > 0 ? "Período actual" : undefined}
                value={money(liquidarNewCommissions)}
                tone="violet"
                info={COMISIONES_NUEVAS_INFO_TEXT}
              />
              {totals.previousBalance > 0 && (
                <StatCard
                  label="Comisiones pendientes"
                  sublabel="Período anterior"
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
              <StatCard
                label="Adelantos"
                value={liquidarPendingAdvances > 0 ? `−${money(liquidarPendingAdvances)}` : money(0)}
                tone="rose"
                info={ADELANTOS_INFO_TEXT}
              />
            </div>

            {/* Total a pagar: mayor jerarquía visual que el resto de las
                tarjetas (más grande, tono propio) y con Adelantar/Pagar
                integrados en la misma zona — Pagar queda pegado al total,
                en vez de una barra de botones flotante aparte. sticky:
                queda siempre visible arriba a la derecha aunque se haga
                scroll en la lista de abajo. */}
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
                  onClick={() => setAdelantoModalOpen(true)}
                  className="rounded-xl bg-rose-500 px-3 py-2 text-xs font-bold text-white shadow-[0_0_18px_rgba(244,63,94,0.26)] transition hover:brightness-110"
                >
                  Adelantar
                </button>
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

            {/* Lista única: ventas con comisión + pagos/adelantos/ajustes/
                deducciones, mezclados y ordenados por fecha — ya no hay
                pestañas Comisiones/Movimientos separadas. */}
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
                  {/* Encabezado fijo (solo desktop): mismas 7 columnas que
                      TODAS las filas de la lista (venta, adelanto, pago,
                      ajuste, deducción) — sticky arriba del todo al hacer
                      scroll. */}
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
                  {unifiedMovimientos.map((item: any) => {
                    if (item.kind === "venta") {
                      return <VentaRow key={`venta-${item.commission.id}`} c={item.commission} />;
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
                    return (
                      <MovRow
                        key={`pago-${item.movementNumber ?? item.splits[0].id}`}
                        dateTime={dateTime}
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
                            />
                          ) : null
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
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

function CierreCajaBtn({
  paymentsToday,
  expensesToday,
  pendingCharges,
  businessId,
  branchId,
  userEmail,
  onCajaCerrada,
  cajaAbiertaDesde,
  cajaRangeStartDate,
  expected,
}: {
  paymentsToday: ReturnType<typeof useCajaData>["paymentsToday"];
  expensesToday: ReturnType<typeof useCajaData>["expensesToday"];
  pendingCharges: ReturnType<typeof useCajaData>["pendingCharges"];
  businessId: string | null;
  branchId: string | null;
  userEmail: string | null;
  onCajaCerrada: () => void;
  cajaAbiertaDesde: string;
  // Fecha (YYYY-MM-DD) que identifica la fila de caja_cierres a cerrar —
  // la de apertura real, NO necesariamente "hoy" (una caja vencida sigue
  // abierta desde un día anterior; cerrarla tiene que actualizar ESA fila,
  // no crear una nueva para hoy). Mismo criterio que closeCierreForDate.
  cajaRangeStartDate: string;
  // Efectivo/Dinero esperado — calculado una sola vez en CashRegisterPage
  // (computeExpectedCashAndDigital + carry-forward de cuenta) y pasado por
  // prop a los dos lugares que cierran caja (acá y Facturación), para que
  // nunca haya dos fuentes del mismo saldo.
  expected: ExpectedCashDigital;
}) {
  const [open, setOpen] = useState(false);
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  const [efectivoContado, setEfectivoContado] = useState("");
  const [contadoTouched, setContadoTouched] = useState(false);
  const [saldoReal, setSaldoReal] = useState("");
  const [saldoRealTouched, setSaldoRealTouched] = useState(false);

  const totalCobrado = paymentsToday.reduce(
    (s, p) => s + Number((p as any).total ?? (p as any).amount ?? 0),
    0,
  );
  const totalGastos = expensesToday.reduce(
    (s, e) => s + Number((e as any).amount ?? 0),
    0,
  );
  const utilidad = totalCobrado - totalGastos;

  const detalleMetodos = useMemo(() => {
    const detail: Record<string, CierreMetodoDetalle> = {};
    const ensure = (method: string | null | undefined) => {
      const key = normalizeCierreMethodKey(method);
      if (!detail[key]) detail[key] = { ingresos: 0, gastos: 0, utilidad: 0 };
      return detail[key];
    };

    for (const p of paymentsToday) {
      const row = ensure((p as any).method ?? (p as any).payment_method);
      row.ingresos += Number((p as any).total ?? (p as any).amount ?? 0);
    }

    for (const e of expensesToday) {
      const row = ensure((e as any).payment_method ?? (e as any).method);
      row.gastos += Number((e as any).amount ?? 0);
    }

    Object.values(detail).forEach((row) => {
      row.utilidad = row.ingresos - row.gastos;
    });

    return detail;
  }, [paymentsToday, expensesToday]);

  // Desglose SOLO de lo cobrado, por cada método activo — a diferencia de
  // detalleMetodos (que agrupa débito/crédito/tarjeta bajo una sola clave
  // "card" para la tabla vieja de ingresos/gastos/utilidad por método), acá
  // cada método activo necesita su propia fila.
  const cobradoPorMetodo = useMemo(() => {
    const byMethod: Record<string, number> = {};
    for (const p of paymentsToday as any[]) {
      const raw = String(p.method ?? p.payment_method ?? "").trim().toLowerCase();
      byMethod[raw] = (byMethod[raw] ?? 0) + Number(p.total ?? p.amount ?? 0);
    }
    return byMethod;
  }, [paymentsToday]);

  // Precarga "Efectivo contado"/"Saldo real en cuenta" con lo esperado
  // apenas se conoce, pero solo una vez — si el usuario ya escribió algo
  // (contadoTouched/saldoRealTouched), no se le pisa lo que tipeó cada vez
  // que expected se recalcula (ej. llega un cobro nuevo mientras el modal
  // está abierto).
  useEffect(() => {
    if (!open || contadoTouched) return;
    setEfectivoContado(String(Math.round(expected.cashExpected)));
  }, [open, contadoTouched, expected.cashExpected]);

  useEffect(() => {
    if (!open || saldoRealTouched) return;
    setSaldoReal(String(Math.round(expected.digitalExpected)));
  }, [open, saldoRealTouched, expected.digitalExpected]);

  const efectivoContadoNum = Number(efectivoContado.replace(/\./g, "").replace(",", ".")) || 0;
  const diferencia = efectivoContadoNum - expected.cashExpected;
  const saldoRealNum = Number(saldoReal.replace(/\./g, "").replace(",", ".")) || 0;
  const ajusteCuenta = saldoRealNum - expected.digitalExpected;

  const cobrosSnapshot = paymentsToday.map((p: any) => ({
    id: p.id,
    hora: p.created_at
      ? new Date(p.created_at).toLocaleTimeString("es-AR", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null,
    cliente: p.client_name ?? p.cliente ?? null,
    profesional: p.employee_name ?? p.professional_name ?? null,
    servicio: p.service_name ?? p.service ?? null,
    metodo: p.method ?? p.payment_method ?? null,
    monto: Number(p.total ?? p.amount ?? 0),
    usuario: p.charged_by ?? p.created_by ?? null,
  }));

  const gastosSnapshot = expensesToday.map((e: any) => ({
    id: e.id,
    hora: e.created_at
      ? new Date(e.created_at).toLocaleTimeString("es-AR", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null,
    nombre: e.name ?? e.concept ?? e.category ?? "Gasto",
    tipo: e.type ?? e.category ?? null,
    metodo: e.payment_method ?? e.method ?? null,
    monto: Number(e.amount ?? 0),
    nota: e.note ?? null,
    usuario: e.user_name ?? e.created_by ?? null,
  }));

  // Snapshot de lo que quedó sin cobrar al momento del cierre — no existe
  // (todavía) una columna dedicada en caja_cierres para esto, así que viaja
  // dentro del propio evento de cierre en "eventos" (mismo JSONB flexible
  // que ya usa total_cobrado/total_gastos ahí adentro), sin arriesgar un
  // ALTER TABLE a ciegas.
  const pendientesSnapshot = pendingCharges.map((p) => ({
    id: p.id,
    cliente: p.client_name ?? null,
    servicio: p.service_name ?? null,
    monto: Number(p.service_price ?? 0),
    hora_envio: p.sentAt ? cajaTimeLabel(new Date(p.sentAt)) : null,
  }));
  const pendientesMonto = pendingCharges.reduce((s, p) => s + Number(p.service_price ?? 0), 0);

  async function confirmar() {
    if (saving || !businessId) return;
    setSaving(true);
    try {
      const now = new Date();
      const hora = cajaTimeLabel(now);
      const cierreEvento = {
        tipo: "cierre",
        modo: "manual",
        fecha_hora: now.toISOString(),
        hora,
        usuario: userEmail ?? "Caja",
        observacion: obs.trim() || null,
        total_cobrado: totalCobrado,
        total_gastos: totalGastos,
        utilidad,
        efectivo_esperado: expected.cashExpected,
        efectivo_contado: efectivoContadoNum,
        diferencia,
        dinero_cuenta_esperado: expected.digitalExpected,
        dinero_cuenta_real: saldoRealNum,
        dinero_cuenta_ajuste: ajusteCuenta,
        pendientes_count: pendingCharges.length,
        pendientes_monto: pendientesMonto,
        pendientes_detalle: pendientesSnapshot,
      };

      let existingQuery = supabase
        .from("caja_cierres" as any)
        .select("id,eventos,estado")
        .eq("business_id", businessId)
        .eq("fecha", cajaRangeStartDate);
      if (branchId) existingQuery = existingQuery.eq("branch_id", branchId);
      const { data: existing } = await existingQuery.maybeSingle();

      // "Ya está cerrada" se decide por el ÚLTIMO evento de esta fila, no
      // por `estado` — estado se queda en 'cerrada' para siempre una vez
      // que se cerró la primera vez (nunca vuelve a 'reabierta', ver
      // caja-cierre.ts), así que un segundo cierre el MISMO día (cerrar →
      // reabrir → cobrar → cerrar) tiene que poder agregar su propio
      // evento de cierre a la misma fila. Si el último evento ya es un
      // "cierre" sin una "reapertura" después, recién ahí está realmente
      // cerrada y no hay nada nuevo que cerrar.
      const existingEvents = cajaEventosArray((existing as any)?.eventos);
      const lastExistingEvent = existingEvents[existingEvents.length - 1];
      if (existing?.id && lastExistingEvent?.tipo === "cierre") {
        toast.info("La caja ya está cerrada");
        setOpen(false);
        onCajaCerrada();
        return;
      }

      const payload = {
        business_id: businessId,
        branch_id: branchId,
        fecha: cajaRangeStartDate,
        hora_cierre: hora,
        usuario_id: null,
        usuario_nombre: userEmail ?? "Caja",
        total_cobrado: totalCobrado,
        total_gastos: totalGastos,
        utilidad,
        cantidad_cobros: paymentsToday.length,
        detalle_metodos_pago: detalleMetodos,
        cobros_snapshot: cobrosSnapshot,
        gastos_snapshot: gastosSnapshot,
        observacion: obs.trim() || null,
        tipo_cierre: "manual",
        estado: "cerrada",
        efectivo_contado: efectivoContadoNum,
        diferencia,
        dinero_cuenta_esperado: expected.digitalExpected,
        dinero_cuenta_real: saldoRealNum,
        dinero_cuenta_ajuste: ajusteCuenta,
        eventos: appendCajaEvento((existing as any)?.eventos, cierreEvento),
        updated_at: now.toISOString(),
      };

      // Sin .neq("estado","cerrada") acá a propósito — estado se queda en
      // 'cerrada' para siempre una vez cerrada la primera vez (nunca
      // vuelve a 'reabierta'), así que esa guarda bloquearía CUALQUIER
      // segundo cierre del mismo día (cerrar → reabrir → cobrar → cerrar).
      // El chequeo real de "ya está cerrada" ya se hizo arriba, mirando el
      // último evento — acá solo falta guardar.
      const query = existing?.id
        ? supabase
            .from("caja_cierres" as any)
            .update(payload)
            .eq("id", (existing as any).id)
            .eq("business_id", businessId)
            .select("id")
            .maybeSingle()
        : supabase
            .from("caja_cierres" as any)
            .insert(payload)
            .select("id")
            .maybeSingle();

      const { data: savedCierre, error } = await query;
      if (error) throw new Error(error.message);
      if (!savedCierre?.id) {
        toast.info("La caja ya estaba cerrada");
        setOpen(false);
        onCajaCerrada();
        return;
      }
      // Cierra también la cash_session vigente (si la hay) — sin esto, una
      // sesión nacida de una reapertura seguiría devolviendo su opened_at
      // como "período actual" después de este cierre. Ver caja-cierre.ts.
      await closeOpenCajaSession(businessId, branchId);
      toast.success("Cierre registrado correctamente");
      setOpen(false);
      setObs("");
      setEfectivoContado("");
      setContadoTouched(false);
      setSaldoReal("");
      setSaldoRealTouched(false);
      onCajaCerrada(); // ← bloquea la pantalla inmediatamente
      window.dispatchEvent(new CustomEvent("clippr:caja-cierre-guardado"));
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
                <h3 className="text-lg font-semibold">Cerrar caja</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Caja abierta desde {cajaAbiertaDesde}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setContadoTouched(false);
                  setSaldoRealTouched(false);
                }}
                className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-sm"
              >
                Cancelar
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto p-5 space-y-4">
              {/* 2. Total cobrado + desglose por método */}
              <div>
                <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70">
                  Total cobrado
                </div>
                <div className="mt-0.5 text-2xl font-semibold tabular-nums text-emerald-300">
                  ${totalCobrado.toLocaleString("es-AR")}
                </div>
                <div className="mt-2 rounded-xl bg-white/[0.025] ring-1 ring-white/10 overflow-hidden">
                  {ACTIVE_PAY_METHODS.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-2 px-4 py-2 border-b border-white/5 last:border-0 text-sm"
                    >
                      <span className="text-muted-foreground">{m.label}</span>
                      <span className="font-semibold tabular-nums">
                        ${Math.round(cobradoPorMetodo[m.id] ?? 0).toLocaleString("es-AR")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 3a. Ingresos de efectivo — ingresos manuales (cash_movements
                  tipo "ingreso") del período de la caja abierta. Mismo valor
                  que ya suma cashExpected (expected.cashInflows), ahora
                  mostrado aparte en vez de quedar implícito. Siempre visible
                  (igual que "Salidas de efectivo"), incluso en $0. */}
              <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.025] ring-1 ring-white/10 px-4 py-3">
                <span className="text-sm text-muted-foreground">Ingresos de efectivo</span>
                <span className="text-lg font-semibold tabular-nums text-emerald-300">
                  +${Math.round(expected.cashInflows).toLocaleString("es-AR")}
                </span>
              </div>

              {/* 3b. Salidas de efectivo */}
              <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.025] ring-1 ring-white/10 px-4 py-3">
                <span className="text-sm text-muted-foreground">Salidas de efectivo</span>
                <span className="text-lg font-semibold tabular-nums text-rose-300">
                  -${Math.round(expected.cashOutflows).toLocaleString("es-AR")}
                </span>
              </div>

              {/* 4. Efectivo esperado en caja */}
              <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.035] ring-1 ring-white/10 px-4 py-3">
                <span className="text-sm text-muted-foreground">Efectivo esperado en caja</span>
                <span className="text-lg font-semibold tabular-nums">
                  ${Math.round(expected.cashExpected).toLocaleString("es-AR")}
                </span>
              </div>

              {/* 5. Efectivo contado — editable, precargado con lo esperado */}
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
                    onChange={(e) => {
                      setContadoTouched(true);
                      setEfectivoContado(e.target.value.replace(/[^\d.,]/g, ""));
                    }}
                    className="w-full bg-transparent text-sm outline-none tabular-nums"
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Si coincide con lo esperado, no se registra diferencia.
                </p>
              </div>

              {/* 6. Diferencia */}
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

              {/* 7. Dinero en cuenta — a diferencia del efectivo, NO se
                  resetea: el saldo esperado ya arrastra el carry-forward
                  del último cierre (ver getDigitalCarryForward). Acá solo
                  se deja constancia del saldo real al momento de cerrar;
                  el ajuste nunca se mezcla con la diferencia de efectivo. */}
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
                      onChange={(e) => {
                        setSaldoRealTouched(true);
                        setSaldoReal(e.target.value.replace(/[^\d.,]/g, ""));
                      }}
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
                  Observación opcional
                </label>
                <textarea
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  rows={2}
                  placeholder="Novedades del día, diferencias, etc."
                  className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-blue-300/40 resize-none"
                />
              </div>

              <button
                type="button"
                onClick={confirmar}
                disabled={saving}
                className="w-full inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold bg-gradient-to-b from-blue-400 to-violet-500 text-white hover:brightness-105 disabled:opacity-50 transition-all"
              >
                {saving ? "Guardando…" : "Confirmar cierre"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
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
  onCajaCerrada: () => void;
  onCajaReopened: () => void;
}) {
  const { activeBranchId } = useAuth();
  const [cierres, setCierres] = useState<any[]>([]);
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
  const detalleMetodosSelected = React.useMemo(() => {
    if (!selected) return null;
    const detail: Record<string, CierreMetodoDetalle> = {};
    const ensure = (method: string | null | undefined) => {
      const key = normalizeCierreMethodKey(method);
      if (!detail[key]) detail[key] = { ingresos: 0, gastos: 0, utilidad: 0 };
      return detail[key];
    };
    for (const p of selected.cobros_snapshot ?? []) {
      ensure(p.metodo).ingresos += Number(p.monto ?? 0);
    }
    for (const g of selected.gastos_snapshot ?? []) {
      ensure(g.metodo).gastos += Number(g.monto ?? 0);
    }
    Object.values(detail).forEach((row) => {
      row.utilidad = row.ingresos - row.gastos;
    });
    return Object.keys(detail).length > 0
      ? detail
      : (selected.detalle_metodos_pago ?? null);
  }, [selected]);

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

  const cierreEventos = (cierre: any) =>
    cleanCajaEventosForDisplay(sortCajaEventos(cajaEventosArray(cierre?.eventos)));

  const latestCierre = cierres[0] ?? null;
  const latestEventos = latestCierre ? cierreEventos(latestCierre) : [];
  const cierreEvent = [...latestEventos].reverse().find((e: any) => e?.tipo === "cierre");
  // "Hora de apertura" = la PRIMERA apertura del día. Una "reapertura"
  // (reabrir la caja después de cerrarla) nunca debe pisar ese valor —
  // por eso queda excluida del pool de candidatos acá, no solo se prioriza
  // "apertura" sobre ella.
  const aperturaCandidates = latestEventos.filter((e: any) => e?.tipo !== "reapertura");
  const aperturaEvent =
    aperturaCandidates.find((e: any) => e?.tipo === "apertura") ?? aperturaCandidates[0];

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
  // 'reabierta' (mismo motivo que handleReabrirCajaDesdeBanner más
  // arriba) — sea cual sea el cierre histórico elegido, el efecto real es
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

  const renderEstado = (c: any) => (
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

  const cierreSummary = (c: any) => {
    const eventos = cierreEventos(c);
    const cierre = [...eventos].reverse().find((e: any) => e?.tipo === "cierre");
    // Igual que arriba: la reapertura no cuenta como candidata a "apertura".
    const aperturaCandidatesRow = eventos.filter((e: any) => e?.tipo !== "reapertura");
    const apertura =
      aperturaCandidatesRow.find((e: any) => e?.tipo === "apertura") ?? aperturaCandidatesRow[0];
    const modo = String(cierre?.modo ?? c?.tipo_cierre ?? "manual").toLowerCase();
    return {
      apertura,
      cierre,
      responsableApertura: actor(apertura?.usuario ?? c.opened_by ?? c.created_by ?? userEmail),
      responsableCierre: actor(cierre?.usuario ?? c.closed_by ?? c.usuario_nombre ?? c.user_email ?? userEmail),
      horaApertura: cajaHoraDisplay(apertura?.hora ?? c.hora_apertura ?? "—"),
      horaCierre: cajaHoraDisplay(cierre?.hora ?? c.hora_cierre ?? "—"),
      tipoCierre: modo === "automatico" ? "Automático" : "Manual",
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
                    paymentsToday={paymentsToday}
                    expensesToday={expensesToday}
                    pendingCharges={pendingCharges}
                    businessId={businessId}
                    branchId={activeBranchId}
                    userEmail={userEmail}
                    onCajaCerrada={() => {
                      onCajaCerrada();
                      loadCierres();
                    }}
                    cajaAbiertaDesde={`${fechaDDMMYYYY(latestCierre?.fecha)} · ${openedAt}`}
                    cajaRangeStartDate={latestCierre?.fecha ?? cajaDateKey()}
                    expected={expected}
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
        ) : cierres.length === 0 ? (
          <div className="rounded-3xl border border-white/[0.08] bg-black/30 py-12 text-center text-sm text-muted-foreground">
            Sin cierres registrados todavía.
          </div>
        ) : (
          <div className="pt-5">
            {/* Desktop: tabla de siempre, sin cambios. Mobile: tarjetas
                verticales debajo (mismos datos/acciones) — la tabla de 7
                columnas fijas nunca entraba en el ancho de un teléfono y
                obligaba a hacer scroll horizontal para llegar a "Ver
                detalles". */}
            <div className="hidden overflow-hidden rounded-[28px] border border-white/[0.085] bg-black/25 sm:block">
              <div className="grid grid-cols-[130px_minmax(170px,1fr)_minmax(170px,1fr)_120px_120px_110px_132px] items-center gap-3 border-b border-white/[0.07] px-5 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">
                <div>Fecha</div>
                <div>Responsable apertura</div>
                <div>Responsable cierre</div>
                <div>Apertura</div>
                <div>Cierre</div>
                <div>Tipo</div>
                <div className="text-right leading-none">Detalle</div>
              </div>
              <div className="max-h-[52vh] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
                {cierres.map((c) => {
                  const s = cierreSummary(c);
                  return (
                    <div
                      key={c.id}
                      className="grid grid-cols-[130px_minmax(170px,1fr)_minmax(170px,1fr)_120px_120px_110px_132px] items-center gap-3 border-b border-white/[0.055] px-5 py-3 text-sm last:border-0 hover:bg-white/[0.025]"
                    >
                      <div className="text-white/80">
                        <div className="font-semibold">{fechaDetalleLabel(c.fecha)}</div>
                      </div>
                      <div className="truncate text-white/70">{s.responsableApertura}</div>
                      <div className="truncate text-white/70">{s.responsableCierre}</div>
                      <div className="text-muted-foreground">{s.horaApertura}</div>
                      <div className="text-muted-foreground">{s.horaCierre}</div>
                      <div>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[11px] font-bold ring-1",
                            s.tipoCierre === "Automático"
                              ? "bg-violet-500/10 text-violet-300 ring-violet-400/25"
                              : "bg-white/[0.05] text-white/70 ring-white/10",
                          )}
                        >
                          {s.tipoCierre}
                        </span>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        {hasNotes(c) && (
                          <span
                            title="Tiene observaciones"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-violet-300/15 bg-violet-400/10 text-xs text-violet-200"
                          >
                            📝
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelected(c)}
                          className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-white/75 transition hover:bg-white/[0.08] hover:text-white"
                        >
                          Ver detalles
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex max-h-[65vh] flex-col gap-2.5 overflow-y-auto pr-0.5 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent] sm:hidden">
              {cierres.map((c) => {
                const s = cierreSummary(c);
                const observacion = getCierreObservacion(c) ?? getReaperturaObservacion(c);
                return (
                  <div
                    key={c.id}
                    className="rounded-2xl border border-white/[0.08] bg-black/25 p-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-white">{fechaDetalleLabel(c.fecha)}</div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1",
                          s.tipoCierre === "Automático"
                            ? "bg-violet-500/10 text-violet-300 ring-violet-400/25"
                            : "bg-white/[0.05] text-white/70 ring-white/10",
                        )}
                      >
                        {s.tipoCierre}
                      </span>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      <div className="text-white/45">
                        Apertura{" "}
                        <span className="text-white/80">{s.horaApertura}</span>
                      </div>
                      <div className="text-white/45">
                        Cierre <span className="text-white/80">{s.horaCierre}</span>
                      </div>
                      <div className="col-span-2 truncate text-white/45">
                        Responsable{" "}
                        <span className="text-white/80">
                          {s.responsableApertura === s.responsableCierre
                            ? s.responsableApertura
                            : `${s.responsableApertura} / ${s.responsableCierre}`}
                        </span>
                      </div>
                    </div>
                    {observacion && (
                      <div className="mt-2.5 rounded-xl border border-white/[0.055] bg-white/[0.03] px-3 py-2 text-xs text-white/65">
                        {observacion}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelected(c)}
                      className="mt-3 w-full rounded-xl border border-white/[0.08] bg-white/[0.045] px-3 py-2 text-xs font-bold text-white/80 transition active:bg-white/[0.08]"
                    >
                      Ver detalles
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {selected && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-3xl border border-white/[0.10] bg-[linear-gradient(135deg,rgba(5,8,15,0.99),rgba(10,12,24,0.98),rgba(2,4,12,0.99))] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/35 px-5 py-4">
              <div>
                <div className="font-semibold text-sm text-white">Detalle del cierre</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {fechaDetalleLabel(selected.fecha)} · {cajaHoraDisplay(selected.hora_cierre ?? "—")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-xl bg-white/5 px-3 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white"
              >
                Cerrar
              </button>
            </div>

            <div className="max-h-[76vh] overflow-y-auto p-5 text-sm [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  {
                    l: "Ingresos",
                    v: `$${Number(selected.total_cobrado ?? 0).toLocaleString("es-AR")}`,
                    cls: "text-emerald-300",
                  },
                  {
                    l: "Gastos",
                    v: `$${Number(selected.total_gastos ?? 0).toLocaleString("es-AR")}`,
                    cls: "text-rose-300",
                  },
                  {
                    l: "Utilidad",
                    v: `$${Number(selected.utilidad ?? 0).toLocaleString("es-AR")}`,
                    cls: Number(selected.utilidad) >= 0 ? "text-violet-300" : "text-rose-300",
                  },
                  {
                    l:
                      selected.diferencia == null
                        ? "Diferencia"
                        : Number(selected.diferencia) === 0
                          ? "Diferencia"
                          : Number(selected.diferencia) > 0
                            ? "Sobra"
                            : "Falta",
                    v:
                      selected.diferencia != null
                        ? `$${Math.round(Math.abs(Number(selected.diferencia))).toLocaleString("es-AR")}`
                        : "—",
                    cls:
                      selected.diferencia == null || Number(selected.diferencia) === 0
                        ? "text-white"
                        : Number(selected.diferencia) > 0
                          ? "text-emerald-300"
                          : "text-rose-300",
                  },
                ].map((k) => (
                  <div key={k.l} className="rounded-2xl border border-white/[0.075] bg-white/[0.035] p-3">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {k.l}
                    </div>
                    <div className={cn("mt-1 text-lg font-extrabold tabular-nums", k.cls)}>
                      {k.v}
                    </div>
                  </div>
                ))}
              </div>

              {detalleMetodosSelected && (
                <div className="mt-4 rounded-2xl border border-white/[0.075] bg-white/[0.03] p-4">
                  <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/45">
                    Medios de pago
                  </div>
                  <div className="space-y-2">
                    {Object.entries(detalleMetodosSelected as Record<string, any>).map(([method, row]) => (
                      <div key={method} className="grid grid-cols-4 gap-2 rounded-xl bg-black/22 px-3 py-2 text-xs">
                        <div className="font-semibold text-white">{paymentMethodLabel(method)}</div>
                        <div className="text-emerald-300">Ingresos ${Number(row.ingresos ?? 0).toLocaleString("es-AR")}</div>
                        <div className="text-rose-300">Gastos ${Number(row.gastos ?? 0).toLocaleString("es-AR")}</div>
                        <div className="text-white/80">Neto ${Number(row.utilidad ?? 0).toLocaleString("es-AR")}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/[0.075] bg-white/[0.03] p-4">
                  <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/45">
                    Ventas
                  </div>
                  <div className="max-h-56 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
                    {(selected.cobros_snapshot ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sin ventas.</p>
                    ) : (
                      (selected.cobros_snapshot ?? []).map((p: any, idx: number) => (
                        <div key={`${p.id ?? idx}`} className="rounded-xl bg-black/22 px-3 py-2 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate font-semibold text-white">{p.cliente ?? "Cliente"}</span>
                            <span className="font-bold text-emerald-300">${Number(p.monto ?? 0).toLocaleString("es-AR")}</span>
                          </div>
                          <div className="mt-1 truncate text-white/45">
                            {p.hora ?? "—"} · {p.servicio ?? "Servicio"} · {paymentMethodLabel(p.metodo ?? "cash")}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/[0.075] bg-white/[0.03] p-4">
                  <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/45">
                    Gastos
                  </div>
                  <div className="max-h-56 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
                    {(selected.gastos_snapshot ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sin gastos.</p>
                    ) : (
                      (selected.gastos_snapshot ?? []).map((g: any, idx: number) => (
                        <div key={`${g.id ?? idx}`} className="rounded-xl bg-black/22 px-3 py-2 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate font-semibold text-white">{g.nombre ?? "Gasto"}</span>
                            <span className="font-bold text-rose-300">-${Number(g.monto ?? 0).toLocaleString("es-AR")}</span>
                          </div>
                          <div className="mt-1 truncate text-white/45">
                            {g.hora ?? "—"} · {paymentMethodLabel(g.metodo ?? "cash")}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/[0.075] bg-white/[0.03] p-4">
                <div className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-white/45">
                  Línea de tiempo
                </div>
                <div className="space-y-3">
                  {cierreEventos(selected).map((e: any, index: number) => {
                    const tipo = String(e?.tipo ?? "evento");
                    const isAuto = tipo === "cierre" && String(e?.modo ?? "").toLowerCase() === "automatico";
                    const label =
                      isAuto ? "Cierre automático" :
                      tipo === "apertura" ? "Caja abierta" :
                      tipo === "reapertura" ? "Reapertura" :
                      tipo === "cierre" ? "Caja cerrada" :
                      tipo;
                    const note = e?.observacion ?? e?.motivo ?? e?.nota ?? null;

                    return (
                      <div key={`${e?.tipo}-${index}`} className="relative rounded-2xl border border-white/[0.065] bg-black/24 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-extrabold text-white">{label}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Responsable: <span className="font-semibold text-white/80">{actor(e?.usuario)}</span>
                            </p>
                          </div>
                          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs font-bold text-white/65">
                            {e?.hora ?? "—"}
                          </span>
                        </div>
                        {note && (
                          <div className="mt-3 rounded-xl border border-white/[0.055] bg-white/[0.035] px-3 py-2 text-xs text-white/72">
                            {note}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {selected.estado !== "reabierta" && (
                <button
                  type="button"
                  disabled={reopeningId === selected.id}
                  onClick={() => {
                    setReopenTarget(selected);
                    setReopenNote("");
                  }}
                  className="mt-4 w-full rounded-2xl border border-white/[0.10] bg-white/[0.055] px-4 py-3 text-sm font-extrabold text-white transition hover:bg-white/[0.09] disabled:opacity-50"
                >
                  Reabrir caja
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

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
                Agregá una nota para dejar registrado el motivo de reapertura.
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
                  disabled={reopeningId === reopenTarget.id}
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
      `¿Eliminar este cobro de ${payment.client_name ?? empName ?? "cliente"} por $${totalCobrado.toLocaleString("es-AR")}? No se puede deshacer: se borra el pago junto con su comisión y su propina asociadas.`,
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
                label="Comisión profesional"
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
type UnifiedMovKind = "pago" | "gasto" | "pendiente" | "movimiento";
type UnifiedMovColor = "verde" | "rojo" | "ambar";

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
): UnifiedMov[] {
  const items: UnifiedMov[] = [];

  for (const p of paymentsToday) {
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

  const all = React.useMemo(
    () =>
      buildUnifiedMovements(
        data.paymentsToday,
        data.expensesToday,
        data.pendingCharges,
        showPendientes,
        movementsData.movements,
      ),
    [data.paymentsToday, data.expensesToday, data.pendingCharges, showPendientes, movementsData.movements],
  );
  const recent = all.slice(0, 10);
  const loading = data.loading || movementsData.loading;

  function handleRowClick(item: UnifiedMov) {
    if (item.kind === "pago" && item.payment) setDetailPayment(item.payment);
  }

  function closeAllModal() {
    setAllOpen(false);
    // Arranca de nuevo en "Todos los profesionales" la próxima vez que se
    // abra, en vez de quedar pegado al último filtro elegido.
    setSelectedProfessionalId(null);
  }

  // Selector de profesional del modal "Ver todos los movimientos" — null =
  // Todos los profesionales. Solo lista profesionales con al menos un cobro
  // en el período (data.paymentsToday), no cualquier empleado activo.
  const [selectedProfessionalId, setSelectedProfessionalId] = React.useState<string | null>(null);
  const professionalOptions = React.useMemo(() => {
    const ids = new Set(
      data.paymentsToday.map((p) => p.employee_id).filter((id): id is string => !!id),
    );
    return data.employees
      .filter((e) => ids.has(e.id))
      .map((e) => ({ id: e.id, name: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data.paymentsToday, data.employees]);

  const professionalPayments = React.useMemo(
    () =>
      selectedProfessionalId
        ? data.paymentsToday.filter((p) => p.employee_id === selectedProfessionalId)
        : [],
    [data.paymentsToday, selectedProfessionalId],
  );

  // Resumen por método de pago — mismo cálculo que ya existía en History
  // (closeout). Con un profesional elegido, reutiliza professionalPayments
  // (ya filtrado arriba, solo cobros de ese profesional) en vez del total
  // general; sin profesional ("Todos"), usa data.paymentsToday completo. En
  // los dos casos la fuente es siempre paymentsToday — nunca gastos,
  // movimientos manuales ni pendientes — y un método sin cobros simplemente
  // no genera entrada en el reduce, así que "monto > 0" queda garantizado
  // sin un filtro aparte.
  const closeoutByMethod = React.useMemo(() => {
    const source = selectedProfessionalId ? professionalPayments : data.paymentsToday;
    const groups = source.reduce(
      (acc, payment) => {
        const method = String(payment.method ?? payment.payment_method ?? "cash");
        if (!acc[method]) acc[method] = { method, total: 0, count: 0 };
        acc[method].total += Number(payment.total ?? payment.amount ?? 0) + Number(payment.tip_amount ?? 0);
        acc[method].count += 1;
        return acc;
      },
      {} as Record<string, { method: string; total: number; count: number }>,
    );
    return Object.values(groups).sort((a, b) => b.total - a.total);
  }, [selectedProfessionalId, professionalPayments, data.paymentsToday]);

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
  // selector) a los cobros de ese profesional cuando hay uno elegido.
  const modalItems = React.useMemo(() => {
    if (!selectedProfessionalId) return all;
    return all.filter(
      (item) => item.kind === "pago" && item.payment?.employee_id === selectedProfessionalId,
    );
  }, [all, selectedProfessionalId]);

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
                Sin movimientos registrados.
              </div>
            ) : (
              <div>
                {recent.map((item) => (
                  <UnifiedMovRow
                    key={item.id}
                    item={item}
                    employees={data.employees}
                    businessId={data.businessId}
                    onClick={item.kind === "pago" ? () => handleRowClick(item) : undefined}
                    onShowNote={showNote}
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
              Sin movimientos registrados.
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-3">
              {recent.map((item) => (
                <UnifiedMovCardMobile
                  key={item.id}
                  item={item}
                  employees={data.employees}
                  businessId={data.businessId}
                  onClick={item.kind === "pago" ? () => handleRowClick(item) : undefined}
                  onShowNote={showNote}
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
              <select
                value={selectedProfessionalId ?? ""}
                onChange={(e) => setSelectedProfessionalId(e.target.value || null)}
                className="w-full shrink-0 rounded-xl bg-white/[0.05] ring-1 ring-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-primary/50 sm:w-auto"
              >
                <option value="">Todos los profesionales</option>
                {professionalOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

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
                    <UnifiedMovRow
                      key={item.id}
                      item={item}
                      employees={data.employees}
                      businessId={data.businessId}
                      onClick={item.kind === "pago" ? () => handleRowClick(item) : undefined}
                      onShowNote={showNote}
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
                      <UnifiedMovCardMobile
                        key={item.id}
                        item={item}
                        employees={data.employees}
                        businessId={data.businessId}
                        onClick={item.kind === "pago" ? () => handleRowClick(item) : undefined}
                        onShowNote={showNote}
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
  expected,
  movementsData,
  userEmail,
  cajaAbiertaDesde,
  cajaRangeStartDate,
  onCajaCerrada,
  onCobrarPendiente,
  pendientesTheme,
}: {
  data: ReturnType<typeof useCajaData>;
  equipoEnabled: boolean;
  expected: ExpectedCashDigital;
  movementsData: ReturnType<typeof useCashMovements>;
  userEmail: string | null;
  cajaAbiertaDesde: string;
  cajaRangeStartDate: string;
  onCajaCerrada: () => void;
  onCobrarPendiente: (
    appt: ReturnType<typeof useCajaData>["pendingCharges"][number],
  ) => void;
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
      {/* Ingresos | Pendientes | Gastos — reemplaza el selector grande
          Facturación/Gastos de ResumenTab. Sin Pendientes (negocio sin modo
          de aprobación habilitado, o usuario sin permiso de Equipo), queda
          Ingresos | Gastos en 2 columnas iguales, sin hueco. */}
      <div className={cn("grid gap-2", showPendientes ? "grid-cols-3" : "grid-cols-2")}>
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
        <FacturacionStatCard
          icon={TrendingDown}
          iconClass="text-rose-400"
          label="Gastos"
          value={data.totalGastos}
          loading={data.loading}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FacturacionStatCard
          icon={Wallet}
          iconClass="text-amber-400"
          label="Efectivo esperado en caja"
          value={expected.cashExpected}
          loading={movementsData.loading}
        />
        <FacturacionStatCard
          icon={CreditCard}
          iconClass="text-sky-400"
          label="Dinero esperado en cuenta"
          value={expected.digitalExpected}
          loading={movementsData.loading}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMovType("ingreso")}
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
          paymentsToday={data.paymentsToday}
          expensesToday={data.expensesToday}
          pendingCharges={data.pendingCharges}
          businessId={data.businessId}
          branchId={data.activeBranchId}
          userEmail={userEmail}
          onCajaCerrada={onCajaCerrada}
          cajaAbiertaDesde={cajaAbiertaDesde}
          cajaRangeStartDate={cajaRangeStartDate}
          expected={expected}
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
                      <div className="text-emerald-300 tabular-nums font-bold text-right">
                        {/* Total efectivamente cobrado (incluye propina) —
                            no payment.total, que es pura facturación de
                            servicios sin propina. */}
                        $
                        {(
                          Number(p.total ?? p.amount ?? 0) + Number(p.tip_amount ?? 0)
                        ).toLocaleString("es-AR")}
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
                        <span className="text-sm font-bold tabular-nums text-emerald-300">
                          $
                          {(
                            Number(p.total ?? p.amount ?? 0) + Number(p.tip_amount ?? 0)
                          ).toLocaleString("es-AR")}
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
  const total = cartItems.reduce(
    (acc, { svc, qty }) => acc + cartUnitPrice(svc) * qty,
    0,
  );
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
  // Un solo descuento activo a la vez: promoción O manual, nunca los dos
  // sumados — elegir uno limpia el otro (ver los onChange del panel del
  // Paso 3). El monto de la promo se calcula sobre cartUnitPrice, que ya
  // eligió precio de lista o precio en efectivo según el método actual —
  // por eso el descuento nunca se "duplica" con el precio en efectivo: son
  // dos pasos secuenciales (1. precio base según método, 2. descuento sobre
  // ese precio base), no dos descuentos independientes. Como todo acá es
  // estado derivado (no un $ congelado al elegir la promo), si el método de
  // pago cambia después en el Paso 4 esto se recalcula solo, siempre sobre
  // el precio base correcto.
  // Descuento por promoción, ÍTEM por ÍTEM (qty incluido) — solo descuenta
  // los servicios que esa promo alcanza (nunca catálogo, nunca un servicio
  // no aplicable). promoDiscountAmount es simplemente la suma.
  const promoItemDiscounts: number[] = selectedPromotion
    ? cartItems.map(({ svc, qty }) => {
        if (svc.is_catalog || !isPromotionApplicable(selectedPromotion, { serviceId: svc.id, employeeId, category: svc.category ?? null })) {
          return 0;
        }
        const subtotal = cartUnitPrice(svc) * qty;
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
    // está cobrando.
    if (turnoChargeMode !== "manual") {
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

    setSubmitting(true);
    let normalSaleCompleted = false;
    try {
      const savedClientId = await saveClientIfNeeded();
      if (savedClientId && !clientId) setClientId(savedClientId);

      // amount ya viene con el precio en efectivo aplicado si corresponde
      // (cartUnitPrice) — lo que se guarda en payments/liquidación es
      // siempre el monto realmente cobrado, nunca el de lista si se cobró
      // con descuento por efectivo. effectivePrice (tope de la base de
      // comisión) y discountAmount (ya repartido por servicio, ver
      // itemDiscounts arriba) viajan por ítem para que registerPayment
      // calcule la comisión real de CADA servicio — nunca el de lista si
      // supera al efectivo, nunca más de lo que esa línea realmente cobró.
      const items = cartItems.map(({ svc, qty }, idx) => ({
        serviceId: svc.id,
        serviceName: svc.name,
        amount: cartUnitPrice(svc),
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
        effectivePrice: svc.is_catalog ? null : svc.cashPrice ?? null,
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
          businessId: data.businessId,
          branchId: data.activeBranchId,
          employeeId: employeeId || null,
          employeeName: selectedEmployee?.name ?? null,
          commissionPct: selectedEmployee?.commission_pct ?? null,
          commissionFixed: selectedEmployee?.commission_fixed ?? null,
          employeeCommissions: data.employeeCommissions,
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
        });
        if (walkinRows[0]?.id) await attachReceiptIfNeeded(walkinRows[0].id);

        const { error: removeError } = await supabase
          .from("business_settings")
          .upsert(
            { business_id: data.businessId, schedule: { ...schedule, _pendingWalkInSales: currentPending.filter((s) => s.id !== pendingCharge.id) } },
            { onConflict: "business_id" },
          );
        if (removeError) throw removeError;

        toast.success(`Cobro confirmado · $${finalTotal.toLocaleString("es-AR")}`);
        clearReceiptFile();
        onPendingDone?.();
        await data.refresh();
        notifyCajaPendientesChanged();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("clippr:manual-pending-updated"));
        return;
      }

      if (pendingCharge) {
        const professionalNote = getCashRowNote(pendingCharge, pendingCharge.service_name);

        // ── FLUJO PENDIENTE: actualizar appointment existente y registrar pago ──
        // 1. Actualizar estado del appointment a "charged" y conservar la nota sin el marcador interno.
        //    .select("id") + chequeo de filas: si ya estaba cobrado (o
        //    cancelado) por otra acción mientras el modal seguía abierto,
        //    el .in("status", ...) no matchea nada — sin este chequeo se
        //    seguía de largo igual y se registraba un pago duplicado.
        const { data: chargedRows, error: updateError } = await supabase
          .from("appointments")
          .update({ status: "charged", notes: professionalNote || null })
          .eq("id", pendingCharge.id)
          .in("status", ["pending", "confirmed", "in_service"])
          .select("id");

        if (updateError) throw updateError;
        if (!chargedRows || chargedRows.length === 0) {
          toast.error("Este turno ya fue cobrado o actualizado — recargá la agenda.");
          return;
        }

        // 2. Registrar el pago vinculado al appointment existente
        const pendingRows = await registerPayment({
          businessId: data.businessId,
          branchId: data.activeBranchId,
          employeeId: employeeId || null,
          employeeName: selectedEmployee?.name ?? null,
          commissionPct: selectedEmployee?.commission_pct ?? null,
          commissionFixed: selectedEmployee?.commission_fixed ?? null,
          employeeCommissions: data.employeeCommissions,
          clientName:
            client.trim() ||
            pendingCharge.client_name ||
            "Cliente del mostrador",
          clientId: savedClientId?.startsWith?.("__pending_client__") ? null : savedClientId,
          items,
          method,
          splits: validSplits,
          appointmentId: pendingCharge.id,
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

        toast.success(`Cobro confirmado · $${finalTotal.toLocaleString("es-AR")}`);
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
          businessId: data.businessId,
          branchId: data.activeBranchId,
          employeeId: employeeId || null,
          employeeName: selectedEmployee?.name ?? null,
          commissionPct: selectedEmployee?.commission_pct ?? null,
          commissionFixed: selectedEmployee?.commission_fixed ?? null,
          employeeCommissions: data.employeeCommissions,
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
        });
        if (saleRows[0]?.id) await attachReceiptIfNeeded(saleRows[0].id);

        toast.success(`Cobro confirmado · $${finalTotal.toLocaleString("es-AR")}`);
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
              className={cn(
                "py-2 text-sm font-semibold last:rounded-tr-3xl",
                paymentMode === "multiple"
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
                (!isManualFlow && paymentMode === "multiple" && splitsRemaining !== 0) ||
                (!isManualFlow && paymentMode === "simple" && method === "cash" && cashShortfall > 0)
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
