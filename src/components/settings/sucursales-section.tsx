import * as React from "react";
import {
  Building2,
  Plus,
  Loader2,
  ScanLine,
  Crown,
  Archive,
  ArchiveRestore,
  Trash2,
  Pencil,
  X,
  Check,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type Branch } from "@/hooks/use-auth";
import { SectionCard, Field, inputCls, reportSaveStatus, ConfirmDialog } from "@/components/settings/shared";
import { toast } from "sonner";

// Tablas con datos operativos reales de una sucursal — si cualquiera tiene
// filas con este branch_id, "Eliminar definitivamente" queda bloqueado y
// se sugiere Archivar. Esto es solo para dar un mensaje claro ANTES de
// intentar el borrado — la base igual lo protege de fondo (branch_id en
// todas estas tablas, y alguna más, referencia branches(id) sin ON DELETE
// CASCADE/SET NULL), así que aunque algo se escape acá el borrado real
// falla igual y se atrapa en confirmDelete.
const HISTORIAL_TABLES = [
  { table: "appointments", label: "turnos" },
  { table: "payments", label: "pagos" },
  { table: "expenses", label: "gastos" },
  { table: "clients", label: "clientes" },
  { table: "work_sessions", label: "fichajes" },
  { table: "cash_sessions", label: "sesiones de caja" },
  { table: "employees", label: "profesionales" },
  { table: "price_catalog", label: "servicios/productos" },
] as const;

async function findBranchHistorial(branchId: string): Promise<string | null> {
  for (const { table, label } of HISTORIAL_TABLES) {
    const { count, error } = await supabase
      .from(table as any)
      .select("id", { count: "exact", head: true })
      .eq("branch_id", branchId);
    if (!error && (count ?? 0) > 0) return label;
  }
  return null;
}

// "Sucursal 1", "Sucursal 2"... — el primer número que todavía no esté en
// uso (comparación sin mayúsculas/espacios), para nunca sugerir un nombre
// duplicado. Siempre editable libremente antes de guardar.
function suggestBranchName(branches: Branch[]): string {
  const existing = new Set(branches.map((b) => b.name.trim().toLowerCase()));
  let n = 1;
  while (existing.has(`sucursal ${n}`)) n++;
  return `Sucursal ${n}`;
}

