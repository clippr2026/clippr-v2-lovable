import * as React from "react";

export const Subtitle = React.forwardRef<HTMLParagraphElement>(function Subtitle(_props, ref) {
  return (
    <p ref={ref} className="mt-2 text-lg text-white/70 sm:text-xl lg:text-2xl">
      Cobrá, controlá y entendé tu negocio desde un solo lugar.
    </p>
  );
});
