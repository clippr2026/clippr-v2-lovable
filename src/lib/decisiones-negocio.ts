// Asesor IA: decisiones del dueño (más capacidad de atención, entender los horarios, subir precios) con una respuesta
// clara y su porqué. Cruza los clientes que se fueron sin atender con la ocupación AGENDADA y la ATENDIDA de cada franja
// (día de la semana y hora), en vez de apoyarse en el promedio del mes o en un porcentaje fijo: un local puede estar al
// 47% en el mes y no tener lugar los jueves a las 18 hs.

export type DecisionEstado = "si" | "cerca" | "no" | "info";

export type Decision = {
  clave: "contratar" | "horarios" | "precios";
  titulo: string;
  estado: DecisionEstado;
  /** Respuesta corta: "Sí", "Cerca", "Todavía no" o "Mirá esto". */
  respuesta: string;
  detalle: string;
};

/** Ocupación de una franja (día de la semana 0-6 y hora 0-23), en minutos y con tope por profesional y hora. */
export type FranjaOcupacion = { dow: number; hour: number; disponible: number; agendado: number; atendido: number };

export type DecisionesInput = {
  /** Ocupación atendida del mes (0-100), null si no hay horarios cargados. Solo contexto: no decide por sí sola. */
  ocupacion: number | null;
  /** daysWorked/daysFull: días trabajados y días con 90% o más de los turnos atendidos (con o sin turno sacado). */
  profesionales: Array<{ name: string; used: number; capacity: number; daysWorked?: number; daysFull?: number }>;
  /** Clientes que se fueron aceptando a cualquiera (falta de lugar), con el día y la hora en que se fueron. */
  seFueronPorLugarFranjas: Array<{ dow: number; hour: number }>;
  /** Clientes que se fueron por el precio (botón "Se fue" de la Agenda). */
  seFueronPorPrecio?: number;
  /** Profesional más pedido por clientes que se fueron (cantidad y nombre). */
  masPedido: { name: string; n: number } | null;
  /** Día de la semana y hora con más clientes que se fueron (ej. "miércoles", 19). */
  franjaConMasCasos: { dia: string; hora: number } | null;
  /** Ocupación por franja del mes. Sin esto solo se usan los días llenos de cada profesional. */
  franjas?: FranjaOcupacion[];
};

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
/** Una franja está llena cuando lo agendado o lo atendido ocupa esta parte de su tiempo disponible. */
export const FRANJA_LLENA = 0.85;
/** Clientes que tienen que haberse ido en la misma franja para tomarla como una señal. */
export const MIN_CASOS_FRANJA = 2;
/** Franjas distintas con casos en horario lleno para hablar de falta de capacidad general. */
export const FRANJAS_PARA_CAPACIDAD = 3;
/** Proporción de días llenos de un profesional (90% de sus turnos) a partir de la cual no le queda lugar. */
export const DIAS_LLENOS_TOPE = 0.4;
/** Días trabajados mínimos para fiarse de la proporción de días llenos. */
export const DIAS_MINIMOS = 8;

const franjaTexto = (dow: number, hour: number) => `${DIAS[dow]} de ${hour} a ${hour + 1} hs`;
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : null);
const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

type FranjaConCasos = FranjaOcupacion & { casos: number; agendadaPct: number; atendidaPct: number; llena: boolean };

