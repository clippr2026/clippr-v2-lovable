import { supabase } from "@/integrations/supabase/client";

// Helpers de "Cierre de caja" (caja_cierres) — compartidos entre Caja
// (src/routes/cash-register.tsx, históricamente donde vivía todo esto) e
// Inicio (tarjeta "Caja de hoy" / "Caja vencida"). Movidos acá para que
// ambas pantallas usen exactamente la misma lógica, sin duplicarla.

export type CierreMetodoDetalle = {
  ingresos: number;
  gastos: number;
  utilidad: number;
};

export type CajaEvento = {
  tipo?: string | null;
  fecha_hora?: string | null;
  hora?: string | null;
  usuario?: string | null;
  observacion?: string | null;
  motivo?: string | null;
  [key: string]: unknown;
};

export function cajaEventosArray(value: unknown): CajaEvento[] {
  return Array.isArray(value) ? (value as CajaEvento[]) : [];
}

export function appendCajaEvento(
  prevEventos: unknown,
  evento: CajaEvento,
): CajaEvento[] {
  return [...cajaEventosArray(prevEventos), evento];
}

export function cleanCajaEventosForDisplay(events: CajaEvento[]): CajaEvento[] {
  const cleaned: CajaEvento[] = [];

  for (const event of events) {
    const previous = cleaned[cleaned.length - 1];
    const sameAsPrevious =
      previous &&
      previous.tipo === event.tipo &&
      previous.hora === event.hora &&
      previous.usuario === event.usuario &&
      (previous.observacion ?? null) === (event.observacion ?? null) &&
      (previous.motivo ?? null) === (event.motivo ?? null);

    if (!sameAsPrevious) cleaned.push(event);
  }

  return cleaned;
}

export function isCajaCerradaRow(cierre: any) {
  return String(cierre?.estado ?? "").toLowerCase() === "cerrada";
}

export function isCajaReabiertaRow(cierre: any) {
  return String(cierre?.estado ?? "").toLowerCase() === "reabierta";
}

export function cajaDateKey(date = new Date()) {
  return date.toLocaleDateString("sv-SE");
}

export function cajaTimeLabel(date = new Date()) {
  return (
    date.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + "hs"
  );
}

