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


function localDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function getRejectedCloseSummary(businessId: string): Promise<{
  count: number;
  lostRevenue: number;
}> {
  try {
    const today = localDateISO(new Date());
    const { data: rejected, error } = await supabase
      .from("rejected_clients")
      .select("service_id,service_name")
      .eq("business_id", businessId)
      .eq("rejected_date", today);
    if (error) throw error;

    const rows = (rejected ?? []) as Array<{ service_id: string | null; service_name: string | null }>;
    if (rows.length === 0) return { count: 0, lostRevenue: 0 };

    let priceById = new Map<string, number>();
    let priceByName = new Map<string, number>();
    try {
      const { data: prices } = await supabase
        .from("price_catalog")
        .select("id,name,price")
        .eq("business_id", businessId);
      (prices ?? []).forEach((r: { id: string; name?: string | null; price?: number | null }) => {
        if (r.id) priceById.set(r.id, Number(r.price ?? 0));
        if (r.name) priceByName.set(r.name.toLowerCase().trim(), Number(r.price ?? 0));
      });
    } catch { /* price catalog optional */ }

    const lostRevenue = rows.reduce((sum, r) => {
      const byId = r.service_id ? priceById.get(r.service_id) : undefined;
      const byName = r.service_name ? priceByName.get(r.service_name.toLowerCase().trim()) : undefined;
      return sum + Number(byId ?? byName ?? 0);
    }, 0);

    return { count: rows.length, lostRevenue };
  } catch {
    return { count: 0, lostRevenue: 0 };
  }
}

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

  // 3. Log event (best effort) + snapshot de clientes rechazados del día.
  const rejectedSummary = await getRejectedCloseSummary(params.businessId);
  const rejectedLine = `Clientes rechazados: ${rejectedSummary.count} · Facturación potencial perdida: $${Math.round(rejectedSummary.lostRevenue).toLocaleString("es-AR")}`;
  const observation = [params.observation, rejectedLine].filter(Boolean).join("\n");

  await logSessionEvent({
    businessId: params.businessId,
    sessionId: params.sessionId,
    actionType,
    userId: params.closedBy,
    observation,
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
