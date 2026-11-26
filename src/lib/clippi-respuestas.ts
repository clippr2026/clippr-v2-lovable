// Preguntas y respuestas de Clippi. Para enseñarle algo nuevo: agregar un tema acá (o sumar
// otra forma de preguntarlo en "preguntas") y, si hace falta, un caso en clippi.test.ts.
import type { PermKey } from "@/hooks/use-auth";

export type ClippiDestino = { to: string; search?: Record<string, string> };

export type ClippiTema = {
  id: string;
  /** Texto del atajo o de la sugerencia. */
  titulo: string;
  /** Formas en que una persona lo preguntaría. */
  preguntas: string[];
  respuesta: string;
  boton?: string;
  destino?: ClippiDestino;
  /** Permiso necesario; sin permiso indicado, lo puede ver cualquiera. */
  permiso?: PermKey;
};

export type Extra = Pick<ClippiTema, "boton" | "destino" | "permiso">;

export const agenda: Extra = { permiso: "agenda", boton: "Abrir la Agenda", destino: { to: "/agenda" } };
export const caja = (tab: string, boton = "Abrir Caja"): Extra => ({ permiso: "caja", boton, destino: { to: "/cash-register", search: { tab } } });
export const config = (section: string, boton: string): Extra => ({ permiso: "configuracion", boton, destino: { to: "/settings", search: { section } } });
export const clientes: Extra = { permiso: "clientes", boton: "Ir a Clientes", destino: { to: "/clients" } };
export const inicio: Extra = { permiso: "dashboard", boton: "Ir a Inicio", destino: { to: "/dashboard" } };
export const panel: Extra = { permiso: "profesionales", boton: "Abrir Mi Panel", destino: { to: "/professionals" } };
export const asesor: Extra = { permiso: "asesor_ia", boton: "Abrir el Asesor", destino: { to: "/advisor" } };

const t = (id: string, titulo: string, preguntas: string[], respuesta: string, extra: Extra = {}): ClippiTema => ({ id, titulo, preguntas, respuesta, ...extra });

