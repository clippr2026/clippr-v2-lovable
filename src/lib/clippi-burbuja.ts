// La burbuja de Clippi se puede arrastrar y guardar en el basurero. La posición y si está
// guardada quedan en el dispositivo, separadas por cuenta.

export type Punto = { x: number; y: number };
export type Burbuja = { posicion: Punto | null; guardada: boolean };

/** Diámetro de la burbuja (h-12 w-12). */
export const TAMANO_BURBUJA = 48;
const MARGEN = 8;
// Hasta cuántos píxeles se mueve el dedo y sigue contando como un toque.
const TOQUE_PX = 8;
// A qué distancia del centro del basurero se lo considera adentro.
const ALCANCE_BASURERO = 70;

export const seArrastro = (desde: Punto, hasta: Punto) => Math.hypot(hasta.x - desde.x, hasta.y - desde.y) > TOQUE_PX;

/** Deja la esquina de la burbuja siempre dentro de la pantalla (también al girar el teléfono). */
export function dentroDePantalla(p: Punto, ancho: number, alto: number): Punto {
  const limitar = (valor: number, largo: number) => Math.min(Math.max(valor, MARGEN), Math.max(MARGEN, largo - TAMANO_BURBUJA - MARGEN));
  return { x: limitar(p.x, ancho), y: limitar(p.y, alto) };
}

// Al soltarla no queda debajo del encabezado y la sucursal (arriba) ni de la barra de navegación (abajo).
const LIBRE_ARRIBA = 96;
const LIBRE_ABAJO = 84;

/** Al soltarla se pega al borde izquierdo o derecho más cercano, sin tapar encabezado ni barra de abajo. */
export function pegarAlBorde(p: Punto, ancho: number, alto: number): Punto {
  const derecha = p.x + TAMANO_BURBUJA / 2 > ancho / 2;
  const x = derecha ? Math.max(MARGEN, ancho - TAMANO_BURBUJA - MARGEN) : MARGEN;
  const techo = Math.min(LIBRE_ARRIBA, Math.max(MARGEN, alto - TAMANO_BURBUJA - MARGEN));
  const piso = Math.max(techo, alto - TAMANO_BURBUJA - LIBRE_ABAJO);
  return { x, y: Math.min(Math.max(p.y, techo), piso) };
}

/** `centro` es el centro del basurero y `p` la esquina de la burbuja. */
export const sobreBasurero = (p: Punto, centro: Punto) =>
  Math.hypot(p.x + TAMANO_BURBUJA / 2 - centro.x, p.y + TAMANO_BURBUJA / 2 - centro.y) <= ALCANCE_BASURERO;

const clave = (cuenta: string) => `clippr_clippi_burbuja_${cuenta}`;

export function leerBurbuja(cuenta: string): Burbuja {
  try {
    const dato = JSON.parse(localStorage.getItem(clave(cuenta)) ?? "null") as Partial<Burbuja> | null;
    const p = dato?.posicion;
    return {
      posicion: p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null,
      guardada: dato?.guardada === true,
    };
  } catch {
    return { posicion: null, guardada: false };
  }
}

export function guardarBurbuja(cuenta: string, burbuja: Burbuja) {
  try {
    localStorage.setItem(clave(cuenta), JSON.stringify(burbuja));
  } catch {
    // Sin almacenamiento: dura hasta recargar o cambiar de pantalla.
  }
}

const ABRIR = "clippr:abrir-clippi";

/** Abre el chat desde otra pantalla (Configuración) y vuelve a mostrar la burbuja. */
export const abrirClippi = () => window.dispatchEvent(new Event(ABRIR));

export function alPedirClippi(abrir: () => void) {
  window.addEventListener(ABRIR, abrir);
  return () => window.removeEventListener(ABRIR, abrir);
}
