// ───────────────────────────────────────────────────────────────────────────
// Plantillas de correo de Clippr (compartidas entre Edge Functions).
//
// Arquitectura de BRANDING HEREDADO:
//   Todos los correos reciben un `BrandTheme` (modo claro/oscuro + colores +
//   logo + nombre) que se toma del branding configurado por el negocio en su
//   página pública (business_settings.schedule._branding + businesses). El
//   layout base se adapta solo a ese branding, así que CUALQUIER correo nuevo
//   (confirmación, recordatorio, reprogramación, cancelación, señas,
//   invitaciones, etc.) hereda la identidad visual automáticamente con solo
//   pasar el mismo BrandTheme.
//
//   Remitente: `Nombre del negocio <hola@myclippr.com>`.
// ───────────────────────────────────────────────────────────────────────────

export const CLIPPR_FROM_EMAIL = "hola@myclippr.com";
const CLIPPR_PURPLE = "#7c3aed";
/** Logo de Clippr (PNG: lo leen todos los clientes de correo, el webp no). */
const CLIPPR_LOGO_URL = "https://myclippr.com/clippr-powered-logo.png";
/** Íconos de los botones (PNG: los leen todos los clientes de correo). */
const CLIPPR_ICONS = "https://myclippr.com/email-icons";

/** Identidad visual del negocio, heredada del branding de su página pública. */
export type BrandTheme = {
  mode: "light" | "dark";
  primary: string;   // color principal / gradientes
  secondary: string; // segundo color del gradiente (== primary si no hay otro)
  accent: string;    // color de los botones (igual que el CTA público)
  buttonText: string;// color del texto de los botones
  name: string;      // Branding > Nombre del negocio
  logoUrl?: string | null;
};

export type BookingEmailData = {
  brand: BrandTheme;
  services: string;
  professional: string;
  clientName: string;
  clientPhone?: string | null;
  date: string; // ya formateada: "lunes, 15 de junio"
  time: string; // ya formateada: "11:00 a. m."
  total: number;
  /** El turno todavía está "Por confirmar" (no confirmado). */
  pending?: boolean;
  /** Link a la página de gestión del turno (/gestion?...). */
  manageUrl?: string | null;
  /** Link que abre la gestión del turno con "Confirmar asistencia" destacado (solo si está por confirmar). */
  confirmUrl?: string | null;
  /** Link directo a calendario; no debe abrir /gestion. */
  calendarUrl?: string | null;
  /** Google Maps con la dirección del local (si el negocio tiene dirección). */
  mapsUrl?: string | null;
  /** Chat de WhatsApp del negocio (si tiene teléfono). */
  whatsappUrl?: string | null;
  /** Página pública para volver a reservar. */
  bookUrl?: string | null;
  /** Seña pendiente de pago: el correo pide pagarla y enlaza a la página de pago. */
  deposit?: { amount: number; deadline: string; payUrl: string; note?: string | null } | null;
};

type Row = { label: string; value: string };
type Btn = { label: string; url: string; variant: "primary" | "secondary"; icon?: "agregar" | "llegar" | "whatsapp" | "gestionar" | "confirmar" };

