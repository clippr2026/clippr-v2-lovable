import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const sql = readSrc("supabase/migrations/20261029040000_caja_cierre_presentismo_trigger.sql");
// Versión final de check_attendance_confirmed_before_close (reemplaza la
// función de arriba, mismo trigger) — agrega la foto atómica de
// presentismo en el mismo instante de la validación, sin el paso
// separado por el cliente que dejaba una ventana de carrera.
const atomicSql = readSrc("supabase/migrations/20261029060000_caja_cierre_presentismo_atomic_snapshot.sql");
const backlinkSql = readSrc("supabase/migrations/20261029050000_caja_cierre_presentismo_backlink.sql");

// Validado end-to-end contra producción (en transacciones con rollback,
// nunca confirmadas) antes de activar el trigger real: reabrir caja no
// bloquea, una corrección vieja sobre un día ya cerrado no bloquea, y un
// cierre real de hoy sin presentismo confirmado SÍ bloquea con los
// nombres exactos de quienes faltan. Estos tests fijan esas garantías en
// el contenido de la migración para que nadie las rompa sin querer.
describe("Trigger de bloqueo de cierre — invariantes de diseño", () => {
  it("NO dispara sobre estado='cerrada' (ese valor prácticamente nunca cambia — ver 'Reabrir caja', que lo deja intacto)", () => {
    expect(sql).not.toMatch(/if\s+NEW\.estado/);
  });

  it("dispara únicamente cuando el ÚLTIMO evento (tras este write) es de tipo 'cierre' — ignora 'reapertura' y 'correccion'", () => {
    expect(sql).toMatch(
      /if coalesce\(NEW\.eventos -> -1 ->> 'tipo', ''\) is distinct from 'cierre' then\s*\n\s*return NEW;/,
    );
  });

  it("usa get_scheduled_professionals_for_date — nunca una lista de profesionales hardcodeada ni distinta a la del panel de revisión", () => {
    expect(sql).toMatch(/get_scheduled_professionals_for_date\(NEW\.business_id, NEW\.branch_id, NEW\.fecha\)/);
  });

  it("el mensaje de error incluye los nombres de los profesionales faltantes (para que el error crudo, si llega a verse, siga siendo accionable)", () => {
    expect(sql).toMatch(/raise exception 'No se puede cerrar: presentismo sin confirmar para %', v_missing;/);
  });

  it("se instala como BEFORE INSERT OR UPDATE — bloquea antes de escribir, nunca después (sin dejar la fila a medio guardar)", () => {
    expect(sql).toMatch(/before insert or update on public\.caja_cierres/);
  });

  it("no modifica ni borra ningún dato existente — solo crea función y trigger", () => {
    expect(sql).not.toMatch(/\bupdate\s+public\.caja_cierres\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
  });
});

// Validado end-to-end contra producción (transacciones con rollback): un
// cierre real arma la foto con las 6 confirmaciones completas SIN que el
// cliente la mande, y una corrección posterior (override_penalty) nunca
// toca esa foto ya congelada — solo attendance_confirmations (vigente) y
// attendance_adjustments (auditoría) cambian.
describe("Foto de presentismo atómica (reemplaza check_attendance_confirmed_before_close)", () => {
  it("arma NEW.presentismo_snapshot en el MISMO trigger que valida — nunca un fetch separado desde el cliente", () => {
    expect(atomicSql).toMatch(/into NEW\.presentismo_snapshot/);
    expect(atomicSql).toMatch(/from public\.attendance_confirmations ac/);
  });

  it("la foto se arma DESPUÉS de pasar la validación (mismo orden: primero bloquear si falta alguien, después fotografiar)", () => {
    const raiseIdx = atomicSql.indexOf("raise exception");
    const snapshotIdx = atomicSql.indexOf("into NEW.presentismo_snapshot");
    expect(raiseIdx).toBeGreaterThan(-1);
    expect(snapshotIdx).toBeGreaterThan(raiseIdx);
  });

  it("sigue sin disparar sobre estado='cerrada' — mismo criterio corregido (último evento, no estado)", () => {
    expect(atomicSql).not.toMatch(/if\s+NEW\.estado/);
    expect(atomicSql).toMatch(/coalesce\(NEW\.eventos -> -1 ->> 'tipo', ''\) is distinct from 'cierre'/);
  });

  it("caja-cierre.ts ya no arma presentismo_snapshot en el cliente (se lo dejó enteramente al trigger)", () => {
    const tsSrc = readSrc("src/lib/caja-cierre.ts");
    expect(tsSrc).not.toMatch(/presentismoSnapshot/);
    expect(tsSrc).not.toMatch(/presentismo_snapshot:/);
  });
});

describe("Backlink attendance_confirmations.caja_cierre_id (trazabilidad inversa)", () => {
  it("es security definer — attendance_confirmations no tiene policy de UPDATE para el cliente a propósito", () => {
    expect(backlinkSql).toMatch(/security definer/);
  });

  it("solo actualiza cuando el último evento es 'cierre' — mismo criterio que el trigger de bloqueo", () => {
    expect(backlinkSql).toMatch(/coalesce\(NEW\.eventos -> -1 ->> 'tipo', ''\) is distinct from 'cierre'/);
  });

  it("es AFTER (no BEFORE) — corre una vez que la fila de caja_cierres ya tiene id definitivo", () => {
    expect(backlinkSql).toMatch(/after insert or update on public\.caja_cierres/);
  });
});
