import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { CalendarDays, Clock3, MapPin, Scissors, UserRound, CalendarPlus, RefreshCw, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildSlots, normalizeSchedule, addMinutes, startOfDay, type Appointment } from "@/lib/availability";

// Página pública de gestión de turno. Datos + branding por query params (los
// arma la Edge Function send-booking-email). Con token (tk) permite cancelar y
// reprogramar self-service vía RPCs SECURITY DEFINER. La reprogramación reusa
// EXACTAMENTE el motor de disponibilidad de la página de reservas (buildSlots).

type Search = {
  b?: string; bid?: string; tk?: string; emp?: string; slug?: string; svc?: string; prof?: string;
  d?: string; t?: string; s?: string; dur?: string; tot?: string;
  addr?: string; ph?: string; n?: string;
  pc?: string; ac?: string; bt?: string; m?: string; logo?: string;
};

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export const Route = createFileRoute("/gestion")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    b: str(search.b), bid: str(search.bid), tk: str(search.tk), emp: str(search.emp), slug: str(search.slug),
    svc: str(search.svc), prof: str(search.prof), d: str(search.d), t: str(search.t),
    s: str(search.s), dur: str(search.dur), tot: str(search.tot),
    addr: str(search.addr), ph: str(search.ph), n: str(search.n),
    pc: str(search.pc), ac: str(search.ac), bt: str(search.bt), m: str(search.m), logo: str(search.logo),
  }),
  component: GestionPage,
});

const isHex = (s?: string) => !!s && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);
const icsStamp = (dt: Date) => dt.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
const fmtDay = (dt: Date) => dt.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
const fmtDayShort = (dt: Date) => dt.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
const fmtTime = (dt: Date) => dt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) + " hs";
const fmtClock = (dt: Date) => dt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

