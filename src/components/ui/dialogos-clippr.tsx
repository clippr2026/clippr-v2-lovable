import * as React from "react";
import { VentanaClippr } from "@/components/clientes/ventana-clippr";

// Avisos y preguntas "estilo Clippr": reemplazan los cuadros blancos del navegador (confirm / prompt).
// Se usan con await:  if (!(await confirmarClippr({ titulo: "¿Eliminar?" }))) return;
// <DialogosClippr /> se monta una sola vez en la raíz de la app.

type OpcionesConfirmar = {
  titulo: string;
  texto?: string;
  confirmar?: string;
  cancelar?: string;
  /** Acción que borra o descarta: el botón de confirmar va en rojo. */
  destructivo?: boolean;
};
type OpcionesTexto = {
  titulo: string;
  texto?: string;
  placeholder?: string;
  confirmar?: string;
  cancelar?: string;
};
type Pedido =
  | { tipo: "confirmar"; opciones: OpcionesConfirmar; resolver: (r: boolean) => void }
  | { tipo: "texto"; opciones: OpcionesTexto; resolver: (r: string | null) => void };

let abrir: ((p: Pedido) => void) | null = null;

export function confirmarClippr(opciones: OpcionesConfirmar): Promise<boolean> {
  if (!abrir) {
    // Sin la ventana montada (por ejemplo en el servidor) se cae al cuadro del navegador.
    return Promise.resolve(typeof window !== "undefined" ? window.confirm(opciones.texto ? `${opciones.titulo}\n${opciones.texto}` : opciones.titulo) : false);
  }
  return new Promise((resolver) => abrir!({ tipo: "confirmar", opciones, resolver }));
}

/** Pide un texto. Devuelve el texto escrito (puede ser vacío) o null si se cancela. */
export function pedirTextoClippr(opciones: OpcionesTexto): Promise<string | null> {
  if (!abrir) {
    return Promise.resolve(typeof window !== "undefined" ? window.prompt(opciones.titulo) : null);
  }
  return new Promise((resolver) => abrir!({ tipo: "texto", opciones, resolver }));
}

export function DialogosClippr() {
  const [pedido, setPedido] = React.useState<Pedido | null>(null);
  const [texto, setTexto] = React.useState("");
  const actual = React.useRef<Pedido | null>(null);

  const cerrar = React.useCallback((valor: boolean | string | null) => {
    const p = actual.current;
    actual.current = null;
    setPedido(null);
    if (!p) return;
    if (p.tipo === "confirmar") p.resolver(valor === true);
    else p.resolver(typeof valor === "string" ? valor : null);
  }, []);

  React.useEffect(() => {
    abrir = (nuevo) => {
      // Si ya había una pregunta abierta, se da por cancelada.
      const previo = actual.current;
      if (previo) {
        if (previo.tipo === "confirmar") previo.resolver(false);
        else previo.resolver(null);
      }
      actual.current = nuevo;
      setTexto("");
      setPedido(nuevo);
    };
    return () => {
      abrir = null;
    };
  }, []);

  if (!pedido) return null;
  const o = pedido.opciones;
  const destructivo = pedido.tipo === "confirmar" && Boolean(pedido.opciones.destructivo);

  return (
    <VentanaClippr
      titulo={o.titulo}
      ancho="max-w-sm"
      onClose={() => cerrar(pedido.tipo === "texto" ? null : false)}
      footer={
        <>
          <button
            type="button"
            onClick={() => cerrar(pedido.tipo === "texto" ? null : false)}
            className="h-11 rounded-full border border-white/10 bg-white/[0.04] px-5 text-sm font-semibold text-white/85 transition hover:bg-white/[0.08]"
          >
            {o.cancelar ?? "Cancelar"}
          </button>
          <button
            type="button"
            onClick={() => cerrar(pedido.tipo === "texto" ? texto : true)}
            className={
              destructivo
                ? "h-11 rounded-full border border-rose-400/60 bg-rose-500/15 px-5 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/25"
                : "h-11 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 px-5 text-sm font-semibold text-background transition hover:brightness-110"
            }
          >
            {o.confirmar ?? (pedido.tipo === "texto" ? "Aceptar" : destructivo ? "Eliminar" : "Confirmar")}
          </button>
        </>
      }
    >
      {o.texto ? <p className="text-sm leading-relaxed text-white/75">{o.texto}</p> : null}
      {pedido.tipo === "texto" ? (
        <input
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") cerrar(texto);
          }}
          placeholder={pedido.opciones.placeholder}
          className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-violet-400/50"
        />
      ) : null}
    </VentanaClippr>
  );
}
