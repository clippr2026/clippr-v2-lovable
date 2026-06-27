import * as React from "react";
import { UserX, TrendingDown, Clock, CalendarDays, Scissors, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRejectedAnalytics } from "@/hooks/use-rejected-analytics";
import { TIER_EMOJI } from "@/lib/rejected-analytics";

function fmtARS(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

function MiniRow({
  icon,
  title,
  items,
  empty,
}: {
  icon: React.ReactNode;
  title: string;
  items: { label: string; value: string | number }[];
  empty: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/45">
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-white/35">{empty}</div>
      ) : (
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-white/75">{it.label}</span>
              <span className="shrink-0 font-bold tabular-nums text-white/90">{it.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RejectedDemandSection({ businessId }: { businessId: string | null }) {
  const { analytics: a, isLoading, error } = useRejectedAnalytics(businessId);

  // Sin tabla creada todavía → no romper el dashboard.
  if (error) return null;

  const maxMonthly = Math.max(1, ...a.monthly.map((m) => m.count));

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-rose-500/12 text-rose-200 ring-1 ring-rose-400/25">
          <UserX className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-bold text-white">Demanda no atendida</h2>
          <p className="text-[11px] text-white/45">Clientes que no pudieron atenderse por falta de disponibilidad</p>
        </div>
      </div>

      {a.total === 0 && !isLoading ? (
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6 text-center text-sm text-white/50">
          Todavía no registraste clientes rechazados. Usá el botón <span className="font-semibold text-rose-200/80">Cliente rechazado</span> en la
          Agenda para empezar a medir la demanda que el negocio no pudo atender.
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-rose-300/15 bg-rose-500/[0.05] p-4">
              <div className="text-3xl font-extrabold tabular-nums text-rose-300">{a.counts.today}</div>
              <div className="mt-0.5 text-[11px] text-white/45">Rechazados hoy</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-3xl font-extrabold tabular-nums text-white">{a.counts.week}</div>
              <div className="mt-0.5 text-[11px] text-white/45">Esta semana</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-3xl font-extrabold tabular-nums text-white">{a.counts.month}</div>
              <div className="mt-0.5 text-[11px] text-white/45">Este mes</div>
            </div>
            <div className="rounded-2xl border border-amber-300/15 bg-amber-500/[0.05] p-4">
              <div className="flex items-center gap-1.5 text-2xl font-extrabold tabular-nums text-amber-300">
                <TrendingDown className="h-4 w-4" />
                {fmtARS(a.lostRevenue.month)}
              </div>
              <div className="mt-0.5 text-[11px] text-white/45">Facturación potencial perdida (mes)</div>
            </div>
          </div>

          {/* Detalle */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MiniRow
              icon={<Clock className="h-3.5 w-3.5" />}
              title="Horarios con más demanda"
              items={a.peakHours.slice(0, 4).map((h) => ({
                label: `${String(h.hour).padStart(2, "0")}:00 – ${String(h.hour + 1).padStart(2, "0")}:00`,
                value: h.count,
              }))}
              empty="Sin datos suficientes."
            />
            <MiniRow
              icon={<CalendarDays className="h-3.5 w-3.5" />}
              title="Días con mayor demanda"
              items={a.peakDays.map((d) => ({ label: d.label, value: d.count }))}
              empty="Sin datos suficientes."
            />
            <MiniRow
              icon={<Scissors className="h-3.5 w-3.5" />}
              title="Servicios más solicitados"
              items={a.topServices.map((s) => ({ label: s.label, value: s.count }))}
              empty="Sin datos suficientes."
            />
            <MiniRow
              icon={<Users className="h-3.5 w-3.5" />}
              title="Profesionales más solicitados"
              items={a.topProfessionals.map((p) => ({ label: p.label, value: p.count }))}
              empty="Sin solicitudes por profesional."
            />
            <MiniRow
              icon={<UserX className="h-3.5 w-3.5" />}
              title="Motivos más frecuentes"
              items={a.topReasons.map((r) => ({ label: r.label, value: r.count }))}
              empty="Sin datos suficientes."
            />
            {/* Evolución mensual */}
            <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <div className="mb-2.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/45">
                <TrendingDown className="h-3.5 w-3.5" />
                Evolución mensual
              </div>
              <div className="flex items-end justify-between gap-1.5 h-[64px]">
                {a.monthly.map((m) => (
                  <div key={m.ym} className="flex flex-1 flex-col items-center justify-end gap-1">
                    <div
                      className="w-full rounded-t bg-rose-400/60"
                      style={{ height: `${Math.max(3, (m.count / maxMonthly) * 52)}px` }}
                      title={`${m.count} rechazos`}
                    />
                    <span className="text-[10px] capitalize text-white/40">{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Índice de demanda por profesional */}
          {a.professionals.length > 0 && (
            <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-white/45">
                Índice de demanda por profesional
              </div>
              <div className="space-y-2">
                {a.professionals.map((p) => (
                  <div key={p.name} className="flex items-center gap-3">
                    <span className="text-base">{TIER_EMOJI[p.tier]}</span>
                    <span className="w-28 shrink-0 truncate text-sm font-semibold text-white/85">{p.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          p.tier === "fire" && "bg-rose-400",
                          p.tier === "high" && "bg-emerald-400",
                          p.tier === "mid" && "bg-amber-400",
                          p.tier === "low" && "bg-sky-400",
                        )}
                        style={{ width: `${p.score}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-xs font-bold tabular-nums text-white/70">{p.score}/100</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
