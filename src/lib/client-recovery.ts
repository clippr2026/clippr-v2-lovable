// Definición única de "clientes para recuperar": son los del grupo Perdidos de la pantalla Clientes (campo `grupo`).
// Si no llega el grupo, se usa el estado viejo:
// Sale del estado que ya calcula la base para el módulo Clientes
// (activo hasta 45 días, inactivo de 46 a 59, perdido desde 60), así Clientes, Radar y Gerente IA cuentan lo mismo.
//
//   · inactivo     → 46 a 59 días sin volver y sin turno reservado.
//   · recuperable  → perdido (60 a 179 días) con 2 o más visitas: ya eran clientes de la casa.
//   · no_volvio    → perdido (60 a 179 días) con una sola visita: vino una vez y no volvió.
//   · archivado    → 180 días o más: no se cuenta como oportunidad.
// Quien ya tiene un turno reservado figura como activo/nuevo en la base y nunca entra acá.
export const RECOVERY_ARCHIVE_DAYS = 180;

export type RecoveryGroup = "inactivo" | "recuperable" | "no_volvio" | "archivado";

export type RecoveryInput = {
  /** Grupo de Clientes. Cuando viene, manda: solo "perdido" es para recuperar. */
  grupo?: string | null;
  status?: string | null;
  visits: number;
  lastVisitDays?: number | null;
};

export function classifyRecovery(c: RecoveryInput): RecoveryGroup | null {
  if (c.visits < 1) return null;
  if (c.grupo != null) return c.grupo === "perdido" ? (c.visits >= 2 ? "recuperable" : "no_volvio") : null;
  if (c.status === "inactivo") return "inactivo";
  if (c.status === "perdido") {
    if ((c.lastVisitDays ?? 0) >= RECOVERY_ARCHIVE_DAYS) return "archivado";
    return c.visits >= 2 ? "recuperable" : "no_volvio";
  }
  return null;
}

export type RecoveryCounts = Record<RecoveryGroup, number> & { paraRecuperar: number };

export function countRecovery(clients: RecoveryInput[]): RecoveryCounts {
  const counts: RecoveryCounts = { inactivo: 0, recuperable: 0, no_volvio: 0, archivado: 0, paraRecuperar: 0 };
  for (const c of clients) {
    const g = classifyRecovery(c);
    if (g) counts[g] += 1;
  }
  // Para recuperar = todo menos lo archivado.
  counts.paraRecuperar = counts.inactivo + counts.recuperable + counts.no_volvio;
  return counts;
}

/** ¿Este cliente es una oportunidad de recuperación (inactivo, recuperable o que no volvió)? */
export const esParaRecuperar = (c: RecoveryInput): boolean => {
  const g = classifyRecovery(c);
  return g === "inactivo" || g === "recuperable" || g === "no_volvio";
};
