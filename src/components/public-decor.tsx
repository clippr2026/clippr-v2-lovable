import * as React from "react";

// Dibujos del encabezado de la página pública: van pegados al borde inferior (donde el
// encabezado con portada y logo se separa del resto) y algunos también arriba.
export type PublicDecorKey = "none" | "pintura-gris" | "navidad" | "estrellas" | "ondas" | "barberia";

export const PUBLIC_DECORS: { key: PublicDecorKey; label: string }[] = [
  { key: "none", label: "Sin dibujos" },
  { key: "pintura-gris", label: "Pintura" },
  { key: "navidad", label: "Navidad" },
  { key: "estrellas", label: "Estrellas" },
  { key: "ondas", label: "Ondas" },
  { key: "barberia", label: "Barbería" },
];

export function normalizePublicDecor(value: unknown): PublicDecorKey {
  // Las pinturas oscura y rosa se unificaron en "Pintura".
  if (value === "pintura-oscura" || value === "pintura-rosa") return "pintura-gris";
  return PUBLIC_DECORS.some((d) => d.key === value) ? (value as PublicDecorKey) : "none";
}

const SNOW: [number, number, number][] = [
  [40, 10, 3], [130, 40, 2], [220, 18, 3], [310, 52, 2], [420, 14, 3], [520, 44, 2], [610, 20, 3], [720, 56, 2],
  [830, 12, 3], [930, 38, 2], [1030, 22, 3], [1120, 50, 2], [180, 70, 2], [680, 80, 3], [980, 86, 2],
];
const STARS: [number, number, number][] = [
  [70, 30, 9], [190, 90, 6], [300, 22, 7], [430, 70, 10], [560, 28, 6], [690, 84, 8], [820, 24, 9], [950, 76, 6], [1070, 34, 8], [1150, 88, 6],
];

function star(cx: number, cy: number, r: number) {
  const k = r * 0.28;
  return `M${cx} ${cy - r} L${cx + k} ${cy - k} L${cx + r} ${cy} L${cx + k} ${cy + k} L${cx} ${cy + r} L${cx - k} ${cy + k} L${cx - r} ${cy} L${cx - k} ${cy - k} Z`;
}

