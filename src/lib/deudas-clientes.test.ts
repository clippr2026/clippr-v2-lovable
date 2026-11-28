import { describe, expect, it } from "vitest";
import { agruparDeudas, type FilaDeuda } from "./deudas-clientes";

const fila = (id: string, extra: Partial<FilaDeuda> = {}): FilaDeuda => ({
  id,
  client_id: "c1",
  client_name: "Juan",
  total: 10000,
  amount: null,
  collected_amount: 0,
  created_at: "2026-11-01T10:00:00Z",
  ...extra,
});

describe("agruparDeudas", () => {
  it("junta las ventas del mismo cliente y suma solo lo que falta", () => {
    const [d] = agruparDeudas([fila("a"), fila("b", { collected_amount: 4000, created_at: "2026-11-05T10:00:00Z" })]);
    expect(d).toMatchObject({ clave: "c1", total: 16000, ids: ["a", "b"], fecha: "2026-11-05T10:00:00Z" });
  });
  it("sin ficha junta por nombre y descarta lo ya cobrado", () => {
    const lista = agruparDeudas([
      fila("a", { client_id: null, client_name: "Pedro " }),
      fila("b", { client_id: null, client_name: "pedro" }),
      fila("c", { collected_amount: 10000 }),
    ]);
    expect(lista).toHaveLength(1);
    expect(lista[0].ids).toEqual(["a", "b"]);
  });
});
