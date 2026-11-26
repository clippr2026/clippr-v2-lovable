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
  // Muestra el modo al que se pasa: en claro la luna, en oscuro el sol.
  const Icon = light ? Moon : Sun;
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
      className={cn(
        "boton-cabecera grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/85 transition hover:bg-white/[0.1] active:scale-95",
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
