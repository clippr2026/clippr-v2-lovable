import * as React from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { dayWindowBA, fetchBusinessClosingTime, horaBA, saveSessionExit } from "@/lib/work-session-exit";

type OpenSession = { id: string; employee_id: string; clock_in_at: string; name: string };

// Al cerrar la caja: las personas que ficharon entrada ese día y nunca
// ficharon salida. Quien cierra carga la hora de salida de cada una (por
// defecto, el cierre del local ese día) y no se puede cerrar hasta que no
// quede ninguna. La salida queda marcada como cargada al cerrar la caja, con
// quién la cargó — nunca se hace pasar por una fichada de la persona.
//
// `excludeIds`: personas que ya se ven en otro lado de la pantalla (los
// profesionales programados, cuya salida va junto a su puntualidad). Acá
// quedan las demás, por ejemplo la recepcionista. `embedded` = dentro de otra
// tarjeta, sin marco propio.
export function SalidasPendientesPanel({
  businessId,
  branchId,
  date,
  editedBy,
  onPendingChange,
  excludeIds = [],
  embedded = false,
}: {
  businessId: string;
  branchId: string;
  date: string;
  editedBy: string;
  onPendingChange: (pendingNames: string[]) => void;
  excludeIds?: string[];
  embedded?: boolean;
}) {
  const [rows, setRows] = React.useState<OpenSession[] | null>(null);
  const [times, setTimes] = React.useState<Record<string, string>>({});
  const [defaultOut, setDefaultOut] = React.useState("20:00");
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const excludeKey = excludeIds.join(",");

  const load = React.useCallback(async () => {
    const win = dayWindowBA(date);
    const [{ data: sessions }, { data: emps }, { data: members }, closing] = await Promise.all([
      supabase
        .from("work_sessions" as any)
        .select("id,employee_id,clock_in_at")
        .eq("business_id", businessId)
        .eq("branch_id", branchId)
        .is("clock_out_at", null)
        .gte("clock_in_at", win.start.toISOString())
        .lt("clock_in_at", win.end.toISOString())
        .order("clock_in_at", { ascending: true }),
      supabase.from("employees").select("id,full_name").eq("business_id", businessId),
      // La recepcionista ficha con su usuario (no tiene ficha de empleado).
      supabase.from("team_members").select("auth_user_id,full_name").eq("business_id", businessId),
      fetchBusinessClosingTime(businessId, date),
    ]);
    const names = new Map(((emps ?? []) as { id: string; full_name: string | null }[]).map((e) => [e.id, e.full_name ?? "Profesional"]));
    for (const m of (members ?? []) as { auth_user_id: string | null; full_name: string | null }[]) {
      if (m.auth_user_id && !names.has(m.auth_user_id)) names.set(m.auth_user_id, m.full_name || "Recepción");
    }
    const excluded = new Set(excludeKey ? excludeKey.split(",") : []);
    const list = ((sessions ?? []) as { id: string; employee_id: string; clock_in_at: string }[])
      .filter((s) => !excluded.has(s.employee_id))
      .map((s) => ({ ...s, name: names.get(s.employee_id) ?? "Profesional" }));
    setDefaultOut(closing);
    setRows(list);
    onPendingChange(list.map((r) => r.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, branchId, date, excludeKey]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function save(row: OpenSession) {
    setSavingId(row.id);
    const r = await saveSessionExit({
      sessionId: row.id,
      clockInAt: row.clock_in_at,
      date,
      hhmm: times[row.id] ?? defaultOut,
      editedBy,
    });
    setSavingId(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(`Salida de ${row.name} guardada`);
    await load();
  }

  if (rows === null || rows.length === 0) return null;

  return (
    <div className={embedded ? "mt-3" : "rounded-xl bg-white/[0.02] p-3.5 ring-1 ring-white/10"}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{embedded ? "Otras personas sin salida" : "Salidas sin fichar"}</p>
        <span className="rounded-full bg-rose-400/10 px-2 py-0.5 text-[10px] font-semibold text-rose-300 ring-1 ring-rose-400/25">
          {rows.length} pendiente{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      {!embedded && (
        <p className="mb-3 text-xs text-rose-200/80">
          No podés cerrar la caja hasta cargar la hora de salida de: {rows.map((r) => r.name).join(", ")}.
        </p>
      )}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">{r.name}</div>
              <div className="text-xs text-muted-foreground">Entrada {horaBA(r.clock_in_at)} · falta la salida</div>
            </div>
            <input
              type="time"
              value={times[r.id] ?? defaultOut}
              onChange={(e) => setTimes((t) => ({ ...t, [r.id]: e.target.value }))}
              className="h-10 w-[104px] rounded-lg bg-white/5 px-2 text-sm text-foreground ring-1 ring-white/10"
            />
            <button
              type="button"
              onClick={() => save(r)}
              disabled={savingId === r.id}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-gradient-to-r from-sky-400 to-violet-500 px-3 text-xs font-semibold text-white disabled:opacity-50"
            >
              {savingId === r.id ? <Loader2 className="size-4 animate-spin" /> : "Guardar"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
