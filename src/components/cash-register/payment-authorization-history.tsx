import * as React from "react";
import { Loader2 } from "lucide-react";
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
//
// Fila compacta de una sola línea (envuelve en varias en mobile, nunca
// una tarjeta grande): todo visible de entrada — lo único detrás de un
// clic es el motivo/la nota ("Ver motivo"), a pedido explícito.

const ACTION_LABEL: Record<PaymentAuthorizationLogAction, string> = {
  correction: "Cobro corregido",
  void: "Venta anulada",
  deletion: "Cobro eliminado",
};

// Rojo para anulación/eliminación (son, en los hechos, la misma
// contraseña y la misma severidad — un borrado es una anulación más
// fuerte, ver delete_payment_authorized), un color discreto distinto
// para corrección.
const ACTION_TONE: Record<PaymentAuthorizationLogAction, string> = {
  correction: "text-sky-300",
  void: "text-red-400",
  deletion: "text-red-400",
};

function fmtDT(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
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
  if (!m) return null;
  return PAY_METHOD_LABEL_LOCAL[String(m)] ?? String(m);
}

export function AuthorizationLogRow({
  row,
  showPaymentRef = false,
}: {
  row: PaymentAuthorizationLogRow;
  // En el historial GENERAL (no el de una venta puntual) hace falta
  // Cliente/Profesional/Servicio — en el de una venta puntual es
  // redundante (el detalle de ESA venta ya lo muestra arriba, ver
  // "evitar información repetida").
  showPaymentRef?: boolean;
}) {
  const [showReason, setShowReason] = React.useState(false);
  const before = row.beforeSnapshot ?? {};
  const after = row.afterSnapshot ?? {};

  // Día abierto: after.total viene directo. Día cerrado
  // (adjustmentPaymentId presente, solo corrección): after solo trae el
  // DELTA (la venta original nunca se toca) — el "nuevo importe" efectivo
  // se deriva sumando ese delta al importe anterior.
  const newTotal =
    row.actionType === "correction"
      ? after.total != null
        ? Number(after.total)
        : before.total != null && after.delta_total != null
          ? Number(before.total) + Number(after.delta_total)
          : null
      : null;
  const amountChanged = newTotal != null && Math.round(newTotal) !== Math.round(Number(before.total ?? 0));

  const newMethodRaw = row.actionType === "correction" ? (after.method ?? after.new_method ?? null) : null;
  const methodChanged = newMethodRaw != null && String(newMethodRaw) !== String(before.method ?? "");

  return (
    <div className="border-b border-white/[0.06] py-2 last:border-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
        <span className="shrink-0 tabular-nums text-white/45">{fmtDT(row.createdAt)}</span>
        <span className={cn("shrink-0 font-bold", ACTION_TONE[row.actionType])}>{ACTION_LABEL[row.actionType]}</span>

        {showPaymentRef && (
          <span className="min-w-0 truncate text-white/75">
            {before.client_name ?? "Cliente"}
            {before.employee_name ? ` · ${before.employee_name}` : ""}
            {before.service_name ? ` · ${before.service_name}` : ""}
          </span>
        )}

        <span className="shrink-0 font-semibold tabular-nums text-white">
          {amountChanged ? (
            <>
              {money(before.total)} → {money(newTotal)}
            </>
          ) : (
            money(before.total)
          )}
        </span>

        {methodChanged && (
          <span className="shrink-0 text-white/55">
            {methodLabel(before.method)} → {methodLabel(newMethodRaw)}
          </span>
        )}

        <span className="min-w-0 truncate text-white/45">
          {row.performedByName ?? "Usuario"}
          {row.authorizedByName ? ` · autorizó ${row.authorizedByName}` : ""}
        </span>

        <button
          type="button"
          onClick={() => setShowReason((v) => !v)}
          className="ml-auto shrink-0 text-[11px] font-semibold text-blue-300 hover:text-blue-200"
        >
          {showReason ? "Ocultar motivo" : "Ver motivo"}
        </button>
      </div>

      {showReason && (
        <div className="mt-1.5 space-y-1 rounded-lg bg-white/[0.03] px-2.5 py-2 text-[11px] text-white/65">
          <p>{row.reason || "Sin motivo registrado."}</p>
          {row.impactNote && <p className="text-white/45">{row.impactNote}</p>}
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
    <div>
      {rows.map((row) => (
        <AuthorizationLogRow key={row.id} row={row} />
      ))}
    </div>
  );
}
