import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useClientsData } from "@/hooks/use-clients-data";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { monthLabel, variationPct, type MonthlyPerformance } from "@/lib/monthly-performance";
import {
  computeMonthlyDetail,
  fetchMonthlyDetailRaw,
  type DayRow,
  type MonthlyDetail,
  type ShareRow,
} from "@/lib/monthly-detail";
import { methodLabel } from "@/lib/monthly-performance-pdf";

export type DetalleKind = "facturacion" | "gastos" | "profesionales" | "ventas" | "ticket" | "clientes";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("es-AR")}`;
const pct1 = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;
const int = (n: number) => Math.round(n).toLocaleString("es-AR");
const dateLabel = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

const TITLES: Record<DetalleKind, string> = {
  facturacion: "Facturación",
  gastos: "Gastos",
  profesionales: "Pago a profesionales",
  ventas: "Ventas",
  ticket: "Ticket promedio",
  clientes: "Clientes atendidos",
};

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.16] bg-white/[0.04] p-4 shadow-[0_8px_24px_-16px_rgba(0,0,0,0.8)] sm:p-5">
      <h3 className="border-b border-white/[0.1] pb-2.5 text-[11px] font-bold uppercase tracking-[0.15em] text-white/60">{title}</h3>
      {hint && <p className="mt-1 text-[11px] leading-snug text-white/35">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-display text-lg font-semibold tabular-nums",
          tone === "pos" ? "text-emerald-300" : tone === "neg" ? "text-rose-300" : "text-white",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-white/45">{sub}</div>}
    </div>
  );
}

function StatGrid({ children, twoCols = false }: { children: React.ReactNode; twoCols?: boolean }) {
  return <div className={cn("grid grid-cols-2 gap-2.5", !twoCols && "sm:grid-cols-3")}>{children}</div>;
}

// Filas con barra: `value` define el largo; `text` es lo que se muestra a la derecha.
function Bars({
  rows,
  format = money,
  sub,
  empty = "Sin datos en el mes.",
  maxRows,
  color = "bg-sky-400/70",
}: {
  rows: Array<{ label: string; value: number; count?: number; extra?: number }>;
  format?: (n: number) => string;
  sub?: (r: { label: string; value: number; count?: number; extra?: number }, total: number) => string;
  empty?: string;
  maxRows?: number;
  color?: string;
}) {
  const list = maxRows ? rows.slice(0, maxRows) : rows;
  if (list.length === 0) return <div className="text-sm text-white/40">{empty}</div>;
  const total = rows.reduce((s, r) => s + r.value, 0);
  const max = Math.max(1, ...list.map((r) => r.value));
  return (
    <div className="space-y-2.5">
      {list.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-white/80">{r.label}</span>
            <span className="shrink-0 tabular-nums text-white">
              {format(r.value)}
              {sub && <span className="ml-1.5 text-xs text-white/40">{sub(r, total)}</span>}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const sharePct = (r: { value: number }, total: number) => `(${total > 0 ? Math.round((r.value / total) * 100) : 0}%)`;

function KV({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <div className="divide-y divide-white/[0.06] text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 py-1.5">
          <span className="text-white/60">{k}</span>
          <span className="text-right tabular-nums text-white">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-sky-300/20 bg-sky-300/[0.06] px-3 py-2 text-xs leading-relaxed text-sky-50/85">
      {children}
    </div>
  );
}

const diaPlural = (label: string) => {
  const l = label.toLowerCase();
  return ["lunes", "martes", "miércoles", "jueves", "viernes"].includes(l) ? l : `${l}s`;
};

// Barra simple (0 a 1) para comparar valores dentro de una tarjeta.
function Track({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.07]">
      <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.max(3, Math.min(100, pct * 100))}%` }} />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.05] px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}

// `lowerIsBetter`: en gastos, que baje es bueno (verde).
function Delta({ cur, prev, label, lowerIsBetter = false }: { cur: number; prev: number | null; label: string; lowerIsBetter?: boolean }) {
  const v = prev != null ? variationPct(cur, prev) : null;
  if (v == null) return null;
  const good = lowerIsBetter ? v <= 0 : v >= 0;
  return (
    <span className={good ? "text-emerald-300" : "text-rose-300"}>
      {v >= 0 ? "+" : "-"}
      {pct1(Math.abs(v))} {label}
    </span>
  );
}

