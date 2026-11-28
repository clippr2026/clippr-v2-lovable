import { supabase } from "@/integrations/supabase/client";
import { findAllPendingCierres } from "@/lib/caja-cierre";
import { agruparDeudas, leerSilenciadas, sinSilenciadas } from "@/lib/deudas-clientes";
import { getTodayFichajeSummary } from "@/lib/fichaje";
import type { PermKey } from "@/hooks/use-auth";

// Centro de notificaciones. Todo sale de los datos reales del negocio (no hay una tabla de notificaciones):
// · Importantes: SOLO lo que pide atención o una acción (seña por aprobar, caja sin cerrar,
//   saldo pendiente de un cliente, solicitud de un profesional, liquidación sin pagar, profesional que no fichó a horario, stock bajo).
//   La campanita cuenta únicamente estos, sin leer.
// · Actividad: lo informativo (turnos reservados, reservas online confirmadas, cancelaciones, señas aprobadas, cobros, fichajes,
//   gastos, cierres, liquidaciones, reseñas).
// Cada aviso respeta la sucursal activa (cuando el dato la tiene) y los permisos del usuario.
// Leído / no leído se guarda en el dispositivo, por negocio.

export type TipoAviso =
  | "reserva"
  | "cancelacion"
  | "sena"
  | "caja"
  | "bolsa"
  | "liquidacion"
  | "fichaje"
  | "cobro"
  | "gasto"
  | "cierre"
  | "tardanza"
  | "stock"
  | "resena"
  | "deuda";

export type Aviso = {
  id: string;
  tipo: TipoAviso;
  titulo: string;
  detalle: string;
  fecha: string; // ISO
  to: string;
  search?: Record<string, string>;
  /** Aviso de saldo pendiente: se cobra desde el propio centro y se puede silenciar. */
  deuda?: { ids: string[] };
};

type Contexto = {
  businessId: string;
  branchId: string | null;
  puede: (p: PermKey) => boolean;
  esDueno: boolean;
};

