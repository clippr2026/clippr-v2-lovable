import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./lib/motion";
import { attachTimelineReplay } from "./lib/scrollReplay";
import { Background } from "./section1/Background";
import { Title } from "./section2/Title";
import { Subtitle } from "./section2/Subtitle";
import { StepIndicator } from "./section2/StepIndicator";
import { BookingCard } from "./section2/BookingCard";
import { useDemoSequence } from "./section2/useDemoSequence";

gsap.registerPlugin(ScrollTrigger);

// Sección 2 del storyboard: "Un cliente reserva." — a diferencia de la
// Sección 1, acá no hay foto de fondo; el protagonista es el mockup de la
// app (BookingCard). Mobile: una sola columna angosta, igual que el
// storyboard (que es literalmente un mockup de pantalla de celular). En
// desktop eso mismo, mostrado a ese ancho, dejaba muerto todo el lado
// derecho — se redistribuye a dos columnas (texto izquierda, tarjeta
// protagonista derecha, con más escala y un glow propio) para ocupar el
// viewport, sin cambiar ni un elemento del concepto original.
export function Section2() {
  const sectionRef = React.useRef<HTMLElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const subtitleRef = React.useRef<HTMLParagraphElement>(null);
  const stepsRef = React.useRef<HTMLDivElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  // Única fuente de verdad de la demo (indicador izquierdo + toda la
  // tarjeta) — ver useDemoSequence.ts. "visible" es el crossfade del loop
  // (única sección de la landing que reinicia sola sin scroll) — Section2
  // no lo usa para nada propio, solo lo reenvía a BookingCard.
  const { step: demoStep, visible: demoVisible } = useDemoSequence(sectionRef);

  React.useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const reduced = prefersReducedMotion();

      if (reduced) {
        gsap.set([titleRef.current, subtitleRef.current, stepsRef.current, cardRef.current], {
          opacity: 1,
          y: 0,
          scale: 1,
        });
        return;
      }

      // Entrada: el texto sube suave, los 3 pasos aparecen en secuencia
      // (no como un bloque único), la tarjeta llega un poco después con
      // una entrada más "física" (leve escala), como si se asentara — nada
      // llamativo, acompañando la narrativa (primero la promesa, después
      // la prueba). Ya no hay un pulso de "profesional/día/horario ya
      // elegidos" acá: ahora nada viene preseleccionado al entrar (el demo
      // automático de la tarjeta, useDemoSequence, arranca siempre en el
      // paso 1) y los glows de selección los maneja cada componente por su
      // cuenta vía CSS (ver ProfessionalPicker/DatePicker/TimePicker/
      // BookButton) — un timeline de GSAP de una sola pasada no puede
      // sincronizarse con un estado que cambia solo en loop.
      const tl = gsap.timeline({
        paused: true,
        defaults: { ease: "power3.out" },
      });
      tl.set([titleRef.current, subtitleRef.current], { opacity: 0, y: 24 });
      tl.set(".s2-step", { opacity: 0, y: 14 });
      tl.set(cardRef.current, { opacity: 0, y: 28, scale: 0.98 });

      tl.to(titleRef.current, { opacity: 1, y: 0, duration: 0.6 })
        .to(subtitleRef.current, { opacity: 1, y: 0, duration: 0.55 }, "-=0.35")
        .to(".s2-step", { opacity: 1, y: 0, duration: 0.45, stagger: 0.1 }, "-=0.3")
        .to(cardRef.current, { opacity: 1, y: 0, scale: 1, duration: 0.6 }, "-=0.2");

      attachTimelineReplay(sectionRef.current!, tl);

      // Scroll: la tarjeta sube con leve parallax y todo el texto se
      // atenúa al salir de vista — mismo lenguaje que la Sección 1.
      gsap.to(cardRef.current, {
        yPercent: -8,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      });
      gsap.to([titleRef.current, subtitleRef.current, stepsRef.current], {
        opacity: 0.15,
        y: -30,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "55% top",
          scrub: true,
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative isolate flex w-full flex-col items-start justify-center overflow-hidden px-6 py-8 sm:px-12 sm:py-10 md:px-16 lg:min-h-svh lg:px-20"
    >
      {/* Mismo componente que la Sección 1 (no una copia con otros valores):
          así el negro base y el matiz violeta son *exactamente* los mismos
          a los dos lados de la costura, no solo parecidos. */}
      <Background />
      {/* <Background/> es el mismo componente en las dos secciones, pero su
          glow está anclado a "78% 78%" DENTRO de cada caja de 900px propia:
          en la Sección 1 ese punto queda cerca de SU borde inferior (glow
          fuerte justo antes de la costura); en esta, el mismo punto queda
          lejos de SU borde superior (glow casi apagado justo después). Medido
          en pantalla: la Sección 1 llega a la costura en ~rgb(4,2,9) y esta,
          con el mismo componente, arrancaba en ~rgb(2,1,3) — un salto de
          brillo real, no solo percibido. Este velo lleva la entrada bien
          cerca del negro puro (por eso 0.92, no 0.65: 0.65 no alcanzaba a
          tapar esa diferencia) y se disuelve rápido para no comerse el glow
          propio de la sección un poco más abajo. */}
      <div
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          background: "linear-gradient(180deg, rgba(2,1,5,0.92) 0%, transparent 22%)",
        }}
      />
      {/* Glow propio detrás de la tarjeta — solo desktop, donde la tarjeta
          pasa a ser protagonista del lado derecho. Le da presencia a ese
          espacio en vez de dejarlo vacío. */}
      <div
        className="pointer-events-none absolute inset-0 -z-20 hidden lg:block"
        style={{
          background:
            "radial-gradient(38% 60% at 78% 50%, oklch(0.5 0.24 292 / 0.20), transparent 68%)",
        }}
      />

      <div className="relative z-10 flex w-full max-w-[420px] flex-col items-start text-left lg:max-w-none lg:grid lg:grid-cols-[minmax(0,380px)_1fr] lg:items-center lg:gap-8 xl:gap-10">
        <div className="flex flex-col items-start text-left">
          <Title ref={titleRef} />
          <Subtitle ref={subtitleRef} />
          <div ref={stepsRef} className="mt-4 sm:mt-7">
            {/* 4 pasos, uno a uno con demoStep: Servicio → Profesional →
                Día → Horario. Antes "Día y horario" era un solo paso (3)
                que absorbía dos momentos del demo (día elegido y luego
                horario elegido) — ahora cada uno tiene su propio paso, así
                el indicador avanza en el instante exacto en que cada
                elección ocurre, sin capar demoStep.
                Siempre montado, incluso en demoStep 5 (confirmación) —
                "hidden" lo apaga con opacity, no lo saca del DOM: sacarlo
                colapsaba este bloque y todo lo de abajo pegaba un salto
                (ver el comentario largo en StepIndicator.tsx). */}
            <StepIndicator active={demoStep === 5 ? 4 : demoStep} hidden={demoStep === 5} />
          </div>
        </div>
        <div ref={cardRef} className="mt-4 w-full sm:mt-6 lg:mt-0 lg:flex lg:justify-center">
          <div className="w-full lg:max-w-[540px] xl:max-w-[660px]">
            <BookingCard demoStep={demoStep} visible={demoVisible} />
          </div>
        </div>
      </div>
    </section>
  );
}
