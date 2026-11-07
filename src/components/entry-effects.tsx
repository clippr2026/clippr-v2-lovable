import * as React from "react";
import { NeonFrame } from "@/components/neon-frame";

// Efectos de entrada de la página pública: cómo aparecen el logo y la portada
// cuando alguien entra. La clave se guarda en _branding.entry_effect.
export type EntryEffectKey =
  | "neon" | "fade" | "zoom" | "pulso" | "deslizar" | "rebote" | "giro" | "enfoque" | "destello" | "flotar"
  | "elastico" | "cortina" | "revelar" | "brillo" | "vibrar" | "oscilar" | "none";

export const ENTRY_EFFECTS: { key: Exclude<EntryEffectKey, "none">; label: string }[] = [
  { key: "neon", label: "Neón" },
  { key: "fade", label: "Aparecer suave" },
  { key: "zoom", label: "Zoom" },
  { key: "pulso", label: "Pulso de luz" },
  { key: "deslizar", label: "Deslizar" },
  { key: "rebote", label: "Rebote" },
  { key: "giro", label: "Giro" },
  { key: "enfoque", label: "Enfoque" },
  { key: "destello", label: "Destello" },
  { key: "flotar", label: "Flotar" },
  { key: "elastico", label: "Elástico" },
  { key: "cortina", label: "Cortina" },
  { key: "revelar", label: "Revelar" },
  { key: "brillo", label: "Brillo" },
  { key: "vibrar", label: "Vibrar" },
  { key: "oscilar", label: "Oscilar" },
];

const EFFECT_KEYS = new Set<string>(["none", ...ENTRY_EFFECTS.map((e) => e.key)]);

