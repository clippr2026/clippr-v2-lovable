import * as React from "react";

// Texto largo plegado: muestra 2 líneas y un "Ver más" para abrirlo.
export function PostingMore({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  const long = text.length > 90;
  return (
    <div>
      <p className={`whitespace-pre-line text-base text-white/75 ${open || !long ? "" : "line-clamp-2"}`}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-base font-semibold text-violet-300">
          {open ? "Ver menos" : "Ver más"}
        </button>
      )}
    </div>
  );
}
