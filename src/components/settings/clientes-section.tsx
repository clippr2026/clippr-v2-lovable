import React, { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { reportSaveStatus } from "@/components/settings/shared";

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

export function ClientesSection() {
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