export function evaluarDecisiones(i: DecisionesInput): Decision[] {
  const franjaPorClave = new Map((i.franjas ?? []).map((f) => [`${f.dow}|${f.hour}`, f]));
  const casosPorFranja = new Map<string, { dow: number; hour: number; casos: number }>();
  for (const c of i.seFueronPorLugarFranjas) {
    const k = `${c.dow}|${c.hour}`;
    const e = casosPorFranja.get(k) ?? { dow: c.dow, hour: c.hour, casos: 0 };
    e.casos += 1;
    casosPorFranja.set(k, e);
  }
  const franjasConCasos: FranjaConCasos[] = [];
  for (const c of casosPorFranja.values()) {
    const f = franjaPorClave.get(`${c.dow}|${c.hour}`);
    if (!f || f.disponible <= 0) continue;
    const agendadaPct = pct(f.agendado, f.disponible) ?? 0;
    const atendidaPct = pct(f.atendido, f.disponible) ?? 0;
    franjasConCasos.push({ ...f, casos: c.casos, agendadaPct, atendidaPct, llena: Math.max(agendadaPct, atendidaPct) >= FRANJA_LLENA * 100 });
  }
  const fuertes = franjasConCasos.filter((f) => f.casos >= MIN_CASOS_FRANJA).sort((a, b) => b.casos - a.casos);
  const fuertesLlenas = fuertes.filter((f) => f.llena);
  const franjasLlenasConAlgunCaso = franjasConCasos.filter((f) => f.llena);
  const casosLugar = i.seFueronPorLugarFranjas.length;

  const profs = i.profesionales
    .map((p) => ({
      name: p.name,
      pct: pct(p.used, p.capacity),
      llenos: p.daysFull ?? 0,
      dias: p.daysWorked ?? 0,
    }))
    .filter((p): p is { name: string; pct: number; llenos: number; dias: number } => p.pct != null);
  const fracLlenos = (p: { llenos: number; dias: number }) => (p.dias >= DIAS_MINIMOS ? p.llenos / p.dias : null);
  const profLleno = (p: { llenos: number; dias: number }) => (fracLlenos(p) ?? 0) >= DIAS_LLENOS_TOPE;
  const diasTotales = profs.reduce((n, p) => n + p.dias, 0);
  const llenosTotales = profs.reduce((n, p) => n + p.llenos, 0);
  const fracLocal = diasTotales >= DIAS_MINIMOS ? llenosTotales / diasTotales : null;
  const ocupTexto = i.ocupacion != null ? ` El promedio del mes es ${i.ocupacion}%, pero eso no decide: importa lo que pasa en cada horario.` : "";

  // 1) ¿Necesitás más capacidad de atención?
  const titulo1 = "¿Necesitás más capacidad de atención?";
  let contratar: Decision;
  if (fuertesLlenas.length >= FRANJAS_PARA_CAPACIDAD || (fuertesLlenas.length >= 2 && casosLugar >= 6)) {
    const lista = fuertesLlenas.slice(0, 3).map((f) => `${franjaTexto(f.dow, f.hour)} (${f.casos})`).join(", ");
    contratar = {
      clave: "contratar", titulo: titulo1, estado: "si", respuesta: "Sí, sumar capacidad",
      detalle: `Se fueron clientes por falta de lugar en varios horarios que estaban llenos: ${lista}. Se repite en más de un día y horario, así que conviene sumar a alguien o ampliar horarios.${ocupTexto}`,
    };
  } else if (fuertesLlenas.length >= 1) {
    const f = fuertesLlenas[0];
    contratar = {
      clave: "contratar", titulo: titulo1, estado: "si", respuesta: "Reforzá una franja",
      detalle: `${franjaTexto(f.dow, f.hour)}: ${f.casos} ${plural(f.casos, "cliente se fue", "clientes se fueron")} y esa franja estaba al ${f.agendadaPct}% agendada y ${f.atendidaPct}% atendida. Es un horario puntual: alcanza con ampliar o reforzar esa franja, no hace falta sumar a alguien fijo todavía.${ocupTexto}`,
    };
  } else if (franjasConCasos.some((f) => f.casos >= MIN_CASOS_FRANJA)) {
    const f = fuertes[0];
    contratar = {
      clave: "contratar", titulo: titulo1, estado: "info", respuesta: "Revisá horarios",
      detalle: `${franjaTexto(f.dow, f.hour)}: ${f.casos} clientes se fueron aunque esa franja estaba al ${f.agendadaPct}% agendada y ${f.atendidaPct}% atendida. Había tiempo libre: revisá si los turnos se ofrecen en ese horario, si hay bloqueos o si la duración de los turnos deja huecos.`,
    };
  } else if ((fracLocal ?? 0) >= DIAS_LLENOS_TOPE) {
    contratar = {
      clave: "contratar", titulo: titulo1, estado: "cerca", respuesta: "Cerca",
      detalle: `El ${Math.round((fracLocal as number) * 100)}% de los días de tus profesionales estuvo lleno (${llenosTotales} de ${diasTotales}), aunque casi no hay clientes registrados que se hayan ido. Si empiezan a irse por falta de lugar, es momento de sumar capacidad.${ocupTexto}`,
    };
  } else if (casosLugar < 3) {
    contratar = {
      clave: "contratar", titulo: titulo1, estado: "no", respuesta: "Pocos datos",
      detalle: `Solo ${casosLugar} ${plural(casosLugar, "cliente se fue", "clientes se fueron")} por falta de lugar: es poco para concluir. Seguí registrando con el botón "Se fue" y el Asesor va a cruzarlos con la ocupación de cada horario.${ocupTexto}`,
    };
  } else {
    contratar = {
      clave: "contratar", titulo: titulo1, estado: "no", respuesta: "Todavía no",
      detalle: `Los ${casosLugar} clientes que se fueron por falta de lugar están repartidos en horarios que no estaban llenos. No hay una franja que muestre falta de capacidad.${ocupTexto}`,
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
  const profesLlenos = profs.filter(profLleno).sort((a, b) => (fracLlenos(b) ?? 0) - (fracLlenos(a) ?? 0));
  if (profesLlenos.length > 0) {
    const nombres = profesLlenos.map((p) => p.name).join(" y ");
    const detalleLlenos = profesLlenos.map((p) => `${p.name} tuvo la agenda llena ${p.llenos} de ${p.dias} días (promedio del mes ${p.pct}%)`).join(" y ");
    const pedidos =
      i.masPedido && profesLlenos.some((p) => p.name === i.masPedido!.name)
        ? ` Además ${i.masPedido.n} ${i.masPedido.n === 1 ? "cliente lo pidió y se fue" : "clientes lo pidieron y se fueron"}.`
        : "";
    const resto = profs.length > profesLlenos.length ? " Con el resto todavía no: tienen lugar libre." : "";
    precios = {
      clave: "precios", titulo: "¿Subir precios?", estado: "si", respuesta: `Sí, a ${nombres}`,
      detalle: `${detalleLlenos}: casi no ${profesLlenos.length === 1 ? "le" : "les"} queda lugar.${pedidos} Conviene subir el precio de sus servicios entre 5% y 10%.${resto}`,
    };
  } else if (fuertesLlenas.length >= 1) {
    const lista = fuertesLlenas.slice(0, 2).map((f) => franjaTexto(f.dow, f.hour)).join(" y ");
    precios = {
      clave: "precios", titulo: "¿Subir precios?", estado: "cerca", respuesta: "Probá en horarios pico",
      detalle: `${lista} se llena y se van clientes: ahí la demanda supera tu lugar. Podés probar un aumento chico (5% a 10%) o un precio distinto en esos horarios y ver cómo responden.`,
    };
  } else if (franjasLlenasConAlgunCaso.length >= 1) {
    precios = {
      clave: "precios", titulo: "¿Subir precios?", estado: "cerca", respuesta: "Cerca",
      detalle: "Hay horarios llenos donde se fue algún cliente, pero todavía son pocos casos. Seguí registrando antes de mover los precios.",
    };
  } else {
    precios = {
      clave: "precios", titulo: "¿Subir precios?", estado: "no", respuesta: "Todavía no",
      detalle: "No hay horarios llenos con clientes que se vayan: subir los precios ahora puede espantar clientes. Primero conviene llenar la agenda.",
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
