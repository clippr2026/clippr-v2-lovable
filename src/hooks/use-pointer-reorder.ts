import { useCallback, useLayoutEffect, useRef, useState } from "react";

// Reordena una lista arrastrando con Pointer Events (mouse, touch o pen) en
// vez de drag&drop nativo de HTML5 — el nativo no dispara en navegadores
// mobile, que es donde más se usa esta app; esa distancia 2D (no solo eje X
// o Y) resuelve también grids que arman varias filas sin necesitar lógica
// de fila/columna aparte.
//
// El gesto arranca con presión mantenida (long-press), no con el simple
// pointerdown: un toque o swipe normal sobre la fila/tarjeta debe seguir
// scrolleando la pantalla sin interferencia. Por eso `startPress` no hace
// nada disruptivo (sin preventDefault, sin tocar touch-action) hasta que
// pasan LONG_PRESS_MS sosteniendo el dedo casi quieto; recién ahí se
// "levanta" el elemento (scale + vibración) y arranca el drag de verdad. Si
// hay un pointerup o un movimiento mayor a MOVE_CANCEL_PX antes de ese
// punto, se cancela la activación y el gesto se deja pasar tal cual (scroll
// nativo o el click normal del elemento).
//
// El elemento arrastrado sigue al dedo/mouse en tiempo real (transform
// imperativo, sin pasar por React en cada pixel — más fluido) y el resto de
// los ítems desliza a su nueva posición con una animación FLIP (se toma la
// posición ANTES de reordenar y se anima desde ahí) en vez de saltar
// instantáneo, para que se note claramente el hueco que se abre en destino.
const LONG_PRESS_MS = 350;
const MOVE_CANCEL_PX = 10;

