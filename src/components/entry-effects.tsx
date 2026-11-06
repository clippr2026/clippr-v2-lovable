import * as React from "react";
import { NeonFrame } from "@/components/neon-frame";

// Efectos de entrada de la página pública: cómo aparecen el logo y la portada
// cuando alguien entra. La clave se guarda en _branding.entry_effect.
export type EntryEffectKey = "neon" | "fade" | "zoom" | "pulso" | "none";

export const ENTRY_EFFECTS: { key: Exclude<EntryEffectKey, "none">; label: string; desc: string }[] = [
  { key: "neon", label: "Neón", desc: "Un aro de luz recorre el logo y queda quieto." },
  { key: "fade", label: "Aparecer suave", desc: "El logo y la portada aparecen con un fundido." },
  { key: "zoom", label: "Zoom", desc: "La portada se acerca y el logo salta a su lugar." },
  { key: "pulso", label: "Pulso de luz", desc: "El logo late con luz y un destello cruza la portada." },
];

export function normalizeEntryEffect(value: unknown): EntryEffectKey {
  return value === "none" || value === "fade" || value === "zoom" || value === "pulso" || value === "neon" ? value : "neon";
}

// Keyframes y clases (se montan una sola vez dentro de la página).
export function EntryEffectStyles() {
  return (
    <style>{`
      @keyframes fxFadeUp { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
      @keyframes fxFade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes fxCoverZoom { from { transform: scale(1.22); } to { transform: scale(1); } }
      @keyframes fxPop { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); } }
      @keyframes fxHeart { 0%,100% { transform: scale(1); filter: brightness(1); } 35% { transform: scale(1.09); filter: brightness(1.45); } 60% { transform: scale(1.02); filter: brightness(1.15); } }
      @keyframes fxSweep { from { transform: translateX(-120%) skewX(-18deg); } to { transform: translateX(260%) skewX(-18deg); } }
      @keyframes fxSplashFade { 0%,100% { opacity: .35; transform: scale(.94); } 50% { opacity: 1; transform: scale(1); } }
      @keyframes fxSplashZoom { 0%,100% { transform: scale(.9); } 50% { transform: scale(1.08); } }
      @media (prefers-reduced-motion: reduce) { .fx-anim, .fx-anim * { animation: none !important; } }
    `}</style>
  );
}

// Clases/estilos de animación para el logo (avatar) y la portada según el efecto.
export function avatarFxStyle(effect: EntryEffectKey, play: boolean): React.CSSProperties {
  if (!play) return {};
  switch (effect) {
    case "fade":
      return { animation: "fxFadeUp 1.1s ease-out both" };
    case "zoom":
      return { animation: "fxPop .9s cubic-bezier(.2,.8,.2,1.2) both" };
    case "pulso":
      return { animation: "fxHeart 1.1s ease-in-out 3" };
    default:
      return {};
  }
}
export function coverFxStyle(effect: EntryEffectKey, play: boolean): React.CSSProperties {
  if (!play) return {};
  if (effect === "fade") return { animation: "fxFade 1.3s ease-out both" };
  if (effect === "zoom") return { animation: "fxCoverZoom 2s cubic-bezier(.2,.7,.2,1) both" };
  return {};
}
export function CoverSweep({ effect, play }: { effect: EntryEffectKey; play: boolean }) {
  if (!play || effect !== "pulso") return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      <div
        className="fx-anim absolute inset-y-0 left-0 w-1/3"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent)",
          animation: "fxSweep 1.6s ease-in-out .3s 1 both",
        }}
      />
    </div>
  );
}

// Pantalla de carga con el logo del local (distinta según el efecto elegido).
export function EntrySplash({
  logo,
  effect,
  colors,
  light,
  overlay = false,
}: {
  logo: string;
  effect: EntryEffectKey;
  colors: [string, string, string];
  light: boolean;
  overlay?: boolean;
}) {
  const img = <img src={logo} alt="" className="h-full w-full object-cover" decoding="async" />;
  const box = "grid h-28 w-28 place-items-center overflow-hidden sm:h-32 sm:w-32";
  return (
    <div
      className={overlay ? "fixed inset-0 z-[100] grid place-items-center" : "grid min-h-dvh place-items-center"}
      style={{ background: light ? "#f6f7fb" : "#08070c" }}
    >
      <EntryEffectStyles />
      {effect === "neon" ? (
        <NeonFrame colors={colors} mode="loop">
          <div className={box}>{img}</div>
        </NeonFrame>
      ) : effect === "fade" ? (
        <div className={`fx-anim rounded-[1.7rem] ${box}`} style={{ animation: "fxSplashFade 1.6s ease-in-out infinite" }}>
          {img}
        </div>
      ) : effect === "zoom" ? (
        <div className={`fx-anim rounded-[1.7rem] ${box}`} style={{ animation: "fxSplashZoom 1.4s ease-in-out infinite" }}>
          {img}
        </div>
      ) : (
        <div
          className={`fx-anim rounded-[1.7rem] ${box}`}
          style={{
            animation: "fxHeart 1.2s ease-in-out infinite",
            boxShadow: `0 0 30px ${colors[1]}, 0 0 70px ${colors[2]}88`,
          }}
        >
          {img}
        </div>
      )}
    </div>
  );
}
