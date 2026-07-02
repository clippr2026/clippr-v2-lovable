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

const PILLARS: Array<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  color: string;
}> = [
  { icon: Calendar, title: "Agenda", subtitle: "inteligente", color: "oklch(0.72 0.19 245)" },
  { icon: Wallet, title: "Caja", subtitle: "y ventas", color: "oklch(0.74 0.16 222)" },
  { icon: Users, title: "Clientes", subtitle: "", color: "oklch(0.72 0.22 288)" },
  { icon: Brain, title: "Asesor IA", subtitle: "", color: "oklch(0.72 0.25 320)" },
];

const AMBIENT_PARTICLES = [
  { top: "17%", left: "22%", size: 2, delay: "0s" },
  { top: "32%", left: "77%", size: 2, delay: "1.4s" },
  { top: "62%", left: "13%", size: 2, delay: "2.6s" },
  { top: "18%", left: "58%", size: 2, delay: "3.2s" },
];

function colorWithAlpha(color: string, alpha: number) {
  return color.replace(")", ` / ${alpha})`);
}

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
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-[30%] -left-[18%] h-[780px] w-[780px] rounded-full opacity-35 blur-[130px]"
          style={{ background: "radial-gradient(circle, oklch(0.52 0.22 260 / 0.58), transparent 66%)" }}
        />
        <div
          className="absolute -bottom-[32%] -right-[18%] h-[760px] w-[760px] rounded-full opacity-32 blur-[130px]"
          style={{ background: "radial-gradient(circle, oklch(0.58 0.24 310 / 0.48), transparent 66%)" }}
        />

        {/* Marco geométrico premium: evita el problema óptico del círculo y da más precisión visual. */}
        <div className="absolute left-[4%] top-[7%] h-[610px] w-[610px] opacity-80">
          {[1, 1.08, 1.18].map((scale, index) => (
            <div
              key={index}
              className="absolute inset-0"
              style={{
                clipPath: "polygon(25% 6%, 74% 6%, 94% 49%, 76% 94%, 24% 94%, 6% 50%)",
                transform: `scale(${scale})`,
                transformOrigin: "center",
                opacity: index === 0 ? 0.9 : index === 1 ? 0.32 : 0.14,
                background:
                  index === 0
                    ? "linear-gradient(160deg, oklch(0.18 0.04 285 / 0.18), oklch(0.06 0.02 280 / 0.32))"
                    : "transparent",
                border: "1px solid oklch(0.72 0.24 285 / 0.22)",
                boxShadow:
                  index === 0
                    ? "inset 0 0 70px oklch(0.72 0.22 245 / 0.05), 0 0 90px -34px oklch(0.7 0.26 300 / 0.42)"
                    : "none",
              }}
            />
          ))}
          <div
            className="absolute left-[7%] top-[18%] h-[72%] w-[2px] rounded-full opacity-70"
            style={{
              background:
                "linear-gradient(180deg, transparent, oklch(0.72 0.2 245 / 0.45), oklch(0.72 0.26 305 / 0.55), transparent)",
              filter: "blur(1px)",
            }}
          />
          <div
            className="absolute bottom-[12%] right-[10%] h-[2px] w-[34%] rounded-full opacity-75"
            style={{
              background:
                "linear-gradient(90deg, transparent, oklch(0.72 0.26 305 / 0.55), oklch(0.72 0.2 245 / 0.38), transparent)",
              filter: "blur(1px)",
            }}
          />
        </div>

        <div
          className="absolute -left-[4%] top-[20%] h-[520px] w-[520px] rotate-[-42deg] opacity-[0.18]"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, transparent 42%, oklch(0.72 0.22 245 / 0.38) 46%, transparent 52%, transparent 100%)",
          }}
        />
        <div
          className="absolute right-[-8%] top-[18%] h-[480px] w-[480px] rotate-[-42deg] opacity-[0.14]"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, transparent 44%, oklch(0.72 0.26 305 / 0.4) 48%, transparent 54%, transparent 100%)",
          }}
        />

        {AMBIENT_PARTICLES.map((p, i) => (
          <span
            key={i}
            className="animate-drift absolute rounded-full bg-white/70 blur-[0.5px]"
            style={{ top: p.top, left: p.left, width: p.size, height: p.size, opacity: 0.28, animationDelay: p.delay }}
          />
        ))}
      </div>

      <div className="relative z-10 grid min-h-screen gap-10 px-6 py-10 lg:grid-cols-2 lg:gap-8 lg:px-16 lg:py-16">
        <section className="mx-auto flex max-w-[680px] flex-col justify-center text-center lg:mx-0">
          <div className="relative z-20 flex min-h-[560px] flex-col items-center justify-center px-6 text-center lg:w-[610px]">
            <div
              className="animate-fade-up flex flex-col items-center justify-center gap-5"
              style={{ animationDelay: "40ms" }}
            >
              <img
                src="/clippr-powered-logo.webp"
                alt="Clippr"
                loading="eager"
                decoding="async"
                className="h-16 w-16 rounded-2xl object-cover ring-1 ring-white/10 shadow-[0_14px_44px_-16px_oklch(0.6_0.26_290_/_0.7)] md:h-[76px] md:w-[76px]"
              />
              <span className="font-display text-4xl font-semibold tracking-tight md:text-5xl">Clippr</span>
            </div>

            <h1
              className="animate-fade-up font-display mt-10 max-w-[560px] text-4xl font-semibold leading-[1.08] tracking-tight md:text-[3.35rem]"
              style={{ animationDelay: "110ms" }}
            >
              El centro de control
              <br />
              de <span className="text-gradient">tu negocio</span>
            </h1>

            <p
              className="animate-fade-up mx-auto mt-5 max-w-[470px] text-base leading-relaxed text-muted-foreground/90"
              style={{ animationDelay: "170ms" }}
            >
              Agenda, clientes, caja, profesionales e inteligencia artificial en una sola plataforma.
            </p>
          </div>

          <div
            className="animate-fade-up mt-6 grid w-full max-w-[620px] grid-cols-2 gap-x-0 gap-y-8 sm:grid-cols-4"
            style={{ animationDelay: "230ms" }}
          >
            {PILLARS.map(({ icon: Icon, title, subtitle, color }, index) => (
              <div key={title} className="relative flex flex-col items-center justify-start px-5">
                {index > 0 && <div className="absolute left-0 top-3 hidden h-16 w-px bg-white/10 sm:block" />}
                <div
                  className="grid h-16 w-16 place-items-center rounded-2xl ring-1"
                  style={{
                    color,
                    background: `linear-gradient(160deg, ${colorWithAlpha(color, 0.16)}, transparent)`,
                    borderColor: colorWithAlpha(color, 0.26),
                    boxShadow: `0 0 28px -14px ${colorWithAlpha(color, 0.65)}`,
                  }}
                >
                  <Icon className="h-7 w-7" />
                </div>

                <div className="mt-4 flex h-11 flex-col items-center justify-start leading-tight">
                  <span className="text-center text-[14px] font-semibold text-white/90">{title}</span>
                  <span className="text-center text-[14px] font-medium text-white/80">{subtitle || "\u00A0"}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-center">
          <div className="animate-fade-up relative w-full max-w-md" style={{ animationDelay: "150ms" }}>
            <div
              className="absolute -inset-px rounded-[28px] opacity-80"
              style={{
                background:
                  "linear-gradient(135deg, oklch(0.72 0.22 245 / 0.55), oklch(0.7 0.28 305 / 0.36), oklch(0.72 0.22 245 / 0.08))",
              }}
            />
            <div
              className="relative rounded-[28px] p-8 backdrop-blur-2xl sm:p-9"
              style={{
                background:
                  "linear-gradient(180deg, oklch(0.18 0.045 285 / 0.56), oklch(0.075 0.03 280 / 0.82))",
                boxShadow:
                  "0 28px 72px -30px oklch(0.52 0.25 285 / 0.42), inset 0 1px 0 oklch(1 0 0 / 0.065)",
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
                  <label className="mb-1.5 block text-xs font-medium tracking-wide text-white/55">Contraseña</label>
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
                  <div className="animate-fade-up rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive ring-1 ring-destructive/25">
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
                      "0 12px 30px -14px oklch(0.6 0.28 290 / 0.66), inset 0 1px 0 oklch(1 0 0 / 0.2)",
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
