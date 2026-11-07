// Fondos y temas de la página pública. El fondo cubre toda la página (arriba y abajo):
// en modo oscuro la base es casi negra, en modo claro es blanca.
export type PublicBgKey = "degrade" | "aurora" | "luces" | "malla" | "liso" | "atardecer" | "foco" | "haz";

export const PUBLIC_BACKGROUNDS: { key: PublicBgKey; label: string }[] = [
  { key: "degrade", label: "Degradé" },
  { key: "aurora", label: "Aurora" },
  { key: "luces", label: "Luces" },
  { key: "malla", label: "Malla" },
  { key: "atardecer", label: "Atardecer" },
  { key: "foco", label: "Foco" },
  { key: "haz", label: "Haz de luz" },
  { key: "liso", label: "Liso" },
];

export function normalizePublicBg(value: unknown): PublicBgKey {
  return PUBLIC_BACKGROUNDS.some((b) => b.key === value) ? (value as PublicBgKey) : "degrade";
}

const mix = (color: string, pct: number, base: string) => `color-mix(in oklch, ${color} ${pct}%, ${base})`;

// Valor de la propiedad CSS `background` para el fondo de toda la página.
export function pageBackground(key: PublicBgKey, light: boolean, primary: string, secondary: string): string {
  const base = light ? "#ffffff" : "#08070c";
  const k = light ? 0.55 : 1; // en claro las luces son más suaves
  const p = (n: number) => Math.round(n * k);
  switch (key) {
    case "liso":
      return base;
    case "aurora":
      return [
        `radial-gradient(80% 45% at 15% 0%, ${mix(primary, p(46), "transparent")}, transparent 70%)`,
        `radial-gradient(70% 40% at 90% 12%, ${mix(secondary, p(38), "transparent")}, transparent 70%)`,
        `radial-gradient(90% 40% at 50% 100%, ${mix(primary, p(30), "transparent")}, transparent 75%)`,
        base,
      ].join(", ");
    case "luces":
      return [
        `radial-gradient(circle at 12% 6%, ${mix(primary, p(48), "transparent")}, transparent 38%)`,
        `radial-gradient(circle at 92% 55%, ${mix(secondary, p(36), "transparent")}, transparent 40%)`,
        `radial-gradient(circle at 20% 96%, ${mix(secondary, p(40), "transparent")}, transparent 38%)`,
        base,
      ].join(", ");
    case "malla":
      return [
        `radial-gradient(55% 30% at 0% 0%, ${mix(primary, p(50), "transparent")}, transparent 70%)`,
        `radial-gradient(55% 30% at 100% 30%, ${mix(secondary, p(42), "transparent")}, transparent 70%)`,
        `radial-gradient(55% 30% at 0% 65%, ${mix(secondary, p(36), "transparent")}, transparent 70%)`,
        `radial-gradient(55% 30% at 100% 100%, ${mix(primary, p(46), "transparent")}, transparent 70%)`,
        base,
      ].join(", ");
    case "atardecer":
      return `linear-gradient(180deg, ${mix(primary, p(55), base)} 0%, ${mix(secondary, p(40), base)} 45%, ${base} 100%)`;
    case "foco":
      return [
        `radial-gradient(70% 38% at 50% 0%, ${mix(primary, p(58), "transparent")}, transparent 72%)`,
        `radial-gradient(60% 30% at 50% 100%, ${mix(secondary, p(30), "transparent")}, transparent 72%)`,
        base,
      ].join(", ");
    case "haz":
      return [
        `conic-gradient(from 200deg at 50% -10%, transparent 0deg, ${mix(primary, p(40), "transparent")} 30deg, transparent 60deg, ${mix(secondary, p(34), "transparent")} 95deg, transparent 130deg)`,
        base,
      ].join(", ");
    default:
      return `linear-gradient(180deg, ${mix(primary, p(32), base)} 0%, ${base} 42%, ${mix(secondary, p(30), base)} 100%)`;
  }
}
