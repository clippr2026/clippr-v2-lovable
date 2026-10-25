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

// "No disponible" — nunca un dato inventado: antes de la migración
// 20261025060000, before_snapshot de corrección/anulación todavía no
// guardaba client_name/service_name/employee_name (solo lo hacía
// delete_payment_authorized) — un registro viejo puede legítimamente no
// tenerlo. Distinto de "—" (que podría leerse como "vacío a propósito").
const NOT_AVAILABLE = "No disponible";

function LabeledItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="min-w-0 truncate">
      <span className="text-white/35">{label}: </span>
      <span className="text-white/80">{value}</span>
    </span>
  );
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

  // "Modificado por" (quién ejecutó la corrección/anulación/eliminación)
  // — nunca confundir con "Profesional" (quién atendió la venta, abajo).
  // performed_by_name ya viene resuelto server-side (coalesce contra el
  // full_name real del empleado logueado); el fallback acá es solo por
  // si esa columna llegara null en algún registro viejo.
  const modifiedByName = row.performedByName ?? "Usuario sin nombre registrado";

  return (
    <div className="border-b border-white/[0.06] py-2.5 last:border-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
        <span className="shrink-0 tabular-nums text-white/45">{fmtDT(row.createdAt)}</span>
        <span className={cn("shrink-0 font-bold", ACTION_TONE[row.actionType])}>{ACTION_LABEL[row.actionType]}</span>

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

        <button
          type="button"
          onClick={() => setShowReason((v) => !v)}
          className="ml-auto shrink-0 text-[11px] font-semibold text-blue-300 hover:text-blue-200"
        >
          {showReason ? "Ocultar motivo" : "Ver motivo"}
        </button>
      </div>

      {/* Segunda línea: identidades — quién es el cliente/profesional/
          servicio de la venta (Cliente/Profesional/Servicio, solo en el
          historial general, showPaymentRef) vs. quién hizo ESTA
          modificación (Modificado por, siempre) — nunca mezclados en el
          mismo campo. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-white/55">
        {showPaymentRef && (
          <>
            <LabeledItem label="Cliente" value={before.client_name ?? NOT_AVAILABLE} />
            <LabeledItem label="Profesional" value={before.employee_name ?? NOT_AVAILABLE} />
            <LabeledItem label="Servicio" value={before.service_name ?? NOT_AVAILABLE} />
          </>
        )}
        <LabeledItem label="Modificado por" value={modifiedByName} />
        {row.authorizedByName && <LabeledItem label="Autorizó" value={row.authorizedByName} />}
      </div>

      {showReason && (
        // break-words corta incluso una cadena sin espacios (ej. un motivo
        // pegado sin cortes) para que nunca empuje el ancho de la tarjeta ni
        // genere scroll horizontal — min-w-0 para que, si esta fila vive
        // dentro de un contenedor flex en algún lugar, pueda encogerse en
        // vez de forzar el ancho. No trunca nada: un motivo histórico
        // larguísimo (de antes del límite de 200) se sigue viendo completo,
        // solo envuelve en más líneas.
        <div className="mt-1.5 min-w-0 space-y-1 overflow-hidden rounded-lg bg-white/[0.03] px-2.5 py-2 text-[11px] text-white/65">
          <p className="break-words">{row.reason || "Sin motivo registrado."}</p>
          {row.impactNote && <p className="break-words text-white/45">{row.impactNote}</p>}
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
