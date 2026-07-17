// Los 6 estados reales de un turno en Clippr — mismos colores exactos que
// la app (routes/agenda.tsx STATUS_FILTERS, y el chip "Rechazados" de
// components/agenda/rejected-clients.tsx). Única fuente de verdad: tanto
// StatusLegend como AgendaCard leen de acá, para que un turno con estado
// "confirmed" en la agenda use el mismo violeta que el chip "Confirmados"
// de arriba, sin poder desincronizarse.
export const STATUSES = [
  {
    id: "pending",
    label: "Por confirmar",
    color: "oklch(0.72 0.2 245)",
    bg: "oklch(0.72 0.2 245 / 0.12)",
    ring: "oklch(0.72 0.2 245 / 0.3)",
  },
  {
    id: "confirmed",
    label: "Confirmados",
    color: "#8B5CF6",
    bg: "rgba(139, 92, 246, 0.14)",
    ring: "rgba(139, 92, 246, 0.35)",
  },
  {
    id: "charged",
    label: "Cobrados",
    color: "oklch(0.76 0.2 155)",
    bg: "oklch(0.76 0.2 155 / 0.12)",
    ring: "oklch(0.76 0.2 155 / 0.3)",
  },
  {
    id: "cancelled",
    label: "Cancelados",
    color: "oklch(0.76 0.02 270)",
    bg: "oklch(0.76 0.02 270 / 0.10)",
    ring: "oklch(0.76 0.02 270 / 0.25)",
  },
  {
    id: "no_show",
    label: "No asistió",
    color: "oklch(0.68 0.22 25)",
    bg: "oklch(0.68 0.22 25 / 0.12)",
    ring: "oklch(0.68 0.22 25 / 0.30)",
  },
  {
    id: "rejected",
    label: "Rechazados",
    color: "#FBBF24",
    bg: "rgba(245, 158, 11, 0.14)",
    ring: "rgba(245, 158, 11, 0.35)",
  },
] as const;

export type StatusId = (typeof STATUSES)[number]["id"];

export const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s])) as Record<
  StatusId,
  (typeof STATUSES)[number]
>;
