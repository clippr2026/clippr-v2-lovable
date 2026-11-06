// Tipografías para títulos y nombres de la página pública. La clave se guarda
// en business_settings.schedule._branding.font.
export type PublicFont = { key: string; label: string; family: string; google: string };

export const PUBLIC_FONTS: PublicFont[] = [
  { key: "poppins", label: "Moderna", family: "'Poppins', sans-serif", google: "Poppins:wght@600;700" },
  { key: "montserrat", label: "Limpia", family: "'Montserrat', sans-serif", google: "Montserrat:wght@600;700" },
  { key: "playfair", label: "Elegante", family: "'Playfair Display', serif", google: "Playfair+Display:wght@600;700" },
  { key: "oswald", label: "Deportiva", family: "'Oswald', sans-serif", google: "Oswald:wght@500;600" },
  { key: "bebas", label: "Potente", family: "'Bebas Neue', sans-serif", google: "Bebas+Neue" },
  { key: "raleway", label: "Fina", family: "'Raleway', sans-serif", google: "Raleway:wght@600;700" },
  { key: "pacifico", label: "Manuscrita", family: "'Pacifico', cursive", google: "Pacifico" },
  { key: "spacegrotesk", label: "Tecnológica", family: "'Space Grotesk', sans-serif", google: "Space+Grotesk:wght@600;700" },
];

export function getPublicFont(key: string | null | undefined): PublicFont | null {
  return PUBLIC_FONTS.find((f) => f.key === key) ?? null;
}

export function publicFontsStylesheet(fonts: PublicFont[]): string {
  return `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${f.google}`).join("&")}&display=swap`;
}
