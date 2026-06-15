// ───────────────────────────────────────────────────────────────────────────
// Plantillas de correo de Clippr (compartidas entre Edge Functions).
//
// Diseño de marca:
//   - El REMITENTE visible es el nombre del negocio (Branding > Nombre del
//     negocio = businesses.name). El correo de envío es siempre hola@myclippr.com.
//   - El layout es el mismo para todos los tipos de correo (confirmación,
//     recordatorio, reprogramación, cancelación); sólo cambian el encabezado,
//     el texto introductorio y el CTA. Así, agregar un nuevo tipo de correo
//     es trivial: se reutiliza baseLayout() con otros textos.
// ───────────────────────────────────────────────────────────────────────────

export const CLIPPR_FROM_EMAIL = "hola@myclippr.com";
const CLIPPR_PURPLE = "#7c3aed";
const CLIPPR_BLUE = "#3b82f6";

/**
 * Remitente con formato RFC 5322: `Nombre del negocio <hola@myclippr.com>`.
 * Es el ÚNICO lugar donde se arma el remitente — todos los correos lo usan.
 *   clipprSender("Auro Stylo") -> "Auro Stylo <hola@myclippr.com>"
 */
export function clipprSender(businessName?: string | null): string {
  const name = (businessName ?? "").trim() || "Clippr";
  // Sanitizamos comillas/saltos para no romper el header del remitente.
  const safe = name.replace(/["\r\n]/g, "").slice(0, 78);
  return `${safe} <${CLIPPR_FROM_EMAIL}>`;
}

export type BookingEmailData = {
  businessName: string;
  businessSlug?: string | null;
  /** Color primario del branding del negocio (opcional, default Clippr). */
  accent?: string | null;
  services: string;
  professional: string;
  clientName: string;
  clientPhone?: string | null;
  date: string; // ya formateada: "lunes, 15 de junio"
  time: string; // ya formateada: "11:00 a. m."
  total: number;
};

type Row = { label: string; value: string };

function formatARS(value: number): string {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Number(value ?? 0));
  } catch {
    return `$ ${value}`;
  }
}

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Layout base responsive (tablas + estilos inline para compatibilidad) ──────
function baseLayout(opts: {
  businessName: string;
  accent: string;
  preheader: string;
  eyebrow: string;
  eyebrowColor: string;
  eyebrowBg: string;
  title: string;
  intro: string;
  rows: Row[];
  total?: number;
  cta?: { label: string; url: string } | null;
  footerNote: string;
}): string {
  const {
    businessName,
    accent,
    preheader,
    eyebrow,
    eyebrowColor,
    eyebrowBg,
    title,
    intro,
    rows,
    total,
    cta,
    footerNote,
  } = opts;

  const rowsHtml = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #eef0f4;">
          <span style="display:block;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#9aa1ad;font-weight:600;">${esc(r.label)}</span>
          <span style="display:block;margin-top:3px;font-size:15px;color:#0f172a;font-weight:600;">${esc(r.value)}</span>
        </td>
      </tr>`,
    )
    .join("");

  const totalHtml =
    typeof total === "number"
      ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-radius:14px;background:linear-gradient(135deg, ${accent}1f, ${CLIPPR_BLUE}1f);">
        <tr>
          <td style="padding:16px 18px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size:14px;color:#475569;font-weight:500;">Total</td>
                <td align="right" style="font-size:24px;color:#0f172a;font-weight:800;letter-spacing:-.02em;">${formatARS(total)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`
      : "";

  const ctaHtml = cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px auto 0;">
        <tr>
          <td align="center" style="border-radius:12px;background:linear-gradient(135deg, ${accent}, ${CLIPPR_BLUE});">
            <a href="${esc(cta.url)}" target="_blank" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(cta.label)}</a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f3f7;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f3f7;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 10px 40px rgba(15,23,42,.08);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <!-- Header con nombre del negocio -->
          <tr>
            <td style="padding:30px 36px 0;">
              <span style="font-size:18px;font-weight:800;color:#0f172a;letter-spacing:-.01em;">${esc(businessName)}</span>
            </td>
          </tr>
          <!-- Eyebrow + título -->
          <tr>
            <td style="padding:22px 36px 0;">
              <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${eyebrowBg};color:${eyebrowColor};font-size:12px;font-weight:700;">${esc(eyebrow)}</span>
              <h1 style="margin:16px 0 0;font-size:28px;line-height:1.15;color:#0f172a;font-weight:800;letter-spacing:-.02em;">${esc(title)}</h1>
              <p style="margin:10px 0 0;font-size:15px;line-height:1.55;color:#64748b;">${esc(intro)}</p>
            </td>
          </tr>
          <!-- Detalle del turno -->
          <tr>
            <td style="padding:24px 36px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef0f4;border-radius:16px;">
                <tr><td style="padding:4px 18px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
                </td></tr>
              </table>
              ${totalHtml}
              ${ctaHtml}
            </td>
          </tr>
          <!-- Footer Clippr -->
          <tr>
            <td style="padding:30px 36px 32px;">
              <hr style="border:none;border-top:1px solid #eef0f4;margin:0 0 18px;" />
              <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">${esc(footerNote)}</p>
              <p style="margin:12px 0 0;font-size:12px;color:#cbd5e1;">
                Reservá fácil con <span style="font-weight:700;color:#7c3aed;">Clippr</span>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function detailRows(d: BookingEmailData): Row[] {
  const rows: Row[] = [
    { label: "Servicio", value: d.services },
    { label: "Profesional", value: d.professional },
    { label: "Fecha", value: d.date },
    { label: "Horario", value: d.time },
    { label: "Cliente", value: d.clientName },
  ];
  if (d.clientPhone) rows.push({ label: "Teléfono", value: d.clientPhone });
  return rows;
}

