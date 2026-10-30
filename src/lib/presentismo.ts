import { supabase } from "@/integrations/supabase/client";
import { puntualidadMessage } from "@/lib/puntualidad-text";

// Presentismo — confirmación administrativa de asistencia por profesional
// programado/jornada, con descuento de tardanza recalculado server-side
// (ver migración 20261029030000_presentismo_schema.sql: get_scheduled_
// professionals_for_date, preview_attendance, confirm_attendance,
// is_caja_closed_now, get_pending_cierres_in_period). Ninguna de estas
// funciones existía antes — este archivo es el único punto del cliente
// que las llama; nunca se recalcula nada de esto a mano en un componente.

export type AttendanceStatus = "a_tiempo" | "tarde" | "ausente";

export type AttendanceAction =
  | "confirm_on_time"
  | "confirm_late"
  | "mark_absent"
  | "correct_time"
  | "override_penalty"
  | "revert_absent";

export type ScheduledProfessional = {
  employeeId: string;
  expectedStartAt: string | null;
};

export type AttendancePreview = {
  workSessionId: string | null;
  expectedStartAt: string | null;
  effectiveClockInAt: string | null;
  lateMinutes: number;
  status: AttendanceStatus | null; // null = sin fichar todavía, ni confirmado ausente
  ruleId: string | null;
  commissionServicesAvailable: number;
  discountAmountRequested: number;
};

export type AttendanceConfirmation = {
  id: string;
  businessId: string;
  branchId: string;
  employeeId: string;
  date: string;
  workSessionId: string | null;
  expectedStartAt: string | null;
  effectiveClockInAt: string | null;
  lateMinutes: number;
  status: AttendanceStatus;
  ruleId: string | null;
  commissionServicesAvailable: number;
  discountAmountRequested: number;
  discountAmountApplied: number;
  penaltyOverridden: boolean;
  confirmedBy: string;
  confirmedByName: string;
  confirmedAt: string;
};

export async function getScheduledProfessionalsForDate(
  businessId: string,
  branchId: string,
  date: string,
): Promise<ScheduledProfessional[]> {
  const { data, error } = await supabase.rpc("get_scheduled_professionals_for_date" as any, {
    p_business_id: businessId,
    p_branch_id: branchId,
    p_date: date,
  });
  if (error) throw new Error(puntualidadMessage(error.message));
  return ((data ?? []) as any[]).map((r) => ({
    employeeId: r.employee_id as string,
    expectedStartAt: (r.expected_start_at as string | null) ?? null,
  }));
}

export async function previewAttendance(
  businessId: string,
  employeeId: string,
  branchId: string,
  date: string,
): Promise<AttendancePreview | null> {
  const { data, error } = await supabase.rpc("preview_attendance" as any, {
    p_business_id: businessId,
    p_employee_id: employeeId,
    p_branch_id: branchId,
    p_date: date,
  });
  if (error) throw new Error(puntualidadMessage(error.message));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    workSessionId: row.work_session_id ?? null,
    expectedStartAt: row.expected_start_at ?? null,
    effectiveClockInAt: row.effective_clock_in_at ?? null,
    lateMinutes: Number(row.late_minutes ?? 0),
    status: (row.status as AttendanceStatus | null) ?? null,
    ruleId: row.rule_id ?? null,
    commissionServicesAvailable: Number(row.commission_services_available ?? 0),
    discountAmountRequested: Number(row.discount_amount_requested ?? 0),
  };
}

