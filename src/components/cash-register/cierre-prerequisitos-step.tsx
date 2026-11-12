import * as React from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PresentismoRevisionPanel } from "@/components/professionals/presentismo-revision-panel";
import { CierreFichajes } from "@/components/cash-register/cierre-fichajes";
import { SalidasPendientesPanel } from "@/components/professionals/salidas-pendientes-panel";

// El sistema de puntualidad rige desde el 29/10/2026 (ver
// attendance_system_start_date() en la base): un día anterior nunca exige
// confirmar nada.
const PRESENTISMO_START_DATE = "2026-10-29";

// Paso previo a la confirmación final del cierre: "Salidas sin fichar" y
// "Puntualidad del día". La puntualidad se revisa y confirma SIEMPRE al cerrar
// (aunque todos hayan fichado entrada y salida); solo en un día anterior al
// corte del sistema, sin salidas pendientes, el paso se saltea. "Continuar" se
// habilita cuando no queda nada pendiente. El candado real de la puntualidad
// sigue siendo el trigger SQL check_attendance_confirmed_before_close.
export function CierrePrerequisitosStep({
  businessId,
  branchId,
  date,
  userName,
  onVolver,
  onContinue,
}: {
  businessId: string;
  branchId: string;
  date: string; // YYYY-MM-DD
  userName: string;
  onVolver: () => void;
  onContinue: () => void;
}) {
  const applies = date >= PRESENTISMO_START_DATE;
  const [profileId, setProfileId] = React.useState<string | null>(null);
  // Salidas pendientes: las de los profesionales programados (se cargan en su
  // propia fila, junto a la puntualidad) y las de otras personas (ej. recepción).
  const [salidasProg, setSalidasProg] = React.useState<string[] | null>(applies ? null : []);
  const [salidasOtros, setSalidasOtros] = React.useState<string[] | null>(null);
  const [scheduledIds, setScheduledIds] = React.useState<string[] | null>(applies ? null : []);
  const [presentismoPending, setPresentismoPending] = React.useState<string[] | null>(applies ? null : []);
  // "decidido": en la primera carga se decide una sola vez si se muestra el
  // paso. Desde el corte siempre se muestra (la puntualidad se confirma todos
  // los días); antes del corte solo si hay salidas pendientes. Una vez
  // mostrado, se queda aunque se resuelva todo (no desaparece al confirmar).
  const [decided, setDecided] = React.useState<"saltar" | "mostrar" | null>(null);

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setProfileId(data.user?.id ?? null));
  }, []);

  React.useEffect(() => {
    if (decided || salidasProg === null || salidasOtros === null || presentismoPending === null) return;
    const skip = !applies && salidasOtros.length === 0;
    setDecided(skip ? "saltar" : "mostrar");
    if (skip) onContinue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salidasProg, salidasOtros, presentismoPending, decided]);

  const pendientes = (salidasProg?.length ?? 0) + (salidasOtros?.length ?? 0) + (presentismoPending?.length ?? 0);
  // Una misma persona puede tener pendiente la puntualidad y la salida: se cuenta una sola vez.
  const sinResolver = Array.from(new Set([...(presentismoPending ?? []), ...(salidasProg ?? []), ...(salidasOtros ?? [])]));
  const cargando = salidasProg === null || salidasOtros === null || presentismoPending === null;

  return (
    <div className="space-y-4">
      {/* Los paneles se montan siempre (cargan y reportan lo pendiente), pero
          se ocultan hasta saber si hay algo para mostrar. */}
      <div className={decided === "mostrar" ? "space-y-4" : "hidden"}>
        <div>
          <p className="text-sm font-semibold text-white">Antes de cerrar la caja</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Confirmá la puntualidad de cada profesional y cargá las salidas que falten. Después se habilita "Continuar".
          </p>
        </div>
        <CierreFichajes businessId={businessId} fecha={date} />
        <div className="rounded-xl bg-white/[0.02] p-3.5 ring-1 ring-white/10">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">Entradas y salidas del día</p>
            {pendientes > 0 ? (
              <span className="rounded-full bg-rose-400/10 px-2 py-0.5 text-[10px] font-semibold text-rose-300 ring-1 ring-rose-400/25">
                {sinResolver.length} sin resolver
              </span>
            ) : (
              <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-400/25">
                Todo confirmado
              </span>
            )}
          </div>
          {sinResolver.length > 0 && (
            <p className="mb-3 text-xs text-rose-200/80">
              Falta resolver: {sinResolver.join(", ")}.
            </p>
          )}
          {applies && profileId && (
            <PresentismoRevisionPanel
              businessId={businessId}
              branchId={branchId}
              date={date}
              confirmedBy={profileId}
              confirmedByName={userName}
              onPendingChange={setPresentismoPending}
              showSalida
              onSalidasPendingChange={setSalidasProg}
              onScheduledIdsChange={setScheduledIds}
            />
          )}
          {(!applies || scheduledIds !== null) && (
            <SalidasPendientesPanel
              embedded
              businessId={businessId}
              branchId={branchId}
              date={date}
              editedBy={userName}
              excludeIds={scheduledIds ?? []}
              onPendingChange={setSalidasOtros}
            />
          )}
        </div>
        <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-2 border-t border-white/10 bg-[#08070f]/95 px-5 py-3 backdrop-blur">
          <button
            type="button"
            onClick={onVolver}
            className="h-12 flex-1 rounded-full border border-white/[0.12] bg-white/[0.04] px-4 text-sm font-semibold text-white/80 transition hover:bg-white/[0.08]"
          >
            Volver a revisar
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={cargando || pendientes > 0}
            title={pendientes > 0 ? "Resolvé lo pendiente para continuar" : undefined}
            className="h-12 flex-1 rounded-full bg-gradient-to-b from-blue-400 to-violet-500 px-4 text-sm font-bold text-white transition-all hover:brightness-105 disabled:opacity-50"
          >
            Continuar
          </button>
        </div>
      </div>
      {decided !== "mostrar" && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Verificando…
        </div>
      )}
    </div>
  );
}
