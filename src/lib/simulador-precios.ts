// Simulador de precios del Gerente IA. Separa lo que SE CALCULA (facturación y ganancia adicional, punto de equilibrio)
// de lo que se ESTIMA (riesgo, que depende de supuestos: Clippr no sabe cuántos clientes se van a perder).

export type SimuladorInput = {
  precioActual: number;
  aumento: number;
  /** Ventas cobradas del servicio en los últimos 30 días. */
  ventas30: number;
  /** Comisión efectiva del servicio (0 a 1), de las comisiones reales; null si no hay datos. */
  comision: number | null;
  /** Ocupación atendida del local en el mes (0-100), null si no se sabe. */
  ocupacionAtendida: number | null;
  /** Clientes que se fueron por el precio en los últimos 30 días. */
  seFueronPorPrecio: number;
};

export type NivelRiesgo = "Sin aumento" | "Bajo" | "Medio" | "Alto";

export type SimuladorResultado = {
  precioNuevo: number;
  pctAumento: number;
  /** Facturación adicional por mes si NINGÚN cliente deja de venir. */
  facturacionAdicional: number;
  /** Lo que queda después de la comisión (no suma costos: un aumento no los cambia). */
  gananciaAdicional: number;
  /** true si la ganancia usa la comisión real; false si es una referencia por falta de datos. */
  comisionReal: boolean;
  comisionUsada: number;
  /** Ventas que se pueden perder al mes antes de que el aumento deje de convenir (cálculo exacto). */
  puntoEquilibrio: number;
  puntoEquilibrioPct: number;
  /** Riesgo estimado y los factores que lo componen (orientativo). */
  riesgo: NivelRiesgo;
  factores: string[];
  pocosDatos: boolean;
};

/** Comisión de referencia cuando no hay comisiones registradas del servicio. */
export const COMISION_REFERENCIA = 0.55;

export function simularPrecio(i: SimuladorInput): SimuladorResultado {
  const precioNuevo = i.precioActual + i.aumento;
  const pctAumento = i.precioActual > 0 ? (i.aumento / i.precioActual) * 100 : 0;
  const facturacionAdicional = Math.max(0, Math.round(i.ventas30 * i.aumento));
  const comisionReal = i.comision != null;
  const comisionUsada = Math.min(1, Math.max(0, i.comision ?? COMISION_REFERENCIA));
  const gananciaAdicional = Math.round(facturacionAdicional * (1 - comisionUsada));

  // Punto de equilibrio: con comisión proporcional al precio, la ganancia por venta es proporcional al precio, así que se
  // pueden perder ventas hasta que ventas × precio nuevo = ventas actuales × precio actual.
  const sostenidas = precioNuevo > 0 ? Math.ceil((i.ventas30 * i.precioActual) / precioNuevo) : i.ventas30;
  const puntoEquilibrio = Math.max(0, i.ventas30 - sostenidas);
  const puntoEquilibrioPct = i.ventas30 > 0 ? (puntoEquilibrio / i.ventas30) * 100 : 0;

  // Riesgo estimado (puntos): tamaño del aumento + señales de demanda y de rechazo al precio.
  const factores: string[] = [];
  let pts = pctAumento <= 5 ? 0 : pctAumento <= 10 ? 1 : pctAumento <= 15 ? 2 : pctAumento <= 20 ? 3 : pctAumento <= 30 ? 4 : 6;
  factores.push(`aumento de ${pctAumento.toFixed(1).replace(".", ",")}%`);
  if (i.seFueronPorPrecio >= 3) {
    pts += 2;
    factores.push(`${i.seFueronPorPrecio} clientes se fueron por el precio`);
  } else if (i.seFueronPorPrecio >= 1) {
    pts += 1;
    factores.push(`${i.seFueronPorPrecio === 1 ? "1 cliente se fue" : `${i.seFueronPorPrecio} clientes se fueron`} por el precio`);
  }
  if (i.ocupacionAtendida != null) {
    if (i.ocupacionAtendida >= 70) {
      pts -= 1;
      factores.push(`demanda alta (${i.ocupacionAtendida}% atendida)`);
    } else if (i.ocupacionAtendida < 40) {
      pts += 1;
      factores.push(`agenda con lugar (${i.ocupacionAtendida}% atendida)`);
    }
  }
  const pocosDatos = i.ventas30 < 10;
  if (pocosDatos) {
    pts += 1;
    factores.push("pocas ventas para estimar");
  }
  // Sin aumento no hay nada que arriesgar.
  if (i.aumento <= 0) {
    return { precioNuevo, pctAumento, facturacionAdicional, gananciaAdicional, comisionReal, comisionUsada, puntoEquilibrio, puntoEquilibrioPct, riesgo: "Sin aumento", factores: [], pocosDatos };
  }
  let riesgo: NivelRiesgo = pts <= 1 ? "Bajo" : pts <= 3 ? "Medio" : "Alto";
  // Un cliente que ya se fue por el precio es una señal real: nunca queda en riesgo bajo.
  if (i.seFueronPorPrecio >= 1 && riesgo === "Bajo") riesgo = "Medio";
  return { precioNuevo, pctAumento, facturacionAdicional, gananciaAdicional, comisionReal, comisionUsada, puntoEquilibrio, puntoEquilibrioPct, riesgo, factores, pocosDatos };
}

export type EscenarioMes = {
  /** Ventas que se pierden respecto del mes base (0, 5% o 10%). */
  perdidaPct: number;
  ventas: number;
  facturacion: number;
  /** Cuánto más (o menos) factura respecto de no subir el precio. */
  difFacturacion: number;
  /** Cuánto más (o menos) queda después de la comisión respecto de no subir el precio. */
  difGanancia: number;
};

/**
 * Proyección del próximo mes con las mismas ventas del mes anterior completo. `perdidaPct` son los escenarios en los que
 * se van clientes. Compara siempre contra no subir el precio (mismas ventas × precio actual).
 */
export function proyectarMes(i: { precioActual: number; aumento: number; ventasBase: number; comision: number | null }): {
  sinAumento: { ventas: number; facturacion: number };
  escenarios: EscenarioMes[];
} {
  const c = Math.min(1, Math.max(0, i.comision ?? COMISION_REFERENCIA));
  const precioNuevo = i.precioActual + i.aumento;
  const base = i.ventasBase * i.precioActual;
  const escenarios = [0, 5, 10].map((perdidaPct): EscenarioMes => {
    const ventas = Math.round(i.ventasBase * (1 - perdidaPct / 100));
    const facturacion = ventas * precioNuevo;
    return {
      perdidaPct,
      ventas,
      facturacion,
      difFacturacion: Math.round(facturacion - base),
      difGanancia: Math.round((facturacion - base) * (1 - c)),
    };
  });
  return { sinAumento: { ventas: i.ventasBase, facturacion: Math.round(base) }, escenarios };
}

/** El mes anterior no se usa de base cuando fue diciembre: es un mes de alta demanda y no representa un mes normal. */
export function mesBaseValido(mesAnteriorKey: string): boolean {
  return mesAnteriorKey.slice(5, 7) !== "12";
}
