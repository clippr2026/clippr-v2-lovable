import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CalendarDays, AlarmClock, CalendarSync, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import { SectionCard, Toggle, FloatingSaveButton, useUnsavedGuard } from "@/components/settings/shared";

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
  minAdvance: string;
  minCancel: string;
  minReschedule: string;
};

const DEFAULT_RESERVATION_SETTINGS: ReservationSettings = {
  maxAdvance: "30",
  minAdvance: "60",
  minCancel: "3",
  minReschedule: "3",
};

// Opciones de los selectores. maxAdvance en días, minAdvance en minutos, minCancel y minReschedule en horas.
const MAX_ADVANCE_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "1 día" },
  { value: 7, label: "1 semana" },
  { value: 14, label: "2 semanas" },
  { value: 21, label: "3 semanas" },
  { value: 30, label: "1 mes" },
  { value: 60, label: "2 meses" },
];
const MIN_ADVANCE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Sin anticipación" },
  { value: 30, label: "30 minutos" },
  { value: 60, label: "1 hora" },
  { value: 120, label: "2 horas" },
  { value: 240, label: "4 horas" },
  { value: 720, label: "12 horas" },
  { value: 1440, label: "1 día" },
  { value: 2880, label: "2 días" },
];
const MIN_CANCEL_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Sin límite" },
  { value: 1, label: "1 hora" },
  { value: 2, label: "2 horas" },
  { value: 3, label: "3 horas" },
  { value: 4, label: "4 horas" },
  { value: 12, label: "12 horas" },
  { value: 24, label: "1 día" },
  { value: 48, label: "2 días" },
];

const DEFAULT_DAYS = DAYS.map((d, i) => ({
  name: d,
  open: "11:00",
  close: "20:00",
  // Descanso del local ese día (vacío = sin descanso).
  breakStart: "",
  breakEnd: "",
  enabled: i < 6,
}));

