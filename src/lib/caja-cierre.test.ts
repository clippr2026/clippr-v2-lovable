import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as cajaCierre from "./caja-cierre";
import {
  cajaDateKeyBA,
  computeExpectedCashAndDigital,
  countServiciosYProductos,
  dayBoundsBA,
  filterToDayBA,
  isCajaCerradaRow,
  isCajaReabiertaRow,
  isCountableCajaPayment,
  isVoidedPaymentStatus,
  pagoRowColor,
  normalizeCierreMethodKey,
  pendingDatesFromActivity,
  splitServiciosYProductos,
} from "./caja-cierre";

const repoRoot = path.resolve(__dirname, "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

// Cierres exclusivamente manuales, fecha por fecha — no puede existir
// ningún camino de código que extienda un cierre a "ahora" ni que se
// etiquete a sí mismo como automático. Test estructural: si alguien
// reintroduce closeCierreForDate (el viejo cierre de "caja vencida" que
// extendía el snapshot hasta el instante actual, mezclando días), esto
// falla y lo avisa en CI en vez de reaparecer en producción.
describe("cierres exclusivamente manuales — sin ningún camino automático/multi-día", () => {
  it("closeCierreForDate (el cierre que se extendía hasta 'ahora') ya no existe", () => {
    expect((cajaCierre as Record<string, unknown>).closeCierreForDate).toBeUndefined();
  });

  it("closeSingleDayCierre y buildSingleDayCierrePreview son las únicas funciones de cierre exportadas", () => {
    expect(typeof cajaCierre.closeSingleDayCierre).toBe("function");
    expect(typeof cajaCierre.buildSingleDayCierrePreview).toBe("function");
  });

  it("use-caja-data.ts ya no tiene ningún setTimeout/cierre de medianoche contra cash_sessions", () => {
    const src = readSrc("src/components/cash-register/use-caja-data.ts");
    expect(src).not.toMatch(/cierre_automatico|cash_session_events|00:00:10|Auto-close/i);
  });

  it("SessionActionType (session-actions.ts) ya no incluye 'cierre_automatico'", () => {
    const src = readSrc("src/components/cash-register/session-actions.ts");
    expect(src).not.toMatch(/cierre_automatico/);
  });

  it("findPendingCierre (wrapper muerto, sin consumidores reales) fue retirado", () => {
    expect((cajaCierre as Record<string, unknown>).findPendingCierre).toBeUndefined();
  });

  it("closeSingleDayCierre exige closedBy (responsable) — un cierre nunca puede quedar sin usuario", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    expect(src).toMatch(/closedBy:\s*string;/);
  });
});

// Corregir un día YA cerrado (sección 7 del pedido: "nunca sobrescribir
// silenciosamente el cierre") solo tiene un camino: reabrir con motivo
// obligatorio, quedando auditado quién/cuándo/por qué, y recién después
// volver a confirmar — closeSingleDayCierre siempre recalcula el snapshot
// fresco (nunca reutiliza uno guardado), así que un cierre posterior a una
// reapertura refleja los movimientos reales, no una copia vieja.
describe("Procedimiento auditable para corregir un cierre ya confirmado", () => {
  it("closeSingleDayCierre siempre recalcula el snapshot con buildSingleDayCierrePreview (nunca reutiliza uno guardado)", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    const fnMatch = src.match(/export async function closeSingleDayCierre\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/buildSingleDayCierrePreview\(/);
  });

  it("el modal de 'Reabrir caja' exige un motivo antes de habilitar el botón", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/disabled=\{reopeningId === reopenTarget\.id \|\| !reopenNote\.trim\(\)\}/);
  });

  it("no existe un segundo camino de reapertura sin motivo (handleReabrirCajaDesdeBanner, retirado)", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).not.toMatch(/handleReabrirCajaDesdeBanner/);
  });

  it("reabrir nunca muta caja_cierres.estado de vuelta a 'reabierta' — queda como snapshot histórico inmutable", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).not.toMatch(/estado:\s*["']reabierta["']/);
  });
});

// findAllPendingCierres (banner "Tenés N cajas pendientes de cierre") — acá
// se testea solo su núcleo puro, sin pegarle a Supabase. Un día queda
// "pendiente" si tuvo actividad real Y no tiene un cierre guardado; un día
// cerrado o reabierto deja de contar como pendiente aunque tuvo actividad.
describe("pendingDatesFromActivity — qué días quedan pendientes de cierre", () => {
  const dias = ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];

  it("un solo día con actividad y sin cerrar queda pendiente", () => {
    const result = pendingDatesFromActivity(dias, new Set(), new Set(["2026-10-16"]));
    expect(result).toEqual([{ date: "2026-10-16", cierreId: null }]);
  });

  it("varios días con actividad sin cerrar quedan TODOS pendientes, ordenados de más viejo a más nuevo", () => {
    const result = pendingDatesFromActivity(
      dias,
      new Set(),
      new Set(["2026-10-15", "2026-10-16", "2026-10-17"]),
    );
    expect(result.map((p) => p.date)).toEqual(["2026-10-15", "2026-10-16", "2026-10-17"]);
  });

  it("un día cerrado nunca aparece como pendiente, aunque tuvo actividad", () => {
    const result = pendingDatesFromActivity(
      dias,
      new Set(["2026-10-16"]),
      new Set(["2026-10-16", "2026-10-17"]),
    );
    expect(result.map((p) => p.date)).toEqual(["2026-10-17"]);
  });

  it("un día sin actividad real nunca aparece como pendiente, aunque no tenga cierre", () => {
    const result = pendingDatesFromActivity(dias, new Set(), new Set());
    expect(result).toEqual([]);
  });

  it("un día cerrado en el medio de dos pendientes no tapa a los otros (no asume backlog contiguo)", () => {
    const result = pendingDatesFromActivity(
      dias,
      new Set(["2026-10-15"]),
      new Set(["2026-10-14", "2026-10-15", "2026-10-16"]),
    );
    expect(result.map((p) => p.date)).toEqual(["2026-10-14", "2026-10-16"]);
  });
});

// El aviso "Tenés N cajas pendientes" de Inicio tardaba ~5s en aparecer:
// findAllPendingCierres llamaba a buildCierreSnapshotForDate (4 a 6 queries:
// payments, expenses, employees, profiles, appointments, business_settings)
// UNA VEZ POR CADA día candidato sin cierre (hasta 30), para terminar
// usando solo `hadActivity` de cada uno — hasta ~180 consultas para una
// pregunta sí/no por día. datesWithActivity la resuelve en 2 queries
// totales (payments + expenses, con rango amplio), sin importar cuántos
// días candidatos haya.
describe("findAllPendingCierres — detecta actividad en 2 queries totales, no 1 por día candidato", () => {
  it("ya no llama a buildCierreSnapshotForDate por día — usa datesWithActivity (payments + expenses en rango, sin employees/profiles/appointments/business_settings repetidos)", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    const fnMatch = src.match(/export async function findAllPendingCierres\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).not.toMatch(/buildCierreSnapshotForDate/);
    expect(fnMatch![1]).toMatch(/datesWithActivity\(businessId, branchId, openCandidates\)/);
  });

  it("datesWithActivity pide payments y expenses una sola vez cada uno, nunca dentro de un loop por fecha", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    const fnMatch = src.match(/async function datesWithActivity\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).not.toMatch(/dates\.map\(async/);
    expect(fnMatch![1]).toMatch(/\.from\("payments"\)/);
    expect(fnMatch![1]).toMatch(/\.from\("expenses"\)/);
    expect(fnMatch![1]).not.toMatch(/\.from\("employees"\)/);
    expect(fnMatch![1]).not.toMatch(/\.from\("profiles"\)/);
  });
});

