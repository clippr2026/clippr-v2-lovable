import * as React from "react";
import { createPortal } from "react-dom";
import { Camera, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Botón que abre opciones propias (estilo Clippr): solo Fototeca o Tomar foto,
// sin la opción "Seleccionar archivo" del selector del sistema.
export function ElegirImagen({
  onFile,
  disabled,
  className,
  onOpen,
  children,
}: {
  onFile: (file: File | null) => void;
  disabled?: boolean;
  className?: string;
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  const galeriaRef = React.useRef<HTMLInputElement>(null);
  const camaraRef = React.useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = React.useState(false);

  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    onFile(f);
  };

  return (
    <>
      <input ref={galeriaRef} type="file" accept="image/*" className="hidden" onChange={alElegir} />
      <input ref={camaraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={alElegir} />
      <button
        type="button"
        disabled={disabled}
        className={className}
        onClick={() => {
          onOpen?.();
          setAbierto(true);
        }}
      >
        {children}
      </button>
      {abierto &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[10060] flex items-end justify-center bg-black/70 p-4 pb-10 backdrop-blur-sm"
            onClick={() => setAbierto(false)}
          >
            <div
              className="w-full max-w-sm space-y-1.5 rounded-[28px] border border-violet-400/45 bg-[#08070f] p-2.5 shadow-[0_0_0_1px_rgba(139,92,246,0.3),0_24px_60px_-12px_rgba(0,0,0,0.9),0_0_40px_-14px_rgba(139,92,246,0.6)] [background-image:radial-gradient(120%_60%_at_85%_0%,rgba(79,125,255,0.18),transparent_60%),radial-gradient(110%_60%_at_0%_100%,rgba(139,92,246,0.2),transparent_62%)]"
              onClick={(e) => e.stopPropagation()}
            >
              {(
                [
                  ["Fototeca", ImageIcon, galeriaRef],
                  ["Tomar foto", Camera, camaraRef],
                ] as const
              ).map(([nombre, Icono, ref]) => (
                <button
                  key={nombre}
                  type="button"
                  onClick={() => {
                    setAbierto(false);
                    ref.current?.click();
                  }}
                  className={cn(
                    "flex h-14 w-full items-center gap-3 rounded-2xl px-4 text-left text-lg font-semibold text-white transition hover:bg-violet-500/20 active:bg-violet-500/25",
                  )}
                >
                  <Icono className="size-6 shrink-0 text-violet-200" />
                  {nombre}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="h-12 w-full rounded-2xl text-base font-semibold text-white/60 transition hover:text-white"
              >
                Cancelar
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
