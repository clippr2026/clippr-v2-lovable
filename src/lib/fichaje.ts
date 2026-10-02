import { supabase } from "@/integrations/supabase/client";
import { DAY_KEYS, normalizeEmployeeSchedule, parseTimeStrict } from "@/lib/availability";

// Fichaje de jornada — kiosco QR/código por sucursal, entrada/salida desde
// el panel del propio profesional, descuento por tardanza configurable.

export type LatenessRule = {
  id: string;
  branch_id: string;
  min_minutes: number;
  max_minutes: number | null;
  discount_type: "percent" | "fixed";
  discount_value: number;
};

export type WorkSession = {
  id: string;
  business_id: string;
  branch_id: string;
  employee_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  expected_start_at: string | null;
  late_minutes: number;
  source: string;
  created_at: string;
  edited_by: string | null;
  edited_at: string | null;
  edit_reason: string | null;
  original_clock_in_at: string | null;
  original_clock_out_at: string | null;
};

function todayKey(date = new Date()) {
  return date.toLocaleDateString("sv-SE");
}

// Código del día para una sucursal — se crea solo la primera vez que el
// kiosco (o cualquier otra pantalla) lo necesita ese día. 6 caracteres,
// mayúsculas+dígitos, sin ambigüedad visual (sin 0/O, 1/I).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateCode(length = 6) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

// El código es único por sucursal Y por día a nivel de TODO el negocio
// (índice (date, code) además del (branch_id, date) — ver migración
// 20260930070000): "Ingresar código" en el panel del profesional solo
// conoce el código, no la sucursal, y necesita poder resolverla sin
// ambigüedad buscando nada más que (fecha, código).
export async function getOrCreateDailyCode(businessId: string, branchId: string): Promise<string> {
  const date = todayKey();
  const { data: existing } = await supabase
    .from("branch_checkin_codes" as any)
    .select("code")
    .eq("branch_id", branchId)
    .eq("date", date)
    .maybeSingle();
  if ((existing as any)?.code) return (existing as any).code as string;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const { data: inserted, error } = await supabase
      .from("branch_checkin_codes" as any)
      .insert({ business_id: businessId, branch_id: branchId, date, code })
      .select("code")
      .maybeSingle();
    if (!error) return ((inserted as any)?.code as string) ?? code;

    // 23505 = unique_violation. Puede ser (a) otro dispositivo ya creó el
    // código de ESTA sucursal (carrera) — leer y listo; o (b) el código
    // random eligió uno que otra sucursal ya usa hoy — generar otro y
    // reintentar.
    const { data: existingNow } = await supabase
      .from("branch_checkin_codes" as any)
      .select("code")
      .eq("branch_id", branchId)
      .eq("date", date)
      .maybeSingle();
    if ((existingNow as any)?.code) return (existingNow as any).code as string;
    if (attempt === 4) throw new Error(error.message);
  }
  throw new Error("No se pudo generar el código de fichaje.");
}

export async function validateDailyCode(branchId: string, code: string): Promise<boolean> {
  const { data } = await supabase
    .from("branch_checkin_codes" as any)
    .select("code")
    .eq("branch_id", branchId)
    .eq("date", todayKey())
    .maybeSingle();
  return Boolean(data && String((data as any).code).toUpperCase() === code.toUpperCase());
}

// "Ingresar código" (panel del profesional) — resuelve la sucursal a
// partir del código solo, sin que el profesional la haya elegido antes.
export async function resolveBranchFromCode(
  code: string,
): Promise<{ branchId: string; businessId: string } | null> {
  const { data } = await supabase
    .from("branch_checkin_codes" as any)
    .select("branch_id,business_id")
    .eq("date", todayKey())
    .ilike("code", code.trim())
    .maybeSingle();
  if (!data) return null;
  return { branchId: (data as any).branch_id as string, businessId: (data as any).business_id as string };
}

// Una fila por profesional que ya fichó hoy — entrada/salida reales
// (clock_in_at/clock_out_at) y la hora esperada (expected_start_at), las 3
// ya calculadas y guardadas por clockIn() — acá solo se leen, nunca se
// recalculan. clockOutAt null = todavía en curso.
export type FichajeHoyPersona = {
  id: string;
  name: string;
  clockInAt: string;
  clockOutAt: string | null;
  expectedStartAt: string | null;
};

export type FichajeHoySummary = {
  code: string;
  fichados: number;
  pendientes: number;
  fichadosDetalle: FichajeHoyPersona[];
  pendientesNames: string[];
};

