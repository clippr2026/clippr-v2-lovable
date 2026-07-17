import * as React from "react";

export const Subtitle = React.forwardRef<HTMLParagraphElement>(function Subtitle(_props, ref) {
  return (
    <p ref={ref} className="mt-2 max-w-md text-sm text-white/70 sm:mt-4 sm:text-xl lg:text-2xl">
      Mientras un cliente reserva, Clippr puede sugerir automáticamente productos con descuento en
      el momento indicado.
    </p>
  );
});
