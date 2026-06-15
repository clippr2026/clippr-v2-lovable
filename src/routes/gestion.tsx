import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { CalendarDays, RefreshCw, X } from "lucide-react";

type Search = {
  b?: string; bid?: string; tk?: string; emp?: string; slug?: string; svc?: string; prof?: string;
  d?: string; t?: string; s?: string; dur?: string; tot?: string;
  addr?: string; ph?: string; n?: string;
  pc?: string; ac?: string; bt?: string; m?: string; logo?: string;
  mode?: "calendar" | "manage" | string;
};

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export const Route = createFileRoute("/gestion")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    b: str(search.b), bid: str(search.bid), tk: str(search.tk), emp: str(search.emp), slug: str(search.slug),
    svc: str(search.svc), prof: str(search.prof), d: str(search.d), t: str(search.t),
    s: str(search.s), dur: str(search.dur), tot: str(search.tot),
    addr: str(search.addr), ph: str(search.ph), n: str(search.n),
    pc: str(search.pc), ac: str(search.ac), bt: str(search.bt), m: str(search.m), logo: str(search.logo),
    mode: str(search.mode),
  }),
  component: GestionPage,
});

const isHex = (s?: string) => !!s && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);
const icsStamp = (dt: Date) => dt.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
const fmtDay = (dt: Date) => dt.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
const fmtTime = (dt: Date) => dt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) + " hs";

