import * as React from "react";

const VIOLET = "oklch(0.66 0.24 292)";

export const Title = React.forwardRef<HTMLHeadingElement>(function Title(_props, ref) {
  return (
    <h2
      ref={ref}
      className="font-display text-[1.9rem] font-extrabold uppercase leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl xl:text-[4rem]"
    >
      <span className="block">Creado por</span>
      <span className="block" style={{ color: VIOLET }}>
        un barbero.
      </span>
      <span className="block">y dueño de</span>
      <span className="block" style={{ color: VIOLET }}>
        barberías.
      </span>
    </h2>
  );
});
