// Formatters compartidos por toda la UI de Movimientos (Caja > Liquidaciones
// y Panel del profesional) — antes vivían duplicados con leves diferencias
// en cash-register.tsx y professionals.tsx; centralizados acá para que las
// dos pantallas muestren exactamente lo mismo.
import { PAY_METHOD_LABEL, type PayMethod } from "@/components/cash-register/register-payment";

export function money(n: number) {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
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

// Los registros más viejos guardaron el email de sesión como "registrado
// por" — si lo que hay guardado parece un email, mostramos solo la parte
// antes de la @ en vez del email completo.
export function displayResponsable(name: string | null | undefined) {
  const raw = String(name ?? "").trim();
  if (!raw) return "Caja";
  return raw.includes("@") ? raw.split("@")[0] || "Caja" : raw;
}

export function paymentMethodLabel(method: string | null | undefined) {
  return PAY_METHOD_LABEL[(method ?? "") as PayMethod] ?? method ?? "Sin método";
}
