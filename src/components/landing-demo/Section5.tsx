import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./lib/motion";
import { attachDemoReplay } from "./lib/scrollReplay";
import { Title } from "./section5/Title";
import { Subtitle } from "./section5/Subtitle";
import { AgendaCard } from "./section5/AgendaCard";
import { StatusLegend } from "./section5/StatusLegend";
import { STATUS_BY_ID } from "./section5/statuses";

gsap.registerPlugin(ScrollTrigger);

// Sección 5: "Nunca más un turno perdido." — enfocada únicamente en mostrar
// la agenda real de Clippr (profesionales, horarios, turnos, descansos,
// colores por turno) funcionando y organizada, con los 6 estados reales
// (StatusLegend) arriba a modo de leyenda de colores — no para explicar
// "Clientes rechazados" en detalle (eso vive en SectionRejectedClients,
// aparte), sino para que el visitante asocie el color de cada turno con su
// estado de un vistazo. Los turnos entran en secuencia y, como el resto de
// las demos de la landing, el ciclo completo se repite solo (2s de pausa
// con la agenda asentada) mientras la sección siga a la vista.
export function Section5() {
  const sectionRef = React.useRef<HTMLElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const subtitleRef = React.useRef<HTMLParagraphElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const reduced = prefersReducedMotion();

      if (reduced) {
        gsap.set([titleRef.current, subtitleRef.current, cardRef.current], { opacity: 1, y: 0 });
        return;
      }

      // introTl: título/subtítulo, una sola vez. demoTl: la agenda —
      // leyenda, turnos, el cambio de estado de Franco Roesi y el
      // parpadeo de actividad de dos turnos — que es "la demostración" y
      // se repite sola mientras la sección siga a la vista.
      const introTl = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
      introTl.set([titleRef.current, subtitleRef.current], { opacity: 0, y: 24 });
      introTl
        .to(titleRef.current, { opacity: 1, y: 0, duration: 0.6 })
        .to(subtitleRef.current, { opacity: 1, y: 0, duration: 0.55 }, "-=0.35");

      const demoTl = gsap.timeline({
        paused: true,
        defaults: { ease: "power3.out" },
      });
      demoTl.set(cardRef.current, { opacity: 0, y: 28, scale: 0.98 });
      demoTl.set(".s5-legend-pill", { opacity: 0, y: 8 });
      demoTl.set(".s5-pro-header", { opacity: 0, y: 8 });
      demoTl.set(".s5-slot", { opacity: 0, y: 10 });

      demoTl
        .to(cardRef.current, { opacity: 1, y: 0, scale: 1, duration: 0.6 })
        // La leyenda de estados aparece primero, como clave de lectura,
        // antes de que se armen los turnos que la usan.
        .to(".s5-legend-pill", { opacity: 1, y: 0, duration: 0.3, stagger: 0.05 }, "-=0.3")
        .to(".s5-pro-header", { opacity: 1, y: 0, duration: 0.4, stagger: 0.1 }, "-=0.1")
        .to(".s5-slot", { opacity: 1, y: 0, duration: 0.35, stagger: 0.05 }, "-=0.2")
        .add(() => {
          // Un turno "cambia de estado" apenas se asienta la agenda — de
          // "Por confirmar" a "Confirmados", mismos colores que la
          // leyenda — un guiño sutil de actividad, no un efecto llamativo.
          const target = cardRef.current?.querySelector<HTMLElement>(
            '[data-name="Franco Roesi"]',
          );
          if (target) {
            const from = STATUS_BY_ID.pending;
            const to = STATUS_BY_ID.confirmed;
            gsap.fromTo(
              target,
              {
                backgroundColor: `color-mix(in oklch, ${from.color} 30%, #0a0a0f)`,
                boxShadow: `inset 0 0 0 1px ${from.ring}`,
              },
              {
                backgroundColor: `color-mix(in oklch, ${to.color} 30%, #0a0a0f)`,
                boxShadow: `inset 0 0 0 1px ${to.ring}`,
                duration: 0.8,
                ease: "power1.inOut",
              },
            );
          }
        }, "+=0.4")
        // Dos turnos existentes parpadean de a uno, como si se estuvieran
        // confirmando en vivo — cierre del ciclo antes de la pausa/loop.
        .to('[data-name="Camilo Gómez"]', { opacity: 0.15, duration: 0.4 }, "+=0.6")
        .to('[data-name="Camilo Gómez"]', { opacity: 1, duration: 0.5 })
        .to('[data-name="Luciano Díaz"]', { opacity: 0.15, duration: 0.4 }, "+=0.5")
        .to('[data-name="Luciano Díaz"]', { opacity: 1, duration: 0.5 });

      attachDemoReplay(sectionRef.current!, introTl, demoTl);

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
      gsap.to([titleRef.current, subtitleRef.current], {
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
      className="relative isolate flex min-h-svh w-full flex-col items-start justify-center overflow-hidden px-6 py-10 sm:px-12 md:px-16 lg:px-20"
    >
      <div className="absolute inset-0 -z-30 bg-[#050308]" />
      <div
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          background:
            "radial-gradient(70% 55% at 20% 12%, oklch(0.5 0.2 292 / 0.14), transparent 60%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 -z-20 hidden lg:block"
        style={{
          background:
            "radial-gradient(38% 60% at 78% 50%, oklch(0.5 0.24 292 / 0.20), transparent 68%)",
        }}
      />

      <div className="relative z-10 flex w-full max-w-[440px] flex-col items-start text-left lg:max-w-none lg:grid lg:grid-cols-[minmax(0,420px)_1fr] lg:items-center lg:gap-8 xl:gap-10">
        <div className="flex flex-col items-start text-left">
          <Title ref={titleRef} />
          <Subtitle ref={subtitleRef} />
        </div>
        <div ref={cardRef} className="mt-6 w-full lg:mt-0 lg:flex lg:flex-col lg:items-center">
          <div className="w-full lg:max-w-[620px] xl:max-w-[720px]">
            <StatusLegend />
            <div className="mt-4">
              <AgendaCard />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
