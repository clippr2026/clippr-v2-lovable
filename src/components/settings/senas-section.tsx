import { DEFAULT_SENAS_MESSAGE as DEFAULT_MESSAGE } from "@/lib/senas-default-message";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Field, SectionCard, Toggle, inputCls, useUnsavedGuard, FloatingSaveButton } from "@/components/settings/shared";

// Se guarda en business_settings.senas_config (JSON). Los campos que esta pantalla
// no maneja (por ejemplo el texto viejo "msg") se conservan al guardar.
// Una regla de seña: a qué clientes aplica (según la regla) y en qué servicios.
type SenasRule = { enabled: boolean; all_services: boolean; services: string[] };
type SenasConfig = {
  enabled: boolean;
  rules: {
    all: SenasRule; // a cualquier cliente
    first: SenasRule; // clientes que vienen por primera vez
    noshow: SenasRule & { min: number }; // clientes que faltaron `min` veces o más
  };
  amount_type: "percent" | "fixed";
  amount_value: number;
  proof_mode: "review" | "auto";
  hold_minutes: number;
  lost_dist: "local" | "professional" | "split" | "custom";
  lost_prof: number;
  message: string;
  payment: {
    transfer: { enabled: boolean; alias: string; cbu: string; holder: string; bank: string };
  };
};

type Service = { id: string; name: string; category: string | null };


const emptyRule = (): SenasRule => ({ enabled: false, all_services: false, services: [] });

const DEFAULTS: SenasConfig = {
  enabled: false,
  rules: { all: emptyRule(), first: emptyRule(), noshow: { ...emptyRule(), min: 1 } },
  amount_type: "percent",
  amount_value: 30,
  proof_mode: "review",
  hold_minutes: 30,
  lost_dist: "local",
  lost_prof: 0,
  message: DEFAULT_MESSAGE,
  payment: { transfer: { enabled: true, alias: "", cbu: "", holder: "", bank: "" } },
};

const HOLD_OPTIONS = [
  { v: 30, l: "30 minutos" },
  { v: 60, l: "1 hora" },
  { v: 120, l: "2 horas" },
  { v: 240, l: "4 horas" },
  { v: 720, l: "12 horas" },
  { v: 1440, l: "24 horas" },
];

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function ruleFromRaw(x: any): SenasRule {
  return { enabled: !!x?.enabled, all_services: !!x?.all_services, services: strList(x?.services) };
}

// Configuración anterior (scope + trigger + lista "siempre") → las tres reglas de hoy.
function rulesFromLegacy(r: Record<string, any>): SenasConfig["rules"] {
  const allServices = r.scope === "all";
  const services = strList(r.services);
  const always = strList(r.always_services);
  const noShowMin = Math.max(0, Number(r.no_show_min) || 0);
  if (r.trigger === "conditional") {
    return {
      all: { enabled: always.length > 0, all_services: false, services: always },
      first: { enabled: !!r.first_time, all_services: allServices, services },
      noshow: { enabled: noShowMin > 0, all_services: allServices, services, min: noShowMin || 1 },
    };
  }
  return {
    all: { enabled: true, all_services: allServices, services: [...new Set([...services, ...always])] },
    first: emptyRule(),
    noshow: { ...emptyRule(), min: 1 },
  };
}

function fromRaw(raw: Record<string, any> | null): SenasConfig {
  const r = raw ?? {};
  const t = (r.payment?.transfer ?? {}) as Record<string, any>;
  const type = r.amount_type === "fixed" ? "fixed" : "percent";
  const rules: SenasConfig["rules"] = r.rules
    ? {
        all: ruleFromRaw(r.rules.all),
        first: ruleFromRaw(r.rules.first),
        noshow: { ...ruleFromRaw(r.rules.noshow), min: Math.max(1, Number(r.rules.noshow?.min) || 1) },
      }
    : rulesFromLegacy(r);
  return {
    enabled: !!r.enabled,
    rules,
    amount_type: type,
    amount_value: Number(r.amount_value) > 0 ? Number(r.amount_value) : DEFAULTS.amount_value,
    proof_mode: r.proof_mode === "auto" ? "auto" : "review",
    hold_minutes: Number(r.hold_minutes) > 0 ? Number(r.hold_minutes) : DEFAULTS.hold_minutes,
    lost_dist: ["local", "professional", "split", "custom"].includes(r.lost_dist) ? r.lost_dist : "local",
    lost_prof: Math.min(100, Math.max(0, Number(r.lost_prof) || 0)),
    message: typeof r.message === "string" ? r.message : typeof r.msg === "string" ? r.msg : DEFAULT_MESSAGE,
    payment: {
      transfer: {
        enabled: t.enabled !== false,
        alias: String(t.alias ?? ""),
        cbu: String(t.cbu ?? ""),
        holder: String(t.holder ?? ""),
        bank: String(t.bank ?? ""),
      },
    },
  };
}

