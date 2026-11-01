import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readSrc = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf8");

// Caso real 31/10/2026: una venta de $20.000 cargada como "pago pendiente"
// (payments.status='pendiente', method guardado = transfer, collected_amount=0)
// aparecía como "Cobrado / Transferencia" y se sumaba al dinero en banco
// esperado del cierre.
describe("Revisar cierre: las ventas pendientes/parciales no suman", () => {
  const src = readSrc("src/lib/caja-cierre.ts");

  it("el snapshot del cierre separa las ventas pendientes/parciales y solo suma las que entraron a caja", () => {
    expect(src).toContain("const payments = allPayments.filter((p) => isCountableCajaPayment(p.status))");
    expect(src).toContain("const pagosPendientes = allPayments.filter((p) => !isCountableCajaPayment(p.status))");
  });

  it("lo cobrado de pendientes entra por su medio, el día en que se cobró, y alimenta el esperado", () => {
    expect(src).toContain('.from("payment_collections")');
    expect(src).toContain("collections: snapshot.cobranzasSnapshot.map");
  });

  it("el detalle del cierre las muestra con su estado y sin medio de pago", () => {
    expect(src).toContain("cobrosPendientesSnapshot");
    const ui = readSrc("src/routes/cash-register.tsx");
    expect(ui).toContain("Pago pendiente");
    expect(ui).toContain("cobrosPendientes={snapshot.cobrosPendientesSnapshot}");
  });
});
