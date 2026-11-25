// Clippi, el asistente de Clippr. Responde con una guía fija (sin inteligencia artificial ni costo):
// busca palabras clave en la pregunta y ofrece un botón que lleva a la pantalla correspondiente.
import type { PermKey } from "@/hooks/use-auth";

export type ClippiDestino = { to: string; search?: Record<string, string> };

export type ClippiTema = {
  id: string;
  /** Texto del atajo y de la pregunta cuando se toca. */
  titulo: string;
  /** Palabras o frases (sin tildes) que identifican el tema. */
  claves: string[];
  respuesta: string;
  boton: string;
  destino: ClippiDestino;
  /** Permiso necesario para ver la pantalla; sin él, el tema no se ofrece. */
  permiso: PermKey;
};

export const CLIPPI_TEMAS: ClippiTema[] = [
  { id: "servicio", titulo: "Crear un servicio", permiso: "configuracion",
    claves: ["servicio", "precio", "duracion", "corte", "barba"],
    respuesta: "En Configuración → Servicios podés crear un servicio nuevo y cambiar su precio o duración.",
    boton: "Ir a Servicios", destino: { to: "/settings", search: { section: "servicios" } } },
  { id: "reservas", titulo: "Revisar señas", permiso: "configuracion",
    claves: ["sena", "deposito", "anticipo", "regla de reserva", "configurar reservas"],
    respuesta: "Las señas y las reglas de reserva se configuran en Configuración → Reservas. Las señas por revisar te aparecen como aviso en Inicio y en Caja.",
    boton: "Ir a Reservas", destino: { to: "/settings", search: { section: "senas" } } },
  { id: "turno", titulo: "Agendar un turno", permiso: "agenda",
    claves: ["turno", "agenda", "agendar", "reprogramar", "cancelar", "bloquear", "dia cerrado", "horario especial", "franco"],
    respuesta: "En la Agenda podés agregar un turno, o tocar uno para verlo, cambiarlo o cancelarlo. Desde ahí también cargás un horario especial o un día cerrado.",
    boton: "Abrir la Agenda", destino: { to: "/agenda" } },
  { id: "horarios", titulo: "Cambiar los horarios", permiso: "configuracion",
    claves: ["horario del local", "horarios", "apertura", "hora de cierre", "abrimos", "descanso"],
    respuesta: "Los horarios del local están en Configuración → Página de reservas.",
    boton: "Ir a Página de reservas", destino: { to: "/settings", search: { section: "branding" } } },
  { id: "pagina", titulo: "Editar mi página", permiso: "configuracion",
    claves: ["pagina", "web", "link", "enlace", "portada", "banner", "logo", "foto del local", "color", "reservas online"],
    respuesta: "En Configuración → Página de reservas cambiás la portada, el logo y los colores. El link para compartir está en el botón WWW de arriba.",
    boton: "Ir a Página de reservas", destino: { to: "/settings", search: { section: "branding" } } },
  { id: "cobrar", titulo: "Cobrar o cargar un gasto", permiso: "caja",
    claves: ["cobrar", "cobro", "venta", "gasto", "caja", "efectivo", "transferencia", "propina"],
    respuesta: "En Caja registrás ventas y gastos y ves cuánto hay en efectivo y en el banco. Para cobrar tenés que haber fichado y tener la caja abierta.",
    boton: "Abrir Caja", destino: { to: "/cash-register", search: { tab: "resumen" } } },
  { id: "cierres", titulo: "Ver cierres de caja", permiso: "caja",
    claves: ["cierre", "cerrar caja", "arqueo", "historial"],
    respuesta: "Los cierres están en Caja → Cierres. Ahí revisás los días pendientes y el historial.",
    boton: "Ver cierres", destino: { to: "/cash-register", search: { tab: "cierres" } } },
  { id: "liquidaciones", titulo: "Pagar al equipo", permiso: "caja",
    claves: ["liquid", "comision", "sueldo", "pagar al equipo", "adelanto", "pago a barbero"],
    respuesta: "En Caja → Liquidaciones ves comisiones, propinas y adelantos de cada profesional antes de pagar.",
    boton: "Ir a Liquidaciones", destino: { to: "/cash-register", search: { tab: "profesionales" } } },
  { id: "inventario", titulo: "Revisar el stock", permiso: "caja",
    claves: ["stock", "inventario", "producto", "mercaderia"],
    respuesta: "En Caja → Inventario consultás el stock y registrás entradas y retiros.",
    boton: "Ir a Inventario", destino: { to: "/cash-register", search: { tab: "inventario" } } },
  { id: "equipo", titulo: "Sumar un barbero", permiso: "configuracion",
    claves: ["barbero", "equipo", "profesional", "empleado", "permiso", "acceso", "invitar"],
    respuesta: "En Configuración → Equipo sumás profesionales, cambiás sus fotos y definís qué puede ver cada uno.",
    boton: "Ir a Equipo", destino: { to: "/settings", search: { section: "equipo" } } },
  { id: "tardanza", titulo: "Fichaje y tardanzas", permiso: "configuracion",
    claves: ["fichaje", "fichar", "asistencia", "tardanza", "llegada tarde", "presentismo", "qr"],
    respuesta: "Quién fichó se ve en Inicio, en «Fichaje de hoy», donde también está el QR. Las reglas de tardanza se cambian en Configuración.",
    boton: "Ir a Reglas de tardanza", destino: { to: "/settings", search: { section: "tardanza" } } },
  { id: "clientes", titulo: "Buscar un cliente", permiso: "clientes",
    claves: ["cliente", "contactar", "whatsapp", "perdido", "volver"],
    respuesta: "En Clientes podés buscar a cualquiera, ver su historial y encontrar a quienes dejaron de venir para contactarlos.",
    boton: "Ir a Clientes", destino: { to: "/clients" } },
  { id: "resenas", titulo: "Ver las reseñas", permiso: "configuracion",
    claves: ["resena", "opinion", "estrella", "calificacion"],
    respuesta: "En Configuración → Reseñas ves las opiniones y elegís cuáles destacar en tu página.",
    boton: "Ir a Reseñas", destino: { to: "/settings", search: { section: "resenas" } } },
  { id: "sucursales", titulo: "Sucursales", permiso: "configuracion",
    claves: ["sucursal", "direccion", "ubicacion", "otro local"],
    respuesta: "En Configuración → Sucursales administrás tus locales. Para cambiar de sucursal usá el selector de arriba.",
    boton: "Ir a Sucursales", destino: { to: "/settings", search: { section: "sucursales" } } },
  { id: "asesor", titulo: "¿Cómo va mi negocio?", permiso: "asesor_ia",
    claves: ["como va", "ganancia", "facturacion", "reporte", "estadistica", "ocupacion", "rendimiento", "cuanto gane", "asesor"],
    respuesta: "El Asesor IA te muestra ventas, clientes y ocupación para saber cómo va el negocio.",
    boton: "Abrir el Asesor", destino: { to: "/advisor" } },
];

