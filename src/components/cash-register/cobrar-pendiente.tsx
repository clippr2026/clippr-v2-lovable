import * as React from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Search, X, Loader2, Check, Clock, ChevronRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  ACTIVE_PAY_METHODS,
  PAY_METHOD_LABEL,
  type PayMethod,
} from "@/components/cash-register/register-payment";
import type { Employee } from "@/components/cash-register/use-caja-data";

// ============================================================================
// Caja → Ingresar dinero → Cobrar pendiente
// ============================================================================
// Pantalla nueva (sección 2.B del pedido): lista de ventas con saldo
// pendiente (payments.status en pendiente/parcial — ver
// 20261023010000_pending_payments_schema.sql), con buscador/filtros, y un
// formulario de cobro que llama a la RPC collect_pending_payment (ver
// 20261023030000_collect_pending_payment.sql). Nunca crea una venta nueva:
// el cobro queda vinculado al mismo payments.id de siempre.
// ============================================================================

export type PendingDebt = {
  id: string;
  client_name: string | null;
  service_name: string | null;
  employee_id: string | null;
  created_at: string;
  total: number;
  collected_amount: number;
  status: "pendiente" | "parcial" | string;
  method: string | null;
  branch_id: string | null;
};

function fmtMoney(n: number) {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso;
  }
}