function detectPlatform(): "apple" | "google" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  const plat = (navigator as any).platform || "";
  if (/iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(ua) || /Mac|iPhone|iPad/i.test(plat)) return "apple";
  if (/Android/i.test(ua)) return "google";
  return "unknown";
}

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
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Reprogramación
  const [rescheduleMode, setRescheduleMode] = React.useState(false);
  const [loadingSlots, setLoadingSlots] = React.useState(false);
  const [days, setDays] = React.useState<Array<{ date: Date; slots: Array<{ time: Date; employeeId: string }> }>>([]);
  const [dayIdx, setDayIdx] = React.useState(0);
  const [chosen, setChosen] = React.useState<Date | null>(null);

  // Calendario
  const [showCalChooser, setShowCalChooser] = React.useState(false);

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

  // Botón único: detecta el entorno y abre el calendario correcto.
  function smartCalendar() {
    if (!start) return;
    const plat = detectPlatform();
    if (plat === "apple") { downloadIcs(); return; }
    if (plat === "google" && googleUrl) { window.open(googleUrl, "_blank"); return; }
    setShowCalChooser(true);
  }

  const fireEmail = React.useCallback((type: "cancellation" | "reschedule", dLabel?: string, tLabel?: string) => {
    if (!p.bid || !p.tk) return;
    void supabase.functions.invoke("send-booking-email", {
      body: { type, businessId: p.bid, token: p.tk, booking: { services: p.svc, professional: p.prof, date: dLabel ?? dateLabel, time: tLabel ?? timeLabel, total } },
    }).catch(() => {});
  }, [p.bid, p.tk, p.svc, p.prof, dateLabel, timeLabel, total]);

  async function handleCancel() {
    if (!hasToken) return;
    if (!confirm("¿Seguro que querés cancelar este turno?")) return;
    setBusy(true); setFeedback(null);
    try {
      const { data, error } = await supabase.rpc("cancel_public_booking_v1", { p_token: p.tk });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || "No se pudo cancelar");
      setStatus("cancelled");
      setFeedback({ kind: "ok", text: "Tu turno fue cancelado." });
      fireEmail("cancellation");
    } catch (e) {
      setFeedback({ kind: "err", text: (e as Error).message });
    } finally { setBusy(false); }
  }

  // Carga disponibilidad real con el MISMO motor que la reserva pública.
  async function openReschedule() {
    setRescheduleMode(true); setChosen(null); setDayIdx(0); setLoadingSlots(true); setFeedback(null);
    try {
      const from = startOfDay(new Date()).toISOString();
      const to = addMinutes(startOfDay(new Date()), 14 * 24 * 60).toISOString();
      const [settingsRes, apptsRes] = await Promise.all([
        supabase.from("public_booking_settings").select("schedule").eq("business_id", p.bid).maybeSingle(),
        supabase.from("public_booking_appointments").select("id,employee_id,starts_at,ends_at,duration_min,status").eq("business_id", p.bid).gte("starts_at", from).lte("starts_at", to),
      ]);
      const schedule = normalizeSchedule((settingsRes.data as any)?.schedule ?? null);
      const appts = ((apptsRes.data ?? []) as Appointment[]);
      const emp = p.emp || "any";
      const built = buildSlots(schedule, appts, emp !== "any" ? [{ id: emp }] : [], emp, Number.isFinite(durMin) ? durMin : 60, 14)
        .filter((d) => d.slots.length > 0);
      setDays(built);
      if (built.length === 0) setFeedback({ kind: "err", text: "No hay horarios disponibles en los próximos días." });
    } catch (e) {
      setFeedback({ kind: "err", text: "No se pudo cargar la disponibilidad." });
    } finally { setLoadingSlots(false); }
  }

  async function confirmReschedule() {
    if (!chosen || !hasToken) return;
    setBusy(true); setFeedback(null);
    try {
      const { data, error } = await supabase.rpc("reschedule_public_booking_v1", { p_token: p.tk, p_starts_at: chosen.toISOString() });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || "No se pudo reprogramar");
      setStart(chosen); setRescheduleMode(false);
      setFeedback({ kind: "ok", text: `Reprogramado para el ${fmtDay(chosen)} a las ${fmtClock(chosen)} hs.` });
      fireEmail("reschedule", fmtDay(chosen), fmtTime(chosen));
    } catch (e) {
      setFeedback({ kind: "err", text: (e as Error).message });
    } finally { setBusy(false); }
  }

  const cancelled = status === "cancelled";
  const validToken = hasToken && status !== "invalid" && status !== "loading";
  const rows = [
    { icon: Scissors, label: "Servicio", value: p.svc },
    { icon: UserRound, label: "Profesional", value: p.prof },
    { icon: CalendarDays, label: "Fecha", value: dateLabel },
    { icon: Clock3, label: "Horario", value: timeLabel },
    { icon: MapPin, label: "Dirección", value: p.addr },
  ].filter((r) => r.value);

  const cardStyle: React.CSSProperties = { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 24 };
  const noWrap: React.CSSProperties = { whiteSpace: "nowrap" };
  const currentDay = days[dayIdx];

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

            {!validToken ? (
              <p style={{ margin: "8px 0 0", fontSize: 13, color: c.subtle }}>No pudimos validar este turno desde el link. Abrí el botón “Gestionar reserva” desde el último correo de confirmación.</p>
            ) : rescheduleMode ? (
              <div style={{ marginTop: 12 }}>
                {loadingSlots ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, color: c.muted, fontSize: 14, padding: "12px 0" }}>
                    <Loader2 size={18} className="animate-spin" /> Buscando horarios disponibles…
                  </div>
                ) : days.length > 0 ? (
                  <>
                    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8 }}>
                      {days.map((d, i) => (
                        <button key={i} onClick={() => { setDayIdx(i); setChosen(null); }} style={{
                          ...noWrap, padding: "8px 14px", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer",
                          border: `1px solid ${i === dayIdx ? accent : c.border}`, background: i === dayIdx ? accent : c.innerBg, color: i === dayIdx ? buttonText : c.text,
                        }}>{fmtDayShort(d.date)}</button>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8, marginTop: 14 }}>
                      {currentDay?.slots.map((slot, i) => {
                        const isSel = chosen?.getTime() === slot.time.getTime();
                        return (
                          <button key={i} onClick={() => setChosen(slot.time)} style={{
                            ...noWrap, padding: "10px 0", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer",
                            border: `1px solid ${isSel ? accent : c.border}`, background: isSel ? accent : c.cardBg, color: isSel ? buttonText : c.text,
                          }}>{fmtClock(slot.time)}</button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                      <button onClick={confirmReschedule} disabled={!chosen || busy} style={{ ...solidBtn(accent, buttonText), ...noWrap, cursor: chosen && !busy ? "pointer" : "default", opacity: chosen && !busy ? 1 : 0.55 }}>
                        {busy ? "Confirmando…" : "Confirmar nuevo horario"}
                      </button>
                      <button onClick={() => setRescheduleMode(false)} style={{ ...outlineBtn(c), ...noWrap, cursor: "pointer" }}>Volver</button>
                    </div>
                  </>
                ) : (
                  <p style={{ fontSize: 13, color: c.subtle, marginTop: 12 }}>No hay horarios disponibles por ahora.</p>
                )}
              </div>
            ) : (
              <>
                <p style={{ margin: "0 0 16px", fontSize: 13, color: c.muted }}>Reprogramá, cancelá o agregá el turno a tu calendario.</p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={openReschedule} disabled={busy} style={{ ...solidBtn(accent, buttonText), ...noWrap, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <RefreshCw size={16} /> Reprogramar turno
                  </button>
                  <button onClick={handleCancel} disabled={busy} style={{ ...outlineBtn(c), ...noWrap, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, opacity: busy ? 0.6 : 1 }}>
                    <X size={16} /> Cancelar turno
                  </button>
                  <button onClick={smartCalendar} disabled={!start} style={{ ...outlineBtn(c), ...noWrap, cursor: start ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 8, opacity: start ? 1 : 0.55 }}>
                    <CalendarPlus size={16} /> Agregar al calendario
                  </button>
                </div>
                {showCalChooser ? (
                  <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                    <a href={googleUrl ?? "#"} target="_blank" rel="noreferrer" style={{ ...calBtn(c), ...noWrap }}>Google Calendar</a>
                    <button onClick={downloadIcs} style={{ ...calBtn(c), ...noWrap, cursor: "pointer", width: "100%" }}>Apple Calendar</button>
                    <a href={outlookUrl ?? "#"} target="_blank" rel="noreferrer" style={{ ...calBtn(c), ...noWrap }}>Outlook</a>
                  </div>
                ) : null}
              </>
            )}
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
