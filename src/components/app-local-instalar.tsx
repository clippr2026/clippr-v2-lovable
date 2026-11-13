import * as React from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { PushAvisosButton } from "@/components/push-avisos-button";
import { esIphoneSinInstalar } from "@/lib/push";
import { cn } from "@/lib/utils";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function appInstalada() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

// "Instalar app" + "Activar avisos" de la página pública de un local (cualquier local, una o varias sucursales).
// Android/Chrome: abre el cuadro de instalación del navegador. iPhone: guía de 2 pasos (Safari no tiene botón de instalar).
// El nombre y el ícono de la app instalada salen del local (manifest por slug). Si la app ya está instalada, solo queda "Avisos".
export function AppLocalInstalar({
  slug,
  nombre,
  className,
}: {
  slug: string;
  nombre: string;
  className?: string;
}) {
  const [evento, setEvento] = React.useState<InstallPromptEvent | null>(null);
  const [instalada, setInstalada] = React.useState(false);
  const [iphone, setIphone] = React.useState(false);
  const [guia, setGuia] = React.useState(false);

  React.useEffect(() => {
    setInstalada(appInstalada());
    setIphone(esIphoneSinInstalar());
    const alPedir = (e: Event) => {
      e.preventDefault();
      setEvento(e as InstallPromptEvent);
    };
    const alInstalar = () => {
      setEvento(null);
      setInstalada(true);
    };
    window.addEventListener("beforeinstallprompt", alPedir);
    window.addEventListener("appinstalled", alInstalar);
    return () => {
      window.removeEventListener("beforeinstallprompt", alPedir);
      window.removeEventListener("appinstalled", alInstalar);
    };
  }, []);

  // El iPhone toma el nombre de la app de esta etiqueta al "Agregar a pantalla de inicio".
  React.useEffect(() => {
    if (!nombre) return;
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", nombre);
  }, [nombre]);

  async function instalar() {
    if (evento) {
      await evento.prompt();
      await evento.userChoice.catch(() => null);
      setEvento(null);
    } else if (iphone) {
      setGuia(true);
    }
  }

  const puedeInstalar = !instalada && (Boolean(evento) || iphone);

  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-3", className)}>
      {puedeInstalar ? (
        <button
          type="button"
          onClick={instalar}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-violet-400/50 bg-violet-500/15 px-5 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/25"
        >
          <Download className="size-4" />
          Instalar app
        </button>
      ) : null}
      <PushAvisosButton app="auro" businessSlug={slug} />

      {guia ? (
        <div
          className="fixed inset-0 z-[300] flex items-end justify-center bg-black/60 px-4 pb-6 backdrop-blur-sm sm:items-center"
          onClick={() => setGuia(false)}
        >
          <div
            className="relative w-full max-w-sm rounded-3xl border border-violet-400/40 bg-[#0b0a14] p-6 text-white shadow-2xl"
            style={{ boxShadow: "0 0 40px -10px rgba(139,92,246,0.55)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Cerrar"
              onClick={() => setGuia(false)}
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-white/60 hover:bg-white/10"
            >
              <X className="size-4" />
            </button>
            <h3 className="pr-8 text-lg font-bold">Instalá {nombre || "la app"} en tu iPhone</h3>
            <p className="mt-1 text-sm text-white/60">Abrí esta página en Safari y seguí estos pasos:</p>
            <ol className="mt-4 space-y-3 text-sm">
              <li className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10">
                  <Share className="size-4" />
                </span>
                Tocá <b>Compartir</b> (el cuadrado con la flecha, abajo).
              </li>
              <li className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10">
                  <SquarePlus className="size-4" />
                </span>
                Elegí <b>Agregar a pantalla de inicio</b>.
              </li>
              <li className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10">
                  <Download className="size-4" />
                </span>
                Abrila desde el ícono y activá los avisos.
              </li>
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  );
}
