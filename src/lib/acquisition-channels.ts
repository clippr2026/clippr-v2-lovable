import type { IconType } from "react-icons";
import { SiInstagram, SiTiktok, SiFacebook, SiGoogle } from "react-icons/si";

// ─────────────────────────────────────────────────────────────────────────────
// Fuente única de canales de origen del cliente ("¿Cómo nos conociste?").
// Reserva pública, agenda, Clientes/Contactos y Asesor IA leen TODOS de acá —
// para sumar un canal nuevo (YouTube, LinkedIn, X, QR, Influencer, Evento...)
// alcanza con agregar una entrada en ACQUISITION_CHANNELS.
// ─────────────────────────────────────────────────────────────────────────────

export type AcquisitionChannelIconSpec =
  | { kind: "brand"; component: IconType; color: string }
  | { kind: "emoji"; value: string };

export type AcquisitionChannel = {
  id: string;
  label: string;
  icon: AcquisitionChannelIconSpec;
  order: number;
  /** Es un canal de inversión medible (usable en el simulador de Publicidad). */
  measurable: boolean;
  /** Solo "Otro": muestra un campo de texto libre y lo guarda como canal personalizado. */
  requiresText?: boolean;
};

const RAW_CHANNELS: AcquisitionChannel[] = [
  { id: "instagram", label: "Instagram", order: 1, measurable: true, icon: { kind: "brand", component: SiInstagram, color: "#E4405F" } },
  { id: "tiktok", label: "TikTok", order: 2, measurable: true, icon: { kind: "brand", component: SiTiktok, color: "#25F4EE" } },
  { id: "facebook", label: "Facebook", order: 3, measurable: true, icon: { kind: "brand", component: SiFacebook, color: "#1877F2" } },
  { id: "google", label: "Google", order: 4, measurable: true, icon: { kind: "brand", component: SiGoogle, color: "#4285F4" } },
  { id: "via_publica", label: "Vía pública", order: 5, measurable: true, icon: { kind: "emoji", value: "📍" } },
  { id: "folletos", label: "Folletos", order: 6, measurable: true, icon: { kind: "emoji", value: "🧾" } },
  { id: "recomendado", label: "Recomendado", order: 7, measurable: false, icon: { kind: "emoji", value: "🤝" } },
  { id: "otro", label: "Otro", order: 8, measurable: false, requiresText: true, icon: { kind: "emoji", value: "✍️" } },
];

export const ACQUISITION_CHANNELS: AcquisitionChannel[] = [...RAW_CHANNELS].sort((a, b) => a.order - b.order);

export type AcquisitionChannelId = (typeof ACQUISITION_CHANNELS)[number]["id"];

export const MEASURABLE_CHANNELS = ACQUISITION_CHANNELS.filter((c) => c.measurable);

export function acquisitionChannelRequiresText(id: string | null | undefined): boolean {
  return Boolean(id && ACQUISITION_CHANNELS.find((c) => c.id === id)?.requiresText);
}

export function acquisitionChannelLabel(id: string | null | undefined, custom?: string | null): string {
  if (!id) return "Sin dato";
  if (custom?.trim()) return custom.trim();
  return ACQUISITION_CHANNELS.find((c) => c.id === id)?.label ?? id;
}