// Resumen para la tarjeta "Fichaje de jornada" de Inicio — cuántos
// profesionales de esta sucursal ya ficharon hoy vs cuántos todavía no
// (sobre el total de profesionales activos de la sucursal), con el detalle
// de entrada/salida de cada uno para que Inicio pueda mostrarlo sin volver
// a pedirle nada al kiosco/panel del profesional.
export async function getTodayFichajeSummary(
  businessId: string,
  branchId: string,
): Promise<FichajeHoySummary> {
  const code = await getOrCreateDailyCode(businessId, branchId);
  const dayStart = new Date(`${todayKey()}T00:00:00`).toISOString();

  const [{ data: sessions }, { data: employees }] = await Promise.all([
    supabase
      .from("work_sessions" as any)
      .select("employee_id,clock_in_at,clock_out_at,expected_start_at")
      .eq("business_id", businessId)
      .eq("branch_id", branchId)
      .gte("clock_in_at", dayStart)
      .order("clock_in_at", { ascending: true }),
    supabase
      .from("employees")
      .select("id,full_name")
      .eq("business_id", businessId)
      .eq("branch_id", branchId)
      .eq("is_active", true),
  ]);

  // Última sesión de hoy por profesional — si fichó entrada/salida más de
  // una vez en el día, la que importa mostrar es la más reciente (el array
  // ya viene ordenado por clock_in_at ascendente, así que el último .set
  // para cada employee_id es siempre el más nuevo).
  type SessionRow = { employee_id: string; clock_in_at: string; clock_out_at: string | null; expected_start_at: string | null };
  const latestByEmployee = new Map<string, SessionRow>();
  for (const s of (sessions ?? []) as SessionRow[]) {
    latestByEmployee.set(s.employee_id, s);
  }

  const activos = (employees ?? []) as { id: string; full_name: string | null }[];
  const fichadosDetalle: FichajeHoyPersona[] = [];
  const pendientesNames: string[] = [];

  for (const e of activos) {
    const s = latestByEmployee.get(e.id);
    if (s) {
      fichadosDetalle.push({
        id: e.id,
        name: e.full_name ?? "Profesional",
        clockInAt: s.clock_in_at,
        clockOutAt: s.clock_out_at,
        expectedStartAt: s.expected_start_at,
      });
    } else {
      pendientesNames.push(e.full_name ?? "Profesional");
    }
  }

  // En curso primero (más accionable), después los que ya terminaron —
  // dentro de cada grupo, orden de llegada.
  fichadosDetalle.sort((a, b) => {
    const aOpen = a.clockOutAt === null;
    const bOpen = b.clockOutAt === null;
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    return new Date(a.clockInAt).getTime() - new Date(b.clockInAt).getTime();
  });

  return {
    code,
    fichados: fichadosDetalle.length,
    pendientes: pendientesNames.length,
    fichadosDetalle,
    pendientesNames,
  };
}

