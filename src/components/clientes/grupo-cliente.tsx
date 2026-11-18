import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// Grupos de clientes por frecuencia de visita. La clasificación vive en la base de datos
// (clippr_clientes_grupos_v1); acá solo se lee y se muestra.
export type ClientGrupo =
  | "nuevo"
  | "una_visita"
  | "sin_visitas"
  | "semanal"
  | "quincenal"
  | "tres_semanas"
  | "mensual"
  | "dos_meses"
  | "perdido";

export const GRUPOS_CLIENTE: Array<{
  key: ClientGrupo;
  label: string;
  corto: string;
  cls: string;
  glow: string;
  /** Color del grupo ("r, g, b") para tintar su tarjeta. */
  rgb: string;
  regla: string;
}> = [
  { key: "nuevo", label: "Nuevos", corto: "NUEVO", cls: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30", glow: "bg-emerald-500/20",
    rgb: "52, 211, 153",
    regla: "Vinieron una sola vez hace menos de 30 días, o tienen un turno por venir. Al volver, pasan al grupo de su frecuencia." },
  { key: "una_visita", label: "Una visita", corto: "UNA VISITA", cls: "bg-fuchsia-400/10 text-fuchsia-300 ring-fuchsia-400/30", glow: "bg-fuchsia-500/20",
    rgb: "232, 121, 249",
    regla: "Vinieron una sola vez y pasaron entre 30 y 59 días sin volver: es la lista para invitarlos a reservar. A los 60 días pasan a Perdidos. Si vuelven, pasan al grupo que les toque por el tiempo entre sus visitas." },
  { key: "sin_visitas", label: "Sin visitas", corto: "SIN VISITAS", cls: "bg-white/5 text-muted-foreground ring-white/10", glow: "bg-slate-500/20",
    rgb: "148, 163, 184",
    regla: "Están cargados como clientes, pero todavía no tienen ninguna visita con pago registrado." },
  { key: "semanal", label: "Semanal", corto: "SEMANAL", cls: "bg-gradient-to-r from-amber-300/20 to-violet-400/15 text-amber-100 ring-amber-300/40", glow: "bg-amber-500/25",
    rgb: "252, 211, 77",
    regla: "Vuelven cada 10 días o menos, según sus últimas 3 visitas: una vez por semana." },
  { key: "quincenal", label: "2 semanas", corto: "2 SEMANAS", cls: "bg-sky-300/10 text-sky-200 ring-sky-300/30", glow: "bg-sky-400/20",
    rgb: "125, 200, 255",
    regla: "Vuelven cada 11 a 17 días, según sus últimas 3 visitas." },
  { key: "tres_semanas", label: "3 semanas", corto: "3 SEMANAS", cls: "bg-blue-400/10 text-blue-300 ring-blue-400/30", glow: "bg-blue-500/20",
    rgb: "79, 156, 255",
    regla: "Vuelven cada 18 a 25 días, según sus últimas 3 visitas." },
  { key: "mensual", label: "Mensual", corto: "MENSUAL", cls: "bg-blue-500/10 text-blue-400 ring-blue-500/30", glow: "bg-blue-600/20",
    rgb: "59, 115, 246",
    regla: "Vuelven cada 26 a 45 días, según sus últimas 3 visitas." },
  { key: "dos_meses", label: "2 meses o más", corto: "2 MESES O MÁS", cls: "bg-indigo-400/10 text-indigo-300 ring-indigo-400/30", glow: "bg-indigo-500/20",
    rgb: "99, 102, 241",
    regla: "Tardan más de 45 días en volver. Incluye a quien vuelve después de varios meses en su segunda visita." },
  { key: "perdido", label: "Perdidos", corto: "PERDIDO", cls: "bg-rose-400/10 text-rose-300 ring-rose-400/30", glow: "bg-rose-500/20",
    rgb: "251, 113, 133",
    regla: "Dejaron de venir. Si tenían 2 o más visitas: llevan más de 1,5 veces lo que suelen tardar (mínimo 30 días, máximo 120). Si vinieron una sola vez: pasaron 60 días desde esa visita sin volver. Sin turno por venir." },
];

/** "VIP de un barbero" solo existe para quien ya tiene un ritmo de visitas: no en Nuevos, Una visita ni Sin visitas. */
export const grupoPermiteVip = (g: ClientGrupo | null | undefined) => g !== "nuevo" && g !== "una_visita" && g !== "sin_visitas";

export const grupoInfo = (g: ClientGrupo | null | undefined) => GRUPOS_CLIENTE.find((x) => x.key === g) ?? null;

type GrupoRow = { client_id: string; grupo: ClientGrupo; cada_dias: number | string | null; ultima_visita: string | null; dias_visitas: number; gasto: number | string | null };

export function useClientGroups(businessId: string | null) {
  return useQuery({
    queryKey: ["clients-grupos", businessId],
    enabled: !!businessId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clippr_clientes_grupos_v1" as any, { p_business_id: businessId });
      if (error) throw new Error("Error cargando grupos de clientes: " + error.message);
      const rows = (data ?? []) as GrupoRow[];
      // Fichas genéricas ("Sin agendar"): no se muestran en Clientes. Si la columna todavía no existe, no hay ninguna.
      const { data: gen, error: errGen } = await supabase
        .from("clients")
        .select("id")
        .eq("business_id", businessId!)
        .eq("es_generico" as never, true as never);
      const genericos = new Set<string>(errGen ? [] : ((gen ?? []) as unknown as Array<{ id: string }>).map((g) => g.id));
      const porCliente = new Map<string, GrupoRow>();
      const counts: Record<string, number> = {};
      for (const r of rows) {
        porCliente.set(r.client_id, r);
        counts[r.grupo] = (counts[r.grupo] ?? 0) + 1;
      }
      return { porCliente, counts, genericos };
    },
  });
}

export function GrupoBadge({ grupo, className }: { grupo: ClientGrupo | null | undefined; className?: string }) {
  const info = grupoInfo(grupo);
  if (!info) return null;
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1", info.cls, className)}>
      {info.corto.charAt(0) + info.corto.slice(1).toLowerCase()}
    </span>
  );
}

type Cambio = { fecha: string; grupo: ClientGrupo; motivo: string };

// Cambios de grupo del cliente, del más reciente al más viejo.
export function GrupoHistorial({ clientId }: { clientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["cliente-grupo-historial", clientId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clippr_client_grupo_historial_v1" as any, { p_client_id: clientId });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Cambio[]).slice().reverse();
    },
  });
  if (isLoading || !data) return null;
  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/60">
        Todavía no hay cambios de grupo para este cliente.
      </div>
    );
  }
  const fecha = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  };
  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
      style={{
        background:
          "radial-gradient(110% 90% at 100% 0%, rgba(79,125,255,.16), transparent 62%), radial-gradient(90% 80% at 0% 100%, rgba(139,92,246,.12), transparent 65%)",
      }}
    >
      <div className="text-sm font-semibold text-white">Cambios de grupo</div>
      <ol className="mt-2 space-y-2">
        {data.map((c) => (
          <li key={`${c.fecha}-${c.grupo}`} className="flex items-center gap-2 text-sm text-white/70">
            <span className="tabular-nums text-white/50">{fecha(c.fecha)}</span>
            <span className="text-white/35">→</span>
            <GrupoBadge grupo={c.grupo} />
          </li>
        ))}
      </ol>
    </div>
  );
}