export function cajaHoraDisplay(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "—") return "—";
  const direct = raw.match(/^(\d{1,2}):(\d{2})/);
  if (direct) return `${direct[1].padStart(2, "0")}:${direct[2]}hs`;

  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const min = ampm[2];
    const suffix = ampm[3].toLowerCase();
    if (suffix.includes("p") && h < 12) h += 12;
    if (suffix.includes("a") && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${min}hs`;
  }

  return raw.replace(/\s*a\.\s*m\.?/i, "hs").replace(/\s*p\.\s*m\.?/i, "hs");
}

export function cajaEventTimeToMinutes(value?: string | null) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function sortCajaEventos(events: CajaEvento[]) {
  return [...events].sort((a, b) => {
    const at = String(a.fecha_hora ?? "");
    const bt = String(b.fecha_hora ?? "");
    if (at && bt) return at.localeCompare(bt);
    return cajaEventTimeToMinutes(a.hora) - cajaEventTimeToMinutes(b.hora);
  });
}

export function getCajaLastEvent(cierre: any, tipo?: string) {
  const events = sortCajaEventos(cajaEventosArray(cierre?.eventos));
  const filtered = tipo ? events.filter((event) => event.tipo === tipo) : events;
  return filtered[filtered.length - 1] ?? null;
}

export function getCajaFirstEvent(cierre: any, tipo?: string) {
  const events = sortCajaEventos(cajaEventosArray(cierre?.eventos));
  return (tipo ? events.find((event) => event.tipo === tipo) : events[0]) ?? null;
}

export function cierreNeedsAutomaticClose(cierre: any, today = cajaDateKey()) {
  if (!cierre?.id) return false;
  if (!isCajaReabiertaRow(cierre)) return false;
  const fecha = String(cierre?.fecha ?? "").slice(0, 10);
  return Boolean(fecha && fecha < today);
}

// payments.method/expenses.payment_method usan vocabularios distintos
// ("cash" vs "efectivo", etc.) — normaliza ambos a la misma clave canónica
// antes de agrupar, para no duplicar filas del mismo método en el desglose.
export function normalizeCierreMethodKey(method: string | null | undefined): string {
  const raw = String(method || "").trim().toLowerCase();
  if (!raw) return "cash";
  const stripped = raw.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (stripped === "cash" || stripped === "efectivo") return "cash";
  if (stripped === "transfer" || stripped === "transferencia") return "transfer";
  if (
    stripped === "card" ||
    stripped === "tarjeta" ||
    stripped === "debito" ||
    stripped === "credito"
  )
    return "card";
  if (stripped === "mp" || stripped === "mercado pago" || stripped === "mercadopago")
    return "mp";
  if (stripped === "qr") return "qr";
  if (stripped === "cuenta") return "cuenta";
  return raw;
}

// Fecha desde la que hay que calcular los totales de "la caja abierta":
// si hay una caja vencida (pendingCierre, ver findPendingCierre más abajo)
// el rango arranca en SU fecha de apertura, no en la fecha calendario de
// hoy — una caja permanece abierta (y sus movimientos le siguen
// perteneciendo) hasta que se cierra explícitamente, nunca se resetea sola
// al cruzar la medianoche. Sin pendingCierre, el rango es el de siempre
// (desde hoy 00:00).
export function cajaOpenRangeStartDate(
  pendingCierre: PendingCierre | null,
  today = cajaDateKey(),
): string {
  return pendingCierre?.date || today;
}

// Snapshot financiero de un rango [dateStr 00:00, endDate] — por defecto un
// solo día calendario (si no se pasa endDate, termina a las 23:59:59.999 de
// ESE MISMO dateStr), pero admite un endDate posterior para abarcar varios
// días: es lo que necesita cerrar una "Caja vencida" que viene acumulando
// movimientos desde un día anterior hasta el momento real del cierre (ver
// closeCierreForDate). Se usa tanto para armar el registro de un cierre
// (automático o de "Caja vencida") como para detectar si un día tuvo
// actividad (findPendingCierre) — mismo formato exacto que un cierre
// manual, para que el detalle del historial funcione igual sea cual sea el
// tipo de cierre.
export async function buildCierreSnapshotForDate(
  businessId: string,
  dateStr: string,
  branchId?: string | null,
  endDate?: Date,
) {
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = endDate ?? new Date(`${dateStr}T23:59:59.999`);
  const endDateStr = cajaDateKey(dayEnd);

  // branch_id = null nunca se excluye (.or en vez de .eq) — mismo criterio
  // que use-caja-data.ts: un cobro/gasto real con branch_id null (fila
  // vieja o nacida antes de que activeBranchId resolviera) no puede faltar
  // del cierre del día.
  const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

  let payQuery = supabase
    .from("payments")
    .select(
      "id,total,amount,method,payment_method,client_name,service_name,created_at,employee_id,charged_by,charge_type",
    )
    .eq("business_id", businessId)
    .gte("created_at", dayStart.toISOString())
    .lte("created_at", dayEnd.toISOString());
  if (branchFilter) payQuery = payQuery.or(branchFilter);

  // expenses.date es solo fecha (sin hora) — con endDate > dateStr (caja
  // vencida que cruzó medianoche) el rango cubre todos los días
  // intermedios, no solo el de apertura.
  let expQuery = supabase
    .from("expenses")
    .select("id,name,amount,type,category,payment_method,date,note,created_at,user_name,created_by")
    .eq("business_id", businessId)
    .gte("date", dateStr)
    .lte("date", endDateStr);
  if (branchFilter) expQuery = expQuery.or(branchFilter);

  const [payRes, expRes] = await Promise.allSettled([payQuery, expQuery]);

  const payments =
    payRes.status === "fulfilled" && !payRes.value.error ? ((payRes.value.data ?? []) as any[]) : [];
  const expenses =
    expRes.status === "fulfilled" && !expRes.value.error ? ((expRes.value.data ?? []) as any[]) : [];

  const totalCobrado = payments.reduce((s, p) => s + Number(p.total ?? p.amount ?? 0), 0);
  const totalGastos = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const utilidad = totalCobrado - totalGastos;

  const detalleMetodos: Record<string, CierreMetodoDetalle> = {};
  const ensure = (method: string | null | undefined) => {
    const key = normalizeCierreMethodKey(method);
    if (!detalleMetodos[key]) detalleMetodos[key] = { ingresos: 0, gastos: 0, utilidad: 0 };
    return detalleMetodos[key];
  };
  for (const p of payments) {
    ensure(p.method ?? p.payment_method).ingresos += Number(p.total ?? p.amount ?? 0);
  }
  for (const e of expenses) {
    ensure(e.payment_method ?? e.method).gastos += Number(e.amount ?? 0);
  }
  Object.values(detalleMetodos).forEach((row) => {
    row.utilidad = row.ingresos - row.gastos;
  });

  const cobrosSnapshot = payments.map((p) => ({
    id: p.id,
    hora: p.created_at
      ? new Date(p.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
      : null,
    cliente: p.client_name ?? null,
    profesional: p.employee_name ?? p.professional_name ?? null,
    servicio: p.service_name ?? null,
    metodo: p.method ?? p.payment_method ?? null,
    monto: Number(p.total ?? p.amount ?? 0),
    usuario: p.charged_by ?? p.created_by ?? null,
  }));

  const gastosSnapshot = expenses.map((e) => ({
    id: e.id,
    hora: e.created_at
      ? new Date(e.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
      : null,
    nombre: e.name ?? e.concept ?? e.category ?? "Gasto",
    tipo: e.type ?? e.category ?? null,
    metodo: e.payment_method ?? e.method ?? null,
    monto: Number(e.amount ?? 0),
    nota: e.note ?? null,
    usuario: e.user_name ?? e.created_by ?? null,
  }));

  // Pendientes no tienen una fecha de "creado ese día" reconstruible con
  // precisión (no hay columna de fecha en la cola de Pendientes, ver
  // useCajaData) — este snapshot es del estado ACTUAL al momento del
  // cierre, no una reconstrucción histórica exacta de cómo estaba a
  // medianoche.
  let apptQuery = supabase
    .from("appointments")
    .select("id,client_name,service_name,service_price,starts_at,notes,status")
    .eq("business_id", businessId)
    .ilike("notes", "%[PENDIENTE_CAJA]%")
    .not("status", "in", "(charged,cancelled,blocked)");
  if (branchFilter) apptQuery = apptQuery.or(branchFilter);

  const [apptRes, bsRes] = await Promise.allSettled([
    apptQuery,
    supabase.from("business_settings").select("schedule").eq("business_id", businessId).maybeSingle(),
  ]);
  const pendingAppts = apptRes.status === "fulfilled" && !apptRes.value.error ? ((apptRes.value.data ?? []) as any[]) : [];
  const bsSchedule = (bsRes.status === "fulfilled" && !bsRes.value.error ? (bsRes.value.data?.schedule ?? {}) : {}) as Record<string, unknown>;
  const walkInPending = (Array.isArray(bsSchedule._pendingWalkInSales) ? (bsSchedule._pendingWalkInSales as any[]) : [])
    .filter((w) => w.status !== "rechazado");

  const pendientesDetalle = [
    ...pendingAppts.map((a) => ({
      id: a.id,
      cliente: a.client_name ?? null,
      servicio: a.service_name ?? null,
      monto: Number(a.service_price ?? 0),
      hora_envio: a.starts_at ? new Date(a.starts_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : null,
    })),
    ...walkInPending.map((w) => ({
      id: w.id,
      cliente: w.client_name ?? null,
      servicio: w.service_name ?? null,
      monto: Number(w.service_price ?? 0),
      hora_envio: w.starts_at ? new Date(w.starts_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : null,
    })),
  ];
  const pendientesMonto = pendientesDetalle.reduce((s, p) => s + p.monto, 0);

  return {
    totalCobrado,
    totalGastos,
    utilidad,
    detalleMetodos,
    cobrosSnapshot,
    gastosSnapshot,
    cantidadCobros: payments.length,
    hadActivity: payments.length > 0 || expenses.length > 0,
    pendientesCount: pendientesDetalle.length,
    pendientesMonto,
    pendientesDetalle,
  };
}

export type PendingCierre = { date: string; cierreId: string | null };

// Detecta si hay una "Caja vencida": el día más reciente CON actividad que
// nunca se cerró (ni manual ni automáticamente), siempre que sea anterior a
// hoy. NUNCA cierra nada sola — eso requiere la acción explícita del
// usuario ("Cerrar caja vencida", ver closeCierreForDate más abajo). Antes
// existía un auto-cierre silencioso (autoCloseExpiredCajaSession, ya
// eliminado) que cerraba solo el día anterior apenas alguien abría Caja —
// se sacó a propósito: la caja tiene que quedar abierta hasta que un
// humano la cierre.
export async function findPendingCierre(
  businessId: string | null,
  branchId: string | null,
): Promise<PendingCierre | null> {
  if (!businessId) return null;

  const today = cajaDateKey();
  const yesterday = cajaDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));

  let lastCierreQuery = supabase
    .from("caja_cierres" as any)
    .select("*")
    .eq("business_id", businessId);
  if (branchId) lastCierreQuery = lastCierreQuery.eq("branch_id", branchId);
  const { data: lastCierre, error } = await lastCierreQuery
    .order("fecha", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  // Caso 1: una caja REABIERTA (ver reabrirCaja) que se dejó abierta y ya
  // pasó su día — esa fecha queda pendiente de volver a cerrar.
  if (cierreNeedsAutomaticClose(lastCierre, today)) {
    return { date: String((lastCierre as any).fecha), cierreId: (lastCierre as any).id as string };
  }

  // Caso 2: el día de ayer nunca se cerró (ni manual ni automáticamente) y
  // tuvo actividad real — ese es el día pendiente.
  let yesterdayQuery = supabase
    .from("caja_cierres" as any)
    .select("id,eventos,estado")
    .eq("business_id", businessId)
    .eq("fecha", yesterday);
  if (branchId) yesterdayQuery = yesterdayQuery.eq("branch_id", branchId);
  const { data: yesterdayCierre, error: yError } = await yesterdayQuery.maybeSingle();
  if (yError) throw yError;

  if (!isCajaCerradaRow(yesterdayCierre)) {
    const snapshot = await buildCierreSnapshotForDate(businessId, yesterday, branchId);
    if (lastCierre?.id || snapshot.hadActivity) {
      return { date: yesterday, cierreId: ((yesterdayCierre as any)?.id as string | undefined) ?? null };
    }
  }

  return null;
}

// Cierra explícitamente un día puntual (hoy o un día vencido) — acción
// siempre disparada por un click real del usuario, nunca sola.
export async function closeCierreForDate({
  businessId,
  branchId,
  dateStr,
  closedBy,
  mode,
}: {
  businessId: string;
  branchId: string | null;
  dateStr: string;
  closedBy: string;
  mode: "manual" | "automatico";
}) {
  let existingQuery = supabase
    .from("caja_cierres" as any)
    .select("id,eventos,estado")
    .eq("business_id", businessId)
    .eq("fecha", dateStr);
  if (branchId) existingQuery = existingQuery.eq("branch_id", branchId);
  const { data: existingCierre, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) throw existingError;

  if (isCajaCerradaRow(existingCierre)) {
    return { closed: false, alreadyClosed: true };
  }

  // endDate = "ahora", nunca el fin del día de apertura: una caja vencida
  // sigue acumulando movimientos (de ese día y de los que pasaron después,
  // ver cajaOpenRangeStartDate) hasta este mismo instante del cierre — el
  // snapshot tiene que incluir todo eso, no solo lo que pasó el día que se
  // abrió.
  const now = new Date();
  const snapshot = await buildCierreSnapshotForDate(businessId, dateStr, branchId, now);
  const evento: CajaEvento = {
    tipo: "cierre",
    modo: mode,
    fecha_hora: now.toISOString(),
    hora: mode === "automatico" ? "00:00hs" : cajaTimeLabel(now),
    usuario: closedBy,
    observacion: mode === "automatico" ? "Cierre automático de fin de día." : "Cierre de caja vencida.",
    pendientes_count: snapshot.pendientesCount,
    pendientes_monto: snapshot.pendientesMonto,
    pendientes_detalle: snapshot.pendientesDetalle,
  };
  const payload = {
    business_id: businessId,
    branch_id: branchId,
    fecha: dateStr,
    hora_cierre: evento.hora,
    usuario_nombre: closedBy,
    closed_by: closedBy,
    tipo_cierre: mode,
    estado: "cerrada",
    observacion: evento.observacion,
    total_cobrado: snapshot.totalCobrado,
    total_gastos: snapshot.totalGastos,
    utilidad: snapshot.utilidad,
    cantidad_cobros: snapshot.cantidadCobros,
    detalle_metodos_pago: snapshot.detalleMetodos,
    cobros_snapshot: snapshot.cobrosSnapshot,
    gastos_snapshot: snapshot.gastosSnapshot,
    eventos: appendCajaEvento((existingCierre as any)?.eventos, evento),
    updated_at: now.toISOString(),
  };

  const query = (existingCierre as any)?.id
    ? supabase
        .from("caja_cierres" as any)
        .update(payload)
        .eq("id", (existingCierre as any).id)
        .eq("business_id", businessId)
        .neq("estado", "cerrada")
        .select("id")
        .maybeSingle()
    : supabase.from("caja_cierres" as any).insert(payload).select("id").maybeSingle();

  const { data: saved, error: saveError } = await query;
  if (saveError) throw saveError;
  if (saved?.id) {
    window.dispatchEvent(new CustomEvent("clippr:caja-cierre-guardado"));
    return { closed: true };
  }

  return { closed: false };
}
