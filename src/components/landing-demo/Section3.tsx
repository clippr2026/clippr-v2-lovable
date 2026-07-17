import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./lib/motion";
import { attachDemoReplay } from "./lib/scrollReplay";
import { Title } from "./section3/Title";
import { Subtitle } from "./section3/Subtitle";
import { NotificationsList, NOTIFICATION_GLOW_RGB } from "./section3/NotificationsList";

gsap.registerPlugin(ScrollTrigger);

// Sección 3: "Clippr hace crecer tu barbería." — mismo patrón de layout que
// las Secciones 2 y 4 (texto izquierda, protagonista centrado en la mitad
// derecha en desktop; una sola columna en mobile), sin foto de fondo: fondo
// limpio negro con el mismo glow violeta muy sutil que el resto de la
// landing. El protagonista es la línea de tiempo vertical de notificaciones,
// que se arma de arriba hacia abajo, tarjeta por tarjeta: cada una tiene su
// propio glow de identidad al aparecer (violeta / azul / violeta / verde,
// tomado de NOTIFICATION_GLOW_RGB) y la línea que las conecta se dibuja con
// un pulso en el punto de conexión justo antes de que aparezca la
// siguiente, para que se sienta como un flujo avanzando y no una lista
// estática. Una sola pasada, rápida, por entrada a la sección: "Turno
// cobrado" cierra la secuencia sosteniendo su glow verde y ahí queda fija
// (sin reiniciar sola) hasta que el usuario sale del todo del viewport y
// vuelve a entrar.
const BASE_SHADOW = "0 20px 50px -20px rgba(0,0,0,0.8)";
const cardGlow = (rgb: string, ringOpacity: number, blurOpacity: number, blur = 22, spread = 6) =>
  `0 0 0 1px rgba(${rgb},${ringOpacity}), 0 0 ${blur}px ${spread}px rgba(${rgb},${blurOpacity}), ${BASE_SHADOW}`;
const CARD_GLOWS = NOTIFICATION_GLOW_RGB.map((rgb, i) =>
  // Turno cobrado (último paso) es el momento más importante: glow un
  // poco más intenso que los tres anteriores.
  i === NOTIFICATION_GLOW_RGB.length - 1
    ? cardGlow(rgb, 0.4, 0.28, 26, 8)
    : cardGlow(rgb, 0.3, 0.16),
);

