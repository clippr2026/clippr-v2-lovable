import * as React from "react";

export const Title = React.forwardRef<HTMLHeadingElement>(function Title(_props, ref) {
  return (
    <h2
      ref={ref}
      className="font-display text-[2.25rem] font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl xl:text-[4.25rem]"
    >
      <span className="block">Tu barbería</span>
      <span className="block">
        ahora es <span style={{ color: "oklch(0.66 0.24 292)" }}>una app.</span>
      </span>
    </h2>
  );
});
