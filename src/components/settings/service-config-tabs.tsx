import * as React from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Toggle } from "@/components/settings/shared";
import { SelectClippr } from "@/components/ui/select-clippr";
import { DateClippr } from "@/components/ui/date-clippr";
import { DAY_KEYS, type DayKey } from "@/lib/availability";
import {
  backfillPromotionVigencia,
  type Promotion,
  type PromotionDiscountType,
  type ServiceOverrideConfig,
} from "@/lib/service-pricing";
import {
  normalizeServiceScheduleConfig,
  type ServiceDayWindow,
  type ServiceWindowMap,
} from "@/lib/service-schedule";

// Pestañas del editor de un servicio: Profesionales (quién lo hace, precio y comisión), Horarios (días y
// horas del servicio y por profesional) y Promo. Cada una guarda por su cuenta, sobre los mismos datos que
// antes se editaban en Equipo y Promociones — nada se duplica ni se pierde.

type Emp = { id: string; name: string; commissionPct: number | null; commissionEnabled: boolean };
type Schedule = Record<string, any>;

const DAY_LABEL: Record<DayKey, string> = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miércoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sábado",
  sun: "Domingo",
};
const WEEK: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const timeCls =
  "flex h-12 min-h-0 w-full min-w-0 max-w-full appearance-none items-center rounded-xl py-0 leading-none [&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:text-left border border-white/10 bg-black/30 px-3 text-lg font-semibold text-white focus:border-violet-400/50 focus:outline-none disabled:opacity-40";
const inputCls =
  "h-12 w-full min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 text-base font-semibold text-white placeholder:text-white/35 focus:border-violet-400/50 focus:outline-none";
const cardCls = "rounded-2xl border border-white/10 bg-white/[0.05] p-3.5";
const saveBtnCls =
  "h-12 w-full rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white shadow-[0_8px_24px_-10px_rgba(56,189,248,0.75)] disabled:opacity-60";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

