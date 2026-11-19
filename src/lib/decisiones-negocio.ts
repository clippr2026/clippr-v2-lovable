// Asesor IA: tres decisiones del dueño (contratar, entender horarios, subir precios) con una respuesta clara y su
// porqué, a partir de la ocupación real de la agenda, la de cada profesional y los clientes que se fueron sin atender.

export type DecisionEstado = "si" | "cerca" | "no" | "info";

export type Decision = {
  clave: "contratar" | "horarios" | "precios";
  titulo: string;
  estado: DecisionEstado;
  /** Respuesta corta: "Sí", "Cerca", "Todavía no" o "Mirá esto". */
  respuesta: string;
  detalle: string;
};

export type DecisionesInput = {
  /** Ocupación de la agenda del mes (0-100), null si no hay horarios cargados. */
  ocupacion: number | null;
  /** Ocupación de cada profesional: servicios realizados contra su capacidad. */
  /** daysWorked/daysFull: días trabajados y días con 90% o más de los turnos atendidos (con o sin turno sacado). */
  profesionales: Array<{ name: string; used: number; capacity: number; daysWorked?: number; daysFull?: number }>;
  /** Clientes que se fueron aceptando a cualquiera (falta de lugar general). */
  seFueronPorLugar: number;
  /** Clientes que se fueron por el precio (botón "Se fue" de la Agenda). */
  seFueronPorPrecio?: number;
  /** Profesional más pedido por clientes que se fueron (cantidad y nombre). */
  masPedido: { name: string; n: number } | null;
  /** Día de la semana y hora con más clientes que se fueron (ej. "miércoles", 19). */
  franjaConMasCasos: { dia: string; hora: number } | null;
};

/** Ocupación a partir de la cual se considera que no queda lugar (la misma que el verde de la agenda). */
export const OCUPACION_LLENA = 80;
/** Desde acá empieza a acercarse a un tope. */
export const OCUPACION_CERCA = 65;
/** Proporción de días llenos a partir de la cual no queda lugar (aunque el promedio del mes sea más bajo). */
export const DIAS_LLENOS_TOPE = 0.4;
export const DIAS_LLENOS_CERCA = 0.25;
/** Días trabajados mínimos para fiarse de la proporción de días llenos. */
export const DIAS_MINIMOS = 8;

const pct = (used: number, capacity: number) => (capacity > 0 ? Math.round((used / capacity) * 100) : null);

