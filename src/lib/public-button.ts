import type * as React from "react";

// Botón principal de las páginas públicas (reservas, perfil, reseñas): el color de acento elegido
// por el negocio, un poco más profundo y con degradé, borde de luz y un resplandor del mismo color.
export function publicButtonStyle(accent: string, text: string): React.CSSProperties {
  return {
    background: `linear-gradient(180deg, color-mix(in oklch, ${accent} 94%, white) 0%, color-mix(in oklch, ${accent} 90%, black) 100%)`,
    border: `1px solid color-mix(in oklch, ${accent} 55%, white)`,
    color: text,
    WebkitTextFillColor: text,
    boxShadow: `0 0 26px -4px color-mix(in oklch, ${accent} 85%, transparent), inset 0 1px 0 rgba(255,255,255,0.3)`,
  };
}
