import { describe, expect, it } from "vitest";
import { disponibleParaLiquidar } from "./historial-movimientos";

const fila = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  professional_id: "d",
  settlement_run_id: null,
  created_at: "2026-11-20T10:00:00Z",
  pending_amount: 9000,
  payment_status: "cobrado",
  ...extra,
});
const evento = (record_id: string, amount: number, extra: Record<string, unknown> = {}) => ({
  record_id,
  professional_id: "d",
  settlement_run_id: null,
  amount,
  collected_at: "2026-11-21T10:00:00Z",
  ...extra,
});
const base = { professionalId: "d", periodStartAt: "2026-11-15T00:00:00Z", cutoffAt: new Date("2026-11-28T00:00:00Z") };
const total = (filas: ReturnType<typeof fila>[], eventos: ReturnType<typeof evento>[] = []) =>
  disponibleParaLiquidar({ filas, eventos, ...base } as never);

describe("disponibleParaLiquidar", () => {
  it("no suma ventas sin cobrar", () => {
    expect(total([fila("a"), fila("b", { payment_status: "pendiente" }), fila("c", { payment_status: "parcial" })])).toBe(9000);
  });
  it("de una venta parcial suma solo lo habilitado por los cobros", () => {
    expect(total([fila("a", { payment_status: "parcial", pending_amount: 4890 })], [evento("a", 4110)])).toBe(4110);
  });
  it("una venta saldada por cobros pendientes cuenta por sus cobros, una sola vez", () => {
    expect(total([fila("a", { pending_amount: 0 })], [evento("a", 4110), evento("a", 4890)])).toBe(9000);
  });
  it("respeta período, corte, profesional y lo ya liquidado", () => {
    const fuera = [
      fila("a", { created_at: "2026-11-10T00:00:00Z" }),
      fila("b", { created_at: "2026-11-29T00:00:00Z" }),
      fila("c", { professional_id: "x" }),
      fila("e", { settlement_run_id: "r" }),
    ];
    expect(total(fuera, [evento("f", 100, { settlement_run_id: "r" }), evento("g", 100, { collected_at: "2026-11-01T00:00:00Z" })])).toBe(0);
  });
});