function profileCta(d: BookingEmailData) {
  return d.businessSlug
    ? { label: "Ver el perfil del negocio", url: `https://myclippr.com/negocio/${d.businessSlug}` }
    : null;
}

// ── Builders por tipo de correo ──────────────────────────────────────────────

/** Subject + HTML para cada tipo. Devuelve null si el tipo no existe. */
export function buildBookingEmail(
  type: string,
  d: BookingEmailData,
): { subject: string; html: string } | null {
  const accent = (d.accent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(d.accent)) ? d.accent : CLIPPR_PURPLE;
  const base = { businessName: d.businessName, accent, rows: detailRows(d), total: d.total, cta: profileCta(d) };

  switch (type) {
    case "confirmation":
      return {
        subject: `Turno confirmado en ${d.businessName} · ${d.date}`,
        html: baseLayout({
          ...base,
          preheader: `Tu turno en ${d.businessName} quedó confirmado para el ${d.date} a las ${d.time}.`,
          eyebrow: "✓ Reserva confirmada",
          eyebrowColor: "#047857",
          eyebrowBg: "#ecfdf5",
          title: "¡Turno confirmado!",
          intro: "Tu reserva fue registrada correctamente. Acá tenés todos los detalles de tu turno.",
          footerNote: `Recibiste este correo porque reservaste un turno en ${d.businessName}.`,
        }),
      };

    case "reminder":
      return {
        subject: `Recordatorio: tu turno en ${d.businessName} es el ${d.date}`,
        html: baseLayout({
          ...base,
          preheader: `Te esperamos el ${d.date} a las ${d.time} en ${d.businessName}.`,
          eyebrow: "⏰ Recordatorio",
          eyebrowColor: "#9a3412",
          eyebrowBg: "#fff7ed",
          title: "Tu turno se acerca",
          intro: `Te recordamos que tenés un turno reservado en ${d.businessName}. ¡Te esperamos!`,
          footerNote: `Recibiste este recordatorio por tu turno en ${d.businessName}.`,
        }),
      };

    case "reschedule":
      return {
        subject: `Tu turno en ${d.businessName} fue reprogramado`,
        html: baseLayout({
          ...base,
          preheader: `Nuevo horario: ${d.date} a las ${d.time}.`,
          eyebrow: "🔄 Turno reprogramado",
          eyebrowColor: "#1d4ed8",
          eyebrowBg: "#eff6ff",
          title: "Tu turno cambió de horario",
          intro: "Actualizamos tu reserva. Estos son los nuevos datos de tu turno.",
          footerNote: `Recibiste este correo por tu turno en ${d.businessName}.`,
        }),
      };

    case "cancellation":
      return {
        subject: `Tu turno en ${d.businessName} fue cancelado`,
        html: baseLayout({
          ...base,
          total: undefined,
          eyebrow: "✕ Turno cancelado",
          eyebrowColor: "#b91c1c",
          eyebrowBg: "#fef2f2",
          preheader: `Tu turno del ${d.date} en ${d.businessName} fue cancelado.`,
          title: "Tu turno fue cancelado",
          intro: "Tu reserva fue cancelada. Si querés, podés reservar un nuevo turno cuando quieras.",
          footerNote: `Recibiste este correo por una reserva en ${d.businessName}.`,
        }),
      };

    default:
      return null;
  }
}
