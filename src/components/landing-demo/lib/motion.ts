// Compartido por las 10 secciones: si el usuario tiene
// prefers-reduced-motion activado, las animaciones de entrada/scroll deben
// saltar directo al estado final en vez de animar.
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
