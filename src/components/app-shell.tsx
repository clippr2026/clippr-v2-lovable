import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppSidebar, SidebarProvider } from "./app-sidebar";
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
  const hasSessionRef = React.useRef(false);
  if (session) hasSessionRef.current = true;

  React.useEffect(() => {
    if (!loading && !session) navigate({ to: "/login", replace: true });
  }, [loading, session, navigate]);

  if ((loading || !session) && !hasSessionRef.current) {
    return (
      <div className="min-h-dvh grid place-items-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="h-10 w-10 rounded-xl animate-pulse bg-gradient-to-br from-primary/40 to-accent/40 ring-1 ring-white/10" />
          <div className="text-sm">Cargando…</div>
        </div>
      </div>
    );
  }

  // Sesión real cerrada (logout) después de haber estado autenticado: el
  // efecto de arriba ya está redirigiendo a /login. No volvemos a mostrar
  // el shell viejo con datos stale mientras eso ocurre.
  if (!session) return null;

  return (
    <SidebarProvider>
      <div className="flex flex-col min-h-dvh w-full">
        <AppSidebar />
        <main
          className={
            "clippr-app-main flex-1 min-w-0 w-full py-2 sm:py-3 lg:py-4 " +
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
    </SidebarProvider>
  );
}
