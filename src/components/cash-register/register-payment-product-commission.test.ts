import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeCommissionAmount, type EmployeeCommissionMap } from "@/lib/service-pricing";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

// Caso real que disparó esto: Alan Repila compró "Pomada Ambush" ($29.000)
// a Alejandro, que tiene 10% activo configurado para ese producto — pero la
// venta nunca generó fila en commission_records porque esa resolución era
// 100% responsabilidad del cliente, sin ningún resguardo server-side. Esta
// red de seguridad (register_sale, migración
// 20261029010000_register_sale_product_commission_safety_net) recalcula la
// comisión de PRODUCTOS del lado del servidor, contra business_settings, y
// completa la diferencia — nunca resta nada, nunca inventa un % sin
// override activo, nunca toca comisiones de SERVICIOS.
describe("Red de seguridad server-side para comisión de productos (venta de Alan Repila a Alejandro)", () => {
  const employeeId = "alejandro";
  const commissionsMap: EmployeeCommissionMap = {
    alejandro: {
      "pomada-ambush": { mode: "percent", value: "10", enabled: true },
      "cera-fija": { mode: "fixed", value: "2000", enabled: true },
      "producto-desactivado": { mode: "percent", value: "20", enabled: false },
    },
  };

  it("producto con comisión porcentual: 10% de $29.000 = $2.900 (el caso real de Alan Repila)", () => {
    const { pctAmount, fixedAmount } = computeCommissionAmount(
      [{ amount: 29000, qty: 1, serviceId: "pomada-ambush", isCatalog: true }],
      employeeId,
      commissionsMap,
      { commissionPct: 50, commissionFixed: 0 }, // % general de servicios: nunca debe aplicar a un producto
    );
    expect(Math.round(pctAmount + fixedAmount)).toBe(2900);
  });

  it("producto con comisión fija: monto fijo configurado, independiente del precio", () => {
    const { pctAmount, fixedAmount } = computeCommissionAmount(
      [{ amount: 99999, qty: 1, serviceId: "cera-fija", isCatalog: true }],
      employeeId,
      commissionsMap,
      { commissionPct: 50, commissionFixed: 0 },
    );
    expect(Math.round(pctAmount + fixedAmount)).toBe(2000);
  });

  it("producto SIN comisión configurada: $0 — nunca cae al % general de servicios", () => {
    const { pctAmount, fixedAmount } = computeCommissionAmount(
      [{ amount: 50000, qty: 1, serviceId: "sin-configurar", isCatalog: true }],
      employeeId,
      commissionsMap,
      { commissionPct: 50, commissionFixed: 0 },
    );
    expect(pctAmount + fixedAmount).toBe(0);
  });

  it("producto con override desactivado (enabled:false): $0, igual que sin configurar", () => {
    const { pctAmount, fixedAmount } = computeCommissionAmount(
      [{ amount: 50000, qty: 1, serviceId: "producto-desactivado", isCatalog: true }],
      employeeId,
      commissionsMap,
      { commissionPct: 50, commissionFixed: 0 },
    );
    expect(pctAmount + fixedAmount).toBe(0);
  });

  it("venta con descuento: la comisión porcentual se calcula sobre el neto (bruto - descuento atribuido)", () => {
    const { pctAmount, fixedAmount } = computeCommissionAmount(
      [{ amount: 29000, qty: 1, serviceId: "pomada-ambush", isCatalog: true, discountAmount: 9000 }],
      employeeId,
      commissionsMap,
      { commissionPct: 50, commissionFixed: 0 },
    );
    // (29000 - 9000) * 10% = 2000, no 2900 — el descuento SÍ se contempla.
    expect(Math.round(pctAmount + fixedAmount)).toBe(2000);
  });

  it("profesional nuevo (sin entradas previas en el mapa) con override propio: funciona igual, sin hardcodear ningún id", () => {
    const freshEmployeeId = "profesional-recien-creado";
    const freshMap: EmployeeCommissionMap = {
      [freshEmployeeId]: { "pomada-ambush": { mode: "percent", value: "15", enabled: true } },
    };
    const { pctAmount, fixedAmount } = computeCommissionAmount(
      [{ amount: 29000, qty: 1, serviceId: "pomada-ambush", isCatalog: true }],
      freshEmployeeId,
      freshMap,
      { commissionPct: 0, commissionFixed: 0 },
    );
    expect(Math.round(pctAmount + fixedAmount)).toBe(4350);
  });
});

