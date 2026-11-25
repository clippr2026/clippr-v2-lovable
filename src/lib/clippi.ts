// Clippi, el asistente de Clippr. No usa inteligencia artificial (ni tiene costo): compara lo que
// escribe la persona con las preguntas de clippi-respuestas.ts y elige la más parecida.
import type { PermKey } from "@/hooks/use-auth";
import { CLIPPI_TEMAS, type ClippiTema } from "./clippi-respuestas";

export { CLIPPI_TEMAS };
export type { ClippiTema, ClippiDestino } from "./clippi-respuestas";

export type ClippiRespuesta = { texto: string; tema?: ClippiTema; sugerencias?: ClippiTema[] };

export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Palabras que no ayudan a distinguir una pregunta de otra.
const VACIAS = new Set(
  ("a al algo alguien como con cual de del desde donde el ella en es esa ese eso esta este esto ha hace hacer hago hay la las le les lo los me mi mis muy " +
    "necesito no o para pero por porque puedo puede pueden que quiero quiere se ser si sin sobre su sus te tengo tiene tu un una uno unos y ya yo " +
    "app clippr deja dejar favor saber ver veo voy va").split(" "),
);

// Distintas formas de decir lo mismo.
const SINONIMOS: [RegExp, string][] = [
  [/^(turnos?|citas?)$/, "turno"],
  [/^(cobr)/, "cobrar"],
  [/^(vent|vend)/, "venta"],
  [/^(anul)/, "anular"],
  [/^(correg|corrij|correccion|equivoq|equivoc|edit)/, "corregir"],
  [/^(cancel)/, "cancelar"],
  [/^(muev|mover|movi(?!mient)|cambi|modific|actualiz|reprogram)/, "cambiar"],
  [/^(agreg|agrego|crea|creo|crear|sumar|sumo|carg|anot|pongo|poner|registr|nuev|alta)/, "crear"],
  [/^(elimin|borr|quit|sac[aoq])/, "borrar"],
  [/^(barber[os]*$|profesional|emplead|peluquer)/, "barbero"],
  [/^(plata|dinero|guita)/, "plata"],
  [/^(precio|cuesta|vale$|valor)/, "precio"],
  [/^(contrasen|clave|password)/, "clave"],
  [/^(foto|imagen)/, "foto"],
  [/^(horario)/, "horario"],
  [/^(liquid)/, "liquidar"],
  [/^(comision)/, "comision"],
  [/^(cierr|cerr)/, "cerrar"],
  [/^(reabr)/, "reabrir"],
  [/^(fich)/, "fichar"],
  [/^(gast|egreso)/, "gasto"],
  [/^(se[nñ]as?$|deposito|anticipo)/, "sena"],
  [/^(avis|notific)/, "aviso"],
  [/^(web|pagina|sitio)/, "pagina"],
  [/^(link|enlace)/, "link"],
  [/^(descuent|promo|ofert|rebaj)/, "promo"],
  [/^(confirm)/, "confirmar"],
  [/^(bloque)/, "bloquear"],
];

export function palabras(texto: string): string[] {
  const salida = new Set<string>();
  for (const p of normalizar(texto).split(" ")) {
    if (!p || VACIAS.has(p)) continue;
    const sinonimo = SINONIMOS.find(([patron]) => patron.test(p))?.[1];
    // Sin plural: "servicios" y "servicio" cuentan igual.
    salida.add(sinonimo ?? (p.length > 3 ? p.replace(/s$/, "") : p));
  }
  return [...salida];
}

const INDICE = CLIPPI_TEMAS.map((tema) => ({
  tema,
  frases: [tema.titulo, ...tema.preguntas].map((f) => ({ texto: normalizar(f), palabras: palabras(f) })),
}));

// Una palabra que aparece en pocos temas ("propina") dice más que una que está en muchos ("cambiar").
const USOS = new Map<string, number>();
for (const { frases } of INDICE) {
  for (const p of new Set(frases.flatMap((f) => f.palabras))) USOS.set(p, (USOS.get(p) ?? 0) + 1);
}
const peso = (p: string) => Math.log(1 + INDICE.length / (USOS.get(p) ?? 1));
const sumar = (lista: string[]) => lista.reduce((s, p) => s + peso(p), 0);

const SEGURO = 0.5;
const DUDOSO = 0.22;

export function responderClippi(pregunta: string, puede: (permiso: PermKey) => boolean): ClippiRespuesta {
  const texto = normalizar(pregunta);
  const mias = palabras(pregunta);
  const candidatos = INDICE.map(({ tema, frases }) => {
    let puntos = 0;
    const propias = new Set(frases.flatMap((f) => f.palabras));
    // Cuánto de lo que escribió la persona está en el tema…
    const cubierto = mias.length ? sumar(mias.filter((p) => propias.has(p))) / sumar(mias) : 0;
    for (const f of frases) {
      if (f.texto === texto) return { tema, puntos: 2 };
      const comunes = sumar(mias.filter((p) => f.palabras.includes(p)));
      if (!comunes) continue;
      // …y cuánto se parece a una de sus preguntas en particular.
      const parecido = (2 * comunes) / (sumar(mias) + sumar(f.palabras));
      puntos = Math.max(puntos, 0.7 * parecido + 0.3 * cubierto);
    }
    return { tema, puntos };
  })
    .filter((c) => c.puntos >= DUDOSO)
    .sort((a, b) => b.puntos - a.puntos);

  const [primero, segundo] = candidatos;
  const permitido = (t: ClippiTema) => !t.permiso || puede(t.permiso);

  if (primero && (primero.puntos >= SEGURO && (!segundo || primero.puntos - segundo.puntos >= 0.04 || primero.puntos >= 0.8))) {
    return permitido(primero.tema)
      ? { texto: primero.tema.respuesta, tema: primero.tema }
      : { texto: "Tu cuenta no tiene acceso a esa parte. Pedíselo al dueño o a quien administra el local." };
  }
  const sugerencias = candidatos.map((c) => c.tema).filter(permitido).slice(0, 3);
  if (sugerencias.length) return { texto: "¿Te referís a alguna de estas?", sugerencias };
  return {
    texto: "Todavía no sé responder eso. Contame en qué parte de la app estás (Agenda, Caja, Clientes, Configuración…) y qué querés hacer.",
  };
}