export type ClippiRespuesta = { texto: string; tema?: ClippiTema };

export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function responderClippi(pregunta: string, puede: (permiso: PermKey) => boolean): ClippiRespuesta {
  const texto = ` ${normalizar(pregunta)}`;
  // Cada clave vale su largo: una frase ("cerrar caja") pesa más que una palabra suelta ("caja").
  // Se compara desde el comienzo de palabra, así "turnos" o "liquidar" también cuentan.
  let mejor: ClippiTema | undefined;
  let puntos = 0;
  for (const tema of CLIPPI_TEMAS) {
    const exacto = normalizar(tema.titulo) === texto.trim() ? 1000 : 0;
    const p = exacto + tema.claves.reduce((s, c) => (texto.includes(` ${c}`) ? s + c.length : s), 0);
    if (p > puntos) {
      mejor = tema;
      puntos = p;
    }
  }
  if (mejor) {
    return puede(mejor.permiso)
      ? { texto: mejor.respuesta, tema: mejor }
      : { texto: "Tu cuenta no tiene acceso a esa parte. Pedíselo al dueño o a quien administra el local." };
  }
  if (/ (hola|buenas|buen dia|que tal)/.test(texto)) return { texto: "¡Hola! Contame qué querés hacer en Clippr." };
  if (/ (gracias|genial|listo|perfecto)/.test(texto)) return { texto: "¡De nada! Acá estoy si necesitás otra cosa." };
  return { texto: "Todavía no sé responder eso. Probá con otras palabras (por ejemplo «turno», «caja» o «servicio») o elegí uno de los atajos." };
}
