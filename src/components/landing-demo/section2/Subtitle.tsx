import * as React from "react";

export const Subtitle = React.forwardRef<
  HTMLParagraphElement,
  { text?: string }
>(function Subtitle({ text = "Así de fácil." }, ref) {
  return (
    <p ref={ref} className="mt-2 text-lg font-normal text-white/70 sm:text-xl lg:text-2xl">
      {text}
    </p>
  );
});
