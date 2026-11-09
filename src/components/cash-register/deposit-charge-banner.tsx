import * as React from "react";
import { supabase } from "@/integrations/supabase/client";

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;

/** Seña ya recibida de un turno (0 si no tiene o todavía no está pagada). */
export function useDepositCredit(appointmentId: string | null | undefined): number {
  const [paid, setPaid] = React.useState(0);
  React.useEffect(() => {
    setPaid(0);
    if (!appointmentId || appointmentId.startsWith("__")) return;
    let off = false;
    void (async () => {
      const { data: dep } = await (supabase.from("appointment_deposits" as any) as any)
        .select("status,paid_amount")
        .eq("appointment_id", appointmentId)
        .maybeSingle();
      if (off || dep?.status !== "paid") return;
      setPaid(Math.max(0, Number(dep.paid_amount) || 0));
    })();
    return () => {
      off = true;
    };
  }, [appointmentId]);
  return paid;
}

/**
 * Aviso en "Cobrar turno" cuando el turno tiene una seña ya recibida: muestra cuánto se cobra ahora.
 * La venta se registra por el servicio completo; la seña pagada queda como un medio de pago más
 * (ver applyDepositToSplits) y no vuelve a contar como plata recibida.
 */
export function DepositChargeBanner({ appointmentId }: { appointmentId: string | null | undefined }) {
  const [info, setInfo] = React.useState<{ paid: number; price: number } | null>(null);

  React.useEffect(() => {
    setInfo(null);
    if (!appointmentId) return;
    let off = false;
    void (async () => {
      const [{ data: dep }, { data: appt }] = await Promise.all([
        (supabase.from("appointment_deposits" as any) as any).select("status,paid_amount").eq("appointment_id", appointmentId).maybeSingle(),
        supabase.from("appointments").select("service_price").eq("id", appointmentId).maybeSingle(),
      ]);
      if (off || dep?.status !== "paid" || !(Number(dep.paid_amount) > 0)) return;
      setInfo({ paid: Number(dep.paid_amount), price: Number(appt?.service_price) || 0 });
    })();
    return () => {
      off = true;
    };
  }, [appointmentId]);

  if (!info) return null;
  const rest = Math.max(0, info.price - info.paid);
  return (
    <div className="mb-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3.5 text-sm">
      <div className="font-semibold text-emerald-200">🟢 Este turno tiene seña pagada: {money(info.paid)}</div>
      <div className="mt-1 text-foreground/85">
        Cargá el servicio completo y cobrale al cliente solo lo que falta
        {info.price > 0 ? <> (<strong>{money(rest)}</strong> si no agrega nada más)</> : null}. La seña se descuenta sola y no se cuenta dos veces en Caja.
      </div>
    </div>
  );
}
