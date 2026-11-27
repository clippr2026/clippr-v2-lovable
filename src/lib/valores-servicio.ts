import { resolveServicePricing, type EmployeeServiceOverrideMap } from "@/lib/service-pricing";

export type ServicioDeCatalogo = {
  id: string;
  name: string | null;
  price: number | null;
  duration_min: number | null;
  active?: boolean | null;
};

/**
 * Precio y duración vigentes de un servicio (por nombre) para un profesional. Una recurrencia no tiene valores
 * propios: sigue lo que diga el catálogo. Devuelve null si el servicio ya no está con ese nombre.
 */
export function valoresVigentes(
  catalogo: ServicioDeCatalogo[],
  nombre: string,
  employeeId: string | null | undefined,
  overrides: EmployeeServiceOverrideMap | null | undefined,
): { price: number; duration_min: number } | null {
  const buscado = nombre.trim().toLowerCase();
  const servicio = catalogo.find(
    (s) => s.active !== false && s.duration_min != null && (s.name ?? "").trim().toLowerCase() === buscado,
  );
  if (!servicio) return null;
  const r = resolveServicePricing({ id: servicio.id, price: servicio.price, duration_min: servicio.duration_min }, employeeId, overrides);
  return { price: r.price, duration_min: r.duration_min };
}
