// Deudas de clientes: se agrupan por cliente para las notificaciones. El aviso está mientras haya saldo.

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
