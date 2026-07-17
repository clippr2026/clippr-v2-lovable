import * as React from "react";

export const Subtitle = React.forwardRef<HTMLParagraphElement>(function Subtitle(_props, ref) {
  return (
    <p ref={ref} className="mt-2 max-w-sm text-lg text-white/70 sm:text-xl lg:text-2xl">
      Tu barbería vive en el teléfono de tus clientes.
    </p>
  );
});
