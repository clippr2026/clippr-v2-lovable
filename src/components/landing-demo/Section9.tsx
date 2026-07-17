import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./lib/motion";
import { attachTimelineReplay } from "./lib/scrollReplay";
import { Title } from "./section9/Title";
import { Subtitle } from "./section9/Subtitle";
import { Logo } from "./section1/Logo";
import founderImg from "@/assets/landing/section2/founder.png";

gsap.registerPlugin(ScrollTrigger);

// Foco de la foto: el barbero y el cliente quedan entre el 55% y el 75%
// del ancho original, con bastante negro respirando a la izquierda — de
// ahí que el degradado de la derecha (ver más abajo) funda justo esa
// franja izquierda con el fondo de la sección sin tapar a nadie.
const FOUNDER_FOCAL_POSITION = "68% 32%";

// Sección 9: "Creado por un barbero y dueño de barberías." — texto a la
// izquierda, retrato real del fundador a pantalla completa a la derecha
// (borde a borde, sin tarjeta ni recorte propio: eso es justamente lo que
// la distingue del resto de la landing, donde el protagonista del lado
// derecho vive dentro de un mockup/tarjeta). En mobile no hay espacio para
// ese tratamiento de borde a borde, así que la imagen baja después del
// texto en formato horizontal normal (ver imageMobileRef).
export function Section9() {
  const sectionRef = React.useRef<HTMLElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const subtitleRef = React.useRef<HTMLParagraphElement>(null);
  const logoRef = React.useRef<HTMLDivElement>(null);
  const imageMobileRef = React.useRef<HTMLDivElement>(null);
  const imageDesktopRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const reduced = prefersReducedMotion();

      if (reduced) {
        gsap.set(
          [
            titleRef.current,
            subtitleRef.current,
            logoRef.current,
            imageMobileRef.current,
            imageDesktopRef.current,
          ],
          { opacity: 1, y: 0 },
        );
        return;
      }

      const tl = gsap.timeline({
        paused: true,
        defaults: { ease: "power3.out" },
      });
      tl.set([titleRef.current, subtitleRef.current, logoRef.current], { opacity: 0, y: 20 });
      tl.set(imageMobileRef.current, { opacity: 0, y: 24 });
      // La foto de desktop es borde a borde: solo fade, sin y/scale — con
      // scale se verían los bordes del contenedor (fondo de la sección)
      // asomando durante la animación, ya que no hay tarjeta que la recorte.
      tl.set(imageDesktopRef.current, { opacity: 0 });

      tl.to(titleRef.current, { opacity: 1, y: 0, duration: 0.6 })
        .to(subtitleRef.current, { opacity: 1, y: 0, duration: 0.55 }, "-=0.35")
        .to(logoRef.current, { opacity: 1, y: 0, duration: 0.5 }, "-=0.25")
        .to(imageMobileRef.current, { opacity: 1, y: 0, duration: 0.6 }, "-=0.5")
        .to(imageDesktopRef.current, { opacity: 1, duration: 0.8 }, "-=0.6");

      attachTimelineReplay(sectionRef.current!, tl);

      gsap.to([titleRef.current, subtitleRef.current], {
        opacity: 0.2,
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
      className="relative isolate flex min-h-svh w-full flex-col overflow-hidden lg:flex-row lg:items-stretch"
    >
      <div className="absolute inset-0 -z-30 bg-[#050308]" />
      <div
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          background:
            "radial-gradient(70% 55% at 20% 15%, oklch(0.5 0.2 292 / 0.14), transparent 60%)",
        }}
      />

      <div className="relative z-10 flex w-full flex-col items-start justify-center px-6 pt-10 text-left sm:px-12 sm:pt-16 md:px-16 lg:w-1/2 lg:px-20 lg:py-0">
        <Title ref={titleRef} />
        <Subtitle ref={subtitleRef} />
        <div className="mt-8">
          <Logo ref={logoRef} />
        </div>
      </div>

      {/* Mobile/tablet: la misma foto, en flujo normal debajo del texto,
          formato horizontal (sin el tratamiento borde a borde de desktop,
          que ahí no tiene espacio para respirar) pero AFUERA del bloque de
          texto con su padding grande. Borde a borde de verdad ahora: sin
          padding lateral propio, sin rounded (la sección en sí no tiene
          padding horizontal, así que w-full ya es 100% del ancho de
          pantalla — no hace falta 100vw, que en algunos navegadores
          desborda por el ancho de la scrollbar y genera scroll
          horizontal). */}
      <div ref={imageMobileRef} className="mt-6 w-full pb-10 lg:hidden">
        <img
          src={founderImg}
          alt=""
          aria-hidden="true"
          className="aspect-[16/10] w-full object-cover"
          style={{ objectPosition: FOUNDER_FOCAL_POSITION }}
        />
      </div>

      {/* Desktop: retrato real del fundador, borde a borde, ocupando toda
          la mitad derecha de la sección de arriba a abajo — sin tarjeta,
          sin radio, sin recorte propio. El degradado funde el tercio
          izquierdo de la foto con el negro de la sección para que el texto
          siga siendo el protagonista. */}
      <div ref={imageDesktopRef} className="relative hidden w-1/2 lg:block">
        <img
          src={founderImg}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: FOUNDER_FOCAL_POSITION }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, #050308 0%, rgba(5,3,8,0.82) 14%, rgba(5,3,8,0.35) 32%, transparent 58%)",
          }}
        />
      </div>
    </section>
  );
}
