import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

export const CTAButton = React.forwardRef<HTMLDivElement>(function CTAButton(_props, ref) {
  return (
    <div ref={ref} className="flex flex-col items-start gap-3">
      {/* <Link>, no <a href>: navegación del lado del cliente (ver
          section1/Header.tsx para el detalle completo del porqué). */}
      <Link
        to="/login"
        className="s10-cta group inline-flex items-center gap-3 rounded-2xl px-8 py-4 text-lg font-extrabold uppercase tracking-wide text-white transition hover:brightness-110 sm:px-10 sm:py-5 sm:text-xl"
        style={{
          background: "linear-gradient(135deg, oklch(0.62 0.24 292), oklch(0.46 0.24 296))",
          boxShadow: "0 20px 55px -15px oklch(0.55 0.26 292 / 0.75)",
        }}
      >
        Probar gratis
        <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1 sm:h-6 sm:w-6" />
      </Link>
      <span className="text-sm text-white/60">Sin tarjeta. En menos de 3 minutos.</span>
    </div>
  );
});
