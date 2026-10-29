import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const linkageSql = readSrc("supabase/migrations/20261029080000_presentismo_settlement_linkage.sql");
const prepareRunSql = readSrc("supabase/migrations/20261029090000_prepare_settlement_run_presentismo.sql");
const statusSql = readSrc("supabase/migrations/20261029100000_attendance_adjustments_status.sql");
const ruleSql = readSrc("supabase/migrations/20261029120000_attendance_adjustments_rule.sql");

// Validado contra producción con transacciones de rollback antes de
// aplicar: confirm_attendance con override_penalty negativo ahora
// persiste el crédito completo (antes quedaba forzado a 0); prepare_
// settlement_run absorbe el neto de presentismo del período sin volver a
// contarlo en la siguiente corrida; el historial de auditoría quedó con
// estado anterior/nuevo y la regla automática que calculó el motor.
describe("Enganche de presentismo con liquidaciones — confirm_attendance", () => {
  it("settlement_run_id nuevo en attendance_confirmations, nullable, mismo patrón que commission_records/tip_records/professional_advances", () => {
    expect(linkageSql).toMatch(
      /alter table public\.attendance_confirmations\s+add column if not exists settlement_run_id uuid references public\.settlement_runs\(id\);/,
    );
  });

  it("settlement_runs gana presentismo_adjustment/presentismo_items, mismo patrón que adjustments/deductions", () => {
    expect(linkageSql).toMatch(/add column if not exists presentismo_adjustment numeric not null default 0,/);
    expect(linkageSql).toMatch(/add column if not exists presentismo_items jsonb;/);
  });

  it("override_penalty negativo ya NO queda forzado a 0 — solo se topea el lado positivo (descuento)", () => {
    expect(linkageSql).not.toMatch(/greatest\(0,\s*v_discount\)/);
    expect(linkageSql).toMatch(/if v_discount > 0 then\s*\n\s*v_discount := least\(v_discount, coalesce\(v_computed\.commission_services_available, 0\)\);/);
  });

  it("el tope por comisión disponible sigue aplicando solo al descuento (nunca al crédito)", () => {
    const idx = linkageSql.indexOf("if v_discount > 0 then");
    expect(idx).toBeGreaterThan(-1);
    expect(linkageSql.slice(idx, idx + 200)).toMatch(/least\(v_discount, coalesce\(v_computed\.commission_services_available, 0\)\)/);
  });
});

describe("prepare_settlement_run — absorción de presentismo en Total a pagar", () => {
  it("suma el neto de attendance_confirmations.discount_amount_applied del período, sin settlement_run_id previo", () => {
    expect(prepareRunSql).toMatch(/coalesce\(sum\(ac\.discount_amount_applied\), 0\)/);
    expect(prepareRunSql).toMatch(/from public\.attendance_confirmations ac\s*\n\s*where ac\.business_id = p_business_id\s*\n\s*and ac\.employee_id = p_professional_id\s*\n\s*and ac\.settlement_run_id is null/);
  });

  it("usa la misma ventana por fecha (ac.date) que el resto de comisiones/propinas del período, nunca confirmed_at", () => {
    expect(prepareRunSql).toMatch(/and \(v_period_start is null or ac\.date > v_period_start\)\s*\n\s*and ac\.date <= v_cutoff_date/);
  });

  it("resta v_presentismo_adjustment de Total a pagar exactamente igual que ajustes/deducciones/adelantos existentes", () => {
    expect(prepareRunSql).toMatch(
      /v_total := v_previous_balance \+ v_new_commissions \+ v_recovered_commissions\s*\n\s*\+ v_new_tips \+ v_recovered_tips \+ v_adjustments - v_deductions - v_advances - v_presentismo_adjustment;/,
    );
  });

  it("presentismo entra en el disponible-para-deducciones de 'venta anulada', como cualquier otro descuento ya comprometido", () => {
    expect(prepareRunSql).toMatch(
      /v_available_for_deduction := v_previous_balance \+ v_new_commissions \+ v_recovered_commissions\s*\n\s*\+ v_new_tips \+ v_recovered_tips \+ v_adjustments - v_deductions - v_advances - v_presentismo_adjustment;/,
    );
  });

  it("settlement_runs guarda presentismo_adjustment/presentismo_items del run (para que Historial no tenga que recalcular nada)", () => {
    expect(prepareRunSql).toMatch(/presentismo_adjustment, presentismo_items,/);
    expect(prepareRunSql).toMatch(/v_presentismo_adjustment, v_presentismo_items,/);
  });

  it("marca TODAS las confirmaciones del período como absorbidas (incluidas las de $0 'a tiempo'), sin filtrar por discount_amount_applied <> 0", () => {
    const updateIdx = prepareRunSql.indexOf("update public.attendance_confirmations ac\n    set settlement_run_id = v_run.id");
    expect(updateIdx).toBeGreaterThan(-1);
    const updateBlock = prepareRunSql.slice(updateIdx, prepareRunSql.indexOf(";", updateIdx));
    expect(updateBlock).not.toMatch(/discount_amount_applied/);
  });

  it("nunca toca work_sessions ni attendance_adjustments — solo marca settlement_run_id en attendance_confirmations", () => {
    const updateIdx = prepareRunSql.indexOf("-- Bloquea TODAS las confirmaciones de presentismo del período absorbido");
    const nextSectionIdx = prepareRunSql.indexOf("-- \"Venta anulada\" (deducción o crédito): recién ACA");
    const block = prepareRunSql.slice(updateIdx, nextSectionIdx);
    expect(block).not.toMatch(/update public\.work_sessions/);
    expect(block).not.toMatch(/update public\.attendance_adjustments/);
  });

  it("el gate de cajas pendientes de la Fase E sigue intacto (no se reemplazó por el cambio de presentismo)", () => {
    expect(prepareRunSql).toMatch(/No se puede realizar la liquidación: existen cajas pendientes de cierre dentro del período seleccionado/);
  });
});

describe("attendance_adjustments — historial de auditoría completo (estado + regla automática)", () => {
  it("agrega previous_status/new_status, nullable (no rompe filas ya grabadas)", () => {
    expect(statusSql).toMatch(/add column if not exists previous_status text,/);
    expect(statusSql).toMatch(/add column if not exists new_status text;/);
  });

  it("confirm_attendance puebla previous_status/new_status con v_prev.status/v_row.status", () => {
    expect(statusSql).toMatch(/previous_discount_amount, new_discount_amount, previous_status, new_status,/);
    expect(statusSql).toMatch(/v_prev\.discount_amount_applied, v_row\.discount_amount_applied,\s*\n\s*v_prev\.status, v_row\.status,/);
  });

  it("agrega rule_id (regla automática original calculada por el motor, sin importar si la acción fue un override)", () => {
    expect(ruleSql).toMatch(/add column if not exists rule_id uuid references public\.lateness_rules\(id\);/);
  });

  it("confirm_attendance puebla attendance_adjustments.rule_id con v_computed.rule_id (nunca el rule_id ya congelado del override)", () => {
    expect(ruleSql).toMatch(/previous_status, new_status, rule_id,\s*\n\s*performed_by, performed_by_name/);
    expect(ruleSql).toMatch(/v_prev\.status, v_row\.status, v_computed\.rule_id,/);
  });

  it("el log de auditoría sigue sin ningún UPDATE/DELETE en estas migraciones — append-only se mantiene", () => {
    for (const sql of [statusSql, ruleSql]) {
      expect(sql).not.toMatch(/update\s+public\.attendance_adjustments/i);
      expect(sql).not.toMatch(/delete\s+from\s+public\.attendance_adjustments/i);
    }
  });
});
