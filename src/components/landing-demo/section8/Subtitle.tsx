import * as React from "react";

export const Subtitle = React.forwardRef<HTMLParagraphElement>(function Subtitle(_props, ref) {
  return (
    <p ref={ref} className="mt-1.5 max-w-sm text-sm text-white/70 sm:mt-2 sm:text-xl lg:text-2xl">
      IA que analiza tu negocio y te dice qué hacer para hacerlo crecer.
    </p>
  );
});
