// ───────────────────────────────────────────────────────────────────────────
// Edge Function: send-booking-email
//
// Envía correos transaccionales de Clippr vía Resend. Enrutada por `type`
// (confirmation | reminder | reschedule | cancellation) para soportar todos
// los correos actuales y futuros con una sola función.
//
// Remitente: `Nombre del negocio <hola@myclippr.com>` — el nombre se toma
// SIEMPRE desde la base (businesses.name), nunca del input del cliente, para
// evitar spoofing del remitente.
//
// Variables de entorno requeridas (Supabase → Edge Functions → Secrets):
//   - RESEND_API_KEY            (secreto de Resend)
//   - SUPABASE_URL              (inyectada automáticamente)
//   - SUPABASE_SERVICE_ROLE_KEY (inyectada automáticamente)
// ───────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildBookingEmail,
  clipprSender,
  CLIPPR_FROM_EMAIL,
  type BookingEmailData,
} from "../_shared/email-templates.ts";

type Payload = {
  type?: string;
  businessId?: string;
  to?: string;
  booking?: {
    services?: string;
    professional?: string;
    clientName?: string;
    clientPhone?: string | null;
    date?: string;
    time?: string;
    total?: number;
  };
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const payload = (await req.json()) as Payload;
    const type = payload.type ?? "confirmation";
    const businessId = payload.businessId;
    const to = payload.to?.trim();
    const booking = payload.booking ?? {};

    if (!businessId) return json({ error: "businessId requerido" }, 400);
    if (!to) return json({ ok: true, skipped: "sin email del cliente" }); // no es error: turno válido sin email

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ error: "RESEND_API_KEY no configurada" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Nombre/slug/email autoritativos del negocio (Branding > Nombre del negocio).
    const { data: biz } = await supabase
      .from("businesses")
      .select("name, slug, email")
      .eq("id", businessId)
      .maybeSingle();

    // Color de marca opcional (business_settings.schedule._branding.colors.primary).
    let accent: string | null = null;
    const { data: settings } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    const colors = (settings?.schedule as Record<string, any> | null)?._branding?.colors;
    if (colors && typeof colors.primary === "string") accent = colors.primary;

    const data: BookingEmailData = {
      businessName: (biz?.name as string) || "Clippr",
      businessSlug: (biz?.slug as string) ?? null,
      accent,
      services: booking.services || "-",
      professional: booking.professional || "Sin preferencia",
      clientName: booking.clientName || "-",
      clientPhone: booking.clientPhone ?? null,
      date: booking.date || "-",
      time: booking.time || "-",
      total: Number(booking.total ?? 0),
    };

    const email = buildBookingEmail(type, data);
    if (!email) return json({ error: `Tipo de correo desconocido: ${type}` }, 400);

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: clipprSender(data.businessName),
        to: [to],
        reply_to: biz?.email ? [biz.email as string] : [CLIPPR_FROM_EMAIL],
        subject: email.subject,
        html: email.html,
      }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      console.error("Resend error", resendRes.status, detail);
      return json({ error: "No se pudo enviar el correo", detail }, 502);
    }

    const result = await resendRes.json();
    return json({ ok: true, id: result?.id ?? null });
  } catch (err) {
    console.error("send-booking-email error", err);
    return json({ error: (err as Error).message ?? "Error interno" }, 500);
  }
});
