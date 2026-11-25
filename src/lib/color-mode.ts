// Modo claro. Inicio tiene su propio tema claro (html.inicio-claro); el resto de la app usa el
// modo "rápido" que invierte los colores (html.modo-claro). Ver styles.css.
// El modo oscuro es el diseño original y no cambia.
export const COLOR_MODE_KEY = "clippr-color-mode";
const CLASS = "modo-claro";
const CLASS_INICIO = "inicio-claro";
const PATH_INICIO = /^\/dashboard\/?$/;
const THEME_DARK = "#0b0a14";
// El encabezado sigue negro también en modo claro.
const THEME_LIGHT = "#000000";

// Páginas para clientes: tienen su propio diseño (o tema claro/oscuro propio) y no se invierten.
const PUBLIC_PATHS = /^\/(negocio|reservar|auro-stylo|gestion|bolsa-de-trabajo|landing-demo)(\/|$)/i;

// Respaldo en memoria por si localStorage no está disponible.
let memory: boolean | null = null;

export function readLightMode(): boolean {
  if (memory !== null) return memory;
  try {
    return localStorage.getItem(COLOR_MODE_KEY) === "light";
  } catch {
    return false;
  }
}

export function applyColorMode(pathname: string) {
  const light = readLightMode() && !PUBLIC_PATHS.test(pathname);
  const inicio = light && PATH_INICIO.test(pathname);
  document.documentElement.classList.toggle(CLASS, light && !inicio);
  document.documentElement.classList.toggle(CLASS_INICIO, inicio);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", light ? THEME_LIGHT : THEME_DARK);
}

export function setLightMode(light: boolean) {
  memory = light;
  try {
    localStorage.setItem(COLOR_MODE_KEY, light ? "light" : "dark");
  } catch {
    // Sin almacenamiento: la elección dura hasta recargar.
  }
  applyColorMode(window.location.pathname);
}

// Va en <head> y corre antes del primer pintado, para que no parpadee al recargar.
export const COLOR_MODE_BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(COLOR_MODE_KEY)})==="light"&&!${PUBLIC_PATHS}.test(location.pathname))document.documentElement.classList.add(${PATH_INICIO}.test(location.pathname)?${JSON.stringify(CLASS_INICIO)}:${JSON.stringify(CLASS)})}catch(e){}`;
