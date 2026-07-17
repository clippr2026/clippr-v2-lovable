import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./lib/motion";
import { attachDemoReplay } from "./lib/scrollReplay";
import { Title } from "./section6/Title";
import { StatsGrid } from "./section6/StatsGrid";
import { RevenueChart } from "./section6/RevenueChart";

gsap.registerPlugin(ScrollTrigger);

// Sección 6: "Los números hablan por vos." — tarjetas entrando
// escalonadas, gráfico de enero a mayo dibujándose con un trazo real
// (stroke-dashoffset), y todos los números (facturación, gastos,
// ocupación, etc.) contando hasta su valor.
export function Section6() {
  const sectionRef = React.useRef<HTMLElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const statsRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const reduced = prefersReducedMotion();
      const line = chartRef.current?.querySelector<SVGPathElement>(".s6-chart-line");
      const length = line?.getTotalLength() ?? 0;

      const setFinalCounters = () => {
        sectionRef.current?.querySelectorAll<HTMLElement>("[data-target]").forEach((el) => {
          const target = Number(el.dataset.target ?? 0);
          el.textContent =
            target < 100 ? String(target) : target.toLocaleString("es-AR");
        });
      };

      if (reduced) {
        gsap.set([titleRef.current, statsRef.current, chartRef.current], { opacity: 1, y: 0 });
        gsap.set(".s6-card", { opacity: 1, y: 0 });
        gsap.set(".s6-chart-area, .s6-chart-dot", { opacity: 1 });
        if (line) line.style.strokeDashoffset = "0";
        setFinalCounters();
        return;
      }

      if (line) {
        line.style.strokeDasharray = String(length);
        line.style.strokeDashoffset = String(length);
      }

      // introTl: título, una sola vez. demoTl: tarjetas + contadores +
      // trazo del gráfico — "la demostración" en sí, que se repite sola
      // (2s de pausa con el gráfico completo) mientras la sección siga a
      // la vista. El .set(line, {strokeDashoffset: length}) vive DENTRO
      // de demoTl (no una sola vez afuera) para que cada repetición del
      // loop vuelva a dibujar el trazo desde cero en vez de arrancar ya
      // completo.
      const introTl = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
      introTl.set(titleRef.current, { opacity: 0, y: 24 });
      introTl.to(titleRef.current, { opacity: 1, y: 0, duration: 0.6 });

      const demoTl = gsap.timeline({
        paused: true,
        defaults: { ease: "power3.out" },
      });
      demoTl.set(".s6-card", { opacity: 0, y: 24 });
      if (line) demoTl.set(line, { strokeDashoffset: length });

      demoTl
        .to(".s6-card", { opacity: 1, y: 0, duration: 0.5, stagger: 0.1 })
        .add(() => {
          sectionRef.current?.querySelectorAll<HTMLElement>("[data-target]").forEach((el) => {
            const target = Number(el.dataset.target ?? 0);
            const counter = { value: 0 };
            gsap.to(counter, {
              value: target,
              duration: 1.2,
              ease: "power2.out",
              onUpdate: () => {
                const v = Math.round(counter.value);
                el.textContent = target < 100 ? String(v) : v.toLocaleString("es-AR");
              },
            });
          });
        }, "-=0.3")
        .to(line ?? {}, { strokeDashoffset: 0, duration: 1.3, ease: "power2.inOut" }, "-=0.9")
        .to(".s6-chart-area", { opacity: 1, duration: 0.6 }, "-=0.5")
        .to(".s6-chart-dot", { opacity: 1, duration: 0.35, stagger: 0.08 }, "-=0.6");
      // El gráfico completo queda en pantalla durante repeatDelay (2s) antes
      // de que el loop reinicie desde el .set() de arriba.

      attachDemoReplay(sectionRef.current!, introTl, demoTl);

      gsap.to([titleRef.current, statsRef.current, chartRef.current], {
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
      className="relative isolate flex min-h-svh w-full flex-col items-start justify-center overflow-hidden px-6 py-16 sm:px-12 md:px-16 lg:px-20"
    >
      <div className="absolute inset-0 -z-30 bg-[#050308]" />
      <div
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          background:
            "radial-gradient(70% 55% at 80% 10%, oklch(0.5 0.2 292 / 0.14), transparent 60%)",
        }}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-start text-left lg:grid lg:grid-cols-[minmax(0,380px)_1fr] lg:items-center lg:gap-12">
        <Title ref={titleRef} />
        <div className="mt-6 flex w-full flex-col gap-3 lg:mt-0">
          <StatsGrid ref={statsRef} />
          <RevenueChart ref={chartRef} />
        </div>
      </div>
    </section>
  );
}
