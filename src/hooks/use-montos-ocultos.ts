import * as React from "react";

const KEY = "clippr_caja_montos_ocultos";
const EVENTO = "clippr:montos-ocultos";
export const MONTO_OCULTO = "$ ****";

function leer(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Ocultar/mostrar los montos de "Caja de hoy" (como en el banco). Se acuerda de la elección y es una sola
 * para Caja e Inicio: ocultar en una pantalla oculta también en la otra.
 */
export function useMontosOcultos(): [boolean, () => void] {
  const [oculto, setOculto] = React.useState(false);
  React.useEffect(() => {
    setOculto(leer());
    const sync = () => setOculto(leer());
    window.addEventListener(EVENTO, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENTO, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const alternar = React.useCallback(() => {
    try {
      localStorage.setItem(KEY, leer() ? "0" : "1");
    } catch {
      /* sin almacenamiento: no se guarda */
    }
    window.dispatchEvent(new Event(EVENTO));
  }, []);
  return [oculto, alternar];
}
