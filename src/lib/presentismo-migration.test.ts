import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const sql = readSrc("supabase/migrations/20261029030000_presentismo_schema.sql");

// Validado manualmente contra datos reales de producción (en una
// transacción con rollback, sin tocar nada) antes de aplicar esta
// migración: get_scheduled_professionals_for_date, _compute_attendance,
// is_caja_closed_now (incluidos los 2 casos límite reales encontrados —
// un día cerrado con una 'correccion' anotada después, y un día
// 'reabierta' nunca vuelto a cerrar) y get_pending_cierres_in_period ya
// dieron los resultados esperados. Estos tests son de contenido del
// archivo de migración — aseguran que nadie reintroduzca, sin querer, los
// bugs que motivaron este diseño.
describe("Migración de Presentismo — invariantes de diseño", () => {
  it("attendance_confirmations tiene UNIQUE por (business_id, employee_id, date) — nunca 2 confirmaciones vigentes para la misma jornada", () => {
    expect(sql).toMatch(/constraint attendance_confirmations_unique_per_day unique \(business_id, employee_id, date\)/);
  });

  it("attendance_adjustments no tiene ninguna policy de insert/update/delete directo — append-only real, no solo de palabra", () => {
    const table = sql.match(/create table public\.attendance_adjustments[\s\S]*?(?=create index|$)/)?.[0] ?? "";
    expect(table).not.toMatch(/for insert|for update|for delete/);
    // La única policy de esta tabla en todo el archivo debe ser de select.
    const policiesOnAdjustments = sql.match(/create policy attendance_adjustments_\w+[\s\S]*?;/g) ?? [];
    expect(policiesOnAdjustments.length).toBe(1);
    expect(policiesOnAdjustments[0]).toMatch(/for select/);
  });

  it("reason es NOT NULL en attendance_adjustments — motivo obligatorio en TODAS las acciones, no solo correcciones", () => {
    expect(sql).toMatch(/reason text not null,/);
  });

  it("confirm_attendance exige motivo no vacío sin importar la acción", () => {
    const fn = sql.match(/create or replace function public\.confirm_attendance[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/if coalesce\(trim\(p_reason\), ''\) = '' then\s*\n\s*raise exception 'El motivo es obligatorio';/);
  });

  it("confirm_attendance bloquea que un profesional confirme su propio presentismo", () => {
    const fn = sql.match(/create or replace function public\.confirm_attendance[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/if v_caller_role = 'profesional' then/);
  });

  it("_compute_attendance resuelve la regla por UMBRAL más alto alcanzado (min_minutes <= v_late, order by min_minutes desc limit 1) — nunca por rango [min,max]", () => {
    const fn = sql.match(/create or replace function public\._compute_attendance[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/where lr\.branch_id = p_branch_id and lr\.min_minutes <= v_late and v_late > 0/);
    expect(fn).toMatch(/order by lr\.min_minutes desc\s*\n\s*limit 1;/);
    expect(fn).not.toMatch(/max_minutes/);
  });

  it("_compute_attendance usa comisión de SERVICIOS (amount_services), nunca la bruta (amount con productos)", () => {
    const fn = sql.match(/create or replace function public\._compute_attendance[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/coalesce\(sum\(coalesce\(cr\.amount_services, cr\.amount\)\), 0\)/);
  });

  it("is_caja_closed_now NO usa estado='cerrada' — usa el último evento de tipo cierre/reapertura, ignorando 'correccion'", () => {
    const fn = sql.match(/create or replace function public\.is_caja_closed_now[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).not.toMatch(/estado\s*=\s*'cerrada'/);
    expect(fn).toMatch(/elem ->> 'tipo' in \('cierre', 'reapertura'\)/);
  });

  it("get_pending_cierres_in_period excluye días sin actividad real (payments no anulados/reembolsados + expenses)", () => {
    const fn = sql.match(/create or replace function public\.get_pending_cierres_in_period[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/pm\.status not in \('anulado', 'reembolsado'\)/);
    expect(fn).toMatch(/is_caja_closed_now/);
  });

  it("get_scheduled_professionals_for_date exige start Y end configurados (mismo criterio que normalizeEmployeeSchedule — un día sin ambos se descarta entero)", () => {
    const fn = sql.match(/create or replace function public\.get_scheduled_professionals_for_date[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/\(d\.day_cfg ->> 'start'\) is not null/);
    expect(fn).toMatch(/\(d\.day_cfg ->> 'end'\) is not null/);
  });

  it("presentismo_snapshot se agrega como columna nueva en caja_cierres, sin alterar ninguna existente", () => {
    expect(sql).toMatch(/alter table public\.caja_cierres add column if not exists presentismo_snapshot jsonb;/);
  });

  it("no toca work_sessions, lateness_rules ni lateness_discounts (solo tablas/funciones nuevas + 1 columna aditiva)", () => {
    expect(sql).not.toMatch(/alter table public\.work_sessions/);
    expect(sql).not.toMatch(/alter table public\.lateness_rules/);
    expect(sql).not.toMatch(/alter table public\.lateness_discounts/);
    expect(sql).not.toMatch(/drop table/);
  });
});