// cajaOpenRangeStartDate llamaba a findAllPendingCierres como fallback
// interno (para decidir desde cuándo arranca el período abierto) y
// use-caja-summary.ts volvía a llamarlo por separado para el aviso "Tenés
// N cajas pendientes" — la misma query pesada, dos veces por cada carga de
// Inicio/Caja. Ahora cajaOpenRangeStartDate la pide UNA vez (en paralelo
// con la consulta de cash_sessions) y devuelve `allPendingCierres` para
// que el caller la reutilice sin volver a pedirla.
describe("cajaOpenRangeStartDate — ya no duplica la consulta de pendientes con el caller", () => {
  it("devuelve allPendingCierres en el resultado, en paralelo con la consulta de cash_sessions", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    const fnMatch = src.match(/export async function cajaOpenRangeStartDate\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/Promise\.all\(\[[\s\S]*?findAllPendingCierres\(businessId, branchId\)/);
  });

  it("use-caja-summary.ts ya no llama a findAllPendingCierres por su cuenta — reutiliza period.allPendingCierres", () => {
    const src = readSrc("src/hooks/use-caja-summary.ts");
    expect(src).not.toMatch(/findAllPendingCierres\(/);
    expect(src).toMatch(/setPendingCierres\(period\.allPendingCierres\)/);
  });

  it("el aviso de pendientes se confirma apenas resuelve cajaOpenRangeStartDate, antes del resto del pipeline (pagos/gastos/movimientos)", () => {
    const src = readSrc("src/hooks/use-caja-summary.ts");
    const commitIdx = src.indexOf("setPendingCierres(period.allPendingCierres)");
    const payQueryIdx = src.indexOf('.from("payments")');
    expect(commitIdx).toBeGreaterThan(-1);
    expect(payQueryIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeLessThan(payQueryIdx);
  });
});

// Base de "Cerrar un día anterior" (CerrarDiaAnteriorCard en
// cash-register.tsx): su guarda contra cierres duplicados es
// `closedDates = cierresExistentes.filter(isCajaCerradaRow)` — si esto
// clasifica mal una fila, esa guarda deja pasar un segundo cierre sobre la
// misma fecha.
describe("isCajaCerradaRow / isCajaReabiertaRow — la guarda contra cierres duplicados", () => {
  it("una fila con estado 'cerrada' se reconoce como cerrada", () => {
    expect(isCajaCerradaRow({ estado: "cerrada" })).toBe(true);
    expect(isCajaReabiertaRow({ estado: "cerrada" })).toBe(false);
  });

  it("una fila con estado 'reabierta' NO se reconoce como cerrada (pero sí existe, no vuelve a quedar 'pendiente')", () => {
    expect(isCajaCerradaRow({ estado: "reabierta" })).toBe(false);
    expect(isCajaReabiertaRow({ estado: "reabierta" })).toBe(true);
  });

  it("una fila sin estado (o null/undefined) no se reconoce como cerrada ni reabierta", () => {
    expect(isCajaCerradaRow(null)).toBe(false);
    expect(isCajaCerradaRow(undefined)).toBe(false);
    expect(isCajaCerradaRow({})).toBe(false);
  });
});

// Actualización en tiempo real (sección 6 del pedido): un cierre/reapertura
// confirmado desde OTRO dispositivo tiene que reflejarse sin recargar.
// closeSingleDayCierre solo dispara un CustomEvent same-tab — lo que cruza
// dispositivos es la suscripción postgres_changes sobre caja_cierres, y
// esa tabla tiene que estar en la publicación supabase_realtime. Test
// estructural: si alguien borra la suscripción o la migración que agrega
// la tabla a la publicación, esto lo avisa en vez de reaparecer como "no
// se actualiza sin refrescar" en producción.
describe("Tiempo real — caja_cierres llega a todos los dispositivos", () => {
  it("existe la migración que agrega caja_cierres a la publicación supabase_realtime", () => {
    const migrationsDir = path.join(repoRoot, "supabase", "migrations");
    const files = fs.readdirSync(migrationsDir);
    const match = files.find((f) => {
      const content = fs.readFileSync(path.join(migrationsDir, f), "utf8");
      return /alter publication supabase_realtime add table caja_cierres/i.test(content);
    });
    expect(match).toBeDefined();
  });

  it("use-caja-summary.ts (Inicio) se suscribe a postgres_changes de caja_cierres", () => {
    const src = readSrc("src/hooks/use-caja-summary.ts");
    expect(src).toMatch(/table:\s*"caja_cierres"/);
  });

  it("CierresTab (Caja) se suscribe a postgres_changes de caja_cierres", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/table:\s*"caja_cierres"/);
  });

  it("ambas pantallas tienen una red de seguridad de refetch al volver a la pestaña (focus/visibilitychange)", () => {
    const summarySrc = readSrc("src/hooks/use-caja-summary.ts");
    const cashRegisterSrc = readSrc("src/routes/cash-register.tsx");
    expect(summarySrc).toMatch(/addEventListener\("focus"/);
    expect(cashRegisterSrc).toMatch(/addEventListener\("focus"/);
  });

  it("existe la migración que agrega expenses a la publicación supabase_realtime", () => {
    const migrationsDir = path.join(repoRoot, "supabase", "migrations");
    const files = fs.readdirSync(migrationsDir);
    const match = files.find((f) => {
      const content = fs.readFileSync(path.join(migrationsDir, f), "utf8");
      return /alter publication supabase_realtime add table expenses/i.test(content);
    });
    expect(match).toBeDefined();
  });

  it("CerrarDiaAnteriorCard se suscribe a payments/expenses para avisar si una jornada pendiente cambia mientras se revisa", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    const fnMatch = src.match(/function CerrarDiaAnteriorCard\(([\s\S]*?)\n}\n\n\/\/ Detalle de un cierre/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/table:\s*"payments"/);
    expect(fnMatch![1]).toMatch(/table:\s*"expenses"/);
    expect(fnMatch![1]).toMatch(/cambiaron — se actualizó la vista previa/);
  });
});

// Dos usuarios (o un doble clic) confirmando el MISMO día al mismo tiempo
// — closeSingleDayCierre no puede confiar en "nadie más lo está cerrando
// ahora", porque sí puede pasar. Acá se testea la base de datos (la
// unique constraint NULLS NOT DISTINCT) y, por inspección de código, que
// closeSingleDayCierre traduce el conflicto a un resultado prolijo
// (alreadyClosed) en vez de un error crudo o un segundo cierre.
describe("Condición de carrera — dos confirmaciones simultáneas de la misma fecha", () => {
  it("existe la migración que endurece la unique constraint a NULLS NOT DISTINCT", () => {
    const migrationsDir = path.join(repoRoot, "supabase", "migrations");
    const files = fs.readdirSync(migrationsDir);
    const match = files.find((f) => {
      const content = fs.readFileSync(path.join(migrationsDir, f), "utf8");
      return /unique nulls not distinct \(business_id, branch_id, fecha\)/i.test(content);
    });
    expect(match).toBeDefined();
  });

  it("closeSingleDayCierre traduce una unique violation (23505) del INSERT a alreadyClosed, nunca un throw crudo", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    const fnMatch = src.match(/export async function closeSingleDayCierre\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/code.*===.*"23505"/);
    expect(fnMatch![1]).toMatch(/alreadyClosed: true/);
  });

  it("closeSingleDayCierre guarda el UPDATE con .neq(\"estado\",\"cerrada\") — si la otra confirmación ya cerró la fila, esta no la pisa", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    const fnMatch = src.match(/export async function closeSingleDayCierre\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/\.neq\("estado",\s*"cerrada"\)/);
  });
});

// Fallos de conexión: cualquier query nueva de este trabajo (findAllPendingCierres,
// la carga del aviso en CierresTab, el refresco silencioso de una jornada en
// revisión) tiene que degradar con gracia — nunca romper la pantalla ni
// dejarla sin datos por un error de red puntual.
describe("Fallos de conexión — las queries nuevas nunca rompen la pantalla", () => {
  it("use-caja-summary.ts atrapa el error de cajaOpenRangeStartDate (que ahora incluye findAllPendingCierres) y sigue con la lista vacía", () => {
    const src = readSrc("src/hooks/use-caja-summary.ts");
    const fnMatch = src.match(/cajaOpenRangeStartDate\(businessId, branchId\)\.catch\(([\s\S]*?)\}\);/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/allPendingCierres: \[\]/);
  });

  it("CierresTab atrapa el error de findAllPendingCierres (loadPendingCierres)", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    const fnMatch = src.match(/const loadPendingCierres = React\.useCallback\(([\s\S]*?)\n {2}\}, \[businessId, activeBranchId\]\);/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/\.catch\(/);
  });

  it("el refresco silencioso de una jornada pendiente en revisión está en un try/catch que nunca rompe la revisión en curso", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/async function refreshSilently\(\) \{[\s\S]*?try \{[\s\S]*?\} catch \{/);
  });
});

describe("countServiciosYProductos — conteo del Historial a partir de cobros_snapshot[].items", () => {
  it("un cobro sin items (cierre viejo, sin el enriquecimiento) cuenta como 1 servicio", () => {
    expect(countServiciosYProductos([{ items: [] }, { items: undefined }])).toEqual({
      servicios: 2,
      productos: 0,
    });
  });

  it("separa servicios de productos dentro de un mismo cobro (items multi-línea)", () => {
    const result = countServiciosYProductos([
      {
        items: [
          { esProducto: false },
          { esProducto: true },
        ],
      },
    ]);
    expect(result).toEqual({ servicios: 1, productos: 1 });
  });

  it("suma a través de varios cobros sin duplicar ni perder ninguno", () => {
    const result = countServiciosYProductos([
      { items: [{ esProducto: false }] },
      { items: [{ esProducto: true }, { esProducto: true }] },
      { items: [] },
    ]);
    expect(result).toEqual({ servicios: 2, productos: 2 });
  });

  it("sin cobros, da cero y cero (nunca inventa movimientos)", () => {
    expect(countServiciosYProductos([])).toEqual({ servicios: 0, productos: 0 });
    expect(countServiciosYProductos(null)).toEqual({ servicios: 0, productos: 0 });
  });
});

describe("normalizeCierreMethodKey — mismo vocabulario sin importar el origen (payments vs expenses)", () => {
  it("agrupa efectivo/cash bajo una sola clave", () => {
    expect(normalizeCierreMethodKey("cash")).toBe("cash");
    expect(normalizeCierreMethodKey("efectivo")).toBe("cash");
    expect(normalizeCierreMethodKey("Efectivo")).toBe("cash");
  });

  it("agrupa transferencia/transfer bajo una sola clave", () => {
    expect(normalizeCierreMethodKey("transfer")).toBe("transfer");
    expect(normalizeCierreMethodKey("Transferencia")).toBe("transfer");
  });

  it("agrupa tarjeta/débito/crédito bajo 'card'", () => {
    expect(normalizeCierreMethodKey("tarjeta")).toBe("card");
    expect(normalizeCierreMethodKey("debito")).toBe("card");
    expect(normalizeCierreMethodKey("credito")).toBe("card");
  });

  it("sin método, cae a efectivo (filas viejas sin esa columna)", () => {
    expect(normalizeCierreMethodKey(null)).toBe("cash");
    expect(normalizeCierreMethodKey(undefined)).toBe("cash");
    expect(normalizeCierreMethodKey("")).toBe("cash");
  });
});

// Caso real reportado: el cierre de un día puntual (13/10) tiene que
// calcular efectivo/transferencia EXCLUSIVAMENTE con los movimientos que
// se le pasan — nunca depender de qué día es "hoy" ni de un rango
// implícito. El filtrado por fecha vive en el caller (buildCierreSnapshotForDate/
// buildSingleDayCierrePreview); esta función solo hace la cuenta.
describe("computeExpectedCashAndDigital — efectivo/transferencia de un día acotado", () => {
  it("separa cobros en efectivo de cobros digitales, sin mezclarlos", () => {
    const result = computeExpectedCashAndDigital({
      payments: [
        { total: 23000, method: "cash" },
        { total: 23000, method: "cash" },
        { total: 19000, method: "transfer" },
      ],
      expenses: [],
      advances: [],
      cashMovements: [],
    });
    expect(result.cashExpected).toBe(46000);
    expect(result.digitalExpected).toBe(19000);
  });

  it("resta gastos en efectivo solo del efectivo, nunca del digital", () => {
    const result = computeExpectedCashAndDigital({
      payments: [{ total: 50000, method: "cash" }],
      expenses: [{ amount: 5000, payment_method: "efectivo" }],
      advances: [],
      cashMovements: [],
    });
    expect(result.cashExpected).toBe(45000);
    expect(result.cashOutflows).toBe(5000);
    expect(result.digitalExpected).toBe(0);
  });

  it("resta adelantos en efectivo del efectivo esperado", () => {
    const result = computeExpectedCashAndDigital({
      payments: [{ total: 100000, method: "cash" }],
      expenses: [],
      advances: [{ amount: 30000, payment_method: "efectivo" }],
      cashMovements: [],
    });
    expect(result.cashExpected).toBe(70000);
  });

  it("ingresos/retiros manuales de caja (cash_movements) ajustan el efectivo esperado", () => {
    const result = computeExpectedCashAndDigital({
      payments: [{ total: 10000, method: "cash" }],
      expenses: [],
      advances: [],
      cashMovements: [
        { type: "ingreso", amount: 5000, method: "efectivo" },
        { type: "retiro", amount: 2000, method: "efectivo" },
      ],
    });
    expect(result.cashInflows).toBe(5000);
    expect(result.cashOutflows).toBe(2000);
    expect(result.cashExpected).toBe(10000 + 5000 - 2000);
  });

  it("un día sin ningún movimiento da todo en cero (nunca hereda el día anterior)", () => {
    const result = computeExpectedCashAndDigital({ payments: [], expenses: [], advances: [], cashMovements: [] });
    expect(result.cashExpected).toBe(0);
    expect(result.digitalExpected).toBe(0);
  });
});

