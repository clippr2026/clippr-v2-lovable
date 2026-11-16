import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// Con qué barbero se atiende cada cliente, según sus turnos COBRADOS y las ventas de un servicio cargadas en caja sin turno
// (los cancelados, los "no asistió" y las ventas de solo producto no cuentan).
//   · 3 o más turnos y los últimos 3 con el mismo barbero → VIP de ese barbero.
//   · 3 o más turnos y los últimos 3 con barberos distintos → con cualquiera.
//   · 2 turnos: con el mismo barbero ("dos") o con dos distintos ("distintos").
//   · 1 turno: con ese barbero ("uno").
export type TipoBarbero = "vip" | "dos" | "distintos" | "uno" | "cualquiera";
export type InfoBarbero = {
  tipo: TipoBarbero;
  empleados: string[];
  /** Cuántas atenciones tuvo con cada barbero (id, cantidad), de más a menos. */
  conteo?: Array<[string, number]>;
};

const PAGINA = 1000;

export function useClientBarberos(businessId: string | null) {
  return useQuery({
    queryKey: ["clients-barberos", businessId],
    enabled: !!businessId,
    staleTime: 60_000,
    queryFn: async () => {
      // Atenciones = turnos cobrados + ventas de un servicio cargadas en caja sin turno (las de solo producto no cuentan).
      const atenciones: Array<{ client_id: string; employee_id: string; fecha: string }> = [];
      for (let desde = 0; ; desde += PAGINA) {
        const { data, error } = await supabase
          .from("appointments")
          .select("client_id,employee_id,starts_at")
          .eq("business_id", businessId!)
          .eq("status", "charged" as never)
          .not("client_id", "is", null)
          .not("employee_id", "is", null)
          .order("starts_at", { ascending: false })
          .range(desde, desde + PAGINA - 1);
        if (error) throw new Error("Error cargando turnos de los clientes: " + error.message);
        ((data ?? []) as Array<{ client_id: string; employee_id: string; starts_at: string }>).forEach((t) =>
          atenciones.push({ client_id: t.client_id, employee_id: t.employee_id, fecha: t.starts_at }),
        );
        if ((data ?? []).length < PAGINA) break;
      }

      // Ventas sin turno: van al cliente de la venta o, si no tiene, a las fichas con ese nombre (igual que los grupos).
      const idsPorNombre = new Map<string, string[]>();
      for (let desde = 0; ; desde += PAGINA) {
        const { data, error } = await supabase
          .from("clients")
          .select("id,full_name")
          .eq("business_id", businessId!)
          .range(desde, desde + PAGINA - 1);
        if (error) throw new Error("Error cargando clientes: " + error.message);
        ((data ?? []) as Array<{ id: string; full_name: string | null }>).forEach((c) => {
          const k = (c.full_name ?? "").trim().toLowerCase();
          if (k) idsPorNombre.set(k, [...(idsPorNombre.get(k) ?? []), c.id]);
        });
        if ((data ?? []).length < PAGINA) break;
      }
      for (let desde = 0; ; desde += PAGINA) {
        const { data, error } = await supabase
          .from("payments")
          .select("client_id,client_name,employee_id,created_at,items")
          .eq("business_id", businessId!)
          .is("appointment_id", null)
          .not("employee_id", "is", null)
          .order("created_at", { ascending: false })
          .range(desde, desde + PAGINA - 1);
        if (error) throw new Error("Error cargando ventas de los clientes: " + error.message);
        (
          (data ?? []) as Array<{ client_id: string | null; client_name: string | null; employee_id: string; created_at: string; items: unknown }>
        ).forEach((v) => {
          const soloProducto =
            Array.isArray(v.items) && v.items.length > 0 && v.items.every((it) => Boolean((it as { is_catalog?: boolean } | null)?.is_catalog));
          if (soloProducto) return;
          const ids = v.client_id ? [v.client_id] : idsPorNombre.get((v.client_name ?? "").trim().toLowerCase()) ?? [];
          ids.forEach((id) => atenciones.push({ client_id: id, employee_id: v.employee_id, fecha: v.created_at }));
        });
        if ((data ?? []).length < PAGINA) break;
      }

      const { data: emps, error: errEmps } = await supabase
        .from("employees")
        .select("id,full_name")
        .eq("business_id", businessId!);
      if (errEmps) throw new Error("Error cargando barberos: " + errEmps.message);
      const nombres = new Map<string, string>();
      ((emps ?? []) as Array<{ id: string; full_name: string | null }>).forEach((e) =>
        nombres.set(e.id, (e.full_name ?? "").trim().split(/\s+/)[0] || "Sin nombre"),
      );

      // de la más nueva a la más vieja
      atenciones.sort((x, y) => (x.fecha < y.fecha ? 1 : x.fecha > y.fecha ? -1 : 0));
      const porCliente = new Map<string, string[]>();
      for (const t of atenciones) {
        const lista = porCliente.get(t.client_id) ?? [];
        lista.push(t.employee_id);
        porCliente.set(t.client_id, lista);
      }
      const info = new Map<string, InfoBarbero>();
      porCliente.forEach((lista, id) => {
        const cuenta = new Map<string, number>();
        lista.forEach((e) => cuenta.set(e, (cuenta.get(e) ?? 0) + 1));
        const conteo = Array.from(cuenta.entries()).sort((a, b) => b[1] - a[1]);
        const unicos = Array.from(new Set(lista));
        const ult3 = Array.from(new Set(lista.slice(0, 3)));
        if (lista.length >= 3) {
          info.set(id, ult3.length === 1 ? { tipo: "vip", empleados: ult3, conteo } : { tipo: "cualquiera", empleados: unicos, conteo });
        } else if (lista.length === 2) {
          info.set(id, unicos.length === 1 ? { tipo: "dos", empleados: unicos, conteo } : { tipo: "distintos", empleados: unicos, conteo });
        } else {
          info.set(id, { tipo: "uno", empleados: unicos, conteo });
        }
      });
      return { info, nombres };
    },
  });
}

export function etiquetaBarbero(i: InfoBarbero | undefined, nombres: Map<string, string>): string | null {
  if (!i) return null;
  const n = (id: string) => nombres.get(id) ?? "Sin nombre";
  switch (i.tipo) {
    case "vip":
      return `Con ${n(i.empleados[0])}`;
    case "dos":
      return `Con ${n(i.empleados[0])} · 2 turnos`;
    case "distintos":
      return `Con ${i.empleados.map(n).join(" y ")}`;
    case "uno":
      return `Con ${n(i.empleados[0])}`;
    default:
      return "Con cualquiera";
  }
}

/** A qué barbero cuenta el cliente en el resumen: los de un solo barbero van con él; el resto, "con cualquiera". */
export function barberoPrincipal(i: InfoBarbero | undefined): string | null {
  if (!i) return null;
  return i.tipo === "vip" || i.tipo === "dos" || i.tipo === "uno" ? i.empleados[0] : "cualquiera";
}

export function EtiquetaBarbero({
  info,
  nombres,
  permitirVip = true,
  className,
}: {
  info: InfoBarbero | undefined;
  nombres: Map<string, string>;
  /** false en Nuevos, Una visita y Sin visitas: ahí un cliente de un solo barbero se muestra como "Con X", no como VIP. */
  permitirVip?: boolean;
  className?: string;
}) {
  if (info?.tipo === "vip" && !permitirVip) info = { tipo: "uno", empleados: info.empleados };
  const texto = etiquetaBarbero(info, nombres);
  if (!texto) return null;
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1",
        "bg-white/5 text-white/70 ring-white/10",
        className,
      )}
    >
      {texto}
    </span>
  );
}
