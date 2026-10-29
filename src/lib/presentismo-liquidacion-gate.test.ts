import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const sql = readSrc("supabase/migrations/20261029070000_prepare_settlement_run_pending_cierres_gate.sql");

// Validado end-to-end contra producción (transacciones con rollback): un
// profesional sin liquidaciones previas, con cajas pendientes reales en
// el rango, queda bloqueado con el listado exacto de fechas; un
// profesional con liquidaciones recientes y sin pendientes en su período
// sigue liquidando normal (se creó un settlement_runs real de prueba y se
// deshizo). Estos tests fijan esas garantías en el contenido de la
// migración.
describe("Gate de liquidación por cajas pendientes — prepare_settlement_run", () => {
  it("resuelve branch_id del profesional (antes no se leía en absoluto)", () => {
    expect(sql).toMatch(
      /select e\.full_name, e\.branch_id into v_professional_name, v_branch_id/,
    );
  });

  it("el chequeo corre DESPUÉS de resolver v_period_start_at y ANTES de calcular cualquier comisión", () => {
    const periodIdx = sql.indexOf("v_period_start_at := v_previous_run.prepared_at;");
    const gateIdx = sql.indexOf("get_pending_cierres_in_period(");
    const commissionsIdx = sql.indexOf("-- Comisiones NORMALES");
    expect(periodIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(periodIdx);
    expect(commissionsIdx).toBeGreaterThan(gateIdx);
  });

  it("usa get_pending_cierres_in_period — misma fuente que el aviso de la UI, nunca un criterio propio", () => {
    expect(sql).toMatch(
      /from public\.get_pending_cierres_in_period\(\s*\n\s*p_business_id, v_branch_id, coalesce\(v_period_start_at::date, '2000-01-01'::date\), v_cutoff_date\s*\n\s*\);/,
    );
  });

  it("el rango empieza en '2000-01-01' solo si el profesional nunca tuvo una liquidación previa (coalesce), nunca ignora su período real", () => {
    expect(sql).toMatch(/coalesce\(v_period_start_at::date, '2000-01-01'::date\)/);
  });

  it("el mensaje de error incluye las fechas pendientes formateadas DD/MM/YYYY, ordenadas", () => {
    expect(sql).toMatch(/string_agg\(to_char\(fecha, 'DD\/MM\/YYYY'\), ', ' order by fecha\)/);
    expect(sql).toMatch(
      /raise exception 'No se puede realizar la liquidación: existen cajas pendientes de cierre dentro del período seleccionado \(%\)\.', v_pending_cierres;/,
    );
  });

  it("no llama a register_professional_advance (solo se lo menciona en el comentario explicativo) — los adelantos siguen sin depender de ningún cierre", () => {
    expect(sql).not.toMatch(/select\s+public\.register_professional_advance|perform\s+public\.register_professional_advance/);
  });

  it("no cambia ninguna otra fórmula existente (comisiones, propinas, deducciones, total) — solo agrega el gate", () => {
    expect(sql).toMatch(/v_new_commissions := v_new_commissions_services \+ v_new_commissions_products;/);
    expect(sql).toMatch(
      /v_total := v_previous_balance \+ v_new_commissions \+ v_recovered_commissions/,
    );
  });
});

describe("Frontend — aviso de liquidación bloqueada (Caja > Liquidaciones)", () => {
  const tsSrc = readSrc("src/routes/cash-register.tsx");

  it("hace un chequeo previo con getPendingCierresInPeriod antes de llamar a prepare_settlement_run", () => {
    expect(tsSrc).toMatch(/getPendingCierresInPeriod\(/);
  });

  it("el RPC sigue siendo la validación real — el chequeo previo nunca reemplaza la llamada a prepare_settlement_run", () => {
    expect(tsSrc).toMatch(/supabase\.rpc\("prepare_settlement_run" as any/);
  });

  it("el aviso tiene el botón 'Ir a cierre de caja' que navega a la pestaña Cierres", () => {
    expect(tsSrc).toMatch(/Ir a cierre de caja/);
    expect(tsSrc).toMatch(/onGoToCierres\(\)/);
    expect(tsSrc).toMatch(/onGoToCierres=\{\(\) => setTab\("cierres"\)\}/);
  });

  it("el aviso tiene el botón 'Cancelar'", () => {
    const modalMatch = tsSrc.match(/No se puede realizar la liquidación[\s\S]*?Ir a cierre de caja[\s\S]*?Cancelar/);
    expect(modalMatch).not.toBeNull();
  });
});
