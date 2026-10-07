import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Lock, Eye, EyeOff, Check, ShieldCheck, MailWarning } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Recuperar contraseña — Clippr" },
      { name: "description", content: "Creá una nueva contraseña para tu cuenta de Clippr." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = React.useState(false);
  // Link vencido (#error_code=otp_expired) o directamente inválido (sin
  // tokens, o la sesión nunca llegó a establecerse) — mismo mensaje para
  // los dos casos, no hay nada distinto que decirle al usuario en ninguno.
  const [invalid, setInvalid] = React.useState(false);
  const [email, setEmail] = React.useState<string | null>(null);
  const [pwd, setPwd] = React.useState("");
  const [pwd2, setPwd2] = React.useState("");
  const [showPwd, setShowPwd] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState(false);

  // El link de recuperación de Supabase puede llegar como hash
  // (#access_token=...) o como code (?code=...), igual que la invitación de
  // /set-password — mismo manejo manual acá, por las mismas razones (algunos
  // navegadores de mobile no disparan detectSessionInUrl de forma consistente).
  React.useEffect(() => {
    let active = true;
    let validationTimer: ReturnType<typeof setTimeout> | null = null;

    async function hydrateRecoverySession() {
      try {
        setError(null);

        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

        const errorCode = hash.get("error_code");
        if (errorCode === "otp_expired") {
          if (!active) return;
          setInvalid(true);
          return;
        }

        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          await supabase.auth.exchangeCodeForSession(code);
        }

        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          window.history.replaceState({}, document.title, window.location.pathname);
        }

        const { data } = await supabase.auth.getSession();
        if (!active) return;
        if (data.session?.user) {
          setEmail(data.session.user.email ?? null);
          setReady(true);
        }
      } catch {
        if (!active) return;
        setInvalid(true);
      }
    }

    hydrateRecoverySession();

    validationTimer = setTimeout(() => {
      if (!active || ready || invalid) return;
      setInvalid(true);
    }, 5000);

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session?.user) {
        setEmail(session.user.email ?? null);
        setReady(true);
        setInvalid(false);
      }
    });

    return () => {
      active = false;
      if (validationTimer) clearTimeout(validationTimer);
      sub.subscription.unsubscribe();
    };
  }, [ready, invalid]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (pwd.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (pwd !== pwd2) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setSaving(true);
    const { error: updErr } = await supabase.auth.updateUser({ password: pwd });
    setSaving(false);
    if (updErr) {
      setError(updErr.message);
      return;
    }
    setDone(true);
  }

  const inputCls =
    "w-full rounded-xl bg-white/[0.04] ring-1 ring-white/10 focus:ring-2 focus:ring-primary/60 outline-none px-10 py-2.5 text-sm";

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#06030f] text-foreground grid place-items-center px-4">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-1/3 -left-1/4 h-[800px] w-[800px] rounded-full opacity-50 blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.55 0.25 290 / 0.5), transparent 60%)" }}
        />
        <div
          className="absolute -bottom-1/3 -right-1/4 h-[800px] w-[800px] rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.55 0.28 265 / 0.5), transparent 60%)" }}
        />
      </div>

      <div className="relative w-full max-w-md rounded-3xl bg-white/[0.035] ring-1 ring-white/10 backdrop-blur-xl p-7 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-2xl grid place-items-center bg-primary/15 ring-1 ring-primary/30">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-lg font-semibold">Crear nueva contraseña</h1>
            <p className="text-xs text-muted-foreground">Elegí una contraseña nueva para tu cuenta.</p>
          </div>
        </div>

        {invalid && !done && (
          <div className="rounded-xl bg-amber-500/10 ring-1 ring-amber-400/25 p-5 text-center">
            <div className="mx-auto h-11 w-11 rounded-full grid place-items-center bg-amber-500/15 ring-1 ring-amber-400/30">
              <MailWarning className="h-5 w-5 text-amber-300" />
            </div>
            <div className="mt-3 text-sm font-semibold">
              Este enlace venció o ya fue utilizado
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Solicitá uno nuevo para poder crear tu contraseña.
            </div>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/login?forgot=1";
              }}
              className="mt-4 w-full rounded-xl bg-white/[0.05] hover:bg-white/[0.09] ring-1 ring-white/10 px-4 py-2.5 text-sm font-medium transition"
            >
              Solicitar nuevo enlace
            </button>
          </div>
        )}

        {!ready && !done && !invalid && (
          <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-6 text-center text-sm text-muted-foreground">
            Validando el enlace…
          </div>
        )}

        {ready && !done && (
          <form onSubmit={onSubmit} className="space-y-4">
            {email && (
              <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 px-3 py-2 text-xs text-muted-foreground">
                Cuenta: <span className="text-foreground font-medium">{email}</span>
              </div>
            )}

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type={showPwd ? "text" : "password"}
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="Nueva contraseña"
                autoComplete="new-password"
                disabled={saving}
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type={showPwd ? "text" : "password"}
                value={pwd2}
                onChange={(e) => setPwd2(e.target.value)}
                placeholder="Confirmar contraseña"
                autoComplete="new-password"
                disabled={saving}
                className={inputCls}
              />
            </div>

            {error && (
              <div className="rounded-xl bg-red-500/10 ring-1 ring-red-500/30 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-xl bg-gradient-to-b from-primary to-primary/80 text-primary-foreground font-semibold px-4 py-2.5 text-sm shadow-lg disabled:opacity-60"
            >
              {saving ? "Guardando…" : "Guardar contraseña"}
            </button>
          </form>
        )}

        {done && (
          <div className="rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/20 p-6 text-center">
            <div className="mx-auto h-12 w-12 rounded-full grid place-items-center bg-emerald-500/20 ring-1 ring-emerald-400/30">
              <Check className="h-6 w-6 text-emerald-300" strokeWidth={3} />
            </div>
            <div className="mt-3 text-sm font-medium">Contraseña actualizada correctamente.</div>
            <button
              type="button"
              onClick={() => navigate({ to: "/login" })}
              className="mt-5 w-full rounded-xl bg-gradient-to-b from-primary to-primary/80 text-primary-foreground font-semibold px-4 py-2.5 text-sm shadow-lg"
            >
              Ir a iniciar sesión
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
