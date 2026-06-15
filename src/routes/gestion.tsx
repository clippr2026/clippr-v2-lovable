import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { CalendarDays, Clock3, MapPin, Scissors, UserRound, CalendarPlus, RefreshCw, X, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Página pública de gestión de turno. Datos + branding por query params (los
// arma la Edge Function send-booking-email). Muestra los datos del turno y permite iniciar
// cambios por WhatsApp con mensaje automático. También deja elegir calendario.
// Si llega token (tk), solo se usa para validar estado cancelado cuando exista.

type Search = {
  b?: string; bid?: string; tk?: string; emp?: string; slug?: string; svc?: string; prof?: string;
  d?: string; t?: string; s?: string; dur?: string; tot?: string;
  addr?: string; ph?: string; n?: string; calendar?: string;
  pc?: string; ac?: string; bt?: string; m?: string; logo?: string;
};

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export const Route = createFileRoute("/gestion")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    b: str(search.b), bid: str(search.bid), tk: str(search.tk), emp: str(search.emp), slug: str(search.slug),
    svc: str(search.svc), prof: str(search.prof), d: str(search.d), t: str(search.t),
    s: str(search.s), dur: str(search.dur), tot: str(search.tot),
    addr: str(search.addr), ph: str(search.ph), n: str(search.n), calendar: str(search.calendar),
    pc: str(search.pc), ac: str(search.ac), bt: str(search.bt), m: str(search.m), logo: str(search.logo),
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
    pageBg: dark ? "#08070c" : "#f6f7fb", cardBg: dark ? "#15131e" : "#ffffff",
    innerBg: dark ? "#1d1b27" : "#f8fafc", border: dark ? "#2c2937" : "#eef0f4",
    text: dark ? "#f4f4f6" : "#0f172a", muted: dark ? "#a8a8b3" : "#64748b", subtle: dark ? "#74737f" : "#94a3b8",
  };

  const businessName = p.b || "Clippr";
  const service = p.svc || "Tu turno";
  const durMin = p.dur ? Number(p.dur) : 60;
  const total = p.tot ? Number(p.tot) : 0;
  const hasToken = !!p.tk;

  const [start, setStart] = React.useState<Date | null>(p.s ? new Date(p.s) : null);
  const [status, setStatus] = React.useState<"active" | "cancelled" | "loading" | "invalid">(hasToken ? "loading" : "invalid");
  const [feedback, setFeedback] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Calendario
  const [showCalChooser, setShowCalChooser] = React.useState(p.calendar === "1");

  // Estado real del turno por token
  React.useEffect(() => {
    if (!p.tk) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.rpc("get_public_booking_v1", { p_token: p.tk });
        const row = Array.isArray(data) ? data[0] : data;
        if (!alive) return;
        if (!row) { setStatus("invalid"); return; }
        setStatus(row.status === "cancelled" ? "cancelled" : "active");
        if (row.starts_at) setStart(new Date(row.starts_at));
      } catch { if (alive) setStatus("invalid"); }
    })();
    return () => { alive = false; };
  }, [p.tk]);

  const end = start ? new Date(start.getTime() + (Number.isFinite(durMin) ? durMin : 60) * 60000) : null;
  const dateLabel = start ? fmtDay(start) : p.d;
  const timeLabel = start ? fmtTime(start) : p.t;

  const eventTitle = `${service} · ${businessName}`;
  const eventDetails = [
    p.prof ? `Profesional: ${p.prof}` : null, `Negocio: ${businessName}`,
    p.n ? `Notas: ${p.n}` : null, "Reservado con Clippr",
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
    a.href = url; a.download = `turno-${businessName}.ics`.replace(/\s+/g, "-").toLowerCase(); a.click();
    URL.revokeObjectURL(url);
  }, [start, end, eventTitle, eventDetails, p.addr, businessName]);

  // En Clippr dejamos que el cliente elija el calendario: Apple, Google u Outlook.
  function smartCalendar() {
    if (!start) return;
    setShowCalChooser((v) => !v);
  }

  function cleanWhatsappPhone(value?: string) {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.startsWith("549") || digits.startsWith("54")) return digits;
    return `54${digits}`;
  }

  function whatsappUrl(action: "reprogramar" | "cancelar") {
    const phone = cleanWhatsappPhone(p.ph);
    const actionText = action === "reprogramar" ? "reprogramar" : "cancelar";
    const msg = [
      `Hola ${businessName}, quiero ${actionText} mi reserva.`,
      "",
      `Servicio: ${service}`,
      p.prof ? `Profesional: ${p.prof}` : null,
      dateLabel ? `Fecha: ${dateLabel}` : null,
      timeLabel ? `Horario: ${timeLabel}` : null,
      p.addr ? `Dirección: ${p.addr}` : null,
    ].filter(Boolean).join("\n");
    return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  }

  const reprogramarWhatsAppUrl = whatsappUrl("reprogramar");
  const cancelarWhatsAppUrl = whatsappUrl("cancelar");

  const cancelled = status === "cancelled";
  const rows = [
    { icon: Scissors, label: "Servicio", value: p.svc },
    { icon: UserRound, label: "Profesional", value: p.prof },
    { icon: CalendarDays, label: "Fecha", value: dateLabel },
    { icon: Clock3, label: "Horario", value: timeLabel },
    { icon: MapPin, label: "Dirección", value: p.addr },
  ].filter((r) => r.value);

  const cardStyle: React.CSSProperties = { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 24 };
  const noWrap: React.CSSProperties = { whiteSpace: "nowrap" };
  return (
    <div style={{ minHeight: "100vh", background: c.pageBg, color: c.text, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", padding: "40px 16px" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          {p.logo ? (
            <img src={p.logo} alt={businessName} style={{ height: 40, width: 40, borderRadius: 12, objectFit: "cover" }} />
          ) : (
            <div style={{ height: 40, width: 40, borderRadius: 12, display: "grid", placeItems: "center", background: accent, color: buttonText, fontWeight: 800 }}>{businessName.slice(0, 1)}</div>
          )}
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.01em" }}>{businessName}</span>
        </div>

        <div style={{ ...cardStyle, padding: 24, overflow: "hidden" }}>
          <div style={{ height: 4, margin: "-24px -24px 20px", background: `linear-gradient(90deg, ${primary}, ${accent})` }} />
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>Gestión de tu turno</h1>
          <p style={{ margin: "8px 0 20px", fontSize: 14, color: c.muted }}>Revisá los detalles, reprogramá o cancelá tu turno.</p>

          {cancelled ? (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 999, background: dark ? "rgba(239,68,68,.12)" : "#fef2f2", color: "#ef4444", fontSize: 13, fontWeight: 700, marginBottom: 16 }}>
              <X size={15} /> Turno cancelado
            </div>
          ) : null}

          <div style={{ background: c.innerBg, border: `1px solid ${c.border}`, borderRadius: 16, padding: "4px 16px", opacity: cancelled ? 0.6 : 1 }}>
            {rows.map((r, i) => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 0", borderBottom: i < rows.length - 1 ? `1px solid ${c.border}` : "none" }}>
                <span style={{ display: "grid", placeItems: "center", height: 36, width: 36, borderRadius: 10, background: `linear-gradient(135deg, ${primary}, ${accent})`, color: "#fff", flexShrink: 0 }}><r.icon size={17} /></span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: c.subtle, fontWeight: 600 }}>{r.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, wordBreak: "break-word" }}>{r.value}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {feedback ? (
          <div style={{ ...cardStyle, padding: "14px 18px", marginTop: 16, display: "flex", alignItems: "center", gap: 10, borderColor: feedback.kind === "ok" ? "#22c55e55" : "#ef444455" }}>
            {feedback.kind === "ok" ? <CheckCircle2 size={18} style={{ color: "#22c55e" }} /> : <AlertCircle size={18} style={{ color: "#ef4444" }} />}
            <span style={{ fontSize: 14 }}>{feedback.text}</span>
          </div>
        ) : null}

        {!cancelled ? (
          <div style={{ ...cardStyle, padding: 24, marginTop: 16 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700 }}>¿Necesitás un cambio?</h2>

            <>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: c.muted }}>Para reprogramar o cancelar, te abrimos WhatsApp con el mensaje listo para enviar.</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <a href={reprogramarWhatsAppUrl} target="_blank" rel="noreferrer" style={{ ...solidBtn(accent, buttonText), ...noWrap, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <RefreshCw size={16} /> Reprogramar
                </a>
                <a href={cancelarWhatsAppUrl} target="_blank" rel="noreferrer" style={{ ...outlineBtn(c), ...noWrap, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <X size={16} /> Cancelar
                </a>
                <button onClick={smartCalendar} disabled={!start} style={{ ...outlineBtn(c), ...noWrap, cursor: start ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 8, opacity: start ? 1 : 0.55 }}>
                  <CalendarPlus size={16} /> Agregar al calendario
                </button>
              </div>
              {showCalChooser ? (
                <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                  <button onClick={downloadIcs} style={{ ...calBtn(c), ...noWrap, cursor: "pointer", width: "100%" }}>Apple Calendar</button>
                  <a href={googleUrl ?? "#"} target="_blank" rel="noreferrer" style={{ ...calBtn(c), ...noWrap }}>Google Calendar</a>
                  <a href={outlookUrl ?? "#"} target="_blank" rel="noreferrer" style={{ ...calBtn(c), ...noWrap }}>Outlook</a>
                </div>
              ) : null}
            </>
          </div>
        ) : null}

        <p style={{ textAlign: "center", marginTop: 24, fontSize: 12, color: c.subtle }}>
          Reservá fácil con <span style={{ fontWeight: 700, color: primary }}>Clippr</span>
        </p>
      </div>
    </div>
  );
}

function calBtn(c: { innerBg: string; border: string; text: string }): React.CSSProperties {
  return { display: "block", textAlign: "center", padding: "13px 18px", borderRadius: 12, border: `1px solid ${c.border}`, background: c.innerBg, color: c.text, fontSize: 14, fontWeight: 700, textDecoration: "none" };
}
function solidBtn(bg: string, text: string): React.CSSProperties {
  return { padding: "13px 24px", borderRadius: 12, background: bg, color: text, fontSize: 14, fontWeight: 700, textDecoration: "none", border: "none" };
}
function outlineBtn(c: { border: string; text: string; cardBg: string }): React.CSSProperties {
  return { padding: "13px 24px", borderRadius: 12, background: c.cardBg, color: c.text, fontSize: 14, fontWeight: 700, textDecoration: "none", border: `1px solid ${c.border}` };
}
