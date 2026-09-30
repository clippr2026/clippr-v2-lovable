import * as React from "react";
import { Building2, Plus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { SectionCard, Field, inputCls, Toggle, reportSaveStatus } from "@/components/settings/shared";
import { toast } from "sonner";

// CRUD mínimo — solo lo necesario para poder crear una segunda sucursal y
// probar el filtrado. Edición rica (dirección, horarios propios, etc.)
// queda para después si hace falta.
export function SucursalesSection() {
  const { businessId, branches, reloadBranches } = useAuth();
  const [name, setName] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || !businessId) return;
    setCreating(true);
    const { error } = await supabase
      .from("branches" as any)
      .insert({
        business_id: businessId,
        name: trimmed,
        address: address.trim() || null,
      } as any);
    setCreating(false);
    if (error) {
      toast.error("No se pudo crear la sucursal");
      return;
    }
    setName("");
    setAddress("");
    reportSaveStatus("saved");
    await reloadBranches();
  }

  async function handleToggleActive(id: string, next: boolean) {
    setTogglingId(id);
    const { error } = await supabase
      .from("branches" as any)
      .update({ is_active: next } as any)
      .eq("id", id);
    setTogglingId(null);
    if (error) {
      toast.error("No se pudo actualizar la sucursal");
      return;
    }
    await reloadBranches();
  }

  return (
    <div className="space-y-4">
      <SectionCard label="Sucursales">
        {branches.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Todavía no hay sucursales cargadas.
          </div>
        ) : (
          <div className="space-y-2">
            {branches.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Building2 className="size-4 shrink-0 text-muted-foreground/70" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {b.name}
                    </div>
                    {b.address && (
                      <div className="text-xs text-muted-foreground truncate">
                        {b.address}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {b.is_active ? "Activa" : "Inactiva"}
                  </span>
                  {togglingId === b.id ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Toggle
                      on={b.is_active}
                      onChange={(v) => handleToggleActive(b.id, v)}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard label="Agregar sucursal">
        <div className="space-y-3">
          <Field label="Nombre">
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Sucursal Palermo"
            />
          </Field>
          <Field label="Dirección (opcional)">
            <input
              className={inputCls}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Ej. Av. Santa Fe 1234"
            />
          </Field>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-40"
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Agregar sucursal
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
