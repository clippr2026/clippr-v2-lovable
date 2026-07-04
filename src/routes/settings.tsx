const DEFAULT_SENA_MESSAGE = `¡Hola! 👋

Para confirmar tu turno es necesario abonar una seña.

Datos para realizar el pago:

Titular: [Nombre]
Alias: [Alias]
CBU: [CBU]

Una vez realizado el pago, envianos el comprobante por WhatsApp al:

📲 [WhatsApp del local]

IMPORTANTE:

• La seña se descuenta del valor total del servicio.
• Podés cancelar o reprogramar tu turno hasta 24 horas antes sin perder la seña.
• Si cancelás con menos de 24 horas de anticipación o no asistís al turno, la seña no será reembolsable.
• La reserva queda confirmada únicamente una vez acreditado el pago.
• En caso de no recibir el comprobante, el turno podrá ser liberado para otro cliente.

¡Muchas gracias! Te esperamos. 🙌`;

import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import {
  Check,
  MapPin,
  Phone,
  Globe,
  X,
  FileText,
  Image as ImageIcon,
  Building2,
  Upload,
  Copy,
  Timer,
  CalendarDays,
  AlarmClock,
  Plus,
  Trash2,
  ChevronDown,
  Mail,
  Instagram,
  GripVertical,
  Zap,
  Banknote,
  Landmark,
  CreditCard,
  Wallet,
  PiggyBank,
  Rocket,
  Sparkles,
  ChevronRight,
  User as UserIcon,
  Store,
  Cloud,
  RefreshCw,
  Headphones,
  Lock,
  Users,
  UserPlus,
  CheckCircle2,
  XCircle,
  Star,
  ShieldCheck,
  Moon,
  Sun,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ServiceImage } from "@/components/ui/service-image";
import { SpecialHoursEditor } from "@/components/settings/special-hours-editor";
import type {
  SpecialDateMap,
  EmployeeSpecialDateMap,
} from "@/components/agenda/use-agenda-data";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import { ReservasOnlineIcon, BrandingSection } from "@/components/settings/branding-section";
import { SectionCard, reportSaveStatus, processImage } from "@/components/settings/shared";



type SectionId =
  | "branding"
  | "landing"
  | "horarios"
  | "equipo"
  | "servicios"
  | "catalogo"
  | "caja"
  | "cuenta"
  | "senas"
  | "plan";

type NavItem = {
  id: SectionId;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tint: string;
  glow: string;
};

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: "General",
    items: [
      {
        id: "branding",
        label: "Página de reservas",
        icon: ReservasOnlineIcon,
        tint: "text-white",
        glow: "from-[oklch(0.7_0.25_300/0.25)] to-[oklch(0.55_0.27_285/0.05)]",
      },
      {
        id: "horarios",
        label: "Horarios",
        icon: CalendarDays,
        tint: "text-[oklch(0.78_0.2_270)]",
        glow: "from-[oklch(0.78_0.2_270/0.25)] to-[oklch(0.65_0.22_285/0.05)]",
      },
    ],
  },
  {
    label: "Operaciones",
    items: [
      {
        id: "equipo",
        label: "Equipo",
        icon: Users,
        tint: "text-[oklch(0.82_0.16_200)]",
        glow: "from-[oklch(0.82_0.16_200/0.25)] to-[oklch(0.7_0.2_220/0.05)]",
      },
      {
        id: "servicios",
        label: "Servicios",
        icon: Zap,
        tint: "text-[oklch(0.85_0.18_160)]",
        glow: "from-[oklch(0.85_0.18_160/0.25)] to-[oklch(0.7_0.2_170/0.05)]",
      },
      {
        id: "catalogo",
        label: "Catálogo",
        icon: Store,
        tint: "text-[oklch(0.82_0.14_75)]",
        glow: "from-[oklch(0.82_0.14_75/0.25)] to-[oklch(0.78_0.17_55/0.05)]",
      },
    ],
  },
  {
    label: "Sistema",
    items: [
      {
        id: "caja" as const,
        label: "Caja",
        icon: Banknote,
        tint: "text-[oklch(0.80_0.18_45)]",
        glow: "from-[oklch(0.80_0.18_45/0.25)] to-[oklch(0.75_0.2_35/0.05)]",
      },
      {
        id: "cuenta" as const,
        label: "Cuenta",
        icon: CreditCard,
        tint: "text-[oklch(0.82_0.16_210)]",
        glow: "from-[oklch(0.82_0.16_210/0.25)] to-[oklch(0.68_0.20_230/0.05)]",
      },
    ],
  },
];

// ─────────── Apariencia ───────────
const THEME_KEY = "clippr_theme";

function AparienciaSection() {
  const [theme, setThemeState] = React.useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem(THEME_KEY) as "dark" | "light") ?? "dark";
  });

  function applyTheme(t: "dark" | "light") {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
    const root = document.documentElement;
    if (t === "light") {
      root.classList.remove("dark");
      root.classList.add("light");
    } else {
      root.classList.remove("light");
      root.classList.add("dark");
    }
  }

  // Apply saved theme on mount
  React.useEffect(() => {
    applyTheme(theme);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const options = [
    {
      id: "dark" as const,
      label: "Oscuro",
      desc: "Fondo negro, ideal para trabajar de noche o en ambientes con poca luz.",
      Icon: Moon,
      preview: "bg-[oklch(0.09_0.03_275)]",
      ring: "ring-white/10",
    },
    {
      id: "light" as const,
      label: "Claro",
      desc: "Fondo blanco, ideal para trabajar con luz natural o durante el día.",
      Icon: Sun,
      preview: "bg-[oklch(0.97_0.01_270)]",
      ring: "ring-black/10",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-display font-semibold">Apariencia</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Elegí el tema visual de la aplicación.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {options.map((opt) => {
          const isActive = theme === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => applyTheme(opt.id)}
              className={cn(
                "relative rounded-2xl p-4 text-left transition-all ring-1",
                isActive
                  ? "ring-primary bg-primary/10"
                  : "ring-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
              )}
            >
              {/* Preview swatch */}
              <div
                className={cn(
                  "rounded-xl h-20 mb-4 flex items-center justify-center ring-1",
                  opt.preview,
                  opt.ring,
                )}
              >
                <opt.Icon
                  className={cn(
                    "size-7",
                    opt.id === "dark" ? "text-white/60" : "text-white/50",
                  )}
                />
              </div>

              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-sm">{opt.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {opt.desc}
                  </div>
                </div>
                {isActive && (
                  <div className="shrink-0 h-5 w-5 rounded-full bg-primary grid place-items-center mt-0.5">
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path
                        d="M1 4L3.5 6.5L9 1"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        El tema elegido se guarda localmente en este dispositivo.
      </p>
    </div>
  );
}


// ─────────── shared bits ───────────
function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-6 w-11 rounded-full transition-colors ring-1",
        on
          ? "bg-gradient-to-r from-sky-400 to-violet-500 ring-violet-400/45"
          : "bg-white/5 ring-white/10",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          on ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}


// ─────────── ConfirmDialog ───────────
function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Eliminar",
  danger = true,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  danger?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass rounded-2xl p-6 max-w-sm w-full mx-4 ring-1 ring-white/10 space-y-4">
        <div>
          <div className="font-display font-semibold text-base text-foreground">
            {title}
          </div>
          <div className="text-sm text-muted-foreground mt-1">{message}</div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-semibold transition",
              danger
                ? "bg-red-500/20 hover:bg-red-500/30 ring-1 ring-red-500/40 text-red-300"
                : "bg-gradient-to-r from-sky-400 to-violet-500 text-white",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

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

function HorariosSection() {
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

// ─────────── Equipo ───────────
const PRO_TINTS = [
  "from-[oklch(0.78_0.17_55)] to-[oklch(0.72_0.2_40)]",
  "from-[oklch(0.72_0.2_245)] to-[oklch(0.65_0.22_270)]",
  "from-[oklch(0.7_0.25_300)] to-[oklch(0.6_0.22_290)]",
  "from-[oklch(0.82_0.16_200)] to-[oklch(0.7_0.2_220)]",
  "from-[oklch(0.78_0.17_140)] to-[oklch(0.7_0.2_160)]",
  "from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)]",
];

// Color estable por id (no por posición): así eliminar un profesional no cambia
// el color/avatar de los demás.
function tintForId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PRO_TINTS[h % PRO_TINTS.length];
}

const AGENDA_COLORS = [
  "oklch(0.65 0.18 240)",
  "oklch(0.65 0.22 300)",
  "oklch(0.75 0.14 75)",
  "oklch(0.72 0.18 150)",
  "oklch(0.68 0.22 25)",
  "oklch(0.8 0.17 90)",
];

const WEEKDAYS = [
  ["mon", "Lunes"],
  ["tue", "Martes"],
  ["wed", "Miércoles"],
  ["thu", "Jueves"],
  ["fri", "Viernes"],
  ["sat", "Sábado"],
  ["sun", "Domingo"],
] as const;

type DayKey = (typeof WEEKDAYS)[number][0];
type DaySchedule = {
  enabled: boolean;
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
};
type ScheduleMap = Record<DayKey, DaySchedule>;

const DEFAULT_SCHEDULE: ScheduleMap = {
  mon: {
    enabled: true,
    start: "11:00",
    end: "20:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  },
  tue: {
    enabled: true,
    start: "11:00",
    end: "20:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  },
  wed: {
    enabled: true,
    start: "11:00",
    end: "20:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  },
  thu: {
    enabled: true,
    start: "11:00",
    end: "20:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  },
  fri: {
    enabled: true,
    start: "11:00",
    end: "20:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  },
  sat: {
    enabled: true,
    start: "11:00",
    end: "20:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  },
  sun: {
    enabled: false,
    start: "11:00",
    end: "20:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  },
};

type EmployeeRow = {
  id: string;
  name?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  is_active?: boolean | null;
  commission_pct?: number | null;
  role?: string | null;
};

type PendingProfessional = {
  tempId: string;
  payload: {
    id?: string;
    full_name: string;
    is_active: boolean;
    commission_pct: number | null;
    avatar_url?: string | null;
    role?: string | null;
    acceptsOnline?: boolean;
    commissions?: Record<string, CommissionConfig>;
    schedule?: ScheduleMap;
    specialDates?: SpecialDateMap;
  };
  isNew: boolean;
};

type CommissionMode = "percent" | "fixed";

type CommissionConfig = {
  enabled: boolean;
  mode: CommissionMode;
  value: string;
};

type NewProForm = {
  fullName: string;
  email: string;
  phone: string;
  role: string;
  acceptsOnline: boolean;
  color: string;
  schedule: ScheduleMap;
  publicName: string;
  description: string;
  specialty: string;
  commissionPct: string;
  avatarUrl: string;
  commissions: Record<string, CommissionConfig>;
  specialDates: SpecialDateMap;
};

const EMPTY_FORM: NewProForm = {
  fullName: "",
  email: "",
  phone: "",
  role: "Barbero",
  acceptsOnline: true,
  color: AGENDA_COLORS[0],
  schedule: DEFAULT_SCHEDULE,
  publicName: "",
  description: "",
  specialty: "",
  commissionPct: "",
  avatarUrl: "",
  commissions: {},
  specialDates: {},
};

const inputCls =
  "w-full rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-primary/40";
const timeCls =
  "rounded-md bg-white/5 ring-1 ring-white/10 px-2 py-1 text-xs focus:outline-none w-[72px]";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-1.5">
        {label}
      </div>
      {children}
      {hint && (
        <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>
      )}
    </div>
  );
}

type RolePermissionId =
  "admin_general" | "socio" | "admin_local" | "recepcionista" | "profesional";

type PermissionKey =
  | "dashboard"
  | "agenda"
  | "caja_cobro"
  | "panel_profesionales"
  | "clientes"
  | "configuracion"
  | "branding"
  | "horarios"
  | "equipo"
  | "servicios"
  | "catalogo"
  | "caja"
  | "senas"
  | "asesor_ia"
  | "plan_facturacion";

type PermissionMap = Record<PermissionKey, boolean>;
type RolePermissions = Record<RolePermissionId, PermissionMap>;

type AccessStatus = "invited" | "active" | "suspended";

type AccessUser = {
  id: string;
  auth_user_id?: string | null;
  name: string;
  email: string;
  role: RolePermissionId;
  status: AccessStatus;
  employee_id?: string | null;
  branch_id?: string | null;
  created_at?: string | null;
};

type AccessFormState = {
  name: string;
  email: string;
  role: RolePermissionId;
  status: "active" | "inactive";
  employee_id: string | null;
  branch_id: string | null;
};

const ROLE_LABEL_BY_ID: Record<RolePermissionId, string> = {
  admin_general: "Admin. General",
  socio: "Socio",
  admin_local: "Administrador Local",
  recepcionista: "Recepcionista",
  profesional: "Profesional",
};

const EMPTY_ACCESS_FORM: AccessFormState = {
  name: "",
  email: "",
  role: "profesional",
  status: "active",
  employee_id: null,
  branch_id: null,
};

const MAIN_PERMISSION_ITEMS: {
  key: PermissionKey;
  label: string;
  desc: string;
}[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    desc: "Métricas generales del negocio.",
  },
  { key: "agenda", label: "Agenda", desc: "Turnos, calendario y reservas." },
  { key: "caja_cobro", label: "Caja", desc: "Cobros y medios de pago." },
  {
    key: "panel_profesionales",
    label: "Profesionales",
    desc: "Panel y actividad de profesionales.",
  },
  { key: "clientes", label: "Clientes", desc: "Base de clientes e historial." },
  {
    key: "configuracion",
    label: "Configuración",
    desc: "Acceso a ajustes del negocio.",
  },
  {
    key: "asesor_ia",
    label: "Asesor IA",
    desc: "Análisis, recomendaciones, simuladores y métricas con IA.",
  },
];

const CONFIG_PERMISSION_ITEMS: {
  key: PermissionKey;
  label: string;
  desc: string;
}[] = [
  {
    key: "branding",
    label: "Página de reservas",
    desc: "Identidad visual y datos del negocio.",
  },
  {
    key: "horarios",
    label: "Horarios",
    desc: "Disponibilidad y reglas de agenda.",
  },
  {
    key: "equipo",
    label: "Equipo",
    desc: "Profesionales, usuarios y permisos.",
  },
  {
    key: "servicios",
    label: "Servicios",
    desc: "Servicios, precios y categorías.",
  },
  {
    key: "catalogo",
    label: "Catálogo",
    desc: "Productos, stock y categorías.",
  },
  { key: "caja", label: "Caja", desc: "Métodos de pago y reglas de cobro." },
  { key: "senas", label: "Señas", desc: "Reglas de señas para reservas." },
];

const ALL_PERMISSION_KEYS: PermissionKey[] = [
  ...MAIN_PERMISSION_ITEMS.map((item) => item.key),
  ...CONFIG_PERMISSION_ITEMS.map((item) => item.key),
];

// Subsecciones internas que dependen del único permiso "Configuración".
const CONFIG_SUB_KEYS: PermissionKey[] = [
  "branding",
  "horarios",
  "equipo",
  "servicios",
  "catalogo",
  "caja",
  "senas",
];

const allOnPermissions = (): PermissionMap =>
  ALL_PERMISSION_KEYS.reduce(
    (acc, key) => ({ ...acc, [key]: true }),
    {} as PermissionMap,
  );

const buildPermissions = (enabled: PermissionKey[]): PermissionMap =>
  ALL_PERMISSION_KEYS.reduce(
    (acc, key) => ({ ...acc, [key]: enabled.includes(key) }),
    {} as PermissionMap,
  );

const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  admin_general: allOnPermissions(),
  socio: buildPermissions([
    "dashboard",
    "agenda",
    "caja_cobro",
    "panel_profesionales",
    "clientes",
    "configuracion",
    "asesor_ia",
    "branding",
    "horarios",
    "equipo",
    "servicios",
    "catalogo",
    "caja",
    "senas",
  ]),
  admin_local: buildPermissions([
    "dashboard",
    "agenda",
    "caja_cobro",
    "clientes",
  ]),
  recepcionista: buildPermissions(["agenda", "caja_cobro", "clientes"]),
  profesional: buildPermissions(["panel_profesionales"]),
};

const ROLE_PERMISSION_OPTIONS: {
  id: RolePermissionId;
  label: string;
  icon: string;
  desc: string;
  locked?: boolean;
}[] = [
  {
    id: "admin_general",
    label: "Admin. General",
    icon: "👑",
    desc: "Administrador principal del negocio.",
    locked: true,
  },
  {
    id: "socio",
    label: "Socio",
    icon: "🤝",
    desc: "Acceso completo por defecto, editable.",
  },
  {
    id: "admin_local",
    label: "Administrador Local",
    icon: "🏢",
    desc: "Gestión operativa de la sucursal.",
  },
  {
    id: "recepcionista",
    label: "Recepcionista",
    icon: "💼",
    desc: "Agenda, caja y clientes.",
  },
  {
    id: "profesional",
    label: "Profesional",
    icon: "✂️",
    desc: "Accesos para el trabajo diario.",
  },
];

const ROLE_ACCESS_SUMMARY: Record<
  RolePermissionId,
  { title: string; desc: string; can: string[]; cannot: string[] }
> = {
  admin_general: {
    title: "Administrador principal",
    desc: "Control completo del negocio en Clippr.",
    can: ["Todo el negocio", "Configuración", "Caja", "Asesor IA"],
    cannot: [],
  },
  socio: {
    title: "Gestión completa",
    desc: "Ideal para socios o encargados con visión completa del negocio.",
    can: ["Dashboard", "Agenda", "Caja", "Profesionales", "Clientes", "Asesor IA", "Configuración"],
    cannot: [],
  },
  admin_local: {
    title: "Gestión operativa",
    desc: "Para administrar la operación diaria sin tocar datos sensibles del negocio.",
    can: ["Dashboard", "Agenda", "Caja", "Clientes"],
    cannot: ["Profesionales", "Configuración", "Asesor IA"],
  },
  recepcionista: {
    title: "Recepción y caja",
    desc: "Para gestionar turnos, clientes y cobros del día.",
    can: ["Agenda", "Caja", "Clientes"],
    cannot: ["Dashboard", "Profesionales", "Configuración", "Asesor IA"],
  },
  profesional: {
    title: "Panel profesional",
    desc: "Para que cada profesional vea su actividad y registre su trabajo.",
    can: ["Profesionales"],
    cannot: ["Dashboard", "Agenda", "Caja", "Clientes", "Configuración", "Asesor IA"],
  },
};

function normalizeRolePermissions(value: unknown): RolePermissions {
  const saved = (
    value && typeof value === "object" ? value : {}
  ) as Partial<RolePermissions>;
  return ROLE_PERMISSION_OPTIONS.reduce((acc, role) => {
    const base = DEFAULT_ROLE_PERMISSIONS[role.id];
    const incoming = (saved[role.id] ?? {}) as Partial<PermissionMap>;
    acc[role.id] =
      role.id === "admin_general"
        ? allOnPermissions()
        : ALL_PERMISSION_KEYS.reduce(
            (roleAcc, key) => ({
              ...roleAcc,
              [key]:
                typeof incoming[key] === "boolean"
                  ? Boolean(incoming[key])
                  : base[key],
            }),
            {} as PermissionMap,
          );
    return acc;
  }, {} as RolePermissions);
}

function normalizePermissionMap(value: unknown): PermissionMap {
  const src = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return ALL_PERMISSION_KEYS.reduce(
    (acc, key) => ({ ...acc, [key]: src[key] === true }),
    {} as PermissionMap,
  );
}

function normalizePublicBooleanMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key.trim().length > 0)
      .map(([key, next]) => [key, next !== false]),
  );
}

function getPublicVisibility(schedule: Record<string, unknown>) {
  return (schedule._publicVisibility ?? {}) as Record<string, unknown>;
}

// Tarjeta de profesional memoizada: solo se re-renderiza si cambian sus props
// (este profesional o sus callbacks), no cuando cambia cualquier otro estado de
// Configuración. Reduce drásticamente los re-renders con muchos profesionales.
const ProfessionalCard = React.memo(function ProfessionalCard({
  emp,
  tintClass,
  deleting,
  onEdit,
  onToggle,
  onRemove,
}: {
  emp: EmployeeRow;
  tintClass: string;
  deleting?: boolean;
  onEdit: (emp: EmployeeRow) => void;
  onToggle: (emp: EmployeeRow) => void;
  onRemove: (emp: EmployeeRow) => void;
}) {
  const displayName = emp.full_name || emp.name || "—";
  const active = emp.is_active !== false;
  return (
    <div
      className={cn(
        "glass rounded-2xl p-4 ring-1 ring-white/5 transition-opacity",
        (!active || deleting) && "opacity-70",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "h-10 w-10 rounded-full overflow-hidden grid place-items-center text-sm font-semibold text-white bg-gradient-to-br ring-1 ring-white/10",
            tintClass,
          )}
        >
          {emp.avatar_url ? (
            <img
              src={emp.avatar_url}
              alt={displayName}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            displayName[0]?.toUpperCase()
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm ">{displayName}</div>
          <div className="text-xs text-muted-foreground">{emp.role?.trim() || "Profesional"}</div>
        </div>
        <button
          type="button"
          onClick={() => onToggle(emp)}
          disabled={deleting}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full ring-1 px-2 py-0.5 text-[10px] uppercase tracking-wider transition hover:brightness-110 disabled:opacity-50",
            active
              ? "bg-[oklch(0.78_0.17_140/0.12)] ring-[oklch(0.78_0.17_140/0.3)] text-[oklch(0.85_0.17_140)]"
              : "bg-white/5 ring-white/10 text-muted-foreground",
          )}
          title={active ? "Desactivar profesional" : "Activar profesional"}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              active ? "bg-[oklch(0.78_0.17_140)]" : "bg-muted-foreground",
            )}
          />
          {active ? "Activo" : "Inactivo"}
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => onEdit(emp)}
          disabled={deleting}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-3 py-1.5 text-xs disabled:opacity-50"
        >
          Editar
        </button>
      </div>
    </div>
  );
});