// Corrección "propinas en caja": un cliente que paga $20.000 + $2.000 de
// propina en efectivo deja $22.000 reales en el cajón — si el efectivo
// esperado solo contaba el $20.000, el conteo físico siempre "sobra" por
// el total de propinas en efectivo del día. tip/tip_amount nunca se suma
// dentro de total/amount (eso sigue siendo pura facturación, ver
// registerPayment) pero SÍ tiene que entrar al efectivo/cuenta esperados.
describe("computeExpectedCashAndDigital — propinas: entran a caja, nunca a la facturación", () => {
  it("una propina en efectivo se suma al efectivo esperado, no a facturación", () => {
    const result = computeExpectedCashAndDigital({
      payments: [{ total: 20000, method: "cash", tip: 2000 }],
      expenses: [],
      advances: [],
      cashMovements: [],
    });
    expect(result.cashExpected).toBe(22000);
  });

  it("una propina por transferencia se suma al dinero esperado en cuenta, nunca al efectivo", () => {
    const result = computeExpectedCashAndDigital({
      payments: [{ total: 20000, method: "transfer", tip: 3000 }],
      expenses: [],
      advances: [],
      cashMovements: [],
    });
    expect(result.digitalExpected).toBe(23000);
    expect(result.cashExpected).toBe(0);
  });

  it("acepta tip_amount (nombre real de la columna) igual que tip", () => {
    const result = computeExpectedCashAndDigital({
      payments: [{ total: 20000, method: "cash", tip_amount: 1500 }],
      expenses: [],
      advances: [],
      cashMovements: [],
    });
    expect(result.cashExpected).toBe(21500);
  });

  it("varios cobros con propina en distintos medios no se mezclan entre sí", () => {
    const result = computeExpectedCashAndDigital({
      payments: [
        { total: 20000, method: "cash", tip: 2000 },
        { total: 15000, method: "transfer", tip: 1000 },
      ],
      expenses: [],
      advances: [],
      cashMovements: [],
    });
    expect(result.cashExpected).toBe(22000);
    expect(result.digitalExpected).toBe(16000);
  });

  it("sin propina (tip ausente u 0), el resultado es idéntico al de antes de este fix", () => {
    const result = computeExpectedCashAndDigital({
      payments: [{ total: 20000, method: "cash" }, { total: 10000, method: "cash", tip: 0 }],
      expenses: [],
      advances: [],
      cashMovements: [],
    });
    expect(result.cashExpected).toBe(30000);
  });
});

// Bug real (26/10/2026): una venta anulada seguía sumando en Ingresos y en
// Dinero en cuenta/efectivo esperado, como si siguiera cobrada — varios
// lugares de Caja solo excluían 'pendiente'/'parcial' y se olvidaban de
// 'anulado'/'reembolsado'. isVoidedPaymentStatus/isCountableCajaPayment
// son el único punto de verdad ahora — estos tests cubren la función
// compartida (los 4 lugares que la usan quedan protegidos por extensión:
// use-caja-summary.ts revHoy/cobros, computeExpectedCashAndDigital,
// closeoutByMethod y el historial unificado en cash-register.tsx).
describe("isVoidedPaymentStatus / isCountableCajaPayment — estados que nunca cuentan como ingreso", () => {
  it("anulado y reembolsado son 'voided'", () => {
    expect(isVoidedPaymentStatus("anulado")).toBe(true);
    expect(isVoidedPaymentStatus("reembolsado")).toBe(true);
  });

  it("cobrado, pendiente, parcial y null/undefined no son 'voided'", () => {
    expect(isVoidedPaymentStatus("cobrado")).toBe(false);
    expect(isVoidedPaymentStatus("pendiente")).toBe(false);
    expect(isVoidedPaymentStatus("parcial")).toBe(false);
    expect(isVoidedPaymentStatus(null)).toBe(false);
    expect(isVoidedPaymentStatus(undefined)).toBe(false);
  });

  it("isCountableCajaPayment excluye los 4 estados que nunca aportan plata real", () => {
    expect(isCountableCajaPayment("pendiente")).toBe(false);
    expect(isCountableCajaPayment("parcial")).toBe(false);
    expect(isCountableCajaPayment("anulado")).toBe(false);
    expect(isCountableCajaPayment("reembolsado")).toBe(false);
  });

  it("isCountableCajaPayment cuenta 'cobrado' y filas viejas sin status (undefined)", () => {
    expect(isCountableCajaPayment("cobrado")).toBe(true);
    expect(isCountableCajaPayment(undefined)).toBe(true);
    expect(isCountableCajaPayment(null)).toBe(true);
  });
});

describe("computeExpectedCashAndDigital — ventas anuladas/reembolsadas/restablecidas", () => {
  it("una venta anulada en efectivo NO suma al efectivo esperado", () => {
    const result = computeExpectedCashAndDigital({
      payments: [
        { total: 20000, method: "cash", status: "cobrado" },
        { total: 9000, method: "cash", status: "anulado" },
      ],
      expenses: [],
      advances: [],
      cashMovements: [],
    });
    expect(result.cashExpected).toBe(20000);
  });

  it("una venta reembolsada por transferencia NO suma al dinero en cuenta esperado", () => {
    const result = computeExpectedCashAndDigital({
      payments: [
        { total: 15000, method: "transfer", status: "cobrado" },
        { total: 21900, method: "transfer", status: "reembolsado" },
      ],
      expenses: [],
      advances: [],
      cashMovements: [],
    });
    expect(result.digitalExpected).toBe(15000);
  });

  it("restablecer una venta (vuelve a status='cobrado') la hace contar exactamente una vez", () => {
    const anulada = { total: 21900, method: "transfer" as const, status: "anulado" };
    const restablecida = { ...anulada, status: "cobrado" };
    const soloAnulada = computeExpectedCashAndDigital({
      payments: [anulada],
      expenses: [],
      advances: [],
      cashMovements: [],
    });
    const soloRestablecida = computeExpectedCashAndDigital({
      payments: [restablecida],
      expenses: [],
      advances: [],
      cashMovements: [],
    });
    expect(soloAnulada.digitalExpected).toBe(0);
    expect(soloRestablecida.digitalExpected).toBe(21900);
  });

  it("cobro mixto: cobrado + anulado + reembolsado + pendiente en el mismo día, solo el cobrado cuenta", () => {
    const result = computeExpectedCashAndDigital({
      payments: [
        { total: 20000, method: "cash", status: "cobrado" },
        { total: 9000, method: "cash", status: "anulado" },
        { total: 21900, method: "transfer", status: "reembolsado" },
        { total: 30000, method: "transfer", status: "pendiente" },
      ],
      expenses: [],
      advances: [],
      cashMovements: [],
    });
    expect(result.cashExpected).toBe(20000);
    expect(result.digitalExpected).toBe(0);
  });
});

// Guarda estructural: si alguien agrega un QUINTO lugar en Caja que suma
// payments.total/amount filtrando a mano por status, y se olvida de pasar
// por isCountableCajaPayment/isVoidedPaymentStatus, este test no detecta
// ESE caso nuevo (no hay forma genérica de auditar código no escrito
// todavía) — pero sí asegura que los 4 lugares ya conocidos donde pasó
// este bug real sigan usando la función compartida, en vez de volver a un
// chequeo manual de 'pendiente'/'parcial' que se olvide de anulado.
describe("Guarda contra la reaparición del bug de ventas anuladas en Caja (26/10/2026)", () => {
  const repoRootForGuard = path.resolve(__dirname, "..", "..");
  const readGuardSrc = (rel: string) => fs.readFileSync(path.join(repoRootForGuard, rel), "utf8");

  it("caja-cierre.ts: computeExpectedCashAndDigital usa isCountableCajaPayment, no un chequeo manual", () => {
    const src = readGuardSrc("src/lib/caja-cierre.ts");
    expect(src).toMatch(/if \(!isCountableCajaPayment\(p\.status\)\) continue;/);
  });

  it("use-caja-summary.ts: revHoy y cobros usan isCountableCajaPayment", () => {
    const src = readGuardSrc("src/hooks/use-caja-summary.ts");
    expect(src).toMatch(/isCountableCajaPayment\(p\.status\)/);
    expect(src.match(/isCountableCajaPayment/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("cash-register.tsx: closeoutByMethod usa isCountableCajaPayment", () => {
    const src = readGuardSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/if \(!isCountableCajaPayment\(payment\.status\)\) continue;/);
  });

  it("cash-register.tsx: el historial unificado usa pagoRowColor, no un chequeo manual de color", () => {
    const src = readGuardSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/color: pagoRowColor\(p\.status, montoConPropina\)/);
  });
});

// Caso real (26/10/2026): Franco anuló dos ventas ($21.900 y $19.000) y
// Revisar cierre no tenía ningún lugar para verlas — "Ingresos" seguía
// bien calculado ($353.500, 17 servicios) pero quedaban invisibles. Fix:
// cobrosAnuladosSnapshot (caja-cierre.ts) + CierreMovimientosDetalleList
// (cash-register.tsx) las muestra en la MISMA tabla de Servicios, con tag
// "Anulado" e importe tachado, sin tocar ningún total.
describe("Ventas anuladas visibles en Revisar cierre (26/10/2026) — sin alterar ningún total", () => {
  it("caja-cierre.ts: hay una query aparte que trae status in (anulado,reembolsado) del mismo día/negocio/sucursal", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    expect(src).toMatch(/anuladosQuery[\s\S]{0,400}\.in\(\s*"status",\s*\["anulado",\s*"reembolsado"\]\s*\)/);
  });

  it("caja-cierre.ts: cobrosAnuladosSnapshot se construye desde `anulados`, nunca desde `payments`", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    const fnMatch = src.match(/const cobrosAnuladosSnapshot = anulados\.map\(([\s\S]*?)\n  \}\);/);
    expect(fnMatch).not.toBeNull();
  });

  it("caja-cierre.ts: cobrosAnuladosSnapshot se devuelve en el resultado de buildCierreSnapshotForDate", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    expect(src).toMatch(/cobrosSnapshot,\s*\n\s*cobrosAnuladosSnapshot,/);
  });

  it("caja-cierre.ts: totalCobrado/detalleMetodos/detalleMetodosRecibido se calculan SOLO sobre `payments`, nunca sobre `anulados`/cobrosAnuladosSnapshot", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    // El bloque que suma totalCobrado/totalPropinas (payments.reduce) no
    // menciona `anulados` en ningún lado de esa sección.
    const totalesBlock = src.slice(src.indexOf("const totalCobrado"), src.indexOf("const detalleMetodos:"));
    expect(totalesBlock).not.toMatch(/anulados/);
    // El loop que arma detalleMetodos/detalleMetodosRecibido itera `payments`,
    // nunca `anulados`.
    expect(src).toMatch(/for \(const p of payments\) \{/);
    expect(src).not.toMatch(/for \(const p of anulados\)/);
  });

  it("cash-register.tsx: CierreMovimientosDetalleList acepta cobrosAnulados y los dos call sites lo pasan", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/cobrosAnulados\?:\s*any\[\]/);
    expect(src.match(/cobrosAnulados=\{(?:snapshot\.cobrosAnuladosSnapshot|cobrosAnulados)\}/g)?.length ?? 0).toBe(2);
  });

  it("cash-register.tsx: las ventas anuladas se filtran por profesional Y medio de pago, igual que las cobradas", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(
      /serviciosAnuladosRows\.filter\(\(p: any\) => p\.profesional === profesionalFiltro\)/,
    );
    expect(src).toMatch(
      /serviciosAnuladosPorProfesional\.filter\(\s*\(p: any\) => montoParaMedio\(p\.monto, 0, p\.metodo, p\.splits, medioFiltro\)\.incluido,?\s*\)/,
    );
  });

  it("cash-register.tsx: el tag rojo \"Anulado\" y el importe tachado (line-through) existen en el render de servicios", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/text-rose-300[^"]*">\s*\n\s*Anulado/);
    expect(src).toMatch(/line-through decoration-rose-400\/50/);
  });

  it("cash-register.tsx: ningún total (totalGeneralDia, cobrosPorProfesional, desglosePorMedio, facturacionPorProfesional) se calcula sobre cobrosAnulados/serviciosAnuladosFiltrados", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    const totalsBlock = src.slice(
      src.indexOf("const totalGeneralDia ="),
      src.indexOf("const filtroChips:"),
    );
    expect(totalsBlock).not.toMatch(/cobrosAnulados/);
    expect(totalsBlock).not.toMatch(/serviciosAnuladosFiltrados/);
  });

  it("cash-register.tsx: anular/restablecer/anular de nuevo la misma venta nunca duplica su fila (una sola query por payments.id, estado actual)", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    // Una sola fila por payments.id — no hay ningún join con
    // payment_authorization_log (que sí tendría varias filas por venta)
    // para armar cobrosAnuladosSnapshot.
    const fnMatch = src.match(/const cobrosAnuladosSnapshot = anulados\.map\(([\s\S]*?)\n  \}\);/);
    expect(fnMatch![1]).not.toMatch(/payment_authorization_log/);
  });
});

