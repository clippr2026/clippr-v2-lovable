import * as React from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, FileText, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SenaPendiente } from "./use-senas-pendientes";

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;

const fmtTurno = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const day = d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
  const hm = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} · ${hm} hs`;
};

const dateKey = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Día (Buenos Aires) de un instante: sirve para saber si el comprobante es de otro día que hoy.
const dayBA = (iso: string | Date) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

const fmtDayShort = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

const fmtSubida = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `Comprobante del ${d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "")} ${d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
};

function Row({ item, onDone }: { item: SenaPendiente; onDone: () => void }) {
  const [showProof, setShowProof] = React.useState(false);
  const [proof, setProof] = React.useState<{ mime: string; data: string } | null>(null);
  const [rejecting, setRejecting] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!showProof || proof) return;
    void (async () => {
      const { data } = await (supabase.from("appointment_deposit_proofs" as any) as any)
        .select("mime,data")
        .eq("deposit_id", item.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setProof(data as { mime: string; data: string });
      else toast.error("No hay comprobante guardado para esta seña.");
    })();
  }, [showProof, proof, item.id]);

  // Comprobante enviado otro día: igual cuenta (ingreso y dinero) el día en que se aprueba; solo se avisa.
  const otherDay = Boolean(item.proof_uploaded_at && dayBA(item.proof_uploaded_at) !== dayBA(new Date()));

  const review = async (approve: boolean) => {
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)("review_deposit_v1", {
        p_deposit_id: item.id,
        p_approve: approve,
        p_amount: null,
        p_note: approve ? null : note.trim(),
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "No se pudo completar la acción.");
      toast.success(
        approve
          ? otherDay
            ? "Seña aprobada. Entra en la primera caja abierta desde el día de la transferencia."
            : "Seña aprobada"
          : "Comprobante rechazado",
      );
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="space-y-3 rounded-2xl p-3.5"
      style={{
        background: "linear-gradient(180deg, rgba(139,92,246,0.10), rgba(255,255,255,0.025))",
        boxShadow: "inset 0 0 0 1px rgba(167,139,250,0.34)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-white">{item.client_name || "Sin cliente"}</div>
          <div className="truncate text-xs text-white/60">{item.service_name || "—"}</div>
        </div>
        <div
          className="shrink-0 rounded-full px-3 py-1 text-base font-bold text-white"
          style={{ background: "rgba(251,191,36,0.14)", boxShadow: "inset 0 0 0 1.5px rgba(251,191,36,0.6)" }}
        >
          {money(item.amount)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/65">
        <span>
          Turno: <strong className="text-white/90">{fmtTurno(item.starts_at)}</strong>
        </span>
        {item.proof_uploaded_at && <span>{fmtSubida(item.proof_uploaded_at)}</span>}
      </div>

      <button
        type="button"
        onClick={() => setShowProof((v) => !v)}
        className="flex h-11 w-full items-center justify-between rounded-2xl px-4 text-sm font-semibold text-violet-200 transition hover:brightness-125"
        style={{ background: "rgba(139,92,246,0.14)", boxShadow: "inset 0 0 0 1px rgba(167,139,250,0.5)" }}
      >
        <span className="flex items-center gap-2.5">
          <FileText className="h-4 w-4" /> {showProof ? "Ocultar comprobante" : "Ver comprobante"}
        </span>
        <ChevronRight className={`h-4 w-4 transition ${showProof ? "rotate-90" : ""}`} />
      </button>
      {showProof && proof && (
        <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
          {proof.mime === "application/pdf" ? (
            <a href={`data:application/pdf;base64,${proof.data}`} download="comprobante.pdf" className="block p-3 text-xs text-violet-300 underline">
              Descargar comprobante (PDF)
            </a>
          ) : (
            <img src={`data:${proof.mime};base64,${proof.data}`} alt="Comprobante de la seña" className="max-h-80 w-full bg-black/30 object-contain" />
          )}
        </div>
      )}

      {otherDay && item.proof_uploaded_at && (
        <div className="rounded-xl bg-sky-400/10 px-3 py-2 text-xs leading-snug text-sky-100 ring-1 ring-sky-300/30">
          Este comprobante se envió el <strong>{fmtDayShort(item.proof_uploaded_at)}</strong>. Al aprobarlo entra en la
          caja de ese día si sigue abierta; si ya se cerró o el local no abrió, pasa a la <strong>próxima caja abierta</strong>.
        </div>
      )}

      {!rejecting ? (
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => setRejecting(true)}
            className="flex h-11 items-center justify-center rounded-2xl text-sm font-semibold text-white/85 ring-1 ring-white/20 transition hover:bg-white/[0.06] disabled:opacity-60"
          >
            Rechazar seña
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void review(true)}
            className="flex h-11 items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #7c5cff, #4f7dff)", boxShadow: "0 0 22px rgba(99,102,241,.55), inset 0 0 0 1px rgba(255,255,255,.28)" }}
          >
            <CheckCircle2 className="h-4 w-4" /> Aprobar seña
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Motivo del rechazo (queda en el historial)"
            className="w-full resize-none rounded-lg bg-white/5 px-2.5 py-2 text-xs text-white outline-none ring-1 ring-white/10"
          />
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" onClick={() => setRejecting(false)} className="h-10 rounded-xl text-sm font-semibold text-white/80 ring-1 ring-white/20">
              Volver
            </button>
            <button
              type="button"
              disabled={busy || !note.trim()}
              onClick={() => void review(false)}
              className="h-10 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: "rgba(244,63,94,0.12)", color: "#fb7185", boxShadow: "inset 0 0 0 1.5px rgba(251,113,133,0.7)" }}
            >
              Rechazar
            </button>
          </div>
        </div>
      )}

      {item.starts_at && (
        <a href={`/agenda?date=${dateKey(item.starts_at)}`} className="block text-center text-xs font-medium text-white/50 underline-offset-2 hover:text-white/80 hover:underline">
          Abrir el turno en la Agenda
        </a>
      )}
    </div>
  );
}

/** Lista de señas con comprobante pendiente de revisión, sin importar la fecha del turno. */
export function SenasPendientesModal({
  open,
  onClose,
  items,
  loading,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  items: SenaPendiente[];
  loading: boolean;
  onChanged: () => void;
}) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-end bg-black/70 backdrop-blur-sm sm:place-items-center" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-[oklch(0.11_0.04_275)] p-4 shadow-2xl ring-1 ring-white/10 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Señas por revisar</h3>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        {loading ? (
          <div className="py-8 text-center text-sm text-white/50">Cargando…</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-sm text-white/55">No hay comprobantes por revisar.</div>
        ) : (
          <div className="space-y-3">
            {items.map((it) => (
              <Row key={it.id} item={it} onDone={onChanged} />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