export async function getOpenWorkSession(employeeId: string): Promise<WorkSession | null> {
  const dayStart = new Date(`${todayKey()}T00:00:00`).toISOString();
  const { data } = await supabase
    .from("work_sessions" as any)
    .select("*")
    .eq("employee_id", employeeId)
    .is("clock_out_at", null)
    .gte("clock_in_at", dayStart)
    .order("clock_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as WorkSession | null) ?? null;
}

// Jornada de hoy de un profesional, abierta o ya cerrada — a diferencia de
// getOpenWorkSession (solo abiertas), esta es la que usa la vista
// admin/dueño en Profesionales para mostrar el resumen de solo lectura
// ("Sin fichar" / "Entrada" / "Entrada · Salida").
export async function getTodaySessionForEmployee(employeeId: string): Promise<WorkSession | null> {
  const dayStart = new Date(`${todayKey()}T00:00:00`).toISOString();
  const { data } = await supabase
    .from("work_sessions" as any)
    .select("*")
    .eq("employee_id", employeeId)
    .gte("clock_in_at", dayStart)
    .order("clock_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as WorkSession | null) ?? null;
}

// Horario esperado de ESTE profesional para hoy, desde
// business_settings.schedule._employeeSchedules (mismo origen que usa
// Agenda) — null si no tiene horario configurado para hoy (no bloquea el
// fichaje, solo no calcula tardanza).
async function resolveExpectedStartToday(businessId: string, employeeId: string): Promise<Date | null> {
  const { data } = await supabase
    .from("business_settings")
    .select("schedule")
    .eq("business_id", businessId)
    .maybeSingle();
  const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
  const rawEmpScheds = (schedule._employeeSchedules ?? {}) as Record<string, unknown>;
  const normalized = normalizeEmployeeSchedule(rawEmpScheds[employeeId]);
  if (!normalized) return null;

  const now = new Date();
  const dayKey = DAY_KEYS[now.getDay()];
  const day = normalized[dayKey];
  if (!day?.enabled) return null;
  const startMin = parseTimeStrict(day.start);
  if (startMin == null) return null;

  const expected = new Date(now);
  expected.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
  return expected;
}

// Exportada para que la UI (Inicio) pueda clasificar Temprano/A
// tiempo/Tarde con el mismo criterio exacto que ya usa clockIn acá abajo
// para calcular late_minutes — nunca un número duplicado a mano.
export const TOLERANCE_MINUTES = 5;

export async function clockIn({
  businessId,
  branchId,
  employeeId,
}: {
  businessId: string;
  branchId: string;
  employeeId: string;
}): Promise<WorkSession> {
  const now = new Date();
  const expected = await resolveExpectedStartToday(businessId, employeeId);
  const lateMinutesRaw = expected ? Math.round((now.getTime() - expected.getTime()) / 60000) : 0;
  const lateMinutes = Math.max(0, lateMinutesRaw - TOLERANCE_MINUTES);

  const { data, error } = await supabase
    .from("work_sessions" as any)
    .insert({
      business_id: businessId,
      branch_id: branchId,
      employee_id: employeeId,
      clock_in_at: now.toISOString(),
      expected_start_at: expected ? expected.toISOString() : null,
      late_minutes: lateMinutes,
      source: "kiosk",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const session = data as WorkSession;

  if (lateMinutes > 0) {
    await applyLatenessDiscount({
      businessId,
      branchId,
      employeeId,
      workSessionId: session.id,
      expectedStartAt: expected,
      actualStartAt: now,
      lateMinutes,
    });
  }

  return session;
}

export async function clockOut(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from("work_sessions" as any)
    .update({ clock_out_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("clock_out_at", null);
  if (error) throw new Error(error.message);
}

function findMatchingRule(rules: LatenessRule[], lateMinutes: number): LatenessRule | null {
  return (
    rules.find(
      (r) => lateMinutes >= r.min_minutes && (r.max_minutes == null || lateMinutes <= r.max_minutes),
    ) ?? null
  );
}

// Comisión generada por el profesional EN EL DÍA (misma fuente que
// Liquidaciones: commission_records) — el tope para no generar saldo
// negativo con el descuento.
async function getCommissionAvailableToday(businessId: string, employeeId: string): Promise<number> {
  const dayStart = new Date(`${todayKey()}T00:00:00`).toISOString();
  const dayEnd = new Date(`${todayKey()}T23:59:59.999`).toISOString();
  const { data } = await supabase
    .from("commission_records" as any)
    .select("amount")
    .eq("business_id", businessId)
    .eq("employee_id", employeeId)
    .gte("created_at", dayStart)
    .lte("created_at", dayEnd);
  return ((data ?? []) as any[]).reduce((s, r) => s + Number(r.amount ?? 0), 0);
}

async function applyLatenessDiscount({
  businessId,
  branchId,
  employeeId,
  workSessionId,
  expectedStartAt,
  actualStartAt,
  lateMinutes,
}: {
  businessId: string;
  branchId: string;
  employeeId: string;
  workSessionId: string;
  expectedStartAt: Date | null;
  actualStartAt: Date;
  lateMinutes: number;
}): Promise<void> {
  const { data: rulesData } = await supabase
    .from("lateness_rules" as any)
    .select("*")
    .eq("branch_id", branchId)
    .order("min_minutes", { ascending: true });
  const rules = (rulesData ?? []) as LatenessRule[];
  const rule = findMatchingRule(rules, lateMinutes);
  if (!rule) return;

  const commissionAvailable = await getCommissionAvailableToday(businessId, employeeId);
  const requested =
    rule.discount_type === "percent"
      ? Math.round((commissionAvailable * rule.discount_value) / 100)
      : Math.round(rule.discount_value);
  const applied = Math.max(0, Math.min(requested, commissionAvailable));

  await supabase.from("lateness_discounts" as any).insert({
    business_id: businessId,
    branch_id: branchId,
    employee_id: employeeId,
    work_session_id: workSessionId,
    date: todayKey(),
    expected_start_at: expectedStartAt ? expectedStartAt.toISOString() : null,
    actual_start_at: actualStartAt.toISOString(),
    late_minutes: lateMinutes,
    rule_id: rule.id,
    commission_available: commissionAvailable,
    discount_amount_requested: requested,
    discount_amount_applied: applied,
  });
}
