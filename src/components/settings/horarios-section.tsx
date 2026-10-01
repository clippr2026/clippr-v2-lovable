import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CalendarDays, AlarmClock, CalendarOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import { SectionCard, reportSaveStatus, Toggle } from "@/components/settings/shared";
import { ClosuresModal } from "@/components/agenda/closures-button";

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
  maxAdvance: string;
  minCancel: string;
};

const DEFAULT_RESERVATION_SETTINGS: ReservationSettings = {
  maxAdvance: "30",
  minCancel: "2",
};

const DEFAULT_DAYS = DAYS.map((d, i) => ({
  name: d,
  open: "11:00",
  close: "20:00",
  enabled: i < 6,
}));

export function HorariosSection() {
  const { businessId, activeBranchId, profile } = useAuth();
  const [closuresOpen, setClosuresOpen] = useState(false);
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [reservationSettings, setReservationSettings] =
    useState<ReservationSettings>(DEFAULT_RESERVATION_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  // true justo después de una carga (mount o cambio de sucursal): el
  // próximo cambio de `days`/`reservationSettings` que ese setState
  // dispare es el propio eco de la carga, no una edición real del
  // usuario — el auto-save de abajo lo salta una vez y se apaga solo.
  // Sin esto, cambiar de sucursal podía llegar a guardar por un instante
  // el horario de la sucursal anterior en la fila de la nueva (carrera
  // entre el fetch async y el auto-save de 550ms).
  const skipNextAutoSaveRef = useRef(false);

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
    if (!businessId || !activeBranchId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("branch_settings" as any)
      .select("schedule")
      .eq("business_id", businessId)
      .eq("branch_id", activeBranchId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        skipNextAutoSaveRef.current = true;
        const schedule = data?.schedule as
          Record<string, any> | null | undefined;
        if (schedule && typeof schedule === "object") {
          setDays(
            DEFAULT_DAYS.map((day, i) => {
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
          setReservationSettings(
            settings && typeof settings === "object"
              ? {
                  maxAdvance: String(
                    settings.maxAdvance ?? DEFAULT_RESERVATION_SETTINGS.maxAdvance,
                  ),
                  minCancel: String(
                    settings.minCancel ?? DEFAULT_RESERVATION_SETTINGS.minCancel,
                  ),
                }
              : DEFAULT_RESERVATION_SETTINGS,
          );
        } else {
          // Esta sucursal todavía no tiene horario propio configurado —
          // nunca mostrar el de la sucursal anterior, arranca en blanco
          // (default), igual que un negocio nuevo.
          setDays(DEFAULT_DAYS);
          setReservationSettings(DEFAULT_RESERVATION_SETTINGS);
        }
        setLoading(false);
      }, () => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, activeBranchId]);

  async function saveSchedule(showToast = true) {
    if (!businessId) return toast.error("No se encontró el negocio");
    if (!activeBranchId) return toast.error("No se encontró la sucursal");

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
      .from("branch_settings" as any)
      .select("schedule")
      .eq("business_id", businessId)
      .eq("branch_id", activeBranchId)
      .maybeSingle();
    const existing = (existingRow?.schedule ?? {}) as Record<string, any>;

    const schedule: Record<string, any> = { ...existing };
    days.forEach((day, i) => {
      // Esta pantalla no tiene control de "descanso" del negocio (eso vive
      // en Equipo → Horarios, por profesional). Antes se pisaba acá un
      // breakStart/breakEnd fijo en 12:00-13:00 en CADA guardado, invisible
      // para el usuario — resolveDaySchedule lo unía al descanso propio de
      // cada profesional y terminaba mostrando dos bloques de descanso en la
      // Agenda. Se preserva lo que ya hubiera (si alguna vez se cargó por
      // otra vía) en vez de reescribirlo con un valor inventado.
      const prevDay = (existing[dayKeys[i]] ?? {}) as Record<string, unknown>;
      schedule[dayKeys[i]] = {
        ...prevDay,
        enabled: day.enabled,
        start: day.open,
        end: day.close,
      };
    });

    schedule._settings = {
      maxAdvance: Number(reservationSettings.maxAdvance) || 30,
      minCancel: Number(reservationSettings.minCancel) || 2,
    };
    const { error } = await supabase
      .from("branch_settings" as any)
      .upsert(
        { business_id: businessId, branch_id: activeBranchId, schedule },
        { onConflict: "business_id,branch_id" },
      );

    setSaving(false);
    if (error) return toast.error("Error guardando horarios: " + error.message);
    if (showToast) toast.success("Guardado");
    else reportSaveStatus("saved");
  }

  const saveScheduleRef = useRef(saveSchedule);
  useEffect(() => {
    saveScheduleRef.current = saveSchedule;
  }, [businessId, activeBranchId, days, reservationSettings]);

  useEffect(() => {
    if (!businessId || !activeBranchId) return;

    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void saveSchedule(false);
    }, 550);

    return () => window.clearTimeout(timer);
  }, [businessId, activeBranchId, days, reservationSettings]);

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
      {/* Oculto en mobile: la pantalla de Configuración ya muestra "←
          Horarios" arriba (drill-down tipo iOS, ver settings.tsx) —
          repetir el mismo título acá era redundante. En desktop no hay
          ese header de vuelta, así que sigue siendo la única referencia. */}
      <div className="hidden items-start justify-between gap-4 lg:flex">
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
        <div className="grid grid-cols-[120px_1fr_1fr_auto] gap-3 px-1 pb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
          <div>Día</div>
          <div>Apertura</div>
          <div>Cierre</div>
          <div>Abierto</div>
        </div>
        <div className="divide-y divide-white/5">
          {days.map((d, i) => (
            <div
              key={d.name}
              className={cn(
                "grid grid-cols-[120px_1fr_1fr_auto] gap-3 items-center py-3",
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
                  // Cada día es independiente — solo se actualiza el día
                  // editado (idx === i), igual que ya hace el Toggle de
                  // abierto/cerrado unas líneas más abajo.
                  setDays((s) => s.map((x, idx) => (idx === i ? { ...x, open: value } : x)));
                }}
                className="rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40 disabled:cursor-not-allowed"
              />
              <input
                type="time"
                value={d.close}
                disabled={!d.enabled}
                onChange={(e) => {
                  const value = e.target.value;
                  // Igual que apertura: solo el día editado.
                  setDays((s) => s.map((x, idx) => (idx === i ? { ...x, close: value } : x)));
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
            </div>
          ))}
        </div>
      </div>

      <SectionCard label="Días cerrados">
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-rose-500/10 ring-1 ring-rose-400/20 grid place-items-center">
            <CalendarOff className="h-4.5 w-4.5 text-rose-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">
              Fechas en las que el local no abre.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setClosuresOpen(true)}
            className="shrink-0 rounded-xl bg-rose-500/12 px-4 py-2.5 text-sm font-semibold text-rose-200 ring-1 ring-rose-400/25 transition hover:bg-rose-500/18"
          >
            Administrar días cerrados
          </button>
        </div>
      </SectionCard>

      {closuresOpen && (
        <ClosuresModal
          businessId={businessId}
          branchId={activeBranchId}
          createdByName={profile?.full_name ?? null}
          onClose={() => setClosuresOpen(false)}
        />
      )}

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
