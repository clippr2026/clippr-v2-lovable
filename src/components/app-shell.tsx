import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppSidebar, useMobileNavItems } from "./app-sidebar";
import { useAuth } from "@/hooks/use-auth";
import { ClippiAssistant } from "./clippi/clippi-assistant";

export function AppShell({
  children,
  fullWidth = false,
  containedScroll = false,
}: {
  children: React.ReactNode;
  fullWidth?: boolean;
  // Por default el scroll de la pantalla es el del documento (html/body),
  // como siempre — sin cambios para ninguna pantalla existente. Con
  // containedScroll=true, <main> pasa a ser SU PROPIO contenedor de scroll
  // (altura fija = viewport, overflow-y:auto), en vez de que el documento
  // crezca con el contenido. La diferencia importa en iOS: un contenedor
  // con overflow-y:auto ya es "scrolleable" desde el primer frame aunque
  // todavía no tenga contenido que desborde — no depende de que Safari
  // detecte, DESPUÉS de que el contenido creció de forma asíncrona, que el
  // documento pasó a ser scrolleable. Eso es justamente lo que fallaba en
  // el Dashboard: el documento nacía con la altura exacta del viewport
  // (nada para scrollear) y crecía recién cuando llegaban los datos —
  // ese cambio de altura podía coincidir con el primer gesto de scroll del
  // usuario y quedar sin efecto. Con containedScroll, <main> siempre es
  // scrolleable desde el pixel uno, sea cual sea el contenido.
  containedScroll?: boolean;
}) {
  const { loading, session, profile } = useAuth();
  const { loading: navLoading, visible: hasBottomNav } = useMobileNavItems();
  const navigate = useNavigate();

  // Una vez que la sesión se estableció con éxito, el shell (y todo lo que
  // haya adentro, como la Agenda) NUNCA debe desmontarse por un parpadeo
  // transitorio de `loading`/`session` — por ejemplo cuando Supabase
  // refresca el token en segundo plano o revalida la sesión al volver a la
  // pestaña. Eso es lo que hacía que la Agenda se "recargara sola": este
  // gate reemplazaba todo el árbol por la pantalla de "Cargando…" y al
  // volver a montar, useAgendaData arrancaba de cero (loader + refetch).
  // Ahora solo mostramos "Cargando…" antes del primer ingreso real.
  //
  // El latch tiene que esperar a `!loading`, no alcanza con `session`: en
  // useAuth, hydrate() hace setSession(s) ANTES del await que resuelve el
  // profile (setProfile/setLoading(false) llegan recién después, en un
  // render aparte). Con solo `session`, este ref se ponía en true en ese
  // render intermedio — session ya truthy pero profile todavía null — y
  // el gate de abajo dejaba pasar a AppSidebar con el rol todavía sin
  // resolver. Eso era el "flash" del menú de Admin en cuentas Profesional
  // al hacer F5: por un instante isOwner/permissions default a "todo
  // visible" porque profile.role todavía no existía.
  const hasSessionRef = React.useRef(false);
  if (!loading && session) hasSessionRef.current = true;

  React.useEffect(() => {
    if (!loading && !session) navigate({ to: "/login", replace: true });
  }, [loading, session, navigate]);

  // La cuenta de la plataforma Clippr no tiene local: va siempre a su panel.
  const esPlataforma = profile?.role === "plataforma";
  React.useEffect(() => {
    if (!loading && session && esPlataforma) navigate({ to: "/clippr", replace: true });
  }, [loading, session, esPlataforma, navigate]);

  if ((loading || !session) && !hasSessionRef.current) {
    return (
      <div className="min-h-dvh grid place-items-center bg-background">
        <style>{`
          @keyframes clipprBootIn {
            0% { opacity: 0; transform: scale(.6) translateY(10px); filter: blur(8px); }
            60% { opacity: 1; transform: scale(1.06) translateY(0); filter: blur(0); }
            100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
          }
          @keyframes clipprBootFloat {
            0%, 100% { transform: translateY(0) scale(1); }
            50% { transform: translateY(-6px) scale(1.04); }
          }
          @keyframes clipprBootGlow {
            0%, 100% { opacity: .35; transform: scale(.85); }
            50% { opacity: .8; transform: scale(1.2); }
          }
          @keyframes clipprBootSweep {
            0% { transform: translateX(-160%) rotate(18deg); opacity: 0; }
            30% { opacity: .7; }
            70% { opacity: .7; }
            100% { transform: translateX(160%) rotate(18deg); opacity: 0; }
          }
          @keyframes clipprBootRing {
            0% { transform: scale(.8); opacity: .7; }
            100% { transform: scale(1.9); opacity: 0; }
          }
        `}</style>
        <div className="relative grid place-items-center" style={{ animation: "clipprBootIn 380ms cubic-bezier(.2,.8,.2,1) both" }}>
          <div
            className="pointer-events-none absolute h-56 w-56 rounded-full blur-3xl"
            style={{
              background: "radial-gradient(circle, oklch(0.65 0.24 290 / 0.55), oklch(0.7 0.18 230 / 0.25) 45%, transparent 70%)",
              animation: "clipprBootGlow 2.6s ease-in-out infinite",
            }}
          />
          {[0, 1].map((i) => (
            <span
              key={i}
              aria-hidden
              className="pointer-events-none absolute h-28 w-28 rounded-[2rem] border border-violet-400/50"
              style={{ animation: `clipprBootRing 2.4s ease-out ${i * 1.2}s infinite` }}
            />
          ))}
          <div className="relative h-28 w-28 overflow-hidden rounded-[2rem] ring-1 ring-white/10 shadow-[0_0_50px_-10px_rgba(139,92,246,0.7)]" style={{ animation: "clipprBootFloat 2.6s ease-in-out infinite" }}>
            <img
              src="/clippr-powered-logo.webp"
              alt="Clippr"
              loading="eager"
              decoding="async"
              className="relative z-10 h-full w-full object-cover"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 z-20 w-10 bg-white/50 blur-md"
              style={{ animation: "clipprBootSweep 2.2s ease-in-out infinite" }}
            />
          </div>
        </div>
      </div>
    );
  }

  // Sesión real cerrada (logout) después de haber estado autenticado: el
  // efecto de arriba ya está redirigiendo a /login. No volvemos a mostrar
  // el shell viejo con datos stale mientras eso ocurre.
  if (!session || esPlataforma) return null;

  return (
    <div className={containedScroll ? "flex flex-col h-dvh w-full overflow-hidden" : "flex flex-col min-h-dvh w-full"}>
      <AppSidebar />
      <ClippiAssistant />
      <main
        data-app-scroll
        className={
          "clippr-app-main flex-1 min-w-0 w-full py-2 sm:py-3 lg:py-4 " +
          // Sin barra inferior (un solo ítem) no se reserva su espacio.
          (navLoading || hasBottomNav ? "pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:pb-2 " : "pb-2 ") +
          // Sin [-webkit-overflow-scrolling:touch] a propósito: es la única
          // propiedad de scroll con momentum "legacy" de todo el proyecto —
          // desde iOS 13, overflow-y:auto ya tiene momentum nativo sin ella,
          // y WebKit tiene un bug conocido donde un contenedor con esa
          // propiedad, si queda a mitad de un scroll con inercia justo
          // cuando la pestaña pasa a segundo plano, puede volver de bfcache
          // con el touch de toda la página completamente muerto hasta
          // recargar. Quitarla no le saca nada al scroll (sigue con
          // momentum nativo) y elimina esa causa.
          (containedScroll
            ? "min-h-0 overflow-y-auto overscroll-contain "
            : "") +
          (fullWidth
            ? "px-2 sm:px-3 lg:px-4"
            : "max-w-[1440px] mx-auto px-3 sm:px-5 lg:px-6")
        }
      >
        <div className="relative z-10">
          {children}
        </div>
      </main>
    </div>
  );
}
