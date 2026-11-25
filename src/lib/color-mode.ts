// Modo claro "rápido": invierte los colores de toda la app (ver html.modo-claro en styles.css).
// El modo oscuro es el diseño original y no cambia.
export const COLOR_MODE_KEY = "clippr-color-mode";
const CLASS = "modo-claro";
const THEME_DARK = "#0b0a14";
const THEME_LIGHT = "#ffffff";

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
  document.documentElement.classList.toggle(CLASS, light);
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
export const COLOR_MODE_BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(COLOR_MODE_KEY)})==="light"&&!${PUBLIC_PATHS}.test(location.pathname))document.documentElement.classList.add(${JSON.stringify(CLASS)})}catch(e){}`;
