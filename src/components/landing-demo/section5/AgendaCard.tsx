import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { STATUS_BY_ID, type StatusId } from "./statuses";
// Mismas fotos reales que Section2 (Reserva online) — el mismo equipo se
// repite en toda la landing en vez de inventar caras nuevas por sección.
import photoJulian from "@/assets/landing/section2/pro-julian.webp";
import photoMartin from "@/assets/landing/section2/pro-martin.webp";
import photoLucas from "@/assets/landing/section2/pro-lucas.webp";

// Grilla horaria compartida por las tres columnas — igual criterio que la
// agenda real (bloques posicionados por hora de inicio + duración, no una
// lista plana). 09:00 a 17:00, una línea por hora.
const DAY_START = 9 * 60;
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];
const HOUR_PX = 48;
const GRID_HEIGHT = (HOURS.length - 1) * HOUR_PX;

function top(startMin: number) {
  return ((startMin - DAY_START) / 60) * HOUR_PX;
}
function height(durationMin: number) {
  return (durationMin / 60) * HOUR_PX;
}

type Block =
  | { kind: "break"; start: number; end: number }
  | { kind: "appt"; start: number; end: number; name: string; service: string; status: StatusId };

// El color de cada turno viene siempre de STATUS_BY_ID (ver statuses.ts) —
// nunca un color propio por cliente/servicio — para que coincida con
// StatusLegend arriba de la agenda.
const PROFESSIONALS: {
  id: string;
  name: string;
  photo: string;
  blocks: Block[];
}[] = [
  {
    id: "julian",
    name: "Julián",
    photo: photoJulian,
    blocks: [
      {
        kind: "appt",
        start: 10 * 60,
        end: 10 * 60 + 75,
        name: "Camilo Gómez",
        service: "Coloración",
        status: "confirmed",
      },
      {
        kind: "appt",
        start: 11 * 60 + 30,
        end: 12 * 60 + 15,
        name: "Nahuel Ortiz",
        service: "Corte + Barba",
        status: "confirmed",
      },
      { kind: "break", start: 13 * 60, end: 13 * 60 + 30 },
      {
        kind: "appt",
        start: 14 * 60 + 15,
        end: 15 * 60,
        name: "Tomás Aguirre",
        service: "Barba",
        status: "pending",
      },
      {
        kind: "appt",
        start: 16 * 60,
        end: 16 * 60 + 45,
        name: "Luciano Díaz",
        service: "Corte clásico",
        status: "charged",
      },
    ],
  },
  {
    id: "martin",
    name: "Martín",
    photo: photoMartin,
    blocks: [
      {
        kind: "appt",
        start: 10 * 60,
        end: 10 * 60 + 45,
        name: "Martín López",
        service: "Corte clásico",
        status: "pending",
      },
      {
        kind: "appt",
        start: 12 * 60,
        end: 12 * 60 + 45,
        name: "Franco Roesi",
        service: "Corte + Barba",
        // Arranca "Por confirmar" — Section5 lo cambia a "Confirmados" en
        // vivo apenas se asienta la agenda, un guiño sutil de actividad.
        status: "pending",
      },
      { kind: "break", start: 13 * 60 + 30, end: 14 * 60 },
      {
        kind: "appt",
        start: 14 * 60 + 30,
        end: 15 * 60 + 15,
        name: "Bautista Cruz",
        service: "Corte clásico",
        status: "confirmed",
      },
      {
        kind: "appt",
        start: 16 * 60,
        end: 16 * 60 + 45,
        name: "Diego Ruiz",
        service: "Barba",
        status: "no_show",
      },
    ],
  },
  {
    id: "lucas",
    name: "Lucas",
    photo: photoLucas,
    blocks: [
      {
        kind: "appt",
        start: 10 * 60 + 30,
        end: 11 * 60 + 15,
        name: "Ezequiel Sosa",
        service: "Degradé",
        status: "confirmed",
      },
      { kind: "break", start: 12 * 60 + 30, end: 13 * 60 },
      {
        kind: "appt",
        start: 13 * 60 + 30,
        end: 14 * 60 + 15,
        name: "Mateo Funes",
        service: "Corte clásico",
        status: "charged",
      },
      {
        kind: "appt",
        start: 15 * 60,
        end: 15 * 60 + 40,
        name: "Julián Pérez",
        service: "Degradé",
        // Ningún turno en esta demo queda "Rechazado" a propósito — ese
        // estado sigue visible en StatusLegend (con contador en 0) porque
        // existe en el sistema, pero acá no ocurrió. Ver SectionRejectedClients.
        status: "confirmed",
      },
      {
        kind: "appt",
        start: 16 * 60 + 15,
        end: 17 * 60,
        name: "Bruno Vega",
        service: "Corte clásico",
        status: "cancelled",
      },
    ],
  },
];

const HOUR_LINES_BG =
  "repeating-linear-gradient(to bottom, rgba(255,255,255,0.07) 0, rgba(255,255,255,0.07) 1px, transparent 1px, transparent " +
  HOUR_PX +
  "px)";

