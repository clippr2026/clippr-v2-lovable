import { describe, expect, it } from "vitest";
import { fetchAllRows, type PageResult } from "./supabase-paginate";

// Simula una tabla con N filas, paginada por .range(from, to) — mismo
// contrato que un PostgrestFilterBuilder real (from/to inclusive).
function fakeTable(totalRows: number) {
  const allRows = Array.from({ length: totalRows }, (_, i) => ({ id: i }));
  return (from: number, to: number): PageResult<{ id: number }> => ({
    data: allRows.slice(from, to + 1),
    error: null,
  });
}

describe("fetchAllRows — paginación completa sin perder filas", () => {
  it("una sola página (menos filas que pageSize) trae todo en una sola llamada", async () => {
    const rows = await fetchAllRows((from, to) => Promise.resolve(fakeTable(5)(from, to)), 1000);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.id)).toEqual([0, 1, 2, 3, 4]);
  });

  it("más de 1000 filas (límite default de PostgREST) se traen completas, en varias páginas", async () => {
    const table = fakeTable(2500);
    const rows = await fetchAllRows((from, to) => Promise.resolve(table(from, to)), 1000);
    expect(rows).toHaveLength(2500);
    expect(rows[0].id).toBe(0);
    expect(rows[2499].id).toBe(2499);
    // Sin duplicados ni huecos.
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500);
  });

  it("exactamente un múltiplo de pageSize pide una página extra (vacía) para confirmar que no sigue — sin eso no hay forma de distinguir 'se acabó' de 'justo llenó la página'", async () => {
    let calls = 0;
    const table = fakeTable(2000);
    const rows = await fetchAllRows((from, to) => {
      calls += 1;
      return Promise.resolve(table(from, to));
    }, 1000);
    expect(rows).toHaveLength(2000);
    expect(calls).toBe(3);
  });

  it("0 filas devuelve array vacío sin loopear infinito", async () => {
    const rows = await fetchAllRows((from, to) => Promise.resolve(fakeTable(0)(from, to)), 1000);
    expect(rows).toEqual([]);
  });

  it("propaga el error de una página en vez de devolver datos parciales en silencio", async () => {
    await expect(
      fetchAllRows(
        () => Promise.resolve({ data: null, error: { message: "boom" } } as PageResult<unknown>),
        1000,
      ),
    ).rejects.toThrow("boom");
  });
});
