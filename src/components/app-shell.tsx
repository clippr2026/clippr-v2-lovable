import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppSidebar, SidebarProvider } from "./app-sidebar";
import { useAuth } from "@/hooks/use-auth";

export function AppShell({ children, fullWidth = false }: { children: React.ReactNode; fullWidth?: boolean }) {
  const { loading, session } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!loading && !session) navigate({ to: "/login", replace: true });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="min-h-dvh grid place-items-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="h-10 w-10 rounded-xl animate-pulse bg-gradient-to-br from-primary/40 to-accent/40 ring-1 ring-white/10" />
          <div className="text-sm">Cargando…</div>
        </div>
      </div>
    );
  }

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
