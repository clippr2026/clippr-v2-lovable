import * as React from "react";
import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Product {
  id: string;
  // Dos líneas fijas, no un string libre: antes "Cera Mate" entraba en
  // una línea y las otras dos en dos, y aunque la caja reservaba la
  // altura de 2 líneas igual, el corte de línea "natural" (wrap por
  // ancho) es frágil — ya rompió una vez con el precio (ver más abajo).
  // Con el salto de línea decidido acá, las tres tarjetas SIEMPRE
  // renderizan la misma cantidad de líneas, sea cual sea el ancho.
  nameLines: readonly [string, string];
  originalPrice: string;
  finalPrice: string;
  // Foto real del producto (ver ProductsMockup.tsx para los imports) —
  // reemplazar el archivo en src/assets/landing/section-upsell/ alcanza,
  // no hay que tocar este componente.
  image: string;
}

// Tarjeta con la misma estructura que la pantalla real de "Productos
// recomendados" de la reserva online: imagen grande, badge de
// descuento, nombre, precio (original tachado + final destacado), botón
// de agregar.
//
// "name" reserva SIEMPRE 2 líneas de alto (min-h, no line-clamp solo):
// así "Cera Mate" (1 línea) y "Polvo Texturizante"/"Aceite para Barba"
// (2 líneas en tarjetas angostas) terminan exactamente a la misma altura
// — precio y botón quedan alineados en fila sin importar cuánto texto
// tenga el nombre de cada una.
export function ProductCard({ product, added }: { product: Product; added: boolean }) {
  return (
    <div className="flex flex-col">
      <div
        className="relative aspect-square overflow-hidden rounded-2xl"
        style={{
          background: "radial-gradient(65% 65% at 50% 38%, oklch(0.24 0.05 292), oklch(0.09 0.02 292))",
        }}
      >
        <img
          src={product.image}
          alt={`${product.nameLines[0]} ${product.nameLines[1]}`}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Mismo velo de luz de estudio en las tres tarjetas: así "la
            misma iluminación" es literal — es una sola capa compartida
            encima de la foto, no algo que cada foto tenga que traer
            resuelto por su cuenta. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 35%), linear-gradient(0deg, rgba(0,0,0,0.35) 0%, transparent 40%)",
          }}
        />
        <span
          className="absolute left-2 top-2 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-white sm:text-[10px]"
          style={{ background: "linear-gradient(135deg, oklch(0.62 0.24 292), oklch(0.46 0.24 296))" }}
        >
          30% OFF
        </span>
      </div>

      {/* Alto fijo (2 líneas siempre, ver comentario del tipo Product más
          arriba): así el precio y el botón de abajo arrancan en el mismo
          punto exacto en las tres tarjetas, sin depender de cuántas
          líneas "le toquen" a cada nombre. */}
      <div className="mt-2 h-[2.4em] text-xs font-semibold leading-tight text-white sm:text-sm">
        <span className="block">{product.nameLines[0]}</span>
        <span className="block">{product.nameLines[1]}</span>
      </div>

      {/* min-h + whitespace-nowrap: a este ancho de tarjeta, "$22.000 +
          $15.400" (Polvo Texturizante) es un pelo más ancho que los otros
          dos precios y a veces baja de línea por diferencia de kerning
          entre dígitos — envolvía SOLO esa tarjeta y la desalineaba del
          resto (medido, no supuesto: mismo motivo que el nombre de
          arriba, pero en la fila de precio). Fijar la altura y prohibir
          el wrap saca esa variable por completo. */}
      <div className="mt-0.5 flex min-h-[1.35em] items-baseline gap-x-1.5 whitespace-nowrap">
        <span className="text-[10px] text-white/40 line-through sm:text-xs">{product.originalPrice}</span>
        <span className="text-xs font-bold text-white sm:text-sm">{product.finalPrice}</span>
      </div>

      <button
        type="button"
        tabIndex={-1}
        className={cn(
          "mt-2 flex items-center justify-center gap-1 rounded-full py-1.5 text-[11px] font-bold transition-all duration-500 ease-out sm:text-xs",
          added ? "text-white" : "text-white/85",
        )}
        style={{
          background: added
            ? "linear-gradient(135deg, oklch(0.62 0.24 292), oklch(0.46 0.24 296))"
            : "transparent",
          boxShadow: added
            ? "0 0 16px -4px oklch(0.6 0.24 292 / 0.7)"
            : "inset 0 0 0 1.5px oklch(1 0 0 / 0.18)",
        }}
      >
        {added ? (
          <>
            <Check className="h-3 w-3" strokeWidth={3} />
            Agregado
          </>
        ) : (
          <>
            <Plus className="h-3 w-3" strokeWidth={3} />
            Agregar
          </>
        )}
      </button>
    </div>
  );
}
