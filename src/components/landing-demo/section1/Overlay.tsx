// Overlays de legibilidad: oscurece la mitad izquierda (donde vive el texto)
// y agrega viñetas arriba/abajo, igual que en el storyboard, sin depender
// de la foto de fondo para el contraste del texto.
export function Overlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.42) 38%, rgba(0,0,0,0.08) 62%, transparent 80%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, transparent 22%, transparent 72%, rgba(0,0,0,0.65) 100%)",
        }}
      />
    </div>
  );
}
