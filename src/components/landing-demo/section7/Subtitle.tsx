import * as React from "react";

export const Subtitle = React.forwardRef<HTMLParagraphElement>(function Subtitle(_props, ref) {
  return (
    <p ref={ref} className="mt-1.5 max-w-sm text-base text-white/70 sm:text-xl lg:mt-2 lg:text-2xl">
      Tu barbería vive en el teléfono de tus clientes.
    </p>
  );
});
