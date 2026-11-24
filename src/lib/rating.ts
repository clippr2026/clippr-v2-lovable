// Promedio de estrellas con un decimal y coma: 5 -> "5,0", 4.5 -> "4,5".
export function fmtRating(v: number | string | null | undefined): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1).replace(".", ",") : "";
}
