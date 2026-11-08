import * as React from "react";
import { CalendarPlus, Check, ChevronLeft, ChevronRight, MapPin, MessageCircle, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadRescheduleDays, type RescheduleDay } from "@/lib/gestion-availability";
import { contrastText, publicButtonStyle } from "@/lib/public-button";
import { DEFAULT_TIMEZONE } from "@/lib/availability";

type Booking = {
  ok: boolean;
  error?: string;
  appointment: {
    id: string; status: string; starts_at: string; ends_at: string; duration_min: number | null;
    service_name: string; service_price: number; client_name: string;
    employee_id: string; employee_name: string | null; branch_id: string | null; is_series: boolean;
  };
  business: {
    id: string; name: string; slug: string | null; address: string | null; phone: string | null;
    logo_url: string | null; accent_color: string | null; timezone: string | null; branding: Record<string, any> | null;
  };
  limits: { minCancel: number; minReschedule: number; minAdvance: number; maxAdvance: number };
  can_confirm: boolean; can_cancel: boolean; can_reschedule: boolean;
};

const isHex = (s: unknown): s is string => typeof s === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);
const icsStamp = (dt: Date) => dt.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
const money = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

function waNumber(phone?: string | null): string {
  let raw = String(phone ?? "").replace(/\D/g, "");
  if (!raw) return "";
  if (raw.startsWith("00")) raw = raw.slice(2);
  if (raw.startsWith("549")) return raw;
  if (raw.startsWith("54")) return `549${raw.slice(2).replace(/^0+/, "").replace(/^15/, "")}`;
  raw = raw.replace(/^0+/, "");
  if (raw.startsWith("15")) raw = `11${raw.slice(2)}`;
  return `549${raw}`;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const hoursLabel = (h: number) => (h === 1 ? "1 hora" : `${h} horas`);

export function ManageBooking({ token, action }: { token: string; action?: string }) {
  const [data, setData] = React.useState<Booking | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "missing">("loading");
  const [view, setView] = React.useState<"main" | "reschedule" | "cancel">("main");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const refresh = React.useCallback(async () => {
    const { data: res, error } = await (supabase.rpc as any)("get_public_booking_v2", { p_token: token });
    if (error || !res?.ok) {
      setState("missing");
      return;
    }
    setData(res as Booking);
    setState("ready");
  }, [token]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const brand = data?.business.branding ?? {};
  const colors = (brand.colors ?? {}) as Record<string, string>;
  const dark = brand.theme !== "light";
  const primary = isHex(colors.primary) ? colors.primary : isHex(colors.secondary) ? colors.secondary : isHex(data?.business.accent_color) ? (data!.business.accent_color as string) : "#7c3aed";
  const accent = isHex(colors.accent) ? colors.accent : primary;
  const buttonText = isHex(colors.buttonText) ? colors.buttonText : contrastText(accent);
  const c = {
    pageBg: dark ? "#08070c" : "#f6f7fb",
    cardBg: dark ? "#15131e" : "#ffffff",
    innerBg: dark ? "#1d1b27" : "#f8fafc",
    border: dark ? "#2c2937" : "#e6e8ee",
    text: dark ? "#f4f4f6" : "#0f172a",
    muted: dark ? "#a8a8b3" : "#64748b",
  };
  const tz = data?.business.timezone || DEFAULT_TIMEZONE;
  const primaryBtn = { ...publicButtonStyle(accent, buttonText), display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 18px", borderRadius: 14, fontSize: 15, fontWeight: 800, width: "100%", cursor: "pointer", textDecoration: "none", border: "none" } as React.CSSProperties;
  const ghostBtn: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px 16px", borderRadius: 14, border: `1px solid ${c.border}`, background: c.innerBg, color: c.text, fontSize: 14, fontWeight: 700, width: "100%", cursor: "pointer", textDecoration: "none" };

  const fireEmail = (type: "reschedule" | "cancellation") => {
    if (!data) return;
    void supabase.functions
      .invoke("send-booking-email", { body: { type, businessId: data.business.id, token, booking: { appointmentId: data.appointment.id } } })
      .catch((e) => console.error("send-booking-email", e));
  };

  async function run(fn: string, params: Record<string, unknown>, onOk: () => void) {
    setBusy(true);
    setNotice(null);
    try {
      const { data: res, error } = await (supabase.rpc as any)(fn, params);
      if (error) throw error;
      if (!res?.ok) {
        setNotice({ kind: "error", text: res?.error ?? "No se pudo completar la acción." });
        await refresh();
        setView("main");
        return;
      }
      onOk();
      await refresh();
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message || "No se pudo completar la acción." });
    } finally {
      setBusy(false);
    }
  }

  const frame = (children: React.ReactNode) => (
    <div style={{ minHeight: "100vh", background: c.pageBg, color: c.text, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", padding: "32px 16px 48px", colorScheme: dark ? "dark" : "light" }}>
      <div style={{ maxWidth: 440, margin: "0 auto" }}>{children}</div>
    </div>
  );

  if (state === "loading") return frame(<p style={{ textAlign: "center", color: c.muted, paddingTop: 80 }}>Cargando tu turno…</p>);
  if (state === "missing" || !data) {
    return frame(
      <div style={{ textAlign: "center", paddingTop: 80 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>No encontramos este turno</h1>
        <p style={{ color: c.muted, fontSize: 14, marginTop: 8 }}>El link puede estar incompleto. Escribile al local para gestionar tu turno.</p>
      </div>,
    );
  }

  const { appointment: a, business: b, limits } = data;
  const start = new Date(a.starts_at);
  const end = new Date(a.ends_at);
  const dayRaw = start.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: tz });
  const day = dayRaw.charAt(0).toUpperCase() + dayRaw.slice(1);
  const time = start.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }) + " hs";
  const active = a.status === "pending" || a.status === "confirmed";
  const past = start.getTime() <= Date.now();
  const cancelled = a.status === "cancelled";
  const wa = waNumber(b.phone);
  const waMsg = (verb: string) => `Hola, quiero ${verb} mi turno del ${day} a las ${time} (${a.service_name}).`;
  const waUrl = (verb: string) => (wa ? `https://wa.me/${wa}?text=${encodeURIComponent(waMsg(verb))}` : null);
  const mapsUrl = b.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}` : null;
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${a.service_name} · ${b.name}`)}&dates=${icsStamp(start)}/${icsStamp(end)}${b.address ? `&location=${encodeURIComponent(b.address)}` : ""}`;

  const statusChip = cancelled
    ? { text: "Cancelado", bg: "#fef2f2", fg: "#b91c1c" }
    : a.status === "confirmed"
      ? { text: "Confirmado", bg: "#ede9fe", fg: "#6d28d9" }
      : active
        ? { text: "Por confirmar", bg: "#eff6ff", fg: "#1d4ed8" }
        : { text: past ? "Finalizado" : a.status, bg: c.innerBg, fg: c.muted };

  const policy = active && !past && (!data.can_cancel || !data.can_reschedule);
  const policyText = !data.can_cancel && !data.can_reschedule
    ? `Ya pasó el plazo para cancelar (hasta ${hoursLabel(limits.minCancel)} antes) y reprogramar (hasta ${hoursLabel(limits.minReschedule)} antes) este turno desde acá.`
    : !data.can_cancel
      ? `Ya pasó el plazo para cancelar este turno desde acá (hasta ${hoursLabel(limits.minCancel)} antes).`
      : `Ya pasó el plazo para reprogramar este turno desde acá (hasta ${hoursLabel(limits.minReschedule)} antes).`;

  const header = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 22 }}>
      {b.logo_url ? (
        <img src={b.logo_url} alt={b.name} style={{ height: 44, width: 44, borderRadius: "50%", objectFit: "cover", boxShadow: `0 0 0 2px ${primary}` }} />
      ) : (
        <div style={{ height: 44, width: 44, borderRadius: "50%", display: "grid", placeItems: "center", background: primary, color: contrastText(primary), fontWeight: 800 }}>{b.name.slice(0, 1)}</div>
      )}
      <span style={{ fontSize: 18, fontWeight: 800 }}>{b.name}</span>
    </div>
  );

  const card = (children: React.ReactNode) => (
    <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 24, padding: 22, overflow: "hidden" }}>
      <div style={{ height: 4, margin: "-22px -22px 20px", background: `linear-gradient(90deg, ${primary}, ${accent})` }} />
      {children}
    </div>
  );

  if (view === "reschedule") {
    return frame(
      <>
        {header}
        {card(
          <RescheduleView
            data={data}
            colors={{ ...c, accent, buttonText }}
            busy={busy}
            onBack={() => setView("main")}
            onPick={(when) =>
              run("reschedule_public_booking_v2", { p_token: token, p_starts_at: when.toISOString() }, () => {
                fireEmail("reschedule");
                setNotice({ kind: "ok", text: "¡Listo! Reprogramamos tu turno. Te mandamos un correo con el nuevo horario." });
                setView("main");
              })
            }
          />,
        )}
      </>,
    );
  }

  return frame(
    <>
      {header}
      {card(
        <>
          <div style={{ textAlign: "center" }}>
            <span style={{ display: "inline-block", padding: "5px 11px", borderRadius: 999, background: statusChip.bg, color: statusChip.fg, fontSize: 12, fontWeight: 800 }}>{statusChip.text}</span>
            <h1 style={{ margin: "14px 0 2px", fontSize: 26, fontWeight: 800, letterSpacing: "-.02em" }}>{day}</h1>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.02em", color: primary === "#000000" ? c.text : accent }}>{time}</div>
          </div>
          <div style={{ marginTop: 18, border: `1px solid ${c.border}`, background: c.innerBg, borderRadius: 16, padding: "6px 16px" }}>
            {[["Servicio", a.service_name], ["Profesional", a.employee_name ?? "Sin preferencia"], ["Total", money(Number(a.service_price) || 0)]].map(([k, v], i) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 0", borderTop: i ? `1px solid ${c.border}` : "none", fontSize: 14 }}>
                <span style={{ color: c.muted }}>{k}</span>
                <span style={{ fontWeight: 700, textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </div>

          {notice && (
            <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 14, fontSize: 14, fontWeight: 600, background: notice.kind === "ok" ? "#ecfdf5" : "#fef2f2", color: notice.kind === "ok" ? "#047857" : "#b91c1c" }}>{notice.text}</div>
          )}

          {action === "confirmar" && data.can_confirm && !notice && (
            <p style={{ margin: "14px 0 0", textAlign: "center", color: c.muted, fontSize: 14 }}>Tocá el botón para confirmar que vas a venir.</p>
          )}

          <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
            {data.can_confirm && (
              <button
                disabled={busy}
                style={primaryBtn}
                onClick={() => run("confirm_public_booking_v2", { p_token: token }, () => setNotice({ kind: "ok", text: "¡Asistencia confirmada! Te esperamos." }))}
              >
                <Check size={18} /> Confirmar asistencia
              </button>
            )}
            {active && !past && data.can_reschedule && (
              <button disabled={busy} style={data.can_confirm ? ghostBtn : primaryBtn} onClick={() => { setNotice(null); setView("reschedule"); }}>
                <RefreshCw size={17} /> Reprogramar
              </button>
            )}
            {active && !past && data.can_cancel && view !== "cancel" && (
              <button disabled={busy} style={ghostBtn} onClick={() => setView("cancel")}>
                <X size={17} /> Cancelar turno
              </button>
            )}
            {view === "cancel" && (
              <div style={{ border: `1px solid ${c.border}`, borderRadius: 14, padding: 14, background: c.innerBg }}>
                <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700 }}>¿Seguro que querés cancelar este turno?</p>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                  <button disabled={busy} style={ghostBtn} onClick={() => setView("main")}>No, volver</button>
                  <button
                    disabled={busy}
                    style={{ ...ghostBtn, background: "#dc2626", color: "#fff", border: "none" }}
                    onClick={() => run("cancel_public_booking_v2", { p_token: token }, () => { fireEmail("cancellation"); setView("main"); setNotice({ kind: "ok", text: "Tu turno fue cancelado." }); })}
                  >
                    Sí, cancelar
                  </button>
                </div>
              </div>
            )}
          </div>

          {policy && (
            <div style={{ marginTop: 14, padding: "13px 14px", borderRadius: 14, border: `1px solid ${c.border}`, background: c.innerBg, fontSize: 13.5, lineHeight: 1.5, color: c.muted }}>
              <strong style={{ color: c.text }}>Política del local.</strong> {policyText} Para hacer cambios, contactá directamente al local.
              {waUrl("hacer un cambio en") && (
                <a href={waUrl("hacer un cambio en")!} target="_blank" rel="noreferrer" style={{ ...ghostBtn, marginTop: 10 }}>
                  <MessageCircle size={17} /> Escribir por WhatsApp
                </a>
              )}
            </div>
          )}

          {cancelled && (
            <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
              {b.slug && <a href={`/reservar/${b.slug}`} style={primaryBtn}>Reservar un nuevo turno</a>}
            </div>
          )}

          {active && !past && (
            <div style={{ display: "grid", gap: 10, marginTop: 14, gridTemplateColumns: mapsUrl && wa ? "1fr 1fr" : "1fr" }}>
              <a href={gcal} target="_blank" rel="noreferrer" style={{ ...ghostBtn, gridColumn: "1 / -1" }}><CalendarPlus size={17} /> Agregar al calendario</a>
              {mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer" style={ghostBtn}><MapPin size={17} /> Cómo llegar</a>}
              {wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" style={ghostBtn}><MessageCircle size={17} /> WhatsApp</a>}
            </div>
          )}
          {!cancelled && !active && (
            <p style={{ textAlign: "center", color: c.muted, fontSize: 14, marginTop: 16 }}>Este turno ya no admite cambios.</p>
          )}
          {active && past && (
            <p style={{ textAlign: "center", color: c.muted, fontSize: 14, marginTop: 16 }}>Este turno ya pasó.</p>
          )}
        </>,
      )}
    </>,
  );
}

function RescheduleView({
  data, colors, busy, onBack, onPick,
}: {
  data: Booking;
  colors: { innerBg: string; border: string; text: string; muted: string; accent: string; buttonText: string };
  busy: boolean;
  onBack: () => void;
  onPick: (when: Date) => void;
}) {
  const a = data.appointment;
  const tz = data.business.timezone || DEFAULT_TIMEZONE;
  const [days, setDays] = React.useState<RescheduleDay[] | null>(null);
  const [selected, setSelected] = React.useState<number>(0);
  const [month, setMonth] = React.useState<Date | null>(null);
  const [slot, setSlot] = React.useState<Date | null>(null);

  React.useEffect(() => {
    let off = false;
    void loadRescheduleDays({
      businessId: data.business.id,
      branchId: a.branch_id,
      employeeId: a.employee_id,
      appointmentId: a.id,
      durationMin: a.duration_min ?? 30,
      timeZone: tz,
      minAdvance: data.limits.minAdvance,
      maxAdvance: data.limits.maxAdvance,
    }).then((d) => {
      if (off) return;
      setDays(d);
      if (d[0]) setMonth(new Date(d[0].date.getFullYear(), d[0].date.getMonth(), 1));
    });
    return () => { off = true; };
  }, [data, a, tz]);

  const hhmm = (d: Date) => d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
  const chip = (on: boolean, off = false): React.CSSProperties => ({
    padding: "10px 0", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: off ? "default" : "pointer", textAlign: "center",
    border: `1px solid ${on ? colors.accent : colors.border}`, background: on ? colors.accent : colors.innerBg,
    color: on ? colors.buttonText : off ? colors.muted : colors.text, opacity: off ? 0.35 : 1,
  });

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <button onClick={onBack} aria-label="Volver" style={{ background: "none", border: "none", color: colors.text, cursor: "pointer", padding: 4 }}><ChevronLeft size={22} /></button>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Elegí el nuevo horario</h1>
    </div>
  );

  if (!days) return <>{header}<p style={{ color: colors.muted, textAlign: "center", padding: "30px 0" }}>Buscando horarios…</p></>;
  if (days.length === 0 || !month) {
    return <>{header}<p style={{ color: colors.muted, textAlign: "center", padding: "24px 0", fontSize: 14 }}>No hay horarios disponibles para reprogramar. Contactá al local.</p></>;
  }

  const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const byKey = new Map(days.map((d, i) => [keyOf(d.date), i]));
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  const day = days[selected] ?? days[0];

  return (
    <>
      {header}
      <p style={{ margin: "0 0 14px", color: colors.muted, fontSize: 13.5 }}>{a.service_name} · {a.employee_name ?? "Profesional"}</p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mes anterior" style={{ background: "none", border: "none", color: colors.text, cursor: "pointer" }}><ChevronLeft size={20} /></button>
        <strong>{cap(month.toLocaleDateString("es-AR", { month: "long", year: "numeric" }).replace(" de ", " "))}</strong>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Mes siguiente" style={{ background: "none", border: "none", color: colors.text, cursor: "pointer" }}><ChevronRight size={20} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, textAlign: "center", fontSize: 11, color: colors.muted, marginBottom: 6 }}>
        {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
        {cells.map((n, i) => {
          if (n === null) return <span key={i} />;
          const idx = byKey.get(keyOf(new Date(month.getFullYear(), month.getMonth(), n)));
          const ok = idx !== undefined;
          return (
            <button key={i} disabled={!ok} onClick={() => { if (ok) { setSelected(idx); setSlot(null); } }} style={{ ...chip(ok && idx === selected, !ok), padding: "9px 0" }}>
              {n}
            </button>
          );
        })}
      </div>
      <p style={{ margin: "16px 0 8px", fontSize: 13, color: colors.muted }}>
        {cap(day.date.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }))}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {day.slots.map((s) => (
          <button key={s.getTime()} onClick={() => setSlot(s)} style={chip(slot?.getTime() === s.getTime())}>{hhmm(s)}</button>
        ))}
      </div>
      <button
        disabled={!slot || busy}
        onClick={() => slot && onPick(slot)}
        style={{ marginTop: 18, width: "100%", padding: "14px 18px", borderRadius: 14, border: "none", fontSize: 15, fontWeight: 800, cursor: slot ? "pointer" : "default", opacity: slot ? 1 : 0.45, background: colors.accent, color: colors.buttonText }}
      >
        {busy ? "Reprogramando…" : "Confirmar nuevo horario"}
      </button>
    </>
  );
}
