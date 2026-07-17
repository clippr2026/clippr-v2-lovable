import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./lib/motion";
import { attachTimelineReplay } from "./lib/scrollReplay";
import { Background } from "./section1/Background";
import { Overlay } from "./section1/Overlay";
import { Scene } from "./section1/Scene";
import { NeonLights } from "./section1/NeonLights";
import { Header } from "./section1/Header";
import { Title } from "./section1/Title";
import { Subtitle } from "./section1/Subtitle";
import { Cta } from "./section1/Cta";

gsap.registerPlugin(ScrollTrigger);

// Sección 1 del storyboard: portada. Cada pieza visual (fondo, escena de la
// silla, luces de neón, overlays, header, título, subtítulo, CTA) es su
// propio componente en ./section1, así que se puede editar/reemplazar cada
// una sin tocar las demás. Este archivo solo compone el layout y la
// animación.
export function Section1() {
  const sectionRef = React.useRef<HTMLElement>(null);
  const headerRef = React.useRef<HTMLDivElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const subtitleRef = React.useRef<HTMLParagraphElement>(null);
  const ctaRef = React.useRef<HTMLAnchorElement>(null);
  const sceneRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const reduced = prefersReducedMotion();

      // El header queda fijo mientras se scrollea el Hero (contenido y foto
      // pasan "por debajo"). Esto es posición, no animación, así que corre
      // también con reduced-motion. Se usa ScrollTrigger.pin en vez de
      // "position: sticky" en CSS porque <main> (landing-demo.tsx) tiene
      // overflow-x-hidden, que el navegador computa como
      // "overflow-y: auto" (par implícito del spec) y eso lo convierte en
      // contenedor de scroll propio, rompiendo sticky en los descendientes.
      // pinSpacing (default true) reserva el espacio original del header en
      // el flujo, así el bloque de título no se corre hacia arriba.
      ScrollTrigger.create({
        trigger: sectionRef.current,
        start: "top top",
        end: "bottom top",
        pin: headerRef.current,
      });

      if (reduced) {
        // Sin animación: todo visible de entrada, nada de scroll-linked motion.
        gsap.set(
          [headerRef.current, titleRef.current, subtitleRef.current, ctaRef.current, sceneRef.current],
          { opacity: 1, y: 0, scale: 1 },
        );
        gsap.set(".neon-light", { opacity: 1 });
        return;
      }

      // Entrada al hacer scroll a la sección: se reproduce entera al
      // entrar, queda fija en el estado final mientras la sección sigue a
      // la vista, y se resetea/repite si el usuario sale del todo del
      // viewport y vuelve (ver attachTimelineReplay más abajo).
      const tl = gsap.timeline({
        paused: true,
        defaults: { ease: "power3.out" },
      });
      tl.set(headerRef.current, { opacity: 0, y: -16 });
      tl.set([titleRef.current, subtitleRef.current, ctaRef.current], {
        opacity: 0,
        y: 28,
      });
      tl.set(sceneRef.current, { opacity: 0, scale: 1.04 });
      tl.set(".neon-light", { opacity: 0 });

      tl.to(headerRef.current, { opacity: 1, y: 0, duration: 0.45 })
        .to(titleRef.current, { opacity: 1, y: 0, duration: 0.6 }, "-=0.15")
        .to(subtitleRef.current, { opacity: 1, y: 0, duration: 0.55 }, "-=0.35")
        .to(sceneRef.current, { opacity: 1, scale: 1, duration: 1 }, "-=0.45")
        .to(".neon-light", { opacity: 1, duration: 1, stagger: 0.1 }, "-=0.8")
        .to(ctaRef.current, { opacity: 1, y: 0, duration: 0.5 }, "-=0.3");

      attachTimelineReplay(sectionRef.current!, tl);

      // ScrollTrigger: al scrollear la escena hace un leve parallax y el
      // texto se atenúa, para que la salida de la Sección 1 se sienta viva.
      gsap.to(sceneRef.current, {
        yPercent: -12,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      });
      // El header queda afuera de este fade-out: con sticky, debe
      // mantenerse fijo y nítido mientras el resto del contenido se
      // desplaza y se atenúa por debajo.
      gsap.to([titleRef.current, subtitleRef.current, ctaRef.current], {
        opacity: 0.15,
        y: -40,
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
      // isolate: crea su propio stacking context para que las capas con
      // z-index negativo (fondo, escena, luces) queden contenidas acá
      // adentro. Sin esto, section no forma contexto propio y esas capas
      // "se escapan" hacia el de <main>, terminando detrás de su fondo
      // sólido en vez de detrás del contenido de esta sección.
      className="relative isolate min-h-svh w-full overflow-hidden"
    >
      <Background />
      <Scene ref={sceneRef} />
      <NeonLights />
      <Overlay />

      {/* absolute inset-0 (no h-full): h-full no resolvía contra el
          min-h-svh de la section (min-height, no height), así que este
          wrapper colapsaba a la altura de su contenido. absolute inset-0 sí
          toma el tamaño renderizado real. flex-col: el header ocupa su
          propia fila arriba y empuja el bloque de texto hacia abajo por
          flujo normal, sin coordenadas absolutas propias. */}
      <div className="absolute inset-0 z-10 flex flex-col">
        <Header ref={headerRef} />
        {/* El bloque de título/subtítulo define dónde empieza "soñaste." —
            Scene.tsx alinea el borde de la foto a este mismo punto (altura
            del header + este padding), así que si se toca alguno de los
            dos hay que ajustar el otro. */}
        <div className="max-w-xl px-6 pt-[56px] sm:px-12 sm:pt-[88px] md:px-20 md:pt-[96px]">
          <Title ref={titleRef} />
          <Subtitle ref={subtitleRef} />
          <Cta ref={ctaRef} />
        </div>
      </div>
    </section>
  );
}
