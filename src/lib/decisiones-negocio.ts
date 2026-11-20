// Asesor IA: decisiones del dueño (¿conviene contratar?, ¿entender los horarios?, ¿subir precios?) con una respuesta
// clara —Sí, Cerca o No— y su porqué en una frase: cuánta ocupación hay y cuántos clientes se fueron y por qué.
// Cruza los clientes que se fueron sin atender con la ocupación AGENDADA y la ATENDIDA de cada franja (día de la
// semana y hora), en vez de apoyarse en un porcentaje fijo: un local puede estar al 47% en el mes y no tener lugar los
// jueves a las 18 hs.

export type DecisionEstado = "si" | "cerca" | "no" | "info";

export type Decision = {
  clave: "contratar" | "horarios" | "precios";
  titulo: string;
  estado: DecisionEstado;
  /** Respuesta corta: "Sí", "Cerca", "No", "Abrir antes"… */
  respuesta: string;
  detalle: string;
};

/** Ocupación de una franja (día de la semana 0-6 y hora 0-23), en minutos y con tope por profesional y hora. */
export type FranjaOcupacion = { dow: number; hour: number; disponible: number; agendado: number; atendido: number };
/** Ocupación de una hora de un día puntual. */
export type FranjaDiaOcupacion = { dateKey: string; hour: number; disponible: number; agendado: number; atendido: number };

export type DecisionesInput = {
  /** Ocupación atendida del mes (0-100), null si no hay horarios cargados. */
  ocupacion: number | null;
  /** daysWorked/daysFull: días trabajados y días con 90% o más de los turnos atendidos (con o sin turno sacado). */
  profesionales: Array<{ name: string; used: number; capacity: number; daysWorked?: number; daysFull?: number }>;
  /** Clientes que se fueron aceptando a cualquiera (falta de lugar), con el día y la hora en que se fueron. */
  seFueronPorLugarFranjas: Array<{ dow: number; hour: number; dateKey?: string }>;
  /** Clientes que se fueron por el precio (botón "Se fue" de la Agenda). */
  seFueronPorPrecio?: number;
  /** Profesional más pedido por clientes que se fueron (cantidad y nombre). */
  masPedido: { name: string; n: number } | null;
  /** Día de la semana y hora con más clientes que se fueron (ej. "miércoles", 19). */
  franjaConMasCasos: { dia: string; hora: number } | null;
  /** Ocupación por franja del mes. */
  franjas?: FranjaOcupacion[];
  /** Ocupación hora por hora de cada día del mes (para ver cómo estaba el horario justo cuando se fue el cliente). */
  franjasDia?: FranjaDiaOcupacion[];
};

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
/** Una franja está llena cuando lo agendado o lo atendido ocupa esta parte de su tiempo disponible. */
export const FRANJA_LLENA = 0.85;
/** Clientes que tienen que haberse ido en la misma franja para tomarla como una señal. */
export const MIN_CASOS_FRANJA = 2;
/** Clientes que se fueron por falta de lugar a partir de los cuales hay una señal para contratar. */
export const MIN_CASOS_CONTRATAR = 3;
/** Proporción de días llenos de un profesional (90% de sus turnos) a partir de la cual no le queda lugar. */
export const DIAS_LLENOS_TOPE = 0.4;
/** Días trabajados mínimos para fiarse de la proporción de días llenos. */
export const DIAS_MINIMOS = 8;

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : null);
const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);
const clientes = (n: number) => (n === 1 ? "1 cliente" : `${n} clientes`);
const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];
/** "jueves, viernes y sábado", en el orden de la semana. */
const listaDias = (dows: number[]) => {
  const ordenados = ORDEN_SEMANA.filter((d) => dows.includes(d)).map((d) => DIAS[d]);
  if (ordenados.length <= 1) return ordenados.join("");
  return `${ordenados.slice(0, -1).join(", ")} y ${ordenados[ordenados.length - 1]}`;
};
const lleno = (f: { disponible: number; agendado: number; atendido: number }) =>
  f.disponible > 0 && Math.max(f.agendado, f.atendido) / f.disponible >= FRANJA_LLENA;