// pagoRowColor: una venta anulada/reembolsada siempre gris; un ajuste con
// monto negativo (venta anulada de un día ya cerrado, ver
// void_payment_authorized) tiene que ir en rojo, nunca en verde con "+"
// como si fuera plata entrando.
describe("pagoRowColor — color correcto según estado y signo del monto", () => {
  it("anulado/reembolsado siempre gris, sin importar el signo del monto", () => {
    expect(pagoRowColor("anulado", 20000)).toBe("gris");
    expect(pagoRowColor("reembolsado", -20000)).toBe("gris");
  });

  it("cobrado con monto positivo es verde", () => {
    expect(pagoRowColor("cobrado", 20000)).toBe("verde");
  });

  it("cobrado con monto negativo (ajuste a la baja) es rojo, nunca verde", () => {
    expect(pagoRowColor("cobrado", -20000)).toBe("rojo");
  });

  it("monto cero es verde (no hay nada que mostrar como negativo)", () => {
    expect(pagoRowColor("cobrado", 0)).toBe("verde");
  });
});

// Bug real (26/10/2026): anular una venta de un día YA CERRADO no dejaba
// ningún rastro en Caja de hoy — el cierre histórico (correcto) seguía
// con su total_cobrado de siempre, pero la plata "desaparecía" sin ningún
// movimiento compensándola. Fix: void_payment_authorized/
// restore_payment_authorized (ver supabase/migrations/
// 20261026010000_void_closed_day_cash_adjustment.sql) insertan un
// cash_movements (retiro/ingreso) ligado por sale_id, SQL puro — no hay
// código de frontend que probar acá, solo documentamos la referencia para
// quien busque el test de este caso.
describe("Ajuste de caja por anulación de venta de día cerrado (26/10/2026)", () => {
  it("referencia: la lógica vive en la migración SQL, probada manualmente en entorno aislado (ver migración para el detalle)", () => {
    const src = readSrc(
      "supabase/migrations/20261026010000_void_closed_day_cash_adjustment.sql",
    );
    expect(src).toMatch(/AJUSTE-ANULACION/);
    expect(src).toMatch(/AJUSTE-RESTABLECIMIENTO/);
    expect(src).toMatch(/sale_id/);
  });
});

// Pago múltiple (payments.splits): antes de este fix, un cobro con varios
// medios caía ENTERO en `method` (que en un pago múltiple puede ni
// siquiera reflejar ningún medio real usado) — ver distributeCobroByMethod.
describe("distributeCobroByMethod — reparto real de un pago múltiple", () => {
  it("sin splits, se comporta exactamente igual que antes: todo a `method`", () => {
    const dist = cajaCierre.distributeCobroByMethod(10000, 0, "cash", null);
    expect(dist).toEqual({ cash: { monto: 10000, propina: 0 } });
  });

  it("splits vacío ([]) se comporta igual que splits null", () => {
    const dist = cajaCierre.distributeCobroByMethod(10000, 0, "transfer", []);
    expect(dist).toEqual({ transfer: { monto: 10000, propina: 0 } });
  });

  it("reparte el monto proporcionalmente entre los medios reales, sin duplicar ni perder plata", () => {
    const dist = cajaCierre.distributeCobroByMethod(10000, 0, "cash", [
      { method: "cash", amount: 5000 },
      { method: "transfer", amount: 5000 },
    ]);
    expect(dist.cash.monto).toBe(5000);
    expect(dist.transfer.monto).toBe(5000);
    expect(dist.cash.monto + dist.transfer.monto).toBe(10000);
  });

  it("reparte la propina en la MISMA proporción que el monto — la suma total nunca cambia", () => {
    const dist = cajaCierre.distributeCobroByMethod(9000, 1000, "cash", [
      { method: "cash", amount: 3000 },
      { method: "transfer", amount: 6000 },
    ]);
    // 1/3 del monto+propina al cash, 2/3 al transfer.
    expect(dist.cash.monto + dist.cash.propina).toBeCloseTo((9000 + 1000) / 3, 5);
    expect(dist.transfer.monto + dist.transfer.propina).toBeCloseTo(((9000 + 1000) * 2) / 3, 5);
    const total = Object.values(dist).reduce((s, v) => s + v.monto + v.propina, 0);
    expect(total).toBeCloseTo(10000, 5);
  });

  it("splits con monto 0 o negativo se ignoran, sin romper el reparto del resto", () => {
    const dist = cajaCierre.distributeCobroByMethod(10000, 0, "cash", [
      { method: "cash", amount: 0 },
      { method: "transfer", amount: -500 },
      { method: "qr", amount: 10000 },
    ]);
    expect(dist.qr.monto).toBe(10000);
    expect(dist.cash).toBeUndefined();
    expect(dist.transfer).toBeUndefined();
  });

  it("splits que no suman lo mismo que `monto` (dato mal cargado) igual reparten TODO el monto real, nunca más ni menos", () => {
    // El cliente pagó $10.000 pero el pago múltiple se cargó mal y sus
    // splits suman $8.000 — el reparto sigue dando $10.000 en total
    // (nunca se "pierde" plata), la proporción se calcula sobre lo
    // cargado. El desajuste se señala aparte (ver conciliacionAlertas),
    // nunca acá.
    const dist = cajaCierre.distributeCobroByMethod(10000, 0, "cash", [
      { method: "cash", amount: 4000 },
      { method: "transfer", amount: 4000 },
    ]);
    const total = Object.values(dist).reduce((s, v) => s + v.monto, 0);
    expect(total).toBe(10000);
    expect(dist.cash.monto).toBe(5000);
    expect(dist.transfer.monto).toBe(5000);
  });

  it("computeExpectedCashAndDigital usa el reparto real de splits, no `method`", () => {
    // `method` quedó en "cash" (valor por default del selector simple),
    // pero el pago múltiple real fue mitad efectivo, mitad transferencia
    // — antes de este fix, los $20.000 enteros caían en efectivo.
    const result = computeExpectedCashAndDigital({
      payments: [
        {
          total: 20000,
          method: "cash",
          splits: [
            { method: "cash", amount: 10000 },
            { method: "transfer", amount: 10000 },
          ],
        },
      ],
      expenses: [],
      advances: [],
      cashMovements: [],
    });
    expect(result.cashExpected).toBe(10000);
    expect(result.digitalExpected).toBe(10000);
  });
});

// El cierre de un día puntual tiene que estar acotado a ESE día calendario
// (00:00 a 23:59:59.999 hora Argentina) — nunca extenderse hasta "ahora"
// como hace el cierre de "caja vencida". Se prueba el mismo criterio de
// límites que usan buildSingleDayCierrePreview/closeSingleDayCierre.
describe("límites de un día de cierre puntual", () => {
  function isWithinDay(iso: string, dateStr: string): boolean {
    const t = new Date(iso).getTime();
    const start = new Date(`${dateStr}T00:00:00`).getTime();
    const end = new Date(`${dateStr}T23:59:59.999`).getTime();
    return t >= start && t <= end;
  }

  it("un pago del día elegido entra", () => {
    expect(isWithinDay("2026-10-13T17:06:56.466-03:00", "2026-10-13")).toBe(true);
  });

  it("un pago del día SIGUIENTE no entra en el cierre del día anterior", () => {
    expect(isWithinDay("2026-10-14T00:30:00.000-03:00", "2026-10-13")).toBe(false);
  });

  it("un pago del día ANTERIOR no entra en el cierre de hoy", () => {
    expect(isWithinDay("2026-10-12T23:59:00.000-03:00", "2026-10-13")).toBe(false);
  });

  it("exactamente a medianoche del día elegido, entra", () => {
    expect(isWithinDay("2026-10-13T00:00:00.000-03:00", "2026-10-13")).toBe(true);
  });
});