// Server-side: trae ventas con saldo (pendiente/parcial) del negocio,
// filtradas por sucursal/profesional/fecha/cliente — nunca trae TODO para
// filtrar en el cliente (una barbería con historial largo podría tener
// cientos de deudas acumuladas).
export async function searchPendingDebts(params: {
  businessId: string;
  branchId?: string | null;
  query?: string;
  employeeId?: string | null;
  status?: "pendiente" | "parcial" | "todos";
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<PendingDebt[]> {
  let q = supabase
    .from("payments")
    .select(
      "id,client_name,service_name,employee_id,created_at,total,amount,collected_amount,status,method,payment_method,branch_id",
    )
    .eq("business_id", params.businessId)
    .order("created_at", { ascending: false })
    .limit(300);

  if (params.status === "pendiente" || params.status === "parcial") {
    q = q.eq("status", params.status);
  } else {
    q = q.in("status", ["pendiente", "parcial"]);
  }
  if (params.branchId) q = q.or(`branch_id.eq.${params.branchId},branch_id.is.null`);
  if (params.employeeId) q = q.eq("employee_id", params.employeeId);
  if (params.dateFrom) q = q.gte("created_at", params.dateFrom);
  if (params.dateTo) q = q.lte("created_at", params.dateTo);
  if (params.query?.trim()) {
    const s = params.query.trim().replace(/[%,()]/g, " ").trim();
    if (s) q = q.ilike("client_name", `%${s}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    client_name: (r.client_name as string | null) ?? null,
    service_name: (r.service_name as string | null) ?? null,
    employee_id: (r.employee_id as string | null) ?? null,
    created_at: String(r.created_at),
    total: Number(r.total ?? r.amount ?? 0),
    collected_amount: Number(r.collected_amount ?? 0),
    status: String(r.status ?? "pendiente"),
    method: (r.method as string | null) ?? (r.payment_method as string | null) ?? null,
    branch_id: (r.branch_id as string | null) ?? null,
  }));
}

export async function collectPendingPayment(input: {
  businessId: string;
  branchId?: string | null;
  paymentId: string;
  amount: number;
  method: PayMethod;
  collectedBy: string;
  collectedByName?: string | null;
  observations?: string | null;
  receiptPath?: string | null;
  idempotencyKey?: string | null;
}): Promise<{
  payment_collection_id: string;
  payment_id: string;
  new_status: string;
  new_collected_amount: number;
  new_pending_amount: number;
}> {
  const { data, error } = await supabase.rpc("collect_pending_payment" as any, {
    p_business_id: input.businessId,
    p_payment_id: input.paymentId,
    p_amount: input.amount,
    p_method: input.method,
    p_collected_by: input.collectedBy,
    p_branch_id: input.branchId ?? null,
    p_receipt_path: input.receiptPath ?? null,
    p_observations: input.observations ?? null,
    p_collected_by_name: input.collectedByName ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });
  if (error) throw new Error(error.message || "No se pudo registrar el cobro");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Respuesta vacía del servidor al cobrar el pendiente");
  return row as {
    payment_collection_id: string;
    payment_id: string;
    new_status: string;
    new_collected_amount: number;
    new_pending_amount: number;
  };
}

function StatusChip({ status }: { status: string }) {
  const isParcial = status === "parcial";
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        isParcial ? "bg-amber-400/15 text-amber-200" : "bg-rose-400/15 text-rose-200",
      )}
    >
      {isParcial ? "Parcial" : "Pendiente"}
    </span>
  );
}

function DebtRow({
  debt,
  employeeName,
  onClick,
}: {
  debt: PendingDebt;
  employeeName: string;
  onClick: () => void;
}) {
  const saldo = Math.max(0, debt.total - debt.collected_amount);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-left transition hover:border-amber-300/30 hover:bg-amber-400/[0.05]"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold text-white">
            {debt.client_name || "Cliente del mostrador"}
          </span>
          <StatusChip status={debt.status} />
        </div>
        <p className="truncate text-xs text-white/55">{debt.service_name || "Venta"}</p>
        <p className="text-[11px] text-white/35">
          {fmtDate(debt.created_at)} · {employeeName}
          {debt.collected_amount > 0 && <> · ya abonado {fmtMoney(debt.collected_amount)}</>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-right text-base font-extrabold tabular-nums text-amber-200">
          {fmtMoney(saldo)}
        </span>
        <ChevronRight className="size-4 text-white/30" />
      </div>
    </button>
  );
}

function CollectForm({
  debt,
  employeeName,
  businessId,
  branchId,
  collectedBy,
  collectedByName,
  onDone,
  onBack,
}: {
  debt: PendingDebt;
  employeeName: string;
  businessId: string;
  branchId: string | null;
  collectedBy: string;
  collectedByName?: string | null;
  onDone: (result: { newStatus: string; amount: number }) => void;
  onBack: () => void;
}) {
  const saldo = Math.max(0, debt.total - debt.collected_amount);
  const [amountStr, setAmountStr] = React.useState(String(Math.round(saldo)));
  const [method, setMethod] = React.useState<PayMethod>("cash");
  const [observations, setObservations] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const idempotencyKeyRef = React.useRef<string>(crypto.randomUUID());

  const amount = Number(amountStr.replace(/\D/g, "")) || 0;
  const isTotal = amount >= Math.round(saldo);

  async function handleConfirm() {
    if (amount <= 0) {
      toast.error("Ingresá un importe mayor a $0.");
      return;
    }
    if (amount > saldo + 0.5) {
      toast.error(`No podés cobrar más del saldo pendiente (${fmtMoney(saldo)}).`);
      return;
    }
    setSubmitting(true);
    try {
      const result = await collectPendingPayment({
        businessId,
        branchId,
        paymentId: debt.id,
        amount,
        method,
        collectedBy,
        collectedByName,
        observations: observations.trim() || null,
        receiptPath: reference.trim() || null,
        idempotencyKey: idempotencyKeyRef.current,
      });
      toast.success(
        result.new_status === "cobrado"
          ? `Pendiente cobrado por completo · ${fmtMoney(amount)}`
          : `Cobro parcial registrado · ${fmtMoney(amount)} · saldo ${fmtMoney(result.new_pending_amount)}`,
      );
      onDone({ newStatus: result.new_status, amount });
    } catch (e) {
      toast.error((e as Error).message || "No se pudo registrar el cobro");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3.5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/50 hover:text-white/80"
      >
        <ArrowLeft className="size-3.5" /> Volver a la lista
      </button>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 space-y-1">
        <p className="text-sm font-bold text-white">{debt.client_name || "Cliente del mostrador"}</p>
        <p className="text-xs text-white/55">{debt.service_name || "Venta"}</p>
        <p className="text-[11px] text-white/35">
          {fmtDate(debt.created_at)} · {employeeName}
        </p>
        <div className="mt-1.5 flex items-center justify-between border-t border-white/10 pt-1.5 text-xs">
          <span className="text-white/45">Total venta</span>
          <span className="font-semibold text-white">{fmtMoney(debt.total)}</span>
        </div>
        {debt.collected_amount > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/45">Ya abonado</span>
            <span className="font-semibold text-emerald-300">{fmtMoney(debt.collected_amount)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-xs">
          <span className="text-white/45">Saldo pendiente</span>
          <span className="font-bold text-amber-200">{fmtMoney(saldo)}</span>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold tracking-[0.1em] text-white/50">IMPORTE A COBRAR</p>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-bold text-white/55">
            $
          </span>
          <input
            value={amount ? amount.toLocaleString("es-AR") : ""}
            onChange={(e) => setAmountStr(e.target.value.replace(/\D/g, "").slice(0, 9))}
            inputMode="numeric"
            className="h-11 w-full rounded-xl border border-emerald-300/30 bg-black/45 pl-8 pr-20 text-left text-lg font-extrabold tabular-nums text-white outline-none focus:border-emerald-300/65 focus:ring-2 focus:ring-emerald-400/20"
          />
          <button
            type="button"
            onClick={() => setAmountStr(String(Math.round(saldo)))}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-white/[0.06] px-2 py-1 text-[10px] font-bold text-white/60 hover:bg-white/[0.1]"
          >
            TOTAL
          </button>
        </div>
        {!isTotal && amount > 0 && (
          <p className="mt-1 text-[11px] text-amber-200/70">
            Queda ${Math.round(saldo - amount).toLocaleString("es-AR")} pendiente después de este cobro.
          </p>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold tracking-[0.1em] text-white/50">MEDIO DE PAGO</p>
        <div className="grid grid-cols-3 gap-1.5">
          {ACTIVE_PAY_METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMethod(m.id)}
              className={cn(
                "rounded-xl border px-2 py-2 text-xs font-semibold transition",
                method === m.id
                  ? "border-blue-300/48 bg-blue-400/[0.14] text-white"
                  : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className="text-[11px] text-white/50">Referencia / comprobante (opcional)</label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Nº operación, etc."
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-blue-300/40"
          />
        </div>
        <div>
          <label className="text-[11px] text-white/50">Observación (opcional)</label>
          <input
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            placeholder="Nota interna"
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-blue-300/40"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleConfirm}
        disabled={submitting || amount <= 0}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#34D399,#10B981)] px-5 py-3 text-sm font-extrabold text-white shadow-[0_0_30px_rgba(16,185,129,0.25)] transition-all hover:brightness-110 disabled:opacity-40"
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Registrando…
          </>
        ) : (
          <>
            {isTotal ? "Confirmar cobro total" : "Confirmar cobro parcial"} <Check className="size-4" />
          </>
        )}
      </button>
    </div>
  );
}

export function CobrarPendienteModal({
  businessId,
  branchId,
  employees,
  collectedBy,
  collectedByName,
  onClose,
  onCollected,
}: {
  businessId: string;
  branchId: string | null;
  employees: Employee[];
  collectedBy: string;
  collectedByName?: string | null;
  onClose: () => void;
  onCollected: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [employeeFilter, setEmployeeFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"todos" | "pendiente" | "parcial">("todos");
  const [debts, setDebts] = React.useState<PendingDebt[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<PendingDebt | null>(null);

  const employeeNameById = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of employees) map[e.id] = e.name;
    return map;
  }, [employees]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const rows = await searchPendingDebts({
        businessId,
        branchId,
        query,
        employeeId: employeeFilter || null,
        status: statusFilter,
      });
      setDebts(rows);
    } catch (e) {
      toast.error((e as Error).message || "No se pudieron cargar los pendientes");
    } finally {
      setLoading(false);
    }
  }, [businessId, branchId, query, employeeFilter, statusFilter]);

  // Debounced — mismo criterio que ClientAutocomplete (250ms).
  React.useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-[oklch(0.11_0.04_275)] shadow-2xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Clock className="size-4 text-amber-300" /> Cobrar pendiente
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {selected ? (
            <CollectForm
              debt={selected}
              employeeName={employeeNameById[selected.employee_id ?? ""] ?? "—"}
              businessId={businessId}
              branchId={branchId}
              collectedBy={collectedBy}
              collectedByName={collectedByName}
              onBack={() => setSelected(null)}
              onDone={() => {
                setSelected(null);
                onCollected();
                load();
              }}
            />
          ) : (
            <div className="space-y-3">
              <div className="relative w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/38" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por cliente…"
                  className="h-10 w-full rounded-2xl border border-white/[0.08] bg-[#060812]/72 pl-10 pr-4 text-sm text-white outline-none placeholder:text-white/35 focus:border-amber-300/35 focus:ring-2 focus:ring-amber-400/12"
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(["todos", "pendiente", "parcial"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold transition",
                      statusFilter === s
                        ? "bg-amber-400/20 text-amber-100 ring-1 ring-amber-400/40"
                        : "bg-white/[0.04] text-white/55 hover:bg-white/[0.08]",
                    )}
                  >
                    {s === "todos" ? "Todos" : s === "pendiente" ? "Pendiente" : "Parcial"}
                  </button>
                ))}
                <select
                  value={employeeFilter}
                  onChange={(e) => setEmployeeFilter(e.target.value)}
                  className="rounded-full bg-white/[0.04] px-3 py-1 text-xs font-semibold text-white/70 outline-none hover:bg-white/[0.08]"
                >
                  <option value="">Todos los profesionales</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-10 text-white/40">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : debts.length === 0 ? (
                <div className="py-10 text-center text-sm text-white/40">
                  No hay pagos pendientes {query || employeeFilter || statusFilter !== "todos" ? "con ese filtro" : ""}.
                </div>
              ) : (
                <div className="space-y-2">
                  {debts.map((d) => (
                    <DebtRow
                      key={d.id}
                      debt={d}
                      employeeName={employeeNameById[d.employee_id ?? ""] ?? "—"}
                      onClick={() => setSelected(d)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
