import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Mail, Lock, Eye, EyeOff, LogIn, BarChart3, Users, Shield } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Ingresar — Clippr" },
      { name: "description", content: "Acceso al panel Clippr Studio Suite." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { signIn, session, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPwd, setShowPwd] = React.useState(false);
  const [remember, setRemember] = React.useState(() => localStorage.getItem("clippr_remember_login") === "1");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (localStorage.getItem("clippr_remember_login") === "1") {
      setEmail(localStorage.getItem("clippr_remember_email") ?? "");
    }
  }, []);

  React.useEffect(() => {
    if (!loading && session) navigate({ to: "/", replace: true });
  }, [loading, session, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setError("Ingresá email y contraseña.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const { error: err } = await signIn(email.trim(), password, remember);
    setSubmitting(false);
    if (err) setError(err);
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#06030f] text-foreground">
      {/* Aurora background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-1/3 -left-1/4 h-[900px] w-[900px] rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.55 0.25 290 / 0.55), transparent 60%)" }} />
        <div className="absolute -bottom-1/3 -right-1/4 h-[900px] w-[900px] rounded-full opacity-50 blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.55 0.28 265 / 0.55), transparent 60%)" }} />
        <div className="absolute left-[8%] top-[10%] h-[600px] w-[600px] rounded-full border border-primary/20 opacity-60" />
        {/* stars */}
        <div className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(1px 1px at 20% 30%, white, transparent), radial-gradient(1px 1px at 70% 60%, white, transparent), radial-gradient(1px 1px at 40% 80%, white, transparent), radial-gradient(1px 1px at 85% 20%, white, transparent), radial-gradient(1px 1px at 10% 60%, white, transparent)",
            backgroundSize: "400px 400px",
          }} />
      </div>

      <div className="relative z-10 min-h-screen grid lg:grid-cols-2 gap-8 px-6 py-10 lg:px-16 lg:py-16">
        {/* Branding */}
        <section className="flex flex-col justify-center max-w-xl mx-auto lg:mx-0 text-center lg:text-left">
          <div className="flex items-center gap-4 justify-center lg:justify-start">
            <div
              className="h-16 w-16 rounded-2xl grid place-items-center font-display text-3xl text-white"
              style={{
                background: "linear-gradient(135deg, oklch(0.7 0.22 245), oklch(0.65 0.27 305))",
                boxShadow: "0 10px 40px -8px oklch(0.65 0.27 290 / 0.65)",
              }}
            >
              C
            </div>
            <span className="font-display text-5xl font-semibold tracking-tight">Clippr</span>
          </div>

          <h1 className="font-display mt-10 text-4xl md:text-5xl font-semibold leading-tight">
            Bienvenido a{" "}
            <span className="text-gradient">Clippr</span>
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Gestioná tu negocio desde un solo lugar.
          </p>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
            {[
              { icon: BarChart3, t: "Más productividad", d: "Automatizá tareas y ahorrá tiempo." },
              { icon: Users, t: "Todo en un solo lugar", d: "Clientes, finanzas, ventas y más." },
              { icon: Shield, t: "Seguro y confiable", d: "Tus datos protegidos siempre." },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} className="text-center sm:text-left">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/30 text-primary mb-2">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="text-sm font-medium">{t}</div>
                <div className="text-xs text-muted-foreground mt-1">{d}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Login card */}
        <section className="flex items-center justify-center">
          <div className="relative w-full max-w-md">
            {/* Neon border */}
            <div
              className="absolute -inset-px rounded-3xl opacity-80"
              style={{
                background:
                  "linear-gradient(135deg, oklch(0.72 0.22 245 / 0.8), oklch(0.7 0.28 305 / 0.6), oklch(0.72 0.22 245 / 0.2))",
                filter: "blur(0.5px)",
              }}
            />
            <div
              className="relative rounded-3xl p-8 backdrop-blur-2xl"
              style={{
                background:
                  "linear-gradient(180deg, oklch(0.18 0.05 285 / 0.55), oklch(0.1 0.04 280 / 0.7))",
                boxShadow:
                  "0 30px 80px -20px oklch(0.55 0.28 285 / 0.4), inset 0 1px 0 oklch(1 0 0 / 0.06)",
              }}
            >
              <div className="text-center mb-6">
                <h2 className="font-display text-2xl font-semibold">
                  ¡Hola! <span className="inline-block">👋</span>
                </h2>
                <p className="font-display text-xl mt-1">Qué bueno verte de nuevo</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Ingresá tus datos para iniciar sesión
                </p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Correo electrónico</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ejemplo@correo.com"
                      disabled={submitting}
                      className="w-full h-12 rounded-xl bg-secondary/40 ring-1 ring-white/10 pl-10 pr-3 text-sm outline-none focus:ring-primary/60 transition placeholder:text-muted-foreground/60"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Contraseña</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                    <input
                      type={showPwd ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Ingresa tu contraseña"
                      disabled={submitting}
                      className="w-full h-12 rounded-xl bg-secondary/40 ring-1 ring-white/10 pl-10 pr-10 text-sm outline-none focus:ring-primary/60 transition placeholder:text-muted-foreground/60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="text-right mt-1.5">
                    <button
                      type="button"
                      className="text-xs text-accent hover:underline"
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-muted-foreground select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-secondary/60 accent-primary"
                  />
                  Recordarme
                </label>

                {error && (
                  <div className="text-xs text-destructive bg-destructive/10 ring-1 ring-destructive/30 rounded-lg p-2.5">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-12 rounded-xl text-white font-medium text-sm flex items-center justify-center gap-2 transition disabled:opacity-50 hover:brightness-110"
                  style={{
                    background:
                      "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))",
                    boxShadow:
                      "0 10px 30px -10px oklch(0.6 0.28 290 / 0.7), inset 0 1px 0 oklch(1 0 0 / 0.2)",
                  }}
                >
                  <LogIn className="h-4 w-4" />
                  {submitting ? "Ingresando…" : "Ingresar"}
                </button>

                <div className="pt-4 border-t border-white/10 text-center text-sm text-muted-foreground">
                  ¿No tienes cuenta aún?{" "}
                  <button type="button" className="text-accent hover:underline font-medium">
                    Regístrate ›
                  </button>
                </div>
              </form>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
