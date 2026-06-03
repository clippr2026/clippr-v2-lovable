import * as React from "react";
import { toast } from "sonner";
import { Loader2, BarChart3, X, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Portado de cjLoadProfesionales / cjPagarProf / cjConfirmarPagoProf /
 * cjVerPagosProf / cjVerProduccion (app.js ~9755-10130).
 * Tablas: employees (commission_pct), payments (total/amount, employee_id),
 *         professional_payouts (amount, date, method, note, created_by).
 *
 * KPIs por profesional (en rango from..to):
 *   facturacion = Σ payments.total||amount
 *   comision    = round(facturacion * commission_pct / 100)
 *   pagado      = Σ professional_payouts.amount
 *   pendiente   = max(0, comision - pagado)
 */

type Employee = {
  id: string;
  full_name: string;
  commission_pct: number | null;
  is_active?: boolean | null;
};

type Payment = {
  employee_id: string | null;
  total: number | null;
  amount: number | null;
  payment_method: string | null;
  service_name: string | null;
  client_name: string | null;
  created_at: string;
};

type Payout = {
  id: string;
  employee_id: string;
  amount: number;
  date: string;
  method: string | null;
  note: string | null;
  created_by: string | null;
};

const RANGES = [
  { id: "hoy", label: "Hoy" },
  { id: "semana", label: "Esta semana" },
  { id: "mes", label: "Este mes" },
  { id: "mes_ant", label: "Mes anterior" },
] as const;

function computeRange(preset: (typeof RANGES)[number]["id"]) {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === "hoy") return { from: iso(now), to: iso(now) };
  if (preset === "semana") {
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day - 1));
    return { from: iso(monday), to: iso(now) };
  }
  if (preset === "mes") {
    return {
      from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: iso(now),
    };
  }
  // mes_ant
  const firstPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastPrev = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: iso(firstPrev), to: iso(lastPrev) };
}

