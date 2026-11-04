import { describe, expect, it } from "vitest";
import { computeMonthlyPerformance, type MonthlyRawData } from "@/lib/monthly-performance";
import { computeMonthlyDetail, type DetailPayment, type MonthlyDetailRaw } from "@/lib/monthly-detail";

const pay = (over: Partial<DetailPayment> = {}): DetailPayment => ({
  id: "p",
  total: 20000,
  amount: 20000,
  original_amount: null,
  discount: null,
  promotion_name: null,
  service_name: "Corte",
  items: null,
  tip_amount: 0,
  status: "cobrado",
  method: "cash",
  payment_method: "cash",
  employee_id: "emp-a",
  client_id: null,
  client_name: "Cliente",
  created_at: "2026-10-05T15:00:00Z", // lunes 05/10, 12:00 en Argentina
  appointment_id: null,
  ...over,
});

const perfOf = (payments: DetailPayment[]) => {
  const raw: MonthlyRawData = {
    payments: payments.map((p) => ({ ...p, tip_amount: p.tip_amount, splits: null })) as any,
    collections: [],
    expenses: [],
    commissions: [],
    attendance: [],
    consumos: [],
    employees: [{ id: "emp-a", full_name: "Alan" }],
  };
  return computeMonthlyPerformance("2026-10", raw);
};

const detailRaw = (payments: DetailPayment[], over: Partial<MonthlyDetailRaw> = {}): MonthlyDetailRaw => ({
  payments,
  expenses: [],
  commissions: [],
  advances: [],
  appts: [],
  ...over,
});

