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

describe("Cerrar un día desde Historial: paso previo de salidas y puntualidad", () => {
  const ui = readSrc("src/routes/cash-register.tsx");
  const step = readSrc("src/components/cash-register/cierre-prerequisitos-step.tsx");

  it("'Confirmar cierre' abre primero el paso previo y recién después la confirmación final", () => {
    expect(ui).toContain("onClick={() => setPrereqStep(true)}");
    expect(ui).toContain("<CierrePrerequisitosStep");
    expect(ui).toMatch(/onContinue=\{\(\) => \{\s*setPrereqStep\(false\);\s*setConfirmStep\(true\);/);
  });

  it("la puntualidad se confirma siempre al cerrar (solo se saltea antes del corte) y 'Continuar' exige resolver todo", () => {
    expect(step).toContain("const skip = !applies && salidasOtros.length === 0;");
    expect(step).toContain('setDecided(skip ? "saltar" : "mostrar")');
    expect(step).toContain("disabled={cargando || pendientes > 0}");
    expect(step).toContain("<SalidasPendientesPanel");
    expect(step).toContain("<PresentismoRevisionPanel");
    // entrada y salida en el mismo módulo: la salida de cada profesional va en su fila
    expect(step).toContain("showSalida");
    expect(step).toContain("Entradas y salidas del día");
  });
});
