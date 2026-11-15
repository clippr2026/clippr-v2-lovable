import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// Con qué barbero se atiende cada cliente, según sus turnos COBRADOS (los cancelados y los "no asistió" no cuentan).
//   · 3 o más turnos y los últimos 3 con el mismo barbero → VIP de ese barbero.
//   · 3 o más turnos y los últimos 3 con barberos distintos → con cualquiera.
//   · 2 turnos: con el mismo barbero ("dos") o con dos distintos ("distintos").
//   · 1 turno: con ese barbero ("uno").
export type TipoBarbero = "vip" | "dos" | "distintos" | "uno" | "cualquiera";
export type InfoBarbero = { tipo: TipoBarbero; empleados: string[] };

const PAGINA = 1000;

export function useClientBarberos(businessId: string | null) {
  return useQuery({
    queryKey: ["clients-barberos", businessId],
    enabled: !!businessId,
    staleTime: 60_000,
    queryFn: async () => {
      const turnos: Array<{ client_id: string; employee_id: string }> = [];
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
        turnos.push(...((data ?? []) as Array<{ client_id: string; employee_id: string }>));
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

      // turnos ya vienen del más nuevo al más viejo
      const porCliente = new Map<string, string[]>();
      for (const t of turnos) {
        const lista = porCliente.get(t.client_id) ?? [];
        lista.push(t.employee_id);
        porCliente.set(t.client_id, lista);
      }
      const info = new Map<string, InfoBarbero>();
      porCliente.forEach((lista, id) => {
        const unicos = Array.from(new Set(lista));
        const ult3 = Array.from(new Set(lista.slice(0, 3)));
        if (lista.length >= 3) {
          info.set(id, ult3.length === 1 ? { tipo: "vip", empleados: ult3 } : { tipo: "cualquiera", empleados: unicos });
        } else if (lista.length === 2) {
          info.set(id, unicos.length === 1 ? { tipo: "dos", empleados: unicos } : { tipo: "distintos", empleados: unicos });
        } else {
          info.set(id, { tipo: "uno", empleados: unicos });
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
      return `VIP de ${n(i.empleados[0])}`;
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

export function EtiquetaBarbero({ info, nombres, className }: { info: InfoBarbero | undefined; nombres: Map<string, string>; className?: string }) {
  const texto = etiquetaBarbero(info, nombres);
  if (!texto) return null;
  const vip = info?.tipo === "vip";
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1",
        vip
          ? "bg-gradient-to-r from-amber-300/20 to-violet-400/15 text-amber-100 ring-amber-300/40"
          : "bg-white/5 text-white/70 ring-white/10",
        className,
      )}
    >
      {texto}
    </span>
  );
}