function Choice({
  on,
  onClick,
  title,
  hint,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-xl px-3.5 py-3 text-left ring-1 transition",
        on ? "bg-primary/15 ring-primary/50" : "bg-white/[0.03] ring-white/10 hover:bg-white/[0.06]",
      )}
    >
      <div className="text-sm font-semibold">{title}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </button>
  );
}

function ServiceChips({
  grouped,
  selected,
  onToggle,
  hidden,
}: {
  grouped: [string, Service[]][];
  selected: string[];
  onToggle: (id: string) => void;
  /** Servicios ya elegidos en otro caso: no se ofrecen acá (un servicio va en un solo caso). */
  hidden?: Set<string>;
}) {
  const visible = grouped
    .map(([cat, list]) => [cat, list.filter((s) => selected.includes(s.id) || !hidden?.has(s.id))] as [string, Service[]])
    .filter(([, list]) => list.length > 0);
  return (
    <div className="mt-3 space-y-3">
      {grouped.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay servicios cargados.</p>}
      {grouped.length > 0 && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">Ya elegiste todos los servicios en los otros casos.</p>
      )}
      {visible.map(([cat, list]) => (
        <div key={cat}>
          <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">{cat}</div>
          <div className="flex flex-wrap gap-2">
            {list.map((s) => {
              const on = selected.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onToggle(s.id)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition",
                    on ? "bg-primary/20 text-foreground ring-primary/60" : "bg-white/[0.03] text-muted-foreground ring-white/10",
                  )}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Un caso (interruptor): al activarlo aparecen los servicios para elegir.
function RuleBlock({
  title,
  hint,
  rule,
  grouped,
  takenByOthers,
  onPatch,
  onToggleService,
}: {
  title: string;
  hint: string;
  rule: SenasRule;
  grouped: [string, Service[]][];
  takenByOthers: Set<string>;
  onPatch: (patch: Partial<SenasRule>) => void;
  onToggleService: (id: string) => void;
}) {
  return (
    <div className={cn("rounded-xl p-3.5 ring-1 transition", rule.enabled ? "bg-primary/10 ring-primary/40" : "bg-white/[0.03] ring-white/10")}>
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
        <Toggle on={rule.enabled} onChange={(v) => onPatch({ enabled: v })} />
      </label>
      {rule.enabled && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">¿En qué servicios?</div>
          <ServiceChips grouped={grouped} selected={rule.services} onToggle={onToggleService} hidden={takenByOthers} />
        </div>
      )}
    </div>
  );
}

export function SenasSection() {
  const { businessId, activeBranchId } = useAuth();
  const [cfg, setCfg] = useState<SenasConfig>(DEFAULTS);
  const [raw, setRaw] = useState<Record<string, any>>({});
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useUnsavedGuard(dirty);

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let svcQuery = supabase
      .from("price_catalog")
      .select("id,name,category")
      .eq("business_id", businessId)
      .not("duration_min", "is", null)
      .is("deleted_at", null)
      .order("name", { ascending: true });
    if (activeBranchId) svcQuery = svcQuery.eq("branch_id", activeBranchId);
    const [{ data: settings }, { data: svc }] = await Promise.all([
      supabase.from("business_settings").select("senas_config").eq("business_id", businessId).maybeSingle(),
      svcQuery,
    ]);
    const stored = ((settings as any)?.senas_config ?? {}) as Record<string, any>;
    const svcList = ((svc ?? []) as Service[]).filter((s) => !!s.name);
    const loaded = fromRaw(stored);
    // Una regla anterior que valía para "todos los servicios" pasa a la lista explícita.
    const allIds = svcList.map((s) => s.id);
    if (loaded.rules.all.all_services) loaded.rules.all = { ...loaded.rules.all, all_services: false, services: allIds };
    if (loaded.rules.first.all_services) loaded.rules.first = { ...loaded.rules.first, all_services: false, services: allIds };
    if (loaded.rules.noshow.all_services) loaded.rules.noshow = { ...loaded.rules.noshow, all_services: false, services: allIds };
    setRaw(stored);
    setCfg(loaded);
    setServices(svcList);
    setDirty(false);
    setLoading(false);
  }, [businessId, activeBranchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof SenasConfig>(key: K, value: SenasConfig[K]) => {
    setCfg((c) => ({ ...c, [key]: value }));
    setDirty(true);
  };
  const setTransfer = (patch: Partial<SenasConfig["payment"]["transfer"]>) => {
    setCfg((c) => ({ ...c, payment: { ...c.payment, transfer: { ...c.payment.transfer, ...patch } } }));
    setDirty(true);
  };

  const grouped = useMemo(() => {
    const map = new Map<string, Service[]>();
    for (const s of services) {
      const k = s.category?.trim() || "Servicios";
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return [...map.entries()];
  }, [services]);

  type RuleKey = keyof SenasConfig["rules"];
  const takenBy = (key: RuleKey) =>
    new Set((Object.keys(cfg.rules) as RuleKey[]).filter((k) => k !== key).flatMap((k) => cfg.rules[k].services));
  const patchRule = (key: RuleKey, patch: Partial<SenasRule> & { min?: number }) => {
    setCfg((c) => ({ ...c, rules: { ...c.rules, [key]: { ...c.rules[key], ...patch } } }));
    setDirty(true);
  };
  const toggleRuleService = (key: RuleKey, id: string) => {
    const cur = cfg.rules[key].services;
    patchRule(key, { services: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  const validate = (): string | null => {
    if (!cfg.enabled) return null;
    const active = (Object.entries(cfg.rules) as [RuleKey, SenasRule][]).filter(([, r]) => r.enabled);
    if (active.length === 0) return "Activá al menos un caso en el que se pida seña.";
    if (active.some(([, r]) => r.services.length === 0)) return "En cada caso activado, elegí al menos un servicio.";
    if (cfg.amount_type === "percent" && (cfg.amount_value <= 0 || cfg.amount_value > 100))
      return "El porcentaje de la seña debe estar entre 1 y 100.";
    if (cfg.amount_type === "fixed" && cfg.amount_value <= 0) return "El monto de la seña debe ser mayor a 0.";
    const t = cfg.payment.transfer;
    if (!t.enabled) return "Activá la transferencia para que el cliente sepa cómo pagar.";
    if (!t.alias.trim() && !t.cbu.trim()) return "Cargá el alias o el CBU/CVU donde reciben las señas.";
    return null;
  };

  const save = async (): Promise<boolean> => {
    if (!businessId) return false;
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return false;
    }
    setSaving(true);
    try {
      const next = {
        ...raw,
        enabled: cfg.enabled,
        // Los campos de la configuración anterior (scope, services, trigger…) quedan como estaban:
        // con `rules` presente la base los ignora.
        rules: {
          all: { ...cfg.rules.all, all_services: false },
          first: { ...cfg.rules.first, all_services: false },
          // Con una falta alcanza.
          noshow: { ...cfg.rules.noshow, all_services: false, min: 1 },
        },
        amount_type: cfg.amount_type,
        amount_value: cfg.amount_value,
        proof_mode: cfg.proof_mode,
        hold_minutes: cfg.hold_minutes,
        lost_dist: cfg.lost_dist,
        lost_prof: cfg.lost_dist === "custom" ? cfg.lost_prof : cfg.lost_dist === "professional" ? 100 : cfg.lost_dist === "split" ? 50 : 0,
        lost_local: cfg.lost_dist === "custom" ? 100 - cfg.lost_prof : cfg.lost_dist === "professional" ? 0 : cfg.lost_dist === "split" ? 50 : 100,
        message: cfg.message.trim(),
        payment: {
          ...(raw.payment ?? {}),
          transfer: {
            enabled: cfg.payment.transfer.enabled,
            alias: cfg.payment.transfer.alias.trim(),
            cbu: cfg.payment.transfer.cbu.trim(),
            holder: cfg.payment.transfer.holder.trim(),
            bank: cfg.payment.transfer.bank.trim(),
          },
        },
      };
      const table = supabase.from("business_settings") as any;
      const { data: existing } = await table.select("business_id").eq("business_id", businessId).maybeSingle();
      const { error } = existing
        ? await table.update({ senas_config: next }).eq("business_id", businessId)
        : await table.insert({ business_id: businessId, senas_config: next });
      if (error) throw error;
      setRaw(next);
      setDirty(false);
      toast.success("Configuración de señas guardada");
      return true;
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const off = !cfg.enabled;
  const example = cfg.amount_type === "percent" ? Math.round((25000 * Math.min(cfg.amount_value, 100)) / 100) : Math.min(cfg.amount_value, 25000);

  return (
    <div className="space-y-4 pb-24">
      <SectionCard
        label="Pedir seña"
        headerRight={<Toggle on={cfg.enabled} onChange={(v) => set("enabled", v)} />}
      >
        <p className="text-sm text-muted-foreground">
          Con la seña activa, el cliente paga una parte (o el total) para asegurar su turno. La seña se descuenta del cobro
          final y la comisión del barbero se calcula recién cuando el turno se realiza.
        </p>
      </SectionCard>

      <div className={cn("space-y-4 transition-opacity", off && "pointer-events-none opacity-40")}>
        <SectionCard label="¿Cuándo se pide seña?">
          <p className="text-sm text-muted-foreground">
            Activá cada caso y elegí en qué servicios se pide. Un servicio va en un solo caso: los que ya elegiste en otro no aparecen.
          </p>
          <div className="mt-3 space-y-3">
            <RuleBlock
              title="Para todos los clientes"
              hint="Piden seña siempre, sin importar quién reserve."
              rule={cfg.rules.all}
              grouped={grouped}
              takenByOthers={takenBy("all")}
              onPatch={(patch) => patchRule("all", patch)}
              onToggleService={(id) => toggleRuleService("all", id)}
            />
            <RuleBlock
              title="Clientes que vienen por primera vez"
              hint="Solo si es su primer turno."
              rule={cfg.rules.first}
              grouped={grouped}
              takenByOthers={takenBy("first")}
              onPatch={(patch) => patchRule("first", patch)}
              onToggleService={(id) => toggleRuleService("first", id)}
            />
            <RuleBlock
              title="Clientes que no asistieron"
              hint="Si faltaron una vez a un turno, ya se les pide."
              rule={cfg.rules.noshow}
              grouped={grouped}
              takenByOthers={takenBy("noshow")}
              onPatch={(patch) => patchRule("noshow", patch)}
              onToggleService={(id) => toggleRuleService("noshow", id)}
            />
          </div>
        </SectionCard>

        <SectionCard label="¿Cuánto se pide?">
          <div className="grid gap-2">
            <Choice
              on={cfg.amount_type === "percent" && cfg.amount_value === 100}
              onClick={() => { set("amount_type", "percent"); set("amount_value", 100); }}
              title="El total del servicio"
            />
            <Choice
              on={cfg.amount_type === "percent" && cfg.amount_value !== 100}
              onClick={() => { set("amount_type", "percent"); if (cfg.amount_value === 100) set("amount_value", 30); }}
              title="Un porcentaje"
            />
            <Choice on={cfg.amount_type === "fixed"} onClick={() => set("amount_type", "fixed")} title="Un monto fijo" />
          </div>
          {!(cfg.amount_type === "percent" && cfg.amount_value === 100) && (
            <div className="mt-3 max-w-[200px]">
              <Field label={cfg.amount_type === "percent" ? "Porcentaje (%)" : "Monto ($)"}>
                <input
                  type="number"
                  min={1}
                  value={cfg.amount_value || ""}
                  onChange={(e) => set("amount_value", Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Ejemplo: en un servicio de $25.000 se pediría ${example.toLocaleString("es-AR")}.
          </p>
        </SectionCard>

        <SectionCard label="¿Cómo pagan?">
          <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
            <div className="mb-3 text-sm font-semibold">Transferencia bancaria</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Alias">
                <input value={cfg.payment.transfer.alias} onChange={(e) => setTransfer({ alias: e.target.value })} className={inputCls} />
              </Field>
              <Field label="CBU / CVU">
                <input value={cfg.payment.transfer.cbu} onChange={(e) => setTransfer({ cbu: e.target.value })} className={inputCls} inputMode="numeric" />
              </Field>
              <Field label="Titular">
                <input value={cfg.payment.transfer.holder} onChange={(e) => setTransfer({ holder: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Banco (opcional)">
                <input value={cfg.payment.transfer.bank} onChange={(e) => setTransfer({ bank: e.target.value })} className={inputCls} />
              </Field>
            </div>
          </div>
          <div className="mt-2 rounded-xl bg-white/[0.02] p-3 text-sm text-muted-foreground ring-1 ring-white/5">
            Mercado Pago: próximamente.
          </div>

          <div className="mt-4 grid gap-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">Comprobante</div>
            <Choice
              on={cfg.proof_mode === "auto"}
              onClick={() => set("proof_mode", "auto")}
              title="Con enviar el comprobante alcanza"
              hint="El turno queda reservado apenas el cliente sube el comprobante."
            />
            <Choice
              on={cfg.proof_mode === "review"}
              onClick={() => set("proof_mode", "review")}
              title="Yo reviso el comprobante"
              hint="El turno queda pendiente hasta que apruebes la seña."
            />
          </div>

          <div className="mt-4 max-w-[240px]">
            <Field label="Tiempo para pagar" hint="Si no paga a tiempo, el turno puede liberarse.">
              <select value={cfg.hold_minutes} onChange={(e) => set("hold_minutes", Number(e.target.value))} className={inputCls}>
                {HOLD_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </select>
            </Field>
          </div>
        </SectionCard>

        <SectionCard label="Si el cliente pierde la seña">
          <p className="mb-3 text-sm text-muted-foreground">
            Cuando un turno con seña se cancela o el cliente no asiste, la app te pregunta si la retenés o la devolvés. Si la
            retenés, así se reparte por defecto (podés cambiarlo en cada turno):
          </p>
          <div className="grid gap-2">
            <Choice on={cfg.lost_dist === "local"} onClick={() => set("lost_dist", "local")} title="Se queda en el local" />
            <Choice on={cfg.lost_dist === "professional"} onClick={() => set("lost_dist", "professional")} title="Es para el barbero" />
            <Choice on={cfg.lost_dist === "split"} onClick={() => set("lost_dist", "split")} title="Mitad y mitad" />
            <Choice on={cfg.lost_dist === "custom"} onClick={() => set("lost_dist", "custom")} title="Otro reparto" />
          </div>
          {cfg.lost_dist === "custom" && (
            <div className="mt-3 max-w-[200px]">
              <Field label="Para el barbero (%)" hint={`El local recibe el ${100 - cfg.lost_prof}%.`}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={cfg.lost_prof}
                  onChange={(e) => set("lost_prof", Math.min(100, Math.max(0, Number(e.target.value))))}
                  className={inputCls}
                />
              </Field>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Si el cliente cancela dentro del plazo de Cancelación (Configuración → Horarios), la app te sugiere devolverla.
          </p>
        </SectionCard>

        <SectionCard label="Mensaje para el cliente (opcional)">
          <textarea
            value={cfg.message}
            onChange={(e) => set("message", e.target.value)}
            rows={4}
            placeholder="Ej: La seña se descuenta del valor del servicio. Si cancelás con menos de 3 horas, no se devuelve."
            className={cn(inputCls, "resize-y")}
          />
        </SectionCard>
      </div>

      <FloatingSaveButton visible={dirty} saving={saving} onClick={() => void save()} />
    </div>
  );
}
