import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Field, SectionCard, Toggle, inputCls } from "@/components/settings/shared";

// Se guarda en business_settings.senas_config (JSON). Los campos que esta pantalla
// no maneja (por ejemplo el texto viejo "msg") se conservan al guardar.
type SenasConfig = {
  enabled: boolean;
  scope: "all" | "selected";
  services: string[];
  trigger: "always" | "conditional";
  first_time: boolean;
  no_show_min: number; // 0 = no aplica
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

const DEFAULTS: SenasConfig = {
  enabled: false,
  scope: "selected",
  services: [],
  trigger: "always",
  first_time: false,
  no_show_min: 0,
  amount_type: "percent",
  amount_value: 30,
  proof_mode: "review",
  hold_minutes: 120,
  lost_dist: "local",
  lost_prof: 0,
  message: "",
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

function fromRaw(raw: Record<string, any> | null): SenasConfig {
  const r = raw ?? {};
  const t = (r.payment?.transfer ?? {}) as Record<string, any>;
  const type = r.amount_type === "fixed" ? "fixed" : "percent";
  return {
    enabled: !!r.enabled,
    scope: r.scope === "all" ? "all" : "selected",
    services: Array.isArray(r.services) ? r.services.filter((x: unknown) => typeof x === "string") : [],
    trigger: r.trigger === "conditional" ? "conditional" : "always",
    first_time: !!r.first_time,
    no_show_min: Math.max(0, Number(r.no_show_min) || 0),
    amount_type: type,
    amount_value: Number(r.amount_value) > 0 ? Number(r.amount_value) : DEFAULTS.amount_value,
    proof_mode: r.proof_mode === "auto" ? "auto" : "review",
    hold_minutes: Number(r.hold_minutes) > 0 ? Number(r.hold_minutes) : DEFAULTS.hold_minutes,
    lost_dist: ["local", "professional", "split", "custom"].includes(r.lost_dist) ? r.lost_dist : "local",
    lost_prof: Math.min(100, Math.max(0, Number(r.lost_prof) || 0)),
    message: typeof r.message === "string" ? r.message : typeof r.msg === "string" ? r.msg : "",
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

export function SenasSection() {
  const { businessId, activeBranchId } = useAuth();
  const [cfg, setCfg] = useState<SenasConfig>(DEFAULTS);
  const [raw, setRaw] = useState<Record<string, any>>({});
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

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
    setRaw(stored);
    setCfg(fromRaw(stored));
    setServices(((svc ?? []) as Service[]).filter((s) => !!s.name));
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

  const toggleService = (id: string) =>
    set("services", cfg.services.includes(id) ? cfg.services.filter((x) => x !== id) : [...cfg.services, id]);

  const validate = (): string | null => {
    if (!cfg.enabled) return null;
    if (cfg.scope === "selected" && cfg.services.length === 0) return "Elegí al menos un servicio para pedir seña.";
    if (cfg.trigger === "conditional" && !cfg.first_time && cfg.no_show_min < 1)
      return "Elegí cuándo pedir la seña: clientes nuevos o clientes que faltaron.";
    if (cfg.amount_type === "percent" && (cfg.amount_value <= 0 || cfg.amount_value > 100))
      return "El porcentaje de la seña debe estar entre 1 y 100.";
    if (cfg.amount_type === "fixed" && cfg.amount_value <= 0) return "El monto de la seña debe ser mayor a 0.";
    const t = cfg.payment.transfer;
    if (!t.enabled) return "Activá la transferencia para que el cliente sepa cómo pagar.";
    if (!t.alias.trim() && !t.cbu.trim()) return "Cargá el alias o el CBU/CVU donde reciben las señas.";
    return null;
  };

  const save = async () => {
    if (!businessId) return;
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const next = {
        ...raw,
        enabled: cfg.enabled,
        scope: cfg.scope,
        services: cfg.services,
        trigger: cfg.trigger,
        first_time: cfg.trigger === "conditional" ? cfg.first_time : false,
        no_show_min: cfg.trigger === "conditional" ? cfg.no_show_min : 0,
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
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`);
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
        <SectionCard label="¿Por qué servicios?">
          <div className="grid gap-2">
            <Choice on={cfg.scope === "all"} onClick={() => set("scope", "all")} title="Todos los servicios" />
            <Choice on={cfg.scope === "selected"} onClick={() => set("scope", "selected")} title="Solo los que elija" />
          </div>
          {cfg.scope === "selected" && (
            <div className="mt-3 space-y-3">
              {grouped.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay servicios cargados.</p>}
              {grouped.map(([cat, list]) => (
                <div key={cat}>
                  <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">{cat}</div>
                  <div className="flex flex-wrap gap-2">
                    {list.map((s) => {
                      const on = cfg.services.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleService(s.id)}
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
          )}
        </SectionCard>

        <SectionCard label="¿A qué clientes?">
          <div className="grid gap-2">
            <Choice on={cfg.trigger === "always"} onClick={() => set("trigger", "always")} title="A todos los clientes" />
            <Choice
              on={cfg.trigger === "conditional"}
              onClick={() => set("trigger", "conditional")}
              title="Solo en ciertos casos"
              hint="No se pide seña al resto de los clientes."
            />
          </div>
          {cfg.trigger === "conditional" && (
            <div className="mt-3 space-y-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Clientes que vienen por primera vez</span>
                <Toggle on={cfg.first_time} onChange={(v) => set("first_time", v)} />
              </label>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>Clientes que no asistieron</span>
                <select
                  value={cfg.no_show_min}
                  onChange={(e) => set("no_show_min", Number(e.target.value))}
                  className={cn(inputCls, "w-auto")}
                >
                  <option value={0}>No aplica</option>
                  <option value={1}>1 vez o más</option>
                  <option value={2}>2 veces o más</option>
                  <option value={3}>3 veces o más</option>
                </select>
              </div>
            </div>
          )}
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
            placeholder="Ej: La seña se descuenta del valor del servicio. Si cancelás con menos de 24 horas, no se devuelve."
            className={cn(inputCls, "resize-y")}
          />
        </SectionCard>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 border-t border-white/10 bg-background/90 px-4 py-3 backdrop-blur md:bottom-0">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{dirty ? "Tenés cambios sin guardar." : "Todo guardado."}</span>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void save()}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition disabled:opacity-40"
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
