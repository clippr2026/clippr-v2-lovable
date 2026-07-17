import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./lib/motion";
import { createSectionReplay } from "./lib/scrollReplay";
import { Title } from "./section4/Title";
import { Subtitle } from "./section4/Subtitle";
import { CashCard } from "./section4/CashCard";

gsap.registerPlugin(ScrollTrigger);

// Sección 4: "Cada corte. Cada peso. En un solo lugar." — mismo patrón de
// layout que la Sección 2 (texto izquierda, mockup protagonista derecha en
// desktop; una sola columna fiel al storyboard en mobile). A diferencia de
// las secciones que cuentan una historia o un flujo en loop (reserva,
// "Clippr trabaja", upselling), esta es un panel de datos: se anima UNA
// sola vez cada vez que se entra a la sección (no en loop continuo — un
// dashboard que no deja de moverse deja de sentirse como una app real),
// y vuelve a jugarse si el usuario sale del viewport y reingresa. Con la
// tarjeta ya asentada, solo quedan dos microanimaciones idle muy sutiles:
// el glow de fondo "respirando" y un pulso ocasional en el "+28%".
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

      // Pulso ocasional del "+28%" — vive fuera de la timeline principal
      // porque esta NO se repite; se relanza a mano cada vez que la
      // timeline principal vuelve a arrancar (ver onStart más abajo), y se
      // mata antes de eso para no pelear con su propio slide de entrada.
      let deltaPulse: gsap.core.Timeline | null = null;

      const tl = gsap.timeline({
        paused: true,
        defaults: { ease: "power3.out" },
        onStart: () => {
          deltaPulse?.kill();
        },
      });
      tl.set([titleRef.current, subtitleRef.current], { opacity: 0, y: 24 });
      tl.set(cardRef.current, { opacity: 0, y: 28, scale: 0.98 });
      tl.set(".s4-delta", { opacity: 0, y: 8, scale: 1 });
      tl.set(".s4-payment-row", { opacity: 0, x: -14 });

      // La tarjeta cuenta desde $0 y se llena en vivo apenas aparece
      // (~1.5-2s en total), para que se sienta como una app en uso y no
      // una captura estática: facturación / cobros / ticket promedio
      // cuentan, el "+28% vs ayer" entra con un slide breve, y las barras
      // de métodos de pago se llenan de izquierda a derecha junto con su
      // porcentaje.
      tl.to(titleRef.current, { opacity: 1, y: 0, duration: 0.6 })
        .to(subtitleRef.current, { opacity: 1, y: 0, duration: 0.55 }, "-=0.35")
        .to(cardRef.current, { opacity: 1, y: 0, scale: 1, duration: 0.6 }, "-=0.25")
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
        .add(() => {
          // La animación de entrada terminó: la tarjeta queda
          // completamente estática salvo por este pulso muy sutil y
          // espaciado en el "+28%", cada 8-10s. Un timeline ida-y-vuelta
          // (no yoyo+repeatDelay en un solo tween) para que el "reposo"
          // quede en escala 1 y no en el pico — si no, se queda pegado al
          // tamaño agrandado durante todo el repeatDelay.
          deltaPulse = gsap.timeline({ delay: 9, repeat: -1, repeatDelay: 8.5 });
          deltaPulse
            .to(".s4-delta", { scale: 1.06, duration: 0.25, ease: "power1.out" })
            .to(".s4-delta", { scale: 1, duration: 0.35, ease: "power1.inOut" });
        });

      // Reproduce entera al entrar, resetea al salir del todo del
      // viewport (y mata el pulso idle del "+28%" para que no siga
      // corriendo fuera de vista).
      createSectionReplay(sectionRef.current!, {
        onPlay: () => tl.restart(),
        onReset: () => {
          tl.pause(0);
          deltaPulse?.kill();
        },
      });

      // Glow de fondo "respirando" muy lento (6-8s por ciclo) — la única
      // otra señal de vida mientras la tarjeta está quieta.
      gsap.to(glowRef.current, {
        opacity: 0.85,
        duration: 4,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
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
