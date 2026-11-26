// Consultas a un asesor (ver supabase/migrations/20261125120000_consultas_clippr.sql).
import { supabase } from "@/integrations/supabase/client";

export type ConsultaEstado = "abierta" | "respondida" | "cerrada";
export type CerradaPor = "asesor" | "cliente" | "automatico";
export type MiConsulta = { id: string; estado: ConsultaEstado; sin_leer: number; respuestas: { id: number; texto: string }[] };
export type ConsultaBandeja = {
  id: string; estado: ConsultaEstado; negocio: string; usuario: string; email: string;
  pantalla: string; actualizada_en: string; ultimo: string | null; cerrada_por?: CerradaPor | null;
};
export type ConsultaMensaje = { id: number; autor: "usuario" | "clippi" | "asesor"; texto: string; creado_en: string };

async function llamar<T>(funcion: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(funcion as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

// Lo que "dice" la persona al tocar el botón del asesor. Al crear la consulta se guarda como mensaje
// de Clippi para que la lista del panel siga mostrando el problema; el panel lo muestra como del cliente.
export const PIDE_TRAS_PROBAR = "No se resolvió, quiero hablar con un asesor";
export const PIDE_ASESOR = "Quiero hablar con un asesor";
export const esPedidoDeAsesor = (texto: string) => texto === PIDE_TRAS_PROBAR || texto === PIDE_ASESOR;

/** Etiqueta del panel para una consulta cerrada. */
export const textoCierre = (por?: CerradaPor | null) =>
  por === "automatico" ? "Cierre automático" : por === "cliente" ? "Cerrada por el cliente" : por === "asesor" ? "Cerrada por vos" : "Cerrada";

/** "iPhone · Safari", "Android · app instalada": desde qué aparato escriben. */
export function describirEquipo(agente: string, instalada: boolean, tactil = false): string {
  const aparato = /iPhone/.test(agente)
    ? "iPhone"
    : /iPad/.test(agente) || (tactil && /Macintosh/.test(agente))
      ? "iPad"
      : /Android/.test(agente)
        ? "Android"
        : /Macintosh/.test(agente)
          ? "Mac"
          : /Windows/.test(agente)
            ? "Windows"
            : "Computadora";
  const navegador = /Instagram/.test(agente)
    ? "dentro de Instagram"
    : /Edg(A|iOS)?\//.test(agente)
      ? "Edge"
      : /SamsungBrowser/.test(agente)
        ? "Navegador Samsung"
        : /Firefox|FxiOS/.test(agente)
          ? "Firefox"
          : /Chrome|CriOS/.test(agente)
            ? "Chrome"
            : /Safari/.test(agente)
              ? "Safari"
              : "navegador";
  return `${aparato} · ${instalada ? "app instalada" : navegador}`;
}

// "origen" (sucursal y equipo) viaja en el campo que la base llama p_pantalla.
export const pedirAsesor = (mensajes: { autor: "usuario" | "clippi"; texto: string }[], origen: string) =>
  llamar<string>("soporte_pedir_asesor", { p_mensajes: mensajes.slice(-20), p_pantalla: origen.slice(0, 100) });
export const escribirAsesor = (consulta: string, texto: string) => llamar<void>("soporte_escribir", { p_consulta: consulta, p_texto: texto });
export const miConsulta = () => llamar<MiConsulta | null>("soporte_mi_consulta");
/** Al borrar la conversación. */
export const cerrarMiConsulta = () => llamar<void>("soporte_cerrar_mia");
export const marcarLeida = (consulta: string) => llamar<void>("soporte_marcar_leida", { p_consulta: consulta });

// Solo para el dueño de Clippr.
export const bandeja = () => llamar<ConsultaBandeja[]>("soporte_bandeja");
export const mensajesDe = (consulta: string) => llamar<ConsultaMensaje[]>("soporte_mensajes_de", { p_consulta: consulta });
export const responder = (consulta: string, texto: string) => llamar<void>("soporte_responder", { p_consulta: consulta, p_texto: texto });
export const cerrarConsulta = (consulta: string) => llamar<void>("soporte_cerrar", { p_consulta: consulta });