export function Section3() {
  const sectionRef = React.useRef<HTMLElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const subtitleRef = React.useRef<HTMLParagraphElement>(null);
  const notificationsRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const reduced = prefersReducedMotion();
      const cards = gsap.utils.toArray<HTMLElement>(".s3-notification", notificationsRef.current);
      const icons = gsap.utils.toArray<HTMLElement>(".s3-icon", notificationsRef.current);
      const connectors = gsap.utils.toArray<HTMLElement>(".s3-connector", notificationsRef.current);
      const dots = gsap.utils.toArray<HTMLElement>(".s3-dot", notificationsRef.current);

      if (reduced) {
        gsap.set([titleRef.current, subtitleRef.current], { opacity: 1, y: 0 });
        gsap.set(cards, { opacity: 1, y: 0, boxShadow: BASE_SHADOW });
        gsap.set(icons, { scale: 1 });
        gsap.set(connectors, { scaleY: 1 });
        gsap.set(dots, { opacity: 0 });
        return;
      }

      // Dos timelines: introTl (título/subtítulo, una sola vez — no tiene
      // sentido que el texto parpadee en loop) y demoTl (la línea de
      // tiempo de notificaciones, que sí es "una demostración" — cada
      // tarjeta aparece debajo de la anterior con su propio glow de
      // identidad, la línea conectora se "dibuja" entre ambas con un
      // pulso justo antes de que aparezca la siguiente). demoTl arranca
      // sola al terminar introTl y se repite en loop (2s de pausa en
      // "Turno cobrado") mientras la sección siga a la vista — ver
      // attachDemoReplay más abajo.
      const FADE_IN = 0.32;
      const GLOW_SETTLE = 0.26;
      const DRAW = 0.28;
      const PULSE_IN = 0.12;
      const PULSE_OUT = 0.2;
      const HOLD = 0.45;

      const introTl = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
      introTl.set([titleRef.current, subtitleRef.current], { opacity: 0, y: 24 });
      introTl
        .to(titleRef.current, { opacity: 1, y: 0, duration: 0.6 })
        .to(subtitleRef.current, { opacity: 1, y: 0, duration: 0.55 }, "-=0.35");

      const demoTl = gsap.timeline({
        paused: true,
        defaults: { ease: "power3.out" },
      });
      demoTl.set(cards, { opacity: 0, y: -8, boxShadow: BASE_SHADOW });
      demoTl.set(icons, { scale: 1 });
      demoTl.set(connectors, { scaleY: 0 });
      demoTl.set(dots, { opacity: 0, scale: 0.4 });

      // Nueva reserva aparece con un glow violeta suave.
      demoTl
        .to(cards[0], { opacity: 1, y: 0, boxShadow: CARD_GLOWS[0], duration: FADE_IN })
        .to(cards[0], { boxShadow: BASE_SHADOW, duration: GLOW_SETTLE }, "+=0.05");

      // Reserva confirmada / Recordatorio enviado: la línea se dibuja, el
      // punto de conexión pulsa justo antes de llegar, y la tarjeta aparece
      // con su propio glow (azul / violeta) que enseguida se asienta.
      [1, 2].forEach((i) => {
        const label = `card${i}In`;
        demoTl
          .to(connectors[i - 1], { scaleY: 1, duration: DRAW }, `+=${HOLD}`)
          .to(dots[i - 1], { opacity: 1, scale: 1.4, duration: PULSE_IN }, `-=${DRAW * 0.45}`)
          .to(dots[i - 1], { opacity: 0, scale: 0.4, duration: PULSE_OUT })
          .addLabel(label, "<")
          .to(cards[i], { opacity: 1, y: 0, boxShadow: CARD_GLOWS[i], duration: FADE_IN }, label)
          .to(cards[i], { boxShadow: BASE_SHADOW, duration: GLOW_SETTLE }, "+=0.05");

        // El ícono de "Recordatorio enviado" hace un pequeño "pop" al aparecer.
        if (i === 2) {
          demoTl.fromTo(
            icons[2],
            { scale: 0.7 },
            { scale: 1, duration: 0.45, ease: "back.out(3)" },
            label,
          );
        }
      });

      demoTl
        // La línea llega a Turno cobrado: el momento más importante.
        .to(connectors[2], { scaleY: 1, duration: DRAW }, `+=${HOLD}`)
        .to(dots[2], { opacity: 1, scale: 1.4, duration: PULSE_IN }, `-=${DRAW * 0.45}`)
        .to(dots[2], { opacity: 0, scale: 0.4, duration: PULSE_OUT })
        // Glow verde final: se sostiene, sin volver a BASE_SHADOW — es el
        // estado de reposo de la secuencia, no un paso intermedio. Con
        // repeat/repeatDelay esto es lo que queda en pantalla durante los
        // 2s de pausa antes de que el loop reinicie desde cards[0].
        .to(cards[3], { opacity: 1, y: 0, boxShadow: CARD_GLOWS[3], duration: FADE_IN }, "<");

      attachDemoReplay(sectionRef.current!, introTl, demoTl);

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
      <div
        className="pointer-events-none absolute inset-0 -z-20 hidden lg:block"
        style={{
          background:
            "radial-gradient(38% 60% at 78% 50%, oklch(0.5 0.24 292 / 0.20), transparent 68%)",
        }}
      />

      <div className="relative z-10 flex w-full max-w-[420px] flex-col items-start text-left lg:max-w-none lg:grid lg:grid-cols-[minmax(0,420px)_1fr] lg:items-center lg:gap-8 xl:gap-10">
        <div className="flex flex-col items-start text-left">
          <Title ref={titleRef} />
          <Subtitle ref={subtitleRef} />
        </div>
        <div className="mt-6 w-full lg:mt-0 lg:flex lg:justify-center">
          <div className="w-full lg:max-w-[380px]">
            <NotificationsList ref={notificationsRef} />
          </div>
        </div>
      </div>
    </section>
  );
}
