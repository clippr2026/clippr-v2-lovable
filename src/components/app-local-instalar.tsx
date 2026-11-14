import * as React from "react";
import { Copy, Download, Share, SquarePlus, X } from "lucide-react";
import { toast } from "sonner";
import { PushAvisosButton } from "@/components/push-avisos-button";
import { esIphoneSinInstalar } from "@/lib/push";
import { cn } from "@/lib/utils";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function appInstalada() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

// Navegador interno de Instagram/Facebook/TikTok, etc.: ahí no existe "Agregar a pantalla de inicio".
function navegadorInterno() {
  if (typeof navigator === "undefined") return false;
  return /Instagram|FBAN|FBAV|FB_IAB|Messenger|TikTok|musical_ly|Snapchat|Line\//i.test(navigator.userAgent);
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
  const [interno, setInterno] = React.useState(false);
  const [desdeLink, setDesdeLink] = React.useState(false);

  React.useEffect(() => {
    setInstalada(appInstalada());
    setIphone(esIphoneSinInstalar());
    setInterno(navegadorInterno());
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

  // Link del correo ("Instalar la app" → ?instalar=1): se muestra la guía de una, sin otro toque.
  const contenedor = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get("instalar") !== "1") return;
    contenedor.current?.scrollIntoView({ block: "center" });
    setDesdeLink(true);
    if (esIphoneSinInstalar() || navegadorInterno()) setGuia(true);
  }, []);

  // La app instalada es la de ESTE local: manifest, ícono y nombre se ajustan a su slug (por ejemplo en /gestion,
  // que no lleva el slug en la URL). El iPhone lee estas etiquetas al "Agregar a pantalla de inicio".
  React.useEffect(() => {
    document
      .querySelector('link[rel="manifest"]')
      ?.setAttribute(
        "href",
        `/api/pwa-manifest?slug=${slug}&name=${encodeURIComponent(nombre || slug)}` +
          (window.location.pathname.startsWith("/negocio/") ? `&start=${encodeURIComponent(`/negocio/${slug}`)}` : ""),
      );
    document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", `/api/pwa-icon?slug=${slug}&size=180`);
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", nombre || slug);
  }, [slug, nombre]);

  async function instalar() {
    if (evento) {
      await evento.prompt();
      await evento.userChoice.catch(() => null);
      setEvento(null);
    } else if (iphone || interno) {
      setGuia(true);
    }
  }

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin + window.location.pathname);
      toast.success(`Link copiado. Pegalo en ${navegador}.`);
    } catch {
      toast.error("No se pudo copiar el link");
    }
  }

  const android = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  const navegador = android ? "Chrome" : "Safari";

  // Llegó desde "Instalar app" (correo o Instagram) en un navegador que puede instalar: un solo toque grande.
  const cartelUnToque = desdeLink && Boolean(evento) && !instalada;

  const puedeInstalar = !instalada && (Boolean(evento) || iphone || interno);

  return (
    <div ref={contenedor} className={cn("flex flex-wrap items-center justify-center gap-3", className)}>
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

      {cartelUnToque ? (
        <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/60 px-4 pb-6 backdrop-blur-sm sm:items-center">
          <div
            className="relative w-full max-w-sm rounded-3xl border border-violet-400/40 bg-[#0b0a14] p-6 text-center text-white shadow-2xl"
            style={{ boxShadow: "0 0 40px -10px rgba(139,92,246,0.55)" }}
          >
            <button
              type="button"
              aria-label="Cerrar"
              onClick={() => setDesdeLink(false)}
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-white/60 hover:bg-white/10"
            >
              <X className="size-4" />
            </button>
            <h3 className="text-lg font-bold">Instalá {nombre || "la app"}</h3>
            <p className="mt-1 text-sm text-white/60">Tus turnos y avisos, a un toque desde la pantalla de inicio.</p>
            <button
              type="button"
              onClick={async () => {
                await instalar();
                setDesdeLink(false);
              }}
              className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-violet-500 text-base font-semibold text-white"
            >
              <Download className="size-5" />
              Instalar app
            </button>
          </div>
        </div>
      ) : null}

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
            <h3 className="pr-8 text-lg font-bold">Instalá {nombre || "la app"} en tu celular</h3>
            {interno ? (
              <>
                <p className="mt-2 text-sm text-white/70">
                  Para instalar la app, ingresá desde {navegador}.
                </p>
                {android ? (
                  // Android: el link "intent" abre Chrome directo (si el navegador interno lo bloquea, cae al link normal).
                  <a
                    href={`intent://${window.location.host}${window.location.pathname}?instalar=1#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(window.location.href)};end`}
                    className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-violet-500 text-sm font-semibold text-white"
                  >
                    <Download className="size-4" />
                    Abrir en Chrome e instalar
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={copiarLink}
                  className={cn(
                    "inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-violet-400/50 bg-violet-500/15 text-sm font-semibold text-violet-100",
                    android ? "mt-3" : "mt-5",
                  )}
                >
                  <Copy className="size-4" />
                  Copiar link para pegarlo en {navegador}
                </button>
              ) : (
              <>
                <p className="mt-1 text-sm text-white/60">Seguí estos pasos en Safari:</p>
                <ol className="mt-4 space-y-3 text-sm">
                  <Paso icono={<Share className="size-4" />}>
                    Tocá <b>Compartir</b>. Si no lo ves, tocá los <b>tres puntos (⋯)</b> y elegí <b>Compartir</b>.
                  </Paso>
                  <Paso icono={<SquarePlus className="size-4" />}>
                    Elegí <b>Agregar a pantalla de inicio</b>.
                  </Paso>
                </ol>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Paso({ icono, children }: { icono: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10">{icono}</span>
      <span>{children}</span>
    </li>
  );
}
