import * as React from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PresentismoRevisionPanel } from "@/components/professionals/presentismo-revision-panel";
import { SalidasPendientesPanel } from "@/components/professionals/salidas-pendientes-panel";

// El sistema de puntualidad rige desde el 29/10/2026 (ver
// attendance_system_start_date() en la base): un día anterior nunca exige
// confirmar nada.
const PRESENTISMO_START_DATE = "2026-10-29";

// Paso previo a la confirmación final del cierre: "Salidas sin fichar" y
// "Puntualidad del día". Solo se ve si hay algo para resolver — si no hay
// nada pendiente, pasa solo al paso siguiente. "Continuar" se habilita cuando
// no queda nada pendiente. El candado real de la puntualidad sigue siendo el
// trigger SQL check_attendance_confirmed_before_close.
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
  const [salidasPending, setSalidasPending] = React.useState<string[] | null>(null);
  const [presentismoPending, setPresentismoPending] = React.useState<string[] | null>(applies ? null : []);
  // "decidido": en la primera carga se decide una sola vez si hay algo para
  // mostrar; si no hay nada se salta el paso, y si hay algo se queda aunque
  // después se resuelva todo (así no desaparece mientras se está confirmando).
  const [decided, setDecided] = React.useState<"saltar" | "mostrar" | null>(null);

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setProfileId(data.user?.id ?? null));
  }, []);

  React.useEffect(() => {
    if (decided || salidasPending === null || presentismoPending === null) return;
    const nothing = salidasPending.length === 0 && presentismoPending.length === 0;
    setDecided(nothing ? "saltar" : "mostrar");
    if (nothing) onContinue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salidasPending, presentismoPending, decided]);

  const pendientes = (salidasPending?.length ?? 0) + (presentismoPending?.length ?? 0);
  const cargando = salidasPending === null || presentismoPending === null;

  return (
    <div className="space-y-4">
      {/* Los paneles se montan siempre (cargan y reportan lo pendiente), pero
          se ocultan hasta saber si hay algo para mostrar. */}
      <div className={decided === "mostrar" ? "space-y-4" : "hidden"}>
        <div>
          <p className="text-sm font-semibold text-white">Antes de cerrar la caja</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Cargá las salidas que faltan y confirmá la puntualidad del día. Después se habilita "Continuar".
          </p>
        </div>
        <SalidasPendientesPanel
          businessId={businessId}
          branchId={branchId}
          date={date}
          editedBy={userName}
          onPendingChange={setSalidasPending}
        />
        {applies && profileId && (
          <div className="rounded-xl bg-white/[0.02] p-3.5 ring-1 ring-white/10">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">Puntualidad del día</p>
              {presentismoPending && presentismoPending.length > 0 ? (
                <span className="rounded-full bg-rose-400/10 px-2 py-0.5 text-[10px] font-semibold text-rose-300 ring-1 ring-rose-400/25">
                  {presentismoPending.length} sin confirmar
                </span>
              ) : (
                <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-400/25">
                  Todo confirmado
                </span>
              )}
            </div>
            {presentismoPending && presentismoPending.length > 0 && (
              <p className="mb-3 text-xs text-rose-200/80">
                No podés cerrar la caja hasta confirmar a: {presentismoPending.join(", ")}.
              </p>
            )}
            <PresentismoRevisionPanel
              businessId={businessId}
              branchId={branchId}
              date={date}
              confirmedBy={profileId}
              confirmedByName={userName}
              onPendingChange={setPresentismoPending}
            />
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onVolver}
            className="flex-1 rounded-xl border border-white/[0.09] bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/[0.08]"
          >
            Volver a revisar
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={cargando || pendientes > 0}
            title={pendientes > 0 ? "Resolvé lo pendiente para continuar" : undefined}
            className="flex-1 rounded-xl px-4 py-3 text-sm font-bold bg-gradient-to-b from-blue-400 to-violet-500 text-white transition-all hover:brightness-105 disabled:opacity-50"
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
