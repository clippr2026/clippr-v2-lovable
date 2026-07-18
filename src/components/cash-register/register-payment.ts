import { supabase } from "@/integrations/supabase/client";

/**
 * Registra una venta en Caja.
 *
 * Importante:
 * - Una venta puede tener varios ítems: servicios + catálogo.
 * - Debe guardarse como UN SOLO cobro en `payments`.
 * - En la tabla se muestra un resumen tipo:
 *   "Corte + Barba / Pomada mate / Remera"
 * - Si hay más de 3 ítems:
 *   "Corte + Barba / Pomada mate / Remera +2 más"
 */

export type PayMethod = "cash" | "transfer" | "card" | "mp" | "qr" | "cuenta";

export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  mp: "Mercado Pago",
  qr: "QR",
  cuenta: "Cuenta",
};

export type RegisterPaymentItem = {
  serviceName: string;
  amount: number;
  qty?: number;
  serviceId?: string | null;
  isCatalog?: boolean;
};

export type ChargeOrigin = "auto" | "manual" | "caja";

export type RegisterPaymentInput = {
  businessId: string;
  employeeId?: string | null;
  employeeName?: string | null;
  clientName: string;
  clientId?: string | null;
  items: RegisterPaymentItem[];
  method: PayMethod;
  splits?: Array<{ method: PayMethod; amount: number }>;
  commissionPct?: number | null;
  sessionId?: string | null;
  chargedBy?: string | null;
  appointmentId?: string | null;
  chargeOrigin?: ChargeOrigin;
  status?: "cobrado" | "pendiente" | "anulado" | "reembolsado";
  notes?: string | null;
};

function formatItemName(item: RegisterPaymentItem) {
  const name = String(item.serviceName || "Ítem").trim();
  const qty = Number(item.qty ?? 1);
  return qty > 1 ? `${name} x${qty}` : name;
}

function buildSaleSummary(items: RegisterPaymentItem[]) {
  const names = items.map(formatItemName).filter(Boolean);

  if (names.length <= 3) {
    return names.join(" / ");
  }

  return `${names.slice(0, 3).join(" / ")} +${names.length - 3} más`;
}

export async function registerPayment(input: RegisterPaymentInput) {
  if (!input.businessId) throw new Error("Falta business_id");
  if (!input.items.length) throw new Error("Carrito vacío");

  const total = input.items.reduce((sum, item) => {
    const qty = Number(item.qty ?? 1);
    return sum + Number(item.amount ?? 0) * qty;
  }, 0);

  const saleSummary = buildSaleSummary(input.items) || "Venta";

  // Detalle real de la venta, ítem por ítem (servicio o catálogo), para que el
  // Dashboard pueda desglosar Ingresos con exactitud sin adivinar por texto.
  const savedItems = input.items.map((item) => {
    const qty = Number(item.qty ?? 1);
    return {
      id: item.serviceId ?? null,
      name: String(item.serviceName || "Ítem").trim(),
      amount: Number(item.amount ?? 0) * (Number.isFinite(qty) && qty > 0 ? qty : 1),
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      is_catalog: Boolean(item.isCatalog),
    };
  });

  // Resolve charged_by: must be a UUID. Get it from supabase auth session.
  let chargedByUuid: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    chargedByUuid = user?.id ?? null;
  } catch { /* silently fail */ }

  const payload: Record<string, unknown> = {
    business_id: input.businessId,
    employee_id: input.employeeId ?? null,
    client_name: input.clientName || "Cliente del mostrador",
    service_name: saleSummary,
    amount: total,
    total,
    items: savedItems,
    method: input.method,
    payment_method: input.method,
    appointment_id: input.appointmentId ?? null,
    charge_type: input.chargeOrigin ?? "caja",
    status: input.status ?? "cobrado",
    charged_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  if (input.sessionId) payload.session_id = input.sessionId;
  // Only set charged_by if it's a valid UUID (never an email)
  if (chargedByUuid) payload.charged_by = chargedByUuid;
  if (input.notes?.trim()) payload.observations = input.notes.trim();

  const { data, error } = await supabase
    .from("payments")
    .insert(payload)
    .select();

  if (error) {
    const detail = `${error.code ?? ""} ${error.message} ${error.details ?? ""} ${error.hint ?? ""}`.trim();
    throw new Error(detail || "Error guardando pago");
  }

  if (!data?.length) {
    throw new Error("Supabase no devolvió el pago guardado (¿RLS?).");
  }

  // Pago múltiple: los métodos usados (para mostrar "Efectivo • Transferencia"
  // en Historial de ventas) se guardan en un UPDATE aparte, después de que el
  // cobro ya quedó confirmado — nunca en el INSERT de arriba. Si la columna
  // "splits" todavía no existe en `payments`, esto falla en silencio y el
  // cobro en sí no se ve afectado (mismo patrón defensivo que cobro_events).
  if (input.splits && input.splits.length > 0) {
    try {
      await supabase
        .from("payments")
        .update({ splits: input.splits } as Record<string, unknown>)
        .eq("id", data[0].id);
    } catch {
      // Columna puede no existir aún — el método principal ya quedó guardado.
    }
  }

  return data;
}
