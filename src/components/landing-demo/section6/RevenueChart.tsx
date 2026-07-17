import * as React from "react";

const POINTS = [
  { label: "Ene", value: 1.8 },
  { label: "Feb", value: 2.6 },
  { label: "Mar", value: 3.4 },
  { label: "Abr", value: 3.6 },
  { label: "May", value: 5.6 },
];

const W = 560;
const H = 220;
const PAD_X = 20;
const PAD_Y = 18;
const MAX = 7;

function xFor(i: number) {
  return PAD_X + (i / (POINTS.length - 1)) * (W - PAD_X * 2);
}
function yFor(v: number) {
  return H - PAD_Y - (v / MAX) * (H - PAD_Y * 2);
}

const linePath = POINTS.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p.value)}`).join(" ");
const areaPath = `${linePath} L ${xFor(POINTS.length - 1)} ${H} L ${xFor(0)} ${H} Z`;

// Gráfico de ingresos enero-mayo. El path de la línea (.s6-chart-line) se
// "dibuja" con un stroke-dashoffset animado por Section6; los puntos
// (.s6-chart-dot) y las etiquetas (.s6-chart-label) entran después.
export const RevenueChart = React.forwardRef<HTMLDivElement>(function RevenueChart(_props, ref) {
  return (
    <div
      ref={ref}
      className="s6-card rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <div className="text-sm font-medium text-white/80">Crecimiento de ingresos</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 w-full"
        style={{ overflow: "visible" }}
      >
        <path
          d={areaPath}
          fill="url(#s6-area-gradient)"
          className="s6-chart-area"
          opacity={0}
        />
        <path
          d={linePath}
          fill="none"
          stroke="oklch(0.62 0.24 292)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="s6-chart-line"
        />
        {POINTS.map((p, i) => (
          <g key={p.label} className="s6-chart-dot" style={{ opacity: 0 }}>
            <circle cx={xFor(i)} cy={yFor(p.value)} r={5} fill="oklch(0.62 0.24 292)" />
            <text
              x={xFor(i)}
              y={yFor(p.value) - 14}
              textAnchor="middle"
              fontSize={12}
              fontWeight={600}
              fill="oklch(0.75 0.2 292)"
            >
              ${p.value}M
            </text>
          </g>
        ))}
        <defs>
          <linearGradient id="s6-area-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.55 0.24 292)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="oklch(0.55 0.24 292)" stopOpacity={0} />
          </linearGradient>
        </defs>
      </svg>
      <div className="mt-1 flex justify-between text-xs text-white/40">
        {POINTS.map((p) => (
          <span key={p.label}>{p.label}</span>
        ))}
      </div>
    </div>
  );
});
