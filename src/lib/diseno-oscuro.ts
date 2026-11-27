import { PUBLIC_PATHS } from "@/lib/color-mode";

// Pantallas que llevan el sistema visual oscuro unificado: toda la app de gestión.
// Quedan afuera las páginas para clientes y de ingreso (tienen su propio diseño) e Inicio,
// que es la referencia del sistema y no se modifica.
export function usaDisenoOscuro(pathname: string): boolean {
  return !PUBLIC_PATHS.test(pathname) && !/^\/dashboard(\/|$)/i.test(pathname);
}
