import * as React from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  DAY_KEYS,
  DEFAULT_TIMEZONE,
  normalizeSchedule,
  parseTimeStrict,
  zonedTimeToInstant,
} from "@/lib/availability";

type OpenSession = { id: string; employee_id: string; clock_in_at: string; name: string };

function parseDateKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function horaBA(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", {
    timeZone: DEFAULT_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Al cerrar la caja: los profesionales que ficharon entrada ese día y nunca
// ficharon salida. Quien cierra carga la hora de salida de cada uno (por
// defecto, el cierre del local ese día) y no se puede cerrar hasta que no
// quede ninguno. La salida queda marcada como cargada al cerrar la caja, con
// quién la cargó — nunca se hace pasar por una fichada del profesional.
export function SalidasPendientesPanel({
  businessId,
  branchId,
  date,
  editedBy,
  onPendingChange,
}: {
  businessId: string;
  branchId: string;
  date: string;
  editedBy: string;
  onPendingChange: (pendingNames: string[]) => void;
}) {
  const [rows, setRows] = React.useState<OpenSession[] | null>(null);
  const [times, setTimes] = React.useState<Record<string, string>>({});
  const [defaultOut, setDefaultOut] = React.useState("20:00");
  const [savingId, setSavingId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const day = parseDateKey(date);
    const start = zonedTimeToInstant(day, 0, DEFAULT_TIMEZONE);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const [{ data: sessions }, { data: emps }, { data: settings }, { data: members }] = await Promise.all([
      supabase
        .from("work_sessions" as any)
        .select("id,employee_id,clock_in_at")
        .eq("business_id", businessId)
        .eq("branch_id", branchId)
        .is("clock_out_at", null)
        .gte("clock_in_at", start.toISOString())
        .lt("clock_in_at", end.toISOString())
        .order("clock_in_at", { ascending: true }),
      supabase.from("employees").select("id,full_name").eq("business_id", businessId),
      supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle(),
      // La recepcionista ficha con su usuario (no tiene ficha de empleado).
      supabase.from("team_members").select("auth_user_id,full_name").eq("business_id", businessId),
    ]);
    const names = new Map(((emps ?? []) as { id: string; full_name: string | null }[]).map((e) => [e.id, e.full_name ?? "Profesional"]));
    for (const m of (members ?? []) as { auth_user_id: string | null; full_name: string | null }[]) {
      if (m.auth_user_id && !names.has(m.auth_user_id)) names.set(m.auth_user_id, m.full_name || "Recepción");
    }
    const list = ((sessions ?? []) as { id: string; employee_id: string; clock_in_at: string }[]).map((s) => ({
      ...s,
      name: names.get(s.employee_id) ?? "Profesional",
    }));
    // Cierre del local ese día de la semana — sugerencia inicial, editable.
    const sched = normalizeSchedule(((settings?.schedule ?? {}) as Record<string, unknown>));
    const closing = sched[DAY_KEYS[day.getDay()]]?.end;
    if (closing && parseTimeStrict(closing) !== null) setDefaultOut(closing);
    setRows(list);
    onPendingChange(list.map((r) => r.name));
  }, [businessId, branchId, date, onPendingChange]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function save(row: OpenSession) {
    const value = times[row.id] ?? defaultOut;
    const minutes = parseTimeStrict(value);
    if (minutes === null) return toast.error("Ingresá una hora de salida válida");
    const out = zonedTimeToInstant(parseDateKey(date), minutes, DEFAULT_TIMEZONE);
    if (out.getTime() <= new Date(row.clock_in_at).getTime()) {
      return toast.error(`La salida tiene que ser posterior a la entrada (${horaBA(row.clock_in_at)}).`);
    }
    setSavingId(row.id);
    const { error } = await supabase
      .from("work_sessions" as any)
      .update({
        clock_out_at: out.toISOString(),
        edited_by: editedBy,
        edited_at: new Date().toISOString(),
        edit_reason: "Salida cargada al cerrar la caja",
      })
      .eq("id", row.id);
    setSavingId(null);
    if (error) return toast.error("No se pudo guardar la salida: " + error.message);
    toast.success(`Salida de ${row.name} guardada`);
    await load();
  }

  if (rows === null || rows.length === 0) return null;

  return (
    <div className="rounded-xl bg-white/[0.02] p-3.5 ring-1 ring-white/10">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">Salidas sin fichar</p>
        <span className="rounded-full bg-rose-400/10 px-2 py-0.5 text-[10px] font-semibold text-rose-300 ring-1 ring-rose-400/25">
          {rows.length} pendiente{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mb-3 text-xs text-rose-200/80">
        No podés cerrar la caja hasta cargar la hora de salida de: {rows.map((r) => r.name).join(", ")}.
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">{r.name}</div>
              <div className="text-xs text-muted-foreground">Entrada {horaBA(r.clock_in_at)}</div>
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