export function usePointerReorder<T>(
  items: T[],
  getId: (item: T) => string,
  onChange: (next: T[]) => void,
  onDragEnd: (finalItems: T[]) => void,
  // "x": el elemento arrastrado solo se desplaza horizontal (categorías,
  // en su misma fila). "y": solo vertical (ítems, dentro de su columna/
  // lista). Tanto el transform visual como el cálculo de "a qué posición
  // se mueve" quedan atados al mismo eje — así nunca se compara/salta
  // contra la distancia del eje que no debería importar.
  axis: "x" | "y",
  dragScale = 1.06,
  // Se invoca en cada pointermove mientras hay un drag activo (sin el
  // throttle de MIN_COMMIT_DELTA de abajo, que es solo para decidir cuándo
  // reordenar). Lo usa el drag de ítems para detectar si el dedo está
  // sobre una pestaña de categoría distinta.
  onDragMove?: (x: number, y: number, id: string) => void,
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const rectsBeforeRef = useRef<Map<string, DOMRect>>(new Map());

  const setNodeRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) nodesRef.current.set(id, el);
      else nodesRef.current.delete(id);
    },
    [],
  );

  // FLIP de los ítems NO arrastrados: corre después de cada render (sin
  // deps — el check de tamaño de abajo lo hace barato en el caso común) y
  // solo hace algo cuando handleMove acaba de dejar un snapshot de
  // posiciones "antes" listo para animar.
  useLayoutEffect(() => {
    const before = rectsBeforeRef.current;
    if (before.size === 0) return;
    rectsBeforeRef.current = new Map();
    for (const it of items) {
      const id = getId(it);
      if (id === draggingIdRef.current) continue;
      const node = nodesRef.current.get(id);
      const prevRect = before.get(id);
      if (!node || !prevRect) continue;
      const newRect = node.getBoundingClientRect();
      const dx = prevRect.left - newRect.left;
      const dy = prevRect.top - newRect.top;
      if (!dx && !dy) continue;
      node.style.transition = "none";
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        node.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
        node.style.transform = "";
      });
    }
  });

  const startPress = useCallback(
    (id: string, event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;

      // Fase de espera: todavía no es un drag. No hay preventDefault ni
      // pointer capture acá — si el usuario suelta antes de tiempo (tap) o
      // mueve el dedo (scroll/swipe), el gesto se deja pasar sin tocar
      // nada, tal como si este handler no existiera.
      const cancelWait = () => {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", waitMove);
        window.removeEventListener("pointerup", waitEnd);
        window.removeEventListener("pointercancel", waitEnd);
      };
      const waitMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) cancelWait();
      };
      const waitEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        cancelWait();
      };

      const activate = () => {
        cancelWait();
        const node = nodesRef.current.get(id);
        if (!node) return;
        // Recién acá arranca el drag: se toma el pointer, se bloquea el
        // scroll nativo para el resto de este gesto y se "levanta" el
        // elemento (scale + sombra vía draggingId + vibración si el
        // dispositivo lo soporta — iOS Safari no implementa la Vibration
        // API, así que ahí simplemente no vibra). setPointerCapture puede
        // lanzar si el pointer ya no está activo (p. ej. el navegador lo dio
        // por perdido) — no debe abortar el resto de la activación si falla,
        // porque el tracking real del gesto va por los listeners globales de
        // abajo, no por la captura.
        try {
          node.setPointerCapture(pointerId);
        } catch {
          /* no-op */
        }
        node.style.touchAction = "none";
        node.style.willChange = "transform";
        node.style.transition = "transform 140ms cubic-bezier(0.22, 1, 0.36, 1)";
        node.style.transform = `scale(${dragScale})`;
        window.setTimeout(() => {
          if (node) node.style.transition = "";
        }, 150);
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          try {
            navigator.vibrate(12);
          } catch {
            /* no-op: algunos navegadores lanzan si se llama sin gesto reciente */
          }
        }
        draggingIdRef.current = id;
        setDraggingId(id);

        // Cuánto tiene que moverse el puntero desde el último reordenamiento
        // antes de volver a evaluar si corresponde otro. Sin esto, el
        // temblor natural de la mano (un par de px) hace que el algoritmo de
        // "más cercano" oscile entre dos posiciones — el ítem "tiembla"/se
        // sigue moviendo aunque el dedo esté prácticamente quieto.
        const MIN_COMMIT_DELTA = 16;
        let lastCommitPos = axis === "x" ? startX : startY;

        const handleMove = (moveEvent: PointerEvent) => {
          if (moveEvent.pointerId !== pointerId) return;
          // Con el drag ya activo, este preventDefault es lo que realmente
          // le saca el gesto al scroll nativo del navegador (touch-action
          // solo alcanza a avisar la intención; en iOS un touch que arrancó
          // sin `none` puede seguir queriendo scrollear la página apenas el
          // dedo se mueve, aunque hayamos cambiado touch-action al activar
          // — cancelar el evento acá es lo que efectivamente lo bloquea).
          if (moveEvent.cancelable) moveEvent.preventDefault();
          const x = moveEvent.clientX;
          const y = moveEvent.clientY;
          const current = itemsRef.current;
          const fromIndex = current.findIndex((it) => getId(it) === id);
          if (fromIndex < 0) return;

          const dragNode = nodesRef.current.get(id);
          if (dragNode) {
            const tx = axis === "x" ? x - startX : 0;
            const ty = axis === "y" ? y - startY : 0;
            dragNode.style.transform = `translate(${tx}px, ${ty}px) scale(${dragScale})`;
          }

          onDragMove?.(x, y, id);

          // El elemento ya sigue al dedo con fluidez (arriba). Lo que sigue
          // — decidir si corresponde reordenar — solo se reevalúa si hubo
          // movimiento real desde el último cambio de posición.
          const pos = axis === "x" ? x : y;
          if (Math.abs(pos - lastCommitPos) < MIN_COMMIT_DELTA) return;

          let bestIndex = fromIndex;
          let bestDist = Infinity;
          current.forEach((it, i) => {
            const itId = getId(it);
            if (itId === id) return; // sigue al puntero: no compite consigo mismo
            const el = nodesRef.current.get(itId);
            if (!el) return;
            const rect = el.getBoundingClientRect();
            // Solo se compara en el eje permitido — el otro eje no debe
            // hacer "saltar" el reorden hacia una fila/columna distinta.
            const dist =
              axis === "x"
                ? (x - (rect.left + rect.width / 2)) ** 2
                : (y - (rect.top + rect.height / 2)) ** 2;
            if (dist < bestDist) {
              bestDist = dist;
              bestIndex = i;
            }
          });
          if (bestIndex !== fromIndex) {
            lastCommitPos = pos;
            const next = [...current];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(bestIndex, 0, moved);
            rectsBeforeRef.current = new Map(
              current
                .filter((it2) => getId(it2) !== id)
                .map((it2) => {
                  const nid = getId(it2);
                  const el2 = nodesRef.current.get(nid);
                  return el2 ? ([nid, el2.getBoundingClientRect()] as const) : null;
                })
                .filter((v): v is readonly [string, DOMRect] => v !== null),
            );
            onChange(next);
          }
        };

        const finish = (endEvent?: PointerEvent) => {
          if (endEvent && endEvent.pointerId !== pointerId) return;
          // Evita el click fantasma que el navegador dispara después de un
          // pointerup sobre el mismo elemento — sin esto, soltar el ítem
          // arrastrado podía además togglear "Activo" o abrir "Editar" si
          // terminó bajo esos botones.
          if (endEvent?.cancelable) endEvent.preventDefault();
          window.removeEventListener("pointermove", handleMove);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
          const node2 = nodesRef.current.get(id);
          if (node2) {
            node2.style.transition = "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)";
            node2.style.transform = "";
            node2.style.willChange = "";
            node2.style.touchAction = "";
            window.setTimeout(() => {
              if (node2) node2.style.transition = "";
            }, 200);
          }
          draggingIdRef.current = null;
          setDraggingId(null);
          onDragEnd(itemsRef.current);
        };

        // { passive: false } explícito: sin esto, algunos navegadores móviles
        // tratan los listeners de pointermove en window como pasivos por
        // default y el preventDefault() de arriba se ignora en silencio.
        window.addEventListener("pointermove", handleMove, { passive: false });
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
      };

      const timer = window.setTimeout(activate, LONG_PRESS_MS);
      window.addEventListener("pointermove", waitMove);
      window.addEventListener("pointerup", waitEnd);
      window.addEventListener("pointercancel", waitEnd);
    },
    [getId, onChange, onDragEnd, axis, dragScale, onDragMove],
  );

  return { draggingId, setNodeRef, startPress };
}