const DIAS_ACTIVIDAD = 7;
const LIMITE = 40;
const ONLINE = new Set(["cliente", "client", "online", "public"]);
const esOnline = (rol: unknown) => !rol || ONLINE.has(String(rol).toLowerCase());
const pesos = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
const desde = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();
const fechaCorta = (yyyyMmDd: string) =>
  new Date(`${yyyyMmDd}T12:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
const diaClave = (iso: string) => iso.slice(0, 10);

// Cada fuente falla por separado: si una no se puede leer, las demás se muestran igual.
async function seguro<T>(f: () => Promise<T[]>): Promise<T[]> {
  try {
    return await f();
  } catch {
    return [];
  }
}

function porSucursal<Q extends { or: (f: string) => Q }>(q: Q, branchId: string | null): Q {
  return branchId ? q.or(`branch_id.eq.${branchId},branch_id.is.null`) : q;
}

export async function cargarImportantes(ctx: Contexto): Promise<Aviso[]> {
  const { businessId, branchId, puede, esDueno } = ctx;
  const tareas: Array<Promise<Aviso[]>> = [];

  if (puede("senas") || puede("caja")) {
    tareas.push(
      seguro(async () => {
        const { data, error } = await (supabase.from("appointment_deposits" as any) as any)
          .select("id,amount,proof_uploaded_at,created_at,appointments:appointment_id(client_name,branch_id)")
          .eq("business_id", businessId)
          .eq("status", "review");
        if (error) throw error;
        return ((data ?? []) as any[])
          .filter((d) => !branchId || !d.appointments?.branch_id || d.appointments.branch_id === branchId)
          .map((d) => ({
            id: `sena-${d.id}`,
            tipo: "sena" as const,
            titulo: "Seña por aprobar",
            detalle: `${d.appointments?.client_name || "Un cliente"} envió el comprobante de una seña de ${pesos(d.amount)}.`,
            fecha: d.proof_uploaded_at || d.created_at,
            to: "/cash-register",
            search: { tab: "resumen" },
          }));
      }),
    );
  }

  if (puede("caja")) {
    tareas.push(
      seguro(async () => {
        const { data, error } = await porSucursal(
          supabase
            .from("payments")
            .select("id,client_id,client_name,total,amount,collected_amount,created_at,branch_id")
            .eq("business_id", businessId)
            .in("status", ["pendiente", "parcial"])
            .order("created_at", { ascending: false })
            .limit(300) as any,
          branchId,
        );
        if (error) throw error;
        return sinSilenciadas(agruparDeudas((data ?? []) as any[]), leerSilenciadas(businessId)).map((d) => ({
          id: `deuda-${d.clave}-${Math.round(d.total)}`,
          tipo: "deuda" as const,
          titulo: "Saldo pendiente",
          detalle: `${d.nombre} debe ${pesos(d.total)}.`,
          fecha: d.fecha,
          to: "/cash-register",
          deuda: { ids: d.ids },
        }));
      }),
    );
    tareas.push(
      seguro(async () => {
        const pendientes = await findAllPendingCierres(businessId, branchId);
        return pendientes.map((p) => ({
          id: `caja-${branchId ?? "todas"}-${p.date}`,
          tipo: "caja" as const,
          titulo: "Caja pendiente de cierre",
          detalle: `La caja del ${fechaCorta(p.date)} todavía no se cerró.`,
          fecha: `${p.date}T23:59:00-03:00`,
          to: "/cash-register",
          search: { tab: "cierres" },
        }));
      }),
    );
    tareas.push(
      seguro(async () => {
        const { data, error } = await (supabase.from("settlement_runs" as any) as any)
          .select("id,professional_name,total_to_settle,status,prepared_at")
          .eq("business_id", businessId)
          .gte("prepared_at", desde(45))
          .order("prepared_at", { ascending: false })
          .limit(LIMITE);
        if (error) throw error;
        return ((data ?? []) as any[])
          .filter((r) => !["pagada", "anulada", "cancelada"].includes(String(r.status)))
          .map((r) => ({
            id: `liq-${r.id}`,
            tipo: "liquidacion" as const,
            titulo: "Liquidación pendiente",
            detalle: `Falta pagar la liquidación de ${r.professional_name || "un profesional"} (${pesos(r.total_to_settle)}).`,
            fecha: r.prepared_at,
            to: "/cash-register",
            search: { tab: "profesionales" },
          }));
      }),
    );
  }

  if (esDueno || puede("equipo")) {
    tareas.push(
      seguro(async () => {
        const [a, b] = await Promise.all([
          (supabase as any).rpc("business_join_requests", { p_business: businessId }),
          (supabase as any).rpc("business_rental_requests", { p_business: businessId }),
        ]);
        const unirse = ((a.data ?? []) as any[])
          .filter((r) => r.status === "pending" && (r.initiated_by ?? "professional") === "professional")
          .map((r) => ({
            id: `bolsa-${r.id}`,
            tipo: "bolsa" as const,
            titulo: "Solicitud de la bolsa de trabajo",
            detalle: `${r.full_name || "Un profesional"} quiere sumarse a tu equipo.`,
            fecha: r.created_at || new Date().toISOString(),
            to: "/settings",
            search: { section: "bolsa" },
          }));
        const alquiler = ((b.data ?? []) as any[])
          .filter((r) => r.status === "pending")
          .map((r) => ({
            id: `bolsa-alquiler-${r.id}`,
            tipo: "bolsa" as const,
            titulo: "Solicitud de la bolsa de trabajo",
            detalle: `${r.full_name || "Un profesional"} se postuló${r.posting_title ? ` a «${r.posting_title}»` : ""}.`,
            fecha: r.created_at || new Date().toISOString(),
            to: "/settings",
            search: { section: "bolsa" },
          }));
        return [...unirse, ...alquiler];
      }),
    );
  }

  if ((esDueno || puede("profesionales")) && branchId) {
    tareas.push(
      seguro(async () => {
        const resumen = await getTodayFichajeSummary(businessId, branchId);
        const ahora = new Date();
        const hoy = ahora.toLocaleDateString("en-CA");
        return resumen.pendientesDetalle
          .filter((p) => {
            if (!p.inicio) return false;
            const [h, m] = p.inicio.split(":").map(Number);
            const entrada = new Date(ahora);
            entrada.setHours(h, m, 0, 0);
            return ahora.getTime() > entrada.getTime() + 5 * 60_000; // 5 min de margen
          })
          .map((p) => {
            const [h, m] = p.inicio!.split(":").map(Number);
            const entrada = new Date(ahora);
            entrada.setHours(h, m, 0, 0);
            return {
              id: `tarde-${p.id}-${hoy}`,
              tipo: "tardanza" as const,
              titulo: "No registró su ingreso",
              detalle: `${p.name} entraba a las ${p.inicio} y todavía no fichó.`,
              fecha: entrada.toISOString(),
              to: "/dashboard",
            };
          });
      }),
    );
  }

  if (esDueno || puede("caja") || puede("catalogo")) {
    tareas.push(
      seguro(async () => {
        let q = (supabase.from("price_catalog") as any)
          .select("id,name,stock,stock_min,active")
          .eq("business_id", businessId)
          .is("deleted_at", null)
          .not("stock", "is", null);
        if (branchId) q = q.eq("branch_id", branchId);
        const { data, error } = await q;
        if (error) throw error;
        const hoy = new Date().toLocaleDateString("en-CA");
        return ((data ?? []) as any[])
          .filter((p) => p.active !== false && Number(p.stock_min) > 0 && Number(p.stock) <= Number(p.stock_min))
          .map((p) => ({
            id: `stock-${p.id}-${Number(p.stock)}`,
            tipo: "stock" as const,
            titulo: "Stock insuficiente",
            detalle: `Quedan ${Number(p.stock)} de «${p.name}» (mínimo ${Number(p.stock_min)}).`,
            fecha: `${hoy}T08:00:00-03:00`,
            to: "/cash-register",
            search: { tab: "inventario" },
          }));
      }),
    );
  }

  return ordenar((await Promise.all(tareas)).flat());
}

export async function cargarActividad(ctx: Contexto): Promise<Aviso[]> {
  const { businessId, branchId, puede, esDueno } = ctx;
  const tareas: Array<Promise<Aviso[]>> = [];
  const inicio = desde(DIAS_ACTIVIDAD);

  if (puede("agenda")) {
    tareas.push(
      seguro(async () => {
        const { data, error } = await porSucursal(
          supabase
            .from("appointments")
            .select("id,client_name,service_name,starts_at,created_at,created_by_role,status,deposit_status,branch_id")
            .eq("business_id", businessId)
            .gte("created_at", inicio)
            .order("created_at", { ascending: false })
            .limit(LIMITE) as any,
          branchId,
        );
        if (error) throw error;
        // Turnos «Reservado» (estado pending, sin seña pendiente: esos van por el aviso de seña) y
        // reservas online ya confirmadas.
        return ((data ?? []) as any[])
          .filter((a) =>
            a.status === "pending"
              ? a.deposit_status !== "pending"
              : esOnline(a.created_by_role) && a.status !== "cancelled",
          )
          .map((a) => {
          return {
            id: `act-reserva-${a.id}`,
            tipo: "reserva" as const,
            titulo: a.status === "pending" ? "Reservado" : "Nueva reserva online",
            detalle: `${a.client_name || "Cliente"}${a.service_name ? ` · ${a.service_name}` : ""} · ${new Date(a.starts_at).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
            fecha: a.created_at,
            to: "/agenda",
            search: { date: diaClave(a.starts_at), turno: a.id },
          };
        });
      }),
    );
    tareas.push(
      seguro(async () => {
        const { data, error } = await porSucursal(
          supabase
            .from("appointments")
            .select("id,client_name,service_name,starts_at,cancelled_at,branch_id")
            .eq("business_id", businessId)
            .eq("status", "cancelled")
            .gte("cancelled_at", inicio)
            .order("cancelled_at", { ascending: false })
            .limit(LIMITE) as any,
          branchId,
        );
        if (error) throw error;
        return ((data ?? []) as any[]).map((a) => ({
          id: `act-cancel-${a.id}`,
          tipo: "cancelacion" as const,
          titulo: "Turno cancelado",
          detalle: `${a.client_name || "Cliente"}${a.service_name ? ` · ${a.service_name}` : ""}`,
          fecha: a.cancelled_at,
          to: "/agenda",
          search: { date: diaClave(a.starts_at) },
        }));
      }),
    );
  }

  if (esDueno || puede("profesionales")) {
    tareas.push(
      seguro(async () => {
        const [{ data, error }, { data: emps }] = await Promise.all([
          porSucursal(
            (supabase.from("work_sessions" as any) as any)
              .select("id,employee_id,clock_in_at,clock_out_at,branch_id")
              .eq("business_id", businessId)
              .gte("clock_in_at", inicio)
              .order("clock_in_at", { ascending: false })
              .limit(LIMITE),
            branchId,
          ),
          supabase.from("employees").select("id,full_name").eq("business_id", businessId),
        ]);
        if (error) throw error;
        const nombre = new Map(((emps ?? []) as any[]).map((e) => [e.id, e.full_name as string]));
        const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
        return ((data ?? []) as any[]).flatMap((w) => {
          const quien = nombre.get(w.employee_id) || "Un profesional";
          const filas: Aviso[] = [
            { id: `act-ficha-in-${w.id}`, tipo: "fichaje", titulo: "Fichaje de entrada", detalle: `${quien} fichó a las ${hora(w.clock_in_at)}.`, fecha: w.clock_in_at, to: "/dashboard" },
          ];
          if (w.clock_out_at)
            filas.push({ id: `act-ficha-out-${w.id}`, tipo: "fichaje", titulo: "Fichaje de salida", detalle: `${quien} se fue a las ${hora(w.clock_out_at)}.`, fecha: w.clock_out_at, to: "/dashboard" });
          return filas;
        });
      }),
    );
  }

  if (puede("caja")) {
    tareas.push(
      seguro(async () => {
        const { data, error } = await porSucursal(
          supabase
            .from("payments")
            .select("id,client_name,service_name,total,amount,status,created_at,branch_id")
            .eq("business_id", businessId)
            .gte("created_at", inicio)
            .order("created_at", { ascending: false })
            .limit(LIMITE) as any,
          branchId,
        );
        if (error) throw error;
        return ((data ?? []) as any[])
          .filter((p) => !["anulado", "reembolsado", "pendiente"].includes(String(p.status)))
          .map((p) => ({
            id: `act-cobro-${p.id}`,
            tipo: "cobro" as const,
            titulo: "Servicio cobrado",
            detalle: `${p.service_name || "Venta"}${p.client_name ? ` · ${p.client_name}` : ""} · ${pesos(p.total ?? p.amount)}`,
            fecha: p.created_at,
            to: "/cash-register",
            search: { tab: "resumen" },
          }));
      }),
    );
    tareas.push(
      seguro(async () => {
        const { data, error } = await porSucursal(
          supabase
            .from("expenses")
            .select("id,name,amount,created_at,branch_id")
            .eq("business_id", businessId)
            .gte("created_at", inicio)
            .order("created_at", { ascending: false })
            .limit(LIMITE) as any,
          branchId,
        );
        if (error) throw error;
        return ((data ?? []) as any[]).map((g) => ({
          id: `act-gasto-${g.id}`,
          tipo: "gasto" as const,
          titulo: "Gasto registrado",
          detalle: `${g.name || "Gasto"} · ${pesos(Math.abs(Number(g.amount) || 0))}`,
          fecha: g.created_at,
          to: "/cash-register",
          search: { tab: "resumen" },
        }));
      }),
    );
    tareas.push(
      seguro(async () => {
        const { data, error } = await porSucursal(
          (supabase.from("caja_cierres" as any) as any)
            .select("id,fecha,estado,updated_at,branch_id")
            .eq("business_id", businessId)
            .eq("estado", "cerrada")
            .gte("updated_at", inicio)
            .order("updated_at", { ascending: false })
            .limit(LIMITE),
          branchId,
        );
        if (error) throw error;
        return ((data ?? []) as any[]).map((c) => ({
          id: `act-cierre-${c.id}`,
          tipo: "cierre" as const,
          titulo: "Cierre de caja",
          detalle: `Se cerró la caja del ${fechaCorta(c.fecha)}.`,
          fecha: c.updated_at,
          to: "/cash-register",
          search: { tab: "cierres" },
        }));
      }),
    );
    tareas.push(
      seguro(async () => {
        const { data, error } = await (supabase.from("settlement_runs" as any) as any)
          .select("id,professional_name,total_to_settle,prepared_at")
          .eq("business_id", businessId)
          .gte("prepared_at", inicio)
          .order("prepared_at", { ascending: false })
          .limit(LIMITE);
        if (error) throw error;
        return ((data ?? []) as any[]).map((r) => ({
          id: `act-liq-${r.id}`,
          tipo: "liquidacion" as const,
          titulo: "Liquidación realizada",
          detalle: `${r.professional_name || "Profesional"} · ${pesos(r.total_to_settle)}`,
          fecha: r.prepared_at,
          to: "/cash-register",
          search: { tab: "profesionales" },
        }));
      }),
    );
  }

  if (puede("senas") || puede("caja")) {
    tareas.push(
      seguro(async () => {
        const { data, error } = await (supabase.from("appointment_deposits" as any) as any)
          .select("id,paid_amount,amount,approved_at,appointments:appointment_id(client_name,branch_id)")
          .eq("business_id", businessId)
          .gte("approved_at", inicio)
          .order("approved_at", { ascending: false })
          .limit(LIMITE);
        if (error) throw error;
        return ((data ?? []) as any[])
          .filter((d) => !branchId || !d.appointments?.branch_id || d.appointments.branch_id === branchId)
          .map((d) => ({
            id: `act-sena-${d.id}`,
            tipo: "sena" as const,
            titulo: "Seña aprobada",
            detalle: `${d.appointments?.client_name || "Cliente"} · ${pesos(d.paid_amount ?? d.amount)}`,
            fecha: d.approved_at,
            to: "/cash-register",
            search: { tab: "resumen" },
          }));
      }),
    );
  }

  if (esDueno || puede("configuracion")) {
    tareas.push(
      seguro(async () => {
        const { data, error } = await (supabase.from("reviews" as any) as any)
          .select("id,client_name,rating,comment,created_at")
          .eq("business_id", businessId)
          .gte("created_at", inicio)
          .order("created_at", { ascending: false })
          .limit(LIMITE);
        if (error) throw error;
        return ((data ?? []) as any[]).map((r) => ({
          id: `act-resena-${r.id}`,
          tipo: "resena" as const,
          titulo: "Nueva reseña",
          detalle: `${r.client_name || "Un cliente"} · ${"★".repeat(Math.max(0, Math.min(5, Number(r.rating) || 0)))}${r.comment ? ` · ${r.comment}` : ""}`,
          fecha: r.created_at,
          to: "/settings",
          search: { section: "resenas" },
        }));
      }),
    );
  }

  return ordenar((await Promise.all(tareas)).flat()).slice(0, 150);
}

function ordenar(avisos: Aviso[]): Aviso[] {
  return avisos.filter((a) => a.fecha).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

// ── Leídas (en el dispositivo, por negocio) ──────────────────────────────────
const claveLeidas = (businessId: string) => `clippr_notificaciones_leidas_${businessId}`;
export const EVENTO_LEIDAS = "clippr:notificaciones-leidas";

export function leerLeidas(businessId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(claveLeidas(businessId)) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function marcarLeidas(businessId: string, ids: string[]) {
  const leidas = leerLeidas(businessId);
  ids.forEach((id) => leidas.add(id));
  try {
    localStorage.setItem(claveLeidas(businessId), JSON.stringify(Array.from(leidas).slice(-800)));
  } catch {
    // Sin almacenamiento: dura hasta recargar.
  }
  window.dispatchEvent(new Event(EVENTO_LEIDAS));
}

/** "Hoy", "Ayer" o la fecha: grupos de la lista. */
export function grupoDeFecha(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) return "Hoy";
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === ayer.toDateString()) return "Ayer";
  const texto = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
