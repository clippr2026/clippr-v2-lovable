// Canales de origen del cliente ("¿Cómo nos conociste?"). Fuente única usada por
// la reserva pública, Clientes/Contactos y el simulador de Publicidad en Asesor IA.
// `measurable` marca los canales que representan una inversión medible en dinero
// (excluye Recomendado y Otro, que no son publicidad paga).
export const ACQUISITION_CHANNELS = [
  { value: "instagram", label: "Instagram", measurable: true },
  { value: "tiktok", label: "TikTok", measurable: true },
  { value: "facebook", label: "Facebook", measurable: true },
  { value: "google", label: "Google", measurable: true },
  { value: "via_publica", label: "Vía pública", measurable: true },
  { value: "folletos", label: "Folletos", measurable: true },
  { value: "recomendado", label: "Recomendado", measurable: false },
  { value: "otro", label: "Otro", measurable: false },
] as const;

export type AcquisitionChannelValue = (typeof ACQUISITION_CHANNELS)[number]["value"];

export const MEASURABLE_CHANNELS = ACQUISITION_CHANNELS.filter((c) => c.measurable);

export function acquisitionChannelLabel(value: string | null | undefined, custom?: string | null): string {
  if (!value) return "Sin dato";
  if (value === "otro" && custom?.trim()) return custom.trim();
  return ACQUISITION_CHANNELS.find((c) => c.value === value)?.label ?? value;
}
