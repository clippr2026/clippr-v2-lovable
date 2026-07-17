import * as React from "react";

export const Subtitle = React.forwardRef<
  HTMLParagraphElement,
  { lines?: string[] }
>(function Subtitle({ lines = ["Sin vivir para", "administrarla."] }, ref) {
  return (
    <p
      ref={ref}
      className="mt-5 text-lg font-normal leading-snug text-white/60 sm:mt-6 sm:text-2xl"
    >
      {lines.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
    </p>
  );
});
