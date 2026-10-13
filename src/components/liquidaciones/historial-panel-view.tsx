// Historial de liquidaciones cerradas (status 'pagada') de un profesional —
// componente compartido entre Panel del profesional > Historial
// (professionals.tsx) y Caja > Liquidaciones > Historial (cash-register.tsx),
// para que admin y profesional vean exactamente la misma reconstrucción de
// cada liquidación ya pagada, sin duplicar la lógica en los dos lugares.
//
// Cada liquidación cerrada vive SOLO acá — nunca mezclada con Movimientos
// (esa pestaña es cuenta corriente puramente abierta: lo pendiente o
// posterior al último corte, ver Movimientos en ambas pantallas). Al abrir
// una, se reconstruye solo con lo que de verdad quedó persistido en el
// momento del cierre: Resumen + pagos/adelantos (ya 100% reconstruibles
// desde siempre, ver historial-movimientos.ts) y, para las ventas, la
// fuente más rica disponible — settlement_run_sales (snapshot completo, ver
// 20261010010000_settlement_run_sales_snapshot.sql) si esta liquidación se
// preparó después de esa migración; si no hay filas ahí (tabla todavía sin
// migrar, o liquidación de antes), cae al fallback de siempre
// (fetchSettlementRunServices, basado en commission_records — 4 campos, sin
// descuento/promo/propina). Nunca inventa lo que falta.
import * as React from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  useProfSettlementRuns,
  useProfSettlementRunPayments,
  useProfAdvances,
  fetchSettlementRunServices,
  fetchSettlementRunSales,
  type SettlementRun,
} from "@/hooks/use-professionals-data";
import { PagoDetalleContent } from "@/components/liquidaciones/movimiento-detalle-content";
import { VentaRow } from "@/components/liquidaciones/unified-row";
import { fmtDateOnly, isRunEffectivelySettled } from "@/components/liquidaciones/movimiento-format";
import { AgendaCenteredModal } from "@/components/agenda/agenda-drawer";
import type { EmployeeCommissionMap } from "@/lib/service-pricing";

// Excepción visual puntual, pedida explícitamente por el negocio: la
// liquidación #101 de Melany debe MOSTRAR "03/10/2026 · 22:52 h" en Datos
// del pago, aunque el paid_at real en la base sea otro (quedó registrado
// más tarde por un motivo administrativo, nunca se tocó ni se va a tocar).
// Liquidación #103 de Pipo: mismo criterio, el pago real quedó registrado
// recién hoy (se cargó tarde en el sistema) aunque corresponde al corte
// del 03/10 — se muestra con la hora real de carga, solo la fecha se
// ajusta al corte. Casos únicos e identificados por su id real, nunca una
// regla general — por eso viven acá afuera, nunca dentro de
// PagoDetalleContent.
const RUN_PAID_AT_DISPLAY_OVERRIDES: Record<string, string> = {
  "9ccd4024-d39a-4e7e-aa2b-d61a0df4e84f": "03/10/2026 · 22:52 h",
  "3a197404-3bd7-4f51-9681-049001ee838e": "03/10/2026 · 20:36 h",
};