describe("Detalle del mes", () => {
  it("los servicios reparten el total cobrado: suman exactamente la facturación, con descuentos aplicados", () => {
    const payments = [
      pay({
        id: "a",
        total: 18000,
        original_amount: 20000,
        promotion_name: "Promo UADE",
        items: [
          { name: "Corte", qty: 1, amount: 12000 },
          { name: "Barba", qty: 1, amount: 8000 },
        ],
      }),
      pay({ id: "b", total: 10000, items: [{ name: "Corte", qty: 1, amount: 10000 }] }),
    ];
    const d = computeMonthlyDetail("2026-10", detailRaw(payments), perfOf(payments), []);
    const suma = d.facturacion.porServicio.reduce((s, r) => s + r.value, 0);
    expect(Math.round(suma)).toBe(28000);
    expect(d.facturacion.descuentoTotal).toBe(2000);
    expect(d.facturacion.porPromo[0].label).toBe("Promo Uade");
    expect(d.facturacion.porPromo[0].extra).toBe(2000);
  });

  it("promo con distinta capitalización cuenta como una sola", () => {
    const payments = [
      pay({ id: "a", promotion_name: "Promo AMIGOS" }),
      pay({ id: "b", promotion_name: "Promo Amigos" }),
    ];
    const d = computeMonthlyDetail("2026-10", detailRaw(payments), perfOf(payments), []);
    expect(d.facturacion.porPromo).toHaveLength(1);
    expect(d.facturacion.porPromo[0].count).toBe(2);
  });

  it("detecta el mejor y el peor día de la semana por promedio de los días con ventas", () => {
    const payments = [
      pay({ id: "a", total: 50000, created_at: "2026-10-05T15:00:00Z" }), // lunes
      pay({ id: "b", total: 10000, created_at: "2026-10-06T15:00:00Z" }), // martes
      pay({ id: "c", total: 10000, created_at: "2026-10-13T15:00:00Z" }), // martes
    ];
    const d = computeMonthlyDetail("2026-10", detailRaw(payments), perfOf(payments), []);
    expect(d.facturacion.mejorDia?.label).toBe("Lunes");
    expect(d.facturacion.peorDia?.label).toBe("Martes");
    expect(d.facturacion.mejorFecha?.date).toBe("2026-10-05");
  });

  it("ventas con turno vs orden de llegada, anuladas y combos", () => {
    const payments = [
      pay({ id: "a", appointment_id: "t1", items: [{ name: "Corte", qty: 1, amount: 20000 }] }),
      pay({ id: "b", items: [{ name: "Corte", qty: 1, amount: 15000 }, { name: "Barba", qty: 1, amount: 5000 }] }),
      pay({ id: "c", status: "anulado", total: 9000 }),
    ];
    const d = computeMonthlyDetail("2026-10", detailRaw(payments), perfOf(payments), []);
    expect(d.ventas.total).toBe(2);
    expect(d.ventas.conTurno).toBe(1);
    expect(d.ventas.sinTurno).toBe(1);
    expect(d.ventas.combos).toBe(1);
    // un servicio armado como combo ("Corte + Barba") también cuenta
    const combo = [pay({ id: "d", items: [{ name: "Corte + Barba", qty: 1, amount: 24000 }] })];
    expect(computeMonthlyDetail("2026-10", detailRaw(combo), perfOf(combo), []).ventas.combos).toBe(1);
    expect(d.ventas.anuladas).toEqual({ count: 1, monto: 9000 });
  });

  it("ticket: promedio, mediana y comparación de un servicio vs combo", () => {
    const payments = [
      pay({ id: "a", total: 10000, items: [{ name: "Corte", qty: 1, amount: 10000 }] }),
      pay({ id: "b", total: 20000, items: [{ name: "Corte", qty: 1, amount: 20000 }] }),
      pay({ id: "c", total: 60000, items: [{ name: "Corte", qty: 1, amount: 30000 }, { name: "Barba", qty: 1, amount: 30000 }] }),
    ];
    const d = computeMonthlyDetail("2026-10", detailRaw(payments), perfOf(payments), []);
    expect(d.ticket.promedio).toBe(30000);
    expect(d.ticket.mediana).toBe(20000);
    expect(d.ticket.combo).toEqual({ ventas: 1, ticket: 60000 });
    expect(d.ticket.unServicio.ventas).toBe(2);
  });

  it("clientes: nuevos del mes, VIP y turnos cancelados/no asistieron", () => {
    const payments = [
      pay({ id: "a", client_id: "c1", client_name: "Nuevo" }),
      pay({ id: "b", client_id: "c2", client_name: "Habitual" }),
      pay({ id: "c", client_id: "c2", client_name: "Habitual" }),
    ];
    const clients = [
      { id: "c1", name: "Nuevo", created_at: "2026-10-03T12:00:00Z", status: "nuevo", vipTag: null },
      { id: "c2", name: "Habitual", created_at: "2026-08-01T12:00:00Z", status: "vip", vipTag: "vip" },
    ];
    const appts = [
      { id: "1", status: "charged", starts_at: "2026-10-05T15:00:00Z", employee_id: "emp-a" },
      { id: "2", status: "cancelled", starts_at: "2026-10-05T16:00:00Z", employee_id: "emp-a" },
      { id: "3", status: "no_show", starts_at: "2026-10-05T17:00:00Z", employee_id: "emp-a" },
      { id: "4", status: "blocked", starts_at: "2026-10-05T18:00:00Z", employee_id: "emp-a" },
    ];
    const d = computeMonthlyDetail("2026-10", detailRaw(payments, { appts }), perfOf(payments), clients);
    expect(d.clientes.atendidos).toBe(2);
    expect(d.clientes.nuevos).toBe(1);
    expect(d.clientes.recurrentes).toBe(1);
    expect(d.clientes.vip).toBe(1);
    expect(d.clientes.turnos.agendados).toBe(3); // el bloqueo no es un turno
    expect(d.clientes.turnos.cancelados).toBe(1);
    expect(d.clientes.turnos.noAsistieron).toBe(1);
  });

  it("gastos: por tipo, origen y los más grandes", () => {
    const expenses = [
      { id: "e1", name: "Alquiler", amount: 500000, type: "fijo", category: null, date: "2026-10-01", funds_source: "otros", payment_method: "transferencia" },
      { id: "e2", name: "Insumos", amount: 30000, type: "variable", category: "Insumos", date: "2026-10-10", funds_source: "caja", payment_method: "efectivo" },
    ];
    const payments = [pay({ id: "a", total: 100000 })];
    const d = computeMonthlyDetail("2026-10", detailRaw(payments, { expenses }), perfOf(payments), []);
    expect(d.gastos.total).toBe(530000);
    expect(d.gastos.porTipo[0].label).toBe("Fijo");
    expect(d.gastos.porOrigen.find((r) => r.label === "Fondos externos")?.value).toBe(500000);
    expect(d.gastos.mayores[0].name).toBe("Alquiler");
    expect(d.gastos.porCategoria).toHaveLength(1);
  });
});
