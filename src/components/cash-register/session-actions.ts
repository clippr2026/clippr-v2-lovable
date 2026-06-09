import { supabase } from "@/integrations/supabase/client";

export type SessionActionType =
  | "apertura"
  | "cierre_manual"
  | "cierre_automatico"
  | "reapertura"
  | "cierre_tras_reapertura";

export async function openCashSession(params: {
  businessId: string;
  openedBy: string;
}) {
  const { data, error } = await supabase
    .from("cash_sessions")
    .insert({ business_id: params.businessId, opened_by: params.openedBy })
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Log in history
  await logSessionEvent({
    businessId: params.businessId,
    sessionId: data.id,
    actionType: "apertura",
    userId: params.openedBy,
  });

  return data;
}

export async function closeCashSession(params: {
  sessionId: string;
  closedBy: string;
  total?: number;
  actionType?: SessionActionType;
  observation?: string;
}) {
  const payload: Record<string, unknown> = {
    status: "closed",
    closed_by: params.closedBy,
    closed_at: new Date().toISOString(),
  };
  if (params.total != null) payload.total = params.total;
  if (params.actionType) payload.close_type = params.actionType;

  const { data, error } = await supabase
    .from("cash_sessions")
    .update(payload)
    .eq("id", params.sessionId)
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Log in history
  await logSessionEvent({
    businessId: data.business_id,
    sessionId: data.id,
    actionType: params.actionType ?? "cierre_manual",
    userId: params.closedBy,
    observation: params.observation,
  });

  return data;
}

export async function reopenCashSession(params: {
  sessionId: string;
  reopenedBy: string;
}) {
  const { data, error } = await supabase
    .from("cash_sessions")
    .update({ status: "open", closed_by: null, closed_at: null, close_type: null })
    .eq("id", params.sessionId)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await logSessionEvent({
    businessId: data.business_id,
    sessionId: data.id,
    actionType: "reapertura",
    userId: params.reopenedBy,
  });

  return data;
}

async function logSessionEvent(params: {
  businessId: string;
  sessionId: string;
  actionType: SessionActionType;
  userId: string;
  observation?: string;
}) {
  try {
    await supabase.from("cash_session_events").insert({
      business_id: params.businessId,
      session_id: params.sessionId,
      action_type: params.actionType,
      user_id: params.userId,
      observation: params.observation ?? null,
      occurred_at: new Date().toISOString(),
    });
  } catch {
    // Table may not exist yet – fail silently, don't break the main flow
  }
}
