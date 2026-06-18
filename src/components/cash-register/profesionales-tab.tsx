import * as React from "react";
import { toast } from "sonner";
import { Loader2, BarChart3, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/date-range-picker";

/**
 * Portado de cjLoadProfesionales / cjPagarProf / cjConfirmarPagoProf /
 * cjVerPagosProf / cjVerProduccion (app.js ~9755-10130).
 */

type Employee = {
  id: string;
  full_name: string;
  commission_pct: number | null;
  commission_fixed: number | null;
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
  created_at?: string | null;
};

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
  const [payModal, setPayModal] = React.useState<{ emp: Employee; pendiente: number } | null>(null);
  const [detailModal, setDetailModal] = React.useState<{ type: "pagos" | "produccion"; emp: Employee } | null>(null);

  const load = React.useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const [empRes, payRes, poRes] = await Promise.allSettled([
      supabase.from("employees").select("id,full_name,commission_pct,commission_fixed,is_active").eq("business_id", businessId).order("full_name"),
      supabase.from("payments").select("employee_id,total,amount,payment_method,service_name,client_name,created_at").eq("business_id", businessId).gte("created_at", from + "T00:00:00").lte("created_at", to + "T23:59:59"),
      supabase.from("professional_payouts").select("id,employee_id,amount,date,method,note,created_by,created_at").eq("business_id", businessId).gte("date", from).lte("date", to).order("date", { ascending: false }),
    ]);
    setEmployees(empRes.status === "fulfilled" && !empRes.value.error ? ((empRes.value.data ?? []) as Employee[]).filter((e) => e.is_active !== false) : []);
    setPayments(payRes.status === "fulfilled" && !payRes.value.error ? ((payRes.value.data ?? []) as Payment[]) : []);
    setPayouts(poRes.status === "fulfilled" && !poRes.value.error ? ((poRes.value.data ?? []) as Payout[]) : []);
    setLoading(false);
  }, [businessId, from, to]);

  React.useEffect(() => { load(); }, [load]);

  const filtered = empId === "all" ? employees : employees.filter((e) => e.id === empId);

  return (
    <div className="space-y-5">
      {/* Filtros — solo profesional + rango de fechas */}
      <div className="flex flex-wrap items-end gap-3">
        <select
          value={empId}
          onChange={(e) => setEmpId(e.target.value)}
          className="flex-1 min-w-[180px] bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-blue-400/50 h-[38px]"
        >
          <option value="all">Todos los profesionales</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
        <DateRangePicker
          from={from}
          to={to}
          onChange={(r) => { setFrom(r.from); setTo(r.to); }}
        />
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
          const empPays = payments.filter((p) => p.employee_id === emp.id);
          const facturacion = empPays.reduce(
            (s, p) => s + Number(p.total ?? p.amount ?? 0), 0
          );
          // Commission: fixed amount takes priority over percentage
          const commFixed = Number(emp.commission_fixed ?? 0);
          const commPct   = Number(emp.commission_pct ?? 0);
          const comision = commFixed > 0
            ? commFixed * empPays.length          // fixed per service
            : Math.round((facturacion * commPct) / 100);
          const empPayouts = payouts.filter((p) => p.employee_id === emp.id);
          const pagado = empPayouts.reduce((s, p) => s + Number(p.amount ?? 0), 0);
          const pendiente = Math.max(0, comision - pagado);

          const commLabel = commFixed > 0
            ? `$${commFixed.toLocaleString("es-AR")} fijo/servicio`
            : commPct > 0
              ? `${commPct}% de ventas`
              : "Sin comisión";

          return (
            <div key={emp.id} className="relative overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.028] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="absolute -right-12 -top-16 h-32 w-32 rounded-full bg-blue-500/10 blur-3xl" />
              <div className="relative flex items-center justify-between flex-wrap gap-3 mb-4">
                <div>
                  <h3 className="text-base font-semibold text-foreground">{emp.full_name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {empPays.length} venta{empPays.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDetailModal({ type: "produccion", emp })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03] text-muted-foreground text-xs hover:bg-white/[0.07] hover:text-foreground transition"
                  >
                    <BarChart3 className="size-3.5" /> Producción
                  </button>
                  <button
                    onClick={() => setDetailModal({ type: "pagos", emp })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03] text-muted-foreground text-xs hover:bg-white/[0.07] hover:text-foreground transition"
                  >
                    Historial de pagos
                  </button>
                  {pendiente > 0 && (
                    <button
                      onClick={() => setPayModal({ emp, pendiente })}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/15 border border-blue-400/30 text-blue-200 text-xs hover:bg-blue-500/25 transition shadow-[0_10px_28px_-18px_rgba(251,191,36,0.8)]"
                    >
                      Pagar comisión
                    </button>
                  )}
                </div>
              </div>
              <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {[
                  { label: "Comisión",    val: `$${comision.toLocaleString("es-AR")}`,    cls: "text-blue-300"   },
                  { label: "Pagado",      val: `$${pagado.toLocaleString("es-AR")}`,      cls: "text-sky-300"     },
                  { label: "Pendiente",   val: `$${pendiente.toLocaleString("es-AR")}`,   cls: pendiente > 0 ? "text-rose-300" : "text-muted-foreground" },
                ].map(({ label, val, cls }) => (
                  <div key={label} className="rounded-2xl bg-white/[0.035] border border-white/[0.07] p-3.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                    <div className="text-[10px] text-muted-foreground/80 uppercase tracking-[0.12em]">{label}</div>
                    <div className={cn("text-lg font-bold tabular-nums mt-1", cls)}>{val}</div>
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
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-lg font-semibold text-foreground mt-1 focus:outline-none focus:border-blue-400/50"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Método de pago</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground mt-1 focus:outline-none focus:border-blue-400/50"
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
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground mt-1 focus:outline-none focus:border-blue-400/50"
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
            className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-blue-500 to-violet-500 text-zinc-950 font-semibold text-sm disabled:opacity-50"
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
        .select("id,employee_id,amount,date,method,note,created_by,created_at")
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
            (data as Payout[]).map((p) => {
              const dt = p.created_at ? new Date(p.created_at) : new Date(p.date + "T12:00:00");
              const fecha = dt.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "numeric" }).replace(".", "");
              const hora = dt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-2 border-b border-white/5"
                >
                  <div>
                    <div className="text-sm text-foreground capitalize">{fecha}</div>
                    <div className="text-xs text-muted-foreground">
                      {hora} · {p.created_by ?? "Caja"} pagó · {p.method ?? "Sin método"}
                      {p.note ? ` · ${p.note}` : ""}
                    </div>
                  </div>
                  <div className="text-sm font-bold text-emerald-300 tabular-nums">
                    ${Number(p.amount).toLocaleString("es-AR")}
                  </div>
                </div>
              );
            })
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
