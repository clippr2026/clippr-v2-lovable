import * as React from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS = ["L", "M", "M", "J", "V", "S", "D"];

// Fecha local (YYYY-MM-DD), nunca toISOString (adelantaría un día en Argentina).
function aISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Selector de fecha estilo Clippr: reemplaza al <input type="date"> nativo (calendario blanco del sistema). */
export function DateClippr({
  value,
  onChange,
  className,
  placeholder = "Elegí una fecha",
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [abierto, setAbierto] = React.useState(false);
  const hoy = aISO(new Date());
  const base = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date();
  const [mes, setMes] = React.useState(base.getMonth());
  const [anio, setAnio] = React.useState(base.getFullYear());

  const abrir = () => {
    const b = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date();
    setMes(b.getMonth());
    setAnio(b.getFullYear());
    setAbierto(true);
  };
  const mover = (delta: number) => {
    const d = new Date(anio, mes + delta, 1);
    setMes(d.getMonth());
    setAnio(d.getFullYear());
  };

  const primerDia = (new Date(anio, mes, 1).getDay() + 6) % 7; // lunes = 0
  const cantDias = new Date(anio, mes + 1, 0).getDate();
  const celdas: (string | null)[] = Array(primerDia).fill(null);
  for (let d = 1; d <= cantDias; d++) celdas.push(aISO(new Date(anio, mes, d)));
  while (celdas.length % 7 !== 0) celdas.push(null);

  const etiqueta = value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "";

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className={cn(
          "flex h-12 w-full touch-manipulation items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-left text-lg outline-none focus:border-violet-400/50",
          value ? "text-white" : "text-white/35",
          className,
        )}
      >
        <span className="truncate">{etiqueta || placeholder}</span>
        <CalendarDays className="size-5 shrink-0 text-white/55" />
      </button>
      {abierto &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[10040] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setAbierto(false)}>
            <div
              className="w-full max-w-sm rounded-[28px] border border-violet-400/45 bg-[#08070f] p-4 shadow-[0_0_0_1px_rgba(139,92,246,0.35),0_30px_90px_-20px_rgba(0,0,0,0.9),0_0_60px_-18px_rgba(139,92,246,0.55)] [background-image:radial-gradient(120%_45%_at_85%_0%,rgba(79,125,255,0.20),transparent_60%),radial-gradient(110%_50%_at_0%_100%,rgba(139,92,246,0.22),transparent_62%)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <button type="button" onClick={() => mover(-1)} aria-label="Mes anterior" className="grid size-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white transition active:scale-95">
                  <ChevronLeft className="size-5" />
                </button>
                <div className="text-lg font-semibold text-white">
                  {MESES[mes]} {anio}
                </div>
                <button type="button" onClick={() => mover(1)} aria-label="Mes siguiente" className="grid size-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white transition active:scale-95">
                  <ChevronRight className="size-5" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {DIAS.map((d, i) => (
                  <div key={i} className="py-1 text-sm font-semibold text-white/50">
                    {d}
                  </div>
                ))}
                {celdas.map((iso, i) =>
                  iso === null ? (
                    <div key={i} />
                  ) : (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        onChange(iso);
                        setAbierto(false);
                      }}
                      className={cn(
                        "grid h-11 touch-manipulation place-items-center rounded-full text-base font-semibold tabular-nums transition",
                        iso === value
                          ? "bg-gradient-to-br from-sky-400 to-violet-500 text-white shadow-[0_0_18px_rgba(139,92,246,0.5)]"
                          : iso === hoy
                            ? "border border-violet-300/60 text-violet-100"
                            : "text-white/85 hover:bg-white/[0.08]",
                      )}
                    >
                      {Number(iso.slice(8))}
                    </button>
                  ),
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onChange(hoy);
                    setAbierto(false);
                  }}
                  className="h-12 rounded-full border border-violet-400/40 bg-violet-500/15 text-base font-semibold text-violet-100 transition hover:bg-violet-500/25"
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => setAbierto(false)}
                  className="h-12 rounded-full border border-white/10 bg-white/[0.04] text-base font-semibold text-white/80 transition hover:bg-white/[0.08]"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
