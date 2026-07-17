import * as React from "react";

export const Title = React.forwardRef<HTMLHeadingElement>(function Title(_props, ref) {
  return (
    <h2
      ref={ref}
      className="font-display text-2xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl sm:leading-[1.08] lg:text-6xl xl:text-[4.25rem]"
    >
      <span className="block">Cada turno puede valer más.</span>
      <span className="block" style={{ color: "oklch(0.66 0.24 292)" }}>
        Aumentá tu ticket promedio.
      </span>
    </h2>
  );
});
