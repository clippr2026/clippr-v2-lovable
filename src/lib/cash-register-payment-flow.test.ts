import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const cashRegisterSrc = readSrc("src/routes/cash-register.tsx");
const paymentReceiptsSrc = readSrc("src/lib/payment-receipts.ts");
const useCajaDataSrc = readSrc("src/components/cash-register/use-caja-data.ts");

// Caso real (producción): un servicio de $25.000 + $1.000 de propina
// ($26.000 a cobrar) rechazaba el cobro completo con "El monto recibido
// ($26.000) no puede superar el total del servicio ($25.000, sin contar
// la propina)". Causa: el tope comparaba contra subtotalAfterDiscount
// (con descuento, SIN propina) en vez de finalTotal (con propina) — la
// misma cifra que ya usan change/cashShortfall más abajo en el mismo
// archivo. Fix: comparar contra finalTotal.
describe("Monto recibido — tope correcto contra finalTotal (con propina), no subtotalAfterDiscount", () => {
  it("el tope de la validación usa finalTotal, no subtotalAfterDiscount", () => {
    expect(cashRegisterSrc).toMatch(/if \(receivedAmount > finalTotal \+ 0\.01\) \{/);
    expect(cashRegisterSrc).not.toMatch(/if \(receivedAmount > subtotalAfterDiscount \+ 0\.01\) \{/);
  });

  it("el mensaje de error ya no dice 'sin contar la propina' sobre un tope que ahora sí la incluye", () => {
    expect(cashRegisterSrc).not.toMatch(/sin contar la propina/);
    expect(cashRegisterSrc).toMatch(/con propina incluida/);
  });

  it("el piso (monto insuficiente) ya no es exclusivo de efectivo — aplica a cualquier medio en Pago simple", () => {
    // Antes: `if (method === "cash" && cashShortfall > 0)`. Un pago por
    // transferencia/débito/crédito/QR por debajo del total (con propina)
    // pasaba sin ningún aviso.
    expect(cashRegisterSrc).not.toMatch(/if \(method === "cash" && cashShortfall > 0\)/);
    expect(cashRegisterSrc).toMatch(/if \(receivedAmount < finalTotal - 0\.01\) \{/);
  });

  it("el placeholder de 'Monto recibido' sugiere finalTotal (con propina), no subtotalAfterDiscount", () => {
    expect(cashRegisterSrc).toMatch(
      /placeholder=\{`Total: \$\$\{Math\.round\(finalTotal\)\.toLocaleString\("es-AR"\)\}`\}/,
    );
  });
});

// Caso real: dejar "Monto recibido" vacío y tocar "Cobrar" registraba el
// pago por el importe total completo, sin que el usuario haya tipeado
// nada. Fix: un campo vacío bloquea el cobro — nunca se autocompleta al
// confirmar. Acotado a Pago simple a propósito: Pago múltiple no usa este
// campo (tiene su propia validación, splitsTotal contra finalTotal, ya
// correcta) — aplicar esto sin el `paymentMode === "simple"` bloquearía
// TODOS los pagos múltiples (ahí `received` queda vacío siempre).
describe("Monto recibido obligatorio — un campo vacío nunca genera un cobro", () => {
  it("hay un chequeo explícito de campo vacío, con el mensaje pedido", () => {
    expect(cashRegisterSrc).toMatch(/if \(received\.trim\(\) === ""\) \{/);
    expect(cashRegisterSrc).toMatch(/Ingresá el monto recibido para continuar/);
  });

  it("el chequeo de vacío está acotado a Pago simple (nunca bloquea Pago múltiple)", () => {
    expect(cashRegisterSrc).toMatch(
      /if \(turnoChargeMode !== "manual" && paymentMode === "simple"( && !isSinCargo)?\) \{\s*\n\s*if \(received\.trim\(\) === ""\)/,
    );
  });

  it("el chequeo de vacío corre ANTES que el de negativo y el de tope (orden importa: bloquear antes de leer un número)", () => {
    const emptyIdx = cashRegisterSrc.indexOf('if (received.trim() === "")');
    const negativeIdx = cashRegisterSrc.indexOf("El monto recibido no puede ser negativo");
    const capIdx = cashRegisterSrc.indexOf("if (receivedAmount > finalTotal + 0.01)");
    expect(emptyIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeLessThan(negativeIdx);
    expect(emptyIdx).toBeLessThan(capIdx);
  });
});

// Comprobantes: antes solo "Transferencia" podía adjuntar/ver comprobante
// (3 lugares con `method === "transfer"` / `method !== "transfer"`) —
// Débito/Crédito/QR quedaban sin esta opción aunque también son medios
// sin efectivo físico. Fix: cualquier medio distinto de Efectivo.
describe("Comprobantes — disponibles para cualquier medio no efectivo, nunca para Efectivo", () => {
  it("la captura en Pago simple se muestra para cualquier medio no efectivo (method !== \"cash\"), no solo transferencia", () => {
    expect(cashRegisterSrc).not.toMatch(/method === "transfer" && \(/);
    expect(cashRegisterSrc.match(/method !== "cash" && \(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("attachReceiptIfNeeded ya no se salta todo lo que no sea transferencia", () => {
    expect(cashRegisterSrc).not.toMatch(/if \(method !== "transfer" \|\| !receiptFile/);
    expect(cashRegisterSrc).toMatch(/if \(method === "cash" \|\| !receiptFile/);
  });

  it("ReceiptButton (\"Ver comprobante\" en el detalle de un cobro ya guardado) ya no se oculta para todo lo que no sea transferencia", () => {
    expect(cashRegisterSrc).not.toMatch(/if \(method !== "transfer"\) return null;/);
    expect(cashRegisterSrc).toMatch(/if \(method === "cash"\) return null;/);
  });
});

// Pago múltiple: cada componente no efectivo necesita poder llevar su
// propio comprobante, asociado al medio de pago correspondiente — no
// existía ningún camino para esto antes (MultiSplit no tenía ningún
// campo de comprobante, payments.receipt_path es una sola columna).
describe("Comprobantes en Pago múltiple — uno por componente no efectivo, vía payments.splits", () => {
  it("paymentSplitReceiptPath usa un PUNTO antes del sufijo (nunca un guion) — RLS de Storage matchea por el primer segmento antes del primer punto", () => {
    // Las policies de payment-receipts (storage.objects) hacen
    // split_part(storage.filename(name), '.', 1) = payments.id — un sufijo
    // con guion ("<uuid>-split-0.webp") deja el primer punto después de
    // TODO el nombre, rompiendo el match y bloqueando la subida (403).
    expect(paymentReceiptsSrc).toMatch(/return `\$\{businessId\}\/\$\{paymentId\}\.split\$\{splitIndex\}\.webp`;/);
  });

  it("attachReceiptToPaymentSplit matchea el split por `method`, nunca por índice de array", () => {
    expect(paymentReceiptsSrc).toMatch(/splits\.findIndex\(\(s\) => s\?\.method === method\)/);
  });

  it("attachReceiptToPaymentSplit linkea el comprobante DENTRO de payments.splits (nunca pisa payments.receipt_path, esa es solo de Pago simple)", () => {
    const fnMatch = paymentReceiptsSrc.match(
      /export async function attachReceiptToPaymentSplit\(([\s\S]*?)\n\}/,
    );
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/update\(\{ splits: nextSplits \}\)/);
    // receipt_path SÍ aparece, pero como campo DENTRO de cada split
    // ({ ...s, receipt_path: path }) — nunca como un .update({ receipt_path })
    // a nivel de columna (esa forma es exclusiva de attachReceiptToPayment).
    expect(fnMatch![1]).not.toMatch(/update\(\{\s*receipt_path:/);
  });

  it("cash-register.tsx: un control de comprobante por cada split no efectivo, llave por método", () => {
    expect(cashRegisterSrc).toMatch(/splits\s*\n\s*\.filter\(\(sp\) => sp\.method !== "cash"\)/);
    expect(cashRegisterSrc).toMatch(/handleSplitReceiptFileSelected\(sp\.method, file\)/);
  });

  it("los 3 flujos que pueden terminar en un cobro real (venta nueva, turno pendiente, venta de mostrador) suben los comprobantes de splits", () => {
    expect(cashRegisterSrc.match(/await attachSplitReceiptsIfNeeded\(/g)?.length ?? 0).toBe(3);
  });

  it("los comprobantes de splits se limpian junto con el resto del formulario (nunca quedan File/object-URL colgados entre ventas)", () => {
    expect(cashRegisterSrc.match(/clearAllSplitReceipts\(\);/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});

// Visualización posterior: el detalle de un cobro ("Cómo se cobró") tiene
// que poder mostrar el comprobante de CADA split no efectivo, no solo el
// de un cobro de un solo medio — antes payments.splits ni siquiera
// llegaba al cliente en la consulta de paymentsToday (faltaba en el
// .select), así que el detalle de la mayoría de los cobros no tenía forma
// de saber que existían splits con comprobante.
describe("Comprobantes en Pago múltiple — visualización posterior en el detalle del cobro", () => {
  it("use-caja-data.ts: la consulta de paymentsToday trae `splits` (antes faltaba, splits.receipt_path quedaba invisible en el detalle)", () => {
    expect(useCajaDataSrc).toMatch(
      /\.select\("id,business_id,total,amount,method,payment_method,client_name,service_name,created_at,employee_id,appointment_id,charged_by,charge_type,status,collected_amount,charged_at,observations,discount,original_amount,tip_amount,items,receipt_path,splits"\)/,
    );
  });

  it("use-caja-data.ts: el tipo Payment.splits declara receipt_path por componente", () => {
    expect(useCajaDataSrc).toMatch(
      /splits\?: Array<\{ method\?: string \| null; amount\?: number \| null; receipt_path\?: string \| null \}> \| null;/,
    );
  });

  it("cash-register.tsx: nonCashSplits distingue 'con comprobante' (SplitReceiptButton) de 'sin comprobante' (aviso), nunca los mezcla", () => {
    expect(cashRegisterSrc).toMatch(/<SplitReceiptButton key=\{sp\.method\} method=\{sp\.method as string\} receiptPath=\{sp\.receipt_path\} \/>/);
    expect(cashRegisterSrc).toMatch(/Sin comprobante · \{PAY_METHOD_LABEL\[sp\.method as PayMethod\] \?\? sp\.method\}/);
  });

  it("cash-register.tsx: con splits no efectivo, se muestra la lista por split — nunca el botón único de un solo medio (ReceiptButton) a la vez", () => {
    const fnMatch = cashRegisterSrc.match(/nonCashSplits\.length > 0 \? \(([\s\S]*?)\) : \(/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/SplitReceiptButton/);
    expect(fnMatch![1]).not.toMatch(/<ReceiptButton/);
  });

  it("SplitReceiptButton solo visualiza (nunca permite adjuntar) — el comprobante de un split se carga al cobrar, no después", () => {
    const fnMatch = cashRegisterSrc.match(/function SplitReceiptButton\(([\s\S]*?)\n\}\n\nfunction History/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).not.toMatch(/AttachReceiptModal/);
    expect(fnMatch![1]).toMatch(/getPaymentReceiptSignedUrl\(receiptPath\)/);
  });
});