export function evaluarDecisiones(i: DecisionesInput): Decision[] {
  const franjas = i.franjas ?? [];
  const franjaDiaPorClave = new Map((i.franjasDia ?? []).map((f) => [`${f.dateKey}|${f.hour}`, f]));
  const casosLugar = i.seFueronPorLugarFranjas.length;
  const porPrecio = i.seFueronPorPrecio ?? 0;
  const ocup = i.ocupacion != null ? `la ocupación es ${i.ocupacion}%` : "";

  // Clientes que se fueron por lugar, por franja y por día de la semana.
  const casosPorFranja = new Map<string, { dow: number; hour: number; casos: number }>();
  const casosPorDia = new Map<number, number>();
  for (const c of i.seFueronPorLugarFranjas) {
    const k = `${c.dow}|${c.hour}`;
    const e = casosPorFranja.get(k) ?? { dow: c.dow, hour: c.hour, casos: 0 };
    e.casos += 1;
    casosPorFranja.set(k, e);
    casosPorDia.set(c.dow, (casosPorDia.get(c.dow) ?? 0) + 1);
  }
  const franjasFuertes = [...casosPorFranja.values()].filter((f) => f.casos >= MIN_CASOS_FRANJA);
  // Días con señal: los de las franjas con 2 o más casos y los días con 2 o más casos.
  const diasConSenal = [...new Set([...franjasFuertes.map((f) => f.dow), ...[...casosPorDia].filter(([, n]) => n >= MIN_CASOS_FRANJA).map(([d]) => d)])];
  // ¿Esas franjas estaban llenas (en promedio o el día exacto en que se fue el cliente)?
  const franjaPorClave = new Map(franjas.map((f) => [`${f.dow}|${f.hour}`, f]));
  const fuertesLlenas = franjasFuertes.filter((c) => {
    const f = franjaPorClave.get(`${c.dow}|${c.hour}`);
    if (f && lleno(f)) return true;
    const momentos = i.seFueronPorLugarFranjas
      .filter((x) => x.dow === c.dow && x.hour === c.hour && x.dateKey)
      .map((x) => franjaDiaPorClave.get(`${x.dateKey}|${x.hour}`))
      .filter((f): f is FranjaDiaOcupacion => !!f && f.disponible > 0);
    return momentos.filter(lleno).length * 2 >= c.casos && momentos.length > 0;
  });

  const profs = i.profesionales
    .map((p) => ({ name: p.name, pct: pct(p.used, p.capacity), llenos: p.daysFull ?? 0, dias: p.daysWorked ?? 0 }))
    .filter((p): p is { name: string; pct: number; llenos: number; dias: number } => p.pct != null);
  const fracLlenos = (p: { llenos: number; dias: number }) => (p.dias >= DIAS_MINIMOS ? p.llenos / p.dias : null);
  const profLleno = (p: { llenos: number; dias: number }) => (fracLlenos(p) ?? 0) >= DIAS_LLENOS_TOPE;
  const diasTotales = profs.reduce((n, p) => n + p.dias, 0);
  const llenosTotales = profs.reduce((n, p) => n + p.llenos, 0);
  const fracLocal = diasTotales >= DIAS_MINIMOS ? llenosTotales / diasTotales : null;

  // 1) ¿Conviene contratar?
  const t1 = "¿Conviene contratar?";
  let contratar: Decision;
  const diasTexto = listaDias(diasConSenal.length > 0 ? diasConSenal : [...casosPorDia.keys()].slice(0, 3));
  const queOcup = ocup ? `${ocup} y ` : "";
  if (casosLugar >= MIN_CASOS_CONTRATAR && (franjasFuertes.length > 0 || diasConSenal.length > 0)) {
    contratar = {
      clave: "contratar", titulo: t1, estado: "si", respuesta: "Sí",
      detalle: `Sí, porque ${queOcup}se fueron ${clientes(casosLugar)} por falta de lugar${diasTexto ? `, sobre todo ${diasTexto}` : ""}. Conviene contratar${diasTexto ? ` para ${diasTexto}` : ""}.${fuertesLlenas.length > 0 ? " Esos horarios están llenos." : ""}`,
    };
  } else if (casosLugar >= MIN_CASOS_CONTRATAR) {
    contratar = {
      clave: "contratar", titulo: t1, estado: "cerca", respuesta: "Cerca",
      detalle: `Cerca: ${queOcup}se fueron ${clientes(casosLugar)} por falta de lugar, en horarios y días distintos. Si se repite en los mismos días, conviene contratar.`,
    };
  } else if (casosLugar === 2 && fuertesLlenas.length > 0) {
    contratar = {
      clave: "contratar", titulo: t1, estado: "cerca", respuesta: "Cerca",
      detalle: `Cerca: ${queOcup}se fueron 2 clientes por falta de lugar en un horario lleno (${diasTexto}). Si se repite, conviene contratar para ese día.`,
    };
  } else if ((fracLocal ?? 0) >= DIAS_LLENOS_TOPE) {
    contratar = {
      clave: "contratar", titulo: t1, estado: "cerca", respuesta: "Cerca",
      detalle: `Cerca: ${llenosTotales} de ${diasTotales} días estuvieron llenos${casosLugar > 0 ? ` y se ${plural(casosLugar, "fue", "fueron")} ${clientes(casosLugar)} por falta de lugar` : ", pero no hay clientes que se hayan ido por falta de lugar"}. Si empiezan a irse, conviene contratar.`,
    };
  } else {
    contratar = {
      clave: "contratar", titulo: t1, estado: "no", respuesta: "No",
      detalle: `No, porque ${queOcup}${casosLugar === 0 ? "no hay clientes que se hayan ido por falta de lugar" : `solo ${plural(casosLugar, "se fue", "se fueron")} ${clientes(casosLugar)} por falta de lugar`}.`,
    };
  }

  // 2) ¿Entender los horarios? Primero y última hora de cada día de la semana: ¿conviene abrir antes o cerrar más tarde?
  const abrirAntes: number[] = [];
  const cerrarMasTarde: number[] = [];
  for (const dow of ORDEN_SEMANA) {
    const abiertas = franjas.filter((f) => f.dow === dow && f.disponible > 0).sort((a, b) => a.hour - b.hour);
    if (abiertas.length === 0) continue;
    const primera = abiertas[0];
    const ultima = abiertas[abiertas.length - 1];
    const antes = i.seFueronPorLugarFranjas.filter((c) => c.dow === dow && c.hour < primera.hour).length;
    const despues = i.seFueronPorLugarFranjas.filter((c) => c.dow === dow && c.hour > ultima.hour).length;
    if (lleno(primera) || antes > 0) abrirAntes.push(dow);
    if (lleno(ultima) || despues > 0) cerrarMasTarde.push(dow);
  }
  const t2 = "¿Entender los horarios?";
  const horarioPartes: string[] = [];
  if (abrirAntes.length > 0) horarioPartes.push(`Abrir antes ${abrirAntes.length > 1 ? "los" : "el"} ${listaDias(abrirAntes)}: la primera hora ya se llena${abrirAntes.length > 1 ? "" : ""}.`);
  if (cerrarMasTarde.length > 0) horarioPartes.push(`Cerrar más tarde ${cerrarMasTarde.length > 1 ? "los" : "el"} ${listaDias(cerrarMasTarde)}: la última hora ya se llena.`);
  let horarios: Decision;
  if (horarioPartes.length > 0) {
    horarios = {
      clave: "horarios", titulo: t2,
      estado: "si",
      respuesta: abrirAntes.length > 0 && cerrarMasTarde.length > 0 ? "Ampliar horario" : abrirAntes.length > 0 ? "Abrir antes" : "Cerrar más tarde",
      detalle: horarioPartes.join(" "),
    };
  } else {
    const otras: string[] = [];
    if (profs.length >= 2) {
      const orden = [...profs].sort((a, b) => b.pct - a.pct);
      const alto = orden[0];
      const bajo = orden[orden.length - 1];
      if (alto.pct - bajo.pct >= 20) otras.push(`${bajo.name} está al ${bajo.pct}% y ${alto.name} al ${alto.pct}%: hay lugar en ${bajo.name}.`);
    }
    if (i.franjaConMasCasos) otras.push(`Más clientes se fueron el ${i.franjaConMasCasos.dia} de ${i.franjaConMasCasos.hora} a ${i.franjaConMasCasos.hora + 1} hs.`);
    horarios = {
      clave: "horarios", titulo: t2, estado: "no", respuesta: "No",
      detalle: `No hace falta abrir antes ni cerrar más tarde: la primera y la última hora no se llenan. ${otras.join(" ")}`.trim(),
    };
  }

  // 3) ¿Subir precios?
  const t3 = "¿Subir precios?";
  const profesLlenos = profs.filter(profLleno).sort((a, b) => (fracLlenos(b) ?? 0) - (fracLlenos(a) ?? 0));
  const hayDemanda = profesLlenos.length > 0 || casosLugar >= MIN_CASOS_CONTRATAR || fuertesLlenas.length > 0 || (fracLocal ?? 0) >= DIAS_LLENOS_TOPE;
  const sinPrecio = porPrecio === 0 ? "no hay clientes que se hayan ido por el precio" : `${clientes(porPrecio)} se ${plural(porPrecio, "fue", "fueron")} por el precio`;
  let precios: Decision;
  if (hayDemanda && profesLlenos.length > 0 && porPrecio < 3) {
    const nombres = profesLlenos.map((p) => p.name).join(" y ");
    const llenos = profesLlenos.map((p) => `${p.name} tuvo la agenda llena ${p.llenos} de ${p.dias} días`).join(" y ");
    precios = {
      clave: "precios", titulo: t3, estado: "si", respuesta: `Sí, a ${nombres}`,
      detalle: `Sí, porque ${llenos} y ${sinPrecio}. Conviene subir sus precios entre 5% y 10%.${profs.length > profesLlenos.length ? " Con el resto todavía no." : ""}`,
    };
  } else if (hayDemanda && porPrecio === 0) {
    precios = {
      clave: "precios", titulo: t3, estado: "si", respuesta: "Sí",
      detalle: `Sí, porque ${ocup ? `${ocup}, ` : ""}hay clientes que se fueron por falta de lugar y ${sinPrecio}. Podés subir entre 5% y 10%.`,
    };
  } else if (hayDemanda) {
    precios = {
      clave: "precios", titulo: t3, estado: "cerca", respuesta: "Con cuidado",
      detalle: `Hay demanda (${ocup || "agenda con picos"}), pero ${sinPrecio}. Si subís, que sea poco (5%) y mirá cómo responden.`,
    };
  } else {
    precios = {
      clave: "precios", titulo: t3, estado: "no", respuesta: "No",
      detalle: `No, porque ${ocup ? `${ocup}, ` : ""}no hay horarios llenos con clientes que se vayan${porPrecio > 0 ? ` y ${sinPrecio}` : ""}. Subir precios ahora puede espantar clientes.`,
    };
  }

  return [contratar, horarios, precios];
}
