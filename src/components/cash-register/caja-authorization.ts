import { supabase } from "@/integrations/supabase/client";

/**
 * Corregir cobro / Anular venta — protegidos por una contraseña de
 * autorización propia por acción (ver Configuración → Seguridad →
 * Autorizaciones de caja). Toda la validación (contraseña, rol, día
 * abierto/cerrado, liquidaciones) vive server-side en los RPCs
 * (20261025020000/30000/40000) — este archivo solo wrappea las llamadas,
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
};

export async function voidPaymentAuthorized(
  input: VoidPaymentAuthorizedInput,
): Promise<{ newStatus: string }> {
  const { data, error } = await supabase.rpc("void_payment_authorized" as any, {
    p_payment_id: input.paymentId,
    p_business_id: input.businessId,
    p_password: input.password,
    p_reason: input.reason,
  });
  if (error) throw new Error(rpcErrorMessage(error, "No se pudo anular la venta"));
  const row = (Array.isArray(data) ? data[0] : data) as { new_status?: string } | undefined;
  return { newStatus: row?.new_status ?? "anulado" };
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
