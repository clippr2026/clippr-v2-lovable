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
      <style>{`
        @keyframes logoEnter {
          0% {
            opacity: 0;
            transform: scale(.88) rotate(-2deg);
            filter: hue-rotate(55deg) saturate(1.55) brightness(1.22)
              drop-shadow(0 0 18px rgba(70,170,255,.35))
              drop-shadow(0 0 44px rgba(170,90,255,.38));
          }
          48% {
            opacity: 1;
            transform: scale(1.07) rotate(1deg);
            filter: hue-rotate(-28deg) saturate(1.42) brightness(1.18)
              drop-shadow(0 0 36px rgba(70,170,255,.78))
              drop-shadow(0 0 92px rgba(170,90,255,.78));
          }
          100% {
            opacity: 1;
            transform: scale(1) rotate(0deg);
            filter: hue-rotate(0deg) saturate(1.12) brightness(1)
              drop-shadow(0 0 28px rgba(70,170,255,.72))
              drop-shadow(0 0 68px rgba(170,90,255,.68))
              drop-shadow(0 0 128px rgba(120,80,255,.55));
          }
        }
      `}</style>
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-[30%] -left-[18%] h-[780px] w-[780px] rounded-full opacity-35 blur-[130px]"
          style={{ background: "radial-gradient(circle, oklch(0.52 0.22 260 / 0.58), transparent 66%)" }}
        />
        <div
          className="absolute -bottom-[32%] -right-[18%] h-[760px] w-[760px] rounded-full opacity-32 blur-[130px]"
          style={{ background: "radial-gradient(circle, oklch(0.58 0.24 310 / 0.48), transparent 66%)" }}
        />

        {AMBIENT_PARTICLES.map((p, i) => (
          <span
            key={i}
            className="animate-drift absolute rounded-full bg-white/70 blur-[0.5px]"
            style={{ top: p.top, left: p.left, width: p.size, height: p.size, opacity: 0.28, animationDelay: p.delay }}
          />
        ))}
      </div>

      <div className="relative z-10 grid min-h-screen items-center gap-8 px-6 py-8 lg:grid-cols-[minmax(560px,1fr)_minmax(390px,0.82fr)] lg:gap-12 lg:px-14 xl:px-20">
        <section className="flex items-center justify-center">
          <div className="relative flex w-full max-w-[680px] flex-col items-center">
            <div className="relative flex h-[560px] w-full max-w-[630px] flex-col items-center justify-center px-8 text-center">
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  clipPath: "polygon(25% 6%, 74% 6%, 94% 49%, 76% 94%, 24% 94%, 6% 50%)",
                  background:
                    "linear-gradient(160deg, oklch(0.17 0.045 285 / 0.20), oklch(0.045 0.018 280 / 0.42))",
                  border: "1px solid oklch(0.72 0.24 285 / 0.42)",
                  boxShadow:
                    "inset 0 0 88px oklch(0.72 0.2 245 / 0.075), 0 0 120px -34px oklch(0.7 0.26 300 / 0.58), 0 0 70px -42px oklch(0.72 0.2 245 / 0.48)",
                }}
              />
              <div
                className="pointer-events-none absolute inset-[-30px] opacity-32"
                style={{
                  clipPath: "polygon(25% 6%, 74% 6%, 94% 49%, 76% 94%, 24% 94%, 6% 50%)",
                  border: "1px solid oklch(0.72 0.2 245 / 0.26)",
                }}
              />
              <div
                className="pointer-events-none absolute inset-[-62px] opacity-14"
                style={{
                  clipPath: "polygon(25% 6%, 74% 6%, 94% 49%, 76% 94%, 24% 94%, 6% 50%)",
                  border: "1px solid oklch(0.72 0.26 305 / 0.26)",
                }}
              />

              <div className="relative z-10 flex flex-col items-center">
                <img
                  src="/clippr-powered-logo.webp"
                  alt="Clippr"
                  loading="eager"
                  decoding="async"
                  className="animate-fade-up h-[164px] w-[164px] object-contain"
                  style={{
                    animationDelay: "40ms",
                    animation: "logoEnter 1.15s cubic-bezier(.16,1,.3,1) both",
                    filter:
                      "drop-shadow(0 0 28px rgba(70,170,255,.72)) drop-shadow(0 0 68px rgba(170,90,255,.68)) drop-shadow(0 0 128px rgba(120,80,255,.55)) saturate(1.12)"
                  }}
                />

                <span
                  className="animate-fade-up font-display mt-5 text-5xl font-semibold tracking-tight md:text-[3.25rem]"
                  style={{ animationDelay: "80ms" }}
                >
                  Clippr
                </span>

                <h1
                  className="animate-fade-up font-display mt-10 max-w-[610px] text-5xl font-semibold leading-[1.06] tracking-tight md:text-[3.55rem]"
                  style={{ animationDelay: "120ms" }}
                >
                  El centro de control
                  <br />
                  de <span className="text-gradient">tu negocio</span>
                </h1>

                <p
                  className="animate-fade-up mx-auto mt-5 max-w-[520px] text-[17px] leading-relaxed text-muted-foreground/90"
                  style={{ animationDelay: "170ms" }}
                >
                  Agenda, clientes, caja, profesionales e inteligencia artificial en una sola plataforma.
                </p>
              </div>
            </div>

            <div
              className="animate-fade-up mt-7 grid w-full max-w-[560px] grid-cols-2 gap-x-0 gap-y-7 sm:grid-cols-4"
              style={{ animationDelay: "230ms" }}
            >
              {PILLARS.map(({ icon: Icon, title, subtitle, color }, index) => (
                <div key={title} className="relative flex flex-col items-center justify-start px-4">
                  {index > 0 && <div className="absolute left-0 top-4 hidden h-14 w-px bg-white/10 sm:block" />}
                  <div
                    className="grid h-14 w-14 place-items-center rounded-2xl ring-1"
                    style={{
                      color,
                      background: `linear-gradient(160deg, ${colorWithAlpha(color, 0.16)}, transparent)`,
                      borderColor: colorWithAlpha(color, 0.25),
                      boxShadow: `0 0 28px -15px ${colorWithAlpha(color, 0.62)}`,
                    }}
                  >
                    <Icon className="h-6 w-6" />
                  </div>

                  <div className="mt-3 flex h-10 flex-col items-center justify-start leading-tight">
                    <span className="text-center text-[13px] font-semibold text-white/90">{title}</span>
                    <span className="text-center text-[13px] font-medium text-white/80">{subtitle || "\u00A0"}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center">
          <div className="animate-fade-up relative w-full max-w-[430px]" style={{ animationDelay: "150ms" }}>
            <div
              className="pointer-events-none absolute -inset-10 rounded-[36px] opacity-60 blur-3xl"
              style={{
                background:
                  "radial-gradient(circle at 35% 20%, oklch(0.72 0.2 245 / 0.38), transparent 48%), radial-gradient(circle at 80% 80%, oklch(0.72 0.26 305 / 0.34), transparent 52%)",
              }}
            />
            <div
              className="absolute -inset-px rounded-[26px] opacity-80"
              style={{
                background:
                  "linear-gradient(135deg, oklch(0.72 0.22 245 / 0.55), oklch(0.7 0.28 305 / 0.36), oklch(0.72 0.22 245 / 0.08))",
              }}
            />
            <div
              className="relative rounded-[26px] p-8 backdrop-blur-2xl sm:p-9"
              style={{
                background:
                  "linear-gradient(180deg, oklch(0.18 0.045 285 / 0.56), oklch(0.075 0.03 280 / 0.82))",
                boxShadow:
                  "0 28px 72px -30px oklch(0.52 0.25 285 / 0.42), inset 0 1px 0 oklch(1 0 0 / 0.065)",
              }}
            >
              <div className="mb-6 text-center">
                <h2 className="font-display text-2xl font-semibold tracking-tight">Bienvenido de nuevo</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">Ingresá para acceder a tu negocio.</p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
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
