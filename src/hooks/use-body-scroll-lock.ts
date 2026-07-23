import * as React from "react";

// overflow:hidden solo en el body no alcanza en iOS Safari — el rubber-band
// scroll del viewport sigue moviendo el contenido de atrás por debajo del
// modal. Fijar el body en su posición actual (position:fixed + top negativo)
// es la técnica que sí bloquea el scroll de fondo de forma confiable ahí, y
// restaurar exactamente ese scrollY al desbloquear deja la página tal como
// estaba (sin saltos) al cerrar.
//
// Contador global en vez de estado local: Liquidaciones (y otras pantallas)
// pueden tener varios modales que llaman a este hook por separado. Si dos
// llegan a solaparse (uno se cierra justo cuando otro abre, o se navega con
// un modal todavía abierto), cada instancia bloqueando/restaurando el body
// de forma aislada terminaba pisándose: la segunda instancia capturaba como
// "estilo original" un body que en realidad ya estaba con position:fixed de
// la primera, y al restaurar dejaba ese top negativo pegado para siempre.
// Ese residuo es la causa exacta del bug en iPhone/Safari donde la barra
// inferior (fixed, hermana de todo esto) terminaba flotando a mitad de
// pantalla en vez de quedar pegada abajo — no es la barra la que está mal
// posicionada, es el body el que nunca se termina de destrabar. Con un
// contador módulo-level, solo el PRIMER lock captura el estado real y solo
// el ÚLTIMO unlock lo restaura — los que quedan en el medio no tocan nada.
let lockCount = 0;
let savedScrollY = 0;
let savedStyles: {
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  overflow: string;
} | null = null;

function lockBody() {
  const body = document.body;
  savedScrollY = window.scrollY;
  savedStyles = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
  };
  body.style.position = "fixed";
  body.style.top = `-${savedScrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
}

function unlockBody() {
  const body = document.body;
  if (savedStyles) {
    body.style.position = savedStyles.position;
    body.style.top = savedStyles.top;
    body.style.left = savedStyles.left;
    body.style.right = savedStyles.right;
    body.style.width = savedStyles.width;
    body.style.overflow = savedStyles.overflow;
  }
  // iOS Safari conocido: después de sacar body{position:fixed}, otros
  // elementos position:fixed (la barra inferior de navegación) quedan
  // pintados en el lugar donde estaban relativos al offset viejo hasta que
  // algo fuerza un reflow — quedaban "flotando" a mitad de pantalla en vez
  // de volver a pegarse abajo. Leer offsetHeight fuerza ese reflow
  // sincrónico antes de restaurar el scroll.
  void body.offsetHeight;
  window.scrollTo(0, savedScrollY);
  savedStyles = null;
}

export function useBodyScrollLock(locked: boolean) {
  React.useEffect(() => {
    if (!locked) return;
    lockCount += 1;
    if (lockCount === 1) lockBody();
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) unlockBody();
    };
  }, [locked]);
}
