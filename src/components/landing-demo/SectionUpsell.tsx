import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./lib/motion";
import { attachTimelineReplay } from "./lib/scrollReplay";
import { Title } from "./section-upsell/Title";
import { Subtitle } from "./section-upsell/Subtitle";
import { BenefitsList } from "./section-upsell/BenefitsList";
import { ComparisonCard } from "./section-upsell/ComparisonCard";
import { ProductsMockup } from "./section-upsell/ProductsMockup";
import { useUpsellDemo } from "./section-upsell/useUpsellDemo";

gsap.registerPlugin(ScrollTrigger);

// Sección nueva (no forma parte de las 10 del storyboard original):
// upselling/cross-selling automático. Va entre la Sección 6 ("Los números
// hablan por vos") y la Sección 7 ("Tu barbería. Siempre a un toque.") —
// después de mostrar que Clippr ORGANIZA la barbería, esta muestra que
// también ayuda a FACTURAR más, antes de cerrar con "siempre a un
// toque". Mismo lenguaje visual que sus vecinas: fondo negro plano +
// glow radial (no el componente <Background/> con foto que usan las
// Secciones 1/2), título con segunda línea en violeta, columna de
// beneficios con stagger, tarjeta protagonista a la derecha.
export function SectionUpsell() {
  const sectionRef = React.useRef<HTMLElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const subtitleRef = React.useRef<HTMLParagraphElement>(null);
  const benefitsRef = React.useRef<HTMLDivElement>(null);
  const mockupColRef = React.useRef<HTMLDivElement>(null);
  const metricRef = React.useRef<HTMLDivElement>(null);
  // Única fuente de verdad del demo (Cera Mate agregada + total del
  // comparativo) — ver useUpsellDemo.ts.
  const added = useUpsellDemo(sectionRef);

  React.useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const reduced = prefersReducedMotion();

      if (reduced) {
        gsap.set(
          [titleRef.current, subtitleRef.current, benefitsRef.current, mockupColRef.current, metricRef.current],
          { opacity: 1, y: 0, scale: 1 },
        );
        gsap.set(".s-up-benefit", { opacity: 1, x: 0 });
        return;
      }

      const tl = gsap.timeline({
        paused: true,
        defaults: { ease: "power3.out" },
      });
      tl.set([titleRef.current, subtitleRef.current], { opacity: 0, y: 24 });
      tl.set(".s-up-benefit", { opacity: 0, x: -18 });
      tl.set(mockupColRef.current, { opacity: 0, y: 28, scale: 0.97 });
      tl.set(metricRef.current, { opacity: 0, y: 20 });

      tl.to(titleRef.current, { opacity: 1, y: 0, duration: 0.6 })
        .to(subtitleRef.current, { opacity: 1, y: 0, duration: 0.55 }, "-=0.35")
        .to(".s-up-benefit", { opacity: 1, x: 0, duration: 0.5, stagger: 0.1 }, "-=0.3")
        .to(mockupColRef.current, { opacity: 1, y: 0, scale: 1, duration: 0.6 }, "-=0.35")
        .to(metricRef.current, { opacity: 1, y: 0, duration: 0.5 }, "-=0.25");

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
      className="relative isolate flex w-full flex-col items-start justify-center overflow-hidden px-6 py-5 sm:px-12 sm:py-16 md:px-16 lg:min-h-svh lg:px-20"
    >
      <div className="absolute inset-0 -z-30 bg-[#050308]" />
      <div
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          background:
            "radial-gradient(70% 55% at 60% 10%, oklch(0.5 0.2 292 / 0.14), transparent 60%)",
        }}
      />
      {/* Glow propio detrás de la tarjeta protagonista — solo desktop,
          mismo criterio que Section2 con BookingCard. */}
      <div
        className="pointer-events-none absolute inset-0 -z-20 hidden lg:block"
        style={{
          background:
            "radial-gradient(38% 55% at 82% 55%, oklch(0.5 0.24 292 / 0.18), transparent 68%)",
        }}
      />

      {/* Orden en DOM = orden en mobile (sin grid-template-columns hasta
          lg, un solo flujo): Título/Texto → Productos/Comparación →
          Beneficios. En desktop el grid de 2 columnas x 2 filas ubica el
          mockup a la derecha (spanning ambas filas, centrado) y el texto +
          beneficios apilados a la izquierda — mismo resultado visual que
          antes, solo que ahora beneficios es su propia celda en vez de
          vivir anidado dentro del bloque de texto (lo que permite este
          reorden en mobile sin tocar el layout de desktop). */}
      <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-4 lg:gap-12 lg:grid-cols-[1fr_auto]">
        <div className="flex flex-col items-start text-left">
          <Title ref={titleRef} />
          <Subtitle ref={subtitleRef} />
        </div>

        <div
          ref={mockupColRef}
          className="mx-auto w-full sm:w-[380px] lg:row-span-2 lg:w-[420px]"
        >
          <ProductsMockup added={added} />
          <ComparisonCard ref={metricRef} added={added} />
        </div>

        <div>
          <BenefitsList ref={benefitsRef} />
        </div>
      </div>
    </section>
  );
}