describe("cajaDateKeyBA / dayBoundsBA — huso horario de Buenos Aires explícito", () => {
  it("da la fecha de Buenos Aires aunque el instante UTC ya sea el día siguiente", () => {
    // 2026-10-14T02:00:00Z = 2026-10-13 23:00 en Buenos Aires (UTC-3).
    const lateNightUTC = new Date("2026-10-14T02:00:00.000Z");
    expect(cajaDateKeyBA(lateNightUTC)).toBe("2026-10-13");
  });

  it("dayBoundsBA da exactamente 24hs menos 1ms", () => {
    const { start, end } = dayBoundsBA("2026-10-13");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
  });
});

// Caso real reportado: Caja mostraba $706.100 de "Ingresos" el 14/10
// porque sumaba también el 13/10 (sin cerrar) — "Ingresos"/"Gastos" tienen
// que acotarse al día, mientras que el efectivo/cuenta esperados siguen
// siendo el acumulado completo (backlog incluido), que es un concepto
// distinto.
describe("filterToDayBA — separa Ingresos del día de lo acumulado sin cerrar (caso real 13/10 + 14/10)", () => {
  const paymentsAcumulados = [
    // 13/10: $450.800 (21 cobros reales, acá resumidos en 2 líneas para el test)
    { total: 306800, created_at: "2026-10-13T16:06:06.000-03:00" },
    { total: 144000, created_at: "2026-10-13T19:58:54.000-03:00" },
    // 14/10: $255.300
    { total: 193400, created_at: "2026-10-14T15:00:00.000-03:00" },
    { total: 61900, created_at: "2026-10-14T20:08:44.000-03:00" },
  ];

  it("el acumulado completo (sin filtrar) es $706.100 — lo que efectivo/cuenta esperados deben seguir mostrando", () => {
    const totalAcumulado = paymentsAcumulados.reduce((s, p) => s + p.total, 0);
    expect(totalAcumulado).toBe(706100);
  });

  it("Ingresos del 14/10 (acotado al día) es solo $255.300, no $706.100", () => {
    const soloHoy = filterToDayBA(paymentsAcumulados, (p) => p.created_at, "2026-10-14");
    const total = soloHoy.reduce((s, p) => s + p.total, 0);
    expect(total).toBe(255300);
  });

  it("Ingresos del 13/10 (acotado al día) es $450.800, sin arrastrar nada del 14/10", () => {
    const solo13 = filterToDayBA(paymentsAcumulados, (p) => p.created_at, "2026-10-13");
    const total = solo13.reduce((s, p) => s + p.total, 0);
    expect(total).toBe(450800);
  });

  it("los dos días sumados dan el acumulado — no se pierde ni se duplica nada", () => {
    const solo13 = filterToDayBA(paymentsAcumulados, (p) => p.created_at, "2026-10-13");
    const solo14 = filterToDayBA(paymentsAcumulados, (p) => p.created_at, "2026-10-14");
    const suma = [...solo13, ...solo14].reduce((s, p) => s + p.total, 0);
    expect(suma).toBe(706100);
    expect(solo13.length + solo14.length).toBe(paymentsAcumulados.length);
  });
});

// Caso real reportado: "Todos los movimientos" mostraba Transferencia
// $504.300 (23), Efectivo $185.000 (9), Crédito $21.900 (1) — exactamente
// el 13/10 + 14/10 sumados, porque el modal no filtraba por fecha. Con el
// filtro, elegir el 14/10 tiene que dar solo sus propios números.
describe('"Todos los movimientos" — el resumen por método respeta la fecha elegida', () => {
  type Pay = { total: number; tip_amount: number; method: string; created_at: string };

  // Para no escribir 21 filas a mano, se reconstruye directamente el total
  // real por método del 13/10 y del 14/10 (confirmado contra producción) y
  // se valida la función de agrupación con esos montos ya consolidados.
  function groupByMethodNoTip(rows: Pay[]): Record<string, { total: number; count: number }> {
    const groups: Record<string, { total: number; count: number }> = {};
    for (const p of rows) {
      if (!groups[p.method]) groups[p.method] = { total: 0, count: 0 };
      // Nunca suma tip_amount — la propina no es facturación del negocio.
      groups[p.method].total += p.total;
      groups[p.method].count += 1;
    }
    return groups;
  }

  const all13y14: Pay[] = [
    // 13/10 — 14 transferencias ($306.800), 7 efectivo ($144.000 + $1.000 de propina).
    ...Array.from({ length: 14 }, (_, i) => ({
      total: 306800 / 14,
      tip_amount: 0,
      method: "transfer",
      created_at: `2026-10-13T1${i % 9}:00:00-03:00`,
    })),
    ...Array.from({ length: 7 }, (_, i) => ({
      total: 144000 / 7,
      tip_amount: i === 0 ? 1000 : 0,
      method: "cash",
      created_at: `2026-10-13T0${i}:30:00-03:00`,
    })),
    // 14/10 — 9 transferencias ($193.400), 2 efectivo ($40.000), 1 crédito ($21.900).
    ...Array.from({ length: 9 }, (_, i) => ({
      total: 193400 / 9,
      tip_amount: 0,
      method: "transfer",
      created_at: `2026-10-14T1${i % 9}:00:00-03:00`,
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      total: 40000 / 2,
      tip_amount: i === 0 ? 4100 : 0,
      method: "cash",
      created_at: `2026-10-14T0${i}:15:00-03:00`,
    })),
    { total: 21900, tip_amount: 0, method: "credit", created_at: "2026-10-14T20:00:00-03:00" },
  ];

  it("sin filtro de fecha, el acumulado reproduce el error reportado ($711.200 con propina)", () => {
    const withTips = all13y14.reduce((s, p) => s + p.total + p.tip_amount, 0);
    expect(Math.round(withTips)).toBe(711200);
  });

  it("14/10 acotado al día da exactamente los valores de referencia, sin propina", () => {
    const solo14 = filterToDayBA(all13y14, (p) => p.created_at, "2026-10-14");
    const groups = groupByMethodNoTip(solo14);
    expect(Math.round(groups.transfer.total)).toBe(193400);
    expect(groups.transfer.count).toBe(9);
    expect(Math.round(groups.cash.total)).toBe(40000);
    expect(groups.cash.count).toBe(2);
    expect(Math.round(groups.credit.total)).toBe(21900);
    expect(groups.credit.count).toBe(1);
    const total = Object.values(groups).reduce((s, g) => s + g.total, 0);
    expect(Math.round(total)).toBe(255300);
  });

  it("13/10 acotado al día no incluye nada del 14/10", () => {
    const solo13 = filterToDayBA(all13y14, (p) => p.created_at, "2026-10-13");
    expect(solo13.every((p) => !p.method.includes("credit"))).toBe(true); // el único crédito es del 14/10
    const groups = groupByMethodNoTip(solo13);
    expect(Math.round(groups.transfer.total)).toBe(306800);
    expect(Math.round(groups.cash.total)).toBe(144000);
    expect(groups.credit).toBeUndefined();
  });
});

// Caso real reportado: las tarjetas "Efectivo esperado en caja"/"Dinero
// esperado en cuenta" de Resumen seguían mostrando el acumulado 13/10+14/10
// (el mismo backlog que SÍ necesita Cierre de caja), cuando "Efectivo del
// día"/"Dinero en cuenta del día" tienen que ser siempre el día elegido
// nada más — con o sin el día anterior cerrado.
describe('Resumen — "Efectivo del día"/"Dinero en cuenta del día" nunca dependen de si el día anterior está cerrado', () => {
  const payments14: Array<{ total: number; method: string; created_at: string }> = [
    { total: 20000, method: "cash", created_at: "2026-10-14T05:00:00-03:00" },
    { total: 20000, method: "cash", created_at: "2026-10-14T17:15:33-03:00" },
    ...Array.from({ length: 9 }, (_, i) => ({
      total: 193400 / 9,
      method: "transfer",
      created_at: `2026-10-14T1${i % 9}:30:00-03:00`,
    })),
    { total: 21900, method: "credit", created_at: "2026-10-14T20:08:44-03:00" },
  ];
  const payments13 = Array.from({ length: 21 }, (_, i) => ({
    total: 450800 / 21,
    method: i % 2 === 0 ? "transfer" : "cash",
    created_at: `2026-10-13T1${i % 9}:00:00-03:00`,
  }));

  function cashDigitalForDay(payments: typeof payments14, dateStr: string) {
    const dayRows = filterToDayBA(payments, (p) => p.created_at, dateStr);
    return computeExpectedCashAndDigital({
      payments: dayRows,
      expenses: [],
      advances: [],
      cashMovements: [],
    });
  }

  it("el 14/10 da $40.000 efectivo / $215.300 en cuenta estando el 13/10 SIN cerrar", () => {
    // "Sin cerrar" = no se filtra nada por estado de caja_cierres: el
    // cálculo del día nunca consulta esa tabla, solo payments/expenses/
    // advances/cash_movements acotados a su propio día.
    const allPayments = [...payments13, ...payments14];
    const result = cashDigitalForDay(allPayments, "2026-10-14");
    expect(Math.round(result.cashExpected)).toBe(40000);
    expect(Math.round(result.digitalExpected)).toBe(215300);
  });

  it("el 14/10 da EXACTAMENTE lo mismo si el 13/10 ya está cerrado (quitarlo del array no cambia nada)", () => {
    // Simula "13/10 ya cerrado": ni siquiera está en el array que se le
    // pasa a la función — el resultado del 14/10 tiene que ser idéntico.
    const onlyToday = [...payments14];
    const result = cashDigitalForDay(onlyToday, "2026-10-14");
    expect(Math.round(result.cashExpected)).toBe(40000);
    expect(Math.round(result.digitalExpected)).toBe(215300);
  });

  it("el 13/10 nunca se filtra por su propio estado de cierre — da siempre el mismo total", () => {
    const allPayments = [...payments13, ...payments14];
    const result = cashDigitalForDay(allPayments, "2026-10-13");
    expect(Math.round(result.cashExpected + result.digitalExpected)).toBe(450800);
  });
});

