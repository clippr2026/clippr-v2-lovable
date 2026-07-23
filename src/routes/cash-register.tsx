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
import { supabase } from "@/integrations/supabase/client";
import {
  useCajaData,
  searchClientsLite,
  notifyCajaPendientesChanged,
  type ClientLiteResult,
} from "@/components/cash-register/use-caja-data";
import {
  PAY_METHOD_LABEL,
  registerPayment,
  type PayMethod,
} from "@/components/cash-register/register-payment";
import {
  closeCashSession,
  reopenCashSession,
} from "@/components/cash-register/session-actions";
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
  ArrowRight,
  ArrowLeft,
  Trash2,
  ClipboardList,
  CreditCard,
  Banknote,
  Smartphone,
  Check,
  Loader2,
  CalendarDays,
  X,
  Scissors,
  Info,
} from "lucide-react";
import { useClientesConfig } from "@/hooks/use-clientes-config";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import { resolveServicePricing } from "@/lib/service-pricing";
import { AcquisitionSourceField } from "@/components/acquisition-source-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { acquisitionChannelRequiresText } from "@/lib/acquisition-channels";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { AgendaCenteredModal } from "@/components/agenda/agenda-drawer";
import { buildComprobanteText, downloadComprobante, shareComprobante } from "@/lib/settlement-comprobante";
import { fetchSettlementRunServices } from "@/hooks/use-professionals-data";

const MANUAL_PENDING_KEY = "clippr_pending_manual_charges";
const HISTORIAL_KEY = "clippr_cobros_historial_v2";
// Marca al inicio de payments.observations para guardar el historial
// "Envió a caja" / "Cobró" de una venta de mostrador sin turno — no hay
// appointment al que asociar appointments.cobro_events en ese caso, así que
// se usa esta columna de texto libre (ya probada, sin columnas nuevas).
const PAY_HIST_MARKER = "[[HIST]]";

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

  return raw;
}

// Usuario que cobró/pagó: muestra el email antes del "@". Solo cae en
// "Recepción" si realmente no hay email del usuario de sesión.
function chargedByUsername(email?: string | null) {
  const raw = String(email ?? "").trim();
  if (!raw) return "Recepción";
  return raw.includes("@") ? raw.split("@")[0] || "Recepción" : raw;
}

// "Registrado por" en Liquidaciones: los registros más viejos guardaron
// el email de sesión ahí (antes de que ProfesionalesTab recibiera un
// nombre real vía chargedByName) — si lo que hay guardado todavía
// parece un email, lo mostramos igual que chargedByUsername (parte
// antes de la @) en vez del email completo.
function displayResponsable(name: string | null | undefined) {
  const raw = String(name ?? "").trim();
  if (!raw) return "Caja";
  return raw.includes("@") ? raw.split("@")[0] || "Caja" : raw;
}