export function HistorialPanelView({
  businessId, empId,
}: {
  businessId: string | null;
  empId: string | null;
}) {
  const { data: runs = [], isLoading: loadingRuns } = useProfSettlementRuns(businessId, empId);
  const { data: payments = [], isLoading: loadingPayments } = useProfSettlementRunPayments(businessId, empId);
  const { data: advances = [], isLoading: loadingAdvances } = useProfAdvances(businessId, empId);

  // _employeeCommissions (Equipo > Comisiones) — para que VentaRow filtre
  // del concepto los productos de catálogo sin comisión activa, mismo
  // criterio que ya decide cuánta plata de comisión generan
  // (resolveDisplayConcept, service-pricing.ts).
  const [employeeCommissionsMap, setEmployeeCommissionsMap] = React.useState<EmployeeCommissionMap>({});
  React.useEffect(() => {
    if (!businessId) return;
    supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule as Record<string, unknown> | null) ?? {};
        setEmployeeCommissionsMap((schedule._employeeCommissions as EmployeeCommissionMap) ?? {});
      });
  }, [businessId]);

  // "pagada" o prácticamente saldada (resto < $1, ver isRunEffectivelySettled)
  // — una liquidación con 17 centavos sin cobrar por redondeo no debe
  // quedar atascada en Movimientos ni mostrarse como pendiente.
  const closedRuns = React.useMemo(() => runs.filter((r) => isRunEffectivelySettled(r)), [runs]);

  const [openRun, setOpenRun] = React.useState<SettlementRun | null>(null);
  const [sales, setSales] = React.useState<any[] | null>(null);
  const [loadingSales, setLoadingSales] = React.useState(false);

  async function handleOpen(run: SettlementRun) {
    setOpenRun(run);
    setSales(null);
    setLoadingSales(true);
    try {
      let rows: any[] = [];
      try {
        rows = await fetchSettlementRunSales(run.id);
      } catch {
        // settlement_run_sales puede no existir todavía (migración sin
        // correr) — no es un error fatal, cae al fallback de abajo.
        rows = [];
      }
      if (rows.length === 0) {
        rows = await fetchSettlementRunServices(run.id);
      }
      setSales(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudieron cargar las ventas");
      setSales([]);
    } finally {
      setLoadingSales(false);
    }
  }

  const runPayments = React.useMemo(
    () => (openRun ? payments.filter((p) => p.settlement_run_id === openRun.id) : []),
    [payments, openRun],
  );
  const runAdvances = React.useMemo(
    () => (openRun ? advances.filter((a) => a.settlement_run_id === openRun.id) : []),
    [advances, openRun],
  );

  if (loadingRuns || loadingPayments || loadingAdvances) {
    return <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">Cargando…</div>;
  }

  if (closedRuns.length === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground animate-fade-up">
        Todavía no hay liquidaciones cerradas para este profesional.
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-up">
      {closedRuns.map((run) => (
        <button
          key={run.id}
          type="button"
          onClick={() => handleOpen(run)}
          className="glass w-full rounded-2xl p-4 sm:p-5 text-left space-y-2 transition hover:bg-white/[0.04]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-foreground">Liquidación #{run.run_number}</div>
            <span className="text-xs font-medium px-2.5 py-1 rounded-full ring-1 bg-emerald-500/10 ring-emerald-400/20 text-emerald-300">
              Pagada
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {run.period_start
              ? `Período: del ${fmtDateOnly(run.period_start)} al ${fmtDateOnly(run.cutoff_date)}`
              : `Liquidado hasta ${fmtDateOnly(run.cutoff_date)}`}
          </div>
        </button>
      ))}

      <AgendaCenteredModal
        open={openRun !== null}
        onOpenChange={(v) => {
          if (!v) setOpenRun(null);
        }}
        lockOutside={false}
        title={openRun ? `Liquidación #${openRun.run_number}` : ""}
      >
        {openRun && (
          <div className="space-y-4">
            <PagoDetalleContent
              run={openRun}
              payments={runPayments}
              advances={runAdvances}
              services={null}
              loadingServices={false}
              hideServices
              paidAtDisplayOverride={RUN_PAID_AT_DISPLAY_OVERRIDES[openRun.id] ?? null}
            />
            <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/38">
                Ventas incluidas
              </div>
              {loadingSales ? (
                <div className="py-6 text-center text-sm text-white/45">Cargando…</div>
              ) : !sales || sales.length === 0 ? (
                <div className="py-6 text-center text-sm text-white/45">
                  Sin ventas reconstruibles para esta liquidación.
                </div>
              ) : (
                <div className="space-y-2">
                  {sales.map((s) => (
                    <VentaRow key={s.id} c={s} commissionsMap={employeeCommissionsMap} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </AgendaCenteredModal>
    </div>
  );
}
