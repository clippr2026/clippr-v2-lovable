import * as React from "react";
import { CalendarPlus, UserCheck, CheckCircle2 } from "lucide-react";

// Orden de la línea de tiempo (de arriba hacia abajo): nueva -> confirmada ->
// recordatorio -> cobrado. Cada paso tiene su propio color de identidad
// (glowRgb) que Section3 reutiliza tanto para el glow de la tarjeta al
// aparecer como para el punto de conexión que pulsa en la línea justo antes
// de que aparezca — mismo color, un solo lugar donde se define.
const NOTIFICATIONS = [
  { icon: CalendarPlus, iconBg: "oklch(0.55 0.24 292)", glowRgb: "147,51,234", title: "Nueva reserva" },
  { icon: UserCheck, iconBg: "oklch(0.62 0.19 250)", glowRgb: "59,130,246", title: "Reserva confirmada" },
  { icon: UserCheck, iconBg: "oklch(0.55 0.24 292)", glowRgb: "147,51,234", title: "Recordatorio enviado" },
  { icon: CheckCircle2, iconBg: "oklch(0.62 0.17 155)", glowRgb: "34,197,94", title: "Turno cobrado" },
];

export const NOTIFICATION_GLOW_RGB = NOTIFICATIONS.map((n) => n.glowRgb);

export const NotificationsList = React.forwardRef<HTMLDivElement>(function NotificationsList(
  _props,
  ref,
) {
  return (
    <div ref={ref} className="flex w-full max-w-sm flex-col">
      {NOTIFICATIONS.map((n, i) => (
        <React.Fragment key={n.title}>
          <div className="s3-notification flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-[#08070d]/95 px-4 py-3 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)]">
            <span
              className="s3-icon grid h-10 w-10 shrink-0 place-items-center rounded-full text-white"
              style={{ background: n.iconBg }}
            >
              <n.icon className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-white">{n.title}</span>
          </div>
          {i < NOTIFICATIONS.length - 1 && (
            <div className="relative flex h-7 items-center justify-center">
              <span className="s3-connector block h-full w-px origin-top bg-white/15" />
              <span
                className="s3-dot pointer-events-none absolute bottom-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 translate-y-1/2 rounded-full opacity-0"
                style={{
                  background: `rgb(${NOTIFICATIONS[i + 1].glowRgb})`,
                  boxShadow: `0 0 8px 2px rgba(${NOTIFICATIONS[i + 1].glowRgb},0.7)`,
                }}
              />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
});
