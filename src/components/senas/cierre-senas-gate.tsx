import * as React from "react";
import { HandCoins } from "lucide-react";
import { SenasPendientesModal } from "./senas-pendientes-modal";
import { useSenasPendientes, type SenaPendiente } from "./use-senas-pendientes";

/** Señas por revisar que frenan el cierre de `fecha`: las que tienen comprobante de ese día o anterior. */
export function senasQueBloqueanCierre(items: SenaPendiente[], fecha: string): SenaPendiente[] {
  if (!fecha) return [];
  const fin = new Date(`${fecha}T23:59:59.999-03:00`).getTime();
  return items.filter((i) => !i.proof_uploaded_at || new Date(i.proof_uploaded_at).getTime() <= fin);
}

/**
 * Aviso dentro del cierre de caja: mientras haya señas por revisar del día que se cierra (o anteriores)
 * no se puede confirmar. Avisa al padre con `onBlockedChange` para que deshabilite el botón.
 */
export function CierreSenasGate({
  businessId,
  fecha,
  onBlockedChange,
  onChanged,
}: {
  businessId: string | null | undefined;
  fecha: string;
  onBlockedChange: (blocked: boolean) => void;
  onChanged?: () => void;
}) {
  const pend = useSenasPendientes(businessId);
  const [open, setOpen] = React.useState(false);
  const bloquean = React.useMemo(() => senasQueBloqueanCierre(pend.items, fecha), [pend.items, fecha]);
  const n = bloquean.length;

  React.useEffect(() => {
    onBlockedChange(n > 0);
  }, [n, onBlockedChange]);
  React.useEffect(() => () => onBlockedChange(false), [onBlockedChange]);

  if (n === 0 && !open) return null;
  return (
    <>
      {n > 0 && (
        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-3 text-sm"
          style={{ background: "rgba(251,191,36,0.12)", color: "#fcd34d", boxShadow: "inset 0 0 0 1.5px rgba(251,191,36,0.5)" }}
        >
          <span className="flex items-center gap-2 font-semibold">
            <HandCoins className="h-4 w-4 shrink-0" />
            {n === 1 ? "Hay 1 seña por revisar." : `Hay ${n} señas por revisar.`} Revisalas antes de cerrar la caja.
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg bg-amber-300/20 px-3 py-1.5 text-xs font-bold text-amber-100 transition hover:bg-amber-300/30"
          >
            Revisar señas
          </button>
        </div>
      )}
      <SenasPendientesModal
        open={open}
        onClose={() => setOpen(false)}
        items={bloquean}
        loading={pend.loading}
        onChanged={() => {
          void pend.refresh();
          onChanged?.();
        }}
      />
    </>
  );
}
