import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./lib/motion";
import { attachTimelineReplay } from "./lib/scrollReplay";
import { Scene } from "./section10/Scene";
import { Title } from "./section10/Title";
import { CTAButton } from "./section10/CTAButton";
import { TrustBadges } from "./section10/TrustBadges";

gsap.registerPlugin(ScrollTrigger);

// Sección 10: cierre de toda la historia — problema, solución, cómo
// funciona, la IA, y ahora "te toca a vos". El sillón (chair-hero.png) es
// el fondo real de toda la sección, no una imagen insertada en un bloque:
// mismo criterio que la Sección 1 — la foto cubre toda la pantalla
// (object-cover, sesgada a la derecha), un degradado oscuro de izquierda
// a derecha le da contraste al texto, y el escenario (luces, humo,
// reflejo, todo horneado en la propia foto) se siente continuo detrás del
// contenido en vez de encerrado en una tarjeta.
export function Section10() {
  const sectionRef = React.useRef<HTMLElement>(null);
  const sceneRef = React.useRef<HTMLDivElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const ctaRef = React.useRef<HTMLDivElement>(null);
  const badgesRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const reduced = prefersReducedMotion();

      if (reduced) {
        gsap.set([sceneRef.current, titleRef.current, ctaRef.current, badgesRef.current], {
          opacity: 1,
          y: 0,
          scale: 1,
        });
        return;
      }

      const tl = gsap.timeline({
        paused: true,
        defaults: { ease: "power3.out" },
      });
      tl.set(sceneRef.current, { opacity: 0, scale: 1.06 });
      tl.set([titleRef.current, ctaRef.current, badgesRef.current], { opacity: 0, y: 24 });

      tl.to(sceneRef.current, { opacity: 1, scale: 1, duration: 1.3, ease: "power1.out" })
        .to(titleRef.current, { opacity: 1, y: 0, duration: 0.6 }, "-=0.95")
        .to(ctaRef.current, { opacity: 1, y: 0, duration: 0.55 }, "-=0.35")
        .to(badgesRef.current, { opacity: 1, y: 0, duration: 0.5 }, "-=0.25");

      attachTimelineReplay(sectionRef.current!, tl);

      // Pulso leve del CTA cada varios segundos (no una respiración
      // continua): un latido corto y una pausa larga entre cada uno. Debe
      // seguir siendo el CTA más importante de toda la landing.
      gsap.timeline({ repeat: -1, repeatDelay: 3.2, delay: 2 })
        .to(".s10-cta", {
          scale: 1.035,
          boxShadow: "0 26px 70px -14px oklch(0.55 0.26 292 / 1)",
          duration: 0.55,
          ease: "sine.inOut",
        })
        .to(".s10-cta", {
          scale: 1,
          boxShadow: "0 20px 55px -15px oklch(0.55 0.26 292 / 0.75)",
          duration: 0.55,
          ease: "sine.inOut",
        });

      // Acercamiento lento y continuo al sillón mientras se scrollea.
      gsap.to(sceneRef.current, {
        scale: 1.08,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative isolate flex min-h-svh w-full items-center overflow-hidden px-6 py-16 sm:px-12 md:px-16 lg:px-20"
    >
      <div className="absolute inset-0 -z-30 bg-[#050308]" />
      <Scene ref={sceneRef} />

      <div className="relative z-10 mx-auto w-full max-w-6xl">
        <div className="flex max-w-xl flex-col items-start text-left lg:max-w-2xl">
          <Title ref={titleRef} />
          <div className="mt-7">
            <CTAButton ref={ctaRef} />
          </div>
          <div className="mt-7">
            <TrustBadges ref={badgesRef} />
          </div>
        </div>
      </div>
    </section>
  );
}
