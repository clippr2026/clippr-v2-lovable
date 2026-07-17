import * as React from "react";

// A diferencia del título de la Sección 1, acá ninguna línea lleva el
// acento violeta — las dos líneas van en blanco, tal cual el storyboard.
export const Title = React.forwardRef<
  HTMLHeadingElement,
  { lines?: string[] }
>(function Title({ lines = ["Un cliente", "reserva."] }, ref) {
  return (
    <h2
      ref={ref}
      className="font-display text-[2.25rem] font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl md:text-[3.25rem] lg:text-[3.6rem] xl:text-[4.25rem]"
    >
      {lines.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
    </h2>
  );
});