export function ProfesionalesTab({
  businessId,
  userEmail,
}: {
  businessId: string | null;
  userEmail: string | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = React.useState(today);
  const [to, setTo] = React.useState(today);
  const [empId, setEmpId] = React.useState<string>("all");
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [payments, setPayments] = React.useState<Payment[]>([]);
  const [payouts, setPayouts] = React.useState<Payout[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [payModal, setPayModal] = React.useState<{
    emp: Employee;
    pendiente: number;
  } | null>(null);
  const [detailModal, setDetailModal] = React.useState<{
    type: "pagos" | "produccion";
    emp: Employee;
  } | null>(null);

  const load = React.useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const fromISO = from + "T00:00:00";
    const toISO = to + "T23:59:59";
    const [empRes, payRes, poRes] = await Promise.allSettled([
      supabase
        .from("employees")
        .select("id,full_name,commission_pct,is_active")
        .eq("business_id", businessId)
        .order("full_name"),
      supabase
        .from("payments")
        .select("employee_id,total,amount,payment_method,service_name,client_name,created_at")
        .eq("business_id", businessId)
        .gte("created_at", fromISO)
        .lte("created_at", toISO),
      supabase
        .from("professional_payouts")
        .select("id,employee_id,amount,date,method,note,created_by")
        .eq("business_id", businessId)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: false }),
    ]);

    setEmployees(
      empRes.status === "fulfilled" && !empRes.value.error
        ? ((empRes.value.data ?? []) as Employee[]).filter((e) => e.is_active !== false)
        : []
    );
    setPayments(
      payRes.status === "fulfilled" && !payRes.value.error
        ? ((payRes.value.data ?? []) as Payment[])
        : []
    );
    setPayouts(
      poRes.status === "fulfilled" && !poRes.value.error
        ? ((poRes.value.data ?? []) as Payout[])
        : []
    );
    setLoading(false);
  }, [businessId, from, to]);

  React.useEffect(() => {
    load();
  }, [load]);

  const filtered = empId === "all" ? employees : employees.filter((e) => e.id === empId);

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <select
            value={empId}
            onChange={(e) => setEmpId(e.target.value)}
            className="flex-1 min-w-[180px] bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-amber-300/50"
          >
            <option value="all">Todos los profesionales</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
          <label className="group relative min-w-[170px] flex-1 sm:flex-none">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Desde
            </span>
            <span className="pointer-events-none absolute left-3 bottom-2.5 text-muted-foreground group-focus-within:text-amber-200">
              <CalendarDays className="size-4" />
            </span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              onClick={(e) => e.currentTarget.showPicker?.()}
              className="w-full cursor-pointer bg-white/[0.04] border border-white/10 rounded-lg pl-10 pr-3 py-2 text-sm text-foreground focus:outline-none focus:border-amber-300/50"
            />
          </label>
          <label className="group relative min-w-[170px] flex-1 sm:flex-none">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Hasta
            </span>
            <span className="pointer-events-none absolute left-3 bottom-2.5 text-muted-foreground group-focus-within:text-amber-200">
              <CalendarDays className="size-4" />
            </span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onClick={(e) => e.currentTarget.showPicker?.()}
              className="w-full cursor-pointer bg-white/[0.04] border border-white/10 rounded-lg pl-10 pr-3 py-2 text-sm text-foreground focus:outline-none focus:border-amber-300/50"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                const range = computeRange(r.id);
                setFrom(range.from);
                setTo(range.to);
              }}
              className="px-3 py-1 rounded-md border border-white/10 text-xs text-muted-foreground hover:text-foreground hover:border-white/20"
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-5 py-12 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
          <Loader2 className="size-4 animate-spin" /> Cargando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-5 py-12 text-center text-sm text-muted-foreground">
          Sin profesionales activos.
        </div>
      ) : (
        filtered.map((emp) => {
          const commPct = Number(emp.commission_pct ?? 0);
          const empPays = payments.filter((p) => p.employee_id === emp.id);
          const facturacion = empPays.reduce(
            (s, p) => s + Number(p.total ?? p.amount ?? 0),
            0
          );
          const comision = Math.round((facturacion * commPct) / 100);
          const empPayouts = payouts.filter((p) => p.employee_id === emp.id);
          const pagado = empPayouts.reduce((s, p) => s + Number(p.amount ?? 0), 0);
          const pendiente = Math.max(0, comision - pagado);
          return (
            <div
              key={emp.id}
              className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"
            >
              <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                <div>
                  <h3 className="text-base font-semibold text-foreground">{emp.full_name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {empPays.length} venta{empPays.length === 1 ? "" : "s"} en el período
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDetailModal({ type: "produccion", emp })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 text-muted-foreground text-xs"
                  >
                    <BarChart3 className="size-3.5" /> Producción
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Ventas", `${empPays.length}`, "text-foreground"],
                  ["Producción", `$${facturacion.toLocaleString("es-AR")}`, "text-emerald-300"],
                ].map(([label, val, color]) => (
                  <div
                    key={label}
                    className="rounded-lg bg-white/[0.03] border border-white/5 p-3 text-center"
                  >
                    <div className="text-[10px] text-muted-foreground/80">{label}</div>
                    <div className={cn("text-base font-bold tabular-nums mt-1", color)}>
                      {val}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {payModal && (
        <PayModal
          emp={payModal.emp}
          pendiente={payModal.pendiente}
          businessId={businessId!}
          userEmail={userEmail}
          onClose={() => setPayModal(null)}
          onSaved={() => {
            setPayModal(null);
            load();
          }}
        />
      )}

      {detailModal && (
        <DetailModal
          type={detailModal.type}
          emp={detailModal.emp}
          businessId={businessId!}
          from={from}
          to={to}
          onClose={() => setDetailModal(null)}
        />
      )}
    </div>
  );
}

function PayModal({
  emp,
  pendiente,
  businessId,
  userEmail,
  onClose,
  onSaved,
}: {
  emp: Employee;
  pendiente: number;
  businessId: string;
  userEmail: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = React.useState(String(pendiente));
  const [method, setMethod] = React.useState("Efectivo");
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function save() {
    const monto = parseFloat(amount);
    if (!monto || monto <= 0) return toast.error("Ingresá un monto válido");
    setSaving(true);
    const { error } = await supabase.from("professional_payouts").insert({
      business_id: businessId,
      employee_id: emp.id,
      amount: monto,
      date: new Date().toISOString().slice(0, 10),
      method,
      note: note.trim() || null,
      created_by: userEmail ?? "Admin",
    });
    setSaving(false);
    if (error) return toast.error("Error al guardar pago: " + error.message);
    toast.success(`✓ Pago de $${monto.toLocaleString("es-AR")} registrado`);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-foreground">Pagar profesional</h3>
          <button onClick={onClose} className="text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="text-xs text-muted-foreground mb-4">
          {emp.full_name} · Pendiente ${pendiente.toLocaleString("es-AR")}
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-muted-foreground">Monto</label>
            <input
              autoFocus
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-lg font-semibold text-foreground mt-1 focus:outline-none focus:border-amber-300/50"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Método de pago</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground mt-1 focus:outline-none focus:border-amber-300/50"
            >
              {["Efectivo", "Transferencia", "Débito", "Crédito", "Mercado Pago"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Nota (opcional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej: Pago parcial mayo"
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground mt-1 focus:outline-none focus:border-amber-300/50"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-white/10 text-muted-foreground text-sm"
          >
            Cancelar
          </button>
          <button
            disabled={saving}
            onClick={save}
            className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-amber-300 to-amber-400 text-zinc-950 font-semibold text-sm disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar pago"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailModal({
  type,
  emp,
  businessId,
  from,
  to,
  onClose,
}: {
  type: "pagos" | "produccion";
  emp: Employee;
  businessId: string;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const [data, setData] = React.useState<Payout[] | Payment[] | null>(null);

  React.useEffect(() => {
    if (type === "pagos") {
      supabase
        .from("professional_payouts")
        .select("id,employee_id,amount,date,method,note,created_by")
        .eq("business_id", businessId)
        .eq("employee_id", emp.id)
        .order("date", { ascending: false })
        .then(({ data }) => setData((data ?? []) as Payout[]));
    } else {
      supabase
        .from("payments")
        .select("employee_id,total,amount,payment_method,service_name,client_name,created_at")
        .eq("business_id", businessId)
        .eq("employee_id", emp.id)
        .gte("created_at", from + "T00:00:00")
        .lte("created_at", to + "T23:59:59")
        .order("created_at", { ascending: false })
        .then(({ data }) => setData((data ?? []) as Payment[]));
    }
  }, [type, emp.id, businessId, from, to]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-foreground">
              {type === "pagos" ? "Historial de pagos" : "Producción detallada"}
            </h3>
            <p className="text-xs text-muted-foreground">{emp.full_name}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {data === null ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Cargando…</div>
          ) : data.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Sin datos.</div>
          ) : type === "pagos" ? (
            (data as Payout[]).map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between py-2 border-b border-white/5"
              >
                <div>
                  <div className="text-sm text-foreground">
                    {new Date(p.date + "T12:00:00").toLocaleDateString("es-AR")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.method ?? "—"}
                    {p.note ? ` · ${p.note}` : ""}
                    {p.created_by ? ` · ${p.created_by}` : ""}
                  </div>
                </div>
                <div className="text-sm font-bold text-emerald-300 tabular-nums">
                  ${Number(p.amount).toLocaleString("es-AR")}
                </div>
              </div>
            ))
          ) : (
            (data as Payment[]).map((p, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-white/5">
                <div>
                  <div className="text-sm text-foreground">{p.service_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.client_name ?? "—"} ·{" "}
                    {new Date(p.created_at).toLocaleString("es-AR", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <div className="text-sm font-semibold text-foreground tabular-nums">
                  ${Number(p.total ?? p.amount ?? 0).toLocaleString("es-AR")}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
