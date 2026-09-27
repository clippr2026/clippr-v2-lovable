// Lógica de generación de fechas para "Repetir turno" — compartida entre el
// diálogo de turno (crear una serie nueva) y el editor de recurrencia de la
// ficha del cliente (cambiar el patrón de una serie ya activa). Una sola
// fuente de verdad para que ambos flujos generen exactamente las mismas
// fechas ante la misma configuración.

export type RepeatWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type RepeatEndMode = "count" | "until" | "none";

export type RepeatConfig = {
  weekdays: RepeatWeekday[];
  everyWeeks: number;
  endMode: RepeatEndMode;
  count: number;
  until: string; // "YYYY-MM-DD"
};

export const WEEKDAYS: { value: RepeatWeekday; label: string }[] = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

// Tope duro para series "sin fecha de finalización": generamos de a
// ventanas de 8 semanas (56 días) en vez de todo de una — evita crear
// meses/años de reservas de golpe. El resto se completa solo (top-up) a
// medida que se acerca la fecha límite ya generada.
export const RECURRING_WINDOW_DAYS = 56;

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function computeRepeatDates(firstDate: Date, repeat: RepeatConfig): Date[] {
  if (repeat.weekdays.length === 0) return [firstDate];

  const results: Date[] = [];
  const maxIterations = 370;
  const start = new Date(firstDate);
  start.setHours(firstDate.getHours(), firstDate.getMinutes(), 0, 0);

  const untilDate = repeat.endMode === "until" && repeat.until
    ? new Date(`${repeat.until}T23:59:59`)
    : repeat.endMode === "none"
      ? addDays(start, RECURRING_WINDOW_DAYS)
      : null;

  for (let i = 0; i < maxIterations; i++) {
    const candidate = addDays(start, i);
    const weeksFromStart = Math.floor(i / 7);
    if (weeksFromStart % Math.max(1, repeat.everyWeeks) !== 0) continue;
    if (!repeat.weekdays.includes(candidate.getDay() as RepeatWeekday)) continue;
    if (candidate < start) continue;
    if (untilDate && candidate > untilDate) break;

    results.push(candidate);
    if (repeat.endMode === "count" && results.length >= Math.max(1, repeat.count)) break;
  }

  return results.length ? results : [firstDate];
}
