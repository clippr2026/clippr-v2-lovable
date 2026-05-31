import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import {
  Check,
  MapPin,
  Phone,
  Globe,
  FileText,
  Image as ImageIcon,
  Building2,
  Upload,
  Copy,
  Timer,
  CalendarDays,
  AlarmClock,
  Plus,
  // Pencil removed (now unused)
  Trash2,
  Scissors,
  Zap,
  Eye,
  Banknote,
  Landmark,
  CreditCard,
  Wallet,
  PiggyBank,
  ArrowLeftRight,
  Rocket,
  Crown,
  Shield,
  Sparkles,
  ChevronRight,
  User as UserIcon,
  Store,
  Cloud,
  RefreshCw,
  Headphones,
  Lock,
  Users,
  Star,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SectionId = "branding" | "horarios" | "equipo" | "servicios" | "caja" | "plan";

type NavItem = {
  id: SectionId;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tint: string;
  glow: string;
};

const groups: { label: string; items: NavItem[] }[] = [
  { label: "General", items: [
    { id: "branding", label: "Branding", icon: Sparkles, tint: "text-[oklch(0.82_0.18_300)]", glow: "from-[oklch(0.7_0.25_300/0.25)] to-[oklch(0.55_0.27_285/0.05)]" },
    { id: "horarios", label: "Horarios", icon: CalendarDays, tint: "text-[oklch(0.72_0.2_245)]", glow: "from-[oklch(0.72_0.2_245/0.25)] to-[oklch(0.55_0.22_265/0.05)]" },
  ]},
  { label: "Operaciones", items: [
    { id: "equipo", label: "Equipo", icon: Users, tint: "text-[oklch(0.82_0.16_200)]", glow: "from-[oklch(0.82_0.16_200/0.25)] to-[oklch(0.7_0.2_220/0.05)]" },
    { id: "servicios", label: "Servicios", icon: Scissors, tint: "text-[oklch(0.78_0.17_140)]", glow: "from-[oklch(0.78_0.17_140/0.25)] to-[oklch(0.7_0.2_160/0.05)]" },
  ]},
  { label: "Sistema", items: [
    { id: "caja", label: "Caja", icon: Banknote, tint: "text-[oklch(0.82_0.14_75)]", glow: "from-[oklch(0.82_0.14_75/0.25)] to-[oklch(0.78_0.17_55/0.05)]" },
  ]},
  { label: "Cuenta", items: [
    { id: "plan", label: "Plan & facturación", icon: Crown, tint: "text-[oklch(0.88_0.16_320)]", glow: "from-[oklch(0.88_0.16_320/0.25)] to-[oklch(0.7_0.25_300/0.05)]" },
  ]},
];


const infoFields = [
  { icon: Building2, label: "Nombre del local", hint: "Aparece en tickets, reportes y la pantalla de login", value: "Auro Stylo" },
  { icon: MapPin, label: "Dirección", hint: "Dirección del local principal", value: "Av. Independencia 1255" },
  { icon: Phone, label: "Teléfono de contacto", hint: "Para confirmaciones y WhatsApp", value: "+54 11 0000-0000" },
  { icon: Globe, label: "Instagram / Redes", hint: "Aparece en el pie de los tickets", value: "@Aurostylo" },
];

// ─────────── shared bits ───────────
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-6 w-11 rounded-full transition-colors ring-1",
        on
          ? "bg-gradient-to-r from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)] ring-[oklch(0.78_0.17_65/0.5)]"
          : "bg-white/5 ring-white/10"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          on ? "translate-x-[22px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

function SectionCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5 ring-1 ring-white/5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-4">{label}</div>
      {children}
    </div>
  );
}

