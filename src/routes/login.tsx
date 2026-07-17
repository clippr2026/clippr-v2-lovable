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
  const [remember, setRemember] = React.useState(() =>
    typeof window !== "undefined" && localStorage.getItem("clippr_remember_login") === "1",
  );
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (localStorage.getItem("clippr_remember_login") === "1") {
      setEmail(localStorage.getItem("clippr_remember_email") ?? "");
    }
  }, []);

  // El header mobile de la landing linkea acá con "#login-form" (ver
  // Header.tsx) para no obligar a buscar el formulario a mano. Se saca el
  // hash de la URL antes de scrollear a mano: si no, el salto instantáneo
  // nativo del navegador (por el fragment) compite con este scroll suave y
  // el resultado se ve entrecortado. El pequeño delay deja asentar el
  // layout (animate-fade-up de arriba) antes de medir dónde está el
  // formulario.
  React.useEffect(() => {
    if (window.location.hash !== "#login-form") return;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    const el = document.getElementById("login-form");
    if (!el) return;
    const t = setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => clearTimeout(t);
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

      {/* content-start (mobile): con las dos secciones apiladas en una
          sola columna y contenido mucho más corto que min-h-screen (logo
          solo + tarjeta, sin wordmark/título/descripción/iconos), el
          default de "align-content" repartía el espacio sobrante ENTRE
          las dos filas — cada bloque quedaba centrado dentro de su propia
          fila agrandada, así que el hueco entre logo y tarjeta era mucho
          más grande de lo que se ve en el diseño. lg:content-center
          restaura el centrado vertical de siempre en desktop (ahí es una
          sola fila de 2 columnas, no dos filas — no hay nada que
          redistribuir, así que este cambio no le toca nada). */}
      <div className="relative z-10 grid min-h-screen content-start items-center gap-2 px-5 py-5 sm:gap-6 sm:px-6 sm:py-8 lg:content-center lg:grid-cols-[minmax(560px,1fr)_minmax(390px,0.82fr)] lg:gap-12 lg:px-14 xl:px-20">
        {/* Mobile: colapsa a solo el logo (pedido explícito — nada de
            wordmark, título, descripción ni iconos ahí, ver más abajo cada
            uno con su propio hidden/lg:). Desktop intacto. */}
        <section className="flex items-center justify-center">
          <div className="relative flex w-full max-w-[680px] flex-col items-center">
            <div className="relative flex h-auto w-full max-w-[630px] flex-col items-center justify-center px-4 py-3 text-center sm:px-8 sm:py-6 lg:h-[560px] lg:py-0">
              {/* Estas 3 capas con clip-path hexagonal fueron pensadas para
                  el hero COMPLETO de desktop (h-[560px] con wordmark,
                  título, descripción e íconos adentro) — a esa escala el
                  polígono queda grande y difuso, casi no se lee como
                  forma. En mobile el contenido de adentro se redujo solo
                  al logo (pedido de dos vueltas atrás), así que este
                  mismo polígono quedó mucho más chico en proporción a su
                  propio blur/opacidad y se empezó a leer como una forma
                  geométrica dura detrás del logo — un "triángulo", pedido
                  explícito de sacarlo. lg:block: desktop intacto. */}
              <div
                className="pointer-events-none absolute inset-0 hidden lg:block"
                style={{
                  clipPath: "polygon(25% 6%, 74% 6%, 94% 49%, 76% 94%, 24% 94%, 6% 50%)",
                  background:
                    "linear-gradient(160deg, oklch(0.17 0.045 285 / 0.20), oklch(0.045 0.018 280 / 0.42))",
                  border: "0 solid transparent",
                  boxShadow:
                    "inset 0 0 88px oklch(0.72 0.2 245 / 0.075), 0 0 120px -34px oklch(0.7 0.26 300 / 0.58), 0 0 70px -42px oklch(0.72 0.2 245 / 0.48)",
                }}
              />
              <div
                className="pointer-events-none absolute inset-[-30px] hidden opacity-32 lg:block"
                style={{
                  clipPath: "polygon(25% 6%, 74% 6%, 94% 49%, 76% 94%, 24% 94%, 6% 50%)",
                  border: "0 solid transparent",
                }}
              />
              <div
                className="pointer-events-none absolute inset-[-62px] hidden opacity-14 lg:block"
                style={{
                  clipPath: "polygon(25% 6%, 74% 6%, 94% 49%, 76% 94%, 24% 94%, 6% 50%)",
                  border: "0 solid transparent",
                }}
              />

              <div className="relative z-10 flex flex-col items-center">
                {/* Logo: 100px en mobile (sin cambios de tamaño), 185px en
                    desktop (164px + ~13%, pedido de la vuelta anterior).
                    Mobile y desktop ahora usan DOS <img> distintas (una
                    hidden en cada breakpoint), no una sola compartida:
                    la fuente original (clippr-powered-logo.webp) es
                    1024x1024 — mostrada a 100px de ancho en mobile, el
                    navegador hace un downscale tan agresivo que primero
                    pinta con un resampleo barato y recién después, ya
                    decodificada del todo, aplica uno de mejor calidad —
                    eso es exactamente el "aparece mal y mejora solo" que
                    se pedía eliminar, no un bug de CSS. clippr-logo-
                    login.webp es la misma imagen re-exportada a 480x480
                    (48KB, lossless, generada de la fuente real, no
                    reinventada) — de sobra para verse nítida a 100px sin
                    ese salto de calidad. Desktop sigue con el archivo y el
                    filter original, sin tocar un solo píxel. */}
                <div className="relative h-[100px] w-[100px] lg:h-[185px] lg:w-[185px]">
                  {/* Mobile: un solo glow sutil y bien difuminado, sin el
                      drop-shadow apilado (3 capas) que tenía la versión de
                      desktop — esa pila, sumada al downscale agresivo de
                      arriba, era gran parte de por qué el logo se sentía
                      "pegado" en vez de integrado. Achicando a un único
                      halo violeta suave alcanza para fundirlo con el
                      fondo sin que compita ni marque un borde. */}
                  <div
                    className="pointer-events-none absolute -inset-7 rounded-full opacity-40 blur-2xl lg:hidden"
                    style={{
                      background: "radial-gradient(circle, oklch(0.62 0.24 292 / 0.6), transparent 72%)",
                    }}
                  />
                  <img
                    src="/clippr-logo-login.webp"
                    alt="Clippr"
                    loading="eager"
                    decoding="sync"
                    fetchPriority="high"
                    width={480}
                    height={480}
                    className="absolute inset-0 h-full w-full object-contain lg:hidden"
                    // contentVisibility: "visible" pisa una regla global
                    // (styles.css: "img { content-visibility: auto }",
                    // pensada para no pintar imágenes fuera de pantalla en
                    // vistas largas como el dashboard). Sin este override,
                    // el navegador puede arrancar tratando esta imagen
                    // como "todavía no relevante" y recién promoverla a
                    // pintado completo un instante después de la carga
                    // inicial — ESO es la causa real del "se ve mal y
                    // mejora solo", no el tamaño del archivo (aunque
                    // bajarlo de 1024 a 480px, más arriba, también ayuda).
                    // Con logo siempre visible desde el primer frame (no
                    // hay forma de que esté "fuera de pantalla"), el ahorro
                    // de content-visibility no aplica acá y solo perjudica.
                    style={{ contentVisibility: "visible" }}
                  />

                  {/* Desktop: glow e imagen originales, intactos. */}
                  <div
                    className="pointer-events-none absolute -inset-10 hidden rounded-full opacity-75 blur-3xl lg:block"
                    style={{
                      background:
                        "radial-gradient(circle, rgba(80,170,255,.30), rgba(175,80,255,.28) 42%, transparent 70%)",
                    }}
                  />
                  <img
                    src="/clippr-powered-logo.webp"
                    alt="Clippr"
                    loading="eager"
                    decoding="async"
                    className="absolute inset-0 hidden h-full w-full object-contain lg:block"
                    style={{
                      filter: "drop-shadow(0 0 34px rgba(70,170,255,.82)) drop-shadow(0 0 82px rgba(170,90,255,.76)) drop-shadow(0 0 150px rgba(120,80,255,.62))"
                    }}
                  />
</div>

                {/* CLIPPR: wordmark propio de mobile, pedido explícito
                    (antes en mobile no había ningún texto de marca debajo
                    del logo). Mayúsculas + tracking amplio + peso medio,
                    no el mismo tratamiento que el wordmark de desktop
                    (ese es mixto-case y mucho más grande, pensado para
                    acompañar título/descripción que en mobile ya no
                    están). marginRight: -0.35em (mismo valor que el
                    tracking): letter-spacing agrega espacio DESPUÉS de
                    cada letra, incluida la última — ese espacio final
                    quedaba adentro de la caja que centra el flex, corriendo
                    la palabra visualmente hacia la izquierda. Restando ese
                    mismo valor del ancho de la caja, el centro geométrico
                    vuelve a coincidir con el centro real de las letras. */}
                <span
                  className="mt-3 text-sm font-semibold uppercase tracking-[0.35em] text-white lg:hidden"
                  style={{ marginRight: "-0.35em" }}
                >
                  Clippr
                </span>

                {/* Wordmark de desktop, título y descripción: ocultos en
                    mobile por completo (pedido explícito de la vuelta
                    anterior — en mobile solo va el logo + CLIPPR de acá
                    arriba y después la tarjeta). Desktop sin cambios de
                    layout, solo el copy de la descripción (vuelta
                    anterior también). */}
                <span
                  className="animate-fade-up font-display mt-5 hidden text-5xl font-semibold tracking-tight lg:block md:text-[3.25rem]"
                  style={{ animationDelay: "80ms" }}
                >
                  Clippr
                </span>

                <h1
                  className="animate-fade-up font-display mt-10 hidden max-w-[610px] text-5xl font-semibold leading-[1.08] tracking-tight lg:block md:text-[3.55rem]"
                  style={{ animationDelay: "120ms" }}
                >
                  El centro de control
                  <br />
                  de <span className="text-gradient">tu negocio</span>
                </h1>

                <p
                  className="animate-fade-up mx-auto mt-5 hidden max-w-[520px] text-[17px] leading-relaxed text-muted-foreground/90 lg:block"
                  style={{ animationDelay: "170ms" }}
                >
                  Todo lo que necesitás para administrar tu barbería desde un solo lugar.
                </p>
              </div>
            </div>

            {/* Iconos: ocultos por completo en mobile (pedido explícito).
                En desktop se mantienen los 4, pero mucho más discretos
                (cajas más chicas, glow/sombra reducidos, texto más tenue)
                para que no compitan con el título y el formulario — antes
                tenían el mismo peso visual que el resto de la portada. */}
            <div
              className="animate-fade-up mt-8 hidden w-full max-w-[520px] grid-cols-4 gap-x-0 lg:grid"
              style={{ animationDelay: "230ms" }}
            >
              {PILLARS.map(({ icon: Icon, title, subtitle, color }, index) => (
                <div key={title} className="relative flex flex-col items-center justify-start px-4 opacity-70">
                  {index > 0 && <div className="absolute left-0 top-3 h-10 w-px bg-white/10" />}
                  <div
                    className="grid h-9 w-9 place-items-center rounded-lg ring-1"
                    style={{
                      color,
                      background: `linear-gradient(160deg, ${colorWithAlpha(color, 0.1)}, transparent)`,
                      borderColor: colorWithAlpha(color, 0.18),
                      boxShadow: `0 0 14px -10px ${colorWithAlpha(color, 0.5)}`,
                    }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  <div className="mt-2 flex h-9 flex-col items-center justify-start leading-tight">
                    <span className="text-center text-[12px] font-medium text-white/70">{title}</span>
                    <span className="text-center text-[12px] font-normal text-white/55">{subtitle || "\u00A0"}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center">
          {/* lg:mt-12 (48px): baja la tarjeta para alinearla mejor con el
              contenido de la izquierda — pedido explícito, solo desktop
              (mobile ya está ajustado aparte para entrar sin scroll). */}
          <div
            className="animate-fade-up relative w-full max-w-[430px] lg:mt-12"
            style={{ animationDelay: "150ms" }}
          >
            {/* Glow violeta muy sutil, propio y separado del glow
                azul/magenta que ya existía (que sigue igual, ver el div de
                abajo) — este es más grande, más difuso y centrado, pensado
                para fundir el borde de la tarjeta con el fondo en vez de
                acentuar una esquina. */}
            <div
              className="pointer-events-none absolute -inset-16 rounded-[48px] opacity-25 blur-[80px]"
              style={{
                background: "radial-gradient(circle at 50% 50%, oklch(0.6 0.24 292 / 0.55), transparent 70%)",
              }}
            />
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
              id="login-form"
              className="relative rounded-[26px] p-5 backdrop-blur-2xl sm:p-9"
              style={{
                background:
                  "linear-gradient(180deg, oklch(0.18 0.045 285 / 0.56), oklch(0.075 0.03 280 / 0.82))",
                boxShadow:
                  "0 28px 72px -30px oklch(0.52 0.25 285 / 0.42), inset 0 1px 0 oklch(1 0 0 / 0.065)",
              }}
            >
              <div className="mb-4 text-center sm:mb-6">
                <h2 className="font-display text-2xl font-semibold tracking-tight">Bienvenido de nuevo</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">Ingresá para acceder a tu negocio.</p>
              </div>

              <form onSubmit={onSubmit} className="space-y-3 sm:space-y-4">
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
                      className="h-12 w-full rounded-xl bg-white/[0.035] pl-10 pr-3 text-base outline-none ring-1 ring-white/10 transition placeholder:text-muted-foreground/50 focus:bg-white/[0.05] focus:ring-2 focus:ring-primary/55"
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
                      className="h-12 w-full rounded-xl bg-white/[0.035] pl-10 pr-10 text-base outline-none ring-1 ring-white/10 transition placeholder:text-muted-foreground/50 focus:bg-white/[0.05] focus:ring-2 focus:ring-primary/55"
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
                  <div className="mt-1.5 text-right">
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

                <div className="border-t border-white/10 pt-3 text-center text-sm text-muted-foreground sm:pt-4">
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