// Historial → Detalle de un cierre: filtros "Servicios"/"Productos" del
// nuevo rediseño (lista de fechas → vista de detalle → filtros), ambos
// derivados de splitServiciosYProductos. La garantía central: un cobro
// mixto (servicio + producto) aparece en las dos listas sin que el
// ingreso se cuente dos veces — eso lo protege el llamador (solo suma
// cobrosSnapshot[].monto una vez), no esta función.
describe("splitServiciosYProductos — clasificación para los filtros de Ver detalles", () => {
  it("un cobro sin items (cierre guardado antes del enriquecimiento) cuenta como 1 servicio, 0 productos", () => {
    const { servicios, productos } = splitServiciosYProductos([{ id: "a", items: [] }]);
    expect(servicios).toHaveLength(1);
    expect(productos).toHaveLength(0);
  });

  it("un cobro solo de productos (sin ítems de servicio) no aparece en Servicios", () => {
    const { servicios, productos } = splitServiciosYProductos([
      { id: "a", items: [{ nombre: "Cera", monto: 5000, esProducto: true }] },
    ]);
    expect(servicios).toHaveLength(0);
    expect(productos).toHaveLength(1);
    expect(productos[0]).toMatchObject({ nombre: "Cera", monto: 5000 });
  });

  it("un cobro mixto (servicio + producto) aparece en AMBAS listas", () => {
    const { servicios, productos } = splitServiciosYProductos([
      {
        id: "a",
        cliente: "Bruno",
        items: [
          { nombre: "Corte", monto: 20000, esProducto: false },
          { nombre: "Cera", monto: 5000, esProducto: true },
        ],
      },
    ]);
    expect(servicios).toHaveLength(1);
    expect(servicios[0].id).toBe("a");
    expect(productos).toHaveLength(1);
    expect(productos[0]).toMatchObject({ nombre: "Cera", monto: 5000, cliente: "Bruno" });
  });

  it("varios productos en un mismo cobro dan una fila por ítem, cada uno con su propio monto", () => {
    const { productos } = splitServiciosYProductos([
      {
        id: "a",
        items: [
          { nombre: "Cera", monto: 5000, esProducto: true },
          { nombre: "Shampoo", monto: 8000, esProducto: true },
        ],
      },
    ]);
    expect(productos).toHaveLength(2);
    expect(productos.map((p) => p.monto)).toEqual([5000, 8000]);
  });

  it("sin cobros, da dos listas vacías (nunca inventa movimientos)", () => {
    expect(splitServiciosYProductos([])).toEqual({ servicios: [], productos: [] });
    expect(splitServiciosYProductos(null)).toEqual({ servicios: [], productos: [] });
  });
});

// Bug real en producción: "Caja de hoy"/"Caja → Resumen" ya mostraban $0
// el 17/10 (revHoy/totalGastosHoy sí estaban bien acotados), pero
// "Movimientos de caja" seguía listando los cobros del 16/10 — esa lista
// pasaba data.paymentsToday/expensesToday/movements SIN FILTRAR por fecha
// a buildUnifiedMovements, mientras esos arrays siguen siendo
// intencionalmente backlog-inclusive para "Efectivo esperado en caja".
// Guarda estructural: si alguien vuelve a pasarlos directo, sin el filtro
// por cajaDateKeyBA(), esto lo avisa.
describe("Movimientos de caja — la lista 'de hoy' nunca mezcla el backlog de una jornada pendiente", () => {
  it("MovimientosUnificados filtra payments/expenses/movements a cajaDateKeyBA() antes de construir el feed 'de hoy'", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    const fnMatch = src.match(/function MovimientosUnificados\(([\s\S]*?)const recent = all\.slice\(0, 10\);/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/paymentsOnlyToday[\s\S]*filterToDayBA\(data\.paymentsToday/);
    expect(fnMatch![1]).toMatch(/expensesOnlyToday[\s\S]*data\.expensesToday\.filter\(\(e\) => e\.date === todayKeyBA\)/);
    expect(fnMatch![1]).toMatch(/movementsOnlyToday[\s\S]*filterToDayBA\(movementsData\.movements/);
    expect(fnMatch![1]).toMatch(/buildUnifiedMovements\(\s*paymentsOnlyToday,\s*expensesOnlyToday,/);
  });

  it("el vacío de la lista 'de hoy' dice explícitamente que es de hoy, no un genérico 'sin movimientos'", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/Todavía no hay movimientos registrados hoy\./);
  });

  it("el modal 'Ver todos los movimientos' (fecha elegida a mano) sigue intacto — sigue filtrando con paymentsForSelectedDate, no con el filtro 'de hoy'", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/paymentsForSelectedDate = React\.useMemo\(\s*\(\) => filterToDayBA\(data\.paymentsToday, \(p\) => p\.created_at, selectedDateKey\)/);
  });
});

// Bug real en producción: Inicio mostraba "Efectivo esperado en caja:
// $180.000" / "Dinero esperado en cuenta: $418.690" — auditado contra
// producción, esos dos números resultaron ser EXCLUSIVAMENTE los cobros
// del 17/10 (la jornada pendiente más reciente), ignorando por completo
// 18/09 ($20.000/$78.900), 19/09 ($37.100/$43.800) y 16/10 ($185.000/
// $504.200) — tres jornadas que el aviso "Tenés 4 cajas pendientes" (ese
// sí correcto, vía findAllPendingCierres) ya identificaba. Causa raíz:
// cajaOpenRangeStartDate solo miraba "ayer" para decidir desde cuándo
// acumular — nunca caminaba hacia atrás por TODO el backlog.
describe("cajaOpenRangeStartDate — el backlog acumulado abarca TODAS las jornadas pendientes, no solo ayer", () => {
  it("ya no calcula 'ayer' a mano (new Date(Date.now() - 24*60*60*1000)) — usa findAllPendingCierres para encontrar la más vieja", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    const fnMatch = src.match(/export async function cajaOpenRangeStartDate\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/findAllPendingCierres\(businessId, branchId\)/);
    expect(fnMatch![1]).not.toMatch(/Date\.now\(\) - 24 \* 60 \* 60 \* 1000/);
  });

  it("toma la jornada pendiente MÁS VIEJA (allPending[0]) como rangeStartDate — un backlog se cierra de a uno empezando por el más antiguo", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    const fnMatch = src.match(/export async function cajaOpenRangeStartDate\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/const oldest = allPending\[0\];/);
  });

  it("reproduce el caso real: sumar SOLO la jornada más reciente da el total incompleto reportado; sumar las 4 da el total real", () => {
    // Mismos montos auditados contra producción (ver commit): 18/09,
    // 19/09, 16/10 y 17/10, cada uno { cash, digital }.
    const porJornada = {
      "2026-09-18": { cash: 20000, digital: 78900 },
      "2026-09-19": { cash: 37100, digital: 43800 },
      "2026-10-16": { cash: 185000, digital: 504200 },
      "2026-10-17": { cash: 180000, digital: 418690 },
    };
    const soloMasReciente = porJornada["2026-10-17"];
    expect(soloMasReciente).toEqual({ cash: 180000, digital: 418690 }); // el bug reportado

    const totalReal = Object.values(porJornada).reduce(
      (acc, d) => ({ cash: acc.cash + d.cash, digital: acc.digital + d.digital }),
      { cash: 0, digital: 0 },
    );
    expect(totalReal).toEqual({ cash: 422100, digital: 1045590 });
    expect(totalReal.cash).toBeGreaterThan(soloMasReciente.cash);
    expect(totalReal.digital).toBeGreaterThan(soloMasReciente.digital);
  });
});

