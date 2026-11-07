import * as React from "react";
import { useRouterState } from "@tanstack/react-router";

// Marca <html> con la clase "neon-skin" en toda la app de gestión. Las páginas públicas
// (/negocio, /reservar) quedan afuera: ahí manda el estilo que elige cada negocio.
export function NeonSkinFlag() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  React.useEffect(() => {
    const isPublic = pathname.startsWith("/negocio") || pathname.startsWith("/reservar");
    document.documentElement.classList.toggle("neon-skin", !isPublic);
    return () => document.documentElement.classList.remove("neon-skin");
  }, [pathname]);
  return null;
}
