import { supabase } from "@/integrations/supabase/client";

/**
 * Portado de Cash.openSession / Cash.closeSession (app.js ~7327).
 * cash_sessions: business_id, opened_by, opened_at(default), status='open',
 * closed_by, closed_at, total
 */

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
  return data;
}

export async function closeCashSession(params: {
  sessionId: string;
  closedBy: string;
  total?: number;
}) {
  const payload: Record<string, unknown> = {
    status: "closed",
    closed_by: params.closedBy,
    closed_at: new Date().toISOString(),
  };
  if (params.total != null) payload.total = params.total;

  const { data, error } = await supabase
    .from("cash_sessions")
    .update(payload)
    .eq("id", params.sessionId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}
