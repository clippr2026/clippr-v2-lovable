import { supabase } from "@/integrations/supabase/client";
import {
  normalizeClientKeys,
  computeCommissionAmount,
  type PromotionDiscountType,
  type EmployeeCommissionMap,
} from "@/lib/service-pricing";
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

// "card" y "mp" quedan solo por compatibilidad con pagos ya guardados
// antes de este cambio (siguen resolviendo su label para verlos en
// Historial/Detalle) — el selector de métodos ya no los ofrece para
// cobros nuevos, ver ACTIVE_PAY_METHODS más abajo. "debit"/"credit"/"qr"
// son las reemplazan: métodos independientes también a nivel de datos
// (no solo de texto), para poder tener a futuro comisión/configuración
// propia por cada uno sin tener que migrar ningún pago histórico.
export type PayMethod = "cash" | "transfer" | "card" | "debit" | "credit" | "mp" | "qr" | "cuenta";

export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta", // legado
  debit: "Débito",
  credit: "Crédito",
  mp: "Mercado Pago", // legado
  qr: "QR",
  cuenta: "Cuenta",
};

// Selector de métodos de pago de Caja (Nueva venta, Pago múltiple, Pagar
// liquidación) — fijo, ya no depende de switches en Configuración > Caja
// (business_settings.schedule._caja.methods se dejó de leer/escribir por
// completo). Mismo orden en toda la app: Efectivo/Transferencia primero,
// Débito/Crédito/QR después.
export const ACTIVE_PAY_METHODS: ReadonlyArray<{ id: PayMethod; label: string }> = [
  { id: "cash", label: "Efectivo" },
  { id: "transfer", label: "Transferencia" },
  { id: "debit", label: "Débito" },
  { id: "credit", label: "Crédito" },
  { id: "qr", label: "QR" },
];

export type RegisterPaymentItem = {
  serviceName: string;
  amount: number;
  qty?: number;
  serviceId?: string | null;
  isCatalog?: boolean;
  // Precio de lista real (precio_catalog.price resuelto, SIN precio en
  // efectivo) al momento de esta venta puntual — null/undefined = no se
  // pudo resolver, cae a `amount` (sin diferencia visual). Se usa para
  // congelar en payments.original_amount el "precio tachado" que va a
  // mostrar Liquidaciones, para que no dependa del precio ACTUAL del
  // catálogo (que puede cambiar después).
  listPrice?: number | null;
  // Precio efectivo del servicio (tope de la base de comisión — ver
  // computeCommissionAmount) — null/undefined si no tiene uno configurado.
  // Quien arma el carrito (Caja) ya lo resuelve por profesional
  // (resolveServicePricing) antes de llegar acá.
  effectivePrice?: number | null;
  // Descuento en $ ya atribuido a ESTA línea completa (qty incluido) —
  // nunca el descuento total del carrito. Quien arma el carrito decide cómo
  // repartirlo (promo solo entre los ítems que alcanza, descuento manual
  // prorrateado entre todos) antes de llegar acá.
  discountAmount?: number;
};

export type ChargeOrigin = "auto" | "manual" | "caja";