export function PublicDecor({
  decor,
  primary,
  secondary,
  accent,
  light,
}: {
  decor: PublicDecorKey;
  primary: string;
  secondary: string;
  accent: string;
  light: boolean;
}) {
  if (decor === "none") return null;
  const base = light ? "#ffffff" : "#08070c";
  const layer = "pointer-events-none absolute inset-x-0 w-full";
  const css = `
    @keyframes dcTwinkle { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
    @keyframes dcFall { from { transform: translateY(-10px); } to { transform: translateY(14px); } }
    @media (prefers-reduced-motion: reduce) { .dc-anim { animation: none !important; } }
  `;

  if (decor.startsWith("pintura-")) {
    // Solo salpicaduras encima del encabezado: no cambian el fondo.
    return <SplatterArt primary={primary} secondary={secondary} light={light} />;
  }

  if (decor === "navidad") {
    const bulbs = ["#ef4444", "#facc15", "#22c55e", "#38bdf8", "#f472b6"];
    return (
      <>
        <style>{css}</style>
        {/* Guirnalda de luces arriba */}
        <svg className="pointer-events-none absolute inset-x-0 top-0 z-[6] h-10 w-full sm:h-14" viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden>
          <path d="M0 6 C150 40 300 40 450 8 C600 40 750 40 900 8 C1050 40 1150 36 1200 10" fill="none" stroke="#1f2937" strokeWidth="2.2" />
          {[40, 130, 230, 330, 430, 540, 650, 760, 870, 980, 1090].map((x, i) => {
            const y = 8 + 26 * Math.abs(Math.sin(((x % 450) / 450) * Math.PI));
            return (
              <circle
                key={x}
                className="dc-anim"
                cx={x}
                cy={y + 6}
                r="9"
                fill={bulbs[i % bulbs.length]}
                style={{ animation: `dcTwinkle ${1.2 + (i % 4) * 0.35}s ease-in-out infinite`, filter: `drop-shadow(0 0 6px ${bulbs[i % bulbs.length]})` }}
              />
            );
          })}
        </svg>
        {/* Pinos y nieve abajo */}
        {(["left-2", "right-2"] as const).map((side, i) => (
          <svg key={side} className={`pointer-events-none absolute bottom-2 ${side} h-14 w-10 sm:h-24 sm:w-16`} viewBox="0 0 52 80" aria-hidden>
            <path d={`M26 ${i ? 14 : 6} L4 ${i ? 70 : 72} L48 ${i ? 70 : 72} Z`} fill="#15803d" />
            <path d={`M26 ${i ? 2 : -4} L10 ${i ? 38 : 40} L42 ${i ? 38 : 40} Z`} fill="#16a34a" />
            <path d={star(26, i ? 6 : 2, 6)} fill="#facc15" />
            <rect x="22" y="70" width="8" height="8" fill="#78350f" />
          </svg>
        ))}
        <svg className={`${layer} bottom-0 h-20 sm:h-28`} viewBox="0 0 1200 120" preserveAspectRatio="xMidYMax slice" aria-hidden>
          <path
            d="M0 120 L0 100 C60 88 110 106 190 98 C280 88 330 108 430 100 C540 90 600 108 700 100 C800 92 880 110 980 100 C1070 90 1130 106 1200 96 L1200 120 Z"
            fill="#ffffff"
          />
          {SNOW.map(([x, y, r], i) => (
            <circle
              key={i}
              className="dc-anim"
              cx={x}
              cy={y + 10}
              r={r}
              fill="#ffffff"
              opacity=".9"
              style={{ animation: `dcFall ${2.4 + (i % 5) * 0.5}s ease-in-out ${i * 0.2}s infinite alternate` }}
            />
          ))}
        </svg>
      </>
    );
  }

  if (decor === "estrellas") {
    return (
      <>
        <style>{css}</style>
        <svg className={`${layer} bottom-0 h-16 sm:h-24`} viewBox="0 0 1200 100" preserveAspectRatio="xMidYMax slice" aria-hidden>
          {STARS.map(([x, y, r], i) => (
            <path
              key={i}
              className="dc-anim"
              d={star(x, y, r)}
              fill={[primary, secondary, accent][i % 3]}
              style={{ animation: `dcTwinkle ${1.4 + (i % 4) * 0.4}s ease-in-out ${i * 0.15}s infinite`, filter: `drop-shadow(0 0 5px ${[primary, secondary, accent][i % 3]})` }}
            />
          ))}
        </svg>
        <svg className={`${layer} top-0 h-10 sm:h-14`} viewBox="0 0 1200 60" preserveAspectRatio="xMidYMin slice" aria-hidden>
          {STARS.slice(0, 6).map(([x, , r], i) => (
            <path
              key={i}
              className="dc-anim"
              d={star(x + 40, 18 + (i % 3) * 10, r * 0.7)}
              fill={[accent, primary, secondary][i % 3]}
              style={{ animation: `dcTwinkle ${1.6 + (i % 3) * 0.5}s ease-in-out ${i * 0.2}s infinite` }}
            />
          ))}
        </svg>
      </>
    );
  }

  if (decor === "ondas") {
    return (
      <svg className={`${layer} bottom-0 h-14 sm:h-24`} viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden>
        <path d="M0 120 L0 60 C150 20 300 100 450 60 C600 20 750 100 900 60 C1050 20 1150 80 1200 50 L1200 120 Z" fill={primary} opacity=".55" />
        <path d="M0 120 L0 80 C150 50 300 110 450 80 C600 50 750 110 900 80 C1050 50 1150 100 1200 76 L1200 120 Z" fill={secondary} opacity=".6" />
        <path d="M0 120 L0 100 C150 84 300 116 450 100 C600 84 750 116 900 100 C1050 84 1150 112 1200 98 L1200 120 Z" fill={base} />
      </svg>
    );
  }

  // barbería: cinta de poste de barbero + tijera en la esquina
  return (
    <>
      <svg className={`${layer} bottom-0 h-3 sm:h-4`} viewBox="0 0 1200 16" preserveAspectRatio="none" aria-hidden>
        <defs>
          <pattern id="dc-pole" width="40" height="16" patternUnits="userSpaceOnUse" patternTransform="skewX(-35)">
            <rect width="40" height="16" fill="#ffffff" />
            <rect width="13" height="16" fill="#ef4444" />
            <rect x="26" width="13" height="16" fill="#2563eb" />
          </pattern>
        </defs>
        <rect width="1200" height="16" fill="url(#dc-pole)" />
      </svg>
      <svg className="pointer-events-none absolute right-3 top-2 h-8 w-8 opacity-80 sm:h-12 sm:w-12" viewBox="0 0 48 48" fill="none" stroke={accent} strokeWidth="2.4" strokeLinecap="round" aria-hidden>
        <circle cx="14" cy="36" r="6" />
        <circle cx="34" cy="36" r="6" />
        <path d="M17 31 L36 8 M31 31 L12 8" />
      </svg>
    </>
  );
}

