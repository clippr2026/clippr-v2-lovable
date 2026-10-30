// Origen del adelanto a un profesional (professional_advances.funds_source).
//  - "caja":    sale de los fondos del negocio. Descuenta del efectivo o del dinero
//               en cuenta según el medio, es un egreso de Caja y entra en el cierre.
//  - "externo": sale del bolsillo del dueño o de otra cuenta ajena al negocio. No
//               toca Efectivo del día, Dinero en cuenta del día ni el cierre; el
//               medio de pago queda como información.
//  - null:      adelanto anterior a esta función. No se reclasifica: se sigue
//               tratando como hasta entonces (como de la caja).
// En todos los casos el adelanto baja el "Total a pagar" del profesional una sola vez.
export type AdvanceFundsSource = "caja" | "externo";

export function advanceOriginLabel(source: string | null | undefined): string {
  if (source === "externo") return "Fondos externos";
  if (source === "caja") return "Caja del negocio";
  return "Anterior (sin origen)";
}

export function advanceMethodLabel(method: string | null | undefined): string {
  switch (String(method ?? "").toLowerCase()) {
    case "efectivo":
      return "Efectivo";
    case "transferencia":
      return "Transferencia";
    case "debito":
      return "Débito";
    default:
      return method ? String(method) : "—";
  }
}

// ¿Este adelanto es plata de la caja? (todo salvo "externo")
export function advanceAffectsCaja(source: string | null | undefined): boolean {
  return source !== "externo";
}