export type RegisterPaymentInput = {
  businessId: string;
  // Sucursal activa al momento del cobro — se guarda en payments.branch_id
  // para que la venta aparezca del lado correcto en Caja/Dashboard al
  // filtrar por sucursal. null en negocios todavía sin migrar a
  // multi-sucursal (branch_id queda null, mismo comportamiento de antes).
  branchId?: string | null;
  employeeId?: string | null;
  employeeName?: string | null;
  // null explícito (no "" ni undefined) = sin cliente real, no
  // defaultear a "Cliente del mostrador" — caso de un profesional que
  // retira/compra stock para sí mismo (Inventario → Retirar stock): va
  // en employeeId, nunca en clientName. payments.client_name ya es
  // nullable (el resto de la app lo lee con "?? \"—\""), así que esto no
  // rompe ninguna consulta existente.
  clientName: string | null;
  clientId?: string | null;
  items: RegisterPaymentItem[];
  method: PayMethod;
  splits?: Array<{ method: PayMethod; amount: number }>;
  commissionPct?: number | null;
  // Comisión fija en $ por venta — cuando está configurada (> 0), tiene
  // prioridad sobre commissionPct. Mismo criterio que ya usan Profesionales
  // (Desglose) y la pestaña legacy de Profesionales de Caja.
  commissionFixed?: number | null;
  // Comisión por servicio (Equipo → [profesional] → Servicios) — tiene
  // prioridad sobre commissionPct/commissionFixed para el/los ítems que
  // tengan su propio override configurado. Ver computeCommissionAmount.
  employeeCommissions?: EmployeeCommissionMap | null;
  // Toggle por profesional (employees.commission_enabled, Equipo →
  // [profesional] → Comisiones) — false = este profesional NUNCA genera
  // comisión, sin importar commissionPct/commissionFixed/employeeCommissions
  // (ni siquiera un override por servicio activo). Pensado para el dueño
  // del negocio, que puede asignarse ventas como cualquier profesional
  // pero no debe cobrarse comisión a sí mismo. undefined/true = sin
  // cambios (comportamiento de siempre). register_sale vuelve a validar
  // esto server-side (ver 20261022010000_employee_commission_enabled.sql)
  // por si llega un cliente viejo cacheado que no manda este campo.
  commissionsEnabled?: boolean;
  sessionId?: string | null;
  chargedBy?: string | null;
  appointmentId?: string | null;
  // Nota del profesional en el turno (Cobrar turno) — se guarda en
  // appointments.notes, NUNCA en payments.observations (eso es `notes`
  // más abajo, un campo distinto). Solo tiene efecto si appointmentId
  // viene seteado: register_sale hace la transición de ese turno a
  // 'charged' + este UPDATE de notes dentro de la MISMA transacción que
  // el payment (ver 20261011030000_register_sale_atomic.sql) — antes era
  // un UPDATE aparte hecho ANTES de llamar acá, que podía dejar el turno
  // "cobrado" sin ningún payment si el registro fallaba después.
  appointmentNotes?: string | null;
  chargeOrigin?: ChargeOrigin;
  status?: "cobrado" | "pendiente" | "anulado" | "reembolsado";
  notes?: string | null;
  // Descuento APLICADO (dato definitivo) — se completa recién acá, al
  // confirmar el cobro. discountAmount ya viene calculado en $ (la UI de
  // Caja decide a qué ítems del carrito aplica, este módulo solo lo resta
  // del total y lo deja registrado). Dos orígenes posibles, misma forma:
  // - Promoción real: promotionId + promotionName = nombre de la promo.
  //   Incrementa el uso de la promo (incrementPromotionUsage) al confirmar.
  // - Descuento manual (sin promoción): promotionId queda null,
  //   promotionName pasa a ser el MOTIVO tipeado por quien cobra (ej.
  //   "Cortesía") — misma columna, reutilizada como "etiqueta del
  //   descuento" en vez de "nombre de promoción", así no hace falta una
  //   columna nueva. No incrementa uso de ninguna promo.
  // Sin discountAmount > 0, ninguno de estos campos se escribe y el pago
  // queda exactamente como antes.
  promotionId?: string | null;
  promotionName?: string | null;
  discountType?: PromotionDiscountType | null;
  discountValue?: string | null;
  discountAmount?: number;
  // Propina — plata del profesional, nunca del negocio. Se guarda en su
  // propia columna (tip_amount) y en tip_records (ver más abajo): jamás se
  // suma dentro de amount/total, así Facturación/Ticket promedio/base de
  // comisión la excluyen automáticamente sin tener que restarla en ningún
  // otro punto de la app.
  tipAmount?: number | null;
  // Para el límite "por cliente" de la promo (normalizeClientKeys) — best
  // effort: sin estos datos, el incremento de uso igual corre (cupo total),
  // solo no puede chequear/contar el límite por cliente puntual.
  clientPhone?: string | null;
  clientEmail?: string | null;
  // Idempotencia server-side (ver 20261019040000_payments_idempotency_key.sql)
  // — mismo UUID en dos llamadas (reintento tras un time-out de red, nunca
  // un cobro distinto) devuelve el payment ya creado en la primera, sin
  // insertar un segundo. null/undefined = sin protección (comportamiento
  // de siempre). Quien arma el carrito (cash-register.tsx) es responsable
  // de generarla una vez por intento y solo reutilizarla en un reintento
  // del MISMO cobro.
  idempotencyKey?: string | null;
  // Pago pendiente (ver 20261023020000_register_sale_pending_payments.sql)
  // — cuánto de `total` se cobra EFECTIVAMENTE en este momento. undefined/
  // null = comportamiento de siempre (se asume cobrado el total completo,
  // ningún llamador existente manda esto). 0 = venta 100% pendiente; un
  // valor entre 0 y total = pago parcial, el resto queda pendiente de
  // cobro (ver Caja → Ingresar dinero → Cobrar pendiente). El RPC infiere
  // payments.status (pendiente/parcial/cobrado) a partir de este monto —
  // nunca hace falta mandar `status` para esto.
  collectedAmount?: number | null;
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
  // ítems son alcanzados por la promo/descuento manual es decisión de la
  // UI, acá solo se resta del total una vez, con tope para nunca dar
  // negativo). Se aplica siempre que haya descuento, sea de una promoción
  // real o manual — antes solo se restaba con promotionId presente, lo que
  // dejaba sin efecto cualquier descuento manual (no existía todavía).
  const discountAmount = Math.max(0, Math.min(grossTotal, Number(input.discountAmount ?? 0)));
  const total = grossTotal - discountAmount;
  // Precio de lista total (sin precio en efectivo, sin descuento) — puede
  // ser mayor a `total` aunque no haya habido ninguna promoción/descuento
  // manual (ej. se cobró con "precio en efectivo"). Ver original_amount
  // más abajo.
  const listTotal = input.items.reduce((sum, item) => {
    const qty = Number(item.qty ?? 1);
    return sum + Number(item.listPrice ?? item.amount ?? 0) * qty;
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

  // input.branchId viene de activeBranchId (useAuth), que arranca en null y
  // se resuelve async después de cada login/hydrate — una venta cobrada en
  // esa ventana (antes de que termine de resolverse la sucursal) quedaba con
  // branch_id null para siempre, invisible en Caja al filtrar por sucursal
  // activa aunque el cobro sea real. Nunca confiar en null sin chequear: si
  // pasa, resuelve la sucursal principal del negocio (o la más vieja si
  // ninguna está marcada principal) antes de guardar — todo negocio tiene
  // siempre al menos una (ver 20261002060000_branches_principal_casa_central).
  let resolvedBranchId = input.branchId ?? null;
  if (!resolvedBranchId) {
    const { data: fallbackBranch } = await supabase
      .from("branches")
      .select("id")
      .eq("business_id", input.businessId)
      .order("is_principal", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    resolvedBranchId = (fallbackBranch as { id?: string } | null)?.id ?? null;
  }

  // session_id tiene FK a cash_sessions ("payments_session_id_fkey") — un
  // id que ya no existe ahí (ej. de una sesión vieja que quedó cacheada en
  // business_settings antes de un reset de datos que vació cash_sessions)
  // hace fallar el insert del pago con TODOS los métodos por igual, no es
  // un problema de Efectivo/Transferencia/etc. Se verifica acá, antes de
  // llamar al RPC, en vez de confiar ciegamente en input.sessionId — si no
  // existe más, se omite (el pago se registra igual, sin sesión asociada)
  // en lugar de romper el cobro.
  let verifiedSessionId: string | null = null;
  if (input.sessionId) {
    const { data: sessionRow } = await supabase
      .from("cash_sessions")
      .select("id")
      .eq("id", input.sessionId)
      .maybeSingle();
    verifiedSessionId = sessionRow?.id ?? null;
  }

  // Descuento/precio de lista — mismo criterio de siempre: discount/
  // promotion_* solo se completan si hubo descuento real; original_amount
  // ("precio de lista tachado" en Liquidaciones) se guarda siempre que el
  // de lista supere lo realmente cobrado, incluso sin descuento explícito
  // (ej. "precio en efectivo").
  const hasDiscount = Boolean(input.promotionId) || discountAmount > 0;
  const originalAmount = listTotal > total ? Math.round(listTotal) : null;

  // Comisión generada por esta venta — fuente de verdad del saldo
  // pendiente del profesional (Caja > Liquidaciones). computeCommissionAmount
  // (service-pricing.ts) resuelve, ítem por ítem, si ese servicio puntual
  // tiene comisión propia configurada en Equipo (prioridad) y si no,
  // aplica el fallback general del profesional (monto fijo por venta si
  // está configurado, si no el %) — ÚNICA fuente real de este cálculo,
  // nunca reimplementado en el RPC (ver register_sale, que solo valida
  // rango/signo y persiste todo en una sola transacción).
  const commissionFixed = Number(input.commissionFixed ?? 0);
  const commissionPct = Number(input.commissionPct ?? 0);
  let commissionAmount = 0;
  let usedSpecificOverride = false;
  if (input.employeeId && input.commissionsEnabled !== false) {
    // Regla de base de comisión (ítem por ítem, ver commissionBaseForLine
    // en service-pricing.ts): base = MIN(precio efectivo del servicio,
    // importe neto realmente cobrado por esa línea). Si paga de más (lista,
    // débito/crédito/QR) ese extra nunca sube la comisión; si paga de menos
    // (promo/descuento) la comisión baja con lo realmente cobrado. Cada
    // item ya trae su propio discountAmount (repartido correctamente entre
    // servicios — ver cash-register.tsx), así que pctAmount que devuelve
    // acá YA es el monto final, nunca se vuelve a escalar.
    const { pctAmount, fixedAmount } = computeCommissionAmount(
      input.items.map((item) => ({
        amount: Number(item.amount ?? 0),
        qty: item.qty,
        serviceId: item.serviceId,
        effectivePrice: item.effectivePrice ?? null,
        discountAmount: Number(item.discountAmount ?? 0),
        isCatalog: Boolean(item.isCatalog),
      })),
      input.employeeId,
      input.employeeCommissions ?? null,
      { commissionFixed, commissionPct },
    );
    // fixedAmount es un monto fijo por servicio/venta, ajeno al precio por
    // definición — nunca lleva tope de precio efectivo. Sigue
    // escalándose por el % de descuento del carrito completo, exactamente
    // igual que el cálculo plano de antes (mismo criterio pre-existente,
    // sin cambios): no tiene sentido pagar la comisión fija completa sobre
    // una venta que, en conjunto, se cobró con descuento.
    const discountRatio = grossTotal > 0 && total !== grossTotal ? total / grossTotal : 1;
    commissionAmount = Math.round(pctAmount + fixedAmount * discountRatio);
    // Si algún ítem usó su propia comisión por servicio, no hay un único %
    // que represente el total — el pct congelado queda null. (El fallback
    // fijo general, employees.commission_fixed, no participa del cálculo
    // — ver computeCommissionAmount — así que no entra en esta decisión.)
    usedSpecificOverride = input.items.some((item) => {
      if (!item.serviceId) return false;
      const cfg = input.employeeCommissions?.[input.employeeId!]?.[item.serviceId];
      return !!cfg && cfg.enabled !== false;
    });
  }

  const tipAmount = Math.max(0, Number(input.tipAmount ?? 0));
  const nowIso = new Date().toISOString();

  // register_sale (RPC security definer, ver migración
  // 20261011030000_register_sale_atomic.sql) hace TODO esto en una sola
  // transacción: insertar el payment, la comisión (si corresponde), la
  // propina (si hay) y, si viene de un turno, la transición de
  // appointments.status a 'charged' — si cualquier parte falla, Postgres
  // hace rollback de todo, nunca queda un payment guardado con la
  // comisión/propina/turno a medias (antes eran 5 llamadas de red
  // separadas, cada una best-effort — ver auditoría del 11/10/2026: 4
  // ventas con comisión perdida + 3 turnos "charged" sin ningún payment).
  const { data: rpcData, error: rpcError } = await supabase.rpc("register_sale" as any, {
    p_business_id: input.businessId,
    p_branch_id: resolvedBranchId,
    p_employee_id: input.employeeId ?? null,
    p_client_id: input.clientId ?? null,
    p_client_name: input.clientName === null ? null : input.clientName || "Cliente del mostrador",
    p_service_name: saleSummary,
    p_amount: total,
    p_total: total,
    p_tip_amount: tipAmount,
    p_items: savedItems,
    p_method: input.method,
    p_splits: input.splits && input.splits.length > 0 ? input.splits : null,
    p_appointment_id: input.appointmentId ?? null,
    p_appointment_notes: input.appointmentNotes ?? null,
    p_charge_type: input.chargeOrigin ?? "caja",
    p_status: input.status ?? "cobrado",
    p_session_id: verifiedSessionId,
    p_notes: input.notes?.trim() || null,
    p_promotion_id: hasDiscount ? input.promotionId ?? null : null,
    p_promotion_name: hasDiscount ? input.promotionName ?? null : null,
    p_discount_type: hasDiscount ? input.discountType ?? null : null,
    p_discount_value: hasDiscount && input.discountValue != null ? Number(input.discountValue) : null,
    p_discount: hasDiscount ? discountAmount : 0,
    p_original_amount: originalAmount,
    p_commission_amount: commissionAmount,
    p_commission_pct: usedSpecificOverride ? null : commissionPct,
    p_charged_by: chargedByUuid,
    p_created_at: nowIso,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_collected_amount: input.collectedAmount ?? null,
  });

  if (rpcError) {
    const detail = `${rpcError.code ?? ""} ${rpcError.message} ${rpcError.details ?? ""} ${rpcError.hint ?? ""}`.trim();
    throw new Error(detail || "Error guardando la venta");
  }

  const result = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | { payment_id: string; commission_record_id: string | null; tip_record_id: string | null }
    | undefined;
  if (!result?.payment_id) {
    throw new Error("No se pudo registrar la venta (respuesta vacía del servidor).");
  }

  // Uso de la promo: se consume acá, recién con el cobro ya confirmado
  // (nunca al agendar/prever) — best-effort a propósito (es un contador de
  // cupo, no plata real): si falla, no tiene sentido deshacer una venta ya
  // cobrada y persistida por este mismo RPC.
  if (input.promotionId) {
    const clientKeys = normalizeClientKeys(input.clientPhone ?? "", input.clientEmail ?? "");
    await incrementPromotionUsage(input.businessId, input.promotionId, clientKeys, input.branchId ?? null);
  }

  // Forma de retorno compatible con el insert directo de antes (los
  // call-sites de Caja solo leen `[0].id`, ver cash-register.tsx).
  return [{ id: result.payment_id }];
}

/**
 * Elimina un cobro (Caja → Últimos ingresos → detalle → "Eliminar cobro").
 * `commission_records.sale_id`/`tip_records.sale_id` referencian
 * `payments(id) on delete cascade` — borrar el pago se lleva puestas su
 * comisión y su propina asociadas en la misma operación, sin dejar filas
 * huérfanas ni necesitar un segundo delete.
 *
 * Si esa comisión o propina ya quedó bloqueada dentro de una liquidación
 * (`settlement_run_id` no nulo), se aborta: `prepare_settlement_run`
 * congela el total de esa liquidación en `settlement_runs` en el momento
 * de crearla (no se recalcula de `commission_records` después), así que
 * borrar la fila no corrompe ningún saldo — pero sí borraría el detalle
 * histórico de qué venta puntual compuso esa liquidación ya cerrada.
 */
export async function deletePayment(paymentId: string, businessId: string) {
  const [{ data: commissionRows }, { data: tipRows }] = await Promise.all([
    supabase
      .from("commission_records" as any)
      .select("settlement_run_id")
      .eq("sale_id", paymentId),
    supabase
      .from("tip_records" as any)
      .select("settlement_run_id")
      .eq("sale_id", paymentId),
  ]);
  const alreadySettled =
    (commissionRows ?? []).some((r: any) => r.settlement_run_id) ||
    (tipRows ?? []).some((r: any) => r.settlement_run_id);
  if (alreadySettled) {
    throw new Error(
      "Este cobro ya forma parte de una liquidación cerrada — no se puede eliminar desde acá sin perder ese detalle histórico.",
    );
  }

  const { error } = await supabase
    .from("payments")
    .delete()
    .eq("id", paymentId)
    .eq("business_id", businessId);
  if (error) {
    throw new Error(error.message || "No se pudo eliminar el cobro");
  }
}

/**
 * Elimina un adelanto al profesional (Caja → Liquidaciones). Igual que
 * deletePayment, se aborta si el adelanto ya fue incluido en una
 * liquidación (settlement_run_id no nulo) — esa liquidación ya congeló el
 * total descontado, borrar la fila ahora corrompería ese historial.
 */
export async function deleteProfessionalAdvance(advanceId: string, businessId: string) {
  const { data: row, error: fetchError } = await supabase
    .from("professional_advances" as any)
    .select("settlement_run_id")
    .eq("id", advanceId)
    .maybeSingle();
  if (fetchError) {
    throw new Error(fetchError.message || "No se pudo verificar el adelanto");
  }
  if ((row as { settlement_run_id: string | null } | null)?.settlement_run_id) {
    throw new Error(
      "Este adelanto ya forma parte de una liquidación cerrada — no se puede eliminar desde acá.",
    );
  }

  const { error } = await supabase
    .from("professional_advances" as any)
    .delete()
    .eq("id", advanceId)
    .eq("business_id", businessId);
  if (error) {
    throw new Error(error.message || "No se pudo eliminar el adelanto");
  }
}
