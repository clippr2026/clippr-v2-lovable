import React, { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  Check,
  Plus,
  Trash2,
  Mail,
  UserPlus,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Loader2,
  CalendarPlus,
  Globe,
  Camera,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  SpecialDateMap,
  EmployeeSpecialDateMap,
} from "@/components/agenda/use-agenda-data";
import {
  resolveServicePricing,
  type ServiceOverrideConfig,
  type EmployeeServiceOverrideMap,
} from "@/lib/service-pricing";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import {
  SectionCard,
  reportSaveStatus,
  Toggle,
  ConfirmDialog,
  Field,
  inputCls,
  normalizePublicBooleanMap,
  getPublicVisibility,
  type PriceRow,
} from "@/components/settings/shared";

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
    serviceOverrides?: Record<string, ServiceOverrideConfig>;
    schedule?: ScheduleMap;
    specialDates?: SpecialDateMap;
    approvalEnabled?: boolean;
    approvalMode?: "auto" | "manual";
    canAddTurno?: boolean;
    canCancelTurno?: boolean;
  };
  isNew: boolean;
};

type CommissionMode = "percent" | "fixed";

type CommissionConfig = {
  enabled: boolean;
  mode: CommissionMode;
  value: string;
};

const DEFAULT_SERVICE_OVERRIDE: ServiceOverrideConfig = {
  useStandardDuration: true,
  duration_min: "",
  useStandardPrice: true,
  price: "",
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
  serviceOverrides: Record<string, ServiceOverrideConfig>;
  specialDates: SpecialDateMap;
  approvalEnabled: boolean;
  approvalMode: "auto" | "manual";
  canAddTurno: boolean;
  canCancelTurno: boolean;
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
  serviceOverrides: {},
  specialDates: {},
  approvalEnabled: false,
  approvalMode: "auto",
  canAddTurno: false,
  canCancelTurno: false,
};

/**
 * Fila compacta ícono + título + descripción + switch — usada por los 4
 * permisos del profesional (Acepta reservas online, Habilitar modo de
 * aprobación, Puede agregar turnos, Puede cancelar turnos) para que los
 * cuatro bloques sean visualmente idénticos.
 */
