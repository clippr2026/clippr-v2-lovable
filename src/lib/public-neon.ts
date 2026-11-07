// Neón del encabezado de la página pública: dónde se ve la luz de neón.
export type PublicNeonKey = "ninguno" | "logo" | "banner" | "ambos" | "marco";

export const PUBLIC_NEONS: { key: PublicNeonKey; label: string }[] = [
  { key: "ninguno", label: "Sin neón" },
  { key: "logo", label: "Alrededor del logo" },
  { key: "banner", label: "Detrás del banner" },
  { key: "ambos", label: "Logo y banner" },
  { key: "marco", label: "Marco neón" },
];

export function normalizePublicNeon(value: unknown): PublicNeonKey {
  return PUBLIC_NEONS.some((n) => n.key === value) ? (value as PublicNeonKey) : "ambos";
}