export function clipprSender(businessName?: string | null): string {
  const name = (businessName ?? "").trim() || "Clippr";
  const safe = name.replace(/["\r\n]/g, "").slice(0, 78);
  return `${safe} <${CLIPPR_FROM_EMAIL}>`;
}

const hex = (s?: string | null, fb = CLIPPR_PURPLE) =>
  s && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : fb;

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatARS(value: number): string {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(Number(value ?? 0));
  } catch {
    return `$ ${value}`;
  }
}

function toRgb(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((c ?? "").trim());
  if (!m) return [124, 58, 237];
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
/** Mezcla `base` con `tint` (t = 0..1). Colores sólidos: los clientes de correo no entienden color-mix. */
function mixHex(base: string, tint: string, t: number): string {
  const a = toRgb(base);
  const b = toRgb(tint);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}
function relLum(c: string): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = toRgb(c);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: string, b: string): number {
  const la = relLum(a);
  const lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Letra del botón: la que eligió el negocio, salvo que sobre su color no se lea (nunca oscuro sobre oscuro). */
function readableOn(bg: string, wanted: string): string {
  if (contrast(wanted, bg) >= 2) return wanted;
  return contrast("#ffffff", bg) >= contrast("#0b0818", bg) ? "#ffffff" : "#0b0818";
}
/** ¿El color pide íconos blancos u oscuros? */
const iconVariant = (bg: string) => (contrast("#ffffff", bg) >= contrast("#111827", bg) ? "white" : "dark");

// Paleta clara/oscura (colores sólidos para máxima compatibilidad en Outlook), teñida con el color
// principal que el negocio eligió para su página pública.
function palette(mode: "light" | "dark", primary: string = CLIPPR_PURPLE) {
  const dark = mode === "dark";
  return {
    dark,
    pageBg: dark ? mixHex("#0a0911", primary, 0.16) : mixHex("#f1f3f7", primary, 0.07),
    cardBg: dark ? mixHex("#15131e", primary, 0.1) : "#ffffff",
    innerBg: dark ? mixHex("#2a2640", primary, 0.22) : mixHex("#f8fafc", primary, 0.05),
    border: dark ? mixHex("#3a3558", primary, 0.55) : mixHex("#eef0f4", primary, 0.18),
    rowBorder: dark ? "#3d3858" : "#eef0f4",
    text: dark ? "#f4f4f6" : "#0f172a",
    muted: dark ? "#a8a8b3" : "#64748b",
    subtle: dark ? "#74737f" : "#94a3b8",
    shadow: dark ? "rgba(0,0,0,.45)" : "rgba(15,23,42,.08)",
  };
}

// Logo con la misma forma que la página pública: redondo, con aro del color principal.
function header(brand: BrandTheme, p: ReturnType<typeof palette>): string {
  const ring = hex(brand.primary);
  if (brand.logoUrl) {
    return `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:50%;border:3px solid ${ring};object-fit:cover;outline:none;" />`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle" width="64" height="64" style="width:64px;height:64px;border-radius:50%;border:3px solid ${ring};background:${p.innerBg};font-size:26px;font-weight:800;color:${p.text};">${esc((brand.name || "C").trim().slice(0, 1).toUpperCase())}</td></tr></table>`;
}

function buttonsHtml(buttons: Btn[], brand: BrandTheme, p: ReturnType<typeof palette>): string {
  const visible = buttons.filter((b) => b.url);
  if (!visible.length) return "";
  const accent = hex(brand.accent, brand.primary);
  const nowrap = "white-space:nowrap;word-break:keep-all;overflow-wrap:normal;";
  const link = (b: Btn) => {
    const isPrimary = b.variant === "primary";
    const bg = isPrimary ? accent : p.cardBg;
    const color = isPrimary ? readableOn(accent, brand.buttonText) : p.text;
    const borderStyle = isPrimary ? "" : `border:1px solid ${p.border};`;
    const icon = b.icon
      ? `<img src="${CLIPPR_ICONS}/${b.icon}-${iconVariant(bg)}.png" width="18" height="18" alt="" style="display:inline-block;width:18px;height:18px;border:0;vertical-align:-4px;margin-right:8px;" />`
      : "";
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;background:${bg};${borderStyle}" bgcolor="${bg}">
            <tr><td align="center" style="border-radius:12px;">
              <a href="${esc(b.url)}" target="_blank" style="display:block;padding:13px 10px;font-size:14px;font-weight:700;color:${color};text-decoration:none;border-radius:12px;${nowrap}">${icon}${esc(b.label)}</a>
            </td></tr>
          </table>`;
  };
  const primary = visible.filter((b) => b.variant === "primary");
  const secondary = visible.filter((b) => b.variant !== "primary");
  const rows: string[] = [];
  for (const b of primary) rows.push(`<tr><td colspan="2" style="padding:4px 0;">${link(b)}</td></tr>`);
  // Los secundarios van de a dos por renglón; si queda uno suelto, ocupa todo el ancho.
  for (let i = 0; i < secondary.length; i += 2) {
    const a = secondary[i];
    const c = secondary[i + 1];
    rows.push(
      c
        ? `<tr><td width="50%" style="padding:4px 4px 4px 0;">${link(a)}</td><td width="50%" style="padding:4px 0 4px 4px;">${link(c)}</td></tr>`
        : `<tr><td colspan="2" style="padding:4px 0;">${link(a)}</td></tr>`,
    );
  }
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
        ${rows.join("")}
      </table>`;
}

function baseLayout(opts: {
  brand: BrandTheme;
  preheader: string;
  eyebrow: string;
  eyebrowColor: string;
  eyebrowBg: string;
  title: string;
  intro: string;
  /** Tamaño del texto del mensaje (px); por defecto 15. */
  introSize?: number;
  rows: Row[];
  /** Día y hora grandes arriba del detalle (correos de turno). */
  when?: { date: string; time: string };
  total?: number;
  buttons?: Btn[];
  footerNote: string;
}): string {
  const { brand } = opts;
  const primary = hex(brand.primary);
  const p = palette(brand.mode, primary);
  const secondary = hex(brand.secondary, primary);

  // Detalle compacto: las filas de a dos por renglón (Servicio ocupa todo el ancho).
  const cell = (r: Row, span = 1) => `
        <td colspan="${span}" valign="top" style="padding:8px 0;${span === 1 ? "width:50%;" : ""}">
          <span style="display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${p.subtle};font-weight:700;">${esc(r.label)}</span>
          <span style="display:block;margin-top:3px;font-size:15px;color:${p.text};font-weight:600;">${esc(r.value)}</span>
        </td>`;
  const rowsHtml = (() => {
    const out: string[] = [];
    const rest = [...opts.rows];
    const first = rest.shift();
    if (first) out.push(`<tr>${cell(first, 2)}</tr>`);
    for (let i = 0; i < rest.length; i += 2) {
      out.push(`<tr>${cell(rest[i])}${rest[i + 1] ? cell(rest[i + 1]) : "<td></td>"}</tr>`);
    }
    return out.join("");
  })();

  const whenHtml = opts.when
    ? `
          <tr><td align="center" style="padding:22px 24px 18px;border-bottom:1px dashed ${p.border};">
            <span style="display:block;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${primary};font-weight:800;">${esc(brand.name)}</span>
            <span style="display:block;margin-top:8px;font-size:16px;color:${p.text};font-weight:700;">${esc(opts.when.date)}</span>
            <span style="display:block;margin-top:2px;font-size:40px;line-height:1.1;color:${p.text};font-weight:800;letter-spacing:-.02em;">${esc(opts.when.time)}</span>
          </td></tr>`
    : "";

  const totalHtml =
    typeof opts.total === "number"
      ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-radius:14px;background:${p.innerBg};border:1px solid ${p.border};" bgcolor="${p.innerBg}">
        <tr><td style="padding:14px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:14px;color:${p.muted};font-weight:500;">Total</td>
              <td align="right" style="font-size:24px;color:${p.text};font-weight:800;letter-spacing:-.02em;">${formatARS(opts.total)}</td>
            </tr>
          </table>
        </td></tr>
      </table>`
      : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="${p.dark ? "dark" : "light"}" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${esc(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${p.pageBg};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${p.pageBg};" bgcolor="${p.pageBg}">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${p.cardBg};border-radius:20px;overflow:hidden;box-shadow:0 10px 40px ${p.shadow};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" bgcolor="${p.cardBg}">
          <!-- barra de marca (gradiente con fallback sólido) -->
          <tr><td style="height:4px;background:${primary};background:linear-gradient(90deg, ${primary}, ${secondary});" bgcolor="${primary}"></td></tr>
          <!-- logo / nombre -->
          <tr><td align="center" style="padding:24px 32px 0;">${header(brand, p)}</td></tr>
          <!-- eyebrow + título -->
          <tr><td align="center" style="padding:14px 32px 0;">
            <span style="display:inline-block;padding:5px 11px;border-radius:999px;background:${opts.eyebrowBg};color:${opts.eyebrowColor};font-size:12px;font-weight:700;">${esc(opts.eyebrow)}</span>
            <h1 style="margin:12px 0 0;font-size:26px;line-height:1.15;color:${p.text};font-weight:800;letter-spacing:-.02em;">${esc(opts.title)}</h1>
            ${opts.introSize ? "" : `<p style="margin:6px 0 0;font-size:15px;line-height:1.5;color:${p.muted};">${esc(opts.intro)}</p>`}
          </td></tr>
          ${
            opts.introSize
              ? `<!-- mensaje en tarjeta clara -->
          <tr><td style="padding:18px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${p.border};border-radius:16px;background:${p.innerBg};" bgcolor="${p.innerBg}">
              <tr><td style="padding:20px 22px;font-size:${opts.introSize}px;line-height:1.5;color:${p.text};text-align:center;">${esc(opts.intro)}</td></tr>
            </table>
          </td></tr>`
              : ""
          }
          ${
            opts.when || opts.rows.length > 0
              ? `<!-- detalle -->
          <tr><td style="padding:18px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${p.border};border-radius:16px;background:${p.innerBg};" bgcolor="${p.innerBg}">${whenHtml}
              <tr><td style="padding:6px 20px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
              </td></tr>
            </table>
            ${totalHtml}
          </td></tr>`
              : ""
          }
          <!-- botones -->
          <tr><td style="padding:0 32px;">${buttonsHtml(opts.buttons ?? [], brand, p)}</td></tr>
          <!-- footer -->
          <tr><td style="padding:22px 32px 24px;">
            <hr style="border:none;border-top:1px solid ${p.border};margin:0 0 14px;" />
            <p style="margin:0;font-size:12px;line-height:1.5;color:${p.subtle};text-align:center;">${esc(opts.footerNote)}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:14px auto 0;">
              <tr>
                <td style="font-size:11px;color:${p.subtle};padding-right:8px;">Impulsado por</td>
                <td style="padding-right:6px;"><img src="${CLIPPR_LOGO_URL}" alt="" width="22" height="22" style="display:block;width:22px;height:22px;border:0;border-radius:6px;" /></td>
                <td style="font-size:15px;font-weight:800;color:${p.text};letter-spacing:-.01em;">Clippr</td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Solo lo que aporta: servicio y profesional (día y hora van grandes arriba; el cliente ya
// conoce su nombre y su teléfono).
function detailRows(d: BookingEmailData): Row[] {
  return [
    { label: "Servicio", value: d.services },
    { label: "Profesional", value: d.professional },
  ];
}

function bookingButtons(d: BookingEmailData): Btn[] {
  const btns: Btn[] = [];
  if (d.deposit) btns.push({ label: "Pagar seña y enviar comprobante", url: d.deposit.payUrl, variant: "primary", icon: "confirmar" });
  if (d.confirmUrl && !d.deposit) btns.push({ label: "Confirmar asistencia", url: d.confirmUrl, variant: "primary", icon: "confirmar" });
  if (d.calendarUrl) btns.push({ label: "Agregar al calendario", url: d.calendarUrl, variant: d.confirmUrl || d.deposit ? "secondary" : "primary", icon: "agregar" });
  if (d.mapsUrl) btns.push({ label: "Cómo llegar", url: d.mapsUrl, variant: "secondary", icon: "llegar" });
  if (d.whatsappUrl) btns.push({ label: "WhatsApp", url: d.whatsappUrl, variant: "secondary", icon: "whatsapp" });
  if (d.manageUrl) btns.push({ label: "Gestionar turno", url: d.manageUrl, variant: "secondary", icon: "gestionar" });
  return btns;
}

/** Subject + HTML por tipo de correo. Devuelve null si el tipo no existe. */
export function buildBookingEmail(
  type: string,
  d: BookingEmailData,
): { subject: string; html: string } | null {
  const first = (d.clientName ?? "").trim().split(/\s+/)[0];
  const base = {
    brand: d.brand,
    when: { date: d.date, time: d.time },
    rows: detailRows(d),
    total: d.total,
    buttons: bookingButtons(d),
  };
  const biz = d.brand.name;

  switch (type) {
    case "confirmation":
      if (d.deposit) {
        const amt = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(d.deposit.amount);
        return {
          subject: `Falta la seña para confirmar tu turno en ${biz} · ${d.date}`,
          html: baseLayout({
            ...base,
            preheader: `Pagá la seña de ${amt} antes de ${d.deposit.deadline} para asegurar tu turno.`,
            eyebrow: "Falta pagar la seña",
            eyebrowColor: "#b45309",
            eyebrowBg: "#fffbeb",
            title: "Pagá la seña para confirmar tu turno",
            intro: `${first && first !== "-" ? `${first}, ` : ""}reservaste tu turno. Para asegurarlo, pagá la seña de ${amt} y enviá el comprobante desde el botón de abajo antes de ${d.deposit.deadline}. Si no, el turno se cancela y el horario se libera.`,
            footerNote: `Recibiste este correo porque reservaste un turno en ${biz}.`,
          }),
        };
      }
      return {
        subject: d.pending ? `Turno agendado en ${biz} · ${d.date}` : `Turno confirmado en ${biz} · ${d.date}`,
        html: baseLayout({
          ...base,
          preheader: `Tu turno en ${biz} es el ${d.date} a las ${d.time}.`,
          eyebrow: d.pending ? "✓ Turno agendado" : "✓ Reserva confirmada",
          eyebrowColor: "#047857",
          eyebrowBg: "#ecfdf5",
          title: d.pending ? "¡Turno agendado!" : "¡Turno confirmado!",
          intro: `${first && first !== "-" ? `Te esperamos, ${first}.` : "Te esperamos."}${
            d.confirmUrl
              ? " Confirmá tu asistencia con un toque."
              : d.pending
                ? " Un día antes te mandamos un correo para que confirmes tu asistencia."
                : ""
          }`,
          footerNote: `Recibiste este correo porque reservaste un turno en ${biz}.`,
        }),
      };

    case "reminder_1d":
      return {
        subject: `Mañana tenés turno en ${biz} · ${d.time}`,
        html: baseLayout({
          ...base,
          preheader: `Te esperamos mañana, ${d.date} a las ${d.time}, en ${biz}.`,
          eyebrow: "⏰ Mañana",
          eyebrowColor: "#9a3412",
          eyebrowBg: "#fff7ed",
          title: "Tu turno es mañana",
          intro: `${first && first !== "-" ? `${first}, ` : ""}te recordamos tu turno de mañana.${d.confirmUrl ? " Confirmá tu asistencia con un toque." : ""}`,
          footerNote: `Recibiste este recordatorio por tu turno en ${biz}.`,
        }),
      };

    case "reminder_2h":
      return {
        subject: `Tu turno en ${biz} es en 2 horas · ${d.time}`,
        html: baseLayout({
          ...base,
          // A 2 horas ya venció el plazo de cancelar/reprogramar: sin el botón "Gestionar turno".
          buttons: base.buttons.filter((b) => b.icon !== "gestionar"),
          preheader: `Te esperamos hoy a las ${d.time} en ${biz}.`,
          eyebrow: "⏰ En 2 horas",
          eyebrowColor: "#9a3412",
          eyebrowBg: "#fff7ed",
          title: "Tu turno es en 2 horas",
          intro: d.confirmUrl ? "Confirmá tu asistencia con un toque para que sepamos que venís." : "Te esperamos. ¡Nos vemos pronto!",
          footerNote: `Recibiste este recordatorio por tu turno en ${biz}.`,
        }),
      };

    case "reminder":
      return {
        subject: `Recordatorio: tu turno en ${biz} es el ${d.date}`,
        html: baseLayout({
          ...base,
          preheader: `Te esperamos el ${d.date} a las ${d.time} en ${biz}.`,
          eyebrow: "⏰ Recordatorio",
          eyebrowColor: "#9a3412",
          eyebrowBg: "#fff7ed",
          title: "Tu turno se acerca",
          intro: "Te recordamos tu turno. ¡Te esperamos!",
          footerNote: `Recibiste este recordatorio por tu turno en ${biz}.`,
        }),
      };

    case "reschedule":
      return {
        subject: `Tu turno en ${biz} fue reprogramado`,
        html: baseLayout({
          ...base,
          preheader: `Nuevo horario: ${d.date} a las ${d.time}.`,
          eyebrow: "🔄 Turno reprogramado",
          eyebrowColor: "#1d4ed8",
          eyebrowBg: "#eff6ff",
          title: "Tu turno cambió de horario",
          intro: d.confirmUrl ? "Estos son los nuevos datos. Confirmá tu asistencia con un toque." : "Estos son los nuevos datos de tu turno.",
          footerNote: `Recibiste este correo por tu turno en ${biz}.`,
        }),
      };

    case "cancellation":
      return {
        subject: `Tu turno en ${biz} fue cancelado`,
        html: baseLayout({
          ...base,
          total: undefined,
          buttons: [],
          eyebrow: "✕ Turno cancelado",
          eyebrowColor: "#b91c1c",
          eyebrowBg: "#fef2f2",
          preheader: `Tu turno del ${d.date} en ${biz} fue cancelado.`,
          title: "Tu turno fue cancelado",
          intro: "Podés reservar un nuevo turno cuando quieras.",
          footerNote: `Recibiste este correo por una reserva en ${biz}.`,
        }),
      };

    case "deposit_reminder": {
      const amt = d.deposit
        ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(d.deposit.amount)
        : "";
      return {
        subject: `Falta la seña para confirmar tu turno en ${biz} · ${d.date}`,
        html: baseLayout({
          ...base,
          // Correo mínimo: el botón lleva a la página del turno con todos los detalles.
          rows: [],
          when: undefined,
          total: undefined,
          buttons: d.deposit ? [{ label: "Pagar seña y enviar comprobante", url: d.deposit.payUrl, variant: "primary", icon: "confirmar" }] : [],
          preheader: `Pagá la seña de ${amt} para asegurar tu turno.`,
          eyebrow: "Falta pagar la seña",
          eyebrowColor: "#b45309",
          eyebrowBg: "#fffbeb",
          title: "Pagá la seña para confirmar tu turno",
          introSize: 19,
          intro: `${first && first !== "-" ? `${first}, ` : ""}reservaste tu turno${d.services && d.services !== "-" ? ` para ${d.services}` : ""} y todavía falta la seña de ${amt}. Pagala y enviá el comprobante desde el botón de abajo${d.deposit ? ` antes de ${d.deposit.deadline}` : ""}. Si no, el turno se cancela y el horario se libera.`,
          footerNote: `Recibiste este correo porque reservaste un turno en ${biz}.`,
        }),
      };
    }

    case "deposit_rejected":
      return {
        subject: `No pudimos validar tu comprobante · ${biz}`,
        html: baseLayout({
          ...base,
          rows: [],
          when: undefined,
          total: undefined,
          buttons: d.whatsappUrl ? [{ label: "Contactar al local por WhatsApp", url: d.whatsappUrl, variant: "primary" as const, icon: "whatsapp" as const }] : [],
          introSize: 19,
          preheader: "Contactá al local para resolver tu seña.",
          eyebrow: "Comprobante rechazado",
          eyebrowColor: "#b91c1c",
          eyebrowBg: "#fef2f2",
          title: "No pudimos validar tu comprobante",
          intro: `${first && first !== "-" ? `${first}, ` : ""}no pudimos validar el comprobante que enviaste${d.services && d.services !== "-" ? ` para ${d.services}` : ""}. Contactá al local para resolverlo y asegurar tu turno.`,
          footerNote: `Recibiste este correo porque reservaste un turno en ${biz}.`,
        }),
      };

    case "deposit_confirmed":
      return {
        subject: `Turno confirmado en ${biz} · ${d.date}`,
        html: baseLayout({
          ...base,
          preheader: `Recibimos tu seña. Tu turno en ${biz} es el ${d.date} a las ${d.time}.`,
          eyebrow: "✓ Seña recibida",
          eyebrowColor: "#047857",
          eyebrowBg: "#ecfdf5",
          title: "¡Turno confirmado!",
          intro: `${first && first !== "-" ? `Te esperamos, ${first}. ` : "Te esperamos. "}Recibimos tu seña y tu turno quedó confirmado.`,
          footerNote: `Recibiste este correo porque reservaste un turno en ${biz}.`,
        }),
      };

    case "deposit_expired":
      return {
        subject: `Tu turno en ${biz} se canceló por falta de pago`,
        html: baseLayout({
          ...base,
          total: undefined,
          buttons: [
            ...(d.bookUrl ? [{ label: "Volver a agendar", url: d.bookUrl, variant: "primary" as const, icon: "agregar" as const }] : []),
            ...(d.whatsappUrl ? [{ label: "WhatsApp", url: d.whatsappUrl, variant: "secondary" as const, icon: "whatsapp" as const }] : []),
          ],
          eyebrow: "✕ Turno cancelado",
          eyebrowColor: "#b91c1c",
          eyebrowBg: "#fef2f2",
          preheader: `Tu turno del ${d.date} en ${biz} se canceló porque no se pagó la seña a tiempo.`,
          title: "Tu turno se canceló",
          intro: "No recibimos la seña dentro del plazo, así que el horario se liberó. Podés reservar de nuevo cuando quieras.",
          footerNote: `Recibiste este correo por una reserva en ${biz}.`,
        }),
      };

    default:
      return null;
  }
}
