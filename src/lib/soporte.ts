// Consultas a un asesor (ver supabase/migrations/20261125120000_consultas_clippr.sql).
import { supabase } from "@/integrations/supabase/client";

export type ConsultaEstado = "abierta" | "respondida" | "cerrada";
export type MiConsulta = { id: string; estado: ConsultaEstado; sin_leer: number; respuestas: { id: number; texto: string }[] };
export type ConsultaBandeja = {
  id: string; estado: ConsultaEstado; negocio: string; usuario: string; email: string;
  pantalla: string; actualizada_en: string; ultimo: string | null;
};
export type ConsultaMensaje = { id: number; autor: "usuario" | "clippi" | "asesor"; texto: string; creado_en: string };

async function llamar<T>(funcion: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(funcion as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

export const pedirAsesor = (mensajes: { autor: "usuario" | "clippi"; texto: string }[], pantalla: string) =>
  llamar<string>("soporte_pedir_asesor", { p_mensajes: mensajes.slice(-20), p_pantalla: pantalla });
export const escribirAsesor = (consulta: string, texto: string) => llamar<void>("soporte_escribir", { p_consulta: consulta, p_texto: texto });
export const miConsulta = () => llamar<MiConsulta | null>("soporte_mi_consulta");
export const marcarLeida = (consulta: string) => llamar<void>("soporte_marcar_leida", { p_consulta: consulta });

// Solo para el dueño de Clippr.
export const bandeja = () => llamar<ConsultaBandeja[]>("soporte_bandeja");
export const mensajesDe = (consulta: string) => llamar<ConsultaMensaje[]>("soporte_mensajes_de", { p_consulta: consulta });
export const responder = (consulta: string, texto: string) => llamar<void>("soporte_responder", { p_consulta: consulta, p_texto: texto });
export const cerrarConsulta = (consulta: string) => llamar<void>("soporte_cerrar", { p_consulta: consulta });