function PermissionToggleRow({
  icon: Icon,
  title,
  desc,
  on,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.025] ring-1 ring-white/10 px-3 py-2">
      <div className="h-8 w-8 rounded-lg bg-white/5 ring-1 ring-white/10 grid place-items-center shrink-0">
        <Icon className="h-3.5 w-3.5 text-violet-200" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-tight">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{desc}</div>
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

/**
 * Modo de aprobación de cobros de UN profesional. Antes era un switch global
 * para todo el negocio (mismo copy/lógica) — ahora vive por profesional,
 * dentro de su diálogo de edición. Sin lógica de cobro propia: solo define
 * `approvalEnabled`/`approvalMode`, que Mi Agenda ya sabe interpretar.
 */
function ApprovalModeCard({
  enabled,
  mode,
  onToggleEnabled,
  onChangeMode,
  canAddTurno,
  onToggleCanAddTurno,
  canCancelTurno,
  onToggleCanCancelTurno,
}: {
  enabled: boolean;
  mode: "auto" | "manual";
  onToggleEnabled: (v: boolean) => void;
  onChangeMode: (v: "auto" | "manual") => void;
  canAddTurno: boolean;
  onToggleCanAddTurno: (v: boolean) => void;
  canCancelTurno: boolean;
  onToggleCanCancelTurno: (v: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <PermissionToggleRow
        icon={CalendarPlus}
        title="Puede agregar turnos desde su panel"
        desc="Permite crear turnos desde Mi Agenda. Impactan en Agenda general."
        on={canAddTurno}
        onChange={onToggleCanAddTurno}
      />
      <PermissionToggleRow
        icon={Trash2}
        title="Puede cancelar turnos desde su panel"
        desc="Permite cancelar o eliminar turnos desde Mi Agenda."
        on={canCancelTurno}
        onChange={onToggleCanCancelTurno}
      />

      <PermissionToggleRow
        icon={ShieldCheck}
        title="Habilitar modo de aprobación"
        desc="Cobro directo en Caja o requiere revisión."
        on={enabled}
        onChange={onToggleEnabled}
      />

      {enabled && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 pt-0.5">
          <div
            role="button"
            tabIndex={0}
            onClick={() => onChangeMode("auto")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onChangeMode("auto");
              }
            }}
            className={cn(
              "group text-left rounded-xl p-3.5 ring-1 transition-all relative overflow-hidden cursor-pointer",
              mode === "auto"
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
                <div className="mt-0.5 text-base font-display font-semibold">
                  Automático
                </div>
              </div>
              {mode === "auto" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-400/10 ring-1 ring-violet-300/25 px-2.5 py-1 text-[11px] font-semibold text-violet-200">
                  Seleccionado
                </span>
              )}
            </div>

            <div className="relative mt-2">
              <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-200/80">
                Descripción
              </div>
              <p className="mt-1 text-xs leading-snug text-white/75">
                El profesional cobra desde su panel y el ingreso se registra
                automáticamente en Caja.
              </p>
            </div>

            <div className="relative mt-2">
              <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-200/80">
                Para qué sirve
              </div>
              <p className="mt-1 text-xs leading-snug text-white/75">
                Ideal si cada profesional cobra directamente a sus clientes.
              </p>
            </div>

            <div className="relative mt-2">
              <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-200/80">
                Ejemplo
              </div>
              <p className="mt-1 text-xs leading-snug text-white/60">
                Juan finaliza un servicio de{" "}
                <span className="font-semibold text-white/80">$20.000</span> y
                cobra desde su panel.
              </p>
              <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-white/[0.045] px-2.5 py-1.5 ring-1 ring-white/10 text-xs">
                <span className="font-mono text-[10px] text-white/42">12:00</span>
                <span className="font-semibold text-white">Juan</span>
                <span className="text-white/35">→</span>
                <span className="font-semibold text-emerald-400">Cobró</span>
              </div>
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onChangeMode("manual")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onChangeMode("manual");
              }
            }}
            className={cn(
              "group text-left rounded-xl p-3.5 ring-1 transition-all relative overflow-hidden cursor-pointer",
              mode === "manual"
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
                <div className="mt-0.5 text-base font-display font-semibold">
                  Manual
                </div>
              </div>
              {mode === "manual" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-400/10 ring-1 ring-violet-300/25 px-2.5 py-1 text-[11px] font-semibold text-violet-200">
                  Seleccionado
                </span>
              )}
            </div>

            <div className="relative mt-2">
              <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-200/80">
                Descripción
              </div>
              <p className="mt-1 text-xs leading-snug text-white/75">
                El profesional envía el cobro y Recepción lo revisa antes de
                registrarlo oficialmente.
              </p>
            </div>

            <div className="relative mt-2">
              <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-200/80">
                Para qué sirve
              </div>
              <p className="mt-1 text-xs leading-snug text-white/75">
                Ideal para que profesionales y Recepción tengan el mismo
                control sobre los servicios realizados.
              </p>
            </div>

            <div className="relative mt-2">
              <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-200/80">
                Ejemplo
              </div>
              <p className="mt-1 text-xs leading-snug text-white/60">
                Juan finaliza un servicio de{" "}
                <span className="font-semibold text-white/80">$20.000</span> y
                envía el cobro desde su panel.
              </p>
              <div className="mt-1.5 space-y-1">
                <div className="flex items-center gap-2 rounded-lg bg-white/[0.045] px-2.5 py-1.5 ring-1 ring-white/10 text-xs">
                  <span className="font-mono text-[10px] text-white/42">12:00</span>
                  <span className="font-semibold text-white">Juan</span>
                  <span className="text-white/35">→</span>
                  <span className="font-semibold text-sky-400">Envió a Recepción</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-white/[0.045] px-2.5 py-1.5 ring-1 ring-white/10 text-xs">
                  <span className="font-mono text-[10px] text-white/42">12:01</span>
                  <span className="font-semibold text-white">Recepción</span>
                  <span className="text-white/35">→</span>
                  <span className="font-semibold text-emerald-400">Cobró</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

const timeCls =
  "rounded-md bg-white/5 ring-1 ring-white/10 px-2 py-1 text-xs focus:outline-none w-[72px] [color-scheme:dark]";


export type RolePermissionId =
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

export const ROLE_LABEL_BY_ID: Record<RolePermissionId, string> = {
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



// Tarjeta de profesional memoizada: solo se re-renderiza si cambian sus props
// (este profesional o sus callbacks), no cuando cambia cualquier otro estado de
// Configuración. Reduce drásticamente los re-renders con muchos profesionales.
const ProfessionalCard = React.memo(function ProfessionalCard({
  emp,
  tintClass,
  deleting,
  online,
  onEdit,
  onToggleOnline,
  onRemove,
}: {
  emp: EmployeeRow;
  tintClass: string;
  deleting?: boolean;
  online: boolean;
  onEdit: (emp: EmployeeRow) => void;
  onToggleOnline: (emp: EmployeeRow) => void;
  onRemove: (emp: EmployeeRow) => void;
}) {
  const displayName = emp.full_name || emp.name || "—";
  return (
    <div
      className={cn(
        "glass rounded-2xl p-4 ring-1 ring-white/5 transition-opacity",
        (!online || deleting) && "opacity-70",
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
        {/* Refleja directamente el switch "Acepta reservas en línea" del
            perfil (misma fuente: employeeOnlineMap / _publicVisibility.employees)
            — no hay un estado "Activo" independiente. Un clic acá alterna el
            mismo switch, así que sigue habiendo una sola fuente de verdad
            para la visibilidad del profesional en la página pública. */}
        <button
          type="button"
          onClick={() => onToggleOnline(emp)}
          disabled={deleting}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full ring-1 px-2 py-0.5 text-[10px] uppercase tracking-wider transition hover:brightness-110 disabled:opacity-50",
            online
              ? "bg-[oklch(0.78_0.17_140/0.12)] ring-[oklch(0.78_0.17_140/0.3)] text-[oklch(0.85_0.17_140)]"
              : "bg-white/5 ring-white/10 text-muted-foreground",
          )}
          title={online ? "Desactivar reservas en línea" : "Activar reservas en línea"}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              online ? "bg-[oklch(0.78_0.17_140)]" : "bg-muted-foreground",
            )}
          />
          {online ? "ONLINE" : "OFFLINE"}
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

export function EquipoSection() {
  const { businessId } = useAuth();
  const [equipoTab, setEquipoTab] = useState<"profesionales" | "accesos">(
    "profesionales",
  );
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
  // Modo de aprobación de cobros — antes un único valor global, ahora un
  // mapa por profesional (mismo dato, mismo significado, distinta clave).
  const [employeeApprovalEnabledMap, setEmployeeApprovalEnabledMap] = useState<
    Record<string, boolean>
  >({});
  const [employeeApprovalModeMap, setEmployeeApprovalModeMap] = useState<
    Record<string, "auto" | "manual">
  >({});
  // Permisos propios del profesional dentro de Mi Agenda — mismo patrón que
  // el modo de aprobación: por profesional, no por login de acceso.
  const [employeeCanAddTurnoMap, setEmployeeCanAddTurnoMap] = useState<
    Record<string, boolean>
  >({});
  const [employeeCanCancelTurnoMap, setEmployeeCanCancelTurnoMap] = useState<
    Record<string, boolean>
  >({});
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
  // Comisiones y overrides de precio/duración por profesional-servicio,
  // cargados desde business_settings.schedule para poder hidratar el form al
  // reabrir "Editar profesional" (antes esto no se cargaba y se perdía al
  // reabrir el diálogo).
  const [employeeCommissionsMap, setEmployeeCommissionsMap] = useState<
    Record<string, Record<string, CommissionConfig>>
  >({});
  const [employeeServiceOverridesMap, setEmployeeServiceOverridesMap] =
    useState<EmployeeServiceOverrideMap>({});
  const [pendingProfessionals, setPendingProfessionals] = useState<
    PendingProfessional[]
  >([]);
  const [commissionItems, setCommissionItems] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  useBodyScrollLock(open);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<EmployeeRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingEmp, setEditingEmp] = useState<EmployeeRow | null>(null);
  const [form, setForm] = useState<NewProForm>(EMPTY_FORM);
  const [dlgTab, setDlgTab] = useState<"perfil" | "horarios" | "comisiones">(
    "perfil",
  );
  // Sub-pestañas internas de "Comisiones" — Servicios y Catálogo se editan
  // por separado sin cerrar ni mover el modal. La pestaña principal sigue
  // llamándose "Comisiones" en la barra de arriba.
  const [commTab, setCommTab] = useState<"servicios" | "catalogo">(
    "servicios",
  );
  // Ids de servicios con el bloque "Personalizar duración y precio"
  // expandido en la pestaña Comisiones — solo estado de UI, no se persiste.
  const [expandedOverrideIds, setExpandedOverrideIds] = useState<Set<string>>(
    new Set(),
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
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
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
        const loadedApprovalEnabled = (
          schedule._employeeApprovalEnabled &&
          typeof schedule._employeeApprovalEnabled === "object"
            ? schedule._employeeApprovalEnabled
            : {}
        ) as Record<string, boolean>;
        setEmployeeApprovalEnabledMap(loadedApprovalEnabled);
        const loadedApprovalMode = (
          schedule._employeeApprovalMode &&
          typeof schedule._employeeApprovalMode === "object"
            ? schedule._employeeApprovalMode
            : {}
        ) as Record<string, "auto" | "manual">;
        setEmployeeApprovalModeMap(loadedApprovalMode);
        const loadedCanAddTurno = (
          schedule._employeeAgendaAdd && typeof schedule._employeeAgendaAdd === "object"
            ? schedule._employeeAgendaAdd
            : {}
        ) as Record<string, boolean>;
        setEmployeeCanAddTurnoMap(loadedCanAddTurno);
        const loadedCanCancelTurno = (
          schedule._employeeAgendaCancel && typeof schedule._employeeAgendaCancel === "object"
            ? schedule._employeeAgendaCancel
            : {}
        ) as Record<string, boolean>;
        setEmployeeCanCancelTurnoMap(loadedCanCancelTurno);
        const loadedCommissions = (
          schedule._employeeCommissions &&
          typeof schedule._employeeCommissions === "object"
            ? schedule._employeeCommissions
            : {}
        ) as Record<string, Record<string, CommissionConfig>>;
        setEmployeeCommissionsMap(loadedCommissions);
        const loadedServiceOverrides = (
          schedule._employeeServiceOverrides &&
          typeof schedule._employeeServiceOverrides === "object"
            ? schedule._employeeServiceOverrides
            : {}
        ) as EmployeeServiceOverrideMap;
        setEmployeeServiceOverridesMap(loadedServiceOverrides);
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
          const existingServiceOverrides = (existingSchedule
            ._employeeServiceOverrides ?? {}) as Record<string, unknown>;
          const existingRoles = (existingSchedule._employeeRoles ??
            {}) as Record<string, string>;
          const existingApprovalEnabled = (existingSchedule
            ._employeeApprovalEnabled ?? {}) as Record<string, boolean>;
          const existingApprovalMode = (existingSchedule
            ._employeeApprovalMode ?? {}) as Record<string, "auto" | "manual">;
          const existingCanAddTurno = (existingSchedule
            ._employeeAgendaAdd ?? {}) as Record<string, boolean>;
          const existingCanCancelTurno = (existingSchedule
            ._employeeAgendaCancel ?? {}) as Record<string, boolean>;
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
                _employeeServiceOverrides: payload.serviceOverrides
                  ? {
                      ...existingServiceOverrides,
                      [inserted.id]: payload.serviceOverrides,
                    }
                  : existingServiceOverrides,
                _employeeRoles: {
                  ...existingRoles,
                  [inserted.id]: payload.role ?? "Profesional",
                },
                _employeeApprovalEnabled: {
                  ...existingApprovalEnabled,
                  [inserted.id]: payload.approvalEnabled === true,
                },
                _employeeApprovalMode: {
                  ...existingApprovalMode,
                  [inserted.id]: payload.approvalMode === "manual" ? "manual" : "auto",
                },
                _employeeAgendaAdd: {
                  ...existingCanAddTurno,
                  [inserted.id]: payload.canAddTurno === true,
                },
                _employeeAgendaCancel: {
                  ...existingCanCancelTurno,
                  [inserted.id]: payload.canCancelTurno === true,
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
          const existingServiceOverrides = (existingSchedule
            ._employeeServiceOverrides ?? {}) as Record<string, unknown>;
          const existingRoles = (existingSchedule._employeeRoles ??
            {}) as Record<string, string>;
          const existingApprovalEnabled = (existingSchedule
            ._employeeApprovalEnabled ?? {}) as Record<string, boolean>;
          const existingApprovalMode = (existingSchedule
            ._employeeApprovalMode ?? {}) as Record<string, "auto" | "manual">;
          const existingCanAddTurno = (existingSchedule
            ._employeeAgendaAdd ?? {}) as Record<string, boolean>;
          const existingCanCancelTurno = (existingSchedule
            ._employeeAgendaCancel ?? {}) as Record<string, boolean>;
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
                _employeeServiceOverrides: payload.serviceOverrides
                  ? {
                      ...existingServiceOverrides,
                      [payload.id]: payload.serviceOverrides,
                    }
                  : existingServiceOverrides,
                _employeeRoles: {
                  ...existingRoles,
                  [payload.id]: payload.role ?? "Profesional",
                },
                _employeeApprovalEnabled: {
                  ...existingApprovalEnabled,
                  [payload.id]: payload.approvalEnabled === true,
                },
                _employeeApprovalMode: {
                  ...existingApprovalMode,
                  [payload.id]: payload.approvalMode === "manual" ? "manual" : "auto",
                },
                _employeeAgendaAdd: {
                  ...existingCanAddTurno,
                  [payload.id]: payload.canAddTurno === true,
                },
                _employeeAgendaCancel: {
                  ...existingCanCancelTurno,
                  [payload.id]: payload.canCancelTurno === true,
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
        schedule: {
          ...existingSchedule,
          _rolePermissions: cleaned,
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
  ]);


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

    if (editingEmp) {
      // Guardado INMEDIATO y completo: antes esta rama solo persistía el
      // horario al toque y dejaba el resto (comisiones, overrides de
      // precio/duración, rol, aprobación, permisos, nombre/avatar/comisión%)
      // en una cola (`pendingProfessionals`) que recién se escribía en
      // Supabase cuando el usuario tocaba el "Guardar" GLOBAL de
      // Configuración — un segundo paso fácil de pasar por alto. Si el
      // usuario recargaba la página (o simplemente no llegaba a tocar ese
      // otro botón) antes de eso, todo lo que quedó en la cola se perdía sin
      // aviso. Ahora se persiste todo en un solo upsert, igual que ya hace
      // el alta de un profesional nuevo — "Guardar" en este diálogo
      // significa guardado de verdad, sin pasos ocultos.
      setSaving(true);
      try {
        const { error: empUpdateError } = await supabase
          .from("employees")
          .update({
            full_name: name,
            commission_pct: commission,
            avatar_url: form.avatarUrl || null,
          })
          .eq("id", editingEmp.id);
        if (empUpdateError) {
          toast.error("Error guardando profesional: " + empUpdateError.message);
          return;
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
        const existingCommissions = (existingSchedule._employeeCommissions ??
          {}) as Record<string, unknown>;
        const existingServiceOverrides = (existingSchedule
          ._employeeServiceOverrides ?? {}) as Record<string, unknown>;
        const existingRoles = (existingSchedule._employeeRoles ??
          {}) as Record<string, string>;
        const existingApprovalEnabled = (existingSchedule
          ._employeeApprovalEnabled ?? {}) as Record<string, boolean>;
        const existingApprovalMode = (existingSchedule
          ._employeeApprovalMode ?? {}) as Record<string, "auto" | "manual">;
        const existingCanAddTurno = (existingSchedule
          ._employeeAgendaAdd ?? {}) as Record<string, boolean>;
        const existingCanCancelTurno = (existingSchedule
          ._employeeAgendaCancel ?? {}) as Record<string, boolean>;
        const existingEmpScheds = (existingSchedule._employeeSchedules ??
          {}) as Record<string, unknown>;
        const existingEmpSpecial = (existingSchedule
          ._employeeSpecialDates ?? {}) as Record<string, unknown>;
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
                _employeeCommissions: {
                  ...existingCommissions,
                  [editingEmp.id]: form.commissions,
                },
                _employeeServiceOverrides: {
                  ...existingServiceOverrides,
                  [editingEmp.id]: form.serviceOverrides,
                },
                _employeeRoles: {
                  ...existingRoles,
                  [editingEmp.id]: form.role.trim() || "Profesional",
                },
                _employeeApprovalEnabled: {
                  ...existingApprovalEnabled,
                  [editingEmp.id]: form.approvalEnabled,
                },
                _employeeApprovalMode: {
                  ...existingApprovalMode,
                  [editingEmp.id]:
                    form.approvalMode === "manual" ? "manual" : "auto",
                },
                _employeeAgendaAdd: {
                  ...existingCanAddTurno,
                  [editingEmp.id]: form.canAddTurno,
                },
                _employeeAgendaCancel: {
                  ...existingCanCancelTurno,
                  [editingEmp.id]: form.canCancelTurno,
                },
                _employeeSchedules: {
                  ...existingEmpScheds,
                  [editingEmp.id]: form.schedule,
                },
                _employeeSpecialDates: {
                  ...existingEmpSpecial,
                  [editingEmp.id]: form.specialDates,
                },
                _publicVisibility: {
                  ...visibility,
                  employees: {
                    ...employeesVisibility,
                    [editingEmp.id]: form.acceptsOnline !== false,
                  },
                },
              },
            },
            { onConflict: "business_id" },
          );
        if (settingsErr) {
          toast.error(
            "No se pudo guardar la configuración del profesional. Probá de nuevo.",
          );
          return;
        }

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
        setEmployeeApprovalEnabledMap((current) => ({
          ...current,
          [editingEmp.id]: form.approvalEnabled,
        }));
        setEmployeeApprovalModeMap((current) => ({
          ...current,
          [editingEmp.id]: form.approvalMode,
        }));
        setEmployeeCanAddTurnoMap((current) => ({
          ...current,
          [editingEmp.id]: form.canAddTurno,
        }));
        setEmployeeCanCancelTurnoMap((current) => ({
          ...current,
          [editingEmp.id]: form.canCancelTurno,
        }));
        setEmployeeCommissionsMap((current) => ({
          ...current,
          [editingEmp.id]: form.commissions,
        }));
        setEmployeeServiceOverridesMap((current) => ({
          ...current,
          [editingEmp.id]: form.serviceOverrides,
        }));
        setEmployeeSchedules((current) => ({
          ...current,
          [editingEmp.id]: form.schedule,
        }));
        setEmployeeSpecialDates((current) => ({
          ...current,
          [editingEmp.id]: form.specialDates,
        }));

        toast.success("Profesional actualizado.");
        setOpen(false);
        setEditingEmp(null);
      } catch {
        toast.error("No se pudo guardar el profesional. Probá de nuevo.");
      } finally {
        setSaving(false);
      }
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
      const existingServiceOverrides = (existingSchedule
        ._employeeServiceOverrides ?? {}) as Record<string, unknown>;
      const existingRoles = (existingSchedule._employeeRoles ?? {}) as Record<
        string,
        string
      >;
      const existingApprovalEnabled = (existingSchedule
        ._employeeApprovalEnabled ?? {}) as Record<string, boolean>;
      const existingApprovalMode = (existingSchedule
        ._employeeApprovalMode ?? {}) as Record<string, "auto" | "manual">;
      const existingCanAddTurno = (existingSchedule
        ._employeeAgendaAdd ?? {}) as Record<string, boolean>;
      const existingCanCancelTurno = (existingSchedule
        ._employeeAgendaCancel ?? {}) as Record<string, boolean>;
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
              _employeeServiceOverrides: form.serviceOverrides
                ? { ...existingServiceOverrides, [newId]: form.serviceOverrides }
                : existingServiceOverrides,
              _employeeRoles: {
                ...existingRoles,
                [newId]: form.role.trim() || "Profesional",
              },
              _employeeApprovalEnabled: {
                ...existingApprovalEnabled,
                [newId]: form.approvalEnabled,
              },
              _employeeApprovalMode: {
                ...existingApprovalMode,
                [newId]: form.approvalMode,
              },
              _employeeAgendaAdd: {
                ...existingCanAddTurno,
                [newId]: form.canAddTurno,
              },
              _employeeAgendaCancel: {
                ...existingCanCancelTurno,
                [newId]: form.canCancelTurno,
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
      setEmployeeApprovalEnabledMap((current) => ({
        ...current,
        [newId]: form.approvalEnabled,
      }));
      setEmployeeApprovalModeMap((current) => ({
        ...current,
        [newId]: form.approvalMode,
      }));
      setEmployeeCanAddTurnoMap((current) => ({
        ...current,
        [newId]: form.canAddTurno,
      }));
      setEmployeeCanCancelTurnoMap((current) => ({
        ...current,
        [newId]: form.canCancelTurno,
      }));
      setEmployeeCommissionsMap((current) => ({
        ...current,
        [newId]: form.commissions,
      }));
      setEmployeeServiceOverridesMap((current) => ({
        ...current,
        [newId]: form.serviceOverrides,
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

  // Alterna "Acepta reservas en línea" directamente desde la tarjeta —
  // misma fuente de verdad que usa el switch del perfil (form.acceptsOnline,
  // ver handleEditPro/guardado): persiste en
  // business_settings.schedule._publicVisibility.employees. No toca
  // employees.is_active ni crea un estado independiente.
  const toggleOnline = useCallback(
    async (emp: EmployeeRow) => {
      if (!businessId) return;
      const nextOnline = !(employeeOnlineMap[emp.id] !== false);
      setEmployeeOnlineMap((current) => ({ ...current, [emp.id]: nextOnline }));
      const { data: existingRow, error: fetchError } = await supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle();
      if (fetchError) {
        setEmployeeOnlineMap((current) => ({ ...current, [emp.id]: !nextOnline }));
        return toast.error("No se pudo actualizar el estado online. Probá de nuevo.");
      }
      const existingSchedule = (existingRow?.schedule ?? {}) as Record<string, unknown>;
      const visibility = getPublicVisibility(existingSchedule);
      const employeesVisibility = normalizePublicBooleanMap(
        visibility.employees ?? existingSchedule._employeeOnline,
      );
      const { error } = await supabase.from("business_settings").upsert(
        {
          business_id: businessId,
          schedule: {
            ...existingSchedule,
            _publicVisibility: {
              ...visibility,
              employees: { ...employeesVisibility, [emp.id]: nextOnline },
            },
          },
        },
        { onConflict: "business_id" },
      );
      if (error) {
        setEmployeeOnlineMap((current) => ({ ...current, [emp.id]: !nextOnline }));
        toast.error("No se pudo actualizar el estado online. Probá de nuevo.");
      }
    },
    [businessId, employeeOnlineMap],
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
        approvalEnabled: employeeApprovalEnabledMap[emp.id] === true,
        approvalMode: employeeApprovalModeMap[emp.id] === "manual" ? "manual" : "auto",
        canAddTurno: employeeCanAddTurnoMap[emp.id] === true,
        canCancelTurno: employeeCanCancelTurnoMap[emp.id] === true,
        commissions: employeeCommissionsMap[emp.id] ?? {},
        serviceOverrides: employeeServiceOverridesMap[emp.id] ?? {},
      });
      setDlgTab("perfil");
      setOpen(true);
    },
    [
      employeeOnlineMap,
      employeeSchedules,
      employeeSpecialDates,
      employeeApprovalEnabledMap,
      employeeApprovalModeMap,
      employeeCanAddTurnoMap,
      employeeCanCancelTurnoMap,
      employeeCommissionsMap,
      employeeServiceOverridesMap,
    ],
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
      {/* Oculto en mobile: el drill-down de Configuración ya muestra "←
          Equipo" arriba — repetirlo acá era redundante. Desktop no tiene
          ese header, sigue siendo la única referencia. */}
      <div className="hidden lg:block">
        <h2 className="text-xl font-display font-semibold">Equipo</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Administrá tu equipo.
        </p>
      </div>

      {/* Pestañas Profesionales / Accesos — separación de siempre, restaurada
          después de un cambio anterior que las había apilado en una sola
          pantalla. Segmented control de ancho completo: en mobile queda
          claro cuál está seleccionada y no compite en ancho con nada más
          (sin scroll horizontal). */}
      <div className="flex gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
        {(
          [
            ["profesionales", "Profesionales"],
            ["accesos", "Accesos"],
          ] as const
        ).map(([id, label]) => {
          const active = equipoTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setEquipoTab(id)}
              className={cn(
                "flex-1 rounded-xl px-3.5 py-2.5 text-sm font-bold transition-all",
                active
                  ? "bg-gradient-to-r from-sky-400 to-violet-500 text-white shadow-lg shadow-sky-500/20"
                  : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {equipoTab === "profesionales" && (
      <div className="mt-4 space-y-3">
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
                  online={employeeOnlineMap[emp.id] !== false}
                  onEdit={handleEditPro}
                  onToggleOnline={toggleOnline}
                  onRemove={remove}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {equipoTab === "accesos" && (
      <div className="mt-4 space-y-3">
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
                    // Principal siempre gana — es el único badge que importa
                    // mostrar ahí (no tiene sentido "Activo" + "Principal" a
                    // la vez). Sin acceso (ninguno de los 3 estados de
                    // arriba) no muestra ningún badge — nada que decir.
                    const isPrincipal = user.id === principalAdminId;
                    const statusBadge = isPrincipal
                      ? { label: "Principal", cls: "bg-white/[0.05] text-muted-foreground ring-white/15" }
                      : user.status === "active"
                        ? { label: "Activo", cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20" }
                        : user.status === "invited"
                          ? { label: "Pendiente", cls: "bg-cyan-500/10 text-cyan-300 ring-cyan-400/20" }
                          : null;
                    return (
                    <div
                      key={user.id}
                      className="flex items-center gap-3 rounded-xl bg-white/[0.04] ring-1 ring-white/10 p-3"
                    >
                      <div className="h-9 w-9 shrink-0 rounded-full bg-white/8 ring-1 ring-white/10 grid place-items-center text-xs font-semibold">
                        {(displayTitle[0] || "A").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">
                          {displayTitle}
                        </div>
                        {statusBadge && (
                          <span
                            className={cn(
                              "mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] ring-1",
                              statusBadge.cls,
                            )}
                          >
                            {statusBadge.label}
                          </span>
                        )}
                        <div className="text-xs text-muted-foreground mt-1">
                          {user.email}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => editAccessUser(user)}
                        className="rounded-lg bg-white/[0.05] hover:bg-white/[0.09] ring-1 ring-white/10 text-foreground px-2.5 py-1.5 text-xs"
                      >
                        Editar
                      </button>
                      {!isPrincipal && (
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
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4 pt-[calc(4dvh+27px)] sm:pt-[calc(5dvh+27px)] [overscroll-behavior:contain]"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="relative flex h-[calc(86dvh-12px)] max-h-[888px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-zinc-950 ring-1 ring-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Tabs + cerrar — el modal no cambia de tamaño al cambiar de
                pestaña; solo el contenido de abajo scrollea internamente. */}
            <div className="flex shrink-0 items-center gap-6 px-5 pt-3 border-b border-white/5">
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
              <button
                onClick={() => setOpen(false)}
                className="ml-auto rounded-full p-1.5 ring-1 ring-white/10 hover:bg-white/5 text-muted-foreground"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3.5 py-2.5 space-y-4">
              {dlgTab === "perfil" && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <label className="group relative h-14 w-14 shrink-0 cursor-pointer rounded-full">
                      <div className="h-14 w-14 rounded-full overflow-hidden grid place-items-center bg-gradient-to-br from-red-400 to-rose-500 text-white font-semibold text-lg ring-1 ring-white/10">
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
                      <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-background ring-2 ring-background shadow-md transition group-hover:brightness-110">
                        <Camera className="h-3 w-3" />
                      </span>
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
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">
                        Foto del profesional
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Tocá la foto para cambiarla.
                      </div>
                      {form.avatarUrl && (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, avatarUrl: "" })}
                          className="mt-1 text-xs font-medium text-red-300 hover:text-red-200"
                        >
                          Quitar foto
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
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
                  <PermissionToggleRow
                    icon={Globe}
                    title="Acepta reservas en línea"
                    desc="Aparece disponible para reservas online."
                    on={form.acceptsOnline}
                    onChange={(v) => setForm({ ...form, acceptsOnline: v })}
                  />

                  <ApprovalModeCard
                    enabled={form.approvalEnabled}
                    mode={form.approvalMode}
                    onToggleEnabled={(v) =>
                      setForm({ ...form, approvalEnabled: v })
                    }
                    onChangeMode={(v) => setForm({ ...form, approvalMode: v })}
                    canAddTurno={form.canAddTurno}
                    onToggleCanAddTurno={(v) =>
                      setForm({ ...form, canAddTurno: v })
                    }
                    canCancelTurno={form.canCancelTurno}
                    onToggleCanCancelTurno={(v) =>
                      setForm({ ...form, canCancelTurno: v })
                    }
                  />
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
                            type="button"
                            role="switch"
                            aria-checked={d.enabled}
                            onClick={() => setDay(key, { enabled: !d.enabled })}
                            className={cn(
                              "h-5 w-9 shrink-0 overflow-hidden rounded-full relative transition-colors",
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
                </div>
              )}

              {dlgTab === "comisiones" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-1.5 rounded-2xl border border-white/10 bg-white/[0.035] p-1.5">
                    {(["servicios", "catalogo"] as const).map((tabId) => (
                      <button
                        key={tabId}
                        type="button"
                        onClick={() => setCommTab(tabId)}
                        className={cn(
                          "rounded-xl px-4 py-2 text-xs font-semibold transition-all duration-200",
                          commTab === tabId
                            ? "bg-[linear-gradient(135deg,rgba(59,130,246,0.22),rgba(139,92,246,0.22))] text-white ring-1 ring-violet-200/28 shadow-[0_0_20px_rgba(99,102,241,0.18),0_1px_0_rgba(255,255,255,0.10)_inset]"
                            : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
                        )}
                      >
                        {tabId === "servicios" ? "Servicios" : "Catálogo"}
                      </button>
                    ))}
                  </div>

                  <div className="rounded-2xl bg-[linear-gradient(135deg,rgba(139,92,246,0.09),rgba(56,189,248,0.05))] ring-1 ring-white/10 p-4">
                    <div className="font-semibold text-sm">
                      {commTab === "servicios" ? "Servicios" : "Catálogo"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {commTab === "servicios"
                        ? "Configurá qué servicios realiza este profesional, su comisión y, si corresponde, su duración y precio personalizados."
                        : "Configurá qué productos puede vender este profesional y la comisión que recibe por cada venta."}
                    </div>
                  </div>

                  {([commTab] as const).map((kind) => {
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
                        {Object.keys(grouped).length === 0 ? (
                          <div className="p-4 text-sm text-muted-foreground">
                            No hay {isServiceKind ? "servicios" : "productos"}{" "}
                            cargados.
                          </div>
                        ) : (
                          <div className="divide-y divide-white/5">
                            {Object.entries(grouped).map(
                              ([category, items]) => (
                                <div key={category} className="px-4 py-6 space-y-3">
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

                                      const overrideCfg =
                                        form.serviceOverrides[item.id] ??
                                        DEFAULT_SERVICE_OVERRIDE;
                                      const updateOverrideCfg = (
                                        patch: Partial<ServiceOverrideConfig>,
                                      ) =>
                                        setForm({
                                          ...form,
                                          serviceOverrides: {
                                            ...form.serviceOverrides,
                                            [item.id]: { ...overrideCfg, ...patch },
                                          },
                                        });
                                      // Mismo resolver que usan Agenda/Mi Agenda/Caja/Página
                                      // Pública, para que la vista previa acá coincida
                                      // exactamente con lo que se va a cobrar/agendar.
                                      const resolved = isServiceKind
                                        ? resolveServicePricing(item, "current", {
                                            current: { [item.id]: overrideCfg },
                                          })
                                        : null;
                                      const overrideExpanded =
                                        expandedOverrideIds.has(item.id);
                                      const toggleOverrideExpanded = () =>
                                        setExpandedOverrideIds((current) => {
                                          const next = new Set(current);
                                          if (next.has(item.id)) next.delete(item.id);
                                          else next.add(item.id);
                                          return next;
                                        });

                                      return (
                                        <div
                                          key={item.id}
                                          className={cn(
                                            "rounded-xl ring-1 p-3 transition-all duration-200",
                                            cfg.enabled
                                              ? "bg-white/[0.08] ring-white/[0.14] shadow-[0_0_24px_-10px_rgba(139,92,246,0.45)]"
                                              : "bg-white/[0.02] ring-white/5 opacity-70",
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
                                              role="switch"
                                              aria-checked={cfg.enabled}
                                              className={cn(
                                                "h-6 w-11 shrink-0 overflow-hidden rounded-full relative transition-colors",
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
                                                {isServiceKind && resolved && (
                                                  <>
                                                    {resolved.duration_min} min
                                                    {resolved.durationOverridden && (
                                                      <span className="text-violet-300">
                                                        {" "}
                                                        (personalizado)
                                                      </span>
                                                    )}
                                                    {" · "}
                                                  </>
                                                )}
                                                $
                                                {(resolved
                                                  ? resolved.price
                                                  : Number(item.price ?? 0)
                                                ).toLocaleString("es-AR")}
                                                {resolved?.priceOverridden && (
                                                  <span className="text-violet-300">
                                                    {" "}
                                                    (personalizado)
                                                  </span>
                                                )}
                                              </div>
                                            </div>

                                            <div
                                              className={cn(
                                                "flex items-center overflow-hidden rounded-lg ring-1 ring-white/10 transition",
                                                cfg.enabled ? "bg-white/5" : "bg-white/[0.02]",
                                              )}
                                            >
                                              <select
                                                value={cfg.mode}
                                                disabled={!cfg.enabled}
                                                onChange={(e) =>
                                                  updateCfg({
                                                    mode: e.target
                                                      .value as CommissionMode,
                                                  })
                                                }
                                                className="border-r border-white/10 bg-transparent px-2 py-1.5 text-xs focus:outline-none disabled:opacity-50"
                                              >
                                                <option value="percent">
                                                  % comisión
                                                </option>
                                                <option value="fixed">
                                                  Monto fijo
                                                </option>
                                              </select>
                                              <div className="flex items-center gap-1 px-2 py-1.5">
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

                                          {isServiceKind && (
                                            <div className="mt-2.5">
                                              <button
                                                type="button"
                                                onClick={toggleOverrideExpanded}
                                                className={cn(
                                                  "inline-flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition",
                                                  overrideExpanded
                                                    ? "bg-violet-500/[0.12] text-violet-200 ring-1 ring-violet-400/25"
                                                    : "bg-white/[0.03] text-violet-200/80 ring-1 ring-white/10 hover:bg-white/[0.06] hover:text-violet-200",
                                                )}
                                              >
                                                <span>
                                                  Personalizar duración y precio
                                                </span>
                                                <ChevronDown
                                                  className={cn(
                                                    "h-3.5 w-3.5 shrink-0 transition-transform",
                                                    overrideExpanded && "rotate-180",
                                                  )}
                                                />
                                              </button>

                                              {overrideExpanded && (
                                                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                  {/* Duración — valor siempre alineado a la
                                                      izquierda del campo, estándar o personalizado. */}
                                                  <div className="rounded-lg bg-white/[0.035] ring-1 ring-white/10 p-2.5">
                                                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                                                      Duración
                                                    </div>
                                                    <label className="mt-1 flex items-center gap-2 text-xs">
                                                      <input
                                                        type="checkbox"
                                                        checked={overrideCfg.useStandardDuration}
                                                        onChange={(e) =>
                                                          updateOverrideCfg({
                                                            useStandardDuration:
                                                              e.target.checked,
                                                          })
                                                        }
                                                        className="h-3.5 w-3.5 accent-primary"
                                                      />
                                                      <span>Usar duración estándar</span>
                                                    </label>
                                                    <div className="mt-1.5 flex items-center gap-1 rounded-lg bg-white/5 ring-1 ring-white/10 px-2 py-1.5">
                                                      {overrideCfg.useStandardDuration ? (
                                                        <span className="text-sm">
                                                          {Number(item.duration_min ?? 30) ||
                                                            30}{" "}
                                                          min
                                                        </span>
                                                      ) : (
                                                        <>
                                                          <input
                                                            type="number"
                                                            min={1}
                                                            value={overrideCfg.duration_min}
                                                            onChange={(e) =>
                                                              updateOverrideCfg({
                                                                duration_min:
                                                                  e.target.value,
                                                              })
                                                            }
                                                            className="w-16 bg-transparent text-sm text-left focus:outline-none"
                                                            placeholder="30"
                                                          />
                                                          <span className="text-xs text-muted-foreground">
                                                            min
                                                          </span>
                                                        </>
                                                      )}
                                                    </div>
                                                  </div>

                                                  {/* Precio — valor siempre alineado a la
                                                      derecha del campo, estándar o personalizado. */}
                                                  <div className="rounded-lg bg-white/[0.035] ring-1 ring-white/10 p-2.5">
                                                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                                                      Precio
                                                    </div>
                                                    <label className="mt-1 flex items-center gap-2 text-xs">
                                                      <input
                                                        type="checkbox"
                                                        checked={overrideCfg.useStandardPrice}
                                                        onChange={(e) =>
                                                          updateOverrideCfg({
                                                            useStandardPrice:
                                                              e.target.checked,
                                                          })
                                                        }
                                                        className="h-3.5 w-3.5 accent-primary"
                                                      />
                                                      <span>Usar precio estándar</span>
                                                    </label>
                                                    <div className="mt-1.5 flex items-center justify-end gap-1 rounded-lg bg-white/5 ring-1 ring-white/10 px-2 py-1.5">
                                                      {overrideCfg.useStandardPrice ? (
                                                        <span className="text-sm">
                                                          $
                                                          {Number(
                                                            item.price ?? 0,
                                                          ).toLocaleString("es-AR")}
                                                        </span>
                                                      ) : (
                                                        <>
                                                          <span className="text-xs text-muted-foreground">
                                                            $
                                                          </span>
                                                          <input
                                                            type="number"
                                                            min={0}
                                                            value={overrideCfg.price}
                                                            onChange={(e) =>
                                                              updateOverrideCfg({
                                                                price: e.target.value,
                                                              })
                                                            }
                                                            className="w-20 bg-transparent text-sm text-right focus:outline-none"
                                                            placeholder="0"
                                                          />
                                                        </>
                                                      )}
                                                    </div>
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          )}
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

            <div
              className="flex shrink-0 items-center gap-2 px-5 pt-3 border-t border-white/5"
              style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            >
              {editingEmp ? (
                <button
                  type="button"
                  onClick={() => setConfirmDel(editingEmp)}
                  disabled={saving || deletingId === editingEmp.id}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-transparent px-4 py-2.5 text-sm font-semibold text-red-300 ring-1 ring-red-500/40 transition hover:bg-red-500/10 disabled:opacity-50"
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
                className="inline-flex min-w-[160px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-4 py-2.5 text-sm shadow-[0_10px_26px_-10px_rgba(139,92,246,0.65),inset_0_1px_0_rgba(255,255,255,0.2)] transition hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100"
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
