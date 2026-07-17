import * as React from "react";

export const Subtitle = React.forwardRef<
  HTMLParagraphElement,
  { text?: string }
>(function Subtitle({ text = "Así de fácil." }, ref) {
  return (
    <p ref={ref} className="mt-1.5 text-sm font-normal text-white/70 sm:mt-2 sm:text-xl lg:text-2xl">
      {text}
    </p>
  );
});
