// Compartido por las 10 secciones: si el usuario tiene
// prefers-reduced-motion activado, las animaciones de entrada/scroll deben
// saltar directo al estado final en vez de animar.
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Chequeo único al montar (no reactivo a resize/rotación) — mismo criterio
// que prefersReducedMotion de acá arriba. Usar solo cuando una animación
// necesita comportarse distinto en mobile vs desktop (breakpoint "lg", el
// mismo que ya usa el CSS de toda la landing) — para diferencias puramente
// visuales, mejor Tailwind responsive classes; esto es para lógica de GSAP
// que CSS no puede resolver.
export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 1023px)").matches;
}
