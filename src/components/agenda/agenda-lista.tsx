import * as React from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Appointment } from "@/components/agenda/use-agenda-data";
import { cn } from "@/lib/utils";

// Vista lista de la Agenda (celular): solo los turnos registrados del día elegido, en orden de horario,
// con un selector semanal arriba. Es solo otra forma de ver los mismos datos: tocar un turno abre el
// mismo detalle que en el calendario.

type Meta = { label: string; dot: string; border: string; bg: string };

const DIA_MS = 86_400_000;
const inicioDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const inicioSemana = (d: Date) => {
  const x = inicioDia(d);
  const dow = (x.getDay() + 6) % 7; // lunes = 0
  return new Date(x.getFullYear(), x.getMonth(), x.getDate() - dow);
};
const mismoDia = (a: Date, b: Date) => inicioDia(a).getTime() === inicioDia(b).getTime();
const hora = (d: Date) => d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function AgendaLista({
  fecha,
  onFecha,
  turnos,
  empleados,
  metaDe,
  onTurno,
  conSemana = true,
}: {
  conSemana?: boolean;
  fecha: Date;
  onFecha: (d: Date) => void;
  /** Turnos ya filtrados por profesional y estado (sin bloqueos). */
  turnos: Appointment[];
  empleados: Array<{ id: string; full_name?: string | null; name?: string | null; avatar_url?: string | null }>;
  metaDe: (a: Appointment) => Meta;
  onTurno: (a: Appointment) => void;
}) {
  const semana = inicioSemana(fecha);
  const dias = Array.from({ length: 7 }, (_, i) => new Date(semana.getTime() + i * DIA_MS + 3_600_000)).map(inicioDia);
  const hoy = new Date();
  const mes = cap(fecha.toLocaleDateString("es-AR", { month: "long", year: "numeric" }));
  const moverSemana = (n: number) => onFecha(inicioDia(new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + 7 * n)));

  // Deslizar con el dedo cambia de semana.
  const toque = React.useRef<{ x: number; y: number } | null>(null);

  const delDia = turnos
    .filter((a) => mismoDia(new Date(a.starts_at), fecha))
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const nombreDe = (id: string | null | undefined) => {
    const e = empleados.find((x) => x.id === id);
    return (e?.full_name || e?.name || "").trim();
  };

  return (
    <div className="agenda-lista space-y-3">
      {conSemana && (
      <div
        className="agenda-semana rounded-2xl border border-white/10 bg-[#111019] px-2 pb-2 pt-2.5"
        onTouchStart={(e) => (toque.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const ini = toque.current;
          toque.current = null;
          if (!ini) return;
          const dx = e.changedTouches[0].clientX - ini.x;
          const dy = e.changedTouches[0].clientY - ini.y;
          if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) moverSemana(dx < 0 ? 1 : -1);
        }}
      >
        <div className="mb-2 flex items-center justify-between px-1">
          <button type="button" onClick={() => moverSemana(-1)} aria-label="Semana anterior" className="grid h-7 w-7 place-items-center rounded-full text-white/60 hover:bg-white/[0.06]">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-white">{mes}</span>
          <button type="button" onClick={() => moverSemana(1)} aria-label="Semana siguiente" className="grid h-7 w-7 place-items-center rounded-full text-white/60 hover:bg-white/[0.06]">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {dias.map((d) => {
            const elegido = mismoDia(d, fecha);
            const esHoy = mismoDia(d, hoy);
            return (
              <button
                key={d.getTime()}
                type="button"
                onClick={() => onFecha(d)}
                data-elegido={elegido || undefined}
                className={cn(
                  "dia-semana flex flex-col items-center rounded-xl py-1.5 transition",
                  elegido ? "bg-violet-600 text-white" : "text-white/80 hover:bg-white/[0.05]",
                )}
              >
                <span className="text-base font-bold leading-tight tabular-nums">{d.getDate()}</span>
                <span className={cn("text-[10px] font-semibold uppercase tracking-wide", elegido ? "text-white/85" : "text-white/45")}>
                  {d.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "").slice(0, 3)}
                </span>
                <span className={cn("mt-0.5 h-1 w-1 rounded-full", esHoy && !elegido ? "bg-violet-400" : "bg-transparent")} />
              </button>
            );
          })}
        </div>
      </div>
      )}

      {delDia.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#111019] px-4 py-10 text-center text-sm text-white/55">
          No hay turnos para este día
        </div>
      ) : (
        <div className="relative space-y-2.5">
          {delDia.map((a) => (
            <div key={a.id} className="flex gap-2.5">
              <div className="flex w-11 shrink-0 flex-col items-end pt-3">
                <span className="text-[13px] font-semibold tabular-nums text-white/80">{hora(new Date(a.starts_at))}</span>
              </div>
              <TarjetaTurno a={a} meta={metaDe(a)} profesional={nombreDe(a.employee_id)} onClick={() => onTurno(a)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tarjeta de un turno (vista lista y ventana de estados): cliente, estado, servicio y duración, horario y profesional. */
export function TarjetaTurno({ a, meta, profesional, onClick }: { a: Appointment; meta: Meta; profesional: string; onClick: () => void }) {
  const ini = new Date(a.starts_at);
  const fin = a.ends_at ? new Date(a.ends_at) : new Date(ini.getTime() + (Number(a.duration_min) || 0) * 60_000);
  const minutos = Math.max(0, Math.round((fin.getTime() - ini.getTime()) / 60_000));
  return (
    <button
      type="button"
      onClick={onClick}
      className="turno-lista min-w-0 flex-1 rounded-2xl border px-3.5 py-2.5 text-left transition active:scale-[0.99]"
      style={{ ["--c" as string]: meta.dot } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-[15px] font-semibold text-white">{a.client_name || "Cliente"}</span>
        <span className="estado-turno shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold">{meta.label}</span>
      </div>
      <div className="mt-0.5 truncate text-[13px] text-white/70">
        {a.service_name || "Servicio"}
        {minutos > 0 ? ` · ${minutos} min` : ""}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-white/55">
        <span className="tabular-nums">
          {hora(ini)} – {hora(fin)}
        </span>
        {profesional && <span className="min-w-0 truncate font-medium text-white/75">{profesional}</span>}
      </div>
    </button>
  );
}

/** Ventana encima de la Agenda con los turnos de un estado (celular). */
export function TurnosDeEstado({
  titulo,
  vacio,
  turnos,
  metaDe,
  nombreDe,
  onTurno,
  onCerrar,
}: {
  titulo: string;
  vacio: string;
  turnos: Appointment[];
  metaDe: (a: Appointment) => Meta;
  nombreDe: (id: string | null | undefined) => string;
  onTurno: (a: Appointment) => void;
  onCerrar: () => void;
}) {
  // Mismo bloqueo de scroll que el resto de los modales (contador común): si se abre el detalle de un turno
  // desde acá, al cerrarse todo la página vuelve a desplazarse.
  useBodyScrollLock(true);
  const cerrarRef = React.useRef(onCerrar);
  cerrarRef.current = onCerrar;
  React.useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && cerrarRef.current();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);
  const ordenados = [...turnos].sort((x, y) => new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime());
  return createPortal(
    <div className="fixed inset-0 z-[10020] flex items-end bg-black/60 sm:items-center sm:justify-center sm:p-4" onClick={onCerrar}>
      <div
        role="dialog"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
        className="turnos-estado flex h-[85dvh] w-full flex-col rounded-t-3xl border border-white/10 bg-[#0d0c15] sm:max-w-md sm:rounded-3xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-4">
          <h2 className="text-lg font-bold text-white">
            {titulo} <span className="tabular-nums text-white/50">({ordenados.length})</span>
          </h2>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="grid h-9 w-9 place-items-center rounded-full text-white/60 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom,0px)+20px)]">
          {ordenados.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-white/55">{vacio}</div>
          ) : (
            ordenados.map((a) => (
              <div key={a.id} className="flex">
                <TarjetaTurno a={a} meta={metaDe(a)} profesional={nombreDe(a.employee_id)} onClick={() => onTurno(a)} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