export function evaluarDecisiones(i: DecisionesInput): Decision[] {
  const ocup = i.ocupacion;
  const profs = i.profesionales
    .map((p) => ({
      name: p.name,
      pct: pct(p.used, p.capacity),
      llenos: p.daysFull ?? 0,
      dias: p.daysWorked ?? 0,
    }))
    .filter((p): p is { name: string; pct: number; llenos: number; dias: number } => p.pct != null);
  const fracLlenos = (p: { llenos: number; dias: number }) => (p.dias >= DIAS_MINIMOS ? p.llenos / p.dias : null);
  const sinLugar = (p: { pct: number; llenos: number; dias: number }) => p.pct >= OCUPACION_LLENA || (fracLlenos(p) ?? 0) >= DIAS_LLENOS_TOPE;
  const diasTotales = profs.reduce((n, p) => n + p.dias, 0);
  const llenosTotales = profs.reduce((n, p) => n + p.llenos, 0);
  const fracLocal = diasTotales >= DIAS_MINIMOS ? llenosTotales / diasTotales : null;

  // 1) ¿Contratar un profesional?
  let contratar: Decision;
  if (ocup == null) {
    contratar = { clave: "contratar", titulo: "¿Contratar un profesional?", estado: "info", respuesta: "Sin datos", detalle: "Cargá los horarios de tus profesionales para medir si te queda lugar." };
  } else if (ocup >= OCUPACION_LLENA || (fracLocal ?? 0) >= DIAS_LLENOS_TOPE) {
    contratar = {
      clave: "contratar", titulo: "¿Contratar un profesional?", estado: "si", respuesta: "Sí",
      detalle:
        (fracLocal ?? 0) >= DIAS_LLENOS_TOPE && ocup < OCUPACION_LLENA
          ? `Aunque el promedio del mes es ${ocup}%, el ${Math.round((fracLocal as number) * 100)}% de los días de tus profesionales estuvo lleno (${llenosTotales} de ${diasTotales}): en los días fuertes ya no queda lugar. Cada cliente que se va sin atender es plata que perdés.`
          : `Tu agenda está al ${ocup}%: ya no queda lugar. Cada cliente que se va sin atender es plata que perdés.`,
    };
  } else if ((ocup >= OCUPACION_CERCA || (fracLocal ?? 0) >= DIAS_LLENOS_CERCA) && i.seFueronPorLugar >= 4) {
    contratar = {
      clave: "contratar", titulo: "¿Contratar un profesional?", estado: "cerca", respuesta: "Cerca",
      detalle: `Agenda al ${ocup}%${fracLocal != null ? ` (${llenosTotales} de ${diasTotales} días llenos)` : ""} y ${i.seFueronPorLugar} clientes se fueron por falta de lugar. Si se sostiene el mes que viene, es momento de sumar a alguien.`,
    };
  } else {
    contratar = {
      clave: "contratar", titulo: "¿Contratar un profesional?", estado: "no", respuesta: "Todavía no",
      detalle: `Tu agenda está al ${ocup}%: tenés lugar de sobra. Antes de sumar a alguien conviene llenar lo que ya tenés. Con ${OCUPACION_LLENA}% o más sí.`,
    };
  }

  // 2) Entender los horarios
  const partes: string[] = [];
  if (profs.length >= 2) {
    const orden = [...profs].sort((a, b) => b.pct - a.pct);
    const alto = orden[0];
    const bajo = orden[orden.length - 1];
    if (alto.pct - bajo.pct >= 20) {
      partes.push(`${bajo.name} está al ${bajo.pct}% y ${alto.name} al ${alto.pct}%: hay lugar libre en la agenda de ${bajo.name} para absorber a quienes se van.`);
    } else {
      partes.push(`La ocupación está pareja entre profesionales (de ${bajo.pct}% a ${alto.pct}%).`);
    }
  }
  if (i.franjaConMasCasos) {
    partes.push(`La franja con más clientes que se fueron es ${i.franjaConMasCasos.dia} de ${i.franjaConMasCasos.hora} a ${i.franjaConMasCasos.hora + 1} hs.`);
  }
  const horarios: Decision = {
    clave: "horarios", titulo: "Entender los horarios", estado: "info", respuesta: "Mirá esto",
    detalle: partes.length > 0 ? partes.join(" ") : "Todavía no hay datos suficientes para marcar un horario con problemas.",
  };

  // 3) ¿Subir precios?
  let precios: Decision;
  if (ocup == null) {
    precios = { clave: "precios", titulo: "¿Subir precios?", estado: "info", respuesta: "Sin datos", detalle: "Cargá los horarios de tus profesionales para medir la demanda." };
  } else if (ocup >= OCUPACION_LLENA) {
    precios = {
      clave: "precios", titulo: "¿Subir precios?", estado: "si", respuesta: "Sí",
      detalle: `Con la agenda al ${ocup}% la demanda supera tu lugar: un aumento chico (5% a 10%) casi no espanta clientes.`,
    };
  } else if (profs.some(sinLugar)) {
    // Un profesional sin lugar puede subir su precio aunque el local en conjunto tenga lugar.
    const llenos = profs.filter(sinLugar).sort((a, b) => (fracLlenos(b) ?? b.pct / 100) - (fracLlenos(a) ?? a.pct / 100));
    const nombres = llenos.map((p) => p.name).join(" y ");
    const detalleLlenos = llenos
      .map((p) => (p.dias >= DIAS_MINIMOS && p.llenos / p.dias >= DIAS_LLENOS_TOPE ? `${p.name} tuvo la agenda llena ${p.llenos} de ${p.dias} días (promedio del mes ${p.pct}%)` : `${p.name} está al ${p.pct}%`))
      .join(" y ");
    const pedidos =
      i.masPedido && i.masPedido.n >= 1 && llenos.some((p) => p.name === i.masPedido!.name)
        ? ` Además ${i.masPedido.n} ${i.masPedido.n === 1 ? "cliente lo pidió y se fue" : "clientes lo pidieron y se fueron"}.`
        : "";
    const resto = profs.length > llenos.length ? " Con el resto todavía no: tienen lugar libre." : "";
    precios = {
      clave: "precios", titulo: "¿Subir precios?", estado: "si", respuesta: `Sí, a ${nombres}`,
      detalle: `${detalleLlenos}: casi no ${llenos.length === 1 ? "le" : "les"} queda lugar.${pedidos} Conviene subir el precio de ${llenos.length === 1 ? "sus" : "sus"} servicios entre 5% y 10%.${resto}`,
    };
  } else if (ocup >= OCUPACION_CERCA) {
    precios = {
      clave: "precios", titulo: "¿Subir precios?", estado: "cerca", respuesta: "Cerca",
      detalle: `Agenda al ${ocup}%. Podés probar un aumento chico en los servicios que más se piden y mirar cómo responden los clientes.`,
    };
  } else {
    precios = {
      clave: "precios", titulo: "¿Subir precios?", estado: "no", respuesta: "Todavía no",
      detalle: `Con la agenda al ${ocup}% hay lugar libre: subir precios puede espantar clientes. Primero llená la agenda; con ${OCUPACION_LLENA}% o más sí.`,
    };
  }

  // Si hay clientes que se van por el precio, subirlo tiene un costo: se avisa y un "Sí" pasa a "con cuidado".
  const porPrecio = i.seFueronPorPrecio ?? 0;
  if (porPrecio >= 1) {
    const aviso = ` Ojo: ${porPrecio} ${porPrecio === 1 ? "cliente se fue" : "clientes se fueron"} por el precio este mes.`;
    precios = { ...precios, detalle: precios.detalle + aviso };
    if (porPrecio >= 3 && precios.estado === "si") {
      precios = { ...precios, estado: "cerca", respuesta: "Con cuidado" };
    }
  }

  return [contratar, horarios, precios];
}