const weekdayRows = (rows: DayRow[], pick: (r: DayRow) => number): ShareRow[] =>
  rows.map((r) => ({ label: r.label, value: pick(r), count: r.dias }));

function bestWorst(d: DayRow[], rows: { best: DayRow | null; worst: DayRow | null }, what: string) {
  if (!rows.best) return null;
  return (
    <Callout>
      Se {what} más los <b>{rows.best.label.toLowerCase()}</b> ({money(rows.best.promedio)} por día)
      {rows.worst && rows.worst.label !== rows.best.label && (
        <>
          {" "}
          y menos los <b>{rows.worst.label.toLowerCase()}</b> ({money(rows.worst.promedio)} por día)
        </>
      )}
      . Es el promedio de los días en que hubo ventas.
    </Callout>
  );
}

// ───────────────────────────── vistas ─────────────────────────────

function FacturacionView({ d, perf, prev, vsLabel }: ViewProps) {
  const f = d.facturacion;
  const diasTrabajados = f.porDiaSemana.filter((r) => r.dias > 0);
  const conBarberos = diasTrabajados.filter((r) => r.barberos > 0);
  const mejorPorBarbero = [...conBarberos].sort((a, b) => b.facturaPorBarbero - a.facturaPorBarbero)[0];
  const peorPorBarbero = [...conBarberos].sort((a, b) => a.facturaPorBarbero - b.facturaPorBarbero)[0];
  return (
    <div className="space-y-5">
      <StatGrid twoCols>
        <Stat label="Facturación" value={money(f.total)} sub={<Delta cur={perf.facturacion} prev={prev?.facturacion ?? null} label={vsLabel} />} />
        <Stat label="Servicios" value={money(f.ventasServicios)} />
        <Stat
          label="Productos vendidos"
          value={money(f.ventasProductos + f.consumos)}
          sub={f.consumos > 0 ? `Incluye ${money(f.consumos)} de consumos de profesionales` : undefined}
        />
        <Stat label="Descuentos otorgados" value={money(f.descuentoTotal)} sub="Promos y descuentos manuales" />
      </StatGrid>

      <Block title="Por servicio" hint="Monto de cada servicio después de descuentos y promos.">
        <Bars rows={f.porServicio} sub={(r, t) => `${r.count} serv. ${sharePct(r, t)}`} />
      </Block>

      <Block title="Por profesional">
        <Bars rows={f.porProfesional} sub={(r, t) => `${r.count} ventas ${sharePct(r, t)}`} color="bg-violet-400/70" />
      </Block>

      <Block title="Por promoción">
        {f.porPromo.length === 0 ? (
          <div className="text-sm text-white/40">No hubo ventas con promoción en el mes.</div>
        ) : (
          <Bars
            rows={f.porPromo}
            sub={(r) => `${r.count} ventas · descuento ${money(r.extra ?? 0)}`}
            color="bg-amber-400/70"
          />
        )}
        <div className="mt-3">
          <KV rows={[["Ventas sin promoción", `${f.sinPromo.ventas} · ${money(f.sinPromo.facturado)}`]]} />
        </div>
      </Block>

      <Block
        title="Por día de la semana"
        hint="Solo los días en que se trabajó. Los barberos son los programados en el panel de horarios ese día."
      >
        {diasTrabajados.length === 0 ? (
          <div className="text-sm text-white/40">Sin ventas en el mes.</div>
        ) : (
          <div className="space-y-3">
            {diasTrabajados.map((r) => {
              const isBest = mejorPorBarbero?.label === r.label && peorPorBarbero?.label !== r.label;
              const isWorst = peorPorBarbero?.label === r.label && mejorPorBarbero?.label !== r.label;
              const rango = `${int(r.barberosHabitual)} ${r.barberosHabitual === 1 ? "barbero" : "barberos"}`;
              const maxProm = Math.max(1, ...diasTrabajados.map((x) => x.promedio));
              return (
                <div key={r.label} className="rounded-xl border border-white/[0.09] bg-black/20 p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-white">{r.label}</span>
                      {isBest && (
                        <span className="rounded-full border border-emerald-400/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                          Más alto
                        </span>
                      )}
                      {isWorst && (
                        <span className="rounded-full border border-rose-400/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-300">
                          Más bajo
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-white/70">
                      Total de los {diaPlural(r.label)}{" "}
                      <span className="text-xs text-white/40">
                        ({r.dias} {r.dias === 1 ? "día" : "días"})
                      </span>
                    </span>
                    <span className="font-display text-lg font-semibold tabular-nums text-white">{money(r.total)}</span>
                  </div>
                  <div className="mt-3 space-y-3 border-t border-white/[0.07] pt-3">
                    <div>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-white/70">Promedio por día</span>
                        <span className="font-semibold tabular-nums text-white">{money(r.promedio)}</span>
                      </div>
                      <Track pct={r.promedio / maxProm} color="bg-sky-400/70" />
                    </div>
                    <div>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-white/70">
                          Factura cada barbero <span className="text-xs text-white/40">({rango})</span>
                        </span>
                        <span className="font-semibold tabular-nums text-white">{money(r.facturaPorBarbero)}</span>
                      </div>
                      <Track pct={r.facturaPorBarbero / maxProm} color="bg-white/40" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {mejorPorBarbero && peorPorBarbero && mejorPorBarbero.label !== peorPorBarbero.label && (
          <div className="mt-4">
            <Callout>
              <div>
                <b>Día más alto:</b> {mejorPorBarbero.label.toLowerCase()}, cada barbero factura{" "}
                <b>{money(mejorPorBarbero.facturaPorBarbero)}</b>
              </div>
              <div className="mt-1">
                <b>Día más bajo:</b> {peorPorBarbero.label.toLowerCase()}, cada barbero factura{" "}
                <b>{money(peorPorBarbero.facturaPorBarbero)}</b>
              </div>
            </Callout>
          </div>
        )}
      </Block>

      <Block title="Por quincena">
        <div className="space-y-3">
          {f.porQuincena.map((q) => (
            <div key={q.label} className="rounded-xl border border-white/[0.09] bg-black/20 p-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-white/80">{q.label}</span>
                <span className="font-display text-xl font-semibold tabular-nums text-white">{money(q.total)}</span>
              </div>
              <Track pct={q.total / Math.max(1, ...f.porQuincena.map((x) => x.total))} color="bg-sky-400/70" />
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <MiniStat label="Ventas" value={int(q.ventas)} />
                <MiniStat label="Días con ventas" value={int(q.dias)} />
                <MiniStat label="Promedio por día" value={money(q.promedio)} />
                <MiniStat label="Ticket promedio" value={money(q.ticket)} />
              </div>
            </div>
          ))}
        </div>
        {f.porQuincena.length === 2 && f.porQuincena[0].promedio > 0 && f.porQuincena[1].promedio > 0 && (
          <div className="mt-4">
            <Callout>
              Promedio por día de la 2ª quincena vs la 1ª:{" "}
              <b>
                {variationPct(f.porQuincena[1].promedio, f.porQuincena[0].promedio)! >= 0 ? "+" : "-"}
                {pct1(Math.abs(variationPct(f.porQuincena[1].promedio, f.porQuincena[0].promedio)!))}
              </b>
              .
            </Callout>
          </div>
        )}
      </Block>

      <Block title="Por franja horaria" hint="Según la hora en que se registró el cobro.">
        <Bars rows={f.porFranja} sub={(r, t) => `${r.count} ventas ${sharePct(r, t)}`} color="bg-fuchsia-400/70" />
      </Block>

      <Block title="Por medio de pago">
        <Bars rows={perf.metodos.map((m) => ({ label: methodLabel(m.key), value: m.monto }))} sub={sharePct} color="bg-teal-400/70" />
      </Block>
    </div>
  );
}

function GastosView({ d, perf, prev, vsLabel }: ViewProps) {
  const g = d.gastos;
  return (
    <div className="space-y-5">
      <StatGrid>
        <Stat label="Gastos del mes" value={money(g.total)} sub={<Delta cur={perf.gastosTotal} prev={prev?.gastosTotal ?? null} label={vsLabel} lowerIsBetter />} />
        <Stat label="Cantidad de gastos" value={int(g.cantidad)} />
        <Stat
          label="% de la facturación"
          value={g.porcentajeDeFacturacion != null ? pct1(g.porcentajeDeFacturacion) : "—"}
          sub="Cuánto de lo que facturás se va en gastos"
        />
        <Stat label="Promedio por día" value={money(g.promedioPorDia)} sub="Sobre todos los días del mes" />
        {g.diaMayorGasto && (
          <Stat label="Día de mayor gasto" value={dateLabel(g.diaMayorGasto.date)} sub={money(g.diaMayorGasto.total)} />
        )}
      </StatGrid>

      <Block title="Por tipo" hint="Fijos (alquiler, servicios), variables (insumos) y ocasionales.">
        <Bars rows={g.porTipo} sub={(r, t) => `${r.count} gastos ${sharePct(r, t)}`} color="bg-rose-400/70" />
      </Block>
      <Block title="Por origen del dinero">
        <Bars rows={g.porOrigen} sub={sharePct} color="bg-orange-400/70" />
      </Block>
      <Block title="Por medio de pago">
        <Bars rows={g.porMedio} sub={sharePct} color="bg-teal-400/70" />
      </Block>
      {g.porCategoria.length > 0 && (
        <Block title="Por categoría">
          <Bars rows={g.porCategoria} sub={sharePct} color="bg-violet-400/70" />
        </Block>
      )}
      <Block title="Por semana del mes">
        <Bars rows={g.porSemana} sub={(r) => `${r.count} gastos`} color="bg-sky-400/70" />
      </Block>
      <Block title="Los 5 gastos más grandes">
        {g.mayores.length === 0 ? (
          <div className="text-sm text-white/40">Sin gastos en el mes.</div>
        ) : (
          <div className="divide-y divide-white/[0.06] text-sm">
            {g.mayores.map((e, i) => (
              <div key={`${e.name}-${i}`} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate text-white/80">
                  {e.name} <span className="text-xs text-white/35">· {e.type}{e.date ? ` · ${dateLabel(e.date)}` : ""}</span>
                </span>
                <span className="shrink-0 tabular-nums text-white">{money(e.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Block>
    </div>
  );
}

function ProfesionalesView({ d, perf, prev, vsLabel }: ViewProps) {
  const p = d.profesionales;
  return (
    <div className="space-y-5">
      <StatGrid>
        <Stat
          label="Pago a profesionales"
          value={money(perf.pagoProfesionales)}
          sub={<Delta cur={perf.pagoProfesionales} prev={prev?.pagoProfesionales ?? null} label={vsLabel} />}
        />
        <Stat label="Comisión real" value={money(p.comisionTotal)} sub="Antes de descuentos" />
        <Stat
          label="Descuento por puntualidad"
          value={money(-p.puntualidadTotal)}
          sub={`${p.tardes} ${p.tardes === 1 ? "tarde" : "tardes"} · ${p.ausencias} ${p.ausencias === 1 ? "ausencia" : "ausencias"}`}
          tone={p.puntualidadTotal > 0 ? "neg" : undefined}
        />
        <Stat label="Adelantos" value={money(p.adelantosTotal)} sub="Plata entregada en el mes" />
        <Stat label="Consumos de productos" value={money(p.consumosTotal)} sub="Retiros de stock a cuenta" />
        <Stat
          label="Comisión sobre facturación"
          value={p.comisionSobreFacturacion != null ? pct1(p.comisionSobreFacturacion) : "—"}
          sub="Cuánto de lo que facturás va a profesionales"
        />
      </StatGrid>

      <Block
        title="Por profesional"
        hint="Pago neto = comisión − puntualidad. Saldo estimado = pago neto − adelantos − consumos."
      >
        <div className="space-y-2.5">
          {p.filas.map((f) => (
            <div key={f.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-white">{f.name}</span>
                <span className={cn("tabular-nums text-sm font-semibold", f.saldo >= 0 ? "text-emerald-300" : "text-rose-300")}>
                  Saldo {money(f.saldo)}
                </span>
              </div>
              <div className="mt-2">
                <KV
                  rows={[
                    ["Facturación", money(f.facturacion)],
                    ["Comisión", `${money(f.comision)}${f.comisionPct != null ? ` (${pct1(f.comisionPct)})` : ""}`],
                    [
                      "Puntualidad",
                      f.puntualidad === 0 && f.tardes === 0 && f.ausencias === 0
                        ? "Sin faltas"
                        : `${money(-f.puntualidad)}${f.tardes ? ` · ${f.tardes} tarde${f.tardes === 1 ? "" : "s"}` : ""}${f.ausencias ? ` · ${f.ausencias} ausencia${f.ausencias === 1 ? "" : "s"}` : ""}`,
                    ],
                    ["Pago neto", money(f.pagoNeto)],
                    ["Adelantos", money(f.adelantos)],
                    ["Consumos de productos", money(f.consumos)],
                    ["Propinas (son del profesional)", money(f.propinas)],
                  ]}
                />
              </div>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Estado de las comisiones" hint="De las ventas del mes.">
        <KV
          rows={[
            ["Comisión total", money(p.comisionTotal)],
            ["Incluida en una liquidación", money(p.incluidaEnLiquidacion)],
            ["Todavía sin liquidar", money(p.sinLiquidar)],
            ["Por servicios", money(p.comisionServicios)],
            ["Por productos", money(p.comisionProductos)],
          ]}
        />
      </Block>

      <Block title="Adelantos por origen del dinero">
        <Bars rows={p.adelantosPorOrigen} sub={sharePct} color="bg-amber-400/70" empty="Sin adelantos en el mes." />
      </Block>

      <Block title="Productos retirados a cuenta">
        <Bars rows={p.consumosPorProducto} sub={(r) => `${r.count} retiros`} color="bg-fuchsia-400/70" empty="Sin retiros de stock en el mes." />
      </Block>
    </div>
  );
}

function VentasView({ d, perf, prev, vsLabel }: ViewProps) {
  const v = d.ventas;
  const porDia = v.porDiaSemana.map((r) => ({ label: r.label, value: r.dias > 0 ? r.ventas / r.dias : 0, count: r.dias }));
  return (
    <div className="space-y-5">
      <StatGrid>
        <Stat label="Ventas" value={int(v.total)} sub={<Delta cur={perf.ventas} prev={prev?.ventas ?? null} label={vsLabel} />} />
        <Stat label="Promedio por día" value={v.promedioPorDia.toFixed(1).replace(".", ",")} sub={`${v.diasConVentas} días con ventas`} />
        <Stat label="Anuladas" value={int(v.anuladas.count)} sub={`${money(v.anuladas.monto)} · no cuentan`} />
        <Stat label="Sin cobrar" value={int(v.sinCobrar.count)} sub={money(v.sinCobrar.monto)} />
        <Stat label="Combos" value={int(v.combos)} sub="Ventas con más de un servicio" />
        <Stat label="Con producto" value={int(v.conProducto)} sub="Ventas que incluyen un producto" />
      </StatGrid>

      <Block title="Con turno vs orden de llegada" hint="Las ventas sin turno agendado son clientes que llegaron sin reserva.">
        <Bars
          rows={[
            { label: "Con turno agendado", value: v.conTurno },
            { label: "Por orden de llegada", value: v.sinTurno },
          ]}
          format={int}
          sub={sharePct}
          color="bg-emerald-400/70"
        />
      </Block>
      <Block title="Por servicio">
        <Bars rows={v.porServicio} format={int} sub={(r) => `· ${money(r.extra ?? 0)}`} color="bg-sky-400/70" />
      </Block>
      <Block title="Por profesional">
        <Bars rows={v.porProfesional} format={int} sub={(r) => `· ${money(r.extra ?? 0)}`} color="bg-violet-400/70" />
      </Block>
      <Block title="Por día de la semana" hint="Promedio de ventas por día en que hubo actividad.">
        <Bars rows={porDia} format={(n) => n.toFixed(1).replace(".", ",")} sub={(r) => `${r.count} ${r.count === 1 ? "día" : "días"}`} color="bg-emerald-400/70" />
        {v.mejorDia && (
          <div className="mt-3">
            <Callout>
              El día con más ventas por jornada es el <b>{v.mejorDia.label.toLowerCase()}</b>.
            </Callout>
          </div>
        )}
      </Block>
      <Block title="Por franja horaria" hint="Según la hora en que se registró el cobro.">
        <Bars rows={v.porFranja} format={int} sub={(r) => `· ${money(r.extra ?? 0)}`} color="bg-fuchsia-400/70" />
      </Block>
    </div>
  );
}

function TicketView({ d, perf, prev, vsLabel }: ViewProps) {
  const t = d.ticket;
  const cmp = (label: string, x: { ventas: number; ticket: number }) => ({
    label,
    value: x.ticket,
    count: x.ventas,
  });
  return (
    <div className="space-y-5">
      <StatGrid>
        <Stat label="Ticket promedio" value={money(t.promedio)} sub={<Delta cur={perf.ticket} prev={prev?.ticket ?? null} label={vsLabel} />} />
        <Stat label="Ticket mediano" value={money(t.mediana)} sub="La mitad de las ventas está por debajo" />
        <Stat label="Rango habitual" value={`${money(t.q1)} a ${money(t.q3)}`} sub="Donde cae la mayoría de las ventas" />
        <Stat label="Venta más alta" value={money(t.maximo)} />
        <Stat label="Venta más baja" value={money(t.minimo)} />
      </StatGrid>
      <Block title="Por profesional">
        <Bars rows={t.porProfesional} sub={(r) => `${r.count} ventas`} color="bg-violet-400/70" />
      </Block>
      <Block title="Por día de la semana">
        <Bars
          rows={t.porDiaSemana.filter((r) => r.ventas > 0).map((r) => ({ label: r.label, value: r.ticket, count: r.ventas }))}
          sub={(r) => `${r.count} ventas`}
          color="bg-emerald-400/70"
        />
      </Block>
      <Block title="Por medio de pago">
        <Bars rows={t.porMedio.map((r) => ({ ...r, label: methodLabel(r.label) }))} sub={(r) => `${r.count} ventas`} color="bg-teal-400/70" />
      </Block>
      <Block title="Con promoción vs sin promoción" hint="Una promo baja el ticket de esa venta.">
        <Bars
          rows={[cmp("Sin promoción", t.sinPromo), cmp("Con promoción", t.conPromo)].filter((r) => (r.count ?? 0) > 0)}
          sub={(r) => `${r.count} ventas`}
          color="bg-amber-400/70"
        />
      </Block>
      <Block title="Con turno vs por orden de llegada">
        <Bars
          rows={[cmp("Con turno agendado", t.conTurno), cmp("Por orden de llegada", t.sinTurno)].filter((r) => (r.count ?? 0) > 0)}
          sub={(r) => `${r.count} ventas`}
          color="bg-sky-400/70"
        />
      </Block>
      <Block title="Un servicio vs combo" hint="Vender más de un servicio por visita sube el ticket.">
        <Bars
          rows={[cmp("Un solo servicio", t.unServicio), cmp("Combo (más de un servicio)", t.combo)].filter((r) => (r.count ?? 0) > 0)}
          sub={(r) => `${r.count} ventas`}
          color="bg-fuchsia-400/70"
        />
      </Block>
    </div>
  );
}

function ClientesView({ d, perf, prev, vsLabel }: ViewProps) {
  const c = d.clientes;
  const tn = c.turnos;
  return (
    <div className="space-y-5">
      <StatGrid>
        <Stat label="Clientes atendidos" value={int(c.atendidos)} sub={<Delta cur={perf.clientes} prev={prev?.clientes ?? null} label={vsLabel} />} />
        <Stat label="Nuevos del mes" value={int(c.nuevos)} sub="Se registraron este mes" />
        <Stat label="Recurrentes" value={int(c.recurrentes)} sub="Ya venían de antes" />
        <Stat label="VIP atendidos" value={int(c.vip)} />
        <Stat label="Sin ficha de cliente" value={int(c.sinFicha)} sub="Ventas sin cliente registrado" />
        <Stat label="Por orden de llegada" value={int(c.ventasSinTurno)} sub="Ventas sin turno agendado" />
      </StatGrid>

      <Block title="Clasificación de los clientes atendidos" hint="Según su estado actual en Clientes.">
        <Bars rows={c.porEstado} format={int} sub={sharePct} color="bg-violet-400/70" empty="Sin clientes con ficha en el mes." />
      </Block>
      <Block title="Cuántas veces vino cada uno en el mes">
        <Bars rows={c.frecuencia} format={int} sub={sharePct} color="bg-emerald-400/70" />
      </Block>
      <Block title="Los 5 clientes que más gastaron">
        {c.topClientes.length === 0 ? (
          <div className="text-sm text-white/40">Sin datos en el mes.</div>
        ) : (
          <div className="divide-y divide-white/[0.06] text-sm">
            {c.topClientes.map((t, i) => (
              <div key={`${t.name}-${i}`} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate text-white/80">
                  {t.name} <span className="text-xs text-white/35">· {t.visitas} {t.visitas === 1 ? "visita" : "visitas"}</span>
                </span>
                <span className="shrink-0 tabular-nums text-white">{money(t.gasto)}</span>
              </div>
            ))}
          </div>
        )}
      </Block>
      <Block title="Turnos del mes" hint="Turnos agendados en la agenda (sin contar los bloqueos).">
        <KV
          rows={[
            ["Agendados", int(tn.agendados)],
            ["Cobrados", int(tn.cobrados)],
            ["Pendientes o confirmados", int(tn.pendientes)],
            ["Cancelados", `${int(tn.cancelados)}${tn.tasaCancelacion != null ? ` (${pct1(tn.tasaCancelacion)})` : ""}`],
            ["No asistieron", `${int(tn.noAsistieron)}${tn.tasaNoAsistencia != null ? ` (${pct1(tn.tasaNoAsistencia)})` : ""}`],
          ]}
        />
      </Block>
    </div>
  );
}

type ViewProps = { d: MonthlyDetail; perf: MonthlyPerformance; prev: MonthlyPerformance | null; vsLabel: string };

export function DetalleSheet({
  kind,
  onClose,
  monthKey,
  perf,
  prev,
  vsLabel,
}: {
  kind: DetalleKind | null;
  onClose: () => void;
  monthKey: string;
  perf: MonthlyPerformance;
  prev: MonthlyPerformance | null;
  vsLabel: string;
}) {
  const { businessId, activeBranchId } = useAuth();
  const clientsQuery = useClientsData(businessId ?? null);
  const raw = useQuery({
    queryKey: ["monthly-detail", businessId, activeBranchId, monthKey],
    enabled: !!businessId && kind !== null,
    staleTime: 60_000,
    queryFn: () => fetchMonthlyDetailRaw(businessId!, activeBranchId, monthKey),
  });

  const detail = React.useMemo(() => {
    if (!raw.data) return null;
    const clients = (clientsQuery.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      created_at: c.created_at,
      status: c.status,
      vipTag: c.vipTag,
    }));
    return computeMonthlyDetail(monthKey, raw.data, perf, clients);
  }, [raw.data, clientsQuery.data, monthKey, perf]);

  const view = detail && kind ? { d: detail, perf, prev, vsLabel } : null;

  return (
    <Sheet open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto border-white/10 bg-[#0b0d17] p-4 text-white sm:max-w-2xl sm:p-6"
      >
        <SheetHeader className="mb-4 text-left">
          <SheetTitle className="text-xl text-white">{kind ? TITLES[kind] : ""}</SheetTitle>
          <SheetDescription className="text-white/50">{monthLabel(monthKey)} · detalle y estadísticas</SheetDescription>
        </SheetHeader>
        {raw.isLoading || (kind && !view) ? (
          <div className="py-16 text-center text-sm text-white/45">Calculando el detalle…</div>
        ) : raw.isError ? (
          <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-6 text-sm text-rose-200">
            No se pudo cargar el detalle. Probá de nuevo en un momento.
          </div>
        ) : view && kind === "facturacion" ? (
          <FacturacionView {...view} />
        ) : view && kind === "gastos" ? (
          <GastosView {...view} />
        ) : view && kind === "profesionales" ? (
          <ProfesionalesView {...view} />
        ) : view && kind === "ventas" ? (
          <VentasView {...view} />
        ) : view && kind === "ticket" ? (
          <TicketView {...view} />
        ) : view && kind === "clientes" ? (
          <ClientesView {...view} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