export function normalizeEntryEffect(value: unknown): EntryEffectKey {
  return typeof value === "string" && EFFECT_KEYS.has(value) ? (value as EntryEffectKey) : "neon";
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
      @keyframes fxSlideUp { from { opacity: 0; transform: translateY(60px); } to { opacity: 1; transform: none; } }
      @keyframes fxSlideDown { from { opacity: 0; transform: translateY(-40px); } to { opacity: 1; transform: none; } }
      @keyframes fxBounce { 0% { transform: translateY(-80px); opacity: 0; } 45% { transform: translateY(0); opacity: 1; } 62% { transform: translateY(-22px); } 78% { transform: translateY(0); } 90% { transform: translateY(-7px); } 100% { transform: translateY(0); } }
      @keyframes fxSpin { from { transform: rotate(-200deg) scale(.3); opacity: 0; } to { transform: none; opacity: 1; } }
      @keyframes fxBlur { from { filter: blur(16px); opacity: .2; } to { filter: blur(0); opacity: 1; } }
      @keyframes fxFlash { 0% { filter: brightness(4) saturate(.3); opacity: .3; } 40% { filter: brightness(2.2); opacity: 1; } 100% { filter: none; } }
      @keyframes fxFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
      @keyframes fxElastic { 0% { transform: scale(0); } 40% { transform: scale(1.25); } 60% { transform: scale(.9); } 80% { transform: scale(1.06); } 100% { transform: scale(1); } }
      @keyframes fxCurtain { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
      @keyframes fxReveal { from { clip-path: circle(0% at 50% 50%); } to { clip-path: circle(75% at 50% 50%); } }
      @keyframes fxShake { 0%,100% { transform: translateX(0); } 15% { transform: translateX(-9px) rotate(-3deg); } 30% { transform: translateX(8px) rotate(3deg); } 45% { transform: translateX(-6px); } 60% { transform: translateX(5px); } 80% { transform: translateX(-2px); } }
      @keyframes fxSwing { 0% { transform: rotate(-18deg); opacity: 0; } 30% { transform: rotate(12deg); opacity: 1; } 55% { transform: rotate(-8deg); } 80% { transform: rotate(4deg); } 100% { transform: rotate(0); } }
      @keyframes fxShine { 0%,100% { filter: brightness(1) drop-shadow(0 0 0 transparent); } 50% { filter: brightness(1.35) drop-shadow(0 0 18px rgba(255,255,255,.65)); } }
      @keyframes fxSplashSlide { 0%,100% { transform: translateY(10px); opacity: .5; } 50% { transform: translateY(-6px); opacity: 1; } }
      @keyframes fxSplashSpin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
      @keyframes fxSplashBlur { 0%,100% { filter: blur(8px); } 50% { filter: blur(0); } }
      @keyframes fxSplashFlash { 0%,100% { filter: brightness(1); } 50% { filter: brightness(2.4); } }
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
    case "deslizar":
      return { animation: "fxSlideUp .9s cubic-bezier(.2,.8,.2,1) both" };
    case "rebote":
      return { animation: "fxBounce 1.1s ease-out both" };
    case "giro":
      return { animation: "fxSpin 1s cubic-bezier(.2,.8,.2,1) both" };
    case "enfoque":
      return { animation: "fxBlur 1.3s ease-out both" };
    case "destello":
      return { animation: "fxFlash 1.3s ease-out both" };
    case "flotar":
      return { animation: "fxFloat 2s ease-in-out 2" };
    case "elastico":
      return { animation: "fxElastic 1.2s ease-out both" };
    case "cortina":
      return { animation: "fxFade 1.2s ease-out .3s both" };
    case "revelar":
      return { animation: "fxReveal 1.1s ease-out both" };
    case "brillo":
      return { animation: "fxShine 1.1s ease-in-out 3" };
    case "vibrar":
      return { animation: "fxShake .9s ease-in-out both" };
    case "oscilar":
      return { animation: "fxSwing 1.3s ease-out both" };
    default:
      return {};
  }
}
export function coverFxStyle(effect: EntryEffectKey, play: boolean): React.CSSProperties {
  if (!play) return {};
  if (effect === "fade") return { animation: "fxFade 1.3s ease-out both" };
  if (effect === "zoom") return { animation: "fxCoverZoom 2s cubic-bezier(.2,.7,.2,1) both" };
  if (effect === "deslizar") return { animation: "fxSlideDown .9s cubic-bezier(.2,.8,.2,1) both" };
  if (effect === "enfoque") return { animation: "fxBlur 1.3s ease-out both" };
  if (effect === "destello") return { animation: "fxFlash 1.3s ease-out both" };
  if (effect === "cortina") return { animation: "fxCurtain 1.2s cubic-bezier(.7,0,.2,1) both" };
  if (effect === "revelar") return { animation: "fxReveal 1.4s ease-out both" };
  return {};
}
export function CoverSweep({ effect, play }: { effect: EntryEffectKey; play: boolean }) {
  if (!play || (effect !== "pulso" && effect !== "brillo")) return null;
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

const SPLASH_ANIM: Partial<Record<EntryEffectKey, string>> = {
  zoom: "fxSplashZoom 1.4s ease-in-out infinite",
  deslizar: "fxSplashSlide 1.4s ease-in-out infinite",
  rebote: "fxBounce 1.1s ease-out infinite",
  giro: "fxSplashSpin 1.6s linear infinite",
  enfoque: "fxSplashBlur 1.6s ease-in-out infinite",
  destello: "fxSplashFlash 1.3s ease-in-out infinite",
  flotar: "fxFloat 1.6s ease-in-out infinite",
  elastico: "fxElastic 1.3s ease-out infinite",
  cortina: "fxCurtain 1.4s cubic-bezier(.7,0,.2,1) infinite alternate",
  revelar: "fxReveal 1.4s ease-out infinite alternate",
  brillo: "fxShine 1.4s ease-in-out infinite",
  vibrar: "fxShake 1s ease-in-out infinite",
  oscilar: "fxSwing 1.5s ease-in-out infinite",
};

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
  const box = "grid h-44 w-44 place-items-center overflow-hidden sm:h-56 sm:w-56";
  return (
    <div
      className={overlay ? "fixed inset-0 z-[100] grid place-items-center" : "grid min-h-dvh place-items-center"}
      style={{ background: light ? "#ffffff" : "#08070c" }}
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
      ) : effect === "pulso" ? (
        <div
          className={`fx-anim rounded-[1.7rem] ${box}`}
          style={{
            animation: "fxHeart 1.2s ease-in-out infinite",
            boxShadow: `0 0 30px ${colors[1]}, 0 0 70px ${colors[2]}88`,
          }}
        >
          {img}
        </div>
      ) : (
        <div className={`fx-anim rounded-[1.7rem] ${box}`} style={{ animation: SPLASH_ANIM[effect] ?? "fxSplashZoom 1.4s ease-in-out infinite" }}>
          {img}
        </div>
      )}
    </div>
  );
}
