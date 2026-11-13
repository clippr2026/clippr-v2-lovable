import type * as React from "react";

// ── Contraste ────────────────────────────────────────────────────────────────
// El texto elegido por el negocio se respeta mientras se lea mínimamente (un violeta medio con letra
// blanca, por ejemplo, queda blanco). Solo se reemplaza cuando es ilegible: blanco sobre amarillo o
// pastel, o letra oscura sobre un color oscuro.
const MIN_TEXT_CONTRAST = 2;
// Las páginas públicas usan el color de acento que elige cada negocio, así que cualquier color
// puede llegar acá. Estas funciones garantizan que el texto siempre se pueda leer sobre él.
function parseHex(c: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((c ?? "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number | null {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return null;
  const la = luminance(pa);
  const lb = luminance(pb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Blanco o casi negro, el que mejor se lee sobre `bg`.
export function contrastText(bg: string): string {
  const white = contrastRatio("#ffffff", bg);
  const dark = contrastRatio("#0b0818", bg);
  if (white == null || dark == null) return "#ffffff";
  return white >= dark ? "#ffffff" : "#0b0818";
}

function mixHex(c: [number, number, number], to: [number, number, number], t: number): string {
  const v = c.map((x, i) => Math.round(x + (to[i] - x) * t));
  return `#${v.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

// Color de acento apto para usarlo COMO TEXTO sobre el fondo de la página (blanco en tema claro,
// casi negro en tema oscuro): si el acento no alcanza contraste 4.5, se lo acerca al negro (claro)
// o al blanco (oscuro) lo mínimo necesario. Un acento que ya se lee queda tal cual.
export function legibleAccent(accent: string, light: boolean): string {
  const rgb = parseHex(accent);
  if (!rgb) return accent;
  const bg = light ? "#ffffff" : "#0b0818";
  const target: [number, number, number] = light ? [0, 0, 0] : [255, 255, 255];
  let t = 0;
  let out = mixHex(rgb, target, t);
  while ((contrastRatio(out, bg) ?? 21) < 4.5 && t < 1) {
    t = Math.min(1, t + 0.05);
    out = mixHex(rgb, target, t);
  }
  return out;
}

// Botón principal de las páginas públicas (reservas, perfil, reseñas): el color de acento elegido
// por el negocio, un poco más profundo y con degradé, borde de luz y un resplandor del mismo color.
// El texto es el que eligió el negocio, salvo que sobre ese color no se lea: ahí se usa blanco o
// casi negro, el que mejor contraste dé (nunca letras oscuras sobre un fondo oscuro).
export function publicButtonStyle(accent: string, text: string): React.CSSProperties {
  const ratio = contrastRatio(text, accent);
  const fg = ratio != null && ratio < MIN_TEXT_CONTRAST ? contrastText(accent) : text;
  // Un acento casi negro (o casi blanco) se perdería contra el fondo de la página: se le agrega un
  // borde claro (u oscuro) bien visible para que el botón siempre se vea como botón.
  const vsDark = contrastRatio(accent, "#0b0818");
  const vsLight = contrastRatio(accent, "#ffffff");
  const muyOscuro = vsDark != null && vsDark < 2.2;
  const muyClaro = vsLight != null && vsLight < 1.6;
  return {
    background: `linear-gradient(180deg, color-mix(in oklch, ${accent} 94%, white) 0%, color-mix(in oklch, ${accent} 90%, black) 100%)`,
    border: muyOscuro
      ? "1.5px solid rgba(255,255,255,0.5)"
      : muyClaro
        ? "1.5px solid rgba(0,0,0,0.35)"
        : `1px solid color-mix(in oklch, ${accent} 55%, white)`,
    color: fg,
    WebkitTextFillColor: fg,
    boxShadow: muyOscuro
      ? "0 0 22px -4px rgba(255,255,255,0.35), inset 0 1px 0 rgba(255,255,255,0.25)"
      : `0 0 26px -4px color-mix(in oklch, ${accent} 85%, transparent), inset 0 1px 0 rgba(255,255,255,0.3)`,
  };
}

// Relleno liso con el color de acento (chips y opciones elegidas): mismo criterio de contraste que
// el botón principal, y la letra va con WebkitTextFillColor para que el tema claro no la pise.
export function accentFill(accent: string, text: string): React.CSSProperties {
  const ratio = contrastRatio(text, accent);
  const fg = ratio != null && ratio < MIN_TEXT_CONTRAST ? contrastText(accent) : text;
  const vsDark = contrastRatio(accent, "#0b0818");
  const borde = vsDark != null && vsDark < 2.2 ? { boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.5)" } : {};
  return { background: accent, color: fg, WebkitTextFillColor: fg, ...borde };
}
