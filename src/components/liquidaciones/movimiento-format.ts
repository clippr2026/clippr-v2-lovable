// Formatters compartidos por toda la UI de Movimientos (Caja > Liquidaciones
// y Panel del profesional) — antes vivían duplicados con leves diferencias
// en cash-register.tsx y professionals.tsx; centralizados acá para que las
// dos pantallas muestren exactamente lo mismo.
import { PAY_METHOD_LABEL, type PayMethod } from "@/components/cash-register/register-payment";

export function money(n: number) {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

// Tolerancia de "prácticamente saldado" — toda esta UI redondea a pesos
// enteros (ver money() arriba), así que un resto menor a $1 es un
// redondeo entre comisiones/adelantos con centavos, nunca plata real
// pendiente de cobrar. Una liquidación con status='parcial' en la base
// por culpa de $0,17 sin cobrar debe verse y comportarse como pagada en
// toda la UI (Historial, badge Pago total/parcial) — sin tocar el
// status real en settlement_runs, que sigue siendo la fuente de verdad
// para cualquier backend/auditoría.
const SETTLED_TOLERANCE = 1;
export function isRunEffectivelySettled(run: { status?: string | null; total_to_settle?: number | string | null; amount_paid?: number | string | null }) {
  if (run.status === "pagada") return true;
  const remaining = Number(run.total_to_settle ?? 0) - Number(run.amount_paid ?? 0);
  return remaining < SETTLED_TOLERANCE;
}
export function isPaymentFull(balanceAfter: number) {
  return balanceAfter < SETTLED_TOLERANCE;
}

// "23/07/2026, 14:32" — usado en el encabezado de cada card del listado.
export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// "23/07/2026 • 14:32 h" — formato de fecha y hora exacta usado dentro de
// los modales de detalle.
export function fmtDetalleDateTime(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} • ${time} h`;
}

// "04/10/2026" — formato argentino de una fecha SIN hora (period_start /
// cutoff_date son columnas `date` de Postgres, llegan como "YYYY-MM-DD"
// plano). Nunca usar `new Date(dateStr)` acá: en UTC-3 eso corre el día
// hacia atrás (misma clase de bug ya resuelta en cutoff_date — ver
// 20261011020000_settlement_run_cutoff_date_argentina_timezone.sql).
export function fmtDateOnly(dateStr: string | null | undefined) {
  const [y, m, d] = String(dateStr ?? "").slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "—";
}

// Notas técnicas dejadas por un script administrativo (ver sesiones de
// backfill) — quedan guardadas en la base para auditoría, pero nunca se le
// muestran al usuario: la fila "Nota" solo aplica a notas reales escritas
// por una persona para otra persona.
// "[[HIST]]..." es el marcador que use-caja-data.ts guarda en
// payments.observations para el historial interno de una venta de
// mostrador (JSON de eventos, ver cash-register.tsx) — nunca texto para el
// usuario. El patrón genérico [[MARCADOR]] cubre ese caso y cualquier otro
// marcador interno entre corchetes que se agregue a futuro, sin depender
// de listar cada uno.
const INTERNAL_NOTE_PATTERNS = [
  /^Liquidaci[oó]n registrada v[ií]a script administrativo/i,
  /^\[\[[A-Z_]+\]\]/,
];
export function isInternalNote(note: string | null | undefined) {
  const trimmed = String(note ?? "").trim();
  return trimmed !== "" && INTERNAL_NOTE_PATTERNS.some((re) => re.test(trimmed));
}

// Nota real lista para mostrar: null si está vacía o es un marcador
// interno (ver isInternalNote) — nunca devuelve basura técnica.
export function realNote(note: string | null | undefined) {
  const trimmed = String(note ?? "").trim();
  if (!trimmed || isInternalNote(trimmed)) return null;
  return trimmed;
}

// Algunas cuentas quedaron con su username técnico como full_name en vez de
// un nombre real (ej. "alangmelgar") — acá se traduce a lo que la persona
// realmente usa puertas adentro, puramente visual, nunca toca profiles.full_name.
const KNOWN_RESPONSABLE_NAMES: Record<string, string> = {
  alangmelgar: "Alan",
};

// Los registros más viejos guardaron el email de sesión como "registrado
// por" — si lo que hay guardado parece un email, mostramos solo la parte
// antes de la @ en vez del email completo.
export function displayResponsable(name: string | null | undefined) {
  const raw = String(name ?? "").trim();
  if (!raw) return "Caja";
  const stripped = raw.includes("@") ? raw.split("@")[0] || "Caja" : raw;
  return KNOWN_RESPONSABLE_NAMES[stripped.toLowerCase()] ?? stripped;
}

export function paymentMethodLabel(method: string | null | undefined) {
  return PAY_METHOD_LABEL[(method ?? "") as PayMethod] ?? method ?? "Sin método";
}
