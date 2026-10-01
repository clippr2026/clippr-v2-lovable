import React, { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Check, Loader2, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Field, inputCls } from "@/components/settings/shared";

type WorkSessionRow = {
  id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  late_minutes: number;
  edited_by: string | null;
  edited_at: string | null;
  edit_reason: string | null;
};

function fmtHora(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}
function fmtFecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Historial de jornadas de un profesional — fichajes de los últimos 30 días,
// con edición manual (solo dueño/admin, nunca el propio profesional — RLS de
// work_sessions ya restringe el UPDATE). Editar nunca pisa el dato original
// fichado: ver original_clock_in_at/original_clock_out_at en la migración.
// Compartido entre Configuración → Equipo (modal de edición) y Profesionales
// (vista admin de un barbero, botón "Ver historial").
export function JornadasHistorial({ employeeId }: { employeeId: string }) {
  const [rows, setRows] = useState<WorkSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editIn, setEditIn] = useState("");
  const [editOut, setEditOut] = useState("");
  const [editReason, setEditReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("work_sessions" as any)
      .select("id,clock_in_at,clock_out_at,late_minutes,edited_by,edited_at,edit_reason")
      .eq("employee_id", employeeId)
      .gte("clock_in_at", since)
      .order("clock_in_at", { ascending: false });
    if (error) toast.error("Error cargando jornadas: " + error.message);
    setRows((data ?? []) as unknown as WorkSessionRow[]);
    setLoading(false);
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(row: WorkSessionRow) {
    setEditingId(row.id);
    setEditIn(row.clock_in_at ? new Date(row.clock_in_at).toISOString().slice(0, 16) : "");
    setEditOut(row.clock_out_at ? new Date(row.clock_out_at).toISOString().slice(0, 16) : "");
    setEditReason("");
  }

  async function saveEdit(row: WorkSessionRow) {
    if (!editReason.trim()) return toast.error("Ingresá el motivo de la corrección");
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const editor = userData?.user?.email ?? userData?.user?.id ?? "Admin";
    const { error } = await supabase
      .from("work_sessions" as any)
      .update({
        clock_in_at: editIn ? new Date(editIn).toISOString() : row.clock_in_at,
        clock_out_at: editOut ? new Date(editOut).toISOString() : null,
        original_clock_in_at: row.clock_in_at,
        original_clock_out_at: row.clock_out_at,
        edited_by: editor,
        edited_at: new Date().toISOString(),
        edit_reason: editReason.trim(),
      })
      .eq("id", row.id);
    setSaving(false);
    if (error) return toast.error("No se pudo guardar la corrección: " + error.message);
    setEditingId(null);
    toast.success("Jornada corregida");
    await load();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 justify-center text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        Sin jornadas fichadas en los últimos 30 días.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/5">
          {editingId === row.id ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Entrada">
                  <input
                    type="datetime-local"
                    className={inputCls}
                    value={editIn}
                    onChange={(e) => setEditIn(e.target.value)}
                  />
                </Field>
                <Field label="Salida">
                  <input
                    type="datetime-local"
                    className={inputCls}
                    value={editOut}
                    onChange={(e) => setEditOut(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Motivo de la corrección">
                <input
                  className={inputCls}
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Ej. Olvidó fichar la salida"
                />
              </Field>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveEdit(row)}
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-400 to-violet-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  <Check className="size-3.5" /> Guardar
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground ring-1 ring-white/10"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {fmtFecha(row.clock_in_at)} · {fmtHora(row.clock_in_at)} – {fmtHora(row.clock_out_at)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.late_minutes > 0 ? `${row.late_minutes} min de tardanza` : "A horario"}
                  {row.edited_by ? ` · corregido por ${row.edited_by}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => startEdit(row)}
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
