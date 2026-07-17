import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./lib/motion";
import { attachTimelineReplay } from "./lib/scrollReplay";
import { Title } from "./section-rejected/Title";
import { Subtitle } from "./section-rejected/Subtitle";
import { RejectedCard } from "./section-rejected/RejectedCard";

gsap.registerPlugin(ScrollTrigger);

// Sección nueva (no forma parte de las 10 originales, igual que
// SectionUpsell), insertada justo después de la Sección 5 (Agenda) como
// continuación natural: la agenda organiza los turnos que SÍ pasaron, esta
// muestra que Clippr también aprende de los que no consiguieron uno. A
// propósito separada de la agenda — son dos beneficios distintos y no se
// mezclan. Mismo lenguaje visual violeta que el resto de Clippr (no una
// identidad de color propia). Es un panel/beneficio puntual, no un flujo
// en loop: la tarjeta entra una sola vez por visita a la sección y queda
// estática — se vuelve a jugar solo si el usuario sale del viewport y
// reingresa (mismo criterio que la Sección 4, "Caja de hoy").
export function SectionRejectedClients() {
  const sectionRef = React.useRef<HTMLElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const subtitleRef = React.useRef<HTMLParagraphElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const reduced = prefersReducedMotion();
      const benefits = gsap.utils.toArray<HTMLElement>(".s5r-benefit", cardRef.current);

      if (reduced) {
        gsap.set([titleRef.current, subtitleRef.current, cardRef.current], { opacity: 1, y: 0 });
        gsap.set(benefits, { opacity: 1, x: 0 });
        return;
      }

      const tl = gsap.timeline({
        paused: true,
        defaults: { ease: "power3.out" },
      });
      tl.set([titleRef.current, subtitleRef.current], { opacity: 0, y: 24 });
      tl.set(cardRef.current, { opacity: 0, y: 24 });
      tl.set(benefits, { opacity: 0, x: -12 });

      tl.to(titleRef.current, { opacity: 1, y: 0, duration: 0.6 })
        .to(subtitleRef.current, { opacity: 1, y: 0, duration: 0.55 }, "-=0.35")
        .to(cardRef.current, { opacity: 1, y: 0, duration: 0.6 }, "-=0.2")
        .to(benefits, { opacity: 1, x: 0, duration: 0.4, stagger: 0.18 }, "-=0.25");

      attachTimelineReplay(sectionRef.current!, tl);

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
            "radial-gradient(70% 55% at 20% 85%, oklch(0.5 0.2 292 / 0.14), transparent 60%)",
        }}
      />
      {/* Glow propio detrás de la tarjeta — violeta, mismo criterio que el
          resto de la landing (Section2/3/4/5), no una identidad de color
          separada. */}
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
        <div className="mt-6 w-full lg:mt-0 lg:flex lg:justify-center">
          <div className="w-full lg:max-w-[480px]">
            <RejectedCard ref={cardRef} />
          </div>
        </div>
      </div>
    </section>
  );
}
