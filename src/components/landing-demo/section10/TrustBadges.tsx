import * as React from "react";
import { XCircle, CalendarCheck, HeadphonesIcon } from "lucide-react";

const BADGES = [
  { icon: XCircle, label: "Sin permanencia." },
  { icon: CalendarCheck, label: "Cancelá cuando quieras." },
  { icon: HeadphonesIcon, label: "Soporte real de barberos." },
];

export const TrustBadges = React.forwardRef<HTMLDivElement>(function TrustBadges(_props, ref) {
  return (
    <div ref={ref} className="flex flex-wrap gap-x-8 gap-y-4">
      {BADGES.map((b) => (
        <div key={b.label} className="s10-badge flex items-center gap-2.5">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border"
            style={{ borderColor: "oklch(0.62 0.24 292 / 0.5)", color: "oklch(0.7 0.2 292)" }}
          >
            <b.icon className="h-4 w-4" />
          </span>
          <span className="max-w-[9rem] text-sm text-white/70">{b.label}</span>
        </div>
      ))}
    </div>
  );
});
