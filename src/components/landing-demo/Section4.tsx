import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./lib/motion";
import { attachDemoReplay } from "./lib/scrollReplay";
import { Title } from "./section4/Title";
import { Subtitle } from "./section4/Subtitle";
import { CashCard } from "./section4/CashCard";

gsap.registerPlugin(ScrollTrigger);

// Sección 4: "Cada corte. Cada peso. En un solo lugar." — mismo patrón de
// layout que la Sección 2 (texto izquierda, mockup protagonista derecha en
// desktop; una sola columna fiel al storyboard en mobile). Panel de datos
// que cuenta desde $0 y se llena en vivo (facturación, cobros, ticket
// promedio, barras de método de pago) — igual que el resto de las demos de
// la landing, se repite sola (2s de pausa con todo asentado) mientras la
// sección siga a la vista, y arranca de cero si el usuario sale del
// viewport y reingresa. El glow de fondo "respirando" es ambiente, no
// parte de la demo — sigue corriendo siempre, sin loop propio ligado a
// esto.
export function Section4() {
  const sectionRef = React.useRef<HTMLElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const subtitleRef = React.useRef<HTMLParagraphElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const glowRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const reduced = prefersReducedMotion();

      const setFinalCounters = () => {
        sectionRef.current
          ?.querySelectorAll<HTMLElement>("[data-target]:not(.s4-bar-fill)")
          .forEach((el) => {
            const target = Number(el.dataset.target ?? 0);
            el.textContent = target.toLocaleString("es-AR");
          });
        sectionRef.current?.querySelectorAll<HTMLElement>(".s4-bar-fill").forEach((el) => {
          el.style.width = `${el.dataset.target}%`;
        });
      };

      if (reduced) {
        gsap.set([titleRef.current, subtitleRef.current, cardRef.current], { opacity: 1, y: 0 });
        gsap.set(".s4-delta", { opacity: 1, y: 0 });
        setFinalCounters();
        return;
      }

      // introTl: título/subtítulo, una sola vez. demoTl: la tarjeta de
      // Caja — cuenta desde $0 y se llena en vivo (~1.5-2s), para que se
      // sienta como una app en uso y no una captura estática — que es "la
      // demostración" y se repite sola (repeat/repeatDelay) mientras la
      // sección siga a la vista.
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
      demoTl.set(".s4-delta", { opacity: 0, y: 8, scale: 1 });
      demoTl.set(".s4-payment-row", { opacity: 0, x: -14 });

      // Facturación / cobros / ticket promedio cuentan, el "+28% vs ayer"
      // entra con un slide breve y un pulso, y las barras de métodos de
      // pago se llenan de izquierda a derecha junto con su porcentaje.
      demoTl
        .to(cardRef.current, { opacity: 1, y: 0, scale: 1, duration: 0.6 })
        .add(() => {
          // Contadores: facturación, cobros y ticket promedio.
          sectionRef.current
            ?.querySelectorAll<HTMLElement>("[data-target]:not(.s4-pct):not(.s4-bar-fill)")
            .forEach((el) => {
              const target = Number(el.dataset.target ?? 0);
              const counter = { value: 0 };
              gsap.to(counter, {
                value: target,
                duration: 1,
                ease: "power2.out",
                onUpdate: () => {
                  el.textContent = Math.round(counter.value).toLocaleString("es-AR");
                },
              });
            });
        }, "-=0.3")
        .to(".s4-delta", { opacity: 1, y: 0, duration: 0.4 }, "-=0.7")
        .to(".s4-payment-row", { opacity: 1, x: 0, duration: 0.45, stagger: 0.1 }, "-=0.5")
        .add(() => {
          // El porcentaje y la barra de cada método de pago se completan
          // juntos, mientras la fila ya está visible.
          sectionRef.current?.querySelectorAll<HTMLElement>(".s4-payment-row").forEach((row) => {
            const pctEl = row.querySelector<HTMLElement>(".s4-pct");
            const barEl = row.querySelector<HTMLElement>(".s4-bar-fill");
            const target = Number(pctEl?.dataset.target ?? 0);
            const counter = { value: 0 };
            gsap.to(counter, {
              value: target,
              duration: 0.8,
              ease: "power2.out",
              onUpdate: () => {
                if (pctEl) pctEl.textContent = String(Math.round(counter.value));
                if (barEl) barEl.style.width = `${counter.value}%`;
              },
            });
          });
        }, "-=0.3")
        // Pulso breve en el "+28%" como cierre del ciclo, antes de la
        // pausa y el reinicio del loop.
        .to(".s4-delta", { scale: 1.06, duration: 0.25, ease: "power1.out" }, "+=0.4")
        .to(".s4-delta", { scale: 1, duration: 0.35, ease: "power1.inOut" });

      attachDemoReplay(sectionRef.current!, introTl, demoTl);

      // Glow de fondo: se asienta una sola vez en su opacidad final, sin
      // loop de "respiración" (yoyo/repeat quitados — un fondo que sigue
      // pulsando para siempre se sentía como un parpadeo constante, no
      // como vida sutil).
      gsap.to(glowRef.current, {
        opacity: 0.85,
        duration: 1.2,
        ease: "sine.out",
      });

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
            "radial-gradient(70% 55% at 20% 85%, oklch(0.5 0.2 292 / 0.14), transparent 60%)",
        }}
      />
      {/* Glow detrás de la tarjeta de Caja — centrado donde la tarjeta
          realmente cae dentro de la columna derecha (~66-68% del viewport
          con el grid y max-width actuales), no en un punto fijo arbitrario
          que quedaba corrido respecto a ella. */}
      <div
        ref={glowRef}
        className="pointer-events-none absolute inset-0 -z-20 hidden lg:block"
        style={{
          background:
            "radial-gradient(46% 62% at 68% 52%, oklch(0.5 0.24 292 / 0.24), transparent 70%)",
        }}
      />

      <div className="relative z-10 flex w-full max-w-[420px] flex-col items-start text-left lg:max-w-none lg:grid lg:grid-cols-[minmax(0,420px)_1fr] lg:items-center lg:gap-8 xl:gap-10">
        <div className="flex flex-col items-start text-left">
          <Title ref={titleRef} />
          <Subtitle ref={subtitleRef} />
        </div>
        <div ref={cardRef} className="mt-6 w-full lg:mt-0 lg:flex lg:justify-center">
          <div className="w-full lg:max-w-[500px] xl:max-w-[560px]">
            <CashCard />
          </div>
        </div>
      </div>
    </section>
  );
}