// Igual que previewAttendance pero con una hora de llegada corregida: el
// servidor calcula estado, minutos, regla y penalización con ESA hora, así
// la pantalla muestra el resultado real antes de guardar, sin repetir la
// cuenta. Devuelve null si la función todavía no existe en la base (la
// pantalla entonces muestra solo estado y minutos, sin importe).
export async function previewAttendanceAt(
  businessId: string,
  employeeId: string,
  branchId: string,
  date: string,
  correctedClockInAt: string,
): Promise<AttendancePreview | null> {
  const { data, error } = await supabase.rpc("preview_attendance_at" as any, {
    p_business_id: businessId,
    p_employee_id: employeeId,
    p_branch_id: branchId,
    p_date: date,
    p_corrected_clock_in_at: correctedClockInAt,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    workSessionId: row.work_session_id ?? null,
    expectedStartAt: row.expected_start_at ?? null,
    effectiveClockInAt: row.effective_clock_in_at ?? null,
    lateMinutes: Number(row.late_minutes ?? 0),
    status: (row.status as AttendanceStatus | null) ?? null,
    ruleId: row.rule_id ?? null,
    commissionServicesAvailable: Number(row.commission_services_available ?? 0),
    discountAmountRequested: Number(row.discount_amount_requested ?? 0),
  };
}

// Penalización de cada venta de una jornada con la regla indicada, tal como la
// calcula el servidor (tasa propia de cada servicio; el catálogo y los
// servicios de importe fijo dan 0). Mapa id de comisión -> importe. null si la
// función todavía no existe: el reparto por servicio usa entonces un respaldo.
export async function getPenaltyBreakdown(
  employeeId: string,
  date: string,
  ruleId: string,
): Promise<Map<string, number> | null> {
  const { data, error } = await supabase.rpc("attendance_penalty_breakdown" as any, {
    p_employee_id: employeeId,
    p_date: date,
    p_rule_id: ruleId,
  });
  if (error) return null;
  return new Map(((data ?? []) as any[]).map((r) => [String(r.commission_record_id), Number(r.penalty ?? 0)]));
}

export async function getAttendanceConfirmationsForDate(
  businessId: string,
  branchId: string,
  date: string,
): Promise<AttendanceConfirmation[]> {
  const { data, error } = await supabase
    .from("attendance_confirmations" as any)
    .select("*")
    .eq("business_id", businessId)
    .eq("branch_id", branchId)
    .eq("date", date);
  if (error) throw new Error(puntualidadMessage(error.message));
  return ((data ?? []) as any[]).map(mapConfirmationRow);
}

function mapConfirmationRow(r: any): AttendanceConfirmation {
  return {
    id: r.id,
    businessId: r.business_id,
    branchId: r.branch_id,
    employeeId: r.employee_id,
    date: r.date,
    workSessionId: r.work_session_id ?? null,
    expectedStartAt: r.expected_start_at ?? null,
    effectiveClockInAt: r.effective_clock_in_at ?? null,
    lateMinutes: Number(r.late_minutes ?? 0),
    status: r.status as AttendanceStatus,
    ruleId: r.rule_id ?? null,
    commissionServicesAvailable: Number(r.commission_services_available ?? 0),
    discountAmountRequested: Number(r.discount_amount_requested ?? 0),
    discountAmountApplied: Number(r.discount_amount_applied ?? 0),
    penaltyOverridden: Boolean(r.penalty_overridden),
    confirmedBy: r.confirmed_by,
    confirmedByName: r.confirmed_by_name,
    confirmedAt: r.confirmed_at,
  };
}

export async function confirmAttendance(params: {
  businessId: string;
  employeeId: string;
  branchId: string;
  date: string;
  action: AttendanceAction;
  correctedClockInAt?: string | null;
  overrideDiscountAmount?: number | null;
  reason: string;
  confirmedBy: string;
  confirmedByName: string;
}): Promise<AttendanceConfirmation> {
  const { data, error } = await supabase.rpc("confirm_attendance" as any, {
    p_business_id: params.businessId,
    p_employee_id: params.employeeId,
    p_branch_id: params.branchId,
    p_date: params.date,
    p_action: params.action,
    p_corrected_clock_in_at: params.correctedClockInAt ?? null,
    p_override_discount_amount: params.overrideDiscountAmount ?? null,
    p_reason: params.reason,
    p_confirmed_by: params.confirmedBy,
    p_confirmed_by_name: params.confirmedByName,
  });
  if (error) throw new Error(puntualidadMessage(error.message));
  const row = Array.isArray(data) ? data[0] : data;
  return mapConfirmationRow(row);
}

export async function getPendingCierresInPeriod(
  businessId: string,
  branchId: string | null,
  from: string,
  to: string,
): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_pending_cierres_in_period" as any, {
    p_business_id: businessId,
    p_branch_id: branchId,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(puntualidadMessage(error.message));
  return ((data ?? []) as any[]).map((r) => r.fecha as string);
}

export type AttendanceAdjustment = {
  id: string;
  businessId: string;
  branchId: string;
  employeeId: string;
  date: string;
  action: AttendanceAction;
  reason: string;
  previousClockInAt: string | null;
  newClockInAt: string | null;
  previousLateMinutes: number | null;
  newLateMinutes: number | null;
  previousDiscountAmount: number | null;
  newDiscountAmount: number | null;
  previousStatus: AttendanceStatus | null;
  newStatus: AttendanceStatus | null;
  ruleId: string | null;
  performedBy: string;
  performedByName: string;
  createdAt: string;
};

// Historial de ajustes manuales de presentismo — SOLO lectura: esta tabla
// es append-only a nivel base (RLS sin políticas de insert/update/delete
// para el cliente, ver 20261029030000_presentismo_schema.sql), así que
// nunca hay un helper de edición/borrado acá a propósito.
export async function getAttendanceAdjustments(
  businessId: string,
  branchId: string | null,
  limit = 200,
): Promise<AttendanceAdjustment[]> {
  let query = supabase
    .from("attendance_adjustments" as any)
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (branchId) query = query.eq("branch_id", branchId);
  const { data, error } = await query;
  if (error) throw new Error(puntualidadMessage(error.message));
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    businessId: r.business_id,
    branchId: r.branch_id,
    employeeId: r.employee_id,
    date: r.date,
    action: r.action as AttendanceAction,
    reason: r.reason,
    previousClockInAt: r.previous_clock_in_at ?? null,
    newClockInAt: r.new_clock_in_at ?? null,
    previousLateMinutes: r.previous_late_minutes ?? null,
    newLateMinutes: r.new_late_minutes ?? null,
    previousDiscountAmount: r.previous_discount_amount != null ? Number(r.previous_discount_amount) : null,
    newDiscountAmount: r.new_discount_amount != null ? Number(r.new_discount_amount) : null,
    previousStatus: (r.previous_status as AttendanceStatus | null) ?? null,
    newStatus: (r.new_status as AttendanceStatus | null) ?? null,
    ruleId: r.rule_id ?? null,
    performedBy: r.performed_by,
    performedByName: r.performed_by_name,
    createdAt: r.created_at,
  }));
}

export async function isCajaClosedNow(
  businessId: string,
  branchId: string | null,
  fecha: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_caja_closed_now" as any, {
    p_business_id: businessId,
    p_branch_id: branchId,
    p_fecha: fecha,
  });
  if (error) throw new Error(puntualidadMessage(error.message));
  return Boolean(data);
}
