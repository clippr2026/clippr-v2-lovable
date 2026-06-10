import * as React from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

export type DateRange = { from: string; to: string };

const DAY_MS = 86_400_000;
function toISO(d: Date) { return d.toISOString().slice(0, 10); }
function fromISO(s: string) { return new Date(s + "T12:00:00"); }
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }

export function getPreset(key: string): DateRange {
  const today = startOfDay(new Date());
  const iso = toISO(today);
  switch (key) {
    case "hoy":     return { from: iso, to: iso };
    case "ayer": {  const y = toISO(new Date(today.getTime() - DAY_MS)); return { from: y, to: y }; }
    case "semana": {
      const dow = (today.getDay() + 6) % 7;
      return { from: toISO(new Date(today.getTime() - dow * DAY_MS)), to: iso };
    }
    case "mes": { return { from: toISO(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso }; }
    case "mes_anterior": {
      return {
        from: toISO(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to:   toISO(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    }
    default: return { from: iso, to: iso };
  }
}

const PRESETS = [
  { key: "hoy",          label: "Hoy"         },
  { key: "ayer",         label: "Ayer"         },
  { key: "semana",       label: "Esta semana"  },
  { key: "mes",          label: "Este mes"     },
  { key: "mes_anterior", label: "Mes anterior" },
];

// ─── Mini calendar ───────────────────────────────────────────────────────────
function MiniCalendar({ month, year, from, to, hoverDate, onSelectDay, onHoverDay }: {
  month: number; year: number;
  from: string | null; to: string | null; hoverDate: string | null;
  onSelectDay: (d: string) => void;
  onHoverDay: (d: string | null) => void;
}) {
  const today = toISO(startOfDay(new Date()));
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toISO(new Date(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);

  function inRange(d: string) {
    if (!from) return false;
    const end = to ?? hoverDate ?? from;
    const [f, t] = from <= end ? [from, end] : [end, from];
    return d > f && d < t;
  }
  function isEdge(d: string) {
    const end = to ?? hoverDate ?? from;
    if (!from || !end) return false;
    return d === from || d === end;
  }
  function isFrom(d: string) { return d === from; }
  function isTo(d: string) {
    const end = to ?? hoverDate ?? from;
    return end ? d === end : false;
  }

  return (
    <div>
      <div className="grid grid-cols-7 gap-px mb-1.5">
        {["Lu","Ma","Mi","Ju","Vi","Sá","Do"].map(l => (
          <div key={l} className="text-center text-[10px] uppercase tracking-wider py-1" style={{ color: "rgba(255,255,255,0.3)" }}>{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="h-8" />;
          const edge = isEdge(d);
          const inR  = inRange(d);
          const isT  = d === today;
          const fromEdge = isFrom(d);
          const toEdge   = isTo(d);
          return (
            <button
              key={d}
              type="button"
              onMouseEnter={() => onHoverDay(d)}
              onMouseLeave={() => onHoverDay(null)}
              onClick={() => onSelectDay(d)}
              className={cn(
                "h-8 w-full text-xs font-medium transition-all relative",
                edge ? "rounded-lg z-10" : inR ? "rounded-none" : "rounded-lg",
              )}
              style={{
                background: edge
                  ? "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))"
                  : inR
                    ? "oklch(0.65 0.24 255 / 0.18)"
                    : undefined,
                color: edge
                  ? "#fff"
                  : inR
                    ? "rgba(255,255,255,0.9)"
                    : isT
                      ? "oklch(0.72 0.24 255)"
                      : "rgba(255,255,255,0.8)",
                boxShadow: isT && !edge ? "inset 0 0 0 1px oklch(0.65 0.24 255 / 0.5)" : undefined,
                borderRadius: fromEdge && !toEdge ? "8px 0 0 8px"
                  : toEdge && !fromEdge ? "0 8px 8px 0"
                  : edge ? "8px" : inR ? "0" : "8px",
              }}
            >
              {new Date(d + "T12:00:00").getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────
export function DateRangePicker({ from, to, onChange, className }: {
  from: string; to: string;
  onChange: (range: DateRange) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<"from" | "to">("from");
  const [tempFrom, setTempFrom] = React.useState<string | null>(null);
  const [hoverDate, setHoverDate] = React.useState<string | null>(null);
  const [viewMonth, setViewMonth] = React.useState(() => {
    const d = fromISO(from);
    return { month: d.getMonth(), year: d.getFullYear() };
  });
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setStep("from"); setTempFrom(null);
      }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open]);

  function handleSelectDay(d: string) {
    if (step === "from") {
      setTempFrom(d);
      setStep("to");
    } else {
      const f = tempFrom!;
      const [a, b] = f <= d ? [f, d] : [d, f];
      onChange({ from: a, to: b });
      setStep("from"); setTempFrom(null); setOpen(false);
    }
  }

  function applyPreset(key: string) {
    onChange(getPreset(key));
    setOpen(false); setStep("from"); setTempFrom(null);
  }

  function prevMonth() {
    setViewMonth(({ month, year }) => month === 0 ? { month: 11, year: year - 1 } : { month: month - 1, year });
  }
  function nextMonth() {
    setViewMonth(({ month, year }) => month === 11 ? { month: 0, year: year + 1 } : { month: month + 1, year });
  }

  const displayFrom = fromISO(from).toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
  const displayTo   = fromISO(to).toLocaleDateString("es-AR",   { day: "2-digit", month: "short", year: "numeric" });
  const monthLabel  = new Date(viewMonth.year, viewMonth.month, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });

  // During second-click selection: show tempFrom as from, null as to (range preview via hover)
  const calFrom = step === "to" ? tempFrom : from;
  const calTo   = step === "to" ? null : to;

  return (
    <div ref={ref} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setStep("from"); }}
        className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition"
        style={{
          background: "oklch(0.15 0.04 275)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
          color: "rgba(255,255,255,0.85)",
        }}
      >
        <CalendarDays className="h-3.5 w-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
        <span>{displayFrom} → {displayTo}</span>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-2 z-50 w-[288px] rounded-2xl shadow-2xl overflow-hidden"
          style={{
            background: "oklch(0.10 0.04 275)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 24px 48px -12px rgba(0,0,0,0.7)",
          }}
        >
          {/* Presets */}
          <div className="p-3 flex flex-wrap gap-1.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {PRESETS.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                className="rounded-lg px-2.5 py-1 text-xs font-medium transition"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: "rgba(255,255,255,0.55)",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
                }}
                onMouseEnter={e => { (e.target as HTMLElement).style.background = "rgba(255,255,255,0.10)"; (e.target as HTMLElement).style.color = "rgba(255,255,255,0.9)"; }}
                onMouseLeave={e => { (e.target as HTMLElement).style.background = "rgba(255,255,255,0.05)"; (e.target as HTMLElement).style.color = "rgba(255,255,255,0.55)"; }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendar */}
          <div className="p-3">
            {/* Month nav */}
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                onClick={prevMonth}
                className="h-7 w-7 rounded-lg flex items-center justify-center transition"
                style={{ color: "rgba(255,255,255,0.4)" }}
                onMouseEnter={e => { (e.target as HTMLElement).style.background = "rgba(255,255,255,0.07)"; (e.target as HTMLElement).style.color = "white"; }}
                onMouseLeave={e => { (e.target as HTMLElement).style.background = ""; (e.target as HTMLElement).style.color = "rgba(255,255,255,0.4)"; }}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs font-semibold capitalize" style={{ color: "rgba(255,255,255,0.9)" }}>{monthLabel}</span>
              <button
                type="button"
                onClick={nextMonth}
                className="h-7 w-7 rounded-lg flex items-center justify-center transition"
                style={{ color: "rgba(255,255,255,0.4)" }}
                onMouseEnter={e => { (e.target as HTMLElement).style.background = "rgba(255,255,255,0.07)"; (e.target as HTMLElement).style.color = "white"; }}
                onMouseLeave={e => { (e.target as HTMLElement).style.background = ""; (e.target as HTMLElement).style.color = "rgba(255,255,255,0.4)"; }}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <MiniCalendar
              month={viewMonth.month}
              year={viewMonth.year}
              from={calFrom ?? null}
              to={calTo ?? null}
              hoverDate={hoverDate}
              onSelectDay={handleSelectDay}
              onHoverDay={setHoverDate}
            />
          </div>

          {/* Hint */}
          <div className="px-3 pb-3 text-center" style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
            {step === "to" ? "Seleccioná la fecha final" : "Seleccioná la fecha inicial"}
          </div>
        </div>
      )}
    </div>
  );
}
