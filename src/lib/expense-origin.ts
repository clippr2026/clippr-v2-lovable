// Gastos: tipo (Fijo / Variable / Ocasional) y origen del dinero.
//   · "caja"  — Caja del día: sale del efectivo o del dinero en cuenta y entra en el cierre.
//   · "otros" — Otros fondos: el gasto se registra y cuenta una vez en reportes, pero no
//               baja Efectivo del día / Dinero en cuenta del día ni entra en el cierre.
// funds_source null = gasto histórico o de una app anterior: se trata como "caja".
export type ExpenseFundsSource = "caja" | "otros";
export type ExpenseKind = "fijo" | "variable" | "ocasional";

export const EXPENSE_KINDS: { value: ExpenseKind; label: string; hint: string }[] = [
  { value: "fijo", label: "Fijo", hint: "Se repite: alquiler, internet, sueldos" },
  { value: "variable", label: "Variable", hint: "Cambia con la actividad: insumos, mercadería" },
  { value: "ocasional", label: "Ocasional", hint: "De vez en cuando: reparaciones, equipamiento" },
];

export function expenseAffectsCaja(source: string | null | undefined): boolean {
  return source !== "otros";
}

export function expenseOriginLabel(source: string | null | undefined): string {
  return source === "otros" ? "Otros fondos" : source === "caja" ? "Caja del día" : "Caja del día (anterior)";
}

// Tipo legible. Gastos históricos: se muestra su categoría vieja (Alquiler, Insumos…)
// sin reclasificarla.
export function expenseKindLabel(type: string | null | undefined, category?: string | null): string {
  const kind = EXPENSE_KINDS.find((k) => k.value === type);
  if (kind) return kind.label;
  const legacy = (category || type || "").trim();
  return legacy ? legacy.charAt(0).toUpperCase() + legacy.slice(1) : "—";
}
