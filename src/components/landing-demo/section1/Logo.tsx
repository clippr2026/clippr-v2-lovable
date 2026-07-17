import * as React from "react";

export const Logo = React.forwardRef<
  HTMLDivElement,
  { name?: string; caption?: string }
>(function Logo(
  {
    name = "Clippr",
    caption = "SOFTWARE DE GESTIÓN PARA BARBERÍAS",
  },
  ref,
) {
  return (
    <div ref={ref} className="flex items-center gap-3 sm:gap-4">
      {/* Logo oficial de Clippr (mismo asset que sidebar/login, en
          public/clippr-powered-logo.webp). Mismo footprint que el ícono
          placeholder anterior (h-12/14 w-12/14); en vez de la caja con
          borde violeta usa el glow suave con el que ya se presenta la
          marca en el resto de la app. */}
      <div className="relative h-12 w-12 shrink-0 sm:h-14 sm:w-14">
        <div
          className="pointer-events-none absolute -inset-3 rounded-full opacity-70 blur-xl"
          style={{
            background:
              "radial-gradient(circle, rgba(80,170,255,.32), rgba(175,80,255,.30) 45%, transparent 72%)",
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
      <div className="min-w-0">
        <div className="font-display text-xl font-medium leading-none text-white sm:text-2xl">
          {name}
        </div>
        <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/45 sm:text-xs">
          {caption}
        </div>
      </div>
    </div>
  );
});
