import React from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────── Apariencia ───────────
const THEME_KEY = "clippr_theme";

export function AparienciaSection() {
  const [theme, setThemeState] = React.useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem(THEME_KEY) as "dark" | "light") ?? "dark";
  });

  function applyTheme(t: "dark" | "light") {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
    const root = document.documentElement;
    if (t === "light") {
      root.classList.remove("dark");
      root.classList.add("light");
    } else {
      root.classList.remove("light");
      root.classList.add("dark");
    }
  }

  // Apply saved theme on mount
  React.useEffect(() => {
    applyTheme(theme);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const options = [
    {
      id: "dark" as const,
      label: "Oscuro",
      desc: "Fondo negro, ideal para trabajar de noche o en ambientes con poca luz.",
      Icon: Moon,
      preview: "bg-[oklch(0.09_0.03_275)]",
      ring: "ring-white/10",
    },
    {
      id: "light" as const,
      label: "Claro",
      desc: "Fondo blanco, ideal para trabajar con luz natural o durante el día.",
      Icon: Sun,
      preview: "bg-[oklch(0.97_0.01_270)]",
      ring: "ring-black/10",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-display font-semibold">Apariencia</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Elegí el tema visual de la aplicación.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {options.map((opt) => {
          const isActive = theme === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => applyTheme(opt.id)}
              className={cn(
                "relative rounded-2xl p-4 text-left transition-all ring-1",
                isActive
                  ? "ring-primary bg-primary/10"
                  : "ring-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
              )}
            >
              {/* Preview swatch */}
              <div
                className={cn(
                  "rounded-xl h-20 mb-4 flex items-center justify-center ring-1",
                  opt.preview,
                  opt.ring,
                )}
              >
                <opt.Icon
                  className={cn(
                    "size-7",
                    opt.id === "dark" ? "text-white/60" : "text-white/50",
                  )}
                />
              </div>

              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-sm">{opt.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {opt.desc}
                  </div>
                </div>
                {isActive && (
                  <div className="shrink-0 h-5 w-5 rounded-full bg-primary grid place-items-center mt-0.5">
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path
                        d="M1 4L3.5 6.5L9 1"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        El tema elegido se guarda localmente en este dispositivo.
      </p>
    </div>
  );
}
