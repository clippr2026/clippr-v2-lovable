// Orden manual (drag&drop) de servicios/catálogo, definido en Configuración
// y guardado en business_settings.schedule._itemOrder.{service|catalog}.
// { [categoria]: [ids en el orden elegido] }. Lo usan tanto la propia
// pantalla de Configuración como Caja, para que "Nueva venta" liste los
// ítems en el mismo orden que el dueño del negocio armó.
export type CatalogOrderMap = Record<string, string[]>;

export function extractCatalogOrderMap(
  schedule: Record<string, unknown> | null | undefined,
  kind: "service" | "catalog",
): CatalogOrderMap {
  const itemOrder = (schedule?._itemOrder ?? {}) as Record<string, unknown>;
  return (itemOrder[kind] ?? {}) as CatalogOrderMap;
}

// Aplica el orden manual por categoría. Los ítems que todavía no figuran en
// el mapa (nuevos, o cargados antes de que existiera el orden manual) se
// agregan al final, respetando el orden en que llegaron (alfabético por
// nombre, tal como los devuelve la consulta a price_catalog).
//
// `defaultCategory` tiene que ser EXACTAMENTE el mismo fallback que usa
// Configuración al agrupar ítems sin categoría explícita ("Servicios" /
// "Productos" — ver price-catalog-section.tsx), porque ese es el nombre de
// categoría bajo el que se guardó el orden manual. Si acá se usara otro
// fallback (p. ej. "" u "Otro"), la clave no matchearía y el orden guardado
// nunca se aplicaría para los ítems sin categoría — que suelen ser la mayoría.
export function applyCatalogOrder<T extends { id: string; category: string | null }>(
  rows: T[],
  orderMap: CatalogOrderMap,
  defaultCategory: string,
): T[] {
  if (!orderMap || Object.keys(orderMap).length === 0) return rows;
  const byCategory = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.category || defaultCategory;
    const list = byCategory.get(key);
    if (list) list.push(row);
    else byCategory.set(key, [row]);
  }
  const result: T[] = [];
  for (const [category, categoryRows] of byCategory) {
    const order = orderMap[category];
    if (!order || order.length === 0) {
      result.push(...categoryRows);
      continue;
    }
    const byId = new Map(categoryRows.map((r) => [r.id, r]));
    const sorted: T[] = [];
    for (const id of order) {
      const row = byId.get(id);
      if (row) {
        sorted.push(row);
        byId.delete(id);
      }
    }
    sorted.push(...byId.values());
    result.push(...sorted);
  }
  return result;
}
