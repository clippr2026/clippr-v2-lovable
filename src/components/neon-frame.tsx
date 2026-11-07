import * as React from "react";
import { cn } from "@/lib/utils";

// Aro de neón para el logo del negocio. `mode="intro"` hace que la luz recorra el
// aro una vez y quede quieta; `mode="loop"` la deja girando (pantalla de carga);
// `mode="static"` lo muestra fijo. Los colores salen de la paleta del negocio.
export function NeonFrame({
  colors,
  mode = "static",
  className,
  innerClassName,
  plain = false,
  children,
}: {
  colors: [string, string, string];
  mode?: "static" | "intro" | "loop";
  className?: string;
  innerClassName?: string;
  // Sin neón: el mismo marco redondeado, sin aro ni luz.
  plain?: boolean;
  children: React.ReactNode;
}) {
  const [c1, c2, c3] = colors;
  const spin =
    mode === "loop" ? "neonSpin 2.8s linear infinite" : mode === "intro" ? "neonSpinOnce 2.6s cubic-bezier(.2,.7,.2,1) 1 forwards" : "none";
  const glow =
    mode === "loop" ? "neonGlowLoop 2.2s ease-in-out infinite" : mode === "intro" ? "neonGlowIntro 2.6s ease-out 1 forwards" : "none";
  return (
    <div
      className={cn("relative rounded-[1.7rem] p-[3px] sm:rounded-[1.9rem]", className)}
      style={
        plain
          ? { background: "rgba(255,255,255,0.18)" }
          : {
              background: `linear-gradient(135deg, ${c1}, ${c2} 50%, ${c3})`,
              boxShadow: `0 0 10px ${c2}, 0 0 26px ${c2}aa, 0 0 56px ${c3}66, 0 0 80px ${c1}40`,
              animation: glow,
            }
      }
    >
      <style>{`
        @keyframes neonSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes neonSpinOnce { from { transform: rotate(0deg); } to { transform: rotate(720deg); } }
        @keyframes neonGlowLoop { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.35); } }
        @keyframes neonGlowIntro { 0% { filter: brightness(1.6); } 100% { filter: brightness(1); } }
        @media (prefers-reduced-motion: reduce) { .neon-spin { animation: none !important; } }
      `}</style>
      {!plain && mode !== "static" && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <div
            className="neon-spin absolute left-1/2 top-1/2 aspect-square w-[180%] -translate-x-1/2 -translate-y-1/2"
            style={{ animation: spin }}
          >
            <div
              className="h-full w-full"
              style={{
                background: `conic-gradient(from 0deg, transparent 0deg, ${c3} 40deg, #ffffff 70deg, ${c1} 100deg, transparent 160deg, transparent 360deg)`,
              }}
            />
          </div>
        </div>
      )}
      <div className={cn("relative overflow-hidden rounded-[1.45rem] bg-white sm:rounded-[1.65rem]", innerClassName)}>
        {children}
      </div>
    </div>
  );
}

function hexToHsl(hex: string): [number, number, number] | null {
  const clean = hex.replace("#", "").trim();
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Tres tonos de neón (vivos y claros) a partir del color principal del negocio.
export function neonPalette(primary: string | null | undefined): [string, string, string] {
  const hsl = primary ? hexToHsl(primary) : null;
  if (!hsl) return ["#38bdf8", "#8b5cf6", "#ec4899"];
  const [h, s] = hsl;
  const sat = Math.max(0.75, s);
  return [hslToHex((h - 25 + 360) % 360, sat, 0.62), hslToHex(h, sat, 0.58), hslToHex((h + 35) % 360, sat, 0.62)];
}
