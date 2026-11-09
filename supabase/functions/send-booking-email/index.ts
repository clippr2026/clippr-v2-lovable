// ───────────────────────────────────────────────────────────────────────────
// Edge Function: send-booking-email
//
// Envía correos transaccionales de Clippr vía Resend, heredando el BRANDING
// del negocio (modo claro/oscuro + colores + logo + nombre) configurado en su
// página pública. Enrutada por `type` (confirmation | reminder_1d | reminder_2h |
// reschedule | cancellation) para soportar todos los correos con una sola función.
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
const APPT_COLUMNS =
  "id, business_id, manage_token, employee_id, client_id, status, starts_at, duration_min, service_name, service_price, client_name, created_at";

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
    clientEmail?: string | null;
    appointmentId?: string | null;
    manageToken?: string | null;
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

function icsStamp(dt: Date): string {
  return dt.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/** Link directo a Google Calendar para que el botón del email NO abra /gestion. */
function buildDirectCalendarUrl(
  brand: BrandTheme,
  biz: { address?: string | null },
  booking: Payload["booking"],
): string | null {
  if (!booking?.startIso) return null;
  const start = new Date(booking.startIso);
  if (Number.isNaN(start.getTime())) return null;
  const duration = Number(booking.durationMin ?? 60);
  const end = new Date(start.getTime() + (Number.isFinite(duration) ? duration : 60) * 60_000);
  const title = `${booking.services || "Turno"} · ${brand.name}`;
  const details = [
    booking.professional ? `Profesional: ${booking.professional}` : null,
    `Negocio: ${brand.name}`,
    booking.notes ? `Notas: ${booking.notes}` : null,
    "Reservado con Clippr",
  ].filter(Boolean).join("\n");

  const q = new URLSearchParams();
  q.set("action", "TEMPLATE");
  q.set("text", title);
  q.set("dates", `${icsStamp(start)}/${icsStamp(end)}`);
  q.set("details", details);
  if (biz.address) q.set("location", biz.address);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

function buildManageUrl(
  brand: BrandTheme,
  businessId: string,
  token: string | null,
  employeeId: string | null,
  biz: { slug?: string | null; address?: string | null; phone?: string | null },
  booking: Payload["booking"],
  mode: "calendar" | "manage" = "manage",
): string {
  const q = new URLSearchParams();
  q.set("mode", mode);
  q.set("b", brand.name);
  q.set("bid", businessId);
  if (token) q.set("tk", token);
  if (employeeId) q.set("emp", employeeId);
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
    const booking: NonNullable<Payload["booking"]> = payload.booking ?? {};

    if (!businessId) return json({ error: "businessId requerido" }, 400);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ error: "RESEND_API_KEY no configurada" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // El turno real (por id o por token de gestión) es la fuente de verdad:
    // el correo solo sale hacia el cliente de ESE turno. Un `to` distinto al
    // guardado se acepta únicamente en los primeros minutos del turno (el
    // cliente puede haber escrito un correo nuevo al reservar); así la función
    // no sirve para mandar correos a direcciones arbitrarias.
    const lookupToken = payload.token ?? booking.manageToken ?? null;
    let appt: Record<string, any> | null = null;
    let lookupError: string | null = null;
    if (booking.appointmentId) {
      const { data, error } = await supabase.from("appointments").select(APPT_COLUMNS).eq("id", booking.appointmentId).maybeSingle();
      appt = data;
      lookupError = error?.message ?? null;
    } else if (lookupToken) {
      const { data, error } = await supabase.from("appointments").select(APPT_COLUMNS).eq("manage_token", lookupToken).maybeSingle();
      appt = data;
      lookupError = error?.message ?? null;
    }
    if (lookupError) console.error("send-booking-email: no se pudo leer el turno", lookupError);
    if (!appt || appt.business_id !== businessId) {
      return json({ ok: true, skipped: "turno no encontrado", detail: lookupError });
    }

    let clientRow: Record<string, any> | null = null;
    if (appt.client_id) {
      const { data } = await supabase.from("clients").select("email, phone, full_name").eq("id", appt.client_id).maybeSingle();
      clientRow = data;
    }
    const storedEmail = ((clientRow?.email as string | null) ?? "").trim();
    const fresh = Date.now() - new Date(appt.created_at as string).getTime() < 15 * 60_000;
    if (!(to && fresh) && !(to && storedEmail && to.toLowerCase() === storedEmail.toLowerCase())) {
      to = storedEmail || undefined;
    }

    if (!to) return json({ ok: true, skipped: "sin email del cliente" });

    // Completa lo que no llegó en el pedido (recordatorios del programador).
    const tzRow = await supabase.from("businesses").select("timezone").eq("id", businessId).maybeSingle();
    const timeZone = ((tzRow.data?.timezone as string | null) ?? "") || "America/Argentina/Buenos_Aires";
    if (!booking.professional && appt.employee_id) {
      const { data: emp } = await supabase.from("employees").select("full_name").eq("id", appt.employee_id).maybeSingle();
      booking.professional = ((emp?.full_name as string | null) ?? "").trim() || undefined;
    }
    const apptStart = new Date(appt.starts_at as string);
    // El horario guardado manda: así un reprogramado o un pedido viejo nunca muestran otra hora.
    booking.startIso = apptStart.toISOString();
    booking.date = apptStart.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone });
    booking.time = apptStart.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone });
    booking.services = booking.services || (appt.service_name as string);
    booking.clientName = booking.clientName || (appt.client_name as string);
    booking.durationMin = booking.durationMin ?? (appt.duration_min as number);
    if (booking.total === undefined) booking.total = Number(appt.service_price) || 0;
    booking.clientPhone = booking.clientPhone ?? (clientRow?.phone as string | null) ?? null;

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
    // WhatsApp configurado en Configuración > Branding > WhatsApp.
    // Fallback: columna businesses.phone para instalaciones viejas.
    const businessWhatsApp =
      ((branding.phone as string | undefined)?.trim() || (biz?.phone as string | undefined)?.trim() || null);
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

    const manageToken: string | null = (appt.manage_token as string) ?? null;
    const employeeId: string | null = (appt.employee_id as string) ?? null;

    const baseUrlArgs = [
      brand,
      businessId,
      manageToken,
      employeeId,
      { slug: biz?.slug as string, address: biz?.address as string, phone: businessWhatsApp },
      booking,
    ] as const;

    const calendarUrl = buildManageUrl(...baseUrlArgs, "calendar");
    // Página de gestión por token (ver, confirmar, reprogramar, cancelar).
    const manageUrl = manageToken
      ? `${APP_ORIGIN}/gestion?k=${manageToken}`
      : buildManageUrl(...baseUrlArgs, "manage");
    // "Confirmar asistencia" solo mientras el turno está por confirmar.
    const confirmUrl = manageToken && appt.status === "pending" && type !== "cancellation" && type !== "reminder_2h" && !type.startsWith("deposit_")
      ? `${APP_ORIGIN}/gestion?k=${manageToken}&a=confirmar`
      : null;

    // Con seña por pagar no se manda el "turno agendado": el cliente recibe luego el aviso de pago
    // (a los 10 min si no envió el comprobante), el de turno confirmado o el de cancelación.
    let deposit: BookingEmailData["deposit"] = null;
    if (manageToken && (type === "confirmation" || type === "deposit_reminder")) {
      if (type === "confirmation") await supabase.rpc("ensure_public_deposit_v1", { p_token: manageToken });
      const { data: dep } = await supabase
        .from("appointment_deposits")
        .select("status, amount, expires_at")
        .eq("appointment_id", appt.id)
        .maybeSingle();
      if (dep && (dep.status === "pending" || dep.status === "rejected" || dep.status === "review")) {
        if (type === "confirmation") return json({ ok: true, skipped: "seña pendiente: el aviso sale más tarde" });
        if (dep.expires_at) {
          const exp = new Date(dep.expires_at as string);
          const sameDay = exp.toLocaleDateString("es-AR", { timeZone }) === new Date().toLocaleDateString("es-AR", { timeZone });
          const hm = exp.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
          deposit = {
            amount: Number(dep.amount) || 0,
            deadline: sameDay
              ? `las ${hm} de hoy`
              : `las ${hm} del ${exp.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone })}`,
            payUrl: `${APP_ORIGIN}/gestion?k=${manageToken}&a=pagar`,
          };
        }
      }
    }

    const data: BookingEmailData = {
      deposit,
      brand,
      services: booking.services || "-",
      professional: booking.professional || "Sin preferencia",
      clientName: booking.clientName || "-",
      clientPhone: booking.clientPhone ?? null,
      date: booking.date || "-",
      time: booking.time || "-",
      total: Number(booking.total ?? 0),
      manageUrl,
      confirmUrl,
      calendarUrl,
      mapsUrl: (biz?.address as string)?.trim()
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((biz?.address as string).trim())}`
        : null,
      whatsappUrl: businessWhatsApp && businessWhatsApp.replace(/\D/g, "").length >= 8
        ? `https://wa.me/${businessWhatsApp.replace(/\D/g, "")}`
        : null,
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

    // Registro de lo enviado (los recordatorios lo reclaman el programador antes de mandar).
    if (type === "confirmation" || type === "reschedule" || type === "cancellation") {
      await supabase.rpc("claim_booking_notification", {
        p_appointment_id: appt.id,
        p_kind: type,
        p_starts_at: appt.starts_at,
      });
    }
    return json({ ok: true, id: result?.id ?? null });
  } catch (err) {
    console.error("send-booking-email error", err);
    return json({ error: (err as Error).message ?? "Error interno" }, 500);
  }
});