function useBranchEmployees() {
  const { businessId, activeBranchId } = useAuth();
  const [employees, setEmployees] = React.useState<Emp[]>([]);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let q = supabase.from("employees").select("id,full_name,is_active,commission_pct,commission_enabled").eq("business_id", businessId);
    if (activeBranchId) q = q.eq("branch_id", activeBranchId);
    q.order("full_name").then(({ data }) => {
      if (cancelled) return;
      setEmployees(
        ((data ?? []) as Array<{ id: string; full_name: string | null; is_active: boolean | null; commission_pct: number | string | null; commission_enabled: boolean | null }>)
          .filter((e) => e.is_active !== false)
          .map((e) => ({
            id: e.id,
            name: e.full_name ?? "Sin nombre",
            commissionPct: e.commission_pct == null || e.commission_pct === "" ? null : Number(e.commission_pct),
            commissionEnabled: e.commission_enabled !== false,
          })),
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, activeBranchId]);
  return { employees, loading, businessId, activeBranchId };
}

async function readBusinessSchedule(businessId: string): Promise<Schedule> {
  const { data } = await supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle();
  return (data?.schedule ?? {}) as Schedule;
}

// Lee el horario del negocio justo antes de escribir y solo cambia lo que `mutate` toca.
async function patchBusinessSchedule(businessId: string, mutate: (schedule: Schedule) => Schedule): Promise<string | null> {
  const existing = await readBusinessSchedule(businessId);
  const { error } = await supabase
    .from("business_settings")
    .upsert({ business_id: businessId, schedule: mutate({ ...existing }) }, { onConflict: "business_id" });
  return error ? error.message : null;
}

function Loading() {
  return (
    <div className="grid place-items-center py-10 text-white/60">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-white/15 p-4 text-base text-white/60">{children}</p>;
}

// ─────────────────────────────── Profesionales ───────────────────────────────

type StaffDraft = { offers: boolean; generates: boolean; ownPrice: boolean; price: string; commMode: "percent" | "fixed"; commValue: string; generalPct: string };

const DEFAULT_OVERRIDE: ServiceOverrideConfig = {
  enabled: true,
  useStandardDuration: true,
  duration_min: "",
  useStandardPrice: true,
  price: "",
  useStandardEffectivePrice: true,
  effectivePrice: "",
};

export function ServiceProfessionalsTab({ serviceId, listPrice }: { serviceId: string; listPrice: number }) {
  const { employees, loading, businessId } = useBranchEmployees();
  const [draft, setDraft] = React.useState<Record<string, StaffDraft>>({});
  const [ready, setReady] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [serviceComm, setServiceComm] = React.useState("");

  React.useEffect(() => {
    if (!businessId || loading) return;
    let cancelled = false;
    void readBusinessSchedule(businessId).then((schedule) => {
      if (cancelled) return;
      const star = (schedule._employeeCommissions ?? {})["*"]?.[serviceId];
      setServiceComm(star && String(star.value ?? "").trim() ? (star.mode === "fixed" ? `$${star.value}` : `${star.value}%`) : "");
      const overrides = (schedule._employeeServiceOverrides ?? {}) as Record<string, Record<string, ServiceOverrideConfig>>;
      const commissions = (schedule._employeeCommissions ?? {}) as Record<string, Record<string, { mode?: string; value?: string }>>;
      const next: Record<string, StaffDraft> = {};
      for (const e of employees) {
        const ov = overrides[e.id]?.[serviceId];
        const cm = commissions[e.id]?.[serviceId];
        next[e.id] = {
          offers: ov?.enabled !== false,
          generates: !(cm as { noCommission?: boolean } | undefined)?.noCommission,
          ownPrice: !!ov && ov.useStandardPrice === false,
          price: ov?.price ?? "",
          commMode: cm?.mode === "fixed" && String(cm?.value ?? "").trim() !== "" ? "fixed" : "percent",
          commValue: cm?.value ?? "",
          generalPct: e.commissionPct == null ? "" : String(e.commissionPct),
        };
      }
      setDraft(next);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, loading, employees, serviceId]);

  const update = (id: string, patch: Partial<StaffDraft>) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  async function save() {
    if (!businessId) return;
    setSaving(true);
    const error = await patchBusinessSchedule(businessId, (schedule) => {
      const overrides = { ...(schedule._employeeServiceOverrides ?? {}) } as Record<string, Record<string, ServiceOverrideConfig>>;
      const commissions = { ...(schedule._employeeCommissions ?? {}) } as Record<string, Record<string, unknown>>;
      for (const e of employees) {
        const d = draft[e.id];
        if (!d) continue;
        const prevOv = overrides[e.id]?.[serviceId] ?? DEFAULT_OVERRIDE;
        overrides[e.id] = {
          ...(overrides[e.id] ?? {}),
          [serviceId]: {
            ...prevOv,
            enabled: d.offers,
            useStandardPrice: !(d.offers && d.ownPrice && d.price.trim() !== ""),
            price: d.offers && d.ownPrice ? d.price.trim() : "",
          },
        };
        const empCommissions = { ...(commissions[e.id] ?? {}) };
        if (d.offers && !d.generates) empCommissions[serviceId] = { enabled: true, mode: "fixed", value: "0", noCommission: true };
        else if (d.offers && d.commValue.trim() !== "") empCommissions[serviceId] = { enabled: true, mode: d.commMode, value: d.commValue.trim() };
        else delete empCommissions[serviceId];
        commissions[e.id] = empCommissions;
      }
      return { ...schedule, _employeeServiceOverrides: overrides, _employeeCommissions: commissions };
    });
    let errorGeneral: string | null = null;
    if (!error) {
      for (const e of employees) {
        const d = draft[e.id];
        if (!d) continue;
        const next = d.generalPct.trim() === "" ? null : Number(d.generalPct.replace(",", "."));
        if (next === e.commissionPct || (next != null && !Number.isFinite(next))) continue;
        const { error: upErr } = await supabase.from("employees").update({ commission_pct: next }).eq("id", e.id);
        if (upErr) errorGeneral = upErr.message;
      }
    }
    setSaving(false);
    if (error || errorGeneral) return toast.error("No se pudo guardar: " + (error ?? errorGeneral));
    toast.success("Profesionales guardados");
  }

  if (loading || !ready) return <Loading />;
  if (employees.length === 0) return <Empty>No hay profesionales activos en esta sucursal.</Empty>;

  return (
    <div className="space-y-3">
      <p className="text-base text-white/65">Elegí quiénes hacen este servicio, cuánto cobra cada uno y su comisión. La comisión del servicio se pone en Datos; acá la cambiás solo para quien sea distinto.</p>
      {employees.map((e) => {
        const d = draft[e.id];
        if (!d) return null;
        return (
          <div key={e.id} className={cardCls}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 truncate text-lg font-semibold text-white">{e.name}</div>
              <div className="flex items-center gap-2.5">
                <span className={cn("text-base font-medium", d.offers ? "text-emerald-300" : "text-white/50")}>{d.offers ? "Lo hace" : "No lo hace"}</span>
                <Toggle on={d.offers} onChange={(v) => update(e.id, { offers: v })} />
              </div>
            </div>
            {d.offers ? (
              <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-base font-semibold text-white">Precio</span>
                    <div className="flex items-center gap-2.5">
                      <span className="text-base text-white/65">{d.ownPrice ? "Precio propio" : `Usa ${money(listPrice)}`}</span>
                      <Toggle on={d.ownPrice} onChange={(v) => update(e.id, { ownPrice: v })} />
                    </div>
                  </div>
                  {d.ownPrice ? (
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-white/50">$</span>
                      <input
                        inputMode="numeric"
                        value={d.price}
                        onChange={(ev) => update(e.id, { price: ev.target.value.replace(/\D/g, "") })}
                        placeholder="0"
                        className={cn(inputCls, "pl-7")}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-base font-semibold text-white">Genera comisión</span>
                  <div className="flex items-center gap-2.5">
                    <span className="text-base text-white/65">{d.generates && e.commissionEnabled ? "Sí" : "No"}</span>
                    <Toggle on={d.generates && e.commissionEnabled} onChange={(v) => update(e.id, { generates: v })} />
                  </div>
                </div>
                {!e.commissionEnabled ? (
                  <p className="text-base text-amber-200">Este profesional tiene la comisión apagada en todo el sistema, por eso no genera en ningún servicio.</p>
                ) : null}
                {d.generates && e.commissionEnabled ? (
                <div>
                  <div className="mb-1.5 text-base font-semibold text-white">Comisión en este servicio</div>
                  <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
                    <SelectClippr
                      opciones={[
                        { id: "percent", label: "%" },
                        { id: "fixed", label: "$ fijo" },
                      ]}
                      valor={d.commMode}
                      onChange={(v) => update(e.id, { commMode: v === "fixed" ? "fixed" : "percent" })}
                    />
                    <input
                      inputMode="decimal"
                      value={d.commValue}
                      onChange={(ev) => update(e.id, { commValue: ev.target.value.replace(/[^\d.,]/g, "") })}
                      placeholder={serviceComm ? `Vacío = ${serviceComm}` : "Vacío = la del servicio"}
                      className={inputCls}
                    />
                  </div>
                  <p className="mt-1.5 text-base text-white/55">
                    {d.commValue.trim()
                      ? "Se usa esta para este profesional."
                      : serviceComm
                        ? `Usa la comisión del servicio: ${serviceComm}.`
                        : d.generalPct.trim()
                          ? `El servicio no tiene comisión: usa la general del profesional (${d.generalPct}%).`
                          : "Sin comisión del servicio ni general: no gana comisión acá."}
                  </p>
                </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      <button type="button" onClick={() => void save()} disabled={saving} className={saveBtnCls}>
        {saving ? "Guardando…" : "Guardar profesionales"}
      </button>
    </div>
  );
}

// ─────────────────────────────────── Horarios ───────────────────────────────

const DEFAULT_WINDOW: ServiceDayWindow = { enabled: true, start: "11:00", end: "20:00" };

function fullWeek(map?: ServiceWindowMap): ServiceWindowMap {
  const out: ServiceWindowMap = {};
  for (const k of DAY_KEYS) out[k] = map?.[k] ?? { ...DEFAULT_WINDOW };
  return out;
}

function DaysEditor({ value, onChange }: { value: ServiceWindowMap; onChange: (next: ServiceWindowMap) => void }) {
  return (
    <div className="space-y-2.5">
      {WEEK.map((k) => {
        const w = value[k] ?? DEFAULT_WINDOW;
        const set = (patch: Partial<ServiceDayWindow>) => onChange({ ...value, [k]: { ...w, ...patch } });
        return (
          <div key={k} className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-white">{DAY_LABEL[k]}</span>
              <Toggle on={w.enabled} onChange={(v) => set({ enabled: v })} />
            </div>
            {w.enabled ? (
              <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                <input type="time" value={w.start} onChange={(e) => set({ start: e.target.value })} className={timeCls} />
                <input type="time" value={w.end} onChange={(e) => set({ end: e.target.value })} className={timeCls} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ServiceScheduleTab({ serviceId }: { serviceId: string }) {
  const { employees, loading, businessId } = useBranchEmployees();
  const [ready, setReady] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [svcCustom, setSvcCustom] = React.useState(false);
  const [svcDays, setSvcDays] = React.useState<ServiceWindowMap>(fullWeek());
  const [offers, setOffers] = React.useState<Record<string, boolean>>({});
  const [empCustom, setEmpCustom] = React.useState<Record<string, boolean>>({});
  const [empDays, setEmpDays] = React.useState<Record<string, ServiceWindowMap>>({});

  React.useEffect(() => {
    if (!businessId || loading) return;
    let cancelled = false;
    void readBusinessSchedule(businessId).then((schedule) => {
      if (cancelled) return;
      const cfg = normalizeServiceScheduleConfig(schedule);
      const overrides = (schedule._employeeServiceOverrides ?? {}) as Record<string, Record<string, ServiceOverrideConfig>>;
      setSvcCustom(!!cfg.service[serviceId]);
      setSvcDays(fullWeek(cfg.service[serviceId]));
      const o: Record<string, boolean> = {};
      const c: Record<string, boolean> = {};
      const d: Record<string, ServiceWindowMap> = {};
      for (const e of employees) {
        o[e.id] = overrides[e.id]?.[serviceId]?.enabled !== false;
        const own = cfg.employee[serviceId]?.[e.id];
        c[e.id] = !!own;
        d[e.id] = fullWeek(own);
      }
      setOffers(o);
      setEmpCustom(c);
      setEmpDays(d);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, loading, employees, serviceId]);

  async function save() {
    if (!businessId) return;
    setSaving(true);
    const error = await patchBusinessSchedule(businessId, (schedule) => {
      const svc = { ...(schedule._serviceSchedules ?? {}) } as Record<string, unknown>;
      if (svcCustom) svc[serviceId] = svcDays;
      else delete svc[serviceId];
      const perSvc = { ...(schedule._serviceEmployeeSchedules ?? {}) } as Record<string, Record<string, unknown>>;
      const inner = { ...(perSvc[serviceId] ?? {}) };
      for (const e of employees) {
        if (empCustom[e.id] && offers[e.id]) inner[e.id] = empDays[e.id];
        else delete inner[e.id];
      }
      if (Object.keys(inner).length > 0) perSvc[serviceId] = inner;
      else delete perSvc[serviceId];
      return { ...schedule, _serviceSchedules: svc, _serviceEmployeeSchedules: perSvc };
    });
    setSaving(false);
    if (error) return toast.error("No se pudo guardar: " + error);
    toast.success("Horarios guardados");
  }

  if (loading || !ready) return <Loading />;
  const doers = employees.filter((e) => offers[e.id]);

  return (
    <div className="space-y-4">
      <div className={cardCls}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-white">Días y horarios del servicio</div>
            <div className="text-base text-white/60">{svcCustom ? "Solo en estos días y horas" : "Todos los días, según el horario del local"}</div>
          </div>
          <Toggle on={svcCustom} onChange={setSvcCustom} />
        </div>
        {svcCustom ? (
          <div className="mt-3">
            <DaysEditor value={svcDays} onChange={setSvcDays} />
          </div>
        ) : null}
      </div>

      <div className="text-lg font-semibold text-white">Horario por profesional</div>
      <p className="-mt-2 text-base text-white/60">Nunca pasa del horario general de cada uno. Sirve para acotarlo solo en este servicio.</p>
      {doers.length === 0 ? <Empty>Ningún profesional hace este servicio todavía.</Empty> : null}
      {doers.map((e) => (
        <div key={e.id} className={cardCls}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold text-white">{e.name}</div>
              <div className="text-base text-white/60">{empCustom[e.id] ? "Horario propio en este servicio" : "Usa su horario general"}</div>
            </div>
            <Toggle on={!!empCustom[e.id]} onChange={(v) => setEmpCustom((c) => ({ ...c, [e.id]: v }))} />
          </div>
          {empCustom[e.id] ? (
            <div className="mt-3">
              <DaysEditor value={empDays[e.id] ?? fullWeek()} onChange={(next) => setEmpDays((d) => ({ ...d, [e.id]: next }))} />
            </div>
          ) : null}
        </div>
      ))}
      <button type="button" onClick={() => void save()} disabled={saving} className={saveBtnCls}>
        {saving ? "Guardando…" : "Guardar horarios"}
      </button>
    </div>
  );
}

// ───────────────────────────────────── Promo ─────────────────────────────────

type PromoKind = "percent" | "fixed" | "final";

type PromoDraft = {
  id: string | null;
  name: string;
  active: boolean;
  kind: PromoKind;
  value: string;
  requiresCode: boolean;
  code: string;
  employeeIds: string[];
  hasVigencia: boolean;
  startDate: string;
  endDate: string;
  days: Promotion["days"];
  useMaxTotal: boolean;
  maxTotal: string;
  useMaxPerClient: boolean;
  maxPerClient: string;
};

function defaultDays(): Promotion["days"] {
  const d = {} as Promotion["days"];
  for (const k of DAY_KEYS) d[k] = { enabled: true, start: "", end: "" };
  return d;
}

function draftFromPromo(p: Promotion): PromoDraft {
  return {
    id: p.id,
    name: p.name,
    active: p.active,
    kind: p.discountType === "percent" ? "percent" : "fixed",
    value: p.discountValue,
    requiresCode: p.requiresCode,
    code: p.code,
    employeeIds: p.employeeIds,
    hasVigencia: p.hasVigencia,
    startDate: p.startDate,
    endDate: p.endDate,
    days: p.days ?? defaultDays(),
    useMaxTotal: p.maxUsesTotal != null,
    maxTotal: p.maxUsesTotal != null ? String(p.maxUsesTotal) : "",
    useMaxPerClient: p.maxUsesPerClient != null,
    maxPerClient: p.maxUsesPerClient != null ? String(p.maxUsesPerClient) : "",
  };
}

export function ServicePromoTab({ serviceId, serviceName, listPrice }: { serviceId: string; serviceName: string; listPrice: number }) {
  const { employees, loading, businessId, activeBranchId } = useBranchEmployees();
  const [promos, setPromos] = React.useState<Promotion[]>([]);
  const [names, setNames] = React.useState<Record<string, string>>({});
  const [ready, setReady] = React.useState(false);
  const [draft, setDraft] = React.useState<PromoDraft | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!businessId || !activeBranchId) {
      setReady(true);
      return;
    }
    const [{ data: bs }, { data: svc }] = await Promise.all([
      supabase.from("branch_settings" as any).select("schedule").eq("business_id", businessId).eq("branch_id", activeBranchId).maybeSingle(),
      supabase.from("price_catalog").select("id,name").eq("business_id", businessId).not("duration_min", "is", null).is("deleted_at", null),
    ]);
    const schedule = ((bs as any)?.schedule ?? {}) as Schedule;
    setPromos((Array.isArray(schedule._promotions) ? (schedule._promotions as Promotion[]) : []).map(backfillPromotionVigencia));
    const map: Record<string, string> = {};
    for (const s of (svc ?? []) as Array<{ id: string; name: string }>) map[s.id] = s.name;
    setNames(map);
    setReady(true);
  }, [businessId, activeBranchId]);
  React.useEffect(() => {
    void load();
  }, [load]);

  // Se guarda leyendo lo último de la base, para no pisar promos de otros servicios ni sus contadores de uso.
  async function persist(mutate: (current: Promotion[]) => Promotion[]): Promise<boolean> {
    if (!businessId || !activeBranchId) return false;
    const { data: row } = await supabase
      .from("branch_settings" as any)
      .select("schedule")
      .eq("business_id", businessId)
      .eq("branch_id", activeBranchId)
      .maybeSingle();
    const existing = ((row as any)?.schedule ?? {}) as Schedule;
    const current = Array.isArray(existing._promotions) ? (existing._promotions as Promotion[]) : [];
    const next = mutate(current);
    const { error } = await supabase
      .from("branch_settings" as any)
      .upsert({ business_id: businessId, branch_id: activeBranchId, schedule: { ...existing, _promotions: next } }, { onConflict: "business_id,branch_id" });
    if (error) {
      toast.error("No se pudo guardar: " + error.message);
      return false;
    }
    setPromos(next.map(backfillPromotionVigencia));
    return true;
  }

  const mine = promos.filter((p) => p.serviceIds.includes(serviceId));

  function newDraft(): PromoDraft {
    return {
      id: null,
      name: `Promo ${serviceName}`,
      active: true,
      kind: "percent",
      value: "",
      requiresCode: false,
      code: "",
      employeeIds: employees.map((e) => e.id),
      hasVigencia: false,
      startDate: "",
      endDate: "",
      days: defaultDays(),
      useMaxTotal: false,
      maxTotal: "",
      useMaxPerClient: false,
      maxPerClient: "",
    };
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error("Ingresá un nombre");
    let discountType: PromotionDiscountType = draft.kind === "percent" ? "percent" : "fixed";
    let discountValue = draft.value;
    if (draft.kind === "final") {
      const finalPrice = Number(draft.value) || 0;
      if (finalPrice <= 0 || finalPrice >= listPrice) return toast.error(`El precio de la promo tiene que ser menor a ${money(listPrice)}`);
      discountValue = String(Math.round(listPrice - finalPrice));
    }
    if (!discountValue || Number(discountValue) <= 0) return toast.error("Ingresá el descuento o el precio de la promo");
    if (draft.requiresCode && !draft.code.trim()) return toast.error("Ingresá un código");
    setSaving(true);
    const ok = await persist((current) => {
      const prev = current.find((p) => p.id === draft.id) ?? null;
      const promo: Promotion = {
        id: prev?.id ?? crypto.randomUUID(),
        name: draft.name.trim(),
        imageUrl: prev?.imageUrl ?? null,
        description: prev?.description ?? "",
        active: draft.active,
        discountType,
        discountValue,
        requiresCode: draft.requiresCode,
        code: draft.code.trim().toUpperCase(),
        serviceIds: prev?.serviceIds ?? [serviceId],
        categoryNames: prev?.categoryNames ?? [],
        employeeIds: draft.employeeIds,
        hasVigencia: draft.hasVigencia,
        startDate: draft.startDate,
        endDate: draft.endDate,
        days: draft.days,
        maxUsesTotal: draft.useMaxTotal ? Math.max(0, Number(draft.maxTotal) || 0) : null,
        maxUsesPerClient: draft.useMaxPerClient ? Math.max(0, Number(draft.maxPerClient) || 0) : null,
        usageCount: prev?.usageCount ?? 0,
        usedByClient: prev?.usedByClient ?? {},
      };
      return prev ? current.map((p) => (p.id === promo.id ? promo : p)) : [...current, promo];
    });
    setSaving(false);
    if (ok) {
      toast.success("Promo guardada");
      setDraft(null);
    }
  }

  async function removeFromThisService(p: Promotion) {
    const shared = p.serviceIds.length > 1;
    const ok = await persist((current) =>
      shared
        ? current.map((x) => (x.id === p.id ? { ...x, serviceIds: x.serviceIds.filter((id) => id !== serviceId) } : x))
        : current.filter((x) => x.id !== p.id),
    );
    if (ok) {
      toast.success(shared ? "Servicio quitado de la promo" : "Promo eliminada");
      setDraft(null);
    }
  }

  if (loading || !ready) return <Loading />;

  if (draft) {
    const editingPromo = promos.find((p) => p.id === draft.id) ?? null;
    const otherServices = editingPromo ? editingPromo.serviceIds.filter((id) => id !== serviceId).map((id) => names[id]).filter(Boolean) : [];
    const set = (patch: Partial<PromoDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
    const setDay = (k: DayKey, patch: Partial<Promotion["days"][DayKey]>) => setDraft((d) => (d ? { ...d, days: { ...d.days, [k]: { ...d.days[k], ...patch } } } : d));
    const finalPreview = draft.kind === "final" ? Number(draft.value) || 0 : draft.kind === "percent" ? listPrice * (1 - (Number(draft.value) || 0) / 100) : listPrice - (Number(draft.value) || 0);
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setDraft(null)} className="text-base font-semibold text-violet-200">
          ← Volver
        </button>
        {otherServices.length > 0 ? (
          <p className="rounded-2xl border border-amber-300/25 bg-amber-400/[0.08] p-3 text-base text-amber-100">
            Esta promo también vale para: {otherServices.join(", ")}. Si la cambiás, cambia en todos.
          </p>
        ) : null}
        <div className={cardCls}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-lg font-semibold text-white">Promo activa</span>
            <Toggle on={draft.active} onChange={(v) => set({ active: v })} />
          </div>
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Nombre de la promo" className={cn(inputCls, "mt-3")} />
        </div>

        <div className={cardCls}>
          <div className="mb-2 text-lg font-semibold text-white">Precio de la promo</div>
          <SelectClippr
            opciones={[
              { id: "percent", label: "Descuento en %" },
              { id: "fixed", label: "Descuento en $" },
              { id: "final", label: "Precio final de la promo" },
            ]}
            valor={draft.kind}
            onChange={(v) => set({ kind: v as PromoKind, value: "" })}
          />
          <input
            inputMode="numeric"
            value={draft.value}
            onChange={(e) => set({ value: e.target.value.replace(/\D/g, "") })}
            placeholder={draft.kind === "percent" ? "Ej: 20" : "Ej: 5000"}
            className={cn(inputCls, "mt-2.5")}
          />
          {draft.value ? (
            <p className="mt-2 text-base text-white/65">
              Lista {money(listPrice)} → <b className="text-emerald-300">{money(Math.max(0, finalPreview))}</b>
            </p>
          ) : null}
        </div>

        <div className={cardCls}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-lg font-semibold text-white">Pide un código</span>
            <Toggle on={draft.requiresCode} onChange={(v) => set({ requiresCode: v })} />
          </div>
          {draft.requiresCode ? <input value={draft.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="CÓDIGO" className={cn(inputCls, "mt-3 uppercase")} /> : null}
        </div>

        <div className={cardCls}>
          <div className="mb-2 text-lg font-semibold text-white">Profesionales que la usan</div>
          <div className="flex flex-wrap gap-2">
            {employees.map((e) => {
              const on = draft.employeeIds.includes(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => set({ employeeIds: on ? draft.employeeIds.filter((x) => x !== e.id) : [...draft.employeeIds, e.id] })}
                  className={cn("h-11 rounded-full px-4 text-base font-semibold ring-1 transition", on ? "bg-violet-500/25 text-white ring-violet-300/50" : "bg-white/[0.05] text-white/60 ring-white/10")}
                >
                  {e.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className={cardCls}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-semibold text-white">Vigencia</div>
              <div className="text-base text-white/60">{draft.hasVigencia ? "Solo en estas fechas y días" : "Siempre vigente"}</div>
            </div>
            <Toggle on={draft.hasVigencia} onChange={(v) => set({ hasVigencia: v })} />
          </div>
          {draft.hasVigencia ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <div className="mb-1 text-base text-white/60">Desde</div>
                  <DateClippr value={draft.startDate} onChange={(v) => set({ startDate: v })} placeholder="Sin inicio" />
                </div>
                <div>
                  <div className="mb-1 text-base text-white/60">Hasta</div>
                  <DateClippr value={draft.endDate} onChange={(v) => set({ endDate: v })} placeholder="Sin fin" />
                </div>
              </div>
              <div className="text-base text-white/60">Días y horario (vacío = todo el día)</div>
              {WEEK.map((k) => {
                const d = draft.days[k] ?? { enabled: true, start: "", end: "" };
                return (
                  <div key={k} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-semibold text-white">{DAY_LABEL[k]}</span>
                      <Toggle on={d.enabled} onChange={(v) => setDay(k, { enabled: v })} />
                    </div>
                    {d.enabled ? (
                      <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                        <input type="time" value={d.start} onChange={(e) => setDay(k, { start: e.target.value })} className={timeCls} />
                        <input type="time" value={d.end} onChange={(e) => setDay(k, { end: e.target.value })} className={timeCls} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className={cardCls}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-semibold text-white">Límite de usos</div>
              <div className="text-base text-white/60">{editingPromo ? `${editingPromo.usageCount} usados hasta ahora` : "Total de veces que se puede usar"}</div>
            </div>
            <Toggle on={draft.useMaxTotal} onChange={(v) => set({ useMaxTotal: v })} />
          </div>
          {draft.useMaxTotal ? <input inputMode="numeric" value={draft.maxTotal} onChange={(e) => set({ maxTotal: e.target.value.replace(/\D/g, "") })} placeholder="Ej: 100" className={cn(inputCls, "mt-3")} /> : null}
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
            <div className="min-w-0">
              <div className="text-lg font-semibold text-white">Límite por cliente</div>
              <div className="text-base text-white/60">Veces que puede usarla cada cliente</div>
            </div>
            <Toggle on={draft.useMaxPerClient} onChange={(v) => set({ useMaxPerClient: v })} />
          </div>
          {draft.useMaxPerClient ? <input inputMode="numeric" value={draft.maxPerClient} onChange={(e) => set({ maxPerClient: e.target.value.replace(/\D/g, "") })} placeholder="Ej: 1" className={cn(inputCls, "mt-3")} /> : null}
        </div>

        <button type="button" onClick={() => void save()} disabled={saving} className={saveBtnCls}>
          {saving ? "Guardando…" : "Guardar promo"}
        </button>
        {editingPromo ? (
          <button type="button" onClick={() => void removeFromThisService(editingPromo)} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-red-500/10 text-base font-semibold text-red-300 ring-1 ring-red-400/30">
            <Trash2 className="h-4 w-4" />
            {editingPromo.serviceIds.length > 1 ? "Quitar este servicio de la promo" : "Eliminar promo"}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-base text-white/65">Descuentos de este servicio: precio, días, profesionales, código y límites.</p>
      {mine.length === 0 ? <Empty>Este servicio no tiene promo.</Empty> : null}
      {mine.map((p) => (
        <button key={p.id} type="button" onClick={() => setDraft(draftFromPromo(p))} className={cn(cardCls, "block w-full text-left")}>
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-lg font-semibold text-white">{p.name}</span>
            <span className={cn("shrink-0 text-base font-semibold", p.active ? "text-emerald-300" : "text-white/50")}>{p.active ? "Activa" : "Apagada"}</span>
          </div>
          <div className="mt-1 text-base text-white/65">
            {p.discountType === "percent" ? `${p.discountValue}% de descuento` : `${money(Number(p.discountValue) || 0)} de descuento`}
            {p.requiresCode ? ` · Código ${p.code}` : ""}
            {p.maxUsesTotal != null ? ` · ${p.usageCount}/${p.maxUsesTotal} usos` : p.usageCount ? ` · ${p.usageCount} usos` : ""}
          </div>
        </button>
      ))}
      <button type="button" onClick={() => setDraft(newDraft())} className={saveBtnCls}>
        + Nueva promo
      </button>
    </div>
  );
}
