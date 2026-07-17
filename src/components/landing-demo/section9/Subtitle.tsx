import * as React from "react";

export const Subtitle = React.forwardRef<HTMLParagraphElement>(function Subtitle(_props, ref) {
  return (
    <p ref={ref} className="mt-4 text-lg text-white/70 sm:text-xl lg:text-2xl">
      <span className="block">No nació en una oficina.</span>
      <span className="block">Nació detrás de una silla.</span>
    </p>
  );
});
