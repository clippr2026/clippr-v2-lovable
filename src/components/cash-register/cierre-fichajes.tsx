import * as React from "react";
import { Camera } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getFichajesDeFecha, type FichajeHoyPersona } from "@/lib/fichaje";
import { FichajeEvidenciaModal } from "@/components/dashboard/fichaje-evidencia-modal";

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

/** Quién fichó ese día, con sus fotos de entrada y salida, para mirarlas al revisar el cierre de caja. */
export function CierreFichajes({ businessId, fecha }: { businessId: string | null; fecha?: string }) {
  const { activeBranchId } = useAuth();
  const dia = fecha ?? new Date().toLocaleDateString("sv-SE");
  const [personas, setPersonas] = React.useState<FichajeHoyPersona[] | null>(null);
  const [abierta, setAbierta] = React.useState<FichajeHoyPersona | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setPersonas(null);
    if (!businessId || !activeBranchId) return;
    void getFichajesDeFecha(businessId, activeBranchId, dia)
      .then((r) => !cancelled && setPersonas(r))
      .catch(() => !cancelled && setPersonas([]));
    return () => {
      cancelled = true;
    };
  }, [businessId, activeBranchId, dia]);

  if (!personas || personas.length === 0) return null;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 [background-image:radial-gradient(110%_90%_at_100%_0%,rgba(79,125,255,0.16),transparent_62%),radial-gradient(90%_80%_at_0%_100%,rgba(139,92,246,0.12),transparent_65%)]">
      <div className="mb-1 text-sm font-semibold text-white">Fichajes del día</div>
      <div className="divide-y divide-white/[0.07]">
        {personas.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{p.name}</div>
              <div className="text-[11px] text-muted-foreground">
                Entrada <span className="tabular-nums text-foreground/80">{hora(p.clockInAt)}</span>
                {p.clockOutAt ? (
                  <>
                    {" · "}Salida <span className="tabular-nums text-foreground/80">{hora(p.clockOutAt)}</span>
                  </>
                ) : (
                  <span className="text-emerald-300"> · En curso</span>
                )}
              </div>
            </div>
            {(p.inSelfiePath || p.outSelfiePath) && (
              <button
                type="button"
                onClick={() => setAbierta(p)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-sky-200 ring-1 ring-white/10 hover:bg-white/10"
              >
                <Camera className="size-3.5" /> Ver fotos
              </button>
            )}
          </div>
        ))}
      </div>
      {abierta && <FichajeEvidenciaModal persona={abierta} onClose={() => setAbierta(null)} />}
    </section>
  );
}
