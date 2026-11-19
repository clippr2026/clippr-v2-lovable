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
  profesionales: Array<{ name: string; used: number; capacity: number }>;
  /** Clientes que se fueron aceptando a cualquiera (falta de lugar general). */
  seFueronPorLugar: number;
  /** Profesional más pedido por clientes que se fueron (cantidad y nombre). */
  masPedido: { name: string; n: number } | null;
  /** Día de la semana y hora con más clientes que se fueron (ej. "miércoles", 19). */
  franjaConMasCasos: { dia: string; hora: number } | null;
};

/** Ocupación a partir de la cual se considera que no queda lugar (la misma que el verde de la agenda). */
export const OCUPACION_LLENA = 80;
/** Desde acá empieza a acercarse a un tope. */
export const OCUPACION_CERCA = 65;

const pct = (used: number, capacity: number) => (capacity > 0 ? Math.round((used / capacity) * 100) : null);

export function evaluarDecisiones(i: DecisionesInput): Decision[] {
  const ocup = i.ocupacion;
  const profs = i.profesionales
    .map((p) => ({ name: p.name, pct: pct(p.used, p.capacity) }))
    .filter((p): p is { name: string; pct: number } => p.pct != null);
  const masPedidoPct = i.masPedido ? profs.find((p) => p.name === i.masPedido!.name)?.pct ?? null : null;

  // 1) ¿Contratar un profesional?
  let contratar: Decision;
  if (ocup == null) {
    contratar = { clave: "contratar", titulo: "¿Contratar un profesional?", estado: "info", respuesta: "Sin datos", detalle: "Cargá los horarios de tus profesionales para medir si te queda lugar." };
  } else if (ocup >= OCUPACION_LLENA) {
    contratar = {
      clave: "contratar", titulo: "¿Contratar un profesional?", estado: "si", respuesta: "Sí",
      detalle: `Tu agenda está al ${ocup}%: ya no queda lugar. Cada cliente que se va sin atender es plata que perdés.`,
    };
  } else if (ocup >= OCUPACION_CERCA && i.seFueronPorLugar >= 4) {
    contratar = {
      clave: "contratar", titulo: "¿Contratar un profesional?", estado: "cerca", respuesta: "Cerca",
      detalle: `Agenda al ${ocup}% y ${i.seFueronPorLugar} clientes se fueron por falta de lugar. Si se sostiene el mes que viene, es momento de sumar a alguien.`,
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
  } else if (i.masPedido && i.masPedido.n >= 3 && masPedidoPct != null && masPedidoPct >= OCUPACION_LLENA) {
    precios = {
      clave: "precios", titulo: "¿Subir precios?", estado: "si", respuesta: "Sí, a uno",
      detalle: `${i.masPedido.name} está al ${masPedidoPct}% y ${i.masPedido.n} clientes lo pidieron y se fueron: conviene subir el precio de sus servicios.`,
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

  return [contratar, horarios, precios];
}
