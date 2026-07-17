import * as React from "react";
import { ArrowRight } from "lucide-react";

// CTA principal de la portada: píldora blanca (no el gradiente violeta que
// ya usa el cierre en section10/CTAButton) con un anillo violeta fino +
// glow suave detrás — el tratamiento del Hero de referencia, que separa
// visualmente "esta es LA acción" del resto de píldoras violetas de la
// página.
export const Cta = React.forwardRef<HTMLAnchorElement>(function Cta(_props, ref) {
  return (
    <a
      ref={ref}
      href="/onboarding"
      className="group mt-8 inline-flex items-center gap-2.5 rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-black transition hover:-translate-y-0.5 sm:mt-9 sm:px-7 sm:py-4 sm:text-base"
      style={{
        boxShadow:
          "0 0 0 1px rgba(139,92,246,0.35), 0 12px 40px -10px rgba(139,92,246,0.45)",
      }}
    >
      Comenzar ahora
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
    </a>
  );
});
