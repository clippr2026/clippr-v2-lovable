import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { HistorialPanelView } from "@/components/liquidaciones/historial-panel-view";

type WorkSessionRow = {
  id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  late_minutes: number | null;
};

function fmtHora(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

// Horarios de fichada (work_sessions) de los últimos 60 días, solo lectura:
// entrada, salida y si llegó a tiempo o tarde. La edición manual de una
// jornada sigue siendo del dueño/admin, desde Equipo (JornadasHistorial).
function PuntualidadHistorial({ employeeId }: { employeeId: string | null }) {
  const [rows, setRows] = React.useState<WorkSessionRow[] | null>(null);
  // Por defecto solo se ve lo posterior a la última liquidación; "Ver historial" muestra el resto.
  const [desde, setDesde] = React.useState<string | null>(null);
  const [verTodo, setVerTodo] = React.useState(false);

  React.useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    supabase
      .from("settlement_runs" as any)
      .select("cutoff_date")
      .eq("professional_id", employeeId)
      .eq("status", "pagada")
      .order("cutoff_date", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setDesde(((data as any)?.cutoff_date as string | null) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  React.useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    setRows(null);
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    supabase
      .from("work_sessions" as any)
      .select("id,clock_in_at,clock_out_at,late_minutes")
      .eq("employee_id", employeeId)
      .gte("clock_in_at", since)
      .order("clock_in_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setRows((data ?? []) as unknown as WorkSessionRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  if (rows === null) {
    return <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">Cargando…</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground animate-fade-up">
        Todavía no hay fichadas registradas.
      </div>
    );
  }

  // Día (hora Argentina) posterior al corte de la última liquidación pagada.
  const diaDe = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });
  const visibles = verTodo || !desde ? rows : rows.filter((r) => diaDe(r.clock_in_at) > desde);
  const ocultas = rows.length - visibles.length;

  return (
    <div className="space-y-2 animate-fade-up">
      {visibles.length === 0 && (
        <div className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">
          No hay fichadas desde la última liquidación.
        </div>
      )}
      {visibles.map((r) => {
        const late = Number(r.late_minutes ?? 0);
        return (
          <div
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.14] bg-white/[0.05] px-3.5 py-3 shadow-[0_2px_10px_-2px_rgba(0,0,0,0.5)]"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold capitalize text-white/85">{fmtFecha(r.clock_in_at)}</div>
              <div className="mt-0.5 text-xs text-white/55">
                Entrada {fmtHora(r.clock_in_at)} · Salida {r.clock_out_at ? fmtHora(r.clock_out_at) : "en curso"}
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                late > 0
                  ? "bg-amber-400/15 text-amber-200 ring-amber-400/25"
                  : "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20",
              )}
            >
              {late > 0 ? `Tarde ${late} min` : "A tiempo"}
            </span>
          </div>
        );
      })}
      {ocultas > 0 && (
        <button
          type="button"
          onClick={() => setVerTodo(true)}
          className="h-11 w-full rounded-full border border-violet-400/35 bg-violet-500/10 text-sm font-semibold text-white transition active:scale-[0.99]"
        >
          Ver historial ({ocultas} {ocultas === 1 ? "día más" : "días más"})
        </button>
      )}
    </div>
  );
}

// Historial del profesional: Pagos (liquidaciones cerradas) y Puntualidad
// (horarios de fichada).
export function HistorialTabs({ businessId, empId }: { businessId: string | null; empId: string | null }) {
  const [sub, setSub] = React.useState<"pagos" | "puntualidad">("pagos");
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(
          [
            ["pagos", "Pagos"],
            ["puntualidad", "Puntualidad"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSub(key)}
            className={cn(
              "h-10 flex-1 rounded-[10px] border text-sm font-semibold transition sm:flex-none sm:px-5",
              sub === key
                ? "border-white/25 bg-white/12 text-foreground"
                : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {sub === "pagos" ? (
        <HistorialPanelView businessId={businessId} empId={empId} />
      ) : (
        <PuntualidadHistorial employeeId={empId} />
      )}
    </div>
  );
}
