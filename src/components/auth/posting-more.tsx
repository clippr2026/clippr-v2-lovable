import * as React from "react";

// Detalle oculto: solo se ve "Ver más", que lo despliega.
export function PostingMore({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      {open && <p className="mb-1 whitespace-pre-line text-base text-white/75">{text}</p>}
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-base font-semibold text-violet-300">
        {open ? "Ver menos" : "Ver más"}
      </button>
    </div>
  );
}
