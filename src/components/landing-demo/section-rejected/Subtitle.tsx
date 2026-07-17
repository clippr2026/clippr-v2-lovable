import * as React from "react";

export const Subtitle = React.forwardRef<HTMLParagraphElement>(function Subtitle(_props, ref) {
  return (
    <p ref={ref} className="mt-2 text-lg text-white/70 sm:text-xl lg:text-2xl">
      No solo registrás los turnos que hiciste. También aprendés de los que no
      pudiste atender.
    </p>
  );
});
