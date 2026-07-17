import * as React from "react";
import { ProductCard, type Product } from "./ProductCard";
// Fotos de producto — reemplazar directamente estos 3 archivos (mismo
// nombre, mismo formato o .webp/.jpg equivalente) alcanza para actualizar
// la landing: nada del código de acá abajo necesita tocarse. Son
// placeholders generados a partir del mockup anterior, no fotos reales.
import ceraMate from "@/assets/landing/section-upsell/cera-mate.png";
import polvoTexturizante from "@/assets/landing/section-upsell/polvo-texturizante.png";
import aceiteBarba from "@/assets/landing/section-upsell/aceite-barba.png";

// Referencia real: pantalla de "Productos recomendados" de la reserva
// online de Clippr (no una idea nueva) — mismo copy, misma estructura de
// tarjeta (imagen, badge de descuento, nombre, precio tachado + final,
// botón), misma fila de 3. Precios ilustrativos para la demo (30% off
// parejo en los tres), no un catálogo real.
const PRODUCTS: Product[] = [
  {
    id: "cera",
    nameLines: ["Cera", "Mate"],
    originalPrice: "$25.000",
    finalPrice: "$17.500",
    image: ceraMate,
  },
  {
    id: "polvo",
    nameLines: ["Polvo", "Texturizante"],
    originalPrice: "$22.000",
    finalPrice: "$15.400",
    image: polvoTexturizante,
  },
  {
    id: "aceite",
    nameLines: ["Aceite para", "Barba"],
    originalPrice: "$18.000",
    finalPrice: "$12.600",
    image: aceiteBarba,
  },
];

// "added" viene de afuera (useUpsellDemo en SectionUpsell): esta tarjeta
// no corre su propio timer — el mismo booleano también mueve el total en
// ComparisonCard, así los dos nunca quedan desincronizados. Solo el
// primer producto (Cera Mate) reacciona a "added"; Polvo Texturizante y
// Aceite para Barba se quedan siempre en "Agregar" — el demo muestra UNA
// sugerencia aceptada, no las tres a la vez.
export function ProductsMockup({ added }: { added: boolean }) {
  return (
    <div className="w-full max-w-[380px] rounded-[2rem] border border-white/10 bg-white/[0.03] p-4 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:p-6 lg:max-w-none lg:p-7">
      <div className="text-sm font-bold text-white sm:text-lg">Tentate con estos descuentos</div>
      <div className="mt-1 text-xs text-white/55 sm:text-sm">
        Sumalos a tu turno y retiralos en el local.
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:mt-4 sm:gap-3">
        {PRODUCTS.map((product, i) => (
          <ProductCard key={product.id} product={product} added={i === 0 && added} />
        ))}
      </div>
    </div>
  );
}
