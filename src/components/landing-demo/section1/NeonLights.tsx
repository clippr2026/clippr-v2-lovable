// Tubo de neón violeta ambiental del storyboard, del lado izquierdo — corto,
// tenue, no atado a la silla ni a la foto. (Hubo un segundo tubo acá,
// "neon-light-primary": una línea fina generada por CSS, sin base ni
// fixture propio, que arrancaba cerca del borde superior y se apagaba a la
// altura de la barra del fondo — SIN relación con el tubo alto y brillante
// que sí es parte real de la foto, junto a la silla. Se sacó por pedido
// explícito; ese tubo de la foto no se toca. No reintroducir esa línea fina
// si se vuelve a tocar este archivo.)
export function NeonLights() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
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
