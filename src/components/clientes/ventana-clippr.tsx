import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

// Ventana "estilo Clippr": centrada, fondo oscuro con luz violeta/celeste, siempre por encima de la barra de arriba (se dibuja
// directo en <body>, así no queda tapada por ningún contenedor) y con una X para cerrarla.
export function VentanaClippr({
  titulo,
  subtitulo,
  onClose,
  onVolver,
  footer,
  ancho = "max-w-lg",
  children,
}: {
  titulo: React.ReactNode;
  subtitulo?: React.ReactNode;
  onClose: () => void;
  /** Si se pasa, muestra una flecha para volver al nivel anterior (por ejemplo, de un detalle a la lista). */
  onVolver?: () => void;
  footer?: React.ReactNode;
  ancho?: string;
  children: React.ReactNode;
}) {
  // La ventana solo existe mientras está abierta: se congela el fondo para que no se mueva por detrás.
  useBodyScrollLock(true);
  React.useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-start sm:items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      onClick={onClose}
    >
      <div
        className={`flex w-full ${ancho} max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-[28px] border border-violet-400/45 bg-[#08070f]`}
        style={{
          boxShadow: "0 0 0 1px rgba(139,92,246,.35), 0 30px 90px -20px rgba(0,0,0,.9), 0 0 60px -18px rgba(139,92,246,.55)",
          backgroundImage:
            "radial-gradient(120% 45% at 85% 0%, rgba(79,125,255,.20), transparent 60%), radial-gradient(110% 50% at 0% 100%, rgba(139,92,246,.22), transparent 62%)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            {onVolver && (
              <button
                type="button"
                onClick={onVolver}
                aria-label="Volver"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/10"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-white">{titulo}</div>
              {subtitulo ? <div className="mt-0.5 text-xs text-white/55">{subtitulo}</div> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">{children}</div>
        {footer ? <div className="shrink-0 flex justify-end gap-2 border-t border-white/5 px-5 py-4">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
