import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// Umbral único para las 12 secciones animadas: hay que ver una porción real
// de la sección (no solo un borde asomando) antes de disparar su entrada.
// El reset, en cambio, usa el rango completo por defecto de ScrollTrigger
// ("top bottom" a "bottom top"): onLeave/onLeaveBack solo disparan cuando la
// sección queda 100% fuera de vista, para arriba o para abajo.
export const SECTION_PLAY_START = "top 75%";

interface SectionReplayHandlers {
  onPlay: () => void;
  onReset: () => void;
}

// Arma el par de ScrollTrigger que gobierna "entra en pantalla → reproduce
// una vez → queda fijo en el estado final → sale por completo → resetea →
// vuelve a entrar → reproduce de nuevo", pedido como criterio único para
// todas las animaciones de entrada de la landing. Sirve tanto para
// timelines de GSAP como para secuencias manejadas a mano con setTimeout
// (ver useDemoSequence / useUpsellDemo).
export function createSectionReplay(
  trigger: Element,
  { onPlay, onReset }: SectionReplayHandlers,
  playStart: string = SECTION_PLAY_START,
): () => void {
  const playTrigger = ScrollTrigger.create({
    trigger,
    start: playStart,
    onEnter: onPlay,
    onEnterBack: onPlay,
  });
  const resetTrigger = ScrollTrigger.create({
    trigger,
    onLeave: onReset,
    onLeaveBack: onReset,
  });

  return () => {
    playTrigger.kill();
    resetTrigger.kill();
  };
}

// Atajo para el caso más común de la landing: un timeline de GSAP pausado
// que se reinicia entero al entrar y se congela en su primer frame (estado
// inicial oculto) al salir por completo del viewport.
export function attachTimelineReplay(
  trigger: Element,
  timeline: gsap.core.Timeline,
  playStart?: string,
): () => void {
  return createSectionReplay(
    trigger,
    {
      onPlay: () => timeline.restart(),
      onReset: () => timeline.pause(0),
    },
    playStart,
  );
}
