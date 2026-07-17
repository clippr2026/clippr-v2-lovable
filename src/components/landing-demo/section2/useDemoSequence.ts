import * as React from "react";
import { prefersReducedMotion } from "../lib/motion";
import { createSectionReplay } from "../lib/scrollReplay";

// Único estado del que deriva toda la tarjeta (indicador izquierdo,
// profesional, día, horario, botón y pantalla de confirmación) — evita
// que cada pieza tenga su propio "selected" desincronizado del resto:
//   1 = Servicio        ("Corte" se selecciona tras una pausa breve, ver
//                         ServiceRow.tsx; nada más elegido, botón apagado)
//   2 = + Profesional    (Julián)
//   3 = + Día            (martes 14, horario todavía sin elegir)
//   4 = + Horario         (11:30, botón encendido, todavía se ve la grilla)
//   5 = Confirmado        (la grilla de horario + el botón se reemplazan
//                          por la pantalla "Turno confirmado", ver
//                          Confirmation.tsx en BookingCard)
// El indicador de la izquierda tiene un paso por cada uno de los primeros
// 4 momentos (ver StepIndicator.tsx) — con active=5, "n < active" da true
// para los 4, así que se ven completos sin necesitar un 5to círculo.
export type DemoStep = 1 | 2 | 3 | 4 | 5;

const HOLD_SERVICE = 1300;
const HOLD_PROFESSIONAL = 1400;
const HOLD_DAY = 1000;
const HOLD_TIME = 900; // horario elegido, pausa breve con el botón encendido antes de confirmar
const HOLD_CONFIRMED = 2000; // "Turno confirmado" visible antes de reiniciar el ciclo
// Duración del crossfade de ida y vuelta — tiene que ser EXACTAMENTE la
// misma que la clase CSS "duration-300" que usa BookingCard.tsx para el
// wrapper de contenido: este timeout es lo que le da tiempo a esa
// transición de opacidad a terminar antes de cambiar el contenido de
// adentro (si no coinciden, el swap se ve a mitad de fade, un salto en vez
// de un crossfade limpio).
const FADE_MS = 300;

export interface DemoSequenceState {
  step: DemoStep;
  // Controla el crossfade del contenido interno de la tarjeta, NUNCA su
  // alto — BookingCard usa esto para un fade de opacidad en un wrapper
  // interno; el contenedor con el alto fijo (h-[491px] etc.) es ajeno a
  // esto y no se toca en ningún momento del ciclo.
  visible: boolean;
}

// Única sección de toda la landing cuyo demo vuelve a arrancar solo,
// dentro de la misma pantalla, sin que el usuario tenga que scrollear para
// volver a verla — pedido explícito. El resto de las secciones se anima
// una sola vez por entrada y solo se resetea si el usuario sale del todo
// del viewport y vuelve (ver createSectionReplay/attachTimelineReplay en
// lib/scrollReplay.ts, que sigue gobernando el PRIMER play() acá abajo).
export function useDemoSequence(sectionRef: React.RefObject<HTMLElement | null>): DemoSequenceState {
  const [step, setStep] = React.useState<DemoStep>(1);
  const [visible, setVisible] = React.useState(true);

  React.useEffect(() => {
    if (prefersReducedMotion()) {
      // Sin animación: directo al estado final (turno confirmado), como
      // pide prefers-reduced-motion — nada de loop ni fades que mostrar.
      setStep(5);
      setVisible(true);
      return;
    }
    if (!sectionRef.current) return;

    let cancelled = false;
    let timeouts: ReturnType<typeof setTimeout>[] = [];

    function clearTimeouts() {
      timeouts.forEach(clearTimeout);
      timeouts = [];
    }

    // Servicio → Profesional → Día → Horario → Confirmado → (2s) →
    // crossfade de vuelta a Servicio, en loop mientras la sección siga a
    // la vista. Se reinicia desde el paso 1 si el usuario sale del todo
    // del viewport y vuelve a entrar (ver onReset más abajo).
    function play() {
      clearTimeouts();
      setVisible(true);
      setStep(1);
      timeouts.push(setTimeout(() => !cancelled && setStep(2), HOLD_SERVICE));
      timeouts.push(setTimeout(() => !cancelled && setStep(3), HOLD_SERVICE + HOLD_PROFESSIONAL));
      timeouts.push(
        setTimeout(() => !cancelled && setStep(4), HOLD_SERVICE + HOLD_PROFESSIONAL + HOLD_DAY),
      );
      timeouts.push(
        setTimeout(
          () => !cancelled && setStep(5),
          HOLD_SERVICE + HOLD_PROFESSIONAL + HOLD_DAY + HOLD_TIME,
        ),
      );
      // Tras los 2s de "Turno confirmado": fade-out del contenido (el
      // contenedor no se mueve ni cambia de alto, ver comentario en
      // BookingCard.tsx), y recién cuando ese fade terminó de verdad
      // (FADE_MS después, no antes) se cambia el contenido de adentro y
      // arranca el fade-in — así el swap ocurre siempre con opacity en 0,
      // nunca a mitad de transición, cero parpadeo.
      timeouts.push(
        setTimeout(() => {
          if (cancelled) return;
          setVisible(false);
          timeouts.push(
            setTimeout(() => {
              if (!cancelled) play();
            }, FADE_MS),
          );
        }, HOLD_SERVICE + HOLD_PROFESSIONAL + HOLD_DAY + HOLD_TIME + HOLD_CONFIRMED),
      );
    }

    function reset() {
      clearTimeouts();
      setVisible(true);
      setStep(1);
    }

    const detach = createSectionReplay(sectionRef.current, { onPlay: play, onReset: reset });

    return () => {
      cancelled = true;
      clearTimeouts();
      detach();
    };
  }, [sectionRef]);

  return { step, visible };
}
