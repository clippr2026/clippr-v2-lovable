import * as React from "react";
import { getOpenWorkSession, type WorkSession } from "@/lib/fichaje";
import { FichajeFlowModal } from "@/components/professionals/fichaje-flow-modal";
import { ScanLine } from "lucide-react";

function horaCorta(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function jornadaLinea(session: WorkSession) {
  let s = `Entrada ${horaCorta(session.clock_in_at)}`;
  if (session.late_minutes > 0) s += ` · ${session.late_minutes} min tarde`;
  if (session.clock_out_at) s += ` · Salida ${horaCorta(session.clock_out_at)}`;
  return s;
}

// "Fichar jornada" — sección del panel del propio profesional. A
// diferencia de Inicio (que muestra el QR), acá el profesional nunca ve
// el QR del local: solo puede escanearlo (cámara) o tipear el código a
// mano. Mismo código sirve para entrada y salida — se decide solo según
// si ya tiene una jornada abierta hoy.
export function FichajeProfesionalCard({
  businessId,
  employeeId,
  activeBranchId,
}: {
  businessId: string | null;
  employeeId: string | null;
  activeBranchId: string | null;
}) {
  const [openSession, setOpenSession] = React.useState<WorkSession | null>(null);
  const [loadingStatus, setLoadingStatus] = React.useState(true);
  const [modalOpen, setModalOpen] = React.useState(false);

  const loadStatus = React.useCallback(async () => {
    if (!employeeId) {
      setLoadingStatus(false);
      return;
    }
    setLoadingStatus(true);
    const session = await getOpenWorkSession(employeeId);
    setOpenSession(session);
    setLoadingStatus(false);
  }, [employeeId]);

  React.useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  if (!employeeId) return null;

  return (
    <div className="glass rounded-2xl p-4 sm:p-5 ring-1 ring-white/5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ScanLine className="h-4 w-4 text-emerald-300" />
            Jornada de hoy
          </div>
          <div className="mt-1.5 text-sm text-muted-foreground">
            {loadingStatus ? "Cargando…" : !openSession ? "Sin iniciar" : jornadaLinea(openSession)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="shrink-0 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Fichar jornada
        </button>
      </div>

      {modalOpen && (
        <FichajeFlowModal
          businessId={businessId}
          employeeId={employeeId}
          activeBranchId={activeBranchId}
          hasOpenSession={Boolean(openSession && !openSession.clock_out_at)}
          onClose={() => setModalOpen(false)}
          onDone={() => {
            setModalOpen(false);
            loadStatus();
          }}
        />
      )}
    </div>
  );
}
