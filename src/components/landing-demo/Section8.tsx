import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./lib/motion";
import { attachTimelineReplay } from "./lib/scrollReplay";
import { Title } from "./section8/Title";
import { Subtitle } from "./section8/Subtitle";
import { AdvisorCard } from "./section8/AdvisorCard";

gsap.registerPlugin(ScrollTrigger);

// Sección 8: "Clippr ya estaba pensando." — el indicador 82/100 cuenta
// hasta su valor, las recomendaciones (incluida la alerta de los 31
// clientes) entran en secuencia con fade + slide desde abajo y después
// quedan estáticas. Unos segundos más tarde, un microdetalle de vida muy
// sutil (la flecha de cada CTA se desplaza unos px y un pulso tenue en el
// borde violeta) se repite cada varios segundos — nada constante, solo
// para transmitir que el Asesor IA sigue "despierto".
export function Section8() {
  const sectionRef = React.useRef<HTMLElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const subtitleRef = React.useRef<HTMLParagraphElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const reduced = prefersReducedMotion();

      if (reduced) {
        gsap.set([titleRef.current, subtitleRef.current, cardRef.current], { opacity: 1, y: 0 });
        gsap.set(".s8-reco", { opacity: 1, y: 0 });
        const score = cardRef.current?.querySelector<HTMLElement>(".s8-score");
        if (score) score.textContent = "82";
        return;
      }

      const tl = gsap.timeline({
        paused: true,
        defaults: { ease: "power3.out" },
      });
      tl.set([titleRef.current, subtitleRef.current], { opacity: 0, y: 24 });
      tl.set(cardRef.current, { opacity: 0, y: 28, scale: 0.98 });
      tl.set(".s8-reco", { opacity: 0, y: 12, boxShadow: "0 0 0 0 transparent" });
      tl.set([".s8-reco-icon", ".s8-cta"], { boxShadow: "0 0 0 0 transparent" });

      tl.to(titleRef.current, { opacity: 1, y: 0, duration: 0.6 })
        .to(subtitleRef.current, { opacity: 1, y: 0, duration: 0.55 }, "-=0.35")
        .to(cardRef.current, { opacity: 1, y: 0, scale: 1, duration: 0.6 }, "-=0.25")
        .add(() => {
          const score = cardRef.current?.querySelector<HTMLElement>(".s8-score");
          if (score) {
            const counter = { value: 0 };
            gsap.to(counter, {
              value: 82,
              duration: 1,
              ease: "power2.out",
              onUpdate: () => {
                score.textContent = String(Math.round(counter.value));
              },
            });
          }
        }, "-=0.25")
        .to(".s8-reco", { opacity: 1, y: 0, duration: 0.45, stagger: 0.1 }, "-=0.6")
        // Glow leve en los íconos de recomendación al entrar — ninguna
        // acción queda oculta, solo se resalta su llegada.
        .to(
          ".s8-reco-icon",
          {
            boxShadow: "0 0 14px 2px oklch(0.62 0.24 292 / 0.4)",
            duration: 0.4,
            stagger: 0.1,
          },
          "-=0.5",
        )
        .to(".s8-reco-icon", { boxShadow: "0 0 0 0 transparent", duration: 0.5 })
        .add(() => idleLife.play());

      attachTimelineReplay(sectionRef.current!, tl);

      // Con todo asentado, un microdetalle de vida muy sutil se repite
      // cada varios segundos: la flecha de cada CTA se desplaza unos px,
      // el botón hace un glow leve y el borde de la tarjeta un pulso
      // violeta tenue. Se pausa fuera de vista.
      const idleLife = gsap.timeline({
        paused: true,
        repeat: -1,
        repeatDelay: 6,
        defaults: { ease: "power1.inOut" },
      });
      idleLife
        .to(".s8-cta-arrow", { x: 4, duration: 0.35, stagger: 0.08 })
        .to(".s8-cta-arrow", { x: 0, duration: 0.35, stagger: 0.08 }, "-=0.15")
        .to(
          ".s8-cta",
          { boxShadow: "0 0 16px 3px oklch(0.62 0.24 292 / 0.6)", duration: 0.35, stagger: 0.08 },
          "<",
        )
        .to(".s8-cta", { boxShadow: "0 0 0 0 transparent", duration: 0.6, stagger: 0.08 })
        .to(
          ".s8-reco",
          { boxShadow: "0 0 0 1px oklch(0.62 0.24 292 / 0.4)", duration: 0.4, stagger: 0.08 },
          "<-=0.6",
        )
        .to(".s8-reco", { boxShadow: "0 0 0 0 transparent", duration: 0.6, stagger: 0.08 });

      ScrollTrigger.create({
        trigger: sectionRef.current,
        start: "top 80%",
        onLeave: () => idleLife.pause(),
        onEnterBack: () => idleLife.play(),
        onLeaveBack: () => idleLife.pause(),
      });

      gsap.to(cardRef.current, {
        yPercent: -6,
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
      className="relative isolate flex min-h-svh w-full flex-col items-start justify-center overflow-hidden px-6 py-16 sm:px-12 md:px-16 lg:px-20"
    >
      <div className="absolute inset-0 -z-30 bg-[#050308]" />
      <div
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          background:
            "radial-gradient(60% 50% at 15% 90%, oklch(0.5 0.24 292 / 0.22), transparent 65%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 -z-20 hidden lg:block"
        style={{
          background:
            "radial-gradient(38% 60% at 78% 50%, oklch(0.5 0.24 292 / 0.18), transparent 68%)",
        }}
      />

      <div className="relative z-10 flex w-full max-w-[440px] flex-col items-start text-left lg:max-w-none lg:grid lg:grid-cols-[minmax(0,420px)_1fr] lg:items-center lg:gap-8 xl:gap-12">
        <div className="flex flex-col items-start text-left">
          <Title ref={titleRef} />
          <Subtitle ref={subtitleRef} />
        </div>
        <div className="mt-6 w-full lg:mt-0 lg:flex lg:justify-center">
          <div className="w-full lg:max-w-[500px] xl:max-w-[560px]">
            <AdvisorCard ref={cardRef} />
          </div>
        </div>
      </div>
    </section>
  );
}
