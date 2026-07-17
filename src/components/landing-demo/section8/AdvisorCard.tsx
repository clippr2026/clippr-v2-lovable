import * as React from "react";
import { Sparkles, CalendarPlus, Clock, DollarSign, Users, ArrowRight } from "lucide-react";

// Las 4 recomendaciones del Asesor IA — mismo diseño, tamaño y jerarquía
// para las cuatro. Cada una lleva una llamada a la acción chica, integrada
// como texto a la derecha (no un botón grande) para que la sección quede
// compacta.
const RECOMMENDATIONS = [
  {
    icon: CalendarPlus,
    color: "oklch(0.65 0.19 155)",
    title: "Sumá un profesional los sábados",
    lines: ["La demanda supera tu capacidad.", "Podrías aumentar tus ingresos un 20%."],
    cta: "Ver análisis",
  },
  {
    icon: Clock,
    color: "oklch(0.62 0.19 250)",
    title: "Extendé el horario los viernes",
    lines: ["Entre las 16:00 y las 20:00 hs estás perdiendo reservas."],
    cta: "Ver horarios",
  },
  {
    icon: DollarSign,
    color: "oklch(0.55 0.24 292)",
    title: "Ajustá el precio de 2 servicios",
    lines: ["La demanda actual permite mejorar tu margen.", "Podrías aumentar tu rentabilidad."],
    cta: "Ver recomendación",
  },
  {
    icon: Users,
    color: "oklch(0.68 0.2 25)",
    title: "31 clientes no vienen hace más de 50 días",
    lines: [
      "Es un buen momento para volver a contactarlos.",
      "Podrías recuperar reservas sin invertir en publicidad.",
    ],
    cta: "Contactar clientes",
  },
];

// Tarjeta del Asesor IA: score de salud (.s8-score, animado hasta 82) y
// las 4 recomendaciones (.s8-reco), todas con el mismo diseño, que entran
// en secuencia. Cada .s8-cta es texto, no botón — Section8 le agrega un
// microdetalle de vida (nudge de flecha + pulso de borde) cada varios
// segundos, después de que todo se asienta.
export const AdvisorCard = React.forwardRef<HTMLDivElement>(function AdvisorCard(_props, ref) {
  return (
    <div ref={ref} className="flex w-full flex-col gap-2 lg:gap-3">
      <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-4 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:p-6 lg:p-7">
        <div className="flex items-center gap-2">
          <span
            className="grid h-6 w-6 place-items-center rounded-full text-white lg:h-7 lg:w-7"
            style={{ background: "oklch(0.65 0.19 155)" }}
          >
            <Sparkles className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
          </span>
          <span className="text-xs font-semibold text-white lg:text-sm">Asesor IA</span>
        </div>
        <div className="mt-1.5 text-xs font-medium lg:mt-2 lg:text-sm" style={{ color: "oklch(0.65 0.19 155)" }}>
          Salud de tu negocio
        </div>
        <div className="mt-1 flex items-baseline gap-1 font-display text-4xl font-bold lg:text-6xl">
          <span className="s8-score" data-target="82" style={{ color: "oklch(0.62 0.24 292)" }}>
            0
          </span>
          <span className="text-xl font-semibold text-white/40 lg:text-2xl">/100</span>
        </div>
        <div className="mt-1 text-xs text-white/60 lg:text-sm">Vas por buen camino 🚀</div>
      </div>

      <div className="mt-1 text-xs font-medium text-white/80 lg:mt-2 lg:text-sm">
        Recomendaciones para vos
      </div>
      <div className="flex flex-col gap-2 lg:gap-3">
        {RECOMMENDATIONS.map((r) => (
          <div
            key={r.title}
            className="s8-reco rounded-2xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur-xl sm:p-5 lg:rounded-[1.75rem]"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex flex-1 items-start gap-2.5 sm:items-center sm:gap-3">
                <span
                  className="s8-reco-icon mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full sm:mt-0 sm:h-8 sm:w-8"
                  style={{
                    background: `color-mix(in oklch, ${r.color} 22%, transparent)`,
                    color: r.color,
                  }}
                >
                  <r.icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-white sm:text-sm">{r.title}</div>
                  {r.lines.map((line) => (
                    <div key={line} className="mt-0.5 text-[11px] text-white/50 sm:text-xs">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
              {/* Llamada a la acción: botón píldora chico, mismo degradado
                  violeta que el CTA principal de la landing, discreto.
                  En desktop va en la misma fila, centrado verticalmente
                  con el bloque de texto; en mobile baja debajo, alineado
                  a la derecha (comportamiento responsive existente). */}
              <span
                className="s8-cta inline-flex shrink-0 items-center justify-center gap-1.5 self-end rounded-full px-3 py-1 text-[11px] font-semibold text-white sm:self-center sm:px-3.5 sm:py-1.5 sm:text-xs"
                style={{ background: "linear-gradient(135deg, oklch(0.62 0.24 292), oklch(0.46 0.24 296))" }}
              >
                {r.cta}
                <ArrowRight className="s8-cta-arrow h-3 w-3 sm:h-3.5 sm:w-3.5" />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
