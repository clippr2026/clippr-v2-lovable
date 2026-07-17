import * as React from "react";

// overflow:hidden solo en el body no alcanza en iOS Safari — el rubber-band
// scroll del viewport sigue moviendo el contenido de atrás por debajo del
// modal. Fijar el body en su posición actual (position:fixed + top negativo)
// es la técnica que sí bloquea el scroll de fondo de forma confiable ahí, y
// restaurar exactamente ese scrollY al desbloquear deja la página tal como
// estaba (sin saltos) al cerrar.
export function useBodyScrollLock(locked: boolean) {
  React.useEffect(() => {
    if (!locked) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [locked]);
}
