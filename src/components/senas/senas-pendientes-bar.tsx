import * as React from "react";
import { BellRing } from "lucide-react";
import { SenasPendientesModal } from "./senas-pendientes-modal";
import { useSenasPendientes } from "./use-senas-pendientes";

/** Aviso en la Agenda: comprobantes de seña por revisar, sin importar el día del turno. No se ve si no hay. */
export function SenasPendientesBar({
  businessId,
  onChanged,
}: {
  businessId: string | null | undefined;
  onChanged?: () => void;
}) {
  const pend = useSenasPendientes(businessId);
  const [open, setOpen] = React.useState(false);
  const total = pend.items.reduce((s, i) => s + i.amount, 0);

  return (
    <>
      {pend.items.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mb-2 flex h-12 w-full items-center justify-between rounded-2xl px-4 text-sm font-semibold transition hover:brightness-125 active:scale-[0.99]"
          style={{ background: "rgba(251,191,36,0.14)", color: "#fcd34d", boxShadow: "inset 0 0 0 1.5px rgba(251,191,36,0.6), 0 0 20px rgba(251,191,36,0.22)" }}
        >
          <span className="flex items-center gap-2.5">
            <BellRing className="h-4 w-4" />
            {pend.items.length} {pend.items.length === 1 ? "seña por revisar" : "señas por revisar"}
          </span>
          <span className="tabular-nums">${Math.round(total).toLocaleString("es-AR")}</span>
        </button>
      )}
      <SenasPendientesModal
        open={open}
        onClose={() => setOpen(false)}
        items={pend.items}
        loading={pend.loading}
        onChanged={() => {
          void pend.refresh();
          onChanged?.();
        }}
      />
    </>
  );
}