// `parte`: "horarios" (días y descanso del local, en Página de reservas) o "reservas" (turnos y reservas de clientes,
// en Reservas). Cada una guarda solo lo suyo, así dos pantallas no se pisan entre sí.
export function HorariosSection({
  parte = "horarios",
  onDraft,
  registrarGuardado,
  onDirtyChange,
}: {
  parte?: "horarios" | "reservas";
  /** Los horarios tal como se van editando (sin guardar): alimentan la vista previa de la página pública. */
  onDraft?: (schedule: Record<string, { enabled: boolean; start: string; end: string; breakStart?: string; breakEnd?: string }>) => void;
  /** Si se pasa, no muestra su propio botón Guardar: el que la contiene guarda llamando a esta función. */
  registrarGuardado?: (guardar: () => Promise<boolean>) => void;
  onDirtyChange?: (dirty: boolean) => void;
} = {}) {
  const { businessId, activeBranchId, profile } = useAuth();
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [reservationSettings, setReservationSettings] =
    useState<ReservationSettings>(DEFAULT_RESERVATION_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const [loading, setLoading] = useState(true);
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  useEffect(() => {
    if (loading || !onDraftRef.current) return;
    const m: Record<string, { enabled: boolean; start: string; end: string; breakStart?: string; breakEnd?: string }> = {};
    days.forEach((d, i) => {
      m[dayKeys[i]] = {
        enabled: d.enabled,
        start: d.open,
        end: d.close,
        ...(d.breakStart && d.breakEnd ? { breakStart: d.breakStart, breakEnd: d.breakEnd } : {}),
      };
    });
    onDraftRef.current(m);
  }, [days, loading]);
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
        setDirty(false);
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
                breakStart: typeof saved.breakStart === "string" ? saved.breakStart : "",
                breakEnd: typeof saved.breakEnd === "string" ? saved.breakEnd : "",
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
                  minAdvance: String(
                    settings.minAdvance ?? DEFAULT_RESERVATION_SETTINGS.minAdvance,
                  ),
                  minCancel: String(
                    settings.minCancel ?? DEFAULT_RESERVATION_SETTINGS.minCancel,
                  ),
                  minReschedule: String(
                    settings.minReschedule ?? DEFAULT_RESERVATION_SETTINGS.minReschedule,
                  ),
                }
              : DEFAULT_RESERVATION_SETTINGS,
          );
        } else {
          // Esta sucursal todavía no tiene horario propio configurado —
          // nunca mostrar el de la sucursal anterior, arranca en blanco
          // (default), igual que un negocio nuevo.
          setDays([...DEFAULT_DAYS]);
          setReservationSettings({ ...DEFAULT_RESERVATION_SETTINGS });
        }
        setLoading(false);
      }, () => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, activeBranchId]);

  const saveRef = useRef<() => Promise<boolean>>(async () => true);
  useEffect(() => {
    registrarGuardado?.(() => saveRef.current());
  }, [registrarGuardado]);

  async function saveSchedule(): Promise<boolean> {
    if (!businessId) return void toast.error("No se encontró el negocio"), false;
    if (!activeBranchId) return void toast.error("No se encontró la sucursal"), false;

    const invalidDay = parte !== "horarios" ? undefined : days.find((day) => {
      if (!day.enabled) return false;
      const openMin = timeToMinutes(day.open);
      const closeMin = timeToMinutes(day.close);
      return openMin == null || closeMin == null || closeMin <= openMin;
    });

    const invalidBreak = parte !== "horarios" ? undefined : days.find((day) => {
      if (!day.enabled || (!day.breakStart && !day.breakEnd)) return false;
      const b0 = timeToMinutes(day.breakStart);
      const b1 = timeToMinutes(day.breakEnd);
      const o = timeToMinutes(day.open);
      const c = timeToMinutes(day.close);
      return b0 == null || b1 == null || o == null || c == null || b1 <= b0 || b0 < o || b1 > c;
    });
    if (invalidBreak) {
      toast.error(`El descanso del ${invalidBreak.name.toLowerCase()} tiene que estar dentro del horario de atención.`);
      return false;
    }

    if (invalidDay) {
      toast.error(
        "El horario de cierre debe ser posterior al horario de apertura.",
      );
      return false;
    }

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
    if (parte === "horarios") {
      days.forEach((day, i) => {
        // Esta pantalla no tiene control de "descanso" del negocio (eso vive
        // en Equipo → Horarios, por profesional). Antes se pisaba acá un
        // breakStart/breakEnd fijo en 12:00-13:00 en CADA guardado, invisible
        // para el usuario — resolveDaySchedule lo unía al descanso propio de
        // cada profesional y terminaba mostrando dos bloques de descanso en la
        // Agenda. Se preserva lo que ya hubiera (si alguna vez se cargó por
        // otra vía) en vez de reescribirlo con un valor inventado.
        const prevDay = (existing[dayKeys[i]] ?? {}) as Record<string, unknown>;
        const { breakStart: _bs, breakEnd: _be, ...restoDia } = prevDay as Record<string, unknown>;
        schedule[dayKeys[i]] = {
          ...restoDia,
          enabled: day.enabled,
          start: day.open,
          end: day.close,
          // Descanso del local: solo si están los dos horarios.
          ...(day.breakStart && day.breakEnd ? { breakStart: day.breakStart, breakEnd: day.breakEnd } : {}),
        };
      });
    }

    const asNumber = (v: string, fallback: number) => {
      const n = Number(v);
      return v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    if (parte === "reservas") schedule._settings = {
      maxAdvance: Math.max(1, asNumber(reservationSettings.maxAdvance, 30)),
      minAdvance: asNumber(reservationSettings.minAdvance, 60),
      minCancel: asNumber(reservationSettings.minCancel, 3),
      minReschedule: asNumber(reservationSettings.minReschedule, 3),
    };
    const { error } = await supabase
      .from("branch_settings" as any)
      .upsert(
        { business_id: businessId, branch_id: activeBranchId, schedule },
        { onConflict: "business_id,branch_id" },
      );

    setSaving(false);
    if (error) {
      toast.error("Error guardando horarios: " + error.message);
      return false;
    }
    setDirty(false);
    toast.success("Guardado");
    return true;
  }

  saveRef.current = saveSchedule;

  useEffect(() => {
    if (loading || !businessId || !activeBranchId) return;

    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }

    setDirty(true);
  }, [loading, businessId, activeBranchId, days, reservationSettings]);

  const reservationRows: {
    key: keyof ReservationSettings;
    icon: typeof CalendarDays;
    title: string;
    hint: string;
    options: { value: number; label: string }[];
    unit: string;
  }[] = [
    {
      key: "minAdvance",
      icon: Clock3,
      title: "Anticipación mínima",
      hint: "Cuánto antes del turno puede reservar el cliente",
      options: MIN_ADVANCE_OPTIONS,
      unit: "min",
    },
    {
      key: "maxAdvance",
      icon: CalendarDays,
      title: "Anticipación máxima",
      hint: "Con cuánta anticipación puede reservar el cliente como máximo",
      options: MAX_ADVANCE_OPTIONS,
      unit: "días",
    },
    {
      key: "minCancel",
      icon: AlarmClock,
      title: "Cancelación",
      hint: "Hasta cuánto antes del turno el cliente puede cancelar",
      options: MIN_CANCEL_OPTIONS,
      unit: "horas",
    },
    {
      key: "minReschedule",
      icon: CalendarSync,
      title: "Reprogramación",
      hint: "Hasta cuánto antes del turno el cliente puede reprogramar",
      options: MIN_CANCEL_OPTIONS,
      unit: "horas",
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
      {parte === "horarios" && (
      <>
      <div className="glass rounded-2xl p-4 ring-1 ring-white/5">
        <div className="mb-3 text-lg font-semibold text-white">Horarios del local</div>
        <div className="grid grid-cols-[120px_1fr_1fr_auto] gap-3 px-1 pb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
          <div>Día</div>
          <div>Apertura</div>
          <div>Cierre</div>
          <div>Abierto</div>
        </div>
        <div className="divide-y divide-white/5">
          {days.map((d, i) => (
            <div key={d.name} className={cn("py-3", !d.enabled && "opacity-50")}>
            <div className="grid grid-cols-[120px_1fr_1fr_auto] items-center gap-3">
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
            {d.enabled && (
              <div className="mt-2.5 grid grid-cols-[120px_1fr_1fr_auto] items-center gap-3">
                <div className="text-sm text-white/70">Descanso</div>
                {d.breakStart || d.breakEnd ? (
                  <>
                    <input
                      type="time"
                      value={d.breakStart}
                      onChange={(e) => {
                        const value = e.target.value;
                        setDays((s) => s.map((x, idx) => (idx === i ? { ...x, breakStart: value } : x)));
                      }}
                      className="rounded-lg bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-primary/40"
                    />
                    <input
                      type="time"
                      value={d.breakEnd}
                      onChange={(e) => {
                        const value = e.target.value;
                        setDays((s) => s.map((x, idx) => (idx === i ? { ...x, breakEnd: value } : x)));
                      }}
                      className="rounded-lg bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-primary/40"
                    />
                  </>
                ) : (
                  <div className="col-span-2 text-sm text-white/40">Sin descanso</div>
                )}
                <Toggle
                  on={Boolean(d.breakStart || d.breakEnd)}
                  onChange={(v) =>
                    setDays((s) =>
                      s.map((x, idx) =>
                        idx === i ? { ...x, breakStart: v ? "13:00" : "", breakEnd: v ? "14:00" : "" } : x,
                      ),
                    )
                  }
                />
              </div>
            )}
            </div>
          ))}
        </div>
      </div>



      </>
      )}

      {parte === "reservas" && (
      <SectionCard label="Turnos y reservas de clientes">
        <p className="mb-3 text-xs text-muted-foreground">
          Aplica a lo que hacen los clientes desde la página pública. No afecta lo que agendás vos desde la Agenda.
        </p>
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
                <select
                  value={reservationSettings[r.key]}
                  onChange={(e) =>
                    setReservationSettings((state) => ({
                      ...state,
                      [r.key]: e.target.value,
                    }))
                  }
                  className="min-w-[10rem] rounded-lg bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-primary/40 [color-scheme:dark]"
                >
                  {/* Si había un valor guardado que no está en la lista (de antes), se conserva. */}
                  {!r.options.some((o) => String(o.value) === reservationSettings[r.key]) ? (
                    <option value={reservationSettings[r.key]}>
                      {reservationSettings[r.key]} {r.unit}
                    </option>
                  ) : null}
                  {r.options.map((o) => (
                    <option key={o.value} value={String(o.value)}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </SectionCard>
      )}
      {!registrarGuardado && <FloatingSaveButton visible={dirty} saving={saving} onClick={() => void saveSchedule()} />}
    </>
  );
}
