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
 * (`rounded-2xl`), respetando siempre la posición de recorte guardada
 * (`position`, formato "50% 50%") en vez de recentrar la imagen.
 */
export interface ServiceImageProps {
  /** URL de la imagen. Si no hay imagen se muestra `fallback`. */
  src?: string | null;
  /** Texto alternativo (nombre del servicio/producto). */
  alt: string;
  /** object-position guardado, ej. "62% 40%". Por defecto "50% 50%". */
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
  position,
  className,
  imgClassName,
  fallback = null,
  loading = "lazy",
}: ServiceImageProps) {
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-2xl",
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
          className={cn("h-full w-full object-cover", imgClassName)}
          style={{ objectPosition: position?.trim() || "50% 50%" }}
        />
      ) : (
        fallback
      )}
    </div>
  );
}
