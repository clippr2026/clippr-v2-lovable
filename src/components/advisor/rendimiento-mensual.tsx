import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Info, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { cajaDateKeyBA } from "@/lib/caja-cierre";
import { cn } from "@/lib/utils";
import {
  comparableUptoDay,
  loadMonthlyPerformance,
  monthLabel,
  shiftMonth,
  variationPct,
  type MonthlyPerformance,
} from "@/lib/monthly-performance";
import { printMonthlyPerformance } from "@/lib/monthly-performance-pdf";
import { DetalleSheet, type DetalleKind } from "@/components/advisor/rendimiento-detalle";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("es-AR")}`;
const pctText = (n: number) => `${Math.abs(n).toFixed(1).replace(".", ",")}%`;

function useMonthlyPerformance(
  businessId: string | null,
  branchId: string | null,
  monthKey: string,
  uptoDay?: number,
  enabled = true,
) {
  return useQuery({
    queryKey: ["monthly-performance", businessId, branchId, monthKey, uptoDay ?? "mes-completo"],
    enabled: !!businessId && enabled,
    staleTime: 60_000,
    queryFn: (): Promise<MonthlyPerformance> => loadMonthlyPerformance(businessId!, branchId, monthKey, uptoDay),
  });
}

function DeltaValue({
  pct,
  label = "vs mes anterior",
  partialStart = false,
  masEsMalo = false,
}: {
  pct: number | null;
  label?: string;
  partialStart?: boolean;
  /** En los gastos, subir es malo: la flecha hacia arriba va en rojo. */
  masEsMalo?: boolean;
}) {
  if (pct == null)
    return (
      <span className="text-sm text-white/45">
        {partialStart ? "Mes anterior de arranque: no se compara" : "Sin mes anterior"}
      </span>
    );
  const good = masEsMalo ? pct <= 0 : pct >= 0;
  const Icon = pct >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm font-semibold", good ? "text-emerald-300" : "text-rose-300")}>
      <Icon className="size-4" />
      {pct >= 0 ? "+" : "-"}
      {pctText(pct)}
      {label ? ` ${label}` : ""}
    </span>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  onDetail,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: "pos" | "neg";
  onDetail?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 [background-image:radial-gradient(110%_90%_at_100%_0%,rgba(79,125,255,0.14),transparent_62%),radial-gradient(90%_80%_at_0%_100%,rgba(139,92,246,0.1),transparent_65%)]">
      <div className="text-sm text-white/60">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-display text-2xl font-semibold tabular-nums",
          tone === "pos" ? "text-emerald-300" : tone === "neg" ? "text-rose-300" : "text-white",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-sm text-white/55">{sub}</div>}
      {onDetail && (
        <button
          type="button"
          onClick={onDetail}
          className="mt-2 inline-flex touch-manipulation items-center gap-1 text-sm font-semibold text-sky-300"
        >
          Ver detalles
          <ChevronRight className="size-4" />
        </button>
      )}
    </div>
  );
}

// Explicación corta del margen: se muestra en línea debajo de la fila (un globito se cortaba contra el borde de la tarjeta).
function MargenInfoButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Qué es el margen"
      aria-expanded={open}
      className="grid size-5 place-items-center rounded-full border border-white/15 text-white/55 transition hover:text-white"
    >
      <Info className="size-3" />
    </button>
  );
}

function MargenInfoTexto() {
  return (
    <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm leading-relaxed text-white/75">
      <b className="text-white">Margen:</b> de cada $100 que facturás, cuánto te queda de ganancia después de pagar los gastos y a los
      profesionales. Con 30%, de cada $100 te quedan $30.
      <div className="mt-2 text-white/50">
        Menos de 15% es ajustado, entre 15% y 30% es sano y más de 30% es muy bueno. Si todavía no cargaste los gastos del mes, el
        margen se ve más alto de lo real.
      </div>
    </div>
  );
}

// Selector de mes: va arriba del título "Evolución del negocio" y manda sobre toda la pantalla.
export function MesSelector({
  monthKey,
  onMonthKeyChange,
  minMonthKey,
}: {
  monthKey: string;
  onMonthKeyChange: (monthKey: string) => void;
  minMonthKey?: string;
}) {
  const currentMonth = cajaDateKeyBA().slice(0, 7);
  const isCurrentMonth = monthKey >= currentMonth;
  const isOldestMonth = minMonthKey ? monthKey <= minMonthKey : false;
  return (
    <div className="mb-3 flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => onMonthKeyChange(shiftMonth(monthKey, -1))}
        disabled={isOldestMonth}
        aria-label="Mes anterior"
        className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 transition hover:bg-white/[0.08] disabled:opacity-30"
      >
        <ChevronLeft className="size-4" />
      </button>
      <div className="min-w-[10.5rem] text-center text-base font-bold text-white sm:text-lg">{monthLabel(monthKey)}</div>
      <button
        type="button"
        onClick={() => onMonthKeyChange(shiftMonth(monthKey, 1))}
        disabled={isCurrentMonth}
        aria-label="Mes siguiente"
        className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 transition hover:bg-white/[0.08] disabled:opacity-30"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

type RendimientoMensualProps = {
  // Mes elegido ("2026-10"). Si se pasa, el selector es controlado desde afuera para que
  // el resto de la pantalla (ocupación, salud, radiografía) siga el mismo mes.
  monthKey?: string;
  onMonthKeyChange?: (monthKey: string) => void;
  // Primer mes que se puede elegir (no se puede ir más atrás).
  minMonthKey?: string;
};

export function RendimientoMensual({ monthKey: controlledMonthKey }: RendimientoMensualProps = {}) {
  const { businessId, activeBranchId } = useAuth();
  const todayKey = cajaDateKeyBA();
  const currentMonth = todayKey.slice(0, 7);
  const todayDay = Number(todayKey.slice(8, 10));
  const monthKey = controlledMonthKey ?? currentMonth;
  const isCurrentMonth = monthKey >= currentMonth;
  const [detalle, setDetalle] = React.useState<DetalleKind | null>(null);
  const [margenInfo, setMargenInfo] = React.useState(false);
  // Al cerrar un detalle se vuelve al mismo lugar de la pantalla donde se estaba.
  const raiz = React.useRef<HTMLDivElement | null>(null);
  const scrollGuardado = React.useRef<{ el: HTMLElement; top: number } | null>(null);
  function abrirDetalle(k: DetalleKind) {
    let el: HTMLElement | null = raiz.current;
    while (el && el !== document.body) {
      const ov = getComputedStyle(el).overflowY;
      if ((ov === "auto" || ov === "scroll") && el.scrollHeight > el.clientHeight) break;
      el = el.parentElement;
    }
    const cont = (el && el !== document.body ? el : (document.scrollingElement as HTMLElement | null)) ?? null;
    scrollGuardado.current = cont ? { el: cont, top: cont.scrollTop } : null;
    setDetalle(k);
  }
  function cerrarDetalle() {
    setDetalle(null);
    const g = scrollGuardado.current;
    if (g) {
      for (const ms of [0, 60, 250]) window.setTimeout(() => g.el.scrollTo({ top: g.top }), ms);
    }
  }

  const current = useMonthlyPerformance(businessId, activeBranchId, monthKey);
  // Mes en curso: se compara con DÍAS COMPLETOS (hasta ayer) en los dos meses; comparar el día de hoy a medias contra el
  // mismo día entero del mes anterior exageraba las caídas. Mes cerrado: contra el mes anterior completo.
  const compDay = isCurrentMonth ? comparableUptoDay(todayDay) : null;
  const currentComparable = useMonthlyPerformance(businessId, activeBranchId, monthKey, compDay ?? undefined, isCurrentMonth && compDay != null);
  const previous = useMonthlyPerformance(
    businessId,
    activeBranchId,
    shiftMonth(monthKey, -1),
    isCurrentMonth ? (compDay ?? undefined) : undefined,
    !isCurrentMonth || compDay != null,
  );
  const vsLabel = isCurrentMonth ? `vs del 1 al ${compDay ?? 0} del mes anterior (días completos)` : "vs mes anterior";
  const businessName = useQuery({
    queryKey: ["business-name", businessId],
    enabled: !!businessId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("businesses").select("name").eq("id", businessId!).maybeSingle();
      return ((data as any)?.name as string | undefined) ?? "Mi negocio";
    },
  });

  const perf = current.data;
  // Lo que se compara contra el mes anterior: el mes en curso hasta ayer, o el mes cerrado completo.
  const perfCmp = isCurrentMonth ? currentComparable.data : current.data;

  const prev = previous.data;
  // El mes anterior solo sirve de base si tuvo actividad durante todo el mes; si fue de
  // pruebas o arrancó a medias, no se compara (sería una variación sin sentido).
  const comparable = prev?.hasData && prev.representative ? prev : null;
  const canCompare = comparable !== null && !!perfCmp;
  const prevIsStart = Boolean(prev?.hasData && prev.partialStart);

  function exportPdf() {
    if (!perf) return;
    const ok = printMonthlyPerformance(perf, comparable, businessName.data ?? "Mi negocio", vsLabel);
    if (!ok) toast.error("El navegador bloqueó la ventana. Permití ventanas emergentes para exportar el PDF.");
  }


  return (
    <div ref={raiz} className="mx-auto w-full max-w-5xl space-y-4 sm:space-y-5">

      {current.isLoading || !perf ? (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-16 text-center text-sm text-white/45">
          Calculando el mes…
        </div>
      ) : current.isError ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-6 text-sm text-rose-200">
          No se pudo calcular el mes. Probá de nuevo en un momento.
        </div>
      ) : !perf.hasData ? (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-16 text-center text-sm text-white/45">
          No hay ventas ni gastos registrados en {monthLabel(monthKey)}.
        </div>
      ) : (
        <>
          {/* Ganancia — el número principal del mes */}
          <div className="relative overflow-hidden rounded-2xl border border-emerald-300/25 bg-white/[0.03] p-4 shadow-[0_0_40px_-20px_rgba(45,212,191,0.8)] [background-image:radial-gradient(110%_90%_at_100%_0%,rgba(16,185,129,0.14),transparent_62%),radial-gradient(90%_80%_at_0%_100%,rgba(139,92,246,0.1),transparent_65%)]">
            <div className="text-sm text-white/60">Ganancia del mes</div>
            <div className={cn("font-display text-4xl font-semibold tabular-nums", perf.ganancia >= 0 ? "text-emerald-300" : "text-rose-300")}>
              {money(perf.ganancia)}
            </div>
            <div className="mt-1">
              <DeltaValue pct={canCompare ? variationPct(perfCmp!.ganancia, comparable!.ganancia) : null} label="" partialStart={prevIsStart} />
            </div>
            {perf.margen != null && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3.5 py-2.5 ring-1 ring-white/10">
                <span className="flex items-center gap-2 text-sm text-white/70">
                  Margen
                  <MargenInfoButton open={margenInfo} onToggle={() => setMargenInfo((v) => !v)} />
                </span>
                <span className="flex items-center gap-3">
                  {canCompare && comparable!.margen != null && perfCmp!.margen != null && (
                    <span className={cn("text-sm font-semibold", (perfCmp!.margen ?? 0) - comparable!.margen >= 0 ? "text-emerald-300" : "text-rose-300")}>
                      {(perfCmp!.margen ?? 0) - comparable!.margen >= 0 ? "+" : "-"}
                      {Math.abs((perfCmp!.margen ?? 0) - comparable!.margen).toFixed(1).replace(".", ",")} pts
                    </span>
                  )}
                  <b className="text-xl tabular-nums text-white">{perf.margen < 0 ? "−" : ""}{pctText(perf.margen)}</b>
                </span>
              </div>
            )}
            {margenInfo && <MargenInfoTexto />}
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <Kpi
              label="Facturación"
              value={money(perf.facturacion)}
              sub={<DeltaValue pct={canCompare ? variationPct(perfCmp!.facturacion, comparable!.facturacion) : null} label="" partialStart={prevIsStart} />}
              onDetail={() => abrirDetalle("facturacion")}
            />
            <Kpi
              label="Gastos"
              value={money(perf.gastosTotal)}
              sub={
                <>
                  <DeltaValue pct={canCompare ? variationPct(perfCmp!.gastosTotal, comparable!.gastosTotal) : null} label="" partialStart={prevIsStart} masEsMalo />
                  {perf.devolucionesSena > 0 && <div className="mt-0.5">Sin {money(perf.devolucionesSena)} de señas devueltas</div>}
                </>
              }
              onDetail={() => abrirDetalle("gastos")}
            />
            <Kpi label="A profesionales" value={money(perf.pagoProfesionales)} onDetail={() => abrirDetalle("profesionales")} />
            <Kpi
              label="Ventas"
              value={perf.ventas.toLocaleString("es-AR")}
              sub={<DeltaValue pct={canCompare ? variationPct(perfCmp!.ventas, comparable!.ventas) : null} label="" partialStart={prevIsStart} />}
              onDetail={() => abrirDetalle("ventas")}
            />
            <Kpi label="Ticket promedio" value={money(perf.ticket)} onDetail={() => abrirDetalle("ticket")} />
            <Kpi label="Clientes atendidos" value={perf.clientes.toLocaleString("es-AR")} onDetail={() => abrirDetalle("clientes")} />
          </div>
          <DetalleSheet
            kind={detalle}
            onClose={cerrarDetalle}
            monthKey={monthKey}
            perf={perf}
            prev={comparable}
            vsLabel={vsLabel}
          />

          {canCompare && (
            <p className="px-1 text-sm text-white/50">{isCurrentMonth
                ? `Los porcentajes comparan el período del 1 al ${compDay ?? 0} de este mes con el mismo período del mes anterior.`
                : "Los porcentajes comparan con el mes anterior."}</p>
          )}
          {perf.pendienteDeCobro > 0 && (
            <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3 text-sm leading-relaxed text-amber-100/90">
              Incluye <b>{money(perf.pendienteDeCobro)}</b> en ventas pendientes de cobro. Una vez cobradas, se registrarán como ingresos de este mes.
            </div>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={exportPdf}
          disabled={!perf?.hasData}
          className="inline-flex h-11 touch-manipulation items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-5 text-sm font-semibold text-white/85 disabled:opacity-40"
        >
          <Download className="size-4" />
          Exportar PDF
        </button>
      </div>
    </div>
  );
}