function EquipoSection() {
  const { businessId } = useAuth();
  const [tab, setTab] = useState<"pros" | "users">("pros");
  const [selectedPermRole, setSelectedPermRole] =
    useState<RolePermissionId>("admin_general");
  const [rolePermissions, setRolePermissions] = useState<RolePermissions>(
    DEFAULT_ROLE_PERMISSIONS,
  );
  const [individualPermMode, setIndividualPermMode] = useState(true);
  const [selectedAccessUserId, setSelectedAccessUserId] = useState<string>("");
  const [accessUsers, setAccessUsers] = useState<AccessUser[]>([]);
  const [accessForm, setAccessForm] = useState(EMPTY_ACCESS_FORM);
  const [editingAccessUserId, setEditingAccessUserId] = useState<string | null>(
    null,
  );
  const [pendingDeleteUser, setPendingDeleteUser] = useState<AccessUser | null>(
    null,
  );
  const [deletingAccess, setDeletingAccess] = useState(false);
  const [accessTouched, setAccessTouched] = useState(false);
  const [accessPermissionsForm, setAccessPermissionsForm] =
    useState<PermissionMap>(DEFAULT_ROLE_PERMISSIONS.profesional);
  const [userPermissions, setUserPermissions] = useState<
    Record<string, PermissionMap>
  >({});
  const [approvalEnabled, setApprovalEnabled] = useState(false);
  const [approvalMode, setApprovalMode] = useState<"auto" | "manual">("auto");
  const [showAutoApprovalExample, setShowAutoApprovalExample] = useState(false);
  const [showManualApprovalExample, setShowManualApprovalExample] = useState(false);
  const [showAutoApprovalPurpose, setShowAutoApprovalPurpose] = useState(false);
  const [showManualApprovalPurpose, setShowManualApprovalPurpose] = useState(false);
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [employeeOnlineMap, setEmployeeOnlineMap] = useState<
    Record<string, boolean>
  >({});
  // Horario individual por profesional cargado desde
  // business_settings.schedule._employeeSchedules. Pre-carga el form al editar
  // y evita perderlo al re-guardar.
  const [employeeSchedules, setEmployeeSchedules] = useState<
    Record<string, ScheduleMap>
  >({});
  const [employeeSpecialDates, setEmployeeSpecialDates] =
    useState<EmployeeSpecialDateMap>({});
  const [pendingProfessionals, setPendingProfessionals] = useState<
    PendingProfessional[]
  >([]);
  const [commissionItems, setCommissionItems] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<EmployeeRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingEmp, setEditingEmp] = useState<EmployeeRow | null>(null);
  const [form, setForm] = useState<NewProForm>(EMPTY_FORM);
  const [dlgTab, setDlgTab] = useState<"perfil" | "horarios" | "comisiones">(
    "perfil",
  );

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data, error }, catalogResult, settingsResult] = await Promise.all([
      supabase
        .from("employees")
        .select("id,full_name,avatar_url,is_active,commission_pct")
        .eq("business_id", businessId)
        .order("full_name", { ascending: true }),
      supabase
        .from("price_catalog")
        .select(
          "id,name,price,duration_min,category,active,stock,cash_discount",
        )
        .eq("business_id", businessId)
        .order("category")
        .order("name"),
      supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);
    if (error) toast.error("Error cargando profesionales: " + error.message);
    if (catalogResult.error)
      toast.error(
        "Error cargando servicios y catálogo: " + catalogResult.error.message,
      );
    const schedule = (settingsResult.data?.schedule ?? {}) as Record<
      string,
      unknown
    >;
    const employeeRoles = (
      schedule._employeeRoles && typeof schedule._employeeRoles === "object"
        ? schedule._employeeRoles
        : {}
    ) as Record<string, string>;
    setRows(
      ((data ?? []) as EmployeeRow[]).map((emp) => ({
        ...emp,
        role: employeeRoles[emp.id] ?? emp.role ?? null,
      })),
    );
    setCommissionItems((catalogResult.data ?? []) as PriceRow[]);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const loadTeamMembers = useCallback(async () => {
    if (!businessId) return;
    const { data, error } = await supabase
      .from("team_members")
      .select(
        "id, auth_user_id, full_name, email, role, status, professional_id, branch_id, permissions, created_at",
      )
      .eq("business_id", businessId)
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Error cargando accesos: " + error.message);
      return;
    }
    // Excluimos los tombstones de accesos eliminados (status deleted/removed):
    // la fila se conserva en la base para bloquear el re-acceso, pero NO debe
    // mostrarse en la lista de accesos.
    const rows = ((data ?? []) as Array<Record<string, unknown>>).filter(
      (r) =>
        !["deleted", "removed"].includes(String(r.status ?? "").toLowerCase()),
    );
    const users: AccessUser[] = rows.map((r) => {
      const rawStatus = String(r.status ?? "invited");
      const status: AccessStatus =
        rawStatus === "active"
          ? "active"
          : rawStatus === "suspended"
            ? "suspended"
            : "invited";
      const role: RolePermissionId = ROLE_PERMISSION_OPTIONS.some(
        (o) => o.id === r.role,
      )
        ? (r.role as RolePermissionId)
        : "profesional";
      return {
        id: String(r.id),
        auth_user_id: (r.auth_user_id as string | null) ?? null,
        name: String(r.full_name ?? "").trim(),
        email: String(r.email ?? "").trim(),
        role,
        status,
        employee_id: (r.professional_id as string | null) ?? null,
        branch_id: (r.branch_id as string | null) ?? null,
        created_at: (r.created_at as string | null) ?? null,
      };
    });
    const perms: Record<string, PermissionMap> = {};
    rows.forEach((r) => {
      perms[String(r.id)] = normalizePermissionMap(r.permissions);
    });
    setAccessUsers(users);
    setUserPermissions(perms);
    setSelectedAccessUserId((current) => current || users[0]?.id || "");
  }, [businessId]);

  useEffect(() => {
    loadTeamMembers();
  }, [loadTeamMembers]);

  useEffect(() => {
    if (!businessId) return;
    supabase
      .from("business_settings")
      .select("schedule,approval_mode")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
        const caja = (schedule._caja ?? {}) as Record<string, unknown>;
        setRolePermissions(normalizeRolePermissions(schedule._rolePermissions));
        const visibility = getPublicVisibility(schedule);
        setEmployeeOnlineMap(
          normalizePublicBooleanMap(
            visibility.employees ?? schedule._employeeOnline,
          ),
        );
        const loadedEmployeeSchedules = (
          schedule._employeeSchedules &&
          typeof schedule._employeeSchedules === "object"
            ? schedule._employeeSchedules
            : {}
        ) as Record<string, ScheduleMap>;
        setEmployeeSchedules(loadedEmployeeSchedules);
        const loadedEmployeeSpecial = (
          schedule._employeeSpecialDates &&
          typeof schedule._employeeSpecialDates === "object"
            ? schedule._employeeSpecialDates
            : {}
        ) as EmployeeSpecialDateMap;
        setEmployeeSpecialDates(loadedEmployeeSpecial);
        const employeeRoles = (
          schedule._employeeRoles && typeof schedule._employeeRoles === "object"
            ? schedule._employeeRoles
            : {}
        ) as Record<string, string>;
        setRows((current) =>
          current.map((emp) => ({
            ...emp,
            role: employeeRoles[emp.id] ?? emp.role ?? null,
          })),
        );
        setApprovalEnabled(caja.approvalModeEnabled === true);
        setApprovalMode(data?.approval_mode === "manual" ? "manual" : "auto");
      });
  }, [businessId]);

  async function saveRolePermissions(showToast = true) {
    if (!businessId) return;
    if (!showToast) reportSaveStatus("saving");

    for (const item of pendingProfessionals) {
      const payload = item.payload;
      if (item.isNew) {
        const { data: inserted, error } = await supabase
          .from("employees")
          .insert({
            business_id: businessId,
            full_name: payload.full_name,
            is_active: payload.is_active,
            commission_pct: payload.commission_pct,
            avatar_url: payload.avatar_url ?? null,
          })
          .select("id")
          .single();

        if (error || !inserted) {
          return toast.error(
            "Error guardando profesional: " +
              (error?.message ?? "no se pudo crear"),
          );
        }

        {
          const { data: existingRow } = await supabase
            .from("business_settings")
            .select("schedule")
            .eq("business_id", businessId)
            .maybeSingle();
          const existingSchedule = (existingRow?.schedule ?? {}) as Record<
            string,
            unknown
          >;
          const existingCommissions = (existingSchedule._employeeCommissions ??
            {}) as Record<string, unknown>;
          const existingRoles = (existingSchedule._employeeRoles ??
            {}) as Record<string, string>;
          const visibility = getPublicVisibility(existingSchedule);
          const employeesVisibility = normalizePublicBooleanMap(
            visibility.employees ?? existingSchedule._employeeOnline,
          );

          await supabase.from("business_settings").upsert(
            {
              business_id: businessId,
              schedule: {
                ...existingSchedule,
                _employeeCommissions: payload.commissions
                  ? {
                      ...existingCommissions,
                      [inserted.id]: payload.commissions,
                    }
                  : existingCommissions,
                _employeeRoles: {
                  ...existingRoles,
                  [inserted.id]: payload.role ?? "Profesional",
                },
                _employeeSchedules: payload.schedule
                  ? {
                      ...((existingSchedule._employeeSchedules ?? {}) as Record<
                        string,
                        unknown
                      >),
                      [inserted.id]: payload.schedule,
                    }
                  : (existingSchedule._employeeSchedules ?? {}),
                _publicVisibility: {
                  ...visibility,
                  employees: {
                    ...employeesVisibility,
                    [inserted.id]: payload.acceptsOnline !== false,
                  },
                },
              },
            },
            { onConflict: "business_id" },
          );
        }
      } else if (payload.id) {
        const { error } = await supabase
          .from("employees")
          .update({
            full_name: payload.full_name,
            is_active: payload.is_active,
            commission_pct: payload.commission_pct,
            avatar_url: payload.avatar_url ?? null,
          })
          .eq("id", payload.id);

        if (error)
          return toast.error("Error guardando profesional: " + error.message);

        {
          const { data: existingRow } = await supabase
            .from("business_settings")
            .select("schedule")
            .eq("business_id", businessId)
            .maybeSingle();
          const existingSchedule = (existingRow?.schedule ?? {}) as Record<
            string,
            unknown
          >;
          const existingCommissions = (existingSchedule._employeeCommissions ??
            {}) as Record<string, unknown>;
          const existingRoles = (existingSchedule._employeeRoles ??
            {}) as Record<string, string>;
          const visibility = getPublicVisibility(existingSchedule);
          const employeesVisibility = normalizePublicBooleanMap(
            visibility.employees ?? existingSchedule._employeeOnline,
          );

          await supabase.from("business_settings").upsert(
            {
              business_id: businessId,
              schedule: {
                ...existingSchedule,
                _employeeCommissions: payload.commissions
                  ? {
                      ...existingCommissions,
                      [payload.id]: payload.commissions,
                    }
                  : existingCommissions,
                _employeeRoles: {
                  ...existingRoles,
                  [payload.id]: payload.role ?? "Profesional",
                },
                _employeeSchedules: payload.schedule
                  ? {
                      ...((existingSchedule._employeeSchedules ?? {}) as Record<
                        string,
                        unknown
                      >),
                      [payload.id]: payload.schedule,
                    }
                  : (existingSchedule._employeeSchedules ?? {}),
                _publicVisibility: {
                  ...visibility,
                  employees: {
                    ...employeesVisibility,
                    [payload.id]: payload.acceptsOnline !== false,
                  },
                },
              },
            },
            { onConflict: "business_id" },
          );
        }
      }
    }

    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();

    const existingSchedule = (existingRow?.schedule ?? {}) as Record<
      string,
      unknown
    >;
    const cleaned = normalizeRolePermissions(rolePermissions);

    const { error } = await supabase.from("business_settings").upsert(
      {
        business_id: businessId,
        approval_mode: approvalMode,
        schedule: {
          ...existingSchedule,
          _rolePermissions: cleaned,
          _caja: {
            ...((existingSchedule._caja ?? {}) as Record<string, unknown>),
            approvalModeEnabled: approvalEnabled,
          },
        },
      },
      { onConflict: "business_id" },
    );

    if (error)
      return toast.error(
        "Error guardando accesos y permisos: " + error.message,
      );
    window.dispatchEvent(new CustomEvent("clippr:caja-settings-updated"));
    setPendingProfessionals([]);
    await load();
    if (showToast) toast.success("Equipo guardado correctamente");
    else reportSaveStatus("saved");
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const section = detail?.section;
      const silent = detail?.silent === true;
      if (!section || section === "equipo") {
        void saveRolePermissions(!silent);
      }
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, [
    businessId,
    rolePermissions,
    accessUsers,
    userPermissions,
    pendingProfessionals,
    load,
    approvalEnabled,
    approvalMode,
  ]);

  async function saveApprovalSettings(
    nextEnabled = approvalEnabled,
    nextMode = approvalMode,
  ) {
    if (!businessId) return toast.error("No se encontró el negocio");

    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();

    const existingSchedule = (existingRow?.schedule ?? {}) as Record<
      string,
      unknown
    >;

    const { error } = await supabase.from("business_settings").upsert(
      {
        business_id: businessId,
        approval_mode: nextMode,
        schedule: {
          ...existingSchedule,
          _caja: {
            ...((existingSchedule._caja ?? {}) as Record<string, unknown>),
            approvalModeEnabled: nextEnabled,
          },
        },
      },
      { onConflict: "business_id" },
    );

    if (error) return toast.error("Error guardando: " + error.message);
    window.dispatchEvent(new CustomEvent("clippr:caja-settings-updated"));
    toast.success("Guardado");
  }

  function updateApprovalEnabled(value: boolean) {
    setApprovalEnabled(value);
    void saveApprovalSettings(value, approvalMode);
  }

  function updateApprovalMode(value: "auto" | "manual") {
    setApprovalMode(value);
    void saveApprovalSettings(approvalEnabled, value);
  }

  async function compressProfessionalAvatar(file: File): Promise<Blob> {
    const imageUrl = URL.createObjectURL(file);

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("No se pudo leer la imagen"));
        img.src = imageUrl;
      });

      const size = 200;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No se pudo preparar la imagen");

      const sourceSize = Math.min(image.width, image.height);
      const sourceX = Math.max(0, (image.width - sourceSize) / 2);
      const sourceY = Math.max(0, (image.height - sourceSize) / 2);

      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(
        image,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        size,
        size,
      );

      const toBlob = (quality: number) =>
        new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) reject(new Error("No se pudo comprimir la imagen"));
              else resolve(blob);
            },
            "image/webp",
            quality,
          );
        });

      let quality = 0.75;
      let blob = await toBlob(quality);

      while (blob.size > 80 * 1024 && quality > 0.45) {
        quality -= 0.08;
        blob = await toBlob(quality);
      }

      if (blob.size > 80 * 1024) {
        toast.info(
          "La imagen quedó optimizada, pero puede superar levemente los 80 KB por el formato original.",
        );
      }

      return blob;
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }

  async function uploadProfessionalAvatar(file: File) {
    if (!businessId) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Subí una imagen JPG, PNG o WEBP");
      return;
    }

    const compressed = await compressProfessionalAvatar(file);
    const safeId = editingEmp?.id ?? `new-${crypto.randomUUID()}`;
    const path = `${businessId}/${safeId}-${Date.now()}.webp`;

    const { error } = await supabase.storage
      .from("professionals")
      .upload(path, compressed, {
        cacheControl: "3600",
        upsert: true,
        contentType: "image/webp",
      });

    if (error) {
      toast.error("Error subiendo la foto: " + error.message);
      return;
    }

    const { data } = supabase.storage.from("professionals").getPublicUrl(path);
    setForm((current) => ({ ...current, avatarUrl: data.publicUrl }));
    toast.success(
      "Foto comprimida y cargada. Tocá Aceptar y luego Guardar para confirmar.",
    );
  }

  function openNew() {
    setEditingEmp(null);
    setForm(EMPTY_FORM);
    setDlgTab("perfil");
    setOpen(true);
  }

  async function saveEmployeeCommissionConfig(employeeId: string) {
    if (!businessId) return;
    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    const existingSchedule = (existingRow?.schedule ?? {}) as Record<
      string,
      unknown
    >;
    const existingCommissions = (existingSchedule._employeeCommissions ??
      {}) as Record<string, unknown>;

    await supabase.from("business_settings").upsert(
      {
        business_id: businessId,
        schedule: {
          ...existingSchedule,
          _employeeCommissions: {
            ...existingCommissions,
            [employeeId]: form.commissions,
          },
        },
      },
      { onConflict: "business_id" },
    );
  }

  async function saveProfessional() {
    if (!businessId) return;
    const name = form.fullName.trim();
    if (!name) {
      setDlgTab("perfil");
      return toast.error("Ingresá el nombre completo");
    }

    const commission = form.commissionPct ? Number(form.commissionPct) : null;
    const payload = {
      id: editingEmp?.id,
      full_name: name,
      is_active: editingEmp ? editingEmp.is_active !== false : true,
      commission_pct: commission,
      avatar_url: form.avatarUrl || null,
      role: form.role.trim() || "Profesional",
      acceptsOnline: form.acceptsOnline,
      commissions: form.commissions,
      schedule: form.schedule,
      specialDates: form.specialDates,
    };

    if (editingEmp) {
      setRows((current) =>
        current.map((emp) =>
          emp.id === editingEmp.id
            ? {
                ...emp,
                full_name: name,
                commission_pct: commission,
                avatar_url: form.avatarUrl || null,
                role: form.role.trim() || "Profesional",
              }
            : emp,
        ),
      );

      setEmployeeOnlineMap((current) => ({
        ...current,
        [editingEmp.id]: form.acceptsOnline,
      }));

      // Persistencia INMEDIATA del horario individual del profesional, sin
      // depender del "Guardar" de la sección (igual que avatar/portada). Esto
      // garantiza que _employeeSchedules quede en Supabase apenas se acepta.
      try {
        const { data: existingRow } = await supabase
          .from("business_settings")
          .select("schedule")
          .eq("business_id", businessId)
          .maybeSingle();
        const existingSchedule = (existingRow?.schedule ?? {}) as Record<
          string,
          unknown
        >;
        const existingEmpScheds = (existingSchedule._employeeSchedules ??
          {}) as Record<string, unknown>;
        const { error: schedErr } = await supabase
          .from("business_settings")
          .upsert(
            {
              business_id: businessId,
              schedule: {
                ...existingSchedule,
                _employeeSchedules: {
                  ...existingEmpScheds,
                  [editingEmp.id]: form.schedule,
                },
                _employeeSpecialDates: {
                  ...((existingSchedule._employeeSpecialDates ?? {}) as Record<
                    string,
                    unknown
                  >),
                  [editingEmp.id]: form.specialDates,
                },
              },
            },
            { onConflict: "business_id" },
          );
        if (schedErr)
          toast.error(
            "No se pudo guardar el horario del profesional. Probá de nuevo.",
          );
        setEmployeeSchedules((current) => ({
          ...current,
          [editingEmp.id]: form.schedule,
        }));
        setEmployeeSpecialDates((current) => ({
          ...current,
          [editingEmp.id]: form.specialDates,
        }));
      } catch {
        toast.error(
          "No se pudo guardar el horario del profesional. Probá de nuevo.",
        );
      }

      setPendingProfessionals((current) => [
        ...current.filter((item) => item.payload.id !== editingEmp.id),
        { tempId: editingEmp.id, payload, isNew: false },
      ]);

      toast.success(
        "Horario guardado. Tocá Guardar para confirmar los demás cambios.",
      );
      setOpen(false);
      setEditingEmp(null);
      return;
    }

    // Alta INMEDIATA: inserta el empleado y persiste su configuración (horario,
    // rol, comisión, visibilidad) en el momento, sin depender del "Guardar" de
    // la sección. Mismo criterio que la edición.
    setSaving(true);
    try {
      const { data: inserted, error } = await supabase
        .from("employees")
        .insert({
          business_id: businessId,
          full_name: name,
          is_active: true,
          commission_pct: commission,
          avatar_url: form.avatarUrl || null,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        toast.error(
          "Error guardando profesional: " +
            (error?.message ?? "no se pudo crear"),
        );
        setSaving(false);
        return;
      }

      const newId = inserted.id as string;
      const { data: existingRow } = await supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle();
      const existingSchedule = (existingRow?.schedule ?? {}) as Record<
        string,
        unknown
      >;
      const existingCommissions = (existingSchedule._employeeCommissions ??
        {}) as Record<string, unknown>;
      const existingRoles = (existingSchedule._employeeRoles ?? {}) as Record<
        string,
        string
      >;
      const existingEmpScheds = (existingSchedule._employeeSchedules ??
        {}) as Record<string, unknown>;
      const visibility = getPublicVisibility(existingSchedule);
      const employeesVisibility = normalizePublicBooleanMap(
        visibility.employees ?? existingSchedule._employeeOnline,
      );

      const { error: settingsErr } = await supabase
        .from("business_settings")
        .upsert(
          {
            business_id: businessId,
            schedule: {
              ...existingSchedule,
              _employeeCommissions: form.commissions
                ? { ...existingCommissions, [newId]: form.commissions }
                : existingCommissions,
              _employeeRoles: {
                ...existingRoles,
                [newId]: form.role.trim() || "Profesional",
              },
              _employeeSchedules: {
                ...existingEmpScheds,
                [newId]: form.schedule,
              },
              _employeeSpecialDates: {
                ...((existingSchedule._employeeSpecialDates ?? {}) as Record<
                  string,
                  unknown
                >),
                [newId]: form.specialDates,
              },
              _publicVisibility: {
                ...visibility,
                employees: {
                  ...employeesVisibility,
                  [newId]: form.acceptsOnline !== false,
                },
              },
            },
          },
          { onConflict: "business_id" },
        );
      if (settingsErr) {
        toast.error(
          "Profesional creado, pero no se pudo guardar su configuración. Editalo para reintentar.",
        );
      }

      setRows((current) => [
        ...current,
        {
          id: newId,
          full_name: name,
          avatar_url: form.avatarUrl || null,
          role: form.role.trim() || "Profesional",
          is_active: true,
          commission_pct: commission,
        },
      ]);
      setEmployeeOnlineMap((current) => ({
        ...current,
        [newId]: form.acceptsOnline,
      }));
      setEmployeeSchedules((current) => ({
        ...current,
        [newId]: form.schedule,
      }));
      setEmployeeSpecialDates((current) => ({
        ...current,
        [newId]: form.specialDates,
      }));

      toast.success("Profesional agregado.");
      setOpen(false);
    } catch {
      toast.error("No se pudo guardar el profesional. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const toggleActive = useCallback(
    async (emp: EmployeeRow) => {
      const { error } = await supabase
        .from("employees")
        .update({ is_active: !(emp.is_active !== false) })
        .eq("id", emp.id);
      if (error)
        return toast.error(
          "No se pudo actualizar el estado del profesional. Probá de nuevo.",
        );
      load();
    },
    [load],
  );

  const remove = useCallback(async (emp: EmployeeRow) => {
    // Solo bloquean la eliminación los turnos FUTUROS reales (no cancelados y
    // que NO sean bloqueos de horario). El historial pasado, los cancelados y
    // los bloqueos NO bloquean: se desvinculan del profesional al eliminarlo.
    const nowIso = new Date().toISOString();
    const { data: future, error: checkError } = await supabase
      .from("appointments")
      .select("id")
      .eq("employee_id", emp.id)
      .gte("starts_at", nowIso)
      .neq("status", "cancelled")
      .neq("status", "blocked")
      .limit(1);
    if (checkError) {
      toast.error(
        "No se pudo verificar los turnos del profesional. Probá de nuevo.",
      );
      return;
    }
    if (future && future.length > 0) {
      toast.error(
        "No se puede eliminar este profesional porque tiene turnos futuros agendados. Podés marcarlo como inactivo.",
      );
      return;
    }
    setConfirmDel(emp);
  }, []);

  const handleEditPro = useCallback(
    (emp: EmployeeRow) => {
      setEditingEmp(emp);
      setForm({
        ...EMPTY_FORM,
        fullName: emp.full_name ?? emp.name ?? "",
        avatarUrl: emp.avatar_url ?? "",
        commissionPct: String(emp.commission_pct ?? ""),
        role: emp.role ?? "Barbero",
        acceptsOnline: employeeOnlineMap[emp.id] !== false,
        schedule: employeeSchedules[emp.id] ?? EMPTY_FORM.schedule,
        specialDates: employeeSpecialDates[emp.id] ?? {},
      });
      setDlgTab("perfil");
      setOpen(true);
    },
    [employeeOnlineMap, employeeSchedules, employeeSpecialDates],
  );

  async function doRemoveEmp() {
    if (!confirmDel) return;
    const emp = confirmDel;
    setConfirmDel(null);
    setDeletingId(emp.id);

    // La FK appointments.employee_id → employees.id impide borrar un profesional
    // con turnos que lo referencian. Para poder eliminarlo cuando solo tiene
    // historial, desvinculamos (employee_id = null) sus turnos PASADOS y los
    // CANCELADOS (cualquier fecha). Los FUTUROS no cancelados NO se tocan: si
    // existe alguno (p. ej. agendado entre el chequeo y el borrado), la FK
    // bloquea el delete y el backstop de abajo muestra el mensaje correcto.
    const nowIso = new Date().toISOString();
    const detachPast = await supabase
      .from("appointments")
      .update({ employee_id: null })
      .eq("employee_id", emp.id)
      .lt("starts_at", nowIso);
    const detachCancelled = await supabase
      .from("appointments")
      .update({ employee_id: null })
      .eq("employee_id", emp.id)
      .eq("status", "cancelled");
    const detachBlocked = await supabase
      .from("appointments")
      .update({ employee_id: null })
      .eq("employee_id", emp.id)
      .eq("status", "blocked");
    if (detachPast.error || detachCancelled.error || detachBlocked.error) {
      setDeletingId(null);
      toast.error("No se pudo eliminar el profesional. Probá de nuevo.");
      return;
    }

    const { error } = await supabase
      .from("employees")
      .delete()
      .eq("id", emp.id);
    if (error) {
      setDeletingId(null);
      // Backstop por si se agendó un turno FUTURO entre el chequeo y el borrado:
      // nunca mostramos el error técnico de la FK al usuario.
      if (
        error.code === "23503" ||
        /appointments_employee_id_fkey|foreign key/i.test(error.message)
      ) {
        toast.error(
          "No se puede eliminar este profesional porque tiene turnos futuros agendados. Podés marcarlo como inactivo.",
        );
        return;
      }
      toast.error("No se pudo eliminar el profesional. Probá de nuevo.");
      return;
    }
    // Borrado quirúrgico por id en el estado local (sin recargar la página ni
    // re-fetchear toda la lista). Solo desaparece exactamente este profesional.
    setRows((prev) => prev.filter((e) => e.id !== emp.id));
    if (editingEmp?.id === emp.id) {
      setOpen(false);
      setEditingEmp(null);
    }
    setDeletingId(null);
    toast.success("Profesional eliminado.");
  }

  function setDay(key: DayKey, patch: Partial<DaySchedule>) {
    setForm((f) => ({
      ...f,
      schedule: { ...f.schedule, [key]: { ...f.schedule[key], ...patch } },
    }));
  }

  function togglePermission(roleId: RolePermissionId, key: PermissionKey) {
    if (roleId === "admin_general") return;
    setRolePermissions((current) => {
      const nextValue = !current[roleId][key];
      const nextRole = { ...current[roleId], [key]: nextValue };

      if (key === "configuracion" && !nextValue) {
        CONFIG_PERMISSION_ITEMS.forEach((item) => {
          nextRole[item.key] = false;
        });
      }

      if (
        CONFIG_PERMISSION_ITEMS.some((item) => item.key === key) &&
        nextValue
      ) {
        nextRole.configuracion = true;
      }

      return { ...current, [roleId]: nextRole };
    });
  }

  async function saveAccessUser() {
    setAccessTouched(true);
    const selectedEmployee = rows.find(
      (emp) => emp.id === accessForm.employee_id,
    );
    const fallbackName =
      accessForm.role === "profesional"
        ? selectedEmployee?.full_name || selectedEmployee?.name || ""
        : ROLE_LABEL_BY_ID[accessForm.role];
    const name = fallbackName.trim();
    const email = accessForm.email.trim();

    if (accessForm.role === "profesional" && !selectedEmployee) {
      setAccessTouched(true);
      return toast.error("Debés seleccionar un profesional para este acceso.");
    }
    if (!email) return toast.error("Ingresá el correo electrónico");
    if (!businessId) return toast.error("No se pudo determinar el negocio");

    setSaving(true);
    const payload = {
      action: editingAccessUserId ? "update" : "create",
      member_id: editingAccessUserId ?? undefined,
      business_id: businessId,
      email,
      full_name: name,
      role: accessForm.role,
      status:
        editingAccessUserId &&
        accessUsers.find((user) => user.id === editingAccessUserId)?.status ===
          "invited"
          ? "invited"
          : accessForm.status === "inactive"
            ? "suspended"
            : "active",
      professional_id:
        accessForm.role === "profesional"
          ? (selectedEmployee?.id ?? null)
          : null,
      branch_id: accessForm.branch_id ?? null,
      permissions: accessPermissionsForm,
    };

    const { data, error } = await supabase.functions.invoke(
      "invite-team-member",
      {
        body: payload,
      },
    );
    setSaving(false);

    const rawErrMsg =
      error?.message ?? (data as { error?: string } | null)?.error ?? null;
    const friendlyErrMsg = rawErrMsg?.includes("non-2xx status code")
      ? "No se pudo crear el acceso. Revisá si ese correo ya existe o tiene una invitación pendiente."
      : rawErrMsg;
    if (friendlyErrMsg) return toast.error(friendlyErrMsg);

    toast.success(
      editingAccessUserId
        ? "Acceso actualizado correctamente"
        : "Invitación enviada por email",
    );
    setEditingAccessUserId(null);
    setAccessForm(EMPTY_ACCESS_FORM);
    setAccessTouched(false);
    setAccessPermissionsForm(DEFAULT_ROLE_PERMISSIONS.profesional);
    setSelectedPermRole(accessForm.role);
    await loadTeamMembers();
  }

  function editAccessUser(user: AccessUser) {
    setEditingAccessUserId(user.id);
    setAccessForm({
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status === "suspended" ? "inactive" : "active",
      employee_id: user.employee_id ?? null,
      branch_id: user.branch_id ?? null,
    });
    setAccessPermissionsForm(
      userPermissions[user.id] ?? DEFAULT_ROLE_PERMISSIONS[user.role],
    );
    setSelectedPermRole(user.role);
    setSelectedAccessUserId(user.id);
    setAccessTouched(false);
  }

  function cancelEditAccessUser() {
    setEditingAccessUserId(null);
    setAccessForm(EMPTY_ACCESS_FORM);
    setAccessPermissionsForm(DEFAULT_ROLE_PERMISSIONS.profesional);
    setAccessTouched(false);
  }

  async function removeAccessUser(id: string) {
    if (!businessId) return;
    if (id === principalAdminId) {
      setPendingDeleteUser(null);
      return toast.error("El administrador principal no se puede eliminar.");
    }

    setDeletingAccess(true);
    const { data, error } = await supabase.functions.invoke(
      "invite-team-member",
      {
        body: {
          action: "delete",
          business_id: businessId,
          member_id: id,
        },
      },
    );
    setDeletingAccess(false);
    setPendingDeleteUser(null);

    const errMsg =
      error?.message ?? (data as { error?: string } | null)?.error ?? null;
    if (errMsg) return toast.error("Error eliminando acceso: " + errMsg);

    if (selectedAccessUserId === id) setSelectedAccessUserId("");
    if (editingAccessUserId === id) cancelEditAccessUser();
    toast.success("Acceso eliminado");
    await loadTeamMembers();
  }

  // Admin principal = el admin_general más antiguo del negocio (no se puede eliminar).
  const principalAdminId = (() => {
    const admins = accessUsers
      .filter((u) => u.role === "admin_general")
      .slice()
      .sort((a, b) =>
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
      );
    return admins[0]?.id ?? null;
  })();

  function toggleUserPermission(userId: string, key: PermissionKey) {
    const user = accessUsers.find((item) => item.id === userId);
    if (!user) return;

    setUserPermissions((current) => {
      const base = current[userId] ?? DEFAULT_ROLE_PERMISSIONS[user.role];
      const nextValue = !base[key];
      const nextUser = { ...base, [key]: nextValue };

      if (key === "configuracion" && !nextValue) {
        CONFIG_PERMISSION_ITEMS.forEach((item) => {
          nextUser[item.key] = false;
        });
      }

      if (
        CONFIG_PERMISSION_ITEMS.some((item) => item.key === key) &&
        nextValue
      ) {
        nextUser.configuracion = true;
      }

      return { ...current, [userId]: nextUser };
    });
  }

  function getRecommendedPermissionKeys(role: RolePermissionId) {
    return MAIN_PERMISSION_ITEMS.map((i) => i.key).filter(
      (key) => DEFAULT_ROLE_PERMISSIONS[role][key],
    );
  }

  function getAdditionalPermissionKeys(role: RolePermissionId) {
    return MAIN_PERMISSION_ITEMS.map((i) => i.key).filter(
      (key) => !DEFAULT_ROLE_PERMISSIONS[role][key],
    );
  }

  function getPermissionItem(key: PermissionKey) {
    return (
      MAIN_PERMISSION_ITEMS.find((item) => item.key === key) ??
      CONFIG_PERMISSION_ITEMS.find((item) => item.key === key)
    );
  }

  function toggleAccessFormPermission(key: PermissionKey) {
    setAccessPermissionsForm((current) => {
      const next = { ...current, [key]: !current[key] };
      // "Configuración" es un único permiso que habilita/inhabilita todas las
      // subsecciones internas (Branding, Horarios, Equipo, Servicios, Catálogo,
      // Caja, Señas) de una vez.
      if (key === "configuracion") {
        const v = next.configuracion;
        CONFIG_SUB_KEYS.forEach((sub) => {
          next[sub] = v;
        });
      }
      return next;
    });
  }

  function resetSelectedAccessPermissions() {
    if (!selectedAccessUser) return;
    setUserPermissions((current) => ({
      ...current,
      [selectedAccessUser.id]: {
        ...DEFAULT_ROLE_PERMISSIONS[selectedAccessUser.role],
      },
    }));
    toast.success("Permisos recomendados restablecidos");
  }

  const selectedRole =
    ROLE_PERMISSION_OPTIONS.find((role) => role.id === selectedPermRole) ??
    ROLE_PERMISSION_OPTIONS[0];
  const selectedRoleUsers = accessUsers.filter(
    (user) => user.role === selectedPermRole,
  );
  const selectedAccessUser =
    selectedRoleUsers.find((user) => user.id === selectedAccessUserId) ??
    selectedRoleUsers[0] ??
    null;
  const selectedUserPermissions = selectedAccessUser
    ? (userPermissions[selectedAccessUser.id] ??
      DEFAULT_ROLE_PERMISSIONS[selectedAccessUser.role])
    : null;
  const selectedPermissions =
    individualPermMode && selectedUserPermissions
      ? selectedUserPermissions
      : selectedPermRole === "admin_general"
        ? allOnPermissions()
        : rolePermissions[selectedPermRole];
  const selectedRoleLocked = selectedAccessUser?.role === "admin_general";
  const currentPanelTitle =
    individualPermMode && selectedAccessUser
      ? `${selectedAccessUser.name} · ${ROLE_LABEL_BY_ID[selectedAccessUser.role]}`
      : selectedRole.label;
  const accessRoleOption =
    ROLE_PERMISSION_OPTIONS.find((role) => role.id === accessForm.role) ??
    ROLE_PERMISSION_OPTIONS[0];
  const accessRoleSummary = ROLE_ACCESS_SUMMARY[accessForm.role];

  return (
    <>
      <div>
        <h2 className="text-xl font-display font-semibold">Equipo</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Administrá tu equipo.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-white/5">
        {(
          [
            ["pros", "Profesionales"],
            ["users", "Accesos"],
          ] as const
        ).map(([id, label]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "relative px-4 py-2.5 text-sm transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              {active && (
                <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-sky-400 to-violet-500" />
              )}
            </button>
          );
        })}
      </div>

      {tab === "pros" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              onClick={openNew}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-4 py-2.5 text-sm shadow-lg shadow-sky-500/20"
            >
              <Plus className="h-4 w-4" /> Agregar profesional
            </button>
          </div>

          {loading ? (
            <div className="grid place-items-center py-16">
              <ClipprLoader size="screen" delayMs={130} />
            </div>
          ) : rows.length === 0 ? (
            <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
              No hay profesionales cargados. Agregá el primero con el botón de
              arriba.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {rows.map((emp) => (
                <ProfessionalCard
                  key={emp.id}
                  emp={emp}
                  tintClass={tintForId(emp.id)}
                  deleting={deletingId === emp.id}
                  onEdit={handleEditPro}
                  onToggle={toggleActive}
                  onRemove={remove}
                />
              ))}
            </div>
          )}
          <SectionCard label="Aprobación de cobros profesionales">
            <div className="space-y-5">
              <div className="flex items-center gap-4 rounded-2xl bg-white/[0.025] ring-1 ring-white/10 p-4">
                <div className="h-11 w-11 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center shrink-0">
                  <ShieldCheck className="h-5 w-5 text-violet-200" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-base">
                    Habilitar modo de aprobación
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    Definí si los cobros de profesionales se registran directo
                    en Caja o si necesitan revisión.
                  </div>
                </div>
                <Toggle on={approvalEnabled} onChange={updateApprovalEnabled} />
              </div>

              {approvalEnabled && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => updateApprovalMode("auto")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        updateApprovalMode("auto");
                      }
                    }}
                    className={cn(
                      "group text-left rounded-2xl p-5 ring-1 transition-all relative overflow-hidden cursor-pointer",
                      approvalMode === "auto"
                        ? "bg-gradient-to-br from-violet-500/12 via-sky-500/8 to-white/[0.03] ring-violet-300/35 shadow-[0_0_60px_-35px_rgba(139,92,246,0.9)]"
                        : "bg-white/[0.025] ring-white/10 hover:bg-white/[0.045] hover:ring-white/20",
                    )}
                  >
                    <div className="pointer-events-none absolute -right-14 -top-16 h-36 w-36 rounded-full bg-sky-400/10 blur-3xl" />
                    <div className="relative flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                          Modo
                        </div>
                        <div className="mt-1 text-xl font-display font-semibold">
                          Automático
                        </div>
                      </div>
                      {approvalMode === "auto" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-400/10 ring-1 ring-violet-300/25 px-2.5 py-1 text-[11px] font-semibold text-violet-200">
                          Seleccionado
                        </span>
                      )}
                    </div>
                    <p className="relative mt-3 text-sm leading-relaxed text-muted-foreground">
                      El profesional cobra desde su panel y el ingreso se
                      registra automáticamente en Caja.
                    </p>
                    <div className="relative mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAutoApprovalPurpose((v) => !v);
                        }}
                        className="inline-flex items-center gap-2 rounded-full bg-white/[0.055] px-3 py-2 text-xs font-semibold text-white/75 ring-1 ring-white/10 transition hover:bg-white/[0.085] hover:text-white"
                      >
                        <span>💡</span>
                        <span>¿Para qué sirve?</span>
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            showAutoApprovalPurpose && "rotate-180",
                          )}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAutoApprovalExample((v) => !v);
                        }}
                        className="inline-flex items-center gap-2 rounded-full bg-white/[0.055] px-3 py-2 text-xs font-semibold text-white/75 ring-1 ring-white/10 transition hover:bg-white/[0.085] hover:text-white"
                      >
                        <span>❓</span>
                        <span>¿Cómo funciona?</span>
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            showAutoApprovalExample && "rotate-180",
                          )}
                        />
                      </button>
                    </div>

                    {showAutoApprovalPurpose ? (
                      <div className="relative mt-3 rounded-2xl bg-black/15 ring-1 ring-white/10 p-4">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/85">
                          Para qué sirve
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-white/78">
                          Ideal si cada profesional cobra directamente a sus clientes. Permite registrar el pago desde su propio panel, sin depender de la recepción, agilizando el cobro y reduciendo los tiempos de espera.
                        </p>
                      </div>
                    ) : null}

                    {showAutoApprovalExample ? (
                      <div className="relative mt-3 rounded-2xl bg-black/15 ring-1 ring-white/10 p-4">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/85">
                          Ejemplo
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-white/78">
                          Juan finaliza un servicio de $20.000 y registra el cobro
                          desde su panel.
                        </p>
                        <div className="mt-3 space-y-2">
                          <div className="text-sm font-semibold text-white">
                            Resultado:
                          </div>
                          <div className="rounded-xl bg-white/[0.045] px-3 py-2 ring-1 ring-white/10 shadow-[0_14px_35px_-28px_rgba(56,189,248,0.7)]">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-mono text-xs text-white/42">12:00</span>
                              <span className="font-semibold text-white">Juan</span>
                              <span className="text-white/35">→</span>
                              <span className="font-semibold text-emerald-400">Cobró</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => updateApprovalMode("manual")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        updateApprovalMode("manual");
                      }
                    }}
                    className={cn(
                      "group text-left rounded-2xl p-5 ring-1 transition-all relative overflow-hidden cursor-pointer",
                      approvalMode === "manual"
                        ? "bg-gradient-to-br from-violet-500/12 via-sky-500/8 to-white/[0.03] ring-violet-300/35 shadow-[0_0_60px_-35px_rgba(139,92,246,0.9)]"
                        : "bg-white/[0.025] ring-white/10 hover:bg-white/[0.045] hover:ring-white/20",
                    )}
                  >
                    <div className="pointer-events-none absolute -right-14 -top-16 h-36 w-36 rounded-full bg-violet-400/10 blur-3xl" />
                    <div className="relative flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                          Modo
                        </div>
                        <div className="mt-1 text-xl font-display font-semibold">
                          Manual
                        </div>
                      </div>
                      {approvalMode === "manual" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-400/10 ring-1 ring-violet-300/25 px-2.5 py-1 text-[11px] font-semibold text-violet-200">
                          Seleccionado
                        </span>
                      )}
                    </div>
                    <p className="relative mt-3 text-sm leading-relaxed text-muted-foreground">
                      El profesional informa el cobro y Caja lo revisa antes de
                      registrarlo oficialmente.
                    </p>
                    <div className="relative mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowManualApprovalPurpose((v) => !v);
                        }}
                        className="inline-flex items-center gap-2 rounded-full bg-white/[0.055] px-3 py-2 text-xs font-semibold text-white/75 ring-1 ring-white/10 transition hover:bg-white/[0.085] hover:text-white"
                      >
                        <span>💡</span>
                        <span>¿Para qué sirve?</span>
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            showManualApprovalPurpose && "rotate-180",
                          )}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowManualApprovalExample((v) => !v);
                        }}
                        className="inline-flex items-center gap-2 rounded-full bg-white/[0.055] px-3 py-2 text-xs font-semibold text-white/75 ring-1 ring-white/10 transition hover:bg-white/[0.085] hover:text-white"
                      >
                        <span>❓</span>
                        <span>¿Cómo funciona?</span>
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            showManualApprovalExample && "rotate-180",
                          )}
                        />
                      </button>
                    </div>

                    {showManualApprovalPurpose ? (
                      <div className="relative mt-3 rounded-2xl bg-black/15 ring-1 ring-white/10 p-4">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/85">
                          Para qué sirve
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-white/78">
                          Ideal para que profesionales y Caja tengan el mismo control sobre los servicios realizados. Cada servicio se registra desde el panel del profesional y Caja lo aprueba antes de registrarlo oficialmente.
                        </p>
                      </div>
                    ) : null}

                    {showManualApprovalExample ? (
                      <div className="relative mt-3 rounded-2xl bg-black/15 ring-1 ring-white/10 p-4">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/85">
                          Ejemplo
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-white/78">
                          Juan finaliza un servicio de $20.000 y registra el cobro
                          desde su panel.
                        </p>
                        <div className="mt-3 space-y-2">
                          <div className="text-sm font-semibold text-white">
                            Resultado:
                          </div>
                          <div className="rounded-xl bg-white/[0.045] px-3 py-2 ring-1 ring-sky-400/15 shadow-[0_14px_35px_-28px_rgba(56,189,248,0.75)]">
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-mono text-xs text-white/42">12:00</span>
                                <span className="font-semibold text-white">Juan</span>
                                <span className="text-white/35">→</span>
                                <span className="font-semibold text-sky-400">Envió a caja</span>
                              </div>
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-mono text-xs text-white/42">12:01</span>
                                <span className="font-semibold text-white">Caja</span>
                                <span className="text-white/35">→</span>
                                <span className="font-semibold text-emerald-400">Cobró</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      )}

      {tab === "users" && (
        <div className="-mt-2 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-lg font-display font-semibold">
                Accesos del equipo
              </h3>
              <p className="text-sm text-muted-foreground">
                Invitá y administrá quién puede entrar a Clippr.
              </p>
            </div>
            {editingAccessUserId && (
              <div className="rounded-xl bg-cyan-500/10 ring-1 ring-cyan-400/20 px-3 py-2 text-xs text-cyan-200 flex items-center justify-between gap-3">
                <span>Editando: {accessForm.email || "sin email"}</span>
                <button
                  type="button"
                  onClick={cancelEditAccessUser}
                  className="rounded-lg bg-white/10 hover:bg-white/15 px-2 py-1 text-[11px] text-foreground"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[0.78fr_1fr] gap-3">
            <div className="glass rounded-2xl p-4 ring-1 ring-white/5">
              <div className="flex items-center gap-3 mb-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-sky-400/10 ring-1 ring-sky-300/20">
                  <UserPlus className="h-5 w-5 text-sky-300" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Nuevo acceso</div>
                  <div className="text-xs text-muted-foreground">
                    {editingAccessUserId
                      ? "Actualizá el acceso seleccionado."
                      : "Invitá a un profesional o colaborador a Clippr."}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Rol">
                    <select
                      value={accessForm.role}
                      onChange={(e) => {
                        const role = e.target.value as RolePermissionId;
                        setAccessForm((f) => ({
                          ...f,
                          role,
                          name: "",
                          employee_id: null,
                          email: "",
                        }));
                        setAccessPermissionsForm(
                          DEFAULT_ROLE_PERMISSIONS[role],
                        );
                        setAccessTouched(false);
                      }}
                      className={inputCls}
                    >
                      {ROLE_PERMISSION_OPTIONS.filter(
                        (role) => role.id !== "admin_general",
                      ).map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Estado">
                    <select
                      value={accessForm.status}
                      onChange={(e) =>
                        setAccessForm((f) => ({
                          ...f,
                          status: e.target.value as "active" | "inactive",
                        }))
                      }
                      className={inputCls}
                    >
                      <option value="active">Activo</option>
                      <option value="inactive">Inactivo</option>
                    </select>
                  </Field>
                </div>

                {accessForm.role === "profesional" && (
                  <div>
                    <Field label="Profesional">
                      <select
                        value={accessForm.employee_id ?? ""}
                        onChange={(e) =>
                          setAccessForm((f) => ({
                            ...f,
                            employee_id: e.target.value || null,
                          }))
                        }
                        className={cn(
                          inputCls,
                          accessTouched &&
                            !accessForm.employee_id &&
                            "ring-red-500/70 focus:ring-red-500/70",
                        )}
                      >
                        <option value="">Elegí un profesional</option>
                        {rows.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.full_name || emp.name || "Sin nombre"}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {accessTouched && !accessForm.employee_id && (
                      <div className="text-xs text-red-400 mt-1">
                        Debés seleccionar un profesional para este acceso.
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <Field label="Correo electrónico">
                    <input
                      type="email"
                      autoComplete="off"
                      name="clippr-access-email"
                      value={accessForm.email}
                      onChange={(e) =>
                        setAccessForm((f) => ({ ...f, email: e.target.value }))
                      }
                      className={cn(
                        inputCls,
                        accessTouched &&
                          !accessForm.email.trim() &&
                          "ring-red-500/70 focus:ring-red-500/70",
                      )}
                      placeholder="ejemplo@correo.com"
                    />
                  </Field>
                  {accessTouched && !accessForm.email.trim() && (
                    <div className="text-xs text-red-400 mt-1">
                      Campo requerido
                    </div>
                  )}
                </div>

                <div className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 px-3 py-2.5 text-xs text-muted-foreground flex items-start gap-2">
                  <Mail className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                  <span>
                    La persona crea su contraseña desde la invitación que recibe
                    por email.
                  </span>
                </div>

                <button
                  type="button"
                  onClick={saveAccessUser}
                  disabled={saving}
                  className="w-full rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-4 py-2.5 text-sm shadow-lg shadow-sky-500/20 disabled:opacity-60"
                >
                  {saving
                    ? "Procesando…"
                    : editingAccessUserId
                      ? "Guardar cambios"
                      : "Invitar y guardar"}
                </button>
              </div>
            </div>

            <div className="glass rounded-2xl p-4 ring-1 ring-white/5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">
                    Usuarios y accesos
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {accessUsers.length}{" "}
                    {accessUsers.length === 1
                      ? "acceso creado"
                      : "accesos creados"}
                  </div>
                </div>
              </div>

              {accessUsers.length === 0 ? (
                <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-5 text-sm text-muted-foreground text-center">
                  Todavía no hay accesos creados.
                </div>
              ) : (
                <div className="space-y-2">
                  {accessUsers.map((user) => {
                    const displayTitle =
                      user.role === "profesional"
                        ? user.name || ROLE_LABEL_BY_ID[user.role]
                        : ROLE_LABEL_BY_ID[user.role];
                    return (
                    <div
                      key={user.id}
                      className="flex items-center gap-3 rounded-xl bg-white/[0.04] ring-1 ring-white/10 p-3"
                    >
                      <div className="h-9 w-9 rounded-full bg-white/8 ring-1 ring-white/10 grid place-items-center text-xs font-semibold">
                        {(displayTitle[0] || "A").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium ">
                          {displayTitle}
                        </div>
                        <div className="text-xs text-muted-foreground ">
                          {user.email}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2 py-1 text-[10px] ring-1",
                          user.status === "active"
                            ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
                            : user.status === "invited"
                              ? "bg-cyan-500/10 text-cyan-300 ring-cyan-400/20"
                              : "bg-white/5 text-muted-foreground ring-white/10",
                        )}
                      >
                        {user.status === "active"
                          ? "Activo"
                          : user.status === "invited"
                            ? "Pendiente"
                            : "Inactivo"}
                      </span>
                      <button
                        type="button"
                        onClick={() => editAccessUser(user)}
                        className="rounded-lg bg-white/[0.05] hover:bg-white/[0.09] ring-1 ring-white/10 text-foreground px-2.5 py-1.5 text-xs"
                      >
                        Editar
                      </button>
                      {user.id === principalAdminId ? (
                        <span
                          className="rounded-lg bg-white/[0.04] ring-1 ring-white/10 text-muted-foreground px-2.5 py-1.5 text-[10px]"
                          title="El administrador principal no se puede eliminar"
                        >
                          Principal
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteUser(user)}
                          className="rounded-lg bg-red-500/10 hover:bg-red-500/20 ring-1 ring-red-500/30 text-red-300 px-2.5 py-1.5"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}

              <div className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-sm">
                      Permisos incluidos
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Según el rol seleccionado:{" "}
                      {ROLE_LABEL_BY_ID[accessForm.role]}.
                    </div>
                  </div>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-400/10 ring-1 ring-violet-300/20">
                    <ShieldCheck className="h-4.5 w-4.5 text-violet-200" />
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-emerald-400/[0.06] ring-1 ring-emerald-400/15 p-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300/90">
                        Puede acceder
                      </div>
                      <div className="space-y-1.5">
                        {accessRoleSummary.can.map((item) => (
                          <div
                            key={item}
                            className="flex items-center gap-2 text-xs text-white/80"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 p-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                        No accede
                      </div>
                      {accessRoleSummary.cannot.length === 0 ? (
                        <div className="text-xs text-muted-foreground">
                          Sin restricciones.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {accessRoleSummary.cannot.map((item) => (
                            <div
                              key={item}
                              className="flex items-center gap-2 text-xs text-muted-foreground"
                            >
                              <XCircle className="h-3.5 w-3.5 text-white/30" />
                              {item}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <details className="group rounded-xl bg-white/[0.025] ring-1 ring-white/10 overflow-hidden">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold hover:bg-white/[0.04]">
                      <span>Personalizar permisos</span>
                      <span className="text-xs font-medium text-muted-foreground group-open:hidden">
                        Opcional
                      </span>
                      <span className="hidden text-xs font-medium text-muted-foreground group-open:inline">
                        Cerrar
                      </span>
                    </summary>
                    <div className="border-t border-white/5 p-4 space-y-4">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-2">
                          Accesos recomendados
                        </div>
                        <div className="space-y-2">
                          {getRecommendedPermissionKeys(accessForm.role).map(
                            (key) => {
                              const item = getPermissionItem(key);
                              if (!item) return null;
                              const checked = accessPermissionsForm[key];
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() =>
                                    toggleAccessFormPermission(key)
                                  }
                                  className={cn(
                                    "w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ring-1 text-left transition",
                                    checked
                                      ? "bg-white/[0.06] ring-white/15"
                                      : "bg-white/[0.03] ring-white/10 hover:bg-white/[0.06]",
                                  )}
                                >
                                  <div>
                                    <div className="text-sm font-medium">
                                      {item.label}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {item.desc}
                                    </div>
                                  </div>
                                  <span
                                    className={cn(
                                      "h-5 w-5 rounded-full grid place-items-center ring-1",
                                      checked
                                        ? "bg-emerald-400/90 text-white ring-transparent"
                                        : "bg-white/5 ring-white/15",
                                    )}
                                  >
                                    {checked && (
                                      <Check
                                        className="h-3.5 w-3.5"
                                        strokeWidth={3}
                                      />
                                    )}
                                  </span>
                                </button>
                              );
                            },
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-2">
                          Adicionales
                        </div>
                        <div className="space-y-2">
                          {getAdditionalPermissionKeys(accessForm.role).map(
                            (key) => {
                              const item = getPermissionItem(key);
                              if (!item) return null;
                              const checked = accessPermissionsForm[key];
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() =>
                                    toggleAccessFormPermission(key)
                                  }
                                  className={cn(
                                    "w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ring-1 text-left transition",
                                    checked
                                      ? "bg-white/[0.06] ring-white/15"
                                      : "bg-white/[0.03] ring-white/10 hover:bg-white/[0.06]",
                                  )}
                                >
                                  <div>
                                    <div className="text-sm font-medium">
                                      {item.label}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {item.desc}
                                    </div>
                                  </div>
                                  <span
                                    className={cn(
                                      "h-5 w-5 rounded-full grid place-items-center ring-1",
                                      checked
                                        ? "bg-emerald-400/90 text-white ring-transparent"
                                        : "bg-white/5 ring-white/15",
                                    )}
                                  >
                                    {checked && (
                                      <Check
                                        className="h-3.5 w-3.5"
                                        strokeWidth={3}
                                      />
                                    )}
                                  </span>
                                </button>
                              );
                            },
                          )}
                        </div>
                      </div>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteUser && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-[oklch(0.11_0.04_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-xl grid place-items-center bg-red-500/15 ring-1 ring-red-500/30">
                  <Trash2 className="h-5 w-5 text-red-300" />
                </div>
                <h3 className="text-lg font-semibold">¿Eliminar acceso?</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Esta acción eliminará de{" "}
                <span className="text-foreground font-medium">
                  {pendingDeleteUser.name || pendingDeleteUser.email}
                </span>
                :
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 mb-4 list-disc pl-5">
                <li>Usuario</li>
                <li>Permisos</li>
                <li>Historial de acceso</li>
              </ul>
              <p className="text-sm text-red-300/90 mb-5">
                El usuario ya no podrá iniciar sesión.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingDeleteUser(null)}
                  disabled={deletingAccess}
                  className="rounded-xl bg-white/[0.05] hover:bg-white/[0.09] ring-1 ring-white/10 px-4 py-2 text-sm disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => removeAccessUser(pendingDeleteUser.id)}
                  disabled={deletingAccess}
                  className="rounded-xl bg-red-500/90 hover:bg-red-500 text-white font-semibold px-4 py-2 text-sm disabled:opacity-60"
                >
                  {deletingAccess ? "Eliminando…" : "Eliminar acceso"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-zinc-950 ring-1 ring-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 p-4 border-b border-white/5">
              <div className="h-10 w-10 rounded-full overflow-hidden grid place-items-center text-sm font-semibold text-white bg-gradient-to-br from-red-400 to-rose-500 ring-1 ring-white/10">
                {form.avatarUrl ? (
                  <img
                    src={form.avatarUrl}
                    alt={form.fullName || "Profesional"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (form.fullName[0] || "A").toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold">
                  {editingEmp ? "Editar profesional" : "Nuevo profesional"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {form.role || "Barbero"}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full p-1.5 ring-1 ring-white/10 hover:bg-white/5 text-muted-foreground"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center gap-6 px-5 border-b border-white/5">
              {(
                [
                  ["perfil", "Perfil"],
                  ["horarios", "Horarios"],
                  ["comisiones", "Comisiones"],
                ] as const
              ).map(([id, label]) => {
                const active = dlgTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setDlgTab(id)}
                    className={cn(
                      "relative py-3 text-sm transition-colors",
                      active
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                    {active && (
                      <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-sky-400 to-violet-500" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="p-4 space-y-4">
              {dlgTab === "perfil" && (
                <div className="space-y-3">
                  <div className="rounded-2xl bg-white/[0.035] ring-1 ring-white/10 p-4">
                    <div className="flex items-center gap-4">
                      <div className="h-16 w-16 rounded-full overflow-hidden grid place-items-center bg-gradient-to-br from-red-400 to-rose-500 text-white font-semibold text-xl ring-1 ring-white/10">
                        {form.avatarUrl ? (
                          <img
                            src={form.avatarUrl}
                            alt={form.fullName || "Profesional"}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          (form.fullName[0] || "A").toUpperCase()
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold">
                          Foto del profesional
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          JPG, PNG o WEBP. La app la recorta a 200x200, la
                          convierte a WebP y la comprime antes de subirla.
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-white/[0.05] hover:bg-white/[0.09] ring-1 ring-white/10 px-3 py-2 text-xs font-medium">
                            Subir imagen
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void uploadProfessionalAvatar(file);
                                e.currentTarget.value = "";
                              }}
                            />
                          </label>
                          {form.avatarUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setForm({ ...form, avatarUrl: "" })
                              }
                              className="rounded-xl bg-red-500/10 hover:bg-red-500/20 ring-1 ring-red-500/30 px-3 py-2 text-xs text-red-300"
                            >
                              Quitar foto
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <Field label="Nombre completo *">
                    <input
                      value={form.fullName}
                      onChange={(e) =>
                        setForm({ ...form, fullName: e.target.value })
                      }
                      className={inputCls}
                      placeholder="Ej: Alejandro"
                    />
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Teléfono">
                      <input
                        value={form.phone}
                        onChange={(e) =>
                          setForm({ ...form, phone: e.target.value })
                        }
                        className={inputCls}
                        placeholder="11..."
                      />
                    </Field>
                    <Field label="Rol">
                      <input
                        value={form.role}
                        onChange={(e) =>
                          setForm({ ...form, role: e.target.value })
                        }
                        className={inputCls}
                        placeholder="Barbero"
                      />
                    </Field>
                  </div>
                  <label className="flex items-center gap-3 rounded-xl bg-white/5 ring-1 ring-white/10 p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.acceptsOnline}
                      onChange={(e) =>
                        setForm({ ...form, acceptsOnline: e.target.checked })
                      }
                      className="sr-only"
                    />
                    <span
                      className={cn(
                        "h-5 w-9 rounded-full relative transition-colors shrink-0",
                        form.acceptsOnline ? "bg-primary" : "bg-white/15",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                          form.acceptsOnline ? "left-[18px]" : "left-0.5",
                        )}
                      />
                    </span>
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        Acepta reservas en línea
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Este profesional aparecerá disponible para reservas
                        online
                      </div>
                    </div>
                  </label>
                  <Field label="Descripción (opcional)">
                    <textarea
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                      className={cn(inputCls, "min-h-[90px] resize-y")}
                      placeholder="Especialidades, experiencia, estilo…"
                    />
                  </Field>
                </div>
              )}

              {dlgTab === "horarios" && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Días desactivados no recibirán turnos.
                  </p>
                  {WEEKDAYS.map(([key, label]) => {
                    const d = form.schedule[key];
                    return (
                      <div
                        key={key}
                        className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3"
                      >
                        <div className="flex items-center gap-3 flex-wrap">
                          <button
                            onClick={() => setDay(key, { enabled: !d.enabled })}
                            className={cn(
                              "h-5 w-9 rounded-full relative transition-colors shrink-0",
                              d.enabled ? "bg-primary" : "bg-white/15",
                            )}
                          >
                            <span
                              className={cn(
                                "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                                d.enabled ? "left-[18px]" : "left-0.5",
                              )}
                            />
                          </button>
                          <div className="text-sm font-medium w-20">
                            {label}
                          </div>
                          {d.enabled && (
                            <>
                              <input
                                type="time"
                                value={d.start}
                                onChange={(e) =>
                                  setDay(key, { start: e.target.value })
                                }
                                className={timeCls}
                              />
                              <span className="text-muted-foreground text-xs">
                                a
                              </span>
                              <input
                                type="time"
                                value={d.end}
                                onChange={(e) =>
                                  setDay(key, { end: e.target.value })
                                }
                                className={timeCls}
                              />
                              <div className="text-xs text-muted-foreground ml-2">
                                Descanso:
                              </div>
                              <input
                                type="time"
                                value={d.breakStart}
                                onChange={(e) =>
                                  setDay(key, { breakStart: e.target.value })
                                }
                                className={timeCls}
                              />
                              <span className="text-muted-foreground text-xs">
                                -
                              </span>
                              <input
                                type="time"
                                value={d.breakEnd}
                                onChange={(e) =>
                                  setDay(key, { breakEnd: e.target.value })
                                }
                                className={timeCls}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <SpecialHoursEditor
                    value={form.specialDates}
                    onChange={(next) =>
                      setForm((f) => ({ ...f, specialDates: next }))
                    }
                    allowBreak
                    closedLabel="No disponible"
                    title="Horario especial"
                    description="Un día distinto al horario normal (ej. 24/12 09:00–15:00) o no disponible una fecha."
                  />
                </div>
              )}

              {dlgTab === "comisiones" && (
                <div className="space-y-5">
                  <div className="rounded-2xl bg-white/[0.035] ring-1 ring-white/10 p-4">
                    <div className="font-semibold text-sm">
                      Comisiones y servicios que realiza
                    </div>
                  </div>

                  {(["servicios", "catalogo"] as const).map((kind) => {
                    const isServiceKind = kind === "servicios";
                    const filtered = commissionItems.filter((item) =>
                      isServiceKind
                        ? item.duration_min != null
                        : item.duration_min == null,
                    );
                    const grouped = filtered.reduce(
                      (acc, item) => {
                        const category =
                          item.category ||
                          (isServiceKind ? "Servicios" : "Productos");
                        if (!acc[category]) acc[category] = [];
                        acc[category].push(item);
                        return acc;
                      },
                      {} as Record<string, PriceRow[]>,
                    );

                    return (
                      <div
                        key={kind}
                        className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 overflow-hidden"
                      >
                        <div className="px-4 py-3 border-b border-white/5">
                          <div className="text-sm font-semibold">
                            {isServiceKind ? "Servicios" : "Catálogo"}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {isServiceKind
                              ? "Servicios cargados en Configuración → Servicios."
                              : "Productos cargados en Configuración → Catálogo."}
                          </div>
                        </div>

                        {Object.keys(grouped).length === 0 ? (
                          <div className="p-4 text-sm text-muted-foreground">
                            No hay {isServiceKind ? "servicios" : "productos"}{" "}
                            cargados.
                          </div>
                        ) : (
                          <div className="divide-y divide-white/5">
                            {Object.entries(grouped).map(
                              ([category, items]) => (
                                <div key={category} className="p-4 space-y-3">
                                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                                    {category}
                                  </div>
                                  <div className="space-y-2">
                                    {items.map((item) => {
                                      const cfg = form.commissions[item.id] ?? {
                                        enabled: false,
                                        mode: "percent" as CommissionMode,
                                        value: "",
                                      };
                                      const updateCfg = (
                                        patch: Partial<CommissionConfig>,
                                      ) =>
                                        setForm({
                                          ...form,
                                          commissions: {
                                            ...form.commissions,
                                            [item.id]: { ...cfg, ...patch },
                                          },
                                        });

                                      return (
                                        <div
                                          key={item.id}
                                          className={cn(
                                            "rounded-xl ring-1 p-3 transition-all",
                                            cfg.enabled
                                              ? "bg-white/[0.06] ring-white/10"
                                              : "bg-white/[0.025] ring-white/5 opacity-75",
                                          )}
                                        >
                                          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                updateCfg({
                                                  enabled: !cfg.enabled,
                                                })
                                              }
                                              className={cn(
                                                "h-6 w-11 rounded-full relative transition-colors shrink-0",
                                                cfg.enabled
                                                  ? "bg-primary"
                                                  : "bg-white/15",
                                              )}
                                            >
                                              <span
                                                className={cn(
                                                  "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                                                  cfg.enabled
                                                    ? "left-[22px]"
                                                    : "left-0.5",
                                                )}
                                              />
                                            </button>

                                            <div className="flex-1 min-w-0">
                                              <div className="text-sm font-medium ">
                                                {item.name}
                                              </div>
                                              <div className="text-xs text-muted-foreground">
                                                $
                                                {Number(
                                                  item.price ?? 0,
                                                ).toLocaleString("es-AR")}
                                                {isServiceKind &&
                                                item.duration_min
                                                  ? ` · ${item.duration_min} min`
                                                  : ""}
                                              </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                              <select
                                                value={cfg.mode}
                                                disabled={!cfg.enabled}
                                                onChange={(e) =>
                                                  updateCfg({
                                                    mode: e.target
                                                      .value as CommissionMode,
                                                  })
                                                }
                                                className="rounded-lg bg-white/5 ring-1 ring-white/10 px-2 py-1.5 text-xs focus:outline-none disabled:opacity-50"
                                              >
                                                <option value="percent">
                                                  % comisión
                                                </option>
                                                <option value="fixed">
                                                  Monto fijo
                                                </option>
                                              </select>
                                              <div className="flex items-center gap-1 rounded-lg bg-white/5 ring-1 ring-white/10 px-2 py-1.5">
                                                <input
                                                  type="number"
                                                  min={0}
                                                  disabled={!cfg.enabled}
                                                  value={cfg.value}
                                                  onChange={(e) =>
                                                    updateCfg({
                                                      value: e.target.value,
                                                    })
                                                  }
                                                  className="w-20 bg-transparent text-sm text-right focus:outline-none disabled:opacity-50"
                                                  placeholder="0"
                                                />
                                                <span className="text-xs text-muted-foreground">
                                                  {cfg.mode === "percent"
                                                    ? "%"
                                                    : "$"}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ),
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 p-4 border-t border-white/5">
              {editingEmp ? (
                <button
                  type="button"
                  onClick={() => setConfirmDel(editingEmp)}
                  disabled={saving || deletingId === editingEmp.id}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-300 ring-1 ring-red-500/30 transition hover:bg-red-500/20 disabled:opacity-50"
                >
                  {deletingId === editingEmp.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Eliminar
                </button>
              ) : null}
              <div className="flex-1" />
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                className="rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-4 py-2.5 text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={saveProfessional}
                disabled={saving}
                className="inline-flex min-w-[160px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-4 py-2.5 text-sm disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmDel}
        title="Eliminar profesional"
        message={`¿Deseás eliminar a "${confirmDel?.full_name ?? confirmDel?.name}"?`}
        onConfirm={doRemoveEmp}
        onCancel={() => setConfirmDel(null)}
      />
    </>
  );
}

// ─────────── Servicios y Catálogo ───────────
type PriceRow = {
  id: string;
  name: string;
  price: number;
  duration_min: number | null;
  category: string | null;
  active: boolean | null;
  stock?: number | null;
  cash_discount?: number | null;
};

type PriceForm = {
  name: string;
  price: string;
  discount: string;
  duration: string;
  status: "Activo" | "Inactivo";
  category: string;
  description: string;
  reservable: boolean;
  stock: string;
  warnStock: string;
  criticalStock: string;
  // Reservas online (solo catálogo)
  bookingShow: boolean;
  bookingOffer: string;
  miniDesc: string;
  // Imagen general (catálogo y servicios)
  image: string;
  imagePosition: string;
};

const emptyPriceForm = (
  category = "Servicios",
  isService = true,
): PriceForm => ({
  name: "",
  price: "0",
  discount: "0",
  duration: isService ? "30" : "",
  status: "Activo",
  category,
  description: "",
  reservable: true,
  stock: "0",
  warnStock: "0",
  criticalStock: "0",
  bookingShow: false,
  bookingOffer: "none",
  miniDesc: "",
  image: "",
  imagePosition: "50% 50%",
});

const defaultServiceCategories: string[] = [];
const serviceCategories = defaultServiceCategories;
const defaultCatalogCategories = ["Productos", "Bebidas", "Indumentaria"];

// ─────────── Indicador de guardado discreto ───────────
// Reemplaza los toasts de "Guardado" para autoguardados. Cada guardado en
// segundo plano dispara este evento en vez de toast.success/toast.error;
// SaveStatusIndicator (montado una sola vez en SettingsPage) lo escucha y
// muestra "Guardando…" / "Guardado" abajo a la derecha, desapareciendo solo.

function SaveStatusIndicator() {
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        { status?: "saving" | "saved" } | undefined;
      if (!detail?.status) return;
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setStatus(detail.status);
      if (detail.status === "saved") {
        hideTimerRef.current = window.setTimeout(() => setStatus("idle"), 1600);
      }
    };
    window.addEventListener("clippr:save-status", handler);
    return () => {
      window.removeEventListener("clippr:save-status", handler);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (status === "idle") return null;

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-xs text-white/80 ring-1 ring-white/10 backdrop-blur-sm animate-fade-up">
      {status === "saving" ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Guardando…
        </>
      ) : (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          Guardado
        </>
      )}
    </div>
  );
}

function markSettingsDirty() {
  // Configuración guarda automáticamente o mediante botones propios de cada panel.
  // No disparamos más el estado global de "cambios sin guardar" para evitar
  // el modal al cambiar de sección/cerrar editores.
}


function priceToCash(price: string, discount: string) {
  const p = Number(price) || 0;
  const d = Number(discount) || 0;
  return Math.max(0, Math.round(p - (p * d) / 100));
}

function rowToForm(row: PriceRow, isService: boolean): PriceForm {
  return {
    name: row.name ?? "",
    price: String(row.price ?? 0),
    discount: String(row.cash_discount ?? 0), // ← read real value
    duration: row.duration_min
      ? String(row.duration_min)
      : isService
        ? "30"
        : "",
    status: row.active === false ? "Inactivo" : "Activo",
    category: row.category || (isService ? "Servicios" : "Productos"),
    description: "",
    reservable: true,
    stock: String(row.stock ?? 0),
    warnStock: "0",
    criticalStock: "0",
    bookingShow: false,
    bookingOffer: "none",
    miniDesc: "",
    image: "",
    imagePosition: "50% 50%",
  };
}


function clampImagePositionValue(value: number) {
  return Math.max(0, Math.min(100, value));
}

function parseImagePosition(position?: string | null): { x: number; y: number } {
  const fallback = { x: 50, y: 50 };
  if (!position) return fallback;
  const [xRaw, yRaw] = position.split(/\s+/);
  const x = Number(String(xRaw ?? "").replace("%", ""));
  const y = Number(String(yRaw ?? "").replace("%", ""));
  return {
    x: Number.isFinite(x) ? clampImagePositionValue(x) : fallback.x,
    y: Number.isFinite(y) ? clampImagePositionValue(y) : fallback.y,
  };
}

/**
 * Geometría real del recorte: a partir del tamaño natural de la foto y el
 * tamaño real del marco, calcula cuánto "sobra" de imagen (overflow) en cada
 * eje una vez aplicado object-fit: cover. Ese sobrante es el único rango
 * válido de arrastre — no un porcentaje inventado.
 */
type CropGeometry = {
  scale: number;
  scaledW: number;
  scaledH: number;
  overflowX: number;
  overflowY: number;
};

function computeCropGeometry(
  container: { w: number; h: number },
  natural: { w: number; h: number },
): CropGeometry | null {
  if (!container.w || !container.h || !natural.w || !natural.h) return null;
  const scale = Math.max(container.w / natural.w, container.h / natural.h);
  const scaledW = natural.w * scale;
  const scaledH = natural.h * scale;
  return {
    scale,
    scaledW,
    scaledH,
    overflowX: Math.max(0, scaledW - container.w),
    overflowY: Math.max(0, scaledH - container.h),
  };
}

// object-position "X% Y%" <-> transform: translate(x px, y px) real, según la geometría.
function offsetToTranslate(position: string, geometry: CropGeometry) {
  const { x: px, y: py } = parseImagePosition(position);
  return {
    x: -geometry.overflowX * (px / 100),
    y: -geometry.overflowY * (py / 100),
  };
}

function translateToOffset(translate: { x: number; y: number }, geometry: CropGeometry) {
  const x = geometry.overflowX > 0 ? clampImagePositionValue((-translate.x / geometry.overflowX) * 100) : 50;
  const y = geometry.overflowY > 0 ? clampImagePositionValue((-translate.y / geometry.overflowY) * 100) : 50;
  // Redondeo a 1 decimal: precisión de sobra para el recorte, strings más cortos para persistir.
  return `${Math.round(x * 10) / 10}% ${Math.round(y * 10) / 10}%`;
}

function clampTranslate(translate: { x: number; y: number }, geometry: CropGeometry) {
  return {
    x: Math.max(-geometry.overflowX, Math.min(0, translate.x)),
    y: Math.max(-geometry.overflowY, Math.min(0, translate.y)),
  };
}

/**
 * Editor de imagen tipo Instagram / Mercado Libre: el marco nunca se mueve,
 * solo la fotografía, arrastrada con transform: translate() y con límites
 * calculados con el tamaño real de la imagen y del marco (no con porcentajes
 * fijos). Se puede llevar hasta los bordes reales de la foto, sin rebote.
 */
function DraggableImageCrop({
  src,
  alt,
  value,
  onChange,
  onPickImage,
  className,
}: {
  src: string;
  alt: string;
  value: string;
  onChange: (value: string) => void;
  onPickImage?: () => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const initializedForRef = useRef<string>("");

  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startTranslateX: number;
    startTranslateY: number;
  } | null>(null);

  // Mide el marco real (no un porcentaje asumido) y reacciona si cambia de tamaño.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ w: rect.width, h: rect.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Si la imagen ya está cargada desde caché al montar, captura su tamaño natural igual.
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth) {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }, [src]);

  const geometry = useMemo(
    () => computeCropGeometry(containerSize, naturalSize),
    [containerSize, naturalSize],
  );

  // Al cambiar de foto (o apenas se conoce la geometría real por primera vez),
  // arranca desde la posición guardada — nunca recentra si ya había una guardada.
  useEffect(() => {
    if (!geometry) return;
    const key = `${src}|${Math.round(geometry.scaledW)}x${Math.round(geometry.scaledH)}`;
    if (initializedForRef.current === key) return;
    initializedForRef.current = key;
    setTranslate(clampTranslate(offsetToTranslate(value, geometry), geometry));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, src]);

  const applyTranslate = (next: { x: number; y: number }) => {
    if (!geometry) return;
    const clamped = clampTranslate(next, geometry);
    setTranslate(clamped);
    return clamped;
  };

  const commit = (next: { x: number; y: number }) => {
    if (!geometry) return;
    onChange(translateToOffset(next, geometry));
  };

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        role="button"
        tabIndex={0}
        className={cn(
          "relative aspect-square w-full cursor-grab touch-none select-none overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10 active:cursor-grabbing",
          dragging && "ring-2 ring-primary/50",
          className,
        )}
        title="Arrastrá la imagen para acomodarla"
        onPointerDown={(event) => {
          if (!geometry) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          dragRef.current = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startTranslateX: translate.x,
            startTranslateY: translate.y,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || !geometry) return;
          // 1:1 real: la foto acompaña el cursor/dedo exactamente, sin multiplicadores artificiales.
          const dx = event.clientX - drag.startClientX;
          const dy = event.clientY - drag.startClientY;
          applyTranslate({ x: drag.startTranslateX + dx, y: drag.startTranslateY + dy });
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          dragRef.current = null;
          setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          if (!drag || !geometry) return;
          const dx = event.clientX - drag.startClientX;
          const dy = event.clientY - drag.startClientY;
          const final = applyTranslate({ x: drag.startTranslateX + dx, y: drag.startTranslateY + dy });
          if (final) commit(final);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onDoubleClick={onPickImage}
        onKeyDown={(event) => {
          if (!geometry) return;
          const step = 12; // px reales por pulsación de flecha
          let next = translate;
          if (event.key === "ArrowLeft") next = { x: translate.x + step, y: translate.y };
          else if (event.key === "ArrowRight") next = { x: translate.x - step, y: translate.y };
          else if (event.key === "ArrowUp") next = { x: translate.x, y: translate.y + step };
          else if (event.key === "ArrowDown") next = { x: translate.x, y: translate.y - step };
          else if (event.key === "Enter" && onPickImage) return onPickImage();
          else return;
          event.preventDefault();
          const clamped = applyTranslate(next);
          if (clamped) commit(clamped);
        }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          loading="lazy"
          onLoad={(event) => {
            const img = event.currentTarget;
            setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
          }}
          style={
            geometry
              ? {
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: geometry.scaledW,
                  height: geometry.scaledH,
                  maxWidth: "none",
                  transform: `translate(${translate.x}px, ${translate.y}px)`,
                  willChange: "transform",
                }
              : {
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: value,
                }
          }
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>Arrastrá la imagen para acomodarla.</span>
        <button
          type="button"
          className="font-medium text-white/75 transition hover:text-white"
          onClick={() => {
            if (!geometry) return onChange("50% 50%");
            const centered = { x: -geometry.overflowX / 2, y: -geometry.overflowY / 2 };
            setTranslate(centered);
            commit(centered);
          }}
        >
          Centrar
        </button>
      </div>
    </div>
  );
}

function PriceEditorModal({
  open,
  mode,
  isService,
  form,
  setForm,
  onClose,
  onSave,
  onDelete,
  saving,
  catalogCategories = defaultCatalogCategories,
  onUploadImage,
  featuredOthers = 0,
}: {
  open: boolean;
  mode: "new" | "edit";
  isService: boolean;
  form: PriceForm;
  setForm: (form: PriceForm) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
  catalogCategories?: string[];
  onUploadImage?: (file: File) => Promise<string | null>;
  featuredOthers?: number;
}) {
  const [uploadingImg, setUploadingImg] = useState(false);
  const bookingFileRef = useRef<HTMLInputElement | null>(null);
  if (!open) return null;
  const cashPrice = priceToCash(form.price, form.discount);
  const title = `${mode === "edit" ? "Editar" : "Nuevo"} ${isService ? "servicio" : "producto"}`;
  const availableCatalogCategories = Array.from(
    new Set([...(form.category ? [form.category] : []), ...catalogCategories]),
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-[oklch(0.12_0.02_275)] ring-1 ring-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-white/5"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3">
          {isService ? (
            <>
              {/* Servicio · información básica + imagen en una fila */}
              <SectionCard label="Información básica">
                <div className="flex gap-3">
                  <div className="min-w-0 flex-1 space-y-3">
                    <Field label="Nombre del servicio">
                      <input
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className={inputCls}
                        placeholder="Corte + Barba"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Precio de lista">
                        <input
                          type="number"
                          value={form.price}
                          onChange={(e) => setForm({ ...form, price: e.target.value })}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Desc. efectivo (%)">
                        <input
                          type="number"
                          value={form.discount}
                          onChange={(e) => setForm({ ...form, discount: e.target.value })}
                          className={inputCls}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Duración (min)">
                        <input
                          type="number"
                          min={0}
                          value={form.duration}
                          onChange={(e) => setForm({ ...form, duration: e.target.value })}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Categoría">
                        <select
                          value={form.category}
                          onChange={(e) => setForm({ ...form, category: e.target.value })}
                          className={inputCls}
                        >
                          {availableCatalogCategories.map((category) => (
                            <option key={category}>{category}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Estado">
                        <select
                          value={form.status}
                          onChange={(e) =>
                            setForm({ ...form, status: e.target.value as PriceForm["status"] })
                          }
                          className={inputCls}
                        >
                          <option>Activo</option>
                          <option>Inactivo</option>
                        </select>
                      </Field>
                    </div>
                  </div>

                  {/* Imagen del servicio */}
                  <div className="w-28 shrink-0 sm:w-32">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-1.5">
                      Imagen del servicio
                    </div>
                    <div className="relative">
                      <input
                        ref={bookingFileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file || !onUploadImage) return;
                          setUploadingImg(true);
                          const url = await onUploadImage(file);
                          setUploadingImg(false);
                          if (url) setForm({ ...form, image: url, imagePosition: "50% 50%" });
                        }}
                      />
                      {form.image ? (
                        <DraggableImageCrop
                          src={form.image}
                          alt={form.name || "Servicio"}
                          value={form.imagePosition}
                          onChange={(imagePosition) => setForm({ ...form, imagePosition })}
                          onPickImage={() => bookingFileRef.current?.click()}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => bookingFileRef.current?.click()}
                          disabled={uploadingImg}
                          className="grid aspect-square w-full place-items-center overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-50"
                        >
                          {uploadingImg ? (
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          ) : (
                            <span className="flex flex-col items-center gap-1 text-muted-foreground/80">
                              <Upload className="h-5 w-5" />
                              <span className="text-[11px]">Subir imagen</span>
                            </span>
                          )}
                        </button>
                      )}
                      {form.image ? (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, image: "", imagePosition: "50% 50%" })}
                          disabled={uploadingImg}
                          className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-red-500 text-white shadow-lg disabled:opacity-50"
                          title="Quitar imagen"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>

                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Efectivo:{" "}
                  <span className="font-semibold text-[oklch(0.82_0.14_75)]">
                    ${cashPrice.toLocaleString("es-AR")}
                  </span>
                </p>
              </SectionCard>

              <SectionCard label="Reserva online">
                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <div className="text-sm font-medium">Se puede reservar online</div>
                  <Toggle
                    on={form.reservable}
                    onChange={(v) => setForm({ ...form, reservable: v })}
                  />
                </label>
              </SectionCard>

              <SectionCard label="Descripción">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={cn(inputCls, "min-h-[72px] resize-y")}
                  placeholder="Detalles del servicio (opcional)"
                />
              </SectionCard>
            </>
          ) : (
            <>
              {/* Producto · básica + imagen en una fila */}
              <SectionCard label="Información básica">
                <div className="flex gap-3">
                  <div className="min-w-0 flex-1 space-y-3">
                    <Field label="Nombre">
                      <input
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className={inputCls}
                        placeholder="Nombre del producto"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Precio de lista">
                        <input
                          type="number"
                          value={form.price}
                          onChange={(e) => setForm({ ...form, price: e.target.value })}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Desc. efectivo (%)">
                        <input
                          type="number"
                          value={form.discount}
                          onChange={(e) => setForm({ ...form, discount: e.target.value })}
                          className={inputCls}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Categoría">
                        <select
                          value={form.category}
                          onChange={(e) => setForm({ ...form, category: e.target.value })}
                          className={inputCls}
                        >
                          {availableCatalogCategories.map((category) => (
                            <option key={category}>{category}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Estado">
                        <select
                          value={form.status}
                          onChange={(e) =>
                            setForm({ ...form, status: e.target.value as PriceForm["status"] })
                          }
                          className={inputCls}
                        >
                          <option>Activo</option>
                          <option>Inactivo</option>
                        </select>
                      </Field>
                    </div>
                  </div>

                  {/* Imagen del producto */}
                  <div className="w-28 shrink-0 sm:w-32">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-1.5">
                      Imagen del producto
                    </div>
                    <div className="relative">
                      <input
                        ref={bookingFileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file || !onUploadImage) return;
                          setUploadingImg(true);
                          const url = await onUploadImage(file);
                          setUploadingImg(false);
                          if (url) setForm({ ...form, image: url, imagePosition: "50% 50%" });
                        }}
                      />
                      {form.image ? (
                        <DraggableImageCrop
                          src={form.image}
                          alt={form.name || "Producto"}
                          value={form.imagePosition}
                          onChange={(imagePosition) => setForm({ ...form, imagePosition })}
                          onPickImage={() => bookingFileRef.current?.click()}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => bookingFileRef.current?.click()}
                          disabled={uploadingImg}
                          className="grid aspect-square w-full place-items-center overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-50"
                        >
                          {uploadingImg ? (
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          ) : (
                            <span className="flex flex-col items-center gap-1 text-muted-foreground/80">
                              <Upload className="h-5 w-5" />
                              <span className="text-[11px]">Subir imagen</span>
                            </span>
                          )}
                        </button>
                      )}
                      {form.image ? (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, image: "", imagePosition: "50% 50%" })}
                          disabled={uploadingImg}
                          className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-red-500 text-white shadow-lg disabled:opacity-50"
                          title="Quitar imagen"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>

                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Efectivo:{" "}
                  <span className="font-semibold text-[oklch(0.82_0.14_75)]">
                    ${cashPrice.toLocaleString("es-AR")}
                  </span>
                </p>
              </SectionCard>

              {/* Reservas online */}
              <SectionCard label="Reservas online">
                <div className="space-y-3">
                  {(() => {
                    const featuredTotal = featuredOthers + (form.bookingShow ? 1 : 0);
                    const limitReached = !form.bookingShow && featuredOthers >= 3;
                    return (
                      <>
                        <label className="flex items-center justify-between gap-4 cursor-pointer">
                          <div>
                            <div className="text-sm font-medium">Mostrar en reservas online</div>
                            <div className="text-xs text-muted-foreground">Aparece en reserva online.</div>
                          </div>
                          <Toggle
                            on={form.bookingShow}
                            onChange={(v) => {
                              if (v && limitReached) return;
                              setForm({ ...form, bookingShow: v });
                            }}
                          />
                        </label>
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                          <span className="font-medium text-muted-foreground">
                            Productos destacados: {featuredTotal} de 3
                          </span>
                          {limitReached ? (
                            <span className="text-amber-300">Solo podés destacar hasta 3 productos.</span>
                          ) : null}
                        </div>
                      </>
                    );
                  })()}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Oferta %">
                      <input
                        type="number"
                        min={0}
                        max={90}
                        value={form.bookingOffer === "none" || form.bookingOffer === "special" ? "" : form.bookingOffer}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            bookingOffer: e.target.value.trim() ? e.target.value : "none",
                          })
                        }
                        className={inputCls}
                        placeholder="20"
                      />
                    </Field>
                    <Field label="Mini descripción">
                      <input
                        value={form.miniDesc}
                        onChange={(e) => setForm({ ...form, miniDesc: e.target.value })}
                        className={inputCls}
                        maxLength={60}
                        placeholder="Fijación fuerte y acabado mate natural."
                      />
                    </Field>
                  </div>
                </div>
              </SectionCard>

              {/* Stock compacto */}
              <SectionCard label="Stock">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">Actual</div>
                    <input
                      type="number"
                      value={form.stock}
                      onChange={(e) => setForm({ ...form, stock: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-amber-300/80">Aviso</div>
                    <input
                      type="number"
                      value={form.warnStock}
                      onChange={(e) => setForm({ ...form, warnStock: e.target.value })}
                      className={cn(inputCls, "ring-1 ring-amber-400/20 focus:ring-amber-400/40")}
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-red-400/80">Crítico</div>
                    <input
                      type="number"
                      value={form.criticalStock}
                      onChange={(e) => setForm({ ...form, criticalStock: e.target.value })}
                      className={cn(inputCls, "ring-1 ring-red-500/20 focus:ring-red-500/40")}
                    />
                  </div>
                </div>
              </SectionCard>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-white/5">
          {mode === "edit" && onDelete && (
          <button
            onClick={onDelete}
            disabled={saving}
            className="rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 ring-1 ring-red-500/20 px-4 py-2.5 text-sm">
            Eliminar
          </button>)}
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-4 py-2.5 text-sm">
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex-1 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-4 py-2.5 text-sm disabled:opacity-50"
          >
            {saving
              ? "Guardando…"
              : `Guardar ${isService ? "servicio" : "producto"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function PriceCatalogSection({ kind }: { kind: "servicios" | "catalogo" }) {
  const isService = kind === "servicios";
  const { businessId } = useAuth();
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [serviceReservableMap, setServiceReservableMap] = useState<
    Record<string, boolean>
  >({});
  // Reservas online del catálogo: { [productId]: { show, offer, miniDesc } }
  const [bookingConfig, setBookingConfig] = useState<
    Record<string, { show: boolean; offer: string; miniDesc?: string }>
  >({});
  // Imagen general por item (servicios y productos): { [id]: url }
  const [imageMap, setImageMap] = useState<Record<string, string>>({});
  // Posición del recorte de cada imagen: { [id]: "50% 50%" }
  const [imagePositionMap, setImagePositionMap] = useState<Record<string, string>>({});
  // `ready` se setea UNA sola vez, con el primer (y único) fetch combinado de
  // items + categorías. A diferencia del esquema anterior (loading +
  // categoriesLoading + initialCategoryReady derivados en cada render), acá
  // nunca vuelve a false: un refresh en segundo plano (realtime, evento de
  // guardado, etc.) actualiza los datos in-place sin volver a tapar el panel
  // con el loader, que es lo que producía el "doble render" visible.
  const [ready, setReady] = useState(false);
  const activeCatStorageKey = React.useMemo(
    () => `clippr:${businessId ?? "local"}:${isService ? "servicios" : "catalogo"}:active-category`,
    [businessId, isService],
  );
  const [cat, setCat] = useState<string>(() => {
    if (typeof window === "undefined") return isService ? "" : "Productos";
    return window.localStorage.getItem(activeCatStorageKey) || (isService ? "" : "Productos");
  });
  const reorderingCategories = true;
  const [draggedCategory, setDraggedCategory] = useState<string | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PriceRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PriceForm>(
    emptyPriceForm(isService ? "Servicios" : "Productos", isService),
  );
  const [confirmDelItem, setConfirmDelItem] = useState<PriceRow | null>(null);
  // Pending changes — written to Supabase only when global Save is pressed
  type PendingItem = {
    tempId: string;
    payload: Record<string, unknown>;
    isNew: boolean;
  };
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [confirmDelCat, setConfirmDelCat] = useState<string | null>(null);
  const [customCatalogCategories, setCustomCatalogCategories] = useState<
    string[]
  >(defaultCatalogCategories);
  const [customServiceCategories, setCustomServiceCategories] = useState<
    string[]
  >(defaultServiceCategories);

  // Carga inicial: items (price_catalog) + categorías/config (business_settings)
  // en paralelo con Promise.all, y UN SOLO commit de estado al final con todo
  // ya resuelto (incluida la categoría activa). Antes esto eran dos efectos
  // independientes que terminaban en momentos distintos, cada uno con su
  // propio setState — eso es lo que producía el segundo render/"recarga"
  // visible del panel inferior.
  useEffect(() => {
    let cancelled = false;

    if (!businessId) {
      setReady(true);
      return;
    }

    (async () => {
      const [catalogRes, settingsRes] = await Promise.all([
        supabase
          .from("price_catalog")
          .select("id,name,price,duration_min,category,active,stock,cash_discount")
          .eq("business_id", businessId)
          .order("category")
          .order("name"),
        supabase
          .from("business_settings")
          .select("schedule")
          .eq("business_id", businessId)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      if (catalogRes.error) toast.error("Error: " + catalogRes.error.message);
      const fetchedRows = (catalogRes.data ?? []) as PriceRow[];

      const schedule = (settingsRes.data?.schedule ?? {}) as Record<string, unknown>;
      const cats = (schedule._categories ?? {}) as Record<string, unknown>;
      const visibility = getPublicVisibility(schedule);

      let nextServiceReservable = serviceReservableMap;
      let nextServiceCats = customServiceCategories;
      if (isService) {
        nextServiceReservable = normalizePublicBooleanMap(
          visibility.services ?? schedule._serviceReservable,
        );
        if (Array.isArray(cats.service))
          nextServiceCats = cats.service as string[];
      }

      let nextCatalogCats = customCatalogCategories;
      if (!isService && Array.isArray(cats.catalog))
        nextCatalogCats = cats.catalog as string[];

      const imgs = (schedule._catalogImages ?? {}) as Record<string, unknown>;
      const imgMap: Record<string, string> = {};
      for (const [pid, url] of Object.entries(imgs)) {
        if (pid.trim() && typeof url === "string" && url) imgMap[pid] = url;
      }
      const positions = (schedule._catalogImagePositions ?? {}) as Record<string, unknown>;
      const posMap: Record<string, string> = {};
      for (const [pid, value] of Object.entries(positions)) {
        if (pid.trim() && typeof value === "string" && value.trim()) posMap[pid] = value;
      }

      let nextBookingConfig = bookingConfig;
      if (!isService) {
        const bp = (schedule._bookingProducts ?? {}) as Record<string, unknown>;
        const cfg = (bp.config ?? {}) as Record<string, unknown>;
        const normalized: Record<
          string,
          { show: boolean; offer: string; miniDesc?: string }
        > = {};
        for (const [pid, value] of Object.entries(cfg)) {
          if (!pid.trim()) continue;
          const v = (value ?? {}) as Record<string, unknown>;
          normalized[pid] = {
            show: v.show === true,
            offer: typeof v.offer === "string" ? v.offer : "none",
            miniDesc: typeof v.miniDesc === "string" ? v.miniDesc : "",
          };
        }
        nextBookingConfig = normalized;
      }

      // Resolver la categoría activa con los datos YA frescos (no con el
      // estado — todavía viejo — del render anterior).
      const visibleForCats = fetchedRows.filter((row) => {
        const category = (row.category || "Productos").toLowerCase();
        if (isService) return row.duration_min != null;
        return row.duration_min == null && !category.includes("servicio");
      });
      const resolvedCategories = isService
        ? Array.from(
            new Set([
              ...nextServiceCats,
              ...visibleForCats.map((r) => r.category || "Servicios"),
            ]),
          )
        : Array.from(
            new Set([
              ...nextCatalogCats,
              ...visibleForCats.map((r) => r.category || "Productos"),
            ]),
          );
      const savedCat =
        typeof window !== "undefined"
          ? window.localStorage.getItem(activeCatStorageKey) || ""
          : "";
      const resolvedCat = resolvedCategories.includes(savedCat)
        ? savedCat
        : (resolvedCategories[0] ?? "");

      // Un solo commit de estado (React los agrupa en un único render).
      setRows(fetchedRows);
      if (isService) {
        setServiceReservableMap(nextServiceReservable);
        setCustomServiceCategories(nextServiceCats);
      } else {
        setCustomCatalogCategories(nextCatalogCats);
        setBookingConfig(nextBookingConfig);
      }
      setImageMap(imgMap);
      setImagePositionMap(posMap);
      setCat(resolvedCat);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [businessId, isService]);

  // Save categories to Supabase (called by global save)
  const persistCategories = useCallback(async () => {
    if (!businessId) return;
    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    const existingSchedule = (existingRow?.schedule ?? {}) as Record<
      string,
      unknown
    >;
    const existingCats = (existingSchedule._categories ?? {}) as Record<
      string,
      unknown
    >;
    const updatedCats = isService
      ? { ...existingCats, service: customServiceCategories }
      : { ...existingCats, catalog: customCatalogCategories };
    await supabase
      .from("business_settings")
      .upsert(
        {
          business_id: businessId,
          schedule: { ...existingSchedule, _categories: updatedCats },
        },
        { onConflict: "business_id" },
      );
  }, [businessId, isService, customServiceCategories, customCatalogCategories]);

  // Guarda el orden de categorías en el momento en que el usuario lo cambia.
  // Esto evita que, al salir y volver a Configuración, las pestañas se reordenen
  // por el orden alfabético de Supabase o por la primera categoría con ítems.
  const persistCategoryList = useCallback(
    async (next: string[], type: "catalog" | "service") => {
      if (!businessId) return;
      const { data: existingRow } = await supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle();
      const existingSchedule = (existingRow?.schedule ?? {}) as Record<string, unknown>;
      const existingCats = (existingSchedule._categories ?? {}) as Record<string, unknown>;
      const updatedCats =
        type === "service"
          ? { ...existingCats, service: next }
          : { ...existingCats, catalog: next };
      await supabase.from("business_settings").upsert(
        {
          business_id: businessId,
          schedule: { ...existingSchedule, _categories: updatedCats },
        },
        { onConflict: "business_id" },
      );
    },
    [businessId],
  );

  const saveCategories = useCallback(
    (next: string[], type: "catalog" | "service") => {
      const clean = Array.from(
        new Set(next.map((c) => c.trim()).filter(Boolean)),
      );
      const normalized =
        clean.length > 0
          ? clean
          : type === "service"
            ? []
            : defaultCatalogCategories;

      if (type === "service") {
        setCustomServiceCategories(normalized);
      } else {
        setCustomCatalogCategories(normalized);
      }

      // Persistencia silenciosa e inmediata del orden de pestañas.
      void persistCategoryList(normalized, type);
    },
    [persistCategoryList],
  );

  // Refresh silencioso de items (realtime, eventos de guardado, etc.).
  // A propósito NO toca `ready`: una vez que el panel se mostró la primera
  // vez, un refresh en segundo plano actualiza `rows` in-place sin volver a
  // tapar el panel con el loader.
  const load = useCallback(async () => {
    if (!businessId) return;
    const { data, error } = await supabase
      .from("price_catalog")
      .select("id,name,price,duration_min,category,active,stock,cash_discount")
      .eq("business_id", businessId)
      .order("category")
      .order("name");
    if (error) return toast.error("Error: " + error.message);
    setRows((data ?? []) as PriceRow[]);
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;

    const onCatalogStockSaved = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        { productId?: string; stock?: number } | undefined;

      if (detail?.productId && typeof detail.stock === "number") {
        setRows((prev) =>
          prev.map((row) =>
            row.id === detail.productId ? { ...row, stock: detail.stock } : row,
          ),
        );
        return;
      }

      load();
    };

    window.addEventListener("clippr:catalog-stock-saved", onCatalogStockSaved);

    const channel = supabase
      .channel(`settings_price_catalog_${businessId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "price_catalog",
          filter: `business_id=eq.${businessId}`,
        },
        () => load(),
      )
      .subscribe();

    return () => {
      window.removeEventListener(
        "clippr:catalog-stock-saved",
        onCatalogStockSaved,
      );
      supabase.removeChannel(channel);
    };
  }, [businessId, load]);

  // Global Save: persist pending + categories + show toast
  const persistCategoriesRef = useRef(persistCategories);
  useEffect(() => {
    persistCategoriesRef.current = persistCategories;
  }, [persistCategories]);
  const pendingItemsRef = useRef(pendingItems);
  const pendingDeletesRef = useRef(pendingDeletes);
  const serviceReservableMapRef = useRef(serviceReservableMap);
  const bookingConfigRef = useRef(bookingConfig);
  const rowsRef = useRef(rows);
  const imageMapRef = useRef(imageMap);
  const imagePositionMapRef = useRef(imagePositionMap);
  useEffect(() => {
    bookingConfigRef.current = bookingConfig;
  }, [bookingConfig]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useEffect(() => {
    imageMapRef.current = imageMap;
  }, [imageMap]);
  useEffect(() => {
    imagePositionMapRef.current = imagePositionMap;
  }, [imagePositionMap]);
  useEffect(() => {
    pendingItemsRef.current = pendingItems;
  }, [pendingItems]);
  useEffect(() => {
    pendingDeletesRef.current = pendingDeletes;
  }, [pendingDeletes]);
  useEffect(() => {
    serviceReservableMapRef.current = serviceReservableMap;
  }, [serviceReservableMap]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const section = detail?.section;
      const silent = detail?.silent === true;
      const mySection = isService ? "servicios" : "catalogo";
      if (!section || section === mySection) {
        if (silent) reportSaveStatus("saving");
        const items = pendingItemsRef.current;
        const deletes = pendingDeletesRef.current;
        const errors: string[] = [];

        let nextServiceReservableMap = { ...serviceReservableMapRef.current };
        const nextBookingConfig = { ...bookingConfigRef.current };
        const nextImageMap = { ...imageMapRef.current };
        const nextImagePositionMap = { ...imagePositionMapRef.current };
        const tempIdToReal: Record<string, string> = {};

        // Flush deletes
        for (const id of deletes) {
          const { error } = await supabase
            .from("price_catalog")
            .delete()
            .eq("id", id);
          if (error) errors.push(error.message);
          if (isService) delete nextServiceReservableMap[id];
          else delete nextBookingConfig[id];
          delete nextImageMap[id];
          delete nextImagePositionMap[id];
        }

        // Flush upserts
        for (const { tempId, payload, isNew } of items) {
          if (isNew) {
            const { data: inserted, error } = await supabase
              .from("price_catalog")
              .insert(payload)
              .select("id")
              .single();
            if (error || !inserted) {
              errors.push(error?.message ?? "No se pudo crear el servicio");
            } else if (isService) {
              const realId = String(inserted.id);
              const reservable = nextServiceReservableMap[tempId] !== false;
              delete nextServiceReservableMap[tempId];
              nextServiceReservableMap[realId] = reservable;
              tempIdToReal[tempId] = realId;
              if (nextImageMap[tempId]) {
                nextImageMap[realId] = nextImageMap[tempId];
                delete nextImageMap[tempId];
              }
              if (nextImagePositionMap[tempId]) {
                nextImagePositionMap[realId] = nextImagePositionMap[tempId];
                delete nextImagePositionMap[tempId];
              }
            } else {
              const realId = String(inserted.id);
              tempIdToReal[tempId] = realId;
              if (nextBookingConfig[tempId]) {
                nextBookingConfig[realId] = nextBookingConfig[tempId];
                delete nextBookingConfig[tempId];
              }
              if (nextImageMap[tempId]) {
                nextImageMap[realId] = nextImageMap[tempId];
                delete nextImageMap[tempId];
              }
              if (nextImagePositionMap[tempId]) {
                nextImagePositionMap[realId] = nextImagePositionMap[tempId];
                delete nextImagePositionMap[tempId];
              }
            }
          } else {
            const { error } = await supabase
              .from("price_catalog")
              .update(payload)
              .eq("id", tempId);
            if (error) errors.push(error.message);
          }
        }

        // Imagen general por item: se guarda en schedule._catalogImages.
        // Cada instancia (servicios/productos) solo toca sus propios ids y
        // preserva los de la otra para evitar pisarse al guardar.
        const ownImageIds = () => {
          const ids = new Set<string>();
          for (const r of rowsRef.current) {
            const category = (
              r.category || (isService ? "Servicios" : "Productos")
            ).toLowerCase();
            const mine = isService
              ? r.duration_min != null
              : r.duration_min == null && !category.includes("servicio");
            if (mine) ids.add(tempIdToReal[r.id] ?? r.id);
          }
          for (const id of deletes) ids.add(id);
          return ids;
        };
        const mergeCatalogImages = (
          existingSchedule: Record<string, unknown>,
        ): Record<string, string> => {
          const existing = (existingSchedule._catalogImages ?? {}) as Record<
            string,
            unknown
          >;
          const ids = ownImageIds();
          const merged: Record<string, string> = {};
          for (const [k, v] of Object.entries(existing)) {
            if (!ids.has(k) && typeof v === "string" && v) merged[k] = v;
          }
          for (const id of ids) {
            const url = nextImageMap[id];
            if (url) merged[id] = url;
          }
          return merged;
        };

        const mergeCatalogImagePositions = (
          existingSchedule: Record<string, unknown>,
        ): Record<string, string> => {
          const existing = (existingSchedule._catalogImagePositions ?? {}) as Record<string, unknown>;
          const ids = ownImageIds();
          const merged: Record<string, string> = {};
          for (const [k, v] of Object.entries(existing)) {
            if (!ids.has(k) && typeof v === "string" && v.trim()) merged[k] = v;
          }
          for (const id of ids) {
            const position = nextImagePositionMap[id];
            const hasImage = Boolean(nextImageMap[id]);
            if (hasImage && position) merged[id] = position;
          }
          return merged;
        };

        // Coordenadas de recorte explícitas (no solo el string CSS de object-position),
        // para que el recorte se pueda reconstruir con la geometría real de cada pantalla.
        const mergeCatalogImageOffsets = (
          existingSchedule: Record<string, unknown>,
        ): Record<string, { image_offset_x: number; image_offset_y: number }> => {
          const existing = (existingSchedule._catalogImageOffsets ?? {}) as Record<string, unknown>;
          const ids = ownImageIds();
          const merged: Record<string, { image_offset_x: number; image_offset_y: number }> = {};
          for (const [k, v] of Object.entries(existing)) {
            if (ids.has(k)) continue;
            const entry = v as Record<string, unknown>;
            const ox = Number(entry?.image_offset_x);
            const oy = Number(entry?.image_offset_y);
            if (Number.isFinite(ox) && Number.isFinite(oy)) merged[k] = { image_offset_x: ox, image_offset_y: oy };
          }
          for (const id of ids) {
            const position = nextImagePositionMap[id];
            const hasImage = Boolean(nextImageMap[id]);
            if (!hasImage || !position) continue;
            const { x, y } = parseImagePosition(position);
            merged[id] = { image_offset_x: x / 100, image_offset_y: y / 100 };
          }
          return merged;
        };

        imageMapRef.current = nextImageMap;
        setImageMap(nextImageMap);
        imagePositionMapRef.current = nextImagePositionMap;
        setImagePositionMap(nextImagePositionMap);

        if (isService && businessId) {
          serviceReservableMapRef.current = nextServiceReservableMap;
          setServiceReservableMap(nextServiceReservableMap);
          const { data: existingRow } = await supabase
            .from("business_settings")
            .select("schedule")
            .eq("business_id", businessId)
            .maybeSingle();
          const existingSchedule = (existingRow?.schedule ?? {}) as Record<
            string,
            unknown
          >;
          const visibility = getPublicVisibility(existingSchedule);
          await supabase.from("business_settings").upsert(
            {
              business_id: businessId,
              schedule: {
                ...existingSchedule,
                _catalogImages: mergeCatalogImages(existingSchedule),
                _catalogImagePositions: mergeCatalogImagePositions(existingSchedule),
                _catalogImageOffsets: mergeCatalogImageOffsets(existingSchedule),
                _publicVisibility: {
                  ...visibility,
                  services: nextServiceReservableMap,
                },
              },
            },
            { onConflict: "business_id" },
          );
        }

        if (!isService && businessId) {
          bookingConfigRef.current = nextBookingConfig;
          setBookingConfig(nextBookingConfig);

          // Snapshot de recomendados: respeta el orden actual del Catálogo,
          // toma los primeros 3 productos activos con "Mostrar en reservas
          // online". Se guarda nombre/precio/oferta para que la reserva pública
          // (anon) los lea desde business_settings sin acceder a price_catalog.
          const orderedProducts = rowsRef.current.filter((r) => {
            const category = (r.category || "Productos").toLowerCase();
            return r.duration_min == null && !category.includes("servicio");
          });
          const recommended = orderedProducts
            .map((r) => ({ row: r, id: tempIdToReal[r.id] ?? r.id }))
            .filter(
              ({ id, row }) =>
                row.active !== false && nextBookingConfig[id]?.show === true,
            )
            .slice(0, 3)
            .map(({ id, row }) => ({
              id,
              name: row.name,
              price: Number(row.price) || 0,
              offer: nextBookingConfig[id]?.offer ?? "none",
              image: nextImageMap[id] ?? "",
              description: nextBookingConfig[id]?.miniDesc ?? "",
            }));

          const { data: existingRow } = await supabase
            .from("business_settings")
            .select("schedule")
            .eq("business_id", businessId)
            .maybeSingle();
          const existingSchedule = (existingRow?.schedule ?? {}) as Record<
            string,
            unknown
          >;
          await supabase.from("business_settings").upsert(
            {
              business_id: businessId,
              schedule: {
                ...existingSchedule,
                _catalogImages: mergeCatalogImages(existingSchedule),
                _catalogImagePositions: mergeCatalogImagePositions(existingSchedule),
                _catalogImageOffsets: mergeCatalogImageOffsets(existingSchedule),
                _bookingProducts: {
                  config: nextBookingConfig,
                  recommended,
                },
              },
            },
            { onConflict: "business_id" },
          );
        }

        await persistCategoriesRef.current();

        if (errors.length > 0) {
          toast.error("Error guardando: " + errors[0]);
        } else {
          setPendingItems([]);
          setPendingDeletes(new Set());
          window.dispatchEvent(new CustomEvent("clippr:catalog-stock-saved"));
          if (!silent) {
            toast.success(
              isService
                ? "Servicios guardados correctamente"
                : "Catálogo guardado correctamente",
            );
          } else {
            reportSaveStatus("saved");
          }
          load();
        }
      }
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, [isService]);

  const visibleRows = rows.filter((row) => {
    const category = (row.category || "Productos").toLowerCase();
    if (isService) return row.duration_min != null;
    return row.duration_min == null && !category.includes("servicio");
  });
  const categories = isService
    ? Array.from(
        new Set([
          ...customServiceCategories,
          ...visibleRows.map((r) => r.category || "Servicios"),
        ]),
      )
    : Array.from(
        new Set([
          ...customCatalogCategories,
          ...visibleRows.map((r) => r.category || "Productos"),
        ]),
      );

  // La categoría activa inicial ya se resuelve dentro del fetch combinado de
  // arriba (junto con rows/categorías, en un solo commit). Acá solo
  // persistimos a localStorage cuando el usuario cambia de categoría.
  useEffect(() => {
    if (!ready || !cat) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(activeCatStorageKey, cat);
  }, [ready, cat, activeCatStorageKey]);

  const selectCategory = React.useCallback((category: string) => {
    setCat(category);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(activeCatStorageKey, category);
    }
  }, [activeCatStorageKey]);

  const activeCat = ready && categories.includes(cat) ? cat : "";

  const filtered = visibleRows.filter(
    (r) => (r.category || (isService ? "Servicios" : "Productos")) === activeCat,
  );

  async function uploadBookingImage(file: File): Promise<string | null> {
    if (!businessId) {
      toast.error("No se encontró el negocio");
      return null;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Subí una imagen JPG, PNG o WEBP");
      return null;
    }

    try {
      // Las imágenes de servicios/productos se muestran como miniaturas cuadradas.
      // Las comprimimos antes de subirlas para que carguen rápido en Configuración,
      // Caja, Agenda y página pública. 512px es más que suficiente para estos usos.
      const { blob, ext, type } = await processImage(file, 512, 512, 0.62);
      const path = `${businessId}/catalog/booking/${Date.now()}.${ext}`;

      const { error } = await supabase.storage
        .from("business-assets")
        .upload(path, blob, { upsert: true, contentType: type });
      if (error) {
        toast.error("No se pudo subir la imagen: " + error.message);
        return null;
      }
      const { data: urlData } = supabase.storage
        .from("business-assets")
        .getPublicUrl(path);
      return urlData.publicUrl ? `${urlData.publicUrl}?v=${Date.now()}` : null;
    } catch (error) {
      toast.error((error as Error).message || "No se pudo procesar la imagen");
      return null;
    }
  }

  function openNew() {
    setEditing(null);
    setForm(emptyPriceForm(cat, isService));
    setModalOpen(true);
  }

  function openEdit(row: PriceRow) {
    setEditing(row);
    const cfg = bookingConfig[row.id];
    setForm({
      ...rowToForm(row, isService),
      reservable: isService ? serviceReservableMap[row.id] !== false : true,
      bookingShow: !isService && cfg?.show === true,
      bookingOffer: !isService ? cfg?.offer ?? "none" : "none",
      miniDesc: !isService ? cfg?.miniDesc ?? "" : "",
      image: imageMap[row.id] ?? "",
      imagePosition: imagePositionMap[row.id] ?? "50% 50%",
    });
    setModalOpen(true);
  }

  function saveItem() {
    if (!businessId) return toast.error("No se encontró el negocio");
    if (!form.name.trim()) return toast.error("Ingresá un nombre");
    const payload: Record<string, unknown> = {
      business_id: businessId,
      name: form.name.trim(),
      price: Number(form.price) || 0,
      cash_discount: Number(form.discount) || 0,
      category: form.category,
      active: form.status === "Activo",
      duration_min: isService ? Number(form.duration) || 30 : null,
    };
    if (!isService) payload.stock = Number(form.stock) || 0;

    if (editing) {
      if (isService)
        setServiceReservableMap((current) => ({
          ...current,
          [editing.id]: form.reservable,
        }));
      else
        setBookingConfig((current) => ({
          ...current,
          [editing.id]: {
            show: form.bookingShow,
            offer: Number(form.bookingOffer) > 0 ? String(Number(form.bookingOffer)) : "none",
            miniDesc: form.miniDesc,
          },
        }));
      setImageMap((current) => {
        const next = { ...current };
        if (form.image) next[editing.id] = form.image;
        else delete next[editing.id];
        return next;
      });
      setImagePositionMap((current) => {
        const next = { ...current };
        if (form.image) next[editing.id] = form.imagePosition || "50% 50%";
        else delete next[editing.id];
        return next;
      });
      // Update existing row locally
      setRows((prev) =>
        prev.map((r) =>
          r.id === editing.id ? ({ ...r, ...payload } as PriceRow) : r,
        ),
      );
      setPendingItems((prev) => {
        const next = prev.filter((p) => p.tempId !== editing.id);
        return [
          ...next,
          { tempId: editing.id, payload: { ...payload }, isNew: false },
        ];
      });
    } else {
      // New row — temp negative id until saved
      const tempId = `new_${Date.now()}`;
      if (isService)
        setServiceReservableMap((current) => ({
          ...current,
          [tempId]: form.reservable,
        }));
      else
        setBookingConfig((current) => ({
          ...current,
          [tempId]: {
            show: form.bookingShow,
            offer: Number(form.bookingOffer) > 0 ? String(Number(form.bookingOffer)) : "none",
            miniDesc: form.miniDesc,
          },
        }));
      if (form.image) {
        setImageMap((current) => ({ ...current, [tempId]: form.image }));
        setImagePositionMap((current) => ({ ...current, [tempId]: form.imagePosition || "50% 50%" }));
      }
      setRows((prev) => [...prev, { id: tempId, ...payload } as PriceRow]);
      setPendingItems((prev) => [
        ...prev,
        { tempId, payload: { ...payload }, isNew: true },
      ]);
    }
    setModalOpen(false);
    markSettingsDirty();

    // Persistencia inmediata: "Guardar producto" debe quedar guardado aunque el usuario recargue la página.
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("clippr:save-settings", {
          detail: { section: isService ? "servicios" : "catalogo" },
        }),
      );
    }, 150);
  }

  function toggle(row: PriceRow) {
    const newActive = !row.active;
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, active: newActive } : r)),
    );
    setPendingItems((prev) => {
      const existing = prev.find((p) => p.tempId === row.id);
      if (existing)
        return prev.map((p) =>
          p.tempId === row.id
            ? { ...p, payload: { ...p.payload, active: newActive } }
            : p,
        );
      return [
        ...prev,
        { tempId: row.id, payload: { active: newActive }, isNew: false },
      ];
    });
    markSettingsDirty();
  }

  async function remove(row: PriceRow) {
    setConfirmDelItem(row);
  }

  async function doRemoveItem() {
    if (!confirmDelItem) return;
    const row = confirmDelItem;
    setConfirmDelItem(null);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    if (isService)
      setServiceReservableMap((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    else
      setBookingConfig((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    setImageMap((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    // If it was a new (unsaved) item, just remove from pending
    if (row.id.startsWith("new_")) {
      setPendingItems((prev) => prev.filter((p) => p.tempId !== row.id));
    } else {
      setPendingItems((prev) => prev.filter((p) => p.tempId !== row.id));
      setPendingDeletes((prev) => new Set([...prev, row.id]));
    }
    setEditing(null);
    setModalOpen(false);
    toast.success(isService ? "Servicio eliminado" : "Producto eliminado");
    markSettingsDirty();
  }

  function reorderItem(row: PriceRow, direction: "up" | "down") {
    const catRows = filtered;
    const idx = catRows.findIndex((r) => r.id === row.id);
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === catRows.length - 1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const swapRow = catRows[swapIdx];
    setRows((prev) => {
      const arr = [...prev];
      const i = arr.findIndex((r) => r.id === row.id);
      const j = arr.findIndex((r) => r.id === swapRow.id);
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
    markSettingsDirty();
  }

  function reorderItemToTarget(sourceId: string | null, targetId: string) {
    if (!sourceId || sourceId === targetId) return;
    const source = rows.find((r) => r.id === sourceId);
    const target = rows.find((r) => r.id === targetId);
    if (!source || !target || source.category !== target.category) return;

    setRows((prev) => {
      const categoryRows = prev.filter((r) => r.category === target.category);
      const otherRows = prev.filter((r) => r.category !== target.category);
      const nextCategoryRows = [...categoryRows];
      const from = nextCategoryRows.findIndex((r) => r.id === sourceId);
      const to = nextCategoryRows.findIndex((r) => r.id === targetId);
      if (from < 0 || to < 0) return prev;
      const [moved] = nextCategoryRows.splice(from, 1);
      nextCategoryRows.splice(to, 0, moved);
      return [...otherRows, ...nextCategoryRows];
    });
    markSettingsDirty();
  }

  // Inline input modal for add/rename category (avoids browser prompt())
  const [catModal, setCatModal] = useState<{
    mode: "add" | "rename";
    current?: string;
  } | null>(null);
  const [catInputVal, setCatInputVal] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!addMenuOpen) return;

    function handleAddMenuOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (addMenuRef.current && !addMenuRef.current.contains(target)) {
        setAddMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleAddMenuOutsideClick, true);
    return () =>
      document.removeEventListener("pointerdown", handleAddMenuOutsideClick, true);
  }, [addMenuOpen]);


  function addCategory() {
    setCatInputVal("");
    setCatModal({ mode: "add" });
  }

  async function renameCategory(category: string) {
    setCatInputVal(category);
    setCatModal({ mode: "rename", current: category });
  }

  function reorderCategory(fromCategory: string, toCategory: string) {
    if (!fromCategory || !toCategory || fromCategory === toCategory) return;
    const list = [...categories];
    const fromIndex = list.findIndex((c) => c === fromCategory);
    const toIndex = list.findIndex((c) => c === toCategory);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    saveCategories(list, isService ? "service" : "catalog");
    selectCategory(fromCategory);
  }

  async function submitCatModal() {
    const clean = catInputVal.trim();
    if (!clean) {
      setCatModal(null);
      return;
    }
    if (catModal?.mode === "add") {
      if (isService)
        saveCategories([...customServiceCategories, clean], "service");
      else saveCategories([...customCatalogCategories, clean], "catalog");
      selectCategory(clean);
    } else if (catModal?.mode === "rename" && catModal.current) {
      const category = catModal.current;
      if (clean !== category) {
        if (isService) {
          const next = customServiceCategories.includes(category)
            ? customServiceCategories.map((c) => (c === category ? clean : c))
            : [...customServiceCategories, clean];
          saveCategories(next, "service");
        } else {
          const next = customCatalogCategories.includes(category)
            ? customCatalogCategories.map((c) => (c === category ? clean : c))
            : [...customCatalogCategories, clean];
          saveCategories(next, "catalog");
        }
        if (businessId) {
          await supabase
            .from("price_catalog")
            .update({ category: clean })
            .eq("business_id", businessId)
            .eq("category", category);
        }
        selectCategory(clean);
        toast.success("Categoría actualizada");
        load();
      }
    }
    setCatModal(null);
  }

  async function deleteCategory(category: string) {
    setConfirmDelCat(category);
  }

  async function doDeleteCategory() {
    if (!confirmDelCat) return;
    const category = confirmDelCat;
    setConfirmDelCat(null);
    const currentCategories = categories.filter((c) => c !== category);
    if (currentCategories.length === 0)
      return toast.error("Debe quedar al menos una categoría");
    const targetCategory = currentCategories[0];
    if (isService)
      saveCategories(
        customServiceCategories.filter((c) => c !== category),
        "service",
      );
    else
      saveCategories(
        customCatalogCategories.filter((c) => c !== category),
        "catalog",
      );
    if (businessId) {
      await supabase
        .from("price_catalog")
        .update({ category: targetCategory })
        .eq("business_id", businessId)
        .eq("category", category);
    }
    if (category === activeCat || !categories.includes(activeCat)) {
      selectCategory(targetCategory);
    }
    toast.success("Categoría eliminada");
    markSettingsDirty();
    load();
  }

  return (
    <>
      <div>
        <h2 className="text-xl font-display font-semibold">
          {isService ? "Servicios" : "Catálogo"}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {isService ? "Servicios que ofrecés." : "Productos para la venta."}
        </p>
      </div>

      <div className="glass overflow-visible rounded-2xl ring-1 ring-white/5">
        {!ready ? (
          <div className="grid place-items-center py-16">
            <ClipprLoader size="screen" delayMs={130} />
          </div>
        ) : (
          <>
        <div className="relative flex items-center gap-1 px-3 pt-3 pr-1 border-b border-white/5 overflow-visible">
          {categories.map((category) => {
            const active = category === activeCat;
            return (
              <div
                key={category}
                draggable
                onDragStart={(event) => {
                  setDraggedCategory(category);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  reorderCategory(draggedCategory ?? "", category);
                  setDraggedCategory(null);
                }}
                onDragEnd={() => setDraggedCategory(null)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-t-lg transition-colors whitespace-nowrap",
                  "cursor-grab active:cursor-grabbing",
                  active
                    ? "bg-white/5 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                  draggedCategory === category && "opacity-50",
                )}
              >
                <button
                  type="button"
                  onClick={() => selectCategory(category)}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm select-none"
                >
                  <GripVertical className="h-4 w-4 text-white/40" />
                  <span>{category}</span>
                </button>
                {categories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => deleteCategory(category)}
                    className="grid h-6 w-6 place-items-center rounded-md pr-1 text-red-300/70 transition hover:bg-red-500/10 hover:text-red-300"
                    title="Eliminar categoría"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          <div className="ml-auto flex shrink-0 items-center justify-end pl-4 pr-0">
            <div ref={addMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setAddMenuOpen((open) => !open)}
                className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white shadow-[0_8px_24px_-10px_rgba(56,189,248,0.75)] transition hover:opacity-95"
                aria-label="Agregar"
              >
                <Plus className="h-4.5 w-4.5" strokeWidth={2.5} />
              </button>

              {addMenuOpen ? (
                <div className="absolute right-0 top-10 z-30 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[oklch(0.13_0.035_275/0.98)] p-1.5 shadow-2xl backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setAddMenuOpen(false);
                      addCategory();
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                  >
                    <Plus className="h-4 w-4 text-sky-300" />
                    Nueva categoría
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddMenuOpen(false);
                      openNew();
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                  >
                    <Plus className="h-4 w-4 text-violet-300" />
                    Nuevo servicio
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No hay ítems en esta sección.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filtered.map((row) => (
              <div
                key={row.id}
                draggable
                onDragStart={(event) => {
                  setDraggedItemId(row.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  reorderItemToTarget(draggedItemId, row.id);
                  setDraggedItemId(null);
                }}
                onDragEnd={() => setDraggedItemId(null)}
                className={cn(
                  "flex cursor-grab items-center gap-3 px-5 py-3 transition active:cursor-grabbing",
                  draggedItemId === row.id && "opacity-50",
                )}
              >
                <GripVertical className="h-4 w-4 shrink-0 text-white/35" />
                <ServiceImage
                  src={imageMap[row.id]}
                  alt={row.name}
                  position={imagePositionMap[row.id]}
                  className="h-11 w-11 rounded-2xl bg-white/5 ring-1 ring-white/10"
                  fallback={<span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.72_0.2_245)]" />}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{row.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {row.duration_min ? `${row.duration_min} min` : ""}
                    {typeof row.stock === "number" && !isService
                      ? `Stock: ${row.stock}`
                      : ""}
                  </div>
                </div>

                {!isService && bookingConfig[row.id]?.show && (
                  <span className="mx-2 inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-500/12 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-200 ring-1 ring-violet-400/25">
                    <Star className="h-3 w-3 fill-current" />
                    Online
                  </span>
                )}

                <div className="text-right shrink-0">
                  <div className="font-display text-sm font-semibold text-[oklch(0.82_0.14_75)]">
                    ${Number(row.price).toLocaleString("es-AR")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(row)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full ring-1 px-2 py-0.5 text-[10px] uppercase tracking-wider transition hover:brightness-110",
                    row.active !== false
                      ? "bg-[oklch(0.78_0.17_140/0.12)] ring-[oklch(0.78_0.17_140/0.3)] text-[oklch(0.85_0.17_140)]"
                      : "bg-white/5 ring-white/10 text-muted-foreground hover:bg-white/10",
                  )}
                  title={row.active !== false ? "Desactivar" : "Activar"}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      row.active !== false
                        ? "bg-[oklch(0.78_0.17_140)]"
                        : "bg-muted-foreground",
                    )}
                  />{" "}
                  {row.active !== false ? "Activo" : "Inactivo"}
                </button>
                <button
                  onClick={() => openEdit(row)}
                  className="rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-3 py-1.5 text-xs"
                >
                  Editar
                </button>
              </div>
            ))}
          </div>
        )}
          </>
        )}
      </div>

      <PriceEditorModal
        open={modalOpen}
        mode={editing ? "edit" : "new"}
        isService={isService}
        form={form}
        setForm={setForm}
        onClose={() => setModalOpen(false)}
        onSave={saveItem}
        onDelete={() => editing && setConfirmDelItem(editing)}
        saving={saving}
        catalogCategories={categories}
        onUploadImage={uploadBookingImage}
        featuredOthers={
          Object.entries(bookingConfig).filter(
            ([id, c]) => c.show && id !== editing?.id,
          ).length
        }
      />
      <ConfirmDialog
        open={!!confirmDelItem}
        title={isService ? "Eliminar servicio" : "Eliminar producto"}
        message={`¿Deseás eliminar "${confirmDelItem?.name}"?`}
        onConfirm={doRemoveItem}
        onCancel={() => setConfirmDelItem(null)}
      />
      <ConfirmDialog
        open={!!confirmDelCat}
        title="Eliminar categoría"
        message={`¿Deseás eliminar la categoría "${confirmDelCat}"? Los ítems se moverán a la primera categoría disponible.`}
        onConfirm={doDeleteCategory}
        onCancel={() => setConfirmDelCat(null)}
      />
      {/* Category name input modal */}
      {catModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass rounded-2xl p-6 max-w-sm w-full mx-4 ring-1 ring-white/10 space-y-4">
            <div className="font-display font-semibold text-base">
              {catModal.mode === "add"
                ? "Nueva categoría"
                : "Renombrar categoría"}
            </div>
            <input
              autoFocus
              value={catInputVal}
              onChange={(e) => setCatInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCatModal();
                if (e.key === "Escape") setCatModal(null);
              }}
              placeholder="Nombre de la categoría"
              className="w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-4 py-2.5 text-sm focus:outline-none focus:ring-primary/40"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setCatModal(null)}
                className="px-4 py-2 rounded-xl text-sm bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition"
              >
                Cancelar
              </button>
              <button
                onClick={submitCatModal}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-sky-400 to-violet-500 text-white transition"
              >
                {catModal.mode === "add" ? "Agregar" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ServiciosSection() {
  return <PriceCatalogSection kind="servicios" />;
}

function CatalogoSection() {
  return <PriceCatalogSection kind="catalogo" />;
}

// ─────────── Caja ───────────


function CuentaSection() {
  const BASE_PRICE = 10000;
  const INCLUDED_PROS = 1;
  const INCLUDED_BRANCHES = 1;
  const EXTRA_PRO_PRICE = 3500;
  const EXTRA_BRANCH_PRICE = 8000;

  const [professionals, setProfessionals] = useState(1);
  const [branches, setBranches] = useState(1);

  const extraPros = Math.max(0, professionals - INCLUDED_PROS);
  const extraBranches = Math.max(0, branches - INCLUDED_BRANCHES);
  const prosTotal = extraPros * EXTRA_PRO_PRICE;
  const branchesTotal = extraBranches * EXTRA_BRANCH_PRICE;
  const monthlyTotal = BASE_PRICE + prosTotal + branchesTotal;
  const renewalDate = new Date(2026, 6, 29);
  const today = new Date();
  const billingCycleDays = 30;
  const daysRemaining = Math.max(
    0,
    Math.min(
      billingCycleDays,
      Math.ceil((renewalDate.getTime() - today.getTime()) / 86_400_000),
    ),
  );
  const prorationRatio = daysRemaining / billingCycleDays;
  const todayProsProration = Math.round(prosTotal * prorationRatio);
  const todayBranchesProration = Math.round(branchesTotal * prorationRatio);
  const todayTotal = todayProsProration + todayBranchesProration;

  const money = (value: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(value);

  const included = [
    "Agenda",
    "Caja",
    "Clientes",
    "Reservas online",
    "Perfil público",
    "Asesor IA",
    "Inventario",
    "Roles y permisos",
    "Marketing",
    "Reportes",
    "Todas las futuras funciones",
  ];

  const payments = [
    ["Junio 2026", monthlyTotal, "Pagado"],
    ["Mayo 2026", monthlyTotal, "Pagado"],
    ["Abril 2026", Math.max(BASE_PRICE, monthlyTotal - EXTRA_BRANCH_PRICE), "Pagado"],
  ] as const;

  function CounterCard({
    title,
    subtitle,
    value,
    onMinus,
    onPlus,
    priceLabel,
  }: {
    title: string;
    subtitle: string;
    value: number;
    onMinus: () => void;
    onPlus: () => void;
    priceLabel: string;
  }) {
    return (
      <div className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
          </div>
          <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-xs font-semibold text-white/70 ring-1 ring-white/10">
            Incluye 1
          </span>
        </div>

        <div className="mt-5 flex items-center justify-between rounded-2xl bg-white/[0.035] p-2 ring-1 ring-white/10">
          <button
            type="button"
            onClick={onMinus}
            className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-lg font-semibold ring-1 ring-white/10 transition hover:bg-white/[0.09]"
          >
            −
          </button>
          <div className="text-center">
            <div className="text-3xl font-display font-semibold">{value}</div>
            <div className="text-[11px] text-muted-foreground">total</div>
          </div>
          <button
            type="button"
            onClick={onPlus}
            className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-lg font-semibold text-white shadow-[0_10px_30px_-14px_rgba(56,189,248,0.8)] transition hover:opacity-95"
          >
            +
          </button>
        </div>

        <div className="mt-4 rounded-2xl bg-white/[0.025] px-4 py-3 text-sm text-muted-foreground ring-1 ring-white/8">
          {priceLabel}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-display font-semibold">Cuenta</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Suscripción, facturación y estado de tu cuenta.
        </p>
      </div>

      <div className="glass relative overflow-hidden rounded-3xl p-5 ring-1 ring-white/10">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-sky-400/14 blur-3xl" />
        <div className="pointer-events-none absolute -left-24 -bottom-24 h-64 w-64 rounded-full bg-violet-500/12 blur-3xl" />

        <div className="relative grid gap-5 lg:grid-cols-[1fr_430px] lg:items-center">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-sky-400/10 text-sky-200 ring-1 ring-sky-300/20">
              <CreditCard className="h-6 w-6" />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Tu suscripción
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h3 className="text-2xl font-display font-semibold">Clippr</h3>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Activa
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Una sola suscripción con todas las funciones. Pagás según la
                cantidad de profesionales y sucursales que necesitás.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white/[0.035] p-4 ring-1 ring-white/10">
              <div className="text-xs text-muted-foreground">Próximo pago</div>
              <div className="mt-1 font-semibold">29 Jul 2026</div>
            </div>
            <div className="rounded-2xl bg-white/[0.035] p-4 ring-1 ring-white/10">
              <div className="text-xs text-muted-foreground">Total mensual</div>
              <div className="mt-1 font-semibold">{money(monthlyTotal)}</div>
            </div>
            <div className="rounded-2xl bg-white/[0.035] p-4 ring-1 ring-white/10">
              <div className="text-xs text-muted-foreground">Pago</div>
              <div className="mt-1 font-semibold">Visa ****4821</div>
            </div>
          </div>
        </div>
      </div>

      <SectionCard label="Personalizá tu plan">
        <div className="grid gap-4 lg:grid-cols-2">
          <CounterCard
            title="Profesionales"
            subtitle="Barberos o miembros del equipo que usan Clippr."
            value={professionals}
            onMinus={() => setProfessionals((value) => Math.max(1, value - 1))}
            onPlus={() => setProfessionals((value) => value + 1)}
            priceLabel={`+ ${money(EXTRA_PRO_PRICE)} por profesional adicional`}
          />

          <CounterCard
            title="Sucursales"
            subtitle="Locales o puntos de atención de tu negocio."
            value={branches}
            onMinus={() => setBranches((value) => Math.max(1, value - 1))}
            onPlus={() => setBranches((value) => value + 1)}
            priceLabel={`+ ${money(EXTRA_BRANCH_PRICE)} por sucursal adicional`}
          />
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard label="Resumen de suscripción">
          <div className="space-y-4">
            <div className="rounded-3xl bg-white/[0.03] p-4 ring-1 ring-white/10">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Nuevo total mensual
              </div>

              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Plan base</span>
                  <span className="font-semibold">{money(BASE_PRICE)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {extraPros} profesionales adicionales
                  </span>
                  <span className="font-semibold">{money(prosTotal)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {extraBranches} sucursales adicionales
                  </span>
                  <span className="font-semibold">{money(branchesTotal)}</span>
                </div>
              </div>

              <div className="mt-4 flex items-end justify-between border-t border-white/10 pt-4">
                <span className="text-sm text-muted-foreground">Total mensual</span>
                <div className="text-right">
                  <div className="text-2xl font-display font-semibold">
                    {money(monthlyTotal)}
                  </div>
                  <div className="text-xs text-muted-foreground">desde la próxima renovación</div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-gradient-to-br from-sky-400/12 to-violet-500/12 p-4 ring-1 ring-sky-300/20">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200/80">
                    Hoy pagarás
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Proporcional por los {daysRemaining} días restantes del período.
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-display font-semibold">
                    {money(todayTotal)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    proporcional
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {extraPros} profesionales · proporcional
                  </span>
                  <span className="font-semibold">{money(todayProsProration)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {extraBranches} sucursales · proporcional
                  </span>
                  <span className="font-semibold">{money(todayBranchesProration)}</span>
                </div>
              </div>

              <p className="mt-4 rounded-2xl bg-black/15 px-3 py-2 text-xs leading-relaxed text-white/60 ring-1 ring-white/10">
                El nuevo valor mensual de {money(monthlyTotal)} comenzará a cobrarse automáticamente en tu próxima renovación.
              </p>
            </div>

            <button
              type="button"
              className="w-full rounded-2xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-95"
            >
              Actualizar suscripción
            </button>
          </div>
        </SectionCard>

        <SectionCard label="Todo incluido">
          <div className="grid gap-2 sm:grid-cols-2">
            {included.map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 rounded-2xl bg-white/[0.03] px-3 py-2 ring-1 ring-white/8"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                <span className="text-sm">{item}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            No existen límites de uso. Solo pagás por el tamaño de tu negocio.
          </p>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <SectionCard label="Facturación">
          <div className="space-y-3">
            {[
              ["Método de pago", "Visa terminada en 4821"],
              ["Próximo cobro", "29 Jul 2026"],
              ["Estado", "Pagos al día"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/8"
              >
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-medium">{value}</span>
              </div>
            ))}

            <button
              type="button"
              className="w-full rounded-2xl bg-white/[0.05] px-4 py-2.5 text-sm font-semibold ring-1 ring-white/10 transition hover:bg-white/[0.09]"
            >
              Cambiar método de pago
            </button>
          </div>
        </SectionCard>

        <SectionCard label="Historial de pagos">
          <div className="overflow-hidden rounded-2xl ring-1 ring-white/10">
            {payments.map(([month, amount, status], index) => (
              <div
                key={month}
                className={cn(
                  "grid grid-cols-[1fr_auto_auto] items-center gap-4 bg-white/[0.025] px-4 py-3 text-sm",
                  index > 0 && "border-t border-white/5",
                )}
              >
                <span className="font-medium">{month}</span>
                <span className="text-muted-foreground">{money(amount)}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/25">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {status}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function CajaSection() {
  const { businessId } = useAuth();
  const defaultMethods = {
    efectivo: true,
    transferencia: true,
    tarjeta: true,
    mp: true,
    cuentaDni: false,
  };
  const [methods, setMethods] = useState(defaultMethods);
  const autoChange = true;
  const [approvalEnabled, setApprovalEnabled] = useState(false);
  const [approvalMode, setApprovalMode] = useState<"auto" | "manual">("auto");

  useEffect(() => {
    if (!businessId) return;
    supabase
      .from("business_settings")
      .select("approval_mode,schedule")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
        const caja = (schedule._caja ?? {}) as Record<string, unknown>;
        if (caja.methods) setMethods(caja.methods as typeof defaultMethods);
      });
  }, [businessId]);

  async function saveCajaSettings(
    nextMethods = methods,
    nextAutoChange = autoChange,
    showToast = true,
  ) {
    if (!businessId) return toast.error("No se encontró el negocio");
    if (!showToast) reportSaveStatus("saving");
    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    const existingSchedule = (existingRow?.schedule ?? {}) as Record<
      string,
      unknown
    >;
    const { error } = await supabase.from("business_settings").upsert(
      {
        business_id: businessId,
        schedule: {
          ...existingSchedule,
          _caja: {
            ...((existingSchedule._caja ?? {}) as Record<string, unknown>),
            methods: nextMethods,
            autoChange: true,
          },
        },
      },
      { onConflict: "business_id" },
    );
    if (error) return toast.error("Error guardando: " + error.message);
    window.dispatchEvent(new CustomEvent("clippr:caja-settings-updated"));
    if (showToast) toast.success("Guardado");
    else reportSaveStatus("saved");
  }

  function updateMethod(methodId: keyof typeof defaultMethods, value: boolean) {
    const nextMethods = { ...methods, [methodId]: value };
    setMethods(nextMethods);
    void saveCajaSettings(nextMethods, autoChange);
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const section = (event as CustomEvent).detail?.section;
      if (!section || section === "caja") void saveCajaSettings(methods, autoChange, false);
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, [methods, autoChange, businessId]);

  const M = [
    {
      id: "efectivo",
      icon: Banknote,
      label: "Efectivo",
      tint: "text-[oklch(0.82_0.14_75)]",
    },
    {
      id: "transferencia",
      icon: Landmark,
      label: "Transferencia bancaria",
      tint: "text-[oklch(0.78_0.17_140)]",
    },
    {
      id: "tarjeta",
      icon: CreditCard,
      label: "Tarjeta débito / crédito",
      tint: "text-[oklch(0.72_0.2_245)]",
    },
    {
      id: "mp",
      icon: Wallet,
      label: "Mercado Pago",
      tint: "text-[oklch(0.72_0.2_245)]",
    },
    {
      id: "cuentaDni",
      icon: PiggyBank,
      label: "Cuenta DNI",
      tint: "text-[oklch(0.7_0.25_300)]",
    },
  ] as const;

  return (
    <>
      <div>
        <h2 className="text-xl font-display font-semibold">Caja</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Cobros y medios de pago.
        </p>
      </div>

      <SectionCard label="Métodos de pago habilitados">
        <div className="divide-y divide-white/5">
          {M.map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.id}
                className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0"
              >
                <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center">
                  <Icon className={cn("h-4.5 w-4.5", m.tint)} />
                </div>
                <div className="flex-1 font-medium text-sm">{m.label}</div>
                <Toggle
                  on={methods[m.id]}
                  onChange={(v) => updateMethod(m.id, v)}
                />
              </div>
            );
          })}
        </div>
      </SectionCard>


    </>
  );
}

// ─────────── Page ───────────

function SenasBlock({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white/[0.02] ring-1 ring-white/[0.06] p-6 space-y-4">
      <div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {subtitle && (
          <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
        )}
      </div>
      {children}
    </div>
  );
}

function SenasToggleBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl px-5 py-2.5 text-sm font-medium ring-1 transition-all",
        active
          ? "bg-primary/20 ring-primary/50 text-foreground shadow-[0_0_16px_-4px_oklch(0.66_0.22_265/0.4)]"
          : "bg-white/[0.03] ring-white/10 text-muted-foreground hover:text-foreground hover:bg-white/[0.05]",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Señas Section
// ---------------------------------------------------------------------------
function SenasSection() {
  const { businessId } = useAuth();
  const [services, setServices] = React.useState<
    {
      id: string;
      name: string;
      category?: string | null;
      price?: number | null;
      duration_min?: number | null;
    }[]
  >([]);
  const [selectedSvcs, setSelectedSvcs] = React.useState<string[]>([]);
  const [amountType, setAmountType] = React.useState<"fixed" | "percent">(
    "fixed",
  );
  const [amountValue, setAmountValue] = React.useState("");
  const [lostDist, setLostDist] = React.useState<"local" | "prof" | "custom">(
    "local",
  );
  const [lostLocal, setLostLocal] = React.useState("100");
  const [lostProf, setLostProf] = React.useState("0");
  const [msg, setMsg] = React.useState(DEFAULT_SENA_MESSAGE);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!businessId) return;
    supabase
      .from("business_settings")
      .select("senas_config")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.senas_config) {
          const c = data.senas_config as Record<string, unknown>;
          setSelectedSvcs((c.services as string[]) ?? []);
          setAmountType((c.amount_type as "fixed" | "percent") ?? "fixed");
          setAmountValue(String(c.amount_value ?? ""));
          setLostDist((c.lost_dist as "local" | "prof" | "custom") ?? "local");
          setLostLocal(String(c.lost_local ?? "100"));
          setLostProf(String(c.lost_prof ?? "0"));
          setMsg(String(c.msg || DEFAULT_SENA_MESSAGE));
        }
        setLoading(false);
      });
    supabase
      .from("price_catalog")
      .select("id,name,category,price,duration_min,active")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("category")
      .order("name")
      .then(({ data, error }) => {
        if (error) {
          toast.error("Error cargando servicios para señas: " + error.message);
          return;
        }

        const servicesOnly = (data ?? []).filter(
          (item) =>
            item.duration_min !== null && item.duration_min !== undefined,
        );

        setServices(
          servicesOnly as {
            id: string;
            name: string;
            category?: string | null;
            price?: number | null;
            duration_min?: number | null;
          }[],
        );
      });
  }, [businessId]);

  const save = React.useCallback(async (showToast = true) => {
    if (!businessId) return;
    if (!showToast) reportSaveStatus("saving");
    const localPct = parseFloat(lostLocal) || 0;
    const typedProfPct = parseFloat(lostProf) || 0;
    const parsedAmount = parseFloat(amountValue) || 0;

    if (lostDist === "custom") {
      const totalPct = Math.round((localPct + typedProfPct) * 10) / 10;
      if (totalPct !== 100) {
        toast.error("La distribución personalizada debe sumar 100%");
        return;
      }
    }

    const profPct =
      lostDist === "custom" ? typedProfPct : lostDist === "prof" ? 100 : 0;
    const { error } = await supabase.from("business_settings").upsert(
      {
        business_id: businessId,
        senas_config: {
          enabled: selectedSvcs.length > 0,
          services: selectedSvcs,
          amount_type: amountType,
          amount_value: parsedAmount,
          lost_dist: lostDist,
          lost_local: localPct,
          lost_prof: profPct,
          msg,
        },
      },
      { onConflict: "business_id" },
    );
    if (error) {
      toast.error("Error guardando señas: " + error.message);
      return;
    }
    if (showToast) toast.success("Configuración de señas guardada correctamente");
    else reportSaveStatus("saved");
  }, [
    businessId,
    selectedSvcs,
    amountType,
    amountValue,
    lostDist,
    lostLocal,
    lostProf,
    msg,
  ]);

  const saveRef = React.useRef(save);
  React.useEffect(() => {
    saveRef.current = save;
  }, [save]);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const section = detail?.section;
      const silent = detail?.silent === true;
      if (!section || section === "senas" || section === "servicios")
        saveRef.current(!silent);
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, []);

  if (loading)
    return (
      <div className="grid place-items-center py-24">
        <ClipprLoader size="screen" delayMs={130} />
      </div>
    );

  return (
    <div className="space-y-4">
      {/* Servicios con seña: si no hay servicios seleccionados, las señas quedan desactivadas. */}
      <>
        {/* Bloque 1: Servicios */}
        <SenasBlock title="Servicios que requieren seña">
          <div className="space-y-2">
            {services.length > 0 && (
              <div className="flex items-center justify-between gap-3 pb-2 border-b border-white/5">
                <div className="text-xs text-muted-foreground">
                  {selectedSvcs.length} de {services.length} servicios
                  seleccionados
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedSvcs(services.map((s) => s.id))}
                    className="rounded-lg bg-white/[0.04] hover:bg-white/[0.08] ring-1 ring-white/10 px-3 py-1.5 text-[11px] text-foreground transition"
                  >
                    Marcar todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedSvcs([])}
                    className="rounded-lg bg-white/[0.04] hover:bg-white/[0.08] ring-1 ring-white/10 px-3 py-1.5 text-[11px] text-muted-foreground transition"
                  >
                    Limpiar
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {services.map((s) => {
                const on = selectedSvcs.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      setSelectedSvcs(
                        on
                          ? selectedSvcs.filter((x) => x !== s.id)
                          : [...selectedSvcs, s.id],
                      )
                    }
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left ring-1 transition-all",
                      on
                        ? "bg-primary/14 ring-primary/35 shadow-[0_0_14px_-6px_oklch(0.66_0.22_265/0.45)]"
                        : "bg-white/[0.03] ring-white/10 hover:bg-white/[0.055]",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium ">
                        {s.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {s.category && <span>{s.category}</span>}
                        {typeof s.duration_min === "number" &&
                          s.duration_min > 0 && (
                            <span>{s.duration_min} min</span>
                          )}
                        {typeof s.price === "number" && s.price > 0 && (
                          <span>
                            ${Number(s.price).toLocaleString("es-AR")}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full ring-1 transition",
                        on
                          ? "bg-primary ring-primary/40"
                          : "bg-white/10 ring-white/10",
                      )}
                    >
                      <span
                        className={cn(
                          "h-5 w-5 rounded-full bg-white shadow transition-transform",
                          on ? "translate-x-5" : "translate-x-0.5",
                        )}
                      />
                    </span>
                  </button>
                );
              })}
            </div>

            {services.length === 0 && (
              <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-4 text-sm text-muted-foreground text-center">
                Primero cargá servicios en Configuración → Servicios.
              </div>
            )}
          </div>
        </SenasBlock>
        {/* Bloque 4: Distribución si se pierde */}
        <SenasBlock title="Si el cliente pierde la seña">
          <div className="flex flex-wrap gap-3">
            {(
              [
                ["local", "🏢 Local"],
                ["prof", "👤 Profesional"],
                ["custom", "⚙️ Personalizado"],
              ] as [string, string][]
            ).map(([v, l]) => (
              <SenasToggleBtn
                key={v}
                label={l}
                active={lostDist === v}
                onClick={() => {
                  setLostDist(v as "local" | "prof" | "custom");
                  if (v === "local") {
                    setLostLocal("100");
                    setLostProf("0");
                  } else if (v === "prof") {
                    setLostLocal("0");
                    setLostProf("100");
                  }
                }}
              />
            ))}
          </div>

          {lostDist === "custom" && (
            <div className="mt-2 p-4 rounded-xl bg-white/[0.02] ring-1 ring-white/[0.06] space-y-3">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Distribución personalizada
              </div>
              <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-24">
                    Local
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={lostLocal}
                    onChange={(e) => setLostLocal(e.target.value)}
                    className="w-20 rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2 text-sm text-center focus:outline-none"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-24">
                    Profesional
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={lostProf}
                    onChange={(e) => setLostProf(e.target.value)}
                    className="w-20 rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2 text-sm text-center focus:outline-none"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Podés escribir los porcentajes libremente. Se validan cuando
                tocás Guardar.
              </div>
            </div>
          )}
        </SenasBlock>

        {/* Bloque 4: Mensaje */}
        <SenasBlock
          title="Mensaje para el cliente"
          subtitle="Mensaje que verá el cliente después de reservar un turno con seña."
        >
          <div className="relative">
            <textarea
              rows={4}
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              className="min-h-[360px] resize-y w-full rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-4 py-3.5 text-sm leading-relaxed focus:outline-none focus:ring-white/25 transition resize-none"
            />
          </div>
          <div className="text-xs text-muted-foreground"></div>
        </SenasBlock>
      </>
    </div>
  );
}

function SettingsPage() {
  const [active, setActive] = useState<SectionId>("branding");

  function saveCurrentSection() {
    window.dispatchEvent(
      new CustomEvent("clippr:save-settings", {
        detail: { section: active, silent: true },
      }),
    );
  }

  function requestSectionChange(section: SectionId) {
    if (section === active) return;
    // Guardado silencioso al cambiar de sección. No bloquea la navegación
    // ni muestra el modal de "Tenés cambios sin guardar". Los modales/paneles
    // con botón propio siguen guardando con su acción explícita.
    saveCurrentSection();
    setActive(section);
  }

  return (
    <AppShell>
      <SaveStatusIndicator />
      <div className="settings-compact-page -mt-4 sm:-mt-5 lg:-mt-6">
        <Topbar
          title="Configuración"
          subtitle="Tu negocio"
          action={null}
        />
        <div className="app-premium-shell -mt-3 sm:-mt-4 lg:-mt-5">
          <div className="pointer-events-none absolute left-1/2 top-[-120px] z-[-1] h-[620px] w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_17%_4%,rgb(139_92_246_/_0.34),transparent_38%),radial-gradient(circle_at_76%_0%,rgb(79_125_255_/_0.30),transparent_36%),radial-gradient(circle_at_46%_96%,rgb(255_123_229_/_0.14),transparent_50%)] blur-[16px]" />
          <div className="space-y-6 animate-fade-up">
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
              {/* Sidebar */}
              <aside className="space-y-5">
                {groups.map((g) => (
                  <div key={g.label}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 px-3 mb-2">
                      {g.label}
                    </div>
                    <div className="space-y-1">
                      {g.items.map((it) => {
                        const isActive = active === it.id;
                        const Icon = it.icon;
                        return (
                          <button
                            key={it.id}
                            onClick={() => requestSectionChange(it.id)}
                            className={cn(
                              "w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-all group",
                              isActive
                                ? "bg-white/[0.06] ring-1 ring-white/10 text-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
                            )}
                          >
                            <span
                              className={cn(
                                "h-8 w-8 rounded-lg grid place-items-center bg-gradient-to-br ring-1 transition-all shrink-0",
                                it.glow,
                                isActive
                                  ? "ring-white/15 shadow-[0_0_18px_-6px_currentColor]"
                                  : "ring-white/5 group-hover:ring-white/15",
                                it.tint,
                              )}
                            >
                              <Icon
                                className={cn("h-4 w-4", it.tint)}
                                strokeWidth={2}
                              />
                            </span>
                            <span className={cn(isActive && "font-medium")}>
                              {it.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="px-3 pt-3 text-[11px] text-muted-foreground/60">
                  Clippr v1.0.0
                </div>
              </aside>

              {/* Content */}
              <section className="space-y-6">
                {active === "branding" && <BrandingSection />}

                {active === "horarios" && <HorariosSection />}
                {active === "equipo" && <EquipoSection />}
                {active === "servicios" && <ServiciosSection />}

                {active === "catalogo" && <CatalogoSection />}
                {active === "cuenta" && <CuentaSection />}
                {active === "caja" && <CajaSection />}
                {active === "plan" && <PlanSection />}
              </section>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ─────────── Clientes ───────────

type ClientField = {
  key: string;
  label: string;
  required: boolean;
};

const ALL_CLIENT_FIELDS: ClientField[] = [
  { key: "nombre", label: "Nombre", required: true },
  { key: "telefono", label: "Teléfono", required: true },
  { key: "email", label: "Email", required: true },
  { key: "fecha_nacimiento", label: "Fecha de nacimiento", required: false },
  { key: "notas", label: "Notas", required: false },
];

type ClientesConfig = {
  fields: Record<string, boolean>;
  diasInactivo: number;
  diasPerdido: number;
  vipVisitasEnabled: boolean;
  vipVisitasMin: number;
  vipGastoEnabled: boolean;
  vipGastoMin: number;
};

const DEFAULT_CLIENTES_CONFIG: ClientesConfig = {
  fields: {
    nombre: true,
    telefono: true,
    email: true,
    fecha_nacimiento: true,
    notas: false,
  },
  diasInactivo: 30,
  diasPerdido: 90,
  vipVisitasEnabled: true,
  vipVisitasMin: 4,
  vipGastoEnabled: true,
  vipGastoMin: 100000,
};

// ── Helpers outside component — prevents focus loss on re-render ─────────────

function CfgCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 space-y-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

function CfgSectionTitle({ label, sub }: { label: string; sub?: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{label}</h3>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function CfgNumInput({
  label,
  value,
  onChange,
  min = 1,
  step = 1,
  prefix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: number;
  prefix?: string;
}) {
  const [local, setLocal] = React.useState(String(value));
  React.useEffect(() => {
    setLocal(String(value));
  }, [value]);
  const commit = () => {
    const n = Math.max(min, Number(local) || min);
    setLocal(String(n));
    onChange(n);
  };
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-sm text-foreground/80">{label}</span>
      <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
        {prefix && (
          <span className="text-sm text-muted-foreground">{prefix}</span>
        )}
        <input
          type="number"
          min={min}
          step={step}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          className="w-24 bg-transparent text-sm text-right tabular-nums outline-none text-foreground"
        />
      </div>
    </label>
  );
}

function CfgToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "relative h-6 w-11 rounded-full transition-all shrink-0",
        enabled ? "bg-primary/70" : "bg-white/10",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          enabled ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function ClientesSection() {
  const { businessId } = useAuth();
  const [cfg, setCfg] = useState<ClientesConfig>(DEFAULT_CLIENTES_CONFIG);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
        if (schedule._clientes) {
          setCfg({
            ...DEFAULT_CLIENTES_CONFIG,
            ...(schedule._clientes as Partial<ClientesConfig>),
          });
        }
        setLoaded(true);
      });
  }, [businessId]);

  const save = useCallback(async (showToast = true) => {
    if (!businessId) return;
    if (!showToast) reportSaveStatus("saving");
    try {
      const { data: existingRow } = await supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle();
      const existingSchedule = (existingRow?.schedule ?? {}) as Record<
        string,
        unknown
      >;
      const result = await supabase
        .from("business_settings")
        .upsert(
          {
            business_id: businessId,
            schedule: { ...existingSchedule, _clientes: cfg },
          },
          { onConflict: "business_id" },
        );
      if (result.error) throw new Error(result.error.message);
      if (showToast) toast.success("Configuración de clientes guardada");
      else reportSaveStatus("saved");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [businessId, cfg]);

  // Wire up global save button
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const section = detail?.section;
      const silent = detail?.silent === true;
      if (!section || section === "clientes") void saveRef.current(!silent);
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, []);

  const setField = (key: string, val: boolean) =>
    setCfg((prev) => ({ ...prev, fields: { ...prev.fields, [key]: val } }));

  if (!loaded)
    return (
      <div className="py-16 text-center text-sm text-muted-foreground animate-pulse">
        Cargando…
      </div>
    );

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-display font-semibold">Clientes</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Campos del formulario, segmentación automática y criterios VIP.
        </p>
      </div>

      {/* ── Campos ── */}
      <CfgCard>
        <CfgSectionTitle
          label="Campos visibles"
          sub="Los campos activos aparecen al crear o editar clientes y al agendar turnos."
        />
        <div className="space-y-2.5 pt-1">
          {ALL_CLIENT_FIELDS.map((f) => {
            const enabled = cfg.fields[f.key] ?? false;
            return (
              <div
                key={f.key}
                className="flex items-center justify-between gap-4 py-1"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    disabled={f.required}
                    onClick={() => !f.required && setField(f.key, !enabled)}
                    className={cn(
                      "h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-all",
                      enabled
                        ? "bg-primary/80 border-primary/60"
                        : "bg-white/[0.03] border-white/15",
                      f.required && "opacity-60 cursor-not-allowed",
                    )}
                  >
                    {enabled && (
                      <Check className="h-3 w-3 text-white" strokeWidth={3} />
                    )}
                  </button>
                  <span className="text-sm text-foreground/90">{f.label}</span>
                </div>
                {f.required && (
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground border border-white/10 rounded-full px-2 py-0.5">
                    Obligatorio
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CfgCard>

      {/* ── Estado ── */}
      <CfgCard>
        <CfgSectionTitle
          label="Estado de clientes"
          sub="El sistema calcula automáticamente el estado según la fecha de la última visita."
        />
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            {
              label: "Activo",
              color: "text-emerald-300",
              ring: "ring-emerald-400/25 bg-emerald-400/8",
              range: `0 – ${cfg.diasInactivo - 1} días`,
            },
            {
              label: "Inactivo",
              color: "text-cyan-300",
              ring: "ring-cyan-400/25 bg-cyan-400/8",
              range: `${cfg.diasInactivo} – ${cfg.diasPerdido - 1} días`,
            },
            {
              label: "Perdido",
              color: "text-rose-300",
              ring: "ring-rose-400/25 bg-rose-400/8",
              range: `${cfg.diasPerdido}+ días`,
            },
          ].map((s) => (
            <div key={s.label} className={cn("rounded-xl ring-1 p-3", s.ring)}>
              <div className={cn("text-xs font-semibold", s.color)}>
                {s.label}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {s.range}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-3 pt-1">
          <CfgNumInput
            label="Días para considerar cliente inactivo"
            value={cfg.diasInactivo}
            min={1}
            onChange={(n) =>
              setCfg((p) => ({
                ...p,
                diasInactivo: Math.min(n, p.diasPerdido - 1),
              }))
            }
          />
          <CfgNumInput
            label="Días para considerar cliente perdido"
            value={cfg.diasPerdido}
            min={2}
            onChange={(n) =>
              setCfg((p) => ({
                ...p,
                diasPerdido: Math.max(n, p.diasInactivo + 1),
              }))
            }
          />
        </div>
      </CfgCard>

      {/* ── VIP ── */}
      <CfgCard>
        <CfgSectionTitle
          label="Cliente VIP"
          sub="Se calcula mes a mes. Si el cliente deja de cumplir las condiciones, pierde la etiqueta automáticamente."
        />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                VIP por visitas mensuales
              </div>
              <div className="text-xs text-muted-foreground">
                Cantidad mínima de visitas en el mes actual
              </div>
            </div>
            <CfgToggle
              enabled={cfg.vipVisitasEnabled}
              onToggle={() =>
                setCfg((p) => ({
                  ...p,
                  vipVisitasEnabled: !p.vipVisitasEnabled,
                }))
              }
            />
          </div>
          {cfg.vipVisitasEnabled && (
            <CfgNumInput
              label="Visitas mínimas por mes"
              value={cfg.vipVisitasMin}
              min={1}
              onChange={(n) => setCfg((p) => ({ ...p, vipVisitasMin: n }))}
            />
          )}
        </div>
        <div className="h-px bg-white/5" />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                VIP por gasto mensual
              </div>
              <div className="text-xs text-muted-foreground">
                Gasto mínimo acumulado en el mes actual
              </div>
            </div>
            <CfgToggle
              enabled={cfg.vipGastoEnabled}
              onToggle={() =>
                setCfg((p) => ({ ...p, vipGastoEnabled: !p.vipGastoEnabled }))
              }
            />
          </div>
          {cfg.vipGastoEnabled && (
            <CfgNumInput
              label="Gasto mínimo mensual"
              value={cfg.vipGastoMin}
              min={0}
              step={1000}
              prefix="$"
              onChange={(n) => setCfg((p) => ({ ...p, vipGastoMin: n }))}
            />
          )}
        </div>
        {(cfg.vipVisitasEnabled || cfg.vipGastoEnabled) && (
          <p className="text-[11px] text-muted-foreground rounded-xl bg-white/[0.03] ring-1 ring-white/5 px-3 py-2">
            Un cliente se marca VIP si cumple{" "}
            <strong className="text-foreground">cualquiera</strong> de las
            condiciones activas durante el mes en curso.
          </p>
        )}
      </CfgCard>
    </div>
  );
}

// ─────────── Plan & facturación ───────────
const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);

const plans = [
  {
    id: "pro",
    name: "Pro",
    icon: Rocket,
    tagline: "Ideal para barberías y salones con una sucursal.",
    monthly: 29900,
    badge: "60 DÍAS GRATIS",
    highlight: true,
    cta: "Comenzar prueba gratuita",
    features: [
      "1 sucursal",
      "Profesionales ilimitados",
      "Agenda online",
      "Caja y cobros",
      "Clientes",
      "Comisiones",
      "Página de reservas",
      "Asesor IA",
      "Estadísticas del negocio",
    ],
  },
  {
    id: "business",
    name: "Business",
    icon: Store,
    tagline: "Para negocios con más de una sucursal.",
    monthly: 49900,
    badge: "MULTISUCURSAL",
    highlight: false,
    cta: "Comenzar prueba gratuita",
    features: [
      "Todo lo incluido en Pro",
      "2 sucursales incluidas",
      "Comparativa entre sucursales",
      "Dashboard consolidado",
      "Métricas por local",
      "Roles y permisos avanzados",
      "Gestión centralizada",
      "Soporte prioritario",
    ],
    extra: "+ $10.000 / mes por cada sucursal adicional",
    examples: [
      "2 sucursales → $49.900",
      "3 sucursales → $59.900",
      "4 sucursales → $69.900",
    ],
  },
];

const trustItems = [
  {
    icon: ShieldCheck,
    title: "Sin tarjeta",
    desc: "Probá 60 días sin compromiso.",
  },
  {
    icon: Cloud,
    title: "Tus datos seguros",
    desc: "Guardados en la nube.",
  },
  {
    icon: RefreshCw,
    title: "Actualizaciones incluidas",
    desc: "Mejoras sin costo extra.",
  },
  { icon: Headphones, title: "Soporte humano", desc: "Estamos para ayudarte." },
];

function PlanSection() {
  const trialTotal = 60;
  const trialLeft = 43;
  const trialPct = ((trialTotal - trialLeft) / trialTotal) * 100;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Planes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Probá Clippr gratis y después elegí el plan según la cantidad de
            sucursales.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_oklch(0.78_0.15_150)]" />
          60 días gratis
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl p-5 ring-1 ring-[oklch(0.62_0.25_295/0.28)] bg-gradient-to-br from-[oklch(0.18_0.07_290/0.78)] via-[oklch(0.12_0.04_285/0.9)] to-[oklch(0.08_0.03_275)] shadow-[0_0_60px_-30px_oklch(0.62_0.25_295/0.65)]">
        <div className="pointer-events-none absolute -top-24 -right-20 h-56 w-56 rounded-full bg-[oklch(0.72_0.22_305/0.16)] blur-3xl" />
        <div className="relative grid gap-5 lg:grid-cols-[1fr_280px] lg:items-center">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 shrink-0 rounded-xl grid place-items-center bg-[oklch(0.62_0.25_295/0.14)] ring-1 ring-[oklch(0.62_0.25_295/0.35)]">
              <CalendarDays className="h-5 w-5 text-[oklch(0.82_0.18_300)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[oklch(0.82_0.18_300)]">
                Prueba gratuita activa
              </div>
              <h2 className="mt-1 text-xl font-semibold">
                Todas las funciones de Clippr por 60 días
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sin tarjeta de crédito. Sin compromisos. Al finalizar la prueba,
                elegís Pro o Business para continuar.
              </p>
              <div className="mt-4 h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)]"
                  style={{ width: `${trialPct}%` }}
                />
              </div>
            </div>
          </div>
          <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Tiempo restante
            </div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">
              {trialLeft} días
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Después se activa el plan que elijas.
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={cn(
              "relative rounded-2xl p-6 ring-1 transition overflow-hidden",
              plan.highlight
                ? "bg-gradient-to-b from-[oklch(0.18_0.07_290)] to-[oklch(0.10_0.05_280)] ring-[oklch(0.62_0.25_295/0.5)] shadow-[0_0_50px_-18px_oklch(0.62_0.25_295/0.6)]"
                : "glass ring-white/5",
            )}
          >
            <div className="pointer-events-none absolute -top-24 -right-20 h-52 w-52 rounded-full bg-[oklch(0.62_0.25_295/0.12)] blur-3xl" />
            <div className="relative space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "h-12 w-12 rounded-xl grid place-items-center ring-1 shrink-0",
                      plan.highlight
                        ? "bg-[oklch(0.62_0.25_295/0.15)] ring-[oklch(0.62_0.25_295/0.4)]"
                        : "bg-white/5 ring-white/10",
                    )}
                  >
                    <plan.icon
                      className={cn(
                        "h-5 w-5",
                        plan.highlight
                          ? "text-[oklch(0.82_0.18_300)]"
                          : "text-muted-foreground",
                      )}
                    />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold">{plan.name}</h2>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ring-1",
                          plan.highlight
                            ? "bg-[oklch(0.62_0.25_295/0.18)] text-[oklch(0.82_0.18_300)] ring-[oklch(0.62_0.25_295/0.35)]"
                            : "bg-white/5 text-muted-foreground ring-white/10",
                        )}
                      >
                        {plan.badge}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground max-w-md">
                      {plan.tagline}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Luego de la prueba
                </div>
                <div className="mt-1 flex items-end gap-1">
                  <span className="text-4xl font-semibold tracking-tight">
                    {fmtARS(plan.monthly)}
                  </span>
                  <span className="pb-1 text-sm text-muted-foreground">
                    / mes
                  </span>
                </div>
                {plan.extra && (
                  <div className="mt-2 text-sm text-[oklch(0.82_0.18_300)]">
                    {plan.extra}
                  </div>
                )}
              </div>

              <ul className="space-y-2 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 shrink-0 text-[oklch(0.82_0.18_300)]" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {plan.examples && (
                <div className="rounded-2xl bg-white/[0.035] ring-1 ring-white/10 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Ejemplos de precio
                  </div>
                  <div className="mt-3 grid gap-2 text-sm">
                    {plan.examples.map((example) => (
                      <div
                        key={example}
                        className="flex items-center justify-between rounded-xl bg-white/[0.035] px-3 py-2 ring-1 ring-white/5"
                      >
                        <span>{example.split("→")[0].trim()}</span>
                        <span className="font-semibold text-white/90">
                          {example.split("→")[1].trim()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)] text-white shadow-[0_8px_30px_-10px_oklch(0.62_0.25_295/0.8)] hover:brightness-110">
                {plan.cta} <ChevronRight className="h-4 w-4" />
              </button>
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                <Lock className="h-3 w-3" /> Sin permanencia. Cancelás cuando
                quieras.
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl p-5 ring-1 ring-white/5 grid grid-cols-2 md:grid-cols-4 gap-4">
        {trustItems.map((t) => (
          <div key={t.title} className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl grid place-items-center bg-[oklch(0.62_0.25_295/0.12)] ring-1 ring-[oklch(0.62_0.25_295/0.3)]">
              <t.icon className="h-4.5 w-4.5 text-[oklch(0.82_0.18_300)]" />
            </div>
            <div>
              <div className="text-sm font-medium">{t.title}</div>
              <div className="text-xs text-muted-foreground">{t.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings")({ component: SettingsPage });