// ── Pintura salpicada dibujada ──────────────────────────────────────────────
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Los colores de la pintura salen de los que elige el negocio (Color 1, Color 2 y resaltado).
function splatterConfig(primary: string, secondary: string, light: boolean) {
  const ink = light ? "#111111" : "#ffffff";
  return { colors: [ink, ink, ink, primary, secondary], strokeColor: secondary };
}

function SplatterArt({ primary, secondary, light }: { primary: string; secondary: string; light: boolean }) {
  const cfg = React.useMemo(() => splatterConfig(primary, secondary, light), [primary, secondary, light]);
  const art = React.useMemo(() => {
    const r = rng(37);
    const W = 400;
    const H = 520;
    const pick = () => cfg.colors[Math.floor(r() * cfg.colors.length)];
    const dots = Array.from({ length: 760 }, () => ({ x: r() * W, y: r() * H, rad: Math.pow(r(), 3.5) * 4.2 + 0.5, c: pick() }));
    const blobs = Array.from({ length: 42 }, () => {
      const x = r() * W;
      const y = r() * H;
      const rad = 3 + r() * 8;
      const ang = (Math.PI / 2) * (0.6 + r() * 0.8) + (r() < 0.3 ? Math.PI : 0);
      const len = 14 + r() * 46;
      const c = pick();
      const spray = Array.from({ length: 14 }, () => {
        const a = r() * Math.PI * 2;
        const d = rad * (1.4 + r() * 5);
        return { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, rad: 0.4 + r() * rad * 0.28 };
      });
      return { x, y, rad, c, x2: x + Math.cos(ang) * len, y2: y + Math.sin(ang) * len, spray };
    });
    const arcs = Array.from({ length: 22 }, () => {
      const x = r() * W;
      const y = r() * H;
      return { d: `M${x} ${y} Q${x + (r() - 0.3) * 160} ${y + (r() - 0.5) * 120} ${x + (r() - 0.2) * 260} ${y + (r() - 0.5) * 200}`, w: 0.5 + r() * 1.6, c: pick() };
    });
    const strokes = Array.from({ length: 10 }, () => ({ x: r() * W, y: r() * H, w: 70 + r() * 140, h: 18 + r() * 34, a: -40 + r() * 80, o: 0.18 + r() * 0.3, white: r() < 0.5 }));
    return { dots, blobs, arcs, strokes };
  }, [cfg]);

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 400 520"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      // Más suave (no vacío) alrededor del nombre, las estrellas y los años de experiencia.
      style={{
        WebkitMaskImage: "radial-gradient(ellipse 68% 15% at 38% 85%, rgba(0,0,0,.42) 0%, rgba(0,0,0,.42) 62%, #000 100%)",
        maskImage: "radial-gradient(ellipse 68% 15% at 38% 85%, rgba(0,0,0,.42) 0%, rgba(0,0,0,.42) 62%, #000 100%)",
      }}
    >
      {art.strokes.map((s, i) => (
        <rect key={i} x={s.x - s.w / 2} y={s.y - s.h / 2} width={s.w} height={s.h} rx={s.h / 2} fill={s.white ? "#ffffff" : cfg.strokeColor} opacity={s.o} transform={`rotate(${s.a} ${s.x} ${s.y})`} />
      ))}
      {art.arcs.map((a, i) => (
        <path key={i} d={a.d} fill="none" stroke={a.c} strokeWidth={a.w} strokeLinecap="round" opacity=".9" />
      ))}
      {art.blobs.map((b, i) => (
        <g key={i}>
          <line x1={b.x} y1={b.y} x2={b.x2} y2={b.y2} stroke={b.c} strokeWidth={b.rad * 0.2} strokeLinecap="round" />
          <circle cx={b.x2} cy={b.y2} r={b.rad * 0.32} fill={b.c} />
          <circle cx={b.x} cy={b.y} r={b.rad} fill={b.c} />
          {b.spray.map((sp, j) => (
            <circle key={j} cx={sp.x} cy={sp.y} r={sp.rad} fill={b.c} />
          ))}
        </g>
      ))}
      {art.dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.rad} fill={d.c} />
      ))}
    </svg>
  );
}
