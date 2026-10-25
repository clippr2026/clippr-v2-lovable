import * as React from "react";
import { createPortal } from "react-dom";
import { Lock, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Modal compartido de contraseña de autorización — lo usan tanto "Corregir
 * cobro" como "Anular venta" (DetailModal, cash-register.tsx), en las dos
 * pantallas (Movimientos de caja y Cierre de caja → Revisar cierre). Pide
 * contraseña + motivo (obligatorio) y llama a `onSubmit`, que es quien
 * ejecuta el RPC real (voidPaymentAuthorized/correctPaymentAuthorized,
 * caja-authorization.ts) — este componente no sabe ni le importa cuál.
 *
 * Cada submit es una llamada nueva: la contraseña nunca se guarda ni se
 * reutiliza entre intentos (ni siquiera en este mismo componente, se borra
 * del state apenas se cierra) — "cada autorización se usa para una sola
 * operación", tal cual lo pidieron.
 */
export function AuthorizationModal({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  tone = "default",
  onCancel,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  tone?: "default" | "danger";
  onCancel: () => void;
  onSubmit: (password: string, reason: string) => Promise<void>;
}) {
  const [password, setPassword] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setPassword("");
      setReason("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  async function handleConfirm() {
    if (!password.trim()) {
      setError("Ingresá la contraseña de autorización.");
      return;
    }
    if (!reason.trim()) {
      setError("El motivo es obligatorio.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(password, reason.trim());
      setPassword("");
    } catch (e) {
      setError((e as Error).message || "No se pudo completar la operación");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => !submitting && onCancel()}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/10 px-5 py-4">
          <h3
            className={cn(
              "flex items-center gap-2 text-sm font-semibold",
              tone === "danger" ? "text-red-300" : "text-amber-200",
            )}
          >
            <Lock className="size-4 shrink-0" />
            {title}
          </h3>
          {description && <div className="mt-1 text-[11px] text-muted-foreground">{description}</div>}
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold tracking-[0.1em] text-muted-foreground/70">
              CONTRASEÑA DE AUTORIZACIÓN
            </label>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirm();
              }}
              className="h-10 w-full rounded-xl border border-white/10 bg-black/45 px-3 text-sm text-white outline-none focus:border-blue-300/50 focus:ring-2 focus:ring-blue-400/20"
              placeholder="••••••"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold tracking-[0.1em] text-muted-foreground/70">
              MOTIVO
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-white outline-none focus:border-blue-300/50 focus:ring-2 focus:ring-blue-400/20"
              placeholder="Ej: se cobró de más por error de tipeo"
            />
          </div>
          {error && (
            <p className="flex items-start gap-1.5 text-[11px] font-semibold leading-snug text-red-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-white/10 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 rounded-xl bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold ring-1 transition disabled:opacity-50",
              tone === "danger"
                ? "bg-red-400/15 hover:bg-red-400/25 text-red-100 ring-red-400/30"
                : "bg-amber-400/15 hover:bg-amber-400/25 text-amber-100 ring-amber-400/30",
            )}
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
