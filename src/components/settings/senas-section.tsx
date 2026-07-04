import React, { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import { reportSaveStatus } from "@/components/settings/shared";

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
export function SenasSection() {
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
