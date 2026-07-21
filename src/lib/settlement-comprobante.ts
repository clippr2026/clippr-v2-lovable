// Comprobante de liquidación/pago — texto plano reutilizado por Caja >
// Liquidaciones y por el Panel del profesional. Sin librería de PDF: el
// "Descargar" abre el diálogo de impresión nativo del navegador (el
// usuario elige "Guardar como PDF"), y "Compartir" usa la Web Share API
// con copiar-al-portapapeles como respaldo si el navegador no la soporta.

export type ComprobanteData = {
  runNumber: number;
  cutoffDate: string;
  professionalName: string;
  previousBalance: number;
  newCommissions: number;
  adjustments: number;
  deductions: number;
  totalToSettle: number;
  amountPaid: number;
  payment?: {
    amount: number;
    method: string;
    note?: string | null;
    balanceBefore: number;
    balanceAfter: number;
    paidByName: string;
    paidAt: string;
  } | null;
};

function money(n: number) {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

export function buildComprobanteText(d: ComprobanteData) {
  const lines = [
    `Comprobante de liquidación #${d.runNumber}`,
    `Profesional: ${d.professionalName}`,
    `Liquidado hasta: ${d.cutoffDate}`,
    "",
    `Saldo anterior:      ${money(d.previousBalance)}`,
    `Comisiones nuevas:    ${money(d.newCommissions)}`,
    ...(d.adjustments ? [`Ajustes:              ${money(d.adjustments)}`] : []),
    ...(d.deductions ? [`Deducciones:         -${money(d.deductions)}`] : []),
    `Total a liquidar:     ${money(d.totalToSettle)}`,
    `Pagado hasta ahora:   ${money(d.amountPaid)}`,
    `Saldo restante:       ${money(Math.max(d.totalToSettle - d.amountPaid, 0))}`,
  ];

  if (d.payment) {
    lines.push(
      "",
      "── Último pago ──",
      `Monto pagado:   ${money(d.payment.amount)}`,
      `Método:         ${d.payment.method}`,
      `Fecha:          ${new Date(d.payment.paidAt).toLocaleString("es-AR")}`,
      `Registrado por: ${d.payment.paidByName}`,
      `Saldo anterior: ${money(d.payment.balanceBefore)}`,
      `Saldo posterior:${money(d.payment.balanceAfter)}`,
      ...(d.payment.note ? [`Nota: ${d.payment.note}`] : []),
    );
  }

  return lines.join("\n");
}

export function downloadComprobante(text: string, title: string) {
  const win = window.open("", "_blank", "width=420,height=640");
  if (!win) return;
  win.document.write(
    `<!doctype html><html><head><title>${title}</title><style>` +
      `body{font-family:ui-monospace,monospace;white-space:pre-wrap;padding:24px;font-size:14px;line-height:1.5;color:#111}` +
      `</style></head><body>${text.replace(/</g, "&lt;")}</body></html>`,
  );
  win.document.close();
  win.focus();
  win.print();
}

export async function shareComprobante(text: string, title: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return "shared" as const;
    } catch {
      return "cancelled" as const;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied" as const;
  } catch {
    return "failed" as const;
  }
}
