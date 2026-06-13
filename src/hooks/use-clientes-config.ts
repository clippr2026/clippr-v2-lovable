import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ClientesConfig = {
  fields: Record<string, boolean>;
  diasInactivo: number;
  diasPerdido: number;
  vipVisitasEnabled: boolean;
  vipVisitasMin: number;
  vipGastoEnabled: boolean;
  vipGastoMin: number;
};

export const DEFAULT_CLIENTES_CONFIG: ClientesConfig = {
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
  vipGastoMin: 100_000,
};

export const ALL_CLIENT_FIELDS = [
  { key: "nombre",           label: "Nombre",              required: true  },
  { key: "telefono",         label: "Teléfono",            required: true  },
  { key: "email",            label: "Email",               required: false },
  { key: "fecha_nacimiento", label: "Fecha de nacimiento", required: false },
  { key: "instagram",        label: "Instagram",           required: false },
  { key: "direccion",        label: "Dirección",           required: false },
  { key: "notas",            label: "Notas",               required: false },
] as const;

export type ClientFieldKey = typeof ALL_CLIENT_FIELDS[number]["key"];

// ── Status helpers ─────────────────────────────────────────────────────────────

export type ClientStatus = "vip" | "activo" | "inactivo" | "perdido" | "nuevo";

export function computeClientStatus(
  opts: {
    lastVisitDays: number | null;
    visits: number;
    spent?: number;
    monthVisits: number;
    monthSpent: number;
  },
  cfg: ClientesConfig,
): ClientStatus {
  const { lastVisitDays, visits } = opts;

  if (visits === 0 || lastVisitDays == null) return "nuevo";
  if (lastVisitDays >= cfg.diasPerdido)   return "perdido";
  if (lastVisitDays >= cfg.diasInactivo)  return "inactivo";

  const isVipByVisits = cfg.vipVisitasEnabled && opts.monthVisits >= cfg.vipVisitasMin;
  const isVipByGasto  = cfg.vipGastoEnabled   && opts.monthSpent  >= cfg.vipGastoMin;
  if (isVipByVisits || isVipByGasto) return "vip";

  return "activo";
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useClientesConfig(businessId: string | null) {
  const [config, setConfig] = useState<ClientesConfig>(DEFAULT_CLIENTES_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
        if (schedule._clientes) {
          setConfig({ ...DEFAULT_CLIENTES_CONFIG, ...(schedule._clientes as Partial<ClientesConfig>) });
        }
        setLoading(false);
      });
  }, [businessId]);

  const isFieldEnabled = (key: ClientFieldKey): boolean => {
    if (key === "nombre" || key === "telefono") return true;
    return config.fields[key] ?? false;
  };

  const enabledFields = ALL_CLIENT_FIELDS.filter(f => isFieldEnabled(f.key));

  return { config, loading, isFieldEnabled, enabledFields };
}
