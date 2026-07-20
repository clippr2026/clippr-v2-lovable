import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppSidebar } from "./app-sidebar";
import { useAuth } from "@/hooks/use-auth";

export function AppShell({ children, fullWidth = false }: { children: React.ReactNode; fullWidth?: boolean }) {
  const { loading, session } = useAuth();
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

  if ((loading || !session) && !hasSessionRef.current) {
    return (
      <div className="min-h-dvh grid place-items-center bg-background">
        <style>{`
          @keyframes clipprBootPulse {
            0%, 100% { transform: scale(1) rotate(0deg); }
            25% { transform: scale(1.02) rotate(-2deg); }
            50% { transform: scale(1.05) rotate(0deg); }
            75% { transform: scale(1.02) rotate(2deg); }
          }
          @keyframes clipprBootGlow {
            0%, 100% { opacity: .28; transform: scale(.9); }
            50% { opacity: .55; transform: scale(1.12); }
          }
          @keyframes clipprBootFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}</style>
        <div
          className="relative grid place-items-center"
          style={{ animation: "clipprBootFadeIn 420ms ease-out" }}
        >
          {/* Glow violeta sutil — no debe leerse como un elemento aparte,
              solo un halo detrás del logo. */}
          <div
            className="pointer-events-none absolute h-28 w-28 rounded-full blur-3xl"
            style={{
              background: "radial-gradient(circle, oklch(0.65 0.24 290 / 0.35), transparent 70%)",
              animation: "clipprBootGlow 2.6s ease-in-out infinite",
            }}
          />
          <img
            src="/clippr-powered-logo.webp"
            alt="Clippr"
            loading="eager"
            decoding="async"
            className="relative z-10 h-16 w-16 rounded-2xl object-cover ring-1 ring-white/10"
            style={{ animation: "clipprBootPulse 2.4s ease-in-out infinite" }}
          />
        </div>
      </div>
    );
  }

  // Sesión real cerrada (logout) después de haber estado autenticado: el
  // efecto de arriba ya está redirigiendo a /login. No volvemos a mostrar
  // el shell viejo con datos stale mientras eso ocurre.
  if (!session) return null;

  return (
    <div className="flex flex-col min-h-dvh w-full">
      <AppSidebar />
      <main
        className={
          "clippr-app-main flex-1 min-w-0 w-full py-2 sm:py-3 lg:py-4 " +
          "pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-2 " +
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
