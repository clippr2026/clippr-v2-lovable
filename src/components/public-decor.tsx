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

// Papá Noel (busto) para el dibujo de Navidad.
function Santa({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 134" aria-hidden>
      <path d="M12 134 C12 100 34 86 60 86 C86 86 108 100 108 134 Z" fill="#dc2626" />
      <rect x="52" y="86" width="16" height="48" fill="#ffffff" />
      <rect x="28" y="110" width="64" height="9" rx="2" fill="#111827" />
      <rect x="51" y="107" width="18" height="15" rx="3" fill="#facc15" />
      <path d="M24 58 C20 94 42 108 60 108 C78 108 100 94 96 58 C86 66 74 68 60 68 C46 68 34 66 24 58 Z" fill="#ffffff" />
      <ellipse cx="60" cy="54" rx="25" ry="22" fill="#fcd5b5" />
      <circle cx="42" cy="58" r="4.5" fill="#f87171" opacity=".45" />
      <circle cx="78" cy="58" r="4.5" fill="#f87171" opacity=".45" />
      <circle cx="50" cy="52" r="2.8" fill="#1f2937" />
      <circle cx="70" cy="52" r="2.8" fill="#1f2937" />
      <path d="M36 64 C44 56 54 62 60 66 C66 62 76 56 84 64 C82 76 68 76 60 70 C52 76 38 76 36 64 Z" fill="#ffffff" />
      <circle cx="60" cy="59" r="5.5" fill="#f9a8a8" />
      <path d="M32 40 C32 12 58 0 90 8 C100 12 102 26 94 40 Z" fill="#dc2626" />
      <rect x="27" y="35" width="68" height="13" rx="6.5" fill="#ffffff" />
      <circle cx="98" cy="9" r="8.5" fill="#ffffff" />
    </svg>
  );
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
    @keyframes dcSnow { 0% { transform: translateY(-20px); opacity: 0; } 15% { opacity: .95; } 100% { transform: translateY(300px); opacity: 0; } }
    @keyframes dcBob { 0%,100% { transform: rotate(-3deg) translateY(0); } 50% { transform: rotate(3deg) translateY(-4px); } }
    @keyframes dcShoot { 0% { transform: translate(0,0); opacity: 0; } 8% { opacity: 1; } 40% { transform: translate(-520px,260px); opacity: 0; } 100% { transform: translate(-520px,260px); opacity: 0; } }
    @keyframes dcPulse { 0%,100% { transform: scale(.85); opacity: .55; } 50% { transform: scale(1.15); opacity: 1; } }
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
        {/* Nieve cayendo por todo el encabezado */}
        <svg className="pointer-events-none absolute inset-0 z-[5] h-full w-full" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMin slice" aria-hidden>
          {Array.from({ length: 30 }).map((_, i) => (
            <circle
              key={i}
              className="dc-anim"
              cx={(i * 197) % 1200}
              cy={0}
              r={2 + (i % 4)}
              fill="#ffffff"
              style={{ animation: `dcSnow ${5 + (i % 6)}s linear ${(i % 9) * 0.7}s infinite` }}
            />
          ))}
        </svg>
        {/* Pino con adornos (izquierda) y Papá Noel (derecha) */}
        <svg className="pointer-events-none absolute -left-1 bottom-2 z-[6] h-14 w-9 sm:-left-2 sm:h-24 sm:w-14" viewBox="0 0 52 80" aria-hidden>
          <path d="M26 8 L4 70 L48 70 Z" fill="#15803d" />
          <path d="M26 -2 L10 38 L42 38 Z" fill="#16a34a" />
          <path d={star(26, 3, 6)} fill="#facc15" />
          <circle cx="20" cy="30" r="2.6" fill="#ef4444" />
          <circle cx="32" cy="46" r="2.6" fill="#38bdf8" />
          <circle cx="16" cy="58" r="2.6" fill="#facc15" />
          <circle cx="36" cy="62" r="2.6" fill="#ef4444" />
          <rect x="22" y="70" width="8" height="8" fill="#78350f" />
        </svg>
        <div className="dc-anim pointer-events-none absolute bottom-[4.75rem] right-3 z-[6] origin-bottom sm:bottom-24 sm:right-6" style={{ animation: "dcBob 3.2s ease-in-out infinite" }}><Santa className="h-20 w-[4.5rem] sm:h-32 sm:w-28" /></div>
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
    const colores = ["#ffffff", accent, primary, secondary];
    // [x, y, radio] en un lienzo de 1200 x 300 que cubre todo el encabezado.
    const grandes: [number, number, number][] = [
      [60, 50, 20], [170, 210, 14], [260, 90, 18], [380, 250, 12], [470, 40, 16], [600, 270, 20], [700, 70, 14],
      [820, 230, 18], [930, 60, 22], [1040, 200, 15], [1130, 90, 19], [1160, 250, 13], [540, 150, 11], [310, 160, 10],
    ];
    // Fijas (sin movimiento) y por DETRÁS del contenido: nunca tapan textos ni botones.
    return (
      <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice" aria-hidden>
        {Array.from({ length: 36 }).map((_, i) => (
          <circle key={`p${i}`} cx={(i * 131 + 40) % 1200} cy={(i * 73 + 20) % 300} r={1.6 + (i % 3) * 0.8} fill="#ffffff" opacity={0.55 + (i % 4) * 0.1} />
        ))}
        {grandes.map(([x, y, r], i) => {
          const c = colores[i % colores.length];
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={r * 2.1} fill={c} opacity=".14" />
              <path d={star(x, y, r)} fill={c} style={{ filter: `drop-shadow(0 0 6px ${c})` }} />
              <path d={star(x, y, r * 0.42)} fill="#ffffff" />
            </g>
          );
        })}
      </svg>
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
  // La pintura cubre todo el encabezado (la legibilidad la dan las sombras de cada texto); solo se disuelve el último borde.
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
  const fade = "linear-gradient(to bottom, #000 0%, #000 94%, transparent 100%)";

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 400 520"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      style={{ WebkitMaskImage: fade, maskImage: fade }}
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
