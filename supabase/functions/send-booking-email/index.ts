// ───────────────────────────────────────────────────────────────────────────
// Edge Function: send-booking-email
//
// Envía correos transaccionales de Clippr vía Resend, heredando el BRANDING
// del negocio (modo claro/oscuro + colores + logo + nombre) configurado en su
// página pública. Enrutada por `type` (confirmation | reminder | reschedule |
// cancellation) para soportar todos los correos con una sola función.
//
// Env requeridas (Supabase → Edge Functions → Secrets):
//   - RESEND_API_KEY
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (inyectadas por Supabase)
// ───────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildBookingEmail,
  clipprSender,
  CLIPPR_FROM_EMAIL,
  type BookingEmailData,
  type BrandTheme,
} from "../_shared/email-templates.ts";

const APP_ORIGIN = "https://myclippr.com";

type Payload = {
  type?: string;
  businessId?: string;
  to?: string;
  token?: string;
  booking?: {
    services?: string;
    professional?: string;
    clientName?: string;
    clientPhone?: string | null;
    date?: string;
    time?: string;
    total?: number;
    startIso?: string | null;
    durationMin?: number | null;
    notes?: string | null;
  };
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const hex = (s: unknown, fb: string) =>
  typeof s === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : fb;

/** Construye el link a la página de gestión del turno con el branding embebido. */
function buildManageUrl(
  brand: BrandTheme,
  businessId: string,
  token: string | null,
  biz: { slug?: string | null; address?: string | null; phone?: string | null },
  booking: Payload["booking"],
): string {
  const q = new URLSearchParams();
  q.set("b", brand.name);
  q.set("bid", businessId);
  if (token) q.set("tk", token);
  if (biz.slug) q.set("slug", biz.slug);
  q.set("svc", booking?.services ?? "");
  q.set("prof", booking?.professional ?? "");
  q.set("d", booking?.date ?? "");
  q.set("t", booking?.time ?? "");
  if (booking?.startIso) q.set("s", booking.startIso);
  if (booking?.durationMin) q.set("dur", String(booking.durationMin));
  if (typeof booking?.total === "number") q.set("tot", String(booking.total));
  if (biz.address) q.set("addr", biz.address);
  if (biz.phone) q.set("ph", biz.phone);
  if (booking?.notes) q.set("n", booking.notes);
  // branding
  q.set("pc", brand.primary);
  q.set("ac", brand.accent);
  q.set("bt", brand.buttonText);
  q.set("m", brand.mode);
  if (brand.logoUrl) q.set("logo", brand.logoUrl);
  return `${APP_ORIGIN}/gestion?${q.toString()}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const payload = (await req.json()) as Payload;
    const type = payload.type ?? "confirmation";
    const businessId = payload.businessId;
    let to = payload.to?.trim();
    const booking = payload.booking ?? {};

    if (!businessId) return json({ error: "businessId requerido" }, 400);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ error: "RESEND_API_KEY no configurada" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Si no llegó el email pero sí un token de gestión, lo resolvemos del turno.
    if (!to && payload.token) {
      const { data: appt } = await supabase
        .from("appointments")
        .select("client_email")
        .eq("manage_token", payload.token)
        .maybeSingle();
      to = (appt?.client_email as string)?.trim() || undefined;
    }

    if (!to) return json({ ok: true, skipped: "sin email del cliente" });

    // Datos del negocio (nombre, dirección, logo, color de acento).
    const { data: biz } = await supabase
      .from("businesses")
      .select("name, slug, email, address, phone, logo_url, avatar_url, accent_color")
      .eq("id", businessId)
      .maybeSingle();

    // Branding configurado en la página pública.
    const { data: settings } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    const branding = ((settings?.schedule as Record<string, any> | null)?._branding ?? {}) as Record<string, any>;
    const colors = (branding.colors ?? {}) as Record<string, string>;

    // Misma derivación que la página pública de reservas.
    const accentColor = (biz?.accent_color as string) ?? null;
    const primary = hex(colors.primary, hex(colors.secondary, hex(accentColor, "#7c3aed")));
    const brand: BrandTheme = {
      mode: branding.theme === "light" ? "light" : "dark",
      primary,
      secondary: hex(colors.secondary, primary),
      accent: hex(colors.accent, hex(accentColor, "#d6b66a")),
      buttonText: hex(colors.buttonText, "#ffffff"),
      name: (biz?.name as string) || "Clippr",
      logoUrl: (biz?.avatar_url as string) || (biz?.logo_url as string) || null,
    };

    // Token de gestión del turno recién creado (para self-service en /gestion).
    // Lectura con service role sobre la tabla real; si no se encuentra, el link
    // igual funciona en modo solo-lectura (sin acciones).
    let manageToken: string | null = null;
    if (booking.startIso && booking.clientPhone) {
      const { data: appt } = await supabase
        .from("appointments")
        .select("manage_token")
        .eq("business_id", businessId)
        .eq("starts_at", booking.startIso)
        .eq("client_phone", booking.clientPhone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      manageToken = (appt?.manage_token as string) ?? null;
    }

    const manageUrl = buildManageUrl(
      brand,
      businessId,
      manageToken,
      { slug: biz?.slug as string, address: biz?.address as string, phone: biz?.phone as string },
      booking,
    );

    const data: BookingEmailData = {
      brand,
      services: booking.services || "-",
      professional: booking.professional || "Sin preferencia",
      clientName: booking.clientName || "-",
      clientPhone: booking.clientPhone ?? null,
      date: booking.date || "-",
      time: booking.time || "-",
      total: Number(booking.total ?? 0),
      manageUrl,
      calendarUrl: `${manageUrl}#calendario`,
    };

    const email = buildBookingEmail(type, data);
    if (!email) return json({ error: `Tipo de correo desconocido: ${type}` }, 400);

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: clipprSender(brand.name),
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
