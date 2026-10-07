import * as React from "react";
import { Mail, X, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export function ForgotPasswordModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  // Reset total al cerrar — así la próxima vez que se abra arranca limpio,
  // sin arrastrar el email o el estado "enviado" de un pedido anterior.
  function handleClose() {
    if (loading) return;
    onClose();
    setTimeout(() => {
      setEmail("");
      setError(null);
      setSent(false);
    }, 200);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError("Ingresá tu correo electrónico.");
      return;
    }
    setError(null);
    setLoading(true);

    // Mismo dominio que ya usan los links públicos de la app (booking,
    // fichaje): en dev el origin actual, en prod siempre myclippr.com — así
    // el link de recuperación nunca apunta a una preview URL de Vercel.
    const siteOrigin = import.meta.env.DEV ? window.location.origin : "https://myclippr.com";
    const { error: err } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${siteOrigin}/reset-password`,
    });
    setLoading(false);

    // Supabase ya no revela si el email existe (responde igual en ambos
    // casos) — un error acá es siempre un problema real (rate limit, etc.),
    // no una pista sobre si la cuenta existe.
    if (err) {
      setError(err.message);
      return;
    }
    setSent(true);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] grid place-items-center bg-black/70 backdrop-blur-sm px-4"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-sm rounded-[22px] p-6 backdrop-blur-2xl ring-1 ring-white/10 shadow-2xl"
        style={{
          background:
            "linear-gradient(180deg, oklch(0.18 0.045 285 / 0.9), oklch(0.075 0.03 280 / 0.95))",
          boxShadow: "0 28px 72px -30px oklch(0.52 0.25 285 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.065)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        {!sent ? (
          <>
            <h2 className="font-display text-lg font-semibold tracking-tight pr-6">
              Recuperar contraseña
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Ingresá tu correo y te enviaremos un enlace para crear una nueva
              contraseña.
            </p>

            <form onSubmit={onSubmit} className="mt-5 space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium tracking-wide text-white/55">
                  Correo electrónico
                </label>
                <div className="group relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70 transition-colors group-focus-within:text-primary" />
                  <input
                    type="email"
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ejemplo@correo.com"
                    disabled={loading}
                    className="h-12 w-full rounded-xl bg-white/[0.035] pl-10 pr-3 text-base outline-none ring-1 ring-white/10 transition placeholder:text-muted-foreground/50 focus:bg-white/[0.05] focus:ring-2 focus:ring-primary/55"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive ring-1 ring-destructive/25">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-sheen flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:-translate-y-px hover:brightness-110 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
                style={{
                  background: "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))",
                  boxShadow: "0 12px 30px -14px oklch(0.6 0.28 290 / 0.66), inset 0 1px 0 oklch(1 0 0 / 0.2)",
                }}
              >
                {loading ? "Enviando…" : "Enviar enlace"}
              </button>
            </form>
          </>
        ) : (
          <div className="pt-1 text-center">
            <div className="mx-auto h-12 w-12 rounded-full grid place-items-center bg-emerald-500/20 ring-1 ring-emerald-400/30">
              <Check className="h-6 w-6 text-emerald-300" strokeWidth={3} />
            </div>
            <p className="mt-3 text-sm">
              Te enviamos un enlace para recuperar tu contraseña. Revisá tu
              correo.
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-5 w-full rounded-xl bg-white/[0.05] hover:bg-white/[0.09] ring-1 ring-white/10 px-4 py-2.5 text-sm font-medium transition"
            >
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
