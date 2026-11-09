import * as React from "react";
import { DEFAULT_SENAS_MESSAGE } from "@/lib/senas-default-message";
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, Copy, MapPin, MessageCircle, RefreshCw, Upload, X } from "lucide-react";
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
  deposit?: Deposit | null;
  can_confirm: boolean; can_cancel: boolean; can_reschedule: boolean;
};

type Deposit = {
  id: string;
  status: "pending" | "review" | "paid" | "applied" | "to_decide" | "returned" | "retained" | "rejected" | "expired";
  amount: number;
  paid_amount: number;
  expires_at: string | null;
  rejected_note: string | null;
  instructions: {
    message: string | null;
    proof_mode: "review" | "auto";
    payment: { transfer?: { enabled?: boolean; alias?: string; cbu?: string; holder?: string; bank?: string } };
  } | null;
};

// Reduce la foto del comprobante (máx. 1400 px, JPEG) para que pese poco; los PDF van tal cual.
async function prepareProof(file: File): Promise<{ mime: string; data: string }> {
  const toB64 = (buf: ArrayBuffer) => {
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  if (file.type === "application/pdf") return { mime: file.type, data: toB64(await file.arrayBuffer()) };
  if (!file.type.startsWith("image/")) throw new Error("Subí una foto, una captura o un PDF.");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo preparar la imagen.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo preparar la imagen."))), "image/jpeg", 0.72));
  return { mime: "image/jpeg", data: toB64(await blob.arrayBuffer()) };
}

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
  // Mientras se pide la seña la página muestra solo el pago: sin reprogramar, cancelar ni accesos extra.
  const askingDeposit = Boolean(data.deposit && active && !past && (data.deposit.status === "pending" || data.deposit.status === "rejected"));
  const wa = waNumber(b.phone);
  const waMsg = (verb: string) => `Hola, quiero ${verb} mi turno del ${day} a las ${time} (${a.service_name}).`;
  const waUrl = (verb: string) => (wa ? `https://wa.me/${wa}?text=${encodeURIComponent(waMsg(verb))}` : null);
  const mapsUrl = b.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}` : null;
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${a.service_name} · ${b.name}`)}&dates=${icsStamp(start)}/${icsStamp(end)}${b.address ? `&location=${encodeURIComponent(b.address)}` : ""}`;

  const depositPending = !!data.deposit && ["pending", "rejected", "review"].includes(data.deposit.status);
  const statusChip = cancelled
    ? { text: "Cancelado", bg: "#fef2f2", fg: "#b91c1c" }
    : depositPending && active
      ? { text: data.deposit!.status === "review" ? "Seña en revisión" : "Seña pendiente", bg: "#fff7ed", fg: "#9a3412" }
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
            {askingDeposit && data.deposit ? (
              <div style={{ textAlign: "left" }}>
                <DepositSummary deposit={data.deposit} token={token} colors={c} onChanged={refresh} />
              </div>
            ) : (
              <span style={{ display: "inline-block", padding: "5px 11px", borderRadius: 999, background: statusChip.bg, color: statusChip.fg, fontSize: 12, fontWeight: 800 }}>{statusChip.text}</span>
            )}
            {!askingDeposit && (
              <>
                <h1 style={{ margin: "14px 0 2px", fontSize: 26, fontWeight: 800, letterSpacing: "-.02em" }}>{day}</h1>
                <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.02em", color: primary === "#000000" ? c.text : accent }}>{time}</div>
              </>
            )}
          </div>
          <div style={{ marginTop: 18, border: `1px solid ${c.border}`, background: c.innerBg, borderRadius: 16, padding: "6px 16px" }}>
            {[
              ["Servicio", a.service_name],
              ["Profesional", a.employee_name ?? "Sin preferencia"],
              ...(askingDeposit ? [["Día", day], ["Horario", time]] : []),
              [askingDeposit ? "Total del servicio" : "Total", money(Number(a.service_price) || 0)],
            ].map(([k, v], i) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 0", borderTop: i ? `1px solid ${c.border}` : "none", fontSize: 14 }}>
                <span style={{ color: c.muted }}>{k}</span>
                <span style={{ fontWeight: 700, textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </div>

          {data.deposit && active && !past && (
            <DepositCard deposit={data.deposit} token={token} colors={c} primaryBtn={primaryBtn} onChanged={refresh} />
          )}

          {notice && (
            <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 14, fontSize: 14, fontWeight: 600, background: notice.kind === "ok" ? "#ecfdf5" : "#fef2f2", color: notice.kind === "ok" ? "#047857" : "#b91c1c" }}>{notice.text}</div>
          )}

          {action === "confirmar" && data.can_confirm && !notice && (
            <p style={{ margin: "14px 0 0", textAlign: "center", color: c.muted, fontSize: 14 }}>Tocá el botón para confirmar que vas a venir.</p>
          )}

          <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
            {!askingDeposit && data.can_confirm && (
              <button
                disabled={busy}
                style={primaryBtn}
                onClick={() => run("confirm_public_booking_v2", { p_token: token }, () => setNotice({ kind: "ok", text: "¡Asistencia confirmada! Te esperamos." }))}
              >
                <Check size={18} /> Confirmar asistencia
              </button>
            )}
            {!askingDeposit && active && !past && data.can_reschedule && (
              <button disabled={busy} style={data.can_confirm ? ghostBtn : primaryBtn} onClick={() => { setNotice(null); setView("reschedule"); }}>
                <RefreshCw size={17} /> Reprogramar
              </button>
            )}
            {!askingDeposit && active && !past && data.can_cancel && view !== "cancel" && (
              <button disabled={busy} style={ghostBtn} onClick={() => setView("cancel")}>
                <X size={17} /> Cancelar turno
              </button>
            )}
            {!askingDeposit && view === "cancel" && (
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

          {!askingDeposit && policy && (
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

          {!askingDeposit && active && !past && (
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

function DepositCountdown({
  expiresAt, colors, onExpired,
}: {
  expiresAt: string;
  colors: { text: string; muted: string; border: string };
  onExpired: () => void;
}) {
  const target = React.useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [left, setLeft] = React.useState(() => target - Date.now());
  const firedRef = React.useRef(false);
  const onExpiredRef = React.useRef(onExpired);
  onExpiredRef.current = onExpired;
  React.useEffect(() => {
    const tick = () => {
      const ms = target - Date.now();
      setLeft(ms);
      if (ms <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpiredRef.current();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [target]);

  const total = Math.max(0, Math.floor(left / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const urgent = total <= 600;
  const tone = total === 0 ? "#dc2626" : urgent ? "#d97706" : "#7c3aed";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14, background: `${tone}1a`, border: `1px solid ${tone}55`, marginTop: 10 }}>
      <Clock size={22} color={tone} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: colors.muted, fontWeight: 600 }}>
          {total === 0 ? "Se agotó el tiempo" : "Tiempo para pagar la seña"}
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: tone, fontVariantNumeric: "tabular-nums", letterSpacing: 0.5, lineHeight: 1.1 }}>
          {h > 0 ? `${pad(h)}:` : ""}{pad(m)}:{pad(sec)}
        </div>
      </div>
    </div>
  );
}

// Las instrucciones guardadas pueden traer marcadores ([Alias], [CBU]…): se
// reemplazan por los datos reales para que el cliente no vea corchetes.
function fillDepositMessage(message: string, t?: { alias?: string; cbu?: string; holder?: string; bank?: string }, whatsapp?: string) {
  return message
    .replace(/\[Nombre\]/gi, t?.holder || "")
    .replace(/\[Titular\]/gi, t?.holder || "")
    .replace(/\[Alias\]/gi, t?.alias || "")
    .replace(/\[CBU[^\]]*\]/gi, t?.cbu || "")
    .replace(/\[Banco\]/gi, t?.bank || "")
    .replace(/\[WhatsApp[^\]]*\]/gi, whatsapp || "el WhatsApp del local");
}

function DepositSummary({
  deposit, token, colors, onChanged,
}: {
  deposit: Deposit;
  token: string;
  colors: { innerBg: string; border: string; text: string; muted: string };
  onChanged: () => Promise<void> | void;
}) {
  const money = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
  return (
    <div style={{ padding: "14px 14px", borderRadius: 16, border: `1px solid ${colors.border}`, background: colors.innerBg, fontSize: 14 }}>
      <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.1, margin: "2px 0" }}>Seña {money(deposit.amount)}</div>
      {deposit.expires_at && (
        <DepositCountdown expiresAt={deposit.expires_at} colors={colors} onExpired={() => void (async () => {
          try {
            await (supabase.rpc as any)("expire_deposit_public_v1", { p_token: token });
          } catch {
            /* el programador lo cancela igual */
          }
          await onChanged();
        })()} />
      )}
      <div style={{ color: colors.muted, fontSize: 12.5, marginTop: 8 }}>
        Si no enviás el comprobante antes de que termine el tiempo, el turno se cancela y el horario se libera.
      </div>
    </div>
  );
}

function DepositCard({
  deposit, token, colors, primaryBtn, onChanged,
}: {
  deposit: Deposit;
  token: string;
  colors: { innerBg: string; border: string; text: string; muted: string };
  primaryBtn: React.CSSProperties;
  onChanged: () => Promise<void> | void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const box: React.CSSProperties = { marginTop: 16, padding: "14px 14px", borderRadius: 16, border: `1px solid ${colors.border}`, background: colors.innerBg, fontSize: 14 };
  const money = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

  if (deposit.status === "paid" || deposit.status === "applied") {
    return <div style={{ ...box, background: "#ecfdf5", color: "#047857", borderColor: "#a7f3d0", fontWeight: 700 }}>✓ Seña recibida: {money(deposit.paid_amount)}</div>;
  }
  if (deposit.status === "review") {
    return <div style={{ ...box, color: colors.text }}><strong>Recibimos tu comprobante.</strong> Lo estamos revisando y te confirmamos tu turno en breve.</div>;
  }
  if (deposit.status === "expired") {
    return <div style={{ ...box, color: colors.muted }}>La seña no se pagó a tiempo, así que el turno puede liberarse. Contactá al local si todavía querés reservarlo.</div>;
  }
  if (deposit.status === "to_decide") {
    return <div style={{ ...box, color: colors.muted }}>El local está revisando qué pasa con tu seña. Te van a contactar.</div>;
  }
  if (deposit.status === "returned") {
    return <div style={{ ...box, color: colors.text }}>Te devolvimos la seña de {money(deposit.paid_amount)}.</div>;
  }
  if (deposit.status === "retained") {
    return <div style={{ ...box, color: colors.muted }}>La seña no se reintegra según las políticas del local.</div>;
  }

  const t = deposit.instructions?.payment?.transfer;
  const copy = async (label: string, value?: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* sin portapapeles: el valor igual está visible */
    }
  };
  const send = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const proof = await prepareProof(file);
      const { data, error } = await (supabase.rpc as any)("submit_deposit_proof_v2", {
        p_token: token, p_mime: proof.mime, p_data: proof.data, p_method: "transfer", p_reference: null,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "No se pudo enviar el comprobante.");
      setFile(null);
      await onChanged();
    } catch (e) {
      setErr((e as Error).message || "No se pudo enviar el comprobante.");
    } finally {
      setBusy(false);
    }
  };

  const row = (label: string, value?: string, copyable = true) =>
    value ? (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${colors.border}` }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: colors.muted, fontSize: 12 }}>{label}</div>
          <div style={{ fontWeight: 700, wordBreak: "break-all" }}>{value}</div>
        </div>
        {copyable && (
          <button type="button" onClick={() => void copy(label, value)} style={{ border: `1px solid ${colors.border}`, background: "transparent", color: colors.text, borderRadius: 10, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", gap: 6, alignItems: "center" }}>
            <Copy size={14} /> {copied === label ? "Copiado" : "Copiar"}
          </button>
        )}
      </div>
    ) : null;

  return (
    <div style={box}>
      {deposit.status === "rejected" && (
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 12, background: "#fef2f2", color: "#b91c1c", fontSize: 13.5, fontWeight: 600 }}>
          No pudimos validar tu comprobante{deposit.rejected_note ? `: ${deposit.rejected_note}` : "."} Subí uno nuevo.
        </div>
      )}
      {(deposit.instructions?.message?.trim() || DEFAULT_SENAS_MESSAGE) && (
        <details open style={{ marginTop: 10, color: colors.muted, fontSize: 13.5 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, color: colors.text }}>Condiciones de la seña</summary>
          <p style={{ margin: "8px 0 0", whiteSpace: "pre-line" }}>{fillDepositMessage(deposit.instructions?.message?.trim() || DEFAULT_SENAS_MESSAGE, t)}</p>
        </details>
      )}
      <div style={{ marginTop: 10 }}>
        {row("Alias", t?.alias)}
        {row("CBU / CVU", t?.cbu)}
        {row("Titular", t?.holder, false)}
        {row("Banco", t?.bank, false)}
      </div>
      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, padding: "13px 16px", borderRadius: 14, border: `1px dashed ${colors.border}`, color: colors.text, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
        <Upload size={17} /> {file ? file.name : "Subir comprobante"}
        <input type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => { setErr(null); setFile(e.target.files?.[0] ?? null); }} />
      </label>
      {err && <div style={{ marginTop: 8, color: "#dc2626", fontSize: 13, fontWeight: 600 }}>{err}</div>}
      <button type="button" disabled={!file || busy} onClick={() => void send()} style={{ ...primaryBtn, marginTop: 10, opacity: !file || busy ? 0.5 : 1 }}>
        {busy ? "Enviando…" : "Enviar comprobante"}
      </button>
    </div>
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
