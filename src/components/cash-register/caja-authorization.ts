import { supabase } from "@/integrations/supabase/client";

/**
 * Corregir cobro / Anular venta / Eliminar cobro — protegidos por una
 * contraseña de autorización propia por acción (ver Configuración →
 * Seguridad → Autorizaciones de caja). Toda la validación (contraseña,
 * rol, día abierto/cerrado, liquidaciones) vive server-side en los RPCs
 * (20261025020000 en adelante) — este archivo solo wrappea las llamadas,
 * mismo estilo que register-payment.ts.
 */

export type CajaAuthorizationActionType = "correction" | "void";

function rpcErrorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message || fallback;
}

export async function hasCajaAuthorizationPassword(
  businessId: string,
  actionType: CajaAuthorizationActionType,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_caja_authorization_password" as any, {
    p_business_id: businessId,
    p_action_type: actionType,
  });
  if (error) throw new Error(rpcErrorMessage(error, "No se pudo consultar la contraseña de autorización"));
  return Boolean(data);
}

export async function setCajaAuthorizationPassword(
  businessId: string,
  actionType: CajaAuthorizationActionType,
  newPassword: string,
): Promise<void> {
  const { error } = await supabase.rpc("set_caja_authorization_password" as any, {
    p_business_id: businessId,
    p_action_type: actionType,
    p_new_password: newPassword,
  });
  if (error) throw new Error(rpcErrorMessage(error, "No se pudo configurar la contraseña de autorización"));
}

export type VoidPaymentAuthorizedInput = {
  paymentId: string;
  businessId: string;
  password: string;
  reason: string;
  // Nombre de quien AUTORIZÓ, si es distinto de quien ejecuta la acción
  // (auth.uid() — ver performed_by/performed_by_name). undefined/"" =
  // misma persona, no se guarda nada aparte.
  authorizedByName?: string;
};

export async function voidPaymentAuthorized(
  input: VoidPaymentAuthorizedInput,
): Promise<{ newStatus: string }> {
  const { data, error } = await supabase.rpc("void_payment_authorized" as any, {
    p_payment_id: input.paymentId,
    p_business_id: input.businessId,
    p_password: input.password,
    p_reason: input.reason,
    p_authorized_by_name: input.authorizedByName?.trim() || null,
  });
  if (error) throw new Error(rpcErrorMessage(error, "No se pudo anular la venta"));
  const row = (Array.isArray(data) ? data[0] : data) as { new_status?: string } | undefined;
  return { newStatus: row?.new_status ?? "anulado" };
}

export type DeletePaymentAuthorizedInput = {
  paymentId: string;
  businessId: string;
  password: string;
  reason: string;
  authorizedByName?: string;
};

// Reutiliza la contraseña de "void" (ver 20261025050000_delete_payment_authorized.sql)
// — eliminar un cobro es, si acaso, una anulación más fuerte (borrado
// físico en vez de marcarlo anulado), no una categoría de acción distinta
// que necesite su propia contraseña.
export async function deletePaymentAuthorized(input: DeletePaymentAuthorizedInput): Promise<void> {
  const { error } = await supabase.rpc("delete_payment_authorized" as any, {
    p_payment_id: input.paymentId,
    p_business_id: input.businessId,
    p_password: input.password,
    p_reason: input.reason,
    p_authorized_by_name: input.authorizedByName?.trim() || null,
  });
  if (error) throw new Error(rpcErrorMessage(error, "No se pudo eliminar el cobro"));
}

export type CorrectPaymentAuthorizedInput = {
  paymentId: string;
  businessId: string;
  password: string;
  reason: string;
  // Cada campo es opcional — omitido = se mantiene el valor actual de la
  // venta (ver coalesce en correct_payment_authorized). newCommissionAmount
  // es la única excepción: si se manda, siempre se recalculó con
  // computeCommissionAmount (service-pricing.ts), igual que una venta
  // nueva — nunca se reimplementa esa fórmula acá ni en el RPC.
  newTotal?: number;
  newDiscount?: number;
  newTip?: number;
  newMethod?: string;
  newCommissionAmount?: number | null;
  authorizedByName?: string;
  // "YYYY-MM-DD" — solo si cambia el día calendario (Buenos Aires) de la
  // venta. El RPC rechaza el cambio si el día de origen o el de destino ya
  // está cerrado (20261025090000) — mover fecha no tiene equivalente de
  // "ajuste" tipo delta como las demás correcciones.
  newDate?: string;
};

