import * as React from "react";
import { createPortal } from "react-dom";
import { Lock, Loader2, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

// Mismos topes que valida el body de void/correct/delete_payment_authorized
// (20261025080000). Esto solo evita el viaje al servidor para el caso
// común (texto largo pegado); el backend es quien de verdad lo hace cumplir.
const REASON_MAX_LENGTH = 50;
// Quién hace el cambio no se pregunta: se registra la cuenta que tiene la sesión abierta.

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
  onSubmit: (
    password: string,
    reason: string,
    authorizedByName: string | null,
    performedByName: string | null,
  ) => Promise<void>;
}) {
  const [password, setPassword] = React.useState("");
  // Ojo para ver/ocultar la contraseña mientras se escribe.
  const [showPassword, setShowPassword] = React.useState(false);
  const [reason, setReason] = React.useState("");
  // Nombre de la cuenta con la sesión abierta (dueño/usuario): es quien queda registrado.
  const [performedByName, setPerformedByName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPassword("");
    setReason("");
    setError(null);
    setSubmitting(false);
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) return;
      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      const name = (prof?.full_name ?? "").trim() || (user.email ?? "").split("@")[0] || "Usuario";
      if (!cancelled) setPerformedByName(name.slice(0, 20));
    })();
    return () => {
      cancelled = true;
    };
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
      await onSubmit(password, reason.trim(), null, performedByName.trim() || null);
      setPassword("");
    } catch (e) {
      setError((e as Error).message || "No se pudo completar la operación");
    } finally {
      setSubmitting(false);
    }
  }

  const danger = tone === "danger";
  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/75 backdrop-blur-sm p-4"
      onClick={() => !submitting && onCancel()}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-[28px] border border-violet-400/45 bg-[#08070f] shadow-[0_0_0_1px_rgba(139,92,246,0.35),0_30px_90px_-20px_rgba(0,0,0,0.9),0_0_60px_-18px_rgba(139,92,246,0.55)] [background-image:radial-gradient(120%_45%_at_85%_0%,rgba(79,125,255,0.20),transparent_60%),radial-gradient(110%_50%_at_0%_100%,rgba(139,92,246,0.22),transparent_62%)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/10 px-5 py-4">
          <h3 className={cn("flex items-center gap-2 text-base font-semibold", danger ? "text-rose-300" : "text-white")}>
            <Lock className="size-4 shrink-0" />
            {title}
          </h3>
          {description && <div className="mt-1.5 text-xs leading-snug text-white/55">{description}</div>}
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-white">Contraseña de autorización</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConfirm();
                }}
                className="h-11 w-full rounded-full border border-white/10 bg-white/[0.04] pl-4 pr-12 text-sm text-white outline-none focus:border-violet-300/50"
                placeholder="••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                className="absolute inset-y-0 right-0 grid w-12 place-items-center text-white/50 transition hover:text-white"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-sm font-semibold text-white">Motivo</label>
              <span
                className={cn(
                  "text-[11px] tabular-nums",
                  reason.length >= REASON_MAX_LENGTH ? "text-amber-300" : "text-white/40",
                )}
              >
                {reason.length}/{REASON_MAX_LENGTH}
              </span>
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX_LENGTH))}
              maxLength={REASON_MAX_LENGTH}
              rows={2}
              className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none focus:border-violet-300/50"
              placeholder="Ej: se cobró de más por error de tipeo"
            />
          </div>
          {error && (
            <p className="flex items-start gap-1.5 text-xs font-semibold leading-snug text-rose-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2.5 border-t border-white/10 px-5 py-3.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="h-11 flex-1 rounded-full border border-white/[0.12] bg-white/[0.04] px-4 text-sm font-semibold text-white/80 transition hover:bg-white/[0.08] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className={cn(
              "inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-bold transition disabled:opacity-50",
              danger
                ? "border-rose-400/50 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
                : "border-violet-400/50 bg-violet-500/20 text-violet-100 hover:bg-violet-500/30",
            )}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