export const CLIPPI_TEMAS: ClippiTema[] = [
  // ───── Atajos (los primeros que tenga permitidos se muestran al abrir el chat) ─────
  t("servicio-crear", "Crear un servicio", ["como agrego un servicio nuevo", "quiero cargar un corte nuevo", "como creo un combo", "agregar servicio de barba"],
    "En Configuración → Servicios creás el servicio con su nombre, precio, duración y foto. Después de guardarlo podés elegir qué profesionales lo hacen, sus horarios y una promo.", config("servicios", "Ir a Servicios")),
  t("senas", "Configurar señas", ["revisar señas", "como pido seña", "quiero cobrar un deposito para reservar", "pedir anticipo a los clientes", "como activo las señas"],
    "En Configuración → Reservas elegís en qué servicios se pide seña, a quiénes (todos, primera vez o quienes faltaron), cuánto, y a qué CBU o CVU te transfieren.", config("senas", "Ir a Reservas")),
  t("turno-crear", "Agendar un turno", ["como creo un turno", "anotar un cliente en la agenda", "agregar turno", "reservar para un cliente", "dar un turno"],
    "En la Agenda tocá un casillero libre del profesional (o el botón Nuevo) y elegí «Agregar turno». Completá cliente, servicio y horario.", agenda),
  t("horarios-local", "Cambiar los horarios", ["cambiar horario del local", "a que hora abrimos", "modificar apertura y cierre", "horarios de atencion", "que dias abre la barberia"],
    "Los horarios del local (días, apertura, cierre y descanso) están en Configuración → Página de reservas. El horario de cada profesional se cambia en Configuración → Equipo.", config("branding", "Ir a Página de reservas")),

  // ───── Agenda ─────
  t("turno-mover", "Cambiar un turno de horario", ["como muevo un turno", "reprogramar turno", "pasar un turno a otro dia", "el cliente quiere cambiar la hora", "cambiar turno de barbero"],
    "En la Agenda tocá el turno y elegí «Reprogramar turno». Los turnos ya cobrados no se pueden mover.", agenda),
  t("turno-cancelar", "Cancelar un turno", ["como cancelo un turno", "el cliente no puede venir", "borrar un turno", "dar de baja una reserva", "anular un turno"],
    "En la Agenda tocá el turno y elegí «Cancelar turno». Si tenía una seña paga, la app te pregunta si el cliente la pierde o si la reembolsás.", agenda),
  t("turno-confirmar", "Confirmar un turno", ["como confirmo un turno", "turnos por confirmar", "turno pendiente de confirmacion"],
    "Los turnos «Reservado» se confirman tocándolos en la Agenda y eligiendo «Confirmar turno».", agenda),
  t("turno-no-asistio", "El cliente no vino", ["el cliente falto", "marcar no asistio", "no se presento al turno", "me dejaron plantado"],
    "Abrí el turno en la Agenda y marcalo como «No asistió». Queda en el historial y, si usás señas para quienes faltan, la próxima vez se le pide.", agenda),
  t("turno-cobrar", "Cobrar un turno", ["como cobro un turno de la agenda", "cobrar desde la agenda", "el cliente termino y quiere pagar"],
    "Tocá el turno en la Agenda y elegí «Cobrar turno». Para cobrar, el profesional tiene que haber fichado y la caja del día debe estar abierta.", agenda),
  t("bloquear", "Bloquear un horario", ["como bloqueo horas", "no quiero que reserven en ese horario", "un barbero sale antes", "me voy un rato", "bloquear la agenda"],
    "En la Agenda abrí «Horario especial», elegí el profesional y activá «Bloquear horas». Podés repetir el bloqueo. Para quitarlo, tocalo y elegí «Liberar horario».", agenda),
  t("dia-cerrado", "Cerrar un día", ["mañana no abro", "feriado no trabajamos", "como pongo dia cerrado", "cerrar el local por un dia", "vacaciones del local"],
    "En la Agenda abrí el menú «Nuevo» y elegí «Día cerrado». Ese día no se pueden crear turnos.", agenda),
  t("horario-especial", "Horario especial de un día", ["un dia trabaja en otro horario", "cambiar horario solo por hoy", "hoy abrimos mas tarde", "franco de un barbero", "un barbero no viene hoy"],
    "En la Agenda abrí «Horario especial», elegí el profesional y cambiá su horario o marcá que no trabaja ese día. No modifica su horario habitual.", agenda),
  t("descanso", "Descanso y almuerzo", ["como cambio el descanso", "horario de almuerzo", "mover el descanso", "quitar el descanso"],
    "En la Agenda tocá el descanso para editarlo o eliminarlo; también podés arrastrarlo dentro del horario del mismo profesional.", agenda),
  t("recurrente", "Turnos que se repiten", ["turno fijo todas las semanas", "cliente que viene siempre el mismo dia", "reservas recurrentes", "repetir un turno cada 15 dias"],
    "Abrí la ficha del cliente en Clientes → Reservas recurrentes. Elegís los días, cada cuántas semanas y la duración.", clientes),

  // ───── Caja ─────
  t("venta", "Hacer una venta", ["como cobro un corte", "nueva venta", "cobrar a alguien sin turno", "vender un producto", "pagar mitad efectivo y mitad transferencia", "dividir el pago en dos medios", "registrar un cobro", "como cobro"],
    "En Caja tocá «Nueva venta», elegí profesional, servicios o productos y el medio de pago. Podés dividir el pago en varios métodos.", caja("resumen")),
  t("no-puedo-cobrar", "No me deja cobrar", ["no puedo cobrar", "no me deja hacer la venta", "error al cobrar", "por que no puedo cobrar"],
    "Revisá dos cosas: que el profesional haya fichado su entrada de hoy y que la caja del día esté abierta. Si el turno está cancelado, ya cobrado o marcado como «No asistió», tampoco se puede cobrar.", caja("resumen")),
  t("gasto", "Cargar un gasto", ["como anoto un gasto", "pague una compra", "registrar egreso", "pagar el alquiler", "nuevo gasto"],
    "En Caja tocá «Nuevo gasto»: elegí el tipo, el monto y de dónde sale la plata. Si todavía no lo pagaste, usá «Pago después» y poné el vencimiento.", caja("resumen")),
  t("gasto-pendiente", "Gastos a pagar", ["gastos pendientes de pago", "cuentas por pagar", "vencimientos", "deudas con proveedores"],
    "Los gastos cargados con «Pago después» quedan en «Gastos a pagar», dentro de Caja, con su fecha de vencimiento.", caja("resumen")),
  t("cerrar-caja", "Cerrar la caja", ["como cierro la caja", "hacer el cierre del dia", "arqueo de caja", "terminar el dia"],
    "En Caja usá «Cerrar caja»: contás el efectivo, lo comparás con el saldo esperado y confirmás. Los cierres quedan en el historial.", caja("resumen")),
  t("cierres", "Ver cierres anteriores", ["historial de cierres", "cierres pendientes", "ver la caja de ayer", "caja pendiente de revision", "movimientos de otro dia"],
    "En Caja → Cierres ves el historial y los días pendientes de cerrar, con el detalle de cada uno.", caja("cierres", "Ver cierres")),
  t("reabrir", "Reabrir la caja", ["cerre la caja por error", "como reabro la caja", "abrir de nuevo la caja", "me equivoque en el cierre"],
    "Se puede reabrir solo la caja del día, desde el historial de cierres con «Reabrir caja». Queda registrado.", caja("cierres", "Ver cierres")),
  t("corregir-cobro", "Corregir un cobro", ["cobre mal", "me equivoque en el monto", "cambiar el medio de pago de una venta", "cargue mal el precio", "editar una venta"],
    "Buscá la venta en los movimientos de Caja y usá «Corregir cobro». Pide la contraseña de autorización, que define el dueño en Configuración → Seguridad.", caja("resumen")),
  t("anular", "Anular una venta", ["como borro una venta", "eliminar un cobro", "cobre dos veces", "cancelar una venta"],
    "Buscá la venta en los movimientos de Caja y usá «Anular venta». Pide la contraseña de autorización. Una venta anulada se puede restablecer.", caja("resumen")),
  t("dinero-manual", "Ingresar o retirar dinero", ["sacar plata de la caja", "meter cambio en la caja", "retiro de efectivo", "ingresar dinero a la caja"],
    "En Caja usá «Ingresar dinero» o «Retirar dinero» y anotá el motivo, así el cierre cuadra.", caja("resumen")),
  t("saldo", "Ver cuánta plata hay", ["cuanto hay en la caja", "cuanto cobre hoy", "efectivo y banco", "ver ingresos de hoy", "cuanto facture hoy"],
    "En Inicio, la tarjeta «Caja de hoy» muestra ingresos, egresos, efectivo y banco; tocá efectivo o banco para ver cómo se arma. El ojo oculta los montos.", inicio),
  t("propina", "Propinas", ["como cargo una propina", "el cliente dejo propina", "donde van las propinas"],
    "La propina se carga al cobrar y queda a nombre del profesional; la ves en sus movimientos y en la liquidación.", caja("resumen")),

  // ───── Liquidaciones e inventario ─────
  t("liquidar", "Pagar al equipo", ["como liquido a un barbero", "pagar comisiones", "pagar las comisiones a los barberos", "pagar sueldos", "hacer la liquidacion", "cuanto le debo a un barbero"],
    "En Caja → Liquidaciones elegí el profesional, hasta qué fecha liquidar, sumá adicionales o deducciones y de dónde sale la plata. Antes hay que cerrar las cajas pendientes de ese período.", caja("profesionales", "Ir a Liquidaciones")),
  t("no-liquidar", "No me deja liquidar", ["no puedo hacer la liquidacion", "error al liquidar", "por que no me deja pagar comisiones"],
    "Suele ser porque hay cajas sin cerrar dentro del período: cerralas y volvé a intentar. Si la caja de hoy ya está cerrada, el pago solo puede salir de fondos externos.", caja("cierres", "Ver cierres")),
  t("adelanto", "Dar un adelanto", ["un barbero pide adelanto", "cargar adelanto de sueldo", "prestamo a un empleado"],
    "En Caja → Liquidaciones elegí el profesional y registrá el adelanto, indicando de dónde sale y si es en efectivo o transferencia. Se descuenta en la liquidación.", caja("profesionales", "Ir a Liquidaciones")),
  t("comision", "Comisiones", ["como cambio el porcentaje de comision", "cuanto gana cada barbero", "configurar comision"],
    "El porcentaje de cada profesional se define en Configuración → Equipo. Lo generado y lo pendiente se ve en Caja → Liquidaciones.", config("equipo", "Ir a Equipo")),
  t("stock", "Revisar el stock", ["como veo el inventario", "cuantos productos quedan", "ingresar stock", "llego mercaderia", "ajustar stock"],
    "En Caja → Inventario ves lo que hay, ingresás mercadería y ajustás el stock.", caja("inventario", "Ir a Inventario")),
  t("retiro-producto", "Un barbero se lleva un producto", ["retirar stock", "un empleado se lleva una bebida", "consumo del personal", "precio colaborador"],
    "En Caja → Inventario usá «Retirar stock»: elegís quién retira y si lo paga ahora o se anota como adelanto. Se puede usar precio colaborador.", caja("inventario", "Ir a Inventario")),
  t("producto-crear", "Crear un producto", ["agregar un producto nuevo", "cargar una bebida para vender", "cambiar precio de un producto"],
    "Los productos se crean y editan en Configuración → Catálogo: nombre, precio, imagen y si genera comisión.", config("catalogo", "Ir a Catálogo")),

  // ───── Servicios y precios ─────
  t("precio", "Cambiar precios", ["quiero subir el precio del corte", "como modifico un precio", "actualizar lista de precios", "cambiar duracion de un servicio"],
    "En Configuración → Servicios abrí el servicio, cambiá precio o duración y guardá.", config("servicios", "Ir a Servicios")),
  t("promo", "Hacer una promoción", ["como pongo un descuento", "crear una oferta", "promo en un servicio", "precio rebajado"],
    "En Configuración → Servicios abrí el servicio guardado y cargá la promo u oferta.", config("servicios", "Ir a Servicios")),
  t("servicio-ocultar", "Ocultar o borrar un servicio", ["como elimino un servicio", "que no aparezca en la web", "sacar un servicio de reservas online", "dejar de ofrecer un servicio"],
    "En Configuración → Servicios podés apagar «Se puede reservar online» para que no aparezca en tu página, o eliminar el servicio.", config("servicios", "Ir a Servicios")),
  t("servicio-orden", "Ordenar y destacar servicios", ["cambiar el orden de los servicios", "destacar un servicio", "categorias de servicios", "crear categoria"],
    "En Configuración → Servicios mantené apretado y arrastrá para ordenar, creá categorías y destacá hasta 3.", config("servicios", "Ir a Servicios")),

  // ───── Equipo ─────
  t("equipo-agregar", "Sumar un barbero", ["entro un empleado nuevo", "como agrego un profesional", "dar de alta un peluquero", "invitar a mi equipo"],
    "En Configuración → Equipo tocá «Agregar persona», completá sus datos, horarios y servicios, y si va a entrar a la app cargá su correo en Acceso.", config("equipo", "Ir a Equipo")),
  t("equipo-permisos", "Permisos del equipo", ["que no vean la caja", "limitar lo que ve un empleado", "dar acceso a recepcion", "cambiar el rol", "hacer administrador a alguien"],
    "En Configuración → Equipo abrí la persona → Acceso: elegí su rol y qué pantallas y acciones puede usar.", config("equipo", "Ir a Equipo")),
  t("equipo-baja", "Dar de baja a un barbero", ["un empleado se fue", "como elimino un profesional", "borrar un barbero", "quitar acceso a alguien"],
    "En Configuración → Equipo podés quitarle el acceso y marcarlo como inactivo. No se puede eliminar si tiene turnos futuros; su historial se conserva.", config("equipo", "Ir a Equipo")),
  t("equipo-horario", "Horario de un barbero", ["cambiar los dias que trabaja un empleado", "horario de cada profesional", "turno de trabajo de un barbero"],
    "En Configuración → Equipo abrí el profesional → «Días y horarios».", config("equipo", "Ir a Equipo")),
  t("equipo-online", "Que no reserven con un barbero", ["ocultar un barbero de la web", "no aparece el barbero en reservas online", "activar reservas en linea de un profesional"],
    "En Configuración → Equipo abrí el profesional y activá o apagá «Reservas en línea». Revisá también que tenga horarios y servicios asignados.", config("equipo", "Ir a Equipo")),
  t("foto-perfil", "Cambiar mi foto", ["como pongo mi foto de perfil", "cambiar la foto de un barbero", "subir foto del profesional"],
    "La foto de cada profesional se cambia en Configuración → Equipo → «Agregar foto». Es la que se ve arriba a la derecha en su cuenta.", config("equipo", "Ir a Equipo")),
  t("atiendo", "Soy dueño y también atiendo", ["quiero atender clientes", "aparecer yo en la agenda", "crear mi perfil de barbero"],
    "En Configuración → Equipo activá «Atiendo clientes» y elegí o creá tu perfil de barbero. Así aparecés en la Agenda.", config("equipo", "Ir a Equipo")),

  // ───── Fichaje y panel del profesional ─────
  t("fichar", "Cómo fichar", ["como ficho mi entrada", "marcar llegada", "escanear el qr", "registrar mi jornada", "marcar salida"],
    "El profesional ficha escaneando el QR del local (en Inicio, «Mostrar QR») o desde Mi Panel. Recepción inicia y cierra su jornada desde Inicio.", panel),
  t("asistencia", "Ver quién fichó", ["quien llego hoy", "ver asistencia del equipo", "quien falta fichar", "donde esta el qr de fichaje", "como saco el qr", "mostrar qr"],
    "En Inicio, «Fichaje de hoy» muestra quién fichó; «Ver asistencia» da el detalle y «Mostrar QR» el código para fichar.", inicio),
  t("tardanza", "Reglas de tardanza", ["descontar por llegar tarde", "configurar puntualidad", "multa por tardanza", "llego tarde un barbero"],
    "En Configuración → Reglas de tardanza definís desde qué minuto aplica y si descuenta puntos de comisión o un monto fijo. Sin reglas, no se descuenta nada.", config("tardanza", "Ir a Reglas de tardanza")),
  t("mi-panel", "Mi Panel", ["donde veo mis turnos", "mi agenda de barbero", "mis comisiones", "cuanto gane yo", "mis movimientos"],
    "En Mi Panel cada barbero ve su agenda, ficha su jornada y consulta sus movimientos.", panel),
  t("enviar-caja", "Enviar una venta a caja", ["como mando el cobro a recepcion", "enviar a caja", "soy barbero y termine un servicio"],
    "Desde Mi Panel el profesional usa «Enviar a caja» (o «Nueva venta», según cómo esté configurado el local) para que se registre el cobro.", panel),

  // ───── Clientes ─────
  t("cliente-buscar", "Buscar un cliente", ["como encuentro un cliente", "ver historial de un cliente", "telefono de un cliente", "ficha del cliente"],
    "En Clientes buscá por nombre o teléfono y abrí la ficha: historial, servicios favoritos, con quién se atiende y notas.", clientes),
  t("cliente-recuperar", "Recuperar clientes", ["clientes que dejaron de venir", "clientes perdidos", "como hago que vuelvan", "mandar whatsapp a clientes"],
    "En Clientes abrí el grupo «Perdidos» para ver quiénes dejaron de venir y contactarlos.", clientes),
  t("cliente-grupos", "Grupos de clientes", ["que significan los grupos", "cada cuanto viene un cliente", "frecuencia de visitas", "clientes nuevos"],
    "Los clientes se agrupan según cada cuánto vienen: nuevos, una visita, semanal, 2 o 3 semanas, mensual, 2 meses o más y perdidos. Cuenta como visita un día con un servicio cobrado.", clientes),
  t("cliente-crear", "Agregar un cliente", ["como cargo un cliente nuevo", "quiero agregar un cliente", "dar de alta un cliente"],
    "Los clientes se suman solos con las ventas y las reservas. Al agendar un turno podés cargar nombre, apellido y teléfono de alguien nuevo.", agenda),

  // ───── Página de reservas ─────
  t("link", "Compartir mi link", ["donde esta el link para mis clientes", "como comparto mi pagina", "enlace para reservar", "mandar la web por instagram"],
    "Tocá el botón «WWW» de arriba: desde ahí abrís, copiás o compartís el link de tu página de reservas."),
  t("mantenimiento", "Pausar las reservas online", ["poner la pagina en mantenimiento", "que no reserven por internet", "desactivar reservas online", "volver a poner la pagina online"],
    "En el botón «WWW» de arriba podés pasar el sitio a «Mantenimiento» (no permite reservar) y volverlo a «Online».", { permiso: "configuracion" }),
  t("portada", "Cambiar portada y logo", ["como cambio la foto de portada", "subir el logo", "cambiar el banner", "foto del local en la pagina"],
    "En Configuración → Página de reservas tocá la portada o la foto de perfil para cambiarlas; arrastrá en la vista previa para encuadrar. Es el mismo banner que ves en Inicio.", config("branding", "Ir a Página de reservas")),
  t("diseno", "Colores y diseño de la página", ["cambiar los colores de mi web", "poner neon", "efectos de entrada", "tipo de letra de la pagina", "fondo blanco en la pagina"],
    "En Configuración → Página de reservas elegís colores, fondo blanco o negro, neón, dibujos y efectos, con vista previa.", config("branding", "Ir a Página de reservas")),
  t("url", "Cambiar nombre o dirección web", ["cambiar el nombre del negocio", "cambiar la url publica", "cambiar el link de la pagina"],
    "En Configuración → Página de reservas → Información del negocio editás el nombre y la URL pública.", config("branding", "Ir a Página de reservas")),
  t("anuncio", "Publicar un anuncio", ["como escribo un anuncio", "avisar algo en mi pagina", "mensaje arriba del logo", "borrar el anuncio"],
    "En Inicio tocá el globo «Escribí un anuncio». Se ve en tu página pública y se borra solo a las 24 horas; también podés quitarlo antes.", inicio),
  t("anticipacion", "Reglas para reservar y cancelar", ["con cuanto tiempo pueden reservar", "hasta cuando pueden cancelar", "limite para reprogramar", "anticipacion minima"],
    "En Configuración → Reservas definís la anticipación mínima y máxima para reservar y hasta cuándo el cliente puede cancelar o reprogramar.", config("senas", "Ir a Reservas")),
  t("sena-revisar", "Aprobar un comprobante de seña", ["un cliente mando el comprobante", "aprobar seña", "rechazar seña", "seña pendiente", "reembolso pendiente"],
    "Cuando hay señas por revisar aparece un aviso en Caja: tocá «Revisar» para aprobarlas o rechazarlas. Los reembolsos pendientes aparecen igual.", caja("resumen")),
  t("resenas", "Reseñas", ["ver opiniones de clientes", "destacar una reseña", "cargar una reseña de google", "borrar una resena"],
    "En Configuración → Reseñas ves las opiniones, elegís cuáles destacar y podés cargar a mano las que recibiste por otro lado.", config("resenas", "Ir a Reseñas")),
  t("bolsa", "Bolsa de trabajo", ["buscar barbero", "publicar oferta de trabajo", "alquilar un sillon", "solicitudes de empleo"],
    "En Configuración → Bolsa de trabajo publicás puestos o alquiler de sillón y recibís solicitudes.", config("bolsa", "Ir a Bolsa de trabajo")),

  // ───── Sucursales, cuenta y app ─────
  t("sucursal", "Sucursales", ["agregar otra sucursal", "cambiar de local", "cambiar la direccion", "archivar sucursal", "abrir un local nuevo"],
    "Para cambiar de local usá el selector de arriba. Para agregar, editar o archivar sucursales andá a Configuración → Sucursales.", config("sucursales", "Ir a Sucursales")),
  t("autorizacion", "Contraseña de autorización", ["contraseña para anular", "contraseña para corregir cobros", "clave de caja", "historial de correcciones", "quien anulo una venta"],
    "En Configuración → Seguridad, el dueño o administrador general define las contraseñas para corregir y anular, y ve el historial de actividad.", config("seguridad", "Ir a Seguridad")),
  t("clave", "Olvidé mi contraseña", ["no puedo entrar", "recuperar contraseña", "cambiar mi clave de acceso", "no me acuerdo la contraseña"],
    "En la pantalla de ingreso tocá «¿Olvidaste tu contraseña?» y seguí las instrucciones del correo. Nunca compartas tu contraseña por este chat."),
  t("plan", "Mi suscripción", ["cuanto pago por clippr", "cuanto sale clippr", "cambiar mi plan", "metodo de pago de la suscripcion", "factura"],
    "En Configuración → Cuenta ves tu suscripción, el próximo pago y el historial.", config("cuenta", "Ir a Cuenta")),
  t("avisos", "Activar los avisos", ["no me llegan notificaciones", "quiero avisos en el celular", "activar notificaciones"],
    "Tocá tu foto arriba a la derecha → «Activar avisos». En iPhone primero instalá la app: Compartir → Agregar a pantalla de inicio, y activalos desde ahí."),
  t("instalar", "Instalar la app", ["poner clippr en la pantalla de inicio", "descargar la aplicacion", "tener el icono en el celular"],
    "En iPhone abrí Clippr en Safari, tocá Compartir → «Agregar a pantalla de inicio». En Android, desde Chrome elegí «Instalar app»."),
  t("modo-claro", "Modo claro u oscuro", ["cambiar a fondo blanco la app", "poner modo oscuro", "se ve negro", "cambiar el color de la app"],
    "Usá el interruptor de arriba en el centro: sol para modo claro y luna para modo oscuro."),
  t("salir", "Cerrar sesión", ["como salgo de mi cuenta", "cambiar de usuario", "desconectarme"],
    "Tocá tu foto arriba a la derecha → «Cerrar sesión»."),
  t("asesor", "¿Cómo va mi negocio?", ["ver estadisticas", "reporte de ganancias", "ocupacion del mes", "rendimiento", "cuanto gasta en promedio cada cliente", "asesor ia"],
    "El Asesor IA muestra la salud del negocio, ventas, clientes y ocupación comparados con períodos anteriores. Tocá «Iniciar análisis».", asesor),
  t("simulador", "Simular un aumento de precios", ["conviene subir precios", "simulador de precios", "cuanto gano si aumento"],
    "En el Asesor IA, el simulador de precios te muestra el efecto estimado de un aumento antes de aplicarlo.", asesor),

  // ───── Charla y problemas ─────
  t("problema", "Algo anda mal", ["algo anda mal", "no funciona", "tengo un problema", "hay un error", "se rompio", "la app falla", "necesito ayuda", "no entiendo nada"],
    "Contame qué está fallando y en qué parte de la app (Agenda, Caja, Clientes, Configuración…). Por ejemplo: «no me deja cobrar» o «no aparece un barbero en la web»."),
  t("lenta", "La app va lenta o no carga", ["se queda cargando", "la app esta lenta", "pantalla en blanco", "no carga la agenda", "se trabo"],
    "Probá recargar la página y revisá tu conexión. Si usás la app instalada, cerrala del todo y volvé a abrirla."),
  t("persona", "Hablar con una persona", ["quiero hablar con alguien", "soporte", "contactar a clippr", "necesito un humano"],
    "Puedo pasarle tu consulta a un asesor. Te responde por este mismo chat."),
  t("quien", "¿Quién sos?", ["quien sos", "que podes hacer", "para que servis", "sos un robot"],
    "Soy Clippi, el asistente virtual de Clippr. Te explico cómo usar la app y te llevo a la pantalla que necesitás. No veo ni cambio los datos de tu negocio."),
  t("hola", "Hola", ["hola", "buenas", "buen dia", "buenas tardes", "buenas noches", "que tal"],
    "¡Hola! Soy Clippi, el asistente de Clippr.\n\nPuedo ayudarte con:\n• Agenda y turnos\n• Caja y cobros\n• Clientes\n• Equipo, comisiones y liquidaciones\n• Tu página de reservas\n\nContame qué necesitás y lo vemos."),
  t("gracias", "Gracias", ["gracias", "muchas gracias", "genial", "perfecto", "listo gracias", "ok"],
    "¡De nada! Acá estoy si necesitás otra cosa."),
];
