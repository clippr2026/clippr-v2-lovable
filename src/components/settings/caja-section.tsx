import { useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Banknote, Landmark, CreditCard, Wallet, PiggyBank } from "lucide-react";
import { cn } from "@/lib/utils";
import { Toggle, SectionCard, reportSaveStatus } from "@/components/settings/shared";

export function CajaSection() {
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