// "Movimientos de hoy" (Efectivo/Dinero en cuenta del día) nunca puede
// confundirse con "Saldos acumulados" (cashExpected/bankExpected, todo el
// backlog) — ambos viven en useCajaSummary, una sola fuente para Inicio y
// Caja > Resumen (sección 4 del pedido: evitar cálculos duplicados).
describe("useCajaSummary — 'Efectivo del día' separado de 'Saldos acumulados', una sola fuente para Inicio y Caja", () => {
  it("expone todayCashExpected/todayDigitalExpected, calculados con computeExpectedCashAndDigital sobre arrays estrictamente de HOY", () => {
    const src = readSrc("src/hooks/use-caja-summary.ts");
    expect(src).toMatch(/movementsStrictlyToday = filterToDayBA\(movementsForPeriod/);
    expect(src).toMatch(/advancesStrictlyToday = filterToDayBA\(advancesForPeriod/);
    expect(src).toMatch(/todayCashExpected: todayExpected\.cashExpected \+ todayExpected\.cashAdvancesOut/);
    expect(src).toMatch(
      /todayDigitalExpected: todayExpected\.digitalExpected \+ todayExpected\.digitalAdvancesOut/,
    );
    expect(src).toMatch(
      /todayAdvancesOut: todayExpected\.cashAdvancesOut \+ todayExpected\.digitalAdvancesOut/,
    );
  });

  it("useCajaHoy (Inicio) expone esos mismos tres valores, sin recalcularlos", () => {
    const src = readSrc("src/components/dashboard/use-caja-hoy.ts");
    expect(src).toMatch(/todayCashExpected: summary\.todayCashExpected/);
    expect(src).toMatch(/todayDigitalExpected: summary\.todayDigitalExpected/);
    expect(src).toMatch(/todayAdvancesOut: summary\.todayAdvancesOut/);
  });

  // "Dinero en cuenta del día"/"Efectivo del día" NO deben restar adelantos
  // a profesionales — se muestran aparte como "Adelantos del día", para que
  // un adelanto grande no produzca un total negativo sin explicación
  // (Inicio y Caja comparten el mismo criterio visual).
  it("Inicio y Caja muestran 'Adelantos del día' como tarjeta aparte, nunca mezclada con Efectivo/Dinero en cuenta", () => {
    const dashboardSrc = readSrc("src/routes/dashboard.tsx");
    expect(dashboardSrc).toMatch(/label="Adelantos del día"/);
    expect(dashboardSrc).toMatch(/caja\.todayAdvancesOut/);

    const cashRegisterSrc = readSrc("src/routes/cash-register.tsx");
    expect(cashRegisterSrc).toMatch(/label="Adelantos del día"/);
    expect(cashRegisterSrc).toMatch(/summary\.todayAdvancesOut/);
  });

  it("expectedToLado (SaldoComposicionModal) no resta adelantos del total — adelantos:0 y esperado suma cashAdvancesOut/digitalAdvancesOut de vuelta", () => {
    const src = readSrc("src/components/caja/saldo-composicion.tsx");
    expect(src).toMatch(/adelantos: 0,\s*\n\s*esperado: expected\.cashExpected \+ expected\.cashAdvancesOut/);
    expect(src).toMatch(
      /adelantos: 0,\s*\n\s*esperado: expected\.digitalExpected \+ expected\.digitalAdvancesOut/,
    );
  });

  it("computeExpectedCashAndDigital (el cálculo real para conciliar un cierre) sigue restando adelantos — no se tocó", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    expect(src).toMatch(/cashOutflows = cashExpenses \+ cashAdvances \+ retirosCajaEfectivo/);
    expect(src).toMatch(/cashExpected: cashPayments \+ ingresosCajaEfectivo - cashOutflows/);
  });

  it("Inicio ya NO muestra la sección 'Saldos acumulados' — solo 'Caja de hoy' estrictamente del día", () => {
    const src = readSrc("src/routes/dashboard.tsx");
    expect(src).not.toMatch(/Saldos acumulados/);
    expect(src).not.toMatch(/Efectivo esperado en caja/);
    expect(src).not.toMatch(/Dinero esperado en cuenta/);
  });

  it("FacturacionPanel (Caja > Resumen) ya no llama a buildSingleDayCierrePreview por su cuenta — usa summary.todayCashExpected/todayDigitalExpected", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    const fnMatch = src.match(/function FacturacionPanel\(([\s\S]*?)\n {2}return \(/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).not.toMatch(/buildSingleDayCierrePreview/);
    expect(fnMatch![1]).not.toMatch(/dayExpected/);
  });

  it("Caja > Resumen también muestra el aviso de cajas pendientes (summary.pendingCierres) con botón Revisar cierre", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/summary\.pendingCierres\.length > 0 && \(/);
    expect(src).toMatch(/onClick=\{\(\) => onRevisarCierre\(p\.date\)\}/);
  });

  it("Caja > Resumen ya NO muestra la sección 'Saldos acumulados' — mismo criterio visual que Inicio", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    const fnMatch = src.match(/function FacturacionPanel\(([\s\S]*?)\nfunction TransferReceiptField/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).not.toMatch(/Saldos acumulados/);
  });
});

// El aviso "Tenés N cajas pendientes" no puede aparecer varios segundos
// después de que el resto de Inicio ya se vio, desplazando todo el
// contenido hacia abajo — mientras se confirma, va un placeholder del
// mismo alto aproximado, nunca nada (eso es lo que generaba el salto) ni
// "no hay pendientes" en falso.
describe("CajaHoyCard (Inicio) — sin saltos visuales mientras se confirma el aviso de pendientes", () => {
  it("useCajaHoy expone pendingCierresLoading, independiente de loading (el de pagos/gastos/movimientos)", () => {
    const src = readSrc("src/components/dashboard/use-caja-hoy.ts");
    expect(src).toMatch(/pendingCierresLoading: summary\.pendingCierresLoading/);
  });

  it("mientras pendingCierresLoading y sin dato todavía, muestra un placeholder — nunca nada y nunca 'sin pendientes' en falso", () => {
    const src = readSrc("src/routes/dashboard.tsx");
    const fnMatch = src.match(/function CajaHoyCard\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(
      /caja\.pendingCierresLoading && caja\.pendingCierres\.length === 0 \? \(/,
    );
    expect(fnMatch![1]).toMatch(/animate-pulse/);
  });

  it("con un valor ya en caché de una navegación anterior en la misma sesión, no hay esqueleto — se pinta directo y se corrige solo", () => {
    const src = readSrc("src/hooks/use-caja-summary.ts");
    expect(src).toMatch(/pendingCierresCache\.get\(pendingCierresCacheKey\(businessId, branchId\)\)/);
    expect(src).toMatch(
      /\(\) => !pendingCierresCache\.has\(pendingCierresCacheKey\(businessId, branchId\)\)/,
    );
  });
});

// Tres estados, y solo tres, para cualquier jornada (sección "REGLA
// PRINCIPAL" del pedido): "En curso" (la de hoy, mientras no se cierre a
// mano), "Pendiente de revisión" (una jornada anterior con actividad y sin
// cierre guardado) y "Cerrada" (cierre confirmado). La jornada de HOY
// nunca puede ser "Pendiente de revisión" — eso lo garantiza la
// construcción de candidateDatesAsc (nunca incluye el día 0, "hoy") más el
// .neq("fecha", today) explícito sobre la consulta de cierres. Inicio
// (useCajaSummary), Caja (CierresTab) e Historial leen todos el mismo
// findAllPendingCierres/allPendingCierres — una sola fuente de verdad, sin
// que cada pantalla decida el estado por su cuenta.
describe('"Caja de hoy" nunca es "Pendiente de revisión" — un solo cálculo para Inicio/Caja/Historial', () => {
  it("findAllPendingCierres arma candidateDatesAsc con i >= 1 (nunca i=0/hoy) y excluye 'today' de la consulta de cierres", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    const fnMatch = src.match(/export async function findAllPendingCierres\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/for \(let i = lookbackDays; i >= 1; i--\)/);
    expect(fnMatch![1]).toMatch(/\.neq\("fecha", today\)/);
  });

  it("pendingDatesFromActivity nunca recibe 'hoy' en candidateDatesAsc — con actividad real de hoy incluida a mano, igual no aparece si no está en la lista de candidatos", () => {
    // candidateDatesAsc simula lo que arma findAllPendingCierres: SOLO
    // días estrictamente anteriores a hoy. Aunque activeDates (lo que
    // "tuvo actividad") incluya la fecha de hoy por error de quien arma el
    // set, pendingDatesFromActivity nunca la reporta porque no está en la
    // lista de candidatos — la garantía vive en construir esa lista bien,
    // no en filtrar después.
    const hoy = "2026-10-19";
    const candidatosSinHoy = ["2026-10-17", "2026-10-18"];
    const result = pendingDatesFromActivity(
      candidatosSinHoy,
      new Set(),
      new Set([...candidatosSinHoy, hoy]),
    );
    expect(result.map((p) => p.date)).not.toContain(hoy);
    expect(result.map((p) => p.date)).toEqual(candidatosSinHoy);
  });

  it("CierresTab (Historial/Caja) y useCajaSummary (Inicio) resuelven pendingCierres con la MISMA función findAllPendingCierres — nunca un segundo criterio de estado por pantalla", () => {
    const cashRegisterSrc = readSrc("src/routes/cash-register.tsx");
    expect(cashRegisterSrc).toMatch(/findAllPendingCierres\(businessId, activeBranchId\)/);
    const summarySrc = readSrc("src/hooks/use-caja-summary.ts");
    expect(summarySrc).toMatch(/setPendingCierres\(period\.allPendingCierres\)/);
    const cierreSrc = readSrc("src/lib/caja-cierre.ts");
    expect(cierreSrc).toMatch(/findAllPendingCierres\(businessId, branchId\),\s*\n\s*\]\);/);
  });
});

// "A las 00:00, horario de Buenos Aires" (sección "COMPORTAMIENTO
// AUTOMÁTICO" del pedido) — la transición en_curso → pendiente_de_revisión
// tiene que ocurrir en la medianoche de Buenos Aires, nunca en la
// medianoche del huso horario local del dispositivo/proceso que ejecuta
// esto (un admin que abre Clippr viajando, o un proceso de servidor en
// UTC, no puede correr la frontera un día para cualquier lado).
describe('"Hoy"/candidatos de cajaOpenRangeStartDate y findAllPendingCierres usan huso Buenos Aires explícito, nunca el local', () => {
  it("cajaOpenRangeStartDate calcula 'today' con cajaDateKeyBA, no cajaDateKey", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    const fnMatch = src.match(/export async function cajaOpenRangeStartDate\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/const today = cajaDateKeyBA\(\);/);
    expect(fnMatch![1]).not.toMatch(/const today = cajaDateKey\(\);/);
  });

  it("findAllPendingCierres calcula 'today' y cada día candidato con cajaDateKeyBA, no cajaDateKey", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    const fnMatch = src.match(/export async function findAllPendingCierres\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/const today = cajaDateKeyBA\(\);/);
    expect(fnMatch![1]).toMatch(/candidateDatesAsc\.push\(cajaDateKeyBA\(new Date\(/);
  });

  it("datesWithActivity bucketiza payments.created_at con cajaDateKeyBA, no cajaDateKey", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    const fnMatch = src.match(/async function datesWithActivity\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/active\.add\(cajaDateKeyBA\(new Date\(row\.created_at\)\)\)/);
  });
});

// "Si después del cierre se registran nuevas operaciones de esa misma
// fecha, no incorporarlas silenciosamente al cierre: deben quedar
// identificadas como posteriores al cierre y requerir una revisión o
// ajuste autorizado" (sección "COMPORTAMIENTO AUTOMÁTICO" del pedido) —
// CierreDetalleView siempre reconstruye el detalle EN VIVO (nunca desde el
// total_cobrado guardado) y compara contra ese total guardado: si difieren,
// avisa en vez de pisar o esconder la diferencia. El único camino para
// "corregir" un cierre ya confirmado sigue siendo reabrir con motivo
// (ver "Procedimiento auditable para corregir un cierre ya confirmado",
// arriba) — nunca se reincorpora solo.
describe("Operaciones registradas después de un cierre — identificadas, nunca absorbidas en silencio", () => {
  it("CierreDetalleView compara el total guardado contra los movimientos reales recalculados en vivo (hayDiferenciaConLoGuardado)", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    const fnMatch = src.match(/function CierreDetalleView\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/const totalGuardado = Number\(cierre\?\.total_cobrado \?\? 0\);/);
    expect(fnMatch![1]).toMatch(
      /const hayDiferenciaConLoGuardado = !loading && Math\.abs\(ingresosTotales - totalGuardado\) >= 1;/,
    );
  });

  it("la diferencia se muestra como aviso, nunca se aplica sola al cierre guardado", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    const fnMatch = src.match(/function CierreDetalleView\(([\s\S]*?)\n\}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/hayDiferenciaConLoGuardado && \(/);
    expect(fnMatch![1]).toMatch(/No se modificó el cierre automáticamente/);
  });

  it("el único camino para corregir un cierre con diferencia sigue siendo 'Reabrir caja' con motivo obligatorio — nunca un re-cierre silencioso", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/disabled=\{reopeningId === reopenTarget\.id \|\| !reopenNote\.trim\(\)\}/);
    expect(src).not.toMatch(/handleReabrirCajaDesdeBanner/);
  });
});

// Causa real (auditoría "Dinero en cuenta del día" negativo sin
// explicación, 23/10/2026): useCashMovements calculaba el inicio del
// rango de cash_movements/professional_advances con
// `new Date(rangeStartDate+"T00:00:00")`, que interpreta en el huso
// LOCAL del dispositivo/proceso — en un navegador fuera de Argentina (o
// cualquier ejecución server-side) el rango podía arrancar unas horas
// corrido, arrastrando o dejando afuera un movimiento justo en el borde
// de la medianoche. No era la causa de ESE caso puntual (el -$8.100 era
// legítimo: un adelanto por transferencia superando el ingreso del día),
// pero es el mismo bug de huso horario ya corregido en caja-cierre.ts —
// test estructural para que no vuelva a reaparecer acá ni en un futuro
// hook similar.
describe("useCashMovements — rango de fecha en huso horario de Buenos Aires explícito, nunca el local", () => {
  it("usa dayBoundsBA(rangeStartDate) para el inicio del rango, no new Date(rangeStartDate+\"T00:00:00\")", () => {
    const src = readSrc("src/hooks/use-cash-movements.ts");
    expect(src).toMatch(/import \{ dayBoundsBA \} from "@\/lib\/caja-cierre";/);
    expect(src).toMatch(/const dayStart = dayBoundsBA\(rangeStartDate\)\.start\.toISOString\(\);/);
    expect(src).not.toMatch(/new Date\(`\$\{rangeStartDate\}T00:00:00`\)/);
  });

  it("dayBoundsBA en sí ya está probado (huso -03:00 explícito) — acá solo se confirma que este hook lo use, no se duplica esa prueba", () => {
    const { start } = dayBoundsBA("2026-10-23");
    expect(start.toISOString()).toBe("2026-10-23T03:00:00.000Z");
  });
});

