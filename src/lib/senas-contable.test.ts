import { describe, expect, it } from "vitest";
import {
  saleIngreso,
  senaCreditedOtherDay,
  senaEtiqueta,
  senasDetalleDelDia,
  senasDineroEnCuentaDelDia,
  senasIngresosDelDia,
  senasTransferenciasDelMes,
  type SenaLedgerRow,
} from "./senas-contable";

// Hoy = lunes 2026-11-09. Domingo = 2026-11-08.
const HOY = "2026-11-09";
const at = (day: string, hm = "15:00") => `${day}T${hm}:00-03:00`;
const row = (o: Partial<SenaLedgerRow> & { id: string; amount: number }): SenaLedgerRow => ({
  method: "transfer",
  status: "paid",
  approved_at: at(HOY),
  credited_at: at(HOY),
  ...o,
});

describe("Ejemplo del pedido: hoy apruebo $100.000, $50.000 transferidos hoy y $50.000 el domingo", () => {
  const deps = [row({ id: "a", amount: 50000 }), row({ id: "b", amount: 50000, credited_at: at("2026-11-08", "14:00") })];

  it("señas aprobadas e ingresos de hoy por señas: $100.000", () => {
    expect(senasIngresosDelDia(deps, HOY).neto).toBe(100000);
  });
  it("dinero en cuenta de hoy por estas señas: $50.000 (la del domingo no suma)", () => {
    expect(senasDineroEnCuentaDelDia(deps, HOY)).toBe(50000);
  });
  it("el detalle etiqueta 'Seña de hoy' y 'Seña del domingo' y marca cuál suma al dinero del día", () => {
    const det = senasDetalleDelDia(deps, HOY);
    expect(det.map((d) => [d.etiqueta, d.delDia])).toEqual([
      ["Seña de hoy", true],
      ["Seña del domingo", false],
    ]);
    expect(det.filter((d) => d.delDia).reduce((s, d) => s + d.amount, 0)).toBe(50000);
  });
  it("el movimiento de caja de la seña del domingo se reconoce como acreditado otro día", () => {
    expect(senaCreditedOtherDay({ deposit_id: "b", credited_at: at("2026-11-08", "14:00"), created_at: at(HOY) })).toBe(true);
    expect(senaCreditedOtherDay({ deposit_id: "a", credited_at: at(HOY), created_at: at(HOY) })).toBe(false);
    expect(senaCreditedOtherDay({ deposit_id: null, credited_at: at("2026-11-08"), created_at: at(HOY) })).toBe(false);
  });
});

describe("Ingresos de señas: aprobadas menos devueltas, cada una en su día", () => {
  it("una seña devuelta resta el día de la devolución, no el de la aprobación", () => {
    const d = row({ id: "r", amount: 10000, status: "returned", refund_amount: 10000, decided_at: at("2026-11-10") });
    expect(senasIngresosDelDia([d], HOY).neto).toBe(10000);
    expect(senasIngresosDelDia([d], "2026-11-10").neto).toBe(-10000);
  });
  it("las pendientes, en revisión y rechazadas no cuentan", () => {
    const deps = ["pending", "review", "rejected", "expired"].map((status, i) => row({ id: String(i), amount: 5000, status }));
    expect(senasIngresosDelDia(deps, HOY).neto).toBe(0);
  });
  it("una seña en efectivo no suma al dinero en cuenta", () => {
    expect(senasDineroEnCuentaDelDia([row({ id: "c", amount: 7000, method: "cash" })], HOY)).toBe(0);
  });
});

describe("Al cobrar el turno la seña no se cuenta dos veces", () => {
  it("venta de $79.990 con seña de $39.995: ingreso de la venta = $39.995", () => {
    expect(saleIngreso({ total: 79990, splits: [{ method: "sena", amount: 39995 }, { method: "cash", amount: 39995 }] })).toBe(39995);
  });
  it("una venta sin seña no cambia", () => {
    expect(saleIngreso({ total: 25000, splits: [{ method: "cash", amount: 25000 }] })).toBe(25000);
    expect(saleIngreso({ total: 25000 })).toBe(25000);
  });
  it("seña aprobada el mismo día del cobro: el total del día es el mismo de siempre", () => {
    const sena = senasIngresosDelDia([row({ id: "s", amount: 39995 })], HOY).neto;
    const venta = saleIngreso({ total: 79990, splits: [{ method: "sena", amount: 39995 }, { method: "cash", amount: 39995 }] });
    expect(sena + venta).toBe(79990);
  });
});

describe("Etiquetas", () => {
  it("hoy, domingo y viernes", () => {
    expect(senaEtiqueta(at(HOY), HOY)).toBe("Seña de hoy");
    expect(senaEtiqueta(at("2026-11-08"), HOY)).toBe("Seña del domingo");
    expect(senaEtiqueta(at("2026-11-06"), HOY)).toBe("Seña del viernes");
  });
});

describe("Total mensual de transferencias por fecha real de acreditación + conciliación", () => {
  it("cuenta por el día de acreditación, aunque se apruebe otro día o la caja ya esté cerrada", () => {
    const deps = [
      row({ id: "d", amount: 50000, credited_at: at("2026-11-08", "14:00") }),
      row({ id: "e", amount: 20000 }),
      row({ id: "f", amount: 9000, credited_at: at("2026-10-31", "23:00"), approved_at: at("2026-11-02") }),
    ];
    const r = senasTransferenciasDelMes(deps, "2026-11", new Set(["2026-11-08"]));
    expect(r.total).toBe(70000); // la del 31/10 pertenece a octubre
    expect(r.enDiasCerrados.map((d) => d.id)).toEqual(["d"]);
    expect(r.totalEnDiasCerrados).toBe(50000);
  });
});
