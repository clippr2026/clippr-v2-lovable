import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PRESENTISMO_SYSTEM_START_DATE, attendanceSystemAppliesToDate } from "./presentismo";

const repoRoot = path.resolve(__dirname, "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const sql = readSrc("supabase/migrations/20261029130000_attendance_system_start_date.sql");

// Validado contra producción con una transacción de rollback: cerrar un día
// de antes del corte nunca pide presentismo ni genera snapshot; confirmar
// presentismo de un día de antes del corte se rechaza; el gate de cajas
// pendientes de prepare_settlement_run/get_pending_cierres_in_period sigue
// sin tocarse, aplica a cualquier período sin importar la fecha.
describe("Corte del sistema de presentismo/tardanza — 29/10/2026", () => {
  it("attendance_system_start_date() es una sola función, fuente única para el trigger y confirm_attendance", () => {
    expect(sql).toMatch(
      /create or replace function public\.attendance_system_start_date\(\)\s*\nreturns date language sql immutable as \$\$\s*\n\s*select date '2026-10-29'/,
    );
  });

  it("el trigger de cierre corta ANTES de pedir presentismo, pero DESPUÉS de confirmar que es un cierre real (nunca ignora reaperturas/correcciones)", () => {
    const realCierreIdx = sql.indexOf("if coalesce(NEW.eventos -> -1 ->> 'tipo', '')");
    const cutoffIdx = sql.indexOf("if NEW.fecha < public.attendance_system_start_date()");
    const missingCheckIdx = sql.indexOf("select string_agg(e.full_name");
    expect(realCierreIdx).toBeGreaterThan(-1);
    expect(cutoffIdx).toBeGreaterThan(realCierreIdx);
    expect(missingCheckIdx).toBeGreaterThan(cutoffIdx);
  });

  it("para un día anterior al corte, el trigger devuelve NEW sin tocar presentismo_snapshot (no genera snapshot de algo que no existe)", () => {
    const cutoffIdx = sql.indexOf("if NEW.fecha < public.attendance_system_start_date() then");
    const returnIdx = sql.indexOf("return NEW;", cutoffIdx);
    const snapshotIdx = sql.indexOf("into NEW.presentismo_snapshot");
    expect(cutoffIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(cutoffIdx);
    expect(returnIdx).toBeLessThan(snapshotIdx);
  });

  it("confirm_attendance rechaza explícitamente confirmar una jornada anterior al corte, con mensaje en español con la fecha", () => {
    expect(sql).toMatch(/if p_date < public\.attendance_system_start_date\(\) then/);
    expect(sql).toMatch(
      /raise exception 'El sistema de presentismo aplica desde el %, no se puede confirmar una jornada anterior\.',\s*\n\s*to_char\(public\.attendance_system_start_date\(\), 'DD\/MM\/YYYY'\);/,
    );
  });

  it("el chequeo del corte en confirm_attendance corre DESPUÉS de validar acción/motivo/importe, pero ANTES de calcular o insertar nada", () => {
    const reasonCheckIdx = sql.indexOf("if coalesce(trim(p_reason), '') = '' then");
    const cutoffIdx = sql.lastIndexOf("if p_date < public.attendance_system_start_date()");
    const computeIdx = sql.indexOf("select * into v_computed");
    expect(reasonCheckIdx).toBeGreaterThan(-1);
    expect(cutoffIdx).toBeGreaterThan(reasonCheckIdx);
    expect(computeIdx).toBeGreaterThan(cutoffIdx);
  });

  it("no toca get_pending_cierres_in_period ni prepare_settlement_run (solo se los menciona en el comentario explicativo) — el gate de cajas pendientes queda intacto para cualquier período", () => {
    expect(sql).not.toMatch(/create (or replace )?function public\.(get_pending_cierres_in_period|prepare_settlement_run)/);
    expect(sql).not.toMatch(/select\s+public\.(get_pending_cierres_in_period|prepare_settlement_run)|perform\s+public\.(get_pending_cierres_in_period|prepare_settlement_run)|from\s+public\.(get_pending_cierres_in_period|prepare_settlement_run)/);
  });

  it("solo recrea funciones (CREATE OR REPLACE FUNCTION) — fuera de los cuerpos ($$...$$, que sí tienen insert/update como parte normal de confirm_attendance), no queda ninguna sentencia DML suelta", () => {
    const outsideBodies = sql.replace(/\$\$[\s\S]*?\$\$/g, "$$BODY$$");
    expect(outsideBodies).not.toMatch(/\bupdate\s+public\./i);
    expect(outsideBodies).not.toMatch(/\bdelete\s+from\s+public\./i);
    expect(outsideBodies).not.toMatch(/\binsert\s+into\s+public\./i);
    expect(outsideBodies.match(/create or replace function/gi)?.length).toBe(3);
  });
});

describe("Frontend — PRESENTISMO_SYSTEM_START_DATE (src/lib/presentismo.ts)", () => {
  it("coincide exactamente con la fecha de corte de la base", () => {
    expect(PRESENTISMO_SYSTEM_START_DATE).toBe("2026-10-29");
  });

  it("attendanceSystemAppliesToDate: false antes del corte, true desde el corte en adelante", () => {
    expect(attendanceSystemAppliesToDate("2026-10-28")).toBe(false);
    expect(attendanceSystemAppliesToDate("2026-01-01")).toBe(false);
    expect(attendanceSystemAppliesToDate("2026-10-29")).toBe(true);
    expect(attendanceSystemAppliesToDate("2026-10-30")).toBe(true);
    expect(attendanceSystemAppliesToDate("2027-01-01")).toBe(true);
  });
});

describe("CierreCajaBtn — no exige ni muestra presentismo para un día anterior al corte", () => {
  const tsSrc = readSrc("src/routes/cash-register.tsx");

  it("calcula presentismoApplies con attendanceSystemAppliesToDate(cajaRangeStartDate)", () => {
    expect(tsSrc).toMatch(/const presentismoApplies = attendanceSystemAppliesToDate\(cajaRangeStartDate\);/);
  });

  it("si no aplica, presentismoPending se fija en [] directamente (nunca null/'verificando' para un día que no lo necesita)", () => {
    expect(tsSrc).toMatch(/setPresentismoPending\(presentismoApplies \? null : \[\]\);/);
  });

  it("el paso previo (puntualidad) solo se muestra desde el corte; antes de esa fecha no se pide nada", () => {
    const step = readSrc("src/components/cash-register/cierre-prerequisitos-step.tsx");
    expect(step).toContain('const PRESENTISMO_START_DATE = "2026-10-29";');
    expect(step).toContain("const applies = date >= PRESENTISMO_START_DATE;");
    expect(step).toMatch(/useState<string\[\] \| null>\(applies \? null : \[\]\)/);
    expect(step).toMatch(/\{applies && profileId && \(/);
  });

  it("'Continuar' sigue sin habilitarse mientras haya puntualidad sin confirmar (el candado real es el trigger SQL)", () => {
    const step = readSrc("src/components/cash-register/cierre-prerequisitos-step.tsx");
    expect(step).toContain("disabled={cargando || pendientes > 0}");
    expect(tsSrc).toMatch(/onClick=\{\(\) => setPrereqStep\(true\)\}/);
  });
});