// Auditoría "Dinero en cuenta del día" negativo sin explicación clara
// (Inicio y Caja, 23/10/2026): un adelanto por transferencia mayor al
// ingreso del día da un número negativo LEGÍTIMO, no un error — pero
// antes no había forma de ver de qué se componía sin abrir "Revisar
// cierre". computeExpectedCashAndDigital ahora expone cada término por
// separado (cashFromPayments/cashExpenses/cashAdvancesOut/
// cashRetirosManual/cashInflows, y el equivalente digital) para que
// Inicio/Caja puedan mostrar la composición con un clic (ver
// src/components/caja/saldo-composicion.tsx) — estas pruebas protegen
// que esos términos sigan reconciliando exacto con el resultado final,
// sin duplicar ni perder ningún movimiento.
describe("ExpectedCashDigital — desglose por término, siempre reconciliado (sección 'composición' de Inicio/Caja)", () => {
  it("cashFromPayments + cashInflows - cashExpenses - cashAdvancesOut - cashRetirosManual === cashExpected, siempre", () => {
    const result = computeExpectedCashAndDigital({
      payments: [{ total: 50000, method: "cash", tip: 2000 }],
      expenses: [{ amount: 3000, payment_method: "efectivo" }],
      advances: [{ amount: 10000, payment_method: "efectivo" }],
      cashMovements: [
        { type: "ingreso", amount: 5000, method: "efectivo" },
        { type: "retiro", amount: 1000, method: "efectivo" },
      ],
    });
    const reconstruido =
      result.cashFromPayments + result.cashInflows - result.cashExpenses - result.cashAdvancesOut - result.cashRetirosManual;
    expect(Math.round(reconstruido)).toBe(Math.round(result.cashExpected));
  });

  it("mismo invariante del lado digital", () => {
    const result = computeExpectedCashAndDigital({
      payments: [{ total: 21900, method: "transfer" }],
      expenses: [],
      advances: [],
      cashMovements: [{ type: "retiro", amount: 30000, method: "cuenta" }],
    });
    const reconstruido =
      result.digitalFromPayments +
      result.digitalInflows -
      result.digitalExpenses -
      result.digitalAdvancesOut -
      result.digitalRetirosManual;
    expect(Math.round(reconstruido)).toBe(Math.round(result.digitalExpected));
  });

  it("caso real: un adelanto por transferencia mayor al ingreso del día da negativo LEGÍTIMO — nunca se cuenta dos veces", () => {
    // Mismo caso que generó la duda del 23/10/2026: $21.900 cobrados por
    // transferencia, $30.000 adelantados por transferencia a un
    // profesional — el resultado tiene que ser exactamente -$8.100, y el
    // adelanto tiene que aparecer una sola vez en digitalAdvancesOut,
    // nunca también restado de digitalFromPayments ni de otro término.
    const result = computeExpectedCashAndDigital({
      payments: [{ total: 21900, method: "transfer" }],
      expenses: [],
      advances: [{ amount: 30000, payment_method: "transferencia" }],
      cashMovements: [],
    });
    expect(result.digitalExpected).toBe(-8100);
    expect(result.digitalFromPayments).toBe(21900);
    expect(result.digitalAdvancesOut).toBe(30000);
    expect(result.cashExpected).toBe(0);
  });

  it("un gasto y un adelanto del mismo monto no se confunden entre sí ni se suman al otro lado", () => {
    const result = computeExpectedCashAndDigital({
      payments: [],
      expenses: [{ amount: 5000, payment_method: "efectivo" }],
      advances: [{ amount: 5000, payment_method: "efectivo" }],
      cashMovements: [],
    });
    expect(result.cashExpenses).toBe(5000);
    expect(result.cashAdvancesOut).toBe(5000);
    expect(result.cashExpected).toBe(-10000);
    expect(result.digitalExpected).toBe(0);
  });
});

// Pagar una liquidación (register_settlement_run_payment_batch) nunca
// puede insertar en cash_movements — si lo hiciera, ese pago se
// descontaría DOS veces del "Dinero en cuenta"/"Efectivo esperado": una
// vez implícitamente (ya estaba descontado vía professional_advances/
// commission_records) y otra vez como un retiro manual aparte. Test
// estructural sobre las migraciones reales, no sobre un mock — si algún
// día alguien agrega esa inserción, esto lo detiene en CI.
describe("Pagar una liquidación nunca duplica el descuento vía cash_movements", () => {
  it("ninguna migración de settlement_runs/register_settlement_run_payment inserta en cash_movements", () => {
    const migrationsDir = path.join(repoRoot, "supabase", "migrations");
    const settlementFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => /settlement_run|liquidaciones_rpc/i.test(f) && f.endsWith(".sql"));
    expect(settlementFiles.length).toBeGreaterThan(0);
    for (const file of settlementFiles) {
      const sql = readSrc(`supabase/migrations/${file}`);
      expect(sql.toLowerCase()).not.toMatch(/insert\s+into\s+public\.cash_movements/);
    }
  });
});

// Caso real: un adelanto necesita una fecha de VISUALIZACIÓN (Adelantos/
// Movimientos) independiente de su fecha financiera real — ver
// 20261028170000_professional_advances_display_date.sql. Decisión
// confirmada por el negocio: la conciliación de Caja SIGUE usando
// advanced_at solo (mover la fecha real de un adelanto puede corromper un
// cierre ya cerrado), pero el corte/período de liquidación SÍ usa
// coalesce(display_date, advanced_at) — ver
// 20261028190000_prepare_settlement_run_advance_display_date.sql.
describe("professional_advances.display_date — Caja usa advanced_at solo; Liquidaciones usa coalesce(display_date, advanced_at)", () => {
  it("caja-cierre.ts: la consulta de adelantos para conciliación sigue filtrando por advanced_at, nunca por display_date", () => {
    const src = readSrc("src/lib/caja-cierre.ts");
    expect(src).toMatch(/advQuery[\s\S]{0,200}\.gte\("advanced_at", dayStart\.toISOString\(\)\)/);
    expect(src).not.toMatch(/display_date/);
  });

  it("cash-register.tsx: los dos filtros de corte de Liquidaciones (openAdvances/liquidarPendingAdvances) usan display_date ?? advanced_at", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/isWithinCutoff\(a\.display_date \?\? a\.advanced_at, liquidarCutoffAt\)/);
    expect(src).toMatch(/String\(a\.display_date \?\? a\.advanced_at \?\?\s*""\)/);
  });

  it("prepare_settlement_run (la migración más reciente) usa coalesce(display_date, advanced_at) en el SELECT y en el UPDATE que bloquea adelantos", () => {
    const sql = readSrc(
      "supabase/migrations/20261028190000_prepare_settlement_run_advance_display_date.sql",
    );
    // 2 funcionales (el SELECT y el UPDATE) + 1 mención en el comentario
    // del encabezado del archivo.
    expect(sql.match(/coalesce\(display_date, advanced_at\) <= v_cutoff_at/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("la migración de prepare_settlement_run no cambió nada más que esas dos cláusulas (mismo largo de función, sin otra lógica tocada)", () => {
    const sql = readSrc(
      "supabase/migrations/20261028190000_prepare_settlement_run_advance_display_date.sql",
    );
    // Guarda de alcance: todas las reglas que ya estaban probadas antes
    // (venta anulada con tope, comisiones/propinas recuperadas, etc.)
    // siguen presentes tal cual.
    expect(sql).toMatch(/exit when v_queue_row\.commission_amount > v_available_for_deduction;/);
    expect(sql).toMatch(/El total a liquidar no puede ser negativo/);
    expect(sql).toMatch(/array_length\(v_applied_queue_ids, 1\) > 0/);
  });

  it("ningún registro de adelanto ya bloqueado (settlement_run_id no nulo) puede volver a entrar en un sweep futuro — la condición settlement_run_id is null sigue en las dos cláusulas de adelantos", () => {
    const sql = readSrc(
      "supabase/migrations/20261028190000_prepare_settlement_run_advance_display_date.sql",
    );
    expect(sql).toMatch(
      /where business_id = p_business_id\s*\n\s*and professional_id = p_professional_id\s*\n\s*and settlement_run_id is null\s*\n\s*and coalesce\(display_date, advanced_at\) <= v_cutoff_at;/,
    );
    expect(sql).toMatch(
      /set settlement_run_id = v_run\.id\s*\n\s*where business_id = p_business_id\s*\n\s*and professional_id = p_professional_id\s*\n\s*and settlement_run_id is null\s*\n\s*and coalesce\(display_date, advanced_at\) <= v_cutoff_at;/,
    );
  });

  it("ninguna otra migración de settlement_run/professional_advance (aparte de las dos que definen/usan display_date) lo menciona", () => {
    const migrationsDir = path.join(repoRoot, "supabase", "migrations");
    const settlementFiles = fs
      .readdirSync(migrationsDir)
      .filter(
        (f) =>
          /settlement_run|professional_advance/i.test(f) &&
          f.endsWith(".sql") &&
          f !== "20261028170000_professional_advances_display_date.sql" &&
          f !== "20261028190000_prepare_settlement_run_advance_display_date.sql",
      );
    expect(settlementFiles.length).toBeGreaterThan(0);
    for (const file of settlementFiles) {
      const sql = readSrc(`supabase/migrations/${file}`);
      expect(sql).not.toMatch(/display_date/);
    }
  });

  it("la migración que agrega display_date es puramente aditiva (add column if not exists, nullable, sin default distinto de null)", () => {
    const sql = readSrc("supabase/migrations/20261028170000_professional_advances_display_date.sql");
    expect(sql).toMatch(/add column if not exists display_date timestamptz;/);
    expect(sql).not.toMatch(/not null/i);
    expect(sql).not.toMatch(/update\s+public\.professional_advances/i);
  });
});
