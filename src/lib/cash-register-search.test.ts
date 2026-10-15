import { describe, expect, it } from "vitest";
import {
  cleanSearchParam,
  EMPTY_CASH_REGISTER_SEARCH,
  resolvePendingChargeFromSearch,
} from "./cash-register-search";

// Caso real reportado: cobrar un turno desde Agenda deja ?appointmentId=...
// en la URL de /cash-register. Cambiar de pestaña (tab local, nunca
// navegación) no tocaba la URL — "Nueva venta" seguía viendo ese mismo
// appointmentId y resucitaba el cliente/turno ya cobrado, bloqueando
// además el selector de cliente (pendingChargeInitialStep=3). La garantía
// que previene esto: sin appointmentId en la URL, nunca hay pendingCharge.
describe("resolvePendingChargeFromSearch — Nueva venta nunca hereda el turno anterior", () => {
  it("con appointmentId en la URL, resuelve el turno (comportamiento esperado al venir de Agenda)", () => {
    const result = resolvePendingChargeFromSearch({
      appointmentId: "appt-1",
      clientName: "Bruno Salazar",
      serviceName: "Corte en cabello corto",
      finalAmount: "19000",
      employeeId: "emp-pipo",
    });
    expect(result).not.toBeNull();
    expect(result?.id).toBe("appt-1");
    expect(result?.client_name).toBe("Bruno Salazar");
    expect(result?.service_price).toBe(19000);
    expect(result?.employee_id).toBe("emp-pipo");
  });

  it("sin appointmentId, nunca devuelve un turno — este es el estado que 'Nueva venta' necesita", () => {
    expect(resolvePendingChargeFromSearch({})).toBeNull();
    expect(
      resolvePendingChargeFromSearch({ clientName: "Alguien", finalAmount: "5000" }),
    ).toBeNull();
  });

  it("EMPTY_CASH_REGISTER_SEARCH (lo que clearChargeSearchParams escribe en la URL) resuelve siempre a null", () => {
    expect(resolvePendingChargeFromSearch(EMPTY_CASH_REGISTER_SEARCH)).toBeNull();
  });

  it("cobrar turno A, limpiar la URL, y que Nueva venta quede libre para el cliente B", () => {
    const turnoA = resolvePendingChargeFromSearch({
      appointmentId: "turno-A",
      clientName: "Cliente A",
      finalAmount: "20000",
    });
    expect(turnoA?.client_name).toBe("Cliente A");

    // clearChargeSearchParams() deja la URL en EMPTY_CASH_REGISTER_SEARCH —
    // la siguiente Nueva venta parte de cero, sin Cliente A pegado.
    const despuesDeLimpiar = resolvePendingChargeFromSearch(EMPTY_CASH_REGISTER_SEARCH);
    expect(despuesDeLimpiar).toBeNull();
  });

  it("usa finalAmount antes que totalPrice, y cae a null si ninguno es un monto válido", () => {
    expect(
      resolvePendingChargeFromSearch({ appointmentId: "a", finalAmount: "100", totalPrice: "200" })
        ?.service_price,
    ).toBe(100);
    expect(
      resolvePendingChargeFromSearch({ appointmentId: "a", totalPrice: "200" })?.service_price,
    ).toBe(200);
    expect(
      resolvePendingChargeFromSearch({ appointmentId: "a" })?.service_price,
    ).toBeNull();
    expect(
      resolvePendingChargeFromSearch({ appointmentId: "a", finalAmount: "0" })?.service_price,
    ).toBeNull();
  });
});

describe("cleanSearchParam — 'null'/'undefined' como texto literal no cuentan como valor real", () => {
  it("limpia los literales de texto que deja un enlace mal armado", () => {
    expect(cleanSearchParam("null")).toBeUndefined();
    expect(cleanSearchParam("undefined")).toBeUndefined();
    expect(cleanSearchParam("")).toBeUndefined();
    expect(cleanSearchParam("   ")).toBeUndefined();
  });

  it("conserva un valor real, recortando espacios", () => {
    expect(cleanSearchParam("  turno-123  ")).toBe("turno-123");
  });

  it("valores no-string (number, null, undefined) siempre dan undefined", () => {
    expect(cleanSearchParam(123)).toBeUndefined();
    expect(cleanSearchParam(null)).toBeUndefined();
    expect(cleanSearchParam(undefined)).toBeUndefined();
  });
});