export async function correctPaymentAuthorized(
  input: CorrectPaymentAuthorizedInput,
): Promise<{ adjustmentPaymentId: string | null; wasClosed: boolean }> {
  const { data, error } = await supabase.rpc("correct_payment_authorized" as any, {
    p_payment_id: input.paymentId,
    p_business_id: input.businessId,
    p_password: input.password,
    p_reason: input.reason,
    p_new_total: input.newTotal ?? null,
    p_new_discount: input.newDiscount ?? null,
    p_new_tip: input.newTip ?? null,
    p_new_method: input.newMethod ?? null,
    p_new_commission_amount: input.newCommissionAmount ?? null,
    p_authorized_by_name: input.authorizedByName?.trim() || null,
    p_new_date: input.newDate ?? null,
  });
  if (error) throw new Error(rpcErrorMessage(error, "No se pudo corregir el cobro"));
  const row = (Array.isArray(data) ? data[0] : data) as
    | { adjustment_payment_id?: string | null; was_closed?: boolean }
    | undefined;
  return {
    adjustmentPaymentId: row?.adjustment_payment_id ?? null,
    wasClosed: Boolean(row?.was_closed),
  };
}

// ── Historial de actividad ───────────────────────────────────────────────
// Lee directo de payment_authorization_log (select ya permitido por su
// policy — scoped a business_id, ver 20261025010000) — sin RPC propio,
// es de solo lectura y no hay nada sensible que filtrar acá (a diferencia
// de caja_authorization_codes, que nunca se expone). before_snapshot ya
// trae client_name/service_name/employee_name "horneados" desde
// 20261025060000, así que esto nunca necesita un join en vivo contra
// payments/employees.

export type PaymentAuthorizationLogAction = "correction" | "void" | "deletion";

export type PaymentAuthorizationLogRow = {
  id: string;
  paymentId: string | null;
  actionType: PaymentAuthorizationLogAction;
  reason: string;
  performedBy: string | null;
  performedByName: string | null;
  authorizedByName: string | null;
  impactNote: string | null;
  beforeSnapshot: Record<string, any> | null;
  afterSnapshot: Record<string, any> | null;
  adjustmentPaymentId: string | null;
  createdAt: string;
};

const DELETION_REASON_PREFIX = "Eliminación completa — ";

function mapLogRow(row: any): PaymentAuthorizationLogRow {
  const rawReason = String(row.reason ?? "");
  const isDeletion = row.action_type === "void" && rawReason.startsWith(DELETION_REASON_PREFIX);
  return {
    id: row.id,
    paymentId: row.payment_id ?? null,
    actionType: isDeletion ? "deletion" : row.action_type,
    reason: isDeletion ? rawReason.slice(DELETION_REASON_PREFIX.length) : rawReason,
    performedBy: row.performed_by ?? null,
    performedByName: row.performed_by_name ?? null,
    authorizedByName: row.authorized_by_name ?? null,
    impactNote: row.impact_note ?? null,
    beforeSnapshot: row.before_snapshot ?? null,
    afterSnapshot: row.after_snapshot ?? null,
    adjustmentPaymentId: row.adjustment_payment_id ?? null,
    createdAt: row.created_at,
  };
}

export async function getPaymentAuthorizationHistory(paymentId: string): Promise<PaymentAuthorizationLogRow[]> {
  const { data, error } = await supabase
    .from("payment_authorization_log" as any)
    .select("*")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(rpcErrorMessage(error, "No se pudo cargar el historial de este cobro"));
  return ((data ?? []) as any[]).map(mapLogRow);
}

export type ActivityLogPage = {
  rows: PaymentAuthorizationLogRow[];
  // true = hay más filas viejas que estas — mostrar "Cargar más" (sin
  // filtros, ver seguridad-section.tsx: simplificado a propósito, un solo
  // orden cronológico descendente, nada que filtrar).
  hasMore: boolean;
};

// Pide "limit + 1" para saber si hay más SIN una query de count aparte —
// si vuelven limit+1 filas, se corta a limit y hasMore = true.
export async function getActivityLog(
  businessId: string,
  opts: { beforeCreatedAt?: string | null; limit?: number } = {},
): Promise<ActivityLogPage> {
  const limit = opts.limit ?? 30;
  let query = supabase
    .from("payment_authorization_log" as any)
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (opts.beforeCreatedAt) query = query.lt("created_at", opts.beforeCreatedAt);

  const { data, error } = await query;
  if (error) throw new Error(rpcErrorMessage(error, "No se pudo cargar el historial de actividad"));
  const allRows = ((data ?? []) as any[]).map(mapLogRow);
  const hasMore = allRows.length > limit;
  return { rows: hasMore ? allRows.slice(0, limit) : allRows, hasMore };
}
