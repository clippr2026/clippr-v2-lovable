import * as React from "react";
import { cn } from "@/lib/utils";

type ClipprLoaderProps = {
  fullScreen?: boolean;
  /**
   * "screen" is the single official size for page/section loaders across the
   * internal panel (Dashboard, Agenda, Caja, Profesionales, Asesor IA,
   * Clientes, Configuración) — visually identical to Agenda's loader.
   * "sm"/"md" remain available only for small, inline/button-level spinners.
   */
  size?: "sm" | "md" | "lg" | "screen";
  background?: "dark" | "light" | "transparent";
  className?: string;
  /**
   * Delays the loader's appearance by this many ms to avoid flicker on fast
   * loads. If the loading state resolves before the delay elapses, the
   * loader never renders. 0 (default) renders immediately — use this for
   * button/inline loaders. Use ~130ms for page/section loaders.
   */
  delayMs?: number;
};

const sizeClass = {
  sm: "h-7 w-7 rounded-lg",
  md: "h-16 w-16 rounded-2xl",
  lg: "h-28 w-28 rounded-[2rem]",
  // Official size for every page/section loader — same as Agenda's.
  screen: "h-28 w-28 rounded-[2rem]",
};

export function ClipprLoader({
  fullScreen = false,
  size = "md",
  background = "transparent",
  className,
  delayMs = 0,
}: ClipprLoaderProps) {
  const [visible, setVisible] = React.useState(delayMs === 0);

  React.useEffect(() => {
    if (delayMs === 0) {
      setVisible(true);
      return;
    }
    setVisible(false);
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (delayMs > 0 && !visible) return null;

  const mark = (
    <div className={cn("relative grid place-items-center", className)}>
      <style>{`
        @keyframes clipprLogoFloat {
          0%, 100% { transform: translateY(0) scale(1); filter: saturate(1.05) brightness(1); }
          50% { transform: translateY(-3px) scale(1.025); filter: saturate(1.22) brightness(1.12); }
        }
        @keyframes clipprInnerGlow {
          0% { transform: translateX(-130%) rotate(18deg); opacity: 0; }
          25% { opacity: .38; }
          52% { opacity: .78; }
          78% { opacity: .34; }
          100% { transform: translateX(130%) rotate(18deg); opacity: 0; }
        }
        @keyframes clipprAuraPulse {
          0%, 100% { opacity: .28; transform: scale(.92); }
          50% { opacity: .68; transform: scale(1.08); }
        }
      `}</style>

      <div
        className={cn(
          "pointer-events-none absolute rounded-full bg-cyan-400/15 blur-3xl",
          size === "sm" ? "h-12 w-12" : size === "md" ? "h-24 w-24" : "h-40 w-40",
        )}
        style={{ animation: "clipprAuraPulse 2.8s ease-in-out infinite" }}
      />

      <div className={cn("relative overflow-hidden", sizeClass[size])}>
        <img
          src="/clippr-powered-logo.webp"
          alt="Clippr"
          loading="eager"
          decoding="async"
          className="relative z-10 h-full w-full object-cover"
          style={{ animation: "clipprLogoFloat 2.4s ease-in-out infinite" }}
        />
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 z-20 bg-white/45 blur-md",
            size === "sm" ? "w-3" : size === "md" ? "w-6" : "w-10",
          )}
          style={{ animation: "clipprInnerGlow 2.2s ease-in-out infinite" }}
        />
      </div>
    </div>
  );

  if (!fullScreen) return mark;

  return (
    <main
      className={cn(
        "grid min-h-dvh place-items-center px-4",
        background === "light" && "bg-white text-slate-950",
        background === "dark" && "bg-[#050507] text-white",
        background === "transparent" && "bg-transparent",
      )}
    >
      {mark}
    </main>
  );
}

export default ClipprLoader;
