import * as React from "react";
import chairHero from "@/assets/landing/section10/chair-hero.png";

// El sillón como fondo real de toda la sección, no una imagen insertada en
// un bloque — mismo criterio que la escena de la Sección 1. La foto es
// vertical (retrato, mucho negro arriba/abajo del sillón); object-cover
// sobre una caja ancha ya recorta ese sobrante y agranda el sillón solo
// con eso; el scale extra lo agranda un poco más ("mucho más grande,
// especialmente el sillón"). object-position sesgado a la derecha: en
// desktop dos columnas, la mitad derecha de la FOTO (no del viewport) es
// la que tiene que quedar visible ahí.
export const Scene = React.forwardRef<HTMLDivElement>(function Scene(_props, ref) {
  return (
    <div ref={ref} className="absolute inset-0 -z-20">
      <img
        src={chairHero}
        alt=""
        aria-hidden="true"
        className="h-full w-full object-cover"
        style={{
          objectPosition: "72% 40%",
          transform: "scale(1.15)",
          transformOrigin: "72% 40%",
        }}
      />
      {/* Degradado oscuro de izquierda a derecha: el texto vive a la
          izquierda (necesita contraste fuerte), el sillón respira a la
          derecha (necesita verse casi sin velo). En mobile ambos —texto e
          imagen— comparten todo el ancho, así que se suma un velo parejo
          más fuerte para que el texto arriba siga siendo legible sin
          taparle el protagonismo al sillón más abajo. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(5,3,8,0.96) 0%, rgba(5,3,8,0.82) 32%, rgba(5,3,8,0.35) 58%, transparent 82%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 lg:hidden"
        style={{ background: "rgba(5,3,8,0.4)" }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(5,3,8,0.5) 0%, transparent 18%, transparent 78%, rgba(5,3,8,0.65) 100%)",
        }}
      />
    </div>
  );
});
