import * as React from "react";
import { ChevronDown, Loader2, Pencil, Ban, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getPaymentAuthorizationHistory,
  type PaymentAuthorizationLogRow,
  type PaymentAuthorizationLogAction,
} from "@/components/cash-register/caja-authorization";

// Historial de Corregir cobro/Anular venta/Eliminar cobro — reutiliza
// payment_authorization_log (nunca una fuente propia): este archivo es
// puramente de presentación, se usa tanto en el detalle de UNA venta
// (PaymentAuthorizationHistoryPanel, cash-register.tsx → DetailModal)
// como en el Historial de actividad general (Configuración → Seguridad →
// seguridad-section.tsx), con la misma fila (AuthorizationLogRow) en los
// dos lugares — "mismos componentes, sin duplicar código".

const ACTION_LABEL: Record<PaymentAuthorizationLogAction, string> = {
  correction: "Corrección",
  void: "Anulación",
  deletion: "Eliminación",
};

const ACTION_ICON: Record<PaymentAuthorizationLogAction, React.ComponentType<{ className?: string }>> = {
  correction: Pencil,
  void: Ban,
  deletion: Trash2,
};

const ACTION_TONE: Record<PaymentAuthorizationLogAction, string> = {
  correction: "bg-blue-500/10 text-blue-300",
  void: "bg-amber-500/10 text-amber-300",
  deletion: "bg-rose-500/10 text-rose-300",
};

function fmtDT(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function money(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? `$${Math.round(n).toLocaleString("es-AR")}` : "—";
}

const PAY_METHOD_LABEL_LOCAL: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  debit: "Débito",
  credit: "Crédito",
  qr: "QR",
  cuenta: "Cuenta",
};

function methodLabel(m: unknown) {
  if (!m) return "—";
  return PAY_METHOD_LABEL_LOCAL[String(m)] ?? String(m);
}

// Fila expandible — colapsada muestra lo esencial (tipo, cuándo, quién,
// cliente/servicio), el detalle completo (antes/después, método, motivo,
// impacto, quién autorizó si fue otra persona) queda a un clic.
export function AuthorizationLogRow({
  row,
  showPaymentRef = false,
}: {
  row: PaymentAuthorizationLogRow;
  // En el historial GENERAL (no el de una venta puntual) conviene mostrar
  // a qué venta corresponde cada fila — en el de una venta puntual es
  // redundante (ya se sabe cuál es).
  showPaymentRef?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const before = row.beforeSnapshot ?? {};
  const after = row.afterSnapshot ?? {};
  const Icon = ACTION_ICON[row.actionType];
  const clientName = before.client_name ?? "Cliente";
  const serviceName = before.service_name ?? "—";
  const employeeName = before.employee_name ?? "—";

  return (
    <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-white/[0.03]"
      >
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", ACTION_TONE[row.actionType])}>
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="font-semibold text-white">{ACTION_LABEL[row.actionType]}</span>
            <span className="text-white/40">·</span>
            <span className="text-white/55">{fmtDT(row.createdAt)}</span>
            {showPaymentRef && (
              <>
                <span className="text-white/40">·</span>
                <span className="truncate text-white/55">{clientName}</span>
              </>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-white/45">
            {row.performedByName ?? "Usuario"}
            {row.authorizedByName ? ` · autorizó ${row.authorizedByName}` : ""}
            {" · "}
            {serviceName}
          </div>
        </div>
        <ChevronDown className={cn("size-4 shrink-0 text-white/35 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-2 border-t border-white/[0.06] px-3.5 py-3 text-xs">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-white/35">Profesional</div>
              <div className="text-white/80">{employeeName}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-white/35">Servicio/producto</div>
              <div className="text-white/80">{serviceName}</div>
            </div>

            {row.actionType === "correction" && (() => {
              // Día abierto: after.total viene directo. Día cerrado
              // (adjustmentPaymentId presente): after solo trae el DELTA
              // (la venta original nunca se toca) — el "nuevo importe"
              // efectivo se deriva sumando ese delta al importe anterior.
              const newTotal =
                after.total != null
                  ? Number(after.total)
                  : before.total != null && after.delta_total != null
                    ? Number(before.total) + Number(after.delta_total)
                    : null;
              const newMethod = after.method ?? after.new_method ?? before.method;
              return (
                <>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-white/35">Importe anterior → nuevo</div>
                    <div className="text-white/80">
                      {money(before.total)} → <span className="font-semibold text-white">{money(newTotal)}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-white/35">Medio anterior → nuevo</div>
                    <div className="text-white/80">
                      {methodLabel(before.method)} → <span className="font-semibold text-white">{methodLabel(newMethod)}</span>
                    </div>
                  </div>
                </>
              );
            })()}

            {row.actionType !== "correction" && (
              <div className="col-span-2">
                <div className="text-[10px] uppercase tracking-wide text-white/35">Importe de la venta</div>
                <div className="text-white/80">{money(before.total)} · {methodLabel(before.method)}</div>
              </div>
            )}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-white/35">Motivo</div>
            <div className="text-white/80">{row.reason || "—"}</div>
          </div>

          {row.impactNote && (
            <div className="rounded-lg bg-white/[0.03] px-2.5 py-2 text-[11px] text-white/60">
              {row.impactNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PaymentAuthorizationHistoryPanel({ paymentId }: { paymentId: string }) {
  const [rows, setRows] = React.useState<PaymentAuthorizationLogRow[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getPaymentAuthorizationHistory(paymentId)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Cargando historial…
      </div>
    );
  }
  if (rows.length === 0) {
    return <div className="text-xs text-muted-foreground">Sin correcciones ni anulaciones todavía.</div>;
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <AuthorizationLogRow key={row.id} row={row} />
      ))}
    </div>
  );
}