// ─────────── Horarios ───────────
const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function HorariosSection() {
  const [days, setDays] = useState(
    DAYS.map((d, i) => ({ name: d, open: "11:00", close: "20:00", enabled: i < 6 }))
  );
  return (
    <>
      <div>
        <h2 className="text-xl font-display font-semibold">Horarios de atención</h2>
        <p className="text-sm text-muted-foreground mt-1">Configurá los días y horarios en que tu barbería atiende clientes.</p>
      </div>

      <div className="glass rounded-2xl p-5 ring-1 ring-white/5">
        <div className="grid grid-cols-[120px_1fr_1fr_auto_auto] gap-3 px-1 pb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
          <div>Día</div><div>Apertura</div><div>Cierre</div><div>Abierto</div><div></div>
        </div>
        <div className="divide-y divide-white/5">
          {days.map((d, i) => (
            <div key={d.name} className={cn("grid grid-cols-[120px_1fr_1fr_auto_auto] gap-3 items-center py-3", !d.enabled && "opacity-50")}>
              <div className="text-sm font-medium">{d.name}</div>
              <input value={d.open} disabled={!d.enabled} onChange={(e) => setDays((s) => s.map((x, idx) => idx === i ? { ...x, open: e.target.value } : x))} className="rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40 disabled:cursor-not-allowed" />
              <input value={d.close} disabled={!d.enabled} onChange={(e) => setDays((s) => s.map((x, idx) => idx === i ? { ...x, close: e.target.value } : x))} className="rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40 disabled:cursor-not-allowed" />
              <Toggle on={d.enabled} onChange={(v) => setDays((s) => s.map((x, idx) => idx === i ? { ...x, enabled: v } : x))} />
              <button disabled={!d.enabled} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 ring-1 ring-white/10 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/10 disabled:opacity-40">
                <Copy className="h-3 w-3" /> Copiar
              </button>
            </div>
          ))}
        </div>
      </div>

      <SectionCard label="Turnos y reservas">
        <div className="divide-y divide-white/5">
          {[
            { icon: Timer, title: "Intervalo de turnos", hint: "Cada cuántos minutos se pueden crear turnos", value: "30 min" },
            { icon: CalendarDays, title: "Anticipación máxima", hint: "Con cuántos días de anticipación se puede reservar", value: "30 días" },
            { icon: AlarmClock, title: "Cancelación mínima", hint: "Con cuántas horas de anticipación se puede cancelar", value: "2 horas" },
          ].map((r) => {
            const Icon = r.icon;
            return (
              <div key={r.title} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center">
                  <Icon className="h-4.5 w-4.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{r.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{r.hint}</div>
                </div>
                <div className="rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm">{r.value}</div>
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
type DaySchedule = { enabled: boolean; start: string; end: string; breakStart: string; breakEnd: string };
type ScheduleMap = Record<DayKey, DaySchedule>;

const DEFAULT_SCHEDULE: ScheduleMap = {
  mon: { enabled: true,  start: "11:00", end: "20:00", breakStart: "12:00", breakEnd: "13:00" },
  tue: { enabled: true,  start: "11:00", end: "20:00", breakStart: "12:00", breakEnd: "13:00" },
  wed: { enabled: true,  start: "11:00", end: "20:00", breakStart: "12:00", breakEnd: "13:00" },
  thu: { enabled: true,  start: "11:00", end: "20:00", breakStart: "12:00", breakEnd: "13:00" },
  fri: { enabled: true,  start: "11:00", end: "20:00", breakStart: "12:00", breakEnd: "13:00" },
  sat: { enabled: true,  start: "11:00", end: "20:00", breakStart: "12:00", breakEnd: "13:00" },
  sun: { enabled: false, start: "11:00", end: "20:00", breakStart: "12:00", breakEnd: "13:00" },
};

type EmployeeRow = {
  id: string;
  name?: string | null;
  full_name?: string | null;
  is_active?: boolean | null;
  commission_pct?: number | null;
  
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
};

const inputCls = "w-full rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-primary/40";
const timeCls = "rounded-md bg-white/5 ring-1 ring-white/10 px-2 py-1 text-xs focus:outline-none w-[72px]";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function EquipoSection() {
  const { businessId } = useAuth();
  const [tab, setTab] = useState<"pros" | "users" | "perms">("pros");
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<NewProForm>(EMPTY_FORM);
  const [dlgTab, setDlgTab] = useState<"datos" | "horarios" | "perfil" | "comisiones">("datos");

  const load = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("employees")
      .select("id,full_name,is_active,commission_pct")
      .eq("business_id", businessId)
      .order("full_name", { ascending: true });
    if (error) toast.error("Error cargando profesionales: " + error.message);
    setRows((data ?? []) as EmployeeRow[]);
    setLoading(false);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setForm(EMPTY_FORM);
    setDlgTab("datos");
    setOpen(true);
  }

  async function saveProfessional() {
    if (!businessId) return;
    const name = form.fullName.trim();
    if (!name) { setDlgTab("datos"); return toast.error("Ingresá el nombre completo"); }
    setSaving(true);
    const commission = form.commissionPct ? Number(form.commissionPct) : null;
    const { data: inserted, error } = await supabase.from("employees").insert({
      business_id: businessId,
      full_name: name,
      is_active: true,
      commission_pct: commission,
      
    }).select("id").single();
    if (error || !inserted) {
      setSaving(false);
      return toast.error("Error: " + (error?.message ?? "no se pudo crear"));
    }
    // Persist extras best-effort (ignore missing columns)
    // Update optional fields that exist in the table
    const extras: Record<string, unknown> = {};
    if (form.email) extras.email = form.email;
    if (form.phone) extras.phone = form.phone;
    if (Object.keys(extras).length > 0) {
      try { await supabase.from("employees").update(extras).eq("id", inserted.id); } catch { /* ignore */ }
    }
    setSaving(false);
    toast.success("✓ Profesional agregado");
    setOpen(false);
    load();
  }

  async function toggleActive(emp: EmployeeRow) {
    const { error } = await supabase
      .from("employees")
      .update({ is_active: !(emp.is_active !== false) })
      .eq("id", emp.id);
    if (error) return toast.error("Error: " + error.message);
    load();
  }

  async function remove(emp: EmployeeRow) {
    if (!confirm(`¿Eliminar a ${emp.full_name || emp.name}?`)) return;
    const { error } = await supabase.from("employees").delete().eq("id", emp.id);
    if (error) return toast.error("Error: " + error.message);
    toast.success("Profesional eliminado");
    load();
  }

  function setDay(key: DayKey, patch: Partial<DaySchedule>) {
    setForm((f) => ({ ...f, schedule: { ...f.schedule, [key]: { ...f.schedule[key], ...patch } } }));
  }

  return (
    <>
      <div>
        <h2 className="text-xl font-display font-semibold">Equipo</h2>
        <p className="text-sm text-muted-foreground mt-1">Profesionales sincronizados con Agenda y Caja en tiempo real.</p>
      </div>

      <div className="flex items-center gap-1 border-b border-white/5">
        {([
          ["pros", "Profesionales"],
          ["users", "Usuarios"],
          ["perms", "Permisos"],
        ] as const).map(([id, label]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "relative px-4 py-2.5 text-sm transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
              {active && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)]" />}
            </button>
          );
        })}
      </div>

      {tab === "pros" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={openNew}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)] text-zinc-950 font-semibold px-4 py-2.5 text-sm shadow-lg shadow-[oklch(0.78_0.17_55/0.3)]"
            >
              <Plus className="h-4 w-4" /> Agregar profesional
            </button>
          </div>

          {loading ? (
            <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">Cargando…</div>
          ) : rows.length === 0 ? (
            <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
              No hay profesionales cargados. Agregá el primero con el botón de arriba.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {rows.map((emp, i) => {
                const displayName = emp.full_name || emp.name || "—";
                const active = emp.is_active !== false;
                return (
                  <div key={emp.id} className="glass rounded-2xl p-4 ring-1 ring-white/5">
                    <div className="flex items-center gap-3">
                      <div className={cn("h-10 w-10 rounded-full grid place-items-center text-sm font-semibold text-black bg-gradient-to-br", PRO_TINTS[i % PRO_TINTS.length])}>
                        {displayName[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{displayName}</div>
                        <div className="text-xs text-muted-foreground">
                          {emp.commission_pct != null ? `${emp.commission_pct}% comisión` : "Profesional"}
                        </div>
                      </div>
                      <span className={cn(
                        "inline-flex items-center gap-1.5 rounded-full ring-1 px-2 py-0.5 text-[10px] uppercase tracking-wider",
                        active
                          ? "bg-[oklch(0.78_0.17_140/0.12)] ring-[oklch(0.78_0.17_140/0.3)] text-[oklch(0.85_0.17_140)]"
                          : "bg-white/5 ring-white/10 text-muted-foreground"
                      )}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-[oklch(0.78_0.17_140)]" : "bg-muted-foreground")} />
                        {active ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => toggleActive(emp)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-3 py-1.5 text-xs"
                      >
                        {active ? "Desactivar" : "Activar"}
                      </button>
                      <button
                        onClick={() => remove(emp)}
                        className="inline-flex items-center justify-center rounded-lg bg-red-500/10 hover:bg-red-500/20 ring-1 ring-red-500/30 text-red-300 px-2.5 py-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab !== "pros" && (
        <div className="glass rounded-2xl p-10 ring-1 ring-white/5 text-center text-muted-foreground">
          Sección en construcción.
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4" onClick={() => !saving && setOpen(false)}>
          <div
            className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-zinc-950 ring-1 ring-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 p-5 border-b border-white/5">
              <div className="h-10 w-10 rounded-full grid place-items-center text-sm font-semibold text-black bg-gradient-to-br from-red-400 to-rose-500">
                {(form.fullName[0] || "A").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold">Nuevo profesional</div>
                <div className="text-xs text-muted-foreground">{form.role || "Barbero"}</div>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-full p-1.5 ring-1 ring-white/10 hover:bg-white/5 text-muted-foreground">✕</button>
            </div>

            <div className="flex items-center gap-6 px-5 border-b border-white/5">
              {([
                ["datos", "Datos"],
                ["horarios", "Horarios"],
                ["perfil", "Perfil"],
                ["comisiones", "Comisiones"],
              ] as const).map(([id, label]) => {
                const active = dlgTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setDlgTab(id)}
                    className={cn(
                      "relative py-3 text-sm transition-colors",
                      active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                    {active && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)]" />}
                  </button>
                );
              })}
            </div>

            <div className="p-5 space-y-4">
              {dlgTab === "datos" && (
                <div className="space-y-4">
                  <Field label="Nombre completo *">
                    <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className={inputCls} placeholder="Ej: Alejandro" />
                  </Field>
                  <Field label="Email de acceso *" hint="Este email se usará para ingresar a la plataforma.">
                    <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} placeholder="ale@gmail.com" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Teléfono">
                      <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} placeholder="11..." />
                    </Field>
                    <Field label="Rol">
                      <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputCls} placeholder="Barbero" />
                    </Field>
                  </div>
                  <label className="flex items-center gap-3 rounded-xl bg-white/5 ring-1 ring-white/10 p-3 cursor-pointer">
                    <input type="checkbox" checked={form.acceptsOnline} onChange={(e) => setForm({ ...form, acceptsOnline: e.target.checked })} className="sr-only" />
                    <span className={cn("h-5 w-9 rounded-full relative transition-colors shrink-0", form.acceptsOnline ? "bg-[oklch(0.78_0.17_55)]" : "bg-white/15")}>
                      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", form.acceptsOnline ? "left-[18px]" : "left-0.5")} />
                    </span>
                    <div className="flex-1">
                      <div className="text-sm font-medium">Acepta reservas en línea</div>
                      <div className="text-xs text-muted-foreground">Este profesional aparecerá disponible para reservas online</div>
                    </div>
                  </label>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-2">Color en agenda</div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {AGENDA_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setForm({ ...form, color: c })}
                          className={cn("h-8 w-8 rounded-full transition-all ring-2", form.color === c ? "ring-white scale-110" : "ring-white/10")}
                          style={{ background: c }}
                          aria-label={c}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {dlgTab === "horarios" && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">Configurá los días y horarios de trabajo. Los días desactivados no recibirán turnos.</p>
                  {WEEKDAYS.map(([key, label]) => {
                    const d = form.schedule[key];
                    return (
                      <div key={key} className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                        <div className="flex items-center gap-3 flex-wrap">
                          <button
                            onClick={() => setDay(key, { enabled: !d.enabled })}
                            className={cn("h-5 w-9 rounded-full relative transition-colors shrink-0", d.enabled ? "bg-[oklch(0.78_0.17_55)]" : "bg-white/15")}
                          >
                            <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", d.enabled ? "left-[18px]" : "left-0.5")} />
                          </button>
                          <div className="text-sm font-medium w-20">{label}</div>
                          {d.enabled && (
                            <>
                              <input type="time" value={d.start} onChange={(e) => setDay(key, { start: e.target.value })} className={timeCls} />
                              <span className="text-muted-foreground text-xs">a</span>
                              <input type="time" value={d.end} onChange={(e) => setDay(key, { end: e.target.value })} className={timeCls} />
                              <div className="text-xs text-muted-foreground ml-2">Descanso:</div>
                              <input type="time" value={d.breakStart} onChange={(e) => setDay(key, { breakStart: e.target.value })} className={timeCls} />
                              <span className="text-muted-foreground text-xs">-</span>
                              <input type="time" value={d.breakEnd} onChange={(e) => setDay(key, { breakEnd: e.target.value })} className={timeCls} />
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {dlgTab === "perfil" && (
                <div className="space-y-4">
                  <Field label="Nombre público">
                    <input value={form.publicName} onChange={(e) => setForm({ ...form, publicName: e.target.value })} className={inputCls} placeholder={form.fullName || "Nombre que verán los clientes"} />
                  </Field>
                  <Field label="Descripción (opcional)">
                    <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={cn(inputCls, "min-h-[90px] resize-y")} placeholder="Especialidades, experiencia, estilo…" />
                  </Field>
                  <Field label="Especialidad destacada">
                    <input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} className={inputCls} placeholder="Ej: Degradados, Color, Barba clásica" />
                  </Field>
                </div>
              )}

              {dlgTab === "comisiones" && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">Activá la comisión general. Podés ajustar por servicio luego de crear al profesional.</p>
                  <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3 flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-medium">Comisión general</div>
                      <div className="text-xs text-muted-foreground">Aplicada a todos los servicios.</div>
                    </div>
                    <input
                      type="number" min={0} max={100}
                      value={form.commissionPct}
                      onChange={(e) => setForm({ ...form, commissionPct: e.target.value })}
                      className="w-20 rounded-lg bg-white/5 ring-1 ring-white/10 px-2 py-1.5 text-sm text-right focus:outline-none"
                      placeholder="0"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 p-5 border-t border-white/5">
              <button
                onClick={saveProfessional}
                disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)] text-zinc-950 font-semibold px-4 py-2.5 text-sm disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar profesional"}
              </button>
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                className="rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-4 py-2.5 text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────── Servicios ───────────
type PriceRow = {
  id: string;
  name: string;
  price: number;
  duration_min: number | null;
  category: string | null;
  active: boolean | null;
  stock?: number | null;
};

function ServiciosSection() {
  const { businessId } = useAuth();
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<string>("__all");

  const load = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("price_catalog")
      .select("id,name,price,duration_min,category,active,stock")
      .eq("business_id", businessId)
      .order("category")
      .order("name");
    if (error) toast.error("Error: " + error.message);
    setRows((data ?? []) as PriceRow[]);
    setLoading(false);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const categories = Array.from(
    new Set(rows.map((r) => (r.category || "Otros").trim()).filter(Boolean))
  );
  const filtered = cat === "__all" ? rows : rows.filter((r) => (r.category || "Otros") === cat);

  async function toggle(r: PriceRow) {
    const { error } = await supabase
      .from("price_catalog")
      .update({ active: !r.active })
      .eq("id", r.id);
    if (error) return toast.error("Error: " + error.message);
    load();
  }

  async function remove(r: PriceRow) {
    if (!confirm(`¿Eliminar ${r.name}?`)) return;
    const { error } = await supabase.from("price_catalog").delete().eq("id", r.id);
    if (error) return toast.error("Error: " + error.message);
    toast.success("Eliminado");
    load();
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-display font-semibold">Catálogo del negocio</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Precios/servicios sincronizados con Caja → Nueva Venta. Para crear nuevos ítems usá la pestaña <b>Precios</b> en Caja & Cobro.
          </p>
        </div>
      </div>

      <div className="glass rounded-2xl ring-1 ring-white/5">
        <div className="flex items-center gap-1 px-3 pt-3 border-b border-white/5 overflow-x-auto">
          {[{ id: "__all", label: "Todos" }, ...categories.map((c) => ({ id: c, label: c }))].map((c) => {
            const active = c.id === cat;
            return (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={cn(
                  "inline-flex items-center gap-2 px-3 py-2 text-sm rounded-t-lg transition-colors whitespace-nowrap",
                  active ? "bg-white/5 text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Scissors className="h-3.5 w-3.5" />
                {c.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No hay ítems en este catálogo.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filtered.map((s) => (
              <div key={s.id} className="flex items-center gap-4 px-5 py-4">
                <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.72_0.2_245)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{s.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {s.category || "Otros"}{s.duration_min ? ` · ${s.duration_min} min` : ""}
                    {typeof s.stock === "number" ? ` · stock ${s.stock}` : ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-display text-sm font-semibold text-[oklch(0.82_0.14_75)]">${Number(s.price).toLocaleString("es-AR")}</div>
                </div>
                <span className={cn(
                  "inline-flex items-center gap-1.5 rounded-full ring-1 px-2 py-0.5 text-[10px] uppercase tracking-wider",
                  s.active
                    ? "bg-[oklch(0.78_0.17_140/0.12)] ring-[oklch(0.78_0.17_140/0.3)] text-[oklch(0.85_0.17_140)]"
                    : "bg-white/5 ring-white/10 text-muted-foreground"
                )}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", s.active ? "bg-[oklch(0.78_0.17_140)]" : "bg-muted-foreground")} /> {s.active ? "Activo" : "Inactivo"}
                </span>
                <button
                  onClick={() => toggle(s)}
                  className="rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {s.active ? "Off" : "On"}
                </button>
                <button
                  onClick={() => remove(s)}
                  className="rounded-lg bg-red-500/10 hover:bg-red-500/20 ring-1 ring-red-500/30 text-red-300 px-2 py-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}


// ─────────── Caja ───────────
function CajaSection() {
  const { businessId } = useAuth();
  const [mode, setMode] = useState<"auto" | "manual" | "disabled">("auto");
  const [methods, setMethods] = useState({ efectivo: true, transferencia: true, tarjeta: true, mp: true, cuentaDni: false });
  const [autoChange, setAutoChange] = useState(true);

  // Load approval_mode from Supabase
  useEffect(() => {
    if (!businessId) return;
    supabase.from("business_settings").select("approval_mode").eq("business_id", businessId).maybeSingle()
      .then(({ data }) => { if (data?.approval_mode) setMode(data.approval_mode as typeof mode); });
  }, [businessId]);

  async function saveMode(m: typeof mode) {
    setMode(m);
    if (!businessId) return;
    const { error } = await supabase.from("business_settings")
      .upsert({ business_id: businessId, approval_mode: m }, { onConflict: "business_id" });
    if (error) console.warn("[CajaSection] saveMode:", error.message);
  }

  const M = [
    { id: "efectivo", icon: Banknote, label: "Efectivo", tint: "text-[oklch(0.82_0.14_75)]" },
    { id: "transferencia", icon: Landmark, label: "Transferencia bancaria", tint: "text-[oklch(0.78_0.17_140)]" },
    { id: "tarjeta", icon: CreditCard, label: "Tarjeta débito / crédito", tint: "text-[oklch(0.72_0.2_245)]" },
    { id: "mp", icon: Wallet, label: "Mercado Pago", tint: "text-[oklch(0.72_0.2_245)]" },
    { id: "cuentaDni", icon: PiggyBank, label: "Cuenta DNI", tint: "text-[oklch(0.7_0.25_300)]" },
  ] as const;

  return (
    <>
      <div>
        <h2 className="text-xl font-display font-semibold">Configuración de caja</h2>
        <p className="text-sm text-muted-foreground mt-1">Definí cómo funciona el flujo de cobro y aprobación de servicios.</p>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-3 px-1">Modo de aprobación predeterminado</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            { id: "auto", icon: Zap, label: "Automático", hint: "Al terminar el servicio pasa directo a caja. Sin intervención manual." },
            { id: "manual", icon: Eye, label: "Manual", hint: "La recepcionista aprueba cada servicio antes de que pase a caja." },
          ] as const).map((opt) => {
            const Icon = opt.icon;
            const active = mode === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => saveMode(opt.id)}
                className={cn(
                  "text-left glass rounded-2xl p-5 ring-1 transition-all",
                  active
                    ? "ring-[oklch(0.78_0.17_65/0.5)] bg-gradient-to-br from-[oklch(0.82_0.14_75/0.08)] to-transparent shadow-[0_0_0_1px_oklch(0.78_0.17_65/0.3),0_10px_40px_-15px_oklch(0.78_0.17_65/0.4)]"
                    : "ring-white/5 hover:ring-white/15"
                )}
              >
                <Icon className={cn("h-6 w-6 mb-3", active ? "text-[oklch(0.82_0.14_75)]" : "text-muted-foreground")} strokeWidth={2.2} />
                <div className="font-medium">{opt.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{opt.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      <SectionCard label="Métodos de pago habilitados">
        <div className="divide-y divide-white/5">
          {M.map((m) => {
            const Icon = m.icon;
            return (
              <div key={m.id} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
                <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center">
                  <Icon className={cn("h-4.5 w-4.5", m.tint)} />
                </div>
                <div className="flex-1 font-medium text-sm">{m.label}</div>
                <Toggle on={methods[m.id]} onChange={(v) => setMethods((s) => ({ ...s, [m.id]: v }))} />
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard label="Comportamiento de caja">
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center">
            <ArrowLeftRight className="h-4.5 w-4.5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm">Calcular vuelto automáticamente</div>
            <div className="text-xs text-muted-foreground mt-0.5">Muestra el vuelto al ingresar el monto en efectivo</div>
          </div>
          <Toggle on={autoChange} onChange={setAutoChange} />
        </div>
      </SectionCard>
    </>
  );
}

// ─────────── Page ───────────
function SettingsPage() {
  const [active, setActive] = useState<SectionId>("branding");
  const [values, setValues] = useState(infoFields.map((f) => f.value));
  const [desc, setDesc] = useState("AURO STYLO");

  return (
    <AppShell>
      <Topbar title="Configuración" subtitle="Personalizá tu negocio" />
      <div className="space-y-6 animate-fade-up">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Configuración</h1>
          <p className="text-sm text-muted-foreground mt-1">Personalizá tu negocio</p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold bg-gradient-to-r from-[oklch(0.82_0.14_75)] to-[oklch(0.78_0.17_55)] text-black shadow-[0_8px_30px_-8px_oklch(0.78_0.17_65/0.5)] hover:opacity-95 transition">
          Guardar <Check className="h-4 w-4" strokeWidth={3} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Sidebar */}
        <aside className="space-y-5">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 px-3 mb-2">{g.label}</div>
              <div className="space-y-1">
                {g.items.map((it) => {
                  const isActive = active === it.id;
                  const Icon = it.icon;
                  return (
                    <button
                      key={it.id}
                      onClick={() => setActive(it.id)}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-all group",
                        isActive
                          ? "bg-white/[0.06] ring-1 ring-white/10 text-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                      )}
                    >
                      <span
                        className={cn(
                          "h-8 w-8 rounded-lg grid place-items-center bg-gradient-to-br ring-1 transition-all shrink-0",
                          it.glow,
                          isActive ? "ring-white/15 shadow-[0_0_18px_-6px_currentColor]" : "ring-white/5 group-hover:ring-white/15",
                          it.tint
                        )}
                      >
                        <Icon className={cn("h-4 w-4", it.tint)} strokeWidth={2} />
                      </span>
                      <span className={cn(isActive && "font-medium")}>{it.label}</span>
                    </button>
                  );
                })}

              </div>
            </div>
          ))}
        </aside>

        {/* Content */}
        <section className="space-y-6">
          {active === "branding" && (
            <>
              <div>
                <h2 className="text-xl font-display font-semibold">Branding</h2>
                <p className="text-sm text-muted-foreground mt-1">Personalizá la identidad visual de tu barbería en el sistema.</p>
              </div>

              <SectionCard label="Información de la barbería">
                <div className="divide-y divide-white/5">
                  {infoFields.map((f, i) => {
                    const Icon = f.icon;
                    return (
                      <div key={f.label} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                        <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center shrink-0">
                          <Icon className="h-4.5 w-4.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">{f.label}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{f.hint}</div>
                        </div>
                        <input
                          value={values[i]}
                          onChange={(e) => setValues((v) => v.map((x, idx) => (idx === i ? e.target.value : x)))}
                          className="w-72 max-w-[55%] rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-primary/40"
                        />
                      </div>
                    );
                  })}
                  <div className="flex items-start gap-4 py-4 last:pb-0">
                    <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center shrink-0">
                      <FileText className="h-4.5 w-4.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">Descripción</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Cuéntale a tus clientes sobre tu empresa, servicios o propuesta de valor</div>
                    </div>
                    <textarea
                      value={desc}
                      onChange={(e) => setDesc(e.target.value)}
                      rows={3}
                      className="w-72 max-w-[55%] rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-primary/40"
                    />
                  </div>
                </div>
              </SectionCard>

              <SectionCard label="Imágenes">
                <div className="space-y-5">
                  {[
                    { title: "Logo", hint: "Se muestra en el sidebar y en los tickets", btn: "Subir logo" },
                    { title: "Imagen de portada", hint: "Se muestra en la pantalla de login y bienvenida", btn: "Subir portada" },
                  ].map((it) => (
                    <div key={it.title} className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center shrink-0">
                        <ImageIcon className="h-4.5 w-4.5 text-muted-foreground" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-sm">{it.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{it.hint}</div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="h-16 w-24 rounded-lg bg-white/5 ring-1 ring-white/10 grid place-items-center text-[10px] text-muted-foreground">vacío</div>
                        <button className="inline-flex items-center gap-2 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-3 py-1.5 text-xs">
                          <Upload className="h-3.5 w-3.5" /> {it.btn}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </>
          )}

          {active === "horarios" && <HorariosSection />}
          {active === "equipo" && <EquipoSection />}
          {active === "servicios" && <ServiciosSection />}
          {active === "caja" && <CajaSection />}

          {active === "plan" && <PlanSection />}
        </section>
      </div>
      </div>
    </AppShell>
  );
}


// ─────────── Plan & facturación ───────────
const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

const founderPerks = [
  { icon: Rocket, label: "Acceso anticipado" },
  { icon: Sparkles, label: "Nuevas funciones primero" },
  { icon: Crown, label: "Insignia fundador" },
  { icon: Lock, label: "Precio congelado de por vida" },
];

type Billing = "mensual" | "anual";

const plans = [
  {
    id: "starter",
    name: "Starter",
    icon: UserIcon,
    tagline: "Para empezar solo.",
    monthly: 0,
    yearly: 0,
    badge: null as string | null,
    highlight: false,
    cta: "Tu plan actual",
    ctaDisabled: true,
    features: ["1 profesional", "Hasta 100 servicios mensuales", "1 sucursal", "Agenda online", "Gestión de clientes"],
  },
  {
    id: "pro",
    name: "Pro",
    icon: Rocket,
    tagline: "Para negocios que quieren crecer.",
    monthly: 29900,
    yearly: 299000,
    badge: "MÁS ELEGIDO",
    highlight: true,
    cta: "Continuar con Pro",
    ctaDisabled: false,
    features: [
      "Profesionales ilimitados",
      "Servicios ilimitados",
      "Caja y cobros",
      "Comisiones automáticas",
      "Estadísticas completas",
      "Historial financiero",
      "Soporte prioritario",
    ],
  },
  {
    id: "business",
    name: "Business",
    icon: Store,
    tagline: "Para negocios que quieren escalar.",
    monthly: 69900,
    yearly: 699000,
    badge: null,
    highlight: false,
    cta: "Elegir Business",
    ctaDisabled: false,
    features: [
      "2 sucursales o más",
      "Métricas por sucursal",
      "Comparativas avanzadas",
      "Permisos avanzados",
      "Roles personalizados",
      "Soporte prioritario 24/7",
    ],
  },
];

const trustItems = [
  { icon: ShieldCheck, title: "Sin permanencia", desc: "Cancelás cuando quieras." },
  { icon: Cloud, title: "Tus datos siempre seguros", desc: "Almacenados en la nube." },
  { icon: RefreshCw, title: "Actualizaciones incluidas", desc: "Nuevas funciones siempre." },
  { icon: Headphones, title: "Soporte humano", desc: "Estamos para ayudarte." },
];

function PlanSection() {
  const [billing, setBilling] = useState<Billing>("mensual");
  const trialTotal = 90;
  const trialLeft = 63;
  const trialPct = ((trialTotal - trialLeft) / trialTotal) * 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Planes</h1>
          <p className="text-sm text-muted-foreground mt-1">Elegí el plan que mejor se adapte a tu negocio.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_oklch(0.78_0.15_150)]" />
          En vivo
        </div>
      </div>

      {/* Fundadores card */}
      <div className="relative overflow-hidden rounded-2xl ring-1 ring-[oklch(0.62_0.25_295/0.35)] bg-gradient-to-br from-[oklch(0.18_0.07_290)] via-[oklch(0.14_0.06_285)] to-[oklch(0.10_0.05_280)] p-6 shadow-[0_0_60px_-20px_oklch(0.62_0.25_295/0.5)]">
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[oklch(0.72_0.22_305/0.18)] blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-6">
          <div className="relative h-28 w-28 shrink-0 grid place-items-center rounded-2xl bg-gradient-to-br from-[oklch(0.72_0.22_305/0.2)] to-[oklch(0.55_0.27_285/0.1)] ring-1 ring-[oklch(0.62_0.25_295/0.4)]">
            <Shield className="h-14 w-14 text-[oklch(0.82_0.18_300)] drop-shadow-[0_0_12px_oklch(0.62_0.25_295/0.6)]" strokeWidth={1.4} />
            <Crown className="absolute h-6 w-6 text-[oklch(0.88_0.16_320)] top-7" strokeWidth={1.6} />
          </div>
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-semibold">Fundadores Clippr</h2>
              <span className="text-[10px] font-semibold tracking-wider px-2 py-1 rounded-md bg-[oklch(0.62_0.25_295/0.2)] text-[oklch(0.82_0.18_300)] ring-1 ring-[oklch(0.62_0.25_295/0.4)]">
                LIMITADO
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Accedé hoy y conservá tu{" "}
              <span className="text-[oklch(0.82_0.18_300)]">precio fundador congelado de por vida.</span>
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
              {founderPerks.map((p) => (
                <div key={p.label} className="flex items-center gap-2 rounded-lg bg-white/[0.03] ring-1 ring-white/10 px-3 py-2">
                  <p.icon className="h-4 w-4 text-[oklch(0.82_0.18_300)] shrink-0" />
                  <span className="text-xs">{p.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="h-4 w-4" />
              <span><span className="text-foreground font-medium">63 / 100</span> lugares disponibles</span>
            </div>
            <button className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)] text-white shadow-[0_8px_30px_-10px_oklch(0.62_0.25_295/0.8)] hover:brightness-110 transition">
              Quiero mi acceso <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Current plan banner */}
      <div className="glass rounded-2xl p-5 ring-1 ring-white/5 grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-5 items-center">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl grid place-items-center bg-gradient-to-br from-[oklch(0.72_0.22_305/0.2)] to-[oklch(0.55_0.27_285/0.1)] ring-1 ring-[oklch(0.62_0.25_295/0.3)]">
            <CalendarDays className="h-5 w-5 text-[oklch(0.82_0.18_300)]" />
          </div>
          <div className="flex-1">
            <div className="text-sm">
              Estás disfrutando tu plan <span className="text-[oklch(0.82_0.18_300)] font-medium">Pro</span>
            </div>
            <div className="text-xs text-[oklch(0.82_0.18_300)] mt-0.5">Prueba gratis</div>
            <div className="text-xs text-muted-foreground mt-1">
              Te quedan <span className="text-foreground font-medium">{trialLeft} días</span> de prueba gratis
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/5 mt-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)]"
                style={{ width: `${trialPct}%` }}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <button className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm bg-white/5 hover:bg-white/10 ring-1 ring-white/10">
            Ver mi plan <ChevronRight className="h-4 w-4" />
          </button>
          <div className="text-[11px] text-muted-foreground">Finaliza el 18 de agosto, 2026</div>
        </div>
        <div className="inline-flex items-center gap-1 rounded-xl bg-white/5 ring-1 ring-white/10 p-1">
          {(["mensual", "anual"] as Billing[]).map((b) => (
            <button
              key={b}
              onClick={() => setBilling(b)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs capitalize transition",
                billing === b
                  ? "bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)] text-white font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {b}
            </button>
          ))}
          <span className="px-2 text-[10px] text-emerald-400">Ahorrá 2 meses</span>
        </div>
      </div>

      {/* Pricing tiers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const price = billing === "mensual" ? plan.monthly : plan.yearly;
          const suffix = billing === "mensual" ? "/mes" : "/año";
          return (
            <div
              key={plan.id}
              className={cn(
                "relative rounded-2xl p-6 ring-1 transition",
                plan.highlight
                  ? "bg-gradient-to-b from-[oklch(0.18_0.07_290)] to-[oklch(0.10_0.05_280)] ring-[oklch(0.62_0.25_295/0.5)] shadow-[0_0_50px_-15px_oklch(0.62_0.25_295/0.6)]"
                  : "glass ring-white/5"
              )}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-semibold tracking-wider bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)] text-white">
                  <Star className="h-3 w-3 fill-current" /> {plan.badge}
                </div>
              )}
              <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-4">
                <div className="flex flex-col items-start gap-3">
                  <div className={cn(
                    "h-12 w-12 rounded-xl grid place-items-center ring-1",
                    plan.highlight
                      ? "bg-[oklch(0.62_0.25_295/0.15)] ring-[oklch(0.62_0.25_295/0.4)]"
                      : "bg-white/5 ring-white/10"
                  )}>
                    <plan.icon className={cn("h-5 w-5", plan.highlight ? "text-[oklch(0.82_0.18_300)]" : "text-muted-foreground")} />
                  </div>
                  <div>
                    <div className="text-xl font-semibold">{plan.name}</div>
                    <div className="text-xs text-muted-foreground mt-1 max-w-[140px]">{plan.tagline}</div>
                  </div>
                  <div className="mt-2">
                    <div className="text-3xl font-semibold">
                      {price === 0 ? "$0" : fmtARS(price)}
                      {price > 0 && <span className="text-sm text-muted-foreground font-normal">{suffix}</span>}
                    </div>
                    <div className={cn("text-xs mt-1", plan.highlight ? "text-[oklch(0.82_0.18_300)]" : "text-muted-foreground")}>
                      {price === 0 ? "Gratis para siempre" : "Todo desbloqueado"}
                    </div>
                  </div>
                </div>
                <ul className="space-y-2 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className={cn("h-4 w-4 mt-0.5 shrink-0", plan.highlight ? "text-[oklch(0.82_0.18_300)]" : "text-emerald-400/80")} />
                      <span>{f}</span>
                    </li>
                  ))}
                  <li className="text-xs text-[oklch(0.82_0.18_300)] pt-1">y mucho más...</li>
                </ul>
              </div>
              <button
                disabled={plan.ctaDisabled}
                className={cn(
                  "mt-6 w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition",
                  plan.ctaDisabled
                    ? "bg-white/5 ring-1 ring-white/10 text-muted-foreground cursor-not-allowed"
                    : plan.highlight
                      ? "bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)] text-white shadow-[0_8px_30px_-10px_oklch(0.62_0.25_295/0.8)] hover:brightness-110"
                      : "bg-white/5 hover:bg-white/10 ring-1 ring-white/10"
                )}
              >
                {plan.cta} {!plan.ctaDisabled && <ChevronRight className="h-4 w-4" />}
              </button>
              {!plan.ctaDisabled && (
                <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                  <Lock className="h-3 w-3" /> Sin permanencia. Cancelás cuando quieras.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Trust strip */}
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
