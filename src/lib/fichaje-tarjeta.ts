import * as React from "react";
import { supabase } from "@/integrations/supabase/client";

// Tarjeta de fichaje de Inicio.
// · Configurado = el negocio ya usó el fichaje de alguna forma: hay al menos un fichaje registrado, una regla de
//   tardanza o un código QR de fichaje generado. Ahí se ve la tarjeta de siempre (Fichaje de hoy) y no se puede ocultar.
// · Sin configurar: tarjeta "Fichaje de jornada" con "Configurar fichaje" y la opción "Ocultar".
// · Ocultar se guarda en el dispositivo, por negocio. Se vuelve a mostrar desde Configuración → Reglas de tardanza.
//   Si después se configura el fichaje, la tarjeta vuelve a aparecer sola.

const clave = (businessId: string) => `clippr_fichaje_tarjeta_oculta_${businessId}`;
const EVENTO = "clippr:fichaje-tarjeta";

export function tarjetaFichajeOculta(businessId: string | null): boolean {
  if (!businessId) return false;
  try {
    return localStorage.getItem(clave(businessId)) === "1";
  } catch {
    return false;
  }
}

export function ocultarTarjetaFichaje(businessId: string, oculta: boolean) {
  try {
    if (oculta) localStorage.setItem(clave(businessId), "1");
    else localStorage.removeItem(clave(businessId));
  } catch {
    // Sin almacenamiento: dura hasta recargar.
  }
  window.dispatchEvent(new Event(EVENTO));
}

/** Si la tarjeta está oculta; se actualiza al ocultarla o mostrarla desde otra pantalla. */
export function useTarjetaFichajeOculta(businessId: string | null): boolean {
  const [oculta, setOculta] = React.useState(() => tarjetaFichajeOculta(businessId));
  React.useEffect(() => {
    const leer = () => setOculta(tarjetaFichajeOculta(businessId));
    leer();
    window.addEventListener(EVENTO, leer);
    return () => window.removeEventListener(EVENTO, leer);
  }, [businessId]);
  return oculta;
}

/** null mientras se averigua. Ante un error se toma como configurado (se ve la tarjeta de siempre). */
export function useFichajeConfigurado(businessId: string | null): boolean | null {
  const [configurado, setConfigurado] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!businessId) return;
    let vigente = true;
    const hay = async (tabla: string) => {
      const { data, error } = await supabase.from(tabla as any).select("business_id").eq("business_id", businessId).limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    };
    void Promise.all([hay("work_sessions"), hay("lateness_rules"), hay("branch_checkin_codes")])
      .then((r) => vigente && setConfigurado(r.some(Boolean)))
      .catch(() => vigente && setConfigurado(true));
    return () => {
      vigente = false;
    };
  }, [businessId]);
  return configurado;
}
