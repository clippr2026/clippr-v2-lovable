import { supabase } from "@/integrations/supabase/client";

/**
 * Portado de confirmarCobro() en app.js (líneas 1916-2100).
 * Inserta un row en `payments` por cada servicio cobrado.
 * Mantenemos las mismas columnas que la app vanilla:
 *   business_id, employee_id, client_name, service_name, amount, total,
 *   method, payment_method, created_at, session_id?, charged_by?
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
};

export type RegisterPaymentInput = {
  businessId: string;
  employeeId?: string | null;
  clientName: string;
  items: RegisterPaymentItem[];
  method: PayMethod;
  sessionId?: string | null;
  chargedBy?: string | null;
  paymentType?: "service" | "sena" | "devolucion";
  appointmentId?: string | null;
};

export async function registerPayment(input: RegisterPaymentInput) {
  if (!input.businessId) throw new Error("Falta business_id");
  if (!input.items.length) throw new Error("Carrito vacío");

  const inserted: unknown[] = [];

  for (const item of input.items) {
    const payload: Record<string, unknown> = {
      business_id: input.businessId,
      employee_id: input.employeeId ?? null,
      client_name: input.clientName || "Cliente del mostrador",
      service_name: item.serviceName,
      amount: item.amount,
      total: item.amount,
      method: input.method,
      payment_method: input.method,
      created_at: new Date().toISOString(),
    };
    if (input.sessionId) payload.session_id = input.sessionId;
    if (input.chargedBy) payload.charged_by = input.chargedBy;
    if (input.paymentType) payload.payment_type = input.paymentType;
    if (input.appointmentId) payload.appointment_id = input.appointmentId;

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
    inserted.push(data[0]);
  }

  return inserted;
}
