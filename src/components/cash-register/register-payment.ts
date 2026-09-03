import { supabase } from "@/integrations/supabase/client";
import { normalizeClientKeys, type PromotionDiscountType } from "@/lib/service-pricing";
import { incrementPromotionUsage } from "@/lib/promotion-usage";

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
  // Promoción APLICADA (dato definitivo) — se completa recién acá, al
  // confirmar el cobro. discountAmount ya viene calculado en $ (la UI de
  // Caja decide a qué ítems del carrito aplica, este módulo solo lo resta
  // del total y lo deja registrado). Sin promotionId, estos campos no se
  // escriben y el pago queda exactamente como antes.
  promotionId?: string | null;
  promotionName?: string | null;
  discountType?: PromotionDiscountType | null;
  discountValue?: string | null;
  discountAmount?: number;
  // Para el límite "por cliente" de la promo (normalizeClientKeys) — best
  // effort: sin estos datos, el incremento de uso igual corre (cupo total),
  // solo no puede chequear/contar el límite por cliente puntual.
  clientPhone?: string | null;
  clientEmail?: string | null;
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

  const grossTotal = input.items.reduce((sum, item) => {
    const qty = Number(item.qty ?? 1);
    return sum + Number(item.amount ?? 0) * qty;
  }, 0);
  // discountAmount ya viene resuelto en $ por quien arma el carrito (qué
  // ítems son alcanzados por la promo es decisión de la UI, acá solo se
  // resta del total una vez, con tope para nunca dar negativo).
  const discountAmount = Math.max(0, Math.min(grossTotal, Number(input.discountAmount ?? 0)));
  const total = input.promotionId ? grossTotal - discountAmount : grossTotal;

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

  // session_id tiene FK a cash_sessions ("payments_session_id_fkey") — un
  // id que ya no existe ahí (ej. de una sesión vieja que quedó cacheada en
  // business_settings antes de un reset de datos que vació cash_sessions)
  // hace fallar el insert del pago con TODOS los métodos por igual, no es
  // un problema de Efectivo/Transferencia/etc. Se verifica acá, en el
  // único punto que arma `payments`, en vez de confiar ciegamente en
  // input.sessionId — si no existe más, se omite (el pago se registra
  // igual, sin sesión asociada) en lugar de romper el cobro.
  let verifiedSessionId: string | null = null;
  if (input.sessionId) {
    const { data: sessionRow } = await supabase
      .from("cash_sessions")
      .select("id")
      .eq("id", input.sessionId)
      .maybeSingle();
    verifiedSessionId = sessionRow?.id ?? null;
  }
  // eslint-disable-next-line no-console
  console.log("[registerPayment] session_id check:", {
    businessId: input.businessId,
    sessionIdRecibido: input.sessionId ?? null,
    sessionIdVerificado: verifiedSessionId,
  });
  if (verifiedSessionId) payload.session_id = verifiedSessionId;
  // Only set charged_by if it's a valid UUID (never an email)
  if (chargedByUuid) payload.charged_by = chargedByUuid;
  if (input.notes?.trim()) payload.observations = input.notes.trim();

  // Promoción aplicada — el dato definitivo (no el "previsto" del turno, que
  // puede haber sido cambiado/quitado acá mismo antes de confirmar). Guarda
  // precio original + descuento + promo para que Historial/Clientes/
  // Dashboard/comisiones/liquidaciones puedan reconstruir el desglose
  // completo sin volver a consultar la promo (que puede editarse/borrarse
  // después).
  if (input.promotionId) {
    payload.promotion_id = input.promotionId;
    payload.promotion_name = input.promotionName ?? null;
    payload.discount_type = input.discountType ?? null;
    payload.discount_value = input.discountValue != null ? Number(input.discountValue) : null;
    payload.discount = discountAmount;
    payload.original_amount = grossTotal;
  }

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

  // Uso de la promo: se consume acá, recién con el cobro confirmado (nunca
  // al agendar/prever) — un solo lugar, así ningún punto de entrada de Caja
  // puede duplicar ni saltear este paso. Post-insert (nunca antes): si el
  // pago falla, no se consume uso de nada.
  if (input.promotionId) {
    const clientKeys = normalizeClientKeys(input.clientPhone ?? "", input.clientEmail ?? "");
    await incrementPromotionUsage(input.businessId, input.promotionId, clientKeys);
  }

  // Registra la comisión generada por esta venta — fuente de verdad del
  // saldo pendiente del profesional (Caja > Liquidaciones), independiente
  // de cualquier rango de fechas. Best-effort: si falla (ej. la migración
  // de liquidaciones todavía no corrió), no aborta la venta ya confirmada.
  const commissionPct = Number(input.commissionPct ?? 0);
  if (input.employeeId && commissionPct > 0) {
    const commissionAmount = Math.round(total * (commissionPct / 100));
    if (commissionAmount > 0) {
      const { error: commissionError } = await supabase
        .from("commission_records" as any)
        .insert({
          business_id: input.businessId,
          professional_id: input.employeeId,
          sale_id: data[0].id,
          amount: commissionAmount,
          sale_date: (payload.created_at as string).slice(0, 10),
          // Misma marca de tiempo exacta que el pago — es lo que usa
          // Liquidaciones para cortar el período por hora, no solo por
          // día (sin esto quedaría en el default now() de la tabla, que
          // podría diferir en milisegundos del momento real de la venta).
          created_at: payload.created_at,
          // Congela el % usado en esta venta puntual — "Ver detalle" no
          // puede recalcular con el % actual del profesional si cambia
          // después.
          commission_pct: commissionPct,
        });
      if (commissionError) {
        console.warn(
          "[registerPayment] no se pudo registrar la comisión:",
          commissionError.message,
        );
      }
    }
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
