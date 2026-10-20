// PostgREST devuelve, como mucho, el límite "Max Rows" configurado en el
// proyecto (default de Supabase: 1000) ante un `select` sin `.range()`/
// `.limit()` explícito — sin paginar, una tabla que ya superó ese tope
// pierde filas en silencio, sin ningún error visible. Afecta sobre todo a
// las consultas "todo el negocio" de Caja > Liquidaciones
// (commission_records/tip_records/settlement_runs/professional_advances),
// que crecen una fila por cobro y no tienen ningún filtro de fecha.
export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

// Repite la MISMA query con `.range(from, to)` hasta recibir menos filas
// que `pageSize` — ahí para, sin pedir una página más de la cuenta.
// `queryPage` tiene que aplicar un `.order()` estable (ideal: por `id`,
// nunca solo por una columna con empates posibles) antes del `.range()`
// que recibe, para que paginar no salte ni duplique filas entre páginas —
// responsabilidad del caller, este helper no lo puede garantizar por sí
// solo.
// PromiseLike, no Promise: el builder de supabase-js (PostgrestFilterBuilder)
// es "thenable" (se puede `await`) pero no un Promise real (no tiene
// .catch/.finally) hasta que se le aplica `.then`/`await` explícito — exigir
// Promise de más rompería el uso directo típico `(from, to) =>
// supabase.from(...).select(...).range(from, to)`.
export async function fetchAllRows<T>(
  queryPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await queryPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}
