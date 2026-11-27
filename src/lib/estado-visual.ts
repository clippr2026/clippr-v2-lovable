import type * as React from "react";

// Superficie de un turno o de un contador según su estado (Agenda y Mi Panel): base oscura
// sólida con un degradé suave del color del estado y un borde fino, sin resplandor.
export function estiloEstado(dot: string, border: string): React.CSSProperties {
  const mezcla = (pct: number) => `color-mix(in srgb, ${border} ${pct}%, transparent)`;
  return {
    color: dot,
    background: `linear-gradient(115deg, ${mezcla(26)} 0%, ${mezcla(9)} 72%), #12101d`,
    boxShadow: `inset 0 0 0 1px ${mezcla(55)}`,
    // Modo claro: el color del estado pasa a un punto o una línea sobre fondo neutro (ver styles.css).
    ["--estado" as string]: border,
  } as React.CSSProperties;
}
