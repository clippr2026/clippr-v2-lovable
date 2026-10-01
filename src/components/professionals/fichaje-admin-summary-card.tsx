import * as React from "react";
import { createPortal } from "react-dom";
import { ScanLine, History, X } from "lucide-react";
import { getTodaySessionForEmployee, type WorkSession } from "@/lib/fichaje";
import { JornadasHistorial } from "@/components/professionals/jornadas-historial";
import { FichajeFlowModal } from "@/components/professionals/fichaje-flow-modal";

function horaCorta(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function jornadaLinea(session: WorkSession) {
  let s = `Entrada ${horaCorta(session.clock_in_at)}`;
  if (session.late_minutes > 0) s += ` · ${session.late_minutes} min tarde`;
  if (session.clock_out_at) s += ` · Salida ${horaCorta(session.clock_out_at)}`;
  return s;
}

// Vista del dueño/admin en Profesionales al seleccionar un barbero:
// resumen de la jornada de hoy + botón "Fichar jornada" para registrar
// entrada/salida EN NOMBRE de ese profesional (mismo flujo Escanear QR /
// Ingresar código que su panel propio, con la misma exigencia de QR/código
// válido de la sucursal — nunca se registra nada sin esa validación). Si
// hace falta corregir algo retroactivo, "Ver historial" con edición
// manual auditada.
export function FichajeAdminSummaryCard({
  businessId,
  employeeId,
  activeBranchId,
}: {
  businessId: string | null;
  employeeId: string;
  activeBranchId: string | null;
}) {
  const [session, setSession] = React.useState<WorkSession | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [historialOpen, setHistorialOpen] = React.useState(false);
  const [fichajeOpen, setFichajeOpen] = React.useState(false);

  const loadSession = React.useCallback(async () => {
    setLoading(true);
    const s = await getTodaySessionForEmployee(employeeId);
    setSession(s);
    setLoading(false);
  }, [employeeId]);

  React.useEffect(() => {
    loadSession();
  }, [loadSession]);

  return (
    <div className="glass rounded-2xl p-4 sm:p-5 ring-1 ring-white/5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ScanLine className="h-4 w-4 text-emerald-300" />
            Jornada de hoy
          </div>
          <div className="mt-1.5 text-sm text-muted-foreground">
            {loading ? "Cargando…" : !session ? "Sin fichar" : jornadaLinea(session)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setHistorialOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-sm font-medium text-muted-foreground ring-1 ring-white/10 transition hover:bg-white/5 hover:text-foreground"
          >
            <History className="h-3.5 w-3.5" />
            Ver historial
          </button>
          <button
            type="button"
            onClick={() => setFichajeOpen(true)}
            className="rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Fichar jornada
          </button>
        </div>
      </div>

      {fichajeOpen && (
        <FichajeFlowModal
          businessId={businessId}
          employeeId={employeeId}
          activeBranchId={activeBranchId}
          hasOpenSession={Boolean(session && !session.clock_out_at)}
          onClose={() => setFichajeOpen(false)}
          onDone={() => {
            setFichajeOpen(false);
            loadSession();
          }}
        />
      )}

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