// "DD/MM/AAAA • HH:MM h" — formato de fecha y hora exacta usado en el
// detalle de Historial (período liquidado, datos del pago, adelantos).
function fmtDetalleDateTime(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} • ${time} h`;
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

  let value = raw
    .replace("[PENDIENTE_CAJA]", "")
    .replace("[MANUAL_PENDING]", "")
    .replace("[ENVIADO_CAJA]", "")
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
function cleanSearchParam(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;
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
  const data = useCajaData();
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
  const [resumenPanel, setResumenPanel] = useState<
    "ingresos" | "pendientes" | "gastos"
  >("ingresos");
  const [reopeningCaja, setReopeningCaja] = useState(false);

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

    autoCloseExpiredCajaSession({
      businessId: data.businessId,
      userEmail: session.user.email ?? session.user.id,
    })
      .then(async (result) => {
        if (cancelled) return;
        if (result.closed) {
          setCajaCerrada(true);
          setShowClosedHistory(false);
          setPendingToCharge(null);
          setResumenPanel("ingresos");
          setTab("resumen");
          await data.refresh();
          return;
        }
        // No hubo un auto-cierre recién ahora, pero la caja puede ya estar
        // cerrada de antes (cierre manual seguido de un refresh de página) —
        // `cajaCerrada` es estado local en memoria, así que sin este chequeo
        // se perdía al recargar y la pantalla volvía a mostrar "Caja abierta".
        const { data: todayCierre } = await supabase
          .from("caja_cierres" as any)
          .select("estado")
          .eq("business_id", data.businessId)
          .eq("fecha", cajaDateKey())
          .maybeSingle();
        if (!cancelled && isCajaCerradaRow(todayCierre)) setCajaCerrada(true);
      })
      .catch((error) => console.warn(error));

    return () => {
      cancelled = true;
    };
  }, [data.businessId, session?.user?.id]);

  function handleCobrarPendiente(
    appt: ReturnType<typeof useCajaData>["pendingCharges"][number],
  ) {
    setPendingToCharge(appt);
    setTab("nueva");
  }

  async function handleReabrirCajaDesdeBanner() {
    if (reopeningCaja) return;

    if (!data.businessId || !session?.user?.id) {
      setCajaCerrada(false);
      data.refresh();
      return;
    }

    setReopeningCaja(true);

    try {
      const { data: lastCierre, error } = await supabase
        .from("caja_cierres" as any)
        .select("id,eventos,estado")
        .eq("business_id", data.businessId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!lastCierre?.id) {
        setCajaCerrada(false);
        await data.refresh();
        return;
      }

      if (isCajaReabiertaRow(lastCierre)) {
        toast.info("La caja ya está abierta");
        setCajaCerrada(false);
        setShowClosedHistory(false);
        await data.refresh();
        return;
      }

      if (!isCajaCerradaRow(lastCierre)) {
        toast.info("La caja no está cerrada");
        setCajaCerrada(false);
        setShowClosedHistory(false);
        await data.refresh();
        return;
      }

      const now = new Date();
      const user = session.user.email ?? session.user.id;
      const evento = {
        tipo: "reapertura",
        fecha_hora: now.toISOString(),
        hora: now.toLocaleTimeString("es-AR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        usuario: user,
        motivo: null,
      };

      const { data: updated, error: updateError } = await supabase
        .from("caja_cierres" as any)
        .update({
          estado: "reabierta",
          reopened_at: now.toISOString(),
          reopened_by: user,
          eventos: appendCajaEvento((lastCierre as any).eventos, evento),
          updated_at: now.toISOString(),
        })
        .eq("id", (lastCierre as any).id)
        .eq("business_id", data.businessId)
        .eq("estado", "cerrada")
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;

      if (!updated?.id) {
        toast.info("La caja ya estaba abierta");
        setCajaCerrada(false);
        setShowClosedHistory(false);
        await data.refresh();
        return;
      }

      await reopenCashSession({
        sessionId: data.cajaSession?.sessionId ?? (lastCierre as any).id,
        businessId: data.businessId,
        reopenedBy: user,
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
              onCajaCerrada={() => {
                setCajaCerrada(true);
                setShowClosedHistory(false);
                setPendingToCharge(null);
                setResumenPanel("ingresos");
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
              setResumenPanel("ingresos");
              setTab("resumen");
            }}
          />
        )}
        <div className="mt-1 sm:mt-3">
          {tab === "resumen" && (
            <ResumenTab
              data={data}
              equipoEnabled={permissions.equipo}
              initialPanel={resumenPanel}
              onPanelChange={setResumenPanel}
              onCobrarPendiente={handleCobrarPendiente}
              onNuevaVenta={() => {
                setPendingToCharge(null);
                setTab("nueva");
              }}
              onNuevoGasto={() => {
                setPendingToCharge(null);
                setTab("nuevo-gasto");
              }}
            />
          )}
          {tab === "nuevo-gasto" && (
            <NuevoGastoTab
              data={data}
              userEmail={session.user.email ?? null}
              onCancel={() => setTab("resumen")}
              onSaved={() => {
                setResumenPanel("gastos");
                data.refresh();
                setTab("resumen");
              }}
            />
          )}
          {tab === "nueva" && (
            <NuevaVentaTab
              data={data}
              pendingCharge={activePendingCharge}
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
                setResumenPanel("ingresos");
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
              onCajaCerrada={() => {
                setCajaCerrada(true);
                setShowClosedHistory(false);
                setPendingToCharge(null);
                setResumenPanel("ingresos");
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
  initialPanel = "ingresos",
  onPanelChange,
  onCobrarPendiente,
  onNuevaVenta,
  onNuevoGasto,
}: {
  data: ReturnType<typeof useCajaData>;
  equipoEnabled: boolean;
  initialPanel?: "ingresos" | "pendientes" | "gastos";
  onPanelChange?: (panel: "ingresos" | "pendientes" | "gastos") => void;
  onCobrarPendiente: (
    appt: ReturnType<typeof useCajaData>["pendingCharges"][number],
  ) => void;
  onNuevaVenta: () => void;
  onNuevoGasto: () => void;
}) {
  type ActivePanel = "ingresos" | "pendientes" | "gastos";
  const [activePanel, setActivePanel] =
    React.useState<ActivePanel>(initialPanel);
  const [gastosHistoryOpen, setGastosHistoryOpen] = React.useState(false);
  const todayForHistory = new Date().toISOString().slice(0, 10);
  const [gastosHistoryFrom, setGastosHistoryFrom] = React.useState(todayForHistory);
  const [gastosHistoryTo, setGastosHistoryTo] = React.useState(todayForHistory);

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

  React.useEffect(() => {
    setActivePanel(initialPanel);
  }, [initialPanel]);

  React.useEffect(() => {
    const handler = () => {
      data.refresh();
      setActivePanel("gastos");
      onPanelChange?.("gastos");
    };
    window.addEventListener("clippr:gasto-guardado", handler);
    return () => window.removeEventListener("clippr:gasto-guardado", handler);
  }, [data, onPanelChange]);

  const selectPanel = React.useCallback(
    (panel: ActivePanel) => {
      setActivePanel(panel);
      onPanelChange?.(panel);
    },
    [onPanelChange],
  );

  const stats: {
    id: ActivePanel;
    label: string;
    value: number;
    sub: string;
    icon: any;
    money: boolean;
    cardClass: string;
    iconClass: string;
    amountClass: string;
    chipClass: string;
  }[] = [
    {
      id: "ingresos",
      label: "Ingresos",
      value: data.revHoy,
      sub: `${data.cobros} cobro${data.cobros === 1 ? "" : "s"} hoy`,
      icon: Wallet,
      money: true,
      cardClass:
        "border-emerald-400/24 bg-[radial-gradient(circle_at_14%_50%,rgba(16,185,129,0.18),transparent_34%),linear-gradient(135deg,rgba(6,95,70,0.20),rgba(3,7,18,0.94))] shadow-[0_30px_90px_-45px_rgba(16,185,129,0.55),0_22px_70px_-42px_rgba(0,0,0,0.95)]",
      iconClass:
        "bg-emerald-500/14 text-emerald-300 ring-emerald-400/30 shadow-[0_0_26px_rgba(34,197,94,0.20)]",
      amountClass: "text-white",
      chipClass: "bg-emerald-400/12 text-emerald-300 ring-emerald-400/20",
    },
    {
      id: "pendientes",
      label: "Pendientes",
      value: data.pendingAmount,
      sub: `${data.pendingCharges?.length ?? 0} pendiente${(data.pendingCharges?.length ?? 0) === 1 ? "" : "s"}`,
      icon: Clock,
      money: true,
      cardClass:
        "border-sky-400/24 bg-[radial-gradient(circle_at_14%_50%,rgba(14,165,233,0.18),transparent_34%),linear-gradient(135deg,rgba(12,74,110,0.22),rgba(3,7,18,0.94))] shadow-[0_30px_90px_-45px_rgba(14,165,233,0.46),0_22px_70px_-42px_rgba(0,0,0,0.95)]",
      iconClass:
        "bg-sky-500/14 text-sky-300 ring-sky-400/30 shadow-[0_0_26px_rgba(14,165,233,0.18)]",
      amountClass: "text-white",
      chipClass: "bg-sky-400/12 text-sky-300 ring-sky-400/20",
    },
    {
      id: "gastos",
      label: "Gastos",
      value: data.totalGastos,
      sub: `${data.expensesToday.length} gasto${data.expensesToday.length === 1 ? "" : "s"}`,
      icon: TrendingUp,
      money: true,
      cardClass:
        "border-rose-400/24 bg-[radial-gradient(circle_at_14%_50%,rgba(244,63,94,0.17),transparent_34%),linear-gradient(135deg,rgba(127,29,29,0.22),rgba(3,7,18,0.94))] shadow-[0_30px_90px_-45px_rgba(244,63,94,0.48),0_22px_70px_-42px_rgba(0,0,0,0.95)]",
      iconClass:
        "bg-rose-500/14 text-rose-300 ring-rose-400/30 shadow-[0_0_26px_rgba(244,63,94,0.18)]",
      amountClass: "text-white",
      chipClass: "bg-rose-400/12 text-rose-300 ring-rose-400/20",
    },
  ];

  const panelTheme: Record<
    ActivePanel,
    {
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
    }
  > = {
    ingresos: {
      border: "border-emerald-400/24",
      glow: "shadow-[0_30px_90px_-48px_rgba(16,185,129,0.36),0_22px_70px_-42px_rgba(0,0,0,0.95)]",
      panelBg:
        "bg-[radial-gradient(circle_at_14%_50%,rgba(16,185,129,0.18),transparent_34%),linear-gradient(135deg,rgba(6,95,70,0.20),rgba(3,7,18,0.94))]",
      headerIcon: "bg-emerald-500/14 text-emerald-300 ring-emerald-400/25",
      title: "text-emerald-50",
      chip: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/18",
      tableHead: "border-emerald-400/10 bg-black/[0.10]",
      rowHover: "hover:bg-emerald-400/[0.035]",
      amount: "text-emerald-300",
      badge: "bg-emerald-500/12 text-emerald-300 ring-emerald-400/20",
    },
    pendientes: {
      border: "border-sky-400/24",
      glow: "shadow-[0_30px_90px_-48px_rgba(14,165,233,0.32),0_22px_70px_-42px_rgba(0,0,0,0.95)]",
      panelBg:
        "bg-[radial-gradient(circle_at_14%_50%,rgba(14,165,233,0.18),transparent_34%),linear-gradient(135deg,rgba(12,74,110,0.22),rgba(3,7,18,0.94))]",
      headerIcon: "bg-sky-500/14 text-sky-300 ring-sky-400/25",
      title: "text-sky-50",
      chip: "bg-sky-400/10 text-sky-300 ring-sky-400/18",
      tableHead: "border-sky-400/10 bg-black/[0.10]",
      rowHover: "hover:bg-sky-400/[0.035]",
      amount: "text-sky-300",
      badge: "bg-sky-500/12 text-sky-300 ring-sky-400/20",
    },
    gastos: {
      border: "border-rose-400/24",
      glow: "shadow-[0_30px_90px_-48px_rgba(244,63,94,0.30),0_22px_70px_-42px_rgba(0,0,0,0.95)]",
      panelBg:
        "bg-[radial-gradient(circle_at_14%_50%,rgba(244,63,94,0.17),transparent_34%),linear-gradient(135deg,rgba(127,29,29,0.22),rgba(3,7,18,0.94))]",
      headerIcon: "bg-rose-500/14 text-rose-300 ring-rose-400/25",
      title: "text-rose-50",
      chip: "bg-rose-400/10 text-rose-300 ring-rose-400/18",
      tableHead: "border-rose-400/10 bg-black/[0.10]",
      rowHover: "hover:bg-rose-400/[0.035]",
      amount: "text-rose-300",
      badge: "bg-rose-500/12 text-rose-300 ring-rose-400/20",
    },
  };

  const activeTheme = panelTheme[activePanel];

  return (
    <>
      {/* Único acceso "Nueva venta"/"Nuevo gasto", igual en mobile y
          desktop — antes vivía partido entre un botón chico en el Header
          (solo mobile) y uno grande al lado de las pestañas (solo
          desktop, con demasiado espacio vacío alrededor en mobile). Ahora
          es un solo botón centrado, justo antes de la tarjeta Ingresos. */}
      <div className="mb-4 flex justify-center">
        {activePanel === "gastos" ? (
          <button
            type="button"
            onClick={onNuevoGasto}
            className="group inline-flex items-center justify-center gap-2.5 rounded-2xl border border-rose-300/38 bg-[linear-gradient(135deg,rgba(244,63,94,0.28),rgba(127,29,29,0.58))] px-6 py-3 text-sm font-extrabold text-rose-50 shadow-[0_0_34px_rgba(244,63,94,0.34),0_0_70px_rgba(244,63,94,0.12),0_1px_0_rgba(255,255,255,0.18)_inset] transition-all duration-200 hover:-translate-y-0.5 hover:bg-rose-500/22 hover:text-white hover:shadow-[0_0_52px_rgba(244,63,94,0.46),0_0_90px_rgba(244,63,94,0.18)]"
          >
            <Wallet className="size-4 transition-transform group-hover:scale-110" />
            Nuevo gasto
          </button>
        ) : (
          <button
            type="button"
            onClick={onNuevaVenta}
            className="group inline-flex items-center justify-center gap-3 rounded-2xl border border-emerald-300/36 bg-[linear-gradient(135deg,rgba(16,185,129,0.26),rgba(6,95,70,0.56))] px-9 py-3.5 text-base font-bold text-emerald-50 shadow-[0_0_40px_rgba(16,185,129,0.36),0_0_85px_rgba(16,185,129,0.14),0_1px_0_rgba(255,255,255,0.16)_inset] transition-all duration-200 hover:-translate-y-0.5 hover:bg-emerald-400/24 hover:text-white hover:shadow-[0_0_58px_rgba(16,185,129,0.50),0_0_100px_rgba(16,185,129,0.20)]"
          >
            <Plus className="size-5 transition-transform group-hover:rotate-90" />
            Nueva venta
          </button>
        )}
      </div>
    <div className="relative space-y-6 pt-0 pb-2 sm:py-2">
      <div className="pointer-events-none absolute inset-x-0 sm:inset-x-[-56px] top-[-54px] bottom-[-72px] z-0 rounded-[56px] bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.68)_0%,rgba(0,0,0,0.46)_34%,rgba(0,0,0,0.22)_58%,transparent_82%)] blur-3xl" />
      <div className="pointer-events-none absolute inset-x-0 sm:inset-x-[-30px] top-[-28px] bottom-[-40px] z-0 rounded-[46px] bg-[linear-gradient(180deg,transparent_0%,rgba(0,0,0,0.18)_14%,rgba(0,0,0,0.38)_46%,rgba(0,0,0,0.28)_72%,transparent_100%)]" />
      <div className="relative z-10 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {stats.map((s) => {
          const isActive = activePanel === s.id;
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => selectPanel(s.id)}
              className={cn(
                "group relative min-h-[74px] sm:min-h-[150px] overflow-hidden rounded-3xl border px-3.5 py-2.5 sm:p-6 text-left transition-all duration-300",
                "backdrop-blur-xl hover:-translate-y-0.5 hover:shadow-[0_22px_70px_-32px_rgba(0,0,0,0.95)]",
                isActive
                  ? s.cardClass
                  : "border-white/[0.075] bg-[linear-gradient(135deg,rgba(15,23,42,0.70),rgba(3,7,18,0.95))] shadow-[0_22px_70px_-42px_rgba(0,0,0,0.95)]",
                isActive ? "ring-1 ring-white/15" : "ring-1 ring-transparent",
              )}
            >
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.012))]" />
              <div className="relative flex items-center gap-3 sm:gap-5">
                <div
                  className={cn(
                    "grid size-9 sm:size-16 shrink-0 place-items-center rounded-full ring-1 transition-transform duration-300 group-hover:scale-105",
                    isActive
                      ? s.iconClass
                      : "bg-white/[0.045] text-white/70 ring-white/10 shadow-[0_0_22px_rgba(255,255,255,0.04)]",
                  )}
                >
                  <Icon className="size-4 sm:size-7" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] sm:text-base font-semibold leading-tight text-foreground/90">
                    {s.label}
                  </p>
                  <div className="mt-0.5 sm:mt-1">
                    <Money value={Number(s.value)} large />
                  </div>
                  <div
                    className={cn(
                      "mt-1 sm:mt-3 inline-flex items-center gap-1 sm:gap-1.5 rounded-full px-2 py-0.5 sm:px-3 sm:py-1 text-[9px] sm:text-xs font-semibold ring-1",
                      isActive ? s.chipClass : "bg-white/[0.045] text-white/70 ring-white/10",
                    )}
                  >
                    <span className="size-1 sm:size-1.5 rounded-full bg-current" />
                    {s.sub}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {activePanel === "ingresos" && (
        <div className="relative z-10">
          <History
            data={data}
            equipoEnabled={equipoEnabled}
            onCobrarPendiente={onCobrarPendiente}
            title="Últimos ingresos"
            panel="ingresos"
            theme={activeTheme}
          />
        </div>
      )}

      {activePanel === "pendientes" && (
        <div className="relative z-10">
          <History
            data={data}
            equipoEnabled={equipoEnabled}
            onCobrarPendiente={onCobrarPendiente}
            title="Pendientes de cobro"
            panel="pendientes"
            theme={activeTheme}
          />
        </div>
      )}

      {activePanel === "gastos" && (
        <div className="relative z-10">
          <Card
            className={cn(
              "rounded-3xl transition-all duration-300",
              panelTheme.gastos.panelBg,
              panelTheme.gastos.border,
              panelTheme.gastos.glow,
            )}
          >
            <div
              className={cn(
                "flex min-h-[64px] items-center justify-between gap-3 px-5 py-3 border-b",
                panelTheme.gastos.tableHead,
              )}
            >
              <h3
                className={cn(
                  "text-base font-bold tracking-tight",
                  panelTheme.gastos.title,
                )}
              >
                Gastos
              </h3>
            </div>

            {/* En mobile, tabla oculta — ver tarjetas verticales debajo. */}
            <div className="hidden overflow-x-auto sm:block">
              <div className="min-w-[1080px]">
                <div
                  className={cn(
                    "grid grid-cols-[80px_90px_150px_minmax(260px,1fr)_140px_150px_220px] items-center gap-x-3 px-6 py-2.5 text-[10px] font-semibold tracking-[0.18em] text-muted-foreground/60 border-b uppercase",
                    panelTheme.gastos.tableHead,
                  )}
                >
                  <div>Fecha</div>
                  <div>Hora</div>
                  <div>Tipo de gasto</div>
                  <div>Descripción</div>
                  <div className="text-right">Monto</div>
                  <div>Método</div>
                  <div>Responsable</div>
                </div>

                {data.expensesToday.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                    Sin gastos registrados.
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {data.expensesToday.slice(0, 5).map((e: any) => {
                      const createdDate = e.created_at
                        ? new Date(e.created_at)
                        : null;
                      const date = e.date
                        ? new Date(`${e.date}T00:00:00`).toLocaleDateString("es-AR", {
                            day: "2-digit",
                            month: "2-digit",
                          })
                        : createdDate
                          ? createdDate.toLocaleDateString("es-AR", {
                              day: "2-digit",
                              month: "2-digit",
                            })
                          : "—";
                      const hora =
                        createdDate && !Number.isNaN(createdDate.getTime())
                          ? `${createdDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}hs`
                          : "—";
                      const category = e.category ?? e.type ?? "—";
                      // Descripción real solo si el usuario escribió algo
                      // distinto del tipo de gasto — si no, no se repite
                      // (antes "Alquiler" aparecía como categoría Y como
                      // descripción cuando no había nada más para mostrar).
                      const rawDescription = String(
                        e.note?.trim() || e.name || e.description || e.concept || "",
                      ).trim();
                      const description =
                        rawDescription &&
                        rawDescription.toLowerCase() !== String(category).toLowerCase()
                          ? rawDescription
                          : "";
                      const method = paymentMethodLabel(e.payment_method ?? e.method ?? "");
                      const user = displayCashActor(e);
                      return (
                        <div
                          key={e.id}
                          className={cn(
                            "grid grid-cols-[80px_90px_150px_minmax(260px,1fr)_140px_150px_220px] items-center gap-x-3 px-6 py-3 text-xs border-b border-white/[0.09] odd:bg-white/[0.022] last:border-0 transition-all duration-200",
                            panelTheme.gastos.rowHover,
                          )}
                        >
                          <div className="text-muted-foreground whitespace-nowrap">{date}</div>
                          <div className="text-muted-foreground whitespace-nowrap">{hora}</div>
                          <div className="text-muted-foreground truncate">
                            {category}
                          </div>
                          <div className="min-w-0 truncate text-foreground/90">
                            {description || "—"}
                          </div>
                          <div className="text-right font-bold tabular-nums text-rose-300">
                            -${Number(e.amount ?? 0).toLocaleString("es-AR")}
                          </div>
                          <div className="truncate text-muted-foreground">{method}</div>
                          <div className="truncate text-muted-foreground">{user}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Mobile: tarjetas verticales — mismos datos (data.expensesToday,
                mismo límite de 5) sin scroll horizontal. */}
            <div className="sm:hidden">
              {data.expensesToday.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Sin gastos registrados.
                </div>
              ) : (
                <div className="flex flex-col gap-3 p-3">
                  {data.expensesToday.slice(0, 5).map((e: any) => {
                    const createdDate = e.created_at ? new Date(e.created_at) : null;
                    const date = e.date
                      ? new Date(`${e.date}T00:00:00`).toLocaleDateString("es-AR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })
                      : createdDate
                        ? createdDate.toLocaleDateString("es-AR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })
                        : "—";
                    const hora =
                      createdDate && !Number.isNaN(createdDate.getTime())
                        ? `${createdDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}hs`
                        : "—";
                    const category = e.category ?? e.type ?? "—";
                    const rawDescription = String(
                      e.note?.trim() || e.name || e.description || e.concept || "",
                    ).trim();
                    const description =
                      rawDescription &&
                      rawDescription.toLowerCase() !== String(category).toLowerCase()
                        ? rawDescription
                        : "";
                    const method = paymentMethodLabel(e.payment_method ?? e.method ?? "");
                    const user = displayCashActor(e);
                    return (
                      <div
                        key={`gasto-mobile-${e.id}`}
                        className="w-full rounded-2xl border border-white/[0.07] bg-black/25 px-3.5 py-3 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                            {date} · {hora}
                          </span>
                          <span className="text-sm font-bold tabular-nums text-rose-300">
                            -${Number(e.amount ?? 0).toLocaleString("es-AR")}
                          </span>
                        </div>
                        <div className="mt-2 space-y-1.5">
                          <div className="flex items-start justify-between gap-3">
                            <span className="shrink-0 text-muted-foreground/70">Tipo de gasto</span>
                            <span className="truncate text-right text-muted-foreground">
                              {category}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="shrink-0 text-muted-foreground/70">Método</span>
                            <span className="truncate text-right text-muted-foreground">
                              {method}
                            </span>
                          </div>
                          {description && (
                            <div className="flex items-start justify-between gap-3">
                              <span className="shrink-0 text-muted-foreground/70">Descripción</span>
                              <span className="truncate text-right text-foreground/90">
                                {description}
                              </span>
                            </div>
                          )}
                          <div className="flex items-start justify-between gap-3">
                            <span className="shrink-0 text-muted-foreground/70">Responsable</span>
                            <span className="truncate text-right text-muted-foreground">
                              {user}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-6 py-2 border-t border-white/[0.07] flex items-center justify-end gap-3">
              {data.expensesToday.length > 0 && (
              <button
                onClick={() => setGastosHistoryOpen(true)}
                className="ml-auto text-xs font-semibold text-rose-300 hover:text-rose-200 inline-flex items-center gap-2 transition"
              >
                <ClipboardList className="size-3.5" /> Ver historial completo{" "}
                <ArrowRight className="size-3.5" />
              </button>
            )}
            </div>
          </Card>
        </div>
      )}
    
      {gastosHistoryOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setGastosHistoryOpen(false)}
        >
          <div
            className="w-full max-w-6xl overflow-hidden rounded-3xl border border-rose-300/18 bg-[linear-gradient(135deg,rgba(10,8,14,0.98),rgba(18,8,18,0.97),rgba(3,5,12,0.99))] shadow-[0_40px_120px_-55px_rgba(0,0,0,1),0_0_60px_-38px_rgba(244,63,94,0.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-rose-300/10 px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-rose-50">Historial completo de gastos</h3>
                <p className="mt-1 text-xs text-white/45">Hoy y rango por fechas.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGastosHistoryOpen(false)}
                  className="h-10 rounded-2xl bg-white/[0.06] px-4 text-xs font-semibold text-white/70 hover:bg-white/[0.09] hover:text-white"
                >
                  Cerrar
                </button>
              </div>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-4 [scrollbar-width:thin] [scrollbar-color:rgba(244,63,94,0.35)_transparent]">
              {/* En mobile, tabla oculta — ver tarjetas verticales debajo. */}
              <div className="hidden min-w-[1080px] overflow-hidden rounded-2xl border border-rose-300/12 bg-black/25 sm:block">
                <div className="grid grid-cols-[80px_90px_150px_minmax(260px,1fr)_140px_150px_220px] items-center gap-x-3 border-b border-rose-300/10 bg-rose-400/[0.035] px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
                  <div>Fecha</div>
                  <div>Hora</div>
                  <div>Tipo de gasto</div>
                  <div>Descripción</div>
                  <div className="text-right">Monto</div>
                  <div>Método</div>
                  <div>Responsable</div>
                </div>

                {data.expensesToday.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-white/45">
                    Sin gastos registrados.
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {data.expensesToday.map((e: any) => {
                      const createdDate = e.created_at ? new Date(e.created_at) : null;
                      const rawDate = e.date || (createdDate ? createdDate.toISOString().slice(0, 10) : "");
                      const date = rawDate
                        ? new Date(`${rawDate}T00:00:00`).toLocaleDateString("es-AR", {
                            day: "2-digit",
                            month: "2-digit",
                          })
                        : "—";
                      const hora =
                        createdDate && !Number.isNaN(createdDate.getTime())
                          ? `${createdDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}hs`
                          : "—";
                      const category = e.category ?? e.type ?? "—";
                      const rawDescription = String(
                        e.note?.trim() || e.name || e.description || e.concept || "",
                      ).trim();
                      const description =
                        rawDescription &&
                        rawDescription.toLowerCase() !== String(category).toLowerCase()
                          ? rawDescription
                          : "";
                      const method = paymentMethodLabel(e.payment_method ?? e.method ?? "");
                      const user = displayCashActor(e);
                      return (
                        <div
                          key={`history-${e.id}`}
                          className="grid grid-cols-[80px_90px_150px_minmax(260px,1fr)_140px_150px_220px] items-center gap-x-3 px-5 py-3.5 text-xs transition hover:bg-rose-400/[0.045]"
                        >
                          <div className="text-white/55">{date}</div>
                          <div className="text-white/55">{hora}</div>
                          <div className="truncate text-white/55">{category}</div>
                          <div className="min-w-0 truncate text-white/88">
                            {description || "—"}
                          </div>
                          <div className="text-right font-bold tabular-nums text-rose-300">
                            -${Number(e.amount ?? 0).toLocaleString("es-AR")}
                          </div>
                          <div className="truncate text-white/55">{method}</div>
                          <div className="truncate text-white/55">{user}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Mobile: tarjetas verticales — mismos datos, sin límite
                  (igual que la tabla de escritorio de este modal). */}
              <div className="sm:hidden">
                {data.expensesToday.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-white/45">
                    Sin gastos registrados.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {data.expensesToday.map((e: any) => {
                      const createdDate = e.created_at ? new Date(e.created_at) : null;
                      const rawDate = e.date || (createdDate ? createdDate.toISOString().slice(0, 10) : "");
                      const date = rawDate
                        ? new Date(`${rawDate}T00:00:00`).toLocaleDateString("es-AR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })
                        : "—";
                      const hora =
                        createdDate && !Number.isNaN(createdDate.getTime())
                          ? `${createdDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}hs`
                          : "—";
                      const category = e.category ?? e.type ?? "—";
                      const rawDescription = String(
                        e.note?.trim() || e.name || e.description || e.concept || "",
                      ).trim();
                      const description =
                        rawDescription &&
                        rawDescription.toLowerCase() !== String(category).toLowerCase()
                          ? rawDescription
                          : "";
                      const method = paymentMethodLabel(e.payment_method ?? e.method ?? "");
                      const user = displayCashActor(e);
                      return (
                        <div
                          key={`history-mobile-${e.id}`}
                          className="w-full rounded-2xl border border-rose-300/12 bg-black/25 px-3.5 py-3 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
                              {date} · {hora}
                            </span>
                            <span className="text-sm font-bold tabular-nums text-rose-300">
                              -${Number(e.amount ?? 0).toLocaleString("es-AR")}
                            </span>
                          </div>
                          <div className="mt-2 space-y-1.5">
                            <div className="flex items-start justify-between gap-3">
                              <span className="shrink-0 text-white/45">Tipo de gasto</span>
                              <span className="truncate text-right text-white/55">
                                {category}
                              </span>
                            </div>
                            <div className="flex items-start justify-between gap-3">
                              <span className="shrink-0 text-white/45">Método</span>
                              <span className="truncate text-right text-white/55">
                                {method}
                              </span>
                            </div>
                            {description && (
                              <div className="flex items-start justify-between gap-3">
                                <span className="shrink-0 text-white/45">Descripción</span>
                                <span className="truncate text-right text-white/88">
                                  {description}
                                </span>
                              </div>
                            )}
                            <div className="flex items-start justify-between gap-3">
                              <span className="shrink-0 text-white/45">Responsable</span>
                              <span className="truncate text-right text-white/55">
                                {user}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
  data,
}: {
  businessId: string | null;
  userEmail: string | null;
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
  const [adjustQty, setAdjustQty] = React.useState("");
  const [adjustNote, setAdjustNote] = React.useState("");
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

  function openStockAdjustment(item: any, direction: "in" | "out") {
    if (adjustingId) return;
    setStockAdjustment({ item, direction });
    setAdjustQty("");
    setAdjustNote("");
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
    const nextStock =
      direction === "in" ? currentStock + qty : currentStock - qty;

    setAdjustingId(id);
    try {
      const { error } = await supabase
        .from("services" as any)
        .update({
          stock: nextStock,
          updated_at: new Date().toISOString(),
        } as any)
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

      saveLocalMovement({
        id: `${Date.now()}-${id}`,
        created_at: new Date().toISOString(),
        product: item.name ?? "Producto",
        type: direction === "in" ? "Ingreso" : "Egreso",
        qty: direction === "in" ? qty : -qty,
        stockFrom: currentStock,
        stockTo: nextStock,
        note: adjustNote.trim() || null,
        user: userEmail ?? "Caja",
      });

      toast.success(direction === "in" ? "Stock agregado" : "Stock retirado");
      setStockAdjustment(null);
      setAdjustQty("");
      setAdjustNote("");
      await data.refresh();
    } catch (error: any) {
      // Fallback local: si la tabla no permite guardar stock todavía,
      // igual dejamos persistido el ajuste en este dispositivo.
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
        type: direction === "in" ? "Ingreso" : "Egreso",
        qty: direction === "in" ? qty : -qty,
        stockFrom: currentStock,
        stockTo: nextStock,
        note: adjustNote.trim() || null,
        user: userEmail ?? "Caja",
      });

      toast.success(direction === "in" ? "Stock agregado" : "Stock retirado");
      setStockAdjustment(null);
      setAdjustQty("");
      setAdjustNote("");
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
      .filter((payment: any) =>
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
      .map((payment: any) => ({
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
        user:
          payment.user_name ??
          payment.charged_by ??
          payment.created_by ??
          userEmail ??
          "Caja",
      }));
  }, [data.paymentsToday, catalogItems, userEmail]);

  const inventoryMovements = React.useMemo(() => {
    return [...localMovements, ...salesMovements].sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    );
  }, [localMovements, salesMovements]);

  const filteredMovements = inventoryMovements.filter(
    (item: InventoryMovement) => {
      if (!normalizedMovementQuery) return true;
      return `${item.product ?? ""} ${item.note ?? ""} ${item.type ?? ""} ${item.user ?? ""}`
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
                  <div className="truncate text-white/50">
                    {item.note || "—"}
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
      {movementsModalOpen && (
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
                      {item.note && (
                        <div className="mt-1 truncate text-white/50">{item.note}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {stockAdjustment && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(12,16,30,0.98),rgba(5,7,16,0.99))] shadow-[0_30px_100px_-45px_rgba(139,92,246,0.55)]">
            <div className="border-b border-white/[0.065] px-5 py-5">
              <div className="text-lg font-bold text-white">
                {stockAdjustment.direction === "in"
                  ? "Agregar stock"
                  : "Retirar stock"}
              </div>
              <div className="mt-1 text-sm text-white/55">
                {stockAdjustment.item?.name ?? "Producto"}
              </div>
            </div>
            <div className="space-y-3 p-5">
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
                  placeholder={
                    stockAdjustment.direction === "in"
                      ? "Cantidad a agregar"
                      : "Cantidad a retirar"
                  }
                  // text-base (16px): con autoFocus, este input se enfoca
                  // apenas se toca +/- para abrir el modal — con menos de
                  // 16px, iOS hace zoom automático de la pantalla entera al
                  // enfocar. Mismo fix ya aplicado en login/Nuevo gasto.
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 text-base font-semibold text-white outline-none placeholder:text-white/35 focus:border-violet-300/35 focus:ring-2 focus:ring-violet-400/12"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                  Nota
                </label>
                <textarea
                  value={adjustNote}
                  onChange={(event) => setAdjustNote(event.target.value)}
                  rows={3}
                  placeholder="Motivo del movimiento, proveedor, corrección, etc."
                  className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-base text-white outline-none placeholder:text-white/35 focus:border-violet-300/35 focus:ring-2 focus:ring-violet-400/12"
                />
              </div>
              <div className="rounded-2xl border border-white/[0.065] bg-white/[0.025] px-4 py-3 text-sm text-white/60">
                Stock actual:{" "}
                <span className="font-bold text-white">
                  {stockNumber(stockAdjustment.item)}
                </span>
              </div>
              <div className="flex justify-end gap-3 pt-1">
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
                  disabled={Boolean(adjustingId)}
                  className={cn(
                    "rounded-2xl px-4 py-2 text-sm font-bold transition disabled:opacity-50",
                    stockAdjustment.direction === "in"
                      ? "bg-emerald-400/12 text-emerald-200 ring-1 ring-emerald-400/24 shadow-[0_0_26px_rgba(16,185,129,0.22)] hover:bg-emerald-400/18"
                      : "bg-rose-500/12 text-rose-200 ring-1 ring-rose-400/24 shadow-[0_0_26px_rgba(244,63,94,0.20)] hover:bg-rose-500/18",
                  )}
                >
                  {adjustingId
                    ? "Guardando…"
                    : stockAdjustment.direction === "in"
                      ? "Agregar"
                      : "Retirar"}
                </button>
              </div>
            </div>
          </div>
        </div>
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
// modal de "Preparar liquidación" — mismo patrón de agregar/quitar filas
// que "Pago múltiple" en Nueva venta (addSplit/removeSplit más abajo en
// este archivo), adaptado a importe+motivo en vez de método+importe.
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
    <div className="space-y-2">
      {items.map((item) => {
        const incomplete = Number(item.amount || 0) > 0 && !item.reason.trim();
        return (
          <div key={item.id} className="space-y-1.5 rounded-2xl border border-white/[0.08] bg-black/20 p-2.5">
            <div className="flex items-center gap-1.5">
              <input
                value={item.reason}
                onChange={(e) => updateItem(item.id, { reason: e.target.value })}
                placeholder={reasonPlaceholder}
                className="h-10 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-black/30 px-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25"
              />
              <div className="relative w-28 shrink-0">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/45">
                  $
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatThousands(item.amount)}
                  onChange={(e) => updateItem(item.id, { amount: e.target.value.replace(/\D/g, "") })}
                  placeholder="0"
                  className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 pl-6 pr-2 text-right text-sm font-bold tabular-nums text-white outline-none focus:border-white/25"
                />
              </div>
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/25 text-white/45 transition hover:border-rose-300/35 hover:text-rose-300"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            {incomplete && (
              <div className="px-1 text-[11px] text-rose-300">
                Falta el motivo para este importe.
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={addItem}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
          accentClass,
        )}
      >
        <Plus className="size-3.5" /> {addLabel}
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
  const [historialDetailServices, setHistorialDetailServices] = React.useState<any[] | null>(null);
  const [loadingHistorialDetail, setLoadingHistorialDetail] = React.useState(false);
  const [loadingCommissions, setLoadingCommissions] = React.useState(true);
  const [loadingRuns, setLoadingRuns] = React.useState(true);
  // Errores reales (no silenciados en $0): si la query falla (RLS, columna
  // faltante, etc.), se muestra acá en vez de quedar solo en la consola —
  // "todo en $0" tiene que distinguirse de "no hay datos" de un error real.
  const [commissionsError, setCommissionsError] = React.useState<string | null>(null);
  const [runsError, setRunsError] = React.useState<string | null>(null);
  const [preparingRunFor, setPreparingRunFor] = React.useState<string | null>(null);
  // "detalle"/"historial" son las únicas vistas de consulta (pestañas
  // reales) — Pagar y Adelantar son botones de acción que abren su
  // modal directo, nunca cambian esta pestaña.
  const [selectedDetail, setSelectedDetail] = React.useState<"detalle" | "historial">("detalle");
  const [paymentForm, setPaymentForm] = React.useState({
    amount: "",
    method: "transferencia",
    note: "",
  });
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
    setPaymentForm({ amount: "", method: "transferencia", note: "" });
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
  // commission_records: fuente de verdad de cuánto se le debe a cada
  // profesional. Las que ya tienen settlement_run_id están "bloqueadas"
  // dentro de una liquidación preparada; las que no, son las que entrarían
  // como "comisiones nuevas" en la próxima liquidación. settlement_runs es
  // el lote preparado (inmutable) y settlement_payments los pagos contra
  // cada uno.
  const [allCommissions, setAllCommissions] = React.useState<any[]>([]);
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
              "id,professional_id,run_number,cutoff_date,period_start,period_start_at,previous_settlement_run_id,previous_balance,new_commissions,adjustments,deductions,advances,adjustment_items,deduction_items,total_to_settle,amount_paid,service_count,total_sold,status,prepared_by_name,prepared_at",
            )
            .eq("business_id", businessId)
            .order("cutoff_date", { ascending: false }),
          supabase
            .from("settlement_payments" as any)
            .select(
              "id,settlement_run_id,professional_id,amount,payment_method,note,balance_before,balance_after,paid_by_name,paid_at",
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
          .select("id,professional_id,amount,payment_method,note,advanced_at,registered_by_name,settlement_run_id")
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
          .select("id,client_name,service_name,total,amount,method,payment_method,created_at")
          .in("id", saleIds);
        if (payError) throw payError;
        paymentsById = Object.fromEntries((pays ?? []).map((p: any) => [p.id, p]));
      }
      setDetailRows(
        (commissionRows ?? []).map((c: any) => ({
          ...c,
          sale: paymentsById[c.sale_id] ?? null,
        })),
      );
    } catch (e) {
      const message = (e as Error).message;
      setDetailError(message);
      toast.error(`No se pudo cargar el detalle: ${message}`);
    } finally {
      setLoadingDetail(false);
    }
  }

  // Arma el texto del comprobante para un run del Historial — factorizado
  // porque lo usan Descargar, Compartir y (más abajo) el modal de detalle.
  function buildHistorialComprobante(run: any) {
    const lastPayment = allRunPayments
      .filter((p: any) => p.settlement_run_id === run.id)
      .sort((a: any, b: any) => String(b.paid_at ?? "").localeCompare(String(a.paid_at ?? "")))[0];
    const previousRun = allRuns.find((r: any) => r.id === run.previous_settlement_run_id);
    return buildComprobanteText({
      runNumber: run.run_number,
      cutoffDate: run.cutoff_date,
      periodStart: run.period_start ?? null,
      professionalName: selectedRow?.name ?? "Profesional",
      previousBalance: Number(run.previous_balance ?? 0),
      previousRun: previousRun
        ? {
            runNumber: previousRun.run_number,
            cutoffDate: previousRun.cutoff_date,
            status: previousRun.status,
          }
        : null,
      newCommissions: Number(run.new_commissions ?? 0),
      adjustments: Number(run.adjustments ?? 0),
      deductions: Number(run.deductions ?? 0),
      adjustmentItems: Array.isArray(run.adjustment_items) ? run.adjustment_items : [],
      deductionItems: Array.isArray(run.deduction_items) ? run.deduction_items : [],
      preparedByName: run.prepared_by_name ?? null,
      preparedAt: run.prepared_at ?? null,
      totalToSettle: Number(run.total_to_settle ?? 0),
      amountPaid: Number(run.amount_paid ?? 0),
      payment: lastPayment
        ? {
            amount: Number(lastPayment.amount ?? 0),
            method: lastPayment.payment_method ?? "—",
            note: lastPayment.note,
            balanceBefore: Number(lastPayment.balance_before ?? 0),
            balanceAfter: Number(lastPayment.balance_after ?? 0),
            paidByName: lastPayment.paid_by_name ?? "Caja",
            paidAt: lastPayment.paid_at,
          }
        : null,
    });
  }

  async function openHistorialDetail(run: any) {
    setHistorialDetailRun(run);
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

  // Historial es un timeline único de movimientos guardados — pagos de
  // liquidación y adelantos mezclados y ordenados por fecha, no dos listas
  // separadas por "tipo de liquidación".
  const historialItems = React.useMemo(() => {
    const payments = selectedRunPayments.map((p: any) => ({
      kind: "pago" as const,
      at: p.paid_at as string,
      data: p,
    }));
    const advances = selectedAdvances.map((a: any) => ({
      kind: "adelanto" as const,
      at: a.advanced_at as string,
      data: a,
    }));
    return [...payments, ...advances].sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  }, [selectedRunPayments, selectedAdvances]);

  // Historial ya no se organiza por liquidación — se organiza por pago:
  // cada registro de settlement_payments es una fila propia (si una
  // liquidación tuvo 2 pagos, son 2 filas separadas). Este mapa solo
  // sirve para recuperar el run dueño de cada pago (período, comprobante,
  // "Ver detalle"), no para agrupar la vista.
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
    // deja vacío, solo se prepara (se puede pagar después desde
    // "Pagar", que ya va a mostrar el saldo pendiente de este run).
    const paymentAmount = Number(paymentForm.amount || 0);
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
      // pierde nada: queda como activeRun, listo para pagar desde
      // "Pagar" de nuevo.
      if (paymentAmount > 0 && (newRun as any)?.id) {
        const { error: payError } = await supabase.rpc("register_settlement_run_payment" as any, {
          p_settlement_run_id: (newRun as any).id,
          p_amount: paymentAmount,
          p_payment_method: paymentForm.method || "transferencia",
          p_note: paymentForm.note.trim() || null,
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
        setSelectedDetail("historial");
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
  }: {
    label: string;
    sublabel?: string;
    value: React.ReactNode;
    tone: "neutral" | "violet" | "green" | "rose";
    info?: React.ReactNode;
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
      <div className={cn("rounded-2xl border px-4 py-3", toneClass)}>
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
        <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
      </div>
    );
  };

  // Mitad de un segmented control (Comisiones | Historial) — una sola pieza
  // partida al medio, no dos botones sueltos: el borde/fondo compartido
  // vive en el contenedor (ver más abajo), acá solo cambia el resaltado de
  // la mitad activa.
  const ActionButton = ({
    id,
    children,
  }: {
    id: "detalle" | "historial";
    children: React.ReactNode;
  }) => {
    const active = selectedDetail === id;
    return (
      <button
        type="button"
        onClick={() => setSelectedDetail(id)}
        className={cn(
          "px-3.5 py-3 text-xs font-bold uppercase tracking-[0.14em] transition",
          active
            ? "bg-gradient-to-r from-sky-400/25 to-violet-500/25 text-white shadow-[inset_0_0_0_1px_rgba(167,139,250,0.35)]"
            : "text-white/45 hover:bg-white/[0.04] hover:text-white/70",
        )}
      >
        {children}
      </button>
    );
  };

  // Pagar es un botón de acción (como Adelantar), no una pestaña: abre
  // su modal directo, precargando el monto sugerido, sin tocar
  // selectedDetail.
  function openLiquidarModal(row: (typeof rows)[number] | null) {
    if (!row) return;
    if (paymentForm.amount === "") {
      const suggested = row.previousBalance + row.newCommissions - row.pendingAdvances;
      if (suggested > 0) {
        setPaymentForm((form) => ({ ...form, amount: String(Math.round(suggested)) }));
      }
    }
    setLiquidarModalOpen(true);
  }

  // Carga el detalle bajo demanda cuando se ve la pestaña "Comisiones"
  // (o cambia el profesional, o el corte "Liquidar hasta" elegido desde
  // la tarjeta "Período actual", mientras está abierta).
  React.useEffect(() => {
    if (selectedDetail !== "detalle" || !selectedRow) return;
    openDetail(selectedRow.id);
    // liquidarCutoffDate (el string elegido), no liquidarCutoffAt (el
    // Date derivado, que cambia cada minuto por nowClock aunque el
    // corte elegido siga siendo "hoy") — evita refetchear de más.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDetail, selectedRow?.id, commissionsVersion, liquidarCutoffDate]);

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
    ? selectedRow.previousBalance + liquidarNewCommissions - liquidarPendingAdvances
    : 0;
  const liquidarFinalTotal = liquidarBaseTotal + liquidarAdjustmentsSum - liquidarDeductionsSum;
  const liquidarValidAdjustmentsCount = validSettlementItems(adjustmentItems).length;
  const liquidarValidDeductionsCount = validSettlementItems(deductionItems).length;

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
        <div className="flex flex-col gap-4 border-b border-white/[0.065] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={selectedEmployeeId}
              onChange={(event) => {
                const nextId = event.target.value;
                setSelectedEmployeeId(nextId);
                // Cambiar de profesional nunca abre un modal solo — se
                // queda en la pantalla principal (Comisiones) mostrando
                // los datos del profesional entrante. Cierra cualquier
                // modal que hubiera quedado abierto para el anterior, así
                // no se reutiliza su estado (montos precargados, etc.).
                resetLiquidarForm();
                resetAdelantoForm();
                setLiquidarCutoffDate("");
                setPeriodInfoOpen(false);
                setHistorialDetailRun(null);
                setHistorialDetailServices(null);
                setSelectedDetail("detalle");
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
          <div className="grid grid-cols-2 gap-3 border-b border-white/[0.055] px-5 py-4">
            <StatCard
              label="Comisiones pendientes"
              sublabel="Período anterior"
              value={money(totals.previousBalance)}
              tone="neutral"
              info={LIQUIDACION_ANTERIOR_INFO_TEXT}
            />
            <StatCard
              label="Comisiones generadas"
              sublabel="Período actual"
              value={money(liquidarNewCommissions)}
              tone="violet"
              info={COMISIONES_NUEVAS_INFO_TEXT}
            />
            <StatCard
              label="Adelantos"
              value={liquidarPendingAdvances > 0 ? `−${money(liquidarPendingAdvances)}` : money(0)}
              tone="rose"
              info={ADELANTOS_INFO_TEXT}
            />
            <StatCard
              label="Total a pagar"
              value={money(Math.max(totals.previousBalance + liquidarNewCommissions - liquidarPendingAdvances, 0))}
              tone="green"
            />
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
            {/* Adelantar y Pagar: acciones principales, compactas y
                centradas (no estiradas a lo ancho de una columna). */}
            <div className="flex items-center justify-center gap-4 border-b border-white/[0.06] bg-white/[0.018] px-5 py-3">
              <button
                type="button"
                onClick={() => setAdelantoModalOpen(true)}
                className="w-28 rounded-xl bg-rose-500 px-3 py-2 text-xs font-bold text-white shadow-[0_0_18px_rgba(244,63,94,0.26)] transition hover:brightness-110"
              >
                Adelantar
              </button>
              <button
                type="button"
                onClick={() => openLiquidarModal(selectedRow)}
                className="w-28 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-white shadow-[0_0_18px_rgba(16,185,129,0.28)] transition hover:brightness-110"
              >
                Pagar
              </button>
            </div>

            {/* Selector Comisiones | Historial: una sola pieza partida al
                medio (borde/fondo compartidos acá, divide-x como línea
                central), no dos botones sueltos — ActionButton solo
                resalta la mitad activa. */}
            <div className="border-b border-white/[0.06] bg-white/[0.018] px-5 py-2">
              <div className="grid grid-cols-2 divide-x divide-white/[0.07] overflow-hidden rounded-xl border border-white/[0.07]">
                <ActionButton id="detalle">Comisiones</ActionButton>
                <ActionButton id="historial">Historial</ActionButton>
              </div>
            </div>

            {selectedDetail === "detalle" && (
              <div className="min-h-0 flex-1 overflow-visible sm:overflow-y-auto px-5 py-4 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
                {detailError && (
                  <div className="mb-3 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-xs text-rose-200">
                    {detailError}
                  </div>
                )}
                {/* Desktop: tabla. En mobile, tarjetas verticales debajo. */}
                <div className="hidden overflow-hidden rounded-2xl border border-white/[0.07] bg-black/18 sm:block">
                  <div className="grid grid-cols-[92px_minmax(110px,1fr)_minmax(140px,1.2fr)_90px_70px_60px_90px_100px_90px] gap-3 border-b border-white/[0.06] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/38">
                    <div>Fecha y hora</div>
                    <div>Cliente</div>
                    <div>Servicio</div>
                    <div className="text-right">Precio</div>
                    <div className="text-right">Desc.</div>
                    <div className="text-right">%Com.</div>
                    <div className="text-right">Comisión</div>
                    <div>Método</div>
                    <div>Estado</div>
                  </div>
                  {loadingDetail ? (
                    <div className="px-4 py-10 text-center text-sm text-white/45">
                      Cargando…
                    </div>
                  ) : !detailRows || detailRows.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-white/45">
                      Sin comisiones nuevas hasta esta fecha.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/[0.05]">
                      {detailRows.map((c: any) => {
                        const sale = c.sale ?? {};
                        const saleDate = c.created_at ? new Date(c.created_at) : null;
                        const date = saleDate
                          ? saleDate.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })
                          : "—";
                        const time = saleDate
                          ? saleDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })
                          : null;
                        const method =
                          PAY_METHOD_LABEL[
                            String(sale.method ?? sale.payment_method ?? "") as PayMethod
                          ] ??
                          sale.method ??
                          sale.payment_method ??
                          "—";
                        return (
                          <div
                            key={c.id}
                            title={`ID: ${c.id}`}
                            className="grid grid-cols-[92px_minmax(110px,1fr)_minmax(140px,1.2fr)_90px_70px_60px_90px_100px_90px] gap-3 px-4 py-3 text-sm transition hover:bg-white/[0.025]"
                          >
                            <div className="text-white/52">
                              {date}
                              {time && <div className="text-[11px] text-white/35">{time}</div>}
                            </div>
                            <div className="truncate text-white/82">
                              {sale.client_name ?? "Sin cliente"}
                            </div>
                            <div className="truncate text-white/82">
                              {sale.service_name ?? "Servicio"}
                            </div>
                            <div className="text-right tabular-nums text-white/72">
                              {money(Number(sale.total ?? sale.amount ?? 0))}
                            </div>
                            <div className="text-right tabular-nums text-white/52">—</div>
                            <div className="text-right tabular-nums text-white/52">
                              {c.commission_pct != null ? `${c.commission_pct}%` : "—"}
                            </div>
                            <div className="text-right font-bold tabular-nums text-violet-300">
                              {money(Number(c.pending_amount ?? c.amount ?? 0))}
                            </div>
                            <div className="text-white/52">{method}</div>
                            <div className="text-white/52 capitalize">{c.status}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="sm:hidden">
                  {loadingDetail ? (
                    <div className="px-2 py-10 text-center text-sm text-white/45">
                      Cargando…
                    </div>
                  ) : !detailRows || detailRows.length === 0 ? (
                    <div className="px-2 py-10 text-center text-sm text-white/45">
                      Sin comisiones nuevas hasta esta fecha.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {detailRows.map((c: any) => {
                        const sale = c.sale ?? {};
                        const saleDate = c.created_at ? new Date(c.created_at) : null;
                        const date = saleDate
                          ? saleDate.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })
                          : "—";
                        const time = saleDate
                          ? saleDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })
                          : null;
                        const method =
                          PAY_METHOD_LABEL[
                            String(sale.method ?? sale.payment_method ?? "") as PayMethod
                          ] ??
                          sale.method ??
                          sale.payment_method ??
                          "—";
                        return (
                          <div
                            key={`mobile-${c.id}`}
                            className="rounded-2xl border border-white/[0.07] bg-black/18 px-3.5 py-3 text-xs"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-semibold text-white/82">
                                  {sale.client_name ?? "Sin cliente"}
                                </div>
                                <div className="mt-0.5 truncate text-white/60">
                                  {sale.service_name ?? "Servicio"}
                                </div>
                                <div className="mt-1 text-white/45">
                                  Precio: {money(Number(sale.total ?? sale.amount ?? 0))}
                                </div>
                              </div>
                              <div className="shrink-0 space-y-0.5 text-right">
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
                                  {date}
                                  {time && <span className="ml-1 font-normal normal-case text-white/35">{time}</span>}
                                </div>
                                <div className="text-white/60">{method}</div>
                                <div className="font-bold tabular-nums text-violet-300">
                                  Comisión: {money(Number(c.pending_amount ?? c.amount ?? 0))}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {selectedDetail === "historial" && (
              <div className="min-h-0 flex-1 overflow-visible sm:overflow-y-auto px-5 py-4 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
                {historialItems.length === 0 ? (
                  <div className="rounded-xl border border-white/[0.07] bg-black/18 px-4 py-8 text-center text-sm text-white/45">
                    Todavía no se registró ningún pago ni adelanto.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {historialItems.map((item) => {
                      const fmtDateTime = (iso: string) =>
                        new Date(iso).toLocaleString("es-AR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        });

                      if (item.kind === "adelanto") {
                        const advance = item.data;
                        return (
                          <div
                            key={`adelanto-${advance.id}`}
                            className="rounded-2xl border border-white/[0.07] bg-black/18 px-4 py-3.5 text-sm"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="font-bold text-white">{selectedRow.name}</div>
                                <div className="text-xs text-white/50">
                                  {advance.advanced_at ? fmtDateTime(advance.advanced_at) : "—"}
                                </div>
                              </div>
                              <span className="rounded-full bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300 ring-1 ring-amber-400/20">
                                Adelanto
                              </span>
                            </div>

                            <div className="mt-3 space-y-1 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="text-white/45">Monto pagado</span>
                                <span className="font-bold tabular-nums text-amber-300">{money(Number(advance.amount ?? 0))}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-white/45">Método</span>
                                <span className="font-semibold capitalize text-white/80">
                                  {advance.payment_method ?? "—"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-white/45">Registrado por</span>
                                <span className="font-semibold text-white/80">{displayResponsable(advance.registered_by_name)}</span>
                              </div>
                              {advance.note && (
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-white/45">Nota</span>
                                  <span className="truncate font-semibold text-white/80">{advance.note}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      }

                      const payment = item.data;
                      const run = runById.get(payment.settlement_run_id);
                      const balanceAfter = Number(payment.balance_after ?? 0);
                      const isFull = balanceAfter <= 0;
                      return (
                        <div
                          key={`pago-${payment.id}`}
                          className="rounded-2xl border border-white/[0.07] bg-black/18 px-4 py-3.5 text-sm"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="font-bold text-white">{selectedRow.name}</div>
                              <div className="text-xs text-white/50">
                                {payment.paid_at ? fmtDateTime(payment.paid_at) : "—"}
                              </div>
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
                              <span className="font-bold tabular-nums text-emerald-300">{money(Number(payment.amount ?? 0))}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-white/45">Método</span>
                              <span className="font-semibold capitalize text-white/80">
                                {PAY_METHOD_LABEL[payment.payment_method as PayMethod] ?? payment.payment_method ?? "—"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-white/45">Registrado por</span>
                              <span className="font-semibold text-white/80">{displayResponsable(payment.paid_by_name)}</span>
                            </div>
                            {payment.note && (
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-white/45">Nota</span>
                                <span className="truncate font-semibold text-white/80">{payment.note}</span>
                              </div>
                            )}
                          </div>

                          {run && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                onClick={() => openHistorialDetail(run)}
                                className="rounded-full bg-white/[0.04] px-3 py-1 text-[11px] font-medium ring-1 ring-white/10 hover:bg-white/[0.07]"
                              >
                                Ver detalle
                              </button>
                              <button
                                onClick={async () => {
                                  const text = buildHistorialComprobante(run);
                                  const result = await shareComprobante(text, `Liquidación #${run.run_number}`);
                                  if (result === "copied") toast.success("Comprobante copiado al portapapeles");
                                  if (result === "failed") toast.error("No se pudo compartir");
                                }}
                                className="rounded-full bg-white/[0.04] px-3 py-1 text-[11px] font-medium ring-1 ring-white/10 hover:bg-white/[0.07]"
                              >
                                Compartir comprobante
                              </button>
                            </div>
                          )}
                        </div>
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

      <AgendaCenteredModal
        open={Boolean(historialDetailRun)}
        onOpenChange={(v) => {
          if (!v) {
            setHistorialDetailRun(null);
            setHistorialDetailServices(null);
          }
        }}
        lockOutside={false}
        title={historialDetailRun ? `Liquidación #${historialDetailRun.run_number}` : ""}
        subtitle={
          historialDetailRun ? (
            <div className="space-y-0.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/35">Período liquidado</div>
              <div>
                {historialDetailRun.period_start_at
                  ? `Desde ${fmtDetalleDateTime(historialDetailRun.period_start_at)}`
                  : "Primera liquidación"}
              </div>
              <div>{`Hasta ${fmtDetalleDateTime(historialDetailRun.prepared_at)}`}</div>
            </div>
          ) : undefined
        }
        footer={
          historialDetailRun && (
            <div className="flex w-full gap-2">
              <button
                type="button"
                onClick={() => downloadComprobante(buildHistorialComprobante(historialDetailRun), `Liquidación #${historialDetailRun.run_number}`)}
                className="flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-semibold text-white/75 transition hover:bg-white/[0.07]"
              >
                Descargar comprobante
              </button>
              <button
                type="button"
                onClick={async () => {
                  const result = await shareComprobante(
                    buildHistorialComprobante(historialDetailRun),
                    `Liquidación #${historialDetailRun.run_number}`,
                  );
                  if (result === "copied") toast.success("Comprobante copiado al portapapeles");
                  if (result === "failed") toast.error("No se pudo compartir");
                }}
                className="flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-semibold text-white/75 transition hover:bg-white/[0.07]"
              >
                Compartir comprobante
              </button>
            </div>
          )
        }
      >
        {historialDetailRun && (() => {
          const run = historialDetailRun;
          const remaining = Math.max(Number(run.total_to_settle) - Number(run.amount_paid), 0);
          const runPayments = allRunPayments
            .filter((p: any) => p.settlement_run_id === run.id)
            .sort((a: any, b: any) => String(a.paid_at ?? "").localeCompare(String(b.paid_at ?? "")));
          // Con el flujo actual (cada "Pagar" prepara un run nuevo), un run
          // tiene como mucho un pago — se toma el último por las dudas.
          const primaryPayment = runPayments[runPayments.length - 1] ?? null;
          const runAdvances = allAdvances
            .filter((a: any) => a.settlement_run_id === run.id)
            .sort((a: any, b: any) => String(a.advanced_at ?? "").localeCompare(String(b.advanced_at ?? "")));
          // Servicios reales: descarta comisión $0 (datos viejos/incompletos
          // vinculados por error, no comisiones efectivamente cobradas).
          const realServices = (historialDetailServices ?? []).filter(
            (c: any) => Number(c.amount ?? 0) > 0,
          );
          return (
            <div className="space-y-4">
              <div className="space-y-1.5 rounded-2xl border border-white/[0.08] bg-black/25 p-3.5 text-sm">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/38">
                  Resumen
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/50">Comisiones pendientes anteriores</span>
                  <span className="font-semibold text-white">{money(Number(run.previous_balance ?? 0))}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/50">Comisiones generadas en el período</span>
                  <span className="font-semibold text-white">{money(Number(run.new_commissions ?? 0))}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/50">Adicionales</span>
                  <span className="font-semibold text-emerald-300">+{money(Number(run.adjustments ?? 0))}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/50">Deducciones</span>
                  <span className="font-semibold text-rose-300">−{money(Number(run.deductions ?? 0))}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/50">Adelantos descontados</span>
                  <span className="font-semibold text-rose-300">−{money(Number(run.advances ?? 0))}</span>
                </div>
                <div className="mt-1 flex items-center justify-between border-t border-white/[0.08] pt-2">
                  <span className="font-bold text-white/70">Total final</span>
                  <span className="text-base font-bold text-white">{money(Number(run.total_to_settle))}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/50">Monto pagado</span>
                  <span className="font-semibold text-emerald-300">{money(Number(run.amount_paid))}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/50">Saldo pendiente</span>
                  <span className={cn("font-semibold", remaining > 0 ? "text-rose-300" : "text-white/60")}>
                    {money(remaining)}
                  </span>
                </div>
              </div>

              {primaryPayment && (
                <div className="space-y-1.5 rounded-2xl border border-white/[0.07] bg-black/20 p-3.5 text-sm">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/38">
                    Datos del pago
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/50">Método</span>
                    <span className="font-semibold capitalize text-white">
                      {PAY_METHOD_LABEL[primaryPayment.payment_method as PayMethod] ?? primaryPayment.payment_method ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/50">Fecha y hora del pago</span>
                    <span className="font-semibold text-white">
                      {primaryPayment.paid_at ? fmtDetalleDateTime(primaryPayment.paid_at) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/50">Registrado por</span>
                    <span className="font-semibold text-white">{displayResponsable(primaryPayment.paid_by_name)}</span>
                  </div>
                  {primaryPayment.note && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white/50">Nota</span>
                      <span className="truncate font-semibold text-white">{primaryPayment.note}</span>
                    </div>
                  )}
                </div>
              )}

              {Array.isArray(run.adjustment_items) && run.adjustment_items.length > 0 && (
                <div className="space-y-1 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/70">Adicionales</div>
                  {run.adjustment_items.map((item: any, i: number) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-white/60">{item.reason}</span>
                      <span className="font-semibold text-emerald-300">+{money(Number(item.amount))}</span>
                    </div>
                  ))}
                </div>
              )}
              {Array.isArray(run.deduction_items) && run.deduction_items.length > 0 && (
                <div className="space-y-1 rounded-2xl border border-rose-400/15 bg-rose-400/[0.04] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-rose-300/70">Deducciones</div>
                  {run.deduction_items.map((item: any, i: number) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-white/60">{item.reason}</span>
                      <span className="font-semibold text-rose-300">−{money(Number(item.amount))}</span>
                    </div>
                  ))}
                </div>
              )}

              {runAdvances.length > 0 && (
                <div className="space-y-1.5 rounded-2xl border border-rose-400/15 bg-rose-400/[0.04] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-rose-300/70">
                    Adelantos descontados
                  </div>
                  {runAdvances.map((advance: any) => (
                    <div key={advance.id} className="space-y-0.5 rounded-lg bg-black/15 p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-white/60">
                          {advance.advanced_at ? fmtDetalleDateTime(advance.advanced_at) : "—"}
                        </span>
                        <span className="font-semibold text-rose-300">−{money(Number(advance.amount ?? 0))}</span>
                      </div>
                      <div className="flex items-center justify-between text-white/50">
                        <span className="capitalize">{advance.payment_method ?? "—"}</span>
                        {advance.note && <span className="truncate">{advance.note}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/38">
                  Servicios incluidos
                </div>
                {loadingHistorialDetail ? (
                  <div className="py-6 text-center text-sm text-white/45">Cargando…</div>
                ) : realServices.length === 0 ? (
                  <div className="py-6 text-center text-sm text-white/45">Sin servicios en esta liquidación.</div>
                ) : (
                  <div className="space-y-2">
                    {realServices.map((c: any) => {
                      const sale = c.sale ?? {};
                      const saleDate = c.created_at ? new Date(c.created_at) : null;
                      const method =
                        PAY_METHOD_LABEL[String(sale.method ?? sale.payment_method ?? "") as PayMethod] ??
                        sale.method ??
                        sale.payment_method ??
                        "—";
                      return (
                        <div key={c.id} className="rounded-xl border border-white/[0.07] bg-black/15 p-2.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-white/82">{sale.client_name ?? "Sin cliente"}</span>
                            <span className="font-bold tabular-nums text-violet-300">
                              {money(Number(c.amount ?? 0))}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2 text-white/50">
                            <span className="truncate">{sale.service_name ?? "Servicio"}</span>
                            <span className="shrink-0">
                              {money(Number(sale.total ?? sale.amount ?? 0))}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2 text-white/40">
                            <span>
                              {saleDate
                                ? saleDate.toLocaleString("es-AR", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    hour12: false,
                                  })
                                : "—"}
                            </span>
                            <span>{method}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </AgendaCenteredModal>

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
        const payDisabled =
          preparingRunFor === selectedRow.id || !liquidarPeriodValid || liquidarFinalTotal <= 0;

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
                  <span className="font-bold text-white/70">Total final a pagar</span>
                  <span className="text-base font-bold text-emerald-300">{money(liquidarFinalTotal)}</span>
                </div>
              </div>

              <div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="space-y-1.5 text-xs font-semibold text-white/55">
                    Monto a pagar
                    <input
                      type="number"
                      min={0}
                      max={liquidarFinalTotal > 0 ? liquidarFinalTotal : undefined}
                      value={paymentForm.amount}
                      onChange={(event) => setPaymentForm((form) => ({ ...form, amount: event.target.value }))}
                      placeholder="Ej: 451.784"
                      className="h-11 w-full rounded-2xl border border-white/[0.08] bg-black/30 px-3 text-base text-white outline-none placeholder:text-white/30 focus:border-violet-300/35"
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-semibold text-white/55">
                    Método
                    <select
                      value={paymentForm.method}
                      onChange={(event) => setPaymentForm((form) => ({ ...form, method: event.target.value }))}
                      className="h-11 w-full rounded-2xl border border-white/[0.08] bg-black/30 px-3 text-base text-white outline-none focus:border-violet-300/35"
                    >
                      <option value="efectivo">Efectivo</option>
                      <option value="transferencia">Transferencia</option>
                      <option value="debito">Débito</option>
                      <option value="mercado pago">Mercado Pago</option>
                    </select>
                  </label>
                </div>
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

type CierreMetodoDetalle = {
  ingresos: number;
  gastos: number;
  utilidad: number;
};

type CajaEvento = {
  tipo?: string | null;
  fecha_hora?: string | null;
  hora?: string | null;
  usuario?: string | null;
  observacion?: string | null;
  motivo?: string | null;
  [key: string]: unknown;
};

function cajaEventosArray(value: unknown): CajaEvento[] {
  return Array.isArray(value) ? (value as CajaEvento[]) : [];
}

function appendCajaEvento(
  prevEventos: unknown,
  evento: CajaEvento,
): CajaEvento[] {
  return [...cajaEventosArray(prevEventos), evento];
}

function cleanCajaEventosForDisplay(events: CajaEvento[]): CajaEvento[] {
  const cleaned: CajaEvento[] = [];

  for (const event of events) {
    const previous = cleaned[cleaned.length - 1];
    const sameAsPrevious =
      previous &&
      previous.tipo === event.tipo &&
      previous.hora === event.hora &&
      previous.usuario === event.usuario &&
      (previous.observacion ?? null) === (event.observacion ?? null) &&
      (previous.motivo ?? null) === (event.motivo ?? null);

    if (!sameAsPrevious) cleaned.push(event);
  }

  return cleaned;
}

function isCajaCerradaRow(cierre: any) {
  return String(cierre?.estado ?? "").toLowerCase() === "cerrada";
}

function isCajaReabiertaRow(cierre: any) {
  return String(cierre?.estado ?? "").toLowerCase() === "reabierta";
}

function cajaDateKey(date = new Date()) {
  return date.toLocaleDateString("sv-SE");
}

function cajaTimeLabel(date = new Date()) {
  return (
    date.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + "hs"
  );
}

function cajaHoraDisplay(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "—") return "—";
  const direct = raw.match(/^(\d{1,2}):(\d{2})/);
  if (direct) return `${direct[1].padStart(2, "0")}:${direct[2]}hs`;

  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const min = ampm[2];
    const suffix = ampm[3].toLowerCase();
    if (suffix.includes("p") && h < 12) h += 12;
    if (suffix.includes("a") && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${min}hs`;
  }

  return raw.replace(/\s*a\.\s*m\.?/i, "hs").replace(/\s*p\.\s*m\.?/i, "hs");
}

function cajaEventTimeToMinutes(value?: string | null) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function sortCajaEventos(events: CajaEvento[]) {
  return [...events].sort((a, b) => {
    const at = String(a.fecha_hora ?? "");
    const bt = String(b.fecha_hora ?? "");
    if (at && bt) return at.localeCompare(bt);
    return cajaEventTimeToMinutes(a.hora) - cajaEventTimeToMinutes(b.hora);
  });
}

function getCajaLastEvent(cierre: any, tipo?: string) {
  const events = sortCajaEventos(cajaEventosArray(cierre?.eventos));
  const filtered = tipo ? events.filter((event) => event.tipo === tipo) : events;
  return filtered[filtered.length - 1] ?? null;
}

function getCajaFirstEvent(cierre: any, tipo?: string) {
  const events = sortCajaEventos(cajaEventosArray(cierre?.eventos));
  return (tipo ? events.find((event) => event.tipo === tipo) : events[0]) ?? null;
}

function cierreNeedsAutomaticClose(cierre: any, today = cajaDateKey()) {
  if (!cierre?.id) return false;
  if (!isCajaReabiertaRow(cierre)) return false;
  const fecha = String(cierre?.fecha ?? "").slice(0, 10);
  return Boolean(fecha && fecha < today);
}

// Snapshot financiero de un día puntual (no necesariamente hoy) — se usa para
// armar el registro de un cierre automático de un día que nunca se cerró,
// con exactamente la misma forma de datos que guarda un cierre manual
// (ver CierreCajaBtn.confirmar), para que el detalle del historial funcione
// igual sea cual sea el tipo de cierre.
async function buildCierreSnapshotForDate(businessId: string, dateStr: string) {
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999`);

  const [payRes, expRes] = await Promise.allSettled([
    supabase
      .from("payments")
      .select(
        "id,total,amount,method,payment_method,client_name,service_name,created_at,employee_id,charged_by,charge_type",
      )
      .eq("business_id", businessId)
      .gte("created_at", dayStart.toISOString())
      .lte("created_at", dayEnd.toISOString()),
    supabase
      .from("expenses")
      .select("id,name,amount,type,category,payment_method,date,note,created_at,user_name,created_by")
      .eq("business_id", businessId)
      .eq("date", dateStr),
  ]);

  const payments =
    payRes.status === "fulfilled" && !payRes.value.error ? ((payRes.value.data ?? []) as any[]) : [];
  const expenses =
    expRes.status === "fulfilled" && !expRes.value.error ? ((expRes.value.data ?? []) as any[]) : [];

  const totalCobrado = payments.reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
  const totalGastos = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const utilidad = totalCobrado - totalGastos;

  const detalleMetodos: Record<string, CierreMetodoDetalle> = {};
  const ensure = (method: string | null | undefined) => {
    const key = normalizeCierreMethodKey(method);
    if (!detalleMetodos[key]) detalleMetodos[key] = { ingresos: 0, gastos: 0, utilidad: 0 };
    return detalleMetodos[key];
  };
  for (const p of payments) {
    ensure(p.method ?? p.payment_method).ingresos += Number(p.total ?? p.amount ?? 0);
  }
  for (const e of expenses) {
    ensure(e.payment_method ?? e.method).gastos += Number(e.amount ?? 0);
  }
  Object.values(detalleMetodos).forEach((row) => {
    row.utilidad = row.ingresos - row.gastos;
  });

  const cobrosSnapshot = payments.map((p) => ({
    id: p.id,
    hora: p.created_at
      ? new Date(p.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
      : null,
    cliente: p.client_name ?? null,
    profesional: p.employee_name ?? p.professional_name ?? null,
    servicio: p.service_name ?? null,
    metodo: p.method ?? p.payment_method ?? null,
    monto: Number(p.total ?? p.amount ?? 0),
    usuario: p.charged_by ?? p.created_by ?? null,
  }));

  const gastosSnapshot = expenses.map((e) => ({
    id: e.id,
    hora: e.created_at
      ? new Date(e.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
      : null,
    nombre: e.name ?? e.concept ?? e.category ?? "Gasto",
    tipo: e.type ?? e.category ?? null,
    metodo: e.payment_method ?? e.method ?? null,
    monto: Number(e.amount ?? 0),
    nota: e.note ?? null,
    usuario: e.user_name ?? e.created_by ?? null,
  }));

  // Pendientes no tienen una fecha de "creado ese día" reconstruible con
  // precisión (no hay columna de fecha en la cola de Pendientes, ver
  // useCajaData) — este snapshot es del estado ACTUAL al momento del
  // cierre automático (que corre al otro día, al volver a abrir Caja), no
  // una reconstrucción histórica exacta de cómo estaba a medianoche.
  const [apptRes, bsRes] = await Promise.allSettled([
    supabase
      .from("appointments")
      .select("id,client_name,service_name,service_price,starts_at,notes,status")
      .eq("business_id", businessId)
      .ilike("notes", "%[PENDIENTE_CAJA]%")
      .not("status", "in", "(charged,cancelled,blocked)"),
    supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle(),
  ]);
  const pendingAppts = apptRes.status === "fulfilled" && !apptRes.value.error ? ((apptRes.value.data ?? []) as any[]) : [];
  const bsSchedule = (bsRes.status === "fulfilled" && !bsRes.value.error ? (bsRes.value.data?.schedule ?? {}) : {}) as Record<string, unknown>;
  const walkInPending = (Array.isArray(bsSchedule._pendingWalkInSales) ? (bsSchedule._pendingWalkInSales as any[]) : [])
    .filter((w) => w.status !== "rechazado");

  const pendientesDetalle = [
    ...pendingAppts.map((a) => ({
      id: a.id,
      cliente: a.client_name ?? null,
      servicio: a.service_name ?? null,
      monto: Number(a.service_price ?? 0),
      hora_envio: a.starts_at ? new Date(a.starts_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : null,
    })),
    ...walkInPending.map((w) => ({
      id: w.id,
      cliente: w.client_name ?? null,
      servicio: w.service_name ?? null,
      monto: Number(w.service_price ?? 0),
      hora_envio: w.starts_at ? new Date(w.starts_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : null,
    })),
  ];
  const pendientesMonto = pendientesDetalle.reduce((s, p) => s + p.monto, 0);

  return {
    totalCobrado,
    totalGastos,
    utilidad,
    detalleMetodos,
    cobrosSnapshot,
    gastosSnapshot,
    cantidadCobros: payments.length,
    hadActivity: payments.length > 0 || expenses.length > 0,
    pendientesCount: pendientesDetalle.length,
    pendientesMonto,
    pendientesDetalle,
  };
}

async function autoCloseExpiredCajaSession({
  businessId,
  userEmail,
}: {
  businessId: string | null;
  userEmail?: string | null;
}) {
  if (!businessId) return { closed: false };

  const today = cajaDateKey();
  const { data: lastCierre, error } = await supabase
    .from("caja_cierres" as any)
    .select("*")
    .eq("business_id", businessId)
    .order("fecha", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  // Caso 1: una caja REABIERTA (ver reabrirCaja) que se dejó abierta y ya
  // pasó su día — se vuelve a cerrar, manteniendo la fecha original del
  // registro (el día que corresponde cerrar), con tipo "automático".
  if (cierreNeedsAutomaticClose(lastCierre, today)) {
    const autoDate = new Date(`${today}T00:00:00`);
    const evento: CajaEvento = {
      tipo: "cierre",
      modo: "automatico",
      fecha_hora: autoDate.toISOString(),
      hora: "00:00hs",
      usuario: "Automático",
      observacion: "Cierre automático de fin de día.",
    };

    const { data: updated, error: updateError } = await supabase
      .from("caja_cierres" as any)
      .update({
        estado: "cerrada",
        tipo_cierre: "automatico",
        hora_cierre: "00:00hs",
        closed_by: "Automático",
        usuario_nombre: "Automático",
        observacion: (lastCierre as any).observacion ?? "Cierre automático de fin de día.",
        eventos: appendCajaEvento((lastCierre as any).eventos, evento),
        updated_at: new Date().toISOString(),
      })
      .eq("id", (lastCierre as any).id)
      .eq("business_id", businessId)
      .eq("estado", "reabierta")
      .select("id")
      .maybeSingle();

    if (updateError) throw updateError;
    if (updated?.id) {
      window.dispatchEvent(new CustomEvent("clippr:caja-cierre-guardado"));
      return { closed: true };
    }
  }

  // Caso 2: la caja nunca se cerró (ni manual ni automáticamente) el día de
  // ayer — la "Caja abierta" de siempre, sin ningún cierre registrado. Se
  // cierra ahora, ya pasada la medianoche, para que hoy arranque limpio.
  // Si ayer ya tiene un registro "cerrada" (manual o automático), no se
  // toca: así nunca se duplica ni se pisa un cierre manual del día.
  // Nota de alcance: esto retrocede solo UN día (ayer) por corrida — si la
  // Caja no se abre varios días seguidos, al volver a entrar se cierra el
  // día inmediato anterior, no cada día salteado.
  const yesterday = cajaDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const { data: yesterdayCierre, error: yError } = await supabase
    .from("caja_cierres" as any)
    .select("id,eventos,estado")
    .eq("business_id", businessId)
    .eq("fecha", yesterday)
    .maybeSingle();
  if (yError) throw yError;

  if (!isCajaCerradaRow(yesterdayCierre)) {
    const snapshot = await buildCierreSnapshotForDate(businessId, yesterday);
    // Un negocio que nunca usó Caja (sin cierres previos ni actividad ayer)
    // no debe generar un cierre "automático" vacío de la nada.
    if (lastCierre?.id || snapshot.hadActivity) {
      const evento: CajaEvento = {
        tipo: "cierre",
        modo: "automatico",
        fecha_hora: new Date(`${yesterday}T23:59:59`).toISOString(),
        hora: "00:00hs",
        usuario: "Automático",
        observacion: "Cierre automático de fin de día.",
        pendientes_count: snapshot.pendientesCount,
        pendientes_monto: snapshot.pendientesMonto,
        pendientes_detalle: snapshot.pendientesDetalle,
      };
      const payload = {
        business_id: businessId,
        fecha: yesterday,
        hora_cierre: "00:00hs",
        usuario_nombre: "Automático",
        closed_by: "Automático",
        tipo_cierre: "automatico",
        estado: "cerrada",
        observacion: "Cierre automático de fin de día.",
        total_cobrado: snapshot.totalCobrado,
        total_gastos: snapshot.totalGastos,
        utilidad: snapshot.utilidad,
        cantidad_cobros: snapshot.cantidadCobros,
        detalle_metodos_pago: snapshot.detalleMetodos,
        cobros_snapshot: snapshot.cobrosSnapshot,
        gastos_snapshot: snapshot.gastosSnapshot,
        eventos: appendCajaEvento((yesterdayCierre as any)?.eventos, evento),
        updated_at: new Date().toISOString(),
      };

      const query = (yesterdayCierre as any)?.id
        ? supabase
            .from("caja_cierres" as any)
            .update(payload)
            .eq("id", (yesterdayCierre as any).id)
            .eq("business_id", businessId)
            .neq("estado", "cerrada")
            .select("id")
            .maybeSingle()
        : supabase.from("caja_cierres" as any).insert(payload).select("id").maybeSingle();

      const { data: savedYesterday, error: saveError } = await query;
      if (saveError) throw saveError;
      if (savedYesterday?.id) {
        window.dispatchEvent(new CustomEvent("clippr:caja-cierre-guardado"));
        return { closed: true };
      }
    }
  }

  return { closed: false };
}

function paymentMethodLabel(method: string) {
  return PAY_METHOD_LABEL[method as PayMethod] ?? method ?? "Sin método";
}

// `payments.method` guarda claves en inglés ("cash", "transfer", "card",
// "mp"...) pero `expenses.payment_method` guarda texto en español
// ("efectivo", "transferencia", "débito", "crédito", "mercado pago"...).
// Si se agrupa el desglose por método usando la clave cruda, "cash" y
// "efectivo" terminan como DOS filas separadas (una solo con ingresos,
// otra solo con gastos) aunque ambas se vean como "Efectivo" en pantalla.
// Esta función normaliza cualquiera de los dos vocabularios a la misma
// clave canónica (la que ya usa PAY_METHOD_LABEL) antes de agrupar.
function normalizeCierreMethodKey(method: string | null | undefined): string {
  const raw = String(method || "").trim().toLowerCase();
  if (!raw) return "cash";
  const stripped = raw.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (stripped === "cash" || stripped === "efectivo") return "cash";
  if (stripped === "transfer" || stripped === "transferencia") return "transfer";
  if (
    stripped === "card" ||
    stripped === "tarjeta" ||
    stripped === "debito" ||
    stripped === "credito"
  )
    return "card";
  if (stripped === "mp" || stripped === "mercado pago" || stripped === "mercadopago")
    return "mp";
  if (stripped === "qr") return "qr";
  if (stripped === "cuenta") return "cuenta";
  return raw;
}

function CierreCajaBtn({
  paymentsToday,
  expensesToday,
  pendingCharges,
  businessId,
  userEmail,
  onCajaCerrada,
}: {
  paymentsToday: ReturnType<typeof useCajaData>["paymentsToday"];
  expensesToday: ReturnType<typeof useCajaData>["expensesToday"];
  pendingCharges: ReturnType<typeof useCajaData>["pendingCharges"];
  businessId: string | null;
  userEmail: string | null;
  onCajaCerrada: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);

  const today = new Date().toLocaleDateString("sv-SE");

  const todayPayments = paymentsToday.filter(
    (p) => new Date(p.created_at).toLocaleDateString("sv-SE") === today,
  );

  const todayExpenses = expensesToday.filter((e: any) => {
    if (e.date) return e.date === today;
    if (e.created_at)
      return new Date(e.created_at).toLocaleDateString("sv-SE") === today;
    return true;
  });

  const totalCobrado = todayPayments.reduce(
    (s, p) => s + Number((p as any).total ?? (p as any).amount ?? 0),
    0,
  );
  const totalGastos = todayExpenses.reduce(
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

    for (const p of todayPayments) {
      const row = ensure((p as any).method ?? (p as any).payment_method);
      row.ingresos += Number((p as any).total ?? (p as any).amount ?? 0);
    }

    for (const e of todayExpenses) {
      const row = ensure((e as any).payment_method ?? (e as any).method);
      row.gastos += Number((e as any).amount ?? 0);
    }

    Object.values(detail).forEach((row) => {
      row.utilidad = row.ingresos - row.gastos;
    });

    return detail;
  }, [todayPayments, todayExpenses]);

  const cobrosSnapshot = todayPayments.map((p: any) => ({
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

  const gastosSnapshot = todayExpenses.map((e: any) => ({
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
        pendientes_count: pendingCharges.length,
        pendientes_monto: pendientesMonto,
        pendientes_detalle: pendientesSnapshot,
      };

      const { data: existing } = await supabase
        .from("caja_cierres" as any)
        .select("id,eventos,estado")
        .eq("business_id", businessId)
        .eq("fecha", today)
        .maybeSingle();

      if (existing?.id && isCajaCerradaRow(existing)) {
        toast.info("La caja ya está cerrada");
        setOpen(false);
        onCajaCerrada();
        return;
      }

      const payload = {
        business_id: businessId,
        fecha: today,
        hora_cierre: hora,
        usuario_id: null,
        usuario_nombre: userEmail ?? "Caja",
        total_cobrado: totalCobrado,
        total_gastos: totalGastos,
        utilidad,
        cantidad_cobros: todayPayments.length,
        detalle_metodos_pago: detalleMetodos,
        cobros_snapshot: cobrosSnapshot,
        gastos_snapshot: gastosSnapshot,
        observacion: obs.trim() || null,
        tipo_cierre: "manual",
        estado: "cerrada",
        eventos: appendCajaEvento((existing as any)?.eventos, cierreEvento),
        updated_at: now.toISOString(),
      };

      const query = existing?.id
        ? supabase
            .from("caja_cierres" as any)
            .update(payload)
            .eq("id", (existing as any).id)
            .eq("business_id", businessId)
            .neq("estado", "cerrada")
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
      toast.success("Cierre registrado correctamente");
      setOpen(false);
      setObs("");
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

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold">Cerrar caja</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date().toLocaleDateString("es-AR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-sm"
              >
                Cancelar
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    label: "Ingresos",
                    v: totalCobrado,
                    cls: "text-emerald-300",
                  },
                  { label: "Gastos", v: totalGastos, cls: "text-rose-300" },
                  {
                    label: "Utilidad",
                    v: utilidad,
                    cls: utilidad >= 0 ? "text-violet-300" : "text-rose-300",
                  },
                ].map((k) => (
                  <div
                    key={k.label}
                    className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 p-3 text-center"
                  >
                    <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70">
                      {k.label}
                    </div>
                    <div
                      className={`mt-1 text-xl font-semibold tabular-nums ${k.cls}`}
                    >
                      ${k.v.toLocaleString("es-AR")}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-white/[0.025] ring-1 ring-white/10 overflow-hidden">
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 border-b border-white/5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                  <div>Método</div>
                  <div className="text-right">Ingresos</div>
                  <div className="text-right">Gastos</div>
                  <div className="text-right">Utilidad</div>
                </div>
                {Object.entries(detalleMetodos).length === 0 ? (
                  <div className="px-4 py-3 text-sm text-muted-foreground">
                    Sin movimientos hoy.
                  </div>
                ) : (
                  Object.entries(detalleMetodos).map(([m, row]) => (
                    <div
                      key={m}
                      className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 border-b border-white/5 last:border-0 text-sm"
                    >
                      <span className="capitalize">
                        {paymentMethodLabel(m)}
                      </span>
                      <span className="text-right font-semibold tabular-nums text-emerald-300">
                        ${row.ingresos.toLocaleString("es-AR")}
                      </span>
                      <span className="text-right font-semibold tabular-nums text-rose-300">
                        ${row.gastos.toLocaleString("es-AR")}
                      </span>
                      <span
                        className={`text-right font-semibold tabular-nums ${row.utilidad >= 0 ? "text-violet-300" : "text-rose-300"}`}
                      >
                        ${row.utilidad.toLocaleString("es-AR")}
                      </span>
                    </div>
                  ))
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
        </div>
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
  onCajaCerrada,
  onCajaReopened,
}: {
  businessId: string | null;
  cajaCerrada: boolean;
  paymentsToday: ReturnType<typeof useCajaData>["paymentsToday"];
  expensesToday: ReturnType<typeof useCajaData>["expensesToday"];
  pendingCharges: ReturnType<typeof useCajaData>["pendingCharges"];
  userEmail: string | null;
  onCajaCerrada: () => void;
  onCajaReopened: () => void;
}) {
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
    autoCloseExpiredCajaSession({ businessId, userEmail })
      .catch((error) => console.warn(error))
      .finally(() => {
        supabase
          .from("caja_cierres" as any)
          .select("*")
          .eq("business_id", businessId)
          .order("fecha", { ascending: false })
          .order("updated_at", { ascending: false })
          .limit(90)
          .then(({ data, error }) => {
            if (error) toast.error(error.message);
            setCierres(data ?? []);
            setLoading(false);
          });
      });
  }, [businessId]);

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

      if (isCajaReabiertaRow(freshCierre)) {
        toast.info("La caja ya está abierta");
        setSelected(null);
        setReopenTarget(null);
        onCajaReopened();
        loadCierres();
        return;
      }

      if (!isCajaCerradaRow(freshCierre)) {
        toast.info("La caja no está cerrada");
        setSelected(null);
        setReopenTarget(null);
        onCajaReopened();
        loadCierres();
        return;
      }

      const now = new Date();
      const user = userEmail ? displayResponsibleUser(userEmail) : "Usuario";
      const hora = cajaTimeLabel(now);
      const motivo = reopenNote.trim() || null;
      const evento = {
        tipo: "reapertura",
        fecha_hora: now.toISOString(),
        hora,
        usuario: user,
        motivo,
      };

      const { data: updated, error } = await supabase
        .from("caja_cierres" as any)
        .update({
          estado: "reabierta",
          reopened_at: now.toISOString(),
          reopened_by: user,
          reopen_reason: motivo,
          eventos: appendCajaEvento((freshCierre as any).eventos, evento),
          updated_at: now.toISOString(),
        })
        .eq("id", cierre.id)
        .eq("business_id", businessId)
        .eq("estado", "cerrada")
        .select("id")
        .maybeSingle();

      if (error) throw error;

      if (!updated?.id) {
        toast.info("La caja ya estaba abierta");
        setSelected(null);
        setReopenTarget(null);
        onCajaReopened();
        loadCierres();
        return;
      }

      toast.success("Caja reabierta");
      setSelected(null);
      setReopenTarget(null);
      setReopenNote("");

      // La pantalla se desbloquea inmediatamente; la sincronización secundaria no bloquea la UI.
      onCajaReopened();
      window.dispatchEvent(new CustomEvent("clippr:caja-cierre-guardado"));

      reopenCashSession({
        sessionId: cierre.id,
        businessId,
        reopenedBy: user,
      } as any).catch(() => {
        // El historial visual ya quedó guardado en caja_cierres.
      });

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
                      Responsable: <span className="font-semibold text-white">{openedBy}</span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Hora de apertura: <span className="font-semibold text-white">{openedAt}</span>
                    </p>
                  </div>
                  <CierreCajaBtn
                    paymentsToday={paymentsToday}
                    expensesToday={expensesToday}
                    pendingCharges={pendingCharges}
                    businessId={businessId}
                    userEmail={userEmail}
                    onCajaCerrada={() => {
                      onCajaCerrada();
                      loadCierres();
                    }}
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

      {selected && (
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
                    l: "Diferencia",
                    v: selected.diferencia != null ? `$${Number(selected.diferencia).toLocaleString("es-AR")}` : "—",
                    cls: "text-white",
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
        </div>
      )}

      {reopenTarget && (
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
        </div>
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
}: {
  payment: ReturnType<typeof useCajaData>["paymentsToday"][number];
  employees: ReturnType<typeof useCajaData>["employees"];
  onClose: () => void;
}) {
  const method = (payment.method ??
    payment.payment_method ??
    "cash") as PayMethod;
  const empName =
    employees.find((e) => e.id === payment.employee_id)?.name ?? null;
  const chargedById =
    ((payment as Record<string, unknown>).charged_by as string | null) ?? null;
  const chargedBy = chargedById
    ? (employees.find((e) => e.id === chargedById)?.name ??
      (chargedById.length < 40 ? chargedById : null) ??
      "—")
    : "—";
  const chargeType =
    ((payment as Record<string, unknown>).charge_type as string | null) ??
    "caja";
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
  const discount =
    ((payment as Record<string, unknown>).discount_amount as number | null) ??
    null;
  const depositApplied =
    ((payment as Record<string, unknown>).deposit_paid as number | null) ??
    null;

  const commission =
    payment.employee_id &&
    employees.find((e) => e.id === payment.employee_id)?.commission_pct
      ? Math.round(
          Number(payment.total ?? payment.amount ?? 0) *
            (employees.find((e) => e.id === payment.employee_id)!
              .commission_pct! /
              100),
        )
      : null;

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

  return (
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
          <button
            onClick={onClose}
            className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs transition"
          >
            Cerrar
          </button>
        </div>

        <div className="px-5 py-1 max-h-[72vh] overflow-y-auto">
          {/* Total + estado */}
          <div className="py-2 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
            <span className="font-display text-2xl font-semibold tabular-nums">
              $
              {Number(payment.total ?? payment.amount ?? 0).toLocaleString(
                "es-AR",
              )}
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
            {discount && discount > 0 && (
              <Row
                label="Descuento aplicado"
                value={
                  <span className="text-blue-300">
                    −${discount.toLocaleString("es-AR")}
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
            {commission !== null && (
              <Row
                label="Comisión profesional"
                value={`$${commission.toLocaleString("es-AR")}`}
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
    </div>
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
                        $
                        {Number(p.total ?? p.amount ?? 0).toLocaleString(
                          "es-AR",
                        )}
                      </div>
                      <div className="text-muted-foreground truncate">
                        {methodLabel}
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
                          {Number(p.total ?? p.amount ?? 0).toLocaleString(
                            "es-AR",
                          )}
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
                          <span className="truncate text-right text-muted-foreground">
                            {methodLabel}
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
        />
      )}

      {pendingNoteModal && (
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
        </div>
      )}

      {/* Pendientes de días anteriores — mismos datos (data.pendingChargesPrevious)
          y mismas acciones (Cobrar/Rechazar) que la lista de hoy, separados
          nada más para no mezclarlos en la vista principal. */}
      {previousPendingOpen && (
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
        </div>
      )}

      {/* Historial completo */}
      {closeoutOpen && (
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
                        const amount = Number(p.total ?? p.amount ?? 0);
                        const methodLabel = paymentMethodLabel(p.method ?? p.payment_method);
                        const paymentNote = getCashRowNote(p, p.service_name);
                        // Misma lógica que "Últimos ingresos" (no el genérico
                        // displayCashActor + "→ Cobró" fijo que tenía esta
                        // modal antes) — línea de tiempo completa con el
                        // nombre real de cada acción, no solo el último
                        // evento.
                        const paymentRecord = p as Record<string, unknown>;
                        const empNameForHist = (p.employee_name ?? p.professional_name ?? null) as string | null;
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
                              {p.employee_name ?? p.professional_name ?? "—"}
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
                            <div className="truncate text-muted-foreground">{methodLabel}</div>
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
                            {p.employee_name ?? p.professional_name ?? "—"}
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
                        const amount = Number(p.total ?? p.amount ?? 0);
                        const methodLabel = paymentMethodLabel(p.method ?? p.payment_method);
                        const paymentNote = getCashRowNote(p, p.service_name);
                        const paymentRecord = p as Record<string, unknown>;
                        const empNameForHist = (p.employee_name ?? p.professional_name ?? null) as string | null;
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
                                  {p.employee_name ?? p.professional_name ?? "—"}
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
                                <span className="truncate text-right text-muted-foreground">
                                  {methodLabel}
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
                                  {p.employee_name ?? p.professional_name ?? "—"}
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
        </div>
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

type MultiSplit = { method: string; amount: string };

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
  const [method, setMethod] = React.useState<PayMethod>("cash");
  const [paymentMode, setPaymentMode] = React.useState<"simple" | "multiple">(
    "simple",
  );
  const [received, setReceived] = React.useState("");
  const [splits, setSplits] = React.useState<MultiSplit[]>([
    { method: "cash", amount: "" },
  ]);
  const [submitting, setSubmitting] = React.useState(false);
  const [newClientOpen, setNewClientOpen] = React.useState(false);
  const [clientNotes, setClientNotes] = React.useState("");
  const [professionalSearch, setProfessionalSearch] = React.useState("");
  // Resumen del paso 4: arranca compacto (2 ítems) — "Ver más" lo despliega
  // sin que el módulo se agrande de entrada con carritos grandes.
  const [summaryExpanded, setSummaryExpanded] = React.useState(false);
  const [clientAcquisitionSource, setClientAcquisitionSource] = React.useState("");
  const [clientAcquisitionCustom, setClientAcquisitionCustom] = React.useState("");
  // Si el email ya tiene un origen guardado, no se vuelve a preguntar ni se
  // deja cambiar desde acá — mismo criterio que Clientes → Nuevo cliente.
  const [clientSourceAlreadyKnown, setClientSourceAlreadyKnown] = React.useState(false);

  const { isFieldEnabled } = useClientesConfig(data.businessId ?? null);

  useEffect(() => {
    const trimmedEmail = email.trim();
    if (!data.businessId || !trimmedEmail || !trimmedEmail.includes("@")) {
      setClientSourceAlreadyKnown(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const { data: known, error } = await supabase.rpc(
        "clippr_client_has_acquisition_source",
        { p_business_id: data.businessId, p_email: trimmedEmail },
      );
      if (!cancelled && !error) setClientSourceAlreadyKnown(Boolean(known));
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [data.businessId, email]);

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
    setClientNotes("");
    setReceived("");
    setPaymentMode("simple");
    setSplits([{ method: "cash", amount: "" }]);
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
  // Precio efectivo de cada servicio/producto para el profesional ya elegido
  // (paso 1), resuelto con el mismo `resolveServicePricing` que usan Agenda,
  // Mi Agenda y la Página Pública — el picker, el carrito y el total salen
  // todos de esta lista, así que quedan consistentes por construcción.
  const servicesForEmployee = React.useMemo(() => {
    if (!employeeId) return data.services;
    return data.services.map((s) => {
      if (s.is_catalog) return s;
      const resolved = resolveServicePricing(
        { id: s.id, price: s.price, duration_min: s.duration },
        employeeId,
        data.employeeServiceOverrides,
      );
      return resolved.priceOverridden ? { ...s, price: resolved.price } : s;
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

  const paymentOptions = React.useMemo(() => {
    const cfg = data.paymentMethods;
    return (
      [
        {
          id: "cash",
          label: "Efectivo",
          icon: Banknote,
          enabled: cfg.efectivo,
        },
        {
          id: "transfer",
          label: "Transferencia",
          icon: Smartphone,
          enabled: cfg.transferencia,
        },
        {
          id: "card",
          label: "Débito / Crédito",
          icon: CreditCard,
          enabled: cfg.tarjeta,
        },
        { id: "mp", label: "Mercado Pago", icon: Wallet, enabled: cfg.mp },
        {
          id: "cuenta",
          label: "Cuenta DNI",
          icon: Smartphone,
          enabled: cfg.cuentaDni,
        },
      ] as const
    ).filter((m) => m.enabled);
  }, [data.paymentMethods]);

  React.useEffect(() => {
    if (!paymentOptions.some((m) => m.id === method)) {
      setMethod((paymentOptions[0]?.id ?? "cash") as PayMethod);
    }
  }, [paymentOptions, method]);

  const cartItems = Object.entries(cart)
    .map(([id, qty]) => {
      const svc = servicesWithSynthetic.find((s) => s.id === id);
      return svc ? { svc, qty } : null;
    })
    .filter(
      (x): x is { svc: (typeof data.services)[0]; qty: number } => x !== null,
    );

  const total = cartItems.reduce(
    (acc, { svc, qty }) => acc + Number(svc.price) * qty,
    0,
  );
  const cartCount = cartItems.reduce((acc, { qty }) => acc + qty, 0);
  const receivedNumber = Number(received || 0);
  const change =
    method === "cash" && receivedNumber >= total ? receivedNumber - total : 0;
  const cashShortfall =
    method === "cash" && receivedNumber > 0 && receivedNumber < total
      ? total - receivedNumber
      : 0;
  const splitsTotal = splits.reduce((s, sp) => s + Number(sp.amount || 0), 0);
  const splitsRemaining = total - splitsTotal;
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
  const canContinue =
    step === 1
      ? Boolean(employeeId)
      : step === 2
        ? hasSelectedClient
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

  function addSplit() {
    const available = paymentOptions.filter(
      (o) => !splits.some((s) => s.method === o.id),
    );
    if (available.length === 0) return;
    setSplits((prev) => [...prev, { method: available[0].id, amount: "" }]);
  }
  function removeSplit(idx: number) {
    setSplits((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateSplit(idx: number, key: "method" | "amount", val: string) {
    setSplits((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [key]: val } : s)),
    );
  }

  function goNext() {
    if (step === 1 && !employeeId) {
      toast.error("Seleccioná un profesional.");
      return;
    }
    if (step === 2) {
      if (!clientId) {
        toast.error("Seleccioná un cliente para continuar.");
        return;
      }
    }
    if (step === 3 && cartItems.length === 0) {
      toast.error("Agregá al menos un servicio o producto.");
      return;
    }
    setStep((s) => (s < finalStep ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  }

  async function saveClientIfNeeded(): Promise<string | null> {
    if (!data.businessId || !client.trim()) return clientId;
    if (clientId && !clientId.startsWith("__pending_client__")) return clientId;
    if (pendingCharge?.client_name) return null;
    try {
      const trimmedEmail = email.trim();
      // Si el email ya pertenece a un cliente existente, no crear un
      // duplicado — se actualiza el origen solo si todavía no lo tenía
      // (mismo criterio que Clientes → Nuevo cliente).
      if (trimmedEmail) {
        const { data: existing } = await supabase
          .from("clients")
          .select("id, acquisition_source")
          .eq("business_id", data.businessId)
          .ilike("email", trimmedEmail)
          .maybeSingle();
        if (existing) {
          if (!existing.acquisition_source && clientAcquisitionSource) {
            await supabase
              .from("clients")
              .update({
                acquisition_source: clientAcquisitionSource,
                acquisition_source_custom: clientAcquisitionCustom.trim() || null,
                acquisition_captured_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
          }
          return existing.id;
        }
      }
      const { data: created, error } = await supabase
        .from("clients")
        .insert({
          business_id: data.businessId,
          full_name: client.trim(),
          phone: phone.trim() || null,
          email: trimmedEmail || null,
          birth_date: birthDate || null,
          notes: clientNotes.trim() || null,
          acquisition_source: clientSourceAlreadyKnown ? null : clientAcquisitionSource || null,
          acquisition_source_custom: clientSourceAlreadyKnown ? null : clientAcquisitionCustom.trim() || null,
          acquisition_captured_at:
            !clientSourceAlreadyKnown && clientAcquisitionSource ? new Date().toISOString() : null,
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
          if (Number(received) < total) {
            toast.error(
              `El monto abonado ($${Number(received).toLocaleString("es-AR")}) es menor al total ($${total.toLocaleString("es-AR")}).`,
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
        if (Math.round(splitsTotal) !== Math.round(total)) {
          toast.error(
            `El pago múltiple debe sumar $${total.toLocaleString("es-AR")}. Falta/sobra $${Math.abs(splitsRemaining).toLocaleString("es-AR")}.`,
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

      const items = cartItems.map(({ svc, qty }) => ({
        serviceId: svc.id,
        serviceName: svc.name,
        amount: Number(svc.price),
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

        await registerPayment({
          businessId: data.businessId,
          employeeId: employeeId || null,
          employeeName: selectedEmployee?.name ?? null,
          commissionPct: selectedEmployee?.commission_pct ?? null,
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
        });

        const { error: removeError } = await supabase
          .from("business_settings")
          .upsert(
            { business_id: data.businessId, schedule: { ...schedule, _pendingWalkInSales: currentPending.filter((s) => s.id !== pendingCharge.id) } },
            { onConflict: "business_id" },
          );
        if (removeError) throw removeError;

        toast.success(`Cobro confirmado · $${total.toLocaleString("es-AR")}`);
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
        await registerPayment({
          businessId: data.businessId,
          employeeId: employeeId || null,
          employeeName: selectedEmployee?.name ?? null,
          commissionPct: selectedEmployee?.commission_pct ?? null,
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
        });

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

        toast.success(`Cobro confirmado · $${total.toLocaleString("es-AR")}`);
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
        await registerPayment({
          businessId: data.businessId,
          employeeId: employeeId || null,
          employeeName: selectedEmployee?.name ?? null,
          commissionPct: selectedEmployee?.commission_pct ?? null,
          clientName: client.trim() || "Cliente del mostrador",
          clientId: savedClientId,
          items,
          method,
          splits: validSplits,
          sessionId: data.cashSessionId,
          chargedBy: data.profileId,
          chargeOrigin: "caja",
          notes: `${PAY_HIST_MARKER}${JSON.stringify([chargeEvent])}`,
        });

        toast.success(`Cobro confirmado · $${total.toLocaleString("es-AR")}`);
        setCart({});
        setClientId(null);
        setClient("");
        setClientSearch("");
        setPhone("");
        setEmail("");
        setBirthDate("");
        setClientNotes("");
        setReceived("");
        setSplits([{ method: "cash", amount: "" }]);
        setPaymentMode("simple");
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
    { n: 4, label: "Pago", hint: total > 0 ? `$${total.toLocaleString("es-AR")}` : "Confirmá cobro", icon: CreditCard },
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
        "relative mx-auto flex w-full max-w-5xl flex-col overflow-hidden rounded-[30px] border border-white/[0.085] bg-[linear-gradient(135deg,rgba(5,8,15,0.97),rgba(10,12,24,0.95),rgba(2,4,12,0.99))] p-3 md:p-3.5 shadow-[0_44px_130px_-55px_rgba(0,0,0,1),0_0_70px_-48px_rgba(139,92,246,0.60)] backdrop-blur-2xl",
        variant === "modal"
          ? "min-h-[420px]"
          : "h-[calc(100vh-235px)] min-h-[560px] sm:h-[calc(100vh-262px)] sm:mb-6",
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
          ? { height: "calc(100svh - 1.5rem - max(1.5rem, env(safe-area-inset-bottom, 0px)))" }
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
                  setPhone("");
                  setEmail("");
                  setBirthDate("");
                  setClientNotes("");
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
                setClientId(null);
                setClientAcquisitionSource("");
                setClientAcquisitionCustom("");
              }}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium border border-white/15 bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.07] hover:border-white/25 transition-colors"
            >
              <Plus className="size-4" />
              Nuevo cliente
            </button>
          )}

          {/* Formulario nuevo cliente */}
          {!clientId &&
            newClientOpen &&
            (() => {
              async function handleGuardarCliente() {
                if (!client.trim()) {
                  toast.error("Ingresá el nombre del cliente.");
                  return;
                }
                if (!phone.trim()) {
                  toast.error("Ingresá el teléfono del cliente.");
                  return;
                }
                if (isFieldEnabled("email") && !email.trim()) {
                  toast.error("Ingresá el email del cliente.");
                  return;
                }
                if (!clientSourceAlreadyKnown) {
                  if (!clientAcquisitionSource) {
                    toast.error("Indicá cómo nos conoció el cliente.");
                    return;
                  }
                  if (
                    acquisitionChannelRequiresText(clientAcquisitionSource) &&
                    !clientAcquisitionCustom.trim()
                  ) {
                    toast.error("Indicá dónde nos conoció el cliente.");
                    return;
                  }
                }
                const saved = await saveClientIfNeeded();
                if (saved) {
                  setClientId(saved);
                  setNewClientOpen(false);
                  toast.success("Cliente guardado y seleccionado");
                } else {
                  toast.error(
                    "No se pudo guardar el cliente. Revisá los datos e intentá de nuevo.",
                  );
                }
              }
              return (
                <Card className="max-h-[340px] overflow-y-auto p-4 space-y-3 [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.35)_transparent]">
                  <p className="text-xs text-muted-foreground tracking-[0.15em] uppercase">
                    Nuevo cliente
                  </p>
                  <input
                    value={client}
                    onChange={(e) => {
                      setClient(e.target.value);
                      setClientId(null);
                    }}
                    placeholder="Nombre *"
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-base outline-none focus:border-blue-300/40"
                  />
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Teléfono *"
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-base outline-none focus:border-blue-300/40"
                  />
                  {isFieldEnabled("email") && (
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Email *"
                      type="email"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-base outline-none focus:border-blue-300/40"
                    />
                  )}
                  {isFieldEnabled("notas") && (
                    <input
                      value={clientNotes}
                      onChange={(e) => setClientNotes(e.target.value)}
                      placeholder="Notas"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5 text-base outline-none focus:border-blue-300/40"
                    />
                  )}
                  {!clientSourceAlreadyKnown && (
                    <AcquisitionSourceField
                      value={clientAcquisitionSource}
                      onChange={setClientAcquisitionSource}
                      customValue={clientAcquisitionCustom}
                      onCustomChange={setClientAcquisitionCustom}
                      questionLabel="¿Cómo nos conoció?"
                      wrapperClassName="space-y-3"
                      otroBelow
                      triggerClassName="w-full bg-white/[0.03] border-white/10 rounded-lg px-3 py-2.5 h-auto text-base focus:border-blue-300/40"
                      inputClassName="w-full bg-white/[0.03] border-white/10 rounded-lg px-3 py-2.5 text-base focus:border-blue-300/40"
                    />
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setNewClientOpen(false)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-white/15 bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.07] transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleGuardarCliente}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition bg-gradient-to-r from-blue-500/90 to-violet-500/90 text-white hover:brightness-110 cash-sale-button-glow"
                    >
                      Confirmar cliente
                    </button>
                  </div>
                </Card>
              );
            })()}
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
        </div>
      )}

      {step === 4 && (
        <Card className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain rounded-3xl p-3.5 pt-0 space-y-2 border-white/[0.075] bg-[radial-gradient(circle_at_16%_0%,rgba(59,130,246,0.10),transparent_34%),radial-gradient(circle_at_90%_0%,rgba(139,92,246,0.12),transparent_40%),linear-gradient(135deg,rgba(3,6,14,0.98),rgba(8,9,22,0.96),rgba(1,3,10,0.99))] shadow-[0_38px_110px_-62px_rgba(0,0,0,1),0_0_70px_-48px_rgba(139,92,246,0.62)]">
          {/* Barra de punta a punta pegada al borde superior del módulo
              (márgenes negativos cancelan el padding del Card) — recta,
              sin puntas redondeadas propias salvo las que hacen juego con
              las esquinas superiores del Card, bien fina. */}
          <div className="sticky top-0 z-10 -mx-3.5 grid shrink-0 grid-cols-2 rounded-t-3xl border-b border-white/[0.07] bg-black/50 backdrop-blur-sm">
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

          {paymentMode === "simple" ? (
            <>
              <div>
                <p className="text-[11px] tracking-[0.18em] text-muted-foreground/70 mb-2">
                  MÉTODO DE PAGO
                </p>
                {/* Ícono a la izquierda, nombre a la derecha, en una sola
                    fila — antes iban apilados (ícono arriba, nombre abajo),
                    lo que hacía cada tarjeta mucho más alta de lo
                    necesario. 2 columnas en mobile, 4 en desktop ancho. */}
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                  {paymentOptions.map((m) => {
                    const active = method === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setMethod(m.id as PayMethod)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all duration-200 shadow-[0_18px_50px_-34px_rgba(0,0,0,1)]",
                          active
                            ? "border-blue-300/48 bg-[linear-gradient(135deg,rgba(37,99,235,0.22),rgba(8,11,20,0.94))] text-white ring-1 ring-blue-300/20 shadow-[0_0_26px_rgba(96,165,250,0.13)]"
                            : "border-white/[0.065] bg-[linear-gradient(135deg,rgba(8,11,20,0.92),rgba(2,6,23,0.90))] text-muted-foreground hover:border-white/[0.12] hover:bg-white/[0.045] hover:text-foreground",
                        )}
                      >
                        <m.icon className="size-4 shrink-0" />
                        <span className="min-w-0 break-words text-xs font-semibold leading-tight">
                          {m.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {method === "cash" && (
                <div className="rounded-2xl border border-blue-300/35 bg-[linear-gradient(135deg,rgba(37,99,235,0.16),rgba(8,11,20,0.96),rgba(2,4,12,0.98))] p-3 shadow-[0_0_34px_rgba(96,165,250,0.14),0_18px_55px_-34px_rgba(0,0,0,1)]">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.18em] text-blue-200/85">
                      Monto recibido
                    </span>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-white/55">
                        $
                      </span>
                      <input
                        value={received}
                        onChange={(e) => setReceived(e.target.value)}
                        inputMode="numeric"
                        placeholder="0"
                        className="h-12 w-full rounded-xl border border-blue-300/30 bg-black/45 pl-9 pr-4 text-xl font-extrabold tabular-nums text-white outline-none placeholder:text-white/30 focus:border-blue-300/65 focus:ring-2 focus:ring-blue-400/20"
                      />
                    </div>
                  </label>
                  {receivedNumber > 0 && (
                    <div className="mt-2 flex items-center justify-end">
                      {/* "Entregado" y el texto explicativo eran
                          redundantes — el monto recibido ya se lee arriba.
                          Lo único útil acá es el resultado, bien visible:
                          cuánto vuelto dar, o cuánto falta si no alcanza
                          (y en ese caso no se deja confirmar el cobro). */}
                      {cashShortfall > 0 ? (
                        <p className="text-base font-bold text-red-300">
                          Faltan: ${cashShortfall.toLocaleString("es-AR")}
                        </p>
                      ) : (
                        <p className="text-base font-bold text-emerald-300">
                          Vuelto: ${change.toLocaleString("es-AR")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className={cn("rounded-2xl border border-blue-300/25 bg-[linear-gradient(135deg,rgba(37,99,235,0.14),rgba(8,11,20,0.96),rgba(2,4,12,0.98))] p-3 shadow-[0_0_40px_rgba(96,165,250,0.12),0_18px_55px_-34px_rgba(0,0,0,1)] space-y-2", splits.length >= 3 && "max-h-[200px] overflow-y-auto overscroll-contain pr-1.5 [scrollbar-width:thin] [scrollbar-color:rgba(96,165,250,0.40)_transparent]")}>
              <p className="text-[11px] tracking-[0.18em] text-muted-foreground/70">
                PAGO MÚLTIPLE
              </p>
              {/* Método, monto y eliminar bien juntos en una sola fila —
                  antes método/monto tenían el mismo ancho (1fr cada uno),
                  así que un monto de varias cifras quedaba apretado/cortado
                  contra el borde. El monto ahora tiene ancho fijo propio
                  (w-28) y se lee completo, alineado a la derecha. */}
              {splits.map((sp, idx) => {
                const opt = paymentOptions.find((o) => o.id === sp.method);
                const Icon = opt?.icon ?? Wallet;
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-[1fr_auto_auto] gap-1.5 items-center"
                  >
                    <select
                      value={sp.method}
                      onChange={(e) =>
                        updateSplit(idx, "method", e.target.value)
                      }
                      className="h-9 min-w-0 rounded-xl border border-blue-300/25 bg-black/45 px-2.5 text-sm font-semibold text-white outline-none focus:border-blue-300/55 focus:ring-2 focus:ring-blue-400/15"
                    >
                      {paymentOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={sp.amount}
                      onChange={(e) =>
                        updateSplit(idx, "amount", e.target.value)
                      }
                      inputMode="numeric"
                      placeholder="Monto"
                      className="h-9 w-28 rounded-xl border border-blue-300/25 bg-black/45 px-2 text-right text-sm font-bold tabular-nums text-white outline-none placeholder:text-white/35 focus:border-blue-300/55 focus:ring-2 focus:ring-blue-400/15"
                    />
                    <button
                      onClick={() => removeSplit(idx)}
                      disabled={splits.length <= 1}
                      className="h-9 w-9 shrink-0 rounded-xl border border-white/10 bg-black/35 grid place-items-center text-muted-foreground hover:border-rose-300/35 hover:text-rose-300 disabled:opacity-30 transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                );
              })}
              <button
                onClick={addSplit}
                disabled={splits.length >= paymentOptions.length}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-300/20 bg-blue-400/10 px-3 py-1.5 text-xs font-semibold text-blue-100 hover:bg-blue-400/15 disabled:opacity-30 transition-colors"
              >
                <Plus className="size-3.5" /> Agregar método de pago
              </button>
              <div className="flex items-center justify-between text-sm rounded-xl border border-blue-300/20 bg-black/35 px-3 py-2">
                <span className="text-muted-foreground">
                  Total cargado: ${splitsTotal.toLocaleString("es-AR")}
                </span>
                <span
                  className={cn(
                    "font-semibold",
                    splitsRemaining === 0
                      ? "text-emerald-300"
                      : splitsRemaining > 0
                        ? "text-blue-200"
                        : "text-rose-300",
                  )}
                >
                  {splitsRemaining === 0
                    ? "Completo ✓"
                    : splitsRemaining > 0
                      ? `Falta $${splitsRemaining.toLocaleString("es-AR")}`
                      : `Sobra $${Math.abs(splitsRemaining).toLocaleString("es-AR")}`}
                </span>
              </div>
            </div>
          )}
        </Card>
      )}

      <div className="relative z-20 mt-auto shrink-0 space-y-3 pt-3 pb-4">
        {/* Resumen — solo en el paso 4 (Pago), como última verificación
            antes de cobrar. En los pasos 1-3 no se muestra nada acá, solo
            Volver/Continuar. Profesional y Cliente comparten la primera
            fila; cada servicio/producto tiene su propia fila con precio a
            la derecha (nunca agrupados con "/"), con "+N ítems" si hay más
            de los que entran cómodo; Total separado por una línea, en
            blanco y con más jerarquía. Sin truncate: si el nombre es largo
            se acomoda en varias líneas antes que cortarse. */}
        {step === 4 && (
          <Card className="rounded-2xl border-white/[0.075] bg-[linear-gradient(135deg,rgba(2,4,10,0.98),rgba(5,8,18,0.97),rgba(1,3,9,0.99))] px-4 py-2 shadow-[0_36px_110px_-52px_rgba(0,0,0,1),0_0_60px_-40px_rgba(139,92,246,0.60)]">
            {/* Fila Profesional/Cliente: misma altura/padding que las filas
                de ítems de abajo (texto chico, sin py propio) — antes se
                sentía como un bloque grande aparte en vez de una fila más
                del resumen. */}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {!lockedEmployeeId && (
                <p className="min-w-0 flex-1 break-words text-xs font-semibold text-white">
                  Profesional: {selectedEmployee?.name ?? "—"}
                </p>
              )}
              <p
                className={cn(
                  "min-w-0 flex-1 break-words text-xs font-semibold text-white",
                  !lockedEmployeeId && "text-right",
                )}
              >
                Cliente: {client || "Cliente seleccionado"}
              </p>
            </div>

            {cartItems.length > 0 && (
              <div className="mt-1.5 space-y-1 border-t border-white/10 pt-1.5">
                {/* Máximo 2 ítems visibles por default — con muchos
                    servicios/productos el resumen no debe crecer solo y
                    empujar todo lo demás fuera de pantalla. "Ver más" lo
                    despliega a pedido del usuario. */}
                {(summaryExpanded ? cartItems : cartItems.slice(0, 2)).map(({ svc, qty }) => (
                  <div key={svc.id} className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words text-xs text-white/65">
                      {svc.name}
                      {qty > 1 ? ` ×${qty}` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums text-xs text-white/65">
                      ${Math.round(Number(svc.price) * qty).toLocaleString("es-AR")}
                    </span>
                  </div>
                ))}
                {cartItems.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setSummaryExpanded((v) => !v)}
                    className="text-xs font-semibold text-blue-300 hover:text-blue-200 transition-colors"
                  >
                    {summaryExpanded ? "Ver menos" : "Ver más"}
                  </button>
                )}
              </div>
            )}

            <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-white/10 pt-1.5">
              <span className="text-base font-extrabold text-white">Total</span>
              <span className="tabular-nums text-base font-extrabold text-white">
                ${total.toLocaleString("es-AR")}
              </span>
            </div>
          </Card>
        )}

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
