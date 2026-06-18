import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppSidebar, SidebarProvider } from "./app-sidebar";
import { useAuth } from "@/hooks/use-auth";

export function AppShell({ children }: { children: React.ReactNode }) {
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
        <main className="flex-1 min-w-0 w-full max-w-[1440px] mx-auto px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-7">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
