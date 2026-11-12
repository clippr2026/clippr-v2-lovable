import * as React from "react";
import { createPortal } from "react-dom";
import { Check, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";

export const SLOT_OPTIONS = [20, 30, 40, 45, 50, 60] as const;
export type SlotMinutes = (typeof SLOT_OPTIONS)[number];
export const SLOT_STORAGE_KEY = "clippr-agenda-slot-minutes";

/** Lee la escala guardada (la misma que usa la Agenda); 60 si no hay nada. */
export function readStoredSlotMinutes(): SlotMinutes {
  if (typeof window === "undefined") return 60;
  const stored = Number(window.localStorage.getItem(SLOT_STORAGE_KEY));
  return (SLOT_OPTIONS as readonly number[]).includes(stored) ? (stored as SlotMinutes) : 60;
}

/**
 * Botón del reloj ("Escala de horarios") con un menú propio en estilo Clippr:
 * ventana oscura con borde violeta y la opción elegida resaltada.
 */
export function SlotScaleSelect({
  value,
  onChange,
  className,
}: {
  value: SlotMinutes;
  onChange: (v: SlotMinutes) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = React.useRef<HTMLButtonElement>(null);

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const width = 200;
      setPos({
        top: Math.min(r.bottom + 8, window.innerHeight - 340),
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      });
    }
    setOpen((v) => !v);
  };

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="Escala de horarios"
        aria-label="Escala de horarios"
        aria-expanded={open}
        onClick={toggle}
        className={cn(
          "flex h-8 w-[50px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-foreground/80 shadow-[0_10px_24px_-18px_rgba(0,0,0,0.9)] transition hover:bg-white/[0.07]",
          className,
        )}
      >
        <Clock3 className="h-4 w-4" />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <button type="button" aria-label="Cerrar" className="fixed inset-0 z-[110] cursor-default" onClick={() => setOpen(false)} />
            <div
              className="fixed z-[111] w-[200px] overflow-hidden rounded-[22px] border border-violet-400/45 bg-[#08070f] p-2 shadow-[0_0_0_1px_rgba(139,92,246,0.35),0_30px_90px_-20px_rgba(0,0,0,0.9),0_0_50px_-18px_rgba(139,92,246,0.55)] [background-image:radial-gradient(120%_45%_at_85%_0%,rgba(79,125,255,0.20),transparent_60%),radial-gradient(110%_50%_at_0%_100%,rgba(139,92,246,0.22),transparent_62%)]"
              style={{ top: pos.top, left: pos.left }}
            >
              <div className="px-3 pb-1.5 pt-2 text-xs font-semibold text-white/60">Escala de horarios</div>
              {SLOT_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    onChange(m);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-11 w-full items-center justify-between rounded-2xl px-3 text-sm font-semibold transition",
                    m === value ? "bg-violet-500/15 text-white ring-1 ring-violet-300/50" : "text-white/80 hover:bg-white/[0.06]",
                  )}
                >
                  <span>{m} minutos</span>
                  {m === value && <Check className="h-4 w-4 text-violet-200" />}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
