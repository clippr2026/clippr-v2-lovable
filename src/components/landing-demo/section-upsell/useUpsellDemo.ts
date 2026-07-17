import * as React from "react";
import { prefersReducedMotion } from "../lib/motion";
import { createSectionReplay } from "../lib/scrollReplay";

// Único booleano del que dependen tanto ProductsMockup (la tarjeta de
// "Cera Mate" pasa a Agregado) como ComparisonCard (el total pasa a
// $34.500) — mismo criterio de estado único que el resto de la landing:
// las dos piezas nunca pueden desincronizarse porque comparten la misma
// fuente de verdad, no cada una su propio timer.
const HOLD_BASE = 900;

export function useUpsellDemo(sectionRef: React.RefObject<HTMLElement | null>): boolean {
  const [added, setAdded] = React.useState(false);

  React.useEffect(() => {
    if (prefersReducedMotion()) {
      setAdded(true);
      return;
    }
    if (!sectionRef.current) return;

    let cancelled = false;
    let timeouts: ReturnType<typeof setTimeout>[] = [];

    function clearTimeouts() {
      timeouts.forEach(clearTimeout);
      timeouts = [];
    }

    // Una sola pasada por entrada a la sección: base → agregado, y ahí
    // se queda (sin re-loop mientras sigue a la vista). Se reinicia
    // desde "base" solo si el usuario sale del todo del viewport y
    // vuelve a entrar.
    function play() {
      clearTimeouts();
      setAdded(false);
      timeouts.push(setTimeout(() => !cancelled && setAdded(true), HOLD_BASE));
    }

    function reset() {
      clearTimeouts();
      setAdded(false);
    }

    const detach = createSectionReplay(sectionRef.current, { onPlay: play, onReset: reset });

    return () => {
      cancelled = true;
      clearTimeouts();
      detach();
    };
  }, [sectionRef]);

  return added;
}
