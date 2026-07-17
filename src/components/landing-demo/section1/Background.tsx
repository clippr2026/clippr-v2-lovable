// Fondo base de la Sección 1: negro casi puro (igual al storyboard) con un
// resplandor violeta muy tenue que sube desde donde viven las luces de neón,
// para que la escena no quede flotando sobre un negro plano.
export function Background() {
  return (
    <div className="absolute inset-0 -z-30 bg-[#050308]">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 78% 78%, oklch(0.5 0.22 290 / 0.16), transparent 60%)",
        }}
      />
    </div>
  );
}
