import * as React from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Selector estilo Clippr: reemplaza al <select> nativo (que en el celular abre una lista blanca). */
export function SelectClippr({
  opciones,
  valor,
  onChange,
  className,
}: {
  opciones: Array<{ id: string; label: string }>;
  valor: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const [abierto, setAbierto] = React.useState(false);
  const actual = opciones.find((o) => o.id === valor) ?? opciones[0];
  return (
    <div className={cn("relative min-w-0", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        className="flex h-12 w-full touch-manipulation items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-left text-base font-semibold text-white outline-none focus:border-violet-400/50"
      >
        <span className="truncate">{actual?.label ?? "—"}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-white/60 transition-transform", abierto && "rotate-180")} />
      </button>
      {abierto && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden onClick={() => setAbierto(false)} />
          <ul
            role="listbox"
            className="absolute left-0 top-[52px] z-50 max-h-64 min-w-full overflow-y-auto rounded-2xl border border-violet-400/45 bg-[#08070f] p-1.5 shadow-[0_0_0_1px_rgba(139,92,246,0.3),0_24px_60px_-12px_rgba(0,0,0,0.9),0_0_40px_-14px_rgba(139,92,246,0.6)] [background-image:radial-gradient(120%_60%_at_85%_0%,rgba(79,125,255,0.18),transparent_60%),radial-gradient(110%_60%_at_0%_100%,rgba(139,92,246,0.2),transparent_62%)]"
          >
            {opciones.map((o) => {
              const activo = o.id === (actual?.id ?? "");
              return (
                <li key={o.id} role="option" aria-selected={activo}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.id);
                      setAbierto(false);
                    }}
                    className={cn(
                      "flex min-h-11 w-full touch-manipulation items-center gap-2 whitespace-nowrap rounded-xl px-3 text-left text-base font-semibold",
                      activo ? "bg-violet-500/20 text-white" : "text-white/75",
                    )}
                  >
                    <CheckCircle2 className={cn("h-4 w-4 shrink-0", activo ? "text-emerald-300" : "text-transparent")} />
                    <span className="min-w-0">{o.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
