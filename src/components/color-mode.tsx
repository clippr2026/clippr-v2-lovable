import * as React from "react";
import { useRouterState } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { applyColorMode, readLightMode, setLightMode } from "@/lib/color-mode";
import { cn } from "@/lib/utils";

/** Mantiene el modo elegido al navegar (las páginas públicas quedan sin invertir). */
export function ColorModeFlag() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  React.useEffect(() => applyColorMode(pathname), [pathname]);
  return null;
}

export function ColorModeToggle({ className }: { className?: string }) {
  const [light, setLight] = React.useState(false);
  React.useEffect(() => setLight(readLightMode()), []);
  const Icon = light ? Sun : Moon;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={light}
      aria-label="Modo claro"
      title={light ? "Volver al modo oscuro" : "Pasar a modo claro"}
      onClick={() => {
        setLightMode(!light);
        setLight(!light);
      }}
      className={cn("flex h-10 w-14 shrink-0 items-center justify-center", className)}
    >
      <span className="tema-pista relative block h-6 w-12 rounded-full border border-white/20 bg-white/10">
        <span
          className={cn(
            "tema-perilla absolute left-0.5 top-0.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-white text-black transition-transform duration-200",
            light && "translate-x-6",
          )}
        >
          <Icon className="h-3 w-3" />
        </span>
      </span>
    </button>
  );
}
