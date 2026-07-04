import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Copy, Timer, CalendarDays, AlarmClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import { SectionCard, reportSaveStatus, Toggle } from "@/components/settings/shared";

// ─────────── Horarios ───────────
const DAYS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

type ReservationSettings = {
  interval: string;
  maxAdvance: string;
  minCancel: string;
};

const DEFAULT_RESERVATION_SETTINGS: ReservationSettings = {
  interval: "30",
  maxAdvance: "30",
  minCancel: "2",
};

export function HorariosSection() {
  const { businessId } = useAuth();
  const [days, setDays] = useState(
    DAYS.map((d, i) => ({
      name: d,
      open: "11:00",
      close: "20:00",
      enabled: i < 6,
    })),
  );
  const [reservationSettings, setReservationSettings] =
    useState<ReservationSettings>(DEFAULT_RESERVATION_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

  const timeToMinutes = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 60 + minutes;
  };

  const normalizeCloseTime = (open: string, close: string) => {
    const openMin = timeToMinutes(open);
    const closeMin = timeToMinutes(close);
    if (openMin == null || closeMin == null || closeMin <= openMin)
      return "20:00";
    return close;
  };

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const schedule = data?.schedule as
          Record<string, any> | null | undefined;
        if (schedule && typeof schedule === "object") {
          setDays((current) =>
            current.map((day, i) => {
              const saved = schedule[dayKeys[i]];
              if (!saved || typeof saved !== "object") return day;
              const open =
                typeof saved.start === "string" ? saved.start : day.open;
              const close =
                typeof saved.end === "string" ? saved.end : day.close;
              return {
                ...day,
                open,
                close: normalizeCloseTime(open, close),
                enabled: saved.enabled !== false,
              };
            }),
          );
          const settings = schedule._settings;
          if (settings && typeof settings === "object") {
            setReservationSettings({
              interval: String(
                settings.interval ?? DEFAULT_RESERVATION_SETTINGS.interval,
              ),
              maxAdvance: String(
                settings.maxAdvance ?? DEFAULT_RESERVATION_SETTINGS.maxAdvance,
              ),
              minCancel: String(
                settings.minCancel ?? DEFAULT_RESERVATION_SETTINGS.minCancel,
              ),
            });
          }
        }
        setLoading(false);
      }, () => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  async function saveSchedule(showToast = true) {
    if (!businessId) return toast.error("No se encontró el negocio");

    const invalidDay = days.find((day) => {
      if (!day.enabled) return false;
      const openMin = timeToMinutes(day.open);
      const closeMin = timeToMinutes(day.close);
      return openMin == null || closeMin == null || closeMin <= openMin;
    });

    if (invalidDay) {
      toast.error(
        "El horario de cierre debe ser posterior al horario de apertura.",
      );
      return;
    }

    if (!showToast) reportSaveStatus("saving");
    setSaving(true);
    // IMPORTANTE: leer el schedule existente y MERGEAR. Antes se reconstruía
    // desde cero y el upsert pisaba el resto de sub-configs (_employeeSchedules,
    // _branding, _caja, especiales, etc.).
    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    const existing = (existingRow?.schedule ?? {}) as Record<string, any>;

    const schedule: Record<string, any> = { ...existing };
    days.forEach((day, i) => {
      schedule[dayKeys[i]] = {
        enabled: day.enabled,
        start: day.open,
        end: day.close,
        breakStart: "12:00",
        breakEnd: "13:00",
      };
    });

    schedule._settings = {
      interval: Number(reservationSettings.interval) || 30,
      maxAdvance: Number(reservationSettings.maxAdvance) || 30,
      minCancel: Number(reservationSettings.minCancel) || 2,
    };
    const { error } = await supabase
      .from("business_settings")
      .upsert(
        { business_id: businessId, schedule },
        { onConflict: "business_id" },
      );

    setSaving(false);
    if (error) return toast.error("Error guardando horarios: " + error.message);
    if (showToast) toast.success("Guardado");
    else reportSaveStatus("saved");
  }

  const saveScheduleRef = useRef(saveSchedule);
  useEffect(() => {
    saveScheduleRef.current = saveSchedule;
  }, [businessId, days, reservationSettings]);

  const horariosHydratedRef = useRef(false);

  useEffect(() => {
    if (!businessId) return;

    if (!horariosHydratedRef.current) {
      horariosHydratedRef.current = true;
      return;
    }

    const timer = window.setTimeout(() => {
      void saveSchedule(false);
    }, 550);

    return () => window.clearTimeout(timer);
  }, [businessId, days, reservationSettings]);

  useEffect(() => {
    const handler = (event: Event) => {
      const section = (event as CustomEvent).detail?.section;
      if (!section || section === "horarios") void saveScheduleRef.current(false);
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, []);

  const reservationRows = [
    {
      key: "interval" as const,
      icon: Timer,
      title: "Intervalo de turnos",
      hint: "Cada cuántos minutos se pueden crear turnos",
      suffix: "min",
    },
    {
      key: "maxAdvance" as const,
      icon: CalendarDays,
      title: "Anticipación máxima",
      hint: "Con cuántos días de anticipación se puede reservar",
      suffix: "días",
    },
    {
      key: "minCancel" as const,
      icon: AlarmClock,
      title: "Cancelación mínima",
      hint: "Con cuántas horas de anticipación se puede cancelar",
      suffix: "horas",
    },
  ];

  if (loading) {
    return (
      <div className="grid place-items-center py-20">
        <ClipprLoader size="screen" delayMs={130} />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-display font-semibold">
            Horarios de atención
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Días y horarios de atención.
          </p>
        </div>
      </div>

      <div className="glass rounded-2xl p-4 ring-1 ring-white/5">
        <div className="grid grid-cols-[120px_1fr_1fr_auto_auto] gap-3 px-1 pb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
          <div>Día</div>
          <div>Apertura</div>
          <div>Cierre</div>
          <div>Abierto</div>
          <div></div>
        </div>
        <div className="divide-y divide-white/5">
          {days.map((d, i) => (
            <div
              key={d.name}
              className={cn(
                "grid grid-cols-[120px_1fr_1fr_auto_auto] gap-3 items-center py-3",
                !d.enabled && "opacity-50",
              )}
            >
              <div className="text-sm font-medium">{d.name}</div>
              <input
                type="time"
                value={d.open}
                disabled={!d.enabled}
                onChange={(e) => {
                  const value = e.target.value;
                  // En Clippr el horario de atención se usa como regla general
                  // de la agenda. Al cambiar la apertura, aplicamos el mismo
                  // valor a todos los días para que no quede modificado solo el
                  // día que se editó.
                  setDays((s) => s.map((x) => ({ ...x, open: value })));
                }}
                className="rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40 disabled:cursor-not-allowed"
              />
              <input
                type="time"
                value={d.close}
                disabled={!d.enabled}
                onChange={(e) => {
                  const value = e.target.value;
                  // Igual que apertura: el cierre se aplica a todos los días.
                  setDays((s) => s.map((x) => ({ ...x, close: value })));
                }}
                className="rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40 disabled:cursor-not-allowed"
              />
              <Toggle
                on={d.enabled}
                onChange={(v) =>
                  setDays((s) =>
                    s.map((x, idx) =>
                      idx === i
                        ? {
                            ...x,
                            enabled: v,
                            close: v
                              ? normalizeCloseTime(x.open, x.close)
                              : x.close,
                          }
                        : x,
                    ),
                  )
                }
              />
              <button
                disabled={!d.enabled}
                onClick={() => {
                  const source = days[i];
                  setDays((state) =>
                    state.map((row, idx) =>
                      idx > i
                        ? {
                            ...row,
                            open: source.open,
                            close: source.close,
                            enabled: source.enabled,
                          }
                        : row,
                    ),
                  );
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 ring-1 ring-white/10 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/10 disabled:opacity-40"
              >
                <Copy className="h-3 w-3" /> Copiar
              </button>
            </div>
          ))}
        </div>
      </div>


      <SectionCard label="Turnos y reservas">
        <div className="divide-y divide-white/5">
          {reservationRows.map((r) => {
            const Icon = r.icon;
            return (
              <div
                key={r.key}
                className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center">
                  <Icon className="h-4.5 w-4.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{r.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {r.hint}
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2">
                  <input
                    type="number"
                    min={1}
                    value={reservationSettings[r.key]}
                    onChange={(e) =>
                      setReservationSettings((state) => ({
                        ...state,
                        [r.key]: e.target.value,
                      }))
                    }
                    className="w-16 bg-transparent text-sm focus:outline-none text-right"
                  />
                  <span className="text-xs text-muted-foreground">
                    {r.suffix}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}
