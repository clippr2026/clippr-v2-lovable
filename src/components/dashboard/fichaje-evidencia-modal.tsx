import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { getFichajeSelfieUrl, type FichajeHoyPersona } from "@/lib/fichaje";

const METHOD_LABEL: Record<string, string> = {
  qr: "QR del local",
  location: "Ubicación",
  admin: "Cargado por un administrador",
};

function horaCorta(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function Foto({ titulo, hora, metodo, path }: { titulo: string; hora: string; metodo: string | null; path: string | null }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(Boolean(path));

  React.useEffect(() => {
    let cancelled = false;
    if (!path) return;
    void getFichajeSelfieUrl(path).then((u) => {
      if (cancelled) return;
      setUrl(u);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-foreground">
          {titulo} · <span className="tabular-nums">{hora}</span>
        </span>
        {metodo && <span className="text-muted-foreground">{METHOD_LABEL[metodo] ?? metodo}</span>}
      </div>
      <div className="grid aspect-square place-items-center overflow-hidden rounded-xl bg-black/40 ring-1 ring-white/10">
        {url ? (
          <img src={url} alt={`Selfie de ${titulo.toLowerCase()}`} className="size-full -scale-x-100 object-cover" />
        ) : (
          <span className="px-3 text-center text-xs text-muted-foreground">
            {loading ? "Cargando…" : path ? "No se pudo cargar la foto" : "Sin foto"}
          </span>
        )}
      </div>
    </div>
  );
}

// Selfie y método (QR / ubicación) de la entrada y la salida de un fichaje de hoy.
export function FichajeEvidenciaModal({ persona, onClose }: { persona: FichajeHoyPersona; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Fichaje de {persona.name}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Foto
            titulo="Entrada"
            hora={horaCorta(persona.clockInAt)}
            metodo={persona.inMethod ?? null}
            path={persona.inSelfiePath ?? null}
          />
          {persona.clockOutAt && (
            <Foto
              titulo="Salida"
              hora={horaCorta(persona.clockOutAt)}
              metodo={persona.outMethod ?? null}
              path={persona.outSelfiePath ?? null}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
