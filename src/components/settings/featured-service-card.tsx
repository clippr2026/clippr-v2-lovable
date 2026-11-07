import * as React from "react";
import { toast } from "sonner";
import { Crown, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

// Servicio destacado de la página pública (uno solo) y su descripción. Se guarda en el branding
// del negocio releyéndolo antes, para no pisar colores, anuncio ni el resto de la configuración.
export function FeaturedServiceCard() {
  const { businessId, activeBranchId } = useAuth();
  const [options, setOptions] = React.useState<{ id: string; name: string }[]>([]);
  const [serviceId, setServiceId] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      let q = supabase.from("price_catalog").select("id,name,active").eq("business_id", businessId).is("deleted_at", null);
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      const [{ data: rows }, { data: settings }] = await Promise.all([
        q.order("name"),
        supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle(),
      ]);
      if (cancelled) return;
      setOptions(((rows ?? []) as { id: string; name: string; active: boolean | null }[]).filter((r) => r.active !== false).map((r) => ({ id: r.id, name: r.name })));
      const schedule = (settings?.schedule ?? {}) as Record<string, any>;
      const branding = (schedule._branding && typeof schedule._branding === "object" ? schedule._branding : {}) as Record<string, unknown>;
      setServiceId(typeof branding.featured_service_id === "string" ? branding.featured_service_id : "");
      setDesc(typeof branding.featured_service_desc === "string" ? branding.featured_service_desc : "");
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, activeBranchId]);

  async function save() {
    if (!businessId) return;
    setSaving(true);
    const { data: row } = await supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle();
    const schedule = ((row?.schedule ?? {}) as Record<string, any>) || {};
    const branding = (schedule._branding && typeof schedule._branding === "object" ? schedule._branding : {}) as Record<string, unknown>;
    const next = {
      ...schedule,
      _branding: { ...branding, featured_service_id: serviceId || null, featured_service_desc: desc.trim().slice(0, 140) },
    };
    const { error } = await supabase.from("business_settings").upsert({ business_id: businessId, schedule: next }, { onConflict: "business_id" });
    setSaving(false);
    if (error) return toast.error("No se pudo guardar el servicio destacado");
    toast.success("Servicio destacado guardado");
  }

  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Crown className="h-4 w-4 text-amber-400" /> Servicio destacado
      </div>
      <p className="mt-1 text-xs text-white/55">
        Elegí un servicio para mostrarlo arriba de la lista en tu página pública, con borde dorado, corona y una descripción.
      </p>
      <select
        value={serviceId}
        onChange={(e) => setServiceId(e.target.value)}
        className="mt-3 w-full rounded-lg bg-white/5 px-3 py-2.5 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-primary/40"
      >
        <option value="">Sin servicio destacado</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {serviceId ? (
        <>
          <textarea
            value={desc}
            maxLength={140}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Ej: Nuestro servicio más elegido. Estilo, definición y prolijidad según el profesional."
            className="mt-3 min-h-[84px] w-full resize-none rounded-lg bg-white/5 px-3 py-2.5 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-primary/40"
          />
          <div className="mt-1 text-right text-[11px] text-white/45">{desc.length}/140</div>
        </>
      ) : null}
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
      </button>
    </div>
  );
}
