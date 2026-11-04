import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { cajaDateKeyBA } from "@/lib/caja-cierre";
import { cn } from "@/lib/utils";
import {
  loadMonthlyPerformance,
  monthLabel,
  shiftMonth,
  variationPct,
  type MonthlyPerformance,
} from "@/lib/monthly-performance";
import { methodLabel, printMonthlyPerformance } from "@/lib/monthly-performance-pdf";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("es-AR")}`;
const pctText = (n: number) => `${Math.abs(n).toFixed(1).replace(".", ",")}%`;

function useMonthlyPerformance(
  businessId: string | null,
  branchId: string | null,
  monthKey: string,
  uptoDay?: number,
) {
  return useQuery({
    queryKey: ["monthly-performance", businessId, branchId, monthKey, uptoDay ?? "mes-completo"],
    enabled: !!businessId,
    staleTime: 60_000,
    queryFn: (): Promise<MonthlyPerformance> => loadMonthlyPerformance(businessId!, branchId, monthKey, uptoDay),
  });
}

function DeltaValue({
  pct,
  label = "vs mes anterior",
  partialStart = false,
}: {
  pct: number | null;
  label?: string;
  partialStart?: boolean;
}) {
  if (pct == null)
    return (
      <span className="text-xs text-white/35">
        {partialStart ? "Mes anterior de arranque: no se compara" : "Sin mes anterior para comparar"}
      </span>
    );
  const good = pct >= 0;
  const Icon = pct >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", good ? "text-emerald-300" : "text-rose-300")}>
      <Icon className="size-3.5" />
      {pct >= 0 ? "+" : "-"}
      {pctText(pct)} {label}
    </span>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5 sm:p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">{label}</div>
      <div
        className={cn(
          "mt-1 font-display text-xl font-semibold tabular-nums sm:text-2xl",
          tone === "pos" ? "text-emerald-300" : tone === "neg" ? "text-rose-300" : "text-white",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-white/45">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 sm:p-5">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/50">{title}</h3>
      {children}
    </section>
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

export function RendimientoMensual({ monthKey: controlledMonthKey, onMonthKeyChange, minMonthKey }: RendimientoMensualProps = {}) {
  const { businessId, activeBranchId } = useAuth();
  const todayKey = cajaDateKeyBA();
  const currentMonth = todayKey.slice(0, 7);
  const todayDay = Number(todayKey.slice(8, 10));
  const [internalMonthKey, setInternalMonthKey] = React.useState(currentMonth);
  const monthKey = controlledMonthKey ?? internalMonthKey;
  const setMonthKey = (key: string) => {
    if (onMonthKeyChange) onMonthKeyChange(key);
    else setInternalMonthKey(key);
  };
  const isCurrentMonth = monthKey >= currentMonth;
  const isOldestMonth = minMonthKey ? monthKey <= minMonthKey : false;

  const current = useMonthlyPerformance(businessId, activeBranchId, monthKey);
  // Mes en curso: se compara contra el MISMO período del mes anterior (del 1 al día de hoy),
  // no contra el mes completo, que daría una caída falsa de -90%.
  const previous = useMonthlyPerformance(
    businessId,
    activeBranchId,
    shiftMonth(monthKey, -1),
    isCurrentMonth ? todayDay : undefined,
  );
  const vsLabel = isCurrentMonth ? `vs del 1 al ${todayDay} del mes anterior` : "vs mes anterior";
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
  const prev = previous.data;
  // El mes anterior solo sirve de base si tuvo actividad durante todo el mes; si fue de
  // pruebas o arrancó a medias, no se compara (sería una variación sin sentido).
  const comparable = prev?.hasData && prev.representative ? prev : null;
  const canCompare = comparable !== null;
  const prevIsStart = Boolean(prev?.hasData && prev.partialStart);

  function exportPdf() {
    if (!perf) return;
    const ok = printMonthlyPerformance(perf, comparable, businessName.data ?? "Mi negocio", vsLabel);
    if (!ok) toast.error("El navegador bloqueó la ventana. Permití ventanas emergentes para exportar el PDF.");
  }

  const totalMetodos = perf?.metodos.reduce((s, m) => s + m.monto, 0) ?? 0;
  const maxGasto = perf ? Math.max(1, ...perf.gastosPorTipo.map((g) => g.total)) : 1;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMonthKey(shiftMonth(monthKey, -1))}
            disabled={isOldestMonth}
            aria-label="Mes anterior"
            className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 transition hover:bg-white/[0.08] disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="min-w-[10.5rem] text-center text-base font-bold text-white sm:text-lg">{monthLabel(monthKey)}</div>
          <button
            type="button"
            onClick={() => setMonthKey(shiftMonth(monthKey, 1))}
            disabled={isCurrentMonth}
            aria-label="Mes siguiente"
            className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 transition hover:bg-white/[0.08] disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={exportPdf}
          disabled={!perf?.hasData}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-white/85 transition hover:bg-white/[0.09] disabled:opacity-40"
        >
          <Download className="size-4" />
          Exportar PDF
        </button>
      </div>

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
          <div className="relative overflow-hidden rounded-[1.75rem] border border-emerald-300/25 bg-white/[0.025] p-5 shadow-[0_0_0_1px_rgba(16,185,129,0.12),0_30px_100px_-50px_rgba(45,212,191,0.9)] sm:p-6">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-200/80">Ganancia del mes</div>
            <div
              className={cn(
                "mt-1 font-display text-4xl font-semibold tabular-nums sm:text-5xl",
                perf.ganancia >= 0 ? "text-emerald-300" : "text-rose-300",
              )}
            >
              {money(perf.ganancia)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              <DeltaValue pct={canCompare ? variationPct(perf.ganancia, comparable!.ganancia) : null} label={vsLabel} partialStart={prevIsStart} />
              {perf.margen != null && <span className="text-xs text-white/50">Margen {pctText(perf.margen)}</span>}
            </div>
            <div className="mt-3 grid gap-1 text-sm text-white/65">
              <div>
                Facturación <b className="text-white">{money(perf.facturacion)}</b> − Gastos{" "}
                <b className="text-white">{money(perf.gastosTotal)}</b> − Profesionales{" "}
                <b className="text-white">{money(perf.pagoProfesionales)}</b>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Kpi
              label="Facturación"
              value={money(perf.facturacion)}
              sub={<DeltaValue pct={canCompare ? variationPct(perf.facturacion, comparable!.facturacion) : null} label={vsLabel} partialStart={prevIsStart} />}
            />
            <Kpi label="Gastos" value={money(perf.gastosTotal)} />
            <Kpi label="Pago a profesionales" value={money(perf.pagoProfesionales)} />
            <Kpi
              label="Ventas"
              value={perf.ventas.toLocaleString("es-AR")}
              sub={<DeltaValue pct={canCompare ? variationPct(perf.ventas, comparable!.ventas) : null} label={vsLabel} partialStart={prevIsStart} />}
            />
            <Kpi label="Ticket promedio" value={money(perf.ticket)} />
            <Kpi label="Clientes atendidos" value={perf.clientes.toLocaleString("es-AR")} />
          </div>

          {perf.pendienteDeCobro > 0 && (
            <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-2.5 text-xs text-amber-100/85">
              La facturación incluye <b>{money(perf.pendienteDeCobro)}</b> de ventas de este mes todavía sin cobrar. Cuando se
              cobren, siguen contando en este mes.
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Medios de pago">
              <div className="space-y-2.5">
                {perf.metodos.map((m) => {
                  const pct = totalMetodos > 0 ? (m.monto / totalMetodos) * 100 : 0;
                  return (
                    <div key={m.key}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-white/80">{methodLabel(m.key)}</span>
                        <span className="tabular-nums text-white">
                          {money(m.monto)} <span className="text-xs text-white/40">({Math.round(pct)}%)</span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full rounded-full bg-cyan-300/70" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section title="Gastos por tipo">
              {perf.gastosPorTipo.length === 0 ? (
                <p className="text-sm text-white/45">Sin gastos en el mes.</p>
              ) : (
                <div className="space-y-2.5">
                  {perf.gastosPorTipo.map((g) => (
                    <div key={g.tipo}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-white/80">{g.tipo}</span>
                        <span className="tabular-nums text-white">{money(g.total)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full rounded-full bg-rose-300/65" style={{ width: `${(g.total / maxGasto) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                  <div className="pt-1 text-[11px] text-white/40">
                    Incluye {money(perf.gastosExternos)} de Fondos externos y {money(perf.gastosCaja)} de caja.
                  </div>
                </div>
              )}
            </Section>
          </div>

          <Section title="Por profesional">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-white/40">
                    <th className="pb-2 pr-3 font-semibold">Profesional</th>
                    <th className="pb-2 pr-3 text-right font-semibold">Facturación</th>
                    <th className="pb-2 pr-3 text-right font-semibold">Ventas</th>
                    <th className="pb-2 pr-3 text-right font-semibold">Comisión</th>
                    <th className="pb-2 text-right font-semibold">Puntualidad</th>
                  </tr>
                </thead>
                <tbody>
                  {perf.profesionales.map((p) => (
                    <tr key={p.id} className="border-t border-white/[0.06]">
                      <td className="py-2 pr-3 font-semibold text-white">{p.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-white">{money(p.facturacion)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-white/70">{p.ventas}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-violet-300">{money(p.comision)}</td>
                      <td className="py-2 text-right text-xs tabular-nums">
                        {p.tardes + p.ausencias === 0 ? (
                          <span className="text-emerald-300">Sin faltas</span>
                        ) : (
                          <span className="text-rose-300">
                            {p.tardes > 0 ? `${p.tardes} tarde${p.tardes > 1 ? "s" : ""}` : ""}
                            {p.tardes > 0 && p.ausencias > 0 ? " · " : ""}
                            {p.ausencias > 0 ? `${p.ausencias} ausencia${p.ausencias > 1 ? "s" : ""}` : ""}
                            {p.descuentoPuntualidad > 0 ? ` · ${money(-p.descuentoPuntualidad)}` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <p className="px-1 text-[11px] leading-relaxed text-white/35">
            La facturación cuenta lo vendido en el mes en que se hizo el servicio, aunque se cobre después: las ventas anuladas
            quedan afuera. Los gastos incluyen Caja del día y Fondos externos. El pago a profesionales son las comisiones de las ventas
            cobradas del mes, neto de los descuentos de puntualidad. La facturación incluye los consumos de profesionales
            (productos retirados del inventario y anotados como adelanto), que cuentan en el mes del retiro aunque se descuenten
            después al liquidar. Las propinas no entran en la facturación.
          </p>
        </>
      )}
    </div>
  );
}
