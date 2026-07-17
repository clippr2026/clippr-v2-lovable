import * as React from "react";

export const Title = React.forwardRef<HTMLHeadingElement>(function Title(_props, ref) {
  return (
    <h2
      ref={ref}
      className="font-display text-[2.75rem] font-semibold leading-[1.03] tracking-tight text-white sm:text-5xl sm:leading-[1.1] lg:text-6xl"
    >
      <span className="block">El próximo dueño de barbería</span>
      <span className="block">que va a crecer...</span>
      <span className="block" style={{ color: "oklch(0.66 0.24 292)" }}>
        podés ser vos.
      </span>
    </h2>
  );
});