export function SucursalesSection() {
  const { businessId, branches, branchesLoading, reloadBranches } = useAuth();

  const [addOpen, setAddOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editAddress, setEditAddress] = React.useState("");
  const [savingEdit, setSavingEdit] = React.useState(false);

  // Loading por-fila de Hacer principal/Archivar/Eliminar — nunca más de
  // una acción a la vez por sucursal.
  const [actionId, setActionId] = React.useState<string | null>(null);
  const [checkingDeleteId, setCheckingDeleteId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Branch | null>(null);

  const activeCount = branches.filter((b) => b.is_active).length;

  function openAdd() {
    setName(suggestBranchName(branches));
    setAddress("");
    setAddOpen(true);
  }

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
    setAddOpen(false);
    reportSaveStatus("saved");
    await reloadBranches();
  }

  function startEdit(b: Branch) {
    setEditingId(b.id);
    setEditName(b.name);
    setEditAddress(b.address ?? "");
  }

  async function saveEdit(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) {
      toast.error("El nombre no puede quedar vacío");
      return;
    }
    setSavingEdit(true);
    const { error } = await supabase
      .from("branches" as any)
      .update({ name: trimmed, address: editAddress.trim() || null } as any)
      .eq("id", id);
    setSavingEdit(false);
    if (error) {
      toast.error("No se pudo guardar los cambios");
      return;
    }
    setEditingId(null);
    reportSaveStatus("saved");
    await reloadBranches();
  }

  // Dos updates secuenciales (no una transacción), pero cada uno es válido
  // por sí solo contra el índice único parcial (nunca hay un instante con
  // dos is_principal=true) — si el segundo paso fallara, como mucho queda
  // momentáneamente sin principal, nunca con dos.
  async function handleMakePrincipal(b: Branch) {
    const current = branches.find((x) => x.is_principal);
    setActionId(b.id);
    try {
      if (current && current.id !== b.id) {
        const { error: unsetError } = await supabase
          .from("branches" as any)
          .update({ is_principal: false } as any)
          .eq("id", current.id);
        if (unsetError) throw unsetError;
      }
      const { error: setError } = await supabase
        .from("branches" as any)
        .update({ is_principal: true } as any)
        .eq("id", b.id);
      if (setError) throw setError;
      toast.success(`${b.name} ahora es la sucursal principal`);
      await reloadBranches();
    } catch {
      toast.error("No se pudo cambiar la sucursal principal");
    } finally {
      setActionId(null);
    }
  }

  async function handleArchive(b: Branch) {
    if (b.is_principal) {
      toast.error("Es la sucursal principal — marcá otra como principal antes de archivarla.");
      return;
    }
    if (b.is_active && activeCount <= 1) {
      toast.error("Debe quedar al menos una sucursal activa.");
      return;
    }
    setActionId(b.id);
    const { error } = await supabase
      .from("branches" as any)
      .update({ is_active: !b.is_active } as any)
      .eq("id", b.id);
    setActionId(null);
    if (error) {
      toast.error("No se pudo actualizar la sucursal");
      return;
    }
    reportSaveStatus("saved");
    await reloadBranches();
  }

  async function openDeleteCheck(b: Branch) {
    setCheckingDeleteId(b.id);
    const found = await findBranchHistorial(b.id);
    setCheckingDeleteId(null);
    if (found) {
      toast.error(`Esta sucursal tiene ${found} asociados — no se puede eliminar. Usá Archivar.`);
      return;
    }
    setDeleteTarget(b);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setActionId(deleteTarget.id);
    const { error } = await supabase.from("branches" as any).delete().eq("id", deleteTarget.id);
    setActionId(null);
    setDeleteTarget(null);
    if (error) {
      toast.error("Esta sucursal todavía tiene datos asociados — no se puede eliminar. Usá Archivar.");
      return;
    }
    toast.success("Sucursal eliminada");
    await reloadBranches();
  }

  return (
    <div className="space-y-4">
      <SectionCard label="Sucursales">
        {branchesLoading ? (
          <div className="text-sm text-muted-foreground">Cargando…</div>
        ) : branches.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Todavía no hay sucursales cargadas.
          </div>
        ) : (
          <div className="space-y-2">
            {branches.map((b) => (
              <div key={b.id} className="rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/5">
                {editingId === b.id ? (
                  <div className="space-y-2">
                    <input
                      className={inputCls}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Nombre"
                      autoFocus
                    />
                    <input
                      className={inputCls}
                      value={editAddress}
                      onChange={(e) => setEditAddress(e.target.value)}
                      placeholder="Dirección (opcional)"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => saveEdit(b.id)}
                        disabled={savingEdit}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-400 to-violet-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {savingEdit ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-white/10"
                      >
                        <X className="size-3.5" /> Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Building2 className="size-4 shrink-0 text-muted-foreground/70" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-foreground truncate">{b.name}</span>
                          {b.is_principal && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-400/25">
                              <Crown className="size-3" /> Principal
                            </span>
                          )}
                          {!b.is_active && (
                            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-white/10">
                              Archivada
                            </span>
                          )}
                        </div>
                        {b.address && (
                          <div className="text-xs text-muted-foreground truncate">{b.address}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                      <Link
                        to="/fichaje-kiosco/$branchId"
                        params={{ branchId: b.id }}
                        target="_blank"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-white/10 transition hover:text-foreground hover:bg-white/10"
                      >
                        <ScanLine className="size-3.5" />
                        Kiosco
                      </Link>
                      <button
                        type="button"
                        onClick={() => startEdit(b)}
                        className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-white/10 transition hover:text-foreground hover:bg-white/10"
                      >
                        <Pencil className="size-3.5" /> Editar
                      </button>
                      {!b.is_principal && b.is_active && (
                        <button
                          type="button"
                          onClick={() => handleMakePrincipal(b)}
                          disabled={actionId === b.id}
                          className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-white/10 transition hover:text-foreground hover:bg-white/10 disabled:opacity-50"
                        >
                          {actionId === b.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Crown className="size-3.5" />
                          )}
                          Hacer principal
                        </button>
                      )}
                      {!b.is_principal && (
                        <button
                          type="button"
                          onClick={() => handleArchive(b)}
                          disabled={actionId === b.id}
                          className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-white/10 transition hover:text-foreground hover:bg-white/10 disabled:opacity-50"
                        >
                          {actionId === b.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : b.is_active ? (
                            <Archive className="size-3.5" />
                          ) : (
                            <ArchiveRestore className="size-3.5" />
                          )}
                          {b.is_active ? "Archivar" : "Reactivar"}
                        </button>
                      )}
                      {/* Eliminar definitivamente solo se ofrece ya archivada
                          — Archivar es siempre el primer paso para una
                          sucursal con historial; ver findBranchHistorial. */}
                      {!b.is_principal && !b.is_active && (
                        <button
                          type="button"
                          onClick={() => openDeleteCheck(b)}
                          disabled={checkingDeleteId === b.id || actionId === b.id}
                          className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 ring-1 ring-rose-500/25 transition hover:bg-rose-500/20 disabled:opacity-50"
                        >
                          {checkingDeleteId === b.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {addOpen ? (
        <SectionCard label="Agregar sucursal">
          <div className="space-y-3">
            <Field label="Nombre">
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Sucursal Palermo"
                autoFocus
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCreate}
                disabled={!name.trim() || creating}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-40"
              >
                {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Agregar sucursal
              </button>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-muted-foreground ring-1 ring-white/10"
              >
                Cancelar
              </button>
            </div>
          </div>
        </SectionCard>
      ) : (
        <button
          type="button"
          onClick={openAdd}
          className="flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2.5 text-sm font-semibold text-foreground ring-1 ring-white/10 transition hover:bg-white/10"
        >
          <Plus className="size-4" /> Agregar sucursal
        </button>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={`¿Eliminar "${deleteTarget?.name ?? ""}" definitivamente?`}
        message="Esta acción no se puede deshacer. La sucursal no tiene turnos, pagos, clientes ni otros datos asociados."
        confirmLabel="Eliminar definitivamente"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
