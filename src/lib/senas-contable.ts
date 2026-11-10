// Contabilidad de señas — reglas puras (sin base de datos) para Caja, Inicio, cierre y reportes.
//
// Fechas que guarda cada seña:
//   - credited_at  = fecha REAL de acreditación (el día que el cliente transfirió / se recibió el dinero).
//   - approved_at  = fecha de APROBACIÓN en el local.
// Reglas (ver docs/senas-contabilidad.md):
//   Ingresos      → cuenta el día de aprobación (neto de devoluciones el día en que se devuelven).
//   Dinero cuenta → la seña suma el día en que se APRUEBA (va a "Recibidas"), sin importar qué día transfirió
//                   el cliente; nunca modifica una caja de un día anterior. Si la transferencia es de otro día,
//                   el cierre de dinero en cuenta lo avisa ("2 señas del domingo").
//   Venta         → al cobrar el turno, la parte pagada como seña NO vuelve a contar como ingreso.

export const BA_TZ = "America/Argentina/Buenos_Aires";

export const dayKeyBA = (d: string | Date): string => new Date(d).toLocaleDateString("en-CA", { timeZone: BA_TZ });

export const SENA_APPROVED_STATUSES = ["paid", "applied", "to_decide", "retained", "returned"] as const;

export type SenaLedgerRow = {
  id: string;
  amount: number; // paid_amount
  method: string | null; // transfer | cash | ...
  status: string;
  approved_at: string | null;
  credited_at: string | null;
  refund_amount?: number | null;
  decided_at?: string | null;
  client_name?: string | null;
  service_name?: string | null;
};

const isApproved = (d: SenaLedgerRow) => (SENA_APPROVED_STATUSES as readonly string[]).includes(d.status);
const isTransfer = (d: SenaLedgerRow) => (d.method ?? "transfer") !== "cash";

/** Movimiento de caja de una seña acreditada en un día distinto al de su aprobación. */
export function senaCreditedOtherDay(m: { deposit_id?: string | null; credited_at?: string | null; created_at?: string | null }): boolean {
  if (!m.deposit_id || !m.credited_at || !m.created_at) return false;
  return dayKeyBA(m.credited_at) !== dayKeyBA(m.created_at);
}

/**
 * Ingresos por señas a partir de los movimientos de caja de UN día (ya acotados a ese día por created_at):
 * el ingreso de la seña se crea al aprobarla y el retiro al devolverla, así que no hace falta otra consulta.
 */
export function senasIngresosDesdeMovimientos(
  movements: Array<{ type: string; amount: number | null; deposit_id?: string | null }>,
) {
  let aprobadas = 0;
  let devueltas = 0;
  for (const m of movements) {
    if (!m.deposit_id) continue;
    if (m.type === "ingreso") aprobadas += Number(m.amount) || 0;
    else if (m.type === "retiro") devueltas += Number(m.amount) || 0;
  }
  return { aprobadas, devueltas, neto: aprobadas - devueltas };
}

/** Ingresos por señas de un día: aprobadas ese día, menos las devueltas ese día. */
export function senasIngresosDelDia(deposits: SenaLedgerRow[], dayKey: string) {
  let aprobadas = 0;
  let devueltas = 0;
  for (const d of deposits) {
    if (isApproved(d) && d.approved_at && dayKeyBA(d.approved_at) === dayKey) aprobadas += Number(d.amount) || 0;
    if (d.status === "returned" && d.decided_at && dayKeyBA(d.decided_at) === dayKey) devueltas += Number(d.refund_amount) || 0;
  }
  return { aprobadas, devueltas, neto: aprobadas - devueltas };
}

/** Dinero en cuenta del día por señas: transferencias aprobadas ese día (sin importar el día de la transferencia). */
export function senasDineroEnCuentaDelDia(deposits: SenaLedgerRow[], dayKey: string): number {
  return deposits
    .filter((d) => isApproved(d) && isTransfer(d) && d.approved_at && dayKeyBA(d.approved_at) === dayKey)
    .reduce((s, d) => s + (Number(d.amount) || 0), 0);
}

export type SenaDetalleFila = SenaLedgerRow & { etiqueta: string; delDia: boolean };

const WEEKDAY = new Intl.DateTimeFormat("es-AR", { weekday: "long", timeZone: BA_TZ });

/** "Seña de hoy" / "Seña del domingo" según cuándo se recibió el dinero (respecto del día que se mira). */
export function senaEtiqueta(creditedAt: string | null, dayKey: string): string {
  if (!creditedAt) return "Seña de hoy";
  const k = dayKeyBA(creditedAt);
  if (k === dayKey) return "Seña de hoy";
  return `Seña del ${WEEKDAY.format(new Date(creditedAt))}`;
}

export type SenaMovimiento = {
  tipo: "ingreso" | "retiro";
  monto: number;
  depositId?: string | null;
  acreditadaEn?: string | null;
  creadoEn?: string | null;
};

