// Fondos y temas de la página pública. El fondo cubre toda la página (arriba y abajo):
// en modo oscuro la base es casi negra, en modo claro es blanca.
export type PublicBgKey =
  | "degrade" | "aurora" | "luces" | "malla" | "puntos" | "liso"
  | "atardecer" | "foco" | "haz" | "cuadricula" | "rayas" | "ondas";

export const PUBLIC_BACKGROUNDS: { key: PublicBgKey; label: string }[] = [
  { key: "degrade", label: "Degradé" },
  { key: "aurora", label: "Aurora" },
  { key: "luces", label: "Luces" },
  { key: "malla", label: "Malla" },
  { key: "puntos", label: "Puntos" },
  { key: "atardecer", label: "Atardecer" },
  { key: "foco", label: "Foco" },
  { key: "haz", label: "Haz de luz" },
  { key: "cuadricula", label: "Cuadrícula" },
  { key: "rayas", label: "Rayas" },
  { key: "ondas", label: "Ondas" },
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
    case "puntos":
      return [
        `radial-gradient(${mix(primary, light ? 40 : 55, "transparent")} 1.2px, transparent 1.6px) 0 0 / 22px 22px`,
        `linear-gradient(180deg, ${mix(primary, p(26), base)} 0%, ${base} 45%, ${mix(secondary, p(24), base)} 100%)`,
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
    case "cuadricula":
      return [
        `linear-gradient(${mix(primary, light ? 14 : 22, "transparent")} 1px, transparent 1px) 0 0 / 32px 32px`,
        `linear-gradient(90deg, ${mix(primary, light ? 14 : 22, "transparent")} 1px, transparent 1px) 0 0 / 32px 32px`,
        `radial-gradient(80% 40% at 50% 0%, ${mix(secondary, p(30), "transparent")}, transparent 70%)`,
        base,
      ].join(", ");
    case "rayas":
      return [
        `repeating-linear-gradient(135deg, ${mix(primary, light ? 10 : 16, "transparent")} 0 14px, transparent 14px 28px)`,
        `linear-gradient(180deg, ${mix(secondary, p(22), base)} 0%, ${base} 50%, ${mix(primary, p(24), base)} 100%)`,
      ].join(", ");
    case "ondas":
      return [
        `radial-gradient(120% 22% at 50% 12%, ${mix(primary, p(34), "transparent")}, transparent 70%)`,
        `radial-gradient(120% 22% at 50% 45%, ${mix(secondary, p(28), "transparent")}, transparent 70%)`,
        `radial-gradient(120% 22% at 50% 80%, ${mix(primary, p(30), "transparent")}, transparent 70%)`,
        base,
      ].join(", ");
    default:
      return `linear-gradient(180deg, ${mix(primary, p(32), base)} 0%, ${base} 42%, ${mix(secondary, p(30), base)} 100%)`;
  }
}

export type PublicThemePreset = {
  key: string;
  label: string;
  colors: { primary: string; secondary: string; accent: string; buttonText: string };
  mode: "dark" | "light";
  bg: PublicBgKey;
  font: string | null;
};

// Temas: combinan colores, modo, fondo y tipografía de una sola vez.
export const PUBLIC_THEMES: PublicThemePreset[] = [
  { key: "neon-nocturno", label: "Neón nocturno", colors: { primary: "#7c3aed", secondary: "#d946ef", accent: "#a78bfa", buttonText: "#ffffff" }, mode: "dark", bg: "aurora", font: "spacegrotesk" },
  { key: "oro-negro", label: "Oro y negro", colors: { primary: "#b45309", secondary: "#f59e0b", accent: "#d6b66a", buttonText: "#1a1100" }, mode: "dark", bg: "degrade", font: "playfair" },
  { key: "oceano", label: "Océano", colors: { primary: "#2563eb", secondary: "#06b6d4", accent: "#60a5fa", buttonText: "#ffffff" }, mode: "dark", bg: "malla", font: "montserrat" },
  { key: "atardecer", label: "Atardecer", colors: { primary: "#dc2626", secondary: "#f97316", accent: "#fb923c", buttonText: "#ffffff" }, mode: "dark", bg: "luces", font: "oswald" },
  { key: "rosa-pop", label: "Rosa pop", colors: { primary: "#db2777", secondary: "#f472b6", accent: "#f9a8d4", buttonText: "#ffffff" }, mode: "dark", bg: "puntos", font: "poppins" },
  { key: "bosque", label: "Bosque", colors: { primary: "#059669", secondary: "#84cc16", accent: "#34d399", buttonText: "#00110a" }, mode: "dark", bg: "degrade", font: "raleway" },
  { key: "blanco-limpio", label: "Blanco limpio", colors: { primary: "#4f46e5", secondary: "#06b6d4", accent: "#6366f1", buttonText: "#ffffff" }, mode: "light", bg: "degrade", font: "montserrat" },
  { key: "pastel", label: "Pastel", colors: { primary: "#db2777", secondary: "#8b5cf6", accent: "#c084fc", buttonText: "#ffffff" }, mode: "light", bg: "aurora", font: "pacifico" },
];
