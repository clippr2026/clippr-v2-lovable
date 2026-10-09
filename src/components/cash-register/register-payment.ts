import { toast } from "sonner";
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
  sessionId?: string | null;
  chargedBy?: string | null;
  appointmentId?: string | null;
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

  const payload: Record<string, unknown> = {
    business_id: input.businessId,
    branch_id: resolvedBranchId,
    employee_id: input.employeeId ?? null,
    // Relación principal con `clients` — antes se recibía pero nunca se
    // guardaba, y la ficha/RPC de Clientes solo podían matchear este pago
    // por client_name (texto), perdiendo/mezclando historial ante
    // homónimos o nombres editados después de cobrar.
    client_id: input.clientId ?? null,
    client_name: input.clientName === null ? null : input.clientName || "Cliente del mostrador",
    service_name: saleSummary,
    amount: total,
    total,
    // Nunca incluye la propina — total/amount son pura facturación de
    // servicios/productos post-descuento, la base de todo lo que ya suma
    // Facturación/Ticket promedio/Cierre de Caja/comisión. La propina vive
    // aparte, en su propia columna.
    tip_amount: Math.max(0, Number(input.tipAmount ?? 0)),
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

  // Descuento aplicado — el dato definitivo (no el "previsto" del turno, que
  // puede haber sido cambiado/quitado acá mismo antes de confirmar). Guarda
  // precio original + descuento + etiqueta para que Historial/Clientes/
  // Dashboard/comisiones/liquidaciones puedan reconstruir el desglose
  // completo sin volver a consultar la promo (que puede editarse/borrarse
  // después) — funciona igual para promoción real o descuento manual, la
  // única diferencia es si promotion_id queda seteado o no (ver el tipo
  // RegisterPaymentInput arriba).
  if (input.promotionId || discountAmount > 0) {
    if (input.promotionId) payload.promotion_id = input.promotionId;
    payload.promotion_name = input.promotionName ?? null;
    payload.discount_type = input.discountType ?? null;
    payload.discount_value = input.discountValue != null ? Number(input.discountValue) : null;
    payload.discount = discountAmount;
  }
  // original_amount ("precio de lista tachado" en Liquidaciones) se guarda
  // siempre que el precio de lista supere lo realmente cobrado — no solo
  // cuando hubo promoción/descuento manual, también cuando se cobró con
  // "precio en efectivo" sin ningún descuento explícito de por medio.
  if (listTotal > total) {
    payload.original_amount = Math.round(listTotal);
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
    await incrementPromotionUsage(input.businessId, input.promotionId, clientKeys, input.branchId ?? null);
  }

  // Registra la comisión generada por esta venta — fuente de verdad del
  // saldo pendiente del profesional (Caja > Liquidaciones), independiente
  // de cualquier rango de fechas. Best-effort: si falla (ej. la migración
  // de liquidaciones todavía no corrió), no aborta la venta ya confirmada.
  //
  // computeCommissionAmount (service-pricing.ts) resuelve, ítem por ítem,
  // si ese servicio puntual tiene comisión propia configurada en Equipo
  // (prioridad) y si no, aplica el fallback general del profesional
  // (monto fijo por venta si está configurado, si no el %) — antes acá
  // SOLO se miraba el % o el monto fijo GENERALES (employees.commission_pct/
  // commission_fixed): un profesional con comisión configurada por
  // servicio nunca generaba fila en commission_records, así que
  // "Comisiones generadas" en Liquidaciones le quedaba siempre en $0 sin
  // importar cuánto facturara ni qué rango de fechas se eligiera.
  const commissionFixed = Number(input.commissionFixed ?? 0);
  const commissionPct = Number(input.commissionPct ?? 0);
  if (input.employeeId) {
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
    const commissionAmount = Math.round(pctAmount + fixedAmount * discountRatio);
    if (commissionAmount > 0) {
      // Si algún ítem usó su propia comisión por servicio, no hay un único
      // % que represente el total — queda null. (El fallback fijo general,
      // employees.commission_fixed, ya no participa del cálculo — ver
      // computeCommissionAmount — así que no entra en esta decisión.)
      const usedSpecificOverride = input.items.some((item) => {
        if (!item.serviceId) return false;
        const cfg = input.employeeCommissions?.[input.employeeId!]?.[item.serviceId];
        return !!cfg && cfg.enabled !== false;
      });
      // RPC security definer (register_commission, ver migración
      // 20261008010000) — NUNCA un insert directo a commission_records
      // desde acá. La policy commission_records_write bloquea cualquier
      // escritura de un usuario con profiles.role = 'profesional', incluso
      // para su propia comisión — correcto para impedir que edite montos a
      // mano, pero el cobro de su propia venta (Nueva Venta o Cobrar
      // Turno, mismo código) quedaba silenciosamente sin comisión por esa
      // misma policy. El RPC corre con privilegios elevados pero valida
      // todo server-side (negocio, dueño real de la venta, rango de
      // monto) antes de insertar — no es un bypass abierto.
      const { data: commissionResult, error: commissionError } = await supabase.rpc(
        "register_commission" as any,
        {
          p_business_id: input.businessId,
          p_professional_id: input.employeeId,
          p_sale_id: data[0].id,
          p_amount: commissionAmount,
          p_sale_date: (payload.created_at as string).slice(0, 10),
          // Misma marca de tiempo exacta que el pago — es lo que usa
          // Liquidaciones para cortar el período por hora, no solo por
          // día (sin esto quedaría en el default now() de la tabla, que
          // podría diferir en milisegundos del momento real de la venta).
          p_created_at: payload.created_at,
          // Congela el % usado en esta venta puntual — "Ver detalle" no
          // puede recalcular con el % actual del profesional si cambia
          // después. null cuando la comisión no vino de un único % general
          // (fue por servicio y/o monto fijo).
          p_commission_pct: usedSpecificOverride ? null : commissionPct,
        },
      );
      if (commissionError) {
        console.warn(
          "[registerPayment] no se pudo registrar la comisión:",
          commissionError.message,
        );
        // El cobro ya está guardado y no se revierte por esto — pero el
        // error no puede quedar solo en consola (así se perdió la
        // comisión de Alejandro del 7/10 sin que nadie se enterara).
        toast.error(
          "La venta se guardó, pero no se pudo registrar la comisión. Avisá a quien administra el negocio.",
        );
      } else {
        const row = (Array.isArray(commissionResult) ? commissionResult[0] : commissionResult) as
          | { id: string; inserted: boolean }
          | undefined;
        if (row && row.inserted === false) {
          // sale_id ya tenía una fila (llamada repetida/duplicada) — no es
          // un error, el RPC es idempotente y no creó una segunda.
          console.warn(
            "[registerPayment] commission_records ya existía para esta venta, no se duplicó:",
            data[0].id,
          );
        }
      }
    }
  }

  // Propina — fila propia en tip_records (NUNCA en commission_records: son
  // dos conceptos que Liquidaciones tiene que poder mostrar y liquidar por
  // separado, "Comisiones generadas" vs "Propinas"). Independiente de si
  // hubo comisión — un profesional sin comisión configurada igual puede
  // recibir propina. Sin profesional asignado no se genera fila (no hay a
  // quién liquidarle), pero tip_amount ya quedó guardado en payments para
  // el registro igual. Best-effort, mismo criterio que commission_records:
  // si falla, no aborta el cobro ya confirmado.
  const tipAmount = Math.max(0, Number(input.tipAmount ?? 0));
  if (input.employeeId && tipAmount > 0) {
    const { error: tipError } = await supabase
      .from("tip_records" as any)
      .insert({
        business_id: input.businessId,
        professional_id: input.employeeId,
        sale_id: data[0].id,
        amount: tipAmount,
        sale_date: (payload.created_at as string).slice(0, 10),
        created_at: payload.created_at,
      });
    if (tipError) {
      console.warn("[registerPayment] no se pudo registrar la propina:", tipError.message);
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
