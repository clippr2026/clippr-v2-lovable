import { SCENE_LIFT_CLASS } from "./Scene";

// Los dos tubos de neón violeta del storyboard: uno alto y brillante junto
// a la silla, y uno más tenue y corto del lado izquierdo. Son divs propios
// (no parte de la foto) para poder animarlos/pulsarlos por separado con GSAP.
export function NeonLights() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* El tubo derecho acompaña visualmente a la silla en la foto, así
          que sube lo mismo que Scene.tsx (misma clase) para seguir
          integrado con ella. El izquierdo es ambiental, no está atado a la
          foto, y se queda donde está. */}
      <NeonTube
        className={`neon-light-primary absolute right-[27%] top-[6%] h-[68%] w-[3px] sm:right-[30%] sm:w-[4px] ${SCENE_LIFT_CLASS}`}
        intensity="high"
      />
      <NeonTube
        className="neon-light-secondary absolute left-[4%] top-[46%] h-[34%] w-[2px] opacity-70 sm:top-[44%]"
        intensity="low"
      />
    </div>
  );
}

function NeonTube({
  className,
  intensity,
}: {
  className: string;
  intensity: "high" | "low";
}) {
  // rgba puro (no oklch): mezclar varios box-shadow en oklch producía una
  // franja con el canal azul en 0 (artefacto de composición del navegador)
  // a mitad del tubo. Mismos tonos violeta, sin el bug.
  const glow =
    intensity === "high"
      ? "0 0 6px 2px rgba(196,181,253,0.95), 0 0 22px 8px rgba(139,92,246,0.85), 0 0 70px 26px rgba(109,40,217,0.55)"
      : "0 0 5px 1.5px rgba(196,181,253,0.7), 0 0 16px 6px rgba(139,92,246,0.5)";

  return (
    <div
      className={`neon-light rounded-full ${className}`}
      style={{
        background:
          "linear-gradient(180deg, transparent 0%, #efe8ff 8%, #efe8ff 92%, transparent 100%)",
        boxShadow: glow,
      }}
    />
  );
}
