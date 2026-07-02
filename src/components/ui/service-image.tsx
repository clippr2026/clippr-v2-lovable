import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * ServiceImage
 *
 * Componente único y reutilizable para renderizar imágenes de SERVICIOS y
 * PRODUCTOS en toda la app (Configuración, Caja, Página pública, Reserva
 * online, Agenda). No define tamaños: el tamaño y el fondo del marco los
 * define quien lo usa vía `className` (ej. "size-10", "h-20 w-20"), así se
 * mantiene exactamente el tamaño que ya tenía cada pantalla.
 *
 * Por defecto es cuadrado, recorte `object-cover` y esquinas redondeadas
 * (`rounded-xl`). La imagen queda siempre fija y centrada: no usa
 * posiciones manuales ni offsets, para que se vea igual en toda la app.
 */
export interface ServiceImageProps {
  /** URL de la imagen. Si no hay imagen se muestra `fallback`. */
  src?: string | null;
  /** Texto alternativo (nombre del servicio/producto). */
  alt: string;
  /** Compatibilidad: se acepta, pero ya no se usa. Siempre se centra la imagen. */
  position?: string | null;
  /** Clases del contenedor: tamaño, fondo, ring, sombra, etc. */
  className?: string;
  /** Clases adicionales para el <img> (raramente necesario). */
  imgClassName?: string;
  /** Contenido a mostrar cuando no hay imagen (ícono, inicial, etc.). */
  fallback?: React.ReactNode;
  loading?: "lazy" | "eager";
}

export function ServiceImage({
  src,
  alt,
  className,
  imgClassName,
  fallback = null,
  loading = "lazy",
}: ServiceImageProps) {
  return (
    <div
      className={cn(
        "grid aspect-square shrink-0 place-items-center overflow-hidden rounded-xl",
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          draggable={false}
          className={cn("h-full w-full object-cover object-center", imgClassName)}
          style={{ objectPosition: "center center" }}
        />
      ) : (
        fallback
      )}
    </div>
  );
}
