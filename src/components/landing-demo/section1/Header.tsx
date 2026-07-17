import * as React from "react";
import { ArrowRight } from "lucide-react";

// Barra de navegación de la portada: marca a la izquierda (ícono + wordmark
// + separador + copy de categoría) y acciones a la derecha ("Iniciar
// sesión" + CTA en píldora). No existía antes — se suma para igualar la
// composición del Hero de referencia. El lockup de marca es propio de este
// header (no reutiliza section1/Logo, que sigue usándose tal cual en
// Section9 con otro tamaño/contexto).
export const Header = React.forwardRef<HTMLDivElement>(function Header(_props, ref) {
  return (
    <div
      ref={ref}
      // El fijado durante el scroll lo maneja GSAP ScrollTrigger (pin) en
      // Section1.tsx, no "position: sticky" acá: <main> en landing-demo.tsx
      // tiene overflow-x-hidden, que el navegador computa como
      // "overflow-y: auto" (par implícito del spec), y eso convierte a
      // <main> en su propio contenedor de scroll — lo que rompe sticky en
      // cualquier descendiente. ScrollTrigger no depende de eso. z-20 para
      // pintar por encima del bloque de texto (hermano sin z-index propio)
      // una vez que el pin está activo y el contenido scrollea por debajo.
      className="relative z-20 flex w-full items-center justify-between px-6 py-4 sm:px-12 sm:py-5 md:px-20 md:py-6"
    >
      <div className="flex shrink-0 items-center gap-2.5 sm:gap-3">
        <div className="relative h-8 w-8 shrink-0 sm:h-9 sm:w-9">
          <div
            className="pointer-events-none absolute -inset-2 rounded-full opacity-70 blur-lg"
            style={{
              background:
                "radial-gradient(circle, rgba(80,170,255,.35), rgba(175,80,255,.3) 45%, transparent 72%)",
            }}
          />
          <img
            src="/clippr-powered-logo.webp"
            alt="Clippr"
            loading="eager"
            decoding="async"
            className="relative h-full w-full object-contain"
          />
        </div>
        {/* Con "Iniciar sesión" ahora visible también en mobile (antes solo
            desktop), el wordmark de acá compite por el mismo espacio en
            pantallas muy angostas (~320px, iPhone SE) — hasta el punto de
            que el texto se superponía con los botones de la derecha. El
            ícono solo sigue identificando la marca en ese rango; el
            wordmark vuelve a partir de 380px. (360px se probó primero y
            medía exactamente 0px de hueco entre "Clippr" y "Iniciar
            sesión" — technically sin overlap pero sin aire; 380px deja
            ~13px medidos, no una corazonada). */}
        <span className="hidden font-display text-base font-medium text-white min-[380px]:inline sm:hidden">
          Clippr
        </span>
        <div className="hidden items-center gap-3 sm:flex">
          <span className="font-display text-lg font-medium leading-none text-white">
            Clippr
          </span>
          <span className="h-6 w-px shrink-0 bg-white/15" />
          <span className="text-[10px] font-medium uppercase leading-tight tracking-[0.16em] text-white/45">
            Software de gestión
            <br />
            de barbería
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-5">
        <a
          href="/login"
          className="whitespace-nowrap text-xs font-medium text-white/65 transition hover:text-white sm:text-sm"
        >
          Iniciar sesión
        </a>
        <a
          href="/login"
          className="group inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 sm:gap-2 sm:px-5 sm:py-2.5 sm:text-sm"
          style={{
            background: "linear-gradient(135deg, oklch(0.62 0.24 292), oklch(0.46 0.24 296))",
            boxShadow: "0 10px 30px -10px oklch(0.55 0.26 292 / 0.65)",
          }}
        >
          Comenzar ahora
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 sm:h-4 sm:w-4" />
        </a>
      </div>
    </div>
  );
});
