import * as React from "react";
import { STATUSES } from "./statuses";

// Cuántos turnos de cada estado se ven en la agenda de abajo (AgendaCard) —
// hardcodeado a mano porque los datos de la agenda también lo están, pero
// number por number coincide con lo que realmente se muestra, igual que en
// la app real (el chip cuenta los turnos del día, no un número inventado).
// Cuenta el estado "asentado" (Franco Roesi ya pasó de Por confirmar a
// Confirmados vía Section5, que es como se ve la agenda la mayor parte
// del tiempo): Martín López (pending) + Camilo Gómez, Julián Pérez y
// Franco Roesi (confirmed) + Luciano Díaz (charged) + Bruno Vega
// (cancelled) + Sofía Ruiz (no_show) = 7 turnos.
const COUNTS: Record<string, number> = {
  pending: 1,
  confirmed: 3,
  charged: 1,
  cancelled: 1,
  no_show: 1,
  // Rechazados existe como estado del sistema (por eso sigue en la barra)
  // pero en esta demo no hay ningún turno con ese estado — la Sección de
  // Clientes rechazados, más adelante, es donde eso cobra sentido.
  rejected: 0,
};

// Mismo chip exacto que usa la app real en la barra de estados de la
// agenda (routes/agenda.tsx STATUS_FILTERS) y el botón "Rechazados"
// (components/agenda/rejected-clients.tsx) — mismo radio, padding,
// tipografía y fórmula de color (bg tenue + anillo + texto saturado). Acá
// arriba de la agenda para que el visitante asocie el color al estado
// antes de leer los turnos.
export function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {STATUSES.map((s) => (
        <span
          key={s.id}
          className="s5-legend-pill inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium"
          style={{ background: s.bg, boxShadow: `0 0 0 1px ${s.ring}`, color: s.color }}
        >
          <span className="text-sm font-semibold tabular-nums">{COUNTS[s.id] ?? 0}</span>
          <span className="opacity-80">{s.label}</span>
        </span>
      ))}
    </div>
  );
}
