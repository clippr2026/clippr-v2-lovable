import { supabase } from "@/integrations/supabase/client";

export type SessionActionType =
  | "apertura"
  | "cierre_manual"
  | "cierre_automatico"
  | "reapertura"
  | "cierre_tras_reapertura";

// ─── Fallback state stored in business_settings.schedule._cajaSession ──────
// Used when cash_sessions table doesn't exist or errors out.
const CAJA_KEY = "_cajaSession";

type CajaSessionState = {
  status: "open" | "closed";
  sessionId: string | null;
  openedAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
  closeType: SessionActionType | null;
  businessId: string;
};

async function readCajaState(businessId: string): Promise<CajaSessionState | null> {
  const { data } = await supabase
    .from("business_settings")
    .select("schedule")
    .eq("business_id", businessId)
    .maybeSingle();
  const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
  return (schedule[CAJA_KEY] as CajaSessionState) ?? null;
}

async function writeCajaState(businessId: string, state: CajaSessionState): Promise<void> {
  // Read current schedule first to not overwrite other keys
  const { data: existing } = await supabase
    .from("business_settings")
    .select("schedule")
    .eq("business_id", businessId)
    .maybeSingle();
  const schedule = { ...((existing?.schedule ?? {}) as Record<string, unknown>), [CAJA_KEY]: state };
  await supabase
    .from("business_settings")
    .upsert({ business_id: businessId, schedule }, { onConflict: "business_id" });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function openCashSession(params: {
  businessId: string;
  openedBy: string;
}): Promise<{ id: string | null }> {
  const now = new Date().toISOString();

  // Try cash_sessions table first
  try {
    const { data, error } = await supabase
      .from("cash_sessions")
      .insert({ business_id: params.businessId, opened_by: params.openedBy, status: "open" })
      .select()
      .single();
    if (!error && data) {
      await writeCajaState(params.businessId, {
        status: "open",
        sessionId: data.id,
        openedAt: now,
        closedAt: null,
        closedBy: null,
        closeType: null,
        businessId: params.businessId,
      });
      await logSessionEvent({ businessId: params.businessId, sessionId: data.id, actionType: "apertura", userId: params.openedBy });
      return data;
    }
  } catch { /* table doesn't exist, fall through */ }

  // Fallback: state in business_settings only
  const fakeId = `local_${Date.now()}`;
  await writeCajaState(params.businessId, {
    status: "open",
    sessionId: fakeId,
    openedAt: now,
    closedAt: null,
    closedBy: null,
    closeType: null,
    businessId: params.businessId,
  });
  return { id: fakeId };
}

export async function closeCashSession(params: {
  sessionId: string;
  businessId: string;
  closedBy: string;
  total?: number;
  actionType?: SessionActionType;
  observation?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const actionType = params.actionType ?? "cierre_manual";

  // 1. Always update business_settings._cajaSession — this is the source of truth
  await writeCajaState(params.businessId, {
    status: "closed",
    sessionId: params.sessionId,
    openedAt: null,
    closedAt: now,
    closedBy: params.closedBy,
    closeType: actionType,
    businessId: params.businessId,
  });

  // 2. Try cash_sessions table (best effort — don't fail if table doesn't exist)
  if (!params.sessionId.startsWith("local_")) {
    try {
      const payload: Record<string, unknown> = {
        status: "closed",
        closed_by: params.closedBy,
        closed_at: now,
        close_type: actionType,
      };
      if (params.total != null) payload.total = params.total;
      await supabase.from("cash_sessions").update(payload).eq("id", params.sessionId);
    } catch { /* ignore */ }
  }

  // 3. Log event (best effort)
  await logSessionEvent({
    businessId: params.businessId,
    sessionId: params.sessionId,
    actionType,
    userId: params.closedBy,
    observation: params.observation,
  });
}

export async function reopenCashSession(params: {
  sessionId: string;
  businessId: string;
  reopenedBy: string;
}): Promise<void> {
  // 1. Always update business_settings
  await writeCajaState(params.businessId, {
    status: "open",
    sessionId: params.sessionId,
    openedAt: new Date().toISOString(),
    closedAt: null,
    closedBy: null,
    closeType: null,
    businessId: params.businessId,
  });

  // 2. Try cash_sessions table
  if (!params.sessionId.startsWith("local_")) {
    try {
      await supabase
        .from("cash_sessions")
        .update({ status: "open", closed_by: null, closed_at: null, close_type: null })
        .eq("id", params.sessionId);
    } catch { /* ignore */ }
  }

  await logSessionEvent({
    businessId: params.businessId,
    sessionId: params.sessionId,
    actionType: "reapertura",
    userId: params.reopenedBy,
  });
}

export async function loadCajaSession(businessId: string): Promise<{
  status: "open" | "closed" | "no_session";
  sessionId: string | null;
  closedAt: string | null;
}> {
  // Primary: try cash_sessions table (most recent session today)
  try {
    const { data, error } = await supabase
      .from("cash_sessions")
      .select("id,status,closed_at,opened_at")
      .eq("business_id", businessId)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      return {
        status: data.status as "open" | "closed",
        sessionId: data.id,
        closedAt: (data as Record<string, unknown>).closed_at as string | null ?? null,
      };
    }
  } catch { /* table doesn't exist */ }

  // Fallback: business_settings._cajaSession
  const state = await readCajaState(businessId);
  if (!state) return { status: "no_session", sessionId: null, closedAt: null };
  return {
    status: state.status,
    sessionId: state.sessionId,
    closedAt: state.closedAt,
  };
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
  } catch { /* table may not exist */ }
}
