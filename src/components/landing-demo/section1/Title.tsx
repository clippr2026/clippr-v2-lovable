import * as React from "react";

export const Title = React.forwardRef<
  HTMLHeadingElement,
  { lines?: string[]; accent?: string }
>(function Title(
  { lines = ["La barbería", "que siempre"], accent = "soñaste." },
  ref,
) {
  return (
    <h1
      ref={ref}
      className="font-display text-[2.75rem] font-semibold leading-[1.06] tracking-[-0.02em] text-white sm:text-6xl md:text-[4rem] lg:text-[4.5rem]"
    >
      {lines.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
      <span
        className="block bg-clip-text text-transparent"
        style={{
          backgroundImage:
            "linear-gradient(90deg, oklch(0.76 0.16 288), oklch(0.62 0.24 296))",
        }}
      >
        {accent}
      </span>
    </h1>
  );
});
