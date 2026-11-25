// Clippi, el asistente de Clippr. No usa inteligencia artificial (ni tiene costo): compara lo que
// escribe la persona con las preguntas de clippi-respuestas.ts y elige la más parecida.
import type { PermKey } from "@/hooks/use-auth";
import { CLIPPI_TEMAS as BASE, type ClippiTema } from "./clippi-respuestas";
import { CLIPPI_TEMAS_EXTRA } from "./clippi-respuestas-extra";
import { CLIPPI_FRASES } from "./clippi-frases";

// Todos los temas, cada uno con todas sus formas de preguntar. Los primeros son los atajos.
export const CLIPPI_TEMAS: ClippiTema[] = [...BASE, ...CLIPPI_TEMAS_EXTRA].map((tema) => ({
  ...tema,
  preguntas: [...tema.preguntas, ...(CLIPPI_FRASES[tema.id]?.split("|") ?? [])],
}));
export type { ClippiTema, ClippiDestino } from "./clippi-respuestas";

export type ClippiRespuesta = {
  texto: string;
  tema?: ClippiTema;
  sugerencias?: ClippiTema[];
  /** "resolvio": preguntar si se resolvió. "asesor": ofrecer hablar con un asesor. */
  derivar?: "resolvio" | "asesor";
};

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

// Dos palabras que difieren en una sola letra (de más, de menos, cambiada o invertida).
function casiIgual(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const resto = (x: number, y: number) => a.slice(i + x) === b.slice(i + y);
  return resto(1, 1) || resto(1, 0) || resto(0, 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && resto(2, 2));
}

export function palabras(texto: string, corregir: (palabra: string) => string = (p) => p): string[] {
  const salida = new Set<string>();
  // "Sacar turno" es reservar (distinto de "sacar un turno", que es quitarlo).
  const limpio = normalizar(texto).replace(/\bsac(ar|an|a|o) turnos?\b/g, "reservar turno");
  for (const escrita of limpio.split(" ")) {
    const p = corregir(escrita);
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

// Todas las palabras que Clippi conoce, para corregir errores de tipeo ("turmo" → "turno").
const CONOCIDAS = new Set(CLIPPI_TEMAS.flatMap((t) => [t.titulo, ...t.preguntas].flatMap((f) => normalizar(f).split(" "))));
function corregirTipeo(p: string): string {
  if (p.length < 5 || CONOCIDAS.has(p) || VACIAS.has(p)) return p;
  for (const c of CONOCIDAS) if (c.length >= 4 && c[0] === p[0] && casiIgual(p, c)) return c;
  return p;
}

// Una palabra que aparece en pocos temas ("propina") dice más que una que está en muchos ("cambiar").
const USOS = new Map<string, number>();
for (const { frases } of INDICE) {
  for (const p of new Set(frases.flatMap((f) => f.palabras))) USOS.set(p, (USOS.get(p) ?? 0) + 1);
}
const peso = (p: string) => Math.log(1 + INDICE.length / (USOS.get(p) ?? 1));
const sumar = (lista: string[]) => lista.reduce((s, p) => s + peso(p), 0);

const SEGURO = 0.5;
const DUDOSO = 0.22;

// "El asesor se tilda" es una falla, no una pregunta sobre cómo se usa el Asesor.
const TRABADO = /\b(tild\w*|colg\w*|cuelga|traba\w*|congel\w*|lent[oa]|no (me )?(carga|abre)|queda cargando|pantalla (en )?(blanco|negra)|se cierra sol[ao])\b/;
const FALLA = /\b(no (me )?(anda|funciona|responde)|falla\w*|error(es)?|problemas?|inconvenientes?|se rompio|anda mal|funciona mal)\b/;
// Temas que ya explican una falla concreta.
const TEMAS_DE_FALLA = new Set(["no-puedo-cobrar", "no-liquidar", "cierre-requisitos", "web-no-disponible", "asesor-sin-datos", "fichar-codigo", "avisos"]);
const PANTALLAS: { patron: RegExp; nombre: string; permiso: PermKey; destino: string }[] = [
  { patron: /\basesor\b/, nombre: "el Asesor IA", permiso: "asesor_ia", destino: "/advisor" },
  { patron: /\bagenda\b/, nombre: "la Agenda", permiso: "agenda", destino: "/agenda" },
  { patron: /\bcaja\b/, nombre: "Caja", permiso: "caja", destino: "/cash-register" },
  { patron: /\bclientes?\b/, nombre: "Clientes", permiso: "clientes", destino: "/clients" },
  { patron: /\binicio\b/, nombre: "Inicio", permiso: "dashboard", destino: "/dashboard" },
  { patron: /\bconfiguracion\b/, nombre: "Configuración", permiso: "configuracion", destino: "/settings" },
  { patron: /\bmi panel\b/, nombre: "Mi Panel", permiso: "profesionales", destino: "/professionals" },
];

function respuestaDeFalla(texto: string, puede: (permiso: PermKey) => boolean): ClippiRespuesta {
  const pantalla = PANTALLAS.find((p) => p.patron.test(texto));
  const donde = pantalla?.nombre ?? "la app";
  const tema: ClippiTema | undefined =
    pantalla && puede(pantalla.permiso)
      ? { id: "falla", titulo: "", preguntas: [], respuesta: "", boton: "Volver a probar", destino: { to: pantalla.destino } }
      : undefined;
  return {
    texto: `Si falla ${donde}, probá esto:\n1. Recargá la página (en la app instalada, cerrala del todo y abrila de nuevo).\n2. Revisá tu conexión: probá con wifi o con datos.`,
    tema,
    derivar: "resolvio",
  };
}

export function responderClippi(pregunta: string, puede: (permiso: PermKey) => boolean): ClippiRespuesta {
  const texto = normalizar(pregunta);
  const mias = palabras(pregunta, corregirTipeo);
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

  // Una falla se atiende como falla, salvo que la pregunta esté guardada tal cual o haya un tema para esa falla.
  const exacta = primero?.puntos === 2;
  const conocida = primero && primero.puntos >= SEGURO && TEMAS_DE_FALLA.has(primero.tema.id);
  const nombraPantalla = PANTALLAS.some((p) => p.patron.test(texto));
  if (!exacta && !conocida && (TRABADO.test(texto) || (FALLA.test(texto) && nombraPantalla))) return respuestaDeFalla(texto, puede);

  if (primero && (primero.puntos >= SEGURO && (!segundo || primero.puntos - segundo.puntos >= 0.04 || primero.puntos >= 0.8))) {
    return permitido(primero.tema)
      ? {
          texto: primero.tema.respuesta,
          tema: primero.tema,
          derivar: ["persona", "insulto", "problema"].includes(primero.tema.id) ? "asesor" : TEMAS_DE_FALLA.has(primero.tema.id) || primero.tema.id === "lenta" ? "resolvio" : undefined,
        }
      : { texto: "Tu cuenta no tiene acceso a esa parte. Pedíselo al dueño o a quien administra el local." };
  }
  const sugerencias = candidatos.map((c) => c.tema).filter(permitido).slice(0, 3);
  if (sugerencias.length) return { texto: "¿Te referís a alguna de estas?", sugerencias };
  return {
    texto: "Todavía no sé responder eso. Contame en qué parte de la app estás (Agenda, Caja, Clientes, Configuración…) y qué querés hacer, o hablá con un asesor.",
    derivar: "asesor",
  };
}
