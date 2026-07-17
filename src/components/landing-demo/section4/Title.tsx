import * as React from "react";

export const Title = React.forwardRef<HTMLHeadingElement>(function Title(_props, ref) {
  return (
    <h2
      ref={ref}
      className="font-display text-[2.25rem] font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl xl:text-[4.25rem]"
    >
      <span className="block">Cada corte.</span>
      <span className="block">Cada peso.</span>
      <span
        className="block"
        style={{
          color: "oklch(0.7 0.24 292)",
          textShadow: "0 0 28px oklch(0.66 0.24 292 / 0.5)",
        }}
      >
        En un solo lugar.
      </span>
    </h2>
  );
});
