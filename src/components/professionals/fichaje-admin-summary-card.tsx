import * as React from "react";
import { createPortal } from "react-dom";
import { ScanLine, History, X } from "lucide-react";
import { getTodaySessionForEmployee, type WorkSession } from "@/lib/fichaje";
import { JornadasHistorial } from "@/components/professionals/jornadas-historial";

function horaCorta(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

// Vista del dueño/admin en Profesionales al seleccionar un barbero: resumen
// de SOLO LECTURA de la jornada de hoy (nunca un botón para fichar en su
// nombre — eso es exclusivo del panel del propio profesional, ver
// FichajeProfesionalCard). Si hace falta corregir algo, se hace desde
// "Ver historial" con edición manual auditada.
export function FichajeAdminSummaryCard({ employeeId }: { employeeId: string }) {
  const [session, setSession] = React.useState<WorkSession | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [historialOpen, setHistorialOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getTodaySessionForEmployee(employeeId).then((s) => {
      if (!cancelled) {
        setSession(s);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  return (
    <div className="glass rounded-2xl p-4 sm:p-5 ring-1 ring-white/5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ScanLine className="h-4 w-4 text-emerald-300" />
            Jornada de hoy
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
            {loading ? (
              "Cargando…"
            ) : !session ? (
              "Sin fichar"
            ) : session.clock_out_at ? (
              <>Entrada {horaCorta(session.clock_in_at)} · Salida {horaCorta(session.clock_out_at)}</>
            ) : (
              <>Entrada {horaCorta(session.clock_in_at)}</>
            )}
            {session && session.late_minutes > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-amber-400/20">
                {session.late_minutes} min tarde
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setHistorialOpen(true)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-sm font-medium text-muted-foreground ring-1 ring-white/10 transition hover:bg-white/5 hover:text-foreground"
        >
          <History className="h-3.5 w-3.5" />
          Ver historial de jornadas
        </button>
      </div>

      {historialOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] grid place-items-center bg-black/80 p-4"
            onClick={() => setHistorialOpen(false)}
          >
            <div
              className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold text-foreground">Historial de jornadas</h3>
                <button
                  type="button"
                  onClick={() => setHistorialOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <JornadasHistorial employeeId={employeeId} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
