import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./lib/motion";
import { attachTimelineReplay } from "./lib/scrollReplay";
import { Title } from "./section7/Title";
import { Subtitle } from "./section7/Subtitle";
import { BenefitsList } from "./section7/BenefitsList";
import phoneHome from "@/assets/landing/section7/phone-home.png";

gsap.registerPlugin(ScrollTrigger);

// Sección 7: "Tu barbería. Siempre a un toque." — el teléfono en CSS (antes
// PhoneMockup, con el ícono de Clippr "instalándose") se reemplazó por una
// imagen real (phone-home.png) dentro del mismo contenedor que antes
// reservaba el espacio (~42% del ancho de la sección, mismo alto
// aproximado) — layout sin retocar. Bloque izquierdo (texto + beneficios)
// intacto: mismas tipografías, tamaños, colores y espaciados.
export function Section7() {
  const sectionRef = React.useRef<HTMLElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const subtitleRef = React.useRef<HTMLParagraphElement>(null);
  const benefitsRef = React.useRef<HTMLDivElement>(null);
  const imagePlaceholderRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const reduced = prefersReducedMotion();

      if (reduced) {
        gsap.set(
          [titleRef.current, subtitleRef.current, benefitsRef.current, imagePlaceholderRef.current],
          { opacity: 1, y: 0 },
        );
        gsap.set(".s7-benefit", { opacity: 1, x: 0 });
        return;
      }

      const tl = gsap.timeline({
        paused: true,
        defaults: { ease: "power3.out" },
      });
      tl.set([titleRef.current, subtitleRef.current], { opacity: 0, y: 24 });
      tl.set(imagePlaceholderRef.current, { opacity: 0, y: 24, scale: 0.97 });
      tl.set(".s7-benefit", { opacity: 0, x: -18 });

      tl.to(titleRef.current, { opacity: 1, y: 0, duration: 0.6 })
        .to(subtitleRef.current, { opacity: 1, y: 0, duration: 0.55 }, "-=0.35")
        .to(imagePlaceholderRef.current, { opacity: 1, y: 0, scale: 1, duration: 0.6 }, "-=0.3")
        .to(".s7-benefit", { opacity: 1, x: 0, duration: 0.5, stagger: 0.1 }, "-=0.4");

      attachTimelineReplay(sectionRef.current!, tl);

      gsap.to([titleRef.current, subtitleRef.current, benefitsRef.current], {
        opacity: 0.15,
        y: -30,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "60% top",
          scrub: true,
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative isolate flex w-full flex-col items-start justify-center overflow-hidden px-6 py-8 sm:px-12 sm:py-16 md:px-16 lg:min-h-svh lg:px-20"
    >
      <div className="absolute inset-0 -z-30 bg-[#050308]" />
      <div
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          background:
            "radial-gradient(70% 55% at 20% 15%, oklch(0.5 0.2 292 / 0.14), transparent 60%)",
        }}
      />

      <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-5 lg:grid-cols-[58%_42%] lg:gap-12">
        <div className="flex flex-col items-start text-left">
          <Title ref={titleRef} />
          <Subtitle ref={subtitleRef} />
          <div className="mt-4 lg:mt-8">
            <BenefitsList ref={benefitsRef} />
          </div>
        </div>

        <div
          ref={imagePlaceholderRef}
          className="mx-auto h-[430px] w-full max-w-[260px] sm:h-[480px] sm:max-w-[300px] lg:h-[560px] lg:max-w-none"
        >
          <img
            src={phoneHome}
            alt="La app de Clippr en la pantalla de inicio del teléfono"
            className="h-full w-full object-contain"
          />
        </div>
      </div>
    </section>
  );
}
