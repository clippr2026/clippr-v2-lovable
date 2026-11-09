import * as React from "react";
import { toast } from "sonner";
import { ChevronRight, CheckCircle2, FileText, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type DepositRow = {
  id: string;
  status: "pending" | "review" | "paid" | "applied" | "to_decide" | "returned" | "retained" | "rejected" | "expired";
  amount: number;
  paid_amount: number;
  method: string | null;
  proof_path: string | null;
  suggested_action: "refund" | "retain" | null;
  refund_amount: number;
  retained_prof_amount: number;
  retained_local_amount: number;
  decision_note: string | null;
  prof_share_paid_at: string | null;
  prof_share_method: string | null;
};

const STATUS_LABEL: Record<DepositRow["status"], { text: string; cls: string }> = {
  pending: { text: "🟡 Seña pendiente de pago", cls: "text-amber-300" },
  review: { text: "🟠 Comprobante a revisar", cls: "text-orange-300" },
  paid: { text: "🟢 Seña recibida", cls: "text-emerald-300" },
  applied: { text: "🟢 Seña aplicada al cobro", cls: "text-emerald-300" },
  to_decide: { text: "⚠️ Seña a decidir", cls: "text-amber-300" },
  returned: { text: "🔵 Seña devuelta", cls: "text-sky-300" },
  retained: { text: "🔴 Seña retenida", cls: "text-rose-300" },
  rejected: { text: "🔴 Comprobante rechazado", cls: "text-rose-300" },
  expired: { text: "⚪ Seña vencida", cls: "text-muted-foreground" },
};

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;

type Dist = "local" | "professional" | "split" | "custom";

/**
 * Seña de un turno dentro de la ficha de la Agenda: ver el comprobante, aprobar o
 * rechazar, registrar una seña recibida en el local y decidir qué pasa con una seña
 * de un turno cancelado / que no asistió. Todo pasa por las funciones de la base
 * (permisos y reglas se validan allá).
 */
export function DepositPanel({
  appointmentId,
  status,
  isPast,
  onChanged,
  onCancelAppointment,
}: {
  appointmentId: string;
  status: string;
  isPast: boolean;
  onChanged: () => void;
  /** Cancela el turno con el motivo indicado (ej. comprobante rechazado). */
  onCancelAppointment?: (reason: string) => void;
}) {
  const [dep, setDep] = React.useState<DepositRow | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [senasEnabled, setSenasEnabled] = React.useState(false);
  const [defaultDist, setDefaultDist] = React.useState<{ dist: Dist; prof: number }>({ dist: "local", prof: 0 });
  const [busy, setBusy] = React.useState(false);
  const [proof, setProof] = React.useState<{ mime: string; data: string } | null>(null);
  const [showProof, setShowProof] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<"cash" | "transfer">("cash");
  const [recording, setRecording] = React.useState(false);
  const [dist, setDist] = React.useState<Dist>("local");
  const [customProf, setCustomProf] = React.useState(50);
  const [shareMethod, setShareMethod] = React.useState<"cash" | "transfer">("cash");

  const load = React.useCallback(async () => {
    const [{ data: row }, { data: appt }] = await Promise.all([
      (supabase.from("appointment_deposits" as any) as any)
        .select("id,status,amount,paid_amount,method,proof_path,suggested_action,refund_amount,retained_prof_amount,retained_local_amount,decision_note,prof_share_paid_at,prof_share_method")
        .eq("appointment_id", appointmentId)
        .maybeSingle(),
      supabase.from("appointments").select("business_id").eq("id", appointmentId).maybeSingle(),
    ]);
    setDep((row as DepositRow | null) ?? null);
    if (appt?.business_id) {
      const { data: st } = await supabase.from("business_settings").select("senas_config").eq("business_id", appt.business_id as string).maybeSingle();
      const cfg = ((st as any)?.senas_config ?? {}) as Record<string, any>;
      setSenasEnabled(!!cfg.enabled);
      const d: Dist = ["local", "professional", "split", "custom"].includes(cfg.lost_dist) ? cfg.lost_dist : "local";
      setDefaultDist({ dist: d, prof: Number(cfg.lost_prof) || 0 });
      setDist(d);
      setCustomProf(d === "custom" ? Number(cfg.lost_prof) || 0 : 50);
    }
    setLoaded(true);
  }, [appointmentId]);

  React.useEffect(() => {
    setLoaded(false);
    setDep(null);
    setProof(null);
    setShowProof(false);
    setRejecting(false);
    setRecording(false);
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!showProof || !dep?.id || proof) return;
    void (async () => {
      const { data } = await (supabase.from("appointment_deposit_proofs" as any) as any)
        .select("mime,data")
        .eq("deposit_id", dep.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setProof(data as { mime: string; data: string });
      else toast.error("No hay comprobante guardado para esta seña.");
    })();
  }, [showProof, dep?.id, proof]);

  const run = async (fn: string, params: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)(fn, params);
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "No se pudo completar la acción.");
      toast.success(okMsg);
      setRejecting(false);
      setRecording(false);
      setNote("");
      await load();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;

  // Sin seña: solo se ofrece registrar una recibida (turno vigente y señas activadas).
  if (!dep) {
    if (!senasEnabled || isPast || !["pending", "confirmed"].includes(status)) return null;
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 text-sm">
        {!recording ? (
          <Button variant="secondary" className="h-9 w-full" onClick={() => setRecording(true)}>
            Registrar seña recibida
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="font-semibold">Registrar seña recibida</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Monto ($)"
                className="rounded-lg bg-white/5 px-2.5 py-2 text-sm ring-1 ring-white/10 outline-none"
              />
              <select value={method} onChange={(e) => setMethod(e.target.value as "cash" | "transfer")} className="rounded-lg bg-white/5 px-2.5 py-2 text-sm ring-1 ring-white/10 outline-none">
                <option value="cash">Efectivo</option>
                <option value="transfer">Transferencia</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" className="h-9" onClick={() => setRecording(false)}>Volver</Button>
              <Button
                className="h-9"
                disabled={busy || !(Number(amount) > 0)}
                onClick={() => run("record_deposit_received_v1", { p_appointment_id: appointmentId, p_amount: Number(amount), p_method: method, p_note: null }, "Seña registrada")}
              >
                Guardar
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const info = STATUS_LABEL[dep.status];
  const prof = dist === "professional" ? 100 : dist === "split" ? 50 : dist === "custom" ? customProf : 0;

  return (
    <div
      className="rounded-2xl p-3 text-sm space-y-2.5"
      style={{
        background: "linear-gradient(180deg, rgba(139,92,246,0.10), rgba(255,255,255,0.025))",
        boxShadow: "inset 0 0 0 1px rgba(167,139,250,0.34), 0 18px 36px -28px rgba(139,92,246,0.9)",
      }}
    >
      <div className="flex items-center gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-amber-300"
          style={{ background: "rgba(251,191,36,0.16)", boxShadow: "inset 0 0 0 1px rgba(251,191,36,0.4)" }}
        >
          <Layers className="h-4 w-4" />
        </span>
        <div className={`text-lg font-bold tracking-tight text-white`}>{info.text.replace(/^\S+\s/, "")}</div>
      </div>
      <div className="text-muted-foreground">
        Seña pedida: <span className="font-medium text-foreground">{money(dep.amount)}</span>
        {dep.paid_amount > 0 && (
          <>
            {" · "}Recibida: <span className="font-medium text-foreground">{money(dep.paid_amount)}</span>
          </>
        )}
        {dep.method && <span> · {dep.method === "transfer" ? "Transferencia" : dep.method === "cash" ? "Efectivo" : dep.method}</span>}
      </div>

      {dep.proof_path && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowProof((v) => !v)}
            className="flex h-11 w-full items-center justify-between gap-2 rounded-2xl px-4 text-[14px] font-semibold text-violet-200 transition hover:brightness-125 active:scale-[0.99]"
            style={{
              background: "rgba(139,92,246,0.14)",
              boxShadow: "inset 0 0 0 1px rgba(167,139,250,0.5), 0 10px 22px -18px rgba(139,92,246,0.9)",
            }}
          >
            <span className="flex items-center gap-3"><FileText className="h-5 w-5" /> {showProof ? "Ocultar comprobante" : "Ver comprobante"}</span>
            <ChevronRight className={`h-5 w-5 transition ${showProof ? "rotate-90" : ""}`} />
          </button>
          {showProof && proof && (
            <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
              {proof.mime === "application/pdf" ? (
                <a href={`data:application/pdf;base64,${proof.data}`} download="comprobante.pdf" className="block p-3 text-xs text-violet-300 underline">
                  Descargar comprobante (PDF)
                </a>
              ) : (
                <img src={`data:${proof.mime};base64,${proof.data}`} alt="Comprobante de la seña" className="max-h-80 w-full object-contain bg-black/30" />
              )}
            </div>
          )}
        </div>
      )}

      {(dep.status === "review" || dep.status === "pending") && !rejecting && (
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => setRejecting(true)}
            className="flex h-11 items-center justify-center rounded-2xl text-[14px] font-semibold text-white/85 transition hover:brightness-125 active:scale-[0.99] disabled:opacity-60"
            style={{
              background: "linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.16)",
            }}
          >
            Rechazar seña
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run("review_deposit_v1", { p_deposit_id: dep.id, p_approve: true, p_amount: null, p_note: null }, "Seña aprobada")}
            className="flex h-11 items-center justify-center gap-2 rounded-2xl text-[14px] font-bold text-white transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
            style={{
              background: "linear-gradient(135deg, #7c5cff, #4f7dff)",
              boxShadow: "0 0 24px rgba(99,102,241,.6), inset 0 0 0 1px rgba(255,255,255,.28)",
            }}
          >
            <CheckCircle2 className="h-5 w-5" /> Aprobar seña
          </button>
        </div>
      )}
      {rejecting && (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Motivo (lo ve el cliente)"
            className="w-full resize-none rounded-lg bg-white/5 px-2.5 py-2 text-xs ring-1 ring-white/10 outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="h-9" onClick={() => setRejecting(false)}>Volver</Button>
            <Button variant="destructive" className="h-9" disabled={busy || !note.trim()} onClick={() => run("review_deposit_v1", { p_deposit_id: dep.id, p_approve: false, p_amount: null, p_note: note.trim() }, "Comprobante rechazado")}>
              Rechazar
            </Button>
          </div>
        </div>
      )}

      {dep.status === "to_decide" && (
        <div className="space-y-2.5 rounded-xl bg-amber-300/10 p-3 ring-1 ring-amber-300/25">
          <div className="text-xs text-amber-100">
            {dep.suggested_action === "refund"
              ? "El cliente canceló dentro del plazo: se sugiere devolver la seña."
              : "Se pasó el plazo o el cliente no asistió: se sugiere retener la seña. Elegí qué hacer."}
          </div>
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Si la retenés, ¿para quién es?</div>
            <div className="grid grid-cols-2 gap-1.5">
              {([["local", "Local"], ["professional", "Barbero"], ["split", "Mitad y mitad"], ["custom", "Otro %"]] as const).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDist(k)}
                  className={`rounded-lg px-2 py-1.5 text-xs font-semibold ring-1 ${dist === k ? "bg-violet-500/25 ring-violet-400/60" : "bg-white/5 ring-white/10"}`}
                >
                  {l}
                </button>
              ))}
            </div>
            {dist === "custom" && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span>Barbero</span>
                <input type="number" min={0} max={100} value={customProf} onChange={(e) => setCustomProf(Math.min(100, Math.max(0, Number(e.target.value))))} className="w-20 rounded-lg bg-white/5 px-2 py-1.5 ring-1 ring-white/10 outline-none" />
                <span>% · Local {100 - customProf}%</span>
              </div>
            )}
            <div className="mt-1 text-[11px] text-muted-foreground">
              Barbero {money((dep.paid_amount * prof) / 100)} · Local {money(dep.paid_amount - (dep.paid_amount * prof) / 100)}
              {defaultDist.dist !== dist ? " (distinto al reparto configurado)" : ""}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="h-9" disabled={busy} onClick={() => run("decide_deposit_v1", { p_deposit_id: dep.id, p_action: "refund", p_prof_pct: null, p_local_pct: null, p_note: null }, "Seña marcada como devuelta")}>
              Devolver seña
            </Button>
            <Button variant="destructive" className="h-9" disabled={busy} onClick={() => run("decide_deposit_v1", { p_deposit_id: dep.id, p_action: "retain", p_prof_pct: prof, p_local_pct: 100 - prof, p_note: null }, "Seña retenida")}>
              Retener seña
            </Button>
          </div>
          <div className="text-[11px] text-muted-foreground">Recibir la seña la suma a Caja; devolverla la resta. Retenerla no mueve plata.</div>
        </div>
      )}

      {dep.status === "returned" && <div className="text-xs text-muted-foreground">Devuelta: {money(dep.refund_amount)}</div>}
      {dep.status === "retained" && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            Retenida: barbero {money(dep.retained_prof_amount)} · local {money(dep.retained_local_amount)}
          </div>
          {dep.retained_prof_amount > 0 && !dep.prof_share_paid_at && (
            <div className="space-y-2 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
              <div className="text-xs">
                La parte del barbero ({money(dep.retained_prof_amount)}) se paga acá, aparte de su liquidación. Sale de Caja.
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={shareMethod} onChange={(e) => setShareMethod(e.target.value as "cash" | "transfer")} className="rounded-lg bg-white/5 px-2.5 py-2 text-sm ring-1 ring-white/10 outline-none">
                  <option value="cash">En efectivo</option>
                  <option value="transfer">Por transferencia</option>
                </select>
                <Button className="h-9" disabled={busy} onClick={() => run("pay_deposit_prof_share_v1", { p_deposit_id: dep.id, p_method: shareMethod }, "Parte del barbero pagada")}>
                  Pagar parte
                </Button>
              </div>
            </div>
          )}
          {dep.prof_share_paid_at && (
            <div className="text-xs text-emerald-300">
              ✓ Parte del barbero pagada ({dep.prof_share_method === "cash" ? "efectivo" : "transferencia"}) el{" "}
              {new Date(dep.prof_share_paid_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
            </div>
          )}
        </div>
      )}
      {dep.status === "rejected" && (
        <div className="space-y-2.5">
          <div className="text-xs text-muted-foreground">
            El cliente ya no puede volver a subir el comprobante: se comunica con el local. Si te confirma el pago, registrá la seña recibida; si no, cancelá el turno.
          </div>
          {!recording && !isPast && onCancelAppointment && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onCancelAppointment("Comprobante rechazado")}
              className="flex h-11 w-full items-center justify-center rounded-2xl text-[14px] font-semibold transition hover:brightness-125 active:scale-[0.99] disabled:opacity-60"
              style={{ background: "rgba(244,63,94,0.10)", color: "#fb7185", boxShadow: "inset 0 0 0 1.5px rgba(251,113,133,0.7)" }}
            >
              Cancelar turno por comprobante rechazado
            </button>
          )}
          {!recording ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => { setAmount(String(Math.round(dep.amount))); setRecording(true); }}
              className="flex h-11 w-full items-center justify-center rounded-2xl text-[14px] font-bold text-white transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #7c5cff, #4f7dff)", boxShadow: "0 0 24px rgba(99,102,241,.5), inset 0 0 0 1px rgba(255,255,255,.28)" }}
            >
              Registrar seña recibida
            </button>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto ($)" className="rounded-lg bg-white/5 px-2.5 py-2 text-sm ring-1 ring-white/10 outline-none" />
                <select value={method} onChange={(e) => setMethod(e.target.value as "cash" | "transfer")} className="rounded-lg bg-white/5 px-2.5 py-2 text-sm ring-1 ring-white/10 outline-none">
                  <option value="cash">Efectivo</option>
                  <option value="transfer">Transferencia</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" className="h-10" onClick={() => setRecording(false)}>Volver</Button>
                <Button className="h-10" disabled={busy || !(Number(amount) > 0)} onClick={() => run("record_deposit_received_v1", { p_appointment_id: appointmentId, p_amount: Number(amount), p_method: method, p_note: null }, "Seña registrada")}>Guardar</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
