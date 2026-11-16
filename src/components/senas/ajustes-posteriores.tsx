import * as React from "react";
import { supabase } from "@/integrations/supabase/client";

// Señas aprobadas fuera de la caja contada (tabla caja_ajustes_posteriores, solo lectura):
//   · ajuste_posterior: la caja de ese día ya estaba cerrada. El cierre original no se toca.
//   · fuera_de_jornada: ese día no hubo caja.
//   · reversion: contra-asiento de una aprobación hecha por error (no es plata que salió).
export type AjustePosterior = {
  id: string;
  tipo: "ajuste_posterior" | "fuera_de_jornada" | "reversion";
  concepto: string;
  fecha_bancaria: string;
  monto: number;
  metodo: "efectivo" | "cuenta";
  cliente: string | null;
  servicio: string | null;
  approved_at: string | null;
  approved_by_nombre: string | null;
  motivo: string | null;
  requiere_conciliacion: boolean;
  created_at: string;
};

const BA = "America/Argentina/Buenos_Aires";
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(Number(n) || 0)).toLocaleString("es-AR")}`;
const fechaHora = (iso: string | null) =>
  iso
    ? `${new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: BA })} ${new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: BA })}`
    : "";
export const fechaAjusteLabel = (key: string) => {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
};

const COLUMNAS =
  "id,tipo,concepto,fecha_bancaria,monto,metodo,cliente,servicio,approved_at,approved_by_nombre,motivo,requiere_conciliacion,created_at";

/** Ajustes posteriores del negocio (todos, o solo los de una fecha). Un profesional no ve ninguno (lo filtra la base). */
export function useAjustesPosteriores(businessId: string | null | undefined, branchId: string | null | undefined, fecha?: string | null) {
  const [rows, setRows] = React.useState<AjustePosterior[]>([]);
  const refresh = React.useCallback(async () => {
    if (!businessId) return setRows([]);
    let q = (supabase.from("caja_ajustes_posteriores" as any) as any)
      .select(COLUMNAS)
      .eq("business_id", businessId)
      .order("created_at", { ascending: true });
    if (branchId) q = q.eq("branch_id", branchId);
    if (fecha) q = q.eq("fecha_bancaria", fecha);
    const { data, error } = await q;
    if (!error) setRows(((data ?? []) as any[]).map((r) => ({ ...r, monto: Number(r.monto) || 0 })) as AjustePosterior[]);
  }, [businessId, branchId, fecha]);
  React.useEffect(() => {
    void refresh();
  }, [refresh]);
  return { rows, refresh };
}

/** Totales de un grupo de ajustes: lo que suma al dinero en banco y el efectivo físico que hay que conciliar. */
export function totalesAjustes(rows: AjustePosterior[]) {
  let cuenta = 0;
  let efectivo = 0;
  for (const r of rows) {
    if (r.metodo === "efectivo") efectivo += r.monto;
    else cuenta += r.monto;
  }
  return { cuenta, efectivo };
}

function Lista({ rows }: { rows: AjustePosterior[] }) {
  return (
    <div className="divide-y divide-white/[0.07]">
      {rows.map((r) => (
        <div key={r.id} className="flex items-start justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">
              {r.tipo === "reversion" ? "Reversión" : "Seña"} · {r.cliente ?? "Cliente"}
            </div>
            <div className="truncate text-[11px] text-white/55">
              {r.servicio ?? "Turno"} · {r.metodo === "efectivo" ? "Efectivo" : "Dinero en banco"}
            </div>
            <div className="text-[11px] text-white/45">
              {r.tipo === "reversion"
                ? `Revertida el ${fechaHora(r.created_at)}${r.motivo ? ` · ${r.motivo}` : ""}`
                : `Aprobada el ${fechaHora(r.approved_at ?? r.created_at)}${r.approved_by_nombre ? ` por ${r.approved_by_nombre}` : ""}`}
            </div>
          </div>
          <div className={`shrink-0 text-sm font-semibold tabular-nums ${r.monto < 0 ? "text-rose-300" : "text-white"}`}>{money(r.monto)}</div>
        </div>
      ))}
    </div>
  );
}

const TARJETA =
  "rounded-2xl border border-amber-400/35 bg-[#0b0a14] p-4 [background-image:radial-gradient(110%_90%_at_100%_0%,rgba(251,191,36,0.14),transparent_62%),radial-gradient(90%_80%_at_0%_100%,rgba(139,92,246,0.10),transparent_65%)]";

/**
 * Detalle de un cierre: "Ajustes posteriores al cierre". Muestra el total original del cierre, los ajustes y el total
 * ajustado. El cierre guardado y el efectivo contado no cambian: esto se calcula aparte.
 */
export function CierreAjustesNota({
  businessId,
  branchId,
  fecha,
  cuentaEsperada,
  className,
}: {
  businessId: string | null | undefined;
  branchId: string | null | undefined;
  fecha: string | null | undefined;
  /** Dinero en banco esperado del cierre original. */
  cuentaEsperada: number;
  className?: string;
}) {
  const { rows } = useAjustesPosteriores(businessId, branchId, fecha ?? "0001-01-01");
  if (!fecha || rows.length === 0) return null;
  const { cuenta, efectivo } = totalesAjustes(rows);
  return (
    <section className={`${TARJETA} ${className ?? ""}`}>
      <div className="text-sm font-semibold text-white">Ajustes posteriores al cierre</div>
      <p className="mt-0.5 text-[11px] leading-snug text-white/55">
        Señas de este día que se aprobaron con la caja ya cerrada. El cierre original no cambia.
      </p>
      <div className="mt-2">
        <Lista rows={rows} />
      </div>
      <dl className="mt-2 space-y-1.5 border-t border-white/[0.07] pt-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-white/60">Dinero en banco del cierre original</dt>
          <dd className="font-semibold tabular-nums text-white">{money(cuentaEsperada)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-white/60">Ajustes posteriores en banco</dt>
          <dd className="font-semibold tabular-nums text-amber-200">{cuenta >= 0 ? "+" : ""}{money(cuenta)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] pt-2">
          <dt className="font-semibold text-white">Total ajustado en banco</dt>
          <dd className="text-base font-bold tabular-nums text-sky-300">{money(cuentaEsperada + cuenta)}</dd>
        </div>
        {efectivo !== 0 && (
          <div className="flex items-start justify-between gap-3 pt-1">
            <dt className="text-white/60">
              Efectivo a conciliar
              <span className="block text-[11px] text-white/45">Es plata física que no entró en el conteo. El efectivo contado no cambia.</span>
            </dt>
            <dd className="font-semibold tabular-nums text-amber-200">{money(efectivo)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** Día sin caja: solo los movimientos fuera de jornada de esa fecha. */
export function FueraDeJornadaDetalle({ rows }: { rows: AjustePosterior[] }) {
  const { cuenta, efectivo } = totalesAjustes(rows);
  return (
    <div className="space-y-3">
      <p className="text-xs leading-snug text-white/60">
        Ese día no hubo caja. Estas señas se registraron con la fecha real en que entró el dinero y no forman parte de ningún cierre.
      </p>
      <div className={TARJETA}>
        <Lista rows={rows} />
        <dl className="mt-1 space-y-1.5 border-t border-white/[0.07] pt-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-white/60">Dinero en banco</dt>
            <dd className="font-semibold tabular-nums text-sky-300">{money(cuenta)}</dd>
          </div>
          {efectivo !== 0 && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-white/60">Efectivo a conciliar</dt>
              <dd className="font-semibold tabular-nums text-amber-200">{money(efectivo)}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
