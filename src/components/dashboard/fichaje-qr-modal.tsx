import * as React from "react";
import { createPortal } from "react-dom";
import { Building2, X } from "lucide-react";

// Modal/overlay con el QR + código del día — se abre desde la tarjeta
// "Fichaje de jornada" de Inicio sin salir de la pantalla. La vista
// kiosco (/fichaje-kiosco/$branchId) se mantiene aparte, pensada para
// quedar abierta todo el día en una tablet del local — esto es solo
// para mirarlo rápido sin navegar.
export function FichajeQrModal({
  branchName,
  code,
  branchId,
  onClose,
}: {
  branchName: string;
  code: string;
  branchId: string;
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;

  const fichaUrl = `${window.location.origin}/fichar/${branchId}?code=${code}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(fichaUrl)}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-sm flex-col items-center gap-5 rounded-t-3xl border border-white/10 bg-zinc-950 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 sm:rounded-3xl sm:py-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Building2 className="h-4 w-4 text-violet-300" />
            {branchName}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-full p-1.5 text-muted-foreground ring-1 ring-white/10 hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="text-sm text-muted-foreground capitalize">
          {new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
        </div>
        <img
          src={qrSrc}
          alt="Código QR de fichaje"
          width={260}
          height={260}
          className="rounded-2xl border border-white/10 bg-white p-3"
        />
        <div className="rounded-xl bg-white/5 px-6 py-3 ring-1 ring-white/10 text-center">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
            Código
          </div>
          <div className="mt-1 font-mono text-2xl font-bold tracking-[0.3em] text-foreground">
            {code}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
