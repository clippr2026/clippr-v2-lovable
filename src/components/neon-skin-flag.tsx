import * as React from "react";
import { useRouterState } from "@tanstack/react-router";
import { usaDisenoOscuro } from "@/lib/diseno-oscuro";

// Marca <html> con la clase "neon-skin" en toda la app de gestión. Las páginas públicas
// (/negocio, /reservar) quedan afuera: ahí manda el estilo que elige cada negocio.
export function NeonSkinFlag() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  React.useEffect(() => {
    const isPublic = pathname.startsWith("/negocio") || pathname.startsWith("/reservar");
    document.documentElement.classList.toggle("neon-skin", !isPublic);
    // Sistema visual oscuro unificado (ver styles.css, "app-oscuro").
    document.documentElement.classList.toggle("app-oscuro", usaDisenoOscuro(pathname));
    return () => document.documentElement.classList.remove("neon-skin", "app-oscuro");
  }, [pathname]);
  return null;
}
