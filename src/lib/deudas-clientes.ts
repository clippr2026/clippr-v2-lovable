// Deudas de clientes: se agrupan por cliente para las notificaciones. «No avisar más» oculta el aviso (la deuda
// sigue anotada y aparece al cobrarle); se guarda en el dispositivo, por negocio. Una deuda nueva vuelve a avisar.

export type FilaDeuda = {
  id: string;
  client_id: string | null;
  client_name: string | null;
  total: number | null;
  amount: number | null;
  collected_amount: number | null;
  created_at: string;
};

export type DeudaCliente = {
  clave: string;
  nombre: string;
  total: number;
  /** Ventas (payments.id) con saldo. */
  ids: string[];
  /** Fecha de la deuda más reciente. */
  fecha: string;
};

export const saldoDe = (f: Pick<FilaDeuda, "total" | "amount" | "collected_amount">) =>
  Math.max(0, Number(f.total ?? f.amount ?? 0) - Number(f.collected_amount ?? 0));

export function agruparDeudas(filas: FilaDeuda[]): DeudaCliente[] {
  const grupos = new Map<string, DeudaCliente>();
  for (const f of filas) {
    const saldo = saldoDe(f);
    if (saldo <= 0) continue;
    const nombre = (f.client_name ?? "").trim();
    // Sin ficha ni nombre no hay con qué juntarlas: cada venta va sola.
    const clave = f.client_id ?? (nombre ? `nombre:${nombre.toLowerCase()}` : `venta:${f.id}`);
    const g = grupos.get(clave) ?? { clave, nombre: nombre || "Cliente sin nombre", total: 0, ids: [], fecha: f.created_at };
    g.total += saldo;
    g.ids.push(f.id);
    if (f.created_at > g.fecha) g.fecha = f.created_at;
    grupos.set(clave, g);
  }
  return [...grupos.values()];
}

/** El aviso se oculta solo si todas sus ventas fueron silenciadas. */
export const sinSilenciadas = (deudas: DeudaCliente[], silenciadas: ReadonlySet<string>) =>
  deudas.filter((d) => d.ids.some((id) => !silenciadas.has(id)));

const clave = (businessId: string) => `clippr_deudas_silenciadas:${businessId}`;

export function leerSilenciadas(businessId: string): Set<string> {
  try {
    const guardado = JSON.parse(localStorage.getItem(clave(businessId)) ?? "[]");
    return new Set(Array.isArray(guardado) ? guardado.map(String) : []);
  } catch {
    return new Set();
  }
}

function guardar(businessId: string, ids: Set<string>) {
  try {
    localStorage.setItem(clave(businessId), JSON.stringify([...ids]));
  } catch {
    // Sin almacenamiento (modo privado): el aviso vuelve a aparecer.
  }
}

export function silenciarDeuda(businessId: string, ids: string[], silenciar = true) {
  const actuales = leerSilenciadas(businessId);
  for (const id of ids) {
    if (silenciar) actuales.add(id);
    else actuales.delete(id);
  }
  guardar(businessId, actuales);
}
