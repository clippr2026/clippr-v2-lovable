import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth, type PermKey } from "@/hooks/use-auth";
import { AppShell } from "@/components/app-shell";

/**
 * Redirects or shows "Access denied" if user lacks the required permission.
 * Returns true if user has access, false if blocked.
 */
export function usePermGuard(key: PermKey): boolean {
  const { permissions, profile, loading } = useAuth();
  const navigate = useNavigate();
  const isOwner = !profile?.role || profile.role === "owner" || profile.role === "admin_general";
  const hasAccess = isOwner || permissions[key] === true;

  React.useEffect(() => {
    if (!loading && !hasAccess) {
      // Redirect to first allowed route
      navigate({ to: "/agenda", replace: true });
    }
  }, [loading, hasAccess]);

  return hasAccess;
}

export function AccessDenied() {
  return (
    <AppShell>
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-center animate-fade-up">
        <div className="h-16 w-16 rounded-2xl grid place-items-center text-2xl"
          style={{ background: "oklch(0.66 0.24 25 / 0.15)", boxShadow: "inset 0 0 0 1px oklch(0.66 0.24 25 / 0.3)" }}>
          🚫
        </div>
        <h2 className="font-display text-xl font-semibold">Acceso denegado</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          No tenés permiso para acceder a esta sección. Contactá al administrador.
        </p>
      </div>
    </AppShell>
  );
}