const DIA_MES = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "numeric", timeZone: BA_TZ });

/**
 * Cómo se muestra un movimiento de caja de una seña (null si el movimiento no es de una seña):
 * "Seña de hoy" / "Seña del domingo" según cuándo transfirió el cliente respecto del día en que se aprobó,
 * y si la transferencia es de otro día (suma igual el día de la aprobación; solo se avisa).
 */
export function senaMovimientoInfo(m: SenaMovimiento, todayKey: string = dayKeyBA(new Date())) {
  if (!m.depositId) return null;
  if (m.tipo === "retiro") return { devolucion: true, otroDia: false, etiqueta: "Devolución de seña" };
  const otroDia = senaCreditedOtherDay({ deposit_id: m.depositId, credited_at: m.acreditadaEn, created_at: m.creadoEn });
  if (!otroDia) {
    const esHoy = !m.creadoEn || dayKeyBA(m.creadoEn) === todayKey;
    return { devolucion: false, otroDia, etiqueta: esHoy ? "Seña de hoy" : "Seña del día" };
  }
  const credited = new Date(m.acreditadaEn as string);
  const dias = Math.abs(new Date(m.creadoEn as string).getTime() - credited.getTime()) / 86_400_000;
  // Más de una semana de diferencia: el día de la semana solo sería ambiguo.
  const cuando = dias < 7 ? WEEKDAY.format(credited) : DIA_MES.format(credited);
  return { devolucion: false, otroDia, etiqueta: `Seña del ${cuando}` };
}

/**
 * Aviso para el cierre de dinero en cuenta: señas aprobadas ese día cuya transferencia es de otro día,
 * agrupadas por día ("2 señas del domingo", "1 seña del sábado"). Vacío si no hay ninguna.
 */
export function senasOtroDiaAviso(movs: SenaMovimiento[]): Array<{ texto: string; cantidad: number; monto: number }> {
  const grupos = new Map<string, { cuando: string; cantidad: number; monto: number; orden: string }>();
  for (const m of movs) {
    const info = senaMovimientoInfo(m);
    if (!info || info.devolucion || !info.otroDia) continue;
    const cuando = info.etiqueta.replace("Seña del ", "");
    const g = grupos.get(cuando) ?? { cuando, cantidad: 0, monto: 0, orden: m.acreditadaEn as string };
    g.cantidad += 1;
    g.monto += Number(m.monto) || 0;
    grupos.set(cuando, g);
  }
  return [...grupos.values()]
    .sort((x, y) => x.orden.localeCompare(y.orden))
    .map((g) => ({ texto: `${g.cantidad} ${g.cantidad === 1 ? "seña" : "señas"} del ${g.cuando}`, cantidad: g.cantidad, monto: g.monto }));
}

/** Señas aprobadas en un día, con su etiqueta y si cuentan para el dinero en cuenta de ese día. */
export function senasDetalleDelDia(deposits: SenaLedgerRow[], dayKey: string): SenaDetalleFila[] {
  return deposits
    .filter((d) => isApproved(d) && d.approved_at && dayKeyBA(d.approved_at) === dayKey)
    .map((d) => ({
      ...d,
      etiqueta: senaEtiqueta(d.credited_at, dayKey),
      delDia: Boolean(d.credited_at) && dayKeyBA(d.credited_at as string) === dayKey,
    }));
}

/** Ingreso de una venta sin la parte que ya se había pagado como seña (no se cuenta dos veces). */
export function saleIngreso(p: { total?: number | null; amount?: number | null; splits?: unknown }): number {
  const total = Number(p.total ?? p.amount ?? 0);
  const splits = Array.isArray(p.splits) ? (p.splits as Array<{ method?: string; amount?: number }>) : [];
  const sena = splits.filter((s) => s?.method === "sena").reduce((s, x) => s + (Number(x.amount) || 0), 0);
  return Math.max(0, total - sena);
}

/**
 * Total mensual de transferencias por fecha REAL de acreditación (independiente del día de aprobación y de
 * que la caja de ese día esté cerrada). Devuelve además las señas acreditadas en días con cierre, que son
 * las que explican la diferencia con la suma de los cierres diarios.
 */
export function senasTransferenciasDelMes(deposits: SenaLedgerRow[], monthKey: string, closedDays: Set<string>) {
  const delMes = deposits.filter((d) => isApproved(d) && isTransfer(d) && d.credited_at && dayKeyBA(d.credited_at).startsWith(monthKey));
  const total = delMes.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const enDiasCerrados = delMes.filter((d) => {
    const credit = dayKeyBA(d.credited_at as string);
    const approval = d.approved_at ? dayKeyBA(d.approved_at) : credit;
    return closedDays.has(credit) && approval !== credit;
  });
  return { total, enDiasCerrados, totalEnDiasCerrados: enDiasCerrados.reduce((s, d) => s + (Number(d.amount) || 0), 0) };
}
