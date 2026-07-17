import * as React from "react";

// active=false: horario todavía sin elegir en el demo automático de la
// tarjeta — el botón se ve apagado (menos opacidad, sin glow), nunca
// disabled de verdad (sigue siendo un botón decorativo, tabIndex={-1}).
// El pulso continuo que tenía antes (Section2.tsx, boxShadow animado por
// GSAP en loop) se sacó: peleaba por la misma propiedad con este
// encendido/apagado — GSAP pisa el estilo inline en cada tick y React lo
// vuelve a pisar en cada render, resultado inconsistente. El "glow
// progresivo" pedido es este mismo cambio de opacity+boxShadow
// transicionando suave, no un parpadeo de fondo.
export function BookButton({ active = true }: { active?: boolean }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="w-full rounded-2xl py-4 text-center text-base font-bold text-white transition-all duration-500 ease-out hover:brightness-110"
      style={{
        background: "linear-gradient(135deg, oklch(0.62 0.24 292), oklch(0.46 0.24 296))",
        boxShadow: active
          ? "0 12px 32px -10px oklch(0.55 0.26 292 / 0.7)"
          : "0 12px 32px -10px oklch(0.55 0.26 292 / 0)",
        opacity: active ? 1 : 0.45,
      }}
    >
      Reservar turno
    </button>
  );
}
