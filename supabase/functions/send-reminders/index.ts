// ───────────────────────────────────────────────────────────────────────────
// Edge Function: send-reminders
//
// La invoca un programador cada ~10 minutos. Pide a la base los turnos que
// toca avisar (1 día antes / 2 horas antes, ver due_booking_reminders), reclama
// cada aviso para que nunca salga dos veces y manda el correo con
// send-booking-email. Si el envío falla, libera el aviso para reintentar en la
// próxima corrida.
// ───────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(url, key);

  const { data: due, error } = await supabase.rpc("due_booking_reminders");
  if (error) {
    console.error("due_booking_reminders", error);
    return json({ error: error.message }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of (due ?? []) as Array<Record<string, any>>) {
    const { data: claimed } = await supabase.rpc("claim_booking_notification", {
      p_appointment_id: r.appointment_id,
      p_kind: r.kind,
      p_starts_at: r.starts_at,
    });
    if (!claimed) {
      skipped++;
      continue;
    }
    try {
      const res = await fetch(`${url}/functions/v1/send-booking-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: r.kind,
          businessId: r.business_id,
          booking: { appointmentId: r.appointment_id },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.skipped) throw new Error(body?.error ?? body?.skipped ?? `HTTP ${res.status}`);
      sent++;
    } catch (e) {
      failed++;
      console.error("recordatorio", r.appointment_id, r.kind, (e as Error).message);
      await supabase
        .from("booking_notifications")
        .delete()
        .eq("appointment_id", r.appointment_id)
        .eq("kind", r.kind)
        .eq("starts_at", r.starts_at);
    }
  }

  return json({ ok: true, due: due?.length ?? 0, sent, skipped, failed });
});
