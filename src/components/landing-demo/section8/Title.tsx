import * as React from "react";

export const Title = React.forwardRef<HTMLHeadingElement>(function Title(_props, ref) {
  return (
    <h2
      ref={ref}
      className="font-display text-[2rem] font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-[3.4rem] xl:text-6xl"
    >
      <span className="block">Mientras vos seguís</span>
      <span className="block">trabajando...</span>
      <span className="block">
        Clippr ya estaba <span style={{ color: "oklch(0.66 0.24 292)" }}>pensando.</span>
      </span>
    </h2>
  );
});