describe("register-payment.ts — manda el detalle de productos al RPC para la red de seguridad", () => {
  const src = readSrc("src/components/cash-register/register-payment.ts");

  it("construye productCommissionLines (id + net_amount, bruto menos descuento) solo con ítems de catálogo", () => {
    expect(src).toMatch(/\.filter\(\(item\) => item\.isCatalog && item\.serviceId\)/);
    expect(src).toMatch(/net_amount:/);
  });

  it("manda p_product_commission_lines, p_commission_amount_products y p_commission_amount_services al RPC", () => {
    const rpcCallMatch = src.match(/supabase\.rpc\("register_sale"[\s\S]*?\}\);/);
    expect(rpcCallMatch).not.toBeNull();
    expect(rpcCallMatch![0]).toMatch(/p_product_commission_lines: productCommissionLines/);
    expect(rpcCallMatch![0]).toMatch(/p_commission_amount_products: productCommissionAmount/);
    expect(rpcCallMatch![0]).toMatch(/p_commission_amount_services: commissionAmount - productCommissionAmount/);
    // commissionAmount (el total combinado, cálculo de siempre) viaja SIN
    // cambios — la red de seguridad solo puede sumar, nunca reemplazarlo.
    expect(rpcCallMatch![0]).toMatch(/p_commission_amount: commissionAmount,/);
  });

  it("no toca computeCommissionAmount en sí — sigue siendo la única fuente de cálculo del lado del cliente", () => {
    expect(src).toMatch(/import\s*\{\s*\n?\s*normalizeClientKeys,\s*\n?\s*computeCommissionAmount,/);
  });
});

describe("Migración register_sale (red de seguridad de comisión de productos)", () => {
  const sql = readSrc(
    "supabase/migrations/20261029010000_register_sale_product_commission_safety_net.sql",
  );

  it("agrega p_product_commission_lines como parámetro nuevo opcional (default null) — compatible con llamadores viejos", () => {
    expect(sql).toMatch(/p_product_commission_lines jsonb DEFAULT NULL::jsonb/);
  });

  it("resuelve la comisión de productos contra business_settings._employeeCommissions, nunca un % inventado", () => {
    expect(sql).toMatch(/_employeeCommissions/);
    expect(sql).toMatch(/when v_commissions_map -> \(line ->> 'id'\) is null then 0/);
  });

  it("respeta enabled:false del override (mismo criterio que el cliente)", () => {
    expect(sql).toMatch(/enabled'\)::boolean, true\) = false then 0/);
  });

  it("soporta modo fijo y porcentual, igual que computeCommissionAmount", () => {
    expect(sql).toMatch(/mode'\) = 'fixed'/);
  });

  it("v_final_commission_amount nunca es menor que lo que mandó el cliente (greatest, suma, nunca resta)", () => {
    expect(sql).toMatch(
      /v_final_commission_amount := coalesce\(p_commission_amount, 0\)\s*\n\s*\+ greatest\(0, v_server_product_commission - coalesce\(p_commission_amount_products, 0\)\)/,
    );
  });

  it("el guard de inserción usa el monto final (ya topeado), no el p_commission_amount crudo — así no se pierde una comisión que el cliente mandó en $0", () => {
    expect(sql).toMatch(/if p_employee_id is not null and v_commission_enabled and v_final_commission_amount > 0 then/);
    expect(sql).not.toMatch(/if p_employee_id is not null and v_commission_enabled and coalesce\(p_commission_amount, 0\) > 0 then/);
  });

  it("un cobro parcial prorratea sobre el monto final corregido, no sobre el original del cliente", () => {
    expect(sql).toMatch(/v_commission_increment := round\(v_final_commission_amount \* v_collected_amount \/ p_total, 2\);/);
  });

  it("mantiene el 'on conflict (sale_id) do nothing' — sigue sin poder duplicar una comisión para la misma venta", () => {
    expect(sql).toMatch(/on conflict \(sale_id\) do nothing/);
  });

  it("no toca el guard de commission_enabled=false del profesional (se sigue respetando antes de insertar nada)", () => {
    expect(sql).toMatch(/v_commission_enabled boolean := true/);
    expect(sql).toMatch(/select coalesce\(e\.commission_enabled, true\) into v_commission_enabled/);
  });

  it("no define ni toca void_tip_and_commission_on_payment_status (la reversión de comisión al anular sigue siendo ese trigger, sin cambios)", () => {
    expect(sql).not.toMatch(/void_tip_and_commission_on_payment_status/);
    expect(sql).not.toMatch(/status = 'voided'/);
  });

  it("dropea la firma vieja de register_sale (31 params) antes de recrearla con el nuevo parámetro — evita dejar dos funciones sobrecargadas", () => {
    expect(sql).toMatch(/drop function if exists public\.register_sale\(/);
  });
});