export const AgendaCard = React.forwardRef<HTMLDivElement>(function AgendaCard(_props, ref) {
  return (
    <div
      ref={ref}
      className="w-full rounded-[2rem] border border-white/10 bg-white/[0.03] p-4 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:p-6 lg:p-7"
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 text-white/50">
          <ChevronLeft className="h-4 w-4" />
          <ChevronRight className="h-4 w-4" />
        </div>
        <h3 className="flex-1 text-base font-bold text-white lg:text-lg">Martes 14 de mayo</h3>
        <div className="flex gap-1.5 rounded-full bg-white/[0.05] p-1 text-xs font-medium">
          <span className="rounded-full bg-white/10 px-3 py-1 text-white">Día</span>
          <span className="px-3 py-1 text-white/50">Semana</span>
        </div>
      </div>

      {/* Cabecera de cada profesional: foto, nombre e info debajo del
          nombre (cantidad de turnos hoy) — alineada arriba de su propia
          columna, no un listado aparte. Anillo neutro (no de color): el
          color acá lo llevan los turnos, no la foto, para no competir con
          los estados de arriba. */}
      <div className="mt-3 flex lg:mt-5">
        <div className="w-9 shrink-0 sm:w-11" />
        <div className="flex flex-1 divide-x divide-white/10 border-b border-white/10 pb-3">
          {PROFESSIONALS.map((p) => {
            const apptCount = p.blocks.filter((b) => b.kind === "appt").length;
            return (
              <div key={p.id} className="s5-pro-header flex flex-1 flex-col items-center px-1 text-center">
                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full sm:h-11 sm:w-11">
                  <img
                    src={p.photo}
                    alt={p.name}
                    className="h-full w-full object-cover object-top"
                  />
                  <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/20" />
                </div>
                <span className="mt-1.5 truncate text-xs font-semibold text-white sm:text-sm">
                  {p.name}
                </span>
                <span className="truncate text-[10px] text-white/45 sm:text-xs">
                  {apptCount} turnos hoy
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Grilla: gutter de horarios compartido + una columna independiente
          por profesional, claramente separadas (divide-x), cada una con
          sus propios turnos y descansos posicionados por horario real.
          Mobile: recorte puramente visual (no se toca HOURS/DAY_START) que
          arranca la vista en las 10:00 en vez de las 9:00 — la fila 9-10
          estaba siempre vacía (el primer turno de cualquier profesional es
          a las 10:00), así que ese espacio de arriba no mostraba nada.
          overflow-hidden + alto recortado en un contenedor exterior,
          -mt-10 en el interior para correr todo el contenido hacia arriba
          exactamente un HOUR_PX (48px) y que la franja 9-10 quede afuera
          de la ventana visible. Desktop (lg:) vuelve a mostrar la agenda
          completa de 9 a 17, sin recorte — el mismo contenido, sin tocar
          nada de la lógica ni los datos. */}
      <div className="h-[336px] overflow-hidden lg:h-auto lg:overflow-visible">
        <div className="-mt-10 flex lg:mt-2">
          <div className="relative w-9 shrink-0 sm:w-11" style={{ height: GRID_HEIGHT }}>
          {HOURS.map((h) => (
            <span
              key={h}
              className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-white/40"
              style={{ top: top(h * 60) }}
            >
              {h}:00
            </span>
          ))}
        </div>
        <div className="flex flex-1 divide-x divide-white/10">
          {PROFESSIONALS.map((p) => (
            <div
              key={p.id}
              className="relative flex-1 px-1 sm:px-1.5"
              style={{ height: GRID_HEIGHT, backgroundImage: HOUR_LINES_BG }}
            >
              {p.blocks.map((b) =>
                b.kind === "break" ? (
                  <div
                    key={`${p.id}-break-${b.start}`}
                    className="s5-slot absolute inset-x-0.5 flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg text-center"
                    style={{
                      top: top(b.start),
                      height: height(b.end - b.start),
                      border: "1px solid rgba(148,163,184,0.34)",
                      background:
                        "repeating-linear-gradient(135deg, rgba(148,163,184,0.1) 0, rgba(148,163,184,0.1) 6px, rgba(148,163,184,0.18) 6px, rgba(148,163,184,0.18) 12px)",
                    }}
                  >
                    <span className="text-[9px] font-semibold uppercase leading-none tracking-wide text-slate-300/90 sm:text-[10px]">
                      Descanso
                    </span>
                  </div>
                ) : (
                  <div
                    key={`${p.id}-${b.name}`}
                    data-name={b.name}
                    className="s5-slot absolute inset-x-0.5 overflow-hidden rounded-lg px-1.5 py-1 sm:px-2 sm:py-1.5"
                    style={{
                      top: top(b.start),
                      height: height(b.end - b.start),
                      background: `color-mix(in oklch, ${STATUS_BY_ID[b.status].color} 30%, #0a0a0f)`,
                      boxShadow: `inset 0 0 0 1px ${STATUS_BY_ID[b.status].ring}`,
                    }}
                  >
                    <div className="truncate text-[11px] font-semibold leading-tight text-white sm:text-xs">
                      {b.name}
                    </div>
                    <div className="truncate text-[9px] leading-tight text-white/70 sm:text-[11px]">
                      {b.service}
                    </div>
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
});
