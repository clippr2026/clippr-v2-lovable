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
  it("use-caja-summary.ts atrapa el error de findAllPendingCierres y sigue con la lista vacía", () => {
    const src = readSrc("src/hooks/use-caja-summary.ts");
    expect(src).toMatch(/findAllPendingCierres\(businessId, branchId\)\.catch\(/);
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
    expect(src).toMatch(/todayCashExpected: todayExpected\.cashExpected/);
    expect(src).toMatch(/todayDigitalExpected: todayExpected\.digitalExpected/);
  });

  it("useCajaHoy (Inicio) expone esos mismos dos valores, sin recalcularlos", () => {
    const src = readSrc("src/components/dashboard/use-caja-hoy.ts");
    expect(src).toMatch(/todayCashExpected: summary\.todayCashExpected/);
    expect(src).toMatch(/todayDigitalExpected: summary\.todayDigitalExpected/);
  });

  it("Inicio separa visualmente 'Saldos acumulados' (con subtítulo de jornadas pendientes), nunca lo muestra junto a 'Movimientos de hoy' sin etiquetar", () => {
    const src = readSrc("src/routes/dashboard.tsx");
    expect(src).toMatch(/Saldos acumulados/);
    expect(src).toMatch(/Incluye \{caja\.pendingCierres\.length\} jornada/);
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

  it("Caja también muestra una sección 'Saldos acumulados' separada, identificada con la cantidad de jornadas pendientes", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toMatch(/Saldos acumulados/);
    expect(src).toMatch(/Incluye \{summary\.pendingCierres\.length\} jornada/);
  });
});
