// Exporta el Rendimiento mensual a PDF. Sin librería: abre una página
// imprimible y el diálogo nativo del navegador ("Guardar como PDF"), igual
// que el comprobante de liquidación (ver settlement-comprobante.ts).
import { monthLabel, variationPct, type MonthlyPerformance } from "@/lib/monthly-performance";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("es-AR")}`;

const METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  mp: "Mercado Pago",
  qr: "QR",
  cuenta: "Cuenta",
};
export const methodLabel = (key: string) =>
  METHOD_LABEL[key] ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function deltaText(current: number, previous: number | null | undefined): string {
  if (previous == null) return "";
  const pct = variationPct(current, previous);
  if (pct == null) return "";
  return `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1).replace(".", ",")}% vs mes anterior`;
}

export function buildMonthlyPerformanceHtml(
  perf: MonthlyPerformance,
  prev: MonthlyPerformance | null,
  businessName: string,
): string {
  const label = monthLabel(perf.monthKey);
  const totalMetodos = perf.metodos.reduce((s, m) => s + m.monto, 0);
  const row = (a: string, b: string, cls = "") => `<tr class="${cls}"><td>${a}</td><td class="r">${b}</td></tr>`;

  const metodos = perf.metodos
    .map((m) =>
      row(
        esc(methodLabel(m.key)),
        `${money(m.monto)} <span class="muted">(${totalMetodos > 0 ? Math.round((m.monto / totalMetodos) * 100) : 0}%)</span>`,
      ),
    )
    .join("");
  const gastos = perf.gastosPorTipo.map((g) => row(esc(g.tipo), money(g.total))).join("");
  const profesionales = perf.profesionales
    .map(
      (p) =>
        `<tr><td>${esc(p.name)}</td><td class="r">${money(p.facturacion)}</td><td class="r">${p.ventas}</td>` +
        `<td class="r">${money(p.comision)}</td><td class="r">${p.tardes}</td><td class="r">${p.ausencias}</td>` +
        `<td class="r">${p.descuentoPuntualidad ? money(-p.descuentoPuntualidad) : "—"}</td></tr>`,
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Rendimiento ${esc(label)} — ${esc(businessName)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;margin:0;padding:32px;font-size:13px;line-height:1.45}
  h1{font-size:22px;margin:0 0 2px} h2{font-size:14px;margin:22px 0 6px;text-transform:uppercase;letter-spacing:.06em;color:#444}
  .sub{color:#666;margin-bottom:18px}
  .hero{border:1px solid #ddd;border-radius:12px;padding:16px 18px;margin-bottom:8px}
  .hero .big{font-size:34px;font-weight:800;margin:2px 0}
  .pos{color:#0a7a4b} .neg{color:#b42318} .muted{color:#777;font-weight:400}
  .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}
  .kpi{border:1px solid #e3e3e3;border-radius:10px;padding:10px 12px}
  .kpi .l{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.05em} .kpi .v{font-size:18px;font-weight:700}
  table{width:100%;border-collapse:collapse} td,th{padding:6px 8px;border-bottom:1px solid #eee;text-align:left}
  th{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.04em} .r{text-align:right;white-space:nowrap}
  .note{margin-top:14px;font-size:12px;color:#555}
  @media print{body{padding:14px} .hero,.kpi{break-inside:avoid} table{break-inside:auto} tr{break-inside:avoid}}
</style></head><body>
<h1>Rendimiento de ${esc(label)}</h1>
<div class="sub">${esc(businessName)} · Generado el ${new Date().toLocaleDateString("es-AR")}</div>

<div class="hero">
  <div class="muted">Ganancia del mes</div>
  <div class="big ${perf.ganancia >= 0 ? "pos" : "neg"}">${money(perf.ganancia)}</div>
  <div class="muted">${esc(deltaText(perf.ganancia, prev?.hasData ? prev.ganancia : null))}${perf.margen != null ? ` · Margen ${perf.margen.toFixed(1).replace(".", ",")}%` : ""}</div>
  <div style="margin-top:6px">Facturación ${money(perf.facturacion)} − Gastos ${money(perf.gastosTotal)} − Profesionales ${money(perf.pagoProfesionales)} = <b>${money(perf.ganancia)}</b></div>
  <div class="muted">Profesionales: comisiones ${money(perf.comisiones)}${perf.descuentoPuntualidad ? ` ${perf.descuentoPuntualidad > 0 ? "−" : "+"} puntualidad ${money(Math.abs(perf.descuentoPuntualidad))}` : ""}</div>
</div>

<div class="kpis">
  <div class="kpi"><div class="l">Facturación</div><div class="v">${money(perf.facturacion)}</div><div class="muted">Cobrado ${money(perf.cobrado)}${perf.consumosProfesionales > 0 ? ` + consumos de profesionales ${money(perf.consumosProfesionales)}` : ""}</div><div class="muted">${esc(deltaText(perf.facturacion, prev?.hasData ? prev.facturacion : null))}</div></div>
  <div class="kpi"><div class="l">Gastos</div><div class="v">${money(perf.gastosTotal)}</div><div class="muted">Fondos externos ${money(perf.gastosExternos)}</div></div>
  <div class="kpi"><div class="l">Pago a profesionales</div><div class="v">${money(perf.pagoProfesionales)}</div><div class="muted">Comisiones ${money(perf.comisiones)}</div></div>
  <div class="kpi"><div class="l">Ventas cobradas</div><div class="v">${perf.ventas}</div><div class="muted">${esc(deltaText(perf.ventas, prev?.hasData ? prev.ventas : null))}</div></div>
  <div class="kpi"><div class="l">Ticket promedio</div><div class="v">${money(perf.ticket)}</div></div>
  <div class="kpi"><div class="l">Clientes atendidos</div><div class="v">${perf.clientes}</div></div>
  <div class="kpi"><div class="l">Propinas</div><div class="v">${money(perf.propinas)}</div></div>
</div>

<h2>Medios de pago</h2><table>${metodos || row("Sin cobros", "—")}</table>
<h2>Gastos por tipo</h2><table>${gastos || row("Sin gastos", "—")}</table>
<h2>Por profesional</h2>
<table><tr><th>Profesional</th><th class="r">Facturación</th><th class="r">Ventas</th><th class="r">Comisión</th><th class="r">Tardes</th><th class="r">Ausencias</th><th class="r">Desc. puntualidad</th></tr>${profesionales || row("Sin datos", "—")}</table>
${perf.pendienteDeCobro > 0 ? `<div class="note">Hay ${money(perf.pendienteDeCobro)} en ventas de este mes todavía sin cobrar: no están incluidas en la facturación.</div>` : ""}
<div class="note">La facturación cuenta solo lo efectivamente cobrado (ventas pendientes y anuladas quedan afuera). Los gastos incluyen Caja del día y Fondos externos. El pago a profesionales son las comisiones de las ventas cobradas del mes, neto de los descuentos de puntualidad. La facturación incluye los consumos de profesionales (productos retirados del inventario y anotados como adelanto), que cuentan en el mes del retiro aunque se descuenten después en la liquidación. Las propinas no se incluyen en la facturación.</div>
</body></html>`;
}

export function printMonthlyPerformance(
  perf: MonthlyPerformance,
  prev: MonthlyPerformance | null,
  businessName: string,
) {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return false;
  win.document.write(buildMonthlyPerformanceHtml(perf, prev, businessName));
  win.document.close();
  win.focus();
  // Deja que el navegador pinte la página antes de abrir el diálogo de impresión.
  win.setTimeout(() => win.print(), 250);
  return true;
}
