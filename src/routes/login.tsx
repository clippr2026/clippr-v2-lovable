import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Mail, Lock, Eye, EyeOff, LogIn, Calendar, Wallet, Users, Brain } from "lucide-react";
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

// Los mismos cuatro pilares del producto, con los íconos que ya usa la
// navegación interna (Agenda=Calendar, Caja=Wallet, Clientes=Users,
// Asesor IA=Brain), para que el vocabulario visual sea el mismo adentro y
// afuera. Cada uno con un tinte distinto dentro del mismo espectro azul→
// violeta→magenta que ya es la identidad de Clippr — no colores nuevos.
const PILLARS: Array<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
}> = [
  { icon: Calendar, label: "Agenda inteligente", color: "oklch(0.72 0.19 245)" },
  { icon: Wallet, label: "Caja y ventas", color: "oklch(0.74 0.16 222)" },
  { icon: Users, label: "Clientes", color: "oklch(0.72 0.22 288)" },
  { icon: Brain, label: "Asesor IA", color: "oklch(0.72 0.25 320)" },
];

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
    if (!loading && session) navigate({ to: "/dashboard", replace: true });
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
    <div className="relative min-h-screen w-full overflow-hidden bg-[#05040b] text-foreground">
      {/* Fondo ambiental: dos glows contenidos, un anillo tipo "borde de planeta"
          respirando muy despacio, y unas pocas partículas mínimas con deriva.
          Nada de patrones repetidos ni blobs pesados — todo a baja opacidad. */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-[28%] -left-[18%] h-[820px] w-[820px] rounded-full opacity-40 blur-[120px]"
          style={{ background: "radial-gradient(circle, oklch(0.55 0.24 265 / 0.65), transparent 65%)" }}
        />
        <div
          className="absolute -bottom-[30%] -right-[16%] h-[760px] w-[760px] rounded-full opacity-35 blur-[120px]"
          style={{ background: "radial-gradient(circle, oklch(0.58 0.26 310 / 0.6), transparent 65%)" }}
        />
        {/* Anillo sutil, tipo horizonte de planeta */}
        <div
          className="animate-breathe absolute left-[6%] top-[8%] h-[560px] w-[560px] rounded-full border border-white/[0.06]"
          style={{ boxShadow: "0 0 120px -20px oklch(0.65 0.22 280 / 0.35)" }}
        />
        {/* Línea inferior, eco muy tenue del degradado de marca */}
        <div
          className="absolute bottom-[6%] left-[-10%] h-px w-[130%] opacity-[0.14]"
          style={{
            background: "linear-gradient(90deg, transparent, oklch(0.7 0.2 250 / 0.8), oklch(0.72 0.26 310 / 0.8), transparent)",
            filter: "blur(1px)",
          }}
        />
        {/* Partículas mínimas */}
        {[
          { top: "18%", left: "22%", size: 3, delay: "0s" },
          { top: "34%", left: "78%", size: 2, delay: "1.4s" },
          { top: "62%", left: "12%", size: 2, delay: "2.6s" },
          { top: "72%", left: "58%", size: 3, delay: "0.8s" },
          { top: "14%", left: "58%", size: 2, delay: "3.2s" },
        ].map((p, i) => (
          <span
            key={i}
            className="animate-drift absolute rounded-full bg-white/70 blur-[0.5px]"
            style={{ top: p.top, left: p.left, width: p.size, height: p.size, opacity: 0.35, animationDelay: p.delay }}
          />
        ))}
      </div>

      <div className="relative z-10 grid min-h-screen gap-10 px-6 py-10 lg:grid-cols-2 lg:gap-8 lg:px-16 lg:py-16">
        {/* Marca + propuesta de valor */}
        <section className="mx-auto flex max-w-xl flex-col justify-center text-center lg:mx-0 lg:text-left">
          <div
            className="animate-fade-up flex items-center justify-center gap-4 lg:justify-start"
            style={{ animationDelay: "40ms" }}
          >
            <img
              src="/clippr-powered-logo.webp"
              alt="Clippr"
              loading="eager"
              decoding="async"
              className="h-16 w-16 rounded-2xl object-cover ring-1 ring-white/10 shadow-[0_14px_44px_-14px_oklch(0.6_0.26_290_/_0.85)] md:h-20 md:w-20"
            />
            <span className="font-display text-4xl font-semibold tracking-tight md:text-5xl">Clippr</span>
          </div>

          <h1
            className="animate-fade-up font-display mt-9 text-4xl font-semibold leading-[1.08] tracking-tight md:text-[3.25rem]"
            style={{ animationDelay: "110ms" }}
          >
            El centro de control
            <br />
            de <span className="text-gradient">tu negocio</span>
          </h1>

          <p
            className="animate-fade-up mt-4 max-w-md text-base leading-relaxed text-muted-foreground/90 mx-auto lg:mx-0"
            style={{ animationDelay: "170ms" }}
          >
            Agenda, clientes, caja, profesionales e inteligencia artificial en una sola plataforma.
          </p>

          <div
            className="animate-fade-up mt-11 grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4"
            style={{ animationDelay: "230ms" }}
          >
            {PILLARS.map(({ icon: Icon, label, color }) => (
              <div key={label} className="flex flex-col items-center gap-2.5 lg:items-start">
                <div
                  className="grid h-11 w-11 place-items-center rounded-xl ring-1"
                  style={{
                    color,
                    background: `linear-gradient(160deg, ${color.replace(")", " / 0.16)")}, transparent)`,
                    borderColor: color.replace(")", " / 0.28)"),
                    boxShadow: `0 0 24px -10px ${color.replace(")", " / 0.55)")}`,
                  }}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-[13px] font-medium leading-tight text-white/80">{label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Tarjeta de acceso */}
        <section className="flex items-center justify-center">
          <div
            className="animate-fade-up relative w-full max-w-md"
            style={{ animationDelay: "150ms" }}
          >
            {/* Borde con gradiente de marca, respirando muy despacio */}
            <div
              className="animate-breathe absolute -inset-px rounded-[28px]"
              style={{
                background:
                  "linear-gradient(135deg, oklch(0.72 0.22 245 / 0.75), oklch(0.7 0.28 305 / 0.55), oklch(0.72 0.22 245 / 0.15))",
                filter: "blur(0.5px)",
              }}
            />
            <div
              className="relative rounded-[28px] p-8 backdrop-blur-2xl sm:p-9"
              style={{
                background: "linear-gradient(180deg, oklch(0.19 0.045 285 / 0.6), oklch(0.09 0.035 280 / 0.78))",
                boxShadow:
                  "0 32px 90px -24px oklch(0.55 0.28 285 / 0.45), inset 0 1px 0 oklch(1 0 0 / 0.07)",
              }}
            >
              <div className="mb-7 text-center">
                <h2 className="font-display text-2xl font-semibold tracking-tight">Bienvenido de nuevo</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">Ingresá para acceder a tu negocio.</p>
              </div>

              <form onSubmit={onSubmit} className="space-y-5">
                <div>
                  <label className="mb-1.5 block text-xs font-medium tracking-wide text-white/55">
                    Correo electrónico
                  </label>
                  <div className="group relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70 transition-colors group-focus-within:text-primary" />
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ejemplo@correo.com"
                      disabled={submitting}
                      className="h-12 w-full rounded-xl bg-white/[0.035] pl-10 pr-3 text-sm outline-none ring-1 ring-white/10 transition placeholder:text-muted-foreground/50 focus:bg-white/[0.05] focus:ring-2 focus:ring-primary/55"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium tracking-wide text-white/55">
                    Contraseña
                  </label>
                  <div className="group relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70 transition-colors group-focus-within:text-primary" />
                    <input
                      type={showPwd ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Ingresá tu contraseña"
                      disabled={submitting}
                      className="h-12 w-full rounded-xl bg-white/[0.035] pl-10 pr-10 text-sm outline-none ring-1 ring-white/10 transition placeholder:text-muted-foreground/50 focus:bg-white/[0.05] focus:ring-2 focus:ring-primary/55"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="mt-2 text-right">
                    <button type="button" className="text-xs text-accent/90 transition hover:text-accent hover:underline">
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-white/[0.04] accent-primary"
                    />
                    Recordarme
                  </label>
                </div>

                {error && (
                  <div className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive ring-1 ring-destructive/25 animate-fade-up">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-sheen flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:-translate-y-px hover:brightness-110 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
                  style={{
                    background: "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))",
                    boxShadow:
                      "0 12px 34px -12px oklch(0.6 0.28 290 / 0.75), inset 0 1px 0 oklch(1 0 0 / 0.22)",
                  }}
                >
                  <LogIn className="h-4 w-4" />
                  {submitting ? "Ingresando…" : "Ingresar"}
                </button>

                <div className="border-t border-white/10 pt-4 text-center text-sm text-muted-foreground">
                  ¿No tenés cuenta aún?{" "}
                  <button type="button" className="font-medium text-accent transition hover:underline">
                    Registrate ›
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
