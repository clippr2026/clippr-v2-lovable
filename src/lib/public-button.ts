import type * as React from "react";

// Botón principal de las páginas públicas (reservas, perfil, reseñas): el color de acento elegido
// por el negocio, con degradé suave y un resplandor del mismo color, para que se vea fuerte.
export function publicButtonStyle(accent: string, text: string): React.CSSProperties {
  return {
    background: `linear-gradient(180deg, color-mix(in oklch, ${accent} 84%, white) 0%, ${accent} 52%, color-mix(in oklch, ${accent} 90%, black) 100%)`,
    color: text,
    WebkitTextFillColor: text,
    boxShadow: `0 0 22px -3px color-mix(in oklch, ${accent} 78%, transparent), inset 0 1px 0 rgba(255,255,255,0.35)`,
  };
}