function GestionPage() {
  const p = Route.useSearch();
  const dark = p.m !== "light";
  const primary = isHex(p.pc) ? (p.pc as string) : "#7c3aed";
  const accent = isHex(p.ac) ? (p.ac as string) : "#d6b66a";
  const buttonText = isHex(p.bt) ? (p.bt as string) : "#ffffff";

  const c = {
    pageBg: dark ? "#08070c" : "#f6f7fb",
    cardBg: dark ? "#15131e" : "#ffffff",
    innerBg: dark ? "#1d1b27" : "#f8fafc",
    border: dark ? "#2c2937" : "#eef0f4",
    text: dark ? "#f4f4f6" : "#0f172a",
    muted: dark ? "#a8a8b3" : "#64748b",
    subtle: dark ? "#74737f" : "#94a3b8",
  };

  const businessName = p.b || "Clippr";
  const service = p.svc || "Turno";
  const start = p.s ? new Date(p.s) : null;
  const durMin = p.dur ? Number(p.dur) : 60;
  const end = start ? new Date(start.getTime() + (Number.isFinite(durMin) ? durMin : 60) * 60000) : null;
  const dateLabel = start && !Number.isNaN(start.getTime()) ? fmtDay(start) : p.d || "";
  const timeLabel = start && !Number.isNaN(start.getTime()) ? fmtTime(start) : p.t || "";

  const eventTitle = `${service} · ${businessName}`;
  const eventDetails = [
    p.prof ? `Profesional: ${p.prof}` : null,
    `Negocio: ${businessName}`,
    p.n ? `Notas: ${p.n}` : null,
    "Reservado con Clippr",
  ].filter(Boolean).join("\n");

  const googleUrl = start && end
    ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(eventTitle)}&dates=${icsStamp(start)}/${icsStamp(end)}&details=${encodeURIComponent(eventDetails)}${p.addr ? `&location=${encodeURIComponent(p.addr)}` : ""}`
    : null;
  const outlookUrl = start && end
    ? `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodeURIComponent(eventTitle)}&startdt=${encodeURIComponent(start.toISOString())}&enddt=${encodeURIComponent(end.toISOString())}&body=${encodeURIComponent(eventDetails)}${p.addr ? `&location=${encodeURIComponent(p.addr)}` : ""}`
    : null;

  const downloadIcs = React.useCallback(() => {
    if (!start || !end) return;
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Clippr//Reservas//ES", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT", `UID:${Date.now()}@clippr`, `DTSTAMP:${icsStamp(new Date())}`,
      `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`, `SUMMARY:${eventTitle}`,
      `DESCRIPTION:${eventDetails.replace(/\n/g, "\\n")}`, p.addr ? `LOCATION:${p.addr}` : "",
      "END:VEVENT", "END:VCALENDAR",
    ].filter(Boolean).join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `turno-${businessName}.ics`.replace(/\s+/g, "-").toLowerCase();
    a.click();
    URL.revokeObjectURL(url);
  }, [start, end, eventTitle, eventDetails, p.addr, businessName]);

  const phone = normalizePhone(p.ph);
  const cancelMsg = buildWhatsAppMessage("cancelar", businessName, service, p.prof, dateLabel, timeLabel);
  const rescheduleMsg = buildWhatsAppMessage("reprogramar", businessName, service, p.prof, dateLabel, timeLabel);
  const cancelUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(cancelMsg)}` : null;
  const rescheduleUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(rescheduleMsg)}` : null;

  const mode = p.mode === "calendar" ? "calendar" : "manage";

  return (
    <div style={{ minHeight: "100vh", background: c.pageBg, color: c.text, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", padding: "40px 16px" }}>
      <div style={{ maxWidth: 440, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 24 }}>
          {p.logo ? (
            <img src={p.logo} alt={businessName} style={{ height: 42, width: 42, borderRadius: 12, objectFit: "cover" }} />
          ) : (
            <div style={{ height: 42, width: 42, borderRadius: 12, display: "grid", placeItems: "center", background: accent, color: buttonText, fontWeight: 800 }}>{businessName.slice(0, 1)}</div>
          )}
          <span style={{ fontSize: 18, fontWeight: 800 }}>{businessName}</span>
        </div>

        <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 24, padding: 24, overflow: "hidden" }}>
          <div style={{ height: 4, margin: "-24px -24px 22px", background: `linear-gradient(90deg, ${primary}, ${accent})` }} />

          {mode === "calendar" ? (
            <>
              <h1 style={{ margin: "0 0 18px", fontSize: 24, fontWeight: 800, textAlign: "center" }}>Agregar al calendario</h1>
              <div style={{ display: "grid", gap: 12 }}>
                <button onClick={downloadIcs} style={button(c.innerBg, c.border, c.text)}>
                  <CalendarDays size={18} /> Apple Calendar
                </button>
                <a href={googleUrl ?? "#"} target="_blank" rel="noreferrer" style={button(c.innerBg, c.border, c.text)}>
                  <CalendarDays size={18} /> Google Calendar
                </a>
                <a href={outlookUrl ?? "#"} target="_blank" rel="noreferrer" style={button(c.innerBg, c.border, c.text)}>
                  <CalendarDays size={18} /> Outlook
                </a>
              </div>
            </>
          ) : (
            <>
              <h1 style={{ margin: "0 0 18px", fontSize: 24, fontWeight: 800, textAlign: "center" }}>Gestionar turno</h1>
              <div style={{ display: "grid", gap: 12 }}>
                {cancelUrl && rescheduleUrl ? (
                  <>
                    <a href={cancelUrl} target="_blank" rel="noreferrer" style={solid(accent, buttonText)}>
                      <X size={18} /> Cancelar turno
                    </a>
                    <a href={rescheduleUrl} target="_blank" rel="noreferrer" style={button(c.innerBg, c.border, c.text)}>
                      <RefreshCw size={18} /> Reprogramar
                    </a>
                  </>
                ) : (
                  <div style={{ padding: 14, borderRadius: 14, border: `1px solid ${c.border}`, background: c.innerBg, color: c.muted, textAlign: "center", fontSize: 14, fontWeight: 700 }}>
                    Para hacer cambios en tu turno, contactá al negocio por sus canales habituales.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function normalizePhone(phone?: string): string {
  let raw = String(phone ?? "").replace(/\D/g, "");
  if (!raw) return "";
  if (raw.startsWith("00")) raw = raw.slice(2);

  // Argentina: WhatsApp móvil necesita 549 + código de área + número.
  if (raw.startsWith("549")) return raw;
  if (raw.startsWith("54")) {
    const rest = raw.slice(2).replace(/^0+/, "").replace(/^15/, "");
    return `549${rest}`;
  }

  raw = raw.replace(/^0+/, "");
  // Si lo cargan como 15 2790 0829, asumimos AMBA y lo convertimos a 11.
  if (raw.startsWith("15")) raw = `11${raw.slice(2)}`;
  return `549${raw}`;
}

function buildWhatsAppMessage(action: "cancelar" | "reprogramar", business: string, service: string, professional?: string, date?: string, time?: string): string {
  const title = action === "cancelar" ? "Hola, quiero cancelar mi turno." : "Hola, quiero reprogramar mi turno.";
  return [
    title,
    `Negocio: ${business}`,
    `Servicio: ${service}`,
    professional ? `Profesional: ${professional}` : null,
    date ? `Fecha: ${date}` : null,
    time ? `Horario: ${time}` : null,
  ].filter(Boolean).join("\n");
}

function button(bg: string, border: string, text: string): React.CSSProperties {
  return { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 18px", borderRadius: 14, border: `1px solid ${border}`, background: bg, color: text, fontSize: 15, fontWeight: 800, textDecoration: "none", cursor: "pointer" };
}

function solid(bg: string, text: string): React.CSSProperties {
  return { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 18px", borderRadius: 14, border: "none", background: bg, color: text, fontSize: 15, fontWeight: 800, textDecoration: "none", cursor: "pointer" };
}
