import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Bug real en producción: Inicio mostraba la facturación del 16/10
// ($681.100) el 17/10, mientras Caja → Resumen ya mostraba $0 para el
// día correcto. Causa raíz, en dos capas:
//   1. dashboard.tsx extendía `range.from` hacia atrás hasta la fecha de
//      la caja pendiente más vieja (cajaHoy.pendingCierre?.date) en vez
//      de usar siempre "hoy" — mezclando el backlog pendiente con los
//      indicadores diarios.
//   2. use-dashboard-data.ts calculaba los límites del día con
//      today.setHours(0,0,0,0)/todayEnd.setHours(23,59,59,999), que
//      reinterpreta la hora en el huso del RUNTIME (UTC en un server
//      serverless), no en America/Argentina/Buenos_Aires — corriendo el
//      rango real ~3 horas.
// Estos tests son regresiones estructurales: si alguno de los dos
// patrones vuelve a aparecer, fallan acá en vez de reaparecer en
// producción.

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

describe("use-dashboard-data.ts — límites del día en huso Buenos Aires, nunca el del runtime", () => {
  it("usa dayBoundsBA/cajaDateKeyBA para los límites del día, no setHours ambiguo", () => {
    const src = readSrc("src/components/dashboard/use-dashboard-data.ts");
    const fnMatch = src.match(/async function loadDashboard\(([\s\S]*?)const expenseTo = toKey;/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/dayBoundsBA\(/);
    expect(fnMatch![1]).toMatch(/cajaDateKeyBA\(/);
    expect(fnMatch![1]).not.toMatch(/setHours\(0,\s*0,\s*0,\s*0\)/);
    expect(fnMatch![1]).not.toMatch(/setHours\(23,\s*59,\s*59/);
  });

  it("expenseFrom/expenseTo ya no se derivan de .toISOString().slice(0,10) (corre un día en el límite del día BA)", () => {
    const src = readSrc("src/components/dashboard/use-dashboard-data.ts");
    expect(src).not.toMatch(/const expenseFrom = today\.toISOString\(\)/);
    expect(src).not.toMatch(/const expenseTo = todayEnd\.toISOString\(\)/);
  });

  it("se suscribe a postgres_changes de payments y expenses (tiempo real, sin recargar la página)", () => {
    const src = readSrc("src/components/dashboard/use-dashboard-data.ts");
    const fnMatch = src.match(/export function useDashboardData\(([\s\S]*?)\n}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/table:\s*"payments"/);
    expect(fnMatch![1]).toMatch(/table:\s*"expenses"/);
    expect(fnMatch![1]).toMatch(/invalidateQueries/);
  });
});

describe("dashboard.tsx — 'Caja de hoy' nunca se extiende a una jornada pendiente", () => {
  it("range ya no depende de pendingCierre — siempre es el día de hoy en huso Buenos Aires", () => {
    const src = readSrc("src/routes/dashboard.tsx");
    const fnMatch = src.match(/function DashboardContent\(([\s\S]*?)\n {2}const \{ data, isLoading, error \}/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).not.toMatch(/pendingCierre\?\.date/);
    expect(fnMatch![1]).toMatch(/dayBoundsBA\(todayKeyBA\)/);
  });

  it("Ingresos/Egresos/Utilidad de CajaHoyCard salen de `caja` (useCajaSummary), nunca de `data` (useDashboardData) — una sola fuente de verdad", () => {
    const src = readSrc("src/routes/dashboard.tsx");
    const fnMatch = src.match(/function CajaHoyCard\(([\s\S]*?)\n {2}return \(/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).not.toMatch(/data\.revHoy|data\.totalGastos|data\.utilidad/);
  });

  it("existe un mecanismo de actualización automática al cambiar de día (useTodayKeyBA)", () => {
    const src = readSrc("src/routes/dashboard.tsx");
    expect(src).toMatch(/function useTodayKeyBA/);
    expect(src).toMatch(/setTimeout/);
  });
});
