import * as React from "react";
import { Plus } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";

// Page-specific CTA mapping (kept consistent with previous behavior).
const ACTION_BY_PATH: Record<string, { label: string; to: string }> = {
  "/cash-register": { label: "Abrir caja", to: "/cash-register" },
  "/clients": { label: "Nuevo cliente", to: "/clients" },
  "/services": { label: "Nuevo servicio", to: "/services" },
  "/inventory": { label: "Nuevo producto", to: "/inventory" },
};

export function Topbar({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const defaultAction = ACTION_BY_PATH[pathname];

  return (
    <header className="mb-4 flex flex-col gap-3 sm:mb-6 md:mb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 w-full sm:w-auto">
        <h1 className="font-display text-[1.65rem] leading-tight sm:text-3xl font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 line-clamp-2">
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
        {action ?? (defaultAction ? (
          <Link
            to={defaultAction.to}
            className="h-10 w-full justify-center px-4 rounded-xl text-white font-medium text-sm flex items-center gap-2 hover:brightness-110 transition sm:w-auto"
            style={{
              background: "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))",
              boxShadow:
                "0 10px 26px -10px oklch(0.6 0.28 290 / 0.65), inset 0 1px 0 oklch(1 0 0 / 0.2)",
            }}
          >
            <Plus className="h-4 w-4" />
            <span>{defaultAction.label}</span>
          </Link>
        ) : null)}
      </div>
    </header>
  );
}
