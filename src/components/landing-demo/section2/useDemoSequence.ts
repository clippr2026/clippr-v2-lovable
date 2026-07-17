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

export function useDemoSequence(sectionRef: React.RefObject<HTMLElement | null>): DemoStep {
  const [step, setStep] = React.useState<DemoStep>(1);

  React.useEffect(() => {
    if (prefersReducedMotion()) {
      // Sin animación: directo al estado final (turno confirmado), como
      // pide prefers-reduced-motion — no hay loop que mostrar.
      setStep(5);
      return;
    }
    if (!sectionRef.current) return;

    let cancelled = false;
    let timeouts: ReturnType<typeof setTimeout>[] = [];

    function clearTimeouts() {
      timeouts.forEach(clearTimeout);
      timeouts = [];
    }

    // Servicio → Profesional → Día → Horario → Confirmado, una sola vez
    // por entrada a la sección — nada de loop: se queda en "Confirmado"
    // hasta que el usuario sale del todo del viewport y vuelve a entrar
    // (ver onReset más abajo), que recién ahí reinicia desde el paso 1.
    function play() {
      clearTimeouts();
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
    }

    function reset() {
      clearTimeouts();
      setStep(1);
    }

    const detach = createSectionReplay(sectionRef.current, { onPlay: play, onReset: reset });

    return () => {
      cancelled = true;
      clearTimeouts();
      detach();
    };
  }, [sectionRef]);

  return step;
}
